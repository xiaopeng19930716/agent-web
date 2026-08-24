import { Router } from 'express'
import { projects } from '../lib/store.js'
import { DEFAULT_MODEL } from '../lib/config.js'
import { loadSkillContents } from '../lib/skills.js'
import { loadMcpTools } from '../lib/mcpClient.js'
import {
  buildChatModel,
  runAgent,
  toLangchainMessage,
  TokenStatsHandler,
  buildEffortHint,
  resolveModelConfig,
} from '../lib/chat.js'

const router = Router()

// ===== 工具确认闸门（「需确认(ask)」模式）=====
// 每个 SSE 请求持有一个 gate；后端执行高风险工具前发 tool_confirm 事件并 await ask()，
// 前端用户点「允许/拒绝」后 POST /chat/confirm 唤醒对应 pending。
class ConfirmGate {
  constructor(sessionId, res) {
    this.sessionId = sessionId
    this.res = res
    this.pending = new Map() // id -> { resolve, timer }
    this.closed = false
  }
  ask(id, name, args) {
    if (this.closed) return Promise.resolve('deny')
    return new Promise((resolve) => {
      // 超时自动拒绝，避免连接挂死（5 分钟）
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve('deny')
      }, 5 * 60 * 1000)
      this.pending.set(id, { resolve, timer })
      this.res.write(
        `data: ${JSON.stringify({ type: 'tool_confirm', id, name, args })}\n\n`
      )
    })
  }
  resolve(id, decision) {
    const p = this.pending.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(decision === 'allow' ? 'allow' : 'deny')
    return true
  }
  close() {
    this.closed = true
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer)
      resolve('deny')
    }
    this.pending.clear()
  }
}

// 按 sessionId 维护当前进行中的 gate（同会话同时只应有一个 SSE 流）
const gatesBySession = new Map()

// 前端确认回传：{ sessionId, id, decision: 'allow' | 'deny' }
router.post('/chat/confirm', (req, res) => {
  const { sessionId, id, decision } = req.body || {}
  const gate = sessionId && gatesBySession.get(sessionId)
  const ok = gate ? gate.resolve(id, decision) : false
  res.json({ ok })
})

// 按 sessionId 维护当前进行中的 AbortController（停止生成用）
const abortControllers = new Map()

// 前端「停止生成」：通知后端中断当前会话的 Agent 循环
router.post('/chat/abort', (req, res) => {
  const { sessionId } = req.body || {}
  const ctrl = sessionId && abortControllers.get(sessionId)
  if (ctrl) ctrl.abort()
  res.json({ ok: !!ctrl })
})

router.post('/chat', async (req, res) => {
  const cfg = req.body.config || {}
  // 密钥从服务端配置文件解析，不接收前端明文
  const apiKey = resolveModelConfig(cfg.model || DEFAULT_MODEL).apiKey
  const model = cfg.model || DEFAULT_MODEL
  if (!apiKey) {
    res.status(500).json({ error: '未配置 API Key：请在设置面板（供应商配置）中填写并保存' })
    return
  }

  const { messages, projectId, permission, effort, tools, skills, mcpServers, sessionId } = req.body
  // 权限级别：read-only(只读) / full(完全访问) / ask(需确认) / none(不允许)；默认 full
  let perm = 'full'
  if (permission === 'read-only' || permission === 'none') perm = permission
  else if (permission === 'ask') perm = 'ask'
  // 无项目时文件/命令工具不可用，ask 无意义，降级为 none（与前端 A2 下拉收敛一致）
  const effectivePerm = projectRoot ? perm : 'none'
  // 思考链（reasoning）：高思考强度或 qwen-thinking 系列模型时开启
  const enableThinking = effort === 'high' || /thinking/i.test(model)
  // 思考强度（effort）映射到系统提示片段
  const effortHint = buildEffortHint(effort)

  // 校验关联项目，返回后端已知的项目根目录（失败则已写响应并返回 null）
  const projectRoot = resolveProjectRoot(projectId, res)
  if (projectRoot === null && projectId) return

  setupSSE(res)
  const startTime = Date.now()
  const usageRef = { promptTokens: 0, completionTokens: 0 }
  const callbacks = [new TokenStatsHandler(usageRef)]
  const writeMeta = createMetaWriter(res, model, usageRef, startTime)

  // 「需确认」模式 + 有项目：建立确认闸门；客户端断开时拒绝所有 pending，避免挂死
  let confirmGate = null
  if (perm === 'ask' && projectRoot) {
    confirmGate = new ConfirmGate(sessionId, res)
    if (sessionId) gatesBySession.set(sessionId, confirmGate)
  }
  // 停止生成：每个会话一个 AbortController；客户端断开或显式 /chat/abort 都会中断 Agent 循环
  let abortController = null
  if (sessionId) {
    abortController = new AbortController()
    abortControllers.set(sessionId, abortController)
  }
  res.on('close', () => {
    if (confirmGate) {
      confirmGate.close()
      if (sessionId) gatesBySession.delete(sessionId)
    }
    if (abortController) {
      abortController.abort() // 浏览器关 tab/断流即停止
      if (sessionId) abortControllers.delete(sessionId)
    }
  })

  try {
    const chatModel = buildChatModel({ ...cfg, enableThinking }, callbacks)
    // 加载勾选技能的内容，注入系统提示，让 Agent 遵循技能规范
    const skillContents = await loadSkillContents(skills)
    const skillPrompts = [...skillContents.values()]
    // MCP 工具：按请求传入的 mcpServers 配置加载（未启用/异常时为空数组，不影响对话）
    const mcpTools = await loadMcpTools(mcpServers)

    // 有项目：文件工具受项目根目录安全边界约束，按权限提供；
    // 无项目：文件/命令工具依赖项目边界不可用，但 MCP 工具与技能规范仍走 Agent 循环（MCP 不依赖项目根目录）。
    // 两种场景统一复用 runAgent，仅 root/perm/enabledTools 三处参数不同。
    await runAgent(
      chatModel,
      (messages || []).map(toLangchainMessage),
      projectRoot,
      res,
      effectivePerm,
      callbacks,
      {
        enabledTools: Array.isArray(tools) ? tools : [],
        skillPrompts,
        mcpTools,
        mcpServers,
        effortHint,
        confirmGate: perm === 'ask' && projectRoot ? confirmGate : null,
        abortSignal: abortController ? abortController.signal : null,
      }
    )
    writeMeta('ok')
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    writeMeta('error')
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`)
    res.end()
  }
})

// 校验项目 ID 并解析其根目录；未知项目时直接响应 400 并返回 null
function resolveProjectRoot(projectId, res) {
  if (!projectId) return null
  const p = projects.get(projectId)
  if (!p) {
    res.status(400).json({ error: '未知项目 ID（可能后端未重启加载）' })
    return null
  }
  return p.path
}

// 配置 SSE 响应头（流式输出）
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
}

// 生成 writeMeta：在流结束/出错时上报模型、token、耗时等元信息
function createMetaWriter(res, model, usageRef, startTime) {
  return (status) => {
    const durationMs = Date.now() - startTime
    const total = usageRef.promptTokens + usageRef.completionTokens
    const tokens = total > 0 ? total : null
    res.write(`data: ${JSON.stringify({ type: 'meta', model, tokens, durationMs, status })}\n\n`)
  }
}

export default router
