import { Router } from 'express'
import { projects } from '../lib/store.js'
import { API_KEY, DEFAULT_MODEL } from '../lib/config.js'
import { loadSkillContents } from '../lib/skills.js'
import { loadMcpTools } from '../lib/mcpClient.js'
import {
  buildChatModel,
  runAgent,
  toLangchainMessage,
  TokenStatsHandler,
  buildEffortHint,
} from '../lib/chat.js'

const router = Router()

router.post('/chat', async (req, res) => {
  const cfg = req.body.config || {}
  const apiKey = cfg.apiKey || API_KEY
  const model = cfg.model || DEFAULT_MODEL
  if (!apiKey) {
    res.status(500).json({ error: '未配置 API Key：请在设置面板填写，或在 .env 设置 DASHSCOPE_API_KEY' })
    return
  }

  const { messages, projectId, permission, effort, tools, skills, mcpServers } = req.body
  // 权限级别：read-only(只读) / full(完全访问) / none(不允许)；默认 full
  const perm = permission === 'read-only' || permission === 'none' ? permission : 'full'
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

  try {
    const chatModel = buildChatModel({ ...cfg, enableThinking }, callbacks)
    // 加载勾选技能的内容，注入系统提示，让 Agent 遵循技能规范
    const skillContents = await loadSkillContents(skills)
    const skillPrompts = [...skillContents.values()]
    // MCP 工具：按请求传入的 mcpServers 配置加载（未启用/异常时为空数组，不影响对话）
    const mcpTools = await loadMcpTools(mcpServers)

    // 有项目：文件工具受项目根目录安全边界约束，按权限(perm)提供；
    // 无项目：文件/命令工具依赖项目边界不可用，但 MCP 工具与技能规范仍走 Agent 循环（MCP 不依赖项目根目录）。
    // 两种场景统一复用 runAgent，仅 root/perm/enabledTools 三处参数不同。
    await runAgent(
      chatModel,
      (messages || []).map(toLangchainMessage),
      projectRoot,
      res,
      projectRoot ? perm : 'none',
      callbacks,
      {
        enabledTools: Array.isArray(tools) ? tools : [],
        skillPrompts,
        mcpTools,
        mcpServers,
        effortHint,
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
