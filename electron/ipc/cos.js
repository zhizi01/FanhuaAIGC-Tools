// COS 对象存储 IPC：把工程内的图片上传到腾讯云，返回可提交给视频模型的公网链接
// 上传记录写在 <工程>/cos/uploads.json，同一张图未改动时直接复用旧链接，避免重复上传
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { uploadImageFile, testCosConnection, isCosConfigured } from '../utils/cos.js'

function uploadsFile(projectPath) {
  const dir = path.join(projectPath, 'cos')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'uploads.json')
}

// 云端目录用工程 ID，同一台机器上多个工程的图片互不混淆
function readProjectId(projectPath) {
  const file = path.join(projectPath, 'project.json')
  if (!fs.existsSync(file)) throw new Error('当前目录不是有效工程，缺少 project.json')
  let meta
  try {
    meta = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    throw new Error('工程信息 project.json 解析失败')
  }
  const id = String(meta?.id || '').trim()
  if (!id) throw new Error('工程信息缺少 ID，请重新打开工程')
  return id
}

function readUploads(projectPath) {
  const file = uploadsFile(projectPath)
  if (!fs.existsSync(file)) return {}
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return data && typeof data.items === 'object' ? data.items : {}
  } catch {
    return {}
  }
}

function writeUploads(projectPath, items) {
  fs.writeFileSync(uploadsFile(projectPath), JSON.stringify({ items }, null, 2), 'utf-8')
}

function isInside(root, target) {
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  return normalize(path.resolve(target)).startsWith(normalize(path.resolve(root) + path.sep))
}

// 入参是工程内的相对路径（例如 roles/role_x/images/img_x.jpg、assets/files/asset_x.png）
function resolveProjectImage(projectPath, relFile) {
  const rel = String(relFile || '').trim().replace(/\\/g, '/')
  if (!rel || path.isAbsolute(rel)) throw new Error('图片路径无效')
  const absPath = path.resolve(projectPath, rel)
  if (!isInside(projectPath, absPath)) throw new Error('图片不在当前工程中')
  return { rel, absPath }
}

// 上传工程内单张图片；文件大小与修改时间都没变则复用缓存链接
export async function uploadProjectImage(projectPath, relFile, { force = false } = {}) {
  if (!projectPath) throw new Error('缺少工程路径')
  const { rel, absPath } = resolveProjectImage(projectPath, relFile)
  if (!fs.existsSync(absPath)) throw new Error('图片不存在或已被移动')

  const stat = fs.statSync(absPath)
  const items = readUploads(projectPath)
  const cached = items[rel]
  if (!force && cached?.url && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return { file: rel, url: cached.url, key: cached.key, cached: true }
  }

  const { key, url } = await uploadImageFile(absPath, readProjectId(projectPath))
  items[rel] = { key, url, size: stat.size, mtimeMs: stat.mtimeMs, uploadedAt: new Date().toISOString() }
  writeUploads(projectPath, items)
  return { file: rel, url, key, cached: false }
}

export function registerCosIpc() {
  ipcMain.handle('cos:status', () => ({ configured: isCosConfigured() }))

  ipcMain.handle('cos:test', () => testCosConnection())

  ipcMain.handle('cos:uploadImage', (_e, payload) => {
    const { projectPath, file, force } = payload || {}
    return uploadProjectImage(projectPath, file, { force })
  })

  // 批量上传：串行执行，避免一次性打满带宽；任一张失败即整体失败
  ipcMain.handle('cos:uploadImages', async (_e, payload) => {
    const { projectPath, files, force } = payload || {}
    const list = Array.isArray(files) ? [...new Set(files.filter(Boolean))] : []
    if (!list.length) throw new Error('没有需要上传的图片')

    const items = []
    for (const file of list) {
      items.push(await uploadProjectImage(projectPath, file, { force }))
    }
    return items
  })
}
