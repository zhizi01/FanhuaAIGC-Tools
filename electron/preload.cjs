// 预加载脚本：使用 CommonJS，通过 contextBridge 暴露受控的本地能力给渲染进程
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 全局设置
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data),
  },
  // 工程管理
  projects: {
    listRecent: () => ipcRenderer.invoke('projects:listRecent'),
    create: (payload) => ipcRenderer.invoke('projects:create', payload),
    open: (dir) => ipcRenderer.invoke('projects:open', dir),
    removeRecent: (id) => ipcRenderer.invoke('projects:removeRecent', id),
  },
  // 剧本文件
  scripts: {
    list: (projectPath) => ipcRenderer.invoke('scripts:list', projectPath),
    save: (payload) => ipcRenderer.invoke('scripts:save', payload),
    read: (payload) => ipcRenderer.invoke('scripts:read', payload),
    remove: (payload) => ipcRenderer.invoke('scripts:remove', payload),
    uploadAndParse: (payload) => ipcRenderer.invoke('scripts:uploadAndParse', payload),
  },
  // 角色库
  roles: {
    list: (projectPath) => ipcRenderer.invoke('roles:list', projectPath),
    read: (payload) => ipcRenderer.invoke('roles:read', payload),
    save: (payload) => ipcRenderer.invoke('roles:save', payload),
    remove: (payload) => ipcRenderer.invoke('roles:remove', payload),
  },
  // 资产库
  assets: {
    list: (projectPath) => ipcRenderer.invoke('assets:list', projectPath),
    read: (payload) => ipcRenderer.invoke('assets:read', payload),
    save: (payload) => ipcRenderer.invoke('assets:save', payload),
    remove: (payload) => ipcRenderer.invoke('assets:remove', payload),
    import: (payload) => ipcRenderer.invoke('assets:import', payload),
  },
  // 系统对话框
  dialog: {
    selectProjectDir: () => ipcRenderer.invoke('dialog:selectProjectDir'),
    selectScriptFile: () => ipcRenderer.invoke('dialog:selectScriptFile'),
    selectAssetFiles: () => ipcRenderer.invoke('dialog:selectAssetFiles'),
    exportScript: (payload) => ipcRenderer.invoke('dialog:exportScript', payload),
  },
  // 工程 Token 用量
  usage: {
    get: (projectPath) => ipcRenderer.invoke('usage:get', projectPath),
    add: (payload) => ipcRenderer.invoke('usage:add', payload),
  },
})
