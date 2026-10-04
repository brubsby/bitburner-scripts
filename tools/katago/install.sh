#!/usr/bin/env bash
# Fetch KataGo (CPU/Eigen AVX2 build) and one small network into tools/vendor/katago
# (git-ignored). Official sources only. Idempotent; verifies sha256.
#
#   bash tools/katago/install.sh
#
# What and why: see tools/katago/README.md.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${KATAGO_DIR:-$HERE/../vendor/katago}"
mkdir -p "$DEST"
cd "$DEST"

ZIP=katago-v1.18.1-eigenavx2-linux-x64.zip
ZIP_URL=https://github.com/lightvector/KataGo/releases/download/v1.18.1/$ZIP
ZIP_SHA=33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79
NET=kata1-b10c128-s1141046784-d204142634.txt.gz
NET_URL=https://media.katagotraining.org/uploaded/networks/models/kata1/$NET
NET_SHA=3d8a24697ba25fe4da39af4c2b6bd405907b0ad8295322f5a550fa2d8fe4a2f4

fetch() { # file url sha
  if [ -f "$1" ] && echo "$3  $1" | sha256sum -c --quiet - 2>/dev/null; then return 0; fi
  curl -fSL --retry 3 -o "$1.part" "$2"
  echo "$3  $1.part" | sha256sum -c --quiet -
  mv "$1.part" "$1"
}
fetch "$ZIP" "$ZIP_URL" "$ZIP_SHA"
fetch "$NET" "$NET_URL" "$NET_SHA"

# The release binary is an AppImage; extract it (no FUSE needed). On NixOS the
# extracted binary runs through nix-ld; tools/katago/katago.mjs sets
# LD_LIBRARY_PATH to the AppImage's own libs.
if [ ! -x bin/squashfs-root/usr/bin/katago ]; then
  rm -rf bin && mkdir -p bin
  (cd bin && unzip -q "../$ZIP" && ./katago --appimage-extract >/dev/null)
fi
LD_LIBRARY_PATH="$DEST/bin/squashfs-root/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$DEST/bin/squashfs-root/usr/bin/katago" version | head -1
echo "installed in $DEST"
