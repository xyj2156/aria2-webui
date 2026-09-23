<script setup>
// 占位页：已停止列表页做完后替换。
import { t } from '@/i18n/index.js';
</script>

<template lang="pug">
  .h-full.flex-center
    n-empty(:description="t('menu.stopped')")
</template>
