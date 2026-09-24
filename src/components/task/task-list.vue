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
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDialog, useMessage } from 'naive-ui';
import {
  PauseOutline,
  PlayOutline,
  RefreshOutline,
  SearchOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import { t } from '@/i18n/index.js';
import TaskListRow from '@/components/task/task-list-row.vue';
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

const message = useMessage();
const dialog = useDialog();
const router = useRouter();

/** 左键点某一行 → 进任务详情 */
function openDetail(task) {
  void router.push({ name: 'task-detail', params: { gid: task.gid } });
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

// =================================================================== 动作
/**
 * 对一批 gid 发同一个方法，统一处理计数、反馈、清选、即时刷新。
 * @param {string[]} gids
 * @param {string} method 去前缀的 aria2 方法名，如 forcePause
 * @param {string} successLabel 成功文案
 */
async function runOnGids(gids, method, successLabel) {
  if (!gids.length) {
    return;
  }
  const results = await invokeBatch(gids.map((gid) => ({ method, params: [gid] })));
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
function removeOne(task) {
  void runOnGids([task.gid], removeMethod(), t('task.action.remove'));
}

function pauseSelected() {
  void runOnGids(selectedGids.value, 'forcePause', t('task.action.pause'));
}
function resumeSelected() {
  void runOnGids(selectedGids.value, 'unpause', t('task.action.resume'));
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
    items.push({ key: 'start', label: t('task.action.resume'), disabled: !hasSelection.value });
    items.push({ key: 'remove', label: t('task.action.remove'), disabled: !hasSelection.value });
  } else {
    items.push({ key: 'pause', label: t('task.action.pause'), disabled: !hasSelection.value });
    items.push({ key: 'remove', label: t('task.action.remove'), disabled: !hasSelection.value });
  }
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

  // ---------- 工具栏（单行：左=多选+操作+刷新，右=搜索） ----------
  .flex.items-center.gap-2.flex-nowrap
    // 全选（半选态：选中了但不是全选）
    n-checkbox.shrink-0(
      :checked="allVisibleSelected"
      :indeterminate="someVisibleSelected"
      @update:checked="toggleSelectAll"
    )
    span.text-sm.opacity-70.shrink-0(class="tabular-nums")
      | {{ t('task.count', { selected: selectedCount, total: rows.length }) }}

    // 批量操作按钮（按页型出现，无选中时禁用）
    n-button(size="small" shrink-0 v-if="!isStopped" :disabled="!hasSelection" @click="pauseSelected")
      template(#icon)
        n-icon(:component="PauseOutline")
      | {{ t('task.action.pause') }}
    n-button(size="small" shrink-0 v-if="isStopped" :disabled="!hasSelection" @click="resumeSelected")
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

    n-input.search-input(size="small" clearable :placeholder="t('task.search.placeholder')" v-model:value="search")
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
</template>

<style scoped>
/* 搜索框在 flex 单行里定宽：正常 220px，最宽不超过视口 40%，小屏自动缩，
   保证「多选+操作」在左、搜索在右始终挤在一行不折行。 */
.search-input {
  width: 220px;
  max-width: 40vw;
  flex-shrink: 1;
}
</style>
