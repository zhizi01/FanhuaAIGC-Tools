// 全局 AI 任务状态（Pinia）：生成 / 上传标准化在后台运行，切换界面不丢失，完成后自动写入工程
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'
import { extractTitle } from '../utils/markdown.js'
import { generateScript, standardizeScript } from '../services/ai.js'
import { useAppStore } from './appState.js'
import { useUsageStore } from './usage.js'

export const useAiTaskStore = defineStore('aiTask', {
  state: () => ({
    active: false,
    kind: '', // 'ai' | 'upload'
    title: '',
    projectPath: '',
    projectName: '',
    status: 'idle', // idle | running | done | error
    error: '',
    version: 0, // 每次完成/失败自增，供页面监听刷新
    resultScriptId: null,
    resultProjectPath: '',
  }),
  actions: {
    start({ kind, title, params }) {
      if (this.active) return { ok: false, reason: '已有生成任务在进行中，请等待完成' }
      const appStore = useAppStore()
      const project = appStore.currentProject
      if (!project?.path) return { ok: false, reason: '未打开工程' }

      this.active = true
      this.kind = kind
      this.title = title || '未命名剧本'
      this.projectPath = project.path
      this.projectName = project.name
      this.status = 'running'
      this.error = ''
      this.resultScriptId = null

      // 不 await：任务在 store 内后台运行，脱离任何组件生命周期
      this._run(kind, project.path, params)
      return { ok: true }
    },

    async _run(kind, projectPath, params) {
      const usageStore = useUsageStore()
      try {
        const result = kind === 'ai' ? await generateScript(params) : await standardizeScript(params)
        const md = result.markdown
        await usageStore.add(projectPath, result.usage)
        const script = {
          title: params.title || extractTitle(md, '未命名剧本'),
          sourceType: kind === 'ai' ? 'ai' : 'upload',
          status: '待转化',
          episodeDurationSeconds: params.episodeDurationSeconds,
          complianceResult: '',
          riskLevel: '',
          overview: md,
          episodes: [],
        }
        const meta = await api.scripts.save({ projectPath, script })
        this.resultScriptId = meta.id
        this.resultProjectPath = projectPath
        this.status = 'done'
      } catch (err) {
        this.error = err?.message || String(err)
        this.status = 'error'
      } finally {
        this.active = false
        this.version += 1
      }
    },

    // 关闭状态提示（仅在非运行时）
    dismiss() {
      if (this.active) return
      this.status = 'idle'
      this.error = ''
    },
  },
})
