---
name: settings-vendor-cards-final
overview: 重构设置页（Tailwind + ant-design-vue）：顶部供应商卡片列表（预设+自定义，已配置「已配置 ✓」），下部三行统一配置表单（名称+官网 / BaseURL+APIKey / 多组模型名称+ID），保存后转只读模式（官网链接可跳转）。模型在各供应商配置内展示，移除底部「已添加模型列表」与温度设置。主要模型复用 activeModel。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 卡片式
    - 简洁明亮
    - 企业级
    - 状态徽标
    - 只读展示
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
  - id: install-deps
    content: 安装 tailwindcss/postcss/autoprefixer/ant-design-vue 并初始化配置与 main.js
    status: completed
  - id: extend-settings
    content: 在 settings.js 的 defaults 增加 configuredVendors 与 customVendors，模型加 vendorKey，load/reset 兼容
    status: completed
    dependencies:
      - install-deps
  - id: refactor-top-cards
    content: 将 SettingsPanel 顶部改为供应商卡片列表，含已配置徽标、选中态与添加自定义供应商入口
    status: completed
    dependencies:
      - extend-settings
  - id: refactor-form
    content: 重构下部三行统一配置表单，支持编辑/只读双态与多组模型行
    status: completed
    dependencies:
      - refactor-top-cards
  - id: vendor-models
    content: 在各供应商配置内展示其归属模型列表（使用/删除），移除底部独立列表与温度
    status: completed
    dependencies:
      - refactor-form
  - id: add-custom-vendor
    content: 实现添加自定义供应商保存逻辑（名称/官网/BaseURL/Key/多组模型）
    status: completed
    dependencies:
      - refactor-form
  - id: record-vendor
    content: 在 saveVendor 中将供应商 key 推入 configuredVendors 并 saveSettings
    status: completed
    dependencies:
      - refactor-form
  - id: add-styles
    content: 补充 Tailwind/antd 卡片等样式并保持视觉一致
    status: completed
    dependencies:
      - refactor-top-cards
      - refactor-form
  - id: verify
    content: 用 [skill:eslint-checker] 检查并提醒用户重启 dev server 强刷验证
    status: completed
    dependencies:
      - add-styles
      - record-vendor
      - add-custom-vendor
      - vendor-models
---

## 产品概述

重构模型设置页为上下两大区块：顶部「添加供应商」卡片列表，下部「供应商配置」统一表单。预设供应商与自定义供应商走同一套可编辑配置；保存后该供应商进入只读模式，官网链接可点击跳转。已添加模型在各供应商配置内展示，移除底部独立模型列表与温度设置。

## 核心功能

- 顶部卡片列表：展示预设供应商（自定义配置、阿里云百炼编程、百炼通义、DeepSeek、智谱 GLM、腾讯混元）与用户自定义供应商；未配置显示「+ 配置」，已配置显示「已配置 ✓」；点击选中高亮并切换下部表单；末尾「+ 添加自定义供应商」入口。
- 下部统一三行配置表单：
- 第一行：供应商名称（必填）+ 供应商官网（选填，仅展示）。
- 第二行：Base URL + API Key（含显示/隐藏、可勾选使用默认 Key）。
- 第三行及以后：模型名称 + 模型 ID，可连续添加多组，每组可删除。
- 只读模式：供应商保存后，下方所有字段 disabled 只读展示，官网渲染为可点击链接（target=_blank）；未填官网则不显示链接。
- 已配置判定：按供应商 key 记录到 settings.configuredVendors，每次保存推入。
- 添加自定义供应商：名称必填、官网选填、Base URL、API Key、模型（多组）；保存后进入顶部卡片列表并标记已配置。
- 各供应商配置内展示其下模型列表，支持「使用」（设主要模型，复用 settings.activeModel）与删除。
- 移除底部「已添加模型」独立列表卡片与温度设置滑块。

## 技术栈

- 前端：Vue 3 + Vite（v8）+ `<script setup>` Composition API（沿用现有项目）
- UI 框架：ant-design-vue（全量注册）+ Tailwind CSS 3.4.17（按用户要求安装）
- 状态：src/settings.js 导出 reactive 全局 settings 对象（localStorage 持久化）
- 样式：Tailwind 工具类 + 少量 scoped 样式，ant-design-vue reset.css

## 实现方案

### 依赖与配置安装

- 安装 tailwindcss@3.4.17、postcss@8、autoprefixer@^10.4.20、ant-design-vue、@ant-design/icons-vue。
- 新增 `tailwind.config.js`（content 指向 index.html 与 src/**/*.{vue,js}）、`postcss.config.js`、`src/style.css`（含 @tailwind 指令）。
- `src/main.js`：引入 `ant-design-vue/dist/reset.css` 与 `./style.css`，全量 `app.use(Antd)`。

### 数据模型扩展（settings.js）

- defaults 增加 `configuredVendors: []`（已配置 key 集合）与 `customVendors: []`（{key,name,website,baseUrl}）。
- 模型对象增加 `vendorKey` 字段用于归属过滤：`{id,name,baseUrl,apiKey,vendorKey}`。
- load() 对两字段做数组兜底；resetSettings() 复位两者。temperature 字段保留但 UI 不再渲染。

### 组件重构（SettingsPanel.vue）

- 数据源：`allVendors = computed(() => [...VENDORS, ...settings.customVendors.map(v => ({...v, isCustomVendor:true}))])`。
- 顶部卡片网格：用 a-card / Tailwind 自绘卡片，`v-for="v in allVendors"`，显示名称 + 状态徽标（`settings.configuredVendors.includes(v.key)`）；点击设 activeVendorKey；末尾「+ 添加自定义供应商」卡片进新建态。
- 下部表单（Tailwind 三行布局，原生 input，不模拟 input）：
- 编辑态：
    - 第一行：名称 input(必填) + 官网 input(选填)
    - 第二行：Base URL input + API Key input（显示/隐藏切换 + a-checkbox 勾选使用默认 Key）
    - 第三行起：`v-for="(row,i) in modelRows"` 每行 模型名称 + 模型 ID + 删除按钮；底部「+ 添加模型行」
- 只读态（key 在 configuredVendors）：所有 input disabled；官网 `<a :href="website" target="_blank" rel="noopener">`；模型用 a-list 只读展示。
- 每个供应商配置内展示其归属模型：`settings.models.filter(m => m.vendorKey === activeVendor.key)`，含「使用」(setActive) / 删除。
- saveVendor()：校验名称非空、modelRows 至少一组且 name/id 非空不重复 → 各组 push settings.models（带 baseUrl/apiKey/vendorKey）→ 当前 key 去重推 configuredVendors → 新建自定义先 push customVendors（key=slug+时间戳）→ saveSettings() → 进入只读 + 成功提示。

### 关键决策

- 已配置按供应商 key 集合判定，逻辑简单无歧义。
- 模型归属用 vendorKey 字段，预设按 key、自定义按生成 key，避免 baseUrl 匹配歧义。
- 自定义官网仅展示 + 只读可跳转，不参与请求（请求仍 baseUrl+apiKey+modelId）。
- 顶部卡片 + 下部双态表单复用，避免重复代码；不改动 ChatPanel/App.vue。

### 性能与可靠性

- 纯前端响应式，无网络开销；computed 派生避免冗余渲染。
- 保存即时写 localStorage，刷新不丢；reset 清空 configuredVendors 与 customVendors。
- 名称非空、模型 id 重复/非空校验防脏数据。

## 设计风格

采用简洁明亮的企业级卡片式布局，结合 Tailwind CSS 与 ant-design-vue 组件。页面分上下两大区块：顶部为供应商卡片网格，下部为白色圆角配置卡片，按三行结构排列。只读模式输入框置灰，官网为蓝色可点击链接。卡片 hover 轻微上浮、选中蓝色边框，保存后绿色提示 2 秒消失、顶部徽标即时点亮。

## 页面区块

- 顶部「添加供应商」：卡片网格（自适应列数），每张卡显示供应商名 + 状态标记（已配置 ✓ / + 配置），点击选中高亮蓝色边框；末尾「+ 添加自定义供应商」卡片。
- 下部「供应商配置」：标题显示当前供应商；编辑模式三行表单（名称+官网 / BaseURL+APIKey / 多组模型名称+模型ID），API Key 行含显示隐藏与默认 Key 勾选；底部保存按钮 + 成功提示。只读模式字段 disabled，展示官网链接与已添加模型列表（使用/删除）。

## Agent Extensions

### Skill

- **ant-design-vue**
- Purpose: 指导 SettingsPanel.vue 正确使用 ant-design-vue 组件（a-card、a-button、a-checkbox、a-list、a-tag 等）与注册方式
- Expected outcome: 组件按 AntDV 规范实现，无用法错误
- **vue-best-practices**
- Purpose: 确保 SettingsPanel.vue 与 settings.js 的 Vue 3 Composition API、`<script setup>`、reactive 用法符合最佳实践
- Expected outcome: 组件与状态管理遵循 Vue 3 标准模式，无反模式
- **tailwind-css-best-practices**
- Purpose: 指导 Tailwind 配置与工具类使用，确保三行表单布局与卡片网格样式正确
- Expected outcome: Tailwind 配置生效，样式无冲突
- **eslint-checker**
- Purpose: 执行 ESLint 检查 SettingsPanel.vue、settings.js、main.js 等代码质量与风格
- Expected outcome: 无 lint error，代码符合项目静态规范