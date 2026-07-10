<script setup>
// 全局 AI 任务状态浮标：剧本生成/标准化、角色提取/调整，运行中/完成/失败，跨界面常驻
import { computed, watch, onBeforeUnmount } from 'vue'
import { LoaderCircle, CheckCircle2, AlertCircle, X } from 'lucide-vue-next'
import { useAiTaskStore } from '../store/aiTasks.js'
import { useRoleTaskStore } from '../store/roleTasks.js'
import { useCanvasAiTaskStore } from '../store/canvasAiTasks.js'

const aiTask = useAiTaskStore()
const roleTask = useRoleTaskStore()
const canvasTask = useCanvasAiTaskStore()

// ---------- 剧本任务 ----------
const aiVisible = computed(() => aiTask.status !== 'idle')
const kindLabel = computed(() => (aiTask.kind === 'ai' ? 'AI生成' : '标准化'))

// ---------- 角色任务 ----------
const roleVisible = computed(() => roleTask.status !== 'idle')
const roleKindLabel = computed(() => (roleTask.kind === 'extract' ? '提取角色' : '调整角色'))
const roleTitle = computed(() => {
  if (roleTask.status === 'running') return `正在AI${roleKindLabel.value}…`
  if (roleTask.status === 'done') return roleTask.kind === 'extract' ? '角色提取与补全完成' : '角色调整完成'
  return roleTask.kind === 'extract' ? '角色提取失败' : '角色调整失败'
})
const roleDesc = computed(() => {
  if (roleTask.status === 'error') return roleTask.error
  if (roleTask.kind === 'extract') {
    if (roleTask.status === 'done') {
      return roleTask.extractCount
        ? `识别到 ${roleTask.extractCount} 个角色，已补全外观、性格与声线`
        : '未识别到角色，可手动新建'
    }
    return '正在从当前剧本分析并补全角色…'
  }
  return roleTask.roleName ? `正在强化外观、性格与声线：${roleTask.roleName}` : ''
})

// ---------- 画布任务（分镜生成 / 剧情卡关联角色） ----------
const canvasVisible = computed(() => canvasTask.status !== 'idle')
const canvasKindLabel = computed(() => (canvasTask.kind === 'storyboard' ? '生成分镜' : '关联角色'))
const canvasTitle = computed(() => {
  if (canvasTask.status === 'running') return `正在AI${canvasKindLabel.value}…`
  if (canvasTask.status === 'done') return canvasTask.kind === 'storyboard' ? '分镜已生成' : '角色已识别'
  return canvasTask.kind === 'storyboard' ? '分镜生成失败' : '角色识别失败'
})
const canvasDesc = computed(() => {
  if (canvasTask.status === 'error') return canvasTask.error
  if (canvasTask.status === 'done') return '请回到工程页确认后写入画布'
  return canvasTask.kind === 'storyboard' ? '正在拆解本集分镜镜头…' : '正在识别参与角色并匹配角色库…'
})

let aiTimer = null
let roleTimer = null
let canvasTimer = null

watch(
  () => aiTask.status,
  (s) => {
    if (aiTimer) {
      clearTimeout(aiTimer)
      aiTimer = null
    }
    // 完成/失败后自动隐藏
    if (s === 'done') aiTimer = setTimeout(() => aiTask.dismiss(), 6000)
    if (s === 'error') aiTimer = setTimeout(() => aiTask.dismiss(), 10000)
  },
)

watch(
  () => roleTask.status,
  (s) => {
    if (roleTimer) {
      clearTimeout(roleTimer)
      roleTimer = null
    }
    // 自动隐藏浮标；提取结果草稿仍保留在 store，回到角色库仍可确认导入
    if (s === 'done') roleTimer = setTimeout(() => roleTask.dismiss(), 8000)
    if (s === 'error') roleTimer = setTimeout(() => roleTask.dismiss(), 10000)
  },
)

watch(
  () => canvasTask.status,
  (s) => {
    if (canvasTimer) {
      clearTimeout(canvasTimer)
      canvasTimer = null
    }
    // 完成态保持常驻，提醒用户回工程页确认（结果暂存 store，取用/关闭前不清理）；失败态自动隐藏
    if (s === 'error') canvasTimer = setTimeout(() => canvasTask.dismiss(), 10000)
  },
)

onBeforeUnmount(() => {
  if (aiTimer) clearTimeout(aiTimer)
  if (roleTimer) clearTimeout(roleTimer)
  if (canvasTimer) clearTimeout(canvasTimer)
})

function closeAi() {
  if (aiTimer) clearTimeout(aiTimer)
  aiTask.dismiss()
}
function closeRole() {
  if (roleTimer) clearTimeout(roleTimer)
  roleTask.dismiss()
}
function closeCanvas() {
  if (canvasTimer) clearTimeout(canvasTimer)
  canvasTask.dismiss()
}
</script>

<template>
  <div class="ai-indicator-stack">
    <transition name="fade-up">
      <div v-if="aiVisible" class="ai-indicator" :class="aiTask.status">
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
        <button v-if="aiTask.status !== 'running'" class="ai-close" @click="closeAi">
          <X :size="15" />
        </button>
      </div>
    </transition>

    <transition name="fade-up">
      <div v-if="roleVisible" class="ai-indicator" :class="roleTask.status">
        <div class="ai-ico">
          <LoaderCircle v-if="roleTask.status === 'running'" :size="20" class="spin" />
          <CheckCircle2 v-else-if="roleTask.status === 'done'" :size="20" />
          <AlertCircle v-else :size="20" />
        </div>
        <div class="ai-body">
          <div class="ai-title">{{ roleTitle }}</div>
          <div class="ai-desc">{{ roleDesc }}</div>
        </div>
        <button v-if="roleTask.status !== 'running'" class="ai-close" @click="closeRole">
          <X :size="15" />
        </button>
      </div>
    </transition>

    <transition name="fade-up">
      <div v-if="canvasVisible" class="ai-indicator" :class="canvasTask.status">
        <div class="ai-ico">
          <LoaderCircle v-if="canvasTask.status === 'running'" :size="20" class="spin" />
          <CheckCircle2 v-else-if="canvasTask.status === 'done'" :size="20" />
          <AlertCircle v-else :size="20" />
        </div>
        <div class="ai-body">
          <div class="ai-title">{{ canvasTitle }}</div>
          <div class="ai-desc">{{ canvasDesc }}</div>
        </div>
        <button v-if="canvasTask.status !== 'running'" class="ai-close" @click="closeCanvas">
          <X :size="15" />
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.ai-indicator-stack {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}
.ai-indicator {
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
