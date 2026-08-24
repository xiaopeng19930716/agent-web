// 调用本地后端，后端再流式转发百炼云
export async function streamChat(
  messages,
  { config, projectId, permission, effort, tools, skills, mcpServers, sessionId, onDelta, onReasoning, onToolCall, onToolConfirm, onDone, onError } = {}
) {
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, config, projectId, permission, effort, tools, skills, mcpServers, sessionId }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      onError?.(err.error || `请求失败: ${resp.status}`)
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let meta = null

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
          onDone?.(meta)
          return
        }
        try {
          const json = JSON.parse(data)
          if (json.error) {
            onError?.(json.error)
            return
          }
          if (json.type === 'meta') {
            meta = json
            continue
          }
          if (json.type === 'tool_call') {
            onToolCall?.(json)
            continue
          }
          if (json.type === 'tool_confirm') {
            onToolConfirm?.(json)
            continue
          }
          const delta = json.choices?.[0]?.delta?.content || ''
          if (delta) onDelta?.(delta)
          const reasoning = json.choices?.[0]?.delta?.reasoning || ''
          if (reasoning) onReasoning?.(reasoning)
        } catch {
          // 忽略不完整 JSON
        }
      }
    }
    onDone?.(meta)
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

// 从后端自动扫描的文件工具清单（server/lib/fileTools.js 中 buildTools 声明的全部工具）。
// 前端不再硬编码基础工具，新增工具会随此接口自动出现。
export async function fetchFileTools() {
  try {
    const resp = await fetch('/api/tools')
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { tools: [], error: data.error || `请求失败: ${resp.status}` }
    return { tools: data.tools || [], error: '' }
  } catch (err) {
    return { tools: [], error: String(err) }
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

// 列出某项目指定相对目录下的文件/子目录（供 @ 文件面板浏览）
export async function fetchProjectFiles(projectId, dir = '') {
  try {
    const url = `/api/projects/${encodeURIComponent(projectId)}/files` + (dir ? `?dir=${encodeURIComponent(dir)}` : '')
    const resp = await fetch(url)
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { items: [], path: '', error: data.error || `请求失败: ${resp.status}` }
    return { items: data.items || [], path: data.path || '', error: '' }
  } catch (err) {
    return { items: [], path: '', error: String(err) }
  }
}

// 全项目递归搜索文件名（@关键字 场景），返回含完整相对路径的结果以区分同名文件
export async function searchProjectFiles(projectId, keyword) {
  try {
    const url = `/api/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(keyword)}`
    const resp = await fetch(url)
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { results: [], error: data.error || `请求失败: ${resp.status}` }
    return { results: data.results || [], error: '' }
  } catch (err) {
    return { results: [], error: String(err) }
  }
}

// 「需确认(ask)」模式下，用户对被暂停的高风险工具调用做出允许/拒绝决定
export async function confirmToolCall({ sessionId, id, decision }) {
  try {
    const resp = await fetch('/api/chat/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, id, decision }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: data.error || `请求失败: ${resp.status}` }
    return { ok: !!data.ok }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// 「停止生成」：通知后端中断当前会话的 Agent 循环
export async function abortChat({ sessionId }) {
  try {
    await fetch('/api/chat/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  } catch {
    // 忽略网络错误（后端可能已随断流关闭）
  }
}

// 上下文压缩：请求后端把早期对话压缩为摘要（非流式），供历史过长时替换早期消息
export async function summarizeChat({ messages, config }) {
  try {
    const resp = await fetch('/api/chat/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, config }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { summary: '', error: data.error || `请求失败: ${resp.status}` }
    return { summary: data.summary || '', error: '' }
  } catch (err) {
    return { summary: '', error: String(err) }
  }
}
