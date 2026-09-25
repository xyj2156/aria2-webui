/**
 * 时间/间隔类下拉的统一选项（端口自参考实现 project 的 utils/time-options.ts）。
 *
 * 只负责「毫秒值 ↔ 可读标签」的换算，标签走 i18n（键在 webui.time.*），
 * 不在代码里写死某一种语言的单位文本。持久化与是否要重载由调用方决定。
 */
import { t } from '@/i18n/index.js';

const SECOND = 1000;
const MINUTE = 60 * 1000;

/**
 * 把毫秒值换算成「数值 + 单位」：整分优先用「分」，否则整秒用「秒」，再否则「毫秒」。
 * @param {number} value
 */
function unitFor(value) {
  if (value % MINUTE === 0 && value >= MINUTE) {
    return { count: value / MINUTE, key: 'webui.time.minutes' };
  }
  if (value % SECOND === 0) {
    return { count: value / SECOND, key: 'webui.time.seconds' };
  }
  return { count: value, key: 'webui.time.milliseconds' };
}

/**
 * 单个毫秒值 → 可读标签；<=0 视为「禁用」。
 * @param {number} value
 * @returns {string}
 */
export function timeLabel(value) {
  if (value <= 0) {
    return t('webui.time.disabled');
  }
  const { count, key } = unitFor(value);
  return `${count} ${t(key)}`;
}

/**
 * @param {number[]} values 可选毫秒值集合（自动去重、过滤 <=0、升序）
 * @param {boolean} [withDisabled] 是否给出「禁用」(0) 项
 * @returns {Array<{ value: number, label: string }>}
 */
export function getTimeOptions(values, withDisabled = false) {
  const options = [...values]
    .filter((value, index, list) => value > 0 && list.indexOf(value) === index)
    .sort((a, b) => a - b)
    .map((value) => ({ value, label: timeLabel(value) }));

  return withDisabled ? [{ value: 0, label: t('webui.time.disabled') }, ...options] : options;
}

/** 常用刷新间隔：1s ~ 60s */
export const REFRESH_INTERVAL_OPTIONS = [1000, 2000, 3000, 5000, 10000, 30000, 60000];
