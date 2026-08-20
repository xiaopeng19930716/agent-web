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
3. 用简体中文解释你的操作和思路，必要时给出完整代码片段。
4. 涉及多种方案时先给推荐方案。
5. 保持聚焦，避免冗余寒暄。`

export function buildChatModel(cfg, callbacks) {
  const baseUrl = (cfg.baseUrl || DASHSCOPE_BASE).replace(/\/$/, '')
  const apiKey = cfg.apiKey || API_KEY
  const model = cfg.model || DEFAULT_MODEL
  const temperature = typeof cfg.temperature === 'number' ? cfg.temperature : 0.3
  const maxTokens =
    typeof cfg.maxTokens === 'number' && cfg.maxTokens > 0 ? cfg.maxTokens : undefined
  return new ChatOpenAI({
    model,
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    apiKey,
    configuration: { baseURL: baseUrl },
    streaming: true,
    ...(callbacks ? { callbacks } : {}),
  })
}

// Agent loop：流式输出 + 工具调用，限制在项目目录内
export async function runAgent(model, history, projectRoot, res, permission = 'full', callbacks) {
  const tools = buildTools(projectRoot, permission)
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
  const modelWithTools = model.bindTools(tools)
  const messages = [new SystemMessage(SYSTEM_PROMPT), ...history]

  const MAX_TURNS = 12
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let aiContent = ''
    let toolCalls = []
    const callBuffers = {} // index -> {name, args, id}

    const stream = await modelWithTools.stream(messages, callbacks ? { callbacks } : undefined)
    for await (const chunk of stream) {
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
      let result
      try {
        result = t ? await t.invoke(call.args) : '未知工具: ' + call.name
      } catch (e) {
        result = '工具执行错误: ' + String(e.message || e)
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n🔧 调用 ${call.name}(${JSON.stringify(call.args)})\n` } }] })}\n\n`)
      messages.push(new ToolMessage({ content: String(result), tool_call_id: call.id }))
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
