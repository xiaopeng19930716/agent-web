---
name: model-fetch-refactor
overview: 将模型列表获取功能重构为「3 类型（OpenAI兼容/Anthropic兼容/response原生）全局调用范式 + 预置供应商各自 list 规则」架构：仅预置供应商可拉取模型列表（按其自带规则），自定义供应商不可拉取、仅手动加模型；类型仍由用户在表单里选（影响对话调用范式）。
todos:
  - id: backend-refactor
    content: 重构 server/index.js：删除 5 平台适配器，新增 PRESET_VENDOR_LIST_RULES 并按 vendor 分派 /api/models/fetch
    status: completed
  - id: frontend-api
    content: 修改 src/api/agent.js：将 fetchModelsByBaseUrl 改为 fetchModelsByVendor({vendor,baseUrl,apiKey})
    status: completed
    dependencies:
      - backend-refactor
  - id: ui-refactor
    content: 修改 ModelSettings.vue：3 类型常量、预置供应商 type、获取按钮仅预置显示、fetchModels 传 vendor
    status: completed
    dependencies:
      - frontend-api
---

## 用户需求

在模型设置中，模型（名称/ID/Max Tokens）区块旁边增加「获取模型列表」按钮；用户配置好 Base URL 与 API Key 后，点击按钮即可拉取该供应商支持的模型列表并替换当前模型行。

## 核心功能

- 类型只有 3 种全局调用范式：OpenAI 兼容、Anthropic 兼容、response 原生；不同供应商的 Base URL 各不相同。
- 「获取模型列表的方式」由每个预置供应商自定义（list 接口路径/鉴权/解析规则不同），预置供应商映射到上述 3 种类型之一。
- 仅预置供应商可点击「获取模型列表」；自定义供应商不显示/禁用该按钮，由用户手动添加模型行。
- 拉取成功后清空并替换 modelRows（id 同时作为名称与 ID，maxTokens 留空）；失败时仅提示错误，不破坏已填内容。
- 凭据：Base URL 取表单当前值，API Key 强制取表单 apiKey（忽略默认 Key）。

## 约束

- 仅预置供应商支持获取；自定义供应商手动添加模型。
- 拉取结果替换现有模型行，不做追加。
- 平台类型下拉与 Base URL 同行（a-input-group），切换类型时自动填入该类型默认 Base URL（仅自定义/手动场景；预置供应商锁定其类型）。

## 技术栈

- 前端：Vue 3 `<script setup>` + Tailwind CSS + Ant Design Vue（a-input-group / a-select / a-input，项目已全局注册）
- 后端：Node.js + Express（ESM，原生 fetch / AbortController，既有模式）
- 通信：Vite 代理 `/api/*` -> `:3001`（既有，无需改动）

## 实现方案

将当前「按 5 平台分派」重构为「3 类型 + 预置供应商各自 list 规则」两层模型：

1. 后端 `POST /api/models/fetch` 入参改为 `{ vendor, baseUrl, apiKey }`。vendor 为预置供应商 key；非预置供应商直接返回「该供应商不支持获取模型列表」。后端维护 `PRESET_VENDOR_LIST_RULES`（key -> { type, listPath, auth, parse }），按 vendor 取出规则后拼接 `baseUrl + listPath`，携带对应鉴权头请求，解析返回模型数组。3 类型仅作为规则内的范式枚举（openai / anthropic / native），用于区分鉴权与解析；anthropic 类型无 list 接口时回退内置常量。
2. 前端 `PRESET_VENDORS` 内联每个预置供应商的 `type`（3 选一）与 `fetchRule`（listPath/auth/parse 标识），并通过常量映射 3 类型默认 Base URL。自定义供应商只能从 3 类型下拉选择（影响对话调用范式）。
3. 按钮逻辑：仅当 `activeKey` 为预置供应商 key 时启用「获取模型列表」；自定义供应商隐藏该按钮并提示「自定义供应商请手动添加模型」。

### 关键技术决策

- 后端按 vendor 分派而非前端：避免各供应商 list 细节（路径/鉴权）暴露在前端，且与项目既有「后端代理调用」模式一致（如 /api/mcp/test、/api/chat）。
- 3 类型作为范式枚举而非独立适配器：类型决定通用鉴权/解析骨架，供应商规则补充差异（如百炼走 openai 范式但 baseURL 已是 compatible-mode/v1）。
- 预置供应商锁定类型：选中即锁定其 `type`，用户不能改；自定义供应商才允许手选类型并自动填默认 Base URL。
- 替换而非追加：清空 modelRows 后用拉取结果重建，至少保留一行空行兜底，保证 save() 校验不受影响。
- 超时与兜底：复用 AbortController 5s 超时；非 200/超时/异常返回可读错误，前端仅提示不覆盖现有行。

## 实现要点

### 后端 server/index.js

- 删除现有 `MODEL_LIST_ADAPTERS`（5 平台）与 `/api/models/fetch` 的 platform 分派逻辑（约 390-498 行）。
- 新增 `PRESET_VENDOR_LIST_RULES`：
- `bailian-coding`/`bailian-token`：type=openai, listPath=`/models`, auth=bearer, parse=data[].id
- `deepseek`：type=openai, listPath=`/models`, auth=bearer
- `zhipu`/`zhipu-token`：type=openai, listPath=`/models`
- `tencent`：type=openai, listPath=`/models`
- （如后续加入 anthropic/native 预置，则其 type 对应回退或原生解析）
- 新 `/api/models/fetch`：
- 校验 vendor 在 `PRESET_VENDOR_LIST_RULES`；否则 400 `{ error: '该供应商不支持获取模型列表' }`
- 按规则 `buildUrl = baseUrl.replace(/\/+$/,'') + listPath`；headers 按 auth（bearer 用 `Authorization: Bearer key`）
- 5s 超时 fetch；解析 `json.data`（openai）或规则指定的字段；映射 `{id, name}`
- anthropic 类型（无 list）直接返回内置常量列表，不发起请求
- catch 返回 `{ error }`

### 前端 src/api/agent.js

- `fetchModelsByBaseUrl` 改签名为 `fetchModelsByVendor({ vendor, baseUrl, apiKey })`，POST `/api/models/fetch` 传 `{ vendor, baseUrl, apiKey }`，错误兜底返回 `{ models: [], error }`。

### 前端 src/components/ModelSettings.vue

- `PRESET_VENDORS` 每项加 `type`（openai/anthropic/native 之一，当前 6 个均为 openai）。
- 新增 `TYPE_OPTIONS = [{label:'OpenAI 兼容',value:'openai'},{label:'Anthropic 兼容',value:'anthropic'},{label:'原生接口',value:'native'}]`
- `TYPE_DEFAULT_BASEURL = { openai:'', anthropic:'', native:'' }`（openai 留空让用户填；anthropic/native 可留空或给示例）
- 删除 `PLATFORM_OPTIONS` / `PLATFORM_DEFAULT_BASEURL` / `PRESET_VENDOR_PLATFORM` 旧常量，改为从 `PRESET_VENDORS` 读 `type`。
- `form` 保留 `platform` 字段（表示当前类型，预置锁定、自定义可选）。
- `selectVendor`：预置时 `platform = vendor.type` 并锁定；`__new__` 时 `platform='openai'`。
- `onPlatformChange`：仅自定义场景填默认 Base URL（预置供应商不触发或忽略）。
- 模板 Base URL 行：`a-input-group` 左 `a-select`(v-model platform, :disabled=isPreset) + 右 `a-input`(:disabled when anthropic 或 isPreset 且 type 不需要)。
- 「获取模型列表」按钮：`v-if="!isCustomVendor"`（即仅预置显示），点击调用 `fetchModels`；自定义供应商区域显示提示文字「自定义供应商请手动添加模型行」。
- `fetchModels`：仅预置可调用；校验 baseURL（native/anthropic 按规则）；调用 `fetchModelsByVendor({ vendor: activeKey, baseUrl, apiKey })`；成功替换 modelRows。

## 架构设计

保持现有分层：组件 -> src/api/agent.js -> 后端 server/index.js 路由。无新增文件、无新架构模式。后端 list 规则以内置常量表维护，便于后续扩充预置供应商。

## 目录结构

```
src/
├── components/
│   └── ModelSettings.vue   # [MODIFY] PRESET_VENDORS 加 type；3 类型常量；selectVendor/onPlatformChange 调整；模板 a-input-group 按是否预置禁用；获取按钮仅预置显示；fetchModels 改传 vendor
└── api/
    └── agent.js            # [MODIFY] fetchModelsByVendor({vendor,baseUrl,apiKey}) 替换旧 fetchModelsByBaseUrl
server/
└── index.js               # [MODIFY] 删除 5 平台 MODEL_LIST_ADAPTERS；新增 PRESET_VENDOR_LIST_RULES；/api/models/fetch 改为按 vendor 分派
```