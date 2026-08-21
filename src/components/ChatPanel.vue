<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { streamChat } from '../api/agent.js'
import {
  activeProjectId,
  getActiveProject,
  setActiveProject,
  fetchProjects,
} from '../projects.js'
import {
  sessions,
  NO_PROJECT_KEY,
  fetchSessions,
  createSession,
  updateSession,
} from '../sessions.js'
import { settings, flattenVendors } from '../settings.js'
import { fetchSkills, fetchFileTools } from '../api/agent.js'
import { onBus, emitBus } from '../bus.js'
import ChatLogDrawer from './ChatLogDrawer.vue'
import ChatHeader from './chat/ChatHeader.vue'
import MessageList from './chat/MessageList.vue'
import ComposerInput from './chat/ComposerInput.vue'
import AddProjectModal from './chat/AddProjectModal.vue'

const error = ref('')
const loading = ref(false)

// 思考强度 / 权限级别（共享 settings 实例）
const effort = computed({
  get: () => settings.effort || 'medium',
  set: (v) => (settings.effort = v),
})
const permission = computed({
  get: () => settings.permission || 'full',
  set: (v) => (settings.permission = v),
})

// 当前激活项目
const active = computed(() => getActiveProject())
const activeSession = computed(() =>
  sessions.list.find((s) => s.id === sessions.activeSessionId)
)
const currentMessages = computed(() => activeSession.value?.messages || [])

const showLog = ref(false)
const showAdd = ref(false)
const router = useRouter()

// 添加项目表单
const form = ref({ alias: '', path: '' })
const formError = ref('')
const dirPickerSupported = 'showDirectoryPicker' in window
const dirPickerHint = dirPickerSupported
  ? '点击「选择文件夹」从浏览器选择目录；或在输入框手动粘贴绝对路径'
  : '当前浏览器不支持文件夹选择，请在下方输入框手动粘贴项目的绝对路径（如 C:/Users/you/my-project）'

// 基础工具清单：由后端 /api/tools 自动扫描（server/lib/fileTools.js 中 buildTools 声明的全部工具），
// 默认对所有会话启用（无需用户在输入框中勾选），模型可自动调用。新增工具会自动出现，无需前端硬编码。
const baseTools = ref([])
const availableSkills = ref([])
const availableMcp = computed(() => {
  const mcp = settings.mcpServers || {}
  const disabled = new Set(Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : [])
  return Object.entries(mcp)
    .filter(([name, cfg]) => cfg && cfg.enabled !== false && !disabled.has(name))
    .map(([name]) => name)
})

async function loadAvailableSkills() {
  const { skills } = await fetchSkills()
  const enabled = new Set(Array.isArray(settings.enabledSkills) ? settings.enabledSkills : [])
  availableSkills.value = skills
    .filter((s) => enabled.has(s.id))
    .map((s) => ({ key: s.id, name: s.name }))
}

// 从后端自动拉取基础文件工具清单（server/lib/fileTools.js 声明的全部工具）
async function loadBaseTools() {
  const { tools } = await fetchFileTools()
  baseTools.value = Array.isArray(tools) ? tools : []
}

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

// 在输入框上方新增会话：有项目则创建项目对话，否则创建通用对话
async function newProjectChat() {
  const pid = active.value?.id || NO_PROJECT_KEY
  if (pid === NO_PROJECT_KEY) activeProjectId.id = ''
  const session = await createSession(pid)
  if (session?.id) router.push('/chat/' + session.id)
}

function openAdd() {
  showAdd.value = true
}

// 添加项目弹窗确认后，由容器切换到新项目
async function onConfirmAdd(project) {
  await switchProject(project.id)
}

const composerRef = ref(null)

// 发送：组装与服务调用在容器；前置检查与 DOM 已由 ComposerInput 处理
async function send(payload) {
  const { composerTokens, sessionToolCmds, selectedSkills, selectedMcp } = payload

  // 确保基础工具清单已加载（首次进入尚未拉取时兜底）
  if (!baseTools.value.length) await loadBaseTools()

  const tagToolKeys = new Set()
  const tagSkillIds = new Set()
  const tagMcpNames = new Set()
  const bodyParts = []
  for (const t of composerTokens) {
    if (t.type === 'text') {
      bodyParts.push(t.text)
    } else if (t.type === 'tag') {
      if (t.kind === 'tool' && baseTools.value.some((b) => b.key === t.key)) {
        tagToolKeys.add(t.key) // 工具
        bodyParts.push(`/${t.label || t.key}`) // 与输入框 chip 显示一致
      } else if (t.kind === 'skill') {
        tagSkillIds.add(t.key)
        bodyParts.push(`/${t.label || t.key}`)
      } else if (t.kind === 'mcp') {
        tagMcpNames.add(t.key)
        bodyParts.push(`⌘/${t.label || t.key}`) // ⌘ 图标 + 工具名
      } else {
        // 普通文件 / 文件夹：保留 @路径 引用在正文中
        bodyParts.push(`@${t.key}`)
      }
    }
  }
  let text = bodyParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!text || loading.value) return

  // 与旧式 sessionToolCmds/selectedSkills/selectedMcp 合并（保留兼容）
  const cmdSet = new Set([...sessionToolCmds, ...tagToolKeys])
  const fileTools = baseTools.value.map((t) => t.key).filter((k) => cmdSet.has(k))
  const skillIds = [...new Set([...selectedSkills, ...tagSkillIds].filter((k) =>
    availableSkills.value.some((s) => s.key === k)))]
  const mcpNames = [...new Set([...selectedMcp, ...tagMcpNames].filter((k) =>
    availableMcp.value.includes(k)))]
  const mcpServersPayload = Object.fromEntries(
    mcpNames
      .map((n) => [n, (settings.mcpServers || {})[n]])
      .filter(([, cfg]) => cfg)
  )
  // 若只有引用（tag）而无正文，则以占位提示发送，让 Agent 使用所选内容
  if (!text && (fileTools.length || skillIds.length || mcpNames.length || composerTokens.some((t) => t.type === 'tag'))) {
    text = '（请使用所选内容完成任务）'
  }

  // 没有活动会话则新建
  if (!sessions.activeSessionId) {
    await createSession(activeProjectId.id || NO_PROJECT_KEY)
  }
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return

  const pid = active.value?.id ?? null
  error.value = ''
  // 保存结构化 token（文本/工具/技能/MCP/文件），供气泡渲染样式化 chip
  const tags = composerTokens.map((t) => ({
    type: t.type,
    ...(t.type === 'tag' ? { kind: t.kind, key: t.key, label: t.label || t.key } : { text: t.text }),
  }))
  session.messages.push({ role: 'user', content: text, tags, metadata: { timestamp: Date.now() } })
  // 清空富文本输入框（委托子组件）
  composerRef.value?.clear()

  const assistant = reactive({
    role: 'assistant',
    content: '',
    reasoning: '',
    reasoningDone: false,
    done: false, // 思考+生成全部完成（或出错）后才允许复制
    toolCalls: [], // [{ name, args, status, result }]
    metadata: {},
  })
  session.messages.push(assistant)
  loading.value = true

  const history = session.messages
    .filter((m) => m !== assistant)
    .map((m) => ({ role: m.role, content: m.content }))

  // activeModel 为组合键 "vendorKey/modelId"，作为模型标识传给后端以定位密钥，
  // 密钥由后端从服务端配置解析，前端不再传递 apiKey 明文
  const activeModelKey = settings.activeModel // 组合键 vendorKey/modelId
  const activeModelId = activeModelKey.includes('/') ? activeModelKey.split('/')[1] : activeModelKey
  const modelId = (pid && active.value.modelId) || activeModelId
  const flat = flattenVendors(settings.vendors)
  const modelObj = flat.find((m) => m.id === modelId) || {}

  // 工具调用时间线：按 id/name 维护进行中的条目
  const toolRunById = new Map()

  await streamChat(history, {
    config: {
      model: activeModelKey, // 发送组合键，便于后端解析 apiKey
      temperature: typeof modelObj.temperature === 'number' ? modelObj.temperature : 0.3,
      maxTokens: modelObj.maxTokens || undefined,
    },
    projectId: pid,
    permission: permission.value,
    effort: effort.value,
    tools: fileTools,
    skills: skillIds,
    mcpServers: Object.keys(mcpServersPayload).length ? mcpServersPayload : undefined,
    onReasoning: (text) => {
      assistant.reasoning += text
    },
    onToolCall: (payload) => {
      if (payload.status === 'start') {
        const entry = reactive({
          name: payload.name,
          args: payload.args || {},
          status: 'running',
          result: '',
        })
        assistant.toolCalls.push(entry)
        toolRunById.set(payload.name + ':' + assistant.toolCalls.length, entry)
      } else {
        // 找到匹配的 running 条目（按 name，最近一个未完成）回填结果
        const running = [...assistant.toolCalls].reverse().find((t) => t.name === payload.name && t.status === 'running')
        if (running) {
          running.status = 'done'
          running.result = payload.result || ''
        }
      }
    },
    onDelta: (delta) => {
      // 进入正式回复：思考阶段结束，收起思考区
      if (!assistant.reasoningDone && assistant.reasoning) assistant.reasoningDone = true
      assistant.content += delta
    },
    onDone: async (meta) => {
      loading.value = false
      assistant.reasoningDone = true
      assistant.done = true
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
    },
    onError: (msg) => {
      error.value = msg
      assistant.reasoningDone = true
      assistant.done = true
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

// 切换项目
async function init() {
  await Promise.all([fetchProjects(), fetchSessions()])
  await Promise.all([loadAvailableSkills(), loadBaseTools()])
}

onMounted(init)

// 监听全局事件：侧边栏"添加项目"入口会触发 open-add-project
onMounted(() => onBus('open-add-project', () => openAdd()))
</script>

<template>
  <div class="chat">
    <ChatHeader :active-session="activeSession" @open-log="showLog = true" />

    <MessageList :messages="currentMessages" :active="active" :error="error" />

    <ComposerInput
      ref="composerRef"
      :active="active"
      :loading="loading"
      :available-skills="availableSkills"
      @send="send"
      @open-add="openAdd"
      @new-project-chat="newProjectChat"
    />

    <AddProjectModal
      :show="showAdd"
      :dir-picker-supported="dirPickerSupported"
      :dir-picker-hint="dirPickerHint"
      @update:show="showAdd = $event"
      @confirm="onConfirmAdd"
    />

    <ChatLogDrawer
      :open="showLog"
      :session="activeSession"
      @update:open="showLog = $event"
    />
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
