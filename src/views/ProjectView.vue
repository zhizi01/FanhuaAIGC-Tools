<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderKanban, ScrollText, Users, Package, Film } from 'lucide-vue-next'
import { appState, restoreCurrentProject, setCurrentModel } from '../store/appState.js'

const route = useRoute()
const router = useRouter()

const project = computed(() => appState.currentProject)
const models = computed(() => appState.settings.models)

const menus = [
  { key: 'project-home', label: '工程', path: '/project/home', icon: FolderKanban },
  { key: 'project-scripts', label: '剧本库', path: '/project/scripts', icon: ScrollText },
  { key: 'project-roles', label: '角色库', path: '/project/roles', icon: Users },
  { key: 'project-assets', label: '资产库', path: '/project/assets', icon: Package },
]

const activeKey = computed(() => route.name)

function go(item) {
  if (route.path !== item.path) router.push(item.path)
}

function onModelChange(id) {
  setCurrentModel(id)
}

onMounted(() => {
  restoreCurrentProject()
})
</script>

<template>
  <div class="project-shell">
    <aside class="project-side">
      <div class="side-brand">
        <div class="side-logo"><Film :size="20" /></div>
        <span class="side-app-name">青山AI漫剧</span>
      </div>

      <nav class="side-menu">
        <button
          v-for="item in menus"
          :key="item.key"
          class="menu-item"
          :class="{ active: activeKey === item.key }"
          @click="go(item)"
        >
          <component :is="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <div class="project-work">
      <header class="work-topbar">
        <div class="topbar-left">
          <span class="project-name">{{ project?.name || '未打开工程' }}</span>
        </div>
        <div class="topbar-right">
          <span class="model-label">模型</span>
          <a-select
            :value="appState.currentModelId"
            style="width: 220px"
            placeholder="未配置模型"
            :options="models.map((m) => ({ value: m.id, label: m.displayName }))"
            @change="onModelChange"
          >
            <template #notFoundContent>
              <div class="model-empty">请先在设置中添加模型</div>
            </template>
          </a-select>
        </div>
      </header>

      <div class="work-content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-shell {
  display: flex;
  height: 100%;
  background: var(--bg-app);
}

.project-side {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}
.side-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 18px;
}
.side-logo {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--brand-color), #37e0c4);
}
.side-app-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.side-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.menu-item.active {
  background: var(--bg-active);
  color: var(--brand-color);
  font-weight: 600;
}

.project-work {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.work-topbar {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-color);
}
.project-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.model-label {
  font-size: 13px;
  color: var(--text-tertiary);
}
.model-empty {
  padding: 8px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}

.work-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
</style>
