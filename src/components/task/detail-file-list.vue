<script setup>
/**
 * 任务详情页文件列表（块 10 §3）。两种形态：扁平（一行一文件）与多目录树
 * （06 构好的节点数组，按 level 缩进、目录三态勾选）。
 *
 * choose 模式维护本地草稿，Confirm 时把选中文件下标交回父层写 select-file；
 * 非 choose 模式下单击勾选直接上抛，由父层即时应用。
 *
 * 说明：project 里的「按类型/扩展名批量选」和「表头右键排序」依赖 file-types 服务与
 * display-order 存储（属块 08/07 基建），详情页暂缓，此处按 aria2 原始文件序展示。
 */
import { computed, reactive, ref, watch } from 'vue';
import { t } from '@/i18n/index.js';
import { formatPercent, formatVolume } from '@/utils/format.js';

const props = defineProps({
  task: { type: Object, required: true },
  chooseMode: { type: Boolean, default: false },
});

const emit = defineEmits(['toggle', 'confirm', 'cancel']);

const collapsed = reactive({});
const draft = ref(new Set());

const isTree = computed(
  () => props.task.isMultiFileBT && props.task.files.some((file) => file.type === 'dir'),
);
const fileNodes = computed(() => props.task.files.filter((file) => file.type !== 'dir'));

function nodePath(node) {
  if (node.type === 'dir') {
    return node.relativePath ? `${node.relativePath}/${node.fileName}` : node.fileName;
  }
  return node.path;
}

/** 某目录下的所有文件（按 relativePath 前缀匹配） */
function filesUnder(dirPath) {
  return fileNodes.value.filter((file) =>
    dirPath === '' ? true : file.relativePath === dirPath || file.relativePath.startsWith(`${dirPath}/`),
  );
}

function indexSelected(index) {
  const node = props.task.files.find((file) => file.index === index && file.type !== 'dir');
  return Boolean(node?.selected);
}
function isChecked(index) {
  return props.chooseMode ? draft.value.has(index) : indexSelected(index);
}

const visibleRows = computed(() => {
  const rows = [];
  const hidden = Object.entries(collapsed)
    .filter(([, value]) => value)
    .map(([path]) => path);
  const isUnder = (child, prefix) => child.startsWith(`${prefix}/`);

  for (const node of props.task.files) {
    const isDir = node.type === 'dir';
    const path = nodePath(node);
    if (hidden.some((prefix) => isUnder(path, prefix))) {
      continue;
    }
    if (isDir) {
      const under = filesUnder(path);
      const selectedCount = under.filter((file) => isChecked(file.index)).length;
      rows.push({
        key: `dir:${path}`, isDir: true, path, name: node.fileName, level: node.level,
        length: node.length, percent: node.completePercent,
        checked: under.length > 0 && selectedCount === under.length,
        indeterminate: selectedCount > 0 && selectedCount < under.length,
      });
    } else {
      rows.push({
        key: `file:${node.index}`, isDir: false, path, name: node.fileName, level: node.level,
        length: node.length, percent: node.completePercent, checked: isChecked(node.index), index: node.index,
      });
    }
  }
  return rows;
});

watch(
  () => props.chooseMode,
  (active) => {
    if (active) {
      draft.value = new Set(fileNodes.value.filter((file) => file.selected).map((file) => file.index));
    }
  },
  { immediate: true },
);

function toggleDir(path) {
  collapsed[path] = !collapsed[path];
}

function setDraft(indexes, value) {
  const next = new Set(draft.value);
  for (const index of indexes) {
    if (value) {
      next.add(index);
    } else {
      next.delete(index);
    }
  }
  draft.value = next;
}

function onToggle(row, value) {
  if (row.isDir) {
    const targets = filesUnder(row.path).map((file) => file.index);
    if (props.chooseMode) {
      setDraft(targets, value);
    } else {
      emit('toggle', targets, value);
    }
    return;
  }
  if (row.index === undefined) {
    return;
  }
  if (props.chooseMode) {
    setDraft([row.index], value);
  } else {
    emit('toggle', [row.index], value);
  }
}

function applyPreset(mode) {
  const next = new Set();
  for (const file of fileNodes.value) {
    if (mode === 'all') {
      next.add(file.index);
    } else if (mode === 'none') {
      // 全不选
    } else if (!draft.value.has(file.index)) {
      next.add(file.index);
    }
  }
  draft.value = next;
}

function confirm() {
  emit('confirm', [...draft.value]);
}
</script>

<template lang="pug">
.flex.flex-col.gap-2
  // 选择模式的工具条
  .flex.items-center.gap-2(v-if="chooseMode")
    n-button(size="small" @click="applyPreset('all')") {{ t('task.files.select-all') }}
    n-button(size="small" @click="applyPreset('none')") {{ t('task.files.select-none') }}
    n-button(size="small" @click="applyPreset('reverse')") {{ t('task.files.select-invert') }}
    .grow
    n-button(size="small" @click="emit('cancel')") {{ t('task.confirm.negative') }}
    n-button(size="small" type="primary" @click="confirm") {{ t('task.files.confirm') }}

  table.file-table
    thead
      tr
        th.col-check
        th {{ t('task.files.name') }}
        th.col-progress {{ t('task.field.progress') }}
        th.col-size {{ t('task.field.size') }}
    tbody
      tr(v-for="row in visibleRows" :key="row.key" :class="{ 'is-dir': row.isDir }")
        td.col-check
          n-checkbox(
            :checked="row.checked"
            :indeterminate="Boolean(row.indeterminate)"
            @update:checked="(value) => onToggle(row, value)"
          )
        td.min-w-0
          span(:style="{ display: 'inline-block', width: `${row.level * 16}px` }")
          button.dir-toggle(v-if="row.isDir" type="button" @click="toggleDir(row.path)") {{ collapsed[row.path] ? '+' : '-' }}
          span.file-name(:title="row.name") {{ row.name }}
        td.col-progress
          .file-progress
            n-progress(
              type="line"
              :percentage="row.percent"
              :height="6"
              :border-radius="3"
              :show-indicator="false"
            )
            span {{ formatPercent(row.percent) }}
        td.col-size {{ formatVolume(row.length, { fractionSize: 'auto' }) }}
</template>

<style scoped>
.file-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.file-table th,
.file-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.file-table thead th {
  font-weight: 600;
  opacity: 0.7;
}
.file-table tbody tr:nth-child(odd) {
  background: rgba(128, 128, 128, 0.05);
}
.is-dir td {
  font-weight: 600;
}
.col-check {
  width: 32px;
}
.col-progress {
  width: 180px;
}
.col-size {
  width: 110px;
  text-align: right;
}
.dir-toggle {
  width: 18px;
  margin-right: 4px;
  border: none;
  background: transparent;
  color: #2080f0;
  cursor: pointer;
}
.file-name {
  display: inline-block;
  max-width: 100%;
  vertical-align: bottom;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-progress :deep(.n-progress) {
  flex: 1;
}
</style>
