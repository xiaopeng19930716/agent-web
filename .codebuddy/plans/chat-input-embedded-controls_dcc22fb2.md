---
name: chat-input-embedded-controls
overview: 将 + 新对话、模型切换、思考强度、权限级别、发送按钮全部内嵌到一个复合输入框（textarea）内部：左上 + 号、右上/下方模型+思考+权限、右下发送；原外部 toolbar 删除。
todos:
  - id: rearrange-template
    content: 将 ChatPanel.vue 模板合并为复合输入框：删除 chat__toolbar，重建 chat__input 内嵌 +/模型/思考/权限/textarea/发送
    status: completed
  - id: adjust-style
    content: 调整 ChatPanel.vue scoped 样式：复合容器边框、透明 textarea、顶部/底部行对齐，复用既有控件类
    status: completed
    dependencies:
      - rearrange-template
  - id: verify
    content: 运行 lint 校验 ChatPanel.vue 无错误
    status: completed
    dependencies:
      - adjust-style
---

## 产品概述

将聊天主区输入框改为「复合输入框」：把 + 新对话、模型切换、思考强度、权限级别、发送按钮全部内嵌到一个带边框的输入框容器内，而非分散在 textarea 外部或下方独立行。

## 核心功能

- 复合输入框容器：深色圆角边框容器，内含顶部行（左侧 + 新对话按钮，右侧模型切换 a-select + 思考强度 chip + 权限 chip）、中间透明 textarea、底部右下角发送按钮。
- 顶部行 + 按钮、模型切换、思考强度、权限级别交互行为不变（沿用既有 v-model 绑定）。
- 发送按钮置于输入框内右下角，点击/Enter 触发发送，loading 态禁用。
- 删除原 chat__toolbar 外部工具条与 chat__input 旧布局，仅调整 ChatPanel.vue 模板与 scoped 样式，逻辑与后端不变。

## Tech Stack

- 沿用 Vue 3 `<script setup>` + Ant Design Vue（a-select / a-select-opt-group / a-select-option 已全局注册）。
- 仅修改 `src/components/ChatPanel.vue` 模板与 `<style scoped>`，脚本、状态、后端、App.vue、settings/projects/sessions/api 均不变。
- 不新增依赖。

## Implementation Approach

采用「单容器复合输入框」方案：把当前独立的 `chat__toolbar`（模型/思考/权限）与 `chat__input`（+/textarea/发送）合并为一个带边框的容器 `chat__input`，内部自上而下为：顶部行（左 + / 右 模型+思考+权限）→ 透明 textarea → 底部行（右 发送）。

关键技术决策：

- 复用既有 `.chat__add`、`.toolbar-chip`、`.chat__model-select`、`.chat__send` 样式，仅调整其定位，避免重复造样式。
- a-select 下拉默认 teleport 到 body，嵌套在带 `border-radius` 容器内不会被裁剪，无需额外处理 overflow。
- textarea 改为透明、无边框、无独立背景，与容器背景（#1e293b）协调，保留 focus 态。
- 发送按钮用 `margin-left:auto` 在底部行右对齐。

## Implementation Notes

- 行为不变：`v-model` 仍是 `settings.activeModel` / `effort` / `permission`；`send()` 与 `newChat()` 逻辑不动。
- 删除原 `chat__toolbar` 及其边框/分隔线样式，避免与复合容器边框叠加产生双重边框。
- 保留原 `rows="3"`、`@keydown.enter.exact.prevent="send"`、`:disabled="loading"`。
- 响应式：复合容器宽度 100%，顶部行与底部行使用 flex + wrap，窄屏下右侧控件自然折行。

## Architecture Design

单文件局部改造，不影响既有数据流（sessions / projects / settings / streamChat）。仅 UI 结构重组。

## Directory Structure

```
src/components/ChatPanel.vue  # [MODIFY] 删除 chat__toolbar；重建 chat__input 为复合容器（顶部行 + textarea + 底部发送）；调整 scoped 样式，复用既有控件类。
```

## Key Code Structures

模板新结构（行内关键片段）：

```html
<div class="chat__input">
  <div class="chat__input-top">
    <button class="chat__add" title="新对话" @click="newChat">＋</button>
    <div class="chat__input-top-right">
      <a-select v-model:value="settings.activeModel" class="chat__model-select" ...>...</a-select>
      <div class="toolbar-chip">...思考强度...</div>
      <div class="toolbar-chip">...权限级别...</div>
    </div>
  </div>
  <textarea v-model="input" rows="3" ...></textarea>
  <div class="chat__input-bottom">
    <button class="chat__send" :disabled="loading" @click="send">{{ loading ? '生成中' : '发送' }}</button>
  </div>
</div>
```

样式要点：

- `.chat__input`：`border:1px solid #334155; border-radius:14px; background:#1e293b; padding:10px 12px; display:flex; flex-direction:column; gap:8px;`
- `textarea`：透明背景、无边框、`color:#e2e8f0`、`resize:none`、`outline:none`。
- `.chat__input-top`：`display:flex; align-items:center; gap:10px;`
- `.chat__input-top-right`：`margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap;`
- `.chat__input-bottom`：`display:flex; justify-content:flex-end;`
- `.chat__send { margin-left:auto; }` 实现右下。

## Agent Extensions

### Skill

- **vue-best-practices**
- Purpose: 指导 ChatPanel.vue 模板结构重组，确保响应式与 a-select 在嵌套容器内行为正常。
- Expected outcome: 复合输入框重排后无响应式失灵，a-select 正常打开下拉。
- **frontend-design**
- Purpose: 保证复合输入框视觉精致：容器边框/圆角/间距统一，顶部行与底部发送按钮对齐协调。
- Expected outcome: 输入区视觉达到设计图水准，控件内嵌不拥挤、层次分明。