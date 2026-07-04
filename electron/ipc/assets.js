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
    folder: meta.folder || meta.category || '未归档',
    file: meta.file,
    thumbnail: meta.thumbnail,
    linkedRoleIds: meta.linkedRoleIds || [],
    linkedEpisodes: meta.linkedEpisodes || [],
    source: meta.source || 'import',
    sourceRef: meta.sourceRef || '',
    updatedAt: meta.updatedAt,
  }
}

function toArray(v) {
  return Array.isArray(v) ? v : []
}

export function registerAssetsIpc() {
  ipcMain.handle('assets:list', (_e, projectPath) => {
    if (!projectPath) return []
    return readIndex(projectPath).items.map((item) => ({
      ...item,
      folder: item.folder || item.category || '未归档',
    }))
  })

  ipcMain.handle('assets:read', (_e, payload) => {
    const { projectPath, assetId } = payload || {}
    if (!projectPath || !assetId) throw new Error('缺少工程路径或资产ID')
    const meta = readMeta(projectPath, assetId)
    if (!meta) throw new Error('资产不存在')
    return meta
  })

  // 保存资产元数据（编辑名称/文件夹/描述/关联等，不改动文件本体）
  ipcMain.handle('assets:save', (_e, payload) => {
    const { projectPath, asset } = payload || {}
    if (!projectPath || !asset?.id) throw new Error('缺少工程路径或资产数据')
    const cur = readMeta(projectPath, asset.id)
    if (!cur) throw new Error('资产不存在')

    const meta = {
      ...cur,
      name: asset.name ?? cur.name,
      folder: asset.folder ?? cur.folder ?? cur.category ?? '未归档',
      description: asset.description ?? cur.description,
      usage: asset.usage ?? cur.usage,
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
      // 导入资产删除工程内副本；项目生成资产只删除资产库登记，不删除原始剧本/生成内容
      if (meta.managedFile !== false && meta.file) fs.rmSync(path.join(dir, meta.file), { force: true })
      if (meta.managedFile !== false && meta.thumbnail) fs.rmSync(path.join(dir, meta.thumbnail), { force: true })
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
        folder: '导入资产',
        source: 'import',
        sourceRef: '',
        managedFile: true,
        originalName,
        file: fileRel,
        thumbnail: thumbRel,
        mimeType: MIME[ext] || '',
        size,
        description: '',
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

  // 同步项目内已生成/创作的资源到资产库。第一阶段先登记剧本总览与分集 Markdown。
  ipcMain.handle('assets:syncGenerated', (_e, projectPath) => {
    if (!projectPath) throw new Error('缺少工程路径')
    const now = new Date().toISOString()
    const index = readIndex(projectPath)
    const bySourceRef = new Map()
    for (const item of index.items) {
      if (item.sourceRef) bySourceRef.set(item.sourceRef, item)
    }

    const synced = []
    const scriptsIndexFile = path.join(projectPath, 'scripts', 'index.json')
    if (fs.existsSync(scriptsIndexFile)) {
      let scripts = []
      try {
        const data = JSON.parse(fs.readFileSync(scriptsIndexFile, 'utf-8'))
        scripts = Array.isArray(data.items) ? data.items : []
      } catch {
        scripts = []
      }

      for (const script of scripts) {
        const scriptDir = path.join(projectPath, 'scripts', script.id)
        const metaFile = path.join(scriptDir, 'meta.json')
        if (!fs.existsSync(metaFile)) continue
        let scriptMeta
        try {
          scriptMeta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
        } catch {
          continue
        }

        const docs = [
          {
            sourceRef: `script:${script.id}:overview`,
            name: `${scriptMeta.title || script.title || '剧本'} - 总览`,
            file: `scripts/${script.id}/overview.md`,
            linkedEpisodes: [],
          },
          ...(scriptMeta.episodes || []).map((ep) => ({
            sourceRef: `script:${script.id}:episode:${ep.episodeNo}`,
            name: `${scriptMeta.title || script.title || '剧本'} - 第${ep.episodeNo}集`,
            file: `scripts/${script.id}/${ep.file}`,
            linkedEpisodes: [ep.episodeNo],
          })),
        ]

        for (const doc of docs) {
          const abs = path.join(projectPath, doc.file)
          if (!fs.existsSync(abs)) continue
          const exists = bySourceRef.get(doc.sourceRef)
          const id = exists?.id || genId('asset')
          let size = 0
          try {
            size = fs.statSync(abs).size
          } catch {
            size = 0
          }
          const oldMeta = exists ? readMeta(projectPath, exists.id) : null
          const meta = {
            ...(oldMeta || {}),
            id,
            name: oldMeta?.name || doc.name,
            type: 'document',
            folder: oldMeta?.folder || '剧本',
            source: 'generated',
            sourceRef: doc.sourceRef,
            managedFile: false,
            originalName: path.basename(doc.file),
            file: doc.file,
            thumbnail: '',
            mimeType: 'text/markdown',
            size,
            description: oldMeta?.description || '项目剧本生成/创作内容，作为文档资产统一管理。',
            linkedRoleIds: toArray(oldMeta?.linkedRoleIds),
            linkedEpisodes: doc.linkedEpisodes,
            usage: oldMeta?.usage || '剧本文档',
            createdAt: oldMeta?.createdAt || now,
            updatedAt: now,
          }
          writeMeta(projectPath, meta)
          synced.push(toIndexItem(meta))
        }
      }
    }

    const syncedIds = new Set(synced.map((it) => it.id))
    const rest = index.items.filter((it) => !syncedIds.has(it.id))
    writeIndex(projectPath, { items: [...synced, ...rest] })
    return synced
  })
}
