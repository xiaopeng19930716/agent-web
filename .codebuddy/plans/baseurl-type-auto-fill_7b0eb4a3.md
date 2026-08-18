---
name: baseurl-type-auto-fill
overview: 将 ModelSettings.vue 的 onPlatformChange 改为：切换 Base URL 类型时始终自动填入该类型对应的默认 Base URL（覆盖已填内容），便于后续逐个供应商替换具体地址。
todos:
  - id: fix-onplatformchange
    content: 修改 ModelSettings.vue 的 onPlatformChange，去掉空值判断使切换类型始终自动填入默认 Base URL
    status: completed
---

## 用户需求

在 ModelSettings.vue 中，切换「类型」（OpenAI 兼容 / Anthropic 兼容 / 原生接口）时，始终自动将 Base URL 输入框填入该类型对应的默认地址（覆盖当前已填内容），便于后续逐个供应商替换具体 baseURL。

## 核心功能

- 类型下拉切换时，Base URL 立即被该类型默认地址覆盖（无视原有内容）。
- 用户仍可手动修改 Base URL。
- 各供应商具体 baseURL 由用户稍后补充，本次仅完成类型级自动填入逻辑，不改动默认值具体内容。

## 技术栈

- 前端：Vue 3 `<script setup>` + Ant Design Vue（a-select / a-input 组合已全局注册）
- 无后端改动、无新增文件

## 实现方案

仅修改 `src/components/ModelSettings.vue` 中的 `onPlatformChange` 函数。

当前逻辑（第 73-77 行）：

```js
function onPlatformChange() {
  const def = TYPE_DEFAULT_BASEURL[form.platform]
  if (def !== undefined && !form.baseUrl.trim()) form.baseUrl = def
}
```

问题：仅在 Base URL 为空时才填默认，切换类型不会覆盖已填内容。

改为「始终覆盖」：

```js
function onPlatformChange() {
  const def = TYPE_DEFAULT_BASEURL[form.platform]
  if (def !== undefined) form.baseUrl = def
}
```

`TYPE_DEFAULT_BASEURL` 维持现状（openai 为 `https://api.openai.com/v1`，anthropic/native 暂为空字符串），后续用户补充供应商级 baseURL 时再扩展映射，本次不动。

## 实现要点

- 改动范围极小，仅删除 `&& !form.baseUrl.trim()` 条件判断。
- `selectVendor` 选中预置供应商时仍按其自带 baseUrl 填值（独立逻辑，不受影响）。
- 模板中 `a-input` 与类型下拉同属 `a-input-group`，v-model 绑定 `form.baseUrl`，赋值即时反映。
- 无性能/安全/依赖影响，符合现有组件模式。

## 目录结构

```
src/
└── components/
    └── ModelSettings.vue   # [MODIFY] onPlatformChange 去掉空值判断，切换类型始终覆盖 baseUrl
```