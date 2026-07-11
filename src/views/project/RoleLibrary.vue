<script setup>
// 角色库：当前作品的角色卡工作区（结构化 JSON 管理）
// 左：角色列表（搜索/筛选/新建/AI提取） 右：角色卡编辑（基础字段 + 形象图 + 声线）
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import { Users, Plus, Sparkles, Save, Trash2, Search, ImagePlus, Wand2, X, LoaderCircle, Check, Upload, Eye, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { useRoleTaskStore } from '../../store/roleTasks.js'
import { useRoleImageTaskStore } from '../../store/roleImageTasks.js'
import { useUsageStore } from '../../store/usage.js'
import { api } from '../../services/bridge.js'
import { generateRoleImagePrompts } from '../../services/ai.js'
import { genLocalId } from '../../utils/id.js'
import { assetUrl } from '../../utils/asset.js'
import {
  ROLE_IMAGE_STYLE_PRESETS,
  ROLE_IMAGE_VARIANTS,
  buildRoleAppearancePrompt,
  getRoleImageStylePreset,
} from '../../utils/roleImagePrompt.js'

const appStore = useAppStore()
const roleTask = useRoleTaskStore()
const roleImageTask = useRoleImageTaskStore()
const usageStore = useUsageStore()
const route = useRoute()
const router = useRouter()
const project = computed(() => appStore.currentProject)

const ROLE_TYPES = ['主角', '配角', '反派', '路人']

const roles = ref([])
const loading = ref(false)
const saving = ref(false)
const uploadingImages = ref(false)
const uploadingReferences = ref(false)

const editing = ref(false)
const activeRoleId = ref(null)
const dirty = ref(false)

const search = ref('')
const filterType = ref('')

const form = reactive(blankForm())
const imageGenerateOpen = ref(false)
const imageGenerateStep = ref(1)
const imageGenerateSubmitting = ref(false)
const imagePromptGenerating = ref(false)
const imagePromptGeneratedFor = ref('')
const imagePromptTab = ref(ROLE_IMAGE_VARIANTS[0].key)
const imageGenerateForm = reactive({
  styleText: '',
  styleTemplate: ROLE_IMAGE_STYLE_PRESETS[0].value,
  prompts: {
    sheet: '',
    portrait: '',
    expressions: '',
  },
  references: [],
  referenceOptions: [],
})
const imagePreview = reactive({
  open: false,
  index: 0,
})
const previewImageFile = computed(() => form.images[imagePreview.index] || '')
const previewImageTitle = computed(
  () => `${form.name || '角色'} · 形象图 ${Math.min(imagePreview.index + 1, form.images.length)}/${form.images.length}`,
)
const imageStyleOptions = ROLE_IMAGE_STYLE_PRESETS.map((preset) => ({
  value: preset.value,
  label: preset.label,
}))
const imagePromptSignature = computed(() =>
  [
    buildRoleAppearancePrompt(form),
    imageGenerateForm.styleText.trim(),
    [...imageGenerateForm.references].sort().join('|'),
  ].join('\n'),
)
const imagePromptReady = computed(
  () =>
    ROLE_IMAGE_VARIANTS.every((variant) => !!imageGenerateForm.prompts[variant.key]?.trim()) &&
    imagePromptGeneratedFor.value === imagePromptSignature.value,
)
const imageGenerationConfigured = computed(
  () => !!String(appStore.settings.imageGeneration?.apiKey || '').trim(),
)
const promptModelConfigured = computed(() => !!(appStore.settings.models || []).length)

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

function openImagePreview(index) {
  imagePreview.index = Math.max(0, Math.min(index, form.images.length - 1))
  imagePreview.open = !!form.images.length
}

function previousPreviewImage() {
  if (!form.images.length) return
  imagePreview.index = (imagePreview.index - 1 + form.images.length) % form.images.length
}

function nextPreviewImage() {
  if (!form.images.length) return
  imagePreview.index = (imagePreview.index + 1) % form.images.length
}

// ---------- 列表与筛选 ----------
const filteredRoles = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return roles.value.filter((r) => {
    if (filterType.value && r.roleType !== filterType.value) return false
    const haystack = [r.name, r.identity, r.gender, r.age].filter(Boolean).join(' ').toLowerCase()
    if (kw && !haystack.includes(kw)) return false
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

// ---------- 形象图：手动上传 / 删除 / AI 创建 ----------
async function uploadImages() {
  if (!project.value?.path || !form.id) return
  try {
    const filePaths = await api.dialog.selectAssetFiles()
    if (!filePaths?.length) return
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
  if (previewImageFile.value === relFile) imagePreview.open = false
  form.images = form.images.filter((f) => f !== relFile)
  markDirty()
}

function aiGenerateImage() {
  if (!project.value?.path || !form.id) return
  if (!form.name.trim()) return message.warning('请先填写角色名')
  if (roleImageTask.hasRole(form.id)) return message.warning('该角色已有图片生成任务，请等待完成')
  Object.assign(imageGenerateForm, {
    styleText: '',
    styleTemplate: ROLE_IMAGE_STYLE_PRESETS[0].value,
    prompts: {
      sheet: '',
      portrait: '',
      expressions: '',
    },
    references: form.images.slice(0, 3),
    referenceOptions: [...form.images],
  })
  imageGenerateStep.value = 1
  imagePromptTab.value = ROLE_IMAGE_VARIANTS[0].key
  imagePromptGeneratedFor.value = ''
  imageGenerateOpen.value = true
}

function applyStyleTemplate() {
  const preset = getRoleImageStylePreset(imageGenerateForm.styleTemplate)
  imageGenerateForm.styleText = `${preset.label}：${preset.guidance}`
}

function openImageSettings() {
  imageGenerateOpen.value = false
  router.push('/settings')
}

function toggleReference(relFile) {
  const selected = imageGenerateForm.references
  const index = selected.indexOf(relFile)
  if (index >= 0) {
    selected.splice(index, 1)
    return
  }
  if (selected.length >= 10) return message.warning('最多选择 10 张参考图')
  selected.push(relFile)
}

async function uploadGenerationReferences() {
  if (!project.value?.path || !form.id) return
  try {
    const filePaths = await api.dialog.selectAssetFiles()
    if (!filePaths?.length) return
    uploadingReferences.value = true
    const added = await api.roles.importReferences({
      projectPath: project.value.path,
      roleId: form.id,
      filePaths,
    })
    added.forEach((file) => {
      if (!imageGenerateForm.referenceOptions.includes(file)) {
        imageGenerateForm.referenceOptions.push(file)
      }
      if (imageGenerateForm.references.length < 10 && !imageGenerateForm.references.includes(file)) {
        imageGenerateForm.references.push(file)
      }
    })
    if (added.length) message.success(`已添加 ${added.length} 张可选参考图`)
    else message.warning('未选择到有效图片（支持 png/jpg/jpeg/webp/gif）')
  } catch (err) {
    message.error('参考图上传失败：' + err.message)
  } finally {
    uploadingReferences.value = false
  }
}

async function generateImagePromptSet() {
  if (imagePromptReady.value) {
    imageGenerateStep.value = 2
    return
  }
  const styleText = imageGenerateForm.styleText.trim()
  if (!styleText) return message.warning('请输入生成风格，或选择模板后点击「使用该模板」')
  if (!promptModelConfigured.value) return message.warning('请先在设置页添加用于生成提示词的文本模型')
  const sourceSignature = imagePromptSignature.value
  const projectPath = project.value.path
  imagePromptGenerating.value = true
  try {
    const { prompts, usage } = await generateRoleImagePrompts({
      role: { ...form },
      appearancePrompt: buildRoleAppearancePrompt(form),
      styleDescription: styleText,
      referenceCount: imageGenerateForm.references.length,
      modelId: appStore.currentModelId,
    })
    await usageStore.add(projectPath, usage)
    Object.assign(imageGenerateForm.prompts, prompts)
    imagePromptGeneratedFor.value = sourceSignature
    imagePromptTab.value = ROLE_IMAGE_VARIANTS[0].key
    imageGenerateStep.value = 2
    message.success('三张角色形象图提示词已生成')
  } catch (err) {
    message.error('提示词生成失败：' + err.message)
  } finally {
    imagePromptGenerating.value = false
  }
}

function backToImageSetup() {
  imageGenerateStep.value = 1
}

async function runImageWizardPrimary() {
  if (imageGenerateStep.value === 1) {
    await generateImagePromptSet()
    return
  }
  await confirmImageGeneration()
}

async function confirmImageGeneration() {
  if (!imagePromptReady.value) {
    imageGenerateStep.value = 1
    return message.warning('风格或参考图已变化，请重新生成三组提示词')
  }
  imageGenerateSubmitting.value = true
  try {
    if (dirty.value || !roles.value.some((role) => role.id === form.id)) {
      const saved = await saveRole({ silent: true })
      if (!saved) return
    }
    const result = roleImageTask.enqueueBatch({
      projectPath: project.value.path,
      projectName: project.value.name,
      roleId: form.id,
      roleName: form.name.trim(),
      referenceImages: imageGenerateForm.references,
      items: ROLE_IMAGE_VARIANTS.map((variant) => ({
        variant: variant.key,
        variantLabel: variant.label,
        usePrimaryReference: variant.usePrimaryReference,
        prompt: imageGenerateForm.prompts[variant.key],
      })),
    })
    if (!result.ok) return message.warning(result.reason)
    imageGenerateOpen.value = false
    message.success('已加入 3 张角色形象图任务，将按主参考图、肖像图、表情图依次生成')
  } finally {
    imageGenerateSubmitting.value = false
  }
}

// ---------- AI 调整角色信息（后台运行） ----------
const adjustOpen = ref(false)
const adjustInstruction = ref('')

function openAdjustModal() {
  if (!project.value?.path) return
  if (!form.name.trim()) return message.warning('请先填写角色名')
  if (!(appStore.settings.models || []).length) return message.warning('请先在设置页添加模型')
  adjustInstruction.value = ''
  adjustOpen.value = true
}

async function confirmAiAdjust() {
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
  const res = roleTask.adjustRole({
    projectPath: project.value.path,
    role: { ...form },
    scriptText,
    instruction: adjustInstruction.value.trim(),
  })
  if (!res.ok) return message.warning(res.reason)
  adjustOpen.value = false
  message.success('已开始 AI 调整角色信息（后台进行，可继续操作）')
}

watch(
  () => roleTask.version,
  async () => {
    if (roleTask.status === 'done' && roleTask.kind === 'adjust') {
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
      message.success('AI 调整角色信息完成')
    } else if (roleTask.status === 'done' && roleTask.kind === 'extract') {
      openExtractResult()
    } else if (roleTask.status === 'error') {
      message.error((roleTask.kind === 'extract' ? 'AI提取角色失败：' : 'AI调整角色信息失败：') + roleTask.error)
    }
  },
)

// 生成任务由全局队列执行；完成后只同步当前表单的图片列表，不覆盖用户正在编辑的文字字段。
watch(
  () => roleImageTask.version,
  async () => {
    await loadRoles()
    const event = roleImageTask.lastEvent
    if (
      event?.status === 'done' &&
      event.projectPath === project.value?.path &&
      event.roleId === activeRoleId.value &&
      event.result?.file &&
      !form.images.includes(event.result.file)
    ) {
      if (event.variant === 'sheet') form.images.unshift(event.result.file)
      else form.images.push(event.result.file)
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
  imagePreview.open = false
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
async function saveRole(options = {}) {
  const silent = options?.silent === true
  if (!project.value?.path) return null
  if (!form.name.trim()) {
    message.warning('请填写角色名')
    return null
  }
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
    if (!silent) message.success('已保存')
    return meta
  } catch (err) {
    message.error('保存失败：' + err.message)
    return null
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

// ---------- AI 提取角色（后台运行，切换界面不中断） ----------
const extractOpen = ref(false)
const importingRoles = ref(false)
const extractRoles = ref([])

function aiExtract() {
  if (!project.value?.path) return
  if (!(appStore.settings.models || []).length) return message.warning('请先在设置页添加模型')
  const res = roleTask.extractRoles({ projectPath: project.value.path })
  if (!res.ok) return message.warning(res.reason)
  message.success('已开始 AI 提取并补全角色信息（后台进行，可切换界面）')
}

// 读取后台提取结果并弹出确认导入；无结果时提示手动新建
function openExtractResult() {
  const drafts = roleTask.consumeExtract()
  if (!drafts.length) {
    message.warning('未能自动识别角色，请手动新建角色')
    return
  }
  extractRoles.value = drafts.map((d) => ({ ...d, checked: true }))
  extractOpen.value = true
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
          voiceLine: d.voiceLine,
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

onMounted(async () => {
  await loadRoles()
  // 从工程画布「编辑角色」跳转而来：直接定位到对应角色并进入编辑
  const targetRoleId = route.query.roleId
  if (targetRoleId) {
    router.replace({ path: '/project/roles' })
    selectRole(String(targetRoleId))
  }
  // 若离开期间后台提取已完成，回到角色库时展示结果
  if (roleTask.kind === 'extract' && roleTask.extractDrafts.length) openExtractResult()
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
              <div class="role-meta">
                <span v-if="r.identity" class="role-meta-text">{{ r.identity }}</span>
                <span v-if="r.gender || r.age" class="role-meta-sub">
                  {{ [r.gender, r.age].filter(Boolean).join(' · ') }}
                </span>
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
        <button class="foot-btn" :disabled="roleTask.active" @click="aiExtract">
          <Sparkles :size="15" /> {{ roleTask.active && roleTask.kind === 'extract' ? '提取中…' : 'AI提取角色' }}
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
              @click="openAdjustModal"
            >
              <template #icon><Wand2 :size="15" /></template>
              AI调整
            </a-button>
            <a-button danger :disabled="roleImageTask.hasRole(form.id)" @click="removeRole">
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
              <LoaderCircle :size="15" class="spin" /> AI 正在后台调整该角色的外观、性格与声线…
            </div>
            <div v-if="roleImageTask.hasRole(form.id)" class="ai-banner">
              <LoaderCircle :size="15" class="spin" />
              {{
                roleImageTask.queuedPosition(form.id) === 0
                  ? '正在生成该角色的参考图，完成后会自动下载…'
                  : `该角色参考图正在队列第 ${roleImageTask.queuedPosition(form.id)} 位等待…`
              }}
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
                <a-textarea v-model:value="form.personality" :rows="3" placeholder="如：隐忍、敏感、行动力强；遇到压力时会先压住情绪再行动" @change="markDirty" />
              </a-form-item>
              <a-form-item label="核心动机">
                <a-textarea v-model:value="form.motivation" :rows="3" placeholder="如：查清父亲失踪真相；证明自己不是只能被安排命运的人" @change="markDirty" />
              </a-form-item>
              <a-form-item label="外观设定">
                <a-textarea v-model:value="form.appearance" :rows="4" placeholder="如：黑色长发，清瘦，常穿深色外套；眼神克制，雨夜场景常带透明雨伞" @change="markDirty" />
              </a-form-item>
              <a-form-item label="说话方式">
                <a-textarea v-model:value="form.voice" :rows="3" placeholder="如：语速偏慢，情绪压住时声音发紧；习惯用短句反问，不轻易示弱" @change="markDirty" />
              </a-form-item>
              <a-form-item label="角色声线（供视频/配音模型使用的文本描述）">
                <a-textarea
                  v-model:value="form.voiceLine"
                  :rows="3"
                  placeholder="如：低沉磁性的青年男声，略带沙哑，语气克制而坚定"
                  @change="markDirty"
                />
              </a-form-item>
            </a-form>

            <!-- 角色形象图：保留手动上传，右侧使用 AI 创建三张参考图 -->
            <div class="images-section">
              <div class="section-label"><ImagePlus :size="15" /> 角色形象图</div>
              <div v-if="form.images.length" class="image-grid">
                <div v-for="(img, index) in form.images" :key="img" class="image-cell">
                  <button
                    type="button"
                    class="image-preview-trigger"
                    :aria-label="`预览${form.name || '角色'}形象图 ${index + 1}`"
                    @click="openImagePreview(index)"
                  >
                    <img :src="imgUrl(img)" :alt="`${form.name || '角色'}形象图 ${index + 1}`" />
                    <span class="image-preview-mask"><Eye :size="16" /> 预览</span>
                  </button>
                  <button class="img-del" title="删除" @click.stop="removeImage(img)"><X :size="14" /></button>
                </div>
              </div>
              <div class="image-action-row">
                <button
                  class="image-add"
                  :disabled="uploadingImages || roleImageTask.hasRole(form.id)"
                  @click="uploadImages"
                >
                  <LoaderCircle v-if="uploadingImages" :size="20" class="spin" />
                  <ImagePlus v-else :size="20" />
                  <span>{{ uploadingImages ? '上传中…' : '手动上传' }}</span>
                </button>
                <button
                  class="image-add image-ai-create"
                  :disabled="roleImageTask.hasRole(form.id)"
                  @click="aiGenerateImage"
                >
                  <LoaderCircle v-if="roleImageTask.hasRole(form.id)" :size="20" class="spin" />
                  <Wand2 v-else :size="20" />
                  <span>
                    {{
                      roleImageTask.hasRole(form.id)
                        ? roleImageTask.queuedPosition(form.id) === 0
                          ? '正在创建形象图'
                          : '形象图排队中'
                        : 'AI创建 3 张形象图'
                    }}
                  </span>
                </button>
              </div>
              <div class="section-hint">左侧可手动上传；右侧 AI 将依次创建主参考图、3:4 标准肖像图和 3×3 表情参考图。</div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- 角色形象图大图预览 -->
    <a-modal
      v-model:open="imagePreview.open"
      :title="previewImageTitle"
      :width="1040"
      :footer="null"
      centered
      wrap-class-name="role-image-preview-modal"
    >
      <div class="role-image-preview-stage">
        <button
          v-if="form.images.length > 1"
          type="button"
          class="preview-nav previous"
          aria-label="预览上一张形象图"
          @click="previousPreviewImage"
        >
          <ChevronLeft :size="24" />
        </button>
        <img
          v-if="previewImageFile"
          :src="imgUrl(previewImageFile)"
          :alt="previewImageTitle"
        />
        <button
          v-if="form.images.length > 1"
          type="button"
          class="preview-nav next"
          aria-label="预览下一张形象图"
          @click="nextPreviewImage"
        >
          <ChevronRight :size="24" />
        </button>
      </div>
      <div class="role-image-preview-hint">点击左右按钮可切换当前角色的全部形象图</div>
    </a-modal>

    <!-- AI 调整角色信息 -->
    <a-modal
      v-model:open="adjustOpen"
      title="AI 调整角色信息"
      :width="560"
      ok-text="开始调整"
      cancel-text="取消"
      :confirm-loading="roleTask.active && roleTask.kind === 'adjust'"
      @ok="confirmAiAdjust"
    >
      <div class="adjust-tip">
        可以说明你希望怎样调整这个角色。AI 会重点处理外观设定、性格、说话方式和声线。
      </div>
      <a-textarea
        v-model:value="adjustInstruction"
        :rows="5"
        placeholder="例如：外观更有都市冷感，性格更克制但内心有爆发力；声线偏低、略沙哑，适合短剧女主。"
      />
    </a-modal>

    <!-- AI 创建三张角色形象图 -->
    <a-modal
      v-model:open="imageGenerateOpen"
      title="AI 创建角色形象图"
      :width="760"
      wrap-class-name="role-image-generate-modal"
    >
      <a-result
        v-if="!imageGenerationConfigured"
        status="warning"
        title="暂时不可用，请先配置APIKEY！"
        sub-title="在设置页填写火山方舟 ARK API Key 后，即可使用 AI 创建角色形象图。"
      >
        <template #extra>
          <a-button type="primary" @click="openImageSettings">前往设置</a-button>
        </template>
      </a-result>

      <template v-else>
        <div class="image-wizard-steps" aria-label="角色形象图创建步骤">
          <div class="wizard-step" :class="{ active: imageGenerateStep === 1, done: imageGenerateStep > 1 }">
            <span>1</span>
            <div><strong>风格与参考图</strong><small>输入生成风格</small></div>
          </div>
          <div class="wizard-connector" :class="{ done: imageGenerateStep > 1 }" />
          <div class="wizard-step" :class="{ active: imageGenerateStep === 2 }">
            <span>2</span>
            <div><strong>确认三组提示词</strong><small>编辑后开始生成</small></div>
          </div>
        </div>

        <template v-if="imageGenerateStep === 1">
        <a-alert
          v-if="!promptModelConfigured"
          type="warning"
          show-icon
          class="image-gen-alert"
          message="尚未配置文本模型"
          description="下一步需要文本模型根据当前角色资料生成三组图片提示词。"
        />

        <a-form layout="vertical">
          <a-form-item label="生成风格" required>
            <a-textarea
              v-model:value="imageGenerateForm.styleText"
              :rows="3"
              :disabled="imagePromptGenerating"
              placeholder="输入希望生成的风格，例如：复古港风电影摄影、低饱和自然光、细腻胶片颗粒"
            />
            <div class="style-template-row">
              <a-select
                v-model:value="imageGenerateForm.styleTemplate"
                :options="imageStyleOptions"
                :disabled="imagePromptGenerating"
                placeholder="选择风格模板"
              />
              <a-button :disabled="imagePromptGenerating" @click="applyStyleTemplate">
                使用该模板
              </a-button>
            </div>
          </a-form-item>

          <div class="image-output-plan">
            <div v-for="variant in ROLE_IMAGE_VARIANTS" :key="variant.key" class="output-plan-item">
              <ImagePlus :size="16" />
              <div>
                <strong>{{ variant.label }}</strong>
                <span>{{ variant.aspect }} · {{ variant.description }}</span>
              </div>
            </div>
          </div>

          <a-form-item :label="`参考图（可选，已选 ${imageGenerateForm.references.length}/10）`">
            <div v-if="imageGenerateForm.referenceOptions.length" class="reference-picker">
              <button
                v-for="img in imageGenerateForm.referenceOptions"
                :key="img"
                type="button"
                class="reference-option"
                :class="{ active: imageGenerateForm.references.includes(img) }"
                :aria-pressed="imageGenerateForm.references.includes(img)"
                :disabled="imagePromptGenerating"
                @click="toggleReference(img)"
              >
                <img :src="imgUrl(img)" alt="角色参考图" />
                <span v-if="imageGenerateForm.references.includes(img)" class="reference-check">
                  <Check :size="14" />
                </span>
              </button>
            </div>
            <div v-else class="reference-empty">未选择参考图，将直接根据当前角色资料生成。</div>
            <button
              type="button"
              class="reference-upload"
              :disabled="imagePromptGenerating || uploadingReferences || imageGenerateForm.references.length >= 10"
              @click="uploadGenerationReferences"
            >
              <LoaderCircle v-if="uploadingReferences" :size="14" class="spin" />
              <Upload v-else :size="14" />
              {{ uploadingReferences ? '上传中…' : '上传并选为参考图' }}
            </button>
          </a-form-item>
        </a-form>
        </template>

        <template v-else>
        <div class="prompt-review-tip">
          <Sparkles :size="15" />
          AI 已根据角色资料与所选风格生成三组提示词。三张图片将串行生成，后两张会自动使用主参考图保持人物一致。
        </div>
        <a-tabs v-model:activeKey="imagePromptTab" class="prompt-tabs">
          <a-tab-pane
            v-for="variant in ROLE_IMAGE_VARIANTS"
            :key="variant.key"
          >
            <template #tab>
              {{ variant.label }} · {{ variant.aspect }}
            </template>
            <div class="prompt-tab-meta">{{ variant.description }}</div>
            <a-textarea
              v-model:value="imageGenerateForm.prompts[variant.key]"
              :rows="12"
              :disabled="imageGenerateSubmitting"
              :placeholder="`AI 尚未生成${variant.label}提示词`"
            />
          </a-tab-pane>
        </a-tabs>
        <div class="prompt-generation-state" :class="{ ready: imagePromptReady, stale: !imagePromptReady }">
          <Check v-if="imagePromptReady" :size="13" />
          <Sparkles v-else :size="13" />
          <span v-if="imagePromptReady">三组提示词已准备完成，可以开始生成 3 张角色形象图。</span>
          <span v-else>三组提示词必须完整；如风格或参考图已变化，请返回上一步重新生成。</span>
        </div>
        </template>
      </template>

      <template #footer>
        <a-button v-if="!imageGenerationConfigured" @click="imageGenerateOpen = false">
          关闭
        </a-button>
        <template v-else>
          <a-button
            :disabled="imageGenerateSubmitting || imagePromptGenerating"
            @click="imageGenerateOpen = false"
          >
          取消
          </a-button>
          <a-button
            v-if="imageGenerateStep === 2"
            :disabled="imageGenerateSubmitting"
            @click="backToImageSetup"
          >
            上一步
          </a-button>
          <a-button
            type="primary"
            :loading="imageGenerateSubmitting || imagePromptGenerating"
            @click="runImageWizardPrimary"
          >
            {{ imageGenerateStep === 1 ? '下一步 · AI生成三组提示词' : '生成 3 张形象图' }}
          </a-button>
        </template>
      </template>
    </a-modal>

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
      <div class="extract-tip">已从当前剧本提取并补全以下角色，重点包含外观设定、性格与声线，勾选需要导入的角色。</div>
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
/* 角色卡：宽度统一，展示身份、性别和年龄 */
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
.role-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 5px;
  min-height: 32px;
}
.role-meta-text,
.role-meta-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-meta-text {
  font-size: 12px;
  color: var(--text-secondary);
}
.role-meta-sub {
  font-size: 11px;
  color: var(--text-tertiary);
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
.image-action-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
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
.image-preview-trigger {
  width: 100%;
  height: 100%;
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}
.image-preview-trigger:focus-visible {
  outline: 2px solid var(--brand-color);
  outline-offset: -2px;
}
.image-preview-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}
.image-cell:hover .image-preview-mask,
.image-preview-trigger:focus-visible .image-preview-mask {
  opacity: 1;
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
  z-index: 2;
  transition: opacity 0.14s ease;
}
.image-cell:hover .img-del {
  opacity: 1;
}
.image-add {
  min-height: 74px;
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
.image-ai-create {
  border-style: solid;
  border-color: var(--brand-color);
  background: var(--brand-soft);
  color: var(--brand-color);
  font-weight: 600;
}
.section-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.role-image-preview-stage {
  position: relative;
  height: min(70vh, 720px);
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: #080b10;
}
.role-image-preview-stage > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.preview-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.52);
  color: #fff;
  cursor: pointer;
  transform: translateY(-50%);
  transition: background 0.18s ease, border-color 0.18s ease;
}
.preview-nav:hover,
.preview-nav:focus-visible {
  border-color: var(--brand-color);
  background: rgba(0, 0, 0, 0.78);
  outline: none;
}
.preview-nav.previous {
  left: 14px;
}
.preview-nav.next {
  right: 14px;
}
.role-image-preview-hint {
  margin-top: 9px;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}
:global(.role-image-preview-modal .ant-modal-body) {
  padding-top: 8px;
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

/* 角色参考图生成弹窗 */
.image-wizard-steps {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
  padding: 4px 6px;
}
.wizard-step {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-secondary);
}
.wizard-step > span {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.wizard-step div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.wizard-step strong {
  color: var(--text-secondary);
  font-size: 13px;
}
.wizard-step small {
  color: var(--text-tertiary);
  font-size: 11px;
}
.wizard-step.active > span,
.wizard-step.done > span {
  border-color: var(--brand-color);
  background: var(--brand-color);
  color: var(--text-onbrand);
}
.wizard-step.active strong,
.wizard-step.done strong {
  color: var(--brand-color);
}
.wizard-connector {
  height: 1px;
  flex: 1;
  min-width: 36px;
  margin: 0 14px;
  background: var(--border-strong);
  transition: background 0.18s ease;
}
.wizard-connector.done {
  background: var(--brand-color);
}
.image-gen-alert {
  margin-bottom: 14px;
}
.style-template-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-top: 8px;
}
.image-output-plan {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: -4px 0 18px;
}
.output-plan-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
}
.output-plan-item > svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--brand-color);
}
.output-plan-item div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.output-plan-item strong {
  color: var(--text-primary);
  font-size: 12px;
}
.output-plan-item span {
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.4;
}
.prompt-review-tip {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.prompt-review-tip svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--brand-color);
}
.prompt-tabs {
  margin-top: 8px;
}
.prompt-tab-meta {
  margin-bottom: 7px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.reference-option:focus-visible,
.reference-upload:focus-visible {
  outline: 2px solid var(--brand-color);
  outline-offset: 2px;
}
.prompt-generation-state {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  margin-top: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.prompt-generation-state.ready {
  color: var(--brand-color);
}
.prompt-generation-state.stale {
  color: #d97706;
}
.reference-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  max-height: 214px;
  padding: 2px;
  overflow-y: auto;
}
.reference-option {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  cursor: pointer;
  transition: border-color 0.18s ease, opacity 0.18s ease;
}
.reference-option:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.reference-option.active {
  border-color: var(--brand-color);
}
.reference-option img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.reference-option:not(.active) img {
  opacity: 0.72;
}
.reference-option:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
.reference-check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--brand-color);
  color: var(--text-onbrand);
  box-shadow: var(--shadow-sm);
}
.reference-empty {
  padding: 18px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}
.reference-upload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.reference-upload:hover:not(:disabled) {
  border-color: var(--brand-color);
  background: var(--brand-soft);
  color: var(--brand-color);
}
.reference-upload:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
:global(.role-image-generate-modal .ant-modal-body) {
  max-height: calc(100vh - 220px);
  padding-right: 8px;
  overflow-y: auto;
}

/* AI 提取角色弹窗 */
.adjust-tip,
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
