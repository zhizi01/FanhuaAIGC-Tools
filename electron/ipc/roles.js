// 角色库：按工程目录读写角色，维护 roles/index.json 索引
// 结构：roles/index.json、roles/role_xxx/meta.json、roles/role_xxx/profile.md
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'
import { readJson } from '../utils/store.js'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}
const ARK_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
const ARK_IMAGE_MODEL = 'doubao-seedream-5-0-260128'
const MAX_REFERENCE_IMAGES = 10
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const MAX_REFERENCE_TOTAL_BYTES = 30 * 1024 * 1024
const MAX_GENERATED_BYTES = 50 * 1024 * 1024

// 主进程再做一层串行保护，确保任何入口都不会并发调用固定图片模型。
let imageGenerationTail = Promise.resolve()

function enqueueImageGeneration(run) {
  const task = imageGenerationTail.then(run)
  imageGenerationTail = task.catch(() => {})
  return task
}

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

function isInside(root, target) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  return normalize(resolvedTarget).startsWith(normalize(resolvedRoot + path.sep))
}

function roleMetaFile(projectPath, roleId) {
  const id = String(roleId || '').trim()
  if (!id || id !== path.basename(id)) throw new Error('角色ID无效')
  return path.join(rolesDir(projectPath), id, 'meta.json')
}

function resolveReferenceImage(projectPath, relFile) {
  const rel = String(relFile || '').trim()
  if (!rel || path.isAbsolute(rel)) throw new Error('参考图路径无效')
  const projectRoot = path.resolve(projectPath)
  const filePath = path.resolve(projectRoot, rel)
  if (!isInside(projectRoot, filePath)) throw new Error('参考图不在当前工程中')
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!IMAGE_EXT.includes(ext)) throw new Error('参考图格式不受支持')
  return { filePath, ext }
}

function referenceImagesAsDataUrls(projectPath, references) {
  const files = [...new Set(toArray(references).filter(Boolean))].slice(0, MAX_REFERENCE_IMAGES)
  let totalBytes = 0
  return files.map((relFile) => {
    const { filePath, ext } = resolveReferenceImage(projectPath, relFile)
    if (!fs.existsSync(filePath)) throw new Error('参考图不存在或已被移动')
    const buffer = fs.readFileSync(filePath)
    if (buffer.length > MAX_REFERENCE_BYTES) throw new Error('单张参考图不能超过 10 MB')
    totalBytes += buffer.length
    if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) throw new Error('参考图总大小不能超过 30 MB')
    return `data:${IMAGE_MIME[ext]};base64,${buffer.toString('base64')}`
  })
}

async function fetchWithTimeout(url, options, timeoutMs, timeoutMessage) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(timeoutMessage)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function generatedImageExtension(contentType, imageUrl) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg'
  try {
    const ext = path.extname(new URL(imageUrl).pathname).slice(1).toLowerCase()
    if (IMAGE_EXT.includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  } catch {
    // 后续统一回退为 jpg
  }
  return 'jpg'
}

function normalizedImageUsage(usage) {
  const promptTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens) || 0
  const completionTokens = Number(usage?.output_tokens ?? usage?.completion_tokens) || 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(usage?.total_tokens) || promptTokens + completionTokens,
    generatedImages: Number(usage?.generated_images) || 1,
  }
}

async function generateRoleImage(payload) {
  const { projectPath, roleId, prompt, referenceImages } = payload || {}
  const cleanPrompt = String(prompt || '').trim()
  if (!projectPath || !roleId) throw new Error('缺少工程路径或角色ID')
  if (!cleanPrompt) throw new Error('人物形象提示词不能为空')
  if (cleanPrompt.length > 6000) throw new Error('生成提示词过长，请精简后重试')

  const metaFile = roleMetaFile(projectPath, roleId)
  if (!fs.existsSync(metaFile)) throw new Error('请先保存角色，再生成形象图')
  const settings = readJson('settings.json', {})
  const apiKey = String(settings?.imageGeneration?.apiKey || process.env.ARK_API_KEY || '').trim()
  if (!apiKey) throw new Error('请先在设置页填写火山方舟 ARK API Key')

  const images = referenceImagesAsDataUrls(projectPath, referenceImages)
  const requestBody = {
    model: ARK_IMAGE_MODEL,
    prompt: cleanPrompt,
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: '2K',
    stream: false,
    watermark: false,
  }
  if (images.length) requestBody.image = images

  const response = await fetchWithTimeout(
    ARK_IMAGE_ENDPOINT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
    180000,
    '图片生成请求超时，请稍后重试',
  )
  const raw = await response.text()
  let result
  try {
    result = JSON.parse(raw)
  } catch {
    throw new Error(`图片服务返回了无法解析的响应（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    const detail = result?.error?.message || result?.message || response.statusText || '未知错误'
    throw new Error(`图片生成失败（HTTP ${response.status}）：${detail}`)
  }

  const imageUrl = String(result?.data?.find((item) => item?.url)?.url || '').trim()
  if (!imageUrl) throw new Error('图片服务未返回可下载的图片地址')
  let parsedUrl
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    throw new Error('图片服务返回的下载地址无效')
  }
  if (parsedUrl.protocol !== 'https:') throw new Error('图片服务返回了不安全的下载地址')

  const download = await fetchWithTimeout(
    imageUrl,
    { method: 'GET', redirect: 'follow' },
    120000,
    '生成图片下载超时，请稍后重试',
  )
  if (!download.ok) throw new Error(`生成图片下载失败（HTTP ${download.status}）`)
  const contentType = download.headers.get('content-type') || ''
  const buffer = Buffer.from(await download.arrayBuffer())
  if (!buffer.length) throw new Error('下载到的生成图片为空')
  if (buffer.length > MAX_GENERATED_BYTES) throw new Error('生成图片超过 50 MB，已停止保存')

  const extension = generatedImageExtension(contentType, imageUrl)
  const imageDir = path.join(rolesDir(projectPath), roleId, 'images')
  fs.mkdirSync(imageDir, { recursive: true })
  const name = `${genId('img')}.${extension}`
  const outputFile = path.join(imageDir, name)
  await fs.promises.writeFile(outputFile, buffer)
  const relativeFile = `roles/${roleId}/images/${name}`

  try {
    // 下载完成后读取最新角色数据再合并，避免覆盖生成期间用户保存的字段。
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    meta.images = [...new Set([...toArray(meta.images), relativeFile])]
    meta.updatedAt = new Date().toISOString()
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8')

    const index = readIndex(projectPath)
    const oldItem = index.items.find((item) => item.id === roleId) || {}
    const item = {
      ...oldItem,
      id: roleId,
      name: meta.name || '未命名角色',
      roleType: meta.roleType || '配角',
      gender: meta.gender || '',
      age: meta.age || '',
      identity: meta.identity || '',
      cover: meta.images[0] || '',
      updatedAt: meta.updatedAt,
      dir: roleId,
    }
    writeIndex(projectPath, { items: [item, ...index.items.filter((it) => it.id !== roleId)] })
  } catch (err) {
    await fs.promises.rm(outputFile, { force: true }).catch(() => {})
    throw new Error(`生成图片保存失败：${err?.message || String(err)}`)
  }

  return {
    file: relativeFile,
    size: result?.data?.[0]?.size || '',
    model: result?.model || ARK_IMAGE_MODEL,
    usage: normalizedImageUsage(result?.usage),
  }
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

  // 固定 Seedream 5.0 模型；任务在主进程串行执行，成功后下载并写入角色目录。
  ipcMain.handle('roles:generateImage', (_e, payload) =>
    enqueueImageGeneration(() => generateRoleImage(payload)),
  )

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
