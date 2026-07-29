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
      <WorkspacePanel :current-url="currentUrl" :frame-src="frameSrc" />
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
import { ref, onMounted, onUnmounted } from 'vue';
import TopBar from './components/TopBar.vue';
import ChatPanel from './components/ChatPanel.vue';
import WorkspacePanel from './components/WorkspacePanel.vue';
import ExecutionPanel, { ExecutionStep } from './components/ExecutionPanel.vue';
import BottomBar from './components/BottomBar.vue';
import SubmitPreviewPanel from './components/SubmitPreviewPanel.vue';

const agentState = ref('RUNNING');
const currentUrl = ref('http://localhost:8080/table.html');
const frameSrc = ref('');
const collectedCount = ref(4);
const errorCount = ref(0);
const runtimeStr = ref('00:02:15');
const isTaskRunning = ref(false);
const chatPanelRef = ref<any>(null);

// 填报提交预览控制
const submitPreviewVisible = ref(false);
const activeSubmissionId = ref('');
const previewFormData = ref<Record<string, any>>({});

// 初始化首屏提示步骤
const steps = ref<ExecutionStep[]>([
  { action: '连接本地 Chromium 独立 Profile 成功', status: 'SUCCESS' },
  { action: '准备就绪，支持下发采集（Read）或填报（Write）指令...', status: 'SUCCESS' },
]);

let socket: WebSocket | null = null;

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  if (socket) socket.close();
});

function connectWebSocket() {
  try {
    socket = new WebSocket('ws://localhost:8765');
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      console.log('✅ 成功连接至本地 Agent WebSocket (ws://localhost:8765)');
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'observer.hello', client: 'web-frontend' }));
      }
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const buffer = event.data;
        const uint8 = new Uint8Array(buffer);
        let imageBytes = uint8;

        if (uint8.length > 30 && uint8[0] === 83 && uint8[1] === 77 && uint8[2] === 70 && uint8[3] === 82) {
          const view = new DataView(buffer);
          const taskIdLen = view.getUint32(22);
          const headerLen = 26 + taskIdLen + 4;
          imageBytes = uint8.subarray(headerLen);
        }

        const blob = new Blob([imageBytes], { type: 'image/jpeg' });
        if (frameSrc.value) {
          URL.revokeObjectURL(frameSrc.value);
        }
        frameSrc.value = URL.createObjectURL(blob);
      } else if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'url_changed' && msg.url) {
            currentUrl.value = msg.url;
            markRunningStepsAsSuccess();
          } else if (msg.type === 'human_intervention_required') {
            handleHumanInterventionRequired(msg);
          } else if (msg.type === 'waiting_approval_submit') {
            handleWaitingApprovalSubmit(msg);
          } else if (msg.type === 'task_result') {
            handleTaskResult(msg);
          }
        } catch {
          // ignore
        }
      }
    };

    socket.onclose = () => {
      setTimeout(connectWebSocket, 5000);
    };
  } catch (err) {
    console.error('WebSocket 初始化异常:', err);
  }
}

function markRunningStepsAsSuccess() {
  steps.value.forEach((step) => {
    if (step.status === 'RUNNING') {
      step.status = 'SUCCESS';
    }
  });
}

function handleHumanInterventionRequired(msg: any) {
  agentState.value = 'WAITING_HUMAN';
  const warningText = `⚠️ <strong>检测到目标站点触发了反爬/滑块验证码保护！</strong><br/>已自动为您将本地 Chromium 窗口弹出至最前台。<br/>请在弹出的原生浏览器中完成滑块验证/登录，完成后点击顶栏右侧的 <span style="background:#34a853;color:#fff;padding:2px 6px;border-radius:4px;">恢复 Agent</span> 按钮以继续自动化流程。`;
  if (chatPanelRef.value?.addAssistantReply) {
    chatPanelRef.value.addAssistantReply(warningText);
  }
  steps.value.push({
    action: `[反爬拦截] 检测到滑动验证码/登录保护，已弹出现场原生窗口，进入 WAITING_HUMAN 状态`,
    locator: `WAITING_HUMAN`,
    status: 'WAITING',
  });
}

function handleWaitingApprovalSubmit(msg: any) {
  markRunningStepsAsSuccess();
  agentState.value = 'WAITING_APPROVAL_SUBMIT';
  activeSubmissionId.value = msg.submissionId || `sub_${Date.now()}`;
  previewFormData.value = msg.formData || { title: '采购申请', amount: 50000 };
  submitPreviewVisible.value = true;

  steps.value.push({
    action: `[填报拦截] 准备提交表单数据，触发 WAITING_APPROVAL_SUBMIT 高危人工确认`,
    locator: `requestSubmitApproval()`,
    status: 'WAITING',
  });
}

function onSubmitApprove() {
  submitPreviewVisible.value = false;
  agentState.value = 'SUBMITTING';
  steps.value.push({
    action: `[用户授权] 已人工确认提交！发送授权指令，执行网页提交按钮点击`,
    status: 'RUNNING',
  });

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'submit_approval_result',
      approved: true,
      submissionId: activeSubmissionId.value,
    }));
  }
}

function onSubmitReject() {
  submitPreviewVisible.value = false;
  agentState.value = 'CANCELLED';
  isTaskRunning.value = false;
  steps.value.forEach((step) => {
    if (step.status === 'RUNNING' || step.status === 'WAITING') {
      step.status = 'FAILED';
    }
  });
  steps.value.push({
    action: `[用户拒绝] 用户拒绝了表单提交，取消当前填报任务`,
    status: 'FAILED',
  });

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'submit_approval_result',
      approved: false,
      submissionId: activeSubmissionId.value,
    }));
  }
}

function handleTaskResult(msg: any) {
  markRunningStepsAsSuccess();
  const items = msg.items || [];
  collectedCount.value = items.length;
  isTaskRunning.value = false; // 恢复任务运行标记

  let replyHtml = `<strong>🎉 任务完成！</strong>`;
  if (msg.mode === 'write') {
    replyHtml += `<br/>成功在目标表单填写并完成提交，提交回执凭证：<code>${activeSubmissionId.value || 'sub_success'}</code>`;
  } else {
    replyHtml += `成功提取到 ${items.length} 条数据：<ol style="margin-top:6px;padding-left:18px;">`;
    items.forEach((item: any) => {
      replyHtml += `<li style="margin-bottom:4px;"><strong>${escapeHtml(item.title)}</strong></li>`;
    });
    replyHtml += `</ol>`;
  }

  if (chatPanelRef.value?.addAssistantReply) {
    chatPanelRef.value.addAssistantReply(replyHtml);
  }

  steps.value.push({
    action: msg.mode === 'write' ? `成功完成自动化表单填报与提交` : `成功完成当次采集！提取出 ${items.length} 条项目数据`,
    status: 'SUCCESS',
  });
}


function escapeHtml(str: string): string {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function onPause() {
  agentState.value = 'PAUSED';
  steps.value.push({ action: 'Agent 控制权已手动暂停', status: 'WAITING' });
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'control', action: 'pause' }));
  }
}

function onTakeover() {
  agentState.value = 'HUMAN_CONTROL';
  steps.value.push({ action: '触发人工接管，准备将本地 Chromium 置顶切至前台', status: 'WAITING' });
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'control', action: 'takeover' }));
  } else {
    alert('已记录接管请求！');
  }
}

function onResume() {
  agentState.value = 'RUNNING';
  steps.value.push({ action: '手动恢复 Agent 控制权，重新探测页面并继续自动化', status: 'SUCCESS' });
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'control', action: 'resume' }));
  }
}

function onSendTask(taskText: string) {
  // 1. 强隔离：清空重置右侧步骤明细，只保留当次会话过程
  steps.value = [];

  const isWriteMode = taskText.includes('填') || taskText.includes('写') || taskText.includes('提交') || taskText.includes('fill');
  const taskMode = isWriteMode ? 'write' : 'read';

  const matchUrl = taskText.match(/https?:\/\/[^\s]+/);
  if (matchUrl) {
    currentUrl.value = matchUrl[0];
  } else if (isWriteMode && !taskText.includes('http')) {
    currentUrl.value = 'http://localhost:8080/fill-form.html';
  }

  // 2. 标记当前任务在运行中 (显示停止图标，禁用重复发送)
  isTaskRunning.value = true;

  steps.value.push({
    action: `[新会话] 接收自然语言<sup>${taskMode === 'write' ? '填报' : '采集'}</sup>指令: "${taskText}"`,
    status: 'RUNNING',
  });

  steps.value.push({
    action: `正在驱动可见 Chromium 导航至: ${currentUrl.value}`,
    locator: `page.goto("${currentUrl.value}")`,
    status: 'RUNNING',
  });

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'task',
      mode: taskMode,
      text: taskText,
      url: currentUrl.value,
      timestamp: Date.now()
    }));
  }
}

function onStopTask() {
  isTaskRunning.value = false;
  steps.value.push({
    action: `[用户操作] 已手动中断/停止当前任务`,
    status: 'FAILED',
  });
  if (chatPanelRef.value?.addAssistantReply) {
    chatPanelRef.value.addAssistantReply('⏹ 用户已手动停止当次自动化任务。');
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'control', action: 'stop' }));
  }
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
