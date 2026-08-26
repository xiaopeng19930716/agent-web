<script setup>
import { ref, computed, watch } from 'vue'
import { ChevronDown, ChevronUp, Check, Loader2, Copy, Redo2, Timer, ListTree, Brain, Wrench, Terminal, FileSearch, Search, Database, Globe, Code, AlertCircle, CheckCircle2, ChevronDown as IconChevronDown } from 'lucide-vue-next'
import { message } from 'ant-design-vue'

const props = defineProps({
  message: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
  // markdown 已渲染的 HTML（由父组件 MessageList 统一渲染，避免重复配置 marked/highlight）
  markdownHtml: { type: String, default: '' },
  // 代码块点击处理（找代码块 -> 弹「应用到文件」），由父组件透传
  onMarkdownClick: { type: Function, default: null },
})
const emit = defineEmits(['regenerate', 'retryTool', 'open-subagent'])

const m = computed(() => props.message)

// 状态按消息 id 记录（组件实例即单条消息，自包含）
const thinkingExpanded = ref(true)
const resultExpanded = ref(new Set())
const retrying = ref(new Set())
const copiedSet = ref(new Set())

function toggleThinking() {
  thinkingExpanded.value = !thinkingExpanded.value
}
function toggleResult(ti) {
  const k = String(ti)
  if (resultExpanded.value.has(k)) resultExpanded.value.delete(k)
  else resultExpanded.value.add(k)
  resultExpanded.value = new Set(resultExpanded.value)
}
function onRetryTool(t, ti) {
  const k = String(ti)
  if (retrying.value.has(k)) return
  retrying.value.add(k)
  retrying.value = new Set(retrying.value)
  emit('retryTool', { msg: props.message, tool: t, key: k })
}
// 后端重跑结果回来后，状态变为 done -> 自动清除该工具的重试 loading
watch(
  () => (props.message.toolCalls || []).map((t) => `${t.status}|${(t.result || '').length}`),
  () => {
    const calls = props.message.toolCalls || []
    let changed = false
    calls.forEach((t, ti) => {
      const k = String(ti)
      if (retrying.value.has(k) && t.status === 'done') {
        retrying.value.delete(k)
        changed = true
      }
    })
    if (changed) retrying.value = new Set(retrying.value)
  },
  { deep: true }
)
function onRegenerateMsg() {
  emit('regenerate', props.message)
}
function openSubAgent(id) {
  emit('open-subagent', id)
}

function prettyArgs(args) {
  if (!args || !Object.keys(args).length) return ''
  try {
    return Object.entries(args)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('  ')
  } catch {
    return String(args)
  }
}
function clip(text, n = 1200) {
  const s = String(text || '')
  return s.length > n ? s.slice(0, n) + `…（已截断，共 ${s.length} 字）` : s
}
function toolIcon(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('search') || n.includes('find')) return Search
  if (n.includes('file') || n.includes('read') || n.includes('list')) return FileSearch
  if (n.includes('web') || n.includes('http') || n.includes('url') || n.includes('fetch')) return Globe
  if (n.includes('db') || n.includes('sql') || n.includes('query')) return Database
  if (n.includes('code') || n.includes('exec') || n.includes('run')) return Code
  if (n.includes('terminal') || n.includes('shell') || n.includes('bash')) return Terminal
  return Wrench
}

function isToolFailed(t) {
  const r = String(t.result || '')
  return (
    /^(工具执行错误|错误|拒绝|失败|error|fail|deny|rejected|timeout)/i.test(r) ||
    /(错误|失败|拒绝|error|failed|denied|timeout)/i.test(r)
  )
}

async function copyContent(text) {
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
    copiedSet.value.add(m.value.id)
    copiedSet.value = new Set(copiedSet.value)
    message.success('已复制')
    setTimeout(() => {
      copiedSet.value.delete(m.value.id)
      copiedSet.value = new Set(copiedSet.value)
    }, 2000)
  } catch (e) {
    console.error('复制失败', e)
  }
}
</script>

<template>
  <div class="msg msg--ai">
    <div class="bubble bubble--ai">
      <div class="bubble__avatar">AI</div>
      <div class="bubble__body">
        <div class="bubble__content">
          <!-- 计划模式：拆解后的子任务清单 -->
          <div v-if="m.plan && m.plan.length" class="plan-card">
            <div class="plan-card__title">
              <ListTree :size="14" />
              <span>执行计划（{{ m.plan.length }} 个子任务）</span>
            </div>
            <ol class="plan-card__list">
              <li v-for="(it, pi) in m.plan" :key="it.id" class="plan-card__item">
                <span class="plan-card__idx">{{ pi + 1 }}</span>
                <span class="plan-card__text">
                  <span class="plan-card__name">{{ it.title }}</span>
                  <span v-if="it.description" class="plan-card__desc">{{ it.description }}</span>
                </span>
              </li>
            </ol>
          </div>
          <!-- Agent 思考区：精致的思考轨迹卡 -->
          <div
            v-if="m.role === 'assistant' && (m.showThinking || !m.done || m.reasoning || (m.toolCalls || []).length)"
            class="thinking thinking--clean"
            :class="{ 'thinking--collapsed': !thinkingExpanded }"
          >
            <button class="thinking__head" :aria-expanded="thinkingExpanded" @click="toggleThinking">
              <span class="thinking__dot" :class="{ 'thinking__dot--done': m.reasoningDone }"></span>
              <span v-if="m.reasoningDone" class="thinking__title thinking__title--done">
                <span class="thinking__title-icon"><Brain :size="13" /></span>已思考
              </span>
              <template v-else>
                <span class="thinking__title">
                  <span class="thinking__title-icon thinking__title-icon--spin"><Brain :size="13" /></span>思考中
                </span>
                <span class="thinking__dots"><i></i><i></i><i></i></span>
              </template>
              <span
                v-if="m.reasoningDone && (m.toolCalls || []).length"
                class="thinking__summary"
              >调用 {{ (m.toolCalls || []).length }} 次工具</span>
              <ChevronDown v-if="!thinkingExpanded" :size="14" class="thinking__chevron thinking__chevron--down" />
              <ChevronUp v-else :size="14" class="thinking__chevron thinking__chevron--down" />
            </button>
            <div v-show="thinkingExpanded" class="thinking__body">
              <div v-if="m.reasoning" class="thinking__reason">{{ m.reasoning }}</div>
              <!-- 工具调用时间线 -->
              <ul v-if="(m.toolCalls || []).length" class="timeline">
                <li
                  v-for="(t, ti) in (m.toolCalls || [])"
                  :key="ti"
                  class="timeline__item"
                  :class="{
                    'timeline__item--done': t.status === 'done' && !isToolFailed(t),
                    'timeline__item--failed': t.status === 'done' && isToolFailed(t),
                    'timeline__item--running': t.status !== 'done'
                  }"
                >
                  <span class="timeline__connector" aria-hidden="true"></span>
                  <div class="timeline__card">
                    <div class="timeline__accent" aria-hidden="true"></div>
                    <div class="timeline__content">
                      <div class="timeline__head">
                        <span class="timeline__icon">
                          <component :is="toolIcon(t.name)" :size="14" />
                        </span>
                        <span class="timeline__name" :title="t.name">{{ t.name }}</span>
                        <button
                          v-if="t.status === 'done' && isToolFailed(t)"
                          type="button"
                          class="timeline__retry"
                          :class="{ 'timeline__retry--spin': retrying.has(String(ti)) }"
                          :disabled="retrying.has(String(ti))"
                          :title="retrying.has(String(ti)) ? '重试中' : '重试工具 ' + t.name"
                          :aria-label="'重试工具 ' + t.name"
                          @click="onRetryTool(t, ti)"
                        >
                          <Loader2 v-if="retrying.has(String(ti))" :size="12" class="timeline__spin" />
                          <Redo2 v-else :size="12" />
                          <span>重试</span>
                        </button>
                        <span
                          class="timeline__status"
                          :class="{
                            'timeline__status--done': t.status === 'done' && !isToolFailed(t),
                            'timeline__status--failed': t.status === 'done' && isToolFailed(t),
                            'timeline__status--running': t.status !== 'done'
                          }"
                        >
                          <CheckCircle2 v-if="t.status === 'done' && !isToolFailed(t)" :size="11" />
                          <AlertCircle v-else-if="t.status === 'done' && isToolFailed(t)" :size="11" />
                          <Loader2 v-else :size="11" class="timeline__spin" />
                          <span>{{ t.status !== 'done' ? '执行中' : (isToolFailed(t) ? '失败' : '完成') }}</span>
                        </span>
                      </div>
                      <div v-if="Object.keys(t.args || {}).length" class="timeline__args">
                        <span v-for="(v, k) in t.args" :key="k" class="timeline__arg">
                          <span class="timeline__arg-key">{{ k }}</span>
                          <span class="timeline__arg-val" :title="typeof v === 'string' ? v : JSON.stringify(v)">
                            {{ typeof v === 'string' ? v : JSON.stringify(v) }}
                          </span>
                        </span>
                      </div>
                      <div v-if="t.status === 'done' && t.result" class="timeline__result">
                        <button
                          type="button"
                          class="timeline__result-toggle"
                          :aria-expanded="resultExpanded.has(String(ti))"
                          @click="toggleResult(ti)"
                        >
                          <IconChevronDown
                            :size="12"
                            class="timeline__result-chevron"
                            :class="{ 'timeline__result-chevron--expanded': resultExpanded.has(String(ti)) }"
                          />
                          <span>{{ resultExpanded.has(String(ti)) ? '收起结果' : '查看结果' }}</span>
                        </button>
                        <Transition name="timeline-result">
                          <pre v-show="resultExpanded.has(String(ti))" class="timeline__result-body">{{ clip(t.result, 1200) }}</pre>
                        </Transition>
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <div
            class="bubble__markdown"
            @click="onMarkdownClick && onMarkdownClick($event)"
            v-html="markdownHtml"
          ></div>

          <!-- 子任务入口 -->
          <div v-if="m.subAgentRefs && m.subAgentRefs.length" class="subagent-refs">
            <button
              v-for="ref in m.subAgentRefs"
              :key="ref.id"
              type="button"
              class="subagent-ref"
              :class="'subagent-ref--' + (ref.status || 'start')"
              @click="openSubAgent(ref.id)"
            >
              <ListTree :size="13" />
              <span class="subagent-ref__title">{{ ref.title }}</span>
              <span class="subagent-ref__status">{{ ref.status === 'end' ? '✓' : (ref.status === 'skipped' ? '已跳过' : '执行中') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作条 -->
    <div v-if="!readonly" class="msg__actions msg__actions--ai">
      <button
        class="msg__action"
        type="button"
        :disabled="m.done === false"
        :aria-label="copiedSet.has(m.id) ? '已复制' : '复制内容'"
        :title="m.done === false ? '思考/生成中，完成后可复制' : (copiedSet.has(m.id) ? '已复制' : '复制')"
        @click="m.done !== false && copyContent(m.content)"
      >
        <Check v-if="copiedSet.has(m.id)" :size="14" />
        <Copy v-else :size="14" />
      </button>
      <button
        class="msg__action"
        type="button"
        :disabled="m.done === false"
        title="重新生成此回答"
        aria-label="重新生成"
        @click="m.done !== false && onRegenerateMsg()"
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
</template>

<style scoped lang="less">
@import './messageBase.less';
</style>
