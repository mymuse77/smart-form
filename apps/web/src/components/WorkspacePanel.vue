<template>
  <main class="workspace-panel">
    <div class="url-bar">
      <span class="lock-icon">{{ currentUrl ? '🔒' : '🖥️' }}</span>
      <span class="url-text">{{ currentUrl || '任务执行区 (待机中)' }}</span>
      <span class="read-only-tag">{{ currentUrl ? '只读视图（安全隔离）' : 'Agent 就绪' }}</span>
    </div>
    <div class="screen-viewport">
      <!-- 发送任务后立刻切入实时画面视口 -->
      <template v-if="hasStartedTask">
        <img v-if="frameSrc" :src="frameSrc" class="screencast-img" alt="Live Screenshot Stream" />
        <div v-else class="stream-loading-placeholder">
          <div class="spinner"></div>
          <p>正在驱动可见 Chromium 导航并建立 2~5 FPS 画面推送...</p>
        </div>
      </template>
      
      <!-- 仅在未下发任务的初始待机状态展示此看板 -->
      <div v-else class="idle-standby-container">
        <div class="idle-card">
          <div class="agent-icon-wrapper">
            <span class="agent-pulse-icon">⚡</span>
          </div>
          <h3 class="idle-title">智能表单 Agent 任务执行区</h3>
          <p class="idle-sub">等待在左侧对话框中下发采集（Read）或填报（Write）指令</p>
          <div class="feature-badges">
            <span class="badge-item">🔒 原生 Profile 隔离</span>
            <span class="badge-item">👁️ 2~5 FPS 实时双向流</span>
            <span class="badge-item">🛡️ 提交高危二步授权</span>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
defineProps<{
  currentUrl?: string;
  frameSrc?: string;
  hasStartedTask?: boolean;
}>();
</script>

<style scoped>
.workspace-panel {
  flex: 1;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
}
.url-bar {
  height: 38px;
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 8px;
  font-size: 13px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.url-text {
  flex: 1;
  color: #1e293b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.read-only-tag {
  font-size: 11px;
  background: #f1f5f9;
  padding: 3px 8px;
  border-radius: 12px;
  color: #64748b;
  font-weight: 600;
}
.screen-viewport {
  flex: 1;
  background: #0f172a;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1px solid #1e293b;
}
.screencast-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}

/* 建立连接时的加载占位 */
.stream-loading-placeholder {
  color: #94a3b8;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.spinner {
  width: 26px;
  height: 26px;
  border: 2px solid #334155;
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 待机任务执行区卡片样式 */
.idle-standby-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
  padding: 20px;
}
.idle-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 420px;
  z-index: 1;
}
.agent-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #1e293b;
  border: 1.5px solid #38bdf8;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
}
.agent-pulse-icon {
  font-size: 24px;
  animation: pulse-glow 2s infinite ease-in-out;
}
@keyframes pulse-glow {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.15); opacity: 1; }
}
.idle-title {
  font-size: 17px;
  font-weight: 700;
  color: #f8fafc;
  margin-bottom: 8px;
  letter-spacing: 0.3px;
}
.idle-sub {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
  margin-bottom: 20px;
}
.feature-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.badge-item {
  font-size: 10px;
  background: #1e293b;
  color: #cbd5e1;
  border: 1px solid #334155;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
}
</style>


