<script setup>
/**
 * 任务详情弹窗（块 10 由独立路由页改造而来）。
 *
 * 为什么是 dialog 而不是路由页：点某一行弹出，弹窗内嵌在列表里，能直接按任务真实
 * status 裁剪内容（活动/等待→可编辑+轮询+速度图；暂停→可编辑便于继续；完成/移除→
 * 停表且隐藏「设置」tab，只作展示）。遮罩点击不关闭，只保留右上角 X 与「关闭」。
 *
 * 受控组件：父级用 v-model:show 控制显隐，传 gid 指定看哪个任务；
 * 用户动作（暂停/继续/选文件/改设置）成功后 emit('refresh') 通知列表抢跑一轮。
 * 数据全走 @/rpc 具名函数（不直接碰 fetch/WS）；设置 tab 复用块 08 的 setting-item 引擎。
 */
import { computed, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { t } from '@/i18n/index.js';
import DetailOverview from '@/components/task/detail-overview.vue';
import DetailPieces from '@/components/task/detail-pieces.vue';
import DetailFileList from '@/components/task/detail-file-list.vue';
import DetailPeers from '@/components/task/detail-peers.vue';
import SettingItem from '@/components/setting/setting-item.vue';
import { processDownloadTask, processBtPeers, estimateHealthPercentFromPeers } from '@/services/task-service.js';
import { getAvailableTaskOptionKeys, getSpecifiedOptions } from '@/services/option-service.js';
import { usePolling } from '@/composables/use-polling.js';
import { useMonitorStore } from '@/store/monitor.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';
import {
  getTask,
  getTaskOptions,
  getTaskPeers,
  isSecretRejected,
  pauseTaskNow,
  resumeTask,
  saveTaskOptions,
} from '@/rpc';
import { buildRetryPayload, retryTask } from '@/services/retry-service.js';

const props = defineProps({
  /** 显隐（配合 v-model:show） */
  show: { type: Boolean, default: false },
  /** 要看哪个任务 */
  gid: { type: String, default: '' },
});

const emit = defineEmits(['update:show', 'refresh', 'retried', 'after-leave']);

/** 任务详情刷新间隔：读全局设置 downloadTaskRefreshInterval（0 = 关闭自动刷新）；
 *  用函数每轮现取，改设置即时生效。列表与详情共用同一设置项。 */
const webuiSettings = useWebuiSettingsStore();
const intervalMs = () => Number(webuiSettings.options.downloadTaskRefreshInterval) || 0;
// 设置项 showPiecesInfoInTaskDetailPage → 「逐片展示」允许的最大分片数（语义已改：不再决定分片 tab
// 显不显示，只决定超过多少片就自动聚合；只有 never 才彻底不显示该 tab）。
// 聚合与渲染成本由 detail-pieces 自己收住（echarts 单 canvas + 柱数硬护栏）。
const PIECES_MAX_BY_MODE = {
  never: 0,
  le1024: 1024,
  le10240: 10240,
  le102400: 102400,
  always: Number.POSITIVE_INFINITY,
};
const piecesThreshold = (mode) => PIECES_MAX_BY_MODE[mode] ?? PIECES_MAX_BY_MODE.le10240;

const message = useMessage();
const monitor = useMonitorStore();

const gid = computed(() => String(props.gid ?? ''));
const raw = ref(null);
const task = computed(() => (raw.value ? processDownloadTask(raw.value, { addVirtualFileNode: true }) : null));
const peers = ref([]);
const taskOptions = ref({});
const fatal = ref('');
const activeTab = ref('overview');

const isBT = computed(() => Boolean(task.value?.isBT));
const isSettled = computed(() => ['complete', 'error', 'removed'].includes(task.value?.status));
const showSpeedChart = computed(() => task.value?.status === 'active' || task.value?.status === 'waiting');
const showPeers = computed(() => isBT.value && task.value?.status === 'active');
const hasFiles = computed(() => (task.value?.raw.files?.length ?? 0) > 0);
const showPieces = computed(() => {
  const numPieces = task.value?.numPieces ?? 0;
  if (!task.value?.bitfield || numPieces <= 0) {
    return false;
  }
  // 语义变更后只有 never 会隐藏该 tab；片数多少不再影响可见性，只影响逐片/聚合。
  return webuiSettings.options.showPiecesInfoInTaskDetailPage !== 'never';
});
/** 交给分片图当「逐片上限」：阈值内逐片，超过自动聚合 */
const piecesPerPieceCap = computed(() => piecesThreshold(webuiSettings.options.showPiecesInfoInTaskDetailPage));
// 完成/移除：设置改了没意义，直接隐藏设置 tab；活动/等待/暂停/错误保留可编辑。
const showSettings = computed(() => Boolean(task.value) && !['complete', 'removed'].includes(task.value?.status));

const stats = computed(() => (gid.value ? monitor.getStatsData(gid.value) : { xAxis: [], series: [[], []] }));
const healthPercent = computed(() => (task.value ? estimateHealthPercentFromPeers(task.value, peers.value) : 0));
const canPause = computed(() => task.value?.status === 'active' || task.value?.status === 'waiting');
const isPaused = computed(() => task.value?.status === 'paused');

async function refresh() {
  if (!gid.value) {
    fatal.value = t('task.detail.invalid-url');
    polling.stop();
    return;
  }
  try {
    const data = await getTask(gid.value);
    raw.value = data;
    const vm = processDownloadTask(data, { addVirtualFileNode: true });

    // 只有 BT 且在传/排队才要邻居，省一半数据
    if (vm.isBT && (vm.status === 'active' || vm.status === 'waiting')) {
      const peerRows = await getTaskPeers(gid.value);
      peers.value = processBtPeers(peerRows, vm, true);
    } else {
      peers.value = [];
    }

    fatal.value = '';
    monitor.recordStat(vm.gid, { downloadSpeed: vm.downloadSpeed, uploadSpeed: vm.uploadSpeed });

    if (isSettled.value) {
      polling.stop();
    }
  } catch (e) {
    fatal.value = isSecretRejected(e) ? e.message : t('task.detail.task-not-found');
    polling.stop();
  }
}

async function loadOptions() {
  try {
    taskOptions.value = await getTaskOptions(gid.value);
  } catch {
    taskOptions.value = {};
  }
}

const polling = usePolling(refresh, intervalMs, { immediate: true });

function startLoop() {
  if (!gid.value) {
    return;
  }
  activeTab.value = 'overview';
  monitor.resetStat(gid.value);
  raw.value = null;
  fatal.value = '';
  // 间隔>0 起周期刷新（start 内 immediate 会先跑一次）；=0 关闭自动刷新，仍加载一次当前详情
  if (intervalMs() > 0) {
    polling.start();
  } else {
    void refresh();
  }
  void loadOptions();
}

/** 弹窗打开时改间隔即时生效：>0 起轮询，0 停表（保留已加载数据）。 */
watch(intervalMs, () => {
  if (!props.show) {
    return;
  }
  if (intervalMs() > 0) {
    polling.start();
  } else {
    polling.stop();
  }
});

function close() {
  emit('update:show', false);
}

/**
 * 关闭动画结束后 emit('after-leave')：父级用 v-if 挂载本组件（异步组件不渲染就不会解析、
 * 也就不会把详情相关的 chunk 连同 echarts 一起拉下来），必须等动画走完才卸载。
 */
function onModalShow(visible) {
  if (!visible) {
    close();
  }
}

async function toggleState() {
  if (!task.value) {
    return;
  }
  try {
    if (isPaused.value) {
      await resumeTask(task.value.gid);
    } else {
      await pauseTaskNow(task.value.gid);
    }
    await refresh();
    emit('refresh');
  } catch (e) {
    message.error(e?.message || String(e));
  }
}

// =================================================================== 重试（重建下载）
/**
 * 当前任务能否重建：settled 任务打开时探一次（buildRetryPayload 拿原 URIs 判可重建性），
 * 结果缓存在 canRetryNow，避免每轮刷新重复 RPC。纯种子/metalink 文件取不回 → 不可重建 → 不显示入口。
 */
const canRetryNow = ref(false);

async function probeRetry() {
  const g = gid.value;
  if (!g || !isSettled.value) {
    canRetryNow.value = false;
    return;
  }
  const p = await buildRetryPayload(g);
  // 探测期间可能已切换任务，回来时校验 gid 一致再落值
  if (g === gid.value) {
    canRetryNow.value = Boolean(p.ok);
  }
}
watch(() => [gid.value, isSettled.value], () => { void probeRetry(); }, { immediate: true });

const canRetry = computed(() => isSettled.value && canRetryNow.value);

/**
 * 重试：重新 addUri 原任务，是否删旧记录由 removeOldTaskAfterRetrying 决定。
 * 成功 emit('retried')（父级按 afterRetryingTask 处理去向）并关闭本弹窗。
 */
async function retryCurrentTask() {
  try {
    const res = await retryTask(gid.value, {
      removeOld: Boolean(webuiSettings.options.removeOldTaskAfterRetrying),
    });
    if (!res.ok) {
      message.warning(t('task.retry.not-retryable'));
      void probeRetry();
      return;
    }
    message.success(`${t('task.action.retry')} ✓`);
    emit('retried');
    close();
  } catch (e) {
    message.error(e?.message || String(e));
  }
}

/** 应用文件选择：草稿态攒好后一次性写回 select-file（只发一次 changeOption），失败提示、成功后刷新并通知列表 */
async function applyFileSelection(indexes) {
  try {
    await saveTaskOptions(gid.value, { 'select-file': indexes.join(',') });
    await refresh();
    emit('refresh');
    message.success(t('task.action.saved'));
  } catch (e) {
    message.error(e?.message || String(e));
  }
}

/** 详情页可编辑的任务级选项（按状态/BT 过滤，不可改的由引擎标只读） */
const taskOptionItems = computed(() =>
  task.value ? getSpecifiedOptions(getAvailableTaskOptionKeys(task.value.status, task.value.isBT)) : [],
);

/** 设置行回执：option.key → SettingItem 实例 */
const settingItemRefs = new Map();
function setSettingItemRef(el, key) {
  if (el) {
    settingItemRefs.set(key, el);
  } else {
    settingItemRefs.delete(key);
  }
}

async function onSettingChange(payload) {
  try {
    await saveTaskOptions(gid.value, { [payload.key]: payload.value });
    taskOptions.value = { ...taskOptions.value, [payload.key]: payload.value };
    settingItemRefs.get(payload.key)?.reportResult(true);
    emit('refresh');
  } catch (e) {
    settingItemRefs.get(payload.key)?.reportResult(false, e?.message || String(e));
  }
}

function goTab(target) {
  activeTab.value = target;
}

// 弹窗打开且有目标 gid 时才起表；关掉立即停表，别在后台空转。
watch(
  () => props.show,
  (visible) => {
    if (visible) {
      startLoop();
    } else {
      polling.stop();
    }
  },
  // 本组件是异步组件：父级 v-if 挂载与 show 置 true 可能落在同一帧，setup 时 props.show 已是 true，
  // 没有 false→true 的变化可监听。必须 immediate，否则首帧即打开的场景下永远不会去取任务详情。
  { immediate: true },
);
// 打开状态下换任务（切换查看不同 gid）重起一轮。
watch(gid, () => {
  if (props.show) {
    startLoop();
  }
});
</script>

<template lang="pug">
//- 弹窗高度固定写在包装层 .detail-shell 上，而不是 n-modal 的 content-style：
//- 2.45 的 Modal 运行时并不透传该 prop（类型声明里有、实现里没有），写上去只会静默失效。
n-modal(
  :show="props.show"
  preset="card"
  :mask-closable="false"
  :closable="true"
  :bordered="false"
  size="huge"
  :style="{ width: '900px', maxWidth: '92vw' }"
  @update:show="onModalShow"
  @after-leave="emit('after-leave')"
)
  // ---------- 自定义标题行：标题 + 合适间距 + 暂停/继续，整块 flex-1 靠左，关闭 X 留在最右不挤 ----------
  template(#header)
    .flex.items-center.gap-3.min-w-0(class="flex-1")
      span.font-semibold.truncate(class="text-[17px]") {{ task?.taskName || gid || t('task.loading') }}
      n-button(size="small" shrink-0 v-if="canPause" @click="toggleState") {{ t('task.action.pause') }}
      n-button(size="small" shrink-0 v-else-if="isPaused" @click="toggleState") {{ t('task.action.resume') }}
      n-button(size="small" shrink-0 v-if="canRetry" @click="retryCurrentTask") {{ t('task.action.retry') }}

  .detail-shell.flex.flex-col.gap-3
    // ---------- 致命错误 ----------
    p(v-if="fatal" class="p-4 text-center text-[#d03050]") {{ fatal }}

    // ---------- tab ----------
    template(v-else-if="task")
      // 高度链：n-tabs 撑满内容区（flex-1 min-h-0），pane-wrapper 用官方 props 传递 flex 约束，
      // pane 固定 100% 高、超出自己滚——切 tab 时弹窗高度不变，只有 pane 内部滚动位置变化。
      n-tabs(
        v-model:value="activeTab"
        type="line"
        animated
        class="flex-1 min-h-0"
        :pane-wrapper-style="{ flex: '1', minHeight: '0' }"
        :pane-style="{ height: '100%', boxSizing: 'border-box', overflowY: 'auto' }"
      )
        n-tab-pane(:tab="t('task.tab.overview')" name="overview")
          detail-overview(
            :task="task"
            :health-percent="healthPercent"
            :stats="stats"
            :show-speed-chart="showSpeedChart"
            :is-settled="isSettled"
            :has-files="hasFiles"
            @jump="goTab"
          )

        n-tab-pane(:tab="t('task.tab.pieces')" name="pieces" v-if="showPieces")
          detail-pieces(:bit-field="task.bitfield" :num-pieces="task.numPieces" :per-piece-cap="piecesPerPieceCap")

        n-tab-pane(:tab="t('task.tab.files')" name="filelist" v-if="hasFiles")
          detail-file-list(:task="task" @apply="applyFileSelection")

        n-tab-pane(:tab="t('task.tab.peers')" name="btpeers" v-if="showPeers")
          detail-peers(:peers="peers" :num-pieces="task.numPieces")

        n-tab-pane(:tab="t('task.tab.settings')" name="settings" v-if="showSettings")
          form
            setting-item(
              v-for="item in taskOptionItems"
              :key="item.key"
              :ref="(el) => setSettingItemRef(el, item.key)"
              :option="item"
              :model-value="String(taskOptions[item.key] ?? '')"
              disable-required
              @change="onSettingChange"
            )
</template>

<style scoped>
/*
 * 内容区固定高度：切 tab 时弹窗不再忽高忽低，超出部分交给 tab pane 内部滚动。
 * clamp 的下限保证矮屏上也不会缩成一两行，上限避免在大屏上撑出大片空白。
 */
.detail-shell {
  height: clamp(360px, 60vh, 700px);
}
</style>

