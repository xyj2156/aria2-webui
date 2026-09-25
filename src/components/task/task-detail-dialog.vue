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

const props = defineProps({
  /** 显隐（配合 v-model:show） */
  show: { type: Boolean, default: false },
  /** 要看哪个任务 */
  gid: { type: String, default: '' },
});

const emit = defineEmits(['update:show', 'refresh']);

/** 任务详情刷新间隔：读全局设置 downloadTaskRefreshInterval（0 = 关闭自动刷新）；
 *  用函数每轮现取，改设置即时生效。列表与详情共用同一设置项。 */
const webuiSettings = useWebuiSettingsStore();
const intervalMs = () => Number(webuiSettings.options.downloadTaskRefreshInterval) || 0;
// 分片方块图 DOM 上限：超过就不画，避免上千个方块拖垮弹窗（阈值后续接设置项）
const PIECE_CAP = 4000;

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
const showPieces = computed(
  () => Boolean(task.value?.bitfield) && (task.value?.numPieces ?? 0) > 0 && (task.value?.numPieces ?? 0) <= PIECE_CAP,
);
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

/** n-modal 内部（X / Esc）请求关闭时同步到父级 */
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
);
// 打开状态下换任务（切换查看不同 gid）重起一轮。
watch(gid, () => {
  if (props.show) {
    startLoop();
  }
});
</script>

<template lang="pug">
n-modal(
  :show="props.show"
  preset="card"
  :mask-closable="false"
  :closable="true"
  :bordered="false"
  size="huge"
  :style="{ width: '900px', maxWidth: '92vw' }"
  @update:show="onModalShow"
)
  // ---------- 自定义标题行：标题 + 合适间距 + 暂停/继续，整块 flex-1 靠左，关闭 X 留在最右不挤 ----------
  template(#header)
    .flex.items-center.gap-3.min-w-0(class="flex-1")
      span.font-semibold.truncate(class="text-[17px]") {{ task?.taskName || gid || t('task.loading') }}
      n-button(size="small" shrink-0 v-if="canPause" @click="toggleState") {{ t('task.action.pause') }}
      n-button(size="small" shrink-0 v-else-if="isPaused" @click="toggleState") {{ t('task.action.resume') }}

  .flex.flex-col.gap-3
    // ---------- 致命错误 ----------
    p(v-if="fatal" class="p-4 text-center text-[#d03050]") {{ fatal }}

    // ---------- tab ----------
    template(v-else-if="task")
      n-tabs(v-model:value="activeTab" type="line" animated :pane-style="{ maxHeight: '60vh', overflowY: 'auto' }")
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
          detail-pieces(:bit-field="task.bitfield" :num-pieces="task.numPieces")

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

