/**
 * Naive UI 组件内置文案的按需加载层。
 *
 * 为什么必须单独一层：Naive 的内置文案（分页、日期面板、空数据提示…）不走我们的 t()，
 * 而由 NConfigProvider 的 locale / dateLocale 两个 prop 决定。切语言时这两套要一起换，
 * 只换自己字典的话界面会一半中文一半英文。
 *
 * 为什么全部走 import() 而不是顶层静态引入：一个语言的 locale 会连带拖进它的 date-fns
 * locale（月份、星期、时间间隔文案）。实测一个语言一块约 2–3 KB gzip，79 种全静态引入
 * 就是 200 KB 上下、且永远用不到。改成动态 import 后构建期每个语言单独成块，
 * 运行期只下载用户真正选中的那块（代价是 dist 目录多出上百个小文件，本地托管无所谓）。
 *
 * 表里的键是 BCP-47 语言代码（与 naive 文件名一一对应，zhCN → zh-CN）。
 * 注意两件事：
 * 1. 某种语言能不能被用户选中，取决于 src/i18n/locales 下有没有对应文案文件；
 *    本表只保证「选了就能把 Naive 的内置文案换掉」，不保证我们自己的文案已翻译。
 * 2. 这张表由 naive-ui/es/locales/date 下的文件名生成，naive 升级增删语言时同步一次即可。
 */

import { computed, shallowRef, watch } from 'vue';

import { LANGUAGES, useI18n } from './index.js';

/**
 * 把「文案模块 + 日期模块」两个 import 的结果合成一对 locale。
 * 写成接收 Promise 的形式，是为了让下面每一行只出现一次 import() 调用、便于比对差异。
 * @param {Promise<{ default: object }>} commonPromise
 * @param {Promise<{ default: object }>} datePromise
 */
async function pair(commonPromise, datePromise) {
  const [common, date] = await Promise.all([commonPromise, datePromise]);
  return { locale: common.default, dateLocale: date.default };
}

/** 79 个 Naive 官方语言的按需加载表 */
export const NAIVE_LOCALE_LOADERS = {
  'af-ZA': () => pair(import('naive-ui/es/locales/common/afZA.mjs'), import('naive-ui/es/locales/date/afZA.mjs')),
  'am-ET': () => pair(import('naive-ui/es/locales/common/amET.mjs'), import('naive-ui/es/locales/date/amET.mjs')),
  'ar-DZ': () => pair(import('naive-ui/es/locales/common/arDZ.mjs'), import('naive-ui/es/locales/date/arDZ.mjs')),
  'az-AZ': () => pair(import('naive-ui/es/locales/common/azAZ.mjs'), import('naive-ui/es/locales/date/azAZ.mjs')),
  'be-BY': () => pair(import('naive-ui/es/locales/common/beBY.mjs'), import('naive-ui/es/locales/date/beBY.mjs')),
  'bg-BG': () => pair(import('naive-ui/es/locales/common/bgBG.mjs'), import('naive-ui/es/locales/date/bgBG.mjs')),
  'bn-BD': () => pair(import('naive-ui/es/locales/common/bnBD.mjs'), import('naive-ui/es/locales/date/bnBD.mjs')),
  'ca-ES': () => pair(import('naive-ui/es/locales/common/caES.mjs'), import('naive-ui/es/locales/date/caES.mjs')),
  'cs-CZ': () => pair(import('naive-ui/es/locales/common/csCZ.mjs'), import('naive-ui/es/locales/date/csCZ.mjs')),
  'da-DK': () => pair(import('naive-ui/es/locales/common/daDK.mjs'), import('naive-ui/es/locales/date/daDK.mjs')),
  'de-DE': () => pair(import('naive-ui/es/locales/common/deDE.mjs'), import('naive-ui/es/locales/date/deDE.mjs')),
  'el-GR': () => pair(import('naive-ui/es/locales/common/elGR.mjs'), import('naive-ui/es/locales/date/elGR.mjs')),
  'en-GB': () => pair(import('naive-ui/es/locales/common/enGB.mjs'), import('naive-ui/es/locales/date/enGB.mjs')),
  'en-US': () => pair(import('naive-ui/es/locales/common/enUS.mjs'), import('naive-ui/es/locales/date/enUS.mjs')),
  'eo': () => pair(import('naive-ui/es/locales/common/eo.mjs'), import('naive-ui/es/locales/date/eo.mjs')),
  'es-AR': () => pair(import('naive-ui/es/locales/common/esAR.mjs'), import('naive-ui/es/locales/date/esAR.mjs')),
  'es-ES': () => pair(import('naive-ui/es/locales/common/esES.mjs'), import('naive-ui/es/locales/date/esES.mjs')),
  'et-EE': () => pair(import('naive-ui/es/locales/common/etEE.mjs'), import('naive-ui/es/locales/date/etEE.mjs')),
  'eu-ES': () => pair(import('naive-ui/es/locales/common/euES.mjs'), import('naive-ui/es/locales/date/euES.mjs')),
  'fa-IR': () => pair(import('naive-ui/es/locales/common/faIR.mjs'), import('naive-ui/es/locales/date/faIR.mjs')),
  'fi-FI': () => pair(import('naive-ui/es/locales/common/fiFI.mjs'), import('naive-ui/es/locales/date/fiFI.mjs')),
  'fil-PH': () => pair(import('naive-ui/es/locales/common/filPH.mjs'), import('naive-ui/es/locales/date/filPH.mjs')),
  'fr-FR': () => pair(import('naive-ui/es/locales/common/frFR.mjs'), import('naive-ui/es/locales/date/frFR.mjs')),
  'gl-ES': () => pair(import('naive-ui/es/locales/common/glES.mjs'), import('naive-ui/es/locales/date/glES.mjs')),
  'gu-IN': () => pair(import('naive-ui/es/locales/common/guIN.mjs'), import('naive-ui/es/locales/date/guIN.mjs')),
  'he-IL': () => pair(import('naive-ui/es/locales/common/heIL.mjs'), import('naive-ui/es/locales/date/heIL.mjs')),
  'hi-IN': () => pair(import('naive-ui/es/locales/common/hiIN.mjs'), import('naive-ui/es/locales/date/hiIN.mjs')),
  'hr-HR': () => pair(import('naive-ui/es/locales/common/hrHR.mjs'), import('naive-ui/es/locales/date/hrHR.mjs')),
  'hu-HU': () => pair(import('naive-ui/es/locales/common/huHU.mjs'), import('naive-ui/es/locales/date/huHU.mjs')),
  'hy-AM': () => pair(import('naive-ui/es/locales/common/hyAM.mjs'), import('naive-ui/es/locales/date/hyAM.mjs')),
  'id-ID': () => pair(import('naive-ui/es/locales/common/idID.mjs'), import('naive-ui/es/locales/date/idID.mjs')),
  'is-IS': () => pair(import('naive-ui/es/locales/common/isIS.mjs'), import('naive-ui/es/locales/date/isIS.mjs')),
  'it-IT': () => pair(import('naive-ui/es/locales/common/itIT.mjs'), import('naive-ui/es/locales/date/itIT.mjs')),
  'ja-JP': () => pair(import('naive-ui/es/locales/common/jaJP.mjs'), import('naive-ui/es/locales/date/jaJP.mjs')),
  'ka-GE': () => pair(import('naive-ui/es/locales/common/kaGE.mjs'), import('naive-ui/es/locales/date/kaGE.mjs')),
  'kk-KZ': () => pair(import('naive-ui/es/locales/common/kkKZ.mjs'), import('naive-ui/es/locales/date/kkKZ.mjs')),
  'km-KH': () => pair(import('naive-ui/es/locales/common/kmKH.mjs'), import('naive-ui/es/locales/date/kmKH.mjs')),
  'kn-IN': () => pair(import('naive-ui/es/locales/common/knIN.mjs'), import('naive-ui/es/locales/date/knIN.mjs')),
  'ko-KR': () => pair(import('naive-ui/es/locales/common/koKR.mjs'), import('naive-ui/es/locales/date/koKR.mjs')),
  'ky-KG': () => pair(import('naive-ui/es/locales/common/kyKG.mjs'), import('naive-ui/es/locales/date/kyKG.mjs')),
  'lo-LA': () => pair(import('naive-ui/es/locales/common/loLA.mjs'), import('naive-ui/es/locales/date/loLA.mjs')),
  'lt-LT': () => pair(import('naive-ui/es/locales/common/ltLT.mjs'), import('naive-ui/es/locales/date/ltLT.mjs')),
  'lv-LV': () => pair(import('naive-ui/es/locales/common/lvLV.mjs'), import('naive-ui/es/locales/date/lvLV.mjs')),
  'mk-MK': () => pair(import('naive-ui/es/locales/common/mkMK.mjs'), import('naive-ui/es/locales/date/mkMK.mjs')),
  'ml-IN': () => pair(import('naive-ui/es/locales/common/mlIN.mjs'), import('naive-ui/es/locales/date/mlIN.mjs')),
  'mn-MN': () => pair(import('naive-ui/es/locales/common/mnMN.mjs'), import('naive-ui/es/locales/date/mnMN.mjs')),
  'mr-IN': () => pair(import('naive-ui/es/locales/common/mrIN.mjs'), import('naive-ui/es/locales/date/mrIN.mjs')),
  'ms-MY': () => pair(import('naive-ui/es/locales/common/msMY.mjs'), import('naive-ui/es/locales/date/msMY.mjs')),
  'my-MM': () => pair(import('naive-ui/es/locales/common/myMM.mjs'), import('naive-ui/es/locales/date/myMM.mjs')),
  'nb-NO': () => pair(import('naive-ui/es/locales/common/nbNO.mjs'), import('naive-ui/es/locales/date/nbNO.mjs')),
  'ne-NP': () => pair(import('naive-ui/es/locales/common/neNP.mjs'), import('naive-ui/es/locales/date/neNP.mjs')),
  'nl-NL': () => pair(import('naive-ui/es/locales/common/nlNL.mjs'), import('naive-ui/es/locales/date/nlNL.mjs')),
  'nn-NO': () => pair(import('naive-ui/es/locales/common/nnNO.mjs'), import('naive-ui/es/locales/date/nnNO.mjs')),
  'pa-IN': () => pair(import('naive-ui/es/locales/common/paIN.mjs'), import('naive-ui/es/locales/date/paIN.mjs')),
  'pl-PL': () => pair(import('naive-ui/es/locales/common/plPL.mjs'), import('naive-ui/es/locales/date/plPL.mjs')),
  'pt-BR': () => pair(import('naive-ui/es/locales/common/ptBR.mjs'), import('naive-ui/es/locales/date/ptBR.mjs')),
  'pt-PT': () => pair(import('naive-ui/es/locales/common/ptPT.mjs'), import('naive-ui/es/locales/date/ptPT.mjs')),
  'rm-CH': () => pair(import('naive-ui/es/locales/common/rmCH.mjs'), import('naive-ui/es/locales/date/rmCH.mjs')),
  'ro-RO': () => pair(import('naive-ui/es/locales/common/roRO.mjs'), import('naive-ui/es/locales/date/roRO.mjs')),
  'ru-RU': () => pair(import('naive-ui/es/locales/common/ruRU.mjs'), import('naive-ui/es/locales/date/ruRU.mjs')),
  'si-LK': () => pair(import('naive-ui/es/locales/common/siLK.mjs'), import('naive-ui/es/locales/date/siLK.mjs')),
  'sk-SK': () => pair(import('naive-ui/es/locales/common/skSK.mjs'), import('naive-ui/es/locales/date/skSK.mjs')),
  'sl-SI': () => pair(import('naive-ui/es/locales/common/slSI.mjs'), import('naive-ui/es/locales/date/slSI.mjs')),
  'sq-AL': () => pair(import('naive-ui/es/locales/common/sqAL.mjs'), import('naive-ui/es/locales/date/sqAL.mjs')),
  'sr-RS': () => pair(import('naive-ui/es/locales/common/srRS.mjs'), import('naive-ui/es/locales/date/srRS.mjs')),
  'sv-SE': () => pair(import('naive-ui/es/locales/common/svSE.mjs'), import('naive-ui/es/locales/date/svSE.mjs')),
  'sw-KE': () => pair(import('naive-ui/es/locales/common/swKE.mjs'), import('naive-ui/es/locales/date/swKE.mjs')),
  'ta-IN': () => pair(import('naive-ui/es/locales/common/taIN.mjs'), import('naive-ui/es/locales/date/taIN.mjs')),
  'te-IN': () => pair(import('naive-ui/es/locales/common/teIN.mjs'), import('naive-ui/es/locales/date/teIN.mjs')),
  'th-TH': () => pair(import('naive-ui/es/locales/common/thTH.mjs'), import('naive-ui/es/locales/date/thTH.mjs')),
  'tr-TR': () => pair(import('naive-ui/es/locales/common/trTR.mjs'), import('naive-ui/es/locales/date/trTR.mjs')),
  'ug-CN': () => pair(import('naive-ui/es/locales/common/ugCN.mjs'), import('naive-ui/es/locales/date/ugCN.mjs')),
  'uk-UA': () => pair(import('naive-ui/es/locales/common/ukUA.mjs'), import('naive-ui/es/locales/date/ukUA.mjs')),
  'ur-PK': () => pair(import('naive-ui/es/locales/common/urPK.mjs'), import('naive-ui/es/locales/date/urPK.mjs')),
  'uz-UZ': () => pair(import('naive-ui/es/locales/common/uzUZ.mjs'), import('naive-ui/es/locales/date/uzUZ.mjs')),
  'vi-VN': () => pair(import('naive-ui/es/locales/common/viVN.mjs'), import('naive-ui/es/locales/date/viVN.mjs')),
  'zh-CN': () => pair(import('naive-ui/es/locales/common/zhCN.mjs'), import('naive-ui/es/locales/date/zhCN.mjs')),
  'zh-TW': () => pair(import('naive-ui/es/locales/common/zhTW.mjs'), import('naive-ui/es/locales/date/zhTW.mjs')),
  'zu-ZA': () => pair(import('naive-ui/es/locales/common/zuZA.mjs'), import('naive-ui/es/locales/date/zuZA.mjs')),
};

const { locale: current } = useI18n();

/**
 * 全部可用语言代码，接入新语言时用它查（大小写格式要和这里一致：'pt-BR'，不是 'pt_BR'）。
 * @type {string[]}
 */
export const NAIVE_LANGUAGE_CODES = Object.keys(NAIVE_LOCALE_LOADERS);

/** @param {string} code @returns {boolean} */
export function hasNaiveLocale(code) {
  return Object.prototype.hasOwnProperty.call(NAIVE_LOCALE_LOADERS, code);
}

/** 已加载结果，null 表示当前语言的 locale 还没到位 */
const ready = shallowRef(null);

/**
 * code → 已解析的一对 locale。
 * import() 本身就带模块缓存，这里再存一层是为了切回用过的语言时不用等 await 那一拍，
 * 少一次「Naive 文案先退回默认再变回来」的闪动。
 */
const cache = new Map();

/**
 * 加载指定语言的 Naive locale。
 * @param {string} code
 */
async function load(code) {
  const cached = cache.get(code);
  if (cached) {
    ready.value = { code, ...cached };
    return;
  }

  const loader = NAIVE_LOCALE_LOADERS[code];

  if (!loader) {
    // 不悄悄退回中文：那样只会把拼错的语言代码藏起来。这里让 Naive 用它自己的默认文案，
    // 并把问题打到控制台，改起来一眼就能看到。
    console.warn(`[i18n] 语言 "${code}" 在 Naive UI 的加载表里不存在，检查语言代码写法`, NAIVE_LANGUAGE_CODES);
    return;
  }

  try {
    const resolved = await loader();
    cache.set(code, resolved);
    // 连点切换时，慢的那次响应不能覆盖已经选中的语言
    if (current.value === code) {
      ready.value = { code, ...resolved };
    }
  } catch (error) {
    console.error('[i18n] 加载 Naive UI 语言包失败:', code, error);
  }
}

// 语言一变更就先清空已就位的一对，避免 Naive 组件继续用旧语言的文案渲染一帧
watch(current, (code) => {
  ready.value = null;
  load(code);
}, { immediate: true });

/** 给 NConfigProvider 的 :locale；未加载完时为 undefined，Naive 会用自身默认文案 */
export const naiveLocale = computed(() => (ready.value ? ready.value.locale : undefined));

/** 给 NConfigProvider 的 :date-locale */
export const naiveDateLocale = computed(() => (ready.value ? ready.value.dateLocale : undefined));

/**
 * 当前语言的 Naive 文案是否已就位。首屏想要「文案齐了再显示」的场合可以用它做门。
 * @returns {boolean}
 */
export function isNaiveLocaleReady() {
  return ready.value?.code === current.value;
}

/**
 * 开发期自检：我们自己注册了文案的语言，Naive 侧必须有对应的按需入口。
 * 缺了就是语言代码写错（比如 'zh_CN' 下划线、大小写不一致），当场报出来，
 * 而不是等用户切换语言后发现组件内置文案没跟着变。
 */
if (import.meta.env?.DEV) {
  const uncovered = LANGUAGES.map((item) => item.code).filter((code) => !hasNaiveLocale(code));

  if (uncovered.length) {
    console.warn('[i18n] 这些已接入的语言没有 Naive UI 按需入口，检查语言代码写法', uncovered);
  }
}
