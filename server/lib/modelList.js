// 拉取模型列表（仅预置供应商）
// 3 种类型（openai 兼容 / anthropic 兼容 / 原生）是通用调用范式；
// 每个预置供应商自带 list 规则（路径/鉴权/解析），并映射到上述类型之一。
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
            : { id: m && (m.id || m.model), name: (m && (m.name || m.id || m.model)) || (m && (m.id || m.model)) }
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
        .map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: m && (m.id || m.model), name: (m && (m.name || m.id || m.model)) || (m && (m.id || m.model)) }))
        .filter((m) => m.id)
    },
    needKey: false,
    needBaseUrl: true,
  },
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
