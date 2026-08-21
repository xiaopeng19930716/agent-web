import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
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

app.listen(PORT, () => {
  console.log(`Code Agent 后端已启动: http://localhost:${PORT}`)
})
