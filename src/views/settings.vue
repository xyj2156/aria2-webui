<script setup>
// 占位页：设置页做完后替换。
import { t } from '@/i18n/index.js';
</script>

<template lang="pug">
  .h-full.flex-center
    n-empty(:description="t('menu.settings')")
</template>
