import { ChatOpenAI } from '@langchain/openai'
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { DASHSCOPE_BASE, API_KEY, DEFAULT_MODEL } from './config.js'
import { buildTools } from './fileTools.js'

// 系统提示词
export const SYSTEM_PROMPT = `你是一个资深的全栈编程助手（Code Agent），正在操作一个本地项目。
规则：
1. 优先使用工具读取/修改项目文件，不要凭空编造文件内容。
2. 修改代码前先用 readFile 或 listFiles 确认现状。
3. 完成修改后，可用 executeCommand 运行测试、构建或 lint 来验证改动是否正确（如 npm test / npm run build），并将结果反馈给用户。
4. 用简体中文解释你的操作和思路，必要时给出完整代码片段。
5. 涉及多种方案时先给推荐方案。
6. 保持聚焦，避免冗余寒暄。`

export function buildChatModel(cfg, callbacks) {
  const baseUrl = (cfg.baseUrl || DASHSCOPE_BASE).replace(/\/$/, '')
  const apiKey = cfg.apiKey || API_KEY
  const model = cfg.model || DEFAULT_MODEL
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

// Agent loop：流式输出 + 工具调用，限制在项目目录内
export async function runAgent(model, history, projectRoot, res, permission = 'full', callbacks, opts = {}) {
  const { enabledTools, skillPrompts = [], mcpTools = [] } = opts
  const fileTools = buildTools(projectRoot, permission, enabledTools)
  const tools = [...fileTools, ...mcpTools]
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
  // 空工具时不绑定（纯对话），避免 bindTools([]) 行为异常
  const modelWithTools = tools.length ? model.bindTools(tools) : model
  const sysText =
    SYSTEM_PROMPT + (skillPrompts.length ? '\n\n已启用技能规范（请严格遵循以下技能来回答与操作）：\n' + skillPrompts.join('\n\n---\n\n') : '')
  const messages = [new SystemMessage(sysText), ...history]

  const MAX_TURNS = 12
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let aiContent = ''
    let toolCalls = []
    const callBuffers = {} // index -> {name, args, id}

    const stream = await modelWithTools.stream(messages, callbacks ? { callbacks } : undefined)
    for await (const chunk of stream) {
      // 思考链（reasoning）增量
      const reasoning = chunk.additional_kwargs?.reasoning_content
      if (typeof reasoning === 'string' && reasoning) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning } }] })}\n\n`)
      }
      if (typeof chunk.content === 'string' && chunk.content) {
        aiContent += chunk.content
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`)
      }
      const chunks = chunk.tool_call_chunks || []
      for (const tc of chunks) {
        const idx = tc.index ?? 0
        if (!callBuffers[idx]) callBuffers[idx] = { name: '', args: '', id: '' }
        if (tc.name) callBuffers[idx].name += tc.name
        if (tc.id) callBuffers[idx].id += tc.id
        if (tc.args) callBuffers[idx].args += tc.args
      }
    }

    for (const idx of Object.keys(callBuffers)) {
      const b = callBuffers[idx]
      let args = {}
      try {
        args = b.args ? JSON.parse(b.args) : {}
      } catch {
        args = {}
      }
      toolCalls.push({ name: b.name, args, id: b.id || `call_${idx}` })
    }

    messages.push(new AIMessage({ content: aiContent, tool_calls: toolCalls }))

    if (toolCalls.length === 0) break

    for (const call of toolCalls) {
      const t = toolMap[call.name]
      // 工具调用开始事件（结构化，进入思考区时间线）
      res.write(`data: ${JSON.stringify({ type: 'tool_call', name: call.name, args: call.args, status: 'start' })}\n\n`)
      let result
      try {
        result = t ? await t.invoke(call.args) : '未知工具: ' + call.name
      } catch (e) {
        result = '工具执行错误: ' + String(e.message || e)
      }
      const safeResult = String(result)
      res.write(`data: ${JSON.stringify({ type: 'tool_call', id: call.id, name: call.name, status: 'end', result: safeResult })}\n\n`)
      messages.push(new ToolMessage({ content: safeResult, tool_call_id: call.id }))
    }
  }
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
