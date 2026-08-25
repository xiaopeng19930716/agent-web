<script setup>
import { ref, reactive, computed } from 'vue'
import { createPatch } from 'diff'
import { GitCompare, Loader2, ChevronLeft } from 'lucide-vue-next'
import { fetchFileContent, fetchBackupContent } from '../../api/agent.js'

const props = defineProps({
  session: { type: Object, default: null },
  projectId: { type: String, default: '' },
})

// 从会话消息中聚合所有 writeFile/editFile 的文件变更，按路径去重（保留最后一次）
const changes = computed(() => {
  const map = new Map()
  if (!props.session || !Array.isArray(props.session.messages)) return []
  for (const msg of props.session.messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.toolCalls)) continue
    for (const t of msg.toolCalls) {
      if (t.status !== 'done') continue
      if (t.name !== 'writeFile' && t.name !== 'editFile') continue
      const op = parseFileOp(t.result)
      if (!op || !op.filePath) continue
      map.set(op.filePath, { filePath: op.filePath, backupId: op.backupId })
    }
  }
  return [...map.values()]
})

function parseFileOp(result) {
  if (typeof result !== 'string') return null
  const m = result.match(/backupId=([^\s|]*)/)
  const backupId = m ? m[1].trim() : ''
  const fm = result.match(/:\s*(.+?)\s*\|/)
  const filePath = fm ? fm[1].trim() : ''
  if (!filePath) return null
  return { filePath, backupId }
}

const selected = ref(null)
const state = reactive({ loading: false, error: '', patch: [] })

function selectChange(item) {
  selected.value = item
  state.loading = true
  state.error = ''
  state.patch = []
  Promise.all([
    item.backupId
      ? fetchBackupContent(props.projectId, item.backupId)
      : Promise.resolve({ content: '', error: '' }),
    fetchFileContent(props.projectId, item.filePath),
  ])
    .then(([beforeRes, afterRes]) => {
      if (beforeRes.error) throw new Error(beforeRes.error)
      if (afterRes.error) throw new Error(afterRes.error)
      buildPatch(item.filePath, beforeRes.content ?? '', afterRes.content ?? '')
    })
    .catch((e) => {
      state.error = '加载改动失败: ' + (e && e.message ? e.message : String(e))
    })
    .finally(() => {
      state.loading = false
    })
}

function buildPatch(filePath, before, after) {
  const patchText = createPatch(filePath, before || '', after || '', '改动前', '改动后', { context: 3 })
  const lines = patchText.split('\n')
  const rows = []
  let inHunk = false
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('Index:') || line.startsWith('===')) continue
    if (line.startsWith('@@')) {
      inHunk = true
      rows.push({ type: 'hunk', text: line })
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) rows.push({ type: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ type: 'del', text: line.slice(1) })
    else if (line.startsWith(' ')) rows.push({ type: 'ctx', text: line.slice(1) })
    else rows.push({ type: 'ctx', text: line })
  }
  state.patch = rows
}
</script>

<template>
  <aside class="changes">
    <div class="changes__head">
      <span class="changes__title">
        <GitCompare :size="15" />
        <span>文件变更</span>
        <span v-if="changes.length" class="changes__count">{{ changes.length }}</span>
      </span>
    </div>

    <div class="changes__body">
      <!-- 无项目会话 / 无变更 -->
      <div v-if="!props.projectId" class="changes__empty">
        未关联到项目，无文件变更
      </div>
      <div v-else-if="!changes.length" class="changes__empty">
        当前会话暂无文件变更
      </div>

      <!-- 文件列表 -->
      <template v-else-if="!selected">
        <button
          v-for="item in changes"
          :key="item.filePath"
          class="changes__file"
          type="button"
          @click="selectChange(item)"
        >
          <GitCompare :size="14" />
          <span class="changes__file-path">{{ item.filePath }}</span>
        </button>
      </template>

      <!-- 单个文件 diff -->
      <template v-else>
        <button class="changes__back" type="button" @click="selected = null">
          <ChevronLeft :size="14" />
          <span>返回列表</span>
        </button>
        <div class="changes__file-title">{{ selected.filePath }}</div>
        <div v-if="state.loading" class="changes__loading">
          <Loader2 :size="16" class="changes__spin" /> 加载改动中…
        </div>
        <div v-else-if="state.error" class="changes__error">{{ state.error }}</div>
        <pre v-else class="changes__code"><span
            v-for="(row, ri) in state.patch"
            :key="ri"
            class="changes__line"
            :class="'changes__line--' + row.type"
          ><span class="changes__sign">{{
            row.type === 'add' ? '+' : row.type === 'del' ? '-' : row.type === 'hunk' ? '' : ' '
          }}</span><span class="changes__text">{{ row.text }}</span></span></pre>
      </template>
    </div>
  </aside>
</template>

<style scoped lang="less">
.changes {
  width: 32vw;
  min-width: 320px;
  max-width: 560px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg);
  min-height: 0;
}
.changes__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid @color-border;
  background: var(--color-bg-subtle);
  flex-shrink: 0;
}
.changes__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: @color-text-strong;
}
.changes__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: @color-primary;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
.changes__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.changes__empty {
  padding: 24px 12px;
  color: @color-text-muted;
  font-size: 13px;
  text-align: center;
}
.changes__file {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  margin-bottom: 6px;
  border: 1px solid @color-border;
  border-radius: 8px;
  background: var(--color-bg-subtle);
  color: @color-text;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.changes__file:hover {
  border-color: @color-primary;
  background: @color-primary-active-bg;
}
.changes__file-path {
  font-family: 'Fira Code', Consolas, monospace;
  word-break: break-all;
}
.changes__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: @color-primary;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 8px;
}
.changes__file-title {
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  color: @color-text-strong;
  word-break: break-all;
  margin-bottom: 10px;
  padding: 6px 10px;
  background: var(--color-bg-subtle);
  border: 1px solid @color-border;
  border-radius: 8px;
}
.changes__loading,
.changes__error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  color: @color-text-muted;
  font-size: 13px;
}
.changes__error {
  color: #f87171;
}
.changes__spin {
  animation: spin 0.9s linear infinite;
}
.changes__code {
  margin: 0;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--color-bg-subtle);
  border: 1px solid @color-border;
  border-radius: 8px;
  padding: 8px 0;
  overflow-x: auto;
}
.changes__line {
  display: block;
  white-space: pre;
  padding: 0 10px;
}
.changes__sign {
  display: inline-block;
  width: 14px;
  user-select: none;
  font-weight: 700;
}
.changes__line--add {
  background: rgba(22, 163, 74, 0.16);
  color: #16a34a;
}
.changes__line--add .changes__sign {
  color: #16a34a;
}
.changes__line--del {
  background: rgba(220, 38, 38, 0.14);
  color: #f87171;
}
.changes__line--del .changes__sign {
  color: #dc2626;
}
.changes__line--ctx {
  color: @color-text-muted;
}
.changes__line--hunk {
  color: @color-primary;
  background: @color-primary-active-bg;
  font-weight: 600;
}
</style>
