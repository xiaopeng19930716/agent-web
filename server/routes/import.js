import { Router } from 'express'
import {
  collectMcpServersFor,
  scanImportableSkillsFor,
  listImportSourceDefs,
  setImportPathOverride,
  clearImportPathOverride,
  importSkills,
} from '../lib/import.js'

const router = Router()

router.get('/import/sources', async (_req, res) => {
  try {
    const [mcpSources, skillSources] = await Promise.all([
      Promise.resolve(collectMcpServersFor()),
      scanImportableSkillsFor(),
    ])
    res.json({ sources: listImportSourceDefs(), mcpSources, skillSources })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 保存用户自定义的导入路径（持久化覆盖层）
router.put('/import/path', (req, res) => {
  const { agentId, configFiles, skillDirs } = req.body || {}
  const source = setImportPathOverride(agentId, configFiles, skillDirs)
  if (!source) {
    res.status(400).json({ error: '未知的 Agent 来源: ' + agentId })
    return
  }
  res.json({ ok: true, source })
})

// 恢复某 Agent 到默认路径
router.delete('/import/path', (req, res) => {
  const { agentId } = req.body || {}
  const source = clearImportPathOverride(agentId)
  res.json({ ok: true, source })
})

// 仅重新扫描单个 Agent 的 MCP 与 Skills（使用其当前生效路径）
router.post('/import/scan', async (req, res) => {
  const { agentId } = req.body || {}
  if (!agentId) {
    res.status(400).json({ error: 'agentId 不能为空' })
    return
  }
  try {
    const [mcpSources, skillSources] = await Promise.all([
      Promise.resolve(collectMcpServersFor([agentId])),
      scanImportableSkillsFor([agentId]),
    ])
    res.json({ mcpSources, skillSources })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 把选中的技能软链接到项目 skills/ 目录（校验源路径必须属于已声明的 Agent 目录）
router.post('/import/skills', async (req, res) => {
  const { items } = req.body || {}
  if (!Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'items 不能为空' })
    return
  }
  try {
    const results = await importSkills(items)
    res.json({ results })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

export default router
