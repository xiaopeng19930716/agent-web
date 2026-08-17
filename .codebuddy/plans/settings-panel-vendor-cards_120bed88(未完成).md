---
name: settings-panel-vendor-cards
overview: 重构模型设置页：顶部以卡片列表形式展示各供应商（含自定义配置），点击卡片展开/切换到下方配置表单；下部为选中供应商的配置表单（基础 URL / 模型名称 / 模型 ID / API 密钥），保存后把供应商 key 记入「已配置集合」，顶部对应卡片显示「已配置 ✓」。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 卡片式
    - 简洁明亮
    - 企业级
    - 状态徽标
  fontSystem:
    fontFamily: system-ui
    heading:
      size: 22px
      weight: 700
    subheading:
      size: 16px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#2563eb"
    background:
      - "#f9fafb"
      - "#ffffff"
    text:
      - "#1f2937"
      - "#6b7280"
    functional:
      - "#16a34a"
      - "#dc2626"
      - "#9ca3af"
todos:
  - id: extend-settings
    content: 在 settings.js 的 defaults 增加 configuredVendors 并在 load/reset 兼容
    status: pending
  - id: refactor-top-cards
    content: 将 SettingsPanel 顶部改为供应商卡片列表，含已配置徽标与选中态
    status: pending
    dependencies:
      - extend-settings
  - id: refactor-form
    content: 重构下部供应商配置表单并保留连续添加逻辑
    status: pending
    dependencies:
      - refactor-top-cards
  - id: record-vendor
    content: 在 addModel 中将供应商 key 推入 configuredVendors 并保存
    status: pending
    dependencies:
      - refactor-form
  - id: add-styles
    content: 补充 vendor-card 等样式并保持视觉一致
    status: pending
    dependencies:
      - refactor-top-cards
      - refactor-form
  - id: verify
    content: 运行 lint 检查并提醒用户强刷验证
    status: pending
    dependencies:
      - add-styles
      - record-vendor
---

## 产品概述

重构模型设置页，整体划分为两大区块：顶部「添加供应商」卡片列表、下部「供应商配置」表单。

## 核心功能

- 顶部区块以卡片列表展示所有供应商（自定义配置、阿里云百炼编程、百炼通义、DeepSeek、智谱 GLM、腾讯混元）。未配置卡片显示「+ 配置」入口，已配置卡片显示「已配置 ✓」徽标。
- 点击供应商卡片，选中该供应商并在下部展示对应配置表单。
- 下部「供应商配置」表单包含：基础 URL、模型名称、模型 ID、API 密钥（显示/隐藏切换、可勾选使用默认 Key）。
- 点击「保存」将模型加入已添加列表并写入 localStorage；同一供应商可连续添加多个模型，保存后保留 Base URL 与 Key，仅清空名称/ID。
- 每次保存把当前供应商 key 记录到 settings 的已配置集合，顶部对应卡片即时显示「已配置」标记。
- 保留已添加模型列表、模型切换/删除、温度设置、整体保存与恢复默认。

## 技术栈

- 前端：Vue 3 + Vite + `<script setup>` Composition API（沿用现有项目）
- 状态：src/settings.js 导出 reactive 全局 settings 对象（localStorage 持久化）
- 样式：组件内 scoped CSS（沿用现有风格，不引入新 UI 库）

## 实现方案

### 数据模型扩展

在 `src/settings.js` 的 `defaults` 增加 `configuredVendors: []`；`load()` 读取并兼容旧数据；`resetSettings()` 复位该字段。模型对象结构 `{ id, name, baseUrl, apiKey }` 不变。

### 组件重构（SettingsPanel.vue）

- 顶部：将现有 `.vendor-tabs` 标签切换改为 `.vendor-card` 卡片列表，`v-for="v in VENDORS"`，每张卡片显示供应商名称；未配置显示「+ 配置」，已配置显示「已配置 ✓」徽标（依据 `settings.configuredVendors.includes(v.key)`）。点击卡片设置 `activeVendorKey`。
- 下部：保留 config-card 表单（基础 URL / 模型名称 / 模型 ID / API 密钥），标题为当前供应商名。
- 逻辑：新增 `isVendorConfigured(key)` computed/函数；`addModel()` 在 push 模型后，将 `activeVendor.value.key` 去重推入 `settings.configuredVendors` 并 `saveSettings()`。
- 迁移兼容：`settings.js` 的 `normalizeModels` 与 `load` 已处理 models；configuredVendors 仅做数组兜底。

### 关键决策

- 已配置判定按「供应商 key 集合」而非 baseUrl 匹配，符合用户确认，逻辑简单且无歧义。
- 卡片列表替代标签，满足用户视觉诉求；交互仍为点击选中，下部表单复用，避免重复代码。
- 保留 `addSuccess` 提示与连续添加体验（上次已落地，仅整合到新布局）。

### 性能与可靠性

- 仅前端响应式更新，无网络开销；computed 派生避免冗余渲染。
- 保存即时写入 localStorage，刷新不丢；reset 清空 configuredVendors。
- 模型 id 重复校验防止脏数据。

## 实现注意事项

- 沿用现有 `.card / .field / .add-form__row / .btn` 样式，新增 `.vendor-card` 系列样式保持视觉一致。
- 不改动后端 server、ChatPanel、App.vue 等其他模块，控制改动面。
- 执行后提醒用户 `Ctrl+F5` 强刷并确认 dev server 运行。

## 目录结构

```
src/
├── settings.js                  # [MODIFY] defaults 增加 configuredVendors: []；load/reset 兼容
└── components/
    └── SettingsPanel.vue        # [MODIFY] 顶部卡片列表 + 下部表单；addModel 记录 key；样式新增
```

## 架构设计

- 数据流向：用户点击卡片 → activeVendorKey 更新 → 下部表单绑定 form（Base URL 自动带出供应商默认） → 填名称/ID/Key → 保存 → settings.models.push + configuredVendors.push + saveSettings() → 顶部卡片徽标响应式更新。
- 组件内 state：activeVendorKey、form、addError、addSuccess；全局 state：settings（reactive）。

## 关键代码结构

```js
// settings.js defaults 片段
const defaults = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  models: [{ id: 'qwen-coder-plus', name: 'Qwen Coder Plus' }],
  activeModel: 'qwen-coder-plus',
  temperature: 0.3,
  configuredVendors: [], // 新增：已配置供应商 key 集合
}
```

## 设计风格

采用简洁明亮的企业级卡片式布局。页面分为上下两大区块：顶部为供应商卡片网格（未配置显示「+ 配置」幽灵按钮风格，已配置显示蓝色「已配置 ✓」徽标），下部为白色圆角配置卡片，内含基础 URL、模型名称、模型 ID、API 密钥输入框与保存按钮。整体留白充足、层次清晰、交互反馈明确。

## 页面区块

- 顶部「添加供应商」：卡片列表（grid 自适应），每张卡显示供应商名 + 状态标记，点击选中并高亮边框。
- 下部「供应商配置」：标题显示当前供应商；表单字段纵向排列，API 密钥行含显示/隐藏按钮；底部保存按钮 + 成功提示。
- 已添加模型：列表卡片，含使用/删除操作。
- 温度与全局保存：底部卡片。

## 交互

- 卡片 hover 轻微上浮/边框变色；选中卡片蓝色边框。
- 保存后绿色成功提示 2 秒自动消失；顶部徽标即时点亮。