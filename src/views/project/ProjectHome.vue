<script setup>
// 工程页：Vue Flow 画布工作台
// 中键拖动画布、左键框选、右键菜单；四边卡尺 + 小地图 + 缩放率。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Handle, MarkerType, Position, VueFlow, getBezierPath } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import {
  BookOpen,
  Clapperboard,
  FileText,
  FolderKanban,
  GitBranchPlus,
  GripVertical,
  Image,
  LoaderCircle,
  LocateFixed,
  MousePointer2,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  UserRound,
  Video,
  ZoomIn,
} from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../../store/appState.js'
import { useFlowCanvasStore } from '../../store/flowCanvas.js'
import { useUsageStore } from '../../store/usage.js'
import { api } from '../../services/bridge.js'
import { generateStoryboardShots } from '../../services/ai.js'
import { assetUrl } from '../../utils/asset.js'

const appStore = useAppStore()
const flowStore = useFlowCanvasStore()
const usageStore = useUsageStore()
const router = useRouter()
const project = computed(() => appStore.currentProject || {})

const flowId = 'project-workbench-flow'
const flowWrap = ref(null)
const flowInstance = ref(null)

const viewport = reactive({ x: 0, y: 0, zoom: 1 })
const canvasSize = reactive({ width: 1000, height: 700 })
const saving = ref(false)
const hydrating = ref(false)
const normalizedSnapshot = ref('')
const draggingShot = ref(null)
const brokenCovers = reactive(new Set())
const scriptDrafts = reactive({})
const storyboardLoading = reactive({})

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  flowX: 0,
  flowY: 0,
  target: 'pane',
  nodeId: '',
})

const scriptDialog = reactive({
  visible: false,
  loading: false,
  scripts: [],
  scriptId: '',
  episodes: [],
  episodeNo: null,
  flowX: 0,
  flowY: 0,
})

const roleDialog = reactive({
  visible: false,
  loading: false,
  roles: [],
  roleId: '',
  flowX: 0,
  flowY: 0,
})

const imageDialog = reactive({
  visible: false,
  loading: false,
  importing: false,
  activeTab: 'upload',
  assets: [],
  assetId: '',
  flowX: 0,
  flowY: 0,
})

const boxSelect = reactive({
  active: false,
  additive: false,
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
})

const markerEnd = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: 'rgba(154, 165, 179, 0.9)',
}

const nodes = ref([])
const edges = ref([])

const selectedNodes = computed(() => nodes.value.filter((n) => n.selected))
const selectedCount = computed(() => selectedNodes.value.length)
const zoomPercent = computed(() => `${Math.round(viewport.zoom * 100)}%`)
const dirty = computed(() => flowStore.projectPath === project.value?.path && flowStore.dirty)
// 画布卡片可跳转到对应资源库进行编辑
const NODE_EDIT_TARGETS = {
  'role-card': { label: '角色', path: '/project/roles', buildQuery: (d) => ({ roleId: d.roleId }) },
  'image-card': { label: '图片', path: '/project/assets', buildQuery: (d) => ({ assetId: d.assetId }) },
  'script-work': {
    label: '剧情',
    path: '/project/scripts',
    buildQuery: (d) => ({ scriptId: d.scriptId, episodeNo: d.episodeNo }),
  },
}
const contextNode = computed(() => nodes.value.find((n) => n.id === contextMenu.nodeId) || null)
const contextEditTarget = computed(() => NODE_EDIT_TARGETS[contextNode.value?.type] || null)
const canEditContextNode = computed(() => !!contextEditTarget.value)
const contextIsGroup = computed(() => contextNode.value?.type === 'group')
const currentScript = computed(() => scriptDialog.scripts[0] || null)
const scriptPortTop = computed(() => scriptCardHeight() - 18 - 52)
const scriptRoleHandleTop = computed(() => `${scriptPortTop.value + 11}px`)
const scriptImageHandleTop = computed(() => `${scriptPortTop.value + 41}px`)
const scriptLayoutHandleTop = computed(() => `${scriptPortTop.value + 41}px`)
const episodeOptions = computed(() =>
  scriptDialog.episodes.map((e) => ({
    label: `第${e.episodeNo}集：${e.title || '未命名剧情'}`,
    value: e.episodeNo,
  })),
)
const selectedEpisode = computed(() =>
  scriptDialog.episodes.find((e) => String(e.episodeNo) === String(scriptDialog.episodeNo)),
)

const horizontalTicks = computed(() => {
  const count = Math.ceil(canvasSize.width / 80) + 1
  return Array.from({ length: count }, (_, i) => {
    const x = i * 80
    const world = Math.round((x - viewport.x) / viewport.zoom)
    return { x, major: i % 2 === 0, label: world }
  })
})

const verticalTicks = computed(() => {
  const count = Math.ceil(canvasSize.height / 80) + 1
  return Array.from({ length: count }, (_, i) => {
    const y = i * 80
    const world = Math.round((y - viewport.y) / viewport.zoom)
    return { y, major: i % 2 === 0, label: world }
  })
})

function makeEdge(id, source, target, extra = {}) {
  return {
    id,
    type: 'flowing',
    source,
    target,
    markerEnd,
    style: { strokeWidth: 1.7 },
    ...extra,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeNode(node) {
  const out = {
    id: node.id,
    type: node.type,
    label: node.label,
    position: node.position,
    class: node.class,
    data: node.data || {},
  }
  if (node.parentNode) out.parentNode = node.parentNode
  if (node.style) out.style = node.style
  return out
}

function normalizeEdge(edge) {
  return {
    id: edge.id,
    type: edge.type || 'flowing',
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    markerEnd: edge.markerEnd || markerEnd,
    style: edge.style || { strokeWidth: 1.7 },
  }
}

function currentCanvas() {
  return {
    nodes: nodes.value.map(normalizeNode),
    edges: edges.value.map(normalizeEdge),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  }
}

function canvasSignature(canvas = currentCanvas()) {
  return JSON.stringify(canvas)
}

function hydrateCanvas(canvas) {
  hydrating.value = true
  nodes.value = clone(canvas?.nodes || [])
  edges.value = clone(canvas?.edges || []).map((edge) => ({
    ...edge,
    type: edge.type || 'flowing',
    markerEnd: edge.markerEnd || markerEnd,
    style: edge.style || { strokeWidth: 1.7 },
  }))
  const nextViewport = canvas?.viewport || { x: 0, y: 0, zoom: 1 }
  viewport.x = nextViewport.x || 0
  viewport.y = nextViewport.y || 0
  viewport.zoom = nextViewport.zoom || 1
  normalizedSnapshot.value = canvasSignature()
  nextTick(() => {
    hydrating.value = false
    if (flowInstance.value) {
      flowInstance.value.setViewport?.(viewport, { duration: 0 })
    }
  })
}

function defaultCanvas() {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

// 静默提交节点更新：用于从资源库刷新缓存字段，不触发画布"未保存"状态
async function commitNodesSilently(nextNodes) {
  const projectPath = project.value?.path
  hydrating.value = true
  nodes.value = nextNodes
  await nextTick()
  hydrating.value = false
  normalizedSnapshot.value = canvasSignature()
  if (projectPath) flowStore.syncDraft(projectPath, currentCanvas())
}

// 从角色库刷新画布上角色卡的数据，保证与角色库一致（不误标记为未保存）
async function refreshRoleCards() {
  const projectPath = project.value?.path
  if (!projectPath) return
  const roleIds = [
    ...new Set(
      nodes.value.filter((n) => n.type === 'role-card' && n.data?.roleId).map((n) => n.data.roleId),
    ),
  ]
  if (!roleIds.length) return
  const entries = await Promise.all(
    roleIds.map(async (id) => {
      try {
        return [id, await api.roles.read({ projectPath, roleId: id })]
      } catch {
        return [id, null]
      }
    }),
  )
  const roleMap = new Map(entries)
  let changed = false
  const nextNodes = nodes.value.map((node) => {
    if (node.type !== 'role-card' || !node.data?.roleId) return node
    const role = roleMap.get(node.data.roleId)
    if (!role) {
      if (node.data.missing) return node
      changed = true
      return { ...node, data: { ...node.data, missing: true } }
    }
    const cover = roleCover(role)
    if (cover !== node.data.cover) brokenCovers.delete(node.id)
    const nextData = {
      ...node.data,
      missing: false,
      title: role.name || '未命名角色',
      roleType: role.roleType || '角色',
      gender: role.gender || '',
      age: role.age || '',
      identity: role.identity || '',
      personality: role.personality || '',
      motivation: role.motivation || '',
      appearance: role.appearance || '',
      voice: role.voice || '',
      cover,
      desc: role.identity || role.personality || role.appearance || '已绑定角色库角色。',
    }
    if (JSON.stringify(nextData) === JSON.stringify(node.data)) return node
    changed = true
    return { ...node, data: nextData }
  })
  if (!changed) return
  await commitNodesSilently(nextNodes)
}

// 从剧本库刷新画布上剧情卡的内容，保证与剧本库一致（含已删除态）
async function refreshScriptNodes() {
  const projectPath = project.value?.path
  if (!projectPath) return
  const scriptNodes = nodes.value.filter((n) => n.type === 'script-work' && n.data?.scriptId)
  if (!scriptNodes.length) return
  const scriptIds = [...new Set(scriptNodes.map((n) => n.data.scriptId))]
  const entries = await Promise.all(
    scriptIds.map(async (sid) => {
      try {
        return [sid, await api.scripts.read({ projectPath, scriptId: sid })]
      } catch {
        return [sid, null]
      }
    }),
  )
  const scriptMap = new Map(entries)
  let changed = false
  const nextNodes = nodes.value.map((node) => {
    if (node.type !== 'script-work' || !node.data?.scriptId) return node
    const doc = scriptMap.get(node.data.scriptId)
    const ep = doc ? (doc.episodes || []).find((e) => e.episodeNo === node.data.episodeNo) : null
    if (!doc || !ep) {
      if (node.data.missing) return node
      changed = true
      return { ...node, data: { ...node.data, missing: true } }
    }
    const content = ep.content || ''
    const nextData = {
      ...node.data,
      missing: false,
      scriptTitle: doc.meta?.title || node.data.scriptTitle,
      episodeTitle: ep.title || node.data.episodeTitle,
      content,
      summary: extractEpisodeSummary(content),
      preview: buildScriptPreview(content),
      duration: extractEpisodeField(content, '时长'),
      sceneCount: countScenes(content),
    }
    if (JSON.stringify(nextData) === JSON.stringify(node.data)) return node
    changed = true
    return { ...node, data: nextData }
  })
  if (!changed) return
  await commitNodesSilently(nextNodes)
}

async function initializeCanvas() {
  const projectPath = project.value?.path
  if (!projectPath) return
  if (flowStore.hasProject(projectPath)) {
    hydrateCanvas(flowStore)
  } else {
    const saved = await flowStore.load(projectPath)
    hydrateCanvas(saved || defaultCanvas())
  }
  await nextTick()
  await refreshRoleCards()
  await refreshScriptNodes()
}

function syncCanvasDraft() {
  const projectPath = project.value?.path
  if (!projectPath || hydrating.value) return
  const canvas = currentCanvas()
  flowStore.syncDraft(projectPath, canvas)
  const nextSignature = canvasSignature(canvas)
  if (nextSignature !== normalizedSnapshot.value) {
    flowStore.markDirty()
  }
}

async function saveCanvas() {
  const projectPath = project.value?.path
  if (!projectPath) return
  saving.value = true
  try {
    const canvas = currentCanvas()
    await flowStore.save(projectPath, canvas)
    normalizedSnapshot.value = canvasSignature(canvas)
    message.success('幕布已保存')
  } catch (err) {
    message.error('保存幕布失败：' + err.message)
  } finally {
    saving.value = false
  }
}

function onPaneReady(instance) {
  flowInstance.value = instance
  instance.fitView?.({ padding: 0.25, duration: 200 })
}

function onViewportChange(next) {
  viewport.x = next.x || 0
  viewport.y = next.y || 0
  viewport.zoom = next.zoom || 1
}

function getCanvasPoint(event) {
  const rect = flowWrap.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0, flowX: 0, flowY: 0 }
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  return {
    x,
    y,
    flowX: (x - viewport.x) / viewport.zoom,
    flowY: (y - viewport.y) / viewport.zoom,
  }
}

function openPaneMenu(event) {
  event.preventDefault()
  const point = getCanvasPoint(event)
  Object.assign(contextMenu, {
    visible: true,
    x: point.x,
    y: point.y,
    flowX: point.flowX,
    flowY: point.flowY,
    target: 'pane',
    nodeId: '',
  })
}

function openNodeMenu(payload) {
  const event = payload.event || payload
  event.preventDefault()
  const point = getCanvasPoint(event)
  const nodeId = payload.node?.id || ''
  const nodeIsAlreadySelected = nodes.value.some((node) => node.id === nodeId && node.selected)
  if (nodeId && !nodeIsAlreadySelected) {
    nodes.value = nodes.value.map((node) => ({ ...node, selected: node.id === nodeId }))
  }
  Object.assign(contextMenu, {
    visible: true,
    x: point.x,
    y: point.y,
    flowX: point.flowX,
    flowY: point.flowY,
    target: 'node',
    nodeId,
  })
}

function closeMenu() {
  contextMenu.visible = false
}

function beginBoxSelect(event) {
  if (event.button !== 0) return
  if (event.target.closest?.('.vue-flow__node, .context-menu, .ruler, .zoom-badge, .ant-modal-root')) return
  const rect = flowWrap.value?.getBoundingClientRect()
  if (!rect) return
  event.preventDefault()
  event.stopPropagation()
  closeMenu()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  Object.assign(boxSelect, { active: true, additive: event.shiftKey, startX: x, startY: y, x, y, width: 0, height: 0 })
  window.addEventListener('mousemove', updateBoxSelect)
  window.addEventListener('mouseup', finishBoxSelect, { once: true })
}

function updateBoxSelect(event) {
  if (!boxSelect.active) return
  const rect = flowWrap.value?.getBoundingClientRect()
  if (!rect) return
  const x2 = event.clientX - rect.left
  const y2 = event.clientY - rect.top
  boxSelect.x = Math.min(boxSelect.startX, x2)
  boxSelect.y = Math.min(boxSelect.startY, y2)
  boxSelect.width = Math.abs(x2 - boxSelect.startX)
  boxSelect.height = Math.abs(y2 - boxSelect.startY)
}

function finishBoxSelect() {
  window.removeEventListener('mousemove', updateBoxSelect)
  if (!boxSelect.active) return
  const selection = {
    left: boxSelect.x,
    top: boxSelect.y,
    right: boxSelect.x + boxSelect.width,
    bottom: boxSelect.y + boxSelect.height,
  }
  const hasArea = boxSelect.width > 3 && boxSelect.height > 3
  const additive = boxSelect.additive
  nodes.value = nodes.value.map((node) => {
    if (node.type === 'group') return additive ? node : { ...node, selected: false }
    const bounds = getNodeBounds(node)
    const inRange =
      hasArea &&
      bounds.right >= selection.left &&
      bounds.left <= selection.right &&
      bounds.bottom >= selection.top &&
      bounds.top <= selection.bottom
    const selected = additive ? node.selected || inRange : inRange
    return { ...node, selected }
  })
  if (hasArea && !additive) {
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
  }
  boxSelect.active = false
  boxSelect.additive = false
  // 框选结束后浏览器会在画布上合成一次 click，Vue Flow 的 pane onClick 会清空选择，
  // 这里在捕获阶段吞掉这一次 click，避免刚框选中的卡片被立即取消选中
  if (hasArea) suppressNextPaneClick()
}

function suppressNextPaneClick() {
  const swallow = (event) => event.stopPropagation()
  window.addEventListener('click', swallow, true)
  setTimeout(() => window.removeEventListener('click', swallow, true), 0)
}

function absolutePosition(node) {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentNode
  const seen = new Set()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = nodes.value.find((n) => n.id === parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}

function nodeSize(node) {
  const fallback = getNodeFallbackSize(node)
  return {
    width: node.dimensions?.width || fallback.width,
    height: node.dimensions?.height || fallback.height,
  }
}

function getNodeBounds(node) {
  const abs = absolutePosition(node)
  const size = nodeSize(node)
  const nodeLeft = abs.x * viewport.zoom + viewport.x
  const nodeTop = abs.y * viewport.zoom + viewport.y
  const nodeWidth = size.width * viewport.zoom
  const nodeHeight = size.height * viewport.zoom
  return {
    left: nodeLeft,
    top: nodeTop,
    right: nodeLeft + nodeWidth,
    bottom: nodeTop + nodeHeight,
  }
}

function getNodeFallbackSize(node) {
  if (node.type === 'script-work') return { width: 360, height: scriptCardHeight() }
  if (node.type === 'role-card') return { width: 280, height: 224 }
  if (node.type === 'image-card') return { width: 280, height: 214 }
  if (node.type === 'storyboard-layout') return { width: 320, height: storyboardLayoutHeight(node.id, node.data) }
  if (node.type === 'shot-node') return { width: 280, height: 240 }
  if (node.type === 'master-output-node') return { width: 280, height: 140 }
  return { width: 170, height: 64 }
}

function nodePosition(width = 280, x = contextMenu.flowX, y = contextMenu.flowY) {
  return {
    x: x - width / 2,
    y: y - 24,
  }
}

function addNode(node) {
  nodes.value.push(node)
  closeMenu()
}

function updateNodeTitle(nodeId, title) {
  nodes.value = nodes.value.map((node) => {
    if (node.id !== nodeId) return node
    return { ...node, data: { ...node.data, title } }
  })
}

function previewUrl(relFile) {
  return assetUrl(project.value?.path, relFile)
}

function markCoverBroken(id) {
  brokenCovers.add(id)
}

function roleCover(role) {
  return role?.cover || role?.images?.[0] || ''
}

function roleTags(data) {
  return [data.gender, data.age].filter(Boolean)
}

function scriptTitle(data) {
  return data.title || `第${data.episodeNo}集：${data.episodeTitle}`
}

function imageAssetThumb(asset) {
  if (!asset || asset.type !== 'image') return ''
  return asset.thumbnail || asset.file || ''
}

function isImagePath(filePath) {
  return /\.(png|jpe?g|webp|gif)$/i.test(String(filePath || ''))
}

async function loadRoleChoices() {
  if (!project.value?.path) return
  roleDialog.loading = true
  try {
    roleDialog.roles = await api.roles.list(project.value.path)
    roleDialog.roleId = roleDialog.roles[0]?.id || ''
  } catch (err) {
    message.error('加载角色失败：' + err.message)
  } finally {
    roleDialog.loading = false
  }
}

async function addRoleCard() {
  closeMenu()
  Object.assign(roleDialog, {
    visible: true,
    flowX: contextMenu.flowX,
    flowY: contextMenu.flowY,
  })
  await loadRoleChoices()
  if (!roleDialog.roles.length) message.warning('当前工程还没有角色，请先在角色库创建角色')
}

async function confirmRoleCard() {
  if (!roleDialog.roleId) return message.warning('请选择一个角色')
  roleDialog.loading = true
  try {
    const role = await api.roles.read({ projectPath: project.value.path, roleId: roleDialog.roleId })
    const cover = roleCover(role)
    addNode({
      id: `role_card_${Date.now()}`,
      type: 'role-card',
      position: nodePosition(280, roleDialog.flowX, roleDialog.flowY),
      class: 'role-card-node',
      data: {
        title: role.name || '未命名角色',
        roleId: role.id,
        roleType: role.roleType || '角色',
        gender: role.gender || '',
        age: role.age || '',
        identity: role.identity || '',
        personality: role.personality || '',
        appearance: role.appearance || '',
        voice: role.voice || '',
        cover,
        desc: role.identity || role.personality || role.appearance || '已绑定角色库角色。',
      },
    })
    roleDialog.visible = false
  } catch (err) {
    message.error('读取角色失败：' + err.message)
  } finally {
    roleDialog.loading = false
  }
}

async function loadImageAssets() {
  if (!project.value?.path) return
  imageDialog.loading = true
  try {
    imageDialog.assets = (await api.assets.list(project.value.path)).filter((asset) => asset.type === 'image')
    imageDialog.assetId = imageDialog.assets[0]?.id || ''
  } catch (err) {
    message.error('加载资产失败：' + err.message)
  } finally {
    imageDialog.loading = false
  }
}

async function addImageCard() {
  closeMenu()
  Object.assign(imageDialog, {
    visible: true,
    activeTab: 'upload',
    flowX: contextMenu.flowX,
    flowY: contextMenu.flowY,
  })
  await loadImageAssets()
}

function createImageNode(asset) {
  addNode({
    id: `image_card_${Date.now()}_${asset.id}`,
    type: 'image-card',
    position: nodePosition(280, imageDialog.flowX, imageDialog.flowY),
    class: 'image-card-node',
    data: {
      title: asset.name || '参考图片',
      assetId: asset.id,
      file: asset.file || '',
      thumbnail: imageAssetThumb(asset),
      folder: asset.folder || '未归档',
      desc: asset.description || asset.usage || '已绑定资产库图片。',
      usage: asset.usage || '图片参考',
    },
  })
  imageDialog.visible = false
}

async function importImageForCard() {
  if (!project.value?.path) return
  try {
    const filePaths = await api.dialog.selectAssetFiles()
    if (!filePaths?.length) return
    const imagePaths = filePaths.filter(isImagePath)
    if (!imagePaths.length) return message.warning('请选择图片文件')
    imageDialog.importing = true
    const created = (await api.assets.import({ projectPath: project.value.path, filePaths: imagePaths })).filter(
      (asset) => asset.type === 'image',
    )
    await loadImageAssets()
    if (!created.length) return message.warning('未选择到图片文件')
    createImageNode(created[0])
    message.success(`已导入 ${created.length} 张图片`)
  } catch (err) {
    message.error('导入图片失败：' + err.message)
  } finally {
    imageDialog.importing = false
  }
}

async function confirmImageCard() {
  if (!imageDialog.assetId) return message.warning('请选择一张图片')
  imageDialog.loading = true
  try {
    const asset = await api.assets.read({ projectPath: project.value.path, assetId: imageDialog.assetId })
    createImageNode(asset)
  } catch (err) {
    message.error('读取资产失败：' + err.message)
  } finally {
    imageDialog.loading = false
  }
}

function addStoryboardLayout() {
  const index = nodes.value.filter((n) => n.type === 'storyboard-layout').length + 1
  addNode({
    id: `storyboard_layout_${Date.now()}`,
    type: 'storyboard-layout',
    position: nodePosition(320),
    class: 'storyboard-layout-node',
    data: {
      title: `分镜排布 ${index}`,
      desc: '绑定一段剧情，接入多个分镜并调整顺序。',
      shotOrder: [],
    },
  })
}

function addShotNode() {
  const index = nodes.value.filter((n) => n.type === 'shot-node').length + 1
  addNode({
    id: `shot_node_${Date.now()}`,
    type: 'shot-node',
    position: nodePosition(280),
    class: 'shot-node',
    data: {
      title: `分镜 ${index}`,
      shotNo: index,
      duration: 0,
      prompt: '',
      description: '单个分镜镜头，可接入分镜总览。',
      image: '',
    },
  })
}

function addMasterOutputNode() {
  const index = nodes.value.filter((n) => n.type === 'master-output-node').length + 1
  addNode({
    id: `master_output_${Date.now()}`,
    type: 'master-output-node',
    position: nodePosition(280),
    class: 'master-output-node',
    data: {
      title: index === 1 ? '总镜头输出' : `总镜头输出 ${index}`,
      desc: '接收分镜排布的最终总镜头结构。',
    },
  })
}

async function loadScriptChoices() {
  if (!project.value?.path) return
  scriptDialog.loading = true
  try {
    scriptDialog.scripts = await api.scripts.list(project.value.path)
    scriptDialog.scriptId = scriptDialog.scripts[0]?.id || ''
    if (scriptDialog.scriptId) await loadDialogEpisodes()
  } catch (err) {
    message.error('加载剧本失败：' + err.message)
  } finally {
    scriptDialog.loading = false
  }
}

async function loadDialogEpisodes() {
  scriptDialog.episodes = []
  scriptDialog.episodeNo = null
  if (!project.value?.path || !scriptDialog.scriptId) return
  scriptDialog.loading = true
  try {
    const data = await api.scripts.read({ projectPath: project.value.path, scriptId: scriptDialog.scriptId })
    scriptDialog.episodes = data.episodes || []
    scriptDialog.episodeNo = scriptDialog.episodes[0]?.episodeNo ?? null
  } catch (err) {
    message.error('读取剧集失败：' + err.message)
  } finally {
    scriptDialog.loading = false
  }
}

async function openScriptNodeDialog() {
  closeMenu()
  Object.assign(scriptDialog, {
    visible: true,
    flowX: contextMenu.flowX,
    flowY: contextMenu.flowY,
  })
  await loadScriptChoices()
  if (!scriptDialog.scripts.length) {
    message.warning('当前工程还没有剧本，请先在剧本库创建或导入剧本')
  }
}

function confirmScriptNode() {
  if (!scriptDialog.scriptId) return message.warning('当前工程还没有剧本，请先在剧本库创建或导入剧本')
  if (!selectedEpisode.value) return message.warning('请选择剧集剧情')

  const script = currentScript.value
  const ep = selectedEpisode.value
  const id = `script_node_${Date.now()}`
  nodes.value.push({
    id,
    type: 'script-work',
    label: `第${ep.episodeNo}集`,
    position: nodePosition(360, scriptDialog.flowX, scriptDialog.flowY),
    class: 'script-work-node',
    data: {
      title: `第${ep.episodeNo}集：${ep.title || '未命名剧情'}`,
      scriptId: scriptDialog.scriptId,
      scriptTitle: script?.title || '未命名剧本',
      episodeNo: ep.episodeNo,
      episodeTitle: ep.title || '未命名剧情',
      content: ep.content || '',
      summary: extractEpisodeSummary(ep.content),
      preview: buildScriptPreview(ep.content),
      duration: extractEpisodeField(ep.content, '时长'),
      sceneCount: countScenes(ep.content),
    },
  })
  scriptDialog.visible = false
  message.success('剧情已添加')
}

function extractEpisodeField(content, label) {
  const text = String(content || '')
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = text.match(new RegExp(`^[-*]\\s*${escaped}\\s*[：:]\\s*(.+)$`, 'm'))
  return m?.[1]?.trim() || ''
}

function extractEpisodeSummary(content) {
  const direct = extractEpisodeField(content, '本集梗概')
  if (direct) return direct
  const text = buildScriptPreview(content)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return text.find((line) => !/^第.+集/.test(line)) || '已绑定所选剧集剧情。'
}

function buildScriptPreview(content) {
  return String(content || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\*\*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join('\n')
}

function countScenes(content) {
  const matches = String(content || '').match(/^###\s*场景/gm)
  return matches?.length || 0
}

function scriptDraftContent(id, data) {
  return id in scriptDrafts ? scriptDrafts[id] : data.content || ''
}

function setScriptDraft(id, value) {
  scriptDrafts[id] = value
}

function scriptDirty(id, data) {
  return id in scriptDrafts && scriptDrafts[id] !== (data.content || '')
}

function updateScriptNodeData(id, content) {
  nodes.value = nodes.value.map((node) => {
    if (node.id !== id) return node
    return {
      ...node,
      data: {
        ...node.data,
        content,
        summary: extractEpisodeSummary(content),
        preview: buildScriptPreview(content),
        duration: extractEpisodeField(content, '时长'),
        sceneCount: countScenes(content),
      },
    }
  })
}

// 画布内直接编辑剧情，保存后写回剧本库对应剧集
async function saveScriptNode(id, data) {
  const projectPath = project.value?.path
  if (!projectPath || !data.scriptId) return
  const content = scriptDrafts[id]
  if (content == null) return
  try {
    const doc = await api.scripts.read({ projectPath, scriptId: data.scriptId })
    const episodes = doc.episodes || []
    if (!episodes.some((e) => e.episodeNo === data.episodeNo)) {
      return message.warning('剧本库中未找到对应剧集，请右键进入剧本中心确认')
    }
    await api.scripts.save({
      projectPath,
      script: {
        id: doc.meta.id,
        title: doc.meta.title,
        sourceType: doc.meta.sourceType,
        status: doc.meta.status,
        episodeDurationSeconds: doc.meta.episodeDurationSeconds,
        complianceResult: doc.meta.complianceResult,
        riskLevel: doc.meta.riskLevel,
        createdAt: doc.meta.createdAt,
        overview: doc.overview,
        episodes: episodes.map((e) => ({
          episodeNo: e.episodeNo,
          title: e.title,
          content: e.episodeNo === data.episodeNo ? content : e.content,
        })),
      },
    })
    updateScriptNodeData(id, content)
    delete scriptDrafts[id]
    message.success('剧情已保存到剧本库')
  } catch (err) {
    message.error('保存剧情失败：' + err.message)
  }
}

function scriptCardHeight() {
  return 430
}

function storyboardLayoutHeight(layoutId, data) {
  const shotCount = layoutId ? layoutShotItems(layoutId, data).length : 0
  return Math.max(300, 214 + shotCount * 52)
}

function layoutShotItems(layoutId, data) {
  const connectedIds = layoutId
    ? edges.value
        .filter((edge) => edge.target === layoutId && edge.targetHandle === 'layout-shot-in')
        .map((edge) => edge.source)
    : []
  const uniqueIds = Array.from(new Set(connectedIds))
  const order = Array.isArray(data?.shotOrder) ? data.shotOrder : []
  const orderedIds = [...order.filter((id) => uniqueIds.includes(id)), ...uniqueIds.filter((id) => !order.includes(id))]
  return orderedIds
    .map((id, index) => {
      const node = nodes.value.find((n) => n.id === id)
      if (!node) return null
      return {
        id,
        title: node.data?.title || `分镜 ${index + 1}`,
        desc: node.data?.description || node.data?.desc || '',
        image: node.data?.image || '',
        duration: node.data?.duration || 0,
      }
    })
    .filter(Boolean)
}

function setLayoutShotOrder(layoutId, order) {
  nodes.value = nodes.value.map((node) => {
    if (node.id !== layoutId) return node
    return { ...node, data: { ...node.data, shotOrder: order } }
  })
}

function startShotDrag(layoutId, shotId) {
  draggingShot.value = { layoutId, shotId }
}

function dropShot(layoutId, targetShotId) {
  const drag = draggingShot.value
  draggingShot.value = null
  if (!drag || drag.layoutId !== layoutId || drag.shotId === targetShotId) return
  const layout = nodes.value.find((node) => node.id === layoutId)
  const items = layoutShotItems(layoutId, layout?.data)
  const order = items.map((item) => item.id)
  const from = order.indexOf(drag.shotId)
  const to = order.indexOf(targetShotId)
  if (from < 0 || to < 0) return
  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  setLayoutShotOrder(layoutId, next)
}

function updateShotPrompt(id, value) {
  nodes.value = nodes.value.map((node) =>
    node.id === id ? { ...node, data: { ...node.data, prompt: value } } : node,
  )
}

function generateShotVideo() {
  message.info('分镜视频生成能力开发中（已预留接口）')
}

// 一键生成分镜镜头：读取该分镜总览所连剧情 -> 调 AI 拆分 -> 生成分镜卡片并建立关联
async function generateStoryboard(layoutId) {
  const projectPath = project.value?.path
  if (!projectPath || storyboardLoading[layoutId]) return
  const scriptEdge = edges.value.find(
    (e) => e.target === layoutId && e.targetHandle === 'layout-script-in',
  )
  const scriptNode = scriptEdge ? nodes.value.find((n) => n.id === scriptEdge.source) : null
  if (!scriptNode) return message.warning('请先把一个「剧情」节点接入该分镜总览')
  const content = scriptNode.data?.content
  if (!content || !content.trim()) {
    return message.warning('该剧情还没有内容，请先在剧情卡或剧本库补充')
  }
  if (!(appStore.settings.models || []).length) {
    return message.warning('请先在设置页添加模型')
  }
  storyboardLoading[layoutId] = true
  try {
    const { shots, usage } = await generateStoryboardShots({
      episodeTitle: scriptNode.data.episodeTitle || scriptNode.data.title || '',
      episodeContent: content.slice(0, 16000),
      modelId: appStore.currentModelId,
    })
    usageStore.add(projectPath, usage)
    if (!shots.length) return message.warning('AI 未生成分镜，请重试')
    const layout = nodes.value.find((n) => n.id === layoutId)
    const baseX = (layout?.position?.x || 0) - 320
    const baseY = layout?.position?.y || 0
    const startNo = nodes.value.filter((n) => n.type === 'shot-node').length + 1
    const stamp = Date.now()
    const newNodes = []
    const newEdges = []
    const newIds = []
    shots.forEach((shot, i) => {
      const nodeId = `shot_node_${stamp}_${i}`
      newIds.push(nodeId)
      newNodes.push({
        id: nodeId,
        type: 'shot-node',
        position: { x: baseX, y: baseY + i * 200 },
        class: 'shot-node',
        data: {
          title: shot.title || `分镜 ${startNo + i}`,
          shotNo: startNo + i,
          duration: shot.duration || 0,
          prompt: shot.prompt || '',
          description: shot.description || '',
          image: '',
        },
      })
      newEdges.push(
        makeEdge(`edge_${nodeId}_shot-out_${layoutId}_layout-shot-in_${stamp}_${i}`, nodeId, layoutId, {
          sourceHandle: 'shot-out',
          targetHandle: 'layout-shot-in',
        }),
      )
    })
    nodes.value = [...nodes.value, ...newNodes]
    edges.value = [...edges.value, ...newEdges]
    const currentOrder = Array.isArray(layout?.data?.shotOrder) ? layout.data.shotOrder : []
    setLayoutShotOrder(layoutId, [...currentOrder, ...newIds])
    message.success(`已生成 ${shots.length} 个分镜镜头并接入分镜总览`)
  } catch (err) {
    message.error('生成分镜失败：' + err.message)
  } finally {
    storyboardLoading[layoutId] = false
  }
}

function addConnection(params) {
  const sourceNode = nodes.value.find((node) => node.id === params.source)
  const targetNode = nodes.value.find((node) => node.id === params.target)
  if (
    sourceNode?.type === 'script-work' &&
    params.sourceHandle === 'storyboard-layout' &&
    (targetNode?.type !== 'storyboard-layout' || params.targetHandle !== 'layout-script-in')
  ) {
    message.warning('分镜排布只能连接到分镜排布')
    return
  }
  if (
    sourceNode?.type === 'shot-node' &&
    (targetNode?.type !== 'storyboard-layout' || params.targetHandle !== 'layout-shot-in')
  ) {
    message.warning('分镜只能接入分镜排布')
    return
  }
  if (
    sourceNode?.type === 'storyboard-layout' &&
    params.sourceHandle === 'master-output' &&
    targetNode?.type !== 'master-output-node'
  ) {
    message.warning('总镜头输出只能连接到总镜头输出')
    return
  }
  const scriptLayoutUsed = edges.value.some(
    (edge) => edge.source === params.source && edge.sourceHandle === 'storyboard-layout',
  )
  if (params.sourceHandle === 'storyboard-layout' && scriptLayoutUsed) {
    message.warning('一个剧情只能绑定一个分镜排布')
    return
  }
  const duplicateShot = edges.value.some(
    (edge) =>
      edge.source === params.source &&
      edge.target === params.target &&
      edge.sourceHandle === params.sourceHandle &&
      edge.targetHandle === params.targetHandle,
  )
  if (params.targetHandle === 'layout-shot-in' && duplicateShot) {
    message.warning('该分镜已经接入当前排布')
    return
  }
  const totalOutputUsed = edges.value.some(
    (edge) => edge.source === params.source && edge.sourceHandle === params.sourceHandle,
  )
  if (params.sourceHandle === 'master-output' && totalOutputUsed) {
    message.warning('总镜头输出只能连接一个')
    return
  }

  const edgeId = `edge_${params.source}_${params.sourceHandle || 'out'}_${params.target}_${params.targetHandle || 'in'}_${Date.now()}`
  edges.value.push(
    makeEdge(edgeId, params.source, params.target, {
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
    }),
  )
  if (targetNode?.type === 'storyboard-layout' && params.targetHandle === 'layout-shot-in') {
    const current = Array.isArray(targetNode.data?.shotOrder) ? targetNode.data.shotOrder : []
    if (!current.includes(params.source)) {
      setLayoutShotOrder(targetNode.id, [...current, params.source])
    }
  }
}

function edgePath(props) {
  return getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })[0]
}

function selectEdge(payload) {
  const edgeId = payload.edge?.id
  if (!edgeId) return
  payload.event?.stopPropagation?.()
  closeMenu()
  nodes.value = nodes.value.map((node) => ({ ...node, selected: false }))
  edges.value = edges.value.map((edge) => ({ ...edge, selected: edge.id === edgeId }))
}

function deleteEdge(payload) {
  const edgeId = payload.edge?.id
  if (!edgeId) return
  payload.event?.preventDefault?.()
  payload.event?.stopPropagation?.()
  edges.value = edges.value.filter((edge) => edge.id !== edgeId)
  closeMenu()
  message.success('已删除连接')
}

function deleteContextNodes() {
  const selectedIds = selectedNodes.value.map((node) => node.id)
  const contextIsSelected = selectedIds.includes(contextMenu.nodeId)
  const ids = selectedIds.length && (!contextMenu.nodeId || contextIsSelected)
    ? selectedIds
    : [contextMenu.nodeId].filter(Boolean)
  if (!ids.length) return
  const idSet = new Set(ids)
  // 删除分组时，把其中的卡片释放为独立卡片（保留在画布上，还原为绝对坐标）
  const deletedGroupPos = {}
  nodes.value.forEach((n) => {
    if (idSet.has(n.id) && n.type === 'group') deletedGroupPos[n.id] = n.position
  })
  nodes.value = nodes.value
    .filter((node) => !idSet.has(node.id))
    .map((node) => {
      if (node.parentNode && deletedGroupPos[node.parentNode]) {
        const gp = deletedGroupPos[node.parentNode]
        const rest = { ...node }
        delete rest.parentNode
        return { ...rest, position: { x: gp.x + node.position.x, y: gp.y + node.position.y } }
      }
      return node
    })
  edges.value = edges.value.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target))
  closeMenu()
  message.success(ids.length > 1 ? `已删除 ${ids.length} 个` : '已删除')
}

// 从画布卡片跳转到对应资源库进行编辑
function editContextNode() {
  const node = contextNode.value
  const target = contextEditTarget.value
  closeMenu()
  if (!node || !target) return
  const query = target.buildQuery(node.data || {})
  const primary = Object.values(query)[0]
  if (primary == null || primary === '') {
    return message.warning(`该卡片未绑定${target.label}库条目，无法编辑`)
  }
  const cleanQuery = Object.fromEntries(
    Object.entries(query).filter(([, v]) => v != null && v !== ''),
  )
  router.push({ path: target.path, query: cleanQuery })
}

// ---------- 卡片分组 ----------
function groupSelected() {
  closeMenu()
  const members = selectedNodes.value.filter((n) => n.type !== 'group' && !n.parentNode)
  if (members.length < 2) return message.warning('请先按住 Shift 或框选至少 2 张卡片')
  const TITLE_BAR = 34
  const PAD = 26
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  members.forEach((n) => {
    const abs = absolutePosition(n)
    const size = nodeSize(n)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + size.width)
    maxY = Math.max(maxY, abs.y + size.height)
  })
  const groupX = minX - PAD
  const groupY = minY - PAD - TITLE_BAR
  const width = Math.round(maxX - minX + PAD * 2)
  const height = Math.round(maxY - minY + PAD * 2 + TITLE_BAR)
  const groupId = `group_${Date.now()}`
  const index = nodes.value.filter((n) => n.type === 'group').length + 1
  const groupNode = {
    id: groupId,
    type: 'group',
    position: { x: groupX, y: groupY },
    class: 'group-node-wrap',
    style: { width: `${width}px`, height: `${height}px` },
    data: { title: `分组 ${index}` },
    selected: false,
  }
  const memberIds = new Set(members.map((n) => n.id))
  const updated = nodes.value.map((n) => {
    if (!memberIds.has(n.id)) return n
    const abs = absolutePosition(n)
    return {
      ...n,
      parentNode: groupId,
      position: { x: abs.x - groupX, y: abs.y - groupY },
      selected: false,
    }
  })
  nodes.value = [groupNode, ...updated]
  message.success(`已建立分组（${members.length} 张卡片）`)
}

function ungroupNode(groupId) {
  const group = nodes.value.find((n) => n.id === groupId)
  if (!group) return
  const gp = group.position
  nodes.value = nodes.value
    .filter((n) => n.id !== groupId)
    .map((n) => {
      if (n.parentNode !== groupId) return n
      const rest = { ...n }
      delete rest.parentNode
      return { ...rest, position: { x: gp.x + n.position.x, y: gp.y + n.position.y } }
    })
  message.success('已解散分组')
}

function ungroupContext() {
  closeMenu()
  if (contextNode.value?.type === 'group') ungroupNode(contextNode.value.id)
}

function resetViewport() {
  flowInstance.value?.setViewport?.({ x: 0, y: 0, zoom: 1 }, { duration: 180 })
  closeMenu()
}

function fitCanvas() {
  flowInstance.value?.fitView?.({ padding: 0.25, duration: 220 })
  closeMenu()
}

function clearSelection() {
  nodes.value = nodes.value.map((n) => ({ ...n, selected: false }))
  edges.value = edges.value.map((e) => ({ ...e, selected: false }))
  closeMenu()
}

function updateCanvasSize() {
  const rect = flowWrap.value?.getBoundingClientRect()
  if (!rect) return
  canvasSize.width = rect.width
  canvasSize.height = rect.height
}

watch(
  () => project.value?.path,
  () => {
    scriptDialog.scripts = []
    scriptDialog.episodes = []
    scriptDialog.scriptId = ''
    scriptDialog.episodeNo = null
    Object.keys(scriptDrafts).forEach((k) => delete scriptDrafts[k])
    brokenCovers.clear()
    initializeCanvas()
    loadScriptChoices()
  },
)

watch(
  [nodes, edges, () => ({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })],
  () => syncCanvasDraft(),
  { deep: true },
)

let resizeObserver = null
onMounted(() => {
  updateCanvasSize()
  resizeObserver = new ResizeObserver(updateCanvasSize)
  if (flowWrap.value) resizeObserver.observe(flowWrap.value)
  window.addEventListener('click', closeMenu)
  initializeCanvas()
  loadScriptChoices()
})

onBeforeUnmount(() => {
  syncCanvasDraft()
  resizeObserver?.disconnect()
  window.removeEventListener('mousemove', updateBoxSelect)
  window.removeEventListener('click', closeMenu)
})
</script>

<template>
  <div class="project-board" @contextmenu.prevent>
    <header class="board-toolbar">
      <div class="board-title">
        <div class="board-icon"><FolderKanban :size="18" /></div>
        <div>
          <h2>{{ project.name || '工程' }}</h2>
          <p>工程画布</p>
        </div>
      </div>
      <div class="board-actions">
        <a-button type="primary" size="small" :loading="saving" @click="saveCanvas">
          <template #icon><Save :size="14" /></template>
          保存幕布
        </a-button>
      </div>
    </header>

    <main ref="flowWrap" class="flow-wrap" @mousedown.capture="beginBoxSelect">
      <VueFlow
        :id="flowId"
        v-model:nodes="nodes"
        v-model:edges="edges"
        :pan-on-drag="[1]"
        :selection-key-code="false"
        :multi-selection-key-code="'Shift'"
        :select-nodes-on-drag="false"
        selection-mode="partial"
        :zoom-on-double-click="false"
        :min-zoom="0.25"
        :max-zoom="2"
        fit-view-on-init
        class="project-flow"
        @pane-ready="onPaneReady"
        @viewport-change="onViewportChange"
        @pane-context-menu="openPaneMenu"
        @node-context-menu="openNodeMenu"
        @edge-click="selectEdge"
        @edge-context-menu="deleteEdge"
        @connect="addConnection"
      >
        <template #edge-flowing="edgeProps">
          <path
            :id="edgeProps.id"
            class="vue-flow__edge-path flowing-edge-base"
            :class="{ selected: edgeProps.selected }"
            :d="edgePath(edgeProps)"
            :marker-end="edgeProps.markerEnd"
          />
          <path
            class="flowing-edge-light"
            :class="{ selected: edgeProps.selected }"
            :d="edgePath(edgeProps)"
          />
          <path
            class="vue-flow__edge-interaction flowing-edge-hit"
            :d="edgePath(edgeProps)"
          />
        </template>

        <template #node-script-work="{ id, data, selected }">
          <div class="script-card" :class="{ selected, 'is-missing': data.missing }" :style="{ minHeight: scriptCardHeight() + 'px' }">
            <div class="script-card-head">
              <div class="script-card-icon"><FileText :size="17" /></div>
              <div class="script-card-title">
                <input class="node-title-input nodrag" :value="scriptTitle(data)" @input="updateNodeTitle(id, $event.target.value)" />
                <span>{{ data.scriptTitle }}</span>
              </div>
            </div>

            <div class="script-card-meta">
              <span v-if="data.duration"><BookOpen :size="13" /> {{ data.duration }}</span>
              <span><GitBranchPlus :size="13" /> {{ data.sceneCount || 0 }} 场景</span>
            </div>
            <p class="script-card-summary">{{ data.summary }}</p>

            <div class="script-content-preview">
              <div class="preview-head">
                <span class="preview-title">剧本内容（可直接编辑）</span>
                <button
                  v-if="scriptDirty(id, data)"
                  class="preview-save nodrag"
                  @mousedown.stop
                  @click.stop="saveScriptNode(id, data)"
                >
                  <Save :size="11" /> 保存
                </button>
              </div>
              <textarea
                class="script-preview-input nodrag"
                :value="scriptDraftContent(id, data)"
                spellcheck="false"
                placeholder="编辑本集剧情内容，保存后写回剧本库"
                @input="setScriptDraft(id, $event.target.value)"
                @mousedown.stop
              />
            </div>

            <div class="script-port-list script-port-left">
              <div class="script-port-row">出境角色</div>
              <div class="script-port-row">参考图片</div>
            </div>
            <div class="script-port-list script-port-right">
              <div class="script-port-row layout-row">分镜排布</div>
            </div>

            <Handle
              id="cast-roles"
              type="target"
              :position="Position.Left"
              class="script-handle role-handle"
              :style="{ '--handle-top': scriptRoleHandleTop }"
            />
            <Handle
              id="reference-images"
              type="target"
              :position="Position.Left"
              class="script-handle image-handle"
              :style="{ '--handle-top': scriptImageHandleTop }"
            />
            <Handle
              id="storyboard-layout"
              type="source"
              :position="Position.Right"
              class="script-handle shot-handle"
              :style="{ '--handle-top': scriptLayoutHandleTop }"
            />
            <div v-if="data.missing" class="script-missing-flag">剧集已在剧本库删除</div>
          </div>
        </template>

        <template #node-role-card="{ id, data, selected }">
          <div class="role-node" :class="{ selected, 'is-missing': data.missing }">
            <Handle id="role-out" type="source" :position="Position.Right" class="card-handle role-out" />
            <div class="role-node-top">
              <div class="role-node-avatar">
                <img
                  v-if="data.cover && !brokenCovers.has(id)"
                  :src="previewUrl(data.cover)"
                  :alt="data.title"
                  @error="markCoverBroken(id)"
                />
                <UserRound v-else :size="24" />
              </div>
              <div class="role-node-heading">
                <div class="role-node-name" :title="data.title">{{ data.title || '未命名角色' }}</div>
                <div class="role-node-sub" :title="data.identity">{{ data.identity || '未填写身份' }}</div>
              </div>
              <span class="role-node-badge">{{ data.roleType || '角色' }}</span>
            </div>
            <p class="role-node-desc">{{ data.personality || data.appearance || '未填写角色描述' }}</p>
            <div class="role-node-foot">
              <div class="role-node-tags">
                <span v-for="tag in roleTags(data)" :key="tag">{{ tag }}</span>
                <span v-if="!roleTags(data).length" class="role-node-tag-empty">未填写性别 / 年龄</span>
              </div>
              <span v-if="data.voice" class="role-node-voice" title="已设置声线">声线</span>
            </div>
            <div v-if="data.missing" class="role-node-flag">该角色已在角色库中删除</div>
          </div>
        </template>

        <template #node-image-card="{ id, data, selected }">
          <div class="flow-card image-work-card" :class="{ selected }">
            <Handle id="image-out" type="source" :position="Position.Right" class="card-handle image-out" />
            <div class="flow-card-head">
              <Image :size="17" />
              <input class="node-title-input nodrag" :value="data.title" @input="updateNodeTitle(id, $event.target.value)" />
            </div>
            <div class="image-card-preview">
              <img v-if="data.thumbnail || data.file" :src="previewUrl(data.thumbnail || data.file)" :alt="data.title" />
              <Image v-else :size="28" />
            </div>
            <div class="flow-card-kicker">{{ data.usage }}</div>
            <p>{{ data.desc }}</p>
          </div>
        </template>

        <template #node-shot-node="{ id, data, selected }">
          <div class="flow-card shot-node-card" :class="{ selected }">
            <Handle id="shot-out" type="source" :position="Position.Right" class="card-handle shot-out" />
            <div class="flow-card-head">
              <Clapperboard :size="17" />
              <input class="node-title-input nodrag" :value="data.title" @input="updateNodeTitle(id, $event.target.value)" />
              <span v-if="data.duration" class="shot-duration">{{ data.duration }}s</span>
            </div>
            <div class="shot-node-thumb">
              <img
                v-if="data.image && !brokenCovers.has(id)"
                :src="previewUrl(data.image)"
                :alt="data.title"
                @error="markCoverBroken(id)"
              />
              <div v-else class="shot-thumb-empty">
                <Clapperboard :size="18" />
                <span>画面未生成</span>
              </div>
            </div>
            <div class="shot-prompt-label">分镜提示词</div>
            <textarea
              class="shot-prompt-input nodrag"
              :value="data.prompt || ''"
              spellcheck="false"
              placeholder="编写该分镜画面提示词，或用分镜总览一键生成"
              @input="updateShotPrompt(id, $event.target.value)"
              @mousedown.stop
            />
            <button class="shot-video-btn nodrag" @mousedown.stop @click.stop="generateShotVideo(id, data)">
              <Video :size="13" /> 生成视频
            </button>
          </div>
        </template>

        <template #node-master-output-node="{ id, data, selected }">
          <div class="flow-card master-output-card" :class="{ selected }">
            <Handle id="master-in" type="target" :position="Position.Left" class="card-handle master-in" />
            <div class="flow-card-head">
              <Video :size="17" />
              <input class="node-title-input nodrag" :value="data.title" @input="updateNodeTitle(id, $event.target.value)" />
            </div>
            <div class="flow-card-kicker">最终输出</div>
            <p>{{ data.desc }}</p>
          </div>
        </template>

        <template #node-group="{ id, data }">
          <div class="group-node">
            <input
              class="group-title-input nodrag"
              :value="data.title"
              placeholder="分组标题"
              @input="updateNodeTitle(id, $event.target.value)"
              @mousedown.stop
            />
          </div>
        </template>

        <template #node-storyboard-layout="{ id, data, selected }">
          <div class="storyboard-layout-card" :class="{ selected }" :style="{ minHeight: storyboardLayoutHeight(id, data) + 'px' }">
            <Handle
              id="layout-script-in"
              type="target"
              :position="Position.Left"
              class="card-handle layout-script-in"
            />
            <Handle
              id="layout-shot-in"
              type="target"
              :position="Position.Left"
              class="card-handle layout-shot-in"
            />
            <div class="flow-card-head">
              <Clapperboard :size="17" />
              <input class="node-title-input nodrag" :value="data.title" @input="updateNodeTitle(id, $event.target.value)" />
            </div>
            <div class="flow-card-kicker">分镜总览 · 拖动调整画面顺序</div>
            <div class="shot-frame-list">
              <div
                v-for="(shot, idx) in layoutShotItems(id, data)"
                :key="shot.id"
                class="shot-frame-row"
                draggable="true"
                @dragstart="startShotDrag(id, shot.id)"
                @dragover.prevent
                @drop="dropShot(id, shot.id)"
              >
                <GripVertical :size="13" class="frame-grip" />
                <div class="shot-frame-thumb">
                  <img v-if="shot.image" :src="previewUrl(shot.image)" :alt="shot.title" />
                  <div v-else class="frame-black">{{ idx + 1 }}</div>
                </div>
                <div class="shot-frame-info">
                  <span class="frame-title">{{ shot.title }}</span>
                  <em v-if="shot.duration" class="frame-dur">{{ shot.duration }}s</em>
                </div>
              </div>
              <div v-if="!layoutShotItems(id, data).length" class="shot-empty">
                接入剧情后，点击下方一键生成分镜
              </div>
            </div>
            <button
              class="storyboard-gen-btn nodrag"
              :disabled="storyboardLoading[id]"
              @mousedown.stop
              @click.stop="generateStoryboard(id)"
            >
              <LoaderCircle v-if="storyboardLoading[id]" :size="14" class="sb-spin" />
              <Sparkles v-else :size="14" />
              {{ storyboardLoading[id] ? 'AI 生成分镜中…' : '一键生成分镜镜头' }}
            </button>
            <div class="master-output-row">总镜头输出</div>
            <Handle id="master-output" type="source" :position="Position.Right" class="card-handle master-out" />
          </div>
        </template>

        <MiniMap
          pannable
          zoomable
          class="board-minimap"
          mask-color="rgba(8, 12, 18, 0.62)"
          node-color="rgba(34, 211, 187, 0.9)"
        />
      </VueFlow>

      <div class="ruler ruler-top">
        <span v-for="tick in horizontalTicks" :key="'top' + tick.x" class="tick-x" :class="{ major: tick.major }" :style="{ left: tick.x + 'px' }">
          <b v-if="tick.major">{{ tick.label }}</b>
        </span>
      </div>
      <div class="ruler ruler-bottom">
        <span v-for="tick in horizontalTicks" :key="'bottom' + tick.x" class="tick-x" :class="{ major: tick.major }" :style="{ left: tick.x + 'px' }">
          <b v-if="tick.major">{{ tick.label }}</b>
        </span>
      </div>
      <div class="ruler ruler-left">
        <span v-for="tick in verticalTicks" :key="'left' + tick.y" class="tick-y" :class="{ major: tick.major }" :style="{ top: tick.y + 'px' }">
          <b v-if="tick.major">{{ tick.label }}</b>
        </span>
      </div>
      <div class="ruler ruler-right">
        <span v-for="tick in verticalTicks" :key="'right' + tick.y" class="tick-y" :class="{ major: tick.major }" :style="{ top: tick.y + 'px' }">
          <b v-if="tick.major">{{ tick.label }}</b>
        </span>
      </div>

      <div class="zoom-badge">
        <ZoomIn :size="14" />
        <span>{{ zoomPercent }}</span>
        <em v-if="selectedCount">{{ selectedCount }} 个已选</em>
      </div>

      <div
        v-if="boxSelect.active"
        class="box-select"
        :style="{
          left: boxSelect.x + 'px',
          top: boxSelect.y + 'px',
          width: boxSelect.width + 'px',
          height: boxSelect.height + 'px',
        }"
      />

      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <!-- 节点卡片菜单：编辑 / 删除 -->
        <template v-if="contextMenu.target === 'node'">
          <button v-if="canEditContextNode" @click="editContextNode">
            <Pencil :size="14" /> 编辑{{ contextEditTarget?.label }}
          </button>
          <button v-if="contextIsGroup" @click="ungroupContext">
            <RotateCcw :size="14" /> 解散分组
          </button>
          <button v-if="!contextIsGroup && selectedCount >= 2" @click="groupSelected">
            <FolderKanban :size="14" /> 建立分组（{{ selectedCount }}）
          </button>
          <button class="danger" @click="deleteContextNodes">
            <Trash2 :size="14" /> 删除{{ selectedCount > 1 ? ` ${selectedCount} 个` : '' }}
          </button>
        </template>

        <!-- 画布空白处菜单：新建节点 + 视图控制 -->
        <template v-else>
          <button @click="openScriptNodeDialog"><FileText :size="14" /> 新建剧情</button>
          <button @click="addRoleCard"><UserRound :size="14" /> 添加角色</button>
          <button @click="addImageCard"><Image :size="14" /> 图片节点</button>
          <button @click="addShotNode"><Clapperboard :size="14" /> 分镜节点</button>
          <button @click="addStoryboardLayout"><Clapperboard :size="14" /> 分镜排布</button>
          <button @click="addMasterOutputNode"><Video :size="14" /> 总镜头输出节点</button>
          <div class="context-separator" />
          <button v-if="selectedCount >= 2" @click="groupSelected">
            <FolderKanban :size="14" /> 建立分组（{{ selectedCount }}）
          </button>
          <button v-if="selectedCount > 0" class="danger" @click="deleteContextNodes">
            <Trash2 :size="14" /> 删除{{ selectedCount > 1 ? ` ${selectedCount} 个` : '' }}
          </button>
          <button @click="fitCanvas"><LocateFixed :size="14" /> 适配视图</button>
          <button @click="resetViewport"><RotateCcw :size="14" /> 重置视图</button>
          <button @click="clearSelection"><MousePointer2 :size="14" /> 清空选择</button>
        </template>
      </div>
    </main>

    <footer class="board-status">
      <span class="status-dot" :class="{ dirty }"></span>
      <span>{{ dirty ? '有未保存修改' : '幕布已同步' }}</span>
      <span>{{ nodes.length }} 个节点</span>
      <span>{{ edges.length }} 条连接</span>
      <span>{{ zoomPercent }}</span>
      <span v-if="selectedCount">{{ selectedCount }} 个节点已选</span>
      <span v-else-if="edges.some((edge) => edge.selected)">连接已选中</span>
    </footer>

    <a-modal
      v-model:open="roleDialog.visible"
      title="选择角色"
      :confirm-loading="roleDialog.loading"
      ok-text="添加角色卡片"
      cancel-text="取消"
      width="640px"
      @ok="confirmRoleCard"
    >
      <div class="node-picker">
        <a-empty v-if="!roleDialog.loading && !roleDialog.roles.length" description="角色库暂无角色" />
        <div v-else class="picker-grid">
          <button
            v-for="role in roleDialog.roles"
            :key="role.id"
            class="picker-card"
            :class="{ active: roleDialog.roleId === role.id }"
            @click="roleDialog.roleId = role.id"
          >
            <div class="picker-thumb role-thumb">
              <img v-if="role.cover" :src="previewUrl(role.cover)" :alt="role.name" />
              <UserRound v-else :size="28" />
            </div>
            <strong>{{ role.name || '未命名角色' }}</strong>
            <span>{{ role.roleType || '角色' }} {{ role.identity || '' }}</span>
          </button>
        </div>
      </div>
    </a-modal>

    <a-modal
      v-model:open="imageDialog.visible"
      title="添加参考图片"
      :confirm-loading="imageDialog.loading"
      ok-text="添加图片卡片"
      cancel-text="取消"
      width="700px"
      @ok="confirmImageCard"
    >
      <div class="node-picker">
        <a-tabs v-model:activeKey="imageDialog.activeTab">
          <a-tab-pane key="upload" tab="上传图片">
            <div class="upload-panel">
              <Image :size="30" />
              <strong>上传到资产库并添加为参考图片</strong>
              <p>支持常见图片格式，导入后会自动绑定到新的图片节点。</p>
              <a-button type="primary" :loading="imageDialog.importing" @click="importImageForCard">选择图片</a-button>
            </div>
          </a-tab-pane>
          <a-tab-pane key="library" tab="从资产库选择">
            <a-empty v-if="!imageDialog.loading && !imageDialog.assets.length" description="资产库暂无图片" />
            <div v-else class="picker-grid asset-picker-grid">
              <button
                v-for="asset in imageDialog.assets"
                :key="asset.id"
                class="picker-card"
                :class="{ active: imageDialog.assetId === asset.id }"
                @click="imageDialog.assetId = asset.id"
              >
                <div class="picker-thumb">
                  <img :src="previewUrl(asset.thumbnail || asset.file)" :alt="asset.name" />
                </div>
                <strong>{{ asset.name || '未命名图片' }}</strong>
                <span>{{ asset.folder || '未归档' }}</span>
              </button>
            </div>
          </a-tab-pane>
        </a-tabs>
      </div>
    </a-modal>

    <a-modal
      v-model:open="scriptDialog.visible"
      title="新建剧情"
      :confirm-loading="scriptDialog.loading"
      ok-text="添加"
      cancel-text="取消"
      width="520px"
      @ok="confirmScriptNode"
    >
      <div class="script-dialog">
        <a-form layout="vertical">
          <a-form-item label="当前项目剧本">
            <div class="current-script-box">
              <FileText :size="15" />
              <span>{{ currentScript?.title || '当前工程暂无剧本' }}</span>
            </div>
          </a-form-item>
          <a-form-item label="剧集剧情">
            <a-select
              v-model:value="scriptDialog.episodeNo"
              :options="episodeOptions"
              :disabled="!scriptDialog.scriptId"
              placeholder="选择剧集"
            />
          </a-form-item>
        </a-form>
        <div v-if="selectedEpisode" class="episode-preview">
          <strong>第{{ selectedEpisode.episodeNo }}集：{{ selectedEpisode.title }}</strong>
          <p>{{ extractEpisodeSummary(selectedEpisode.content) }}</p>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.project-board {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-app);
}

.board-toolbar {
  height: 58px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.board-title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.board-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
}
.board-title h2 {
  margin: 0;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}
.board-title p {
  margin: 2px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
}
.board-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dirty-pill {
  height: 26px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 6px;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.1);
  font-size: 12px;
}
.hint-pill {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  font-size: 12px;
}
.board-status {
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  border-top: 1px solid var(--border-color);
  color: var(--text-tertiary);
  background: var(--bg-panel);
  font-size: 12px;
}
.board-status span {
  flex-shrink: 0;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
}
.status-dot.dirty {
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
}

.flow-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.project-flow {
  width: 100%;
  height: 100%;
  background-color: var(--bg-app);
  background-image: var(--bg-pattern);
  background-size: var(--bg-pattern-size);
  background-position: 0 0;
  background-repeat: repeat;
}
.project-flow :deep(.vue-flow__viewport),
.project-flow :deep(.vue-flow__pane) {
  background: transparent;
}

.project-flow :deep(.vue-flow__pane) {
  cursor: crosshair;
}
.project-flow :deep(.vue-flow__pane.dragging) {
  cursor: grabbing;
}
.project-flow :deep(.vue-flow__selection) {
  border: 1px solid var(--brand-color);
  background: rgba(34, 211, 187, 0.16);
}
.project-flow :deep(.vue-flow__edge-path) {
  stroke: rgba(154, 165, 179, 0.85);
  stroke-width: 1.7;
  fill: none;
}
.project-flow :deep(.flowing-edge-base.selected) {
  stroke: var(--brand-color);
  stroke-width: 3;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--brand-color) 70%, transparent));
}
.project-flow :deep(.flowing-edge-light) {
  fill: none;
  pointer-events: none;
  stroke: #f8fafc;
  stroke-width: 3.2;
  stroke-linecap: round;
  stroke-dasharray: 1 18;
  stroke-dashoffset: 0;
  opacity: 0.78;
  animation: flow-light 0.8s linear infinite;
}
.project-flow :deep(.flowing-edge-light.selected) {
  stroke: #ffffff;
  stroke-width: 4;
  opacity: 0.95;
  filter: drop-shadow(0 0 7px var(--brand-color));
}
.project-flow :deep(.flowing-edge-hit) {
  fill: none;
  pointer-events: stroke;
  stroke: transparent;
  stroke-width: 18;
}
.project-flow :deep(.vue-flow__edge.selected marker path) {
  fill: var(--brand-color);
  stroke: var(--brand-color);
}
.project-flow :deep(.vue-flow__node:not(.script-work-node):not(.role-card-node):not(.image-card-node):not(.storyboard-layout-node):not(.shot-node):not(.master-output-node):not(.group-node-wrap)) {
  min-width: 146px;
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
  font-size: 13px;
  font-weight: 650;
}
.project-flow :deep(.vue-flow__node:not(.script-work-node):not(.role-card-node):not(.image-card-node):not(.storyboard-layout-node):not(.shot-node):not(.master-output-node):not(.group-node-wrap)::after) {
  content: attr(data-id);
  display: block;
  margin-top: 4px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 400;
}
.project-flow :deep(.vue-flow__node.selected) {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 2px var(--brand-soft), var(--shadow-card);
}
.project-flow :deep(.script-work-node),
.project-flow :deep(.role-card-node),
.project-flow :deep(.image-card-node),
.project-flow :deep(.storyboard-layout-node),
.project-flow :deep(.shot-node),
.project-flow :deep(.master-output-node),
.project-flow :deep(.group-node-wrap) {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}
.project-flow :deep(.script-work-node) {
  width: 360px;
}
.project-flow :deep(.role-card-node) {
  width: 280px;
}
.project-flow :deep(.image-card-node) {
  width: 280px;
}
.project-flow :deep(.storyboard-layout-node) {
  width: 320px;
}
.project-flow :deep(.shot-node) {
  width: 280px;
}
.project-flow :deep(.master-output-node) {
  width: 280px;
}
.group-node {
  width: 100%;
  height: 100%;
  border: 1.5px dashed color-mix(in srgb, var(--brand-color) 55%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--brand-color) 7%, transparent);
}
.project-flow :deep(.group-node-wrap.selected .group-node) {
  border-style: solid;
  border-color: var(--brand-color);
}
.group-title-input {
  width: calc(100% - 20px);
  margin: 7px 10px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}
.group-title-input::placeholder {
  color: var(--text-tertiary);
  font-weight: 400;
}

.script-card {
  position: relative;
  width: 360px;
  padding: 14px 18px 92px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
}
.script-card.selected,
.flow-card.selected {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 2px var(--brand-soft), var(--shadow-card);
}
.script-card.is-missing {
  border-color: rgba(239, 68, 68, 0.5);
}
.script-missing-flag {
  position: absolute;
  top: 12px;
  right: 14px;
  padding: 2px 7px;
  border-radius: 5px;
  color: #fecaca;
  background: rgba(239, 68, 68, 0.16);
  font-size: 10px;
}
.script-card-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.script-card-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: #eff6ff;
  background: #2563eb;
}
.script-card-title {
  min-width: 0;
}
.script-card-title strong,
.script-card-title span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.script-card-title strong {
  max-width: 276px;
  font-size: 14px;
  line-height: 20px;
}
.node-title-input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  color: var(--text-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
}
.node-title-input:focus {
  color: var(--brand-color);
}
.script-card-title span {
  max-width: 276px;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.script-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 11px;
}
.script-card-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.script-card-summary {
  height: 38px;
  margin: 8px 0 10px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 19px;
}
.script-content-preview {
  height: 176px;
  display: flex;
  flex-direction: column;
  padding: 8px 9px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-sunken);
}
.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 5px;
}
.preview-title {
  color: var(--text-tertiary);
  font-size: 11px;
}
.preview-save {
  height: 20px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid var(--brand-color);
  border-radius: 5px;
  color: var(--brand-color);
  background: var(--brand-soft);
  font-size: 11px;
  cursor: pointer;
}
.preview-save:hover {
  color: var(--text-onbrand);
  background: var(--brand-color);
}
.script-preview-input {
  flex: 1;
  width: 100%;
  min-height: 0;
  resize: none;
  overflow: auto;
  padding: 0;
  border: none;
  outline: none;
  color: var(--text-secondary);
  background: transparent;
  font-family: inherit;
  font-size: 11px;
  line-height: 17px;
  white-space: pre-wrap;
}
.script-preview-input:focus {
  color: var(--text-primary);
}
.script-port-list {
  position: absolute;
  top: auto;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 122px;
}
.script-port-left {
  left: 18px;
  align-items: flex-start;
}
.script-port-right {
  right: 18px;
  align-items: flex-end;
}
.script-port-row {
  max-width: 122px;
  height: 22px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  font-size: 11px;
  white-space: nowrap;
}
.script-port-row.layout-row {
  color: #dcfce7;
  border-color: rgba(167, 139, 250, 0.45);
  background: rgba(167, 139, 250, 0.14);
}
.project-flow :deep(.script-handle) {
  top: var(--handle-top) !important;
  width: 10px;
  height: 10px;
  border: 2px solid var(--bg-elevated);
}
.project-flow :deep(.role-handle) {
  left: 0;
  background: #f59e0b;
}
.project-flow :deep(.image-handle) {
  left: 0;
  background: #22d3bb;
}
.project-flow :deep(.shot-handle) {
  right: 0;
  background: #a78bfa;
}
.project-flow :deep(.total-handle) {
  right: 0;
  background: #22c55e;
}

.flow-card {
  position: relative;
  min-height: 150px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
}
.role-work-card {
  border-left: 3px solid #f59e0b;
}
.image-work-card {
  border-left: 3px solid #22d3bb;
}
.role-work-card,
.image-work-card {
  min-height: 214px;
}
.shot-node-card {
  min-height: 232px;
  border-left: 3px solid #a78bfa;
}
.shot-duration {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  color: #ddd6fe;
  background: rgba(167, 139, 250, 0.2);
  font-size: 11px;
}
.shot-node-thumb {
  height: 92px;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: #000;
}
.shot-node-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.shot-thumb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
}
.shot-prompt-label {
  margin: 10px 0 4px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.shot-prompt-input {
  width: 100%;
  height: 68px;
  resize: none;
  overflow: auto;
  padding: 7px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
  outline: none;
}
.shot-prompt-input:focus {
  border-color: var(--brand-color);
  color: var(--text-primary);
}
.shot-video-btn {
  width: 100%;
  height: 30px;
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #a78bfa;
  border-radius: 6px;
  color: #ddd6fe;
  background: rgba(167, 139, 250, 0.14);
  font-size: 12px;
  cursor: pointer;
}
.shot-video-btn:hover {
  color: #fff;
  background: rgba(167, 139, 250, 0.32);
}
.master-output-card {
  min-height: 120px;
  border-left: 3px solid #22c55e;
}
.flow-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.flow-card-head strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flow-card-head .node-title-input {
  flex: 1;
}
.role-card-body {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 10px;
  margin-top: 12px;
}
.role-cover,
.image-card-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-tertiary);
  background: var(--bg-sunken);
}
.role-cover {
  width: 74px;
  height: 82px;
}
.role-cover img,
.image-card-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.role-info {
  min-width: 0;
}
.role-info p {
  height: 58px;
  overflow: hidden;
}
.compact-tags {
  margin-top: 10px;
}

/* 角色卡节点（只读角色名 + 头像容错 + 清晰字段 + 已删除态） */
.role-node {
  position: relative;
  width: 280px;
  min-height: 196px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-left: 3px solid #f59e0b;
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
}
.role-node.selected {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 2px var(--brand-soft), var(--shadow-card);
}
.role-node.is-missing {
  border-left-color: #ef4444;
}
.role-node-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.role-node-avatar {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-tertiary);
  background: var(--bg-sunken);
}
.role-node-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.role-node-heading {
  flex: 1;
  min-width: 0;
}
.role-node-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-node-sub {
  margin-top: 2px;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-node-badge {
  flex-shrink: 0;
  height: 20px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 6px;
  color: #fff7ed;
  background: rgba(245, 158, 11, 0.92);
  font-size: 11px;
  font-weight: 600;
}
.role-node-desc {
  margin: 12px 0 0;
  height: 52px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.role-node-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}
.role-node-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.role-node-tags span {
  height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  font-size: 11px;
  white-space: nowrap;
}
.role-node-tags .role-node-tag-empty {
  color: var(--text-tertiary);
  border-style: dashed;
}
.role-node-voice {
  flex-shrink: 0;
  height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 1px solid rgba(34, 211, 187, 0.4);
  border-radius: 6px;
  color: #22d3bb;
  background: rgba(34, 211, 187, 0.12);
  font-size: 11px;
}
.role-node-flag {
  margin-top: 10px;
  padding: 4px 8px;
  border-radius: 6px;
  color: #fecaca;
  background: rgba(239, 68, 68, 0.14);
  font-size: 11px;
  text-align: center;
}
.image-card-preview {
  width: 100%;
  height: 92px;
  margin-top: 12px;
}
.flow-card-kicker {
  margin-top: 8px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.flow-card p {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.tag-row span {
  height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  font-size: 11px;
}
.project-flow :deep(.card-handle) {
  width: 10px;
  height: 10px;
  border: 2px solid var(--bg-elevated);
}
.project-flow :deep(.role-out) {
  right: 0;
  background: #f59e0b;
}
.project-flow :deep(.image-out) {
  right: 0;
  background: #22d3bb;
}
.project-flow :deep(.shot-out) {
  right: 0;
  background: #a78bfa;
}
.project-flow :deep(.master-in) {
  left: 0;
  background: #22c55e;
}
.project-flow :deep(.layout-script-in) {
  top: 78px;
  left: 0;
  background: #60a5fa;
}
.project-flow :deep(.layout-shot-in) {
  top: 116px;
  left: 0;
  background: #a78bfa;
}
.project-flow :deep(.master-out) {
  top: auto;
  right: 0;
  bottom: 19px;
  background: #22c55e;
}

.storyboard-layout-card {
  position: relative;
  width: 320px;
  padding: 14px 18px 52px 14px;
  border: 1px solid var(--border-strong);
  border-left: 3px solid #a78bfa;
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
}
.storyboard-layout-card.selected {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 2px var(--brand-soft), var(--shadow-card);
}
.shot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-right: 8px;
}
.shot-row {
  position: relative;
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 9px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-sunken);
  cursor: grab;
}
.shot-row:active {
  cursor: grabbing;
}
.shot-row svg {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.shot-row span {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shot-row em {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  font-style: normal;
}
.shot-empty {
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 9px;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  background: var(--bg-sunken);
}
.shot-frame-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-right: 4px;
}
.shot-frame-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-sunken);
  cursor: grab;
}
.shot-frame-row:active {
  cursor: grabbing;
}
.frame-grip {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.shot-frame-thumb {
  width: 64px;
  height: 36px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
  background: #000;
}
.shot-frame-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.frame-black {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
}
.shot-frame-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.frame-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-dur {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  font-style: normal;
}
.storyboard-gen-btn {
  width: 100%;
  height: 34px;
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: 7px;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.storyboard-gen-btn:disabled {
  opacity: 0.75;
  cursor: default;
}
.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}
@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
.master-output-row {
  position: absolute;
  right: 18px;
  bottom: 12px;
  height: 24px;
  display: flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 6px;
  color: #dcfce7;
  background: rgba(34, 197, 94, 0.14);
  font-size: 11px;
  font-weight: 700;
}

@keyframes flow-light {
  to {
    stroke-dashoffset: -19;
  }
}

.board-minimap {
  right: 36px;
  bottom: 32px;
  width: 178px;
  height: 120px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-panel);
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
}

.ruler {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  background: var(--bg-panel);
  background: color-mix(in srgb, var(--bg-panel) 86%, transparent);
  color: var(--text-tertiary);
  font-family: Consolas, monospace;
  font-size: 10px;
}
.ruler-top,
.ruler-bottom {
  left: 0;
  right: 0;
  height: 20px;
}
.ruler-top {
  top: 0;
  border-bottom: 1px solid var(--border-color);
}
.ruler-bottom {
  bottom: 0;
  border-top: 1px solid var(--border-color);
}
.ruler-left,
.ruler-right {
  top: 0;
  bottom: 0;
  width: 24px;
}
.ruler-left {
  left: 0;
  border-right: 1px solid var(--border-color);
}
.ruler-right {
  right: 0;
  border-left: 1px solid var(--border-color);
}
.tick-x,
.tick-y {
  position: absolute;
  display: block;
}
.tick-x {
  top: 0;
  width: 1px;
  height: 8px;
  background: var(--border-strong);
}
.tick-x.major {
  height: 14px;
}
.tick-x b {
  position: absolute;
  left: 4px;
  top: 4px;
  font-weight: 400;
}
.ruler-bottom .tick-x {
  top: auto;
  bottom: 0;
}
.ruler-bottom .tick-x b {
  top: auto;
  bottom: 4px;
}
.tick-y {
  left: 0;
  width: 8px;
  height: 1px;
  background: var(--border-strong);
}
.tick-y.major {
  width: 14px;
}
.tick-y b {
  position: absolute;
  left: 4px;
  top: 2px;
  font-weight: 400;
  transform: rotate(-90deg);
  transform-origin: left top;
}
.ruler-right .tick-y {
  left: auto;
  right: 0;
}
.ruler-right .tick-y b {
  left: auto;
  right: 4px;
}

.zoom-badge {
  position: absolute;
  left: 36px;
  bottom: 32px;
  z-index: 8;
  min-width: 86px;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--bg-panel);
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
}
.zoom-badge span {
  color: var(--text-primary);
  font-weight: 700;
}
.zoom-badge em {
  color: var(--brand-color);
  font-style: normal;
}

.box-select {
  position: absolute;
  z-index: 18;
  pointer-events: none;
  border: 1px solid var(--brand-color);
  background: rgba(34, 211, 187, 0.16);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.context-menu {
  position: absolute;
  z-index: 20;
  width: 186px;
  padding: 5px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-pop);
}
.context-menu button {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.context-menu button:hover {
  color: var(--brand-color);
  background: var(--bg-hover);
}
.context-menu button.danger {
  color: #ef4444;
}
.context-menu button.danger:hover {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.18);
}
.context-separator {
  height: 1px;
  margin: 5px 3px;
  background: var(--border-color);
}

.script-dialog :deep(.ant-form-item) {
  margin-bottom: 14px;
}
.current-script-box {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
}
.current-script-box span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.episode-preview {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-sunken);
}
.episode-preview strong {
  display: block;
  color: var(--text-primary);
  font-size: 13px;
}
.episode-preview p {
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.node-picker {
  min-height: 220px;
}
.picker-grid {
  max-height: 430px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(142px, 1fr));
  gap: 10px;
  overflow: auto;
  padding: 2px;
}
.asset-picker-grid {
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.picker-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  cursor: pointer;
  text-align: left;
}
.picker-card.active {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 2px var(--brand-soft);
}
.picker-card strong,
.picker-card span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-card strong {
  color: var(--text-primary);
  font-size: 13px;
}
.picker-card span {
  color: var(--text-tertiary);
  font-size: 11px;
}
.picker-thumb {
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 7px;
  color: var(--text-tertiary);
  background: var(--bg-elevated);
}
.picker-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.role-thumb {
  height: 118px;
}
.upload-panel {
  min-height: 238px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  text-align: center;
}
.upload-panel strong {
  color: var(--text-primary);
}
.upload-panel p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
}
</style>
