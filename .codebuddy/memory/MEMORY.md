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
| #6 | 多 Agent/子任务编排（plan→execute） | ✅ | 2026-08-26 核实代码已完整实现（见下）；之前误标未做 |
| #7 | 待办/任务清单 todo | ✅ | TodoPanel.vue + todoWrite 工具 + todo_update 事件 |
| #8 | 增量文件编辑确认带 diff | ✅ | tool_confirm 事件 + confirm-diff 预览 + 允许/拒绝 |
| #9 | 图像/截图理解 | ✅ | 2026-08-25 实现（见下） |
| #10 | 工具调用回放/重试单条 | ✅ | MessageList 重试按钮 + /api/chat/retry-tool |
| #11 | 流式超时与重连（SSE 断流重连+缓冲） | ✅ | 2026-08-25 实现（见下） |
| #12 | 用量统计页面 | ✅ | 2026-08-25 新建独立 `/usage` 页（见下） |
| #13 | 暗色模式 | ✅ | 2026-08-25 完成全局统一（见下） |
| #14 | Cmd+Enter / Enter 发送 | ✅ | |
| #16 | 首 token 延迟显示 | ✅ | |
| #13b | 代理/网络配置（baseURL、系统代理） | 🗑 已移除 | 用户确认前端 Electron 打包前后端一体，无需自定义地址/代理，从清单删去 |

### 剩余未做：无 ｜ 暂搁置：#4 #5

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

## Electron 桌面打包方案（2026-08-26 决策 + 落地）
- **目标平台**：主要 Windows，兼顾 macOS（Intel x64 + Apple Silicon arm64）。
- **当前约束**：无 Apple Developer 账号、无 Windows 代码签名证书 → Windows 安装包有 SmartScreen 警告可继续；macOS 包无法公证、Gatekeeper 会拦，仅能本机/信任设备自测，不能正常分发。证书配置位已留好，将来补证书即可。
- **构建选型**：`electron-vite`（复用现有 Vite 配置）+ `electron-builder`，**不做自动更新**（electron-updater 可后续接入）。
- **后端处理**：主进程 `fork` 子进程拉起 `server/index.js`（复用 Electron 内置 Node，无需外部 node 二进制）；前端保持 `/api` 相对路径不变，prod 下 Express 同时托管 `dist` 静态（SPA fallback），BrowserWindow 直接 `loadURL(http://localhost:PORT)`，开发模式仍走 Vite dev server（DEV_URL）。
- **Key 策略**：用户已在设置面板自配（存 `~/.code-agent/models.json`），打包**无需**额外 Key 注入逻辑。
- **持久化解耦（方案 X）**：`server/lib/store.js` 的 `DATA_DIR` 优先读 `process.env.CODE_AGENT_DATA_DIR`，回退开发用 `server/data`；主进程打包时设 `CODE_AGENT_DATA_DIR = app.getPath('userData')/code-agent-data`，规避 asar 只读。
- **端口**：`config.js` PORT 默认 3001；主进程 `findFreePort` 探测空闲端口并设 `process.env.PORT` 传给子进程（server `listenWithFallback` 兜底 +1）。
- **asar**：`asar:true` + `asarUnpack: server/**`、`node_modules/**`（ESM server 不能从 asar 内动态加载，必须解包）；dist 留在 asar 内供 Express 只读读取。
- **新增文件**：`electron/main.js`（fork 拉后端+建窗口）、`electron/preload.js`（contextBridge 暴露 isElectron/backendPort）、`electron.vite.config.js`（main/preload/renderer 三端）、`electron-builder.yml`（win nsis + mac dmg x64/arm64）。
- **package.json 改动**：加 `main: out/main.js`、electron 相关 devDeps、脚本 `electron:dev`/`electron:build`(+`:win`/`:mac`)。网页版 `npm run dev:all` 流程不受影响。

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

## 暗色模式根因与修复（2026-08-25）
- 根因 1：项目只用 `ant-design-vue/dist/reset.css`，没用 `ConfigProvider` + `darkAlgorithm`，所有 antdv 组件暗色下仍是浅皮。**修复**：`src/App.vue` 根部包 `a-config-provider :theme="antdTheme"`，`antdTheme` 按 `isDark` 切 `theme.darkAlgorithm` + token（`colorBgContainer:#1e293b`/`colorBorder:#334155` 等，与项目主色调统一）。
- 根因 2：`tailwind.config.js` 缺 `darkMode:'class'`，Tailwind 默认 `media` 策略，`dark:` 变体不响应 `html.dark` 类。**修复**：加 `darkMode:'class'`。
- 根因 3：`.app` 根容器背景用 Less 变量 `@color-bg`（编译期固定浅色），暗色下不切换。**修复**：改 `var(--color-bg)`。
- 项目暗色主色调是深蓝灰：`--color-bg:#0f172a` / `--color-bg-subtle:#1e293b` / `--color-border:#334155`（定义在 `src/assets/theme.css`），不是纯黑。

## #9 图像/截图理解（2026-08-25 实现细节）
- 输入方式：📎 按钮选本地图 + Ctrl+V 粘贴截图（均支持多张）。
- 传输：前端 `FileReader` 读成 dataURL → `POST /api/upload`（JSON `{dataUrl,name,type}`）→ 后端落盘 `server/.uploads/<uuid>.<ext>` → 返回短 URL `/api/upload/<id>`（静态暴露）。前端零新增 npm 依赖（用 `crypto.randomUUID`）。
- 消息结构：`user.content` 有图时改为多模态数组 `[{type:'text',text},{type:'image_url',image_url:{url}},...]`；无图仍是字符串。
- 后端 `toLangchainMessage` 已兼容 `image_url`（HumanMessage 原生支持），**后端 chat 逻辑零改动**。
- 前端改动：`api/agent.js` 新增 `uploadImage`；`ComposerInput.vue`（按钮/粘贴/预览/发送前上传）；`ChatPanel.vue`（send 接收 images、构造多模态 content、estimateTokens 兼容数组）；`MessageList.vue`（气泡渲染文本+缩略图、点击 a-modal 放大）。
- `server/.uploads` 已加 `.gitignore`。
- 注意：需模型本身支持 vision（如 qwen-vl / gpt-4o）；token 估算图片按 1000/张。

## #6 多 Agent 规划模式（plan→execute，2026-08-26 核实已实现）
- 开关：`settings.planMode`（ComposerInput 左侧「计划」按钮）。高级设置：`planTemperature`/`execTemperature`/`subAgentMaxTurns`/`allowReplan`/`subModelKey`/`commandTimeout`。
- 后端 `server/lib/chat.js`：`runPlanAndExecute` 主流程 → `runPlanPhase`（计划阶段：主 Agent 先澄清需求、仅开只读工具 + `planTasks` 工具，调 `planTasks` 收口提交子任务清单）→ `resolvePlanConfirm` 等用户勾选跳过项后执行 → 子 Agent 循环逐条执行（`buildSubAgentSystemPrompt`，专注单任务、可用工具实际写/执行）。
- `planTasks` 工具：结构化提交子任务清单（title/description），normalizePlan 生成 plan-id。
- `/api/chat` 的 `planMode` 分支走 `runPlanAndExecute`；`/chat/plan-confirm` 唤醒挂起进入执行。
- allowReplan：子 Agent 执行中发现必要新增工作可再调 planTasks 追加。
- 规划模型供应商：ModelSettings.vue 内已含「百炼 Coding Plan / Token Plan」「智谱 GLM · Coding Plan」等 baseUrl。

## #11 SSE 断流重连 + 本地缓冲（2026-08-25 实现细节）
- 位置：`src/api/agent.js` 的 `streamChat` 加重连包裹。
- 机制：`runOnce()` 返回 `done`/`error`/`dropped` 三态；外层 `while` 最多 `maxRetries=3` 次，指数退避 `1s/2s/4s`（上限 8s）。`dropped`=网络失败/读流中断/未收[DONE]。`error`（业务/HTTP）不重连。
- 本地缓冲：`onReset?.()` 在重连前清空 assistant 半成品（content/reasoning/toolCalls/firstTokenMs），避免模型重头生成导致内容重复。
- UI：`ChatPanel.vue` 加 `reconnecting` 状态 + 顶部「连接中断，正在重连（第 n/3 次）…」脉冲提示条（样式走主题变量）。
