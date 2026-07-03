// 桥接层：优先使用 Electron 预加载暴露的 window.api
// 在纯浏览器（非 Electron）下提供降级实现，便于前端调试，不会直接崩溃

const hasElectron = typeof window !== 'undefined' && !!window.api

const LS_SETTINGS = 'qs_settings'
const LS_RECENT = 'qs_recent_projects'

const DEFAULT_SETTINGS = {
  appearance: { themeMode: 'system', primaryColor: '#1677ff', density: 'comfortable' },
  models: [],
}

function lsGet(key, fallbackVal) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallbackVal
  } catch {
    return fallbackVal
  }
}

function lsSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val))
}

const desktopOnly = (name) => () => {
  throw new Error(`「${name}」需要在桌面应用中使用`)
}

const fallbackApi = {
  settings: {
    get: async () => lsGet(LS_SETTINGS, DEFAULT_SETTINGS),
    save: async (data) => {
      lsSet(LS_SETTINGS, data)
      return data
    },
  },
  projects: {
    listRecent: async () => lsGet(LS_RECENT, []),
    create: desktopOnly('新建工程'),
    open: desktopOnly('打开工程'),
    removeRecent: async (id) => {
      const items = lsGet(LS_RECENT, []).filter((it) => it.id !== id)
      lsSet(LS_RECENT, items)
      return items
    },
  },
  scripts: {
    list: async () => [],
    save: desktopOnly('保存剧本'),
    read: desktopOnly('读取剧本'),
    remove: desktopOnly('删除剧本'),
    uploadAndParse: desktopOnly('上传剧本'),
  },
  dialog: {
    selectProjectDir: desktopOnly('选择工程目录'),
    selectScriptFile: desktopOnly('选择剧本文件'),
  },
}

export const api = hasElectron ? window.api : fallbackApi
export const isElectron = hasElectron
