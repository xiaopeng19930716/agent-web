import { Router } from 'express'
import { sessions, saveSessions } from '../lib/store.js'

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
  res.json(list)
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
  sessions.set(id, session)
  saveSessions()
  res.json(session)
})

router.put('/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id)
  if (!s) return res.status(404).json({ error: '会话不存在' })
  const { title, messages, archived } = req.body || {}
  if (typeof title === 'string') s.title = title
  if (Array.isArray(messages)) s.messages = messages
  // 归档标记：true 表示归档（软删除），数据保留在 sessions.json
  if (typeof archived === 'boolean') s.archived = archived
  s.updatedAt = Date.now()
  sessions.set(s.id, s)
  saveSessions()
  res.json(s)
})

router.delete('/sessions/:id', (req, res) => {
  const ok = sessions.delete(req.params.id)
  if (ok) saveSessions()
  res.json({ ok })
})

export default router
