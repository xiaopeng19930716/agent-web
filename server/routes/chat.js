import { Router } from 'express'
import { SystemMessage } from '@langchain/core/messages'
import { projects } from '../lib/store.js'
import { API_KEY, DEFAULT_MODEL } from '../lib/config.js'
import {
  buildChatModel,
  runAgent,
  toLangchainMessage,
  TokenStatsHandler,
  SYSTEM_PROMPT,
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

  const { messages, projectId, permission, effort } = req.body
  // 权限级别：read-only(只读) / full(完全访问) / none(不允许)；默认 full
  const perm = permission === 'read-only' || permission === 'none' ? permission : 'full'

  // 若关联项目，校验后端已知的项目根目录
  let projectRoot = null
  if (projectId) {
    const p = projects.get(projectId)
    if (!p) {
      res.status(400).json({ error: '未知项目 ID（可能后端未重启加载）' })
      return
    }
    projectRoot = p.path
  }

  // 思考强度（effort）映射到系统提示片段
  const effortHint =
    effort === 'low'
      ? '\n\n思考强度：低。优先给出最直接的解决方案，避免展开过多探索。'
      : effort === 'high'
        ? '\n\n思考强度：高。请充分推理，权衡多种方案并验证边界情况后再作答。'
        : ''

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const startTime = Date.now()
  const usageRef = { promptTokens: 0, completionTokens: 0 }

  const callbacks = [new TokenStatsHandler(usageRef)]

  const writeMeta = (status) => {
    const durationMs = Date.now() - startTime
    const total = usageRef.promptTokens + usageRef.completionTokens
    const tokens = total > 0 ? total : null
    res.write(`data: ${JSON.stringify({ type: 'meta', model, tokens, durationMs, status })}\n\n`)
  }

  try {
    const chatModel = buildChatModel(cfg, callbacks)
    if (projectRoot) {
      await runAgent(chatModel, (messages || []).map(toLangchainMessage), projectRoot, res, perm, callbacks)
    } else {
      // 无项目：直接流式补全
      const msgs = [new SystemMessage(SYSTEM_PROMPT + effortHint), ...(messages || []).map(toLangchainMessage)]
      const stream = await chatModel.stream(msgs, { callbacks })
      for await (const chunk of stream) {
        if (typeof chunk.content === 'string' && chunk.content) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`)
        }
      }
    }
    writeMeta('ok')
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    writeMeta('error')
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`)
    res.end()
  }
})

export default router
