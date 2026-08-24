import os from 'os'
import { Router } from 'express'
import { projects } from '../lib/store.js'
import { getToolCatalog, restoreBackup, deleteFileSafe } from '../lib/fileTools.js'

const router = Router()

// 返回后端 fileTools.js 中声明的全部文件工具元信息（名称 / 描述）。
// 前端据此自动构建基础工具清单，新增工具无需改动前端。
router.get('/tools', (req, res) => {
  try {
    const tools = getToolCatalog()
    res.json({ tools })
  } catch (e) {
    console.error('[tools] /api/tools 失败:', e) // 打印堆栈到后端控制台，便于诊断
    res.status(500).json({ error: '读取工具清单失败: ' + (e && e.message ? e.message : String(e)) })
  }
})

// 文件回退：把一次写/编辑操作前的自动备份还原回原文件。
// body: { projectId, backupPath }；backupPath 形如 .agent-backup/<相对路径>.<时间戳>
router.post('/restore', (req, res) => {
  try {
    const { projectId, backupPath } = req.body || {}
    // 有项目用项目根；无项目用用户主目录（与聊天时文件工具边界一致）
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const originalRel = restoreBackup(root, backupPath)
    res.json({ ok: true, restored: originalRel })
  } catch (e) {
    res.status(400).json({ error: '还原失败: ' + (e.message || String(e)) })
  }
})

// 批量文件回退：对话回退时，把被截断消息里的所有写/编辑操作一并回退。
// body: { projectId, ops: [{ filePath, backupId }] }（ops 按时间正序传入）
// 关键：同一文件在区间内可能出现多次（新建后又被覆盖）。回退到该点之前，
// 文件的最终状态只由「区间内第一条操作它的 op」决定：
//   - 第一条 op 是新建(backupId 为空) -> 该文件在回退点尚不存在，应删除
//   - 第一条 op 是覆盖(有 backupId)   -> 还原到那次覆盖之前
// 因此按 filePath 去重，只保留首次出现的 op，避免「先删后还原」把文件复活。
router.post('/restore-batch', (req, res) => {
  try {
    const { projectId, ops } = req.body || {}
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const seen = new Map()
    for (const op of Array.isArray(ops) ? ops : []) {
      if (!op || !op.filePath) continue
      if (seen.has(op.filePath)) continue // 同文件只取第一条 op
      seen.set(op.filePath, op)
    }
    const results = []
    for (const op of seen.values()) {
      const { filePath, backupId } = op
      if (backupId) {
        const restored = restoreBackup(root, backupId)
        results.push({ filePath, action: 'restored', restored })
      } else {
        deleteFileSafe(root, filePath)
        results.push({ filePath, action: 'deleted' })
      }
    }
    res.json({ ok: true, results })
  } catch (e) {
    res.status(400).json({ error: '批量还原失败: ' + (e.message || String(e)) })
  }
})

export default router
