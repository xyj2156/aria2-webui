<script setup>
import { t } from '@/i18n';
import {getAria2Version} from "@/rpc/index.js";
getAria2Version().then(function (result) {
  console.log(result);
})
</script>

<template lang="pug">
  .h-full.flex-center
    n-empty(:description="t('menu.downloading')")
</template>
