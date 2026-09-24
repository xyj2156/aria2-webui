<script setup>
/**
 * 任务详情「文件」tab（块 10 §3）。
 *
 * 渲染：文件用 NVirtualList 虚拟滚动——BT 动辄上千文件，全量渲染 <tr> 又卡又慢，
 * 只画视口内的行。行等高（ROW_H），把已摊平的 visibleRows（目录+文件混排、尊重折叠）喂进去。
 *
 * 选择语义（方案一，对齐 aria2 手册）：
 * - aria2 允许下载中改 select-file，但改它会使 active 下载自动重启，故这里走「草稿 + 一次确认」，
 *   绝不逐次点勾选即时下发（那等于每点一下重启一次任务）。
 * - 已在下载/已下载的文件（selected 且 completedLength>0）禁止取消勾选；只有没开始的（completedLength==0）可取消。
 * - 全选/全不选/反选都只作用于「可取消」的文件，锁定项恒为选中。
 * - 编辑态在 tab 内联，不另开弹窗；下载中确认前行内提示会重启。
 *
 * 说明：project 的「按类型/扩展名批量选」和「表头右键排序」依赖 file-types 与 display-order
 * 基建（属块 08/07），详情页暂缓，此处按 aria2 原始文件序展示。
 */
import { computed, reactive, ref } from 'vue';
import { t } from '@/i18n/index.js';
import { formatPercent, formatVolume } from '@/utils/format.js';

const props = defineProps({
  task: { type: Object, required: true },
});

const emit = defineEmits(['apply']);

/** 行高（px），必须与每行实际渲染高度一致，NVirtualList 按它算窗口；模板里 :style 高度同源绑定 */
const ROW_H = 34;

const collapsed = reactive({});
const editing = ref(false);
/** 草稿：编辑态下当前勾选的文件 index 集合 */
const draft = ref(new Set());

const fileNodes = computed(() => props.task.files.filter((file) => file.type !== 'dir'));

/** 实时（后端已生效）已选文件 index 集合 */
const liveSelected = computed(() => new Set(fileNodes.value.filter((file) => file.selected).map((file) => file.index)));
/** 计算勾选态要用的集合：编辑看草稿，否则看实时 */
const activeSet = computed(() => (editing.value ? draft.value : liveSelected.value));

/** 锁定：已选且已有下载数据 → 不能取消。仅在实时为选中时锁定。 */
function isLocked(file) {
  return file.selected && file.completedLength > 0;
}

/** 每个目录下（含子目录）的文件总数与已选数：单次遍历按 relativePath 前缀累加，避免 O(files²) */
const dirStats = computed(() => {
  const stats = new Map();
  const selected = activeSet.value;
  for (const file of fileNodes.value) {
    const isSel = selected.has(file.index);
    const rel = file.relativePath || '';
    const segments = rel ? rel.split('/') : [];
    let prefix = '';
    bump(prefix, isSel);
    for (const seg of segments) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      bump(prefix, isSel);
    }
  }
  function bump(path, isSel) {
    let entry = stats.get(path);
    if (!entry) {
      entry = { total: 0, selected: 0 };
      stats.set(path, entry);
    }
    entry.total += 1;
    if (isSel) {
      entry.selected += 1;
    }
  }
  return stats;
});

function nodePath(node) {
  if (node.type === 'dir') {
    return node.relativePath ? `${node.relativePath}/${node.fileName}` : node.fileName;
  }
  return node.path;
}

/** 某目录下的所有文件（含子目录）：仅目录勾选/预设等偶发操作用，非每帧 */
function filesUnder(dirPath) {
  return fileNodes.value.filter((file) => {
    const rel = file.relativePath || '';
    return dirPath === '' || rel === dirPath || rel.startsWith(`${dirPath}/`);
  });
}

/** 摊平后的可见行：尊重折叠，目录与文件混排，携带 checked/indeterminate/locked 供渲染 */
const visibleRows = computed(() => {
  const rows = [];
  const selected = activeSet.value;
  const hidden = Object.entries(collapsed)
    .filter(([, value]) => value)
    .map(([path]) => path);
  const isUnder = (child, prefix) => child.startsWith(`${prefix}/`);

  for (const node of props.task.files) {
    const path = nodePath(node);
    if (hidden.some((prefix) => isUnder(path, prefix))) {
      continue;
    }
    if (node.type === 'dir') {
      const stat = dirStats.value.get(path) ?? { total: 0, selected: 0 };
      rows.push({
        key: `dir:${path}`, isDir: true, path, name: node.fileName, level: node.level,
        length: node.length, percent: node.completePercent,
        checked: stat.total > 0 && stat.selected === stat.total,
        indeterminate: stat.selected > 0 && stat.selected < stat.total,
        locked: false,
      });
    } else {
      rows.push({
        key: `file:${node.index}`, isDir: false, path, name: node.fileName, level: node.level,
        length: node.length, percent: node.completePercent,
        checked: selected.has(node.index),
        locked: isLocked(node),
        index: node.index,
      });
    }
  }
  return rows;
});

/** 有 >1 个文件、且任务非完成/移除态，才允许改选 */
const canEdit = computed(() =>
  fileNodes.value.length > 1 && !['complete', 'removed'].includes(props.task.status),
);
/** 下载中改选会重启该任务（用于行内提示） */
const willRestart = computed(() => props.task.status === 'active');
/** 草稿非空才可提交：select-file 传空串会被 aria2 当成「全选」，须拦掉 */
const canApply = computed(() => draft.value.size > 0);

const listStyle = { height: '48vh', minHeight: '200px' };

function toggleDir(path) {
  collapsed[path] = !collapsed[path];
}

function startEdit() {
  draft.value = new Set(liveSelected.value);
  editing.value = true;
}
function cancelEdit() {
  editing.value = false;
}
function applyEdit() {
  if (!canApply.value) {
    return;
  }
  emit('apply', [...draft.value].sort((a, b) => a - b));
  editing.value = false;
}

/** 把一批文件设为 value；取消时跳过锁定项（不能取消已下载的） */
function setDraft(targets, value) {
  const next = new Set(draft.value);
  for (const file of targets) {
    if (!value && isLocked(file)) {
      continue; // 锁定项恒选，不因取消/反选/全不选被摘掉
    }
    if (value) {
      next.add(file.index);
    } else {
      next.delete(file.index);
    }
  }
  draft.value = next;
}

function onToggle(row, value) {
  if (!editing.value) {
    return;
  }
  if (row.isDir) {
    setDraft(filesUnder(row.path), value);
  } else if (row.index !== undefined) {
    const file = props.task.files.find((item) => item.index === row.index && item.type !== 'dir');
    if (file) {
      setDraft([file], value);
    }
  }
}

/** 预设：all 全选中；none 仅保留锁定项；invert 翻转未锁定项 */
function applyPreset(mode) {
  const next = new Set();
  for (const file of fileNodes.value) {
    const locked = isLocked(file);
    if (mode === 'all') {
      next.add(file.index);
    } else if (mode === 'none') {
      if (locked) {
        next.add(file.index);
      }
    } else { // invert
      const isSelected = draft.value.has(file.index);
      if (locked || !isSelected) {
        next.add(file.index); // 锁定恒选；未锁定的取反
      }
    }
  }
  draft.value = next;
}
</script>

<template lang="pug">
.flex.flex-col.gap-2.h-full
  // ---------- 工具条：仅可编辑时出现（只读任务不留空条）；默认「更改下载文件」，编辑态给预设 + 取消/确认 ----------
  template(v-if="canEdit")
    .flex.items-center.gap-2.flex-wrap(v-if="!editing")
      n-button(size="small" @click="startEdit") {{ t('task.files.edit') }}
    .flex.items-center.gap-2.flex-wrap(v-else)
      n-button(size="small" @click="applyPreset('all')") {{ t('task.files.select-all') }}
      n-button(size="small" @click="applyPreset('none')") {{ t('task.files.select-none') }}
      n-button(size="small" @click="applyPreset('invert')") {{ t('task.files.select-invert') }}
      span(class="text-[12px] text-[#d03050]" v-if="!canApply") {{ t('task.files.none-selected') }}
      span(class="text-[12px] text-[#d03050]" v-else-if="willRestart") {{ t('task.files.restart-tip') }}
      .grow.shrink
      n-button(size="small" @click="cancelEdit") {{ t('task.confirm.negative') }}
      n-button(size="primary" small :disabled="!canApply" @click="applyEdit") {{ t('task.files.confirm') }}

  // ---------- 表头（非虚拟，固定） ----------
  div(class="grid grid-cols-[32px_minmax(0,1fr)_180px_110px] items-center gap-[10px] px-[10px] text-[13px] font-semibold opacity-70 border-b border-[#808080]/20")
    div
    div {{ t('task.files.name') }}
    div {{ t('task.field.progress') }}
    div(class="text-right") {{ t('task.field.size') }}

  // ---------- 虚拟列表主体：只渲染视口内行 ----------
  n-virtual-list(v-if="visibleRows.length" :items="visibleRows" :item-size="ROW_H" :style="listStyle")
    template(#default="{ item: row, index }")
      div(
        class="grid grid-cols-[32px_minmax(0,1fr)_180px_110px] items-center gap-[10px] px-[10px] text-[13px] border-b border-[#808080]/10"
        :class="{ 'font-semibold': row.isDir, 'bg-[#808080]/5': index % 2 === 1 }"
        :style="{ height: ROW_H + 'px' }"
      )
        div
          n-checkbox(
            :checked="row.checked"
            :indeterminate="Boolean(row.indeterminate)"
            :disabled="!editing || row.locked"
            @update:checked="(value) => onToggle(row, value)"
          )
        div(class="flex items-center min-w-0")
          span(class="inline-block shrink-0" :style="{ width: `${row.level * 16}px` }")
          button(
            v-if="row.isDir"
            type="button"
            class="w-[18px] shrink-0 border-none bg-transparent p-0 text-[#2080f0] cursor-pointer"
            @click="toggleDir(row.path)"
          ) {{ collapsed[row.path] ? '+' : '-' }}
          n-tooltip(:show-arrow="false" trigger="hover")
            template(#trigger)
              span(class="flex-1 min-w-0 truncate") {{ row.name }}
            span {{ row.path }}
        div(class="flex items-center gap-2 min-w-0")
          n-progress(
            class="flex-1 min-w-0"
            type="line"
            :percentage="row.percent"
            :height="6"
            :border-radius="3"
            :show-indicator="false"
          )
          span(class="shrink-0 tabular-nums") {{ formatPercent(row.percent) }}
        div(class="text-right tabular-nums") {{ formatVolume(row.length, { fractionSize: 'auto' }) }}

  n-empty(v-else :description="t('task.files.empty')")
</template>
