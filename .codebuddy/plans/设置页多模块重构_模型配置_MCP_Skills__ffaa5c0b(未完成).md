---
name: 设置页多模块重构（模型配置/MCP/Skills）
overview: 将设置页重构为带左侧子菜单的多模块结构：模型配置（现有供应商配置 + 每模型 Max Tokens）、MCP 设置（配置管理 + 测试连接，支持 stdio/http/sse）、Skills 设置（多候选目录扫描本地技能合并展示）。后端新增 MCP 测试与技能扫描接口。
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
  - id: backend-apis
    content: 扩展 server/index.js：buildChatModel 支持 maxTokens，新增 POST /api/mcp/test 与 GET /api/skills 接口
    status: pending
  - id: data-layer
    content: 扩展 settings.js（mcpServers/enabledSkills/maxTokens 归一化）与 api/agent.js（testMcpServer/fetchSkills），参考 [skill:vue-best-practices]
    status: pending
    dependencies:
      - backend-apis
  - id: settings-shell
    content: 改造 SettingsPanel.vue 为左侧子菜单外壳，新建 ModelSettings.vue 迁入供应商配置并给模型行加 maxTokens 输入，使用 [skill:tailwind-css-best-practices]
    status: pending
    dependencies:
      - data-layer
  - id: mcp-panel
    content: 新建 McpSettings.vue：MCP Server CRUD、启用开关、stdio/http/sse 类型选择、测试连接，使用 [skill:ant-design-vue]
    status: pending
    dependencies:
      - settings-shell
  - id: skills-panel
    content: 新建 SkillsSettings.vue：展示后端扫描技能卡片、启用/禁用持久化、空态与错误态
    status: pending
    dependencies:
      - settings-shell
  - id: chat-max-tokens
    content: 修改 ChatPanel.vue send() 将模型 maxTokens 透传到 /api/chat 请求 config
    status: pending
    dependencies:
      - data-layer
---

## 产品概述

将设置页从单一供应商配置面板升级为带左侧子菜单的多模块设置中心，菜单包含「模型配置 / MCP设置 / Skills设置」三项，满足编程 Agent 的模型与工具配置需求。

## 核心功能

- **模型配置**（第一菜单）：即现有供应商配置面板，模型行新增 Max Tokens 输入，不同模型各配各的，保存后随对话请求发送
- **MCP设置**：MCP Server 配置管理（名称、类型、命令或 URL、启用开关），支持添加/编辑/删除、测试连接（stdio 与 http/sse 两种类型均可探测连通性），配置本地持久化
- **Skills设置**：后端扫描多个候选目录（项目根 skills/、用户主目录等约定位置）自动发现技能，解析每个技能目录内 SKILL.md 的 name/description，前端卡片合并展示，支持启用/禁用（状态本地持久化）
- Temperature 不做入设置页（后续在聊天区手动调节）

## 技术栈

- Vue 3（Composition API + script setup）+ Vite + Tailwind CSS 3.4 + ant-design-vue + lucide-vue-next
- 后端：Express（server/index.js），已有文件系统工具与 SSE 流式 Agent loop
- 持久化：localStorage（settings.js）+ 后端动态接口（skills 扫描 / mcp 测试）

## 实现方案

### 总体思路

1. SettingsPanel.vue 改造为设置页外壳（左侧子菜单 + 右侧内容区），三个面板拆分为独立子组件，避免单文件膨胀。
2. 模型配置面板 = 现有供应商卡片+表单逻辑整体迁入 ModelSettings.vue，模型行新增 maxTokens 数字输入；数据链：模型对象 maxTokens → ChatPanel config → 后端 buildChatModel。
3. MCP 配置存 localStorage（settings.mcpServers），测试连接走后端 POST /api/mcp/test（stdio 用 spawn 探测启动后立即 kill；http/sse 用 fetch 发 JSON-RPC initialize 探测，5s 超时）。
4. Skills 由后端 GET /api/skills 扫描候选目录合并返回（每个技能子目录含 SKILL.md，解析 frontmatter name/description），前端渲染卡片列表，启用状态存 localStorage。

### 后端接口设计

- `POST /api/mcp/test`：body `{ type: 'stdio'|'http'|'sse', command?, url? }`；stdio 用 child_process.spawn（shell:true，监听 stderr/spawn，超时 4s 后 kill，返回 ok 或错误信息）；http/sse 用 fetch 发送 MCP initialize JSON-RPC 请求（AbortSignal.timeout(5000)），返回连通状态。
- `GET /api/skills`：扫描候选目录 `[<项目根>/skills, ~/skills, ~/.agents/skills, ~/.claude/skills, ~/.codebuddy/skills]`（仅存在者），读 `<dir>/<skill-name>/SKILL.md`，解析 `---` frontmatter 的 name/description，返回 `[{ id, name, description, path, sourceDir }]`，目录不存在时静默跳过。

### 关键数据流

- 模型 maxTokens：SettingsPanel 表单保存 → settings.models[].maxTokens → ChatPanel send() 组装 config.maxTokens → /api/chat → buildChatModel 传 maxTokens（缺失时回退默认值）。
- MCP 测试：McpSettings 点击测试 → api/agent.js testMcpServer() → 后端 spawn/fetch 探测 → 前端展示成功/失败状态。
- Skills 加载：SkillsSettings onMounted → api/agent.js fetchSkills() → 渲染卡片；启用开关写入 settings.enabledSkills（localStorage）。

## 目录结构

```
src/
├── settings.js                  # [MODIFY] defaults 增加 mcpServers:[]、enabledSkills:[]，normalizeModels 保留 maxTokens
├── api/
│   └── agent.js                 # [MODIFY] 新增 testMcpServer()、fetchSkills() 两个 fetch 封装
├── components/
│   ├── SettingsPanel.vue        # [MODIFY] 改造为外壳：左侧子菜单（模型配置/MCP设置/Skills设置）+ 右侧 <component :is> 内容区
│   ├── ModelSettings.vue        # [NEW] 迁入现有供应商卡片+三行表单逻辑；模型行新增 maxTokens 数字输入（placeholder "Max Tokens（可选）"）
│   ├── McpSettings.vue          # [NEW] MCP Server 列表 CRUD：名称、类型 select(stdio/http/sse)、命令或 URL、启用 switch、测试连接按钮（每行独立 loading/结果状态）、删除确认
│   ├── SkillsSettings.vue       # [NEW] 技能卡片网格：图标+名称+描述+来源目录+启用 switch；空态提示；扫描失败错误提示
│   └── ChatPanel.vue            # [MODIFY] send() 中 config 增加 maxTokens: modelObj.maxTokens（无则省略）
server/
└── index.js                     # [MODIFY] buildChatModel 支持 maxTokens；新增 POST /api/mcp/test、GET /api/skills
```

## 实施要点

- 迁移时保持 SettingsPanel.vue 现有供应商逻辑原样搬入 ModelSettings.vue（含 VENDORS、removeCustomVendor、删除确认、卡片图标徽记等），避免行为回归。
- settings.js 中 mcpServers 结构：`{ id, name, type: 'stdio'|'http'|'sse', command?, url?, enabled, createdAt }`；load/reset 均需兜底数组。
- stdio 测试安全性：仅 spawn 探测启动即 kill，不交互不注入；http/sse 仅发只读 initialize 请求，超时必杀。
- skills 扫描只读文件系统，不执行技能内容；frontmatter 解析失败时回退用目录名作为 name。
- 后端复用现有 express 模式（app.post/app.get + res.json），错误统一 { error } 结构，与 /api/projects 一致。
- 用户已明确：改完代码不运行 lint 与 build 检测，由用户自行验证。

## 设计风格

延续现有简约专业风格：白色卡片、圆角、品牌蓝强调色。设置页改为左侧细栏子菜单（模型配置 / MCP设置 / Skills设置）+ 右侧滚动内容区，子菜单当前项高亮为品牌蓝底白字。模型配置面板保持供应商卡片网格 + 表单；MCP 面板用列表卡片行（类型徽标区分 stdio/http/sse + 启用开关 + 测试按钮）；Skills 面板用技能卡片网格（名称、描述、来源目录、启用开关）。交互统一 hover 微动效（-translate-y/阴影），删除均有确认，测试连接用 loading 态 + 成功/失败结果色。

## Agent Extensions

### Skill

- **ant-design-vue**
- 用途：MCP/Skills 面板中选用合适的 AntDV 组件（Switch 开关、Select 类型选择、Popconfirm 删除确认、Tag 类型徽标）并按其规范使用
- 预期结果：MCP 列表与 Skills 卡片交互组件用法正确，无 API 误用
- **vue-best-practices**
- 用途：规范 Vue 3 Composition API + script setup 写法，指导 SettingsPanel 外壳与三个子组件拆分
- 预期结果：组件结构清晰、响应式状态管理符合 Vue 3 最佳实践
- **tailwind-css-best-practices**
- 用途：约束三个新面板的 Tailwind 类使用规范，保持与现有 SettingsPanel 样式一致
- 预期结果：新面板样式与既有卡片/表单风格统一，无样式回归