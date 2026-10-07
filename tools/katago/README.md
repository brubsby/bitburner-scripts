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
- **Offline nodes are WALLS** (2026-10-06, Release 3 below) on the GPU
  engine: the query's `walls` list, read by our patched KataGo, which puts
  the board's own off-board value (C_WALL) there — in the game an offline
  node is a null point (boardState.ts), exactly an edge. Stock engines (the
  laptop's CPU fallback, or the GPU when the patched binary will not start)
  still get the old mapping:
- **Offline nodes as WHITE stones** (stock engines only): exact
  for our groups (a hole is no liberty, neither is a white stone); for white's
  groups it overstates them (a white group touching a hole cluster borrows its
  liberties), and KataGo reads every hole cluster as a dead white group to
  capture and a white wall owning the territory round it. Komi is lowered by the
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

## Release 3 (2026-10-06): offline nodes as WALLS — a patched KataGo

**The bug.** Every hole was sent as a WHITE stone (`toQuery` holes "white").
KataGo then believes each hole cluster is a dead white group it can capture,
a white wall owning the territory around it, and a liberty donor to any
white group it touches. On an empty 9x9 with 10 holes the stock engine
scores black at -69.7 (the walls engine: +1.5). It plays to "capture" holes,
misjudges which of its groups live, and loses whole groups: the live game of
2026-10-06 23:34Z (SlumSnakes@9, 10 holes) lost a ~25-stone group between
moves 35 and 41 and ended 0-74.5. The komi offset, the eye filter and the
no-unsettled-pass rule above were patches over this one cause.

**The fix: holes are walls.** In the game an offline node is a null point
(boardState.ts / offlineNodes.ts): no liberty, no stone, no territory, and an
empty region bordered by one colour and holes is that colour's (scoring.ts
findNeighbors skips nulls) — exactly a board EDGE. KataGo's board already
has a value for "off the board": the padding around the rectangle is
`C_WALL`, and liberties, captures, legality, area scoring and pass-alive
territory all treat it as an edge. `tools/katago/walls/patch.py` (v1.18.1,
74 lines) lets a query place `C_WALL` inside the rectangle:

- `analysis.cpp`: a `walls` field (GTP vertices), placed before the stones
  (`Board::setWall`; a stone on a wall is refused);
- `board.cpp`: the wall enters the position hash (the NN cache and superko
  must not confuse two layouts), `checkConsistency`/`regenChainsFromColors`
  accept it, area scoring gives it to nobody;
- `boardhistory.cpp`: the all-pass-alive game end skips walls;
- `nninputs.cpp`: input feature 0 ("on board") is 0 on a wall — that is the
  net's MASK, applied after every layer and in global pooling, exactly as for
  a smaller board in a bigger buffer; `getSymBoard` (rootInfo symmetry hash,
  every query) copies walls before stones.
- The CUDA backend DROPS the mask when `requireMaxBoardSize` is set
  ("don't do any masking if we know the board is exactly the desired size"),
  so a walls engine never pins it (`sizeOverride(..., exact = false)`); the
  GPU engine never pinned a size anyway.

The net never saw an interior hole in training (rectangles only), so its
reading next to one is out of distribution; the search's rules are exact.
Sanity (`startKataGo` on bubtop, 200 visits): a white stone whose last
liberty is D3 once three holes are walls — walls engine D3 (206/206 visits,
lead +7.2), stock engine anywhere else (lead -29.6).

Built and installed by `tools/katago/walls/build-walls.sh` on bubtop:
`~/katago/walls/katago` + `~/katago/run-analysis-walls.sh` (same config, net
and cuDNN as the stock engine; CUDA 12.4, sm_89). The service starts the
walls engine first and falls back to the stock one (saying so in
`status().walls.why`) if it will not start; every answer says which
(`walls`), go-solver replies `mode: "walls"`, so the evidence is
`katago-walls-r3` (goplan.armVersion) and the stock engine's live record
(`katago-r3`, the SlumSnakes@9 losses) no longer counts for the KataGo arms.

**Measured** (go-w0.mjs, paired deals `--layoutseed 21`, + 30 games at seed 22
on 9x9; GPU b18, 200 visits, pondered below 13x13 as live; uct 1500ms is the
live solver's budget but on bubtop at load ~30, so its strength is NOT the
laptop's). power/h = node power per hour of the AI's own time at streak x3
(go-ceiling.mjs, ours = 0 — KataGo answers pondered moves in ~10-40ms):

| board | opponent | stock (white holes) | WALLS | uct 1500 |
| --- | --- | --- | --- | --- |
| 7x7 | Tetrads | 13/20, black 21.8, 0.86 pts/AIs, 13,965/h | **20/20, 28.1, 1.33, 21,614/h** | 20/20, 26.5, 1.40, 22,594/h |
| 7x7 | Slum Snakes | 20/20, 29.9, 1.79, 19,301/h | 20/20, 28.9, 1.74, 18,772/h | 20/20, 28.6, 1.85, 19,967/h |
| 9x9 | Tetrads | 43/46, 41.5, 1.01, 16,428/h | **45/46, 44.9, 1.09, 17,664/h** | 14/16, 39.3, 1.12, 18,175/h |
| 9x9 | Slum Snakes | 37/46, 40.0, 1.22, 13,152/h | **45/46, 47.9, 1.63, 17,549/h** | 16/16, 42.3, 1.56, 16,790/h |
| 13x13 | Tetrads | 6/6, 98.5, 1.00, 16,197/h | **6/6, 108.7, 1.10, 17,790/h** | 4/6, 76.0, 0.84, 13,600/h |
| 13x13 | Slum Snakes | 6/6, 104.0, 1.46, 15,769/h | **6/6, 123.7, 1.74, 18,817/h** | 6/6, 85.5, 1.46, 15,720/h |

**The hidden opponent (19x19 w0r1d_d43m0n, 7 handicap routers, komi 9.5)**,
GPU 800 visits, paired `--layoutseed 2`, 5 games each: stock 1/5, black
121.8, 3,239 power/h (go-w0-report, live-modelled, our ~1s/move included)
-> **walls 5/5, black 168.4, 8,486 power/h**. The offline holes were the open
problem there; W0_PRIOR (3,130/h, goplan.js) predates this and is still the
prior until 10 live games are measured.

Walls never measured worse than stock beyond noise and fixes the two
failures the live record shows (Tetrads 7x7 65% -> 100%, Slum Snakes 9x9
80% -> 98%, +3 to +20 black a game on 9x9/13x13). It is not flawless: 2 of
92 walls games on 9x9 were lost, each a whole group (0-77.5, 0-72.5; stock
lost 12 of the same 92). Traced (S9 seed 22 game 4): at 200-400 visits the net read +50 for
black ten moves before the group died; 3200 visits read the same position
at -60. The net misjudges a big group's life near holes at low visits (out
of distribution, or ordinary low-visit blindness); a forced self-atari at the
end is our no-unsettled-pass rule (only the group's own two liberties were
legal, pass was withheld), but the game was already lost. 800 visits does not
cure it: 30/30 Slum Snakes 9x9 (seed 22) but 15/16 Tetrads 9x9 (seed 21), the
loss the same shape (+62 read at move 80 on a group whose only eye space was a
straight three; the AI took the vital point). So 200 visits stays. What would:
an exact check of the AI's actual reply (tools/goai, as the model solver
does) before a KataGo move, or a net fine-tuned on boards with holes —
neither built (no big board pays more than 5x5, below). **No bigger board beats
5x5**: live 5x5 Tetrads ~26k/h on the wall clock (go-ceiling LIVE, 2026-10-06
23.6k AI-time, 26.9k stall-free), Slum Snakes 5x5 live 23.6k AI-time; the best
big board is 7x7 Tetrads at ~21.6-22.6k AI-time only (before our own
latency), every 9x9/13x13 arm ~17-19k.

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
