<script setup>
/**
 * 分片进度条（旧 ngPieceBar）：连续同状态的分片合并成一段再 fillRect，
 * 数百分片也只走少量绘制调用。颜色随 html.dark 切换（读 isDark 单例）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getCombinedPieces } from '@/services/task-service.js';
import { isDark } from '@/composables/use-theme-mode.js';

const props = defineProps({
  bitField: { type: String, default: '' },
  pieceCount: { type: Number, default: 0 },
  height: { type: Number, default: 10 },
  /** 覆盖完成色；不给走默认绿 */
  color: { type: String, default: '' },
});

const host = ref(null);
const segments = computed(() => getCombinedPieces(props.bitField, props.pieceCount));
const completedCount = computed(() =>
  segments.value.filter((item) => item.isCompleted).reduce((sum, item) => sum + item.count, 0),
);
const summary = computed(() => {
  const total = props.pieceCount;
  const pct = total > 0 ? Math.floor((completedCount.value / total) * 100) : 0;
  return `${completedCount.value} / ${total} (${pct}%)`;
});

function draw() {
  const canvas = host.value;
  if (!canvas) {
    return;
  }
  const width = canvas.clientWidth || 200;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(props.height * dpr));

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.scale(dpr, dpr);
  context.clearRect(0, 0, width, props.height);

  const total = props.pieceCount || segments.value.reduce((sum, item) => sum + item.count, 0);
  if (!total) {
    return;
  }
  const completedColor = props.color || (isDark.value ? '#8fbc3f' : '#b8dd69');
  const baseColor = isDark.value ? '#242424' : '#eef2f4';

  let offset = 0;
  for (const segment of segments.value) {
    const segmentWidth = (segment.count / total) * width;
    context.fillStyle = segment.isCompleted ? completedColor : baseColor;
    context.fillRect(offset, 0, Math.ceil(segmentWidth), props.height);
    offset += segmentWidth;
  }
}

let observer = null;
function onWindowResize() {
  draw();
}

onMounted(() => {
  draw();
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    observer = new ResizeObserver(draw);
    observer.observe(host.value);
  } else {
    window.addEventListener('resize', onWindowResize);
  }
});
onUnmounted(() => {
  observer?.disconnect();
  window.removeEventListener('resize', onWindowResize);
});
watch(() => [props.bitField, props.pieceCount, isDark.value, props.color], draw);
</script>

<template lang="pug">
canvas.piece-bar(ref="host" :height="height" :title="summary")
</template>

<style scoped>
.piece-bar {
  display: block;
  width: 100%;
}
</style>
