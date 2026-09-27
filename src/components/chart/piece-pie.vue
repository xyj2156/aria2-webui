<script setup>
/**
 * 分片完成度饼图（echarts 6，按需注册 PieChart）。
 *
 * 存在的理由：分片数很大时，方块图要么堆 DOM、要么聚合到看不清分布。饼图只画一个
 * canvas、两个扇区，代价与片数无关，用来回答「下了多少 / 还差多少」这一类问题。
 * 方块图与饼图在 detail-pieces 里可切换，数据同源（同一个 bitfield）。
 *
 * 配色与方块图对齐（完成绿、未完成灰），亮暗主题跟 isDark 单例；语言切换要重画，
 * 因为扇区名与标签文案是 t() 出来的。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { PieChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import { t, useI18n } from '@/i18n/index.js';
import { isDark } from '@/composables/use-theme-mode.js';
import { countCompletedPieces } from '@/utils/bitfield.js';

echarts.use([PieChart, TooltipComponent, CanvasRenderer]);

const props = defineProps({
  bitField: { type: String, default: '' },
  pieceCount: { type: Number, default: 0 },
  height: { type: String, default: '240px' },
});

const { locale } = useI18n();

const host = ref(null);
const chart = shallowRef(null);

const completed = computed(() => countCompletedPieces(props.bitField, props.pieceCount));
const total = computed(() => Math.max(0, props.pieceCount || 0));

const LIGHT = { done: '#b8dd69', rest: '#eef2f4', label: '#333', border: '#fff', tooltipBg: 'rgba(255, 255, 255, 0.95)' };
const DARK = { done: '#8fbc3f', rest: '#242424', label: '#eee', border: '#2c2c2c', tooltipBg: 'rgba(51, 51, 51, 0.95)' };

function buildOption() {
  const colors = isDark.value ? DARK : LIGHT;
  return {
    animation: false,
    color: [colors.done, colors.rest],
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltipBg,
      borderColor: colors.border,
      textStyle: { color: colors.label },
      // {b} 扇区名 / {c} 片数 / {d} 百分比（echarts 自带）
      formatter: '{b}<br/>{c} · {d}%',
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: colors.border, borderWidth: 1 },
        label: { color: colors.label, formatter: '{b}\n{d}%' },
        labelLine: { length: 8, length2: 10, lineStyle: { color: colors.label } },
        data: [
          { name: t('task.pieces.completed'), value: completed.value },
          { name: t('task.pieces.uncompleted'), value: total.value - completed.value },
        ],
      },
    ],
  };
}

function render() {
  chart.value?.setOption(buildOption());
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

// 位图每轮轮询都在变（片数不变、完成数变），语言切换则改的是文案，两者都要重画
watch(() => [props.bitField, props.pieceCount], render);
watch([locale, isDark], render);
</script>

<template lang="pug">
div.piece-pie(:style="{ height }" ref="host")
</template>

<style scoped>
.piece-pie {
  width: 100%;
}
</style>
