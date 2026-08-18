---
name: chat-ui-redesign-v2
overview: 按设计图重写聊天界面：侧栏 New Chat+Search+按项目分组会话列表+底部设置；会话后端持久化；主区左上项目下拉(含添加项目入口)、对话框内模型切换+思考强度(low/medium/high)档位+权限级别(只读/完全访问/不允许)；深色风格。
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
    content: server/index.js 新增 sessions.json 持久化与 /api/sessions 增删改查接口，并按权限裁剪 Agent 写文件工具
    status: completed
  - id: frontend-sessions-api
    content: 新增 src/sessions.js 封装会话 API 与 reactive 状态
    status: completed
    dependencies:
      - backend-sessions
  - id: app-sidebar
    content: 重写 App.vue 侧边栏：New Chat、Search、按项目分组会话列表、底部设置入口，去除顶部 nav/CodeAgent
    status: completed
    dependencies:
      - frontend-sessions-api
  - id: chatpanel-sessions
    content: ChatPanel.vue 接入 sessions：加载/新建/切换/保存会话，主区项目下拉+对话框内模型/思考/权限控件
    status: completed
    dependencies:
      - frontend-sessions-api
  - id: dark-style
    content: 调整深色对话风格与精致输入框样式，按设计图配色
    status: completed
    dependencies:
      - chatpanel-sessions
      - app-sidebar
  - id: verify
    content: 运行 lint 与 node --check 校验前后端无错误
    status: completed
    dependencies:
      - backend-sessions
      - frontend-sessions-api
      - app-sidebar
      - chatpanel-sessions
      - dark-style
---

## 用户需求

按设计图重写聊天界面，整体风格改为「深色调对话区 + 浅色侧边栏」。将「设置」移动到侧边栏底部。

## 产品概述

左侧栏重构为：顶部 New Chat 按钮、Search 搜索框、按项目分组的会话列表（项目名 → 其下历史会话，含「通用对话」无项目分组）、底部「设置」入口与用户信息。「设置移动到下面」即替代原侧栏底部"模型"块。

主对话区左上显示当前项目（可切换、可添加项目，添加入口放在项目下拉内或下拉旁，弹出现有添加项目弹窗）。对话框内部集成三个控件：切换模型（按供应商分组的 a-select）、思考强度档位（low/medium/high，映射不同 system prompt/参数）、权限级别（只读 / 完全访问 / 不允许，决定后端 Agent 工具是否可写入文件）。整体深色精致风格，代码块使用 github-dark 高亮，无顶部 CodeAgent 模块。

## 核心功能

- 左侧栏：New Chat 新建会话、Search 过滤会话、按项目分组的会话列表、底部设置入口 + 用户信息。
- 会话持久化：后端新增 sessions.json 存储，每个会话归属 projectId，含标题与消息数组。
- 主区左上：项目下拉（切换当前项目 + 「＋ 添加项目」入口弹窗）。
- 对话框内控件：模型切换（供应商分组）、思考强度（low/medium/high 档位）、权限级别（只读/完全访问/不允许）。
- 主区：深色对话、markdown + 代码高亮、流式回填、精致输入框、Quick 快捷操作条。
- 后端权限控制：根据权限级别决定 Agent 写文件工具（writeFile/editFile）是否可用。

## 技术栈

- 前端：Vue 3 `<script setup>` + Vue Router + Ant Design Vue（a-select / a-select-opt-group 已全局注册）
- 后端：Node.js + Express（原生 fs 同步读写 + fetch 流式），沿用 projects.json 模式
- 存储：后端 `sessions.json` 文件持久化；前端无新增持久化
- 无新增依赖

## 实现方案

### 后端（server/index.js）

复用 `projects` 的 `Map + load/save` 同步模式，新增会话持久化：

- `SESSIONS_FILE = join(__dirname, 'sessions.json')`，`const sessions = new Map()`，`loadSessions/saveSessions`。首启动文件不存在时自动写 `[]`。
- `GET /api/sessions?projectId=`：返回该项目（或通用 `__none__`）会话数组，按 `updatedAt` 倒序；无 projectId 返回全部。
- `POST /api/sessions`：`{projectId, title}` 创建，`id='s_'+时间戳36+随机`，`messages:[]`，`createdAt/updatedAt=Date.now()`。
- `PUT /api/sessions/:id`：`{title?, messages?}` 局部更新并写盘。
- `DELETE /api/sessions/:id`：删除并写盘。
- 与 `/api/chat` 解耦：消息由前端发送/接收后调 PUT 落盘。
- 权限控制：`/api/chat` 入参增加 `permission`（readonly / full / none）。`runAgent` 内 `buildTools` 根据权限裁剪：only-read（none）移除 writeFile/editFile；full 保留全部。默认 full。

### 前端数据层（新增 src/sessions.js）

导出 `sessions`（reactive 数组）、`fetchSessions(projectId?)`、`createSession(projectId)`、`updateSession(id, {title,messages})`、`deleteSession(id)`，复用 `projects.js` 的 fetch 封装风格。

### 前端布局（src/App.vue）

- Sidebar 重写：顶部 `New Chat` 按钮（触发新建会话，通过 provide/事件或路由 query）；Search 输入框（v-model 过滤）；会话列表遍历 `projects.list` 按项目分组，每组渲染该项目 sessions，另设「通用对话」组；底部 footer 改为「设置」router-link（/settings）+ 用户信息（当前模型名）。
- 移除原 nav 顶部"对话/设置"两项（设置移到底部），保留 `<router-view>`。
- 顶栏去除 CodeAgent（App 不渲染即可）。

### 对话组件（src/components/ChatPanel.vue）

- 状态：当前 `activeSessionId`、当前会话 `messages`、加载态、`permission`（默认 full）、`effort`（默认 medium）。
- `onMounted`：拉取 sessions，默认选中第一个或新建；空态引导 New Chat。
- `send()`：调 `streamChat`（保留现有逻辑），流式回填 assistant；完成后 `updateSession` 落盘（标题=首条 user 内容截断）。请求 `config` 增加 `effort`、`permission`。
- 左上项目下拉：绑定 `activeProjectId`，选项含各项目 + 「＋ 添加项目」（选中触发 `openAdd`）。
- 对话框内控件：模型 a-select（复用现有 groupedModels）、思考强度 a-select（low/medium/high）、权限级别 a-select（只读/完全访问/不允许）。
- 搜索：过滤会话标题/首消息。
- 样式：沿用 marked + highlight.js（github-dark 已引入），主区改深色；输入框精致化（左侧加号 + textarea + 右侧发送 + Quick chips）。

### 路由（router/index.js）

不变（`/`、`/settings` 子路由）。设置入口由 sidebar 底部按钮触发。

## 实现要点

- 向后兼容：无 sessions.json 时后端自动建 `[]`；前端首启动空列表显示引导。
- 旧 `conversations` 内存结构替换为 sessions 后端数据源，避免重复存储。
- 性能：会话列表仅在新建/发送/切换后刷新；搜索用 computed 过滤，列表量小。
- 安全：会话接口沿用本地文件读写；权限控制防止越权写入。
- 风格一致：深色配色集中在 ChatPanel `<style>` 与 App.vue，不改动 settings 各页。

## 目录结构

```
src/
├── App.vue                 # [MODIFY] Sidebar 重写：New Chat+Search+按项目分组会话列表+底部设置；去顶部 nav/CodeAgent
├── components/
│   └── ChatPanel.vue       # [MODIFY] 接入 sessions；主区项目下拉+对话框内模型/思考/权限控件；深色风格
├── sessions.js             # [NEW] 会话 API 封装 + reactive 状态
└── style.css               # [MODIFY] 侧栏/会话列表/深色消息样式
server/
└── index.js                # [MODIFY] 新增 sessions.json 持久化 + /api/sessions REST + 权限裁剪工具
```

按设计图落地「深色调对话区 + 浅色侧边栏」高质感界面。侧边栏浅灰/白底、圆角卡片分组会话；主区深色背景，消息气泡分明，代码块 github-dark 高亮；输入框精致：左侧圆角加号、右侧主色发送按钮，底部 Quick 快捷 chips。强调「设置移动到下面」——侧栏底部固定设置入口与用户信息。主区顶部项目下拉（含添加入口）、对话框内集成模型/思考强度/权限三个 a-select 控件，统一 antd 风格。

## Agent Extensions

### Skill

- **vue-best-practices**
- Purpose: 指导 Vue 3 `<script setup>` Composition API 重写 App.vue 与 ChatPanel.vue，确保响应式状态管理清晰、无常见反模式。
- Expected outcome: 会话列表与对话组件采用标准 Composition API，组件结构合理。
- **ant-design-vue**
- Purpose: 为侧栏 New Chat/Search、主区项目下拉、对话框内模型/思考/权限 a-select 提供组件用法指导，保持与现有 a-select 一致。
- Expected outcome: 所有下拉控件使用正确的 antd 组件与样式，风格统一。
- **frontend-design**
- Purpose: 按设计图落地深色对话区 + 浅色侧边栏的高质感视觉，包括圆角、间距、代码块配色与微交互。
- Expected outcome: 界面达到设计图水准，视觉精致、层次分明。