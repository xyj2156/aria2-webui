/**
 * 生成「启动期选项」名单：aria2 自己在 OptionHandlerFactory.cc 里给每个选项标了
 * 它支持哪类改动，其中 op->setChangeGlobalOption(true) 表示可以通过
 * aria2.changeGlobalOption 在运行时生效。**没有**这个标记的选项，面板里改了没有任
 * 何效果——实测过 rpc-listen-port：changeGlobalOption 回 "OK"，但 getGlobalOption
 * 报的还是旧端口、监听 socket 也没换绑，属于静默丢弃（不是"重启后生效"，因为这份
 * 运行时值不会被写回 aria2.conf）。设置页据此把这些行置为只读。
 *
 * 用法：
 *   node scripts/gen-startup-only-options.mjs \
 *     --src <aria2 源码目录> --commit <基线 commit> [--out <输出文件>]
 *
 * --src 默认取本机参考检出 G:/web/aria2-webui/aria2-with-webui。名单必须按
 * **.github/workflows/release.yml 钉住的 ARIA2_SHA** 生成（那是发布出去的 aria2），
 * 本机检出常常比它新若干个提交，因此推荐直接用 git show 取出该 commit 的两个源文件
 * 到临时目录再跑，见 patches/README.md 的重生命令。头部会记下 commit，
 * 换基线后重跑一次即可，不要手工编辑生成物。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SRC_DIR = resolve(argOf('--src', 'G:/web/aria2-webui/aria2-with-webui'));
const OUT = resolve(argOf('--out', 'src/services/aria2-startup-only-options.js'));
const COMMIT_OVERRIDE = argOf('--commit', '');
const PREFS = `${SRC_DIR}/src/prefs.cc`;
const FACTORY = `${SRC_DIR}/src/OptionHandlerFactory.cc`;

for (const f of [PREFS, FACTORY]) {
  if (!existsSync(f)) {
    console.error(`找不到 ${f}\n用 --src 指定 aria2 源码目录`);
    process.exit(1);
  }
}

let aria2Commit = COMMIT_OVERRIDE || 'unknown';
if (!COMMIT_OVERRIDE) {
  try {
    aria2Commit = execSync(`git -C "${SRC_DIR}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
  } catch { /* 非 git 检出时保留 unknown */ }
}

// PREF_XXX -> "option-name"
const prefName = new Map();
for (const m of readFileSync(PREFS, 'utf8')
  .matchAll(/PrefPtr\s+(PREF_[A-Z0-9_]+)\s*=\s*makePref\("([a-z0-9-]+)"\)/g)) {
  prefName.set(m[1], m[2]);
}

// 一个注册块 = 从 `OptionHandler* op` 到该块的 handlers.push_back(op)
const factory = readFileSync(FACTORY, 'utf8');
const startupOnly = new Set();
const registered = new Set();
let blocks = 0;

for (const rest of factory.split(/OptionHandler\* op/).slice(1)) {
  const end = rest.indexOf('handlers.push_back');
  const chunk = end < 0 ? rest.slice(0, 600) : rest.slice(0, end);
  blocks += 1;
  const changeGlobal = /setChangeGlobalOption\(true\)/.test(chunk);
  if (changeGlobal) continue;
  for (const m of chunk.matchAll(/\bPREF_[A-Z0-9_]+\b/g)) {
    const name = prefName.get(m[0]);
    if (!name) continue;
    // 同一块里出现的 pref 一并视为该选项的组成部分（pair 型选项的 host/port 半边）
    registered.add(name);
    startupOnly.add(name);
  }
}
for (const [, n] of readFileSync(PREFS, 'utf8').matchAll(/makePref\("([a-z0-9-]+)"\)/g)) {
  registered.add(n);
}
// 带 changeGlobal 的块要先从名单里剔掉：一个 pref 可能出现在多个块（别名/复用）
for (const rest of factory.split(/OptionHandler\* op/).slice(1)) {
  const end = rest.indexOf('handlers.push_back');
  const chunk = end < 0 ? rest.slice(0, 600) : rest.slice(0, end);
  if (!/setChangeGlobalOption\(true\)/.test(chunk)) continue;
  for (const m of chunk.matchAll(/\bPREF_[A-Z0-9_]+\b/g)) {
    const name = prefName.get(m[0]);
    if (name) startupOnly.delete(name);
  }
}

const list = [...startupOnly].sort();
const body = list.map((k) => `  '${k}',`).join('\n');

writeFileSync(OUT, `/**
 * 生成物，请勿手工编辑 —— node scripts/gen-startup-only-options.mjs
 *
 * 来源：aria2 源码 ${aria2Commit}（${SRC_DIR}）
 *   src/OptionHandlerFactory.cc 里没有 op->setChangeGlobalOption(true) 的选项，
 *   aria2 不会在运行时接受它们的改动。
 * 实测依据：改 rpc-listen-port 后 changeGlobalOption 回 "OK"，但
 *   getGlobalOption 仍报旧值、监听端口也没变（见 scripts 注释头）。
 * 用途：设置页把这些行置为只读，并提示改 aria2.conf 后重启。
 *
 * 共 ${list.length} 项（aria2 注册选项 ${registered.size}，解析注册块 ${blocks} 个）。
 */

/** @type {ReadonlySet<string>} 运行时改无效的 aria2 选项名 */
export const STARTUP_ONLY_OPTIONS = new Set([
${body}
]);
`, 'utf8');

console.log(`已写出 ${OUT}`);
console.log(`aria2 commit ${aria2Commit}；注册选项 ${registered.size}，启动期项 ${list.length}`);

// 顺手报一下对本工程设置页的实际影响面，避免生成完就没人核对
const metaPath = 'src/services/aria2-option-meta.js';
if (existsSync(metaPath)) {
  const meta = readFileSync(metaPath, 'utf8');
  const groups = meta.match(/export const GLOBAL_OPTION_GROUPS\s*=\s*\{([\s\S]*?)\n\};/);
  if (groups) {
    const rows = new Set();
    for (const [, , bodyText] of groups[1].matchAll(/'?([a-z0-9-]+)'?:\s*\[([\s\S]*?)\]/g)) {
      for (const m of bodyText.matchAll(/'([a-z0-9-]+)'/g)) rows.add(m[1]);
    }
    const hit = [...rows].filter((k) => startupOnly.has(k)).sort();
    console.log(`设置页全局分组共 ${rows.size} 个键，其中被置为只读的 ${hit.length} 个：`);
    console.log(`  ${hit.join(', ')}`);
  }
}
