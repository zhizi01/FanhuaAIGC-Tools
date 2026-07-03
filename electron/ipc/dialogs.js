// 系统对话框：选择工程目录 / 选择剧本文件 / 导出剧本
import { ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

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
}
