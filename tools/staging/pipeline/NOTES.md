# batch.js HGW pipeline audit — findings

Session 2026-09-13 ~20:55–21:15 local (game clock 00:53–01:11Z). Read-only against
the live game. All offline numbers computed with `tools/sim/game.mjs`, which
printed `[sim] physics: BitNode 4 (SF4.0)` on every run — the BN1 trap was avoided.

Artifacts in this directory:
- `fleet.mjs`        — decode save, dump fleet block geometry + target list
- `plancurve.mjs`    — CHECK 0 (ports vs game source) + score/income curve vs h
- `frag.mjs`         — contiguity-aware packing: how many batches actually FIT
- `duty.mjs`         — duty-cycle-weighted income vs the live measurement
- `series.mjs`       — parse `batch-series.jsonl` into a time series
- `inc.mjs`          — difference `moneySourceA` between two save pulls
- `batch-series.jsonl` — ~70 samples of /tel/batch.txt at 15s

---

## HEADLINE: the plan oscillates in a limit cycle. ~2x income is on the table.

`batch.js:1462` recomputes the plan **every 200ms tick** from the **instantaneous
largest free block**:

    const largestBlock = free.size ? Math.max(...free.values()) : 0
    const plan = planBatch(t, ram, slice / 4, largestBlock)

and `planBatch` (batch.js:786) turns that into a hard ceiling on hack threads:

    const hFit = Math.floor(maxHackRam / ram.hack)
    const hMax = Math.max(1, Math.min(Math.ceil(0.99 / phi), hFit))

Measured: `planBatch`'s score (`money/gb`) is **monotonically increasing in h**
over the whole practical range (plancurve.mjs CHECK 1: $/GB rises 1710 -> 8732
from h=1 to h=132), because `w1`/`w2` carry `+1` constants that are fixed
overhead a small batch cannot amortise. So the planner **always** wants the
biggest hack the largest free block can hold, and `hFit` is **always** binding.

That closes a positive feedback loop:

    fleet fills -> largest free block shrinks -> hFit falls -> plan.gb falls
    -> maxInFlight = floor(slice/plan.gb) rises -> period falls
    -> batches launch faster -> fleet fills faster -> (repeat)

Observed live, 68 samples over 1007 s, `plan.h` cycling with a ~2.5 min period:

    132 -> 59 -> 45 -> 34 -> 26 -> 20 -> 15 -> 7 -> 4 -> 3 -> 2 -> 1
    [at h=1: placeFails 75 per 15 s = 100% of ticks, zero batches]
    ...fleet drains over weakenTime... -> 132 -> repeat

Time spent in each regime (duty.mjs):

| regime | share of time | income vs achievable |
| --- | --- | --- |
| h <= 4 | **32.7%** | 22–57% |
| h 5–10 | 24.6% | 73–79% |
| h 11–45 (good) | 32.2% | 94–100% |
| h > 45 | 10.5% | 44–81% |

At the bottom of every cycle `reservedForPipelines` drops (2828 -> 2379, seen at
01:06:38) because `period` hits its `4*spacing` floor — the only regime where
the reservation is not saturated. That is the fingerprint of the collapse, and
it is visible in the telemetry the batcher already publishes.

### Sizing the fix

`frag.mjs` packs N concurrent batches into the real block list, honouring the
rule that the **hack op cannot be split across hosts** (invariant B5,
`batch.js:806-813`) while grow/weaken can:

| plan | N that fits | income |
| --- | --- | --- |
| RAM-only optimum h=224, gb=549 | 2 (not 5) | $71,255/s |
| **contiguity-aware optimum h=20–34, gb=53–91** | **51 / 30** | **$162,232/s** |
| batch.js unconstrained argmax h=132 | 6 | $125,968/s |
| collapse point h=1 | 228 | $36,264/s |

**Pinning h in the 15–34 band is worth ~2x.** Live measured hacking income
(`moneySourceA.hacking` differenced over two windows) is **$82,062/s** (692 s)
and **$93,403/s** (198 s), i.e. **51–58% of the $162,232/s achievable**.

Calibration of the diagnosis: duty-cycle-weighting income(h) over the observed
`plan.h` trace predicts **$107,769/s**, which is 15–31% ABOVE the two live
measurements — the right direction and the right size, because the model credits
income during the h<=4 phases where placement actually fails outright.

---

## Q1 — is the reservation correct? It is a TAUTOLOGY, and harmless.

`batch.js:1460-1471`:

    const slice       = totalRam / targets.length
    const maxInFlight = max(1, floor(slice / plan.gb))
    const period      = max(4*spacing, weakenTime / maxInFlight)
    reserved += min(slice, ceil(weakenTime / period) * plan.gb)

Substitute `period` back in. When the `4*spacing` floor is not active,
`ceil(weakenTime/period) = maxInFlight`, so

    reserved = floor(slice/plan.gb) * plan.gb  ==  slice rounded down to a
                                                  multiple of plan.gb

It recovers its own input. It is **not** measuring pipeline demand; it cannot
report anything other than ~slice unless the period floor binds. Verified at
live numbers in both regimes:
- h=132, gb=315: floor(2124/315)=6, 6*315=1890 -> telemetry showed `resv=1892`. ✓
- h=1, gb=12, period clamped to 0.8s: ceil(153.3/0.8)*12 = 2304 -> telemetry
  showed `resv=2379` at a slightly different gb. ✓

**Is it over-reserving? No, and it does not matter, because `reserved` gates
exactly one thing** — the spill-weaken at `batch.js:1568`:

    const idle = sum(free) - reserved
    if (floor(idle / ram.weaken) >= 1) spread(... 'weaken' ...)

Since `reserved >= sum(free)` essentially always, **the spill weaken never
fires**. Net effect of the whole reservation mechanism today: dead code that
leaves the residual RAM unclaimed. Not a bug worth fixing for income.

### The user's causal claim about share.js is BACKWARDS

A HIGH reservation makes batch.js spill LESS, which LEAVES MORE free RAM — which
is exactly the pool `share.js` can be launched into. A LOW reservation would have
the spill weaken take every free byte and hold it for a full `weakenTime`, which
is what would actually starve share. The observed `util 53.3% / reserved 1513`
was batch.js *declining to spill*; share.js simply had not been launched yet. It
now runs at 72 threads and util is 88–93%.

`reservedForPipelines` is nonetheless a **misleading telemetry field**: it
reports the plan's ambition (~the whole fleet), not RAM actually held. Actual
in-flight is `cal.inFlight` * plan.gb, typically 1/3 of it.

---

## Q2 — is one target optimal? YES, and by a wide margin. FINE.

Independent confirmation two ways.

1. batch.js's own argmax (`batch.js:1265-1286`) run against the **live** save,
   live fleet, live `y=0.2`, BN4 physics: n=1 = $120.3k/s, n=2 = 89% of that,
   n=8 = 59%. Argmax = 1.
2. My own per-target economics (plancurve.mjs CHECK 3): splitting the fleet n
   ways gives 1.000x / 0.906x / 0.867x / 0.811x ... for n=1..8.

Nothing saturates at any n, so income(n) reduces to
`totalRam * mean(rate_1..rate_n)` over rate-descending targets — a monotone
decreasing mean. **n=1 falls out structurally, not numerically**, so the scale
error cannot move it. Argmax stays 1 for `maxHackRam` in {inf,512,...,8}GB and
for fleets up to ~131TB (62x the current one). `maxTargets: 8` is a ceiling that
is simply not the operative number. **Checked and FINE.**

Note `silver-helix` (maxMoney $1.27e8, req 150 <= level 190) is nearly 2x
phantasy's max money and is NOT farmed. That is CORRECT: its weakenTime is 311s
vs phantasy's 153s and its $/GB is 4026 vs 8732 — phantasy wins on rate. Checked
and fine.

### `tools/sim/horizon.mjs` does NOT answer the target-count question
It solves minimum-time-to-terminal over *which controller to run*, not over n.
It only *reproduces* batch.js's argmax as a dependency (`horizon.mjs:637-685`) to
price the configuration batch.js will pick. Worth knowing: `horizon.mjs:662`
passes `largestBlock` into that loop, so **the offline reproduction is more
correct than the shipped code** (see Q3). If you want a live target-count tool,
lift `batchFleetRate`, not `target-count.mjs`.

---

## Q3 — planBatch sizing. Fragmentation itself costs only ~9%. The clamp costs 2x.

Two separate things, and conflating them is the trap:

- **Contiguity cost proper**: RAM-only optimum $178,137/s vs contiguity-aware
  optimum $162,232/s = **8.9%**. Small. The hack-op-cannot-split rule is cheap.
- **The clamp's dynamics**: driving h from the instantaneous largest free block
  produces the limit cycle above and costs ~45%.

The $/GB curve is very flat from h=15 to h=380 (8100–8732, +/-7%) and falls off a
cliff below h=10. So the fix is not a better argmax — it is a **floor**.

Does fragmentation get worse over time? Yes, within each cycle: the 512/456/256/
256/128 blocks are consumed first, and once they are gone `hFit` collapses. The
fleet shape makes this acute — 34 of 59 rooted hosts are 8 or 16GB.

### A real defect: the argmax and the dispatcher disagree
- dispatcher: `planBatch(t, ram, slice/4, largestBlock)`   — batch.js:1462 (4 args)
- argmax:     `planBatch(cand[i].t, ram, slice/4)`          — batch.js:1274 (3 args)

`maxHackRam` defaults to `Infinity` (batch.js:765), so the argmax scores batches
the dispatcher can never place (h=132, gb=319, needing a 224GB contiguous block
on a fleet whose median host is 16GB). It happens not to change the answer here
(n=1 is robust), but the two call sites must agree.

---

## Q4 — where the money goes. Hacking is ~45–61%, and SPENDING is the bigger leak.

From the game's own attribution. NOTE the A/B semantics are the opposite of what
was assumed: `moneySourceA` resets in `prestigeAugmentation()`
(`PlayerObjectGeneralMethods.ts:128`) = **since last install**; `moneySourceB`
resets in `prestigeSourceFile()` (`:171`) = **since BitNode entry**. Neither is
all-time. Confirmed by `NetscriptFunctions.ts:1392-1393`.

This life (58 min): hacking 44.6%, codingcontract 55.4%, everything else $0.
This BitNode (13.5 h): hacking 61.2%, codingcontract 38.8%, everything else $0.

So tuning the batcher is NOT the wrong thing — but it is a ~45–61% lever with a
comparable second lever (contracts) beside it.

**The bigger number**: this life took in $60.2M gross and kept $6.6M. `servers`
consumed **$46.3M = 77% of gross income** ($13,265/s outflow), and that money is
destroyed at every install. The fleet it bought is thirteen 8GB and twenty-one
16GB purchased servers — RAM that is nearly useless to a batcher whose hack op
cannot span hosts, bought at full price. Over all of BN4, servers+other+augs took
50.5% of gross.

---

## Q5 — the calibration. CONVERGED AND CORRECT. FINE.

`verdict: ok`, `y: 0.2`, 110 samples, p10 0.1994 / p50 0.2 / p90 0.2,
spread 0.0032, `source: measured`. It converged to exactly
`currentNodeMults.ScriptHackMoney = 0.2`.

Independently verified against game source (plancurve.mjs CHECK 0, all 13
hackable targets): batch.js's `hackFraction` (batch.js:309-315) omits
`currentNodeMults.ScriptHackMoney` from `calculatePercentMoneyHacked`
(`~/Repos/bitburner/src/Hacking.ts:54`) by design, and

    phi0 * 0.2  ==  calculatePercentMoneyHacked   to 0.0000%

`hackChance` and `growthK` also match to 0.0000%. **The estimator is measuring
exactly the term the port omits.** The user's `verdict: cold, y: 1` observation
was the cold-start window right after the 23:57Z install re-randomised the world;
it self-recovered, and the telemetry said so in `calibration.notes`.

`planVsReal` is NOT stuck at 0.69 — over the session it ranged 0.60 to 1.08 and
averaged near 1.0. The variance is a consequence of the oscillation (the plan
captured at launch differs from the one in force at landing), not of a biased
estimator. It should tighten on its own once the plan is pinned.

---

## Checked and FOUND FINE (stated explicitly, per CLAUDE.md)

- The self-calibration converges to the right constant, and I verified the
  constant against game source rather than against the code under test.
- `n = 1` is the correct target count, structurally, at this fleet size.
- `maxTargets: 8` is not misconfigured; it is a ceiling that does not bind.
- Not farming `silver-helix` despite its larger max money is correct (rate, not
  stock, is what matters).
- `planBatch`'s objective (`money/gb`) is the right objective under RAM
  saturation — income = `fleetRAM * ($/GB) / weakenTime`, so maximising $/GB
  maximises income. Verified algebraically and numerically (plancurve CHECK 2).
- The reservation over-reserves in the sense that it is circular, but it gates
  only a spill-weaken that is pure bonus, so it costs no income.
- `share.js` at 72 threads gives bonus `1 + ln(72)/25 = 1.171`. Going to 212
  threads costs 560GB (~$32k/s of hacking) and buys +3.7% rep. The concavity
  (`Share.ts:43`) makes further growth a bad trade. Roughly fine as-is.
- The formula ports for hack chance and growth constant are exact under BN4.

## Broken tooling found along the way (not income, but silent)

1. `tools/sim/verify-argmax.mjs:21` and `tools/sim/verify-alloc.mjs:48` do a bare
   `await import("../../batch.js")` -> `ERR_MODULE_NOT_FOUND: status.js`, exit 1
   **before any check runs**. This is the exact `placement.test.mjs` failure
   CLAUDE.md already records; the fix (`importRootScript` from
   `tools/sim/rootimport.mjs`) exists and three sibling tools already use it.
   `batch.js:1261-1262` cites verify-argmax.mjs as its evidence.
2. `tools/sim/target-count.mjs:39` calls `loadSnapshot()` with no argument ->
   `tools/sim/snapshot.json`, which is **BitNode 1**, 2026-09-11, hacking 295,
   448TB fleet, phantasy at 9x its real max money. Default `--fleets` are the
   same three dead numbers. Its own CHECK correctly fails 3/3 and it prints the
   table anyway. No BN4 snapshot exists in `tools/sim/`.
3. `horizon.mjs:983` hardcodes `uncheckable("batch.js throughput", "batches: 0")`
   instead of reading `batch.txt`. The anchor now exists.
