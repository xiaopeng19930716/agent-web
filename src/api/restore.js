// 文件回退：请求后端把一次写/编辑操作前的自动备份还原回原文件。
// projectId 为空时后端以用户主目录为边界（与聊天时文件工具一致）。
export async function restoreFile(projectId, backupPath) {
  const resp = await fetch('/api/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, backupPath }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    return { ok: false, error: err.error || `请求失败: ${resp.status}` }
  }
  const data = await resp.json()
  return data
}

// 批量文件回退：对话回退时，把被截断消息里的所有写/编辑操作一并回退。
// ops: [{ filePath, backupId }]；backupId 非空还原备份，为空（新建文件）删除文件。
export async function restoreBatch(projectId, ops) {
  const resp = await fetch('/api/restore-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, ops }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    return { ok: false, error: err.error || `请求失败: ${resp.status}` }
  }
  const data = await resp.json()
  return data
}
