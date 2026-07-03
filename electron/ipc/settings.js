// 全局设置：外观 + OpenAI 兼容模型配置，保存在用户数据目录
import { ipcMain } from 'electron'
import { readJson, writeJson } from '../utils/store.js'

const FILE = 'settings.json'

const DEFAULTS = {
  appearance: {
    themeMode: 'system', // light | dark | system
    primaryColor: '#1677ff',
    density: 'comfortable', // comfortable | compact
  },
  models: [],
}

function normalize(data) {
  return {
    appearance: { ...DEFAULTS.appearance, ...(data?.appearance || {}) },
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
