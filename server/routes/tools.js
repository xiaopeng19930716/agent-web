import os from 'os'
import fs from 'fs'
import path from 'path'
import { Router } from 'express'
import { spawn } from 'child_process'
import { projects } from '../lib/store.js'
import { getToolCatalog, restoreBackup, deleteFileSafe, safeResolve, listDirectory, isDangerousCommand, MAX_CMD_OUTPUT } from '../lib/fileTools.js'

const router = Router()

// 返回后端 fileTools.js 中声明的全部文件工具元信息（名称 / 描述）。
// 前端据此自动构建基础工具清单，新增工具无需改动前端。
router.get('/tools', (req, res) => {
  try {
    const tools = getToolCatalog()
    res.json({ tools })
  } catch (e) {
    console.error('[tools] /api/tools 失败:', e) // 打印堆栈到后端控制台，便于诊断
    res.status(500).json({ error: '读取工具清单失败: ' + (e && e.message ? e.message : String(e)) })
  }
})

// 文件回退：把一次写/编辑操作前的自动备份还原回原文件。
// body: { projectId, backupPath }；backupPath 形如 .agent-backup/<相对路径>.<时间戳>
router.post('/restore', (req, res) => {
  try {
    const { projectId, backupPath } = req.body || {}
    // 有项目用项目根；无项目用用户主目录（与聊天时文件工具边界一致）
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const originalRel = restoreBackup(root, backupPath)
    res.json({ ok: true, restored: originalRel })
  } catch (e) {
    res.status(400).json({ error: '还原失败: ' + (e.message || String(e)) })
  }
})

// 批量文件回退：对话回退时，把被截断消息里的所有写/编辑操作一并回退。
// body: { projectId, ops: [{ filePath, backupId }] }（ops 按时间正序传入）
// 关键：同一文件在区间内可能出现多次（新建后又被覆盖）。回退到该点之前，
// 文件的最终状态只由「区间内第一条操作它的 op」决定：
//   - 第一条 op 是新建(backupId 为空) -> 该文件在回退点尚不存在，应删除
//   - 第一条 op 是覆盖(有 backupId)   -> 还原到那次覆盖之前
// 因此按 filePath 去重，只保留首次出现的 op，避免「先删后还原」把文件复活。
router.post('/restore-batch', (req, res) => {
  try {
    const { projectId, ops } = req.body || {}
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const seen = new Map()
    for (const op of Array.isArray(ops) ? ops : []) {
      if (!op || !op.filePath) continue
      if (seen.has(op.filePath)) continue // 同文件只取第一条 op
      seen.set(op.filePath, op)
    }
    const results = []
    for (const op of seen.values()) {
      const { filePath, backupId } = op
      if (backupId) {
        const restored = restoreBackup(root, backupId)
        results.push({ filePath, action: 'restored', restored })
      } else {
        deleteFileSafe(root, filePath)
        results.push({ filePath, action: 'deleted' })
      }
    }
    res.json({ ok: true, results })
  } catch (e) {
    res.status(400).json({ error: '批量还原失败: ' + (e.message || String(e)) })
  }
})

// 读取「当前」文件内容（只读，不还原），供 diff 预览对比改动后状态。
// query: { projectId, rel }；rel 为相对项目根路径。
router.get('/file-content', (req, res) => {
  try {
    const { projectId, rel } = req.query
    if (!rel || typeof rel !== 'string') return res.status(400).json({ error: '缺少 rel' })
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const full = safeResolve(root, rel)
    if (!fs.existsSync(full)) return res.status(404).json({ error: '文件不存在: ' + rel })
    const content = fs.readFileSync(full, 'utf-8')
    res.json({ ok: true, content })
  } catch (e) {
    res.status(400).json({ error: '读取文件失败: ' + (e.message || String(e)) })
  }
})

// 读取「改动前」的备份文件内容（只读，不还原），供 diff 预览对比改动前状态。
// query: { projectId, backupPath }；backupPath 形如 .agent-backup/<相对路径>.<时间戳>
router.get('/backup-content', (req, res) => {
  try {
    const { projectId, backupPath } = req.query
    if (!backupPath || typeof backupPath !== 'string') return res.status(400).json({ error: '缺少 backupPath' })
    const normalized = backupPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized.startsWith('.agent-backup/')) {
      return res.status(400).json({ error: '非法备份路径: ' + backupPath })
    }
    const root = projectId && projects.get(projectId) ? projects.get(projectId).path : os.homedir()
    const full = safeResolve(root, normalized)
    if (!fs.existsSync(full)) return res.status(404).json({ error: '备份不存在或已清理: ' + backupPath })
    const content = fs.readFileSync(full, 'utf-8')
    res.json({ ok: true, content })
  } catch (e) {
    res.status(400).json({ error: '读取备份失败: ' + (e.message || String(e)) })
  }
})

// 解析 projectId -> 本机项目根目录；无项目则回退到用户主目录（与文件工具边界一致）
function resolveProjectRoot(projectId) {
  if (projectId && projects.get(projectId)) return projects.get(projectId).path
  return os.homedir()
}

// 手动终端：执行一次性命令
// body: { command, cwd?, projectId?, permission, timeout?, shell? }
// shell: 'powershell'(默认,Win) | 'cmd'(Win) | 'sh'(mac/linux)
router.post('/run-command', (req, res) => {
  try {
    const { command, cwd, projectId, permission, timeout, shell: shellName } = req.body || {}
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: '缺少 command' })
    }
    if (permission === 'read-only' || permission === 'none') {
      return res.status(403).json({ error: '当前权限为只读/无，无法执行命令' })
    }
    if (isDangerousCommand(command)) {
      return res.status(403).json({ error: '该命令被安全策略禁止执行' })
    }
    const root = resolveProjectRoot(projectId)
    const workdir = cwd ? safeResolve(root, cwd) : root
    const timeoutMs = Math.min(Number(timeout) > 0 ? Number(timeout) : 300, 3600) * 1000

    const isWin = process.platform === 'win32'
    let shell, shellArgs
    if (shellName === 'cmd' && isWin) {
      shell = 'cmd.exe'
      shellArgs = ['/c', command]
    } else if (shellName === 'sh' && !isWin) {
      shell = 'sh'
      shellArgs = ['-c', command]
    } else {
      // 默认：Windows 走 PowerShell，其它走 sh
      shell = isWin ? 'powershell.exe' : 'sh'
      shellArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command]
    }

    const proc = spawn(shell, shellArgs, { cwd: workdir, windowsHide: true })
    let stdout = '', stderr = ''
    let responded = false

    const timer = setTimeout(() => {
      if (responded) return
      responded = true
      try { proc.kill('SIGTERM') } catch {}
      res.json({ stdout: stdout.slice(-MAX_CMD_OUTPUT), stderr: (stderr + '\n[命令执行超时，已被终止]').slice(-MAX_CMD_OUTPUT), code: -1, timedOut: true })
    }, timeoutMs)

    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('close', (code) => {
      if (responded) return
      responded = true
      clearTimeout(timer)
      res.json({ stdout: stdout.slice(-MAX_CMD_OUTPUT), stderr: stderr.slice(-MAX_CMD_OUTPUT), code: code ?? -1 })
    })
    proc.on('error', (e) => {
      if (responded) return
      responded = true
      clearTimeout(timer)
      res.status(500).json({ error: '启动命令失败: ' + String(e) })
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 用本机编辑器打开文件（唤起 GUI，不阻塞）
// body: { filePath, editor?, projectId?, permission }
// editor: 'code'(VS Code) | 'notepad' | 'explorer' | 其它可执行文件 | 缺省=系统默认关联程序
router.post('/open-in-editor', (req, res) => {
  try {
    const { filePath, editor, projectId, permission } = req.body || {}
    // filePath 为空字符串表示打开项目根目录
    if (typeof filePath !== 'string') {
      return res.status(400).json({ error: '缺少 filePath' })
    }
    if (permission === 'read-only' || permission === 'none') {
      return res.status(403).json({ error: '当前权限为只读/无，无法打开编辑器写入' })
    }
    const root = resolveProjectRoot(projectId)
    const full = safeResolve(root, filePath)
    if (!fs.existsSync(full)) {
      return res.status(404).json({ error: '路径不存在: ' + filePath })
    }

    const isWin = process.platform === 'win32'
    // Windows 下 .cmd/.bat 不能直接 spawn，统一用 cmd /c 包装，避免 spawn EINVAL。
    // 命令参数用数组传递，Node 会自动处理含空格路径。
    let bin, args
    if (!isWin) {
      // macOS/Linux：用 open / xdg-open 走默认关联；自定义命令直接 spawn
      if (!editor || editor === 'default' || editor === 'code') {
        bin = process.platform === 'darwin' ? 'open' : 'xdg-open'; args = [full]
      } else {
        bin = editor; args = [full]
      }
    } else {
      bin = 'cmd'
      if (editor === 'notepad') {
        args = ['/c', 'notepad', full]
      } else if (editor === 'explorer') {
        args = ['/c', 'explorer', full]
      } else if (editor && editor !== 'default' && editor !== 'code') {
        args = ['/c', editor, full]
      } else if (editor === 'code') {
        args = ['/c', 'code', full]
      } else {
        // 系统默认关联程序；第一个 '' 是 start 的窗口标题占位
        args = ['/c', 'start', '', full]
      }
    }

    const proc = spawn(bin, args, { windowsHide: false, detached: true, stdio: 'ignore' })
    proc.unref()
    proc.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('open-in-editor spawn error:', err)
    })
    res.json({ opened: true, editor: editor || 'default', path: filePath })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 扫描本机常见编辑器，返回实际可用的列表（前端据此动态渲染下拉，而非写死）
// 用 which/where 探测命令是否在 PATH 中；Windows 上还额外检查内置 notepad/explorer
router.get('/editors', (req, res) => {
  try {
    const isWin = process.platform === 'win32'
    const finder = isWin ? 'where' : 'which'
    // 候选：命令名 -> 展示名（按常见度排序，前端展示用）
    const candidates = [
      ['code', 'VS Code'],
      ['code-insiders', 'VS Code Insiders'],
      ['cursor', 'Cursor'],
      ['subl', 'Sublime Text'],
      ['webstorm', 'WebStorm'],
      ['idea', 'IntelliJ IDEA'],
      ['atom', 'Atom'],
      ['notepad++', 'Notepad++'],
      ['gedit', 'Gedit'],
      ['vim', 'Vim'],
      ['nvim', 'Neovim'],
    ]
    if (isWin) {
      candidates.push(['notepad', '记事本'], ['explorer', '资源管理器'])
    }
    const probe = (name) =>
      new Promise((resolve) => {
        const p = spawn(finder, [name], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        let out = ''
        if (p.stdout) p.stdout.on('data', (d) => (out += d.toString()))
        p.on('error', () => resolve(null))
        p.on('close', (code) => {
          const ok = code === 0 && out.trim().length > 0
          resolve(ok ? { value: name, label: candidates.find((c) => c[0] === name)[1], path: out.trim().split(/\r?\n/)[0] } : null)
        })
      })
    Promise.all(candidates.map(([name]) => probe(name))).then((results) => {
      const editors = results.filter(Boolean)
      res.json({ editors, defaultLabel: '系统默认程序' })
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 列目录给本机编辑器文件树使用（结构化，目录在前）
// body: { rel?, projectId? }
router.post('/list-dir', (req, res) => {
  try {
    const { rel, projectId } = req.body || {}
    const root = resolveProjectRoot(projectId)
    res.json(listDirectory(root, rel || ''))
  } catch (e) {
    res.status(400).json({ error: '列目录失败: ' + (e.message || String(e)) })
  }
})

export default router
