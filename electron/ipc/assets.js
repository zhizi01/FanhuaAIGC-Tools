// 资产库：按工程目录管理素材文件与元数据（目录/索引/元数据读写见 utils/assets.js）
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'
import {
  assetsDir,
  readIndex,
  writeIndex,
  metaPath,
  readMeta,
  writeMeta,
  toIndexItem,
  normalizePath,
  normFolder,
  storeFolder,
} from '../utils/assets.js'

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

// 解析 OpenAI 兼容图片接口返回：兼容 b64_json 与 url 两种形式
async function parseImageResponse(res) {
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`图片服务返回异常（${res.status}）：${text.slice(0, 160)}`)
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || res.statusText || '未知错误'
    throw new Error(`图片服务错误（${res.status}）：${msg}`)
  }
  const item = (json?.data && json.data[0]) || {}
  return { b64: item.b64_json || '', url: item.url || '' }
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

  // 文件夹注册表（含空文件夹）：{ path, type, createdAt }，供资产库像文件管理器一样管理层级
  ipcMain.handle('assets:folders', (_e, projectPath) => {
    if (!projectPath) return []
    return readIndex(projectPath).folders
  })

  // 新建文件夹（支持在当前层级下创建子文件夹），会自动补齐祖先层级
  ipcMain.handle('assets:createFolder', (_e, payload) => {
    const { projectPath, type, path: rawPath } = payload || {}
    if (!projectPath || !type) throw new Error('缺少工程路径或资产类型')
    const p = normFolder(rawPath)
    if (!p) throw new Error('文件夹名称不能为空')
    const index = readIndex(projectPath)
    const folders = index.folders
    if (folders.some((f) => f.type === type && normalizePath(f.path) === p)) {
      throw new Error('同名文件夹已存在')
    }
    const now = new Date().toISOString()
    let acc = ''
    for (const seg of p.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg
      if (!folders.some((f) => f.type === type && normalizePath(f.path) === acc)) {
        folders.push({ path: acc, type, createdAt: now })
      }
    }
    writeIndex(projectPath, { items: index.items, folders })
    return folders
  })

  // 重命名文件夹：同步更新其子孙文件夹与其中资产的所属路径
  ipcMain.handle('assets:renameFolder', (_e, payload) => {
    const { projectPath, type, path: rawPath, name } = payload || {}
    if (!projectPath || !type) throw new Error('缺少工程路径或资产类型')
    const p = normFolder(rawPath)
    const leaf = normalizePath(name)
    if (!p) throw new Error('无法重命名根目录')
    if (!leaf || leaf.includes('/')) throw new Error('文件夹名称不合法')
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    const newPath = parent ? `${parent}/${leaf}` : leaf
    const index = readIndex(projectPath)
    if (newPath === p) return { folders: index.folders, items: index.items }
    if (index.folders.some((f) => f.type === type && normalizePath(f.path) === newPath)) {
      throw new Error('同级已存在同名文件夹')
    }
    const prefix = `${p}/`
    const remap = (fp) => (fp === p ? newPath : fp.startsWith(prefix) ? newPath + fp.slice(p.length) : fp)
    const now = new Date().toISOString()
    const folders = index.folders.map((f) => {
      if (f.type !== type) return f
      const fp = normalizePath(f.path)
      return fp === p || fp.startsWith(prefix) ? { ...f, path: remap(fp) } : f
    })
    const items = index.items.map((it) => {
      if (it.type !== type) return it
      const fp = normFolder(it.folder)
      if (fp !== p && !fp.startsWith(prefix)) return it
      const np = storeFolder(remap(fp))
      const meta = readMeta(projectPath, it.id)
      if (meta) {
        meta.folder = np
        meta.updatedAt = now
        writeMeta(projectPath, meta)
      }
      return { ...it, folder: np }
    })
    writeIndex(projectPath, { items, folders })
    return { folders, items }
  })

  // 删除文件夹：其中（含子孙）资产移回根目录「未归档」，仅移除文件夹登记，不删除资产文件
  ipcMain.handle('assets:removeFolder', (_e, payload) => {
    const { projectPath, type, path: rawPath } = payload || {}
    if (!projectPath || !type) throw new Error('缺少工程路径或资产类型')
    const p = normFolder(rawPath)
    if (!p) throw new Error('无法删除根目录')
    const index = readIndex(projectPath)
    const prefix = `${p}/`
    const folders = index.folders.filter(
      (f) => !(f.type === type && (normalizePath(f.path) === p || normalizePath(f.path).startsWith(prefix))),
    )
    const now = new Date().toISOString()
    const items = index.items.map((it) => {
      if (it.type !== type) return it
      const fp = normFolder(it.folder)
      if (fp !== p && !fp.startsWith(prefix)) return it
      const meta = readMeta(projectPath, it.id)
      if (meta) {
        meta.folder = '未归档'
        meta.updatedAt = now
        writeMeta(projectPath, meta)
      }
      return { ...it, folder: '未归档' }
    })
    writeIndex(projectPath, { items, folders })
    return { folders, items }
  })

  // AI 生成图片：OpenAI 兼容接口（无参考图走 /images/generations，有参考图走 /images/edits），
  // 出图后存入资产库并返回资产条目；主进程执行以便读取本地参考图字节与落盘。
  ipcMain.handle('assets:generateImage', async (_e, payload) => {
    const { projectPath, model, prompt, references, folder, size } = payload || {}
    if (!projectPath) throw new Error('缺少工程路径')
    if (!model?.baseUrl || !model?.apiKey || !model?.modelCode) {
      throw new Error('模型配置不完整，请在设置中检查服务地址、APIKEY 与模型代码')
    }
    const desc = String(prompt || '').trim()
    if (!desc) throw new Error('请填写生成描述')

    const base = String(model.baseUrl).replace(/\/+$/, '')
    const refs = (Array.isArray(references) ? references : [])
      .map((r) => {
        if (r?.type !== 'asset') return r?.value || ''
        // 受管资产文件位于工程 assets/ 目录下（索引记为 files|thumbs/xxx）
        const rel = /^(files|thumbs)\//.test(r.value || '') ? path.join('assets', r.value) : r.value || ''
        return rel ? path.join(projectPath, rel) : ''
      })
      .filter((abs) => abs && fs.existsSync(abs))
    const imgSize = size || '1024x1024'

    let result
    if (refs.length) {
      const form = new FormData()
      form.append('model', model.modelCode)
      form.append('prompt', desc)
      form.append('size', imgSize)
      form.append('n', '1')
      const field = refs.length > 1 ? 'image[]' : 'image'
      for (const abs of refs) {
        const buf = fs.readFileSync(abs)
        const ext = path.extname(abs).slice(1).toLowerCase() || 'png'
        form.append(field, new Blob([buf], { type: MIME[ext] || 'image/png' }), path.basename(abs))
      }
      const res = await fetch(`${base}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${model.apiKey}` },
        body: form,
      })
      result = await parseImageResponse(res)
    } else {
      const res = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
        body: JSON.stringify({ model: model.modelCode, prompt: desc, n: 1, size: imgSize }),
      })
      result = await parseImageResponse(res)
    }

    let bytes
    if (result.b64) {
      bytes = Buffer.from(result.b64, 'base64')
    } else if (result.url) {
      const r = await fetch(result.url)
      if (!r.ok) throw new Error(`下载生成图片失败（${r.status}）`)
      bytes = Buffer.from(await r.arrayBuffer())
    } else {
      throw new Error('模型未返回图片数据')
    }

    const dir = assetsDir(projectPath)
    const now = new Date().toISOString()
    const id = genId('asset')
    const fileRel = `files/${id}.png`
    fs.writeFileSync(path.join(dir, fileRel), bytes)
    let thumbRel = `thumbs/${id}.png`
    try {
      fs.writeFileSync(path.join(dir, thumbRel), bytes)
    } catch {
      thumbRel = ''
    }
    const name = desc.slice(0, 16) || 'AI生成图片'
    const meta = {
      id,
      name,
      type: 'image',
      folder: folder ? storeFolder(folder) : 'AI生成',
      source: 'generated',
      sourceRef: '',
      managedFile: true,
      originalName: `${name}.png`,
      file: fileRel,
      thumbnail: thumbRel,
      mimeType: 'image/png',
      size: bytes.length,
      description: `AI 生成：${desc.slice(0, 200)}`,
      prompt: desc,
      linkedRoleIds: [],
      linkedEpisodes: [],
      usage: 'AI生成图片',
      createdAt: now,
      updatedAt: now,
    }
    writeMeta(projectPath, meta)
    const index = readIndex(projectPath)
    writeIndex(projectPath, { items: [toIndexItem(meta), ...index.items], folders: index.folders })
    return toIndexItem(meta)
  })

  // 移动资产到指定文件夹（供拖拽/详情面板使用）
  ipcMain.handle('assets:move', (_e, payload) => {
    const { projectPath, assetId, folder } = payload || {}
    if (!projectPath || !assetId) throw new Error('缺少工程路径或资产ID')
    const meta = readMeta(projectPath, assetId)
    if (!meta) throw new Error('资产不存在')
    meta.folder = storeFolder(folder)
    meta.updatedAt = new Date().toISOString()
    writeMeta(projectPath, meta)
    const index = readIndex(projectPath)
    const items = index.items.map((it) => (it.id === assetId ? { ...it, folder: meta.folder } : it))
    writeIndex(projectPath, { items, folders: index.folders })
    return meta
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
    const { projectPath, filePaths, folder } = payload || {}
    if (!projectPath) throw new Error('缺少工程路径')
    const list = Array.isArray(filePaths) ? filePaths : []
    const targetFolder = storeFolder(folder)
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
        folder: targetFolder,
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
