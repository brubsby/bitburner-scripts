# One Bayesian decision layer (bayes.js + plan.js)

## Why

Every ~5 min progress.js re-ran the exit simulations (exitplan.bestExitPolicy,
countexit.bestCountExit / bestCountRoute) on POINT estimates and took the
argmin by any margin. The forecast itself moves ~9-12h per hour of wall time
(installgate `exitCalibration`), far more than the gaps it chose between
(live 2026-09-26: 67.06 / 67.69 / 67.73 / 68.08h over the top four count
routes). So the choice flipped with every re-fit: The Syndicate (27.3h, strength
trained 1->202) -> SmartJaw @ Bachman 5 minutes later; installs held 4h on a
0.14h near-tie; the cadence flipped with each trader-return estimator.

## The layer

```
/tel/stock-hist.txt ─┐
exitCalibration     ─┤ bayes.js  posteriors (pure, conjugate)
lifetimes ledger    ─┤
pass observations   ─┘
        │ draws (seeded, COMMON RANDOM NUMBERS: one z-vector per draw, shared by every option)
        ▼
countexit.countExitAt / routeExitAt  (the existing simulators, one fixed policy per option)
        │ H[option][draw]  x  structural-discrepancy factor
        ▼
plan.js  decide(): expected exit + switch cost, commitment (regret rule)
        ▼
/tel/plan.txt  (ONE committed plan; other deciders read it)
```

### Posteriors (bayes.js)

| input | likelihood | prior | data |
| --- | --- | --- | --- |
| trader return r(W) (/s) = r0 s(W/W*) | per interval of Δt ticks past each life's first hour: x = ln(1+ΔPnl/W)/Δt_h ~ N(r0 (1+d_j) s(W; W*), κ² σ(W)²/Δt_h) at the book W it started from; the life's level d_j ~ N(0, τ²) integrated out in closed form; grid posterior on (ln r0, ln W*) (`bayes.traderRwPosterior`) | the shipped trader on the game's market (`traderw.RW_PRIOR`, tools/sim/stocks/rw.mjs + rwfit.mjs): pre-4S r0 0.798/h, W* $2.68e11, sd ln 0.4 / 0.8 (stated), τ 0.22 and σ(W) from the sim, κ² ~ IG(3, 2) | `/tel/stock-hist.txt` (flows excluded exactly as `nodeecon.realisedCapital`; 4S rows `s4` are the 4S curve's) |
| structural error s² | relative forecast residual per same-life pair r = (E_b − (E_a − Δh))/E_a ~ N(0, 2s²) (Inverse-Gamma, known mean 0) | IG(a0 = 2, b0 = 2·0.1²) — 10% prior | `exitCalibration.samples` |
| install cadence: ln M per life-hour r_n and life length L_n | per node y_n = ln(Σg/ΣL) ~ N(θ_n, σ²/n_eff) and ln(mean L) ~ N(θ_n, σ_L²/n); θ_n = μ + β·c_n + u_n, u_n ~ N(0, τ²) (random effect per node, covariate c = ln aug money × rep cost); σ² pooled over nodes (IG) | μ ~ N(ln 0.05/h, 1.5²), N(ln 3h, 1.5²); τ 1.0 / 0.7; β ~ N(−0.5, 0.5²) / N(+0.3, 0.5²) — all stated | lifetimes ledger, re-records merged, stall lives excluded (see below) |
| fresh-life hacking income (prior) | per life y = ln(Σ realised / Σ formula) over its 0.5h windows; y = θ_n + u (t, ν 4), θ_n = μ + v_n (node effect), σ² pooled (IG) | freshlife.js's simulated fresh life at this age × exp(E θ_n); μ ~ N(0, ln 10²·2) (formula unbiased, stated), τ 0.5 stated below 3 other nodes | 7 lives (history.jsonl + earnings ledger, `FRESH_CALIBRATION`) + every life tel.js records with its inputs (`/tel/freshcal.txt`) |
| script exp rate (prior) | the same, on exp | freshlife.js's exp/s at this age × exp(E θ_n); stated scatter ln 3 | 37 lives |
| this life's income / exp | ln(rate) measured with sd 0.3·√(1h / hours) (normal–normal, `ratePosterior`) | the formula prior above | this life's hacking stream (earnings ledger / nodeecon) and tel.js's script exp |
| hacking exp rate, faction rep rate | mean ln(rate) per 30-min bin ~ N(μ, σ²) (NIG); rep drawn ABSOLUTE (a noisy pass — live 13.04→10.72→13.41 rep/s — moves it by its share), exp as the current point × its spread (it trends with the level) — superseded for exp by the formula posterior where it prices | σ_ln prior 0.3 | this life's pass observations, kept in plan.txt `obs` |
| install cadence under the purchase model | the node's own gaining lives y_n (as above) update a node prior N(ln r_model, s_m²) | r_model = lifeplan's ln(M)/h at the length it chose; s_m IG(2, 0.5²) — sd 0.5 STATED, updated by other nodes' lives recorded with the model's rate (`cadenceModel`) | lifetimes ledger |
| count batch's fresh-life earnings | per completed node life y = ln(earned / model) at its end (t) | lifeplan.freshLifeMoney (the formula's hacking stream + trader + flat) from the install; scale 1, x3 stated | tel.js earnings ledger |
| option-specific structural error s_i | per consecutive same-life passes, x = Δln(H_a/H_b)/2 ~ N(0, s_i²) over the options both rank (IG) | 2% | the top-8 route exits each pass, kept in plan.txt `points` |
| gym rate | bodyplan formula (calibrated exactly 2026-09-19) × residual exp(N(0, 0.1²)) | prior only — NOT CALIBRATED (no live residual feed yet) | — |
| prices given the count | deterministic (1.9^k, 1.14^L) | — | — |
| rep → favor | deterministic (favor.ts) | — | — |

The draw for a posterior is a draw of the MEAN (the simulator runs many lives
on one rate; per-life scatter averages out), except the discrepancy, which is
a draw of s² then ε ~ N(0, s²) (Student-t marginal).

### Forecast error is one model's error

Every exit sample (and every rate observation and route ranking) is tagged
`ver` — a hash of every module in progress.js's import graph as it stood
when the planner started (`plan.modelVersionFrom`; nothing to bump, so
nothing to forget) — and `boot`, the planner process's start. A pair counts
toward s and toward the calibration score only when both ends share life,
version and process; the rest are excluded and COUNTED (`driftExcluded`,
`calibration.excluded`; untagged legacy samples are excluded too — whether
they straddle a deploy cannot be told). The likelihood is Student-t (nu 4,
stated): one mis-priced pass is down-weighted, not squared. Live replay
(2026-09-27, 48 samples): the Gaussian fit read s = 59.8% — almost all of it
ONE pass (05:32 read 108.5h between 16.1h and 12.7h); robust, s = 6.2%, and
6.1% with the 3 pairs across the 4 committed deploys excluded; calibration
89% -> 79% inside the 80% interval (PIT var 0.038 -> 0.061 vs 0.083).
Cost: after a deploy or restart s rests on its prior (10%) until same-version
pairs accumulate (one per ~15 min).

### A fresh life is not blind

Early in a life two exit inputs can be unmeasurable: income (the batcher
prepping its target reads $0/s for up to an hour) and the faction reputation
rate (no faction work yet — live BN1 00:18 the exit read "could not price the
reputation leg"). Each now comes from a prior instead of leaving the exit
unpriced, marked in the inputs and in plan.txt `exit.income` / `exit.rep` /
`exitSource`:
- income: THE GAME'S FORMULAS (see "Structural priors" below) — freshlife.js's
  fresh life at this age, times the formula's error posterior. It replaced
  `bayes.incomePrior` (earlier lives at this age scaled by M, a node's first
  life borrowing other nodes' lives scaled by ScriptHackMoney): BN9's second
  life read $5.95e7/s x/÷ 159 from four BN1 lives and measured $2.5e3/s
  (x23,000: ServerMaxMoney 0.01 is not ScriptHackMoney). `incomePrior` and
  its legacy reconstruction are kept for the calibration's legacy windows.
  It is the HACKING stream only (tel.js's third sample element). A life
  recorded before that column existed (2026-09-29) is reconstructed per
  window as total less an upper bound on every other source
  (`bayes.legacyHackingWindow`, PRIORS.legacyNonHack: the trader's whole
  realised profit charged to the window, other sources $1e7/s), used only
  where >= 50% of the window is provably hacking; an inseparable window is a
  censored upper bound on the mean (Tobit), never a value; a life whose
  multiplier is not in the lifetimes ledger is excluded (streams SI5, SI7-SI9).
- the hacking income is then a POSTERIOR in every life (`bayes.incomePosterior`):
  the prior updated by this life's own hacking stream (`lifeHackingObservation`,
  sd ln 0.3 x sqrt(1h / hours earning)). A prepping batcher's $0/s is no
  observation; five minutes of landings weigh about as much as a same-node
  prior; hours dominate. No switch from prior to "measured" (streams SI10-SI11).
- reputation: the game-formula estimate (factionplan `estimatedBaseRepPerSec`,
  [TJ6]) with a stated residual (sd ln 0.3, NOT CALIBRATED).
Both are drawn per Monte Carlo draw, so the exit's interval widens with them
(BY14, BN1 00:18 replay: exit 80% 229-457h with both priors; the income prior alone ~2.5x the width of a measured income).

### The trader's return depends on its book (traderw.js)

One pooled rate read a $1m book, a $3b one and a $194b one as noisy
measurements of one number (0.38-0.53/h live BN9 2026-09-29), and the exit
compounded every book at it. The game says otherwise (v3 source):

- $100k commission per order: stockstrat opens a position only when its edge
  covers two round trips, so below ~$2.2m the trader never trades (r = 0);
  just above, ~0.5/h, rising to the plateau (~0.8/h pre-4S) by ~$1e8.
- maxShares (20% of outstanding) and the forecast damage every
  shareTxForMovement shares traded do (0.006 otlkMag) — no price impact in
  v3 — cap what the market absorbs: E(W) = r(W) W saturates at r0 W*
  (~$2e11/h pre-4S in the sim, ~$1.1e12/h with 4S).

Shape (fixed, from the sim): `s(W) = gate(W ≥ Wmin) · (hLo + (1-hLo)/(1+(Wr/W)^k)) ·
(1+(W/W*)^n)^(-1/n)`. The posterior updates r0 and W*; the point is their
means, the draws (plan.makeDraws) r0 and ln W* with their correlation. Every
money leg integrates dW/dt = r(W) W + income: exitplan.hoursToMoney (steps
bounded by 1/100 of the leg's compounding length ∫dlnW/r and 25% growth at
the current rate; the capital starts where the income carries the book over
the threshold), countexit.moneyAfter, lifeplan.freshLifeMoney,
trajectory.incomeModel, and hacknetplan.capitalFV (a marginal dollar compounds
at dE/dW, not r(W)). s(W) is read from a per-(W*, shape) table (0.02 decade;
< 0.03% error) — planperf PP3c guards the pass's CPU. A life's first hour is
not the curve's (the sim drops it; a fresh market's first cycle is known to
the trader, so young books earn above the curve) — it is the warm-up.
[RW1-4] traderrw.test.mjs.

### Structural priors from the game's formulas (freshlife.js)

Three inputs used to wait for finished lives to stand in for a model: the
fresh-life hacking income (earlier lives rescaled), the exp ramp (today's
constant rate plus a measured lag), and the count batch's earnings curve
(countplan refused with "only N completed life/lives recorded in BitNode 9
(need 3) — the fresh ramp is not yet measured"). Each is now a STRUCTURAL
PRIOR from the game's formulas, and the lives are the evidence on its error.

- `freshlife.simulateFreshLife`: the network (servers.ts, [FL1]) at its
  expected stats under the node's multipliers, the ported formulas (hack,
  grow, weaken times; chance; percent; grow log; exp per op; the level curve
  — [FL2] against the game bundle, worst error 4e-16), batch.js's own target
  choice and income model (targetScore, planBatch, the n-target argmax, the
  spill), the prep of each target (weaken to the floor, grow to the max, a
  weaken time per round), the exp farm's share of the fleet (batch.txt), the
  network re-rooted as the openers are re-bought (`FRESH_PORTS`, stated from
  BN9's two lives), home RAM less progress.js's raise and the resident stack.
  ~5ms for 24h; cached in `/tel/freshprior.txt` by its inputs.
- Its error: `bayes.formulaErrorPosterior`, per life y = ln(Σ realised /
  Σ model) over 0.5h windows (the ratio of what the life earned to what the
  formula said, not a mean of logs — BN9's farm-mode hacking lands in spikes
  with $0.6/s between them), hierarchical over nodes like the cadence, the
  Student-t likelihood of the drift. The prior for a new life is formula ×
  exp(E θ_node), spread the predictive for one life. Nothing switches: no life
  → the stated prior; each life adds its precision.
- The same replay code scores lives offline (`tools/sim/freshcal.mjs`, lives
  rebuilt from history.jsonl: exp, home RAM, purchased servers, the rooted
  count; multipliers rebuilt from the installed augmentations × Source-Files ×
  NeuroFlux^k, k pinned by the life's own (level, exp) pairs) and in the game
  (`freshlife.scoreRecordedLife` over what tel.js now records: exp, home /
  purchased / network RAM and the farm share per sample, the multipliers once
  per life; one new life scored per pass into `/tel/freshcal.txt`).
- Within a life the prior is updated by the life's own measurement
  (`ratePosterior`: sd 0.3·√(1h / hours)) — income as before, exp now too.

Held out (`node tools/sim/freshcal.mjs`, [FL3]; THEN = the prior from the lives
that had FINISHED when this one began, i.e. what the plan would have said at
its install; ln realised / prior):

| life | raw formula | THEN prior (x/÷ 80%) | error | in 80% |
| --- | --- | --- | --- | --- |
| exp, BN9 2026-09-28 18:38 (ended 05:42, 11.1h) | x1.92 | x0.90 (3.5) | x2.15 | yes |
| exp, BN9 2026-09-29 05:42 (running) | x1.80 | x1.55 (2.4) | x1.16 | yes |
| exp, BN1 2026-09-28 13:01 (5.6h, to level 7095) | x5.89 | x1.06 (2.0) | x5.52 | NO |
| exp, BN1 2026-09-28 03:24 (2.6h) | x0.72 | x1.09 (2.1) | x0.66 | yes |
| exp, BN8 2026-09-26 13:17 (8.7h, farm) | x0.22 | x0.48 (2.1) | x0.46 | NO |
| exp, BN8 2026-09-25 23:37 (2.2h, farm) | x0.41 | x0.61 (2.6) | x0.68 | yes |
| exp, all 37 lives (BN1/8/9/10) | rms x3.35 | | rms x2.89 | 81% (LOO 65%) |
| income, BN9 2026-09-28 18:38 (ended 05:42) | x0.76 | x1.57 (19) | x0.49 | yes |
| income, BN9 2026-09-29 05:42 (running) | x0.25 | x1.22 (16) | x0.20 | yes |
| income, BN1 2026-09-28 13:01 | x1.26 | x1.92 (28) | x0.66 | yes |
| income, all 7 lives (BN1/9) | rms x12.5 | | rms x12.4 | 86% |

The exp formula misses by node (BN8's farm over-predicts x0.4-0.5, BN9's
under-predicts x1.9 — the farm share and placement losses), which the node
effect absorbs after one or two lives; high-level BN1/BN10 lives with PB of
home RAM run x6-30 above it (the spill's target is not the one modelled).
Income is 7 lives with one legacy x490 window (down-weighted): wide, stated.
Against the prior it replaced ([FL4], live BN9 05:46, 0.08h in): the old
prior read $4.19e5/s (x84 over the $5.0e3/s the next half hour earned, z
-4.5); the one it read later, $5.95e7/s x/÷159 (x2e4 over the life, z -2.5);
the formula prior $7.0e3/s x/÷16 (error x0.71, z -0.2).

THE EXP RATE RISES WITH THE LEVEL (`exitplan.expRateShape`, inputs
`expScalesWithLevel`): an op's exp is fixed and its time ∝ 1 / (level + 50),
so a fleet's rate goes as (level + 50) — the exit integrates every leg that
way from today's rate at today's level (`hoursToLevelShaped`, `expAfterHours`:
chunks of 1% of the level), the sleeves' transfer flat beside it, and the
freshLagH of the formula's fresh life (re-rooting, prep) replaces the
measured lag. On the 01:40 BN9 inputs the climb to 6000 was 218h at the
level-156 rate and is 10h shaped ([FL5]): the rate at 6000 is x29 today's.

THE CADENCE'S PRIOR IS THE PURCHASE MODEL (`cadencePosterior` `modelPrior`):
under the purchase model the node's rate prior is N(ln r_model, s_m²) instead
of the cross-node mean, s_m stated 0.5 and updated by lives other nodes
recorded with the model's rate (`cadenceModel` in the lifetimes ledger, from
2026-09-29); this node's own gaining lives update it by their precision. The
point input is the posterior's median at the model's life length, the draws
its rate at that length ([EX4]). It replaced scaling the model's gain by
(drawn measured rate / median)^w.

THE COUNT CURVE IS A PRIOR THE LIVES SCALE (`countplan.freshCurve` `prior`,
progress.js `countCurveOf`): lifeplan.freshLifeMoney on the exit inputs (the
formula's hacking stream, the trader from the install's cash, the flat
streams; hacknet's rebuild left out, a floor) is the curve; each completed
node life's ln(earned / model) updates its scale ([CP2]). It prices from the
node's first life; the floor remains only where no model can be built.
lifeplan's `moneyScaleOf` is the same posterior (it was the median of the
last four lives' ratios).

### Nothing may spin the page

The planner shares the game's main thread; a loop that never ends freezes the
page with no signal (2026-09-27 11:17, after the c688e2c deploy). Every
sampling loop is capped and every uniform is checked (`bayes.uniformOf`,
`SAMPLER_CAP`): a NaN or stuck source throws `SamplingError`, a generator past
`coop.STEP_CAP` throws `LoopCapError`; the plan publishes either as health
'error'. `[LP1]` fails on any open-ended loop in progress.js's import graph
that neither awaits nor compares an incremented counter to a bound on a
break/return/throw path; `[LP3]` feeds the samplers broken sources.

### Structural discrepancy

H_i,d = sim_i(θ_d) · exp(s_c,d z_d + s_i,d z_i,d − s_d²/2), s_c² = s² − s_i².
The common part cancels in paired comparisons (it moves every option); the
option-specific part s_i is MEASURED from the ranking's own pass-to-pass
jitter. Live 2026-09-26 12:42-12:52: ~0.9% (12 pairs), while the whole exit
moved ~14% — the forecast drifts, the ranking barely does. So on a 69h exit
the rule switches for a ≥1h advantage and holds below ~0.5h (BY6). What the
jitter cannot see — a persistent option-specific bias (a route's detour
priced wrong the same way every pass) — is not modelled; a detour that
re-prices by a large step is an event the rule acts on, as it should.

### Propagation

N = 24 draws (cap), seeded per life with one sub-stream per component (CRN
across options AND across passes of a life, so a re-decision moves only with
the data, and a posterior appearing does not reshuffle the others). Each option is ONE FIXED
POLICY — the (n, lifeH) that its point estimate chose — evaluated per draw
through `countexit.countExitAt` (the same inner body `bestCountExit` loops
over; not a fork). Options: install now / wait w / the committed install time;
the top-K (6) count routes by point estimate plus the committed one.

CPU — THE PASS YIELDS (`coop.js`). Every long search is a generator that
yields after each exit simulation: the Monte Carlo (`plan.*Gen`), the graft
search (`graftplan.chooseGraftsGen`), and the count-route / count-exit scans
(`countexit.bestCountRouteGen` / `bestCountExitGen`). progress.js runs them
through one pacer per pass: it yields whenever the next step would carry the
current block past `PLAN.sliceMs` (40ms), with a MessageChannel round trip — a
macrotask the page renders and takes input between, which a hidden tab's timer
throttling does not touch (a `ns.sleep(0)` per slice would cost up to a minute
each when hidden). The sync APIs drain the same generators, so results are
identical (BY11 asserts it). Budgets inside use the pacer's WORK clock, so a
pause never truncates a search. Measured on a live-size pass in node (232
routes, install scans, both Monte Carlos, graft search): ~700ms of work, 17
yields, longest block ~40ms. Published `cpu`: cpuMs, wallMs, waitMs,
maxBlockMs, yields; healthcheck F fails PLAN BLOCKED THE PAGE when maxBlockMs
exceeds `PLAN.maxBlockMs` (50ms), and PLAN UNDER-SAMPLED when the Monte
Carlo's work budget (`PLAN.budgetMs` 1200ms) left fewer than 8 draws.
`cpu.sections` attributes it: per labelled run (`plan-grafts`,
`plan-install`, `count-route-scan`, ...) its work, longest block and longest
single step with the step's index; PLAN BLOCKED THE PAGE names the section
and step. A long step that stays in one section is code to split; one that
moves between sections from pass to pass is a GC pause.
NOT sliced: the rest of progress.js's pass (spend verdicts, gang and
Covenant exits) still runs synchronously; only the plan's sections are
measured.

### Decision rule (plan.js decide)

With c the committed option and a an alternative, per draw
D_d = H_c,d − (H_a,d + switchCost_a). Switch to the a with the largest E[D]
only if E[D] > 0 AND P(D > 0) ≥ θ (θ = 0.8). The committed option's H is its
REMAINING path from the current state (sunk progress is already in the state:
strength 202 shortens the remaining detour), so lost progress is not charged
twice; switchCost carries only what a switch itself spends (travel, liquidation
commission, a stated 0.05h re-order). No incumbent (new life, leg finished,
committed option gone) -> argmin E[H].

Re-decide only on an EVENT: new life, committed option gone/finished, invite
set changed, posterior moved materially (trader mean by > 1 posterior sd, s by
> 1.5x), or 30 min since the last decision. Otherwise the committed plan is
re-published with `held: 'no event'` and the MC is skipped.

### The install cadence is a posterior, not a borrowed node

`bayes.cadencePosterior` (via `exitplan.installCadence`). The old rule priced a
node on its own lives once it had three, else on the node with the most lives:
BN1's first lives priced on BN8's cadence (x1.103 per 9.31h — BN8's 14h life
and a count-ticket stall in it) and read a ~150-250h exit.

- The ledger is cleaned first (`ledgerLives`). installgate appends an entry
  every pass that orders an install, so an install act.js does not complete is
  recorded again 5 minutes later, longer: BN8's 14h life is nine entries. One
  start (at − lifeH) is one life. `hackMult` is read before the install, so a
  life's gain g = ln(M_next/M) shows in the next entry and is credited to the
  life that bought it; the current node's last finished life takes this
  life's multiplier as its successor; a node's terminal life has none.
- Count-rule lives are their own regime too: a life installgate ended with
  "install: COUNT BATCH" (live BN1 2026-09-28: one ticket every ~25 min)
  measures the rule's choice, not what a life of the node buys; fed back, it
  taught the exit that lives are 1.5h. Excluded and counted (`countLives`).
- Stall lives are a different state, not slow cycles: an install that moved
  the multiplier < 1% (count tickets, favour banking) is excluded from rate
  and length and counted (`own.stalls`, `stallShare`); the count route prices
  those lives itself.
- Per node, the rate is ln(Σg/ΣL) (what an exit over many lives compounds on)
  with sampling variance σ²/n_eff (hour-weighted, n_eff = (ΣL)²/ΣL²); σ², one
  life's scatter around its node, is pooled over nodes (IG). The node effect
  θ_n = μ + β·c_n + u_n: other nodes update (μ, β) (Gaussian, 2×2), giving this
  node the prior N(μ + β·c_n, q + τ²), which its own lives update — exact,
  the node's own data entering once. With σ ≈ 1.1 and τ = 1.0 two of a node's
  own lives already carry ~2/3 of the precision.
- The covariate is the augmentation price, c = ln(AugmentationMoneyCost ×
  AugmentationRepCost). Stated, not fitted: BN1 and BN8 both have c = 0, so
  nothing can identify β yet; it moves a dearer node's prior (BN10: c = 2.3,
  rate x0.3, longer lives) and widens the transfer. τ is stated for the same
  reason (two nodes).
- Drawn: each Monte Carlo draw takes the node's rate and life length from
  their posteriors (the node mean — the exit spans many lives), and
  `applyDraw` sets `cycleHours` and `multGainPerCycle = exp(r·L)` from the
  same draw. The point inputs are the posterior medians.

Replay, live ledger 2026-09-28 00:58 (BY15): BN1 ln M 0.0307/h (80%
0.011-0.083; its own two lives alone 0.024/h), 2.45h lives, own weight 68%;
BN8 0.0461/h (80% 0.023-0.093; own alone 0.052/h), 4.34h lives, one stall
excluded, own weight 86%. The BN1 exit: borrowed BN8 cadence median 152h
(80% 132-184h) -> own posterior median 74h (80% 42-118h).

### The plan decides the count batch (every node)

Outside capital nodes the count batch used to install on countplan's timing
whatever the committed plan said. Its "every obtainable ticket is already in
the batch — waiting cannot add one" is false while reputation rises: live
BN1 02:58 the plan chose w0.068 (24.8h) over installing (28.6h), the 30-min
future bought a second ticket, and the rule installed one ticket — twice in
an hour, each resetting the ~$40-65b book and faction reputation (the exit
read 30.6h -> 42.4h). installgate now lets the plan decide (countDecidedBy
'plan'); the rule remains the fallback without a plan or when the plan says
'never' (its trajectory has no Daedalus count). Replay BY16. At 03:54 the
plan's choice was w1.917 (30.1h, 80% 26.5-33.0h) while the rule would have
installed again (held only by the lead's /install-hold.txt).

### The life's length is a decision (lifeplan.js)

The exit's cycle model multiplied by a constant ln(M) per hour with no
per-install cost, so a shorter life was never worse (03:54 inputs: 0.25h
lives exit 38.1h, 16h 54.9h). lifeplan prices what a life of each length
BUYS: reputation earned at base x (1 + favor/100) per hour at one faction at
a time against each augmentation's requirement (reset at every install), the
favour the life banks (favor.addRepToFavor, raising every later life's
rate), money from the exit model's fresh-life income (scaled to the earnings
ledger's completed lives: x185 on the 06:09 inputs, printed) at the 1.9x
step, NeuroFlux at x1.14 price and requirement per level. Lives of each
length run in sequence over a 48h horizon (the catalogue depleting); the
mean ln(M) per life is the exit's multGainPerCycle at that cycle length; the
soonest exit's length is the cadence (exitInputsOf, cadenceFrom 'purchase
model'); installing when THIS life reaches that length is offered to the
plan as a wait; the draws keep the length and scale the gain by the drawn
rate. Replay (BY18, 06:10 snapshots, owned reconstructed from the ledger's
batches, today's favour): at 02:58 16h lives exit 48.6h against 120.3h for
0.5h lives (0.031 vs 0.008 ln(M)/h); at 03:24 16h, 50.8h against 158.4h.
With reputation unbounded the choice falls to 3h lives — the requirement is
what makes short lives poor. NOT MODELLED: donations (no faction at 150
favour yet), faction_rep rising across lives, sleeves on factions, new
joins, the count gate's value of a distinct augmentation.

### One trajectory basis

Every option is a trajectory SPEC priced by one function
(`plan.trajectoryOf`): install after a wait with that wait's batch, hold to
the exit, or a count route. The install decision prices its options with it;
the graft decision prices "none" and "grafts" on the COMMITTED install's spec
(`basisOf`, its remaining wait); if the install decision switches later in
the pass, the graft options are re-priced on the new spec. Structural noise
is keyed by the trajectory (`noiseKeyOf`: install point + grafts carried),
not by the option label, so the same trajectory in two decisions draws the
same noise and their committed exits agree exactly; `consistencyOf` checks it
every pass (health 'inconsistent', healthcheck PLAN INCONSISTENT). Live 17:51
the two read 23.0h (install w4, a batch lifting hacking x1.94) and 84.9h
(grafts on the default policy, no batch): two trajectories, not one plan.
On the default-policy basis the exit leans on ~20 installs of per-life
ln(M) growth, whose posterior (0.0185 ± 0.0093 /h) gives a long right tail
(exit ~ 1/ln M per h), hence mean 85h vs point 63h; on the w4 basis the batch
dominates and the grafts option reads ~21h with a tight interval (BY12).

### One plan

`/tel/plan.txt`: {at, lastAugReset, node, decisions: {install, countRoute,
factionTarget, bodyLeg, sleeveObjective, spends}, each {choice, meanH, q10,
q50, q90, pBest, stays|switched, why}, posteriors, calibration, cpu, events}.
Readers: the count route passed to the faction schedule (hence the body
step, which trains that join's legs), installgate (`exitCompare.bayes`: the
plan's install decision replaces the argmin and the tolerance rule, published
as `plan`), and the one published `exitH` = the plan's median (q10/q90 in
`exitSource`). The interim hysteresis (`countexit.commitRoute`,
`/tel/countroute.txt`) survives only as the named fallback when the plan
cannot decide. Healthcheck F (`plan.planCheck`): PLAN MISSING / STALE / FROM
ANOTHER LIFE / BROKEN / OVER CPU BUDGET / MISCALIBRATED.

### Calibration

Each forecast sample carries its predictive for the next sample (E_a − Δh,
scale s√2 from the posterior AS IT STOOD then). For every later same-life
sample: coverage of the 80% interval and the PIT u = F(E_b). Published as
`calibration {n, cover80, pitMean, pitVar, ks}`; healthcheck F fails
(PLAN MISCALIBRATED) when n ≥ 8 and cover80 is outside [0.55, 0.97].
The node's realised exit is not observed until the node ends, so this
calibrates the one-step predictive of the forecast, which is exactly the
quantity whose error the decisions are protected against.
