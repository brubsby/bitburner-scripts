// LEARNING, BOUNDS AND TAILS over the draws: how much a policy that learns as
// it plays could save, what learning one node's reading is worth to the rest
// of the order, and how bad each choice is in the tail.
//
// Pure (no game import): everything works on the per-draw clear-time tables
// that plan.mjs builds (search.mjs's { F, fstride, C } with C a Float32Array
// per draw), so the tests run it on synthetic lattices.
//
// PRIOR ART
//   Frazier, Powell & Dayanik 2009 (the knowledge gradient with CORRELATED
//     beliefs): the value of a measurement is the expected improvement of the
//     next decision after it, and with correlated beliefs one measurement
//     moves every alternative it is correlated with. KG(*) (Frazier & Powell
//     2010): when the value of information is not concave in the number of
//     measurements, one-step KG is myopically low; take max_m KG(m)/m.
//   Brown, Smith & Sun, OR 2010 (information relaxation): the mean over the
//     draws of each draw's own perfect-information optimum is a LOWER bound on
//     the expected total of ANY non-anticipative policy (zero penalty: the
//     loosest member of the family, a valid bound all the same).
//   Lin, Ren & Zhou, NeurIPS 2022 (Bayesian-risk MDPs): report a coherent tail
//     measure (CVaR) beside the risk-neutral objective.
//   Peherstorfer, Willcox & Gunzburger, SIAM Review 2018 (multi-fidelity Monte
//     Carlo): a cheap correlated model as a control variate for an expensive
//     one; mfmc() below.
//   Strong, Oakley, Brennan & Breeze 2015 (regression-based EVSI): the
//     conditional expectation of each table entry given the signal is a
//     regression on the signal over the draws — the conditional mean table
//     without a nested Monte Carlo loop.
//
// HONEST ESTIMATES: every policy here is CHOSEN on one half of the draws and
// EVALUATED on the other (2-fold cross-fitting, both ways), so a continuation
// that only looks good on the draws that chose it is not credited. A choice
// made on noisy conditional tables can then be worse than not learning: a
// negative KG is reported as measured, not floored.

import { solveDP, bestPath, evalOrder } from './search.mjs'

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sdOf = (xs) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1))
}
export const seMean = (xs) => sdOf(xs) / Math.sqrt(xs.length)

/**
 * CVaR_alpha of a COST sample (the mean of the worst 1 - alpha of the mass):
 * Rockafellar-Uryasev, min_c c + E[(X - c)+]/(1 - alpha), exact on the
 * empirical distribution (fractional atoms included).
 */
export function cvar(xs, alpha = 0.9) {
  const v = [...xs].sort((a, b) => b - a)
  const n = v.length
  const tail = (1 - alpha) * n // mass in the tail, in samples
  let acc = 0
  let left = tail
  for (let i = 0; i < n && left > 1e-12; i++) {
    const w = Math.min(1, left)
    acc += w * v[i]
    left -= w
  }
  return acc / tail
}

/**
 * The information-relaxation bound (Brown, Smith & Sun 2010, zero penalty):
 * star[i] = draw i's perfect-information optimum, pol[i] = the policy's total
 * in draw i (paired). Returns { bound, policy, gap, se, violations } —
 * violations counts draws where the policy beat the bound (must be 0).
 */
export function infoRelaxation(star, pol) {
  const d = pol.map((p, i) => p - star[i])
  return { bound: mean(star), policy: mean(pol), gap: mean(d), se: seMean(d), violations: d.filter((x) => x < -1e-6).length }
}

/** 2-fold split of draw indices (alternate, so both halves span the draw sequence). */
export const foldsOf = (n) => [Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0), Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 1)]

/** The mean table over draws `idx` (Float64Array). */
export function meanC(tabs, idx) {
  const out = new Float64Array(tabs[idx[0]].length)
  for (const i of idx) {
    const c = tabs[i]
    for (let j = 0; j < out.length; j++) out[j] += c[j]
  }
  for (let j = 0; j < out.length; j++) out[j] /= idx.length
  return out
}
const tableOf = (T, C) => ({ F: T.F, fstride: T.fstride, C })

/** The fixed order [A, then the optimal continuation of table TC] (array of node numbers). */
export function orderAfter(L, TC, V, A) {
  const d = L.dims.findIndex((x) => x.n === A)
  return [A, ...bestPath(L, TC, V, L.dims[d].stride).map((s) => s.n)]
}
/** Total of a fixed order in draw i. */
export const costIn = (L, T, tabs, i, seq) => evalOrder(L, tableOf(T, tabs[i]), seq).T

/**
 * The open-loop policies, cross-fitted: for each fold, the DP on the OTHER
 * fold's mean table gives the best fixed order (and the best fixed
 * continuation after every first move); each held-out draw is charged that
 * order. Returns { robust[i], after: Map(A -> cost[i]), orders[fold], V[fold] }.
 */
export function openLoop(L, T, tabs, moves, folds = foldsOf(tabs.length)) {
  const n = tabs.length
  const robust = new Array(n)
  const after = new Map(moves.map((A) => [A, new Array(n)]))
  const fits = folds.map((train, f) => {
    const TC = tableOf(T, meanC(tabs, train))
    const V = solveDP(L, TC)
    const seq = bestPath(L, TC, V).map((s) => s.n)
    const cont = new Map(moves.map((A) => [A, orderAfter(L, TC, V, A)]))
    for (const i of folds[1 - f]) {
      robust[i] = costIn(L, T, tabs, i, seq)
      for (const A of moves) after.get(A)[i] = costIn(L, T, tabs, i, cont.get(A))
    }
    return { TC, V, seq, cont }
  })
  return { robust, after, fits }
}

/**
 * THE KNOWLEDGE GRADIENT of playing A next (one update, then open loop):
 * signal[i] = the reading playing A yields in draw i (its g, or k on the
 * Bladeburner route, plus reading noise) — correlated, through the draws,
 * with every other parameter (the hierarchy's shared beta/tau, the common
 * factor). With learning, the continuation after A is the optimum of the
 * CONDITIONAL mean table given the signal's bin (each entry regressed on the
 * signal over the training fold); without, the unconditional one (openLoop).
 * Returns { J[i] (with learning), J0[i] (without), kg = mean(J0 - J), se, bins }.
 */
export function kgOfMove(L, T, tabs, signal, A, { bins = 5, folds = foldsOf(tabs.length), ol = null, gate = 2 } = {}) {
  const n = tabs.length
  const J = new Array(n)
  const base = ol ?? openLoop(L, T, tabs, [A], folds)
  const J0 = base.after.get(A)
  const binInfo = []
  folds.forEach((train, f) => {
    const ys = train.map((i) => signal[i])
    const ybar = mean(ys)
    const sxx = ys.reduce((a, y) => a + (y - ybar) ** 2, 0)
    const Cbar = base.fits[f].TC.C
    const len = Cbar.length
    // slope of every table entry on the signal (regression-based conditional expectation)
    const b = new Float64Array(len)
    if (sxx > 0)
      for (const i of train) {
        const w = (signal[i] - ybar) / sxx
        const c = tabs[i]
        for (let j = 0; j < len; j++) b[j] += w * (c[j] - Cbar[j])
      }
    // the significance gate: a slope within `gate` standard errors of 0 is set to 0
    // (a pre-test estimator). Every entry moves with every OTHER parameter too, so
    // ungated slopes carry that noise into the conditional table and the DP chases it.
    if (gate > 0 && sxx > 0 && train.length > 2) {
      const rss = new Float64Array(len)
      for (const i of train) {
        const dy = signal[i] - ybar
        const c = tabs[i]
        for (let j = 0; j < len; j++) {
          const e = c[j] - Cbar[j] - b[j] * dy
          rss[j] += e * e
        }
      }
      for (let j = 0; j < len; j++) if (b[j] * b[j] * sxx * (train.length - 2) < gate * gate * rss[j]) b[j] = 0
    }
    // bin edges: quantiles of the training signals
    const sorted = [...ys].sort((a, c) => a - c)
    const edges = Array.from({ length: bins - 1 }, (_, k) => sorted[Math.floor(((k + 1) * sorted.length) / bins)])
    const binOf = (y) => edges.filter((e) => y >= e).length
    const conts = []
    for (let k = 0; k < bins; k++) {
      const inBin = ys.filter((y) => binOf(y) === k)
      const yk = inBin.length ? mean(inBin) : ybar
      const C = new Float64Array(len)
      for (let j = 0; j < len; j++) C[j] = Cbar[j] + b[j] * (yk - ybar)
      const TC = tableOf(T, C)
      conts.push(orderAfter(L, TC, solveDP(L, TC), A))
    }
    for (const i of folds[1 - f]) J[i] = costIn(L, T, tabs, i, conts[binOf(signal[i])])
    binInfo.push({ edges, conts: conts.map((c) => c.slice(0, 4)) })
  })
  const d = J0.map((x, i) => x - J[i])
  return { J, J0, kg: mean(d), se: seMean(d), bins: binInfo }
}

/**
 * MULTI-FIDELITY MONTE CARLO (Peherstorfer et al. 2018), two fidelities:
 * hf[k], lfK[k] on the same K inputs, lfN[] the cheap model on N >= K inputs
 * (the K first among them or independent). Estimate of E[HF]:
 *   mean(hf) + alpha (mean(lfN) - mean(lfK)),  alpha = cov(hf, lf)/var(lf)
 * (the optimal control-variate coefficient; pass `alpha` to fix it — with a
 * fixed alpha the estimator is exactly unbiased). Also the low-fidelity model's
 * bias mean(hf - lf) and its s.e. — the surrogate bias.
 */
export function mfmc(hf, lfK, lfN, { alpha = null } = {}) {
  const K = hf.length
  const mh = mean(hf)
  const ml = mean(lfK)
  let cov = 0
  let vl = 0
  for (let k = 0; k < K; k++) {
    cov += (hf[k] - mh) * (lfK[k] - ml)
    vl += (lfK[k] - ml) ** 2
  }
  const a = alpha ?? (vl > 0 ? cov / vl : 0)
  const rho = vl > 0 ? cov / Math.sqrt(vl * hf.reduce((s, x) => s + (x - mh) ** 2, 0)) : NaN
  const bias = hf.map((x, k) => x - lfK[k])
  return { est: mh + a * (mean(lfN) - ml), alpha: a, rho, hfMean: mh, lfMean: mean(lfN), bias: mean(bias), biasSe: seMean(bias), K, N: lfN.length }
}
