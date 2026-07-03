// 全局 AI 任务状态：生成 / 上传标准化在后台运行，切换界面不丢失，完成后自动写入工程
import { reactive } from 'vue'
import { api } from '../services/bridge.js'
import { extractTitle } from '../utils/markdown.js'
import { generateScript, standardizeScript } from '../services/ai.js'
import { appState } from './appState.js'
import { addUsage } from './usage.js'

export const aiTask = reactive({
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
})

// 是否有任务正在为指定工程运行
export function isTaskRunningFor(projectPath) {
  return aiTask.active && aiTask.projectPath === projectPath
}

export function startScriptTask({ kind, title, params }) {
  if (aiTask.active) return { ok: false, reason: '已有生成任务在进行中，请等待完成' }
  const project = appState.currentProject
  if (!project?.path) return { ok: false, reason: '未打开工程' }

  aiTask.active = true
  aiTask.kind = kind
  aiTask.title = title || '未命名剧本'
  aiTask.projectPath = project.path
  aiTask.projectName = project.name
  aiTask.status = 'running'
  aiTask.error = ''
  aiTask.resultScriptId = null

  // 不 await：任务在模块作用域内后台运行，脱离任何组件生命周期
  runTask(kind, project.path, params)
  return { ok: true }
}

async function runTask(kind, projectPath, params) {
  try {
    const result = kind === 'ai' ? await generateScript(params) : await standardizeScript(params)
    const md = result.markdown
    // 记录 token 用量到该工程
    await addUsage(projectPath, result.usage)
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
    aiTask.resultScriptId = meta.id
    aiTask.resultProjectPath = projectPath
    aiTask.status = 'done'
  } catch (err) {
    aiTask.error = err?.message || String(err)
    aiTask.status = 'error'
  } finally {
    aiTask.active = false
    aiTask.version += 1
  }
}

// 关闭状态提示（仅在非运行时）
export function dismissAiTask() {
  if (aiTask.active) return
  aiTask.status = 'idle'
  aiTask.error = ''
}
