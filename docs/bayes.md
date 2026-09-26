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
| ln M per hour (install cadence gain) | per life ln(M_j/M_{j−1})/L_j ~ N(λ, σ²/L_j) (weighted NIG) | vague: k0 = 0.1h | lifetimes ledger |
| hacking exp rate, faction rep rate | mean ln(rate) per 30-min bin ~ N(μ, σ²) (NIG); rep drawn ABSOLUTE (a noisy pass — live 13.04→10.72→13.41 rep/s — moves it by its share), exp as the current point × its spread (it trends with the level) | σ_ln prior 0.3 | this life's pass observations, kept in plan.txt `obs` |
| option-specific structural error s_i | per consecutive same-life passes, x = Δln(H_a/H_b)/2 ~ N(0, s_i²) over the options both rank (IG) | 2% | the top-8 route exits each pass, kept in plan.txt `points` |
| gym rate | bodyplan formula (calibrated exactly 2026-09-19) × residual exp(N(0, 0.1²)) | prior only — NOT CALIBRATED (no live residual feed yet) | — |
| prices given the count | deterministic (1.9^k, 1.14^L) | — | — |
| rep → favor | deterministic (favor.ts) | — | — |

The draw for a posterior is a draw of the MEAN (the simulator runs many lives
on one rate; per-life scatter averages out), except the discrepancy, which is
a draw of s² then ε ~ N(0, s²) (Student-t marginal).

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

CPU: bracketed by trace.js `bayes-plan`; measured ms per pass is published
(`cpu`). A budget (400ms) is enforced by stopping further draws; hitting it is
`cpu.overBudget: true` and healthcheck F fails (PLAN OVER CPU BUDGET).

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
