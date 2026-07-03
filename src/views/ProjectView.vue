<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderKanban, ScrollText, Users, Package, Film, LogOut, Settings, Coins } from 'lucide-vue-next'
import { useAppStore } from '../store/appState.js'
import { useUsageStore, formatTokens } from '../store/usage.js'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const usage = useUsageStore()

const project = computed(() => appStore.currentProject)

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

function backToStart() {
  router.push('/')
}

function openSettings() {
  router.push('/settings')
}

onMounted(() => {
  appStore.restoreCurrentProject()
  usage.load(project.value?.path)
})

watch(
  () => project.value?.path,
  (p) => {
    if (p) usage.load(p)
  },
)
</script>

<template>
  <div class="project-shell">
    <aside class="project-side">
      <!-- 品牌：软件标题 + 当前工程名作为副标题 -->
      <div class="side-brand">
        <div class="side-logo"><Film :size="20" /></div>
        <div class="side-brand-text">
          <div class="side-app-name">青山AI漫剧工具</div>
          <div class="side-project-name" :title="project?.name">
            {{ project?.name || '未打开工程' }}
          </div>
        </div>
      </div>

      <nav class="side-menu">
        <button
          v-for="item in menus"
          :key="item.key"
          class="menu-item"
          :class="{ active: activeKey === item.key }"
          @click="go(item)"
        >
          <span class="menu-ico"><component :is="item.icon" :size="18" /></span>
          <span class="menu-label">{{ item.label }}</span>
        </button>
      </nav>

      <!-- 侧栏底部：Token 用量（分割线上方） + 设置 + 返回主菜单 -->
      <div class="side-bottom">
        <!-- Token 用量（默认简展示，悬停出详情） -->
        <a-popover placement="topLeft" trigger="hover">
          <template #content>
            <div class="usage-pop">
              <div class="usage-pop-title">本工程 Token 用量</div>
              <div class="usage-pop-row"><span>总消耗</span><b>{{ usage.totalTokens.toLocaleString() }}</b></div>
              <div class="usage-pop-row"><span>输入</span><b>{{ usage.promptTokens.toLocaleString() }}</b></div>
              <div class="usage-pop-row"><span>输出</span><b>{{ usage.completionTokens.toLocaleString() }}</b></div>
              <div class="usage-pop-row"><span>请求次数</span><b>{{ usage.requests }}</b></div>
            </div>
          </template>
          <div class="side-usage">
            <Coins :size="15" />
            <span class="usage-num">{{ formatTokens(usage.totalTokens) }}</span>
            <span class="usage-unit">tokens</span>
          </div>
        </a-popover>

        <div class="side-footer">
          <button class="foot-item" @click="openSettings">
            <Settings :size="17" />
            <span>设置</span>
          </button>
          <button class="foot-item back" @click="backToStart">
            <LogOut :size="17" />
            <span>返回主菜单</span>
          </button>
        </div>
      </div>
    </aside>

    <div class="project-work">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.project-shell {
  display: flex;
  height: 100%;
  background: transparent;
}

.project-side {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 18px 14px;
}

/* 品牌区 */
.side-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 8px 18px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}
.side-logo {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
  box-shadow: 0 4px 12px var(--brand-soft);
}
.side-brand-text {
  min-width: 0;
}
.side-app-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.side-project-name {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 导航菜单 */
.side-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.menu-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  height: 42px;
  padding: 0 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
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
.menu-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 0 3px 3px 0;
  background: var(--brand-color);
}
.menu-ico {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 底部区域：用量 + 分割线 + 操作 */
.side-bottom {
  margin-top: auto;
}
.side-footer {
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.foot-item {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 40px;
  padding: 0 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}
.foot-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.foot-item.back:hover {
  color: var(--brand-color);
}

/* 左下角 Token 用量 */
.side-usage {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: default;
  transition: background 0.16s ease, color 0.16s ease;
}
.side-usage:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.usage-num {
  font-weight: 600;
  color: var(--text-secondary);
}
.usage-unit {
  opacity: 0.8;
}

.project-work {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>

<style>
/* 用量气泡内容随 a-popover 传送到 body，需使用非 scoped 样式 */
.usage-pop {
  min-width: 190px;
}
.usage-pop-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.usage-pop-row {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 3px 0;
}
.usage-pop-row b {
  color: var(--text-primary);
  font-weight: 600;
}
</style>
