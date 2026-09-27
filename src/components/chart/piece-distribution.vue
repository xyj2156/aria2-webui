<script setup>
/**
 * 分片分布柱状图（echarts 6，按需注册 BarChart）。
 *
 * 与顶部那条 piece-bar 的分工：piece-bar 是「一条连续带子」，看整体形状；这里是「按组统计」，
 * 每根柱子代表 groupSize 个原始分片的完成比例，用来看哪一段下满了、哪一段还空着。
 * 两者都只画一个 canvas，片数再多也不会堆 DOM——这正是分片数上千时不用方块图的原因。
 *
 * 柱子配色沿用方块图的三态语义：满组=完成绿、空组=未完成灰、部分完成按完成比例调透明度。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import { t, useI18n } from '@/i18n/index.js';
import { isDark } from '@/composables/use-theme-mode.js';
import { getGroupedPieces } from '@/utils/bitfield.js';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps({
  bitField: { type: String, default: '' },
  pieceCount: { type: Number, default: 0 },
  /** 一根柱子代表多少个原始分片 */
  groupSize: { type: Number, default: 1 },
  height: { type: String, default: '240px' },
});

const { locale } = useI18n();

const host = ref(null);
const chart = shallowRef(null);

const groups = computed(() => getGroupedPieces(props.bitField, props.pieceCount, props.groupSize));

const LIGHT = { axisLine: '#e0e0e0', splitLine: '#f0f0f0', axisLabel: '#666', done: '#b8dd69', tooltipBg: 'rgba(255, 255, 255, 0.95)', tooltipText: '#333' };
const DARK = { axisLine: '#3f3f3f', splitLine: '#2c2c2c', axisLabel: '#eee', done: '#8fbc3f', tooltipBg: 'rgba(51, 51, 51, 0.95)', tooltipText: '#f3f3f3' };

/** x 轴刻度：组起始片号（1 基），只标得下几根就几根，交给 echarts 自己抽稀 */
function groupLabel(cell) {
  return String(cell.start + 1);
}

function tooltipHtml(index) {
  const cell = groups.value[index];
  if (!cell) {
    return '';
  }
  const colors = isDark.value ? DARK : LIGHT;
  const detail = cell.count === 1
    ? t('task.pieces.cell-single', {
      index: cell.start + 1,
      state: t(cell.completed ? 'task.pieces.completed' : 'task.pieces.uncompleted'),
    })
    : t('task.pieces.cell-range', {
      start: cell.start + 1,
      end: cell.end,
      done: cell.completed,
      count: cell.count,
      pct: Math.round(cell.ratio * 100),
    });
  return `<div><strong>${detail}</strong></div>`;
}

function buildOption() {
  const colors = isDark.value ? DARK : LIGHT;
  return {
    animation: false,
    grid: { top: 16, right: 8, bottom: 20, left: 40, containLabel: false },
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltipBg,
      borderColor: colors.axisLine,
      textStyle: { color: colors.tooltipText },
      formatter: (params) => tooltipHtml(params.dataIndex),
    },
    xAxis: {
      type: 'category',
      data: groups.value.map(groupLabel),
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisLabel: { color: colors.axisLabel, showMinLabel: true, showMaxLabel: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: colors.axisLabel, formatter: '{value}%' },
      splitLine: { lineStyle: { color: colors.splitLine } },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 18,
        // 部分完成的柱子用透明度表达比例，与方块图同一套语义
        data: groups.value.map((cell) => ({
          value: Math.round(cell.ratio * 100),
          itemStyle: { color: colors.done, opacity: cell.ratio === 0 ? 0.15 : 0.15 + cell.ratio * 0.85 },
        })),
      },
    ],
  };
}

function render() {
  chart.value?.setOption(buildOption(), true);
}

let observer = null;
function onWindowResize() {
  chart.value?.resize();
}

onMounted(() => {
  if (!host.value) {
    return;
  }
  chart.value = echarts.init(host.value, undefined, { renderer: 'canvas' });
  render();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => chart.value?.resize());
    observer.observe(host.value);
  } else {
    window.addEventListener('resize', onWindowResize);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  window.removeEventListener('resize', onWindowResize);
  chart.value?.dispose();
  chart.value = null;
});

// 组数变化（换聚合档位）要整张重画，所以 setOption 用 notMerge
watch(() => [props.bitField, props.pieceCount, props.groupSize], render);
watch([locale, isDark], render);
</script>

<template lang="pug">
div.piece-distribution(:style="{ height }" ref="host")
</template>

<style scoped>
.piece-distribution {
  width: 100%;
}
</style>
