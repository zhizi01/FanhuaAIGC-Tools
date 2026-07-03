<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { appState, computeIsDark } from './store/appState.js'

const router = useRouter()

onMounted(() => {
  // 响应窗口菜单的导航请求
  if (window.api?.onNavigate) {
    window.api.onNavigate((path) => router.push(path))
  }
})

const themeConfig = computed(() => {
  const appearance = appState.settings.appearance
  const dark = computeIsDark(appearance)
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: appearance.primaryColor || '#1ec9b0',
      borderRadius: 8,
    },
  }
})
</script>

<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <a-app class="app-root">
      <router-view />
    </a-app>
  </a-config-provider>
</template>

<style>
.app-root {
  height: 100%;
}
</style>
