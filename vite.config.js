import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const variablesPath = fileURLToPath(new URL('./src/assets/variables.less', import.meta.url))

// 开发模式下 Electron 主进程可能把后端换到非 3001 端口，并把实际端口写入 .api-port。
// 这里按请求动态解析端口，避免 Vite 启动时端口文件尚未生成的竞态。
function resolveApiPort() {
  try {
    const p = readFileSync(new URL('./.api-port', import.meta.url), 'utf-8').trim()
    if (p && /^\d+$/.test(p)) return p
  } catch {}
  return '3001'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  css: {
    preprocessorOptions: {
      less: {
        additionalData: `@import "${variablesPath}";`,
      },
    },
  },
  server: {
    proxy: {
      // 前端 /api 请求转发到本地后端代理（持有百炼 Key）
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // 每次请求时再决定目标端口，Electron dev 端口动态可变
        router: () => `http://localhost:${resolveApiPort()}`,
      },
    },
  },
})
