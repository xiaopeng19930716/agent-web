import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

// 把 MCP 工具列表（动态 JSON Schema）封装成 LangChain tool，供 Agent bindTools 调用。
// 每个 MCP 工具的调用委托回对应的 client.callTool，异常时返回错误文本而不抛错。

// 递归把 MCP JSON Schema 转为 zod schema（宽松转换：无法精确映射的类型用 z.any()）
function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== 'object') return z.any().optional()
  switch (schema.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(jsonSchemaToZod(schema.items)).optional()
    case 'object': {
      const shape = {}
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [k, v] of Object.entries(schema.properties)) {
          shape[k] = jsonSchemaToZod(v)
        }
      }
      const required = Array.isArray(schema.required) ? schema.required : []
      for (const k of Object.keys(shape)) {
        if (!required.includes(k)) shape[k] = shape[k].optional()
      }
      return z.object(shape)
    }
    default:
      return z.any().optional()
  }
}

// 归一化单个 MCP server 配置为 Client Transport
// 支持：type 'local'/'stdio'（command 数组或字符串）、'http'/'sse'（url）
function createTransport(serverConfig) {
  const { type, command, url } = serverConfig || {}
  const t = String(type || '').toLowerCase()
  if (t === 'http' || t === 'sse') {
    if (!url) return null
    return new StreamableHTTPClientTransport(new URL(url))
  }
  // stdio / local
  let cmdArr = command
  if (typeof command === 'string') cmdArr = command.trim().split(/\s+/)
  if (!Array.isArray(cmdArr) || !cmdArr.length) return null
  const [cmd, ...args] = cmdArr
  return new StdioClientTransport({ command: cmd, args })
}

// MCP 工具只读启发式：仅当名称/描述明确只读时才判为只读，否则保守视为「可写」。
// 这样计划模式默认只放行“看起来安全”的 MCP 工具，其余一律不暴露。
const READ_HINTS = /\b(read|get|fetch|list|query|search|find|describe|inspect|browse|cat|stat|info|show|lookup|preview|ping|status)\b/i
const WRITE_HINTS = /\b(write|create|edit|update|delete|remove|add|set|push|commit|send|post|put|upload|save|move|rename|copy|make|build|run|exec|install|publish|deploy|format|start|stop|restart|clear|drop|insert|patch)\b/i

function inferMcpRisk(toolName, description, serverReadOnly) {
  // 用户显式声明优先（服务器级 readOnly：true=整台只读 / false=整台可写）
  if (typeof serverReadOnly === 'boolean') return serverReadOnly ? 'read' : 'write'
  const text = toolName + ' ' + (description || '')
  if (WRITE_HINTS.test(text) && !READ_HINTS.test(toolName)) return 'write'
  if (READ_HINTS.test(text) && !WRITE_HINTS.test(text)) return 'read'
  return 'write' // 无法确定 -> 保守视为写
}

// 判断单个 MCP 工具的读写风险（优先级：标准 annotations > 服务器配置 readOnly > 启发式）
function resolveMcpRisk(mcpToolDef, serverConfig) {
  const ann = mcpToolDef.annotations || {}
  if (ann.readOnlyHint === true) return 'read'
  if (ann.destructiveHint === true) return 'write'
  return inferMcpRisk(mcpToolDef.name, mcpToolDef.description, serverConfig && serverConfig.readOnly)
}

// 加载 MCP 服务器并返回封装好的 LangChain 工具数组。
// mcpServers：{ [name]: { type, command?, url?, enabled?, readOnly? } }。
// readOnly 为布尔时表示「整台服务器只读/可写」（用户在设置面板手动标记）；
// 单个服务器失败时降级跳过，不影响其余。每个工具会携带 metadata.risk（read/write）。
export async function loadMcpTools(mcpServers) {
  if (!mcpServers || typeof mcpServers !== 'object') return []
  const enabled = Object.entries(mcpServers).filter(([, cfg]) => cfg && cfg.enabled !== false)
  if (!enabled.length) return []

  const allTools = []

  for (const [serverName, serverConfig] of enabled) {
    let client
    try {
      client = new Client({ name: 'code-agent', version: '0.1.0' })
      const transport = createTransport(serverConfig)
      if (!transport) continue
      await client.connect(transport)
      const { tools } = await client.listTools()
      for (const t of tools || []) {
        const zodSchema = jsonSchemaToZod(t.inputSchema)
        const risk = resolveMcpRisk(t, serverConfig)
        const mcpTool = tool(
          async (args) => {
            try {
              const result = await client.callTool({ name: t.name, arguments: args || {} })
              const texts = (result?.content || [])
                .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
              return texts.length ? texts.join('\n') : JSON.stringify(result)
            } catch (e) {
              return 'MCP 工具执行错误: ' + String(e?.message || e)
            }
          },
          {
            name: `${serverName}__${t.name}`,
            description: `[MCP:${serverName}] ${t.description || t.name}`,
            schema: zodSchema,
          }
        )
        // 手动挂载风险标记（避免依赖 LangChain tool() 对 metadata 的支持差异）
        mcpTool.risk = risk
        mcpTool.metadata = mcpTool.metadata || {}
        mcpTool.metadata.risk = risk
        mcpTool.metadata.serverName = serverName
        allTools.push(mcpTool)
      }
    } catch (e) {
      console.error(`加载 MCP 服务器 ${serverName} 失败（已跳过）:`, e?.message || e)
    }
  }

  return allTools
}
