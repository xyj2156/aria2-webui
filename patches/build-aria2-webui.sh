#!/usr/bin/env bash
# Build aria2c with the Web UI embedded, for whichever toolchain the current
# environment provides (Windows cross-compile, Linux/musl static, macOS native).
#
# Required env:
#   ARIA2_SRC   path to a CLEAN aria2 source checkout (tag or master)
#   WEBUI_DIST  path to the built Web UI "dist" directory
#   OUT         output directory for the packaged binary + launchers
# Optional env:
#   CONF_EXTRA  full ./configure flag string for this platform
#   PKG_MODE    win | unix        (default: unix)
#   STRIP       strip tool to use (default: strip)
#   RUN_PATCH   1 to git-apply the embed patch (default: 1)
set -euo pipefail

: "${ARIA2_SRC:?ARIA2_SRC is required}"
: "${WEBUI_DIST:?WEBUI_DIST is required}"
: "${OUT:?OUT is required}"
CONF_EXTRA="${CONF_EXTRA:-}"
PKG_MODE="${PKG_MODE:-unix}"
STRIP="${STRIP:-strip}"
RUN_PATCH="${RUN_PATCH:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS="$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null) || echo 4 )"

cd "$ARIA2_SRC"

if [ "$RUN_PATCH" = "1" ]; then
  echo "==> apply embed patch"
  git apply "$SCRIPT_DIR/aria2-embed-webui.patch"
fi

echo "==> generate embedded Web UI blob from $WEBUI_DIST"
node "$SCRIPT_DIR/gen_webui_blob.mjs" "$WEBUI_DIST" "$PWD/src/WebUiBlob.cc"

echo "==> autotools bootstrap (skip autopoint; NLS disabled)"
touch config.rpath
# autopoint is skipped, so also provide the files it would otherwise install
# that automake's gettext support then demands.
printf '# stub po/Makefile.in.in (NLS disabled)\nall:\ninstall:\nuninstall:\nclean:\ndistdir:\ncheck:\n' > po/Makefile.in.in
[ -e ABOUT-NLS ] || printf 'This build disables NLS; ABOUT-NLS stub created by patches/build-aria2-webui.sh.\n' > ABOUT-NLS
# We skip autopoint, so aclocal cannot expand AM_GNU_GETTEXT unless gettext's
# m4 archive is on its search path.  Distro layouts differ: Debian/Alpine ship
# gettext.m4 under /usr/share/aclocal, but Homebrew's gettext (now 1.0) puts the
# m4 archive under `<prefix>/share/gettext/m4` and only `nls.m4` under
# `share/aclocal`.  Probe all of them (verified via a one-off macOS diag run).
GT_ROOTS="/usr/share/aclocal /usr/local/share/aclocal"
if command -v brew >/dev/null 2>&1; then
  for _bp in "$(brew --prefix gettext 2>/dev/null || true)" "$(brew --prefix 2>/dev/null || true)"; do
    if [ -n "${_bp:-}" ]; then
      GT_ROOTS="$GT_ROOTS ${_bp}/share/aclocal ${_bp}/share/gettext/m4"
    fi
  done
fi
# shellcheck disable=SC2086
GT_M4="$(find $GT_ROOTS -name gettext.m4 2>/dev/null | head -1 || true)"
if [ -n "${GT_M4:-}" ]; then
  GT_DIR="$(dirname "$GT_M4")"
  export ACLOCAL_PATH="${GT_DIR}${ACLOCAL_PATH:+:$ACLOCAL_PATH}"
  echo "    aclocal += $GT_DIR (gettext.m4)"
else
  echo "    WARN: gettext.m4 not found; autoreconf may fail on AM_GNU_GETTEXT" >&2
fi
AUTOPOINT=true autoreconf -i -f

echo "==> configure: ${CONF_EXTRA:-<defaults>}"
# shellcheck disable=SC2086
./configure $CONF_EXTRA

echo "==> make -j$JOBS"
make -j"$JOBS"

echo "==> install into a staging DESTDIR, then pick the real installed binary"
STAGE="$OUT/.destdir"
rm -rf "$STAGE" 2>/dev/null || true
make install DESTDIR="$STAGE" prefix=/usr >/dev/null || true

if [ "$PKG_MODE" = "win" ]; then NAME=aria2c.exe; else NAME=aria2c; fi

# Resolve the real executable.  `prefix=/usr` installs it to $STAGE/usr/bin.
# Beware: aria2 also ships a *bash-completion script literally named `aria2c`*
# under .../doc/.../bash_completion/, so never match by bare filename across the
# whole tree (an earlier run grabbed that 8 KB script and "succeeded").  Prefer
# the bin dir, then libtool's src/.libs, then a */bin/-restricted find.
CAND=""
for c in "$STAGE/usr/bin/$NAME" "$PWD/src/.libs/$NAME"; do
  if [ -f "$c" ]; then CAND="$c"; break; fi
done
if [ -z "$CAND" ]; then
  CAND="$(find "$STAGE" -type f -path "*/bin/$NAME" 2>/dev/null | head -1 || true)"
fi
BIN="$CAND"
[ -n "$BIN" ] && [ -f "$BIN" ] || { echo "ERROR: real $NAME not found under $STAGE/usr/bin or src/.libs"; exit 1; }
# A genuine (even stripped) aria2c is ≳1 MB; anything tiny is the completion
# script or a libtool wrapper — refuse to ship it (no more false-green).
if [ "$(wc -c < "$BIN")" -lt 200000 ]; then
  echo "ERROR: '$BIN' is only $(wc -c < "$BIN") bytes — not the real aria2c binary" >&2
  exit 1
fi
cp "$BIN" "$OUT/"
BASE="$(basename "$BIN")"
chmod u+w "$OUT/$BASE" 2>/dev/null || true
"$STRIP" "$OUT/$BASE" 2>/dev/null || true

# Launcher scripts (ASCII only, CRLF, to avoid cmd codepage issues).
if [ "$PKG_MODE" = "win" ]; then
  printf '@echo off\r\ncd /d "%%~dp0"\r\nif not exist "%%~dp0downloads" mkdir "%%~dp0downloads"\r\nstart "aria2c" "%%~dp0%s" --enable-rpc --rpc-listen-port=6800 --dir="%%~dp0downloads" --log="%%~dp0aria2.log" --log-level=notice\r\ntimeout /t 2 /nobreak >nul\r\nstart "" http://localhost:6800/\r\npause\r\n' "$BASE" > "$OUT/start.bat"
  printf '@echo off\r\ntaskkill /f /im %s >nul 2>&1\r\n' "$BASE" > "$OUT/stop.bat"
  printf 'aria2c with embedded Web UI (Windows x64)\r\nRun start.bat, then open http://localhost:6800/\r\n' > "$OUT/README.txt"
else
  printf '#!/bin/sh\ncd "$(dirname "$0")"\nexec "./%s" --enable-rpc --rpc-listen-port=6800 --rpc-listen-all --dir="$(pwd)/downloads" "$@"\n' "$BASE" > "$OUT/start.sh"
  chmod +x "$OUT/start.sh"
  printf 'aria2c with embedded Web UI (%s)\nRun ./start.sh, then open http://<host>:6800/\n' "$PKG_MODE" > "$OUT/README.txt"
fi

echo "==> done: $OUT"
ls -la "$OUT"
