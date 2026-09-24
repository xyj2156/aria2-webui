<script setup>
/**
 * BT 邻居列表 tab：地址 / 客户端 / 迷你分片进度 / 上下行速度。
 * peer 的加工（客户端识别、上下行语义互换）在 task-service 的 processBtPeers，这里只渲染。
 * project 的表头右键排序依赖 display-order 存储（块 08/07 基建），详情页暂缓，此处按原序展示。
 */
import { t } from '@/i18n/index.js';
import PieceBar from '@/components/pieces/piece-bar.vue';
import { formatPercent, formatSpeed } from '@/utils/format.js';

defineProps({
  peers: { type: Array, default: () => [] },
  numPieces: { type: Number, default: 0 },
});
</script>

<template lang="pug">
div
  table(v-if="peers.length" class="w-full border-collapse text-[13px]")
    thead
      tr
        th(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15 font-semibold opacity-70") {{ t('task.peers.address') }}
        th(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15 font-semibold opacity-70") {{ t('task.peers.client') }}
        th(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15 font-semibold opacity-70") {{ t('task.peers.status') }}
        th(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15 font-semibold opacity-70") {{ t('task.peers.download') }}
        th(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15 font-semibold opacity-70") {{ t('task.peers.upload') }}
    tbody
      tr(v-for="peer in peers" :key="peer.name" class="odd:bg-[#808080]/5")
        td(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15")
          span {{ peer.name }}
          span(v-if="peer.seeder" class="ml-1.5 px-2 py-0 rounded-[10px] text-[11px] text-white bg-[#18a058]") {{ t('task.status.seeding') }}
        td(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15") {{ peer.clientName }}
        td(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15")
          div(class="flex items-center gap-2")
            piece-bar(class="!w-[120px]" :bit-field="peer.bitfield" :piece-count="numPieces" :height="6")
            span {{ formatPercent(peer.completePercent) }}
        td(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15") {{ formatSpeed(peer.downloadSpeed) }}
        td(class="px-2.5 py-1.5 text-left border-b border-[#808080]/15") {{ formatSpeed(peer.uploadSpeed) }}

  n-empty.mt-6(v-else :description="t('task.peers.empty')")
</template>
