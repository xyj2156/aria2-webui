<script setup>
/**
 * 详情页概览 tab（对齐 project 的 DetailOverview）：字段表 + 单任务速度图 + tracker 折叠。
 * 纯展示：数据全从 props 进来（task 是 TaskVM、healthPercent、stats 来自 monitor store）。
 * 速度图依赖 echarts，较重，做成异步组件——只有真的渲染到速度图时才拉 echarts 分片。
 */
import { computed, defineAsyncComponent, ref } from 'vue';
import { t } from '@/i18n/index.js';
import { getTaskErrorMessage } from '@/rpc';
import {
  formatDateTime,
  formatPercent,
  formatRemain,
  formatRatio,
  formatSpeed,
  formatVolume,
  MORE_THAN_A_DAY_TOKEN,
} from '@/utils/format.js';

const SpeedChart = defineAsyncComponent(() => import('@/components/chart/speed-chart.vue'));

const props = defineProps({
  task: { type: Object, required: true },
  healthPercent: { type: Number, default: 0 },
  stats: { type: Object, required: true },
  showSpeedChart: { type: Boolean, default: false },
  isSettled: { type: Boolean, default: false },
  /** 有文件时可点「已选文件」跳到文件 tab */
  hasFiles: { type: Boolean, default: false },
});

const emit = defineEmits(['jump']);

const trackersExpanded = ref(false);

function remain(task) {
  const text = formatRemain(task.remainTime, task.idle);
  return text === MORE_THAN_A_DAY_TOKEN ? t('task.duration.more-than-a-day') : text;
}

/** [{ label, value, jump? }] —— label 已是译文 */
const rows = computed(() => {
  const task = props.task;
  const list = [
    { label: t('task.field.name'), value: task.taskName || task.gid },
    { label: t('task.field.size'), value: formatVolume(task.totalLength, { fractionSize: 'auto' }) },
    {
      label: t('task.field.selected-files'),
      value: t('task.field.file-count', { count: task.selectedFileCount }),
      jump: props.hasFiles ? 'filelist' : undefined,
    },
    { label: t('task.field.status'), value: t(task.statusKey), tooltip: task.errorMessage },
  ];

  if (task.status === 'error' && task.errorCode) {
    const desc = getTaskErrorMessage(task.errorCode);
    if (desc) {
      list.push({ label: t('task.field.error-description'), value: desc });
    }
  }

  list.push({ label: t('task.field.progress'), value: formatPercent(task.completePercent) });
  if (task.isBT) {
    list.push({ label: t('task.field.health'), value: formatPercent(props.healthPercent) });
  }
  list.push(
    {
      label: t('task.field.download'),
      value: `${formatVolume(task.completedLength, { fractionSize: 'auto' })} / ${formatSpeed(task.downloadSpeed)}`,
    },
    {
      label: t('task.field.upload'),
      value: `${formatVolume(task.uploadLength, { fractionSize: 'auto' })} / ${formatSpeed(task.uploadSpeed)}`,
    },
    { label: t('task.field.share-ratio'), value: formatRatio(task.shareRatio) },
    { label: t('task.field.remaining'), value: remain(task) },
    { label: t('task.field.seeders-connections'), value: `${task.numSeeders} / ${task.connections}` },
  );

  const creationDate = task.raw?.bittorrent?.creationDate;
  if (creationDate) {
    list.push({ label: t('task.field.seed-creation-time'), value: formatDateTime(creationDate) });
  }
  if (task.infoHash) {
    list.push({ label: t('task.field.info-hash'), value: task.infoHash });
  }
  if (task.singleUrl) {
    list.push({ label: t('task.field.download-url'), value: task.singleUrl });
  }
  list.push({ label: t('task.field.download-dir'), value: task.dir || '-' });

  return list;
});

const trackers = computed(() => {
  const announce = props.task.raw?.bittorrent?.announceList ?? [];
  return announce.flat().filter(Boolean);
});
</script>

<template lang="pug">
.flex.flex-col.gap-3
  n-descriptions.bordered(:column="1" size="small" label-style="width: 160px")
    n-descriptions-item(v-for="row in rows" :key="row.label" :label="row.label")
      .flex.items-center.gap-2
        span.truncate(:title="row.tooltip || row.value") {{ row.value }}
        n-button(class="text-[#2080f0]" v-if="row.jump" text size="tiny" @click="emit('jump', row.jump)")
          | {{ t('task.action.view') }}

  div(v-if="showSpeedChart" class="flex flex-col gap-[6px] p-3 rounded-lg bg-[#808080]/6")
    div(class="flex items-center gap-2 text-[13px] font-semibold") {{ t('task.field.speed') }}
    speed-chart(:data="stats" height="180px")

  div(v-if="trackers.length" class="flex flex-col gap-[6px] p-3 rounded-lg bg-[#808080]/6")
    div(class="flex items-center gap-2 text-[13px] font-semibold cursor-pointer" @click="trackersExpanded = !trackersExpanded")
      span {{ t('task.field.tracker-servers') }}
      span  ({{ trackers.length }})
      span(class="ml-auto font-normal text-[#2080f0]") {{ trackersExpanded ? t('task.action.collapse') : t('task.action.expand') }}
    ul(v-if="trackersExpanded" class="m-0 pl-[18px] text-[12px] opacity-75")
      li(v-for="row in trackers" :key="row") {{ row }}

  p(v-else-if="!isSettled" class="m-0 text-[12px] opacity-60") {{ t('task.detail.auto-refresh-hint') }}
</template>
