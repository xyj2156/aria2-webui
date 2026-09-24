<script setup>
/**
 * 分片方块图（旧 ngPieceMap）：一个分片一个小方块。颜色走作用域 CSS，
 * 用 html.dark 选择器在暗色下自动切换，不依赖全局变量。
 * pieceCount 变化整体重建，bitfield 变化只重算状态。
 */
import { computed } from 'vue';
import { getPieceStatus } from '@/utils/bitfield.js';

const props = defineProps({
  bitField: { type: String, default: '' },
  pieceCount: { type: Number, default: 0 },
});

const pieces = computed(() => getPieceStatus(props.bitField, props.pieceCount));
const completedCount = computed(() => pieces.value.filter(Boolean).length);
const summary = computed(() => {
  const total = props.pieceCount;
  const pct = total > 0 ? Math.floor((completedCount.value / total) * 100) : 0;
  return `${completedCount.value} / ${total} (${pct}%)`;
});
</script>

<template lang="pug">
.piece-map(:title="summary")
  i.piece(v-for="(completed, index) in pieces" :key="index" :class="{ 'piece--done': completed }")
</template>

<style scoped>
.piece-map {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
}
.piece {
  width: 10px;
  height: 10px;
  border: 1px solid #d0d0d0;
  background: #f0f0f0;
}
.piece--done {
  border-color: #a3c644;
  background: #b8dd69;
}
:global(html.dark) .piece {
  border-color: #3a3a3a;
  background: #242424;
}
:global(html.dark) .piece--done {
  border-color: #6f9a2a;
  background: #8fbc3f;
}
</style>
