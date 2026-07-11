// 角色参考图任务队列：固定模型严格串行执行，页面切换后仍在 Pinia 中继续。
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { useUsageStore } from './usage.js'

function taskId() {
  return `role_image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const useRoleImageTaskStore = defineStore('roleImageTask', {
  state: () => ({
    queue: [],
    activeTask: null,
    processing: false,
    status: 'idle', // idle | running | done | error
    completedCount: 0,
    failedCount: 0,
    lastError: '',
    lastEvent: null,
    version: 0,
  }),
  getters: {
    pendingCount: (state) => state.queue.length + (state.activeTask ? 1 : 0),
    hasRole: (state) => (roleId) =>
      state.activeTask?.roleId === roleId || state.queue.some((task) => task.roleId === roleId),
    queuedPosition: (state) => (roleId) => {
      if (state.activeTask?.roleId === roleId) return 0
      const index = state.queue.findIndex((task) => task.roleId === roleId)
      return index < 0 ? -1 : index + 1
    },
  },
  actions: {
    enqueue(payload) {
      const roleId = String(payload?.roleId || '').trim()
      const prompt = String(payload?.prompt || '').trim()
      if (!payload?.projectPath || !roleId || !prompt) {
        return { ok: false, reason: '角色图片任务参数不完整' }
      }
      if (this.hasRole(roleId)) {
        return { ok: false, reason: '该角色已有图片生成任务，请等待完成' }
      }

      const startsNewBatch = !this.processing && this.queue.length === 0
      if (startsNewBatch) {
        this.completedCount = 0
        this.failedCount = 0
        this.lastError = ''
        this.lastEvent = null
      }
      const task = {
        id: taskId(),
        projectPath: payload.projectPath,
        projectName: payload.projectName || '',
        roleId,
        roleName: payload.roleName || '未命名角色',
        prompt,
        referenceImages: Array.isArray(payload.referenceImages)
          ? [...payload.referenceImages]
          : [],
        createdAt: new Date().toISOString(),
      }
      this.queue.push(task)
      this.status = 'running'
      void this._drain()
      return { ok: true, taskId: task.id, position: this.pendingCount }
    },

    async _drain() {
      if (this.processing) return
      this.processing = true
      this.status = 'running'
      while (this.queue.length) {
        const task = this.queue.shift()
        this.activeTask = task
        try {
          const result = await api.roles.generateImage({
            projectPath: task.projectPath,
            roleId: task.roleId,
            prompt: task.prompt,
            referenceImages: task.referenceImages,
          })
          await useUsageStore().add(task.projectPath, result?.usage)
          this.completedCount += 1
          this.lastEvent = { ...task, status: 'done', result }
        } catch (err) {
          const error = err?.message || String(err)
          this.failedCount += 1
          this.lastError = error
          this.lastEvent = { ...task, status: 'error', error }
        } finally {
          this.activeTask = null
          this.version += 1
        }
      }
      this.processing = false
      this.status = this.failedCount ? 'error' : 'done'
    },

    dismiss() {
      if (this.processing || this.queue.length) return
      this.status = 'idle'
      this.completedCount = 0
      this.failedCount = 0
      this.lastError = ''
      this.lastEvent = null
    },
  },
})
