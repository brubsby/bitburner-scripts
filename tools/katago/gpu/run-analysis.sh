#!/usr/bin/env bash
# On bubtop (WSL), in ~/katago: the KataGo analysis engine on the GPU, started
# on demand by tools/katago/katago.mjs over one persistent ssh session. Queries
# arrive as JSON lines on stdin; the engine exits when the session closes
# stdin (the client's idle timeout, or the client dying). Extra args (e.g.
# -override-config ...) are passed through. Installed by install-gpu.sh.
D="$(dirname "$(realpath "$0")")"
export LD_LIBRARY_PATH="$D/squashfs-root/usr/lib:$D/cudnn-lib:/usr/local/cuda/lib64:/usr/lib/wsl/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
NET="${KATAGO_NET:-$D/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz}"
exec nice -n 10 "$D/squashfs-root/usr/bin/katago" analysis -config "$D/analysis-gpu.cfg" -model "$NET" "$@"
