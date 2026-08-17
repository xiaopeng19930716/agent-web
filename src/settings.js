import { reactive } from 'vue'

const STORAGE_KEY = 'code-agent-settings'

const defaults = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  // 每个模型：{ id: 模型ID, name: 显示名, baseUrl?: 专属地址, apiKey?: 专属Key, vendorKey?: 归属供应商, maxTokens?: 最大输出长度 }
  models: [{ id: 'qwen-coder-plus', name: 'Qwen Coder Plus', vendorKey: 'bailian-coding' }],
  activeModel: 'qwen-coder-plus',
  temperature: 0.3,
  // 已配置（保存过）的供应商 key 集合
  configuredVendors: [],
  // 用户自定义供应商：{ key, name, website, baseUrl }
  customVendors: [],
  // MCP Server：{ id, name, type: 'stdio'|'http'|'sse', command?, url?, enabled }
  mcpServers: [],
  // 已启用的 skills id 集合
  enabledSkills: [],
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

function toPositiveNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  return undefined
}

function normalizeModels(list) {
  if (!Array.isArray(list)) return null
  const result = []
  for (const m of list) {
    if (typeof m === 'string') {
      result.push({ id: m, name: m })
    } else if (m && typeof m.id === 'string') {
      // 保留 baseUrl / apiKey / vendorKey / maxTokens（专属配置），缺省用全局
      result.push({
        id: m.id,
        name: m.name || m.id,
        baseUrl: m.baseUrl || '',
        apiKey: m.apiKey || '',
        vendorKey: m.vendorKey || '',
        maxTokens: toPositiveNumber(m.maxTokens),
      })
    }
  }
  return result.length ? result : null
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const merged = { ...defaults, ...parsed }
      // 兼容旧版字段
      let models = normalizeModels(parsed.models)
      if (!models && parsed.model) {
        models = [{ id: parsed.model, name: parsed.model }]
      }
      merged.models = models || defaults.models.map((m) => ({ ...m }))
      if (!merged.activeModel || !merged.models.some((m) => m.id === merged.activeModel)) {
        merged.activeModel = merged.models[0].id
      }
      merged.configuredVendors = asArray(parsed.configuredVendors)
      merged.customVendors = asArray(parsed.customVendors)
      merged.mcpServers = asArray(parsed.mcpServers)
      merged.enabledSkills = asArray(parsed.enabledSkills)
      return merged
    }
  } catch {
    // ignore
  }
  return {
    ...defaults,
    models: defaults.models.map((m) => ({ ...m })),
    configuredVendors: [],
    customVendors: [],
    mcpServers: [],
    enabledSkills: [],
  }
}

// 全局响应式设置对象
export const settings = reactive(load())

export function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function resetSettings() {
  Object.assign(settings, defaults, {
    models: defaults.models.map((m) => ({ ...m })),
    configuredVendors: [],
    customVendors: [],
    mcpServers: [],
    enabledSkills: [],
  })
  saveSettings()
}
