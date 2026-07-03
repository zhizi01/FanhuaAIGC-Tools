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
  // 系统对话框
  dialog: {
    selectProjectDir: () => ipcRenderer.invoke('dialog:selectProjectDir'),
    selectScriptFile: () => ipcRenderer.invoke('dialog:selectScriptFile'),
  },
  // 窗口菜单导航（返回起始页 / 设置）
  onNavigate: (callback) => {
    const handler = (_e, path) => callback(path)
    ipcRenderer.on('menu:navigate', handler)
    return () => ipcRenderer.removeListener('menu:navigate', handler)
  },
})
