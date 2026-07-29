<template>
  <aside class="chat-panel">
    <div class="panel-header">
      <span class="header-title">💬 Agent 智能对话助手</span>
      <span v-if="isTaskRunning" class="running-tag">● 正在执行中</span>
    </div>
    
    <div class="messages" ref="msgContainer">
      <div v-for="(msg, idx) in messages" :key="idx" class="msg-bubble" :class="msg.role">
        <div class="sender">{{ msg.role === 'user' ? '用户' : 'Agent Assistant' }}</div>
        <div class="content" v-html="msg.text"></div>
      </div>
    </div>

    <div class="preset-section">
      <div class="preset-title">💡 快捷演示指令 (点击一键尝试)：</div>
      <div class="preset-pills">
        <button
          class="pill pill-fill"
          :disabled="isTaskRunning"
          @click="usePreset('请使用标准采购数据源，帮我填报 http://localhost:8080/fill-form.html')"
        >
          ✍️ 填报示例 (测试靶场)
        </button>
        <button
          class="pill pill-read"
          :disabled="isTaskRunning"
          @click="usePreset('请帮我采集 http://localhost:8080/table.html 中的所有采购项目与预算金额')"
        >
          🔍 采集示例 (测试靶场)
        </button>
      </div>
    </div>

    <!-- 现代 ChatGPT 风格大对话框输入区 -->
    <div class="input-card-box">
      <textarea
        v-model="inputText"
        rows="3"
        :disabled="isTaskRunning"
        :placeholder="isTaskRunning ? '任务正在执行中，请等待回复或点击停止...' : '描述需要采集或填报的目标网站与数据...\n(Enter 发送，Shift + Enter 换行)'"
        @keydown="handleKeydown"
      ></textarea>
      <div class="input-bottom-bar">
        <span class="hint-text">Enter 发送 / Shift+Enter 换行</span>
        <button
          :class="{ 'btn-stop': isTaskRunning, 'btn-send': !isTaskRunning }"
          :disabled="!isTaskRunning && !inputText.trim()"
          @click="handleAction"
        >
          <template v-if="isTaskRunning">
            <span class="icon-stop">■</span> 停止执行
          </template>
          <template v-else>
            发送指令 ➔
          </template>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

export interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const props = defineProps<{
  isTaskRunning?: boolean;
}>();

const emit = defineEmits(['send-task', 'stop-task']);

const messages = ref<Message[]>([
  { role: 'assistant', text: '你好！请在下方描述您想要采集的网站、目标字段或需要填报的数据。' },
]);

const inputText = ref('');
const msgContainer = ref<HTMLElement | null>(null);

function usePreset(prompt: string) {
  if (props.isTaskRunning) return;
  inputText.value = prompt;
  send();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAction();
  }
}

function handleAction() {
  if (props.isTaskRunning) {
    emit('stop-task');
  } else {
    send();
  }
}

function send() {
  if (!inputText.value.trim()) return;
  messages.value.push({ role: 'user', text: inputText.value });
  emit('send-task', inputText.value);
  inputText.value = '';
  scrollToBottom();
}

function addAssistantReply(text: string) {
  messages.value.push({ role: 'assistant', text });
  scrollToBottom();
}

function scrollToBottom() {
  nextTick(() => {
    if (msgContainer.value) {
      msgContainer.value.scrollTop = msgContainer.value.scrollHeight;
    }
  });
}

defineExpose({
  addAssistantReply,
});
</script>

<style scoped>
.chat-panel {
  width: 320px;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
}
.panel-header {
  padding: 14px 16px;
  font-size: 13px;
  font-weight: 700;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #0f172a;
}
.header-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.running-tag {
  font-size: 11px;
  color: #ef4444;
  font-weight: 600;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
}
.messages {
  flex: 1;
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg-bubble {
  font-size: 13px;
  padding: 10px 14px;
  border-radius: 10px;
  line-height: 1.55;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.msg-bubble.assistant {
  background: #f1f5f9;
  color: #1e293b;
  border: 1px solid #e2e8f0;
}
.msg-bubble.user {
  background: #0f172a;
  color: #f8fafc;
  align-self: flex-end;
  max-width: 90%;
}
.sender {
  font-size: 10px;
  margin-bottom: 4px;
  opacity: 0.65;
  font-weight: 600;
}

.preset-section {
  padding: 10px 14px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
}
.preset-title {
  font-size: 11px;
  color: #64748b;
  margin-bottom: 8px;
  font-weight: 600;
}
.preset-pills {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pill {
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 11px;
  text-align: left;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  background: #fff;
  transition: all 0.2s ease;
  font-weight: 500;
}
.pill:hover:not(:disabled) {
  border-color: #0f172a;
  background: #f1f5f9;
  transform: translateY(-1px);
}
.pill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pill-fill {
  color: #b91c1c;
}
.pill-read {
  color: #1d4ed8;
}

/* ChatGPT 风格卡片大文本对话框 */
.input-card-box {
  padding: 12px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-card-box textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: all 0.2s ease;
  background: #fafafa;
}
.input-card-box textarea:focus {
  border-color: #0f172a;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08);
}
.input-card-box textarea:disabled {
  background: #f1f5f9;
  cursor: not-allowed;
  color: #94a3b8;
}

.input-bottom-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.hint-text {
  font-size: 10px;
  color: #94a3b8;
}
.input-bottom-bar button {
  padding: 7px 14px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s ease;
}
.input-bottom-bar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-send {
  background: #0f172a;
  color: #ffffff;
}
.btn-send:hover:not(:disabled) {
  background: #1e293b;
  transform: translateY(-1px);
}
.btn-stop {
  background: #ef4444;
  color: #ffffff;
}
.btn-stop:hover:not(:disabled) {
  background: #dc2626;
}
.icon-stop {
  font-size: 10px;
}
</style>


