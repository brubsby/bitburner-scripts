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

/** mulberry32: a small, good-enough 32-bit PRNG. Returns () => [0,1). */
export function rngOf(seed) {
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
  while (u <= 1e-300) u = rand()
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Gamma(shape, 1) — Marsaglia & Tsang, with the shape < 1 boost. */
export function gammaOf(shape, rand) {
  if (!(shape > 0)) throw new Error(`gammaOf: shape ${shape}`)
  if (shape < 1) return gammaOf(shape + 1, rand) * Math.pow(rand() || 1e-300, 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x
    let v
    do {
      x = normalOf(rand)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
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
  // ln(M) per hour of a life: vague.
  lnGain: { m: 0, k: 0.1, a: 1, b: 1e-4 },
  // ln(rate) of an observed rate: sd 0.3 until measured.
  rateSdLn: 0.3,
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

/** Same-life pairs of exit samples: relative residual against the predicted -1h/h. */
export function driftPairs(samples, { minGapH = 0.2 } = {}) {
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && x.exitH > 0 && fin(Date.parse(x?.at)))
  const out = []
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1]
    const b = S[i]
    if (a.life !== b.life) continue
    const dh = (Date.parse(b.at) - Date.parse(a.at)) / 3.6e6
    if (!(dh >= minGapH)) continue
    out.push({ at: b.at, dh, a: a.exitH, b: b.exitH, r: (b.exitH - (a.exitH - dh)) / a.exitH })
  }
  return out
}

/**
 * THE SIMULATOR'S STRUCTURAL ERROR. Model: each published exit is the truth
 * times exp(e), e ~ N(0, s^2) independently per sample, so the relative
 * residual of a same-life pair r = (E_b - (E_a - dh)) / E_a ~ N(0, 2 s^2).
 * s^2 ~ IG, known mean 0. Returns {a, b, s (posterior mean of s), pairs, why}.
 */
export function driftPosterior(samples, prior = PRIORS.drift) {
  const pairs = driftPairs(samples)
  const p = igUpdate(prior, pairs.map((x) => x.r / Math.SQRT2))
  const s = Math.sqrt(p.b / (p.a - 1))
  return { a: p.a, b: p.b, s, pairs: pairs.length, why: `${pairs.length} same-life pair(s): relative forecast error s = ${(100 * s).toFixed(1)}% (IG prior a=${prior.a}, E[s^2] = (${(100 * Math.sqrt(prior.b / (prior.a - 1))).toFixed(0)}%)^2)` }
}

/**
 * CALIBRATION OF THAT PREDICTIVE, sequentially: pair p is predicted from the
 * posterior of the pairs BEFORE it (the prior for the first), as the posterior
 * stood when the forecast was published. r/sqrt(2) ~ t_{2a}(0, sqrt(b/a)).
 * Returns {n, cover80, pitMean, pitVar, ks, why}; cover80 null below 1 pair.
 */
export function driftCalibration(samples, prior = PRIORS.drift) {
  const pairs = driftPairs(samples)
  const us = []
  let p = { a: prior.a, b: prior.b }
  for (const x of pairs) {
    const z = x.r / Math.SQRT2 / Math.sqrt(p.b / p.a)
    us.push(tCdf(z, 2 * p.a))
    p = igUpdate(p, [x.r / Math.SQRT2])
  }
  const n = us.length
  if (!n) return { n: 0, cover80: null, pitMean: null, pitVar: null, ks: null, why: 'no same-life pair yet' }
  const cover = us.filter((u) => u > 0.1 && u < 0.9).length / n
  const mean = us.reduce((s, u) => s + u, 0) / n
  const v = us.reduce((s, u) => s + (u - mean) ** 2, 0) / n
  const sorted = [...us].sort((x, y) => x - y)
  let ks = 0
  for (let i = 0; i < n; i++) ks = Math.max(ks, Math.abs(sorted[i] - (i + 1) / n), Math.abs(sorted[i] - i / n))
  return { n, cover80: +cover.toFixed(3), pitMean: +mean.toFixed(3), pitVar: +v.toFixed(4), ks: +ks.toFixed(3), why: `${n} sequential one-step predictions: ${(cover * 100).toFixed(0)}% inside the 80% interval (PIT mean ${mean.toFixed(2)} vs 0.5, var ${v.toFixed(3)} vs 0.083)` }
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
 * ln(M) PER HOUR OF A LIFE, from the lifetimes ledger (same node): each life
 * x_j = ln(M_j / M_{j-1}) / L_j, weight L_j — the weighted mean is exactly
 * exitplan.endpointCycleStats' lnPerHour. Returns {post, mean, sd, lives} or null.
 */
export function lnGainPosterior(ledger, bitNode) {
  const lives = (ledger ?? []).filter((e) => e && e.bitNode === bitNode && fin(e.lifeH) && e.lifeH > 0 && fin(e.hackMult) && e.hackMult > 0)
  if (lives.length < 3) return null
  const xs = []
  const ws = []
  for (let i = 1; i < lives.length; i++) {
    xs.push(Math.log(lives[i].hackMult / lives[i - 1].hackMult) / lives[i].lifeH)
    ws.push(lives[i].lifeH)
  }
  const post = nigUpdate(PRIORS.lnGain, xs, ws)
  const mm = nigMeanMarginal(post)
  return { post, mean: post.m, sd: mm.sd, lives: lives.length, why: `${lives.length} lives: ln(M) ${post.m.toFixed(4)}/h ± ${mm.sd.toFixed(4)}` }
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
