# What the economic model cannot price

Every mechanic this save can **reach today** that the decision core does not
value correctly, ranked by *game brought into the loop per unit of work*.

Written 2026-09-19, BitNode 5, `sourceFiles: {1: 2, 4: 1}`. Re-derive the live
numbers before trusting them; the ranking should outlast them.

## Status, 2026-09-19 (same day, later)

Every item below was built, tested against game source, and verified on the
running game, in the order listed. The histogram at the top is now:

```
unpriceable: 4 of 34   (was 11)
  Silhouette                someCondition (CTO job)   — no job-title model, deliberate
  Bladeburners              bladeburnerRank           — SF6/7, out of reach
  Church of the Machine God location                  — SF13, out of reach
  Shadows of Anarchy        numInfiltrations          — infiltration is excluded
unreachable this life: 2    Illuminati, The Covenant  (combat 1200 / 850 needs more
                            than one install window at these rates; reported with why)
```

| # | item | where | verified how |
| --- | --- | --- | --- |
| 1 | combat stats | `bodyplan.js` (gym rate, `hoursToStat`, `gymLegs`), `joinplan.js` `skills` case | probe: model 37.661 exp/s vs game 37.661 at Powerhouse; Slum Snakes priced 0.2 min, **joined live** at 15:01 after the planner's own crime step |
| 2 | karma / crime / kills | `bodyplan.js` (`crimeChance`, `crimeRates`, `simulateCrime`, `crimeLeg`), `joinplan.js` `karma` / `numPeopleKilled` | probe: Homicide chance 0.6628 vs game 0.6629; karma 10.5 and str exp 26.36 over five attempts, both exact; Syndicate/Tetrads/Speakers/Dark Army price 0.8–16 min |
| 3 | company reputation | already priced (`joinplan.js` `companyReputation` via `companyplan.js`) — the doc above was stale | 0 `companyReputation` nulls live |
| 4 | hacknet | `hacknetplan.js` (formulas, `bestUpgrade`, `verdict`), `hacknet.js` phase 2, `budget.js` `hacknet` priority + money-return exception | live: best level $134 payback 0.9 min of 28 min left → refused by the $178T home claim → exception added → 66 purchases in 30 s, all repaying inside the life |
| 5 | contracts | `contractplan.js` (`spawnPerSec`, `expectedReward`, `contractIncome`), folded into `joinState.incomePerSec` and the exit hoard; published as `progress.txt` `contracts` | 4.5/h, $25k/s at the BN5 shape; Daedalus's `money` blocker now prices (was null for want of an income rate) |
| 6 | stock market | `stockplan.js` (entry cost, one-tick return, `bestEdge`, `verdict`); published as `progress.txt` `stocks` | **bounded**: the verdict refuses with `unpriced: true` until a 4S forecast is read — no trader was wired, no return assumed |
| 7 | intelligence | not built | left as the doc says: a target with no channel; its bonus already enters rep, crime and (now) crime-success pricing |
| 8 | `not` | `joinplan.js` `not` case special-cases `employedBy` (holding the job, not hirability) | 6 nulls → 0 live |
| 9 | numAugmentations | unchanged, deliberately | — |

The body step's actor lives in `progress.js` beside the Leadership step:
crime first (karma or kills short), then one gym class per stat still short,
at the gym the forecast named, travelling if needed. Both legs are ACTIVE
(they hold the work slot) and fit the install window or are reported as
unreachable with a reason. Two RAM constants moved for the two new
Singularity calls: `RAISE_CEILING` 74 → 81 per multiplier unit, mirrored in
`batch.js` and `watchdog.js` and checked by [R5]/[R6].

## The shape of the problem

`joinplan.js:28-47` is the honest statement of scope. Exactly **three**
quantities have a rate model:

| quantity | how it is forecast |
| --- | --- |
| `skills.hacking` | measured exp/sec, inverted through `skill.ts:13` |
| `backdoorInstalled` | forecast *as* a hacking-level target |
| `money` | gap / measured income per second |

Everything else returns `null` — "cannot tell" — and a faction with any
unsatisfied requirement of those types is dropped from the ranking entirely
(`joinplan.js:451-454`). That refusal is correct and deliberate: overstating a
locked faction diverts the run into a wall. But it means **the planner's world
is the hacking axis plus money, and nothing else.**

Measured live, `/tel/factionplan.txt`: **11 of 34 factions unpriceable**, from
47 `hours: null` blockers:

```
skills            28      ← every one a COMBAT stat; hacking prices fine
karma              6
not                6
someCondition      3
numPeopleKilled    2
bladeburnerRank    1
location           1
numInfiltrations   1
```

The distribution is the finding: this is not scattered rot, it is **one missing
model** (combat stats) plus a second (crime/karma) that happens to feed it.

## What IS priced, for contrast

Hacking exp and level, money and income (with a growth trajectory —
`trajectory.js` `incomeModel`), faction reputation (measured rate + trajectory),
augmentation multipliers over six weighted channels (`objective.js`
`deriveWeights`), the IPvGO reputation bonus (`go.js` publishes
`factionRepBonusPct`, `progress.js:383` consumes it), home RAM/cores, purchased
servers, NeuroFlux, city sets and travel, the megacorp desk path as an *option*
(`objective.js` `pathGainWeight`, charisma's worked case), and — as of today —
augmentations whose value is money, granted programs or the focus penalty
(`objective.js` `ONEOFF_EFFECTS`).

## Out of reach — do not build these yet

Gated behind Source-Files we do not own. Listed so nobody re-derives the check:

| mechanic | gate |
| --- | --- |
| Gang | SF2 |
| Corporation | SF3 |
| Bladeburner | SF6 / SF7 |
| Sleeves | SF10 |
| **Grafting** | BitNode feature 10 (`PlayerObjectGeneralMethods.ts:577-579`) |
| Stanek's Gift | SF13 |

**Infiltration is reachable but must not enter the loop.** The minigames are
`isTrusted`-gated and a synthetic key *hospitalises you*
(`Infiltration/ui/InfiltrationRoot.tsx:74`). There is no Singularity API for
them. Any plan that depends on infiltration needs a human, which breaks the
standing invariant that these programs speedrun the game start to finish. It is
therefore not a pricing gap — it is correctly excluded.

---

# The ranking

## 1. Combat stats — training time has no model

**Unlocks the most, costs the least. Do this first.**

`joinplan.js:190-207` prices `skills.hacking` and returns `null` for every other
unmet skill. That single branch produces **28 of the 47** null blockers.

What it blocks, directly:

- **Illuminati** and **The Covenant** — blocked *only* by combat. Their
  hacking, money and augmentation-count requirements already price at 0 hours.
- **Speakers for the Dead**, **The Dark Army**, **The Syndicate**, **Tetrads**,
  **Slum Snakes** — combat plus karma.
- **Daedalus's alternative arm.** Admission is hacking 2500 **or combat 1500**.
  The combat route is invisible, so the planner cannot even compare them.

Slum Snakes is the embarrassment: strength/defense/dexterity/agility of **30**
each — a few minutes at a gym — and the faction is unpriceable.

**Why it is cheap.** The pieces already exist. `expForSkill`/`skillFromExp`
(`installgate.js`) are the same curve for every stat; only a per-stat exp rate
is missing, and gym gains are a closed formula in game source. Automation is
`ns.singularity.gymWorkout()` — no new UI driving, no anticheat boundary.

**Estimated shape:** one pure `hoursToStat(skill, target, state)` beside
`hoursToLevelWindowed`, plus per-stat exp and multipliers threaded into `state`.
Live combat stats are **2** — so every one of these targets is a from-scratch
grind, and the model must say how long honestly rather than assume it is quick.

## 2. Karma and crime — the second half of the same unlock

Six blockers, and they are the *other* requirement on most of the factions above.
Combat alone opens Illuminati and The Covenant; combat **plus** karma opens five
more.

Crime is doubly valuable because it is not a detour: crimes pay money, grant
combat exp, and drive karma at once, so one model prices three effects. Karma
is monotonic and the rates are fixed per crime type, which makes it one of the
easier forecasts in the game — far easier than reputation.

`ns.singularity.commitCrime()` exists, so it is automatable today.

**Free rider:** `numPeopleKilled` (2 blockers) is an *output* of homicide and
needs no separate model once crime is priced.

## 3. Company reputation as a forecastable rate

Half-built already. `objective.js` prices the megacorp desk as an **option**
(`pathGainWeight`, with charisma as the worked case), but a
`companyReputation` *requirement* still returns `null`, so megacorp factions
cannot be scheduled the way a faction grind can.

We hold a live job (`ECorp: Junior Software Engineer`) and
`factionplan.txt` already records `measuredCompanyRates` — the measurement
exists; it is not wired into the requirement pricer.

**Cost:** low-to-medium, and mostly connecting two things that both exist.

## 4. Hacknet — owned, running, and outside the economy

Eight nodes are running. `hacknet.js` reports to `/tel/hacknet.txt`, and
`progress.js:1459` reads it **only** to price Netburners' join requirement.

It is not a budget claimant: `budget.js:53` is
`['join', 'augmentations', 'home', 'servers', 'neuroflux']`. So hacknet spending
never competes with anything, and its production never appears as income the
planner can *choose* to buy. It is invisible in both directions.

**Cost:** medium. Production is a closed formula; the work is making it a real
claimant so it can lose to augmentations honestly.

**Caveat worth measuring first:** hacknet's payback in BN5 is probably poor —
`ScriptHackMoney 0.15` hurts hacking income, but hacknet has its own
multipliers, so the comparison is not obvious. Measure before building.

## 5. Coding contracts — the biggest realised income source, unmodelled

`ctauto.js` solves them and they have been worth **~$1.9b in a single sweep**
this run. But nothing *forecasts* them: contract income appears only inside the
measured `incomePerSec` aggregate, so the planner cannot reason about the
spawn rate, cannot decide to prioritise rooting for contract access, and cannot
price "wait for the next contract wave" against "install now".

**Cost:** low-to-medium — a spawn-rate and reward model.
**Payoff:** improves every money forecast, including the Daedalus donation
route, whose ranking is currently dominated by an income assumption
(`daedalus-plan.mjs` plan C).

## 6. Stock market — reachable, never modelled

`hasTixApiAccess: false`, `hasWseAccount: false` — both are *purchasable*
($200m + $5b), and money is not the binding constraint in this run.

Nothing in the economic model mentions stocks at all. This is the largest
*unexplored* mechanic we can actually reach.

**Ranked below the above because the cost is genuinely high:** it needs a market
model, 4S data is another large purchase, and it introduces a risk dimension the
rest of the model has no vocabulary for. Everything above is deterministic.

## 7. Intelligence — used, but never targeted

`trajectory.js:189` already includes the intelligence bonus in the reputation
rate (`1 + int^0.8/600`), which is correct. But intelligence is never a *target*
and never a channel: nothing values an action for the intelligence it grants,
though BN5 is one of the nodes that grants it (live: **49**).

**Cost:** low. **Payoff:** low, and it compounds slowly. Worth doing only after
the above, and possibly never.

## 8. `not` requirements

Six blockers. `joinplan.js:442-449` refuses deliberately: it never forecasts
*becoming worse* (losing karma, quitting a job). That is defensible. The gap is
that some `not` conditions are permanently satisfiable and could price at 0
rather than `null`.

**Cost:** low. **Payoff:** small — it mostly removes noise from the blocker list.

## 9. `numAugmentations` — leave it refused

Deliberate (`joinplan.js:45-47`): the count moves only at an install, so there
is no rate to divide by, and guessing "one install away" would price Daedalus as
imminent from day one.

**This is the right call and should stay.** Listed only so it is not mistaken
for an oversight — the count gate in `installgate.js` handles it as a
*threshold*, which is the correct shape for a step function.

---

## The ordering argument, in one line

Items 1 and 2 are one project. Between them they convert **36 of the 47** null
blockers into forecasts, open at least 7 of the 11 dead factions, expose
Daedalus's second admission route, and reuse curves the repo already has. Every
item below them is either a smaller unlock, a bigger build, or both.

## How to check any of this is still true

```bash
node -e "…read .telemetry/factionplan.txt…"   # unpriceable[] and its blockers
grep -n "case 'skills'" joinplan.js            # the null branch, line ~190
grep -n "PRIORITY\s*=" budget.js               # who competes for money
node tools/sim/bncheck.mjs 5                   # BitNode assumptions
```

The blocker histogram at the top of this file is the single most useful
measurement: if the `skills` count falls, item 1 is landing.
