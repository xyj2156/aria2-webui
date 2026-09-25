<script setup>
// 主题切换按钮 + element-plus 官网同款圆形换肤动画。
// 状态是「单一事实源」：点击只写设置 store 的 theme（light/dark），isDark 由 @/composables/use-theme-sync
// 的监听器统一应用（layout 的 :theme 与图标都读 isDark）。这样顶栏按钮与 WebUI 设置页的主题行永远同步。
//
// 换肤动画刻意用「CSS style 形式」而非 JS documentElement.animate()：
// JS 只做两件事——把圆心/半径写进三个 CSS 自定义属性、在 startViewTransition 回调里改 theme；
// 真正的 clip-path 圆形揭示完全声明在下方 <style> 的 @keyframes 里，
// 图层顺序也由 html.dark 决定。JS 全程不碰任何「翻层类」，因此连点不会残留脏类，
// 也就不会出现「上一次动画的临时类破坏这一次过渡」那类时序问题。
import { nextTick } from 'vue';
import { MoonOutline, SunnyOutline } from '@vicons/ionicons5';

import { t } from '@/i18n/index.js';
import { isDark } from '@/composables/use-theme-mode.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

const settings = useWebuiSettingsStore();

/** 写 store：亮↔暗二值翻转（当前是暗→写 light，否则写 dark；system 也按实际明暗翻转） */
function flipTheme() {
  settings.set('theme', isDark.value ? 'light' : 'dark');
}

function handleClick(event) {
  const { clientX, clientY } = event;
  const root = document.documentElement;

  // 半径取点击点到屏幕最远角的距离，保证圆形一定能盖满整个视口
  const radius = Math.hypot(
      Math.max(clientX, window.innerWidth - clientX),
      Math.max(clientY, window.innerHeight - clientY),
  );
  root.style.setProperty('--vt-cx', `${clientX}px`);
  root.style.setProperty('--vt-cy', `${clientY}px`);
  root.style.setProperty('--vt-cr', `${radius}px`);

  // 不支持 View Transitions（Safari / 旧内核）→ 直接切，无动画，不卡住
  if (typeof root.startViewTransition !== 'function') {
    flipTheme();
    return;
  }

  // 回调里改 theme 并 await nextTick，让同步监听器把 isDark 落到 html.dark、Vue 把 Naive 配色重渲染完，
  // 截到的新快照才是完整配色。
  // 期间临时挂 transitions-disabled，掐掉 Naive 组件自带的 ~300ms 颜色过渡——否则它会与这条
  // 450ms 圆形揭示抢拍（新快照停在半淡状态、VT 结束后再淡一次），观感上就是「时长不一致」。
  root.startViewTransition(async () => {
    root.classList.add('transitions-disabled');
    flipTheme();
    await nextTick();
    // 新快照已按无过渡定格终色；恢复交互过渡（hover 等）。浏览器在本 promise resolve 后截新快照
    root.classList.remove('transitions-disabled');
  });
}
</script>

<template lang="pug">
  n-button(text circle :title="t('theme.toggle')" @click="handleClick")
    n-icon(:component="isDark ? SunnyOutline : MoonOutline" :size="18")
</template>

<style>
/* 换肤动画参数：时长 + 圆心/半径兜底值（每次点击 JS 会覆盖 --vt-cx/cy/cr）。
   写在 :root 上，::view-transition 伪元素会继承到这些自定义属性。 */
:root {
  --vt-dur: 450ms;
  --vt-cx: 50vw;
  --vt-cy: 50vh;
  --vt-cr: 150vmax;
}

/* 根底色跟随主题：过渡层被裁掉的区域露出的是主题色，而不是浏览器默认白（防收尾白闪）。 */
html {
  background-color: #fff;
}

html.dark {
  background-color: #18181c;
}

/* 换肤期间挂到 <html>：掐掉一切 CSS 过渡（含 Naive 组件自带的 ~300ms 颜色过渡），
   让新快照无过渡定格终色，屏幕上只剩下面声明的 450ms 圆形揭示这一条动画。 */
.transitions-disabled,
.transitions-disabled *,
.transitions-disabled *::before,
.transitions-disabled *::after {
  transition: none !important;
}

/* 关掉浏览器默认的整页交叉淡入淡出，只跑下面声明的 clip-path 圆形揭示 */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

/* 圆形揭示关键帧：圆心/半径从 CSS 变量读，由 JS 在点击时写入 */
@keyframes vt-grow {
  from {
    clip-path: circle(0px at var(--vt-cx) var(--vt-cy));
  }
  to {
    clip-path: circle(var(--vt-cr) at var(--vt-cx) var(--vt-cy));
  }
}

@keyframes vt-shrink {
  from {
    clip-path: circle(var(--vt-cr) at var(--vt-cx) var(--vt-cy));
  }
  to {
    clip-path: circle(0px at var(--vt-cx) var(--vt-cy));
  }
}

/* 切到亮色（非 .dark）：新(亮)快照置于上层，从按钮放大揭开 = 扩散照亮。
   `both` 停在末帧（满屏），避免动画结束、伪元素移除前 clip-path 弹回整屏造成闪。 */
::view-transition-new(root) {
  z-index: 1;
  animation: vt-grow var(--vt-dur) ease-in both;
}

::view-transition-old(root) {
  z-index: 0;
}

/* 切到暗色（.dark）：旧(亮)快照提到上层并收缩回按钮 = 亮收回；新(暗)垫底、静态。
   html.dark 前缀特异性更高，覆盖上面的默认层级，方向随主题即时翻转、无需 JS 干预。 */
html.dark::view-transition-old(root) {
  z-index: 1;
  animation: vt-shrink var(--vt-dur) ease-in both;
}

html.dark::view-transition-new(root) {
  z-index: 0;
  animation: none;
}
</style>
