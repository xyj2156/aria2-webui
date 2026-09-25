<script setup>
/**
 * 顶栏「连接 / 全局速率」指示器，同时是启动探测的执行者。
 *
 * 显示：
 *   已连接 → 绿点 + 并排「↓ 下载速率  ↑ 上传速率」；hover 看任务计数。
 *   未连接 → 红/橙告警图标 + 对应状态文案（未连接 / 连接中 / 重连中 / 连接异常）。
 *
 * 探测：挂载时、以及切换当前连接（activeId 变化）时各发一次 aria2.getVersion——
 *   成功弹「已连接」，失败弹「连接失败：原因」。
 *   HTTP 通道没有持久连接、状态只在一次调用成功后才点亮（见 rpc/transport-http.js），
 *   所以这次主动探测既能提示用户连通性，也顺带把状态机推起来、让顶栏轮询开始工作；
 *   WS 通道同样适用（探测即触发连接）。
 *
 * 速率数据本身来自 use-global-status 的共享快照（它按设置里的间隔轮询 getGlobalStat）；
 * 本组件只负责展示与一次性连通性探测，不自己起轮询。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { AlertCircleOutline } from '@vicons/ionicons5';

import { t } from '@/i18n/index.js';
import { getAria2Version } from '@/rpc';
import { formatSpeed } from '@/utils/format.js';
import { useConnectionStore } from '@/store/connections.js';
import { globalStat } from '@/composables/use-global-status.js';

const message = useMessage();
const connections = useConnectionStore();

/** 最近一次探测的失败原因，用于 hover 详情 */
const lastError = ref('');
let probing = false;

async function probe() {
  if (probing) {
    return;
  }
  probing = true;
  lastError.value = '';
  try {
    await getAria2Version();
    message.success(t('connection.test.success'));
  } catch (e) {
    lastError.value = e?.message || String(e);
    message.error(`${t('connection.test.failed')}：${lastError.value}`, { duration: 5000 });
  } finally {
    probing = false;
  }
}

// 上来就探测；之后每次切换当前连接都重新探测并提示
onMounted(probe);
watch(() => connections.activeId, probe);

const statusLabel = computed(() => t(`connection.status.${globalStat.status}`));
// 未连接态：connecting / reconnecting 用警告色，其余（idle / error）用危险红
const offlineColor = computed(() =>
  globalStat.status === 'connecting' || globalStat.status === 'reconnecting' ? '#f0a020' : '#d03050',
);

const tooltip = computed(() =>
  globalStat.connected
    ? `${t('webui.stat.downloading')}: ${globalStat.downloading}  ${t('webui.stat.upload')}: ${formatSpeed(globalStat.uploadSpeed)}`
    : (lastError.value || statusLabel.value),
);
</script>

<template lang="pug">
n-tooltip(trigger="hover" :show-arrow="false")
  template(#trigger)
    span.cursor-default.flex.items-center.gap-2(class="text-[13px]")
      template(v-if="globalStat.connected")
        span.w-2.h-2.rounded-full(class="bg-[#18a058]")
        span.tabular-nums ↓ {{ formatSpeed(globalStat.downloadSpeed) }}
        span.tabular-nums ↑ {{ formatSpeed(globalStat.uploadSpeed) }}
      template(v-else)
        n-icon(:component="AlertCircleOutline" :size="15" :style="{ color: offlineColor }")
        span(:style="{ color: offlineColor }") {{ statusLabel }}
  | {{ tooltip }}
</template>
