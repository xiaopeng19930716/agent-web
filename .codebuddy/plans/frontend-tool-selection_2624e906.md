---
name: frontend-tool-selection
overview: 为 Code Agent 增加前端工具选择功能：在聊天输入区新增"工具"chip 多选下拉，用户可勾选启用的基础工具（现有 5 个文件工具 + 可选 MCP/Skills），后端按选择过滤并绑定工具；持久化到 settings.json 作为全局默认值。同时修复现有 streamChat 丢弃 permission/effort 的数据流断点。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 延续现有 toolbar-chip 统一风格
    - 分组多选下拉
    - 扳手图标标识工具
    - 数量徽标反馈
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 13px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#062E9A"
      - "#073AB5"
      - "#084DCD"
    background:
      - "#1F2937"
      - "#111827"
      - "#FFFFFF"
    text:
      - "#F9FAFB"
      - "#9CA3AF"
      - "#1F2937"
    functional:
      - "#10B981"
      - "#EF4444"
      - "#F59E0B"
todos:
  - id: backend-file-tools-filter
    content: 改造 buildTools 支持 toolKeys 过滤，runAgent 支持 enabledTools/skillPrompts 并合并绑定
    status: completed
  - id: backend-skills-prompt
    content: 在 routes/chat.js 解析 tools/skills 并注入 SKILL.md 到系统提示
    status: completed
    dependencies:
      - backend-file-tools-filter
  - id: mcp-client
    content: 用 [mcp:Context7] 解析 SDK 用法，新增 lib/mcpClient.js 加载 MCP 工具供 Agent 调用
    status: completed
  - id: frontend-api-stream
    content: 修复 agent.js streamChat 补齐 permission/effort/tools/skills 字段
    status: completed
  - id: frontend-settings-tools
    content: settings.js 新增 enabledTools 字段并扩展 initOthers/saveOthers 持久化
    status: completed
    dependencies:
      - frontend-api-stream
  - id: frontend-chip-ui
    content: ChatPanel.vue 新增"工具"chip 多选下拉（文件工具/技能/MCP 分组）并接入 send()
    status: completed
    dependencies:
      - frontend-settings-tools
  - id: verify-integration
    content: 启动后端用 [mcp:chrome-devtools] 实测工具选择、过滤绑定与持久化无回归
    status: completed
    dependencies:
      - mcp-client
      - frontend-chip-ui
---

## 产品概述

为 Code Agent 的聊天模块增加"工具选择"能力：用户可在输入区顶部通过多选下拉勾选本次对话要启用的工具，使 Agent 具备基础文件操作、技能遵循和 MCP 服务器工具调用能力。默认启用的工具持久化为全局设置。

## 核心特性

- 聊天输入区新增"工具"chip，支持多选勾选启用的工具（与现有模型/思考/权限 chip 风格一致）
- 可选工具集包含：5 个文件工具（列出文件/读取文件/写入文件/编辑文件/搜索项目）+ 已启用的 Skills + 已配置且启用的 MCP 服务器工具
- 后端按用户选择过滤并绑定工具，仅绑定勾选项；写类工具仍受权限级别（完全访问）约束
- 默认启用工具列表持久化到 settings.json，作为全局默认值
- 修复现有数据流断点：streamChat 补齐发送 permission/effort/tools 字段

## 技术栈

沿用现有栈：Vue 3（script setup + Composition API）+ Ant Design Vue（a-select）+ Express 后端 + LangChain（@langchain/core、@langchain/openai）。

## 实现方案

### 后端（Express + LangChain）

1. **工具构建与过滤**（server/lib/fileTools.js）：`buildTools(root, permission, toolKeys)` 新增第三参 `toolKeys`（数组，允许的工具 key）。当未传或非数组时返回全部（兼容现有调用）；为空数组返回 `[]`；否则按 key 过滤。工具 key 用现有 name（listFiles/readFile/writeFile/editFile/searchInProject）。
2. **Agent 工具绑定**（server/lib/chat.js）：

- `runAgent` 新增 `opts = { enabledTools, skillPrompts }` 参数；`buildTools` 传入 `enabledTools` 过滤；`bindTools` 绑定过滤后的工具。空列表则 `bindTools([])`（纯对话）。
- 新增 Skills 提示注入：`opts.skillPrompts`（选中的 SKILL.md 内容数组）拼入 SystemMessage，让模型遵循技能规范操作。
- 新增 MCP 工具加载：MCP 客户端将配置的 mcpServers 转成 LangChain tool，与文件工具合并后绑定。

3. **/api/chat 路由**（server/routes/chat.js）：解构新增 `tools`、`skills`（前端勾选的工具 key / skill id），解析后：

- 有项目：`runAgent(..., { enabledTools: tools, skillPrompts })`。
- 无项目：保持流式补全（文件工具依赖项目安全边界）；若勾选了 Skill，仍注入 skillPrompts。

4. **MCP 执行能力**：后端当前无 MCP SDK，需引入 `@modelcontextprotocol/sdk`，新增 `server/lib/mcpClient.js`：根据 mcpServers 配置创建 stdio/http 客户端，加载 tools 列表，供 runAgent 合并调用。此为独立步骤，需先解析官方 SDK 用法。

### 前端（Vue 3 + AntDV）

1. **状态**（src/settings.js）：`settings` 新增 `enabledTools: []`（文件工具 key）。`initOthers()` 读取 `/api/settings` 的 `enabledTools`；`saveOthers()` 提交 `{ enabledSkills, enabledTools }`。`resetSettings` 同步重置。
2. **数据流修复**（src/api/agent.js）：`streamChat` 解构参数与请求体补上 `permission`、`effort`、`tools`、`skills`。
3. **聊天 UI**（src/components/ChatPanel.vue）：

- 新增本地 ref `tools = ref([...settings.enabledTools])` 作为本次对话选择，与现有 effort/permission 一致。
- 在 `.chat__input-top-right` 中新增一个 `toolbar-chip`（Wrench 图标 + a-select 多选），选项分组：文件工具（5 个中文名）、技能（来自 settings.enabledSkills 对应扫描结果）、MCP（settings.mcpServers 已启用项）。
- `send()` 将 `tools.value`、勾选的 skills 传入 `streamChat`。
- 变化时通过 `saveOthers`（或统一 saveSettings）持久化默认工具。

### 性能与可靠性

- 工具过滤仅在请求时按数组构建，无额外 I/O；Skills 提示注入按需读取 SKILL.md，数量有限。
- MCP 客户端连接按请求粒度复用，避免频繁建连；异常时降级为仅文件工具，不影响对话。
- 保持向后兼容：`buildTools` 未传 toolKeys 时行为不变；`enabledTools` 缺省为空时后端回退为全部工具（或按产品需要默认全选）。

### 实现注意

- `buildTools` 签名向后兼容；`runAgent` 参数用对象形式避免破坏现有调用。
- streamChat 是数据流断点修复点，务必同时补 permission/effort/tools/skills。
- MCP 工具执行需引入新依赖，先查询官方文档确认 SDK 用法再实现，避免错误 API。
- 所有响应格式与错误码保持不变。

## 架构设计

```mermaid
graph TD
  A[ChatPanel.vue 工具chip] -->|tools/skills| B[agent.js streamChat]
  B -->|POST /api/chat + permission/effort/tools/skills| C[routes/chat.js]
  C -->|enabledTools + skillPrompts| D[lib/chat.js runAgent]
  D -->|toolKeys 过滤| E[lib/fileTools.js buildTools]
  D -->|注入 SKILL.md| F[lib/skills.js scanSkills]
  D -->|MCP tools| G[lib/mcpClient.js]
  E -->|bindTools| H[ChatOpenAI Agent loop]
  G -->|mcpServers 配置| H
  B -->|持久化默认工具| I[settings.js saveOthers]
  I -->|PUT /api/settings| J[settings 路由]
</mermaid>

## 目录结构
```

server/
├── routes/chat.js            # [MODIFY] 解析 tools/skills，传给 runAgent；Skills 提示注入
├── lib/chat.js               # [MODIFY] runAgent 支持 enabledTools/skillPrompts/MCP 工具合并
├── lib/fileTools.js          # [MODIFY] buildTools 新增 toolKeys 过滤参数
├── lib/skills.js             # [MODIFY] 导出按 id 读取 SKILL.md 内容的函数
└── lib/mcpClient.js          # [NEW] MCP 客户端：根据 mcpServers 加载 tools 供 Agent 调用
src/
├── api/agent.js              # [MODIFY] streamChat 补 permission/effort/tools/skills 字段
├── settings.js               # [MODIFY] 新增 enabledTools 字段；initOthers/saveOthers 扩展
└── components/ChatPanel.vue  # [MODIFY] 新增"工具"chip 多选下拉；send() 传 tools/skills

```

## 关键代码结构
```

// server/lib/fileTools.js —— 新增 toolKeys 过滤
export function buildTools(root, permission = 'full', toolKeys) {
// ...现有 5 个工具定义
const all = [/* listFiles/readFile/writeFile/editFile/searchInProject */]
if (!Array.isArray(toolKeys)) return all
return all.filter((t) => toolKeys.includes(t.name))
}

// server/lib/chat.js —— runAgent 支持工具过滤与技能提示
export async function runAgent(model, history, projectRoot, res, permission = 'full', callbacks, opts = {}) {
const { enabledTools, skillPrompts = [], mcpTools = [] } = opts
const fileTools = buildTools(projectRoot, permission, enabledTools)
const tools = [...fileTools, ...mcpTools]
const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
const modelWithTools = model.bindTools(tools)
const sysText = SYSTEM_PROMPT + (skillPrompts.length ? '\n\n已启用技能规范：\n' + skillPrompts.join('\n\n') : '')
const messages = [new SystemMessage(sysText), ...history]
// ...现有 Agent loop 不变
}
```

在既有 Vue 3 + Ant Design Vue 聊天界面中新增"工具选择"功能。延续现有 toolbar-chip 交互风格：在输入区顶部右侧（模型、思考强度、权限 chip 之后）新增一个以扳手图标（Wrench）标识的"工具"chip，点击展开多选下拉。

- 下拉按分组展示：基础工具组（列出文件/读取文件/写入文件/编辑文件/搜索项目，前带复选框）、技能组（已启用 Skills）、MCP 组（已启用 MCP 服务器）。勾选项带勾选标记，chip 上显示已选工具数量徽标。
- 采用与现有 effort/permission chip 完全一致的尺寸、间距、圆角与 hover 效果，保证视觉统一。
- 选项在深色输入区使用浅色文字、hover 高亮，选中项用主题色标记，多选标签以紧凑小标签（tag）显示在 chip 内。

## Agent Extensions

### MCP

- **Context7**：用于解析 `@modelcontextprotocol/sdk` 的官方库 ID 与用法，指导 MCP 客户端（stdio/http）的加载与调用实现，避免使用错误 API。

### Skill

- **vue-best-practices**：用于指导 ChatPanel.vue 的 Composition API 状态管理与新增"工具"chip 的实现，确保符合 Vue 3 最佳实践。
- **lsp-code-analysis**：用于在修改前后对 ChatPanel.vue、agent.js、settings.js 及后端 chat.js/fileTools.js 进行符号定位与影响分析，确认改动波及范围。