<script setup>
// 上传剧本：独立面板视图。选择文件 -> 解析文本 -> 调用模型做合规检测与标准化
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { ArrowLeft, FileUp, FileText, Upload } from 'lucide-vue-next'
import { api } from '../../services/bridge.js'
import { appState } from '../../store/appState.js'
import { standardizeScript } from '../../services/ai.js'

const emit = defineEmits(['back', 'complete'])

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

onMounted(() => {
  const def =
    models.value.find((m) => m.id === appState.currentModelId) ||
    models.value.find((m) => m.isDefault) ||
    models.value[0]
  form.modelId = def ? def.id : null
})

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
  } catch (err) {
    message.error('标准化失败：' + err.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="script-panel">
    <header class="panel-head">
      <button class="back-btn" @click="emit('back')">
        <ArrowLeft :size="18" />
      </button>
      <div class="panel-head-icon"><Upload :size="18" /></div>
      <div class="panel-head-text">
        <div class="panel-title">上传剧本</div>
        <div class="panel-sub">导入外部文档，交由模型进行合规检测与分集标准化</div>
      </div>
    </header>

    <div class="panel-body">
      <div class="panel-inner">
        <a-alert
          v-if="!hasModel"
          type="warning"
          show-icon
          message="尚未配置模型"
          description="标准化需要调用大模型进行合规检测，请先前往设置页添加模型。"
          class="mb"
        />

        <div class="drop-zone" :class="{ filled: parsed }" @click="chooseFile">
          <a-spin :spinning="parsing">
            <div class="drop-inner">
              <div class="drop-icon"><FileUp :size="26" /></div>
              <div class="drop-title">{{ parsed ? '重新选择文件' : '点击选择剧本文件' }}</div>
              <div class="drop-tip">支持 .txt / .md / .docx / .pdf</div>
            </div>
          </a-spin>
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
            <a-input v-model:value="form.title" placeholder="默认使用文件名" allow-clear />
          </a-form-item>
          <div class="form-row">
            <a-form-item label="目标集数" class="form-col">
              <a-input-number v-model:value="form.targetEpisodeCount" :min="1" :max="999" style="width: 100%" />
            </a-form-item>
            <a-form-item label="每集秒数" class="form-col">
              <a-input-number
                v-model:value="form.episodeDurationSeconds"
                :min="5"
                :max="600"
                :step="5"
                style="width: 100%"
              />
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
      </div>
    </div>

    <footer class="panel-foot">
      <a-button @click="emit('back')">返回剧本库</a-button>
      <a-button
        type="primary"
        :loading="submitting"
        :disabled="!parsed || !hasModel"
        @click="submit"
      >
        <template #icon><Upload :size="15" /></template>
        开始标准化
      </a-button>
    </footer>
  </div>
</template>

<style scoped>
.script-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.panel-head {
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-color);
}
.back-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.16s ease;
}
.back-btn:hover {
  color: var(--brand-color);
  border-color: var(--brand-color);
}
.panel-head-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-onbrand);
  background: var(--gradient-brand);
}
.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.panel-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.panel-inner {
  max-width: 680px;
  margin: 0 auto;
  padding: 28px 28px 40px;
}
.mb {
  margin-bottom: 18px;
}
.mt {
  margin-top: 20px;
}

.drop-zone {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  cursor: pointer;
  transition: all 0.18s ease;
}
.drop-zone:hover {
  border-color: var(--brand-color);
  background: var(--brand-soft);
}
.drop-zone.filled {
  border-style: solid;
}
.drop-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 34px 20px;
  text-align: center;
}
.drop-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-color);
  background: var(--bg-active);
  margin-bottom: 4px;
}
.drop-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.drop-tip {
  font-size: 12px;
  color: var(--text-tertiary);
}

.parsed-card {
  margin-top: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-panel);
}
.parsed-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  background: var(--bg-sunken);
  border-bottom: 1px solid var(--border-color);
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
  padding: 14px;
  max-height: 180px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.75;
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

.panel-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-color);
}
</style>
