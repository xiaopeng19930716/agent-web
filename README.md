# Agent Web

一个 AI 编程助手 Web 界面，支持聊天、模型/MCP/Skills 配置，并能从本机其他 Agent（Claude Code、Cursor、Windsurf、CodeBuddy 等）已配置的内容中**按需导入**指定的 MCP Server 与 Skills。

既可纯网页运行，也可打包为桌面应用（Windows / macOS）。

## 架构

### 网页版（前后端分离）

| 服务 | 技术 | 端口 | 职责 |
| --- | --- | --- | --- |
| 前端 | Vue 3 + Vite + Ant Design Vue | `:5173` | 界面与交互 |
| 后端 | Express + LangChain | `:3001` | 大模型对话、扫描/测试/导入 MCP 与 Skills |

前端通过 Vite 代理将 `/api/*` 请求转发到后端 `:3001`。**必须同时运行两个服务**，否则会出现 502（前端能打开但接口不可用）。

### 桌面版（Electron，可选）

使用 `electron-vite` + `electron-builder` 打包：

- 主进程 `fork` 一个子进程拉起 `server/index.js`（复用 Electron 内置 Node，无需本机另装 Node）。
- 生产环境下 Express 同时托管前端 `dist` 并接管路由，渲染进程直接访问 `http://localhost:<端口>`，前端代码与网页版完全一致（请求仍走相对路径 `/api`）。
- 数据持久化目录（项目/会话）在打包后写入用户目录（`userData/code-agent-data`），避免写入只读的 asar 包。

> 平台支持：主要面向 Windows；macOS 同时构建 Intel(`x64`) 与 Apple Silicon(`arm64`)。
> 当前仓库**未配置代码签名证书与 Apple 公证**：Windows 安装包会提示 SmartScreen 未知发布者（可继续安装）；macOS 包会被 Gatekeeper 拦截，仅能在已信任的开发机上自测。后续补证书即可正常分发。

## 快速开始（网页版）

### 方式一：一条命令同时启动（推荐）

```bash
npm install
npm run dev:all
```

终端会同时拉起前端（`web`）和后端（`api`）。看到以下输出即成功：

- 前端：`Local: http://localhost:5173/`
- 后端：`Code Agent 后端已启动: http://localhost:3001`

浏览器打开 `http://localhost:5173` 即可。

### 方式二：分两个终端

**终端 A — 后端**
```bash
npm run server
```

**终端 B — 前端**
```bash
npm run dev
```

## 桌面端开发 / 打包

```bash
# 开发模式：启动 Electron 窗口（前端走 Vite dev server，需先保证后端可起）
npm run electron:dev

# 构建并打包（自动按当前平台选择）
npm run electron:build

# 仅打 Windows 安装包（NSIS）
npm run electron:build:win

# 仅打 macOS 双架构包（dmg）
npm run electron:build:mac
```

产物输出到 `release/` 目录。

`electron:dev` 模式下主进程会自动 `fork` 后端子进程；若你已手动 `npm run dev:all` 启动了后端，Electron 会复用已存在的端口（主进程会探测空闲端口，避免冲突）。

## API Key 配置（重要）

**不需要**在仓库里配置 `.env` 环境变量。API Key 由用户在应用内「设置 → 模型供应商」面板填写并保存到本机配置文件（位于 `~/.code-agent/models.json`），不会写入代码或环境变量，避免密钥泄露。首次使用前请先在设置面板配置好可用的供应商 Key 与模型。

> 端口默认 `3001`，若被占用后端会自动顺延到下一个空闲端口。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 仅启动前端 |
| `npm run server` | 仅启动后端 |
| `npm run dev:all` | 同时启动前后端（网页版推荐） |
| `npm run build` | 构建前端产物到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run electron:dev` | Electron 开发模式 |
| `npm run electron:build` | 打包当前平台桌面应用 |
| `npm run electron:build:win` | 打包 Windows 安装包 |
| `npm run electron:build:mac` | 打包 macOS 双架构包 |

## 功能说明

- **模型配置**：多供应商卡片，每个模型可配置 Max Tokens、baseURL、API Key（在设置面板填写，存本机）
- **MCP Server**：增删改查、启用开关、stdio/http/sse 类型与连接测试
- **Skills**：扫描本地技能目录，启用/禁用；支持从其他 Agent 目录导入并自动启用
- **从其他 Agent 导入**：扫描 Claude Code、Cursor、Windsurf、CodeBuddy、Roo Code 等已配置的 MCP 与 `~/.agents`、`~/.claude`、`~/.codebuddy`、`~/.cursor` 等目录下的 Skills，可勾选指定项导入（非全量）
- **多 Agent 规划模式**：计划 → 执行编排（plan→execute），支持子 Agent、重规划
- **工具确认闸门**：高风险文件/命令操作前弹 diff 预览，用户允许/拒绝
- **流式重连**：SSE 断流自动重连与本地缓冲，避免内容重复
- **用量统计**：独立 `/usage` 页，按厂商/模型/天展示调用次数与 Token
- **图片理解**：支持粘贴/选择本地图片，随对话发送给支持视觉的模型
