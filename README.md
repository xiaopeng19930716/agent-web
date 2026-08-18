# Agent Web

一个 AI 编程助手 Web 界面，支持聊天、模型/MCP/Skills 配置，并能从本机其他 Agent（Claude Code、Cursor、Windsurf、CodeBuddy 等）已配置的内容中**按需导入**指定的 MCP Server 与 Skills。

## 架构

项目为前后端分离：

| 服务 | 技术 | 端口 | 职责 |
| --- | --- | --- | --- |
| 前端 | Vue 3 + Vite + Ant Design Vue | `:5173` | 界面与交互 |
| 后端 | Express + LangChain | `:3001` | 大模型对话、扫描/测试/导入 MCP 与 Skills |

前端通过 Vite 代理将 `/api/*` 请求转发到后端 `:3001`。**必须同时运行两个服务**，否则会出现 502（前端能打开但接口不可用）。

## 快速开始

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

## 环境变量（后端）

后端默认从 `:3001` 提供接口。对话功能需要大模型 API Key，复制 `.env.example` 为 `.env` 并填写：

```bash
cp .env.example .env
```

（百炼/通义千问 Key 等，详见 `.env.example`）

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 仅启动前端 |
| `npm run server` | 仅启动后端 |
| `npm run dev:all` | 同时启动前后端 |
| `npm run build` | 构建前端产物到 `dist/` |
| `npm run preview` | 预览构建产物 |

## 功能说明

- **模型配置**：多供应商卡片，每个模型可配置 Max Tokens
- **MCP Server**：增删改查、启用开关、stdio/http/sse 类型与连接测试
- **Skills**：扫描本地技能目录，启用/禁用；支持从其他 Agent 目录导入并自动启用
- **从其他 Agent 导入**：扫描 Claude Code、Cursor、Windsurf、CodeBuddy、Roo Code 等已配置的 MCP 与 `~/.agents`、`~/.claude`、`~/.codebuddy`、`~/.cursor` 等目录下的 Skills，可勾选指定项导入（非全量）
