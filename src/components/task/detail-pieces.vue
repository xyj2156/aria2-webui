<script setup>
/**
 * 分片图 tab：图例计数 + 方块图。是否显示该 tab 由详情页按分片数量阈值决定，本组件不自查。
 */
import { computed } from 'vue';
import { t } from '@/i18n/index.js';
import PieceMap from '@/components/pieces/piece-map.vue';
import { getPieceStatus } from '@/utils/bitfield.js';

const props = defineProps({
  bitField: { type: String, default: '' },
  numPieces: { type: Number, default: 0 },
});

const completedCount = computed(() => getPieceStatus(props.bitField, props.numPieces).filter(Boolean).length);
</script>

<template lang="pug">
.flex.flex-col.gap-3
  .legend
    span.legend-item
      i.piece-done
      | {{ t('task.pieces.completed') }}: {{ completedCount }}
    span.legend-item
      i.piece-todo
      | {{ t('task.pieces.uncompleted') }}: {{ numPieces - completedCount }}
    span.legend-count {{ t('task.pieces.info', { completed: completedCount, total: numPieces }) }}
  piece-map(:bit-field="bitField" :piece-count="numPieces")
</template>

<style scoped>
.legend {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  opacity: 0.75;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend-count {
  margin-left: auto;
}
.piece-done,
.piece-todo {
  width: 10px;
  height: 10px;
  border: 1px solid #a3c644;
  background: #b8dd69;
}
.piece-todo {
  border-color: #d0d0d0;
  background: #f0f0f0;
}
:global(html.dark) .piece-done {
  border-color: #6f9a2a;
  background: #8fbc3f;
}
:global(html.dark) .piece-todo {
  border-color: #3a3a3a;
  background: #242424;
}
</style>
