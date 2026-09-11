# Fidelity log

Owner: the **sim-fidelity** agent. Scope: `tools/sim/engine.mjs`,
`tools/sim/fidelity/**`, and this file. Everything else in `tools/sim/` belongs
to the optimizer; root `.js` belongs to the game-player.

The job: make the simulator predict reality, and make it price expected value at
each decision point. Written incrementally — assume it can stop at any line.

Legend for provenance, used throughout:
**[src]** read out of `~/Repos/bitburner` game source ·
**[tel]** measured against `.telemetry/` ·
**[inf]** inference, not yet verified.

---

## 0. The discrepancy, restated from telemetry

`.telemetry/history.jsonl`, 738 samples, 18:16:47 → 23:32:11 on 2026-09-11.
Two unambiguous flat windows, both real: **[tel]**

| window | duration | money | hacking level | fleet |
| --- | --- | --- | --- | --- |
| 20:19:32 → 22:35:10 | **2h 15m** | frozen at **$487,820** | 89 → 172 (+83) | home 16GB, 14 rooted, **0 purchased** |
| 23:03:11 → 23:21:41 | **18m** | frozen at **$2,305,577** | 179 → 188 (+9) | home 16GB, 2032GB purchased, 23 rooted |

Then the payout: 23:21:41 `$2,305,577 → $227,955,271`, and by 23:22:36
`$452,911,956`. **$450m in 55 seconds** after 18 minutes of exactly zero. **[tel]**

So money in this run is not a rate, it is a **step function**: long prep
plateaus punctuated by a single drain of a fully-grown target. Any simulator
that reports a smooth $/min has already got the shape wrong, and the
optimizer's 60-minute totals were being produced by a model that never
plateaus.

Note the plateau at 20:19 is **not** a 2.3TB-fleet phenomenon — it happened on
~100GB. Whatever the mechanism is, it does not need a big fleet. The 23:03
plateau at 2.3TB is the same mechanism at 20x the RAM, and it broke after 18
minutes instead of 135, which is consistent with "prep completes eventually,
and more RAM makes prep faster".

## 1. What `auto.js` + `early.js` actually do (the thing the sim must model)

Read fresh from the repo root at 2026-09-11 19:4x. **[src of our own scripts]**

`auto.js` is a 20-second poll loop. Each cycle it:

1. `scanAll` → `tryRoot` everything in reach.
2. `bestTarget(rooted)` by `rateOf`, then `shouldSwitch` decides retarget.
3. For every rooted host with RAM: `deploy(host, target, workerRam)`.

`deploy()` is where the sim's error lives:

```js
const running  = ns.ps(host).filter(p => p.filename === SETTINGS.worker)
const offTarget = running.filter(p => p.args[0] !== target)
for (const p of offTarget) ns.kill(p.pid)          // <-- in-flight op destroyed
const threads = Math.floor(usableRam(ns, host) / workerRam)
if (threads < 1) return 0
if (host !== 'home' && !ns.fileExists(worker, host)) { if (!ns.scp(...)) return 0 }
const pid = ns.exec(SETTINGS.worker, host, threads, target)
return pid ? threads : 0
```

Facts that follow, each of which the sim currently ignores:

- **One `ns.exec` per host, not per thread.** `early.js` runs as a *single*
  script instance with `threads` threads. So a host is one decision-maker that
  commits all of its RAM to one op at a time. A 1024GB pserv is 585 threads of
  `weaken` in one call, all landing at the same instant.
- **Workers whose target changed are killed.** `ns.kill` →
  `killWorkerScript` → `clearTimeout(ws.delay)` + `ScriptDeath`
  (`src/Netscript/killWorkerScript.ts:56-60`) **[src]**. A killed op yields
  **nothing**: no money, no exp, no security change. The whole flight is
  discarded.
- **Top-up only happens when a host has free RAM.** If a host is fully
  occupied, `threads < 1` and `deploy` returns 0 without launching. So a host
  that is *already* on the right target is never touched — good — but a host on
  the *wrong* target loses everything in flight and restarts from scratch.
- **Grow is 3.2x hack time, weaken 4x** (`src/Hacking.ts`) **[src]**. On a
  target with `hackTime` 60s a grow is 192s. `auto.js` polls every 20s. The
  hacking level rises about once every 30-90s under this fleet **[tel]**, and
  `rateOf` is a function of `ns.getHackingLevel()`. So the ranking is a moving
  target and the fleet can be re-killed before a single grow ever lands.

`shouldSwitch` (added after the incident) now requires
`heldForMs >= 4*hackTime` **and** `candidateRate > currentRate*1.5`. That is a
patch on the mechanism, not a model of it — the sim still cannot tell you
whether the margin is right because the sim has no concept of a discarded
flight at all.

## 2. The missing mechanisms — status

| # | mechanism | before | now |
| --- | --- | --- | --- |
| **M9** | **servers start at 4% of `moneyMax` and 3x `minDifficulty`** | `freshStart()` set `moneyAvailable = moneyMax` — **25x too rich** | modelled; this is the single biggest error |
| **M10** | **which version of `auto.js` was running is a function of the clock** | not modelled at all | both indices implemented and selectable |
| M1 | kill-in-flight discards the op entirely | absent | `killProc` removes the pending event |
| M2 | per-host (not per-thread) op granularity | strategies used a thread pool | `spawn`/`procOp` worker processes |
| M3 | 20s supervisor poll latency; RAM freed by a kill sits idle until the next cycle | instant redeploy | modelled in the supervisor |
| M4 | `ns.exec` returns 0 silently when RAM short | `exec` returned false, callers ignored it | `spawn` returns 0, `stats.execFails` counts it |
| M5 | security elevation inflates the duration of ops launched during it | **already correct** | unchanged, now exposed via `opSeconds` |
| M6 | level-up shortens ops launched after it | **already correct** | unchanged |
| M7 | oversubscription → negative marginal return | partly (drain capped) | priced in `ev.marginalHackThread` |
| M8 | restart cost = one full prep cycle | absent | it *is* `ev.prepCost`; see section 7 |

### M9 is the big one, and it is a two-line bug with a 25x lever [src + tel]

`src/Server/Server.ts:75-83`:

```ts
const baseMoney = params.moneyAvailable ?? 0;
this.moneyAvailable = baseMoney * currentNodeMults.ServerStartingMoney;  // x1 in BN1
this.moneyMax       = 25 * baseMoney * currentNodeMults.ServerMaxMoney;  // x1 in BN1
...
this.hackDifficulty = realDifficulty;          // = baseDifficulty
this.minDifficulty  = round(realDifficulty / 3);
```

So **every untouched server in the game sits at exactly 4.00% of its maximum
money and at three times its minimum security.** Checked against
`tools/sim/snapshot.json`: 58 of the 63 money servers are at 4.0000% to the
last digit, and the five that are not are exactly the five this fleet has
touched (`n00dles` 96.8%, `foodnstuff` 72.4%, `sigma-cosmetics` 4.26%,
`joesguns` 4.58%, `harakiri-sushi` 9.22%). **[tel]** Every `baseDifficulty /
minDifficulty` ratio is 3.00 or 3.33.

`tools/sim/world.mjs freshStart()` does:

```js
s.moneyAvailable = s.moneyMax;          // <-- 25x the game's actual value
s.hackDifficulty = s.baseDifficulty;
```

Which means **every strategy the optimizer has ever compared started the
network 25x richer than the game starts it**, with the entire opening grow
phase already paid for. That phase is not a rounding error: taking a
`serverGrowth = 25` server from 4% to 50% of max costs `ln(12.5)/k ≈ 2700`
thread-cycles, and on the 220GB fleet of the flat window that is **~86 minutes
of pure grow**, before the weakens it forces. The plateau is not exotic
behaviour — it is what prepping a fresh server costs, and the sim had deleted
it.

`world.mjs` is inside `tools/sim/`, which CLAUDE.md gives to the optimizer, so
I have **not** edited it. The fix is two lines:

```js
s.moneyAvailable = s.moneyMax / 25;               // src/Server/Server.ts:76-77
s.hackDifficulty = s.baseDifficulty ?? s.hackDifficulty;
```

My backtest does not depend on that change — `worldAt(..., {netState:"fresh"})`
in `tools/sim/fidelity/backtest.mjs` applies it locally — but every number in
`docs/optimizer-log.md` produced from `freshStart()` does.

### M10: the script changed under the experiment [tel + repo mtimes]

`ls` mtimes are local; the telemetry clock is UTC. `.telemetry/auto.txt` is
stamped `19:31` local with `"at": "2026-09-11T23:31:55.251Z"` inside it, so
**local = UTC − 4**. Converting:

| file | mtime (local) | = UTC | what changed |
| --- | --- | --- | --- |
| `early.js` | 16:30 | **20:30Z** | `MONEY_FLOOR` 0.75 → 0.5 |
| `buyserv.js` | 18:51 | 22:51Z | — |
| `watchdog.js` | 18:58 | 22:58Z | — |
| `auto.js` | 19:17 | **23:17Z** | ranking `M·φ/T` → the grow-aware ratio, **and** `shouldSwitch` gained its margin + hold guard |

So for the whole of the flat window (20:20Z–22:35Z) `auto.js` was ranking by
`M·φ/T` with **no switch guard whatsoever**, and the version currently in the
repo — the one the sim was replicating — did not exist yet. A backtest that
replays today's script against yesterday's telemetry is measuring the wrong
program. `tools/sim/fidelity/supervisor.mjs` now takes `{index, naive,
moneyFloor}` and `backtest.mjs` carries an `asRun` block per window recording
what was really deployed.

`M·φ/T` is the mechanism behind the plateau. It prices hack threads and nothing
else, so it picks the richest reachable server and is blind to how long putting
the money back takes. On this network at level 89 it picks **`foodnstuff`** —
`moneyMax` $50m, `serverGrowth` **5**, the slowest-regrowing money server in
the game — and the simulation then takes 128 minutes to grow it from 4% to the
50% floor `early.js` needs before it will hack at all.

---

## 4. The backtest

`node tools/sim/fidelity/backtest.mjs [--seeds N] [--window KEY] [--trace]`

Four windows. `earning`, `flat` and `burst` are reconstructed (the save does
not store per-server money or security, so the network is initialised to the
game's own untouched state — M9); `payout` uses `tools/sim/snapshot.json`,
captured 22:58:08Z, five minutes before it opens, so that one is the real
world rather than a reconstruction.

"Old sim" below = the modelling assumptions in force before this work:
`freshStart()`'s full-money network, retargets free, in-flight ops always land.
"Fixed" = M9 + M10 + M1-M4, running the script that was actually deployed.

| window | actual earned | old sim | fixed | error before | error after |
| --- | --- | --- | --- | --- | --- |
| **burst** (20:20→22:35:20) | **$4.30m** | $294.22m | **$6.01m** | **+$290m (+68x)** | **+$1.71m (+40%)** |
| **flat** (20:20→22:35:10, strict plateau) | **$0** | $294.22m | $6.01m | +$294m | +$6.01m |
| earning (18:47→20:18, control) | $2.18m | $63.99m | $0 | +$61.8m (+29x) | −$2.18m |
| payout (23:03→23:22) | ≥$442.6m | $1.01b | $36.2m | +$571m | −$406m |

Level gain over the burst window: **actual +83, predicted +83.** Exactly right,
across 135 minutes and 220GB of fleet. The exp channel — which is the binding
constraint on progress right now — is the part of the model that was never
broken, and the backtest confirms it rather than assuming it.

### What the trace says, which is the real result

`--trace` on the burst window, as-run script, 5 seeds:

```
  0.0m  foodnstuff  money   4.0%  sec 10.0/3  lvl  89  earned     $0  killed 0
 22.0m  foodnstuff  money   5.6%  sec  6.8/3  lvl 118  earned     $0  killed 0
 61.6m  foodnstuff  money  12.2%  sec  5.5/3  lvl 146  earned     $0  killed 0
101.5m  foodnstuff  money  29.9%  sec  7.0/3  lvl 162  earned     $0  killed 0
123.7m  foodnstuff  money  49.7%  sec  4.2/3  lvl 169  earned     $0  killed 0
128.2m  foodnstuff  money  45.5%  sec  6.7/3  lvl 170  earned  $4.47m  killed 0
```

- **Target: `foodnstuff`, chosen on cycle 1 and never changed.** Independently
  confirmed: the game-player's log for 20:15Z records *"`auto.txt` showed
  target `foodnstuff`, ramUsed 97/108, but `incomePerSec: 0`… security was
  elevated on all farms, 14-15 vs min 3-7, so early.js was mostly
  weaken/grow-ing, not hacking."* **[tel]** The sim picks the same server for
  the same reason and produces the same symptom.
- **Zero retargets. Zero kills.** 135 minutes of flat money with the kill
  mechanism never firing once.
- Money crosses `early.js`'s 50% floor at 128.2 minutes and the whole fleet
  hacks. Reality crossed it at 135 minutes. **5% error on the timing of a
  2¼-hour prep.**

### So the brief's leading hypothesis was wrong, and that matters

The brief identified the missing kill-in-flight mechanism and expected it to
explain the plateau. **It does not.** The kill mechanism is real, it is now
modelled, and in this window it never fires — the naive `auto.js` locks onto
`foodnstuff` on its first cycle and stays there because nothing ever outranks
it under `M·φ/T`.

The plateau is caused by three things stacking, none of which is a retarget:

1. `M·φ/T` picks the network's **lowest-growth** money server (M10).
2. That server starts at **4% of max money** and **3x min security** (M9).
3. `early.js` will not hack below **50% of max money**, so the entire 4% → 50%
   climb — `ln(12.5)/k ≈ 5100` grow thread-cycles at `serverGrowth` 5 — is
   spent earning exactly zero.

The guard added to `shouldSwitch` after the incident (margin 1.5, hold 4·T)
therefore does **not** address the cause. It is a good guard for a real
failure mode, but the two hours of $0 were not that failure mode. The fix that
would have worked is the ranking change (`M·φ/T` → the grow-aware ratio), which
in the same harness turns the 135-minute window from $6.01m into $145.72m —
and the timeline says that change landed at 23:17Z, four minutes before the
$450m payout.

### Where the remaining error is, honestly

- **`earning` (control), −$2.18m.** The sim earns $0; reality earned $2.18m in
  a smooth $20k-per-30s drip. Under `M·φ/T` at level 14 `foodnstuff` outranks
  `n00dles` by 27x, and with the then-current `MONEY_FLOOR` of **0.75** it
  never hacks — `foodnstuff` is at 72.44% in the 22:58 snapshot, i.e. it never
  once crossed 75% in five hours of play. **[tel]** So the drip did not come
  from the supervisor's target. The gameplay log shows repeated manual
  intervention in this period — orphaned `early.js` instances left behind by
  `auto.js` restarts, pointed at other servers. That is outside anything
  `supervisor.mjs` models and I have not tried to fake it.
- **`payout`, −$406m.** The window straddles the 23:17Z rewrite, so neither
  index is right for all of it; and the target choice is decided by *current*
  security (`ns.getHackTime` uses it), which the reconstruction can only get
  from a snapshot taken five minutes earlier. The as-run variant over-predicts
  exp 4x here (+27 levels vs +9), which says it settled on a low-requirement,
  short-op target where reality was on `phantasy`. This window is the one where
  the reconstruction is weakest despite having the best data, because the
  *decision* is the sensitive quantity, not the physics.
- Reconstructed rooted counts are within one server of the save's (12 vs 13,
  22 vs 23, 5 vs 4).

## 3. What was built

Three new files, all mine:

| file | what it is |
| --- | --- |
| `tools/sim/fidelity/supervisor.mjs` | a line-for-line replica of `auto.js` + `early.js` on the engine's new process model, including the parts that are wrong. Four variants: naive retarget with kills ignored (= the old sim), naive retarget with kills modelled, the shipped guard, and an EV retarget. |
| `tools/sim/fidelity/backtest.mjs` | replays a telemetry window and reports the error against what really happened |
| `tools/sim/fidelity/ev.mjs` | the expected-value functions, section 6 below |

and additions to `tools/sim/engine.mjs` (nothing removed, nothing renamed — the
optimizer's `exec`/`execAt`/`execPad` behave exactly as before):

- `spawn(host, {script, threads, ramPerThread, args, onLand, state})` → pid or
  **0**. A long-lived worker process that holds its RAM until killed. Returns 0
  silently when RAM is short and bumps `stats.execFails`, which is what
  `runScriptFromScript` does (`NetscriptWorker.ts:314-353`). **[src]**
- `procOp(pid, op, target)` — start an op from inside a process. RAM already
  held; duration read from the world *now*.
- `killProc(pid)` — releases the RAM and **removes the pending landing event
  from the queue**, so it never fires. Charges `stats.killedOps`,
  `killedThreadSeconds`, `killedMoneyForgone`.
- `psOn(host)`, `killProcsOn(host, pred)` — the sim's `ns.ps` / `ns.kill`.
- `opSeconds(op, target)` — the duration, exposed, because it is the quantity
  both desync mechanisms act on.
- `complete()` split into lifecycle + `applyOp()`. A pid'd event whose process
  is gone is **dropped without applying anything** — no money, no exp, no
  security. That one line is mechanism M1.

The worker loop is `onLand`: when a process's op lands, the engine calls it in
the same step, and it picks the next op from the world that landing just
changed. That is the real Netscript semantics — the `netscriptDelay` promise
resolves and the script's next statement runs in a microtask of the same task
(prior-art 9c) — and it is why `early.js` workers on different hosts drift out
of phase with each other and all pile onto whatever the threshold says *now*.
