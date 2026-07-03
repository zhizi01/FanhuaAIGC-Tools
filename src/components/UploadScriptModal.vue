<script setup>
// 上传剧本弹窗：选择文件 -> 解析文本 -> 提交模型做合规检测与标准化
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { FileUp, FileText } from 'lucide-vue-next'
import { api } from '../services/bridge.js'
import { appState } from '../store/appState.js'
import { standardizeScript } from '../services/ai.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'complete'])

const models = computed(() => appState.settings.models || [])
const hasModel = computed(() => models.value.length > 0)

const parsing = ref(false)
const submitting = ref(false)
const parsed = ref(null) // { fileName, fileType, rawText }

const form = reactive({
  title: '',
  targetEpisodeCount: 12,
  episodeDurationSeconds: 60,
  modelId: null,
})

function reset() {
  parsed.value = null
  form.title = ''
  form.targetEpisodeCount = 12
  form.episodeDurationSeconds = 60
  const def = models.value.find((m) => m.id === appState.currentModelId) || models.value.find((m) => m.isDefault) || models.value[0]
  form.modelId = def ? def.id : null
}

watch(
  () => props.open,
  (v) => {
    if (v) reset()
  },
)

const rawPreview = computed(() => {
  const t = parsed.value?.rawText || ''
  return t.length > 800 ? t.slice(0, 800) + '\n……（仅预览前 800 字）' : t
})
const charCount = computed(() => (parsed.value?.rawText || '').length)

async function chooseFile() {
  try {
    const file = await api.dialog.selectScriptFile()
    if (!file) return
    parsing.value = true
    const res = await api.scripts.uploadAndParse({ filePath: file.path })
    parsed.value = res
    if (!form.title) {
      form.title = (res.fileName || '').replace(/\.[^.]+$/, '') || '未命名剧本'
    }
    if (!res.rawText || !res.rawText.trim()) {
      message.warning('未从文件中解析到文本内容')
    }
  } catch (err) {
    message.error('解析文件失败：' + err.message)
  } finally {
    parsing.value = false
  }
}

async function submit() {
  if (!parsed.value) return message.warning('请先选择并解析文件')
  if (!form.title.trim()) return message.warning('请填写剧本标题')
  if (!hasModel.value) return message.warning('请先在设置页添加模型')
  submitting.value = true
  try {
    const fullMarkdown = await standardizeScript({
      title: form.title.trim(),
      targetEpisodeCount: form.targetEpisodeCount,
      episodeDurationSeconds: form.episodeDurationSeconds,
      sourceType: 'upload',
      rawText: parsed.value.rawText,
      modelId: form.modelId,
    })
    emit('complete', {
      title: form.title.trim(),
      sourceType: 'upload',
      targetEpisodeCount: form.targetEpisodeCount,
      episodeDurationSeconds: form.episodeDurationSeconds,
      fullMarkdown,
    })
    emit('update:open', false)
  } catch (err) {
    message.error('标准化失败：' + err.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="上传剧本"
    :width="640"
    :confirm-loading="submitting"
    :ok-button-props="{ disabled: !parsed || !hasModel }"
    ok-text="开始标准化"
    cancel-text="取消"
    @ok="submit"
    @update:open="(v) => emit('update:open', v)"
  >
    <a-alert
      v-if="!hasModel"
      type="warning"
      show-icon
      message="尚未配置模型"
      description="上传后需要调用大模型进行合规检测与标准化，请先前往设置页添加模型。"
      class="mb"
    />

    <div class="file-block">
      <a-button :loading="parsing" @click="chooseFile">
        <template #icon><FileUp :size="15" /></template>
        选择文件
      </a-button>
      <span class="file-tip">支持 .txt / .md / .docx / .pdf</span>
    </div>

    <div v-if="parsed" class="parsed-card">
      <div class="parsed-head">
        <FileText :size="16" class="parsed-icon" />
        <span class="parsed-name">{{ parsed.fileName }}</span>
        <span class="parsed-meta">{{ parsed.fileType }} · {{ charCount }} 字</span>
      </div>
      <pre class="parsed-preview">{{ rawPreview }}</pre>
    </div>

    <a-form v-if="parsed" layout="vertical" class="mt">
      <a-form-item label="剧本标题" required>
        <a-input v-model:value="form.title" placeholder="默认使用文件名" />
      </a-form-item>
      <div class="form-row">
        <a-form-item label="目标集数" class="form-col">
          <a-input-number v-model:value="form.targetEpisodeCount" :min="1" :max="999" style="width: 100%" />
        </a-form-item>
        <a-form-item label="每集秒数" class="form-col">
          <a-input-number v-model:value="form.episodeDurationSeconds" :min="5" :max="600" :step="5" style="width: 100%" />
        </a-form-item>
      </div>
      <a-form-item label="使用模型">
        <a-select
          v-model:value="form.modelId"
          :options="models.map((m) => ({ value: m.id, label: m.displayName }))"
          placeholder="选择模型"
        />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.mt {
  margin-top: 16px;
}
.file-block {
  display: flex;
  align-items: center;
  gap: 12px;
}
.file-tip {
  font-size: 12px;
  color: var(--text-tertiary);
}
.parsed-card {
  margin-top: 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.parsed-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-hover);
}
.parsed-icon {
  color: var(--brand-color);
}
.parsed-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.parsed-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
}
.parsed-preview {
  margin: 0;
  padding: 12px 14px;
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Consolas', 'Menlo', monospace;
}
.form-row {
  display: flex;
  gap: 16px;
}
.form-col {
  flex: 1;
}
</style>
