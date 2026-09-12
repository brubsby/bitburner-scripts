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
