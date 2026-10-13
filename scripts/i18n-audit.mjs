/*
 * i18n 审计（构建门禁，`pnpm build` 前置）：不启浏览器、不依赖 vite，纯 Node 比对。
 *
 * 盯五类会让界面「半中半英 / 直接显示键名」的问题：
 *   1. 注册表 ↔ 文案包：languages.json 与 locales/*.yaml 必须一一对应（少一边都报错，
 *      并直接告诉你补哪一行 / 丢哪个文件）；
 *   2. 语言代码：必须是 BCP-47（zh-CN 这种），且 src/i18n/naive.js 里有对应的组件库
 *      文案入口，否则切过去只有我们的文案变了、Naive 内置文案没变；
 *   3. 键集与占位符：每门语言的叶子键集合、{name} 占位符必须与兜底语言完全一致；
 *   4. 代码引用：源码里 t('字面键') 与 nameKey/descriptionKey/labelKey/… 装的键必须存在，
 *      `t(\`前缀${x}\`)` 的写法只校验前缀是有一段字典；
 *   5. 文案卫生：空值、非字符串、隐形控制字符（软连字符 U+00AD 等）、
 *      非 CJK 语言里残留中日韩字符、母语自称被误翻译。
 *
 * 用法：node scripts/i18n-audit.mjs        退出码非 0 表示有问题，可直接接进 CI。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml');

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const LOCALE_DIR = path.join(SRC, 'i18n/locales');
const FALLBACK = 'zh-CN';
const problems = [];
const infos = [];

/** 收集错误前缀统一的报告器 */
const fail = (check, message) => problems.push(`[${check}] ${message}`);

/** 递归展平成 { 'a.b.c': value }，保持插入顺序 */
function flatten(obj, prefix = '', acc = {}) {
  for (const [key, value] of Object.entries(obj ?? {})) {
    const pathStr = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, pathStr, acc);
    } else {
      acc[pathStr] = value;
    }
  }
  return acc;
}

function readYaml(file) {
  return flatten(load(fs.readFileSync(file, 'utf8')) ?? {});
}

/* ---------- 1. 注册表 ↔ 文案包 ---------- */

const metaFile = path.join(SRC, 'i18n/languages.json');
if (!fs.existsSync(metaFile)) {
  fail('registry', '缺少 src/i18n/languages.json');
  report();
}
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const files = fs.readdirSync(LOCALE_DIR).filter((name) => name.endsWith('.yaml')).map((name) => name.slice(0, -'.yaml'.length));

for (const code of files) {
  if (!(code in meta)) {
    fail('registry', `locales/${code}.yaml 存在，但 languages.json 没有「${code}」这条母语自称 → 在该文件补一条 {"${code}": {"name": "...", "nativeName": "..."}}`);
  }
}
for (const code of Object.keys(meta)) {
  if (!files.includes(code)) {
    fail('registry', `languages.json 注册了「${code}」，但缺少 locales/${code}.yaml → 要么补文案包，要么删掉这条注册`);
  }
  if (!meta[code].nativeName?.trim()) {
    fail('registry', `languages.json 的「${code}」缺 nativeName（下拉框显示用，必须是母语自称）`);
  }
}
if (!files.includes(FALLBACK)) {
  fail('registry', `兜底语言 ${FALLBACK}.yaml 不见了`);
  report();
}

/* ---------- 2. 语言代码格式 + Naive UI 入口 ---------- */

const naiveCodes = new Set(
  [...fs.readFileSync(path.join(SRC, 'i18n/naive.js'), 'utf8').matchAll(/^\s*'([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)':\s*\(\)/gm)].map((m) => m[1]),
);
if (!naiveCodes.size) {
  fail('naive', '没能从 src/i18n/naive.js 解析出语言表，检查那张表的书写格式');
}
for (const code of files) {
  if (!/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/.test(code)) {
    fail('code', `语言代码 "${code}" 不是 BCP-47 连字符写法（AriaNg 的 zh_Hans / cz_CZ 不能直接当文件名）`);
  }
  if (!naiveCodes.has(code)) {
    fail('naive', `「${code}」在 src/i18n/naive.js 的按需加载表里没有入口 → 切过去后 Naive 内置文案仍是默认语言`);
  }
}

/* ---------- 3. 键集与占位符 ---------- */

const dicts = Object.fromEntries(files.map((code) => [code, readYaml(path.join(LOCALE_DIR, `${code}.yaml`))]));
const baseline = dicts[FALLBACK] ?? {};
const baselineKeys = Object.keys(baseline);
const placeholders = (text) => (String(text).match(/\{\w+\}/g) ?? []).sort().join(',');

for (const code of files) {
  if (code === FALLBACK) {
    continue;
  }
  const dict = dicts[code];
  const keys = Object.keys(dict);
  for (const key of baselineKeys) {
    if (!(key in dict)) {
      fail('keys', `${code} 缺键 ${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in baseline)) {
      fail('keys', `${code} 多出键 ${key}（${FALLBACK} 里没有，t() 取不到也别留着）`);
    }
  }
  if (keys.length !== baselineKeys.length) {
    fail('keys', `${code} 键数 ${keys.length} 与 ${FALLBACK} 的 ${baselineKeys.length} 不一致`);
  }
  for (const key of baselineKeys) {
    if (key in dict && placeholders(dict[key]) !== placeholders(baseline[key])) {
      fail('placeholder', `${code} ${key}: 占位符应为 {${placeholders(baseline[key]) || '无'}}，实为 {${placeholders(dict[key]) || '无'}}`);
    }
  }
}

/* ---------- 5. 文案卫生（放在引用检查前，报错更好读） ---------- */

const INVISIBLE = ['\u00ad', '\u200b', '\u200e', '\u200f', '\ufeff'];
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uc000-\ud7af]/;
for (const code of files) {
  for (const [key, value] of Object.entries(dicts[code])) {
    if (typeof value !== 'string' || !value.trim()) {
      fail('value', `${code} ${key}: 值为空或不是字符串（${JSON.stringify(value)}）`);
      continue;
    }
    for (const ch of INVISIBLE) {
      if (value.includes(ch)) {
        fail('value', `${code} ${key}: 含隐形控制字符 U+${ch.codePointAt(0).toString(16)}`);
      }
    }
    const keepsCjk = code.startsWith('zh') || code === 'ja-JP';
    if (!keepsCjk && CJK.test(value) && key !== 'app.name') {
      fail('value', `${code} ${key}: 残留中日韩字符未译 → ${value}`);
    }
  }
  // 品牌名不参与翻译
  if (code !== FALLBACK && 'app.name' in dicts[code] && dicts[code]['app.name'] !== baseline['app.name']) {
    fail('value', `${code} app.name 被改成了「${dicts[code]['app.name']}」，品牌名应保持一致`);
  }
}
const nativeNames = Object.values(meta).map((item) => item.nativeName);
if (new Set(nativeNames).size !== nativeNames.length) {
  fail('registry', 'languages.json 里有重复的 nativeName，下拉框会看不出区别');
}

/* ---------- 4. 代码里的键引用 ---------- */

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full.includes(`i18n${path.sep}locales`)) {
        continue;
      }
      out.push(...walk(full));
    } else if (/\.(vue|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const referenced = new Set();
const prefixReferenced = new Set();
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bt\(\s*'([\w.-]+)'/g)) {
    referenced.add(m[1]);
  }
  // 模板字符串取键：t(`connection.status.${x}`) → 只保证这段前缀存在
  for (const m of text.matchAll(/\bt\(\s*`([\w.-]*)\$\{/g)) {
    prefixReferenced.add(m[1]);
  }
  // 数据驱动：nameKey / descriptionKey / labelKey / titleKey / statusKey 等装键写法
  for (const m of text.matchAll(/\b(?:label|title|name|description|error|status)Keys?\s*[:=]\s*'([\w.-]+)'/g)) {
    referenced.add(m[1]);
  }
  for (const m of text.matchAll(/\b(?:label|title|name|description|error|status)Keys?\s*[:=]\s*"([\w.-]+)"/g)) {
    referenced.add(m[1]);
  }
}
for (const key of referenced) {
  if (!(key in baseline)) {
    fail('missing', `代码引用了 "${key}"，但 ${FALLBACK}.yaml 里没有 → 界面会直接把键名显示出来`);
  }
}
for (const prefix of prefixReferenced) {
  const hit = prefix && baselineKeys.some((key) => key.startsWith(prefix));
  if (!hit) {
    fail('missing', `代码里 t(\`${prefix}…\`) 的动态前缀在 ${FALLBACK}.yaml 下找不到任何键`);
  }
}
const orphans = baselineKeys.filter((key) => !referenced.has(key) && ![...prefixReferenced].some((p) => key.startsWith(p)));
if (orphans.length) {
  infos.push(`未被代码引用的键 ${orphans.length} 个（其中 options.* 由设置页按 aria2 选项名动态取，属正常冗余）`);
}

function report() {
  if (infos.length) {
    console.log(infos.map((line) => `  · ${line}`).join('\n'));
  }
  if (problems.length) {
    console.error(`\ni18n 审计未通过，共 ${problems.length} 处：`);
    problems.forEach((line) => console.error('  ✗', line));
    process.exit(1);
  }
  console.log(`i18n 审计通过：${files.length} 门语言 × ${baselineKeys.length} 键，注册表 / 占位符 / 代码引用均一致`);
}

report();
