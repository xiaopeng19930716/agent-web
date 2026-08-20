<script setup>
import { computed } from 'vue'
import { Table as ATable, Drawer as ADrawer, Tag as ATag, Empty as AEmpty } from 'ant-design-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  session: { type: Object, default: null },
})

const columns = [
  { title: '#', dataIndex: 'index', key: 'index', width: 48, align: 'center' },
  { title: '角色', dataIndex: 'role', key: 'role', width: 80, align: 'center' },
  { title: '模型', dataIndex: 'model', key: 'model', width: 180, ellipsis: true },
  { title: 'Token', dataIndex: 'tokens', key: 'tokens', width: 90, align: 'center' },
  { title: '耗时', dataIndex: 'duration', key: 'duration', width: 100, align: 'center' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' },
  { title: '时间', dataIndex: 'time', key: 'time', width: 170 },
]

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

const messages = computed(() =>
  (props.session?.messages || []).map((m, i) => {
    const meta = m.metadata || {}
    const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : []
    const returnInfo = toolCalls.length
      ? toolCalls.map((t) => ({
          tool: t.name,
          status: t.status,
          args: t.args,
          result: t.result,
        }))
      : null
    return {
      index: i + 1,
      role: m.role === 'user' ? '你' : 'Agent',
      model: meta.model || (m.role === 'user' ? '—' : '未知'),
      tokens: meta.tokens == null ? '—' : meta.tokens,
      duration: meta.durationMs == null ? '—' : `${meta.durationMs} ms`,
      status: meta.status || '—',
      time: fmtTime(meta.timestamp),
      content: m.content || '',
      reasoning: m.reasoning || '',
      returnInfo,
    }
  })
)

const hasMeta = computed(() =>
  messages.value.some((r) => r.model !== '—' || r.tokens !== '—' || r.duration !== '—')
)

const stats = computed(() => {
  const agentCalls = messages.value.filter((r) => r.role === 'Agent').length
  const totalTokens = messages.value.reduce((sum, r) => {
    const n = Number(r.tokens)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)
  return { agentCalls, totalTokens }
})
</script>

<template>
  <a-drawer
    :open="open"
    title="对话日志"
    placement="right"
    :width="960"
    @update:open="$emit('update:open', $event)"
  >
    <template v-if="!session">
      <a-empty description="未选择会话" />
    </template>
    <template v-else>
      <div class="log-summary">
        <span>会话：<strong>{{ session.title || '新对话' }}</strong></span>
        <span class="log-summary__stats">
          <span>消息数：{{ messages.length }}</span>
          <span>Agent 调用：{{ stats.agentCalls }}</span>
          <span>总 Token：{{ stats.totalTokens }}</span>
        </span>
      </div>
      <a-empty v-if="!hasMeta" description="该会话暂无日志信息（历史或早期对话未记录元数据）" />
      <a-table
        v-else
        :columns="columns"
        :data-source="messages"
        :row-key="(record) => record.index"
        :pagination="false"
        size="small"
        :scroll="{ x: 880 }"
        :expandable="{ defaultExpandAllRows: false }"
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
        <template #expandedRowRender="{ record }">
          <div class="log-expand">
            <section v-if="record.content">
              <h4 class="log-expand__title">内容</h4>
              <pre class="log-text-block">{{ record.content }}</pre>
            </section>
            <section v-if="record.reasoning">
              <h4 class="log-expand__title">思考过程</h4>
              <pre class="log-text-block">{{ record.reasoning }}</pre>
            </section>
            <section v-if="record.returnInfo">
              <h4 class="log-expand__title">返回信息</h4>
              <pre class="log-return-json" :title="safeJson(record.returnInfo)">{{ safeJson(record.returnInfo) }}</pre>
            </section>
          </div>
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
.log-summary__stats {
  display: flex;
  gap: 16px;
}
.log-return-json {
  margin: 0;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-all;
  max-width: 320px;
  max-height: 120px;
  overflow: auto;
}
.log-return-empty {
  color: #94a3b8;
}
.log-text-block {
  margin: 0;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-all;
  max-width: 100%;
  max-height: 320px;
  overflow: auto;
}
.log-expand {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.log-expand__title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
</style>
