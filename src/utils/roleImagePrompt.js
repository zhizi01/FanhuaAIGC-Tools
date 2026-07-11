export const ROLE_IMAGE_STYLE_PRESETS = [
  {
    value: 'realistic',
    label: '真人风格',
    description: '商业摄影质感，适合真人短剧',
    prompt: '写实商业人像摄影风格，真实皮肤与布料质感，高调摄影棚灯光，柔和均匀的漫射光，色彩干净自然，高清细节',
  },
  {
    value: 'anime',
    label: '二次元风格',
    description: '精致动漫设定稿，线条清晰',
    prompt: '高质量二次元动漫角色设定风格，精致五官，干净利落的线稿，细腻赛璐璐上色，柔和光影，统一且准确的角色设计',
  },
  {
    value: 'cg',
    label: 'CG风格',
    description: '电影级三维角色渲染',
    prompt: '电影级三维CG角色设定风格，PBR材质，真实毛发与服装纹理，柔和棚拍光照，精细建模与自然渲染，高品质游戏角色展示',
  },
  {
    value: 'guoman',
    label: '国漫风格',
    description: '东方审美国漫角色设计',
    prompt: '高品质国漫角色设定风格，东方审美五官，流畅线条，细腻厚涂与清晰色块结合，层次丰富的柔和光影，精致商业插画质感',
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

export function buildRoleReferencePrompt({ appearancePrompt, stylePrompt } = {}) {
  const appearance = String(appearancePrompt || '').trim()
  const style = String(stylePrompt || '').trim()
  if (!appearance) throw new Error('人物形象提示词不能为空')
  if (!style) throw new Error('生成风格提示词不能为空')

  return `制作一张${style}的人物参考图，16:9 横向画布，纯白色无缝背景。画面中的所有人物必须是同一个人，五官、脸型、发型、身材比例和服装完全一致。

人物形象：${appearance}。

画面左侧排列三张全身人物视图：正面站立、左侧面站立、背面站立。人物保持自然站姿，完整展示头部到鞋子。

画面右侧排列六张半身近景人物视图，包括：正面微笑、左前方四分之三角度、标准侧面、背面、正面温柔微笑、正面自然严肃表情。

所有视图间距均匀、排列整齐，类似专业模特资料卡和角色设定表。保持统一的材质、光影和色彩表现，高清细节，无文字、无边框、无水印、无装饰元素。`
}
