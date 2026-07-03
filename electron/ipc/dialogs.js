// 系统对话框：选择工程目录 / 选择剧本文件
import { ipcMain, dialog } from 'electron'
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
}
