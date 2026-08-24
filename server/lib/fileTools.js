import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
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

const execAsync = promisify(exec)
// 命令输出截断上限，避免超大输出（如 build 日志）撑爆模型上下文
const MAX_CMD_OUTPUT = 8000

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

export function buildTools(root, permission = 'full', toolKeys, mcpServers = {}) {
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
          let ms = Number(timeout)
          if (!Number.isFinite(ms) || ms <= 0) ms = 60000
          ms = Math.min(ms, 5 * 60 * 1000) // 上限 5 分钟，防止卡死
          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd: workDir,
              timeout: ms,
              maxBuffer: 8 * 1024 * 1024,
              windowsHide: true,
            })
            let out = ''
            if (stdout) out += stdout
            if (stderr) out += (out ? '\n[stderr]\n' : '') + stderr
            if (!out.trim()) out = '(命令已执行，无输出)'
            if (out.length > MAX_CMD_OUTPUT) {
              out = out.slice(0, MAX_CMD_OUTPUT) + `\n… (输出已截断，原始共 ${out.length} 字符)`
            }
            return out
          } catch (e) {
            const code = e.code
            const errOut = e.stdout || ''
            const errErr = e.stderr || ''
            let msg = `命令执行失败（退出码 ${code}）`
            if (errOut) msg += '\n[stdout]\n' + errOut
            if (errErr) msg += '\n[stderr]\n' + errErr
            if (!errOut && !errErr) msg += '\n' + (e.message || String(e))
            // 失败输出同样截断，避免异常日志撑爆上下文
            if (msg.length > MAX_CMD_OUTPUT) {
              msg = msg.slice(0, MAX_CMD_OUTPUT) + `\n… (输出已截断，原始共 ${msg.length} 字符)`
            }
            return msg
          }
        })
      },
      {
        name: 'executeCommand',
        description:
          '在项目目录下执行 shell 命令，例如安装依赖(npm install)、运行测试(npm test)、构建(npm run build)、git 操作等。command 为完整命令；cwd 为相对项目根目录的工作目录，默认 "."；timeout 为超时毫秒（上限 5 分钟）。需要「完全访问」权限。注意：会真正执行命令，请谨慎使用。',
        schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的完整 shell 命令' },
            cwd: { type: 'string', description: '相对项目根目录的工作目录，默认 "."' },
            timeout: { type: 'number', description: '超时毫秒数，默认 60000，上限 300000' },
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
