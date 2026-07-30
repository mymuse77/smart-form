<template>
  <div v-if="visible" class="submit-preview-overlay">
    <div class="submit-preview-modal">
      <div class="modal-header">
        <div class="danger-tag">⚠️ WAITING_APPROVAL_SUBMIT</div>
        <h3>填报任务提交确认</h3>
      </div>
      <div class="modal-body">
        <p class="warning-text">即将向目标系统发送最终表单提交数据，此操作不可逆！</p>
        <div class="info-group">
          <label>目标 URL：</label>
          <span>{{ targetUrl }}</span>
        </div>
        <div class="info-group">
          <label>Submission ID：</label>
          <span class="code">{{ submissionId }}</span>
        </div>

        <div class="mapping-preview-table">
          <h4>数据填充核对明细 (Profile → Target)</h4>
          <table>
            <thead>
              <tr>
                <th>目标字段</th>
                <th>填充值</th>
                <th>敏感状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(val, key) in formData" :key="key">
                <td>{{ key }}</td>
                <td>{{ val }}</td>
                <td>
                  <span class="safe-badge">普通</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="onReject">拒绝/终止提交</button>
        <button
          class="btn-confirm-danger"
          :class="{ armed: confirmStep === 1 }"
          @click="onConfirm"
        >
          {{ confirmStep === 0 ? '确认提交' : '再次点击以授权发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  visible: boolean;
  targetUrl: string;
  submissionId: string;
  formData: Record<string, unknown>;
}>();

const emit = defineEmits(['approve', 'reject']);

const confirmStep = ref(0);

function onConfirm() {
  if (confirmStep.value === 0) {
    confirmStep.value = 1;
    setTimeout(() => {
      confirmStep.value = 0;
    }, 4000);
  } else {
    emit('approve');
    confirmStep.value = 0;
  }
}

function onReject() {
  emit('reject');
  confirmStep.value = 0;
}
</script>

<style scoped>
.submit-preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.submit-preview-modal {
  width: 520px;
  background: #1e1e2d;
  color: #fff;
  border-radius: 12px;
  border: 1px solid #f59e0b;
  box-shadow: 0 12px 32px rgba(245, 158, 11, 0.3);
  padding: 20px;
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.danger-tag {
  background: #f59e0b;
  color: #1e1e2d;
  font-size: 11px;
  font-weight: bold;
  padding: 3px 8px;
  border-radius: 4px;
}
.modal-header h3 {
  font-size: 16px;
  color: #fff;
}
.warning-text {
  color: #fbbf24;
  font-size: 13px;
  margin-bottom: 14px;
}
.info-group {
  display: flex;
  font-size: 13px;
  margin-bottom: 6px;
}
.info-group label {
  color: #a1a5b7;
  width: 120px;
}
.code {
  font-family: monospace;
  color: #4fc3f7;
}
.mapping-preview-table {
  margin-top: 14px;
  background: #151521;
  padding: 12px;
  border-radius: 8px;
}
.mapping-preview-table h4 {
  font-size: 12px;
  color: #a1a5b7;
  margin-bottom: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th, td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid #2b2b40;
}
th {
  color: #80809e;
}
.safe-badge {
  background: #1b3bbb;
  color: #80d8ff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.btn-cancel {
  background: #2b2b40;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}
.btn-confirm-danger {
  background: #f59e0b;
  color: #1e1e2d;
  border: none;
  padding: 8px 18px;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-confirm-danger.armed {
  background: #d97706;
  color: #ffffff;
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.03); }
  100% { transform: scale(1); }
}
</style>
