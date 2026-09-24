<script setup>
import { GlobeOutline } from '@vicons/ionicons5';
import { computed } from 'vue';

import { useI18n } from '@/i18n/index.js';

const { locale, localeOptions, setLocale, t } = useI18n();

// 按钮上显示的是「当前语言的母语自称」，不是翻译后的文案，
// 所以直接从选项里取 label，不要过 t()
const currentLabel = computed(
    () => localeOptions.value.find((item) => item.key === locale.value)?.label ?? locale.value,
);
</script>

<template lang="pug">
  n-dropdown(
    trigger="click"
    :options="localeOptions"
    :value="locale"
    @select="setLocale"
  )
    n-button(text :title="t('lang.label')")
      n-icon(:component="GlobeOutline" :size="16")
      span.ml-1 {{ currentLabel }}
</template>
