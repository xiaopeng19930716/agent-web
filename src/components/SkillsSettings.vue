<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { Puzzle, RefreshCw, FolderOpen, AlertCircle, Sparkles, Download, RotateCw, Save, Undo2, Folder } from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { settings, saveSettings } from '../settings.js'
import { fetchSkills, fetchImportSources, importSkills, saveImportPath, resetImportPath, scanImportAgent } from '../api/agent.js'

const skills = ref([])
const sourceDirs = ref([])
const loading = ref(false)
const error = ref('')

// ===== 从其他 Agent 导入 =====
const importOpen = ref(false)
const importLoading = ref(false)
const importError = ref('')
const importSources = ref([]) // { id, label, path, skills: [{ name, dirName, description, path }] }
const sourceDefs = ref([]) // { id, label, configFiles, skillDirs, isOverridden }
const selectedSkills = ref(new Set()) // 元素: `${sourceId}::${dirName}`
const importExisting = ref(new Set()) // 本地已存在的 dirName
const importing = ref(false)
// 每个来源的路径编辑草稿：{ [id]: { configFiles: string, skillDirs: string } }
const pathDrafts = reactive({})
const savingPathId = ref('')
const rescanningId = ref('')

function isEnabled(id) {
  return settings.enabledSkills.includes(id)
}

function toggleSkill(id, enabled) {
  if (enabled) {
    if (!settings.enabledSkills.includes(id)) settings.enabledSkills.push(id)
  } else {
    settings.enabledSkills = settings.enabledSkills.filter((x) => x !== id)
  }
  saveSettings()
}

async function load() {
  loading.value = true
  error.value = ''
  const res = await fetchSkills()
  loading.value = false
  if (res.error) {
    error.value = res.error
    return
  }
  skills.value = res.skills || []
  sourceDirs.value = res.sourceDirs || []
}

function initPathDrafts(defs) {
  for (const d of defs) {
    if (!pathDrafts[d.id]) {
      pathDrafts[d.id] = { configFiles: '', skillDirs: '' }
    }
    pathDrafts[d.id].configFiles = (d.configFiles || []).join('\n')
    pathDrafts[d.id].skillDirs = (d.skillDirs || []).join('\n')
  }
}

async function openImport() {
  importOpen.value = true
  importLoading.value = true
  importError.value = ''
  importSources.value = []
  sourceDefs.value = []
  selectedSkills.value = new Set()
  importing.value = false
  const res = await fetchImportSources()
  importLoading.value = false
  if (res.error) {
    importError.value = res.error
    return
  }
  sourceDefs.value = res.sources || []
  importSources.value = res.skillSources || []
  initPathDrafts(sourceDefs.value)
  importExisting.value = new Set(skills.value.filter((s) => s.id.startsWith('skills/')).map((s) => s.id.slice('skills/'.length)))
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
  // 用返回结果更新该 Agent 在 importSources 中的条目
  const mergeOne = (list) => {
    for (const item of list) {
      const idx = importSources.value.findIndex((x) => x.id === item.id)
      if (idx >= 0) importSources.value[idx] = item
      else importSources.value.push(item)
    }
  }
  mergeOne(res.mcpSources || [])
  mergeOne(res.skillSources || [])
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

const sourceAllChecked = (source) =>
  source.skills.filter((s) => !importExisting.value.has(s.dirName)).length > 0 &&
  source.skills.every((s) => importExisting.value.has(s.dirName) || selectedSkills.value.has(`${source.id}::${s.dirName}`))

function toggleSourceAll(source, checked) {
  source.skills.forEach((s) => {
    const key = `${source.id}::${s.dirName}`
    if (importExisting.value.has(s.dirName)) return
    if (checked) selectedSkills.value.add(key)
    else selectedSkills.value.delete(key)
  })
}

const selectedSkillCount = computed(() => selectedSkills.value.size)

async function doImport() {
  if (!selectedSkills.value.size) {
    message.warning('请先勾选要导入的技能')
    return
  }
  const items = []
  for (const src of importSources.value) {
    for (const s of src.skills) {
      const key = `${src.id}::${s.dirName}`
      if (!selectedSkills.value.has(key)) continue
      items.push({ name: s.name, dirName: s.dirName, path: s.path })
    }
  }
  importing.value = true
  const res = await importSkills(items)
  importing.value = false
  if (res.error) {
    message.error('导入失败：' + res.error)
    return
  }
  const imported = res.results.filter((r) => r.status === 'imported')
  const skipped = res.results.filter((r) => r.status === 'exists')
  const failed = res.results.filter((r) => r.status === 'error')
  await load()
  let enabled = 0
  for (const r of imported) {
    const id = 'skills/' + r.name
    if (!settings.enabledSkills.includes(id)) {
      settings.enabledSkills.push(id)
      enabled++
    }
  }
  saveSettings()
  const tip = []
  if (imported.length) tip.push(`已软链接 ${imported.length} 个`)
  if (skipped.length) tip.push(`跳过已存在 ${skipped.length} 个`)
  if (failed.length) tip.push(`失败 ${failed.length} 个`)
  message.success(tip.join('，') + (enabled ? `，并自动启用 ${enabled} 个` : ''))
  importOpen.value = false
}

onMounted(load)
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <!-- 头部 -->
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h3 class="text-base font-semibold text-gray-700 mb-1">Skills 技能</h3>
        <p class="text-sm text-gray-500 flex items-center gap-1.5">
          <FolderOpen :size="14" />
          扫描 {{ sourceDirs.length }} 个本地技能目录，启用后 Agent 可调用
        </p>
      </div>
      <div class="flex items-center gap-2">
        <a-button @click="openImport">
          <span class="inline-flex items-center gap-1.5">
            <Download :size="14" />
            从其他 Agent 导入
          </span>
        </a-button>
        <a-button :loading="loading" @click="load">
          <span class="inline-flex items-center gap-1.5">
            <RefreshCw :size="14" />
            刷新
          </span>
        </a-button>
      </div>
    </div>

    <!-- 错误态 -->
    <div
      v-if="error"
      class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2 text-sm text-red-600 mb-6"
    >
      <AlertCircle :size="16" />
      <span class="flex-1">技能扫描失败：{{ error }}</span>
      <a-button size="small" danger @click="load">重试</a-button>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="py-20 flex flex-col items-center gap-3 text-gray-400">
      <a-spin />
      <span class="text-sm">正在扫描技能目录…</span>
    </div>

    <!-- 空态 -->
    <div
      v-else-if="!skills.length"
      class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-16 text-center"
    >
      <Sparkles :size="28" class="mx-auto text-gray-300 mb-3" />
      <p class="text-sm font-medium text-gray-600 mb-1">未发现技能</p>
      <p class="text-xs text-gray-400 leading-relaxed">
        可点击右上角「从其他 Agent 导入」复制本机其他 Agent 的技能，<br />
        或在每个技能目录下放置 <code class="text-gray-500 bg-gray-100 px-1 rounded">SKILL.md</code><br />
        后端会自动扫描项目根 <code class="text-gray-500 bg-gray-100 px-1 rounded">skills/</code> 及用户主目录下的约定位置
      </p>
    </div>

    <!-- 技能卡片 -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div
        v-for="s in skills"
        :key="s.id"
        class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
        :class="{ 'opacity-60': !isEnabled(s.id) }"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="shrink-0 w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
              <Puzzle :size="18" />
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-gray-800 text-sm truncate">{{ s.name }}</div>
              <div class="text-xs text-gray-400 font-mono truncate" :title="s.path">{{ s.path }}</div>
            </div>
          </div>
          <a-switch
            size="small"
            :checked="isEnabled(s.id)"
            @change="(v) => toggleSkill(s.id, v)"
          />
        </div>
        <p class="text-xs text-gray-500 mt-2.5 leading-relaxed line-clamp-3">
          {{ s.description || '（该技能暂无描述）' }}
        </p>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <a-modal
      v-model:open="importOpen"
      title="从其他 Agent 导入 Skills"
      :width="720"
      :footer="null"
      destroy-on-close
    >
      <p class="text-sm text-gray-500 mb-4">
        扫描到以下 Agent 已配置的技能，可编辑各 Agent 的配置文件路径后局部「重新扫描」，勾选需要导入的项。导入后会以软链接方式挂载到项目 <code class="text-gray-500 bg-gray-100 px-1 rounded">skills/</code> 目录并自动启用（来源更新自动跟随）。
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
          <a-button size="small" danger @click="openImport">重试</a-button>
        </div>
      </div>

      <div
        v-else-if="!importSources.length && !sourceDefs.length"
        class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-12 text-center text-sm text-gray-400"
      >
        未发现其他 Agent 的技能
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

          <!-- 路径编辑区：Skills 仅需配置扫描目录 -->
          <div class="mb-2.5">
            <label class="flex items-center gap-1 text-xs text-gray-500 mb-1">
              <Folder :size="12" /> Skills 目录路径（每行一个，自动扫描其中的技能）
            </label>
            <textarea
              v-model="pathDrafts[def.id].skillDirs"
              rows="2"
              class="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/40"
              placeholder="例如 C:\Users\you\.claude\skills"
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

          <!-- 已扫描的技能列表 -->
          <div class="space-y-1.5 pl-1 border-t border-gray-100 pt-2.5">
            <div
              v-for="s in (importSources.find((x) => x.id === def.id)?.skills || [])"
              :key="s.dirName"
              class="py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div class="flex items-center gap-2.5">
                <a-checkbox
                  :checked="selectedSkills.has(`${def.id}::${s.dirName}`)"
                  :disabled="importExisting.has(s.dirName)"
                  @change="(e) => {
                    const key = `${def.id}::${s.dirName}`
                    if (e.target.checked) selectedSkills.add(key)
                    else selectedSkills.delete(key)
                  }"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-gray-700">{{ s.name }}</span>
                    <a-tag v-if="importExisting.has(s.dirName)" color="default" class="!m-0 !text-xs">已存在</a-tag>
                  </div>
                  <div class="text-xs text-gray-400 font-mono truncate mt-0.5">{{ s.path }}</div>
                </div>
              </div>
              <p v-if="s.description" class="text-xs text-gray-500 mt-1 ml-7 leading-relaxed line-clamp-2">
                {{ s.description }}
              </p>
            </div>
            <p
              v-if="!(importSources.find((x) => x.id === def.id)?.skills || []).length"
              class="text-xs text-gray-400 px-2 py-1"
            >
              该 Agent 未扫描到技能（可编辑路径后重新扫描）
            </p>
          </div>
        </div>
      </div>

      <div v-if="!importLoading && importSources.length" class="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
        <a-button :disabled="importing" @click="importOpen = false">取消</a-button>
        <a-button type="primary" :loading="importing" :disabled="!selectedSkillCount" @click="doImport">
          导入所选（{{ selectedSkillCount }}）
        </a-button>
      </div>
    </a-modal>
  </div>
</template>
