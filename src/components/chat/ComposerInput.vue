<script setup>
import { ref, computed, nextTick } from 'vue'
import { Plus } from 'lucide-vue-next'
import { settings, flattenVendors } from '../../settings.js'
import { fetchProjectFiles, searchProjectFiles } from '../../api/agent.js'

const props = defineProps({
  active: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  availableSkills: { type: Array, default: () => [] },
})
const emit = defineEmits(['send', 'open-add', 'new-project-chat'])

// ===== 富文本输入框（contenteditable）=====
const composerTokens = ref([]) // [{ type:'text', text } | { type:'tag', kind, key, label }]
const composerEl = ref(null)

// 对话框内设置：思考强度 / 权限级别（共享 settings 实例）
const effort = computed({
  get: () => settings.effort || 'medium',
  set: (v) => (settings.effort = v),
})
const permission = computed({
  get: () => settings.permission || 'full',
  set: (v) => (settings.permission = v),
})

// 模型按供应商分组
const PRESET_VENDOR_NAMES = {
  'bailian-coding': '阿里云百炼 · Coding Plan',
  'bailian-token': '阿里云百炼 · Token Plan',
  deepseek: 'DeepSeek',
  zhipu: '智谱 GLM · Coding Plan',
  tencent: '腾讯混元 · Coding',
}
const vendorNameMap = computed(() => {
  const m = { ...PRESET_VENDOR_NAMES }
  const customs = Array.isArray(settings.customVendors) ? settings.customVendors : []
  for (const v of customs) {
    if (v && v.key) m[v.key] = v.name || v.key
  }
  return m
})
function vendorLabel(vk) {
  if (!vk) return '其他 / 自定义'
  return vendorNameMap.value[vk] || vk
}
const groupedModels = computed(() => {
  const list = flattenVendors(settings.vendors)
  const disabled = new Set(Array.isArray(settings.disabledVendors) ? settings.disabledVendors : [])
  const groups = new Map()
  for (const m of list) {
    const key = m.vendorKey || '__custom__'
    if (key !== '__custom__' && disabled.has(key)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === '__custom__') return 1
    if (b === '__custom__') return -1
    return (vendorNameMap[a] || a).localeCompare(vendorNameMap[b] || b, 'zh')
  })
  return order.map((k) => ({ key: k, label: vendorLabel(k), items: groups.get(k) }))
})

// ===== 工具命令面板（输入框按 "/" 触发）=====
const BASE_TOOLS = [
  { key: 'listFiles', name: '列出文件', desc: 'listFiles - 递归列出项目目录结构' },
  { key: 'readFile', name: '读取文件', desc: 'readFile - 读取项目内某个文件的完整内容' },
  { key: 'writeFile', name: '写入文件', desc: 'writeFile - 创建或覆盖写入文件（需完全访问）' },
  { key: 'editFile', name: '编辑文件', desc: 'editFile - 在文件中替换代码片段（需完全访问）' },
  { key: 'searchInProject', name: '搜索项目', desc: 'searchInProject - 按正则搜索文件名或内容' },
]
const availableMcp = computed(() => {
  const mcp = settings.mcpServers || {}
  const disabled = new Set(Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : [])
  return Object.entries(mcp)
    .filter(([name, cfg]) => cfg && cfg.enabled !== false && !disabled.has(name))
    .map(([name]) => ({ key: name, kind: 'mcp', name, desc: `MCP 服务器：${name}` }))
})
const sessionToolCmds = ref([])
const showCmdPanel = ref(false)
const cmdFilter = ref('')
const cmdHighlight = ref(0)
// 触发符(@ / )在 composer DOM 中的精确位置
let triggerRange = null
// 面板中选择工具回车后，阻止同一次 Enter 继续触发 send()
let suppressSend = false
const selectedSkills = ref([])
const selectedMcp = ref([])

// 全部可选命令（文件工具 + 技能 + MCP）
const allCmdItems = computed(() => {
  const items = [...BASE_TOOLS.map((t) => ({ ...t, kind: 'tool' }))]
  for (const s of props.availableSkills) items.push({ key: s.key, kind: 'skill', name: s.name, desc: s.desc })
  for (const m of availableMcp.value) items.push({ key: m.key, kind: 'mcp', name: m.name, desc: m.desc })
  return items
})
// 过滤后的命令列表
const filteredCmdItems = computed(() => {
  const q = cmdFilter.value.trim().toLowerCase()
  if (!q) return allCmdItems.value
  return allCmdItems.value.filter(
    (it) => it.key.toLowerCase().includes(q) || it.name.toLowerCase().includes(q)
  )
})

// 已勾选的技能 id（persist 到本会话）
// 在输入框中已选择的命令（用于高亮）
const chosenCmds = computed(() => new Set(sessionToolCmds.value))
const isCmdChosen = (item) =>
  chosenCmds.value.has(item.key) ||
  (item.kind === 'skill' && selectedSkills.value.includes(item.key)) ||
  (item.kind === 'mcp' && selectedMcp.value.includes(item.key))

// 选择某个命令：以高亮 tag 插入输入框
function chooseCmd(item) {
  if (item.kind === 'tool') {
    sessionToolCmds.value = [...new Set([...sessionToolCmds.value, item.key])]
  } else if (item.kind === 'skill') {
    selectedSkills.value = [...new Set([...selectedSkills.value, item.key])]
  } else if (item.kind === 'mcp') {
    selectedMcp.value = [...new Set([...selectedMcp.value, item.key])]
  }
  const label = item.key
  insertTagAtTrigger({ type: 'tag', kind: item.kind, key: item.key, label })
  showCmdPanel.value = false
  cmdFilter.value = ''
  composerEl.value?.focus()
}

// ===== @ 文件面板（关联项目时，输入 @ 选择项目文件）=====
const showAtPanel = ref(false)
const atKeyword = ref('')
const atHighlight = ref(0)
const atDir = ref('')
const atDirStack = ref([])
const atEntries = ref([])
const atSearchResults = ref([])
const atLoading = ref(false)
const atErr = ref('')
const atSearchMode = computed(() => atKeyword.value.trim() !== '')
const atItems = computed(() => (atSearchMode.value ? atSearchResults.value : atEntries.value))

async function openAtPanel() {
  if (!props.active) return
  showAtPanel.value = true
  atDir.value = ''
  atDirStack.value = []
  atKeyword.value = ''
  atHighlight.value = 0
  await loadAtDir('')
}
async function loadAtDir(dir) {
  if (!props.active) return
  atLoading.value = true
  atErr.value = ''
  const res = await fetchProjectFiles(props.active.id, dir)
  atLoading.value = false
  if (res.error) {
    atErr.value = res.error
    atEntries.value = []
    return
  }
  atEntries.value = res.items
  atDir.value = res.path
  atHighlight.value = 0
}
async function doAtSearch() {
  if (!props.active) return
  const kw = atKeyword.value.trim()
  if (!kw) {
    atSearchResults.value = []
    return
  }
  const res = await searchProjectFiles(props.active.id, kw)
  atSearchResults.value = res.error ? [] : res.results
  atHighlight.value = 0
}
async function enterAtDir(item) {
  atDirStack.value = [...atDirStack.value, atDir.value]
  atKeyword.value = ''
  await loadAtDir(item.path)
}
function goAtParent() {
  if (!atDirStack.value.length) return
  const prev = atDirStack.value[atDirStack.value.length - 1]
  atDirStack.value = atDirStack.value.slice(0, -1)
  atKeyword.value = ''
  loadAtDir(prev || '')
}
// 选择文件或文件夹：以高亮 tag 插入输入框
function chooseAtFile(item) {
  const suffix = item.type === 'dir' ? '/' : ''
  const ref = `${item.path}${suffix}`
  const kind = item.type === 'dir' ? 'dir' : 'file'
  insertTagAtTrigger({ type: 'tag', kind, key: ref, label: ref })
  showAtPanel.value = false
  composerEl.value?.focus()
}
function clickAtItem(item) {
  chooseAtFile(item)
}

// 处理 @ 关键字输入（debounce 搜索）
let atSearchTimer = null
function scheduleAtSearch() {
  if (atSearchTimer) clearTimeout(atSearchTimer)
  atSearchTimer = setTimeout(() => {
    doAtSearch()
  }, 200)
}

// 富文本输入框辅助
function getComposerText() {
  const el = composerEl.value
  if (!el) return ''
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent || ''
  }
  return out
}
function syncTokensFromDom() {
  const el = composerEl.value
  if (!el) return
  const tokens = []
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) tokens.push({ type: 'text', text: node.textContent })
    } else if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.composerTag) {
      tokens.push({
        type: 'tag',
        kind: node.dataset.composerTag,
        key: node.dataset.composerKey || '',
        label: node.dataset.composerLabel || '',
      })
    }
  }
  composerTokens.value = tokens
}
function buildTagEl(t) {
  const span = document.createElement('span')
  span.className = 'composer-tag'
  span.classList.add(`composer-tag--${t.kind}`)
  span.dataset.composerTag = t.kind
  span.dataset.composerKey = t.key
  span.dataset.composerLabel = t.label
  span.contentEditable = 'false'
  const label = document.createElement('span')
  label.className = 'composer-tag__label'
  label.textContent = (t.kind === 'file' || t.kind === 'dir' ? '@' : '/') + t.label
  span.appendChild(label)
  return span
}
// 在触发符原位插入 tag
function insertTagAtTrigger(t) {
  const el = composerEl.value
  if (!el) return
  el.focus()
  const tagEl = buildTagEl(t)
  const spaceAfter = document.createTextNode(' ')
  let insertRange
  if (triggerRange) {
    const node = triggerRange.startContainer
    if (!node || !el.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      triggerRange = null
    } else {
      const r = document.createRange()
      r.setStart(node, triggerRange.startOffset)
      r.setEnd(node, node.textContent.length)
      insertRange = r
    }
  }
  if (!insertRange) {
    insertRange = document.createRange()
    insertRange.selectNodeContents(el)
    insertRange.collapse(false)
  }
  const startNode = insertRange.startContainer
  const startOff = insertRange.startOffset
  if (startNode && startNode.nodeType === Node.TEXT_NODE && startOff > 0) {
    const before = startNode.textContent.slice(0, startOff)
    if (!/\s$/.test(before)) {
      const sp = document.createTextNode(' ')
      insertRange.insertNode(sp)
    }
  }
  insertRange.deleteContents()
  const insertPoint = document.createRange()
  if (insertRange.startContainer && el.contains(insertRange.startContainer)) {
    insertPoint.setStart(insertRange.startContainer, insertRange.startOffset)
  } else {
    insertPoint.selectNodeContents(el)
    insertPoint.collapse(false)
  }
  insertPoint.collapse(true)
  insertPoint.insertNode(tagEl)
  insertPoint.setStartAfter(tagEl)
  insertPoint.collapse(true)
  insertPoint.insertNode(spaceAfter)
  insertPoint.setStartAfter(spaceAfter)
  insertPoint.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(insertPoint)
  triggerRange = null
  syncTokensFromDom()
}

// 输入框输入统一触发
function onCmdInput() {
  syncTokensFromDom()
  const el = composerEl.value
  let targetNode = null
  let targetLocalIdx = -1
  let foundSym = ''
  let text = ''
  if (el) {
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue
      const txt = child.textContent || ''
      text += txt
      const a = txt.lastIndexOf('@')
      const b = txt.lastIndexOf('/')
      if (a === -1 && b === -1) continue
      const pick = a > b ? a : b
      const sym = a > b ? '@' : '/'
      const tail = txt.slice(pick)
      if (/\s/.test(tail)) continue
      targetNode = child
      targetLocalIdx = pick
      foundSym = sym
    }
  }
  if (!targetNode) {
    triggerRange = null
    showAtPanel.value = false
    showCmdPanel.value = false
    return
  }
  const range = document.createRange()
  range.setStart(targetNode, targetLocalIdx)
  range.collapse(true)
  triggerRange = range
  const tail = (targetNode.textContent || '').slice(targetLocalIdx)
  if (foundSym === '@' && props.active) {
    showCmdPanel.value = false
    const at = tail.match(/^@(\S*)$/)
    if (!showAtPanel.value) {
      openAtPanel()
    }
    atKeyword.value = at ? at[1] : ''
    atHighlight.value = 0
    if (at && at[1]) scheduleAtSearch()
    else atSearchResults.value = []
    showAtPanel.value = true
    return
  }
  showAtPanel.value = false
  if (foundSym === '/') {
    const m = tail.match(/^\/(\S*)$/)
    if (m) {
      cmdFilter.value = m[1]
      showCmdPanel.value = true
      cmdHighlight.value = 0
    } else {
      showCmdPanel.value = false
    }
  } else {
    showCmdPanel.value = false
  }
}

// @ 面板键盘处理
function onAtKeydown(e) {
  if (!showAtPanel.value) return
  const list = atItems.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    atHighlight.value = Math.min(atHighlight.value + 1, Math.max(list.length - 1, 0))
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    atHighlight.value = Math.max(atHighlight.value - 1, 0)
  } else if (e.key === 'Enter') {
    if (!list.length) return
    e.preventDefault()
    suppressSend = true
    chooseAtFile(list[atHighlight.value])
  } else if (e.key === 'ArrowRight') {
    const item = list[atHighlight.value]
    if (item && item.type === 'dir') {
      e.preventDefault()
      enterAtDir(item)
    }
  } else if (e.key === 'ArrowLeft') {
    if (atDirStack.value.length || atDir.value) {
      e.preventDefault()
      goAtParent()
    }
  } else if (e.key === 'Escape') {
    showAtPanel.value = false
  }
}
// 键盘处理：优先 @ 文件面板，其次 / 命令面板
function onCmdKeydown(e) {
  if (showAtPanel.value) {
    onAtKeydown(e)
    return
  }
  if (!showCmdPanel.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    cmdHighlight.value = Math.min(cmdHighlight.value + 1, filteredCmdItems.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    cmdHighlight.value = Math.max(cmdHighlight.value - 1, 0)
  } else if (e.key === 'Enter' && filteredCmdItems.value.length) {
    e.preventDefault()
    suppressSend = true
    chooseCmd(filteredCmdItems.value[cmdHighlight.value])
  } else if (e.key === 'Escape') {
    showCmdPanel.value = false
  }
}

async function focusComposer() {
  await nextTick()
  composerEl.value?.focus()
}
function onAtInput() {
  if (atSearchMode.value) scheduleAtSearch()
  else {
    atSearchResults.value = []
    loadAtDir('')
  }
  atHighlight.value = 0
}

// 已选工具标签（展示用）
const chosenToolTags = computed(() => [
  ...sessionToolCmds.value.map((k) => ({ kind: 'tool', key: k })),
  ...selectedSkills.value.map((k) => ({ kind: 'skill', key: k })),
  ...selectedMcp.value.map((k) => ({ kind: 'mcp', key: k })),
])
function removeToolTag(tag) {
  if (tag.kind === 'tool') sessionToolCmds.value = sessionToolCmds.value.filter((k) => k !== tag.key)
  else if (tag.kind === 'skill') selectedSkills.value = selectedSkills.value.filter((k) => k !== tag.key)
  else if (tag.kind === 'mcp') selectedMcp.value = selectedMcp.value.filter((k) => k !== tag.key)
}

// 触发发送：前置检查在子组件，组装与网络请求在容器
function triggerSend() {
  if (suppressSend) {
    suppressSend = false
    return
  }
  if (showCmdPanel.value) return
  if (showAtPanel.value) return
  syncTokensFromDom()
  emit('send', {
    composerTokens: composerTokens.value.map((t) => ({ ...t })),
    sessionToolCmds: [...sessionToolCmds.value],
    selectedSkills: [...selectedSkills.value],
    selectedMcp: [...selectedMcp.value],
  })
}

// 供容器在发送成功后调用：清空输入框
function clear() {
  composerTokens.value = []
  sessionToolCmds.value = []
  selectedSkills.value = []
  selectedMcp.value = []
  if (composerEl.value) composerEl.value.textContent = ''
}

defineExpose({ clear, focusComposer })
</script>

<template>
  <div class="chat__input">
    <div class="chat__input-top">
      <button class="chat__add" title="添加项目" @click="emit('open-add')">＋</button>
      <span v-if="active" class="chat__project-badge" :title="active.path">{{ active.alias }}</span>
      <button
        v-if="active"
        class="chat__newproj"
        title="新建对话"
        @click="emit('new-project-chat')"
      >
        <Plus :size="15" />
      </button>
      <div class="chat__input-top-right">
        <label class="chat__select">
          模型
          <a-select
            v-model:value="settings.activeModel"
            style="width: 150px"
            :options="groupedModels"
            :field-names="{ label: 'label', value: 'key', options: 'items' }"
            size="small"
          />
        </label>
        <label class="chat__select">
          强度
          <a-select v-model:value="effort" style="width: 88px" size="small" :options="[
            { value: 'low', label: '省量' },
            { value: 'medium', label: '均衡' },
            { value: 'high', label: '深度' },
          ]" />
        </label>
        <label class="chat__select">
          权限
          <a-select v-model:value="permission" style="width: 96px" size="small" :options="[
            { value: 'full', label: '完全访问' },
            { value: 'read-only', label: '只读' },
            { value: 'none', label: '不允许' },
          ]" />
        </label>
      </div>
    </div>

    <!-- @ 文件/目录 面板 -->
    <div v-if="showAtPanel" class="at-panel">
      <div class="at-panel__toolbar">
        <span class="at-hint-icon">@</span>
        <span v-if="!atSearchMode" class="at-breadcrumb">
          <button class="at-back" @click="goAtParent">← 上级</button>
          <span class="at-crumb-path">{{ atDir || '项目根' }}</span>
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
          <span class="at-item__type" :class="item.type === 'dir' ? 'at-item__type--dir' : 'at-item__type--file'">
            {{ item.type === 'dir' ? '📁' : '📄' }}
          </span>
          <span class="at-item__name">{{ item.name }}</span>
          <button
            v-if="item.type === 'dir'"
            class="at-item__arrow"
            title="进入目录"
            @click.stop="enterAtDir(item)"
          >›</button>
          <span v-else class="at-item__path">{{ item.path }}</span>
        </li>
        <li v-if="!atItems.length" class="at-empty">无匹配项</li>
      </ul>
    </div>

    <!-- / 工具命令面板 -->
    <div v-if="showCmdPanel" class="cmd-panel">
      <div class="cmd-panel__hint">
        <span class="at-hint-icon">/</span>
        输入关键字筛选工具 / 技能 / MCP，↑↓ 选择，Enter 确认
      </div>
      <ul class="cmd-list">
        <li
          v-for="(item, i) in filteredCmdItems"
          :key="item.kind + ':' + item.key"
          class="cmd-item"
          :class="{
            'cmd-item--active': i === cmdHighlight,
            'cmd-item--chosen': isCmdChosen(item),
          }"
          @mouseenter="cmdHighlight = i"
          @click="chooseCmd(item)"
        >
          <span class="cmd-item__key">{{ item.key }}</span>
          <span class="cmd-item__name">{{ item.name }}</span>
          <span class="cmd-item__badge" :class="'cmd-item__badge--' + item.kind">{{ item.kind }}</span>
          <span v-if="isCmdChosen(item)" class="cmd-item__check">✓</span>
        </li>
        <li v-if="!filteredCmdItems.length" class="cmd-panel__empty">无匹配命令</li>
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
    ></div>

    <!-- 已选工具标签 -->
    <div v-if="chosenToolTags.length" class="tool-tags">
      <span
        v-for="(t, i) in chosenToolTags"
        :key="i"
        class="tool-tag"
        :class="'tool-tag--' + t.kind"
      >
        {{ t.kind === 'tool' ? '/' : t.kind === 'skill' ? '/skill:' : '/mcp:' }}{{ t.key }}
        <button class="tool-tag__x" @click="removeToolTag(t)">×</button>
      </span>
    </div>

    <div class="chat__input-bottom">
      <button class="chat__send" :disabled="loading" @click="triggerSend">
        <span class="chat__send-icon"></span>
        发送
      </button>
    </div>
  </div>
</template>

<style scoped lang="less">
.chat__input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 16px 16px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 14px;
}
.chat__input-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat__input-top-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.chat__add {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #475569;
  font-size: 20px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chat__add:hover {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.chat__project-badge {
  display: inline-flex;
  align-items: center;
  max-width: 160px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  background: #f1f5f9;
  color: #1f2937;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.chat__newproj {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  margin-left: -6px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chat__newproj:hover {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.chat__select {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #64748b;
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
  flex: 1;
  min-height: 36px;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.6;
  outline: none;
  word-break: break-word;
}
.chat__input-composer:empty::before {
  content: attr(data-placeholder);
  color: #94a3b8;
  pointer-events: none;
}
/* 内联高亮 tag（@文件//工具） */
.composer-tag {
  display: inline-block;
  padding: 0 6px;
  margin: 0 2px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  vertical-align: baseline;
  box-sizing: border-box;
}
.composer-tag--file { background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; }
.composer-tag--dir { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
.composer-tag--tool { background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc; }
.composer-tag--skill { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.composer-tag--mcp { background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; }

:deep(.composer-tag__label)  {
  display: inline-block;
  font-family: 'Fira Code', Consolas, monospace;
  font-weight: 500;
  font-size: 14px;
  line-height: inherit;
  letter-spacing: 0.2px;
  vertical-align: baseline;
}

/* 工具命令面板 */
.cmd-panel {
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
  font-family: 'Fira Code', Consolas, monospace;
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
.cmd-item__badge--file { background: #dbeafe; color: #1d4ed8; }
.cmd-item__badge--skill { background: #dcfce7; color: #15803d; }
.cmd-item__badge--mcp { background: #fef3c7; color: #b45309; }
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
  font-family: 'Fira Code', Consolas, monospace;
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

/* 已选工具标签 */
.tool-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tool-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.tool-tag--file { background: #dbeafe; color: #1d4ed8; }
.tool-tag--skill { background: #dcfce7; color: #15803d; }
.tool-tag--mcp { background: #fef3c7; color: #b45309; }
.tool-tag__x {
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.7;
}
.tool-tag__x:hover {
  opacity: 1;
}

.chat__input-bottom {
  display: flex;
  justify-content: flex-end;
}
.chat__send {
  height: 36px;
  padding: 0 22px;
  flex-shrink: 0;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: background 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.chat__send:hover {
  background: #1d4ed8;
}
.chat__send:disabled {
  background: #1e3a8a;
  color: #93c5fd;
  cursor: not-allowed;
}
.chat__send-icon {
  display: inline-flex;
  align-items: center;
}
</style>
