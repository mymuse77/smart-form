<template>
  <footer class="bottom-bar">
    <div class="stat-item">已采集: <strong>{{ collectedCount }}</strong> 条</div>
    <div class="stat-divider">|</div>
    <div class="stat-item">错误: <strong class="error-count">{{ errorCount }}</strong> 条</div>
    <div class="stat-divider">|</div>
    <div class="stat-item">模式: <span class="mode-tag">本地隐私隔离模式 (CDP 127.0.0.1)</span></div>
    <div class="right-info">
      <span>运行时长: {{ runtimeStr }}</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
defineProps<{
  collectedCount: number;
  errorCount: number;
  runtimeStr: string;
}>();
</script>

<style scoped>
.bottom-bar {
  height: 36px;
  background-color: #e8e8e8;
  border-top: 1px solid #d0d0d0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  font-size: 12px;
  color: #5f6368;
  user-select: none;
}
.stat-item strong { color: #1a1a1a; }
.error-count { color: #ea4335; }
.stat-divider { color: #bbb; }
.mode-tag { background: #fff; padding: 2px 6px; border-radius: 4px; border: 1px solid #ccc; font-size: 11px; }
.right-info { margin-left: auto; }
</style>
