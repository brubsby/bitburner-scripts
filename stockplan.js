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
