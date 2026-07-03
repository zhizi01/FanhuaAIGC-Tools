// 资产预览地址：把工程内相对文件路径转换为自定义协议 URL（由主进程 qsasset 协议转发本地文件）
export function assetUrl(projectPath, relFile) {
  if (!projectPath || !relFile) return ''
  const abs = (projectPath + '/' + relFile).replace(/\\/g, '/')
  return 'qsasset://local/' + encodeURIComponent(abs)
}

// 文件大小友好显示
export function formatSize(bytes) {
  const b = Number(bytes) || 0
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}
