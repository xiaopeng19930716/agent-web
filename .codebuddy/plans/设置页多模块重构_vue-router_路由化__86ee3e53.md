---
name: 设置页多模块重构（vue-router 路由化）
overview: 为项目引入 vue-router：整体菜单（对话/设置）与设置页子菜单（模型配置/MCP/Skills）全部路由化。同时完成设置页多模块重构——模型配置（含每模型 Max Tokens）、MCP 设置（配置+测试连接）、Skills 设置（多目录扫描），后端新增 MCP 测试与技能扫描接口。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 简约
    - 卡片化
    - 蓝色品牌色
    - 圆角
    - 微动效
  fontSystem:
    fontFamily: system-ui, -apple-system, 'Segoe UI', sans-serif
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 13px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
      - "#1D4ED8"
      - "#0F172A"
    background:
      - "#F8FAFC"
      - "#FFFFFF"
    text:
      - "#1F2937"
      - "#6B7280"
      - "#FFFFFF"
    functional:
      - "#16A34A"
      - "#DC2626"
      - "#D97706"
      - "#E5E7EB"
todos:
  - id: install-router
    content: 安装 vue-router@4，创建 src/router/index.js（hash 模式 + 懒加载）并在 main.js 注册
    status: completed
  - id: app-shell-routing
    content: 改造 App.vue 整体菜单为路由驱动 + router-view，改造 SettingsPanel.vue 为左侧子菜单外壳与嵌套 router-view
    status: completed
    dependencies:
      - install-router
  - id: backend-apis
    content: 扩展 server/index.js：buildChatModel 支持 maxTokens，新增 POST /api/mcp/test 与 GET /api/skills
    status: completed
  - id: data-layer
    content: 扩展 settings.js（mcpServers/enabledSkills/maxTokens 归一化）与 api/agent.js（testMcpServer/fetchSkills）
    status: completed
    dependencies:
      - backend-apis
  - id: model-settings
    content: 新建 ModelSettings.vue 迁入供应商配置，模型行加 maxTokens 输入，使用 [skill:vue-best-practices] 与 [skill:tailwind-css-best-practices]
    status: completed
    dependencies:
      - app-shell-routing
      - data-layer
  - id: mcp-settings
    content: 新建 McpSettings.vue：MCP Server CRUD、启用开关、stdio/http/sse 类型与测试连接，使用 [skill:ant-design-vue]
    status: completed
    dependencies:
      - app-shell-routing
      - data-layer
  - id: skills-settings
    content: 新建 SkillsSettings.vue：技能卡片展示、启用/禁用持久化、空态与错误态，使用 [skill:ant-design-vue]
    status: completed
    dependencies:
      - app-shell-routing
      - data-layer
  - id: chat-max-tokens
    content: 修改 ChatPanel.vue send() 将模型 maxTokens 透传到 /api/chat 请求 config
    status: completed
    dependencies:
      - data-layer
---

## 产品概述

将设置页与整体导航升级为 vue-router 路由控制：整体菜单（对话/设置）与设置页左侧子菜单（模型配置/MCP设置/Skills设置）均通过路由切换，同时完成设置中心多模块功能建设。

## 核心功能

- 整体路由：`/chat`（对话）、`/settings`（设置），App.vue 菜单项改为路由驱动，当前项高亮由路由路径决定
- 设置嵌套路由：`/settings/models`（模型配置）、`/settings/mcp`（MCP设置）、`/settings/skills`（Skills设置），SettingsPanel.vue 改造为左侧子菜单外壳 + 嵌套 `<router-view>`
- 模型配置：现有供应商配置面板迁移为独立组件，模型行新增 Max Tokens 输入，保存后随对话请求发送
- MCP设置：MCP Server 配置管理（名称、类型 stdio/http/sse、命令或 URL、启用开关、增删改、测试连接），配置本地持久化
- Skills设置：后端扫描多个候选目录（项目根 skills/、用户主目录等约定位置）解析 SKILL.md 合并返回，前端卡片展示 + 启用/禁用持久化
- 刷新不 404：采用 hash 路由模式，适配独立后端 + 静态托管的部署方式

## 技术栈

- 新增依赖：`vue-router@4`（路由控制）
- 现有：Vue 3（Composition API + `<script setup>`）+ Vite + Tailwind CSS 3.4 + ant-design-vue + lucide-vue-next
- 后端：Express（server/index.js），已有文件系统工具与 SSE 流式 Agent loop
- 持久化：localStorage（settings.js）+ 后端动态接口（skills 扫描 / mcp 测试）

## 实现方案

### 总体思路

1. 路由模式选 **createWebHashHistory**：本项目前端为独立 Vite 服务、后端 Express 不服务静态文件，hash 模式无需服务器 fallback 配置，刷新任意子路由不会 404，部署到任意静态托管均可直接工作。
2. 路由结构采用「整体一级路由 + 设置嵌套路由」：

- `/` → redirect `/chat`；`/chat` → ChatPanel
- `/settings` → SettingsPanel 外壳（redirect `/settings/models`），其下三个子路由分别渲染 ModelSettings / McpSettings / SkillsSettings

3. App.vue 菜单改为 `router-link`，当前项高亮用 `route.path` 判断；SettingsPanel.vue 保留左侧子菜单布局，子菜单用 `router-link`，内容区改为嵌套 `<router-view>`。
4. 模型 maxTokens 数据链：ModelSettings 表单保存 → `settings.models[].maxTokens` → ChatPanel send() 组装 `config.maxTokens` → `/api/chat` → 后端 `buildChatModel` 透传。
5. MCP 配置存 localStorage（`settings.mcpServers`），测试连接走后端 `POST /api/mcp/test`（stdio 用 spawn 探测启动后立即 kill；http/sse 用 fetch 发 JSON-RPC initialize，5s 超时）。
6. Skills 由后端 `GET /api/skills` 扫描候选目录合并返回（约定每个技能子目录含 SKILL.md，解析 frontmatter name/description），前端渲染卡片，启用状态存 `settings.enabledSkills`。

### 后端接口

- `POST /api/mcp/test`：body `{ type: 'stdio'|'http'|'sse', command?, url? }`；stdio 用 `child_process.spawn`（超时 4s 后 kill，监听 spawn/error/stderr）；http/sse 用 fetch 发送 MCP initialize 请求（AbortSignal.timeout(5000)），返回 ok/错误信息。
- `GET /api/skills`：扫描候选目录 `[<项目根>/skills, ~/skills, ~/.agents/skills, ~/.claude/skills, ~/.codebuddy/skills]`（仅存在者），读 `<dir>/<skill-name>/SKILL.md` 解析 frontmatter，返回 `[{ id, name, description, path, sourceDir }]`，目录不存在静默跳过，frontmatter 解析失败回退目录名。
- `buildChatModel` 增加 `maxTokens` 支持（`cfg.maxTokens` 为数字时透传）。

### 性能与可靠性

- skills 扫描限制深度与文件数（每目录读取 SKILL.md 与 description 摘要，不做全量递归），避免大目录卡顿。
- MCP 测试一律带超时（stdio 4s / http 5s），超时即终止并返回失败，防止挂起；stdio 仅探测不交互不注入。
- 路由组件懒加载（`import()` 动态导入）降低首屏体积。

### 避免技术债

- 复用现有 settings.js 持久化模式与 Express 接口错误结构（`{ error }`），不引入新状态库。
- SettingsPanel 仅保留外壳与子菜单，供应商逻辑整体迁入 ModelSettings.vue，行为不回归。

延续现有简约专业风格（白色卡片、圆角、品牌蓝强调色）。整体布局：左侧深色全局侧边栏（对话/设置）保持不变，菜单项激活态由路由驱动；设置页内改为「左侧细栏子菜单 + 右侧滚动内容区」结构，子菜单当前项高亮为品牌蓝底白字，hover 有浅灰底过渡。

模型配置面板：供应商卡片网格 + 统一配置表单，模型行新增 Max Tokens 数字输入框，与现有名称/ID 输入并排，右侧 + / 删除图标按钮保持现样式。

MCP 面板：MCP Server 列表卡片行，每行含名称、类型徽标（stdio/http/sse 用不同颜色 Tag 区分）、命令或 URL 摘要、启用 Switch、测试连接按钮（独立 loading 态与成功/失败结果色），行尾删除按钮带 Popconfirm 确认；底部「添加 MCP Server」卡片进入新增表单。

Skills 面板：技能卡片网格，每卡含技能图标、名称、描述、来源目录路径（等宽字体小字）、启用 Switch；顶部展示扫描来源目录数，空态显示「未发现技能」引导文案，扫描失败显示错误提示与重试按钮。

交互统一：hover 微动效（-translate-y-0.5 + 阴影加深）、删除均有确认、测试连接用 loading 态 + 绿/红结果反馈。

## Agent Extensions

### Skill

- **vue-router-best-practices**
- 用途：指导路由配置（createWebHashHistory、嵌套路由、redirect、懒加载、active 判断）与路由-组件生命周期交互
- 预期结果：src/router/index.js 与 App.vue/SettingsPanel.vue 的路由改造符合 Vue Router 4 最佳实践
- **vue-best-practices**
- 用途：规范 Vue 3 Composition API + `<script setup>` 写法，指导外壳与三个子面板组件拆分
- 预期结果：组件结构清晰、响应式状态符合 Vue 3 最佳实践
- **ant-design-vue**
- 用途：MCP/Skills 面板中正确选用 AntDV 组件（Switch、Select、Popconfirm、Tag、Spin 等）并按其 API 使用
- 预期结果：MCP 列表与 Skills 卡片交互组件用法正确，无 API 误用
- **tailwind-css-best-practices**
- 用途：约束三个新面板与外壳的 Tailwind 类使用，保持与现有设置页样式统一
- 预期结果：新面板样式与既有卡片/表单风格一致，无样式回归