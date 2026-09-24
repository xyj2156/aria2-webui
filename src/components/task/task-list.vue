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
import { usePolling } from '@/composables/use-polling.js';
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

/** 轮询间隔（毫秒）。TODO(07→05)：等 setting store 落地后改成读配置。 */
const POLL_INTERVAL_MS = 5000;

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

// immediate:true：进入页面立刻发第一轮请求（不等一个间隔），首轮结束后再按间隔排后续。
const polling = usePolling(refresh, POLL_INTERVAL_MS, { immediate: true });

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
function removeOne(task) {
  void runOnGids([task.gid], removeMethod(), t('task.action.remove'));
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
  const gids = selectedGids.value;
  if (!gids.length) {
    return;
  }
  dialog.warning({
    title: t('task.confirm.remove.title'),
    content: t('task.confirm.remove.content', { count: gids.length }),
    positiveText: t('task.confirm.remove.positive'),
    negativeText: t('task.confirm.negative'),
    onPositiveClick: () => void runOnGids(gids, removeMethod(), t('task.action.remove')),
  });
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

const eventDisposers = [];
onMounted(() => {
  polling.start();
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
  task-detail-dialog(v-model:show="detailShow" :gid="detailGid" @refresh="polling.trigger()")

  // ---------- 新建任务弹窗（工具栏「新建」弹出；创建成功后抢跑一轮列表刷新） ----------
  new-task-dialog(v-model:show="newTaskShow" @refresh="polling.trigger()")
</template>
