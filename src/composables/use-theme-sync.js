/**
 * 主题单一事实源同步：以 WebUI 设置 store 的 `theme`（light / dark / system）为准，
 * 单向把结果应用到 use-theme-mode 的 isDark（layout 的 :theme、换肤动画都读 isDark）。
 *
 * - 启动即应用一次（immediate），保证刷新后按存储的主题渲染；
 * - store.theme 变化时再应用（设置页主题行、ThemeSwitch 都只写 store.theme，不再各自切 isDark）；
 * - theme=system 时跟随系统 prefers-color-scheme，并监听其变化。
 *
 * 只在应用根（main.vue）调用一次；多处调用会重复挂 watcher，不必要。
 */
import { watch } from 'vue';

import { isDark } from '@/composables/use-theme-mode.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

export function useThemeSync() {
  const settings = useWebuiSettingsStore();
  const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;

  /** 把 theme 值换算成 isDark（system 走系统偏好，异常时回落亮色） */
  function applyTheme(theme) {
    if (theme === 'system') {
      isDark.value = media?.matches ?? false;
      return;
    }
    isDark.value = theme === 'dark';
  }

  // theme 是唯一写入点：监听它即可，反向不监听 isDark，避免回环。
  watch(() => settings.options.theme, (theme) => applyTheme(theme), { immediate: true });

  // 系统偏好变化时，仅当处于 system 模式才跟随。
  if (media?.addEventListener) {
    media.addEventListener('change', (event) => {
      if (settings.options.theme === 'system') {
        isDark.value = event.matches;
      }
    });
  }

  /** 亮/暗二值翻转（退出 system 语义，落到显式 light/dark 后写回 store）。 */
  function toggleTheme() {
    settings.set('theme', isDark.value ? 'light' : 'dark');
  }

  return { toggleTheme, applyTheme };
}
