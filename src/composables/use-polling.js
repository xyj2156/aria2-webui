/**
 * 通用轮询（全局约定 6：定时器一律封装、作用域销毁时自动清理，禁止裸 setInterval）。
 *
 * 三个要点：
 * 1. 「本轮跑完再排下一轮」，慢请求不会叠成一串并发；
 * 2. 支持暂停（比如将来做拖拽排序时抑制刷新），恢复后立刻补一轮；
 * 3. trigger() 供事件到达时抢跑一轮（WS 推送 onDownloadComplete 等）。
 */

import { onScopeDispose, readonly, ref } from 'vue';

/**
 * @param {() => void | Promise<void>} task 每轮要执行的刷新
 * @param {number | (() => number)} intervalMs 间隔，或返回间隔的函数
 * @param {{ immediate?: boolean }} [options] immediate=false 时不立即跑第一轮
 * @returns {{
 *   start: () => void, stop: () => void, setPaused: (paused: boolean) => void,
 *   isPaused: () => boolean, trigger: () => void, running: import('vue').Ref<boolean>
 * }}
 */
export function usePolling(task, intervalMs, options = {}) {
  const running = ref(false);
  const paused = ref(false);
  let timer = null;
  let cancelled = false;

  function interval() {
    return typeof intervalMs === 'function' ? intervalMs() : intervalMs;
  }

  function scheduleNext() {
    if (cancelled || timer !== null) {
      return;
    }
    const wait = interval();
    if (wait <= 0) {
      return;
    }
    timer = setTimeout(run, wait);
  }

  async function run() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (cancelled || paused.value) {
      return;
    }
    running.value = true;
    try {
      await task();
    } finally {
      running.value = false;
      scheduleNext();
    }
  }

  function start() {
    if (cancelled || interval() <= 0) {
      return;
    }
    if (options.immediate !== false) {
      void run();
      return;
    }
    scheduleNext();
  }

  function stop() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function setPaused(value) {
    paused.value = value;
    if (!value) {
      void run();
    } else {
      stop();
    }
  }

  onScopeDispose(() => {
    cancelled = true;
    stop();
  });

  return {
    start,
    stop,
    setPaused,
    isPaused: () => paused.value,
    trigger: () => void run(),
    running: readonly(running),
  };
}
