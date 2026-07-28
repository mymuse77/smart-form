<template>
  <aside class="chat-panel">
    <div class="panel-header">对话指引与任务草稿</div>
    <div class="messages">
      <div v-for="(msg, idx) in messages" :key="idx" class="msg-bubble" :class="msg.role">
        <div class="sender">{{ msg.role === 'user' ? '用户' : 'Agent Assistant' }}</div>
        <div class="content">{{ msg.text }}</div>
      </div>
    </div>
    <div class="input-box">
      <input
        v-model="inputText"
        type="text"
        placeholder="描述需要采集的目标网站与字段..."
        @keyup.enter="send"
      />
      <button @click="send">发送</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const messages = ref<Message[]>([
  { role: 'assistant', text: '你好！请在下方输入你想要采集的网站与目标字段。' },
]);

const inputText = ref('');

const emit = defineEmits(['send-task']);

function send() {
  if (!inputText.value.trim()) return;
  messages.value.push({ role: 'user', text: inputText.value });
  emit('send-task', inputText.value);
  inputText.value = '';
}
</script>

<style scoped>
.chat-panel {
  width: 280px;
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
  line-height: 1.4;
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
.input-box button {
  padding: 6px 12px;
  background: #1a1a1a;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
</style>
