<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Check, Plus, Trash2, RefreshCw } from 'lucide-vue-next'
import { settings, saveModels, resetSettings, flattenVendors, platformToNpm, npmToPlatform, toPositiveNumber } from '../settings.js'
import { fetchModelsByVendor } from '../api/agent.js'
import { message, Modal } from 'ant-design-vue'

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

const fetchLoading = ref(false)
// editing=false 为查看态（表单只读，仅显示"编辑 / 恢复默认"）；true 为编辑态
const editing = ref(false)

const allVendors = computed(() => [
  ...PRESET_VENDORS,
  ...settings.customVendors.map((v) => ({ ...v, isCustomVendor: true })),
])

const activeKey = ref(PRESET_VENDORS[0].key)
const activeVendor = computed(() => allVendors.value.find((v) => v.key === activeKey.value) || allVendors.value[0])
const isNew = computed(() => activeKey.value === '__new__')
// 是否为预置供应商：key 与名称均只读，不可修改（防止被改名导致数据丢失 / 孤儿残留）
const isPreset = computed(() => !isNew.value && !activeVendor.value?.isCustomVendor)

// 预置供应商 key 集合（作为保留命名空间：自定义供应商 Key 不得与之重复，即使该预置未注入 settings.vendors）
const PRESET_VENDOR_KEYS = new Set(PRESET_VENDORS.map((v) => v.key))

const emptyRow = () => ({ name: '', id: '', maxTokens: '', temperature: 0.3 })
const form = reactive({ name: '', website: '', vendorKey: '', baseUrl: '', apiKey: '', platform: 'openai', modelRows: [emptyRow()] })

// 模型 ID 下拉选项（来自「获取模型列表」），供 a-auto-complete 选择
const modelIdOptions = ref([])
// 当前聚焦的模型行索引，用于控制 a-auto-complete 下拉展开（避免因空值而不弹）
const acFocusIdx = ref(-1)
// 由模型 ID 生成模型名称：短横线替换为空格，已有空格保留，每个单词首字母大写
// 例如 gpt-4o-mini -> Gpt 4o Mini / qwen3.7-max-2026-05-17 -> Qwen3.7 Max 2026 05 17
function idToName(s) {
  return String(s)
    .replace(/-/g, ' ')
    .replace(/(^|\s)(\w)/g, (_, sp, c) => sp + c.toUpperCase())
}
// 在下拉中选择模型 ID 时，自动把模型名称按规则填充
function onModelIdSelect(row, val) {
  row.id = val
  row.name = idToName(val)
}

const modelsOfVendor = computed(() => {
  const v = settings.vendors[activeKey.value]
  if (!v || !v.models) return []
  return Object.entries(v.models).map(([id, m]) => ({
    id,
    name: (m && m.name) || id,
    baseUrl: (m && m.baseUrl) || (v.options && v.options.baseURL) || '',
    apiKey: (m && m.apiKey) || (v.options && v.options.apiKey) || '',
    maxTokens: (m && m.maxTokens) ?? '',
    temperature: (m && m.options && typeof m.options.temperature === 'number') ? m.options.temperature : 0.3,
  }))
})

const isConfigured = (key) => settings.configuredVendors.includes(key)
const isVendorDisabled = (key) => Array.isArray(settings.disabledVendors) && settings.disabledVendors.includes(key)
function toggleVendorDisabled(key) {
  if (!Array.isArray(settings.disabledVendors)) settings.disabledVendors = []
  const i = settings.disabledVendors.indexOf(key)
  if (i >= 0) settings.disabledVendors.splice(i, 1)
  else settings.disabledVendors.push(key)
  saveModels()
  // 若当前活动模型属于被禁用的供应商，自动切到第一个可用模型
  if (i < 0) {
    const [avk, amid] = (settings.activeModel || '').split('/')
    if (avk === key) {
      const all = flattenVendors(settings.vendors)
      const next = all.find((x) => x.vendorKey !== key && !isVendorDisabled(x.vendorKey))
      settings.activeModel = next ? `${next.vendorKey}/${next.id}` : ''
    }
  }
}

function selectVendor(key) {
  activeKey.value = key
  if (key === '__new__') {
    Object.assign(form, { name: '', website: '', vendorKey: '', baseUrl: '', apiKey: '', platform: 'openai', modelRows: [emptyRow()] })
  } else {
    const vendor = allVendors.value.find((v) => v.key === key)
    const vCfg = settings.vendors[key]
    const platform = vendor && vendor.baseUrls ? firstNonEmptyType(vendor.baseUrls) : (vCfg && vCfg.npm ? npmToPlatform(vCfg.npm) : 'openai')
    const rows = modelsOfVendor.value
    const saved = rows.find((m) => m.baseUrl || m.apiKey)
    // 供应商级 baseUrl/apiKey 优先取 settings.vendors[key].options
    const vendorBase = (vCfg && vCfg.options && vCfg.options.baseURL) || ''
    const vendorKey = (vCfg && vCfg.options && vCfg.options.apiKey) || ''
    Object.assign(form, {
      name: (vendor && vendor.name) || (vCfg && vCfg.name) || '',
      website: (vendor && vendor.website) || '',
      vendorKey: vendor ? vendor.key : '',
      baseUrl: saved && saved.baseUrl ? saved.baseUrl : (vendorBase || (vendor ? presetBaseUrl(vendor, platform) : '')),
      apiKey: saved && saved.apiKey ? saved.apiKey : (vendorKey || ''),
      platform,
      modelRows: rows.length ? rows.map((m) => ({ name: m.name, id: m.id, maxTokens: m.maxTokens ?? '', temperature: m.temperature })) : [emptyRow()],
    })
  }
  // 新增供应商或未配置过的供应商 → 直接进入编辑态；已配置 → 查看态
  editing.value = isNew.value || !isConfigured(key)
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
async function save() {
  const newKey = form.vendorKey.trim()
  const oldKey = isNew.value ? null : activeVendor.value.key
  if (!form.name.trim()) {
    message.error('供应商名称不能为空')
    return
  }
  if (!newKey) {
    message.error('供应商 Key 不能为空')
    return
  }
  // 唯一性校验：供应商 Key 不得与任何已存在的供应商（预置 + 自定义）重复，排除自身旧 Key。
  // 已存在集合 = settings.vendors 的全量 key ∪ 预置供应商 key（预置作为保留命名空间，即使未注入 settings.vendors 也不可占用）。
  const conflict = !isNew.value && newKey !== oldKey
  if (isNew.value || conflict) {
    const exists =
      Object.keys(settings.vendors).some((k) => k === newKey && k !== oldKey) ||
      (PRESET_VENDOR_KEYS.has(newKey) && newKey !== oldKey)
    if (exists) {
      message.error(`供应商 Key「${newKey}」已存在，请更换为唯一标识`)
      return
    }
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
  // 若 Key 发生变更，把旧 key 的供应商配置 / 自定义供应商 / 禁用状态一并迁移到新 key
  if (!isNew.value && newKey !== oldKey) {
    if (settings.vendors[oldKey]) {
      settings.vendors[newKey] = settings.vendors[oldKey]
      delete settings.vendors[oldKey]
    }
    const cv = settings.customVendors.find((v) => v.key === oldKey)
    if (cv) cv.key = newKey
    // disabledVendors 与 configuredVendors 同步（避免改名后旧 key 残留成孤儿引用）
    const di = settings.disabledVendors.indexOf(oldKey)
    if (di >= 0) {
      settings.disabledVendors.splice(di, 1)
      if (!settings.disabledVendors.includes(newKey)) settings.disabledVendors.push(newKey)
    }
    const ci = settings.configuredVendors.indexOf(oldKey)
    if (ci >= 0) {
      settings.configuredVendors.splice(ci, 1)
      if (!settings.configuredVendors.includes(newKey)) settings.configuredVendors.push(newKey)
    }
    // activeModel 组合键同步
    if (settings.activeModel.startsWith(oldKey + '/')) {
      settings.activeModel = newKey + settings.activeModel.slice(oldKey.length)
    }
  } else if (!settings.vendors[newKey]) {
    settings.vendors[newKey] = { name: '', npm: '', options: { apiKey: '', baseURL: '' }, models: {} }
  }
  if (isNew.value) {
    settings.customVendors.push({ key: newKey, name: form.name.trim(), website: form.website.trim(), baseUrl: form.baseUrl.trim() })
  } else {
    // 已存在供应商：同步更新名称 / 官网
    const exist = settings.customVendors.find((v) => v.key === newKey)
    if (exist) {
      exist.name = form.name.trim() || exist.name
      exist.website = form.website.trim()
      if (form.baseUrl.trim()) exist.baseUrl = form.baseUrl.trim()
    }
  }
  // 写入该供应商对象（标准格式）
  const vCfg = settings.vendors[newKey]
  // 预置供应商名称只读，保持预置名；仅自定义供应商使用表单填写的名称
  vCfg.name = isPreset ? (activeVendor.value?.name || newKey) : form.name.trim()
  vCfg.npm = platformToNpm(form.platform)
  vCfg.options = { apiKey: form.apiKey.trim(), baseURL: form.baseUrl.trim() }
  // 用表单中现有的 model id 集合决定要删哪些、保留哪些
  const newIds = new Set(rows.map((r) => r.id.trim()))
  const preserved = {}
  for (const [mid, m] of Object.entries(vCfg.models || {})) {
    if (!newIds.has(mid)) preserved[mid] = m
  }
  const nextModels = {}
  for (const r of rows) {
    const id = r.id.trim()
    const prev = preserved[id]
    const opt = {}
    const t = toPositiveNumber(r.temperature)
    if (t !== undefined) opt.temperature = t
    else if (prev && prev.options && typeof prev.options.temperature === 'number') opt.temperature = prev.options.temperature
    else opt.temperature = 0.3
    nextModels[id] = {
      name: r.name.trim() || id,
      ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(toNumber(r.maxTokens) ? { maxTokens: toNumber(r.maxTokens) } : {}),
      options: opt,
    }
  }
  // 把未删除的历史模型附回
  for (const [mid, m] of Object.entries(preserved)) nextModels[mid] = m
  vCfg.models = nextModels
  // 仅当填入有效 API Key 时才标记为"已配置"；只改 baseURL 或只列模型不足以认定为已配置
  if (form.apiKey.trim()) markConfiguredVendor(newKey)
  const ok = await saveModels()
  if (!ok) {
    message.error('保存失败，请稍后重试')
    return
  }
  activeKey.value = newKey
  editing.value = false
  message.success('保存成功')
}

function deleteCustomVendor(key) {
  if (!confirm('确定删除该自定义供应商？其下模型也会一并移除。')) return
  settings.customVendors = settings.customVendors.filter((v) => v.key !== key)
  delete settings.vendors[key]
  const idx = settings.configuredVendors.indexOf(key)
  if (idx !== -1) settings.configuredVendors.splice(idx, 1)
  // activeModel 若属于被删供应商，重置
  if (settings.activeModel && settings.activeModel.startsWith(key + '/')) {
    const firstVk = Object.keys(settings.vendors)[0]
    const firstMid = firstVk ? Object.keys(settings.vendors[firstVk].models || {})[0] : ''
    settings.activeModel = firstVk && firstMid ? `${firstVk}/${firstMid}` : ''
  }
  if (activeKey.value === key) {
    activeKey.value = PRESET_VENDORS[0].key
    selectVendor(PRESET_VENDORS[0].key)
  }
  saveModels()
}

function resetDefaults() {
  Modal.confirm({
    title: '恢复默认设置',
    content: '此操作将清除所有自定义的供应商、模型与配置，并恢复为初始状态，且不可撤销。确定继续？',
    okText: '恢复默认',
    okType: 'danger',
    cancelText: '取消',
    onOk() {
      resetSettings()
      activeKey.value = PRESET_VENDORS[0].key
      selectVendor(PRESET_VENDORS[0].key)
      message.success('已恢复默认设置')
    },
  })
}

// 从查看态进入编辑态
function startEdit() {
  editing.value = true
}

async function fetchModels() {
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
      vendor: isNew.value ? form.vendorKey.trim() : activeKey.value,
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
    // 将获取到的模型 ID 填入下拉，供各模型行的 a-autocomplete 选择
    modelIdOptions.value = models.map((m) => ({ value: m.id, label: m.id }))
    message.success(`已获取 ${models.length} 个模型，已加入模型 ID 下拉，可在各行选择`)
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
      <div class="grid grid-cols-2 gap-3 auto-rows-fr">
        <div
          v-for="v in allVendors"
          :key="v.key"
          role="button"
          tabindex="0"
          class="group relative flex h-full items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
          :class="[
            activeKey === v.key ? 'border-brand ring-2 ring-brand/30' : 'border-gray-200',
            isVendorDisabled(v.key) ? 'opacity-60' : '',
          ]"
          @click="selectVendor(v.key)"
          @keydown.enter="selectVendor(v.key)"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-semibold text-gray-800">{{ v.name }}</span>
            <a-badge
              v-if="isConfigured(v.key)"
              status="success"
              text="已配置"
              class="shrink-0"
            />
          </div>
          <div class="flex shrink-0 items-center gap-2" @click.stop>
            <a-switch
              v-if="isConfigured(v.key)"
              :checked="!isVendorDisabled(v.key)"
              :title="isVendorDisabled(v.key) ? '点击启用（其模型将显示在对话下拉中）' : '点击禁用（其模型不显示在对话下拉中）'"
              size="small"
              @change="() => toggleVendorDisabled(v.key)"
            />
            <button
              v-if="v.isCustomVendor"
              type="button"
              title="删除该供应商"
              class="inline-flex items-center justify-center w-5 h-5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
              @click.stop="deleteCustomVendor(v.key)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
        <button
          type="button"
          class="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-4 py-3 text-gray-500 transition-all duration-150 hover:border-brand hover:text-brand cursor-pointer"
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
        <h3 class="text-lg font-semibold text-gray-800">
          {{ isNew ? '新增自定义供应商' : (editing ? '编辑 · ' + activeVendor.name : '查看 · ' + activeVendor.name) }}
        </h3>
      </div>
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="block">
            <span class="block text-xs font-semibold text-gray-700 mb-1">供应商名称 <span class="text-red-500">*</span></span>
            <a-input
              v-model:value="form.name"
              placeholder="如：我的私有服务"
              size="middle"
              :disabled="!editing || isPreset"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-semibold text-gray-700 mb-1">供应商官网（选填）</span>
            <a-input
              v-model:value="form.website"
              placeholder="https://..."
              size="middle"
              :disabled="!editing"
            />
          </label>
        </div>
        <label class="block">
          <span class="block text-xs font-semibold text-gray-700 mb-1">供应商 Key <span class="text-red-500">*</span></span>
          <a-input
            v-model:value="form.vendorKey"
            placeholder="如：my-llm-service（唯一标识，用于获取模型列表）"
            size="middle"
            :disabled="!editing || isPreset"
          />
          <span class="text-[11px] text-gray-400 mt-1 block">{{ isNew ? '自定义供应商需手动填写 Key，保存后不可修改' : isPreset ? '预置供应商的 Key 与名称只读，不可修改' : '已保存的自定义供应商 Key 不可修改' }}</span>
        </label>
        <label class="block">
          <span class="block text-xs font-semibold text-gray-700 mb-1">Base URL</span>
          <a-input-group compact size="middle">
            <a-select
              v-model:value="form.platform"
              style="width: 200px"
              size="middle"
              :options="TYPE_OPTIONS"
              :disabled="!editing"
              @change="onPlatformChange"
            />
            <a-input
              v-model:value="form.baseUrl"
              placeholder="https://..."
              size="middle"
              style="width: calc(100% - 200px)"
              :disabled="!editing"
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
            :disabled="!editing"
          />
        </label>
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-gray-700">模型（名称 / ID / Max Tokens，可添加多组）</span>
            <button
              type="button"
              :disabled="!editing || fetchLoading"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-brand/40 text-brand rounded-lg hover:bg-brand/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              @click="fetchModels"
            >
              <RefreshCw :size="14" :class="{ 'animate-spin': fetchLoading }" />
              {{ fetchLoading ? '获取中…' : '获取模型列表' }}
            </button>
          </div>
          <div class="space-y-2">
            <div v-for="(row, i) in form.modelRows" :key="i" class="flex items-center gap-2">
              <a-input
                v-model:value="row.name"
                placeholder="模型名称（界面显示）"
                size="middle"
                class="flex-1 min-w-0"
                :disabled="!editing"
              />
              <a-auto-complete
                v-model:value="row.id"
                :options="modelIdOptions"
                placeholder="模型 ID（发给大模型，可下拉选择）"
                size="middle"
                class="flex-1 min-w-0"
                :disabled="!editing"
                :open="acFocusIdx === i"
                @focus="acFocusIdx = i"
                @blur="acFocusIdx = -1"
                @select="(val) => onModelIdSelect(row, val)"
              />
              <a-input-number
                v-model:value="row.maxTokens"
                :min="1"
                :step="1"
                placeholder="Max Tokens"
                size="middle"
                class="w-28"
                :disabled="!editing"
              />
              <button
                type="button"
                title="添加模型行"
                :disabled="!editing"
                class="shrink-0 inline-flex items-center justify-center w-9 h-9 text-brand hover:text-brand-dark hover:bg-brand/10 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                @click="addModelRow"
              >
                <Plus :size="18" />
              </button>
              <button
                type="button"
                title="删除该模型行"
                :disabled="!editing || form.modelRows.length <= 1"
                class="shrink-0 inline-flex items-center justify-center w-9 h-9 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                @click="removeModelRow(i)"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <template v-if="editing">
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
          </template>
          <template v-else>
            <button
              type="button"
              class="bg-brand hover:bg-brand-dark text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              @click="startEdit"
            >
              编辑
            </button>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>
