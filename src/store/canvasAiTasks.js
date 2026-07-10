// 画布 AI 任务（Pinia）：分镜生成 / 剧情卡关联角色 在后台运行，切换界面不中断、不丢结果
// 与 aiTasks / roleTasks 一致：AI 调用脱离组件生命周期，结果暂存于 store，回到工程页后再确认写入画布。
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { generateStoryboardShots, identifyEpisodeRoles } from '../services/ai.js'
import { useAppStore } from './appState.js'
import { useUsageStore } from './usage.js'

// 归一化角色名，尽量抹平 AI 识别与角色库之间的细微差异（括号注释、标点、空白、常见前后缀）
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, '') // 去掉“林晚（女主）”里的括号附注
    .replace(/[\s·,，.。、:：;；'"“”‘’!！?？~()（）[\]【】-]/g, '')
}

// 去掉常见称呼前后缀，供二次匹配（如“陈总/老陈/小林”）
function stripAffix(name) {
  return name
    .replace(/^(小|老|阿|大)/, '')
    .replace(/(总|哥|姐|叔|爷|姨|婶|妈|爸|先生|女士|小姐|老师|同学|队长|将军|陛下)$/, '')
}

// 在角色库中匹配 AI 识别出的角色名：精确 -> 互相包含 -> 去缀后再匹配
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

export const useCanvasAiTaskStore = defineStore('canvasAiTask', {
  state: () => ({
    active: false,
    kind: '', // 'storyboard' | 'scriptRole'
    status: 'idle', // idle | running | done | error
    error: '',
    version: 0, // 每次完成/失败自增，供工程页监听并弹出确认
    consumed: false, // 结果是否已被工程页取用（避免重复弹窗）
    projectPath: '',
    // 分镜生成
    layoutId: '',
    clearOld: false,
    shots: [],
    // 剧情卡关联角色
    scriptNodeId: '',
    roleItems: [],
  }),
  getters: {
    // 是否有等待工程页确认的结果
    pendingResult: (s) => s.status === 'done' && !s.consumed && (s.shots.length > 0 || s.roleItems.length > 0),
  },
  actions: {
    _reset(kind) {
      this.active = true
      this.kind = kind
      this.status = 'running'
      this.error = ''
      this.consumed = false
      this.shots = []
      this.roleItems = []
    },

    // ---------- 分镜生成 ----------
    startStoryboard({ projectPath, layoutId, clearOld, episodeTitle, episodeContent }) {
      if (this.active) return { ok: false, reason: '已有画布 AI 任务进行中，请稍候' }
      if (!projectPath || !layoutId) return { ok: false, reason: '缺少工程或分镜排布信息' }
      this._reset('storyboard')
      this.projectPath = projectPath
      this.layoutId = layoutId
      this.clearOld = !!clearOld
      this.scriptNodeId = ''
      this._runStoryboard({ projectPath, episodeTitle, episodeContent })
      return { ok: true }
    },

    async _runStoryboard({ projectPath, episodeTitle, episodeContent }) {
      const usageStore = useUsageStore()
      try {
        const { shots, usage } = await generateStoryboardShots({
          episodeTitle,
          episodeContent,
          modelId: useAppStore().currentModelId,
        })
        await usageStore.add(projectPath, usage)
        this.shots = shots.map((shot, i) => ({
          key: `preview_${Date.now()}_${i}`,
          title: shot.title || `分镜 ${i + 1}`,
          duration: Number(shot.duration) || 0,
          method: shot.method || '',
          prompt: shot.prompt || shot.method || '',
          description: shot.description || '',
        }))
        this.status = 'done'
      } catch (err) {
        this.error = err?.message || String(err)
        this.status = 'error'
      } finally {
        this.active = false
        this.version += 1
      }
    },

    // ---------- 剧情卡关联角色 ----------
    startScriptRole({ projectPath, scriptNodeId, episodeTitle, episodeContent }) {
      if (this.active) return { ok: false, reason: '已有画布 AI 任务进行中，请稍候' }
      if (!projectPath || !scriptNodeId) return { ok: false, reason: '缺少工程或剧情卡信息' }
      this._reset('scriptRole')
      this.projectPath = projectPath
      this.scriptNodeId = scriptNodeId
      this.layoutId = ''
      this.clearOld = false
      this._runScriptRole({ projectPath, episodeTitle, episodeContent })
      return { ok: true }
    },

    async _runScriptRole({ projectPath, episodeTitle, episodeContent }) {
      const usageStore = useUsageStore()
      try {
        const [{ roles, usage }, libraryRoles] = await Promise.all([
          identifyEpisodeRoles({ episodeTitle, episodeContent, modelId: useAppStore().currentModelId }),
          api.roles.list(projectPath),
        ])
        await usageStore.add(projectPath, usage)

        const items = []
        for (let i = 0; i < roles.length; i++) {
          const role = roles[i]
          const summary = findLibraryRole(libraryRoles, role.name)
          // 关键修复：角色库列表只是摘要（缺性格/外观/声线等），匹配到后读取完整角色，避免关联后丢信息
          let full = null
          if (summary?.id) {
            try {
              full = await api.roles.read({ projectPath, roleId: summary.id })
            } catch {
              full = null
            }
          }
          const src = full || summary || {}
          items.push({
            key: `script_role_${Date.now()}_${i}`,
            name: role.name,
            roleType: role.roleType || src.roleType || '',
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
          })
        }
        this.roleItems = items
        this.status = 'done'
      } catch (err) {
        this.error = err?.message || String(err)
        this.status = 'error'
      } finally {
        this.active = false
        this.version += 1
      }
    },

    // 工程页取用分镜结果（取完标记 consumed 并收起浮标）
    consumeStoryboard() {
      const payload = { layoutId: this.layoutId, clearOld: this.clearOld, shots: this.shots }
      this.consumed = true
      this.shots = []
      this.status = 'idle'
      return payload
    },

    // 工程页取用角色结果（取完标记 consumed 并收起浮标）
    consumeScriptRole() {
      const payload = { scriptNodeId: this.scriptNodeId, items: this.roleItems }
      this.consumed = true
      this.roleItems = []
      this.status = 'idle'
      return payload
    },

    // 判断某分镜排布/剧情卡是否正在运行（供卡片按钮 loading）
    isBusy(kind, targetId) {
      if (!this.active || this.kind !== kind) return false
      return kind === 'storyboard' ? this.layoutId === targetId : this.scriptNodeId === targetId
    },

    dismiss() {
      if (this.active) return
      this.status = 'idle'
      this.error = ''
      this.consumed = true
      this.shots = []
      this.roleItems = []
    },
  },
})
