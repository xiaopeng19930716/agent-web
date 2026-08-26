import { reactive } from 'vue'

// ===== 会话（sessions）前端状态层 =====
// 会话归属某个 projectId，projectId === '__none__' 表示通用对话（不绑定项目）
export const NO_PROJECT_KEY = '__none__'

export const sessions = reactive({
  list: [], // 全部会话（来自后端），按 updatedAt 倒序
  activeSessionId: null,
})

async function request(url, options) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || `请求失败: ${resp.status}`)
  return data
}

// 获取会话列表（含 messages；后端已从分文件拼装，前端无需改动）
// archived: undefined / '' => 全部; 0 => 仅未归档; 1 => 仅已归档
export async function fetchSessions(archived) {
  const qs = archived === undefined || archived === '' ? '' : `?archived=${archived}`
  const list = await request('/api/sessions' + qs)
  // 给历史消息补稳定 id：旧会话（加 id 之前）的消息没有 id 字段，
  // 若不补，回退时 undefined===undefined 会误匹配到第一条，导致截断到 idx=0 清空前文。
  for (const s of list) {
    if (Array.isArray(s.messages)) {
      s.messages.forEach((m, i) => {
        if (!m.id) m.id = 'm_legacy_' + s.id + '_' + i
      })
    }
    if (!Array.isArray(s.todos)) s.todos = []
  }
  sessions.list = list
  return list
}

export async function createSession(projectId) {
  const session = await request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ projectId: projectId || NO_PROJECT_KEY }),
  })
  sessions.list.unshift(session)
  sessions.activeSessionId = session.id
  return session
}

export async function updateSession(id, patch) {
  const session = await request(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  const idx = sessions.list.findIndex((s) => s.id === id)
  if (idx >= 0) sessions.list[idx] = session
  else sessions.list.unshift(session)
  sessions.list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return session
}

export async function deleteSession(id) {
  await request(`/api/sessions/${id}`, { method: 'DELETE' })
  sessions.list = sessions.list.filter((s) => s.id !== id)
  if (sessions.activeSessionId === id) sessions.activeSessionId = null
}

// 回退（对话级）：删除从 keepCount 开始（含）之后的所有消息，保留前 keepCount 条。
// 用于「编辑某条 user 消息并重发」或「重新生成某条 assistant 回复」——
// 即把该消息及其后续全部截断，回到该轮之前的状态，再重新请求模型。
// 截断后调用后端 PUT 落盘，保证刷新后历史一致。
export async function truncateSession(id, keepCount) {
  const session = sessions.list.find((s) => s.id === id)
  if (!session) return null
  if (keepCount < 0) keepCount = 0
  if (keepCount > session.messages.length) keepCount = session.messages.length
  // 同步截断本地消息并立即返回，保证调用方（如 regenerate）能马上 push 占位
  // assistant 消息并渲染「思考中」，无需等待网络往返。持久化异步进行。
  session.messages = session.messages.slice(0, keepCount)
  session.updatedAt = Date.now()
  // 异步落盘（fire-and-forget）：失败仅影响刷新后历史，不影响本次交互
  request(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ messages: session.messages }),
  }).catch((e) => console.warn('truncateSession 持久化失败', e))
  return session
}

// 归档会话：标记 archived=true，数据保留在后端，前端立即从列表中移除（不显示）
export async function archiveSession(id) {
  const session = await request(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ archived: true }),
  })
  sessions.list = sessions.list.filter((s) => s.id !== id)
  if (sessions.activeSessionId === id) sessions.activeSessionId = null
  return session
}
