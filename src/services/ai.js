// AI 服务：OpenAI 兼容请求 + 剧本标准化 / AI生成 / 单集优化
// 统一约束输出格式，并对返回结果做检测，异常时以上下文方式打回让模型重出。
import axios from 'axios'
import { useAppStore } from '../store/appState.js'
import { stripCodeFence } from '../utils/markdown.js'

// 根据传入 id / 当前选择 / 默认标记解析出要使用的模型
export function resolveModel(preferredId) {
  const appStore = useAppStore()
  const models = appStore.settings.models || []
  if (!models.length) throw new Error('请先在设置页添加模型')
  const pick = (id) => (id ? models.find((m) => m.id === id) : null)
  return (
    pick(preferredId) ||
    pick(appStore.currentModelId) ||
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

function ensureModel(model) {
  if (!model.baseUrl) throw new Error('模型服务地址缺失，请检查模型配置')
  if (!model.apiKey) throw new Error('APIKEY 缺失，请检查模型配置')
}

// 底层多轮请求：返回内容与 token 用量
async function chatRequest({ model, messages, temperature = 0.7, signal }) {
  const url = model.baseUrl.replace(/\/+$/, '') + '/chat/completions'
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
  const u = res.data?.usage || {}
  const usage = {
    promptTokens: u.prompt_tokens || 0,
    completionTokens: u.completion_tokens || 0,
    totalTokens: u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0),
  }
  return { content, usage }
}

function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}
function accUsage(target, add) {
  target.promptTokens += add.promptTokens || 0
  target.completionTokens += add.completionTokens || 0
  target.totalTokens += add.totalTokens || 0
}

// 通用单轮对话补全（返回 { content, usage }）
export async function chatComplete({ modelId, system, user, temperature = 0.7, signal }) {
  const model = resolveModel(modelId)
  ensureModel(model)
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: user })
  try {
    return await chatRequest({ model, messages, temperature, signal })
  } catch (err) {
    throw new Error(normalizeError(err, model))
  }
}

// ---------- 输出格式规范与检测 ----------
const FORMAT_SPEC = `输出格式要求（必须严格遵守）：
1. 只返回 Markdown 正文，不要任何解释说明，不要使用代码块围栏包裹。
2. 结构必须且仅包含以下部分，且按此顺序：
# 剧本标题
## 基础信息
## 故事总览
## 主要角色
## 分集剧本
## 第1集：本集标题
## 第2集：本集标题
（依此类推）
3. 分集标题必须使用“## 第N集：标题”格式，N 为阿拉伯数字，从 1 连续递增。
4. 不要输出“合规检测”“整理说明”或任何未在上面列出的小节。
5. 每一集至少包含：时长、本集梗概、开场钩子、结尾悬念，以及至少一个场景（含画面提示、角色动作、旁白、对白）。`

// 检测剧本 Markdown 是否符合约束
export function validateScriptMarkdown(md) {
  const text = String(md || '')
  const problems = []
  if (!/^#[ \t]+\S/m.test(text)) problems.push('缺少一级标题（# 剧本标题）')
  for (const s of ['基础信息', '故事总览', '主要角色', '分集剧本']) {
    if (!new RegExp(`^##[ \\t]+${s}`, 'm').test(text)) problems.push(`缺少「## ${s}」小节`)
  }
  if (!/^##[ \t]*第[ \t]*[0-9０-９零一二两三四五六七八九十百]+[ \t]*集/m.test(text)) {
    problems.push('缺少「## 第N集：标题」格式的分集内容')
  }
  return { ok: problems.length === 0, problems }
}

function buildFixPrompt(problems) {
  return `你上一次的输出不符合格式要求，存在以下问题：
${problems.map((p) => '- ' + p).join('\n')}

请严格按照要求重新输出完整的剧本 Markdown：只包含 # 标题、## 基础信息、## 故事总览、## 主要角色、## 分集剧本 以及“## 第N集：标题”分集正文；不要解释，不要使用代码块围栏。`
}

// 带格式守卫的多轮请求：检测不通过则把上一次输出作为上下文打回重出
async function runWithFormatGuard({ model, system, user, temperature, signal, maxAttempts = 3 }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  const usage = emptyUsage()
  let last = ''
  let check = { ok: false, problems: [] }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res
    try {
      res = await chatRequest({ model, messages, temperature, signal })
    } catch (err) {
      throw new Error(normalizeError(err, model))
    }
    accUsage(usage, res.usage)
    last = stripCodeFence(res.content)
    check = validateScriptMarkdown(last)
    if (check.ok) return { markdown: last, usage, valid: true, problems: [] }

    // 未通过：将模型原始输出与问题作为上下文打回，要求重新输出
    if (attempt < maxAttempts) {
      messages.push({ role: 'assistant', content: res.content })
      messages.push({ role: 'user', content: buildFixPrompt(check.problems) })
    }
  }
  // 多次仍未完全达标：返回最后一次结果（内容不丢失，交由总览/源码修正）
  return { markdown: last, usage, valid: false, problems: check.problems }
}

const GENERATE_SYSTEM = `你是一个专业漫剧编剧，擅长把创意扩展为适合短视频漫剧表达的分集剧本。

${FORMAT_SPEC}`

const STANDARDIZE_SYSTEM = `你是一个专业漫剧剧本整理助手，负责把用户提供的素材整理为规范化的分集漫剧剧本。请保留原始剧情主线与关键人物关系，不要随意改动核心事件。

${FORMAT_SPEC}`

// 剧本格式标准化（对应上传剧本流程）
export async function standardizeScript({
  title,
  targetEpisodeCount,
  episodeDurationSeconds,
  rawText,
  modelId,
  signal,
}) {
  const model = resolveModel(modelId)
  ensureModel(model)
  const user = `请把下面的原始内容整理为规范化的分集漫剧剧本。

剧本标题：${title}
目标集数：${targetEpisodeCount}
每集秒数：${episodeDurationSeconds}
分集数量必须等于目标集数。

原始内容：
${rawText}`

  return await runWithFormatGuard({ model, system: STANDARDIZE_SYSTEM, user, temperature: 0.4, signal })
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
  const model = resolveModel(modelId)
  ensureModel(model)
  const user = `请根据以下设定创作一套分集漫剧剧本。

剧本标题：${title}
类型题材：${genre || '不限'}
一句话创意：${idea}
主要角色：${characters || '（未提供，请合理设计）'}
世界观设定：${worldview || '（未提供，请合理设计）'}
目标集数：${targetEpisodeCount}（分集数量必须等于该值）
每集秒数：${episodeDurationSeconds}
风格要求：${style || '（未提供）'}

内容应适合后续生成分镜、图片与短视频。`

  return await runWithFormatGuard({ model, system: GENERATE_SYSTEM, user, temperature: 0.85, signal })
}

// 对当前单集进行 AI 优化（返回 { markdown, usage }）
export async function optimizeEpisode({ episodeMarkdown, instruction, modelId, signal }) {
  const system =
    '你是一个专业漫剧剧本润色助手。你会在保留剧情主线与结构的前提下优化剧本，并且只返回优化后的 Markdown，不要额外解释，不要用代码块包裹结果。'
  const user = `请优化下面这一集漫剧剧本的 Markdown 内容。

优化要求：${instruction || '润色语言、调整节奏、优化对白、补强画面提示'}

约束：
1. 只返回优化后的这一集 Markdown，不要输出其它集。
2. 保留“## 第N集：标题”这一分集标题格式。
3. 保留时长、本集梗概、场景、对白、动作、旁白、画面提示等结构。

原始内容：
${episodeMarkdown}`

  const { content, usage } = await chatComplete({ modelId, system, user, temperature: 0.6, signal })
  return { markdown: stripCodeFence(content), usage }
}
