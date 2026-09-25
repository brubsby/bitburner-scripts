// The stock market as an INVESTMENT DECISION. Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO
//
// Nothing in the economic model mentioned stocks (docs/pricing-gaps.md §6):
// the WSE account and TIX API are purchasable, stock.js is a trader that
// already exists, and the decision to buy in has never been priced. This
// module prices the ENTRY — the four purchases and what a dollar of capital
// is expected to return per hour once the market can be read — so the loop
// can say yes or no for a reason.
//
// It does not model the market's dynamics beyond one tick, does not pick
// stocks, and does not forecast the forecast. The return of a position is a
// function of two per-stock quantities that are only READABLE after the 4S
// data purchase (forecast, volatility), so before that purchase the expected
// return is unknown, and this module says so: `edge: null` refuses, it does
// not assume. That is the same fail-closed rule as every other module here —
// a run that has not bought 4S cannot know its return, and a number invented
// to break that deadlock would be the `?? 0` bug with a prospectus.
//
// ---------------------------------------------------------------------------
// THE ONE-TICK MODEL, from StockMarket/StockMarket.ts:processStockPrices
//
//   every 6s (msPerStockUpdate) each stock moves by a factor (1 + av), up
//   with probability chc and down (divided) otherwise, where
//     av  = v x mv / 100, v ~ U(0,1)          -> E[av] = mv / 200
//     chc = (50 +/- otlkMag) / 100              = the 4S "forecast"
//   so the expected log return per tick is (2 x forecast - 1) x mv / 200 and
//   per hour, at 600 ticks,
//     r_h = 3 x (2 x forecast - 1) x mv / 100
//   for a LONG position; a short position earns the mirror. `mv` is the
//   stock's volatility in percent (InitStockMetadata.ts, 1-3), `forecast` the
//   4S probability (0..1). The forecast itself drifts every tick
//   (cycleForecast) and flips at cycle boundaries, so this is a per-tick
//   expectation the caller must keep re-reading, not a rate to extrapolate
//   for hours — which is why `edge` is an input here, measured by whatever
//   trades, and not derived from a fixed list.
//
// ---------------------------------------------------------------------------
// THE DECISION
//
//   buy the entry  iff  capital x edgePerHour x remainingH  >  entryCost
//
// capital is what budget.js leaves spendable, remainingH the measured life
// left (positions and cash both die at the install), entryCost the sum of
// the purchases not yet owned. Every input measured; any missing one refuses.

const num = (x) => typeof x === 'number' && isFinite(x)

/** StockMarket/data/Constants.ts. ns.stock.getConstants() (0GB) returns the same object live. */
export const STOCK = {
  msPerStockUpdate: 6e3,
  TicksPerCycle: 75,
  WseAccountCost: 200e6,
  TixApiCost: 5e9,
  MarketData4SCost: 1e9,
  MarketDataTixApi4SCost: 25e9,
  StockMarketCommission: 100e3,
}

export const TICKS_PER_HOUR = 3600e3 / STOCK.msPerStockUpdate

/**
 * Expected hourly return of a LONG position in one stock at the current
 * forecast and volatility — StockMarket.ts:processStockPrices, one tick,
 * times the ticks in an hour. `mv` in percent as the game stores it.
 * Negative when the forecast is bearish (a short would earn the mirror).
 */
export function hourlyReturn(forecast, mv) {
  if (!num(forecast) || forecast < 0 || forecast > 1 || !num(mv) || mv < 0) return null
  return (TICKS_PER_HOUR * (2 * forecast - 1) * mv) / 200
}

/**
 * The best available edge per hour across readable stocks — long or short —
 * as a fraction of capital. `stocks`: `[{ symbol, forecast, mv }]`, from 4S.
 * `canShort` gates the mirror. null when nothing is readable.
 */
export function bestEdge(stocks, canShort = false) {
  if (!Array.isArray(stocks) || !stocks.length) return null
  let best = null
  for (const s of stocks) {
    const r = hourlyReturn(s?.forecast, s?.mv)
    if (r === null) continue
    const edge = canShort ? Math.abs(r) : Math.max(0, r)
    if (best === null || edge > best.edge) best = { symbol: s.symbol ?? null, edge, side: r >= 0 ? 'long' : 'short' }
  }
  return best
}

/**
 * What the entry costs from here: `{ total, items }` for the purchases not
 * yet owned. `owned`: `{ wse, tix, data4s, api4s }` booleans (ns.stock.has*);
 * `node`: `{ FourSigmaMarketDataCost, FourSigmaMarketDataApiCost }`;
 * `consts`: the live ns.stock.getConstants() or STOCK.
 */
export function entryCost(owned, node, consts = STOCK) {
  for (const k of ['wse', 'tix', 'data4s', 'api4s']) if (typeof owned?.[k] !== 'boolean') return null
  if (!num(node?.FourSigmaMarketDataCost) || !num(node?.FourSigmaMarketDataApiCost)) return null
  const items = []
  if (!owned.wse) items.push({ item: 'WSE account', cost: consts.WseAccountCost })
  if (!owned.tix) items.push({ item: 'TIX API', cost: consts.TixApiCost })
  if (!owned.data4s) items.push({ item: '4S market data', cost: consts.MarketData4SCost * node.FourSigmaMarketDataCost })
  if (!owned.api4s) items.push({ item: '4S data TIX API', cost: consts.MarketDataTixApi4SCost * node.FourSigmaMarketDataApiCost })
  for (const i of items) if (!num(i.cost) || i.cost < 0) return null
  return { total: items.reduce((a, b) => a + b.cost, 0), items }
}

/**
 * Buy the entry or not. `o`: `{ entry (from entryCost), capital, edgePerHour,
 * remainingH }`. Refuses — with the reason — on any unmeasured input; the
 * edge in particular is null until 4S data can be read, which is the honest
 * state of a run that has not bought it.
 */
export function verdict(o = {}) {
  // THE EXIT, when progress.js could price it (o.exitCmp from
  // exitplan.spendExitFromRecord: the node's exit paying the entry now for
  // capital x edge per hour, against not): buy iff it is sooner. The
  // capital x edge x remaining-hours rule below is the named fallback.
  if (o.exitCmp && typeof o.exitCmp.deltaH === 'number' && isFinite(o.exitCmp.deltaH)) {
    const buy = o.exitCmp.deltaH < 0
    return { buy, decidedBy: 'exit-sim', why: `exit ${o.exitCmp.withH?.toFixed?.(2)}h buying the entry vs ${o.exitCmp.withoutH?.toFixed?.(2)}h not` }
  }
  const e = o.entry
  if (!e || !num(e.total)) return { buy: false, why: 'entry cost unreadable' }
  if (e.total === 0) return { buy: false, why: 'everything is already owned; nothing to buy' }
  // The edge is checked FIRST: it is the input a run without 4S cannot have,
  // and the refusal that names it is the one the reader needs to see.
  if (!num(o.edgePerHour)) return { buy: false, why: 'expected return unknown — no 4S forecast has been read', unpriced: true }
  if (!num(o.capital) || o.capital <= 0) return { buy: false, why: 'no spendable capital' }
  if (!num(o.remainingH) || o.remainingH <= 0) return { buy: false, why: 'remaining life unmeasured' }
  const expected = o.capital * o.edgePerHour * o.remainingH
  if (!(expected > e.total)) {
    return { buy: false, why: `$${fmt(o.capital)} at ${(o.edgePerHour * 100).toFixed(2)}%/h for ${o.remainingH.toFixed(2)}h returns $${fmt(expected)}, below the $${fmt(e.total)} entry`, expected }
  }
  return { buy: true, why: `$${fmt(expected)} expected over ${o.remainingH.toFixed(2)}h against a $${fmt(e.total)} entry`, expected }
}

const fmt = (x) => (x >= 1e12 ? `${(x / 1e12).toFixed(2)}t` : x >= 1e9 ? `${(x / 1e9).toFixed(2)}b` : x >= 1e6 ? `${(x / 1e6).toFixed(2)}m` : x.toFixed(0))

// ---------------------------------------------------------------------------
// THE 4S TIX API AS A TRAJECTORY DECISION
//
// Two wealth trajectories from the same wealth W over the same horizon H:
//   without: W grows at the pre-4S rate g_pre(W) for H hours;
//   with:    W - cost grows at the 4S rate g_4S(W) for H hours.
// Buy iff with(H) > without(H). The rates are NOT a formula: they are the
// median log-growth per hour of the shipped strategy (stockstrat.js) on the
// game's own market code, by starting capital — tools/sim/stocks/compare.mjs
// --hours 2 --seeds 10 (burn-in 3000 ticks), 2026-09-25, v3.0.2 source. The
// capital dependence is real and large: maxShares (20% of a company's
// shares) and our own forecast damage cap what one stock can absorb, so the
// rate falls from ~140%/h at $100m to ~15%/h at $10t.
//
// NOT CALIBRATED against a live game: nothing in .telemetry has recorded a
// stock trade yet. stock.js publishes wealth every tick to /tel/stock.txt;
// tools/sim/stocks/calibrate.mjs compares that realised growth with this
// table once there is a history to compare.
//
// Horizon: the life's remaining hours (hacknetplan.remainingLife). The 4S
// API survives installs inside a node (only prestigeSourceFile clears it,
// PlayerObjectGeneralMethods.ts:165), so the within-life comparison
// UNDER-values it — a purchase that wins here wins across the node too; one
// that loses here might still win across the node, which is not simulated
// and is published as such (`notSimulated`).

export const RATE_TABLE = {
  source: 'tools/sim/stocks/compare.mjs --hours 2 --seeds 10 --burn 3000, median ln-growth/h',
  caps: [1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 3e12, 1e13],
  'pre-long': [0.604, 0.808, 0.797, 0.715, 0.552, 0.234, 0.114, 0.036],
  'pre-ls': [0.798, 0.876, 0.766, 0.734, 0.585, 0.216, 0.101, 0.033],
  '4S-long': [1.369, 1.422, 1.348, 1.262, 0.904, 0.513, 0.318, 0.122],
  '4S-ls': [1.433, 1.444, 1.322, 1.218, 0.871, 0.549, 0.363, 0.168],
}

/**
 * Log-growth per hour at wealth W for a regime ('pre-long' | 'pre-ls' |
 * '4S-long' | '4S-ls'): log-linear interpolation in capital. Above the table
 * the market is saturated (maxShares everywhere), so dollars per hour stay
 * at the last row's and the rate falls as 1/W; below it the first row holds
 * (the table starts where commissions stop mattering).
 */
export function growthRate(regime, W) {
  const t = RATE_TABLE
  const r = t[regime]
  if (!r || !num(W) || W <= 0) return null
  const c = t.caps
  if (W <= c[0]) return r[0]
  if (W >= c[c.length - 1]) return (r[r.length - 1] * c[c.length - 1]) / W
  let i = 0
  while (W > c[i + 1]) i++
  const x = (Math.log(W) - Math.log(c[i])) / (Math.log(c[i + 1]) - Math.log(c[i]))
  return r[i] + x * (r[i + 1] - r[i])
}

/** Integrate dW/dt = g(W) W for `hours` (Euler in log space, 3-minute steps). */
export function wealthAt(regime, W0, hours, dtH = 0.05) {
  if (!num(W0) || W0 <= 0 || !num(hours) || hours < 0) return null
  let lw = Math.log(W0)
  for (let t = 0; t < hours; t += dtH) {
    const g = growthRate(regime, Math.exp(lw))
    if (g === null) return null
    lw += g * Math.min(dtH, hours - t)
  }
  return Math.exp(lw)
}

/**
 * Buy the 4S TIX API now or not: `{ wealth, cost, horizonH, canShort }`.
 * `wealth` is what the trader controls (cash + positions, less claims).
 */
export function buy4SVerdict({ wealth, cost, horizonH, canShort = false, why = null } = {}) {
  if (!num(cost) || cost <= 0) return { buy: false, why: '4S TIX API cost unreadable' }
  if (!num(wealth)) return { buy: false, why: 'wealth unreadable' }
  if (!num(horizonH) || horizonH <= 0) return { buy: false, why: `remaining life unmeasured${why ? ` (${why})` : ''} — a 4S purchase cannot be priced without a horizon`, notSimulated: 'across-install value (4S persists through installs)' }
  if (wealth <= cost) return { buy: false, why: `wealth $${fmt(wealth)} does not cover the $${fmt(cost)} API`, cost }
  const side = canShort ? 'ls' : 'long'
  const withW = wealthAt(`4S-${side}`, wealth - cost, horizonH)
  const withoutW = wealthAt(`pre-${side}`, wealth, horizonH)
  const buy = withW > withoutW
  return {
    buy,
    decidedBy: 'trajectory',
    cost,
    horizonH,
    withW,
    withoutW,
    why: `over ${horizonH.toFixed(2)}h: $${fmt(withW)} with 4S (after $${fmt(cost)}) vs $${fmt(withoutW)} without`,
    notSimulated: 'value beyond this life (4S persists through installs) — only strengthens a buy',
  }
}

// ---------------------------------------------------------------------------
// THE MANIPULATION CURVE (nodeecon.js `manipCurve`, read by batch.js through
// expfarm.manipVerdict): the trader's return per second as a function of the
// forecast-nudge rate the batcher delivers on the `manip` hosts, at the
// trader's current wealth.
//
// Source: tools/sim/stocks/manipcurve.mjs (8 seeds x 2h, burn-in 3000, the
// game's own market and influenceStockThroughServerGrow, nudges spread over
// each tick on the LARGEST position's company — what stock.js publishes as
// `manip`), 2026-09-25, long-only. Median ln-growth per hour; each capital's
// column made non-decreasing in the nudge rate (a running max: two cells
// dipped by seed noise, 1e11 pre-4S at 10/tick and 1e12 4S at 3/tick).
//
// NOT CALIBRATED against the live game: no live manipulation has been
// measured. stock.js publishes `calibration` (measured vs predicted return)
// for the unmanipulated rate; a served manip shows up as its positive error.

export const MANIP_TABLE = {
  source: 'tools/sim/stocks/manipcurve.mjs --seeds 8 --hours 2 (running max over nudges)',
  caps: [1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13],
  nudgesPerSec: [0, 0.25 / 6, 1 / 6, 3 / 6, 10 / 6],
  'pre-long': [
    [0.805, 0.907, 0.911, 0.768, 0.531, 0.241, 0.038],
    [0.842, 1.208, 0.981, 0.91, 0.655, 0.337, 0.048],
    [1.749, 1.558, 1.509, 1.332, 0.816, 0.382, 0.054],
    [2.384, 2.244, 2.005, 1.731, 1.55, 0.665, 0.093],
    [3.336, 2.697, 2.337, 2.015, 1.55, 0.761, 0.107],
  ],
  '4S-long': [
    [1.288, 1.321, 1.282, 1.205, 0.843, 0.479, 0.11],
    [1.756, 1.79, 1.61, 1.307, 1.004, 0.533, 0.123],
    [3.227, 3.042, 2.811, 1.952, 1.559, 0.898, 0.212],
    [4.189, 4.128, 3.307, 2.697, 1.699, 0.898, 0.212],
    [4.87, 4.195, 3.651, 2.73, 1.751, 0.925, 0.212],
  ],
}

/** ln-growth/h interpolated in log capital; above the table, $/h held flat (saturation). */
function interpCap(caps, row, W) {
  if (W <= caps[0]) return row[0]
  const n = caps.length - 1
  if (W >= caps[n]) return (row[n] * caps[n]) / W
  let i = 0
  while (W > caps[i + 1]) i++
  const x = (Math.log(W) - Math.log(caps[i])) / (Math.log(caps[i + 1]) - Math.log(caps[i]))
  return row[i] + x * (row[i + 1] - row[i])
}

/**
 * `manipCurve` for the record: [{nudgesPerSec, returnPerSec}] at wealth W for
 * 'pre-long' | '4S-long'. null when W is unreadable. Shorts are not in the
 * table (stock.js is long-only by default); with --short the long curve is
 * published as the nearest measured regime.
 */
export function manipCurveAt(regime, W) {
  const t = MANIP_TABLE
  const rows = t[regime]
  if (!rows || !num(W) || W <= 0) return null
  return t.nudgesPerSec.map((nu, k) => ({ nudgesPerSec: nu, returnPerSec: interpCap(t.caps, rows[k], W) / 3600 }))
}
