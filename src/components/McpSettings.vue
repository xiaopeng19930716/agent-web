<script setup>
import { ref, reactive, computed } from 'vue'
import { Plus, Trash2, Server, CheckCircle2, XCircle, Download } from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { settings, saveSettings } from '../settings.js'
import { testMcpServer, fetchImportSources } from '../api/agent.js'

const TYPE_OPTIONS = [
  { label: 'stdio（本地命令）', value: 'stdio' },
  { label: 'http', value: 'http' },
  { label: 'sse', value: 'sse' },
]

const TYPE_META = {
  stdio: { label: 'stdio', color: 'blue' },
  http: { label: 'http', color: 'green' },
  sse: { label: 'sse', color: 'orange' },
}

const editing = ref(false)
const editId = ref('')
const form = reactive({ name: '', type: 'stdio', command: '', url: '', enabled: true })
const formError = ref('')

// 测试连接状态：{ [id]: { testing, ok, message } }
const testStates = reactive({})

// ===== 从其他 Agent 导入 =====
const importOpen = ref(false)
const importLoading = ref(false)
const importError = ref('')
const importSources = ref([]) // { id, label, servers: [{ name, type, command, url, enabled }] }
const selectedMcp = ref(new Set()) // 元素: `${sourceId}::${name}`
const importExisting = ref(new Set()) // 已存在的 name（禁用勾选并标注）

function openImport() {
  importOpen.value = true
  importLoading.value = true
  importError.value = ''
  importSources.value = []
  selectedMcp.value = new Set()
  loadImportSources()
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
  importSources.value = res.mcpSources || []
  importExisting.value = new Set(settings.mcpServers.map((s) => s.name))
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
  const existingNames = new Set(settings.mcpServers.map((s) => s.name))
  for (const src of importSources.value) {
    for (const s of src.servers) {
      const key = `${src.id}::${s.name}`
      if (!selectedMcp.value.has(key)) continue
      if (existingNames.has(s.name)) {
        skipped++
        continue
      }
      settings.mcpServers.push({
        id: 'mcp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: s.name,
        type: s.type,
        command: s.command || '',
        url: s.url || '',
        enabled: s.enabled !== false,
        source: src.label,
      })
      existingNames.add(s.name)
      added++
    }
  }
  saveSettings()
  const tip = []
  if (added) tip.push(`已导入 ${added} 个`)
  if (skipped) tip.push(`跳过重名 ${skipped} 个`)
  message.success(tip.join('，') || '完成')
  importOpen.value = false
}

// ===== 本地编辑 =====
function startAdd() {
  editId.value = ''
  Object.assign(form, { name: '', type: 'stdio', command: '', url: '', enabled: true })
  formError.value = ''
  editing.value = true
}

function startEdit(id) {
  const s = settings.mcpServers.find((x) => x.id === id)
  if (!s) return
  editId.value = id
  Object.assign(form, {
    name: s.name,
    type: s.type,
    command: s.command || '',
    url: s.url || '',
    enabled: s.enabled !== false,
  })
  formError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editId.value = ''
  formError.value = ''
}

function save() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = '请填写服务器名称'
    return
  }
  if (form.type === 'stdio' && !form.command.trim()) {
    formError.value = 'stdio 类型需要填写启动命令'
    return
  }
  if ((form.type === 'http' || form.type === 'sse') && !/^https?:\/\//i.test(form.url.trim())) {
    formError.value = 'http/sse 类型需要填写合法的 URL'
    return
  }
  const payload = {
    id: editId.value || 'mcp-' + Date.now(),
    name: form.name.trim(),
    type: form.type,
    command: form.type === 'stdio' ? form.command.trim() : '',
    url: form.type === 'http' || form.type === 'sse' ? form.url.trim() : '',
    enabled: form.enabled,
  }
  if (editId.value) {
    const idx = settings.mcpServers.findIndex((x) => x.id === editId.value)
    if (idx !== -1) settings.mcpServers.splice(idx, 1, payload)
  } else {
    settings.mcpServers.push(payload)
  }
  saveSettings()
  editing.value = false
  editId.value = ''
}

function removeServer(id) {
  settings.mcpServers = settings.mcpServers.filter((x) => x.id !== id)
  saveSettings()
  if (editId.value === id) cancelEdit()
}

async function testConnection(id) {
  const s = settings.mcpServers.find((x) => x.id === id)
  if (!s) return
  const st = (testStates[id] = testStates[id] || { testing: false, ok: null, message: '' })
  st.testing = true
  st.ok = null
  st.message = ''
  const payload = s.type === 'stdio' ? { type: 'stdio', command: s.command } : { type: s.type, url: s.url }
  const res = await testMcpServer(payload)
  st.testing = false
  st.ok = !!res.ok
  st.message = res.error || (res.status ? `已连通（HTTP ${res.status}）` : '连接成功')
}

const typeSummary = (s) => (s.type === 'stdio' ? s.command : s.url)
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
        <template #icon><Download :size="14" /></template>
        从其他 Agent 导入
      </a-button>
    </div>

    <div class="space-y-3">
      <!-- 列表 -->
      <div
        v-for="s in settings.mcpServers"
        :key="s.id"
        class="rounded-2xl border border-gray-200 bg-white shadow-sm px-4 py-3 transition-all duration-150 hover:shadow-md"
        :class="{ 'opacity-60': !s.enabled }"
      >
        <div class="flex items-center gap-3 flex-wrap">
          <Server :size="18" class="text-brand shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-gray-800 text-sm">{{ s.name }}</span>
              <a-tag :color="TYPE_META[s.type].color" class="!m-0">{{ TYPE_META[s.type].label }}</a-tag>
              <a-tag v-if="s.source" class="!m-0 text-gray-400">{{ s.source }}</a-tag>
              <a-tag v-if="!s.enabled" class="!m-0">已停用</a-tag>
            </div>
            <div class="text-xs text-gray-500 font-mono truncate mt-0.5">{{ typeSummary(s) }}</div>
          </div>
          <a-switch v-model:checked="s.enabled" @change="saveSettings" />
          <a-button size="small" :loading="testStates[s.id]?.testing" @click="testConnection(s.id)">
            测试连接
          </a-button>
          <a-button size="small" @click="startEdit(s.id)">编辑</a-button>
          <a-popconfirm title="确定删除该 MCP Server？" ok-text="删除" cancel-text="取消" @confirm="removeServer(s.id)">
            <a-button size="small" danger><Trash2 :size="14" /></a-button>
          </a-popconfirm>
        </div>
        <!-- 测试结果 -->
        <div
          v-if="testStates[s.id] && testStates[s.id].ok !== null"
          class="mt-2 flex items-center gap-1.5 text-xs"
          :class="testStates[s.id].ok ? 'text-green-600' : 'text-red-500'"
        >
          <CheckCircle2 v-if="testStates[s.id].ok" :size="14" />
          <XCircle v-else :size="14" />
          {{ testStates[s.id].message }}
        </div>
      </div>

      <!-- 空态 -->
      <div
        v-if="!settings.mcpServers.length && !editing"
        class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-10 text-center text-sm text-gray-400"
      >
        还没有 MCP Server，点击下方添加或从其他 Agent 导入。
      </div>

      <!-- 添加卡片 -->
      <button
        v-if="!editing"
        type="button"
        class="w-full flex flex-col items-center justify-center h-20 rounded-2xl border border-dashed border-gray-300 bg-white/50 text-gray-500 transition-all duration-150 hover:border-brand hover:text-brand cursor-pointer"
        @click="startAdd"
      >
        <Plus :size="20" />
        <span class="text-sm mt-1 font-medium">添加 MCP Server</span>
      </button>

      <!-- 编辑表单 -->
      <div v-if="editing" class="rounded-2xl border border-brand/30 bg-white shadow-sm p-5">
        <div class="text-sm font-semibold text-gray-800 mb-4">{{ editId ? '编辑 MCP Server' : '新增 MCP Server' }}</div>
        <div class="space-y-4">
          <div>
            <span class="block text-xs font-semibold text-gray-700 mb-1">名称 <span class="text-red-500">*</span></span>
            <a-input v-model:value="form.name" placeholder="如：filesystem / fetch" />
          </div>
          <div>
            <span class="block text-xs font-semibold text-gray-700 mb-1">类型</span>
            <a-select v-model:value="form.type" :options="TYPE_OPTIONS" class="w-full" />
          </div>
          <div v-if="form.type === 'stdio'">
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
          <div class="flex items-center gap-2">
            <a-button type="primary" @click="save">保存</a-button>
            <a-button @click="cancelEdit">取消</a-button>
            <span v-if="formError" class="text-sm text-red-500">{{ formError }}</span>
          </div>
        </div>
      </div>
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
        扫描到以下 Agent 已配置的 MCP Server，勾选需要导入的项（已存在同名项会自动跳过）。
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
        v-else-if="!importSources.length"
        class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-12 text-center text-sm text-gray-400"
      >
        未发现其他 Agent 的 MCP 配置
      </div>

      <div v-else class="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
        <div v-for="src in importSources" :key="src.id" class="rounded-2xl border border-gray-200 p-3">
          <div class="flex items-center gap-2.5 mb-2">
            <a-checkbox
              :checked="sourceAllChecked(src)"
              :indeterminate="
                src.servers.some((s) => !importExisting.has(s.name) && selectedMcp.has(`${src.id}::${s.name}`)) &&
                !sourceAllChecked(src)
              "
              @change="(e) => toggleSourceAll(src, e.target.checked)"
            />
            <span class="font-semibold text-gray-800 text-sm">{{ src.label }}</span>
            <span class="text-xs text-gray-400">{{ src.servers.length }} 个</span>
          </div>
          <div class="space-y-1.5 pl-6">
            <div
              v-for="s in src.servers"
              :key="s.name"
              class="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <a-checkbox
                :checked="selectedMcp.has(`${src.id}::${s.name}`)"
                :disabled="importExisting.has(s.name)"
                @change="(e) => {
                  const key = `${src.id}::${s.name}`
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
                  {{ s.type === 'stdio' ? s.command : s.url }}
                </div>
              </div>
            </div>
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
  </div>
</template>
