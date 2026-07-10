// 画布生成任务（Pinia）：按卡片（节点）独立、可并发的后台任务
// 每个节点各自维护 running/error 状态，切换界面再回来仍是加载态；成功后直接写入 flowCanvas（画布未保存态由 pinia 管理）。
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { generateStoryboardShots, identifyEpisodeRoles } from '../services/ai.js'
import { useAppStore } from './appState.js'
import { useUsageStore } from './usage.js'
import { useFlowCanvasStore } from './flowCanvas.js'
import { useApprovalStore } from './approvals.js'
import { findLibraryRole, isCharacterRoleCandidate } from '../utils/roles.js'

function roleCover(role) {
  return role?.cover || role?.images?.[0] || ''
}

export const useCanvasTaskStore = defineStore('canvasTask', {
  state: () => ({
    // nodeId -> { kind, status: 'running' | 'error', error, projectPath }
    tasks: {},
  }),
  getters: {
    isRunning: (s) => (nodeId) => s.tasks[nodeId]?.status === 'running',
    errorOf: (s) => (nodeId) => (s.tasks[nodeId]?.status === 'error' ? s.tasks[nodeId].error : ''),
    runningCount: (s) => Object.values(s.tasks).filter((t) => t.status === 'running').length,
  },
  actions: {
    _set(nodeId, patch) {
      this.tasks = { ...this.tasks, [nodeId]: { ...(this.tasks[nodeId] || {}), ...patch } }
    },
    _clear(nodeId) {
      const next = { ...this.tasks }
      delete next[nodeId]
      this.tasks = next
    },
    dismiss(nodeId) {
      if (this.tasks[nodeId]?.status !== 'running') this._clear(nodeId)
    },

    // ---------- 分镜生成 ----------
    startStoryboard({ projectPath, projectName, label, layoutId, episodeTitle, episodeContent, clearOld }) {
      if (this.tasks[layoutId]?.status === 'running') return
      this._set(layoutId, { kind: 'storyboard', status: 'running', error: '', projectPath })
      this._runStoryboard({ projectPath, projectName, label, layoutId, episodeTitle, episodeContent, clearOld })
    },
    async _runStoryboard({ projectPath, projectName, label, layoutId, episodeTitle, episodeContent, clearOld }) {
      try {
        const { shots, usage } = await generateStoryboardShots({
          episodeTitle,
          episodeContent,
          modelId: useAppStore().currentModelId,
        })
        await useUsageStore().add(projectPath, usage)
        if (!shots.length) throw new Error('AI 未生成分镜，请重试')
        // 生成成功后进入审批队列，通过后再写入画布
        useApprovalStore().enqueue({
          kind: 'storyboard',
          nodeId: layoutId,
          projectPath,
          projectName,
          label,
          layoutId,
          clearOld,
          shots: shots.map((shot, i) => ({
            key: `shot_${Date.now()}_${i}`,
            title: shot.title || `分镜 ${i + 1}`,
            duration: Number(shot.duration) || 0,
            method: shot.method || '',
            prompt: shot.prompt || shot.method || '',
            description: shot.description || '',
          })),
        })
        this._clear(layoutId)
      } catch (err) {
        this._set(layoutId, { status: 'error', error: err?.message || String(err) })
      }
    },

    // ---------- 剧情卡关联角色 ----------
    startScriptRole({ projectPath, projectName, label, scriptNodeId, episodeTitle, episodeContent }) {
      if (this.tasks[scriptNodeId]?.status === 'running') return
      this._set(scriptNodeId, { kind: 'scriptRole', status: 'running', error: '', projectPath })
      this._runScriptRole({ projectPath, projectName, label, scriptNodeId, episodeTitle, episodeContent })
    },
    async _runScriptRole({ projectPath, projectName, label, scriptNodeId, episodeTitle, episodeContent }) {
      try {
        const [{ roles, usage }, libraryRoles] = await Promise.all([
          identifyEpisodeRoles({ episodeTitle, episodeContent, modelId: useAppStore().currentModelId }),
          api.roles.list(projectPath),
        ])
        await useUsageStore().add(projectPath, usage)
        if (!roles.length) throw new Error('AI 未识别到参与角色，请重试')
        // 识别 + 匹配（含未匹配项），交给审批队列由用户勾选确认
        const matchableLibraryRoles = libraryRoles.filter(isCharacterRoleCandidate)
        const items = []
        for (let i = 0; i < roles.length; i++) {
          const role = roles[i]
          const summary = findLibraryRole(matchableLibraryRoles, role.name)
          let full = null
          if (summary) {
            try {
              full = await api.roles.read({ projectPath, roleId: summary.id })
            } catch {
              full = null
            }
          }
          const src = full || summary || {}
          items.push({
            key: `role_${Date.now()}_${i}`,
            name: src.name || role.name,
            detectedName: role.name,
            roleType: src.roleType || role.roleType || '',
            note: role.note || '',
            roleId: summary?.id || '',
            matched: Boolean(summary),
            cover: roleCover(src),
            identity: src.identity || '',
            personality: src.personality || '',
            appearance: src.appearance || '',
            gender: src.gender || '',
            age: src.age || '',
            voice: src.voice || '',
            motivation: src.motivation || '',
            voiceLine: src.voiceLine || '',
            images: Array.isArray(src.images) ? [...src.images] : [],
            createdAt: src.createdAt || '',
            updatedAt: src.updatedAt || '',
          })
        }
        useApprovalStore().enqueue({
          kind: 'scriptRole',
          nodeId: scriptNodeId,
          projectPath,
          projectName,
          label,
          scriptNodeId,
          items,
        })
        this._clear(scriptNodeId)
      } catch (err) {
        this._set(scriptNodeId, { status: 'error', error: err?.message || String(err) })
      }
    },

    // ---------- 图片节点：AI 生成 ----------
    startImage({ projectPath, nodeId, model, prompt, references, folder }) {
      if (this.tasks[nodeId]?.status === 'running') return
      this._set(nodeId, { kind: 'image', status: 'running', error: '', projectPath })
      this._runImage({ projectPath, nodeId, model, prompt, references, folder })
    },
    async _runImage({ projectPath, nodeId, model, prompt, references, folder }) {
      try {
        const asset = await api.assets.generateImage({ projectPath, model, prompt, references, folder })
        const ok = useFlowCanvasStore().applyImageResult({ projectPath, nodeId, asset })
        if (!ok) throw new Error('图片节点已不在画布上')
        this._clear(nodeId)
      } catch (err) {
        this._set(nodeId, { status: 'error', error: err?.message || String(err) })
      }
    },
  },
})
