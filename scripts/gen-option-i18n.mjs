/**
 * 一次性生成脚本：把 project 已迁移好的 aria2 选项文案（options.<key>.name/.description）
 * 抽出来，追加进本工程的 zh-CN.yaml / en-US.yaml，作为设置页的标签/说明来源。
 *
 * 只取「中英两份都存在」的键，保证两份 locale 的键集一致（本工程 i18n 开发期会做键对齐自检）。
 * 幂等：若 locale 文件里已有顶层 `options:` 段，则整体替换该段到文件末尾，不会重复叠加。
 *
 * 用法： node scripts/gen-option-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, dump } from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_LOCALES = 'G:/web/aria2-webui/project/src/i18n/locales';

/** 把点号路径对象展平成 { 'a.b.c': value } */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

function readJson(path) {
  return flatten(JSON.parse(readFileSync(path, 'utf8')));
}

/** 由点号路径建嵌套对象 */
function nest(flatEntries) {
  const rootObj = {};
  for (const [path, value] of flatEntries) {
    const parts = path.split('.');
    let node = rootObj;
    parts.slice(0, -1).forEach((part) => {
      node[part] ??= {};
      node = node[part];
    });
    node[parts.at(-1)] = value;
  }
  return rootObj;
}

const zhProject = readJson(`${PROJECT_LOCALES}/zh_Hans.json`);
const enProject = readJson(`${PROJECT_LOCALES}/en.json`);

const optionPaths = Object.keys(zhProject)
  .filter((path) => path.startsWith('options.') && path in enProject)
  .sort();

function buildLocale(flat) {
  return nest(optionPaths.map((path) => [path, flat[path]]));
}

/** 定位 locale 里顶层 options 段的起点，返回去掉该段后的正文 + 是否需要替换 */
function stripOptionsBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === 'options:');
  if (start === -1) {
    return { body: text, hadBlock: false };
  }
  return { body: lines.slice(0, start).join('\n').replace(/\s+$/, ''), hadBlock: true };
}

const targets = [
  { file: `${root}src/i18n/locales/zh-CN.yaml`, data: buildLocale(zhProject) },
  { file: `${root}src/i18n/locales/en-US.yaml`, data: buildLocale(enProject) },
];

for (const { file, data } of targets) {
  const original = readFileSync(file, 'utf8');
  const { body } = stripOptionsBlock(original);
  const optionsYaml = dump({ options: data.options ?? {} }, { lineWidth: 0, quotingType: '"' });
  writeFileSync(file, `${body}\n\n${optionsYaml}`);
}

console.log(`已注入 options.* 文案路径 ${optionPaths.length} 条到 zh-CN.yaml / en-US.yaml`);
