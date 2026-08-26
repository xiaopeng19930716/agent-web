import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const variablesPath = fileURLToPath(new URL('./src/assets/variables.less', import.meta.url))

// electron-vite 配置：主进程 / 预加载 / 渲染进程 三个构建管线
export default defineConfig({
  // 主进程（Node 环境，纯 JS，无 Vue）
  // server 由其子进程（fork）从 unpacked 目录加载，不打包进主进程
  main: {
    root: '.',
    build: {
      outDir: 'out',
      emptyOutDir: false,
      lib: {
        entry: 'electron/main.js',
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        external: ['electron', 'node:net', 'node:fs', 'node:path', 'node:url', 'node:child_process'],
      },
    },
  },
  // 预加载脚本
  preload: {
    root: '.',
    build: {
      outDir: 'out',
      emptyOutDir: false,
      lib: {
        entry: 'electron/preload.js',
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  // 渲染进程（即现有前端，复用 Vite + Vue + less 配置）
  renderer: {
    root: '.',
    plugins: [vue()],
    css: {
      preprocessorOptions: {
        less: {
          additionalData: `@import "${variablesPath}";`,
        },
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: 'index.html',
      },
    },
  },
})
