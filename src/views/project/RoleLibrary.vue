<script setup>
// 角色库：当前作品的角色卡工作区（结构化 JSON 管理）
// 左：角色列表（搜索/筛选/新建/AI提取） 右：角色卡编辑（基础字段 + 形象图 + 声线）
import { computed, onMounted, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { Users, Plus, Sparkles, Save, Trash2, Search, Image as ImageIcon, Mic } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { useUsageStore } from '../../store/usage.js'
import { api } from '../../services/bridge.js'
import { genLocalId } from '../../utils/id.js'
import { parseExtractedRoles } from '../../utils/markdown.js'
import { assetUrl } from '../../utils/asset.js'
import { extractRolesFromScript } from '../../services/ai.js'

const appStore = useAppStore()
const usageStore = useUsageStore()
const project = computed(() => appStore.currentProject)

const ROLE_TYPES = ['主角', '配角', '反派', '路人', '旁白']

const roles = ref([])
const assets = ref([])
const loading = ref(false)
const saving = ref(false)

const editing = ref(false)
const activeRoleId = ref(null)
const dirty = ref(false)

const search = ref('')
const filterType = ref('')
const filterTag = ref('')

const form = reactive(blankForm())

function blankForm() {
  return {
    id: '',
    name: '',
    roleType: '配角',
    gender: '',
    age: '',
    identity: '',
    personality: '',
    motivation: '',
    appearance: '',
    voice: '',
    tags: [],
    imageAssetId: '',
    voiceAssetId: '',
    createdAt: '',
  }
}

// ---------- 资产（形象图 / 声线） ----------
const imageAssetOptions = computed(() =>
  assets.value.filter((a) => a.type === 'image').map((a) => ({ value: a.id, label: a.name })),
)
const audioAssetOptions = computed(() =>
  assets.value.filter((a) => a.type === 'audio').map((a) => ({ value: a.id, label: a.name })),
)
function findAsset(id) {
  return assets.value.find((a) => a.id === id) || null
}
function assetPreviewUrl(id) {
  const a = findAsset(id)
  return a ? assetUrl(project.value?.path, a.file) : ''
}
function roleThumbUrl(r) {
  const a = findAsset(r.imageAssetId)
  return a ? assetUrl(project.value?.path, a.thumbnail || a.file) : ''
}
const imagePreviewUrl = computed(() => assetPreviewUrl(form.imageAssetId))
const voicePreviewUrl = computed(() => assetPreviewUrl(form.voiceAssetId))

// ---------- 列表与筛选 ----------
const allTags = computed(() => {
  const set = new Set()
  roles.value.forEach((r) => (r.tags || []).forEach((t) => set.add(t)))
  return [...set]
})

const filteredRoles = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return roles.value.filter((r) => {
    if (filterType.value && r.roleType !== filterType.value) return false
    if (filterTag.value && !(r.tags || []).includes(filterTag.value)) return false
    if (kw && !(r.name || '').toLowerCase().includes(kw)) return false
    return true
  })
})

async function loadRoles() {
  if (!project.value?.path) return
  loading.value = true
  try {
    roles.value = await api.roles.list(project.value.path)
  } catch (err) {
    message.error('加载角色失败：' + err.message)
  } finally {
    loading.value = false
  }
}

async function loadAssets() {
  if (!project.value?.path) return
  try {
    assets.value = await api.assets.list(project.value.path)
  } catch {
    assets.value = []
  }
}

// ---------- 选择 / 新建 ----------
function guardDirty(action) {
  if (!dirty.value) return action()
  Modal.confirm({
    title: '有未保存的修改',
    content: '切换后当前未保存的修改会丢失，确定继续吗？',
    okText: '放弃修改',
    okType: 'danger',
    cancelText: '取消',
    onOk: action,
  })
}

function applyRole(meta) {
  Object.assign(form, blankForm(), {
    id: meta.id,
    name: meta.name,
    roleType: meta.roleType || '配角',
    gender: meta.gender || '',
    age: meta.age || '',
    identity: meta.identity || '',
    personality: meta.personality || '',
    motivation: meta.motivation || '',
    appearance: meta.appearance || '',
    voice: meta.voice || '',
    tags: [...(meta.tags || [])],
    imageAssetId: meta.imageAssetId || '',
    voiceAssetId: meta.voiceAssetId || '',
    createdAt: meta.createdAt || '',
  })
}

function selectRole(id) {
  if (id === activeRoleId.value) return
  guardDirty(async () => {
    try {
      const meta = await api.roles.read({ projectPath: project.value.path, roleId: id })
      applyRole(meta)
      activeRoleId.value = id
      editing.value = true
      dirty.value = false
    } catch (err) {
      message.error('读取角色失败：' + err.message)
    }
  })
}

function newRole() {
  guardDirty(() => {
    Object.assign(form, blankForm(), { id: genLocalId('role') })
    activeRoleId.value = form.id
    editing.value = true
    dirty.value = true
  })
}

function markDirty() {
  dirty.value = true
}

// ---------- 保存 / 删除 ----------
async function saveRole() {
  if (!project.value?.path) return
  if (!form.name.trim()) return message.warning('请填写角色名')
  saving.value = true
  try {
    const meta = await api.roles.save({
      projectPath: project.value.path,
      role: { ...form, name: form.name.trim() },
    })
    await loadRoles()
    activeRoleId.value = meta.id
    form.id = meta.id
    form.createdAt = meta.createdAt
    dirty.value = false
    message.success('已保存')
  } catch (err) {
    message.error('保存失败：' + err.message)
  } finally {
    saving.value = false
  }
}

function removeRole() {
  if (!activeRoleId.value) return
  const id = activeRoleId.value
  const name = form.name
  Modal.confirm({
    title: '删除角色',
    content: `确定删除「${name || '未命名角色'}」吗？该操作会删除本地角色文件。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        if (roles.value.find((r) => r.id === id)) {
          await api.roles.remove({ projectPath: project.value.path, roleId: id })
        }
        dirty.value = false
        editing.value = false
        activeRoleId.value = null
        await loadRoles()
        message.success('已删除')
      } catch (err) {
        message.error('删除失败：' + err.message)
      }
    },
  })
}

// ---------- AI 提取角色 ----------
const extracting = ref(false)
const extractOpen = ref(false)
const importingRoles = ref(false)
const extractRoles = ref([])

async function aiExtract() {
  if (!project.value?.path) return
  if (!(appStore.settings.models || []).length) return message.warning('请先在设置页添加模型')
  extracting.value = true
  try {
    const list = await api.scripts.list(project.value.path)
    if (!list.length) {
      message.warning('当前工程还没有剧本，请先在剧本库创建')
      return
    }
    const data = await api.scripts.read({ projectPath: project.value.path, scriptId: list[0].id })
    const parts = [data.overview || '']
    ;(data.episodes || []).forEach((e) => parts.push(e.content || ''))
    const scriptText = parts.filter(Boolean).join('\n\n').slice(0, 20000)
    const { markdown, usage } = await extractRolesFromScript({
      scriptText,
      modelId: appStore.currentModelId,
    })
    usageStore.add(project.value.path, usage)

    const drafts = parseExtractedRoles(markdown)
    if (!drafts.length) {
      message.warning('未能自动识别角色，请手动新建角色')
      return
    }
    extractRoles.value = drafts.map((d) => ({ ...d, checked: true }))
    extractOpen.value = true
  } catch (err) {
    message.error('AI提取角色失败：' + err.message)
  } finally {
    extracting.value = false
  }
}

async function confirmImport() {
  const chosen = extractRoles.value.filter((r) => r.checked)
  if (!chosen.length) return message.warning('请至少选择一个角色')
  importingRoles.value = true
  try {
    for (const d of chosen) {
      await api.roles.save({
        projectPath: project.value.path,
        role: {
          name: d.name,
          roleType: d.roleType,
          gender: d.gender,
          age: d.age,
          identity: d.identity,
          personality: d.personality,
          motivation: d.motivation,
          appearance: d.appearance,
          voice: d.voice,
          tags: d.tags,
        },
      })
    }
    await loadRoles()
    extractOpen.value = false
    message.success(`已导入 ${chosen.length} 个角色`)
  } catch (err) {
    message.error('导入失败：' + err.message)
  } finally {
    importingRoles.value = false
  }
}

onMounted(() => {
  loadRoles()
  loadAssets()
})
</script>

<template>
  <div class="role-library">
    <!-- 左：角色列表 -->
    <aside class="role-side">
      <div class="side-head">
        <div class="side-search">
          <Search :size="15" class="search-ico" />
          <input v-model="search" class="search-input" placeholder="搜索角色" />
        </div>
        <div class="side-filters">
          <a-select
            v-model:value="filterType"
            size="small"
            class="filter-select"
            :options="[{ value: '', label: '全部定位' }, ...ROLE_TYPES.map((t) => ({ value: t, label: t }))]"
          />
          <a-select
            v-model:value="filterTag"
            size="small"
            class="filter-select"
            :options="[{ value: '', label: '全部标签' }, ...allTags.map((t) => ({ value: t, label: t }))]"
          />
        </div>
      </div>

      <div class="role-list">
        <a-spin :spinning="loading">
          <button
            v-for="r in filteredRoles"
            :key="r.id"
            class="role-card"
            :class="{ active: activeRoleId === r.id }"
            @click="selectRole(r.id)"
          >
            <div class="role-avatar">
              <img v-if="roleThumbUrl(r)" :src="roleThumbUrl(r)" :alt="r.name" />
              <span v-else>{{ (r.name || '?').slice(0, 1) }}</span>
            </div>
            <div class="role-info">
              <div class="role-name-row">
                <span class="role-name">{{ r.name }}</span>
                <span class="role-type-badge">{{ r.roleType }}</span>
              </div>
              <div v-if="r.tags && r.tags.length" class="role-tags">
                <span v-for="t in r.tags" :key="t" class="role-tag">{{ t }}</span>
              </div>
            </div>
          </button>
          <div v-if="!filteredRoles.length" class="list-empty">
            {{ roles.length ? '没有匹配的角色' : '还没有角色，点击下方新建' }}
          </div>
        </a-spin>
      </div>

      <div class="side-foot">
        <button class="foot-btn primary" @click="newRole">
          <Plus :size="15" /> 新建角色
        </button>
        <button class="foot-btn" :disabled="extracting" @click="aiExtract">
          <Sparkles :size="15" /> {{ extracting ? '提取中…' : 'AI提取角色' }}
        </button>
      </div>
    </aside>

    <!-- 右：角色卡编辑 -->
    <section class="role-main">
      <div v-if="!editing" class="main-empty">
        <div class="empty-icon"><Users :size="30" /></div>
        <h3>管理这部作品的角色</h3>
        <p>在左侧选择角色进行编辑，或点击「新建角色」创建一张角色卡。</p>
        <a-button type="primary" @click="newRole">新建角色</a-button>
      </div>

      <template v-else>
        <header class="main-toolbar">
          <div class="toolbar-left">
            <a-input v-model:value="form.name" :bordered="false" class="name-input" placeholder="角色名" @change="markDirty" />
            <span v-if="dirty" class="dirty-dot">● 未保存</span>
          </div>
          <div class="toolbar-right">
            <a-button danger @click="removeRole">
              <template #icon><Trash2 :size="15" /></template>
              删除
            </a-button>
            <a-button type="primary" :loading="saving" :disabled="!dirty" @click="saveRole">
              <template #icon><Save :size="15" /></template>
              保存
            </a-button>
          </div>
        </header>

        <div class="main-body">
          <div class="role-form">
            <!-- 形象图 + 声线 -->
            <div class="media-row">
              <div class="media-item">
                <div class="media-label"><ImageIcon :size="14" /> 角色形象图</div>
                <div class="image-box">
                  <img v-if="imagePreviewUrl" :src="imagePreviewUrl" alt="形象图" />
                  <Users v-else :size="28" />
                </div>
                <a-select
                  v-model:value="form.imageAssetId"
                  class="w-full"
                  allow-clear
                  placeholder="选择图片资产"
                  :options="imageAssetOptions"
                  @change="markDirty"
                />
              </div>
              <div class="media-item">
                <div class="media-label"><Mic :size="14" /> 角色声线</div>
                <div class="voice-box">
                  <audio v-if="voicePreviewUrl" :src="voicePreviewUrl" controls />
                  <span v-else class="voice-empty">未设置声线</span>
                </div>
                <a-select
                  v-model:value="form.voiceAssetId"
                  class="w-full"
                  allow-clear
                  placeholder="选择音频资产"
                  :options="audioAssetOptions"
                  @change="markDirty"
                />
              </div>
            </div>

            <a-form layout="vertical">
              <div class="form-row">
                <a-form-item label="角色定位" class="col">
                  <a-select v-model:value="form.roleType" :options="ROLE_TYPES.map((t) => ({ value: t, label: t }))" @change="markDirty" />
                </a-form-item>
                <a-form-item label="性别" class="col">
                  <a-input v-model:value="form.gender" placeholder="如：女" @change="markDirty" />
                </a-form-item>
                <a-form-item label="年龄" class="col">
                  <a-input v-model:value="form.age" placeholder="如：24" @change="markDirty" />
                </a-form-item>
              </div>
              <a-form-item label="身份">
                <a-input v-model:value="form.identity" placeholder="如：便利店店员 / 隐藏继承人" @change="markDirty" />
              </a-form-item>
              <a-form-item label="性格">
                <a-input v-model:value="form.personality" placeholder="如：隐忍、敏感、行动力强" @change="markDirty" />
              </a-form-item>
              <a-form-item label="核心动机">
                <a-input v-model:value="form.motivation" placeholder="如：查清父亲失踪真相" @change="markDirty" />
              </a-form-item>
              <a-form-item label="外观设定">
                <a-textarea v-model:value="form.appearance" :rows="2" placeholder="如：黑色长发，清瘦，常穿深色外套" @change="markDirty" />
              </a-form-item>
              <a-form-item label="说话方式">
                <a-textarea v-model:value="form.voice" :rows="2" placeholder="如：语速偏慢，情绪压住时声音发紧" @change="markDirty" />
              </a-form-item>
              <a-form-item label="标签">
                <a-select v-model:value="form.tags" mode="tags" placeholder="输入后回车添加标签" @change="markDirty" />
              </a-form-item>
            </a-form>
          </div>
        </div>
      </template>
    </section>

    <!-- AI 提取角色结果 -->
    <a-modal
      v-model:open="extractOpen"
      title="AI 提取角色"
      :width="560"
      :confirm-loading="importingRoles"
      ok-text="导入所选"
      cancel-text="取消"
      @ok="confirmImport"
    >
      <div class="extract-tip">已从当前剧本提取以下角色，勾选需要导入的角色。</div>
      <div class="extract-list">
        <label v-for="(r, idx) in extractRoles" :key="idx" class="extract-item">
          <a-checkbox v-model:checked="r.checked" />
          <div class="extract-info">
            <div class="extract-name">
              {{ r.name }}
              <span class="extract-type">{{ r.roleType }}</span>
            </div>
            <div class="extract-desc">{{ r.identity || r.personality || r.motivation || '—' }}</div>
          </div>
        </label>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.role-library {
  height: 100%;
  display: flex;
  min-height: 0;
}

/* 左侧列表 */
.role-side {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.side-head {
  padding: 14px 12px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.side-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}
.search-ico {
  color: var(--text-tertiary);
}
.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  color: var(--text-primary);
  font-size: 13px;
}
.side-filters {
  display: flex;
  gap: 8px;
}
.filter-select {
  flex: 1;
}
.role-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 角色卡：宽度统一，标签多行且每行等高 */
.role-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all 0.14s ease;
}
.role-card:hover {
  background: var(--bg-hover);
}
.role-card.active {
  background: var(--bg-active);
  border-color: var(--brand-color);
}
.role-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
}
.role-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.role-info {
  flex: 1;
  min-width: 0;
}
.role-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
}
.role-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-type-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--brand-color);
  background: var(--brand-soft);
}
.role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.role-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1;
  color: var(--text-secondary);
  background: var(--bg-hover);
}
.list-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}
.side-foot {
  padding: 10px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.foot-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.foot-btn:hover:not(:disabled) {
  color: var(--brand-color);
  border-color: var(--brand-color);
  background: var(--brand-soft);
}
.foot-btn.primary {
  border-color: var(--brand-color);
  background: var(--brand-soft);
  color: var(--brand-color);
  font-weight: 600;
}
.foot-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 右侧编辑 */
.role-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.main-empty {
  margin: auto;
  text-align: center;
  color: var(--text-secondary);
  max-width: 420px;
  padding: 24px;
}
.empty-icon {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-color);
  background: var(--bg-active);
}
.main-empty h3 {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--text-primary);
}
.main-empty p {
  margin: 0 0 18px;
  font-size: 13px;
}
.main-toolbar {
  height: 58px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.name-input {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  width: 240px;
  padding-left: 0;
}
.dirty-dot {
  font-size: 12px;
  color: var(--brand-color);
  white-space: nowrap;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}
.main-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 20px 24px 32px;
}
.role-form {
  max-width: 760px;
}
.media-row {
  display: flex;
  gap: 20px;
  margin-bottom: 18px;
}
.media-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.media-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.image-box {
  width: 100%;
  height: 150px;
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  color: var(--text-tertiary);
  border: 1px solid var(--border-color);
}
.image-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.voice-box {
  height: 150px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  border: 1px solid var(--border-color);
  padding: 12px;
}
.voice-box audio {
  width: 100%;
}
.voice-empty {
  font-size: 12px;
  color: var(--text-tertiary);
}
.form-row {
  display: flex;
  gap: 14px;
}
.col {
  flex: 1;
}
.w-full {
  width: 100%;
}

/* AI 提取角色弹窗 */
.extract-tip {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.extract-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}
.extract-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.extract-item:hover {
  border-color: var(--brand-color);
}
.extract-info {
  min-width: 0;
}
.extract-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.extract-type {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--brand-color);
}
.extract-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
</style>
