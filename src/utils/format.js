/**
 * 视图层格式化工具（纯函数，不含业务逻辑）。
 *
 * 口径对齐旧版 AriaNg 的 filters/*（readableVolume / number / percent / dateDuration），
 * 但用原生 Intl.NumberFormat + Date 实现，不引 dayjs —— 本工程依赖保持极简。
 * 需要文案的函数只返回「i18n 键」，由界面层再 t()，本文件不认识具体译文，
 * 方便在 Node 里直接装载做断言。
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const BASE = 1024;
const DEFAULT_FRACTION_SIZE = 2;

const grouper = new Intl.NumberFormat('en-US');

/** 值 <1 取 2 位小数、<10 取 1 位、其余 0 位 */
function autoFractionSize(value) {
  if (value < 1) {
    return 2;
  }
  if (value < 10) {
    return 1;
  }
  return 0;
}

/**
 * 体积可读化：B/KB/MB/GB/TB，1024 进位。
 * @param {number | string | null | undefined} value 字节数（aria2 里是字符串，容错）
 * @param {{ fractionSize?: number | 'auto', suffix?: string }} [options]
 * @returns {string} 例如 '1.50 MB'
 */
export function formatVolume(value, options = {}) {
  const { fractionSize = DEFAULT_FRACTION_SIZE, suffix = '' } = options;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  let size = Number.isFinite(parsed) ? parsed : 0;

  let unitIndex = 0;
  while (size >= BASE && unitIndex < UNITS.length - 1) {
    size /= BASE;
    unitIndex += 1;
  }

  const digits = fractionSize === 'auto' ? autoFractionSize(size) : fractionSize;
  return `${size.toFixed(digits)} ${UNITS[unitIndex]}${suffix}`;
}

/** 速率简写：'1.50 MB/s' */
export function formatSpeed(bytesPerSecond) {
  return formatVolume(bytesPerSecond, { fractionSize: 'auto', suffix: '/s' });
}

/** 千分位整数（任务数、文件数等） */
export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return grouper.format(Number(Number(value).toFixed(digits)));
}

/** 百分比，向下截断到 precision 位小数（不四舍五入，避免 99.999% 显示成 100%） */
export function formatPercent(value, precision = 2) {
  const factor = 10 ** precision;
  const floored = Math.floor((Number.isFinite(value) ? value : 0) * factor) / factor;
  return `${grouper.format(floored)}%`;
}

/**
 * 剩余时长：不足一天显示 HH:mm:ss，超过一天返回超长标记键（由界面 t()）。
 * @param {number} seconds
 * @returns {string} 'HH:mm:ss' 或占位键 '@@more-than-a-day@@'
 */
export const MORE_THAN_A_DAY_TOKEN = '@@more-than-a-day@@';

export function formatDuration(seconds) {
  let total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  if (total >= 86400) {
    return MORE_THAN_A_DAY_TOKEN;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * 剩余时间文案：未知（速度为 0 / 已完成 / 无总长）时显示占位符。
 * @param {number} remainSeconds
 * @param {boolean} idle 是否处于「算不出 ETA」的状态
 * @returns {string} 'HH:mm:ss' / '-' / MORE_THAN_A_DAY_TOKEN
 */
export function formatRemain(remainSeconds, idle) {
  if (idle || !Number.isFinite(remainSeconds) || remainSeconds <= 0) {
    return '-';
  }
  return formatDuration(remainSeconds);
}

/**
 * 完整日期时间（Unix 秒 → 本地时区 'YYYY/MM/DD HH:mm:ss'）。用原生 Intl，不引 dayjs。
 * @param {number | string} unixTime
 * @returns {string} 无效时 '-'
 */
export function formatDateTime(unixTime) {
  const seconds = typeof unixTime === 'string' ? Number.parseInt(unixTime, 10) : unixTime;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-';
  }
  const date = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 分享率：固定两位小数 */
export function formatRatio(value) {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

