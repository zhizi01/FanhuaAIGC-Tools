// 全局设置：外观 + OpenAI 兼容模型配置，保存在用户数据目录
import { ipcMain } from 'electron'
import { readJson, writeJson } from '../utils/store.js'

const FILE = 'settings.json'

const DEFAULTS = {
  appearance: {
    themeMode: 'dark', // light | dark | system
    primaryColor: '#1ec9b0',
    density: 'comfortable', // comfortable | compact
    background: 'grid', // none | grid | dots | glow
  },
  imageGeneration: {
    apiKey: '',
  },
  // 腾讯云 COS 对象存储：参与生成的图片需要以公网链接提交给视频模型
  cos: {
    secretId: '',
    secretKey: '',
    bucket: '', // 格式 examplebucket-1250000000
    region: '', // 如 ap-guangzhou
  },
  models: [],
}

function normalize(data) {
  return {
    appearance: { ...DEFAULTS.appearance, ...(data?.appearance || {}) },
    imageGeneration: { ...DEFAULTS.imageGeneration, ...(data?.imageGeneration || {}) },
    cos: { ...DEFAULTS.cos, ...(data?.cos || {}) },
    models: Array.isArray(data?.models) ? data.models : [],
  }
}

export function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => {
    const data = readJson(FILE, null)
    return data ? normalize(data) : { ...DEFAULTS }
  })

  ipcMain.handle('settings:save', (_e, data) => {
    const safe = normalize(data)
    writeJson(FILE, safe)
    return safe
  })
}
