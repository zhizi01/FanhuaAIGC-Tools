<script setup>
// 剧本库：当前作品的分集剧本工作区
// 左侧分集目录 + 中间工作区（预览 / 源码 / AI优化）。
// 「上传剧本」「AI生成」为剧本页内的独立面板视图（独立 VUE 文件）。
import { computed, onMounted, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  Upload,
  Sparkles,
  Save,
  Plus,
  Trash2,
  Eye,
  Code,
  Wand2,
  FileText,
  ScrollText,
  ListTree,
} from 'lucide-vue-next'
import { appState } from '../../store/appState.js'
import { api } from '../../services/bridge.js'
import { genLocalId } from '../../utils/id.js'
import { renderMarkdown, splitScriptMarkdown, parseCompliance, extractTitle, stripCodeFence } from '../../utils/markdown.js'
import { optimizeEpisode } from '../../services/ai.js'
import ScriptUpload from './ScriptUpload.vue'
import ScriptGenerate from './ScriptGenerate.vue'

const project = computed(() => appState.currentProject)

const view = ref('library') // library | upload | generate

const scripts = ref([]) // 索引列表
const current = ref(null) // { meta, overview, episodes }
const activeScriptId = ref(null)
const activeEpisodeNo = ref(null) // null = 总览
const mode = ref('preview') // preview | source | ai
const dirty = ref(false)

const loading = ref(false)
const saving = ref(false)

const aiInstruction = ref('')
const aiRunning = ref(false)

const OVERVIEW_TEMPLATE = `# 未命名剧本

## 基础信息

- 来源类型：手动创建
- 目标集数：0
- 每集秒数：60
- 语言：zh-CN

## 故事总览

### 一句话简介

（在这里填写一句话简介）

### 完整梗概

（在这里填写完整梗概）

## 主要角色

### 角色：角色名

- 定位：主角
- 描述：角色描述
- 动机：角色动机

## 整理说明

- （补充说明）`

function episodeTemplate(no) {
  return `## 第${no}集：新集标题

- 时长：60秒
- 本集梗概：
- 开场钩子：
- 结尾悬念：

### 场景1：场景地点 / 时间

- 时长：15秒
- 画面提示：
- 角色动作：
- 旁白：

**角色名（情绪）：** 对白内容`
}

const episodes = computed(() => current.value?.episodes || [])
const activeEpisode = computed(
  () => episodes.value.find((e) => e.episodeNo === activeEpisodeNo.value) || null,
)
const isOverview = computed(() => activeEpisodeNo.value === null)

// 当前编辑内容：总览或某一集
const activeContent = computed({
  get() {
    if (!current.value) return ''
    if (isOverview.value) return current.value.overview || ''
    return activeEpisode.value?.content || ''
  },
  set(val) {
    if (!current.value) return
    if (isOverview.value) {
      current.value.overview = val
    } else if (activeEpisode.value) {
      activeEpisode.value.content = val
    }
    dirty.value = true
  },
})

const renderedHtml = computed(() => renderMarkdown(activeContent.value))

// ---------- 加载 ----------
async function loadScripts(preferId) {
  if (!project.value?.path) return
  loading.value = true
  try {
    scripts.value = await api.scripts.list(project.value.path)
    if (scripts.value.length) {
      const wantId =
        preferId ||
        (scripts.value.find((s) => s.id === activeScriptId.value) ? activeScriptId.value : scripts.value[0].id)
      await loadScript(wantId)
    } else {
      current.value = null
      activeScriptId.value = null
    }
  } catch (err) {
    message.error('加载剧本失败：' + err.message)
  } finally {
    loading.value = false
  }
}

async function loadScript(id) {
  const data = await api.scripts.read({ projectPath: project.value.path, scriptId: id })
  current.value = data
  activeScriptId.value = id
  activeEpisodeNo.value = null
  mode.value = 'preview'
  dirty.value = false
}

// ---------- 目录切换 ----------
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

function selectOverview() {
  activeEpisodeNo.value = null
  if (mode.value === 'ai') mode.value = 'preview'
}

function selectEpisode(no) {
  activeEpisodeNo.value = no
  aiInstruction.value = ''
}

// ---------- 新建 / 增删 ----------
// 单剧本约束：一个工程仅允许存在一个剧本
function newScript() {
  if (current.value) return message.warning('一个工程仅允许一个剧本，如需重建请先删除当前剧本')
  guardDirty(() => {
    const now = new Date().toISOString()
    current.value = {
      meta: {
        id: genLocalId('script'),
        title: '未命名剧本',
        sourceType: 'manual',
        status: '草稿',
        episodeCount: 0,
        episodeDurationSeconds: 60,
        complianceResult: '',
        riskLevel: '',
        createdAt: now,
        episodes: [],
      },
      overview: OVERVIEW_TEMPLATE,
      episodes: [],
    }
    activeScriptId.value = current.value.meta.id
    activeEpisodeNo.value = null
    mode.value = 'source'
    dirty.value = true
  })
}

function addEpisode() {
  if (!current.value) return newScript()
  const nextNo = episodes.value.reduce((max, e) => Math.max(max, e.episodeNo), 0) + 1
  current.value.episodes.push({
    episodeNo: nextNo,
    title: `第${nextNo}集`,
    content: episodeTemplate(nextNo),
  })
  activeEpisodeNo.value = nextNo
  mode.value = 'source'
  dirty.value = true
}

function removeEpisode(no) {
  Modal.confirm({
    title: '删除该集',
    content: `确定删除第${no}集吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk() {
      current.value.episodes = current.value.episodes.filter((e) => e.episodeNo !== no)
      if (activeEpisodeNo.value === no) {
        activeEpisodeNo.value = null
        if (mode.value === 'ai') mode.value = 'preview'
      }
      dirty.value = true
    },
  })
}

function removeScript() {
  if (!current.value) return
  const id = activeScriptId.value
  const title = current.value.meta.title
  Modal.confirm({
    title: '删除剧本',
    content: `确定删除「${title}」吗？该操作会删除本地剧本文件。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        // 仅当已落盘（存在于索引）时才调用删除
        if (scripts.value.find((s) => s.id === id)) {
          await api.scripts.remove({ projectPath: project.value.path, scriptId: id })
        }
        dirty.value = false
        activeScriptId.value = null
        await loadScripts()
        message.success('已删除')
      } catch (err) {
        message.error('删除失败：' + err.message)
      }
    },
  })
}

// ---------- 保存 ----------
function toSavePayload() {
  const c = current.value
  return {
    id: c.meta.id,
    title: c.meta.title,
    sourceType: c.meta.sourceType,
    status: c.meta.status,
    episodeDurationSeconds: c.meta.episodeDurationSeconds,
    complianceResult: c.meta.complianceResult,
    riskLevel: c.meta.riskLevel,
    createdAt: c.meta.createdAt,
    overview: c.overview,
    episodes: c.episodes.map((e) => ({
      episodeNo: e.episodeNo,
      title: e.title,
      content: e.content,
    })),
  }
}

async function save() {
  if (!current.value || !project.value?.path) return
  if (!current.value.meta.title.trim()) return message.warning('请填写剧本标题')
  saving.value = true
  const keepEp = activeEpisodeNo.value
  try {
    const meta = await api.scripts.save({ projectPath: project.value.path, script: toSavePayload() })
    await loadScripts(meta.id)
    if (keepEp != null && current.value?.episodes.find((e) => e.episodeNo === keepEp)) {
      activeEpisodeNo.value = keepEp
    }
    dirty.value = false
    message.success('已保存')
  } catch (err) {
    message.error('保存失败：' + err.message)
  } finally {
    saving.value = false
  }
}

// ---------- 上传 / AI生成 面板完成回调：整体放入「总览」 ----------
async function onPanelComplete(payload) {
  if (!project.value?.path) return
  const md = stripCodeFence(payload.fullMarkdown || '')
  const compliance = parseCompliance(md)
  const script = {
    title: payload.title || extractTitle(md, '未命名剧本'),
    sourceType: payload.sourceType,
    status: compliance.passed ? '待转化' : '合规失败',
    episodeDurationSeconds: payload.episodeDurationSeconds,
    complianceResult: compliance.result,
    riskLevel: compliance.riskLevel,
    overview: md,
    episodes: [],
  }

  saving.value = true
  try {
    const meta = await api.scripts.save({ projectPath: project.value.path, script })
    await loadScripts(meta.id)
    activeEpisodeNo.value = null // 定位到总览
    view.value = 'library'
    if (!compliance.passed) {
      message.warning('合规检测未通过，内容已放入总览，请检查后再转化')
    } else {
      message.success(
        (payload.sourceType === 'ai' ? 'AI生成完成' : '标准化完成') +
          '，内容已放入总览，可在总览「一键转化为项目剧本」',
      )
    }
  } catch (err) {
    message.error('保存失败：' + err.message)
  } finally {
    saving.value = false
  }
}

// ---------- 一键转化：从总览解析分集并自动建立 ----------
async function convertOverviewToEpisodes() {
  if (!current.value) return
  const parsed = splitScriptMarkdown(current.value.overview || '')
  if (!parsed.episodes.length) {
    return message.warning('未识别到分集，请确认总览中包含“## 第1集：标题”这样的分集标题（可切到源码修改）')
  }
  Modal.confirm({
    title: '一键转化为项目剧本',
    content: `将从总览解析出 ${parsed.episodes.length} 集并自动建立分集，总览将只保留分集前的内容，确定继续吗？`,
    okText: '转化',
    cancelText: '取消',
    async onOk() {
      current.value.overview = parsed.overview
      current.value.episodes = parsed.episodes
      current.value.meta.status = '已转化'
      activeEpisodeNo.value = parsed.episodes[0].episodeNo
      dirty.value = true
      await save()
    },
  })
}

// ---------- AI 优化当前集 ----------
async function runAiOptimize() {
  if (!activeEpisode.value) return
  aiRunning.value = true
  try {
    const optimized = await optimizeEpisode({
      episodeMarkdown: activeEpisode.value.content,
      instruction: aiInstruction.value.trim(),
      modelId: appState.currentModelId,
    })
    activeEpisode.value.content = optimized
    dirty.value = true
    mode.value = 'preview'
    message.success('已应用 AI 优化结果，请检查后保存')
  } catch (err) {
    message.error('AI优化失败：' + err.message)
  } finally {
    aiRunning.value = false
  }
}

onMounted(() => loadScripts())
</script>

<template>
  <!-- 独立面板：上传剧本 / AI生成 -->
  <ScriptUpload v-if="view === 'upload'" @back="view = 'library'" @complete="onPanelComplete" />
  <ScriptGenerate v-else-if="view === 'generate'" @back="view = 'library'" @complete="onPanelComplete" />

  <!-- 剧本库主视图 -->
  <div v-else class="script-library">
    <!-- 顶部工具栏 -->
    <header class="lib-toolbar">
      <div class="toolbar-left">
        <template v-if="current">
          <a-input
            v-model:value="current.meta.title"
            class="title-input"
            :bordered="false"
            placeholder="作品名称"
            @change="dirty = true"
          />
          <span class="toolbar-meta">
            共 {{ episodes.length }} 集 · 每集
            <a-input-number
              v-model:value="current.meta.episodeDurationSeconds"
              :min="5"
              :max="600"
              :step="5"
              size="small"
              class="sec-input"
              @change="dirty = true"
            />
            秒
          </span>
          <a-tag v-if="current.meta.status" class="status-tag">{{ current.meta.status }}</a-tag>
          <span v-if="dirty" class="dirty-dot" title="有未保存的修改">● 未保存</span>
        </template>
        <template v-else>
          <span class="toolbar-icon"><ScrollText :size="18" /></span>
          <span class="toolbar-title">剧本库</span>
          <span class="toolbar-sub">当前作品的分集剧本工作区</span>
        </template>
      </div>
      <div class="toolbar-right">
        <a-button v-if="current" type="primary" :loading="saving" :disabled="!dirty" @click="save">
          <template #icon><Save :size="15" /></template>
          保存
        </a-button>
      </div>
    </header>

    <div class="lib-body">
      <!-- 分集目录（单剧本，无顶部新建区） -->
      <aside v-if="current" class="episode-nav">
        <div class="nav-scroll">
          <div class="nav-label">分集目录</div>
          <div class="nav-item" :class="{ active: isOverview }" @click="selectOverview">
            <FileText :size="15" />
            <span class="nav-item-text">总览</span>
          </div>
          <div
            v-for="ep in episodes"
            :key="ep.episodeNo"
            class="nav-item"
            :class="{ active: activeEpisodeNo === ep.episodeNo }"
            @click="selectEpisode(ep.episodeNo)"
          >
            <span class="ep-no">{{ ep.episodeNo }}</span>
            <span class="ep-title">{{ ep.title }}</span>
            <Trash2 :size="14" class="ep-del" title="删除该集" @click.stop="removeEpisode(ep.episodeNo)" />
          </div>
          <div v-if="!episodes.length" class="nav-empty">尚无分集，点击下方新增</div>
        </div>

        <!-- 底部固定操作 -->
        <div class="nav-foot">
          <button class="add-ep-btn" @click="addEpisode">
            <Plus :size="15" /> 新增剧集
          </button>
          <button class="remove-script-btn" @click="removeScript">
            <Trash2 :size="13" /> 删除当前剧本
          </button>
        </div>
      </aside>

      <!-- 工作区 -->
      <section class="work-area">
        <!-- 空状态 -->
        <div v-if="!current" class="work-empty">
          <div class="work-empty-icon"><ScrollText :size="30" /></div>
          <h3>开始创作这部作品的剧本</h3>
          <p>你可以新建并手写剧本，或上传外部文档、使用 AI 生成分集剧本。</p>
          <div class="empty-cards">
            <button class="empty-card" @click="newScript">
              <span class="ec-ico plus"><Plus :size="18" /></span>
              <span class="ec-title">新建剧本</span>
              <span class="ec-desc">从空白模板开始手写</span>
            </button>
            <button class="empty-card" @click="view = 'upload'">
              <span class="ec-ico"><Upload :size="18" /></span>
              <span class="ec-title">上传剧本</span>
              <span class="ec-desc">导入文档并标准化</span>
            </button>
            <button class="empty-card" @click="view = 'generate'">
              <span class="ec-ico"><Sparkles :size="18" /></span>
              <span class="ec-title">AI生成</span>
              <span class="ec-desc">按创意自动生成分集</span>
            </button>
          </div>
        </div>

        <!-- 编辑区 -->
        <div v-else class="work-panel">
          <div class="work-head">
            <div class="work-head-title">
              {{ isOverview ? '总览' : `第${activeEpisode?.episodeNo}集 · ${activeEpisode?.title || ''}` }}
            </div>
            <div class="work-head-actions">
              <a-button
                v-if="isOverview"
                type="primary"
                size="small"
                class="convert-btn"
                @click="convertOverviewToEpisodes"
              >
                <template #icon><ListTree :size="14" /></template>
                一键转化为项目剧本
              </a-button>
              <div class="mode-switch">
                <button class="mode-btn" :class="{ active: mode === 'preview' }" @click="mode = 'preview'">
                  <Eye :size="14" /> 预览
                </button>
                <button class="mode-btn" :class="{ active: mode === 'source' }" @click="mode = 'source'">
                  <Code :size="14" /> 源码
                </button>
                <button
                  v-if="!isOverview"
                  class="mode-btn"
                  :class="{ active: mode === 'ai' }"
                  @click="mode = 'ai'"
                >
                  <Wand2 :size="14" /> AI优化
                </button>
              </div>
            </div>
          </div>

          <div class="work-content">
            <!-- 预览 -->
            <div v-show="mode === 'preview'" class="md-preview" v-html="renderedHtml" />

            <!-- 源码 -->
            <textarea
              v-show="mode === 'source'"
              v-model="activeContent"
              class="md-source"
              spellcheck="false"
              placeholder="在此编写 Markdown 剧本内容"
            />

            <!-- AI优化 -->
            <div v-show="mode === 'ai'" class="ai-panel">
              <div class="ai-tip">
                针对当前集进行润色、节奏调整、对白优化与画面提示补强。可在下方填写优化侧重点。
              </div>
              <a-textarea
                v-model:value="aiInstruction"
                :rows="3"
                placeholder="例如：加快前 10 秒节奏，强化开场钩子，让对白更口语化"
              />
              <div class="ai-actions">
                <a-button type="primary" :loading="aiRunning" @click="runAiOptimize">
                  <template #icon><Wand2 :size="15" /></template>
                  开始优化
                </a-button>
                <span class="ai-note">优化结果会替换当前集内容，请确认后再保存。</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.script-library {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 顶部工具栏 */
.lib-toolbar {
  height: 60px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px 0 22px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
  gap: 12px;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.toolbar-icon {
  display: flex;
  color: var(--brand-color);
}
.toolbar-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
.toolbar-sub {
  font-size: 12px;
  color: var(--text-tertiary);
}
.title-input {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  padding-left: 0;
  width: 210px;
}
.toolbar-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.sec-input {
  width: 68px;
}
.status-tag {
  margin: 0;
}
.dirty-dot {
  font-size: 12px;
  color: var(--brand-color);
  white-space: nowrap;
}
.toolbar-right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 主体 */
.lib-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* 分集目录 */
.episode-nav {
  width: 228px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.nav-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
}
.nav-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 4px 8px 10px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--bg-active);
  color: var(--brand-color);
  font-weight: 600;
}
.nav-item-text {
  flex: 1;
}
.ep-no {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-tertiary);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-item.active .ep-no {
  background: var(--brand-color);
  color: var(--text-onbrand);
}
.ep-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep-del {
  opacity: 0;
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: opacity 0.14s ease, color 0.14s ease;
}
.nav-item:hover .ep-del {
  opacity: 1;
}
.ep-del:hover {
  color: #ff4d4f;
}
.nav-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
/* 底部固定操作区 */
.nav-foot {
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.add-ep-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--brand-color);
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--brand-color);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
}
.add-ep-btn:hover {
  background: var(--brand-color);
  color: var(--text-onbrand);
}
.remove-script-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 7px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.14s ease;
}
.remove-script-btn:hover {
  color: #ff4d4f;
  background: rgba(255, 77, 79, 0.08);
}

/* 工作区 */
.work-area {
  flex: 1;
  display: flex;
  min-width: 0;
  overflow: hidden;
  background: transparent;
}
.work-empty {
  margin: auto;
  text-align: center;
  max-width: 620px;
  padding: 24px;
  color: var(--text-secondary);
}
.work-empty-icon {
  width: 76px;
  height: 76px;
  border-radius: 20px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-color);
  background: var(--bg-active);
}
.work-empty h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--text-primary);
}
.work-empty p {
  margin: 0 0 24px;
  font-size: 13px;
}
.empty-cards {
  display: flex;
  gap: 14px;
  justify-content: center;
}
.empty-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 168px;
  padding: 18px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  cursor: pointer;
  text-align: left;
  transition: all 0.16s ease;
}
.empty-card:hover {
  border-color: var(--brand-color);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}
.ec-ico {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-color);
  background: var(--bg-active);
  margin-bottom: 8px;
}
.ec-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.ec-desc {
  font-size: 12px;
  color: var(--text-tertiary);
}

.work-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.work-head {
  height: 50px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.work-head-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.work-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.mode-switch {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
}
.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 13px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.mode-btn:hover {
  color: var(--text-primary);
}
.mode-btn.active {
  background: var(--bg-panel);
  color: var(--brand-color);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.work-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 26px;
}

/* 源码编辑 */
.md-source {
  width: 100%;
  height: 100%;
  min-height: 360px;
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
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.md-source:focus {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

/* AI 优化面板 */
.ai-panel {
  max-width: 720px;
}
.ai-tip {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.ai-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.ai-note {
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>

<style scoped>
/* Markdown 预览排版 */
.md-preview {
  max-width: 820px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.85;
}
.md-preview :deep(h1) {
  font-size: 22px;
  margin: 4px 0 16px;
}
.md-preview :deep(h2) {
  font-size: 18px;
  margin: 22px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}
.md-preview :deep(h3) {
  font-size: 15px;
  margin: 16px 0 8px;
  color: var(--text-primary);
}
.md-preview :deep(p) {
  margin: 8px 0;
}
.md-preview :deep(ul),
.md-preview :deep(ol) {
  padding-left: 22px;
  margin: 8px 0;
}
.md-preview :deep(li) {
  margin: 4px 0;
}
.md-preview :deep(strong) {
  color: var(--brand-color);
}
.md-preview :deep(blockquote) {
  margin: 10px 0;
  padding: 6px 14px;
  border-left: 3px solid var(--brand-color);
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.md-preview :deep(code) {
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}
.md-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 18px 0;
}
.md-preview :deep(a) {
  color: var(--brand-color);
}
</style>
