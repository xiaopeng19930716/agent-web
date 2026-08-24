<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { streamChat, summarizeChat } from '../api/agent.js'
import {
  activeProjectId,
  getActiveProject,
  setActiveProject,
  fetchProjects,
} from '../projects.js'
import { restoreFile, restoreBatch } from '../api/restore.js'
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
import ComposerInput from './chat/ComposerInput.vue'
import AddProjectModal from './chat/AddProjectModal.vue'
import { confirmToolCall, abortChat } from '../api/agent.js'

const error = ref('')
const loading = ref(false)

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

// 粗略估算文本 token：中日韩等按 1 字符/token，其余按 4 字符/token
function estimateTokens(text = '') {
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
  session.messages.push({ id: newMsgId(), role: 'user', content: text, tags, metadata: { timestamp: Date.now() } })
  // 清空富文本输入框（委托子组件）
  composerRef.value?.clear()

  const assistant = reactive({
    id: newMsgId(),
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

  await streamChat(finalHistory, {
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
      }
    },
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

// ── 对话级回退 ───────────────────────────────────────────────
// 从工具结果字符串里解析 { filePath, backupId }
// writeFile/editFile 结果形如：
//   "已写入: a.txt | backupId=.agent-backup/a.txt.2026-..."  （覆盖/编辑，可还原）
//   "已写入: a.txt | backupId= | created=1"                  （新建，回退时需删除）
function parseFileOp(result, name) {
  if (name !== 'writeFile' && name !== 'editFile') return null
  if (typeof result !== 'string') return null
  const m = result.match(/backupId=(.*?)(?:\s*$)/)
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
  const ops = []
  for (const m of removed) {
    if (m.role !== 'assistant') continue
    for (const t of (m.toolCalls || [])) {
      const op = parseFileOp(t.result, t.name)
      if (op) ops.push(op)
    }
  }

  // 截断到该 user 消息之前（不包含它），对话中该消息消失
  await truncateSession(session.id, idx)

  // 文件回退：有备份则还原，新建文件则删除
  if (ops.length) {
    const projectId = activeProjectId.id || ''
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

// 重新生成某条 assistant 回复：保留其前面全部上下文，删除该条及其之后，
// 再以相同前文重新请求模型。
async function regenerate(msg) {
  if (loading.value) return
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return
  const idx = session.messages.findIndex((m) => m.id === msg.id)
  if (idx < 0) return
  // 截断到该 assistant 之前（保留前文），再触发一次发送
  await truncateSession(session.id, idx)
  // 复用发送流程：把"前一条 user 消息"作为本次输入重新提交
  const prevUser = [...session.messages].reverse().find((m) => m.role === 'user')
  if (!prevUser) return
  composerRef.value?.setText(prevUser.content || '')
  composerRef.value?.focusComposer()
  await send()
}

// 文件回退：把一次写/编辑操作前的自动备份还原回原文件
async function restoreFileHandler(payload) {
  if (loading.value) return
  const projectId = payload.projectId || activeProjectId.id || ''
  try {
    const r = await restoreFile(projectId, payload.backupPath)
    if (r.ok) {
      error.value = ''
      alert('已还原文件：' + r.restored)
    } else {
      error.value = r.error || '还原失败'
    }
  } catch (e) {
    error.value = '还原失败: ' + (e.message || String(e))
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
    <ChatHeader :active-session="activeSession" @open-log="showLog = true" />

    <MessageList :messages="currentMessages" :active="active" :error="error" :project-id="activeProjectId.id || ''" @rollback="rollbackTo" @regenerate="regenerate" @restore="restoreFileHandler" />

    <ComposerInput
      ref="composerRef"
      :active="active"
      :loading="loading"
      :available-skills="availableSkills"
      @send="send"
      @stop="stopGeneration"
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
      <pre
        v-if="toolConfirm"
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
}
</style>
