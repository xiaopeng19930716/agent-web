<script setup>
import { computed } from "vue";
import { Cpu } from "lucide-vue-next";
import { settings, flattenVendors, saveModels } from "../../settings.js";

const PRESET_VENDOR_NAMES = {
  "bailian-coding": "阿里云百炼 · Coding Plan",
  "bailian-token": "阿里云百炼 · Token Plan",
  deepseek: "DeepSeek",
  zhipu: "智谱 GLM · Coding Plan",
  tencent: "腾讯混元 · Coding",
};
const vendorNameMap = computed(() => {
  const m = { ...PRESET_VENDOR_NAMES };
  const customs = Array.isArray(settings.customVendors) ? settings.customVendors : [];
  for (const v of customs) {
    if (v && v.key) m[v.key] = v.name || v.key;
  }
  return m;
});
function vendorLabel(vk) {
  if (!vk) return "其他 / 自定义";
  return vendorNameMap.value[vk] || vk;
}

const groupedModels = computed(() => {
  const list = flattenVendors(settings.vendors);
  const disabled = new Set(
    Array.isArray(settings.disabledVendors) ? settings.disabledVendors : []
  );
  const groups = new Map();
  for (const m of list) {
    const key = m.vendorKey || "__custom__";
    if (key !== "__custom__" && disabled.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === "__custom__") return 1;
    if (b === "__custom__") return -1;
    return (vendorNameMap[a] || a).localeCompare(vendorNameMap[b] || b, "zh");
  });
  return order.map((k) => ({
    key: k,
    label: vendorLabel(k),
    items: groups.get(k).map((m) => ({
      ...m,
      key: `${m.vendorKey}/${m.id}`,
      label: m.name,
    })),
  }));
});

// 切换模型后立即持久化，避免刷新后回到默认模型
function onModelChange() {
  saveModels();
}
</script>

<template>
  <div class="chat__control chat__control--model" title="模型">
    <Cpu :size="14" class="chat__control-icon" />
    <a-select
      v-model:value="settings.activeModel"
      size="small"
      :bordered="false"
      :options="groupedModels"
      :field-names="{ label: 'label', value: 'key', options: 'items' }"
      @change="onModelChange"
    />
  </div>
</template>
