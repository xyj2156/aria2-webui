/**
 * 多语言引擎（只依赖 vue，不认识 Naive UI）。
 *
 * 组件库自己的文案怎么走：Naive UI 的内置文案（分页、日期面板、确认按钮…）
 * 不经过这里的 t()，由 NConfigProvider 的 locale / dateLocale 决定，
 * 那份对接放在 ./naive.js。分开的第二个好处是本文件可以被 Node 直接装载做断言。
 *
 * 三条固定规矩：
 * 1. 语言名用母语自称（简体中文 / English），永远不翻译，否则用户认不出自己要选哪个。
 * 2. 取不到文案的顺序：当前语言 → 兜底语言 → 原样返回键名。漏译不该让整页崩掉，
 *    但也不能悄悄咽下去，所以开发模式告警一次。
 * 3. 占位符只认 {name}，不做嵌套和表达式，避免长成一个小模板引擎。
 *
 * 加载策略：
 * 兜底语言（zh-CN）静态导入，永远立即可用。其余语言首次用到时才动态 import()，
 * 加载完塞进缓存。t() 始终同步，取不到当前语言文案时自动走兜底，不等异步。
 */

import { computed, ref } from 'vue';
import { load } from 'js-yaml';

// 兜底语言静态导入，永远立即可用
import zhCNYaml from './locales/zh-CN.yaml?raw';

/** 语言代码存本地，刷新后保持。key 带工程前缀，避免同域下与别的工程串味 */
const STORAGE_KEY = 'aria2-webui.locale';

/** 兜底语言：新增语言时只改这一处 */
const FALLBACK_LOCALE = 'zh-CN';

/** 已加载的文案缓存：code → messages */
const messageCache = new Map();
messageCache.set(FALLBACK_LOCALE, load(zhCNYaml));

/**
 * 各语言的按需加载器。
 * 新增语言时在这里加一行、同时在 LANGUAGES 表里加一条。
 */
const messageLoaders = {
  'en-US': () => import('./locales/en-US.yaml?raw').then((m) => load(m.default)),
};

/**
 * 确保指定语言的文案已加载到缓存。
 * @param {string} code
 */
async function ensureMessages(code) {
  if (messageCache.has(code)) return;
  const loader = messageLoaders[code];
  if (!loader) return;

  try {
    messageCache.set(code, await loader());
  } catch (e) {
    console.error(`[i18n] 加载语言包 "${code}" 失败`, e);
  }
}

/** @param {string} code @returns {Record<string, unknown>} */
function getMessages(code) {
  return messageCache.get(code) || messageCache.get(FALLBACK_LOCALE);
}

/**
 * 语言注册表。label 是母语自称，不参与翻译。
 * @type {Array<{ code: string, label: string }>}
 */
export const LANGUAGES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
];

/** @param {string} code @returns {typeof LANGUAGES[number]|undefined} */
function findLanguage(code) {
  return LANGUAGES.find((item) => item.code === code);
}

/**
 * 浏览器语言 → 我们的语言代码。先整体匹配，再退到主语言子标签（zh-TW → zh-CN），
 * 都对不上就用兜底语言。
 * @param {string} [browserLanguage] 留口子便于测试
 * @returns {string}
 */
export function resolveBrowserLocale(browserLanguage) {
  const browser = String(browserLanguage ?? (typeof navigator === 'undefined' ? '' : navigator.language) ?? '').toLowerCase();
  const exact = LANGUAGES.find((item) => item.code.toLowerCase() === browser);
  if (exact) {
    return exact.code;
  }

  const primary = browser.split('-')[0];
  const byPrimary = LANGUAGES.find((item) => item.code.toLowerCase().split('-')[0] === primary);
  return byPrimary ? byPrimary.code : FALLBACK_LOCALE;
}

/**
 * 读上次选过的语言。隐私模式下 localStorage 会抛，SSR 下压根没有，包一层。
 * @returns {string}
 */
function readStoredLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return findLanguage(stored) ? stored : '';
  } catch {
    return '';
  }
}

/** @param {string} code */
function writeStoredLocale(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // 存不下只影响下次访问的默认值，本次切换照样生效
  }
}

/** 当前语言：模块级 ref，全应用共享一份，不必动用 pinia */
const current = ref(readStoredLocale() || resolveBrowserLocale());

// 初始语言如果不是兜底语言，触发异步加载
ensureMessages(current.value);

/**
 * 按点号路径在字典里取值。
 * @param {Record<string, unknown>} messages
 * @param {string} path
 * @returns {unknown}
 */
function pick(messages, path) {
  return path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), messages);
}

const warned = new Set();

/** @param {string} key */
function warnMissing(key) {
  if (!import.meta.env?.DEV || warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn(`[i18n] 语言包缺少文案键 "${key}"（当前语言 ${current.value}）`);
}

/**
 * 翻译取值。
 * @param {string} key 点号路径，例如 'connection.status.connected'
 * @param {Record<string, string|number>} [params] 对应文案里的 {name}
 * @returns {string} 取不到时原样返回键名
 */
export function t(key, params) {
  let text = pick(getMessages(current.value), key);

  if (typeof text !== 'string') {
    text = pick(getMessages(FALLBACK_LOCALE), key);
  }

  if (typeof text !== 'string') {
    warnMissing(key);
    return key;
  }

  if (!params) {
    return text;
  }

  return text.replace(/\{(\w+)\}/g, (matched, name) => (name in params ? String(params[name]) : matched));
}

/**
 * 切换语言。先确保目标语言的文案已加载，再切 locale，
 * 这样 Vue 重渲染时 t() 直接从缓存取、不走兜底。
 * @param {string} code LANGUAGES 里的 code
 * @returns {Promise<boolean>} code 不认时返回 false 且不改动状态
 */
export async function setLocale(code) {
  if (!findLanguage(code)) {
    return false;
  }

  await ensureMessages(code);

  current.value = code;
  writeStoredLocale(code);

  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
  }

  return true;
}

/** 语言切换器的选项；label 直接用母语自称 */
export const localeOptions = computed(() => LANGUAGES.map(({ code, label }) => ({
  label,
  key: code,
})));

/**
 * 组合式入口，组件里取这一个就够。
 * @returns {{ t: typeof t, locale: typeof current, setLocale: typeof setLocale, localeOptions:
 *   typeof localeOptions }}
 */
export function useI18n() {
  return { t, locale: current, setLocale, localeOptions };
}

/**
 * 开发期自检：把每个语言包的键集合与兜底语言对一遍，缺的多的都打出来。
 * 生产构建时 import.meta.env.DEV 为 false，这段会被摇掉。
 * @param {Record<string, unknown>} messages
 * @param {string} [prefix]
 * @returns {string[]}
 */
function collectPaths(messages, prefix = '') {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? collectPaths(value, path) : [path];
  });
}

if (import.meta.env?.DEV) {
  (async () => {
    // 等非兜底语言都加载完再比对
    await Promise.all(
      LANGUAGES
        .filter((lang) => lang.code !== FALLBACK_LOCALE)
        .map((lang) => ensureMessages(lang.code)),
    );

    const baseline = collectPaths(getMessages(FALLBACK_LOCALE));

    for (const language of LANGUAGES) {
      if (language.code === FALLBACK_LOCALE) {
        continue;
      }

      const keys = collectPaths(getMessages(language.code));
      const missing = baseline.filter((path) => !keys.includes(path));
      const extra = keys.filter((path) => !baseline.includes(path));

      if (missing.length || extra.length) {
        console.warn(`[i18n] 语言包 ${language.code} 与 ${FALLBACK_LOCALE} 键不一致`, {
          missing,
          extra,
        });
      }
    }
  })();
}

// 首屏把 html 的 lang 对齐，别让它是 index.html 里写死的 en
if (typeof document !== 'undefined') {
  document.documentElement.lang = current.value;
}