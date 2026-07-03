<script setup>
// 角色库：当前作品的角色卡工作区（结构化 JSON 管理）
// 左：角色列表（搜索/筛选/新建/AI提取） 右：角色卡编辑（基础字段 + 形象图 + 声线）
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { Users, Plus, Sparkles, Save, Trash2, Search, ImagePlus, Wand2, X, LoaderCircle } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { useUsageStore } from '../../store/usage.js'
import { useRoleTaskStore } from '../../store/roleTasks.js'
import { api } from '../../services/bridge.js'
import { genLocalId } from '../../utils/id.js'
import { parseExtractedRoles } from '../../utils/markdown.js'
import { assetUrl } from '../../utils/asset.js'
import { extractRolesFromScript } from '../../services/ai.js'

const appStore = useAppStore()
const usageStore = useUsageStore()
const roleTask = useRoleTaskStore()
const project = computed(() => appStore.currentProject)

const ROLE_TYPES = ['主角', '配角', '反派', '路人', '旁白']

const roles = ref([])
const loading = ref(false)
const saving = ref(false)
const uploadingImages = ref(false)

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
    voiceLine: '',
    tags: [],
    images: [],
    createdAt: '',
  }
}

// ---------- 形象图（多张，工程内相对路径） ----------
function imgUrl(relFile) {
  return assetUrl(project.value?.path, relFile)
}
function roleThumbUrl(r) {
  return r.cover ? assetUrl(project.value?.path, r.cover) : ''
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

// ---------- 形象图：上传 / 删除 / AI生成(TODO) ----------
async function uploadImages() {
  if (!project.value?.path || !form.id) return
  try {
    const filePaths = await api.dialog.selectAssetFiles()
    if (!filePaths || !filePaths.length) return
    uploadingImages.value = true
    const added = await api.roles.importImages({
      projectPath: project.value.path,
      roleId: form.id,
      filePaths,
    })
    if (added.length) {
      form.images.push(...added)
      markDirty()
      message.success(`已添加 ${added.length} 张形象图，保存后生效`)
    } else {
      message.warning('未选择到有效图片（支持 png/jpg/jpeg/webp/gif）')
    }
  } catch (err) {
    message.error('上传失败：' + err.message)
  } finally {
    uploadingImages.value = false
  }
}

async function removeImage(relFile) {
  try {
    await api.roles.removeImage({ projectPath: project.value.path, file: relFile })
  } catch {
    // 删文件失败不阻断，仅从列表移除
  }
  form.images = form.images.filter((f) => f !== relFile)
  markDirty()
}

// TODO: 接入图片生成模型后，改为后台任务生成角色形象图
function aiGenerateImage() {
  message.info('AI 形象图生成能力开发中（已预留 TODO）')
}

// ---------- AI 补全角色卡（后台运行） ----------
async function aiComplete() {
  if (!project.value?.path) return
  if (!form.name.trim()) return message.warning('请先填写角色名')
  if (!(appStore.settings.models || []).length) return message.warning('请先在设置页添加模型')
  if (dirty.value) return message.warning('有未保存的修改，请先保存后再补全')
  let scriptText = ''
  try {
    const list = await api.scripts.list(project.value.path)
    if (list.length) {
      const data = await api.scripts.read({ projectPath: project.value.path, scriptId: list[0].id })
      const parts = [data.overview || '']
      ;(data.episodes || []).forEach((e) => parts.push(e.content || ''))
      scriptText = parts.filter(Boolean).join('\n\n').slice(0, 16000)
    }
  } catch {
    scriptText = ''
  }
  const res = roleTask.completeRole({ projectPath: project.value.path, role: { ...form }, scriptText })
  if (!res.ok) return message.warning(res.reason)
  message.success('已开始 AI 补全（后台进行，可继续操作）')
}

watch(
  () => roleTask.version,
  async () => {
    if (roleTask.status === 'done') {
      await loadRoles()
      if (roleTask.resultRoleId && roleTask.resultRoleId === activeRoleId.value) {
        try {
          const meta = await api.roles.read({ projectPath: project.value.path, roleId: roleTask.resultRoleId })
          applyRole(meta)
          dirty.value = false
        } catch {
          // ignore
        }
      }
      message.success('AI 补全完成')
    } else if (roleTask.status === 'error') {
      message.error('AI 补全失败：' + roleTask.error)
    }
  },
)

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
    voiceLine: meta.voiceLine || '',
    tags: [...(meta.tags || [])],
    images: [...(meta.images || [])],
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
            <a-button
              :loading="roleTask.active && roleTask.roleId === form.id"
              :disabled="roleTask.active"
              @click="aiComplete"
            >
              <template #icon><Wand2 :size="15" /></template>
              AI补全
            </a-button>
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
            <div v-if="roleTask.active && roleTask.roleId === form.id" class="ai-banner">
              <LoaderCircle :size="15" class="spin" /> AI 正在后台补全该角色信息…
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
              <a-form-item label="角色声线（供视频/配音模型使用的文本描述）">
                <a-textarea
                  v-model:value="form.voiceLine"
                  :rows="2"
                  placeholder="如：低沉磁性的青年男声，略带沙哑，语气克制而坚定"
                  @change="markDirty"
                />
              </a-form-item>
              <a-form-item label="标签">
                <a-select v-model:value="form.tags" mode="tags" placeholder="输入后回车添加标签" @change="markDirty" />
              </a-form-item>
            </a-form>

            <!-- 角色形象图（多张，上传或 AI 生成），置于底部 -->
            <div class="images-section">
              <div class="section-label"><ImagePlus :size="15" /> 角色形象图</div>
              <div class="image-grid">
                <div v-for="img in form.images" :key="img" class="image-cell">
                  <img :src="imgUrl(img)" alt="形象图" />
                  <button class="img-del" title="删除" @click="removeImage(img)"><X :size="14" /></button>
                </div>
                <button class="image-add" :disabled="uploadingImages" @click="uploadImages">
                  <ImagePlus :size="20" />
                  <span>{{ uploadingImages ? '上传中…' : '上传图片' }}</span>
                </button>
                <button class="image-add" @click="aiGenerateImage">
                  <Wand2 :size="20" />
                  <span>AI生成</span>
                </button>
              </div>
              <div class="section-hint">支持 png / jpg / jpeg / webp / gif，可添加多张；AI 生成暂为预留能力。</div>
            </div>
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
.ai-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 9px 14px;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--brand-color);
  font-size: 13px;
}
.spin {
  animation: role-spin 0.9s linear infinite;
}
@keyframes role-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 底部形象图区 */
.images-section {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--border-color);
}
.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.image-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: var(--bg-sunken);
}
.image-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.img-del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.image-cell:hover .img-del {
  opacity: 1;
}
.image-add {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.image-add:hover:not(:disabled) {
  color: var(--brand-color);
  border-color: var(--brand-color);
  background: var(--brand-soft);
}
.image-add:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.section-hint {
  margin-top: 10px;
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
