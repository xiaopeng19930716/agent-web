<script setup>
import { ref, reactive, computed, nextTick, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-vue-next'

marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})

const props = defineProps({
  messages: { type: Array, default: () => [] },
  active: { type: Object, default: null },
  error: { type: String, default: '' },
})

const expandedThinking = ref(false) // 思考区折叠摘要是否展开
const scrollEl = ref(null)

async function scrollToBottom() {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

function renderMarkdown(text) {
  return marked.parse(text || '')
}

// 工具调用参数摘要（单行可读）
function prettyArgs(args) {
  if (!args || !Object.keys(args).length) return ''
  try {
    const parts = Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    return parts.join('  ')
  } catch {
    return String(args)
  }
}

// 截断过长文本
function clip(text, n = 1200) {
  const s = String(text || '')
  return s.length > n ? s.slice(0, n) + `…（已截断，共 ${s.length} 字）` : s
}

// 工具结果展开/收起状态（以消息内索引为 key）
const resultExpanded = reactive(new Set())
function toggleResult(ti) {
  if (resultExpanded.has(ti)) resultExpanded.delete(ti)
  else resultExpanded.add(ti)
}

// 取路径最后一级目录名
function lastSegment(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

watch(() => props.messages, scrollToBottom)
</script>

<template>
  <div class="chat__body" ref="scrollEl">
    <div v-if="messages.length === 0" class="chat__empty">
      <template v-if="active">
        已连接到项目「{{ active.alias }}」<br />
        <code class="chat__empty-path" :title="active.path">{{ lastSegment(active.path) }}</code><br />
        让 Agent 帮你读代码、改 bug、加功能，例如：<br />
        “列出 src 目录结构” / “在 App.vue 里加一个按钮”
      </template>
      <template v-else>
        这是一个不关联任何项目的通用对话。<br />
        直接提问即可；如需让 Agent 访问本地代码，点击输入框左侧「＋」添加并选择项目。
      </template>
    </div>

    <div
      v-for="(m, i) in messages"
      :key="i"
      class="msg"
      :class="m.role === 'user' ? 'msg--user' : 'msg--ai'"
    >
      <!-- Agent 思考区：思考中 / 思考完成 + 工具调用时间线 -->
      <div
        v-if="m.role === 'assistant' && (m.reasoning || (m.toolCalls || []).length)"
        class="thinking"
        :class="{ 'thinking--collapsed': m.reasoningDone && !expandedThinking }"
      >
        <button class="thinking__head" @click="m.reasoningDone ? (expandedThinking = !expandedThinking) : null">
          <span class="thinking__dot" :class="{ 'thinking__dot--done': m.reasoningDone }"></span>
          <template v-if="!m.reasoningDone">
            <span class="thinking__title">思考中</span>
            <span class="thinking__dots"><i></i><i></i><i></i></span>
          </template>
          <template v-else>
            <span class="thinking__title thinking__title--done">✓ 思考完成</span>
            <span v-if="(m.toolCalls || []).length" class="thinking__summary">
              已调用 {{ (m.toolCalls || []).length }} 个工具 · 用时思考
            </span>
            <ChevronDown v-if="!expandedThinking" :size="14" class="thinking__chevron" />
            <ChevronUp v-else :size="14" class="thinking__chevron" />
          </template>
        </button>

        <div v-show="!m.reasoningDone || expandedThinking" class="thinking__body">
          <!-- 推理文本 -->
          <div v-if="m.reasoning" class="thinking__reason">{{ m.reasoning }}</div>

          <!-- 工具调用时间线 -->
          <ul v-if="(m.toolCalls || []).length" class="timeline">
            <li v-for="(t, ti) in (m.toolCalls || [])" :key="ti" class="timeline__item">
              <span class="timeline__rail">
                <span class="timeline__node" :class="{ 'timeline__node--done': t.status === 'done' }">
                  <Check v-if="t.status === 'done'" :size="11" />
                  <Loader2 v-else :size="11" class="timeline__spin" />
                </span>
              </span>
              <div class="timeline__main">
                <div class="timeline__head">
                  <span class="timeline__icon">⚙</span>
                  <span class="timeline__name">调用 {{ t.name }}</span>
                  <span class="timeline__status" :class="{ 'timeline__status--done': t.status === 'done' }">
                    {{ t.status === 'done' ? '完成' : '执行中' }}
                  </span>
                </div>
                <div v-if="Object.keys(t.args || {}).length" class="timeline__args">
                  {{ prettyArgs(t.args) }}
                </div>
                <div v-if="t.status === 'done' && t.result" class="timeline__result">
                  <span class="timeline__result-label" @click="toggleResult(ti)">
                    {{ resultExpanded.has(ti) ? '收起结果' : '查看结果' }}
                  </span>
                  <pre v-show="resultExpanded.has(ti)" class="timeline__result-body">{{ clip(t.result, 1200) }}</pre>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- 气泡 -->
      <div class="bubble" :class="m.role === 'user' ? 'bubble--user' : 'bubble--ai'">
        <div v-if="m.role !== 'user'" class="bubble__avatar" aria-hidden="true">AI</div>
        <div
          v-if="m.role === 'user'"
          class="bubble__text"
        >{{ m.content }}</div>
        <div
          v-else
          class="bubble__content"
          v-html="renderMarkdown(m.content)"
        ></div>
      </div>
    </div>
    <div v-if="error" class="chat__error">{{ error }}</div>
  </div>
</template>

<style scoped lang="less">
.chat__body {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
  background: #ffffff;
}
.chat__empty {
  color: #64748b;
  text-align: center;
  margin-top: 48px;
  line-height: 1.9;
  font-size: 14px;
}
.chat__empty-path {
  display: inline-block;
  margin: 8px 0 14px;
  padding: 6px 12px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #1f2937;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
  max-width: 100%;
  word-break: break-all;
}
.msg {
  margin-bottom: 18px;
  max-width: 88%;
  display: flex;
  flex-direction: column;
}
.msg--user {
  margin-left: auto;
  align-items: flex-end;
}

// ===== 气泡 =====
.bubble {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
  animation: bubbleIn 0.16s ease-out;
}
.bubble--user {
  flex-direction: row-reverse;
  margin-left: auto;
}
.bubble__avatar {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, @color-primary, @color-primary-hover);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
}
.bubble__text,
.bubble__content {
  padding: 12px 15px;
  border-radius: 14px;
  line-height: 1.65;
  font-size: 14px;
  word-break: break-word;
}
.bubble--user .bubble__text {
  background: linear-gradient(135deg, @color-primary, @color-primary-hover);
  color: #fff;
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25);
}
.bubble--ai .bubble__content {
  background: #ffffff;
  border: 1px solid @color-border;
  color: @color-text;
  border-bottom-left-radius: 5px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
}
.bubble__content :deep(pre) {
  background: #0d1117;
  color: #e6edf3;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.bubble__content :deep(code) {
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
}
.bubble__content :deep(p code) {
  background: @color-bg-subtle;
  color: @color-text-strong;
  padding: 2px 5px;
  border-radius: 4px;
}

// ===== 思考区 =====
.thinking {
  margin-bottom: 10px;
  max-width: 100%;
  background: #f8fafc;
  border: 1px solid @color-border;
  border-left: 3px solid @color-primary;
  border-radius: 10px;
  padding: 10px 12px;
  animation: bubbleIn 0.16s ease-out;
  transition: background 0.2s, border-color 0.2s;
}
.thinking--collapsed {
  background: #f1f5f9;
  border-left-color: @color-text-muted;
}
.thinking__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: @color-text-strong;
}
.thinking__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: @color-primary;
  flex-shrink: 0;
  animation: pulse 1.2s ease-in-out infinite;
}
.thinking__dot--done {
  background: #16a34a;
  animation: none;
}
.thinking__title {
  letter-spacing: 0.3px;
}
.thinking__title--done {
  color: #16a34a;
}
.thinking__summary {
  color: @color-text-muted;
  font-weight: 500;
  font-size: 12px;
}
.thinking__chevron {
  margin-left: auto;
  color: @color-text-muted;
}
.thinking__dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 2px;
}
.thinking__dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: @color-primary;
  animation: bounce 1.2s infinite ease-in-out;
}
.thinking__dots i:nth-child(2) {
  animation-delay: 0.2s;
}
.thinking__dots i:nth-child(3) {
  animation-delay: 0.4s;
}
.thinking__body {
  margin-top: 8px;
  overflow: hidden;
}
.thinking__reason {
  font-size: 13px;
  line-height: 1.7;
  color: @color-text-muted;
  white-space: pre-wrap;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

// ===== 工具调用时间线 =====
.timeline {
  list-style: none;
  margin: 10px 0 2px;
  padding: 0;
}
.timeline__item {
  display: flex;
  gap: 8px;
  padding-bottom: 6px;
}
.timeline__rail {
  position: relative;
  width: 16px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.timeline__rail::before {
  content: '';
  position: absolute;
  top: 16px;
  bottom: -6px;
  width: 1px;
  background: @color-border;
}
.timeline__item:last-child .timeline__rail::before {
  display: none;
}
.timeline__node {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid @color-primary;
  color: #16a34a;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  z-index: 1;
}
.timeline__node--done {
  background: #16a34a;
  border-color: #16a34a;
  color: #fff;
}
.timeline__spin {
  color: @color-primary;
  animation: spin 0.9s linear infinite;
}
.timeline__main {
  flex: 1;
  min-width: 0;
}
.timeline__head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.timeline__icon {
  color: @color-text-muted;
}
.timeline__name {
  font-weight: 600;
  color: @color-text-strong;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
}
.timeline__status {
  margin-left: auto;
  font-size: 11px;
  color: @color-primary;
  background: @color-primary-active-bg;
  padding: 1px 7px;
  border-radius: 999px;
}
.timeline__status--done {
  color: #16a34a;
  background: #dcfce7;
}
.timeline__args {
  margin-top: 3px;
  font-size: 12px;
  color: @color-text-muted;
  font-family: 'Fira Code', Consolas, monospace;
  word-break: break-all;
}
.timeline__result {
  margin-top: 4px;
}
.timeline__result-label {
  font-size: 12px;
  color: @color-primary;
  cursor: pointer;
  user-select: none;
}
.timeline__result-label:hover {
  text-decoration: underline;
}
.timeline__result-body {
  margin: 4px 0 0;
  padding: 8px 10px;
  background: #0d1117;
  color: #e6edf3;
  border-radius: 6px;
  font-size: 12px;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: 'Fira Code', Consolas, monospace;
}

.chat__error {
  color: #f87171;
  font-size: 13px;
  margin-bottom: 12px;
}

// ===== 动效 =====
@keyframes bubbleIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .thinking__dots i,
  .thinking__dot,
  .timeline__spin {
    animation: none !important;
  }
  .bubble,
  .thinking {
    animation: none !important;
  }
}
</style>
