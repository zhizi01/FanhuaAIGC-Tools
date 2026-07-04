// 工程 Flow 幕布：保存 / 读取当前工程画布状态
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

function flowDir(projectPath) {
  const dir = path.join(projectPath, 'flow')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function canvasFile(projectPath) {
  return path.join(flowDir(projectPath), 'canvas.json')
}

export function registerFlowsIpc() {
  ipcMain.handle('flow:read', (_e, projectPath) => {
    if (!projectPath) return null
    const file = canvasFile(projectPath)
    if (!fs.existsSync(file)) return null
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle('flow:save', (_e, payload) => {
    const { projectPath, canvas } = payload || {}
    if (!projectPath || !canvas) throw new Error('缺少工程路径或幕布数据')
    const data = {
      ...canvas,
      savedAt: new Date().toISOString(),
    }
    fs.writeFileSync(canvasFile(projectPath), JSON.stringify(data, null, 2), 'utf-8')
    return data
  })
}
