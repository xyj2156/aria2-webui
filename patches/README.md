# patches/ —— 把 Web UI 内嵌进 aria2c（多平台）

这里的内容让 GitHub Actions 能：按钉死的 commit 克隆上游 aria2、打内嵌补丁、把本仓库
构建的 Web UI 打进二进制，为 **Windows / Linux / macOS** 各产出一个自洽的 `aria2c`
（内嵌面板，UI 走浏览器），连同**对应源码包**一起发布 GitHub Release。
**不修改 aria2 上游仓库本身**——所有改动以补丁形式随本仓库走。

## 文件

- `aria2-embed-webui.patch` —— 对 aria2 源码的改动（`git apply`），跨平台通用：
  - 新增 `src/WebUiServer.{h,cc}`：内嵌 blob 的 base64 解码 + zlib 解压 + AWEB 索引解析 + 按请求路径查表回吐（防目录穿越、不拦截 `/jsonrpc`）。
  - 改 `src/HttpServerCommand.cc`：认证后、WebSocket/RPC 前插入 GET 静态回包分支；静态资源 `disableGZip()`（修 aria2 谎报 `Content-Encoding: gzip` 导致浏览器 `ERR_CONTENT_DECODING_FAILED`）。
  - 改 `src/Makefile.am`：登记 `WebUiServer.cc WebUiServer.h WebUiBlob.cc`。
  - 基线 `release-1.37.0`（commit `02f2d0d8472b3c38c29b4dba8c75ebd5fdd2899a`）。补丁内对被改动的上游文件带 `Modified by … <日期>` 的显著修改通告，对新增文件带完整 GPL 头部——这是 GPLv2 §2(a) / GPLv3 §5(a) 的要求，不只是礼貌。
- `clone-aria2.sh` —— 唯一的取源码入口：按 `ARIA2_TAG` 做 depth-1 克隆，**校验 HEAD 等于 `ARIA2_SHA`**，并 `git apply --check` 确认补丁可用；任一不符即失败。钉死的原因见上。
- `gen_webui_blob.mjs` —— 生成器：把 Web UI 的 `dist/` 打包成 `src/WebUiBlob.cc`
  （AWEB 索引 → zlib deflate → base64 → C++ 字符串常量）。产物是生成物，不入库。
- `build-aria2-webui.sh` —— 通用构建脚本（跨平台），env 驱动：
  `ARIA2_SRC` 干净的 aria2 源码、`WEBUI_DIST` 构建好的 dist、`OUT` 输出目录、
  `CONF_EXTRA` 该平台 configure 参数、`PKG_MODE` win|unix、`STRIP` 剥离工具。
  流程：`git apply` 补丁 → 生成 blob → 跳过 autopoint 的 `autoreconf -i -f`
  （附 `config.rpath`/`po/Makefile.in.in` 兜底）→ `configure` → `make` →
  `make install` 取真身 → strip → 调 `make-launchers.sh` 产出可启动层。
- `make-launchers.sh` —— 发布包「可启动层」的唯一生成点：包内 `aria2.conf`、
  `start.bat`/`stop.bat`（win）或 `start.sh`（unix）、`README.txt`。单独成文件是因为
  这一层用户会改、会来提 issue，而它不需要编译器就能验证——本地按 `PKG_MODE` 跑一次
  就是 CI 逐字产出的那份内容。换行按平台走（win 出 CRLF、其余 LF），全部无 BOM。
- `LICENSE-BUNDLE` / `NOTICE-BUNDLE` —— 发布进每个**二进制包**的 `LICENSE` / `NOTICE`：
  说明组合作品三部分授权（aria2c=GPL-3.0-or-later、内嵌界面=Apache-2.0、启动脚本=Apache-2.0）、
  无担保、以及对应源码的取得途径。未内嵌进二进制的 `dist` 包不放这两份，它只有 Apache-2.0。

许可证全文与第三方组件清单不在本目录，见仓库根的 `licenses/`（含 `manifest.json`）与
`scripts/gen-third-party-notices.mjs`；两者是发布包内 `LICENSES/` 与
`THIRD-PARTY-NOTICES.txt` 的唯一来源。

## 各平台构建载体（见 .github/workflows/release.yml）

- Windows x64：`docker/Dockerfile.win`（Linux 上 mingw-w64 交叉，依赖全静态，
  TLS 走 WinTLS/SChannel——**不链 OpenSSL**，产单个 `aria2c.exe`，零 DLL）。
- Linux x64：`docker/Dockerfile.linux`（Alpine/musl 全静态，TLS 走静态 OpenSSL，
  产不依赖发行版的单个 `aria2c`）。
- macOS arm64：`macos-14` runner 原生编译（Homebrew 依赖、跳过 `brew update`，
  TLS 走静态 OpenSSL）。暂不出 Intel(x86_64) 产物——`macos-13` 镜像临近下线、
  排队动辄数小时，且 Homebrew arm64 bottle 无 x86_64 切片，通用二进制不划算。

## 本地复现（示例：Linux 静态）

```sh
pnpm build
ARIA2_REPO=aria2/aria2 ARIA2_TAG=release-1.37.0 \
ARIA2_SHA=02f2d0d8472b3c38c29b4dba8c75ebd5fdd2899a \
  bash patches/clone-aria2.sh ../aria2
docker build -f docker/Dockerfile.linux -t awl .
docker run --rm -v "$PWD":/w \
  -e ARIA2_SRC=/w/../aria2 -e WEBUI_DIST=/w/dist -e OUT=/w/out/linux -e PKG_MODE=unix \
  -e CONF_EXTRA="--enable-static --disable-shared --disable-nls --with-openssl --without-gnutls --with-libexpat --without-libxml2 --with-libcares --with-libssh2 --with-sqlite3 --with-zlib --with-libgmp --without-libgcrypt --without-libnettle LDFLAGS=-static CFLAGS=-static CXXFLAGS=-static" \
  awl bash /w/patches/build-aria2-webui.sh
```

## 发布产物

触发：推 `v*` tag；或 `workflow_dispatch` 并填 `release_tag` 以重发某个既有版本
（分支运行的 `github.ref_name` 是分支名，不填就会把产物命名成 `…-webui-main-…`）。

- 每个平台一个 zip：`aria2-<aria2tag>-webui-<版本>-<平台>.zip`，包内是二进制 +
  `aria2.conf` + 启动脚本 + `README.txt`，另有 `LICENSE`、`NOTICE`、
  `THIRD-PARTY-NOTICES.txt` 与 `LICENSES/` 全文。
- `aria2-webui-<版本>-dist.zip`：未打包进二进制的 Web UI 静态产物，只带 Apache-2.0 授权与前端依赖声明。
- `aria2-<aria2tag>-webui-<版本>-sources.tar.gz`：GPL 对应源码——已打补丁的 aria2 源码树
  （含生成的 `src/WebUiBlob.cc`）+ `build-recipe/`（本仓库 `git archive` 的完整构建配方）。

## 说明

- 补丁与生成器平台无关，三端复用；差异只在工具链与 `CONF_EXTRA`。
- 换 aria2 基线时，`ARIA2_TAG`、`ARIA2_SHA`、`licenses/manifest.json` 的 `upstream` 段
  必须一起改——`clone-aria2.sh` 会在不一致时直接失败，而不是悄悄构建出对不上号的东西。
- 为什么所有默认值都放 `aria2.conf`、启动脚本只传 `--conf-path`：**aria2 里命令行参数的
  优先级高于配置文件**（实测：conf 写 6813、命令行写 6816，实际只听 6816）。只要启动脚本
  还留着 `--rpc-listen-port`/`--dir`/`--log`，用户在 `aria2.conf` 里改这几项就永远无效，
  配置文件看着像坏了。这一条不变，脚本里就不能再塞回任何业务默认值。
- 生成 `aria2.conf` 时已实测确认：CRLF 会被正确剥离、中文注释安全、**UTF-8 BOM 会让首行
  注释变成 `Unknown option` 告警**（不致命，但每台机器都难看）；`console-level`、
  `bt-tracker-partition`、`rpc-listen-address`、`rpc-save-upload-area` 不能作为 conf 键
  （命令行专用或不存在）；`input-file=` 指向不存在的文件会让 aria2 启动即退出，所以该项
  只能注释着给说明。
- 不变式「暴露即鉴权」：面板自身没有登录，`rpc-listen-all=true` 而同网段任何设备都能驱动
  下载器并把文件写到磁盘任意位置。因此 Linux/macOS 的 `start.sh` 首启会自动生成随机密钥
  追加进 `aria2.conf` 并打印一条已填密钥的链接；Windows 的 `start.bat` 则用命令行
  `--rpc-listen-all=false` 把这一轮强制收回本机（命令行优先级高于 conf，正好可用作兜底），
  并打印原因。面板侧由 `src/composables/use-url-secret.js` 采纳 `#rpc-secret=` 并用
  `replaceState` 抹掉地址栏。
