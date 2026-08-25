<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Modal, message } from 'ant-design-vue'
import { streamChat, summarizeChat } from '../api/agent.js'
import { buildDiffRows } from '../utils/diff.js'
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
  truncateSession,
} from '../sessions.js'

// 生成稳定消息 id（用于 :key 与回退定位，避免数组下标复用导致的渲染错乱）
function newMsgId() {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
import { settings, flattenVendors } from '../settings.js'
import { fetchSkills, fetchFileTools } from '../api/agent.js'
import { onBus, emitBus } from '../bus.js'
import ChatLogDrawer from './ChatLogDrawer.vue'
import ChatHeader from './chat/ChatHeader.vue'
import MessageList from './chat/MessageList.vue'
import SubAgentPanel from './chat/SubAgentPanel.vue'
import SessionChanges from './chat/SessionChanges.vue'
import TodoPanel from './chat/TodoPanel.vue'
import ComposerInput from './chat/ComposerInput.vue'
import AddProjectModal from './chat/AddProjectModal.vue'
import { confirmToolCall, abortChat } from '../api/agent.js'

const error = ref('')
const loading = ref(false)
// #11 SSE 断流重连状态：显示「连接中断，正在重连…」
const reconnecting = ref(false)
const reconnectInfo = ref({ attempt: 0, max: 0 })

// 「需确认(ask)」模式：后端暂停高风险工具，等待用户允许/拒绝；保存当前待确认的工具调用
const toolConfirm = ref(null)
async function handleToolConfirm(decision) {
  const t = toolConfirm.value
  toolConfirm.value = null
  if (!t) return
  await confirmToolCall({ sessionId: sessions.activeSessionId, id: t.id, decision })
}

// 确认弹窗中把工具参数格式化为可读文本（命令/路径等）
function formatToolArgs(args) {
  if (!args) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

// 停止生成：通知后端中断当前会话的 Agent 循环，并立即结束本地流式渲染
function stopGeneration() {
  abortChat({ sessionId: sessions.activeSessionId })
  loading.value = false
  error.value = ''
}

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

// 上下文进度：当前会话估算 token 用量 / 模型 contextWindow，百分比供 ComposerInput 圆环显示。
// 与会话压缩（compressHistory）用同一套 estimateTokens / 上下文窗口，窗口未填时兜底 32768。
const activeModelMeta = computed(() => {
  const key = settings.activeModel || '' // 组合键 vendorKey/modelId
  const id = key.includes('/') ? key.split('/')[1] : key
  const flat = flattenVendors(settings.vendors)
  const modelObj = flat.find((m) => m.id === id) || {}
  return { modelKey: key, modelId: id, contextWindow: modelObj.contextWindow, modelObj }
})
const contextUsage = computed(() => {
  const usedTokens = currentMessages.value.reduce((s, m) => {
    const content = (typeof m.content === 'string' ? m.content : '')
      + ' ' + (Array.isArray(m.tags) ? m.tags.join(' ') : '')
    return s + estimateTokens(content)
  }, 0)
  const DEFAULT_CONTEXT_WINDOW = 32768
  const cw = Number(activeModelMeta.value.contextWindow) > 0
    ? Number(activeModelMeta.value.contextWindow) : DEFAULT_CONTEXT_WINDOW
  const pct = Math.min(100, Math.max(0, Math.round((usedTokens / cw) * 100)))
  return { usedTokens, contextWindow: cw, pct, modelName: activeModelMeta.value.modelId }
})

// 手动压缩：长按进度环触发。进度 <30% 时先弹确认，确认后把早期消息摘要化、保留最近一段并持久化。
async function onManualCompress() {
  const pct = contextUsage.value.pct
  if (pct < 30) {
    const ok = await new Promise((resolve) => {
      Modal.confirm({
        title: '手动压缩上下文',
        content: `当前上下文占用仅 ${pct}%，远未接近模型窗口上限。确定要现在压缩吗？早期对话会变成一段摘要。`,
        okText: '确定压缩',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
    if (!ok) return
  }
  const done = await manualCompress()
  if (done) message.success('会话已压缩，早期对话已转为摘要')
  else message.info('当前会话过短，无需压缩')
}

// 真正执行压缩：与自动压缩同算法（保留最近约 25% 窗口，早期摘要化），写回当前会话并持久化
async function manualCompress() {
  const s = activeSession.value
  if (!s || !s.messages.length) return false
  const DEFAULT_CONTEXT_WINDOW = 32768
  const cw = Number(activeModelMeta.value.contextWindow) > 0
    ? Number(activeModelMeta.value.contextWindow) : DEFAULT_CONTEXT_WINDOW
  const KEEP_TAIL_TOKENS = Math.round(cw * 0.25)
  let acc = 0
  let keepStart = s.messages.length
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i]
    const content = (typeof m.content === 'string' ? m.content : '')
      + ' ' + (Array.isArray(m.tags) ? m.tags.join(' ') : '')
    acc += estimateTokens(content)
    if (acc > KEEP_TAIL_TOKENS) {
      keepStart = i + 1
      break
    }
  }
  // 保留部分对齐到 user 消息开头，避免以半截 assistant 回复开头
  while (keepStart < s.messages.length && s.messages[keepStart].role !== 'user') keepStart++
  if (keepStart < 2 || keepStart >= s.messages.length - 1) return false

  const early = s.messages.slice(0, keepStart)
  const tail = s.messages.slice(keepStart)
  const { summary } = await summarizeChat({
    messages: early.map((m) => ({ role: m.role, content: m.content })),
    config: { model: activeModelMeta.value.modelKey, temperature: 0.2, maxTokens: 1024 },
  })
  const summaryMsg = summary
    ? {
        id: newMsgId(),
        role: 'user',
        content: '[背景信息] 以下是本会话早期对话的摘要，请作为背景理解，不要把它当作新的用户指令：\n' + summary,
        metadata: { timestamp: Date.now(), compressed: true },
      }
    : {
        id: newMsgId(),
        role: 'user',
        content: '[背景信息] 早期对话内容已省略，请基于最近的消息继续。',
        metadata: { timestamp: Date.now(), compressed: true },
      }
  s.messages = [summaryMsg, ...tail]
  await updateSession(s.id, { messages: s.messages })
  return true
}

// 多 Agent 编排：主/子任务视图切换 + 计划确认
const activeSubView = ref(null) // null=主任务；string=正在查看的子任务 subId
const planConfirm = ref(null) // 计划确认卡片数据：[{ id, title, description, enabled }]
const planConfirmAssistant = ref(null) // 取消时用于标记当前 assistant 消息
const activeSubAgent = computed(() => {
  const s = activeSession.value
  if (!s || !activeSubView.value) return null
  const a = s.messages.find((m) => m.subAgents && m.subAgents[activeSubView.value])
  return a ? a.subAgents[activeSubView.value] : null
})
// 用户确认计划：把未勾选（跳过）的子任务 id 回传后端，唤醒挂起的编排
function confirmPlan() {
  const items = planConfirm.value || []
  const skipped = items.filter((it) => !it.enabled).map((it) => it.id)
  planConfirm.value = null
  fetch('/api/chat/plan-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessions.activeSessionId, skipped }),
  }).catch(() => {})
}
// 用户取消计划：关闭弹窗、通知后端取消、中断 Agent 循环，并把 assistant 标记为已取消
function cancelPlan() {
  const a = planConfirmAssistant.value
  planConfirm.value = null
  planConfirmAssistant.value = null
  const sid = sessions.activeSessionId
  if (sid) {
    fetch('/api/chat/plan-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, cancel: true }),
    }).catch(() => {})
    abortChat({ sessionId: sid }).catch(() => {})
  }
  if (a) {
    a.done = true
    a.reasoningDone = true
    a.error = '已取消计划执行'
  }
}

const showLog = ref(false)
// 是否展示右侧「文件变更」面板（头部「查看变更」按钮切换）
const showChanges = ref(false)
// 是否展示悬浮「任务清单」层（对话中有 todo 数据时自动显示，用户可手动关闭）
const showTodos = ref(false)
const showAdd = ref(false)
const router = useRouter()

// 右侧面板列宽：仅文件变更面板（任务清单已改为悬浮层）
const gridCols = computed(() => (showChanges.value ? '1fr 32vw' : '1fr 0px'))

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
const msgListRef = ref(null)

// 粗略估算文本 token：中日韩等按 1 字符/token，其余按 4 字符/token
// 兼容 #9 多模态 content（数组）：图文混合时累加，图片按固定大值估算
function estimateTokens(content) {
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (part.type === 'text') return sum + estimateTokens(part.text || '')
      if (part.type === 'image_url') return sum + 1000 // 单张图粗略估算
      return sum
    }, 0)
  }
  const text = typeof content === 'string' ? content : String(content || '')
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  return cjk + Math.ceil((text.length - cjk) / 4)
}

// 历史过长时压缩：早期消息 → 摘要（user 角色背景消息），保留最近一段；
// 阈值按模型 contextWindow 动态计算（未填时兜底 32768）；摘要失败降级为截断。
async function compressHistory(history, config) {
  const DEFAULT_CONTEXT_WINDOW = 32768
  const cw = Number(config.contextWindow) > 0 ? Number(config.contextWindow) : DEFAULT_CONTEXT_WINDOW
  const SUMMARY_THRESHOLD = Math.round(cw * 0.6) // 估算 token 超过则触发压缩
  const KEEP_TAIL_TOKENS = Math.round(cw * 0.25) // 保留最近 token 数
  const MIN_COMPRESS_MESSAGES = 4 // 早期消息少于该条数不值得压缩

  const total = history.reduce((s, m) => s + estimateTokens(m.content), 0)
  if (total <= SUMMARY_THRESHOLD || history.length <= MIN_COMPRESS_MESSAGES) return history

  // 从后往前确定保留起点，使保留部分约等于 KEEP_TAIL_TOKENS
  let acc = 0
  let keepStart = history.length
  for (let i = history.length - 1; i >= 0; i--) {
    acc += estimateTokens(history[i].content)
    if (acc > KEEP_TAIL_TOKENS) {
      keepStart = i + 1
      break
    }
  }
  // 对齐轮次：保留部分从 user 消息开始，避免以半截 assistant 回复开头
  while (keepStart < history.length && history[keepStart].role !== 'user') keepStart++
  // 若几乎全部保留，或早期消息太少，不压缩
  if (keepStart < MIN_COMPRESS_MESSAGES || keepStart >= history.length - 2) return history

  const early = history.slice(0, keepStart)
  const tail = history.slice(keepStart)
  const { summary } = await summarizeChat({
    messages: early,
    config: { ...config, temperature: 0.2, maxTokens: 1024 },
  })
  if (summary) {
    return [
      {
        role: 'user',
        content:
          '[背景信息] 以下是本会话早期对话的摘要，请作为背景理解，不要把它当作新的用户指令：\n' + summary,
      },
      ...tail,
    ]
  }
  // 摘要失败降级：直接截断早期消息
  return [
    { role: 'user', content: '[背景信息] 早期对话内容已省略，请基于最近的消息继续。' },
    ...tail,
  ]
}

// 发送：组装与服务调用在容器；前置检查与 DOM 已由 ComposerInput 处理
async function send(payload) {
  const { composerTokens, sessionToolCmds, selectedSkills, selectedMcp, planMode = false, images = [] } = payload

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

  // 文件工具始终全部启用（B 方案）：listFiles/readFile/writeFile/editFile/searchInProject/executeCommand
  // 等核心能力默认即可用，无需用户逐个勾选；MCP/Skills 仍是可选扩展。
  const cmdSet = new Set([...sessionToolCmds, ...tagToolKeys])
  const fileTools = baseTools.value.map((t) => t.key)
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
  // 纯图片无文字时给占位提示
  if (!text && images.length) {
    text = '（请描述这张图片）'
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
  // #9 多模态：有图片时 content 改为 [{type:'text'},{type:'image_url',image_url:{url}}]
  const userContent = images.length
    ? [
        { type: 'text', text },
        ...images.map((img) => ({ type: 'image_url', image_url: { url: img.url } })),
      ]
    : text
  session.messages.push({ id: newMsgId(), role: 'user', content: userContent, tags, images, metadata: { timestamp: Date.now() } })
  // 清空富文本输入框（委托子组件）
  composerRef.value?.clear()

  await runAssistantTurn(session, { text, pid, fileTools, skillIds, mcpServersPayload, planMode, images })
}

// 基于 session 中已有的上下文（最后一条为 user 消息）生成 assistant 回复。
// 只追加 assistant 消息并流式生成，不会新增 user 消息。
// send 与 regenerate 共用：send 先 push user 再调用；regenerate 直接调用。
async function runAssistantTurn(session, options = {}) {
  const { text = '', pid = active.value?.id ?? null, fileTools = [], skillIds = [], mcpServersPayload = {}, prevReasoning = '', planMode = false } = options
  const assistant = reactive({
    id: newMsgId(),
    role: 'assistant',
    content: '',
    // 重做时若模型未返回新推理，复用上一条 assistant 的 reasoning 作为占位，避免空思考区
    reasoning: prevReasoning,
    reasoningDone: false,
    done: false, // 思考+生成全部完成（或出错）后才允许复制
    showThinking: true, // 始终保留思考区（含完成态「✓ 思考完成」），避免生成后思考区消失
    toolCalls: [], // [{ name, args, status, result }]
    plan: null, // 计划模式：[{ id, title, description }]
    subAgentRefs: [], // 子任务入口：[{ id, title, status }]
    subAgents: {}, // 子 Agent 详情：{ [subId]: { id, title, description, status, summary, messages } }
    metadata: {},
  })
  session.messages.push(assistant)
  planConfirmAssistant.value = assistant
  loading.value = true
  let gotNewReasoning = false // 标记模型是否已返回新推理，用于清除重做占位

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

  // 上下文压缩：历史过长时把早期对话摘要化，防止超出模型上下文窗口。
  // 阈值按模型 contextWindow 动态计算（设置面板/接口/内置表兜底），
  // 只影响本次请求，不动 session.messages 持久化；摘要失败自动降级为截断。
  const finalHistory = await compressHistory(history, {
    model: activeModelKey,
    contextWindow: modelObj.contextWindow,
    temperature: typeof modelObj.temperature === 'number' ? modelObj.temperature : 0.3,
    maxTokens: modelObj.maxTokens || undefined,
  })

  // 工具调用时间线：按 id/name 维护进行中的条目
  const toolRunById = new Map()
  const turnStart = Date.now() // 请求发起时刻，用于计算首 token 延迟
  let firstTokenMs = null // 首个 content 字符到达耗时（毫秒），null 表示未收到

  await streamChat(finalHistory, {
    planMode,
    // 高级设置：计划/执行阶段温度（仅 planMode 编排时由后端消费）
    planTemperature: typeof settings.planTemperature === 'number' ? settings.planTemperature : undefined,
    execTemperature: typeof settings.execTemperature === 'number' ? settings.execTemperature : undefined,
    subAgentMaxTurns: typeof settings.subAgentMaxTurns === 'number' ? settings.subAgentMaxTurns : undefined,
    allowReplan: !!settings.allowReplan,
    commandTimeout: typeof settings.commandTimeout === 'number' ? settings.commandTimeout : undefined,
    subModelKey: settings.subModelKey || undefined,
    // 模型设置页里该模型显式配置的温度（未配置为 undefined，供子 Agent 温度优先级判断）
    modelTemperature: typeof modelObj.temperature === 'number' ? modelObj.temperature : undefined,
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
    sessionId: sessions.activeSessionId, // 「需确认」模式回传确认用
    onToolConfirm: (payload) => {
      // 后端暂停高风险工具，等待用户在 Modal 中允许/拒绝
      toolConfirm.value = {
        id: payload.id,
        name: payload.name,
        args: payload.args || {},
        preview: payload.preview || null, // 文件改动的 before/after 或 previewError
      }
    },
    onTodoUpdate: (todos) => {
      // 后端把任务清单状态推过来，写入当前会话（session 持久化由后端负责）
      const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
      if (session) session.todos = todos || []
      // 有任务数据时悬浮层自动显示；空清单不自动弹
      if (Array.isArray(todos) && todos.length) showTodos.value = true
    },
    onReasoning: (text) => {
      // 模型返回新推理时，先清除重做占位（旧 reasoning），避免新旧拼接
      if (!gotNewReasoning) {
        assistant.reasoning = ''
        gotNewReasoning = true
      }
      assistant.reasoning += text
    },
    onToolCall: (payload) => {
      if (payload.status === 'start') {
        const entry = reactive({
          id: payload.id || '',
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
      // 首次收到正文：记录首 token 延迟（请求发起 → 首个 content 字符）
      if (firstTokenMs === null) firstTokenMs = Date.now() - turnStart
      // 进入正式回复：思考阶段结束，收起思考区
      if (!assistant.reasoningDone && assistant.reasoning) assistant.reasoningDone = true
      assistant.content += delta
    },
    // ===== 多 Agent 编排：计划 → 子任务 =====
    onPlan: (payload) => {
      if (payload.items) assistant.plan = payload.items
      // 计划已产出，等待用户确认（可勾选跳过部分子任务）
      if (payload.status === 'await_confirm') planConfirm.value = (payload.items || []).map((it) => ({ ...it, enabled: true }))
    },
    onSubAgentStart: (p) => {
      if (!assistant.subAgents) assistant.subAgents = {}
      assistant.subAgents[p.id] = {
        id: p.id,
        index: p.index,
        title: p.title,
        description: p.description,
        status: p.status || 'start',
        summary: '',
        messages: [],
      }
      if (!assistant.subAgentRefs) assistant.subAgentRefs = []
      if (!assistant.subAgentRefs.find((r) => r.id === p.id)) {
        assistant.subAgentRefs.push({ id: p.id, title: p.title, status: p.status || 'start' })
      }
    },
    onSubAgentDelta: (p) => {
      const sub = assistant.subAgents && assistant.subAgents[p.subId]
      if (!sub) return
      let msg = sub.messages[sub.messages.length - 1]
      if (!msg || msg.done) {
        msg = reactive({ role: 'assistant', content: '', reasoning: '', toolCalls: [], done: false })
        sub.messages.push(msg)
      }
      if (p.delta?.content) msg.content += p.delta.content
      if (p.delta?.reasoning) msg.reasoning += p.delta.reasoning
    },
    onSubAgentTool: (p) => {
      const sub = assistant.subAgents && assistant.subAgents[p.subId]
      if (!sub) return
      let msg = sub.messages[sub.messages.length - 1]
      if (!msg || msg.done) {
        msg = reactive({ role: 'assistant', content: '', reasoning: '', toolCalls: [], done: false })
        sub.messages.push(msg)
      }
      if (p.status === 'start') {
        msg.toolCalls.push(reactive({ id: p.id, name: p.name, args: p.args || {}, status: 'running', result: '' }))
      } else {
        const t = msg.toolCalls.find((x) => x.id === p.id) || msg.toolCalls[msg.toolCalls.length - 1]
        if (t) { t.status = p.status; t.result = p.result || '' }
      }
    },
    onSubAgentEnd: (p) => {
      const sub = assistant.subAgents && assistant.subAgents[p.id]
      if (!sub) return
      sub.status = p.status
      sub.summary = p.summary || ''
      const msg = sub.messages[sub.messages.length - 1]
      if (msg) msg.done = true
      const ref = assistant.subAgentRefs?.find((r) => r.id === p.id)
      if (ref) ref.status = p.status
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
        firstTokenMs, // 首 token 延迟（请求发起→首个正文）
        status: meta?.status || 'ok',
      }
      // 首条消息作为标题 + 落盘
      if (!session.title || session.title === '新对话') {
        session.title = (text || session.messages.find((m) => m.role === 'user')?.content || '').slice(0, 30) || '新对话'
      }
      planConfirmAssistant.value = null
      await updateSession(session.id, { title: session.title, messages: session.messages })
    },
    onError: (msg) => {
      error.value = msg
      reconnecting.value = false
      assistant.reasoningDone = true
      assistant.done = true
      assistant.metadata = {
        timestamp: Date.now(),
        model: modelId,
        tokens: null,
        durationMs: null,
        firstTokenMs,
        status: 'error',
      }
      loading.value = false
      planConfirmAssistant.value = null
    },
    // #11 SSE 断流自动重连：UI 提示 + 本地缓冲重置
    onReconnecting: (attempt, delay, max) => {
      error.value = ''
      reconnecting.value = true
      reconnectInfo.value = { attempt, max }
    },
    onReset: () => {
      // 重连前清空已累积的半成品，模型会从头重新生成，避免内容重复
      assistant.content = ''
      assistant.reasoning = prevReasoning
      assistant.reasoningDone = false
      assistant.toolCalls = []
      firstTokenMs = null
    },
  })
  reconnecting.value = false
}

// ── 对话级回退 ───────────────────────────────────────────────
// 从工具结果字符串里解析 { filePath, backupId }
// writeFile/editFile 结果形如：
//   "已写入: a.txt | backupId=.agent-backup/a.txt.2026-..."  （覆盖/编辑，可还原）
//   "已写入: a.txt | backupId= | created=1"                  （新建，回退时需删除）
function parseFileOp(result, name) {
  if (name !== 'writeFile' && name !== 'editFile') return null
  if (typeof result !== 'string') return null
  // backupId 值不能含空格或 |，避免把 "| created=1" 误吞进来
  const m = result.match(/backupId=([^\s|]*)/)
  const backupId = m ? m[1].trim() : ''
  const fm = result.match(/:\s*(.+?)\s*\|/)
  const filePath = fm ? fm[1].trim() : ''
  if (!filePath) return null
  return { filePath, backupId }
}

// 回退到某条 user 消息之前：删除该 user 消息及其之后所有内容，
// 并同步把这段对话中 Agent 改动/新建的文件一并回退到该消息之前的状态。
async function rollbackTo(msg) {
  if (loading.value) return
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return
  const idx = session.messages.findIndex((m) => m.id === msg.id)
  if (idx < 0) return
  const ok = window.confirm('回退到此处？\n\n这条消息及其之后的所有内容，以及期间被改动/新建的文件都将被撤销。')
  if (!ok) return

  // 截断前，先收集被删消息里所有写/编辑操作的文件信息
  const removed = session.messages.slice(idx)
  // 同一文件只保留首次出现的 op（回退语义：以区间内第一条操作为准，见后端 restore-batch）
  const firstOp = new Map()
  for (const m of removed) {
    if (m.role !== 'assistant') continue
    for (const t of (m.toolCalls || [])) {
      const op = parseFileOp(t.result, t.name)
      if (op && !firstOp.has(op.filePath)) firstOp.set(op.filePath, op)
    }
  }
  const ops = [...firstOp.values()]

  // 截断到该 user 消息之前（不包含它），对话中该消息消失
  await truncateSession(session.id, idx)

  // 文件回退：有备份则还原，新建文件则删除
  // 必须取会话所属 projectId，而不是当前 UI 选中的项目，否则可能删错目录或删空。
  // projectId 为空时后端回退到用户主目录（与工具执行边界一致）。
  const projectId = session.projectId === NO_PROJECT_KEY ? '' : session.projectId
  if (ops.length) {
    try {
      const r = await restoreBatch(projectId, ops)
      if (!r.ok) error.value = r.error || '文件回退失败'
      else if (r.results && r.results.length) {
        const done = r.results.map((x) => (x.action === 'deleted' ? `删除 ${x.filePath}` : `还原 ${x.filePath}`)).join('；')
        // 轻量提示已回退的文件（不阻塞对话）
        console.info('已回退文件：' + done)
      }
    } catch (e) {
      error.value = '文件回退失败: ' + (e.message || String(e))
    }
  }

  // 输入框自动填入原文，便于修改后重发
  composerRef.value?.setText(msg.content || '')
  composerRef.value?.focusComposer()
}

// 确认弹窗的 diff 预览：仅在 preview 含 before/after 时计算
const confirmFilePath = computed(() => (toolConfirm.value ? toolConfirm.value.args?.filePath : ''))
const confirmDiffRows = computed(() => {
  const p = toolConfirm.value && toolConfirm.value.preview
  if (p && typeof p.before === 'string' && typeof p.after === 'string') {
    return buildDiffRows(confirmFilePath.value || 'file', p.before, p.after)
  }
  return []
})
const confirmPreviewError = computed(() => {
  const p = toolConfirm.value && toolConfirm.value.preview
  return p && p.previewError ? p.previewError : ''
})

// 重新生成某条 assistant 回复：保留其前面全部上下文，删除该条及其之后，
// 再以相同前文重新请求模型（不再新增 user 消息，直接复用已有上下文）。
async function regenerate(msg) {
  if (loading.value) return
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return
  const idx = session.messages.findIndex((m) => m.id === msg.id)
  if (idx < 0) return
  // 截断前先记下被重生成 assistant 的思考内容，作为占位：
  // 模型重新生成时若返回新 reasoning 会覆盖，若未返回则复用旧 reasoning，避免空思考区。
  const prevReasoning = msg?.reasoning || ''
  // 截断到该 assistant 之前（保留前文，含其前面的 user 消息）。
  // 注意：truncateSession 内部会用后端返回的新对象替换 store 里的 session，
  // 因此必须用其返回值作为后续操作对象，否则新 assistant 消息会 push 到旧引用上，
  // 导致页面先空白、再直接跳到「思考完成」（看不到「思考中」）。
  const updated = await truncateSession(session.id, idx)
  const live = updated || sessions.list.find((s) => s.id === session.id)
  if (!live) return
  // 直接从已有上下文重新生成，不通过输入框、不新增 user 消息
  const pid = live.projectId === NO_PROJECT_KEY ? null : live.projectId
  const prevUser = [...live.messages].reverse().find((m) => m.role === 'user')
  if (!prevUser) return
  // 从被重生成的 user 消息 tags 还原工具/技能/MCP 配置，保证与原文一致
  const tags = prevUser.tags || []
  const tagSkillIds = new Set(tags.filter((t) => t.type === 'tag' && t.kind === 'skill').map((t) => t.key))
  const tagMcpNames = new Set(tags.filter((t) => t.type === 'tag' && t.kind === 'mcp').map((t) => t.key))
  const fileTools = baseTools.value.map((t) => t.key)
  const skillIds = [...new Set([...tagSkillIds].filter((k) => availableSkills.value.some((s) => s.key === k)))]
  const mcpNames = [...new Set([...tagMcpNames].filter((k) => availableMcp.value.includes(k)))]
  const mcpServersPayload = Object.fromEntries(
    mcpNames.map((n) => [n, (settings.mcpServers || {})[n]]).filter(([, cfg]) => cfg)
  )
  await runAssistantTurn(live, {
    text: prevUser.content,
    pid,
    fileTools,
    skillIds,
    mcpServersPayload,
    prevReasoning,
  })
}

// #10 单条工具重试：调后端用原始参数重跑该工具，结果回来后原地替换对应 tool 节点的 result
async function onRetryTool({ msg, tool, key }) {
  if (loading.value) return
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return
  const pid = session.projectId === NO_PROJECT_KEY ? null : session.projectId
  // 用当前会话的权限级别（与 /chat 一致），无配置时默认 full
  const permission = session.permission || 'full'
  const { ok, error } = await retryToolCall(
    { projectId: pid, permission, name: tool.name, args: tool.args, sessionId: session.id },
    {
      onToolRetry: (json) => {
        // 确认弹窗（ask 模式）：直接走现有 tool_confirm 流程，弹窗允许后后端继续重跑
        if (json.type === 'tool_confirm') {
          toolConfirm.value = {
            id: json.id,
            name: json.name,
            args: json.args || {},
            preview: json.preview || null,
          }
          return
        }
        // start/end 事件：定位该 tool 节点并就地更新
        if (json.type === 'tool_call') {
          const target = msg.toolCalls.find((t) => t.name === json.name && t.status === 'done' && t.args && JSON.stringify(t.args) === JSON.stringify(tool.args))
          if (target) {
            if (json.status === 'start') {
              target.status = 'running'
              target.result = ''
            } else if (json.status === 'end') {
              target.status = 'done'
              target.result = json.result || ''
            }
          }
        }
      },
      onDone: () => {
        msgListRef.value?.clearRetrying(key)
      },
    }
  )
  if (!ok) {
    error.value = '工具重试失败: ' + (error || '未知错误')
    msgListRef.value?.clearRetrying(key)
  }
}

// 切换项目
async function init() {
  // 左侧对话框仅加载未归档会话（archived=0）
  await Promise.all([fetchProjects(), fetchSessions(0)])
  await Promise.all([loadAvailableSkills(), loadBaseTools()])
}

onMounted(init)

// 监听全局事件：侧边栏"添加项目"入口会触发 open-add-project
onMounted(() => onBus('open-add-project', () => openAdd()))
</script>

<template>
  <div class="chat">
    <ChatHeader
      :active-session="activeSession"
      :project-id="activeProjectId.id || ''"
      :show-changes="showChanges"
      :show-todos="showTodos"
      @open-log="showLog = true"
      @update:show-changes="showChanges = $event"
      @update:show-todos="showTodos = $event"
    />

    <div class="chat__body" :style="{ gridTemplateColumns: gridCols }">
      <div class="chat__conversation">
        <div v-if="reconnecting" class="reconnect-bar">
          <span class="reconnect-bar__dot" />
          连接中断，正在重连（第 {{ reconnectInfo.attempt }} / {{ reconnectInfo.max }} 次）…
        </div>
        <!-- 计划确认卡片：计划产出后弹窗，可勾选跳过部分子任务 -->
        <transition name="fade">
          <div v-if="planConfirm" class="plan-confirm-mask" @click.self="cancelPlan">
            <div class="plan-confirm" role="dialog" aria-modal="true" aria-labelledby="plan-confirm-title">
              <div class="plan-confirm__header">
                <div id="plan-confirm-title" class="plan-confirm__title">执行计划</div>
                <button class="plan-confirm__close" aria-label="关闭" @click="cancelPlan">×</button>
              </div>
              <div class="plan-confirm__desc">以下子任务将按顺序执行，取消勾选可跳过：</div>
              <div class="plan-confirm__items">
                <label v-for="it in planConfirm" :key="it.id" class="plan-confirm__item">
                  <input v-model="it.enabled" type="checkbox" />
                  <span class="plan-confirm__item-body">
                    <span class="plan-confirm__item-title">{{ it.title }}</span>
                    <span class="plan-confirm__item-desc">{{ it.description }}</span>
                  </span>
                </label>
              </div>
              <div class="plan-confirm__footer">
                <button class="plan-confirm__cancel" @click="cancelPlan">取消</button>
                <button class="plan-confirm__start" @click="confirmPlan">开始执行</button>
              </div>
            </div>
          </div>
        </transition>

        <MessageList
          v-if="!activeSubView"
          ref="msgListRef"
          :messages="currentMessages"
          :active="active"
          :error="error"
          :project-id="activeProjectId.id || ''"
          @rollback="rollbackTo"
          @regenerate="regenerate"
          @retryTool="onRetryTool"
          @open-subagent="activeSubView = $event"
        />
        <SubAgentPanel v-else :sub="activeSubAgent" @back="activeSubView = null" />
        <ComposerInput
          ref="composerRef"
          :active="active"
          :loading="loading"
          :available-skills="availableSkills"
          :context-usage="contextUsage"
          @send="send"
          @stop="stopGeneration"
          @open-add="openAdd"
          @new-project-chat="newProjectChat"
          @manual-compress="onManualCompress"
        />
      </div>

      <!-- 右侧「文件变更」展示区：与 sidebar 平级，按屏幕宽度百分比显示 -->
      <div class="chat__changes-wrap">
        <transition name="changes-fade">
          <SessionChanges
            v-if="showChanges"
            :session="activeSession"
            :project-id="activeProjectId.id || ''"
          />
        </transition>
      </div>
    </div>

    <!-- 任务清单悬浮层：ChatHeader 下方、浏览器右上方；有任务时自动显示，用户可关闭 -->
    <transition name="todo-float">
      <TodoPanel
        v-if="showTodos"
        class="chat__todo-float"
        :session="activeSession"
        @close="showTodos = false"
      />
    </transition>

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

    <!-- 「需确认(ask)」模式：高风险工具执行前弹窗，等待用户允许/拒绝 -->
    <a-modal
      :open="!!toolConfirm"
      title="工具调用需确认"
      :closable="false"
      :mask-closable="false"
      ok-text="允许"
      cancel-text="拒绝"
      @ok="handleToolConfirm('allow')"
      @cancel="handleToolConfirm('deny')"
    >
      <p v-if="toolConfirm" style="margin-bottom: 8px">
        助手请求执行 <strong>{{ toolConfirm.name }}</strong> 工具，请确认是否允许：
      </p>

      <!-- 文件改动预览：before/after 渲染 diff -->
      <div v-if="confirmDiffRows.length" class="confirm-diff">
        <div class="confirm-diff__head">{{ confirmFilePath }}</div>
        <div class="confirm-diff__body">
          <div
            v-for="(r, i) in confirmDiffRows"
            :key="i"
            class="confirm-diff__row"
            :class="'confirm-diff__row--' + r.type"
          ><span class="confirm-diff__sign">{{ r.type === 'add' ? '+' : r.type === 'del' ? '-' : r.type === 'hunk' ? '' : ' ' }}</span><span class="confirm-diff__text">{{ r.text }}</span></div>
        </div>
      </div>

      <!-- 预览失败：标红提示（如 editFile oldStr 未命中） -->
      <div v-else-if="confirmPreviewError" class="confirm-diff__error">
        ⚠ {{ confirmPreviewError }}（无法预览具体改动，请谨慎确认）
      </div>

      <!-- 无 preview（命令/非文件工具）：仍显示纯参数文本 -->
      <pre
        v-else
        style="max-height: 280px; overflow: auto; background: #f6f8fa; padding: 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; font-size: 12px"
        >{{ formatToolArgs(toolConfirm.args) }}</pre>
    </a-modal>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}
/* 头部之下的主体：左侧会话区 + 右侧面板，列宽由 gridCols(computed) 控制并平滑过渡 */
.chat__body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 0px;
  grid-template-rows: minmax(0, 1fr);
  transition: grid-template-columns 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
  min-height: 0;
}
/* 会话区本身纵向排布：消息列表在上，输入框在下 */
.chat__conversation {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
/* 右侧「文件变更」面板包裹：列宽由 grid 控制，溢出隐藏以便收起 */
.chat__changes-wrap {
  overflow: hidden;
  min-width: 0;
  display: flex;
}
/* 任务清单悬浮层：固定在 ChatHeader 下方、浏览器右上方 */
.chat__todo-float {
  position: absolute;
  top: 50px;
  right: 0;
  width: 300px;
  max-height: 60vh;
  z-index: 40;
  border: 1px solid var(--color-border, #e5e7eb);
  border-right: none;
  border-radius: 10px 0 0 10px;
  background: var(--color-bg, #fff);
  box-shadow: -4px 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 悬浮层进出场：下滑 + 淡入 */
.todo-float-enter-active,
.todo-float-leave-active {
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.26s ease;
}
.todo-float-enter-from,
.todo-float-leave-to {
  transform: translateX(16px);
  opacity: 0;
}
.todo-float-enter-to,
.todo-float-leave-from {
  transform: translateX(0);
  opacity: 1;
}
/* 变更区内部淡入，避免内容瞬间出现 */
.changes-fade-enter-active,
.changes-fade-leave-active {
  transition: opacity 0.24s ease;
}
.changes-fade-enter-from,
.changes-fade-leave-to {
  opacity: 0;
}
.changes-fade-enter-to,
.changes-fade-leave-from {
  opacity: 1;
}
/* 确认弹窗内的文件改动 diff 预览 */
.confirm-diff {
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}
.confirm-diff__head {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  background: #f3f4f6;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  word-break: break-all;
}
.confirm-diff__body {
  max-height: 300px;
  overflow: auto;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
}
.confirm-diff__row {
  display: flex;
  white-space: pre-wrap;
  word-break: break-all;
}
.confirm-diff__row--add {
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}
.confirm-diff__row--del {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}
.confirm-diff__row--hunk {
  background: #f3f4f6;
  color: #6b7280;
  padding: 2px 0;
}
.confirm-diff__sign {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  user-select: none;
  opacity: 0.7;
}
.confirm-diff__text {
  flex: 1;
  padding-right: 8px;
}
.confirm-diff__error {
  margin-bottom: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
}
.reconnect-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: 8px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}
.reconnect-bar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  animation: reconnect-pulse 1s ease-in-out infinite;
}
@keyframes reconnect-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 计划确认卡片（计划产出后居中弹窗） */
.plan-confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
}
.plan-confirm {
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.plan-confirm__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 8px;
}
.plan-confirm__title {
  font-size: 16px;
  font-weight: 600;
}
.plan-confirm__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.plan-confirm__close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.plan-confirm__desc {
  font-size: 13px;
  color: var(--color-text-muted);
  padding: 0 22px;
  margin-bottom: 14px;
}
.plan-confirm__items {
  flex: 1;
  overflow: auto;
  padding: 0 22px;
}
.plan-confirm__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}
.plan-confirm__item input {
  margin-top: 3px;
}
.plan-confirm__item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plan-confirm__item-title {
  font-size: 14px;
  font-weight: 500;
}
.plan-confirm__item-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}
.plan-confirm__footer {
  display: flex;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
}
.plan-confirm__start,
.plan-confirm__cancel {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.15s;
}
.plan-confirm__start {
  border: none;
  background: var(--brand);
  color: #fff;
}
.plan-confirm__start:hover {
  filter: brightness(1.06);
}
.plan-confirm__cancel {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.plan-confirm__cancel:hover {
  filter: brightness(0.95);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
