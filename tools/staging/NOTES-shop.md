# sing-shop / sing-aug — the purchasing and install half of the autonomous stack

Staged under `tools/staging/`. **Nothing here is deployed.** `tools/` is in the
daemon's `SKIP_DIRS`, which is deliberate: a `.js` at the repo root goes live in
the running game within ~150ms, and this set spends money and can install
augmentations.

Line references of the form `File.ts:NN` are into `~/Repos/bitburner`
(`bitburner-official/bitburner-src` fork). Everything asserted below was read out
of that tree. Nothing here was executed against the live save.

---

## 0. The files

| file | RAM | job |
| --- | --- | --- |
| `sing-shop.js` | **13.80 GB** | TOR, port programs, home RAM/cores |
| `sing-aug.js` | **3.10 GB** | director: runs the three below in order |
| `sing-augsurvey.js` | **12.10 GB** | who sells what, what is owned, what is queued |
| `sing-augbuy.js` | **12.70 GB** | price, plan, check affordability, buy |
| `sing-install.js` | **14.45 GB** | spend home to zero, install, relaunch `boot.js` |
| `augplan.js` | **1.60 GB** (base only) | pure buy-order logic, free to import |
| `ramcheck.mjs` | — | offline RAM pricer for staged files (node, not Netscript) |
| `testplan.mjs` | — | proves the buy-order claims under node |

Replaces `torbuy.js`, `autobuy.js`, `homeup.js`, `augbuy.js` and `nfg.js` — the
DOM-clicking set, which stays in `variants/dom-ui/` because without SF4 the
Singularity API throws.

```
node tools/staging/testplan.mjs                       # buy-order proofs
node tools/staging/ramcheck.mjs tools/staging/*.js    # the RAM table
```

---

## 1. The buy-order algorithm, and the one place this disagrees with CLAUDE.md

### 1.1 The cost rule, from source

`getAugCost` (`Augmentation/AugmentationHelpers.ts:128-160`):

```
generic  = 1.9 ^ (queued augmentations NOT in soaAugmentationNames)
                                          AugmentationHelpers.ts:29-36
                                          CONSTANTS.MultipleAugMultiplier = 1.9

NeuroFlux   money = base * 1.14^getLevel() * BN.AugMoneyCost * generic
            rep   = baseRep * 1.14^getLevel() * BN.AugRepCost
            getLevel() = owned level + queued NFG count   Augmentation.ts:238-246
SoA (x9)    money = base * 7^(SoA augs INSTALLED)      -- no generic term
            rep   = baseRep * 1.3^(SoA augs INSTALLED)
everything  money = base * generic * BN.AugMoneyCost
else        rep   = baseRep * BN.AugRepCost
```

In BitNode 4 `AugmentationMoneyCost` and `AugmentationRepCost` are both 1 —
`BitNode/BitNode.tsx:627-655` sets neither, so the defaults at
`BitNodeMultipliers.ts:13,16` apply. Nothing in the shipped code reads them;
prices come from `getAugmentationPrice`, which has already applied them.

Two facts fall straight out and both matter:

* **Reputation is a gate, not a budget.** `purchaseAugmentation`
  (`FactionHelpers.tsx:109-128`) calls only `Player.loseMoney`; reputation is
  compared and never decremented. So N augmentations from one faction each need
  `rep >= their own requirement` and that is the whole constraint.
* **The cost of the j-th purchase of a run is `intrinsic_j * 1.9^j`**, where
  `intrinsic` is the price with nothing yet queued *in this run*: the live
  `getAugmentationPrice` for an ordinary augmentation, and
  `nfgPrice * 1.14^(levels already taken)` for NeuroFlux. Every ordering
  question is which item deserves the small exponents.

### 1.2 Items with no precedence: most expensive first

Total is `Σ intrinsic_j · 1.9^j`. The weights `1.9^0 < 1.9^1 < …` belong to the
*position*, not the item. The rearrangement inequality says a sum of products is
minimised when one sequence ascends against the other descending — so pair the
largest price with the smallest weight. **Descending price is optimal, not
heuristic.**

`testplan.mjs` enumerates every permutation of random sets: *0/300
counterexamples, worst excess 0.00e+0.*

### 1.3 What NeuroFlux breaks

NeuroFlux levels must be taken in **ascending** level order — you cannot buy
level 9 before level 8 — while their intrinsic prices **ascend** at 1.14x a
level. It is a precedence chain in exactly the wrong order, so "most expensive
first" cannot be applied to it.

### 1.4 The rule that covers both: adjacent-block exchange

For block `B` (size `s`, internal cost `C_B`) immediately before block `C` (size
`t`, cost `C_C`), swapping changes the total from `C_B + 1.9^s·C_C` to
`C_C + 1.9^t·C_B`. So `B` belongs first iff

```
        C_B / (1.9^s − 1)   >   C_C / (1.9^t − 1)          call this rho
```

For a singleton `rho = price/0.9`, so ordering singletons by rho *is* §1.2. The
algorithm is therefore: **at each step take whichever available thing has the
highest rho — the next ordinary augmentation, or the best PREFIX of the
NeuroFlux chain.** (Sidney's decomposition for chain precedence, specialised to
a geometric cost.) That is `mergeOrder` in `augplan.js`.

Longer chain prefixes can beat shorter ones, which is why the loop searches over
`t` rather than only looking at the next level: the chain's cheap head drags its
own ratio down, and taking it together with the expensive tail it unlocks is
sometimes what wins.

**Verified by brute force** against every possible interleaving of random
instances:

```
PASS  mergeOrder is optimal over every interleaving  0/400 suboptimal, worst excess 0.000000%
      for comparison: always-NeuroFlux-first suboptimal on 270/400, worst excess 4604.1%
                      always-augmentations-first worst excess 2366.2%
```

### 1.5 **The disagreement.** "Buy NeuroFlux first" is right only in the endgame

CLAUDE.md's install procedure step 3, and the brief, both say *buy NeuroFlux
levels before other augmentations*. That is rho picking the chain — and it is the
correct answer **in the regime it was learned in**: the BitNode 1 endgame, where
every ordinary augmentation was already owned and the levels being bought were
deep enough (1.14^L with L in the dozens) to be the most expensive items in the
game. With no ordinary augmentations in the plan the question does not even
arise, which is exactly `nfg.js`'s situation.

Early in a life it is the wrong answer, and expensively so. A realistic
BitNode-4 list (base costs straight out of `Augmentations.ts`: ENM Core V3
$7.5b, Neuralstimulator $3b, Artificial Bio-neural Network $3b, Cranial Signal
Processors Gen III $550m, DataJack $450m, BitWire $10m) against a $1t budget:

```
lvl   nextPrice    best: k, $total        nfg-first: k, $total     levels gained
0     $7.50e+5     k=13  $7.328e+11       k=5   $8.398e+11         2.60x
20    $1.03e+7     k=10  $6.828e+11       k=5   $8.402e+11         2.00x
40    $1.42e+8     k=7   $7.257e+11       k=5   $8.454e+11         1.40x
50    $5.25e+8     k=6   $8.050e+11       k=5   $8.608e+11         1.20x
60    $1.95e+9     k=5   $8.033e+11       k=5   $9.177e+11         1.00x
80    $2.68e+10    k=4   $9.241e+11       k=4   $9.241e+11         1.00x
100   $3.68e+11    k=1   $4.322e+11       k=1   $4.322e+11         1.00x
```

NeuroFlux base cost is **$750k** (`Augmentations.ts:1160-1161`), so at NeuroFlux
level 0 a level is four orders of magnitude cheaper than the augmentations it
would be pushed behind. Forcing it first buys **5** levels where the optimal
order buys **13** — same six augmentations either way. The two orders converge at
about NeuroFlux level 55-60 for this list, and agree exactly from there on.

There is no trade being made here: the cheaper order leaves more money, and more
money is more NeuroFlux levels. It dominates on both axes.

**What shipped:** `--order best` is the default and is the rho merge.
`--order nfg-first` forces the documented rule, `--order augs-first` forces the
other; every plan publishes `ordering.nfgFirst`, `ordering.augsFirst` and
`ordering.nfgFirstPenalty`, so the choice is auditable from telemetry rather
than argued from a comment. **If the lead wants the mandated order regardless,
it is one flag** — `sing-aug.js --order nfg-first` — and no code change.

### 1.6 Ordering is not priority

Easy to conflate, and getting it backwards would spend a life on +1% increments.

* **Priority (which set):** ordinary augmentations are selected first, against
  the *whole* budget. NeuroFlux takes what is left. A real augmentation is worth
  far more than +1% to everything, and Daedalus counts **distinct**
  augmentations. If NeuroFlux had priority it would absorb the entire budget
  forever, because it never runs out.
* **Ordering (what sequence):** §1.4, by rho.

Set selection is: rep-eligible ordinary augmentations, descending price, trimmed
from the tail until affordable, then **backfilled** cheapest-first with anything
that still fits. Without the backfill, $10b against augmentations of
$9b / $1b / $0.5b buys one and leaves $1b idle, when $9b + $0.5b·1.9 = $9.95b
buys two.

### 1.7 SoA augmentations

The nine `soaAugmentationNames` are order-independent in both directions: their
price keys off SoA augs **installed**, which a purchase this cycle does not
change, and they are excluded from everyone else's queued count. So they cost the
same wherever they go, and are appended last where a shortfall costs nothing
else. A hacking bot normally never sees them (Shadows of Anarchy is an
infiltration faction); they are handled because getting them wrong would silently
mis-price everything else.

---

## 2. The NeuroFlux wall

`money = base · 1.14^level · 1.9^queued`, and **every queued NeuroFlux counts
toward both exponents** (`Augmentation.ts:238-246`). So inside one install cycle
a level costs `1.14 × 1.9 = 2.166x` the previous one. The `1.9^queued` term
resets at install; the `1.14^level` term does not.

`nfgChainCost` closes that as a geometric series instead of simulating the loop,
and the series was checked against a purchase-by-purchase replay of `getAugCost`
to **2.08e-15** relative error.

How the wall is handled, concretely:

1. **Level count is solved, not attempted.** `buildPlan` scans `k` upward while
   `mergeOrder(chosen, nfg, k).total <= budget`. Monotone in `k` (another level
   costs money *and* pushes something else up an exponent), so the scan finds
   the maximum. No money is spent discovering where the wall is.
2. **Reputation cap in closed form.** Level `j` needs `repReq · 1.14^j` and
   reputation is not consumed, so `nfgLevelsRepAllows` is a logarithm, not a
   loop. Tested exact at the boundary.
3. **`nfgStoppedBy` is published**: `money` | `rep` | `cap` | `unavailable`. The
   director and `sing-donate.js` need to know *which* wall was hit; they are
   completely different problems.
4. **The wall is real and shallow.** At a $1b next-level price, a $1e12 budget
   buys 9 levels, $1e15 buys 18, $1e18 buys 27. A thousand-fold budget buys nine
   more levels. Any plan that assumes "more money → many more levels" is wrong,
   and this is why the install cycle itself — which resets `1.9^queued` — is the
   lever rather than the bank balance.

---

## 3. Not repeating the $10.5 trillion nfg.js bug

`nfg.js` read the NeuroFlux card, saw reputation was short, donated **$10.5
trillion** to cover the shortfall — and only then discovered the level's *money*
price was out of reach anyway. The reputation was bought for a purchase that was
never going to happen, and donations are not refundable.

The structural fix, in `sing-augbuy.js`:

1. Price every candidate (money **and** reputation) with nothing purchased.
2. Build the whole plan and its running total.
3. **Refuse to start unless the total fits in `money - reserve`.** The gate is
   re-asserted against live money immediately before the first purchase.
4. Only then walk the order.

And the direct answer to "is reputation worth buying?": the status file's
`repWanted` list carries `moneyPrice` and **`moneyAffordable`** for every
augmentation blocked on reputation, where `moneyPrice` is what it would cost
appended to the end of the current plan (the cheapest it can be) and
`moneyAffordable` compares that to what is left after the plan. **An entry with
`moneyAffordable: false` must not be chased with a donation.** That is the $10.5t
mistake expressed as a field.

For NeuroFlux the same ordering is explicit in the code: `blockedBy` is
`'money'` if the next level's price alone exceeds the budget, and only otherwise
does it report the reputation verdict. Money question first, every time.

Nothing in this set donates, works or joins. `sing-donate.js` owns that, and
note CLAUDE.md's newer warning: `repFromDonation` carries
`currentNodeMults.FactionWorkRepGain`, which is **0.75 in BitNode 4**, so
`nfg.js`'s "over-donate by assuming faction_rep = 1" shorthand is a 0.25%
*shortfall* here, not a margin. Whatever consumes `repWanted` must measure the
rate rather than assume it.

---

## 4. The install, and closing the loop

### 4.1 Spend to zero first

`prestigeHomeComputer` (`Server/ServerHelpers.ts:226-239`) empties `programs`,
sets `serversOnNetwork = []` and `ramUsed = 0`, and touches **neither `maxRam`
nor `cpuCores`**. Money resets to $1262. Home RAM and cores are the only purchases
that survive; every dollar held at install is destroyed. We once installed
holding **$2.07 quadrillion** with home at 16.38TB and one core.

`sing-install.js` does the spend-down **itself** rather than exec'ing
`sing-shop.js --reserve 0`. Two reasons, the first decisive:

* **Spending and installing must not be separable.** An exec'd child can fail to
  start for want of RAM, be killed by the watchdog, or still be running when the
  parent decides it has waited long enough — and every one of those ends with the
  install firing on a full bank account.
* 14.45GB in one script beats 8.6 + 14.3GB resident at once on a 32GB home.

Two loops, deliberately:

* a **model loop** using `homecost.nextHomeUpgrade` (cheapest of RAM/cores each
  step, which is what makes the dollars go furthest), and
* a **drain loop** that trusts nothing and just asks the game to sell
  `upgradeHomeCores()` then `upgradeHomeRam()` until both refuse. If the cost
  model is ever wrong in the cheap direction, this is what stops a dollar
  surviving to be destroyed. If it is right, it costs two calls returning false.

### 4.2 The restart

The autoexec does **not** fire after a prestige. `NetscriptWorker.ts:246-251`
skips any server whose `savedScripts` is absent, and an install kills every
script, so home has none and the autoexec entry is never created. It fires on an
ordinary page reload and not on the one case that matters. This is the step that
used to require a human to type `run boot.js`.

`singularity.installAugmentations(cbScript)` closes it. `Singularity.ts:196-211`
schedules `setTimeout(() => runAfterReset(cbScript), 500)` — on the browser event
loop, **outside** the script, so it survives the prestige that kills the caller —
and `runAfterReset` (`Singularity.ts:59-76`) starts it on home with **no
arguments and one thread**.

`runAfterReset` fails **silently** in two ways, so both are checked *before* the
point of no return:

| failure | guard |
| --- | --- |
| `home.scripts.get(cbScript)` misses → bare `return` | `ns.fileExists(boot, 'home')` |
| `ramUsage > home.maxRam - home.ramUsed` → `Terminal.error`, which nothing reads | `ns.getScriptRam(boot,'home') <= ns.getServerMaxRam('home')` |

`ramUsed` is 0 by then — `prestigeHomeComputer` sets it synchronously inside
`installAugmentations`, 500ms before the callback — so `maxRam` alone is the
right comparison. `boot.js` is currently **7.9GB** against a 32GB home (measured
with `calculateRam` over the control port), so it fits with room.

The path is `'/boot.js'` by default: `resolveScriptFilePath` strips a leading
`/` and treats the rest as absolute (`FilePath.ts:61-66`), while a bare name
resolves against the **calling** script's directory
(`Singularity.ts:198-200`). Absolute means it resolves the same wherever this
file ends up living.

### 4.3 TOR is gone afterwards

`serversOnNetwork = []` breaks the darkweb link, so `hasTorRouter()` goes false
and `sing-shop.js` must re-buy it. `boot.js` launches it; `sing-shop.js` is
idempotent and safe to run on every boot.

---

## 5. RAM, and how it was measured

`calculateRam` over the RFA only prices files the game already has, and these
deliberately are not in the game. So `tools/staging/ramcheck.mjs` prices them the
way the game does: parse with **acorn** (the same parser), collect every
`Identifier` and every `MemberExpression` property name exactly as
`Script/RamCalculations.ts:407-439` does, skip `objectPrototypeProperties`
(:408), and look each name up in a cost table **extracted at run time from
`Netscript/RamCostGenerator.ts`**. `SF4Cost` resolves to the base cost, which is
what `RamCostGenerator.ts:82-96` returns when `Player.bitNodeN === 4`.

Calibrated against the live game before being trusted (`calculateRam` on the
left, `ramcheck` on the right):

```
status.js    1.6  / 1.60      watchdog.js  7.8  / 7.80
homecost.js  1.6  / 1.60      boot.js      7.9  / 7.90
tel.js       4.0  / 4.00      batch.js    11.2  / 11.20
```

Exact on every single-file script. `cmd.js` reads 8.15 in-game against 8.05 here;
the 0.10 is its `lock.js` import, which `ramcheck` does not follow. **None of the
staged files pay an import cost**: `status.js`, `homecost.js` and `augplan.js`
all price at exactly 1.60 (the script base), i.e. they reference no billable ns
function.

### The table

| file | GB | calls, and why each is needed |
| --- | --- | --- |
| **`sing-shop.js`** | **13.80** | |
| | 1.60 | script base (`RamCostConstants.Base`) |
| | 3.00 | `singularity.upgradeHomeRam` — the job |
| | 3.00 | `singularity.upgradeHomeCores` — the job |
| | 2.00 | `singularity.purchaseTor` — the job |
| | 2.00 | `singularity.purchaseProgram` — the job |
| | 1.50 | `singularity.getUpgradeHomeCoresCost` — the core count and price, see below |
| | 0.50 | `singularity.getDarkwebProgramCost` — real prices, and 0 means "already owned" |
| | 0.10 | `getServerMoneyAvailable` — every purchase is gated on it |
| | 0.05 | `getServerMaxRam` — input to `homecost.ramUpgradeCost` |
| | 0.05 | `hasTorRouter` — the only correct TOR predicate |
| **`sing-aug.js`** | **3.10** | |
| | 1.60 | script base |
| | 1.30 | `exec` — launches the three specialists |
| | 0.10 | `isRunning` — waits for each to finish |
| | 0.10 | `getScriptRam` — so "exec failed" can say how much RAM it wanted |
| **`sing-augsurvey.js`** | **12.10** | |
| | 1.60 | script base |
| | 5.00 | `singularity.getOwnedAugmentations` — installed, and (with `true`) the queue |
| | 5.00 | `singularity.getAugmentationsFromFaction` — the catalogue |
| | 0.50 | `getPlayer` — `.factions`, the joined list |
| **`sing-augbuy.js`** | **12.70** | |
| | 1.60 | script base |
| | 5.00 | `singularity.purchaseAugmentation` — the job |
| | 2.50 | `singularity.getAugmentationPrice` — the plan, and the pre-purchase re-check |
| | 2.50 | `singularity.getAugmentationRepReq` — the reputation gate |
| | 1.00 | `singularity.getFactionRep` — the other half of that gate |
| | 0.10 | `getServerMoneyAvailable` — the affordability gate |
| **`sing-install.js`** | **14.45** | |
| | 1.60 | script base |
| | 5.00 | `singularity.installAugmentations` — the job |
| | 3.00 | `singularity.upgradeHomeRam` — the mandatory spend-down |
| | 3.00 | `singularity.upgradeHomeCores` — same |
| | 1.50 | `singularity.getUpgradeHomeCoresCost` — cheapest-first needs the price |
| | 0.10 | `fileExists` — the boot script must be on home |
| | 0.10 | `getScriptRam` — the boot script must fit after the reset |
| | 0.10 | `getServerMoneyAvailable` — spend-down loop condition |
| | 0.05 | `getServerMaxRam` — RAM upgrade price, and the boot-fit check |
| **`augplan.js`** | **1.60** | base only — no ns function anywhere |

**Concurrency.** Peak is the director (3.10) plus its largest child (14.45) =
**17.55GB**, which fits in 32GB home alongside `batch.js` (11.2GB) with 3.25GB
spare. `sing-shop.js` (13.80) runs on its own and leaves 6.9GB. `sing-augsurvey`
(12.10) + director = 15.2, leaving 5.6GB.

**A 32GB home is genuinely tight for this.** With `batch.js` (11.2) and
`watchdog.js` (7.8) both resident there are 13GB free, which `sing-augsurvey.js`
at 12.1 only just fits and `sing-install.js` at 14.45 does not. That is a
scheduling problem for `autopilot.js`, not a defect here — and `sing-shop.js`
buying home RAM is the thing that makes it go away. The director reports
`exec <file> failed — needs NGB` rather than failing silently.

### Two RAM decisions worth recording

**`getUpgradeHomeCoresCost` (1.5GB) instead of `getServer(...).cpuCores`
(2.0GB).** `homeup.js` reads `ns.getServer('home').cpuCores`. The Singularity
call is both *cheaper* and *more authoritative*: it returns the game's own
`Player.getUpgradeHomeCoresCost()` = `1e9 · 7.5^cores`
(`PlayerObjectServerMethods.ts:42`), and the core count is exactly recoverable
from it, because `7.5^c` for `c` in 0..8 are far enough apart that rounding the
logarithm is not a judgement call. `homecost.js`'s `coreUpgradeCost` is still
used — as a **check** on that, not as the source: both scripts publish
`homecost.coreUpgradeCost drift vs game: N%`, and `sing-shop.js` refuses to
spend if it exceeds 0.1%. That is CLAUDE.md's calibration rule applied at the
only place a live number is free.

**`getAugmentationPrereq` (5GB) deliberately NOT referenced.** Prerequisites are
enforced by `purchaseAugmentation` itself (`FactionHelpers.tsx:87-95`), which is
free and authoritative. A refused purchase only ever makes the *rest* of the plan
**cheaper** than planned — the queue multiplier did not advance — so the
whole-plan affordability guarantee survives it. `sing-aug.js` re-runs the cycle,
and by then the prerequisite is queued; `Player.hasAugmentation` counts queued
augmentations as well as installed ones (`Person.ts:232-240`), so the dependent
becomes purchasable. One round per link in a chain. The cost is one refused call
per cycle per chained augmentation, logged.

That asymmetry is also why the price-drift check in `sing-augbuy.js` only aborts
on the **upside**. Aborting on `|live − expected|` would let one skipped
prerequisite cancel every purchase after it.

---

## 6. What was carried over from the DOM versions, and what was dropped

### Carried

* **`ns.serverExists('darkweb')` is not a TOR test.** The darkweb server is in
  the list from the first second of a BitNode; buying TOR merely *connects* it
  (`getTorRouter()` → `connectServers`, `ServerHelpers.ts:354-356`).
  `autobuy.js` believed TOR was owned for half an hour and queued
  `buy FTPCrack.exe` every 60s into a terminal answering "You need to be able to
  connect to the Dark Web". The predicate is `ns.hasTorRouter()` (0.05GB).
* **Port openers before anything else.** Rooting is gated on open ports alone,
  never on hacking level, so each one unlocks a whole tier at once — relaySMTP
  unlocked 688GB for $5m, about $7.3k/GB against the cloud's flat $55k/GB. They
  ignore `--reserve` for that reason. `Formulas.exe` at $5b is last and gets 3x
  headroom instead of 1.5x, because it is the only entry that can compete with
  an augmentation for the same dollar.
* **Cumulative budget, not one purchase per tick.** `autobuy.js` re-read the
  balance between purchases, which made sense when one program was a real
  fraction of net worth and meant six programs took six minutes once it was not.
* **Cheapest-of-RAM-or-cores each step** (`homecost.nextHomeUpgrade`), and
  `homecost.js` as the source for the closed forms rather than re-deriving them.
* **Compute prices, never read them off a control.** `RamButton.tsx:49` renders
  `disabled={!Player.canAfford(cost) || reachMaxRam}`, so "too expensive" and
  "maxed out" are indistinguishable — which is how `homeup.js` published
  `nextCost: null` ("everything maxed") while sitting at 7 cores.
* **`ns.atExit` on every script.** Five scripts wrote nothing on error for most
  of BitNode 1 and it cost hours. Every one of these publishes on success, on a
  handled error, and from `atExit` — including `sing-install.js`, where `atExit`
  is the *only* thing that can record that the install fired, since
  `prestigeWorkerScripts` kills the caller.
* **Never act on the previous batch's output.** The `cmd.js` lesson, generalised:
  the director stamps a `cycle` id and each child refuses a survey that is not
  its own. Between a request being written and picked up there is a window where
  a complete, well-formed, wrong file is sitting on disk.

### Dropped, and why it is now safe to drop

* **The UI lock.** It existed so `upkeep.js` would not click Focus mid-sequence
  and so two UI scripts would not fight over the page. There is no page.
  `eval('document')` would also cost 25GB (`RamCostConstants.Dom`).
* **Click verification.** `homeup.js` re-read `maxRam`/`cpuCores` after every
  click because a disabled MUI button swallows `.click()` silently, and it logged
  two purchases that never happened before that was added. `upgradeHomeRam()`
  and `upgradeHomeCores()` return booleans.
* **Price-multiplier scraping.** `augbuy.js` watched the page's
  `Price multiplier: x N` to tell a silent success from a silent failure, because
  `SuppressBuyAugmentationConfirmation` makes the Buy click purchase with no
  modal and `ns.getPlayer()` does not expose `queuedAugmentations`.
  `purchaseAugmentation` returns a boolean.
* **The `connect darkweb` terminal fallback.** Only existed because
  `purchaseProgram` needs SF4.
* **Ancestor-walking to bind a button to its row.** No DOM.

---

## 7. Things I could not do without another script, or at all

* **Joining factions.** Nothing here can act until a faction has been joined, and
  `sing-augsurvey.js` deliberately surveys only joined factions —
  `checkIfPlayerCanPurchaseAugmentation` rejects anything else
  (`FactionHelpers.tsx:61-66`), so a wider survey would only produce a plan that
  cannot be executed. `sing-faction.js` (`checkFactionInvitations` 3GB,
  `joinFaction` 3GB, `workForFaction` 3GB) is the missing piece. In BitNode 4
  this *is* scriptable — `singularity.joinFaction` has no `isTrusted` check —
  which is the whole point of the node.
* **Buying reputation.** `sing-augbuy.js` emits `repWanted` with
  `moneyAffordable` already decided, and does nothing about it.
  `sing-donate.js` (`donateToFaction` 5GB, `getFactionFavor` 1GB) is its
  consumer, and must measure the donation→reputation rate rather than assume it
  (CLAUDE.md: `FactionWorkRepGain` is 0.75 in BN4, which turns `nfg.js`'s
  "safety margin" into a shortfall).
* **Deciding *when* to install.** `sing-aug.js --install --confirm` performs an
  install; nothing here decides that an install is due. That is `autopilot.js`'s
  job and it needs the favour model (`favorToRep(150) = 462,490`) which is a
  different problem from this one.
* **Saving the game first.** CLAUDE.md's install procedure step 1 is "back up the
  save", via `getSaveFile` over the control port. A script inside the game cannot
  do that. Whatever drives `--install` from outside should take the backup; if
  the install is triggered from inside the game there is no backup, and that is a
  real gap.
* **Verifying any of this against the live game.** Per the brief nothing was
  executed and nothing was purchased. Everything is derived from game source,
  from `calculateRam`-calibrated offline pricing, and from `testplan.mjs`. The
  first live run should be
  `run sing-shop.js --dry` then `run sing-aug.js --dry`, and the plan in
  `/tel/aug-plan.txt` read before anything is allowed to spend.
* **`getAugmentationPrereq`, `getAugmentationStats`, `getAugmentationBasePrice`.**
  All would be useful — stats would let the plan rank by *value* rather than by
  price as a proxy — and all cost 2.5-5GB. On a 32GB home they do not fit. When
  home reaches 64GB+, `sing-augbuy.js` gaining `getAugmentationStats` (5GB) and
  ranking on the hacking multipliers instead of on price is the single biggest
  improvement available to this set.

---

## 8. Deployment checklist

Nothing is deployed. To deploy, these go to the **repo root** (which hot-pushes
into the live game in ~150ms) and `boot.js`/`watchdog.js` need to learn them:

1. `augplan.js`, `sing-shop.js`, `sing-augsurvey.js`, `sing-augbuy.js`,
   `sing-install.js`, `sing-aug.js` → repo root.
2. `boot.js`: add `sing-shop.js` where `torbuy.js` sits, gated the same way.
   Leave `torbuy.js` in place until `sing-shop.js` has been seen to work — they
   are idempotent and do not conflict, since neither takes the UI lock for TOR
   any more.
3. `bncheck.mjs` `ASSUMPTIONS`: `augplan.js` hardcodes `1.9`
   (`MultipleAugMultiplier`) and `1.14` (`NeuroFluxGovernorLevelMult`), both
   `CONSTANTS`, not BitNode multipliers — so they do not vary by node. What
   *does* vary is `AugmentationMoneyCost` / `AugmentationRepCost`, and nothing
   here reads them because `getAugmentationPrice` applies them. Worth an entry
   saying exactly that, so the next node's checklist does not re-derive it.
4. Run `npm run verify` afterwards. The auto-push is not reliable — on
   2026-09-12 two consecutive edits never reached the game and only an explicit
   `curl localhost:12526/sync` delivered them.
