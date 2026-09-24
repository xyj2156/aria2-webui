/**
 * 选项视图模型加工（块 08 §2，端口自 project 的 option-service.ts）。
 *
 * 引擎只认 OptionItem，具体写入由调用方决定（全局设置 changeGlobalOption /
 * 任务 changeOption），这样「全局设置页 / 新建任务页 / 详情设置 tab」复用同一份渲染模型。
 */

import {
  GLOBAL_OPTION_GROUPS,
  OPTION_META,
  QUICK_SETTING_GROUPS,
  TASK_OPTIONS,
} from '@/services/aria2-option-meta.js';

/**
 * @typedef {Object} OptionItem
 * @property {string} key
 * @property {string} type      string|integer|float|text|boolean|option
 * @property {string} nameKey   i18n 键 options.<key>.name
 * @property {string} descriptionKey i18n 键 options.<key>.description
 * @property {boolean} readonly
 * @property {boolean} showHistory
 * @property {string} [category]
 * @property {string} [defaultValue]
 * @property {string} [suffix]
 * @property {number} [min]
 * @property {number} [max]
 * @property {boolean} [required]
 * @property {string[]} [options]
 * @property {string} [separator]
 * @property {'string'|'array'} [submitFormat]
 * @property {boolean} [showCount]
 */

/** 未登记的 aria2 选项退化为纯文本框，不阻断渲染 */
export function getOptionMeta(key) {
  return OPTION_META[key] ?? { key, type: 'string' };
}

function toItem(meta, extras = {}) {
  const withOptions = meta.type === 'boolean' ? { ...meta, options: meta.options ?? ['true', 'false'] } : meta;
  return {
    ...withOptions,
    nameKey: `options.${meta.key}.name`,
    descriptionKey: `options.${meta.key}.description`,
    readonly: extras.readonly ?? Boolean(meta.readonly),
    showHistory: extras.showHistory ?? false,
    category: extras.category ?? meta.key,
  };
}

/** 把「key 或带元信息的对象」展开成渲染用模型 */
export function getSpecifiedOptions(keys, options = {}) {
  return (keys ?? []).map((entry) => {
    const key = typeof entry === 'string' ? entry : entry.key;
    const meta = getOptionMeta(key);
    const extras = typeof entry === 'string' ? {} : { readonly: entry.readonly, showHistory: entry.showHistory, category: entry.category };
    const item = toItem(meta, extras);
    if (options.disableRequired) {
      return { ...item, required: false };
    }
    return item;
  });
}

/** Command URL 里的键必须先过字典校验 */
export function isOptionKeyValid(key) {
  return Object.prototype.hasOwnProperty.call(OPTION_META, key);
}

/** 全局分类键表；未知分类给空表（页内 tab 只放已知分类） */
export function getAvailableGlobalOptionsKeys(type) {
  return GLOBAL_OPTION_GROUPS[type] ?? [];
}

export function getQuickSettingKeys(type) {
  return QUICK_SETTING_GROUPS[type] ?? [];
}

/** 全局设置的分类顺序（页内 tab 用） */
export const GLOBAL_CATEGORIES = Object.keys(GLOBAL_OPTION_GROUPS);

function statusAllows(list, status) {
  if (!list) {
    return true;
  }
  return list.includes('default') || list.includes(status);
}

const BT_ONLY_CATEGORY = new Set(['bittorrent']);
const HTTP_ONLY_CATEGORY = new Set(['http', 'metalink']);

/** 任务详情页可显示的选项键（状态 + BT/非 BT 互斥过滤，不可改的标只读） */
export function getAvailableTaskOptionKeys(status, isBittorrent) {
  return TASK_OPTIONS.filter((option) => {
    if (!statusAllows(option.canShow, status)) {
      return false;
    }
    const category = option.category ?? '';
    if (isBittorrent && HTTP_ONLY_CATEGORY.has(category)) {
      return false;
    }
    if (!isBittorrent && BT_ONLY_CATEGORY.has(category)) {
      return false;
    }
    return true;
  }).map((option) => ({
    key: option.key,
    category: option.category,
    showHistory: option.showHistory,
    readonly: !statusAllows(option.canUpdate, status),
  }));
}

/** 任务选项按分类分组，供设置 tab 的分节渲染 */
export function groupTaskOptions(items) {
  const order = [];
  const buckets = new Map();
  for (const item of items) {
    const category = item.category ?? 'others';
    if (!buckets.has(category)) {
      buckets.set(category, []);
      order.push(category);
    }
    buckets.get(category).push(item);
  }
  return order.map((category) => ({ category, items: buckets.get(category) }));
}

/**
 * 新建任务弹窗「下载前配置」的选项键表（块 09）。
 * 只挑创建时最常被改的项，不像全局设置页铺满 8 类：dir/out 决定落地，split/
 * max-connection-per-server/min-split-size 决定并发与分片，两条 limit 是本任务限速，
 * check-integrity/continue 是校验与续传。种子任务再追加 BT 相关四项。
 * dir 在部分 aria2 是必填，但新建流程统一走 disableRequired，空值不发给后端。
 */
const NEW_TASK_COMMON_OPTIONS = [
  'dir', 'out', 'split', 'max-connection-per-server', 'min-split-size',
  'max-overall-download-limit', 'max-download-limit', 'check-integrity', 'continue',
];
const NEW_TASK_BT_OPTIONS = ['follow-torrent', 'bt-tracker', 'bt-prioritize-piece', 'bt-max-peers'];

/**
 * @param {boolean} isBittorrent 种子来源时带上 BT 选项
 * @returns {string[]} 交给 getSpecifiedOptions 渲染
 */
export function getNewTaskOptionKeys(isBittorrent = false) {
  return isBittorrent ? [...NEW_TASK_COMMON_OPTIONS, ...NEW_TASK_BT_OPTIONS] : [...NEW_TASK_COMMON_OPTIONS];
}
