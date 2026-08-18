---
name: model-fetch-list
overview: 在 ModelSettings.vue 模型区块标题旁新增「获取模型列表」按钮，用户配置 baseURL 后，使用该 baseURL 与表单 apiKey 调用后端，后端以 OpenAI 兼容 /models 接口拉取模型列表，前端清空并替换为拉取到的模型（id 作名称与 ID）。
todos:
  - id: backend-fetch-models
    content: 在 server/index.js 新增 POST /api/models/fetch 代理接口（Bearer 鉴权、5s 超时、解析 data 数组）
    status: completed
  - id: frontend-api
    content: 在 src/api/agent.js 新增 fetchModelsByBaseUrl 封装（错误兜底返回 models/error）
    status: completed
    dependencies:
      - backend-fetch-models
  - id: ui-button
    content: 在 ModelSettings.vue 标题旁加按钮，实现 fetchModels 回填 modelRows 与 loading/error 态
    status: completed
    dependencies:
      - frontend-api
---

## 用户需求

在模型设置页面「模型（名称 / ID / Max Tokens，可添加多组）」区块标题旁，新增一个按钮。当用户已在表单中填好 Base URL 与 API Key 后，点击该按钮，前端将 baseURL 与 apiKey（强制使用表单中填写的 apiKey，忽略 useGlobalKey）发送给后端，由后端携带 Bearer 鉴权请求 OpenAI 兼容的 `/models` 接口，拉取模型列表。

## 核心功能

- 模型区块标题同行右侧显示「获取模型列表」按钮，带 loading 状态与错误提示。
- 点击按钮：校验 baseURL 与 apiKey 非空；调用后端 `POST /api/models/fetch`。
- 后端拼接 `${baseUrl}/models`，带 `Authorization: Bearer ${apiKey}` 发起请求，解析返回的 `data` 数组（取每项 `id`，名称默认用 `id`），含 5s 超时与错误兜底。
- 拉取成功后，清空当前 `form.modelRows`，用拉取到的模型重新填充（id 同时作为名称与 ID，maxTokens 留空）；若结果为空则保留一个空行兜底。
- 拉取失败在按钮旁或错误区展示原因，不破坏现有模型行。

## 约束

- baseURL 取表单当前值；key 强制取表单 `apiKey`，忽略 `useGlobalKey`。
- 仅替换现有模型行，不做追加/弹窗选择。

## 技术栈

- 前端：Vue 3 `<script setup>` + Tailwind CSS（既有风格）
- 后端：Node.js + Express（ESM，原生 fetch / AbortController，既有模式）
- 通信：Vite 代理 `/api/*` → `:3001`（既有，无需改动）

## 实现方案

在既有 `ModelSettings.vue` 与 `src/api/agent.js` 中新增前端按钮与调用函数；在 `server/index.js` 新增 `POST /api/models/fetch` 接口，直接向用户提供的 baseURL 发起 OpenAI 兼容的 `/models` 请求。后端仅做透明代理与最小解析，不缓存、不落盘，避免引入新依赖。

### 关键技术决策

- **后端代理而非前端直连**：规避浏览器 CORS 限制（多数模型网关不允许跨域），且与项目既有 `/api/mcp/test`、`/api/chat` 的后端代发模式一致。
- **凭据取自表单而非默认 key**：按用户澄清，按钮点击时强制使用 `form.apiKey`，忽略 `useGlobalKey`，语义清晰。
- **替换而非追加**：按澄清，清空 `form.modelRows` 后用拉取结果重建，至少保留一行空行兜底，保证 `save()` 校验逻辑不受影响。
- **超时与兜底**：使用 `AbortController` 5s 超时（与 `/api/mcp/test` 一致）；非 200、网络异常、返回非预期结构均返回可读错误，前端展示但不覆盖现有行。

### 性能与可靠性

- 单次请求，体量小（模型列表通常 < 1MB）；5s 超时防止挂起。
- 前端按钮在请求期间禁用并展示 loading，避免重复点击；错误仅提示，不破坏已填写内容。

## 实现要点

- 后端：新增 `POST /api/models/fetch`，`app.use(express.json())` 已存在；从 `req.body` 取 `baseUrl`、`apiKey`，校验非空；`baseUrl.replace(/\/$/,'') + '/models'`；`fetch` 带 `Authorization` 头；解析 `json.data`（数组），映射为 `{id, name}`，`name` 缺失时回退为 `id`；`res.json({ models })`；catch 返回 `{ error }`。
- 前端 API：在 `src/api/agent.js` 新增 `fetchModelsByBaseUrl({ baseUrl, apiKey })`，复用既有 fetch 封装风格（try/catch + 状态码判断）。
- 前端组件：在 `ModelSettings.vue` 标题行右侧加按钮，新增 `fetchLoading`、`fetchError` ref 与 `fetchModels()` 函数；图标复用 `Plus` 或新增 `RefreshCw`（来自 `lucide-vue-next`）；结果回填 `form.modelRows`。

## 架构设计

保持现有分层：组件 → `src/api/agent.js` → 后端 `server/index.js` 路由。无新增文件、无新架构模式。

## 目录结构

```
src/
├── components/
│   └── ModelSettings.vue   # [MODIFY] 模型区块标题旁新增「获取模型列表」按钮；新增 fetchLoading/fetchError 状态与 fetchModels() 函数；调用 fetchModelsByBaseUrl 并回填 modelRows；引入 RefreshCw 图标
└── api/
    └── agent.js            # [MODIFY] 新增 fetchModelsByBaseUrl({ baseUrl, apiKey })，POST /api/models/fetch，错误兜底返回 {models:[], error}
server/
└── index.js               # [MODIFY] 新增 POST /api/models/fetch：校验 baseUrl/apiKey，拼接 /models，Bearer 鉴权 fetch，5s 超时，解析 data 数组返回 {models:[{id,name}]}，错误返回 {error}
```