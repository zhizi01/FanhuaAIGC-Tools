<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { FolderPlus, FolderOpen, Settings, Clock, Trash2, Film } from 'lucide-vue-next'
import { api } from '../services/bridge.js'
import { setCurrentProject } from '../store/appState.js'
import { formatTime } from '../utils/format.js'

const router = useRouter()

const recentProjects = ref([])
const loading = ref(false)

const createModalOpen = ref(false)
const creating = ref(false)
const form = reactive({ name: '', location: '', description: '' })

async function loadRecent() {
  loading.value = true
  try {
    recentProjects.value = await api.projects.listRecent()
  } catch (err) {
    message.error('加载最近工程失败：' + err.message)
  } finally {
    loading.value = false
  }
}

function enterProject(project) {
  setCurrentProject(project)
  router.push('/project/scripts')
}

async function openFromRecent(item) {
  try {
    const project = await api.projects.open(item.path)
    enterProject(project)
  } catch (err) {
    message.error('打开工程失败：' + err.message)
    loadRecent()
  }
}

async function openExisting() {
  try {
    const dir = await api.dialog.selectProjectDir()
    if (!dir) return
    const project = await api.projects.open(dir)
    enterProject(project)
  } catch (err) {
    message.error('打开工程失败：' + err.message)
  }
}

async function removeRecent(item) {
  try {
    await api.projects.removeRecent(item.id)
    message.success('已从列表移除（未删除本地文件）')
    loadRecent()
  } catch (err) {
    message.error('移除失败：' + err.message)
  }
}

function openCreateModal() {
  form.name = ''
  form.location = ''
  form.description = ''
  createModalOpen.value = true
}

async function chooseLocation() {
  try {
    const dir = await api.dialog.selectProjectDir()
    if (dir) form.location = dir
  } catch (err) {
    message.error(err.message)
  }
}

async function submitCreate() {
  if (!form.name.trim()) return message.warning('请填写工程名称')
  if (!form.location.trim()) return message.warning('请选择工程保存路径')
  creating.value = true
  try {
    const project = await api.projects.create({
      name: form.name.trim(),
      location: form.location.trim(),
      description: form.description.trim(),
    })
    message.success('工程创建成功')
    createModalOpen.value = false
    enterProject(project)
  } catch (err) {
    message.error('创建失败：' + err.message)
  } finally {
    creating.value = false
  }
}

onMounted(loadRecent)
</script>

<template>
  <div class="start-view">
    <aside class="start-sidebar">
      <div class="brand">
        <div class="brand-logo"><Film :size="26" /></div>
        <div class="brand-text">
          <div class="brand-title">青山AI漫剧工具</div>
          <div class="brand-sub">本地漫剧创作工作台</div>
        </div>
      </div>

      <div class="sidebar-actions">
        <a-button type="primary" size="large" block @click="openCreateModal">
          <template #icon><FolderPlus :size="16" /></template>
          新建工程
        </a-button>
        <a-button size="large" block @click="openExisting">
          <template #icon><FolderOpen :size="16" /></template>
          打开工程
        </a-button>
      </div>

      <div class="sidebar-footer">
        <a-button type="text" block class="settings-btn" @click="router.push('/settings')">
          <template #icon><Settings :size="16" /></template>
          设置
        </a-button>
      </div>
    </aside>

    <main class="start-main">
      <header class="main-header">
        <h2>最近工程</h2>
        <span class="main-count" v-if="recentProjects.length">{{ recentProjects.length }} 个工程</span>
      </header>

      <a-spin :spinning="loading">
        <div v-if="recentProjects.length" class="project-list">
          <div
            v-for="item in recentProjects"
            :key="item.id"
            class="project-card"
            @click="openFromRecent(item)"
          >
            <div class="project-avatar">{{ (item.name || '?').slice(0, 1) }}</div>
            <div class="project-info">
              <div class="project-name">{{ item.name }}</div>
              <div class="project-path" :title="item.path">{{ item.path }}</div>
            </div>
            <div class="project-meta">
              <span class="project-time"><Clock :size="13" /> {{ formatTime(item.lastOpenedAt) }}</span>
            </div>
            <a-button
              type="text"
              class="project-remove"
              title="从列表移除"
              @click.stop="removeRecent(item)"
            >
              <Trash2 :size="15" />
            </a-button>
          </div>
        </div>

        <a-empty v-else description="还没有工程，点击左侧「新建工程」开始创作" class="empty-block" />
      </a-spin>
    </main>

    <a-modal
      v-model:open="createModalOpen"
      title="新建工程"
      :confirm-loading="creating"
      ok-text="创建"
      cancel-text="取消"
      @ok="submitCreate"
    >
      <a-form layout="vertical" class="create-form">
        <a-form-item label="工程名称" required>
          <a-input v-model:value="form.name" placeholder="例如：都市异闻录" allow-clear />
        </a-form-item>
        <a-form-item label="工程保存路径" required>
          <a-input-group compact class="path-group">
            <a-input
              v-model:value="form.location"
              placeholder="选择工程保存的父目录"
              readonly
              class="path-input"
            />
            <a-button @click="chooseLocation">浏览</a-button>
          </a-input-group>
          <div class="path-hint" v-if="form.location && form.name">
            将创建到：{{ form.location }}\{{ form.name }}
          </div>
        </a-form-item>
        <a-form-item label="工程描述（可选）">
          <a-textarea
            v-model:value="form.description"
            placeholder="简单描述这部作品"
            :rows="3"
            allow-clear
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.start-view {
  display: flex;
  height: 100%;
  background: var(--bg-app);
}

.start-sidebar {
  width: 300px;
  flex-shrink: 0;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-color);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-logo {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
  box-shadow: 0 6px 16px var(--brand-soft);
}
.brand-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.2px;
}
.brand-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-footer {
  margin-top: auto;
}
.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.start-main {
  flex: 1;
  padding: 32px 40px;
  overflow-y: auto;
}
.main-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 20px;
}
.main-header h2 {
  margin: 0;
  font-size: 20px;
  color: var(--text-primary);
}
.main-count {
  font-size: 13px;
  color: var(--text-tertiary);
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 900px;
}
.project-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}
.project-card:hover {
  border-color: var(--brand-color);
  box-shadow: var(--shadow-card);
  transform: translateY(-1px);
}
.project-avatar {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  font-weight: 700;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
  box-shadow: 0 4px 12px var(--brand-soft);
}
.project-info {
  flex: 1;
  min-width: 0;
}
.project-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.project-path {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-meta {
  flex-shrink: 0;
}
.project-time {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
}
.project-remove {
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.project-card:hover .project-remove {
  opacity: 1;
}
.project-remove:hover {
  color: #ff4d4f;
}

.empty-block {
  margin-top: 80px;
}

.path-group {
  display: flex;
}
.path-input {
  flex: 1;
}
.path-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
