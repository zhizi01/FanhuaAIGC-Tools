import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSettingsIpc } from './ipc/settings.js'
import { registerProjectsIpc } from './ipc/projects.js'
import { registerScriptsIpc } from './ipc/scripts.js'
import { registerDialogsIpc } from './ipc/dialogs.js'
import { registerUsageIpc } from './ipc/usage.js'
import { registerRolesIpc } from './ipc/roles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 开发环境由 electron/dev.js 注入 Vite 开发服务器地址
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0e1116',
    title: '青山AI漫剧工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 仅保留 F12 / Ctrl+Shift+I 控制开发者工具，不再提供顶部菜单
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    const toggleByF12 = key === 'f12'
    const toggleByInspect = input.control && input.shift && key === 'i'
    if (toggleByF12 || toggleByInspect) {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 注册所有 IPC 接口
function registerIpc() {
  registerSettingsIpc()
  registerProjectsIpc()
  registerScriptsIpc()
  registerDialogsIpc(() => mainWindow)
  registerUsageIpc()
  registerRolesIpc()
}

app.whenReady().then(() => {
  // 移除应用顶部菜单栏（返回起始页/设置等改由界面内按钮承担）
  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
