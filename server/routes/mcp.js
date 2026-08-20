import { Router } from 'express'
import { spawn } from 'child_process'

const router = Router()

// MCP Server 测试（仅连通性探测，不注入交互）
router.post('/mcp/test', async (req, res) => {
  const { type, command, url } = req.body || {}
  if (!type) {
    res.status(400).json({ ok: false, error: '缺少 MCP 类型' })
    return
  }
  if (type === 'stdio') {
    if (!command || !command.trim()) {
      res.status(400).json({ ok: false, error: 'stdio 类型需要提供启动命令' })
      return
    }
    try {
      const ok = await new Promise((resolve) => {
        const parts = command.trim().split(/\s+/)
        const [cmd, ...args] = parts
        let settled = false
        let child
        try {
          child = spawn(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
        } catch {
          resolve(false)
          return
        }
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            try { child.kill('SIGKILL') } catch {}
            resolve(false)
          }
        }, 4000)
        child.on('error', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(false)
          }
        })
        child.on('spawn', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            try { child.kill('SIGKILL') } catch {}
            resolve(true)
          }
        })
        child.on('exit', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(false)
          }
        })
      })
      res.json({ ok, error: ok ? undefined : '命令无法启动，请检查命令与路径是否正确' })
    } catch (e) {
      res.json({ ok: false, error: String(e.message || e) })
    }
    return
  }
  if (type === 'http' || type === 'sse') {
    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ ok: false, error: 'http/sse 类型需要提供合法的 URL' })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'code-agent', version: '0.1.0' },
          },
        }),
        signal: controller.signal,
      })
      res.json({
        ok: r.status < 500,
        status: r.status,
        error: r.status < 500 ? undefined : `服务端返回 HTTP ${r.status}`,
      })
    } catch (e) {
      res.json({
        ok: false,
        error: e.name === 'AbortError' ? '连接超时（5s）' : String(e.message || e),
      })
    } finally {
      clearTimeout(timer)
    }
    return
  }
  res.status(400).json({ ok: false, error: '不支持的 MCP 类型: ' + type })
})

export default router
