# KataGo backend for the IPvGO solver (the 19x19 hidden opponent)

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
- **No pass while a point is open** (2026-10-04): pass is offered only when
  every legal point is already our territory by the game's rule (holes are
  transparent: scoring.ts checkTerritoryOwnership). The hole mapping biases
  KataGo's score so far that on 7x7 it passed its first four moves on an empty
  board (lost 8-32.5).
- The net's buffer is pinned to the board size on the CPU engine
  (`sizeOverride`): a 5x5 eval otherwise costs a 19x19 one (~1.5s per 100
  visits on any board -> 0.35s on 5x5, 0.65s on 9x9).

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

Re-measured 2026-10-04 with the current mapping (no-unsettled-pass, paired
layouts, `--layoutseed 2`); the 2026-10-03 4/5 above did not reproduce:

| engine | visits | games | won | mean black | s/move | power/h |
| --- | --- | --- | --- | --- | --- | --- |
| GPU b18, pondered | 800 | 4 | 0 | 132 | 0.75 | 1653 |
| GPU b18 | 800 | 3 | 1 | 98 | 0.8 | 3554 |
| GPU b18, old pass rule | 800 | 3 | 1 | 125 | 0.85 | - |
| GPU b18 | 1600 | 3 | 0 | 87 | 1.5 | 731 |
| CPU b10 | 400 | 1 | 0 | 119 | 5.5 | - |

Every KataGo arm out-scores uct's ~87 black (node power is credited win or
lose), so the big board plays KataGo whenever an engine exists:
go.js `SETTINGS.bigBoard.backend: 'auto'` (KataGo when the solver's
/go/katago.txt reports the GPU or the CPU engine, else uct), visits
{ gpu: 800, cpu: 400 }. More visits measured WORSE (1600: 0/3, black 87) —
the hole mapping misleads a deeper search (a hole "white stone" next to our
group looks capturable and never is). That is the open problem here.

## Every board, every opponent (2026-10-04, decision study)

tools/sim/go-study.mjs + go-study-report.mjs, paired layouts (seed 2), the
study's payout pricing (streak and difficulty multipliers, the AI's reply
timing). katagoNNN = visits; gpu = bubtop b18 (tools/katago/gpu); p = pondered.
5x5 incumbent = the model solver at go.js's budget, pondered.

| opponent | 5x5 model+ponder | 5x5 KataGo | 7x7 best other | 7x7 KataGo | 9x9 best other | 9x9 KataGo | 13x13 KataGo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Illuminati | 97% 67897 | 30% 16728 (cpu100) | model 38% 3507 | gpu200p 10% 2694 | model 50% 3715 | gpu200p 20% 3241 | - |
| Daedalus | 97% 13643 | - | uct 75% 4890 | gpu200p 85% 8838 | uct 100% 8773 | gpu200 90% 7449 | gpu200p 100% 11392 (n=3) |
| Tetrads | 97% 11550 | gpu200p 70% 6202 | uct 100% 10043 | gpu200p 80% 7217 | uct 83% 4627 | gpu200 100% 10082 | gpu200p 100% 10639 (n=3) |
| Slum Snakes | 100% 11824 | gpu200p 80% 6855 | uct 100% 8513 | cpu100 88% 6546 | uct 100% 5892 | gpu200p 90% 6629 | - |
| The Black Hand | 100% 11122 | - | model 100% 5925 | gpu200p 80% 4830 | model 100% 5614 | gpu200p 100% 8393 | - |
| Netburners | 97% 6569 | - | model 100% 4548 | gpu200p 90% 4135 | uct 100% 3538 | gpu200p 100% 5040 | - |

KataGo loses to the model search on every small board: it plays objective Go
against a weak, predictable AI the model search exploits exactly, and its
score is biased by the holes. On bigger boards it wins more than uct but the
AI's own reply time (~0.85s a turn plus the ~0.55s round trip) is a floor
per turn, and 5x5 earns the most area per turn, so no board beats the 5x5
rate. 13x13 Daedalus/Tetrads (n=3) come closest (-16%, -8%); not enabled.

## Release 2 (2026-10-04): hole colouring, and bigger boards after the latency cut

**Holes by owner** (`toQuery({ holes: "owner" })`, go-w0 `--katago-holes owner`):
a hole cluster touching black stones and no white stone is sent BLACK (komi
up by its size). 19x19 GPU 800 visits, the same 6 deals: black 118 vs 102 a
game, but 0/6 won vs 2/6 — 1736 vs 4112 power/h (wins break the dry streak,
worth up to 5x). NOT shipped; `holes: "white"` stays the default.

**Board size with the fast pipeline** (go.js 25ms reply poll, 10ms idle,
go-solver 25ms poll; go-study-report at 85ms a turn). Best per board, power/h:

| opponent | 5x5 model session | 7x7 best | 9x9 best | 13x13 KataGo GPU (n=2-3) |
| --- | --- | --- | --- | --- |
| Illuminati | 101929 | model 4421 | KataGo 4671 | - |
| Daedalus | 22138 | KataGo 12860 | uct 11038 | 15875 |
| Tetrads | 16032 | uct 12403 | KataGo 13305 | 14372 |
| Slum Snakes | 19137 | uct 10861 | KataGo 9635 | - |
| The Black Hand | 15083 | model 7468 | KataGo 12187 | - |
| Netburners | 12230 | KataGo 6646 | KataGo 7908 | - |

Cutting the per-turn overhead helps every board, and 5x5 most (it has the
most turns per point of area): the AI's own reply (~1s a turn live, its timer
hops) is the floor, and no bigger board beats 5x5 for any opponent.

## The service (tools/katago/service.mjs) and the GPU (tools/katago/gpu)

go-solver keeps ONE warm engine (GPU on bubtop over a persistent ssh session,
else a CPU engine per board size), closes it after 30 idle minutes, marks a
dead GPU down for 5 min and answers on the CPU, and publishes /go/katago.txt
for go.js. Pondering (the AI's likely replies answered while it "thinks") is
on for the model and for KataGo below 13x13; on 19x19 it hit 8% and doubled
the GPU duty, so it is off there.

Latency per move (KataGo, 9x9, 200 visits): GPU cold 3.5-4.5s (engine start
+ first query), warm ~260ms, pondered hit 2-30ms; CPU b10 100 visits warm
~650ms (9x9) / ~350ms (5x5), cold ~2.3s. 19x19 800 visits on the GPU ~0.8s
vs CPU b10 400 visits ~5.5s.

GPU footprint next to the cipher jobs (gpudecrypt keeps the card at 100%):
~520MB of GPU memory, ~700MB RSS and ~1.1 cores on bubtop. Measured on one
cipher batch (J2_dkey, 4096-line blocks): 545 lines/min with KataGo idle,
272-314/min while the harness queried KataGo back to back (-42..-50%). Live
play queries ~1/3 of the time on 19x19 (the AI's reply is the rest), so
expect ~-15% cipher throughput while the hidden board is played (the capped
explore batch), none otherwise.

## Resources

CPU: one process per board size in use (at most 2), niced 19, 2 search
threads, ~150MB RSS. GPU: above. Both started by `tools/go-solver.mjs` on the
first `backend: "katago"` request only.
