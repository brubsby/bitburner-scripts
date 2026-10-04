# KataGo backend for the IPvGO solver (19x19 hidden opponent only)

## What was downloaded (2026-10-03), by `tools/katago/install.sh`

Everything lives in `tools/vendor/katago/` (git-ignored). Official sources only.

| file | source | size | sha256 | license |
| --- | --- | --- | --- | --- |
| `katago-v1.18.1-eigenavx2-linux-x64.zip` | https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip | 41,821,245 B | `33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79` | MIT (KataGo repo `LICENSE`); bundled third-party libs under their own licenses, listed there |
| `kata1-b10c128-s1141046784-d204142634.txt.gz` | https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b10c128-s1141046784-d204142634.txt.gz | 14,466,254 B | `3d8a24697ba25fe4da39af4c2b6bd405907b0ad8295322f5a550fa2d8fe4a2f4` | "KataGo Neural Network License" — MIT-style, https://katagotraining.org/network_license/ |

Why these: v1.18.1 is the newest release that ships a CPU (Eigen, AVX2)
build — v1.18.2 is CUDA-only, and this machine (i7-8565U, 4C/8T, AVX2, no
NVIDIA GPU) has no GPU. b10c128 is the largest network that answers in
seconds on two CPU threads; the 18-block nets are ~10x slower per visit.

The release binary is an AppImage; install.sh extracts it (no FUSE) and
`katago.mjs` runs `usr/bin/katago` with the AppImage's libs on
`LD_LIBRARY_PATH` (its `AppRun` is `#!/bin/bash`, absent on NixOS; the binary
itself runs through nix-ld).

## How the board is mapped (`katago.mjs` `toQuery`, tested by GM6)

- Rules: area scoring, positional superko, no suicide, no friendly pass
  (IPvGO never removes dead stones), the game's komi.
- **Offline nodes** do not exist in Go. They are sent as WHITE stones: exact
  for our groups (a hole is no liberty, neither is a white stone); for white's
  groups it overstates them (a white group touching a hole cluster borrows its
  liberties). Pessimistic for us, never optimistic. Komi is lowered by the
  number of hole stones sent; hole groups with no liberty are dropped.
- The root is restricted (`allowMoves`) to the game's own valid list, which
  carries the superko check; history is not sent.

## Measured (tools/sim/go-w0.mjs vs the game's own getMove, NOT CALIBRATED live)

19x19 hidden opponent (bitverse board, 7 handicap routers, komi 9.5), b10c128,
2 threads:

| solver | games | won | black | s/move | power/h |
| --- | --- | --- | --- | --- | --- |
| golib uct 800ms (previous default) | 6 | 0 | ~87 | 0.8 | ~961 |
| KataGo 100 visits | 3 | 0 | 115 | 1.5 | 1310 |
| KataGo 200 visits (pass fix) | 4 | 2 | 105 | 3.5 | 1701 |
| KataGo 400 visits (pass + eye fixes, current) | 5 | 4 | 140 | 7.1 | 2336 |
| same + komi calibration (`--kcal`, dropped) | 2 | 0 | 98 | 6.9 | - |

Recommendation: keep it OFF by default. It wins the hidden board where golib
cannot, and roughly doubles power/h there, but 5x5 Illuminati with the model
solver earns ~52,000/h, so the planner should only send games to the hidden
opponent for its own channel (hacking level). To turn it on, set
`SETTINGS.bigBoard.backend = 'katago'` in go.js after running
`bash tools/katago/install.sh`.

## Resources

One process, niced 19, 2 search threads, ~150MB RSS, started by
`tools/go-solver.mjs` on the first `backend: "katago"` request only.
