#!/usr/bin/env bash
# On the GPU host, in ~/katago: the PATCHED KataGo analysis engine (offline
# nodes as walls — tools/katago/README.md, "Release 3"), started by
# tools/katago/katago.mjs (startKataGo walls: true) over one persistent ssh
# session. Same config, net and libraries as run-analysis.sh; only the binary
# differs. Installed by tools/katago/walls/build-walls.sh.
D="$(dirname "$(realpath "$0")")"
export LD_LIBRARY_PATH="$D/cudnn-lib:/usr/local/cuda/lib64:/usr/lib/wsl/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
NET="${KATAGO_NET:-$D/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz}"
exec nice -n 10 "$D/walls/katago" analysis -config "$D/analysis-gpu.cfg" -model "$NET" "$@"
