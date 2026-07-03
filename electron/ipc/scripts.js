// 剧本文件：按工程目录读写剧本，维护 scripts/index.json 索引
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { genId } from '../utils/id.js'

function scriptsDir(projectPath) {
  const dir = path.join(projectPath, 'scripts')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function indexFile(projectPath) {
  return path.join(scriptsDir(projectPath), 'index.json')
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

function episodeFileName(no) {
  return `episode_${String(no).padStart(3, '0')}.md`
}

export function registerScriptsIpc() {
  // 列出当前工程的全部剧本（索引信息）
  ipcMain.handle('scripts:list', (_e, projectPath) => {
    if (!projectPath) return []
    return readIndex(projectPath).items
  })

  // 读取某个剧本的完整内容（总览 + 分集）
  ipcMain.handle('scripts:read', (_e, payload) => {
    const { projectPath, scriptId } = payload || {}
    if (!projectPath || !scriptId) throw new Error('缺少工程路径或剧本ID')
    const dir = path.join(scriptsDir(projectPath), scriptId)
    const metaFile = path.join(dir, 'meta.json')
    if (!fs.existsSync(metaFile)) throw new Error('剧本不存在')

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    const overviewFile = path.join(dir, 'overview.md')
    const overview = fs.existsSync(overviewFile) ? fs.readFileSync(overviewFile, 'utf-8') : ''

    const episodes = (meta.episodes || []).map((ep) => {
      const epFile = path.join(dir, ep.file)
      return {
        episodeNo: ep.episodeNo,
        title: ep.title,
        file: ep.file,
        content: fs.existsSync(epFile) ? fs.readFileSync(epFile, 'utf-8') : '',
      }
    })

    return { meta, overview, episodes }
  })

  // 保存剧本：写入 meta.json / overview.md / episodes/*.md，并更新索引
  ipcMain.handle('scripts:save', (_e, payload) => {
    const { projectPath, script } = payload || {}
    if (!projectPath || !script) throw new Error('缺少工程路径或剧本数据')

    const now = new Date().toISOString()
    const id = script.id || genId('script')
    const dir = path.join(scriptsDir(projectPath), id)
    const episodesDir = path.join(dir, 'episodes')
    fs.mkdirSync(episodesDir, { recursive: true })

    const inputEpisodes = Array.isArray(script.episodes) ? script.episodes : []
    const episodesMeta = inputEpisodes.map((ep, idx) => {
      const no = ep.episodeNo || idx + 1
      const file = path.join('episodes', episodeFileName(no))
      fs.writeFileSync(path.join(dir, file), ep.content || '', 'utf-8')
      return { episodeNo: no, title: ep.title || `第${no}集`, file }
    })

    // 清理不再存在的分集文件
    const keepFiles = new Set(episodesMeta.map((ep) => path.basename(ep.file)))
    if (fs.existsSync(episodesDir)) {
      for (const f of fs.readdirSync(episodesDir)) {
        if (!keepFiles.has(f)) fs.rmSync(path.join(episodesDir, f), { force: true })
      }
    }

    fs.writeFileSync(path.join(dir, 'overview.md'), script.overview || '', 'utf-8')

    const meta = {
      id,
      title: script.title || '未命名剧本',
      sourceType: script.sourceType || 'manual',
      status: script.status || '草稿',
      episodeCount: episodesMeta.length,
      episodeDurationSeconds: script.episodeDurationSeconds || 60,
      complianceResult: script.complianceResult || '',
      riskLevel: script.riskLevel || '',
      createdAt: script.createdAt || now,
      updatedAt: now,
      episodes: episodesMeta,
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

    // 更新索引
    const index = readIndex(projectPath)
    const item = {
      id,
      title: meta.title,
      sourceType: meta.sourceType,
      status: meta.status,
      episodeCount: meta.episodeCount,
      episodeDurationSeconds: meta.episodeDurationSeconds,
      updatedAt: meta.updatedAt,
      dir: id,
      overviewFile: `${id}/overview.md`,
    }
    const rest = index.items.filter((it) => it.id !== id)
    writeIndex(projectPath, { items: [item, ...rest] })

    return meta
  })

  // 删除剧本目录并更新索引
  ipcMain.handle('scripts:remove', (_e, payload) => {
    const { projectPath, scriptId } = payload || {}
    if (!projectPath || !scriptId) throw new Error('缺少工程路径或剧本ID')
    const dir = path.join(scriptsDir(projectPath), scriptId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    const index = readIndex(projectPath)
    writeIndex(projectPath, { items: index.items.filter((it) => it.id !== scriptId) })
    return true
  })

  // 上传剧本文件并解析出纯文本（txt/md/docx/pdf）
  ipcMain.handle('scripts:uploadAndParse', async (_e, payload) => {
    const { filePath, fileType } = payload || {}
    if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在')

    const ext = (fileType || path.extname(filePath).slice(1)).toLowerCase()
    let rawText = ''

    if (ext === 'txt' || ext === 'md') {
      rawText = fs.readFileSync(filePath, 'utf-8')
    } else if (ext === 'docx') {
      const mammoth = (await import('mammoth')).default
      const result = await mammoth.extractRawText({ path: filePath })
      rawText = result.value || ''
    } else if (ext === 'pdf') {
      const buffer = fs.readFileSync(filePath)
      const mod = await import('pdf-parse')
      const pdfParse = mod.default || mod
      const data = await pdfParse(buffer)
      rawText = data.text || ''
    } else {
      throw new Error(`暂不支持的文件类型：${ext}`)
    }

    return { fileName: path.basename(filePath), fileType: ext, rawText }
  })
}
