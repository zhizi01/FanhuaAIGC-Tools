// AI 服务：OpenAI 兼容请求 + 剧本标准化 / AI生成 / 单集优化
// 统一约束输出格式，并对返回结果做检测，异常时以上下文方式打回让模型重出。
import axios from 'axios'
import { useAppStore } from '../store/appState.js'
import { stripCodeFence } from '../utils/markdown.js'
import { sanitizeRoleCandidates } from '../utils/roles.js'

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
5. 每一集至少包含：时长、本集梗概、开场钩子、结尾悬念，以及至少一个场景（含画面提示、角色动作、旁白、对白）。
6. “## 主要角色”只列真实人物；旁白、画外音、解说、内心独白、心声、OS 不是角色，“角色名（内心）”必须归并到本人。`

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

const EXTRACT_ROLES_SYSTEM = `你是一个专业的漫剧角色设定助手。请从提供的剧本内容中提取主要角色，并自动补全角色卡信息，输出规范化 Markdown。

工作重点：
1. 不是只做名单提取，而是要形成可直接用于后续分镜、图片生成、配音和视频生成的角色卡。
2. 外观设定、性格、说话方式、声线是关键字段，必须尽量具体、稳定、可复用。
3. 外观设定要包含发型、脸部/体态特征、服装风格、辨识物、气质，不要只写“漂亮”“帅气”。
4. 性格要结合行为动机和剧情表现，不要只写泛泛的形容词。
5. 说话方式描述语言习惯、语速、句式、情绪表达方式。
6. 声线要写成供配音/视频模型使用的声音描述，例如音色、年龄感、语速、气息、情绪质感。
7. 剧本没有明说但能合理推断的信息可以补全，但不要杜撰剧本中完全不存在的主要角色。
8. 旁白、画外音、解说、内心独白、心声、OS 都是叙事/台词形式，不是独立角色，禁止为它们创建角色卡。
9. “角色名（内心）”“角色名-独白”“角色名OS”等称呼必须合并到该角色本人，不能另建角色。

输出格式要求（必须严格遵守）：
1. 只返回 Markdown，不要额外解释，不要用代码块围栏包裹。
2. 每个角色使用“## 角色：角色名”作为标题。
3. 每个角色下用无序列表给出以下字段（没有的可留空）：
- 角色定位：主角/配角/反派/路人
- 性别：
- 年龄：
- 身份：
- 性格：
- 核心动机：
- 外观设定：
- 说话方式：
- 声线：
- 出现集数：用逗号分隔的阿拉伯数字，如 1, 2, 3
4. 如果角色之间存在关系，追加“### 角色关系”小节，列出“- 对方角色：关系描述”。
5. 只提取剧本中确实出现的角色，不要杜撰。`

// AI 调整角色卡：根据已知信息与剧本，重新整理并强化角色关键设定（返回 { markdown, usage }）
export async function adjustRoleCard({ role, scriptText, instruction, modelId, signal }) {
  const system = `你是漫剧角色卡调整助手。请根据已知信息与剧本，重新整理并强化该角色信息，输出单个角色的规范化 Markdown。

调整重点：
1. 可以优化和改写已有字段，不只是补空。
2. 必须重点强化“外观设定”“性格”“说话方式”“声线”。
3. 外观设定要具体到发型、体态、服装、辨识物、气质，便于后续图片生成保持一致。
4. 性格要结合角色动机、行为方式和人物弧光。
5. 说话方式要描述语言习惯、语速、句式、情绪表达。
6. 声线要写成供配音/视频模型使用的声音描述，包含音色、年龄感、语速、气息和情绪质感。
7. 不要改变角色姓名和核心剧情定位，不要添加与剧本冲突的信息。
8. 如果用户提供了调整想法，应优先满足用户调整想法；没有提供时再按默认重点调整。

格式（严格遵守，只返回该角色）：
## 角色：${role?.name || '角色'}
- 角色定位：主角/配角/反派/路人
- 性别：
- 年龄：
- 身份：
- 性格：
- 核心动机：
- 外观设定：
- 说话方式：
- 声线：供配音/视频模型使用的声音描述

不要解释，不要使用代码块围栏。`
  const user = `已知角色信息：
姓名：${role?.name || ''}
角色定位：${role?.roleType || ''}
性别：${role?.gender || ''}　年龄：${role?.age || ''}
身份：${role?.identity || ''}
性格：${role?.personality || ''}
核心动机：${role?.motivation || ''}
外观设定：${role?.appearance || ''}
说话方式：${role?.voice || ''}
声线：${role?.voiceLine || ''}

用户调整想法：
${instruction || '（未提供，请重点强化外观设定、性格、说话方式和声线）'}

剧本参考：
${scriptText || '（无剧本参考，请根据已知信息合理调整）'}`

  const { content, usage } = await chatComplete({ modelId, system, user, temperature: 0.5, signal })
  return { markdown: stripCodeFence(content), usage }
}

// 从剧本内容提取角色（返回 { markdown, usage }）
export async function extractRolesFromScript({ scriptText, modelId, signal }) {
  const user = `请从下面的剧本内容中提取主要角色，并按要求输出：

${scriptText}`
  const { content, usage } = await chatComplete({
    modelId,
    system: EXTRACT_ROLES_SYSTEM,
    user,
    temperature: 0.4,
    signal,
  })
  return { markdown: stripCodeFence(content), usage }
}

// ---------- 剧情卡：识别参与角色（轻量名单，用于画布关联） ----------
function parseIdentifiedRolesJson(text) {
  const raw = stripCodeFence(String(text || ''))
  let jsonText = raw
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start >= 0 && end > start) jsonText = raw.slice(start, end + 1)
  let arr
  try {
    arr = JSON.parse(jsonText)
  } catch {
    throw new Error('AI 返回的角色名单无法解析，请重试或更换模型')
  }
  if (!Array.isArray(arr)) throw new Error('AI 返回的角色名单格式不正确')
  const roles = arr
    .map((item) => {
      if (typeof item === 'string') {
        return { name: item.trim(), roleType: '', note: '' }
      }
      return {
        name: String(item?.name ?? item?.角色 ?? item?.角色名 ?? '').trim(),
        roleType: String(item?.roleType ?? item?.type ?? item?.定位 ?? item?.角色定位 ?? '').trim(),
        note: String(item?.note ?? item?.reason ?? item?.evidence ?? item?.说明 ?? '').trim(),
      }
    })
    .filter((r) => r.name)
  return sanitizeRoleCandidates(roles)
}

const IDENTIFY_ROLES_SYSTEM = `你是漫剧剧本分析助手。请从用户提供的单集剧情中识别「实际参与本集」的角色名单。

要求：
1. 只列出本集正文中确实出场、有动作/对白/明确提及的角色，不要杜撰。
2. 旁白、画外音、解说、内心独白、心声、OS 都不是独立角色，任何情况下都不要列入名单。
3. “角色名（内心）”“角色名-独白”“角色名OS”等内容归属于该角色本人，只返回规范角色名。
4. 每个角色包含：
   - name：角色名（与剧本称呼一致）
   - roleType：主角/配角/反派/路人（可空）
   - note：一句简短依据（如「开场对白」「天台对峙」）
5. 只返回 JSON 数组，不要解释，不要代码块围栏。

输出示例：
[
  {"name":"林晚","roleType":"主角","note":"本集核心视角，多段对白"},
  {"name":"周衡","roleType":"配角","note":"天台对峙出场"}
]`

// 识别单集剧情中的参与角色（返回 { roles, usage }）
export async function identifyEpisodeRoles({ episodeTitle, episodeContent, modelId, signal }) {
  const user = `剧集标题：${episodeTitle || '未命名剧集'}

剧集剧情与对白：
${episodeContent}

请识别本集参与角色，按要求的 JSON 格式输出。`
  const { content, usage } = await chatComplete({
    modelId,
    system: IDENTIFY_ROLES_SYSTEM,
    user,
    temperature: 0.3,
    signal,
  })
  return { roles: parseIdentifiedRolesJson(content), usage }
}

// ---------- 分镜生成 ----------
// 从模型输出中稳健地解析分镜 JSON 数组
function parseShotsJson(text) {
  const raw = stripCodeFence(String(text || ''))
  let jsonText = raw
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start >= 0 && end > start) jsonText = raw.slice(start, end + 1)
  let arr
  try {
    arr = JSON.parse(jsonText)
  } catch {
    throw new Error('AI 返回的分镜格式无法解析，请重试或更换模型')
  }
  if (!Array.isArray(arr)) throw new Error('AI 返回的分镜格式不正确')
  return arr
    .map((s, i) => {
      const method = String(
        s.method ?? s.camera ?? s.shotMethod ?? s['拍摄方法'] ?? s['镜头拍摄方法'] ?? '',
      ).trim()
      const prompt = String(
        s.prompt ?? s.imagePrompt ?? s['画面提示词'] ?? s['提示词'] ?? method,
      ).trim()
      return {
        title: String(s.title ?? s.name ?? s['标题'] ?? `分镜 ${i + 1}`).trim().slice(0, 40),
        duration: Number(s.duration ?? s.seconds ?? s.time ?? s['时长'] ?? 0) || 0,
        method: method || prompt.slice(0, 80),
        prompt,
        description: String(
          s.description ?? s.desc ?? s.content ?? s.plot ?? s['发生剧情'] ?? s['镜头内容'] ?? s['描述'] ?? '',
        ).trim(),
      }
    })
    .filter((s) => s.prompt || s.description || s.title || s.method)
}

const STORYBOARD_SYSTEM = `你是专业的漫剧分镜师。请根据用户提供的单集剧情与对白，把它拆解为一组合理的分镜镜头（shot）。镜头数量与每个镜头的时长，都由你根据叙事节奏和信息量自行决定。

要求：
1. 覆盖本集完整剧情，严格按时间线顺序排列。
2. 每个镜头必须包含以下字段：
   - title：镜头简短标题
   - duration：镜头时长（秒，数字）
   - method：镜头拍摄方法（景别、机位、运镜、构图要点，简短可执行，如「全景推镜」「近景手持跟拍」）
   - prompt：用于AI图片/视频生成的详细画面提示词，需包含景别、构图、场景环境、角色外观与动作、光线、氛围、镜头运动等，尽量具体、可直接用于生成
   - description：发生剧情（本镜头内发生的剧情、动作与对白/旁白要点）
3. 只返回一个 JSON 数组，不要任何解释文字，不要使用代码块围栏。

输出示例：
[
  {"title":"开场全景","duration":3,"method":"广角全景缓慢推镜","prompt":"电影感广角全景，黄昏城市天台，男主背对镜头远眺，暖橙色逆光，轻微推镜","description":"交代场景与主角处境，旁白引入"},
  {"title":"主角特写","duration":2,"method":"面部特写浅景深","prompt":"面部特写，眼神坚定，冷蓝夜色光，浅景深","description":"主角下定决心，台词：就今晚"}
]`

// 根据单集剧情生成分镜镜头序列（返回 { shots, usage }）
export async function generateStoryboardShots({ episodeTitle, episodeContent, modelId, signal }) {
  const user = `剧集标题：${episodeTitle || '未命名剧集'}

剧集剧情与对白：
${episodeContent}

请把本集拆解为合理的分镜镜头序列，数量与时长由你决定，按要求的 JSON 格式输出。`
  const { content, usage } = await chatComplete({
    modelId,
    system: STORYBOARD_SYSTEM,
    user,
    temperature: 0.7,
    signal,
  })
  return { shots: parseShotsJson(content), usage }
}
