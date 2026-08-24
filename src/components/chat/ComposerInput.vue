<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { Plus, ArrowUp, Shield, Zap, AtSign, Hash, FolderOpen, Square } from "lucide-vue-next";
import { settings, saveModels } from "../../settings.js";
import { activeProjectId } from "../../projects.js";
import { fetchFileTools } from "../../api/agent.js";
import ModelControl from "./ModelControl.vue";
import ComposerCmdPanel from "./ComposerCmdPanel.vue";
import ComposerAtPanel from "./ComposerAtPanel.vue";
import {
  syncTokensFromDom,
  insertTagAtTrigger,
  onPaste,
  insertNewline,
} from "./composerUtils.js";

const props = defineProps({
  active: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  availableSkills: { type: Array, default: () => [] },
});
const emit = defineEmits(["send", "stop", "open-add", "new-project-chat"]);

// ===== 富文本输入框（contenteditable）=====
const composerTokens = ref([]); // [{ type:'text', text } | { type:'tag', kind, key, label }]
const composerEl = ref(null);
const atPanelRef = ref(null);

// 对话框内设置：思考强度 / 权限级别（共享 settings 实例）
const effort = computed({
  get: () => settings.effort || "medium",
  set: (v) => (settings.effort = v),
});
const permission = computed({
  get: () => {
    const p = settings.permission || "full";
    // 无项目时下拉只提供 read-only / full（见 permissionOptions），
    // 若当前值为 ask / none（有项目时设置的），归一化为 read-only，避免下拉显示空白。
    if (!activeProjectId.id && !["read-only", "full"].includes(p)) return "read-only";
    return p;
  },
  set: (v) => (settings.permission = v),
});

// 权限下拉选项：
// - 有项目：完全访问 / 需确认 / 只读 / 不允许
// - 无项目：本地文件工具以「用户主目录」为边界（可读桌面/文档/下载等），
//   因此提供「只读 / 完全访问」两项，让用户控制是否允许写入/执行命令。
// 注：projects.js 中 activeProjectId 是 reactive({ id }),不是 ref,因此读 .id(不要 .value)
const permissionOptions = computed(() => {
  if (!activeProjectId.id) {
    return [
      { value: "read-only", label: "只读" },
      { value: "full", label: "完全访问" },
    ];
  }
  return [
    { value: "full", label: "完全访问" },
    { value: "ask", label: "需确认" },
    { value: "read-only", label: "只读" },
    { value: "none", label: "不允许" },
  ];
});

function syncTokens() {
  composerTokens.value = syncTokensFromDom(composerEl.value);
}

// 从状态数组里移除已选命令（与 chip 同步）
function removeChipFromState(kind, key) {
  if (kind === "tool")
    sessionToolCmds.value = sessionToolCmds.value.filter((k) => k !== key);
  else if (kind === "skill")
    selectedSkills.value = selectedSkills.value.filter((k) => k !== key);
  else if (kind === "mcp")
    selectedMcp.value = selectedMcp.value.filter((k) => k !== key);
}

// 插入 tag 时回调（由 composerUtils 内 close 按钮触发）
function onTagClose(t) {
  removeChipFromState(t.kind, t.key);
  syncTokens();
}

// ===== 工具命令面板（输入框按 "/" 触发）=====
const baseTools = ref([]);
async function loadBaseTools() {
  const { tools } = await fetchFileTools();
  baseTools.value = Array.isArray(tools) ? tools : [];
}
onMounted(loadBaseTools);

const availableMcp = computed(() => {
  const mcp = settings.mcpServers || {};
  const disabled = new Set(
    Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : []
  );
  return Object.entries(mcp)
    .filter(([, cfg]) => cfg && cfg.enabled !== false && !disabled.has(cfg && cfg.name))
    .map(([name]) => ({
      key: name,
      kind: "mcp",
      name,
      desc: `MCP 服务器：${name}`,
    }));
});
const sessionToolCmds = ref([]);
const selectedSkills = ref([]);
const selectedMcp = ref([]);

// 全部可选命令（文件工具 + 技能 + MCP）
const allCmdItems = computed(() => {
  const items = [...baseTools.value.map((t) => ({ ...t, kind: "tool" }))];
  for (const s of props.availableSkills)
    items.push({ key: s.key, kind: "skill", name: s.name, desc: s.desc });
  for (const m of availableMcp.value)
    items.push({ key: m.key, kind: "mcp", name: m.name, desc: m.desc });
  return items;
});
const chosenCmdKeys = computed(() => [
  ...sessionToolCmds.value,
  ...selectedSkills.value,
  ...selectedMcp.value,
]);

const showCmdPanel = ref(false);
const cmdFilter = ref("");
const cmdHighlight = ref(0);
const atKeyword = ref("");

// 选择某个命令：以高亮 tag 插入输入框
function chooseCmd(item) {
  if (item.kind === "tool") {
    sessionToolCmds.value = [...new Set([...sessionToolCmds.value, item.key])];
  } else if (item.kind === "skill") {
    selectedSkills.value = [...new Set([...selectedSkills.value, item.key])];
  } else if (item.kind === "mcp") {
    selectedMcp.value = [...new Set([...selectedMcp.value, item.key])];
  }
  const label = item.kind === "skill" ? item.key.replace(/^skills\//, "") : item.key;
  insertTagAtTrigger({
    el: composerEl.value,
    triggerRangeRef,
    t: { type: "tag", kind: item.kind, key: item.key, label },
    onRemoveChip: onTagClose,
  });
  syncTokens();
  showCmdPanel.value = false;
  cmdFilter.value = "";
  composerEl.value?.focus();
}

// ===== @ 文件面板（关联项目时，输入 @ 选择项目文件）=====
const showAtPanel = ref(false);
function chooseAtFile(item) {
  const suffix = item.type === "dir" ? "/" : "";
  const ref = `${item.path}${suffix}`;
  const kind = item.type === "dir" ? "dir" : "file";
  insertTagAtTrigger({
    el: composerEl.value,
    triggerRangeRef,
    t: { type: "tag", kind, key: ref, label: ref },
    onRemoveChip: onTagClose,
  });
  syncTokens();
  showAtPanel.value = false;
  composerEl.value?.focus();
}

// 触发符(@ / )在 composer DOM 中的精确位置
const triggerRangeRef = { value: null };

// 面板中选择工具回车后，阻止同一次 Enter 继续触发 send()
let suppressSend = false;

// ===== 输入解析（@ / 触发面板）=====
function onCmdInput() {
  syncTokens();
  const el = composerEl.value;
  let targetNode = null;
  let targetLocalIdx = -1;
  let foundSym = "";
  if (el) {
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const txt = child.textContent || "";
      const a = txt.lastIndexOf("@");
      const b = txt.lastIndexOf("/");
      if (a === -1 && b === -1) continue;
      const pick = a > b ? a : b;
      const sym = a > b ? "@" : "/";
      const tail = txt.slice(pick);
      if (/\s/.test(tail)) continue;
      const prevChar = pick > 0 ? txt[pick - 1] : "";
      if (pick > 0 && !/\s/.test(prevChar)) continue;
      targetNode = child;
      targetLocalIdx = pick;
      foundSym = sym;
    }
  }
  if (!targetNode) {
    triggerRangeRef.value = null;
    showAtPanel.value = false;
    showCmdPanel.value = false;
    return;
  }
  const range = document.createRange();
  range.setStart(targetNode, targetLocalIdx);
  range.collapse(true);
  triggerRangeRef.value = range;
  const tail = (targetNode.textContent || "").slice(targetLocalIdx);
  if (foundSym === "@" && props.active) {
    showCmdPanel.value = false;
    const at = tail.match(/^@(\S*)$/);
    atKeyword.value = at ? at[1] : "";
    showAtPanel.value = true;
    cmdHighlight.value = 0;
    return;
  }
  showAtPanel.value = false;
  if (foundSym === "/") {
    const m = tail.match(/^\/(\S*)$/);
    if (m) {
      atKeyword.value = "";
      cmdFilter.value = m[1];
      showCmdPanel.value = true;
      cmdHighlight.value = 0;
    } else {
      showCmdPanel.value = false;
    }
  } else {
    showCmdPanel.value = false;
  }
}

// 键盘处理：优先 @ 文件面板，其次 / 命令面板
function onCmdKeydown(e) {
  if (e.key === "Enter" && e.shiftKey) {
    e.preventDefault();
    insertNewline(composerEl.value);
    return;
  }
  if (showAtPanel.value) {
    atPanelRef.value && atPanelRef.value.onKeydown(e);
    return;
  }
  if (!showCmdPanel.value) return;
  const list = allCmdItems.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    cmdHighlight.value = Math.min(cmdHighlight.value + 1, Math.max(list.length - 1, 0));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    cmdHighlight.value = Math.max(cmdHighlight.value - 1, 0);
  } else if (e.key === "Enter" && list.length) {
    e.preventDefault();
    suppressSend = true;
    const item = allCmdItems.value.find((_, i) => i === cmdHighlight.value);
    if (item) chooseCmd(item);
  } else if (e.key === "Escape") {
    showCmdPanel.value = false;
  }
}

async function focusComposer() {
  await nextTick();
  composerEl.value?.focus();
}
function insertText(text) {
  if (!composerEl.value) return;
  composerEl.value.focus();
  document.execCommand("insertText", false, text);
}

// 触发发送：前置检查在容器，组装与网络请求在父级
function triggerSend() {
  if (suppressSend) {
    suppressSend = false;
    return;
  }
  if (showCmdPanel.value) return;
  if (showAtPanel.value) return;
  syncTokens();
  emit("send", {
    composerTokens: composerTokens.value.map((t) => ({ ...t })),
    sessionToolCmds: [...sessionToolCmds.value],
    selectedSkills: [...selectedSkills.value],
    selectedMcp: [...selectedMcp.value],
  });
}

// 供父级在发送成功后调用：清空输入框
function clear() {
  composerTokens.value = [];
  sessionToolCmds.value = [];
  selectedSkills.value = [];
  selectedMcp.value = [];
  if (composerEl.value) composerEl.value.textContent = "";
}

defineExpose({ clear, focusComposer });
</script>

<template>
  <div class="chat__composer">
    <div class="chat__input-header">
      <div class="chat__context-group" role="group" aria-label="当前会话上下文">
        <span class="chat__project-badge" :title="active?.path || '通用对话'">
          <FolderOpen v-if="active" :size="13" class="chat__project-icon" />
          <span v-else class="chat__project-dot"></span>
          <span class="chat__project-label">{{ active?.alias || "通用对话" }}</span>
        </span>
        <button
          type="button"
          class="chat__newproj"
          aria-label="新建会话"
          title="新建会话"
          @click="emit('new-project-chat')"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>
    <div class="chat__input">
      <ComposerAtPanel
        v-if="showAtPanel"
        ref="atPanelRef"
        :active="active"
        :show="showAtPanel"
        :keyword="atKeyword"
        @choose="chooseAtFile"
        @close="showAtPanel = false"
      />
      <ComposerCmdPanel
        v-if="showCmdPanel"
        :items="allCmdItems"
        :chosen-keys="chosenCmdKeys"
        :filter="cmdFilter"
        :highlight="cmdHighlight"
        @choose="chooseCmd"
        @update:highlight="cmdHighlight = $event"
      />

      <!-- 富文本输入框（contenteditable） -->
      <div
        class="chat__input-composer"
        ref="composerEl"
        contenteditable="true"
        data-placeholder="输入消息，@ 引用文件/目录，/ 选择工具…"
        @input="onCmdInput"
        @keydown="onCmdKeydown"
        @keydown.enter.exact.prevent="triggerSend"
        @paste="onPaste"
      ></div>

      <div class="chat__input-footer">
        <div class="chat__footer-left">
          <div class="chat__quick-actions">
            <button v-if="activeProjectId.id" type="button" class="chat__quick-btn" title="引用文件/目录" @click="insertText('@')">
              <AtSign :size="14" />
            </button>
            <button type="button" class="chat__quick-btn" title="选择工具" @click="insertText('/')">
              <Hash :size="14" />
            </button>
          </div>
          <div class="chat__controls">
            <div class="chat__control" title="权限">
              <Shield :size="14" class="chat__control-icon" />
              <a-select
                v-model:value="permission"
                size="small"
                :bordered="false"
                :options="permissionOptions"
              />
            </div>
            <ModelControl />
            <div class="chat__control" title="强度">
              <Zap :size="14" class="chat__control-icon" />
              <a-select
                v-model:value="effort"
                size="small"
                :bordered="false"
                style="width: 70px"
                :options="[
                  { value: 'low', label: '省量' },
                  { value: 'medium', label: '均衡' },
                  { value: 'high', label: '深度' },
                ]"
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          class="chat__send"
          :class="{ 'chat__send--stop': loading }"
          :title="loading ? '停止生成' : '发送'"
          @click="loading ? emit('stop') : triggerSend()"
        >
          <component :is="loading ? Square : ArrowUp" :size="18" />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="less">
/* 容器布局 + 控件（权限/模型/强度/发送/快捷按钮）
   设为全局样式：1) 权限/强度控件与模型控件共用 .chat__control；
   2) .composer-tag 由 document.createElement 动态注入，节点不带 scoped 属性，必须全局 */
.chat__composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat__input-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  min-height: 32px;
}
.chat__context-group {
  display: inline-flex;
  align-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #ffffff;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.chat__project-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 5px 12px;
  border-right: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  font-weight: 500;
  cursor: default;
  user-select: none;
}
.chat__project-icon {
  flex-shrink: 0;
  color: #64748b;
}
.chat__project-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}
.chat__project-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat__newproj {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chat__newproj:hover {
  background: #2563eb;
  color: #fff;
}
.chat__newproj:focus-visible,
.chat__context-group:focus-within {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
}
.chat__input {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 16px 16px;
  padding: 10px 14px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.chat__input:focus-within {
  border-color: #bfdbfe;
  box-shadow: 0 4px 24px rgba(37, 99, 235, 0.1);
}
.chat__input-composer {
  flex: none;
  width: 100%;
  min-height: 56px;
  max-height: 220px;
  padding: 6px 2px;
  border: none;
  background: transparent;
  color: #1f2937;
  font-size: 15px;
  line-height: 1.65;
  outline: none;
  word-break: break-word;
  overflow-y: auto;
  overflow-x: hidden;
  white-space: pre-wrap;
}
.chat__input-composer:empty::before {
  content: attr(data-placeholder);
  color: #94a3b8;
  pointer-events: none;
  font-size: 14px;
}

.chat__input-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}
.chat__footer-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.chat__quick-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.chat__quick-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  color: #64748b;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.chat__quick-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #334155;
}
.chat__controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.chat__control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px 2px 8px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.chat__control:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.chat__control-icon {
  flex-shrink: 0;
  color: #94a3b8;
}
.chat__control--model {
  max-width: 320px;
}

/* Ant Design Select 在控件内的视觉融合 */
.chat__control--model .ant-select {
  width: auto;
  max-width: 320px;
}
.chat__control .ant-select-selector {
  padding: 0 18px 0 0 !important;
  background: transparent !important;
}
.chat__control .ant-select-selection-item {
  color: #475569;
  font-weight: 500;
}
.chat__control .ant-select-arrow {
  color: #94a3b8;
}

.chat__send {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}
.chat__send:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45);
}
.chat__send:disabled {
  background: #cbd5e1;
  box-shadow: none;
  cursor: not-allowed;
}

/* 内联高亮 chip（@文件 / /工具 / ✦技能 / ⌘MCP），动态创建节点，必须全局 */
.composer-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 2px;
  padding: 0 4px 0 6px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  height: 20px;
  line-height: 18px;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  vertical-align: middle;
  box-sizing: border-box;
  border: 1px solid transparent;
  transition: filter 0.15s, transform 0.15s;
}
.composer-tag:hover {
  filter: brightness(0.97);
}
.composer-tag:active {
  transform: scale(0.97);
}
.composer-tag--file {
  background: #eef2ff;
  color: #4338ca;
  border-color: #c7d2fe;
}
.composer-tag--dir {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}
.composer-tag--tool,
.composer-tag--skill {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
}
.composer-tag--mcp {
  background: #ede9fe;
  color: #5b21b6;
  border-color: #ddd6fe;
}
.composer-tag__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.85;
}
.composer-tag__label {
  display: inline-block;
  font-family: "Fira Code", Consolas, monospace;
  font-weight: 500;
  font-size: 13px;
  line-height: inherit;
  letter-spacing: 0.2px;
  vertical-align: baseline;
}
.composer-tag__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: background 0.15s;
}
.composer-tag__close:hover {
  background: rgba(0, 0, 0, 0.22);
}
.composer-tag--tool .composer-tag__close,
.composer-tag--skill .composer-tag__close {
  background: rgba(255, 255, 255, 0.18);
}
.composer-tag--tool .composer-tag__close:hover,
.composer-tag--skill .composer-tag__close:hover {
  background: rgba(255, 255, 255, 0.34);
}
</style>
