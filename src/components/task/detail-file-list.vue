<script setup>
/**
 * 任务详情「文件」tab（块 10 §3）。
 *
 * 渲染：文件用 NVirtualList 虚拟滚动——BT 动辄上千文件，全量渲染 <tr> 又卡又慢，
 * 只画视口内的行。行等高（ROW_H），把已摊平的 visibleRows（目录+文件混排、尊重折叠）喂进去。
 *
 * 选择语义（2026-09-25 改造，与 aria2 真实能力对齐）：
 * - 复选框在可编辑任务上一律可点，不再有「更改下载文件」两步式；任何状态都能自由勾选/取消，
 *   包括已下载/正在下载的文件——若要清理未选文件，交给 aria2 的 bt-remove-unselected-file。
 * - 交互模型：勾选只改「本地草稿」；一旦草稿 ≠ 后端已生效集合，底部出现「取消 / 确定」草稿条，
 *   点确定才下发一次 select-file（避免每点一下勾选都触发 aria2 重启）。取消丢弃草稿回到后端现状。
 * - 提交仍要求草稿非空：aria2 把 select-file 传空视为「全选」，须拦掉误清空。
 * - 下载中改选会使该任务重启，草稿条上给一行红字提示（不弹窗）。
 * - 完成/移除态任务一律不可编辑（canEdit=false，复选框灰掉、无预设、无草稿条）。
 *
 * 说明：project 的「按类型/扩展名批量选」和「表头右键排序」依赖 file-types 与 display-order
 * 基建（属块 08/07），详情页暂缓，此处按 aria2 原始文件序展示。
 */
import { computed, reactive, ref, watch } from 'vue';
import { ChevronDown, ChevronForward } from '@vicons/ionicons5';
import { t } from '@/i18n/index.js';
import { formatPercent, formatVolume } from '@/utils/format.js';

const props = defineProps({
  task: { type: Object, required: true },
});

const emit = defineEmits(['apply']);

/** 行高（px），必须与每行实际渲染高度一致，NVirtualList 按它算窗口；模板里 :style 高度同源绑定 */
const ROW_H = 34;

const collapsed = reactive({});
/** 本地草稿：用户当前想下发的文件 index 集合 */
const draft = ref(new Set());
/** 用户是否有本地改动；true 时暂停 liveSelected→draft 的自动同步 */
const hasUserDraft = ref(false);

const fileNodes = computed(() => props.task.files.filter((file) => file.type !== 'dir'));
/** 后端已生效的选中集合（来自 aria2 的 file.selected 字段） */
const liveSelected = computed(() => new Set(fileNodes.value.filter((file) => file.selected).map((file) => file.index)));

/** 只有用户改过草稿才做集合比较；未改时恒为「未脏」，避免轮询抖动误判 */
const isDirty = computed(() => {
  if (!hasUserDraft.value) return false;
  if (draft.value.size !== liveSelected.value.size) return true;
  for (const idx of liveSelected.value) {
    if (!draft.value.has(idx)) return true;
  }
  return false;
});

// 首次挂载与后端集合刷新时，把 liveSelected 镜像到 draft，让复选框一开始就显示正确状态；
// 用户手动改过（hasUserDraft=true）时不覆盖草稿。
watch(
  liveSelected,
  (sel) => {
    if (!hasUserDraft.value) {
      draft.value = new Set(sel);
    }
  },
  { immediate: true },
);

/** 渲染勾选态用哪一份集合：有本地改动看草稿，否则看后端 */
const activeSet = computed(() => (hasUserDraft.value ? draft.value : liveSelected.value));

function markDirty() {
  hasUserDraft.value = true;
}

function resetDraft() {
  hasUserDraft.value = false;
  draft.value = new Set(liveSelected.value);
}

// 后端集合追平本地草稿（isDirty 转假）时自动解锁同步：
// 用于 applyEdit 的乐观态——发出 select-file 后，先保留草稿显示为用户刚提交的集合，
// 等 aria2 生效、下一轮轮询让 liveSelected 追平，此时才把 hasUserDraft 转回 false。
watch(isDirty, (dirty) => {
  if (!dirty) {
    hasUserDraft.value = false;
  }
});

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

/**
 * 折叠坐标系 key：目录用其在种子里的相对路径前缀（buildVirtualFileTree 里 node.path 已是该值），
 * 文件用 relativePath/fileName —— 两者同一坐标系，折叠匹配才能命中（旧实现目录用相对、文件用绝对，
 * 前缀永远不匹配，导致折叠只是把 +/- 变了、子文件却没收起）。
 */
function collapseKeyOf(node) {
  if (node.type === 'dir') {
    return node.path;
  }
  const rel = node.relativePath || '';
  return rel ? `${rel}/${node.fileName}` : node.fileName;
}

/** 某目录（collapseKey 即其相对路径前缀）下的所有文件（含子目录）：目录勾选/预设等偶发操作用 */
function filesUnder(dirPath) {
  return fileNodes.value.filter((file) => {
    const rel = file.relativePath || '';
    return dirPath === '' || rel === dirPath || rel.startsWith(`${dirPath}/`);
  });
}

/** 摊平后的可见行：尊重折叠，目录与文件混排，携带 checked/indeterminate 供渲染 */
const visibleRows = computed(() => {
  const rows = [];
  const selected = activeSet.value;
  const hidden = Object.entries(collapsed)
    .filter(([, value]) => value)
    .map(([path]) => path);
  const isHidden = (key) => hidden.some((prefix) => key.startsWith(`${prefix}/`));

  for (const node of props.task.files) {
    const collapseKey = collapseKeyOf(node);
    if (isHidden(collapseKey)) {
      continue;
    }
    if (node.type === 'dir') {
      const stat = dirStats.value.get(node.path) ?? { total: 0, selected: 0 };
      rows.push({
        key: `dir:${collapseKey}`, isDir: true, collapseKey, tooltip: node.path,
        name: node.fileName, level: node.level,
        length: node.length, percent: node.completePercent,
        checked: stat.total > 0 && stat.selected === stat.total,
        indeterminate: stat.selected > 0 && stat.selected < stat.total,
      });
    } else {
      rows.push({
        key: `file:${node.index}`, isDir: false, collapseKey, tooltip: node.path,
        name: node.fileName, level: node.level,
        length: node.length, percent: node.completePercent,
        checked: selected.has(node.index),
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

function applyEdit() {
  if (!canApply.value) {
    return;
  }
  const sent = new Set(draft.value);
  emit('apply', [...sent].sort((a, b) => a - b));
  // 乐观保留：draft 维持用户刚提交的集合，hasUserDraft 保持 true，
  // 等轮询让 liveSelected 追平后由上面的 watch(isDirty) 自动解锁同步。
  draft.value = sent;
}

function cancelDraft() {
  resetDraft();
}

/** 把一批文件设为 value（勾选/取消都不再区分是否已下载） */
function setDraft(targets, value) {
  const next = new Set(draft.value);
  for (const file of targets) {
    if (value) {
      next.add(file.index);
    } else {
      next.delete(file.index);
    }
  }
  draft.value = next;
  markDirty();
}

function onToggle(row, value) {
  if (!canEdit.value) {
    return;
  }
  if (row.isDir) {
    setDraft(filesUnder(row.collapseKey), value);
  } else if (row.index !== undefined) {
    const file = fileNodes.value.find((item) => item.index === row.index);
    if (file) {
      setDraft([file], value);
    }
  }
}

/** 预设：all 全选中；none 全清空；invert 翻转 */
function applyPreset(mode) {
  if (!canEdit.value) {
    return;
  }
  const next = new Set();
  for (const file of fileNodes.value) {
    if (mode === 'all') {
      next.add(file.index);
    } else if (mode === 'invert' && !draft.value.has(file.index)) {
      next.add(file.index);
    }
    // mode === 'none'：什么都不加
  }
  draft.value = next;
  markDirty();
}
</script>

<template lang="pug">
.flex.flex-col.gap-2.h-full
  // ---------- 工具条：可编辑任务一律展示预设；有本地改动时右侧追加「取消 / 确定」草稿条 ----------
  .flex.items-center.gap-2.flex-wrap(v-if="canEdit")
    n-button(size="small" @click="applyPreset('all')") {{ t('task.files.select-all') }}
    n-button(size="small" @click="applyPreset('none')") {{ t('task.files.select-none') }}
    n-button(size="small" @click="applyPreset('invert')") {{ t('task.files.select-invert') }}
    template(v-if="isDirty")
      span(class="text-[12px] text-[#d03050]" v-if="!canApply") {{ t('task.files.none-selected') }}
      span(class="text-[12px] text-[#d03050]" v-else-if="willRestart") {{ t('task.files.restart-tip') }}
      .grow.shrink
      n-button(size="small" @click="cancelDraft") {{ t('task.confirm.negative') }}
      n-button(size="primary" small :disabled="!canApply" @click="applyEdit") {{ t('task.files.confirm') }}

  // ---------- 表头（非虚拟，固定）：名字列已含缩进/折叠/复选框，故只剩三列 ----------
  div(class="grid grid-cols-[minmax(0,1fr)_180px_110px] items-center gap-[10px] px-[10px] text-[13px] font-semibold opacity-70 border-b border-[#808080]/20")
    div {{ t('task.files.name') }}
    div {{ t('task.field.progress') }}
    div(class="text-right") {{ t('task.field.size') }}

  // ---------- 虚拟列表主体：只渲染视口内行 ----------
  n-virtual-list(v-if="visibleRows.length" :items="visibleRows" :item-size="ROW_H" :style="listStyle")
    template(#default="{ item: row, index }")
      div(
        class="grid grid-cols-[minmax(0,1fr)_180px_110px] items-center gap-[10px] px-[10px] text-[13px] border-b border-[#808080]/10"
        :class="{ 'font-semibold': row.isDir, 'bg-[#808080]/5': index % 2 === 1 }"
        :style="{ height: ROW_H + 'px' }"
      )
        // 名字列：整条按 level 缩进 → 折叠按钮(目录)/同宽占位(文件) → 复选框紧贴名字
        div(class="flex items-center min-w-0" :style="{ paddingLeft: `${row.level * 16}px` }")
          button(
            v-if="row.isDir"
            type="button"
            class="w-[22px] h-[22px] shrink-0 inline-flex items-center justify-center border-none bg-transparent p-0 rounded text-[#2080f0] cursor-pointer hover:bg-[#2080f0]/12"
            @click="toggleDir(row.collapseKey)"
          )
            n-icon(:component="collapsed[row.collapseKey] ? ChevronForward : ChevronDown" :size="18")
          span(v-else class="w-[22px] h-[22px] shrink-0")
          n-checkbox(
            class="shrink-0 ml-1"
            :checked="row.checked"
            :indeterminate="Boolean(row.indeterminate)"
            :disabled="!canEdit"
            @update:checked="(value) => onToggle(row, value)"
          )
          n-tooltip(:show-arrow="false" trigger="hover")
            template(#trigger)
              span(class="flex-1 min-w-0 truncate ml-2") {{ row.name }}
            span {{ row.tooltip }}
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
