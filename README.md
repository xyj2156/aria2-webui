# Aria2 WebUI

一个现代化的 [aria2](https://github.com/aria2/aria2) 图形化管理界面（Web UI），基于 Vue 3 + Vite 构建。它通过 aria2 的 JSON-RPC 接口管理下载任务，并可借助本仓库的补丁与 CI 流水线，**将整个界面内嵌进 `aria2c` 单一可执行文件**——下载即打开浏览器访问，无需另配 Web 服务器、无跨域问题。

An out-of-the-box, modern web UI for [aria2](https://github.com/aria2/aria2), built with Vue 3 + Vite. It manages download tasks over aria2's JSON-RPC interface, and — with the patches and CI pipeline in this repository — can **embed the entire UI directly into the `aria2c` binary**, so you just run the executable and open a browser. No separate web server, no CORS.

---

## 致谢与声明 / Acknowledgement & Disclaimer

> 本项目是 aria2 的**第三方**图形化界面，与 aria2 官方**无任何隶属或背书关系**。
>
> **特别感谢 aria2 的作者 [Tatsuhiro Tsujikawa（@tatsuhiro-t）](https://github.com/tatsuhiro-t) 以及全体贡献者。** 正是 aria2 这一强大、优雅、跨平台的开源下载工具奠定了本项目的一切。"aria2" 名称、相关商标及其源码版权均归其各自权利人所有，本项目仅在合规前提下引用与依赖它们。
>
> This is an **unofficial, third-party** web UI for aria2 and is **not affiliated with or endorsed by** the aria2 project.
>
> **A special thank-you to [Tatsuhiro Tsujikawa (@tatsuhiro-t)](https://github.com/tatsuhiro-t), the author of aria2, and to all of its contributors.** Everything this project does stands on the shoulders of aria2 — a powerful, elegant, cross-platform open-source download tool. The "aria2" name, related trademarks, and aria2's source copyright belong to their respective owners and are referenced/depended upon here only under their respective licenses.

---

## 功能特性 / Features

- **多连接管理**：顶栏可在多个 aria2 RPC 端点间随时切换，凭据保存在本地。
- **任务视图**：下载中 / 等待 / 已停止 / 已完成分组，支持暂停、恢复、移除、排序、拖拽调整等待队列。
- **分片可视化**：以图表方式渲染分片（pieces）进度，直观看到每个分块的状态。
- **全局速率**：实时下载/上传速率与全局状态浮层。
- **完善设置**：主题（明/暗）、语言、全局速率限制、页面标题刷新间隔等；含 aria2 RPC 设置与 Web UI 自身设置。
- **11 种语言**：`zh-CN` / `zh-TW` / `en-US` / `de-DE` / `fr-FR` / `es-ES` / `it-IT` / `ja-JP` / `pl-PL` / `ru-RU` / `cs-CZ`，跟随浏览器或手动切换；语言包按需动态加载。

- **Multiple connections**: switch between several aria2 RPC endpoints from the top bar; credentials are kept locally.
- **Task views**: downloading / waiting / stopped / completed groups, with pause, resume, remove, sort, and drag-to-reorder of the waiting queue.
- **Piece visualization**: per-chunk (pieces) progress rendered as a chart.
- **Global speed**: live download/upload throughput and a global-status overlay.
- **Rich settings**: theme (light/dark), language, global speed limit, page-title refresh interval, plus aria2 RPC settings and Web-UI-specific settings.
- **11 语言界面 / 11-language UI**: `zh-CN` / `zh-TW` / `en-US` / `de-DE` / `fr-FR` / `es-ES` / `it-IT` / `ja-JP` / `pl-PL` / `ru-RU` / `cs-CZ`, following the browser or manually switched; language packs load on demand.

## 技术栈 / Tech Stack

Vue 3 · Vite · Pinia · vue-router · Naive UI · UnoCSS · Pug · ECharts · VueUse。RPC 层同时支持 HTTP 与 WebSocket 两种 JSON-RPC 传输。

Vue 3 · Vite · Pinia · vue-router · Naive UI · UnoCSS · Pug · ECharts · VueUse. The RPC layer supports both HTTP and WebSocket JSON-RPC transports.

## 开发 / Development

本项目使用 [pnpm](https://pnpm.io/) 作为包管理器。

This project uses [pnpm](https://pnpm.io/) as its package manager.

```bash
pnpm install
pnpm dev       # 启动开发服务器 / start dev server
pnpm build     # 生产构建（先跑 i18n 审计），产物在 dist/ / production build (runs the i18n audit first) → dist/
pnpm preview   # 预览构建结果 / preview the build
pnpm i18n:audit # 只做语言包体检 / run only the language-pack audit
```

多语言：界面文案在 `src/i18n/locales/<语言代码>.yaml`（键集以 `zh-CN.yaml` 为准），母语自称与浏览器语言别名在 `src/i18n/languages.json`，组件库内置文案的按需入口在 `src/i18n/naive.js`。**加一门语言 = 丢一个 yaml + 在 languages.json 登记一行**，语言包由 `import.meta.glob` 自动发现；`pnpm build` 前置的 `scripts/i18n-audit.mjs` 会盯住注册表一一对应、键集与 `{占位符}` 一致、代码里 `t('键')` 无缺漏、Naive 侧有入口，不通过就出不了产物。

Internationalization: UI strings live in `src/i18n/locales/<locale>.yaml` (key set anchored on `zh-CN.yaml`), native self-names and browser-language aliases in `src/i18n/languages.json`, and the on-demand component-library locales in `src/i18n/naive.js`. **Adding a language means dropping in one yaml file and one registry line** — packs are discovered via `import.meta.glob`, and `scripts/i18n-audit.mjs` (a build prerequisite) enforces registry parity, key/placeholder parity, no dangling `t('key')` references and Naive UI coverage.

开发时通过环境变量 `VITE_ARIA2_HOST` / `VITE_ARIA2_SECRET` 等指定默认 RPC 端点（详见 `src/rpc`）。

During development, the default RPC endpoint can be set via env vars such as `VITE_ARIA2_HOST` / `VITE_ARIA2_SECRET` (see `src/rpc`).

## 内嵌进 aria2c 的单文件发布 / Single-binary aria2c release

仓库根目录下的 `patches/`、`docker/` 与 `.github/workflows/release.yml` 共同实现多平台发布：

The `patches/`, `docker/`, and `.github/workflows/release.yml` in this repo together build multi-platform releases:

1. 构建本 Web UI 得到 `dist/`。
2. 按 `release.yml` 里钉死的 tag 与 commit 克隆上游 aria2（`patches/clone-aria2.sh` 校验 commit 并确认补丁可应用），再应用 `patches/aria2-embed-webui.patch`（把内嵌 blob 的解码/解压/查表回吐逻辑挂进 aria2 的 HTTP 服务，与 JSON-RPC 同端口同源）。
3. 用 `patches/gen_webui_blob.mjs` 把 `dist/` 打成内嵌资源。
4. 分别为 **Windows x64（mingw 交叉、全静态）/ Linux x64（Alpine musl 全静态）/ macOS（arm64 原生）** 编出自洽的单文件 `aria2c`。
5. 打 tag（`v*`）时汇总并发布 GitHub Release。

1. Build this Web UI into `dist/`.
2. Clone upstream aria2 at the tag and commit pinned in `release.yml` (`patches/clone-aria2.sh` verifies the commit and that the patch applies), then apply `patches/aria2-embed-webui.patch` (hooks blob decode/decompress/lookup into aria2's HTTP server, same-origin with the JSON-RPC port).
3. Pack `dist/` into an embedded resource via `patches/gen_webui_blob.mjs`.
4. Cross-compile self-contained single-file `aria2c` for **Windows x64 (mingw, fully static) / Linux x64 (Alpine musl, fully static) / macOS (native arm64)**.
5. On a `v*` tag, assemble and publish a GitHub Release.

> 提示：`workflow_dispatch` 手动触发默认只跑各平台构建以验证流水线，**不**发布 Release；推送 `v*` 标签时才会发布。若需要**重发某个已存在的版本**（例如修正该版本产物里缺失的许可随件），在 `workflow_dispatch` 的 `release_tag` 里填入该 tag 即可，它会覆盖同名资产而不动标签历史。
>
> Note: a `workflow_dispatch` run only builds the platform artifacts to validate the pipeline and does **not** publish unless it is told which release it stands for; Releases are produced on `v*` tag pushes. To **re-publish an existing version** (for example to fix license files missing from its artifacts), pass that tag in the `release_tag` input — assets with the same name are replaced and the tag history is left alone.

详见 [`patches/README.md`](./patches/README.md)。

See [`patches/README.md`](./patches/README.md) for details.

## 许可 / License

- **本仓库的 Web UI 源码（`src/`、`patches/gen_webui_blob.mjs`、`patches/build-aria2-webui.sh` 等构建脚本）** 以 **Apache License 2.0** 授权，详见 [`LICENSE`](./LICENSE) 与 [`NOTICE`](./NOTICE)。
- **`patches/aria2-embed-webui.patch` 对 aria2 源码的改动，以及由该补丁与本仓库流水线编译出的 `aria2c` 单文件二进制**，属于 aria2 的衍生作品。aria2 本身采用 **GPLv2 or later**；本项目在分发修改版时**行使 "or later" 条款，按 GNU General Public License v3.0 分发**。这样做是因为 Apache-2.0 与 GPLv2 不兼容，但与 GPLv3 兼容，Web UI 的 Apache-2.0 代码因此可以合法地被打包进组合作品。
- **GPL 对应源码获取（GPLv3 第一节 "Corresponding Source"）**：每个 Release 都附带 `aria2-<aria2-tag>-webui-<版本>-sources.tar.gz`，里面是**已打补丁的完整 aria2 源码树**加上重建这批二进制所需的构建配方（blob 生成脚本、构建脚本、容器镜像、CI 工作流），源码基线钉死在上游 aria2 的一个 tag 与 commit 上（见 `release.yml` 的 `ARIA2_TAG` / `ARIA2_SHA`，以及 `licenses/manifest.json`）。这是履行对应源码义务的主要方式；`patches/README.md` 的"本地复现"步骤可 1:1 重放同一过程。若你拿不到该资产，开 issue 或按 `NOTICE` 里的地址联系作者，自本次分发起至少三年内仍会提供完整源码——这条承诺是补充便利，不是履行方式的替代。
- **随包许可文件 / files inside every archive**：`LICENSE`（组合作品的授权说明）、`NOTICE`、`THIRD-PARTY-NOTICES.txt`（由 `scripts/gen-third-party-notices.mjs` 从 `licenses/manifest.json` 与 `pnpm-lock.yaml` 生成）、以及 `LICENSES/` 下各许可证全文。静态链入库包含 OpenSSL、c-ares、Expat、SQLite、zlib、libssh2、GNU MP、musl、MinGW-w64 runtime、winpthread 与 libstdc++/libgcc（后两者按 GCC 运行库例外使用）。

- **The Web UI sources in this repo** (`src/`, the build scripts under `patches/`) are licensed under **Apache License 2.0** — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
- **The patch against aria2 (`patches/aria2-embed-webui.patch`) and the resulting single-file `aria2c` binaries distributed via Releases** are derivative works of aria2, which itself is licensed under **GPLv2 or later**. This project exercises the "or later" clause and distributes the modified aria2 under **GPLv3**. This is deliberate: Apache-2.0 is incompatible with GPLv2 but compatible with GPLv3, which lets the Apache-2.0 Web UI be legally bundled into the combined work.
- **Corresponding source code (GPLv3 section 1)**: every release carries an `aria2-<aria2-tag>-webui-<version>-sources.tar.gz` asset containing the **fully patched aria2 source tree** plus the recipe needed to rebuild these binaries (blob generator, build scripts, container images, CI workflow). The source baseline is pinned to one upstream aria2 tag and commit (`ARIA2_TAG` / `ARIA2_SHA` in `release.yml`, mirrored in `licenses/manifest.json`). That asset is the primary way this obligation is met; the "local reproduction" steps in [`patches/README.md`](./patches/README.md) replay the same process 1:1. If you cannot obtain the asset, open an issue or write to the address in `NOTICE` and a complete copy will still be provided for at least three years after this release — that offer is a convenience on top of the asset, not a substitute for it.
- **License files inside every archive**: `LICENSE` (how the combined work is granted), `NOTICE`, `THIRD-PARTY-NOTICES.txt` (generated by `scripts/gen-third-party-notices.mjs` from `licenses/manifest.json` and the pnpm lockfile) and the full texts under `LICENSES/`. Statically linked components include OpenSSL, c-ares, Expat, SQLite, zlib, libssh2, GNU MP, musl, the MinGW-w64 runtime and winpthread, plus libstdc++/libgcc used under the GCC Runtime Library Exception.

再次感谢 aria2 及其作者 [Tatsuhiro Tsujikawa](https://github.com/tatsuhiro-t)。

Once again, thank you to aria2 and its author, [Tatsuhiro Tsujikawa](https://github.com/tatsuhiro-t).
