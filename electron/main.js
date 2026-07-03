import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSettingsIpc } from './ipc/settings.js'
import { registerProjectsIpc } from './ipc/projects.js'
import { registerScriptsIpc } from './ipc/scripts.js'
import { registerDialogsIpc } from './ipc/dialogs.js'
import { buildAppMenu } from './menu.js'

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
    backgroundColor: '#f5f6f8',
    title: '青山AI漫剧工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
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
}

app.whenReady().then(() => {
  registerIpc()
  buildAppMenu(() => mainWindow)
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
