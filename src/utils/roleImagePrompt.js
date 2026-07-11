export const ROLE_IMAGE_STYLE_PRESETS = [
  {
    value: 'realistic',
    label: '真人风格',
    guidance: '写实商业人像摄影，真实皮肤与布料质感，高调摄影棚灯光，柔和均匀的漫射光，色彩干净自然',
  },
  {
    value: 'anime',
    label: '二次元风格',
    guidance: '高质量二次元动漫角色设定，精致五官，干净线稿，细腻赛璐璐上色，柔和光影',
  },
  {
    value: 'cg',
    label: 'CG风格',
    guidance: '电影级三维CG角色设定，PBR材质，精细建模，真实毛发与服装纹理，柔和棚拍光照',
  },
  {
    value: 'guoman',
    label: '国漫风格',
    guidance: '高品质国漫角色设定，东方审美五官，流畅线条，细腻厚涂，层次丰富的柔和光影',
  },
]

export const ROLE_IMAGE_VARIANTS = [
  {
    key: 'sheet',
    label: '主参考图',
    aspect: '16:9',
    description: '三张全身视图 + 六张半身视图',
    usePrimaryReference: false,
  },
  {
    key: 'portrait',
    label: '标准肖像图',
    aspect: '3:4',
    description: '正面头肩棚拍肖像',
    usePrimaryReference: true,
  },
  {
    key: 'expressions',
    label: '表情参考图',
    aspect: '横向 3×3',
    description: '九种标准人物表情',
    usePrimaryReference: true,
  },
]

export function buildRoleAppearancePrompt(role = {}) {
  const parts = []
  const ageGender = [role.age, role.gender].filter(Boolean).join('，')
  if (ageGender) parts.push(`人物为${ageGender}`)
  if (role.identity) parts.push(`身份是${role.identity}`)
  if (role.appearance) parts.push(`外貌与服装：${role.appearance}`)
  if (role.personality) parts.push(`气质与神态：${role.personality}`)
  if (role.name) parts.unshift(`角色名为${role.name}`)
  return parts.join('。') || '请设计一位外形鲜明、前后一致的成年人物，明确描述五官、发型、体型与服装'
}

export function getRoleImageStylePreset(value) {
  return ROLE_IMAGE_STYLE_PRESETS.find((preset) => preset.value === value) || ROLE_IMAGE_STYLE_PRESETS[0]
}

export function parseRoleImagePromptSet(text) {
  const raw = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 未返回三张图片的提示词 JSON')

  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error('AI 返回的三组图片提示词格式不正确')
  }

  const prompts = {}
  for (const variant of ROLE_IMAGE_VARIANTS) {
    const prompt = String(parsed?.[variant.key] || '').trim()
    if (!prompt) throw new Error(`AI 未生成「${variant.label}」提示词`)
    prompts[variant.key] = prompt
  }
  return prompts
}
