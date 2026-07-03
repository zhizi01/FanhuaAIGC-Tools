// 简单的本地 JSON 存储，统一存放在 Electron 用户数据目录
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

function userDataFile(name) {
  return path.join(app.getPath('userData'), name)
}

export function readJson(fileName, fallback) {
  try {
    const file = userDataFile(fileName)
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return fallback
  }
}

export function writeJson(fileName, data) {
  const file = userDataFile(fileName)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  return true
}
