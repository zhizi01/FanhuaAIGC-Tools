// 工程 Token 用量：读写 <工程>/usage.json 累计统计
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

function usageFile(projectPath) {
  return path.join(projectPath, 'usage.json')
}

function readUsage(projectPath) {
  try {
    const data = JSON.parse(fs.readFileSync(usageFile(projectPath), 'utf-8'))
    return {
      totalTokens: data.totalTokens || 0,
      promptTokens: data.promptTokens || 0,
      completionTokens: data.completionTokens || 0,
      requests: data.requests || 0,
      updatedAt: data.updatedAt || '',
    }
  } catch {
    return { totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0, updatedAt: '' }
  }
}

export function registerUsageIpc() {
  ipcMain.handle('usage:get', (_e, projectPath) => {
    if (!projectPath) return { totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0 }
    return readUsage(projectPath)
  })

  ipcMain.handle('usage:add', (_e, payload) => {
    const { projectPath, delta } = payload || {}
    if (!projectPath) throw new Error('缺少工程路径')
    const cur = readUsage(projectPath)
    const next = {
      totalTokens: cur.totalTokens + (delta?.totalTokens || 0),
      promptTokens: cur.promptTokens + (delta?.promptTokens || 0),
      completionTokens: cur.completionTokens + (delta?.completionTokens || 0),
      requests: cur.requests + (delta?.requests || 0),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(usageFile(projectPath), JSON.stringify(next, null, 2), 'utf-8')
    return next
  })
}
