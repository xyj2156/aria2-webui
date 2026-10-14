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
# Windows (so Notepad opens it readable) and LF elsewhere.  The launchers and
# README.txt stay ASCII-only: cmd.exe renders a .bat through the console code
# page, and a shell on a NAS may not be UTF-8 at all, while the conf file itself
# is read by aria2 directly and handles UTF-8 fine.
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
cd /d "%~dp0"
rem Every default lives in aria2.conf (port, download folder, log, ...).
rem Options given after --conf-path below override that file, on purpose.
rem If you changed rpc-listen-port, adjust the URL at the end of this file too.
set "SAFEONLY="
findstr /b /c:"rpc-listen-all=true" aria2.conf >nul 2>&1 && (
  findstr /b /r /c:"rpc-secret=." aria2.conf >nul 2>&1 || set "SAFEONLY=--rpc-listen-all=false"
)
if defined SAFEONLY (
  echo [aria2-webui] aria2.conf asks for LAN access but sets no rpc-secret.
  echo [aria2-webui] This run listens on 127.0.0.1 only. To use the panel from
  echo [aria2-webui] another device, set rpc-secret in aria2.conf and start again.
)
start "aria2c" "%~dp0aria2c.exe" --conf-path="%~dp0aria2.conf" %SAFEONLY% %*
timeout /t 2 /nobreak >nul
start "" http://localhost:6800/
pause
EOF
  printf '@echo off\r\ntaskkill /f /im %s >nul 2>&1\r\n' "$BIN_NAME" > "$OUT/stop.bat"
  emit "$OUT/README.txt" <<EOF
aria2c with embedded Web UI (Windows x64)

Run start.bat, then open http://localhost:6800/

Settings: edit aria2.conf in this folder, then run stop.bat followed by
start.bat.  Do not put the same option into start.bat as well - command-line
options take precedence over aria2.conf, so a leftover there silently wins and
the settings file looks broken.

LAN access is off by default and stays off unless aria2.conf carries an
rpc-secret, because the panel has no login of its own.  Set rpc-secret in
aria2.conf and switch rpc-listen-all to true to reach it from other devices.

Licenses: see LICENSE, NOTICE, THIRD-PARTY-NOTICES.txt and LICENSES/.
EOF
else
  emit "$OUT/start.sh" <<'EOF'
#!/bin/sh
# Every default lives in aria2.conf.  Arguments given to this script override
# it, on purpose, since command-line options outrank the configuration file.
cd "$(dirname "$0")" || exit 1
CONF="$PWD/aria2.conf"

# Read the port back out of the conf so the link printed below stays honest.
PORT=$(grep '^rpc-listen-port=' "$CONF" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r')
[ -n "$PORT" ] || PORT=6800

# The panel has no login of its own.  When it is exposed to the LAN without a
# password, any device on that network can drive the downloader and write files
# anywhere this user may write - so give it a password instead of a warning.
# Generated once; delete the rpc-secret line from aria2.conf to turn it off.
if grep -q '^rpc-listen-all=true' "$CONF" 2>/dev/null \
   && ! grep -q '^rpc-secret=.' "$CONF" 2>/dev/null; then
  SECRET=$(od -An -tx1 -N 16 /dev/urandom 2>/dev/null | tr -d ' \n')
  if [ -n "$SECRET" ]; then
    {
      printf '\n# Generated by start.sh: this package listens on the LAN, and the\n'
      printf '# panel has no login without it.  Delete to disable.\n'
      printf 'rpc-secret=%s\n' "$SECRET"
    } >> "$CONF"
    echo "An RPC password was generated and appended to aria2.conf."
    echo "Open the panel with the password already filled in:"
    echo
    echo "  http://localhost:$PORT/#rpc-secret=$SECRET"
    echo
    echo "From another device, replace localhost with this host's address."
    echo
  fi
fi

exec "./aria2c" --conf-path="$CONF" "$@"
EOF
  chmod +x "$OUT/start.sh"
  emit "$OUT/README.txt" <<EOF
aria2c with embedded Web UI ($PKG_MODE)

Run ./start.sh, then open http://<host>:6800/

Settings: edit aria2.conf next to this file and start again.  Do not add the
same option to start.sh as well - command-line options take precedence over
aria2.conf, so a leftover there silently wins and the settings file looks
broken.

This package listens on all interfaces by default.  The panel has no login of
its own, so on first run start.sh generates an RPC password, appends it to
aria2.conf and prints a link that fills it in for you; from another device,
replace localhost in that link with this host's address.  Deleting the
rpc-secret line returns you to passwordless access - only do that behind a
firewall, and never on the public internet.

Licenses: see LICENSE, NOTICE, THIRD-PARTY-NOTICES.txt and LICENSES/.
EOF
fi

echo "==> launchers written to $OUT (PKG_MODE=$PKG_MODE, rpc-listen-all=$RPC_LISTEN_ALL)"
