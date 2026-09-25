<script setup>
import { GlobeOutline } from '@vicons/ionicons5';
import { computed } from 'vue';

import { useI18n } from '@/i18n/index.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

const { localeOptions, t } = useI18n();
const settings = useWebuiSettingsStore();

// 语言单一事实源：点选只写 store.language，由 use-language-sync 同步到 i18n。
// 按钮上显示的是「当前语言的母语自称」（不过 t()），故从选项里取 label。
const current = computed(() => settings.options.language);
const currentLabel = computed(
    () => localeOptions.value.find((item) => item.key === current.value)?.label ?? current.value,
);

function selectLang(code) {
  settings.set('language', code);
}
</script>

<template lang="pug">
  n-dropdown(
    trigger="click"
    :options="localeOptions"
    :value="current"
    @select="selectLang"
  )
    n-button(text :title="t('lang.label')")
      n-icon(:component="GlobeOutline" :size="16")
      span.ml-1 {{ currentLabel }}
</template>
