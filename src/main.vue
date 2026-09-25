<script setup>
import { onConnectionChange } from '@/rpc';
import { debugLog } from '@/utils/debug.js';
import { useThemeSync } from '@/composables/use-theme-sync.js';
import { useLanguageSync } from '@/composables/use-language-sync.js';
import { startGlobalStat } from '@/composables/use-global-status.js';
import { startPageTitle } from '@/composables/use-page-title.js';

// 主题 / 语言都以设置 store 为单一事实源，启动即同步到 isDark 与 i18n（各应用一次即可）
useThemeSync();
useLanguageSync();

// 尝试连接
const connectionStore = useConnectionStore();
connectionStore.setActive(connectionStore.activeId);

// 全局下载速率轮询（顶栏常驻，独立于路由；按设置里的全局状态更新间隔起停）
startGlobalStat();

// 页面标题引擎：按 titleRefreshInterval 读缓存速率渲染 document.title（独立于路由，常驻）
startPageTitle();

onConnectionChange(function (status) {
  debugLog('connection change', status);
});
</script>

<template lang="pug">
router-view
</template>
