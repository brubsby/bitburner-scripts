# How many targets should the batcher run?

`batch.js` has to turn a fleet RAM budget into a target count. It currently uses
a measured constant — `round(totalRam / 32768)`, capped at 8 — fitted to three
points from a simulator sweep (`docs/optimizer-log.md` section 17):

| fleet | measured best count | 1 target | best | 8 targets |
| ---: | ---: | ---: | ---: | ---: |
| 32,768GB | **1** | $422b | $422b | $225b |
| 98,304GB | **3** | $503b | $1,049b | $773b |
| 448,708GB | **8** | $1,151b | $2,795b | $2,795b |

An analytic replacement derived from `docs/prior-art.md` §9h was tried and
rejected: it predicted 3 / 5 / 5. This document derives a model that answers
1 / 3 / 7 on the world as the measurement starts — the first two exact, the
third within 1.6% of the measured optimum of 8, and equal to 8 once the run's
hacking level passes 321, which it does inside the first 20 minutes. It is then
validated on four further fleet sizes, on a second and independent axis (the
separation constant ε), and end to end as a live rule; §5 says exactly what
`batch.js` should compute.

**Result: validated.** The optimal count is the argmax of a two-line income
model. The previous attempt failed for two separable reasons — a synthetic
world, and a saturation rule that solves the allocation problem this batcher
does not have — and neither of the two mechanisms suspected of causing it
(the unconstrained `planBatch`, desync bounding the pipeline) contributed
anything (§6).

Replacing the constant is a **correctness** win rather than an income win: on
the fleet axis the two are within a few percent of each other (§4e), because
that is the axis the constant was fitted on. What the model buys is a rule that
is still right off that axis — at a different ε, a different hacking level, a
different target list — and that can be argued with instead of re-measured.

It also turned up something larger than the count: the even split the
dispatcher performs is itself worth **+43%** at the current fleet size if
replaced with the fill-to-saturation allocation prior-art §9h actually
recommended (§7). That result is newer and thinner than the count model and
should not be shipped on the strength of this document alone.

Everything below was measured with the repo's offline simulator, which runs the
game's own formulas (`tools/sim/game.mjs` re-exports them out of a bundle of
`~/Repos/bitburner`). New files:

- `tools/sim/target-count.mjs` — the model, plus the per-target economics table.
- `tools/sim/target-count-sweep.mjs` — measures earnings vs target count at an
  arbitrary pinned fleet size. Reproduces section 17's numbers to the dollar.
- `tools/sim/target-count-alloc.mjs` — the allocator experiment in §7.

---

## 1. The model

For each candidate target `i`, with one batch's plan from `planBatch`:

```
rate_i   = money_i / (ram_i · weakenTime_i)      money per GB per ms of RAM held
cap_i    = money_i / (4ε)                        the target's throughput ceiling
satRam_i = cap_i / rate_i = ram_i·weakenTime_i/(4ε)
```

and, because the dispatcher gives every chosen target an **equal share** of the
fleet,

```
                n
income(n)  =   Σ   min( cap_i , rate_i · totalRam/n )
               i=1

n* = argmax income(n),  n ≤ maxTargets
```

That is the whole model. `money_i` is `planBatch(...).money` (which already
carries the hack chance), `ram_i` is `.gb`, `weakenTime_i` is `4·hackTime`, and
ε is `SETTINGS.spacing`.

## 2. Why that is the right shape: read the dispatcher, not the theory

The shape of the model is forced by what the code does, and the single most
important fact is one line in `batch.js:788`:

```js
const share = totalRam / Math.max(1, targets.length)
const plan = planBatch(t, ram, share / 4)
const maxInFlight = Math.max(1, Math.floor(share / plan.gb))
const period = Math.max(4 * SETTINGS.spacing, weakenTime / maxInFlight)
```

`tools/sim/batcher.mjs:428-435` is identical. So:

- **The fleet is split evenly**, not filled greedily. Every chosen target gets
  `totalRam/n` whether it can use it or not.
- A target's income is `money / period`, and substituting `period` gives exactly
  `min(cap, rate·share)` — the piecewise-linear in §1. The `floor()` and the
  `share/4` batch-size cap are second-order; §5 keeps them anyway.

The two regimes, and why they produce an interior optimum:

- **Unsaturated** (`share < satRam_i`): `income(n) = (totalRam/n)·Σrate_i =
  totalRam · mean(rate_1…rate_n)`. Targets are ranked best-first, so the mean
  falls with every target added. **With nothing saturated, one target is
  optimal — and any split is a straight loss.** That is the 32TB row, and it is
  not a subtlety: eight targets earn *half* what one does.
- **Saturated** (`share ≥ satRam_i`): that target's term stops growing, so the
  RAM given to it above `satRam_i` earns nothing and the next target's `rate` —
  however much worse — beats it. Adding a target now pays.

So the count rises exactly as saturation propagates down the ranked list, and
the optimum is where the marginal target's income stops covering what the split
costs the targets above it.

### Where each quantity comes from in the game source

| quantity | source |
| --- | --- |
| `weakenTime = 4·hackTime`, `growTime = 3.2·hackTime` | `src/Hacking.ts:83-94` |
| `hackTime = 5·(2.5·R·D + 500)/(L+50)/mults` | `src/Hacking.ts:60-79` |
| money taken = `moneyAvailable · percentHacked · threads` | `src/Netscript/NetscriptHelpers.tsx:629` |
| `percentHacked` per thread | `src/Hacking.ts:44-57` |
| hack fortifies by `0.002·min(threads, maxThreadNeeded)` | `NetscriptHelpers.tsx:667`, `src/Server/data/Constants.ts:9` |
| grow fortifies by `2·0.002·usedCycles`, capped at threads | `src/Server/ServerHelpers.ts:210-213` |
| weaken removes `0.05` per thread (× core bonus) | `src/Server/data/Constants.ts:10`, `ServerHelpers.ts:315-323` |
| `additionalMsec` is added *after* the duration is computed | `src/NetscriptFunctions.ts:273,345`, `NetscriptHelpers.tsx:598` |
| nothing grows a server except a `grow` call | only callers of `processSingleServerGrowth` are `NetscriptFunctions.ts:288`, `Terminal/commands/grow.ts:27`, `Script/ScriptHelpers.ts:52` (offline catch-up) |

The last row is why the cap is real rather than a modelling convenience: a
server has no passive regrowth, so a target's money throughput is bounded by
what one batch can take divided by how often a batch may land, and batches may
not land closer than `4ε` without colliding.

## 3. The per-target numbers (live world, hacking 295)

`node tools/sim/target-count.mjs --table`, from `tools/sim/snapshot.json`:

| host | h | g | batch GB | weakenTime | f | $/batch | satRam GB | cap $/s | rate $/GB/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| phantasy | 34 | 83 | 224 | 130.4s | 0.088 | $39.4m | 36,530 | $49.2m | 1347.6 |
| omega-net | 45 | 40 | 161 | 278.3s | 0.047 | $43.4m | 55,826 | $54.2m | 971.5 |
| silver-helix | 45 | 108 | 290 | 246.4s | 0.084 | $60.0m | 89,312 | $75.0m | 839.6 |
| max-hardware | 20 | 63 | 160 | 87.0s | 0.058 | $11.6m | 17,391 | $14.5m | 836.2 |
| harakiri-sushi | 34 | 98 | 252 | 58.0s | 0.117 | $10.2m | 18,264 | $12.8m | 700.5 |
| zer0 | 34 | 82 | 222 | 115.9s | 0.098 | $14.4m | 32,217 | $18.0m | 558.5 |
| iron-gym | 26 | 124 | 287 | 173.9s | 0.065 | $23.5m | 62,489 | $29.4m | 470.2 |
| joesguns | 15 | 94 | 211 | 36.2s | 0.058 | $3.4m | 9,556 | $4.2m | 438.4 |
| nectar-net | 20 | 96 | 223 | 49.3s | 0.073 | $4.5m | 13,736 | $5.6m | 405.6 |
| neo-net | 20 | 84 | 200 | 87.0s | 0.064 | $6.6m | 21,766 | $8.3m | 381.3 |
| hong-fang-tea | 15 | 87 | 197 | 50.7s | 0.054 | $3.6m | 12,491 | $4.5m | 359.6 |
| johnson-ortho | 224 | 65 | 526 | 507.2s | 0.058 | $47.8m | 333,546 | $59.7m | 179.0 |

Two things to read off it:

1. **Saturation RAM is tens of TB per target, not ~3TB.** `phantasy` alone
   absorbs 36.5TB before it saturates. This is the scale the 32TB row is
   telling us about: at 32TB *nothing has saturated yet*, so splitting is pure
   loss.
2. **`satRam` varies by 35x across the list** (9.5TB for joesguns, 334TB for
   johnson-ortho), driven almost entirely by `weakenTime`. Any "RAM per target"
   constant is an average over a distribution this wide, which is why it went
   stale a decade of fleet size later.

---

## 4. Validation

### 4a. Method

`tools/sim/target-count-sweep.mjs` runs the simulated batcher
(`tools/sim/batcher.mjs`, the same code section 17 measured) with the target
count pinned, on the live-save world (`tools/sim/snapshot.json`, hacking 295,
448,708GB), with the fleet pinned to an exact total by `atTotalRam` — the same
wrapper the registry arms use. 180-minute windows, **median of 3 seeds**, scored
on cumulative money stolen.

The harness reproduces section 17's recorded numbers: 32,768GB/1 target
**$422b** (recorded $422b), 98,304GB/1 **$503b** (recorded $503b), 98,304GB/3
**$1,049b** (recorded $1,049b), 448,708GB/1 **$1,157b** (recorded $1,151b — the
small difference is `atTotalRam` rebuying the cloud fleet as power-of-two chunks
rather than using the save's own servers). So it is measuring the same thing
section 17 measured.

### 4b. The fleet axis: seven sizes, model vs measurement

Each cell is earnings as a percentage of that fleet's best measured arm. **M** is
the model's curve (evaluated on the world as it stands at the start of the
window, hacking 295); **sim** is the measurement.

| fleet | | n=1 | n=2 | n=3 | n=4 | n=5 | n=6 | n=8 | n=10 | n=12 | best |
| ---: | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 16,384 | M | **100** | 86 | 78 | 74 | 70 | 65 | 57 | 52 | 46 | **1** |
| | sim | **100** | 77 | 64 | 62 | 60 | 55 | 40 | 34 | 29 | **1** |
| 32,768 | M | **100** | 86 | 78 | 74 | 70 | 65 | 57 | 52 | 46 | **1** |
| | sim | **100** | 91 | 82 | 79 | 75 | 71 | 53 | 47 | 45 | **1** |
| 65,536 | M | 65 | **100** | 91 | 86 | 81 | 76 | 66 | 60 | 54 | **2** |
| | sim | 69 | **100** | 95 | 93 | 86 | 78 | 66 | 59 | 56 | **2** |
| 98,304 | M | 48 | 94 | **100** | 89 | 86 | 83 | 72 | 66 | 59 | **3** |
| | sim | 48 | 94 | **100** | 97 | 87 | 84 | 74 | 68 | 66 | **3** |
| 200,704 | M | 31 | 65 | **100** | 97 | 94 | 95 | 86 | 81 | 75 | **3** |
| | sim | 54 | 75 | **100** | 98 | 90 | 96 | 93 | 88 | 86 | **3** |
| 300,000 | M | 26 | 54 | 93 | 94 | 94 | 96 | 96 | 89 | 83 | **7** (100) |
| | sim | 49 | 58 | 88 | 95 | 94 | 99 | **100** | 95 | 95 | **8** |
| 448,708 | M | 21 | 45 | 77 | 83 | 89 | 91 | 98 | 93 | 90 | **7** (100) |
| | sim | 40 | 42 | 75 | 87 | 92 | 95 | **100** | 94 | 95 | **8** |

Five of seven argmaxes are exact. The two that differ do so by one target, at a
place where the measured curve is flat: the model's choice of 7 earns 98.4% of
the measured best at 448,708GB ($2,857b vs $2,903b, same seeds), and at
300,000GB n=7 was not run but sits between the measured n=6 (99%) and n=8
(100%). **Choosing the count from the model costs at most 2% against an
oracle that knows the answer**, across a 27x range of fleet size.

The residual is systematic and explained: the model under-prices low target
counts. It evaluates the world at one instant, and a 180-minute run does not
stay there — the spill-weaken path (`batch.js:859`, `batcher.mjs:317`) dumps
otherwise-idle RAM into weaken for the experience, so the *most concentrated*
configurations, which have the most idle RAM, level up fastest. A level-up
raises `phi` and shortens `weakenTime`, which raises `cap` and lowers `satRam`.
At 448,708GB the run's hacking level goes 295 → 403. Re-evaluating the model at
the level the run actually spends its time at moves its answer to 8 or 9:

| model evaluated at level | 32,768 | 98,304 | 448,708 |
| --- | ---: | ---: | ---: |
| 295 (window start) | 1 | 3 | 7 |
| 308 | 2 | 3 | 7 |
| 321 | 1 | 3 | **8** |
| 337 | 1 | 3 | 9 |
| 350 | 2 | 3 | 9 |

so the measured answers (1 / 3 / 8) sit inside the range the model spans over
the run. This is a property of the *measurement* (a 180-minute window with a
pinned count) rather than of the deployed script, which re-derives the count
every 30 seconds from the live world.

### 4c. The ε axis: an independent prediction, and one the shipped constant cannot make

The fleet axis is where `ramPerTarget = 32768` was fitted, so agreeing with it
there is weak evidence. The separation constant is an independent axis: ε enters
only through `cap = money/(4ε)`, so **halving ε doubles every target's ceiling
and halves its saturation RAM**, and the model's answer must move a long way.

At 98,304GB with ε=500 (up from 200) the model predicts the optimum moves from
3 to a plateau spanning 3-7:

| n | 1 | 2 | 3 | 5 | 7 | 9 | 12 |
| --- | --: | --: | --: | --: | --: | --: | --: |
| model % | 28 | 60 | **100** | 96 | **100** | 88 | 80 |
| measured % | 39 | 72 | **100** | 95 | 96 | 90 | 87 |

The model's two joint-best counts (3 and 7, 0.3% apart) bracket the measured
argmax of 3, and the whole plateau is reproduced — compare the same fleet at
ε=200, where the measured curve falls to 74% by n=8. The model tracks ε; a
RAM-per-target constant cannot see it at all.

At 448,708GB with ε=50 (down from 200) the model predicts the optimum collapses
from 8 to 3 — a four-fold change in the answer with the fleet held fixed:

| n | 1 | 2 | 3 | 4 | 6 | 8 |
| --- | --: | --: | --: | --: | --: | --: |
| model % | 42 | 88 | **100** | 88 | 83 | 72 |
| measured % | 81 | 89 | 94 | **100** | 96 | 90 |

The optimum did move, by exactly the predicted amount and direction: from 8 at
ε=200 to 3-4 at ε=50. The model's 3 earns 94% of the measured best; the shipped
`ramPerTarget` rule, which cannot see ε at all, still says 8 and earns 90%.

Two asides worth recording:

- **The model's argmax is a lower bound on the measured one.** In every
  disagreement so far it is short by exactly one (7 vs 8 twice, 3 vs 4 here),
  never long, and §4b gives the reason: the model prices the world at one
  instant and the higher-income arms level up faster during the window, which
  shrinks `satRam` and admits another target. Do not "fix" this with a fudge
  factor — in `batch.js` the re-derivation happens every 30s at the live level
  and the bias does not arise.
- **ε=50 earns $4,883b against ε=200's $2,903b on the same fleet** — +68%,
  which dwarfs every target-count effect measured here. `SETTINGS.spacing = 200`
  is the bigger lever, and prior-art §9g already argues the 200ms justification
  is a non-sequitur. Out of scope for this document, but it should not stay
  unexamined.

### 4d. The rule end to end

The tables above score the model's *curve*. The deliverable is a rule that has
to choose for itself, every 30 seconds, while the world moves. `--rule` in the
sweep harness runs exactly §5's loop inside the batcher's `chooseTargets` and
scores it against the best pinned count:

| fleet | rule | best pinned | vs best |
| ---: | ---: | ---: | ---: |
| 16,384 | $235b | $235b (n=1) | **100%** |
| 32,768 | $413b | $422b (n=1) | 98% |
| 65,536 | $727b | $762b (n=2) | 95% |
| 98,304 | $1,054b | $1,049b (n=3) | **100.4%** |
| 200,704 | $1,578b | $1,653b (n=3) | 95% |
| 300,000 | $2,166b | $2,108b (n=8) | **102.8%** |
| 448,708 | $2,896b | $2,903b (n=8) | **99.8%** |

It beats every fixed count at 98,304GB and 300,000GB — adapting mid-run is
worth more than picking the best constant — and loses 2-5% at 32,768GB and
65,536GB, where it changes its mind as the level rises. That is the hysteresis note in §8: the curves are flat near the
optimum, so switching is nearly free in modelled income and is not free in prep.

### 4e. Honest bottom line: this is a correctness win, not an income win

Against the shipped constant, on the axis the constant was fitted to, there is
almost nothing in it:

| fleet | `round(ram/32768)`, capped 8 | earns | model rule earns |
| ---: | ---: | ---: | ---: |
| 16,384 | 1 | 100% | 100% |
| 32,768 | 1 | 100% | 98% |
| 65,536 | 2 | 100% | 95% |
| 98,304 | 3 | 100% | 100.4% |
| 200,704 | 6 | 95.5% | 95% |
| 300,000 | 8 (capped from 9) | 100% | 102.8% |
| 448,708 | 8 (capped from 14) | 100% | 99.8% |

The constant is *good* between 16TB and 448TB, which is unsurprising: it was
fitted there, and above ~260TB the cap does the work rather than the ratio. The
case for replacing it is not the next percent of income, it is:

- **It is already saturated.** At 448,708GB the ratio asks for 14 and the cap
  returns 8. Every further doubling of the fleet is answered by the same number,
  so the next time the answer is genuinely different nothing will notice —
  exactly the failure section 17 documented when a 3-target ladder fitted at
  4-32TB was still being applied at 448TB.
- **It is blind to everything except RAM.** At ε=50 the right answer is 3-4 and
  the constant still says 8, for a measured 10% loss (§4c). The same blindness
  applies to the hacking level, to the multipliers after an augmentation
  install, and to a world whose target list is shaped differently.
- **It cannot be checked.** A constant has no derivation to disagree with, so
  the only way to learn it has gone stale is to re-run the sweep — which is what
  happened, twice.


---

## 5. What to put in `batch.js`

Everything the model needs is already at the call site. `worthwhile` is the
score-ranked, quality-floored list (each entry `{t, s}`); `ram` holds the worker
costs; `totalRam` is summed a few lines above; `t.hackTime` is the prepped-server
hack time, so `weakenTime = 4·t.hackTime` (`src/Hacking.ts:90-94`). Replace

```js
const wanted = Math.round(totalRam / SETTINGS.ramPerTarget)
```

with the argmax:

```js
// How many targets to run.
//
// A target's income is `plan.money / period`, and the dispatcher below sets
// `period = max(4e, weakenTime / floor(share/plan.gb))` with `share =
// totalRam/n` — an EVEN split. Substituting gives a piecewise-linear:
//
//     income_i(share) = min( money_i/(4e),  share * money_i/(gb_i * 4*hackTime_i) )
//
// linear in RAM until the pipeline is full at the tightest legal period, flat
// afterwards. Two consequences, both measured (docs/target-count.md):
//
//   * While nothing is saturated, income(n) = totalRam * mean(rate_1..rate_n)
//     and the mean falls with every target added, so ONE target is optimal and
//     any split is a straight loss. At 32TB eight targets earn half of one.
//   * Once the head of the list saturates, its share earns nothing at the
//     margin and the next target — however much worse — beats it.
//
// So take the argmax rather than a RAM-per-target constant: satRam spans 35x
// across the real target list (9.5TB to 334TB), so no single constant can be
// right at both ends of it.
const cand = worthwhile.slice(0, SETTINGS.maxTargets)
let bestN = 1
let bestInc = -1
for (let n = 1; n <= cand.length; n++) {
  const share = totalRam / n
  let inc = 0
  for (let i = 0; i < n; i++) {
    const p = planBatch(cand[i].t, ram, share / 4)
    if (!p) continue
    inc += Math.min(p.money / (4 * SETTINGS.spacing), (share * p.money) / (p.gb * cand[i].t.hackTime * 4))
  }
  if (inc > bestInc) {
    bestInc = inc
    bestN = n
  }
}
want = cand.slice(0, bestN).map((r) => r.t.host)
```

Notes for the implementation:

- `SETTINGS.ramPerTarget` disappears. `maxTargets` stays, but only as a bound on
  the loop; it stops being the thing that binds. `minScoreFrac` stays and should
  keep being applied *before* this (the model has no opinion about a target that
  thrashes; the quality floor does).
- Cost is at most `maxTargets·(maxTargets+1)/2 = 36` `planBatch` calls per
  retarget (every 30s), each a ~20-step ladder. If that ever matters, memoise
  the plan per target: the `share/4` cap does not bind above ~4TB of fleet, so
  one plan per target is the same answer.
- `share / 4` is the same expression the dispatcher uses at `batch.js:789`
  (`minInFlight`). Keep the two in step — if one changes and the other does not,
  the count is chosen for a batch size that is never dispatched.
- It re-derives from live values every retarget, so it tracks the hacking level,
  the multipliers after an install, new rooted targets and fleet growth with no
  recalibration. That is the actual point: `ramPerTarget` was fitted at 4-32TB
  and was still being applied at 448TB.

---

## 6. Why the previous attempt failed

The rejected implementation was

```js
saturationRam(t) = planBatch(t, ram, Infinity).gb * floor(weakenTime / (4*spacing))
// take ranked targets until the summed saturation covers totalRam
```

and it predicted 3 / 5 / 5 against a measured 1 / 3 / 8. Four things are worth
separating — two that went wrong, and two that were suspected and did not —
because the post-mortem left in `batch.js` names none of them.

### 6a. The world was synthetic — and that alone produced "wrong in both directions"

Run the *same rejected formula* against the real snapshot world and it predicts
**1 / 3 / 12**, not 3 / 5 / 5 (`tools/sim/target-count.mjs` prints it next to
the model's answer). It is exactly right at 32TB and 98TB.

So the "3 at 32TB" and the "5 at 448TB" were both artefacts of the made-up
servers: their `satRam` came out several times too small (predicting a split
where the real `phantasy` alone absorbs 36.5TB), and the made-up list ran out of
entries before the cumulative sum reached 448TB, which is what produced a "5"
that looks like an under-prediction but is really list exhaustion.

The conclusion drawn from that — *"wrong in BOTH directions, so the shape is
wrong and not merely the scale"* — does not survive contact with the real world
data. It is the same failure the repo has recorded three times already
(`CLAUDE.md`, "Fidelity"): a plausible substitute for the real inputs silently
deciding the measurement. **A model of target selection cannot be tested on
invented targets, because the answer is a property of the target *distribution*
— `satRam` spans 35x across the real list.**

### 6b. The formula solves the allocation problem the batcher does not have

This is the real modelling error, and it is the one the doc section
(`prior-art.md` §9h) actually contains. "Take ranked targets until the summed
saturation covers the fleet" is the optimum of a **fractional knapsack with
capacities** — fill the best target to its cap, spill the surplus to the next.
That is the correct count *if the batcher allocates that way*. It does not: both
`batch.js:788` and `batcher.mjs:428` hand every chosen target `totalRam / n`.

Under an even split, a target that cannot use its share does not hand the
surplus back — it wastes it, **and it has taken that RAM from the better targets
above it**. So the greedy count overshoots exactly when the tail is poor, which
is the 448TB row: the greedy rule says 12 (it is still summing `satRam` down a
list whose 12th entry earns 179 $/GB/s against the head's 1348), and 12 measures
$2,749b against 8's $2,903b (section 17's own arms: $2,569b vs $2,795b). §7 below measures a real greedy allocator to
confirm this is the mechanism rather than a story.

### 6c. `planBatch(t, ram, Infinity)` is the wrong batch, but harmlessly so here

The suspicion was correct in principle — the batch a saturated target runs is
`planBatch(t, ram, share/4)`, not the unconstrained one — but at the fleet sizes
in question the cap never binds: the largest optimal batch on the live world is
526GB (johnson-ortho) against a `share/4` of 1TB even at 8 targets on a 32TB
fleet. It would bind on a small fleet (a 2TB fleet split 8 ways gives a 64GB
batch budget), so §5's code keeps the cap. It explains none of the 3/5/5.

### 6d. What about desync bounding the pipeline (prior-art §9b/§9b')?

Also correct in principle, and also not the explanation. If in-flight depth were
bounded by something tighter than `weakenTime/4ε` — the safe-window gate blocks
launches for roughly half of each cycle — then `satRam` would be *larger*,
targets would saturate *later*, and the model would predict **fewer** targets,
not more. The model already under-predicts slightly at the top end (7 where 8
measures best), so adding a desync bound moves it the wrong way. The `4ε` floor
the dispatcher actually imposes is the binding constraint, and it is the one to
model.

---

## 7. Is the even split itself the problem? Yes — and it is worth more than the count

The count model above is the best answer *given* the allocator. The obvious next
question is whether the allocator is the thing to change, and it is. Prior-art
§9h's advice was **"cap batches-in-flight at `T/ε` per target and spill the
surplus RAM to the next target"**; only the *count* half of that was ever
extracted, and the allocation half was never implemented at all.

`tools/sim/target-count-alloc.mjs` runs the shipped batcher with one thing
changed — `share` — by handing `dispatch` a proxy of the sim whose `totalRam()`
reports the target's own allocation. Everything else (safe-window gate,
placement, drain, prep, spill) is the same code path. Targets are filled
best-first up to `satRam_i`; the first target that cannot be given enough for one
whole batch ends the list, so the count falls out of the allocation instead of
being a separate decision.

180-minute windows, median of 3 seeds:

| fleet | best even split | greedy fill to saturation | gain |
| ---: | ---: | ---: | ---: |
| 32,768 | $422b (n=1) | **$440b** | +4% |
| 98,304 | $1,049b (n=3) | **$1,173b** | +12% |
| 448,708 | $2,903b (n=8) | **$4,164b** | **+43%** |

The gain grows with the fleet, which is exactly what the model predicts it
should: the even split's waste is the RAM handed to targets that have already
saturated, and there is more of it the further past `satRam_1` the fleet is. The
mechanism is visible in §3's table — an even split over 8 targets gives everyone
56TB, which is 20TB more than `phantasy` can use (36.5TB) and 33TB less than
`silver-helix` can (89.3TB), simultaneously wasting RAM on the best target and
starving the third-best. Greedy fill does neither. Over the 448,708GB window that is $386m/s
realised against the best even split's $269m/s.

Three things follow.

1. **This is the allocation §9h actually recommended**, and the 43% is the cost
   of having implemented only its count.
2. **If the allocator changes, the count rule must change with it.** Under
   greedy fill the count is no longer a decision — it is "however many targets
   received a workable allocation", which is precisely the cumulative-saturation
   rule that was rejected. That rule is right *for that allocator*; §5's argmax
   is right for the one that ships today. Pairing either with the other is the
   error this document started from, so the two must move in the same change.
3. **It is not ready to ship.** It is a simulator result on one world with three
   seeds, it needs a placement-failure check (greedy runs the head of the list at
   the tightest legal period, which is where the single-thread-group hack
   placement is hardest), and it changes prep contention as well as dispatch.

One warning from building the experiment, because it is the same class of error
as §6a and it bit inside an hour of writing this. The first version of the arm
allocated RAM greedily but still *served* the whole ranked head, so targets with
no allocation still entered prep — and prep draws on the whole fleet's free RAM.
At 448,708GB that arm still measured +39% and looked like a clean result; at
32,768GB, where the best target alone absorbs the entire fleet, the same arm
measured **36% of a single-target even split**, which is what exposed it. A
result that only looks sane in the regime you expected to win in has not been
tested.

---

## 8. What would invalidate this, and what it does not cover

- **It models the dispatcher, not the game.** The model is derived from
  `batch.js`'s own `share`/`period` arithmetic. Change the allocator — spill a
  saturated target's surplus to the next instead of wasting it, say — and the
  count rule changes with it (§7). That is a feature: the rule is re-derivable
  rather than re-measurable.
- **It prices the world at the instant it runs.** It has no term for the level a
  long run will reach, which is why it under-prices concentrated configurations
  over a 180-minute window (§4b). In `batch.js` this does not arise: the count is
  re-derived every `retargetMs`.
- **Prep is not in the model.** A newly added target earns nothing until it is
  prepped, which costs a weakenTime or more and competes for the same RAM. The
  model therefore slightly over-values adding a target, and the effect grows
  with how often the count changes. If the count starts oscillating between
  retargets, add hysteresis before adding a prep-cost term — the measured curves
  are flat near the optimum, so an oscillation is nearly free in income and not
  free in prep.
- **The ranking index is not the model's rate.** `targetScore` (and
  `batchIndex`) is money per RAM-*second* with each op charged for its own
  duration: `chance·M / (T·(1.98/phi + 6.16/k))`, where 1.98 = 1.7 + 4·0.04·1.75
  and 6.16 = 3.2·1.75 + 4·0.08·1.75. That is the JIT accounting. This batcher
  pads every op to `weakenTime` (`batch.js:809-812`), so the RAM a batch really
  holds is `(1.77/phi + 1.89/k)·4T` per unit of f — grow is barely more expensive
  than hack, not 3x. The two orderings agree on the head of the list and disagree
  in the tail (on the live world, `crush-fitness` and `sigma-cosmetics` have
  higher true rates than `n00dles` and `johnson-ortho`, which outrank them).
  With `maxTargets = 8` this never bites, but ranking by
  `plan.money / (plan.gb · weakenTime)` — a quantity §5's loop already computes —
  is strictly closer to what this batcher pays. Unmeasured; worth a sweep.
- **BitNode multipliers.** Nothing here hardcodes one: every input comes from
  `planBatch`, which reads the live multipliers. The `4ε` floor and the
  `weakenTime = 4·hackTime` ratio are BitNode-independent
  (`src/Hacking.ts:90-94`). `bncheck.mjs` needs no new entry for this change.
- **Measured in BN1, hacking 295, on one world.** The 27x fleet sweep and the ε
  sweep are all on `tools/sim/snapshot.json`. The model's inputs are per-target
  and the argmax depends on the *shape* of the target distribution, so a world
  with a very different distribution (early game, few rooted servers) is
  untested. The regime it lands in there — nothing saturated, so n=1 — is the
  same answer the threshold loop already gets, which is reassuring but not
  evidence.

---

## Appendix: raw measurements

All from `tools/sim/snapshot.json` (BN1, hacking 295, all multipliers 1),
180-minute windows, median of 3 seeds, cumulative money stolen. Reproduce with:

```bash
node tools/sim/target-count.mjs --table                      # the model
node tools/sim/target-count-sweep.mjs --fleets 98304 \
     --counts 1,2,3,4,5,6,8,10,12 --minutes 180 --seeds 3    # one fleet, swept
node tools/sim/target-count-sweep.mjs --fleets 448708 --counts 8 --rule
node tools/sim/target-count-alloc.mjs --fleets 448708 --even 7,8
```

ε = 200 unless stated. Values in $b.

| fleet | n=1 | n=2 | n=3 | n=4 | n=5 | n=6 | n=8 | n=10 | n=12 |
| ---: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 16,384 | **235** | 181 | 151 | 147 | 142 | 130 | 95 | 80 | 67 |
| 32,768 | **422** | 383 | 344 | 332 | 316 | 299 | 225 | 199 | 191 |
| 65,536 | 527 | **762** | 721 | 708 | 659 | 596 | 501 | 453 | 426 |
| 98,304 | 503 | 984 | **1,049** | 1,014 | 913 | 876 | 773 | 710 | 690 |
| 200,704 | 886 | 1,245 | **1,653** | 1,613 | 1,483 | 1,579 | 1,531 | 1,459 | 1,426 |
| 300,000 | 1,039 | 1,217 | 1,860 | 1,997 | 1,974 | 2,078 | **2,108** | 1,997 | 2,000 |
| 448,708 | 1,157 | 1,223 | 2,179 | 2,515 | 2,659 | 2,758 | **2,903** | 2,742 | 2,749 |
| 448,708, ε=50 | 3,969 | 4,370 | 4,587 | **4,883** | — | 4,704 | 4,390 | — | — |
| 98,304, ε=500 | 272 | 501 | **698** | — | 665 | — | — | — | 609 |

Bold is the measured argmax. Counts not in the column set: 448,708GB/n=7 =
$2,857b; 98,304GB at ε=500, n=7 = $673b and n=9 = $631b.

---

## 9. Corrections, from the validation of §7 — see `docs/allocator.md`

§7's allocator finding was taken up and validated properly (9 seeds, 4 real
worlds, 33TB–26PB, with placement failures and prep measured). Three things in
this document are wrong or need qualifying as a result, and they are recorded
here so nobody re-derives from the uncorrected versions.

### 9a. The period is not `4ε`, and `cap`/`satRam` are both wrong because of it

Everything here — `cap_i = money_i/(4ε)`, `satRam_i = ram_i·weakenTime_i/(4ε)`,
and the argmax built on them — assumes a saturated pipeline lands a batch every
`4ε = 800ms`. It does not. Measured on the running batcher by differencing two
telemetry samples 333s apart (10 targets, skip rates 0.7%–100%):

```
achievedPeriod = ceil(4ε / loopMs)·loopMs  +  loopMs·(unsafeSkips + placeFails)/batches
```

— **0.1% mean absolute error**. Two terms: a launch can only happen on a
controller loop tick, so the floor is `4ε` rounded up to a tick (808ms, not 800);
and every blocked attempt costs exactly one further tick, because the dispatcher
`continue`s without advancing `s.nextLaunch`.

So `cap` here is overstated by 1.01x–1.26x and `satRam` by the same factor. The
consequence for §1's argmax is second-order (the factor is similar across
targets, and the argmax compares terms), which is consistent with §4b's tables
still holding; the consequence for §7's allocator is first-order.
`docs/allocator.md` §4 has the derivation and where `batch.js` should get the
number (from its own counters — it already keeps all three).

### 9b. §4c's ε sweep has a floor it did not know about

Because the realisable period is `ceil(4ε/loopMs)·loopMs`, with the shipped
`loopMs = 200` **any ε below 50 buys nothing at all** — 4ε is already one loop
tick. The measured ε=50 row (+68%) is at exactly that boundary and is therefore
the most that axis can give without also lowering `loopMs`. Worse, at ε=50 a
single blocked launch costs a *whole period* rather than a quarter of one, so
the safe-window skip rate matters four times as much there. Re-measure ε and
`loopMs` together or not at all.

### 9c. §7's "+43%" required `maxTargets = 16`

`tools/sim/target-count-alloc.mjs` ran its greedy arm at `maxTargets = 16` while
its even arm was pinned to 7 or 8 targets, so part of the +43% was "more
targets", not "better allocation". With both arms at the shipped
`maxTargets = 8` the same cell measures **+29%**; with both at 16 it measures
**+44%**, reproducing the original number. And at `maxTargets = 8` the rule
*regresses 7%* at a 1.6PB fleet, because it is forbidden to spend the RAM it
frees. The allocator and the cap are one change. Full tables, four worlds, in
`docs/allocator.md` §6.

### 9d. §7's headline does not apply to the fleet the game is on

The gain is a function of fleet size relative to the **saturation budget** of the
candidate list (`Σ satRam_i` over the targets `maxTargets` allows) — 322TB on
this document's world, 410TB on the live one. Far above that budget the even
split also saturates every target and the two allocators are algebraically
identical. The live fleet is 4.2–30PB, so the measured effect there is **−0.4%**.
