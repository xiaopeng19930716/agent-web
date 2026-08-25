import { Router } from 'express'
import { randomUUID } from 'crypto'
import { extname, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'

const router = Router()
const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = join(__dirname, '..', '.uploads')

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

export default router
