# Which controller to run — a minimum-time-to-terminal model

**Status: working notes + derivation for `tools/sim/horizon.mjs`.** Written
2026-09-13 against the live BitNode 4 run. Every number in the "live" sections
is read from the save or `.telemetry/`; re-run the tool rather than trusting a
figure here, which goes stale.

The tool is the authority on the numbers; this file is the authority on *why*
the numbers are the ones computed.

---

## 0. Three facts found while reading, before any modelling

Each of these changes an answer, and all three were silently wrong or unknown
when the question was asked.

### 0a. Every offline model in `tools/sim/` is running BitNode 1 physics

`game.bundle.mjs` exports `currentNodeMults`, which is initialised as
`new BitNodeMultipliers()` — **all ones** — and the only thing that ever changes
it is `replaceCurrentNodeMults`, which the game calls at BitNode entry and which
`build.mjs` does not export. Nothing in `tools/sim/` sets it.

The live run is **BitNode 4**, whose non-unit multipliers are
(`src/BitNode/BitNode.tsx` case 4):

| multiplier | BN4 |
| --- | --- |
| `ScriptHackMoney` | **0.2** |
| `HackExpGain` | **0.4** |
| `ServerMaxMoney` | 0.1125 |
| `ServerStartingMoney` | 0.75 |
| `FactionWorkRepGain` | 0.75 |
| `CloudServerSoftcap` | 1.2 |
| `WorldDaemonDifficulty` | **3** |
| `HacknetNodeMoney` | 0.05 |
| `CompanyWorkMoney` | 0.1 |
| `CrimeMoney` | 0.2 |
| `DarknetMoneyMultiplier` | 0.4 |
| `AugmentationMoneyCost` | 1 (BN5 is the one that doubles it) |
| `ClassGymExpGain` / `CompanyWorkExpGain` / `CrimeExpGain` / `FactionWorkExpGain` | 0.5 |
| `GangUniqueAugs` | 0.5 |
| `StaneksGiftPowerMultiplier` | 1.5 |

`calculatePercentMoneyHacked` multiplies by `currentNodeMults.ScriptHackMoney`
(`src/Hacking.ts:54`) and `calculateHackingExpGain` by
`currentNodeMults.HackExpGain` (`src/Hacking.ts:38`). So **any offline model that
calls those functions today over-predicts hack money by 5× and hacking
experience by 2.5×**, with every formula exactly right — the second failure mode
CLAUDE.md's calibration section describes, in its purest form.

`ServerMaxMoney` and `ServerStartingMoney` do *not* have this problem, because
they are applied when the `Server` is constructed and the live save therefore
already carries the adjusted figures.

`horizon.mjs` fixes this by `Object.assign(currentNodeMults,
getBitNodeMultipliers(bitNode, sfLevel))` from the *live* BitNode number, and
prints the assertion as CHECK 0. Mutation rather than reassignment because the
bundle exports the object, not a setter. **Any other tool in `tools/sim/` run
against this save needs the same fix.**

### 0b. `w0r1d_d43m0n` needs hacking **9000**, and that is a multiplier
constraint, not an experience constraint

`servers.ts:1553` gives `requiredHackingSkill: 3000`;
`ServerHelpers.ts:422-424` multiplies it by `currentNodeMults.WorldDaemonDifficulty`,
which is 3 in BN4. So 9000.

`calculateSkill(exp, m) = floor(m·(32·ln(exp + 534.6) − 200))`
(`PersonObjects/formulas/skill.ts:13`) inverts to

```
exp(L) = e^((L/m + 200)/32) − 534.6
```

At the live `m = 1.16` (Source-File 1 level 1, +16%; BN4's
`HackingLevelMultiplier` is 1):

| level | exp required |
| --- | --- |
| 199 | 1.12e5 |
| 210 (NiteSec backdoor) | 1.48e5 |
| 341 (The Black Hand) | 5.1e6 |
| 506 (BitRunners) | 4.5e8 |
| **2500 (Daedalus invite)** | **9.3e31** |
| **9000 (w0r1d_d43m0n)** | **3.6e107** |

So the level ladder in *this life* runs out somewhere around 500–800 and then
stops: the log curve means the last few hundred levels each cost an e-fold of
experience. Every rung above that is bought with `m`, not with exp.

The two partial derivatives make the asymmetry exact:

```
∂L/∂ln m = L                    (linear in the multiplier)
∂L/∂ln E = 32·m                 (logarithmic in experience)
```

so a 1% multiplier is worth `L/(32m)` times as much as a 1% of experience —
**~6× at the level this run sits at (low 200s), 242× at level 9000**. And the multiplier is
permanent across installs while experience is destroyed by one
(`prestigeAugmentation`). This is the same asymmetry that won BitNode 1, falling
out of the formula rather than being asserted.

⇒ **Experience has no terminal value. Its entire worth is instrumental and
local: it raises income, and it crosses the level thresholds that unlock richer
targets and faction memberships.** That is what makes its price derivable rather
than chosen.

### 0c. The 7-minute experiment did not measure `batch.js`

From `.telemetry/batch.txt` (the run that produced the $0/sec): `uptimeSec 482`,
`loops 2401` (so the controller really did run for 482s at `loopMs 200`), and
**`opsDispatched: 9`, `threadsDispatched: 894`** — nine operations in eight
minutes, against a fleet reporting `utilPct: 97`. A batcher with the fleet to
itself dispatches an op per target per second in prep.

97% utilisation with only 894 of its own threads dispatched means the RAM was
somebody else's. `seed.js --watch` re-runs its placement pass every 60s and
re-fills every rooted host with `early.js`; `batch.js` kills `early.js` once, at
startup. The two were fighting, and the fleet-wide money rate over that window
in `history.jsonl` is **exactly $0/sec for 9 consecutive minutes** — neither
controller was earning.

So the measured "$0/sec, health: prepping, placeFails: 0" is real but it is not
a measurement of prep cost. It is a measurement of two controllers sharing a
fleet. `placeFails: 0` is consistent with this and was the misleading part: the
batcher could place the little it asked for; it just never asked for much.

**`batch.js` throughput and prep cost are therefore NOT CALIBRATED against this
life.** The model computes them from source; the tool says so on every run.

### 0d. Two tools that have silently stopped working

* **`tools/sim/verify-alloc-shipped.mjs` dies at module load.** Line 46 is
  `const B = await import("../../batch.js")`, and `batch.js` now begins
  `import { reporter, describe, record } from 'status.js'` — a bare specifier,
  which node resolves as a package name and cannot find. This is the same shape
  as invariant B5's `placement.test.mjs` ("a test that stops testing and still
  reports green"), recurring in the file that is supposed to be one of the three
  calibration shapes. `horizon.mjs` loads `batch.js` by reading the source and
  rewriting only the module specifier to a file URL, asserting the rewrite count.

* **`.telemetry/mults.txt` has no writer.** `grep -rn "mults.txt"` over every
  root `.js` and over `tools/` returns nothing, and the file carries no `at`
  timestamp, so nothing can tell that it is stale. Its contents
  (`chance 1.609, speed 1.611, money 1.679, growth 1.460`) do not match the live
  player multipliers, which are a flat `1.16` on everything (Source-File 1
  level 1). It is a survivor of a previous life. Do not read it; read
  `player.mults` out of the save.

---

## 1. The model

### 1a. What is being minimised

```
minimise  T   subject to   L(T) >= L*        L* = 3000 * WorldDaemonDifficulty
```

over the state `x = (M, E, R, P, H_ram, augs)` and the control `u` — which
controller runs, at what target count, at what money floor, and what money is
spent on next.

Money and experience are not in the objective. They enter only through the
dynamics, which makes their exchange rate a *shadow price of the terminal
constraint* rather than a preference.

### 1b. The shadow prices, and why the compounding cancels

Write `T(x)` for the seconds remaining to the terminal condition. Define

```
lambda_M = -dT/dM    seconds saved per dollar
lambda_E = -dT/dE    seconds saved per point of experience
pi       = lambda_E / lambda_M          dollars per point of experience
```

The reinvestment loop makes income proportional to accumulated capital (money
buys RAM at a roughly constant price; RAM earns at a roughly constant rate), so
over a segment

```
dM/dt = M/tau      =>   M(t) = M0 e^(t/tau)   =>   T = tau ln(C/M0)
```

for a milestone `C`. Hence

```
lambda_M = -dT/dM0 = tau/M0 = 1/rho
```

An extra point of experience raises the level, which raises `rho` by a
*fraction* `delta = (1/rho)(drho/dE)`. A permanent fractional improvement to a
growth rate shortens `tau` by the same fraction, so

```
T -> T/(1+delta)    =>    lambda_E = T * delta
```

and therefore

```
   pi = lambda_E / lambda_M = T * delta * rho = T * drho/dE
```

**The compounding cancels.** It changes the level of both prices and not their
ratio. That is the result that makes the model cheap: the reinvestment loop has
to be modelled to decide *when to install* and *whether to buy RAM*, but not to
price experience against money.

`ev.mjs`'s `expPriceFromHorizon` has exactly this form. What it was missing is
that `horizonSeconds` is not a caller's choice — see §1c — and that this price
covers only the *continuous* channel.

### 1c. The horizon is the next step change, and which steps count

The rate models are stationary. They hold while the target set, the fleet and
the level are fixed. Under a receding-horizon (MPC) formulation the right
horizon is the soonest moment the stationary premise fails — not a window
someone picks.

But there are two kinds of step change and they are not symmetric:

* **Level steps.** A rooted server crosses `requiredHackingSkill` and becomes a
  target; a story server becomes backdoorable and its faction becomes
  joinable. `horizon.mjs` **carries these exactly** rather than stopping at
  them: every rate function derives its target set from the level, and §5's
  rollout integrates forward carrying experience and recomputing the level from
  `calculateSkill`. Stopping at a level rung would make the decision
  hypersensitive to whichever server happens to be two levels away — a 14th
  target joining a 13-target fleet moves the rate by a few percent.
* **Money steps.** A port program roots more servers; a home RAM upgrade
  doubles home. These buy **fleet RAM**, which no rate function re-derives. The
  model really does go stale at one, so **the money rungs, and only the money
  rungs, set the horizon.**

Because the two controllers earn at different rates they reach the money rungs
at different times, so the horizon is policy-dependent and the tool takes the
sooner of the two — that is where the model stops being able to speak for
either arm.

### 1d. The value functional

```
V_u(H) = sum_i  integral_0^H  rho_i(L(t)) * 1[t > setup_i] dt
         with   dE/dt = eps_u(L(t)),   L(t) = calculateSkill(E(t), m)
```

evaluated by a 40-step forward solve with the rate cached per level — a few
dozen evaluations of closed-form expressions, no event queue, no simulator.

Two things in that expression are load-bearing:

* **`setup_i` is per target, and both arms have one.** `batch.js` pays a prep.
  `early.js` at its current floor pays nothing *only because the floor is below
  where the targets already sit* — raise the floor and its `grow` branch has to
  lift the balance first, earning nothing on that target meanwhile. Charging
  only one arm for its setup is the error this whole exercise exists to avoid,
  in the other direction.
* **Experience is NOT delayed by setup.** `batch.js`'s prep is entirely grow and
  weaken, `early.js`'s ramp is entirely grow, and both pay full experience per
  thread (`NetscriptFunctions.ts:291,:365`). Only the money is deferred.

### 1e. Why the terminal condition dominates everything above

`L = m*(32 ln(E+534.6) - 200)` gives

```
dL / dln(m) = L          dL / dln(E) = 32*m
```

so a one-percent multiplier is worth `L/(32m)` times a one-percent of
experience: **6x at today's level 224, 242x at level 9000**. And the multiplier
survives an install while the experience does not.

The consequence for this life is concrete and checkable: at `m = 1.16`, level
2500 (the Daedalus invite) needs `9.2e31` experience and level 9000 needs
`1.0e108`. Neither is reachable. **This life must end in an install, and its job
is to buy multiplier.** That is what makes money the terminal currency and
experience purely instrumental — and it is the model's answer to "what price
experience", not a parameter.

---

## 2. The two controllers

### 2a. `early.js`, in closed form

`early.js` is a priority ladder, not a scheduler, so there is no plan to read.
But a steady state must conserve the target's money and its security, and those
two conservation laws plus the RAM budget pin the thread-rates uniquely.

With `h, g, w` the thread-rates (threads x ops per second) against one target
and `m` the balance it is hacked from:

```
money      c*phi*m*h = (k*m_g + 1)*g
security   0.002*h + 0.004*g = weakenEffect * w
RAM        r*(h*T + g*3.2T + w*4T) = R
```

giving

```
beta  = g/h = c*phi*m / (k*m_g + 1)  * growWaste
gamma = w/h = (0.002 + 0.004*beta) / weakenEffect
h     = R / (r*T*(1 + 3.2*beta + 4*gamma))

$/sec   = c*phi*m*h
exp/sec = e*(h*q + g + w),     q = c + (1-c)/4
```

`q` is the hack-experience derating — a failed hack still pays a quarter
(`NetscriptHelpers.tsx:618-619`) — and dropping it, as every naive index does,
overstates experience on a low-chance target by up to 4x.

`growWaste` is the `calculateGrowMoney` cap (`grow.ts:48-56`): past
`ln(moneyMax/m)/k` threads a grow op's extra threads do nothing. It is 1 on
every target here at the live floor and is what bends the floor curve in §4b.

**Two inputs are measured, not assumed.** The operating security and the
operating money fraction both come out of the live save: every target under
`early.js` reads `minSec + 2.8 .. minSec + 5.0` and exactly `5.0%` of
`moneyMax`, which is `seed.js --floor 0.05`. Placement is `seed.js`'s own
index pairing (`seed.js:131-193`), reproduced rather than approximated by
pooling the fleet — it is what decides that the biggest host works the richest
server.

### 2b. `batch.js`

`batch.js` has a plan and exports the function that makes it, so the model calls
`planBatch` out of the shipped file. What is left to model is the period and the
prep.

**Period.** `batch.js:933` is `max(4*spacing, weakenTime/maxInFlight)` with
`maxInFlight = floor(slice/plan.gb)`. `target-count.mjs` and `alloc.mjs`
over-predicted live income by **+38.5%** by treating `4*spacing` as the period
when it is a floor. Two corrections, both mechanical: the floor is
`ceil(4*spacing/loopMs)*loopMs` because a launch can only happen on a controller
tick; and on a fleet this size `weakenTime/maxInFlight` is the binding term by
an order of magnitude anyway. `alloc.mjs`'s third fitted term,
`loopMs*(skips+placeFails)/batches`, cannot be evaluated — this life has
`batches: 0` — so it is swept as `skipFactor` in the sensitivity block instead
of being quietly assumed to be 1.

**Prep**, derived rather than guessed, following `batch.js`'s own two strict
phases (`batch.js:814-884`): weaken to `minSec` in waves of
`totalRam/nTargets/ram.weaken` threads, each taking `calculateWeakenTime` **at
current security** (`batch.js:830` — the prepped figure under-estimates by the
security ratio, 3-6x on a degraded target); then grow to `moneyMax` at minimum
security in waves of `budget/(ram.grow + 0.08*ram.weaken)` threads, each taking
`calculateGrowTime` and multiplying money by `e^(k*wave)`.

### 2c. `batch.js` is crippled in BitNode 4, by a known bug

`batch.js`'s inlined `hackFraction` (batch.js:209-214) is

```js
(difficultyMult * skillMult * mults.money) / 240
```

against the game's

```ts
(difficultyMult * skillMult * person.mults.hacking_money * currentNodeMults.ScriptHackMoney) / 240
```

`bncheck.mjs`'s ASSUMPTIONS table already records this. It is now *live*: with
`ScriptHackMoney = 0.2`, `batch.js` believes every hack thread takes five times
what it takes. It therefore sizes its bite at a fifth of the optimum and sizes
grow to replace five times what was actually removed. The model reports both
numbers — what the shipped controller achieves, and what it would achieve with
the BitNode in its `phi` — and the gap is currently **$112k/sec vs $254k/sec**.

The fallback only applies without `Formulas.exe`; buying it ($5b) makes
`attachMath` take the game's own path and the bug disappears. That is a second,
cheaper fix than editing the file.

---

## 3. Calibration

The `early.js` arm is calibrated **by integration over the whole recorded life**,
not against a window. Section 2c of the tool walks every sample in
`history.jsonl` since the last prestige, rebuilds the fleet at each one from the
recorded rooted count (rooting is gated on open ports alone — `ns.nuke`,
`NetscriptFunctions.ts:504-520` — so the rooted set is a prefix of the port
ladder), replays `seed.js`'s own placement at that moment's level, and advances
**one money state per target**:

```
m above the floor   the loop never calls grow, so every thread hacks:
                    dm/dt = -c*phi*h*m, and the player's income is exactly -dm/dt
m at the floor      the conservation solution above
```

The crossing between the two branches is solved for *within* the step, so the
answer does not depend on the telemetry sampling interval.

Measured income is `sum of the positive money steps`, because a negative step is
a purchase; netting purchases off would report income as a lower bound and
silently pass a model that is too small.

### 3a. Result

```
phase                                  model $ (drain+income)      live $   err      model exp    live exp   err
t=  1..389min  9root/ 32GB L  1->193   $11.70m ($10.17m+$1.53m)    $10.29m   +14%    1.06e+5    9.33e+4   +14%
t=390..406min 16root/ 32GB L193->195    $2.70m ($2.53m+$175.4k)    $597.6k  +352%    8.84e+3    5.19e+3   +70%
t=406..445min 29root/ 32GB L195->206   $22.09m ($21.11m+$982.7k)   $258.73m   -91%    6.00e+4    3.42e+4   +76%
t=446..448min 29root/256GB L206->206    $1.26m ($1.19m+$66.8k)     $811.8k   +55%    4.37e+3    0.00e+0      -
t=448..466min 71root/256GB L207->224   $27.43m ($25.75m+$1.68m)   $104.32m   -74%    9.59e+4    8.31e+4   +15%

ok  longest phase, cumulative $  : model $11.70m vs live $10.29m  err +13.7%  (tol 25%)
ok  longest phase, cumulative exp: model 1.06e+5 vs live 9.33e+4  err +13.9%  (tol 25%)
```

The assertion is taken on the longest phase — 389 minutes, 85% of the samples —
because that is the only stretch of this life in which `early.js` is documented
to have been the sole controller. **+13.7% on money and +13.9% on experience over
6.5 hours.**

The life total is printed and deliberately **not** asserted, with the reason
stated: after t≈406min two phases carry income this model does not claim
($258.7m and $104.3m against modelled $22.1m and $27.4m), because `batch.js` ran,
purchases and contracts landed, and the fleet was being shared. Asserting
against a mixture would be asserting against a quantity the model does not
predict. The phases are still printed with their errors, so the gap is visible
rather than excused.

### 3b. What the calibration found — "$498/sec" is 93% capital

The 339-minute stretch of this life at 9 rooted servers earned **$10.13m, which
is exactly $497.8/sec**. That is the figure the naive experiment compared
`batch.js` against.

Of the model's $11.70m over that phase, **$10.17m is the one-off drain of seven
servers' starting balances** — a server at prestige holds
`ServerStartingMoney/(25*ServerMaxMoney)` = **26.7%** of its maximum
(`Server.ts:75-77`), and `early.js --floor 0.05` takes it to 5% and leaves it
there. Only **$1.53m** is income.

So:

> **The "$498/sec early.js baseline" is ~87% liquidation of the starting
> balances and ~13% income.** Over the whole life the split is 93%/7%. The
> steady-state income underneath it is about **$200/sec**, which is what the
> 117-minute sub-window at constant level actually shows.

The naive experiment therefore did not compare an investment against income. It
compared `batch.js`'s investment against `early.js`'s **disinvestment** — a
stock being sold off, scored as a rate. That is the same error as scoring
end-of-run cash, with the sign flipped, and it is why the answer was so lopsided.

There is a corollary worth keeping: **the drain is a one-time endowment of the
BitNode, not a property of the controller.** Any controller collects it once.
It should never appear on either side of a controller comparison.

---

## 4. The recommendation

Numbers below are from one run of `node tools/sim/horizon.mjs` (~30s, read-only
against the daemon). Re-run it; the live world moves fast enough that these
figures drifted noticeably over the two hours they were being derived, and the
*shape* of the answer is what is stable, not the digits.

### 4a. The decision

```
horizon H = 13.4min   (home RAM 256 -> 512GB at $318.16m, which batch.js reaches in 13.4min
                       and early.js in 3.0h; the sooner binds)

early.js as running    $8.5k/s  + 84.0 exp/s, setup 0       -> V =  $6.78m
early.js --floor 0.5  $85.9k/s  + 84.0 exp/s, setup <= 1.9h -> V = $25.67m
batch.js             $112.4k/s  + 56.7 exp/s, setup 4.3min  -> V = $64.61m
-> batch.js
```

**Break-even, which is the output that matters:**

| comparison | batch.js overtakes at |
| --- | --- |
| vs `early.js` as running (`--floor 0.05`) | **4.5 min** |
| vs `early.js` at `--floor 0.5` | **5.2 min** |

The horizon came out between **10 and 13 minutes** across runs an hour apart, so
batch.js wins with roughly 2-3x of headroom. Below ~5 minutes of horizon the
answer flips to `early.js`, and the tool prints the whole rollout against
horizon so the flip is visible rather than asserted.

The stable statement, which is the one to act on:

> **`batch.js` wins whenever the horizon exceeds about 5 minutes. The horizon —
> set by the next purchase that changes fleet RAM — is currently 10-13 minutes.
> So: `batch.js`.** It would take the batch model over-predicting by 2.5x, or a
> prep three times longer than modelled, to reverse that.

### 4b. The cheap thing nobody is doing: `seed.js --floor`

At the floor, `beta = c*phi*m/(k*m + 1)` and `k*m` exceeds 1 by three orders of
magnitude on every target here. So `beta` — and therefore the split of threads
between hack, grow and weaken — **does not depend on the floor at all**. Only
the balance each hack is taken from does. Hence:

> **`early.js` income is linear in the money floor, and its experience is flat in
> the money floor.**

Measured out of the model:

```
floor   5%:     $8.4k/s    82.0 exp/s     <- the live value (seed.js's default)
floor  10%:    $16.5k/s    82.1 exp/s
floor  25%:    $41.1k/s    82.1 exp/s
floor  50%:    $81.8k/s    82.0 exp/s
floor  75%:   $118.7k/s    81.5 exp/s     <- bends: calculateGrowMoney caps at moneyMax
```

`seed.js` passes `--floor 0.05`; `early.js`'s own default is `0.5`. **That one
flag is worth about 10x on money at zero cost in experience**, and it is a
one-word change rather than a controller swap.

It is not free: the ramp from 5% to 50% is a grow that earns nothing on that
target while it runs, up to ~1.9h on the slowest target here, and the tool
charges it. Over the current 13.4-minute horizon that ramp is why `batch.js`
still wins.

This row is flagged NOT CALIBRATED because the live game runs one floor — but it
is not pure extrapolation. The backtest reproduces this life *while its targets
fall from 26.7% of maxMoney to the 5% floor*, so the linearity in `m` is
exercised over a 5.4x range of money by measured data. Above 27% it is
extrapolation. It is cheap to settle: set the flag and re-run the tool twenty
minutes later.

### 4c. What is NOT calibrated, and how much it would have to be wrong

| unknown | value used | how wrong to flip the decision |
| --- | --- | --- |
| `batch.js` steady throughput | $112.4k/s from `planBatch` + the real period | over-predicting by **2.5x** |
| `batch.js` prep | 4.3 min, derived from the game's own durations | would have to be **12.5 min** |
| `alloc.mjs`'s skip/placeFail term | 1.0 (the optimistic end) | 3.0 still leaves batch.js at $37.5k/s |

None of the three is close to flipping it at the current horizon. All three
become measurable the moment `batch.js` lands one batch: `.telemetry/batch.txt`
already records `batches`, `periodSec`, `unsafeSkips`, `placeFails` and `earned`
per target.

---

## 5. Actionable, in order of value per unit of effort

1. **Stop `seed.js --watch` before running `batch.js`.** They fight; the one
   recorded head-to-head is a measurement of that fight and nothing else.
2. **`seed.js --floor 0.5`** (or drop the flag and take `early.js`'s own
   default). ~10x money, no experience cost, one word — and it is the right
   fallback whenever `batch.js` is not running.
3. **Set `currentNodeMults` in `tools/sim/`.** Everything offline is currently
   doing BitNode 1 physics against a BitNode 4 save: 5x on hack money, 2.5x on
   experience. The one-line fix is `Object.assign(currentNodeMults,
   getBitNodeMultipliers(bitNode, sfLevel))`; the better fix is to export
   `replaceCurrentNodeMults` from `build.mjs`'s `ENTRY`.
4. **Fix `verify-alloc-shipped.mjs`'s import**, which has been dead since
   `batch.js` gained its `status.js` import, and add an invariant that catches
   the next one.
5. **`batch.js`'s `hackFraction` needs `currentNodeMults.ScriptHackMoney`** —
   already in `bncheck.mjs` ASSUMPTIONS, now live and costing about 2.3x. Buying
   `Formulas.exe` ($5b) routes `attachMath` through the game's own formulas and
   fixes it without touching the file.
6. **Nothing here should become an in-game rule.** The decision moves with the
   horizon and the horizon moves with the fleet; the break-even is 4.5 minutes
   and the horizon has been between 3.5 and 13.4 minutes across runs an hour
   apart. A fixed threshold would have been right this morning and wrong this
   afternoon. Run the tool; it costs about 30 seconds and prints its own error.
