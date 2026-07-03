<script setup>
import { computed } from 'vue'
import { FolderKanban } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { formatTime } from '../../utils/format.js'

const appStore = useAppStore()
const project = computed(() => appStore.currentProject || {})
</script>

<template>
  <div class="page-scroll">
    <div class="page-inner">
      <div class="page-head">
        <div class="page-head-icon"><FolderKanban :size="22" /></div>
        <div>
          <h2 class="page-title">{{ project.name || '工程' }}</h2>
          <div class="page-sub">工程概览</div>
        </div>
      </div>

      <div class="info-card">
        <div class="info-row">
          <span class="info-label">工程名称</span>
          <span class="info-value">{{ project.name || '-' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">工程路径</span>
          <span class="info-value path">{{ project.path || '-' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">工程描述</span>
          <span class="info-value">{{ project.description || '暂无描述' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">创建时间</span>
          <span class="info-value">{{ formatTime(project.createdAt) || '-' }}</span>
        </div>
      </div>

      <a-alert
        type="info"
        show-icon
        message="工程模块的统计与流程功能将在后续阶段开放，当前请前往「剧本库」进行创作。"
        class="hint"
      />
    </div>
  </div>
</template>

<style scoped>
.page-scroll {
  height: 100%;
  overflow-y: auto;
}
.page-inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 28px 32px;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}
.page-head-icon {
  width: 48px;
  height: 48px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
  box-shadow: 0 6px 16px var(--brand-soft);
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}
.page-sub {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.info-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 8px 20px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
}
.info-row {
  display: flex;
  gap: 20px;
  padding: 14px 0;
  border-top: 1px solid var(--border-color);
}
.info-row:first-child {
  border-top: none;
}
.info-label {
  width: 88px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}
.info-value {
  color: var(--text-primary);
  font-size: 14px;
  word-break: break-all;
}
.info-value.path {
  color: var(--text-secondary);
  font-family: 'Consolas', monospace;
  font-size: 13px;
}
.hint {
  border-radius: var(--radius-md);
}
</style>
