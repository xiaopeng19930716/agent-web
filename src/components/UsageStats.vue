<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { Segmented, Table, Card, Empty } from 'ant-design-vue'
import { fetchSessions } from '../sessions.js'
import { settings, flattenVendors } from '../settings.js'

const loading = ref(false)
const range = ref('all') // all | 7d | 30d | today
const rangeOptions = [
  { label: '全部', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '近7天', value: '7d' },
  { label: '近30天', value: '30d' },
]

// 模型名友好映射：vendorKey/modelId -> 厂商名 / 模型名
const modelNameMap = computed(() => {
  const map = {}
  for (const m of flattenVendors(settings.vendors)) {
    map[`${m.vendorKey}/${m.id}`] = `${m.vendorName} / ${m.name}`
  }
  return map
})
function friendlyModel(key) {
  return modelNameMap.value[key] || key
}
// 厂商名友好映射：vendorKey -> 厂商名
const vendorNameMap = computed(() => {
  const map = {}
  for (const m of flattenVendors(settings.vendors)) {
    map[m.vendorKey] = m.vendorName
  }
  return map
})
function friendlyVendor(key) {
  return vendorNameMap.value[key] || key
}
// 模型 -> 厂商名 权威映射：直接遍历模型配置，按 modelId 归属厂商
const modelToVendorMap = computed(() => {
  const map = {}
  for (const m of flattenVendors(settings.vendors)) {
    map[m.id] = m.vendorName
  }
  return map
})
// 解析模型对应的厂商信息（metadata.model 可能是 vendorKey/modelId 或纯 modelId）
function resolveVendorInfo(model) {
  const modelId = model.includes('/') ? model.split('/')[1] : model
  const vendorName = modelToVendorMap.value[modelId] || (model.includes('/') ? friendlyVendor(model.split('/')[0]) : '')
  return { vendorKey: model.includes('/') ? model.split('/')[0] : modelId, modelId, vendorName }
}

function rangeStart() {
  const now = Date.now()
  if (range.value === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (range.value === '7d') return now - 7 * 86400000
  if (range.value === '30d') return now - 30 * 86400000
  return 0
}

// 原始聚合：model -> { calls, tokens, days: {yyyymmdd: tokens} }
const raw = ref({})

async function load() {
  loading.value = true
  try {
    const list = await fetchSessions()
    const start = rangeStart()
    const agg = {}
    for (const s of list) {
      if (!Array.isArray(s.messages)) continue
      for (const m of s.messages) {
        if (m.role !== 'assistant') continue
        const meta = m.metadata || {}
        const model = meta.model
        if (!model) continue // 只统计产生了 assistant 回复且有模型标识的轮次（含失败）
        if (start && meta.timestamp && meta.timestamp < start) continue
        const vInfo = resolveVendorInfo(model)
        if (!agg[model]) agg[model] = { calls: 0, tokens: 0, days: {}, vendorKey: vInfo.vendorKey, vendorName: vInfo.vendorName, modelId: vInfo.modelId }
        agg[model].calls += 1
        const tk = typeof meta.tokens === 'number' ? meta.tokens : 0
        agg[model].tokens += tk
        if (meta.timestamp) {
          const d = new Date(meta.timestamp)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          agg[model].days[key] = (agg[model].days[key] || 0) + tk
        }
      }
    }
    raw.value = agg
  } finally {
    loading.value = false
  }
}

const rows = computed(() =>
  Object.entries(raw.value)
    .map(([model, v]) => ({
      key: model,
      model: friendlyModel(model),
      rawModel: model,
      modelId: v.modelId,
      vendorKey: v.vendorKey,
      vendor: v.vendorName,
      calls: v.calls,
      tokens: v.tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens),
)

// 按厂商聚合调用次数（以厂商名为聚合键，确保不同 modelId 格式的同一厂商合并）
const vendorRows = computed(() => {
  const map = {}
  for (const r of rows.value) {
    const key = r.vendor
    if (!map[key]) map[key] = { vendor: r.vendor, calls: 0, tokens: 0 }
    map[key].calls += r.calls
    map[key].tokens += r.tokens
  }
  return Object.values(map).sort((a, b) => b.calls - a.calls)
})

const tableColumns = [
  { title: '模型', dataIndex: 'modelId', key: 'modelId', width: 160, ellipsis: true },
  { title: '厂商', dataIndex: 'vendor', key: 'vendor', width: 120, ellipsis: true },
  {
    title: 'Token 总数',
    dataIndex: 'tokens',
    key: 'tokens',
    sorter: (a, b) => a.tokens - b.tokens,
    width: 200,
    customRender: ({ text }) => text.toLocaleString(),
  },
  { title: '调用次数', dataIndex: 'calls', key: 'calls', sorter: (a, b) => a.calls - b.calls, width: 120 },
]

// ===== echarts =====
const tokenChart = ref(null)
const callChart = ref(null)
const trendChart = ref(null)
let tokenInst = null
let callInst = null
let trendInst = null
const isDark = ref(document.documentElement.classList.contains('dark'))
// 监听 html 根节点的 dark 类变化（主题切换由 App.vue 切换 class 实现），驱动图表重绘
let themeObserver = null
onMounted(() => {
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  if (themeObserver) themeObserver.disconnect()
})

function baseTextStyle() {
  return { color: isDark.value ? '#c9d1d9' : '#1f2328' }
}

function renderCharts() {
  if (!tokenInst || !callInst || !trendInst) return
  const modelLabels = rows.value.map((r) => r.modelId)
  const tokensM = rows.value.map((r) => r.tokens / 1e6)

  // 各模型 Token 总量（竖向柱状：x 轴模型 id，y 轴用量 M）
  tokenInst.setOption({
    backgroundColor: 'transparent',
    notMerge: true,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0]
        const row = rows.value[p.dataIndex]
        return `${row.modelId} / ${row.vendor}<br/>Token：${p.value.toFixed(4)} M`
      },
    },
    grid: { left: 8, right: 24, top: 24, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: modelLabels,
      axisLabel: {
        ...baseTextStyle(),
        width: 90,
        overflow: 'truncate',
        interval: 0,
      },
    },
    yAxis: { type: 'value', axisLabel: { ...baseTextStyle(), formatter: (v) => `${v.toFixed(4)} M` } },
    series: [{ type: 'bar', data: tokensM, barWidth: 24, itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: baseTextStyle().color, formatter: (p) => `${p.value.toFixed(4)} M` } }],
  })

  // 各厂商调用次数（柱状）
  const vendorLabels = vendorRows.value.map((r) => r.vendor)
  const vendorCalls = vendorRows.value.map((r) => r.calls)
  callInst.setOption({
    backgroundColor: 'transparent',
    notMerge: true,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0]
        return `${p.name}<br/>调用次数：${p.value.toLocaleString()}`
      },
    },
    grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: vendorLabels,
      axisLabel: { ...baseTextStyle(), width: 90, overflow: 'truncate' },
    },
    yAxis: { type: 'value', axisLabel: baseTextStyle() },
    series: [{ type: 'bar', data: vendorCalls, barWidth: 20, itemStyle: { color: '#22c55e', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: baseTextStyle().color } }],
  })

  // 按天 Token 趋势（折线）
  const dayMap = {}
  for (const r of rows.value) {
    const src = raw.value[r.rawModel]?.days || {}
    for (const [d, t] of Object.entries(src)) dayMap[d] = (dayMap[d] || 0) + t
  }
  const days = Object.keys(dayMap).sort()
  trendInst.setOption({
    backgroundColor: 'transparent',
    notMerge: true,
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: days, axisLabel: baseTextStyle() },
    yAxis: { type: 'value', axisLabel: baseTextStyle() },
    series: [{ type: 'line', smooth: true, data: days.map((d) => dayMap[d]), areaStyle: { opacity: 0.15 }, itemStyle: { color: '#a855f7' } }],
  })
}

function initCharts() {
  if (tokenChart.value) tokenInst = echarts.init(tokenChart.value)
  if (callChart.value) callInst = echarts.init(callChart.value)
  if (trendChart.value) trendInst = echarts.init(trendChart.value)
  renderCharts()
}

function resizeAll() {
  tokenInst && tokenInst.resize()
  callInst && callInst.resize()
  trendInst && trendInst.resize()
}

onMounted(async () => {
  await load()
  await nextTick()
  initCharts()
  window.addEventListener('resize', resizeAll)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeAll)
  tokenInst && tokenInst.dispose()
  callInst && callInst.dispose()
  trendInst && trendInst.dispose()
})

watch(range, async () => {
  await load()
  await nextTick()
  renderCharts()
})

// 主题变化重绘
watch(isDark, () => renderCharts())
</script>

<template>
  <div class="usage">
    <div class="usage__head">
      <h2 class="usage__title">用量统计</h2>
      <Segmented v-model:value="range" :options="rangeOptions" />
    </div>

    <Empty v-if="!loading && rows.length === 0" description="该时间段内暂无用量数据" class="usage__empty" />

    <div v-else class="usage__charts">
      <Card :bordered="false" class="usage__chart" title="各模型 Token 总量">
        <div ref="tokenChart" class="usage__chart-canvas"></div>
      </Card>
      <Card :bordered="false" class="usage__chart" title="各厂商调用次数">
        <div ref="callChart" class="usage__chart-canvas"></div>
      </Card>
      <Card :bordered="false" class="usage__chart usage__chart--full" title="Token 按天趋势">
        <div ref="trendChart" class="usage__chart-canvas"></div>
      </Card>
    </div>

    <Card v-if="rows.length" :bordered="false" class="usage__table">
      <Table :columns="tableColumns" :data-source="rows" :pagination="false" size="middle" />
    </Card>
  </div>
</template>

<style scoped lang="less">
.usage {
  padding: 24px 28px;
  height: 100%;
  overflow: auto;
  background: var(--color-bg);
}
.usage__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.usage__title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
}
.usage__charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 18px;
}
.usage__chart {
  background: var(--color-bg-subtle);
}
.usage__chart--full {
  grid-column: 1 / -1;
}
.usage__chart-canvas {
  width: 100%;
  height: 280px;
}
.usage__table {
  background: var(--color-bg-subtle);
}
.usage__empty {
  margin-top: 80px;
}
@media (max-width: 880px) {
  .usage__charts {
    grid-template-columns: 1fr;
  }
}
</style>
