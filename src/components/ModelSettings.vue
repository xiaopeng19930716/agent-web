<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Check, Plus, Trash2, RefreshCw } from 'lucide-vue-next'
import { settings, saveSettings, resetSettings } from '../settings.js'
import { fetchModelsByVendor } from '../api/agent.js'
import { message } from 'ant-design-vue'

// 每个预置供应商在各类型下预设的 Base URL（切换类型/选中供应商时自动填入，可手动改）
const PRESET_VENDORS = [
  { key: 'bailian-coding', name: '阿里云百炼 · Coding Plan',
    baseUrls: { openai: 'https://coding.dashscope.aliyuncs.com/v1', anthropic: 'https://coding.dashscope.aliyuncs.com/apps/anthropic', native: '' } },
  { key: 'bailian-token', name: '阿里云百炼 · Token Plan',
    baseUrls: { openai: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', anthropic: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic', native: '' } },
  { key: 'deepseek', name: 'DeepSeek',
    baseUrls: { openai: 'https://api.deepseek.com', anthropic: 'https://api.deepseek.com/anthropic', native: '' } },
  { key: 'zhipu', name: '智谱 GLM · Coding Plan',
    baseUrls: { openai: 'https://open.bigmodel.cn/api/coding/paas/v4', anthropic: 'https://open.bigmodel.cn/api/anthropic', native: 'https://open.bigmodel.cn/api/v1' } },
  { key: 'tencent', name: '腾讯混元 · Coding',
    baseUrls: { openai: 'https://api.lkeap.cloud.tencent.com/coding/v3', anthropic: 'https://api.lkeap.cloud.tencent.com/coding/anthropic', native: '' } },
]

// 3 种类型：全局调用范式（影响对话调用 & 模型列表获取方式）
const TYPE_OPTIONS = [
  { label: 'OpenAI 兼容', value: 'openai' },
  { label: 'Anthropic 兼容', value: 'anthropic' },
  { label: '原生接口', value: 'native' },
]
// 各类型对应的兼容模式默认 Base URL（切换类型时自动填入，可手动改）
const TYPE_DEFAULT_BASEURL = {
  openai: 'https://api.openai.com/v1',
  anthropic: '',
  native: '',
}
// 预置供应商 key 集合（仅这些可获取模型列表）
const PRESET_VENDOR_KEYS = new Set(PRESET_VENDORS.map((v) => v.key))

// 取预置供应商在指定类型下的预设 Base URL（无则返回空串）
function presetBaseUrl(vendor, type) {
  if (!vendor || !vendor.baseUrls) return ''
  return vendor.baseUrls[type] || ''
}
// 取预置供应商第一个有预设 URL 的类型（优先 openai），用于首次选中时的默认类型
function firstNonEmptyType(baseUrls) {
  for (const t of ['openai', 'anthropic', 'native']) {
    if (baseUrls && baseUrls[t]) return t
  }
  return 'openai'
}

const success = ref('')
const fetchLoading = ref(false)

const allVendors = computed(() => [
  ...PRESET_VENDORS,
  ...settings.customVendors.map((v) => ({ ...v, isCustomVendor: true })),
])

const activeKey = ref(PRESET_VENDORS[0].key)
const activeVendor = computed(() => allVendors.value.find((v) => v.key === activeKey.value) || allVendors.value[0])
const isNew = computed(() => activeKey.value === '__new__')
const isCustomVendor = computed(() => !PRESET_VENDOR_KEYS.has(activeKey.value))

const emptyRow = () => ({ name: '', id: '', maxTokens: '' })
const form = reactive({ name: '', website: '', baseUrl: '', apiKey: '', platform: 'openai', modelRows: [emptyRow()] })

const modelsOfVendor = computed(() => settings.models.filter((m) => m.vendorKey === activeKey.value))

const isConfigured = (key) => settings.configuredVendors.includes(key)

function selectVendor(key) {
  activeKey.value = key
  if (key === '__new__') {
    Object.assign(form, { name: '', website: '', baseUrl: '', apiKey: '', platform: 'openai', modelRows: [emptyRow()] })
  } else {
    const vendor = allVendors.value.find((v) => v.key === key)
    const platform = vendor && vendor.baseUrls ? firstNonEmptyType(vendor.baseUrls) : 'openai'
    const rows = modelsOfVendor.value
    Object.assign(form, {
      name: vendor ? vendor.name : '',
      website: (vendor && vendor.website) || '',
      baseUrl: vendor ? presetBaseUrl(vendor, platform) : '',
      apiKey: '',
      platform,
      modelRows: rows.length ? rows.map((m) => ({ name: m.name, id: m.id, maxTokens: m.maxTokens ?? '' })) : [emptyRow()],
    })
  }
}

function onPlatformChange() {
  // 切换类型时，优先填入当前预置供应商该类型的预设 Base URL；
  // 无预设则回落到类型默认地址；始终覆盖已填内容，用户也可手动改动
  const vendor = allVendors.value.find((v) => v.key === activeKey.value)
  const preset = vendor ? presetBaseUrl(vendor, form.platform) : ''
  const def = TYPE_DEFAULT_BASEURL[form.platform]
  form.baseUrl = preset || def || ''
}

function addModelRow() {
  form.modelRows.push(emptyRow())
}
function removeModelRow(i) {
  form.modelRows.splice(i, 1)
  if (!form.modelRows.length) form.modelRows.push(emptyRow())
}
function markConfiguredVendor(key) {
  if (!settings.configuredVendors.includes(key)) settings.configuredVendors.push(key)
}
function toNumber(v) {
  if (v === '' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
function save() {
  let key = isNew.value ? '__new__' : activeVendor.value.key
  if (!form.name.trim()) {
    message.error('供应商名称不能为空')
    return
  }
  const rows = form.modelRows.filter((r) => r.id.trim())
  if (!rows.length) {
    message.error('请至少添加一组模型（模型 ID 不能为空）')
    return
  }
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.id.trim())) {
      message.error(`模型 ID 重复：${r.id.trim()}`)
      return
    }
    seen.add(r.id.trim())
  }
  if (isNew.value) {
    key = 'custom-' + Date.now()
    settings.customVendors.push({ key, name: form.name.trim(), website: form.website.trim(), baseUrl: form.baseUrl.trim() })
  } else if (key === 'custom') {
    settings.customVendors = settings.customVendors.filter((v) => v.key !== 'custom')
  }
  settings.models = settings.models.filter((m) => m.vendorKey !== key)
  for (const r of rows) {
    settings.models.push({
      id: r.id.trim(),
      name: r.name.trim() || r.id.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      vendorKey: key,
      maxTokens: toNumber(r.maxTokens),
    })
  }
  markConfiguredVendor(key)
  saveSettings()
  activeKey.value = key
  success.value = '保存成功'
  setTimeout(() => (success.value = ''), 2500)
}

function deleteCustomVendor(key) {
  if (!confirm('确定删除该自定义供应商？其下模型也会一并移除。')) return
  settings.customVendors = settings.customVendors.filter((v) => v.key !== key)
  settings.models = settings.models.filter((m) => m.vendorKey !== key)
  const idx = settings.configuredVendors.indexOf(key)
  if (idx !== -1) settings.configuredVendors.splice(idx, 1)
  if (activeKey.value === key) {
    activeKey.value = PRESET_VENDORS[0].key
    selectVendor(PRESET_VENDORS[0].key)
  }
  saveSettings()
}

function resetDefaults() {
  resetSettings()
  activeKey.value = PRESET_VENDORS[0].key
  selectVendor(PRESET_VENDORS[0].key)
  success.value = '已恢复默认设置'
  setTimeout(() => (success.value = ''), 2500)
}

async function fetchModels() {
  // 仅预置供应商可获取模型列表
  if (!PRESET_VENDOR_KEYS.has(activeKey.value)) {
    message.error('自定义供应商请手动添加模型')
    return
  }
  // 仅 OpenAI 兼容类型支持自动获取模型列表；Anthropic / 原生类型暂不支持
  if (form.platform !== 'openai') {
    message.error('该类型暂不支持自动获取')
    return
  }
  if (!form.baseUrl.trim()) {
    message.error('请先填写 Base URL')
    return
  }
  if (!form.apiKey.trim()) {
    message.error('请先填写 API Key')
    return
  }
  fetchLoading.value = true
  try {
    const { models, error: err } = await fetchModelsByVendor({
      vendor: activeKey.value,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      type: form.platform,
    })
    if (err) {
      message.error(err)
      return
    }
    if (!models.length) {
      message.error('该接口未返回任何模型')
      return
    }
    form.modelRows = models.map((m) => ({ name: m.name || m.id, id: m.id, maxTokens: '' }))
    message.success(`已获取 ${models.length} 个模型`)
  } finally {
    fetchLoading.value = false
  }
}

onMounted(() => selectVendor(PRESET_VENDORS[0].key))
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-8">
    <!-- 供应商卡片 -->
    <section class="mb-8">
      <h3 class="text-base font-semibold text-gray-700 mb-3">供应商</h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div
          v-for="v in allVendors"
          :key="v.key"
          role="button"
          tabindex="0"
          class="group relative flex items-center justify-between h-16 text-left rounded-xl border bg-white px-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
          :class="activeKey === v.key ? 'border-brand ring-2 ring-brand/30' : 'border-gray-200'"
          @click="selectVendor(v.key)"
          @keydown.enter="selectVendor(v.key)"
        >
          <span class="text-sm font-semibold text-gray-800 truncate pr-6">{{ v.name }}</span>
          <span
            v-if="isConfigured(v.key)"
            class="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white"
            title="已配置"
          >
            <Check :size="11" :stroke-width="3" />
          </span>
          <button
            v-if="v.isCustomVendor"
            type="button"
            title="删除该供应商"
            class="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
            @click.stop="deleteCustomVendor(v.key)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
        <button
          type="button"
          class="flex flex-col items-center justify-center h-16 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-4 text-gray-500 transition-all duration-150 hover:border-brand hover:text-brand cursor-pointer"
          :class="activeKey === '__new__' ? 'border-brand ring-2 ring-brand/30 text-brand' : ''"
          @click="selectVendor('__new__')"
        >
          <Plus :size="20" />
          <span class="text-xs mt-1 font-medium">添加自定义供应商</span>
        </button>
      </div>
    </section>

    <!-- 配置表单 -->
    <section class="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <div class="flex items-center justify-between mb-5">
        <h3 class="text-lg font-semibold text-gray-800">{{ isNew ? '新增自定义供应商' : activeVendor.name }}</h3>
      </div>
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="block">
            <span class="block text-xs font-semibold text-gray-700 mb-1">供应商名称 <span class="text-red-500">*</span></span>
            <a-input
              v-model:value="form.name"
              placeholder="如：我的私有服务"
              size="middle"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-semibold text-gray-700 mb-1">供应商官网（选填）</span>
            <a-input
              v-model:value="form.website"
              placeholder="https://..."
              size="middle"
            />
          </label>
        </div>
        <label class="block">
          <span class="block text-xs font-semibold text-gray-700 mb-1">Base URL</span>
          <a-input-group compact size="middle">
            <a-select
              v-model:value="form.platform"
              style="width: 200px"
              size="middle"
              :options="TYPE_OPTIONS"
              @change="onPlatformChange"
            />
            <a-input
              v-model:value="form.baseUrl"
              placeholder="https://..."
              size="middle"
              style="width: calc(100% - 200px)"
            />
          </a-input-group>
          <span class="text-[11px] text-gray-400 mt-1 block">切换类型时，若 Base URL 为空会自动填入对应兼容模式的默认地址，也可手动修改。</span>
        </label>
        <label class="block">
          <span class="block text-xs font-semibold text-gray-700 mb-1">API Key</span>
          <a-input-password
            v-model:value="form.apiKey"
            placeholder="sk-..."
            autocomplete="off"
          />
        </label>
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-gray-700">模型（名称 / ID / Max Tokens，可添加多组）</span>
            <button
              v-if="!isCustomVendor"
              type="button"
              :disabled="fetchLoading"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-brand/40 text-brand rounded-lg hover:bg-brand/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              @click="fetchModels"
            >
              <RefreshCw :size="14" :class="{ 'animate-spin': fetchLoading }" />
              {{ fetchLoading ? '获取中…' : '获取模型列表' }}
            </button>
            <span v-else class="text-[11px] text-gray-400">自定义供应商请手动添加模型</span>
          </div>
          <div class="space-y-2">
            <div v-for="(row, i) in form.modelRows" :key="i" class="flex items-center gap-2">
              <a-input
                v-model:value="row.name"
                placeholder="模型名称（界面显示）"
                size="middle"
              />
              <a-input
                v-model:value="row.id"
                placeholder="模型 ID（发给大模型）"
                size="middle"
              />
              <a-input-number
                v-model:value="row.maxTokens"
                :min="1"
                :step="1"
                placeholder="Max Tokens"
                size="middle"
                class="w-64"
              />
              <button
                v-if="i === form.modelRows.length - 1"
                type="button"
                title="添加模型行"
                class="shrink-0 inline-flex items-center justify-center w-9 h-9 text-brand hover:text-brand-dark hover:bg-brand/10 rounded-lg transition-colors cursor-pointer"
                @click="addModelRow"
              >
                <Plus :size="18" />
              </button>
              <button
                v-else
                type="button"
                title="删除该模型行"
                class="shrink-0 inline-flex items-center justify-center w-9 h-9 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                @click="removeModelRow(i)"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <button
            type="button"
            class="bg-brand hover:bg-brand-dark text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            @click="save"
          >
            保存
          </button>
          <button
            type="button"
            class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer"
            @click="resetDefaults"
          >
            恢复默认
          </button>
          <span v-if="success" class="text-sm text-green-600">{{ success }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
