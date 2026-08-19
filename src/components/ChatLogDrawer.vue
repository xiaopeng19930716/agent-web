<script setup>
import { computed } from 'vue'
import { Table as ATable, Drawer as ADrawer, Tag as ATag, Empty as AEmpty } from 'ant-design-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  session: { type: Object, default: null },
})

const columns = [
  { title: '#', dataIndex: 'index', key: 'index', width: 48, align: 'center' },
  { title: '时间', dataIndex: 'time', key: 'time', width: 170 },
  { title: '角色', dataIndex: 'role', key: 'role', width: 80, align: 'center' },
  { title: '模型', dataIndex: 'model', key: 'model', ellipsis: true },
  { title: 'Token', dataIndex: 'tokens', key: 'tokens', width: 90, align: 'center' },
  { title: '耗时', dataIndex: 'duration', key: 'duration', width: 100, align: 'center' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' },
]

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const rows = computed(() => {
  const msgs = props.session?.messages || []
  return msgs.map((m, i) => {
    const meta = m.metadata || {}
    return {
      key: i,
      index: i + 1,
      time: fmtTime(meta.timestamp),
      role: m.role === 'user' ? '你' : 'Agent',
      model: meta.model || (m.role === 'user' ? '—' : '未知'),
      tokens: meta.tokens == null ? '—' : meta.tokens,
      duration: meta.durationMs == null ? '—' : `${meta.durationMs} ms`,
      status: meta.status || '—',
    }
  })
})

const hasMeta = computed(() => rows.value.some((r) => r.model !== '—' || r.tokens !== '—' || r.duration !== '—'))
</script>

<template>
  <a-drawer
    :open="open"
    title="对话日志"
    placement="right"
    :width="680"
    @update:open="$emit('update:open', $event)"
  >
    <template v-if="!session">
      <a-empty description="未选择会话" />
    </template>
    <template v-else>
      <div class="log-summary">
        <span>会话：<strong>{{ session.title || '新对话' }}</strong></span>
        <span>消息数：{{ rows.length }}</span>
      </div>
      <a-empty v-if="!hasMeta" description="该会话暂无日志信息（历史或早期对话未记录元数据）" />
      <a-table
        v-else
        :columns="columns"
        :data-source="rows"
        :pagination="{ pageSize: 10, hideOnSinglePage: true }"
        size="small"
        :scroll="{ x: 600 }"
      >
        <template #bodyCell="{ column, text }">
          <template v-if="column.key === 'status'">
            <a-tag v-if="text === 'ok'" color="success">成功</a-tag>
            <a-tag v-else-if="text === 'error'" color="error">失败</a-tag>
            <span v-else>—</span>
          </template>
          <template v-else>
            <span :title="text">{{ text }}</span>
          </template>
        </template>
      </a-table>
    </template>
  </a-drawer>
</template>

<style scoped>
.log-summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #475569;
}
</style>
