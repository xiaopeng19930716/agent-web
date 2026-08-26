<script setup>
import { ref, reactive, computed, nextTick, watch, onMounted } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { ArrowDown, ListTree } from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { writeProjectFile } from '../../api/agent.js'
import TodoPanel from './TodoPanel.vue'
import UserMessage from './messages/UserMessage.vue'
import AIMessage from './messages/AIMessage.vue'

// #4 代码块「应用到文件」：每次渲染收集代码块原文，供事件委托取回
const codeBlocks = []
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})
// 自定义 code 渲染：包一层带「应用到文件」按钮的容器（按钮用 data-ci 索引 codeBlocks）
const defaultRenderer = new marked.Renderer()
marked.use({
  renderer: {
    code(code, infostring) {
      const lang = (infostring || '').trim().split(/\s+/)[0]
      const idx = codeBlocks.push({ code, lang }) - 1
      const highlighted = defaultRenderer.code
        ? defaultRenderer.code.call(this, code, infostring)
        : `<pre><code>${code}</code></pre>`
      const applyBtn =
        lang && props.projectId
          ? `<button class="code-apply-btn" data-ci="${idx}" title="应用到文件">应用到文件</button>`
          : ''
      return `<div class="code-block" data-ci="${idx}">${highlighted}${applyBtn}</div>`
    },
  },
})

const props = defineProps({
  messages: { type: Array, default: () => [] },
  active: { type: Object, default: null },
  error: { type: String, default: '' },
  projectId: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  session: { type: Object, default: null },
  showTodos: { type: Boolean, default: false },
})

const emit = defineEmits(['rollback', 'regenerate', 'restore', 'retryTool', 'open-subagent', 'update:show-todos'])

// #4 代码块「应用到文件」：点击委托 + 弹窗
const applyModal = reactive({ open: false, code: '', lang: '', relPath: '', writing: false })
function onMarkdownClick(e) {
  const btn = e.target.closest?.('.code-apply-btn')
  if (!btn) return
  const ci = Number(btn.dataset.ci)
  const block = codeBlocks[ci]
  if (!block) return
  const ext = block.lang ? guessExt(block.lang) : ''
  applyModal.open = true
  applyModal.code = block.code
  applyModal.lang = block.lang
  applyModal.relPath = ext ? `untitled.${ext}` : 'untitled.txt'
  applyModal.writing = false
}
function guessExt(lang) {
  const map = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', vue: 'vue', html: 'html', css: 'css', json: 'json', py: 'py', python: 'py', java: 'java', go: 'go', rs: 'rs', rust: 'rs', c: 'c', cpp: 'cpp', sh: 'sh', bash: 'sh', md: 'md', markdown: 'md', xml: 'xml', yaml: 'yaml', yml: 'yml', sql: 'sql' }
  return map[lang.toLowerCase()] || lang.toLowerCase().slice(0, 6)
}
async function confirmApplyFile() {
  if (!applyModal.relPath.trim()) {
    message.warning('请填写目标文件路径')
    return
  }
  applyModal.writing = true
  try {
    const r = await writeProjectFile(applyModal.code, applyModal.relPath.trim(), props.projectId)
    message.success(`已写入: ${r.path}` + (r.backupId ? '（已备份原文件）' : ''))
    applyModal.open = false
  } catch (err) {
    message.error(String(err?.message || err))
  } finally {
    applyModal.writing = false
  }
}

function renderMarkdown(text) {
  codeBlocks.length = 0 // 每次渲染重置收集，避免索引错位
  return marked.parse(text || '')
}

// 交互事件：子组件 emit，这里原样向上转发给 ChatPanel
function onRollback(m) {
  emit('rollback', m)
}
function onRegenerate(m) {
  emit('regenerate', m)
}
function onRetryTool(payload) {
  emit('retryTool', { msg: payload.message, tool: payload.tool, key: payload.tool?.id || payload.tool?.key })
}
function onOpenSubAgent(sa) {
  emit('open-subagent', sa)
}
function onRestore(m) {
  emit('restore', m)
}

function lastSegment(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

const scrollEl = ref(null)
const showToBottom = ref(false)

function isNearBottom() {
  const el = scrollEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
function updateToBottom() {
  showToBottom.value = !isNearBottom()
}
async function scrollToBottom(smooth = false) {
  await nextTick()
  if (scrollEl.value) {
    scrollEl.value.scrollTo({ top: scrollEl.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }
  updateToBottom()
}
function onScroll() {
  updateToBottom()
}

watch(
  () => props.messages,
  () => {
    if (isNearBottom()) scrollToBottom()
    else updateToBottom()
  },
  { deep: true }
)

onMounted(updateToBottom)

// 供父组件（ChatPanel）清除某条工具的重试 loading 态（拆分后由子组件内部托管，这里保留兼容空实现）
function clearRetrying() {}
defineExpose({ clearRetrying })
</script>

<template>
  <div class="chat__scroll-wrap">
    <div class="chat__body" ref="scrollEl" @scroll="onScroll">
      <div v-if="messages.length === 0" class="chat__empty">
        <template v-if="active">
          已连接到项目「{{ active.alias }}」<br />
          <code class="chat__empty-path" :title="active.path">{{ lastSegment(active.path) }}</code><br />
          让 Agent 帮你读代码、改 bug、加功能，例如：<br />
          “列出 src 目录结构” / “在 App.vue 里加一个按钮”
        </template>
        <template v-else>
          这是一个不关联任何项目的通用对话。<br />
          直接提问即可；如需让 Agent 访问本地代码，点击输入框上方「新增项目」添加并选择项目。
        </template>
      </div>

      <UserMessage
        v-for="(m, i) in messages.filter(x => x.role === 'user')"
        :key="'u-' + (m.id || i)"
        :message="m"
        :readonly="readonly"
        @rollback="onRollback"
      />
      <AIMessage
        v-for="(m, i) in messages.filter(x => x.role !== 'user')"
        :key="'a-' + (m.id || i)"
        :message="m"
        :readonly="readonly"
        :markdown-html="renderMarkdown(m.content)"
        :on-markdown-click="onMarkdownClick"
        @regenerate="onRegenerate"
        @retry-tool="onRetryTool"
        @open-subagent="onOpenSubAgent"
      />

      <div v-if="error" class="chat__error">{{ error }}</div>
    </div>

    <!-- 一键回到底部：用户上滚离开底部时浮现 -->
    <transition name="to-bottom-fade">
      <button
        v-if="showToBottom"
        class="chat__to-bottom"
        type="button"
        aria-label="回到底部"
        title="回到底部"
        @click="scrollToBottom(true)"
      >
        <ArrowDown :size="18" />
      </button>
    </transition>

    <!-- 任务清单：浮层在消息区右下角，按钮在右侧距底部 5px -->
    <transition name="todo-float">
      <TodoPanel
        v-if="showTodos"
        class="chat__todo-float"
        :session="session"
        @close="emit('update:show-todos', false)"
      />
    </transition>
    <button
      v-if="session && Array.isArray(session.todos) && session.todos.length"
      type="button"
      class="chat__todo-toggle"
      :class="{ 'is-active': showTodos }"
      title="任务清单"
      aria-label="任务清单"
      @click="emit('update:show-todos', !showTodos)"
    >
      <ListTree :size="18" />
      <span
        v-if="session && Array.isArray(session.todos) && session.todos.length"
        class="chat__todo-toggle-badge"
      >{{ session.todos.length }}</span>
    </button>

    <!-- #4 代码块「应用到文件」弹窗 -->
    <a-modal
      v-model:open="applyModal.open"
      title="应用到文件"
      :confirm-loading="applyModal.writing"
      ok-text="写入文件"
      cancel-text="取消"
      @ok="confirmApplyFile"
    >
      <div style="margin-bottom:8px;">目标路径：</div>
      <a-input v-model:value="applyModal.relPath" placeholder="例如 src/foo.ts" />
      <div class="apply-code-preview">{{ applyModal.code }}</div>
    </a-modal>
  </div>
</template>

<style scoped lang="less">
.chat__scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.chat__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px;
  background: var(--color-bg);
}
.chat__to-bottom {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 5px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  border: 1px solid @color-border;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.15);
  color: @color-primary;
  cursor: pointer;
  z-index: 5;
  transition: transform 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chat__to-bottom:hover {
  color: #fff;
  background: @color-primary;
  border-color: @color-primary;
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.35);
  transform: translate(-50%, -1px);
}
.chat__to-bottom:active {
  transform: translate(-50%, 1px) scale(0.94);
}
.to-bottom-fade-enter-active,
.to-bottom-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.to-bottom-fade-enter-from,
.to-bottom-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}
.to-bottom-fade-enter-to,
.to-bottom-fade-leave-from {
  opacity: 1;
  transform: translate(-50%, 0);
}
/* 任务清单触发按钮：消息区右侧、距底部 5px */
.chat__todo-toggle {
  position: absolute;
  right: 20px;
  bottom: 5px;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.15);
  color: var(--color-text);
  cursor: pointer;
  z-index: 6;
  transition: transform 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chat__todo-toggle:hover {
  color: #fff;
  background: var(--brand, #2563eb);
  border-color: var(--brand, #2563eb);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.35);
  transform: translateY(-1px);
}
.chat__todo-toggle.is-active {
  color: #fff;
  background: var(--brand, #2563eb);
  border-color: var(--brand, #2563eb);
}
.chat__todo-toggle-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--brand, #2563eb);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
/* 任务清单浮层：消息区右下角，按钮上方展开 */
.chat__todo-float {
  position: absolute;
  bottom: 52px;
  right: 20px;
  width: 300px;
  max-height: 60vh;
  z-index: 40;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 10px;
  background: var(--color-bg, #fff);
  box-shadow: -4px 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.todo-float-enter-active,
.todo-float-leave-active {
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.26s ease;
}
.todo-float-enter-from,
.todo-float-leave-to {
  transform: translateY(16px);
  opacity: 0;
}
.todo-float-enter-to,
.todo-float-leave-from {
  transform: translateY(0);
  opacity: 1;
}
.chat__empty {
  color: @color-text-muted;
  text-align: center;
  margin-top: 48px;
  line-height: 1.9;
  font-size: 14px;
}
.chat__empty-path {
  display: inline-block;
  margin: 8px 0 14px;
  padding: 6px 12px;
  background: var(--color-bg-subtle);
  border: 1px solid @color-border;
  border-radius: 6px;
  color: @color-text-strong;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
  max-width: 100%;
  word-break: break-all;
}
.chat__error {
  color: #ef4444;
  font-size: 13px;
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
}
</style>
