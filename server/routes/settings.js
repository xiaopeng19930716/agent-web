import { Router } from 'express'
import {
  MODELS_FILE,
  MCP_FILE,
  SETTINGS_FILE,
  readConfigFile,
  writeConfigFile,
} from '../lib/config.js'

const router = Router()

// 模型配置（baseUrl/apiKey/models/activeModel/temperature/...）
router.get('/settings/models', (_req, res) => {
  res.json(readConfigFile(MODELS_FILE) || {})
})

router.put('/settings/models', (req, res) => {
  try {
    if (!writeConfigFile(MODELS_FILE, req.body)) {
      res.status(400).json({ error: '无效的模型配置数据' })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// MCP 配置（mcpServers）
router.get('/settings/mcp', (_req, res) => {
  res.json(readConfigFile(MCP_FILE) || {})
})

router.put('/settings/mcp', (req, res) => {
  try {
    if (!writeConfigFile(MCP_FILE, req.body)) {
      res.status(400).json({ error: '无效的 MCP 配置数据' })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 其余配置（enabledSkills 等）
router.get('/settings', (_req, res) => {
  res.json(readConfigFile(SETTINGS_FILE) || {})
})

router.put('/settings', (req, res) => {
  try {
    if (!writeConfigFile(SETTINGS_FILE, req.body)) {
      res.status(400).json({ error: '无效的配置数据' })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

export default router
