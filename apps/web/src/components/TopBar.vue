<template>
  <header class="top-bar">
    <div class="brand">
      <span class="logo-icon">⚡</span>
      <span class="title">Smart-Form 智能采集平台</span>
    </div>
    <div class="task-info">
      <span class="badge mode">采集模式 (READ)</span>
      <span class="badge device">设备: Local Agent #01</span>
      <span class="badge status" :class="agentState.toLowerCase()">{{ agentState }}</span>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" @click="$emit('pause')">暂停 Agent</button>
      <button class="btn btn-primary" @click="$emit('takeover')">打开本地浏览器接管</button>
      <button class="btn btn-success" @click="$emit('resume')">恢复 Agent</button>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  agentState: string;
}>();

defineEmits(['pause', 'takeover', 'resume']);
</script>

<style scoped>
.top-bar {
  height: 48px;
  background-color: #1a1a1a;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-family: system-ui, sans-serif;
  user-select: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}
.task-info {
  display: flex;
  gap: 12px;
}
.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #333;
}
.badge.status {
  background: #34a853;
  color: #fff;
}
.actions {
  display: flex;
  gap: 8px;
}
.btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: none;
  font-weight: 500;
}
.btn-primary { background: #ffffff; color: #1a1a1a; }
.btn-secondary { background: #333333; color: #ffffff; }
.btn-success { background: #34a853; color: #ffffff; }
</style>
