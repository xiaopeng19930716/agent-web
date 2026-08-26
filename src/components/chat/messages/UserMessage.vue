<script setup>
import { h } from 'vue'
import { Undo2, User } from 'lucide-vue-next'
import { Modal } from 'ant-design-vue'

const props = defineProps({
  message: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
})
const emit = defineEmits(['rollback'])

function onRollback() {
  if (props.readonly) return
  Modal.confirm({
    title: '确认回退到此用户消息？',
    content: '将删除该消息之后的所有对话内容，且不可撤销。',
    okText: '回退',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => emit('rollback', props.message),
  })
}

function previewImage(src) {
  Modal.info({
    title: '图片预览',
    width: 720,
    icon: null,
    maskClosable: true,
    class: 'img-preview-modal',
    content: h('img', { src, style: 'max-width:100%;border-radius:10px;display:block;margin:0 auto;' }),
  })
}
</script>

<template>
  <div class="msg msg--user">
    <div class="bubble bubble--user">
      <div class="bubble__avatar bubble__avatar--user" aria-hidden="true"><User :size="14" /></div>
      <div class="bubble__text">
        <template v-if="Array.isArray(message.content)">
          <template v-for="(part, pi) in message.content" :key="pi">
            <span v-if="part.type === 'text'">{{ part.text }}</span>
            <img
              v-else-if="part.type === 'image_url'"
              class="bubble__img"
              :src="part.image_url.url"
              alt="图片"
              @click="previewImage(part.image_url.url)"
            />
          </template>
        </template>
        <template v-else-if="message.tags && message.tags.length">
          <template v-for="(t, ti) in message.tags" :key="ti">
            <span v-if="t.type === 'text'">{{ t.text }}</span>
            <span
              v-else
              class="token-chip"
              :class="`token-chip--${t.kind}`"
            >{{ t.kind === 'mcp' ? '⌘/' : (t.kind === 'skill' ? '/' : (t.kind === 'tool' ? '/' : '@')) }}{{ t.label }}</span>
          </template>
        </template>
        <template v-else>{{ message.content }}</template>
      </div>
    </div>
    <div v-if="!readonly" class="msg__actions msg__actions--user">
      <button
        class="msg__action"
        type="button"
        title="回退到此处：删除此消息及其之后内容，并将原文填入输入框"
        aria-label="回退到此处"
        @click="onRollback"
      >
        <Undo2 :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './messageBase.less';
</style>
