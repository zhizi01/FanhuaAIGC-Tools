<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { Upload, Sparkles, Save, FileText, Plus } from 'lucide-vue-next'
import { appState } from '../../store/appState.js'
import { api } from '../../services/bridge.js'

const project = computed(() => appState.currentProject)
const scripts = ref([])
const loading = ref(false)

async function loadScripts() {
  if (!project.value?.path) return
  loading.value = true
  try {
    scripts.value = await api.scripts.list(project.value.path)
  } catch (err) {
    message.error('加载剧本失败：' + err.message)
  } finally {
    loading.value = false
  }
}

function comingSoon() {
  message.info('该能力将在下一步开放')
}

onMounted(loadScripts)
</script>

<template>
  <div class="script-library">
    <header class="lib-toolbar">
      <div class="toolbar-left">
        <FileText :size="18" class="toolbar-icon" />
        <span class="toolbar-title">剧本库</span>
        <span class="toolbar-sub">当前作品的分集剧本工作区</span>
      </div>
      <div class="toolbar-right">
        <a-button @click="comingSoon">
          <template #icon><Upload :size="15" /></template>
          上传剧本
        </a-button>
        <a-button @click="comingSoon">
          <template #icon><Sparkles :size="15" /></template>
          AI生成
        </a-button>
        <a-button type="primary" @click="comingSoon">
          <template #icon><Save :size="15" /></template>
          保存
        </a-button>
      </div>
    </header>

    <div class="lib-body">
      <aside class="episode-nav">
        <div class="nav-title">分集目录</div>
        <div class="nav-item active">总览</div>
        <div class="nav-empty">尚无分集</div>
      </aside>

      <section class="work-area">
        <div class="work-empty">
          <div class="work-empty-icon"><Plus :size="30" /></div>
          <h3>开始创作这部作品的剧本</h3>
          <p>你可以新建并手写剧本，或上传外部文档、使用 AI 生成分集剧本。</p>
          <a-space>
            <a-button type="primary" @click="comingSoon">新建剧本</a-button>
            <a-button @click="comingSoon">上传剧本</a-button>
            <a-button @click="comingSoon">AI生成</a-button>
          </a-space>
          <div class="work-note">剧本库的编辑、上传解析与 AI 标准化能力将在下一步实现。</div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.script-library {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.lib-toolbar {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-icon {
  color: var(--brand-color);
}
.toolbar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.toolbar-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: 4px;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}

.lib-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.episode-nav {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-panel);
  padding: 14px 10px;
}
.nav-title {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 4px 10px 10px;
}
.nav-item {
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
}
.nav-item.active {
  background: var(--bg-active);
  color: var(--brand-color);
  font-weight: 600;
}
.nav-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.work-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
.work-empty {
  text-align: center;
  max-width: 420px;
  color: var(--text-secondary);
}
.work-empty-icon {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-color);
  background: var(--bg-active);
}
.work-empty h3 {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--text-primary);
}
.work-empty p {
  margin: 0 0 18px;
  font-size: 13px;
}
.work-note {
  margin-top: 18px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
