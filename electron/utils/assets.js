// 资产库共用辅助：目录结构、索引与元数据读写
// 结构：assets/index.json、assets/files/、assets/thumbs/、assets/meta/asset_xxx.json
import fs from 'node:fs'
import path from 'node:path'

export function assetsDir(projectPath) {
  const dir = path.join(projectPath, 'assets')
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true })
  return dir
}

export function indexFile(projectPath) {
  return path.join(assetsDir(projectPath), 'index.json')
}

export function readIndex(projectPath) {
  const file = indexFile(projectPath)
  if (!fs.existsSync(file)) return { items: [], folders: [] }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return {
      items: Array.isArray(data.items) ? data.items : [],
      folders: Array.isArray(data.folders) ? data.folders : [],
    }
  } catch {
    return { items: [], folders: [] }
  }
}

// 写入索引：未显式传入 folders 时保留已有文件夹注册表，避免被覆盖清空
export function writeIndex(projectPath, index) {
  const folders = index.folders === undefined ? readIndex(projectPath).folders : index.folders
  const payload = {
    items: Array.isArray(index.items) ? index.items : [],
    folders: Array.isArray(folders) ? folders : [],
  }
  fs.writeFileSync(indexFile(projectPath), JSON.stringify(payload, null, 2), 'utf-8')
}

// 归一化文件夹路径：反斜杠转正斜杠、去空段；「未归档」视作根目录（返回空串）
export function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')
}
export function normFolder(p) {
  const s = normalizePath(p)
  return s === '未归档' ? '' : s
}
// 存储用：根目录统一记作「未归档」，其余保留层级路径
export function storeFolder(p) {
  return normFolder(p) || '未归档'
}

export function metaPath(projectPath, id) {
  return path.join(assetsDir(projectPath), 'meta', `${id}.json`)
}

export function readMeta(projectPath, id) {
  const file = metaPath(projectPath, id)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

export function writeMeta(projectPath, meta) {
  fs.writeFileSync(metaPath(projectPath, meta.id), JSON.stringify(meta, null, 2), 'utf-8')
}

export function toIndexItem(meta) {
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
