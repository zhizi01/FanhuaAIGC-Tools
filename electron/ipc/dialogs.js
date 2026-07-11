// 系统对话框：选择工程目录 / 选择剧本文件 / 导出文件
import { ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm'])

function resolveProjectVideo(projectPath, source) {
  const projectRoot = path.resolve(String(projectPath || ''))
  const relSource = String(source || '').trim()
  if (!projectPath || !relSource || path.isAbsolute(relSource)) {
    throw new Error('视频文件路径无效')
  }
  const projectRelative = /^(files|thumbs)[\\/]/i.test(relSource)
    ? path.join('assets', relSource)
    : relSource
  const sourcePath = path.resolve(projectRoot, projectRelative)
  const insideProject = sourcePath.startsWith(projectRoot + path.sep)
  if (!insideProject) throw new Error('视频文件不在当前工程中')
  return sourcePath
}

export function registerDialogsIpc(getWindow) {
  ipcMain.handle('dialog:selectProjectDir', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: '选择工程目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  ipcMain.handle('dialog:selectScriptFile', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: '选择剧本文件',
      properties: ['openFile'],
      filters: [{ name: '剧本文档', extensions: ['txt', 'md', 'docx', 'pdf'] }],
    })
    if (res.canceled || !res.filePaths.length) return null
    return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) }
  })

  // 选择资产文件（多选）
  ipcMain.handle('dialog:selectAssetFiles', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: '导入资产',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '素材文件',
          extensions: [
            'png', 'jpg', 'jpeg', 'webp', 'gif',
            'mp3', 'wav', 'm4a',
            'mp4', 'mov', 'webm',
            'txt', 'md', 'docx', 'pdf',
          ],
        },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (res.canceled || !res.filePaths.length) return []
    return res.filePaths
  })

  // 导出剧本：弹出保存对话框并写入文件
  ipcMain.handle('dialog:exportScript', async (_e, payload) => {
    const { defaultName, content } = payload || {}
    const res = await dialog.showSaveDialog(getWindow(), {
      title: '导出剧本',
      defaultPath: defaultName || '剧本.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本文件', extensions: ['txt'] },
      ],
    })
    if (res.canceled || !res.filePath) return null
    fs.writeFileSync(res.filePath, content || '', 'utf-8')
    return res.filePath
  })

  // 导出画布视频：只允许复制当前工程内的视频文件
  ipcMain.handle('dialog:exportVideo', async (_e, payload) => {
    const { projectPath, source, defaultName } = payload || {}
    const sourcePath = resolveProjectVideo(projectPath, source)
    const stat = await fs.promises.stat(sourcePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('视频文件不存在或已被移动')

    const sourceExt = path.extname(sourcePath).toLowerCase()
    const extension = VIDEO_EXTENSIONS.has(sourceExt) ? sourceExt : '.mp4'
    const rawName = path.basename(String(defaultName || '导出视频'))
    const safeName = rawName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '导出视频'
    const requestedExt = path.extname(safeName).toLowerCase()
    const baseName = VIDEO_EXTENSIONS.has(requestedExt)
      ? safeName.slice(0, -requestedExt.length)
      : safeName
    const exportName = (baseName || '导出视频') + extension
    const res = await dialog.showSaveDialog(getWindow(), {
      title: '导出视频',
      defaultPath: exportName,
      filters: [{ name: '视频文件', extensions: [extension.slice(1)] }],
    })
    if (res.canceled || !res.filePath) return null
    if (path.resolve(res.filePath) !== sourcePath) {
      await fs.promises.copyFile(sourcePath, res.filePath)
    }
    return res.filePath
  })
}
