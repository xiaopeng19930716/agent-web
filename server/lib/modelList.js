// 拉取模型列表（仅预置供应商）
// 3 种类型（openai 兼容 / anthropic 兼容 / 原生）是通用调用范式；
// 每个预置供应商自带 list 规则（路径/鉴权/解析），并映射到上述类型之一。

// 从单个模型对象提取上下文窗口字段（OpenRouter 等供应商会在 /models 返回 context_length）
function pickContextWindow(m) {
  if (!m || typeof m !== 'object') return {}
  const ctx = m.context_length || m.contextWindow || m.max_context_length
  return ctx ? { contextWindow: Number(ctx) } : {}
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
              }
        )
        .filter((m) => m.id)
    },
    needKey: false,
    needBaseUrl: true,
  },
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
