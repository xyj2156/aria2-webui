<script setup>
import {onConnectionChange} from '@/rpc'

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
