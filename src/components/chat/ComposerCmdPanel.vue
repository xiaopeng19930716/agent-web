<script setup>
import { computed, ref, watch, nextTick } from "vue";

const props = defineProps({
  // 扁平命令列表（已合并 工具/技能/MCP），元素 { key,kind,name,desc }
  items: { type: Array, default: () => [] },
  // 已勾选的命令 key（用于高亮）
  chosenKeys: { type: Array, default: () => [] },
  filter: { type: String, default: "" },
  highlight: { type: Number, default: 0 },
});

const emit = defineEmits(["choose", "update:highlight"]);
const panelEl = ref(null);
watch(
  () => props.highlight,
  (idx) => {
    nextTick(() => {
      const panel = panelEl.value;
      if (!panel) return;
      const el = panel.querySelector(`[data-cmd-idx="${idx}"]`);
      if (!el) return;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < panel.scrollTop) panel.scrollTop = top;
      else if (bottom > panel.scrollTop + panel.clientHeight)
        panel.scrollTop = bottom - panel.clientHeight;
    });
  }
);

const CMD_GROUP_LABELS = { tool: "文件工具", skill: "技能", mcp: "MCP 服务器" };
const CMD_GROUP_ICONS = { tool: "⚙", skill: "✦", mcp: "⌘" };
const CMD_GROUP_ORDER = ["tool", "skill", "mcp"];

const filteredItems = computed(() => {
  const q = props.filter.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter(
    (it) => it.key.toLowerCase().includes(q) || it.name.toLowerCase().includes(q)
  );
});

const groupedItems = computed(() => {
  const byKind = new Map();
  filteredItems.value.forEach((item, i) => {
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

const chosenSet = computed(() => new Set(props.chosenKeys));

function isChosen(item) {
  return (chosenSet.value.has(item.key) ||
    (item.kind === "skill" && props.chosenKeys.includes(item.key)));
}

function onEnter(item) {
  emit("update:highlight", item.__idx);
}
function onClick(item) {
  emit("choose", item);
}
</script>

<template>
  <div class="cmd-panel" ref="panelEl">
    <ul class="cmd-list">
      <template v-for="group in groupedItems" :key="group.kind">
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
            'cmd-item--active': item.__idx === highlight,
            'cmd-item--chosen': isChosen(item),
          }"
          @mouseenter="onEnter(item)"
          @click="onClick(item)"
        >
          <span class="cmd-item__key">{{ item.displayKey }}</span>
          <span class="cmd-item__name">{{
            item.kind === "skill" ? item.desc || "" : item.name
          }}</span>
          <span class="cmd-item__badge" :class="'cmd-item__badge--' + item.kind">{{
            item.kind
          }}</span>
          <span v-if="isChosen(item)" class="cmd-item__check">✓</span>
        </li>
      </template>
      <li v-if="!filteredItems.length" class="cmd-panel__empty">无匹配命令</li>
    </ul>
  </div>
</template>

<style scoped lang="less">
.cmd-panel {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 100%;
  margin-bottom: 8px;
  z-index: 20;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
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
</style>
