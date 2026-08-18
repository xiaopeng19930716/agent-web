// 调用本地后端，后端再流式转发百炼云
export async function streamChat(messages, { config, projectId, onDelta, onDone, onError } = {}) {
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, config, projectId }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      onError?.(err.error || `请求失败: ${resp.status}`)
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按 SSE 行解析：data: {...}\n\n
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          onDone?.()
          return
        }
        try {
          const json = JSON.parse(data)
          if (json.error) {
            onError?.(json.error)
            return
          }
          const delta = json.choices?.[0]?.delta?.content || ''
          if (delta) onDelta?.(delta)
        } catch {
          // 忽略不完整 JSON
        }
      }
    }
    onDone?.()
  } catch (err) {
    onError?.(String(err))
  }
}

// 测试 MCP Server 连通性（后端探测）
export async function testMcpServer(payload) {
  try {
    const resp = await fetch('/api/mcp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: data.error || `请求失败: ${resp.status}` }
    return data
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// 扫描本地 skills（后端合并多候选目录）
export async function fetchSkills() {
  try {
    const resp = await fetch('/api/skills')
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { skills: [], sourceDirs: [], error: data.error || `请求失败: ${resp.status}` }
    return { skills: data.skills || [], sourceDirs: data.sourceDirs || [] }
  } catch (err) {
    return { skills: [], sourceDirs: [], error: String(err) }
  }
}

// 扫描其他 Agent 已配置的 MCP 与 Skills（只读，供导入选择）
export async function fetchImportSources() {
  try {
    const resp = await fetch('/api/import/sources')
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { sources: [], mcpSources: [], skillSources: [], error: data.error || `请求失败: ${resp.status}` }
    return { sources: data.sources || [], mcpSources: data.mcpSources || [], skillSources: data.skillSources || [] }
  } catch (err) {
    return { sources: [], mcpSources: [], skillSources: [], error: String(err) }
  }
}

// 保存（覆盖）某 Agent 的导入路径配置
export async function saveImportPath({ agentId, configFiles, skillDirs }) {
  try {
    const resp = await fetch('/api/import/path', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, configFiles, skillDirs }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: data.error || `请求失败: ${resp.status}` }
    return { ok: true, source: data.source }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// 恢复某 Agent 到默认导入路径
export async function resetImportPath(agentId) {
  try {
    const resp = await fetch('/api/import/path', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: data.error || `请求失败: ${resp.status}` }
    return { ok: true, source: data.source }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// 仅重新扫描单个 Agent 的 MCP 与 Skills（使用其当前生效路径）
export async function scanImportAgent(agentId) {
  try {
    const resp = await fetch('/api/import/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { mcpSources: [], skillSources: [], error: data.error || `请求失败: ${resp.status}` }
    return { mcpSources: data.mcpSources || [], skillSources: data.skillSources || [] }
  } catch (err) {
    return { mcpSources: [], skillSources: [], error: String(err) }
  }
}

// 通过供应商 vendor + baseURL + API Key 拉取模型列表（预置按 vendor 分派，自定义按 type 范式）
export async function fetchModelsByVendor({ vendor, baseUrl, apiKey, type }) {
  try {
    const resp = await fetch('/api/models/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor, baseUrl, apiKey, type }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { models: [], error: data.error || `请求失败: ${resp.status}` }
    return { models: data.models || [], error: '' }
  } catch (err) {
    return { models: [], error: String(err) }
  }
}

// 将选中的技能目录软链接（Windows 为 junction）到项目 skills/ 目录
export async function importSkills(items) {
  try {
    const resp = await fetch('/api/import/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { results: [], error: data.error || `请求失败: ${resp.status}` }
    return { results: data.results || [] }
  } catch (err) {
    return { results: [], error: String(err) }
  }
}
