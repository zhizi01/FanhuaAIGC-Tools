<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import { ArrowLeft, Plus, Pencil, Trash2, Star, Palette, Cpu, ImagePlus, KeyRound, Cloud } from 'lucide-vue-next'
import { useAppStore } from '../store/appState.js'
import { api } from '../services/bridge.js'
import { genLocalId } from '../utils/id.js'

const router = useRouter()
const appStore = useAppStore()

// 返回来源页：从工程内进入则回到工程，从起始页进入则回到起始页
function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

const PRESET_COLORS = ['#1ec9b0', '#13c2c2', '#1677ff', '#722ed1', '#52c41a', '#fa8c16', '#eb2f96']
const MAX_CONTEXT = 1000000

// 常见上下文大小档位（最后追加「自定义」）
const CONTEXT_OPTIONS = [
  { label: '4K (4096)', value: 4096 },
  { label: '8K (8192)', value: 8192 },
  { label: '16K (16384)', value: 16384 },
  { label: '32K (32768)', value: 32768 },
  { label: '64K (65536)', value: 65536 },
  { label: '128K (131072)', value: 131072 },
  { label: '200K (200000)', value: 200000 },
  { label: '256K (262144)', value: 262144 },
  { label: '512K (524288)', value: 524288 },
  { label: '1M (1000000)', value: 1000000 },
]
const contextSelectOptions = computed(() => [...CONTEXT_OPTIONS, { label: '自定义', value: 'custom' }])
const contextPreset = ref(131072)

function syncContextPreset() {
  contextPreset.value = CONTEXT_OPTIONS.some((o) => o.value === modelForm.contextSize)
    ? modelForm.contextSize
    : 'custom'
}

function onContextPresetChange(v) {
  contextPreset.value = v
  if (v !== 'custom') modelForm.contextSize = v
}

const appearance = computed(() => appStore.settings.appearance)
const models = computed(() => appStore.settings.models)
const imageApiKey = ref(appStore.settings.imageGeneration?.apiKey || '')
const savingImageApiKey = ref(false)
const imageApiKeyDirty = computed(
  () => imageApiKey.value.trim() !== String(appStore.settings.imageGeneration?.apiKey || ''),
)

async function updateAppearance(patch) {
  await appStore.saveSettings({
    ...appStore.settings,
    appearance: { ...appStore.settings.appearance, ...patch },
  })
}

async function saveImageGenerationSettings() {
  savingImageApiKey.value = true
  try {
    await appStore.saveSettings({
      ...appStore.settings,
      imageGeneration: {
        ...(appStore.settings.imageGeneration || {}),
        apiKey: imageApiKey.value.trim(),
      },
    })
    message.success('图片生成模型配置已保存')
  } catch (err) {
    message.error('保存失败：' + err.message)
  } finally {
    savingImageApiKey.value = false
  }
}

// 腾讯云 COS：图片云存，供视频模型通过公网链接读取
const savedCos = appStore.settings.cos || {}
const cosForm = reactive({
  secretId: savedCos.secretId || '',
  secretKey: savedCos.secretKey || '',
  bucket: savedCos.bucket || '',
  region: savedCos.region || '',
})
const savingCos = ref(false)
const testingCos = ref(false)

const cosDirty = computed(() => {
  const saved = appStore.settings.cos || {}
  return (
    cosForm.secretId.trim() !== String(saved.secretId || '') ||
    cosForm.secretKey.trim() !== String(saved.secretKey || '') ||
    cosForm.bucket.trim() !== String(saved.bucket || '') ||
    cosForm.region.trim() !== String(saved.region || '')
  )
})

function ensureCosRequired() {
  if (
    !cosForm.secretId.trim() ||
    !cosForm.secretKey.trim() ||
    !cosForm.bucket.trim() ||
    !cosForm.region.trim()
  ) {
    message.warning('请填写完整的 SecretId、SecretKey、存储桶与地域')
    return false
  }
  return true
}

async function saveCosSettings() {
  if (!ensureCosRequired()) return
  savingCos.value = true
  try {
    await appStore.saveSettings({
      ...appStore.settings,
      cos: {
        secretId: cosForm.secretId.trim(),
        secretKey: cosForm.secretKey.trim(),
        bucket: cosForm.bucket.trim(),
        region: cosForm.region.trim(),
      },
    })
    message.success('COS 配置已保存')
  } catch (err) {
    message.error('保存失败：' + err.message)
  } finally {
    savingCos.value = false
  }
}

async function testCosConnection() {
  if (!ensureCosRequired()) return
  if (cosDirty.value) {
    message.warning('请先保存配置再测试连接')
    return
  }
  testingCos.value = true
  try {
    await api.cos.test()
    message.success('COS 连接正常')
  } catch (err) {
    message.error('连接失败：' + err.message)
  } finally {
    testingCos.value = false
  }
}

// 模型编辑弹窗
const modelModalOpen = ref(false)
const editingId = ref(null)
const modelForm = reactive({
  displayName: '',
  baseUrl: '',
  apiKey: '',
  modelCode: '',
  contextSize: 128000,
  isDefault: false,
})

function resetModelForm() {
  modelForm.displayName = ''
  modelForm.baseUrl = 'https://api.openai.com/v1'
  modelForm.apiKey = ''
  modelForm.modelCode = ''
  modelForm.contextSize = 131072
  modelForm.isDefault = models.value.length === 0
}

function openAddModel() {
  editingId.value = null
  resetModelForm()
  syncContextPreset()
  modelModalOpen.value = true
}

function openEditModel(m) {
  editingId.value = m.id
  modelForm.displayName = m.displayName
  modelForm.baseUrl = m.baseUrl
  modelForm.apiKey = m.apiKey
  modelForm.modelCode = m.modelCode
  modelForm.contextSize = m.contextSize
  modelForm.isDefault = m.isDefault
  syncContextPreset()
  modelModalOpen.value = true
}

async function submitModel() {
  if (!modelForm.displayName.trim()) return message.warning('请填写模型名')
  if (!modelForm.baseUrl.trim()) return message.warning('请填写服务地址')
  if (!modelForm.modelCode.trim()) return message.warning('请填写模型代码')
  const size = Math.min(Number(modelForm.contextSize) || 0, MAX_CONTEXT)
  if (size < 1000) return message.warning('请选择或填写有效的上下文大小')

  const now = new Date().toISOString()
  let list = [...models.value]

  if (editingId.value) {
    list = list.map((m) =>
      m.id === editingId.value
        ? { ...m, ...toModelData(size), updatedAt: now }
        : m,
    )
  } else {
    list.push({ id: genLocalId('model'), ...toModelData(size), createdAt: now, updatedAt: now })
  }

  // 处理默认模型唯一性
  list = normalizeDefault(list, modelForm.isDefault ? (editingId.value || list[list.length - 1].id) : null)

  await appStore.saveSettings({ ...appStore.settings, models: list })
  message.success('已保存模型配置')
  modelModalOpen.value = false
}

function toModelData(size) {
  return {
    displayName: modelForm.displayName.trim(),
    baseUrl: modelForm.baseUrl.trim(),
    apiKey: modelForm.apiKey.trim(),
    modelCode: modelForm.modelCode.trim(),
    contextSize: size,
    isDefault: modelForm.isDefault,
  }
}

// 保证只有一个默认模型；若指定 forceId 则以它为默认
function normalizeDefault(list, forceId) {
  let defaultId = forceId
  if (!defaultId) {
    const existed = list.find((m) => m.isDefault)
    defaultId = existed ? existed.id : list[0]?.id
  }
  return list.map((m) => ({ ...m, isDefault: m.id === defaultId }))
}

async function setDefault(m) {
  const list = normalizeDefault(models.value, m.id)
  await appStore.saveSettings({ ...appStore.settings, models: list })
}

function removeModel(m) {
  Modal.confirm({
    title: '删除模型配置',
    content: `确定删除「${m.displayName}」吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      let list = models.value.filter((x) => x.id !== m.id)
      if (list.length && !list.find((x) => x.isDefault)) list = normalizeDefault(list, list[0].id)
      await appStore.saveSettings({ ...appStore.settings, models: list })
      message.success('已删除')
    },
  })
}

function formatContext(size) {
  if (size >= 1000000) return `${(size / 1000000).toFixed(size % 1000000 ? 1 : 0)}M`
  if (size >= 1000) return `${Math.round(size / 1000)}K`
  return String(size)
}
</script>

<template>
  <div class="settings-view">
    <header class="settings-header">
      <a-button type="text" class="back-btn" @click="goBack">
        <template #icon><ArrowLeft :size="18" /></template>
        返回
      </a-button>
      <h2>设置</h2>
    </header>

    <div class="settings-body">
      <!-- 外观设置 -->
      <section class="settings-card">
        <div class="card-title"><Palette :size="18" /> 外观设置</div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">主题模式</div>
            <div class="label-desc">切换软件整体明暗风格</div>
          </div>
          <a-segmented
            :value="appearance.themeMode"
            :options="[
              { label: '浅色', value: 'light' },
              { label: '深色', value: 'dark' },
              { label: '跟随系统', value: 'system' },
            ]"
            @change="(v) => updateAppearance({ themeMode: v })"
          />
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">主色</div>
            <div class="label-desc">用于按钮、高亮等主要元素</div>
          </div>
          <div class="color-swatches">
            <button
              v-for="c in PRESET_COLORS"
              :key="c"
              class="swatch"
              :class="{ active: appearance.primaryColor === c }"
              :style="{ background: c }"
              @click="updateAppearance({ primaryColor: c })"
            />
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">界面密度</div>
            <div class="label-desc">调整控件与间距的紧凑程度</div>
          </div>
          <a-segmented
            :value="appearance.density"
            :options="[
              { label: '舒适', value: 'comfortable' },
              { label: '紧凑', value: 'compact' },
            ]"
            @change="(v) => updateAppearance({ density: v })"
          />
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">背景纹理</div>
            <div class="label-desc">为工作区背景增加网格、点阵或光晕质感</div>
          </div>
          <a-segmented
            :value="appearance.background || 'grid'"
            :options="[
              { label: '无', value: 'none' },
              { label: '网格', value: 'grid' },
              { label: '点阵', value: 'dots' },
              { label: '光晕', value: 'glow' },
            ]"
            @change="(v) => updateAppearance({ background: v })"
          />
        </div>
      </section>

      <!-- 模型设置 -->
      <section class="settings-card">
        <div class="card-title">
          <Cpu :size="18" /> 模型设置
          <a-button type="primary" size="small" class="add-model-btn" @click="openAddModel">
            <template #icon><Plus :size="14" /></template>
            添加模型
          </a-button>
        </div>

        <div v-if="models.length" class="model-list">
          <div v-for="m in models" :key="m.id" class="model-item">
            <div class="model-main">
              <div class="model-name-row">
                <span class="model-name">{{ m.displayName }}</span>
                <a-tag v-if="m.isDefault" color="cyan">默认</a-tag>
              </div>
              <div class="model-detail">
                <span class="model-code">{{ m.modelCode }}</span>
                <span class="dot">·</span>
                <span class="model-url">{{ m.baseUrl }}</span>
                <span class="dot">·</span>
                <span>上下文 {{ formatContext(m.contextSize) }}</span>
              </div>
            </div>
            <div class="model-actions">
              <a-button
                v-if="!m.isDefault"
                type="text"
                size="small"
                title="设为默认"
                @click="setDefault(m)"
              >
                <Star :size="15" />
              </a-button>
              <a-button type="text" size="small" title="编辑" @click="openEditModel(m)">
                <Pencil :size="15" />
              </a-button>
              <a-button type="text" size="small" danger title="删除" @click="removeModel(m)">
                <Trash2 :size="15" />
              </a-button>
            </div>
          </div>
        </div>

        <a-empty v-else description="还没有模型配置，点击「添加模型」创建" />
      </section>

      <!-- 固定图片生成模型 -->
      <section class="settings-card">
        <div class="card-title">
          <ImagePlus :size="18" /> 图片生成模型
          <a-tag color="cyan">固定模型</a-tag>
        </div>

        <div class="image-model-summary">
          <div>
            <span>模型</span>
            <strong>doubao-seedream-5-0-260128</strong>
          </div>
          <div>
            <span>输出规格</span>
            <strong>2K · 无水印 · 单图</strong>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title"><KeyRound :size="14" /> ARK API Key</div>
            <div class="label-desc">保存在本机设置中；留空时会尝试读取启动环境中的 ARK_API_KEY。</div>
          </div>
          <div class="image-key-control">
            <a-input-password
              v-model:value="imageApiKey"
              placeholder="填写火山方舟 API Key"
              @press-enter="saveImageGenerationSettings"
            />
            <a-button
              type="primary"
              :loading="savingImageApiKey"
              :disabled="!imageApiKeyDirty"
              @click="saveImageGenerationSettings"
            >
              保存
            </a-button>
          </div>
        </div>
      </section>

      <!-- 腾讯云 COS 对象存储 -->
      <section class="settings-card">
        <div class="card-title"><Cloud :size="18" /> 腾讯云 COS 对象存储</div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">SecretId</div>
            <div class="label-desc">腾讯云 API 密钥标识</div>
          </div>
          <a-input-password
            v-model:value="cosForm.secretId"
            class="cos-form-control"
            placeholder="AKIDxxxxxxxx"
          />
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">SecretKey</div>
            <div class="label-desc">腾讯云 API 密钥，请妥善保管</div>
          </div>
          <a-input-password
            v-model:value="cosForm.secretKey"
            class="cos-form-control"
            placeholder="填写腾讯云 SecretKey"
          />
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">存储桶名称 Bucket</div>
            <div class="label-desc">格式为名称-APPID，可在 COS 控制台查看</div>
          </div>
          <a-input
            v-model:value="cosForm.bucket"
            class="cos-form-control"
            placeholder="examplebucket-1250000000"
          />
        </div>

        <div class="setting-row">
          <div class="setting-label">
            <div class="label-title">所属地域 Region</div>
            <div class="label-desc">存储桶所在地域，可在 COS 控制台查看</div>
          </div>
          <a-input
            v-model:value="cosForm.region"
            class="cos-form-control"
            placeholder="ap-guangzhou"
          />
        </div>

        <div class="cos-actions">
          <a-button
            type="primary"
            :loading="savingCos"
            :disabled="!cosDirty"
            @click="saveCosSettings"
          >
            保存配置
          </a-button>
          <a-button :loading="testingCos" @click="testCosConnection">
            测试连接
          </a-button>
        </div>
      </section>
    </div>

    <a-modal
      v-model:open="modelModalOpen"
      :title="editingId ? '编辑模型' : '添加模型'"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitModel"
    >
      <a-form layout="vertical">
        <a-form-item label="模型名" required>
          <a-input v-model:value="modelForm.displayName" placeholder="展示用名称，例如 GPT-5 编剧模型" />
        </a-form-item>
        <a-form-item label="服务地址" required>
          <a-input v-model:value="modelForm.baseUrl" placeholder="https://api.openai.com/v1" />
        </a-form-item>
        <a-form-item label="APIKEY">
          <a-input-password v-model:value="modelForm.apiKey" placeholder="sk-xxx" />
        </a-form-item>
        <a-form-item label="模型代码" required>
          <a-input v-model:value="modelForm.modelCode" placeholder="请求时携带的 model 字段，例如 gpt-5" />
        </a-form-item>
        <a-form-item label="上下文大小（tokens）">
          <a-select
            :value="contextPreset"
            :options="contextSelectOptions"
            @change="onContextPresetChange"
          />
          <a-input-number
            v-if="contextPreset === 'custom'"
            v-model:value="modelForm.contextSize"
            :min="1000"
            :max="MAX_CONTEXT"
            :step="1000"
            style="width: 100%; margin-top: 8px"
            placeholder="输入自定义上下文大小（最高 1M）"
          />
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="modelForm.isDefault">设为默认模型</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
}
.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.settings-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text-primary);
}
.back-btn {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}

.settings-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  box-shadow: var(--shadow-sm);
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.add-model-btn {
  margin-left: auto;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--border-color);
}
.setting-row:first-of-type {
  border-top: none;
}
.label-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text-primary);
}
.label-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.color-swatches {
  display: flex;
  gap: 10px;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  outline: none;
  transition: transform 0.1s ease;
}
.swatch:hover {
  transform: scale(1.1);
}
.swatch.active {
  border-color: var(--text-primary);
  box-shadow: 0 0 0 2px var(--bg-panel) inset;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.model-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.model-item:hover {
  border-color: var(--brand-color);
  box-shadow: var(--shadow-sm);
}
.model-main {
  flex: 1;
  min-width: 0;
}
.model-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.model-detail {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.model-code {
  color: var(--text-secondary);
}
.dot {
  color: var(--border-strong);
}
.model-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.image-model-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 4px;
}
.image-model-summary > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}
.image-model-summary span {
  font-size: 11px;
  color: var(--text-tertiary);
}
.image-model-summary strong {
  overflow: hidden;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-key-control {
  width: min(430px, 56%);
  display: flex;
  gap: 8px;
}
.image-key-control :deep(.ant-input-affix-wrapper) {
  flex: 1;
}

.cos-form-control {
  width: min(430px, 56%);
}
.cos-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}
</style>
