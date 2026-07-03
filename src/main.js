import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'

import App from './App.vue'
import router from './router/index.js'
import { appState, applyAppearance, loadSettings } from './store/appState.js'

import './styles/theme.css'
import './styles/global.css'

async function bootstrap() {
  // 先加载设置，保证首屏主题正确
  try {
    await loadSettings()
  } catch (err) {
    console.error('加载设置失败：', err)
  }

  // 跟随系统主题变化时实时刷新
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (appState.settings.appearance.themeMode === 'system') {
      applyAppearance(appState.settings.appearance)
    }
  })

  const app = createApp(App)
  app.use(router)
  app.use(Antd)
  app.mount('#app')
}

bootstrap()
