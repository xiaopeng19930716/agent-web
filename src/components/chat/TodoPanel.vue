<script setup>
import { computed } from 'vue'
import { Check, Square, Loader, X, ListTodo } from 'lucide-vue-next'
import { updateSession } from '../../sessions.js'

const props = defineProps({
  session: { type: Object, default: null },
})

// 任务清单（来自后端 todoWrite 写入的 session.todos）
const todos = computed(() => (props.session && Array.isArray(props.session.todos) ? props.session.todos : []))

const total = computed(() => todos.value.length)
const doneCount = computed(() => todos.value.filter((t) => t.status === 'completed').length)
const progress = computed(() => (total.value ? Math.round((doneCount.value / total.value) * 100) : 0))

// 用户手动切换某项状态（completed <-> pending），并异步持久化到后端
async function toggle(item) {
  if (item.status === 'completed') item.status = 'pending'
  else if (item.status === 'pending') item.status = 'completed'
  else return // in_progress / cancelled 不响应手动勾选
  if (props.session) {
    try {
      await updateSession(props.session.id, { todos: todos.value })
    } catch (e) {
      console.warn('TodoPanel 持久化失败', e)
    }
  }
}

const STATUS_LABEL = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}
</script>

<template>
  <aside class="todo">
    <div class="todo__head">
      <span class="todo__title"><ListTodo :size="14" /> 任务清单</span>
      <span class="todo__progress">{{ doneCount }}/{{ total }} · {{ progress }}%</span>
    </div>
    <div v-if="total === 0" class="todo__empty">模型尚未创建任务清单。复杂任务中它会自动列出计划并逐步勾选。</div>
    <ul v-else class="todo__list">
      <li
        v-for="(t, i) in todos"
        :key="i"
        class="todo__item"
        :class="'todo__item--' + t.status"
        @click="toggle(t)"
      >
        <span class="todo__check">
          <Check v-if="t.status === 'completed'" :size="13" />
          <Loader v-else-if="t.status === 'in_progress'" :size="13" class="todo__spin" />
          <X v-else-if="t.status === 'cancelled'" :size="13" />
          <Square v-else :size="13" />
        </span>
        <span class="todo__content">
          <span class="todo__text">{{ t.content }}</span>
          <span v-if="t.status === 'in_progress' && t.activeForm" class="todo__active">{{ t.activeForm }}</span>
        </span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.todo {
  width: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border, #e5e7eb);
  background: var(--color-bg, #fff);
  min-height: 0;
}
.todo__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.todo__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.todo__progress {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
}
.todo__empty {
  padding: 16px 12px;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.6;
}
.todo__list {
  list-style: none;
  margin: 0;
  padding: 6px 0;
  overflow: auto;
  flex: 1;
}
.todo__item {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  align-items: flex-start;
  border-bottom: 1px solid rgba(0, 0, 0, 0.03);
}
.todo__item:hover {
  background: rgba(0, 0, 0, 0.03);
}
.todo__item--completed .todo__text {
  color: #9ca3af;
  text-decoration: line-through;
}
.todo__item--in_progress {
  background: rgba(59, 130, 246, 0.06);
}
.todo__item--cancelled .todo__text {
  color: #c4c4c4;
  text-decoration: line-through;
}
.todo__check {
  flex-shrink: 0;
  margin-top: 1px;
  color: #6b7280;
}
.todo__item--completed .todo__check {
  color: #16a34a;
}
.todo__item--in_progress .todo__check {
  color: #2563eb;
}
.todo__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  line-height: 1.5;
  color: #1f2937;
}
.todo__active {
  font-size: 11px;
  color: #2563eb;
}
.todo__spin {
  animation: todo-spin 1s linear infinite;
}
@keyframes todo-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
