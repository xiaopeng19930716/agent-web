import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { tool } from '@langchain/core/tools'

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

export function tree(root, dir, depth, out) {
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

export function grep(root, pattern, dir, results, depth) {
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
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
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

export function buildTools(root, permission = 'full', toolKeys) {
  // permission: 'full' 可写；'read-only' / 'none' 禁止写入文件
  // toolKeys：可选，允许启用的工具 key（listFiles/readFile/writeFile/editFile/searchInProject）。
  // 未传或非数组 -> 返回全部；空数组 -> 返回 []；否则按 key 过滤。
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
  ]
  if (!Array.isArray(toolKeys)) return all
  return all.filter((t) => toolKeys.includes(t.name))
}
