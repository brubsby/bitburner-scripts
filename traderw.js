// THE TRADER'S RETURN AS A FUNCTION OF ITS BOOK — r(W). Pure, imports nothing.
//
// The exit's money legs compound the trader's book, dW/dt = r(W) W + income.
// r was one number (the pooled posterior, 0.38-0.53/h live BN9 2026-09-29)
// paid on min(W, capitalCap) — the same rate on a $1m book and a $10t one.
// It is not one number, and the game source says why (v3, ~/Repos/bitburner):
//
//   - COMMISSION: $100k per order (StockMarket/data/Constants.ts). stockstrat
//     opens a position only when its expected edge covers commissionCover (2)
//     round trips, so below ~$2.2m the trader never trades: r = 0. Just above,
//     it trades rarely and small (~0.5/h), rising to the plateau by ~$1e8.
//   - maxShares = 20% of outstanding (Stock.ts:152) and FORECAST DAMAGE: every
//     shareTxForMovement shares traded cut otlkMag by 0.006
//     (StockMarketHelpers.ts processTransactionForecastMovement). The best
//     edges fill, the book spills into worse ones and erodes the edge it
//     trades on. There is NO price impact in v3. So E(W) = r(W) W saturates:
//     ~$2e11/h absorbable pre-4S, whatever the book.
//
// THE CURVE, measured on the game's own market with the SHIPPED strategy
// (tools/sim/stocks/rw.mjs: fresh market, 12 seeds x 5h per starting book on
// a half-decade grid $1m-$100t, the first hour — the warm-up — dropped; each
// 0.1h interval one observation at the book it started from, exactly as the
// ledger fit sees /tel/stock-hist.txt), fitted by tools/sim/stocks/rwfit.mjs:
//
//   r(W) = r0 x s(W),  s(W) = gate(W) x ramp(W) x sat(W / W*)
//     gate   1 for W >= Wmin, else 0 (the commission threshold)
//     ramp   hLo + (1 - hLo) / (1 + (Wr / W)^k)   (small books: few, small trades)
//     sat    (1 + (W / W*)^n)^(-1/n)                (the market's capacity)
//
// r0 (the plateau) and W* (the knee: r0 W* is the saturated $/s) are what the
// ledger updates (bayes.traderRwPosterior); the rest is structure, fixed here.
// Paid on Weff = min(W, capitalCap) (stock.js: sum of maxShares x price): past
// it a dollar earns nothing.
//
// Exit inputs carry it as capitalReturnPerSec (r0 per second), capitalScaleW
// (W*) and capitalShape ({Wmin, hLo, Wr, k, n}). With neither of the last two
// every function here is exactly the old flat r x min(W, cap).

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

/**
 * THE PRIOR, per trader regime (stock.txt mode: pre-4S / 4S; long-only — no
 * shorts outside BitNode 8 / SF8.2). From tools/sim/stocks/rw-data/*.json by
 * tools/sim/stocks/rwfit.mjs (2026-09-29, v3.0.2 source, stockstrat DEFAULTS).
 * r0PerHour / Wstar: the sim's fit; sdLnR0 / sdLnWstar: the STATED structural
 * error of the sim against the live game (the market's state and our tick
 * cadence are not the sim's; x1.5 / x2.2 either way at one sd). tauRel: one
 * life's level around the node's (relative), from the sim's between-seed
 * spread net of interval noise. sigma: an interval's noise per sqrt(hour) at
 * book W, sigma0 x (1 + (W / sWstar)^n)^(-1/n) (the sim's; the ledger scales
 * it, bayes kappa).
 * skipH: the life's first hour is not the curve's — the sim drops it (the
 * warm-up), and a fresh market's first cycle is KNOWN to the trader
 * (stockstrat SYMBOL_META init, stock.txt warmup prior 'init-forecast'), so
 * young books earn above the curve there (BN9 2026-09-29 16:18-16:30Z: 1.7/h
 * at $3e8 in the first 0.2h against 0.8/h). The ledger fit drops it too, so
 * the curve is the same steady state on both sides; the first hour is priced
 * as the warm-up (capitalWarmupH), a floor.
 */
export const RW_PRIOR = {
  'pre-long': {
    r0PerHour: 0.798,
    Wstar: 2.68e11,
    shape: { Wmin: 2.24e6, hLo: 0.584, Wr: 1.7e7, k: 2.79, n: 1.91 },
    sdLnR0: 0.4,
    sdLnWstar: 0.8,
    tauRel: 0.22,
    sigma: { sigma0: 0.208, sWstar: 5.21e11, n: 1.72 },
    skipH: 1,
    source: 'tools/sim/stocks/rw.mjs 12 seeds x 5h (skip 1h) + low-book 12 x 2h, fitted by rwfit.mjs',
  },
  '4S-long': {
    r0PerHour: 1.135,
    Wstar: 1.0e12,
    shape: { Wmin: 2.51e6, hLo: 0.877, Wr: 1.19e7, k: 4.86, n: 1.13 },
    sdLnR0: 0.4,
    sdLnWstar: 0.8,
    tauRel: 0.2,
    sigma: { sigma0: 0.267, sWstar: 8.02e11, n: 0.93 },
    skipH: 1,
    source: 'tools/sim/stocks/rw.mjs 12 seeds x 5h (skip 1h) + low-book 12 x 2h, fitted by rwfit.mjs',
  },
}

/** The regime stock.txt's mode names: '4S-long' when it reads 4S forecasts, else 'pre-long'. */
export function rwRegimeOf(mode) {
  return /4S/.test(String(mode ?? '')) && !/pre/i.test(String(mode ?? '')) ? '4S-long' : 'pre-long'
}

/** s(W) in [0, 1]: the curve's shape at book W for knee Wstar. No shape: 1. */
export function rwShape(W, Wstar, sh) {
  if (!(W > 0)) return 0
  if (!sh) return Wstar > 0 ? 1 / (1 + W / Wstar) : 1
  if (W < sh.Wmin) return 0
  // Each factor is 1 to < 1e-9 far from its knee (W > 1e4 Wr; W < 1e-5 W*):
  // skipped there — this runs in every step of every exit money leg.
  const ramp = sh.Wr > 0 && W < 1e4 * sh.Wr ? sh.hLo + (1 - sh.hLo) / (1 + Math.pow(sh.Wr / W, sh.k)) : 1
  const sat = Wstar > 0 && W > 1e-5 * Wstar ? Math.pow(1 + Math.pow(W / Wstar, sh.n), -1 / sh.n) : 1
  return ramp * sat
}

/**
 * s(W) AS A TABLE, per (W*, shape): s on a 0.02-decade grid in W from
 * Wmin to 1e17, interpolated linearly in ln W (relative error < 3e-4). The exit prices hundreds of legs per draw and every step read s
 * three times (three pow each) — 2.5x the flat rate's CPU on the plan's
 * pass (tools/test/planperf.test.mjs PP3c). Cached per shape OBJECT and W*
 * (a pass's draws carry ~24 knees on one shape): the shape must not be
 * mutated once passed in.
 */
const TAB_DL = 0.02 * Math.LN10
const TAB_TOP = Math.log(1e17)
const tabCache = new WeakMap() // shape object -> Map(W* -> table)
export function shapeTable(Wstar, sh) {
  if (!sh || typeof sh !== 'object') return null
  let byW = tabCache.get(sh)
  if (!byW) tabCache.set(sh, (byW = new Map()))
  let t = byW.get(Wstar)
  if (t) return t
  const l0 = Math.log(Math.max(sh.Wmin || 1, 1))
  const n = Math.ceil((TAB_TOP - l0) / TAB_DL) + 1
  const vals = new Float64Array(n)
  for (let i = 0; i < n; i++) vals[i] = rwShape(Math.exp(l0 + i * TAB_DL) * (i === 0 ? 1.0000001 : 1), Wstar, sh)
  t = { l0, n, vals, Wmin: sh.Wmin || 0, top: l0 + (n - 1) * TAB_DL }
  if (byW.size >= 256) byW.clear()
  byW.set(Wstar, t)
  return t
}
function tabShape(t, W) {
  if (W < t.Wmin) return 0
  const x = (Math.log(W) - t.l0) / TAB_DL
  if (x <= 0) return t.vals[0]
  const i = x | 0
  if (i >= t.n - 1) return t.vals[t.n - 1] * Math.exp(t.top - Math.log(W)) // past the table: saturated, s ~ 1/W
  return t.vals[i] + (x - i) * (t.vals[i + 1] - t.vals[i])
}

/** True when the inputs carry a book-dependent curve (else the old flat rate). */
export function isShaped(o) {
  return pos(o?.capitalScaleW) || !!o?.capitalShape
}

/** {r0, cap, Wstar, sh} from exit inputs (per second). */
export function capitalOf(o) {
  const c = {
    r0: pos(o?.capitalReturnPerSec) ? o.capitalReturnPerSec : 0,
    cap: pos(o?.capitalCap) ? o.capitalCap : Infinity,
    Wstar: pos(o?.capitalScaleW) ? o.capitalScaleW : null,
    sh: o?.capitalShape ?? null,
    Ecap: Infinity,
    tab: null,
  }
  if (c.sh && c.r0 > 0) c.tab = shapeTable(c.Wstar, c.sh)
  // The earnings at the cap, once (every step of a leg reads it).
  if (isFinite(c.cap) && c.r0 > 0) c.Ecap = c.r0 * (c.Wstar || c.sh ? shapeOf(c, c.cap) : 1) * c.cap
  return c
}

/** The trader's log return per second at book W: r0 s(min(W, cap)). */
export function capitalRateAt(W, o) {
  const c = o && 'r0' in o ? o : capitalOf(o)
  if (!(c.r0 > 0) || !(W > 0)) return 0
  const We = Math.min(W, c.cap)
  if (!c.Wstar && !c.sh) return W <= c.cap ? c.r0 : (c.r0 * c.cap) / W
  return (c.r0 * shapeOf(c, We) * We) / W
}
/**
 * capitalRateAt for capitalOf's object with a table (the hot path: no
 * checks; W > 0). Also leaves the rate's elasticity d ln r / d ln W at W in
 * c.elast — the table's own slope — so a step's midpoint rate is
 * r (1 + elast r dt / 2) without a second read (second order, as the
 * midpoint read).
 */
export function rateTab(c, W) {
  c.elastW = W
  if (W >= c.cap) {
    c.elast = -1
    return c.Ecap / W
  }
  const t = c.tab
  if (W < t.Wmin) {
    c.elast = 0
    return 0
  }
  const x = (Math.log(W) - t.l0) / TAB_DL
  if (x <= 0) {
    c.elast = 0
    return c.r0 * t.vals[0]
  }
  const i = x | 0
  if (i >= t.n - 1) {
    c.elast = -1
    return c.r0 * t.vals[t.n - 1] * Math.exp(t.top - Math.log(W))
  }
  const d = t.vals[i + 1] - t.vals[i]
  const sv = t.vals[i] + (x - i) * d
  c.elast = sv > 0 ? d / TAB_DL / sv : 0
  return c.r0 * sv
}
/** s(W) for capitalOf's object: the table when it has one. */
function shapeOf(c, W) {
  return c.tab ? tabShape(c.tab, W) : rwShape(W, c.Wstar, c.sh)
}

/** The trader's earnings in $/s at book W: r0 s(Weff) Weff. */
export function capitalEarnAt(W, o) {
  const c = o && 'r0' in o ? o : capitalOf(o)
  if (!(c.r0 > 0) || !(W > 0)) return 0
  const We = Math.min(W, c.cap)
  return c.r0 * (c.Wstar || c.sh ? shapeOf(c, We) : 1) * We
}

/**
 * The capital's gain over dtSec from book W, the capital term alone. Flat
 * (no curve): the old closed form — exponential below the cap, linear at it.
 * Shaped: the rate at the step's midpoint (predicted), exponential over the
 * step — second order; the callers keep steps to a few percent of growth.
 */
export function capitalGain(W, dtSec, o, rAtW = null) {
  const c = o && 'r0' in o ? o : capitalOf(o)
  const r = c.r0
  if (!(r > 0) || !(dtSec > 0) || !(W > 0)) return 0
  const cap = c.cap
  if (!c.Wstar && !c.sh) return W < cap ? Math.min(W * Math.expm1(r * dtSec), cap - W + r * cap * dtSec) : r * cap * dtSec
  const Ecap = 'Ecap' in c ? c.Ecap : isFinite(cap) ? capitalEarnAt(cap, c) : Infinity
  if (W >= cap) return Ecap * dtSec
  // rAtW: the caller's capitalRateAt(W) when it already has it.
  const r1 = rAtW ?? capitalRateAt(W, c)
  if (!(r1 > 0)) return 0
  // The midpoint's rate: from the elasticity the caller's rateTab(W) left
  // (rAtW given with a table), else a second read.
  const r2 = midRate(c, W, r1, dtSec, rAtW !== null)
  const g = W * Math.expm1(r2 * dtSec)
  return isFinite(cap) ? Math.min(g, cap - W + Ecap * dtSec) : g
}

/** A step's midpoint rate: the elasticity rateTab(W) left when it was the read at W, else a second read. */
function midRate(c, W, r1, dtSec, given) {
  const Wm = W * (1 + (r1 * dtSec) / 2)
  if (c.tab && given && c.elastW === W && Wm < c.cap) return r1 * Math.max(0, 1 + (c.elast * r1 * dtSec) / 2)
  return c.tab ? rateTab(c, Wm < c.cap ? Wm : c.cap) : capitalRateAt(Math.min(c.cap, Wm), c)
}

/**
 * One step's capital gain as a function of the time into it, s -> gain, on
 * the step's own midpoint rate (the rate capitalGain(W, dtSec) uses): so a
 * landing bisected inside the step reads the same curve as the step, at one
 * table read for the whole bisection instead of two per probe.
 */
export function capitalStepFn(W, dtSec, c, rAtW = null) {
  const cap = c.cap
  const Ecap = c.Ecap
  if (!(c.r0 > 0) || !(W > 0)) return () => 0
  if (W >= cap) return (s) => Ecap * s
  const r1 = rAtW ?? capitalRateAt(W, c)
  if (!(r1 > 0)) return () => 0
  const r2 = midRate(c, W, r1, dtSec, rAtW !== null)
  return isFinite(cap) ? (s) => Math.min(W * Math.expm1(r2 * s), cap - W + Ecap * s) : (s) => W * Math.expm1(r2 * s)
}

/**
 * The book after tSec from W0 under the capital alone. Flat: closed form.
 * Shaped: steps of <= `growth` (5%) at the midpoint rate; a book below the
 * commission threshold stays where it is.
 */
export function capitalAfter(W0, tSec, o, { growth = 0.05, maxSteps = 800 } = {}) {
  const c = o && 'r0' in o ? o : capitalOf(o)
  if (!(W0 > 0) || !(tSec > 0) || !(c.r0 > 0)) return Math.max(0, W0 || 0)
  if (!c.Wstar && !c.sh) {
    const r = c.r0
    if (W0 >= c.cap) return W0 + r * c.cap * tSec
    const tCap = Math.log(c.cap / W0) / r
    return tSec <= tCap ? W0 * Math.exp(r * tSec) : c.cap + r * c.cap * (tSec - tCap)
  }
  let W = W0
  let t = 0
  for (let i = 0; i < maxSteps && t < tSec; i++) {
    const r = capitalRateAt(W, c)
    if (!(r > 0)) return W
    const dt = Math.min(tSec - t, growth / r)
    W += capitalGain(W, dt, c)
    t += dt
  }
  if (t < tSec) W += capitalEarnAt(W, c) * (tSec - t)
  return W
}

/**
 * What $1 now, and $1/s from now, are worth after T seconds with the book
 * compounding from `money` after `warmSec` (hacknetplan.capitalFV's shaped
 * branch). A marginal dollar compounds at E'(W) = d(r(W) W)/dW, not at
 * r(W): on a saturating curve the extra dollar earns less than the average
 * one. Integrated along the book's own path (capital only), steps of <= 5%
 * growth and <= T/40. Returns {lump, stream}.
 */
export function capitalMarginalFV(money, T, warmSec, o) {
  const c = o && 'r0' in o ? o : capitalOf(o)
  const warm = Math.min(T, Math.max(0, warmSec || 0))
  if (!(c.r0 > 0) || !(T > 0)) return { lump: 1, stream: Math.max(0, T) }
  const dE = (W) => {
    const w = Math.max(W, 1)
    const h = w * 1e-3
    return (capitalEarnAt(w + h, c) - capitalEarnAt(w, c)) / h
  }
  let W = Math.max(0, money || 0)
  const span = T - warm
  const steps = []
  let t = 0
  for (let i = 0; i < 400 && t < span; i++) {
    const r = Math.max(capitalRateAt(W, c), 1e-12)
    const dt = Math.min(span - t, span / 40, 0.05 / r)
    steps.push([dE(W * Math.exp((r * dt) / 2)), dt])
    W += capitalGain(W, dt, c)
    t += dt
  }
  if (t < span) steps.push([dE(W), span - t])
  // Backward: acc = the growth factor from a step's end to T.
  let acc = 1
  let stream = 0
  for (let i = steps.length - 1; i >= 0; i--) {
    const [g, dt] = steps[i]
    // $1/s arriving over this step, compounding at g to the step's end, then acc.
    stream += acc * (Math.abs(g) > 1e-15 ? Math.expm1(g * dt) / g : dt)
    acc *= Math.exp(g * dt)
  }
  return { lump: acc, stream: warm * acc + stream }
}

/** The curve's points for publication: r per hour at each book. */
export function rwTable(r0PerSec, Wstar, sh, books = [1e6, 3e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14]) {
  return books.map((W) => ({ W, perHour: +(r0PerSec * 3600 * rwShape(W, Wstar, sh)).toFixed(4) }))
}
