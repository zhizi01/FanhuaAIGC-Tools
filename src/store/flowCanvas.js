// 工程 Flow 幕布状态：跨页面暂存，保存时落到工程目录
// 未保存时画布以本 store 为准，后台生成任务可直接写入（即便工程页已卸载也能更新）。
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { makeEdge, gridBaseX, gridPosition } from '../utils/flow.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export const useFlowCanvasStore = defineStore('flowCanvas', {
  state: () => ({
    projectPath: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    dirty: false,
    loadedFromDisk: false,
    savedAt: '',
    rev: 0, // 后台任务写入画布时自增，供工程页在挂载时同步本地渲染
  }),
  actions: {
    hasProject(projectPath) {
      return !!projectPath && this.projectPath === projectPath && (this.loadedFromDisk || this.dirty || this.nodes.length || this.edges.length)
    },
    setProject(projectPath) {
      if (this.projectPath !== projectPath) {
        this.projectPath = projectPath || ''
        this.nodes = []
        this.edges = []
        this.viewport = { x: 0, y: 0, zoom: 1 }
        this.dirty = false
        this.loadedFromDisk = false
        this.savedAt = ''
      }
    },
    setCanvas(projectPath, canvas, markDirty = false) {
      this.projectPath = projectPath || ''
      this.nodes = clone(canvas?.nodes || [])
      this.edges = clone(canvas?.edges || [])
      this.viewport = clone(canvas?.viewport || { x: 0, y: 0, zoom: 1 })
      this.savedAt = canvas?.savedAt || ''
      this.loadedFromDisk = true
      this.dirty = markDirty
    },
    syncDraft(projectPath, canvas) {
      this.projectPath = projectPath || ''
      this.nodes = clone(canvas?.nodes || [])
      this.edges = clone(canvas?.edges || [])
      this.viewport = clone(canvas?.viewport || { x: 0, y: 0, zoom: 1 })
    },
    markDirty() {
      this.dirty = true
    },
    discard(projectPath) {
      if (!projectPath || this.projectPath === projectPath) {
        this.nodes = []
        this.edges = []
        this.viewport = { x: 0, y: 0, zoom: 1 }
        this.dirty = false
        this.loadedFromDisk = false
        this.savedAt = ''
        if (projectPath) this.projectPath = projectPath
      }
    },
    async load(projectPath) {
      this.setProject(projectPath)
      const saved = await api.flow.read(projectPath)
      if (saved) {
        this.setCanvas(projectPath, saved, false)
      }
      return saved
    },
    async save(projectPath, canvas) {
      const saved = await api.flow.save({ projectPath, canvas: clone(canvas) })
      this.setCanvas(projectPath, saved, false)
      return saved
    },
    async saveCurrent() {
      if (!this.projectPath) return null
      return this.save(this.projectPath, {
        nodes: this.nodes,
        edges: this.edges,
        viewport: this.viewport,
      })
    },

    // ---------- 后台生成任务：直接写入画布（未保存态） ----------
    // 分镜生成结果：可选清理旧关联分镜，再按每行 5 个网格接入新的分镜卡
    applyStoryboardResult({ projectPath, layoutId, shots, clearOld }) {
      if (this.projectPath !== projectPath) return false
      const layout = this.nodes.find((n) => n.id === layoutId)
      if (!layout || !Array.isArray(shots) || !shots.length) return false
      let nodes = this.nodes
      let edges = this.edges
      if (clearOld) {
        const oldIds = new Set(
          edges.filter((e) => e.target === layoutId && e.targetHandle === 'layout-shot-in').map((e) => e.source),
        )
        nodes = nodes.filter((n) => !oldIds.has(n.id))
        edges = edges.filter(
          (e) =>
            !oldIds.has(e.source) &&
            !oldIds.has(e.target) &&
            !(e.target === layoutId && e.targetHandle === 'layout-shot-in'),
        )
      }
      const baseX = gridBaseX(layout.position?.x || 0, shots.length, 280, 330)
      const baseY = layout.position?.y || 0
      const startNo = nodes.filter((n) => n.type === 'shot-node').length + 1
      const stamp = Date.now()
      const newNodes = []
      const newEdges = []
      const newIds = []
      shots.forEach((shot, i) => {
        const id = `shot_node_${stamp}_${i}`
        newIds.push(id)
        newNodes.push({
          id,
          type: 'shot-node',
          position: gridPosition(baseX, baseY, i, 330, 400),
          class: 'shot-node',
          data: {
            title: shot.title || `分镜 ${startNo + i}`,
            shotNo: startNo + i,
            duration: Number(shot.duration) || 0,
            method: shot.method || '',
            prompt: shot.prompt || shot.method || '',
            description: shot.description || '',
            image: '',
            fromAi: true,
          },
        })
        newEdges.push(
          makeEdge(`edge_${id}_shot-out_${layoutId}_layout-shot-in_${stamp}_${i}`, id, layoutId, {
            sourceHandle: 'shot-out',
            targetHandle: 'layout-shot-in',
          }),
        )
      })
      this.nodes = [
        ...nodes.map((n) =>
          n.id === layoutId
            ? {
                ...n,
                data: {
                  ...n.data,
                  shotOrder: newIds,
                  aiGeneratedShotIds: newIds,
                  lastAiGeneratedAt: new Date().toISOString(),
                },
              }
            : n,
        ),
        ...newNodes,
      ]
      this.edges = [...edges, ...newEdges]
      this.dirty = true
      this.rev += 1
      return true
    },

    // 关联角色结果：把已匹配角色库的角色接到剧情卡（已有卡片直接连线，避免重复）
    applyScriptRoleResult({ projectPath, scriptNodeId, items }) {
      if (this.projectPath !== projectPath) return false
      const scriptNode = this.nodes.find((n) => n.id === scriptNodeId)
      if (!scriptNode || !Array.isArray(items) || !items.length) return false
      const linkedIds = new Set(
        this.edges
          .filter((e) => e.target === scriptNodeId && e.targetHandle === 'cast-roles')
          .map((e) => this.nodes.find((n) => n.id === e.source))
          .filter((n) => n?.type === 'role-card' && n.data?.roleId)
          .map((n) => n.data.roleId),
      )
      const existingByRoleId = new Map(
        this.nodes.filter((n) => n.type === 'role-card' && n.data?.roleId).map((n) => [n.data.roleId, n]),
      )
      const toPlace = items.filter((it) => !linkedIds.has(it.roleId) && !existingByRoleId.has(it.roleId)).length
      const baseX = gridBaseX(scriptNode.position?.x || 0, toPlace, 280, 330)
      const baseY = scriptNode.position?.y || 0
      const stamp = Date.now()
      const newNodes = []
      const newEdges = []
      let placed = 0
      items.forEach((it, i) => {
        if (!it.roleId || linkedIds.has(it.roleId)) return
        let roleNode = existingByRoleId.get(it.roleId)
        if (!roleNode) {
          const id = `role_card_${stamp}_${i}`
          roleNode = {
            id,
            type: 'role-card',
            position: gridPosition(baseX, baseY, placed++, 330, 280),
            class: 'role-card-node',
            data: {
              title: it.name || '未命名角色',
              roleId: it.roleId,
              roleType: it.roleType || '角色',
              gender: it.gender || '',
              age: it.age || '',
              identity: it.identity || '',
              personality: it.personality || '',
              appearance: it.appearance || '',
              voice: it.voice || '',
              cover: it.cover || '',
              desc: it.identity || it.personality || it.appearance || '已绑定角色库角色。',
            },
          }
          newNodes.push(roleNode)
          existingByRoleId.set(it.roleId, roleNode)
        }
        newEdges.push(
          makeEdge(`edge_${roleNode.id}_role-out_${scriptNodeId}_cast-roles_${stamp}_${i}`, roleNode.id, scriptNodeId, {
            sourceHandle: 'role-out',
            targetHandle: 'cast-roles',
          }),
        )
        linkedIds.add(it.roleId)
      })
      if (!newNodes.length && !newEdges.length) return false
      this.nodes = [...this.nodes, ...newNodes]
      this.edges = [...this.edges, ...newEdges]
      this.dirty = true
      this.rev += 1
      return true
    },

    // AI 生成图片结果：把占位图片卡更新为生成好的资产
    applyImageResult({ projectPath, nodeId, asset }) {
      if (this.projectPath !== projectPath) return false
      const node = this.nodes.find((n) => n.id === nodeId)
      if (!node || !asset) return false
      this.nodes = this.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                assetId: asset.id,
                file: asset.file || '',
                thumbnail: asset.thumbnail || asset.file || '',
                folder: asset.folder || 'AI生成',
                title: n.data.title || asset.name || 'AI生成图片',
                generating: false,
                desc: n.data.prompt ? `AI 生成：${n.data.prompt}` : '已生成图片。',
              },
            }
          : n,
      )
      this.dirty = true
      this.rev += 1
      return true
    },
  },
})
