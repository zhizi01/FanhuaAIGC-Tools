<script setup>
// AI生成剧本：独立面板视图。填写创作参数 -> 调用模型生成整套分集剧本 Markdown
import { computed, onMounted, reactive } from 'vue'
import { message } from 'ant-design-vue'
import { ArrowLeft, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '../../store/appState.js'
import { useAiTaskStore } from '../../store/aiTasks.js'

const emit = defineEmits(['back'])

const appStore = useAppStore()
const aiTask = useAiTaskStore()

const models = computed(() => appStore.settings.models || [])
const hasModel = computed(() => models.value.length > 0)

const GENRES = ['都市', '玄幻', '悬疑', '校园', '古风', '科幻', '言情', '热血']

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

onMounted(() => {
  const def =
    models.value.find((m) => m.id === appStore.currentModelId) ||
    models.value.find((m) => m.isDefault) ||
    models.value[0]
  form.modelId = def ? def.id : null
})

function submit() {
  if (!form.title.trim()) return message.warning('请填写剧本标题')
  if (!form.idea.trim()) return message.warning('请填写一句话创意')
  if (!hasModel.value) return message.warning('请先在设置页添加模型')
  const res = aiTask.start({
    kind: 'ai',
    title: form.title.trim(),
    params: {
      title: form.title.trim(),
      genre: form.genre,
      idea: form.idea.trim(),
      characters: form.characters.trim(),
      worldview: form.worldview.trim(),
      targetEpisodeCount: form.targetEpisodeCount,
      episodeDurationSeconds: form.episodeDurationSeconds,
      style: form.style.trim(),
      modelId: form.modelId,
    },
  })
  if (!res.ok) return message.warning(res.reason)
  message.success('已开始AI生成，可切换到其他界面，完成后会自动放入剧本库')
  emit('back')
}
</script>

<template>
  <div class="script-panel">
    <header class="panel-head">
      <button class="back-btn" @click="emit('back')">
        <ArrowLeft :size="18" />
      </button>
      <div class="panel-head-icon"><Sparkles :size="18" /></div>
      <div class="panel-head-text">
        <div class="panel-title">AI生成剧本</div>
        <div class="panel-sub">输入创意与设定，由模型生成整套可拍摄的分集剧本</div>
      </div>
    </header>

    <div class="panel-body">
      <div class="panel-inner">
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
            <a-input v-model:value="form.title" placeholder="例如：都市异闻录" allow-clear />
          </a-form-item>
          <div class="form-row">
            <a-form-item label="类型题材" class="form-col">
              <a-select v-model:value="form.genre" :options="GENRES.map((g) => ({ value: g, label: g }))" />
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
            <a-textarea
              v-model:value="form.characters"
              :rows="2"
              placeholder="例如：林岸（男主，落魄程序员）、苏晚（女主，神秘投资人）"
            />
          </a-form-item>
          <a-form-item label="世界观设定（可选）">
            <a-textarea v-model:value="form.worldview" :rows="2" placeholder="故事发生的时代、地点与规则设定" />
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
          <a-form-item label="风格要求（可选）">
            <a-input v-model:value="form.style" placeholder="例如：快节奏、强反转、轻喜剧" allow-clear />
          </a-form-item>
        </a-form>
      </div>
    </div>

    <footer class="panel-foot">
      <a-button @click="emit('back')">返回剧本库</a-button>
      <a-button type="primary" :disabled="!hasModel || aiTask.active" @click="submit">
        <template #icon><Sparkles :size="15" /></template>
        {{ aiTask.active ? '任务进行中…' : '开始生成' }}
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
