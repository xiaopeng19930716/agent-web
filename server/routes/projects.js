import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  projects,
  saveProjects,
  deleteSessionsByProject,
} from '../lib/store.js'
import { safeResolve, listDirectory, searchFiles } from '../lib/fileTools.js'

const router = Router()

// 取项目且校验存在（未知返回 null，由调用方决定 400）
function getProjectOrNull(id, res) {
  const p = projects.get(id)
  if (!p) {
    res.status(400).json({ error: '未知项目 ID' })
    return null
  }
  return p
}

router.get('/projects', (_req, res) => {
  res.json([...projects.values()])
})

router.post('/projects', (req, res) => {
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

router.delete('/projects/:id', (req, res) => {
  const id = req.params.id
  const ok = projects.delete(id)
  if (ok) {
    saveProjects()
    // 级联删除该项目下的所有会话
    deleteSessionsByProject(id)
  }
  res.json({ ok })
})

// 定位目录真实绝对路径（浏览器选择文件夹拿不到绝对路径的场景）
// 优先：前端通过 FileSystemDirectoryHandle.getParent() 上溯得到的相对路径（path 参数），
//   后端对每个根做 path.join + statSync 校验，仅 O(根数) 次 stat，毫秒级返回。
// 兜底：按目录名（name 参数）在常见根目录下搜索，异步遍历 + 系统目录剪枝。
router.get('/locate-dir', async (req, res) => {
  const name = (req.query.name || '').toString().trim()
  const relRaw = (req.query.path || '').toString().trim()
  if (!name && !relRaw) {
    res.status(400).json({ error: '缺少 name 或 path 参数' })
    return
  }
  const roots = [
    path.join(os.homedir()),
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

  // 1) 相对路径精确校验：过滤盘符、空段与 .. 越界，只做 stat 判断
  if (relRaw) {
    const segs = relRaw
      .split(/[\\/]+/)
      .filter((s) => s && s !== '.' && s !== '..' && !s.includes(':') && !/^[a-zA-Z]$/.test(s))
    for (const root of roots) {
      const full = path.join(root, ...segs)
      try {
        if (fs.statSync(full).isDirectory()) {
          res.json({ path: full, results: [] })
          return
        }
      } catch {
        // 该根下不存在，尝试下一个根
      }
    }
  }

  // 2) 名称搜索兜底（getParent 不可用 / 精确路径未命中时）
  const results = []
  const MAX_DEPTH = 3
  const MAX_RESULTS = 10
  // 大概率无用且遍历耗时巨大的目录，直接剪枝
  const SKIP_DIRS = new Set([
    'node_modules',
    'vendor',
    '.git',
    '.svn',
    '.hg',
    '.idea',
    '.vscode',
    'Windows',
    'Program Files',
    'Program Files (x86)',
    'ProgramData',
    'AppData',
    'System32',
    'SysWOW64',
    'Microsoft',
    'MSBuild',
    'nodejs',
    'site-packages',
    '.cache',
    '.npm',
    '.m2',
    '.gradle',
    '.nuget',
  ])
  const walk = async (dir, depth) => {
    if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.name === name) {
        results.push(full)
        if (results.length >= MAX_RESULTS) return
        continue
      }
      await walk(full, depth + 1)
    }
  }
  if (name) {
    for (const r of roots) {
      if (results.length >= MAX_RESULTS) break
      await walk(r, 1)
    }
  }
  res.json({ results })
})

// 按项目列出某相对目录下的文件树（供 @ 文件面板浏览）
// root 来自后端 projects Map（安全根目录），dir 为相对路径，经 safeResolve 越界校验
router.get('/projects/:id/files', (req, res) => {
  const p = getProjectOrNull(req.params.id, res)
  if (!p) return
  const dir = (req.query.dir || '').toString().trim()
  try {
    const data = listDirectory(p.path, dir)
    res.json(data)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// 全项目递归搜索文件名（@关键字 场景），返回含完整相对路径的结果以区分同名文件
router.get('/projects/:id/search', (req, res) => {
  const p = getProjectOrNull(req.params.id, res)
  if (!p) return
  const q = (req.query.q || '').toString().trim()
  if (!q) {
    res.status(400).json({ error: '缺少搜索关键字 q' })
    return
  }
  try {
    const results = searchFiles(p.path, q)
    res.json({ results })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

export default router
