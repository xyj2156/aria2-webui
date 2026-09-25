<script setup>
import { onConnectionChange } from '@/rpc';
import { useThemeSync } from '@/composables/use-theme-sync.js';
import { useLanguageSync } from '@/composables/use-language-sync.js';

// 主题 / 语言都以设置 store 为单一事实源，启动即同步到 isDark 与 i18n（各应用一次即可）
useThemeSync();
useLanguageSync();

// 尝试连接
const connectionStore = useConnectionStore();
connectionStore.setActive(connectionStore.activeId);

onConnectionChange(function (status) {
  console.log('connection change', status);
});
</script>

<template lang="pug">
router-view
</template>
