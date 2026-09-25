/**
 * 页面标题（浏览器标签 document.title）的引擎接线。
 *
 * 为什么单开一条 composable 而不是塞进 use-global-status：
 *   - 全局速率走 globalStatRefreshInterval，标题刷新走 titleRefreshInterval，
 *     两者是各自独立的定时器（对齐参考实现 useGlobalStatus）；
 *   - 标题只「读」use-global-status 已缓存的 globalStat，不再额外发 RPC，省带宽。
 *
 * 数据源：
 *   - 模板 / 刷新间隔 → useWebuiSettingsStore().options（title / titleRefreshInterval）
 *   - ${rpcprofile}  → useConnectionStore().activeConnection.name
 *   - 速率与计数      → 共享响应态 globalStat（断开时为 0，仍按模板渲染）
 *   - ${title}       → 当前路由 meta.title 翻译出的页名，取不到兜底 APP_NAME
 *
 * 生效方式：
 *   1. 周期：仅当 titleRefreshInterval > 0 时按间隔轮询刷新（改间隔即时生效，0 = 关闭自动刷新）；
 *   2. 即时：路由页名、模板、连接名任一变化 → 立刻重渲染（编辑设置、切页/切连接无需等下一轮）；
 *   3. 启动即渲染一次，首屏标题不必等到第一个轮询周期。
 */
import { watch } from 'vue';

import router from '@/router/index.js';
import { t } from '@/i18n/index.js';
import { APP_NAME } from '@/constants/app.js';
import { getFinalTitleByGlobalStat } from '@/services/title-service.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';
import { useConnectionStore } from '@/store/connections.js';
import { globalStat } from '@/composables/use-global-status.js';
import { usePolling } from '@/composables/use-polling.js';

let started = false;

/** 当前路由页名（i18n 翻译后），取不到兜底应用名。 */
function currentPageTitle() {
  const key = router.currentRoute.value?.meta?.title;
  return key ? t(key) : APP_NAME;
}

/**
 * 启动页面标题引擎。幂等：重复调用只生效一次。应在应用根 setup（main.vue）调用一次，
 * 使 usePolling 的作用域清理绑定到 app 生命周期。
 */
export function startPageTitle() {
  if (started) {
    return;
  }
  started = true;

  const settings = useWebuiSettingsStore();
  const connections = useConnectionStore();

  function render() {
    document.title = getFinalTitleByGlobalStat(settings.options.title, {
      title: currentPageTitle(),
      rpcprofile: connections.activeConnection?.name ?? '',
      downloading: globalStat.downloading,
      waiting: globalStat.waiting,
      stopped: globalStat.stopped,
      downspeed: globalStat.downloadSpeed,
      upspeed: globalStat.uploadSpeed,
    });
  }

  /** 每轮现取间隔，设置里改了立即在下一轮生效。 */
  const intervalMs = () => Number(settings.options.titleRefreshInterval) || 0;
  // immediate:false：第一轮由下面的 render() 手动打，避免与「关闭自动刷新也要渲染一次」重复。
  const polling = usePolling(render, intervalMs, { immediate: false });

  function syncRunning() {
    if (intervalMs() > 0) {
      polling.start();
    } else {
      polling.stop();
    }
  }

  // 启动即渲染一次（无论间隔是否为 0，首屏标题都要符合模板）。
  render();
  syncRunning();

  // 刷新间隔变动（含切到 / 切离 0）。
  watch(intervalMs, syncRunning);
  // 离散事件即时重渲染：路由页名 / 模板编辑 / 当前连接名。
  watch(currentPageTitle, render);
  watch(() => settings.options.title, render);
  watch(() => connections.activeConnection?.name, render);
}
