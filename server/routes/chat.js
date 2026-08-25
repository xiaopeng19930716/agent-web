import os from 'os'
import { Router } from 'express'
import { SystemMessage } from '@langchain/core/messages'
import { projects } from '../lib/store.js'
import { DEFAULT_MODEL } from '../lib/config.js'
import { loadSkillContents } from '../lib/skills.js'
import { loadMcpTools } from '../lib/mcpClient.js'
import {
  buildChatModel,
  runAgent,
  runSingleTool,
  toLangchainMessage,
  TokenStatsHandler,
  buildEffortHint,
  resolveModelConfig,
} from '../lib/chat.js'

const router = Router()

// 上下文压缩用的摘要提示词：把早期对话压成背景摘要，供后续轮次作为上下文注入
const SUMMARY_PROMPT =
  '你是一个对话压缩器。请把下面的对话压缩成简洁的中文摘要，作为后续对话的背景上下文。要求：\n' +
  '1. 保留用户的核心目标、已做出的决策与关键结论；\n' +
  '2. 保留具体信息：文件路径、命令、代码要点、工具调用结果中的关键结论；\n' +
  '3. 保留尚未解决的问题与后续待办；\n' +
  '4. 省略寒暄、客套与重复表述；\n' +
  '5. 使用要点列表，总长度控制在 300 字以内。\n' +
  '只输出摘要本身，不要任何前言。'

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
  ask(id, name, args, preview) {
    if (this.closed) return Promise.resolve('deny')
    return new Promise((resolve) => {
      // 超时自动拒绝，避免连接挂死（5 分钟）
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve('deny')
      }, 5 * 60 * 1000)
      this.pending.set(id, { resolve, timer })
      this.res.write(
        `data: ${JSON.stringify({ type: 'tool_confirm', id, name, args, preview: preview || null })}\n\n`
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

// #10 工具调用单条重试：用原始 name/args 重新执行某条工具，把 start/end 事件通过 SSE 推回前端。
// 不复用模型、不回写会话消息（前端持有状态并原地替换该 tool 节点结果）。
// ask 模式下仍会触发确认弹窗（复用 #8 的 diff 预览）。
router.post('/chat/retry-tool', async (req, res) => {
  const { projectId, permission, name, args, sessionId } = req.body || {}
  if (!name || !args) {
    res.status(400).json({ error: '缺少 name 或 args' })
    return
  }
  // 权限：read-only / full / ask / none；默认 full
  let perm = 'full'
  if (permission === 'read-only' || permission === 'none') perm = permission
  else if (permission === 'ask') perm = 'ask'
  // 文件工具安全边界：有项目用项目根，无项目用服务端工作目录（与 /chat 一致）
  const projectRoot = resolveProjectRoot(projectId, res)
  if (projectRoot === null && projectId) return
  const toolRoot = projectRoot || process.cwd()

  setupSSE(res)
  // ask 模式：建立确认闸门，复用 #8 逻辑（含 5 分钟超时自动拒绝）
  let confirmGate = null
  if (perm === 'ask') {
    confirmGate = new ConfirmGate(sessionId, res)
    if (sessionId) gatesBySession.set(sessionId, confirmGate)
  }
  res.on('close', () => {
    if (confirmGate) {
      confirmGate.close()
      if (sessionId) gatesBySession.delete(sessionId)
    }
  })

  try {
    const result = await runSingleTool({ toolRoot, permission: perm, name, args, res, confirmGate, abortSignal: null })
    res.write(`data: ${JSON.stringify({ type: 'tool_retry_done', name, ok: !/错误|拒绝/.test(result) })}\n\n`)
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'tool_retry_done', name, ok: false, error: String(e.message || e) })}\n\n`)
  } finally {
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

// 上下文压缩：把早期对话压缩为摘要（独立于主对话，非流式），
// 供前端在历史过长时调用，避免超出模型上下文窗口。
router.post('/chat/summarize', async (req, res) => {
  const { messages, config } = req.body || {}
  const model = config?.model || DEFAULT_MODEL
  const apiKey = resolveModelConfig(model).apiKey
  if (!apiKey) {
    res.status(500).json({ error: '未配置 API Key：请在设置面板（供应商配置）中填写并保存' })
    return
  }
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: '缺少 messages' })
    return
  }
  try {
    const m = buildChatModel({ ...config, temperature: 0.2, maxTokens: 1024 })
    const resp = await m.invoke([
      new SystemMessage(SUMMARY_PROMPT),
      ...messages.map(toLangchainMessage),
    ])
    const summary = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content)
    res.json({ summary })
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) })
  }
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
  // 思考链（reasoning）：高思考强度或 qwen-thinking 系列模型时开启
  const enableThinking = effort === 'high' || /thinking/i.test(model)
  // 思考强度（effort）映射到系统提示片段
  const effortHint = buildEffortHint(effort)

  // 校验关联项目，返回后端已知的项目根目录（失败则已写响应并返回 null）
  const projectRoot = resolveProjectRoot(projectId, res)
  if (projectRoot === null && projectId) return
  // 权限保持用户选择（read-only / full / ask / none 均生效）：
  // 无项目时文件工具以「服务端工作目录」为安全边界（见下方 fileRoot），
  // 因此读文件默认可用；写文件/命令仍受 perm 约束。
  const effectivePerm = perm

  setupSSE(res)
  const startTime = Date.now()
  const usageRef = { promptTokens: 0, completionTokens: 0 }
  const callbacks = [new TokenStatsHandler(usageRef)]
  const writeMeta = createMetaWriter(res, model, usageRef, startTime)

  // 「需确认」模式：建立确认闸门；客户端断开时拒绝所有 pending，避免挂死
  // （不依赖项目：无项目时文件工具以服务端工作目录为边界，确认闸门同样适用）
  let confirmGate = null
  if (perm === 'ask') {
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

    // 文件工具边界 root：有项目用项目根；无项目用用户主目录（os.homedir()），
    // 这样无项目对话也能读取/查询桌面、文档、下载等主目录下的文件，且仍受 safeResolve 边界保护。
    const fileRoot = projectRoot || os.homedir()
    // 有项目：文件工具受项目根目录安全边界约束，按权限提供；
    // 无项目：文件工具以用户主目录为边界，读文件默认可用（写/命令仍受 perm 约束）；
    // 两种场景统一复用 runAgent，仅 root/perm/enabledTools 三处参数不同。
    await runAgent(
      chatModel,
      (messages || []).map(toLangchainMessage),
      projectRoot,
      res,
      effectivePerm,
      callbacks,
      {
        fileRoot,
        enabledTools: Array.isArray(tools) ? tools : [],
        skillPrompts,
        mcpTools,
        mcpServers,
        effortHint,
        confirmGate: perm === 'ask' ? confirmGate : null,
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
