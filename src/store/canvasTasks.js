// 画布生成任务（Pinia）：按卡片（节点）独立、可并发的后台任务
// 每个节点各自维护 running/error 状态，切换界面再回来仍是加载态；成功后直接写入 flowCanvas（画布未保存态由 pinia 管理）。
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { generateStoryboardShots, identifyEpisodeRoles } from '../services/ai.js'
import { useAppStore } from './appState.js'
import { useUsageStore } from './usage.js'
import { useFlowCanvasStore } from './flowCanvas.js'

// 归一化角色名，抹平括注/标点/空白差异
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, '')
    .replace(/[\s·,，.。、:：;；'"“”‘’!！?？~()（）[\]【】-]/g, '')
}
function stripAffix(name) {
  return name
    .replace(/^(小|老|阿|大)/, '')
    .replace(/(总|哥|姐|叔|爷|姨|婶|妈|爸|先生|女士|小姐|老师|同学|队长|将军|陛下)$/, '')
}
function findLibraryRole(libraryRoles, name) {
  const target = normalizeName(name)
  if (!target) return null
  const list = libraryRoles.map((r) => ({ role: r, key: normalizeName(r.name) })).filter((x) => x.key)
  const exact = list.find((x) => x.key === target)
  if (exact) return exact.role
  const contain = list.find((x) => {
    const short = x.key.length <= target.length ? x.key : target
    return short.length >= 2 && (x.key.includes(target) || target.includes(x.key))
  })
  if (contain) return contain.role
  const t2 = stripAffix(target)
  if (t2 && t2 !== target) {
    const affix = list.find((x) => {
      const k2 = stripAffix(x.key)
      if (!k2) return false
      if (k2 === t2) return true
      const short = k2.length <= t2.length ? k2 : t2
      return short.length >= 2 && (k2.includes(t2) || t2.includes(k2))
    })
    if (affix) return affix.role
  }
  return null
}
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
    startStoryboard({ projectPath, layoutId, episodeTitle, episodeContent, clearOld }) {
      if (this.tasks[layoutId]?.status === 'running') return
      this._set(layoutId, { kind: 'storyboard', status: 'running', error: '', projectPath })
      this._runStoryboard({ projectPath, layoutId, episodeTitle, episodeContent, clearOld })
    },
    async _runStoryboard({ projectPath, layoutId, episodeTitle, episodeContent, clearOld }) {
      try {
        const { shots, usage } = await generateStoryboardShots({
          episodeTitle,
          episodeContent,
          modelId: useAppStore().currentModelId,
        })
        await useUsageStore().add(projectPath, usage)
        if (!shots.length) throw new Error('AI 未生成分镜，请重试')
        const ok = useFlowCanvasStore().applyStoryboardResult({ projectPath, layoutId, shots, clearOld })
        if (!ok) throw new Error('分镜排布卡片已不在画布上')
        this._clear(layoutId)
      } catch (err) {
        this._set(layoutId, { status: 'error', error: err?.message || String(err) })
      }
    },

    // ---------- 剧情卡关联角色 ----------
    startScriptRole({ projectPath, scriptNodeId, episodeTitle, episodeContent }) {
      if (this.tasks[scriptNodeId]?.status === 'running') return
      this._set(scriptNodeId, { kind: 'scriptRole', status: 'running', error: '', projectPath })
      this._runScriptRole({ projectPath, scriptNodeId, episodeTitle, episodeContent })
    },
    async _runScriptRole({ projectPath, scriptNodeId, episodeTitle, episodeContent }) {
      try {
        const [{ roles, usage }, libraryRoles] = await Promise.all([
          identifyEpisodeRoles({ episodeTitle, episodeContent, modelId: useAppStore().currentModelId }),
          api.roles.list(projectPath),
        ])
        await useUsageStore().add(projectPath, usage)
        if (!roles.length) throw new Error('AI 未识别到参与角色，请重试')
        const items = []
        for (let i = 0; i < roles.length; i++) {
          const role = roles[i]
          const summary = findLibraryRole(libraryRoles, role.name)
          if (!summary) continue // 只自动关联能匹配到角色库的角色
          let full = null
          try {
            full = await api.roles.read({ projectPath, roleId: summary.id })
          } catch {
            full = null
          }
          const src = full || summary
          items.push({
            name: role.name,
            roleType: role.roleType || src.roleType || '',
            roleId: summary.id,
            cover: roleCover(src),
            identity: src.identity || '',
            personality: src.personality || '',
            appearance: src.appearance || '',
            gender: src.gender || '',
            age: src.age || '',
            voice: src.voice || '',
          })
        }
        if (!items.length) throw new Error('未匹配到角色库中的角色，请先在角色库创建对应角色')
        const ok = useFlowCanvasStore().applyScriptRoleResult({ projectPath, scriptNodeId, items })
        if (!ok) throw new Error('所选角色均已关联，或剧情卡已不在画布上')
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
