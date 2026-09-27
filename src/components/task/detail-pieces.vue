<script setup>
/**
 * 分片图 tab：一条常驻分布带 + 一块可切换的 echarts 图。
 *
 * 为什么是这两层：
 * - 顶部 piece-bar 是 canvas 上按「连续同状态段」fillRect，天然承载任意片数，用来看整体形状；
 * - 下方交给 echarts（分布柱状 / 完成度饼图），同样只有一个 canvas，不会像方块图那样一片一个
 *   DOM 节点。3314 片这种量级下，逐片 DOM 会明显拖慢每轮轮询的重排。
 *
 * 柱状图按「每柱 N 片」聚合：默认自动档——片数在设置项阈值内逐片，超阈值按目标柱数聚合，
 * 另有一条硬护栏（柱数不超过 MAX_BARS）防止阈值设成「始终」时把上万根柱塞进 canvas。
 * 手动档位可以越过护栏，性能由使用者自己承担。
 *
 * 是否显示该 tab 由详情页判定：设置项 now 只决定「逐片还是聚合」，只有 never 才彻底不显示。
 */
import { computed, defineAsyncComponent, ref } from 'vue';

import { t } from '@/i18n/index.js';
import PieceBar from '@/components/pieces/piece-bar.vue';
import ChartLoading from '@/components/chart/chart-loading.vue';
import { countCompletedPieces, resolveGroupSize } from '@/utils/bitfield.js';

// echarts 较重：切到对应视图才拉分片（详情弹窗本身已是异步组件，不会拖累列表首屏）。
// loadingComponent 用同高度的占位顶住，避免分片到位前后图表区高度塌一下、弹窗跟着抖。
const PieceDistribution = defineAsyncComponent({
  loader: () => import('@/components/chart/piece-distribution.vue'),
  loadingComponent: ChartLoading,
  loadingDelay: 0,
});
const PiecePie = defineAsyncComponent({
  loader: () => import('@/components/chart/piece-pie.vue'),
  loadingComponent: ChartLoading,
  loadingDelay: 0,
});

const props = defineProps({
  bitField: { type: String, default: '' },
  numPieces: { type: Number, default: 0 },
  /** 设置项阈值：片数不超过它就逐片画 */
  perPieceCap: { type: Number, default: 1024 },
});

/** 自动档聚合到的目标柱数 */
const TARGET_BARS = 1000;
/** 无论设置项怎么给，柱数都不超过这个硬护栏 */
const MAX_BARS = 2000;
/** 手动档可选的「每柱片数」 */
const GROUP_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
/** 两个 echarts 视图统一高度，同时决定加载占位的高度（塌不塌就看这一个值） */
const CHART_HEIGHT = '240px';

const view = ref('distribution');
const groupChoice = ref('auto');

const completedCount = computed(() => countCompletedPieces(props.bitField, props.numPieces));

const groupSize = computed(() => {
  if (groupChoice.value !== 'auto') {
    return Number(groupChoice.value);
  }
  const bySetting = props.numPieces <= props.perPieceCap ? 1 : resolveGroupSize(props.numPieces, TARGET_BARS);
  return Math.max(bySetting, resolveGroupSize(props.numPieces, MAX_BARS));
});

const barCount = computed(() => (props.numPieces > 0 ? Math.ceil(props.numPieces / groupSize.value) : 0));

const groupOptions = computed(() => [
  { label: t('task.pieces.group-auto'), value: 'auto' },
  ...GROUP_STEPS.filter((step) => step <= Math.max(1, props.numPieces)).map((step) => ({
    label: t('task.pieces.group-step', { size: step }),
    value: step,
  })),
]);

const groupSummary = computed(() =>
  groupSize.value === 1
    ? t('task.pieces.summary-per-piece', { total: props.numPieces })
    : t('task.pieces.summary-grouped', { total: props.numPieces, size: groupSize.value, bars: barCount.value }),
);
</script>

<template lang="pug">
.flex.flex-col.gap-3
  div(class="flex items-center gap-4 text-[12px] opacity-75")
    span(class="inline-flex items-center gap-[6px]")
      i(class="w-[10px] h-[10px] border border-[#a3c644] bg-[#b8dd69] [.dark_&]:border-[#6f9a2a] [.dark_&]:bg-[#8fbc3f]")
      | {{ t('task.pieces.completed') }}: {{ completedCount }}
    span(class="inline-flex items-center gap-[6px]")
      i(class="w-[10px] h-[10px] border border-[#d0d0d0] bg-[#f0f0f0] [.dark_&]:border-[#3a3a3a] [.dark_&]:bg-[#242424]")
      | {{ t('task.pieces.uncompleted') }}: {{ numPieces - completedCount }}
    span(class="ml-auto") {{ t('task.pieces.info', { completed: completedCount, total: numPieces }) }}

  // 常驻分布带：与邻居列表里那条同款，看整体形状
  piece-bar(:bit-field="bitField" :piece-count="numPieces" :height="10")

  div(class="flex items-center gap-2 text-[12px]")
    n-radio-group(v-model:value="view" size="small" class="flex-none")
      n-radio-button(value="distribution") {{ t('task.pieces.view-distribution') }}
      n-radio-button(value="pie") {{ t('task.pieces.view-pie') }}
    template(v-if="view === 'distribution'")
      n-select(
        v-model:value="groupChoice"
        size="tiny"
        :options="groupOptions"
        class="w-[130px] flex-none"
        :consistent="false"
      )
      span.opacity-60 {{ groupSummary }}

  piece-distribution(v-if="view === 'distribution'" :bit-field="bitField" :piece-count="numPieces" :group-size="groupSize" :height="CHART_HEIGHT")
  piece-pie(v-else :bit-field="bitField" :piece-count="numPieces" :height="CHART_HEIGHT")
</template>
