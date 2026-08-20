import { Router } from 'express'
import { DEFAULT_MODEL } from '../lib/config.js'
import { MODEL_LIST_TYPE, PRESET_VENDOR_LIST_RULES } from '../lib/modelList.js'

const router = Router()

// 模型预设（供前端下拉）
router.get('/models', (_req, res) => {
  res.json({
    presets: [
      { id: 'qwen-coder-plus', name: 'Qwen Coder Plus' },
      { id: 'qwen-coder-turbo', name: 'Qwen Coder Turbo' },
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-max', name: 'Qwen Max' },
    ],
    defaultModel: DEFAULT_MODEL,
  })
})

router.post('/models/fetch', async (req, res) => {
  const { vendor, baseUrl, apiKey, type: reqType } = req.body || {}
  let rule = PRESET_VENDOR_LIST_RULES[vendor]
  if (!rule) {
    // 自定义供应商：按所选调用范式处理（当前仅支持 OpenAI 兼容范式）
    if (reqType !== 'openai') {
      res.status(400).json({ error: '自定义供应商暂仅支持 OpenAI 兼容类型自动获取模型列表' })
      return
    }
    rule = { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } }
  }
  // 按请求类型取对应 list 路径（缺省回退到供应商默认类型）
  const effectiveType = MODEL_LIST_TYPE[reqType] ? reqType : rule.type
  if (reqType && reqType !== rule.type) {
    // 非默认类型：若该类型无对应 list 路径则直接提示（前端通常已拦截）
    const path = rule.listPaths && rule.listPaths[reqType]
    if (!path) {
      res.status(400).json({ error: '该类型暂不支持自动获取' })
      return
    }
  }
  const type = MODEL_LIST_TYPE[effectiveType]
  const key = apiKey ? String(apiKey).trim() : ''
  const url = type.buildUrl(baseUrl ? String(baseUrl).trim() : '', rule)
  if (type.needKey && !key) {
    res.status(400).json({ error: 'API Key 不能为空' })
    return
  }
  if (type.needBaseUrl && !url) {
    res.status(400).json({ error: 'Base URL 不能为空' })
    return
  }
  // anthropic 等无需请求，直接返回内置列表
  if (!url) {
    res.json({ models: type.parse({}, rule) })
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: type.headers(key),
      signal: controller.signal,
    })
    if (!r.ok) {
      res.status(r.status < 500 ? 400 : 500).json({
        error:
          r.status === 401
            ? '鉴权失败（401），请检查 API Key'
            : r.status === 403
              ? '无权限（403）'
              : `服务端返回 HTTP ${r.status}`,
      })
      return
    }
    const json = await r.json().catch(() => ({}))
    res.json({ models: type.parse(json, rule) })
  } catch (e) {
    res.status(400).json({ error: e.name === 'AbortError' ? '请求超时（5s）' : String(e.message || e) })
  } finally {
    clearTimeout(timer)
  }
})

export default router
