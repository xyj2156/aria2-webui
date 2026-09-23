<script setup>
// 语言只有两条通道：我们自己的文案走 t()（同步，切完立刻生效），
// Naive UI 的内置文案走 NConfigProvider 的 locale / dateLocale（按需加载，
// 首次切到某种语言会晚一个模块下载的节拍，之后再切回来是同步的）。
// 两条都由 i18n 模块的同一个状态驱动，所以这里不写任何切换逻辑，
// 加载中的那一拍 naiveLocale 是 undefined，Naive 会用它自己的默认文案兜底，不会白屏。
//
// 主题的亮/暗状态是单例，放在 @/composables/useThemeMode.js：这里只用它派生 NConfigProvider 的 :theme，
// 切换按钮与换肤动画整体封装在 <ThemeSwitch /> 组件里（自动导入，见 components/ThemeSwitch.vue）。
import { computed, h, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { darkTheme, NIcon } from 'naive-ui';
import {
  BuildOutline,
  CubeOutline,
  DownloadOutline,
  ListOutline,
  SettingsOutline,
  StopCircleOutline,
  TimeOutline,
} from '@vicons/ionicons5';

import { t } from '@/i18n/index.js';
import { naiveDateLocale, naiveLocale } from '@/i18n/naive.js';
import { isDark } from '@/composables/useThemeMode.js';

const route = useRoute();
const router = useRouter();

// 侧栏折叠态：受控绑定，触发条点它时 n-menu 一起收窄成图标条（否则菜单会溢出到 64px 里）
const collapsed = ref(false);

// Naive 内置主题随共享的 isDark 切换（isDark 由 useThemeMode 单例维护）
const theme = computed(() => (isDark.value ? darkTheme : null));

/** 菜单图标：Naive 的 icon 需要一个返回 VNode 的函数，NIcon 在脚本里手动渲染 */
function renderIcon(icon) {
  return () => h(NIcon, null, { default: () => h(icon) });
}

// 折叠态（展开/收缩）：父级带 children 就是可展开子菜单，点父级标题收放。
// 用 ref 受控并初始全展开。侧栏本身折叠（collapsed）时 Naive 把菜单压成图标栏、走悬浮弹层。
const expandedKeys = ref(['group-task', 'group-system']);

// 叶子 key 直接取路由 name，切换时按 name 跳转、按 name 高亮；父级 key 不对应路由、不可选
const menuOptions = computed(() => [
  {
    label: t('menu.group.task'),
    key: 'group-task',
    icon: renderIcon(ListOutline),
    children: [
      { label: t('menu.downloading'), key: 'downloading', icon: renderIcon(DownloadOutline) },
      { label: t('menu.waiting'), key: 'waiting', icon: renderIcon(TimeOutline) },
      { label: t('menu.stopped'), key: 'stopped', icon: renderIcon(StopCircleOutline) },
    ],
  },
  {
    label: t('menu.group.system'),
    key: 'group-system',
    icon: renderIcon(BuildOutline),
    children: [
      { label: t('menu.settings'), key: 'settings', icon: renderIcon(SettingsOutline) },
    ],
  },
]);

const activeKey = computed(() => String(route.name ?? 'downloading'));
const activeLabel = computed(() => t(`menu.${activeKey.value}`));

function handleMenuSelect(key) {
  if (key !== route.name) {
    void router.push({ name: key });
  }
}
</script>

<template lang="pug">
  n-config-provider(:locale="naiveLocale" :date-locale="naiveDateLocale" :theme="theme")
    // has-sider 必须是 prop（写成 .has-sider 会变成 CSS 类、布局退化成上下堆叠）
    n-layout(:has-sider="true" style="height: 100vh")
      n-layout-sider(
        bordered
        collapse-mode="width"
        :width="220"
        :collapsed-width="64"
        :collapsed="collapsed"
        show-trigger
        @collapse="collapsed = true"
        @expand="collapsed = false"
      )
        // 侧栏品牌区：展开=图标块+标题，收缩=只留 logo 图标块。点它切换折叠/展开
        .cursor-pointer.flex.items-center.gap-2.h-14.px-4.overflow-hidden(@click="collapsed = !collapsed")
          .w-8.h-8.rounded-md.flex-center.bg-blue-500.text-white.shrink-0
            n-icon(:component="CubeOutline" :size="18")
          span.font-semibold.truncate(v-if="!collapsed") {{ t('app.name') }}

        // 侧栏菜单：展开=完整分组树；收缩=Naive 按 collapsed-width 压成图标栏（显示分组图标，悬停浮出子项）
        n-menu(
          :options="menuOptions"
          :value="activeKey"
          :collapsed="collapsed"
          :collapsed-width="64"
          :collapsed-icon-size="22"
          v-model:expanded-keys="expandedKeys"
          @update:value="handleMenuSelect"
        )

      n-layout.wh-full
        n-layout-header.bordered
          .flex-x-between.px-4.h-14
            // 顶栏左侧：当前页标题，给 header 一个实际用途
            .text-lg.font-medium {{ activeLabel }}
            // 顶栏右侧：主题切换（独立组件，含 element-plus 同款换肤动画）+ 语言切换
            .flex.items-center.gap-2
              ThemeSwitch
              LangSwitch
        //- 内容区先让页面自己滚，等列表页做完再决定要不要换成 n-layout-content 的内部滚动
        n-layout-content(:content-style="{ padding: '1rem', overflow: 'auto' }")
          router-view
</template>
