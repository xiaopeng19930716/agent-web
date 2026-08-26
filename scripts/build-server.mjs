import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  // 输出 ESM：import.meta.url 在 ESM 中天然有效（server 源码用它算路径、wasm 用它定位），
  // 同时注入 createRequire 解决 express 等 CJS 依赖内部的动态 require。
  format: 'esm',
  outfile: 'out/server.mjs',
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  // 把 wasm 等资源作为文件复制到 out/assets/，并保持可解析的 URL
  loader: { '.wasm': 'copy' },
  assetNames: 'assets/[name]-[hash]',
  // 不打包 Node 内置模块
  packages: 'bundle',
  logLevel: 'info',
})

console.log('[build-server] server bundle -> out/server.mjs')
