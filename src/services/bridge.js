// 桥接层：优先使用 Electron 预加载暴露的 window.api
// 在纯浏览器（非 Electron）下提供降级实现，便于前端调试，不会直接崩溃

const hasElectron = typeof window !== 'undefined' && !!window.api

const LS_SETTINGS = 'qs_settings'
const LS_RECENT = 'qs_recent_projects'

const DEFAULT_SETTINGS = {
  appearance: { themeMode: 'dark', primaryColor: '#1ec9b0', density: 'comfortable' },
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

// 跨 Electron contextBridge 传参会做结构化克隆，Vue 的响应式代理无法被克隆，
// 这里统一转成纯对象，避免「An object could not be cloned」错误
function toPlain(value) {
  if (value == null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

// 包一层：把对象类型的入参在进入 IPC 前转为纯对象
function wrapElectronApi(raw) {
  return {
    settings: {
      get: () => raw.settings.get(),
      save: (data) => raw.settings.save(toPlain(data)),
    },
    projects: {
      listRecent: () => raw.projects.listRecent(),
      create: (payload) => raw.projects.create(toPlain(payload)),
      open: (dir) => raw.projects.open(dir),
      removeRecent: (id) => raw.projects.removeRecent(id),
    },
    scripts: {
      list: (projectPath) => raw.scripts.list(projectPath),
      save: (payload) => raw.scripts.save(toPlain(payload)),
      read: (payload) => raw.scripts.read(toPlain(payload)),
      remove: (payload) => raw.scripts.remove(toPlain(payload)),
      uploadAndParse: (payload) => raw.scripts.uploadAndParse(toPlain(payload)),
    },
    dialog: {
      selectProjectDir: () => raw.dialog.selectProjectDir(),
      selectScriptFile: () => raw.dialog.selectScriptFile(),
    },
  }
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

export const api = hasElectron ? wrapElectronApi(window.api) : fallbackApi
export const isElectron = hasElectron
