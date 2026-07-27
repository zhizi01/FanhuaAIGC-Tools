// 视频生成：火山方舟 Seedance 异步任务（创建 → 轮询 → 下载落盘到工程资产库）
// 文档：https://docs.volcengine.com/docs/82379/1520757（创建）、/1521309（查询）
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'
import { readJson } from '../utils/store.js'
import { assetsDir, readIndex, writeIndex, writeMeta, toIndexItem } from '../utils/assets.js'
import { uploadProjectImage } from './cos.js'

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const ARK_VIDEO_MODEL = 'doubao-seedance-2-0-260128'
const POLL_INTERVAL_MS = 15000
const TASK_TIMEOUT_MS = 15 * 60 * 1000
// Seedance 2.0 多模态参考：参考图片最多 9 张
const MAX_REFERENCE_IMAGES = 9

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

async function parseJsonResponse(res, label) {
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${label}返回异常（${res.status}）：${text.slice(0, 160)}`)
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || res.statusText || '未知错误'
    throw new Error(`${label}错误（${res.status}）：${msg}`)
  }
  return json
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 参与生成的图片统一先上传 COS 拿公网链接（已上传且未改动的自动复用旧链接）
// 受管资产文件（files/、thumbs/ 前缀）实际位于工程 assets/ 目录下，先补全前缀
async function uploadReferenceImages(projectPath, referenceImages) {
  const files = [...new Set((Array.isArray(referenceImages) ? referenceImages : []).filter(Boolean))].slice(
    0,
    MAX_REFERENCE_IMAGES,
  )
  const urls = []
  for (const file of files) {
    const relFile = /^(files|thumbs)\//.test(file) ? `assets/${file}` : file
    const uploaded = await uploadProjectImage(projectPath, relFile)
    urls.push(uploaded.url)
  }
  return urls
}

async function generateShotVideo(payload) {
  const { projectPath, prompt, referenceImages, duration } = payload || {}
  if (!projectPath) throw new Error('缺少工程路径')
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) throw new Error('请先填写分镜提示词')

  const settings = readJson('settings.json', {})
  const apiKey = String(settings?.imageGeneration?.apiKey || process.env.ARK_API_KEY || '').trim()
  if (!apiKey) throw new Error('请先在设置页填写火山方舟 ARK API Key')

  // 默认不让图片参与：纯文本走模型智能模式；仅 @ 提及的图片作为参考图传入
  const content = [{ type: 'text', text: cleanPrompt }]
  const referenceUrls = await uploadReferenceImages(projectPath, referenceImages)
  for (const url of referenceUrls) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
  }

  const body = {
    model: ARK_VIDEO_MODEL,
    content,
    ratio: 'adaptive',
    resolution: '720p',
    generate_audio: true,
    watermark: false,
  }
  // Seedance 2.0 时长仅支持 [4,15] 整数秒，分镜时长不在范围内时交由模型默认
  const dur = Math.round(Number(duration))
  if (dur >= 4 && dur <= 15) body.duration = dur

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  const createRes = await fetchWithTimeout(
    `${ARK_BASE_URL}/contents/generations/tasks`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    60000,
    '创建视频生成任务超时，请重试',
  )
  const created = await parseJsonResponse(createRes, '视频生成服务')
  const taskId = created?.id
  if (!taskId) throw new Error('视频生成服务未返回任务 ID')

  // 轮询任务状态直至成功/失败
  const deadline = Date.now() + TASK_TIMEOUT_MS
  let task = null
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const queryRes = await fetchWithTimeout(
      `${ARK_BASE_URL}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      { headers },
      30000,
      '查询视频生成任务超时，请检查网络',
    )
    task = await parseJsonResponse(queryRes, '查询视频生成任务')
    if (task.status === 'succeeded') break
    if (task.status === 'failed') throw new Error(`视频生成失败：${task?.error?.message || '未知错误'}`)
    if (task.status === 'expired') throw new Error('视频生成任务在平台侧已过期，请重试')
  }
  if (!task || task.status !== 'succeeded') throw new Error('等待视频生成结果超时，请稍后重试')

  const videoUrl = task?.content?.video_url
  if (!videoUrl) throw new Error('视频生成成功但未返回视频地址')

  // video_url 仅 24 小时有效，立即下载落盘到工程资产库
  const videoRes = await fetchWithTimeout(videoUrl, {}, 300000, '下载生成视频超时，请重试')
  if (!videoRes.ok) throw new Error(`下载生成视频失败（${videoRes.status}）`)
  const bytes = Buffer.from(await videoRes.arrayBuffer())

  const dir = assetsDir(projectPath)
  const now = new Date().toISOString()
  const id = genId('asset')
  const fileRel = `files/${id}.mp4`
  fs.writeFileSync(path.join(dir, fileRel), bytes)
  const name = cleanPrompt.slice(0, 16) || 'AI生成视频'
  const usage = {
    promptTokens: 0,
    completionTokens: Number(task?.usage?.completion_tokens) || 0,
    totalTokens: Number(task?.usage?.total_tokens) || 0,
  }
  const meta = {
    id,
    name,
    type: 'video',
    folder: 'AI生成',
    source: 'generated',
    sourceRef: '',
    managedFile: true,
    originalName: `${name}.mp4`,
    file: fileRel,
    thumbnail: '',
    mimeType: 'video/mp4',
    size: bytes.length,
    description: `AI 生成：${cleanPrompt.slice(0, 200)}`,
    prompt: cleanPrompt,
    linkedRoleIds: [],
    linkedEpisodes: [],
    usage: 'AI生成视频',
    createdAt: now,
    updatedAt: now,
  }
  writeMeta(projectPath, meta)
  const index = readIndex(projectPath)
  writeIndex(projectPath, { items: [toIndexItem(meta), ...index.items], folders: index.folders })
  return { asset: toIndexItem(meta), usage }
}

export function registerVideoIpc() {
  ipcMain.handle('video:generateShot', (_e, payload) => generateShotVideo(payload))
}
