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
| trader return r (/s) | per interval of Δt ticks after the warm-up: x = ln(1+ΔPnl/wealth)/Δt_h ~ N(μ_j, σ²/Δt_h) within life j (weighted NIG); lives pooled by random effects μ_j ~ N(μ, τ²) (DerSimonian–Laird τ²) | NIG m0 = 0.5%/h, k0 = 0.05h, a0 = 1, b0 = var 1%²/h | `/tel/stock-hist.txt` (flows excluded exactly as `nodeecon.realisedCapital`) |
| structural error s² | relative forecast residual per same-life pair r = (E_b − (E_a − Δh))/E_a ~ N(0, 2s²) (Inverse-Gamma, known mean 0) | IG(a0 = 2, b0 = 2·0.1²) — 10% prior | `exitCalibration.samples` |
| install cadence: ln M per life-hour r_n and life length L_n | per node y_n = ln(Σg/ΣL) ~ N(θ_n, σ²/n_eff) and ln(mean L) ~ N(θ_n, σ_L²/n); θ_n = μ + β·c_n + u_n, u_n ~ N(0, τ²) (random effect per node, covariate c = ln aug money × rep cost); σ² pooled over nodes (IG) | μ ~ N(ln 0.05/h, 1.5²), N(ln 3h, 1.5²); τ 1.0 / 0.7; β ~ N(−0.5, 0.5²) / N(+0.3, 0.5²) — all stated | lifetimes ledger, re-records merged, stall lives excluded (see below) |
| hacking exp rate, faction rep rate | mean ln(rate) per 30-min bin ~ N(μ, σ²) (NIG); rep drawn ABSOLUTE (a noisy pass — live 13.04→10.72→13.41 rep/s — moves it by its share), exp as the current point × its spread (it trends with the level) | σ_ln prior 0.3 | this life's pass observations, kept in plan.txt `obs` |
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
- income: `bayes.incomePrior` — earlier completed lives in this node (tel.js
  earnings ledger), each one's income rate over the half hour from this age,
  scaled by M now / M then; the predictive for this life (node mean's
  uncertainty + one life's scatter, prior sd ln 0.7). A node's first life
  borrows other nodes whose scripts earn, scaled by ScriptHackMoney and widened
  (sd ln 1.0); none -> still unpriced, named. NOT implemented: a RAM-based
  batcher model for a save's very first life.
- reputation: the game-formula estimate (factionplan `estimatedBaseRepPerSec`,
  [TJ6]) with a stated residual (sd ln 0.3, NOT CALIBRATED).
Both are drawn per Monte Carlo draw, so the exit's interval widens with them
(BY14, BN1 00:18 replay: exit 80% 229-457h with both priors; the income prior alone ~2.5x the width of a measured income).

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
