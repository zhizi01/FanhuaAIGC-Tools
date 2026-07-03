// AI 服务：OpenAI 兼容请求 + 剧本标准化 / AI生成 / 单集优化
// 保持简单直接，不引入复杂 Agent 框架
import axios from 'axios'
import { appState } from '../store/appState.js'
import { stripCodeFence } from '../utils/markdown.js'

// 根据传入 id / 当前选择 / 默认标记解析出要使用的模型
export function resolveModel(preferredId) {
  const models = appState.settings.models || []
  if (!models.length) throw new Error('请先在设置页添加模型')
  const pick = (id) => (id ? models.find((m) => m.id === id) : null)
  return (
    pick(preferredId) ||
    pick(appState.currentModelId) ||
    models.find((m) => m.isDefault) ||
    models[0]
  )
}

// 把请求错误转换为用户可理解的中文提示
function normalizeError(err, model) {
  if (err.response) {
    const status = err.response.status
    if (status === 401 || status === 403) return 'APIKEY 无效或无权限，请检查模型配置'
    if (status === 404) return '服务地址或模型代码不存在，请检查 Base URL 与模型代码'
    const msg = err.response.data?.error?.message || err.response.statusText || ''
    return `模型服务返回错误（${status}）${msg ? '：' + msg : ''}`
  }
  if (err.code === 'ECONNABORTED') return '请求超时，请检查网络或更换模型'
  if (/Network|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(err.message || '')) {
    return `服务地址不可用，请检查 Base URL：${model?.baseUrl || ''}`
  }
  return err.message || 'AI 请求失败，请重试'
}

// 通用对话补全请求
export async function chatComplete({ modelId, system, user, temperature = 0.7, signal }) {
  const model = resolveModel(modelId)
  if (!model.baseUrl) throw new Error('模型服务地址缺失，请检查模型配置')
  if (!model.apiKey) throw new Error('APIKEY 缺失，请检查模型配置')

  const url = model.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: user })

  try {
    const res = await axios.post(
      url,
      { model: model.modelCode, messages, temperature },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
        timeout: 180000,
        signal,
      },
    )
    const content = res.data?.choices?.[0]?.message?.content
    if (!content || !content.trim()) throw new Error('模型未返回内容，请重试或更换模型')
    return content
  } catch (err) {
    throw new Error(normalizeError(err, model))
  }
}

const STANDARDIZE_SYSTEM = `你是一个专业的漫剧剧本整理与合规检测助手。你需要先判断用户提供的内容是否适合作为漫剧剧本创作素材，再将内容整理为规范化 Markdown。

要求：
1. 只能返回 Markdown，不要返回 JSON，不要用代码块包裹结果。
2. 必须按照用户要求的集数和每集秒数拆分。
3. 保留原始剧情主线，不要随意改变核心人物关系和关键事件。
4. 如果发现风险内容，在"合规检测"部分列出风险提示和修改建议。
5. 如果内容无法处理，返回"合规检测：不通过"，说明拒绝原因，不生成分集正文。
6. 分集标题必须使用"## 第1集：标题""## 第2集：标题"这种格式。
7. 分集数量必须等于 targetEpisodeCount，除非合规检测不通过。`

const GENERATE_SYSTEM = `你是一个专业漫剧编剧，擅长把创意扩展为适合短视频漫剧表达的分集剧本。你必须返回规范化 Markdown。`

// 剧本合规检测 + 格式标准化（对应上传剧本流程）
export async function standardizeScript({
  title,
  targetEpisodeCount,
  episodeDurationSeconds,
  sourceType = 'upload',
  rawText,
  modelId,
  signal,
}) {
  const user = `请对以下剧本内容进行合规检测和格式标准化。

剧本标题：${title}
目标集数：${targetEpisodeCount}
每集秒数：${episodeDurationSeconds}
来源类型：${sourceType}

请返回规范化 Markdown，必须包含以下结构：
# 剧本标题
## 基础信息
## 合规检测
## 故事总览
## 主要角色
## 整理说明
## 分集剧本
## 第1集：本集标题
## 第2集：本集标题
...

每一集必须包含：
- 时长
- 本集梗概
- 开场钩子
- 结尾悬念
- 至少一个场景
- 角色动作
- 旁白
- 对白
- 画面提示

原始剧本文本：
${rawText}`

  const content = await chatComplete({
    modelId,
    system: STANDARDIZE_SYSTEM,
    user,
    temperature: 0.4,
    signal,
  })
  return stripCodeFence(content)
}

// 根据创意生成整套分集剧本（对应 AI生成流程）
export async function generateScript({
  title,
  genre,
  idea,
  characters,
  worldview,
  targetEpisodeCount,
  episodeDurationSeconds,
  style,
  modelId,
  signal,
}) {
  const user = `请根据以下设定创作一套漫剧剧本。

剧本标题：${title}
类型题材：${genre || '不限'}
一句话创意：${idea}
主要角色：${characters || '（未提供，请合理设计）'}
世界观设定：${worldview || '（未提供，请合理设计）'}
目标集数：${targetEpisodeCount}
每集秒数：${episodeDurationSeconds}
风格要求：${style || '（未提供）'}

要求：
1. 只能返回 Markdown，不要返回 JSON，不要用代码块包裹结果。
2. 分集数量必须等于目标集数。
3. 分集标题必须使用"## 第1集：标题""## 第2集：标题"这种格式。
4. 每集必须包含标题、梗概、开场钩子、结尾悬念和场景。
5. 场景中要包含动作、对白、旁白和画面提示。
6. 内容应适合后续生成分镜、图片和短视频。

请在分集正文之前，先输出：# 剧本标题、## 基础信息、## 故事总览、## 主要角色、## 分集剧本 这些部分。`

  const content = await chatComplete({
    modelId,
    system: GENERATE_SYSTEM,
    user,
    temperature: 0.85,
    signal,
  })
  return stripCodeFence(content)
}

// 对当前单集进行 AI 优化（润色 / 节奏 / 对白 / 画面提示补强）
export async function optimizeEpisode({ episodeMarkdown, instruction, modelId, signal }) {
  const system =
    '你是一个专业漫剧剧本润色助手。你会在保留剧情主线与结构的前提下优化剧本，并且只返回优化后的 Markdown，不要额外解释，不要用代码块包裹结果。'
  const user = `请优化下面这一集漫剧剧本的 Markdown 内容。

优化要求：${instruction || '润色语言、调整节奏、优化对白、补强画面提示'}

约束：
1. 只返回优化后的这一集 Markdown，不要输出其它集。
2. 保留"## 第N集：标题"这一分集标题格式。
3. 保留时长、本集梗概、场景、对白、动作、旁白、画面提示等结构。

原始内容：
${episodeMarkdown}`

  const content = await chatComplete({ modelId, system, user, temperature: 0.6, signal })
  return stripCodeFence(content)
}
