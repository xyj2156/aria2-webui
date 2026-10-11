# patches/ —— 把 Web UI 内嵌进 aria2c（多平台）

这里的内容让 GitHub Actions 能：克隆 aria2 fork、打内嵌补丁、把本仓库构建的
Web UI 打进二进制，为 **Windows / Linux / macOS** 各产出一个自洽的 `aria2c`
（内嵌面板，UI 走浏览器），并发布 GitHub Release。
**不修改 aria2 fork 仓库本身**——所有改动以补丁形式随本仓库走。

## 文件

- `aria2-embed-webui.patch` —— 对 aria2 源码的改动（`git apply`），跨平台通用：
  - 新增 `src/WebUiServer.{h,cc}`：内嵌 blob 的 base64 解码 + zlib 解压 + AWEB 索引解析 + 按请求路径查表回吐（防目录穿越、不拦截 `/jsonrpc`）。
  - 改 `src/HttpServerCommand.cc`：认证后、WebSocket/RPC 前插入 GET 静态回包分支；静态资源 `disableGZip()`（修 aria2 谎报 `Content-Encoding: gzip` 导致浏览器 `ERR_CONTENT_DECODING_FAILED`）。
  - 改 `src/Makefile.am`：登记 `WebUiServer.cc WebUiServer.h WebUiBlob.cc`。
  - 基线 `release-1.37.0`（已 `git apply --check` 验证）。
- `gen_webui_blob.mjs` —— 生成器：把 Web UI 的 `dist/` 打包成 `src/WebUiBlob.cc`
  （AWEB 索引 → zlib deflate → base64 → C++ 字符串常量）。产物是生成物，不入库。
- `build-aria2-webui.sh` —— 通用构建脚本（跨平台），env 驱动：
  `ARIA2_SRC` 干净的 aria2 源码、`WEBUI_DIST` 构建好的 dist、`OUT` 输出目录、
  `CONF_EXTRA` 该平台 configure 参数、`PKG_MODE` win|unix、`STRIP` 剥离工具。
  流程：`git apply` 补丁 → 生成 blob → 跳过 autopoint 的 `autoreconf -i -f`
  （附 `config.rpath`/`po/Makefile.in.in` 兜底）→ `configure` → `make` →
  `make install` 取真身 → strip → 生成 start/stop 启动脚本。

## 各平台构建载体（见 .github/workflows/release.yml）

- Windows x64：`docker/Dockerfile.win`（Linux 上 mingw-w64 交叉，依赖全静态，
  TLS 走 WinTLS/SChannel，产单个 `aria2c.exe`，零 DLL）。
- Linux x64：`docker/Dockerfile.linux`（Alpine/musl 全静态，TLS 走静态 OpenSSL，
  产不依赖发行版的单个 `aria2c`）。
- macOS arm64：`macos-14` runner 原生编译（Homebrew 依赖、跳过 `brew update`，
  TLS 走静态 OpenSSL）。暂不出 Intel(x86_64) 产物——`macos-13` 镜像临近下线、
  排队动辄数小时，且 Homebrew arm64 bottle 无 x86_64 切片，通用二进制不划算。

## 本地复现（示例：Linux 静态）

```sh
pnpm build
git clone --depth 1 --branch release-1.37.0 https://github.com/xyj2156/aria2-original ../aria2
docker build -f docker/Dockerfile.linux -t awl .
docker run --rm -v "$PWD":/w \
  -e ARIA2_SRC=/w/../aria2 -e WEBUI_DIST=/w/dist -e OUT=/w/out/linux -e PKG_MODE=unix \
  -e CONF_EXTRA="--enable-static --disable-shared --disable-nls --with-openssl --without-gnutls --with-libexpat --without-libxml2 --with-libcares --with-libssh2 --with-sqlite3 --with-zlib --with-libgmp --without-libgcrypt --without-libnettle LDFLAGS=-static CFLAGS=-static CXXFLAGS=-static" \
  awl bash /w/patches/build-aria2-webui.sh
```

## 说明

- 补丁与生成器平台无关，三端复用；差异只在工具链与 `CONF_EXTRA`。
- 触发：推 `v*` tag（webui 独立版本号）；也可 `workflow_dispatch` 手动跑。
- Release 产物：每个平台一个 zip，命名 `aria2-<aria2tag>-webui-<ref>-<平台>.zip`。
