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
  table.peer-table(v-if="peers.length")
    thead
      tr
        th {{ t('task.peers.address') }}
        th {{ t('task.peers.client') }}
        th {{ t('task.peers.status') }}
        th {{ t('task.peers.download') }}
        th {{ t('task.peers.upload') }}
    tbody
      tr(v-for="peer in peers" :key="peer.name")
        td
          span {{ peer.name }}
          span.seed-badge(v-if="peer.seeder") {{ t('task.status.seeding') }}
        td {{ peer.clientName }}
        td
          .peer-progress
            piece-bar(:bit-field="peer.bitfield" :piece-count="numPieces" :height="6")
            span {{ formatPercent(peer.completePercent) }}
        td {{ formatSpeed(peer.downloadSpeed) }}
        td {{ formatSpeed(peer.uploadSpeed) }}

  n-empty.mt-6(v-else :description="t('task.peers.empty')")
</template>

<style scoped>
.peer-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.peer-table th,
.peer-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.peer-table thead th {
  font-weight: 600;
  opacity: 0.7;
}
.peer-table tbody tr:nth-child(odd) {
  background: rgba(128, 128, 128, 0.05);
}
.seed-badge {
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 11px;
  color: #fff;
  background: #18a058;
}
.peer-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.peer-progress :deep(.piece-bar) {
  width: 120px;
}
</style>
