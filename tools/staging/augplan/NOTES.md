# augplan — the augmentation PURCHASE PLANNER

Staged under `tools/staging/augplan/`. **Nothing here is deployed.** `tools/` is
in the daemon's `SKIP_DIRS`; the proposed `progress.js` change is a diff in this
directory, not an edit to the repo root.

```
node tools/staging/augplan/augplan.test.mjs      # the test suite (~5s warm)
node tools/staging/augplan/augplan.test.mjs --fast # skip the game-source calibration
node tools/staging/augplan/measure.mjs           # greedy vs planner, on real data
node tools/staging/augplan/fixture.mjs           # regenerate fixture.json from game source
```

| file | what it is |
| --- | --- |
| `augplan.js` | the planner. Pure, no `ns`, 0GB to import. The deliverable. |
| `augplan.test.mjs` | AP1-AP10. **10 checks, 211 things examined, 0 FAIL, 0 WARN.** |
| `measure.mjs` | greedy vs planner on the real catalogue — §7 |
| `fixture.mjs` / `fixture.json` | the game's 137-augmentation catalogue, extracted |
| `gameresolve.mjs` | lets a staged file carry its DEPLOYED import spelling and still run under node |
| `progress.js.diff` | the proposed integration, as an applicable patch. **Not applied.** |
| `.progress.new.js` | the patched file in full, for reading. Dot-prefixed so nothing can ever push it. |

Line references `File.ts:NN` are into `~/Repos/bitburner`
(`bitburner-official/bitburner-src` fork, v3.0.2). Everything below was read out
of that tree or computed by calling the game's own functions through
`tools/sim/game.bundle.mjs`.

---

## 0. Findings that CHANGE the brief

Seven of these contradict something I was told or something already written down
in this repo. Each was checked against game source and, where possible, against
the game's own `getAugCost` running under node. Two of them (§0.5, §0.6) are
live defects in deployed code that this task only stumbled over.

### 0.1 BitNode 4 `AugmentationMoneyCost` **is 1** — the brief said it is not

`getBitNodeMultipliers(4, 1)` (`BitNode/BitNode.tsx:627-655`) sets
`ServerMaxMoney`, `ServerStartingMoney`, `CloudServerSoftcap`, `CompanyWorkMoney`,
`CrimeMoney`, `HacknetNodeMoney`, `ScriptHackMoney`, four exp multipliers,
`FactionWorkRepGain`, `GangUniqueAugs`, two Stanek fields, `DarknetMoneyMultiplier`
and `WorldDaemonDifficulty`. It sets **neither** `AugmentationMoneyCost` nor
`AugmentationRepCost`, so both take the class defaults at
`BitNode/BitNodeMultipliers.ts:13` and `:16`, which are `1`.

Confirmed by calling the game: `getBitNodeMultipliers(4,1).AugmentationMoneyCost
= 1`, `.AugmentationRepCost = 1`. The nodes that *do* charge more are BN3 (3/3),
BN5 (2), BN7 (3), BN9 (5/2), BN10 (2), BN12 (`inc`), BN13 (1.5), BN14 (3).

The planner still carries `nodeMoneyMult` as an input and asserts nothing about
its value — being right here by accident in BN4 is exactly the "true here, false
elsewhere" failure CLAUDE.md lists.

### 0.2 QUEUED SoA augmentations **do** count toward the SoA price multiplier

The brief says `SoACostMult^(owned SoA count)`. `tools/staging/augplan.js`
(the earlier staged module) says "SoA augs already **INSTALLED**". Both are
wrong.

`AugmentationHelpers.ts:150` is
`soaAugmentationNames.filter((augName) => Player.hasAugmentation(augName)).length`
and `Person.hasAugmentation` (`PersonObjects/Person.ts:232-240`) takes
`ignoreQueued = false` by default — it returns true for a **queued** aug as well
as an installed one.

Measured through the game's own `getAugCost`:

```
Beauty of Aphrodite, nothing owned or queued : $1,000,000   rep 10,000
                   , one other SoA QUEUED    : $7,000,000   rep 13,000
                   , one other SoA OWNED     : $7,000,000   rep 13,000
```

So SoA augmentations are excluded from the generic `1.9^queued` count **and
carry their own escalation of x7 money / x1.3 rep per SoA bought, including
within a single plan**. They are a second, independent rank-dependent problem
with `r = 7` — not the order-independent block the earlier module treated them
as. That module would have under-priced a two-SoA plan by 7x on the second item.

Consequence for ordering: descending base cost is optimal *within* the SoA block
for exactly the same rearrangement reason, with the sequence `7^0, 7^1, …`. And
because their rep requirement escalates too, an SoA at rank k needs
`rep >= repReq * 1.3^k` — a per-rank feasibility constraint, not a per-item one.

### 0.3 Prerequisites, and the fact that descending order VIOLATES them

`checkIfPlayerCanPurchaseAugmentation` (`Faction/FactionHelpers.tsx:88-95`)
rejects a purchase whose `prereqs` are not all satisfied, and
`hasAugmentationPrereqs` (`:56-58`) counts **queued** augs (same
`Player.hasAugmentation` default as above), so a prereq bought earlier in the
same plan counts.

34 augmentations have prereqs, and in **almost** every case the prerequisite is
cheaper than the augmentation that needs it:

```
Augmented Targeting II              $42.5m  <- Augmented Targeting I  $15m
Graphene Bionic Spine Upgrade       $6.0b   <- Bionic Spine           $125m
Embedded Netburner Module Core      $2.5b   <- Embedded Netburner Mod $250m
```

So "buy most expensive first" — the rule this repo's CLAUDE.md mandates and the
rule that minimises cost — **puts the dependent before its prerequisite and the
purchase fails**. `progress.js`'s current greedy has this bug today; it is
invisible because `purchaseAugmentation` returns false and the loop moves on, so
the augmentation is silently not bought. Measured on the real catalogue at $10b
and 200k reputation, the greedy loses **two** purchases this way (Embedded
Netburner Module Core Implant and Cranial Signal Processors - Gen III) — see §7.

**"Almost" matters, and the exception is why the planner does not simply sort by
cost.** `BLADE-51b Tesla Armor: IPU Upgrade` costs $1,100m and requires
`BLADE-51b Tesla Armor` at $1,375m — the prerequisite is *more expensive*. So
"ascending cost" is not the prerequisite order; a topological sort is.

Shape of the whole prereq relation, over the 137-augmentation catalogue:

| | |
| --- | --- |
| connected components with edges | 15 |
| components whose order is TOTAL (a chain) | 12 |
| components whose order is only PARTIAL | 3 — Embedded Netburner Module (6), PC Direct-Neural Interface (3), BLADE-51b Tesla Armor (6) |

The planner flattens each component to a topological chain and takes a prefix.
On a total order that is exact. On a partial one it is a **documented
restriction**: it can never produce an illegal plan, but it may miss a legal
cheaper subset (e.g. the ENM Analyze Engine without the Core V2 Upgrade). When
that happens the result says so in `restricted`. On the induced subgraph of the
hacking factions' 30 offers all components are total, so it does not bite today
— `restricted` is empty and `AP10` prints that it is.

### 0.4 Augmentations are **not** permanent — they are fuel, and the goal has a bar

`prestigeSourceFile` (`PersonObjects/Player/PlayerObjectGeneralMethods.ts:174`)
does `this.augmentations = []`, and `Prestige.ts:242-248` resets home RAM to
8/32/128GB by SF level and `cpuCores` to 1. Source-Files are the only thing that
crosses a BitNode.

So multiplier is not capital. Its entire value is clearing
`multiplierNeeded(9000, exp)` (`installgate.js`), after which it is discarded.
`planPurchases` therefore takes an optional `targetM` and, when the budget can
overshoot it, returns the **cheapest** set that clears the bar rather than the
most valuable set that fits. See §3.4.

Today the two objectives agree — we hold about 1.13x and need roughly 13x — so
this path does not fire live. It is tested synthetically (`AP8`).

### 0.5 `tools/staging/augplan.js`'s SoA list is wrong, and silently matches nothing

The nine SoA augmentations are named with a `SoA - ` prefix, and the WKS one is
lower-case:

```
SoA - Beauty of Aphrodite      SoA - Might of Ares
SoA - Chaos of Dionysus        SoA - Trickery of Hermes
SoA - Flood of Poseidon        SoA - phyzical WKS harmonizer
SoA - Hunt of Artemis          SoA - Wisdom of Athena
SoA - Knowledge of Apollo
```

`tools/staging/augplan.js:93-103` carries the unprefixed names, so its exported
`isSoa()` **returns false for every augmentation in the game**. SoA augs are then
priced as ordinary ones: counted into the `1.9^queued` exponent they are
explicitly excluded from (`AugmentationHelpers.ts:33-36`) and missing the 7x
escalation they do carry. This module had the identical bug until `AP6` — the
source-vs-source calibration — caught it on the first run. It is the exact
failure CLAUDE.md predicts for a transcribed constant.

### 0.6 `progress.js`'s `RAISE_CEILING` is already 5GB short, and the test that guards it checks a stale copy

Independent of anything in this task. The deployed `progress.js:110` declares

```js
const RAISE_CEILING = (mult) => 3.35 + 39.7 * mult
```

Its real static price is **48.05GB in BitNode 4** and **718.55GB at SF4.1**,
measured two ways that agree exactly: `tools/test/ram.mjs`'s `priceOverlay`
(the game's own `calculateRamUsage`) and `tools/staging/ramcheck.mjs`. That is
`3.35 + 44.7 * mult`. So the raise is **5GB short in BN4 and 80GB short at
SF4.1**, and `NetscriptFunctions.ts:1210-1214` denies a short raise **silently**
by returning the old allocation — the script then dies mid-run with no signal.

It is dormant today only because this save has no Source-File 4, so `canJoin` is
false and `RAISE_CEILING(0) = 3.35` is the branch taken, which is correct. It
breaks the day SF4 arrives.

`tools/test/ramoverride.test.mjs [R5]` passes because its subject set is
`tools/staging/ramoverride/*.js`, and that copy of `progress.js` is stale: it
still says `39.1` and does not call `getAugmentationStats`, `getCurrentWork` or
`isFocused` — exactly the 5.6GB the root file has since gained. R5 prints
`progress.js BN4 full 42.45GB` and goes green while the file that actually runs
costs 48.05GB. **A check measuring a copy of the thing it guards** — a new row
for CLAUDE.md's table.

The proposed diff sets the constant to `3.35 + 49.7 * mult` (44.7 already owed,
plus 5.0 for `getAugmentationPrereq`) and states that it is measured. Fixing R5's
subject is a separate job and should be done first.

### 0.7 `getAugmentationBasePrice` is not the same thing as "base price"

`Singularity.ts:140-150` returns `aug.baseCost * currentNodeMults.AugmentationMoneyCost`
for ordinary augmentations and bare `aug.baseCost` for the nine SoA ones — it
skips the BitNode multiplier for exactly those. It costs 2.5GB. The planner does
not use it: with the plan-now-buy-later architecture nothing is queued at plan
time, so `getAugmentationPrice` (same 2.5GB, already called) *is* the rank-0
intrinsic. The diff divides the live price back by `r^queued` for the one case
that is not true of — a first pass after deploy with a stale queue.

## 1. The cost rules, verified

`getAugCost` (`Augmentation/AugmentationHelpers.ts:127-161`), with the brief's
citations checked:

| claim | verdict |
| --- | --- |
| `getAugCost` at `AugmentationHelpers.ts:127-160` | `:127-161` (off by one at the close brace) |
| soaAugmentationNames at `:12-27` | `:17-27` |
| SF11 discount at `:29-31` | correct |
| `CONSTANTS.MultipleAugMultiplier` = 1.9 at `Constants.ts:41` | correct |
| `NeuroFluxGovernorLevelMult` = 1.14 | `Constants.ts:36` |
| `SoACostMult` = 7, `SoARepMult` = 1.3 | `Constants.ts:100-101` |
| `getLevel()` counts owned + queued, `Augmentation.ts:238-246` | correct |
| NFG rep escalates and is NOT discounted by 1.9 | correct — `:135` vs `:137` |
| reputation is never consumed | correct — `FactionHelpers.tsx:102-104` compares, `:120` is the only spend, and it is `loseMoney` |
| `skill.ts:13` | correct — `calculateSkill` line 13 is the `Math.floor(mult * (32 * Math.log(exp + 534.6) - 200))` |

```
r        = 1.9 * [1, 0.96, 0.94, 0.93][SF11 level]      AugmentationHelpers.ts:29-31
generic  = r ^ (queued augs whose name is NOT in soaAugmentationNames)   :32-37

ordinary  money = base   * generic * BN.AugmentationMoneyCost            :157
          rep   = baseRep          * BN.AugmentationRepCost              :158
NeuroFlux money = base   * 1.14^getLevel() * BN.AugMoneyCost * generic   :136-137
          rep   = baseRep * 1.14^getLevel() * BN.AugRepCost              :135
SoA       money = base   * 7  ^(SoA owned OR queued)                     :151
          rep   = baseRep * 1.3^(SoA owned OR queued)                    :152
```

---

## 2. What is already in the repo, and how this relates to it

`tools/staging/augplan.js` (a **different file** — repo-root-relative
`tools/staging/augplan.js`, not this directory) already solves the *cost* half:
the rearrangement argument, the NFG chain, the `rho = C / (r^s - 1)` block
exchange rule, brute-force-verified ordering. It is good work and this module
reuses its argument.

What it does **not** do, and what this module adds:

* It has **no notion of value.** Its selection rule is "take augmentations in
  descending price until the budget runs out, then backfill". That is a cost
  heuristic used as a value heuristic — it buys the most expensive augmentation
  in the list whether it gives +40% hacking or +2% crime money.
* It prices SoA as order-independent (§0.2) and does not model prereqs (§0.3).
* It has no stopping rule (§0.4).

The two should be merged before deployment; see §6.

---

## 3. The planner

### 3.1 Objective

Maximise `sum_i ln(m_i)` where `m_i = progressFactor([aug.mults])` over
`installgate.js`'s `RATE_CHANNELS` (`hacking`, `hacking_money`, `faction_rep`),
imported rather than copied. The derivation for those channels is in that file's
header: level is `mult * (32*ln(exp+534.6) - 200)` (`skill.ts:13`), linear in the
multiplier and logarithmic in exp, so the run is multiplier-bound and an exp
multiplier is worth nearly nothing.

`ln` makes the objective additive over a set, which is what makes an exact DP
possible at all.

### 3.2 Cost, and why rank is the whole difficulty

The k-th non-SoA purchase costs `intrinsic * r^k`. The weight belongs to the
**position**, not the item, so for a fixed set the total is minimised by pairing
the largest intrinsic with the smallest weight — descending base cost, by the
rearrangement inequality. Proved against brute force over all permutations in
`AP1`, not asserted.

That makes the cost **rank-dependent**: the marginal cost of adding an item
depends on how many other items are in the set. So this is not a knapsack.

### 3.3 The exact method

A Pareto dynamic program over `(i, c, t)`:

* `i` — index into the ordinary augmentations, processed in **descending**
  intrinsic cost
* `c` — how many ordinary augmentations have been chosen so far
* `t` — how many NeuroFlux levels have been taken so far

The next purchase sits at rank `c + t`. Three transitions: skip item `i`, take
item `i` at rank `c+t`, or take NeuroFlux level `t` at rank `c+t`. At each state
a **Pareto frontier** of `(cost, value)` pairs is kept, dropping anything
dominated (cost >= and value <=) or over budget.

Why processing descending makes the rank known: every previously chosen ordinary
item is more expensive and every later one is cheaper, so the `c`-th chosen item
*is* at position `c` among the ordinary items. Interleaving NeuroFlux shifts it
by `t`, which the state carries.

Why this is exact and not merely a good ordering: any optimal solution can be
transformed into one where the ordinary items appear in descending order without
increasing cost (swap two out-of-order ordinary items — rearrangement says the
descending assignment over the two positions they occupy is no worse), and the
DP enumerates every interleaving of that canonical form together with every
subset. NeuroFlux's ascending-level precedence is respected by construction.

Prerequisite chains are folded in the same way as NeuroFlux: a chain is taken in
ascending order, and the DP's chain dimension generalises to one index per chain.

SoA augmentations are a **separate** rank-dependent problem with `r = 7` and
their own counter, sharing only the money budget. Their frontier is computed by
the same DP with one dimension and convolved with the main frontier — a
convolution of two exact Pareto frontiers is exact.

**Tractability.** The frontier is capped (`frontierCap`, default 20000 pairs per
state). If the cap is ever hit the result carries `exact: false` and a
`approximation` string naming where it was hit — the answer is then a documented
heuristic and says so. On every realistic input measured it is not hit; see
`AP7`, which reports the largest frontier seen.

### 3.4 The stopping rule

With `targetM` supplied, the planner first asks whether any affordable set
clears `sum ln(m_i) >= ln(targetM)`. If one does, it returns the **cheapest**
such set (minimise cost subject to value >= bar) instead of the most valuable
affordable set. Both answers come out of the same frontier — it is a different
scan of the same Pareto set, not a second algorithm.

The rationale is §0.4: multiplier past the bar is destroyed on node exit, so
money spent on it should have gone to income or to home RAM.

---

## 4. Integration with `installgate.js` — the chicken and egg

See `progress.js.diff` in this directory for the concrete change.

`installgate.js` decides on `M` computed over the **queued** augmentations. If
purchasing moves to "plan now, buy at install time", nothing is ever queued, `M`
is always 1, `shouldInstall` returns `hold: the queued augmentations give no
gain` and the gate never fires.

The fix: feed the gate the **planned** `M` instead of the queued `M`. That is
strictly better, not merely equivalent:

* it is forward-looking — the gate sees the value of what the money *could* buy,
  including reputation that has just unlocked something expensive, before any of
  it is spent;
* the marginal-versus-average rule still works unchanged, because planned `M`
  grows for exactly the same reasons queued `M` used to (money accumulating,
  reputation crossing thresholds) and flattens for exactly the same reasons;
* it removes the thing that made the old loop wrong — buying opportunistically
  across time, which spends early cheap ranks on whatever happened to be
  affordable at minute 5.

**The thrash guard has to move with it.** `installgate.js`'s header argues the
gate cannot thrash because an install sets money to $1,262, so `M` is 1
immediately afterwards and the `M > 1` guard refuses. That argument survives:
planned `M` with $1,262 of budget is also 1, because nothing is affordable. It
survives for a *different reason* than before, so it is now asserted in `AP9`
rather than left as prose.

`queued` in the gate's input becomes `plan.buy.length`, and the refusal message
"nothing is queued" becomes "nothing is affordable". Both are still honest.

**One thing the caller must keep doing:** the executed plan should be re-priced
from the game immediately before each purchase, and the executor must stop and
report if a price disagrees with the plan by more than a tolerance. A plan is
computed from a snapshot; money moves. Silently buying at a different price than
planned is the "plan that cannot be executed, discovered by failing" row in
CLAUDE.md's table.

---

## 5. Phase 2 — pricing in TIME. What this design leaves room for, and what it does not

Not built. What the time-cost extension needs, so it is not reverse-engineered:

**What already fits.**

* `planPurchases` takes `offers` as plain objects with named fields and ignores
  any field it does not know, so `incomeRate`, `repRate`, `favor` and
  `donationsUnlocked` can be added per-offer without a signature change.
* The DP's frontier entries carry `{ cost, value, ... }` and everything that
  consumes them goes through `dominates(a, b)` and `insertPareto()`. Making cost
  a **vector** `(money, time)` is a change to those two functions plus the
  budget test — the DP structure, the rank arithmetic and the ordering proof are
  all untouched. That is the seam.
* `skipped` entries already carry the rep shortfall (`need`, `have`, `short`),
  which is precisely the input to `(repReq - factionRep) / repRate(faction)`.
  The whole point of reporting rather than filtering is that the time-priced
  version wants those rows.

**What does NOT fit, and would need real work.**

* **Reputation's economies of scale.** Rep is a threshold, never consumed
  (`FactionHelpers.tsx:102-104,120`), so once the bar for a faction's most
  expensive augmentation is cleared every cheaper one from that faction is free
  in time. That makes value **superadditive within a faction**, and an additive
  `sum ln(m_i)` objective cannot express it. The DP would have to carry
  per-faction maximum-rep-required as part of the state, which is a genuine
  extra dimension. I have NOT left room for that: `value` is a scalar sum today.
* **One faction at a time.** `repRate` is zero for every faction we are not
  currently working, so time-cost depends on a scheduling decision the planner
  does not make and cannot see. This turns the problem into "which augmentations,
  from which faction, in what order, and should we be working there now" — a
  joint schedule, not a selection.
* **The favour-150 discontinuity.** Below `favorNeededToDonate()`
  (`donation.ts:17`, `150 * FavorToDonateToFaction`; BN4's
  `FavorToDonateToFaction` is not set, so 150) reputation costs time; above it
  `repFromDonation(amt) = amt/1e6 * mults.faction_rep * currentNodeMults.FactionWorkRepGain`
  (`donation.ts:9` — **three** factors, and `FactionWorkRepGain` is 0.75 in BN4)
  makes it cost money out of the same budget. So the money budget and the rep
  threshold stop being independent constraints above that line. The current DP
  assumes they are independent: rep gates availability, money is the only
  budget. Crossing 150 favour breaks that assumption and the planner would need
  to spend budget on donations as a fourth transition.

**A design decision that would block it, flagged now while it is cheap:** the
value channel set is `RATE_CHANNELS` and includes `faction_rep`. In a
time-priced model `faction_rep` is not a terminal value at all — it is a
*rate* that changes future acquisition times, and counting it as value
double-counts once time is priced. Phase 2 should split the channels into
"terminal value" (`hacking`) and "rate" (`hacking_money`, `faction_rep`) and
feed the second into the time model rather than the objective. Doing that today
would put this module out of step with `installgate.js`, which is why it is not
done here.

---

## 6. Deployment, not done here

Nothing under `tools/` is pushed to the game. Before this ships:

1. **Fix `RAISE_CEILING` and `ramoverride.test.mjs` [R5] first** (§0.6). That is a
   latent failure in deployed code with nothing to do with this work, and it
   should not be bundled with a behavioural change.
2. **Merge with `tools/staging/augplan.js`** — one module, not two, and they
   currently want the same deployed filename. Its `bestSeller`,
   `nfgLevelsRepAllows` and the `rho` block-exchange argument are all still
   wanted; its selection rule (descending price as a proxy for value), its SoA
   pricing (§0.2) and its SoA name list (§0.5) are superseded.
   `tools/staging/sing-augbuy.js` and `sing-augsurvey.js` import it and would
   need updating with it.
3. Apply `progress.js.diff`. RAM: +5.0GB per multiplier unit for
   `getAugmentationPrereq`; everything else the plan needs
   (`getAugmentationStats`, `getAugmentationPrice`, `getAugmentationRepReq`,
   `getFactionRep`, `getAugmentationsFromFaction`) the file already calls.
4. `npm run verify` after pushing — CLAUDE.md, the auto-push is not reliable.

---

## 7. THE MEASURED DIFFERENCE

`node tools/staging/augplan/measure.mjs`.

### 7.1 First, honestly: there is NO live offer set

On 2026-09-13 the save is **BitNode 4, Source-File 1 level 1 and nothing else**,
`factions: []`, `queuedAugmentations: []`, $1.05m, hacking 118.

* No SF4 means `ns.singularity` throws, so `canBuyAug` is false and
  `progress.js`'s entire purchasing path — the code this task is about — **does
  not run at all today**. It writes a TODO line for a human instead.
* No factions joined means there would be no offers even if it did.

So the honest answer to "what does the current greedy buy versus the planner on
the live offer set" is: **both buy nothing, because there is nothing to buy.**
Inventing a live offer set to make the comparison look real is precisely the
fabricated-validation failure this repo has had twice. What follows is measured
on the game's **real catalogue** (137 augmentations, `baseCost`,
`baseRepRequirement`, `mults` and faction listings straight out of
`~/Repos/bitburner`) restricted to the five factions `progress.js:189-196` will
join, with money and reputation **swept** rather than assumed.

Every price in it is checked purchase-by-purchase against the game's own
`getAugCost` (`AP6`, worst relative error 2.8e-16).

### 7.2 The sweep — 30 offers, BitRunners / The Black Hand / NiteSec / CyberSec / Netburners

| reputation | money | greedy M | greedy $ | # | planner M | planner $ | # | ln M per $ |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50k | $1b | 1.168 | $0.98b | 4 | **1.424** | $0.85b | 9 | **2.64x** |
| 50k | $10b | 1.262 | $9.83b | 8 | **2.002** | $8.60b | 11 | **3.41x** |
| 50k | $100b | 1.286 | $99.7b | 14 | **2.325** | $75.9b | 16 | **4.40x** |
| 50k | $1t | 1.325 | $381b | 18 | **2.543** | $706b | 19 | 1.79x |
| 200k | $1b | 1.307 | $1.00b | 3 | **1.618** | $0.99b | 9 | 1.82x |
| 200k | $10b | 1.725 | $10.0b | 5 | **2.817** | $9.87b | 12 | 1.92x |
| 200k | $100b | 2.591 | $99.7b | 10 | **4.577** | $98.3b | 15 | 1.62x |
| 200k | $1t | 2.773 | $962b | 17 | **6.474** | $854b | 19 | 2.06x |
| 1000k | $1b | 1.307 | $1.00b | 3 | **1.618** | $0.99b | 9 | 1.82x |
| 1000k | $10b | 1.837 | $9.99b | 4 | **2.817** | $9.87b | 12 | 1.72x |
| 1000k | $100b | 3.291 | $99.8b | 10 | **5.375** | $99.2b | 15 | 1.42x |
| 1000k | $1t | 4.030 | $969b | 16 | **11.350** | $990b | 19 | 1.71x |

**The planner wins all 12 scenarios. Nothing ties, nothing loses.** The gap in
log-multiplier per dollar ranges 1.42x to 4.40x. In raw multiplier the biggest
gap is at 1000k reputation and $1t: **M = 11.35 against M = 4.03** — 2.8x the
multiplier for the same money, which against `installgate.js`'s objective
(`level = mult * f(exp)`, `skill.ts:13`) is 2.8x the hacking level.

### 7.3 Where the difference comes from — $10b, 200k reputation, in full

```
GREEDY (progress.js:326-333: sort by price descending, buy what fits)
   rank  0     $3.00b  m=1.000  Neuralstimulator            <-- ZERO value, best rank
   rank  1     $3.33b  m=1.320  Neural Accelerator
   rank  2     $1.99b  m=1.210  The Black Hand
   rank  3     $1.54b  m=1.080  CRTX42-AA Gene Modification
   rank  4    $143.4m  m=1.000  Hacknet Node CPU Arch...    <-- ZERO value
   total $10.00b   M=1.7250
   2 purchases the game would REJECT for unmet prerequisites:
     Embedded Netburner Module Core Implant, Cranial Signal Processors - Gen III

PLANNER
   rank  0     $1.75b  m=1.320  Neural Accelerator
   rank  1     $1.04b  m=1.210  The Black Hand
   rank  2     $1.62b  m=1.250  DataJack
   rank  3    $480.1m  m=1.050  Cranial Signal Processors - Gen I
   rank  4     $1.63b  m=1.070  Cranial Signal Processors - Gen II
   rank  5    $247.6m  m=1.050  BitWire
   rank  6-11           m=1.030  NeuroFlux Governor levels 1-6
   total $9.87b   M=2.8173   exact
```

Three distinct losses, and they compound:

1. **$3.14b of $10b on two augmentations worth exactly nothing.**
   Neuralstimulator is `hacking_chance` / `hacking_speed` / `hacking_grow` —
   none of which are in `RATE_CHANNELS`, because `skill.ts:13` says level is
   linear in the multiplier and the exit condition scales with `hacking`.
2. **It spends rank 0 — the cheapest exponent there is — on that one.** Every
   subsequent purchase then pays 1.9x more for it. The planner's rank 0 is its
   highest-value-per-dollar item.
3. **Two purchases it thinks it made, it did not.** `purchaseAugmentation`
   returned false for both prerequisite failures and `progress.js:329` ignores
   the return value, so the reputation paid for them bought nothing and nothing
   said so.

### 7.4 What this does not measure

* **Time.** Everything here prices in money only. The §5 extension is where
  "should we be grinding BitRunners right now" belongs, and it could reorder
  these answers.
* **The 30-augmentation Daedalus requirement.** Distinct augmentation *count*
  has value this objective does not express; the greedy's willingness to buy
  valueless cheap augmentations is accidentally right for that one purpose.
  Worth revisiting when Daedalus is actually in range — it is not.
* **Anything about the live game**, for the reason in §7.1.
