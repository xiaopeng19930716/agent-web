import { reactive } from 'vue'

const defaults = {
  // 按供应商分组：{ [vendorKey]: { name, npm, options:{apiKey,baseURL}, models:{ [modelId]: {...} } } }
  vendors: {
    'bailian-coding': {
      name: '阿里云百炼',
      npm: '@ai-sdk/openai',
      options: { apiKey: '', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      models: {
        'qwen-coder-plus': { name: 'Qwen Coder Plus', options: { temperature: 0.3 } },
      },
    },
  },
  // 当前选中模型：组合键 `${vendorKey}/${modelId}`
  activeModel: 'bailian-coding/qwen-coder-plus',
  // 已配置（保存过）的供应商 key 集合
  configuredVendors: [],
  // 已禁用的供应商 key 集合（禁用的供应商，其下的模型在对话下拉中不显示）
  disabledVendors: [],
  // 用户自定义供应商：{ key, name, website, baseUrl }
  customVendors: [],
  // MCP Server（标准格式）：{ [name]: { type: 'local'|'http'|'sse', command?: string[], url?: string } }
  mcpServers: {},
  // 已停用的 MCP server 名称集合（标准格式无 enabled 字段，单独记录）
  disabledMcpServers: [],
  // 已启用的 skills id 集合
  enabledSkills: [],
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

export function toPositiveNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  return undefined
}

// platform（UI 表单值）<-> npm（磁盘序列化值）映射
export function platformToNpm(platform) {
  if (platform === 'openai') return '@ai-sdk/openai'
  if (platform === 'anthropic') return '@ai-sdk/anthropic'
  return '' // native 或不明 -> 空
}
export function npmToPlatform(npm) {
  if (npm === '@ai-sdk/openai') return 'openai'
  if (npm === '@ai-sdk/anthropic') return 'anthropic'
  return 'native'
}

// 把「磁盘分组格式」规整为「内存结构」：
// { vendors: {...}, activeModel } + UI 态数组字段（configuredVendors/disabledVendors/customVendors）
function buildModels(parsed) {
  const merged = { vendors: {}, activeModel: '' }
  // 兼容旧版扁平格式：{ models:[...], baseUrl, apiKey, activeModel, temperature, ... }
  if (parsed && Array.isArray(parsed.models)) {
    const vendorMap = {}
    for (const m of parsed.models) {
      if (!m || !m.id) continue
      const vk = m.vendorKey || 'default'
      if (!vendorMap[vk]) {
        vendorMap[vk] = {
          name: m.vendorName || vk,
          npm: '',
          options: { apiKey: parsed.apiKey || '', baseURL: parsed.baseUrl || '' },
          models: {},
        }
      }
      const opt = {}
      if (typeof m.maxTokens === 'number') opt.maxTokens = m.maxTokens
      opt.temperature = typeof parsed.temperature === 'number' ? parsed.temperature : 0.3
      vendorMap[vk].models[m.id] = {
        name: m.name || m.id,
        baseUrl: m.baseUrl || '',
        apiKey: m.apiKey || '',
        ...(Object.keys(opt).length ? { options: opt } : {}),
      }
    }
    merged.vendors = vendorMap
    merged.activeModel = parsed.activeModel ? `${parsed.activeModel.indexOf('/') >= 0 ? '' : ''}${parsed.activeModel}` : ''
    // 旧 activeModel 只是 modelId，拼上 vendorKey
    if (parsed.activeModel && parsed.activeModel.indexOf('/') < 0) {
      const firstVk = Object.keys(vendorMap)[0]
      merged.activeModel = firstVk ? `${firstVk}/${parsed.activeModel}` : ''
    }
  } else if (parsed && parsed.vendors && typeof parsed.vendors === 'object') {
    // 新格式
    merged.vendors = parsed.vendors
    merged.activeModel = parsed.activeModel || ''
  }
  // activeModel 合法性校验
  if (merged.activeModel) {
    const [vk, mid] = merged.activeModel.split('/')
    if (!merged.vendors[vk] || !merged.vendors[vk].models || !merged.vendors[vk].models[mid]) {
      merged.activeModel = ''
    }
  }
  if (!merged.activeModel) {
    const firstVk = Object.keys(merged.vendors)[0]
    if (firstVk) {
      const firstMid = Object.keys(merged.vendors[firstVk].models)[0]
      if (firstMid) merged.activeModel = `${firstVk}/${firstMid}`
    }
  }
  merged.configuredVendors = asArray(parsed.configuredVendors)
  merged.disabledVendors = asArray(parsed.disabledVendors)
  merged.customVendors = asArray(parsed.customVendors)
  return merged
}

// 全局响应式设置对象（初始为默认值，initSettings 后由端填充）
export const settings = reactive({
  vendors: JSON.parse(JSON.stringify(defaults.vendors)),
  activeModel: defaults.activeModel,
  configuredVendors: [],
  disabledVendors: [],
  customVendors: [],
  mcpServers: {},
  disabledMcpServers: [],
  enabledSkills: [],
})

// 仅 MCP 相关字段
const MCP_KEYS = ['mcpServers', 'disabledMcpServers']

function pick(obj, keys) {
  const out = {}
  for (const k of keys) out[k] = obj[k]
  return out
}

// 展开分组结构为扁平数组，供 UI 复用（groupedModels / modelsOfVendor）
export function flattenVendors(vendors) {
  const out = []
  for (const [vendorKey, v] of Object.entries(vendors || {})) {
    if (!v || !v.models) continue
    for (const [modelId, m] of Object.entries(v.models)) {
      out.push({
        id: modelId,
        name: (m && m.name) || modelId,
        vendorKey,
        vendorName: v.name || vendorKey,
        baseUrl: (m && m.baseUrl) || (v.options && v.options.baseURL) || '',
        apiKey: (m && m.apiKey) || (v.options && v.options.apiKey) || '',
        temperature: (m && m.options && typeof m.options.temperature === 'number') ? m.options.temperature : 0.3,
        maxTokens: (m && m.maxTokens) || undefined,
        modalities: (m && m.modalities) || undefined,
      })
    }
  }
  return out
}

// 启动拉取配置（分文件存储），失败则维持本地默认值
export async function initSettings() {
  await Promise.all([initModels(), initMcp(), initOthers()])
}

// 模型配置：~/.code-agent/models.json（磁盘格式 = { activeModel, [vendorKey]: {...} }）
async function initModels() {
  try {
    const res = await fetch('/api/settings/models')
    if (!res.ok) return
    const data = await res.json()
    // 磁盘格式顶层直接是 vendorKey 映射 + activeModel，需把它俩拆出来
    const parsed = { vendors: {}, activeModel: data.activeModel || '' }
    for (const [k, v] of Object.entries(data)) {
      if (k === 'activeModel') continue
      parsed.vendors[k] = v
    }
    Object.assign(settings, buildModels(parsed))
    // 从 settings.vendors 派生 customVendors：以磁盘上的 vendor 配置为唯一真相，
    // settings.json 里的 customVendors 字段被忽略（避免失同步）
    const presetKeys = new Set(['bailian-coding', 'bailian-token', 'deepseek', 'zhipu', 'tencent'])
    const derived = []
    for (const [key, v] of Object.entries(settings.vendors)) {
      if (presetKeys.has(key)) continue
      derived.push({
        key,
        name: v.name || key,
        website: v.website || '',
        baseUrl: (v.options && v.options.baseURL) || '',
      })
    }
    settings.customVendors = derived
  } catch (e) {
    console.error('加载模型配置失败，使用默认值:', e)
  }
}

// MCP 配置：~/.code-agent/mcp.json
// 标准格式：{ mcpServers: { [name]: { type, command?: string[], url? } }, disabledMcpServers?: string[] }
// 兼容旧的数组格式（旧数据自动迁移为对象）
async function initMcp() {
  try {
    const res = await fetch('/api/settings/mcp')
    if (!res.ok) return
    const data = await res.json()
    if (data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers)) {
      settings.mcpServers = data.mcpServers
    } else if (Array.isArray(data.mcpServers)) {
      // 旧格式迁移：[{ name, type, command, url, enabled }] -> { [name]: { type, command?, url? } }
      const obj = {}
      const disabled = []
      for (const it of data.mcpServers) {
        if (!it || !it.name) continue
        const cfg = { type: it.type || 'local' }
        if (it.type === 'stdio') cfg.command = (it.command || '').split(/\s+/).filter(Boolean)
        else cfg.url = it.url || ''
        obj[it.name] = cfg
        if (it.enabled === false) disabled.push(it.name)
      }
      settings.mcpServers = obj
      settings.disabledMcpServers = disabled
    } else {
      settings.mcpServers = {}
    }
    settings.disabledMcpServers = Array.isArray(data.disabledMcpServers) ? data.disabledMcpServers : settings.disabledMcpServers || []
  } catch (e) {
    console.error('加载 MCP 配置失败，使用默认值:', e)
  }
}

// 其余配置（skills 等）：~/.code-agent/settings.json
async function initOthers() {
  try {
    const res = await fetch('/api/settings')
    if (!res.ok) return
    const data = await res.json()
    settings.enabledSkills = Array.isArray(data.enabledSkills) ? data.enabledSkills : []
  } catch (e) {
    console.error('加载其余配置失败，使用默认值:', e)
  }
}

export async function saveSettings() {
  await Promise.all([saveModels(), saveMcp(), saveOthers()])
}

// 仅回写模型配置（磁盘格式 = { activeModel, [vendorKey]: {...} }）
export async function saveModels() {
  try {
    const payload = { activeModel: settings.activeModel || '', ...settings.vendors }
    const res = await fetch('/api/settings/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return true
  } catch (e) {
    console.error('保存模型配置失败:', e)
    return false
  }
}

// 仅回写 MCP 配置
export async function saveMcp() {
  try {
    await fetch('/api/settings/mcp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pick(settings, MCP_KEYS)),
    })
  } catch (e) {
    console.error('保存 MCP 配置失败:', e)
  }
}

// 仅回写其余配置
async function saveOthers() {
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledSkills: settings.enabledSkills }),
    })
  } catch (e) {
    console.error('保存其余配置失败:', e)
  }
}

export async function resetSettings() {
  Object.assign(settings, {
    vendors: JSON.parse(JSON.stringify(defaults.vendors)),
    activeModel: defaults.activeModel,
    configuredVendors: [],
    disabledVendors: [],
    customVendors: [],
    mcpServers: {},
    disabledMcpServers: [],
    enabledSkills: [],
  })
  await saveSettings()
}
