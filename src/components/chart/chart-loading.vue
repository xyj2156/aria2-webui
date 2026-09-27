<script setup>
/**
 * 异步图表组件的加载占位。
 *
 * 存在的理由：图表组件（speed-chart / piece-distribution / piece-pie）都带 echarts 分片，
 * 首次渲染要先等 chunk 下载。没有占位时这块区域高度先塌成 0、图表到位再撑开，弹窗跟着抖一下。
 * 这里按图表自身的高度参数占住同一段高度，加载前后布局不变。
 *
 * defineAsyncComponent 会把同一份 props 传给 loadingComponent，所以 height 直接沿用图表的值。
 */
import { t } from '@/i18n/index.js';

defineProps({
  height: { type: String, default: '200px' },
});
</script>

<template lang="pug">
.chart-loading(:style="{ height }")
  n-spin(size="small")
  span {{ t('task.chart-loading') }}
</template>

<style scoped>
.chart-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.65;
}
</style>
