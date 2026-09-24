/**
 * 速度监控环形缓冲（块 06 §3）：按 key（'global' 或任务 gid）保存定长时间序列，供折线图取数。
 * 定长数组 push+shift 维持，容量对齐旧 constants。列表页写全局/各任务速率，详情页写单任务速率。
 */

const GLOBAL_STAT_CAPACITY = 120;
const TASK_STAT_CAPACITY = 300;
const GLOBAL_STAT_KEY = 'global';

/**
 * @typedef {{ time: number, downloadSpeed: number, uploadSpeed: number }} StatPoint
 * @typedef {{ xAxis: number[], series: [number[], number[]] }} StatsSeriesData
 */

function emptyPoints(capacity) {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: capacity }, (_, index) => ({
    time: now - (capacity - 1 - index),
    downloadSpeed: 0,
    uploadSpeed: 0,
  }));
}

export const useMonitorStore = defineStore('monitor', function () {
  /** @type {Map<string, StatPoint[]>} reactive 化的 Map，按 key 存定长序列 */
  const buffers = reactive(new Map());

  function capacityOf(key) {
    return key === GLOBAL_STAT_KEY ? GLOBAL_STAT_CAPACITY : TASK_STAT_CAPACITY;
  }

  /** @returns {StatPoint[]} */
  function ensure(key) {
    let buffer = buffers.get(key);
    if (!buffer) {
      buffer = emptyPoints(capacityOf(key));
      buffers.set(key, buffer);
    }
    return buffer;
  }

  /**
   * 记一个采样点。
   * @param {string} key
   * @param {{ downloadSpeed: number, uploadSpeed: number }} stat
   */
  function recordStat(key, stat) {
    const buffer = ensure(key);
    buffer.push({
      time: Math.floor(Date.now() / 1000),
      downloadSpeed: Number.isFinite(stat.downloadSpeed) ? stat.downloadSpeed : 0,
      uploadSpeed: Number.isFinite(stat.uploadSpeed) ? stat.uploadSpeed : 0,
    });
    while (buffer.length > capacityOf(key)) {
      buffer.shift();
    }
  }

  /**
   * @param {string} key
   * @returns {StatsSeriesData}
   */
  function getStatsData(key) {
    const buffer = ensure(key);
    return {
      xAxis: buffer.map((point) => point.time),
      series: [buffer.map((point) => point.downloadSpeed), buffer.map((point) => point.uploadSpeed)],
    };
  }

  /** 详情页初始化用：清掉旧曲线，避免复用上一个任务的图形 */
  function resetStat(key) {
    buffers.delete(key);
    return getStatsData(key);
  }

  function forget(key) {
    buffers.delete(key);
  }

  return { recordStat, getStatsData, resetStat, forget, GLOBAL_STAT_KEY };
});
