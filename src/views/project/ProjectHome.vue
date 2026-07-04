<script setup>
// 工程页：Vue Flow 画布工作台
// 中键拖动画布、左键框选、右键菜单；四边卡尺 + 小地图 + 缩放率。
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import { Crosshair, FolderKanban, LocateFixed, MousePointer2, Plus, RotateCcw, ZoomIn } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'

const appStore = useAppStore()
const project = computed(() => appStore.currentProject || {})

const flowId = 'project-workbench-flow'
const flowWrap = ref(null)
const flowInstance = ref(null)

const viewport = reactive({ x: 0, y: 0, zoom: 1 })
const canvasSize = reactive({ width: 1000, height: 700 })

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  flowX: 0,
  flowY: 0,
  target: 'pane',
  nodeId: '',
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

const nodes = ref([
  {
    id: 'script',
    type: 'input',
    label: '剧本库',
    position: { x: 80, y: 120 },
    class: 'flow-node script-node',
    data: { desc: '分集剧本 / Markdown' },
  },
  {
    id: 'roles',
    label: '角色库',
    position: { x: 360, y: 40 },
    class: 'flow-node role-node',
    data: { desc: '角色卡 / 外观 / 声线' },
  },
  {
    id: 'assets',
    label: '资产库',
    position: { x: 360, y: 210 },
    class: 'flow-node asset-node',
    data: { desc: '图片 / 音频 / 文档' },
  },
  {
    id: 'storyboard',
    label: '分镜规划',
    position: { x: 660, y: 125 },
    class: 'flow-node plan-node',
    data: { desc: '后续阶段' },
  },
  {
    id: 'export',
    type: 'output',
    label: '导出',
    position: { x: 940, y: 125 },
    class: 'flow-node export-node',
    data: { desc: 'Markdown / 素材包' },
  },
])

const edges = ref([
  { id: 'script-roles', source: 'script', target: 'roles', animated: true },
  { id: 'script-assets', source: 'script', target: 'assets', animated: true },
  { id: 'roles-storyboard', source: 'roles', target: 'storyboard' },
  { id: 'assets-storyboard', source: 'assets', target: 'storyboard' },
  { id: 'storyboard-export', source: 'storyboard', target: 'export' },
])

const selectedCount = computed(() => nodes.value.filter((n) => n.selected).length)
const zoomPercent = computed(() => `${Math.round(viewport.zoom * 100)}%`)

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
  Object.assign(contextMenu, {
    visible: true,
    x: point.x,
    y: point.y,
    flowX: point.flowX,
    flowY: point.flowY,
    target: 'node',
    nodeId: payload.node?.id || '',
  })
}

function closeMenu() {
  contextMenu.visible = false
}

function beginBoxSelect(event) {
  if (event.button !== 0) return
  if (event.target.closest?.('.vue-flow__node, .context-menu, .ruler, .zoom-badge')) return
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
  nodes.value = nodes.value.map((node) => {
    const nodeLeft = node.position.x * viewport.zoom + viewport.x
    const nodeTop = node.position.y * viewport.zoom + viewport.y
    const nodeRight = nodeLeft + 170 * viewport.zoom
    const nodeBottom = nodeTop + 64 * viewport.zoom
    const selected =
      nodeRight >= selection.left &&
      nodeLeft <= selection.right &&
      nodeBottom >= selection.top &&
      nodeTop <= selection.bottom &&
      boxSelect.width > 3 &&
      boxSelect.height > 3
    return { ...node, selected }
  })
  boxSelect.active = false
}

function addFlowNode() {
  const id = `node_${Date.now()}`
  nodes.value.push({
    id,
    label: '新节点',
    position: { x: contextMenu.flowX, y: contextMenu.flowY },
    class: 'flow-node custom-node',
    data: { desc: '右键创建' },
  })
  closeMenu()
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
  closeMenu()
}

function updateCanvasSize() {
  const rect = flowWrap.value?.getBoundingClientRect()
  if (!rect) return
  canvasSize.width = rect.width
  canvasSize.height = rect.height
}

let resizeObserver = null
onMounted(() => {
  updateCanvasSize()
  resizeObserver = new ResizeObserver(updateCanvasSize)
  if (flowWrap.value) resizeObserver.observe(flowWrap.value)
  window.addEventListener('click', closeMenu)
})

onBeforeUnmount(() => {
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
      >
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
        <button @click="addFlowNode"><Plus :size="14" /> 新增流程节点</button>
        <button @click="fitCanvas"><LocateFixed :size="14" /> 适配视图</button>
        <button @click="resetViewport"><RotateCcw :size="14" /> 重置视图</button>
        <button @click="clearSelection"><MousePointer2 :size="14" /> 清空选择</button>
      </div>
    </main>
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
  stroke-width: 1.5;
}
.project-flow :deep(.vue-flow__edge.animated path) {
  stroke: var(--brand-color);
}
.project-flow :deep(.vue-flow__node) {
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
.project-flow :deep(.vue-flow__node::after) {
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
.project-flow :deep(.script-node) {
  border-left: 3px solid #60a5fa;
}
.project-flow :deep(.role-node) {
  border-left: 3px solid #f59e0b;
}
.project-flow :deep(.asset-node) {
  border-left: 3px solid #22d3bb;
}
.project-flow :deep(.plan-node) {
  border-left: 3px solid #a78bfa;
}
.project-flow :deep(.export-node) {
  border-left: 3px solid #34d399;
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
  width: 168px;
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
</style>
