<script setup>
import { ref, reactive, computed, nextTick, watch, onMounted } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { ChevronDown, ChevronUp, Check, Loader2, Copy, ArrowDown, Undo2, Redo2, Timer, User } from 'lucide-vue-next'

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
  projectId: { type: String, default: '' },
})

const emit = defineEmits(['rollback', 'regenerate', 'restore'])

// 对话级回退：删除该消息及其之后 / 重新生成
function onEdit(m) {
  emit('rollback', m)
}

// 文件回退：从工具结果里解析出 backupId（写/编辑工具会在结果中附带 | backupId=...）
function extractBackupId(result) {
  if (typeof result !== 'string') return null
  const m = result.match(/backupId=(.+?)(?:\s*$)/)
  return m ? m[1].trim() : null
}

// 仅写/编辑类工具且成功备份后才提供「还原」入口
function canRestore(t) {
  return (
    t.status === 'done' &&
    (t.name === 'writeFile' || t.name === 'editFile') &&
    extractBackupId(t.result) !== null
  )
}

function onRestore(t) {
  const backupId = extractBackupId(t.result)
  if (!backupId) return
  emit('restore', { projectId: props.projectId, backupPath: backupId })
}
function onRegenerate(m) {
  emit('regenerate', m)
}

const scrollEl = ref(null)

// 是否显示「回到底部」悬浮按钮：仅当用户已上滚离开底部时显示
const showToBottom = ref(false)

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

// 思考区展开/收起状态：按消息索引独立记录，避免一条展开全部联动
const thinkingExpanded = reactive(new Set())
function toggleThinking(i) {
  if (thinkingExpanded.has(i)) thinkingExpanded.delete(i)
  else thinkingExpanded.add(i)
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

// 工具结果展开/收起状态（以「消息索引-工具索引」为 key，避免跨消息联动）
const resultExpanded = reactive(new Set())
function resultKey(i, ti) {
  return `${i}-${ti}`
}
function toggleResult(i, ti) {
  const k = resultKey(i, ti)
  if (resultExpanded.has(k)) resultExpanded.delete(k)
  else resultExpanded.add(k)
}

// AI 气泡复制状态（按消息索引记录「已复制」反馈）
const copiedSet = reactive(new Set())
async function copyContent(i, text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copiedSet.add(i)
    setTimeout(() => copiedSet.delete(i), 2000)
  } catch (e) {
    console.error('复制失败', e)
  }
}

// 取路径最后一级目录名
function lastSegment(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

// 流式生成时智能跟随：仅当用户已接近底部才自动滚到底部，避免打断主动上滚阅读
function isNearBottom() {
  const el = scrollEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
watch(
  () => props.messages,
  () => {
    if (isNearBottom()) scrollToBottom()
    else updateToBottom()
  },
  { deep: true }
)

// 挂载后初始化按钮可见性（例如刷新后内容很长且未停在底部）
onMounted(updateToBottom)
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

      <div
        v-for="(m, i) in messages"
        :key="m.id || i"
        class="msg"
        :class="m.role === 'user' ? 'msg--user' : 'msg--ai'"
      >
        <!-- 气泡 -->
        <div class="bubble" :class="m.role === 'user' ? 'bubble--user' : 'bubble--ai'">
          <!-- 头像：AI 蓝色渐变 + AI 字样；用户紫粉渐变 + User 图标；对称且身份可辨 -->
          <div
            v-if="m.role !== 'user'"
            class="bubble__avatar"
            aria-hidden="true"
          >AI</div>
          <div
            v-else
            class="bubble__avatar bubble__avatar--user"
            aria-hidden="true"
          ><User :size="14" /></div>
          <div
            v-if="m.role === 'user'"
            class="bubble__text"
          >
            <template v-if="m.tags && m.tags.length">
              <template v-for="(t, ti) in m.tags" :key="ti">
                <span v-if="t.type === 'text'">{{ t.text }}</span>
                <span
                  v-else
                  class="token-chip"
                  :class="`token-chip--${t.kind}`"
                >{{ t.kind === 'mcp' ? '⌘/' : (t.kind === 'skill' ? '/' : (t.kind === 'tool' ? '/' : '@')) }}{{ t.label }}</span>
              </template>
            </template>
            <template v-else>{{ m.content }}</template>
          </div>
          <div
            v-else
            class="bubble__body"
          >
            <!-- Agent 思考区：放在 AI 对话框内部（白色卡片内） -->
            <div
              class="bubble__content"
            >
              <div
                v-if="m.role === 'assistant' && (m.showThinking || !m.done || m.reasoning || (m.toolCalls || []).length)"
                class="thinking thinking--nested"
                :class="{ 'thinking--collapsed': !thinkingExpanded.has(i) }"
              >
                <button class="thinking__head" :aria-expanded="thinkingExpanded.has(i)" @click="toggleThinking(i)">
                  <span class="thinking__dot" :class="{ 'thinking__dot--done': m.reasoningDone }"></span>
                  <template v-if="!m.reasoningDone">
                    <span class="thinking__title">思考中</span>
                    <span class="thinking__dots"><i></i><i></i><i></i></span>
                    <ChevronDown v-if="!thinkingExpanded.has(i)" :size="14" class="thinking__chevron" />
                    <ChevronUp v-else :size="14" class="thinking__chevron" />
                  </template>
                  <template v-else>
                    <span class="thinking__title thinking__title--done">✓ 思考完成</span>
                    <span v-if="(m.toolCalls || []).length" class="thinking__summary">
                      已调用 {{ (m.toolCalls || []).length }} 个工具 · 用时思考
                    </span>
                    <ChevronDown v-if="!thinkingExpanded.has(i)" :size="14" class="thinking__chevron" />
                    <ChevronUp v-else :size="14" class="thinking__chevron" />
                  </template>
                </button>

                <div v-show="thinkingExpanded.has(i)" class="thinking__body">
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
                          <span class="timeline__result-label" @click="toggleResult(i, ti)">
                            {{ resultExpanded.has(resultKey(i, ti)) ? '收起结果' : '查看结果' }}
                          </span>
                          <pre v-show="resultExpanded.has(resultKey(i, ti))" class="timeline__result-body">{{ clip(t.result, 1200) }}</pre>
                        </div>
                        <div v-if="canRestore(t)" class="timeline__restore">
                          <button
                            class="bubble__iconbtn"
                            type="button"
                            title="还原此文件改动（恢复到被修改前的备份）"
                            aria-label="还原文件"
                            @click="onRestore(t)"
                          >
                            <Undo2 :size="14" />
                            <span>还原</span>
                          </button>
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              <div class="bubble__markdown" v-html="renderMarkdown(m.content)"></div>
            </div>
          </div>
        </div>

        <!-- 操作条：放在气泡外部，贴近气泡边缘显示，不占用正文空间 -->
        <div v-if="m.role === 'user'" class="msg__actions msg__actions--user">
          <button
            class="msg__action"
            type="button"
            title="回退到此处：删除此消息及其之后内容，并将原文填入输入框"
            aria-label="回退到此处"
            @click="onEdit(m)"
          >
            <Undo2 :size="14" />
          </button>
        </div>
        <div v-else class="msg__actions msg__actions--ai">
          <button
            class="msg__action"
            type="button"
            :disabled="m.done === false"
            :aria-label="copiedSet.has(i) ? '已复制' : '复制内容'"
            :title="m.done === false ? '思考/生成中，完成后可复制' : (copiedSet.has(i) ? '已复制' : '复制')"
            @click="m.done !== false && copyContent(i, m.content)"
          >
            <Check v-if="copiedSet.has(i)" :size="14" />
            <Copy v-else :size="14" />
          </button>
          <button
            class="msg__action"
            type="button"
            :disabled="m.done === false"
            title="重新生成此回答"
            aria-label="重新生成"
            @click="m.done !== false && onRegenerate(m)"
          >
            <Redo2 :size="14" />
          </button>
                <span
                  v-if="m.metadata && typeof m.metadata.firstTokenMs === 'number'"
                  class="bubble__latency"
                  :title="`首 token 延迟 ${m.metadata.firstTokenMs}ms`"
                >
                  <Timer :size="12" />
                  {{ (m.metadata.firstTokenMs / 1000).toFixed(1) }}s
                </span>
        </div>
      </div>
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
  background: #ffffff;
}
.chat__to-bottom {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
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
  transform: translateY(-1px);
}
.chat__to-bottom:active {
  transform: scale(0.94);
}
.to-bottom-fade-enter-active,
.to-bottom-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.to-bottom-fade-enter-from,
.to-bottom-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
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
  position: relative;
  margin-bottom: 18px;
  max-width: 88%;
  display: flex;
  flex-direction: column;
  /* 头像占位变量定义在 .msg 层：.bubble 和 .msg__actions 是兄弟节点，
     CSS 变量只能沿父链继承，定义在 .bubble 上会让操作条取不到值 */
  --bubble-avatar-size: 26px;
  --bubble-gap: 8px;
  --bubble-avatar-offset: calc(var(--bubble-avatar-size) + var(--bubble-gap));
}
.msg--user {
  margin-left: auto;
  align-items: flex-end;
}
.msg--ai {
  /* AI 子元素按 content 排列，避免 .msg__actions 在 stretch 默认下被横向拉伸 */
  align-items: flex-start;
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
/* 用户头像：与 AI 蓝色形成色相互补的紫粉渐变，保持对称但身份清晰可辨 */
.bubble__avatar--user {
  background: linear-gradient(135deg, #a78bfa, #f0abfc);
  box-shadow: 0 2px 6px rgba(167, 139, 250, 0.35);
}
.bubble__text,
.bubble__content {
  padding: 12px 15px;
  border-radius: 14px;
  line-height: 1.65;
  font-size: 14px;
  word-break: break-word;
}
.bubble__body {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 100%;
}
.bubble__copy-text {
  font-weight: 500;
}
/* 消息操作条：位于气泡外部（与气泡同级，紧贴气泡边缘），不占用正文空间 */
.msg__actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.msg__actions--user {
  /* 用户气泡右对齐，操作条沿右边缘对齐；padding-right 让操作条右边缘
     对齐到蓝色气泡的右边缘（而非 msg 容器右边缘，因为气泡内有 avatar + gap 占位） */
  align-self: flex-end;
  padding-right: var(--bubble-avatar-offset);
}
.msg__actions--ai {
  /* AI 气泡左对齐，操作条沿左边缘对齐；padding-left 让操作条左边缘
     对齐到白卡的左边缘（而非 msg 容器左边缘，因为气泡内有 avatar + gap 占位） */
  align-self: flex-start;
  padding-left: var(--bubble-avatar-offset);
}
.msg__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid @color-border;
  background: #ffffff;
  color: @color-text-muted;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
}
.msg__action:hover:not(:disabled) {
  background: #f1f5f9;
  color: @color-primary;
  border-color: @color-primary;
  transform: translateY(-1px);
}
.msg__action:active:not(:disabled) {
  transform: translateY(0);
}
.msg__action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* 首 token 延迟标签 */
.bubble__latency {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  color: @color-text-muted;
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid @color-border;
  user-select: none;
  white-space: nowrap;
}
/* 工具时间线里的「还原」按钮复用 .bubble__iconbtn，沿用原来的小尺寸样式 */
.bubble__iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid @color-border;
  background: transparent;
  color: @color-text-muted;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.bubble__iconbtn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: @color-border;
  color: @color-text;
}
.bubble__iconbtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}
.bubble--user .bubble__text {
  background: linear-gradient(135deg, @color-primary, @color-primary-hover);
  color: #fff;
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25);
}
/* 用户气泡内的工具/技能/MCP/文件标记：样式化 chip（不随\n换行） */
.token-chip {
  display: inline-block;
  vertical-align: baseline;
  margin: 0 3px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: 'Fira Code', Consolas, monospace;
  line-height: 1.6;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.55);
  color: #fff;
}
.token-chip--mcp {
  background: rgba(255, 255, 255, 0.3);
  border-color: #ffd591;
  color: #fff7e6;
}
.token-chip--skill {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.55);
}
.token-chip--tool {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.45);
}
.bubble--ai .bubble__content {
  background: #ffffff;
  border: 1px solid @color-border;
  color: @color-text;
  border-bottom-left-radius: 5px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
}
// 链接高亮：蓝色 + 下划线，hover 加深
// 注意：v-html 渲染的 markdown 实际位于 .bubble__markdown 节点内（不是 .bubble__content 直接子节点）
// 使用 :deep() 穿透 scoped，!important 兜底覆盖浏览器 user agent 默认 -webkit-link
.bubble--ai.bubble .bubble__content :deep(.bubble__markdown) a {
  color: @color-primary !important;
  text-decoration: underline !important;
  text-underline-offset: 2px !important;
  word-break: break-all !important;
}
.bubble--ai.bubble .bubble__content :deep(.bubble__markdown) a:hover {
  color: @color-primary-hover !important;
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
.thinking--nested {
  margin: 0 0 10px;
  padding: 8px 10px;
  background: #f1f5f9;
  border: none;
  border-left: 3px solid @color-text-muted;
  border-radius: 8px;
  animation: none;
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
/* 文件回退：写/编辑工具结果下的「还原」入口 */
.timeline__restore {
  margin-top: 6px;
}
.timeline__restore .bubble__iconbtn {
  border-color: @color-border;
  color: @color-text-muted;
}
.timeline__restore .bubble__iconbtn:hover:not(:disabled) {
  background: rgba(91, 140, 255, 0.12);
  border-color: @color-primary;
  color: @color-primary;
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
