---
name: chat-ui-redesign
overview: 按设计图重写聊天界面：左侧栏改为「按项目分类的历史会话列表」+ 搜索 + New Chat，底部放置「设置」入口（设置移动到下面）；移除顶部 CodeAgent 模块；后端新增 sessions 持久化（按项目归属），整体风格改为深色/精致。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 深色对话区
    - 浅色侧边栏
    - 圆角卡片
    - 分组会话列表
    - 精致输入框
    - 代码高亮
  fontSystem:
    fontFamily: system-ui
    heading:
      size: 18px
      weight: 700
    subheading:
      size: 13px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
      - "#1E293B"
    background:
      - "#0F172A"
      - "#F8FAFC"
      - "#FFFFFF"
    text:
      - "#E2E8F0"
      - "#1F2937"
      - "#64748B"
    functional:
      - "#22C55E"
      - "#DC2626"
      - "#2563EB"
todos:
  - id: backend-sessions
    content: server/index.js 新增 sessions.json 持久化与 /api/sessions 增删改查接口
    status: pending
  - id: frontend-sessions-api
    content: 新增 src/sessions.js 封装会话 API 与 reactive 状态
    status: pending
    dependencies:
      - backend-sessions
  - id: app-sidebar
    content: 重写 App.vue 侧边栏：New Chat、Search、按项目分组会话列表、底部设置入口，去除顶部 nav/CodeAgent
    status: pending
    dependencies:
      - frontend-sessions-api
  - id: chatpanel-sessions
    content: ChatPanel.vue 接入 sessions：加载/新建/切换/保存会话，去除模型栏到顶部
    status: pending
    dependencies:
      - frontend-sessions-api
  - id: dark-style
    content: 调整深色对话风格与精致输入框样式，按设计图配色
    status: pending
    dependencies:
      - chatpanel-sessions
      - app-sidebar
  - id: verify
    content: 运行 lint 与 node --check 校验前后端无错误
    status: pending
    dependencies:
      - backend-sessions
      - frontend-sessions-api
      - app-sidebar
      - chatpanel-sessions
      - dark-style
---

## 用户需求

按设计图重写聊天界面，将"设置"移动到侧边栏底部（下方），整体风格改为设计图样式。

## 产品概述

左侧栏改为「按项目分类的历史会话列表」：顶部 New Chat 按钮、搜索框、按项目分组的会话条目（项目名 → 其下历史会话）、底部为「设置」入口与用户信息（替代原"模型"footer，即"设置移动到下面"）。主区为当前会话对话，深色风格、代码高亮、底部精致输入框，无顶部 CodeAgent 模块。

## 核心功能

- 左侧栏：New Chat 新建会话、Search 搜索会话、按项目分组的会话列表（含"通用对话"无项目分组），底部「设置」入口 + 用户信息。
- 会话持久化：后端新增 sessions 存储（sessions.json），每个会话归属 projectId，含标题与消息数组；首启动自动建空文件。
- 主区：深色风格对话、markdown + 代码高亮、发送后实时流式回填；底部输入框精致化（左侧加号/附件、右侧发送）、可选 Quick 快捷操作条；顶栏去除 CodeAgent 模块。
- 保留现有能力：项目增删改查、模型/MCP/Skills 设置页、/api/chat 流式对话均不受影响。

## 技术栈

- 前端：Vue 3 `<script setup>` + Vue Router + Ant Design Vue（a-select 等已全局注册）
- 后端：Node.js + Express（原生 fs 读写 + fetch 流式）
- 存储：后端 `sessions.json` 文件持久化；前端无新增持久化
- 无新增依赖

## 实现方案

### 后端（server/index.js）

新增 sessions 持久化，复用既有 projects.json 读写模式（Map + load/save）。结构：

- `SESSIONS_FILE = join(__dirname,'sessions.json')`，`const sessions = new Map()`，`loadSessions/saveSessions` 复用 `projects` 的同步读写风格。
- REST：
- `GET /api/sessions?projectId=`：返回该项目（或通用 `__none__`）的会话数组（按 updatedAt 倒序）；无 projectId 返回全部。
- `POST /api/sessions`：`{projectId, title}` 创建，生成 `id='s_'+时间戳36+随机`，`messages:[]`，`createdAt/updatedAt=Date.now()`。
- `PUT /api/sessions/:id`：`{title?, messages?}` 局部更新并写盘（保存对话消息与标题）。
- `DELETE /api/sessions/:id`：删除并写盘。
- 与 `/api/chat` 解耦：会话内容由前端在发送/接收后调用 PUT 落盘，后端 chat 接口不动。

### 前端数据层（src/projects.js 或新增 src/sessions.js）

新增会话 API 封装：`fetchSessions(projectId?)`、`createSession(projectId)`、`updateSession(id, {title,messages})`、`deleteSession(id)`。复用现有 `projects` reactive 模式。

### 前端布局（src/App.vue）

- Sidebar 重写为：
- 顶部 `New Chat` 按钮（触发新建会话事件 / 路由 query）。
- Search 输入框（v-model 过滤会话）。
- 会话列表：遍历 `projects.list`（按项目分组），每组内渲染该项目 sessions；另设「通用对话」组（`projectId==='__none__'`）。每组标题=项目 alias。
- 底部 footer：移除"模型"块，改为「设置」router-link（/settings）+ 用户信息（当前模型名作为账号区展示即可）。
- 移除原 nav 中顶部"对话/设置"两项（或仅保留对话作为默认首页，设置移到底部）。保留 `<router-view>`。
- 顶栏去除 CodeAgent（主区组件内本无此模块，仅需确保 App 不渲染）。

### 对话组件（src/components/ChatPanel.vue）

- 状态：当前 `activeSessionId`、当前会话 `messages`、加载态。
- `onMounted`：拉取 sessions（默认选中第一个或新建）；若无会话则空态引导 New Chat。
- `send()`：调 `streamChat`（现有逻辑保留），流式回填 assistant 消息；完成后 `updateSession` 落盘（含标题=首条 user 内容截断）。
- New Chat：调 `createSession(activeProjectId||'__none__')`，清空并切换。
- 切换会话：从后端/内存取 messages。
- 搜索：过滤会话标题/首消息。
- 样式：沿用现有 marked + highlight.js，调整 `.msg--ai/.msg--user` 与代码块配色为深色（深底浅字、代码块 github-dark 已引入）；输入框精致化（左侧加号按钮 + textarea + 右侧发送 button 同现有栅格，微调圆角/间距）。

### 路由（router/index.js）

不变（`/`、`/settings` 子路由）。设置入口由 sidebar 底部按钮触发。

## 实现要点

- 向后兼容：无 sessions.json 时后端自动建 `[]`；前端首启动空列表显示引导。
- 旧 `conversations` 内存结构替换为 sessions 后端数据源，避免重复存储。
- 性能：会话列表仅在项目切换/新建/发送后刷新；消息流式不触发整列表重算（用 `computed` 过滤搜索，列表数据量小）。
- 安全：会话接口沿用本地文件读写，无越权风险；不暴露项目外路径。
- 风格一致：深色配色集中在 ChatPanel `<style>`，不改动 settings 各页样式。

## 目录结构

```
src/
├── App.vue                 # [MODIFY] Sidebar 重写：New Chat+Search+按项目分组会话列表+底部设置；去顶部 nav/CodeAgent
├── components/
│   └── ChatPanel.vue       # [MODIFY] 接入 sessions：加载/新建/切换/保存会话；深色风格；输入框精致化
├── sessions.js             # [NEW] 会话 API 封装（fetchSessions/createSession/updateSession/deleteSession）+ reactive 状态
└── style.css               # [MODIFY] 侧栏/会话列表/深色消息样式（如需全局类）
server/
└── index.js                # [MODIFY] 新增 sessions.json 持久化与 /api/sessions REST
```

## 设计风格

整体采用设计图的深色调对话区 + 浅色侧边栏布局。侧边栏为浅灰/白底、圆角卡片分组；主区为深色对话背景，消息气泡分明，代码块使用 github-dark 高亮。输入框精致：左侧圆形加号、右侧主色发送按钮，底部可选 Quick 操作条。强调"设置移动到下面"——侧栏底部固定设置入口与用户信息。

## 关键区块

### 左侧栏

- 顶部：New Chat 按钮（主色描边/填充，圆角）。
- 搜索：Search 输入框（浅灰底、圆角、占位"Search"）。
- 会话分组：按项目名分组标题（小号大写灰字），其下会话条目（标题+时间，hover 高亮，当前选中左侧主色条）。含「通用对话」分组。
- 底部 footer：分隔线上方「设置」入口（齿轮图标+文字，router-link /settings），下方用户信息（头像/当前模型名）。

### 主区

- 顶栏：仅会话标题或当前模型（朴素，无 CodeAgent 模块）。
- 对话区：深色底；用户气泡主色右对齐，AI 气泡浅卡左对齐；代码块深色高亮。
- 输入区：底部固定，左侧加号按钮 + textarea + 右侧发送按钮；下方 Quick 快捷 chips（如"解释代码""生成单测"）。

## Agent Extensions

### Skill

- **vue-best-practices**
- Purpose: 指导 Vue 3 `<script setup>` Composition API 重写 App.vue 与 ChatPanel.vue，确保组件结构合理、响应式正确。
- Expected outcome: 会话列表与对话组件采用标准 Composition API，状态管理清晰，无常见反模式。
- **ant-design-vue**
- Purpose: 为侧栏 New Chat 按钮、Search 输入框、设置入口等提供 Ant Design Vue 组件用法指导，保持与现有 a-select 一致。
- Expected outcome: 侧栏控件使用正确的 antd 组件与样式，风格统一。
- **frontend-design**
- Purpose: 按设计图落地深色对话区 + 浅色侧栏的高质感视觉，包括圆角、间距、代码块配色与微交互。
- Expected outcome: 界面达到设计图水准，视觉精致、层次分明。