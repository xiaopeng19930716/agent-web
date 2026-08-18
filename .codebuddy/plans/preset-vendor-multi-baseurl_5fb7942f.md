---
name: preset-vendor-multi-baseurl
overview: 为 5 个预置供应商补充按类型区分的预设 Base URL，切换类型时自动填入对应预设地址；后端按类型决定 list path，Anthropic/原生类型提示暂不支持自动获取；删除无数据的 zhipu-token。
todos:
  - id: update-preset-vendors
    content: 修改 ModelSettings.vue 的 PRESET_VENDORS 为 baseUrls 映射并删除 zhipu-token
    status: completed
  - id: add-helpers
    content: 新增 presetBaseUrl/firstNonEmptyType 辅助函数
    status: completed
    dependencies:
      - update-preset-vendors
  - id: update-select-onplatform
    content: 更新 selectVendor 与 onPlatformChange 按类型取预设 Base URL
    status: completed
    dependencies:
      - add-helpers
  - id: guard-fetch-models
    content: fetchModels 增加非 openai 类型提示守卫
    status: completed
    dependencies:
      - add-helpers
  - id: update-backend-rules
    content: server/index.js 的 PRESET_VENDOR_LIST_RULES 改 listPaths 并按类型取路径、删 zhipu-token
    status: completed
  - id: verify-lint
    content: 运行 lint 与 node --check 校验前后端无错误
    status: completed
    dependencies:
      - update-preset-vendors
      - add-helpers
      - update-select-onplatform
      - guard-fetch-models
      - update-backend-rules
---

## 用户需求

为每个预置供应商补充按类型区分的预设 Base URL，并实现切换类型时自动填入对应预设地址。

## 产品概述

模型设置面板中，每个预置供应商在 OpenAI 兼容 / Anthropic 兼容 / 原生接口三种类型下均预设了对应的 Base URL（数据由用户提供）。前端在选中供应商或切换类型时，自动将 Base URL 填入该供应商当前类型的预设地址（覆盖原内容，用户可手动改）；后端按类型决定模型列表拉取路径。

## 核心功能

- 预置供应商列表改为携带 `baseUrls: { openai, anthropic, native }`，填入用户提供的各协议地址。
- 选中预置供应商时，按当前类型自动填入对应预设 Base URL。
- 切换类型下拉时，Base URL 立即被当前供应商该类型的预设地址覆盖（无预设则回落类型默认或留空）。
- 删除无数据的 `zhipu-token` 供应商。
- 类型下拉三选项全显示；选中无预设的类型时 Base URL 留空供手填。
- 点击「获取模型列表」时：仅 OpenAI 兼容类型真正拉取；Anthropic / 原生类型弹 message 提示"该类型暂不支持自动获取"。
- 后端 `PRESET_VENDOR_LIST_RULES` 按类型决定 list path，并删除 zhipu-token 规则。

## 技术栈

- 前端：Vue 3 `<script setup>` + Ant Design Vue（a-select / a-input / a-input-password / a-input-number 已全局注册）
- 后端：Node.js + Express（原生 fetch + AbortController）
- 无新增依赖、无新增文件、不改持久化结构

## 实现方案

### 策略

将 `PRESET_VENDORS` 从单 `baseUrl + type` 升级为 `baseUrls: { openai, anthropic, native }` 映射；新增 `presetBaseUrl(vendor, type)` 辅助函数；`selectVendor` 与 `onPlatformChange` 统一按"预置优先、回落类型默认"取地址。`fetchModels` 增加类型守卫。后端把 `PRESET_VENDOR_LIST_RULES` 的 `listPath` 改为 `listPaths: { openai, anthropic, native }`，按 `form.platform` 取路径。

### 关键技术决策

- 保留 `TYPE_DEFAULT_BASEURL` 作自定义/无预设兜底层（openai: `https://api.openai.com/v1`，其余空）。
- 预置供应商默认类型取 `baseUrls` 第一个非空 key（优先 openai），保证首次选中即有合理地址。
- 类型下拉全显示（决策点1），无预设类型选中时 Base URL 留空（不禁用、不隐藏，符合用户确认）。
- 获取列表仅 openai 放行，anthropic/native 走 message 提示（决策点2），避免无标准接口导致 404 噪音。
- 后端 list path 按类型：openai→`/models`，anthropic→`/v1/messages`（探测式，实际无 list，但保留路径以便将来扩展），native→供应商规则路径；anthropic/native 在前端已拦截，后端仅作兜底。

### 性能与可靠性

- 纯前端常量映射，无网络/计算开销；`computed` 仅在依赖变化时重算。
- 后端改动为零新增 IO，沿用既有 5s 超时与错误兜底，不影响其他接口。
- 向后兼容：自定义供应商、`settings.js` 持久化结构均不变；旧 `zhipu-token` 配置项因前端删除 key，后端规则同步删除，无残留引用。

## 实现要点

- `onPlatformChange`：当前已改为始终覆盖，仅将数据源从 `TYPE_DEFAULT_BASEURL[platform]` 改为 `presetBaseUrl(activeVendor, platform) || TYPE_DEFAULT_BASEURL[platform] || ''`。
- `selectVendor`：预置分支计算 `platform = firstNonEmptyType(vendor.baseUrls)`，再 `baseUrl = presetBaseUrl(vendor, platform)`；`__new__` 分支维持 platform='openai' + 类型默认。
- `fetchModels`：开头加 `if (form.platform !== 'openai') { message.error('该类型暂不支持自动获取'); return }`。
- 后端 `PRESET_VENDOR_LIST_RULES`：每项为 `{ type, listPaths: { openai, anthropic, native } }`；`/api/models/fetch` 用 `rule.listPaths[req.body.type || rule.type]` 取路径（缺省回退 rule.type）。
- 删除 `zhipu-token` 前后端条目；`PRESET_VENDOR_KEYS` 自动随 `PRESET_VENDORS` 推导，无需手改。

## 架构设计

前端 `ModelSettings.vue` 内部常量与函数闭环，不改动 `settings.js` / `agent.js` 契约（仍传 `{vendor, baseUrl, apiKey}`，新增携带 `type` 仅后端按需读取，前端可传可不传，保持兼容）。后端仅扩展 `PRESET_VENDOR_LIST_RULES` 结构，接口入参向后兼容。

## 目录结构

```
src/
└── components/
    └── ModelSettings.vue   # [MODIFY] PRESET_VENDORS 加 baseUrls；新增 presetBaseUrl/firstNonEmptyType；selectVendor/onPlatformChange 按类型取预设；fetchModels 加类型守卫
server/
└── index.js                # [MODIFY] PRESET_VENDOR_LIST_RULES 改为 listPaths 按类型；删除 zhipu-token 规则；/api/models/fetch 按类型取路径
```

## 关键代码结构

```js
// ModelSettings.vue 预设供应商结构
const PRESET_VENDORS = [
  { key: 'bailian-coding', name: '阿里云百炼 · Coding Plan',
    baseUrls: { openai: 'https://coding.dashscope.aliyuncs.com/v1',
                anthropic: 'https://coding.dashscope.aliyuncs.com/apps/anthropic', native: '' } },
  { key: 'bailian-token', name: '阿里云百炼 · Token Plan',
    baseUrls: { openai: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
                anthropic: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic', native: '' } },
  { key: 'deepseek', name: 'DeepSeek',
    baseUrls: { openai: 'https://api.deepseek.com',
                anthropic: 'https://api.deepseek.com/anthropic', native: '' } },
  { key: 'zhipu', name: '智谱 GLM · Coding Plan',
    baseUrls: { openai: 'https://open.bigmodel.cn/api/coding/paas/v4',
                anthropic: 'https://open.bigmodel.cn/api/anthropic',
                native: 'https://open.bigmodel.cn/api/v1' } },
  { key: 'tencent', name: '腾讯混元 · Coding',
    baseUrls: { openai: 'https://api.lkeap.cloud.tencent.com/coding/v3',
                anthropic: 'https://api.lkeap.cloud.tencent.com/coding/anthropic', native: '' } },
]

// 后端 PRESET_VENDOR_LIST_RULES 结构
const PRESET_VENDOR_LIST_RULES = {
  'bailian-coding': { type: 'openai', listPaths: { openai: '/models', anthropic: '/v1/messages', native: '' } },
  'bailian-token': { type: 'openai', listPaths: { openai: '/models', anthropic: '/v1/messages', native: '' } },
  deepseek:        { type: 'openai', listPaths: { openai: '/models', anthropic: '/v1/messages', native: '' } },
  zhipu:           { type: 'openai', listPaths: { openai: '/models', anthropic: '/v1/messages', native: '/v1/models' } },
  tencent:         { type: 'openai', listPaths: { openai: '/models', anthropic: '/v1/messages', native: '' } },
}
```