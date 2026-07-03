// 全局应用状态：设置、当前工程、当前模型
import { reactive } from 'vue'
import { api } from '../services/bridge.js'

export const appState = reactive({
  settings: {
    appearance: { themeMode: 'dark', primaryColor: '#1ec9b0', density: 'comfortable' },
    models: [],
  },
  currentProject: null,
  currentModelId: null,
  loaded: false,
})

// 判断当前是否应使用深色主题
export function computeIsDark(appearance) {
  const mode = appearance?.themeMode || 'system'
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ---------- 颜色工具：让整套强调色（渐变/浅底/描边）跟随用户主色 ----------
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = parseInt(full || '1ec9b0', 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
// 与黑/白混合，amt 越大越接近目标色
function mix(hex, target, amt) {
  const c = hexToRgb(hex)
  const t = hexToRgb(target)
  const m = (k) => Math.round(c[k] + (t[k] - c[k]) * amt)
  return `rgb(${m('r')}, ${m('g')}, ${m('b')})`
}

// 把外观配置应用到根节点（CSS 变量与主题属性）
export function applyAppearance(appearance) {
  const root = document.documentElement
  const dark = computeIsDark(appearance)
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.setAttribute('data-density', appearance?.density || 'comfortable')

  const brand = appearance?.primaryColor || '#1ec9b0'
  root.style.setProperty('--brand-color', brand)
  root.style.setProperty('--brand-strong', mix(brand, '#000000', 0.14))
  root.style.setProperty('--brand-soft', rgba(brand, dark ? 0.16 : 0.12))
  root.style.setProperty('--bg-active', rgba(brand, dark ? 0.16 : 0.12))
  root.style.setProperty(
    '--gradient-brand',
    `linear-gradient(135deg, ${mix(brand, '#ffffff', 0.16)} 0%, ${mix(brand, '#000000', 0.06)} 100%)`,
  )
}

export async function loadSettings() {
  const s = await api.settings.get()
  appState.settings = s
  const def = s.models.find((m) => m.isDefault) || s.models[0]
  appState.currentModelId = def ? def.id : null
  applyAppearance(s.appearance)
  appState.loaded = true
  return s
}

export async function saveSettings(next) {
  const saved = await api.settings.save(next)
  appState.settings = saved
  applyAppearance(saved.appearance)
  // 保持当前模型选择有效
  if (!saved.models.find((m) => m.id === appState.currentModelId)) {
    const def = saved.models.find((m) => m.isDefault) || saved.models[0]
    appState.currentModelId = def ? def.id : null
  }
  return saved
}

export function setCurrentProject(project) {
  appState.currentProject = project
  try {
    if (project) sessionStorage.setItem('qs_current_project', JSON.stringify(project))
    else sessionStorage.removeItem('qs_current_project')
  } catch {
    // 忽略存储异常
  }
}

// 页面刷新后从会话中恢复当前工程
export function restoreCurrentProject() {
  if (appState.currentProject) return appState.currentProject
  try {
    const raw = sessionStorage.getItem('qs_current_project')
    if (raw) appState.currentProject = JSON.parse(raw)
  } catch {
    // 忽略解析异常
  }
  return appState.currentProject
}
