<script setup>
import { computed } from 'vue'
import { theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { appState, computeIsDark } from './store/appState.js'
import AiTaskIndicator from './components/AiTaskIndicator.vue'

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
      <AiTaskIndicator />
    </a-app>
  </a-config-provider>
</template>

<style>
.app-root {
  height: 100%;
}
</style>
