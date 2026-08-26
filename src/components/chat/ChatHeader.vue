<script setup>
import { ref, nextTick } from 'vue'
import { GitCompare, ListTodo, MessageSquareText, Download, Eraser } from 'lucide-vue-next'
import { Modal, message } from 'ant-design-vue'
import { updateSession } from '../../sessions.js'

const props = defineProps({
  activeSession: { type: Object, default: null },
  projectId: { type: String, default: '' },
  showChanges: { type: Boolean, default: false },
  showTodos: { type: Boolean, default: false },
})
const emit = defineEmits(['open-log', 'update:show-changes', 'update:show-todos', 'clear-chat'])

const editingTitle = ref(false)
const titleDraft = ref('')

function startRenameTitle() {
  if (!props.activeSession) return
  titleDraft.value = props.activeSession.title || '新对话'
  editingTitle.value = true
  nextTick(() => {
    const el = document.querySelector('.chat__titlebar-input')
    if (el) {
      el.focus()
      el.select()
    }
  })
}
async function commitRename() {
  if (!editingTitle.value) return
  const s = props.activeSession
  const next = titleDraft.value.trim() || '新对话'
  editingTitle.value = false
  if (s && s.title !== next) {
    s.title = next
    try {
      await updateSession(s.id, { title: next })
    } catch (e) {
      console.error('重命名失败:', e)
    }
  }
}
function cancelRename() {
  editingTitle.value = false
}

// #5 导出对话：纯前端生成 MD / JSON 并下载
function plainContent(m) {
  if (Array.isArray(m.content)) {
    return m.content.map((p) => (p.type === 'text' ? p.text : p.type === 'image_url' ? '[图片]' : '')).join('')
  }
  return m.content || ''
}
function exportChat(format) {
  const s = props.activeSession
  if (!s) return
  if (format === 'json') {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `${s.title || 'chat'}.json`)
  } else {
    const lines = [`# ${s.title || '对话导出'}`, '', `> 导出时间：${new Date().toLocaleString()}`, '']
    for (const m of s.messages) {
      const role = m.role === 'user' ? '用户' : '助手'
      lines.push(`## ${role}`, '', plainContent(m), '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    downloadBlob(blob, `${s.title || 'chat'}.md`)
  }
  message.success('已导出')
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// #5 清空对话
function clearChat() {
  const s = props.activeSession
  if (!s) return
  Modal.confirm({
    title: '清空当前对话？',
    content: '将删除该会话下的全部消息（文件变更不会被回退），此操作不可撤销。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => emit('clear-chat', s.id),
  })
}
</script>

<template>
  <div v-if="activeSession" class="chat__titlebar">
    <input
      v-if="editingTitle"
      v-model="titleDraft"
      class="chat__titlebar-input"
      :maxlength="60"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />
    <span
      v-else
      class="chat__titlebar-text"
      title="双击修改会话名称"
      @dblclick="startRenameTitle"
    >{{ activeSession.title || '新对话' }}</span>
    <a-button
      class="chat__head-btn"
      size="small"
      title="查看文件变更"
      :type="showChanges ? 'primary' : 'default'"
      @click="emit('update:show-changes', !showChanges)"
    >
      <template #icon><GitCompare :size="14" /></template>
    </a-button>
    <a-button
      class="chat__head-btn"
      size="small"
      title="任务清单"
      :type="showTodos ? 'primary' : 'default'"
      @click="emit('update:show-todos', !showTodos)"
    >
      <template #icon><ListTodo :size="14" /></template>
    </a-button>
    <a-button
      class="chat__head-btn"
      size="small"
      title="对话日志"
      @click="emit('open-log')"
    >
      <template #icon><MessageSquareText :size="14" /></template>
    </a-button>
    <a-dropdown>
      <a-button class="chat__head-btn" size="small" title="导出对话">
        <template #icon><Download :size="14" /></template>
      </a-button>
      <template #overlay>
        <a-menu>
          <a-menu-item key="md" @click="exportChat('md')">导出为 Markdown</a-menu-item>
          <a-menu-item key="json" @click="exportChat('json')">导出为 JSON</a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
    <a-button
      class="chat__head-btn"
      size="small"
      title="清空对话"
      @click="clearChat"
    >
      <template #icon><Eraser :size="14" /></template>
    </a-button>
  </div>
</template>

<style scoped lang="less">
.chat__titlebar {
  padding: 12px 24px 0;
  display: flex;
  align-items: center;
  min-height: 40px;
  flex-shrink: 0;
}
.chat__head-btn {
  margin-left: 8px;
}
.chat__head-btn:first-of-type {
  margin-left: auto;
}
.chat__titlebar-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  padding: 5px 10px;
  border-radius: 6px;
  cursor: text;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;
}
.chat__titlebar-text:hover {
  background: var(--color-bg-subtle);
  border-color: var(--color-border);
}
.chat__titlebar-input {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  padding: 5px 10px;
  border: 1px solid var(--brand);
  border-radius: 6px;
  outline: none;
  background: var(--color-bg-input, #fff);
  width: 100%;
  max-width: 480px;
  font-family: inherit;
}
.chat__titlebar-input:focus {
  box-shadow: 0 0 0 2px var(--color-border-focus, #bfdbfe);
}
</style>
