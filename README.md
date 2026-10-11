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
- **中英双语**：界面内置 `zh-CN` / `en-US` 两套语言，跟随浏览器或手动切换。

- **Multiple connections**: switch between several aria2 RPC endpoints from the top bar; credentials are kept locally.
- **Task views**: downloading / waiting / stopped / completed groups, with pause, resume, remove, sort, and drag-to-reorder of the waiting queue.
- **Piece visualization**: per-chunk (pieces) progress rendered as a chart.
- **Global speed**: live download/upload throughput and a global-status overlay.
- **Rich settings**: theme (light/dark), language, global speed limit, page-title refresh interval, plus aria2 RPC settings and Web-UI-specific settings.
- **Bilingual UI**: built-in `zh-CN` / `en-US`, following the browser or manually switched.

## 技术栈 / Tech Stack

Vue 3 · Vite · Pinia · vue-router · Naive UI · UnoCSS · Pug · ECharts · VueUse。RPC 层同时支持 HTTP 与 WebSocket 两种 JSON-RPC 传输。

Vue 3 · Vite · Pinia · vue-router · Naive UI · UnoCSS · Pug · ECharts · VueUse. The RPC layer supports both HTTP and WebSocket JSON-RPC transports.

## 开发 / Development

本项目使用 [pnpm](https://pnpm.io/) 作为包管理器。

This project uses [pnpm](https://pnpm.io/) as its package manager.

```bash
pnpm install
pnpm dev       # 启动开发服务器 / start dev server
pnpm build     # 生产构建，产物在 dist/ / production build → dist/
pnpm preview   # 预览构建结果 / preview the build
```

开发时通过环境变量 `VITE_ARIA2_HOST` / `VITE_ARIA2_SECRET` 等指定默认 RPC 端点（详见 `src/rpc`）。

During development, the default RPC endpoint can be set via env vars such as `VITE_ARIA2_HOST` / `VITE_ARIA2_SECRET` (see `src/rpc`).

## 内嵌进 aria2c 的单文件发布 / Single-binary aria2c release

仓库根目录下的 `patches/`、`docker/` 与 `.github/workflows/release.yml` 共同实现多平台发布：

The `patches/`, `docker/`, and `.github/workflows/release.yml` in this repo together build multi-platform releases:

1. 构建本 Web UI 得到 `dist/`。
2. 克隆打过基础改动的 aria2 fork，应用 `patches/aria2-embed-webui.patch`（把内嵌 blob 的解码/解压/查表回吐逻辑挂进 aria2 的 HTTP 服务，与 JSON-RPC 同端口同源）。
3. 用 `patches/gen_webui_blob.mjs` 把 `dist/` 打成内嵌资源。
4. 分别为 **Windows x64（mingw 交叉、全静态）/ Linux x64（Alpine musl 全静态）/ macOS（arm64 原生）** 编出自洽的单文件 `aria2c`。
5. 打 tag（`v*`）时汇总并发布 GitHub Release。

1. Build this Web UI into `dist/`.
2. Clone the aria2 fork and apply `patches/aria2-embed-webui.patch` (hooks blob decode/decompress/lookup into aria2's HTTP server, same-origin with the JSON-RPC port).
3. Pack `dist/` into an embedded resource via `patches/gen_webui_blob.mjs`.
4. Cross-compile self-contained single-file `aria2c` for **Windows x64 (mingw, fully static) / Linux x64 (Alpine musl, fully static) / macOS (native arm64)**.
5. On a `v*` tag, assemble and publish a GitHub Release.

> 提示：`workflow_dispatch` 手动触发只跑各平台构建以验证流水线，**不会**创建 Release；Release 仅在推送 `v*` 标签时产生。
>
> Note: a `workflow_dispatch` run only builds the platform artifacts to validate the pipeline and does **not** create a Release; Releases are produced only on `v*` tag pushes.

详见 [`patches/README.md`](./patches/README.md)。

See [`patches/README.md`](./patches/README.md) for details.

## 许可 / License

本 Web UI 源码以 **Apache License 2.0** 授权，详见 [`LICENSE`](./LICENSE) 与 [`NOTICE`](./NOTICE)。由上述流水线将界面内嵌进 aria2 后产生的组合作品，其分发仍需遵守 **aria2 自身的许可证（GPL）** 条款。

This Web UI source is licensed under the **Apache License 2.0** — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Combined binaries that embed this UI into aria2 via the pipeline above remain subject to **aria2's own license (GPL)** terms when distributed.

再次感谢 aria2 及其作者 [Tatsuhiro Tsujikawa](https://github.com/tatsuhiro-t)。

Once again, thank you to aria2 and its author, [Tatsuhiro Tsujikawa](https://github.com/tatsuhiro-t).
