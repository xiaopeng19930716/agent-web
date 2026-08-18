import express from 'express'
import cors from 'cors'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from 'dotenv'
import { tool } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const API_KEY = process.env.DASHSCOPE_API_KEY
const DEFAULT_MODEL = process.env.DASHSCOPE_MODEL || 'qwen-coder-plus'

// ===== 项目存储（后端信任的唯一路径来源，防止前端越权访问任意目录）=====
const PROJECTS_FILE = join(__dirname, 'projects.json')
/** @type {Map<string, {id:string, alias:string, path:string, modelId?:string}>} */
const projects = new Map()

function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
      for (const p of arr) projects.set(p.id, p)
    }
  } catch (e) {
    console.error('加载 projects.json 失败:', e)
  }
}
function saveProjects() {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([...projects.values()], null, 2))
}
loadProjects()

app.get('/api/projects', (_req, res) => {
  res.json([...projects.values()])
})

app.post('/api/projects', (req, res) => {
  const { alias, path: dir, modelId } = req.body || {}
  if (!alias || !dir) {
    res.status(400).json({ error: 'alias 和 path 不能为空' })
    return
  }
  // 校验路径存在且为目录
  let stat
  try {
    stat = fs.statSync(dir)
  } catch {
    res.status(400).json({ error: '目录不存在或无访问权限: ' + dir })
    return
  }
  if (!stat.isDirectory()) {
    res.status(400).json({ error: 'path 不是目录: ' + dir })
    return
  }
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const project = { id, alias, path: path.resolve(dir), modelId }
  projects.set(id, project)
  saveProjects()
  res.json(project)
})

app.delete('/api/projects/:id', (req, res) => {
  const id = req.params.id
  const ok = projects.delete(id)
  if (ok) {
    saveProjects()
    // 级联删除该项目下的所有会话
    let removed = false
    for (const [sid, s] of [...sessions.entries()]) {
      if ((s.projectId || NO_PROJECT_KEY) === id) {
        sessions.delete(sid)
        removed = true
      }
    }
    if (removed) saveSessions()
  }
  res.json({ ok })
})

// 按目录名在常见根目录下查找真实绝对路径（浏览器选择文件夹拿不到绝对路径的场景）
app.get('/api/locate-dir', (req, res) => {
  const name = (req.query.name || '').toString().trim()
  if (!name) {
    res.status(400).json({ error: '缺少 name 参数' })
    return
  }
  const roots = [
    join(os.homedir()),
    'C:/',
    'D:/',
    'E:/',
  ].filter((r) => {
    try {
      return fs.existsSync(r) && fs.statSync(r).isDirectory()
    } catch {
      return false
    }
  })

  const results = []
  const MAX_DEPTH = 4
  const MAX_RESULTS = 10
  const walk = (dir, depth) => {
    if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = join(dir, e.name)
      if (e.name === name) {
        results.push(full)
        if (results.length >= MAX_RESULTS) return
        continue
      }
      // 跳过常见的无关节点（隐藏、node_modules、.git 等）以提速
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      walk(full, depth + 1)
    }
  }
  for (const r of roots) {
    if (results.length >= MAX_RESULTS) break
    walk(r, 1)
  }
  res.json({ results })
})

// ===== 会话存储（按项目归属，持久化对话消息）=====
const NO_PROJECT_KEY = '__none__'
const SESSIONS_FILE = join(__dirname, 'sessions.json')
/** @type {Map<string, {id:string, projectId:string, title:string, messages:any[], createdAt:number, updatedAt:number}>} */
const sessions = new Map()

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'))
      for (const s of arr) sessions.set(s.id, s)
    }
  } catch (e) {
    console.error('加载 sessions.json 失败:', e)
  }
}
function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions.values()], null, 2))
}
loadSessions()

app.get('/api/sessions', (_req, res) => {
  let list = [...sessions.values()]
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  res.json(list)
})
app.post('/api/sessions', (req, res) => {
  const { projectId, title } = req.body || {}
  const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const now = Date.now()
  const session = {
    id,
    projectId: projectId || '__none__',
    title: title || '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  sessions.set(id, session)
  saveSessions()
  res.json(session)
})
app.put('/api/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id)
  if (!s) return res.status(404).json({ error: '会话不存在' })
  const { title, messages } = req.body || {}
  if (typeof title === 'string') s.title = title
  if (Array.isArray(messages)) s.messages = messages
  s.updatedAt = Date.now()
  sessions.set(s.id, s)
  saveSessions()
  res.json(s)
})
app.delete('/api/sessions/:id', (req, res) => {
  const ok = sessions.delete(req.params.id)
  if (ok) saveSessions()
  res.json({ ok })
})

// ===== 文件工具（严格限制在项目根目录内）=====
function safeResolve(root, rel) {
  const target = path.resolve(root, rel || '')
  const rel2 = path.relative(root, target)
  if (rel2.startsWith('..') || path.isAbsolute(rel2)) {
    throw new Error('路径越界，超出项目目录: ' + rel)
  }
  return target
}
function tree(root, dir, depth, out) {
  if (depth > 4) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    const rel = path.relative(root, full)
    if (e.isDirectory()) {
      out.push('[D] ' + rel + '/')
      tree(root, full, depth + 1, out)
    } else {
      const sz = fs.statSync(full).size
      out.push(`[F] ${rel} (${sz}B)`)
    }
  }
}
function grep(root, pattern, dir, results, depth) {
  if (depth > 8 || results.length > 200) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const re = new RegExp(pattern, 'i')
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    const rel = path.relative(root, full)
    if (e.isDirectory()) {
      grep(root, pattern, full, results, depth + 1)
    } else if (re.test(e.name) || re.test(rel)) {
      results.push('匹配文件: ' + rel)
    } else {
      try {
        const content = fs.readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${rel}:${i + 1}: ${lines[i].slice(0, 200)}`)
            if (results.length > 200) return
          }
        }
      } catch {
        // 非文本文件跳过
      }
    }
  }
}

function buildTools(root, permission = 'full') {
  // permission: 'full' 可写；'read-only' / 'none' 禁止写入文件
  const canWrite = permission === 'full'
  const writeGuard = async (fn) => {
    if (!canWrite) return '当前权限为只读，无法写入或编辑文件。如需修改文件，请在对话框中将权限级别切换为「完全访问」。'
    return fn()
  }
  return [
    tool(
      async ({ dir = '.' }) => {
        const out = []
        tree(root, safeResolve(root, dir), 0, out)
        return out.join('\n') || '(空目录)'
      },
      {
        name: 'listFiles',
        description: '列出项目目录结构（默认根目录）。dir 为相对项目根目录的路径。',
        schema: {
          type: 'object',
          properties: { dir: { type: 'string', description: '相对目录，默认 "."' } },
          required: [],
        },
      }
    ),
    tool(
      async ({ filePath }) => {
        const full = safeResolve(root, filePath)
        return await fsp.readFile(full, 'utf-8')
      },
      {
        name: 'readFile',
        description: '读取项目内某个文件的完整内容。filePath 为相对项目根目录的路径。',
        schema: {
          type: 'object',
          properties: { filePath: { type: 'string', description: '相对路径，如 src/App.vue' } },
          required: ['filePath'],
        },
      }
    ),
    tool(
      async ({ filePath, content }) => {
        const full = safeResolve(root, filePath)
        return writeGuard(async () => {
          await fsp.writeFile(full, content, 'utf-8')
          return '已写入: ' + filePath
        })
      },
      {
        name: 'writeFile',
        description: '创建或覆盖写入文件（需「完全访问」权限，仅 full 模式可用）。',
        schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: '相对路径' },
            content: { type: 'string', description: '完整文件内容' },
          },
          required: ['filePath', 'content'],
        },
      }
    ),
    tool(
      async ({ filePath, oldStr, newStr }) => {
        const full = safeResolve(root, filePath)
        return writeGuard(async () => {
          const text = await fsp.readFile(full, 'utf-8')
          if (!text.includes(oldStr)) return '错误：未在文件中找到 oldStr。'
          const updated = text.replace(oldStr, newStr)
          await fsp.writeFile(full, updated, 'utf-8')
          return '已修改: ' + filePath
        })
      },
      {
        name: 'editFile',
        description: '在文件中把 oldStr 替换为 newStr（首次出现），用于局部修改代码（需「完全访问」权限）。',
        schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            oldStr: { type: 'string', description: '要被替换的原始代码片段' },
            newStr: { type: 'string', description: '替换后的代码' },
          },
          required: ['filePath', 'oldStr', 'newStr'],
        },
      }
    ),
    tool(
      async ({ pattern }) => {
        const results = []
        grep(root, pattern, root, results, 0)
        return results.join('\n') || '(无匹配)'
      },
      {
        name: 'searchInProject',
        description: '在项目内按正则搜索文件名或文件内容（大小写不敏感）。',
        schema: {
          type: 'object',
          properties: { pattern: { type: 'string', description: '正则表达式' } },
          required: ['pattern'],
        },
      }
    ),
  ]
}

// ===== 系统提示词 =====
const SYSTEM_PROMPT = `你是一个资深的全栈编程助手（Code Agent），正在操作一个本地项目。
规则：
1. 优先使用工具读取/修改项目文件，不要凭空编造文件内容。
2. 修改代码前先用 readFile 或 listFiles 确认现状。
3. 用简体中文解释你的操作和思路，必要时给出完整代码片段。
4. 涉及多种方案时先给推荐方案。
5. 保持聚焦，避免冗余寒暄。`

// ===== 接收前端设置的运行时配置 =====
function buildChatModel(cfg) {
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
  })
}

// ===== Agent loop：流式输出 + 工具调用，限制在项目目录内 =====
async function runAgent(model, history, projectRoot, res, permission = 'full') {
  const tools = buildTools(projectRoot, permission)
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
  const modelWithTools = model.bindTools(tools)
  const messages = [new SystemMessage(SYSTEM_PROMPT), ...history]

  const MAX_TURNS = 12
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let aiContent = ''
    let toolCalls = []
    const callBuffers = {} // index -> {name, args, id}

    const stream = await modelWithTools.stream(messages)
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

// ===== 普通对话（无项目）=====
app.post('/api/chat', async (req, res) => {
  const cfg = req.body.config || {}
  const apiKey = cfg.apiKey || API_KEY
  const model = cfg.model || DEFAULT_MODEL
  if (!apiKey) {
    res.status(500).json({ error: '未配置 API Key：请在设置面板填写，或在 .env 设置 DASHSCOPE_API_KEY' })
    return
  }

  const { messages, projectId, permission, effort } = req.body
  // 权限级别：read-only(只读) / full(完全访问) / none(不允许)；默认 full
  const perm = permission === 'read-only' || permission === 'none' ? permission : 'full'

  // 若关联项目，校验后端已知的项目根目录
  let projectRoot = null
  if (projectId) {
    const p = projects.get(projectId)
    if (!p) {
      res.status(400).json({ error: '未知项目 ID（可能后端未重启加载）' })
      return
    }
    projectRoot = p.path
  }

  // 思考强度（effort）映射到系统提示片段
  const effortHint =
    effort === 'low'
      ? '\n\n思考强度：低。优先给出最直接的解决方案，避免展开过多探索。'
      : effort === 'high'
        ? '\n\n思考强度：高。请充分推理，权衡多种方案并验证边界情况后再作答。'
        : ''

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  try {
    const chatModel = buildChatModel(cfg)
    if (projectRoot) {
      await runAgent(chatModel, (messages || []).map(toLangchainMessage), projectRoot, res, perm)
    } else {
      // 无项目：直接流式补全
      const msgs = [new SystemMessage(SYSTEM_PROMPT + effortHint), ...(messages || []).map(toLangchainMessage)]
      const stream = await chatModel.stream(msgs)
      for await (const chunk of stream) {
        if (typeof chunk.content === 'string' && chunk.content) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`)
        }
      }
    }
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`)
    res.end()
  }
})

function toLangchainMessage(m) {
  if (m.role === 'user') return new HumanMessage(m.content)
  if (m.role === 'assistant') return new AIMessage(m.content)
  return new HumanMessage(m.content)
}

// 模型预设（供前端下拉）
app.get('/api/models', (_req, res) => {
  res.json({
    presets: [
      { id: 'qwen-coder-plus', name: 'Qwen Coder Plus' },
      { id: 'qwen-coder-turbo', name: 'Qwen Coder Turbo' },
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-max', name: 'Qwen Max' },
    ],
    defaultModel: DEFAULT_MODEL,
  })
})

// ===== 拉取模型列表（仅预置供应商）=====
// 3 种类型（openai 兼容 / anthropic 兼容 / 原生）是通用调用范式；
// 每个预置供应商自带 list 规则（路径/鉴权/解析），并映射到上述类型之一。
const MODEL_LIST_TYPE = {
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
            : { id: m && m.id, name: (m && (m.name || m.id)) || m.id }
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
        .map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: m && m.id, name: (m && (m.name || m.id)) || m.id }))
        .filter((m) => m.id)
    },
    needKey: false,
    needBaseUrl: true,
  },
}

// 预置供应商各自的 list 规则（按 vendor key 索引）
// listPaths 按类型决定模型列表路径（openai 兼容→/models；其余类型前端已拦截，后端仅作兜底）
const PRESET_VENDOR_LIST_RULES = {
  'bailian-coding': { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
  'bailian-token': { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
  deepseek: { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
  zhipu: { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '/v1/models' } },
  tencent: { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } },
}

app.post('/api/models/fetch', async (req, res) => {
  const { vendor, baseUrl, apiKey, type: reqType } = req.body || {}
  let rule = PRESET_VENDOR_LIST_RULES[vendor]
  if (!rule) {
    // 自定义供应商：按所选调用范式处理（当前仅支持 OpenAI 兼容范式）
    if (reqType !== 'openai') {
      res.status(400).json({ error: '自定义供应商暂仅支持 OpenAI 兼容类型自动获取模型列表' })
      return
    }
    rule = { type: 'openai', listPaths: { openai: '/models', anthropic: '', native: '' } }
  }
  // 按请求类型取对应 list 路径（缺省回退到供应商默认类型）
  const effectiveType = MODEL_LIST_TYPE[reqType] ? reqType : rule.type
  if (reqType && reqType !== rule.type) {
    // 非默认类型：若该类型无对应 list 路径则直接提示（前端通常已拦截）
    const path = rule.listPaths && rule.listPaths[reqType]
    if (!path) {
      res.status(400).json({ error: '该类型暂不支持自动获取' })
      return
    }
  }
  const type = MODEL_LIST_TYPE[effectiveType]
  const key = apiKey ? String(apiKey).trim() : ''
  const url = type.buildUrl(baseUrl ? String(baseUrl).trim() : '', rule)
  if (type.needKey && !key) {
    res.status(400).json({ error: 'API Key 不能为空' })
    return
  }
  if (type.needBaseUrl && !url) {
    res.status(400).json({ error: 'Base URL 不能为空' })
    return
  }
  // anthropic 等无需请求，直接返回内置列表
  if (!url) {
    res.json({ models: type.parse({}, rule) })
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: type.headers(key),
      signal: controller.signal,
    })
    if (!r.ok) {
      res.status(r.status < 500 ? 400 : 500).json({
        error:
          r.status === 401
            ? '鉴权失败（401），请检查 API Key'
            : r.status === 403
              ? '无权限（403）'
              : `服务端返回 HTTP ${r.status}`,
      })
      return
    }
    const json = await r.json().catch(() => ({}))
    res.json({ models: type.parse(json, rule) })
  } catch (e) {
    res.status(400).json({ error: e.name === 'AbortError' ? '请求超时（5s）' : String(e.message || e) })
  } finally {
    clearTimeout(timer)
  }
})

// ===== MCP Server 测试（仅连通性探测，不注入交互）=====
app.post('/api/mcp/test', async (req, res) => {
  const { type, command, url } = req.body || {}
  if (!type) {
    res.status(400).json({ ok: false, error: '缺少 MCP 类型' })
    return
  }
  if (type === 'stdio') {
    if (!command || !command.trim()) {
      res.status(400).json({ ok: false, error: 'stdio 类型需要提供启动命令' })
      return
    }
    try {
      const ok = await new Promise((resolve) => {
        const parts = command.trim().split(/\s+/)
        const [cmd, ...args] = parts
        let settled = false
        let child
        try {
          child = spawn(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
        } catch {
          resolve(false)
          return
        }
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            try { child.kill('SIGKILL') } catch {}
            resolve(false)
          }
        }, 4000)
        child.on('error', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(false)
          }
        })
        child.on('spawn', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            try { child.kill('SIGKILL') } catch {}
            resolve(true)
          }
        })
        child.on('exit', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(false)
          }
        })
      })
      res.json({ ok, error: ok ? undefined : '命令无法启动，请检查命令与路径是否正确' })
    } catch (e) {
      res.json({ ok: false, error: String(e.message || e) })
    }
    return
  }
  if (type === 'http' || type === 'sse') {
    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ ok: false, error: 'http/sse 类型需要提供合法的 URL' })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'code-agent', version: '0.1.0' },
          },
        }),
        signal: controller.signal,
      })
      res.json({
        ok: r.status < 500,
        status: r.status,
        error: r.status < 500 ? undefined : `服务端返回 HTTP ${r.status}`,
      })
    } catch (e) {
      res.json({
        ok: false,
        error: e.name === 'AbortError' ? '连接超时（5s）' : String(e.message || e),
      })
    } finally {
      clearTimeout(timer)
    }
    return
  }
  res.status(400).json({ ok: false, error: '不支持的 MCP 类型: ' + type })
})

// ===== Skills 扫描（多候选目录合并，只读）=====
function getCandidateSkillDirs() {
  const home = os.homedir()
  const projectRoot = join(__dirname, '..')
  return [
    join(projectRoot, 'skills'),
    join(home, 'skills'),
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codebuddy', 'skills'),
  ]
}

function parseSkillFrontmatter(content) {
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { name: '', description: '' }
  const body = m[1]
  const nameMatch = body.match(/^name\s*:\s*(.+)$/m)
  let description = ''
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(/^description\s*:\s*(.*)$/)
    if (d) {
      const first = d[1].trim().replace(/^['"]|['"]$/g, '')
      if (first) {
        description = first
      } else {
        const rest = []
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\w+\s*:/.test(lines[j])) break
          rest.push(lines[j].trim())
        }
        description = rest.filter(Boolean).join(' ')
      }
      break
    }
  }
  return {
    name: nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '',
    description,
  }
}

async function scanSkills() {
  const results = []
  const seen = new Set()
  for (const dir of getCandidateSkillDirs()) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在或无权限：静默跳过
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const skillDir = path.join(dir, e.name)
      const skillFile = path.join(skillDir, 'SKILL.md')
      let content = ''
      try {
        content = await fsp.readFile(skillFile, 'utf-8')
      } catch {
        continue // 无 SKILL.md：不是技能，跳过
      }
      const id = path.basename(dir) + '/' + e.name
      if (seen.has(id)) continue
      seen.add(id)
      const fm = parseSkillFrontmatter(content)
      results.push({
        id,
        name: fm.name || e.name,
        description: fm.description || '',
        path: skillDir,
        sourceDir: dir,
      })
    }
  }
  return results
}

app.get('/api/skills', async (_req, res) => {
  try {
    const skills = await scanSkills()
    const sourceDirs = getCandidateSkillDirs().filter((d) => {
      try {
        return fs.existsSync(d) && fs.statSync(d).isDirectory()
      } catch {
        return false
      }
    })
    res.json({ skills, sourceDirs })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ===== 从其他 Agent 导入（只读扫描 + 技能软链接）=====
const home = os.homedir()
const apData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
const projectRootDir = join(__dirname, '..')

// 各 Agent 的默认配置（可被用户覆盖）。configFiles 为 MCP 配置文件候选，skillDirs 为 Skills 目录候选
const IMPORT_SOURCE_DEFAULTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    configFiles: [join(home, '.claude.json'), join(home, '.claude', 'settings.json'), join(home, '.claude', 'mcp.json')],
    skillDirs: [join(home, '.claude', 'skills')],
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    configFiles: [join(apData, 'Claude', 'claude_desktop_config.json'), join(home, '.config', 'Claude', 'claude_desktop_config.json')],
    skillDirs: [],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configFiles: [join(home, '.cursor', 'mcp.json')],
    skillDirs: [join(home, '.cursor', 'skills')],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    configFiles: [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    skillDirs: [],
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    configFiles: [join(home, '.codebuddy', 'mcp.json'), join(home, '.codebuddy', 'settings.json')],
    skillDirs: [join(home, '.codebuddy', 'skills')],
  },
  {
    id: 'roo',
    label: 'Roo Code',
    configFiles: [join(home, '.roo', 'mcp_settings.json')],
    skillDirs: [],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    configFiles: [join(home, '.config', 'opencode', 'mcp.json'), join(home, '.config', 'opencode', 'settings.json'), join(home, '.opencode', 'mcp.json'), join(home, '.opencode', 'settings.json')],
    skillDirs: [join(home, '.config', 'opencode', 'skills'), join(home, '.opencode', 'skills')],
  },
  {
    id: 'codex',
    label: 'Codex',
    configFiles: [join(home, '.codex', 'config.json'), join(home, '.codex', 'settings.json')],
    skillDirs: [join(home, '.codex', 'skills')],
  },
  {
    id: 'hermes',
    label: 'Hermes',
    configFiles: [join(home, '.hermes', 'config.json'), join(home, '.hermes', 'settings.json'), join(home, '.config', 'hermes', 'config.json'), join(home, '.config', 'hermes', 'settings.json')],
    skillDirs: [join(home, '.hermes', 'skills'), join(home, '.config', 'hermes', 'skills')],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    configFiles: [],
    skillDirs: [join(home, '.gemini', 'skills')],
  },
  {
    id: 'agents',
    label: '通用 (~/.agents/skills)',
    configFiles: [],
    skillDirs: [join(home, '.agents', 'skills')],
  },
  {
    id: 'home',
    label: '用户主目录 (~/skills)',
    configFiles: [],
    skillDirs: [join(home, 'skills')],
  },
]

// 用户覆盖的导入路径（持久化在 data/import-paths.json）
const IMPORT_PATHS_FILE = join(__dirname, 'import-paths.json')
let importPathOverrides = {}
function loadImportPathOverrides() {
  try {
    if (fs.existsSync(IMPORT_PATHS_FILE)) {
      importPathOverrides = JSON.parse(fs.readFileSync(IMPORT_PATHS_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('加载 import-paths.json 失败:', e)
  }
}
function saveImportPathOverrides() {
  fs.writeFileSync(IMPORT_PATHS_FILE, JSON.stringify(importPathOverrides, null, 2))
}
loadImportPathOverrides()

// 取得某 Agent 生效中的配置（默认 + 用户覆盖合并）
function getEffectiveSource(id) {
  const def = IMPORT_SOURCE_DEFAULTS.find((s) => s.id === id)
  if (!def) return null
  const ov = importPathOverrides[id]
  return {
    id: def.id,
    label: def.label,
    configFiles: ov && Array.isArray(ov.configFiles) && ov.configFiles.length ? ov.configFiles : def.configFiles,
    skillDirs: ov && Array.isArray(ov.skillDirs) && ov.skillDirs.length ? ov.skillDirs : def.skillDirs,
    isOverridden: !!(ov && ((Array.isArray(ov.configFiles) && ov.configFiles.length) || (Array.isArray(ov.skillDirs) && ov.skillDirs.length))),
  }
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

// 把各 Agent 的 MCP 配置归一化为统一格式
function normalizeMcpEntry(name, raw) {
  if (typeof raw === 'string') raw = { command: raw }
  if (!raw || typeof raw !== 'object') return null
  let type = String(raw.type || '').toLowerCase()
  let command = String(raw.command || '')
  const url = String(raw.url || '')
  if (!type) {
    type = url ? (/\/sse$/i.test(url) ? 'sse' : 'http') : 'stdio'
  }
  if (type === 'streamable-http') type = 'http'
  if (Array.isArray(raw.args)) {
    const args = raw.args.filter((a) => typeof a === 'string')
    if (command && args.length) command = command + ' ' + args.join(' ')
    else if (!command) command = args.join(' ')
  }
  if (type === 'stdio' && !command) return null
  if (type !== 'stdio' && !url) return null
  return {
    name,
    type,
    command: type === 'stdio' ? command : '',
    url: type === 'stdio' ? '' : url,
    enabled: raw.disabled !== true,
    env: raw.env && typeof raw.env === 'object' ? raw.env : undefined,
    headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : undefined,
  }
}

function collectMcpServersFor(ids) {
  const sources = []
  const list = ids ? IMPORT_SOURCE_DEFAULTS.filter((s) => ids.includes(s.id)) : IMPORT_SOURCE_DEFAULTS
  for (const def of list) {
    const eff = getEffectiveSource(def.id)
    const servers = []
    for (const f of eff.configFiles) {
      const cfg = readJsonIfExists(f)
      if (!cfg) continue
      // 兼容对象 { mcpServers: { name: cfg } }、数组 [{ name, ... }] 两种形态
      const rawMap = cfg.mcpServers || cfg.experimental?.mcpServers
      if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
        for (const [name, raw] of Object.entries(rawMap)) {
          const n = normalizeMcpEntry(name, raw)
          if (n) servers.push(n)
        }
      } else if (Array.isArray(rawMap)) {
        for (const item of rawMap) {
          const n = normalizeMcpEntry(item && item.name, item)
          if (n) servers.push(n)
        }
      } else if (Array.isArray(cfg)) {
        for (const item of cfg) {
          const n = normalizeMcpEntry(item && item.name, item)
          if (n) servers.push(n)
        }
      }
    }
    if (servers.length) sources.push({ id: eff.id, label: eff.label, servers })
  }
  return sources
}

async function scanImportableSkillsFor(ids) {
  const sources = []
  const list = ids ? IMPORT_SOURCE_DEFAULTS.filter((s) => ids.includes(s.id)) : IMPORT_SOURCE_DEFAULTS
  for (const def of list) {
    const eff = getEffectiveSource(def.id)
    const foundDirs = []
    for (const dir of eff.skillDirs) {
      let entries
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      foundDirs.push({ dir, entries })
    }
    const skills = []
    for (const { dir, entries } of foundDirs) {
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const skillDir = path.join(dir, e.name)
        const skillFile = path.join(skillDir, 'SKILL.md')
        let content = ''
        try {
          content = await fsp.readFile(skillFile, 'utf-8')
        } catch {
          continue
        }
        const fm = parseSkillFrontmatter(content)
        skills.push({
          name: fm.name || e.name,
          dirName: e.name,
          description: fm.description || '',
          path: skillDir,
        })
      }
    }
    if (skills.length) sources.push({ id: eff.id, label: eff.label, path: eff.skillDirs.join(', '), skills })
  }
  return sources
}

// 返回所有 Agent 的来源定义（含生效路径与是否覆盖标记），供前端编辑
function listImportSourceDefs() {
  return IMPORT_SOURCE_DEFAULTS.map((def) => {
    const eff = getEffectiveSource(def.id)
    return {
      id: eff.id,
      label: eff.label,
      configFiles: eff.configFiles,
      skillDirs: eff.skillDirs,
      isOverridden: eff.isOverridden,
    }
  })
}

app.get('/api/import/sources', async (_req, res) => {
  try {
    const [mcpSources, skillSources] = await Promise.all([
      Promise.resolve(collectMcpServersFor()),
      scanImportableSkillsFor(),
    ])
    res.json({ sources: listImportSourceDefs(), mcpSources, skillSources })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

async function copyDirRecursive(src, dest) {
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) await copyDirRecursive(s, d)
    else await fsp.copyFile(s, d)
  }
}

// 跨平台软链接：Windows 下目录用 junction（普通用户免提权），其余用符号链接
async function createLink(src, dest) {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await fsp.symlink(src, dest, type)
}

// 保存用户自定义的导入路径（持久化覆盖层）
app.put('/api/import/path', (req, res) => {
  const { agentId, configFiles, skillDirs } = req.body || {}
  const def = IMPORT_SOURCE_DEFAULTS.find((s) => s.id === agentId)
  if (!def) {
    res.status(400).json({ error: '未知的 Agent 来源: ' + agentId })
    return
  }
  const normFiles = Array.isArray(configFiles)
    ? configFiles.map((s) => String(s).trim()).filter(Boolean)
    : def.configFiles
  const normDirs = Array.isArray(skillDirs)
    ? skillDirs.map((s) => String(s).trim()).filter(Boolean)
    : def.skillDirs
  importPathOverrides[agentId] = { configFiles: normFiles, skillDirs: normDirs }
  saveImportPathOverrides()
  res.json({ ok: true, source: getEffectiveSource(agentId) })
})

// 恢复某 Agent 到默认路径
app.delete('/api/import/path', (req, res) => {
  const { agentId } = req.body || {}
  if (agentId && importPathOverrides[agentId]) {
    delete importPathOverrides[agentId]
    saveImportPathOverrides()
  }
  res.json({ ok: true, source: agentId ? getEffectiveSource(agentId) : null })
})

// 仅重新扫描单个 Agent 的 MCP 与 Skills（使用其当前生效路径）
app.post('/api/import/scan', async (req, res) => {
  const { agentId } = req.body || {}
  if (!agentId) {
    res.status(400).json({ error: 'agentId 不能为空' })
    return
  }
  try {
    const [mcpSources, skillSources] = await Promise.all([
      Promise.resolve(collectMcpServersFor([agentId])),
      scanImportableSkillsFor([agentId]),
    ])
    res.json({ mcpSources, skillSources })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 把选中的技能软链接到项目 skills/ 目录（校验源路径必须属于已声明的 Agent 目录）
app.post('/api/import/skills', async (req, res) => {
  const { items } = req.body || {}
  if (!Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'items 不能为空' })
    return
  }
  const allowedRoots = IMPORT_SOURCE_DEFAULTS.flatMap((def) => getEffectiveSource(def.id).skillDirs)
  const projectSkills = join(projectRootDir, 'skills')
  const results = []
  for (const it of items) {
    const src = it && typeof it.path === 'string' ? it.path : ''
    const dirName = (it && it.dirName || '').trim()
    if (!src || !dirName || !allowedRoots.some((root) => src === root || src.startsWith(root + path.sep))) {
      results.push({ name: dirName || '(无效)', status: 'error', error: '源路径不在已扫描的 Agent 目录内' })
      continue
    }
    const dest = path.join(projectSkills, dirName)
    if (fs.existsSync(dest)) {
      results.push({ name: dirName, status: 'exists', target: dest })
      continue
    }
    try {
      // 创建软链接（或 Windows junction），来源更新时项目内自动跟随
      await createLink(src, dest)
      results.push({ name: dirName, status: 'imported', target: dest })
    } catch (e) {
      results.push({ name: dirName, status: 'error', error: String(e.message || e) })
    }
  }
  res.json({ results })
})

app.listen(PORT, () => {
  console.log(`Code Agent 后端已启动: http://localhost:${PORT}`)
})
