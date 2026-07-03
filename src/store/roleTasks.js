// 角色 AI 任务（Pinia）：AI 补全角色卡在后台运行，不阻塞界面
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { parseExtractedRoles } from '../utils/markdown.js'
import { completeRoleCard } from '../services/ai.js'
import { useAppStore } from './appState.js'
import { useUsageStore } from './usage.js'

export const useRoleTaskStore = defineStore('roleTask', {
  state: () => ({
    active: false,
    kind: '', // 'complete'
    roleName: '',
    roleId: '',
    status: 'idle', // idle | running | done | error
    error: '',
    version: 0,
    resultRoleId: null,
  }),
  actions: {
    completeRole({ projectPath, role, scriptText }) {
      if (this.active) return { ok: false, reason: '已有角色 AI 任务进行中，请稍候' }
      if (!projectPath || !role?.id) return { ok: false, reason: '角色数据不完整' }
      this.active = true
      this.kind = 'complete'
      this.roleName = role.name
      this.roleId = role.id
      this.status = 'running'
      this.error = ''
      this.resultRoleId = null
      this._runComplete(projectPath, role, scriptText)
      return { ok: true }
    },

    async _runComplete(projectPath, role, scriptText) {
      const usageStore = useUsageStore()
      try {
        const { markdown, usage } = await completeRoleCard({
          role,
          scriptText,
          modelId: useAppStore().currentModelId,
        })
        usageStore.add(projectPath, usage)
        const d = parseExtractedRoles(markdown)[0] || {}
        // 合并：空字段用模型补全，已填字段保留；标签取并集
        const merged = {
          ...role,
          roleType: role.roleType || d.roleType || '配角',
          gender: role.gender || d.gender || '',
          age: role.age || d.age || '',
          identity: role.identity || d.identity || '',
          personality: role.personality || d.personality || '',
          motivation: role.motivation || d.motivation || '',
          appearance: role.appearance || d.appearance || '',
          voice: role.voice || d.voice || '',
          voiceLine: role.voiceLine || d.voiceLine || '',
          tags: Array.from(new Set([...(role.tags || []), ...(d.tags || [])])),
        }
        const meta = await api.roles.save({ projectPath, role: merged })
        this.resultRoleId = meta.id
        this.status = 'done'
      } catch (err) {
        this.error = err?.message || String(err)
        this.status = 'error'
      } finally {
        this.active = false
        this.version += 1
      }
    },

    dismiss() {
      if (this.active) return
      this.status = 'idle'
      this.error = ''
    },
  },
})
