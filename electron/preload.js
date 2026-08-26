import { contextBridge, ipcRenderer } from 'electron'

// 最小桥接：向渲染进程暴露运行环境信息与安全窗口控制 API
contextBridge.exposeInMainWorld('codeAgent', {
  isElectron: true,
  // 打包环境下后端实际监听端口（开发模式下前端走 Vite 代理，无需此值）
  backendPort: process.env.PORT || '3001',
  // 窗口控制（自定义标题栏用，替代原生标题栏按钮）
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
})
