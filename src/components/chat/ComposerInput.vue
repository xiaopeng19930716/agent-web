<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { Plus, ArrowUp, Shield, Zap, AtSign, Hash, FolderOpen, Square, ListTree, Image as ImageIcon, Loader2, X } from "lucide-vue-next";
import { settings, saveModels } from "../../settings.js";
import { activeProjectId } from "../../projects.js";
import { fetchFileTools, uploadImage } from "../../api/agent.js";
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
  // 上下文用量：{ usedTokens, contextWindow, pct, modelName } —— 父组件 ChatPanel 传入
  contextUsage: { type: Object, default: () => ({ usedTokens: 0, contextWindow: 32768, pct: 0, modelName: '' }) },
});
const emit = defineEmits(["send", "stop", "open-add", "new-project-chat", "manual-compress"]);

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

// 键盘处理：面板打开时，方向键/Enter/Esc 优先交给面板选择，不触发发送
function onCmdKeydown(e) {
  // @ 文件面板：完全委托给子面板（含 Enter 选择文件）
  // 注意：不要在父级无条件 preventDefault，否则会挡住 @ 后的字符输入（过滤关键字）；
  // atPanel 仅对方向键/Enter/Esc 自行 preventDefault，其余按键放行以维持输入。
  if (showAtPanel.value) {
    if (atPanelRef.value) atPanelRef.value.onKeydown(e);
    return;
  }
  // / 命令面板：方向键移动高亮，Enter 选择，Esc 关闭
  if (showCmdPanel.value) {
    const list = allCmdItems.value;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cmdHighlight.value = Math.min(cmdHighlight.value + 1, Math.max(list.length - 1, 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cmdHighlight.value = Math.max(cmdHighlight.value - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list.length) {
        const item = list[cmdHighlight.value];
        if (item) chooseCmd(item);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      showCmdPanel.value = false;
    } else {
      e.preventDefault();
    }
    return;
  }
  // 无面板：Enter 发送，Shift+Enter 换行
  if (e.key === "Enter") {
    if (e.shiftKey) {
      e.preventDefault();
      insertNewline(composerEl.value);
      return;
    }
    e.preventDefault();
    triggerSend();
    return;
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

// ===== 图片附件（#9 图像理解）=====
const pendingImages = ref([]); // [{ id, file, preview(objectURL), url, name, type, uploading, error }]
const uploadingImages = ref(false);

function addImageFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingImages.value.push({
      id,
      file,
      preview: URL.createObjectURL(file),
      url: "",
      name: file.name,
      type: file.type,
      uploading: false,
      error: "",
    });
  }
}

// 文件选择
function onPickImages(e) {
  const input = e.target;
  if (input.files?.length) addImageFiles(input.files);
  input.value = ""; // 允许重复选择同一文件
}

// 粘贴截图
function onPasteImage(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    addImageFiles(files);
    return true; // 已处理图片
  }
  return false;
}

// contenteditable paste：先尝试图片，否则走原文本粘贴逻辑
function onPasteWrap(e) {
  if (onPasteImage(e)) return;
  onPaste(e);
}

function removeImage(id) {
  const idx = pendingImages.value.findIndex((p) => p.id === id);
  if (idx >= 0) {
    URL.revokeObjectURL(pendingImages.value[idx].preview);
    pendingImages.value.splice(idx, 1);
  }
}

// 触发发送：前置检查在容器，组装与网络请求在父级
async function triggerSend() {
  if (suppressSend) {
    suppressSend = false;
    return;
  }
  if (showCmdPanel.value) return;
  if (showAtPanel.value) return;
  syncTokens();

  // 先把待发送图片上传到后端，拿到可访问的短 URL
  let images = [];
  if (pendingImages.value.length) {
    uploadingImages.value = true;
    try {
      images = await Promise.all(
        pendingImages.value.map(async (p) => {
          const dataUrl = await fileToDataURL(p.file);
          const url = await uploadImage(dataUrl, p.name, p.type);
          return { url, name: p.name, type: p.type };
        })
      );
    } catch (err) {
      uploadingImages.value = false;
      alert("图片上传失败：" + (err?.message || err));
      return;
    }
    uploadingImages.value = false;
  }

  emit("send", {
    composerTokens: composerTokens.value.map((t) => ({ ...t })),
    sessionToolCmds: [...sessionToolCmds.value],
    selectedSkills: [...selectedSkills.value],
    selectedMcp: [...selectedMcp.value],
    planMode: settings.planMode || false,
    images,
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 供父级在发送成功后调用：清空输入框
function clear() {
  composerTokens.value = [];
  sessionToolCmds.value = [];
  selectedSkills.value = [];
  selectedMcp.value = [];
  pendingImages.value.forEach((p) => URL.revokeObjectURL(p.preview));
  pendingImages.value = [];
  if (composerEl.value) composerEl.value.textContent = "";
}

// 供父级在「编辑并重发」时回填用户消息正文
function setText(text) {
  if (composerEl.value) composerEl.value.textContent = text || ''
}

defineExpose({ clear, focusComposer, setText, triggerSend });

// ===== 上下文进度环（参考 a-progress 圆环样式）=====
// 用纯 SVG 画一个圆环：底色灰环 + 前景描边按百分比裁切，颜色按区间变化
const ringRadius = 15
const ringStroke = 3.5
const ringCircumference = 2 * Math.PI * ringRadius
const ringDashOffset = computed(() => {
  const pct = Math.min(100, Math.max(0, Number(props.contextUsage.pct) || 0))
  return ringCircumference * (1 - pct / 100)
})
const ringColor = computed(() => {
  const p = Number(props.contextUsage.pct) || 0
  if (p >= 90) return '#ef4444' // 红
  if (p >= 70) return '#f59e0b' // 橙
  return '#3b82f6' // 主色蓝
})
const ringTitle = computed(() => {
  const u = props.contextUsage.usedTokens || 0
  const w = props.contextUsage.contextWindow || 0
  return `上下文占用 ${props.contextUsage.pct || 0}%（估算 ${u} / ${w} tokens）\n长按 1 秒压缩本会话`
})

// ===== 长按 1 秒触发手动压缩 =====
let ringHoldTimer = null
const ringHolding = ref(false)
function onRingDown() {
  if (ringHoldTimer) return // 已在计时
  ringHolding.value = true
  ringHoldTimer = setTimeout(() => {
    ringHoldTimer = null
    ringHolding.value = false
    emit('manual-compress')
  }, 1000)
}
function onRingUp() {
  if (ringHoldTimer) {
    clearTimeout(ringHoldTimer)
    ringHoldTimer = null
  }
  ringHolding.value = false
}
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
        :data-placeholder="settings.planMode ? '计划模式：描述你的任务，AI 会先拆解成子任务，再逐个执行…' : '输入消息，@ 引用文件/目录，/ 选择工具…（Enter 发送，Shift+Enter 换行）'"
        @input="onCmdInput"
        @keydown="onCmdKeydown"
        @paste="onPasteWrap"
      ></div>

      <!-- 待发送图片预览（#9） -->
      <div v-if="pendingImages.length" class="chat__img-previews">
        <div v-for="p in pendingImages" :key="p.id" class="chat__img-thumb">
          <img :src="p.preview" :alt="p.name" />
          <button type="button" class="chat__img-remove" title="移除" @click="removeImage(p.id)">
            <X :size="12" />
          </button>
        </div>
      </div>

      <div class="chat__input-footer">
        <div class="chat__footer-left">
          <div class="chat__quick-actions">
            <button v-if="activeProjectId.id" type="button" class="chat__quick-btn" title="引用文件/目录" @click="insertText('@')">
              <AtSign :size="14" />
            </button>
            <button type="button" class="chat__quick-btn" title="选择工具" @click="insertText('/')">
              <Hash :size="14" />
            </button>
            <button type="button" class="chat__quick-btn" title="上传图片 / 截图" @click="$refs.imageInput.click()">
              <ImageIcon :size="14" />
            </button>
            <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onPickImages" />
          </div>
          <div class="chat__controls">
            <button
              type="button"
              class="chat__control chat__control--plan"
              :class="{ 'chat__control--active': settings.planMode }"
              :title="settings.planMode ? '计划模式：已开启（将先拆解任务再执行）' : '计划模式：关闭'"
              @click="settings.planMode = !settings.planMode"
            >
              <ListTree :size="14" class="chat__control-icon" />
              <span>计划</span>
            </button>
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
        <div class="chat__footer-right">
          <div
            class="chat__ctx-ring"
            :class="{ 'chat__ctx-ring--pressing': ringHolding }"
            :title="ringTitle"
            aria-label="上下文进度（长按压缩）"
            @mousedown="onRingDown"
            @mouseup="onRingUp"
            @mouseleave="onRingUp"
            @touchstart="onRingDown"
            @touchend="onRingUp"
          >
            <svg width="36" height="36" viewBox="0 0 36 36">
              <!-- 底色灰环 -->
              <circle cx="18" cy="18" :r="ringRadius" fill="none"
                      stroke="currentColor" stroke-width="3" opacity="0.15" />
              <!-- 前景描边（按百分比旋转并裁切） -->
              <circle cx="18" cy="18" :r="ringRadius" fill="none"
                      :stroke="ringColor" :stroke-width="ringStroke" stroke-linecap="round"
                      :stroke-dasharray="ringCircumference" :stroke-dashoffset="ringDashOffset"
                      transform="rotate(-90 18 18)" />
            </svg>
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
  border: 1px solid @color-border;
  border-radius: 999px;
  background: var(--color-bg);
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.chat__project-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 5px 12px;
  border-right: 1px solid @color-border;
  background: var(--color-bg-subtle);
  color: @color-text;
  font-size: 12px;
  font-weight: 500;
  cursor: default;
  user-select: none;
}
.chat__project-icon {
  flex-shrink: 0;
  color: @color-text-muted;
}
.chat__project-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: @color-text-muted;
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
  color: @color-text-muted;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chat__newproj:hover {
  background: @color-primary;
  color: #fff;
}
.chat__newproj:focus-visible,
.chat__context-group:focus-within {
  outline: 2px solid @color-primary;
  outline-offset: -2px;
}
.chat__input {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 16px 16px;
  padding: 10px 14px 12px;
  background: var(--color-bg);
  border: 1px solid @color-border;
  border-radius: 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.chat__input:focus-within {
  border-color: @color-primary-hover;
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
  color: @color-text-strong;
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
  color: @color-text-muted;
  pointer-events: none;
  font-size: 14px;
}

.chat__img-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 2px 0;
}
.chat__img-thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}
.chat__img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.chat__img-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.chat__img-remove:hover {
  background: rgba(0, 0, 0, 0.75);
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
  border: 1px solid @color-border;
  border-radius: 8px;
  background: var(--color-bg);
  color: @color-text-muted;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.chat__quick-btn:hover {
  background: var(--color-bg-subtle);
  border-color: @color-border;
  color: @color-text;
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
  border: 1px solid @color-border;
  background: var(--color-bg-subtle);
  color: @color-text;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.chat__control:hover {
  background: var(--color-bg);
  border-color: @color-border;
}
.chat__control-icon {
  flex-shrink: 0;
  color: @color-text-muted;
}
/* 计划模式开关：开启态用主色高亮，与已选技能 chip 主色一致 */
.chat__control--plan {
  padding: 2px 10px 2px 8px;
  border-color: @color-border;
}
.chat__control--plan .chat__control-icon {
  width: 14px;
  height: 14px;
}
.chat__control--plan.chat__control--active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.chat__control--plan.chat__control--active .chat__control-icon {
  color: #fff;
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
  color: @color-text;
  font-weight: 500;
}
.chat__control .ant-select-arrow {
  color: @color-text-muted;
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
  background: @color-text-muted;
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

/* 上下文进度环：紧贴发送按钮左侧，水平居中 */
.chat__footer-right {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.chat__ctx-ring {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  color: @color-text-muted;
  cursor: pointer;
  transition: transform 0.15s;
}
.chat__ctx-ring:hover {
  transform: scale(1.08);
}
.chat__ctx-ring svg {
  display: block;
}
/* 长按按压态：放大并高亮，给用户“快触发了”的反馈 */
.chat__ctx-ring--pressing {
  transform: scale(1.15);
  color: @color-primary;
}
</style>
