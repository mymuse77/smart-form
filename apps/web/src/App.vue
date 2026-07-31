<template>
  <div class="app-layout">
    <TopBar
      :agent-state="agentState"
      @pause="onPause"
      @takeover="onTakeover"
      @resume="onResume"
    />
    <div class="main-body">
      <ChatPanel
        ref="chatPanelRef"
        :is-task-running="isTaskRunning"
        @send-task="onSendTask"
        @stop-task="onStopTask"
      />
      <WorkspacePanel
        :current-url="currentUrl"
        :frame-src="frameSrc"
        :has-started-task="hasStartedTask"
      />
      <ExecutionPanel :steps="steps" />
    </div>
    <BottomBar
      :collected-count="collectedCount"
      :error-count="errorCount"
      :runtime-str="runtimeStr"
    />
    <SubmitPreviewPanel
      :visible="submitPreviewVisible"
      :target-url="currentUrl"
      :submission-id="activeSubmissionId"
      :form-data="previewFormData"
      @approve="onSubmitApprove"
      @reject="onSubmitReject"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import TopBar from './components/TopBar.vue';
import ChatPanel from './components/ChatPanel.vue';
import WorkspacePanel from './components/WorkspacePanel.vue';
import ExecutionPanel, { type ExecutionStep } from './components/ExecutionPanel.vue';
import BottomBar from './components/BottomBar.vue';
import SubmitPreviewPanel from './components/SubmitPreviewPanel.vue';
import { ControlPlaneClient, type ControlPlaneMessage } from './control-plane';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001';
const wsUrl = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:3001/ws';
const accessToken = sessionStorage.getItem('smart-form.access-token')
  || import.meta.env.VITE_DEV_ACCESS_TOKEN
  || (import.meta.env.DEV ? 'smart-form-local-dev-token' : '');
const client = accessToken ? new ControlPlaneClient({
  apiBaseUrl,
  wsUrl,
  accessToken,
  deviceId: import.meta.env.VITE_DEVICE_ID || 'local-device',
  workspaceId: import.meta.env.VITE_WORKSPACE_ID || 'local-workspace',
}) : null;

const agentState = ref('OFFLINE');
const currentUrl = ref('');
const frameSrc = ref('');
const hasStartedTask = ref(false);
const collectedCount = ref(0);
const errorCount = ref(0);
const runtimeStr = ref('00:00:00');
const isTaskRunning = ref(false);
const activeTaskId = ref('');
const activeTaskMode = ref<'read' | 'write'>('read');
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const submitPreviewVisible = ref(false);
const activeSubmissionId = ref('');
const previewFormData = ref<Record<string, unknown>>({});
const steps = ref<ExecutionStep[]>([
  { action: '等待连接云端控制面与本地 Desktop Agent...', status: 'WAITING' },
]);
const disposers: Array<() => void> = [];

onMounted(() => {
  if (!client) {
    agentState.value = 'AUTH_REQUIRED';
    appendError('缺少 OIDC 访问令牌，请先完成登录。');
    return;
  }
  disposers.push(
    client.onStatus((connected) => {
      agentState.value = connected ? 'READY' : 'OFFLINE';
      steps.value.push({
        action: connected ? '已连接云端控制面' : '控制面连接中断，正在重连',
        status: connected ? 'SUCCESS' : 'WAITING',
      });
    }),
    client.onFrame(handleFrame),
    client.onMessage(handleServerMessage),
  );
  client.connect();
});

onUnmounted(() => {
  for (const dispose of disposers) dispose();
  client?.disconnect();
  if (frameSrc.value) URL.revokeObjectURL(frameSrc.value);
});

function handleFrame(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'SMFR') return;
  const view = new DataView(buffer);
  const taskIdLength = view.getUint32(22);
  const headerLength = 30 + taskIdLength;
  if (headerLength >= bytes.length) return;
  const frameTaskId = new TextDecoder().decode(bytes.subarray(26, 26 + taskIdLength));
  if (!activeTaskId.value || frameTaskId !== activeTaskId.value) return;
  const imageLength = view.getUint32(26 + taskIdLength);
  if (imageLength !== bytes.length - headerLength) return;
  const blob = new Blob([bytes.subarray(headerLength)], { type: 'image/jpeg' });
  if (frameSrc.value) URL.revokeObjectURL(frameSrc.value);
  frameSrc.value = URL.createObjectURL(blob);
}

function handleServerMessage(message: ControlPlaneMessage) {
  if (message.type !== 'agent.report') return;
  const report = message.payload as {
    type?: string;
    taskId?: string;
    payload?: Record<string, unknown>;
  };
  if (activeTaskId.value && report.taskId && report.taskId !== activeTaskId.value) return;
  const payload = report.payload ?? {};
  if (report.type === 'COMMAND_REJECTED' || report.type === 'ARTIFACT_REJECTED') {
    appendError(String(payload.reason ?? payload.detail ?? 'Desktop 拒绝了命令'));
    isTaskRunning.value = false;
    agentState.value = 'FAILED';
    return;
  }
  if (report.type !== 'TASK_EVENT') return;
  const state = String(payload.state ?? '');
  agentState.value = state;
  if (state === 'WAITING_HUMAN') {
    steps.value.push({ action: '需要人工登录或验证码处理，Chromium 已置前', status: 'WAITING' });
    chatPanelRef.value?.addAssistantReply(
      '需要你在本地 Chromium 中完成人工操作，完成后点击“恢复 Agent”。',
    );
  } else if (state === 'WAITING_APPROVAL_SUBMIT') {
    activeSubmissionId.value = String(payload.submissionId ?? '');
    previewFormData.value = (payload.formDataSnapshot ?? {}) as Record<string, unknown>;
    submitPreviewVisible.value = true;
    steps.value.push({ action: '填报已完成，等待最终提交审批', status: 'WAITING' });
  } else if (state === 'SUCCEEDED') {
    finishTask(payload);
  } else if (state === 'FAILED' || state === 'CANCELLED') {
    appendError(String(payload.error ?? `任务进入 ${state}`));
    isTaskRunning.value = false;
  } else {
    steps.value.push({ action: `任务状态：${state}`, status: 'RUNNING' });
  }
}

function finishTask(payload: Record<string, unknown>) {
  markRunningStepsAsSuccess();
  isTaskRunning.value = false;
  const records = Array.isArray(payload.records) ? payload.records : [];
  collectedCount.value = records.length;
  steps.value.push({ action: '任务执行完成', status: 'SUCCESS' });
  const summary = activeTaskMode.value === 'write'
    ? `填报与审批提交完成，提交编号：${escapeHtml(activeSubmissionId.value || '已记录')}`
    : `采集完成，共 ${records.length} 条记录。`;
  chatPanelRef.value?.addAssistantReply(summary);
}

async function onSendTask(message: string) {
  if (!client) return;
  hasStartedTask.value = true;
  isTaskRunning.value = true;
  steps.value = [{ action: `向控制面提交意图：${escapeHtml(message)}`, status: 'RUNNING' }];
  try {
    const accepted = await client.createTask(message);
    activeTaskId.value = accepted.task.id;
    activeTaskMode.value = accepted.task.mode;
    currentUrl.value = accepted.task.site.entryUrl;
    agentState.value = 'WAITING_DEVICE';
    steps.value.push({
      action: `已匹配 ${accepted.matchedResources.length} 个版本化资源并下发 Desktop`,
      status: 'SUCCESS',
    });
  } catch (error) {
    isTaskRunning.value = false;
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('Failed to fetch') || errMsg.includes('ERR_CONNECTION_REFUSED') || errMsg.includes('fetch')) {
      appendError(`无法连接到控制面服务 (${apiBaseUrl})。请确保已在终端启动 Server 后端：pnpm dev:server`);
    } else {
      appendError(errMsg);
    }
  }
}

async function sendControl(
  type: Parameters<ControlPlaneClient['controlTask']>[1],
  submissionId?: string,
) {
  if (!client || !activeTaskId.value) return;
  try {
    await client.controlTask(activeTaskId.value, type, submissionId);
  } catch (error) {
    appendError(error instanceof Error ? error.message : String(error));
  }
}

function onPause() {
  agentState.value = 'PAUSED';
  void sendControl('PAUSE_TASK');
}

function onTakeover() {
  agentState.value = 'HUMAN_CONTROL';
  void sendControl('REQUEST_TAKEOVER');
}

function onResume() {
  agentState.value = 'RUNNING';
  void sendControl('RESUME_AFTER_HUMAN');
}

function onStopTask() {
  isTaskRunning.value = false;
  void sendControl('CANCEL_TASK');
}

function onSubmitApprove() {
  submitPreviewVisible.value = false;
  agentState.value = 'SUBMITTING';
  void sendControl('APPROVE_SUBMIT', activeSubmissionId.value);
}

function onSubmitReject() {
  submitPreviewVisible.value = false;
  agentState.value = 'CANCELLED';
  isTaskRunning.value = false;
  void sendControl('REJECT_SUBMIT', activeSubmissionId.value);
}

function markRunningStepsAsSuccess() {
  for (const step of steps.value) {
    if (step.status === 'RUNNING') step.status = 'SUCCESS';
  }
}

function appendError(message: string) {
  errorCount.value += 1;
  steps.value.push({ action: message, status: 'FAILED' });
  chatPanelRef.value?.addAssistantReply(`执行失败：${escapeHtml(message)}`);
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
</style>
