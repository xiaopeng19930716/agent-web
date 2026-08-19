---
name: settings-file-storage
overview: 将模型/供应商/MCP/Skills 等用户配置从浏览器 localStorage 改为持久化到用户主目录的 ~/.code-agent/settings.json，通过新增的 GET/PUT /api/settings 接口读写，前端启动时拉取、保存时回写。明文存储，不涉及加密。
todos:
  - id: backend-settings-api
    content: 在 server/index.js 新增 GET/PUT /api/settings 读写 ~/.code-agent/settings.json
    status: completed
  - id: frontend-settings-store
    content: 改造 src/settings.js：移除 localStorage，改为 initSettings/saveSettings/resetSettings 异步接口
    status: completed
  - id: app-init-bootstrap
    content: 在 src/main.js 调用 initSettings() 启动拉取配置
    status: completed
    dependencies:
      - frontend-settings-store
  - id: verify-components
    content: 核对 ModelSettings/McpSettings/SkillsSettings 调用点无需改动并 lint 通过
    status: completed
    dependencies:
      - frontend-settings-store
---

## 用户需求

将应用的所有模型配置信息（API Key、供应商、模型列表、自定义供应商、禁用供应商、MCP 服务、启用的技能等）从浏览器 localStorage（明文、易被同机其他网页或浏览器数据导出获取）改为持久化到后端 JSON 文件，提升安全性。

## 产品概述

配置数据不再存储于前端浏览器，而是统一保存到用户主目录下的 `~/.code-agent/settings.json`。应用启动时从后端拉取配置，保存时写回后端文件。明文存储，不做加密，但不会被前端脚本或局域网其他网页读取。

## 核心特性

- 后端新增 `GET /api/settings`：读取并返回配置（文件不存在时返回默认空对象，由前端合并默认值）
- 后端新增 `PUT /api/settings`：接收完整配置对象，自动创建 `~/.code-agent` 目录并写入 `settings.json`（2 空格缩进）
- 前端 `settings.js` 移除 localStorage 依赖，改为通过接口异步读写
- 启动时（应用入口）调用 `initSettings()` 拉取并填充响应式配置对象
- `saveSettings()` / `resetSettings()` 改为异步调用接口落盘，调用方无需感知（fire-and-forget 内部捕获异常）
- 各设置组件（ModelSettings / McpSettings / SkillsSettings）保存逻辑无缝切换，ChatPanel 仅读不变

## 技术栈

- 前端：Vue 3 + `<script setup>` + Composition API（reactive）
- 后端：Node.js + Express（已有 `server/index.js`，复用 fs/fsp/path/os）
- 通信：fetch（`GET/PUT /api/settings`）
- 存储：用户主目录 `~/.code-agent/settings.json`（明文）

## 实现方案

### 策略

将配置存储职责从「前端 localStorage」下沉到「后端 JSON 文件」。前端 `settings.js` 保留响应式 `settings` 对象、默认值 `defaults` 与校验函数（`normalizeModels`/`asArray`/`toPositiveNumber`），但 `load`/`saveSettings`/`resetSettings` 改为基于 fetch。后端新增两个 REST 接口，沿用 `projects.json`/`sessions.json` 的「内存 Map + 同步写文件」轻量范式（此处配置为单例对象，无需 Map，直接读写文件）。

### 关键技术决策

- **存储路径**：`join(os.homedir(), '.code-agent', 'settings.json')`，与项目目录解耦，满足「不随项目移动、更隔离」。
- **默认值归属**：`defaults` 仍定义在前端 `settings.js`，后端 `GET` 在文件缺失时返回 `{}`，由前端 `initSettings` 做 `{...defaults, ...merged}` 合并。避免前后端重复维护默认值、保证单点真相。
- **明文存储**：按用户确认不做加密，仅比 localStorage 安全（杜绝前端脚本/XSS/浏览器数据导出泄露）。
- **异步保存无感化**：`saveSettings()` 返回 Promise 但内部 `try/catch` 吞掉错误（仅 `console.error`），所有调用点（`@change="saveSettings"` 等）无需改造为 await，保持现有同步写法不报错。
- **启动拉取时机**：在 `src/main.js`（或 `App.vue` 的 `onMounted`）调用一次 `initSettings()`，确保 `settings` 在组件渲染前填充；拉取失败时回退本地 `defaults`，保证离线可用。

### 性能与可靠性

- 配置对象体量小（KB 级），`GET/PUT` 同步读写 `fs.writeFileSync` 足够，无性能瓶颈。
- `PUT` 前 `fs.mkdirSync(dir, { recursive: true })` 确保目录存在；写文件用 `JSON.stringify(obj, null, 2)` 便于人工查看/编辑。
- 后端 `GET` 读取失败（损坏 JSON）时返回 `{}` 而非 500，前端回退默认值，避免白屏。
- 前端 `initSettings` 仅需启动一次，组件内 `saveSettings` 为增量写全量对象，无重复请求。

## 实现要点（防回归）

- 复用现有 `normalizeModels`/`asArray`/`toPositiveNumber`，在 `initSettings` 落库前做字段规整，保持与旧 `load()` 完全一致的兼容性（旧版 `model` 字段兼容、数组字段兜底）。
- 保留 `resetSettings()` 语义：覆盖为 `defaults` 并 `PUT` 写回（旧逻辑是 Object.assign + 保存；改为先 assign 再异步 PUT）。
- 后端接口放在 `app.listen` 之前，与 `projects`/`sessions` 路由风格一致；复用已 import 的 `fs/fsp/path/os`，不新增依赖。
- 不改动 `ChatPanel.vue` 的读取逻辑（仍 `import { settings }`），仅数据源从 localStorage 变为接口填充的同一响应式对象。
- 保持 lint 0 错误（与历史改动一致）。

## 架构设计

前端组件 → `settings.js`（响应式 store）→ `fetch GET/PUT /api/settings` → 后端 Express → `~/.code-agent/settings.json`。

```mermaid
flowchart LR
  A[App/main.js] -->|initSettings()| B[settings.js]
  B -->|GET /api/settings| C[Express]
  C -->|read| D[(~/.code-agent/settings.json)]
  E[ModelSettings/Mcp/Skills] -->|saveSettings()| B
  B -->|PUT /api/settings| C
  C -->|write| D
```

## 目录结构

```
server/index.js          # [MODIFY] 新增 SETTINGS_FILE 常量与 GET/PUT /api/settings 路由，复用 fs/fsp/os/path
src/settings.js          # [MODIFY] 移除 localStorage；load() 改为 initSettings() 异步拉取；saveSettings/resetSettings 改为 fetch PUT；保留 defaults 与校验函数
src/main.js              # [MODIFY] 在应用挂载前调用 initSettings()（若文件不存在则创建）
src/components/ModelSettings.vue  # [MODIFY] 无需改调用写法（saveSettings/resetSettings 内部已异步），仅确认无同步依赖
src/components/McpSettings.vue    # [MODIFY] 同上，saveSettings 调用点保持原样
src/components/SkillsSettings.vue # [MODIFY] 同上，saveSettings 调用点保持原样
src/components/ChatPanel.vue      # [不变] 仅读取 settings，无需修改
```

## 关键代码结构

```js
// server/index.js 新增
const SETTINGS_DIR = join(os.homedir(), '.code-agent')
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

app.get('/api/settings', (_req, res) => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      res.json(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

app.put('/api/settings', (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: '无效的配置数据' })
    return
  }
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(body, null, 2))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})
```

```js
// src/settings.js 改造要点
export const settings = reactive({ ...defaults })

export async function initSettings() {
  try {
    const res = await fetch('/api/settings')
    const data = await res.json()
    const merged = { ...defaults, ...data }
    // 复用 normalizeModels / asArray / toPositiveNumber 规整字段
    Object.assign(settings, normalize(merged))
  } catch {
    // 拉取失败维持本地 defaults
  }
}

export async function saveSettings() {
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
  } catch (e) {
    console.error('保存配置失败:', e)
  }
}

export async function resetSettings() {
  Object.assign(settings, defaults, { /* 数组字段重置 */ })
  await saveSettings()
}
```