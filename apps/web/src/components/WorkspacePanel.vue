<template>
  <main class="workspace-panel">
    <div class="url-bar">
      <span class="lock-icon">🔒</span>
      <span class="url-text">{{ currentUrl || 'https://example.com' }}</span>
      <span class="read-only-tag">只读视图（安全注入隔离）</span>
    </div>
    <div class="screen-viewport">
      <img v-if="frameSrc" :src="frameSrc" class="screencast-img" alt="Live Screenshot Stream" />
      <div v-else class="placeholder">
        <div class="spinner"></div>
        <p>等待本地 Chromium 截图流传输 (2～5 FPS WebSocket BinStream)...</p>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
defineProps<{
  currentUrl?: string;
  frameSrc?: string;
}>();
</script>

<style scoped>
.workspace-panel {
  flex: 1;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
}
.url-bar {
  height: 36px;
  background: #ffffff;
  border-radius: 6px;
  border: 1px solid #e8e8e8;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 8px;
  font-size: 13px;
}
.url-text {
  flex: 1;
  color: #333;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.read-only-tag {
  font-size: 11px;
  background: #e8e8e8;
  padding: 2px 6px;
  border-radius: 4px;
  color: #666;
}
.screen-viewport {
  flex: 1;
  background: #000000;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.screencast-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none; /* 强行防护禁用点击事件传递 */
}
.placeholder {
  color: #888;
  font-size: 13px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #555;
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
