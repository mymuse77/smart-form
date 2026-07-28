<template>
  <aside class="chat-panel">
    <div class="panel-header">
      <span>对话指引与任务草稿</span>
      <span v-if="isTaskRunning" class="running-tag">● 正在执行中</span>
    </div>
    <div class="messages" ref="msgContainer">
      <div v-for="(msg, idx) in messages" :key="idx" class="msg-bubble" :class="msg.role">
        <div class="sender">{{ msg.role === 'user' ? '用户' : 'Agent Assistant' }}</div>
        <div class="content" v-html="msg.text"></div>
      </div>
    </div>
    <div class="input-box">
      <input
        v-model="inputText"
        type="text"
        :disabled="isTaskRunning"
        :placeholder="isTaskRunning ? '任务正在执行中，请等待回复或点击停止...' : '描述需要采集的目标网站与字段...'"
        @keyup.enter="handleAction"
      />
      <button
        :class="{ 'btn-stop': isTaskRunning, 'btn-send': !isTaskRunning }"
        @click="handleAction"
      >
        <template v-if="isTaskRunning">
          <span class="icon-stop">■</span> 停止
        </template>
        <template v-else>
          发送
        </template>
      </button>
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
  { role: 'assistant', text: '你好！请在下方输入你想要采集的网站与目标字段。' },
]);

const inputText = ref('');
const msgContainer = ref<HTMLElement | null>(null);

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
  width: 290px;
  background: #ffffff;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
}
.panel-header {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.running-tag {
  font-size: 11px;
  color: #d93025;
  font-weight: normal;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
}
.messages {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg-bubble {
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 6px;
  line-height: 1.5;
}
.msg-bubble.assistant { background: #f0f0f0; color: #333; }
.msg-bubble.user { background: #1a1a1a; color: #fff; align-self: flex-end; }
.sender { font-size: 10px; margin-bottom: 2px; opacity: 0.7; }
.input-box {
  padding: 12px;
  border-top: 1px solid #e8e8e8;
  display: flex;
  gap: 8px;
}
.input-box input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 12px;
}
.input-box input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}
.input-box button {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s ease;
}
.btn-send {
  background: #1a1a1a;
  color: #fff;
}
.btn-send:hover {
  background: #333333;
}
.btn-stop {
  background: #d93025;
  color: #fff;
}
.btn-stop:hover {
  background: #b3261e;
}
.icon-stop {
  font-size: 10px;
}
</style>
