// 工程管理：新建/打开/最近工程列表/移除记录
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJson } from '../utils/store.js'
import { genId } from '../utils/id.js'

const RECENT_FILE = 'recent-projects.json'
const SUB_DIRS = ['scripts', 'roles', 'assets', 'exports']

function readRecent() {
  const data = readJson(RECENT_FILE, { items: [] })
  return Array.isArray(data.items) ? data.items : []
}

function writeRecent(items) {
  writeJson(RECENT_FILE, { items })
}

// 更新最近工程记录，同一路径去重后置顶
function upsertRecent(meta) {
  const items = readRecent().filter((it) => it.path !== meta.path)
  items.unshift({
    id: meta.id,
    name: meta.name,
    path: meta.path,
    description: meta.description || '',
    lastOpenedAt: new Date().toISOString(),
  })
  writeRecent(items.slice(0, 50))
}

function ensureSubDirs(root) {
  for (const sub of SUB_DIRS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true })
  }
}

function writeProjectJson(root, meta) {
  fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

export function registerProjectsIpc() {
  ipcMain.handle('projects:listRecent', () => {
    // 自动清理已被删除的工程目录记录
    const items = readRecent()
    const existing = items.filter((it) => it.path && fs.existsSync(it.path))
    if (existing.length !== items.length) writeRecent(existing)
    return existing
  })

  ipcMain.handle('projects:create', (_e, payload) => {
    const name = (payload?.name || '').trim()
    const location = (payload?.location || '').trim()
    const description = payload?.description || ''
    if (!name) throw new Error('工程名称不能为空')
    if (!location) throw new Error('工程保存路径不能为空')

    const projectPath = path.join(location, name)
    if (fs.existsSync(projectPath)) {
      throw new Error('目标目录已存在，请更换名称或保存路径')
    }

    fs.mkdirSync(projectPath, { recursive: true })
    ensureSubDirs(projectPath)

    const now = new Date().toISOString()
    const meta = {
      id: genId('project'),
      name,
      description,
      createdAt: now,
      updatedAt: now,
      version: '0.1.0',
    }
    writeProjectJson(projectPath, meta)

    const result = { ...meta, path: projectPath }
    upsertRecent(result)
    return result
  })

  ipcMain.handle('projects:open', (_e, dir) => {
    if (!dir || !fs.existsSync(dir)) throw new Error('工程目录不存在')

    const metaFile = path.join(dir, 'project.json')
    let meta
    if (fs.existsSync(metaFile)) {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    } else {
      // 选择的目录还不是工程时，将其初始化为工程
      const now = new Date().toISOString()
      meta = {
        id: genId('project'),
        name: path.basename(dir),
        description: '',
        createdAt: now,
        updatedAt: now,
        version: '0.1.0',
      }
      ensureSubDirs(dir)
      writeProjectJson(dir, meta)
    }
    // 确保子目录存在
    ensureSubDirs(dir)

    const result = { ...meta, path: dir }
    upsertRecent(result)
    return result
  })

  ipcMain.handle('projects:removeRecent', (_e, id) => {
    const items = readRecent().filter((it) => it.id !== id)
    writeRecent(items)
    return items
  })
}
