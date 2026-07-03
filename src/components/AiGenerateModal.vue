<script setup>
// AI生成弹窗：填写创作参数 -> 调用模型生成整套分集剧本 Markdown
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { appState } from '../store/appState.js'
import { generateScript } from '../services/ai.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'complete'])

const models = computed(() => appState.settings.models || [])
const hasModel = computed(() => models.value.length > 0)

const GENRES = ['都市', '玄幻', '悬疑', '校园', '古风', '科幻', '言情', '热血']

const submitting = ref(false)
const form = reactive({
  title: '',
  genre: '都市',
  idea: '',
  characters: '',
  worldview: '',
  targetEpisodeCount: 12,
  episodeDurationSeconds: 60,
  style: '',
  modelId: null,
})

function reset() {
  form.title = ''
  form.genre = '都市'
  form.idea = ''
  form.characters = ''
  form.worldview = ''
  form.targetEpisodeCount = 12
  form.episodeDurationSeconds = 60
  form.style = ''
  const def = models.value.find((m) => m.id === appState.currentModelId) || models.value.find((m) => m.isDefault) || models.value[0]
  form.modelId = def ? def.id : null
}

watch(
  () => props.open,
  (v) => {
    if (v) reset()
  },
)

async function submit() {
  if (!form.title.trim()) return message.warning('请填写剧本标题')
  if (!form.idea.trim()) return message.warning('请填写一句话创意')
  if (!hasModel.value) return message.warning('请先在设置页添加模型')
  submitting.value = true
  try {
    const fullMarkdown = await generateScript({
      title: form.title.trim(),
      genre: form.genre,
      idea: form.idea.trim(),
      characters: form.characters.trim(),
      worldview: form.worldview.trim(),
      targetEpisodeCount: form.targetEpisodeCount,
      episodeDurationSeconds: form.episodeDurationSeconds,
      style: form.style.trim(),
      modelId: form.modelId,
    })
    emit('complete', {
      title: form.title.trim(),
      sourceType: 'ai',
      targetEpisodeCount: form.targetEpisodeCount,
      episodeDurationSeconds: form.episodeDurationSeconds,
      fullMarkdown,
    })
    emit('update:open', false)
  } catch (err) {
    message.error('生成失败：' + err.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="AI生成剧本"
    :width="640"
    :confirm-loading="submitting"
    :ok-button-props="{ disabled: !hasModel }"
    ok-text="开始生成"
    cancel-text="取消"
    @ok="submit"
    @update:open="(v) => emit('update:open', v)"
  >
    <a-alert
      v-if="!hasModel"
      type="warning"
      show-icon
      message="尚未配置模型"
      description="AI生成需要调用大模型，请先前往设置页添加模型。"
      class="mb"
    />

    <a-form layout="vertical">
      <a-form-item label="剧本标题" required>
        <a-input v-model:value="form.title" placeholder="例如：都市异闻录" />
      </a-form-item>
      <div class="form-row">
        <a-form-item label="类型题材" class="form-col">
          <a-select
            v-model:value="form.genre"
            :options="GENRES.map((g) => ({ value: g, label: g }))"
          />
        </a-form-item>
        <a-form-item label="使用模型" class="form-col">
          <a-select
            v-model:value="form.modelId"
            :options="models.map((m) => ({ value: m.id, label: m.displayName }))"
            placeholder="选择模型"
          />
        </a-form-item>
      </div>
      <a-form-item label="一句话创意" required>
        <a-textarea v-model:value="form.idea" :rows="2" placeholder="用一句话描述这部作品的核心创意" />
      </a-form-item>
      <a-form-item label="主要角色（可选）">
        <a-textarea v-model:value="form.characters" :rows="2" placeholder="例如：林岸（男主，落魄程序员）、苏晚（女主，神秘投资人）" />
      </a-form-item>
      <a-form-item label="世界观设定（可选）">
        <a-textarea v-model:value="form.worldview" :rows="2" placeholder="故事发生的时代、地点与规则设定" />
      </a-form-item>
      <div class="form-row">
        <a-form-item label="目标集数" class="form-col">
          <a-input-number v-model:value="form.targetEpisodeCount" :min="1" :max="999" style="width: 100%" />
        </a-form-item>
        <a-form-item label="每集秒数" class="form-col">
          <a-input-number v-model:value="form.episodeDurationSeconds" :min="5" :max="600" :step="5" style="width: 100%" />
        </a-form-item>
      </div>
      <a-form-item label="风格要求（可选）">
        <a-input v-model:value="form.style" placeholder="例如：快节奏、强反转、轻喜剧" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.form-row {
  display: flex;
  gap: 16px;
}
.form-col {
  flex: 1;
}
</style>
