# 长期记忆 (MEMORY.md)

## 项目：agent-web（AI 对话 Agent 前端 + Node 后端）
- 技术栈：Vue 3 + Vite + ant-design-vue；后端 Express + SSE（`server/`）。
- 编辑规范：绝不对 `.vue` SFC 用 `write_to_file` 整段覆盖，只用 `replace_in_file`；纯 JS 模块（如 `src/sessions.js`）可整写。
- 后端热重载：`npm run dev:all`（含 `server:watch` = nodemon 监听 server 目录，忽略 server/data、server/node_modules）。
- 无项目对话可读用户主目录文件（`fileRoot = projectRoot || os.homedir()`），写/命令仍受 perm 约束。
- 依赖：已安装 `echarts`（用量图表页用）。

## 功能清单与进度（用户 2026-08-25 盘点 + 当天更新）
> 以「代码现状」为准。金额成本类需求用户明确不做（去各模型平台后台看更准）。

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| #1 | 消息持久化/断线恢复 | ✅ | session 持久化到 server/data/sessions.json |
| #2 | diff 预览（SessionChanges 查看改动） | ✅ | |
| #3 | 多轮编辑/重新生成 | ✅ | regenerate + 编辑历史消息后重试均已落地（用户 2026-08-25 确认） |
| #4 | 消息内代码块操作（应用到文件/编辑器打开） | ⏸ 暂搁置 | 仅复制；缺「应用到文件」 |
| #5 | 导出对话（MD/JSON）、清屏 | ⏸ 暂搁置 | 用户 2026-08-25 说暂搁置 |
| #6 | 多 Agent/子任务编排（plan→execute） | ⬜ 未做 | |
| #7 | 待办/任务清单 todo | ✅ | TodoPanel.vue + todoWrite 工具 + todo_update 事件 |
| #8 | 增量文件编辑确认带 diff | ✅ | tool_confirm 事件 + confirm-diff 预览 + 允许/拒绝 |
| #9 | 图像/截图理解 | ⬜ 未做 | |
| #10 | 工具调用回放/重试单条 | ✅ | MessageList 重试按钮 + /api/chat/retry-tool |
| #11 | 流式超时与重连（SSE 断流重连+缓冲） | ⬜ 未做 | |
| #12 | 用量统计页面 | ✅ | 2026-08-25 新建独立 `/usage` 页（见下） |
| #13 | 暗色模式 | ✅ | |
| #14 | Cmd+Enter / Enter 发送 | ✅ | |
| #16 | 首 token 延迟显示 | ✅ | |
| #13b | 代理/网络配置（baseURL、系统代理） | ⬜ 未做 | |

### 剩余未做：#6 #9 #11 #13b ｜ 暂搁置：#4 #5

## #12 用量统计页面（2026-08-25 实现细节）
- 路由：`src/router/index.js` 顶层 `/usage`（独立页，不嵌设置）。
- 入口：`src/App.vue` 侧边栏 footer「设置」上方加「用量」RouterLink（BarChart3 图标）。
- 组件：`src/components/UsageStats.vue`（echarts）。
- 数据：前端 `fetchSessions()` 遍历全部会话 assistant 消息的 `metadata`（model/tokens/timestamp/status）。
- 口径：调用次数计入所有产生 assistant 回复的轮次（**含失败**）；token 合计跳过 null。
- 图表（用户最终定稿）：
  1. 各模型 Token 总量（横向柱状，y 轴标签 width:140 截断 + tooltip 完整名）
  2. **各厂商调用次数**（柱状，按 vendorKey 聚合，非按模型）
  3. Token 按天趋势（折线）
- 已去掉顶部三张汇总卡片（用户要求）。模型名友好化：vendorKey/modelId → 厂商名/模型名。
- 调用次数图已按用户要求改为「按厂商」展示。

## 关键约束（来自历史 bug）
- MessageList.vue 编辑 `.timeline__result-body` 等样式块时，old_str 必须覆盖完整属性块，否则剩余属性会脱离选择器成裸属性导致 Less 编译报错「missing opening '{'」。
- 工具重试按钮：仅失败工具显示（isToolFailed 正则匹配 result 文本错误/失败/拒绝/超时），放在头部状态标签「完成」左侧，文字「重试」；失败工具状态标签显示红色「失败」而非「完成」。

## ⚠️ 颜色/主题强制规范（用户 2026-08-25 定）
- **禁止在 `.vue` 组件中硬编码任何颜色值**（包括 Tailwind 的 `bg-white`/`text-gray-700`/`border-gray-200`/`bg-gray-50` 等固定浅色类，以及 Less 的 `@color-*` 之外的字面量如 `#1f1f1f`、`#141414`、`#303030` 等）。
- 原因：主题色后续要交给**用户自定义**，硬编码会让自定义主题失效、且暗色模式不统一。
- **只允许用项目 CSS 变量**：`--color-bg` / `--color-bg-subtle` / `--color-bg-elevated` / `--color-border` / `--color-text` / `--color-text-strong` / `--color-text-muted` / `--brand` 等（定义在 `src/assets/theme.css`，明暗两套）。
- Tailwind 用法：用 `dark:` 变体 + 变量任意值，例：`dark:bg-[var(--color-bg-subtle)]`、`dark:border-[var(--color-border)]`、`dark:text-gray-200`（gray 灰阶作为文字层级可保留，但背景/边框等必须走变量）。
- ant-design-vue 组件：已通过 `App.vue` 的 `a-config-provider` + `theme.darkAlgorithm` + token（`colorBgContainer:#1e293b` 等）统一暗色；不要给 antdv 组件单独加浅色背景类。
- 之前已修过：ModelSettings / SettingsPanel / UsageStats / McpSettings / SkillsSettings 的暗色适配（背景/边框/文字全改走变量）。
