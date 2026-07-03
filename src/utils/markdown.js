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
