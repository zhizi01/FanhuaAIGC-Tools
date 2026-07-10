// 桥接层：优先使用 Electron 预加载暴露的 window.api
// 在纯浏览器（非 Electron）下提供降级实现，便于前端调试，不会直接崩溃

const hasElectron = typeof window !== 'undefined' && !!window.api

const LS_SETTINGS = 'qs_settings'
const LS_RECENT = 'qs_recent_projects'

const DEFAULT_SETTINGS = {
  appearance: { themeMode: 'dark', primaryColor: '#1ec9b0', density: 'comfortable', background: 'grid' },
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
    roles: {
      list: (projectPath) => raw.roles.list(projectPath),
      read: (payload) => raw.roles.read(toPlain(payload)),
      save: (payload) => raw.roles.save(toPlain(payload)),
      remove: (payload) => raw.roles.remove(toPlain(payload)),
      importImages: (payload) => raw.roles.importImages(toPlain(payload)),
      removeImage: (payload) => raw.roles.removeImage(toPlain(payload)),
    },
    assets: {
      list: (projectPath) => raw.assets.list(projectPath),
      read: (payload) => raw.assets.read(toPlain(payload)),
      save: (payload) => raw.assets.save(toPlain(payload)),
      remove: (payload) => raw.assets.remove(toPlain(payload)),
      import: (payload) => raw.assets.import(toPlain(payload)),
      generateImage: (payload) => raw.assets.generateImage(toPlain(payload)),
      syncGenerated: (projectPath) => raw.assets.syncGenerated(projectPath),
      folders: (projectPath) => raw.assets.folders(projectPath),
      createFolder: (payload) => raw.assets.createFolder(toPlain(payload)),
      renameFolder: (payload) => raw.assets.renameFolder(toPlain(payload)),
      removeFolder: (payload) => raw.assets.removeFolder(toPlain(payload)),
      move: (payload) => raw.assets.move(toPlain(payload)),
    },
    flow: {
      read: (projectPath) => raw.flow.read(projectPath),
      save: (payload) => raw.flow.save(toPlain(payload)),
    },
    dialog: {
      selectProjectDir: () => raw.dialog.selectProjectDir(),
      selectScriptFile: () => raw.dialog.selectScriptFile(),
      selectAssetFiles: () => raw.dialog.selectAssetFiles(),
      exportScript: (payload) => raw.dialog.exportScript(toPlain(payload)),
    },
    usage: {
      get: (projectPath) => raw.usage.get(projectPath),
      add: (payload) => raw.usage.add(toPlain(payload)),
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
  roles: {
    list: async () => [],
    read: desktopOnly('读取角色'),
    save: desktopOnly('保存角色'),
    remove: desktopOnly('删除角色'),
    importImages: desktopOnly('上传角色形象图'),
    removeImage: desktopOnly('删除角色形象图'),
  },
  assets: {
    list: async () => [],
    read: desktopOnly('读取资产'),
    save: desktopOnly('保存资产'),
    remove: desktopOnly('删除资产'),
    import: desktopOnly('导入资产'),
    generateImage: desktopOnly('AI 生成图片'),
    syncGenerated: desktopOnly('同步项目资产'),
    // 浏览器降级：文件夹注册表存于 localStorage，便于纯前端调试文件管理器交互
    folders: async (projectPath) => lsGet('qs_asset_folders_' + projectPath, []),
    createFolder: async ({ projectPath, type, path }) => {
      const key = 'qs_asset_folders_' + projectPath
      const folders = lsGet(key, [])
      const p = String(path || '').trim()
      if (p && !folders.some((f) => f.type === type && f.path === p)) {
        folders.push({ path: p, type, createdAt: new Date().toISOString() })
        lsSet(key, folders)
      }
      return folders
    },
    renameFolder: async ({ projectPath }) => ({ folders: lsGet('qs_asset_folders_' + projectPath, []), items: [] }),
    removeFolder: async ({ projectPath, type, path }) => {
      const key = 'qs_asset_folders_' + projectPath
      const p = String(path || '').trim()
      const folders = lsGet(key, []).filter((f) => !(f.type === type && (f.path === p || f.path.startsWith(p + '/'))))
      lsSet(key, folders)
      return { folders, items: [] }
    },
    move: desktopOnly('移动资产'),
  },
  flow: {
    read: async (projectPath) => lsGet('qs_flow_' + projectPath, null),
    save: async ({ projectPath, canvas }) => {
      const data = { ...canvas, savedAt: new Date().toISOString() }
      lsSet('qs_flow_' + projectPath, data)
      return data
    },
  },
  dialog: {
    selectProjectDir: desktopOnly('选择工程目录'),
    selectScriptFile: desktopOnly('选择剧本文件'),
    selectAssetFiles: desktopOnly('选择资产文件'),
    exportScript: desktopOnly('导出剧本'),
  },
  usage: {
    get: async (projectPath) => lsGet('qs_usage_' + projectPath, { totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0 }),
    add: async ({ projectPath, delta }) => {
      const key = 'qs_usage_' + projectPath
      const cur = lsGet(key, { totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0 })
      const next = {
        totalTokens: (cur.totalTokens || 0) + (delta?.totalTokens || 0),
        promptTokens: (cur.promptTokens || 0) + (delta?.promptTokens || 0),
        completionTokens: (cur.completionTokens || 0) + (delta?.completionTokens || 0),
        requests: (cur.requests || 0) + (delta?.requests || 0),
      }
      lsSet(key, next)
      return next
    },
  },
}

export const api = hasElectron ? wrapElectronApi(window.api) : fallbackApi
export const isElectron = hasElectron
