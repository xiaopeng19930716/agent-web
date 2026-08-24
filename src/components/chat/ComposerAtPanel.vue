<script setup>
import { ref, computed, watch } from "vue";
import { fetchProjectFiles, searchProjectFiles } from "../../api/agent.js";

const props = defineProps({
  active: { type: Object, default: null },
  show: { type: Boolean, default: false },
  keyword: { type: String, default: "" },
});
const emit = defineEmits(["choose", "close"]);

const keyword = ref("");
const highlight = ref(0);
const dir = ref("");
const dirStack = ref([]);
const entries = ref([]);
const searchResults = ref([]);
const loading = ref(false);
const err = ref("");

// 父级传入的关键词（输入框 @ 后面的内容）变化时同步
watch(
  () => props.keyword,
  (v) => {
    if (v !== keyword.value) {
      keyword.value = v;
      onInput();
    }
  }
);

const searchMode = computed(() => keyword.value.trim() !== "");
const items = computed(() => (searchMode.value ? searchResults.value : entries.value));

async function loadDir(path) {
  if (!props.active) return;
  loading.value = true;
  err.value = "";
  const res = await fetchProjectFiles(props.active.id, path);
  loading.value = false;
  if (res.error) {
    err.value = res.error;
    entries.value = [];
    return;
  }
  entries.value = res.items;
  dir.value = res.path;
  highlight.value = 0;
}
async function doSearch() {
  if (!props.active) return;
  const kw = keyword.value.trim();
  if (!kw) {
    searchResults.value = [];
    return;
  }
  const res = await searchProjectFiles(props.active.id, kw);
  searchResults.value = res.error ? [] : res.results;
  highlight.value = 0;
}
function enterDir(item) {
  dirStack.value = [...dirStack.value, dir.value];
  keyword.value = "";
  loadDir(item.path);
}
function goParent() {
  if (!dirStack.value.length) return;
  const prev = dirStack.value[dirStack.value.length - 1];
  dirStack.value = dirStack.value.slice(0, -1);
  keyword.value = "";
  loadDir(prev || "");
}
function onInput() {
  if (searchMode.value) scheduleSearch();
  else {
    searchResults.value = [];
    loadDir("");
  }
  highlight.value = 0;
}
let searchTimer = null;
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(), 200);
}

function onKeydown(e) {
  const list = items.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlight.value = Math.min(highlight.value + 1, Math.max(list.length - 1, 0));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlight.value = Math.max(highlight.value - 1, 0);
  } else if (e.key === "Enter") {
    if (!list.length) return;
    e.preventDefault();
    emit("choose", list[highlight.value]);
  } else if (e.key === "ArrowRight") {
    const item = list[highlight.value];
    if (item && item.type === "dir") {
      e.preventDefault();
      enterDir(item);
    }
  } else if (e.key === "ArrowLeft") {
    if (dirStack.value.length || dir.value) {
      e.preventDefault();
      goParent();
    }
  } else if (e.key === "Escape") {
    emit("close");
  }
}

function open() {
  keyword.value = "";
  dir.value = "";
  dirStack.value = [];
  highlight.value = 0;
  loadDir("");
}

// 面板显示时自动打开（加载项目根目录）
watch(
  () => props.show,
  (v) => {
    if (v && props.active) open();
  },
  { immediate: true }
);

defineExpose({ open, onKeydown });
</script>

<template>
  <div class="at-panel" @keydown="onKeydown">
    <div class="at-panel__toolbar">
      <span class="at-hint-icon">@</span>
      <span v-if="!searchMode" class="at-breadcrumb">
        <button class="at-back" @click="goParent">← 上级</button>
        <span class="at-crumb-path">{{ dir || "项目根" }}</span>
      </span>
      <input
        v-if="active"
        class="at-search"
        placeholder="搜索文件/目录…"
        v-model="keyword"
        @input="onInput"
      />
      <span v-if="loading" class="at-loading">加载中…</span>
    </div>
    <div v-if="err" class="at-err">{{ err }}</div>
    <ul v-else class="at-list">
      <li
        v-for="(item, i) in items"
        :key="item.path"
        class="at-item"
        :class="{ 'at-item--active': i === highlight }"
        @mouseenter="highlight = i"
        @click="emit('choose', item)"
      >
        <span
          class="at-item__type"
          :class="item.type === 'dir' ? 'at-item__type--dir' : 'at-item__type--file'"
          >{{ item.type === "dir" ? "📁" : "📄" }}</span
        >
        <span class="at-item__name">{{ item.name }}</span>
        <button
          v-if="item.type === 'dir'"
          class="at-item__arrow"
          title="进入目录"
          @click.stop="enterDir(item)"
        >
          ›
        </button>
        <span v-else class="at-item__path">{{ item.path }}</span>
      </li>
      <li v-if="!items.length" class="at-empty">无匹配项</li>
    </ul>
  </div>
</template>

<style scoped lang="less">
.at-panel {
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
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
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
</style>
