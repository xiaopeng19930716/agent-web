import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'
import './assets/theme.css'
import App from './App.vue'
import router from './router'
import { initSettings } from './settings.js'

// 启动时应用主题（暗色模式），避免首屏闪烁
const savedTheme = localStorage.getItem('agent-theme')
if (savedTheme === 'dark') document.documentElement.classList.add('dark')

// 启动时从后端拉取用户配置（~/.code-agent/settings.json）
initSettings()

createApp(App).use(Antd).use(router).mount('#app')
