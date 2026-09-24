<script setup>
/**
 * 任务列表的单行卡片（块 07 列表的行视图）。
 *
 * 只负责「显示一条 processDownloadTask 产出的 TaskVM + 抛出用户意图事件」，不碰 RPC、不碰轮询。
 * 网络动作与路由跳转都交给父组件 task-list.vue 统一处理。
 *
 * 三态复用：pageType 只影响「行内出现哪些按钮 / 是否显示进度」。左键点信息区抛 open → 详情。
 */
import { computed } from 'vue';
import {
  AlertCircleOutline,
  CheckmarkCircleOutline,
  CloudDownloadOutline,
  CloudUploadOutline,
  PauseOutline,
  PlayOutline,
  TimeOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import { t } from '@/i18n/index.js';
import {
  formatPercent,
  formatRemain,
  formatSpeed,
  formatVolume,
  MORE_THAN_A_DAY_TOKEN,
} from '@/utils/format.js';

const props = defineProps({
  /** processDownloadTask() 产出的 TaskVM */
  task: { type: Object, required: true },
  /** 是否被勾选 */
  selected: { type: Boolean, default: false },
  /** 所属页型：downloading | waiting | stopped */
  pageType: { type: String, default: 'downloading' },
});

const emit = defineEmits(['toggle', 'contextmenu', 'open', 'pause', 'resume', 'startNow', 'remove']);

/** 大小文案：已完成显示总量，下载中显示 已下/总 */
const sizeText = computed(() => {
  const { totalLength, completedLength, isDone } = props.task;
  if (totalLength <= 0) {
    return isDone ? formatVolume(completedLength) : '-';
  }
  if (isDone) {
    return formatVolume(totalLength);
  }
  return `${formatVolume(completedLength)} / ${formatVolume(totalLength)}`;
});

/** 剩余时间：算不出（无速度 / 已停 / 已完成）时为 '-' */
const remainText = computed(() => {
  const idle = props.task.status !== 'active' || props.task.downloadSpeed <= 0;
  const text = formatRemain(props.task.remainTime, idle);
  return text === MORE_THAN_A_DAY_TOKEN ? t('task.duration.more-than-a-day') : text;
});

/** 状态标签配色：done 绿、error 红、active 蓝、paused 橙、其余灰 */
const tagType = computed(() => {
  switch (props.task.status) {
    case 'active':
      return 'info';
    case 'waiting':
      return 'default';
    case 'paused':
      return 'warning';
    case 'complete':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
});

const statusIcon = computed(() => {
  switch (props.task.status) {
    case 'complete':
      return CheckmarkCircleOutline;
    case 'error':
      return AlertCircleOutline;
    case 'active':
      return props.task.seeder ? CloudUploadOutline : CloudDownloadOutline;
    case 'waiting':
      return TimeOutline;
    default:
      return null;
  }
});
</script>

<template lang="pug">
div(
  class="flex items-center gap-3 px-3 py-2 rounded-lg select-none transition-colors duration-150 ease-[ease] hover:bg-[#808080]/10"
  :class="{ 'bg-[#2080f0]/12': selected }"
  @contextmenu.prevent="emit('contextmenu', $event)"
)
  n-checkbox.shrink-0.cursor-default(:checked="selected" @update:checked="emit('toggle')" @click.stop)

  // 信息区：左键点击进详情
  .grow.min-w-0.cursor-pointer(@click="emit('open')")
    // 名称行
    .flex.items-center.gap-2.min-w-0
      n-icon.shrink-0(v-if="statusIcon" :component="statusIcon" :size="16")
      n-tooltip(:show-arrow="false" trigger="hover")
        template(#trigger)
          span.truncate.font-medium {{ task.taskName || task.gid }}
        span {{ task.taskName || task.gid }}
      n-tag.shrink-0(size="small" :type="tagType" :bordered="false") {{ t(task.statusKey) }}
      n-tag.shrink-0(v-if="task.isBT && task.numSeeders > 0" size="small" type="info" :bordered="false")
        | {{ t('task.meta.seeders') }} {{ task.numSeeders }}

    // 进度行（停止页不画进度条，省一行高度）
    template(v-if="pageType !== 'stopped'")
      .flex.items-center.gap-3.mt-1.text-xs.opacity-70(class="tabular-nums")
        span.shrink-0 {{ formatPercent(task.completePercent) }}
        n-progress.grow(
          type="line"
          :percentage="task.completePercent"
          :height="6"
          :border-radius="3"
          :show-indicator="false"
          :status="task.status === 'error' ? 'error' : (task.isDone ? 'success' : 'default')"
          :processing="task.status === 'active'"
        )

    // 明细行：大小 / 速度 / 剩余时间 / 错误码
    .flex.items-center.gap-3.mt-1.text-xs.opacity-60(class="tabular-nums")
      span {{ sizeText }}
      template(v-if="pageType !== 'stopped'")
        span(v-if="task.downloadSpeed > 0") ↓ {{ formatSpeed(task.downloadSpeed) }}
        span(v-if="task.uploadSpeed > 0") ↑ {{ formatSpeed(task.uploadSpeed) }}
        span(v-if="remainText !== '-'") {{ t('task.meta.remain') }} {{ remainText }}
      span(v-if="task.status === 'error' && task.errorCode" class="text-[#d03050]") {{ t('task.meta.error-code') }} {{ task.errorCode }}

  // 行内操作：按可操作性出现
  .flex.items-center.gap-1.shrink-0(@click.stop)
    n-button(v-if="task.canPause" text size="small" :title="t('task.action.pause')" @click.stop="emit('pause')")
      n-icon(:component="PauseOutline")
    n-button(v-else-if="task.canResume" text size="small" :title="t('task.action.resume')" @click.stop="emit('resume')")
      n-icon(:component="PlayOutline")
    n-button(v-else-if="task.canStartNow" text size="small" :title="t('task.action.resume')" @click.stop="emit('startNow')")
      n-icon(:component="PlayOutline")
    n-button(text type="error" size="small" :title="t('task.action.remove')" @click.stop="emit('remove')")
      n-icon(:component="TrashOutline")
</template>
