import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const variablesPath = fileURLToPath(new URL('./src/assets/variables.less', import.meta.url))

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
      },
    },
  },
})
