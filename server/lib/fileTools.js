import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { exec, spawn } from 'child_process'
import { tool } from '@langchain/core/tools'
import { scanSkills } from './skills.js'
import { MCP_FILE, readConfigFile } from './config.js'

// 从服务端 MCP 配置文件中读取已启用的 MCP 服务器列表。
// 这样 listMcp 反映的是磁盘真实状态，而不是前端这次会话是否传过来。
// 同时兼容旧数组格式 [{ name, type, command, url, enabled }] 与新对象格式 { [name]: { type, command, url } }。
function readEnabledMcpServers() {
  const raw = readConfigFile(MCP_FILE)
  if (!raw || typeof raw !== 'object') return {}
  const disabled = Array.isArray(raw.disabledMcpServers) ? raw.disabledMcpServers : []
  const out = {}
  if (raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)) {
    // 新格式：对象
    for (const [name, cfg] of Object.entries(raw.mcpServers)) {
      if (!cfg || typeof cfg !== 'object') continue
      if (disabled.includes(name)) continue
      out[name] = cfg
    }
  } else if (Array.isArray(raw.mcpServers)) {
    // 旧格式：数组
    for (const it of raw.mcpServers) {
      if (!it || !it.name) continue
      if (it.enabled === false || disabled.includes(it.name)) continue
      out[it.name] = it
    }
  }
  return out
}

// 命令输出截断上限，避免超大输出（如 build 日志）撑爆模型上下文
export const MAX_CMD_OUTPUT = 8000

// 破坏性命令识别：手动终端与 Agent 共用同一安全边界
// 也供 chat.js / tools.js 复用，避免逻辑分叉
export function isDangerousCommand(command) {
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

// 跨平台杀掉进程树（含子进程）：Windows 用 taskkill 杀整棵子树，POSIX 用进程组 SIGTERM
function killProcessTree(child) {
  if (!child || !child.pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch { /* 进程可能已退出，忽略 */ }
}

// 文件工具（严格限制在项目根目录内）
export function safeResolve(root, rel) {
  const target = path.resolve(root, rel || '')
  const rel2 = path.relative(root, target)
  if (rel2.startsWith('..') || path.isAbsolute(rel2)) {
    throw new Error('路径越界，超出项目目录: ' + rel)
  }
  return target
}

// 文件回退：写/编辑前先备份原文件到 项目根/.agent-backup/<相对路径>.<时间戳>
// backupPath（相对项目根，含 .agent-backup 前缀）作为还原凭证回传前端。
// 仅当原文件已存在时才备份（新建文件无需备份）；备份目录同样受 safeResolve 约束。
const BACKUP_DIR = '.agent-backup'
export function backupBeforeWrite(root, filePath) {
  const full = safeResolve(root, filePath)
  if (!fs.existsSync(full)) return null // 新文件，无原内容可备份
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const safeRel = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')
  const backupRel = `${BACKUP_DIR}/${safeRel}.${ts}`
  const backupFull = safeResolve(root, backupRel)
  try {
    fs.mkdirSync(path.dirname(backupFull), { recursive: true })
    fs.copyFileSync(full, backupFull)
    return backupRel
  } catch {
    return null
  }
}

// 还原备份：backupPath 必须是 .agent-backup/<...> 格式（防止越界/任意路径读取）
export function restoreBackup(root, backupPath) {
  if (!backupPath || typeof backupPath !== 'string') throw new Error('缺少 backupPath')
  const normalized = backupPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized.startsWith(BACKUP_DIR + '/')) {
    throw new Error('非法备份路径: ' + backupPath)
  }
  const backupFull = safeResolve(root, normalized)
  if (!fs.existsSync(backupFull)) throw new Error('备份不存在或已清理: ' + backupPath)
  // 还原目标 = 去掉 .agent-backup/ 前缀和时间戳后缀
  const rest = normalized.slice(BACKUP_DIR.length + 1) // <safeRel>.<ts>
  const dot = rest.lastIndexOf('.')
  if (dot <= 0) throw new Error('备份文件名格式异常: ' + backupPath)
  const originalRel = rest.slice(0, dot)
  const originalFull = safeResolve(root, originalRel)
  fs.mkdirSync(path.dirname(originalFull), { recursive: true })
  fs.copyFileSync(backupFull, originalFull)
  return originalRel
}

// 删除文件（回退"新建文件"操作使用）：受 safeResolve 边界约束，仅删项目内文件
export function deleteFileSafe(root, filePath) {
  const full = safeResolve(root, filePath)
  if (!fs.existsSync(full)) return filePath // 已不存在，视为成功
  fs.rmSync(full, { force: true })
  return filePath
}

export function tree(root, dir, depth, out) {
  if (depth > 4) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === BACKUP_DIR || e.name.startsWith('.')) continue
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

export function grep(root, pattern, dir, results, depth) {
  if (depth > 8 || results.length > 200) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const re = new RegExp(pattern, 'i')
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === BACKUP_DIR || e.name.startsWith('.')) continue
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

// 列出某个相对目录下的直接子项（结构化，供 @ 文件面板浏览）
// rel 为相对项目根目录的目录；跳过 node_modules/.git/隐藏文件（与 tree 规则一致）
export function listDirectory(root, rel = '') {
  const dir = safeResolve(root, rel || '')
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('目录不存在或不是文件夹: ' + rel)
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const items = []
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === BACKUP_DIR || e.name.startsWith('.')) continue
    const relPath = rel ? path.join(rel, e.name).replace(/\\/g, '/') : e.name
    items.push({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: relPath, // 相对项目根的路径，前端用它拼接 @路径
    })
  }
  // 目录在前、文件在后，各自按名称排序
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { path: rel ? rel.replace(/\\/g, '/') : '', items }
}

// 全项目递归搜索文件名（模糊匹配），返回含完整相对路径的结果
// 用于 @关键字 搜索：同名文件可通过 path 区分所在目录。限制结果数量与深度，性能可控。
export function searchFiles(root, keyword, maxResults = 50) {
  const kw = String(keyword || '').trim().toLowerCase()
  const out = []
  if (!kw) return out
  const MAX_DEPTH = 10
  const walk = (dir, rel, depth) => {
    if (out.length >= maxResults || depth > MAX_DEPTH) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name.startsWith('.')) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), relPath, depth + 1)
      } else if (e.name.toLowerCase().includes(kw)) {
        out.push({ name: e.name, type: 'file', path: relPath })
        if (out.length >= maxResults) return
      }
    }
  }
  walk(root, '', 0)
  return out
}

export function buildTools(root, permission = 'full', toolKeys, mcpServers = {}, abortSignal = null, commandTimeout = 300) {
  // permission: 'full' 可写；'read-only' / 'none' 禁止写入文件
  // toolKeys：可选，允许启用的工具 key（listFiles/readFile/writeFile/editFile/searchInProject/listMcp/listSkills）。
  // 未传或非数组 -> 返回全部；空数组 -> 返回 []；否则按 key 过滤。
  // mcpServers：当前会话已配置的 MCP 服务器映射，供 listMcp 工具使用（无需项目根）。
  const canWrite = permission === 'full'
  const writeGuard = async (fn) => {
    if (!canWrite) return '当前权限为只读，无法写入或编辑文件。如需修改文件，请在对话框中将权限级别切换为「完全访问」。'
    return fn()
  }
  const all = [
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
          const existed = fs.existsSync(full)
          const backupId = backupBeforeWrite(root, filePath)
          await fsp.writeFile(full, content, 'utf-8')
          // 回退联动：新建文件(原不存在)标记 created=1，回退时用于删除而非还原
          const tag = backupId
            ? ` | backupId=${backupId}`
            : ` | backupId= | created=1`
          return '已写入: ' + filePath + tag
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
          const backupId = backupBeforeWrite(root, filePath)
          await fsp.writeFile(full, updated, 'utf-8')
          return '已修改: ' + filePath + (backupId ? ` | backupId=${backupId}` : '')
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
    tool(
      async ({ command, cwd = '.', timeout = 60000 }) => {
        return writeGuard(async () => {
          let workDir
          try {
            workDir = safeResolve(root, cwd || '.')
          } catch (e) {
            return '路径越界，无法在目录外执行命令: ' + String(e.message || e)
          }
          // 命令超时上限来自高级设置（commandTimeout 秒），默认 300；防止卡死
          const maxMs = (Number(commandTimeout) > 0 ? Number(commandTimeout) : 300) * 1000
          let ms = Number(timeout)
          if (!Number.isFinite(ms) || ms <= 0) ms = Math.min(60000, maxMs)
          ms = Math.min(ms, maxMs)
          const truncate = (s) =>
            s.length > MAX_CMD_OUTPUT ? s.slice(0, MAX_CMD_OUTPUT) + `\n… (输出已截断，原始共 ${s.length} 字符)` : s
          // 用回调式 exec 以便支持「停止」中断：abort 时杀掉整个进程树，避免命令在后台继续跑
          return new Promise((resolve) => {
            const child = exec(
              command,
              { cwd: workDir, timeout: ms, maxBuffer: 8 * 1024 * 1024, windowsHide: true, detached: process.platform !== 'win32' },
              (err, stdout, stderr) => {
                if (err) {
                  if (abortSignal && abortSignal.aborted) return resolve('[已中断] 命令已被用户中止')
                  const out = [stdout, stderr].filter(Boolean).join('\n')
                  let msg = `命令执行失败（退出码 ${err.code}）`
                  if (out) msg += '\n' + out
                  if (!out) msg += '\n' + (err.message || String(err))
                  return resolve(truncate(msg))
                }
                let out = ''
                if (stdout) out += stdout
                if (stderr) out += (out ? '\n[stderr]\n' : '') + stderr
                if (!out.trim()) out = '(命令已执行，无输出)'
                resolve(truncate(out))
              }
            )
            if (abortSignal) {
              const onAbort = () => {
                killProcessTree(child)
                resolve('[已中断] 命令已被用户中止')
              }
              if (abortSignal.aborted) onAbort()
              else abortSignal.addEventListener('abort', onAbort, { once: true })
            }
          })
        })
      },
      {
        name: 'executeCommand',
        description:
          '在项目目录下执行 shell 命令，例如安装依赖(npm install)、运行测试(npm test)、构建(npm run build)、git 操作等。command 为完整命令；cwd 为相对项目根目录的工作目录，默认 "."；timeout 为超时毫秒数（默认 60000，上限见高级设置「命令超时上限」）。需要「完全访问」权限。注意：会真正执行命令，请谨慎使用。',
        schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的完整 shell 命令' },
            cwd: { type: 'string', description: '相对项目根目录的工作目录，默认 "."' },
            timeout: { type: 'number', description: '超时毫秒数，默认 60000，上限以高级设置为准' },
          },
          required: ['command'],
        },
      }
    ),
    // 以下两个工具不依赖项目根，可在无项目时直接使用
    tool(
      async () => {
        // 直接从服务端 MCP 配置文件读取已启用的服务器，
        // 不依赖本次会话前端是否传了 mcpServers（用户没通过 / 选择时也不会漏报）。
        const servers = readEnabledMcpServers()
        const entries = Object.entries(servers)
        if (entries.length === 0) return '(未配置任何 MCP 服务器)'
        return entries
          .map(([name, cfg]) => {
            const type = cfg && cfg.type ? cfg.type : 'unknown'
            const kind = cfg && cfg.command ? 'local' : cfg && cfg.url ? cfg.type || 'http' : 'unknown'
            const transport =
              kind === 'local' || kind === 'stdio'
                ? 'local'
                : kind === 'sse'
                ? 'sse'
                : 'http'
            return `- ${name} [${transport}] 已启用`
          })
          .join('\n')
      },
      {
        name: 'listMcp',
        description: '列出当前会话已配置并可用的 MCP 服务器（名称/类型/启用状态），无需项目根。',
        schema: { type: 'object', properties: {}, required: [] },
      }
    ),
    tool(
      async () => {
        try {
          const skills = await scanSkills()
          if (!skills || skills.length === 0) return '(未发现有可用的 Skills)'
          return skills
            .map((s) => `- ${s.id}： ${s.name}（${s.description || '无描述'}）`)
            .join('\n')
        } catch (e) {
          return '读取 Skills 失败：' + (e.message || String(e))
        }
      },
      {
        name: 'listSkills',
        description: '列出当前系统中可加载的 Skills 清单（id/名称/描述），无需项目根。',
        schema: { type: 'object', properties: {}, required: [] },
      }
    ),
    // 任务清单工具：模型用它维护可见的待办列表（不落盘，状态由 chat.js 写入会话并推给前端）
    tool(
      async () => {
        // 实际状态更新在 chat.js 的 executeToolCall 中拦截处理，这里只返回占位成功
        return 'ok'
      },
      {
        name: 'todoWrite',
        description:
          '维护当前任务的待办清单（让用户在界面上实时看到进度）。' +
          'action="write" 时整体替换清单（items 为完整列表）；action="replace" 时按 content 合并更新已有项；action="clear" 时清空。' +
          '每项 status: pending(待办) | in_progress(进行中) | completed(已完成) | cancelled(已取消)。模型应在开始多步任务前 write 一份计划，每完成一步就 update 对应项。',
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['write', 'replace', 'clear'], description: 'write=整体替换；replace=按内容合并；clear=清空' },
            items: {
              type: 'array',
              description: '任务项列表（action=clear 时可省略）',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: '任务描述' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
                  activeForm: { type: 'string', description: '进行中时展示的动名词，如"正在重构登录模块"' },
                },
                required: ['content', 'status'],
              },
            },
          },
          required: ['action'],
        },
      }
    ),
  ]
  // 风险分级：供「需确认(ask)」权限在工具真正执行前发起用户确认
  // read=只读(免确认) / write=写文件(需确认) / danger=执行命令(需确认,且危险命令强制拒绝)
  const RISK = {
    listFiles: 'read',
    readFile: 'read',
    writeFile: 'write',
    editFile: 'write',
    searchInProject: 'read',
    executeCommand: 'danger',
    listMcp: 'read',
    listSkills: 'read',
    todoWrite: 'read',
  }
  for (const t of all) t.risk = RISK[t.name] || 'read'

  if (!Array.isArray(toolKeys)) return all
  // 信息查询类工具（listSkills / listMcp）无副作用、不写文件，始终对模型可见，
  // 即使用户没有通过「/选择工具」显式启用。这样询问"我有哪些 skills/mcp"
  // 时模型会自动调用对应工具，而不是凭印象编造。
  const ALWAYS_ON = new Set(['listSkills', 'listMcp'])
  return all.filter((t) => ALWAYS_ON.has(t.name) || toolKeys.includes(t.name))
}

// 返回所有文件工具的元信息（名称 + 描述），供前端自动构建基础工具清单。
// 直接复用 buildTools 的产出（仅读取 name/description，不实际执行函数），
// 因此在 buildTools 中新增 / 删除工具时，此处会自动同步，前端无需手动维护。
export function getToolCatalog() {
  try {
    const tools = buildTools(process.cwd(), 'full', undefined, {})
    return tools.map((t) => ({
      key: t.name,
      name: t.name,
      description: t.description || '',
    }))
  } catch (e) {
    console.error('[tools] getToolCatalog 失败，降级返回兜底清单:', e)
    // 兜底：至少保证 listSkills / listMcp 可见，满足"模型自动列出 skills"诉求
    return [
      { key: 'listSkills', name: 'listSkills', description: '列出当前系统中可加载的 Skills 清单' },
      { key: 'listMcp', name: 'listMcp', description: '列出当前会话已配置的 MCP 服务器' },
    ]
  }
}

// 预览「需确认(ask)」模式下高风险文件工具的最终改动（不落盘）。
// 在 confirmGate.ask() 前调用，把 before/after 随 tool_confirm 事件推给前端渲染 diff。
// 返回：
//   { before, after }                             写/编辑类工具，可预览
//   { previewError: '匹配失败，无法预览' }        editFile 的 oldStr 未命中
//   null                                          非文件写工具（executeCommand 等走纯文本确认）
// 任何读取/解析异常都吞掉并返回 null，避免阻塞确认流程（前端降级为纯参数文本）。
export function previewFileChange(root, name, args) {
  try {
    if (name === 'writeFile') {
      const full = safeResolve(root, args && args.filePath)
      let before = ''
      if (fs.existsSync(full)) {
        try {
          before = fs.readFileSync(full, 'utf-8')
        } catch (e) {
          before = ''
        }
      }
      return { before, after: args && typeof args.content === 'string' ? args.content : '' }
    }
    if (name === 'editFile') {
      const full = safeResolve(root, args && args.filePath)
      const oldStr = args && args.oldStr
      const newStr = args && args.newStr
      if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
        return { previewError: '参数缺失，无法预览' }
      }
      let text = ''
      try {
        text = fs.readFileSync(full, 'utf-8')
      } catch (e) {
        return { previewError: '文件读取失败，无法预览' }
      }
      if (!text.includes(oldStr)) {
        return { previewError: '匹配失败，无法预览' }
      }
      return { before: text, after: text.replace(oldStr, newStr) }
    }
    return null
  } catch (e) {
    console.error('[tools] previewFileChange 异常，降级为无预览:', e)
    return null
  }
}
