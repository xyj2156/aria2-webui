/**
 * 全局状态（aria2.getGlobalStat）的 app 级轮询与共享响应态。
 *
 * 为什么放模块级而不是某个页面：顶栏要常驻显示总速率，切到任意页面都得有；页面级的轮询
 * （task-list 取的是任务列表，另一回事）随页面卸载就没了，撑不起顶栏。故在应用根（main.vue）
 * 调 startGlobalStat() 起一条独立于路由的轮询，结果写进导出的 globalStat 供任意组件读，
 * 顺带把速率喂给 monitor store 的全局折线缓冲。
 *
 * 三个联动开关（都收敛到 syncRunning 一处判活）：
 * 1. 连接状态：仅 CONNECTED 才轮询；断开清显示并停表；
 * 2. 设置项 globalStatRefreshInterval：0 = 关闭自动刷新；改值即时生效（间隔用函数每轮现取）；
 * 3. 首次连上立即抢跑一轮（usePolling 的 immediate）。
 */
import { reactive, watch } from 'vue';

import { getGlobalSummary, RPC_STATUS, onConnectionChange } from '@/rpc';
import { useMonitorStore } from '@/store/monitor.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';
import { usePolling } from '@/composables/use-polling.js';

/** 顶栏与任意组件共享的全局状态快照。 */
export const globalStat = reactive({
  status: RPC_STATUS.IDLE,
  connected: false,
  downloadSpeed: 0,
  uploadSpeed: 0,
  downloading: 0,
  waiting: 0,
  stopped: 0,
});

let started = false;

/** 断开 / 关闭刷新时把显示归零，避免留着上一次的速率假象。 */
function resetStat() {
  globalStat.downloadSpeed = 0;
  globalStat.uploadSpeed = 0;
  globalStat.downloading = 0;
  globalStat.waiting = 0;
  globalStat.stopped = 0;
}

/**
 * 启动全局状态轮询。幂等：重复调用只生效一次。应在应用根 setup 里调用一次，
 * 使 usePolling 的自动清理绑定到 app 作用域。
 */
export function startGlobalStat() {
  if (started) {
    return;
  }
  started = true;

  const settings = useWebuiSettingsStore();
  const monitor = useMonitorStore();

  async function refresh() {
    try {
      const stat = await getGlobalSummary();
      Object.assign(globalStat, stat);
      monitor.recordStat(monitor.GLOBAL_STAT_KEY, {
        downloadSpeed: stat.downloadSpeed,
        uploadSpeed: stat.uploadSpeed,
      });
    } catch {
      // 取数失败（多为瞬断）不打断轮询，等下一轮；状态徽标另由连接订阅负责
    }
  }

  /** 每轮现取间隔，设置里改了立即在下一轮生效 */
  const intervalMs = () => Number(settings.options.globalStatRefreshInterval) || 0;
  const polling = usePolling(refresh, intervalMs, { immediate: true });

  let running = false;
  function syncRunning() {
    const shouldRun = globalStat.connected && intervalMs() > 0;
    if (shouldRun && !running) {
      running = true;
      polling.start();
    } else if (!shouldRun && running) {
      running = false;
      polling.stop();
      resetStat();
    }
  }

  // 连接状态：onConnectionChange 注册即回放一次，initial 也会走到这里
  onConnectionChange((status) => {
    globalStat.status = status;
    globalStat.connected = status === RPC_STATUS.CONNECTED;
    syncRunning();
  });

  // 刷新间隔变动（含切到/切离 0）
  watch(intervalMs, syncRunning);
}
