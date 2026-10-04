#!/usr/bin/env bash
# Install the GPU KataGo engine on a remote CUDA host (default: bubtop, WSL
# Ubuntu with an RTX 4090), into ~/katago there. Run from this machine:
#
#   bash tools/katago/gpu/install-gpu.sh [host]
#
# Official sources only, each checked against its published sha256:
#   KataGo v1.18.1 CUDA 12.5 / cuDNN 9.8 Linux build (an AppImage; extracted,
#     no FUSE needed at run time)                       github.com/lightvector/KataGo
#   kata1-b18c384nbt-s9996604416-d4316597426 network   katagotraining.org (b18: the
#     strong net the GPU affords; the CPU fallback keeps b10c128)
#   cuDNN 9.8.0.87 for CUDA 12 (runtime .so only, static libs removed)
#                                                       developer.download.nvidia.com redist
# The host's CUDA 12 runtime (/usr/local/cuda) and the WSL driver
# (/usr/lib/wsl/lib) are used as they are. Nothing outside ~/katago is touched.
set -euo pipefail
HOST=${1:-bubtop}
HERE="$(cd "$(dirname "$0")" && pwd)"
ZIP=katago-v1.18.1-cuda12.5-cudnn9.8.0-linux-x64.zip
ZIP_SHA=32a8104b20bed3c231b2239f9c9b5de88f86340e4257d31e7434d9042a36a4ee
NET=kata1-b18c384nbt-s9996604416-d4316597426.bin.gz
NET_SHA=9d7a6afed8ff5b74894727e156f04f0cd36060a24824892008fbb6e0cba51f1d
CUDNN=cudnn-linux-x86_64-9.8.0.87_cuda12-archive
CUDNN_SHA=321b9b33bb1287404d93d5672d352f16feabc4b220ac6ae0b86e4b27f257dcf4

ssh -o BatchMode=yes "$HOST" bash -s <<EOF
set -euo pipefail
mkdir -p ~/katago && cd ~/katago
if [ ! -x squashfs-root/usr/bin/katago ]; then
  curl -sSLO https://github.com/lightvector/KataGo/releases/download/v1.18.1/$ZIP
  echo "$ZIP_SHA  $ZIP" | sha256sum -c -
  unzip -o -q $ZIP katago && ./katago --appimage-extract >/dev/null && rm -f katago $ZIP
fi
if [ ! -f $NET ]; then
  curl -sSLO https://media.katagotraining.org/uploaded/networks/models/kata1/$NET
  echo "$NET_SHA  $NET" | sha256sum -c -
fi
if [ ! -f cudnn-lib/libcudnn.so.9 ]; then
  curl -sSLO https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/linux-x86_64/$CUDNN.tar.xz
  echo "$CUDNN_SHA  $CUDNN.tar.xz" | sha256sum -c -
  tar -xJf $CUDNN.tar.xz --wildcards "*/lib/*" && rm -rf cudnn-lib && mv $CUDNN/lib cudnn-lib && rm -rf $CUDNN $CUDNN.tar.xz
  rm -f cudnn-lib/*_static*.a
fi
EOF
scp -q "$HERE/analysis-gpu.cfg" "$HERE/run-analysis.sh" "$HOST:katago/"
ssh -o BatchMode=yes "$HOST" 'chmod +x ~/katago/run-analysis.sh && cd ~/katago && LD_LIBRARY_PATH=$HOME/katago/squashfs-root/usr/lib:$HOME/katago/cudnn-lib:/usr/local/cuda/lib64:/usr/lib/wsl/lib squashfs-root/usr/bin/katago version | head -4 && du -sh ~/katago'
