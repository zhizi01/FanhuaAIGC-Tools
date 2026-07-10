// 资产预览地址：把工程内相对文件路径转换为自定义协议 URL（由主进程 qsasset 协议转发本地文件）
export function assetUrl(projectPath, relFile) {
  if (!projectPath || !relFile) return ''
  const abs = (projectPath + '/' + relFile).replace(/\\/g, '/')
  return 'qsasset://local/' + encodeURIComponent(abs)
}

// 本地绝对路径的预览地址：用于预览工程外的本地文件（如 AI 生成时选择的参考图）
export function localFileUrl(absPath) {
  if (!absPath) return ''
  return 'qsasset://local/' + encodeURIComponent(String(absPath).replace(/\\/g, '/'))
}

// 资产文件预览地址：受管资产（导入/AI生成）实际存放在工程 assets/ 目录下，
// 索引里记为 files|thumbs/xxx，预览需补上 assets/ 前缀；项目生成的文档等路径保持原样。
export function assetFileUrl(projectPath, relFile) {
  if (!projectPath || !relFile) return ''
  const rel = /^(files|thumbs)\//.test(relFile) ? 'assets/' + relFile : relFile
  return assetUrl(projectPath, rel)
}

// 文件大小友好显示
export function formatSize(bytes) {
  const b = Number(bytes) || 0
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}
