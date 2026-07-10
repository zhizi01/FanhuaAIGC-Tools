<script setup>
// 全局审批中心：后台生成完成后进入审批队列，无论在哪个界面都弹出，逐个审批；通过后写入画布（pinia 管理）
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { ClipboardCheck, UserRound } from 'lucide-vue-next'
import { useApprovalStore } from '../store/approvals.js'
import { useFlowCanvasStore } from '../store/flowCanvas.js'
import { assetFileUrl } from '../utils/asset.js'
import { roleCardRoleId } from '../utils/roles.js'

const approval = useApprovalStore()
const flowStore = useFlowCanvasStore()

const current = computed(() => approval.current)
const open = computed(() => !!current.value)

const editShots = ref([])
const editItems = ref([])

function linkedRoleIds(scriptNodeId) {
  return new Set(
    flowStore.edges
      .filter((e) => e.target === scriptNodeId && e.targetHandle === 'cast-roles')
      .map((e) => flowStore.nodes.find((n) => n.id === e.source))
      .filter((n) => n?.type === 'role-card' && roleCardRoleId(n.data))
      .map((n) => roleCardRoleId(n.data)),
  )
}

watch(
  () => current.value?.id,
  () => {
    const cur = current.value
    editShots.value = []
    editItems.value = []
    if (!cur) return
    if (cur.kind === 'storyboard') {
      editShots.value = (cur.shots || []).map((s) => ({ ...s }))
    } else if (cur.kind === 'scriptRole') {
      const linked = linkedRoleIds(cur.scriptNodeId)
      editItems.value = (cur.items || []).map((it) => {
        const alreadyLinked = it.roleId ? linked.has(it.roleId) : false
        return { ...it, alreadyLinked, checked: Boolean(it.matched) && !!it.roleId && !alreadyLinked }
      })
    }
  },
  { immediate: true },
)

const title = computed(() => {
  if (!current.value) return ''
  return current.value.kind === 'storyboard' ? '审批 · AI 分镜结果' : '审批 · AI 关联角色'
})
const dialogWidth = computed(() => (current.value?.kind === 'storyboard' ? '960px' : '720px'))

const scriptRoleSelectedCount = computed(
  () => editItems.value.filter((it) => it.checked && it.matched && it.roleId && !it.alreadyLinked).length,
)
const okDisabled = computed(() => {
  if (!current.value) return true
  if (current.value.kind === 'storyboard') return editShots.value.length === 0
  return scriptRoleSelectedCount.value === 0
})
const okText = computed(() => {
  if (current.value?.kind === 'scriptRole') return `通过并关联（${scriptRoleSelectedCount.value}）`
  return '通过并接入画布'
})

function coverUrl(cover) {
  return assetFileUrl(current.value?.projectPath, cover)
}

function moveShot(index, delta) {
  const next = index + delta
  if (next < 0 || next >= editShots.value.length) return
  const copy = [...editShots.value]
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  editShots.value = copy
}
function removeShot(index) {
  editShots.value = editShots.value.filter((_, i) => i !== index)
}

function approve() {
  const cur = current.value
  if (!cur) return
  if (cur.kind === 'storyboard') {
    if (!editShots.value.length) return message.warning('请至少保留一个分镜镜头')
    const ok = flowStore.applyStoryboardResult({
      projectPath: cur.projectPath,
      layoutId: cur.layoutId,
      clearOld: cur.clearOld,
      shots: editShots.value.map((s) => ({ ...s })),
    })
    if (ok) message.success(`已接入 ${editShots.value.length} 个分镜镜头`)
    else message.warning('未能写入画布（分镜排布卡片可能已删除或已切换工程）')
  } else if (cur.kind === 'scriptRole') {
    const chosen = editItems.value.filter((it) => it.checked && it.matched && it.roleId && !it.alreadyLinked)
    if (!chosen.length) return message.warning('请至少勾选一个可关联的角色库角色')
    const ok = flowStore.applyScriptRoleResult({
      projectPath: cur.projectPath,
      scriptNodeId: cur.scriptNodeId,
      items: chosen,
    })
    if (ok) message.success(`已关联 ${chosen.length} 个角色到剧情卡`)
    else message.warning('未能写入画布（剧情卡可能已删除或已切换工程）')
  }
  approval.dequeue(cur.id)
}
function reject() {
  const cur = current.value
  if (cur) approval.dequeue(cur.id)
}
</script>

<template>
  <a-modal
    :open="open"
    :title="title"
    :width="dialogWidth"
    :ok-text="okText"
    :ok-button-props="{ disabled: okDisabled }"
    cancel-text="不通过"
    :mask-closable="false"
    :keyboard="false"
    centered
    @ok="approve"
    @cancel="reject"
  >
    <div v-if="current" class="approval-body">
      <div class="approval-meta">
        <ClipboardCheck :size="15" />
        <span class="approval-ctx">
          <b>{{ current.projectName || '当前工程' }}</b>
          <template v-if="current.label"> · {{ current.label }}</template>
        </span>
        <span v-if="approval.count > 1" class="approval-queue">队列中还有 {{ approval.count - 1 }} 个待审批</span>
      </div>

      <!-- 分镜结果审批 -->
      <template v-if="current.kind === 'storyboard'">
        <p class="approval-tip">
          核对顺序、镜头时间、拍摄方法与发生剧情，可调整后再通过。
          <template v-if="current.clearOld">通过后旧的关联分镜将一并清理。</template>
        </p>
        <div class="approval-table-wrap">
          <table class="approval-table">
            <thead>
              <tr>
                <th class="col-order">顺序</th>
                <th class="col-duration">镜头时间</th>
                <th class="col-method">镜头拍摄方法</th>
                <th class="col-plot">发生剧情</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(shot, index) in editShots" :key="shot.key">
                <td class="col-order">
                  <div class="order-cell">
                    <strong>{{ index + 1 }}</strong>
                    <div class="order-btns">
                      <button type="button" :disabled="index === 0" @click="moveShot(index, -1)">上移</button>
                      <button type="button" :disabled="index === editShots.length - 1" @click="moveShot(index, 1)">
                        下移
                      </button>
                    </div>
                  </div>
                </td>
                <td class="col-duration">
                  <a-input-number v-model:value="shot.duration" :min="0" :max="120" :step="0.5" addon-after="秒" style="width: 100%" />
                </td>
                <td class="col-method">
                  <a-textarea v-model:value="shot.method" :rows="3" placeholder="景别 / 运镜 / 机位" />
                </td>
                <td class="col-plot">
                  <a-input v-model:value="shot.title" placeholder="镜头标题" style="margin-bottom: 6px" />
                  <a-textarea v-model:value="shot.description" :rows="2" placeholder="本镜头发生的剧情与对白" />
                </td>
                <td class="col-actions">
                  <button type="button" class="row-remove-btn" @click="removeShot(index)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <a-empty v-if="!editShots.length" description="暂无分镜，可不通过后重新生成" />
      </template>

      <!-- 关联角色审批 -->
      <template v-else-if="current.kind === 'scriptRole'">
        <p class="approval-tip">
          AI 已识别本集参与角色并匹配角色库。勾选要关联到画布的角色；未匹配到角色库的无法直接关联。
        </p>
        <div class="approval-role-list">
          <label
            v-for="item in editItems"
            :key="item.key"
            class="approval-role-item"
            :class="{ disabled: !item.matched || item.alreadyLinked, matched: item.matched && !item.alreadyLinked }"
          >
            <a-checkbox v-model:checked="item.checked" :disabled="!item.matched || item.alreadyLinked" />
            <div class="approval-role-thumb">
              <img v-if="item.cover" :src="coverUrl(item.cover)" :alt="item.name" />
              <UserRound v-else :size="22" />
            </div>
            <div class="approval-role-meta">
              <div class="approval-role-title">
                <strong>{{ item.name }}</strong>
                <span v-if="item.roleType" class="role-chip">{{ item.roleType }}</span>
                <span v-if="item.alreadyLinked" class="role-status linked">已关联</span>
                <span v-else-if="item.matched" class="role-status matched">角色库已匹配</span>
                <span v-else class="role-status missing">角色库未找到</span>
              </div>
              <p>{{ item.note || item.identity || item.personality || '无补充说明' }}</p>
            </div>
          </label>
        </div>
        <a-empty v-if="!editItems.length" description="未识别到角色" />
      </template>
    </div>
  </a-modal>
</template>

<style scoped>
.approval-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.approval-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-sunken);
  color: var(--text-secondary);
  font-size: 13px;
}
.approval-ctx {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.approval-ctx b {
  color: var(--text-primary);
}
.approval-queue {
  margin-left: auto;
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-color);
  font-size: 12px;
}
.approval-tip {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

/* 分镜表格 */
.approval-table-wrap {
  max-height: min(58vh, 560px);
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.approval-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.approval-table th,
.approval-table td {
  padding: 10px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
  text-align: left;
}
.approval-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.approval-table .col-order {
  width: 88px;
}
.approval-table .col-duration {
  width: 128px;
}
.approval-table .col-actions {
  width: 72px;
}
.order-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.order-cell strong {
  font-size: 14px;
  color: var(--text-primary);
}
.order-btns {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.order-btns button,
.row-remove-btn {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease;
}
.order-btns button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.order-btns button:not(:disabled):hover {
  color: var(--brand-color);
  border-color: var(--brand-color);
}
.row-remove-btn {
  color: #ff4d4f;
}
.row-remove-btn:hover {
  border-color: #ff4d4f;
}
.approval-table :deep(.ant-input),
.approval-table :deep(textarea.ant-input) {
  font-size: 12px;
}

/* 角色列表 */
.approval-role-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(52vh, 480px);
  overflow: auto;
}
.approval-role-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-sunken);
  cursor: pointer;
}
.approval-role-item.disabled {
  opacity: 0.72;
  cursor: default;
}
.approval-role-item.matched {
  border-color: color-mix(in srgb, var(--brand-color) 45%, transparent);
}
.approval-role-thumb {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  color: var(--brand-color);
  background: var(--brand-soft);
}
.approval-role-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.approval-role-meta {
  min-width: 0;
  flex: 1;
}
.approval-role-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.approval-role-title strong {
  color: var(--text-primary);
  font-size: 13px;
}
.role-chip,
.role-status {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
}
.role-chip {
  color: var(--text-secondary);
  background: rgba(148, 163, 184, 0.16);
}
.role-status.matched {
  color: var(--brand-color);
  background: var(--brand-soft);
}
.role-status.linked {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.16);
}
.role-status.missing {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
}
.approval-role-meta p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
