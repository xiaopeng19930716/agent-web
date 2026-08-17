<script setup>
import { useRoute } from 'vue-router'
import { Cpu, Cable, Puzzle } from 'lucide-vue-next'

const route = useRoute()

const subMenus = [
  { key: 'models', label: '模型配置', icon: Cpu, path: '/settings/models' },
  { key: 'mcp', label: 'MCP设置', icon: Cable, path: '/settings/mcp' },
  { key: 'skills', label: 'Skills设置', icon: Puzzle, path: '/settings/skills' },
]

const isActive = (key) => route.path.endsWith(`/${key}`) || route.path === `/settings/${key}`
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- 左侧子菜单 -->
    <aside class="w-48 shrink-0 border-r border-gray-200 bg-white p-3">
      <div class="px-3 pt-2 pb-3 text-sm font-semibold text-gray-500">设置</div>
      <nav class="space-y-1">
        <router-link
          v-for="item in subMenus"
          :key="item.key"
          :to="item.path"
          class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 transition-colors duration-150 cursor-pointer no-underline"
          :class="isActive(item.key) ? 'bg-brand text-white' : 'hover:bg-gray-100 hover:text-gray-800'"
        >
          <component :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </aside>

    <!-- 右侧内容区 -->
    <div class="flex-1 min-w-0 overflow-y-auto bg-gray-50">
      <router-view />
    </div>
  </div>
</template>
