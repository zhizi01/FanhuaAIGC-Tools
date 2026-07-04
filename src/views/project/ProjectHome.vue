<script setup>
// 工程页：Vue Flow 画布工作台
// 中键拖动画布、左键框选、右键菜单；四边卡尺 + 小地图 + 缩放率。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Handle, MarkerType, Position, VueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import {
  BookOpen,
  Clapperboard,
  Crosshair,
  FileText,
  FolderKanban,
  GitBranchPlus,
  GripVertical,
  Image,
  LocateFixed,
  MousePointer2,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  Video,
  ZoomIn,
} from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { useAppStore } from '../../store/appState.js'
import { useFlowCanvasStore } from '../../store/flowCanvas.js'
import { api } from '../../services/bridge.js'

const appStore = useAppStore()
const flowStore = useFlowCanvasStore()
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

const boxSelect = reactive({
  active: false,
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
const canDeleteContext = computed(() => contextMenu.target === 'node' || selectedCount.value > 0)
const dirty = computed(() => flowStore.projectPath === project.value?.path && flowStore.dirty)
const currentScript = computed(() => scriptDialog.scripts[0] || null)
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
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    position: node.position,
    class: node.class,
    data: node.data || {},
  }
}

function normalizeEdge(edge) {
  return {
    id: edge.id,
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

async function initializeCanvas() {
  const projectPath = project.value?.path
  if (!projectPath) return
  if (flowStore.hasProject(projectPath)) {
    hydrateCanvas(flowStore)
    return
  }
  const saved = await flowStore.load(projectPath)
  hydrateCanvas(saved || defaultCanvas())
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
  Object.assign(boxSelect, { active: true, startX: x, startY: y, x, y, width: 0, height: 0 })
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
  nodes.value = nodes.value.map((node) => {
    const bounds = getNodeBounds(node)
    const selected =
      hasArea &&
      bounds.right >= selection.left &&
      bounds.left <= selection.right &&
      bounds.bottom >= selection.top &&
      bounds.top <= selection.bottom
    return { ...node, selected }
  })
  if (hasArea) {
    edges.value = edges.value.map((edge) => ({ ...edge, selected: false }))
  }
  boxSelect.active = false
}

function getNodeBounds(node) {
  const fallback = getNodeFallbackSize(node)
  const nodeLeft = node.position.x * viewport.zoom + viewport.x
  const nodeTop = node.position.y * viewport.zoom + viewport.y
  const nodeWidth = (node.dimensions?.width || fallback.width) * viewport.zoom
  const nodeHeight = (node.dimensions?.height || fallback.height) * viewport.zoom
  return {
    left: nodeLeft,
    top: nodeTop,
    right: nodeLeft + nodeWidth,
    bottom: nodeTop + nodeHeight,
  }
}

function getNodeFallbackSize(node) {
  if (node.type === 'script-work') return { width: 360, height: scriptCardHeight() }
  if (node.type === 'role-card') return { width: 250, height: 176 }
  if (node.type === 'image-card') return { width: 250, height: 150 }
  if (node.type === 'storyboard-layout') return { width: 320, height: storyboardLayoutHeight(node.id, node.data) }
  if (node.type === 'shot-node') return { width: 260, height: 160 }
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

function addRoleCard() {
  const index = nodes.value.filter((n) => n.type === 'role-card').length + 1
  addNode({
    id: `role_card_${Date.now()}`,
    type: 'role-card',
    position: nodePosition(250),
    class: 'role-card-node',
    data: {
      title: `角色 ${index}`,
      roleType: '主要角色',
      desc: '连接到剧情的出境角色输入，提供角色外观、性格和声线参考。',
      tags: ['外观', '性格', '声线'],
    },
  })
}

function addImageCard() {
  const index = nodes.value.filter((n) => n.type === 'image-card').length + 1
  addNode({
    id: `image_card_${Date.now()}`,
    type: 'image-card',
    position: nodePosition(250),
    class: 'image-card-node',
    data: {
      title: `参考图片 ${index}`,
      desc: '连接到剧情的参考图片输入，用于画面、角色或场景风格参考。',
      usage: '图片参考',
    },
  })
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
    position: nodePosition(260),
    class: 'shot-node',
    data: {
      title: `分镜 ${index}`,
      desc: '单个分镜镜头，可接入分镜排布。',
      shotNo: index,
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
      scriptId: scriptDialog.scriptId,
      scriptTitle: script?.title || '未命名剧本',
      episodeNo: ep.episodeNo,
      episodeTitle: ep.title || '未命名剧情',
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

function scriptCardHeight() {
  return 362
}

function storyboardLayoutHeight(layoutId, data) {
  const shotCount = layoutId ? layoutShotItems(layoutId, data).length : 0
  return Math.max(246, 166 + shotCount * 36)
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
        desc: node.data?.desc || '分镜镜头',
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

function deleteContextNodes() {
  const selectedIds = selectedNodes.value.map((node) => node.id)
  const contextIsSelected = selectedIds.includes(contextMenu.nodeId)
  const ids = selectedIds.length && (!contextMenu.nodeId || contextIsSelected)
    ? selectedIds
    : [contextMenu.nodeId].filter(Boolean)
  if (!ids.length) return
  const idSet = new Set(ids)
  nodes.value = nodes.value.filter((node) => !idSet.has(node.id))
  edges.value = edges.value.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target))
  closeMenu()
  message.success(ids.length > 1 ? `已删除 ${ids.length} 个` : '已删除')
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
        <span v-if="dirty" class="dirty-pill">有未保存的幕布修改</span>
        <a-button type="primary" size="small" :loading="saving" @click="saveCanvas">
          <template #icon><Save :size="14" /></template>
          保存幕布
        </a-button>
        <span class="hint-pill"><MousePointer2 :size="14" /> 左键框选</span>
        <span class="hint-pill"><Crosshair :size="14" /> 中键移动</span>
        <span class="hint-pill">右键菜单</span>
      </div>
    </header>

    <main ref="flowWrap" class="flow-wrap" @mousedown.capture="beginBoxSelect">
      <VueFlow
        :id="flowId"
        v-model:nodes="nodes"
        v-model:edges="edges"
        :pan-on-drag="[1]"
        :selection-key-code="false"
        :multi-selection-key-code="null"
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
        @connect="addConnection"
      >
        <template #node-script-work="{ data, selected }">
          <div class="script-card" :class="{ selected }" :style="{ minHeight: scriptCardHeight() + 'px' }">
            <div class="script-card-head">
              <div class="script-card-icon"><FileText :size="17" /></div>
              <div class="script-card-title">
                <strong>第{{ data.episodeNo }}集：{{ data.episodeTitle }}</strong>
                <span>{{ data.scriptTitle }}</span>
              </div>
            </div>

            <div class="script-card-meta">
              <span v-if="data.duration"><BookOpen :size="13" /> {{ data.duration }}</span>
              <span><GitBranchPlus :size="13" /> {{ data.sceneCount || 0 }} 场景</span>
            </div>
            <p class="script-card-summary">{{ data.summary }}</p>

            <div class="script-content-preview">
              <div class="preview-title">剧本内容</div>
              <pre>{{ data.preview }}</pre>
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
              :style="{ '--handle-top': '249px' }"
            />
            <Handle
              id="reference-images"
              type="target"
              :position="Position.Left"
              class="script-handle image-handle"
              :style="{ '--handle-top': '279px' }"
            />
            <Handle
              id="storyboard-layout"
              type="source"
              :position="Position.Right"
              class="script-handle shot-handle"
              :style="{ '--handle-top': '249px' }"
            />
          </div>
        </template>

        <template #node-role-card="{ data, selected }">
          <div class="flow-card role-work-card" :class="{ selected }">
            <Handle id="role-out" type="source" :position="Position.Right" class="card-handle role-out" />
            <div class="flow-card-head">
              <UserRound :size="17" />
              <strong>{{ data.title }}</strong>
            </div>
            <div class="flow-card-kicker">{{ data.roleType }}</div>
            <p>{{ data.desc }}</p>
            <div class="tag-row">
              <span v-for="tag in data.tags" :key="tag">{{ tag }}</span>
            </div>
          </div>
        </template>

        <template #node-image-card="{ data, selected }">
          <div class="flow-card image-work-card" :class="{ selected }">
            <Handle id="image-out" type="source" :position="Position.Right" class="card-handle image-out" />
            <div class="flow-card-head">
              <Image :size="17" />
              <strong>{{ data.title }}</strong>
            </div>
            <div class="flow-card-kicker">{{ data.usage }}</div>
            <p>{{ data.desc }}</p>
          </div>
        </template>

        <template #node-shot-node="{ data, selected }">
          <div class="flow-card shot-work-card" :class="{ selected }">
            <Handle id="shot-out" type="source" :position="Position.Right" class="card-handle shot-out" />
            <div class="flow-card-head">
              <Clapperboard :size="17" />
              <strong>{{ data.title }}</strong>
            </div>
            <div class="flow-card-kicker">分镜镜头</div>
            <p>{{ data.desc }}</p>
          </div>
        </template>

        <template #node-master-output-node="{ data, selected }">
          <div class="flow-card master-output-card" :class="{ selected }">
            <Handle id="master-in" type="target" :position="Position.Left" class="card-handle master-in" />
            <div class="flow-card-head">
              <Video :size="17" />
              <strong>{{ data.title }}</strong>
            </div>
            <div class="flow-card-kicker">最终输出</div>
            <p>{{ data.desc }}</p>
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
              <strong>{{ data.title }}</strong>
            </div>
            <div class="flow-card-kicker">分镜列表</div>
            <p>{{ data.desc }}</p>
            <div class="shot-list">
              <div
                v-for="shot in layoutShotItems(id, data)"
                :key="shot.id"
                class="shot-row"
                draggable="true"
                @dragstart="startShotDrag(id, shot.id)"
                @dragover.prevent
                @drop="dropShot(id, shot.id)"
              >
                <GripVertical :size="13" />
                <span>{{ shot.title }}</span>
                <em>{{ shot.desc }}</em>
              </div>
              <div v-if="!layoutShotItems(id, data).length" class="shot-empty">将分镜节点接入这里</div>
              </div>
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
        <button @click="openScriptNodeDialog"><FileText :size="14" /> 新建剧情</button>
        <button @click="addRoleCard"><UserRound :size="14" /> 添加角色</button>
        <button @click="addImageCard"><Image :size="14" /> 图片节点</button>
        <button @click="addShotNode"><Clapperboard :size="14" /> 分镜节点</button>
        <button @click="addStoryboardLayout"><Clapperboard :size="14" /> 分镜排布</button>
        <button @click="addMasterOutputNode"><Video :size="14" /> 总镜头输出节点</button>
        <div class="context-separator" />
        <button v-if="canDeleteContext" class="danger" @click="deleteContextNodes">
          <Trash2 :size="14" /> 删除{{ selectedCount > 1 ? ` ${selectedCount} 个` : '' }}
        </button>
        <button @click="fitCanvas"><LocateFixed :size="14" /> 适配视图</button>
        <button @click="resetViewport"><RotateCcw :size="14" /> 重置视图</button>
        <button @click="clearSelection"><MousePointer2 :size="14" /> 清空选择</button>
      </div>
    </main>

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
}
.project-flow :deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: var(--brand-color);
  stroke-dasharray: 9 7;
  animation: flow-light 0.65s linear infinite;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--brand-color) 72%, transparent));
}
.project-flow :deep(.vue-flow__edge.selected marker path) {
  fill: var(--brand-color);
  stroke: var(--brand-color);
}
.project-flow :deep(.vue-flow__node:not(.script-work-node):not(.role-card-node):not(.image-card-node):not(.storyboard-layout-node):not(.shot-node):not(.master-output-node)) {
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
.project-flow :deep(.vue-flow__node:not(.script-work-node):not(.role-card-node):not(.image-card-node):not(.storyboard-layout-node):not(.shot-node):not(.master-output-node)::after) {
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
.project-flow :deep(.master-output-node) {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}
.project-flow :deep(.script-work-node) {
  width: 360px;
}
.project-flow :deep(.role-card-node) {
  width: 250px;
}
.project-flow :deep(.image-card-node) {
  width: 250px;
}
.project-flow :deep(.storyboard-layout-node) {
  width: 320px;
}
.project-flow :deep(.shot-node) {
  width: 260px;
}
.project-flow :deep(.master-output-node) {
  width: 280px;
}

.script-card {
  position: relative;
  width: 360px;
  padding: 14px 18px 44px;
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
  height: 118px;
  padding: 8px 9px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-sunken);
}
.preview-title {
  margin-bottom: 5px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.script-content-preview pre {
  max-height: 84px;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 11px;
  line-height: 17px;
  white-space: pre-wrap;
}
.script-port-list {
  position: absolute;
  top: 238px;
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
  left: -5px;
  background: #f59e0b;
}
.project-flow :deep(.image-handle) {
  left: -5px;
  background: #22d3bb;
}
.project-flow :deep(.shot-handle) {
  right: -5px;
  background: #a78bfa;
}
.project-flow :deep(.total-handle) {
  right: -5px;
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
.shot-work-card {
  min-height: 136px;
  border-left: 3px solid #a78bfa;
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
  right: -5px;
  background: #f59e0b;
}
.project-flow :deep(.image-out) {
  right: -5px;
  background: #22d3bb;
}
.project-flow :deep(.shot-out) {
  right: -5px;
  background: #a78bfa;
}
.project-flow :deep(.master-in) {
  left: -5px;
  background: #22c55e;
}
.project-flow :deep(.layout-script-in) {
  top: 78px;
  left: -5px;
  background: #60a5fa;
}
.project-flow :deep(.layout-shot-in) {
  top: 116px;
  left: -5px;
  background: #a78bfa;
}
.project-flow :deep(.master-out) {
  top: auto;
  right: -5px;
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
    stroke-dashoffset: -32;
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
</style>
