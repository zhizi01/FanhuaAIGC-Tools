<script setup>
import { Package } from 'lucide-vue-next'
</script>

<template>
  <div class="module-empty">
    <div class="empty-inner">
      <div class="empty-icon"><Package :size="34" /></div>
      <h3 class="empty-title">资产库</h3>
      <p class="empty-desc">图片、音频、视频等资产管理将在后续阶段开放，敬请期待。</p>
    </div>
  </div>
</template>

<style scoped>
.module-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.empty-inner {
  text-align: center;
  color: var(--text-tertiary);
}
.empty-icon {
  width: 84px;
  height: 84px;
  border-radius: 20px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: var(--bg-hover);
}
.empty-title {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--text-secondary);
}
.empty-desc {
  margin: 0;
  font-size: 13px;
}
</style>
