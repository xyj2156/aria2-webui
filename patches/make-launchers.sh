#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 阿杰很厉害 <506907958@qq.com>
# Write the launchable layer of a release package into $OUT: the bundled
# aria2.conf, the start/stop launchers and README.txt.
#
# This lives apart from build-aria2-webui.sh on purpose: the packaging layer is
# the part a user edits and complains about, and it can be checked without a
# compiler, a container or an aria2 build.  Running it by hand and running it in
# CI go through exactly the same bytes.
#
# Required env:
#   OUT       directory to write into (must exist)
#   BIN_NAME  aria2c executable name inside OUT: aria2c | aria2c.exe
# Optional env:
#   PKG_MODE  win | unix (default: unix)
#
# Nothing here is committed; aria2.conf ships as UTF-8 without BOM, CRLF on
# Windows (so Notepad opens it readable) and LF elsewhere.
#
# The Windows launcher prints Chinese, which forces a code page decision: cmd.exe
# renders a .bat through the console code page (cp936 on a zh_CN install), so
# UTF-8 bytes come out as mojibake unless the script switches it first.  It
# therefore runs `chcp 65001` on the second line and the file is saved UTF-8
# *without* BOM (a BOM would print as stray characters before @echo off).  On
# Windows 10/11 — the only realistic target for this package — the default
# console font covers the glyphs used here; an antique console may show boxes,
# which is cosmetic: every path mentioned is also in README.txt.
set -euo pipefail

: "${OUT:?OUT is required}"
: "${BIN_NAME:?BIN_NAME is required}"
PKG_MODE="${PKG_MODE:-unix}"

# The panel has no login of its own, so the default listen scope differs per
# platform: a desktop should not expose it to the LAN, while these packages
# exist mostly to run on a NAS or server and are useless if local-only.  The
# key is written into the conf either way so that it stays discoverable, and
# both launchers enforce the same invariant — see below.
if [ "$PKG_MODE" = win ]; then
  RPC_LISTEN_ALL=false
else
  RPC_LISTEN_ALL=true
fi

# Write $1 from stdin, normalising line endings for the target platform.
emit() {
  local dest="$1"
  if [ "$PKG_MODE" = win ]; then
    awk '{ printf "%s\r\n", $0 }' > "$dest"
  else
    cat > "$dest"
  fi
}

# ---------------------------------------------------------------- aria2.conf
# Everything a user is expected to touch lives here rather than in the launcher,
# because aria2 gives command-line options precedence over the configuration
# file: a default left on the command line wins forever and makes the matching
# conf line look broken.  So the launchers pass only --conf-path.
# This heredoc is expanded (it interpolates $RPC_LISTEN_ALL), so do not put a
# literal $ in it.
emit "$OUT/aria2.conf" <<EOF
# aria2 配置 —— 本包的 aria2c 由启动脚本以 --conf-path 加载本文件
# 改完保存，跑一次 stop 再 start 就生效。键名不带前导短横线，一行一个「键=值」，
# 行首 # 是注释。请另存为 UTF-8（不要带 BOM，否则首行注释会被报 Unknown option）。
# 命令行参数的优先级高于本文件：临时覆盖用命令行，长期设置写这里。

#[RPC 与 Web UI]
enable-rpc=true
# 面板地址就是 http://localhost:本值/ ；改了端口，启动脚本里打开浏览器的端口要一起改
rpc-listen-port=6800
# 监听范围：false 只允许本机访问，true 允许局域网/其它机器访问。
# 面板自身没有登录，一旦开到局域网，同网段的任何设备都能控制下载、并把文件写到
# 磁盘任意位置，所以启动脚本规定了「暴露即鉴权」：
#   Windows：本值为 true 而 rpc-secret 未设时，本次启动强制退回只听本机并打印提示。
#   Linux/macOS：本值为 true 而 rpc-secret 未设时，start.sh 首启会生成一个随机密钥
#                追加到本文件末尾，并在终端打印一条已填好密钥的面板链接。
# 想停用密码，删掉那行 rpc-secret= 即可（公网直连永远不建议）。
rpc-listen-all=$RPC_LISTEN_ALL
# 设了密钥，就要在 Web UI 的「RPC 设置 / 密钥」里填同一个值；用 start.sh 打印的
# 链接（或手工拼 #rpc-secret=值）打开面板会自动填好并抹掉地址栏
#
# 值得设密码的另一个理由：WebSocket 不受 CORS 约束，而 aria2 的握手不校验来源，所以
# 没有密码时，你在这台机器上打开的任意网页都能直连 ws://localhost:6800/jsonrpc 来驱动
# 下载器——「只听本机」拦不住这一路，密码才是防线。只用本机也建议设一个。
#rpc-secret=your-password
# 只有从其它域名跨域访问面板时才需要，开了就等于放弃上面那层保护
#rpc-allow-origin-all=true

#[下载位置与日志]（相对路径按 aria2c 的工作目录解析，启动脚本已把工作目录切到本包目录）
dir=downloads
log=aria2.log
log-level=notice
# 0 = 不周期性写进度行，日志里只剩开始、结束和报错（默认 60 秒一次）
summary-interval=0

#[HTTP / FTP 下载]
# 断点续传：中断后重新添加同一地址，从断点接着下而不是从头来（默认 false）
continue=true
# 单文件切 5 段、同时用 5 条连接（默认 max-connection-per-server=1，而多数下载站
# 是按连接限速的，这一项对速度的影响最直接）
split=5
max-connection-per-server=5
# 每段不小于 1M 才切（默认 20M，几十兆的文件基本分不起来）
min-split-size=1M
timeout=60
# 每次重试前等 3 秒，避免瞬时故障被 5 次快速重试一口气用完（默认 0）
retry-wait=3
# 磁盘写缓冲（默认 16M）；预分配方式按需改：none 不预分配，falloc 快但个别文件系统不支持
disk-cache=16M
#file-allocation=none
# 整体限速，数值可带 K/M/G 后缀，0 为不限（默认 0）
#max-overall-download-limit=0
#max-overall-upload-limit=0
# 同时下载的任务数（默认 5）
#max-concurrent-downloads=5

#[BitTorrent]（用到再开，合理取值取决于你是只下还是长期做种）
# 站点/社区给的 tracker 列表，逗号分隔（默认空）
#bt-tracker=udp://...:1337/announce,http://...:80/announce
# 上传达到下载量的 1.0 倍就停止做种；PT 站一般要继续做种，把下面两项都设 0
#seed-ratio=1.0
#seed-time=0
# 单任务最大对等点数（默认 55）
#bt-max-peers=55
# DHT 与 BT 监听端口（默认都是 6881；路由器做了端口转发再改）
#dht-listen-port=6881
#listen-port=6881
# 局域网内自动发现对等点（默认 false）
#bt-enable-lpd=true

#[其它]
# 被下载站按 UA 拦时才改
#user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36
#http-proxy=http://127.0.0.1:7890
# save-session 只保存未完成任务列表，不保存你在 Web UI 里改过的全局设置
#save-session=session.dat
# input-file 指向的文件必须存在，否则 aria2 启动就报错退出——先手动建好空文件再开注释
#input-file=aria2.txt
EOF

# -------------------------------------------------------------- launchers
# Both scripts carry one safety invariant: the RPC is never exposed to the LAN
# without a password.  Command-line options outrank the conf file, which is
# what lets the Windows launcher clamp an unsafe setting for that run instead
# of silently honouring it.
if [ "$PKG_MODE" = win ]; then
  emit "$OUT/start.bat" <<'EOF'
@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 所有默认值都在同目录的 aria2.conf 里（端口、下载目录、日志等）。
rem 命令行参数优先级高于那个文件，所以别再往这里加业务默认值，否则用户改了不生效。
set "SAFEONLY="
findstr /b /c:"rpc-listen-all=true" aria2.conf >nul 2>&1 && (
  findstr /b /r /c:"rpc-secret=." aria2.conf >nul 2>&1 || set "SAFEONLY=--rpc-listen-all=false"
)
if defined SAFEONLY (
  echo.
  echo  注意：aria2.conf 把面板开放到局域网，却没有设 rpc-secret。
  echo  本次启动已强制只听本机，其它设备连不上是预期行为。
  echo  要在别的设备上用：先在 aria2.conf 里设好 rpc-secret，再重新 start。
)
start "aria2c" "%~dp0aria2c.exe" --conf-path="%~dp0aria2.conf" %SAFEONLY% %*
timeout /t 2 /nobreak >nul
start "" http://localhost:6800/
echo.
echo  aria2 已启动，面板地址： http://localhost:6800/
echo  改设置：下载目录、端口、并发、BT 等都在本目录 aria2.conf，改完 stop.bat 再 start.bat 生效。
echo  别的设备访问：把 localhost 换成本机的局域网 IP，且 aria2.conf 里 rpc-listen-all 要为 true。
echo.
echo  打不开面板时，按顺序排查：
echo   1. 地址要以 http 开头，端口要和 aria2.conf 的 rpc-listen-port 一致，不要写 /jsonrpc。
echo   2. 页面提示「RPC 密钥不正确」：把 aria2.conf 里 rpc-secret 的值填进面板的 RPC 设置。
echo   3. 页面完全打不开：先看本目录 aria2.log 的最后几行，通常是端口被占用或配置有笔误。
echo   4. 改过 rpc-listen-port：本文件最后一行的地址要一起改，否则浏览器还在打旧端口。
echo   5. 只有其它设备连不上：Windows 防火墙要放行该端口，首次启动弹的授权框点「允许」。
echo.
echo  停止：运行本目录 stop.bat；关掉这个窗口不影响后台继续下载。
echo  更多说明见本目录 README.txt 与 aria2.conf 里的中文注释。
echo.
pause
EOF
  printf '@echo off\r\ntaskkill /f /im %s >nul 2>&1\r\n' "$BIN_NAME" > "$OUT/stop.bat"
  emit "$OUT/README.txt" <<EOF
aria2c 内嵌 Web UI 版（Windows x64）

启动：双击 start.bat，浏览器打开 http://localhost:6800/
停止：双击 stop.bat（关掉 start.bat 的黑窗口不影响后台下载）

改设置
  全部默认值都在同目录的 aria2.conf 里：下载目录、监听端口、日志、并发与分片、
  BT 做种等，键名后的注释写明了作用与 aria2 的出厂默认值。改完保存，跑一次
  stop.bat 再 start.bat 生效。
  不要把同样的选项再抄进 start.bat —— aria2 里命令行参数的优先级高于配置文件，
  脚本里残留的默认值会一直赢，看起来就像配置文件不管用。

从手机或别的设备访问
  面板自身没有登录，所以本包规定「开放到局域网就必须有密码」：先在 aria2.conf
  里设好 rpc-secret，再把 rpc-listen-all 改成 true，然后把地址里的 localhost
  换成本机的局域网 IP。没设密码就改 true 的话，start.bat 会把这一次收回只听本机。
  Windows 首次监听新端口时防火墙会弹授权框，需要点「允许」。

许可
  见同目录 LICENSE、NOTICE、THIRD-PARTY-NOTICES.txt 与 LICENSES/ 下的全文。
EOF
else
  emit "$OUT/start.sh" <<'EOF'
#!/bin/sh
# 所有默认值都在同目录的 aria2.conf 里。命令行参数优先级高于那个文件，
# 所以本脚本只传 --conf-path；传给本脚本的额外参数会覆盖配置，这是有意的。
cd "$(dirname "$0")" || exit 1
CONF="$PWD/aria2.conf"

# 端口从配置里读回来，下面打印的地址才不会说谎。
PORT=$(grep '^rpc-listen-port=' "$CONF" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r')
[ -n "$PORT" ] || PORT=6800

# 面板自身没有登录。开到局域网又没有密码时，同网段任何设备都能驱动下载器、
# 并把文件写到该用户可写的任意位置——所以给它一个密码，而不是弹一句警告。
# 只在首次生成；想停用就把 aria2.conf 里那行 rpc-secret= 删掉。
if grep -q '^rpc-listen-all=true' "$CONF" 2>/dev/null \
   && ! grep -q '^rpc-secret=.' "$CONF" 2>/dev/null; then
  SECRET=$(od -An -tx1 -N 16 /dev/urandom 2>/dev/null | tr -d ' \n')
  if [ -n "$SECRET" ]; then
    {
      printf '\n# 由 start.sh 首次运行时生成：本包监听局域网，面板没有密码就等于敞开。\n'
      printf '# 想停用密码，删掉下面这行即可。\n'
      printf 'rpc-secret=%s\n' "$SECRET"
    } >> "$CONF"
    echo "已生成 RPC 密码并追加到 aria2.conf（因为本包默认开放局域网访问）。"
    echo "用下面这条已经带好密码的地址打开面板，会自动填上："
    echo
    echo "  http://localhost:$PORT/#rpc-secret=$SECRET"
    echo
    echo "从其它设备访问时，把 localhost 换成本机的地址。"
    echo "想改成无密码：删掉 aria2.conf 里的 rpc-secret 行（只建议在可信内网这么做）。"
    echo
  fi
fi

cat <<TXT
aria2 即将在本机启动，面板地址： http://localhost:$PORT/
 改设置：下载目录、端口、并发、BT 等都在同目录 aria2.conf，改完重启本脚本生效。
 别的设备访问：把 localhost 换成本机的局域网 IP，且 aria2.conf 里 rpc-listen-all 要为 true。

 打不开面板时，按顺序排查：
  1. 地址以 http 开头，端口与 aria2.conf 的 rpc-listen-port 一致，不要写 /jsonrpc。
  2. 页面提示「RPC 密钥不正确」：把 aria2.conf 里 rpc-secret 的值填进面板的 RPC 设置。
  3. 页面完全打不开：看同目录 aria2.log 的最后几行，多为端口被占用或配置有笔误。
  4. 端口没监听：用 ss -lntp 或 lsof -i:$PORT 确认 aria2c 还活着。
  5. 只有其它设备连不上：本机防火墙（firewalld/ufw）需要放行 $PORT 端口。

 停止：本脚本在前台运行，Ctrl+C 即可；更多说明见 README.txt 与 aria2.conf 的注释。

TXT
exec "./aria2c" --conf-path="$CONF" "$@"
EOF
  chmod +x "$OUT/start.sh"
  emit "$OUT/README.txt" <<EOF
aria2c 内嵌 Web UI 版（$PKG_MODE）

启动：./start.sh，然后浏览器打开 http://<本机地址>:6800/
停止：前台运行时 Ctrl+C

改设置
  全部默认值都在同目录的 aria2.conf 里：下载目录、监听端口、日志、并发与分片、
  BT 做种等，键名后的注释写明了作用与 aria2 的出厂默认值。改完重启本脚本生效。
  不要把同样的选项再抄进 start.sh —— aria2 里命令行参数的优先级高于配置文件，
  脚本里残留的默认值会一直赢，看起来就像配置文件不管用。

密码与远程访问
  面板自身没有登录，本包默认把端口开放到局域网，所以首次运行 start.sh 会生成一个
  随机 RPC 密码、追加进 aria2.conf，并在终端打印一条已经带好密码的地址；从别的
  设备访问时把地址里的 localhost 换成本机地址，再在面板的 RPC 设置里填同一个密码。
  想关掉密码：删掉 aria2.conf 里那行 rpc-secret=，同时建议把 rpc-listen-all 改成
  false（只听本机）。公网直连永远不建议这么做。

许可
  见同目录 LICENSE、NOTICE、THIRD-PARTY-NOTICES.txt 与 LICENSES/ 下的全文。
EOF
fi

echo "==> launchers written to $OUT (PKG_MODE=$PKG_MODE, rpc-listen-all=$RPC_LISTEN_ALL)"
