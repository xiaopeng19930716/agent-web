<script setup>
import { useRoute, useRouter } from 'vue-router'
import { Cpu, Cable, Puzzle, ArrowLeft } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()

// 返回对话页
function goChat() {
  router.push('/chat')
}

const subMenus = [
  { key: 'models', label: '模型配置', icon: Cpu, path: '/settings/models' },
  { key: 'mcp', label: 'MCP设置', icon: Cable, path: '/settings/mcp' },
  { key: 'skills', label: 'Skills设置', icon: Puzzle, path: '/settings/skills' },
]

const isActive = (key) => route.path.endsWith(`/${key}`) || route.path === `/settings/${key}`
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 顶部子菜单 -->
    <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800"
        @click="goChat"
      >
        <ArrowLeft :size="16" />
        <span>返回对话</span>
      </button>
      <nav class="flex items-center justify-end gap-1">
        <router-link
          v-for="item in subMenus"
          :key="item.key"
          :to="item.path"
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 transition-colors duration-150 cursor-pointer no-underline"
          :class="isActive(item.key) ? 'bg-brand text-white' : 'hover:bg-gray-100 hover:text-gray-800'"
        >
          <component :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </header>

    <!-- 下方内容区 -->
    <div class="flex-1 min-w-0 overflow-y-auto bg-gray-50">
      <router-view />
    </div>
  </div>
</template>
