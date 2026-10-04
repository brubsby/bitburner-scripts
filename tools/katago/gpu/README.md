# KataGo on bubtop's GPU (remote analysis engine)

`tools/katago/service.mjs` runs KataGo on **bubtop** (Windows + WSL Ubuntu
24.04, RTX 4090) through ONE persistent ssh session per engine: JSON queries
on the session's stdin, answers on its stdout. Started on the first KataGo
request, kept warm (net loaded, NN cache kept) and closed after 30 min without
a request (`--katago-idle-min`). If bubtop is unreachable or the engine dies,
the service marks it down for 5 min and the local CPU engine answers
(`tools/katago/install.sh`); if neither exists, go-solver answers with the
request's named fallback (model, then uct) and says why in the reply.

## What is installed there (`bash tools/katago/gpu/install-gpu.sh [host]`)

All under `~/katago` on the host (1.3GB); nothing else on the host is touched.

| what | source | sha256 |
| --- | --- | --- |
| KataGo v1.18.1 CUDA 12.5 / cuDNN 9.8 (AppImage, extracted to `squashfs-root/`) | github.com/lightvector/KataGo releases | `32a8104b…a36a4ee` (zip) |
| `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` (b18: the strong net; the CPU keeps b10c128) | media.katagotraining.org | `9d7a6afe…cba51f1d` |
| cuDNN 9.8.0.87 for CUDA 12, runtime `.so` only (`cudnn-lib/`) | developer.download.nvidia.com redist | `321b9b33…7f257dcf4` |
| `analysis-gpu.cfg`, `run-analysis.sh` | this directory | — |

The host's CUDA 12 runtime (`/usr/local/cuda`) and WSL driver
(`/usr/lib/wsl/lib`) are used as found.

## Sharing the card with the siiva cipher jobs

`gpudecrypt` keeps the 4090 at 100% utilisation. KataGo's kernels are
time-sliced in between, so each NN batch waits ~30-45ms for a slice and the
latency of a move is set by the NUMBER of batches, not their size — hence
32 search threads with batch 32 (200 visits ~300ms; 8 threads ~700ms). The
engine runs only while Go is played on a KataGo board and exits after the
idle timeout. CPU niced 10 on the host. Footprint and the cipher's measured
slowdown: tools/katago/README.md, "GPU".

## Safety

Never reboot bubtop, never `wsl --shutdown`, never touch Docker/the VHDX or
the gpudecrypt jobs: puter's `siiva-cipher/work/gpu_watch.sh` feeds the GPU
through the same sshd (port 22). The engine is an ordinary user process;
`pkill -f '[k]atago analysis'` on bubtop stops it (go-solver falls back).
