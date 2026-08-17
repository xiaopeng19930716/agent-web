<script setup>
import { ref, computed, onMounted } from 'vue'
import { Puzzle, RefreshCw, FolderOpen, AlertCircle, Sparkles, Download } from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { settings, saveSettings } from '../settings.js'
import { fetchSkills, fetchImportSources, importSkills } from '../api/agent.js'

const skills = ref([])
const sourceDirs = ref([])
const loading = ref(false)
const error = ref('')

// ===== 从其他 Agent 导入 =====
const importOpen = ref(false)
const importLoading = ref(false)
const importError = ref('')
const importSources = ref([]) // { id, label, path, skills: [{ name, dirName, description, path }] }
const selectedSkills = ref(new Set()) // 元素: `${sourceId}::${dirName}`
const importExisting = ref(new Set()) // 本地已存在的 dirName
const importing = ref(false)

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

async function openImport() {
  importOpen.value = true
  importLoading.value = true
  importError.value = ''
  importSources.value = []
  selectedSkills.value = new Set()
  importing.value = false
  const [res] = await Promise.all([fetchImportSources()])
  importLoading.value = false
  if (res.error) {
    importError.value = res.error
    return
  }
  importSources.value = res.skillSources || []
  importExisting.value = new Set(skills.value.filter((s) => s.id.startsWith('skills/')).map((s) => s.id.slice('skills/'.length)))
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
  // 刷新列表并自动启用导入的技能
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
  if (imported.length) tip.push(`已导入 ${imported.length} 个`)
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
          <template #icon><Download :size="14" /></template>
          从其他 Agent 导入
        </a-button>
        <a-button :loading="loading" @click="load">
          <template #icon><RefreshCw :size="14" /></template>
          刷新
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
        扫描到以下 Agent 已配置的技能，勾选需要导入的项。导入后会复制到项目 <code class="text-gray-500 bg-gray-100 px-1 rounded">skills/</code> 目录并自动启用。
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
        v-else-if="!importSources.length"
        class="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-4 py-12 text-center text-sm text-gray-400"
      >
        未发现其他 Agent 的技能
      </div>

      <div v-else class="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
        <div v-for="src in importSources" :key="src.id" class="rounded-2xl border border-gray-200 p-3">
          <div class="flex items-center gap-2.5 mb-2">
            <a-checkbox
              :checked="sourceAllChecked(src)"
              :indeterminate="
                src.skills.some((s) => !importExisting.has(s.dirName) && selectedSkills.has(`${src.id}::${s.dirName}`)) &&
                !sourceAllChecked(src)
              "
              @change="(e) => toggleSourceAll(src, e.target.checked)"
            />
            <span class="font-semibold text-gray-800 text-sm">{{ src.label }}</span>
            <span class="text-xs text-gray-400">{{ src.skills.length }} 个</span>
          </div>
          <div class="space-y-1.5 pl-6">
            <div
              v-for="s in src.skills"
              :key="s.dirName"
              class="py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div class="flex items-center gap-2.5">
                <a-checkbox
                  :checked="selectedSkills.has(`${src.id}::${s.dirName}`)"
                  :disabled="importExisting.has(s.dirName)"
                  @change="(e) => {
                    const key = `${src.id}::${s.dirName}`
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
