// 剧本 Markdown 工具：渲染预览、按集拆分、合规检测解析
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

// 渲染 Markdown 为 HTML，用于「预览」模式
export function renderMarkdown(md) {
  if (!md) return ''
  try {
    return marked.parse(String(md))
  } catch {
    return ''
  }
}

// 分集标题：## 第1集：标题（兼容全角数字与常见中文数字）
const EPISODE_RE = /^##[ \t]*第[ \t]*([0-9０-９零一二两三四五六七八九十百]+)[ \t]*集[ \t]*[：:]?[ \t]*(.*)$/

const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNIT = { 十: 10, 百: 100 }

function chineseToNumber(str) {
  let section = 0
  let num = 0
  for (const ch of str) {
    if (CN_NUM[ch] != null) {
      num = CN_NUM[ch]
    } else if (CN_UNIT[ch]) {
      if (num === 0) num = 1
      section += num * CN_UNIT[ch]
      num = 0
    }
  }
  return section + num
}

function toArabic(raw) {
  const half = String(raw).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (/^[0-9]+$/.test(half)) return parseInt(half, 10)
  return chineseToNumber(raw)
}

// 去掉模型偶尔多包的 ```md ... ``` 代码块围栏
export function stripCodeFence(text) {
  const t = String(text || '').trim()
  const fence = t.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n?```$/)
  return fence ? fence[1].trim() : t
}

// 从整套剧本 Markdown 中提取一级标题作为剧本标题
export function extractTitle(fullMarkdown, fallback = '未命名剧本') {
  const m = String(fullMarkdown || '').match(/^#[ \t]+(.+)$/m)
  return m ? m[1].trim() : fallback
}

// 解析合规检测结果：返回是否通过与风险等级
export function parseCompliance(fullMarkdown) {
  const text = String(fullMarkdown || '')
  const failed = /(检测结果|合规检测)\s*[：:]\s*不通过/.test(text)
  const risk = text.match(/风险等级\s*[：:]\s*([^\n]+)/)
  return {
    passed: !failed,
    result: failed ? '不通过' : '通过',
    riskLevel: risk ? risk[1].trim() : '',
  }
}

// 以「## 第N集」为边界拆分整套剧本 Markdown
// 返回 { overview, episodes: [{ episodeNo, title, content }] }
export function splitScriptMarkdown(fullMarkdown) {
  const text = stripCodeFence(fullMarkdown).replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const overviewLines = []
  const episodes = []
  let current = null

  for (const line of lines) {
    const m = line.match(EPISODE_RE)
    if (m) {
      if (current) episodes.push(current)
      const no = toArabic(m[1]) || episodes.length + 1
      const title = (m[2] || '').trim() || `第${no}集`
      current = { episodeNo: no, title, lines: [line] }
    } else if (current) {
      current.lines.push(line)
    } else {
      overviewLines.push(line)
    }
  }
  if (current) episodes.push(current)

  return {
    overview: overviewLines.join('\n').trim(),
    episodes: episodes.map((e) => ({
      episodeNo: e.episodeNo,
      title: e.title,
      content: e.lines.join('\n').trim(),
    })),
  }
}

// 解析「AI提取角色」结果：按「## 角色：角色名」拆分为角色草稿
export function parseExtractedRoles(md) {
  const text = stripCodeFence(md).replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const ROLE_RE = /^##\s*角色\s*[：:]\s*(.+?)\s*$/
  const FIELD_RE = /^[-*]\s*([^：:]+?)\s*[：:]\s*(.*)$/
  const REL_HEAD_RE = /^###\s*角色关系/

  const roles = []
  let cur = null
  let inRelations = false

  const mapField = (role, key, val) => {
    const k = key.trim()
    const v = val.trim()
    if (k.includes('定位')) role.roleType = v || role.roleType
    else if (k.includes('性别')) role.gender = v
    else if (k.includes('年龄')) role.age = v
    else if (k.includes('身份')) role.identity = v
    else if (k.includes('性格')) role.personality = v
    else if (k.includes('动机')) role.motivation = v
    else if (k.includes('外观')) role.appearance = v
    else if (k.includes('声线')) role.voiceLine = v
    else if (k.includes('说话') || k.includes('口吻') || k.includes('声音')) role.voice = v
    else if (k.includes('出现') || k.includes('集数')) {
      role.appearEpisodes = (v.match(/\d+/g) || []).map((n) => parseInt(n, 10))
    } else if (k.includes('标签')) {
      role.tags = v.split(/[,，、/]/).map((t) => t.trim()).filter(Boolean)
    }
  }

  for (const line of lines) {
    const rm = line.match(ROLE_RE)
    if (rm) {
      if (cur) roles.push(cur)
      cur = {
        name: rm[1].trim(),
        roleType: '配角',
        gender: '',
        age: '',
        identity: '',
        personality: '',
        motivation: '',
        appearance: '',
        voice: '',
        voiceLine: '',
        appearEpisodes: [],
        tags: [],
        relations: [],
      }
      inRelations = false
      continue
    }
    if (!cur) continue
    if (REL_HEAD_RE.test(line)) {
      inRelations = true
      continue
    }
    if (/^#{1,3}\s/.test(line)) inRelations = false

    const fm = line.match(FIELD_RE)
    if (fm) {
      if (inRelations) {
        cur.relations.push({ targetName: fm[1].trim(), relation: fm[2].trim() })
      } else {
        mapField(cur, fm[1], fm[2])
      }
    }
  }
  if (cur) roles.push(cur)
  return roles
}

// 从整套 Markdown 构建可保存的剧本对象
export function buildScriptFromMarkdown(fullMarkdown, base = {}) {
  const { overview, episodes } = splitScriptMarkdown(fullMarkdown)
  const compliance = parseCompliance(fullMarkdown)
  const title = base.title || extractTitle(fullMarkdown, '未命名剧本')
  let status = base.status || '已标准化'
  if (!compliance.passed) status = '合规失败'
  else if (!episodes.length) status = '草稿'
  return {
    ...base,
    title,
    overview,
    episodes,
    status,
    complianceResult: compliance.result,
    riskLevel: compliance.riskLevel,
    _compliance: compliance,
  }
}
