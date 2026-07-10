<script setup>
// 资产库：按「文本 / 图片 / 视频」分类的资产管理，像文件管理器一样支持多层文件夹
// 顶部 Tab 切换资产类型，工具栏含面包屑与新建文件夹/导入；主区展示文件夹与资产，可拖拽移动；右侧编辑详情。
import { computed, onMounted, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Upload,
  Search,
  Trash2,
  LayoutGrid,
  List as ListIcon,
  Save,
  Folder,
  FolderPlus,
  FolderOpen,
  RefreshCw,
  ChevronRight,
  Pencil,
  Package,
} from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../../store/appState.js'
import { api } from '../../services/bridge.js'
import { assetFileUrl, formatSize } from '../../utils/asset.js'

const appStore = useAppStore()
const route = useRoute()
const router = useRouter()
const project = computed(() => appStore.currentProject)

// 三大资产分类（默认文本），与后端 detectType 的类型对应
const TABS = [
  { type: 'document', label: '文本资产', icon: FileText, exts: ['txt', 'md', 'docx', 'pdf'] },
  { type: 'image', label: '图片资产', icon: ImageIcon, exts: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
  { type: 'video', label: '视频资产', icon: VideoIcon, exts: ['mp4', 'mov', 'webm'] },
]

const assets = ref([])
const folderReg = ref([]) // 文件夹注册表（含空文件夹），跨类型
const activeType = ref('document')
const currentPath = ref('') // 当前所在文件夹路径（'' 表示根目录）

const loading = ref(false)
const importing = ref(false)
const syncing = ref(false)
const saving = ref(false)
const search = ref('')
const viewMode = ref('grid') // grid | list

const detail = ref(null)
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

const roleOptions = ref([])
const episodeOptions = ref([])

// 新建/重命名文件夹弹窗
const folderDialog = reactive({ visible: false, mode: 'create', path: '', name: '' })

// 拖拽移动
const draggingAssetId = ref('')
const dragOverPath = ref(null)

const activeTab = computed(() => TABS.find((t) => t.type === activeType.value) || TABS[0])
const activeLabel = computed(() => activeTab.value.label)

function normFolder(f) {
  const s = String(f || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
    .join('/')
  return s === '未归档' ? '' : s
}
function parentOf(p) {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
}
function leafOf(p) {
  return p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p
}
function extOf(fp) {
  const s = String(fp || '')
  return s.includes('.') ? s.slice(s.lastIndexOf('.') + 1).toLowerCase() : ''
}

const typeAssets = computed(() => assets.value.filter((a) => a.type === activeType.value))

const typeCounts = computed(() => {
  const counts = { document: 0, image: 0, video: 0 }
  assets.value.forEach((a) => {
    if (counts[a.type] != null) counts[a.type] += 1
  })
  return counts
})

// 当前类型下的全部文件夹路径（注册表 ∪ 资产推导出的层级）
function folderPaths(type) {
  const set = new Set()
  folderReg.value.forEach((f) => {
    if (f.type !== type) return
    const p = normFolder(f.path)
    if (p) set.add(p)
  })
  assets.value.forEach((a) => {
    if (a.type !== type) return
    let p = normFolder(a.folder)
    while (p) {
      set.add(p)
      p = parentOf(p)
    }
  })
  return [...set]
}

function descendantCount(p) {
  const prefix = p + '/'
  return typeAssets.value.filter((a) => {
    const fp = normFolder(a.folder)
    return fp === p || fp.startsWith(prefix)
  }).length
}

// 当前文件夹下的直接子文件夹
const currentFolders = computed(() => {
  if (search.value.trim()) return []
  const prefix = currentPath.value ? currentPath.value + '/' : ''
  return folderPaths(activeType.value)
    .filter((p) => {
      if (!p.startsWith(prefix)) return false
      const rest = p.slice(prefix.length)
      return rest && !rest.includes('/')
    })
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map((p) => ({ path: p, name: leafOf(p), count: descendantCount(p) }))
})

// 当前文件夹下的资产（搜索时跨当前类型全量匹配）
const currentAssets = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (kw) {
    return typeAssets.value.filter((a) => {
      const hay = [a.name, a.folder, a.originalName].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }
  return typeAssets.value.filter((a) => normFolder(a.folder) === currentPath.value)
})

const breadcrumbs = computed(() => {
  const crumbs = [{ label: activeLabel.value, path: '' }]
  if (!currentPath.value) return crumbs
  let acc = ''
  currentPath.value.split('/').forEach((seg) => {
    acc = acc ? acc + '/' + seg : seg
    crumbs.push({ label: seg, path: acc })
  })
  return crumbs
})

// 详情面板「所在文件夹」树选择数据
const folderTree = computed(() => {
  const type = detail.value?.type || activeType.value
  const nodeMap = new Map()
  const rootChildren = []
  folderPaths(type)
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .forEach((p) => {
      let parentChildren = rootChildren
      let acc = ''
      p.split('/').forEach((seg) => {
        acc = acc ? acc + '/' + seg : seg
        let node = nodeMap.get(acc)
        if (!node) {
          node = { value: acc, title: seg, children: [] }
          nodeMap.set(acc, node)
          parentChildren.push(node)
        }
        parentChildren = node.children
      })
    })
  return [{ value: '未归档', title: '根目录（未归档）', children: rootChildren }]
})

function typeIcon(type) {
  if (type === 'image') return ImageIcon
  if (type === 'video') return VideoIcon
  if (type === 'document') return FileText
  return Package
}
function thumbFor(a) {
  if (a.type === 'image') return assetFileUrl(project.value?.path, a.thumbnail || a.file)
  return ''
}
function sourceLabel(source) {
  if (source === 'generated') return '项目生成'
  if (source === 'import') return '手动导入'
  return source || '未知'
}
const previewUrl = computed(() => (detail.value ? assetFileUrl(project.value?.path, detail.value.file) : ''))

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
async function loadFolders() {
  if (!project.value?.path) return
  try {
    folderReg.value = await api.assets.folders(project.value.path)
  } catch {
    folderReg.value = []
  }
}
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

function switchTab(type) {
  if (type === activeType.value) return
  activeType.value = type
  currentPath.value = ''
  search.value = ''
}
function enterFolder(path) {
  currentPath.value = path
  search.value = ''
}
function goCrumb(path) {
  currentPath.value = path
}

function openCreateFolder() {
  folderDialog.mode = 'create'
  folderDialog.path = currentPath.value
  folderDialog.name = ''
  folderDialog.visible = true
}
function openRenameFolder(path) {
  folderDialog.mode = 'rename'
  folderDialog.path = path
  folderDialog.name = leafOf(path)
  folderDialog.visible = true
}
async function submitFolderDialog() {
  const name = folderDialog.name.trim()
  if (!name) return message.warning('请输入文件夹名称')
  if (name.includes('/') || name.includes('\\')) return message.warning('名称不能包含斜杠')
  try {
    if (folderDialog.mode === 'create') {
      const full = folderDialog.path ? folderDialog.path + '/' + name : name
      if (folderPaths(activeType.value).includes(full)) return message.warning('同名文件夹已存在')
      await api.assets.createFolder({ projectPath: project.value.path, type: activeType.value, path: full })
      message.success('已新建文件夹')
    } else {
      const oldPath = folderDialog.path
      const newPath = parentOf(oldPath) ? parentOf(oldPath) + '/' + name : name
      await api.assets.renameFolder({
        projectPath: project.value.path,
        type: activeType.value,
        path: oldPath,
        name,
      })
      // 若当前所在目录处于被重命名的子树内，同步更新路径
      if (currentPath.value === oldPath) currentPath.value = newPath
      else if (currentPath.value.startsWith(oldPath + '/'))
        currentPath.value = newPath + currentPath.value.slice(oldPath.length)
      message.success('已重命名文件夹')
    }
    folderDialog.visible = false
    await Promise.all([loadFolders(), loadAssets()])
  } catch (err) {
    message.error(err.message)
  }
}
function confirmRemoveFolder(path) {
  Modal.confirm({
    title: '删除文件夹',
    content: `确定删除「${leafOf(path)}」吗？文件夹内的资产会移动到根目录，不会删除资产文件。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await api.assets.removeFolder({ projectPath: project.value.path, type: activeType.value, path })
        if (currentPath.value === path || currentPath.value.startsWith(path + '/')) {
          currentPath.value = parentOf(path)
        }
        await Promise.all([loadFolders(), loadAssets()])
        message.success('已删除文件夹')
      } catch (err) {
        message.error('删除失败：' + err.message)
      }
    },
  })
}

async function importAssets() {
  if (!project.value?.path) return
  try {
    const filePaths = await api.dialog.selectAssetFiles()
    if (!filePaths || !filePaths.length) return
    const exts = activeTab.value.exts
    const matched = filePaths.filter((fp) => exts.includes(extOf(fp)))
    if (!matched.length) return message.warning(`请选择${activeLabel.value}支持的文件类型`)
    importing.value = true
    const created = await api.assets.import({
      projectPath: project.value.path,
      filePaths: matched,
      folder: currentPath.value || '未归档',
    })
    await loadAssets()
    message.success(`已导入 ${created.length} 个资产`)
    if (matched.length < filePaths.length) message.info('已跳过与当前分类不匹配的文件')
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
    if (synced.length) {
      activeType.value = 'document'
      selectAsset(synced[0].id)
    }
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
        folder: form.folder || '未归档',
        description: form.description,
        usage: form.usage,
        linkedRoleIds: form.linkedRoleIds,
        linkedEpisodes: form.linkedEpisodes,
      },
    })
    await Promise.all([loadAssets(), loadFolders()])
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

// ---------- 拖拽移动资产 ----------
function onAssetDragStart(id, e) {
  draggingAssetId.value = id
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onAssetDragEnd() {
  draggingAssetId.value = ''
  dragOverPath.value = null
}
function onDropTarget(path) {
  if (draggingAssetId.value) dragOverPath.value = path
}
async function dropToFolder(path) {
  const id = draggingAssetId.value
  draggingAssetId.value = ''
  dragOverPath.value = null
  if (!id) return
  const asset = assets.value.find((a) => a.id === id)
  if (!asset || normFolder(asset.folder) === normFolder(path)) return
  try {
    await api.assets.move({ projectPath: project.value.path, assetId: id, folder: path || '未归档' })
    await loadAssets()
    if (detail.value?.id === id) doSelect(id)
    message.success(`已移动到「${path ? leafOf(path) : '根目录'}」`)
  } catch (err) {
    message.error('移动失败：' + err.message)
  }
}

onMounted(async () => {
  await Promise.all([loadAssets(), loadFolders()])
  loadRoleOptions()
  loadEpisodeOptions()
  // 从工程画布「编辑图片」跳转而来：切到对应分类与文件夹并选中
  const targetAssetId = route.query.assetId
  if (targetAssetId) {
    router.replace({ path: '/project/assets' })
    const hit = assets.value.find((a) => a.id === String(targetAssetId))
    if (hit) {
      if (TABS.some((t) => t.type === hit.type)) activeType.value = hit.type
      currentPath.value = normFolder(hit.folder)
    }
    selectAsset(String(targetAssetId))
  }
})
</script>

<template>
  <div class="asset-library">
    <!-- 顶部分类 Tab -->
    <div class="asset-tabs">
      <div class="tab-group">
        <button
          v-for="t in TABS"
          :key="t.type"
          class="tab-item"
          :class="{ active: activeType === t.type }"
          @click="switchTab(t.type)"
        >
          <component :is="t.icon" :size="16" />
          <span>{{ t.label }}</span>
          <span class="tab-count">{{ typeCounts[t.type] }}</span>
        </button>
      </div>
      <div class="asset-search">
        <Search :size="15" class="search-ico" />
        <input v-model="search" class="search-input" :placeholder="`在${activeLabel}中搜索`" />
      </div>
    </div>

    <!-- 工具栏：面包屑 + 操作 -->
    <header class="asset-toolbar">
      <nav class="crumbs">
        <template v-for="(c, i) in breadcrumbs" :key="c.path">
          <ChevronRight v-if="i > 0" :size="14" class="crumb-sep" />
          <button
            class="crumb"
            :class="{ current: c.path === currentPath, drop: dragOverPath === c.path && draggingAssetId }"
            @click="goCrumb(c.path)"
            @dragover.prevent="onDropTarget(c.path)"
            @dragleave="dragOverPath = null"
            @drop.prevent="dropToFolder(c.path)"
          >
            <FolderOpen v-if="i === 0" :size="14" />
            {{ c.label }}
          </button>
        </template>
      </nav>
      <div class="toolbar-right">
        <div class="view-switch">
          <button class="view-btn" :class="{ active: viewMode === 'grid' }" title="网格" @click="viewMode = 'grid'">
            <LayoutGrid :size="15" />
          </button>
          <button class="view-btn" :class="{ active: viewMode === 'list' }" title="列表" @click="viewMode = 'list'">
            <ListIcon :size="15" />
          </button>
        </div>
        <a-button @click="openCreateFolder">
          <template #icon><FolderPlus :size="15" /></template>
          新建文件夹
        </a-button>
        <a-button v-if="activeType === 'document'" :loading="syncing" @click="syncGeneratedAssets">
          <template #icon><RefreshCw :size="15" /></template>
          同步项目资产
        </a-button>
        <a-button type="primary" :loading="importing" @click="importAssets">
          <template #icon><Upload :size="15" /></template>
          导入{{ activeLabel }}
        </a-button>
      </div>
    </header>

    <div class="asset-body">
      <section class="asset-main">
        <div class="asset-scroll">
          <a-spin :spinning="loading">
            <!-- 文件夹区 -->
            <div v-if="currentFolders.length" class="folder-grid">
              <div
                v-for="f in currentFolders"
                :key="f.path"
                class="folder-card"
                :class="{ drop: dragOverPath === f.path && draggingAssetId }"
                @dblclick="enterFolder(f.path)"
                @dragover.prevent="onDropTarget(f.path)"
                @dragleave="dragOverPath = null"
                @drop.prevent="dropToFolder(f.path)"
              >
                <button class="folder-open" @click="enterFolder(f.path)">
                  <Folder :size="20" />
                  <div class="folder-info">
                    <span class="folder-name" :title="f.name">{{ f.name }}</span>
                    <span class="folder-count">{{ f.count }} 项</span>
                  </div>
                </button>
                <div class="folder-ops">
                  <button title="重命名" @click.stop="openRenameFolder(f.path)"><Pencil :size="13" /></button>
                  <button title="删除" @click.stop="confirmRemoveFolder(f.path)"><Trash2 :size="13" /></button>
                </div>
              </div>
            </div>

            <div v-if="currentFolders.length && currentAssets.length" class="section-split">
              <span>{{ search.trim() ? '搜索结果' : '当前文件夹资产' }}</span>
            </div>

            <!-- 资产为空 -->
            <div v-if="!currentFolders.length && !currentAssets.length" class="asset-empty">
              <div class="empty-icon"><component :is="activeTab.icon" :size="30" /></div>
              <h3>{{ search.trim() ? '没有匹配的资产' : `这里还没有${activeLabel}` }}</h3>
              <p>
                可点击右上角「导入{{ activeLabel }}」添加素材<template v-if="activeType === 'document'">，或「同步项目资产」纳入剧本内容</template>；也可新建文件夹分类管理。
              </p>
            </div>

            <!-- 资产网格 -->
            <div v-else-if="viewMode === 'grid'" class="asset-grid">
              <div
                v-for="a in currentAssets"
                :key="a.id"
                class="grid-item"
                :class="{ active: detail && detail.id === a.id, dragging: draggingAssetId === a.id }"
                draggable="true"
                @click="selectAsset(a.id)"
                @dragstart="onAssetDragStart(a.id, $event)"
                @dragend="onAssetDragEnd"
              >
                <div class="grid-thumb">
                  <img v-if="thumbFor(a)" :src="thumbFor(a)" :alt="a.name" />
                  <component v-else :is="typeIcon(a.type)" :size="26" />
                </div>
                <div class="grid-name" :title="a.name">{{ a.name }}</div>
                <div v-if="search.trim()" class="grid-path" :title="a.folder">
                  <Folder :size="11" /> {{ normFolder(a.folder) || '根目录' }}
                </div>
              </div>
            </div>

            <!-- 资产列表 -->
            <div v-else class="asset-list">
              <div
                v-for="a in currentAssets"
                :key="a.id"
                class="list-item"
                :class="{ active: detail && detail.id === a.id, dragging: draggingAssetId === a.id }"
                draggable="true"
                @click="selectAsset(a.id)"
                @dragstart="onAssetDragStart(a.id, $event)"
                @dragend="onAssetDragEnd"
              >
                <div class="list-thumb">
                  <img v-if="thumbFor(a)" :src="thumbFor(a)" :alt="a.name" />
                  <component v-else :is="typeIcon(a.type)" :size="18" />
                </div>
                <div class="list-info">
                  <div class="list-name">{{ a.name }}</div>
                  <div class="list-meta">
                    <Folder :size="12" />
                    <span>{{ normFolder(a.folder) || '根目录' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </a-spin>
        </div>
      </section>

      <!-- 右：资产详情 -->
      <aside v-if="detail" class="asset-detail">
        <div class="detail-preview">
          <img v-if="detail.type === 'image'" :src="previewUrl" :alt="detail.name" class="preview-img" />
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
          <a-form-item label="所在文件夹">
            <a-tree-select
              v-model:value="form.folder"
              :tree-data="folderTree"
              tree-default-expand-all
              placeholder="选择文件夹"
              @change="markDirty"
            />
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
          <div class="info-row"><span>来源</span><b>{{ sourceLabel(detail.source) }}</b></div>
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

    <!-- 新建 / 重命名文件夹 -->
    <a-modal
      v-model:open="folderDialog.visible"
      :title="folderDialog.mode === 'create' ? '新建文件夹' : '重命名文件夹'"
      :ok-text="folderDialog.mode === 'create' ? '新建' : '保存'"
      cancel-text="取消"
      centered
      width="420px"
      @ok="submitFolderDialog"
    >
      <div class="folder-dialog">
        <p class="folder-dialog-tip">
          <FolderOpen :size="14" />
          位置：{{ folderDialog.mode === 'create'
            ? (folderDialog.path ? folderDialog.path : activeLabel + ' / 根目录')
            : (parentOf(folderDialog.path) || activeLabel + ' / 根目录') }}
        </p>
        <a-input
          v-model:value="folderDialog.name"
          placeholder="请输入文件夹名称"
          :maxlength="40"
          @press-enter="submitFolderDialog"
        />
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.asset-library {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-app);
}

/* 顶部 Tab */
.asset-tabs {
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.tab-group {
  display: flex;
  gap: 4px;
}
.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 16px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
.tab-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.tab-item.active {
  background: var(--bg-active);
  color: var(--brand-color);
  border-color: var(--brand-color);
  font-weight: 600;
}
.tab-count {
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--bg-sunken);
  color: var(--text-tertiary);
  font-size: 11px;
}
.tab-item.active .tab-count {
  background: var(--brand-soft);
  color: var(--brand-color);
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
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  color: var(--text-primary);
  font-size: 13px;
}

/* 工具栏 */
.asset-toolbar {
  flex-shrink: 0;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  min-width: 0;
}
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.crumb:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.crumb.current {
  color: var(--text-primary);
  font-weight: 600;
}
.crumb.drop {
  border-color: var(--brand-color);
  background: var(--brand-soft);
  color: var(--brand-color);
}
.crumb-sep {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
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
  transition: background 0.14s ease, color 0.14s ease;
}
.view-btn.active {
  background: var(--bg-panel);
  color: var(--brand-color);
  box-shadow: var(--shadow-sm);
}

/* 主体 */
.asset-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.asset-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.asset-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 18px;
}

/* 文件夹网格 */
.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.folder-card {
  position: relative;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}
.folder-card:hover {
  border-color: var(--brand-color);
  box-shadow: var(--shadow-card);
}
.folder-card.drop {
  border-color: var(--brand-color);
  background: var(--brand-soft);
  box-shadow: 0 0 0 2px var(--brand-soft);
}
.folder-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px;
  border: none;
  background: transparent;
  color: var(--brand-color);
  cursor: pointer;
  text-align: left;
}
.folder-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.folder-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-count {
  font-size: 12px;
  color: var(--text-tertiary);
}
.folder-ops {
  display: flex;
  gap: 2px;
  padding-right: 8px;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.folder-card:hover .folder-ops {
  opacity: 1;
}
.folder-ops button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.folder-ops button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.folder-ops button:last-child:hover {
  color: #ff4d4f;
}

.section-split {
  display: flex;
  align-items: center;
  margin: 4px 0 14px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.section-split span {
  padding-right: 12px;
}
.section-split::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-color);
}

/* 资产空态 */
.asset-empty {
  margin: 56px auto;
  text-align: center;
  color: var(--text-secondary);
  max-width: 440px;
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
  line-height: 1.6;
}

/* 资产网格 */
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
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
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
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
.grid-item.dragging {
  opacity: 0.5;
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
.grid-path {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 资产列表 */
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
  transition: border-color 0.14s ease, background 0.14s ease;
}
.list-item:hover {
  border-color: var(--brand-color);
}
.list-item.active {
  border-color: var(--brand-color);
  background: var(--bg-active);
}
.list-item.dragging {
  opacity: 0.5;
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
  width: 320px;
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
  max-width: 190px;
}
.detail-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.detail-actions .ant-btn {
  flex: 1;
}

/* 文件夹弹窗 */
.folder-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.folder-dialog-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
