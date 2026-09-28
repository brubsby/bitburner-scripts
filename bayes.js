// POSTERIORS FOR THE PLANNER'S UNCERTAIN INPUTS — conjugate, pure, seeded.
//
// Pure: no ns surface. plan.js draws from these and pushes the draws through
// the existing exit simulators; progress.js only reads the data files and
// hands them in. docs/bayes.md is the design; every prior below is STATED
// there and published with the posterior (a prior is an assumption, never a
// silent default).
//
// Why posteriors and not point fits: the planner re-ran its simulations on
// point estimates every pass and took the argmin by any margin, while the
// estimates themselves moved (trader return 80%/h model -> 3.4e-5/s ledger fit
// -> 1.81e-4/s history fit, 2026-09-26). The size of that movement is exactly
// what a posterior carries, and a decision that knows it can tell a real
// difference from a re-fit.

const fin = (x) => typeof x === 'number' && isFinite(x)

// ---------------------------------------------------------------------------
// Random numbers: seeded, so a draw index means the same z in every option
// and every pass of a life (common random numbers).
// ---------------------------------------------------------------------------

/**
 * A SAMPLER THAT CANNOT SPIN. Every loop that draws until a condition holds
 * (the normal's u > 0, the gamma's rejection step) is capped, and every
 * uniform it reads is checked: finite and in [0, 1). A NaN or a stuck uniform
 * would otherwise make a rejection loop run forever on the game's page thread
 * — the planner shares it with the whole game (2026-09-27: the page froze at
 * 100% CPU after a planner deploy; an unbounded `for (;;)` in gammaOf was the
 * prime suspect). Breaking a cap throws SamplingError, which the plan catches
 * and publishes (health 'error'), never a hang.
 */
export class SamplingError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'SamplingError'
  }
}
/** Loop caps (each far beyond what a valid uniform source ever needs). */
export const SAMPLER_CAP = { normal: 64, gamma: 1000, gammaInner: 64 }
/** A checked uniform: throws unless rand() returns a finite number in [0, 1). */
export function uniformOf(rand) {
  if (typeof rand !== 'function') throw new SamplingError('no uniform source (rand is not a function)')
  const u = rand()
  if (!(typeof u === 'number' && u >= 0 && u < 1)) throw new SamplingError(`uniform source returned ${u} (must be a finite number in [0, 1))`)
  return u
}

/** mulberry32: a small, good-enough 32-bit PRNG. Returns () => [0,1). The seed must be a finite number. */
export function rngOf(seed) {
  if (!(typeof seed === 'number' && isFinite(seed))) throw new SamplingError(`rngOf: seed ${seed} is not a finite number`)
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a hash of a string (for per-option seeds that do not depend on order). */
export function hashOf(s) {
  let h = 0x811c9dc5
  const str = String(s)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Standard normal from a uniform source (Box-Muller, one of the pair). */
export function normalOf(rand) {
  let u = 0
  for (let it = 0; u <= 1e-300; it++) {
    if (it >= SAMPLER_CAP.normal) throw new SamplingError(`normalOf: ${SAMPLER_CAP.normal} uniforms in a row were 0 (a stuck source)`)
    u = uniformOf(rand)
  }
  const v = uniformOf(rand)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Gamma(shape, 1) — Marsaglia & Tsang, with the shape < 1 boost. */
export function gammaOf(shape, rand) {
  if (!(typeof shape === 'number' && isFinite(shape) && shape > 0)) throw new SamplingError(`gammaOf: shape ${shape} (must be a finite number > 0)`)
  if (shape < 1) return gammaOf(shape + 1, rand) * Math.pow(uniformOf(rand) || 1e-300, 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  // Marsaglia-Tsang accepts > 95% of proposals for shape >= 1; the caps are
  // never reached by a valid source.
  for (let it = 0; it < SAMPLER_CAP.gamma; it++) {
    let x = 0
    let v = 0
    for (let j = 0; ; j++) {
      if (j >= SAMPLER_CAP.gammaInner) throw new SamplingError(`gammaOf: ${SAMPLER_CAP.gammaInner} proposals with 1 + c x <= 0`)
      x = normalOf(rand)
      v = 1 + c * x
      if (v > 0) break
    }
    v = v * v * v
    const u = uniformOf(rand)
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
  throw new SamplingError(`gammaOf(${shape}): no acceptance in ${SAMPLER_CAP.gamma} proposals (a degenerate uniform source)`)
}

// ---------------------------------------------------------------------------
// Conjugate updates.
// ---------------------------------------------------------------------------

/**
 * NORMAL-INVERSE-GAMMA, weighted: x_i ~ N(mu, sigma^2 / w_i),
 * mu | sigma^2 ~ N(m, sigma^2 / k), sigma^2 ~ IG(a, b). Returns the posterior
 * {m, k, a, b, n}. With every w_i = 1 this is the textbook update
 * (Murphy 2007, "Conjugate Bayesian analysis of the Gaussian distribution" §3).
 */
export function nigUpdate(prior, xs, ws = null) {
  const { m: m0, k: k0, a: a0, b: b0 } = prior
  if (!(fin(m0) && k0 > 0 && a0 > 0 && b0 > 0)) throw new Error(`nigUpdate: bad prior ${JSON.stringify(prior)}`)
  let W = 0
  let S = 0
  let n = 0
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1
    if (!(fin(xs[i]) && fin(w) && w > 0)) continue
    W += w
    S += w * xs[i]
    n++
  }
  if (n === 0) return { m: m0, k: k0, a: a0, b: b0, n: 0 }
  const xbar = S / W
  let ss = 0
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1
    if (!(fin(xs[i]) && fin(w) && w > 0)) continue
    ss += w * (xs[i] - xbar) ** 2
  }
  const k = k0 + W
  return { m: (k0 * m0 + S) / k, k, a: a0 + n / 2, b: b0 + 0.5 * ss + (0.5 * k0 * W * (xbar - m0) ** 2) / k, n }
}

/** The marginal of mu under an NIG: Student-t {df, loc, scale}; `sd` finite only for df > 2. */
export function nigMeanMarginal(p) {
  const df = 2 * p.a
  const scale = Math.sqrt(p.b / (p.a * p.k))
  return { df, loc: p.m, scale, sd: df > 2 ? scale * Math.sqrt(df / (df - 2)) : Infinity }
}

/** One draw of (mu, sigma^2) from an NIG. */
export function nigDraw(p, rand) {
  const s2 = p.b / gammaOf(p.a, rand)
  return { mu: p.m + Math.sqrt(s2 / p.k) * normalOf(rand), s2 }
}

/**
 * INVERSE-GAMMA with a KNOWN mean of 0: x_i ~ N(0, s^2 / w_i), s^2 ~ IG(a, b).
 * Posterior IG(a + n/2, b + sum w x^2 / 2).
 */
export function igUpdate(prior, xs, ws = null) {
  let n = 0
  let q = 0
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1
    if (!(fin(xs[i]) && fin(w) && w > 0)) continue
    n++
    q += w * xs[i] * xs[i]
  }
  return { a: prior.a + n / 2, b: prior.b + q / 2, n }
}

/** One draw of s^2 from IG(a, b). */
export const igDraw = (p, rand) => p.b / gammaOf(p.a, rand)

// ---------------------------------------------------------------------------
// Student-t CDF (for PIT). Regularised incomplete beta by continued fraction
// (Numerical Recipes 6.4).
// ---------------------------------------------------------------------------
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let s = 1.000000000190015
  for (const ci of c) s += ci / ++y
  return -t + Math.log((2.5066282746310005 * s) / x)
}
function betacf(a, b, x) {
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < 1e-300) d = 1e-300
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = 1 + aa / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = 1 + aa / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  return h
}
function betai(a, b, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b
}
/** P(T <= t) for Student-t with `df` degrees of freedom. */
export function tCdf(t, df) {
  const x = df / (df + t * t)
  const tail = 0.5 * betai(df / 2, 0.5, x)
  return t >= 0 ? 1 - tail : tail
}

// ---------------------------------------------------------------------------
// Random effects across lives (DerSimonian-Laird).
// ---------------------------------------------------------------------------

/** Pool per-group estimates {est, v} into {mu, se, tau2, groups}. */
export function randomEffects(groups, { tau2Prior = null } = {}) {
  const g = (groups ?? []).filter((x) => fin(x?.est) && fin(x?.v) && x.v > 0)
  if (!g.length) return null
  if (g.length === 1) {
    const tau2 = fin(tau2Prior) ? tau2Prior : 0
    return { mu: g[0].est, se: Math.sqrt(g[0].v + tau2), tau2, groups: 1, tau2Source: fin(tau2Prior) ? 'prior (one life only)' : 'none' }
  }
  const w = g.map((x) => 1 / x.v)
  const W = w.reduce((s, x) => s + x, 0)
  const muF = g.reduce((s, x, i) => s + w[i] * x.est, 0) / W
  const Q = g.reduce((s, x, i) => s + w[i] * (x.est - muF) ** 2, 0)
  const C = W - w.reduce((s, x) => s + x * x, 0) / W
  const tau2 = Math.max(0, (Q - (g.length - 1)) / C)
  const ws = g.map((x) => 1 / (x.v + tau2))
  const Ws = ws.reduce((s, x) => s + x, 0)
  return { mu: g.reduce((s, x, i) => s + ws[i] * x.est, 0) / Ws, se: Math.sqrt(1 / Ws), tau2, groups: g.length, tau2Source: 'DerSimonian-Laird' }
}

// ---------------------------------------------------------------------------
// THE INPUTS.
// ---------------------------------------------------------------------------

/** Stated priors (docs/bayes.md). */
export const PRIORS = {
  // per-hour log return inside one life: vague (k0 = 0.05h of data).
  trader: { m: 0.005, k: 0.05, a: 1, b: 1e-4 },
  // between-life sd when only one life is seen: half the mean (stated).
  traderTauFrac: 0.5,
  // structural relative error of the exit forecast: 10%, worth 2 pairs.
  drift: { a: 2, b: 0.1 * 0.1 },
  // tail weight of the forecast error (Student-t): one pass can mis-price
  // badly; stated, not fitted.
  driftNu: 4,
  // THE INSTALL CADENCE (cadencePosterior), on the log scale. rate = ln of
  // ln(M) gained per life-hour; life = ln of hours per life. mu0/smu: the
  // cross-node mean before any node is seen (ln(M) 0.05/h, 3h lives, x4.5
  // either way); tau: between-node spread (x2.7 rate, x2 length) - stated,
  // two nodes cannot fit it; beta: per unit ln(aug money x rep cost), stated.
  // sigma: one life's scatter around its node (IG, ~1 in ln for the rate).
  // stallLn: a life whose install moved M by < 1% is a stall, not a cycle.
  cadence: {
    rate: { mu0: Math.log(0.05), smu: 1.5, tau: 1.0, beta0: -0.5, sbeta: 0.5 },
    life: { mu0: Math.log(3), smu: 1.5, tau: 0.7, beta0: 0.3, sbeta: 0.5 },
    sigma: { a: 2, b: 1 },
    sigmaLife: { a: 2, b: 0.5 },
    stallLn: 0.01,
    dupTolH: 0.05,
    z90: 1.2816,
  },
  // ln(rate) of an observed rate: sd 0.3 until measured.
  rateSdLn: 0.3,
  // income from previous lives: the spread of one life's income around the
  // node's (ln), before any life is seen; and the extra spread of borrowing
  // another node's lives (scaled by ScriptHackMoney) — both stated.
  incomeLifeSdLn: 0.7,
  incomeCrossNodeSdLn: 1.0,
  // the game-formula reputation estimate's residual before any faction work
  // is measured this life (NOT CALIBRATED: a stated prior).
  repEstimateSdLn: 0.3,
  // gym formula residual (NOT CALIBRATED: no live residual feed).
  gymSdLn: 0.1,
  // option-specific share of the structural error (jitterPosterior): 2%
  // until measured from the ranking's own pass-to-pass jitter.
  jitter: { a: 2, b: 0.02 * 0.02 },
}

export const STOCK_TICK_S = 6 // StockMarket/data/Constants.ts:4 msPerStockUpdate

/**
 * THE TRADER'S RETURN, per hour of market ticks. /tel/stock-hist.txt rows
 * {t, wealth, lifePnl, externalFlows}; a run restarts t. Within a run, each
 * interval with no external flow and past the warm-up is one observation
 * x = ln(1 + dPnl / wealth) / dt_h, precision weight dt_h (a random walk's
 * variance grows with its length). Runs pooled by random effects, so a
 * posterior over MANY lives is not falsely certain because each life had
 * many ticks. Returns {perSec: {mean, sd}, perHour: {...}, lives, points,
 * tau2, why} or null (no observation).
 */
export function traderPosterior(rows, { warmupH = 0, minPoints = 4 } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  const segs = []
  let cur = null
  for (const r of rows) {
    if (!(fin(r?.t) && fin(r?.wealth) && fin(r?.lifePnl))) continue
    if (!cur || r.t < cur[cur.length - 1].t) {
      cur = []
      segs.push(cur)
    }
    cur.push(r)
  }
  const warmS = fin(warmupH) && warmupH > 0 ? warmupH * 3600 : 0
  const groups = []
  let points = 0
  for (const s of segs) {
    const xs = []
    const ws = []
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]
      const b = s[i]
      if (!(a.wealth > 0) || b.externalFlows !== a.externalFlows) continue
      if (a.t * STOCK_TICK_S < warmS) continue
      const dtH = ((b.t - a.t) * STOCK_TICK_S) / 3600
      const g = 1 + (b.lifePnl - a.lifePnl) / a.wealth
      if (!(dtH > 0 && g > 0)) continue
      xs.push(Math.log(g) / dtH)
      ws.push(dtH)
    }
    if (xs.length < minPoints) continue
    const p = nigUpdate(PRIORS.trader, xs, ws)
    const mm = nigMeanMarginal(p)
    points += xs.length
    groups.push({ est: p.m, v: mm.sd ** 2, hours: ws.reduce((x, y) => x + y, 0), n: xs.length })
  }
  if (!groups.length) return null
  const tau2Prior = groups.length === 1 ? (PRIORS.traderTauFrac * groups[0].est) ** 2 : null
  const re = randomEffects(groups, { tau2Prior })
  const hours = groups.reduce((x, g) => x + g.hours, 0)
  return {
    perHour: { mean: re.mu, sd: re.se },
    perSec: { mean: re.mu / 3600, sd: re.se / 3600 },
    lives: groups.length,
    points,
    hours: +hours.toFixed(2),
    tau2: re.tau2,
    tauSource: re.tau2Source,
    byLife: groups.map((g) => ({ perHour: +g.est.toFixed(5), sd: +Math.sqrt(g.v).toFixed(5), hours: +g.hours.toFixed(2) })),
    why: `${groups.length} trader run(s), ${points} intervals over ${hours.toFixed(1)}h past a ${(warmupH || 0).toFixed(2)}h warm-up; lives pooled by random effects (tau ${Math.sqrt(re.tau2).toFixed(4)}/h, ${re.tau2Source})`,
  }
}

/**
 * Same-life pairs of exit samples: relative residual against the predicted
 * -1h/h. A pair counts only when BOTH ends were produced by the same model
 * and the same process:
 *   life  the same life (an install legitimately re-plans);
 *   ver   the same model version (a hash of the exit-relevant sources,
 *         progress.js modelVersionOf) — a deploy's re-pricing is a model
 *         change, not forecast error;
 *   boot  the same planner process (a page reload or restart).
 * Untagged samples (written before the tags existed) are excluded: whether
 * they straddle a deploy cannot be told, and "cannot tell" is not "fine".
 * Returns the kept pairs; `excluded` {life, version, boot, untagged, gap}
 * rides on the array.
 */
export function driftPairs(samples, { minGapH = 0.2 } = {}) {
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && x.exitH > 0 && fin(Date.parse(x?.at)))
  const out = []
  const excluded = { life: 0, version: 0, boot: 0, untagged: 0, gap: 0 }
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1]
    const b = S[i]
    if (a.life !== b.life) {
      excluded.life++
      continue
    }
    const dh = (Date.parse(b.at) - Date.parse(a.at)) / 3.6e6
    if (!(dh >= minGapH)) {
      excluded.gap++
      continue
    }
    if (a.ver === undefined || b.ver === undefined || a.boot === undefined || b.boot === undefined) {
      excluded.untagged++
      continue
    }
    if (a.ver !== b.ver) {
      excluded.version++
      continue
    }
    if (a.boot !== b.boot) {
      excluded.boot++
      continue
    }
    out.push({ at: b.at, dh, a: a.exitH, b: b.exitH, r: (b.exitH - (a.exitH - dh)) / a.exitH })
  }
  out.excluded = excluded
  return out
}

/**
 * THE ROBUST FIT: x_i ~ t_nu(0, s) as a normal scale mixture
 * (x_i | lam_i ~ N(0, s^2 / lam_i), lam_i ~ Gamma(nu/2, nu/2)); EM for the
 * weights at the posterior mode, then the IG update with them. One blip (live
 * 2026-09-27 05:32: one pass read 108h between 16h and 13h) moves s by its
 * share, not by its square: the Gaussian fit read 60% from that pass alone.
 */
function robustIG(prior, xs, nu) {
  if (!xs.length) return { a: prior.a, b: prior.b, weights: [] }
  let p = igUpdate(prior, xs)
  let w = xs.map(() => 1)
  for (let it = 0; it < 40; it++) {
    const s2 = p.b / (p.a - 1)
    w = xs.map((x) => (nu + 1) / (nu + (x * x) / s2))
    const q = igUpdate(prior, xs.map((x, i) => x * Math.sqrt(w[i])))
    if (Math.abs(q.b - p.b) < 1e-12 * p.b) {
      p = q
      break
    }
    p = q
  }
  return { a: p.a, b: p.b, weights: w }
}

/**
 * THE SIMULATOR'S STRUCTURAL ERROR. Model: each published exit is the truth
 * times exp(e), e ~ t_nu(0, s) independently per sample (heavy-tailed: a
 * single pass can mis-price badly), so the relative residual of a same-life,
 * same-model pair r = (E_b - (E_a - dh)) / E_a has r/sqrt(2) ~ t_nu(0, s).
 * s^2 ~ IG (robust EM weights, known mean 0). Returns {a, b, s (posterior
 * mean of s), nu, pairs, excluded, outliers, why}.
 */
export function driftPosterior(samples, prior = PRIORS.drift, nu = PRIORS.driftNu) {
  const pairs = driftPairs(samples)
  const r = robustIG(prior, pairs.map((x) => x.r / Math.SQRT2), nu)
  const s = Math.sqrt(r.b / (r.a - 1))
  const ex = pairs.excluded
  const nEx = ex.version + ex.boot + ex.untagged
  const outliers = r.weights.filter((w) => w < 0.3).length
  return { a: r.a, b: r.b, s, nu, pairs: pairs.length, excluded: ex, outliers, why: `${pairs.length} same-life, same-model pair(s): relative forecast error s = ${(100 * s).toFixed(1)}% (t, nu ${nu}; ${outliers} outlier pair(s) down-weighted; excluded ${nEx}: ${ex.version} across a model version, ${ex.boot} across a restart, ${ex.untagged} untagged; IG prior a=${prior.a}, E[s^2] = (${(100 * Math.sqrt(prior.b / (prior.a - 1))).toFixed(0)}%)^2)` }
}

/**
 * CALIBRATION OF THAT PREDICTIVE, sequentially: pair p is predicted from the
 * robust posterior of the pairs BEFORE it (the prior for the first), as it
 * stood when the forecast was published: r/sqrt(2) ~ t_df(0, sqrt(b/a)),
 * df = min(nu, 2a). The same exclusions as driftPosterior.
 * Returns {n, cover80, pitMean, pitVar, ks, excluded, why}; cover80 null below 1 pair.
 */
export function driftCalibration(samples, prior = PRIORS.drift, nu = PRIORS.driftNu) {
  const pairs = driftPairs(samples)
  const us = []
  const xs = []
  for (const x of pairs) {
    const r = robustIG(prior, xs, nu)
    const z = x.r / Math.SQRT2 / Math.sqrt(r.b / r.a)
    us.push(tCdf(z, Math.min(nu, 2 * r.a)))
    xs.push(x.r / Math.SQRT2)
  }
  const n = us.length
  if (!n) return { n: 0, cover80: null, pitMean: null, pitVar: null, ks: null, excluded: pairs.excluded, why: 'no same-life, same-model pair yet' }
  const cover = us.filter((u) => u > 0.1 && u < 0.9).length / n
  const mean = us.reduce((s, u) => s + u, 0) / n
  const v = us.reduce((s, u) => s + (u - mean) ** 2, 0) / n
  const sorted = [...us].sort((x, y) => x - y)
  let ks = 0
  for (let i = 0; i < n; i++) ks = Math.max(ks, Math.abs(sorted[i] - (i + 1) / n), Math.abs(sorted[i] - i / n))
  return { n, cover80: +cover.toFixed(3), pitMean: +mean.toFixed(3), pitVar: +v.toFixed(4), ks: +ks.toFixed(3), excluded: pairs.excluded, why: `${n} sequential one-step predictions: ${(cover * 100).toFixed(0)}% inside the 80% interval (PIT mean ${mean.toFixed(2)} vs 0.5, var ${v.toFixed(3)} vs 0.083)` }
}

/**
 * THE OPTION-SPECIFIC PART OF THE STRUCTURAL ERROR, measured: how much the
 * simulator's RANKING of the same options jitters between consecutive passes
 * of one life. Model: each option's forecast is truth x exp(e_common +
 * e_i), e_i ~ N(0, si^2) independently per pass, so for two options a, b
 * present in consecutive passes x = [d ln(Ha/Hb)] / 2 ~ N(0, si^2). Each
 * pass pair contributes the options it shares against one reference option.
 * `points` [{at, life, h: {key: hours}}] oldest first. IG, known mean 0.
 * Returns {a, b, si (posterior mean), n, why}.
 */
export function jitterPosterior(points, prior = PRIORS.jitter) {
  const P = (points ?? []).filter((p) => p && p.h && typeof p.h === 'object')
  const xs = []
  for (let i = 1; i < P.length; i++) {
    if (P[i].life !== P[i - 1].life) continue
    // Same model version and process only (as driftPairs): a deploy's
    // re-pricing is not jitter.
    if (P[i].ver === undefined || P[i].ver !== P[i - 1].ver || P[i].boot !== P[i - 1].boot) continue
    const A = P[i - 1].h
    const B = P[i].h
    const common = Object.keys(A).filter((k) => fin(A[k]) && A[k] > 0 && fin(B[k]) && B[k] > 0)
    if (common.length < 2) continue
    const ref = common[0]
    for (const k of common.slice(1)) xs.push((Math.log(B[k] / B[ref]) - Math.log(A[k] / A[ref])) / 2)
  }
  const p = igUpdate(prior, xs)
  const si = Math.sqrt(p.b / (p.a - 1))
  return { a: p.a, b: p.b, si, n: xs.length, why: `${xs.length} option pair(s) over consecutive passes: option-specific error ${(100 * si).toFixed(2)}% (prior ${(100 * Math.sqrt(prior.b / (prior.a - 1))).toFixed(1)}%)` }
}

/**
 * THE LIVES OF THE LEDGER, cleaned. installgate appends an entry every pass
 * that ORDERS an install; when act.js does not complete it, the next pass
 * appends the same life again, longer (BN8 2026-09-27 13:22-14:02: nine
 * entries of one 14h life). One life = one start (at - lifeH), kept once
 * (its last, longest record). Each life's gain is ln(M_next / M) — `hackMult`
 * is read BEFORE the install, so the augmentations a life bought show in the
 * NEXT life's entry, and are credited to the life that bought them. The last
 * life in the current node takes `hackMultNow` as its successor; a life whose
 * next entry is another node (the node's terminal life) has none.
 * [{node, at, start, lifeH, hackMult, records, next, g}] (g null without a
 * successor), `.dups` the merged re-records.
 */
export function ledgerLives(ledger, { node = null, hackMultNow = null, dupTolH = PRIORS.cadence.dupTolH } = {}) {
  const rows = (Array.isArray(ledger) ? ledger : []).filter((e) => e && fin(e.bitNode) && fin(e.lifeH) && e.lifeH > 0 && fin(e.hackMult) && e.hackMult > 0)
  const lives = []
  let dups = 0
  for (const e of rows) {
    // No timestamp (a hand-built ledger): no start, so never merged.
    const start = fin(Date.parse(e.at)) ? Date.parse(e.at) / 3.6e6 - e.lifeH : null
    const prev = lives[lives.length - 1]
    if (prev && prev.node === e.bitNode && start !== null && prev.start !== null && Math.abs(prev.start - start) <= dupTolH) {
      Object.assign(prev, { at: e.at, lifeH: e.lifeH, hackMult: e.hackMult, records: prev.records + 1 })
      dups++
      continue
    }
    lives.push({ node: e.bitNode, at: e.at, start, lifeH: e.lifeH, hackMult: e.hackMult, records: 1 })
  }
  for (let i = 0; i < lives.length; i++) {
    const nx = lives[i + 1]
    const next = nx ? (nx.node === lives[i].node ? nx.hackMult : null) : lives[i].node === node && fin(hackMultNow) && hackMultNow > 0 ? hackMultNow : null
    lives[i].next = next
    lives[i].g = next === null ? null : Math.log(next / lives[i].hackMult)
  }
  lives.dups = dups
  return lives
}

/**
 * THE INSTALL CADENCE OF A NODE, as a posterior — hierarchical over nodes.
 *
 * Two quantities per node n: the rate r_n = ln(M) gained per hour of a life
 * (the long-run Sum g / Sum L, what an exit spanning many lives compounds on),
 * and the life length L_n (mean hours per install cycle). Each is modelled on
 * the log scale as a random effect around a cross-node mean with a covariate:
 *   theta_n = mu + beta * c_n + u_n,  u_n ~ N(0, tau^2)
 * so another node's lives inform this one only through (mu, beta) and are
 * shrunk by tau, while this node's own lives enter with their own precision
 * and dominate once they are more precise than tau (one or two lives).
 *
 *  - A node's own estimate: y_n = ln(Sum g / Sum L) with sampling variance
 *    sigma^2 / n_eff (n_eff = (Sum L)^2 / Sum L^2: an hour-weighted mean of
 *    per-life rates, so a 20-minute life does not count as much as a 14h one);
 *    y_n = ln(mean L) with sigma_L^2 / n for the length. sigma^2 is one life's
 *    scatter of ln(g_j / L_j) around y_n, POOLED over nodes (conjugate IG,
 *    PRIORS.cadence.sigma) and taken at its posterior mean.
 *  - STALL LIVES ARE A DIFFERENT STATE, not slow cycles: a life whose install
 *    moved the multiplier by < PRIORS.cadence.stallLn (count tickets, a
 *    favour-banking life) is excluded from both quantities and counted
 *    (`own.stalls`, `own.stallShare`) — the count route prices those lives
 *    itself (countexit), and the multiplier cadence is the multiplier cycles'.
 *  - (mu, beta): Gaussian prior (PRIORS.cadence.rate/life: mu0, smu, beta0,
 *    sbeta), updated by the OTHER nodes' y_m ~ N(mu + beta c_m, v_m + tau^2)
 *    (conjugate, 2x2); this node's prior is then N(mu + beta c_n, q + tau^2)
 *    and its own y_n updates it — exact for the Gaussian model, the node's
 *    own data entering once.
 *  - The covariate c_n = ln(AugmentationMoneyCost x AugmentationRepCost) of
 *    the node (`covOf`, from bitNodeMults): dearer augmentations slow a life's
 *    buying (beta0 < 0 on the rate) and lengthen the life (beta0 > 0 on L).
 *    STATED, not fitted: the nodes played so far cannot identify it (BN1 and
 *    BN8 both have c = 0); its prior only moves a node with dearer
 *    augmentations (BN10: c = 2.3) and widens the transfer to it.
 *  - tau is stated (PRIORS.cadence.*.tau): two nodes cannot estimate a
 *    between-node spread.
 *
 * Returns { node, rate: {mean, sd, prior, weight} (ln of ln(M)/h), life: {...}
 * (ln h), lnPerHour, cycleHours, multGainPerCycle (at the posterior medians),
 * own: {lives, gained, stalls, stallShare, weight (own data's share of the
 * rate's precision)}, nodes: {n: {...}}, dups, sigma, source: 'posterior', why }
 * or null when no node has a life with a measured gain.
 */
export function cadencePosterior(ledger, node, { hackMultNow = null, covOf = null } = {}) {
  const C = PRIORS.cadence
  const lives = ledgerLives(ledger, { node, hackMultNow })
  const byNode = new Map()
  for (const l of lives) {
    if (!byNode.has(l.node)) byNode.set(l.node, { gained: [], stalls: 0, open: 0 })
    const b = byNode.get(l.node)
    if (l.g === null) b.open++
    else if (!(l.g >= C.stallLn)) b.stalls++
    else b.gained.push(l)
  }
  const stats = new Map()
  const resid = { rate: { a: C.sigma.a, b: C.sigma.b }, life: { a: C.sigmaLife.a, b: C.sigmaLife.b } }
  for (const [n, b] of byNode) {
    const G = b.gained
    if (!G.length) continue
    const H = G.reduce((t, l) => t + l.lifeH, 0)
    const H2 = G.reduce((t, l) => t + l.lifeH * l.lifeH, 0)
    const yR = Math.log(G.reduce((t, l) => t + l.g, 0) / H)
    const yL = Math.log(H / G.length)
    // Hour weights normalised to mean 1, so the residual sum counts lives.
    let sr = 0
    let sl = 0
    for (const l of G) {
      sr += ((l.lifeH * G.length) / H) * (Math.log(l.g / l.lifeH) - yR) ** 2
      sl += (Math.log(l.lifeH) - yL) ** 2
    }
    resid.rate.a += (G.length - 1) / 2
    resid.rate.b += sr / 2
    resid.life.a += (G.length - 1) / 2
    resid.life.b += sl / 2
    stats.set(n, { lives: G.length + b.stalls + b.open, gained: G.length, stalls: b.stalls, yR, yL, nEff: (H * H) / H2, n: G.length })
  }
  if (!stats.size) return null
  const s2R = resid.rate.b / (resid.rate.a - 1)
  const s2L = resid.life.b / (resid.life.a - 1)
  const cov = (n) => {
    const c = typeof covOf === 'function' ? covOf(n) : 0
    return fin(c) ? c : 0
  }
  // theta_node | everything: other nodes -> (mu, beta) -> node prior; own data last.
  const one = (P, key, vOf) => {
    let a11 = 1 / (P.smu * P.smu)
    let a12 = 0
    let a22 = 1 / (P.sbeta * P.sbeta)
    let b1 = P.mu0 * a11
    let b2 = P.beta0 * a22
    for (const [m, st] of stats) {
      if (m === node) continue
      const w = 1 / (vOf(st) + P.tau * P.tau)
      const c = cov(m)
      a11 += w
      a12 += w * c
      a22 += w * c * c
      b1 += w * st[key]
      b2 += w * c * st[key]
    }
    const det = a11 * a22 - a12 * a12
    const muH = (a22 * b1 - a12 * b2) / det
    const beH = (a11 * b2 - a12 * b1) / det
    const c = cov(node)
    const q = (a22 - 2 * c * a12 + c * c * a11) / det
    const pm = muH + beH * c
    const pv = q + P.tau * P.tau
    const prior = { mean: pm, sd: Math.sqrt(pv) }
    const own = stats.get(node)
    if (!own) return { mean: pm, sd: Math.sqrt(pv), prior, weight: 0 }
    const v = vOf(own)
    const prec = 1 / pv + 1 / v
    return { mean: (pm / pv + own[key] / v) / prec, sd: Math.sqrt(1 / prec), prior, weight: 1 / v / prec }
  }
  const rate = one(C.rate, 'yR', (st) => s2R / st.nEff)
  const life = one(C.life, 'yL', (st) => s2L / st.n)
  const lnPerHour = Math.exp(rate.mean)
  const cycleHours = Math.exp(life.mean)
  const b = byNode.get(node)
  const st = stats.get(node)
  const gained = st?.gained ?? 0
  const stalls = b?.stalls ?? 0
  const own = { lives: st?.lives ?? (b ? b.stalls + b.open : 0), gained, stalls, stallShare: stalls + gained > 0 ? stalls / (stalls + gained) : null, weight: rate.weight }
  const nodes = Object.fromEntries([...stats].map(([n, x]) => [n, { lives: x.lives, gained: x.gained, stalls: x.stalls, perHour: Math.exp(x.yR), cycleHours: Math.exp(x.yL), sdRate: Math.sqrt(s2R / x.nEff) }]))
  const others = [...stats.keys()].filter((n) => n !== node)
  const pct = (x) => `${Math.round(100 * x)}%`
  return {
    node,
    rate,
    life,
    lnPerHour,
    cycleHours,
    multGainPerCycle: Math.exp(lnPerHour * cycleHours),
    own,
    nodes,
    dups: lives.dups,
    sigma: { rate: Math.sqrt(s2R), life: Math.sqrt(s2L) },
    source: 'posterior',
    why:
      `cadence posterior for BitNode ${node}: ln(M) ${lnPerHour.toFixed(4)}/h (x${Math.exp(C.z90 * rate.sd).toFixed(2)} either way at 80%), ${cycleHours.toFixed(2)}h a life -> x${Math.exp(lnPerHour * cycleHours).toFixed(3)} a cycle; ` +
      `${gained} own gaining li${gained === 1 ? 'fe' : 'ves'}${stalls ? ` (+${stalls} stall excluded)` : ''} carry ${pct(rate.weight)} of the rate` +
      (others.length ? `, BitNode ${others.join(', ')} shrink${others.length === 1 ? 's' : ''} it toward the cross-node mean` : ', no other node') +
      (lives.dups ? `; ${lives.dups} re-recorded ledger entr${lives.dups === 1 ? 'y' : 'ies'} merged` : ''),
  }
}

/**
 * AN OBSERVED RATE (exp/s, rep/s): ln(rate) per pass, averaged within
 * `binH` bins (passes re-read overlapping windows, so observations nearer
 * than that are not independent — a bin is one observation), NIG with the
 * prior centred on the first bin and sd PRIORS.rateSdLn. Returns {post,
 * mean (of ln), sd, n (bins), passes} or null with no observation.
 */
export function logRatePosterior(obs, { binH = 0.5 } = {}) {
  const S = (obs ?? []).filter((o) => fin(o?.v) && o.v > 0 && fin(Date.parse(o?.at)))
  if (!S.length) return null
  const t0 = Date.parse(S[0].at)
  const bins = new Map()
  for (const o of S) {
    const b = Math.floor((Date.parse(o.at) - t0) / 3.6e6 / binH)
    const cur = bins.get(b) ?? { s: 0, n: 0 }
    cur.s += Math.log(o.v)
    cur.n++
    bins.set(b, cur)
  }
  const xs = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.s / v.n)
  const sd0 = PRIORS.rateSdLn
  const prior = { m: xs[0], k: 1, a: 2, b: sd0 * sd0 }
  const post = nigUpdate(prior, xs.slice(1))
  const mm = nigMeanMarginal(post)
  return { post, mean: post.m, sd: mm.sd, n: xs.length, passes: S.length }
}

/**
 * INCOME WHILE THE CURRENT LIFE CANNOT MEASURE IT (a batcher prepping its
 * target after an install reads $0/s for up to an hour, and an exit with no
 * income is unpriced — every trajectory decision blind). The prior is what
 * earlier lives earned AT THIS POINT OF A LIFE: from tel.js's fresh-life
 * earnings ledger (/tel/earnings.txt, cumulative money since install per
 * life), each completed life's income rate over the half hour from
 * max(age now, its own first earning) — the same stage of the ramp, so a
 * comparable hacking level — scaled by the multiplier ratio (M now / M then,
 * lifetimes ledger; income rises with the level, the level with M: an
 * approximation, stated). ln(rate) over lives: NIG with a wide prior
 * (PRIORS.incomeLifeSdLn); a draw takes the predictive for THIS life, not the
 * node mean. No completed life in this node: other nodes' lives, scaled by
 * ScriptHackMoney and widened by PRIORS.incomeCrossNodeSdLn.
 *
 * earnings {lives: {<lastAugReset>: {node, complete, samples: [[ageH, earned]]}}}
 * ledger   [{at, lifeH, hackMult, bitNode}] (lifetimes)
 * Returns {mean, sd (of ln income/s), perSec (median), lives, source, why} or null.
 */
export function incomePrior({ earnings, ledger = [], node, ageH = 0, hackMultNow = null, shm = null, windowH = 0.5 } = {}) {
  const lives = Object.entries(earnings?.lives ?? {}).filter(([, L]) => L && L.complete === true && Array.isArray(L.samples) && L.samples.length >= 2)
  const multAt = (startMs) => {
    // The lifetimes entry whose life started at startMs (at - lifeH), within 15 min.
    let best = null
    for (const e of ledger ?? []) {
      if (!(fin(e?.lifeH) && fin(e?.hackMult) && fin(Date.parse(e?.at)))) continue
      const st = Date.parse(e.at) - e.lifeH * 3.6e6
      const d = Math.abs(st - startMs)
      if (d < 15 * 60e3 && (!best || d < best.d)) best = { d, m: e.hackMult }
    }
    return best?.m ?? null
  }
  const rateOf = (L) => {
    const pts = L.samples.filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1])).map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0])
    if (pts.length < 2) return null
    let hi = 0
    for (const q of pts) hi = q[1] = Math.max(hi, q[1])
    const end = pts[pts.length - 1][0]
    const first = pts.find((q) => q[1] > 0)?.[0]
    if (!fin(first)) return null
    const at = (h) => {
      if (h <= pts[0][0]) return pts[0][1]
      for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (h - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0] || 1)
      return pts[pts.length - 1][1]
    }
    const a0 = Math.min(Math.max(ageH, first), Math.max(first, end - windowH))
    const a1 = Math.min(end, a0 + windowH)
    if (!(a1 > a0)) return null
    const r = (at(a1) - at(a0)) / ((a1 - a0) * 3600)
    return r > 0 ? r : null
  }
  const collect = (sameNode) => {
    const out = []
    for (const [k, L] of lives) {
      if ((L.node === node) !== sameNode) continue
      const r = rateOf(L)
      if (!r) continue
      const m = multAt(Number(k))
      const multRatio = fin(hackMultNow) && fin(m) && m > 0 ? hackMultNow / m : 1
      let nodeRatio = 1
      if (!sameNode) {
        const a = typeof shm === 'function' ? shm(node) : null
        const b = typeof shm === 'function' ? shm(L.node) : null
        if (!(fin(a) && fin(b) && a > 0 && b > 0)) continue // a node whose scripts earn nothing says nothing
        nodeRatio = a / b
      }
      out.push({ ln: Math.log(r * multRatio * nodeRatio), life: k, rate: r, multRatio })
    }
    return out
  }
  let obs = collect(true)
  let source = `${obs.length} earlier life/lives in BitNode ${node}`
  let extra = 0
  if (!obs.length) {
    obs = collect(false)
    source = `${obs.length} life/lives in other nodes, scaled by ScriptHackMoney (none in BitNode ${node} yet)`
    extra = PRIORS.incomeCrossNodeSdLn
  }
  if (!obs.length) return null
  const sd0 = PRIORS.incomeLifeSdLn
  const xs = obs.map((o) => o.ln)
  const post = nigUpdate({ m: xs[0], k: 1, a: 2, b: sd0 * sd0 }, xs.slice(1))
  // The PREDICTIVE for this life: the node mean's uncertainty plus one life's
  // own scatter (and the cross-node spread when borrowed).
  const sLife2 = post.b / (post.a - 1)
  const sdMean = Math.sqrt(sLife2 / post.k)
  const sd = Math.sqrt(sdMean * sdMean + sLife2 + extra * extra)
  return { mean: post.m, sd, sdLife: Math.sqrt(sLife2), perSec: Math.exp(post.m), lives: obs.length, source, why: `income from prior: ${source} at age ${ageH.toFixed(2)}h, median $${Math.exp(post.m).toExponential(2)}/s, x/÷ ${Math.exp(1.2816 * sd).toFixed(1)} at 80%` }
}
