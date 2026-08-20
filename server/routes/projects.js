import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  projects,
  saveProjects,
  deleteSessionsByProject,
} from '../lib/store.js'

const router = Router()

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

// 按目录名在常见根目录下查找真实绝对路径（浏览器选择文件夹拿不到绝对路径的场景）
router.get('/locate-dir', (req, res) => {
  const name = (req.query.name || '').toString().trim()
  if (!name) {
    res.status(400).json({ error: '缺少 name 参数' })
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
      const full = path.join(dir, e.name)
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

export default router
