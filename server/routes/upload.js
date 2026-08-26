import { Router } from 'express'
import { randomUUID } from 'crypto'
import { extname, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, existsSync, readFileSync, renameSync, copyFileSync, statSync } from 'fs'
import { DATA_DIR } from '../lib/store.js'
import { projects } from '../lib/store.js'
import { safeResolve } from '../lib/fileTools.js'

const router = Router()
const __dirname = dirname(fileURLToPath(import.meta.url))
// 用户上传图片统一存放到 ~/.code-agent/data/upload
const UPLOAD_DIR = join(DATA_DIR, 'upload')

// 确保临时上传目录存在
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
}

// 接收前端传来的 dataURL，落盘后返回可访问的短 URL（供 /api/chat 多模态引用）
router.post('/upload', (req, res) => {
  try {
    const { dataUrl, name = '', type } = req.body || {}
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ error: '缺少 dataUrl' })
    }
    const mime = (dataUrl.match(/^data:([^;]+);base64,/) || [])[1] || type || 'image/png'
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    let buf
    try {
      buf = Buffer.from(base64, 'base64')
    } catch {
      return res.status(400).json({ error: 'dataUrl 解码失败' })
    }
    if (!buf.length) return res.status(400).json({ error: '空文件' })

    const ext = EXT_BY_TYPE[mime] || extname(name) || '.png'
    const id = randomUUID()
    const fileName = `${id}${ext}`
    writeFileSync(join(UPLOAD_DIR, fileName), buf)
    res.json({ url: `/api/upload/${fileName}` })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// 静态暴露已上传的文件
router.get('/upload/:file', (req, res) => {
  try {
    const filePath = join(UPLOAD_DIR, req.params.file)
    // 防目录穿越
    if (!filePath.startsWith(UPLOAD_DIR)) return res.status(400).end()
    if (!existsSync(filePath)) return res.status(404).end()
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(readFileSync(filePath))
  } catch {
    res.status(500).end()
  }
})

// #4 代码块「应用到文件」：前端把代码直接写回项目文件
// 复用与文件工具一致的权限/越界校验（safeResolve + permission==='full'）
router.post('/file/write', (req, res) => {
  try {
    const { projectId, relPath, content, permission } = req.body || {}
    if (!relPath) return res.status(400).json({ error: '缺少 relPath' })
    if (typeof content !== 'string') return res.status(400).json({ error: '缺少 content' })
    if (permission !== 'full') {
      return res.status(403).json({ error: '当前权限为只读，无法写入文件。请将对话框权限切换为「完全访问」。' })
    }
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const full = safeResolve(root, relPath)
    // 轻量备份：仅覆盖已存在文件时，存到 项目根/.agent-backup/...
    let backupId = ''
    if (existsSync(full)) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const safeRel = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '')
        const backupRel = join('.agent-backup', `${safeRel}.${ts}`)
        const backupFull = safeResolve(root, backupRel)
        mkdirSync(dirname(backupFull), { recursive: true })
        copyFileSync(full, backupFull)
        backupId = backupRel
      } catch { /* 备份失败不阻断写入 */ }
    }
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
    res.json({ ok: true, path: relPath, backupId })
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

export default router
