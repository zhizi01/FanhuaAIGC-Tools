// 应用窗口菜单：把「返回起始页 / 设置」放在窗口菜单中，
// 避免在工程页顶部打断创作流程（符合开发计划的约定）
import { Menu } from 'electron'

export function buildAppMenu(getWindow) {
  const send = (channel, payload) => {
    const win = getWindow()
    if (win) win.webContents.send(channel, payload)
  }

  const isMac = process.platform === 'darwin'

  const template = [
    {
      label: '工程',
      submenu: [
        {
          label: '返回起始页',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => send('menu:navigate', '/'),
        },
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu:navigate', '/settings'),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
