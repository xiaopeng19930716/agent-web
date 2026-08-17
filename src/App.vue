<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { MessageSquare, Settings } from 'lucide-vue-next'
import { settings } from './settings.js'

const route = useRoute()

const menuItems = [
  { key: 'chat', label: '对话', icon: MessageSquare, path: '/chat' },
  { key: 'settings', label: '设置', icon: Settings, path: '/settings/models' },
]

const isActive = (key) => (key === 'settings' ? route.path.startsWith('/settings') : route.path.startsWith('/chat'))

const currentModel = computed(() => {
  const m = settings.models.find((x) => x.id === settings.activeModel)
  return m ? m.name : settings.activeModel || '未设置'
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar__brand">Code Agent</div>
      <nav class="sidebar__nav">
        <router-link
          v-for="item in menuItems"
          :key="item.key"
          :to="item.path"
          class="nav-item"
          :class="{ 'nav-item--active': isActive(item.key) }"
        >
          <component :is="item.icon" :size="16" class="nav-item__icon" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar__footer">
        <div class="sidebar__model">模型</div>
        <div class="sidebar__model-name">{{ currentModel }}</div>
      </div>
    </aside>

    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: #0f172a;
  color: #cbd5e1;
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  box-sizing: border-box;
}
.sidebar__brand {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  padding: 6px 10px 18px;
}
.sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  text-decoration: none;
  transition: background 0.15s ease;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.nav-item--active {
  background: #2563eb;
  color: #fff;
}
.nav-item__icon {
  font-size: 16px;
}
.sidebar__footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 12px;
}
.sidebar__model {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.sidebar__model-name {
  font-size: 13px;
  color: #e2e8f0;
  margin-top: 2px;
  word-break: break-all;
}
.content {
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow-y: auto;
}
</style>
