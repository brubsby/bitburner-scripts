#!/usr/bin/env bash
# Build the walls-patched KataGo (CUDA) on the GPU host and install it next to
# the stock engine, without touching it:
#
#   bash tools/katago/walls/build-walls.sh [host]      # default bubtop
#
# On the host: ~/kgwall/KataGo (v1.18.1 source, patched by patch.py), cuDNN
# 9.8 headers (the same redist archive install-gpu.sh takes the .so from),
# a 4-job niced build, then ~/katago/walls/katago and
# ~/katago/run-analysis-walls.sh. A running engine keeps its binary; new
# sessions pick the walls one up (katago.mjs REMOTE_CMD_WALLS).
set -euo pipefail
HOST="${1:-bubtop}"
HERE="$(cd "$(dirname "$0")" && pwd)"
scp -q "$HERE/patch.py" "$HERE/run-analysis-walls.sh" "$HOST:"
ssh "$HOST" bash -s <<'EOF'
set -euo pipefail
mkdir -p ~/kgwall && cd ~/kgwall
mv -f ~/patch.py ~/kgwall/patch.py
mv -f ~/run-analysis-walls.sh ~/katago/run-analysis-walls.sh && chmod +x ~/katago/run-analysis-walls.sh
CUDNN=cudnn-linux-x86_64-9.8.0.87_cuda12-archive
if [ ! -d KataGo ]; then
  git clone -q --depth 1 --branch v1.18.1 https://github.com/lightvector/KataGo.git
  python3 patch.py KataGo/cpp
fi
if [ ! -d $CUDNN/include ]; then
  curl -sSLO https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/linux-x86_64/$CUDNN.tar.xz
  echo "321b9b33bb1287404d93d5672d352f16feabc4b220ac6ae0b86e4b27f257dcf4  $CUDNN.tar.xz" | sha256sum -c -
  tar -xJf $CUDNN.tar.xz --wildcards "*/include/*" && rm -f $CUDNN.tar.xz
fi
mkdir -p KataGo/cpp/build && cd KataGo/cpp/build
PATH=/usr/local/cuda/bin:$PATH cmake .. -DUSE_BACKEND=CUDA -DNO_GIT_REVISION=1 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc -DCMAKE_CUDA_ARCHITECTURES=89 \
  -DCUDNN_INCLUDE_DIR=$HOME/kgwall/$CUDNN/include -DCUDNN_LIBRARY=$HOME/katago/cudnn-lib/libcudnn.so > /dev/null
PATH=/usr/local/cuda/bin:$PATH nice -n 15 make -j4 2>&1 | tail -3
mkdir -p ~/katago/walls && cp -f katago ~/katago/walls/katago.new && mv -f ~/katago/walls/katago.new ~/katago/walls/katago
echo "installed ~/katago/walls/katago, ~/katago/run-analysis-walls.sh"
EOF
