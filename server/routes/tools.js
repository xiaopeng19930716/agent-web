import { Router } from 'express'
import { getToolCatalog } from '../lib/fileTools.js'

const router = Router()

// 返回后端 fileTools.js 中声明的全部文件工具元信息（名称 / 描述）。
// 前端据此自动构建基础工具清单，新增工具无需改动前端。
router.get('/tools', (req, res) => {
  try {
    const tools = getToolCatalog()
    res.json({ tools })
  } catch (e) {
    res.status(500).json({ error: '读取工具清单失败: ' + (e.message || String(e)) })
  }
})

export default router
