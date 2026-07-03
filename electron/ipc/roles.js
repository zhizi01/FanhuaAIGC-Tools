// 角色库：按工程目录读写角色，维护 roles/index.json 索引
// 结构：roles/index.json、roles/role_xxx/meta.json、roles/role_xxx/profile.md
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']

function rolesDir(projectPath) {
  const dir = path.join(projectPath, 'roles')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function indexFile(projectPath) {
  return path.join(rolesDir(projectPath), 'index.json')
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

function toArray(v) {
  return Array.isArray(v) ? v : []
}

export function registerRolesIpc() {
  // 角色列表
  ipcMain.handle('roles:list', (_e, projectPath) => {
    if (!projectPath) return []
    return readIndex(projectPath).items.map((item) => {
      if (item.identity != null) return item
      try {
        const metaFile = path.join(rolesDir(projectPath), item.id, 'meta.json')
        if (!fs.existsSync(metaFile)) return item
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
        return {
          ...item,
          identity: meta.identity || '',
          gender: item.gender || meta.gender || '',
          age: item.age || meta.age || '',
        }
      } catch {
        return item
      }
    })
  })

  // 读取单个角色（结构化 JSON meta）
  ipcMain.handle('roles:read', (_e, payload) => {
    const { projectPath, roleId } = payload || {}
    if (!projectPath || !roleId) throw new Error('缺少工程路径或角色ID')
    const metaFile = path.join(rolesDir(projectPath), roleId, 'meta.json')
    if (!fs.existsSync(metaFile)) throw new Error('角色不存在')
    return JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
  })

  // 保存角色：以 JSON（meta.json）管理，并更新索引
  ipcMain.handle('roles:save', (_e, payload) => {
    const { projectPath, role } = payload || {}
    if (!projectPath || !role) throw new Error('缺少工程路径或角色数据')

    const now = new Date().toISOString()
    const id = role.id || genId('role')
    const dir = path.join(rolesDir(projectPath), id)
    fs.mkdirSync(dir, { recursive: true })

    const meta = {
      id,
      name: role.name || '未命名角色',
      roleType: role.roleType || '配角',
      gender: role.gender || '',
      age: role.age || '',
      identity: role.identity || '',
      personality: role.personality || '',
      motivation: role.motivation || '',
      appearance: role.appearance || '',
      voice: role.voice || '',
      images: toArray(role.images), // 角色形象图（工程内相对路径数组，支持多张）
      voiceLine: role.voiceLine || '', // 角色声线（文本描述，供视频/配音模型使用）
      createdAt: role.createdAt || now,
      updatedAt: now,
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

    // 更新索引
    const index = readIndex(projectPath)
    const item = {
      id,
      name: meta.name,
      roleType: meta.roleType,
      gender: meta.gender,
      age: meta.age,
      identity: meta.identity,
      cover: meta.images[0] || '', // 列表卡片缩略图
      updatedAt: meta.updatedAt,
      dir: id,
    }
    const rest = index.items.filter((it) => it.id !== id)
    writeIndex(projectPath, { items: [item, ...rest] })

    return meta
  })

  // 上传角色形象图：复制到 roles/<roleId>/images/，返回相对工程路径数组
  ipcMain.handle('roles:importImages', (_e, payload) => {
    const { projectPath, roleId, filePaths } = payload || {}
    if (!projectPath || !roleId) throw new Error('缺少工程路径或角色ID')
    const imgDir = path.join(rolesDir(projectPath), roleId, 'images')
    fs.mkdirSync(imgDir, { recursive: true })
    const added = []
    for (const fp of Array.isArray(filePaths) ? filePaths : []) {
      if (!fp || !fs.existsSync(fp)) continue
      const ext = path.extname(fp).slice(1).toLowerCase()
      if (!IMAGE_EXT.includes(ext)) continue
      const name = `${genId('img')}.${ext}`
      fs.copyFileSync(fp, path.join(imgDir, name))
      added.push(`roles/${roleId}/images/${name}`)
    }
    return added
  })

  // 删除某张角色形象图（仅删除工程内副本）
  ipcMain.handle('roles:removeImage', (_e, payload) => {
    const { projectPath, file } = payload || {}
    if (!projectPath || !file) throw new Error('缺少工程路径或文件')
    const abs = path.join(projectPath, file)
    if (abs.startsWith(rolesDir(projectPath)) && fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true })
    }
    return true
  })

  // 删除角色目录并更新索引
  ipcMain.handle('roles:remove', (_e, payload) => {
    const { projectPath, roleId } = payload || {}
    if (!projectPath || !roleId) throw new Error('缺少工程路径或角色ID')
    const dir = path.join(rolesDir(projectPath), roleId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    const index = readIndex(projectPath)
    writeIndex(projectPath, { items: index.items.filter((it) => it.id !== roleId) })
    return true
  })
}
