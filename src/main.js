import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { initSettings } from './settings.js'

// 启动时从后端拉取用户配置（~/.code-agent/settings.json）
initSettings()

createApp(App).use(Antd).use(router).mount('#app')
