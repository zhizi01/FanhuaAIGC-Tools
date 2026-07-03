// 资产库：按工程目录管理素材文件与元数据
// 结构：assets/index.json、assets/files/、assets/thumbs/、assets/meta/asset_xxx.json
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const AUDIO_EXT = ['mp3', 'wav', 'm4a']
const VIDEO_EXT = ['mp4', 'mov', 'webm']
const DOC_EXT = ['txt', 'md', 'docx', 'pdf']

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  txt: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function detectType(ext) {
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (DOC_EXT.includes(ext)) return 'document'
  return 'other'
}

function assetsDir(projectPath) {
  const dir = path.join(projectPath, 'assets')
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true })
  return dir
}

function indexFile(projectPath) {
  return path.join(assetsDir(projectPath), 'index.json')
}

function readIndex(projectPath) {
  const file = indexFile(projectPath)
  if (!fs.existsSync(file)) return { items: [] }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return { items: Array.isArray(data.items) ? data.items : [] }
  } catch {
    return { items: [] }
  }
}

function writeIndex(projectPath, index) {
  fs.writeFileSync(indexFile(projectPath), JSON.stringify(index, null, 2), 'utf-8')
}

function metaPath(projectPath, id) {
  return path.join(assetsDir(projectPath), 'meta', `${id}.json`)
}

function readMeta(projectPath, id) {
  const file = metaPath(projectPath, id)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function writeMeta(projectPath, meta) {
  fs.writeFileSync(metaPath(projectPath, meta.id), JSON.stringify(meta, null, 2), 'utf-8')
}

function toIndexItem(meta) {
  return {
    id: meta.id,
    name: meta.name,
    type: meta.type,
    category: meta.category,
    file: meta.file,
    thumbnail: meta.thumbnail,
    tags: meta.tags || [],
    linkedRoleIds: meta.linkedRoleIds || [],
    linkedEpisodes: meta.linkedEpisodes || [],
    updatedAt: meta.updatedAt,
  }
}

function toArray(v) {
  return Array.isArray(v) ? v : []
}

export function registerAssetsIpc() {
  ipcMain.handle('assets:list', (_e, projectPath) => {
    if (!projectPath) return []
    return readIndex(projectPath).items
  })

  ipcMain.handle('assets:read', (_e, payload) => {
    const { projectPath, assetId } = payload || {}
    if (!projectPath || !assetId) throw new Error('缺少工程路径或资产ID')
    const meta = readMeta(projectPath, assetId)
    if (!meta) throw new Error('资产不存在')
    return meta
  })

  // 保存资产元数据（编辑名称/分类/标签/描述/关联等，不改动文件本体）
  ipcMain.handle('assets:save', (_e, payload) => {
    const { projectPath, asset } = payload || {}
    if (!projectPath || !asset?.id) throw new Error('缺少工程路径或资产数据')
    const cur = readMeta(projectPath, asset.id)
    if (!cur) throw new Error('资产不存在')

    const meta = {
      ...cur,
      name: asset.name ?? cur.name,
      category: asset.category ?? cur.category,
      description: asset.description ?? cur.description,
      usage: asset.usage ?? cur.usage,
      tags: toArray(asset.tags),
      linkedRoleIds: toArray(asset.linkedRoleIds),
      linkedEpisodes: toArray(asset.linkedEpisodes),
      updatedAt: new Date().toISOString(),
    }
    writeMeta(projectPath, meta)

    const index = readIndex(projectPath)
    const rest = index.items.filter((it) => it.id !== meta.id)
    writeIndex(projectPath, { items: [toIndexItem(meta), ...rest] })
    return meta
  })

  // 删除资产：清理 files/thumbs/meta 与索引（只删工程内副本）
  ipcMain.handle('assets:remove', (_e, payload) => {
    const { projectPath, assetId } = payload || {}
    if (!projectPath || !assetId) throw new Error('缺少工程路径或资产ID')
    const meta = readMeta(projectPath, assetId)
    const dir = assetsDir(projectPath)
    if (meta) {
      if (meta.file) fs.rmSync(path.join(dir, meta.file), { force: true })
      if (meta.thumbnail) fs.rmSync(path.join(dir, meta.thumbnail), { force: true })
    }
    fs.rmSync(metaPath(projectPath, assetId), { force: true })
    const index = readIndex(projectPath)
    writeIndex(projectPath, { items: index.items.filter((it) => it.id !== assetId) })
    return true
  })

  // 导入资产：复制到工程内 files/（图片同时复制为缩略图），生成 meta 与索引
  ipcMain.handle('assets:import', (_e, payload) => {
    const { projectPath, filePaths } = payload || {}
    if (!projectPath) throw new Error('缺少工程路径')
    const list = Array.isArray(filePaths) ? filePaths : []
    const dir = assetsDir(projectPath)
    const now = new Date().toISOString()
    const created = []

    for (const fp of list) {
      if (!fp || !fs.existsSync(fp)) continue
      const originalName = path.basename(fp)
      const ext = path.extname(fp).slice(1).toLowerCase()
      const type = detectType(ext)
      const id = genId('asset')
      const fileRel = `files/${id}${ext ? '.' + ext : ''}`
      fs.copyFileSync(fp, path.join(dir, fileRel))

      let thumbRel = ''
      if (type === 'image') {
        thumbRel = `thumbs/${id}.${ext}`
        try {
          fs.copyFileSync(fp, path.join(dir, thumbRel))
        } catch {
          thumbRel = ''
        }
      }

      let size = 0
      try {
        size = fs.statSync(fp).size
      } catch {
        size = 0
      }

      const meta = {
        id,
        name: originalName.replace(/\.[^.]+$/, '') || '未命名资产',
        type,
        category: '其他',
        source: 'import',
        originalName,
        file: fileRel,
        thumbnail: thumbRel,
        mimeType: MIME[ext] || '',
        size,
        description: '',
        tags: [],
        linkedRoleIds: [],
        linkedEpisodes: [],
        usage: '',
        createdAt: now,
        updatedAt: now,
      }
      writeMeta(projectPath, meta)
      created.push(toIndexItem(meta))
    }

    // 更新索引（新导入的放在前面）
    const index = readIndex(projectPath)
    writeIndex(projectPath, { items: [...created, ...index.items] })
    return created
  })
}
