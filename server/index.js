import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { initStores } from './lib/store.js'
import { PORT } from './lib/config.js'
import projectsRouter from './routes/projects.js'
import sessionsRouter from './routes/sessions.js'
import settingsRouter from './routes/settings.js'
import chatRouter from './routes/chat.js'
import modelsRouter from './routes/models.js'
import mcpRouter from './routes/mcp.js'
import skillsRouter from './routes/skills.js'
import importRouter from './routes/import.js'
import toolsRouter from './routes/tools.js'
import uploadRouter from './routes/upload.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 加载持久化存储（projects / sessions）
initStores()

// 各 API 路由模块（保持 /api/* 路径与响应格式完全兼容）
app.use('/api', projectsRouter)
app.use('/api', sessionsRouter)
app.use('/api', settingsRouter)
app.use('/api', chatRouter)
app.use('/api', modelsRouter)
app.use('/api', mcpRouter)
app.use('/api', skillsRouter)
app.use('/api', importRouter)
app.use('/api', toolsRouter)
app.use('/api', uploadRouter)

// 生产/打包环境：托管前端构建产物（dist）并 fallback 到 index.html（SPA）
// 由主进程通过设置 SERVE_DIST 指向打包后的前端目录来启用，网页版开发时不设置。
if (process.env.SERVE_DIST && existsSync(process.env.SERVE_DIST)) {
  const distDir = process.env.SERVE_DIST
  app.use(express.static(distDir))
  app.get('*', (_req, res) => {
    res.sendFile(join(distDir, 'index.html'))
  })
}

// 监听并处理端口占用：失败后自动 +1 重试，最多尝试 10 个端口
function listenWithFallback(port, tries = 0) {
  if (tries >= 10) {
    console.error('Code Agent 后端启动失败：端口均被占用')
    process.exit(1)
    return
  }
  const server = app.listen(port, () => {
    console.log(`Code Agent 后端已启动: http://localhost:${port}`)
  })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`端口 ${port} 被占用，尝试 ${port + 1}`)
      listenWithFallback(port + 1, tries + 1)
    } else {
      console.error('后端启动错误:', err)
      process.exit(1)
    }
  })
}

listenWithFallback(Number(PORT))
