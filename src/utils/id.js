// 渲染进程用的简单唯一 ID 生成
export function genLocalId(prefix) {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${time}${rand}`
}
