// 常用格式化工具

export function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diff = now - date
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour

  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day && now.getDate() === date.getDate()) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (diff < 2 * day) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(n) {
  return String(n).padStart(2, '0')
}
