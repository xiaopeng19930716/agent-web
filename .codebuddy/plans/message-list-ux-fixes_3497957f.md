---
name: message-list-ux-fixes
overview: 修复 MessageList.vue 的三个交互问题：思考区独立折叠、AI 输出可复制、流式生成时自动跟随滚动。
design:
  architecture:
    framework: vue
  styleKeywords:
    - Minimalism
    - Clean
    - Unobtrusive
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 14px
      weight: 600
    subheading:
      size: 13px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
    background:
      - "#FFFFFF"
      - "#F8FAFC"
    text:
      - "#1F2937"
      - "#64748B"
    functional:
      - "#16A34A"
      - "#2563EB"
todos:
  - id: per-message-thinking
    content: 使用 [skill:vue-best-practices] 将思考区展开状态改为按消息独立存储
    status: completed
  - id: ai-copy-button
    content: 使用 [skill:ui-ux-pro-max] 为 AI 气泡添加复制按钮与反馈状态
    status: completed
    dependencies:
      - per-message-thinking
  - id: streaming-scroll
    content: 使用 [skill:vue-best-practices] 实现流式生成时的智能底部跟随滚动
    status: completed
    dependencies:
      - per-message-thinking
  - id: ui-review
    content: 使用 [skill:web-design-guidelines,skill:ui-ux-pro-max] 检查可访问性与交互一致性
    status: completed
    dependencies:
      - ai-copy-button
      - streaming-scroll
---

## 用户反馈的问题

针对 `src/components/chat/MessageList.vue` 的三个交互缺陷进行修复：

1. **思考区全局联动**：点击某条 AI 消息的「思考完成」展开/收起时，所有消息的思考区会同步展开或收起。
2. **AI 输出不可复制**：Agent 生成的回答内容无法一键复制，影响使用效率。
3. **流式输出不跟 scroll**：Agent 正在逐字生成回答时，滚动条不会实时跟随到底部，需要手动下滚。

## 预期效果

- 每条 AI 消息的思考区折叠状态相互独立。
- AI 气泡右上角出现「复制」按钮，点击后复制该条消息原始文本/markdown，并给出临时反馈。
- 生成过程中滚动条平滑跟随到底部；若用户主动向上滚动离开底部，则暂停自动跟随，避免打断阅读。

## Tech Stack

- 前端框架：Vue 3（Composition API，`<script setup>`）
- 构建工具：Vite
- 样式：Less（项目现有变量主题）
- 复制能力：浏览器原生 Clipboard API + `document.execCommand('copy')` 降级

## Implementation Approach

- **独立思考区状态**：将当前全局 `expandedThinking` ref 改为以消息索引（或消息对象本身）为 key 的 reactive `Set`/`Map`，每条 AI 消息单独记录展开/收起状态。
- **复制功能**：在 AI 气泡区域添加一个轻量复制按钮，调用 `navigator.clipboard.writeText(m.content)`，失败时回退到 textarea/execCommand；复制成功后按钮临时变为「已复制」状态，2 秒恢复。
- **智能滚动跟随**：使用 `deep: true` 监听 `props.messages` 及最后一条消息的内容变化，在新增内容时判断用户当前是否已接近底部（`scrollHeight - scrollTop - clientHeight < threshold`），仅当在底部时才执行 `scrollToBottom`，避免强制打断用户主动上滚阅读。
- **性能考虑**：滚动触发使用 `nextTick` + `requestAnimationFrame` 避免 Layout Trash；只在消息数量变化或最后一条 AI 消息 content/reasoning/toolCalls 变化时检查滚动，不遍历整个数组。

## Implementation Notes

- `MessageList.vue` 中 `scrollEl` 已是滚动容器，保持复用。
- 复制按钮使用 `aria-label`，确保可访问性。
- 样式沿用现有 Less 变量（`@color-primary`、`@color-text-muted`、`@color-border` 等），不引入新色彩。
- 父组件 `ChatPanel.vue` 通过 `reactive()` 管理 `assistant` 对象，MessageList 对 `props.messages` 的深层监听可直接感知流式内容变化。

## Directory Structure

```
src/components/chat/
└── MessageList.vue   # [MODIFY] 修复三个交互问题：独立思考区折叠、AI 复制按钮、流式滚动跟随
```

保持现有简洁聊天界面风格，三个改动均为轻量交互增强，不破坏原有视觉层级。

- **复制按钮**：位于 AI 气泡右上角，默认以低调图标/文字呈现，hover 时显示，避免常驻干扰阅读。
- **复制反馈**：点击后按钮文案/图标短暂变为「已复制」并辅以主题色，2 秒后恢复。
- **思考区折叠**：保持现有左侧绿色竖条 + 浅灰背景，仅在交互状态上改为每条消息独立控制。
- **滚动跟随**：无新增视觉元素，通过行为优化让生成过程更自然。

## Skill

- **vue-best-practices**
- Purpose: 确保 Vue 3 Composition API 实现符合项目规范，状态管理、watch、ref/reactive 使用合理
- Expected outcome: 生成符合 `<script setup>`  idioms 的代码，避免响应式陷阱
- **ui-ux-pro-max**
- Purpose: 为复制按钮、展开状态、滚动跟随等交互提供最佳 UX 设计建议
- Expected outcome: 复制按钮位置、反馈时长、禁用场景等符合可用性最佳实践
- **web-design-guidelines**
- Purpose: 检查最终 UI 是否满足 Web Interface Guidelines（可访问性、对比度、交互一致性）
- Expected outcome: 发现并修正无障碍与视觉一致性问题