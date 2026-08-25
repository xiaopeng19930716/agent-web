<template>
  <div class="subagent-panel">
    <div class="subagent-panel__bar">
      <button class="subagent-panel__back" type="button" @click="$emit('back')">
        <ArrowLeft :size="16" />
        <span>返回主任务</span>
      </button>
      <div class="subagent-panel__title">
        <ListTree :size="15" />
        <span>{{ sub?.title }}</span>
      </div>
      <span class="subagent-panel__status" :class="'subagent-panel__status--' + (sub?.status || '')">
        {{ statusText }}
      </span>
    </div>
    <div v-if="sub?.description" class="subagent-panel__desc">{{ sub.description }}</div>
    <div class="subagent-panel__summary" v-if="sub?.status === 'end' && sub?.summary">
      <div class="subagent-panel__summary-label">执行结果</div>
      <div class="subagent-panel__summary-body">{{ sub.summary }}</div>
    </div>
    <div class="subagent-panel__body">
      <MessageList :messages="sub?.messages || []" :readonly="true" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowLeft, ListTree } from 'lucide-vue-next'
import MessageList from './MessageList.vue'

const props = defineProps({
  sub: { type: Object, default: null },
})
defineEmits(['back'])

const statusText = computed(() => {
  const s = props.sub?.status
  if (s === 'end') return '已完成'
  if (s === 'skipped') return '已跳过'
  if (s === 'start') return '执行中'
  return ''
})
</script>

<style scoped>
.subagent-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.subagent-panel__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}
.subagent-panel__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.subagent-panel__back:hover {
  background: var(--color-bg-subtle);
  border-color: var(--brand);
}
.subagent-panel__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subagent-panel__status {
  flex-shrink: 0;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
.subagent-panel__status--end {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.4);
  background: rgba(22, 163, 74, 0.08);
}
.subagent-panel__status--start {
  color: var(--brand);
  border-color: rgba(37, 99, 235, 0.4);
  background: rgba(37, 99, 235, 0.08);
}
.subagent-panel__status--skipped {
  color: var(--color-text-muted);
}
.subagent-panel__desc {
  padding: 10px 16px;
  font-size: 13px;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  line-height: 1.6;
}
.subagent-panel__summary {
  padding: 10px 16px;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}
.subagent-panel__summary-label {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.subagent-panel__summary-body {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.subagent-panel__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
</style>
