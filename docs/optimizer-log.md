# Optimizer log

> **Superseded figures — read this first.** Sections 1-10 were measured on a
> world the simulator got wrong. `docs/fidelity-log.md` re-ran them against the
> corrected world: the *rankings* mostly survive, but **every absolute dollar
> figure in sections 3, 5, 6 and 7 is void**, section 5's "50% money floor is
> near-best" is falsified (it earns $0 at 108GB), and section 5's security-slack
> sweep now measures $0 at every value, so that conclusion has no support at
> all. Sections 1-2 (prices, methodology) and the mechanism explanations stand.
>
> Separately, **no comparison in sections 1-13 used a long enough window.**
> Above ~1TB income is a step function with a cycle of tens of minutes, so a
> 60-minute total measures where the window edge fell, not a rate — fidelity
> section 10 found two arms that rank one way at 60 minutes and the other way at
> 180. `run.mjs` now warns below 180 minutes and reports the rate over the
> second half of the run rather than the closing tenth. Section 17 is the first
> measurement taken under the corrected rules.

Findings from `tools/sim/`, appended as they land. Every number is a median
over seeds unless it says otherwise. The formulas come from the game's own
source via `tools/sim/game.mjs`, not from memory.

---

## Baseline (carried over from the previous run)

60 sim-minutes, fresh BN1, median of 5 seeds, **no infrastructure spending** —
every one of these tops out at the 108GB you get from home 8GB plus the eight
zero-port servers:

```
early.js — retargeting            $62.38m  lvl 112
early.js on foodnstuff            $33.06m  lvl 114
early.js on n00dles               $22.37m  lvl 116
prepped hack — retargeting        $20.69m  lvl 106
prepped hack on foodnstuff (50%)  $13.46m  lvl 108
prepped hack on n00dles (50%)      $7.54m  lvl  96
```

Retargeting as the level rises is worth ~3x over pinning to one server.

---

## 1. Cost of RAM — the three channels, priced from the source

`getCloudServerCost`, `getUpgradeHomeRamCost`, `CONSTANTS.TorRouterCost` and
`DarkWebItems`, read out of the bundled game (`scratchpad/probe2.mjs`):

| Channel | Price | $/GB |
| --- | --- | --- |
| Cloud server, any size | 8GB = $440k, 1024GB = $56.3m | **flat $55,000/GB** |
| Home 8→16GB | $1.010m | $126,218 |
| Home 16→32GB | $3.191m | $199,424 |
| Home 32→64GB | $10.08m | $315,091 |
| Home 64→128GB | $31.86m | $497,843 |
| Home 128→256GB | $100.7m | $786,592 |

Cloud limit 25 servers, max 1,048,576GB each.

Darkweb: TOR $200k, then BruteSSH $500k, FTPCrack $1.5m, relaySMTP $5m,
HTTPWorm $30m, SQLInject $250m.

**Conclusion (cost side, before any simulation):** home RAM is never
competitive with cloud servers on $/GB — it starts 2.3x worse and the
multiplier is 1.58^log2(ram), so the gap only widens. Home RAM is worth buying
for what it *enables* (hack.js needs 11.2GB resident; home cores boost
grow/weaken) and not as a way to buy threads. The 8→16GB jump is the only one
with a real qualitative payoff.

Port programs are a different shape entirely: a fixed fee that unlocks whole
servers at once. TOR+BruteSSH is $700k; whether that is cheap depends on how
much RAM sits behind one port, which the next section measures.

---

## 2. The baseline was measuring the wrong thing

The table at the top ranks strategies by **cash in hand at minute 60**. That
metric punishes every strategy that spends, which is exactly the class of
strategy the infrastructure question is about. A run that converts $500m into
9TB of RAM scores $5m and looks like a disaster.

`run.mjs` now reports, per strategy:

- **earned** — cumulative `moneyStolen`, unaffected by reinvestment. The score.
- **cash** — money in hand at the end (the old metric, kept for reference).
- **$/s end** — income rate over the final tenth of the run: where the strategy
  has *got to*, rather than what it banked getting there.

`--sort earned|money|netWorth|rate` picks the ordering. `engine.mjs`'s curve
samples now carry `earned` alongside `money`.

## 3. Infrastructure policy — the result

60 sim-minutes, fresh BN1, median of 5 seeds. Every row runs the *same*
hacking policy (`auto-early`, retargeting `early.js`); only the spending
differs.

```
strategy                              earned      cash   $/s end  hack     ram     spent
------------------------------------------------------------------------------------------
programs + cloud servers              $2.95b   $16.12m    $2.99m   236   53652    $2.93b
programs + cloud + home (ranked)      $2.61b   $43.72m    $1.78m   235   46604    $2.58b
cloud + home, no programs           $583.01m    $5.52m   $236.1k   246   10404  $577.48m
greedy cloud servers only           $516.23m    $5.65m   $148.9k   245    9324  $506.88m
buyserv.js, no reserve              $151.30m    $1.37m        $0   211    2804  $148.28m
LIVE: buyserv.js ($2m reserve)      $150.48m    $2.65m        $0   210    2796  $147.84m
port programs only                  $101.23m   $94.03m    $32.0k   138     276        $0
early.js — retargeting               $62.38m   $62.38m    $12.3k   112     108        $0
```

Read bottom-up, this is three separate multipliers stacking:

1. **Spending anything at all beats hoarding: 2.4x.** `buyserv.js` as it runs
   live turns $62m of earnings into $150m.
2. **Spending it promptly beats spending it carefully: 3.4x.** Same channel,
   same money — $150m becomes $516m purely by dropping the $2m reserve, the
   120-second interval and the 8GB floor, and buying until the money is gone.
3. **Port programs on top: 5.7x.** $516m becomes $2.95b.

Total, versus what runs live today: **~20x** over 60 minutes.

Why the reserve and the interval cost so much is not subtle. Cloud RAM is
priced at a flat $55,000/GB with **no volume discount** (`getCloudServerCost`
is linear in BN1: the softcap exponent `max(0, log2(ram) - 6)` is raised to
`CloudServerSoftcap`, which is 1). `getCloudServerUpgradeCost` is exactly the
difference between the two sizes. So:

- Buying a 16GB server now and upgrading it to 32GB later costs precisely the
  same total as buying a 32GB server later. **Waiting to afford a bigger
  server is never cheaper — it only delays the income.**
- The largest-affordable-power-of-two rule then strands change: with $3m in
  hand it buys 32GB for $1.76m and leaves $1.24m idle until the next wake-up.
  Buying 32 + 16 + 4GB spends it all for the same price per GB.
- A 120-second interval leaves each purchase's income on the table for up to
  two minutes, every cycle, compounding.

**Home RAM is a drag, not a help.** `infra-all` ranks home against the other
channels by $/GB and buys it when it wins, and it finishes *below* the
programs+cloud run ($2.61b vs $2.95b). That matches the price table in §1 —
home starts at 2.3x the cloud price and worsens. Buy home RAM for what it
*enables* (hack.js is 11.2GB resident; home cores multiply grow/weaken), not
for threads.

### Caveat on the absolute numbers

These runs compound: earnings buy RAM, RAM buys earnings. Small modelling
errors therefore amplify, and $2.95b in the first hour of a fresh BN1 is far
more than a human gets. Treat the **ordering and the ratios** as the result,
not the dollar figures. Where a comparison could be contaminated by
compounding, §4 pins the RAM instead.

---

## 4. One target or many — the crossover is real, and it is a long way off

`auto.js` points every rooted thread at the single best target. The worry was
that a target's money is finite, so past some thread count the extra threads
land on an empty server.

Measured with **RAM pinned** (`atFixedRam`, which grants a free fleet and
forbids buying), 60 minutes, median of 5 seeds, `--ports 2` so the target list
is realistic. "1 uncapped" is exactly what `auto.js` does today: one op per
host, every free thread, one target.

| total RAM | 1 uncapped (live) | 1 demand-capped | flow 2 | split 2 | split 3 | best vs live |
| ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| 276GB | **$101m** | $94.5m | $94.5m | $90.6m | $90.6m | live wins |
| 1,364GB | **$652m** | $433m | $438m | $489m | $484m | live wins |
| 2,452GB | **$658m** | $477m | $557m | $549m | $593m | live wins |
| 4,500GB | $1.26b | $1.74b | $1.99b | $2.27b | **$2.32b** | **+84%** |
| 8,596GB | $1.17b | $4.17b | $4.34b | $4.34b | **$4.58b** | **+291%** |
| 16,788GB | $1.82b | $5.57b | $5.63b | $7.44b | **$7.76b** | **+326%** |
| 65,940GB | $2.40b | $11.87b | $9.61b | **$13.97b** | $11.11b | **+482%** |

**The crossover is between ~2.5TB and ~4.5TB of total RAM.** Below it,
single-target uncapped is genuinely the best policy and everything else loses.
Above it, it falls off a cliff — at 8.6TB it earns a *quarter* of what
splitting three ways earns.

The live game currently has **108GB**. The crossover is 25-40x away, so
**`auto.js`'s single-target rule is correct for now** and should not be
changed yet. It is the thing that will have to change first once `buyserv.js`
is allowed to spend properly (§3 gets the fleet past 2.5TB inside an hour).

### Why it fails, and why it is not "wasted threads"

The obvious explanation — surplus threads hit an empty server and return
nothing — is wrong, and the game source says so:

- `NetscriptFunctions.ts` `grow` and `weaken` award
  `calculateHackingExpGain(server) * threads` unconditionally. Overkill grow
  and weaken threads still earn *full* exp.
- `NetscriptHelpers.tsx` hack awards full exp too, and only quarters it when
  `moneyDrained === 0` — i.e. when the server was already at zero, not merely
  when the threads overshot. Security fortification *is* capped
  (`Math.min(threads, maxThreadNeeded)`), so overkill is not even punished
  with extra security.

So surplus threads are an exp pump, which is why single-target uncapped wins
at small RAM: at 276GB the binding constraint is hacking level, not thread
count, and dumping everything into one op buys levels.

RAM utilisation is **100% in every arm** (the engine now tracks time-weighted
occupancy), so the difference is not idle capacity. It is *what the threads are
doing*. One fleet-wide op per phase serialises the whole fleet on the slowest
phase — weaken is 4x hack time and grow 3.2x — so as RAM grows, an ever larger
share of thread-seconds is spent on the two ops that earn no money and a
quarter to a third of the exp rate. Demand-sized ops stagger, so different
slices of the fleet sit in different phases at once; splitting across targets
adds more phase diversity still. At 8.6TB that is worth 4x.

This is the same disease HWGW batching cures, which is §5.

---

## 5. Optimal hack fraction — the prior-art prediction holds where it applies

`early.js` grows until money is above **75%** of max, then hacks with every
thread it has, draining the server. So its money floor *is* the fraction of max
money taken per cycle: `f ≈ moneyFloor`.

`docs/prior-art.md` §3 derives `m/R = M / (T·[1.98/φ + 6.16·(−ln(1−f)/f)/k])`
and predicts money-per-RAM-second is **strictly decreasing in f**, so the
optimum is the smallest `f` integrality allows. Swept at fixed RAM, 60 min,
median of 7 seeds:

| money floor | 108GB (live) | 1,364GB | 8,596GB |
| ---: | ---: | ---: | ---: |
| 1% | **$92.5m** | $657m | $1.17b |
| 5% | $91.7m | $708m | $1.17b |
| 10% | $90.8m | **$752m** | $1.17b |
| 25% | $88.1m | $697m | $1.17b |
| 50% | $79.1m | $652m | $1.17b |
| **75% (live)** | $62.4m | $652m | $1.17b |
| 90% | $49.8m | $685m | **$1.26b** |
| 99% | $43.6m | $649m | $1.26b |

**At 108GB the prediction is exactly right: monotone decreasing, smallest f
wins, and dropping 75% → 10% is worth +46%** ($62.4m → $90.8m) for a
one-constant change. Below ~10% it flattens, because growing off a fully
drained server is additive (`calculateGrowMoney` adds `threads` before
multiplying) and the last few percent cost nothing to give up.

At 1.4TB the ordering is noisy but 10% still leads. At 8.6TB it **inverts** —
but that is the saturated regime of §4, where a fleet-wide op serialises
everything and the model's steady-state assumption has already failed. The
derivation assumes a pipeline; `early.js` is not one.

The security threshold needs no change. Sweeping it at 108GB: `+5` (the live
value) is already the optimum — `+0` $46.6m, `+1` $57.6m, `+2` $60.3m, `+3`
$61.7m, **`+5` $62.4m**, `+10` $54.4m, `+20` $48.7m.

---

## 6. Target ranking — `auto.js`'s index is wrong, and the fix is worth +34%

`docs/prior-art.md` §5 claims `auto.js`'s `M·φ/T` counts hack threads and
ignores the cost of putting the money back, and so over-ranks rich,
slow-growing servers. **Confirmed, and the mechanism is visible.**

Four indices, same `early.js` behaviour, RAM pinned, 60 min:

| index | 108GB (live), 15 seeds | 1,364GB, 7 seeds | 8,596GB, 7 seeds |
| --- | ---: | ---: | ---: |
| `live` — `M·φ/T`, what `auto.js` runs | $62.4m | $652m | $1.17b |
| `liveChance` — the above × hack chance | $54.2m | $154m | $1.24b |
| `batch` — `M/(T·(1.98/φ + 6.16/k))` | $72.7m | $1.42b | $1.07b |
| **`batchChance` — `batch` × hack chance** | **$83.8m** | **$1.42b** | $1.12b |

**+34% at the RAM the live game has**, +118% at 1.4TB. Above the §4 saturation
point the ordering reverses, for the same reason the hack-fraction result does.

The mechanism, dumping each index's top four at a range of levels:

```
lvl  50   live: foodnstuff > sigma-cosmetics > joesguns > nectar-net
          batch: joesguns > harakiri-sushi > nectar-net > n00dles
lvl 110   live: sigma-cosmetics > foodnstuff > joesguns > nectar-net
          batch: harakiri-sushi > max-hardware > phantasy > joesguns
lvl 160   live: sigma-cosmetics > foodnstuff > phantasy > joesguns
          batch: phantasy > max-hardware > harakiri-sushi > zer0
```

`live` sits on **foodnstuff (serverGrowth 5)** and **sigma-cosmetics (growth
10)** for the whole early game — the two slowest-growing money servers on the
network. They are rich and cheap to unlock, so `M·φ/T` loves them, and they are
ruinous to keep topped up. `batch` moves to joesguns (20), harakiri-sushi (40),
phantasy (35).

Note that hack chance is **not** independently useful — `liveChance` is *worse*
than `live`. It only pays once the grow term is present. Combining them is
worth another +15% over `batch` alone.

Inlining both in `auto.js` costs one new NS call, `ns.getServerGrowth` (0.1GB).
From `src/Hacking.ts` and `src/Server/formulas/grow.ts`, evaluated at minimum
security with all player multipliers at 1 (no augs, BN1, so every
`currentNodeMults` factor is 1 and cancels or is unity):

```js
k      = min(log1p(0.03 / minSec), 0.00349388925425578) * (serverGrowth / 100)
skillM = max(1.75 * hackingLevel, 1)
chance = clamp(((skillM - required) / skillM) * ((100 - minSec) / 100), 0, 1)
score  = chance * maxMoney / (hackTimeSec * (1.98 / phi + 6.16 / k))
```

---

## 7. What to actually ship — end to end, no port programs

The runs above grant port openers for free, which the live game cannot do:
without Source-File 4 there is no `ns.singularity.purchaseTor`/`purchaseProgram`,
so TOR and BruteSSH are manual UI purchases. This is the honest forward path —
cloud servers only, fresh BN1, 60 minutes, median of 9 seeds:

```
strategy                              earned      cash   $/s end  hack     ram     spent
------------------------------------------------------------------------------------------
v2 all, floor 50%                     $1.39b   $16.63m   $814.5k   246   25196    $1.38b
v2 all, floor adaptive                $1.39b   $16.63m   $814.5k   246   25196    $1.38b
v2 index + greedy buyer (floor 75%)   $1.36b   $13.38m   $958.4k   243   24684    $1.35b
v2 all, floor 25%                     $1.03b   $18.23m   $702.5k   237   18540    $1.01b
v2 index only, live buyer           $565.19m   $46.28m   $241.6k   211    9044  $491.48m
v2 all, floor 10%                   $500.40m    $3.40m   $285.4k   219    9068  $492.80m
v2 all, floor 5%                    $279.58m    $2.39m   $122.8k   210    5100  $274.56m
LIVE auto+buyserv                   $150.48m    $2.65m        $0   210    2796  $147.84m
```

- **The ranking fix alone is 3.8x**, with `buyserv.js` untouched.
- **Greedy buying on top takes it to 9.0x.**
- **Money floor 75% → 50% adds ~2% here and +16% at the current 108GB.**

### Why the best money floor moves with RAM

The §5 sweep said "as low as possible"; this table says 5% is a disaster. Both
are right, and the reason is that `early.js` is not the pipeline the §5 model
assumes. It **drains the target to zero** every cycle, so it always pays the
full regrowth from near-nothing — `−ln(1−f)/f` never applies. What the floor
really trades is:

- **more hack ops per unit time** (hack is 1/3.2 of grow), which is *exp*; and
- **money per cycle**, which is roughly proportional to the floor.

At 108GB hacking level is the binding constraint, so the exp channel wins and
low floors dominate — visible directly in the end-of-run level: floor 5% ends
at 109, floor 75% at 96 on identical RAM. Once the fleet is past ~1TB the exp
channel saturates (171 vs 168) and money per cycle takes over, so high floors
win. **50% is within a few percent of the best at both ends**, which is why it
is the value to ship rather than either extreme. An adaptive rule
(`totalRam >= 1024GB ? 0.5 : 0.05`) measured identically to a flat 50% and is
not worth the code.

---

## 8. Correction: the sim was pricing threads 30% too cheap

`THREAD_RAM` in `engine.mjs` is `{hack: 1.7, grow: 1.75, weaken: 1.75}` — the
cost of the *dedicated* workers `h.js`/`g.js`/`w.js`, confirmed against the
running game via `calculateRam`. But `auto.js` deploys **`early.js`, which costs
2.4GB per thread**, because a worker that decides for itself has to carry
`getServerSecurityLevel`, `getServerMoneyAvailable`, `getServerMaxMoney` and
`getServerMinSecurityLevel` as well as all three ops. Every sim number in
sections 1-7 therefore gave the fleet ~1.4x more threads than the live game has.

`run.mjs --workerram 2.4` now prices this. Two consequences:

**(a) Every result above was re-run at 2.4GB before anything was shipped**, and
the conclusions hold with smaller margins — see §9.

**(b) Moving `auto.js` off `early.js` onto dispatched `h.js`/`g.js`/`w.js` is
worth +59%** on its own (fresh BN1, 60 min, v2 policy: $872m at 2.4GB/thread vs
$1.39b at 1.70/1.75). That is the largest unclaimed win left, and it is not
free: it needs a controller that decides the op and the thread count centrally
and re-dispatches on every landing, which is a real script, not a constant
change. Noted for next time, not shipped.

Fixing this also exposed a bug in `fill()`: it sized thread counts from the
module-level `THREAD_RAM` while `exec()` charged `sim.scriptRam`, so any run
with a non-default worker cost launched **nothing at all** and silently
reported zeros. `fill`, `flowTargets` and `splitTargets` now all read
`sim.scriptRam`.

---

## 9. What was shipped, and the evidence for it

All three of these are **live root scripts** — they deployed into the running
game the moment they were saved.

### `auto.js` — target ranking (§6)

`bestTarget` now scores `chance · M / (T · (1.98/φ + 6.16/k))` instead of
`M·φ/T`, with `calculateHackingChance` and `calculateServerGrowthLog` inlined
from the game source. **RAM cost unchanged at 5.5GB** — `ns.getServerGrowth`
shares the `GetServer` bucket the other `getServer*` calls already paid for.

### `early.js` — money floor 0.75 → 0.50 (§5, §7)

Also now accepts the floor as `ns.args[1]`. RAM unchanged at 2.4GB. The
security slack stays at +5, which the sweep says is already optimal.

50% rather than an extreme because the optimum moves with fleet size, and in
opposite directions at the two ends. At the real 2.4GB worker cost, fixed RAM,
60 min, 15 seeds:

| floor | 108GB | 1,364GB |
| ---: | ---: | ---: |
| 5% | $77.2m | $724m |
| 25% | **$77.2m** | $858m |
| 50% | $76.0m | $1.05b |
| 75% (old) | $50.4m | **$1.35b** |

50% is 98% of best at the RAM the game has now and 78% of best at 1.4TB. An
adaptive rule (`totalRam >= 1TB ? 0.75 : 0.25`) beat it by 12% from a fresh
start but *lost* to it by half from the live save; not enough evidence to
justify the extra complexity, and changing the argument would kill in-flight
ops on every worker each time the fleet crossed the threshold.

### `buyserv.js` — greedy spending (§3)

Spends the whole surplus every tick in as many purchases as it takes, interval
120s → 15s, and the standing $2m reserve is replaced by the price of the
cheapest port opener the player does not yet own — currently $1.5m for
FTPCrack, dropping to $0 once it is bought. RAM 5.75GB → **6.4GB**
(`ns.fileExists`, `ns.cloud.getServerUpgradeCost`); it runs on joesguns (16GB),
so this is fine. Holding the reserve costs 1-2% of earnings and keeps the
single best money-to-progress conversion in the game affordable.

### Validation of the three together

Real 2.4GB worker cost, 120 minutes, median of **15** seeds:

```
                                      earned      cash   $/s end  hack     ram
--- from the live save (hacking 112, $488k, 268GB, BruteSSH owned) ---
v2: all three patches                 $3.15b   $57.39m    $1.47m   255   55564
v2: auto.js index fix only            $1.36b  $251.50m   $322.9k   229   19260
LIVE: auto.js + buyserv.js as they were  $336.22m   $15.76m   $143.6k   221    6108

--- fresh BN1 ---
v2: all three patches                 $4.61b   $71.71m    $1.40m   302   82028
v2: auto.js index fix only            $1.38b  $761.92m   $360.6k   252   11180
LIVE: auto.js + buyserv.js as they were  $653.16m  $258.53m   $141.5k   262    7916
```

**9.4x from the live save, 7.1x from a fresh start.** The ranking fix alone,
with `buyserv.js` untouched, is 4.0x and 2.1x respectively.

Neither supervisor changed shape: both still never throw, still write their
status files, still run unattended.

---

## 10. HWGW batching — not built, but measured and scoped

`docs/prior-art.md` §3 argues the schedule was never the decision variable:
throughput is `(m/R)·Ω`, the batch period cancels, and greedy just-in-time is
optimal. That bound is directly computable — it is `INDEX.batch` times total
RAM — so it can be used as a **denominator** rather than only comparing
strategies to each other.

```
state                         RAM     ceiling      per hour   on
live now, lvl 113           268GB   $128.0k/s    $460.91m    harakiri-sushi
live now, lvl 113          2048GB   $978.4k/s      $3.52b    harakiri-sushi
live now, lvl 113         25000GB    $11.94m/s    $42.99b    harakiri-sushi
lvl 200                   25000GB    $36.60m/s   $131.78b    phantasy
lvl 250                   25000GB    $48.78m/s   $175.60b    phantasy
```

The shipped threshold loop ends its 120-minute live-save run at $1.47m/s on
55.6TB, against a ceiling of roughly $108m/s at that level and RAM. **The
threshold loop reaches on the order of 1-5% of the bound.** The remaining
15-50x is what a real batcher is worth, and it is by far the largest number in
this document.

Two things make that number honest rather than fantasy, and both are already
measured here:

1. **It is not an idle-RAM problem.** The engine now tracks time-weighted
   occupancy and every arm runs at 95-100%. The loss is entirely in the *op
   mix* — thread-seconds spent on weaken (4T) and grow (3.2T), which earn no
   money, instead of on hack (T), which does.
2. **The ceiling is per-target bounded, and that bound is exactly §4's
   crossover.** A single target can hold at most `4T/ε` batches in flight
   (landing separation `ε`), each ~7GB at `f → 0`; with `T ≈ 20s` and
   `ε = 200ms` that is ~400 batches ≈ 2.8TB. The measured saturation crossover
   in §4 was 2.5-4.5TB. So §4's result is not a quirk of the threshold loop —
   **one target saturates near 3TB no matter how well it is scheduled**, and
   above that the answer is more targets, exactly as §4 measured.

So the batcher's spec is fully determined by the prior art plus these numbers:
dispatch `h.js`/`g.js`/`w.js` (§8: 1.7/1.75GB, a free 1.4x over `early.js`),
shrink `f` until `h = 1` thread, shrink the period until RAM runs out, and
start a second and third target once one target's pipeline is full at ~3TB.
`hack.js` is not that script and should not be the comparison baseline —
prior-art §3 reports it picks one action for the whole fleet per iteration and
sleeps `weakenTime + 300`.

**Not built this run.** It is a new script, not a constant change, and shipping
an untested batcher into a live unattended game is the one thing worth being
slow about. Everything needed to write and score it is in `tools/sim/` now:
`atFixedRam` for uncontaminated comparisons, `--workerram` for honest thread
costs, `execAt` for delayed launches, `INDEX.batch` for the ceiling.

---

## Open / next

1. **Write the batcher** (§10). 15-50x, the largest number here.
2. **Dispatch `h.js`/`g.js`/`w.js` instead of `early.js`** (§8). +59%, and a
   prerequisite for the batcher anyway.
3. **Multi-target above ~3TB** (§4). Do not do this yet — below the crossover
   it *loses*, and the live fleet is at 268GB.
4. **Tell the player to buy FTPCrack.exe** ($1.5m, TOR already owned).
   `buyserv.js` now reserves for it automatically. Port openers were worth 5.7x
   over an hour in §3, and at hacking 112 FTPCrack unlocks phantasy — $600m max
   money, serverGrowth 35, which the corrected index ranks first from level 160
   on. relaySMTP ($5m) is *not* worth it yet: everything behind it needs
   hacking 300+.
5. **Revisit `k` after the first augmentation install** — `auto.js`'s inlined
   growth constant assumes `hacking_grow = 1` and BN1's `ServerGrowthRate = 1`.
   Both are exact now; neither cancels out of the ranking.

---

## Reproducing any of this

133 strategies are registered. The ones the conclusions rest on:

```bash
# §3 infrastructure policy
node tools/sim/run.mjs --only auto-early,infra-live,infra-serv,infra-prog,infra-prog-serv,infra-all --minutes 60 --seeds 5

# §4 one target or many, RAM pinned. fx<GB>-{1u,1c,2,3,s2,s3}
node tools/sim/run.mjs --only fx8192-1u,fx8192-1c,fx8192-2,fx8192-3,fx8192-s2,fx8192-s3 --minutes 60 --seeds 5

# §5 thresholds. th-sec<N>, th<GB>-money<pct>
node tools/sim/run.mjs --only th-sec0,th-sec3,th-sec5,th-sec10 --minutes 60 --seeds 7

# §6 target index. ix<GB>-{live,liveChance,batch,batchChance}
node tools/sim/run.mjs --workerram 2.4 --only ix0-live,ix0-batch,ix0-batchChance --minutes 60 --seeds 15

# §9 the shipped configuration, from the live save, at the real worker cost
node tools/sim/run.mjs --live --workerram 2.4 --only ship-live,ship-idx,ship-keep1.5 --minutes 120 --seeds 15
```

New knobs added to the harness this run:

| flag / helper | what it is for |
| --- | --- |
| `--sort earned\|money\|netWorth\|rate` | `earned` is the default and the only fair score for a strategy that reinvests |
| `--workerram 2.4` | price threads at what `early.js` actually costs instead of the dedicated workers |
| `--live` | run from the captured save rather than a fresh BN1 (now also captures owned programs, so rooting works) |
| `atFixedRam(inner, gb, {ports})` | grant a free fleet and forbid buying, so two policies meet at identical RAM |
| `INDEX.{live,liveChance,batch,batchChance}` | the four target-ranking indices, and the throughput ceiling |
| `util` column | time-weighted RAM occupancy, so "idle capacity" can be ruled in or out |

---

# Second run — the batcher, multi-target, and a false alarm

Everything below was measured after the contract harvest, from a snapshot of the
live world at **hacking 177, 2,092GB, 20 rooted**. The world changed a lot from
the one sections 1-10 were measured on — silver-helix ($1.125b) and phantasy
($600m) are now rooted — so the older RAM-crossover numbers do **not** transfer.
Re-measured below.

## 11. The "$0 income" alarm was a sampling artefact. Income is lumpy, not zero.

Reported: player money frozen at $487,820 for 2h15m and again at $2,305,577,
with RAM 2354/2380GB busy and exp accruing. Hypothesis offered: `deploy()` in
`auto.js` kills every worker whose `args[0] !== target`, the ranking moves with
hacking level, so the fleet perpetually re-preps.

**Both halves are wrong, and the evidence is direct.**

1. *The target does not move.* Scoring the live world with `auto.js`'s shipped
   `batchChance` index at every hacking level from 150 to 300 gives **phantasy at
   every single level** (`tools/sim/probe-rank.mjs`). Second place, max-hardware,
   never gets above 68% of it. There is no retarget to churn on, and the live
   `early.js` pids confirm it — 23 processes spanning pid 76 to 112, i.e. hours
   old, never killed.
2. *The income is not zero.* Polling `/tel/status.txt` every 18 seconds:

```
23:22:15  money $321.7m   phantasy 49.8%   inc/s $233k
23:22:35  money $452.9m   phantasy 29.3%   inc/s $325k     <- the payout
23:22:50  money  $10.7m   phantasy 29.4%   inc/s $328k     <- buyserv.js spent it
23:25:00  money   $4.9m   phantasy 29.2%   inc/s $302k
```

The threshold loop on a 2.4TB fleet against a $600m target has a **cycle time of
15-20 minutes**: the whole fleet grows phantasy from ~29% to the 50% money floor,
then every worker hacks at once and takes ~$450m in one frame. Any sampler whose
window is shorter than the cycle sees a flat line. `getTotalScriptIncome()` is a
*cumulative average since the last aug install*, so it reads near zero for hours
after a slow start and lags badly — it is the wrong instrument for this.

**This is not a bug to fix; it is the disease sections 4 and 10 describe, in its
most extreme form.** One fleet-wide operation at a time, serialised on the
slowest phase. It does not lose money, it just converts almost all of the fleet's
thread-seconds into grow and weaken. The cure is the batcher, not a patch.

Two real defects in `deploy()` found while checking, neither of them the cause:
`onTarget` is computed and never used, and the RAM for a fresh `exec` is measured
after `ns.kill` in the same tick.

## 12. Multi-target: the crossover moved, and host-partitioning is the wrong fix

Re-measured from the live world, fleet pinned to an exact total with
`atTotalRam`, early.js priced honestly at 2.4GB/thread, 60 minutes, median of 7
seeds. `1u` is exactly what `auto.js` runs today.

```
total RAM   1u (live)   1c demand-capped   split 3   flow 5   partition 2/3/5
  2,092GB     $488m*         $124m*          $152m*    ---      $339m/$152m/$12m*
  4,096GB      $2.27b        $1.49b          $1.85b    ---       $2.11b/$1.82b/$1.44b
  8,192GB      $1.99b        $3.55b          $4.47b    $5.00b    $1.10b/$0.88b/$0.97b
 16,384GB      $1.80b        $6.44b          $5.80b    $5.00b    $2.15b/$2.28b/$2.59b
 32,768GB      $2.42b        $6.75b         $10.94b    $9.23b    $2.55b/$2.56b/$4.21b
```
\* 30 minutes, 3 seeds.

**The crossover in the current world is between 4TB and 8TB**, not the 2.5-4.5TB
section 4 measured — richer targets are rooted now, so one target absorbs more.
The live fleet passed it at ~10.7TB, so the change is due.

But the obvious contained edit to `auto.js` — give each target a slice of the
fleet — is **the one arm that does not work**. "Partition" assigns whole hosts to
the top *k* targets, which is the only shape `auto.js` can express, because it
launches one `early.js` per host and `early.js` takes its target as an argument
and then loops forever deciding its own operation. That arm is **worse than
single-target at every RAM level tested**, by up to 2x at 8TB.

The arms that win are `1c`, `split` and `flow`, and all three share one property
that has nothing to do with the number of targets: **they only ever launch as
many threads as the target's current step actually needs, and relaunch when
those land.** `1c` is *single-target* and beats live by +78% at 8TB and +258% at
16TB. Splitting across targets adds to that; it does not cause it.

So the finding is:

> The lever is demand-sized dispatch, not target count. Target count is what you
> do with the RAM that is left over once the first target's pipeline is full.

And demand-sized dispatch is not something `early.js` can do — a worker that
loops forever on its own thread allocation cannot be told "you are 40 threads too
many for this step". It requires a controller that sizes each operation centrally
and re-dispatches on every landing, with short-lived dedicated workers. That is
the batcher. **There is no contained `auto.js` edit here worth shipping**; a
partitioned `auto.js` would be a measured regression.

## 13. The batcher — built, and what it is worth

`tools/sim/batcher.mjs`. Design A ("periodic padded burst") from
`docs/prior-art.md` §9, not the just-in-time design:

- **All four ops of a batch launch in one burst with `additionalMsec` pads**, so
  all four read the same hacking level and the same security and their relative
  landing offsets are exact by construction. `engine.mjs` grew `execPad` to model
  this; the pre-existing `execAt` models the *other* thing (sleep, then read the
  world at wake time) and is the wrong primitive for a batcher.
- **Launches are gated on measured minimum security.** prior-art §9b′ identifies
  the unsafe window — security is elevated for ε after the hack lands and ε after
  the grow lands, and an op *launched* then runs 10-60x the separation constant
  longer — as the dominant desync mechanism. Checking
  `hackDifficulty <= minDifficulty` before launching is the closed-loop form of
  its "phase-lock to 3.5ε", and unlike the open-loop version it does not assume
  the schedule is running as planned.
- **Batch size is chosen, not fixed.** `batchPlan` sweeps hack threads and
  maximises money per GB of batch. Grow and weaken carry a 10% margin, which is
  nearly free (§9f: excess grow threads add *no* security and excess weaken is
  clamped at the floor) and absorbs the level-ups that happen mid-flight.
- **Target count falls out of the arithmetic.** A target's pipeline saturates at
  `ceil(weakenTime / 4ε) · batchRam`; targets are added down the ranked list
  until their saturation RAM covers the fleet. This derives section 4's crossover
  rather than tuning to it.
- **Three states per target: prep / batch / drain.** Nothing tries to rescue a
  desynced pipeline in place — if security climbs past a tolerance or money falls
  below one, it stops launching, lets everything in flight land, and re-preps.
  That always terminates.

First measurements, live world, RAM pinned, 20 minutes, seed 1:

```
                                  earned    $/s at end   util
3,072GB  threshold loop (shipped) $48.4m      $119k      99%
3,072GB  batcher, 1 target       $292.7m     $1.63m      68%
8,192GB  threshold loop (shipped) $478.7m         $0     100%
8,192GB  batcher                   $1.09b     $6.04m      68%
```

**2.3x to 6x, and the end-of-run rate — the honest number for a pipeline that
takes a few minutes to fill — is 14x to 50x.** Utilisation is only 68%, so there
is more in it; that is the next thing to chase.


## 14. The batcher as shipped — `batch.js`

`batch.js` (root, 8.45GB) plus the rewritten `h.js`/`g.js`/`w.js`
(1.7/1.75/1.75GB). Replaces `auto.js` + `early.js` entirely; it roots, ranks,
preps, batches and writes its own telemetry.

### Measured, engine revision as of 2026-09-12 (before the fidelity agent's changes)

40 minutes, median of 3 seeds, from the live world, fleet pinned to an exact
total with `atTotalRam`. The threshold loop is priced at early.js's real
2.4GB/thread; the batcher at the dedicated workers' 1.7/1.75.

| fleet | threshold loop (shipped) | `batch.js` | ratio | batcher $/s at end |
| ---: | ---: | ---: | ---: | ---: |
| 2,048GB | **$721m** | $598m | 0.83x | $937k/s |
| 8,192GB | $1.08b | **$6.75b** | **6.2x** | $6.06m/s |
| 12,288GB | $1.68b | **$10.91b** | **6.5x** | $9.92m/s |
| 32,768GB | $973m | **$24.59b** | **25x** | $18.42m/s |

**The crossover is 2-4TB.** Below it the threshold loop genuinely wins, for the
reason section 5 gives: at small RAM hacking level is the binding constraint and
dumping every thread into one operation is an experience pump. Above it the loop
stops scaling at all — it earns *less* at 32TB than at 12TB, because income is
capped at roughly one target's max money per cycle no matter how many threads
are pointed at it — while the batcher scales nearly linearly.

The end-of-run rate is the honest steady-state number: a pipeline takes a few
minutes to fill, and the threshold loop's rate reads `$0` at three of the four
sizes simply because its payout lump fell outside the final tenth of the run.

### Target count: measured, not derived

The analytic saturation point (a target holds `ceil(weakenTime / 4ε)` batches)
is a bound the launch loop never reaches — placement fails, safe windows close,
the controller ticks at a finite rate. Trusting it left **42% of a 12TB fleet
idle**. A closed-loop "add a target while utilisation is below 85%" rule was
*worse*: it ratchets, and each addition halves the leading target's share and
costs a fresh prep (8TB fell from $6.81b to $2.11b). So the count is a measured
constant — **2, rising to 3 past 24TB**:

| fleet | 1 target | 2 | 3 | 5 |
| ---: | ---: | ---: | ---: | ---: |
| 4,096GB | $2.07b | **$2.61b** | — | — |
| 8,192GB | $5.55b | **$6.75b** | — | — |
| 12,288GB | $7.51b | **$10.91b** | $5.95b | — |
| 32,768GB | $19.75b | **$24.67b** | $24.59b | $19.92b |

### The failure path, exercised

`--drain` cannot be requested, so it was provoked: `bt8192-badrain2` runs the
batcher with grow deliberately under-provisioned by 40%, which makes the
pipeline drift into desync by construction.

```
grow margin  1.10 (shipped)   $6.81b   drains 0
grow margin  0.85             $6.19b   drains 0-1
grow margin  0.60             $2.26b   drains 1    <- still 2x the threshold loop
```

It degrades, it does not stall: the controller stops launching, lets everything
in flight land, re-preps and resumes. At a 40% thread error it still earns
**twice** what the threshold loop earns on the same fleet. That is the property
that matters for running unattended.

### Two bugs found in simulation that would have been ugly live

1. **Prep flooded the fleet with useless weakens, forever.** The in-flight
   ledger projected security forward using the raw in-flight grow thread count,
   but `processSingleServerGrowth` fortifies by the threads it *actually used*,
   capped at the threads needed. The projection was therefore an unbounded
   overestimate: prep believed security was about to explode and launched weaken
   after weaken, filling the fleet and never reaching the batch phase. Symptom
   in sim: 1,501 prep rounds, 86% RAM used, zero operations landed. Capped at
   the real need.
2. **Idle-RAM spill starved the batcher.** Spare RAM goes into weaken for the
   free experience, but a weaken holds its RAM for a full `weakenTime`, so
   without reserving what the pipelines will claim over that same window the
   spill takes everything and no batch can ever be placed. Symptom: $0 earned
   with the spill on, $292m with it off. The reservation is now
   `ceil(weakenTime / period) · batchRam` per target.

Prep also no longer waits a whole `weakenTime` between rounds. It keeps a ledger
of in-flight effects, projects the server forward, and launches only the
shortfall each second. The wait-for-the-wave version spent **11 of 20 minutes**
prepping a $600m target.

### Engine note for the fidelity agent

`engine.mjs` grew `execPad(host, op, target, threads, padMs)` for this work — the
`additionalMsec` semantics, where the duration is computed at launch and the pad
added afterwards. The pre-existing `execAt` models sleep-then-operate, which
reads the world at *wake* time; that is a genuinely different exposure and the
wrong primitive for a batcher. Please keep both. Every number in sections 13-14
was measured before the fidelity changes land.

## 15. Deploying `batch.js` — the handover

`batch.js` and `auto.js` both fill every host they can see, so they cannot run
together: observed live at 00:06, `batch.js` had been up 7.5 minutes with RAM at
99.9%, 248 placement failures and **zero batches launched**, because `auto.js`
owned all of it. `auto.js` must be stopped first, and `watchdog.js` will put it
back within 30 seconds unless its watch list changes first.

Order matters. From the game's terminal:

```
# 1. Stop the watchdog FIRST, or it restarts auto.js underneath you.
kill watchdog.js pserv-67932

# 2. Stop the old supervisor. Its early.js workers do not need killing by
#    hand — batch.js clears every early.js (and any stale h/g/w.js) on the
#    hosts it is about to use, as its first act.
kill auto.js home

# 3. Start the batcher on the whole fleet.
run batch.js

# 4. Point the watchdog at the new supervisor and restart it.
#    watchdog.js WATCHED should become:
#      { script: 'batch.js',   host: 'home',     args: [] }
#      { script: 'buyserv.js', host: 'joesguns', args: [] }
run watchdog.js
```

Rollback is `kill batch.js home`, restore the watchdog list, `run auto.js`.
`batch.js --hosts a,b,c` restricts it to named hosts if a partial run is wanted
instead.

### What to watch, in the first five minutes

`.telemetry/batch.txt` (mirrored from `/tel/batch.txt`; run
`curl -s localhost:12526/poll` first). The single field to read is `health`:

| `health` | meaning |
| --- | --- |
| `prepping` | normal for the first few minutes, and after any drain |
| `ok` | a batch launched within the last 60 seconds — this is the working state |
| `stalled` | in the batch phase but nothing launched for 60s — **the bad state** |
| `idle` | no viable target |

Expected progression from a cold start with the target drained (which is where
`auto.js` leaves it):

- **0-4 min** `health: prepping`, `targets[].moneyPct` climbing to 100 and `sec`
  falling to `minSec`. `threadsDispatched` should be tens of thousands.
- **~4 min** `phase` flips to `batch`, `health` becomes `ok`, `batches` starts
  incrementing several times a minute, `periodSec` around 1-4s.
- **5 min on** `ram.utilPct` in the 80-95% band, `earned` rising smoothly rather
  than in 15-minute steps, `drains` staying at 0 or 1.

Warning signs and what they mean:

- `health: stalled` with `placeFails` climbing — something else is holding the
  RAM. Check for surviving `early.js` processes.
- `drains` climbing steadily (more than one every few minutes) — the pipeline is
  desyncing faster than it recovers. Raise `margin` in `SETTINGS`, or run with
  `--spacing 400`.
- `partials` or `execFails` above zero — a batch could not be fully launched.
  One or two is fine; a steady stream means the fleet is too fragmented.
- `unsafeSkips` climbing without `batches` climbing — the target never returns
  to minimum security, which means weaken is under-provisioned.

The number that settles it is `totals.earnedPerSec`, which is measured from the
target's own money drops rather than from `getTotalScriptIncome()` — the latter
is a cumulative average since the last install and lags by hours (section 11).
Against the threshold loop's recent behaviour it should go from lumpy
$300-500k/s to a smooth **$5m/s or better** on the current fleet.

## 16. Open / next, after this run

1. **Watch the first hour live.** Every number in sections 13-15 is simulated,
   and section 11 is the standing reminder that the sim and the game have
   disagreed badly before. `totals.earnedPerSec` in `/tel/batch.txt` is the
   measurement that settles it.
2. **Utilisation sits at 83-87%, not 100%.** The gap is placement failures: a
   batch's hack must land as one thread group, and on a fleet of mixed server
   sizes there is not always a single free block big enough. Worth chasing next;
   it is the difference between 6x and perhaps 7x.
3. **Below ~2-4TB the threshold loop still wins** (section 14). If a future
   BitNode restart drops the fleet back to hundreds of GB, run `auto.js`, not
   `batch.js`. Nothing switches automatically, deliberately — an automatic
   switch would flip back and forth across the crossover and pay a prep cycle
   each time.
4. **Revisit the inlined formulas after the first augmentation install.**
   `batch.js` assumes every player multiplier is 1, which is exact in BN1 with
   no augmentations and wrong immediately afterwards. `hacking_grow` and
   `hacking_money` both enter the batch arithmetic and neither cancels.
5. **Section 4's multi-target crossover no longer applies as written.** It was
   measured on a world where the rooted target set was much poorer. Re-measured
   in section 12: the threshold loop's crossover moved to 4-8TB, and for the
   batcher the answer is simply two targets everywhere (section 14).
