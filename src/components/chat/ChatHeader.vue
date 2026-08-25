<script setup>
import { ref, nextTick, computed } from 'vue'
import { GitCompare, ListTodo, MessageSquareText } from 'lucide-vue-next'
import { updateSession } from '../../sessions.js'

const props = defineProps({
  activeSession: { type: Object, default: null },
  projectId: { type: String, default: '' },
  showChanges: { type: Boolean, default: false },
  showTodos: { type: Boolean, default: false },
})
const emit = defineEmits(['open-log', 'update:show-changes', 'update:show-todos'])

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
  color: #1f2937;
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
  background: #f1f5f9;
  border-color: #e2e8f0;
}
.chat__titlebar-input {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  padding: 5px 10px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  outline: none;
  background: #fff;
  width: 100%;
  max-width: 480px;
  font-family: inherit;
}
.chat__titlebar-input:focus {
  box-shadow: 0 0 0 2px #bfdbfe;
}
</style>
