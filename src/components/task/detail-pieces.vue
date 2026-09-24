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
  div(class="flex items-center gap-4 text-[12px] opacity-75")
    span(class="inline-flex items-center gap-[6px]")
      i(class="w-[10px] h-[10px] border border-[#a3c644] bg-[#b8dd69] [.dark_&]:border-[#6f9a2a] [.dark_&]:bg-[#8fbc3f]")
      | {{ t('task.pieces.completed') }}: {{ completedCount }}
    span(class="inline-flex items-center gap-[6px]")
      i(class="w-[10px] h-[10px] border border-[#d0d0d0] bg-[#f0f0f0] [.dark_&]:border-[#3a3a3a] [.dark_&]:bg-[#242424]")
      | {{ t('task.pieces.uncompleted') }}: {{ numPieces - completedCount }}
    span(class="ml-auto") {{ t('task.pieces.info', { completed: completedCount, total: numPieces }) }}
  piece-map(:bit-field="bitField" :piece-count="numPieces")
</template>
