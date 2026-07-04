<script setup>
// 资产库：当前作品的素材管理
// 左：类型/文件夹筛选 中：资产网格/列表 + 导入/同步 右：资产详情编辑与预览
import { computed, onMounted, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  Package,
  Image as ImageIcon,
  Music,
  Video as VideoIcon,
  FileText,
  Upload,
  Search,
  Trash2,
  LayoutGrid,
  List as ListIcon,
  Save,
  Folder,
  RefreshCw,
} from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { api } from '../../services/bridge.js'
import { assetUrl, formatSize } from '../../utils/asset.js'

const appStore = useAppStore()
const project = computed(() => appStore.currentProject)

const TYPE_FILTERS = [
  { value: '', label: '全部资产', icon: Package },
  { value: 'image', label: '图片', icon: ImageIcon },
  { value: 'audio', label: '音频', icon: Music },
  { value: 'video', label: '视频', icon: VideoIcon },
  { value: 'document', label: '文档', icon: FileText },
]

const assets = ref([])
const loading = ref(false)
const importing = ref(false)
const syncing = ref(false)
const saving = ref(false)

const search = ref('')
const filterType = ref('')
const filterFolder = ref('')
const viewMode = ref('grid') // grid | list

const detail = ref(null) // 完整 meta
const dirty = ref(false)
const form = reactive({
  id: '',
  name: '',
  folder: '未归档',
  description: '',
  usage: '',
  linkedRoleIds: [],
  linkedEpisodes: [],
})

// 关联可选项：角色与剧集
const roleOptions = ref([])
const episodeOptions = ref([])

async function loadRoleOptions() {
  if (!project.value?.path) return
  try {
    const list = await api.roles.list(project.value.path)
    roleOptions.value = list.map((r) => ({ value: r.id, label: r.name }))
  } catch {
    roleOptions.value = []
  }
}
async function loadEpisodeOptions() {
  if (!project.value?.path) return
  try {
    const list = await api.scripts.list(project.value.path)
    if (!list.length) return (episodeOptions.value = [])
    const data = await api.scripts.read({ projectPath: project.value.path, scriptId: list[0].id })
    episodeOptions.value = (data.meta.episodes || []).map((e) => ({
      value: e.episodeNo,
      label: `第${e.episodeNo}集`,
    }))
  } catch {
    episodeOptions.value = []
  }
}

const filteredAssets = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return assets.value.filter((a) => {
    if (filterType.value && a.type !== filterType.value) return false
    if (filterFolder.value && (a.folder || '未归档') !== filterFolder.value) return false
    const haystack = [a.name, a.folder, a.originalName].filter(Boolean).join(' ').toLowerCase()
    if (kw && !haystack.includes(kw)) return false
    return true
  })
})

const folderOptions = computed(() => {
  const set = new Set(['未归档'])
  assets.value.forEach((a) => set.add(a.folder || '未归档'))
  return [...set].map((f) => ({ value: f, label: f }))
})

const typeCounts = computed(() => {
  const counts = { '': assets.value.length, image: 0, audio: 0, video: 0, document: 0 }
  assets.value.forEach((a) => {
    if (counts[a.type] != null) counts[a.type] += 1
  })
  return counts
})

function typeIcon(type) {
  if (type === 'image') return ImageIcon
  if (type === 'audio') return Music
  if (type === 'video') return VideoIcon
  if (type === 'document') return FileText
  return Package
}

function thumbFor(a) {
  if (a.type === 'image') return assetUrl(project.value?.path, a.thumbnail || a.file)
  return ''
}

function sourceLabel(source) {
  if (source === 'generated') return '项目生成'
  if (source === 'import') return '手动导入'
  return source || '未知'
}

const previewUrl = computed(() => (detail.value ? assetUrl(project.value?.path, detail.value.file) : ''))

async function loadAssets() {
  if (!project.value?.path) return
  loading.value = true
  try {
    assets.value = await api.assets.list(project.value.path)
  } catch (err) {
    message.error('加载资产失败：' + err.message)
  } finally {
    loading.value = false
  }
}

async function importAssets() {
  if (!project.value?.path) return
  try {
    const filePaths = await api.dialog.selectAssetFiles()
    if (!filePaths || !filePaths.length) return
    importing.value = true
    const created = await api.assets.import({ projectPath: project.value.path, filePaths })
    await loadAssets()
    message.success(`已导入 ${created.length} 个资产`)
    if (created.length) selectAsset(created[0].id)
  } catch (err) {
    message.error('导入失败：' + err.message)
  } finally {
    importing.value = false
  }
}

async function syncGeneratedAssets() {
  if (!project.value?.path) return
  syncing.value = true
  try {
    const synced = await api.assets.syncGenerated(project.value.path)
    await loadAssets()
    message.success(`已同步 ${synced.length} 个项目资产`)
    if (synced.length) selectAsset(synced[0].id)
  } catch (err) {
    message.error('同步失败：' + err.message)
  } finally {
    syncing.value = false
  }
}

async function selectAsset(id) {
  if (dirty.value && detail.value && id !== detail.value.id) {
    return Modal.confirm({
      title: '有未保存的修改',
      content: '切换后当前未保存的修改会丢失，确定继续吗？',
      okText: '放弃修改',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => doSelect(id),
    })
  }
  doSelect(id)
}

async function doSelect(id) {
  try {
    const meta = await api.assets.read({ projectPath: project.value.path, assetId: id })
    detail.value = meta
    Object.assign(form, {
      id: meta.id,
      name: meta.name || '',
      folder: meta.folder || meta.category || '未归档',
      description: meta.description || '',
      usage: meta.usage || '',
      linkedRoleIds: [...(meta.linkedRoleIds || [])],
      linkedEpisodes: [...(meta.linkedEpisodes || [])],
    })
    dirty.value = false
  } catch (err) {
    message.error('读取资产失败：' + err.message)
  }
}

async function saveDetail() {
  if (!detail.value) return
  saving.value = true
  try {
    await api.assets.save({
      projectPath: project.value.path,
      asset: {
        id: form.id,
        name: form.name.trim() || '未命名资产',
        folder: form.folder.trim() || '未归档',
        description: form.description,
        usage: form.usage,
        linkedRoleIds: form.linkedRoleIds,
        linkedEpisodes: form.linkedEpisodes,
      },
    })
    await loadAssets()
    dirty.value = false
    message.success('已保存')
  } catch (err) {
    message.error('保存失败：' + err.message)
  } finally {
    saving.value = false
  }
}

function removeAsset() {
  if (!detail.value) return
  const id = detail.value.id
  const name = detail.value.name
  const content =
    detail.value.source === 'generated'
      ? `确定从资产库移除「${name}」吗？这只会移除资产登记，不会删除原始项目文件。`
      : `确定删除「${name}」吗？将删除工程内的文件副本（不影响你的原始文件）。`
  Modal.confirm({
    title: '删除资产',
    content,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await api.assets.remove({ projectPath: project.value.path, assetId: id })
        detail.value = null
        dirty.value = false
        await loadAssets()
        message.success('已删除')
      } catch (err) {
        message.error('删除失败：' + err.message)
      }
    },
  })
}

function markDirty() {
  dirty.value = true
}

onMounted(() => {
  loadAssets()
  loadRoleOptions()
  loadEpisodeOptions()
})
</script>

<template>
  <div class="asset-library">
    <!-- 左：类型 / 文件夹筛选 -->
    <aside class="asset-side">
      <div class="side-label">类型</div>
      <button
        v-for="t in TYPE_FILTERS"
        :key="t.value"
        class="type-item"
        :class="{ active: filterType === t.value }"
        @click="filterType = t.value"
      >
        <component :is="t.icon" :size="16" />
        <span class="type-name">{{ t.label }}</span>
        <span class="type-count">{{ typeCounts[t.value] ?? 0 }}</span>
      </button>

      <div class="side-label mt">文件夹</div>
      <a-select
        v-model:value="filterFolder"
        class="w-full"
        size="small"
        :options="[{ value: '', label: '全部文件夹' }, ...folderOptions]"
      />
    </aside>

    <!-- 中：资产网格 / 列表 -->
    <section class="asset-main">
      <header class="asset-toolbar">
        <div class="asset-search">
          <Search :size="15" class="search-ico" />
          <input v-model="search" class="search-input" placeholder="搜索资产名称" />
        </div>
        <div class="toolbar-right">
          <div class="view-switch">
            <button class="view-btn" :class="{ active: viewMode === 'grid' }" title="网格" @click="viewMode = 'grid'">
              <LayoutGrid :size="15" />
            </button>
            <button class="view-btn" :class="{ active: viewMode === 'list' }" title="列表" @click="viewMode = 'list'">
              <ListIcon :size="15" />
            </button>
          </div>
          <a-button type="primary" :loading="importing" @click="importAssets">
            <template #icon><Upload :size="15" /></template>
            导入资产
          </a-button>
          <a-button :loading="syncing" @click="syncGeneratedAssets">
            <template #icon><RefreshCw :size="15" /></template>
            同步项目资产
          </a-button>
        </div>
      </header>

      <div class="asset-scroll">
        <a-spin :spinning="loading">
          <div v-if="!filteredAssets.length" class="asset-empty">
            <div class="empty-icon"><Package :size="30" /></div>
            <h3>{{ assets.length ? '没有匹配的资产' : '还没有任何资产' }}</h3>
            <p>可导入本地素材，也可以点击「同步项目资产」把剧本等生成内容纳入资产库。</p>
          </div>

          <!-- 网格 -->
          <div v-else-if="viewMode === 'grid'" class="asset-grid">
            <button
              v-for="a in filteredAssets"
              :key="a.id"
              class="grid-item"
              :class="{ active: detail && detail.id === a.id }"
              @click="selectAsset(a.id)"
            >
              <div class="grid-thumb">
                <img v-if="thumbFor(a)" :src="thumbFor(a)" :alt="a.name" />
                <component v-else :is="typeIcon(a.type)" :size="26" />
              </div>
              <div class="grid-name" :title="a.name">{{ a.name }}</div>
            </button>
          </div>

          <!-- 列表 -->
          <div v-else class="asset-list">
            <button
              v-for="a in filteredAssets"
              :key="a.id"
              class="list-item"
              :class="{ active: detail && detail.id === a.id }"
              @click="selectAsset(a.id)"
            >
              <div class="list-thumb">
                <img v-if="thumbFor(a)" :src="thumbFor(a)" :alt="a.name" />
                <component v-else :is="typeIcon(a.type)" :size="18" />
              </div>
              <div class="list-info">
                <div class="list-name">{{ a.name }}</div>
                <div class="list-meta">
                  <Folder :size="12" />
                  <span>{{ a.folder || '未归档' }}</span>
                </div>
              </div>
            </button>
          </div>
        </a-spin>
      </div>
    </section>

    <!-- 右：资产详情 -->
    <aside v-if="detail" class="asset-detail">
      <div class="detail-preview">
        <img v-if="detail.type === 'image'" :src="previewUrl" :alt="detail.name" class="preview-img" />
        <audio v-else-if="detail.type === 'audio'" :src="previewUrl" controls class="preview-audio" />
        <video v-else-if="detail.type === 'video'" :src="previewUrl" controls class="preview-video" />
        <div v-else class="preview-file">
          <component :is="typeIcon(detail.type)" :size="40" />
          <span>{{ detail.originalName }}</span>
        </div>
      </div>

      <a-form layout="vertical" class="detail-form">
        <a-form-item label="名称">
          <a-input v-model:value="form.name" @change="markDirty" />
        </a-form-item>
        <a-form-item label="文件夹">
          <a-input v-model:value="form.folder" placeholder="如：剧本 / 角色参考 / 场景素材" @change="markDirty" />
        </a-form-item>
        <a-form-item label="用途">
          <a-input v-model:value="form.usage" placeholder="如：角色形象参考" @change="markDirty" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="form.description" :rows="3" @change="markDirty" />
        </a-form-item>
        <a-form-item label="关联角色">
          <a-select
            v-model:value="form.linkedRoleIds"
            mode="multiple"
            placeholder="关联到角色"
            :options="roleOptions"
            @change="markDirty"
          />
        </a-form-item>
        <a-form-item label="关联剧集">
          <a-select
            v-model:value="form.linkedEpisodes"
            mode="multiple"
            placeholder="关联到剧集"
            :options="episodeOptions"
            @change="markDirty"
          />
        </a-form-item>
      </a-form>

      <div class="detail-info">
        <div class="info-row"><span>类型</span><b>{{ detail.type }}</b></div>
        <div class="info-row"><span>来源</span><b>{{ sourceLabel(detail.source) }}</b></div>
        <div class="info-row"><span>文件夹</span><b>{{ detail.folder || '未归档' }}</b></div>
        <div class="info-row"><span>大小</span><b>{{ formatSize(detail.size) }}</b></div>
        <div class="info-row"><span>原始文件</span><b class="ellipsis" :title="detail.originalName">{{ detail.originalName }}</b></div>
      </div>

      <div class="detail-actions">
        <a-button danger @click="removeAsset">
          <template #icon><Trash2 :size="15" /></template>
          删除
        </a-button>
        <a-button type="primary" :loading="saving" :disabled="!dirty" @click="saveDetail">
          <template #icon><Save :size="15" /></template>
          保存
        </a-button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.asset-library {
  height: 100%;
  display: flex;
  min-height: 0;
}

/* 左侧筛选 */
.asset-side {
  width: 190px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-panel);
  padding: 14px 10px;
  overflow-y: auto;
}
.side-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 0 8px 8px;
}
.side-label.mt {
  margin-top: 18px;
}
.type-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.type-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.type-item.active {
  background: var(--bg-active);
  color: var(--brand-color);
  font-weight: 600;
}
.type-name {
  flex: 1;
  text-align: left;
}
.type-count {
  font-size: 12px;
  color: var(--text-tertiary);
}
.type-item.active .type-count {
  color: var(--brand-color);
}
.w-full {
  width: 100%;
}

/* 中间资产区 */
.asset-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.asset-toolbar {
  height: 58px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.asset-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 34px;
  width: 260px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}
.search-ico {
  color: var(--text-tertiary);
}
.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  color: var(--text-primary);
  font-size: 13px;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.view-switch {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
}
.view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 5px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.14s ease;
}
.view-btn.active {
  background: var(--bg-panel);
  color: var(--brand-color);
  box-shadow: var(--shadow-sm);
}
.asset-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 18px;
  background: var(--bg-app);
}
.asset-empty {
  margin: 60px auto;
  text-align: center;
  color: var(--text-secondary);
  max-width: 420px;
}
.empty-icon {
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
.asset-empty h3 {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--text-primary);
}
.asset-empty p {
  margin: 0;
  font-size: 13px;
}

/* 网格 */
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 14px;
}
.grid-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  cursor: pointer;
  transition: all 0.16s ease;
}
.grid-item:hover {
  border-color: var(--brand-color);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}
.grid-item.active {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 2px var(--brand-soft);
}
.grid-thumb {
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  color: var(--text-tertiary);
}
.grid-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.grid-name {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

/* 列表 */
.asset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  cursor: pointer;
  text-align: left;
  transition: all 0.14s ease;
}
.list-item:hover {
  border-color: var(--brand-color);
}
.list-item.active {
  border-color: var(--brand-color);
  background: var(--bg-active);
}
.list-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  color: var(--text-tertiary);
}
.list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.list-info {
  min-width: 0;
}
.list-name {
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 右侧详情 */
.asset-detail {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  background: var(--bg-panel);
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-preview {
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-sunken);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}
.preview-img {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
}
.preview-audio {
  width: 100%;
  padding: 20px 12px;
}
.preview-video {
  width: 100%;
  max-height: 240px;
}
.preview-file {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 16px;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
  word-break: break-all;
}
.detail-info {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.info-row b {
  color: var(--text-secondary);
  font-weight: 500;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 170px;
}
.detail-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.detail-actions .ant-btn {
  flex: 1;
}
</style>
