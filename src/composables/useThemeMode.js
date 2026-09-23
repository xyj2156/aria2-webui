import { useDark, useToggle } from '@vueuse/core';

/**
 * 主题亮/暗状态单例，模块作用域只建一次，全应用共享。
 *
 * 为什么必须集中：useDark 每个调用点各自持有一个 ref 实例，如果在 layout 和切换按钮里分别
 * useDark，一处切换不会同步另一处的 ref（它们各自只认自己的写入 + storage 事件），
 * 结果就是 NConfigProvider 的 :theme 和按钮图标对不上。所以这里建好导出，
 * layout 读 isDark 派生 :theme，ThemeSwitch 读 isDark/toggleDark 做切换与动画。
 */
export const isDark = useDark({ storageKey: 'aria2-webui.theme-dark' });

export const toggleDark = useToggle(isDark);
