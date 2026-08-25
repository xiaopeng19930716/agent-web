<script setup>
import { ref, computed } from 'vue'
import { message } from 'ant-design-vue'
import { settings, saveAdvanced, flattenVendors } from '../settings.js'

// 可用模型（组合键 vendorKey/modelId），供子 Agent 独立模型选择
const availableModels = computed(() =>
  flattenVendors(settings.vendors).map((m) => ({
    value: `${m.vendorKey}/${m.id}`,
    label: `${m.vendorName} · ${m.name}`,
  }))
)

// ===== 温度设置 =====
const planTemp = ref(typeof settings.planTemperature === 'number' ? settings.planTemperature : 0.7)
const execTemp = ref(typeof settings.execTemperature === 'number' ? settings.execTemperature : 0.3)

// ===== 编排行为 =====
const subAgentMaxTurns = ref(typeof settings.subAgentMaxTurns === 'number' ? settings.subAgentMaxTurns : 12)
const allowReplan = ref(settings.allowReplan !== false)

// ===== 执行与安全 =====
const commandTimeout = ref(typeof settings.commandTimeout === 'number' ? settings.commandTimeout : 300)

// ===== 模型设置 =====
const subModelKey = ref(settings.subModelKey || '')

function clampTemp(v) {
  return Math.min(2, Math.max(0, v))
}

async function save() {
  // 温度设置
  settings.planTemperature = typeof planTemp.value === 'number' ? clampTemp(planTemp.value) : 0.7
  settings.execTemperature = typeof execTemp.value === 'number' ? clampTemp(execTemp.value) : null
  // 编排行为
  settings.subAgentMaxTurns = typeof subAgentMaxTurns.value === 'number' && subAgentMaxTurns.value > 0 ? Math.floor(subAgentMaxTurns.value) : 12
  settings.allowReplan = !!allowReplan.value
  // 执行与安全
  settings.commandTimeout = typeof commandTimeout.value === 'number' && commandTimeout.value > 0 ? Math.floor(commandTimeout.value) : 300
  // 模型设置
  settings.subModelKey = (subModelKey.value || '').trim()

  await saveAdvanced()
  message.success('已保存')
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-8 space-y-6">
    <!-- 温度设置 -->
    <section class="rounded-2xl border border-gray-200 dark:border-[var(--color-border)] bg-white dark:bg-[var(--color-bg-subtle)] shadow-sm p-6">
      <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">温度设置</h4>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-5">计划阶段偏高更发散，执行阶段偏低保证代码准确。</p>
      <div class="space-y-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">计划模式温度</span>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">需求澄清与任务拆解阶段使用，默认 0.7。</p>
          </div>
          <a-input-number v-model:value="planTemp" :min="0" :max="2" :step="0.1" class="w-32 shrink-0" />
        </div>
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">执行模式温度</span>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">默认 0.3；若模型设置页已为该模型配置温度，则优先使用模型温度。</p>
          </div>
          <a-input-number v-model:value="execTemp" :min="0" :max="2" :step="0.1" class="w-32 shrink-0" />
        </div>
      </div>
    </section>

    <!-- 编排行为 -->
    <section class="rounded-2xl border border-gray-200 dark:border-[var(--color-border)] bg-white dark:bg-[var(--color-bg-subtle)] shadow-sm p-6">
      <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-5">编排行为</h4>
      <div class="space-y-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">子 Agent 最大轮数</span>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">单个子 Agent 的工具调用轮数上限，默认 12。</p>
          </div>
          <a-input-number v-model:value="subAgentMaxTurns" :min="1" :max="50" :step="1" class="w-32 shrink-0" />
        </div>
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">允许子 Agent 重规划</span>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">执行中发现必要新增工作时，子 Agent 可追加子任务到计划末尾。</p>
          </div>
          <a-switch v-model:checked="allowReplan" />
        </div>
      </div>
    </section>

    <!-- 执行与安全 -->
    <section class="rounded-2xl border border-gray-200 dark:border-[var(--color-border)] bg-white dark:bg-[var(--color-bg-subtle)] shadow-sm p-6">
      <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-5">执行与安全</h4>
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">命令执行超时上限（秒）</span>
          <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">executeCommand 命令的最长执行时间，默认 300 秒。</p>
        </div>
        <a-input-number v-model:value="commandTimeout" :min="1" :max="3600" :step="10" class="w-32 shrink-0" />
      </div>
    </section>

    <!-- 模型设置 -->
    <section class="rounded-2xl border border-gray-200 dark:border-[var(--color-border)] bg-white dark:bg-[var(--color-bg-subtle)] shadow-sm p-6">
      <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-5">模型设置</h4>
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">子 Agent 模型</span>
          <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">子任务执行使用的模型；留空则跟随主模型（推荐）。</p>
        </div>
        <a-select v-model:value="subModelKey" :options="availableModels" allow-clear placeholder="跟随主模型" class="w-64 shrink-0" />
      </div>
    </section>

    <div class="flex justify-end">
      <button
        type="button"
        class="bg-brand hover:bg-brand-dark text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        @click="save"
      >
        保存
      </button>
    </div>
  </div>
</template>
