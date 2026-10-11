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
export function lgamma(x) {
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
    // THE PURCHASE MODEL AS THE PRIOR (cadencePosterior modelPrior): its
    // structural error on ln(rate), IG(a, b) — sd 0.5 (x1.9 either way at
    // 80%), STATED: no life has been recorded with the model's prediction
    // before 2026-09-29; each life recorded since (lifetimes `cadenceModel`)
    // in ANOTHER node updates it (Student-t, as driftPosterior).
    model: { a: 2, b: 0.5 * 0.5 },
  },
  // ln(rate) of an observed rate: sd 0.3 until measured.
  rateSdLn: 0.3,
  // income from previous lives: the spread of one life's income around the
  // node's (ln), before any life is seen; and the extra spread of borrowing
  // another node's lives (scaled by ScriptHackMoney) — both stated.
  incomeLifeSdLn: 0.7,
  incomeCrossNodeSdLn: 1.0,
  // A PRE-SPLIT LIFE'S NON-HACKING INCOME, bounded (legacyHackingWindow).
  // Every figure is an UPPER bound, so a reconstructed hacking rate is never
  // above the truth by more than its bracket:
  //   stockReturnPerSec  the trader's return: 1.32e-4/s measured live (BN9
  //                      2026-09-29 stock.txt, pre-4S, $196b book), x1.5
  //   stockCap           the market's capacity: stock.txt capitalCap $1.054e13
  //   otherPerSec        hacknet + crime + work + sleeves + gang + contracts:
  //                      BN9's hacknet node (its specialty) earns $6.5e5/s
  //                      live; x15 for everything else — stated, not fitted
  //   minHackShare       a window is used only when at least this share of
  //                      its total is provably hacking; else the life is
  //                      excluded at this age
  legacyNonHack: { stockReturnPerSec: 2e-4, stockCap: 1.1e13, otherPerSec: 1e7, minHackShare: 0.5 },
  // the game-formula reputation estimate's residual before any faction work
  // is measured this life, and the prior sd of ln k in repRatePosterior when
  // no life carried one (NOT CALIBRATED: a stated prior).
  repEstimateSdLn: 0.3,
  // gym formula residual (NOT CALIBRATED: no live residual feed).
  gymSdLn: 0.1,
  // option-specific share of the structural error (jitterPosterior): 2%
  // until measured from the ranking's own pass-to-pass jitter.
  jitter: { a: 2, b: 0.02 * 0.02 },
  // THE FRESH-LIFE FORMULA'S ERROR (formulaErrorPosterior), before any life:
  // per life, ln(realised / freshlife.js) = node bias + that life's scatter.
  // Stated vague priors: the formula unbiased (m), the scatter's IG (a, b:
  // x10 income / x3 exp either way at one sd; b / (a - 1) is also the sd of
  // the cross-node mean's prior) — which the recorded lives dominate
  // (tools/sim/freshcal.mjs, docs/bayes.md). k is unused (the hierarchy sets
  // the mean's precision). lifeH0: a life of h hours weighs h / (h + lifeH0)
  // (a 0.5h life a third of a long one): its windows are few, its ramp all
  // prep.
  // count: the fresh-life MONEY model (lifeplan.freshLifeMoney, every stream)
  // against the node's completed lives (countplan.freshCurve, lifeplan
  // moneyScaleOf) — x3 either way before a life.
  formula: {
    income: { m: 0, k: 1, a: 2, b: Math.log(10) ** 2 },
    exp: { m: 0, k: 1, a: 2, b: Math.log(3) ** 2 },
    count: { m: 0, k: 1, a: 2, b: Math.log(3) ** 2 },
    lifeH0: 1,
    // between-node sd of the formula's bias while fewer than 3 other nodes
    // have lives (x1.9 either way at 80%): stated.
    tau: 0.5,
  },
  // THE INSTALL'S CARRIED RATE AS THE NEXT LIFE'S PRIOR (carriedRatePrior):
  // one life's scatter of the fleet's exp coefficient around the last life's
  // measured one, on top of that posterior's own sd (x/÷ 1.47 at 80%):
  // stated, not fitted.
  carryLifeSdLn: 0.3,
  // THE FRESH-LIFE RAMP (afterRamp): the first quarter hour of a life is the
  // fleet re-rooting and prepping — the running scripts' exp rate there is
  // not the life's rate (live BN9 2026-09-30 13:30Z: 34 exp/s at age 0.08h,
  // 1.3e4/s at 0.17h, ~2e4/s from 0.5h on). Observations count their hours
  // from its end: stated (the level reached 1490 by 0.17h twice today).
  freshRampH: 0.25,
}

export const STOCK_TICK_S = 6 // StockMarket/data/Constants.ts:4 msPerStockUpdate
// nodeecon.FLOW_TOL_FRAC, duplicated because this module imports nothing ([SI4] pins them equal).
export const FLOW_TOL_FRAC = 0.02

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
      // A negligible flow (hacknet/contract cash, within FLOW_TOL_FRAC of the
      // base) keeps the interval: nodeecon.flowNegligible has the why.
      if (!(a.wealth > 0)) continue
      if (b.externalFlows !== a.externalFlows && !(fin(a.externalFlows) && fin(b.externalFlows) && Math.abs(b.externalFlows - a.externalFlows) <= FLOW_TOL_FRAC * a.wealth)) continue
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
 * THE TRADER'S RETURN AS A FUNCTION OF ITS BOOK, r(W) = r0 s(W; W*): the
 * posterior on the level r0 and the knee W*, with the curve's shape (s,
 * traderw.js rwShape — passed in, this module imports nothing) fixed from the
 * game's own market (tools/sim/stocks/rw.mjs). traderPosterior pooled every
 * interval into ONE rate, so a $1m book, a $3b one and a $194b one were read
 * as noisy measurements of the same number (0.38-0.53/h live BN9 2026-09-29),
 * and the exit compounded every book at it.
 *
 * The data: /tel/stock-hist.txt, each flow-free interval past the warm-up
 * x_i = ln(1 + dPnl / W_i) / dt_i at the book W_i it started from (as
 * traderPosterior). The model, per run (life) l:
 *   x_i = r0 (1 + d_l) s(W_i; W*) + e_i,  e_i ~ N(0, kappa^2 sigma(W_i)^2 / dt_i)
 *   d_l ~ N(0, tauRel^2)  (one life's level around the node's; the sim's spread)
 * d_l integrated out in closed form (rank one: Sherman-Morrison), so a life
 * of many intervals counts as one life, not as many independent ones.
 * sigma(W): the sim's interval noise at book W; kappa^2 its scale on this
 * ledger (IG(3, 2) around 1, re-estimated at the posterior mean once).
 *
 * The prior (prior = traderw.RW_PRIOR[regime]): ln r0 ~ N(ln r0Sim, sdLnR0),
 * ln W* ~ N(ln W*Sim, sdLnWstar) — the sim's fit and a STATED structural
 * error. The posterior on a 33 x 33 grid in (ln r0, ln W*): exact up to the
 * grid, CPU ~1ms for 360 rows. Returned as moments — r0 per hour (mean, sd),
 * ln W* (mean, sd), their correlation — which the plan's draws use
 * (plan.makeDraws), plus r(W) at a table of books (mean, sd).
 *
 * The evidence is a ledger (rwLedgerOf: per-run, per-book-bin sufficient
 * statistics kept across the rolling history), `ledger` when the caller keeps
 * one, else built from `rows`; only runs of `regime` count.
 *
 * Returns the prior itself (source 'prior', points 0) when no interval
 * survives (or no rows); null only without a prior or a shape.
 */
export const RW_LEDGER = { binDec: 0.1, maxRuns: 60 }
/** sigma(W) per sqrt(hour) of the prior (the sim's interval noise at book W). */
function rwSigmaOf(prior, W) {
  const s = prior?.sigma
  return s ? s.sigma0 * Math.pow(1 + Math.pow(W / s.sWstar, s.n), -1 / s.n) : 0.2
}
/**
 * THE LEDGER OF THE CURVE'S EVIDENCE, kept across the rolling history.
 * /tel/stock-hist.txt holds the last 360 rows (6h): a big book's hours scroll
 * out of it within one life, and with them the only evidence on the knee W*
 * (live 2026-09-29 18:17-18:27Z: r0 0.68 -> 0.64, W* 7.0e11 -> 6.7e11 in ten
 * minutes as the $1e11-1e12 rows fell off, the exit +11%). So each pass folds
 * the rows it has not seen (row.at past lastRow.at) into per-run, per-book-bin
 * sufficient statistics (0.1 decade; P = sum dt/sig^2, X = sum x dt/sig^2,
 * XX = sum x^2 dt/sig^2, LW = sum log10 W dt/sig^2, n, h) — the posterior is
 * exact in them up to the bin's book (s varies ~2% across a bin at the knee).
 * A run is a stretch of rows with t rising (stock.js restarts t), carried
 * across passes by lastRow; the regime (s4) is part of the run. Pure: returns
 * a new ledger {v, lastRow, next, runs: [{id, node, regime, firstAt, bins}]}.
 */
export function rwLedgerOf(prev, rows, { prior = null, priors = null, warmupH = 0, node = null } = {}) {
  const led = prev && prev.v === 1 && Array.isArray(prev.runs) ? { v: 1, lastRow: prev.lastRow ?? null, next: prev.next ?? prev.runs.length, runs: prev.runs.map((r) => ({ ...r, bins: { ...r.bins } })) } : { v: 1, lastRow: null, next: 0, runs: [] }
  if (!Array.isArray(rows)) return led
  const priorOf = (reg) => (priors ? priors[reg] : prior) ?? prior
  let a = led.lastRow
  let seg = a ? led.runs.find((r) => r.id === a.seg) ?? null : null
  for (const b of rows) {
    if (!(fin(b?.t) && fin(b?.wealth) && fin(b?.lifePnl))) continue
    if (a && typeof b.at === 'string' && typeof a.at === 'string' && b.at <= a.at) continue
    const reg = b.s4 === true ? '4S-long' : 'pre-long'
    if (!a || !seg || b.t < a.t || reg !== seg.regime) {
      seg = { id: led.next++, node, regime: reg, firstAt: b.at ?? null, bins: {} }
      led.runs.push(seg)
      a = { at: b.at, t: b.t, wealth: b.wealth, lifePnl: b.lifePnl, externalFlows: b.externalFlows, seg: seg.id }
      continue
    }
    const pr = priorOf(reg)
    const warmS = Math.max(fin(warmupH) && warmupH > 0 ? warmupH : 0, fin(pr?.skipH) ? pr.skipH : 0) * 3600
    const flowOk = b.externalFlows === a.externalFlows || (fin(a.externalFlows) && fin(b.externalFlows) && Math.abs(b.externalFlows - a.externalFlows) <= FLOW_TOL_FRAC * a.wealth)
    const dtH = ((b.t - a.t) * STOCK_TICK_S) / 3600
    const g = a.wealth > 0 ? 1 + (b.lifePnl - a.lifePnl) / a.wealth : 0
    if (a.wealth > 0 && flowOk && a.t * STOCK_TICK_S >= warmS && dtH > 0 && g > 0) {
      const x = Math.log(g) / dtH
      const sg = rwSigmaOf(pr, a.wealth)
      const p = dtH / (sg * sg)
      const lw = Math.log10(a.wealth)
      const k = String(Math.round(lw / RW_LEDGER.binDec))
      const c = seg.bins[k] ?? [0, 0, 0, 0, 0, 0]
      seg.bins[k] = [c[0] + p, c[1] + x * p, c[2] + x * x * p, c[3] + lw * p, c[4] + 1, c[5] + dtH]
    }
    a = { at: b.at, t: b.t, wealth: b.wealth, lifePnl: b.lifePnl, externalFlows: b.externalFlows, seg: seg.id }
  }
  led.lastRow = a
  // Bounded: the newest runs with evidence (and the current one).
  const keep = led.runs.filter((r) => Object.keys(r.bins).length > 0 || r.id === a?.seg)
  led.runs = keep.slice(-RW_LEDGER.maxRuns)
  return led
}

export function traderRwPosterior(rows, { warmupH = 0, prior = null, shape = null, grid = 33, ledger = null, regime = 'pre-long', books = [1e6, 3e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14] } = {}) {
  if (!prior || typeof shape !== 'function') return null
  if (!ledger && !Array.isArray(rows)) return null
  // The evidence: the ledger's runs of this regime (rows folded in fresh when no ledger is given).
  const led = ledger ?? rwLedgerOf(null, rows, { prior, warmupH })
  const warmH = Math.max(fin(warmupH) && warmupH > 0 ? warmupH : 0, fin(prior.skipH) ? prior.skipH : 0)
  const lives = led.runs
    .filter((r) => (r.regime ?? 'pre-long') === regime)
    .map((r) => {
      const bins = Object.values(r.bins).filter((c) => c[0] > 0)
      return { W: bins.map((c) => Math.pow(10, c[3] / c[0])), P: bins.map((c) => c[0]), X: bins.map((c) => c[1]), XX: bins.map((c) => c[2]), n: bins.reduce((q, c) => q + c[4], 0), h: bins.reduce((q, c) => q + c[5], 0) }
    })
    .filter((l) => l.P.length > 0)
  let points = 0
  let hours = 0
  for (const l of lives) {
    points += l.n
    hours += l.h
  }
  const used = lives
  const G = Math.max(5, grid | 0)
  const muU = Math.log(prior.r0PerHour)
  const muW = Math.log(prior.Wstar)
  const sdU = prior.sdLnR0
  const sdW = prior.sdLnWstar
  const us = Array.from({ length: G }, (_, i) => muU + sdU * (-4 + (8 * i) / (G - 1)))
  const wsG = Array.from({ length: G }, (_, j) => muW + sdW * (-4 + (8 * j) / (G - 1)))
  const tau2 = (prior.tauRel ?? 0.2) ** 2
  // Per W* value and life: S2 = sum s^2 dt / sig^2, SX = sum s x dt / sig^2,
  // C = sum x^2 dt / sig^2 (kappa^2 applied at use). s depends on W* only.
  const stats = wsG.map((lw) => {
    const Ws = Math.exp(lw)
    return used.map((l) => {
      let S2 = 0
      let SX = 0
      let C = 0
      for (let i = 0; i < l.P.length; i++) {
        const s = shape(l.W[i], Ws)
        S2 += s * s * l.P[i]
        SX += s * l.X[i]
        C += l.XX[i]
      }
      return { S2, SX, C }
    })
  })
  const logPost = (k2) => {
    const lp = []
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const r0 = Math.exp(us[i])
        let ll = -0.5 * ((us[i] - muU) / sdU) ** 2 - 0.5 * ((wsG[j] - muW) / sdW) ** 2
        for (const st of stats[j]) {
          const A = (r0 * r0 * st.S2) / k2
          const B = (r0 * st.SX) / k2
          const Q = st.C / k2 - 2 * B + A
          const D = B - A
          ll += -0.5 * (Q - (tau2 * D * D) / (1 + tau2 * A)) - 0.5 * Math.log(1 + tau2 * A)
        }
        lp.push(ll)
      }
    }
    return lp
  }
  const momentsOf = (lp) => {
    const mx = Math.max(...lp)
    let Z = 0
    let m1 = 0
    let m2 = 0
    let n1 = 0
    let n2 = 0
    let c12 = 0
    const wts = lp.map((v) => Math.exp(v - mx))
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const w = wts[j * G + i]
        const r0 = Math.exp(us[i])
        Z += w
        m1 += w * r0
        m2 += w * r0 * r0
        n1 += w * wsG[j]
        n2 += w * wsG[j] * wsG[j]
        c12 += w * r0 * wsG[j]
      }
    }
    m1 /= Z
    n1 /= Z
    const v1 = Math.max(0, m2 / Z - m1 * m1)
    const v2 = Math.max(0, n2 / Z - n1 * n1)
    const cov = c12 / Z - m1 * n1
    return { wts, Z, r0: { mean: m1, sd: Math.sqrt(v1) }, lnW: { mean: n1, sd: Math.sqrt(v2) }, rho: v1 > 0 && v2 > 0 ? Math.max(-0.99, Math.min(0.99, cov / Math.sqrt(v1 * v2))) : 0 }
  }
  // kappa^2: the ledger's noise scale on the sim's, IG(3, 2) (mean 1) updated
  // by the residuals at the prior's curve, then once more at the posterior's.
  const kappaAt = (r0, Ws) => {
    let Q = 0
    for (const l of used) {
      for (let i = 0; i < l.P.length; i++) {
        const m = r0 * shape(l.W[i], Ws)
        Q += l.XX[i] - 2 * m * l.X[i] + m * m * l.P[i]
      }
    }
    return (2 + Q / 2) / (3 + points / 2 - 1)
  }
  let k2 = points ? kappaAt(prior.r0PerHour, prior.Wstar) : 1
  let mo = momentsOf(logPost(k2))
  if (points) {
    k2 = kappaAt(mo.r0.mean, Math.exp(mo.lnW.mean))
    mo = momentsOf(logPost(k2))
  }
  // r(W) at the table's books, under the grid posterior.
  const table = books.map((W) => {
    let a = 0
    let b = 0
    for (let j = 0; j < G; j++) {
      const s = shape(W, Math.exp(wsG[j]))
      for (let i = 0; i < G; i++) {
        const w = mo.wts[j * G + i]
        const v = Math.exp(us[i]) * s
        a += w * v
        b += w * v * v
      }
    }
    a /= mo.Z
    return { W, mean: +a.toFixed(4), sd: +Math.sqrt(Math.max(0, b / mo.Z - a * a)).toFixed(4) }
  })
  const Wstar = Math.exp(mo.lnW.mean)
  const at = (W) => table.find((t) => t.W === W)
  const fmtW = (W) => (W >= 1e12 ? `$${W / 1e12}t` : W >= 1e9 ? `$${W / 1e9}b` : `$${W / 1e6}m`)
  return {
    perHour: { mean: mo.r0.mean, sd: mo.r0.sd },
    perSec: { mean: mo.r0.mean / 3600, sd: mo.r0.sd / 3600 },
    lnWstar: { mean: mo.lnW.mean, sd: mo.lnW.sd },
    Wstar,
    rho: +mo.rho.toFixed(4),
    kappa2: +k2.toFixed(3),
    table,
    lives: used.length,
    points,
    hours: +hours.toFixed(2),
    source: points ? 'posterior' : 'prior',
    prior: { r0PerHour: prior.r0PerHour, Wstar: prior.Wstar, sdLnR0: sdU, sdLnWstar: sdW, tauRel: prior.tauRel },
    why: `r(W) = r0 s(W/W*): r0 ${(mo.r0.mean * 100).toFixed(1)}%/h +- ${(mo.r0.sd * 100).toFixed(1)}, W* $${Wstar.toExponential(2)} x/÷ ${Math.exp(mo.lnW.sd).toFixed(2)} (prior ${(prior.r0PerHour * 100).toFixed(1)}%/h, $${prior.Wstar.toExponential(2)}, the sim's) — ${[1e6, 1e9, 1e11, 1e13].map((W) => `${fmtW(W)} ${((at(W)?.mean ?? 0) * 100).toFixed(1)}%/h`).join(', ')}; ${points ? `${used.length} run(s), ${points} intervals over ${hours.toFixed(1)}h past each life's first ${warmH.toFixed(2)}h, noise x${Math.sqrt(k2).toFixed(2)} the sim's` : 'no flow-free interval: the prior'}`,
  }
}

/**
 * ONE RUN OF ONE MODEL: may two consecutive tagged records (exit samples,
 * rate observations, option points) be compared as the same model's
 * forecasts? Each record carries
 *   ver   the model version (a hash of the planner's whole import graph,
 *         progress.js modelVersionOf) — a deploy's re-pricing is a model
 *         change, not forecast error;
 *   boot  the game PAGE the planner ran in (performance.timeOrigin,
 *         trace.js pageBoot) — NOT the planner process.
 * progress.js is a watchdog JOB: a fresh process every pass. `boot` was its
 * process start (Date.now() at main), so no two passes ever shared one, and
 * every pair, observation buffer and option point was excluded "across a
 * restart" — the drift posterior sat at its prior, the rate buffers held one
 * sample, the option jitter had 0 pairs (live BN9 2026-09-30, all day). What
 * the exclusion protects against is a change in the conditions a pair
 * assumes, and a pass boundary is not one (pass-to-pass state lives in files,
 * which survive the process): a page RELOAD (every in-page timer, the
 * offline catch-up, the scripts' own restart) or a stretch where the page did
 * not run — a freeze, a suspended machine, a stalled planner — where game time
 * and wall time part and "the exit falls 1h per wall hour" is not the model's
 * claim. So a pair breaks on: a different page, a different version, or a
 * telemetry gap longer than maxGapH (PAIR_MAX_GAP_H: four exit-sample
 * cadences; passes run every ~15 min).
 * Returns null (same run) or the reason: 'untagged' | 'version' | 'boot' | 'stale'.
 */
export const PAIR_MAX_GAP_H = 1
export function runBreak(a, b, { maxGapH = PAIR_MAX_GAP_H } = {}) {
  if (a?.ver === undefined || b?.ver === undefined || a?.boot === undefined || b?.boot === undefined) return 'untagged'
  if (a.ver !== b.ver) return 'version'
  if (a.boot !== b.boot) return 'boot'
  const dh = (Date.parse(b.at) - Date.parse(a.at)) / 3.6e6
  if (fin(dh) && dh > maxGapH) return 'stale'
  return null
}
/**
 * The trailing run of a tagged buffer (oldest first) that belongs to the run
 * `cur` {ver, boot, at} is in: entries of another version or page are
 * dropped, and a telemetry gap longer than maxGapH (between entries, or from
 * the last entry to `cur.at`) cuts everything before it. Returns
 * {kept, dropped: {untagged, version, boot, stale}}.
 */
export function runTail(buf, cur, { maxGapH = PAIR_MAX_GAP_H } = {}) {
  const B = Array.isArray(buf) ? buf : []
  const dropped = { untagged: 0, version: 0, boot: 0, stale: 0 }
  const kept = []
  let next = cur
  for (let i = B.length - 1; i >= 0; i--) {
    const why = runBreak(B[i], next, { maxGapH })
    if (why === 'stale') {
      dropped.stale += i + 1
      break
    }
    if (why) {
      dropped[why]++
      continue
    }
    kept.unshift(B[i])
    next = B[i]
  }
  return { kept, dropped }
}

/**
 * Same-life pairs of exit samples: relative residual against the predicted
 * -1h/h. A pair counts only when BOTH ends were produced by the same model in
 * the same run (runBreak): the same life (an install legitimately re-plans),
 * version, and page, with no telemetry gap longer than maxGapH between them.
 * Untagged samples (written before the tags existed) are excluded: whether
 * they straddle a deploy cannot be told, and "cannot tell" is not "fine".
 * Returns the kept pairs; `excluded` {life, version, boot, stale, untagged,
 * gap} rides on the array (`gap`: closer than minGapH; `stale`: further than
 * maxGapH).
 */
export function driftPairs(samples, { minGapH = 0.2, maxGapH = PAIR_MAX_GAP_H } = {}) {
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && x.exitH > 0 && fin(Date.parse(x?.at)))
  const out = []
  const excluded = { life: 0, version: 0, boot: 0, stale: 0, untagged: 0, gap: 0 }
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
    const why = runBreak(a, b, { maxGapH })
    if (why) {
      excluded[why]++
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
export function robustIG(prior, xs, nu) {
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
  const nEx = ex.version + ex.boot + (ex.stale ?? 0) + ex.untagged
  const outliers = r.weights.filter((w) => w < 0.3).length
  return { a: r.a, b: r.b, s, nu, pairs: pairs.length, excluded: ex, outliers, why: `${pairs.length} same-life, same-model pair(s): relative forecast error s = ${(100 * s).toFixed(1)}% (t, nu ${nu}; ${outliers} outlier pair(s) down-weighted; excluded ${nEx}: ${ex.version} across a model version, ${ex.boot} across a page reload, ${ex.stale ?? 0} across a telemetry gap > ${PAIR_MAX_GAP_H}h, ${ex.untagged} untagged; IG prior a=${prior.a}, E[s^2] = (${(100 * Math.sqrt(prior.b / (prior.a - 1))).toFixed(0)}%)^2)` }
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
    // Same model version, page and run only (runBreak, as driftPairs): a
    // deploy's re-pricing is not jitter.
    if (runBreak(P[i - 1], P[i])) continue
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
// A life the COUNT RULE ended (installgate's "install: COUNT BATCH" — a
// ticket batch installed for the Daedalus count, its length the rule's
// choice, not the economics') is its own regime.
// The purchase model's ln(M) per hour this life was priced at (progress.js
// records it at the install: `cadenceModel`), or null.
const modelOf = (e) => (fin(e?.cadenceModel?.lnPerHour) && e.cadenceModel.lnPerHour > 0 ? e.cadenceModel.lnPerHour : null)
// A life installed ON THE BLADEBURNER ROUTE (installgate's "... on the
// Bladeburner route — the black-op exit ..."; a record's own `route: 'blade'`
// where it carries one) is its own regime too: its batches are the black-op
// exit's (combat, Bladeburner augs) and its slot is on Bladeburner, so its
// ln(hacking multiplier) per hour is not what a HACKING-route life buys. Live
// 2026-10-03: BN14's hack arm drew its cadence from BN9, BN6 and BN4, and 10
// of the ledger's 20 lives were BN6/BN4 blade-route lives (BN4 0.016/h) — the
// prior 0.026/h priced BN14's hacking exit at 192h, against ~0.05-0.07/h on
// the hacking route's own lives.
const regimeOf = (e) =>
  e?.route === 'blade' || (typeof e?.installWhy === 'string' && /on the Bladeburner route/.test(e.installWhy))
    ? 'blade'
    : typeof e?.installWhy === 'string' && /^install: COUNT BATCH/.test(e.installWhy)
      ? 'count'
      : 'multiplier'
export function ledgerLives(ledger, { node = null, hackMultNow = null, dupTolH = PRIORS.cadence.dupTolH } = {}) {
  const rows = (Array.isArray(ledger) ? ledger : []).filter((e) => e && fin(e.bitNode) && fin(e.lifeH) && e.lifeH > 0 && fin(e.hackMult) && e.hackMult > 0)
  const lives = []
  let dups = 0
  for (const e of rows) {
    // No timestamp (a hand-built ledger): no start, so never merged.
    const start = fin(Date.parse(e.at)) ? Date.parse(e.at) / 3.6e6 - e.lifeH : null
    const prev = lives[lives.length - 1]
    if (prev && prev.node === e.bitNode && start !== null && prev.start !== null && Math.abs(prev.start - start) <= dupTolH) {
      Object.assign(prev, { at: e.at, lifeH: e.lifeH, hackMult: e.hackMult, records: prev.records + 1, regime: regimeOf(e), model: modelOf(e) ?? prev.model })
      dups++
      continue
    }
    lives.push({ node: e.bitNode, at: e.at, start, lifeH: e.lifeH, hackMult: e.hackMult, records: 1, regime: regimeOf(e), model: modelOf(e) })
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
 *  - COUNT-RULE LIVES ARE A DIFFERENT STATE too: a life installgate ended
 *    with "install: COUNT BATCH" (one ticket for the Daedalus count, ~25
 *    minutes, live BN1 2026-09-28) measures the count rule's choice, not what
 *    a life of the node buys — fed back as the cadence it taught the exit
 *    that lives are 1.5h. Excluded and counted (`own.countLives`).
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
export function cadencePosterior(ledger, node, { hackMultNow = null, covOf = null, modelPrior = null } = {}) {
  const C = PRIORS.cadence
  const lives = ledgerLives(ledger, { node, hackMultNow })
  const byNode = new Map()
  for (const l of lives) {
    if (!byNode.has(l.node)) byNode.set(l.node, { gained: [], stalls: 0, open: 0, count: 0, blade: 0 })
    const b = byNode.get(l.node)
    if (l.regime === 'blade') b.blade++
    else if (l.g === null) b.open++
    else if (l.regime === 'count') b.count++
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
    stats.set(n, { lives: G.length + b.stalls + b.open + b.count + b.blade, gained: G.length, stalls: b.stalls, countLives: b.count, bladeLives: b.blade, yR, yL, nEff: (H * H) / H2, n: G.length })
  }
  const mp = modelPrior && fin(modelPrior.lnPerHour) && modelPrior.lnPerHour > 0 ? modelPrior : null
  if (!stats.size && !mp) return null
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
  // THE PURCHASE MODEL AS THE NODE'S PRIOR (modelPrior {lnPerHour, cycleHours,
  // why}: lifeplan.cadenceByPurchases, what a life of the chosen length buys
  // from THIS node's catalogue). The rate's node prior is then N(ln model,
  // s_m^2) instead of the cross-node mean: s_m^2 the model's structural error
  // (PRIORS.cadence.model, IG) updated, Student-t, by lives OTHER nodes
  // recorded with the model's prediction (ln(g/L) - ln(model rate)). This
  // node's own gaining lives then update it exactly as they updated the
  // cross-node prior — the measured cadence never stands in for the model,
  // it moves it by its precision.
  let modelErr = null
  const oneModel = (vOf) => {
    const xs = lives.filter((l) => l.node !== node && fin(l.model) && l.g !== null && l.regime !== 'count' && l.g >= C.stallLn).map((l) => Math.log(l.g / l.lifeH) - Math.log(l.model))
    const ig = robustIG(C.model, xs, PRIORS.driftNu)
    const sm2 = ig.b / (ig.a - 1)
    modelErr = { sd: Math.sqrt(sm2), residuals: xs.length, source: xs.length ? `${xs.length} li${xs.length === 1 ? 'fe' : 'ves'} in other nodes recorded with the model's prediction` : 'stated (no life recorded with the model\'s prediction in another node)' }
    const pmM = Math.log(mp.lnPerHour)
    const pvM = sm2
    // ...BLENDED WITH THE CROSS-NODE PRIOR (the hierarchy over the other
    // nodes' measured rates at this node's covariate — what `one` gives the
    // node before its own lives), by precision. The model's error above is
    // only a variance: other nodes' lives sit far above it (live 2026-10-11,
    // 12 recorded residuals mostly +2..+4 — no new joins, no rising
    // faction_rep), so the model alone held BN13 at 0.0027/h x/÷ 21 with no
    // own life to move it, against 0.061/h x/÷ 5.8 across nodes. Both are
    // read from the same ledger (the residuals and the rates), so the blend
    // counts those lives twice at most — stated. The node's own lives then
    // update the blend as before.
    const cross = one(C.rate, 'yR', vOf).prior
    const wM = 1 / pvM
    const wC = 1 / (cross.sd * cross.sd)
    const pv = 1 / (wM + wC)
    const pm = (pmM * wM + cross.mean * wC) * pv
    const modelShare = wM * pv
    const prior = { mean: pm, sd: Math.sqrt(pv), source: 'purchase model + cross-node', model: { mean: pmM, sd: Math.sqrt(pvM) }, cross: { mean: cross.mean, sd: cross.sd }, modelShare }
    const own = stats.get(node)
    if (!own) return { mean: pm, sd: Math.sqrt(pv), prior, weight: 0, modelShare }
    const v = vOf(own)
    const prec = 1 / pv + 1 / v
    return { mean: (pm / pv + own.yR / v) / prec, sd: Math.sqrt(1 / prec), prior, weight: 1 / v / prec, modelShare }
  }
  const rate = mp ? oneModel((st) => s2R / st.nEff) : one(C.rate, 'yR', (st) => s2R / st.nEff)
  // The life's LENGTH under the model is the model's decision (kept by the
  // caller); its posterior is still the measured one, for the record.
  const life = stats.size ? one(C.life, 'yL', (st) => s2L / st.n) : { mean: Math.log(mp.cycleHours > 0 ? mp.cycleHours : 3), sd: C.life.smu, prior: null, weight: 0 }
  const lnPerHour = Math.exp(rate.mean)
  const cycleHours = Math.exp(life.mean)
  const b = byNode.get(node)
  const st = stats.get(node)
  const gained = st?.gained ?? 0
  const stalls = b?.stalls ?? 0
  const countLives = b?.count ?? 0
  const bladeLives = b?.blade ?? 0
  const bladeAll = [...byNode.values()].reduce((t, x) => t + x.blade, 0)
  const own = { lives: st?.lives ?? (b ? b.stalls + b.open + b.count + b.blade : 0), gained, stalls, countLives, bladeLives, stallShare: stalls + gained > 0 ? stalls / (stalls + gained) : null, weight: rate.weight }
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
    source: mp ? 'posterior (purchase-model prior)' : 'posterior',
    modelPrior: mp ? { lnPerHour: mp.lnPerHour, cycleHours: mp.cycleHours ?? null, err: modelErr, modelShare: rate.modelShare, cross: rate.prior.cross } : null,
    // WHICH DRIVES THE RATE THIS PASS: the node's own lives (>= half the
    // precision), else the larger share of the prior.
    drives: rate.weight >= 0.5 ? 'own lives' : mp ? (rate.modelShare >= 0.5 ? 'purchase model' : 'cross-node prior') : 'cross-node prior',
    why: mp
      ? `cadence posterior for BitNode ${node} on the purchase model's prior: model ln(M) ${mp.lnPerHour.toFixed(4)}/h (x/÷ ${Math.exp(C.z90 * modelErr.sd).toFixed(2)} at 80%, ${modelErr.source}) ${pct(rate.modelShare)}, blended with the cross-node ${Math.exp(rate.prior.cross.mean).toFixed(4)}/h (x/÷ ${Math.exp(C.z90 * rate.prior.cross.sd).toFixed(2)}) ${pct(1 - rate.modelShare)} -> prior ${Math.exp(rate.prior.mean).toFixed(4)}/h -> ${lnPerHour.toFixed(4)}/h (x${Math.exp(C.z90 * rate.sd).toFixed(2)} either way at 80%); DRIVEN BY ${rate.weight >= 0.5 ? "this node's own lives" : rate.modelShare >= 0.5 ? 'the purchase model' : 'the cross-node prior'}; ` +
        `${gained} own gaining li${gained === 1 ? 'fe' : 'ves'}${stalls ? ` (+${stalls} stall excluded)` : ''}${countLives ? ` (+${countLives} count-rule li${countLives === 1 ? 'fe' : 'ves'} excluded)` : ''} carry ${pct(rate.weight)} of the rate` +
        (bladeAll ? `; ${bladeAll} Bladeburner-route li${bladeAll === 1 ? 'fe' : 'ves'} excluded (not the hacking route's cadence)` : '') +
        (lives.dups ? `; ${lives.dups} re-recorded ledger entr${lives.dups === 1 ? 'y' : 'ies'} merged` : '')
      : `cadence posterior for BitNode ${node}: ln(M) ${lnPerHour.toFixed(4)}/h (x${Math.exp(C.z90 * rate.sd).toFixed(2)} either way at 80%), ${cycleHours.toFixed(2)}h a life -> x${Math.exp(lnPerHour * cycleHours).toFixed(3)} a cycle; ` +
      `${gained} own gaining li${gained === 1 ? 'fe' : 'ves'}${stalls ? ` (+${stalls} stall excluded)` : ''}${countLives ? ` (+${countLives} count-rule li${countLives === 1 ? 'fe' : 'ves'} excluded: their length was the rule's)` : ''} carry ${pct(rate.weight)} of the rate` +
      (others.length ? `, BitNode ${others.join(', ')} shrink${others.length === 1 ? 's' : ''} it toward the cross-node mean` : ', no other node') +
      (bladeAll ? `; ${bladeAll} Bladeburner-route li${bladeAll === 1 ? 'fe' : 'ves'} excluded (not the hacking route's cadence)` : '') +
      (lives.dups ? `; ${lives.dups} re-recorded ledger entr${lives.dups === 1 ? 'y' : 'ies'} merged` : ''),
  }
}

/**
 * THE FRESH-LIFE FORMULA'S STRUCTURAL ERROR, over the lives recorded —
 * hierarchical over nodes.
 *
 * freshlife.js prices a fresh life from the game's formulas; each completed
 * life with its inputs recorded gives one residual y = ln(realised / model)
 * (what the life earned over what the formula said at the same ages:
 * tools/sim/freshcal.mjs, progress.js freshResidualsOf). What the formula
 * misses is partly the node's (BN8's farm over-predicts exp x0.4, BN9's
 * under-predicts x1.9 — the farm share and placement losses differ by node)
 * and partly the life's. So, as the cadence:
 *   y_j = theta_n + u_j,   u_j ~ t_nu(0, sigma)   (one life's scatter, pooled)
 *   theta_n = mu + v_n,    v_n ~ N(0, tau^2)      (the node's own bias)
 *   mu ~ N(m0, sigma0^2)                          (the formula unbiased: stated)
 * sigma^2 pooled over nodes (IG from PRIORS.formula[kind], the within-node
 * sums of squares; Student-t EM weights down-weight an unlike life). tau^2:
 * DerSimonian-Laird over the OTHER nodes when there are >= 3 of them, else
 * PRIORS.formula.tau (stated). The node's prior N(mu-hat, q + tau^2) from the
 * other nodes, then its own lives — exact for the Gaussian model, each life
 * entering once, each weighted h / (h + lifeH0) by its hours.
 *
 * The PRIOR for a new life of `node` is formula x exp(mean), spread `sd` the
 * predictive for one life (the node bias's uncertainty + sigma), Student-t
 * df 2a. Nothing switches: no life anywhere -> the stated prior (unbiased,
 * x/÷ e^sigma0); the node's first life -> the cross-node mean and tau; each
 * own life adds precision. `weight` is the node's OWN lives' share of the
 * bias's precision, `dataWeight` all lives' share against the stated prior.
 *
 * residuals [{ln, hours, node, life?}]. Returns {kind, node, mean, sd,
 * sdLife, df, n, own, weight, dataWeight, mu, tau, outliers, nodes, why}.
 */
export function formulaErrorPosterior(residuals, kind = 'income', { node = null, prior = PRIORS.formula[kind], nu = PRIORS.driftNu } = {}) {
  const P = prior ?? PRIORS.formula.income
  const h0 = PRIORS.formula.lifeH0
  const R = (residuals ?? []).filter((r) => fin(r?.ln) && fin(r?.hours) && r.hours > 0)
  const hw = R.map((r) => r.hours / (r.hours + h0))
  const s0 = Math.sqrt(P.b / (P.a - 1)) // the stated scatter, also mu's prior sd
  const groupsOf = (tw) => {
    const g = new Map()
    R.forEach((r, i) => {
      const k = r.node ?? '?'
      if (!g.has(k)) g.set(k, { W: 0, S: 0, n: 0, idx: [] })
      const x = g.get(k)
      const w = hw[i] * tw[i]
      x.W += w
      x.S += w * r.ln
      x.n++
      x.idx.push(i)
    })
    for (const x of g.values()) x.mean = x.W > 0 ? x.S / x.W : 0
    return g
  }
  let tw = R.map(() => 1)
  let g = groupsOf(tw)
  let s2 = s0 * s0
  let A = P.a
  for (let it = 0; it < 40; it++) {
    // sigma^2 | groups: IG(a0 + (n - groups)/2, b0 + within-node SS / 2).
    let ss = 0
    let dof = 0
    for (const x of g.values()) {
      for (const i of x.idx) ss += hw[i] * tw[i] * (R[i].ln - x.mean) ** 2
      dof += x.n - 1
    }
    A = P.a + dof / 2
    const B = P.b + ss / 2
    const next = B / (A - 1)
    const tw2 = R.map((r, i) => (nu + 1) / (nu + (r.ln - g.get(r.node ?? '?').mean) ** 2 / next))
    const done = Math.abs(next - s2) < 1e-10 * s2
    s2 = next
    tw = tw2
    g = groupsOf(tw)
    if (done) break
  }
  const key = node ?? '?'
  const others = [...g.entries()].filter(([k]) => k !== key).map(([k, x]) => ({ node: k, est: x.mean, v: s2 / x.W, n: x.n }))
  const re = others.length >= 3 ? randomEffects(others) : null
  const tau2 = re ? re.tau2 : PRIORS.formula.tau ** 2
  // mu | other nodes: N(m0, s0^2) prior, each node N(mu, v + tau^2).
  let prec = 1 / (s0 * s0)
  let acc = P.m / (s0 * s0)
  for (const o of others) {
    prec += 1 / (o.v + tau2)
    acc += o.est / (o.v + tau2)
  }
  const muHat = acc / prec
  const q = 1 / prec
  const pm = muHat
  const pv = q + tau2
  const own = g.get(key)
  let mean = pm
  let v = pv
  let weight = 0
  if (own && own.W > 0) {
    const vo = s2 / own.W
    const pr = 1 / pv + 1 / vo
    mean = (pm / pv + own.mean / vo) / pr
    v = 1 / pr
    weight = 1 / vo / pr
  }
  const df = 2 * A
  const tf = df > 2 ? df / (df - 2) : 3
  const sd = Math.sqrt((v + s2) * tf)
  const dataWeight = 1 - (1 / (s0 * s0 + tau2)) / (1 / v)
  const outliers = tw.filter((w) => w < 0.5).length
  const nodes = [...g.keys()].filter((k) => k !== '?')
  return {
    kind,
    node,
    mean,
    sd,
    sdLife: Math.sqrt(s2 * tf),
    df,
    n: R.length,
    own: own?.n ?? 0,
    weight,
    dataWeight: Math.max(0, Math.min(1, dataWeight)),
    mu: muHat,
    tau: Math.sqrt(tau2),
    tauSource: re ? 'DerSimonian-Laird over the other nodes' : 'stated (fewer than 3 other nodes)',
    outliers,
    nodes: Object.fromEntries([...g.entries()].map(([k, x]) => [k, { lives: x.n, bias: +x.mean.toFixed(3) }])),
    why:
      `${kind} formula error${node !== null ? ` for BitNode ${node}` : ''}: ln(realised/model) ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} (x${Math.exp(mean).toFixed(2)}), one life x/÷ ${Math.exp(1.2816 * sd).toFixed(2)} at 80% (t, df ${df.toFixed(0)}); ` +
      `${own?.n ?? 0} own li${(own?.n ?? 0) === 1 ? 'fe' : 'ves'} carry ${Math.round(100 * weight)}% of the node's bias, ${others.reduce((a, o) => a + o.n, 0)} li${others.reduce((a, o) => a + o.n, 0) === 1 ? 'fe' : 'ves'} in ${others.length} other node(s) the cross-node mean x${Math.exp(muHat).toFixed(2)} (between nodes x/÷ ${Math.exp(1.2816 * Math.sqrt(tau2)).toFixed(2)}, ${re ? 'fitted' : 'stated'}); ` +
      `one life's scatter x/÷ ${Math.exp(1.2816 * Math.sqrt(s2)).toFixed(2)}; ${outliers} li${outliers === 1 ? 'fe' : 'ves'} down-weighted as unlike the rest; stated prior: unbiased, x/÷ ${Math.exp(1.2816 * s0).toFixed(1)}`,
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
 * THE HACKING STREAM ONLY, every life. The prior stands in for exitplan's
 * level-scaled incomePerSec, so it measures what that input means: tel.js's
 * third sample element, moneySources.sinceInstall.hacking. The second element
 * is every income source — the trader's sales and hacknet among them, which
 * the exit prices through their own terms (capitalReturnPerSec, lifeIncome).
 * A life recorded before the split (two-element samples, before 2026-09-29)
 * is RECONSTRUCTED where its window allows (legacyHackingWindow: the total
 * less a hard upper bound on everything else), and EXCLUDED where it does
 * not, with the reason in `excluded` and the `why`. A legacy total never
 * stands in for hacking income: with nothing splittable the result is null.
 *
 * earnings {lives: {<lastAugReset>: {node, complete, samples: [[ageH, total, hacking?]]}}}
 * ledger   [{at, lifeH, hackMult, bitNode, capStart?}] (lifetimes)
 * legacy   PRIORS.legacyNonHack by default (the bound's constants)
 * Returns {mean, sd (of ln income/s), perSec (median), lives, stream,
 * reconstructed, excluded, source, why} or null.
 */
export function incomePrior({ earnings, ledger = [], node, ageH = 0, hackMultNow = null, shm = null, windowH = 0.5, legacy = PRIORS.legacyNonHack } = {}) {
  const all = Object.entries(earnings?.lives ?? {}).filter(([, L]) => L && L.complete === true && Array.isArray(L.samples) && L.samples.length >= 2)
  const entryAt = (startMs) => {
    // The lifetimes entry whose life started at startMs (at - lifeH), within 15 min.
    let best = null
    for (const e of ledger ?? []) {
      if (!(fin(e?.lifeH) && fin(e?.hackMult) && fin(Date.parse(e?.at)))) continue
      const st = Date.parse(e.at) - e.lifeH * 3.6e6
      const d = Math.abs(st - startMs)
      if (d < 15 * 60e3 && (!best || d < best.d)) best = { d, e }
    }
    return best?.e ?? null
  }
  // The window a life is read over, and the cumulative series of column idx.
  const seriesOf = (L, idx) => {
    const pts = L.samples.filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[idx])).map((q) => [q[0], q[idx]]).sort((a, b) => a[0] - b[0])
    if (pts.length < 2) return null
    let hi = 0
    for (const q of pts) hi = q[1] = Math.max(hi, q[1])
    return pts
  }
  const windowOf = (pts) => {
    const end = pts[pts.length - 1][0]
    const first = pts.find((q) => q[1] > 0)?.[0]
    if (!fin(first)) return null
    const a0 = Math.min(Math.max(ageH, first), Math.max(first, end - windowH))
    const a1 = Math.min(end, a0 + windowH)
    return a1 > a0 ? { a0, a1 } : null
  }
  // A life is SPLIT from its first three-element sample on (tel.js recorded
  // the hacking stream from 2026-09-29; the life then running is split only
  // from there). Before it, the totals are reconstructed, and the first split
  // sample caps them: hacking since the install can only have grown.
  const splitFromOf = (L) => {
    const q = L.samples.filter((x) => Array.isArray(x) && fin(x[0]) && fin(x[2])).sort((x, y) => x[0] - y[0])
    return q.length ? q : null
  }
  const obsOf = (k, L) => {
    const sp = splitFromOf(L)
    const tot = seriesOf(L, 1)
    const w = tot && windowOf(tot)
    if (sp && sp.length >= 2 && (!w || w.a0 >= sp[0][0])) {
      const pts = seriesOf({ samples: sp }, 2)
      const w2 = pts && windowOf(pts)
      if (!w2) return { skip: 'no hacking earned', split: true }
      const r = (cumAt(pts, w2.a1) - cumAt(pts, w2.a0)) / ((w2.a1 - w2.a0) * 3600)
      return r > 0 ? { rate: r, weight: 1, kind: 'split' } : { skip: 'no hacking earned in the window', split: true }
    }
    if (!w) return { skip: 'nothing earned' }
    const e = entryAt(Number(k))
    // Hacking in the window is at most the hacking recorded by the first split
    // sample at or after its end.
    const after = sp ? sp.find((q) => q[0] >= w.a1) ?? sp[sp.length - 1] : null
    const hackCap = after && after[0] >= w.a1 ? Math.max(0, after[2]) : Infinity
    const rec = legacyHackingWindow(tot, w.a0, w.a1, { cash0: fin(e?.capStart) && e.capStart > 0 ? e.capStart : 0, hackCap, ...legacy })
    // Not separable: the bound is still an UPPER bound on the hacking rate,
    // kept as a censored observation (below), never as a value.
    if (!rec.ok) return { skip: rec.why, upper: rec.hi }
    // The bracket [lo, hi] as a uniform on ln: its variance joins one life's
    // scatter, and the observation is weighted by the precision that leaves.
    const s0 = PRIORS.incomeLifeSdLn
    const bv = rec.bracketLn ** 2 / 12
    return { rate: rec.perSec, weight: (s0 * s0) / (s0 * s0 + bv), kind: 'reconstructed', share: rec.minShare }
  }
  const collect = (sameNode) => {
    const out = []
    const bounded = []
    const skipped = []
    for (const [k, L] of all) {
      if ((L.node === node) !== sameNode) continue
      // A life's rate is scaled to this life's multiplier; a life whose own
      // multiplier is not in the ledger (a node's last life, ended by the
      // daemon rather than an install, records no entry) cannot be, and
      // taking it at ratio 1 read BN1's x8 final life as if at x1.4.
      const m = entryAt(Number(k))?.hackMult
      if (fin(hackMultNow) && !(fin(m) && m > 0)) {
        skipped.push({ life: k, node: L.node, why: 'its hacking multiplier is not in the lifetimes ledger: cannot be scaled to this life' })
        continue
      }
      const multRatio = fin(hackMultNow) && fin(m) && m > 0 ? hackMultNow / m : 1
      let nodeRatio = 1
      if (!sameNode) {
        const a = typeof shm === 'function' ? shm(node) : null
        const b = typeof shm === 'function' ? shm(L.node) : null
        if (!(fin(a) && fin(b) && a > 0 && b > 0)) continue // a node whose scripts earn nothing says nothing
        nodeRatio = a / b
      }
      const o = obsOf(k, L)
      if (!o.rate) {
        if (!o.split) skipped.push({ life: k, node: L.node, why: o.skip })
        if (o.upper > 0) bounded.push({ lnUpper: Math.log(o.upper * multRatio * nodeRatio), life: k })
        continue
      }
      out.push({ ln: Math.log(o.rate * multRatio * nodeRatio), life: k, rate: o.rate, multRatio, weight: o.weight, kind: o.kind })
    }
    return { out, bounded, skipped }
  }
  let pick = collect(true)
  const ownSkipped = pick.skipped
  let source = `${pick.out.length} earlier life/lives in BitNode ${node}`
  let extra = 0
  if (!pick.out.length) {
    const ownBounded = pick.bounded
    pick = collect(false)
    pick.skipped = [...ownSkipped, ...pick.skipped]
    // This node's own censored lives still bound it (no cross-node widening).
    pick.bounded = [...ownBounded, ...pick.bounded]
    source = `${pick.out.length} life/lives in other nodes, scaled by ScriptHackMoney (none in BitNode ${node} yet)`
    extra = PRIORS.incomeCrossNodeSdLn
  }
  const { out: obs, bounded, skipped } = pick
  if (!obs.length) return null
  const recon = obs.filter((o) => o.kind === 'reconstructed').length
  if (recon) source += ` — ${recon} of them pre-split legacy li${recon === 1 ? 'fe' : 'ves'} RECONSTRUCTED as hacking (the total less an upper bound on every other source, >=${Math.round(100 * legacy.minHackShare)}% hacking guaranteed)`
  if (skipped.length) source += `; ${skipped.length} li${skipped.length === 1 ? 'fe' : 'ves'} EXCLUDED as values (${[...new Set(skipped.map((x) => (/multiplier/.test(x.why) ? 'multiplier unknown' : 'hacking not separable at this age')))].join(', ')})`
  const sd0 = PRIORS.incomeLifeSdLn
  // The best-determined observation seeds the prior; the rest update it, each
  // at its own weight (1 for a split life).
  obs.sort((a, b) => b.weight - a.weight)
  const post = nigUpdate({ m: obs[0].ln, k: obs[0].weight, a: 2, b: sd0 * sd0 }, obs.slice(1).map((o) => o.ln), obs.slice(1).map((o) => o.weight))
  // The PREDICTIVE for this life: the node mean's uncertainty plus one life's
  // own scatter (and the cross-node spread when borrowed).
  const sLife2 = post.b / (post.a - 1)
  const sdMean = Math.sqrt(sLife2 / post.k)
  const sd = Math.sqrt(sdMean * sdMean + sLife2 + extra * extra)
  // CENSORED LIVES: an inseparable legacy window still bounds hacking from
  // above (hacking <= its total). Dropping those lives would keep exactly the
  // high earners — the lives whose total dwarfs the bound — and bias the
  // prior up, the direction this reconstruction exists to remove. So the node
  // mean is the posterior MODE with each bound's likelihood P(x <= U) =
  // Phi((ln U - mu) / s) (a Tobit term; s = one life's scatter), which moves
  // it only where a bound sits below it. The spread is left as the uncensored
  // fit's (conservative: a bound adds information).
  let mean = post.m
  if (bounded.length) {
    const s = Math.sqrt(sLife2)
    const f = (mu) => -((mu - post.m) ** 2) * post.k / (2 * s * s) + bounded.reduce((acc, c) => acc + logPhi((c.lnUpper - mu) / s), 0)
    let lo = post.m - 12 * s
    let hi = post.m
    for (let i = 0; i < 100; i++) {
      const a = lo + (hi - lo) * 0.382
      const b = lo + (hi - lo) * 0.618
      if (f(a) < f(b)) lo = a
      else hi = b
    }
    mean = (lo + hi) / 2
    source += `, ${bounded.length} of them kept as upper bounds (censored: hacking <= the total), moving the median x${Math.exp(mean - post.m).toFixed(2)}`
  }
  return {
    mean,
    sd,
    sdLife: Math.sqrt(sLife2),
    perSec: Math.exp(mean),
    // The median before the censored lives' upper bounds (for the record).
    perSecUncensored: Math.exp(post.m),
    lives: obs.length,
    bounded: bounded.length,
    stream: 'hacking',
    reconstructed: recon,
    excluded: skipped,
    source,
    why: `income from prior: ${source} at age ${ageH.toFixed(2)}h, median $${Math.exp(mean).toExponential(2)}/s, x/÷ ${Math.exp(1.2816 * sd).toFixed(1)} at 80%`,
  }
}

// ln of the standard normal CDF, accurate in the far lower tail.
function logPhi(z) {
  if (z < -8) return -0.5 * z * z - Math.log(-z) - 0.5 * Math.log(2 * Math.PI) + Math.log(1 - 1 / (z * z) + 3 / z ** 4)
  // erfc by Abramowitz-Stegun 7.1.26 (abs error < 1.5e-7) on |x|.
  const x = -z / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x)
  const phi = x >= 0 ? y / 2 : 1 - y / 2
  return Math.log(Math.max(phi, 1e-300))
}

// Linear interpolation of a cumulative series [[ageH, $]] at h (clamped).
function cumAt(pts, h) {
  if (h <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (h - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0] || 1)
  return pts[pts.length - 1][1]
}

/**
 * THE HACKING SHARE OF A PRE-SPLIT LIFE'S WINDOW, reconstructed from a bound.
 * A legacy sample's total is sum(max(0, moneySources.sinceInstall[k])) over
 * every income source (tel.js INCOME_SOURCES); nothing recorded the split per
 * life, and no other ledger carries it (stock-hist.txt and stock.txt are this
 * life's only; history.jsonl keeps the cash balance, spending included). So
 * hacking = total - (everything else), and everything else is BOUNDED:
 *
 *  - the trader: the game books a sale as +proceeds and a purchase as -cost
 *    under `stock` (StockMarket/BuyingAndSelling.tsx:105/173/280/362), so
 *    max(0, stock) at age t is at most the realised profit to t — which can
 *    land in ONE window (act-liquidate.js sells everything before an
 *    install), so its whole-life bound is charged to the window:
 *    r x integral_0^a1 min(cap, wealth(t)) dt, with wealth(t) <= cash0 +
 *    total(t) (spending only lowers it);
 *  - every other source (hacknet, crime, work, sleeves, gang, contracts):
 *    otherPerSec x the window.
 *
 * {ok, perSec (geometric midpoint of [lo, total]), lo, hi, minShare,
 * bracketLn, why}. ok only when the guaranteed hacking share lo/total is at
 * least minHackShare. Pure.
 */
export function legacyHackingWindow(pts, a0, a1, { cash0 = 0, hackCap = Infinity, stockReturnPerSec, stockCap, otherPerSec, minHackShare } = {}) {
  const dt = (a1 - a0) * 3600
  const total = cumAt(pts, a1) - cumAt(pts, a0)
  if (!(dt > 0 && total > 0)) return { ok: false, hi: 0, why: 'nothing earned in the window' }
  // Trapezoid over the samples to a1 of min(cap, cash0 + total(t)).
  const knots = [...pts.map((q) => q[0]).filter((h) => h > 0 && h < a1), a1]
  let integ = 0
  let hPrev = 0
  let wPrev = Math.min(stockCap, cash0 + cumAt(pts, 0))
  for (const h of knots) {
    const w = Math.min(stockCap, cash0 + cumAt(pts, h))
    integ += ((w + wPrev) / 2) * (h - hPrev) * 3600
    hPrev = h
    wPrev = w
  }
  const stockMax = stockReturnPerSec * integ
  const otherMax = otherPerSec * dt
  const lo = total - stockMax - otherMax
  // The hacking stream is also at most the total, and at most what a later
  // split sample says was hacked since the install (hackCap).
  const hi = Math.min(total, hackCap >= 0 ? hackCap : Infinity)
  const minShare = lo / hi
  const tag = `total $${(total / dt).toExponential(2)}/s over ${a0.toFixed(2)}-${a1.toFixed(2)}h, trader <= $${stockMax.toExponential(2)}, other <= $${otherMax.toExponential(2)}${hi < total ? `, hacking <= $${(hi / dt).toExponential(2)}/s (a later split sample)` : ''}`
  // THE BOUNDS CONTRADICT (lo > hi): hacking would have to be at least lo and
  // at most hi — the bound on every other source was too small for this
  // window (BN9 2026-09-28 at 7h: the total less that bound read $2.8b in half
  // an hour against $184m hacked in the whole life). Not separable; an upper
  // bound only. Found by tools/sim/freshcal.mjs, which read $1.5e6/s here.
  if (lo > hi) return { ok: false, minShare, hi: hi / dt, why: `${tag}: the bounds contradict (total less the other sources exceeds the hacking cap) — the other sources' bound is too small here` }
  if (!(hi > 0 && minShare >= minHackShare)) return { ok: false, minShare, hi: hi / dt, why: `${tag}: hacking only >= ${(100 * Math.max(0, minShare)).toFixed(0)}% of its bound guaranteed` }
  const perSec = Math.sqrt(lo * hi) / dt
  return { ok: true, perSec, lo: lo / dt, hi: hi / dt, minShare, bracketLn: Math.log(hi / lo), why: `${tag}: hacking ${(100 * minShare).toFixed(0)}-100% of its bound` }
}

/**
 * THIS LIFE'S HACKING RATE AS AN OBSERVATION, from tel.js's earnings ledger
 * (the running life's samples [ageH, total, hacking]): how long the hacking
 * stream has been earning (`hours`, from the first sample with hacking > 0)
 * and its rate over the last `windowH` of that. A batcher PREPPING its target
 * earns $0/s by design (batch.txt says so) — that is not a measurement of a
 * zero income, so until the stream has earned anything there is NO
 * observation (null), and the prior stands alone. `nowPerSec` (the running
 * scripts' hacking stream, nodeecon.incomeOf) is the value when positive; the
 * ledger's rate is the fallback (a new target being prepped mid-life). Pure.
 * {perSec, hours, source} or null.
 */
export function lifeHackingObservation(samples, ageH, { nowPerSec = null, windowH = 0.5 } = {}) {
  const pts = (samples ?? []).filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[2])).map((q) => [q[0], q[2]]).sort((a, b) => a[0] - b[0])
  const first = pts.find((q) => q[1] > 0)
  if (!first || !fin(ageH)) return null
  const hours = Math.max(0, ageH - first[0])
  if (!(hours > 0)) return null
  if (fin(nowPerSec) && nowPerSec > 0) return { perSec: nowPerSec, hours, source: 'the running scripts\' hacking stream' }
  const last = pts[pts.length - 1]
  const a0 = Math.max(first[0], last[0] - windowH)
  const r = last[0] > a0 ? (last[1] - cumAt(pts, a0)) / ((last[0] - a0) * 3600) : 0
  return r > 0 ? { perSec: r, hours, source: `the earnings ledger's last ${(last[0] - a0).toFixed(2)}h` } : null
}

/**
 * THE FRESH LIFE'S HACKING INCOME IS A POSTERIOR, never a switch. The prior
 * (incomePrior: earlier lives at this age, the predictive for THIS life) is
 * updated by this life's own measurement (lifeHackingObservation), whose
 * weight grows with how long the stream has earned: ln(rate) measured with sd
 * PRIORS.rateSdLn x sqrt(1h / hours) — five minutes of the first batches
 * landing (the ramp) weigh about as much as the prior, two hours dominate
 * it. Normal-normal on ln(rate). Switching from the prior to the first
 * measured pass instead priced the whole trajectory on the $0/s a prepping
 * batcher reads (live BN9 2026-09-29 05:46, 0.08h into the life: exit 272h
 * against the install decision's 104h four minutes earlier).
 * prior: an incomePrior result (null -> null); obs: an observation or null.
 * Returns the prior's shape {mean, sd, perSec, ...} with `measuredWeight`.
 */
export function incomePosterior(prior, obs) {
  return ratePosterior(prior, obs, { what: 'income', none: 'a prepping batcher earns $0/s by design' })
}

/**
 * THE SAME UPDATE FOR ANY RATE WITH A PRIOR: a prior {mean, sd (of ln rate),
 * perSec, why} and this life's measurement {perSec, hours, source}, weighted
 * sd PRIORS.rateSdLn x sqrt(1h / hours). exp/s uses it (expPosterior) with
 * the formula's exp prior.
 */
export function ratePosterior(prior, obs, { what = 'rate', none = 'nothing measured' } = {}) {
  if (!prior || !fin(prior.mean) || !(prior.sd > 0)) return null
  const $ = what === 'income' ? '$' : ''
  if (!obs || !(obs.perSec > 0) || !(obs.hours > 0)) return { ...prior, measuredWeight: 0, why: `${prior.why}; nothing measured this life yet (${none}): the prior alone` }
  const sm = PRIORS.rateSdLn * Math.sqrt(1 / obs.hours)
  const wp = 1 / (prior.sd * prior.sd)
  const wm = 1 / (sm * sm)
  const mean = (prior.mean * wp + Math.log(obs.perSec) * wm) / (wp + wm)
  const sd = Math.sqrt(1 / (wp + wm))
  const w = wm / (wp + wm)
  return {
    ...prior,
    mean,
    sd,
    perSec: Math.exp(mean),
    measuredWeight: w,
    measured: obs,
    why: `${what} posterior: prior ${$}${prior.perSec.toExponential(2)}/s (x/÷ ${Math.exp(1.2816 * prior.sd).toFixed(1)}) updated by this life's ${$}${obs.perSec.toExponential(2)}/s over ${obs.hours.toFixed(2)}h (${obs.source}; weight ${(100 * w).toFixed(0)}%) -> median ${$}${Math.exp(mean).toExponential(2)}/s, x/÷ ${Math.exp(1.2816 * sd).toFixed(1)} at 80% [${prior.why}]`,
  }
}

/**
 * THE INSTALL'S OWN BELIEF AS THE NEXT LIFE'S PRIOR (plan.installCarryOf
 * `exp`): the rate the install's simulation carried into this life — the
 * last life's posterior `perSec` at its level `c.level`, times this life's
 * multiplier over the one it was read at (`mult / c.mult`: the batch's gain,
 * exactly what the install bought), at this life's `level` on the exit's
 * (level + 50) shape (exitplan.expRateShape). sd: that posterior's own and
 * one life's scatter (PRIORS.carryLifeSdLn). The same number the install
 * priced the next life on, so the next life's first exit prices the same
 * trajectory; its own measurement takes over as it accrues (ratePosterior).
 * Null when the carry is incomplete. {mean, sd, perSec, source: 'carried', why}.
 */
export function carriedRatePrior(c, { level = null, mult = null, what = 'exp', lifeSdLn = PRIORS.carryLifeSdLn } = {}) {
  if (!c || !(c.perSec > 0) || !(c.level > 0) || !(level > 0)) return null
  const gain = mult > 0 && c.mult > 0 ? mult / c.mult : 1
  const perSec = c.perSec * gain * ((level + 50) / (c.level + 50))
  const sd0 = fin(c.sdLn) && c.sdLn > 0 ? c.sdLn : PRIORS.rateSdLn
  const sd = Math.sqrt(sd0 * sd0 + lifeSdLn * lifeSdLn)
  return {
    mean: Math.log(perSec),
    sd,
    perSec,
    source: 'carried',
    why: `${what} carried by the install (${c.at ?? '?'}): ${c.perSec.toExponential(2)}/s at level ${Math.round(c.level)} x ${gain.toFixed(3)} (this life's multiplier over the install's) x (${Math.round(level)} + 50)/(${Math.round(c.level)} + 50) -> ${perSec.toExponential(2)}/s, x/÷ ${Math.exp(1.2816 * sd).toFixed(2)} at 80% (the install's own sd with one life's scatter)`,
  }
}

/**
 * THE PLAYER'S FACTION-WORK REPUTATION RATE, A POSTERIOR ON THE FORMULA'S
 * COEFFICIENT. The ground reputation leg is ground by the player ON FACTION
 * WORK, so its rate is the game's formula (trajectory.estimateBaseRepPerSec:
 * reputation.ts getHackingWorkRepGain at this life's skills and multipliers,
 * share bonus 1, favour divided out) times k, and the belief is over ln k:
 * the share bonus the grind actually runs with, focus, and whatever else the
 * formula misses. k carries across an install as it stands (a ratio: the next
 * life's formula already has its multipliers and level); the rate never does.
 *
 * Live BN9 2026-09-30 17:51Z: the slot was GRAFTING (5 grafts, 6.67h) and the
 * one-pass reputation delta at the last-worked faction — contracts, the Go
 * favour stream, anything but the player's own work: ~6/s at EVERY joined
 * faction — was published as the measured rate, 5.96/s against the formula's
 * ~60/s. The exit's ground leg went 2.7h -> 14.4h and the new life priced
 * itself at 21.2h against the install's 7.6h (EXIT JUMP AT INSTALL, +13.6h).
 *
 *   formula   this life's formula base rate (no share, no favour), rep/s
 *   carried   {mean, sd, at} a posterior on ln k another life ended with
 *             (the install's `carry.rep`, else the schedule record's), or null
 *   samples   this life's VALID samples [{at, lnK, h}] (plan.repSampleOf:
 *             faction hacking work at both ends of the interval)
 * Prior: carried, widened by one life's scatter (PRIORS.carryLifeSdLn), else
 * the formula itself (ln k = 0, PRIORS.repEstimateSdLn). Observation: the
 * MEDIAN ln k of the samples (robust to a short or interrupted interval),
 * with sd PRIORS.rateSdLn x sqrt(1h / their hours) — ratePosterior's weight.
 * Returns {mean, sd, k, perSec, formula, measuredWeight, n, hours, source,
 * why} or null (no formula).
 */
export function repRatePosterior({ formula = null, carried = null, samples = [], lifeSdLn = PRIORS.carryLifeSdLn } = {}) {
  if (!(fin(formula) && formula > 0)) return null
  const hasCarry = carried && fin(carried.mean) && fin(carried.sd) && carried.sd > 0
  const prior = hasCarry
    ? { mean: carried.mean, sd: Math.sqrt(carried.sd * carried.sd + lifeSdLn * lifeSdLn), source: 'carried', why: `k carried from ${carried.at ?? 'the last life'}: ${Math.exp(carried.mean).toFixed(3)} x/÷ ${Math.exp(1.2816 * carried.sd).toFixed(2)}, one life's scatter added` }
    : { mean: 0, sd: PRIORS.repEstimateSdLn, source: 'formula', why: `the game's formula (k = 1, x/÷ ${Math.exp(1.2816 * PRIORS.repEstimateSdLn).toFixed(2)} at 80%, stated)` }
  const S = (Array.isArray(samples) ? samples : []).filter((s) => fin(s?.lnK) && fin(s?.h) && s.h > 0)
  const hours = S.reduce((a, s) => a + s.h, 0)
  if (!S.length || !(hours > 0)) {
    return { mean: prior.mean, sd: prior.sd, k: Math.exp(prior.mean), perSec: formula * Math.exp(prior.mean), formula, measuredWeight: 0, n: 0, hours: 0, source: prior.source, why: `faction-work reputation: formula ${formula.toFixed(2)}/s x k ${Math.exp(prior.mean).toFixed(3)} = ${(formula * Math.exp(prior.mean)).toFixed(2)}/s [${prior.why}]; no faction work measured this life` }
  }
  const xs = S.map((s) => s.lnK).sort((a, b) => a - b)
  const med = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
  const sm = PRIORS.rateSdLn * Math.sqrt(1 / hours)
  const wp = 1 / (prior.sd * prior.sd)
  const wm = 1 / (sm * sm)
  const mean = (prior.mean * wp + med * wm) / (wp + wm)
  const sd = Math.sqrt(1 / (wp + wm))
  const w = wm / (wp + wm)
  return {
    mean,
    sd,
    k: Math.exp(mean),
    perSec: formula * Math.exp(mean),
    formula,
    measuredWeight: w,
    n: S.length,
    hours,
    source: prior.source === 'carried' ? 'carried+measured' : 'measured',
    why: `faction-work reputation: formula ${formula.toFixed(2)}/s x k ${Math.exp(mean).toFixed(3)} = ${(formula * Math.exp(mean)).toFixed(2)}/s; k posterior: prior ${Math.exp(prior.mean).toFixed(3)} [${prior.why}] updated by ${S.length} faction-work sample(s) over ${hours.toFixed(2)}h, median k ${Math.exp(med).toFixed(3)} (weight ${(100 * w).toFixed(0)}%) -> x/÷ ${Math.exp(1.2816 * sd).toFixed(2)} at 80%`,
  }
}

/**
 * A FRESH LIFE'S OBSERVATION COUNTS FROM THE END OF ITS RAMP: `obs.hours`
 * (the life's age) less `rampH`; none inside the ramp — the fleet
 * re-rooting is not the life's rate (PRIORS.freshRampH). null in, null out.
 */
export function afterRamp(obs, rampH = PRIORS.freshRampH) {
  if (!obs || !fin(obs.hours)) return obs ?? null
  const hours = obs.hours - (fin(rampH) && rampH > 0 ? rampH : 0)
  return hours > 0 ? { ...obs, hours, source: `${obs.source ?? 'measured'}, hours after the ${rampH}h fresh-life ramp` } : null
}

/**
 * A FORMULA PRIOR FOR A RATE AT AN AGE OF THE LIFE: freshlife.js's
 * simulated fresh life (`pts`, a series with `key` cumulative — 'cum' the
 * hacking stream's $, 'exp' the hacking exp) over [a0, a0 + windowH], a0 =
 * max(ageH, the first age the formula earns), times the formula's error
 * posterior (formulaErrorPosterior: exp(mean), predictive sd). Null when the
 * formula says the stream is zero at every age (scripted hacking paying
 * nothing, BitNode 8; a farm holding the whole fleet) — no prior, said so by
 * the caller. Returns {mean, sd, perSec, modelPerSec, source: 'formula',
 * err, why}.
 */
export function formulaRatePrior(pts, ageH, err, { key = 'cum', windowH = 0.5, what = 'income' } = {}) {
  if (!Array.isArray(pts) || pts.length < 2 || !err || !fin(err.mean) || !(err.sd > 0)) return null
  const at = (h) => {
    if (h <= pts[0].h) return pts[0][key]
    for (let i = 1; i < pts.length; i++) if (h <= pts[i].h) return pts[i - 1][key] + ((pts[i][key] - pts[i - 1][key]) * (h - pts[i - 1].h)) / (pts[i].h - pts[i - 1].h || 1)
    const n = pts.length
    const slope = (pts[n - 1][key] - pts[n - 2][key]) / (pts[n - 1].h - pts[n - 2].h || 1)
    return pts[n - 1][key] + slope * (h - pts[n - 1].h)
  }
  let first = null
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][key] > pts[i - 1][key]) {
      first = pts[i - 1].h
      break
    }
  }
  if (first === null) return null
  const a0 = Math.max(fin(ageH) ? ageH : 0, first)
  const rate = (at(a0 + windowH) - at(a0)) / (windowH * 3600)
  if (!(rate > 0)) return null
  const mean = Math.log(rate) + err.mean
  const $ = what === 'income' ? '$' : ''
  return {
    mean,
    sd: err.sd,
    perSec: Math.exp(mean),
    modelPerSec: rate,
    source: 'formula',
    stream: what === 'income' ? 'hacking' : what,
    lives: err.n,
    err: { mean: err.mean, sd: err.sd, n: err.n, own: err.own, weight: err.weight },
    why: `${what} from the formula (freshlife.js) at age ${a0.toFixed(2)}h: ${$}${rate.toExponential(2)}/s x ${Math.exp(err.mean).toFixed(2)} (${err.why}) -> median ${$}${Math.exp(mean).toExponential(2)}/s, x/÷ ${Math.exp(1.2816 * err.sd).toFixed(1)} at 80%`,
  }
}
