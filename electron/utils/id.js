// 生成带前缀的简单唯一 ID
export function genId(prefix) {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${time}${rand}`
}
