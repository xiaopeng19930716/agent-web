import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import os from 'node:os'
import { dirname, join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import net from 'node:net'
import { spawn } from 'node:child_process'

const isDev = !app.isPackaged
const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:5173'

// 应用根目录：开发模式为项目根，打包后为 resources/app.asar
const appRoot = app.getAppPath()

// 找一个空闲端口，避免与已运行的 3001 冲突
function findFreePort(preferred = 3001) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(preferred + 1))
    srv.once('listening', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.listen(preferred, '127.0.0.1')
  })
}

let backendPort = null
let backendChild = null
let mainWindow = null
let backendExited = false

// 等待后端端口可被连接，超时 15 秒；成功后才知道后端真正 ready
function waitForBackend(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tryConnect = () => {
      if (backendExited) {
        reject(new Error('后端进程已退出'))
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`后端在 ${timeoutMs}ms 内未启动，端口 ${port} 无法连接`))
        return
      }
      const sock = net.createConnection({ port, host: '127.0.0.1' }, () => {
        sock.end()
        resolve()
      })
      sock.setTimeout(300)
      sock.on('error', () => {
        sock.destroy()
        setTimeout(tryConnect, 300)
      })
      sock.on('timeout', () => {
        sock.destroy()
        setTimeout(tryConnect, 300)
      })
    }
    tryConnect()
  })
}

async function startBackend() {
  // 数据目录：统一存放到用户目录 ~/.code-agent，与网页版（models/mcp/settings）共享同一目录，
  // 避免开发/打包/网页三端数据割裂；该目录可写，不受 asar 只读限制。
  const dataDir = join(os.homedir(), '.code-agent')
  process.env.CODE_AGENT_DATA_DIR = dataDir

  // 开发/打包都用 findFreePort 先抢占一个确定空闲的端口，再强制传给后端（process.env.PORT）。
  // 这样后端从空闲端口首次 listen 即成功、不会顺延，主进程探测的端口 == 后端实际端口，避免脱节。
  // 开发模式额外把端口写入 .api-port，供 Vite 代理动态读取。
  backendPort = await findFreePort(37821)
  process.env.PORT = String(backendPort)
  if (isDev) {
    writeFileSync(join(appRoot, '.api-port'), String(backendPort), 'utf-8')
  }

  const modulePath = isDev
    ? join(appRoot, 'server', 'index.js')
    : join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.js')

  // 打包模式下若 dist 在 app.asar 里，设置 SERVE_DIST 让 Express 托管静态产物
  if (!isDev) {
    const distInAsar = join(process.resourcesPath, 'app.asar', 'dist')
    const distLocal = join(appRoot, 'dist')
    process.env.SERVE_DIST = existsSync(distInAsar) ? distInAsar : distLocal
  }

  backendChild = spawn(process.execPath, [modulePath], {
    // 关键：打包后 process.execPath 是 Code Agent.exe（Electron 二进制），
    // 必须设置 ELECTRON_RUN_AS_NODE=1 才会以纯 Node 模式执行 server/index.js，
    // 否则会当作 Electron 应用启动（打开新窗口），后端永远起不来。
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })

  backendChild.on('error', (e) => {
    console.error('[main] 后端子进程启动失败:', e.message)
  })

  backendChild.on('exit', (code, signal) => {
    backendExited = true
    console.error(`[main] 后端子进程退出 code=${code} signal=${signal}`)
    // 后端异常退出时：若窗口还没创建，直接退出应用；若已创建，提示用户
    if (mainWindow) {
      dialog.showErrorBox('后端服务异常退出', `Code Agent 后端已停止（code=${code}），应用即将关闭。`)
      app.quit()
    } else {
      app.quit()
    }
  })

  // 等待后端真正可连接，避免窗口加载不存在的端口导致白屏/卡死
  await waitForBackend(backendPort)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(appRoot, 'out', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
  })

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadURL(`http://localhost:${backendPort}`)
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 页面加载失败时提示而不是卡死
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] 窗口加载失败:', errorCode, errorDescription)
    if (!isDev) {
      dialog.showErrorBox('页面加载失败', `${errorDescription}\n请检查后端服务是否正常运行。`)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (backendChild && !backendChild.killed) backendChild.kill()
  })
}

app.whenReady().then(async () => {
  // 自定义标题栏的窗口控制
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  try {
    await startBackend()
    createWindow()
  } catch (e) {
    console.error('[main] 启动失败:', e)
    dialog.showErrorBox('启动失败', String(e.message || e))
    app.quit()
  }

  app.on('activate', () => {
    // 后端异常退出后禁止再开新窗口
    if (backendExited) return
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (backendChild && !backendChild.killed) backendChild.kill()
  if (process.platform !== 'darwin') app.quit()
})
