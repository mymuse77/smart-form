<template>
  <div class="app-layout">
    <TopBar
      :agent-state="agentState"
      @pause="onPause"
      @takeover="onTakeover"
      @resume="onResume"
    />
    <div class="main-body">
      <ChatPanel @send-task="onSendTask" />
      <WorkspacePanel :current-url="currentUrl" :frame-src="frameSrc" />
      <ExecutionPanel :steps="steps" />
    </div>
    <BottomBar
      :collected-count="collectedCount"
      :error-count="errorCount"
      :runtime-str="runtimeStr"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TopBar from './components/TopBar.vue';
import ChatPanel from './components/ChatPanel.vue';
import WorkspacePanel from './components/WorkspacePanel.vue';
import ExecutionPanel, { ExecutionStep } from './components/ExecutionPanel.vue';
import BottomBar from './components/BottomBar.vue';

const agentState = ref('RUNNING');
const currentUrl = ref('http://localhost:8080/table.html');
const frameSrc = ref('');
const collectedCount = ref(4);
const errorCount = ref(0);
const runtimeStr = ref('00:02:15');

const steps = ref<ExecutionStep[]>([
  { action: '连接本地 Chromium 独立 Profile 成功', status: 'SUCCESS' },
  { action: '导航至测试靶场页 http://localhost:8080/table.html', locator: 'page.goto(...)', status: 'SUCCESS' },
  { action: '提取表格行项目：PRJ-2026-001 ~ PRJ-2026-004 (4条)', locator: 'getByRole("row")', status: 'SUCCESS' },
]);

function onPause() {
  agentState.value = 'PAUSED';
}

function onTakeover() {
  agentState.value = 'HUMAN_CONTROL';
  alert('已触发本地浏览器切前台，请在原生窗口中完成接管操作。');
}

function onResume() {
  agentState.value = 'RUNNING';
}

function onSendTask(taskText: string) {
  steps.value.push({
    action: `收到新任务指令: "${taskText}"`,
    status: 'RUNNING',
  });
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
