import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/chat' },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../components/ChatPanel.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../components/SettingsPanel.vue'),
    redirect: '/settings/models',
    children: [
      {
        path: 'models',
        name: 'settings-models',
        component: () => import('../components/ModelSettings.vue'),
        meta: { title: '模型配置' },
      },
      {
        path: 'mcp',
        name: 'settings-mcp',
        component: () => import('../components/McpSettings.vue'),
        meta: { title: 'MCP设置' },
      },
      {
        path: 'skills',
        name: 'settings-skills',
        component: () => import('../components/SkillsSettings.vue'),
        meta: { title: 'Skills设置' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/chat' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
