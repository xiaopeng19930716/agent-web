import { app, BrowserWindow, dialog, ipcMain } from 'electron'
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

async function startBackend() {
  // 数据目录：打包后写到 userData（可写），解耦 asar 只读限制（方案 X）
  const dataDir = join(app.getPath('userData'), 'code-agent-data')
  process.env.CODE_AGENT_DATA_DIR = dataDir

  // 开发模式：自动避开被占用的 3001，切到下一个空闲端口；
  // 并把实际端口写入 .api-port，供 Vite 代理动态读取（按请求解析，避免竞态）。
  // 打包模式：后端由 Express 托管 dist，端口固定 3001 即可。
  backendPort = isDev ? await findFreePort(3001) : 3001
  process.env.PORT = String(backendPort)
  if (isDev) {
    writeFileSync(join(appRoot, '.api-port'), String(backendPort), 'utf-8')
  }

  if (isDev) {
    // 开发模式：优先复用用户已启动的 server（npm run dev:all）。
    // 若用户没起，则本进程 spawn 子进程拉起 server（Electron 二进制以 ESM 方式加载 server）。
    // 注意：必须用 spawn(process.execPath) 而非 fork —— fork 不支持 ESM 入口（Electron 内置 Node 20）。
    const modulePath = join(appRoot, 'server', 'index.js')
    backendChild = spawn(process.execPath, [modulePath], {
      env: { ...process.env },
      stdio: 'inherit',
    })
    backendChild.on('error', (e) =>
      console.error('[dev] 后端子进程启动失败（若已手动启动 server 可忽略）:', e.message)
    )
  } else {
    // 打包模式：server 与 node_modules 经 asarUnpack 解包到 app.asar.unpacked，
    // 让 Express 同时托管 dist 静态产物（SPA fallback）。
    const unpackedRoot = join(process.resourcesPath, 'app.asar.unpacked')
    const distInAsar = join(process.resourcesPath, 'app.asar', 'dist')
    const distLocal = join(appRoot, 'dist')
    process.env.SERVE_DIST = existsSync(distInAsar) ? distInAsar : distLocal
    const modulePath = join(unpackedRoot, 'server', 'index.js')
    backendChild = spawn(process.execPath, [modulePath], {
      env: { ...process.env },
      stdio: 'inherit',
    })
    backendChild.on('error', (e) =>
      console.error('[prod] 后端子进程启动失败:', e.message)
    )
  }
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

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    if (backendChild) backendChild.kill()
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
  } catch (e) {
    dialog.showErrorBox('后端启动失败', String(e.message || e))
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (backendChild) backendChild.kill()
  if (process.platform !== 'darwin') app.quit()
})
