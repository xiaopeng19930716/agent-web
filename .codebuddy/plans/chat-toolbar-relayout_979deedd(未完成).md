---
name: chat-toolbar-relayout
overview: 按设计图重排 ChatPanel 主区控件位置：项目下拉仍在顶栏；输入框正上方（顶左）放 + 新对话按钮；输入框下方一行从左到右依次为：模型切换、思考强度、完全访问（权限），发送按钮放最右。
todos:
  - id: rearrange-template
    content: 将 ChatPanel.vue 模板：移除 chat__toolbar，新增 chat__addbar(顶部 + 按钮)、chat__input(仅 textarea)、chat__footer(模型/思考/权限/发送)
    status: pending
---

## 产品概述

按设计图重排 ChatPanel 底部控件位置：保留顶部项目下拉不动；+ 号新对话按钮移到 textarea 正上方（左对齐）；模型切换/思考强度/权限级别与发送按钮合并为 textarea 下方一行，从左到右依次为：模型切换 → 思考强度 → 权限级别 → 发送按钮（最右主色）。功能不变。

## 核心功能

- 顶部 header：项目下拉（保持不动）。
- 文本输入区上方：左对齐 + 新对话按钮（独立行/位置，点击触发 newChat）。
- 文本输入区下方 footer 行：模型切换(a-select 按供应商分组) → 思考强度（低/中/高）→ 权限级别（完全访问/只读/不允许）→ 发送按钮（最右）。
- 原有聊天/会话/项目/思考强度/权限后端传参与持久化逻辑全部不变。

## Tech Stack

- 沿用现有 Vue 3 `<script setup>` + Ant Design Vue（a-select、a-select-opt-group、a-select-option 已全局注册）。
- 不新增依赖。

## 实现方案

- 仅修改 `src/components/ChatPanel.vue` 的模板结构与 `<style scoped>`，脚本与状态保持不变。
- 模板：删除当前 `chat__toolbar`（含模型/思考/权限一行），将这三项下移至新的 `chat__input__footer` 行；删除当前 `chat__input` 内的 + 按钮与发送按钮，发送按钮改放进 footer 行最右，textarea 独立居中（自适应高度）。
- + 按钮：作为新行/新区域放在 textarea 正上方（`chat__addbar`，左对齐，单独一个圆形 + 按钮），避免遮挡 textarea 内容，hover 样式沿用。
- footer 行：`display:flex; align-items:center; gap:10px`，模型 select 弹性占满或固定最大宽度，思考/权限以 chip 形态（沿用 `.toolbar-chip`），发送按钮固定右侧。
- 复用既有 `.toolbar-chip` / `.chat__send` / `.chat__model-select` 样式；移除 `.chat__toolbar` 边框/分隔线；`.chat__input` 不再含 flex 容器，仅保留 textarea 容器。
- 不改后端、App.vue、settings.js、projects.js、sessions.js、api/agent.js。

## 关键代码结构（变更点）

模板新结构（行内关键片段）：

```
<div class="chat__addbar">
  <button class="chat__add" title="新对话" @click="newChat">＋</button>
</div>
<div class="chat__input">
  <textarea v-model="input" rows="3" ...></textarea>
</div>
<div class="chat__footer">
  <a-select v-model:value="settings.activeModel" class="chat__model-select" ...>...</a-select>
  <div class="toolbar-chip">...思考强度...</div>
  <div class="toolbar-chip">...权限级别...</div>
  <button class="chat__send" :disabled="loading" @click="send">...</button>
</div>
```

样式要点：

- `.chat__addbar`：`padding: 0 16px; display:flex;`；`.chat__add` 沿用圆形按钮。
- `.chat__input`：`padding: 0 16px; background: #0f172a;`。
- `.chat__footer`：`display:flex; align-items:center; gap:10px; padding: 8px 16px 16px; border-top: 1px solid #1e293b; background:#0f172a;`；`.chat__send { margin-left: auto; }` 实现最右对齐。
- 删除 `.chat__toolbar` 与相关 `.chat__input > .chat__add` / `.chat__send` 的原 flex 布局。

## 实现要点

- 行为不变：v-model 仍为 `settings.activeModel` / `effort` / `permission`；send 与 newChat 逻辑不变。
- 视觉：发送按钮 `margin-left:auto` 确保最右；模型 select `max-width: 320px` 不变；思考/权限 chip 沿用。
- 兼容：a-select 在 footer 中需保持 dropdown 弹出方向正常，不被父容器 overflow 裁剪。
- 风险：若 footer 高度变化导致 textarea 占用区变化，整体底部高度自适应即可，无需 JS 测量。

## 目录结构

- `src/components/ChatPanel.vue`  [MODIFY]  模板重排 toolbar→footer、+ 按钮上移；样式调整/合并 .chat__toolbar 为 .chat__footer。

## Agent Extensions

### Skill

- **vue-best-practices**
- Purpose: 指导 ChatPanel.vue 模板结构调整，保证响应式与 a-select 行为不受影响。
- Expected outcome: 重排后无响应式失灵，a-select 仍可正常打开下拉。
- **frontend-design**
- Purpose: 保证输入区视觉与原设计一致：footer 紧凑、间距统一、发送按钮最右、+ 按钮位置不遮挡。
- Expected outcome: 视觉与原设计图保持一致的精致度。