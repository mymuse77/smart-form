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
import { ref, onMounted, onUnmounted } from 'vue';
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

let socket: WebSocket | null = null;

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  if (socket) {
    socket.close();
  }
});

function connectWebSocket() {
  try {
    socket = new WebSocket('ws://localhost:8765');
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      console.log('✅ 成功连接至本地 Agent 截图流与事件 WebSocket 服务 (ws://localhost:8765)');
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'observer.hello', client: 'web-frontend' }));
      }
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // 二进制截图帧解析：剥离 26 字节 Header 得到 Raw Image Bytes，或直接作为 JPEG/WebP 渲染
        const buffer = event.data;
        // 如果数据包含 SMFR 魔法头，则尝试寻找 Image 偏移量；否则直接转 Blob
        const uint8 = new Uint8Array(buffer);
        let imageBytes = uint8;

        // 检查 SMFR (83, 77, 70, 82) 魔法字头
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
          if (msg.url) currentUrl.value = msg.url;
        } catch {
          // ignore
        }
      }
    };

    socket.onerror = (err) => {
      console.warn('⚠ WebSocket 握手尝试未连通 (请确保 Agent 后台进程正在运行):', err);
    };

    socket.onclose = () => {
      // 5 秒重连机制
      setTimeout(connectWebSocket, 5000);
    };
  } catch (err) {
    console.error('WebSocket 初始化异常:', err);
  }
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
    alert('已记录接管请求！在本地 Agent 完整运行模式下，系统将自动通过 Win32 API 聚焦前台窗口。');
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
  // 解析用户输入的目标 URL（若有）
  const matchUrl = taskText.match(/https?:\/\/[^\s]+/);
  if (matchUrl) {
    currentUrl.value = matchUrl[0];
  }

  steps.value.push({
    action: `下发新自然语言指令: "${taskText}"`,
    status: 'RUNNING',
  });

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'task',
      text: taskText,
      url: currentUrl.value,
      timestamp: Date.now()
    }));
  }

  // 模拟 Agent 分析并产生动作
  setTimeout(() => {
    steps.value.push({
      action: `AI 分析完成，匹配表格提取定位器: getByRole("table") -> 包含 4 行项目`,
      locator: 'page.getByRole("table")',
      status: 'SUCCESS',
    });
    collectedCount.value = 4;
  }, 1200);
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
