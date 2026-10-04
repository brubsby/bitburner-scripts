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
plan.js  decide(): expected exit + switch cost, commitment (expected loss vs value of waiting)
        ▲ width multiplier m, information rate ρ
exitcal.js  calibration: revisions vs the published interval, e-processes
        ▼
/tel/plan.txt  (ONE committed plan; other deciders read it)
```

### Posteriors (bayes.js)

| input | likelihood | prior | data |
| --- | --- | --- | --- |
| trader return r(W) (/s) = r0 s(W/W*) | per interval of Δt ticks past each life's first hour: x = ln(1+ΔPnl/W)/Δt_h ~ N(r0 (1+d_j) s(W; W*), κ² σ(W)²/Δt_h) at the book W it started from; the life's level d_j ~ N(0, τ²) integrated out in closed form; grid posterior on (ln r0, ln W*) (`bayes.traderRwPosterior`) | the shipped trader on the game's market (`traderw.RW_PRIOR`, tools/sim/stocks/rw.mjs + rwfit.mjs): pre-4S r0 0.798/h, W* $2.68e11, sd ln 0.4 / 0.8 (stated), τ 0.22 and σ(W) from the sim, κ² ~ IG(3, 2) | `/tel/stock-hist.txt` (flows excluded exactly as `nodeecon.realisedCapital`; 4S rows `s4` are the 4S curve's) |
| structural error s² | relative forecast residual per same-life pair r = (E_b − (E_a − Δh))/E_a ~ N(0, 2s²) (Inverse-Gamma, known mean 0) | IG(a0 = 2, b0 = 2·0.1²) — 10% prior (dominates b while the realised pairs are far below 10%: see Calibration, suspect (a)) | `exitCalibration.samples` |
| exit predictive width multiplier m | adaptive conformal on the martingale predictive's hit/miss (exitcal.js) | m = 1, applied shrunk by n/(n + 8) | the same samples' revisions and published intervals |
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
nothing to forget) — and `boot`, the game PAGE the planner ran in
(`trace.pageBoot`, performance.timeOrigin). A pair counts toward s and toward
the calibration score only when both ends share life, version and page and
no telemetry gap longer than `PAIR_MAX_GAP_H` (1h; passes run every ~5 min,
samples every ~15) lies between them (`bayes.runBreak`); the rest are
excluded and COUNTED (`driftExcluded`, `calibration.excluded`: `version`,
`boot` = across a page reload, `stale` = across a gap; untagged legacy
samples are excluded too — whether they straddle a deploy cannot be told).
The rate buffers and the option points keep their trailing run by the same
rule (`bayes.runTail`; plan.txt `runDropped`).

`boot` was the planner PROCESS start until 2026-09-30. progress.js is a
watchdog job, a fresh process every pass, so no two samples ever shared one:
every pair was excluded "across a restart", s sat at its 10% prior, the rate
buffers never held more than the pass's own sample and the option jitter had
no pair — the whole calibration layer silently off. What the exclusion is
for is a change in the conditions a pair assumes, and a pass boundary is not
one (the state a pass carries lives in files): a page reload, or a stretch
the page did not run (a freeze, a suspend, a stalled planner) where game time
and wall time part. Replayed on that day (BN9, 12:55Z, the last 48 samples):
42 pairs, s = 7.2% (4 outlier pairs down-weighted), 71% inside the 80%
interval (PIT var 0.081 vs 0.083); the rep posterior from 18 same-version
passes, 26.0 rep/s, sd of ln 0.095 (tools/test BY20). The likelihood is Student-t (nu 4,
stated): one mis-priced pass is down-weighted, not squared. Live replay
(2026-09-27, 48 samples): the Gaussian fit read s = 59.8% — almost all of it
ONE pass (05:32 read 108.5h between 16.1h and 12.7h); robust, s = 6.2%, and
6.1% with the 3 pairs across the 4 committed deploys excluded; calibration
89% -> 79% inside the 80% interval (PIT var 0.038 -> 0.061 vs 0.083).
Cost: after a deploy or a page reload s rests on its prior (10%) until
same-version pairs accumulate (one per ~15 min).

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

ADAPTIVE ALLOCATION ON A RE-DECISION (`plan.ocbaEvaluateGen`, PLAN.ocba;
OCBA, Chen et al. 2000, on paired differences as in sequential Bayesian R&S
with CRN, Görder & Kolonko arXiv:1410.6782). Every option used to get all 24
draws, an option 30h behind the incumbent as many as its closest rival. Now a
re-decision prices n0 = 8 paired draws for every option; the LEADERS — the
committed option and the best alternative by paired mean net of its switch
cost (no incumbent: the best option) — then run draw-major to every draw
(they are the pair decide() gates on and the exits the plan publishes, which
the consistency and exit-stability checks compare, so they are priced exactly
as before); every other option gets further draws only while its paired
difference with the best leader is uncertain relative to its mean — OCBA's
n_k ∝ (σ_k/δ_k)², scaled so each non-leader's Φ(δ_k√n_k/σ_k) reaches its
Bonferroni share of pcs = 0.95 (n_k* = (zσ_k/δ_k)²). Under the expected-loss
commitment (COMMIT.rule) δ_k is the gap to the best alternative LESS that
alternative's value of waiting: an option is out of the running only once its
gain cannot exceed the best one's net (its own net is at most its gain). A leader promoted
mid-run catches up on the draws it skipped. CRN is kept: an option's samples
are the prefix 0..n_k-1 of the one draw sequence (value for value the full
run's, noise keyed by trajectory as before); decide() pairs over the draws
both options priced (`pairedD`), and summarize's mean of a short option is
the CRN control-variate estimate on all N (the anchor's mean plus the paired
difference; `meanOwnH` keeps its own, `nDraws` its count). Each decision
publishes `alloc` {sims, full, saved, pcs (the Bonferroni APCS), perOption,
leaders}; plan.txt `cpu.alloc` sums the pass (healthcheck note "plan
draws"). `simBudget` caps the simulations per decision; `on: false` restores
every option on every draw. Held passes price only the incumbent, unchanged.
The batch choice (chooseBatchGen) keeps every candidate on every draw (it
ranks by unpaired means).
Measured (`node tools/sim/plancpu-bench.mjs`, fresh process per run, 4
alternating runs; [OC2] asserts the answers): the same choice and committed
exit on all 10 fixture decisions; simulations 1248 -> 825 (-34%), dominated
by the live 21:12Z re-decision with all 26 waits (624 -> 290, ~6.0s -> ~2.4s of
work); the screened decisions save less (21:12Z screened 96 -> 87; the PP3
pass's grafts 48 -> 32, gang 72 -> 56, sleeve objective 96 -> 80; two-option
decisions with an incumbent that is not the best save nothing — both lead).
The PP3 re-deciding pass in slices: 541 -> 427ms of work (PP3c 617 -> 546ms),
same machine, different load — the simulation counts are the load-free
measure. PCS on the fixtures is 0.72-1.0: with several options within an
hour of each other 24 draws cannot reach 0.95, and the near ones get every
draw (the full run's answer, at the full run's cost).

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
D_d = H_c,d − (H_a,d + switchCost_a) (hours, common random numbers). The
committed option's H is its REMAINING path from the current state (sunk
progress is already in the state: strength 202 shortens the remaining
detour), so lost progress is not charged twice; switchCost carries only what
a switch itself spends (travel, liquidation commission, a stated 0.05h
re-order). No incumbent (new life, leg finished, committed option gone) ->
argmin E[H].

THE EXPECTED-LOSS RULE (default since 2026-10-02; Eckman & Henderson, IJOC
2022, decide on the expected loss rather than a probability; switching-cost
bandits): switch to the a with the largest E[D] − VOW, if it is > 0. VOW, the
value of waiting one more re-decide interval (30 min), is a preposterior on
the draws (`plan.valueOfWaiting`): the posterior sd of D shrinks by ρ per
interval, so the mean it will have then is drawn with sd σ√(1 − ρ²) —
approximated by the draws' own shape shrunk toward E[D] by
k = m·√(1 − ρ²) (m the calibration's width multiplier, below; skew kept) —
and VOW = E[max(μ′, 0)] − max(E[D], 0) ≥ 0: the expected loss a switch now
locks in that the information would have avoided. ρ is MEASURED: the exit's
80% interval's shrink per interval (`exitcal.infoRateOf`, median over the run
pairs; live BN4 2026-10-02: x0.853/h, ρ 0.924); 0.9 stated below 4 pairs.
Waiting itself is charged nothing (stated). For a Gaussian D,
VOW = τψ(μ/τ), ψ(x) = φ(x) − x(1 − Φ(x)) [EC6].

What changes: a large expected gain at a low P(better) now switches (D ~
N(2.05, 10²), P 0.61: VOW 0.90h < 2.10h), where θ = 0.8 held it; a small gain
at a high P over a rare large loss now holds (+0.05h in 92% of draws, −0.4h in
8%: E[D] 0.004h < VOW 0.02h), where θ took it [EC5]. On a Gaussian D the hold
band is narrow (μ ≲ 0.28τ): the rule switches more often than θ = 0.8 did,
and churn is bounded by the switch cost and the event-driven re-decision, not
by a probability threshold. A wider calibrated spread (m > 1) widens the hold
band in proportion.

THE OLD RULE IS ONE FLAG AWAY: switch only if E[D] > 0 AND P(D > 0) ≥ θ
(θ = 0.8) — `plan.decideByPBetter`, unchanged; `setCommitCalibration({rule:
'p-better'})` makes it the active rule. Either way every fresh decision
records both verdicts (`commit` {rule, switch, agree, old, new}), plan.txt
`rule` states the active and the shadow rule, the calibration state keeps the
last 40 (`calibration.state.commitLog`), and the healthcheck notes how many
disagreed. NOT CHANGED: `decideSpend` (a purchase against the option-specific
error) still uses P ≥ θ.

Re-decide only on an EVENT: new life, committed option gone/finished, invite
set changed, posterior moved materially (trader mean by > 1 posterior sd, s by
> 1.5x), or 30 min since the last decision. Otherwise the committed plan is
re-published with `held: 'no event'` and the MC is skipped.

THE TIMER'S RE-DECIDE IS GATED BY ITS VALUE (`plan.redecideGateOf`,
PLAN.voc; rational metareasoning, Hay, Russell, Tolpin & Shimony UAI 2012,
Callaway et al. 2018). When the 30-minute timer is the ONLY event, the
re-decision is a computation with a price — a full Monte Carlo on the game's
main thread — and its value is what it could recover. Every decided record
carries the choice's paired margins (`marginsOf`: per alternative, D = H_alt +
switch cost − H_choice over the draws both priced, its mean and per-draw sd —
the posterior spread of the difference); held records carry the deciding
pass's. VOC = Σ E[max(0, −D)] = Σ s φ(m/s) − m Φ(−m/s) over the Monte Carlo
decisions' margins (exit hours: the probability a re-decision changes the
action times the gain when it does — with the whole posterior spread as the
change, an upper bound: one re-decision's new data moves the mean far less).
COST = the last re-deciding pass's plan work (plan.txt `redecideCostMs`) in
hours × `stallCostH` (1 exit-hour per hour of main-thread stall: STATED, NOT
CALIBRATED — an upper bound, everything the page runs waits on a stall).
Skip iff VOC < COST; at ~1s of work that is every margin beyond ~3.2 of its
own sds. NEVER skipped: any other event (install / new life, model version,
committed option gone, route / node / regime / posterior / stream / life
length change, a forced re-decide — each is evidence or structure), a
decision whose margins are unknown (a record from before the gate), and past
`maxSkipH` (4h) since the last decision. plan.txt `redecideGate`: verdict,
VOC, cost, per-decision VOC, `skippedSince`, `skips` and a log of the last 24
verdicts. Healthcheck note VOC GATE HOLDING THROUGH EXIT UNSTABLE when the
timer has been skipped for more than `unstableNoteH` (2h) while EXIT UNSTABLE
fires (the margins it reads are the last decision's, and the held exit is
moving beyond its noise). On the PP3/21:12Z fixtures the gate RUNS (VOC 15.5h
against 1e-3h: the gang arms 2.6h apart with a 15h paired sd, the sleeve
objectives 0.5h apart with 13h): it skips only where every Monte Carlo
decision is decided by many sds (or has no feasible alternative). [VG1-2]

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

### Calibration (exitcal.js)

The node's realised exit is not observed until the node ends, so what is
calibrated is how the forecast MOVES. Two predictives are scored on the same
consecutive same-run sample pairs (u = E_b − (E_a − Δh), hours):

- THE ONE-STEP iid MODEL (legacy, `bayes.driftCalibration`, unchanged): each
  published exit is truth × exp(e), e iid per sample, so r/√2 ~ t(0, s) with
  s from the robust posterior of the pairs before. Its fields stay at the top
  of `calibration` {n, cover80, pitMean, pitVar, ks}.
- THE MARTINGALE PREDICTIVE: a rational forecast is a martingale (Augenblick &
  Rabin, QJE 2021), and its revisions resolve its own level interval: u ~ N(0,
  σ_a² · Δh / E_a), σ_a the published 80% interval's sd (q10/q90 fields, else
  the "80% interval a-bh" in the sample's source), resolved uniformly over the
  hours left (stated). This is what scores the LEVEL interval the plan
  publishes and decides on.

DIAGNOSIS (Gneiting, Balabdaoui & Raftery 2007), `calibration`:
`pit.{legacy, martingale}` (5-bin histogram; hump = too wide, U = too narrow,
skew = bias), `horizons` (coverage 1/2/4 samples ahead, split by whether an
install falls inside), `crps` (mean CRPS in hours for both predictives and the
recalibrated one — a narrowing that scores worse is caught), and the two
suspects: (a) `suspects.prior` — IG(a0, b0 = a0·s0²) enters b as a0
pseudo-pairs of size s0², so with realised pairs far below s0 it dominates b
long after a is outweighed (`priorShareB`, the predictive sd against the
realised rms, coverage under a vague prior); (b) `suspects.serial` — lag-1
correlation of the residuals (the iid model itself predicts −0.5: consecutive
pairs share an endpoint) and of the hits, n_eff = n(1 − ρ)/(1 + ρ).

THE FORECAST-REVISION TEST (Augenblick & Rabin 2021; Patton & Timmermann
2012), `calibration.martingale`, per life run and pooled: the bias Σu/ΣΔh
(the exit's movement beyond −1h/h, t on n_eff), the lag-1 autocorrelation of
u, the excess movement X = Σu² / (σ_first² − σ_last²) (1 for a calibrated
martingale), the jumps across installs (in level sds). VERDICT: STRUCTURAL
ERROR when the revisions are biased (|t| ≥ 2), autocorrelated (|ρ1| >
2/√n), jump (> 3 sd), or move more than the interval resolves (X > 2);
OVERSTATED UNCERTAINTY when they are small inside the forecast's own interval
(X < 0.5, or > 90% inside); both can hold; below 8 revisions, insufficient.

ONLINE RECALIBRATION (Gibbs & Candès 2021, adaptive conformal; decaying step
as Angelopoulos et al. 2023), `calibration.recal`: one width multiplier m on
the martingale predictive, m ← m·exp(γ_t(miss − 0.2)), γ_t = 1/(1 + n)^0.6,
bounded [0.2, 10], starting at 1, persisted; APPLIED as exp(ln m · n/(n + 8))
(tiny n moves nothing). Because the predictive is the level interval's own
resolution, one m scales (i) the published exit interval — plan.txt `exit`
q10/q90 about q50, with `rawQ10`/`rawQ90` and `widthMult` beside it (the
exit samples keep carrying the RAW interval, or m would compound) — and (ii)
the spread of D the commitment rule reads (`plan.COMMIT.widthMult`, set each
pass by progress.js). Synthetic [EC1]: revisions at 0.4x the interval ->
m 0.43 after 160, CRPS 0.116h -> 0.093h; a calibrated forecast stays ~1.

E-PROCESSES (Ramdas, Grünwald, Vovk & Shafer, Stat Sci 2023),
`calibration.eprocess`: two test martingales on the recalibrated standardized
revisions z = u / (m_applied σ) — m_applied fixed before each revision is
seen, so the sequence is predictable — each a mixture over a λ grid:
NARROW Π(1 + λ(z² − 1)) (H0: mean 0 and variance ≤ predicted, i.e. E z² ≤ 1)
and WIDE Π(1 + λ(1{|z| < 1.28} − 0.8)) (H0: coverage ≤ 80%); the same two on
the unscaled model (`rawNarrow`, `rawWide`, notes only). Under H0
P(ever ≥ 1/α) ≤ α (Ville), so healthcheck may read them every 15 minutes
forever: simulated false-alarm rates 0.021 / 0.037 at α = 0.05 over 200
looks [EC4]. They REPLACE the band [0.55, 0.97] at n ≥ 8 (kept only for a
record without them). healthcheck F (`plan.calibrationCheckOf`) FAILS: PLAN
MISCALIBRATED (either e-process ≥ 20), PLAN RECALIBRATION AT BOUND, PLAN
RECALIBRATION WORSENED ACCURACY (CRPS recalibrated > 1.1x raw over ≥ 8),
PLAN CALIBRATION BROKEN (the report threw); notes the verdict, m, CRPS, the
suspects, the differences and the commitment shadow.

VALUE EQUIVALENCE (Grimm et al. 2020), `calibration.values`: the quantities
that flip decisions are the differences between options. (i) `diff`: the
ranking's pass-to-pass relative exits Δln(H_k/H_ref)/2, scored sequentially
against the jitter predictive (bayes.jitterPosterior's model) — coverage,
PIT, ρ1; (ii) `switches`: every committed switch with its promised gain, and
the exit's drift over the following hour against a followed plan's −1h/h
(`erosionH`; a switch whose gain was real does not erode by its gain).

STATE: `calibration.state` {recal, eproc, crps, switches, commitLog, lastAt}
rides on plan.txt and is read back next pass from the last plan WHATEVER node
wrote it (the width error is the model's); only pairs newer than `lastAt` are
fed, so nothing is counted twice [EC7]. A state of another layout (another
predictive: `EXITCAL.stateVersion`) restarts at the window's last revision —
the new predictive is tested from its first prediction, never on the old
forecast's errors.

ESTIMATION ERROR (2026-10-04, live BN14.1; tools/sim/bbcal14.mjs,
[B14-1..8]): a published point that is itself an ESTIMATE of the expectation
moves by its estimation error as well as by news: u = news + e_b − e_a. The
Bladeburner exit (bbplan.bladeExit) is deterministic but rough — its policy
is discrete and its rank-compounding end amplifies a 1–3% lead into hours —
so a single exit moved 3–11h pass to pass with no event (the skill clock,
the stamina, the person, a 0.2% move of k each moved it hours, none alone):
X 16.7, e-process 1e17, the multiplier at its bound. It is now priced as the
mean over Q = 6 fixed MEMBERS (bbplan.BLADE_ENSEMBLE: a Latin hypercube over
the skill clock's phase and the rank and success calibrations at their
posterior quantiles), draw i on member i mod Q, so the members' spread is in
the level interval and the point moves a third as much; the point's own error
se = sd(members)/√Q rides on the record (`pointSeH`) and on the exit sample
(`seH`), and the martingale predictive becomes u ~ N(0, σ_a²·Δh/E_a + se_a² +
se_b²): X's denominator adds Σ(se_a² + se_b²), and the lag-1 correlation the
test expects is −Σse_shared²/Σvar(u) rather than 0 (consecutive revisions
share an endpoint's error). A sample with no `seH` (every earlier one, the
hacking route's) is scored exactly as before. Replayed on the recorder's
passes (fleet held): mean z² 1620 → 0.53.

THE RANK k MEASURES THE MODEL, NOT ITS INPUTS' DRIFT (2026-10-04, live
BN14.1; bbplan.rankCalStep v3, tools/sim/bb14/kchain.mjs, kfix.mjs, [BA6],
[BC7]): v2 predicted each one-hour window from its FIRST state's path, so
every input that moved during the hour — the fleet sleeve.js flipped, a
city's population, skills bought, the Go farm's effect — entered
ln(realised/predicted) as if it were the model's error. The next start
re-reads those inputs, so the exit applied them twice: k 1.196 (12 windows)
priced the 20:01Z state at 9.33h against the game's own classes' 10.72h
(40 seeds, Aevum anchored), the uncalibrated model 10.59h. From a state as
read, the model's next hour is the game's (14:13Z +599 vs +608; 20:01Z +6526
vs +6528), while the live hour after 14:13Z ran +885 — inputs, not the
model. v3 chains SEGMENTS, one per plan pass: segment i is predicted from
pass i's own path to pass i+1 and realised as the rank between the two
reads; a window closes when its segments cover an hour (a segment over
RANK_CAL.maxSegH drops it: the inputs between are unread). Black ops leave
both sides (their reward is the game's constant; a lump the model expects
inside a five-minute segment would recount every pass the real attempt
fails). v2 samples are dropped: k restarts at the prior (1) and is re-earned
on v3 windows. Named, not corrected: bladeExit still scales a black op's
reward by k ((k − 1) × the reward, which vanishes at k ≈ 1).

LIVE, BN4 2026-10-02 (the 100% that raised this; fixture
fixture-bn4-exitcal-0147.json, [EC9]): the legacy one-step interval was too
wide because of suspect (a) — the prior held 69% of b after 30 pairs (s 3.0%
against 1.7% realised; a vague prior covers 59%); suspect (b) was not the
cause (ρ1 −0.14, no streaks). The LEVEL interval was the opposite: 37% of
revisions inside the martingale predictive's 80% (PIT U-shaped, skewed low),
X 7.2 and 4.7 in the two longer lives, and the revisions BIASED — the exit
fell 2.54h per hour against the 1 predicted (t −2.6). Verdict STRUCTURAL
ERROR (a pessimistic Bladeburner exit). The multiplier went to m 7.6 (applied
x4.97; CRPS 0.601h -> 0.566h): the published interval widens, it does not
shrink. A multiplier fixes width, not bias — the fix for the bias is the
model's.
