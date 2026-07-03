<script setup>
// 全局 AI 任务状态浮标：运行中/完成/失败，跨界面常驻
import { computed, watch, onBeforeUnmount } from 'vue'
import { LoaderCircle, CheckCircle2, AlertCircle, X } from 'lucide-vue-next'
import { useAiTaskStore } from '../store/aiTasks.js'

const aiTask = useAiTaskStore()

const visible = computed(() => aiTask.status !== 'idle')

const kindLabel = computed(() => (aiTask.kind === 'ai' ? 'AI生成' : '标准化'))

let timer = null
watch(
  () => aiTask.status,
  (s) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    // 完成/失败后自动隐藏
    if (s === 'done') timer = setTimeout(() => aiTask.dismiss(), 6000)
    if (s === 'error') timer = setTimeout(() => aiTask.dismiss(), 10000)
  },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

function close() {
  if (timer) clearTimeout(timer)
  aiTask.dismiss()
}
</script>

<template>
  <transition name="fade-up">
    <div v-if="visible" class="ai-indicator" :class="aiTask.status">
      <div class="ai-ico">
        <LoaderCircle v-if="aiTask.status === 'running'" :size="20" class="spin" />
        <CheckCircle2 v-else-if="aiTask.status === 'done'" :size="20" />
        <AlertCircle v-else :size="20" />
      </div>
      <div class="ai-body">
        <div class="ai-title">
          <template v-if="aiTask.status === 'running'">正在{{ kindLabel }}剧本…</template>
          <template v-else-if="aiTask.status === 'done'">剧本已生成</template>
          <template v-else>生成失败</template>
        </div>
        <div class="ai-desc">
          <template v-if="aiTask.status === 'error'">{{ aiTask.error }}</template>
          <template v-else>《{{ aiTask.title }}》· {{ aiTask.projectName }}</template>
        </div>
        <div v-if="aiTask.status === 'done'" class="ai-hint">已放入总览，可在剧本库「一键转化为项目剧本」</div>
      </div>
      <button v-if="aiTask.status !== 'running'" class="ai-close" @click="close">
        <X :size="15" />
      </button>
    </div>
  </transition>
</template>

<style scoped>
.ai-indicator {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2000;
  width: 340px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-pop);
}
.ai-indicator.running {
  border-color: var(--brand-color);
}
.ai-indicator.done {
  border-color: var(--brand-color);
}
.ai-indicator.error {
  border-color: #ff4d4f;
}
.ai-ico {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--bg-active);
  color: var(--brand-color);
}
.ai-indicator.error .ai-ico {
  background: rgba(255, 77, 79, 0.12);
  color: #ff4d4f;
}
.ai-body {
  flex: 1;
  min-width: 0;
}
.ai-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.ai-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  word-break: break-word;
}
.ai-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
}
.ai-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  transition: all 0.14s ease;
}
.ai-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.spin {
  animation: ai-spin 0.9s linear infinite;
}
@keyframes ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
