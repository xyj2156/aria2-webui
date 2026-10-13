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
 *
 * 新增一门语言只做两件事：
 * 1. 往 ./locales/ 丢一个 `<语言代码>.yaml`（键集与 zh-CN 对齐，`pnpm build` 里的审计会盯）；
 * 2. 在 ./languages.json 里登记母语自称（下拉框要在不加载文案包的前提下就知道显示名）。
 * 文案包由 import.meta.glob 自动发现，不用改本文件；语言代码必须是 BCP-47
 * （如 pt-BR），否则对不上 ./naive.js 的组件库文案表，审计同样会报。
 */

import { computed, ref } from 'vue';
import { load } from 'js-yaml';

// 兜底语言静态导入，永远立即可用
import zhCNYaml from './locales/zh-CN.yaml?raw';
import languagesMeta from './languages.json';

/** 兜底语言：新增语言时只改这一处 */
const FALLBACK_LOCALE = 'zh-CN';

/** 已加载的文案缓存：code → messages */
const messageCache = new Map();
messageCache.set(FALLBACK_LOCALE, load(zhCNYaml));

/**
 * 文案包按需加载器，由目录扫描自动生成。
 * 用 query + import: 'default' 两个选项让 loader() 直接拿到 yaml 文本；glob 的键本身不含
 * query 后缀（形如 ./locales/de-DE.yaml），但为防版本差异仍先剥掉可能的问号尾巴。
 */
const messageLoaders = Object.fromEntries(
  Object.entries(import.meta.glob('./locales/*.yaml', { query: '?raw', import: 'default' }))
    .map(([path, loader]) => [path.split('?')[0].match(/\/locales\/([^/]+)\.yaml$/)?.[1], loader])
    .filter(([code]) => Boolean(code) && code !== FALLBACK_LOCALE)
    .map(([code, loader]) => [code, async () => load(await loader())]),
);

// glob 一个都没匹配上 = 语言包目录或写法出了问题，此时只剩兜底语言且不会报错，必须当场吼一声
if (import.meta.env?.DEV && Object.keys(messageLoaders).length + 1 < Object.keys(languagesMeta).length) {
  console.warn(
    `[i18n] languages.json 注册了 ${Object.keys(languagesMeta).length} 门语言，但 locales 扫描只拿到 ${Object.keys(messageLoaders).length + 1} 份文案包，检查 src/i18n/locales 下的文件名`,
  );
}

/**
 * 语言注册表。label 是母语自称，取自 languages.json，不参与翻译。
 * 只登记「有文案包且有母语名」的语言，缺一律由审计脚本报出来。
 * @type {Array<{ code: string, label: string }>}
 */
export const LANGUAGES = Object.keys(languagesMeta)
  .filter((code) => messageLoaders[code] || code === FALLBACK_LOCALE)
  .map((code) => ({ code, label: languagesMeta[code].nativeName }));

/** @param {string} code @returns {typeof LANGUAGES[number]|undefined} */
function findLanguage(code) {
  return LANGUAGES.find((item) => item.code === code);
}

/** 语言代码 → 我们登记的语言（含别名），全部小写，便于与浏览器标签不区分大小写匹配 */
const codeIndex = new Map();
for (const [code, meta] of Object.entries(languagesMeta)) {
  codeIndex.set(code.toLowerCase(), code);
  for (const alias of meta.aliases ?? []) {
    codeIndex.set(alias.toLowerCase(), code);
  }
}

/**
 * 浏览器语言 → 我们的语言代码。顺序：整标签精确匹配 → 别名匹配（zh-HK → zh-TW）
 * → 主语言子标签匹配（es-AR → es-ES）→ 兜底语言。
 * 别名必须排在主语言子标签之前，否则 zh-TW 会被 zh-CN 抢走。
 * @param {string} [browserLanguage] 留口子便于测试
 * @returns {string}
 */
export function resolveBrowserLocale(browserLanguage) {
  const browser = String(browserLanguage ?? (typeof navigator === 'undefined' ? '' : navigator.language) ?? '').toLowerCase();
  if (codeIndex.has(browser)) {
    return codeIndex.get(browser);
  }

  const primary = browser.split('-')[0];
  const byPrimary = [...codeIndex.keys()].find((key) => key.split('-')[0] === primary);
  return byPrimary ? codeIndex.get(byPrimary) : FALLBACK_LOCALE;
}

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
 * 当前语言：模块级 ref，全应用共享一份。
 *
 * 持久化不在这里做——语言以设置 store 的 language 为单一事实源，由 @/composables/use-language-sync
 * 在启动/切换时调 setLocale 同步进来；本模块只负责解析浏览器语言作为初值、持有当前值与切包。
 */
const current = ref(resolveBrowserLocale());

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