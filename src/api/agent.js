// #4 代码块「应用到文件」：把代码直接写回项目文件
export async function writeProjectFile(content, relPath, projectId, permission = 'full') {
  const resp = await fetch('/api/file/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, relPath, projectId, permission }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `写入失败: ${resp.status}`)
  }
  return resp.json()
}

// 上传图片（#9）：把 dataURL 交给后端落盘，返回可访问的短 URL
export async function uploadImage(dataUrl, name = '', type = '') {
  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, name, type }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `上传失败: ${resp.status}`)
  }
  const json = await resp.json()
  return json.url
}

// 手动终端：调用本机指定 shell 执行一次性命令
export async function runCommand({ command, cwd, projectId, permission, timeout, shell }) {
  const resp = await fetch('/api/run-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, cwd, projectId, permission, timeout, shell }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `执行失败: ${resp.status}`)
  }
  return resp.json()
}

// 用本机编辑器打开文件（code / notepad / explorer / 默认关联）
export async function openInEditor({ filePath, editor, projectId, permission }) {
  const resp = await fetch('/api/open-in-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, editor, projectId, permission }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `打开失败: ${resp.status}`)
  }
  return resp.json()
}

// 扫描本机常见编辑器，返回实际可用列表（动态下拉，非写死）
export async function fetchEditors() {
  const resp = await fetch('/api/editors', { method: 'GET' })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `扫描编辑器失败: ${resp.status}`)
  }
  return resp.json()
}

// 列目录给本机编辑器文件树使用
export async function listDir({ rel, projectId }) {
  const resp = await fetch('/api/list-dir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rel, projectId }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `列目录失败: ${resp.status}`)
  }
  return resp.json()
}

// 调用本地后端，后端再流式转发百炼云
// 支持 SSE 断流自动重连（#11）：网络中断时按指数退避重试，最多 maxRetries 次；
// 重连前通过 onReset 清空本地已累积的半成品，避免重复内容；onReconnecting 用于 UI 提示。
export async function streamChat(
  messages,
  {
    config,
    projectId,
    permission,
    effort,
    tools,
    skills,
    mcpServers,
    sessionId,
    maxRetries = 3,
    onDelta,
    onReasoning,
    onToolCall,
    onToolConfirm,
    onTodoUpdate,
    onPlan,
    onSubAgentStart,
    onSubAgentDelta,
    onSubAgentTool,
    onSubAgentEnd,
    onPhase,
    onDone,
    onError,
    onReconnecting,
    onReset,
    planMode,
  } = {}
) {
  // 单次流式请求：返回 'done' | 'error' | 'dropped'
  // 'done'   —— 正常收到 [DONE]
  // 'error'  —— 业务/HTTP 错误（不应重连，直接结束）
  // 'dropped'—— 流意外中断（未收到 [DONE]），可重连
  async function runOnce() {
    let resp
    try {
      resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, config, projectId, permission, effort, tools, skills, mcpServers, sessionId, planMode }),
      })
    } catch (err) {
      // 网络层失败（连接被拒 / 断网）：视为断流，交给外层重连
      return { result: 'dropped', error: String(err) }
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      return { result: 'error', error: err.error || `请求失败: ${resp.status}` }
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let meta = null
    let finished = false

    try {
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
            finished = true
            onDone?.(meta)
            return { result: 'done' }
          }
          try {
            const json = JSON.parse(data)
            if (json.error) {
              return { result: 'error', error: json.error }
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
            if (json.type === 'todo_update') {
              onTodoUpdate?.(json.todos)
              continue
            }
            if (json.type === 'plan') {
              onPlan?.(json)
              continue
            }
            if (json.type === 'subagent_start') {
              onSubAgentStart?.(json)
              continue
            }
            if (json.type === 'subagent_delta') {
              onSubAgentDelta?.(json)
              continue
            }
            if (json.type === 'subagent_tool') {
              onSubAgentTool?.(json)
              continue
            }
            if (json.type === 'subagent_end') {
              onSubAgentEnd?.(json)
              continue
            }
            if (json.type === 'phase') {
              onPhase?.(json)
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
    } catch (err) {
      // 读取过程中断流（未收到 [DONE]）：可重连
      return { result: 'dropped', error: String(err) }
    }

    // 流自然结束但未收到 [DONE]：视为断流
    if (!finished) return { result: 'dropped', error: 'stream ended without [DONE]' }
    return { result: 'done' }
  }

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { result, error } = await runOnce()
    if (result === 'done') return
    if (result === 'error') {
      onError?.(error)
      return
    }
    // dropped —— 尝试重连
    if (attempt >= maxRetries) {
      onError?.(`连接不稳定，已自动重试 ${maxRetries} 次仍失败，请检查网络后重试`)
      return
    }
    attempt += 1
    const delay = Math.min(1000 * 2 ** (attempt - 1), 8000) // 1s, 2s, 4s ... 上限 8s
    onReconnecting?.(attempt, delay, maxRetries)
    // 重连前清空本地累积的半成品，避免重复内容
    onReset?.()
    await new Promise((r) => setTimeout(r, delay))
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

// #10 工具调用单条重试：用原始 name/args 重新执行某条工具，SSE 流式返回 start/end 事件。
// 回调：onToolRetry(call) 收到 start/end 事件；onDone() 流结束。
export async function retryToolCall(
  { projectId, permission, name, args, sessionId },
  { onToolRetry, onDone } = {}
) {
  try {
    const resp = await fetch('/api/chat/retry-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, permission, name, args, sessionId }),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      return { ok: false, error: data.error || `请求失败: ${resp.status}` }
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const part of parts) {
        const line = part.replace(/^data:\s*/, '').trim()
        if (!line || line === '[DONE]') continue
        try {
          const json = JSON.parse(line)
          if (json.type === 'tool_call') onToolRetry?.(json)
          else if (json.type === 'tool_confirm') onToolRetry?.(json) // 确认弹窗透传
          else if (json.type === 'tool_retry_done') onDone?.(json)
        } catch {
          // 忽略非 JSON 行
        }
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
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

// 读取当前文件内容（供 diff 预览：改动后状态）
export async function fetchFileContent(projectId, rel) {
  try {
    const url = `/api/file-content?projectId=${encodeURIComponent(projectId || '')}&rel=${encodeURIComponent(rel)}`
    const resp = await fetch(url)
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { content: null, error: data.error || `请求失败: ${resp.status}` }
    return { content: data.content ?? '', error: '' }
  } catch (err) {
    return { content: null, error: String(err) }
  }
}

// 读取改动前的备份文件内容（供 diff 预览：改动前状态）
export async function fetchBackupContent(projectId, backupPath) {
  try {
    const url = `/api/backup-content?projectId=${encodeURIComponent(projectId || '')}&backupPath=${encodeURIComponent(backupPath)}`
    const resp = await fetch(url)
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { content: null, error: data.error || `请求失败: ${resp.status}` }
    return { content: data.content ?? '', error: '' }
  } catch (err) {
    return { content: null, error: String(err) }
  }
}
