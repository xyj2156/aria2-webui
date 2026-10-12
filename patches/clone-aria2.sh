#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 阿杰很厉害 <506907958@qq.com>
# clone-aria2.sh — check out the one pinned aria2 commit that release builds are
# allowed to use, and refuse to continue if the pin and reality disagree.
#
# Why: the binaries we publish carry a GPL corresponding-source promise that
# names an exact aria2 commit.  If a build silently picked up a moved tag or a
# different default branch, that promise would be false and the release would
# be unbuildable from source.  So every job that needs aria2 goes through here.
#
# Usage: patches/clone-aria2.sh <destination-dir>
# Env:   ARIA2_REPO, ARIA2_TAG, ARIA2_SHA (set in .github/workflows/release.yml)

set -euo pipefail

# Resolve this script's own directory to an absolute path *before* any command
# changes the working directory — `git -C <dir> apply <patch>` resolves a
# relative patch inside <dir>, not where the script was invoked from.
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

DEST=${1:?usage: clone-aria2.sh <destination-dir>}
: "${ARIA2_REPO:?ARIA2_REPO is not set}"
: "${ARIA2_TAG:?ARIA2_TAG is not set}"
: "${ARIA2_SHA:?ARIA2_SHA is not set}"

if [ -e "$DEST" ]; then
  echo "clone-aria2: refusing to write over existing path $DEST" >&2
  exit 1
fi

echo "clone-aria2: ${ARIA2_REPO} ${ARIA2_TAG} (expecting ${ARIA2_SHA})"
# A depth-1 tag clone detaches HEAD at the commit the tag points at, which is
# exactly the object the pin names.  Upstream's release tags are annotated, so
# git prints a benign "refs/tags/... is not a commit!" warning; the detached-HEAD
# advice is noise in a build log.
git -c advice.detachedHead=false clone --depth 1 --branch "$ARIA2_TAG" \
  "https://github.com/${ARIA2_REPO}" "$DEST"

ACTUAL=$(git -C "$DEST" rev-parse HEAD)
if [ "$ACTUAL" != "$ARIA2_SHA" ]; then
  echo "clone-aria2: PIN MISMATCH — ${ARIA2_REPO} ${ARIA2_TAG} is now ${ACTUAL}" >&2
  echo "clone-aria2: release.yml still pins ${ARIA2_SHA}" >&2
  echo "clone-aria2: re-verify patches/aria2-embed-webui.patch against the new" >&2
  echo "               commit, then update ARIA2_TAG/ARIA2_SHA together." >&2
  exit 1
fi

# Prove the promise is kept: the patch must apply to this exact tree.
PATCH="$SCRIPT_DIR/aria2-embed-webui.patch"
if ! git -C "$DEST" apply --check -p1 "$PATCH"; then
  echo "clone-aria2: $PATCH does not apply to ${ARIA2_TAG} (${ACTUAL})" >&2
  exit 1
fi

echo "clone-aria2: pinned commit ${ACTUAL} verified, ${PATCH##*/} applies"
