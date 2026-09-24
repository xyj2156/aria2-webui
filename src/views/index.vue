<script setup>
import { t } from '@/i18n';
import {getDownloadingTasks} from "@/rpc/index.js";
getDownloadingTasks().then(function (result) {
  console.log(result);
})
</script>

<template lang="pug">
  .h-full.flex-center
    n-empty(:description="t('menu.downloading')")
</template>
