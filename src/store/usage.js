// 工程 Token 用量（Pinia）：当前工程的累计统计，供左侧菜单展示
import { defineStore } from 'pinia'
import { api } from '../services/bridge.js'

// 数字友好显示：1234 -> 1.2K，1200000 -> 1.20M
export function formatTokens(n) {
  const v = Number(n) || 0
  if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
  return String(v)
}

function normalize(u) {
  return {
    totalTokens: u?.totalTokens || 0,
    promptTokens: u?.promptTokens || 0,
    completionTokens: u?.completionTokens || 0,
    requests: u?.requests || 0,
  }
}

export const useUsageStore = defineStore('usage', {
  state: () => ({
    projectPath: '',
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    requests: 0,
  }),
  actions: {
    async load(projectPath) {
      if (!projectPath) return
      this.projectPath = projectPath
      try {
        const u = await api.usage.get(projectPath)
        Object.assign(this, { projectPath }, normalize(u))
      } catch {
        Object.assign(this, { projectPath, totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0 })
      }
    },
    // 累加一次调用的用量（任意工程），并即时更新当前工程的展示
    async add(projectPath, delta) {
      if (!projectPath || !delta) return
      const add = {
        promptTokens: delta.promptTokens || 0,
        completionTokens: delta.completionTokens || 0,
        totalTokens: delta.totalTokens || 0,
        requests: 1,
      }
      if (this.projectPath === projectPath) {
        this.promptTokens += add.promptTokens
        this.completionTokens += add.completionTokens
        this.totalTokens += add.totalTokens
        this.requests += add.requests
      }
      try {
        await api.usage.add({ projectPath, delta: add })
      } catch {
        // 持久化失败不阻断主流程
      }
    },
  },
})
