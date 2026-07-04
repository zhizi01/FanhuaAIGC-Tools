<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { message, Modal, theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useAppStore, computeIsDark } from './store/appState.js'
import { useFlowCanvasStore } from './store/flowCanvas.js'
import AiTaskIndicator from './components/AiTaskIndicator.vue'

const appStore = useAppStore()
const flowCanvas = useFlowCanvasStore()
const closePromptOpen = ref(false)

const themeConfig = computed(() => {
  const appearance = appStore.settings.appearance
  const dark = computeIsDark(appearance)
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: appearance.primaryColor || '#1ec9b0',
      borderRadius: 8,
    },
  }
})

function beforeUnload(event) {
  if (!flowCanvas.dirty) return
  event.preventDefault()
  event.returnValue = false
  if (closePromptOpen.value) return
  closePromptOpen.value = true
  Modal.confirm({
    title: '幕布尚未保存',
    content: '关闭软件前是否保存当前幕布？',
    okText: '保存并退出',
    cancelText: '放弃修改',
    async onOk() {
      try {
        await flowCanvas.saveCurrent()
        window.removeEventListener('beforeunload', beforeUnload)
        window.close()
      } catch (err) {
        closePromptOpen.value = false
        message.error('保存幕布失败：' + err.message)
        throw err
      }
    },
    onCancel() {
      flowCanvas.discard(flowCanvas.projectPath)
      window.removeEventListener('beforeunload', beforeUnload)
      window.close()
    },
    afterClose() {
      closePromptOpen.value = false
    },
  })
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
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
