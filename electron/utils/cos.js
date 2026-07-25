// 腾讯云 COS 对象存储：把工程内的本地图片上传成公网链接
// 视频生成模型只接受图片链接（不支持本地文件 / base64），因此参与生成的图片需要先云存
import COS from 'cos-nodejs-sdk-v5'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson } from './store.js'

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

// 单张图片上限，超过则不上传，避免长时间卡住生成流程
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

// 复用同一个 COS 实例；密钥变更时重建
let cachedClient = null
let cachedCredential = ''

// 从全局设置读取 COS 配置
export function readCosConfig() {
  const cos = readJson('settings.json', null)?.cos || {}
  return {
    secretId: String(cos.secretId || '').trim(),
    secretKey: String(cos.secretKey || '').trim(),
    bucket: String(cos.bucket || '').trim(),
    region: String(cos.region || '').trim(),
    prefix: String(cos.prefix || '').trim(),
    domain: String(cos.domain || '').trim(),
  }
}

export function isCosConfigured() {
  const cfg = readCosConfig()
  return !!(cfg.secretId && cfg.secretKey && cfg.bucket && cfg.region)
}

function assertConfigured(cfg) {
  if (!cfg.secretId || !cfg.secretKey) {
    throw new Error('未配置腾讯云 SecretId / SecretKey，请前往「设置 - 腾讯云 COS 对象存储」填写')
  }
  if (!cfg.bucket || !cfg.region) {
    throw new Error('未配置 COS 存储桶或所属地域，请前往「设置 - 腾讯云 COS 对象存储」填写')
  }
}

function getClient(cfg) {
  const credential = `${cfg.secretId}:${cfg.secretKey}`
  if (!cachedClient || cachedCredential !== credential) {
    cachedClient = new COS({
      SecretId: cfg.secretId,
      SecretKey: cfg.secretKey,
      Timeout: 60000,
    })
    cachedCredential = credential
  }
  return cachedClient
}

// COS SDK 抛出的错误是对象而非 Error，这里统一整理成可读的中文提示
function toReadableError(err, action) {
  const code = err?.error?.Code || err?.code || ''
  const detail = err?.error?.Message || err?.message || (typeof err?.error === 'string' ? err.error : '')
  if (code === 'NoSuchBucket') return new Error('存储桶不存在，请检查存储桶名称与地域')
  if (code === 'AccessDenied' || err?.statusCode === 403) {
    return new Error('COS 拒绝访问，请检查密钥权限或存储桶名称是否正确')
  }
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
    return new Error('SecretId / SecretKey 不正确')
  }
  return new Error(`${action}：${detail || code || '未知错误'}`)
}

// 对象键统一为 uuid.jpg（可带目录前缀）
function buildObjectKey(prefix) {
  const dir = prefix.replace(/^\/+|\/+$/g, '')
  const name = `${randomUUID()}.jpg`
  return dir ? `${dir}/${name}` : name
}

function buildPublicUrl(cfg, key) {
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  if (cfg.domain) return `${cfg.domain.replace(/\/+$/, '')}/${encoded}`
  return `https://${cfg.bucket}.cos.${cfg.region}.myqcloud.com/${encoded}`
}

// 上传单个本地图片文件，返回 { key, url }
export async function uploadImageFile(absPath) {
  const cfg = readCosConfig()
  assertConfigured(cfg)

  if (!fs.existsSync(absPath)) throw new Error('待上传的图片不存在或已被移动')
  const ext = path.extname(absPath).toLowerCase()
  const contentType = IMAGE_MIME[ext]
  if (!contentType) throw new Error(`不支持上传的图片格式：${ext || '未知'}`)

  const size = fs.statSync(absPath).size
  if (size > MAX_UPLOAD_BYTES) throw new Error('单张图片不能超过 20 MB')

  const key = buildObjectKey(cfg.prefix)
  try {
    await getClient(cfg).putObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: key,
      Body: fs.createReadStream(absPath),
      ContentLength: size,
      // 对象名统一为 uuid.jpg，但 ContentType 仍按真实格式声明，避免下游读取时解码失败
      ContentType: contentType,
    })
  } catch (err) {
    throw toReadableError(err, '图片上传失败')
  }

  return { key, url: buildPublicUrl(cfg, key), size }
}

// 测试当前配置能否正常访问存储桶
export async function testCosConnection() {
  const cfg = readCosConfig()
  assertConfigured(cfg)
  try {
    await getClient(cfg).headBucket({ Bucket: cfg.bucket, Region: cfg.region })
  } catch (err) {
    throw toReadableError(err, 'COS 连接失败')
  }
  return { ok: true, bucket: cfg.bucket, region: cfg.region }
}
