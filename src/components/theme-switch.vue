<script setup>
// 主题切换按钮 + element-plus 官网同款圆形换肤动画。
// 状态来自 @/composables/useThemeMode 的单例 isDark（layout 的 :theme 也读同一个）。
//
// 换肤动画刻意用「CSS style 形式」而非 JS documentElement.animate()：
// JS 只做两件事——把圆心/半径写进三个 CSS 自定义属性、在 startViewTransition 回调里切
// html.dark；真正的 clip-path 圆形揭示完全声明在下方 <style> 的 @keyframes 里，
// 图层顺序也由 html.dark 决定。JS 全程不碰任何「翻层类」，因此连点不会残留脏类，
// 也就不会出现「上一次动画的临时类破坏这一次过渡」那类时序问题。
import { nextTick } from 'vue';
import { MoonOutline, SunnyOutline } from '@vicons/ionicons5';

import { t } from '@/i18n/index.js';
import { isDark, toggleDark } from '@/composables/use-theme-mode.js';

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
    toggleDark();
    return;
  }

  // 回调里切主题并 await nextTick，让 Vue 把 Naive 配色重渲染完，截到的新快照才是完整配色
  root.startViewTransition(async () => {
    toggleDark();
    await nextTick();
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
