<script setup>
/**
 * 顶栏「上传/下载速率」浮层：非模态小窗，只放速度曲线 + 关闭按钮。
 *
 * 三条硬约束的实现方式：
 * 1. echarts 点开前不加载 —— 本组件由 global-stat-indicator 用 shallowRef + 动态 import 在首次
 *    点击时才拉取（speed-chart 与 echarts 分片随之进入），壳层首屏不背这份代码。
 * 2. 可拖拽 —— 顶部一条拖拽条（只承载关闭按钮）按下后挂 window 级 pointermove/pointerup 跟手移动，
 *    位置 clamp 在视口内；曲线区不参与拖拽，否则会打断 echarts 的 tooltip 悬停。
 * 3. 不遮挡其他操作 —— 不用 n-modal（自带遮罩、锁交互），改成 Teleport 到 body 的 fixed 浮层：
 *    没有遮罩层，浮层之外照常点击，需要时把它拖走即可。
 *
 * 数据只读不轮询：曲线来自 monitor store 的全局环形缓冲（use-global-status 每轮轮询已在写入）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CloseOutline } from '@vicons/ionicons5';

import SpeedChart from '@/components/chart/speed-chart.vue';
import { t } from '@/i18n/index.js';
import { useMonitorStore } from '@/store/monitor.js';

const emit = defineEmits(['close']);

const monitor = useMonitorStore();

/** 浮层宽度固定（echarts 靠组件内 ResizeObserver 自适应），默认贴在右上角、顶栏速率之下 */
const FLOAT_WIDTH = 380;
const FLOAT_HEIGHT = 240;
const EDGE_MARGIN = 8;
const DEFAULT_TOP = 62;

const root = ref(null);
const pos = ref({ left: 0, top: DEFAULT_TOP });

const stats = computed(() => monitor.getStatsData(monitor.GLOBAL_STAT_KEY));

const floatStyle = computed(() => ({
  width: `${FLOAT_WIDTH}px`,
  left: `${pos.value.left}px`,
  top: `${pos.value.top}px`,
}));

/** 把位置收进视口；窗口小到放不下时退化为贴左上边距 */
function clamp(next) {
  const width = root.value?.offsetWidth || FLOAT_WIDTH;
  const height = root.value?.offsetHeight || FLOAT_HEIGHT;
  const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    left: Math.min(Math.max(next.left, EDGE_MARGIN), maxLeft),
    top: Math.min(Math.max(next.top, EDGE_MARGIN), maxTop),
  };
}

function placeAtTopRight() {
  pos.value = clamp({ left: window.innerWidth - FLOAT_WIDTH - EDGE_MARGIN, top: DEFAULT_TOP });
}

/**
 * 拖拽。两个实证过的坑，决定了这里的写法：
 * 1. 不用 setPointerCapture —— 它要求 pointerId 处于活动指针集合，一旦抛 NotFoundError 就会打断
 *   后续赋值（Vue 的事件异常只进 console，不冒到 window.onerror，排查代价高）；改用 window 上的
 *   pointermove/pointerup 监听，既能跟手移出拖拽条、也不依赖捕获语义。
 * 2. 落在关闭按钮上的按下不启动拖拽 —— pointerdown 里的 preventDefault 会抑制兼容性 mouse 事件，
 *   连带把按钮的 click 一起吞掉。
 */
let drag = null;

function endDrag() {
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerUp);
  drag = null;
}

function onBarPointerDown(event) {
  if (event.button !== 0 || event.target.closest('button')) {
    return;
  }
  drag = { pointerId: event.pointerId, dx: event.clientX - pos.value.left, dy: event.clientY - pos.value.top };
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);
  event.preventDefault();
}

function onWindowPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  pos.value = clamp({ left: event.clientX - drag.dx, top: event.clientY - drag.dy });
}

function onWindowPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  endDrag();
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    emit('close');
  }
}

function onWindowResize() {
  pos.value = clamp(pos.value);
}

onMounted(() => {
  placeAtTopRight();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => {
  endDrag();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template lang="pug">
Teleport(to="body")
  .speed-float(ref="root" :style="floatStyle")
    .float-bar(:title="t('webui.speed-float.drag-hint')" @pointerdown="onBarPointerDown")
      n-button.float-close(text size="tiny" :title="t('webui.speed-float.close')" @click="emit('close')")
        template(#icon)
          n-icon(:size="14")
            close-outline
    .float-body
      speed-chart(:data="stats" height="200px")
</template>

<style scoped>
.speed-float {
  position: fixed;
  z-index: 1500;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.28);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
html.dark .speed-float {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(40, 40, 40, 0.96);
}
.float-bar {
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 4px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  cursor: move;
  user-select: none;
  /* 触屏上必须禁掉默认手势，否则 pointermove 会被浏览器滚动/缩放吞掉 */
  touch-action: none;
}
.float-body {
  padding: 4px 6px 6px;
}
</style>
