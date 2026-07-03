<script setup>
// 角色库：当前作品的角色卡工作区
// 左：角色列表（搜索/筛选/新建/AI提取） 中：角色卡编辑（基础字段 + Markdown 设定） 右：关联信息（出现集数/关系/资产）
import { computed, onMounted, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { Users, Plus, Sparkles, Save, Trash2, Eye, Code, Search, X } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { api } from '../../services/bridge.js'
import { genLocalId } from '../../utils/id.js'
import { renderMarkdown } from '../../utils/markdown.js'
import { assetUrl } from '../../utils/asset.js'

const appStore = useAppStore()
const project = computed(() => appStore.currentProject)

const assets = ref([])
const imageAssets = computed(() => assets.value.filter((a) => a.type === 'image'))
const assetOptions = computed(() => assets.value.map((a) => ({ value: a.id, label: a.name })))
const imageAssetOptions = computed(() => imageAssets.value.map((a) => ({ value: a.id, label: a.name })))

function findAsset(id) {
  return assets.value.find((a) => a.id === id) || null
}
function assetPreviewUrl(id) {
  const a = findAsset(id)
  if (!a) return ''
  return assetUrl(project.value?.path, a.thumbnail || a.file)
}

const ROLE_TYPES = ['主角', '配角', '反派', '路人', '旁白']

const roles = ref([])
const loading = ref(false)
const saving = ref(false)

const editing = ref(false)
const activeRoleId = ref(null)
const dirty = ref(false)
const mode = ref('form') // form | preview | source（Markdown 设定的展示方式）

const search = ref('')
const filterType = ref('')
const filterTag = ref('')

const episodeOptions = ref([]) // 当前剧本的分集，用于「出现集数」

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
    appearEpisodes: [],
    relations: [],
    avatarAssetId: '',
    referenceAssetIds: [],
    profile: '',
    createdAt: '',
  }
}

function profileTemplate(name) {
  return `# ${name || '角色名'}

## 基础信息

- 角色定位：
- 性别：
- 年龄：
- 身份：

## 性格与动机

- 性格：
- 核心动机：
- 内在矛盾：

## 外观设定

-

## 说话方式

-

## 角色关系

-

## 创作备注

- 后续生成分镜和图片时，应保持角色外观一致。`
}

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

async function loadRoles(preferId) {
  if (!project.value?.path) return
  loading.value = true
  try {
    roles.value = await api.roles.list(project.value.path)
    if (preferId && roles.value.find((r) => r.id === preferId)) {
      await selectRole(preferId, true)
    }
  } catch (err) {
    message.error('加载角色失败：' + err.message)
  } finally {
    loading.value = false
  }
}

async function loadEpisodes() {
  if (!project.value?.path) return
  try {
    const list = await api.scripts.list(project.value.path)
    if (!list.length) return (episodeOptions.value = [])
    const data = await api.scripts.read({ projectPath: project.value.path, scriptId: list[0].id })
    episodeOptions.value = (data.meta.episodes || []).map((e) => ({
      value: e.episodeNo,
      label: `第${e.episodeNo}集${e.title ? ' · ' + e.title : ''}`,
    }))
  } catch {
    episodeOptions.value = []
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

function applyRole(meta, profile) {
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
    appearEpisodes: [...(meta.appearEpisodes || [])],
    relations: (meta.relations || []).map((r) => ({ ...r })),
    avatarAssetId: meta.avatarAssetId || '',
    referenceAssetIds: [...(meta.referenceAssetIds || [])],
    profile: profile || '',
    createdAt: meta.createdAt || '',
  })
}

async function selectRole(id, force = false) {
  if (!force && id === activeRoleId.value) return
  const doLoad = async () => {
    try {
      const { meta, profile } = await api.roles.read({ projectPath: project.value.path, roleId: id })
      applyRole(meta, profile)
      activeRoleId.value = id
      editing.value = true
      mode.value = 'form'
      dirty.value = false
    } catch (err) {
      message.error('读取角色失败：' + err.message)
    }
  }
  if (force) return doLoad()
  guardDirty(doLoad)
}

function newRole() {
  guardDirty(() => {
    Object.assign(form, blankForm(), { id: genLocalId('role'), profile: profileTemplate('') })
    activeRoleId.value = form.id
    editing.value = true
    mode.value = 'form'
    dirty.value = true
  })
}

// ---------- 关系编辑 ----------
function addRelation() {
  form.relations.push({ targetName: '', relation: '' })
  dirty.value = true
}
function removeRelation(idx) {
  form.relations.splice(idx, 1)
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

const renderedProfile = computed(() => renderMarkdown(form.profile))
const avatarUrl = computed(() => assetPreviewUrl(form.avatarAssetId))

function markDirty() {
  dirty.value = true
}

function roleAvatarUrl(r) {
  return r.avatarAssetId ? assetPreviewUrl(r.avatarAssetId) : ''
}

async function loadAssets() {
  if (!project.value?.path) return
  try {
    assets.value = await api.assets.list(project.value.path)
  } catch {
    assets.value = []
  }
}

onMounted(() => {
  loadRoles()
  loadEpisodes()
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
              <img v-if="roleAvatarUrl(r)" :src="roleAvatarUrl(r)" :alt="r.name" />
              <span v-else>{{ (r.name || '?').slice(0, 1) }}</span>
            </div>
            <div class="role-info">
              <div class="role-name">{{ r.name }}</div>
              <div class="role-meta">
                <span class="role-type">{{ r.roleType }}</span>
                <span v-if="r.tags && r.tags.length" class="role-tags">{{ r.tags.join(' / ') }}</span>
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
        <button class="foot-btn" disabled title="将在后续任务开放">
          <Sparkles :size="15" /> AI提取角色
        </button>
      </div>
    </aside>

    <!-- 中：角色卡编辑 -->
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

        <div class="main-modes">
          <button class="mode-btn" :class="{ active: mode === 'form' }" @click="mode = 'form'">基础信息</button>
          <button class="mode-btn" :class="{ active: mode === 'preview' }" @click="mode = 'preview'">
            <Eye :size="13" /> 设定预览
          </button>
          <button class="mode-btn" :class="{ active: mode === 'source' }" @click="mode = 'source'">
            <Code :size="13" /> 设定源码
          </button>
        </div>

        <div class="main-body">
          <!-- 基础字段 -->
          <a-form v-show="mode === 'form'" layout="vertical" class="role-form">
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

          <!-- 设定预览 -->
          <div v-show="mode === 'preview'" class="md-preview" v-html="renderedProfile" />

          <!-- 设定源码 -->
          <textarea
            v-show="mode === 'source'"
            v-model="form.profile"
            class="md-source"
            spellcheck="false"
            placeholder="在此编写角色设定 Markdown"
            @input="markDirty"
          />
        </div>
      </template>
    </section>

    <!-- 右：关联信息 -->
    <aside v-if="editing" class="role-aside">
      <div class="aside-block">
        <div class="aside-title">出现集数</div>
        <a-select
          v-model:value="form.appearEpisodes"
          mode="multiple"
          class="w-full"
          placeholder="选择角色出现的集数"
          :options="episodeOptions"
          @change="markDirty"
        />
        <div v-if="!episodeOptions.length" class="aside-hint">当前剧本暂无分集，可先在剧本库一键转化建集。</div>
      </div>

      <div class="aside-block">
        <div class="aside-title-row">
          <span class="aside-title">角色关系</span>
          <button class="mini-btn" @click="addRelation"><Plus :size="14" /></button>
        </div>
        <div v-for="(rel, idx) in form.relations" :key="idx" class="relation-row">
          <a-input v-model:value="rel.targetName" size="small" placeholder="对方角色" @change="markDirty" />
          <a-input v-model:value="rel.relation" size="small" placeholder="关系" @change="markDirty" />
          <button class="mini-btn del" @click="removeRelation(idx)"><X :size="14" /></button>
        </div>
        <div v-if="!form.relations.length" class="aside-hint">暂无角色关系，点击右上角添加。</div>
      </div>

      <div class="aside-block">
        <div class="aside-title">头像资产</div>
        <div class="avatar-pick">
          <div class="avatar-box">
            <img v-if="avatarUrl" :src="avatarUrl" alt="头像" />
            <Users v-else :size="22" />
          </div>
          <a-select
            v-model:value="form.avatarAssetId"
            class="w-full"
            allow-clear
            placeholder="选择图片资产作为头像"
            :options="imageAssetOptions"
            @change="markDirty"
          />
        </div>
        <div v-if="!imageAssets.length" class="aside-hint">资产库暂无图片，可先在资产库导入。</div>
      </div>

      <div class="aside-block">
        <div class="aside-title">参考资产</div>
        <a-select
          v-model:value="form.referenceAssetIds"
          mode="multiple"
          class="w-full"
          placeholder="选择参考资产（图片/音频/视频/文档）"
          :options="assetOptions"
          @change="markDirty"
        />
        <div v-if="!assets.length" class="aside-hint">资产库暂无资产，可先在资产库导入。</div>
      </div>
    </aside>
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
  width: 268px;
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
.role-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
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
  width: 38px;
  height: 38px;
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
  min-width: 0;
  flex: 1;
}
.role-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-meta {
  display: flex;
  gap: 6px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-tertiary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.role-type {
  color: var(--brand-color);
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

/* 中间编辑 */
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
.main-modes {
  display: flex;
  gap: 4px;
  padding: 10px 18px 0;
}
.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.mode-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.mode-btn.active {
  background: var(--bg-active);
  color: var(--brand-color);
  font-weight: 600;
}
.main-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 18px 22px 28px;
}
.role-form {
  max-width: 720px;
}
.form-row {
  display: flex;
  gap: 14px;
}
.col {
  flex: 1;
}
.md-source {
  width: 100%;
  min-height: 420px;
  resize: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.85;
  outline: none;
}
.md-source:focus {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

/* 右侧关联 */
.role-aside {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  background: var(--bg-panel);
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.aside-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.aside-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.aside-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.aside-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
.w-full {
  width: 100%;
}
.avatar-pick {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar-box {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  color: var(--text-tertiary);
  border: 1px solid var(--border-color);
}
.avatar-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.relation-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mini-btn {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.14s ease;
}
.mini-btn:hover {
  color: var(--brand-color);
  border-color: var(--brand-color);
}
.mini-btn.del:hover {
  color: #ff4d4f;
  border-color: #ff4d4f;
}
</style>

<style scoped>
.md-preview {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.85;
}
.md-preview :deep(h1) {
  font-size: 20px;
  margin: 4px 0 14px;
}
.md-preview :deep(h2) {
  font-size: 16px;
  margin: 18px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}
.md-preview :deep(ul) {
  padding-left: 20px;
  margin: 6px 0;
}
.md-preview :deep(strong) {
  color: var(--brand-color);
}
</style>
