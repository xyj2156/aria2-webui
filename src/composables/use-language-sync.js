/**
 * 语言单一事实源同步：以 WebUI 设置 store 的 `language` 为准，单向把结果应用到 i18n 引擎
 * （setLocale 会切当前语言、加载对应文案包并同步 Naive 内置文案）。
 *
 * - 启动即应用一次（immediate），保证刷新后按存储的语言渲染；
 * - store.language 变化时再应用（顶栏语言下拉、设置页语言行都只写 store.language，不再各自 setLocale）。
 *
 * 与 use-theme-sync 同构；只在应用根（main.vue）调用一次。i18n 自身不再持久化语言，
 * 持久化统一在 store（原 aria2-webui.locale 键已废弃清除）。
 */
import { watch } from 'vue';

import { setLocale } from '@/i18n/index.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

export function useLanguageSync() {
  const settings = useWebuiSettingsStore();

  watch(() => settings.options.language, (code) => {
    void setLocale(code);
  }, { immediate: true });
}
