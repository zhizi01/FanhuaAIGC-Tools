// 审批队列（Pinia）：后台生成完成后进入队列，无论用户在哪个界面都弹出审批，逐个处理，通过后再写入画布
import { defineStore } from 'pinia'

export const useApprovalStore = defineStore('approval', {
  state: () => ({
    queue: [], // { id, kind, nodeId, projectPath, projectName, label, ...payload }
    seq: 0,
  }),
  getters: {
    current: (s) => s.queue[0] || null,
    count: (s) => s.queue.length,
    // 某节点是否有待审批结果（供卡片显示“待审批”）
    isPending: (s) => (nodeId) => s.queue.some((it) => it.nodeId === nodeId),
  },
  actions: {
    enqueue(item) {
      this.seq += 1
      this.queue = [...this.queue, { id: `apr_${Date.now()}_${this.seq}`, ...item }]
    },
    dequeue(id) {
      this.queue = this.queue.filter((it) => it.id !== id)
    },
    // 只保留指定工程的待审批（切换/退出工程时调用，避免弹出别的工程的审批）
    keepProject(projectPath) {
      this.queue = this.queue.filter((it) => it.projectPath === projectPath)
    },
  },
})
