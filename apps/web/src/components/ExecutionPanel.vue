<template>
  <aside class="execution-panel">
    <div class="panel-header">执行过程与步骤明细</div>
    <div class="steps-list">
      <div v-for="(step, idx) in steps" :key="idx" class="step-card">
        <div class="step-num">Step #{{ idx + 1 }}</div>
        <div class="action-desc">{{ step.action }}</div>
        <div v-if="step.locator" class="locator-code"><code>{{ step.locator }}</code></div>
        <div class="step-status" :class="step.status">{{ step.status }}</div>
      </div>
      <div v-if="steps.length === 0" class="empty-hint">暂无执行步骤，请在左侧发起任务</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
export interface ExecutionStep {
  action: string;
  locator?: string;
  status: 'RUNNING' | 'SUCCESS' | 'WAITING' | 'FAILED';
}

defineProps<{
  steps: ExecutionStep[];
}>();
</script>

<style scoped>
.execution-panel {
  width: 320px;
  background: #ffffff;
  border-left: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
}
.panel-header {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}
.steps-list {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step-card {
  padding: 10px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 12px;
  background: #fafafa;
}
.step-num { font-weight: 600; color: #555; margin-bottom: 4px; }
.action-desc { color: #1a1a1a; margin-bottom: 6px; }
.locator-code { background: #eee; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; margin-bottom: 6px; }
.step-status { font-size: 11px; font-weight: 600; display: inline-block; }
.step-status.SUCCESS { color: #34a853; }
.step-status.RUNNING { color: #fbbc04; }
.empty-hint { color: #999; font-size: 12px; text-align: center; margin-top: 40px; }
</style>
