import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const variablesPath = fileURLToPath(new URL('./src/assets/variables.less', import.meta.url))

// 开发模式下 Electron 主进程可能把后端换到非 3001 端口，并把实际端口写入 .api-port。
// 这里按请求动态解析端口（http-proxy 原生 router），避免竞态。
function resolveApiPort() {
  try {
    const p = readFileSync(new URL('./.api-port', import.meta.url), 'utf-8').trim()
    if (p && /^\d+$/.test(p)) return p
  } catch {}
  return '37821'
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
        // 初始 target 占位；下方 configure 会改成动态 getter，按请求实时读取 .api-port
        target: 'http://localhost:37821',
        changeOrigin: true,
        // Electron dev 模式下后端端口可能动态变化（主进程 findFreePort 写入 .api-port）。
        // 注意：Vite 8 内置的 http-proxy-3 不读 options.router，
        // 必须用 getter 动态改写 opts.target，http-proxy 每次请求展开 { ...options } 时才会取最新值。
        configure: (_proxy, opts) => {
          Object.defineProperty(opts, 'target', {
            configurable: true,
            enumerable: true,
            get: () => `http://localhost:${resolveApiPort()}`,
          })
        },
      },
    },
  },
})
