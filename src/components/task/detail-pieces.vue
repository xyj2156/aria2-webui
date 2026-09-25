<script setup>
/**
 * 分片图 tab：图例计数 + 可视化。是否显示该 tab 由详情页按「分片数 ≤ 设置阈值」决定。
 * 可视化按数量自适应：小数量用方块图（piece-map，每片一个 DOM，直观）；
 * 超过方块图 DOM 安全上限时切画布进度条（piece-bar，连续同段 fillRect，承载任意片数不卡）。
 */
import { computed } from 'vue';
import { t } from '@/i18n/index.js';
import PieceBar from '@/components/pieces/piece-bar.vue';
import PieceMap from '@/components/pieces/piece-map.vue';
import { getPieceStatus } from '@/utils/bitfield.js';

const props = defineProps({
  bitField: { type: String, default: '' },
  numPieces: { type: Number, default: 0 },
});

/** 方块图每片一个 <i>，仅在小数量时用；超过则切画布，避免上万 DOM 节点卡顿。 */
const MAP_DOM_CAP = 4000;
const useMap = computed(() => props.numPieces > 0 && props.numPieces <= MAP_DOM_CAP);

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
  piece-map(v-if="useMap" :bit-field="bitField" :piece-count="numPieces")
  piece-bar(v-else :bit-field="bitField" :piece-count="numPieces")
</template>
