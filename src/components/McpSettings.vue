<script setup>
import { ref, reactive, computed } from 'vue'
import { Plus, Trash2, Server, CheckCircle2, XCircle, Download, RotateCw, Save, Undo2, FileText } from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { settings, saveMcp } from '../settings.js'
import { testMcpServer, fetchImportSources, saveImportPath, resetImportPath, scanImportAgent } from '../api/agent.js'

const TYPE_OPTIONS = [
  { label: 'local（本地命令）', value: 'local' },
  { label: 'http', value: 'http' },
  { label: 'sse', value: 'sse' },
]

const TYPE_META = {
  local: { label: 'local', color: 'blue' },
  http: { label: 'http', color: 'green' },
  sse: { label: 'sse', color: 'orange' },
}

const editOpen = ref(false)
const editId = ref('')
const form = reactive({ name: '', type: 'local', command: '', url: '', enabled: true })
const formError = ref('')

// 测试连接状态：{ [id]: { testing, ok, message } }
const testStates = reactive({})

// ===== 从其他 Agent 导入 =====
const importOpen = ref(false)
const importLoading = ref(false)
const importError = ref('')
const importSources = ref([]) // { id, label, servers: [{ name, type, command, url, enabled }] }
const sourceDefs = ref([]) // { id, label, configFiles, skillDirs, isOverridden }
const selectedMcp = ref(new Set()) // 元素: `${sourceId}::${name}`
const importExisting = ref(new Set()) // 已存在的 name（禁用勾选并标注）
const pathDrafts = reactive({}) // { [id]: { configFiles, skillDirs } }
const savingPathId = ref('')
const rescanningId = ref('')

function openImport() {
  importOpen.value = true
  importLoading.value = true
  importError.value = ''
  importSources.value = []
  selectedMcp.value = new Set()
  loadImportSources()
}

// 列表：把对象映射展开为数组，便于 v-for
const mcpList = computed(() => {
  const out = []
  for (const [name, cfg] of Object.entries(settings.mcpServers)) {
    if (!cfg || typeof cfg !== 'object') continue
    const type = cfg.type || 'local'
    const command = Array.isArray(cfg.command) ? cfg.command.join(' ') : ''
    const url = cfg.url || ''
    const enabled = !settings.disabledMcpServers.includes(name)
    out.push({ name, type, command, url, enabled })
  }
  return out
})

const typeSummary = (s) => (s.type === 'local' || s.type === 'stdio' ? s.command : s.url)

function initPathDrafts(defs) {
  for (const d of defs) {
    if (!pathDrafts[d.id]) pathDrafts[d.id] = { configFiles: '', skillDirs: '' }
    pathDrafts[d.id].configFiles = (d.configFiles || []).join('\n')
    pathDrafts[d.id].skillDirs = (d.skillDirs || []).join('\n')
  }
}

async function loadImportSources() {
  importLoading.value = true
  importError.value = ''
  const res = await fetchImportSources()
  importLoading.value = false
  if (res.error) {
    importError.value = res.error
    return
  }
  sourceDefs.value = res.sources || []
  importSources.value = res.mcpSources || []
  initPathDrafts(sourceDefs.value)
  importExisting.value = new Set(Object.keys(settings.mcpServers))
}

// 仅重新扫描某个 Agent（使用其当前生效路径）
async function rescanAgent(id) {
  rescanningId.value = id
  const res = await scanImportAgent(id)
  rescanningId.value = ''
  if (res.error) {
    message.error('重扫失败：' + res.error)
    return
  }
  for (const item of res.mcpSources || []) {
    const idx = importSources.value.findIndex((x) => x.id === item.id)
    if (idx >= 0) importSources.value[idx] = item
    else importSources.value.push(item)
  }
  message.success('已重新扫描 ' + (sourceDefs.value.find((d) => d.id === id)?.label || id))
}

// 保存某 Agent 的自定义路径
async function saveAgentPaths(id) {
  const draft = pathDrafts[id]
  if (!draft) return
  const configFiles = draft.configFiles.split('\n').map((s) => s.trim()).filter(Boolean)
  const skillDirs = draft.skillDirs.split('\n').map((s) => s.trim()).filter(Boolean)
  savingPathId.value = id
  const res = await saveImportPath({ agentId: id, configFiles, skillDirs })
  savingPathId.value = ''
  if (!res.ok) {
    message.error('保存路径失败：' + res.error)
    return
  }
  const idx = sourceDefs.value.findIndex((d) => d.id === id)
  if (idx >= 0 && res.source) sourceDefs.value[idx] = res.source
  message.success('已保存路径，可点击「重新扫描」应用')
}

// 恢复某 Agent 默认路径
async function resetAgentPaths(id) {
  savingPathId.value = id
  const res = await resetImportPath(id)
  savingPathId.value = ''
  if (!res.ok) {
    message.error('恢复失败：' + res.error)
    return
  }
  const idx = sourceDefs.value.findIndex((d) => d.id === id)
  if (idx >= 0 && res.source) {
    sourceDefs.value[idx] = res.source
    pathDrafts[id].configFiles = (res.source.configFiles || []).join('\n')
    pathDrafts[id].skillDirs = (res.source.skillDirs || []).join('\n')
  }
  message.success('已恢复默认路径')
}

function toggleSourceAll(source, checked) {
  source.servers.forEach((s) => {
    const key = `${source.id}::${s.name}`
    if (importExisting.value.has(s.name)) return
    if (checked) selectedMcp.value.add(key)
    else selectedMcp.value.delete(key)
  })
}

const sourceAllChecked = (source) =>
  source.servers.filter((s) => !importExisting.value.has(s.name)).length > 0 &&
  source.servers.every((s) => importExisting.value.has(s.name) || selectedMcp.value.has(`${source.id}::${s.name}`))

const selectedMcpCount = computed(() => selectedMcp.value.size)

function importSelectedMcp() {
  if (!selectedMcp.value.size) {
    message.warning('请先勾选要导入的 MCP Server')
    return
  }
  let added = 0
  let skipped = 0
  const existingNames = new Set(Object.keys(settings.mcpServers))
  for (const src of importSources.value) {
    for (const s of src.servers) {
      const key = `${src.id}::${s.name}`
      if (!selectedMcp.value.has(key)) continue
      if (existingNames.has(s.name)) {
        skipped++
        continue
      }
      const type = s.type === 'http' || s.type === 'sse' ? s.type : 'local'
      const cfg = { type }
      if (type === 'local') {
        cfg.command = (s.command || '').split(/\s+/).filter(Boolean)
      } else {
        cfg.url = s.url || ''
      }
      settings.mcpServers[s.name] = cfg
      if (s.enabled === false && !settings.disabledMcpServers.includes(s.name)) {
        settings.disabledMcpServers.push(s.name)
      }
      existingNames.add(s.name)
      added++
    }
  }
  saveMcp()
  const tip = []
  if (added) tip.push(`已导入 ${added} 个`)
  if (skipped) tip.push(`跳过重名 ${skipped} 个`)
  message.success(tip.join('，') || '完成')
  importOpen.value = false
}

// ===== 本地编辑 =====
function startAdd() {
  editId.value = ''
  Object.assign(form, { name: '', type: 'local', command: '', url: '', enabled: true })
  formError.value = ''
  editOpen.value = true
}

function startEdit(name) {
  const cfg = settings.mcpServers[name]
  if (!cfg) return
  editId.value = name
  const type = cfg.type === 'http' || cfg.type === 'sse' ? cfg.type : 'local'
  Object.assign(form, {
    name,
    type,
    command: Array.isArray(cfg.command) ? cfg.command.join(' ') : '',
    url: cfg.url || '',
    enabled: !settings.disabledMcpServers.includes(name),
  })
  formError.value = ''
  editOpen.value = true
}

function cancelEdit() {
  editOpen.value = false
  editId.value = ''
  formError.value = ''
}

function save() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = '请填写服务器名称'
    return
  }
  if (form.type === 'local' && !form.command.trim()) {
    formError.value = 'local 类型需要填写启动命令'
    return
  }
  if ((form.type === 'http' || form.type === 'sse') && !/^https?:\/\//i.test(form.url.trim())) {
    formError.value = 'http/sse 类型需要填写合法的 URL'
    return
  }
  const name = form.name.trim()
  if (settings.mcpServers[name] && editId.value !== name) {
    formError.value = '已存在同名 MCP Server'
    return
  }
  if (editId.value && editId.value !== name) {
    delete settings.mcpServers[editId.value]
    settings.disabledMcpServers = settings.disabledMcpServers.filter((n) => n !== editId.value)
  }
  const cfg = { type: form.type }
  if (form.type === 'local') cfg.command = form.command.trim().split(/\s+/).filter(Boolean)
  else cfg.url = form.url.trim()
  settings.mcpServers[name] = cfg
  if (form.enabled) {
    settings.disabledMcpServers = settings.disabledMcpServers.filter((n) => n !== name)
  } else if (!settings.disabledMcpServers.includes(name)) {
    settings.disabledMcpServers.push(name)
  }
  saveMcp()
  editOpen.value = false
  editId.value = ''
}

function removeServer(name) {
  delete settings.mcpServers[name]
  settings.disabledMcpServers = settings.disabledMcpServers.filter((n) => n !== name)
  saveMcp()
  if (editId.value === name) cancelEdit()
}

function toggleEnabled(name, enabled) {
  const idx = settings.disabledMcpServers.indexOf(name)
  if (enabled && idx >= 0) settings.disabledMcpServers.splice(idx, 1)
  else if (!enabled && idx < 0) settings.disabledMcpServers.push(name)
  saveMcp()
}

async function testConnection(name) {
  const cfg = settings.mcpServers[name]
  if (!cfg) return
  const st = (testStates[name] = testStates[name] || { testing: false, ok: null, message: '' })
  st.testing = true
  st.ok = null
  st.message = ''
  const type = cfg.type === 'http' || cfg.type === 'sse' ? cfg.type : 'stdio'
  const payload = type === 'stdio'
    ? { type: 'stdio', command: (Array.isArray(cfg.command) ? cfg.command.join(' ') : '') }
    : { type, url: cfg.url }
  const res = await testMcpServer(payload)
  st.testing = false
  st.ok = !!res.ok
  st.message = res.error || (res.status ? `已连通（HTTP ${res.status}）` : '连接成功')
}

</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h3 class="text-base font-semibold text-gray-700 mb-1">MCP Server</h3>
        <p class="text-sm text-gray-500">
          配置 Agent 可调用的 MCP 服务器，测试通过后可启用。
        </p>
      </div>
      <a-button @click="openImport">
        <span class="inline-flex items-center gap-1.5">
          <Download :size="14" />
          从其他 Agent 导入
        </span>
      </a-button>
    </div>

    <div class="space-y-3">
      <!-- 列表 -->
      <div
        v-for="s in mcpList"
        :key="s.name"
        class="rounded-2xl border border-gray-200 bg-white shadow-sm px-4 py-3 transition-all duration-150 hover:shadow-md"
        :class="{ 'opacity-60': !s.enabled }"
      >
        <div class="flex items-center gap-3 flex-wrap">
          <Server :size="18" class="text-brand shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-gray-800 text-sm">{{ s.name }}</span>
              <a-tag :color="TYPE_META[s.type].color" class="!m-0">{{ TYPE_META[s.type].label }}</a-tag>
              <a-tag v-if="!s.enabled" class="!m-0">已停用</a-tag>
            </div>
            <div class="text-xs text-gray-500 font-mono truncate mt-0.5">{{ typeSummary(s) }}</div>
          </div>
          <a-switch :checked="s.enabled" @change="(e) => toggleEnabled(s.name, e.target.checked)" />
          <a-button size="small" :loading="testStates[s.name]?.testing" @click="testConnection(s.name)">
            测试连接
          </a-button>
          <a-button size="small" @click="startEdit(s.name)">编辑</a-button>
          <a-popconfirm title="确定删除该 MCP Server？" ok-text="删除" cancel-text="取消" @confirm="removeServer(s.name)">
            <a-button size="small" danger>
              <Trash2 :size="14" />
            </a-button>
          </a-popconfirm>
        </div>
        <!-- 测试结果 -->
        <div
          v-if="testStates[s.name] && testStates[s.name].ok !== null"
          class="mt-2 flex items-center gap-1.5 text-xs"
          :class="testStates[s.name].ok ? 'text-green-600' : 'text-red-500'"
        >
          <CheckCircle2 v-if="testStates[s.name].ok" :size="14" />
          <XCircle v-else :size="14" />
          {{ testStates[s.name].message }}
        </div>
      </div>

      <!-- 空态 -->
      <div
        v-if="!mcpList.length && !editOpen"
        class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-10 text-center text-sm text-gray-400"
      >
        还没有 MCP Server，点击下方添加或从其他 Agent 导入。
      </div>

      <!-- 添加卡片 -->
      <button
        v-if="!editOpen"
        type="button"
        class="w-full flex flex-col items-center justify-center h-20 rounded-2xl border border-dashed border-gray-300 bg-white/50 text-gray-500 transition-all duration-150 hover:border-brand hover:text-brand cursor-pointer"
        @click="startAdd"
      >
        <Plus :size="20" />
        <span class="text-sm mt-1 font-medium">添加 MCP Server</span>
      </button>
    </div>

    <!-- 导入弹窗 -->
    <a-modal
      v-model:open="importOpen"
      title="从其他 Agent 导入 MCP Server"
      :width="720"
      :footer="null"
      destroy-on-close
    >
      <p class="text-sm text-gray-500 mb-4">
        扫描到以下 Agent 已配置的 MCP Server，可编辑各 Agent 的配置文件路径后局部「重新扫描」，勾选需要导入的项（已存在同名项会自动跳过）。
      </p>

      <div v-if="importLoading" class="py-14 flex flex-col items-center gap-3 text-gray-400">
        <a-spin />
        <span class="text-sm">正在扫描本地 Agent 配置…</span>
      </div>

      <div
        v-else-if="importError"
        class="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-600"
      >
        扫描失败：{{ importError }}
        <div class="mt-2">
          <a-button size="small" danger @click="loadImportSources">重试</a-button>
        </div>
      </div>

      <div
        v-else-if="!importSources.length && !sourceDefs.length"
        class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-12 text-center text-sm text-gray-400"
      >
        未发现其他 Agent 的 MCP 配置
      </div>

      <div v-else class="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
        <div
          v-for="def in sourceDefs"
          :key="def.id"
          class="rounded-2xl border border-gray-200 p-3 transition-colors"
          :class="{ 'border-blue-200 bg-blue-50/30': def.isOverridden }"
        >
          <!-- 头部：名称 + 重扫 -->
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="font-semibold text-gray-800 text-sm">{{ def.label }}</span>
              <a-tag v-if="def.isOverridden" color="blue" class="!m-0 !text-xs">自定义路径</a-tag>
            </div>
            <a-button size="small" :loading="rescanningId === def.id" @click="rescanAgent(def.id)">
              <span class="inline-flex items-center gap-1">
                <RotateCw :size="13" />
                重新扫描
              </span>
            </a-button>
          </div>

          <!-- 路径编辑区：MCP 自动扫描配置文件中的 Server，仅需配置配置文件路径 -->
          <div class="mb-2.5">
            <label class="flex items-center gap-1 text-xs text-gray-500 mb-1">
              <FileText :size="12" /> MCP 配置文件路径（每行一个，自动扫描其中的 Server）
            </label>
            <textarea
              v-model="pathDrafts[def.id].configFiles"
              rows="2"
              class="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/40"
              placeholder="例如 C:\Users\you\.claude.json"
            ></textarea>
          </div>
          <div class="flex items-center gap-2 mb-3">
            <a-button size="small" :loading="savingPathId === def.id" @click="saveAgentPaths(def.id)">
              <span class="inline-flex items-center gap-1">
                <Save :size="13" /> 保存路径
              </span>
            </a-button>
            <a-button size="small" :disabled="!def.isOverridden || savingPathId === def.id" @click="resetAgentPaths(def.id)">
              <span class="inline-flex items-center gap-1">
                <Undo2 :size="13" /> 恢复默认
              </span>
            </a-button>
          </div>

          <!-- 已扫描的 MCP 列表 -->
          <div class="space-y-1.5 pl-1 border-t border-gray-100 pt-2.5">
            <div
              v-for="s in (importSources.find((x) => x.id === def.id)?.servers || [])"
              :key="s.name"
              class="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <a-checkbox
                :checked="selectedMcp.has(`${def.id}::${s.name}`)"
                :disabled="importExisting.has(s.name)"
                @change="(e) => {
                  const key = `${def.id}::${s.name}`
                  if (e.target.checked) selectedMcp.add(key)
                  else selectedMcp.delete(key)
                }"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-gray-700">{{ s.name }}</span>
                  <a-tag :color="TYPE_META[s.type]?.color" class="!m-0 !text-xs">{{ TYPE_META[s.type]?.label }}</a-tag>
                  <a-tag v-if="importExisting.has(s.name)" color="default" class="!m-0 !text-xs">已存在</a-tag>
                </div>
                <div class="text-xs text-gray-400 font-mono truncate mt-0.5">
                  {{ s.type === 'local' || s.type === 'stdio' ? s.command : s.url }}
                </div>
              </div>
            </div>
            <p
              v-if="!(importSources.find((x) => x.id === def.id)?.servers || []).length"
              class="text-xs text-gray-400 px-2 py-1"
            >
              该 Agent 未扫描到 MCP Server（可编辑路径后重新扫描）
            </p>
          </div>
        </div>
      </div>

      <div v-if="!importLoading && importSources.length" class="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
        <a-button @click="importOpen = false">取消</a-button>
        <a-button type="primary" :disabled="!selectedMcpCount" @click="importSelectedMcp">
          导入所选（{{ selectedMcpCount }}）
        </a-button>
      </div>
    </a-modal>

    <!-- MCP 配置编辑对话框 -->
    <a-modal
      v-model:open="editOpen"
      :title="editId ? '编辑 MCP Server' : '新增 MCP Server'"
      :width="520"
      :footer="null"
      destroy-on-close
      @cancel="cancelEdit"
    >
      <div class="space-y-4 pt-1">
        <div>
          <span class="block text-xs font-semibold text-gray-700 mb-1">名称 <span class="text-red-500">*</span></span>
          <a-input v-model:value="form.name" placeholder="如：filesystem / fetch" />
        </div>
        <div>
          <span class="block text-xs font-semibold text-gray-700 mb-1">类型</span>
          <a-select v-model:value="form.type" :options="TYPE_OPTIONS" class="w-full" />
        </div>
        <div v-if="form.type === 'local'">
          <span class="block text-xs font-semibold text-gray-700 mb-1">启动命令 <span class="text-red-500">*</span></span>
          <a-input v-model:value="form.command" placeholder="如：npx @modelcontextprotocol/server-filesystem ./data" />
        </div>
        <div v-else>
          <span class="block text-xs font-semibold text-gray-700 mb-1">服务器 URL <span class="text-red-500">*</span></span>
          <a-input v-model:value="form.url" placeholder="https://..." />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-700">启用</span>
          <a-switch v-model:checked="form.enabled" />
        </div>
        <div v-if="formError" class="text-sm text-red-500">{{ formError }}</div>
        <div class="flex items-center justify-end gap-2 pt-1">
          <a-button @click="cancelEdit">取消</a-button>
          <a-button type="primary" @click="save">保存</a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>
