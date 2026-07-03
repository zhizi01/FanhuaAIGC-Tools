// 角色库：按工程目录读写角色，维护 roles/index.json 索引
// 结构：roles/index.json、roles/role_xxx/meta.json、roles/role_xxx/profile.md
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'

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
    return readIndex(projectPath).items
  })

  // 读取单个角色（结构化 meta + Markdown 设定）
  ipcMain.handle('roles:read', (_e, payload) => {
    const { projectPath, roleId } = payload || {}
    if (!projectPath || !roleId) throw new Error('缺少工程路径或角色ID')
    const dir = path.join(rolesDir(projectPath), roleId)
    const metaFile = path.join(dir, 'meta.json')
    if (!fs.existsSync(metaFile)) throw new Error('角色不存在')
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    const profileFile = path.join(dir, 'profile.md')
    const profile = fs.existsSync(profileFile) ? fs.readFileSync(profileFile, 'utf-8') : ''
    return { meta, profile }
  })

  // 保存角色：写入 meta.json / profile.md，并更新索引
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
      tags: toArray(role.tags),
      avatarAssetId: role.avatarAssetId || '',
      referenceAssetIds: toArray(role.referenceAssetIds),
      appearEpisodes: toArray(role.appearEpisodes),
      relations: toArray(role.relations),
      createdAt: role.createdAt || now,
      updatedAt: now,
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    fs.writeFileSync(path.join(dir, 'profile.md'), role.profile || '', 'utf-8')

    // 更新索引
    const index = readIndex(projectPath)
    const item = {
      id,
      name: meta.name,
      roleType: meta.roleType,
      gender: meta.gender,
      age: meta.age,
      tags: meta.tags,
      avatarAssetId: meta.avatarAssetId,
      appearEpisodes: meta.appearEpisodes,
      updatedAt: meta.updatedAt,
      dir: id,
    }
    const rest = index.items.filter((it) => it.id !== id)
    writeIndex(projectPath, { items: [item, ...rest] })

    return meta
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
