import { ref, watch } from 'vue';

/**
 * 主题亮/暗显示态单例，模块作用域只建一次，全应用共享。
 *
 * isDark 只是「显示态」：layout 读它派生 NConfigProvider 的 :theme，theme-switch 读它选图标，
 * 本模块还负责把它镜像到 <html class="dark">（供换肤动画与根底色等 CSS 使用）。
 *
 * 它不再是持久化来源。主题以设置 store 的 theme（light/dark/system）为单一事实源，
 * 由 @/composables/use-theme-sync 监听 store 变化并写入 isDark（ThemeSwitch / 设置页都只改 store.theme）。
 * 因此这里不再用 useDark，也不再往 localStorage 写独立的 theme 键（原 aria2-webui.theme-dark 已废弃清除）。
 */
export const isDark = ref(false);

// 同步到 <html> 的 dark 类；sync flush 让 isDark 一变、类立即翻转，
// 与换肤动画 startViewTransition 回调里的 await nextTick 时序一致。
watch(
  isDark,
  (dark) => {
    document.documentElement.classList.toggle('dark', dark);
  },
  { flush: 'sync', immediate: true },
);
