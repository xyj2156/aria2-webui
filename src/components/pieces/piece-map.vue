<script setup>
/**
 * 分片方块图（旧 ngPieceMap）：一个格子一个小方块，颜色走作用域 CSS + html.dark 自动切暗色。
 *
 * 一格可以代表多个原始分片（groupSize > 1），这是大分片数下的降 DOM 手段：
 * 3314 片按 4 片一组只画 829 个节点。聚合格的语义是三态——全完成（绿）、部分完成
 * （绿覆盖层按完成比例调透明度）、全未完成（灰），单值信息不丢，比例信息用透明度补上，
 * 具体区间与完成数放在每格的 title 里。
 * pieceCount / groupSize 变化整体重建，bitfield 变化只重算状态。
 */
import { computed } from 'vue';

import { t } from '@/i18n/index.js';
import { getGroupedPieces } from '@/utils/bitfield.js';

const props = defineProps({
  bitField: { type: String, default: '' },
  pieceCount: { type: Number, default: 0 },
  /** 一格代表多少个原始分片；1 = 逐片 */
  groupSize: { type: Number, default: 1 },
});

const cells = computed(() => getGroupedPieces(props.bitField, props.pieceCount, props.groupSize));
const completedCount = computed(() => cells.value.reduce((sum, cell) => sum + cell.completed, 0));
const summary = computed(() => {
  const total = props.pieceCount;
  const pct = total > 0 ? Math.floor((completedCount.value / total) * 100) : 0;
  return `${completedCount.value} / ${total} (${pct}%)`;
});

/** 逐片时给片号 + 状态；聚合时给原始片区间、完成数与比例 */
function cellTitle(cell) {
  if (cell.count === 1) {
    return t('task.pieces.cell-single', {
      index: cell.start + 1,
      state: t(cell.completed ? 'task.pieces.completed' : 'task.pieces.uncompleted'),
    });
  }
  return t('task.pieces.cell-range', {
    start: cell.start + 1,
    end: cell.end,
    done: cell.completed,
    count: cell.count,
    pct: Math.round(cell.ratio * 100),
  });
}
</script>

<template lang="pug">
.piece-map(:title="summary")
  i.piece(
    v-for="cell in cells"
    :key="cell.index"
    :class="{ 'piece--done': cell.ratio === 1, 'piece--partial': cell.ratio > 0 && cell.ratio < 1 }"
    :style="cell.ratio > 0 && cell.ratio < 1 ? { '--ratio': String(cell.ratio) } : undefined"
    :title="cellTitle(cell)"
  )
</template>

<style scoped>
.piece-map {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
}
.piece {
  position: relative;
  width: 10px;
  height: 10px;
  border: 1px solid #d0d0d0;
  background: #f0f0f0;
}
.piece--done {
  border-color: #a3c644;
  background: #b8dd69;
}
/* 部分完成：底色仍是「未完成」，上面叠一层完成色，透明度随完成比例升高——比例可读，又不冒充已完成 */
.piece--partial::after {
  content: '';
  position: absolute;
  inset: 0;
  background: #b8dd69;
  opacity: calc(0.15 + var(--ratio, 0.5) * 0.85);
}
:global(html.dark) .piece {
  border-color: #3a3a3a;
  background: #242424;
}
:global(html.dark) .piece--done {
  border-color: #6f9a2a;
  background: #8fbc3f;
}
:global(html.dark) .piece--partial::after {
  background: #8fbc3f;
}
</style>
