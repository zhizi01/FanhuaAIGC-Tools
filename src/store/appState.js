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

// 把外观配置应用到根节点（CSS 变量与主题属性）
export function applyAppearance(appearance) {
  const root = document.documentElement
  root.setAttribute('data-theme', computeIsDark(appearance) ? 'dark' : 'light')
  root.setAttribute('data-density', appearance?.density || 'comfortable')
  root.style.setProperty('--brand-color', appearance?.primaryColor || '#1ec9b0')
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

export function setCurrentModel(id) {
  appState.currentModelId = id
}
