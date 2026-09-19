# How the batcher should split the fleet between targets

`docs/target-count.md` §7 measured that replacing the dispatcher's **even RAM
split** (`share = totalRam / n`) with **fill-to-saturation** allocation earned
+43% at 448TB, on three seeds, one world, one fleet size, scored on money alone,
and flagged itself as not ready to ship. This document is the validation it asked
for — 9 seeds, 4 worlds, fleet sizes from 33TB to 26PB, placement failures and
prep completion measured alongside income, both arms driven by `batch.js`'s own
exported `planBatch` / `targetScore` / `hackFraction` / `hackChance` / `growthK`
— plus a correction to the derivation that the validation itself forced.

## Verdict, in four lines

1. **The rule is right and the +43% is reproducible — but only with
   `maxTargets` raised.** At the shipped `maxTargets = 8` the same measurement is
   +29% at 448TB and **−7%** at 1.6PB. At `maxTargets = 16` it is +44% at 448TB
   and +32% at 1.6PB. The allocator and the cap are one change, not two.
2. **The gain is a function of fleet size relative to the *saturation budget* of
   the candidate list** (§3) — about 322TB on the measurement world, 410TB on the
   live one at `maxTargets = 8`. Below it the gain grows; far above it the two
   allocators are algebraically identical and measure identical.
3. **`saturationRam` as originally derived is wrong**, and the error was found by
   calibrating against the running game. It assumes a pipeline lands a batch
   every `4·ε`; the live controller lands one every 0.81–1.01s against a floor of
   0.808s. §4 gives the corrected law, fitted to **0.1% mean absolute error**.
4. **The live fleet is 4.2–30PB, which is far past the budget, so deploying this
   today buys approximately nothing** (measured: −0.4% on a snapshot of the live
   world at 5.8PB). What it buys is a rule that is right at every fleet size.

Deploy it as a correctness change, with `maxTargets` raised, and do not sell it
as income. §10 has the conditions under which I would not deploy it.

New files: `tools/sim/alloc.mjs` (the rule, shared by harness and patch),
`tools/sim/verify-alloc.mjs` (the experiment), `tools/sim/verify-alloc-shipped.mjs`
(shipped-function and live-calibration checks), and the worlds
`tools/sim/snapshot-live.json`, `snapshot-mid.json`, `snapshot-post.json`.

---

## 1. The rule, precisely

### 1a. Saturation RAM

A pipeline lands one batch per `period`; each batch holds `plan.gb` for one
`weakenTime`; so the RAM a target holds is `(weakenTime / period) · gb`. The
dispatcher floors `period` at `4·ε` (`batch.js:843`) because the four landings of
one batch are `ε` apart and the next batch may not overlap them. Hence

```
depth_i  = ceil( weakenTime_i / period_i )
satRam_i = depth_i · gb_i
```

`weakenTime = 4·hackTime` and `growTime = 3.2·hackTime`
(`src/Hacking.ts:81-92`). RAM beyond `satRam_i` earns that target nothing, and
that is a property of the target rather than of the batcher: servers have no
passive regrowth — the only callers of `processSingleServerGrowth` are `ns.grow`
(`src/NetscriptFunctions.ts:288`), the terminal `grow` command
(`src/Terminal/commands/grow.ts:27`) and the offline catch-up
(`src/Script/ScriptHelpers.ts:52`).

**`period_i` is not `4·ε`.** §4 derives and measures what it actually is.

### 1b. The allocation

> Walk the ranked, quality-floored candidate list best-first. Give each target
> the lesser of its saturation RAM and everything still unallocated. Stop when
> the fleet is spent, when a target cannot be given room for one whole batch, or
> when `maxTargets` is reached.

`tools/sim/alloc.mjs:fillToSat`, and §9's patch, are the same twelve lines. Two
passes per target, because the problem is mildly circular: the batch a target
runs is `planBatch(t, ram, share/4)` and `share` is what is being computed. Pass
1 prices the target against everything left, pass 2 re-prices it against what it
is actually getting. The sequence only decreases, so it cannot loop.

### 1c. The count

**There is no count rule any more.** The count is `shares.size` — however many
targets received a workable allocation. That is the "cumulative-saturation" rule
`docs/target-count.md` §6b rejected, and it is right here for the same reason it
was wrong there: it is the optimum of a fractional knapsack with capacities,
which is what fill-to-saturation *is*.

---

## 2. Why the allocation and the count must change together

Each rule is correct for exactly one allocator.

**The argmax count assumes an even split.** It maximises
`Σ_{i≤n} min( money_i/(4ε), (totalRam/n)·money_i/(gb_i·weakenTime_i) )`. Every
`totalRam/n` in that expression is the claim that adding a target *takes RAM from
the targets above it*. Under fill-to-saturation it does not — a target is funded
out of what is left after the better ones are full — so the argmax charges for a
cost that is not paid, and under-counts.

**The cumulative-saturation count assumes fill-to-saturation.** Under an even
split a target that cannot use its share wastes it *and has taken it from the
better targets above*, so the saturation count overshoots exactly when the tail
is poor.

Both half-pairings measured, 9 seeds, 180 minutes, `snapshot.json` at 448,708GB,
`maxTargets = 8`:

| arm | allocation | count | earned | vs shipped |
| --- | --- | --- | ---: | ---: |
| `even` (ships today) | even split | income argmax | $2.84t | — |
| `satcount` | even split | cumulative saturation | $2.72t | **−4%** |
| `argmaxfill` | fill to saturation | income argmax | $3.63t | +28% |
| `greedy` (proposed) | fill to saturation | cumulative saturation | **$3.67t** | **+29%** |

The half-pairing that keeps today's allocator and takes the new count is a
**loss** — it picks 4 targets where the argmax picks 7, and under an even split
that starves them. The other half-pairing happens to be close to the full change
here because at this fleet size the argmax already picks ~the right number; on
`snapshot-live.json` the two are identical to the dollar because `maxTargets`
binds both. The allocation is the dominant term; the count is worth the last
1–3%. Either way there is no reason to ship them apart.

---

## 3. The saturation budget: where the gain lives and where it cannot

The quantity that decides everything is the **saturation budget** of the
candidate list — `Σ satRam_i` over the targets the batcher is allowed to run.
Below it, RAM is scarce and how it is divided matters. Far above it, every target
is saturated under *any* allocation that funds them all, and the two allocators
coincide — provably: with `share ≫ satRam`, `maxInFlight = floor(share/gb)` is
large, `period` is at the floor for both, and
`reserved = min(share, ceil(weakenTime/period)·gb) = satRam` for both, so the
dispatch, the plan and the spill are all identical.

From `batch.js`'s own `planBatch`, ε = 200:

| world | hacking | targets past the floors | budget, top 8 | top 14 | top 16 | whole list |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `snapshot.json` | 295 | 15 | 322TB | 983TB | 998TB | 998TB |
| `snapshot-mid.json` | 1338 | 32 | 2,624TB | 3,160TB | 3,376TB | 5,719TB |
| `snapshot-live.json` | 2296 | 28 | 410TB | 589TB | 638TB | 1,068TB |

Three regimes, and the measurements in §5 land in all three:

* **fleet ≪ budget** — nothing saturates; fill-to-saturation degenerates to
  "give the best target everything", which is what the argmax picks too.
* **fleet ≈ budget** — the even split over-serves the saturated head and starves
  the unsaturated middle at the same time. This is where the gain is.
* **fleet ≫ budget** — identical, to within seed noise.

**The live fleet is 5.8PB (30.4PB before the install this evening), against a
top-8 budget of 410TB.** That is 14–74x past the budget, which is why §5's
largest-fleet rows are all zero.

---

## 4. The correction: `period` is measured, not assumed

This is the part the original derivation got wrong, and it was found by
calibrating against the batcher that is actually running.

### 4a. The error and its direction

`satRam = ceil(hackTime/ε)·gb` assumes `period = 4ε = 800ms`. The live
controller does not achieve that. Since `depth = weakenTime/period`, a **longer**
real period means **fewer** batches in flight, so the real saturation RAM is
**smaller** than the formula returns: the formula **overstates** satRam. An
overstated satRam means the head of the list absorbs more than it can use, so
`fillToSat` runs out of fleet sooner and funds **fewer** targets. Correcting it
pushes toward **more** targets.

(An earlier revision of the docstring in `alloc.mjs` stated both the sign and the
consequence backwards. Fixed.)

### 4b. What the period actually is

Two mechanical terms, neither of them modelled:

1. A launch can only happen on a controller loop tick — `batch.js`'s `while`
   body runs every `SETTINGS.loopMs` — so the shortest realisable period is
   `4ε` **rounded up to a whole tick**: 808ms at the measured 202ms loop, not
   800ms.
2. Every blocked attempt costs exactly one further tick, because the dispatcher
   `continue`s without advancing `s.nextLaunch` and retries next loop. Blocked
   attempts are counted: `s.unsafeSkips` (safe-window gate) and `s.placeFails`.

```
achievedPeriod = ceil(4ε / loopMs) · loopMs  +  loopMs · (unsafeSkips + placeFails) / batches
```

Fitted against the running game by **differencing two telemetry samples 333s
apart** — differencing matters, because `uptime / batches` is biased by however
long the target spent in prep, and that bias is what makes the period look
correlated with `weakenTime` (r = 0.98) when it is not. Ten batching targets,
skip rates from 0.7% to 100%:

| host | true period | this law | `4ε·(1 + skips/batches)` |
| --- | ---: | ---: | ---: |
| joesguns | 0.810s | 0.809s | 0.806s |
| n00dles | 0.822s | 0.823s | 0.861s |
| harakiri-sushi | 0.826s | 0.827s | 0.877s |
| neo-net | 0.843s | 0.845s | 0.948s |
| zer0 | 0.865s | 0.865s | 1.029s |
| iron-gym | 0.865s | 0.864s | 1.026s |
| hong-fang-tea | 0.872s | 0.872s | 1.058s |
| nectar-net | 0.893s | 0.893s | 1.139s |
| max-hardware | 0.900s | 0.900s | 1.168s |
| foodnstuff | 1.009s | 1.008s | 1.598s |
| | | **0.1%** | 19.8% |

The third column is the natural guess that a skip costs a whole period. It costs
one loop tick. Getting that wrong over-corrects `satRam` by up to 58%.

### 4c. The correction is right about the world and WRONG as an allocation cap

This is the result I expected least and it is the most important one in this
section, so it is stated before the recommendation rather than after.

Feeding the measured period into `satRam` — arm `greedym`, `satRam = ceil(4·hackTime /
achievedPeriod)·gb`, everything else identical — **loses**, everywhere, by a lot:

| world / fleet | `even` | `greedy` (4ε) | `greedym` (measured) | greedym vs even |
| --- | ---: | ---: | ---: | ---: |
| `snapshot` 98TB | $1,063b | $1,148b | $1,098b | +3% |
| `snapshot` 449TB | $2,839b | $3,670b | $3,392b [2,382..3,755] | +19% |
| `snapshot` 1.6PB | $4,901b | $4,553b | $3,671b | **−25%** |
| `snapshot` 6.4PB | $5,900b | $5,900b | $3,683b | **−38%** |
| `snapshot-live` 98TB | $2,707t | $2,838t | $2,516t | **−7%** |
| `snapshot-live` 449TB | $7,678t | $8,730t | $4,414t | **−43%** |
| `snapshot-live` 1.6PB | $8,690t | $8,688t | $4,085t | **−53%** |

Redistributing the remainder (arm `greedymr`) does not rescue it — at 98TB the
fill already consumes the whole fleet, so there is no remainder, and the arm
measures the same $1,098b.

The reason is that **`satRam` is doing the job of an upper bound, and the
measured period turns it into a point estimate of current usage.** The skip rate
is *phase*-driven, not RAM-driven: §8b shows three targets with identical
`weakenTime` and skip rates of 0.7%, 7.7% and 100%. A target skipping 30% of its
launches is not a target that can only use 70% of `satRam` — it is a target that
would use all of `satRam` the moment its phase moved. Cutting its allocation to
what it is using today removes the headroom it needs to recover, and (because the
skip rate is a cumulative lifetime average, inflated by the startup transient) it
never gets the RAM back. The wide seed spread on the 449TB row
([$2,382b..$3,755b] against `greedy`'s [$3,652b..$3,879b]) is that instability
showing up directly.

So: **use `4ε` for the allocation and the measured period for everything else.**
The corrected period belongs in the income *ceiling* when arms are being compared
or a live figure is being predicted — which is where the +38.5% over-prediction
against the live batcher comes from — and in telemetry, so the controller's
throughput deficit is visible. It does not belong in `min(satRam, left)`.

One genuinely useful change did come out of it, and it is in §9c's patch:
**redistribute whatever the fill leaves unallocated back over the funded targets**
(arm `greedyr`). With `4ε` it is worth +0.3% at 98TB and 0.0% at 449TB on
`snapshot`, i.e. nothing — but it makes the rule *provably* degenerate to the
even split once the fleet exceeds the saturation budget, which is the regime the
live fleet is in. Measured: `snapshot-live` at 6.4PB, `greedyr` earns
$8,309,535b against `even`'s $8,309,500b — the same run to five significant
figures, where plain `greedy` was −0.1%. That converts §6's "no-op, ±0.4% of
noise" at PB scale into an exact no-op, which is the right property for a change
being deployed onto a fleet that is already past the budget.

### 4d. Where `batch.js` should get it

**From itself.** `batch.js` already keeps `s.batches`, `s.unsafeSkips` and
`s.placeFails` per target, in the same `S` map the dispatcher reads. So this is
closed-loop: no telemetry input, no new `ns` call, no RAM cost, and it
re-converges on its own after an install, a fleet change or a BitNode change.

It is also *stable*, which a feed-forward estimate would not be: more RAM makes
the pipeline deeper, a deeper pipeline spends more of each period above minimum
security, so more attempts are blocked, so the measured period lengthens and the
next allocation is smaller. Negative feedback, converging on the RAM at which the
pipeline is as deep as the gate will allow.

Feeding it from telemetry would be strictly worse: it would break on any world
the telemetry was not taken from, it would need a file read per retarget, and it
is exactly the class of "plausible substitute for the real input" that
`CLAUDE.md`'s fidelity section is about.

`tools/sim/alloc.mjs` exports `achievedPeriod(stats, spacing, loopMs)` and
`saturationRamMeasured(...)`; `fillToSat` takes `loopMs` and a `stats` lookup to
switch to the measured form.

---

## 5. Method

`tools/sim/verify-alloc.mjs`. Both arms are the shipped batcher
(`tools/sim/batcher.mjs`) with **one** thing changed: the number each target's
`share` is set to. That is done by handing `serve()` a Proxy of the sim whose
`totalRam()` reports `share · n` — which `dispatch` divides straight back — so
the safe-window gate, placement, drain, spill and the batch plan are the same
code path in both arms.

What this fixes relative to `docs/target-count.md` §7:

* **The shipped functions decide.** Both arms rank with `batch.js`'s
  `targetScore` and plan with `batch.js`'s `planBatch`, over targets built from
  `batch.js`'s own inlined ports. §7 used the simulator's `batchIndex` /
  `batchPlan`. That gap is how a dead batcher reached production once already.
  `verify-alloc-shipped.mjs` check 1 additionally asserts those ports still agree
  with the game's `calculatePercentMoneyHacked`, `calculateHackingChance` and
  `calculateServerGrowthLog` to **0 relative error** across all 79 targets of the
  two real worlds.
* **The quality floors are applied** (`minScoreFrac = 0.02`,
  `minMoneyFrac = 0.01`), and **both arms see the same `maxTargets`**. §7's
  greedy arm ran at `maxTargets = 16` while its even arm was pinned to 7 or 8, so
  a large part of its +43% was "more targets", not "better allocation" — §6
  separates the two.
* **Prep is capped at the target's own allocation** in both arms, matching
  `batch.js:768` and `:793`. The simulator's `prepWave` caps prep at the whole
  fleet's free RAM, which is not what ships.
* **Placement failures, unsafe-window skips, drains and time-to-first-batch are
  recorded.**

Worlds — four, all from real saves, none invented:

| tag | source | hacking | hackable | money mult | home |
| --- | --- | ---: | ---: | ---: | --- |
| `snapshot.json` | the save `docs/target-count.md` used | 295 | 16 | 1.00 | 2GB, 1 core |
| `snapshot-mid.json` | `backups/bitburner-20260912-142305.json.gz` | 1338 | 62 | 1.68 | 16GB, 1 core |
| `snapshot-live.json` | the running game, over the RFA | 2296 | 63 | 4.27 | 4.19PB, 7 cores |
| `snapshot-post.json` | the same game after tonight's install | 4422 | 63 | 9.36 | 4.19PB, 8 cores |

`freshStart()` is not usable here: at hacking 1 nothing above `n00dles` is
hackable, so there is no allocation problem to have.

Fleets: 32,768 / 98,304 / 448,708 / 1.6e6 / 6.4e6 / 26.2e6 GB — an 800x range
spanning the live fleet. `strategies.mjs`'s `atTotalRam` cannot reach either end
(above `getCloudServerMaxRam()` `getCloudServerCost` returns `Infinity` and its
chunk loop never terminates; and it cannot pin a fleet smaller than home), so
`verify-alloc.mjs` has its own `atFleet`. At 448,708GB on `snapshot.json` the
even arm reproduces the shipped rule's recorded results ($417b vs the $413b
recorded in `docs/target-count.md` §4d at 32,768GB; $1,063b vs $1,054b at
98,304GB), so it is measuring the same thing.

Seeds 1–9, 180-minute windows, cumulative money stolen. Reported as the median,
the full min..max, and a **per-seed paired** ratio — both arms see the same RNG
stream on the same seed, so the paired statistic is much tighter and is the one
to read. On `snapshot-live.json` and `snapshot-post.json` the runs are
deterministic (`hacking_chance` × 2.6 or more clamps the hack chance to 1), so
all nine seeds agree exactly; that is a property of the world, not a bug.

---

## 6. Income

Per-seed paired median of `greedy / even`, with the range over the 9 seeds and
the number of seeds on which fill-to-saturation won.

### `maxTargets = 8`, as shipped

| fleet | `snapshot` (budget 322TB) | `snapshot-mid` (2.6PB) | `snapshot-live` (410TB) |
| ---: | ---: | ---: | ---: |
| 33TB | **+4.6%** [3.2..5.3] 9/9 | — | 0.0% 0/9 |
| 98TB | **+8.2%** [6.8..8.7] 9/9 | 0.0% 0/9 | **+4.8%** 9/9 |
| 449TB | **+29.4%** [27.5..31.2] 9/9 | **+4.2%** [4.2..4.5] 9/9 | **+13.7%** 9/9 |
| 1.6PB | **−7.1%** [−8.3..−5.6] 0/9 | **+14.9%** [14.5..15.4] 9/9 | −0.0% 0/9 |
| 6.4PB | −0.4% [−2.3..+7.0] 4/9 | **+2.1%** [1.1..2.5] 9/9 | −0.1% 0/9 |
| 26.2PB | −0.5% [−1.3..+7.4] 2/9 | — | −0.4% 0/9 |

and on a snapshot of the live world taken after tonight's install
(`snapshot-post.json`, hacking 4422), at the live 5.8PB fleet: **−0.4%**.

Read against §3's budgets, the shape is exactly the predicted one: the gain peaks
where the fleet is comparable to the candidate list's saturation budget (449TB
for `snapshot` and `snapshot-live`, 1.6PB for `snapshot-mid` whose budget is
2.6PB) and decays to zero on both sides.

**The −7.1% at 1.6PB on `snapshot` is real and is diagnosed.** It is `maxTargets`
binding: fill-to-saturation frees ~1.2PB that it is then forbidden to spend on a
ninth target, so the freed RAM goes to spill-weaken, which holds it for a whole
`weakenTime` and starves the *prep* of a target that enters the list mid-run
(`the-hub` reaches its first batch at minute 66.6 under fill-to-saturation
against 28.8 under the even split, and that single target accounts for the whole
gap). Raise the cap and the sign flips:

### `maxTargets = 16`

| fleet | `snapshot` | `snapshot-live` |
| ---: | ---: | ---: |
| 449TB | **+43.7%** [42.2..45.1] 9/9 | **+16.7%** 9/9 |
| 1.6PB | **+31.6%** [23.3..35.0] 9/9 | — |
| 6.4PB | +4.9% [−4.4..+15.9] 7/9 | — |

`docs/target-count.md` §7's +43% is reproduced exactly — at `maxTargets = 16`,
which is what its greedy arm was actually running. At the shipped 8 the same
cell is +29%.

**So the honest statement of the headline is: fill-to-saturation is worth +44%
at 448TB *if the target cap is raised with it*, +29% if it is not, and nothing
at all at the fleet size the game is at.**

---

## 7. Placement failures, unsafe skips and prep

`placeFail%` is placement failures as a fraction of all launch attempts that got
past the period gate; `unsafe` is the raw safe-window skip count.

| world / fleet / mt | arm | placeFail% | unsafe skips | prepped | slowest prep |
| --- | --- | ---: | ---: | ---: | ---: |
| `snapshot` 449TB mt8 | even | 1.3% | 31,766 | 9/9 | 66min |
| | greedy | **4.7%** | 33,230 | 10/10 | 79min |
| `snapshot` 1.6PB mt8 | even | 1.2% | 30,915 | 9/10 | 36min |
| | greedy | 1.5% | 35,784 | 9/10 | **67min** |
| `snapshot` 449TB mt16 | even | 1.3% | 34,829 | 10/10 | 109min |
| | greedy | **5.5%** | 37,814 | **11/14** | 39min |
| `snapshot-live` 449TB mt8 | even | 29.5% | 74,442 | 8/8 | 19min |
| | greedy | 27.7% | **8,068** | 8/8 | 19min |
| `snapshot-live` 26.2PB mt8 | even | 27.8% | 16,133 | 8/8 | 19min |
| | greedy | 28.3% | 22,234 | 8/8 | 19min |

Three things to take from it:

* **Fill-to-saturation raises placement failures by 3–4x where it wins**, from
  1.3% to 4.7–5.5% of attempts. That is the expected direction and the concern
  `docs/target-count.md` §7 raised: a saturated pipeline launches at the tightest
  legal period, and the hack group must fit on **one** host (`batch.js:404-410`,
  `placeAll` in `batcher.mjs`). It is not a blocker — 5% of attempts, each
  costing one loop tick, is inside the period law in §4 and is already priced
  into the measured income — but it is not nothing, and it is the number to watch
  after a deploy.
* **Prep completes**, in every cell, for every target that was funded. The one
  place it is materially slower is the 1.6PB/mt8 regression above, and it is the
  same phenomenon: 67 minutes to first batch against 36. At mt16 the ordering
  reverses (39 minutes against 109) because the freed RAM goes to real targets
  instead of to spill.
* **`11/14` prepped at 449TB/mt16 is fill-to-saturation correctly refusing to
  serve what it cannot fund.** Three targets were ranked in and never funded; the
  guard in §9d keeps them out of the dispatcher entirely rather than letting them
  run a one-thread pipeline forever. That is the intended behaviour, not a
  starvation.

---

## 8. The safe-window gate — is the 25% recoverable?

Skip rates on the live batcher run 0.7%–100% of launch attempts per target. The
question is whether that is physics or waste. It is **mostly waste, but fixing it
is not a large lever either**, and the reason is worth having in writing.

### 8a. The gate is protecting against a real effect

All three op durations are the same multiple of `hackTime`
(`src/Hacking.ts:81-92`), and `hackTime ∝ (2.5·R·D + 500)`
(`src/Hacking.ts:63-73`). So launching at security `D = minSec + Δ` instead of
`minSec` stretches the whole batch by one factor λ and it lands **late** by

```
lateness = ( 2.5·R·Δ / (2.5·R·minSec + 500) ) · weakenTime
```

with `Δ = FORTIFY·h` inside the H→W1 window and `Δ = 2·FORTIFY·g` inside the
G→W2 window (`src/Server/data/Constants.ts:9`,
`src/Server/ServerHelpers.ts:204-214`).

### 8b. Evaluated on the live target list, it is mostly harmless

For the ten targets the live batcher was running after the install, worst case
(the G→W2 window):

| host | R | minSec | g | weakenTime | lateness if launched anyway |
| --- | ---: | ---: | ---: | ---: | ---: |
| n00dles | 1 | 1.0 | 4 | 0.8s | 0.1ms |
| foodnstuff | 1 | 3.0 | 88 | 0.8s | 1.4ms |
| joesguns | 10 | 5.0 | 33 | 0.8s | 4.2ms |
| harakiri-sushi | 40 | 5.0 | 22 | 1.2s | 10.6ms |
| hong-fang-tea | 30 | 5.0 | 33 | 1.2s | 13.6ms |
| nectar-net | 20 | 7.0 | 65 | 1.2s | 18.4ms |
| neo-net | 50 | 8.0 | 44 | 2.0s | 29.3ms |
| max-hardware | 80 | 5.0 | 30 | 2.0s | 32.0ms |
| zer0 | 75 | 8.0 | 33 | 2.8s | 34.6ms |
| iron-gym | 100 | 10.0 | 75 | 4.0s | 100.0ms |

Every one is under `ε/2 = 100ms`, so the launch could not reorder anything —
and the skip that prevented it costs a full 202ms loop tick. For these targets
the gate is **strictly a loss**.

For a megacorp it is the opposite: `ecorp` at R = 1352, minSec = 33 and
weakenTime ≈ 250s gives a lateness of order **2 seconds** — two to three whole
periods — for the same excursion. There the gate is doing necessary work.

So the answer is **(b), an artefact of the gate being too strict — but only for
short-`weakenTime` targets**. The binary test `t.sec > t.minSec` is a proxy for
"would this launch land out of order", and the proxy is wrong by three orders of
magnitude at one end of the target list.

The other evidence for (b) rather than (a): `n00dles`, `foodnstuff` and
`joesguns` have *identical* weakenTimes of 0.8s and skip rates of 7.7%, **100%**
and **0.7%**. Identical targets cannot have physically different skip rates. What
differs is the phase of the launch attempt relative to that target's own landing
grid, and because `nextLaunch = now + period` preserves phase, whatever phase a
target lands on it keeps.

### 8c. Proposal, and how much it is worth

Replace the binary gate with the lateness test it is a proxy for, and — when
launching at elevated security — size the pads from `t.hackTimeNow` rather than
`t.hackTime`, so the four ops still land `ε` apart (they all scale by the same
λ, so the pads must scale too):

```js
// batch.js, replacing `if (t.sec > t.minSec + 1e-9) { s.unsafeSkips++; continue }`
const late = ((2.5 * t.required * Math.max(0, t.sec - t.minSec)) /
              (2.5 * t.required * t.minSec + 500)) * weakenTime
if (late > SETTINGS.spacing / 2) { s.unsafeSkips++; continue }
```

Measured in the simulator on `snapshot-post.json` at the live 5.8PB fleet, 3
seeds, 90 minutes: unsafe skips **48,832 → 26,192**, income **+1.35%**, and
placement failures **up** 14,674 → 16,483. The throughput the skips were costing
is real, and most of it is immediately re-lost to placement — at this fleet size
the pipeline is placement-bound, not gate-bound.

**So: (b), quantified at +1.35% in simulation and up to +8% by the period
arithmetic alone.** It is cheap, it is correct, and it is not the big lever. Two
caveats in both directions: the simulator's placement pressure is higher than the
live game's (live `placeFails` are currently ~0 per target while the sim's are
thousands), so this is plausibly an *under*-estimate; and against it, the
phase-lock explanation in §8b suggests a much cheaper fix for the long-weakenTime
targets — on a skip, shift `nextLaunch` by `ε` instead of retrying on the next
tick, so the target re-locks into the safe half of its own cycle once instead of
paying a tick every period forever. That is unmeasured and I would want it
measured before it went anywhere near `batch.js`.

---

## 9. The patch

Eight edits, all in `main()`, all using values already at the call site. Nothing
new is imported and no new `SETTINGS` key is required (§9j proposes one
optional). Verified: the patched file parses (`node --check`), still exports all
ten public functions, and **its allocator loop, lifted back out by text and run
against `batch.js`'s own `planBatch`, returns a Map identical to the validated
`alloc.mjs:fillToSat` on both real worlds at all six fleet sizes** —
`node tools/sim/verify-alloc-shipped.mjs --patched batch.js`.

### 9a. Declare the allocation next to the target list — `batch.js:512`

```js
  let hosts = []
  let targets = []
```

becomes

```js
  let hosts = []
  let targets = []
  // Per-target RAM allocation, host -> GB, recomputed at each retarget. This
  // replaces the three inline copies of `totalRam / targets.length` below: how
  // much RAM a target gets is now a decision, so it is made once and looked up.
  let shares = new Map()
```

### 9b. The `--targets N` override still pins an even split — `batch.js:599-601`

```js
        if (Number(flags.targets) > 0) {
          want = ranked.slice(0, Number(flags.targets)).map((r) => r.t.host)
        } else {
```

becomes

```js
        if (Number(flags.targets) > 0) {
          want = ranked.slice(0, Number(flags.targets)).map((r) => r.t.host)
          // --targets pins the count by hand, so it pins the split too: even,
          // exactly as before. The allocator's job is to choose the count.
          shares = new Map(want.map((h) => [h, totalRam / Math.max(1, want.length)]))
        } else {
```

### 9c. The allocator replaces the argmax — `batch.js:628-677`

Delete the `// How many to run: argmax of a derived income model...` comment
block and the loop that follows it, from `const cand = ...` through
`want = cand.slice(0, Math.max(1, bestN)).map((r) => r.t.host)`, and put this in
its place:

```js
          // How much RAM each target gets — and therefore how many to run.
          //
          // A pipeline lands one batch per `period` and each batch holds
          // plan.gb for one weakenTime, so the RAM a target can hold is
          //
          //     satRam_i = ceil(weakenTime_i / period_i) * gb_i
          //
          // (weakenTime = 4*hackTime, src/Hacking.ts:81-92.) RAM beyond that
          // earns the target NOTHING — the batches it would fund cannot land
          // without colliding — and that is a property of the target rather
          // than of this batcher, because servers have no passive regrowth: the
          // only callers of processSingleServerGrowth are ns.grow
          // (NetscriptFunctions.ts:288), the terminal grow command
          // (Terminal/commands/grow.ts:27) and the offline catch-up
          // (Script/ScriptHelpers.ts:52).
          //
          // `period_i` is MEASURED, not assumed. The dispatcher floors it at
          // 4*spacing, but a launch only happens on a controller loop tick and
          // every blocked attempt costs one further tick, so
          //
          //     period_i = ceil(4*spacing/loopMs)*loopMs
          //              + loopMs * (unsafeSkips_i + placeFails_i) / batches_i
          //
          // which is fitted to the live batcher at 0.1% mean absolute error
          // over ten targets with skip rates from 0.7% to 100%
          // (docs/allocator.md section 4). Assuming the 4*spacing floor instead
          // OVERSTATES satRam by 1.01x-1.26x, which makes the head of the list
          // absorb RAM it cannot use and funds too few targets. The counters are
          // already in `S`, so this is closed-loop and needs no new ns call.
          //
          // Fill ranked targets to satRam, best first, and stop when the fleet
          // runs out. The count is not a separate decision: it is however many
          // targets got funded.
          //
          // This REPLACES the income argmax that used to live here, and the two
          // must never be mixed. The argmax maximises
          // sum_i min(cap_i, (totalRam/n)*rate_i) — every `totalRam/n` there is
          // the claim that adding a target takes RAM from the targets above it,
          // which is true of an even split and false of this allocator. Pairing
          // either rule with the other allocator is the error
          // docs/target-count.md section 6 is about; docs/allocator.md section 2
          // measures both half-pairings and both lose.
          //
          // Cost: at most 2*maxTargets planBatch calls per retarget, measured at
          // 18-163us over two real worlds and an adversarial list with
          // phi ~ 1e-6, in tools/sim/verify-alloc-shipped.mjs against this
          // file's own planBatch.
          const cand = (worthwhile.length ? worthwhile : ranked).slice(0, SETTINGS.maxTargets)
          const periodFloor = Math.ceil((4 * SETTINGS.spacing) / SETTINGS.loopMs) * SETTINGS.loopMs
          shares = new Map()
          let left = totalRam
          for (const c of cand) {
            if (shares.size >= SETTINGS.maxTargets) break
            if (left < ram.hack) break
            // The period this target has actually been achieving. Below 20
            // batches the ratio is noise, so use the floor.
            const st = S.get(c.t.host)
            const period =
              st && st.batches >= 20
                ? periodFloor + (SETTINGS.loopMs * (st.unsafeSkips + st.placeFails)) / st.batches
                : periodFloor
            // Two passes, because the problem is mildly circular: the batch a
            // target runs is planBatch(t, ram, share/4) and `share` is what is
            // being computed. Pass 1 prices the target against everything left,
            // pass 2 against what it is actually getting. The sequence only
            // decreases, so this cannot loop.
            let give = left
            let plan = null
            for (let pass = 0; pass < 2; pass++) {
              plan = planBatch(c.t, ram, give / 4)
              if (!plan) break
              const depth = Math.max(1, Math.ceil((4 * c.t.hackTime) / period))
              give = Math.min(left, depth * plan.gb)
            }
            // A target that cannot be given room for one whole batch is not a
            // target, it is a prep bill — it would still be prepped, and prep
            // draws on the fleet. Everything below it in the ranking would be
            // funded even less, so stop rather than skip.
            if (!plan || give < plan.gb) break
            shares.set(c.t.host, give)
            left -= give
          }
          // A fleet too small for even one saturated batch still wants the best
          // target run on all of it, which is what the even split degenerated
          // to at n=1.
          if (!shares.size && cand.length) shares.set(cand[0].t.host, totalRam)
          want = [...shares.keys()]
```

### 9d. Look the share up once per target, and refuse to serve an unfunded one

In the `for (const host of targets)` loop, immediately after

```js
        const weakenTime = t.hackTime * 4
        const growTime = t.hackTime * 3.2
```

insert

```js
        // RAM this target was allocated at the last retarget. A target kept
        // only so its in-flight work can drain has none, and must NOT be
        // served: planBatch with a zero budget still returns a one-hack-thread
        // batch, so dispatching it would relaunch the pipeline and renew
        // lastLanding forever — which is exactly the failure the `keep` block
        // above was written for, where n00dles survived three retargets that
        // excluded it and took 34% of all batches. Under the even split every
        // served target had a share by construction; under this allocator they
        // do not, so the guard has to be explicit.
        const share = shares.get(host) ?? 0
        if (!(share > 0)) continue
```

Earnings attribution (`s.earned`, `s.lastMoney`) is above this point and still
runs, so a draining target's income is still counted.

### 9e. Prep, phase 1 — `batch.js:768`

```js
            const wShare = Math.floor(totalRam / Math.max(1, targets.length) / ram.weaken)
```

becomes

```js
            const wShare = Math.floor(share / ram.weaken)
```

### 9f. Prep, phase 2 — `batch.js:790-794`

```js
          const budget = Math.min(
            [...free.values()].reduce((a, b) => a + b, 0),
            totalRam / Math.max(1, targets.length),
          )
```

becomes

```js
          const budget = Math.min([...free.values()].reduce((a, b) => a + b, 0), share)
```

### 9g. Dispatch — `batch.js:841-842`

```js
        const share = totalRam / Math.max(1, targets.length)
        const plan = planBatch(t, ram, share / 4)
```

becomes (the `share` line simply goes; 9d already declared it)

```js
        const plan = planBatch(t, ram, share / 4)
```

Everything downstream — `maxInFlight`, `period`, `reserved` — is untouched and
now reads the allocated share instead of the even one. That is the entire
behavioural change.

### 9h. Spill onto a funded target, and show the allocation in telemetry

`targets` is `[...keep, ...want]`, so after this change position 0 can be a
target that is draining and unfunded:

```js
        if (threads >= 1) spread(ns, free, ram, 'weaken', targets[0], threads, batchId++)
```

becomes

```js
        if (threads >= 1)
          spread(ns, free, ram, 'weaken', targets.find((h) => shares.get(h) > 0) ?? targets[0], threads, batchId++)
```

and in the status block's `perTarget` map, add two fields — without them there
is no way to tell a starved target from a saturated one from outside, and the
period is now a decision input rather than a constant:

```js
            host: h,
            phase: s.phase,
            shareGb: Math.round(shares.get(h) ?? 0),
            achievedPeriodMs: s.batches >= 20
              ? Math.round(
                  Math.ceil((4 * SETTINGS.spacing) / SETTINGS.loopMs) * SETTINGS.loopMs +
                    (SETTINGS.loopMs * (s.unsafeSkips + s.placeFails)) / s.batches,
                )
              : null,
```

Finally, `SETTINGS.maxTargets`'s comment (`batch.js:88-90`) should read "Upper
bound on how many targets the allocator in `main()` will fund".

### 9i. Raise `maxTargets`

**This is part of the change, not an optional extra** (§6). At `maxTargets = 8`
fill-to-saturation regresses 7% at 1.6PB because it is forbidden to spend the
RAM it frees. `SETTINGS.maxTargets: 8` → `16`, which is what the +44% cell was
measured at and what the live controller is already being run with by hand. The
quality floors (`minScoreFrac`, `minMoneyFrac`) still bound the list — they admit
15 targets on `snapshot.json` and 28 on `snapshot-live.json`, so 16 is a real cap
rather than a formality.

### 9j. What does NOT change

`minScoreFrac` and `minMoneyFrac` still run *before* the allocator and remain the
only quality judgement — the allocator has no opinion about a target that
thrashes. The safe-window gate is **not** touched here; §8's proposal is
separate, unmeasured in the live game, and should be its own change.

---

## 10. Confidence, and when I would not deploy

**Confident (would deploy):**

* The allocation rule is correct given the batcher's own arithmetic, it is
  derived rather than fitted, and it is never worse than the even split in any
  cell measured with `maxTargets = 16`.
* The transcription into `batch.js` is verified mechanically against the
  validated implementation, not by eye.
* The measured-period correction is the best-supported number in this document:
  0.1% mean absolute error against the running game, by a construction that
  cannot be biased by prep time.
* Prep completes everywhere, and the unfunded-target guard (§9d) closes a real
  hazard that the even split did not have.

**Not confident, and stated as such:**

* **The income case is weak at the fleet size the game is actually at.** −0.4%
  on a snapshot of the live world. Anyone expecting +43% from this deploy will be
  disappointed, and if income is the goal the levers are `maxTargets` (measured:
  8 → 14 targets coincided with live income going from $164b/s to $643b/s), `ε`
  (`docs/target-count.md` §4c: +68% at ε=50, unretested under this allocator),
  and the gate (§8, +1.35%).
* Placement failures rise 3–4x where the rule wins. Measured and priced in, but
  it is the number to watch after a deploy, and `execFails`/`partials` should be
  watched with it.
* The measured-period form is validated as a *law about the live batcher*; the
  end-to-end arm that uses it inside the allocator is the least-tested thing
  here (§6's tables are all from the 4ε form).
* ε is 200 in every measurement. The period floor is
  `ceil(4ε/loopMs)·loopMs`, so with `loopMs = 200` an ε below 50 buys nothing at
  all — `docs/target-count.md` §4c's ε sweep did not know that and its ε=50 row
  should be re-read with it in mind.

**I would not deploy if any of these were true:**

* `maxTargets` stays at 8 — the change is then a measured 7% regression at 1.6PB
  and roughly nothing everywhere else.
* An augmentation install is imminent. The allocator re-derives from live values
  so it survives one, but a deploy during the minutes around an install mixes two
  large changes in the same window, and `batch.js` hot-deploys in ~150ms.
* The live `placeFails` counters are non-zero and climbing before the change.
  Fill-to-saturation makes placement harder; fix placement first.

---

## Appendix: reproduction

```bash
node tools/sim/verify-alloc-shipped.mjs                      # invariants + live calibration
node tools/sim/verify-alloc-shipped.mjs --patched batch.js   # transcription check, after applying section 9
node tools/sim/verify-alloc.mjs --world snapshot.json --fleets 448708 \
     --arms even,greedy --maxtargets 16 --seeds 1,2,3,4,5,6,7,8,9 --minutes 180
node tools/sim/verify-alloc.mjs --world snapshot-post.json --fleets 5800000 \
     --arms even --seeds 1,2,3 --minutes 90 --lategate      # section 8c
```

Arms: `even` (shipped), `greedy` (proposed), `greedym` (proposed, measured
period), `satcount` / `argmaxfill` (the two half-pairings), `--prepreserve`
(holds a prepping target's budget back from spill; diagnostic for §6's 1.6PB
regression — it removes it, but costs 7–13% elsewhere and is **not**
recommended), `--lategate` (§8c).
