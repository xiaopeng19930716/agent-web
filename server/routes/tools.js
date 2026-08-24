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
    res.status(500).json({ error: '读取工具清单失败: ' + (e.message || String(e)) })
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
// body: { projectId, ops: [{ filePath, backupId }] }
//   backupId 非空 -> 还原备份；backupId 为空(新建文件) -> 删除该文件。
router.post('/restore-batch', (req, res) => {
  try {
    const { projectId, ops } = req.body || {}
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const results = []
    for (const op of Array.isArray(ops) ? ops : []) {
      const { filePath, backupId } = op || {}
      if (!filePath) continue
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
