import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'

import App from './App.vue'
import router from './router/index.js'
import { useAppStore, applyAppearance } from './store/appState.js'

import './styles/theme.css'
import './styles/global.css'

async function bootstrap() {
  const app = createApp(App)
  app.use(createPinia())

  const appStore = useAppStore()

  // 先加载设置，保证首屏主题正确
  try {
    await appStore.loadSettings()
  } catch (err) {
    console.error('加载设置失败：', err)
  }

  // 跟随系统主题变化时实时刷新
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (appStore.settings.appearance.themeMode === 'system') {
      applyAppearance(appStore.settings.appearance)
    }
  })

  app.use(router)
  app.use(Antd)
  app.mount('#app')
}

bootstrap()
