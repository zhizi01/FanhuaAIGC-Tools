// 角色 AI 任务（Pinia）：AI 补全角色卡 / AI 提取角色在后台运行，切换界面不中断
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { parseExtractedRoles } from '../utils/markdown.js'
import { completeRoleCard, extractRolesFromScript } from '../services/ai.js'
import { useAppStore } from './appState.js'
import { useUsageStore } from './usage.js'

export const useRoleTaskStore = defineStore('roleTask', {
  state: () => ({
    active: false,
    kind: '', // 'complete' | 'extract'
    roleName: '',
    roleId: '',
    status: 'idle', // idle | running | done | error
    error: '',
    version: 0,
    resultRoleId: null,
    // AI 提取角色的结果草稿：完成后暂存于此，等待用户回到角色库确认导入
    extractDrafts: [],
    extractCount: 0,
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
      this.extractDrafts = []
      this.extractCount = 0
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

    // 后台从当前工程剧本提取角色：读取剧本 -> 调模型 -> 解析草稿，全程脱离组件生命周期
    extractRoles({ projectPath }) {
      if (this.active) return { ok: false, reason: '已有角色 AI 任务进行中，请稍候' }
      if (!projectPath) return { ok: false, reason: '未打开工程' }
      this.active = true
      this.kind = 'extract'
      this.roleName = ''
      this.roleId = ''
      this.status = 'running'
      this.error = ''
      this.resultRoleId = null
      this.extractDrafts = []
      this.extractCount = 0
      this._runExtract(projectPath)
      return { ok: true }
    },

    async _runExtract(projectPath) {
      const usageStore = useUsageStore()
      try {
        const list = await api.scripts.list(projectPath)
        if (!list.length) throw new Error('当前工程还没有剧本，请先在剧本库创建')
        const data = await api.scripts.read({ projectPath, scriptId: list[0].id })
        const parts = [data.overview || '']
        ;(data.episodes || []).forEach((e) => parts.push(e.content || ''))
        const scriptText = parts.filter(Boolean).join('\n\n').slice(0, 20000)
        if (!scriptText.trim()) throw new Error('当前剧本没有可用内容')
        const { markdown, usage } = await extractRolesFromScript({
          scriptText,
          modelId: useAppStore().currentModelId,
        })
        usageStore.add(projectPath, usage)
        const drafts = parseExtractedRoles(markdown)
        this.extractDrafts = drafts
        this.extractCount = drafts.length
        this.status = 'done'
      } catch (err) {
        this.error = err?.message || String(err)
        this.status = 'error'
      } finally {
        this.active = false
        this.version += 1
      }
    },

    // 取出提取结果并清空草稿（角色库读取后调用，避免重复弹窗）
    // 注意：保留 extractCount 供浮标继续展示“识别到 N 个角色”，下次任务启动时会重置
    consumeExtract() {
      const drafts = this.extractDrafts
      this.extractDrafts = []
      return drafts
    },

    dismiss() {
      if (this.active) return
      this.status = 'idle'
      this.error = ''
    },
  },
})
