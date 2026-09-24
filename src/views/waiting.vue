<script setup>
// 占位页：等待列表页做完后替换。此处仅保证侧栏菜单点进来有落点、不报路由错。
import { t } from '@/i18n/index.js';
import {getWaitingTasks} from "@/rpc/index.js";

getWaitingTasks().then(function (result) {
  console.log(result);
});
</script>

<template lang="pug">
  .h-full.flex-center
    n-empty(:description="t('menu.waiting')")
</template>
