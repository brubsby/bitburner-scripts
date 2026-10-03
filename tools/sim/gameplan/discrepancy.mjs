// MODEL DISCREPANCY: reality = simulator(g) x exp(delta), delta ~ N(0, sd^2)
// per unplayed node, with sd's posterior fitted to the played nodes' held-out
// residuals: how far each played node's MEASURED hours fell from what the
// planner would have predicted for it without its own run.
//
// PRIOR ART: Kennedy & O'Hagan 2001 (a discrepancy term beside the calibrated
// simulator); Brynjarsdottir & O'Hagan 2014 (without an informative prior on
// the discrepancy, calibration is confounded with it — here g is backed out of
// each run, so a played node's own residual is 0 by construction and says
// nothing; the informative evidence is the LEAVE-ONE-OUT residual, which the
// g model's predictive spread either covers or does not).
//
// THE RESIDUAL of played run r: ln T_r - E[ln T_pred], where T_pred is the
// simulated hours (hackexit, the run's own SF state and profile) under the g
// model's leave-one-out predictive of ln g_r; v_r = Var[ln T_pred] (Gauss-
// Hermite over the predictive). If the predictive is calibrated, r ~ N(0, v_r)
// and sd -> 0; the excess dispersion is the discrepancy:
//   r_r ~ N(0, v_r + sd^2),  sd ~ half-normal(PRIOR_SD)  (grid posterior).
// The draws use sd = sqrt(E[sd^2 | residuals]) (the predictive-variance match).
//
// Applies to UNPLAYED nodes' hacking-route hours (routes.mjs hackParts,
// through world.disc): a played node's replay spread is SIGMA_PLAYED's.
// NOT CALIBRATED beyond the residuals it is fitted to: PRIOR_SD is a stated
// choice (0.15 in ln hours: a 15% model error, the size of one run's noise).

export const PRIOR_SD = 0.15
const GRID = Array.from({ length: 400 }, (_, i) => (i + 0.5) * 0.0025) // 0 .. 1.0

/** 9-point Gauss-Hermite (probabilists'): nodes and weights for E[f(Z)], Z ~ N(0,1). */
export const GH9 = {
  x: [-4.512745863399783, -3.20542900285647, -2.07684797867783, -1.02325566378913, 0, 1.02325566378913, 2.07684797867783, 3.20542900285647, 4.512745863399783],
  w: [2.23458440077466e-5, 0.00278914132123177, 0.0499164067652179, 0.244097502894939, 0.406349206349206, 0.244097502894939, 0.0499164067652179, 0.00278914132123177, 2.23458440077466e-5],
}

/** Mean and variance of ln T under ln g ~ N(m, s^2): hoursOf(g) the simulated hours. */
export function lnHoursMoments(hoursOf, m, s) {
  let e = 0
  let e2 = 0
  for (let k = 0; k < GH9.x.length; k++) {
    const lt = Math.log(hoursOf(Math.exp(m + s * GH9.x[k])))
    e += GH9.w[k] * lt
    e2 += GH9.w[k] * lt * lt
  }
  return { mean: e, var: Math.max(0, e2 - e * e) }
}

/**
 * The posterior of the discrepancy sd from residuals [{ r, v }].
 * Returns { sd (the plug-in sqrt E[sd^2]), mean, p10, p90, n }.
 */
export function fitDiscrepancy(res, { priorSd = PRIOR_SD } = {}) {
  const lw = GRID.map((s) => -0.5 * (s / priorSd) ** 2 + res.reduce((a, { r, v }) => a - 0.5 * Math.log(v + s * s) - (0.5 * r * r) / (v + s * s), 0))
  const mx = Math.max(...lw)
  const w = lw.map((x) => Math.exp(x - mx))
  const tot = w.reduce((a, b) => a + b, 0)
  let m = 0
  let m2 = 0
  const cdf = []
  let acc = 0
  GRID.forEach((s, i) => {
    m += (w[i] / tot) * s
    m2 += (w[i] / tot) * s * s
    cdf.push((acc += w[i] / tot))
  })
  const q = (u) => GRID[Math.max(0, cdf.findIndex((c) => c >= u))]
  return { sd: Math.sqrt(m2), mean: m, p10: q(0.1), p90: q(0.9), n: res.length, priorSd }
}
