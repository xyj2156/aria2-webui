/**
 * 页面标题引擎：把用户自定义的模板渲染成最终的 document.title。
 *
 * 模板语法 `${name}` 或带修饰符 `${name:key=value;key2=value2}`（分隔符 `:` 或 `;` 皆可）。
 * 支持的占位符（values 的键）：
 *   title       当前路由页名（兜底 APP_NAME）
 *   rpcprofile  当前连接名
 *   downloading / waiting / stopped   各类任务计数
 *   downspeed / upspeed               下/上行速率（字节/秒）
 * 修饰符（对齐参考实现 title-service）：
 *   prefix=X / suffix=X   给该值前后加串
 *   noprefix / nosuffix   抑制上面（或默认）的前后缀
 *   scale=N               速率保留 N 位小数（否则按 'auto' 自适应）
 *   type=volume           与 scale 同时出现时按体积格式渲染（速率本就按体积处理，此处向后兼容）
 *
 * 未知占位符渲染为空串；模板为空时退回 values.title。
 */
import { formatVolume } from '@/utils/format.js';

/**
 * @typedef {Object} TitleValues
 * @property {string}  title
 * @property {string}  rpcprofile
 * @property {number}  downloading
 * @property {number}  waiting
 * @property {number}  stopped
 * @property {number}  downspeed
 * @property {number}  upspeed
 */

/** @typedef {'title'|'rpcprofile'|'downloading'|'waiting'|'stopped'|'downspeed'|'upspeed'} TitlePlaceholderName */

/**
 * 占位符：${name} 或 ${name:mods} / ${name;mods}。
 * 修饰符段允许出现 `=`（如 scale=1 / prefix=X）——只排除终止符 `}`。
 * 注意：参考实现此处写成 [^}=]，会把带等号的修饰符整段挡掉（scale/prefix 实际失效）；
 * 这里按其文档意图修正为只排除 `}`，使 scale=N、prefix/suffix 真正可用。
 */
const PLACEHOLDER = /\$\{(\w+)((?:[:;][^}]*)*)\}/g;

/**
 * @typedef {Object} Modifiers
 * @property {string}  [prefix]
 * @property {string}  [suffix]
 * @property {boolean} noprefix
 * @property {boolean} nosuffix
 * @property {string}  [type]
 * @property {number}  [scale]
 */

/**
 * 解析 `${name:mods}` 里的修饰符串。
 * @param {string} [raw] 冒号/分号起始的修饰符原文
 * @returns {Modifiers}
 */
function parseModifiers(raw) {
  /** @type {Modifiers} */
  const modifiers = { noprefix: false, nosuffix: false };
  if (!raw) {
    return modifiers;
  }
  for (const part of raw.replace(/^[:;]/, '').split(/[;:]/)) {
    const [key, value] = part.split('=');
    if (!key) {
      continue;
    }
    switch (key.trim()) {
      case 'prefix':
        modifiers.prefix = value ?? '';
        break;
      case 'suffix':
        modifiers.suffix = value ?? '';
        break;
      case 'noprefix':
        modifiers.noprefix = true;
        break;
      case 'nosuffix':
        modifiers.nosuffix = true;
        break;
      case 'type':
        modifiers.type = value;
        break;
      case 'scale': {
        const n = Number.parseInt(String(value ?? ''), 10);
        if (Number.isFinite(n)) {
          modifiers.scale = n;
        }
        break;
      }
      default:
        break;
    }
  }
  return modifiers;
}

/**
 * 计算单个占位符（含修饰符）渲染出的文本。
 * @param {string} name
 * @param {TitleValues} values
 * @param {Modifiers} modifiers
 * @returns {string}
 */
function renderValue(name, values, modifiers) {
  const isSpeed = name === 'downspeed' || name === 'upspeed';
  let text;

  if (isSpeed) {
    // 速率统一按体积格式 + '/s'；scale 指定小数位，否则自适应。
    text = formatVolume(values[name], {
      fractionSize: modifiers.scale ?? 'auto',
      suffix: '/s',
    });
  } else {
    const value = values[name];
    text = value === undefined ? '' : String(value);
  }

  // 空值时不加前后缀，避免出现光秃秃的 "MB" 前后串（保持与参考一致）。
  if (!text && (modifiers.noprefix || modifiers.nosuffix)) {
    return text;
  }
  const prefix = modifiers.noprefix ? '' : (modifiers.prefix ?? '');
  const suffix = modifiers.nosuffix ? '' : (modifiers.suffix ?? '');
  return `${prefix}${text}${suffix}`;
}

/**
 * 用 values 渲染模板，返回最终标题字符串（不写 DOM，便于测试与复用）。
 * @param {string} template
 * @param {TitleValues} values
 * @returns {string}
 */
export function getFinalTitleByGlobalStat(template, values) {
  if (!template) {
    return values.title ?? '';
  }
  return template.replace(PLACEHOLDER, (_full, name, mods) =>
    renderValue(name, values, parseModifiers(mods)));
}

/**
 * 渲染并写入 document.title。
 * @param {string} template
 * @param {TitleValues} values
 */
export function applyDocumentTitle(template, values) {
  document.title = getFinalTitleByGlobalStat(template, values);
}
