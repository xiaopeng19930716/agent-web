<script setup>
import { useRoute, useRouter } from 'vue-router'
import { Cpu, Cable, Puzzle, ArrowLeft, Settings2 } from 'lucide-vue-next'
import { sessions } from '../sessions.js'

const route = useRoute()
const router = useRouter()

// 返回对话页，带上当前活动会话 ID
function goChat() {
  router.push(sessions.activeSessionId ? `/chat/${sessions.activeSessionId}` : '/chat')
}

const subMenus = [
  { key: 'models', label: '模型配置', icon: Cpu, path: '/settings/models' },
  { key: 'mcp', label: 'MCP设置', icon: Cable, path: '/settings/mcp' },
  { key: 'skills', label: 'Skills设置', icon: Puzzle, path: '/settings/skills' },
  { key: 'advanced', label: '高级设置', icon: Settings2, path: '/settings/advanced' },
]

const isActive = (key) => route.path.endsWith(`/${key}`) || route.path === `/settings/${key}`
</script>

<template>
  <transition name="settings-fade" appear>
    <div class="flex h-full min-h-0 flex-col">
    <!-- 顶部子菜单 -->
    <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white dark:border-[var(--color-border)] dark:bg-[var(--color-bg-subtle)] px-4 py-2">
      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-[#303030] dark:hover:text-gray-200"
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
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors duration-150 cursor-pointer no-underline"
          :class="isActive(item.key) ? 'bg-brand text-white' : 'hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-[#303030] dark:hover:text-gray-200'"
        >
          <component :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </header>

    <!-- 下方内容区 -->
    <div class="flex-1 min-w-0 overflow-y-auto bg-gray-50 dark:bg-[var(--color-bg)]">
      <router-view />
    </div>
  </div>
  </transition>
</template>

<style scoped>
.settings-fade-enter-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.settings-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.settings-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.settings-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
