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

| # | mechanism | in engine.mjs before | status |
| --- | --- | --- | --- |
| M1 | kill-in-flight discards the op entirely | absent | |
| M2 | per-host (not per-thread) op granularity | n/a to engine | |
| M3 | `scp` + `exec` + 20s supervisor poll latency | instant & free | |
| M4 | `ns.exec` returns 0 silently when RAM short | engine returns false, caller may ignore | |
| M5 | security elevation inflates duration of ops launched during it | *already correct* | |
| M6 | level-up shortens ops launched after it | *already correct* | |
| M7 | oversubscription → negative marginal return | absent | |
| M8 | restart cost = one full prep cycle | absent | |

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
