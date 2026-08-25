// 拉取模型列表（仅预置供应商）
// 3 种类型（openai 兼容 / anthropic 兼容 / 原生）是通用调用范式；
// 每个预置供应商自带 list 规则（路径/鉴权/解析），并映射到上述类型之一。

// 从单个模型对象提取上下文窗口字段（OpenRouter 等供应商会在 /models 返回 context_length）
function pickContextWindow(m) {
  if (!m || typeof m !== 'object') return {}
  const ctx = m.context_length || m.contextWindow || m.max_context_length
  return ctx ? { contextWindow: Number(ctx) } : {}
}

// 从单个模型对象提取 maxTokens 字段（部分供应商 /models 会返回 max_completion_tokens / max_output_tokens 等）
function pickMaxTokens(m) {
  if (!m || typeof m !== 'object') return {}
  const t = m.max_completion_tokens || m.max_output_tokens || m.max_tokens || m.output_tokens
  return t ? { maxTokens: Number(t) } : {}
}

export const MODEL_LIST_TYPE = {
  // OpenAI 兼容范式：GET {baseUrl}/models，Bearer 鉴权，解析 json.data[].id
  openai: {
    buildUrl: (baseUrl, rule) => String(baseUrl).replace(/\/+$/, '') + ((rule.listPaths && rule.listPaths.openai) || '/models'),
    headers: (apiKey) => ({ Authorization: 'Bearer ' + apiKey }),
    parse: (json) => {
      const list = Array.isArray(json.data) ? json.data : []
      return list
        .map((m) =>
          typeof m === 'string'
            ? { id: m, name: m }
            : {
                id: m && (m.id || m.model),
                name: (m && (m.name || m.id || m.model)) || (m && (m.id || m.model)),
                ...pickContextWindow(m),
                ...pickMaxTokens(m),
              }
        )
        .filter((m) => m.id)
    },
    needKey: true,
    needBaseUrl: true,
  },
  // Anthropic 兼容范式：官方无 list 接口，回退内置常量
  anthropic: {
    buildUrl: () => null,
    headers: () => ({}),
    parse: () => [
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    ],
    needKey: false,
    needBaseUrl: false,
  },
  // 原生接口范式：按供应商规则自定义解析
  native: {
    buildUrl: (baseUrl, rule) => String(baseUrl).replace(/\/+$/, '') + ((rule.listPaths && rule.listPaths.native) || ''),
    headers: (apiKey) => (apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
    parse: (json, rule) => {
      const field = rule.parseField || 'data'
      const list = Array.isArray(json[field]) ? json[field] : []
      return list
        .map((m) =>
          typeof m === 'string'
            ? { id: m, name: m }
            : {
                id: m && (m.id || m.model),
                name: (m && (m.name || m.id || m.model)) || (m && (m.id || m.model)),
                ...pickContextWindow(m),
                ...pickMaxTokens(m),
              }
        )
        .filter((m) => m.id)
    },
    needKey: false,
    needBaseUrl: true,
  },
}

// 常见模型 maxTokens（最大输出 token）兜底表：/models 接口通常只返回 id/name，
// 自动获取拿不到 maxTokens 时按模型 id 补全，选中模型后自动填入（保守值）。
export const KNOWN_MAX_TOKENS = {
  'qwen-coder-plus': 8192,
  'qwen-coder-turbo': 8192,
  'qwen-plus': 8192,
  'qwen-max': 8192,
  'qwen-turbo': 8192,
  'deepseek-chat': 8192,
  'deepseek-reasoner': 8192,
  'glm-4-plus': 8192,
  'glm-4-flash': 8192,
  'glm-4-long': 8192,
  'hunyuan-turbo': 8192,
  'hunyuan-pro': 8192,
  'gpt-4o': 16384,
  'gpt-4o-mini': 16384,
  'gpt-4.1': 32768,
  'claude-3-5-sonnet-latest': 8192,
  'claude-3-5-haiku-latest': 8192,
  'claude-3-opus-latest': 8192,
  'claude-3-sonnet-20240229': 8192,
  'claude-3-haiku-20240307': 8192,
  // —— 阿里云百炼（qwen 系列补充，含版本号/多模态）——
  'qwen3-plus': 8192,
  'qwen3-max': 8192,
  'qwen3-turbo': 8192,
  'qwen3-coder-plus': 8192,
  'qwen2.5-coder-plus': 8192,
  'qwen2.5-coder-turbo': 8192,
  'qwen2.5-plus': 8192,
  'qwen2.5-max': 8192,
  'qwen2.5-turbo': 8192,
  'qwen-vl-plus': 8192,
  'qwen-vl-max': 8192,
  'qwen-vl-ocr': 8192,
  // —— DeepSeek ——
  'deepseek-v3': 8192,
  'deepseek-r1': 8192,
  // —— 智谱 GLM ——
  'glm-4-air': 8192,
  'glm-4v-plus': 8192,
  'glm-4v-flash': 8192,
  'glm-4.5': 8192,
  'glm-4.6': 8192,
  'glm-z1': 8192,
  'glm-z1-flash': 8192,
  // —— 腾讯混元 ——
  'hunyuan-large': 8192,
  'hunyuan-turbos': 8192,
  'hunyuan-code': 8192,
  'hunyuan-standard': 8192,
  'hunyuan-lite': 8192,
}

// 模型 ID 系列规则（前缀/正则匹配）：覆盖带版本号/日期后缀的 ID（如 qwen3.7-plus-2026-05-26），
// 精确 ID 表匹配不到时按系列兜底。数组有序，越靠前越具体，命中即用。
const MODEL_ID_RULES = [
  { re: /^qwen.*coder/i, contextWindow: 131072, maxTokens: 8192 },
  { re: /^qwen.*plus/i, contextWindow: 131072, maxTokens: 8192 },
  { re: /^qwen.*max/i, contextWindow: 32768, maxTokens: 8192 },
  { re: /^qwen.*turbo/i, contextWindow: 1000000, maxTokens: 8192 },
  { re: /^qwen/i, contextWindow: 131072, maxTokens: 8192 },
  { re: /^deepseek/i, contextWindow: 128000, maxTokens: 8192 },
  { re: /^glm/i, contextWindow: 128000, maxTokens: 8192 },
  { re: /^hunyuan/i, contextWindow: 32768, maxTokens: 8192 },
  { re: /^gpt-4o/i, contextWindow: 128000, maxTokens: 16384 },
  { re: /^gpt-4/i, contextWindow: 128000, maxTokens: 16384 },
  { re: /^gpt/i, contextWindow: 128000, maxTokens: 16384 },
  { re: /^claude/i, contextWindow: 200000, maxTokens: 8192 },
]

// 按模型 id 匹配 contextWindow / maxTokens：精确表优先，缺失字段用系列规则兜底
export function matchKnownById(id) {
  if (!id || typeof id !== 'string') return {}
  const out = {}
  if (KNOWN_CONTEXT_WINDOWS[id] !== undefined) out.contextWindow = KNOWN_CONTEXT_WINDOWS[id]
  if (KNOWN_MAX_TOKENS[id] !== undefined) out.maxTokens = KNOWN_MAX_TOKENS[id]
  if (out.contextWindow !== undefined && out.maxTokens !== undefined) return out
  for (const rule of MODEL_ID_RULES) {
    if (rule.re.test(id)) {
      if (out.contextWindow === undefined) out.contextWindow = rule.contextWindow
      if (out.maxTokens === undefined) out.maxTokens = rule.maxTokens
      break
    }
  }
  return out
}

// 常见模型上下文窗口（token）兜底表：自动获取拿不到、用户未手动填写时使用。
// 值取官方文档常见档位，保守优先（防止爆窗优先于精确）。
export const KNOWN_CONTEXT_WINDOWS = {
  'qwen-coder-plus': 131072,
  'qwen-coder-turbo': 131072,
  'qwen-plus': 131072,
  'qwen-max': 32768,
  'qwen-turbo': 1000000,
  'deepseek-chat': 128000,
  'deepseek-reasoner': 128000,
  'glm-4-plus': 128000,
  'glm-4-flash': 128000,
  'glm-4-long': 1000000,
  'hunyuan-turbo': 32768,
  'hunyuan-pro': 32768,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1000000,
  'claude-3-5-sonnet-latest': 200000,
  'claude-3-5-haiku-latest': 200000,
  'claude-3-opus-latest': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  // —— 阿里云百炼（qwen 系列补充，含版本号/多模态）——
  'qwen3-plus': 131072,
  'qwen3-max': 32768,
  'qwen3-turbo': 1000000,
  'qwen3-coder-plus': 131072,
  'qwen2.5-coder-plus': 131072,
  'qwen2.5-coder-turbo': 131072,
  'qwen2.5-plus': 131072,
  'qwen2.5-max': 32768,
  'qwen2.5-turbo': 1000000,
  'qwen-vl-plus': 131072,
  'qwen-vl-max': 32768,
  'qwen-vl-ocr': 131072,
  // —— DeepSeek ——
  'deepseek-v3': 128000,
  'deepseek-r1': 128000,
  // —— 智谱 GLM ——
  'glm-4-air': 128000,
  'glm-4v-plus': 128000,
  'glm-4v-flash': 128000,
  'glm-4.5': 128000,
  'glm-4.6': 128000,
  'glm-z1': 128000,
  'glm-z1-flash': 128000,
  // —— 腾讯混元 ——
  'hunyuan-large': 32768,
  'hunyuan-turbos': 32768,
  'hunyuan-code': 32768,
  'hunyuan-standard': 32768,
  'hunyuan-lite': 32768,
}

// 预置供应商各自的 list 规则（按 vendor key 索引）
// listPaths 按类型决定模型列表路径（openai 兼容→/models；其余类型前端已拦截，后端仅作兜底）
export const PRESET_VENDOR_LIST_RULES = {
  'bailian-coding': { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
  'bailian-token': { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
  deepseek: { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
  zhipu: { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '/v1/models' } },
  tencent: { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
}
