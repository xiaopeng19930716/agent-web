<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { Plus, ArrowUp, Shield, Zap, Cpu, AtSign, Hash, FolderOpen } from "lucide-vue-next";
import { settings, flattenVendors } from "../../settings.js";
import { fetchProjectFiles, searchProjectFiles, fetchFileTools } from "../../api/agent.js";

const props = defineProps({
  active: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  availableSkills: { type: Array, default: () => [] },
});
const emit = defineEmits(["send", "open-add", "new-project-chat"]);

// ===== 富文本输入框（contenteditable）=====
const composerTokens = ref([]); // [{ type:'text', text } | { type:'tag', kind, key, label }]
const composerEl = ref(null);

// 对话框内设置：思考强度 / 权限级别（共享 settings 实例）
const effort = computed({
  get: () => settings.effort || "medium",
  set: (v) => (settings.effort = v),
});
const permission = computed({
  get: () => settings.permission || "full",
  set: (v) => (settings.permission = v),
});

// 模型按供应商分组
const PRESET_VENDOR_NAMES = {
  "bailian-coding": "阿里云百炼 · Coding Plan",
  "bailian-token": "阿里云百炼 · Token Plan",
  deepseek: "DeepSeek",
  zhipu: "智谱 GLM · Coding Plan",
  tencent: "腾讯混元 · Coding",
};
const vendorNameMap = computed(() => {
  const m = { ...PRESET_VENDOR_NAMES };
  const customs = Array.isArray(settings.customVendors)
    ? settings.customVendors
    : [];
  for (const v of customs) {
    if (v && v.key) m[v.key] = v.name || v.key;
  }
  return m;
});
function vendorLabel(vk) {
  if (!vk) return "其他 / 自定义";
  return vendorNameMap.value[vk] || vk;
}
const groupedModels = computed(() => {
  const list = flattenVendors(settings.vendors);
  const disabled = new Set(
    Array.isArray(settings.disabledVendors) ? settings.disabledVendors : []
  );
  const groups = new Map();
  for (const m of list) {
    const key = m.vendorKey || "__custom__";
    if (key !== "__custom__" && disabled.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === "__custom__") return 1;
    if (b === "__custom__") return -1;
    return (vendorNameMap[a] || a).localeCompare(vendorNameMap[b] || b, "zh");
  });
  return order.map((k) => ({
    key: k,
    label: vendorLabel(k),
    items: groups.get(k).map((m) => ({
      ...m,
      key: m.id,
      label: m.name,
    })),
  }));
});

// ===== 工具命令面板（输入框按 "/" 触发）=====
// 基础工具由后端 /api/tools 自动扫描（server/lib/fileTools.js 中 buildTools 声明的全部工具），
// 不再在前端硬编码，新增工具会自动出现。
const baseTools = ref([]);
async function loadBaseTools() {
  const { tools } = await fetchFileTools();
  baseTools.value = Array.isArray(tools) ? tools : [];
}
onMounted(loadBaseTools);
const availableMcp = computed(() => {
  const mcp = settings.mcpServers || {};
  const disabled = new Set(
    Array.isArray(settings.disabledMcpServers)
      ? settings.disabledMcpServers
      : []
  );
  return Object.entries(mcp)
    .filter(
      ([name, cfg]) => cfg && cfg.enabled !== false && !disabled.has(name)
    )
    .map(([name]) => ({
      key: name,
      kind: "mcp",
      name,
      desc: `MCP 服务器：${name}`,
    }));
});
const sessionToolCmds = ref([]);
const showCmdPanel = ref(false);
const cmdFilter = ref("");
const cmdHighlight = ref(0);
// 触发符(@ / )在 composer DOM 中的精确位置
let triggerRange = null;
// 面板中选择工具回车后，阻止同一次 Enter 继续触发 send()
let suppressSend = false;
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
// 过滤后的命令列表
const filteredCmdItems = computed(() => {
  const q = cmdFilter.value.trim().toLowerCase();
  if (!q) return allCmdItems.value;
  return allCmdItems.value.filter(
    (it) =>
      it.key.toLowerCase().includes(q) || it.name.toLowerCase().includes(q)
  );
});

// 工具面板按类型分组：工具 / 技能 / MCP，每组一个小标题
const CMD_GROUP_LABELS = {
  tool: "文件工具",
  skill: "技能",
  mcp: "MCP 服务器",
};
const CMD_GROUP_ICONS = { tool: "⚙", skill: "✦", mcp: "⌘" };
const CMD_GROUP_ORDER = ["tool", "skill", "mcp"];
const groupedCmdItems = computed(() => {
  const byKind = new Map();
  filteredCmdItems.value.forEach((item, i) => {
    // 技能 key 自带 "skills/" 前缀，列表中只展示纯名字；其它类型保持原 key
    const displayKey = item.kind === "skill" ? item.key.replace(/^skills\//, "") : item.key;
    const arr = byKind.get(item.kind) || [];
    arr.push({ ...item, __idx: i, displayKey });
    byKind.set(item.kind, arr);
  });
  return CMD_GROUP_ORDER.map((kind) => ({
    kind,
    label: CMD_GROUP_LABELS[kind] || kind,
    icon: CMD_GROUP_ICONS[kind] || "",
    items: byKind.get(kind) || [],
  })).filter((g) => g.items.length);
});

// 已勾选的技能 id（persist 到本会话）
// 在输入框中已选择的命令（用于高亮）
const chosenCmds = computed(() => new Set(sessionToolCmds.value));
// 命令面板 DOM，用于高亮项超出可视区时自动滚动
const cmdPanelEl = ref(null);
watch(cmdHighlight, (idx) => {
  nextTick(() => {
    const panel = cmdPanelEl.value;
    if (!panel) return;
    const el = panel.querySelector(`[data-cmd-idx="${idx}"]`);
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight)
      panel.scrollTop = bottom - panel.clientHeight;
  });
});
const isCmdChosen = (item) =>
  chosenCmds.value.has(item.key) ||
  (item.kind === "skill" && selectedSkills.value.includes(item.key)) ||
  (item.kind === "mcp" && selectedMcp.value.includes(item.key));

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
  insertTagAtTrigger({ type: "tag", kind: item.kind, key: item.key, label });
  showCmdPanel.value = false;
  cmdFilter.value = "";
  composerEl.value?.focus();
}

// ===== @ 文件面板（关联项目时，输入 @ 选择项目文件）=====
const showAtPanel = ref(false);
const atKeyword = ref("");
const atHighlight = ref(0);
const atDir = ref("");
const atDirStack = ref([]);
const atEntries = ref([]);
const atSearchResults = ref([]);
const atLoading = ref(false);
const atErr = ref("");
const atSearchMode = computed(() => atKeyword.value.trim() !== "");
const atItems = computed(() =>
  atSearchMode.value ? atSearchResults.value : atEntries.value
);

async function openAtPanel() {
  if (!props.active) return;
  showAtPanel.value = true;
  atDir.value = "";
  atDirStack.value = [];
  atKeyword.value = "";
  atHighlight.value = 0;
  await loadAtDir("");
}
async function loadAtDir(dir) {
  if (!props.active) return;
  atLoading.value = true;
  atErr.value = "";
  const res = await fetchProjectFiles(props.active.id, dir);
  atLoading.value = false;
  if (res.error) {
    atErr.value = res.error;
    atEntries.value = [];
    return;
  }
  atEntries.value = res.items;
  atDir.value = res.path;
  atHighlight.value = 0;
}
async function doAtSearch() {
  if (!props.active) return;
  const kw = atKeyword.value.trim();
  if (!kw) {
    atSearchResults.value = [];
    return;
  }
  const res = await searchProjectFiles(props.active.id, kw);
  atSearchResults.value = res.error ? [] : res.results;
  atHighlight.value = 0;
}
async function enterAtDir(item) {
  atDirStack.value = [...atDirStack.value, atDir.value];
  atKeyword.value = "";
  await loadAtDir(item.path);
}
function goAtParent() {
  if (!atDirStack.value.length) return;
  const prev = atDirStack.value[atDirStack.value.length - 1];
  atDirStack.value = atDirStack.value.slice(0, -1);
  atKeyword.value = "";
  loadAtDir(prev || "");
}
// 选择文件或文件夹：以高亮 tag 插入输入框
function chooseAtFile(item) {
  const suffix = item.type === "dir" ? "/" : "";
  const ref = `${item.path}${suffix}`;
  const kind = item.type === "dir" ? "dir" : "file";
  insertTagAtTrigger({ type: "tag", kind, key: ref, label: ref });
  showAtPanel.value = false;
  composerEl.value?.focus();
}
function clickAtItem(item) {
  chooseAtFile(item);
}

// 处理 @ 关键字输入（debounce 搜索）
let atSearchTimer = null;
function scheduleAtSearch() {
  if (atSearchTimer) clearTimeout(atSearchTimer);
  atSearchTimer = setTimeout(() => {
    doAtSearch();
  }, 200);
}

// 富文本输入框辅助
function getComposerText() {
  const el = composerEl.value;
  if (!el) return "";
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent || "";
  }
  return out;
}
function syncTokensFromDom() {
  const el = composerEl.value;
  if (!el) return;
  const tokens = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent)
        tokens.push({ type: "text", text: node.textContent });
    } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.dataset?.composerTag
    ) {
      tokens.push({
        type: "tag",
        kind: node.dataset.composerTag,
        key: node.dataset.composerKey || "",
        label: node.dataset.composerLabel || "",
      });
    }
  }
  composerTokens.value = tokens;
}
function buildTagEl(t) {
  const span = document.createElement("span");
  span.className = "composer-tag";
  span.classList.add(`composer-tag--${t.kind}`);
  span.dataset.composerTag = t.kind;
  span.dataset.composerKey = t.key;
  span.dataset.composerLabel = t.label;
  span.contentEditable = "false";

  // 图标（区分 tool / skill / mcp / file / dir）
  const icon = document.createElement("span");
  icon.className = "composer-tag__icon";
  icon.textContent =
    t.kind === "skill"
      ? "✦"
      : t.kind === "mcp"
      ? "⌘"
      : t.kind === "tool"
      ? "⚡"
      : t.kind === "dir"
      ? "📁"
      : t.kind === "file"
      ? "📄"
      : "·";
  span.appendChild(icon);

  // 标签文本
  const label = document.createElement("span");
  label.className = "composer-tag__label";
  label.textContent =
    (t.kind === "file" || t.kind === "dir" ? "@" : "/") + t.label;
  span.appendChild(label);

  // 关闭按钮：删除对应状态 + 移除 DOM
  const close = document.createElement("button");
  close.type = "button";
  close.className = "composer-tag__close";
  close.title = "移除";
  close.textContent = "×";
  // 防止 mousedown 让 contenteditable 失焦
  close.addEventListener("mousedown", (e) => e.preventDefault());
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeChipFromState(t.kind, t.key);
    if (span.parentNode) span.parentNode.removeChild(span);
    syncTokensFromDom();
    composerEl.value?.focus();
  });
  span.appendChild(close);

  return span;
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
// 在触发符原位插入 tag
function insertTagAtTrigger(t) {
  const el = composerEl.value;
  if (!el) return;
  el.focus();
  const tagEl = buildTagEl(t);
  const spaceAfter = document.createTextNode(" ");
  let insertRange;
  if (triggerRange) {
    const node = triggerRange.startContainer;
    if (!node || !el.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      triggerRange = null;
    } else {
      const r = document.createRange();
      r.setStart(node, triggerRange.startOffset);
      r.setEnd(node, node.textContent.length);
      insertRange = r;
    }
  }
  if (!insertRange) {
    insertRange = document.createRange();
    insertRange.selectNodeContents(el);
    insertRange.collapse(false);
  }
  const startNode = insertRange.startContainer;
  const startOff = insertRange.startOffset;
  if (startNode && startNode.nodeType === Node.TEXT_NODE && startOff > 0) {
    const before = startNode.textContent.slice(0, startOff);
    if (!/\s$/.test(before)) {
      const sp = document.createTextNode(" ");
      insertRange.insertNode(sp);
    }
  }
  insertRange.deleteContents();
  const insertPoint = document.createRange();
  if (insertRange.startContainer && el.contains(insertRange.startContainer)) {
    insertPoint.setStart(insertRange.startContainer, insertRange.startOffset);
  } else {
    insertPoint.selectNodeContents(el);
    insertPoint.collapse(false);
  }
  insertPoint.collapse(true);
  insertPoint.insertNode(tagEl);
  insertPoint.setStartAfter(tagEl);
  insertPoint.collapse(true);
  insertPoint.insertNode(spaceAfter);
  insertPoint.setStartAfter(spaceAfter);
  insertPoint.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(insertPoint);
  triggerRange = null;
  syncTokensFromDom();
}

// 粘贴处理：去除富文本格式按纯文本插入；忽略图片（当前后端仅支持文本/文件引用）
function onPaste(e) {
  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return;
  // 剪贴板含图片等文件：暂不支持，静默忽略，避免插入乱码
  if (cd.files && cd.files.length) {
    e.preventDefault();
    return;
  }
  const text = cd.getData("text/plain");
  if (text) {
    e.preventDefault();
    // 插入纯文本（保留撤销栈并触发 input 事件以同步 token）
    document.execCommand("insertText", false, text);
  }
}

// 输入框输入统一触发
function onCmdInput() {
  syncTokensFromDom();
  const el = composerEl.value;
  let targetNode = null;
  let targetLocalIdx = -1;
  let foundSym = "";
  let text = "";
  if (el) {
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const txt = child.textContent || "";
      text += txt;
      const a = txt.lastIndexOf("@");
      const b = txt.lastIndexOf("/");
      if (a === -1 && b === -1) continue;
      const pick = a > b ? a : b;
      const sym = a > b ? "@" : "/";
      const tail = txt.slice(pick);
      if (/\s/.test(tail)) continue;
      // 触发符必须位于文本节点开头或前一个字符为空白，
      // 否则会误命中 URL（如 https://…）或路径中的 @ /，导致面板误开、发送被拦截
      const prevChar = pick > 0 ? txt[pick - 1] : "";
      if (pick > 0 && !/\s/.test(prevChar)) continue;
      targetNode = child;
      targetLocalIdx = pick;
      foundSym = sym;
    }
  }
  if (!targetNode) {
    triggerRange = null;
    showAtPanel.value = false;
    showCmdPanel.value = false;
    return;
  }
  const range = document.createRange();
  range.setStart(targetNode, targetLocalIdx);
  range.collapse(true);
  triggerRange = range;
  const tail = (targetNode.textContent || "").slice(targetLocalIdx);
  if (foundSym === "@" && props.active) {
    showCmdPanel.value = false;
    const at = tail.match(/^@(\S*)$/);
    if (!showAtPanel.value) {
      openAtPanel();
    }
    atKeyword.value = at ? at[1] : "";
    atHighlight.value = 0;
    if (at && at[1]) scheduleAtSearch();
    else atSearchResults.value = [];
    showAtPanel.value = true;
    return;
  }
  showAtPanel.value = false;
  if (foundSym === "/") {
    const m = tail.match(/^\/(\S*)$/);
    if (m) {
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

// @ 面板键盘处理
function onAtKeydown(e) {
  if (!showAtPanel.value) return;
  const list = atItems.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    atHighlight.value = Math.min(
      atHighlight.value + 1,
      Math.max(list.length - 1, 0)
    );
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    atHighlight.value = Math.max(atHighlight.value - 1, 0);
  } else if (e.key === "Enter") {
    if (!list.length) return;
    e.preventDefault();
    suppressSend = true;
    chooseAtFile(list[atHighlight.value]);
  } else if (e.key === "ArrowRight") {
    const item = list[atHighlight.value];
    if (item && item.type === "dir") {
      e.preventDefault();
      enterAtDir(item);
    }
  } else if (e.key === "ArrowLeft") {
    if (atDirStack.value.length || atDir.value) {
      e.preventDefault();
      goAtParent();
    }
  } else if (e.key === "Escape") {
    showAtPanel.value = false;
  }
}
// 键盘处理：优先 @ 文件面板，其次 / 命令面板
function insertNewline() {
  const el = composerEl.value;
  if (!el) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const br = document.createElement('br');
  range.deleteContents();
  range.insertNode(br);
  const after = document.createRange();
  after.setStartAfter(br);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  syncTokensFromDom();
}
function onCmdKeydown(e) {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    insertNewline();
    return;
  }
  if (showAtPanel.value) {
    onAtKeydown(e);
    return;
  }
  if (!showCmdPanel.value) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    cmdHighlight.value = Math.min(
      cmdHighlight.value + 1,
      filteredCmdItems.value.length - 1
    );
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (cmdHighlight.value === 0) {
      if (cmdPanelEl.value) cmdPanelEl.value.scrollTop = 0;
    } else {
      cmdHighlight.value = Math.max(cmdHighlight.value - 1, 0);
    }
  } else if (e.key === "Enter" && filteredCmdItems.value.length) {
    e.preventDefault();
    suppressSend = true;
    chooseCmd(filteredCmdItems.value[cmdHighlight.value]);
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
function onAtInput() {
  if (atSearchMode.value) scheduleAtSearch();
  else {
    atSearchResults.value = [];
    loadAtDir("");
  }
  atHighlight.value = 0;
}

// 触发发送：前置检查在子组件，组装与网络请求在容器
function triggerSend() {
  if (suppressSend) {
    suppressSend = false;
    return;
  }
  if (showCmdPanel.value) return;
  if (showAtPanel.value) return;
  syncTokensFromDom();
  emit("send", {
    composerTokens: composerTokens.value.map((t) => ({ ...t })),
    sessionToolCmds: [...sessionToolCmds.value],
    selectedSkills: [...selectedSkills.value],
    selectedMcp: [...selectedMcp.value],
  });
}

// 供容器在发送成功后调用：清空输入框
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
        <span
          class="chat__project-badge"
          :title="active?.path || '通用对话'"
        >
          <FolderOpen v-if="active" :size="13" class="chat__project-icon" />
          <span v-else class="chat__project-dot"></span>
          <span class="chat__project-label">{{
            active?.alias || "通用对话"
          }}</span>
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
      <!-- @ 文件/目录 面板 -->
    <div v-if="showAtPanel" class="at-panel">
      <div class="at-panel__toolbar">
        <span class="at-hint-icon">@</span>
        <span v-if="!atSearchMode" class="at-breadcrumb">
          <button class="at-back" @click="goAtParent">← 上级</button>
          <span class="at-crumb-path">{{ atDir || "项目根" }}</span>
        </span>
        <input
          v-if="active"
          class="at-search"
          placeholder="搜索文件/目录…"
          v-model="atKeyword"
          @input="onAtInput"
        />
        <span v-if="atLoading" class="at-loading">加载中…</span>
      </div>
      <div v-if="atErr" class="at-err">{{ atErr }}</div>
      <ul v-else class="at-list">
        <li
          v-for="(item, i) in atItems"
          :key="item.path"
          class="at-item"
          :class="{ 'at-item--active': i === atHighlight }"
          @mouseenter="atHighlight = i"
          @click="clickAtItem(item)"
        >
          <span
            class="at-item__type"
            :class="
              item.type === 'dir' ? 'at-item__type--dir' : 'at-item__type--file'
            "
          >
            {{ item.type === "dir" ? "📁" : "📄" }}
          </span>
          <span class="at-item__name">{{ item.name }}</span>
          <button
            v-if="item.type === 'dir'"
            class="at-item__arrow"
            title="进入目录"
            @click.stop="enterAtDir(item)"
          >
            ›
          </button>
          <span v-else class="at-item__path">{{ item.path }}</span>
        </li>
        <li v-if="!atItems.length" class="at-empty">无匹配项</li>
      </ul>
    </div>

    <!-- / 工具命令面板 -->
    <div v-if="showCmdPanel" class="cmd-panel" ref="cmdPanelEl">
      <ul class="cmd-list">
        <template v-for="group in groupedCmdItems" :key="group.kind">
          <li class="cmd-list__group">
            <span class="cmd-list__group-icon">{{ group.icon }}</span>
            <span class="cmd-list__group-label">{{ group.label }}</span>
          </li>
          <li
            v-for="item in group.items"
            :key="item.kind + ':' + item.key"
            :data-cmd-idx="item.__idx"
            class="cmd-item"
            :class="{
              'cmd-item--active': item.__idx === cmdHighlight,
              'cmd-item--chosen': isCmdChosen(item),
            }"
            @mouseenter="cmdHighlight = item.__idx"
            @click="chooseCmd(item)"
          >
            <span class="cmd-item__key">{{ item.displayKey }}</span>
            <span class="cmd-item__name">{{
              item.kind === "skill" ? (item.desc || "") : item.name
            }}</span>
            <span
              class="cmd-item__badge"
              :class="'cmd-item__badge--' + item.kind"
              >{{ item.kind }}</span
            >
            <span v-if="isCmdChosen(item)" class="cmd-item__check">✓</span>
          </li>
        </template>
        <li v-if="!filteredCmdItems.length" class="cmd-panel__empty">
          无匹配命令
        </li>
      </ul>
    </div>

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

    <!-- 富文本输入框（contenteditable），已选技能/工具/MCP/文件均以 chip 形式内联在框内 -->

    <div class="chat__input-footer">
      <div class="chat__footer-left">
        <div class="chat__quick-actions">
          <button
            type="button"
            class="chat__quick-btn"
            title="引用文件/目录"
            @click="insertText('@')"
          >
            <AtSign :size="14" />
          </button>
          <button
            type="button"
            class="chat__quick-btn"
            title="选择工具"
            @click="insertText('/')"
          >
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
              :options="[
                { value: 'full', label: '完全访问' },
                { value: 'read-only', label: '只读' },
                { value: 'none', label: '不允许' },
              ]"
            />
          </div>
          <div class="chat__control chat__control--model" title="模型">
            <Cpu :size="14" class="chat__control-icon" />
            <a-select
              v-model:value="settings.activeModel"
              size="small"
              :bordered="false"
              :options="groupedModels"
              :field-names="{ label: 'label', value: 'key', options: 'items' }"
            />
          </div>
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
        title="发送"
        :disabled="loading"
        @click="triggerSend"
      >
        <ArrowUp :size="18" />
      </button>
    </div>
  </div>
  </div>
</template>

<style scoped lang="less">
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
.chat__input textarea {
  flex: 1;
  resize: none;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  min-height: 36px;
}
.chat__input textarea::placeholder {
  color: #94a3b8;
}
/* 富文本输入框（contenteditable） */
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
/* 内联高亮 chip（@文件 / /工具 / ✦技能 / ⌘MCP）
   使用 :deep() 以让 document.createElement 动态创建的节点也能命中样式 */
:deep(.composer-tag) {
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
:deep(.composer-tag:hover) {
  filter: brightness(0.97);
}
:deep(.composer-tag:active) {
  transform: scale(0.97);
}
:deep(.composer-tag--file) {
  background: #eef2ff;
  color: #4338ca;
  border-color: #c7d2fe;
}
:deep(.composer-tag--dir) {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}
:deep(.composer-tag--tool) {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
}
:deep(.composer-tag--skill) {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
}
:deep(.composer-tag--mcp) {
  background: #ede9fe;
  color: #5b21b6;
  border-color: #ddd6fe;
}

::deep(.composer-tag__icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.85;
}

:deep(.composer-tag__label) {
  display: inline-block;
  font-family: "Fira Code", Consolas, monospace;
  font-weight: 500;
  font-size: 13px;
  line-height: inherit;
  letter-spacing: 0.2px;
  vertical-align: baseline;
}
::deep(.composer-tag__close) {
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
::deep(.composer-tag__close:hover) {
  background: rgba(0, 0, 0, 0.22);
}
/* 深蓝实底 chip（工具/技能）上的关闭按钮用白色半透明 */
:deep(.composer-tag--tool .composer-tag__close),
:deep(.composer-tag--skill .composer-tag__close) {
  background: rgba(255, 255, 255, 0.18);
}
:deep(.composer-tag--tool .composer-tag__close:hover),
:deep(.composer-tag--skill .composer-tag__close:hover) {
  background: rgba(255, 255, 255, 0.34);
}

/* 工具命令面板 */
.cmd-panel {
  position: relative;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
}
.cmd-panel__hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 2px;
}
.cmd-list__group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 3px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.3px;
}
.cmd-list__group:first-child {
  padding-top: 4px;
}
.cmd-list__group-icon {
  font-size: 12px;
  line-height: 1;
}
.cmd-list__group-label {
  text-transform: none;
}
.cmd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.cmd-item--active {
  background: #eff6ff;
}
.cmd-item--chosen {
  color: #2563eb;
}
.cmd-item__key {
  font-family: "Fira Code", Consolas, monospace;
  font-weight: 600;
  color: #2563eb;
  flex-shrink: 0;
}
.cmd-item__name {
  color: #1f2937;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmd-item__badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 500;
}
.cmd-item__badge--file {
  background: #dbeafe;
  color: #1d4ed8;
}
.cmd-item__badge--skill {
  background: #dcfce7;
  color: #15803d;
}
.cmd-item__badge--mcp {
  background: #fef3c7;
  color: #b45309;
}
.cmd-item__check {
  flex-shrink: 0;
  font-size: 12px;
  color: #16a34a;
}
.cmd-panel__empty {
  padding: 14px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

/* @ 文件面板 */
.at-panel {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}
/* 工具/文件面板：绝对浮层，悬浮在输入框上方，不占布局、不撑高输入框 */
.cmd-panel,
.at-panel {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 100%;
  margin-bottom: 8px;
  z-index: 20;
}
.at-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 2px;
}
.at-hint-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: #2563eb;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.at-loading {
  margin-left: auto;
  color: #2563eb;
  font-size: 12px;
}
.at-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #64748b;
}
.at-back {
  border: none;
  background: #eff6ff;
  color: #2563eb;
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
}
.at-back:hover {
  background: #dbeafe;
}
.at-crumb-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-search {
  flex: 1;
  min-width: 80px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  outline: none;
}
.at-search:focus {
  border-color: #2563eb;
}
.at-err {
  padding: 8px;
  color: #ef4444;
  font-size: 12px;
}
.at-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.at-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.at-item--active {
  background: #eff6ff;
}
.at-item__type {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  font-size: 13px;
}
.at-item__type--dir {
  color: #f59e0b;
}
.at-item__type--file {
  color: #64748b;
}
.at-item__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2937;
}
.at-item__path {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  color: #94a3b8;
  font-family: "Fira Code", Consolas, monospace;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-item__arrow {
  flex-shrink: 0;
  margin-left: auto;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
}
.at-item__arrow:hover {
  color: #2563eb;
  background: #dbeafe;
}
.at-empty {
  padding: 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

/* 已选命令已改为输入框内联 chip（见上方 .composer-tag），下方不再展示标签 */

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
.chat__control--model :deep(.ant-select) {
  width: auto;
  max-width: 320px;
}
.chat__control :deep(.ant-select-selector) {
  padding: 0 18px 0 0 !important;
  background: transparent !important;
}
.chat__control :deep(.ant-select-selection-item) {
  color: #475569;
  font-weight: 500;
}
.chat__control :deep(.ant-select-arrow) {
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
</style>
