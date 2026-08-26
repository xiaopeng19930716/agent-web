import { Router } from 'express'
import {
  sessions,
  saveSessions,
  saveSession,
  getSession,
  deleteSession,
} from '../lib/store.js'

const router = Router()

router.get('/sessions', (req, res) => {
  let list = [...sessions.values()]
  // 按归档状态过滤：空/缺省返回全部；'0' 返回未归档；'1' 返回已归档
  const archived = req.query.archived
  if (archived === '0') {
    list = list.filter((s) => !s.archived)
  } else if (archived === '1') {
    list = list.filter((s) => s.archived)
  }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  // 拼装完整会话（含 messages）：每个会话从独立分文件读取，避免单文件膨胀
  const full = list.map((m) => getSession(m.id)).filter(Boolean)
  res.json(full)
})

// 单会话完整数据（含 messages），点开会话时按需读取
router.get('/sessions/:id', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: '会话不存在' })
  res.json(s)
})

router.post('/sessions', (req, res) => {
  const { projectId, title } = req.body || {}
  const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const now = Date.now()
  const session = {
    id,
    projectId: projectId || '__none__',
    title: title || '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  saveSession(session)
  res.json(session)
})

router.put('/sessions/:id', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: '会话不存在' })
  const { title, messages, archived } = req.body || {}
  if (typeof title === 'string') s.title = title
  if (Array.isArray(messages)) s.messages = messages
  // 归档标记：true 表示归档（软删除），数据保留
  if (typeof archived === 'boolean') s.archived = archived
  s.updatedAt = Date.now()
  saveSession(s)
  res.json(s)
})

router.delete('/sessions/:id', (req, res) => {
  deleteSession(req.params.id)
  res.json({ ok: true })
})

export default router
