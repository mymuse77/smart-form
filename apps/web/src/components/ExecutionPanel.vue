<template>
  <aside class="execution-panel">
    <div class="panel-header">执行过程与步骤明细</div>
    <div class="steps-list">
      <div v-for="(step, idx) in steps" :key="idx" class="step-card">
        <div class="step-header">
          <span class="step-num">Step #{{ idx + 1 }}</span>
          <!-- 紧跟在 Step 后面的中文美化 Badge -->
          <span class="status-badge" :class="step.status">
            <template v-if="step.status === 'SUCCESS'">✓ 已完成</template>
            <template v-else-if="step.status === 'RUNNING'">
              <span class="spinner-dot"></span> 执行中
            </template>
            <template v-else-if="step.status === 'WAITING'">⏳ 等待接管</template>
            <template v-else-if="step.status === 'FAILED'">✕ 失败</template>
          </span>
        </div>
        <div class="action-desc" v-html="step.action"></div>
        <div v-if="step.locator" class="locator-code">
          <code>{{ step.locator }}</code>
        </div>
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
  color: #1f2937;
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
  padding: 10px 12px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 12px;
  background: #fafafa;
  transition: all 0.2s ease;
}
.step-card:hover {
  background: #ffffff;
  border-color: #d1d5db;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}
.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.step-num {
  font-weight: 700;
  color: #111827;
  font-size: 12px;
}

/* 中文美化 Badge 样式 */
.status-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.status-badge.SUCCESS {
  background: #e6f4ea;
  color: #137333;
  border: 1px solid #ceead6;
}
.status-badge.RUNNING {
  background: #fef7e0;
  color: #b06000;
  border: 1px solid #feefc3;
}
.status-badge.WAITING {
  background: #e8f0fe;
  color: #1a73e8;
  border: 1px solid #d2e3fc;
}
.status-badge.FAILED {
  background: #fce8e6;
  color: #c5221f;
  border: 1px solid #fad2cf;
}

/* 执行中 Spinner 动画 */
.spinner-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b06000;
  display: inline-block;
  animation: blink 1s infinite alternate;
}
@keyframes blink {
  from { opacity: 0.2; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1.2); }
}

.action-desc {
  color: #1f2937;
  line-height: 1.5;
  margin-bottom: 6px;
  word-break: break-word;
}
.locator-code {
  background: #111827;
  color: #e5e7eb;
  padding: 4px 8px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  margin-top: 4px;
  overflow-x: auto;
}
.locator-code code {
  color: #38bdf8;
}
.empty-hint {
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
  margin-top: 40px;
}
</style>

