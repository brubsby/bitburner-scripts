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
| hacking exp rate, faction rep rate | ln(rate) per observation ≥ 30 min apart ~ N(μ, σ²) (NIG) | σ_ln prior 0.3 (stated, uncalibrated until 2 obs) | this life's pass observations, kept in plan.txt |
| gym rate | bodyplan formula (calibrated exactly 2026-09-19) × residual exp(N(0, 0.1²)) | prior only — NOT CALIBRATED (no live residual feed yet) | — |
| prices given the count | deterministic (1.9^k, 1.14^L) | — | — |
| rep → favor | deterministic (favor.ts) | — | — |

The draw for a posterior is a draw of the MEAN (the simulator runs many lives
on one rate; per-life scatter averages out), except the discrepancy, which is
a draw of s² then ε ~ N(0, s²) (Student-t marginal).

### Structural discrepancy

H_i,d = sim_i(θ_d) · exp(ε_i,d − s_d²/2), ε_i,d = s_d(ρ z_d + √(1−ρ²) z_i,d),
ρ = 0.95. The common part cancels in paired comparisons (it moves every
option); the option-specific part (√(1−ρ²) ≈ 0.31 of s) is what makes a
0.14h difference on 114h a coin flip. ρ is NOT identifiable from drift data:
it is a stated prior, published in plan.txt.

### Propagation

N = 24 draws (cap), seeded per life (CRN across options AND across passes of a
life, so a re-decision moves only with the data). Each option is ONE FIXED
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
step), installgate's exitCompare (the plan's decision replaces the tolerance
rule; `exitH` = the plan's median with q10/q90).

### Calibration

Each forecast sample carries its predictive for the next sample (E_a − Δh,
scale s√2 from the posterior AS IT STOOD then). For every later same-life
sample: coverage of the 80% interval and the PIT u = F(E_b). Published as
`calibration {n, cover80, pitMean, pitVar, ks}`; healthcheck F fails
(PLAN MISCALIBRATED) when n ≥ 8 and cover80 is outside [0.55, 0.97].
The node's realised exit is not observed until the node ends, so this
calibrates the one-step predictive of the forecast, which is exactly the
quantity whose error the decisions are protected against.
