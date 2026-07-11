// 全局应用状态（Pinia）：设置、当前工程、当前模型
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'

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
  root.setAttribute('data-bg', appearance?.background || 'grid')

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

export const useAppStore = defineStore('app', {
  state: () => ({
    settings: {
      appearance: { themeMode: 'dark', primaryColor: '#1ec9b0', density: 'comfortable', background: 'grid' },
      imageGeneration: { apiKey: '' },
      models: [],
    },
    currentProject: null,
    currentModelId: null,
    loaded: false,
  }),
  getters: {
    isDark: (state) => computeIsDark(state.settings.appearance),
  },
  actions: {
    async loadSettings() {
      const s = await api.settings.get()
      this.settings = s
      const def = s.models.find((m) => m.isDefault) || s.models[0]
      this.currentModelId = def ? def.id : null
      applyAppearance(s.appearance)
      this.loaded = true
      return s
    },
    async saveSettings(next) {
      const saved = await api.settings.save(next)
      this.settings = saved
      applyAppearance(saved.appearance)
      // 保持当前模型选择有效
      if (!saved.models.find((m) => m.id === this.currentModelId)) {
        const def = saved.models.find((m) => m.isDefault) || saved.models[0]
        this.currentModelId = def ? def.id : null
      }
      return saved
    },
    setCurrentProject(project) {
      this.currentProject = project
      try {
        if (project) sessionStorage.setItem('qs_current_project', JSON.stringify(project))
        else sessionStorage.removeItem('qs_current_project')
      } catch {
        // 忽略存储异常
      }
    },
    // 页面刷新后从会话中恢复当前工程
    restoreCurrentProject() {
      if (this.currentProject) return this.currentProject
      try {
        const raw = sessionStorage.getItem('qs_current_project')
        if (raw) this.currentProject = JSON.parse(raw)
      } catch {
        // 忽略解析异常
      }
      return this.currentProject
    },
  },
})
