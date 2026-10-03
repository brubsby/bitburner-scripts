// THE EXIT FORECAST'S CALIBRATION — diagnosis, a forecast-revision test,
// online recalibration of its spread, anytime-valid alarms, and the
// calibration of the differences the decisions turn on. Pure: no ns surface.
// plan.posteriorsOf calls exitCalibrationReport every pass; the state it
// returns rides on /tel/plan.txt (calibration.state) and comes back next pass.
// docs/bayes.md "Calibration" is the design.
//
// WHY (live BN4 2026-10-02): healthcheck read PLAN MISCALIBRATED — the 80%
// one-step interval covered 100% of 24 realised moves — and the obvious
// reading, "the intervals are too wide, shrink them", is only half of it.
// The one-step predictive (bayes.driftCalibration) is the iid-noise model
// ("each published exit is the truth x exp(e), e independent per sample"),
// its scale s from an IG(2, 2*0.1^2) prior that still held ~90% of the
// posterior's sum of squares after 29 pairs. The published LEVEL interval is
// a different object (the Monte Carlo's q10-q90) and nothing checked it. A
// rational forecast is a martingale (Augenblick & Rabin, QJE 2021): its
// revisions, net of the predicted -1h/h, have mean 0, no autocorrelation, and
// their squares sum to the fall in its own predictive variance. So this
// module checks BOTH objects, and the forecast's revisions themselves:
//
//   1. DIAGNOSE (Gneiting, Balabdaoui & Raftery 2007): PIT histograms (hump =
//      too wide, U = too narrow, skew = bias) for both predictives, coverage
//      by horizon (1/2/4 samples ahead) and by whether an install falls inside
//      the window, CRPS beside coverage (a narrower interval that scores worse
//      is not a fix), and two named suspects: (a) the structural-error prior's
//      weight, (b) serially correlated pairs overstating n.
//   2. MARTINGALE TEST per life: bias of the revisions, their lag-1
//      autocorrelation, the excess movement ratio X = sum(u^2) /
//      (sigma_first^2 - sigma_last^2) (1 for a calibrated martingale), the
//      jumps at installs — and from them the verdict: OVERSTATED UNCERTAINTY
//      (small, unbiased, uncorrelated revisions inside wide intervals) or
//      STRUCTURAL ERROR (biased, autocorrelated or jumping revisions).
//   3. ONLINE RECALIBRATION (Gibbs & Candes 2021, adaptive conformal; decaying
//      step as in Angelopoulos et al. 2023): one width multiplier m on the
//      exit's predictive spread, m <- m exp(gamma_t (miss - 0.2)), gamma_t =
//      gamma0 / (1 + n)^0.6, bounded, persisted; APPLIED shrunk toward 1 by
//      n / (n + n0) (tiny n moves nothing). The predictive it scales is the
//      MARTINGALE one: a revision over dh hours ~ N(0, sigma_a^2 dh / E_a) —
//      the level interval's variance resolved uniformly over the hours left
//      (stated) — so one m calibrates the published level interval and the
//      revisions together, which is what lets it scale the exit interval and
//      the commitment rule's spread (plan.setCommitCalibration).
//   4. E-PROCESSES (Ramdas, Grunwald, Vovk & Shafer, Stat Sci 2023): two test
//      martingales on the recalibrated standardized revisions z — NARROW
//      (H0: E z^2 <= 1, i.e. mean 0 and variance <= predicted) and WIDE (H0:
//      P(inside the 80% interval) <= 0.8) — each a mixture over a fixed lambda
//      grid, persisted, so the healthcheck may look every 15 minutes forever:
//      P(ever >= 1/alpha) <= alpha under H0 (Ville). They replace the ad-hoc
//      coverage band [0.55, 0.97] at n >= 8.
//   6. VALUE EQUIVALENCE (Grimm et al. 2020): the quantities that flip
//      decisions are differences between options. The ranking's pass-to-pass
//      jitter (the relative exits of the options, Δln(Ha/Hb)) gets the same
//      sequential PIT/coverage, and every committed switch is logged with its
//      promised gain and the exit's realised drift over the next hour.
//
// NOT CALIBRATED / STATED: the uniform information arrival in the martingale
// predictive (the multiplier absorbs a constant departure from it, not a
// shape); the per-interval information rate rho (EXITCAL.rho) is read off the
// LEVEL interval's shrinkage and applied to the paired difference D; the
// value of waiting assumes waiting itself costs no exit hours.

import { PRIORS, PAIR_MAX_GAP_H, runBreak, robustIG, igUpdate, tCdf, lgamma } from 'bayes.js'

const fin = (x) => typeof x === 'number' && isFinite(x)

export const EXITCAL = {
  z80: 1.2815515655446004, // the standard normal's 90% quantile: the 80% interval is +-z80 sd
  minGapH: 0.2, // as bayes.driftPairs
  bins: 5, // PIT histogram
  horizons: [1, 2, 4], // samples ahead (~15 min each)
  alpha: 0.05, // the e-processes' level: alarm at 1/alpha
  minN: 8, // below this many revisions no verdict is drawn
  // ONLINE RECALIBRATION (adaptive conformal, decaying step). lo/hi bound m;
  // n0: m is applied as exp(ln m * n / (n + n0)).
  recal: { gamma0: 1, decay: 0.6, lo: 0.2, hi: 10, n0: 8, target: 0.2 },
  // E-PROCESS lambda grids (mixtures of test martingales are test martingales).
  // narrow: 1 + lambda (z^2 - 1) >= 1 - lambda > 0; wide: 1 + lambda (h - 0.8)
  // >= 1 - 0.8 lambda > 0. zCap2 bounds one factor (a numerical guard).
  eproc: { narrow: [0.05, 0.1, 0.2, 0.4], wide: [0.25, 0.5, 0.75, 1], zCap2: 1e4 },
  // THE INFORMATION RATE for the value of waiting: the level interval's sd
  // shrinks by rho per re-decide interval (plan.PLAN.maxAgeMin, 30 min) —
  // measured from the samples' own intervals; `def` (stated) below minN.
  rho: { intervalH: 0.5, def: 0.9, lo: 0.5, hi: 0.995, minN: 4 },
  ledgerMax: 30,
  commitLogMax: 40,
  stateVersion: 1,
}

// ---------------------------------------------------------------------------
// Distributions.
// ---------------------------------------------------------------------------

/** erfc (Numerical Recipes 6.2, Chebyshev; fractional error < 1.2e-7). */
function erfc(x) {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? r : 2 - r
}
export const normCdf = (z) => 0.5 * erfc(-z / Math.SQRT2)
export const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)

/** CRPS of N(0, 1) at z (Gneiting & Raftery 2007 eq. 21); times sigma for N(mu, sigma^2). */
export function crpsNormal(z) {
  return z * (2 * normCdf(z) - 1) + 2 * normPdf(z) - 1 / Math.sqrt(Math.PI)
}
const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b)
/** Standard Student-t density. */
export function tPdf(z, df) {
  return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (z * z) / df))
}
/**
 * CRPS of the standard Student-t (df > 1) at z (Jordan, Kruger & Lerch 2019,
 * scoringRules crps_t); times the scale for a scaled t.
 */
export function crpsT(z, df) {
  if (!(df > 1)) return null
  const F = tCdf(z, df)
  return z * (2 * F - 1) + (2 * tPdf(z, df) * (df + z * z)) / (df - 1) - (2 * Math.sqrt(df) * Math.exp(lbeta(0.5, df - 0.5) - 2 * lbeta(0.5, df / 2))) / (df - 1)
}

// ---------------------------------------------------------------------------
// The revisions.
// ---------------------------------------------------------------------------

/**
 * The LEVEL interval a sample was published with: its q10/q90 fields, else
 * the "80% interval a-bh" its source string carries (every plan-sourced
 * sample since 2026-09-27). The RAW interval — the recalibrated one is never
 * fed back here, or m would compound on itself. Returns {q10, q90, sd} | null.
 */
export function levelOf(s) {
  let q10 = fin(s?.q10) ? s.q10 : null
  let q90 = fin(s?.q90) ? s.q90 : null
  if ((q10 === null || q90 === null) && typeof s?.source === 'string') {
    const m = s.source.match(/80% interval (-?[\d.]+(?:e[+-]?\d+)?)-(-?[\d.]+(?:e[+-]?\d+)?)h/)
    if (m) {
      q10 = +m[1]
      q90 = +m[2]
    }
  }
  if (!fin(q10) || !fin(q90) || !(q90 > q10)) return null
  return { q10, q90, sd: (q90 - q10) / (2 * EXITCAL.z80) }
}

/**
 * Every consecutive pair of exit samples, with its revision u = E_b - (E_a -
 * dh) (hours; the forecast predicts a 1h fall per hour), r = u / E_a, the
 * level sds of both ends, whether an install falls inside (`cross`: another
 * life) and whether the pair breaks a run (`brk`: bayes.runBreak — another
 * model version, page, or a telemetry gap). Pairs closer than minGapH are
 * dropped (as driftPairs). `run`: same life and no break — what driftPairs keeps.
 */
export function revisionsOf(samples, { minGapH = EXITCAL.minGapH, maxGapH = PAIR_MAX_GAP_H } = {}) {
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && x.exitH > 0 && fin(Date.parse(x?.at)))
  const out = []
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1]
    const b = S[i]
    const dh = (Date.parse(b.at) - Date.parse(a.at)) / 3.6e6
    if (!(dh >= minGapH)) continue
    const brk = runBreak(a, b, { maxGapH })
    const cross = a.life !== b.life
    const u = b.exitH - (a.exitH - dh)
    const la = levelOf(a)
    const lb = levelOf(b)
    out.push({ at: b.at, aAt: a.at, dh, a: a.exitH, b: b.exitH, u, r: u / a.exitH, sdA: la?.sd ?? null, sdB: lb?.sd ?? null, life: b.life, lifeA: a.life, cross, brk, inRun: !cross && !brk })
  }
  return out
}

/** The martingale predictive's sd for a revision over dh hours from a forecast E_a with level sd sdA (null without an interval). */
export function martingaleSdOf(rev) {
  if (!fin(rev?.sdA) || !(rev.sdA > 0) || !fin(rev.a) || !(rev.a > 0)) return null
  return rev.sdA * Math.sqrt(Math.min(1, rev.dh / rev.a))
}

// ---------------------------------------------------------------------------
// Summaries.
// ---------------------------------------------------------------------------

/** Lag-1 autocorrelation of a series (demeaned); null below 3 points. */
export function rho1Of(xs) {
  const x = (xs ?? []).filter(fin)
  if (x.length < 3) return null
  const m = x.reduce((s, v) => s + v, 0) / x.length
  let num = 0
  let den = 0
  for (let i = 0; i < x.length; i++) {
    den += (x[i] - m) ** 2
    if (i) num += (x[i] - m) * (x[i - 1] - m)
  }
  return den > 0 ? num / den : null
}
/** Effective sample size of n serially correlated points (AR(1)): n (1 - rho) / (1 + rho) for rho > 0, n otherwise; at least 1. */
export function nEffOf(n, rho) {
  if (!(n > 0)) return 0
  if (!fin(rho) || rho <= 0) return n
  return Math.max(1, Math.min(n, (n * (1 - rho)) / (1 + rho)))
}

/**
 * PIT HISTOGRAM AND ITS SHAPE (Gneiting et al. 2007): a hump (variance below
 * 1/12) is an interval too wide, a U (above) too narrow, a mean off 0.5 a
 * bias. `low` skew: realised below the forecast's centre — the exit fell
 * faster than forecast (the forecasts were pessimistic).
 */
export function pitShapeOf(us) {
  const u = (us ?? []).filter(fin)
  const n = u.length
  const hist = Array(EXITCAL.bins).fill(0)
  for (const x of u) hist[Math.min(EXITCAL.bins - 1, Math.max(0, Math.floor(x * EXITCAL.bins)))]++
  if (n < 4) return { n, hist, mean: null, var: null, shape: 'insufficient', why: `${n} PIT value(s): too few for a shape` }
  const mean = u.reduce((s, x) => s + x, 0) / n
  const v = u.reduce((s, x) => s + (x - mean) ** 2, 0) / n
  const width = v < 0.75 / 12 ? 'hump' : v > 1.25 / 12 ? 'U' : 'flat'
  const skew = mean < 0.4 ? 'low' : mean > 0.6 ? 'high' : null
  const parts = [width === 'hump' ? 'hump: intervals too wide' : width === 'U' ? 'U: intervals too narrow' : 'flat width', skew === 'low' ? 'skewed low: the exit fell faster than forecast (forecasts pessimistic)' : skew === 'high' ? 'skewed high: the exit fell slower than forecast (forecasts optimistic)' : null].filter(Boolean)
  return { n, hist, mean: +mean.toFixed(3), var: +v.toFixed(4), width, skew, shape: [width, skew].filter(Boolean).join('+'), why: `PIT [${hist.join(' ')}] over ${EXITCAL.bins} bins, mean ${mean.toFixed(2)} (0.5), var ${v.toFixed(3)} (0.083): ${parts.join('; ')}` }
}

const r3 = (x) => (fin(x) ? +x.toFixed(3) : null)
const r4 = (x) => (fin(x) ? +x.toFixed(4) : null)

// ---------------------------------------------------------------------------
// 1. Diagnosis: the two predictives, sequentially.
// ---------------------------------------------------------------------------

/**
 * THE LEGACY ONE-STEP PREDICTIVE, exactly bayes.driftCalibration's (the
 * iid-noise model; scale from the robust posterior of the pairs before),
 * with its CRPS in hours and its standardized residuals. Returns
 * [{rev, x, z, pit, hit, scaleH, df, crps}] over the run pairs.
 */
export function legacyPredictiveOf(revs, prior = PRIORS.drift, nu = PRIORS.driftNu) {
  const xs = []
  const out = []
  for (const rev of revs.filter((x) => x.inRun)) {
    const p = robustIG(prior, xs, nu)
    const scale = Math.sqrt(p.b / p.a)
    const df = Math.min(nu, 2 * p.a)
    const x = rev.r / Math.SQRT2
    const z = x / scale
    const pit = tCdf(z, df)
    out.push({ rev, x, z, pit, hit: pit > 0.1 && pit < 0.9, scaleH: Math.SQRT2 * scale * rev.a, df, crps: Math.SQRT2 * scale * rev.a * crpsT(z, df) })
    xs.push(x)
  }
  return out
}

/** THE MARTINGALE PREDICTIVE (unscaled): [{rev, sd, z, pit, hit, crps}] over the run pairs that carry an interval. */
export function martingalePredictiveOf(revs, m = 1) {
  const out = []
  for (const rev of revs.filter((x) => x.inRun)) {
    const sd0 = martingaleSdOf(rev)
    if (!fin(sd0) || !(sd0 > 0)) continue
    const sd = m * sd0
    const z = rev.u / sd
    out.push({ rev, sd, z, pit: normCdf(z), hit: Math.abs(z) < EXITCAL.z80, crps: sd * crpsNormal(z) })
  }
  return out
}

const coverOf = (xs) => (xs.length ? xs.filter((x) => x.hit).length / xs.length : null)
const meanOf = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/**
 * COVERAGE BY HORIZON AND BY INSTALL. For k = 1, 2, 4 samples ahead, every
 * window of k consecutive links with no run break (version, page, gap): the
 * revision u_k = E_{i+k} - (E_i - hours), scored under both predictives — the
 * martingale one (variance sigma_i^2 hours / E_i: grows with the horizon) and
 * the legacy one (the iid-noise model: the same at every horizon; the final
 * posterior's scale, in-sample) — split by whether an install falls inside.
 * Windows overlap (n_eff ~ n / k).
 */
export function horizonsOf(samples, legacyScale, legacyDf, m = 1) {
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && x.exitH > 0 && fin(Date.parse(x?.at)))
  const rows = []
  for (const k of EXITCAL.horizons) {
    const cell = { k, within: { n: 0, mHit: 0, mN: 0, lHit: 0 }, install: { n: 0, mHit: 0, mN: 0, lHit: 0 } }
    for (let i = 0; i + k < S.length; i++) {
      let ok = true
      let cross = false
      let hours = 0
      for (let j = i + 1; j <= i + k; j++) {
        const dh = (Date.parse(S[j].at) - Date.parse(S[j - 1].at)) / 3.6e6
        if (!(dh >= EXITCAL.minGapH) || runBreak(S[j - 1], S[j])) {
          ok = false
          break
        }
        if (S[j].life !== S[j - 1].life) cross = true
        hours += dh
      }
      if (!ok) continue
      const a = S[i]
      const u = S[i + k].exitH - (a.exitH - hours)
      const c = cross ? cell.install : cell.within
      c.n++
      if (fin(legacyScale) && fin(legacyDf)) {
        const p = tCdf(u / a.exitH / Math.SQRT2 / legacyScale, legacyDf)
        if (p > 0.1 && p < 0.9) c.lHit++
      }
      const lv = levelOf(a)
      if (lv) {
        const sd = m * lv.sd * Math.sqrt(Math.min(1, hours / a.exitH))
        c.mN++
        if (Math.abs(u / sd) < EXITCAL.z80) c.mHit++
      }
    }
    const fmt = (c) => ({ n: c.n, legacyCover: c.n ? r3(c.lHit / c.n) : null, martingaleN: c.mN, martingaleCover: c.mN ? r3(c.mHit / c.mN) : null })
    rows.push({ k, within: fmt(cell.within), install: fmt(cell.install) })
  }
  return rows
}

/**
 * THE TWO SUSPECTS for the 100% coverage. (a) THE PRIOR: IG(a0, b0) with b0 =
 * a0 s0^2 enters the posterior's sum of squares as a0 pseudo-pairs each of
 * size s0^2; when the realised pairs are far smaller than s0, b0 dominates b
 * long after a0 is outweighed in a. `priorShareB` = b0 / b; the predictive
 * sd against the realised rms; coverage again under a vague prior. (b)
 * SERIAL CORRELATION: consecutive pairs share an endpoint (under the iid
 * model the residuals' lag-1 correlation is -0.5), and a persistent error
 * makes the hits run in streaks — the evidence is n_eff, not n.
 */
export function suspectsOf(revs, legacy, prior = PRIORS.drift, nu = PRIORS.driftNu) {
  const xs = legacy.map((p) => p.x)
  const n = xs.length
  const post = robustIG(prior, xs, nu)
  const sPost = Math.sqrt(post.b / (post.a - 1))
  const rms = n ? Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / n) : null
  const df = Math.min(nu, 2 * post.a)
  const predSd = Math.sqrt(post.b / post.a) * Math.sqrt(df > 2 ? df / (df - 2) : 3)
  const vague = legacyPredictiveOf(revs, { a: 1, b: 1e-8 }, nu)
  // The vague prior's first pairs are scored against no scale at all: skip
  // the first 3 (they say nothing about the width).
  const vagueCover = coverOf(vague.slice(3))
  const priorShareB = prior.b / post.b
  const rhoX = rho1Of(xs)
  const rhoHit = rho1Of(legacy.map((p) => (p.hit ? 1 : 0)))
  const nEff = nEffOf(n, rhoHit)
  const pr = {
    priorShareB: r3(priorShareB),
    sPost: r4(sPost),
    sData: r4(rms),
    widthRatio: fin(rms) && rms > 0 ? r3(predSd / rms) : null,
    vagueCover80: r3(vagueCover),
    guilty: n >= EXITCAL.minN && priorShareB > 0.5 && fin(rms) && predSd > 1.5 * rms,
  }
  pr.why = n ? `prior IG(${prior.a}, ${prior.b.toExponential(1)}) holds ${(100 * priorShareB).toFixed(0)}% of the posterior's sum of squares after ${n} pair(s): s = ${(100 * sPost).toFixed(1)}% against ${(100 * rms).toFixed(1)}% realised (predictive sd x${pr.widthRatio} the realised rms)${fin(vagueCover) ? `; under a vague prior the same pairs cover ${(100 * vagueCover).toFixed(0)}%` : ''} — ${pr.guilty ? 'GUILTY: the prior, not the data, sets the width' : 'not the cause'}` : 'no pair'
  const se = n >= 3 ? 1 / Math.sqrt(n) : null
  const sc = {
    n,
    rho1Resid: r3(rhoX),
    rho1Hits: r3(rhoHit),
    nEff: r3(nEff),
    iidExpected: -0.5,
    guilty: fin(rhoHit) && fin(se) && rhoHit > 2 * se,
  }
  sc.why = n >= 3 ? `lag-1 correlation of the residuals ${fin(rhoX) ? rhoX.toFixed(2) : '?'} (the iid model expects -0.5: consecutive pairs share an endpoint), of the hits ${fin(rhoHit) ? rhoHit.toFixed(2) : '? (all hits)'}; n ${n} -> n_eff ${nEff.toFixed(1)} — ${sc.guilty ? 'GUILTY: the hits run in streaks, n overstates the evidence' : 'the counts are not inflated by streaks'}` : 'too few pairs'
  return { prior: pr, serial: sc }
}

// ---------------------------------------------------------------------------
// 2. The martingale (forecast-revision) test.
// ---------------------------------------------------------------------------

/**
 * THE FORECAST-REVISION TEST (Augenblick & Rabin 2021; Patton & Timmermann
 * 2012), per life (a run of same-life, unbroken pairs) and pooled:
 *   bias      sum u / sum dh — the exit's movement beyond the predicted
 *             -1h/h — with t against n_eff;
 *   rho1      lag-1 autocorrelation of u (significant beyond 2/sqrt(n));
 *   X         excess movement sum u^2 / (sigma_first^2 - sigma_last^2), the
 *             level interval's own variance resolved over the run: 1 for a
 *             calibrated martingale, < 1 small revisions inside wide
 *             intervals, > 1 the level interval too narrow for how the
 *             forecast moves;
 *   jumps     the revisions across an install (another life), in level sds.
 * Verdict: STRUCTURAL ERROR when the revisions are biased, autocorrelated,
 * jump at installs, or move more than the interval resolves (X > 2);
 * OVERSTATED UNCERTAINTY when they are small inside the forecast's own
 * interval (X < 0.5, or > 90% of them inside the martingale predictive's 80%);
 * both can hold (small AND biased). `martCover`: that coverage.
 */
export function martingaleTestOf(revs, martCover = null) {
  const runs = []
  let cur = null
  for (const rev of revs) {
    if (!rev.inRun) {
      cur = null
      continue
    }
    if (!cur || cur.life !== rev.life) {
      cur = { life: rev.life, revs: [] }
      runs.push(cur)
    }
    cur.revs.push(rev)
  }
  const lives = runs.map((r) => {
    const us = r.revs.map((x) => x.u)
    const n = us.length
    const sumDh = r.revs.reduce((s, x) => s + x.dh, 0)
    const mean = meanOf(us)
    const sd = n > 1 ? Math.sqrt(us.reduce((s, u) => s + (u - mean) ** 2, 0) / (n - 1)) : null
    const rho = rho1Of(us)
    const M = us.reduce((s, u) => s + u * u, 0)
    const first = r.revs.find((x) => fin(x.sdA))
    const last = [...r.revs].reverse().find((x) => fin(x.sdB))
    const R = first && last ? first.sdA ** 2 - last.sdB ** 2 : null
    return { life: r.life, from: r.revs[0].aAt, to: r.revs[n - 1].at, n, hours: r3(sumDh), meanU: r3(mean), excessPerH: r3(us.reduce((s, u) => s + u, 0) / sumDh), t: fin(sd) && sd > 0 ? r3(mean / (sd / Math.sqrt(nEffOf(n, rho)))) : null, rho1: r3(rho), movement: r3(M), resolved: r3(R), X: fin(R) && R > 0 ? r3(M / R) : null, _M: M, _R: R, _us: us }
  })
  // Pooled: lag pairs only within a life.
  const all = lives.flatMap((l) => l._us)
  const n = all.length
  const hours = lives.reduce((s, l) => s + (l.hours ?? 0), 0)
  const mean = meanOf(all)
  let num = 0
  let den = 0
  for (const l of lives) for (let i = 0; i < l._us.length; i++) {
    den += (l._us[i] - mean) ** 2
    if (i) num += (l._us[i] - mean) * (l._us[i - 1] - mean)
  }
  const rho1 = n >= 3 && den > 0 ? num / den : null
  const sd = n > 1 ? Math.sqrt(den / (n - 1)) : null
  const nEff = nEffOf(n, rho1)
  const t = fin(sd) && sd > 0 ? mean / (sd / Math.sqrt(nEff)) : null
  const Mp = lives.reduce((s, l) => s + l._M, 0)
  const Rp = lives.reduce((s, l) => s + (fin(l._R) && l._R > 0 ? l._R : 0), 0)
  const X = Rp > 0 ? Mp / Rp : null
  const jumps = revs.filter((x) => x.cross && !x.brk).map((x) => ({ at: x.at, u: r3(x.u), z: fin(x.sdA) && x.sdA > 0 ? r3(x.u / x.sdA) : null }))
  const jz = jumps.map((j) => j.z).filter(fin)
  const reasons = []
  const enough = n >= EXITCAL.minN
  const biased = enough && fin(t) && Math.abs(t) >= 2
  const corr = enough && fin(rho1) && Math.abs(rho1) > 2 / Math.sqrt(n)
  const jumpy = jz.some((z) => Math.abs(z) > 3)
  const excess = enough && fin(X) && X > 2
  // Overstated is read on the forecast's OWN interval (the martingale
  // predictive): small revisions inside it. The legacy one-step interval's
  // width is the iid model's (suspect (a), reported beside), not the
  // forecast's.
  const small = enough && ((fin(X) && X < 0.5) || (fin(martCover) && martCover > 0.9))
  const excessPerH = hours > 0 ? all.reduce((s, u) => s + u, 0) / hours : null
  if (biased) reasons.push(`biased revisions: the exit moved ${(excessPerH - 1).toFixed(2)}h per hour against -1 predicted (t ${t.toFixed(1)} on n_eff ${nEff.toFixed(1)})`)
  if (corr) reasons.push(`autocorrelated revisions: lag-1 ${rho1.toFixed(2)} (|.| > ${(2 / Math.sqrt(n)).toFixed(2)})`)
  if (jumpy) reasons.push(`jumps at installs: ${jz.map((z) => z.toFixed(1)).join(', ')} level sd`)
  if (excess) reasons.push(`excess movement: X = ${X.toFixed(2)} — the revisions carry ${X.toFixed(1)}x the variance the level interval resolves (the level interval is too narrow for how the forecast moves)`)
  const structural = biased || corr || jumpy || excess
  const overstated = small && !excess
  if (small) reasons.push(fin(X) && X < 0.5 ? `small revisions: X = ${X.toFixed(2)} — the forecast moves less than its interval says it will` : `the level interval's one-step share covers ${(100 * martCover).toFixed(0)}% of the revisions (> 90%): its spread is overstated`)
  const verdict = !enough ? 'insufficient' : structural && overstated ? 'both' : structural ? 'structural' : overstated ? 'overstated' : 'calibrated'
  const label = { insufficient: `insufficient: ${n} revision(s) (need ${EXITCAL.minN})`, both: 'STRUCTURAL ERROR, with an OVERSTATED one-step spread', structural: 'STRUCTURAL ERROR', overstated: 'OVERSTATED UNCERTAINTY', calibrated: 'calibrated' }[verdict]
  return {
    n,
    hours: r3(hours),
    meanU: r3(mean),
    excessPerH: r3(excessPerH),
    realisedPerH: fin(excessPerH) ? r3(excessPerH - 1) : null,
    t: r3(t),
    rho1: r3(rho1),
    nEff: r3(nEff),
    X: r3(X),
    jumps,
    lives: lives.map(({ _M, _R, _us, ...l }) => l),
    verdict,
    structural,
    overstated,
    reasons,
    why: `${label}${reasons.length ? ': ' + reasons.join('; ') : ''} [${n} revisions over ${hours.toFixed(1)}h in ${lives.length} life run(s)]`,
  }
}

// ---------------------------------------------------------------------------
// 3. Online recalibration and 4. the e-processes — one persisted state.
// ---------------------------------------------------------------------------

const zeros = (k) => Array(k).fill(0)
function epNew(k) {
  return { logE: zeros(k), e: 1, max: 1, crossedAt: null, n: 0 }
}
/** A fresh calibration state (every field present; `v` the layout). */
export function calStateNew() {
  const L = EXITCAL.eproc
  return {
    v: EXITCAL.stateVersion,
    lastAt: null,
    recal: { logM: 0, n: 0, hits: 0 },
    eproc: { narrow: epNew(L.narrow.length), wide: epNew(L.wide.length), rawNarrow: epNew(L.narrow.length), rawWide: epNew(L.wide.length) },
    crps: { n: 0, raw: 0, recal: 0 },
    switches: [],
    commitLog: [],
  }
}
/** A state read back from plan.txt: a missing or other-layout state starts fresh (named by the caller). */
export function calStateOf(prev) {
  if (!prev || prev.v !== EXITCAL.stateVersion || !prev.recal || !prev.eproc) return calStateNew()
  return JSON.parse(JSON.stringify(prev))
}
/** The multiplier the plan APPLIES: ln m shrunk toward 0 by n / (n + n0). */
export function appliedMultOf(recal) {
  const n = recal?.n ?? 0
  const w = n / (n + EXITCAL.recal.n0)
  return Math.exp((recal?.logM ?? 0) * w)
}
function logMeanExp(xs) {
  const mx = Math.max(...xs)
  return mx + Math.log(xs.reduce((s, x) => s + Math.exp(x - mx), 0) / xs.length)
}
/** One step of a lambda-mixture test martingale with increment x (each factor 1 + lambda x must stay > 0). */
export function epStep(ep, x, lambdas, at = null) {
  for (let k = 0; k < lambdas.length; k++) ep.logE[k] += Math.log(Math.max(1e-12, 1 + lambdas[k] * x))
  ep.n++
  const le = logMeanExp(ep.logE)
  ep.e = Math.exp(Math.min(700, le))
  ep.max = Math.max(ep.max, ep.e)
  if (ep.e >= 1 / EXITCAL.alpha && !ep.crossedAt) ep.crossedAt = at ?? true
  return ep
}
/** The narrow test's increment from a standardized z: z^2 - 1 (capped). */
export const narrowInc = (z) => Math.min(EXITCAL.eproc.zCap2, z * z) - 1
/** The wide test's increment: inside the 80% interval (1) or not (0), less 0.8. */
export const wideInc = (z) => (Math.abs(z) < EXITCAL.z80 ? 1 : 0) - 0.8

/**
 * Feed the run pairs newer than state.lastAt, oldest first, through the
 * recalibration and the e-processes. For each, BEFORE it is seen: m (the
 * tracker) and m_applied (shrunk) are fixed — so the e-process tests a
 * predictable sequence of predictives and stays anytime-valid. Then:
 *   z_raw = u / sd, z_app = u / (m_applied sd)
 *   e-processes: narrow/wide on z_app (what the plan uses), raw* on z_raw
 *   CRPS: raw (m = 1) and recalibrated (m_applied), summed
 *   ACI: miss = |z_raw| > z80 m;  ln m += gamma0 / (1 + n)^decay (miss - 0.2), bounded.
 * Returns {state, processed, skipped (no interval)}.
 */
export function calStateUpdate(state0, revs) {
  const st = calStateOf(state0)
  const R = EXITCAL.recal
  const L = EXITCAL.eproc
  const last = st.lastAt ? Date.parse(st.lastAt) : -Infinity
  let processed = 0
  let skipped = 0
  for (const rev of revs) {
    if (!rev.inRun || !(Date.parse(rev.at) > last)) continue
    const sd = martingaleSdOf(rev)
    if (!fin(sd) || !(sd > 0)) {
      skipped++
      st.lastAt = rev.at
      continue
    }
    const m = Math.exp(st.recal.logM)
    const mApp = appliedMultOf(st.recal)
    const zRaw = rev.u / sd
    const zApp = rev.u / (mApp * sd)
    epStep(st.eproc.narrow, narrowInc(zApp), L.narrow, rev.at)
    epStep(st.eproc.wide, wideInc(zApp), L.wide, rev.at)
    epStep(st.eproc.rawNarrow, narrowInc(zRaw), L.narrow, rev.at)
    epStep(st.eproc.rawWide, wideInc(zRaw), L.wide, rev.at)
    st.crps.n++
    st.crps.raw += sd * crpsNormal(zRaw)
    st.crps.recal += mApp * sd * crpsNormal(zApp)
    const miss = Math.abs(zRaw) > EXITCAL.z80 * m ? 1 : 0
    const gamma = R.gamma0 / Math.pow(1 + st.recal.n, R.decay)
    st.recal.logM = Math.min(Math.log(R.hi), Math.max(Math.log(R.lo), st.recal.logM + gamma * (miss - R.target)))
    st.recal.n++
    st.recal.hits += 1 - miss
    st.lastAt = rev.at
    processed++
  }
  return { state: st, processed, skipped }
}

/** The recalibration as published: {m, applied, n, coverage, atBound, why}. */
export function recalSummaryOf(st) {
  const R = EXITCAL.recal
  const m = Math.exp(st.recal.logM)
  const applied = appliedMultOf(st.recal)
  const atBound = st.recal.n >= EXITCAL.minN && (m <= R.lo * 1.0001 || m >= R.hi * 0.9999)
  const coverage = st.recal.n ? st.recal.hits / st.recal.n : null
  return {
    m: r3(m),
    applied: r3(applied),
    n: st.recal.n,
    coverage: r3(coverage),
    atBound,
    bounds: [R.lo, R.hi],
    why: `width multiplier m = ${m.toFixed(2)} (applied x${applied.toFixed(2)}, shrunk by ${st.recal.n}/(${st.recal.n}+${R.n0})) from ${st.recal.n} revision(s), tracking ${fin(coverage) ? (100 * coverage).toFixed(0) : '?'}% inside its own interval (target 80%)${atBound ? ` — AT ITS BOUND [${R.lo}, ${R.hi}]: the miscalibration is beyond what one multiplier corrects` : ''}`,
  }
}
/** The e-processes as published. */
export function eprocSummaryOf(st) {
  const thr = 1 / EXITCAL.alpha
  const one = (ep, what) => ({ e: r3(ep.e), max: r3(ep.max), n: ep.n, crossedAt: ep.crossedAt, alarm: ep.e >= thr, why: `${what}: e = ${ep.e.toPrecision(3)} (max ${ep.max.toPrecision(3)}) over ${ep.n} revision(s), alarm at ${thr}` })
  return {
    alpha: EXITCAL.alpha,
    narrow: one(st.eproc.narrow, 'too narrow or biased (H0: E z^2 <= 1)'),
    wide: one(st.eproc.wide, 'too wide (H0: P(inside 80%) <= 0.8)'),
    rawNarrow: one(st.eproc.rawNarrow, 'unscaled model, too narrow or biased'),
    rawWide: one(st.eproc.rawWide, 'unscaled model, too wide'),
  }
}

// ---------------------------------------------------------------------------
// The information rate for the value of waiting.
// ---------------------------------------------------------------------------

/**
 * How fast the posterior narrows: per run pair with both level sds, the
 * per-hour log ratio ln(sd_b / sd_a) / dh; the median, over one re-decide
 * interval, is rho = sd(t + interval) / sd(t). Bounded; the stated default
 * below minN pairs. Returns {rho, n, source, why}.
 */
export function infoRateOf(revs, { intervalH = EXITCAL.rho.intervalH } = {}) {
  const C = EXITCAL.rho
  const k = revs.filter((x) => x.inRun && fin(x.sdA) && fin(x.sdB) && x.sdA > 0 && x.sdB > 0).map((x) => Math.log(x.sdB / x.sdA) / x.dh).sort((a, b) => a - b)
  if (k.length < C.minN) return { rho: C.def, n: k.length, source: 'stated', why: `${k.length} interval pair(s) (need ${C.minN}): rho ${C.def} per ${intervalH}h stated` }
  const med = k.length % 2 ? k[(k.length - 1) / 2] : (k[k.length / 2 - 1] + k[k.length / 2]) / 2
  const rho = Math.min(C.hi, Math.max(C.lo, Math.exp(med * intervalH)))
  return { rho: r3(rho), n: k.length, source: 'measured', why: `the exit's 80% interval narrows x${Math.exp(med).toFixed(3)} per hour (median of ${k.length} pairs): rho ${rho.toFixed(3)} per ${intervalH}h re-decide interval` }
}

// ---------------------------------------------------------------------------
// 6. Value equivalence: the differences that flip decisions.
// ---------------------------------------------------------------------------

/**
 * THE RANKING'S DIFFERENCES, scored like the exit: per consecutive same-life,
 * same-run pass pair, each option shared with the reference (the first),
 * x = Δln(H_k / H_ref) / 2 against the jitter predictive t_{2a}(0, sqrt(b /
 * a)) from the pairs BEFORE (bayes.jitterPosterior's model and prior).
 * `points` [{at, life, h: {key: hours}, ver, boot}]. Returns {n, cover80,
 * pit, rho1, why}.
 */
export function diffCalibrationOf(points, prior = PRIORS.jitter) {
  const P = (points ?? []).filter((p) => p && p.h && typeof p.h === 'object')
  const xs = []
  const rows = []
  for (let i = 1; i < P.length; i++) {
    if (P[i].life !== P[i - 1].life || runBreak(P[i - 1], P[i])) continue
    const A = P[i - 1].h
    const B = P[i].h
    const common = Object.keys(A).filter((k) => fin(A[k]) && A[k] > 0 && fin(B[k]) && B[k] > 0)
    if (common.length < 2) continue
    const ref = common[0]
    const p = igUpdate(prior, xs)
    const scale = Math.sqrt(p.b / p.a)
    const fresh = []
    for (const k of common.slice(1)) {
      const x = (Math.log(B[k] / B[ref]) - Math.log(A[k] / A[ref])) / 2
      const u = tCdf(x / scale, 2 * p.a)
      rows.push({ x, pit: u, hit: u > 0.1 && u < 0.9 })
      fresh.push(x)
    }
    xs.push(...fresh)
  }
  const n = rows.length
  if (!n) return { n: 0, cover80: null, pit: null, rho1: null, why: 'no option pair over consecutive passes (one option priced, or a held plan): the differences are not calibrated this life' }
  const cover = coverOf(rows)
  const pit = pitShapeOf(rows.map((r) => r.pit))
  const rho = rho1Of(rows.map((r) => r.x))
  return { n, cover80: r3(cover), pit, rho1: r3(rho), why: `${n} option difference(s) over consecutive passes: ${(100 * cover).toFixed(0)}% inside the jitter predictive's 80% interval; ${pit.why}` }
}

/**
 * COMMITTED SWITCHES, promised against realised. A decision the last pass
 * switched (held false, switched true) is logged with its expected gain
 * (gainH, net of the switch cost) and the plan's exit then; once the exit
 * samples reach an hour past it (same life), the drift of the exit over that
 * hour against the -1h/h a followed plan expects: `erosion` = E(t+1h) -
 * (E(t) - 1h). A switch whose gain was real does not erode by its gain.
 */
export function switchLedgerOf(ledger, prevPlan, samples) {
  const L = Array.isArray(ledger) ? ledger.map((x) => ({ ...x })) : []
  const have = new Set(L.map((x) => x.id))
  for (const [name, d] of Object.entries(prevPlan?.decisions ?? {})) {
    if (!d || d.held !== false || d.switched !== true || !d.decidedAt) continue
    const id = `${name}|${d.decidedAt}`
    if (have.has(id)) continue
    L.push({ id, name, at: d.decidedAt, life: prevPlan.lastAugReset ?? null, to: d.key ?? null, from: d.from ?? null, gainH: r3(d.gainH), pWin: r3(d.pWin), rule: d.commit?.rule ?? 'p-better', exitH: r3(prevPlan.exit?.meanH) })
  }
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && fin(Date.parse(x?.at)))
  for (const e of L) {
    if (e.erosionH !== undefined) continue
    const t0 = Date.parse(e.at)
    const s0 = S.find((x) => x.life === e.life && Date.parse(x.at) >= t0 - 60e3)
    if (!s0) continue
    const s1 = S.find((x) => x.life === e.life && Date.parse(x.at) >= Date.parse(s0.at) + 3.6e6)
    if (!s1) {
      if (S.some((x) => Date.parse(x.at) > Date.parse(s0.at) + 3.6e6 && x.life !== e.life)) e.erosionH = null
      continue
    }
    const dh = (Date.parse(s1.at) - Date.parse(s0.at)) / 3.6e6
    e.exitAtH = s0.exitH
    e.exitAfterH = s1.exitH
    e.afterH = r3(dh)
    e.erosionH = r3(s1.exitH - (s0.exitH - dh))
  }
  return L.slice(-EXITCAL.ledgerMax)
}
export function switchSummaryOf(L) {
  const done = L.filter((e) => fin(e.erosionH) && fin(e.gainH))
  if (!done.length) return { n: L.length, resolved: 0, why: `${L.length} committed switch(es) logged, none an hour old yet in its life: the promised gains are not yet scored` }
  const g = meanOf(done.map((e) => e.gainH))
  const er = meanOf(done.map((e) => e.erosionH))
  return { n: L.length, resolved: done.length, meanGainH: r3(g), meanErosionH: r3(er), why: `${done.length} committed switch(es) scored: promised ${g.toFixed(2)}h on average; the exit then drifted ${er >= 0 ? '+' : ''}${er.toFixed(2)}h against a followed plan's -1h/h over the next hour${er > g ? ' — MORE than the gain promised: the switches did not pay as priced' : ''}` }
}

/** The commitment rule's shadow log: the last pass's fresh decisions with both rules' verdicts (plan.decide `commit`). */
export function commitLogOf(log, prevPlan) {
  const out = Array.isArray(log) ? [...log] : []
  const have = new Set(out.map((x) => x.id))
  for (const [name, d] of Object.entries(prevPlan?.decisions ?? {})) {
    const c = d?.commit
    if (!c || d.held !== false || !d.decidedAt) continue
    const id = `${name}|${d.decidedAt}`
    if (have.has(id)) continue
    out.push({ id, name, at: d.decidedAt, rule: c.rule, switch: c.switch, oldSwitch: c.old?.switch ?? null, newSwitch: c.new?.switch ?? null, agree: c.agree, to: c.new?.key ?? c.old?.key ?? null, gainH: c.new?.gainH ?? null, pWin: c.old?.pWin ?? null, vowH: c.new?.vowH ?? null })
  }
  return out.slice(-EXITCAL.commitLogMax)
}

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

/**
 * EVERYTHING ABOVE, for one pass. `samples` the node's exit samples
 * (installgate exitCalibration.samples), `state` the last pass's
 * calibration.state (any node — the model's width error is the model's),
 * `points` the plan's ranking points (this life), `prevPlan` the last
 * plan record (switch and commit logs). The top-level n / cover80 / pitMean
 * / pitVar / ks / excluded are the legacy one-step predictive's (as
 * bayes.driftCalibration, unchanged for its readers).
 */
export function exitCalibrationReport(samples, { state = null, points = null, prevPlan = null, legacy: legacyCal = null, prior = PRIORS.drift, nu = PRIORS.driftNu } = {}) {
  const revs = revisionsOf(samples)
  const legacy = legacyPredictiveOf(revs, prior, nu)
  const mart = martingalePredictiveOf(revs, 1)
  const fresh = !state || state.v !== EXITCAL.stateVersion
  const up = calStateUpdate(state, revs)
  const st = up.state
  st.switches = switchLedgerOf(st.switches, prevPlan, samples)
  st.commitLog = commitLogOf(st.commitLog, prevPlan)
  const recal = recalSummaryOf(st)
  const recalPred = martingalePredictiveOf(revs, recal.applied)
  const legacyCover = coverOf(legacy)
  const post = robustIG(prior, legacy.map((p) => p.x), nu)
  const horizons = horizonsOf(samples, Math.sqrt(post.b / post.a), Math.min(nu, 2 * post.a), 1)
  const suspects = suspectsOf(revs, legacy, prior, nu)
  const martingale = martingaleTestOf(revs, coverOf(mart))
  const crpsWindow = { n: mart.length, legacyH: r3(meanOf(legacy.map((p) => p.crps).filter(fin))), martingaleH: r3(meanOf(mart.map((p) => p.crps))), recalH: r3(meanOf(recalPred.map((p) => p.crps))) }
  const crpsRun = { n: st.crps.n, rawH: st.crps.n ? r3(st.crps.raw / st.crps.n) : null, recalH: st.crps.n ? r3(st.crps.recal / st.crps.n) : null }
  crpsRun.worse = crpsRun.n >= EXITCAL.minN && fin(crpsRun.rawH) && fin(crpsRun.recalH) && crpsRun.recalH > 1.1 * crpsRun.rawH
  const eprocess = eprocSummaryOf(st)
  const rho = infoRateOf(revs)
  const diff = diffCalibrationOf(points)
  const switches = switchSummaryOf(st.switches)
  const lc = legacyCal ?? null
  const pitL = pitShapeOf(legacy.map((p) => p.pit))
  const pitM = pitShapeOf(mart.map((p) => p.pit))
  const why = `${martingale.why}. One-step (iid model): ${legacy.length ? `${(100 * legacyCover).toFixed(0)}% of ${legacy.length} inside the 80% interval` : 'no pair'}; martingale predictive: ${mart.length ? `${(100 * coverOf(mart)).toFixed(0)}% of ${mart.length}` : 'no pair with an interval'}, x${recal.applied} applied -> ${recalPred.length ? `${(100 * coverOf(recalPred)).toFixed(0)}%` : '?'}`
  return {
    ...(lc ? { n: lc.n, cover80: lc.cover80, pitMean: lc.pitMean, pitVar: lc.pitVar, ks: lc.ks, excluded: lc.excluded, legacyWhy: lc.why } : { n: legacy.length, cover80: r3(legacyCover) }),
    why,
    verdict: martingale.verdict,
    pit: { legacy: pitL, martingale: pitM },
    horizons,
    crps: { window: crpsWindow, since: crpsRun },
    suspects,
    martingale,
    martingaleCover80: r3(coverOf(mart)),
    recalCover80: r3(coverOf(recalPred)),
    recal,
    eprocess,
    rho,
    values: { diff, switches },
    processed: up.processed,
    stateFresh: fresh,
    state: st,
  }
}

/**
 * THE EXIT INTERVAL, recalibrated: the published q10/q90 moved away from (or
 * toward) the median by the applied multiplier; the raw interval kept beside
 * it. `ex` {q10, q50, q90}. A multiplier of 1 (or none) returns the raw.
 */
export function recalIntervalOf(ex, m) {
  if (!ex || !fin(ex.q50) || !fin(ex.q10) || !fin(ex.q90)) return ex
  const k = fin(m) && m > 0 ? m : 1
  return { ...ex, q10: r3(Math.max(0, ex.q50 - k * (ex.q50 - ex.q10))), q90: r3(ex.q50 + k * (ex.q90 - ex.q50)), rawQ10: ex.q10, rawQ90: ex.q90, widthMult: r3(k) }
}
