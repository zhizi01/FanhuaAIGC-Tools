// 工程 Flow 幕布状态：跨页面暂存，保存时落到工程目录
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'

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
  },
})
