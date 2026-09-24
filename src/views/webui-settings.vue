<script setup>
import { CloseOutline } from '@vicons/ionicons5';
import { t } from "@/i18n/index.js";

const form = reactive({});
const connections = useConnectionStore();

const protocolOptions = [
  {label: 'ws://', value: 'ws'},
  {label: 'wss://', value: 'wss'},
  {label: 'http://', value: 'http'},
  {label: 'https://', value: 'https'},
];

function addConnection() {
  connections.addConnection()
}
</script>

<template lang="pug">
  n-tabs(type="card" animated addable @add="addConnection")
    n-tab-pane(tab="全局" name="global")
      .flex.items-center.gap-4.p-2
        .p-2(class="w-20% min-w-10% text-right")
          n-text(type="primary" ) 页面标题
        .flex-1
          n-input(v-model="form.title")
    n-tab-pane(v-for="item in connections.connections" :key="item.id" :name="item.id")
      template(#tab)
        .flex.items-center.gap-1
          span {{ item.name }}
          n-popconfirm(
            :positive-text="t('connection.remove.positive')"
            :negative-text="t('connection.remove.negative')"
            @positive-click="() => connections.removeConnection(item.id)"
          )
            template(#trigger)
              n-button(text size="tiny" @click.stop)
                template(#icon)
                  n-icon(:size="14")
                    close-outline
            | {{ t('connection.remove.content') }}
      .flex.items-center.gap-4.p-2
        .p-2(class="w-20% min-w-10% text-right")
          n-text(type="primary") {{ t('connection.name') }}
        .flex-1
          n-input(:value="item.name" @update:value="val => connections.updateConnection(item.id, { name: val })")
      .flex.items-center.gap-4.p-2
        .p-2(class="w-20% min-w-10% text-right")
          n-text(type="primary") 地址
        .flex-1.flex.items-center.gap-1
          n-select(:value="item.protocol" @update:value="val => connections.updateConnection(item.id, { protocol: val })" :options="protocolOptions" style="width: 100px")
          n-input(:value="item.host" @update:value="val => connections.updateConnection(item.id, { host: val })" style="flex: 1")
          span.px-1 :
          n-input-number(:value="item.port" @update:value="val => connections.updateConnection(item.id, { port: val })" :min="1" :max="65534" style="width: 105px")
          n-input(:value="item.path" @update:value="val => connections.updateConnection(item.id, { path: val })" style="flex: 1")
      .flex.items-center.gap-4.p-2
        .p-2(class="w-20% min-w-10% text-right")
          n-text(type="primary") {{ t('connection.secret') }}
        .flex-1
          n-input(type="password" show-password-on="click" :value="item.secret" @update:value="val => connections.updateConnection(item.id, { secret: val })")

</template>