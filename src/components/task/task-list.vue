<script setup>
/**
 * 任务列表通用组件（块 07）。下载中 / 等待中 / 已停止三页共用本组件，
 * 由 prop `type` 决定拉哪张表、出现哪些操作。三个路由视图各自退化成一
 * 行 <task-list :type="..."/>，真正做到「一处实现、三处复用」。
 *
 * 刷新策略（本工程 RPC 层已定：getXxxTasks 一次返回全字段，无 basic/full 之分）：
 * 每轮拉全量并整表替换；WS 可推事件时叠加即时触发；密钥被拒则停表、引导去连接设置。
 * 轮询间隔暂用常量，等 setting store 落地后改接配置项。
 *
 * 网络动作全部走 invokeBatch（一次往返处理多选），单行操作复用同一条路径，
 * 只是 gids 传一个。反馈统一 useMessage，危险操作 useDialog 二次确认。
 */
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDialog, useMessage } from 'naive-ui';
import {
  AddOutline,
  PauseOutline,
  PlayOutline,
  RefreshOutline,
  SearchOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import { t } from '@/i18n/index.js';
import TaskListRow from '@/components/task/task-list-row.vue';
// 详情弹窗（含 echarts 等重依赖）做成异步组件：点行打开时才拉该分片，列表首屏不背这份代码
const TaskDetailDialog = defineAsyncComponent(() => import('@/components/task/task-detail-dialog.vue'));
// 新建任务弹窗同样懒加载：只在点「新建」时才拉分片
const NewTaskDialog = defineAsyncComponent(() => import('@/components/task/new-task-dialog.vue'));
import { processTaskList } from '@/services/task-service.js';
import { retryTask } from '@/services/retry-service.js';
import { usePolling } from '@/composables/use-polling.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';
import {
  canPushEvents,
  clearFinishedResults,
  getDownloadingTasks,
  getStoppedTasks,
  getWaitingTasks,
  invokeBatch,
  isSecretRejected,
  onDownloadEvent,
} from '@/rpc';

const props = defineProps({
  /** downloading | waiting | stopped */
  type: { type: String, default: 'downloading' },
});

/**
 * 任务列表刷新间隔（毫秒）：读全局设置 downloadTaskRefreshInterval（单一事实源），
 * 0 = 关闭自动刷新。用函数每轮现取，改设置即时生效。
 */
const webuiSettings = useWebuiSettingsStore();
const intervalMs = () => Number(webuiSettings.options.downloadTaskRefreshInterval) || 0;

const FETCHERS = {
  downloading: getDownloadingTasks,
  waiting: getWaitingTasks,
  stopped: getStoppedTasks,
};

const pageType = computed(() => (FETCHERS[props.type] ? props.type : 'downloading'));
const isStopped = computed(() => pageType.value === 'stopped');
const isDownloading = computed(() => pageType.value === 'downloading');
const isWaiting = computed(() => pageType.value === 'waiting');

const message = useMessage();
const dialog = useDialog();
const route = useRoute();
const router = useRouter();

// =================================================================== 详情弹窗
/** 当前打开详情的任务 gid 与显隐；点行左键赋值并弹出 */
const detailGid = ref('');
const detailShow = ref(false);

// =================================================================== 新建任务弹窗
/** 「新建」按钮显隐；创建成功后子组件 emit refresh → 抢跑一轮列表 */
const newTaskShow = ref(false);

/** 左键点某一行 → 弹出任务详情（弹窗内嵌在列表里，按 status 自动裁剪内容） */
function openDetail(task) {
  detailGid.value = task.gid;
  detailShow.value = true;
}

/** 直接按 gid 打开详情弹窗（供新建/重试的 ?detail= 桥接复用）。 */
function openDetailByGid(gid) {
  if (!gid) {
    return;
  }
  detailGid.value = String(gid);
  detailShow.value = true;
}

/** 跳到下载列表页；已在该页则只刷一次。 */
function gotoDownloading() {
  if (route.name === 'downloading') {
    polling.trigger();
  } else {
    router.push({ name: 'downloading' });
  }
}

/**
 * 新建成功后按设置 afterCreatingNewTask 决定去向（单一事实源，改值即时生效）：
 *   task-detail                    → 跳下载列表并打开首条新任务详情
 *   task-list / task-list-downloading → 跳下载列表
 *   stay-current-page / 无 gid 兜底 → 留在本页刷一次
 */
function applyAfterNewTask(gids) {
  const mode = webuiSettings.options.afterCreatingNewTask;
  const first = Array.isArray(gids) ? gids[0] : '';
  if (mode === 'task-detail' && first) {
    if (route.name === 'downloading') {
      polling.trigger();
      openDetailByGid(first);
    } else {
      router.push({ name: 'downloading', query: { detail: String(first) } });
    }
  } else if (mode === 'task-list' || mode === 'task-list-downloading') {
    gotoDownloading();
  } else {
    polling.trigger();
  }
}

// =================================================================== 数据与状态
const rows = ref([]);
const loading = ref(true);
const error = ref('');
const search = ref('');
/** 勾选的 gid 集合（reactive Set，add/delete 均被 Vue 追踪） */
const selected = reactive(new Set());

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) {
    return rows.value;
  }
  return rows.value.filter((task) => task.taskName.toLowerCase().includes(needle));
});

// =================================================================== 刷新
async function refresh() {
  try {
    const raw = await FETCHERS[pageType.value]();
    rows.value = processTaskList(raw);
    error.value = '';
    // 队列里消失的 gid 顺手从选中集剔掉
    const alive = new Set(rows.value.map((task) => task.gid));
    for (const gid of [...selected]) {
      if (!alive.has(gid)) {
        selected.delete(gid);
      }
    }
  } catch (e) {
    error.value = e?.message || String(e);
    if (isSecretRejected(e)) {
      // 鉴权失败停表，等用户去连接设置里改（旧版 $interval.cancel 同语义）
      polling.stop();
    }
  } finally {
    loading.value = false;
  }
}

// immediate:true：polling.start() 时立刻发第一轮请求（不等一个间隔），首轮结束后再按间隔排后续。
const polling = usePolling(refresh, intervalMs, { immediate: true });

// =================================================================== 选择
const selectedCount = computed(() => selected.size);
const hasSelection = computed(() => selected.size > 0);
const allVisibleSelected = computed(
  () => visibleRows.value.length > 0 && visibleRows.value.every((task) => selected.has(task.gid)),
);
const someVisibleSelected = computed(
  () => hasSelection.value && !allVisibleSelected.value,
);

function isSelected(gid) {
  return selected.has(gid);
}

function toggleSelect(gid) {
  if (selected.has(gid)) {
    selected.delete(gid);
  } else {
    selected.add(gid);
  }
}

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    for (const task of visibleRows.value) {
      selected.delete(task.gid);
    }
  } else {
    for (const task of visibleRows.value) {
      selected.add(task.gid);
    }
  }
}

function selectWhere(predicate) {
  for (const task of visibleRows.value) {
    if (predicate(task)) {
      selected.add(task.gid);
    }
  }
}

/** 当前可见且被勾选的 gid 列表（批量动作的作用域） */
const selectedGids = computed(() => visibleRows.value.filter((task) => selected.has(task.gid)).map((task) => task.gid));
/** 勾选里「可恢复」(canResume：paused/error) 的 gid——aria2.unpause 只对暂停有效，完成/移除发了也报错 */
const resumableSelectedGids = computed(() =>
  visibleRows.value.filter((task) => selected.has(task.gid) && task.canResume).map((task) => task.gid),
);
/** 是否有可恢复的勾选项：决定「开始」入口是否可用 */
const hasResumable = computed(() => resumableSelectedGids.value.length > 0);
/**
 * 可重建（重试）的判定：列表层用 `!isBT` 作稳妥启发式——HTTP/FTP 直链一定能用原 URIs 重建；
 * BT 里磁链能重建、纯种子文件不能，行级拿不到 URIs 无法区分，故列表入口只给非 BT，
 * 磁链的重试走详情弹窗（详情会实际拉 URIs 判定）。真正的可重建性最终由 retry-service 兜底。
 */
const retryableSelectedGids = computed(() =>
  visibleRows.value.filter((task) => selected.has(task.gid) && !task.isBT).map((task) => task.gid),
);
const hasRetryableSelection = computed(() => retryableSelectedGids.value.length > 0);

// =================================================================== 动作
/**
 * 对一批 gid 发同一个方法，统一处理计数、反馈、清选、即时刷新。
 * @param {string[]} gids
 * @param {string} method 去前缀的 aria2 方法名，如 forcePause
 * @param {string} successLabel 成功文案
 * @param {unknown[]} [extraArgs] gid 之后的附加参数，如 changePosition 的 [0, 'POS_SET']
 */
async function runOnGids(gids, method, successLabel, extraArgs = []) {
  if (!gids.length) {
    return;
  }
  let results;
  try {
    results = await invokeBatch(gids.map((gid) => ({ method, params: [gid, ...extraArgs] })));
  } catch (e) {
    // 整批调用本身失败（超时 / 断连 / 顶层 error / 报文异常）时，invokeBatch 会 reject；
    // 调用方都是 void runOnGids(...)，不接住就会静默无反馈，这里兜底弹错。
    message.error(`${successLabel}失败：${e?.message || String(e)}`);
    return;
  }
  const failed = results.filter((row) => !row.ok);
  const ok = results.length - failed.length;

  if (failed.length) {
    const first = failed[0]?.error?.message || '';
    message.warning(`${successLabel}：成功 ${ok}，失败 ${failed.length}${first ? `（${first}）` : ''}`);
  } else {
    message.success(`${successLabel} ${ok}`);
  }
  selected.clear();
  polling.trigger();
}

// 移除的方法随页型不同：停止页是「清记录」，其余是「强制移除下载」
const removeMethod = () => (isStopped.value ? 'removeDownloadResult' : 'forceRemove');

function pauseOne(task) {
  void runOnGids([task.gid], 'forcePause', t('task.action.pause'));
}
function resumeOne(task) {
  void runOnGids([task.gid], 'unpause', t('task.action.resume'));
}
function startNowOne(task) {
  // 立即开始 = aria2.changePosition 移到队首（POS_SET, 0），尽快排到下载
  void runOnGids([task.gid], 'changePosition', t('task.action.resume'), [0, 'POS_SET']);
}
/** 执行删除：单行 / 批量共用。 */
function doRemove(gids) {
  void runOnGids(gids, removeMethod(), t('task.action.remove'));
}

/**
 * 「先确认后删除」统一入口，受全局设置 confirmTaskRemoval 门控：
 * 关闭时（false）直接执行；开启时（默认 true）弹二次确认。
 * 单行 × 与批量删除共用此函数，让「删除前确认」的字面语义在两处一致生效。
 */
function confirmRemoveThen(gids) {
  if (!gids.length) {
    return;
  }
  if (!webuiSettings.options.confirmTaskRemoval) {
    doRemove(gids);
    return;
  }
  dialog.warning({
    title: t('task.confirm.remove.title'),
    content: t('task.confirm.remove.content', { count: gids.length }),
    positiveText: t('task.confirm.remove.positive'),
    negativeText: t('task.confirm.negative'),
    onPositiveClick: () => doRemove(gids),
  });
}

function removeOne(task) {
  confirmRemoveThen([task.gid]);
}

function pauseSelected() {
  void runOnGids(selectedGids.value, 'forcePause', t('task.action.pause'));
}
function resumeSelected() {
  return runOnGids(resumableSelectedGids.value, 'unpause', t('task.action.resume'));
}
function startNowSelected() {
  resumeSelected().then(function () {
    runOnGids(selectedGids.value, 'changePosition', t('task.action.resume'), [0, 'POS_SET']);
  });
}

function removeSelected() {
  confirmRemoveThen(selectedGids.value);
}

/**
 * 重试成功后按设置 afterRetryingTask 决定去向（单一事实源，改值即时生效）：
 *   task-list-downloading / task-list → 跳下载列表（新任务已进下载队列）
 *   refresh-page → 留在本页并刷新
 *   stay-current-page → 不动（用户显式要求保持当前视图）
 */
function applyAfterRetry() {
  const mode = webuiSettings.options.afterRetryingTask;
  if (mode === 'task-list-downloading' || mode === 'task-list') {
    gotoDownloading();
  } else if (mode === 'refresh-page') {
    polling.trigger();
  }
}

/**
 * 批量重试：逐个用原 URIs 重新下单，是否顺带删旧记录由 removeOldTaskAfterRetrying 决定。
 * 不可重建（纯种子/metalink 文件）的任务由 retry-service 回退，这里计入「无法重建」不误报失败。
 * @param {string[]} gids
 */
async function retryGids(gids) {
  if (!gids.length) {
    return;
  }
  const removeOld = Boolean(webuiSettings.options.removeOldTaskAfterRetrying);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let firstErr = '';
  for (const gid of gids) {
    try {
      const res = await retryTask(gid, { removeOld });
      if (res.ok) {
        ok += 1;
      } else {
        skipped += 1;
      }
    } catch (e) {
      failed += 1;
      firstErr = e?.message || String(e);
    }
  }

  const label = t('task.action.retry');
  const parts = [`${label}：成功 ${ok}`];
  if (skipped) {
    parts.push(`无法重建 ${skipped}`);
  }
  if (failed) {
    parts.push(`失败 ${failed}${firstErr ? `（${firstErr}）` : ''}`);
  }
  const text = parts.join('，');
  if (failed) {
    message.warning(text);
  } else if (ok) {
    message.success(text);
  } else {
    message.warning(text); // 一条都没能重建
  }

  selected.clear();
  if (ok) {
    applyAfterRetry();
  }
}

function retryOne(task) {
  void retryGids([task.gid]);
}
function retrySelected() {
  void retryGids(retryableSelectedGids.value);
}

/** 详情弹窗重试成功：关窗、刷新本页，并按 afterRetryingTask 决定去向。 */
function onDetailRetried() {
  detailShow.value = false;
  polling.trigger();
  applyAfterRetry();
}

function clearCompleted() {
  dialog.warning({
    title: t('task.confirm.clear.title'),
    content: t('task.confirm.clear.content'),
    positiveText: t('task.confirm.clear.positive'),
    negativeText: t('task.confirm.negative'),
    onPositiveClick: async () => {
      try {
        await clearFinishedResults();
        message.success(t('task.action.clear-completed') + ' ✓');
        selected.clear();
        polling.trigger();
      } catch (e) {
        message.error(e?.message || String(e));
      }
    },
  });
}

// =================================================================== 右键菜单
const menu = reactive({ show: false, x: 0, y: 0 });

const menuOptions = computed(() => {
  const items = [];
  if (isStopped.value) {
    items.push({ key: 'start', label: t('task.action.resume'), disabled: !hasResumable.value });
    items.push({ key: 'retry', label: t('task.action.retry'), disabled: !hasRetryableSelection.value });
  } else if (isWaiting.value) {
    items.push({ key: 'now', label: t('task.action.resume'), disabled: !hasSelection.value });
  } else {
    items.push({ key: 'pause', label: t('task.action.pause'), disabled: !hasSelection.value });
  }
  items.push({ key: 'remove', label: t('task.action.remove'), disabled: !hasSelection.value });
  items.push({ type: 'divider', key: 'div-1' });
  items.push({ key: 'select-all', label: t('task.menu.select-all') });
  if (isStopped.value) {
    items.push({ key: 'select-completed', label: t('task.menu.select-completed') });
    items.push({ key: 'select-failed', label: t('task.menu.select-failed') });
    items.push({ type: 'divider', key: 'div-2' });
    items.push({ key: 'clear-completed', label: t('task.action.clear-completed') });
  }
  return items;
});

function openContextMenu(event, task) {
  if (!selected.has(task.gid)) {
    toggleSelect(task.gid);
  }
  menu.x = event.clientX;
  menu.y = event.clientY;
  menu.show = true;
}

function onMenuSelect(key) {
  menu.show = false;
  switch (key) {
    case 'start':
      resumeSelected();
      break;
    case 'retry':
      retrySelected();
      break;
    case 'now':
      startNowSelected();
      break;
    case 'pause':
      pauseSelected();
      break;
    case 'remove':
      removeSelected();
      break;
    case 'select-all':
      selectWhere(() => true);
      break;
    case 'select-completed':
      selectWhere((task) => task.status === 'complete');
      break;
    case 'select-failed':
      selectWhere((task) => task.status === 'error' || task.status === 'removed');
      break;
    case 'clear-completed':
      clearCompleted();
      break;
    default:
      break;
  }
}

function closeContextMenu(event) {
  if (menu.show) {
    menu.show = false;
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && menu.show) {
    menu.show = false;
  }
}

// =================================================================== 生命周期
// 切页时重置：清空数据与选择，重新拉一轮
watch(
  pageType,
  () => {
    rows.value = [];
    error.value = '';
    search.value = '';
    selected.clear();
    loading.value = true;
    polling.trigger();
  },
);

/**
 * 按间隔起停轮询：>0 起周期刷新，0 停表（自动刷新关闭）。
 * 改设置即时生效。首屏数据另由 onMounted 保证，不受此开关影响。
 */
function syncRunning() {
  if (intervalMs() > 0) {
    polling.start();
  } else {
    polling.stop();
  }
}
watch(intervalMs, syncRunning);

/**
 * 下载列表被 ?detail=<gid> 打开时（新建「跳详情」的跨页桥接）：挂载即弹详情，随后清掉 query，
 * 避免刷新 / 回退重复弹出。仅 downloading 路由响应。
 */
watch(
  () => route.query.detail,
  (gid) => {
    if (gid && route.name === 'downloading') {
      openDetailByGid(gid);
      router.replace({ name: 'downloading', query: { ...route.query, detail: undefined } });
    }
  },
  { immediate: true },
);

const eventDisposers = [];
onMounted(() => {
  syncRunning();
  // 间隔为 0（关闭自动刷新）时 polling.start() 不会跑，仍需手动加载一次，避免空表
  if (intervalMs() <= 0) {
    void refresh();
  }
  // WS / 有推送时才订阅事件，收到即抢跑一轮（HTTP 通道收不到，纯靠轮询）
  if (canPushEvents()) {
    eventDisposers.push(onDownloadEvent(() => polling.trigger()));
  }
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  for (const dispose of eventDisposers) {
    dispose();
  }
  document.removeEventListener('click', closeContextMenu);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template lang="pug">
.flex.flex-col.gap-2.h-full

  // ---------- 工具栏（单行：左=全选+计数+新建+操作+刷新，右=搜索） ----------
  .flex.items-center.gap-2.flex-nowrap
    // 全选（半选态：选中了但不是全选）
    n-checkbox.shrink-0(
      :checked="allVisibleSelected"
      :indeterminate="someVisibleSelected"
      @update:checked="toggleSelectAll"
    )
    span.text-sm.opacity-70.shrink-0(class="tabular-nums")
      | {{ t('task.count', { selected: selectedCount, total: rows.length }) }}

    // 新建任务：secondary 浅底（与「移除」同层级、不显笨重），置于操作按钮前并与之拉开一段距离
    n-button(size="small" type="primary" secondary shrink-0 class="ml-2" @click="newTaskShow = true")
      template(#icon)
        n-icon(:component="AddOutline")
      | {{ t('task.new.button') }}

    // 批量操作按钮（按页型出现，无选中时禁用）：下载中=暂停 / 等待中=立即开始 / 已停止=开始
    n-button(size="small" shrink-0 v-if="isDownloading" :disabled="!hasSelection" @click="pauseSelected")
      template(#icon)
        n-icon(:component="PauseOutline")
      | {{ t('task.action.pause') }}
    n-button(size="small" shrink-0 v-if="isWaiting" :disabled="!hasSelection" @click="startNowSelected")
      template(#icon)
        n-icon(:component="PlayOutline")
      | {{ t('task.action.resume') }}
    n-button(size="small" shrink-0 v-if="isStopped" :disabled="!hasResumable" @click="resumeSelected")
      template(#icon)
        n-icon(:component="PlayOutline")
      | {{ t('task.action.resume') }}
    n-button(size="small" shrink-0 v-if="isStopped" :disabled="!hasRetryableSelection" :title="t('task.action.retry')" @click="retrySelected")
      template(#icon)
        n-icon(:component="RefreshOutline")
      | {{ t('task.action.retry') }}
    n-button(size="small" type="error" secondary shrink-0 :disabled="!hasSelection" @click="removeSelected")
      template(#icon)
        n-icon(:component="TrashOutline")
      | {{ t('task.action.remove') }}
    n-button(size="small" shrink-0 v-if="isStopped" @click="clearCompleted")
      | {{ t('task.action.clear-completed') }}
    n-button(size="small" quaternary shrink-0 :title="t('task.action.refresh')" @click="polling.trigger()")
      template(#icon)
        n-icon(:component="RefreshOutline")

    // 弹性空隙：把搜索顶到最右
    .grow.shrink

    n-input(class="w-[220px] max-w-[40vw] shrink" size="small" clearable :placeholder="t('task.search.placeholder')" v-model:value="search")
      template(#prefix)
        n-icon(:component="SearchOutline")

  // ---------- 连接错误横幅 ----------
  n-alert(v-if="error" type="error" :bordered="false" size="small" closable @close="error = ''")
    | {{ error }}

  // ---------- 列表主体 ----------
  n-spin.grow(:show="loading" :description="t('task.loading')" content-class="flex flex-col")
    ul.list-none.m-0.p-0.flex.flex-col.gap-1.overflow-auto
      task-list-row(
        v-for="task in visibleRows"
        :key="task.gid"
        :task="task"
        :selected="isSelected(task.gid)"
        :page-type="pageType"
        @toggle="toggleSelect(task.gid)"
        @contextmenu="openContextMenu($event, task)"
        @open="openDetail(task)"
        @pause="pauseOne(task)"
        @resume="resumeOne(task)"
        @startNow="startNowOne(task)"
        @remove="removeOne(task)"
      )

    n-empty.mt-10(v-if="!loading && !visibleRows.length" :description="search ? t('task.empty.filtered') : t('task.empty.none')")

  // ---------- 右键菜单（manual 触发 + 光标坐标定位） ----------
  n-dropdown(
    trigger="manual"
    placement="bottom-start"
    :x="menu.x"
    :y="menu.y"
    :show="menu.show"
    :options="menuOptions"
    @select="onMenuSelect"
    @clickoutside="menu.show = false"
  )

  // ---------- 任务详情弹窗（点行弹出；弹窗内动作改完抢跑一轮列表刷新） ----------
  task-detail-dialog(v-model:show="detailShow" :gid="detailGid" @refresh="polling.trigger()" @retried="onDetailRetried")

  // ---------- 新建任务弹窗（工具栏「新建」弹出；创建成功后抢跑一轮列表刷新） ----------
  new-task-dialog(v-model:show="newTaskShow" @created="applyAfterNewTask")
</template>
