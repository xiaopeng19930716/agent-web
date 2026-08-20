---
name: at-file-reference
overview: 在关联项目的对话中，输入 @ 弹出项目文件树面板，可浏览目录并选中文件，@选中的相对路径保留在输入框（如 @src/App.vue）并注入用户消息，Agent 自然调用 readFile 读取。仅文件可选，目录用于展开浏览。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 命令面板
    - 文件树浏览
    - 浅蓝高亮
    - 懒加载
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 14px
      weight: 600
    subheading:
      size: 12px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
      - "#1D4ED8"
    background:
      - "#FFFFFF"
      - "#EFF6FF"
    text:
      - "#1F2937"
      - "#64748B"
    functional:
      - "#16A34A"
      - "#EF4444"
todos:
  - id: backend-file-tree-api
    content: 在 server/lib/fileTools.js 新增 listDirectory 并新增 GET /api/projects/:id/files 路由
    status: pending
  - id: frontend-api-fetch
    content: 在 src/api/agent.js 新增 fetchProjectFiles 封装列文件接口
    status: pending
    dependencies:
      - backend-file-tree-api
  - id: at-panel-ui
    content: 在 ChatPanel.vue 实现 @ 文件面板（触发/筛选/目录导航/选中写回输入框）
    status: pending
    dependencies:
      - frontend-api-fetch
  - id: verify-integration
    content: 启动前后端用 [mcp:chrome-devtools] 实测 @ 选择文件到 Agent readFile 全流程
    status: pending
    dependencies:
      - at-panel-ui
---

## 产品概述

为 Code Agent 的聊天模块新增 `@` 文件引用能力：当对话关联了项目时，用户在输入框输入 `@` 可弹出项目文件树面板，通过 `@关键字` 筛选项目内文件，选中后把 `@相对路径`（如 `@src/App.vue`）保留在输入框中并注入用户消息，Agent 看到后自然调用 `readFile` 读取目标文件。

## 核心特性

- 关联项目时输入 `@` 弹出项目文件树选择面板，`@关键字` 筛选文件（类似现有 `/` 命令面板体验）
- 面板仅文件可选；目录用于展开浏览与层级导航（支持进入子目录、返回上级）
- 选中的文件以 `@相对路径` 形式保留在输入框，随消息发送，Agent 自然调用 `readFile`
- 未关联项目时不触发 `@` 文件面板
- 复用现有 `/` 命令面板的交互模式（面板/筛选/键盘导航/suppressSend 防误发）与 `.cmd-item` 样式，保持视觉统一

## 交互细节

- 触发：输入框内容中出现 `@` 且当前已关联项目时弹出面板
- 筛选：`@` 后紧跟的关键词过滤当前目录下的文件
- 选中：回车或点击文件项，把 `@相对路径` 写回输入框，关闭面板并聚焦光标
- 导航：目录项点击进入子目录，面板提供返回上级入口；数据按目录懒加载
- 安全：路径根目录来自后端 `projects Map`，前端仅传 `projectId` 与相对目录，经 `safeResolve` 越界校验，不信任绝对路径

## 技术栈

沿用现有栈：Vue 3（Composition API + `<script setup>`）+ Ant Design Vue + Express 后端 + Node.js fs。

## 实现方案

### 后端：新增按项目列出文件树的结构化接口

在 `server/routes/projects.js` 新增 `GET /api/projects/:id/files?dir=`：

- 从 `projects` Map 取项目（校验存在，未知返回 400），以 `p.path` 为安全根目录
- `dir` 为相对项目根目录的目录，默认 `""`；用 `safeResolve(root, dir)` 做越界校验（越界/不存在返回 400）
- 读取该目录 entries，跳过 `node_modules`、`.git`、隐藏文件（与 `tree()` 规则一致）
- 返回结构化 JSON：`{ path, entries: [{ name, type: 'file'|'dir', path }] }`

在 `server/lib/fileTools.js` 新增导出的 `listDirectory(root, rel)` 函数：内部用 `safeResolve` 校验后用 `fs.readdirSync` 列出当前目录的 file/dir 子项，供路由复用；保持与现有 `tree()` 一致的跳过规则。

### 前端：新增 `@` 文件面板（复用 `/` 命令面板模式）

在 `src/api/agent.js` 新增 `fetchProjectFiles(projectId, dir)` 封装，调用后端 `GET /api/projects/:id/files?dir=`。

在 `src/components/ChatPanel.vue`：

- 新增状态 `showAtPanel/atFilter/atHighlight/atDir/atEntries/atLoading`，在现有 `onCmdInput` 中增加对 `@` 的检测分支（仅 `active.value` 存在时）
- 新增 `openAtPanel()`（首次进入请求根目录）、`loadAtDir(dir)`（懒加载子目录）、`chooseAtFile(item)`（把 `@相对路径` 写回输入框）、`onAtKeydown`（方向键/Enter/Esc，Enter 选中时设 `suppressSend`）
- 模板新增 `@` 面板（复用 `.cmd-panel`/`.cmd-item` 结构 + `@mousedown.prevent`），目录项显示展开箭头可进入、文件项可选，面板提供返回上级入口
- `send()` 无需额外处理：`@相对路径` 已作为普通文本留在消息中，Agent 自然调用 `readFile`

### 安全与可靠性

- 根目录始终来自后端 `projects.get(id).path`，前端只传 `projectId + 相对 dir`，杜绝越权访问任意目录
- 目录懒加载，避免一次拉取全树过大；请求失败降级为面板关闭并提示
- `suppressSend` 复用现有机制，防止面板回车误触发送

## 架构设计

```mermaid
graph TD
  A[ChatPanel.vue 输入 @] -->|active 存在| B[onCmdInput 检测 @]
  B -->|openAtPanel| C[fetchProjectFiles projectId+dir]
  C -->|GET /api/projects/:id/files| D[routes/projects.js]
  D -->|safeResolve 校验| E[lib/fileTools.js listDirectory]
  E -->|结构化 JSON| C
  C -->|渲染文件树| F[@ 面板 .cmd-item]
  F -->|chooseAtFile| G[输入框保留 @相对路径]
  G -->|send()| H[用户消息含 @路径]
  H -->|Agent readFile| I[后端读取文件]
```

## 目录结构

```
server/
├── routes/projects.js     # [MODIFY] 新增 GET /api/projects/:id/files?dir=（列项目文件树，结构化 JSON）
└── lib/fileTools.js       # [MODIFY] 新增导出 listDirectory(root, rel)（safeResolve 校验 + readdir，跳过 node_modules/.git/隐藏）
src/
├── api/agent.js           # [MODIFY] 新增 fetchProjectFiles(projectId, dir) 封装
└── components/ChatPanel.vue  # [MODIFY] 新增 @ 文件面板（状态/onAtInput/onAtKeydown/chooseAtFile/模板/样式）+ send() 保留 @路径
```

延续现有 / 命令面板的深色命令式交互：@ 文件面板采用统一的浮层样式（白底圆角卡片、轻阴影、`@mousedown.prevent` 防失焦），列表项复用 `.cmd-item` 布局（key 前缀 + 名称 + 类型徽标）。文件项带文档图标与"file"徽标，目录项带文件夹图标与"dir"徽标，目录项 hover 显示可进入箭头。高亮项用浅蓝背景 `#eff6ff` 与主题蓝文字 `#2563eb`，选中文件项带勾选标记。面板底部提供返回上级入口与当前路径面包屑，顶部提示"输入 @关键字 筛选文件"。整体与现有模型/工具面板视觉统一。

## Agent Extensions

### Skill

- **vue-best-practices**：指导 ChatPanel.vue 的 Composition API 状态管理与新增 @ 文件面板的实现，确保符合 Vue 3 最佳实践。
- **lsp-code-analysis**：在修改前后对 ChatPanel.vue、agent.js、projects.js、fileTools.js 进行符号定位与影响分析，确认改动波及范围。

### MCP

- **chrome-devtools**：启动前后端后，实测输入 @ 弹出文件面板、@关键字筛选、选中文件写回输入框、发送后 Agent readFile 读取目标文件，验证无回归。