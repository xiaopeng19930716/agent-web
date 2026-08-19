<script setup>
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { Shield, Brain, Plus } from 'lucide-vue-next'
import { Button as AButton } from 'ant-design-vue'
import { streamChat } from '../api/agent.js'
import ChatLogDrawer from './ChatLogDrawer.vue'
import { settings, flattenVendors } from '../settings.js'
import {
  projects,
  activeProjectId,
  fetchProjects,
  addProject,
  removeProject,
  setActiveProject,
  getActiveProject,
} from '../projects.js'
import {
  sessions,
  fetchSessions,
  createSession,
  updateSession,
  deleteSession,
  NO_PROJECT_KEY,
} from '../sessions.js'

marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})

const input = ref('')
const loading = ref(false)
const error = ref('')
const scrollEl = ref(null)

// 对话框内设置：思考强度 / 权限级别
const effort = ref('medium') // low | medium | high
const permission = ref('full') // full(完全访问) | read-only(只读) | none(不允许)

// 添加项目弹窗
const showAdd = ref(false)
const form = reactive({ alias: '', path: '', displayName: '' })
const formError = ref('')
const dirPickerSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const dirPickerHint = computed(() =>
  dirPickerSupported
    ? '点击右侧"选择文件夹"按钮，从电脑中选择项目目录'
    : '当前浏览器不支持选择文件夹，无法添加项目'
)
const canConfirm = computed(() => !!form.alias.trim() && !!form.path.trim())

async function pickDirectory() {
  if (!dirPickerSupported) return
  try {
    const handle = await window.showDirectoryPicker()
    const dirName = handle.name
    formError.value = '正在定位目录…'
    // 浏览器不暴露绝对路径，让后端按名称在常见根目录搜索
    try {
      const resp = await fetch('/api/locate-dir?name=' + encodeURIComponent(dirName))
      if (resp.ok) {
        const data = await resp.json()
        if (data.results && data.results.length) {
          form.path = data.results[0]
          formError.value = ''
          return
        }
      }
    } catch {
      // 定位失败，回退到手动输入
    }
    form.path = dirName
    formError.value = '未能自动定位到完整路径，请在输入框手动补全绝对路径（如 C:/Users/.../' + dirName + '）'
  } catch (e) {
    // 用户取消选择
  }
}

const active = computed(() => getActiveProject())

// 模型按供应商分组
const PRESET_VENDOR_NAMES = {
  'bailian-coding': '阿里云百炼 · Coding Plan',
  'bailian-token': '阿里云百炼 · Token Plan',
  deepseek: 'DeepSeek',
  zhipu: '智谱 GLM · Coding Plan',
  tencent: '腾讯混元 · Coding',
}
// 合并预置供应商名 + 自定义供应商名（自定义用填写时的 name）
const vendorNameMap = computed(() => {
  const m = { ...PRESET_VENDOR_NAMES }
  const customs = Array.isArray(settings.customVendors) ? settings.customVendors : []
  for (const v of customs) {
    if (v && v.key) m[v.key] = v.name || v.key
  }
  return m
})
function vendorLabel(vk) {
  if (!vk) return '其他 / 自定义'
  return vendorNameMap.value[vk] || vk
}
const groupedModels = computed(() => {
  const list = flattenVendors(settings.vendors)
  const disabled = new Set(Array.isArray(settings.disabledVendors) ? settings.disabledVendors : [])
  const groups = new Map()
  for (const m of list) {
    const key = m.vendorKey || '__custom__'
    if (key !== '__custom__' && disabled.has(key)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === '__custom__') return 1
    if (b === '__custom__') return -1
    return (vendorNameMap[a] || a).localeCompare(vendorNameMap[b] || b, 'zh')
  })
  return order.map((k) => ({ key: k, label: vendorLabel(k), items: groups.get(k) }))
})

// 当前会话对象
const activeSession = computed(() => sessions.list.find((s) => s.id === sessions.activeSessionId) || null)
const currentMessages = computed(() => (activeSession.value ? activeSession.value.messages : []))
const showLog = ref(false)

// 会话标题重命名
const editingTitle = ref(false)
const titleDraft = ref('')
function startRenameTitle() {
  if (!activeSession.value) return
  titleDraft.value = activeSession.value.title || '新对话'
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
  const s = activeSession.value
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

function renderMarkdown(text) {
  return marked.parse(text || '')
}

async function scrollToBottom() {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

function openAdd() {
  form.alias = ''
  form.path = ''
  form.displayName = ''
  formError.value = ''
  showAdd.value = true
}

// 取路径最后一级目录名
function lastSegment(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

async function confirmAdd() {
  if (!form.alias.trim() || !form.path.trim()) {
    formError.value = '别名和目录路径不能为空'
    return
  }
  try {
    const p = await addProject({
      alias: form.alias.trim(),
      path: form.path.trim(),
    })
    showAdd.value = false
    // 添加后切换到新项目对应的会话（无则新建）
    await switchProject(p.id)
  } catch (e) {
    formError.value = e.message
  }
}

// 顶栏项目下拉已移除：保留 switchProject 以便切换会话时复用
async function switchProject(pid) {
  setActiveProject(pid === NO_PROJECT_KEY ? null : pid)
  const target = pid
  const existing = sessions.list
    .filter((s) => (s.projectId || NO_PROJECT_KEY) === target)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  if (existing) {
    sessions.activeSessionId = existing.id
  } else {
    await createSession(target)
  }
}

async function newChat() {
  await createSession(activeProjectId.id || NO_PROJECT_KEY)
}

// 在当前项目中新增对话（项目名右侧的 + 按钮）
async function newProjectChat() {
  if (!active.value) return
  await createSession(active.value.id)
}

function deleteCurrent() {
  if (!sessions.activeSessionId) return
  deleteSession(sessions.activeSessionId)
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  // 没有活动会话则新建
  if (!sessions.activeSessionId) {
    await createSession(activeProjectId.id || NO_PROJECT_KEY)
  }
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return

  const pid = active.value?.id ?? null
  error.value = ''
  session.messages.push({ role: 'user', content: text, metadata: { timestamp: Date.now() } })
  input.value = ''

  const assistant = reactive({ role: 'assistant', content: '', metadata: {} })
  session.messages.push(assistant)
  loading.value = true
  await scrollToBottom()

  const history = session.messages
    .filter((m) => m !== assistant)
    .map((m) => ({ role: m.role, content: m.content }))

  // activeModel 为组合键 "vendorKey/modelId"
  const activeModelId = settings.activeModel.includes('/') ? settings.activeModel.split('/')[1] : settings.activeModel
  const modelId = (pid && active.value.modelId) || activeModelId
  const flat = flattenVendors(settings.vendors)
  const modelObj = flat.find((m) => m.id === modelId) || {}
  const effectiveBaseUrl = modelObj.baseUrl?.trim() || settings.baseUrl
  const effectiveApiKey = (modelObj.apiKey && modelObj.apiKey.trim()) || settings.apiKey

  await streamChat(history, {
    config: {
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: modelId,
      temperature: typeof modelObj.temperature === 'number' ? modelObj.temperature : 0.3,
      maxTokens: modelObj.maxTokens || undefined,
    },
    projectId: pid,
    permission: permission.value,
    effort: effort.value,
    onDelta: (delta) => {
      assistant.content += delta
      scrollToBottom()
    },
    onDone: async (meta) => {
      loading.value = false
      // 回填助手消息的元数据日志（时间、模型、token、耗时、状态）
      assistant.metadata = {
        timestamp: Date.now(),
        model: meta?.model || modelId,
        tokens: meta?.tokens ?? null,
        durationMs: meta?.durationMs ?? null,
        status: meta?.status || 'ok',
      }
      // 首条消息作为标题 + 落盘
      if (!session.title || session.title === '新对话') {
        session.title = text.slice(0, 30) || '新对话'
      }
      await updateSession(session.id, { title: session.title, messages: session.messages })
      scrollToBottom()
    },
    onError: (msg) => {
      error.value = msg
      assistant.metadata = {
        timestamp: Date.now(),
        model: modelId,
        tokens: null,
        durationMs: null,
        status: 'error',
      }
      loading.value = false
    },
  })
}

onMounted(async () => {
  await fetchProjects()
  try {
    await fetchSessions()
  } catch (e) {
    console.error('加载会话失败:', e)
  }
  // 首次进入：选中当前项目最近会话或新建
  if (!sessions.activeSessionId) {
    await switchProject(activeProjectId.id || NO_PROJECT_KEY)
  }
})

watch(currentMessages, scrollToBottom)
</script>

<template>
  <div class="chat">
    <!-- 当前会话标题（双击改名） -->
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
        class="chat__log-btn"
        size="small"
        @click="showLog = true"
      >对话日志</a-button>
    </div>

    <!-- 对话区（深色） -->
    <div class="chat__body" ref="scrollEl">
      <div v-if="currentMessages.length === 0" class="chat__empty">
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
        v-for="(m, i) in currentMessages"
        :key="i"
        class="msg"
        :class="m.role === 'user' ? 'msg--user' : 'msg--ai'"
      >
        <div class="msg__role">{{ m.role === 'user' ? '你' : 'Agent' }}</div>
        <div class="msg__content" v-html="renderMarkdown(m.content)"></div>
      </div>

      <div v-if="loading" class="msg msg--ai">
        <div class="msg__role">Agent</div>
        <div class="msg__content typing">思考 / 操作中…</div>
      </div>

      <div v-if="error" class="chat__error">{{ error }}</div>
    </div>

    <!-- 复合输入框：+ / 模型 / 思考 / 权限 / textarea / 发送 全部内嵌 -->
    <div class="chat__input">
      <div class="chat__input-top">
        <button v-if="!active" class="chat__add" title="添加项目" @click="openAdd">＋</button>
        <span v-else class="chat__project-badge" :title="active.path">{{ lastSegment(active.path) }}</span>
        <button
          v-if="active"
          class="chat__newproj"
          title="在当前项目中新增对话"
          @click="newProjectChat"
        >
          <Plus :size="14" />
        </button>
        <div class="chat__input-top-right">
          <a-select
            v-model:value="settings.activeModel"
            class="chat__model-select"
            size="middle"
            :dropdown-match-select-width="false"
            title="切换模型"
          >
            <a-select-opt-group v-for="g in groupedModels" :key="g.key" :label="g.label">
              <a-select-option v-for="m in g.items" :key="m.id" :value="m.id">
                {{ m.name }}（{{ m.id }}）
              </a-select-option>
            </a-select-opt-group>
          </a-select>

          <div class="toolbar-chip" title="思考强度">
            <Brain :size="14" />
            <a-select v-model:value="effort" size="small" class="chip-select" :dropdown-match-select-width="false">
              <a-select-option value="low">低</a-select-option>
              <a-select-option value="medium">中</a-select-option>
              <a-select-option value="high">高</a-select-option>
            </a-select>
          </div>

          <div class="toolbar-chip" title="权限级别">
            <Shield :size="14" />
            <a-select v-model:value="permission" size="small" class="chip-select" :dropdown-match-select-width="false">
              <a-select-option value="full">完全访问</a-select-option>
              <a-select-option value="read-only">只读</a-select-option>
              <a-select-option value="none">不允许</a-select-option>
            </a-select>
          </div>
        </div>
      </div>

      <textarea
        v-model="input"
        rows="2"
        placeholder="输入你的编程需求，Enter 发送，Shift+Enter 换行"
        @keydown.enter.exact.prevent="send"
      ></textarea>

      <div class="chat__input-bottom">
        <button class="chat__send" :disabled="loading" @click="send">
          {{ loading ? '生成中' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 添加项目弹窗 -->
    <div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
      <div class="modal">
        <h3>添加项目</h3>
        <label class="field">
          <span>别名（显示用）</span>
          <input v-model="form.alias" placeholder="如：我的前端项目" />
        </label>
        <label class="field">
          <span>项目目录</span>
          <div class="field-row">
            <input :value="form.displayName" readonly :title="form.path" placeholder="请点击右侧按钮选择目录" />
            <button
              type="button"
              class="btn btn--ghost"
              :disabled="!dirPickerSupported"
              :title="dirPickerHint"
              @click="pickDirectory"
            >
              选择文件夹
            </button>
          </div>
          <small class="field__hint">{{ dirPickerHint }}</small>
        </label>
        <small v-if="formError" class="model-add__error">{{ formError }}</small>
        <div class="modal__actions">
          <button class="btn" @click="showAdd = false">取消</button>
          <button class="btn btn--primary" :disabled="!canConfirm" @click="confirmAdd">添加</button>
        </div>
      </div>
    </div>
  </div>

  <ChatLogDrawer v-model:open="showLog" :session="activeSession" />
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  width: 100%;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #ffffff;
}
.chat__titlebar {
  padding: 12px 24px 0;
  display: flex;
  align-items: center;
  min-height: 40px;
  flex-shrink: 0;
}

.chat__log-btn {
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
  max-width: 90%;
  display: flex;
  flex-direction: column;
}
.msg--user {
  margin-left: auto;
  align-items: flex-end;
}
.msg__role {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 5px;
}
.msg__content {
  padding: 13px 15px;
  border-radius: 12px;
  line-height: 1.65;
  font-size: 14px;
  word-break: break-word;
}
.msg--user .msg__content {
  background: #2563eb;
  color: #fff;
}
.msg--ai .msg__content {
  background: #1e293b;
  border: 1px solid #334155;
  color: #e2e8f0;
}
.msg__content :deep(pre) {
  background: #0d1117;
  color: #e6edf3;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.msg__content :deep(code) {
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
}
.msg__content :deep(p code) {
  background: #334155;
  color: #e2e8f0;
  padding: 2px 5px;
  border-radius: 4px;
}
.typing {
  color: #94a3b8;
}
.chat__error {
  color: #f87171;
  font-size: 13px;
  margin-bottom: 12px;
}
.chat__model-select {
  max-width: 320px;
}
.toolbar-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 8px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
  line-height: 1;
}
.chip-select {
  width: 80px;
  font-size: 12px;
}
.chat__input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 16px 16px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 14px;
}
.chat__input-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat__input-top-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.chat__add {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #475569;
  font-size: 20px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chat__add:hover {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.chat__project-badge {
  display: inline-flex;
  align-items: center;
  max-width: 160px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  background: #f1f5f9;
  color: #1f2937;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.chat__newproj {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  margin-left: -6px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chat__newproj:hover {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.chat__input textarea {
  flex: 1;
  resize: none;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  min-height: 36px;
}
.chat__input textarea::placeholder {
  color: #94a3b8;
}
.chat__input-bottom {
  display: flex;
  justify-content: flex-end;
}
.chat__send {
  height: 36px;
  padding: 0 22px;
  flex-shrink: 0;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: background 0.15s;
}
.chat__send:hover {
  background: #1d4ed8;
}
.chat__send:disabled {
  background: #1e3a8a;
  color: #93c5fd;
  cursor: not-allowed;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 440px;
  max-width: 92vw;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.modal h3 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #1f2937;
}
.modal .field {
  display: block;
  margin-bottom: 14px;
}
.modal .field-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.modal .field-row input {
  flex: 1;
}
.modal .field-row input[readonly] {
  background: #f8fafc;
  color: #475569;
  cursor: default;
}
.modal .field__hint {
  display: block;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}
.modal .field > span {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #374151;
}
.modal .field input,
.modal .field select {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.modal .field input:focus,
.modal .field select:focus {
  border-color: #2563eb;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.btn {
  padding: 9px 18px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--ghost {
  background: #f1f5f9;
  color: #1f2937;
}
.btn--ghost:hover:not(:disabled) {
  background: #e2e8f0;
}
.btn--primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.model-add__error {
  color: #dc2626;
  font-size: 12px;
}
</style>
