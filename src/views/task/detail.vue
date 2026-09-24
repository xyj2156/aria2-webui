<script setup>
/**
 * 任务详情页（块 10）：单任务轮询 + 五个 tab（概览 / 分块 / 文件 / 邻居 / 设置）。
 * 终态（complete/error/removed）自动停表，文件选择态也停表，避免刷掉用户正在改的勾选。
 * 数据全走 @/rpc 的具名函数（不直接碰 fetch/WS）；设置 tab 复用块 08 的 setting-item 引擎。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import {
  addTask,
  getTask,
  getTaskOptions,
  getTaskPeers,
  isSecretRejected,
  pauseTaskNow,
  resumeTask,
  saveTaskOptions,
} from '@/rpc';

const POLL_INTERVAL_MS = 5000;

const route = useRoute();
const router = useRouter();
const message = useMessage();
const monitor = useMonitorStore();

const gid = computed(() => String(route.params.gid ?? ''));
const raw = ref(null);
const task = computed(() => (raw.value ? processDownloadTask(raw.value, { addVirtualFileNode: true }) : null));
const peers = ref([]);
const taskOptions = ref({});
const fatal = ref('');
const activeTab = ref('overview');
/** 文件选择态：勾选文件期间停表，免得轮询把用户正在改的勾选刷掉 */
const chooseMode = ref(false);

const isBT = computed(() => Boolean(task.value?.isBT));
const isSettled = computed(() => ['complete', 'error', 'removed'].includes(task.value?.status));
const showSpeedChart = computed(() => task.value?.status === 'active' || task.value?.status === 'waiting');
const showPeers = computed(() => isBT.value && task.value?.status === 'active');
const hasFiles = computed(() => (task.value?.raw.files?.length ?? 0) > 0);

// 分片方块图 DOM 上限：超过就不画，避免上千个方块拖垮页面（阈值后续接设置项）
const PIECE_CAP = 4000;
const showPieces = computed(
  () => Boolean(task.value?.bitfield) && (task.value?.numPieces ?? 0) > 0 && (task.value?.numPieces ?? 0) <= PIECE_CAP,
);

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

    if (isSettled.value || chooseMode.value) {
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

const polling = usePolling(refresh, POLL_INTERVAL_MS, { immediate: true });

function startLoop() {
  if (!gid.value) {
    return;
  }
  monitor.resetStat(gid.value);
  raw.value = null;
  fatal.value = '';
  polling.start();
  void loadOptions();
}

function backToList() {
  void router.push({ name: 'downloading' });
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
  } catch (e) {
    message.error(e?.message || String(e));
  }
}

/** 重试：用原任务的来源地址重新入队（非 BT；无地址时提示） */
async function retry() {
  if (!task.value) {
    return;
  }
  const sources = (task.value.raw.files ?? [])
    .map((file) => ((file.uris ?? []).map((uri) => uri.uri)).filter(Boolean))
    .filter((urls) => urls.length > 0);

  if (task.value.isBT || sources.length === 0) {
    message.warning(t('task.detail.retry-unsupported'));
    return;
  }
  try {
    for (const urls of sources) {
      await addTask(urls, task.value.dir ? { dir: task.value.dir } : {});
    }
    message.success(t('task.detail.retry-added'));
    void router.push({ name: 'downloading' });
  } catch (e) {
    message.error(e?.message || String(e));
  }
}

/** 写回 select-file（选中文件下标数组），失败提示、成功停选择态并刷新 */
async function applyFileSelection(indexes) {
  try {
    await saveTaskOptions(gid.value, { 'select-file': indexes.join(',') });
    chooseMode.value = false;
    await refresh();
    message.success(t('task.action.saved'));
  } catch (e) {
    message.error(e?.message || String(e));
  }
}

/** 非选择模式下单击勾选：以当前已选集合为基准改之后即时应用 */
function onFilesToggle(indexes, value) {
  const selected = new Set(
    (task.value?.files ?? []).filter((file) => file.type !== 'dir' && file.selected).map((file) => file.index),
  );
  for (const index of indexes) {
    if (value) {
      selected.add(index);
    } else {
      selected.delete(index);
    }
  }
  void applyFileSelection([...selected]);
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
  } catch (e) {
    settingItemRefs.get(payload.key)?.reportResult(false, e?.message || String(e));
  }
}

function goTab(target) {
  activeTab.value = target;
}

watch(gid, () => startLoop());
watch(chooseMode, (choosing) => (choosing ? polling.stop() : polling.start()));
onMounted(() => startLoop());
onUnmounted(() => polling.stop());
</script>

<template lang="pug">
.flex.flex-col.gap-3.h-full
  // ---------- 头部 ----------
  .flex.items-center.gap-3
    h2.title.m-0.truncate(:title="task?.taskName") {{ task?.taskName || t('task.loading') }}
    .flex.items-center.gap-2(class="ml-auto")
      n-button(size="small" @click="backToList") {{ t('task.detail.back') }}
      n-button(size="small" v-if="canPause" @click="toggleState") {{ t('task.action.pause') }}
      n-button(size="small" v-else-if="isPaused" @click="toggleState") {{ t('task.action.resume') }}
      n-button(size="small" v-if="hasFiles" @click="chooseMode = !chooseMode") {{ t('task.files.choose') }}
      n-button(size="small" @click="retry") {{ t('task.action.retry') }}

  // ---------- 致命错误 ----------
  p.fatal(v-if="fatal") {{ fatal }}

  // ---------- tab ----------
  template(v-else-if="task")
    n-tabs(v-model:value="activeTab" type="line" animated)
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
        detail-file-list(
          :task="task"
          :choose-mode="chooseMode"
          @toggle="onFilesToggle"
          @confirm="applyFileSelection"
          @cancel="chooseMode = false"
        )

      n-tab-pane(:tab="t('task.tab.peers')" name="btpeers" v-if="showPeers")
        detail-peers(:peers="peers" :num-pieces="task.numPieces")

      n-tab-pane(:tab="t('task.tab.settings')" name="settings")
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
.title {
  font-size: 16px;
  font-weight: 600;
}
.fatal {
  padding: 16px;
  text-align: center;
  color: #d03050;
}
</style>
