<script setup>
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { Shield, Brain, Plus, Wrench, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-vue-next'
import { Button as AButton } from 'ant-design-vue'
import { streamChat } from '../api/agent.js'
import ChatLogDrawer from './ChatLogDrawer.vue'
import { settings, flattenVendors } from '../settings.js'
import {
  projects,
  activeProjectId,
  fetchProjects,
  addProject,
  removeProject,
  setActiveProject,
  getActiveProject,
} from '../projects.js'
import {
  sessions,
  fetchSessions,
  createSession,
  updateSession,
  deleteSession,
  NO_PROJECT_KEY,
} from '../sessions.js'

marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})

const input = ref('')
// ===== 富文本输入框（contenteditable）=====
// composerTokens：输入框内结构化内容，text=正文，tag=@文件//工具 高亮引用
const composerTokens = ref([]) // [{ type:'text', text } | { type:'tag', kind, key, label }]
const composerEl = ref(null)
const loading = ref(false)
const error = ref('')
const expandedThinking = ref(false) // 思考区折叠摘要是否展开
const scrollEl = ref(null)

// 对话框内设置：思考强度 / 权限级别
const effort = ref('medium') // low | medium | high
const permission = ref('full') // full(完全访问) | read-only(只读) | none(不允许)

// 添加项目弹窗
const showAdd = ref(false)
const form = reactive({ alias: '', path: '', displayName: '', needsManualPath: false })
const formError = ref('')
const dirPickerSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const dirPickerHint = computed(() =>
  dirPickerSupported
    ? '点击右侧"选择文件夹"按钮，从电脑中选择项目目录'
    : '当前浏览器不支持选择文件夹，无法添加项目'
)
const canConfirm = computed(() => !!form.alias.trim() && !!form.path.trim())

async function pickDirectory() {
  if (!dirPickerSupported) return
  try {
    const handle = await window.showDirectoryPicker()
    const dirName = handle.name
    formError.value = '正在定位目录…'
    // 浏览器不暴露绝对路径。优先用 getParent() 逐级上溯拼出相对路径链，
    // 交给后端做 O(根数) 次 stat 精确校验（毫秒级）；失败才回退名称搜索。
    const relSegments = []
    let cur = handle
    try {
      while (cur && typeof cur.getParent === 'function') {
        const parent = await cur.getParent()
        if (!parent || !parent.name) break
        relSegments.unshift(parent.name)
        if (relSegments.length >= 10) break
        cur = parent
      }
    } catch {
      // getParent 不可用或权限受限，走名称搜索兜底
    }
    const rel = relSegments.join('/')
    form.displayName = rel ? rel + '/' + dirName : dirName
    try {
      const params = new URLSearchParams({ name: dirName })
      if (rel) params.set('path', rel + '/' + dirName)
      const resp = await fetch('/api/locate-dir?' + params.toString())
      if (resp.ok) {
        const data = await resp.json()
        if (data.path) {
          form.path = data.path
          form.displayName = data.path
          formError.value = ''
          return
        }
        if (data.results && data.results.length) {
          form.path = data.results[0]
          form.displayName = data.results[0]
          formError.value = ''
          return
        }
      }
    } catch {
      // 定位失败，回退到手动输入
    }
    // 未能自动定位：保留目录名/相对路径作为草稿，提示用户手动补全绝对路径
    form.path = form.displayName
    form.needsManualPath = true
    formError.value = '未能自动定位到完整路径，请在输入框手动补全绝对路径（如 C:/Users/.../' + dirName + '）'
  } catch (e) {
    // 用户取消选择
  }
}

// 兜底情况下允许用户在输入框手动补全绝对路径
function onPathInput(e) {
  form.displayName = e.target.value
  form.path = e.target.value
  form.needsManualPath = false
}

const active = computed(() => getActiveProject())

// 模型按供应商分组
const PRESET_VENDOR_NAMES = {
  'bailian-coding': '阿里云百炼 · Coding Plan',
  'bailian-token': '阿里云百炼 · Token Plan',
  deepseek: 'DeepSeek',
  zhipu: '智谱 GLM · Coding Plan',
  tencent: '腾讯混元 · Coding',
}
// 合并预置供应商名 + 自定义供应商名（自定义用填写时的 name）
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

// 当前会话对象
const activeSession = computed(() => sessions.list.find((s) => s.id === sessions.activeSessionId) || null)
const currentMessages = computed(() => (activeSession.value ? activeSession.value.messages : []))
const showLog = ref(false)

// ===== 工具命令面板（输入框按 "/" 触发）=====
// 基础文件工具（key 与后端 buildTools 对齐）
const BASE_TOOLS = [
  { key: 'listFiles', name: '列出文件', desc: 'listFiles - 递归列出项目目录结构' },
  { key: 'readFile', name: '读取文件', desc: 'readFile - 读取项目内某个文件的完整内容' },
  { key: 'writeFile', name: '写入文件', desc: 'writeFile - 创建或覆盖写入文件（需完全访问）' },
  { key: 'editFile', name: '编辑文件', desc: 'editFile - 在文件中替换代码片段（需完全访问）' },
  { key: 'searchInProject', name: '搜索项目', desc: 'searchInProject - 按正则搜索文件名或内容' },
]
// 可选技能工具（来自已启用 skills 扫描结果）
const availableSkills = ref([])
// 可选 MCP 工具（来自 settings.mcpServers 已启用项）
const availableMcp = computed(() => {
  const mcp = settings.mcpServers || {}
  const disabled = new Set(Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : [])
  return Object.entries(mcp)
    .filter(([name, cfg]) => cfg && cfg.enabled !== false && !disabled.has(name))
    .map(([name]) => ({ key: name, kind: 'mcp', name, desc: `MCP 服务器：${name}` }))
})
// 本会话已启用的工具命令（在输入框中以 /xxx 形式展示）
const sessionToolCmds = ref([])
// 命令面板状态
const showCmdPanel = ref(false)
const cmdFilter = ref('')
const cmdHighlight = ref(0)
// 触发符(@ / )在 composer DOM 中的精确位置：onCmdInput 时设置，
// 选中文件/命令时用它在原位插入 tag；位置失效（如文本被改）时回退到末尾。
let triggerRange = null
const inputEl = ref(null)
// ===== 富文本输入框辅助 =====
// 读取 contenteditable 的纯文本（正文，不含 tag 引用）
// 只拼接文本节点，忽略 tag 元素（避免把 tag 的 × 和内容计入触发检测）
function getComposerText() {
  const el = composerEl.value
  if (!el) return ''
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent || ''
  }
  return out
}
// 解析 contenteditable DOM 为 tokens（用于发送与面板触发）
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
// 从 tokens 重建 DOM（清空并重绘）——用于发送后清空等场景
function renderTokensToDom() {
  const el = composerEl.value
  if (!el) return
  el.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const t of composerTokens.value) {
    if (t.type === 'text') {
      frag.appendChild(document.createTextNode(t.text))
    } else {
      frag.appendChild(buildTagEl(t))
    }
  }
  el.appendChild(frag)
}
// 构建 tag 元素（@文件//工具）
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
// 面板中选择工具回车后，阻止同一次 Enter 继续触发 send()
let suppressSend = false
// 已勾选的技能 id（persist 到本会话）
const selectedSkills = ref([])
const selectedMcp = ref([])

// 加载可选技能
async function loadAvailableSkills() {
  const { fetchSkills } = await import('../api/agent.js')
  const { skills } = await fetchSkills()
  const enabled = new Set(Array.isArray(settings.enabledSkills) ? settings.enabledSkills : [])
  availableSkills.value = skills.filter((s) => enabled.has(s.id)).map((s) => ({
    key: s.id,
    kind: 'skill',
    name: s.name,
    desc: `技能：${s.description || s.name}`,
  }))
}

// 全部可选命令（文件工具 + 技能 + MCP）
const allCmdItems = computed(() => {
  const items = [...BASE_TOOLS.map((t) => ({ ...t, kind: 'tool' }))]
  for (const s of availableSkills.value) items.push({ key: s.key, kind: 'skill', name: s.name, desc: s.desc })
  for (const m of availableMcp.value) items.push({ key: m.key, kind: 'mcp', name: m.name, desc: m.desc })
  return items
})
// 过滤后的命令列表
const filteredCmdItems = computed(() => {
  const q = cmdFilter.value.trim().toLowerCase()
  if (!q) return allCmdItems.value
  return allCmdItems.value.filter((it) =>
    it.key.toLowerCase().includes(q) || it.name.toLowerCase().includes(q)
  )
})

// 输入框输入统一触发：按 "/" 打开工具命令面板，按 "@"（关联项目时）打开文件面板
// 触发位置：文本中最后一个 "@" 或 "/" 符号之后、且末尾无空格的片段。
//   - 行首有正文（如 "s是飒飒@"）也能在末尾 @ 触发（浏览器不会在 @ 前自动加空格）；
//   - 单独 "@" / "/" / "@关键字" / "/关键字" 都弹面板；
//   - 未选择文件/工具则该 @// 仍作为正文字符保留。
function onCmdInput() {
  // 同步 tokens
  syncTokensFromDom()
  const el = composerEl.value
  // 只扫描 composer 的"直接文本子节点"，跳过任何 tag 内部的文本。
  // 原因：tag 内 label（如 @hello.txt）若被 TreeWalker 收录，会被误判成"用户在输入触发符"，
  // 导致任何后续输入都重开面板。
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
      // 触发符后到结尾不能出现空白（否则视为已结束输入）
      const tail = txt.slice(pick)
      if (/\s/.test(tail)) continue
      // 记录最后一个匹配的位置
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
  // 记录触发符所在位置为 Range（用于后续插入）
  const range = document.createRange()
  range.setStart(targetNode, targetLocalIdx)
  range.collapse(true)
  triggerRange = range
  // 切出 tail 关键字（用于面板过滤）
  const tail = (targetNode.textContent || '').slice(targetLocalIdx)
  if (foundSym === '@' && active.value) {
    // @ 文件面板：关联项目时触发
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
      // 工具/技能/MCP 均支持多次选择（并存），所以即使已选过也照常弹出面板
      showCmdPanel.value = true
      cmdHighlight.value = 0
    } else {
      showCmdPanel.value = false
    }
  } else {
    showCmdPanel.value = false
  }
}

// 在触发符原位插入 tag：使用 onCmdInput 记录的 triggerRange（精确 DOM 位置），
// 自动清理该位置起的残留 "@关键字"/"/关键字"，并在 tag 前后补空格。
function insertTagAtTrigger(t) {
  const el = composerEl.value
  if (!el) return
  el.focus()
  const tagEl = buildTagEl(t)
  const spaceAfter = document.createTextNode(' ')
  let insertRange
  if (triggerRange) {
    // 校验 Range 还附着在 DOM（文本节点没被改没被删）
    const node = triggerRange.startContainer
    if (!node || !el.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      triggerRange = null
    } else {
      // 复用 Range，但起点要"折叠"且终点扩展到尾部以删除残留字符
      const r = document.createRange()
      r.setStart(node, triggerRange.startOffset)
      // 扩展到该文本节点末尾
      r.setEnd(node, node.textContent.length)
      insertRange = r
    }
  }
  if (!insertRange) {
    // 失效回退：插入到 composer 末尾
    insertRange = document.createRange()
    insertRange.selectNodeContents(el)
    insertRange.collapse(false)
  }
  // 在插入前若起点位置紧邻非空白文本，则插入点前补一个空格分隔
  const startNode = insertRange.startContainer
  const startOff = insertRange.startOffset
  if (startNode && startNode.nodeType === Node.TEXT_NODE && startOff > 0) {
    const before = startNode.textContent.slice(0, startOff)
    if (!/\s$/.test(before)) {
      const sp = document.createTextNode(' ')
      insertRange.insertNode(sp)
    }
  }
  // 删掉残留的触发符关键字，然后插入 tag
  insertRange.deleteContents()
  // 再次校准插入点（删除后该节点文本会变短）
  const insertPoint = document.createRange()
  if (insertRange.startContainer && el.contains(insertRange.startContainer)) {
    insertPoint.setStart(insertRange.startContainer, insertRange.startOffset)
  } else {
    insertPoint.selectNodeContents(el)
    insertPoint.collapse(false)
  }
  insertPoint.collapse(true)
  insertPoint.insertNode(tagEl)
  // tag 后补空格，光标移到尾部
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

// 在输入框中已选择的命令（用于高亮）
const chosenCmds = computed(() => new Set(sessionToolCmds.value))
const isCmdChosen = (item) => chosenCmds.value.has(item.key) || item.kind === 'skill' && selectedSkills.value.includes(item.key) || item.kind === 'mcp' && selectedMcp.value.includes(item.key)

// 选择某个命令：以高亮 tag 插入输入框
// 工具/技能/MCP 均支持多次选择（并存）；每次面板交互只选一个。
function chooseCmd(item) {
  if (item.kind === 'tool') {
    sessionToolCmds.value = [...new Set([...sessionToolCmds.value, item.key])]
  } else if (item.kind === 'skill') {
    selectedSkills.value = [...new Set([...selectedSkills.value, item.key])]
  } else if (item.kind === 'mcp') {
    selectedMcp.value = [...new Set([...selectedMcp.value, item.key])]
  }
  const label = item.key
  // 在触发符位置插入 tag；同时清理该位置起的残留 "/关键字"
  insertTagAtTrigger({ type: 'tag', kind: item.kind, key: item.key, label })
  showCmdPanel.value = false
  cmdFilter.value = ''
  composerEl.value?.focus()
}

// 移除已选工具命令
// 键盘处理：优先 @ 文件面板，其次 / 命令面板；方向键 / 回车 / Esc
function onCmdKeydown(e) {
  if (showAtPanel.value) {
    onAtKeydown(e)
    return
  }
  if (!showCmdPanel.value) return
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdHighlight.value = Math.min(cmdHighlight.value + 1, filteredCmdItems.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdHighlight.value = Math.max(cmdHighlight.value - 1, 0) }
  else if (e.key === 'Enter' && filteredCmdItems.value.length) {
    e.preventDefault()
    suppressSend = true // 阻止本次 Enter 继续触发 send()
    chooseCmd(filteredCmdItems.value[cmdHighlight.value])
  }
  else if (e.key === 'Escape') { showCmdPanel.value = false }
}

// ===== @ 文件面板（关联项目时，输入 @ 选择项目文件）=====
// 状态
const showAtPanel = ref(false)
const atKeyword = ref('') // @ 后的关键字
const atHighlight = ref(0)
const atDir = ref('') // 当前浏览目录（相对项目根）
const atDirStack = ref([]) // 目录导航栈
const atEntries = ref([]) // 当前目录下的 items
const atSearchResults = ref([]) // 关键字搜索时的结果
const atLoading = ref(false)
const atErr = ref('')
// 当前是否处于搜索模式
const atSearchMode = computed(() => atKeyword.value.trim() !== '')

// 当前显示的面板列表（搜索模式用搜索结果，浏览模式用当前目录）
const atItems = computed(() => (atSearchMode.value ? atSearchResults.value : atEntries.value))

// 打开 @ 面板（首次加载根目录）
async function openAtPanel() {
  if (!active.value) return
  showAtPanel.value = true
  atDir.value = ''
  atDirStack.value = []
  atKeyword.value = ''
  atHighlight.value = 0
  await loadAtDir('')
}

// 加载某个相对目录
async function loadAtDir(dir) {
  if (!active.value) return
  atLoading.value = true
  atErr.value = ''
  const { fetchProjectFiles } = await import('../api/agent.js')
  const res = await fetchProjectFiles(active.value.id, dir)
  atLoading.value = false
  if (res.error) { atErr.value = res.error; atEntries.value = []; return }
  atEntries.value = res.items
  atDir.value = res.path
  atHighlight.value = 0
}

// @关键字 搜索（全项目递归，同名展示目录）
async function doAtSearch() {
  if (!active.value) return
  const kw = atKeyword.value.trim()
  if (!kw) { atSearchResults.value = []; return }
  const { searchProjectFiles } = await import('../api/agent.js')
  const res = await searchProjectFiles(active.value.id, kw)
  atSearchResults.value = res.error ? [] : res.results
  atHighlight.value = 0
}

// 目录导航：进入子目录
async function enterAtDir(item) {
  atDirStack.value = [...atDirStack.value, atDir.value]
  atKeyword.value = ''
  await loadAtDir(item.path)
}

// 返回上级目录
async function goAtParent() {
  const prev = atDirStack.value[atDirStack.value.length - 1]
  atDirStack.value = atDirStack.value.slice(0, -1)
  atKeyword.value = ''
  await loadAtDir(prev || '')
}

// 选择文件或文件夹：以高亮 tag 插入输入框
// 文件 tag @path；文件夹 tag @path/（带尾斜杠），Agent 可结合 listFiles 浏览目录
async function chooseAtFile(item) {
  const suffix = item.type === 'dir' ? '/' : ''
  const ref = `${item.path}${suffix}`
  const kind = item.type === 'dir' ? 'dir' : 'file'
  // 在触发符位置插入 tag；同时清理该位置起的残留 "@关键字"
  insertTagAtTrigger({ type: 'tag', kind, key: ref, label: ref })
  showAtPanel.value = false
  composerEl.value?.focus()
}

// 点击项主体：文件/文件夹都选中；进入目录通过展开箭头或键盘 →
function clickAtItem(item) {
  chooseAtFile(item)
}

// 处理 @ 关键字输入（debounce 搜索）
let atSearchTimer = null
function scheduleAtSearch() {
  if (atSearchTimer) clearTimeout(atSearchTimer)
  atSearchTimer = setTimeout(() => { doAtSearch() }, 200)
}

// @ 面板键盘处理：Enter 选中（文件/目录）、→ 进入目录、← 返回上级、方向键导航、Esc 关闭
function onAtKeydown(e) {
  if (!showAtPanel.value) return
  const list = atItems.value
  if (e.key === 'ArrowDown') { e.preventDefault(); atHighlight.value = Math.min(atHighlight.value + 1, Math.max(list.length - 1, 0)) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); atHighlight.value = Math.max(atHighlight.value - 1, 0) }
  else if (e.key === 'Enter') {
    if (!list.length) return
    e.preventDefault()
    suppressSend = true
    chooseAtFile(list[atHighlight.value]) // 文件/文件夹均选中
  }
  else if (e.key === 'ArrowRight') {
    const item = list[atHighlight.value]
    if (item && item.type === 'dir') { e.preventDefault(); enterAtDir(item) }
  }
  else if (e.key === 'ArrowLeft') {
    if (atDirStack.value.length || atDir.value) { e.preventDefault(); goAtParent() }
  }
  else if (e.key === 'Escape') { showAtPanel.value = false }
}

// 会话标题重命名
const editingTitle = ref(false)
const titleDraft = ref('')
function startRenameTitle() {
  if (!activeSession.value) return
  titleDraft.value = activeSession.value.title || '新对话'
  editingTitle.value = true
  nextTick(() => {
    const el = document.querySelector('.chat__titlebar-input')
    if (el) {
      el.focus()
      el.select()
    }
  })
}
async function commitRename() {
  if (!editingTitle.value) return
  const s = activeSession.value
  const next = titleDraft.value.trim() || '新对话'
  editingTitle.value = false
  if (s && s.title !== next) {
    s.title = next
    try {
      await updateSession(s.id, { title: next })
    } catch (e) {
      console.error('重命名失败:', e)
    }
  }
}
function cancelRename() {
  editingTitle.value = false
}

function renderMarkdown(text) {
  return marked.parse(text || '')
}

async function scrollToBottom() {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

// 工具调用参数摘要（单行可读）
function prettyArgs(args) {
  if (!args || !Object.keys(args).length) return ''
  try {
    const parts = Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    return parts.join('  ')
  } catch {
    return String(args)
  }
}

// 截断过长文本
function clip(text, n = 1200) {
  const s = String(text || '')
  return s.length > n ? s.slice(0, n) + `…（已截断，共 ${s.length} 字）` : s
}

// 工具结果展开/收起状态（以消息内索引为 key）
const resultExpanded = reactive(new Set())
function toggleResult(ti) {
  if (resultExpanded.has(ti)) resultExpanded.delete(ti)
  else resultExpanded.add(ti)
}

function openAdd() {
  form.alias = ''
  form.path = ''
  form.displayName = ''
  form.needsManualPath = false
  formError.value = ''
  showAdd.value = true
}

// 取路径最后一级目录名
function lastSegment(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

async function confirmAdd() {
  if (!form.alias.trim() || !form.displayName.trim()) {
    formError.value = '别名和目录路径不能为空'
    return
  }
  try {
    const p = await addProject({
      alias: form.alias.trim(),
      path: form.displayName.trim(),
    })
    showAdd.value = false
    // 添加后切换到新项目对应的会话（无则新建）
    await switchProject(p.id)
  } catch (e) {
    formError.value = e.message
  }
}

// 顶栏项目下拉已移除：保留 switchProject 以便切换会话时复用
async function switchProject(pid) {
  setActiveProject(pid === NO_PROJECT_KEY ? null : pid)
  const target = pid
  const existing = sessions.list
    .filter((s) => (s.projectId || NO_PROJECT_KEY) === target)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  if (existing) {
    sessions.activeSessionId = existing.id
  } else {
    await createSession(target)
  }
}

async function newChat() {
  await createSession(activeProjectId.id || NO_PROJECT_KEY)
}

// 在当前项目中新增对话（项目名右侧的 + 按钮）
async function newProjectChat() {
  if (!active.value) return
  await createSession(active.value.id)
}

function deleteCurrent() {
  if (!sessions.activeSessionId) return
  deleteSession(sessions.activeSessionId)
}

async function send() {
  // 命令面板/文件面板中选择的回车不应发送消息
  if (suppressSend) { suppressSend = false; return }
  // 命令面板打开时，Enter 仅用于选择工具，不发送消息
  if (showCmdPanel.value) return
  // @ 文件面板打开时，Enter 仅用于选择文件，不发送消息
  if (showAtPanel.value) return
  // 从富文本输入框同步 tokens
  syncTokensFromDom()

  // 从 tokens 重建正文与引用：
  // - text token：直接拼接为正文
  // - 文件/文件夹 tag：转成 @路径 文本拼入正文（供 Agent 读取/浏览）
  // - 工具/技能/MCP tag：作为 tools/skills/mcpServers 参数，不拼入正文
  const tagToolKeys = new Set()
  const tagSkillIds = new Set()
  const tagMcpNames = new Set()
  const bodyParts = []
  for (const t of composerTokens.value) {
    if (t.type === 'text') {
      bodyParts.push(t.text)
    } else if (t.type === 'tag') {
      if (t.kind === 'tool' && BASE_TOOLS.some((b) => b.key === t.key)) {
        tagToolKeys.add(t.key) // 工具
      } else if (t.kind === 'skill') {
        tagSkillIds.add(t.key)
      } else if (t.kind === 'mcp') {
        tagMcpNames.add(t.key)
      } else {
        // 普通文件 / 文件夹：保留 @路径 引用在正文中
        bodyParts.push(`@${t.key}`)
      }
    }
  }
  let text = bodyParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!text || loading.value) return

  // 与旧式 sessionToolCmds/selectedSkills/selectedMcp 合并（保留兼容）
  const cmdSet = new Set([...sessionToolCmds.value, ...tagToolKeys])
  const fileTools = BASE_TOOLS.map((t) => t.key).filter((k) => cmdSet.has(k))
  const skillIds = [...new Set([...selectedSkills.value, ...tagSkillIds].filter((k) =>
    availableSkills.value.some((s) => s.key === k)))]
  const mcpNames = [...new Set([...selectedMcp.value, ...tagMcpNames].filter((k) =>
    availableMcp.value.some((s) => s.key === k)))]
  const mcpServersPayload = Object.fromEntries(
    mcpNames
      .map((n) => [n, (settings.mcpServers || {})[n]])
      .filter(([, cfg]) => cfg)
  )
  // 若只有引用（tag）而无正文，则以占位提示发送，让 Agent 使用所选内容
  if (!text && (fileTools.length || skillIds.length || mcpNames.length || composerTokens.value.some((t) => t.type === 'tag'))) {
    text = '（请使用所选内容完成任务）'
  }

  // 没有活动会话则新建
  if (!sessions.activeSessionId) {
    await createSession(activeProjectId.id || NO_PROJECT_KEY)
  }
  const session = sessions.list.find((s) => s.id === sessions.activeSessionId)
  if (!session) return

  const pid = active.value?.id ?? null
  error.value = ''
  session.messages.push({ role: 'user', content: text, metadata: { timestamp: Date.now() } })
  // 清空富文本输入框
  input.value = ''
  composerTokens.value = []
  if (composerEl.value) composerEl.value.textContent = ''

  const assistant = reactive({
    role: 'assistant',
    content: '',
    reasoning: '',
    reasoningDone: false,
    toolCalls: [], // [{ name, args, status, result }]
    metadata: {},
  })
  session.messages.push(assistant)
  loading.value = true
  await scrollToBottom()

  const history = session.messages
    .filter((m) => m !== assistant)
    .map((m) => ({ role: m.role, content: m.content }))

  // activeModel 为组合键 "vendorKey/modelId"
  const activeModelId = settings.activeModel.includes('/') ? settings.activeModel.split('/')[1] : settings.activeModel
  const modelId = (pid && active.value.modelId) || activeModelId
  const flat = flattenVendors(settings.vendors)
  const modelObj = flat.find((m) => m.id === modelId) || {}
  const effectiveBaseUrl = modelObj.baseUrl?.trim() || settings.baseUrl
  const effectiveApiKey = (modelObj.apiKey && modelObj.apiKey.trim()) || settings.apiKey

  // 工具调用时间线：按 id/name 维护进行中的条目
  const toolRunById = new Map()

  await streamChat(history, {
    config: {
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: modelId,
      temperature: typeof modelObj.temperature === 'number' ? modelObj.temperature : 0.3,
      maxTokens: modelObj.maxTokens || undefined,
    },
    projectId: pid,
    permission: permission.value,
    effort: effort.value,
    tools: fileTools,
    skills: skillIds,
    mcpServers: Object.keys(mcpServersPayload).length ? mcpServersPayload : undefined,
    onReasoning: (text) => {
      assistant.reasoning += text
      scrollToBottom()
    },
    onToolCall: (payload) => {
      if (payload.status === 'start') {
        const entry = reactive({
          name: payload.name,
          args: payload.args || {},
          status: 'running',
          result: '',
        })
        assistant.toolCalls.push(entry)
        toolRunById.set(payload.name + ':' + assistant.toolCalls.length, entry)
        scrollToBottom()
      } else {
        // 找到匹配的 running 条目（按 name，最近一个未完成）回填结果
        const running = [...assistant.toolCalls].reverse().find((t) => t.name === payload.name && t.status === 'running')
        if (running) {
          running.status = 'done'
          running.result = payload.result || ''
        }
        scrollToBottom()
      }
    },
    onDelta: (delta) => {
      // 进入正式回复：思考阶段结束，收起思考区
      if (!assistant.reasoningDone && assistant.reasoning) assistant.reasoningDone = true
      assistant.content += delta
      scrollToBottom()
    },
    onDone: async (meta) => {
      loading.value = false
      assistant.reasoningDone = true
      // 回填助手消息的元数据日志（时间、模型、token、耗时、状态）
      assistant.metadata = {
        timestamp: Date.now(),
        model: meta?.model || modelId,
        tokens: meta?.tokens ?? null,
        durationMs: meta?.durationMs ?? null,
        status: meta?.status || 'ok',
      }
      // 首条消息作为标题 + 落盘
      if (!session.title || session.title === '新对话') {
        session.title = text.slice(0, 30) || '新对话'
      }
      await updateSession(session.id, { title: session.title, messages: session.messages })
      scrollToBottom()
    },
    onError: (msg) => {
      error.value = msg
      assistant.reasoningDone = true
      assistant.metadata = {
        timestamp: Date.now(),
        model: modelId,
        tokens: null,
        durationMs: null,
        status: 'error',
      }
      loading.value = false
    },
  })
}

onMounted(async () => {
  await fetchProjects()
  try {
    await fetchSessions()
  } catch (e) {
    console.error('加载会话失败:', e)
  }
  await loadAvailableSkills()
  // 首次进入：选中当前项目最近会话或新建
  if (!sessions.activeSessionId) {
    await switchProject(activeProjectId.id || NO_PROJECT_KEY)
  }
})

watch(currentMessages, scrollToBottom)
</script>

<template>
  <div class="chat">
    <!-- 当前会话标题（双击改名） -->
    <div v-if="activeSession" class="chat__titlebar">
      <input
        v-if="editingTitle"
        v-model="titleDraft"
        class="chat__titlebar-input"
        :maxlength="60"
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
      <span
        v-else
        class="chat__titlebar-text"
        title="双击修改会话名称"
        @dblclick="startRenameTitle"
      >{{ activeSession.title || '新对话' }}</span>
      <a-button
        class="chat__log-btn"
        size="small"
        @click="showLog = true"
      >对话日志</a-button>
    </div>

    <!-- 对话区（深色） -->
    <div class="chat__body" ref="scrollEl">
      <div v-if="currentMessages.length === 0" class="chat__empty">
        <template v-if="active">
          已连接到项目「{{ active.alias }}」<br />
          <code class="chat__empty-path" :title="active.path">{{ lastSegment(active.path) }}</code><br />
          让 Agent 帮你读代码、改 bug、加功能，例如：<br />
          “列出 src 目录结构” / “在 App.vue 里加一个按钮”
        </template>
        <template v-else>
          这是一个不关联任何项目的通用对话。<br />
          直接提问即可；如需让 Agent 访问本地代码，点击输入框左侧「＋」添加并选择项目。
        </template>
      </div>

      <div
        v-for="(m, i) in currentMessages"
        :key="i"
        class="msg"
        :class="m.role === 'user' ? 'msg--user' : 'msg--ai'"
      >
        <!-- Agent 思考区：思考中 / 思考完成 + 工具调用时间线 -->
        <div
          v-if="m.role === 'assistant' && (m.reasoning || (m.toolCalls || []).length)"
          class="thinking"
          :class="{ 'thinking--collapsed': m.reasoningDone && !expandedThinking }"
        >
          <button class="thinking__head" @click="m.reasoningDone ? (expandedThinking = !expandedThinking) : null">
            <span class="thinking__dot" :class="{ 'thinking__dot--done': m.reasoningDone }"></span>
            <template v-if="!m.reasoningDone">
              <span class="thinking__title">思考中</span>
              <span class="thinking__dots"><i></i><i></i><i></i></span>
            </template>
            <template v-else>
              <span class="thinking__title thinking__title--done">✓ 思考完成</span>
              <span v-if="(m.toolCalls || []).length" class="thinking__summary">
                已调用 {{ (m.toolCalls || []).length }} 个工具 · 用时思考
              </span>
              <ChevronDown v-if="!expandedThinking" :size="14" class="thinking__chevron" />
              <ChevronUp v-else :size="14" class="thinking__chevron" />
            </template>
          </button>

          <div v-show="!m.reasoningDone || expandedThinking" class="thinking__body">
            <!-- 推理文本 -->
            <div v-if="m.reasoning" class="thinking__reason">{{ m.reasoning }}</div>

            <!-- 工具调用时间线 -->
            <ul v-if="(m.toolCalls || []).length" class="timeline">
              <li v-for="(t, ti) in (m.toolCalls || [])" :key="ti" class="timeline__item">
                <span class="timeline__rail">
                  <span class="timeline__node" :class="{ 'timeline__node--done': t.status === 'done' }">
                    <Check v-if="t.status === 'done'" :size="11" />
                    <Loader2 v-else :size="11" class="timeline__spin" />
                  </span>
                </span>
                <div class="timeline__main">
                  <div class="timeline__head">
                    <span class="timeline__icon">⚙</span>
                    <span class="timeline__name">调用 {{ t.name }}</span>
                    <span class="timeline__status" :class="{ 'timeline__status--done': t.status === 'done' }">
                      {{ t.status === 'done' ? '完成' : '执行中' }}
                    </span>
                  </div>
                  <div v-if="Object.keys(t.args || {}).length" class="timeline__args">
                    {{ prettyArgs(t.args) }}
                  </div>
                  <div v-if="t.status === 'done' && t.result" class="timeline__result">
                    <span class="timeline__result-label" @click="toggleResult(ti)">
                      {{ resultExpanded.has(ti) ? '收起结果' : '查看结果' }}
                    </span>
                    <pre v-show="resultExpanded.has(ti)" class="timeline__result-body">{{ clip(t.result, 1200) }}</pre>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <!-- 气泡 -->
        <div class="bubble" :class="m.role === 'user' ? 'bubble--user' : 'bubble--ai'">
          <div v-if="m.role !== 'user'" class="bubble__avatar" aria-hidden="true">AI</div>
          <div
            v-if="m.role === 'user'"
            class="bubble__text"
          >{{ m.content }}</div>
          <div
            v-else
            class="bubble__content"
            v-html="renderMarkdown(m.content)"
          ></div>
        </div>
      </div>
      <div v-if="error" class="chat__error">{{ error }}</div>
    </div>

    <!-- 复合输入框：+ / 模型 / 思考 / 权限 / textarea / 发送 全部内嵌 -->
    <div class="chat__input">
      <div class="chat__input-top">
        <button v-if="!active" class="chat__add" title="添加项目" @click="openAdd">＋</button>
        <span v-else class="chat__project-badge" :title="active.path">{{ lastSegment(active.path) }}</span>
        <button
          v-if="active"
          class="chat__newproj"
          title="在当前项目中新增对话"
          @click="newProjectChat"
        >
          <Plus :size="14" />
        </button>
        <div class="chat__input-top-right">
          <a-select
            v-model:value="settings.activeModel"
            class="chat__model-select"
            size="middle"
            :dropdown-match-select-width="false"
            title="切换模型"
          >
            <a-select-opt-group v-for="g in groupedModels" :key="g.key" :label="g.label">
              <a-select-option v-for="m in g.items" :key="m.id" :value="m.id">
                {{ m.name }}（{{ m.id }}）
              </a-select-option>
            </a-select-opt-group>
          </a-select>

          <div class="toolbar-chip" title="思考强度">
            <Brain :size="14" />
            <a-select v-model:value="effort" size="small" class="chip-select" :dropdown-match-select-width="false">
              <a-select-option value="low">低</a-select-option>
              <a-select-option value="medium">中</a-select-option>
              <a-select-option value="high">高</a-select-option>
            </a-select>
          </div>

          <div class="toolbar-chip" title="权限级别">
            <Shield :size="14" />
            <a-select v-model:value="permission" size="small" class="chip-select" :dropdown-match-select-width="false">
              <a-select-option value="full">完全访问</a-select-option>
              <a-select-option value="read-only">只读</a-select-option>
              <a-select-option value="none">不允许</a-select-option>
            </a-select>
          </div>
        </div>
      </div>

      <!-- @ 文件面板：关联项目时输入 @ 触发，选择项目文件 -->
      <div v-if="showAtPanel" class="cmd-panel at-panel" @mousedown.prevent>
        <div class="cmd-panel__hint">
          <span class="at-hint-icon">@</span>
          <span>{{ atSearchMode ? `搜索 @${atKeyword}，回车选择文件` : `${atDir || '项目根目录'} —— 点击选中文件/文件夹，→ 或右侧箭头进入文件夹` }}</span>
          <span v-if="atLoading" class="at-loading">加载中…</span>
        </div>
        <div v-if="atSearchMode" class="at-breadcrumb">
          <span>全项目搜索结果（{{ atSearchResults.length }}）</span>
          <button class="at-back" @mousedown.prevent="atKeyword = ''; atSearchResults = []; doAtSearch()">返回目录浏览</button>
        </div>
        <div v-else-if="atDirStack.length" class="at-breadcrumb">
          <button class="at-back" @mousedown.prevent="goAtParent">← 返回上级</button>
          <span class="at-crumb-path">/{{ atDir }}</span>
        </div>
        <div v-if="atErr" class="at-err">{{ atErr }}</div>
        <div
          v-for="(it, idx) in atItems"
          :key="it.path"
          class="cmd-item at-item"
          :class="{ 'cmd-item--active': idx === atHighlight }"
          @click="clickAtItem(it)"
          @mouseenter="atHighlight = idx"
        >
          <span class="at-item__type" :class="it.type === 'dir' ? 'at-item__type--dir' : 'at-item__type--file'">
            {{ it.type === 'dir' ? '📁' : '📄' }}
          </span>
          <span class="cmd-item__name">{{ it.name }}</span>
          <button v-if="it.type === 'dir'" class="at-item__arrow" title="进入文件夹" @click.stop="enterAtDir(it)">›</button>
          <span v-else class="at-item__path">{{ it.path }}</span>
        </div>
        <div v-if="!atLoading && atItems.length === 0" class="cmd-panel__empty">
          {{ atSearchMode ? '未找到匹配的文件' : '该目录为空' }}
        </div>
      </div>

      <!-- 工具命令面板：输入 "/" 触发，"/关键字" 过滤 -->
      <div v-if="showCmdPanel" class="cmd-panel" @mousedown.prevent>
        <div class="cmd-panel__hint">
          <Wrench :size="14" />
          <span>工具命令：输入 /listFiles、/readFile、/writeFile、/editFile、/searchInProject 或技能/MCP 名称，Enter 选用</span>
        </div>
        <div
          v-for="(it, idx) in filteredCmdItems"
          :key="it.key"
          class="cmd-item"
          :class="{ 'cmd-item--active': idx === cmdHighlight, 'cmd-item--chosen': isCmdChosen(it) }"
          @click="chooseCmd(it)"
          @mouseenter="cmdHighlight = idx"
        >
          <span class="cmd-item__key">/{{ it.key }}</span>
          <span class="cmd-item__name">{{ it.name }}</span>
          <span class="cmd-item__badge" :class="`cmd-item__badge--${it.kind}`">{{ it.kind }}</span>
          <span v-if="isCmdChosen(it)" class="cmd-item__check">✓ 已选</span>
        </div>
        <div v-if="filteredCmdItems.length === 0" class="cmd-panel__empty">无匹配的工具</div>
      </div>

      <!-- 富文本输入框：@文件//工具 以高亮 tag 内联显示，正文为普通文字 -->
      <div
        ref="composerEl"
        class="chat__input-composer"
        contenteditable="true"
        data-placeholder="输入你的编程需求；关联项目时可输入 @ 选择文件，/ 选择工具；Enter 发送，Shift+Enter 换行"
        @input="onCmdInput"
        @keydown="onCmdKeydown"
        @keydown.enter.exact.prevent="send"
      ></div>

      <div class="chat__input-bottom">
        <button class="chat__send" :disabled="loading" @click="send">
          {{ loading ? '生成中' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 添加项目弹窗 -->
    <div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
      <div class="modal">
        <h3>添加项目</h3>
        <label class="field">
          <span>别名（显示用）</span>
          <input v-model="form.alias" placeholder="如：我的前端项目" />
        </label>
        <label class="field">
          <span>项目目录</span>
          <div class="field-row">
            <input
              :value="form.displayName"
              :readonly="!!form.path && !form.needsManualPath"
              :class="{ 'input--readonly': !!form.path && !form.needsManualPath }"
              :title="form.path"
              placeholder="请点击右侧按钮选择目录"
              @input="onPathInput"
            />
            <button
              type="button"
              class="btn btn--ghost"
              :disabled="!dirPickerSupported"
              :title="dirPickerHint"
              @click="pickDirectory"
            >
              选择文件夹
            </button>
          </div>
          <small class="field__hint">{{ dirPickerHint }}</small>
        </label>
        <small v-if="formError" class="model-add__error">{{ formError }}</small>
        <div class="modal__actions">
          <button class="btn" @click="showAdd = false">取消</button>
          <button class="btn btn--primary" :disabled="!canConfirm" @click="confirmAdd">添加</button>
        </div>
      </div>
    </div>
  </div>

  <ChatLogDrawer v-model:open="showLog" :session="activeSession" />
</template>

<style scoped lang="less">
.chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  width: 100%;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #ffffff;
}
.chat__titlebar {
  padding: 12px 24px 0;
  display: flex;
  align-items: center;
  min-height: 40px;
  flex-shrink: 0;
}

.chat__log-btn {
  margin-left: auto;
}
.chat__titlebar-text {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: text;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;
}
.chat__titlebar-text:hover {
  background: #f1f5f9;
  border-color: #e2e8f0;
}
.chat__titlebar-input {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  padding: 5px 10px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  outline: none;
  background: #fff;
  width: 100%;
  max-width: 480px;
  font-family: inherit;
}
.chat__titlebar-input:focus {
  box-shadow: 0 0 0 2px #bfdbfe;
}
.chat__body {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
  background: #ffffff;
}
.chat__empty {
  color: #64748b;
  text-align: center;
  margin-top: 48px;
  line-height: 1.9;
  font-size: 14px;
}
.chat__empty-path {
  display: inline-block;
  margin: 8px 0 14px;
  padding: 6px 12px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #1f2937;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
  max-width: 100%;
  word-break: break-all;
}
.msg {
  margin-bottom: 18px;
  max-width: 88%;
  display: flex;
  flex-direction: column;
}
.msg--user {
  margin-left: auto;
  align-items: flex-end;
}

// ===== 气泡 =====
.bubble {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
  animation: bubbleIn 0.16s ease-out;
}
.bubble--user {
  flex-direction: row-reverse;
  margin-left: auto;
}
.bubble__avatar {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, @color-primary, @color-primary-hover);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
}
.bubble__text,
.bubble__content {
  padding: 12px 15px;
  border-radius: 14px;
  line-height: 1.65;
  font-size: 14px;
  word-break: break-word;
}
.bubble--user .bubble__text {
  background: linear-gradient(135deg, @color-primary, @color-primary-hover);
  color: #fff;
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25);
}
.bubble--ai .bubble__content {
  background: #ffffff;
  border: 1px solid @color-border;
  color: @color-text;
  border-bottom-left-radius: 5px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
}
.bubble__content :deep(pre) {
  background: #0d1117;
  color: #e6edf3;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.bubble__content :deep(code) {
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
}
.bubble__content :deep(p code) {
  background: @color-bg-subtle;
  color: @color-text-strong;
  padding: 2px 5px;
  border-radius: 4px;
}

// ===== 思考区 =====
.thinking {
  margin-bottom: 10px;
  max-width: 100%;
  background: #f8fafc;
  border: 1px solid @color-border;
  border-left: 3px solid @color-primary;
  border-radius: 10px;
  padding: 10px 12px;
  animation: bubbleIn 0.16s ease-out;
  transition: background 0.2s, border-color 0.2s;
}
.thinking--collapsed {
  background: #f1f5f9;
  border-left-color: @color-text-muted;
}
.thinking__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: @color-text-strong;
}
.thinking__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: @color-primary;
  flex-shrink: 0;
  animation: pulse 1.2s ease-in-out infinite;
}
.thinking__dot--done {
  background: #16a34a;
  animation: none;
}
.thinking__title {
  letter-spacing: 0.3px;
}
.thinking__title--done {
  color: #16a34a;
}
.thinking__summary {
  color: @color-text-muted;
  font-weight: 500;
  font-size: 12px;
}
.thinking__chevron {
  margin-left: auto;
  color: @color-text-muted;
}
.thinking__dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 2px;
}
.thinking__dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: @color-primary;
  animation: bounce 1.2s infinite ease-in-out;
}
.thinking__dots i:nth-child(2) {
  animation-delay: 0.2s;
}
.thinking__dots i:nth-child(3) {
  animation-delay: 0.4s;
}
.thinking__body {
  margin-top: 8px;
  overflow: hidden;
}
.thinking__reason {
  font-size: 13px;
  line-height: 1.7;
  color: @color-text-muted;
  white-space: pre-wrap;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

// ===== 工具调用时间线 =====
.timeline {
  list-style: none;
  margin: 10px 0 2px;
  padding: 0;
}
.timeline__item {
  display: flex;
  gap: 8px;
  padding-bottom: 6px;
}
.timeline__rail {
  position: relative;
  width: 16px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.timeline__rail::before {
  content: '';
  position: absolute;
  top: 16px;
  bottom: -6px;
  width: 1px;
  background: @color-border;
}
.timeline__item:last-child .timeline__rail::before {
  display: none;
}
.timeline__node {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid @color-primary;
  color: #16a34a;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  z-index: 1;
}
.timeline__node--done {
  background: #16a34a;
  border-color: #16a34a;
  color: #fff;
}
.timeline__spin {
  color: @color-primary;
  animation: spin 0.9s linear infinite;
}
.timeline__main {
  flex: 1;
  min-width: 0;
}
.timeline__head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.timeline__icon {
  color: @color-text-muted;
}
.timeline__name {
  font-weight: 600;
  color: @color-text-strong;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
}
.timeline__status {
  margin-left: auto;
  font-size: 11px;
  color: @color-primary;
  background: @color-primary-active-bg;
  padding: 1px 7px;
  border-radius: 999px;
}
.timeline__status--done {
  color: #16a34a;
  background: #dcfce7;
}
.timeline__args {
  margin-top: 3px;
  font-size: 12px;
  color: @color-text-muted;
  font-family: 'Fira Code', Consolas, monospace;
  word-break: break-all;
}
.timeline__result {
  margin-top: 4px;
}
.timeline__result-label {
  font-size: 12px;
  color: @color-primary;
  cursor: pointer;
  user-select: none;
}
.timeline__result-label:hover {
  text-decoration: underline;
}
.timeline__result-body {
  margin: 4px 0 0;
  padding: 8px 10px;
  background: #0d1117;
  color: #e6edf3;
  border-radius: 6px;
  font-size: 12px;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: 'Fira Code', Consolas, monospace;
}

.chat__error {
  color: #f87171;
  font-size: 13px;
  margin-bottom: 12px;
}

// ===== 动效 =====
@keyframes bubbleIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .thinking__dots i,
  .thinking__dot,
  .timeline__spin {
    animation: none !important;
  }
  .bubble,
  .thinking {
    animation: none !important;
  }
}
.chat__model-select {
  max-width: 320px;
}
.toolbar-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 8px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
  line-height: 1;
}
.chip-select {
  width: 80px;
  font-size: 12px;
}
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
  padding: 4px 8px;
  font-size: 12px;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
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
.at-err {
  padding: 8px;
  color: #ef4444;
  font-size: 12px;
}
.at-item {
  gap: 8px;
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
}
.chat__send:hover {
  background: #1d4ed8;
}
.chat__send:disabled {
  background: #1e3a8a;
  color: #93c5fd;
  cursor: not-allowed;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 440px;
  max-width: 92vw;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.modal h3 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #1f2937;
}
.modal .field {
  display: block;
  margin-bottom: 14px;
}
.modal .field-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.modal .field-row input {
  flex: 1;
}
.modal .field-row input[readonly] {
  background: #f8fafc;
  color: #475569;
  cursor: default;
}
.modal .field__hint {
  display: block;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}
.modal .field > span {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #374151;
}
.modal .field input,
.modal .field select {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.modal .field input:focus,
.modal .field select:focus {
  border-color: #2563eb;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.btn {
  padding: 9px 18px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--ghost {
  background: #f1f5f9;
  color: #1f2937;
}
.btn--ghost:hover:not(:disabled) {
  background: #e2e8f0;
}
.btn--primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.model-add__error {
  color: #dc2626;
  font-size: 12px;
}
</style>
