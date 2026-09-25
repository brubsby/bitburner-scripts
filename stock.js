// The stock trader. ns I/O only — every decision is stockstrat.js (pure),
// measured against the game's own market code in tools/sim/stocks/.
//
// Works with and without 4S, with and without shorting:
//   - without the 4S TIX API it ESTIMATES each forecast from the up/down ticks
//     (stockstrat.observe); with it, it reads ns.stock.getForecast;
//   - it shorts only where the game allows (BitNode 8, or SF8.2 — sfgate);
//   - it buys the 4S TIX API itself when stockplan.buy4SVerdict says the
//     wealth trajectory with it beats the one without over the remaining life.
//
// Money discipline (budget.js): stocks are a LIQUID claimant, last in
// PRIORITY. Positions are cash one tick away, so the trader may invest money
// a higher claimant has promised while that claim cannot be paid anyway; the
// moment wealth covers a claim, it sells until the cash is there. Before an
// order batch that spends (buyaug/donate/install) it liquidates and stands
// down — an install destroys every share (Prestige.ts initStockMarket).
//
// Telemetry: /tel/stock.txt every tick — health, mode (pre-4S / 4S), phase,
// wealth, cash, positions with the forecast and edge behind each, the orders
// sent and any the game refused, the 4S verdict, and the claims it honoured.
//
// RAM: ~28GB (see the report in /tel/stock.txt `ram` and tools/test/stockstrat.test.mjs).

import { newState, observe, decide, forecastOf, forecastSd, volOf, ticksToBoundary, SYMBOL_META } from 'stockstrat.js'
import { buy4SVerdict } from 'stockplan.js'
import { canShortStock } from 'sfgate.js'
import { reserveFor, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
import { reporter, record, describe } from 'status.js'
import { remainingLife } from 'hacknetplan.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
// The record this file publishes and the hold it honours are specified in
// nodeecon.js (the one module that reads them): equity, returnPerSec,
// capitalCap, incomePerSec, manip; /tel/stock-hold.txt.
import { STOCK_HOLD_FILE, STOCK_HOLD_MS } from 'nodeecon.js'

const STATUS = '/tel/stock.txt'
const GATE_FILE = '/tel/installgate.txt'
const SCHEDULE = '/tel/factionplan.txt'
function readJson(ns, file) {
  try {
    return JSON.parse(ns.read(file) || 'null')
  } catch {
    return null
  }
}
function fetchFromHome(ns, file) {
  if (ns.getHostname() === 'home') return
  try {
    ns.scp(file, ns.getHostname(), 'home')
  } catch {
    /* the previous copy stays; its stamp decides freshness */
  }
}

/**
 * /tel/stock-hold.txt (act-liquidate.js writes it before a funded batch and
 * every install): while fresh and of this life, open NO position — the sale
 * has happened and an install may be imminent, which destroys every share.
 */
function holdOf(ns, info) {
  fetchFromHome(ns, STOCK_HOLD_FILE)
  const h = readJson(ns, STOCK_HOLD_FILE)
  if (!h || h.lastAugReset !== info.lastAugReset) return null
  const age = Date.now() - Date.parse(h.at ?? '')
  return age >= 0 && age < STOCK_HOLD_MS ? { at: h.at, by: h.by ?? null, why: h.why ?? null, ageS: Math.round(age / 1000) } : null
}

/**
 * Which server's batch should carry {stock: true}, and on which side
 * (nodeecon.js `manip`): the companies behind our three largest positions —
 * 'grow' pushes a long's second-order forecast up, 'hack' a short's down
 * (PlayerInfluencing.ts). Offline, 2 moneyMax-fractions per tick of flagged
 * grows on the largest position lifted $250m growth from ~96%/h to ~266%/h
 * (tools/sim/stocks/compare.mjs new-pre-ls+manip2); what the live batcher
 * delivers is not measured.
 */
function manipOf(positions, prices) {
  const top = Object.entries(positions)
    .map(([s, [L, , Sh]]) => ({ s, v: (L + Sh) * prices[s], side: L >= Sh ? 'grow' : 'hack' }))
    .filter((x) => x.v > 0 && SYMBOL_META[x.s]?.servers?.length)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
  const out = {}
  for (const x of top) for (const h of SYMBOL_META[x.s].servers) out[h] = x.side
  return out
}

/** The claims budget.js ranks above stocks; null fields are UNREADABLE. */
function claimsOf(ns, info) {
  fetchFromHome(ns, GATE_FILE)
  const gate = ns.read(GATE_FILE)
  // RAM upgrade only: the cores option needs ns.getServer (2GB) for the core
  // count. The RAM price is the larger claim whenever cores would have been
  // cheaper, so this errs toward holding MORE cash for home, never less.
  const up = nextHomeUpgrade(ns.getServerMaxRam('home'), Infinity, bitNodeMults(info.currentNode)?.HomeComputerRamCost)
  return {
    join: joinClaim(gate, info.lastAugReset),
    augmentations: augClaim(gate, info.lastAugReset),
    home: up ? up.cost : 0,
  }
}

function remainingLifeH(ns, lastAugReset) {
  fetchFromHome(ns, SCHEDULE)
  const fresh = (file) => {
    const s = readJson(ns, file)
    if (!s) return null
    const ageMs = Date.now() - Date.parse(s.at ?? 0)
    if (!(ageMs < 30 * 60e3)) return null
    if (typeof s.lastAugReset === 'number' && s.lastAugReset !== lastAugReset) return null
    return { ...s, ageMs }
  }
  const sched = fresh(SCHEDULE)
  const gate = fresh(GATE_FILE)
  return remainingLife({
    ledger: sched ? { windowH: sched.windowH, lifeAgeH: sched.lifeAgeH, ageMs: sched.ageMs } : null,
    gate: gate ? { install: gate.install, waitMs: gate.bestWait?.waitMs, ageMs: gate.ageMs, passMs: 60e3 } : null,
  })
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL')
  const flags = ns.flags([
    ['horizon', -1], // hours: override the remaining-life horizon for the 4S verdict
    ['no4s', false], // never buy the 4S TIX API
    // Shorts are opt-in: long+short and long-only measure alike offline
    // (tools/sim/stocks/compare.mjs) and nothing live has confirmed either.
    ['short', false],
  ])
  const errors = []
  const counters = { ticks: 0, orders: 0, refused: 0, missedTicks: 0 }
  const note = reporter(ns, STATUS, () => ({ host: ns.getHostname(), counters, errors: errors.slice(-5) }))
  const push = () => {
    if (ns.getHostname() !== 'home') ns.scp(STATUS, 'home', ns.getHostname())
  }
  ns.atExit(() => {
    note.exit('stopped', { detail: 'stock.js exited — killed, threw, or an install took it (positions, if any, remain in the market until an install destroys them)' })
    push()
  }, 'status')

  const info = ns.getResetInfo()
  // Shorts only with --short AND where the game allows them (BN8 or SF8.2).
  // Existing shorts are still closed normally (decide exits a short when
  // canShort is false), so the flag is safe to flip on a running book.
  const canShort = canShortStock(info) && flags.short === true
  if (!ns.stock.hasTixApiAccess()) {
    // Not an error: the entry is progress.js's decision (stockplan.verdict).
    // Exit rather than idle at ~28GB; watchdog.js relaunches on the invariant
    // ns.stock.hasTixApiAccess(). The atExit publish says 'stopped' with why.
    note('waiting', { why: 'no TIX API access — exiting; watchdog.js relaunches when it is bought (the WSE entry is priced by progress.js, stockplan.verdict)' })
    push()
    return
  }

  const syms = ns.stock.getSymbols()
  const maxShares = Object.fromEntries(syms.map((s) => [s, ns.stock.getMaxShares(s)]))
  const consts = ns.stock.getConstants()
  const nodeMults = bitNodeMults(info.currentNode)
  const st = newState(syms)
  let last = { orders: [], refused: [] }
  let v4s = null
  // Return accounting (nodeecon.js returnPerSec/incomePerSec): each tick's
  // P&L is the change in post-trade equity plus the cash our own orders moved,
  // so deposits and withdrawals by other spenders never read as return.
  let prevEquity = null
  const ret = [] // [{pnl, capitalSec}] over the last hour of ticks
  let lifePnl = 0
  let lifeSec = 0
  const equityOf = (positions, ask, bid) => {
    let v = 0
    for (const s of syms) {
      const [L, , Sh, shAvg] = positions[s]
      if (L > 0) v += L * bid[s] - consts.StockMarketCommission
      if (Sh > 0) v += Sh * (2 * shAvg - ask[s]) - consts.StockMarketCommission
    }
    return Math.max(0, v)
  }

  while (true) {
    await ns.stock.nextUpdate()
    try {
      counters.ticks++
      const has4S = ns.stock.has4SDataTixApi()
      const prices = {}
      const ask = {}
      const bid = {}
      for (const s of syms) {
        const p = ns.stock.getPrice(s)
        const a = ns.stock.getAskPrice(s)
        prices[s] = p
        ask[s] = a
        // ask = p(1+spread), bid = p(1-spread) (Stock.ts:229-236): one read gives both.
        bid[s] = 2 * p - a
      }
      const forecasts = has4S ? Object.fromEntries(syms.map((s) => [s, ns.stock.getForecast(s)])) : null
      observe(st, prices, forecasts)
      counters.missedTicks = st.missed

      const positions = Object.fromEntries(syms.map((s) => [s, ns.stock.getPosition(s)]))
      const cash = ns.getServerMoneyAvailable('home')
      const posValue = equityOf(positions, ask, bid)
      const wealth = cash + posValue

      // ---- money discipline ------------------------------------------------
      const hold = holdOf(ns, info)
      const claims = claimsOf(ns, info)
      const R = reserveFor('stocks', claims) // Infinity when any claim is unreadable
      // Liquid claimant: a claim is honoured in CASH once wealth covers it; while
      // it cannot be paid anyway the money works (the harness: every strategy
      // here has positive median growth at every capital, so a claim is reached
      // sooner invested than idle). An UNREADABLE claim cannot be honoured at
      // all — say so (health 'warn'), keep trading: the positions stay one tick
      // from cash, so the cost of the unknown is one tick of delay, not a spend.
      const claimKnown = isFinite(R)
      const raiseCash = claimKnown && wealth >= R ? R : 0
      const book = { cash, positions, maxShares, ask, bid, canShort, raiseCash }
      const decided = decide(st, book)
      const diag = decided.diag
      // Under a hold nothing is OPENED; exits and trims still go through.
      const orders = hold ? decided.orders.filter((o) => o.kind === 'sell' || o.kind === 'cover') : decided.orders
      const cashBefore = ns.getServerMoneyAvailable('home')

      // ---- execute: sells first (decide orders them so), each checked -------
      const refused = []
      for (const o of orders) {
        let px = 0
        if (o.kind === 'sell') px = ns.stock.sellStock(o.sym, o.shares)
        else if (o.kind === 'cover') px = ns.stock.sellShort(o.sym, o.shares)
        else if (o.kind === 'buy' || o.kind === 'short') {
          // Re-check the money: a sell that fetched less than planned shrinks the buy.
          const unit = o.kind === 'buy' ? ask[o.sym] : bid[o.sym]
          const n = Math.min(o.shares, Math.floor((ns.getServerMoneyAvailable('home') - raiseCash - consts.StockMarketCommission) / unit))
          if (n > 0) px = o.kind === 'buy' ? ns.stock.buyStock(o.sym, n) : ns.stock.buyShort(o.sym, n)
        }
        counters.orders++
        if (!(px > 0)) {
          counters.refused++
          refused.push({ ...o, why: `${o.why} — REFUSED by the game (returned ${px})` })
        }
      }
      last = { at: new Date().toISOString(), orders, refused }
      const flows = ns.getServerMoneyAvailable('home') - cashBefore
      const posAfter = orders.length ? Object.fromEntries(syms.map((s) => [s, ns.stock.getPosition(s)])) : positions
      const equity = equityOf(posAfter, ask, bid)
      if (prevEquity !== null) {
        const pnl = posValue - prevEquity // this tick's market move on last tick's book
        const capital = prevEquity + Math.max(0, cash - (claimKnown ? Math.min(R, cash) : 0))
        ret.push({ pnl, capitalSec: capital * 6 })
        if (ret.length > 600) ret.shift()
        lifePnl += pnl + (equity - posValue + flows) // + the spread/commission the trades cost
        lifeSec += 6
      }
      prevEquity = equity
      const wPnl = ret.reduce((a, b) => a + b.pnl, 0)
      const wCap = ret.reduce((a, b) => a + b.capitalSec, 0)

      // ---- the 4S TIX API: a trajectory decision ----------------------------
      if (!has4S && !flags.no4s && !hold) {
        const cost = consts.MarketDataTixApi4SCost * nodeMults.FourSigmaMarketDataApiCost
        const life = flags.horizon >= 0 ? { hours: flags.horizon, why: '--horizon', source: 'flag' } : remainingLifeH(ns, info.lastAugReset)
        v4s = buy4SVerdict({ wealth: wealth - (claimKnown ? R : 0), cost, horizonH: life.hours, canShort, why: life.why })
        if (v4s.buy && ns.getServerMoneyAvailable('home') >= cost) {
          v4s.bought = ns.stock.purchase4SMarketDataTixApi()
        } else if (v4s.buy) {
          // Raise the cash next tick: sell into it through the claim path.
          v4s.note = 'buy wanted; cash short — liquidating toward it'
          const need = cost - ns.getServerMoneyAvailable('home')
          if (need > 0) {
            const sells = decide(st, { ...book, raiseCash: raiseCash + cost }).orders.filter((o) => o.kind === 'sell' || o.kind === 'cover')
            for (const o of sells) o.kind === 'sell' ? ns.stock.sellStock(o.sym, o.shares) : ns.stock.sellShort(o.sym, o.shares)
          }
        }
      }

      const held = syms
        .filter((s) => positions[s][0] > 0 || positions[s][2] > 0)
        .map((s) => ({ sym: s, long: positions[s][0], short: positions[s][2], f: +forecastOf(st, s).toFixed(4), sd: +forecastSd(st, s).toFixed(4), vol: volOf(st, s) }))
      const health = refused.length ? 'warn' : !claimKnown ? 'warn' : 'ok'
      note(health, {
        mode: has4S ? '4S' : 'pre-4S (estimated forecasts)',
        canShort,
        phase: st.phase,
        toBoundary: ticksToBoundary(st),
        ticksSeen: st.t,
        wealth,
        cash,
        positionsValue: posValue,
        claims: { ...claims, reserve: claimKnown ? R : null, unreadable: !claimKnown, raiseCash },
        lastAugReset: info.lastAugReset,
        equity,
        // Net return on the capital managed, per second, over the last hour
        // of ticks (null until 10 ticks). Measured, not the offline table.
        returnPerSec: ret.length >= 10 && wCap > 0 ? wPnl / wCap : null,
        // Market capacity: every stock at maxShares, at today's prices.
        capitalCap: syms.reduce((a, s) => a + maxShares[s] * prices[s], 0),
        incomePerSec: lifeSec >= 60 ? lifePnl / lifeSec : null,
        manip: manipOf(positions, prices),
        hold,
        held,
        last,
        diag,
        buy4S: v4s,
        why: hold ? `stock hold by ${hold.by} (${hold.why}) ${hold.ageS}s old — opening nothing` : !claimKnown ? 'a higher claim is UNREADABLE (join/augmentations) — trading anyway, positions are one tick from cash' : null,
      })
      push()
    } catch (err) {
      const text = record(errors, err)
      ns.print(`stock.js error: ${text}`)
      note('error', { error: describe(err), last })
      push()
      await ns.sleep(1000)
    }
  }
}
