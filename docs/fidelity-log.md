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

## Summary

**Backtest error, on the window whose outcome is least ambiguous** (20:20Z →
22:35:20Z: 135 minutes of money frozen at $487,820, ending in a single
$4,304,595 payout):

| | earned | error | level gain |
| --- | --- | --- | --- |
| actual | $4.30m | — | +83 |
| sim before | $294.22m | **+$290m (68x)** | +82 |
| sim after | $6.01m | **+$1.71m (40%)** | **+83** |

**The two mechanisms that explain the plateau were not the one in the brief.**

1. **M9 — every untouched server starts at exactly 4% of `moneyMax` and 3x
   `minDifficulty`** (`src/Server/Server.ts:75-83`, confirmed on 58 of 63
   servers in the snapshot). `tools/sim/world.mjs freshStart()` set
   `moneyAvailable = moneyMax` — **25x too rich** — which deletes the entire
   opening grow phase from every comparison in `docs/optimizer-log.md`.
2. **M10 — the script changed under the experiment.** Converting file mtimes
   (local = UTC−4, pinned by `.telemetry/auto.txt`), `auto.js` was still
   ranking by `M·φ/T` with no switch guard for the whole flat window; the
   version the sim was replaying did not exist until 23:17Z. `M·φ/T` picks
   `foodnstuff` — `serverGrowth` **5**, the slowest-regrowing money server in
   the game — and `early.js` will not hack below 50% of max, so the 4% → 50%
   climb is 128 minutes of guaranteed $0.

The kill-in-flight mechanism the brief identified **is real, is now modelled,
and never fires in these windows** — the as-run supervisor locks onto
`foodnstuff` on cycle 1 and retargets zero times in 135 minutes. The
`shouldSwitch` guard added after the incident therefore does not address its
cause. Changing the ranking index does: the same harness turns that window
from $6.01m into $145.72m.

**Independent confirmation:** the sim picks `foodnstuff` on its own, and the
game-player's log for 20:15Z records *"`auto.txt` showed target `foodnstuff`
… `incomePerSec: 0`"*.

**EV:** `tools/sim/fidelity/ev.mjs` prices each op and each decision in
RAM-seconds, with experience as a second currency. The retarget test it
exposes rejects `foodnstuff` and every other candidate whose prep exceeds the
horizon, and picks `n00dles` (prep 203s) over `harakiri-sushi` (prep 1777s) by
32x — with no tuned constants.

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
~220GB. Whatever the mechanism is, it does not need a big fleet. The 23:03
plateau at 2.3TB is the same mechanism at 10x the RAM, and it broke after 18
minutes instead of 135, which is consistent with "prep completes eventually,
and more RAM makes prep faster". Section 4 shows that is exactly what it is:
the plateau *is* the prep, and its length is `prepRamSeconds / fleetRam`.

The post-plateau shape confirms it. After 22:35 the fleet paid $4.30m, then
$4.09m at 22:40, $2.25m at 22:45, $4.44m at 22:47 — **roughly $4m every five
minutes, indefinitely.** **[tel]** Nothing changed at 22:35 except that the
target finally crossed `early.js`'s money floor.

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

`shouldSwitch` (added at 23:17Z, after the incident) now requires
`heldForMs >= 4*hackTime` **and** `candidateRate > currentRate*1.5`. Both
constants are guesses, and section 4 shows the failure it guards against is
not the one that actually happened. Section 6b replaces it with a test that
needs no constants.

## 2. The missing mechanisms — status

| # | mechanism | before | now |
| --- | --- | --- | --- |
| **M9** | **servers start at 4% of `moneyMax` and 3x `minDifficulty`** | `freshStart()` set `moneyAvailable = moneyMax` — **25x too rich** | modelled; this is the single biggest error |
| **M10** | **which version of `auto.js` was running is a function of the clock** | not modelled at all | both indices implemented and selectable |
| M1 | kill-in-flight discards the op entirely | absent | `killProc` removes the pending event — **real, modelled, and never fired in the measured windows** |
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

Nothing the optimizer depends on changed shape. Regression check after the
engine edits:

```
$ node tools/sim/run.mjs --only early-n00dles,auto-early,bt2048-ba --minutes 10 --seeds 2
  hwgw xauto eps200 @ 2048GB   $4.76m   ...  100  2128  71%
  early.js on n00dles          $1.40m   ...   34    92  95%
  early.js — retargeting           $0   ...   19    60  95%
```

The worker loop is `onLand`: when a process's op lands, the engine calls it in
the same step, and it picks the next op from the world that landing just
changed. That is the real Netscript semantics — the `netscriptDelay` promise
resolves and the script's next statement runs in a microtask of the same task
(prior-art 9c) — and it is why `early.js` workers on different hosts drift out
of phase with each other and all pile onto whatever the threshold says *now*.

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
- In the flat/burst windows the kill mechanism changes nothing, because the
  as-run supervisor never retargets. `kills modelled` and `kills NOT modelled`
  produce identical numbers there. That is a result, not a bug: M1 is real but
  it was not the cause.

---

## 5. Expected value — `tools/sim/fidelity/ev.mjs`

`node tools/sim/fidelity/ev-probe.mjs [--level N] [--ram GB] [--horizon S]`
prints every function below against the live snapshot.

Three commitments the module keeps to:

1. **Everything is priced in RAM-seconds.** RAM is the scarce resource; wall
   time is free (we are not the ones waiting) and money is renewable.
2. **Security is an externality and is charged back.** A hack thread adds 0.002
   security, a grow thread 0.004, and undoing that costs weaken threads held
   for 4x hack time. Charging them to the op that caused them is what turns
   `M·φ/T` into the grow-aware ratio — and it *derives* `auto.js`'s magic
   constants rather than transcribing them:

   ```
   loadedHackRamSeconds = 1.70·T  + (0.002/0.05)·1.75·4T = 1.98·T
   loadedGrowRamSeconds = 1.75·3.2T + (0.004/0.05)·1.75·4T = 6.16·T
   ```

   1.98 and 6.16 are the numbers in `auto.js`'s `rateOf`, now produced by a
   function of `(server, player, cores)` instead of hard-coded — so they stay
   right when cores > 1 (the weaken term shrinks by the core bonus) and after
   the first augmentation install changes the multipliers.
3. **Experience is a second currency.** Every op EV reports `exp` beside
   `money`, and `expPriceFromHorizon` converts between them.

### Per operation

| function | returns, per thread |
| --- | --- |
| `evHackThread(s, p, {threads})` | `{money: chance·drainPerThread, exp, seconds, ramSeconds, loadedRamSeconds, chance, phi, securityAdded}` |
| `evGrowThread(s, p, {threads})` | `{money, serverMoney, exp, k, loadedRamSeconds, securityAdded, wastedThreads}` |
| `evWeakenThread(s, p, {opsAhead})` | `{securityRemoved, ramSecondsSaved, phiGain, chanceGain, exp, ramSeconds}` |
| `marginalHackThread(s, p, n)` | `{money, capacity: 1/phi, saturated}` |

Weaken has no money term, so it is priced by what it gives back: `T` is affine
in `hackDifficulty`, so one thread saves `0.05 · dT/dD · opsAhead · opRam`
RAM-seconds. `dT/dD` is obtained by evaluating `calculateHackingTime` at `D`
and `D+1` rather than re-deriving the constant, so it cannot drift from the
game.

At level 89 on `harakiri-sushi` at 9.2% money, 91 threads:

```
hack    $14.06k  exp 5.79   40.8s  RAM-s  69.4  loaded  80.9
grow    $ 9.70k  exp 7.50  130.7s  RAM-s 228.8  loaded 251.6
weaken  $  0.00  exp 7.50  163.4s  RAM-s 285.9  saves 29 RAM-s
```

— i.e. with the server nearly at min security already, a weaken thread returns
29 RAM-seconds for 286 spent and should not be run. `evPrepVsHack` says `hack`.

### Oversubscription is negative, and here is the exact reason

`marginalHackThread` reports capacity `1/φ` and the marginal dollar at `n`.
Past `n* = ceil(1/φ)` three things happen at once, all read out of
`NetscriptHelpers.tsx`'s hack handler **[src]**:

- money is capped (`if (moneyDrained > server.moneyAvailable) moneyDrained = moneyAvailable`),
- security is capped too (`fortify(0.002 · min(threads, maxThreadNeeded))`),
- but **exp is demoted**: `if (moneyDrained === 0) expGainedOnSuccess = expGainedOnFailure`, so the whole cohort drops to a quarter exp.

So the marginal thread past `n*` returns zero money, zero extra security, and
**a quarter of the experience it would have earned on another target**, while
occupying 1.7GB for `T` seconds. Negative in opportunity cost, exactly as
prior-art §6 argues. On `harakiri-sushi` at level 89, `n* = 457` threads and
the fleet has 91, so this particular fleet is nowhere near saturation — which
is itself the answer to "should we split", below.

### Per decision

**`evRetarget({current, candidate, player, fleetRamGb, horizonSeconds, inFlightRamSeconds})`**

This is the function that would have prevented the incident. The old
comparison was `rate(candidate) > rate(current)`, which is the `H → ∞`,
zero-prep-cost limit — under which switching is free and always right. The
honest version over a finite horizon:

```
value(x) = rate(x) · fleetRamGb · max(0, H − prepSeconds(x))
switch  ⟺  value(candidate) − discarded > value(incumbent)
discarded = inFlightRamSeconds · rate(incumbent)
```

At level 89, 220GB, H = 30 minutes, incumbent `harakiri-sushi`:

```
-> joesguns       stay $1.91m (prep 1777s)  move $0.00 (prep 2929s)  => stay
-> nectar-net     stay $1.91m (prep 1777s)  move $0.00 (prep 3513s)  => stay
-> max-hardware   stay $1.91m (prep 1777s)  move $0.00 (prep 6004s)  => stay
-> n00dles        stay $1.91m (prep 1777s)  move $62.10m (prep 203s) => SWITCH
```

Every candidate except `n00dles` needs more prep than the whole horizon and is
therefore worth **exactly zero**, however good its steady-state rate looks.
`n00dles` preps in 203 seconds and wins by 32x. `foodnstuff` — the server the
live supervisor actually picked and sat on for 135 minutes — needs 995s of prep
and has the *lowest* `$/RAM-s` of the ten reachable targets (73.8 against
`harakiri-sushi`'s 370.5). No tuning was involved in getting that answer; it
falls out of charging for prep.

**`evPrepVsHack(s, p, {threads})`** — `early.js`'s `MONEY_FLOOR` in closed
form. Returns `$/RAM-second` for each of the three ops and which is largest.

**`evBuyRam({gb, cost, achievedRatePerRamSecond, horizonSeconds})`** — the
important word is *achieved*. At `harakiri-sushi`'s rate every purchase pays
back in 148 seconds and the answer is always BUY. At the rate the fleet
actually achieved during the flat window — **$0/RAM-second** — every purchase
is "hold", because more RAM buys more of nothing. That is the number
`buyserv.js` should be asking for and currently cannot: it has no way to know
whether the fleet is earning.

**`fleetSplit(targets, p, {fleetRamGb})`** — greedy fill of the ranked list,
which is exactly optimal because return per target is linear up to its cap
(prior-art §6). `targetCapacityRamGb` is the cap: the RAM-seconds of one full
cycle divided by the cycle period. At level 89 `harakiri-sushi` alone absorbs
5262GB, so a 220GB fleet should **concentrate, not split** — and the function
says so by leaving 0GB idle on one target.

**`expPriceFromHorizon(s, p, {fleetRamGb, horizonSeconds})`** — what a level is
worth. At level 89, 220GB, H = 30min: one level is worth **$1.84m** and costs
**1.35k exp**, so **$1,356 per exp point**. A hack thread on `harakiri-sushi`
pays 5.79 exp = $7.9k of level, against $14.1k of money — so **experience is
36% of a hack thread's total value** at this stage, which is why a strategy
scored on money alone will systematically under-value grow and weaken.

### Using these from the live game

`ev.mjs` imports the game's real formulas through `game.mjs`, which only exists
under node. To call the same functions from Netscript, the ns-side equivalents
are one-to-one:

| `ev.mjs` uses | Netscript |
| --- | --- |
| `calculateHackingTime(s, p)` (seconds) | `ns.getHackTime(host)/1000` |
| `calculatePercentMoneyHacked(s, p)` | `ns.hackAnalyze(host)` (fraction; evaluates at *current* security) |
| `calculateHackingChance(s, p)` | `ns.hackAnalyzeChance(host)` |
| `calculateServerGrowthLog(s, 1, p, c)` | no direct export — `auto.js` already inlines it |
| `numCycleForGrowthCorrected(...)` | `ns.growthAnalyze(host, mult, cores)` |
| `getWeakenEffect(1, cores)` | `ns.weakenAnalyze(1, cores)` |

The cheapest honest split, and my recommendation: keep `ev.mjs` as the single
definition, and have `auto.js` call a small shared module that inlines the same
arithmetic (as it already does for `rateOf`). Anything richer costs RAM in the
controller, which is paid once, so it is affordable — but see prior-art §9d(6):
never move a sensing call into a worker.

---

## 6. Changes needed in files I do not own

Nothing below has been edited. Each is stated so it can be applied by whoever
owns the file.

### 6a. `tools/sim/world.mjs` — `freshStart()` starts the network 25x too rich

**Highest priority. This invalidates absolute numbers throughout
`docs/optimizer-log.md`.**

```js
// current
s.moneyAvailable = s.moneyMax;
// correct — src/Server/Server.ts:75-83, confirmed against 58 servers in snapshot.json
s.moneyAvailable = s.moneyMax / 25;
s.hackDifficulty = s.baseDifficulty ?? s.hackDifficulty;   // already correct
```

Ranking comparisons between strategies that all pay the same prep are probably
still directionally right. Anything that reports dollars per hour, or that
compares a strategy which preps against one which does not, is not.

### 6b. `auto.js` — the retarget decision should be `evRetarget`, not a ratio

`shouldSwitch` currently asks `candidateRate > currentRate * 1.5` with a hold
of `4 · hackTime`. Both constants are guesses. The EV form needs no constants:

```js
// value(x) = rate(x) · fleetRamGb · max(0, H − prepSeconds(x))
// switch iff value(candidate) − inFlightRamSeconds·rate(current) > value(current)
```

`prepSeconds` needs only `getServerSecurityLevel`, `getServerMinSecurityLevel`,
`getServerMoneyAvailable`, `getServerMaxMoney`, `getServerGrowth` and
`getHackTime` — all of which `auto.js` already pays for. `H` should be the
horizon the operator actually cares about; 30 minutes reproduces the decisions
in section 5.

The decisive number: at level 89 on a 220GB fleet, this test rejects
`foodnstuff`, `joesguns`, `nectar-net`, `max-hardware` and `hong-fang-tea`
outright — all of them need more prep than the entire horizon — and picks
`n00dles`, which preps in 203 seconds. The live supervisor picked `foodnstuff`
and earned $0 for 135 minutes.

### 6c. `auto.js` — `rateOf` should charge the prep it is about to incur

`rateOf` scores the *steady state* a target sustains once prepped, which is
right for "where do we want to be" and wrong for "what do we do next". Two
targets with the same steady-state rate are not equally good if one is at 4% of
max money and the other at 90%. `ev.prepCost(server, player).secondsAtRam(fleet)`
is the missing term and is cheap.

### 6d. `early.js` — `MONEY_FLOOR` is the wrong control variable

A fixed fraction of `moneyMax` decides nothing about value; it decides how long
the fleet earns zero. On `serverGrowth 5` at 4% starting money it is a
two-hour commitment. `ev.evPrepVsHack` returns `$/RAM-second` for hack, grow
and weaken from the state now, and taking the largest is the same decision made
on the merits. It costs no extra RAM in the worker if the controller passes the
answer down as an argument — and per prior-art §9d(6), putting the sensing in
the worker would cost 0.1GB *per thread*.

Interim, much cheaper fix if the loop is to stay as it is: make the floor a
function of `serverGrowth`, because the time to reach it is `ln(floor/0.04)/k`
and `k ∝ serverGrowth`.

### 6e. `buyserv.js` — price RAM against the *achieved* rate

`ev.evBuyRam` takes `achievedRatePerRamSecond`, deliberately. During the flat
window the achieved rate was $0/RAM-second and every purchase was value-
destroying; `buyserv.js` had no way to see that and kept buying.
`ns.getTotalScriptIncome()[0] / totalFleetRamGb` is the measurement, and it is
one call.

### 6f. `tools/sim/strategies.mjs` — retargeting is free there

`autoTarget` / `autoTargetBy` swap `this._inner` for a new factory and leave
the old ops flying; they land and pay. That is not what `deploy()` does. The
engine now exposes `spawn` / `procOp` / `killProc` / `psOn`, so a faithful
version is available if the optimizer wants one; `tools/sim/fidelity/
supervisor.mjs` is a worked example. Note the backtest says this matters *less*
than expected for the windows measured — it never fired — so this is
correctness, not an urgent number.

---

## 7. What is still unmodelled

Named so nobody assumes otherwise.

- **Restart cost (M8).** The engine can express it — `killProc` every worker —
  but the supervisor does not simulate `auto.js` dying and `watchdog.js`
  restarting it, and the empirical "a restart costs a full prep cycle" is
  exactly `ev.prepCost(target).secondsAtRam(fleet)` from wherever the target
  was left. In the flat window that would have been up to 128 minutes. The
  gameplay log records at least six deliberate `kill auto.js` / `run auto.js`
  cycles for contract solving; each one is a prep restart.
- **Orphaned workers.** `kill auto.js` leaves `early.js` instances running
  against the old target; `deploy()` will kill them next cycle only if the
  target differs. The gameplay log records these repeatedly and they are almost
  certainly where the control window's $2.18m came from. Not modelled.
- **`scp`/`exec` latency.** Prior-art §9c establishes it is sub-millisecond
  once a script is warm on a host and a real dynamic `import()` the first time.
  The 20-second supervisor poll dominates it by four orders of magnitude, so
  modelling the poll (done) and ignoring the rest is defensible. The one case
  where it would matter is a first-ever deploy to many new hosts at once.
- **Page reloads / offline production** (prior-art §9d(3)). Not modelled and
  the telemetry shows no gap large enough to need it.
- **Manual play.** Program purchases, home RAM upgrades, contract income,
  travel. The backtest subtracts recorded purchases from the money delta to get
  `earnedLowerBound`, but contract income ($100m in one shot at ~22:53) is
  *added* to money and cannot be separated, which is why no window spans it.

---

## 8. Reproducing everything here

```bash
# the backtest table in section 4
node tools/sim/fidelity/backtest.mjs --seeds 5

# the "old sim" column: full-money network, the way freshStart() builds it
node tools/sim/fidelity/backtest.mjs --seeds 5 --net max

# the trace in section 4
node tools/sim/fidelity/backtest.mjs --window burst --trace --seeds 5

# every EV number in section 5
node tools/sim/fidelity/ev-probe.mjs --level 89 --ram 220 --horizon 1800
node tools/sim/fidelity/ev-probe.mjs                 # live state, 2380GB

# the 4%-of-max check
node -e 'const s=JSON.parse(require("fs").readFileSync("tools/sim/snapshot.json","utf8"));
  let n=0; for(const r of s.servers) if(r.moneyMax>0 && Math.abs(r.moneyAvailable/r.moneyMax-0.04)<1e-9) n++;
  console.log(n,"of",s.servers.filter(r=>r.moneyMax>0).length,"money servers at exactly 4.00%");'
```

The simulator is slow to start (the 12MB game bundle loads under jsdom, ~60-90s
before the first line of output) and slower when several runs are in flight at
once. Redirect to a file and read it rather than piping through `tail` — a bare
`node -e 'import(...)'` never exits, because jsdom holds the event loop open,
so a pipe will appear to hang forever.

---

# Part II — the systematic audit (2026-09-11, second fidelity agent)

The `freshStart()` fix from Part I has been applied by the lead. Everything
below is new work: re-validation, re-measurement of the optimizer's conclusions
on the corrected world, and an audit of the rest of `tools/sim/` and of the
root scripts.

## 9. Re-validation: the backtest is unchanged, and that is the expected result

```
$ node tools/sim/fidelity/backtest.mjs --seeds 5
burst  actual $4.30m   fixed $6.01m   err +$1.71m (+40%)   lvl +83 vs +83
flat   actual $0       fixed $6.01m
payout actual ≥$442.6m fixed $36.22m
earning actual $2.18m  fixed $0
```

Identical to Part I to the cent. This is **correct, not a null result**:
`backtest.mjs` never called `freshStart()` — it builds its own world with
`worldAt(..., {netState:"fresh"})` and applied the 4%-of-max rule locally from
the day it was written. The lead's edit to `world.mjs` moved the *optimizer's*
world to where the backtest already was. So the 40% figure is reproducible and
the two code paths now agree on the same starting state, which is the thing
worth having.

## 10. The optimizer's measurements, re-run on the corrected world

`docs/optimizer-log.md` §5 and §6 were both taken through `run.mjs`, which does
call `freshStart()`. Both were therefore measured on the 25x-rich world. Re-run
verbatim, same flags, same seed counts:

### §6 target ranking index — **the conclusion survives, the magnitude was wrong by 10x, and the 60-minute window it was measured in is no longer long enough to measure it**

| index | §6 as published, 108GB | **re-run, 108GB, 60m** | **re-run, 108GB, 180m** |
| --- | ---: | ---: | ---: |
| `live` (`M·φ/T`) | $62.4m | **$0** | $20.00m |
| `liveChance` | $54.2m | $0 | — |
| `batch` | $72.7m | $171.6k | $82.52m |
| **`batchChance`** (shipped) | **$83.8m** | **$523.2k** | **$88.91m** |

| index | §6 as published, 1,364GB | **re-run, 60m** | **re-run, 180m, 9 seeds** |
| --- | ---: | ---: | ---: |
| `live` | $652m | **$649.72m** | $1.31b |
| `liveChance` | $154m | $100.93m | — |
| `batch` | $1.42b | $491.05m | **$2.26b** |
| `batchChance` | $1.42b | $535.44m | $2.09b |

At 8,192GB, 120 minutes, the three are within 1.2% of each other
(`batchChance` $2.63b, `live` $2.61b, `batch` $2.60b) — the saturated regime,
where the target choice stops mattering because one fleet-wide op serialises
everything whatever it is pointed at.

Three things follow.

1. **The shipped index is still the right one.** At the fleet size the live
   game had, the ranking fix is now worth **4.4x** (`$88.91m` vs `$20.00m`),
   not the +34% §6 reports. The old world's 25x head start let `live` coast on
   money that was already there; take that away and picking `foodnstuff`
   (`serverGrowth 5`) costs almost everything. **The conclusion strengthened
   substantially.**
2. **The 60-minute measurement window is now invalid at 1TB+.** At 1,364GB the
   60-minute table says `live` **wins** by 32%. Look at its curve: `$0` until
   minute 21, one step to $49.72m, flat for 35 minutes, then a single step to
   $649.72m at minute 56. That is one prep-and-drain cycle, and whether its
   second drain falls inside the window is a coin flip. Income on the corrected
   world is the step function §0 describes; a cumulative total over a window
   shorter than one cycle measures window alignment, not rate. **Every
   60-minute number in `optimizer-log.md` §3-§7 taken at ≥1TB has this
   problem**, and it is a *separate* defect from the 25x world.
3. `liveChance` remains worst, as §6 said.

### §5 money floor — **inverted at small fleets, confirmed at large ones, and the shipped value is now the worst possible choice at 108GB**

| money floor | §5 as published, 108GB | **re-run, 108GB** | §5 as published, 1.4TB | **re-run, 1.4TB** |
| ---: | ---: | ---: | ---: | ---: |
| 1% | $92.5m | **$3.54m** | $657m | $28.52m |
| 5% | $91.7m | $1.26m | $708m | $62.32m |
| 10% | $90.8m | **$0** | **$752m** | $134.15m |
| 25% | $88.1m | $0 | $697m | $341.71m |
| **50% (shipped)** | $79.1m | **$0** | $652m | **$666.04m** |
| 75% (old live) | $62.4m | $0 | $652m | $649.72m |
| 90% | $49.8m | $0 | $685m | $657.50m |
| 99% | $43.6m | $0 | $649m | $657.50m |

- **At 108GB the direction survives (lower is better) but the cliff moved.**
  Published: a smooth 2.1x spread from 99% to 1%. Actual: **everything at 10%
  and above earns exactly $0 in an hour**, because a fresh server starts at 4%
  of max and the fleet cannot climb to a 10% floor inside 60 minutes. The
  shipped `MONEY_FLOOR = 0.5` earns nothing at all at this fleet size — which
  is precisely the $0-for-two-hours the live game saw, reproduced from first
  principles.
- **At 1.4TB the ranking inverts outright.** Published: 10% best, 50% mid-table,
  1% competitive. Actual: **50% best and 1% worst by 23x.** The published table
  had a 1.15x spread top to bottom; the real one has 23x. §5's "the optimum is
  the smallest f integrality allows" was an artefact of starting every server
  full: with the money already there, a tiny floor cycles fast and loses
  nothing, and the regrowth cost the prior-art model prices never had to be
  paid.
- **The shipped 0.5 is vindicated at 1TB+ and indefensible below it.** §7's
  "50% is within a few percent of the best at both ends" is false on the
  corrected world: it is the best at 1.4TB and it is $0 at 108GB.

### §5 security slack — **no longer measurable; the published conclusion has no support**

Re-run at 108GB, 60 minutes, 7 seeds: `+0`, `+1`, `+2`, `+3`, `+5`, `+10`,
`+20` **all earn exactly $0**. The spread §5 reports ($46.6m → $62.4m, with +5
the optimum) was entirely a property of the 25x world. The slack is not
necessarily wrong — it is simply unmeasured. Anyone re-deriving it needs a
fleet ≥1TB or a window ≥3 hours.

### What survives, in one line each

| §  | claim | verdict |
| --- | --- | --- |
| §5 | money floor: lower is better at small fleets | **survives**, and the cliff is far sharper than published |
| §5 | money floor: 50% is near-best at both ends | **falsified** — $0 at 108GB, best at 1.4TB |
| §5 | security slack +5 is optimal | **unsupported** — every value now measures $0 |
| §6 | `M·φ/T` over-ranks rich slow-growing servers | **survives, strengthened** — 4.4x, not 1.34x |
| §6 | hack chance only pays with the grow term | **survives** — `liveChance` still worst |
| §6 | ordering reverses above saturation | **survives** — at 8.2TB all three are within 1.2% |
| §3/§7 | absolute dollar figures | **all void**, twice over: 25x world *and* a window shorter than one cycle |
| §13/§14 | batcher beats threshold loop | not re-run; both arms shared the same world, so the *ranking* is safe, and the batcher's advantage should grow because prep is exactly what it pipelines |


## 11. New divergence: **rooting is not gated on hacking level** — and three files believe it is

This is the same shape as M9: a plausible simplification, never checked, deciding everything downstream.

**What the game does** — three independent places, all agreeing:

- `src/Programs/Programs.ts:68` — NUKE.exe's `run()` is
  `if (server.openPortCount >= server.numOpenPortsRequired) { server.hasAdminRights = true; ... }`.
  There is no hacking-level test.
- `src/NetscriptFunctions.ts:504-519` — `ns.nuke` checks `hasAdminRights`,
  owning NUKE.exe, and `openPortCount < numOpenPortsRequired`. Nothing else.
- `src/Hacking/netscriptCanHack.ts` — `netscriptCanHack` (`:39`) is the *only*
  one of the three that tests `requiredHackingSkill > Player.skills.hacking`.
  `netscriptCanGrow` and `netscriptCanWeaken` (`:49-55`) call `baseCheck`
  alone, which tests root.

So **a level-1 player who owns BruteSSH.exe owns every one-port server's RAM
immediately.** They cannot *hack* those servers, but they can run grow, weaken
and any worker script on them. Hacking level gates the *target* list, never the
*host* list.

**Where we get it wrong**, in order of cost:

| file | line | what it does |
| --- | --- | --- |
| `tools/sim/engine.mjs` | `nuke()` | **fixed by me, see below** |
| `batch.js` | `tryRoot`, line 107 | `if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) return false` — the live controller |
| `auto.js` | `tryRoot`, line 59 | identical (retired, but `watchdog.js` could still bring it back) |
| `spider.js` | line 67 | `ports <= portHacks && hackingLevel <= playerDetails.hackingLevel` |
| `buyserv.js` | lines 43-45 | the *reserve policy* rests on the belief. See §13. |

`hack.js` — the oldest, never-run script — **has it right** (line 149 filters on
`ports <= playerDetails.portHacks || hasRootAccess` and nothing else). The
newer scripts regressed against it.

### Cost, measured on this save's network

Rootable RAM the level gate withholds, `tools/sim/snapshot.json`, non-purchased servers:

| openers owned | game rootable | sim/`batch.js` rootable at lvl 1 | at lvl 50 | at lvl 100 | at lvl 200 |
| --- | ---: | ---: | ---: | ---: | ---: |
| none | 100GB | 20GB | 100GB | 100GB | 100GB |
| BruteSSH | 236GB | 20GB | 132GB | 236GB | 236GB |
| +FTPCrack (live) | 404GB | 20GB | 132GB | 268GB | 332GB |

At level 1 with the two openers the live game owns, the sim saw **20GB of
404GB**. Even at level 200 it withheld 18%.

**And on the live fleet right now** (`.telemetry/status.txt`, 00:18Z, level 246,
41 rooted): the `numOpenPortsRequired = 3` group is **8 servers holding 688GB**
with required levels 308-521. `relaySMTP.exe` costs **$5m** and the player is
holding **$700m**. Under the real rule those 688GB become worker RAM the moment
the program is bought — **$7.3k/GB against the cloud's flat $55k/GB**, a 7.5x
better deal than the purchase `buyserv.js` is making with the same money.
`HTTPWorm.exe` at $30m adds a further 704GB at $43k/GB, still cheaper than the
cloud. `batch.js`'s `tryRoot` will refuse all of it until hacking 308/408.

### Fixed in `engine.mjs` (mine)

`nuke()` no longer tests `requiredHackingSkill`; `targets()` still does, because
that test is real. Effect on the §10 tables, same flags, 180 minutes, 9 seeds:

| arm | before the fix | after |
| --- | ---: | ---: |
| `batchChance` @ 108GB | $88.91m | **$109.01m** (+23%) |
| `batch` @ 108GB | $82.52m | $101.97m |
| `live` @ 108GB | $20.00m | $24.02m |
| `batchChance` @ 1,364GB | $2.09b | **$2.35b** |
| `batch` @ 1,364GB | $2.26b | $2.26b |
| `live` @ 1,364GB | $1.31b | $1.27b |

Fleet at the "+2p" arms goes 1,364GB → 1,436GB, and the 108GB arms reach their
full 108GB in the first minute instead of climbing to it over twenty. Note this
**restores §6's published ordering at 1TB** (`batchChance` > `batch` > `live`),
which the pre-fix run had scrambled — the level gate was suppressing exactly the
servers the grow-aware index wants to move to.

## 12. New divergence: `freshStart()` handed every run this playthrough's purchased fleet

Second bug in `world.mjs`, found and fixed. `freshStart()` set
`hasAdminRights = false` on the save's cloud servers but **left them in the
world**. On the current snapshot that is **1,728GB across four servers**
(`pserv-87930` 1024GB, `pserv-7931` 512GB, `pserv-47920` 128GB, `pserv-67930`
64GB). Their `numOpenPortsRequired` is 5 and `requiredHackingSkill` is 1, so
`nuke()` handed them back free the moment a run owned all five port openers —
which the `infra-*`, `ship-*` and `spread-*` families are designed to reach.
They also did not count against `getCloudServerLimit()` (25,
`src/Server/data/Constants.ts`), so a strategy could finish a run holding 29
cloud servers.

`darkweb` had the same problem in miniature: `freshStart` set
`player.hasTor = false` but left the `darkweb` server present, and
`snapshotFromSave` infers `hasTor` from its presence — an inconsistency waiting
for a caller who reads the server list instead of the flag.

`freshStart()` now drops every `purchasedByPlayer` server except `home`, and
drops `darkweb`. `atTotalRam` in `strategies.mjs` already did this locally,
which is direct evidence the optimizer hit the problem and patched around it in
one strategy rather than at the source.

## 13. `batch.js` — audit of the live controller

Read at 2026-09-11 20:0x. **Not edited.** Constants first, since those are what
bite.

### Verified correct against source

| `batch.js` | value | source |
| --- | --- | --- |
| `FORTIFY` | 0.002 | `ServerConstants.ServerFortifyAmount`, `src/Server/data/Constants.ts:9` |
| `WEAKEN_PER_THREAD` | 0.05 | `ServerConstants.ServerWeakenAmount`, `:10` |
| `MAX_GROWTH_LOG` | 0.00349388925425578 | `ServerConstants.ServerMaxGrowthLog`, `:7` |
| `BASE_GROWTH_INCR` | 0.03 | `ServerConstants.ServerBaseGrowthIncr`, `:6` |
| `hackFraction` | `((100−D)/100)·((L−(R−1))/L)/240` | `calculatePercentMoneyHacked`, `src/Hacking.ts:44-58` — exact with all mults 1 |
| `hackChance` | `((max(1.75L,1)−R)/max(1.75L,1))·((100−D)/100)` | `calculateHackingChance`, `src/Hacking.ts:9-24` — exact, including the `clampNumber(…,1)` floor |
| `growthK` | `min(log1p(0.03/D), MAX)·(g/100)` | `calculateServerGrowthLog`, `src/Server/formulas/grow.ts:8-28` — exact at `cores=1` |
| `weakenTime = 4·hackTime`, `growTime = 3.2·hackTime` | | `src/Hacking.ts:83-94` |
| hack security bump `FORTIFY·min(h, ceil(1/φ))` | | `NetscriptHelpers.tsx:672` |
| grow security bump `2·FORTIFY·usedCycles`, `usedCycles ≤ threads` | | `processSingleServerGrowth`, `ServerHelpers.ts:209-214` |

**`readTarget`'s hackTime rescaling is a genuinely good piece of fidelity** and
deserves naming: `ns.getHackTime` reports the server *as it is now*, but a batch
lands on a server held at minimum security. `calculateHackingTime` is affine in
`hackDifficulty` through `(2.5·R·D + 500)`, so batch.js rescales by that ratio
(`batch.js:201-203`) rather than sampling at the wrong security. Exactly right.

**`additionalMsec` and the single burst are right** — all four `ns.exec` calls
happen with no `await` between them and no `ns` call that yields, so all four
read the same level and the same security, and the pads are computed from the
same `readTarget`. This is the mechanism `h.js`'s header describes and it holds.

### Bug 1 — `moneyTol` and `secTol` are not coupled to the plan, and both are reachable

`SETTINGS.secTol = 1.0` and `SETTINGS.moneyTol = 0.6` abandon a pipeline when
the target drifts past them. But **the batch's own H operation moves the target
by an amount the plan chooses, and nothing checks that against the tolerance.**
The health check runs *before* the safe-window gate and reads the same
`readTarget`, so it sees the post-H, pre-G window directly; that window is
`2·spacing = 400ms` long and the loop ticks every 200ms, so it is sampled
essentially every batch.

Reproducing `planBatch` exactly (same sweep, same `margin`, `share/4` cap at the
live 35,940GB fleet over 3 targets):

| level | target | plan `f` | plan `h` | money after H | H's security bump | trips |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| any | `n00dles` | **54.4%** | 132 | **45.6% of max** | +0.264 | **`moneyTol` 0.6** |
| 50 | `neo-net` | 6.4% | 836 | 93.6% | **+1.672** | **`secTol` 1.0** |
| 100 | `phantasy` | 3.2% | 836 | 96.8% | **+1.672** | **`secTol` 1.0** |
| 100 | `iron-gym` | 4.1% | 1087 | 95.9% | **+2.174** | **`secTol` 1.0** |
| 400 | `netlink` | 6.3% | 1087 | 93.7% | **+2.174** | **`secTol` 1.0** |

The failure is a **permanent prep/drain oscillation**: prep to 100%, launch one
batch, H lands, the next tick declares desync, drain, wait, re-prep. One batch
per `weakenTime` forever, on a controller whose whole value is many batches per
`weakenTime`.

Not currently firing — the three live targets (`phantasy`, `max-hardware`,
`omega-net` at level 246) plan `f` of 3-12% and `h` of 20-224, comfortably
inside both tolerances, and the status file shows `drains: 0`. But `n00dles`
trips it at **every** level tested, and `n00dles` is exactly what a small fleet
should be batching in the opening — so this is a trap laid for the next run more
than a bug in this one. `h` scales with the RAM cap `share/4`, so the `secTol`
cases get worse as the fleet grows.

The fix needs no new constant, only the coupling: the tolerance for a target in
`batch` phase should be derived from the plan in flight —
`money ≥ maxMoney·(1 − plan.f) − slack` and `sec ≤ minSec + FORTIFY·plan.h + slack`
— since those are precisely the excursions the controller itself commissioned.
A tolerance that does not know what the pipeline is doing cannot tell a desync
from a working batch.

### Bug 2 — `tryRoot` gates on hacking level

See §11. **Not a RAM trade**: `getServerRequiredHackingLevel` is already paid for
by the retarget block at line 433, so deleting line 107 costs nothing and is
worth 688GB at the next $5m the player spends. Highest-value one-line change in
the repo.

### Smaller notes, none urgent

- **`getWeakenEffect` core bonus is not modelled.** Real weaken is
  `0.05·threads·(1 + (cores−1)/16)·ServerWeakenRate` (`ServerHelpers.ts:320-323`)
  and `calculateServerGrowthLog` carries the same `coreBonus`
  (`grow.ts:26-28`). `batch.js` assumes 1 core everywhere. Home is 1 core today
  (`.telemetry/state.json`), so it is latent; when home cores rise, weaken and
  grow launched from home over-deliver, which is the **safe** direction (excess
  weaken clamps at the floor, excess grow caps at `moneyMax`). Worth a comment
  saying so rather than a fix.
- **`growThreads` drops the game's post-Newton correction.**
  `numCycleForGrowthCorrected` does not simply `ceil(x)`; it has three
  correction branches for rounding (`ServerHelpers.ts:178-200`). `batch.js`
  returns `Math.ceil(x)`. The error is at most one thread and `margin: 1.1`
  swamps it — but **this one costs no RAM to fix**, since it is pure arithmetic
  with no NS call, so under the CLAUDE.md rule there is no excuse for the
  divergence. (The added `guard++ < 64` is an improvement on the source, which
  has an unbounded `do/while`; keep it.)
- **`period` is computed from `totalRam`, not free RAM.** `share = totalRam /
  targets.length` counts RAM occupied by the controller, `tel.js` and spill, so
  `maxInFlight` is optimistic and the launch rate overshoots what `place()` can
  satisfy. The design absorbs this (a skipped launch is free, `placeFails`
  counts it), but the counter will read high for a reason that is not a fault.
- `ops.some(o => o.pad < 0)` is dead: `hack` pad is `3T`, `grow` pad is
  `0.8T + 2·spacing`, both always positive. Harmless.

## 14. `tel.js` — `incomePerSec` is structurally zero under `batch.js`, and this is not a sampling artefact

`tel.js:66` reports `ns.getTotalScriptIncome()[0]`. From
`src/NetscriptFunctions.ts:1240-1252`:

```ts
getTotalScriptIncome: () => {
  let total = 0;
  for (const script of workerScripts.values())          // LIVE scripts only
    total += script.scriptRef.onlineMoneyMade / script.scriptRef.onlineRunningTime;
  ...
  return [total, incomeFromScriptsSinceLastAug];
}
```

Element `[0]` sums over **currently running** worker scripts. `batch.js`
dispatches one-shot `h.js`/`g.js`/`w.js` with `temporary: true`; each accrues
`onlineMoneyMade = 0` for its entire flight and only credits itself in the
microtask between its landing and its exit. So at any sampled instant every live
worker contributes `0 / T`, and **`[0]` reads 0 no matter how much the fleet is
earning.** Under the retired `early.js` — one long-lived looping worker per host
— the same script accumulated over its whole life and `[0]` was meaningful. The
metric did not break; the worker lifecycle changed underneath it.

Confirmed live: `.telemetry/status.txt` at 00:18:41Z reports `incomePerSec: 0`
with `hackingLevel: 246`, `expPerSec: 349.2` and 41,763 threads dispatched.

This has two consequences beyond the display.

1. **`docs/optimizer-log.md` §11 — "the $0 income alarm was a sampling
   artefact, income is lumpy not zero" — is half right.** Income *is* lumpy
   (§0 of this log). But with `batch.js` live the alarm will now read exactly
   zero permanently, for a second and completely different reason, and the §11
   diagnosis will make it look explained when it is not.
2. **My predecessor's §6e recommendation is wrong for the shipped design.** It
   proposed `ns.getTotalScriptIncome()[0] / totalFleetRamGb` as the achieved
   rate `buyserv.js` should price RAM against. Under `batch.js` that expression
   is identically 0 and `evBuyRam` would refuse every purchase forever.

**The correct measurements**, in preference order:
`ns.getTotalScriptIncome()[1]` (`scriptProdSinceLastAug / playtimeSinceLastAug`
— cumulative, lifecycle-independent, but averaged over the whole run so it lags
badly); or `batch.js`'s own `totals.earned` / `uptimeSec` in `/tel/batch.txt`,
which is attribution by watching the target's money fall and is the only
*current* rate anything in the repo actually knows.

## 15. Other root scripts

| file | finding |
| --- | --- |
| `h.js` / `g.js` / `w.js` | **Correct and correctly justified.** `additionalMsec` rather than sleep-then-act; no guards, which is the documented RAM trade (one sensing call in a 400-thread worker is 40GB). Nothing to change. |
| `early.js` | Formula-free; its two constants are empirical, and §10 shows both are now unmeasured or inverted. Retired. |
| `buyserv.js` | Prices verified: BruteSSH $500e3, FTPCrack $1500e3 (`src/DarkWeb/DarkWebItems.ts:6-7`). The linear-cost argument is verified: `getCloudServerCost` is `ram · 55000 · CloudServerCost · CloudServerSoftcap^max(0,log2(ram)−6)` (`src/Server/ServerPurchases.ts:22-41`) and BN1 leaves `CloudServerSoftcap = 1` (`src/BitNode/BitNodeMultipliers.ts:134`), so the "no volume discount, never wait" conclusion holds exactly. **But the comment at lines 43-45 — "relaySMTP ($5m) and beyond are deliberately absent: the servers behind them need hacking level 300+, so reserving for one this early would idle cash for an hour to buy RAM that cannot be rooted" — is false**, per §11. Those servers can be rooted at any level; only hacking them needs 308. It is 688GB for $5m. |
| `watchdog.js` | Sound. The "always `scp` before relaunch" note is a real hazard correctly handled. No numeric constants to verify. |
| `tel.js` | See §14. Otherwise sound. |
| `cmd.js`, `ctscan.js`, `ctsolve.js`, `ctsolvers.js`, `killall.js` | No game constants — `ctsolve.js` takes the reward from `ns.codingcontract.attempt(..., {returnReward:true})` rather than computing it, which is the right design. |
| `contract.js` (never run) | `contract_base_money_gain = 4000` against the real **`CONSTANTS.CodingContractBaseMoneyGain = 75e6`** (`src/Constants.ts:93`) — **18,750x low**, and it also predates `adjustedScaling = rewardScaling / 3` (`PlayerObjectGeneralMethods.ts:511`). Its sibling constants *are* right: `contract_base_faction_rep_gain = 2500` matches `CodingContractBaseFactionRepGain` (`:91`) and `contract_base_company_rep_gain = 4000` matches `CodingContractBaseCompanyRepGain` (`:92`) — which is how the wrong one hid for so long. |
| `stock.js` (never run) | `commission = 100000` ✓ `StockMarketCommission: 100e3`, `src/StockMarket/data/Constants.ts:11`. |
| `hacknet.js` (never run) | `hashesToMoneyConversion = 1e6·hashes/4` ✓ — `SellForMoney` is `cost: 4, value: 1e6` (`src/Hacknet/data/HashUpgradesMetadata.tsx:9-23`). `serverHashCapacity = 32·2^cache` ✓ `HacknetServer.ts:123`. |
| `pserv.js` (never run) | `gbRamCost: 55000` ✓, `maxPlayerServers: 25` ✓ `CloudServerLimit`, `maxGbRam: 1048576` ✓ `CloudServerMaxRam = 2^20`. |
| `spider.js` (never run) | §11 rooting gate. |
| `hack.js` (never run) | Roots on ports alone — **correct**, and the only script that is. Thread RAM constants 1.7/1.75 match `h.js`/`g.js`/`w.js`. |
| `contract.js`, `pserv.js`, `hack.js`, `find.js`, `common.js`, `killhack.js` | All read/write raw `localStorage`. Not charged RAM (only `document` and `window` are, `src/Script/RamCalculations.ts:185-191`) and it does work, but it is out-of-band state nothing in `tools/` can see. Worth knowing before trusting a `BB_SERVER_MAP` any of them wrote. |


## 16. The rest of `tools/sim/` — audit

### `world.mjs` (mine) — what a snapshot omits, now that I have checked the save

Decoded the live save directly to see what is there rather than what
`SERVER_FIELDS` takes. Fixed in this pass:

- **`player.mults` was never captured, and `engine.mjs` hardcoded every
  multiplier to 1.** Six different game formulas read a different one of them —
  `hacking_chance` in `calculateHackingChance`, `hacking_speed` in
  `calculateHackingTime`, `hacking_money` in `calculatePercentMoneyHacked`,
  `hacking_grow` in `calculateServerGrowthLog`, `hacking_exp` in
  `calculateHackingExpGain`, `hacking` in `Person.updateSkillLevels`. All are
  1 today (verified in the save), so nothing is wrong *yet* — and that is
  exactly the condition under which this becomes an expensive surprise on the
  first augmentation install, which `docs/roadmap.md` is driving towards.
  `snapshotFromSave` now carries them and the engine merges them over the
  defaults.
- **`player.skills.intelligence` was hardcoded to 0.**
  `calculateIntelligenceBonus(int, 1)` divides hacking time and multiplies hack
  chance (`src/Hacking.ts:21, 76`). It is 0 in this save and stays 0 without
  SF5, but it is now read rather than assumed.
- **The skill multiplier also carries a BitNode factor.**
  `Person.updateSkillLevels` uses `mults.hacking * HackingLevelMultiplier`
  (`src/PersonObjects/Person.ts:221-224`); the engine passed no mult at all.
  Now `sim.skillMult`.
- `openPortCount` and `backdoorInstalled` are now captured. The engine
  re-derives open ports from owned programs, which is exact from a fresh start
  and an approximation from `--live`; carrying the real count lets a caller see
  the difference rather than assume it away.

Still absent, deliberately, with reasons:

- **`ramUsed` is not in the save at all** — verified, the field is `undefined`
  on every server record. So `usedRam: 0` is the only thing the engine can do,
  and a `--live` run necessarily answers *"what if the fleet were emptied and
  restarted"*, not *"what should it do next"*. Right now the live fleet is at
  **99.9% utilisation** (`/tel/batch.txt`), so that is not a small difference in
  framing. `tel.js` does report per-host `usedRam`; a snapshot that merged
  `/tel/status.txt` over the save would close this.
- **BitNode multipliers are never applied from the snapshot.** `world.mjs`
  captures `bitNode` and nothing consumes it; `currentNodeMults` stays at the
  module defaults, which I verified are exactly the BN1 values
  (`ScriptHackMoney`, `ServerGrowthRate`, `ServerWeakenRate`, `HackExpGain`,
  `CloudServerSoftcap` all 1; only `DaedalusAugsRequirement` and
  `StaneksGiftExtraSize` differ, neither of which any formula here touches). So
  it is right today by coincidence. `replaceCurrentNodeMults` is exported from
  `src/BitNode/BitNodeMultipliers.ts:190` and is **not** in `build.mjs`'s
  `ENTRY` — adding it there and calling it from the snapshot is the one-line
  fix. `build.mjs` is not mine.
- Hacknet nodes/servers: present in the save, not modelled anywhere.

### `engine.mjs` (mine) — the physics is faithful; the hack/grow/weaken handlers check out line by line

`applyOp` was diffed against `NetscriptHelpers.tsx hack()` (`:615-690`),
`NetscriptFunctions.ts grow` (`:262-306`) and `weaken` (`:334-374`), plus
`processSingleServerGrowth` (`ServerHelpers.ts:204-224`). Every branch matches,
including the three that are easy to get wrong and that the engine already had
right:

- exp is computed **before** the server is mutated and multiplied by threads,
  and demoted to a quarter both on failure *and* when `moneyDrained === 0`
  (`NetscriptHelpers.tsx:638-640`);
- hack's security bump is `FORTIFY · min(threads, ceil(1/φ))`, so
  over-subscription adds no extra security;
- grow's bump is `2·FORTIFY·usedCycles` with `usedCycles` recomputed by
  `numCycleForGrowthCorrected` and capped at `threads` — the engine passes its
  own `player` where the game defaults to the global `Player`, which is more
  correct, not less.

`capDifficulty` matches `Server.capDifficulty` (`Server.ts:92-104`). Thread RAM
1.7/1.75/1.75 matches `h.js`/`g.js`/`w.js`. Grow/weaken time multipliers 3.2/4
match `src/Hacking.ts:83-94`.

### Scoring honesty — the metric is right, the window and one column are not

- **`earned` (= `stats.moneyStolen`, cumulative) is the correct thing to sort
  by** and `run.mjs` does. No complaint.
- **`$/s end` is broken on the corrected world.** `tailRate` differences the
  `earned` curve over its last tenth. Income is now a step function, so a
  strategy that banked $1.27b reports `$0/s` if no step happened to fall in the
  last 18 minutes — which is literally what `rank by live @ 1024GB` does in
  §10's 180-minute table. The column is not noisy, it is *systematically*
  reporting zero for exactly the strategies with the longest cycles. Either
  delete it or replace it with `earned / minutes` over the second half.
- **`netWorth = money + ramSpend + programSpend`** treats every dollar spent as
  still held at cost. Cloud servers cannot be sold, so this is not net worth; it
  is gross outlay plus cash. Not the default sort, so low priority, but it will
  mislead anyone who sorts by it.
- **`util` reads 97-99% for every arm**, because `early.js` workers hold their
  RAM whether or not the op is useful. It is a measure of allocation, not of
  work, and cannot distinguish a saturated fleet from a stalled one.
- **Medians over 7-9 seeds are the right method but no longer a summary.** With
  a step function the per-seed distribution is multimodal (did the third drain
  land inside the window?), and a median of 7 draws from a bimodal distribution
  is not a central tendency. The 60-minute §6 table flipping its top two arms
  and then flipping back at 180 minutes is this effect, not noise in the usual
  sense. **The window has to be long compared with `prepSeconds + weakenTime`
  of the slowest target the arm might pick**, which on a 1TB fleet is tens of
  minutes.

### `strategies.mjs` / `batcher.mjs` (the optimizer's) — constants sourced

Spot-checked: both import their formulas from `game.mjs`
(`calculateHackingTime`, `calculatePercentMoneyHacked`,
`calculateServerGrowthLog`, `numCycleForGrowthCorrected`, `getWeakenEffect`),
and `batcher.mjs` takes `FORTIFY` from `ServerConstants.ServerFortifyAmount` and
`WEAKEN_1` from `getWeakenEffect(1, 1)` rather than typing 0.002/0.05. That is
the rule being followed. The only bare numbers are `1.98` and `6.16` in the
ranking index, which are the loaded RAM-second costs derived in §5 of this log
and are a *ranking* weight rather than a physical constant — but `ev.mjs`
already produces them from `(server, player, cores)`, so the honest move is for
the index to call that instead of transcribing.

`atTotalRam` (`strategies.mjs:567-579`) deletes the save's purchased servers,
which was a local patch for the `freshStart` bug fixed in §12. It is now
redundant for `freshStart` worlds but still needed for `--live`; harmless
either way.

## 17. A bug I introduced and caught, worth recording because of how it surfaced

Correcting `Sim.nuke()` in §11 broke the backtest, and the way it broke is the
lesson.

**First failure — the replica must keep the program's bugs.** With `nuke()`
fixed, the burst-window reconstruction rooted more servers than the real run
had, the fleet went 220GB → 268GB and the error went from +40% to +224%. That
is correct engine behaviour and wrong backtest behaviour: the *game* does not
gate rooting on level, but `auto.js` did, and the backtest's job is to replay
`auto.js`. Fixed by adding `autoJsRoot()` to `supervisor.mjs` — a deliberate
transcription of `auto.js:59`, commented as such — and using it in both the
supervisor's poll and `backtest.mjs`'s `rootedAtStart`. **When a primitive is
corrected, every replica of a program that relied on the incorrect behaviour has
to re-impose it locally.**

**Second failure — inverting a comparison changes what `undefined` does.** The
old test was `if (s.requiredHackingSkill <= this.hacking) { root }`; I wrote
`if (s.requiredHackingSkill > this.hacking) continue;`. For `darkweb` both
fields are `undefined`, and `undefined <= 89` is `false` while `undefined > 89`
is *also* `false` — so the server that the old code excluded by accident, the
new code included by accident. That handed every reconstruction a 13th "server"
worth 16GB (rooted 12 → 13, fleet 220 → 236GB) and moved the burst error from
+40% to +224% a second time, for a completely different reason.

`darkweb` is a `DarknetServer`, not a `Server` (`src/Server/DarknetServer.ts`);
it has no `numOpenPortsRequired`, no `requiredHackingSkill` and no
`hackDifficulty`, and `ns.nuke`/`ns.hack`/`ns.grow`/`ns.weaken` all route
through `getNormalServer` (`NetscriptHelpers.tsx:575-578`), which rejects it.
Both `nuke()` and `autoJsRoot()` now skip anything whose
`numOpenPortsRequired` is not a number, on purpose rather than by accident.

**The backtest is the regression test that caught both**, within one run each
time, because it compares against a recorded rooted count and a recorded fleet
size as well as against money. Post-fix it reproduces Part I to the cent:
burst `$6.01m` against `$4.30m` actual, **+40%**, rooted 12, fleet 220GB, level
+83 against +83. That invariant — *engine corrections must not move the
backtest* — is the thing to keep.

**Still open, not changed because I am not certain:** `darkweb` is
`hasAdminRights: true` with `maxRam: 16` in the save, so a `--live` run counts
16GB of it as fleet through `hosts()`. `DarknetServer` extends `BaseServer` and
carries `cpuCores` with a comment saying it exists "to make sure that grow etc
on the server work as expected", so it may genuinely be script-hostable. This
predates my changes and I have not guessed at it; someone should check whether
`ns.exec` on `darkweb` succeeds in the running game before anyone relies on
that 16GB either way.

## 18. Ranked list of what still needs fixing, in files I do not own

Ordered by expected value, with the owner named.

| # | file | change | why now |
| --- | --- | --- | --- |
| **1** | `batch.js` (game-player) | delete the hacking-level test in `tryRoot` (line 107) | One line. Frees **688GB for the $5m `relaySMTP.exe`** the player can already afford ten times over — RAM at $7.3k/GB against the cloud's $55k/GB. `getServerRequiredHackingLevel` is already paid for at line 433, so the change costs nothing. §11. |
| **2** | `buyserv.js` (game-player) | reinstate `relaySMTP.exe` ($5m) and `HTTPWorm.exe` ($30m) in `SETTINGS.programs`, and correct the comment at lines 43-45 | Depends on #1. The comment's premise — "the servers behind them need hacking level 300+" — is true of *hacking* them and false of *rooting* them, which is what buys RAM. §11, §15. |
| **3** | `batch.js` (game-player) | couple `secTol` / `moneyTol` to the plan in flight instead of fixed 1.0 / 0.6 | Latent but total: on `n00dles` the plan takes 54.4% of the money and the 0.6 tolerance declares desync on the batcher's own correct behaviour, giving one batch per `weakenTime` forever. Four more targets trip `secTol` on H's own fortification. Needs no new constant — the excursion is `plan.f` and `FORTIFY·plan.h`, both already computed. §13. |
| **4** | `tel.js` (game-player) | report `ns.getTotalScriptIncome()[1]`, or `/tel/batch.txt`'s `earned/uptimeSec`, not `[0]` | `[0]` sums over *live* worker scripts, and `batch.js`'s one-shot workers credit themselves only in the instant before they exit, so it reads **exactly 0 whatever the fleet earns**. Confirmed live at level 246 with 41,763 threads dispatched. It is the number everyone looks at first. §14. |
| **5** | `tools/sim/run.mjs` (optimizer) | measurement windows of ≥3 hours at ≥1TB, and fix or delete the `$/s end` column | On the corrected world a 60-minute total at 1TB measures where the window edge falls relative to one prep-and-drain cycle, not rate — it flipped §6's top two arms and 180 minutes flipped them back. `$/s end` reports `$0` for a strategy that banked $1.27b. §10, §16. |
| **6** | `docs/optimizer-log.md` (optimizer) | mark §3, §5, §6, §7 absolute figures as superseded; re-derive §5's security slack | Every number there was taken on the 25x-rich world, and §5's slack sweep now measures $0 at every value, so that conclusion has no support at all. The *rankings* mostly survive — see the table in §10. |
| **7** | `tools/sim/build.mjs` (optimizer) | export `replaceCurrentNodeMults` and apply `snapshot.bitNode` | The sim is using BN1 multipliers because the module defaults happen to be BN1, not because anything read the save. `world.mjs` already captures `bitNode` and nothing consumes it. Free correctness before the first BitNode change. §16. |
| **8** | `batch.js` (game-player) | port `numCycleForGrowthCorrected`'s three post-Newton correction branches | Costs **zero RAM** — pure arithmetic, no NS call — so under the CLAUDE.md rule there is no licence for the divergence. Practical effect is ±1 thread, swamped by `margin: 1.1`. §13. |
| **9** | `batch.js` (game-player) | comment that `getWeakenEffect`/`calculateServerGrowthLog` carry a `coreBonus` of `1 + (cores−1)/16` that the inlined versions assume is 1 | Latent: home is 1 core today. The error direction is safe (over-provision), which is exactly why it needs saying rather than fixing. §13. |
| **10** | `auto.js`, `spider.js` (game-player) | same rooting fix as #1, or delete the scripts | `auto.js` is retired but `watchdog.js` can still bring it back; `spider.js` has never run. §11. |
| **11** | `contract.js` (game-player) | `contract_base_money_gain` 4000 → `75e6`, and add `adjustedScaling = rewardScaling/3` | Never run, so no live cost, but it is the canonical example in CLAUDE.md and it is still wrong in the file. §15. |
| **12** | `tools/sim/strategies.mjs`, `batcher.mjs` (optimizer) | have the ranking index call `ev.loadedHackRamSeconds` / `loadedGrowRamSeconds` instead of the literals `1.98` / `6.16` | They are correct at `cores = 1` with no augs and wrong otherwise; `ev.mjs` already derives them from `(server, player, cores)`. §16. |

### Things I checked and found correct, so nobody re-checks them

`h.js`/`g.js`/`w.js` (all three, including the no-guards RAM trade);
`watchdog.js`; `buyserv.js`'s cloud-cost linearity argument and both program
prices; `batch.js`'s four `ServerConstants`, its `hackFraction`, `hackChance`,
`growthK`, its min-security rescaling of `ns.getHackTime`, its single-burst
`additionalMsec` launch, and its hack/grow security arithmetic; `stock.js`'s
commission; `hacknet.js`'s hash-to-money rate and cache capacity; `pserv.js`'s
three cloud constants; `hack.js`'s rooting rule (the only script that has it
right); `engine.mjs`'s `applyOp` against all three Netscript handlers;
`strategies.mjs` and `batcher.mjs` sourcing their formulas from `game.mjs`.

## 19. Reproducing Part II

```bash
# §9 / §17 — the backtest, which must still report burst +40%, rooted 12, 220GB
node tools/sim/fidelity/backtest.mjs --seeds 5

# §10 — the optimizer's §6 index sweep, re-run. 60 minutes is the published
# window and is the one that gives the wrong answer at 1TB; 180 is honest.
node tools/sim/run.mjs --only ix0-live,ix0-batch,ix0-batchChance --minutes 180 --seeds 9
node tools/sim/run.mjs --only ix1024-live,ix1024-batch,ix1024-batchChance --minutes 180 --seeds 9
node tools/sim/run.mjs --only ix8192-live,ix8192-batch,ix8192-batchChance --minutes 120 --seeds 7

# §10 — the §5 money-floor sweep, re-run
node tools/sim/run.mjs --only th0-money1,th0-money5,th0-money10,th0-money25,th0-money50,th0-money75,th0-money90,th0-money99 --minutes 60 --seeds 7
node tools/sim/run.mjs --only th1024-money1,th1024-money5,th1024-money10,th1024-money25,th1024-money50,th1024-money75,th1024-money90,th1024-money99 --minutes 60 --seeds 7

# §10 — the security-slack sweep, which now measures $0 at every value
node tools/sim/run.mjs --only th-sec0,th-sec1,th-sec2,th-sec3,th-sec5,th-sec10,th-sec20 --minutes 60 --seeds 7

# §11 — how much RAM the hacking-level rooting gate withholds
node -e 'const s=JSON.parse(require("fs").readFileSync("tools/sim/snapshot.json","utf8"));
  for (const ports of [0,1,2]) { const r=s.servers.filter(x=>!x.purchasedByPlayer && x.numOpenPortsRequired<=ports);
    for (const lvl of [1,50,100,200]) console.log(`ports<=${ports} lvl=${lvl}:`,
      r.reduce((a,x)=>a+x.maxRam,0), "GB in game,",
      r.filter(x=>x.requiredHackingSkill<=lvl).reduce((a,x)=>a+x.maxRam,0), "GB under the gate"); }'

# §11 — what relaySMTP.exe is actually worth right now
node -e 'const t=JSON.parse(require("fs").readFileSync(".telemetry/status.txt","utf8"));
  const s=JSON.parse(require("fs").readFileSync("tools/sim/snapshot.json","utf8"));
  const rooted=new Set(t.servers.map(x=>x.host)); const g={};
  for(const x of s.servers){ if(x.purchasedByPlayer||rooted.has(x.hostname))continue; (g[x.numOpenPortsRequired]??=[]).push(x); }
  for(const p of Object.keys(g).sort()) console.log(`ports=${p}:`, g[p].reduce((a,x)=>a+x.maxRam,0), "GB idle");'

# §13 — batch.js planBatch reproduced, to see which targets trip secTol/moneyTol
#   (the script is in the scratchpad note; it re-implements planBatch verbatim
#    and prints plan.f and FORTIFY*plan.h per target per level)

# §14 — the income metric, live
grep -m1 incomePerSec .telemetry/status.txt   # 0, at level 246 and 41,763 threads
grep -m1 threadsDispatched .telemetry/batch.txt
```

### Invariants to keep

1. **Engine corrections must not move the backtest.** The backtest replays
   `auto.js` as it was; if fixing a `Sim` primitive changes the burst window's
   $6.01m / rooted 12 / 220GB, the replica in `supervisor.mjs` needs the old
   behaviour re-imposed locally, not the fix reverted. §17.
2. **Do not compare strategies over a window shorter than one prep-and-drain
   cycle.** At 1TB that is tens of minutes and the answer inverts. §10.
3. **`freshStart()` must produce a world that can actually occur**: 4% money,
   3x min security, no cloud servers, no darkweb, no programs. §12.
