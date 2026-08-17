<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Check, Plus, Trash2, Eye, EyeOff } from 'lucide-vue-next'
import { settings, saveSettings, resetSettings } from '../settings.js'

const PRESET_VENDORS = [
  { key: 'bailian-coding', name: '阿里云百炼 · Coding Plan', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { key: 'bailian-token', name: '阿里云百炼 · Token Plan', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { key: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { key: 'zhipu', name: '智谱 GLM · Coding Plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
  { key: 'zhipu-token', name: '智谱 GLM · Token Plan', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'tencent', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
]

const showKey = ref(false)
const success = ref('')
const error = ref('')

const allVendors = computed(() => [
  ...PRESET_VENDORS,
  ...settings.customVendors.map((v) => ({ ...v, isCustomVendor: true })),
])

const activeKey = ref(PRESET_VENDORS[0].key)
const activeVendor = computed(() => allVendors.value.find((v) => v.key === activeKey.value) || allVendors.value[0])
const isNew = computed(() => activeKey.value === '__new__')

const emptyRow = () => ({ name: '', id: '', maxTokens: '' })
const form = reactive({ name: '', website: '', baseUrl: '', apiKey: '', useGlobalKey: false, modelRows: [emptyRow()] })

const modelsOfVendor = computed(() => settings.models.filter((m) => m.vendorKey === activeKey.value))

const isConfigured = (key) => settings.configuredVendors.includes(key)

function selectVendor(key) {
  activeKey.value = key
  error.value = ''
  if (key === '__new__') {
    Object.assign(form, { name: '', website: '', baseUrl: '', apiKey: '', useGlobalKey: false, modelRows: [emptyRow()] })
  } else {
    const vendor = allVendors.value.find((v) => v.key === key)
    const rows = modelsOfVendor.value
    Object.assign(form, {
      name: vendor ? vendor.name : '',
      website: (vendor && vendor.website) || '',
      baseUrl: (vendor && vendor.baseUrl) || '',
      apiKey: '',
      useGlobalKey: false,
      modelRows: rows.length ? rows.map((m) => ({ name: m.name, id: m.id, maxTokens: m.maxTokens ?? '' })) : [emptyRow()],
    })
  }
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
  error.value = ''
  let key = isNew.value ? '__new__' : activeVendor.value.key
  if (!form.name.trim()) {
    error.value = '供应商名称不能为空'
    return
  }
  const rows = form.modelRows.filter((r) => r.id.trim())
  if (!rows.length) {
    error.value = '请至少添加一组模型（模型 ID 不能为空）'
    return
  }
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.id.trim())) {
      error.value = `模型 ID 重复：${r.id.trim()}`
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
      apiKey: form.useGlobalKey ? '' : form.apiKey.trim(),
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
            <input
              v-model="form.name"
              placeholder="如：我的私有服务"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-semibold text-gray-700 mb-1">供应商官网（选填）</span>
            <input
              v-model="form.website"
              placeholder="https://..."
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
            />
          </label>
        </div>
        <label class="block">
          <span class="block text-xs font-semibold text-gray-700 mb-1">Base URL</span>
          <input
            v-model="form.baseUrl"
            placeholder="https://..."
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-semibold text-gray-700 mb-1">API Key</span>
          <div class="flex gap-2">
            <input
              v-model="form.apiKey"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk-..."
              autocomplete="off"
              class="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
            />
            <button
              type="button"
              class="shrink-0 inline-flex items-center gap-1 px-3 border border-gray-300 rounded-lg text-gray-600 hover:border-brand hover:text-brand transition-colors cursor-pointer"
              @click="showKey = !showKey"
            >
              <component :is="showKey ? EyeOff : Eye" :size="16" />
              {{ showKey ? '隐藏' : '显示' }}
            </button>
          </div>
          <label class="mt-2 flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input v-model="form.useGlobalKey" type="checkbox" class="w-4 h-4 accent-brand" />
            使用默认 API Key（不勾则使用上方单独填写的 Key）
          </label>
        </label>
        <div>
          <span class="block text-xs font-semibold text-gray-700 mb-2">模型（名称 / ID / Max Tokens，可添加多组）</span>
          <div class="space-y-2">
            <div v-for="(row, i) in form.modelRows" :key="i" class="flex items-center gap-2">
              <input
                v-model="row.name"
                placeholder="模型名称（界面显示）"
                class="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
              />
              <input
                v-model="row.id"
                placeholder="模型 ID（发给大模型）"
                class="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
              />
              <input
                v-model="row.maxTokens"
                type="number"
                min="1"
                step="1"
                placeholder="Max Tokens"
                title="最大输出长度（可选）"
                class="w-28 shrink-0 px-3 py-2 border border-gray-300 rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition"
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
          <span v-if="error" class="text-sm text-red-500">{{ error }}</span>
          <span v-else-if="success" class="text-sm text-green-600">{{ success }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
