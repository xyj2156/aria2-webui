<script setup>
/**
 * 速度折线图（echarts 6，按需注册避免把整包打进壳层）。
 *
 * 颜色、tooltip、分割线都跟着 html.dark 走（读 use-theme-mode 的 isDark 单例），
 * 不自带第三套配色。data 来自 monitor store 的 { xAxis:number[], series:[下,上] }。
 */
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import { isDark } from '@/composables/use-theme-mode.js';
import { formatSpeed } from '@/utils/format.js';

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps({
  data: { type: Object, required: true },
  height: { type: String, default: '160px' },
  /** 不画网格与坐标轴（嵌在浮层里时用） */
  compact: { type: Boolean, default: false },
});

const LIGHT = {
  line: ['#3a89e9', '#74a329'],
  axisLine: '#e0e0e0',
  splitLine: '#f0f0f0',
  axisLabel: '#666',
  tooltipBg: 'rgba(255, 255, 255, 0.95)',
  tooltipText: '#333',
};
const DARK = {
  line: ['#5399e8', '#8fbc3f'],
  axisLine: '#3f3f3f',
  splitLine: '#2c2c2c',
  axisLabel: '#eee',
  tooltipBg: 'rgba(51, 51, 51, 0.95)',
  tooltipText: '#f3f3f3',
};

const host = ref(null);
const chart = shallowRef(null);

function palette() {
  return isDark.value ? DARK : LIGHT;
}

/** x 轴短时间标签：MM-DD HH:mm（原生 Date，不引 dayjs） */
function timeShort(unixSec) {
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tooltipHtml(params) {
  const list = Array.isArray(params) ? params : [];
  const colors = palette();
  const rows = list
    .map((item, index) => {
      const color = colors.line[index % colors.line.length];
      const arrow = item.seriesName === 'Upload' ? '↑' : '↓';
      return `<div><span style="color:${color}">${arrow}</span> ${formatSpeed(Number(item.value ?? 0))}</div>`;
    })
    .join('');
  const time = list[0]?.axisValueText ?? '';
  return `<div><strong>${time}</strong>${rows}</div>`;
}

function buildOption() {
  const colors = palette();
  return {
    animation: false,
    color: colors.line,
    grid: {
      top: props.compact ? 6 : 16,
      right: 8,
      bottom: props.compact ? 4 : 20,
      left: props.compact ? 8 : 56,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: colors.tooltipBg,
      borderColor: colors.axisLine,
      textStyle: { color: colors.tooltipText },
      formatter: (params) => tooltipHtml(params),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      show: !props.compact,
      data: props.data.xAxis.map(timeShort),
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisLabel: { color: colors.axisLabel, showMinLabel: true, showMaxLabel: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      show: !props.compact,
      axisLabel: { color: colors.axisLabel, formatter: (value) => formatSpeed(value) },
      splitLine: { lineStyle: { color: colors.splitLine } },
    },
    series: [
      { name: 'Download', type: 'line', smooth: true, symbolSize: 6, showSymbol: false, data: props.data.series[0], areaStyle: { opacity: 0.1 } },
      { name: 'Upload', type: 'line', smooth: true, symbolSize: 6, showSymbol: false, data: props.data.series[1], areaStyle: { opacity: 0.1 } },
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

watch(() => props.data, render, { deep: true });
watch(isDark, render);
</script>

<template lang="pug">
div.speed-chart(:style="{ height }" ref="host")
</template>

<style scoped>
.speed-chart {
  width: 100%;
}
</style>
