import { ChatOpenAI } from '@langchain/openai'
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { DASHSCOPE_BASE, API_KEY, DEFAULT_MODEL, MODELS_FILE, readConfigFile } from './config.js'
import { buildTools } from './fileTools.js'

// 从服务端持久化的 models.json 解析指定模型的密钥与 baseURL，
// 避免前端在 /chat 请求中明文传递 apiKey。密钥完全来自用户配置，不读取环境变量。
// 注意：磁盘格式是控制字段（activeModel/configuredVendors/disabledVendors）与顶层 vendorKey
// 平铺，不是嵌套在 vendors 字段里。vendor 对象自身的 name/npm/options/models 也可能是直接数据。
export function resolveModelConfig(modelKey) {
  const fallback = { apiKey: '', baseURL: DASHSCOPE_BASE }
  if (!modelKey || typeof modelKey !== 'string') return fallback
  const data = readConfigFile(MODELS_FILE)
  if (!data) return fallback
  let vk, mk
  if (modelKey.includes('/')) {
    [vk, mk] = modelKey.split('/')
  } else {
    // 兼容纯 modelId：扫描所有 vendor，匹配第一个含该 modelId 的
    for (const k of Object.keys(data)) {
      if (['activeModel', 'configuredVendors', 'disabledVendors', 'customVendors'].includes(k)) continue
      const v = data[k]
      if (v && v.models && v.models[modelKey]) {
        vk = k
        mk = modelKey
        break
      }
    }
    if (!vk) return fallback
  }
  const vendor = data[vk]
  if (!vendor) return fallback
  const model = (vendor.models && vendor.models[mk]) || {}
  const apiKey = model.apiKey || (vendor.options && vendor.options.apiKey) || ''
  const baseURL =
    model.baseUrl || (vendor.options && vendor.options.baseURL) || DASHSCOPE_BASE
  return { apiKey, baseURL }
}

// 系统提示词
// 角色与通用行为准则（不随会话变化的部分）
const SYSTEM_PROMPT_BASE = `你是一个资深的全栈编程助手（Code Agent），专注于本地项目的编程协作。

核心准则：
1. 始终基于真实工具返回的数据作答，禁止凭印象或记忆编造文件内容、函数名、配置或命令结果。
2. 凡是涉及「当前环境能力」「项目文件/目录」「依赖与配置」「命令执行结果」等真实信息时，必须先调用对应工具获取，再回答；不要假设你知道答案。
3. 修改任何代码前，先用 readFile / listFiles / searchInProject 等工具确认现状，再动手。
4. 执行修改类任务后，默认运行该项目的验证手段（如测试、构建或 lint，具体以项目自身约定为准），并把结果如实反馈给用户。
5. 复杂任务先给出简短计划（要改哪些文件、为什么），再执行；不要在不说明的情况下大范围改动多个文件。
6. 工具调用失败时，先读取报错并自我修正，最多重试 2 次；仍失败则如实告知用户，不要假装成功。
7. 当用户询问「有哪些 skills」「我能做哪些事」「列出 MCP / 工具」等环境能力相关问题时，必须调用 listSkills / listMcp 等工具获取真实数据，禁止臆造。
8. 安全边界：不执行破坏性命令（如 rm -rf / 格式化 / 强制推送），不打印或上传 .env、密钥、凭据等敏感信息；遇到此类请求先向用户说明风险并确认。
9. 输出风格：用简体中文解释操作与思路，必要时给出完整代码片段；涉及多种方案时先给推荐方案；保持聚焦，避免冗余寒暄。`

// 根据权限模式生成动态约束段
function buildPermissionSection(permission) {
  switch (permission) {
    case 'read-only':
      return (
        '\n\n当前权限模式：只读。你只能调用读取/查询类工具（readFile、listFiles、searchInProject、listSkills、listMcp 等），' +
        '禁止调用任何写文件、编辑文件或执行命令的工具（writeFile、editFile、executeCommand）。' +
        '如果用户要求修改或运行命令，请明确告知「当前为只读模式，无法执行写操作」，并说明如何切换权限。'
      )
    case 'none':
      return (
        '\n\n当前权限模式：不允许。你不能使用任何文件读写或命令执行工具，只能基于既有上下文进行讨论与建议。' +
        '若用户要求操作文件或运行命令，请明确告知「当前未授予文件操作权限」。'
      )
    case 'ask':
      return (
        '\n\n当前权限模式：需确认。你仍可正常调用全部工具（含写文件、编辑文件、执行命令），' +
        '但凡是写文件、编辑文件或执行命令类操作，在真正执行前会暂停并弹出确认请求，由用户选择「允许」或「拒绝」。' +
        '因此你直接调用工具即可，无需在文本里反复询问用户；若用户拒绝，你会收到拒绝反馈并应改用更安全的方案或向用户说明。' +
        '对破坏性命令（如 rm -rf、格式化、强制推送）即便用户允许也会被系统拦截，请主动避免。'
      )
    default:
      return (
        '\n\n当前权限模式：完全访问。你可使用全部工具（含写文件与执行命令），但请遵守安全边界（见核心准则第 8 条），' +
        '对不可逆或高风险操作先与用户确认。'
      )
  }
}

// 根据是否关联项目生成上下文段（保持中性，不预设项目类型）
function buildProjectSection(projectRoot) {
  if (!projectRoot) {
    return (
      '\n\n当前没有关联项目（通用对话模式）。你仍可回答编程问题、给出示例与建议，但不应假设存在某个本地项目文件。' +
      '本地文件读写、编辑与命令执行工具在此模式下不可用。若用户要求你创建、读取、修改文件或运行命令，' +
      '请明确告知「当前为通用对话模式，未关联项目，无法操作本地文件」，并引导用户先在界面顶部关联（或新建）一个项目后再试。'
    )
  }
  return '\n\n当前已关联一个本地项目，涉及文件操作时以其为根。'
}

// 组合完整系统提示（动态注入权限与项目上下文）
export function buildSystemPrompt({ permission = 'full', projectRoot = '' } = {}) {
  return SYSTEM_PROMPT_BASE + buildPermissionSection(permission) + buildProjectSection(projectRoot)
}

export function buildChatModel(cfg, callbacks) {
  const modelKey = cfg.model || DEFAULT_MODEL
  // 密钥优先从服务端配置解析（不依赖前端明文）；仅当服务端无配置时回退前端传入
  const resolved = resolveModelConfig(modelKey)
  // 密钥仅来自服务端配置文件（用户设置面板），不再回退到环境变量或前端明文
  const apiKey = resolved.apiKey || cfg.apiKey
  const baseUrl = (cfg.baseUrl || resolved.baseURL || DASHSCOPE_BASE).replace(/\/$/, '')
  // 传给模型的必须是纯模型名（组合键 "vendor/modelId" 需去掉 vendor 前缀）
  const model = modelKey.includes('/') ? modelKey.split('/').slice(1).join('/') : modelKey
  const temperature = typeof cfg.temperature === 'number' ? cfg.temperature : 0.3
  const maxTokens =
    typeof cfg.maxTokens === 'number' && cfg.maxTokens > 0 ? cfg.maxTokens : undefined
  const enableThinking = !!cfg.enableThinking
  const modelKwargs = {}
  // DashScope 开启思考链：透传 enable_thinking 与 reasoning 输出开关
  if (enableThinking) {
    modelKwargs.enable_thinking = true
    modelKwargs.stream_options = { include_usage: true }
  }
  return new ChatOpenAI({
    model,
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    apiKey,
    configuration: { baseURL: baseUrl },
    streaming: true,
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
    ...(callbacks ? { callbacks } : {}),
  })
}

// Agent 主循环：多轮「模型推理 → 工具调用 → 回灌结果」直至模型不再请求工具
// 全程流式输出到 res（reasoning 增量 + 正文增量 + 工具调用结构化事件）
export async function runAgent(model, history, projectRoot, res, permission = 'full', callbacks, opts = {}) {
  const {
    enabledTools,
    skillPrompts = [],
    mcpTools = [],
    mcpServers = {},
    effortHint = '',
    confirmGate = null, // 「需确认(ask)」模式下的确认闸门；非 ask 时为 null
  } = opts
  const { modelWithTools, toolMap } = buildModelWithTools(model, projectRoot, permission, enabledTools, mcpTools, mcpServers)
  const messages = buildSystemMessages(history, skillPrompts, effortHint, { permission, projectRoot })

  const MAX_TURNS = 12

  // 多轮循环：每轮让模型基于完整上下文生成一次回复
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // 流式消费本轮模型输出，得到正文与（归一化后的）工具调用列表
    const { aiContent, toolCalls } = await streamModelTurn(modelWithTools, messages, res, callbacks)

    // 把模型本轮回复加入上下文
    messages.push(new AIMessage({ content: aiContent, tool_calls: toolCalls }))

    // 模型不再请求工具 → 本轮即最终回复，结束循环
    if (toolCalls.length === 0) break

    // 逐个执行工具，并将结果回灌为 ToolMessage，供下一轮模型参考
    for (const call of toolCalls) {
      const result = await executeToolCall(call, toolMap, res, { permission, confirmGate })
      messages.push(new ToolMessage({ content: result, tool_call_id: call.id }))
    }
  }
}

// 组装工具（文件工具受项目目录安全边界约束 + MCP 工具），并绑定到模型
// 没有工具时返回原模型，避免 bindTools([]) 行为异常
function buildModelWithTools(model, projectRoot, permission, enabledTools, mcpTools, mcpServers = {}) {
  const tools = [...buildTools(projectRoot, permission, enabledTools, mcpServers), ...mcpTools]
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
  const modelWithTools = tools.length ? model.bindTools(tools) : model
  return { modelWithTools, toolMap }
}

// 拼接系统提示（动态项目约束 + 可选思考强度 + 可选技能规范）并前置历史消息
function buildSystemMessages(history, skillPrompts, effortHint = '', ctx = {}) {
  const sysText =
    buildSystemPrompt(ctx) +
    effortHint +
    (skillPrompts.length ? '\n\n已启用技能规范（请严格遵循以下技能来回答与操作）：\n' + skillPrompts.join('\n\n---\n\n') : '')
  return [new SystemMessage(sysText), ...history]
}

// 流式消费模型一轮输出：增量转发 reasoning/正文，并拼接工具调用分片
// 返回 { aiContent, toolCalls }（toolCalls 已解析 args JSON）
async function streamModelTurn(modelWithTools, messages, res, callbacks) {
  let aiContent = ''
  const callBuffers = {} // 工具调用索引 -> { name, args, id }（流式分片需拼接）

  const stream = await modelWithTools.stream(messages, callbacks ? { callbacks } : undefined)
  for await (const chunk of stream) {
    // 思考链（reasoning）增量
    const reasoning = chunk.additional_kwargs?.reasoning_content
    if (reasoning) res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning } }] })}\n\n`)

    // 正文增量
    if (chunk.content) {
      aiContent += chunk.content
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`)
    }

    // 工具调用增量：把同一 index 的 name/args/id 分片拼起来
    for (const tc of chunk.tool_call_chunks || []) {
      const idx = tc.index ?? 0
      if (!callBuffers[idx]) callBuffers[idx] = { name: '', args: '', id: '' }
      if (tc.name) callBuffers[idx].name += tc.name
      if (tc.id) callBuffers[idx].id += tc.id
      if (tc.args) callBuffers[idx].args += tc.args
    }
  }

  // 归一化工具调用列表（解析 args JSON，补全缺失 id）
  const toolCalls = Object.values(callBuffers).map((b, i) => ({
    name: b.name,
    args: safeParseArgs(b.args),
    id: b.id || `call_${i}`,
  }))
  return { aiContent, toolCalls }
}

// 执行单个工具调用：发出 start/end 结构化事件并返回结果字符串
// options.confirmGate：ask 模式下的确认闸门（非 ask 模式不传，直接执行）
async function executeToolCall(call, toolMap, res, options = {}) {
  const { permission = 'full', confirmGate = null } = options
  const tool = toolMap[call.name]

  res.write(`data: ${JSON.stringify({ type: 'tool_call', name: call.name, args: call.args, status: 'start' })}\n\n`)

  // 危险命令强制拦截（即便用户/模型允许也拒绝），与 executeCommand 内部规则保持一致
  if (call.name === 'executeCommand' && isDangerousCommand(call.args && call.args.command)) {
    const denied = '已拒绝执行：检测到破坏性/高风险命令（' + (call.args.command || '') + '），系统已强制拦截。请改用更安全的操作。'
    res.write(`data: ${JSON.stringify({ type: 'tool_call', id: call.id, name: call.name, status: 'denied', result: denied })}\n\n`)
    return denied
  }

  // ask 模式 + 高风险工具 -> 暂停等待用户确认
  const needConfirm = permission === 'ask' && confirmGate && tool && (tool.risk === 'write' || tool.risk === 'danger')
  if (needConfirm) {
    const decision = await confirmGate.ask(call.id, call.name, call.args)
    if (decision === 'deny') {
      const denied = '用户拒绝了该工具调用（' + call.name + '）。请向用户说明，并改用其他安全方案或停止该操作。'
      res.write(`data: ${JSON.stringify({ type: 'tool_call', id: call.id, name: call.name, status: 'denied', result: denied })}\n\n`)
      return denied
    }
  }

  let result
  try {
    result = tool ? await tool.invoke(call.args) : '未知工具: ' + call.name
  } catch (e) {
    result = '工具执行错误: ' + String(e.message || e)
  }
  res.write(`data: ${JSON.stringify({ type: 'tool_call', id: call.id, name: call.name, status: 'end', result: String(result) })}\n\n`)
  return String(result)
}

// 破坏性命令识别：与 executeCommand 安全边界一致（不可绕过）
function isDangerousCommand(command) {
  if (!command || typeof command !== 'string') return false
  const c = command.trim()
  const patterns = [
    /\brm\s+-rf\b/,
    /\brm\s+-fr\b/,
    /\brmdir\s+\/s\b/i,
    /\bformat\s+/i,
    /\bshutdown\b/i,
    /\bmkfs\b/,
    /\bgit\s+push\b[^\n]*--force/,
    /\bgit\s+push\b[^\n]*-f\b/,
    /\bgit\s+reset\b[^\n]*--hard/,
    /\bdel\s+\/[sq]/i,
    />\s*\/dev\/sd/,
    /\bdd\b[^\n]*\bof=\/dev/,
  ]
  return patterns.some((p) => p.test(c))
}

// 解析工具参数 JSON，解析失败则回退为空对象（保证后续流程不崩）
function safeParseArgs(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// 将思考强度（effort）映射为系统提示片段
export function buildEffortHint(effort) {
  if (effort === 'low') return '\n\n思考强度：低。优先给出最直接的解决方案，避免展开过多探索。'
  if (effort === 'high') return '\n\n思考强度：高。请充分推理，权衡多种方案并验证边界情况后再作答。'
  return ''
}

// 纯流式输出一轮：转发 reasoning/正文增量，返回拼接后的正文内容（不处理工具）
async function streamSingleTurn(model, messages, res, callbacks) {
  let aiContent = ''
  const stream = await model.stream(messages, callbacks ? { callbacks } : undefined)
  for await (const chunk of stream) {
    const reasoning = chunk.additional_kwargs?.reasoning_content
    if (reasoning) res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning } }] })}\n\n`)
    if (chunk.content) {
      aiContent += chunk.content
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`)
    }
  }
  return aiContent
}

// 无项目分支：仅注入系统提示（项目约束 + 思考强度 + 技能规范）后做纯流式补全
export async function streamChatNoProject(model, messages, skillPrompts, effortHint, res, callbacks) {
  const sysText =
    buildSystemPrompt({ permission: 'full', projectRoot: '' }) +
    effortHint +
    (skillPrompts.length ? '\n\n已启用技能规范：\n' + skillPrompts.join('\n\n---\n\n') : '')
  const msgs = [new SystemMessage(sysText), ...(messages || []).map(toLangchainMessage)]
  await streamSingleTurn(model, msgs, res, callbacks)
}

export function toLangchainMessage(m) {
  if (m.role === 'user') return new HumanMessage(m.content)
  if (m.role === 'assistant') return new AIMessage(m.content)
  return new HumanMessage(m.content)
}

// Token 统计回调处理器
export class TokenStatsHandler extends BaseCallbackHandler {
  constructor(usageRef) {
    super()
    this.name = 'TokenStatsHandler'
    this.usageRef = usageRef
  }
  handleLLMEnd(output) {
    const u = output?.llmOutput?.usage || output?.llmOutput?.tokenUsage || {}
    this.usageRef.promptTokens += u.prompt_tokens || u.promptTokens || 0
    this.usageRef.completionTokens += u.completion_tokens || u.completionTokens || 0
  }
}
