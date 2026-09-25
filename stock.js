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

import { newState, observe, decide, forecastOf, forecastSd, volOf, ticksToBoundary } from 'stockstrat.js'
import { buy4SVerdict } from 'stockplan.js'
import { canShortStock } from 'sfgate.js'
import { reserveFor, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
import { reporter, record, describe } from 'status.js'
import { remainingLife } from 'hacknetplan.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'

const STATUS = '/tel/stock.txt'
const GATE_FILE = '/tel/installgate.txt'
const ORDERS = '/tel/orders.txt'
const ACT = '/tel/act.txt'
const SCHEDULE = '/tel/factionplan.txt'
const ORDERS_FRESH_MS = 15 * 60 * 1000 // act.js ORDERS_FRESH_MS
const SPENDING_ORDERS = new Set(['buyaug', 'donate', 'install'])

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
 * Is a spending order batch waiting for act.js? Then money must be cash.
 * Pending = fresh, this life's, contains buyaug/donate/install, and act.js has
 * not yet reported that batch as executed.
 */
function spendPending(ns, info) {
  fetchFromHome(ns, ORDERS)
  fetchFromHome(ns, ACT)
  const b = readJson(ns, ORDERS)
  if (!b || b.lastAugReset !== info.lastAugReset || !(Date.now() - Date.parse(b.at) < ORDERS_FRESH_MS)) return null
  const kinds = (b.orders ?? []).map((o) => o.kind).filter((k) => SPENDING_ORDERS.has(k))
  if (!kinds.length) return null
  const a = readJson(ns, ACT)
  if (a?.orders?.at === b.at) return null
  return { at: b.at, kinds }
}

/** The claims budget.js ranks above stocks; null fields are UNREADABLE. */
function claimsOf(ns, info) {
  fetchFromHome(ns, GATE_FILE)
  const gate = ns.read(GATE_FILE)
  // RAM upgrade only: the cores option needs ns.getServer (2GB) for the core
  // count. The RAM price is the larger claim whenever cores would have been
  // cheaper, so this errs toward holding MORE cash for home, never less.
  const up = nextHomeUpgrade(ns.getServerMaxRam('home'), Infinity)
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
    ['long-only', false], // never open shorts even where the node allows them
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
  // Shorts where the game allows them (BN8 or SF8.2), unless --long-only.
  // Existing shorts are still closed normally (decide exits a short when
  // canShort is false), so the flag is safe to flip on a running book.
  const canShort = canShortStock(info) && !flags['long-only']
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
      let posValue = 0
      for (const s of syms) {
        const [L, , Sh, shAvg] = positions[s]
        if (L > 0) posValue += L * bid[s] - consts.StockMarketCommission
        if (Sh > 0) posValue += Sh * (2 * shAvg - ask[s]) - consts.StockMarketCommission
      }
      const wealth = cash + posValue

      // ---- money discipline ------------------------------------------------
      const pending = spendPending(ns, info)
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
      const book = { cash, positions, maxShares, ask, bid, canShort, liquidate: !!pending, raiseCash }
      const { orders, diag } = decide(st, book)

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

      // ---- the 4S TIX API: a trajectory decision ----------------------------
      if (!has4S && !flags.no4s) {
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
        pending,
        liquidating: !!pending,
        held,
        last,
        diag,
        buy4S: v4s,
        why: !claimKnown ? 'a higher claim is UNREADABLE (join/augmentations) — trading anyway, positions are one tick from cash' : pending ? `a spending batch (${pending.kinds.join(',')}) is pending — liquidated, standing down` : null,
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
