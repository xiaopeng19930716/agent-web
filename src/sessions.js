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

// 获取会话列表
// archived: undefined / '' => 全部; 0 => 仅未归档; 1 => 仅已归档
export async function fetchSessions(archived) {
  const qs = archived === undefined || archived === '' ? '' : `?archived=${archived}`
  const list = await request('/api/sessions' + qs)
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
