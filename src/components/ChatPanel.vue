<script setup>
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { streamChat } from '../api/agent.js'
import { settings } from '../settings.js'
import {
  projects,
  activeProjectId,
  fetchProjects,
  addProject,
  removeProject,
  setActiveProject,
  getActiveProject,
} from '../projects.js'

marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})

// 每个项目的对话历史：projectId -> [{role, content}]
const conversations = reactive({})
function convOf(pid) {
  if (!conversations[pid]) conversations[pid] = []
  return conversations[pid]
}

const input = ref('')
const loading = ref(false)
const error = ref('')
const scrollEl = ref(null)

// 添加项目弹窗
const showAdd = ref(false)
const form = reactive({ alias: '', path: '', modelId: '' })
const formError = ref('')

const active = computed(() => getActiveProject())

function currentMessages() {
  return active.value ? convOf(active.value.id) : []
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
  form.modelId = settings.activeModel
  formError.value = ''
  showAdd.value = true
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
      modelId: form.modelId || undefined,
    })
    showAdd.value = false
    setActiveProject(p.id)
  } catch (e) {
    formError.value = e.message
  }
}

function selectProject(id) {
  setActiveProject(id)
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return
  const pid = active.value?.id
  const conv = convOf(pid)

  error.value = ''
  conv.push({ role: 'user', content: text })
  input.value = ''

  const assistant = reactive({ role: 'assistant', content: '' })
  conv.push(assistant)
  loading.value = true
  await scrollToBottom()

  const history = conv
    .filter((m) => m !== assistant)
    .map((m) => ({ role: m.role, content: m.content }))

  // 取当前模型对象，优先用其专属 baseUrl / apiKey，回退全局设置
  const modelId = (pid && active.value.modelId) || settings.activeModel
  const modelObj = settings.models.find((m) => m.id === modelId) || {}
  const effectiveBaseUrl = modelObj.baseUrl?.trim() || settings.baseUrl
  const effectiveApiKey = (modelObj.apiKey && modelObj.apiKey.trim()) || settings.apiKey

  await streamChat(history, {
    config: {
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: modelId,
      temperature: settings.temperature,
      maxTokens: modelObj.maxTokens || undefined,
    },
    projectId: pid,
    onDelta: (delta) => {
      assistant.content += delta
      scrollToBottom()
    },
    onDone: () => {
      loading.value = false
      scrollToBottom()
    },
    onError: (msg) => {
      error.value = msg
      loading.value = false
    },
  })
}

onMounted(fetchProjects)
watch(activeProjectId, scrollToBottom)
</script>

<template>
  <div class="chat">
    <header class="chat__header">
      <span v-if="active">📁 {{ active.alias }}</span>
      <span v-else>Code Agent · 工作区</span>
      <button v-if="active" class="chat__back" @click="setActiveProject('')">← 项目列表</button>
    </header>

    <!-- 项目列表视图 -->
    <div v-if="!active" class="chat__body">
      <div class="proj-grid">
        <div
          v-for="p in projects.list"
          :key="p.id"
          class="proj-card"
          @click="selectProject(p.id)"
        >
          <div class="proj-card__top">
            <span class="proj-card__alias">{{ p.alias }}</span>
            <button
              class="proj-card__del"
              @click.stop="removeProject(p.id)"
              title="删除项目"
            >×</button>
          </div>
          <div class="proj-card__path">{{ p.path }}</div>
          <div class="proj-card__model">模型：{{ p.modelId || '（未绑定，用设置默认）' }}</div>
        </div>

        <button class="proj-card proj-card--add" @click="openAdd">＋ 添加项目</button>
      </div>

      <p v-if="projects.list.length === 0" class="chat__empty">
        还没有项目。点击「＋ 添加项目」，填写别名和本地代码目录，<br />
        之后即可让 Agent 读取 / 修改你的项目代码。
      </p>
    </div>

    <!-- 对话视图 -->
    <div v-else class="chat__body" ref="scrollEl">
      <div v-if="currentMessages().length === 0" class="chat__empty">
        已连接到项目「{{ active.alias }}」。<br />
        让 Agent 帮你读代码、改 bug、加功能，例如：<br />
        “列出 src 目录结构” / “在 App.vue 里加一个按钮”
      </div>

      <div
        v-for="(m, i) in currentMessages()"
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

    <div v-if="active" class="chat__modelbar">
      <span class="chat__modelbar-label">模型</span>
      <select v-model="settings.activeModel" class="chat__model-select">
        <option v-for="m in settings.models" :key="m.id" :value="m.id">
          {{ m.name }}（{{ m.id }}）
        </option>
      </select>
    </div>

    <div v-if="active" class="chat__input">
      <textarea
        v-model="input"
        rows="4"
        placeholder="输入你的编程需求，Enter 发送，Shift+Enter 换行"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button :disabled="loading" @click="send">
        {{ loading ? '生成中' : '发送' }}
      </button>
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
          <span>目录路径（本地代码目录的绝对路径）</span>
          <input v-model="form.path" placeholder="如：C:/Users/kathi/Desktop/my-app" />
        </label>
        <label class="field">
          <span>绑定模型（可选，默认用设置里的当前模型）</span>
          <select v-model="form.modelId">
            <option value="">（使用设置默认模型）</option>
            <option v-for="m in settings.models" :key="m.id" :value="m.id">
              {{ m.name }}（{{ m.id }}）
            </option>
          </select>
        </label>
        <small v-if="formError" class="model-add__error">{{ formError }}</small>
        <div class="modal__actions">
          <button class="btn" @click="showAdd = false">取消</button>
          <button class="btn btn--primary" @click="confirmAdd">添加</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  width: 100%;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.chat__header {
  padding: 14px 18px;
  font-weight: 600;
  border-bottom: 1px solid #e5e7eb;
  background: #0f172a;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chat__back {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.chat__body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  background: #f8fafc;
}
.chat__empty {
  color: #94a3b8;
  text-align: center;
  margin-top: 40px;
  line-height: 1.8;
}
.proj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  max-width: 1100px;
  margin: 0 auto;
}
.proj-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  text-align: left;
}
.proj-card:hover {
  border-color: #2563eb;
  box-shadow: 0 2px 10px rgba(37, 99, 235, 0.12);
}
.proj-card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.proj-card__alias {
  font-weight: 600;
  font-size: 15px;
  color: #1f2937;
  word-break: break-all;
}
.proj-card__del {
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}
.proj-card__del:hover {
  color: #dc2626;
}
.proj-card__path {
  font-size: 12px;
  color: #6b7280;
  margin-top: 6px;
  word-break: break-all;
  font-family: monospace;
}
.proj-card__model {
  font-size: 12px;
  color: #2563eb;
  margin-top: 4px;
}
.proj-card--add {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2563eb;
  border-style: dashed;
  font-size: 15px;
  font-weight: 600;
}
.msg {
  margin-bottom: 16px;
  max-width: 92%;
}
.msg--user {
  margin-left: auto;
}
.msg__role {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 4px;
}
.msg__content {
  padding: 12px 14px;
  border-radius: 10px;
  line-height: 1.6;
  font-size: 14px;
  word-break: break-word;
}
.msg--user .msg__content {
  background: #2563eb;
  color: #fff;
}
.msg--ai .msg__content {
  background: #fff;
  border: 1px solid #e5e7eb;
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
  background: #eef2f7;
  padding: 2px 5px;
  border-radius: 4px;
}
.typing {
  color: #94a3b8;
}
.chat__error {
  color: #dc2626;
  font-size: 13px;
  margin-bottom: 12px;
}
.chat__modelbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}
.chat__modelbar-label {
  font-size: 13px;
  color: #64748b;
  font-weight: 600;
  flex-shrink: 0;
}
.chat__model-select {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fff;
  max-width: 340px;
}
.chat__model-select:focus {
  border-color: #2563eb;
}
.chat__input {
  display: flex;
  gap: 12px;
  padding: 16px 18px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  align-items: stretch;
}
.chat__input textarea {
  flex: 1;
  resize: none;
  padding: 14px 16px;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  font-size: 15px;
  line-height: 1.6;
  outline: none;
}
.chat__input textarea:focus {
  border-color: #2563eb;
}
.chat__input button {
  padding: 0 20px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.chat__input button:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
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
}
.modal .field {
  display: block;
  margin-bottom: 14px;
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
