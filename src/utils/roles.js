// 角色身份与画布角色卡公共工具。
// 旁白/画外音属于剧本表现形式，不是角色；“某角色（内心）”应归并到该角色本身。

const INNER_MARKER =
  '(?:内心(?:独白|声音|声|活动|戏|话|os)?|心声|心里话|心中独白|心理(?:活动|描写)|独白|os)'
const NARRATION_MARKER =
  '(?:旁白|画外音|画外|解说(?:员)?|叙述(?:者|人)|讲述者|报幕|voice\\s*over|v\\.?o\\.?)'

const INNER_ONLY_RE = new RegExp(`^${INNER_MARKER}(?:角色|声音)?\\s*\\d*$`, 'i')
const NARRATION_ONLY_RE = new RegExp(`^${NARRATION_MARKER}(?:角色|声音)?\\s*\\d*$`, 'i')
const NARRATION_TYPE_RE = new RegExp(NARRATION_MARKER, 'i')
const GENERIC_ROLE_RE = /^(?:角色|人物|未知角色|未命名角色)\s*\d*$/i

function trimRoleName(value) {
  return String(value || '')
    .trim()
    .replace(/^(?:角色(?:名)?|人物(?:名)?)\s*[：:]\s*/i, '')
    .replace(/^[\s*#`"'“”‘’·•\-—_:：/／]+|[\s*#`"'“”‘’·•\-—_:：/／]+$/g, '')
    .trim()
}

function stripDeliveryMarker(name, marker) {
  const wrappedSuffix = new RegExp(
    `[\\s·•\\-—_:：/／]*[（(【\\[]\\s*${marker}\\s*[)）】\\]]\\s*$`,
    'i',
  )
  const wrappedPrefix = new RegExp(
    `^\\s*[（(【\\[]\\s*${marker}\\s*[)）】\\]][\\s·•\\-—_:：/／]*`,
    'i',
  )
  const plainSuffix = new RegExp(`[\\s·•\\-—_:：/／]*(?:的)?${marker}\\s*$`, 'i')
  const plainPrefix = new RegExp(`^\\s*${marker}\\s*[·•\\-—_:：/／]+\\s*`, 'i')

  if (wrappedSuffix.test(name)) return trimRoleName(name.replace(wrappedSuffix, ''))
  if (wrappedPrefix.test(name)) return trimRoleName(name.replace(wrappedPrefix, ''))
  if (plainSuffix.test(name)) return trimRoleName(name.replace(plainSuffix, ''))
  if (plainPrefix.test(name)) return trimRoleName(name.replace(plainPrefix, ''))
  return null
}

function parseRoleName(value) {
  const original = trimRoleName(value)
  if (!original || INNER_ONLY_RE.test(original) || NARRATION_ONLY_RE.test(original) || GENERIC_ROLE_RE.test(original)) {
    return { name: '', kind: 'non-character' }
  }

  const innerName = stripDeliveryMarker(original, INNER_MARKER)
  if (innerName !== null) {
    return GENERIC_ROLE_RE.test(innerName)
      ? { name: '', kind: 'non-character' }
      : { name: innerName, kind: 'inner' }
  }

  const narrationName = stripDeliveryMarker(original, NARRATION_MARKER)
  if (narrationName !== null) {
    return GENERIC_ROLE_RE.test(narrationName)
      ? { name: '', kind: 'non-character' }
      : { name: narrationName, kind: 'narration' }
  }

  return { name: original, kind: 'direct' }
}

export function canonicalRoleName(value) {
  return parseRoleName(value).name
}

export function normalizeRoleName(value) {
  return canonicalRoleName(value)
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, '')
    .replace(/[\s·,，.。、:：;；'"“”‘’!！?？~()（）[\]【】\-—_/／]/g, '')
}

function isNarrationType(value) {
  return NARRATION_TYPE_RE.test(String(value || '').replace(/\s+/g, ''))
}

export function isCharacterRoleCandidate(candidate) {
  const parsed = parseRoleName(candidate?.name)
  if (!parsed.name || parsed.kind === 'narration') return false
  return parsed.kind === 'inner' || !isNarrationType(candidate?.roleType)
}

function isBlank(value) {
  return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)
}

function mergeCandidates(primary, fallback) {
  const merged = { ...fallback, ...primary }
  const keys = new Set([...Object.keys(fallback || {}), ...Object.keys(primary || {})])
  for (const key of keys) {
    const preferred = primary?.[key]
    const secondary = fallback?.[key]
    if (Array.isArray(preferred) || Array.isArray(secondary)) {
      merged[key] = [...new Set([...(preferred || []), ...(secondary || [])])]
    } else if (isBlank(preferred) && !isBlank(secondary)) {
      merged[key] = secondary
    }
  }
  if (primary?.note && fallback?.note && primary.note !== fallback.note) {
    merged.note = `${primary.note}；${fallback.note}`
  }
  return merged
}

// 对 AI/系统解析出的角色统一做过滤、内心称呼归并和去重。
export function sanitizeRoleCandidates(candidates) {
  const byName = new Map()

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const parsed = parseRoleName(candidate?.name)
    if (!parsed.name) continue

    // 明确的旁白记录永远不进入角色库或画布；角色内心称呼则保留并归并到本人。
    if (parsed.kind === 'narration' || (parsed.kind !== 'inner' && isNarrationType(candidate?.roleType))) continue

    const next = { ...candidate, name: parsed.name }
    if (isNarrationType(next.roleType)) next.roleType = ''
    const key = normalizeRoleName(parsed.name)
    if (!key) continue

    const rank = parsed.kind === 'direct' ? 2 : 1
    const current = byName.get(key)
    if (!current) {
      byName.set(key, { value: next, rank })
      continue
    }

    if (rank > current.rank) {
      byName.set(key, { value: mergeCandidates(next, current.value), rank })
    } else {
      current.value = mergeCandidates(current.value, next)
    }
  }

  return [...byName.values()].map((entry) => entry.value)
}

function stripAffix(name) {
  return name
    .replace(/^(小|老|阿|大)/, '')
    .replace(/(总|哥|姐|叔|爷|姨|婶|妈|爸|先生|女士|小姐|老师|同学|队长|将军|陛下)$/, '')
}

// AI 使用简称/称谓时匹配角色库，优先精确匹配，再做受限的包含与称谓匹配。
export function findLibraryRole(libraryRoles, name) {
  const target = normalizeRoleName(name)
  if (!target) return null
  const list = (Array.isArray(libraryRoles) ? libraryRoles : [])
    .map((role) => ({ role, key: normalizeRoleName(role?.name) }))
    .filter((entry) => entry.key)

  const exact = list.filter((entry) => entry.key === target)
  if (exact.length === 1) return exact[0].role
  if (exact.length > 1) return null

  const contain = list.filter((entry) => {
    const short = entry.key.length <= target.length ? entry.key : target
    return short.length >= 2 && (entry.key.includes(target) || target.includes(entry.key))
  })
  if (contain.length === 1) return contain[0].role
  if (contain.length > 1) return null

  const targetWithoutAffix = stripAffix(target)
  if (!targetWithoutAffix || targetWithoutAffix === target) return null
  const affix = list.filter((entry) => {
    const keyWithoutAffix = stripAffix(entry.key)
    if (!keyWithoutAffix) return false
    if (keyWithoutAffix === targetWithoutAffix) return true
    const short =
      keyWithoutAffix.length <= targetWithoutAffix.length ? keyWithoutAffix : targetWithoutAffix
    return (
      short.length >= 2 &&
      (keyWithoutAffix.includes(targetWithoutAffix) || targetWithoutAffix.includes(keyWithoutAffix))
    )
  })
  return affix.length === 1 ? affix[0].role : null
}

// 旧画布自动补链只允许唯一精确匹配，避免把同名或相似角色错误关联。
export function findUniqueLibraryRole(libraryRoles, name) {
  const target = normalizeRoleName(name)
  if (!target) return null
  const matched = (Array.isArray(libraryRoles) ? libraryRoles : []).filter(
    (role) => normalizeRoleName(role?.name) === target,
  )
  return matched.length === 1 ? matched[0] : null
}

export function roleCardRoleId(data) {
  const value = data?.roleId || data?.libraryRoleId || data?.roleRef?.id || ''
  return String(value).trim()
}

function sourceField(source, previous, key, fallback = '') {
  if (Object.prototype.hasOwnProperty.call(source || {}, key)) return source[key] ?? fallback
  return previous?.[key] ?? fallback
}

// 画布只把角色库 ID 作为关联主键，其余字段均是可重新水合的完整快照。
export function buildRoleCardData(role, previous = {}) {
  const source = role || {}
  const roleId = String(source.id || source.roleId || roleCardRoleId(previous)).trim()
  const hasImages = Array.isArray(source.images)
  const images = hasImages ? [...source.images] : [...(Array.isArray(previous.images) ? previous.images : [])]
  const name = sourceField(source, previous, 'name', sourceField(source, previous, 'title', '未命名角色'))
  const identity = sourceField(source, previous, 'identity')
  const personality = sourceField(source, previous, 'personality')
  const appearance = sourceField(source, previous, 'appearance')
  const cover = Object.prototype.hasOwnProperty.call(source, 'cover')
    ? source.cover || (hasImages ? images[0] || '' : previous.cover || '')
    : hasImages
      ? images[0] || ''
      : previous.cover || ''

  return {
    ...previous,
    sourceType: 'role-library',
    roleId,
    libraryRoleId: roleId,
    roleRef: { type: 'role-library', id: roleId },
    missing: false,
    unlinked: false,
    title: name || '未命名角色',
    name: name || '未命名角色',
    roleType: sourceField(source, previous, 'roleType', '角色') || '角色',
    gender: sourceField(source, previous, 'gender'),
    age: sourceField(source, previous, 'age'),
    identity,
    personality,
    motivation: sourceField(source, previous, 'motivation'),
    appearance,
    voice: sourceField(source, previous, 'voice'),
    voiceLine: sourceField(source, previous, 'voiceLine'),
    images,
    cover,
    createdAt: sourceField(source, previous, 'createdAt'),
    updatedAt: sourceField(source, previous, 'updatedAt'),
    desc: identity || personality || appearance || '已绑定角色库角色。',
  }
}
