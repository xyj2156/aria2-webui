<script setup>
/**
 * WebUI 设置页的一行：左侧标签（可选说明气泡、可选「需重载」标记）+ 右侧控件插槽。
 *
 * 版式对齐 aria2 设置页（components/setting/setting-item.vue 的 .form-row）——同样左标签固定宽、
 * 右控件、行间分隔线，保持两页观感一致。与 setting-item 的区别：setting-item 承载 aria2 选项的
 * RPC 读写状态机；本组件是纯展示容器，控件与写入都由调用方（webui-settings 视图）提供。
 * 所有样式走 UnoCSS 原子类；含任意值（[]、#、小数）的类经 class 属性传入（pug 简写不承载这些字符）。
 */
import { computed } from 'vue';
import { HelpCircleOutline } from '@vicons/ionicons5';
import { t } from '@/i18n/index.js';

const props = defineProps({
  /** 标签文案（已翻译好的字符串） */
  label: { type: String, default: '' },
  /** 说明文案键；传了才渲染问号气泡 */
  descriptionKey: { type: String, default: '' },
  /** 「改后需整页重载才生效」的行内提示 */
  needsReload: { type: Boolean, default: false },
});

const descriptionText = computed(() =>
  props.descriptionKey ? t(props.descriptionKey) : '',
);
</script>

<template lang="pug">
.flex.items-center.gap-3.px-3.py-2.border-b(class="border-[#808080]/12")
  .shrink-0(class="w-[240px]")
    .flex.items-center.flex-wrap(class="gap-1.5")
      span.font-semibold(class="text-[13px]") {{ props.label }}
      n-tooltip(v-if="descriptionText" class="inline-flex cursor-help" trigger="hover" :show-arrow="false")
        template(#trigger)
          n-icon(:component="HelpCircleOutline" :size="14")
        .leading-normal(class="max-w-[320px] text-[12px]") {{ descriptionText }}
  .flex.items-center.flex-1.flex-wrap(class="gap-1.5")
    slot
    span(v-if="props.needsReload" class="text-[12px] text-[#f0a020]") {{ t('webui.setting.reload-hint') }}
</template>
