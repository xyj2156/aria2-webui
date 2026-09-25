/**
 * 浏览器桌面通知（webui-settings 的 browserNotification / Sound / Frequency 三项的消费端）。
 *
 * 开关语义（关键）：把「开」置真前必须申请 Notification 权限，只有 granted 才持久化 true；
 * 被拒或不支持 → 回退 false 并提示（申请权限由设置页在用户点击手势里调 requestNotificationPermission）。
 *
 * 触发：下载「完成」与「失败」两类（对齐 aria-ng）。
 *   - WS 通道：订阅 onDownloadComplete / onBtDownloadComplete / onDownloadError（即时、零额外流量）。
 *   - HTTP 通道：无推送，用轻量轮询做状态 diff——上一刻在「下载中(active)」这一刻消失的 gid，
 *     查其结果，complete→完成通知、error→失败通知，其余（暂停/移除/排队）忽略。
 *
 * 声音：无外部音频素材，用 WebAudio 合成一声短促提示（best-effort，失败忽略）。
 * 频次：browserNotificationFrequency 映射为「两次通知的最小间隔」做限流，超出的直接丢弃不弹。
 */
import { computed, watch } from 'vue';

import { t } from '@/i18n/index.js';
import { canPushEvents, getDownloadingTasks, getTask, onDownloadEvent } from '@/rpc';
import { processDownloadTask, processTaskList } from '@/services/task-service.js';
import { useConnectionStore } from '@/store/connections.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';
import { usePolling } from '@/composables/use-polling.js';

/** HTTP 无推送时的状态 diff 轮询间隔（毫秒）。 */
const NOTIFY_POLL_MS = 3000;

/** browserNotificationFrequency → 两次通知最小间隔（毫秒），做限流。 */
const THROTTLE_BY_FREQ = { unlimited: 0, high: 1000, middle: 3000, low: 6000 };

/** 当前环境是否支持桌面通知。 */
export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * 申请桌面通知权限（须在用户手势里调用）。
 * @returns {Promise<'granted'|'denied'|'unsupported'>} 'unsupported' 为环境不支持的自定义哨兵。
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

let started = false;
let audioCtx = null;

/** 合成一声短促「叮」（无素材、无依赖）。 */
function playBeep() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return;
    }
    audioCtx = audioCtx || new Ctor();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume?.();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch {
    // 音频不可用（自动播放策略/无输出）不影响通知本身
  }
}

/**
 * 启动浏览器通知引擎（app 级、独立于路由）。幂等：重复调用只生效一次。应在 main.vue setup 调一次。
 */
export function startBrowserNotifications() {
  if (started) {
    return;
  }
  started = true;

  const settings = useWebuiSettingsStore();
  const connections = useConnectionStore();
  let lastShownAt = 0;

  // 依赖响应式的 browserNotification；权限是浏览器态、非响应式，故 notify 里再实时判一次。
  const enabled = computed(
    () => settings.options.browserNotification && isNotificationSupported() && Notification.permission === 'granted',
  );

  function canNotifyNow() {
    return (
      settings.options.browserNotification
      && isNotificationSupported()
      && Notification.permission === 'granted'
    );
  }

  /**
   * 发一条通知（受开关/权限实时判定 + 频次限流）。
   * @param {'complete'|'error'} kind
   * @param {string} gid
   * @param {string} [nameHint] 已知任务名则免去再查
   */
  async function notify(kind, gid, nameHint) {
    if (!canNotifyNow()) {
      return;
    }
    const throttleMs = THROTTLE_BY_FREQ[settings.options.browserNotificationFrequency] ?? 0;
    const now = Date.now();
    if (throttleMs > 0 && now - lastShownAt < throttleMs) {
      return; // 频控：间隔内到达的通知直接丢弃
    }

    let name = nameHint || '';
    if (!name) {
      try {
        name = processDownloadTask(await getTask(gid)).taskName;
      } catch {
        name = '';
      }
    }

    lastShownAt = now;
    const title = kind === 'error' ? t('task.notify.failed') : t('task.notify.completed');
    const body = name || (gid ? `#${gid.slice(-6)}` : '');
    try {
      // tag=gid：同一任务的重复通知会替换而非叠加
      new Notification(title, { body, tag: gid || String(now) });
    } catch {
      // 个别环境 new Notification 需 Service Worker，忽略即可
    }
    if (settings.options.browserNotificationSound) {
      playBeep();
    }
  }

  // ---------- WS 事件驱动 ----------
  let wsDisposer = null;
  function stopWs() {
    wsDisposer?.();
    wsDisposer = null;
  }

  // ---------- HTTP 轮询 diff ----------
  /** 上一轮「下载中(active)」快照：gid → taskName */
  let prevActive = new Map();
  const poll = usePolling(async () => {
    const active = processTaskList(await getDownloadingTasks());
    const cur = new Map(active.map((task) => [task.gid, task.taskName]));
    for (const [gid, name] of prevActive) {
      if (cur.has(gid)) {
        continue; // 仍在下载中
      }
      // 从下载中消失：查现在结果，只报完成 / 失败
      try {
        const status = processDownloadTask(await getTask(gid)).status;
        if (status === 'complete') {
          void notify('complete', gid, name);
        } else if (status === 'error') {
          void notify('error', gid, name);
        }
      } catch {
        // 已被彻底移除，查不到 → 忽略
      }
    }
    prevActive = cur;
  }, NOTIFY_POLL_MS, { immediate: false });

  function syncRunning() {
    if (!enabled.value) {
      stopWs();
      poll.stop();
      prevActive = new Map();
      return;
    }
    prevActive = new Map();
    if (canPushEvents()) {
      // WS：即时事件，起订阅、停轮询
      poll.stop();
      stopWs();
      wsDisposer = onDownloadEvent(({ event, gid }) => {
        if (event === 'onDownloadComplete' || event === 'onBtDownloadComplete') {
          void notify('complete', gid);
        } else if (event === 'onDownloadError') {
          void notify('error', gid);
        }
      });
    } else {
      // HTTP：无推送，起轮询 diff、停事件
      stopWs();
      poll.start();
    }
  }

  // 开关、以及切换连接协议（WS↔HTTP 决定用事件还是轮询）变化时重新起停。
  watch([enabled, () => connections.activeConnection?.protocol], syncRunning, { immediate: true });
}
