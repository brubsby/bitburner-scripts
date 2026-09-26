// The stock trader. ns I/O only — every decision is stockstrat.js (pure),
// measured against the game's own market code in tools/sim/stocks/.
//
// Works with and without 4S, with and without shorting:
//   - without the 4S TIX API it ESTIMATES each forecast from the up/down ticks
//     (stockstrat.observe); with it, it reads ns.stock.getForecast;
//   - it shorts only with --short AND where the game allows (BitNode 8, or
//     SF8.2 — sfgate); long-only by default until shorts are measured live;
//   - it buys the 4S TIX API itself when stockplan.buy4SVerdict says the
//     wealth trajectory with it beats the one without over the remaining life.
//
// Money discipline (budget.js): stocks are a LIQUID claimant, last in
// PRIORITY. Positions are cash one tick away, so the trader may invest money
// a higher claimant has promised while that claim cannot be paid anyway; the
// moment wealth covers a claim, it sells until the cash is there. The sale
// before a funded batch or an install is act-liquidate.js's (an install
// destroys every share: Prestige.ts initStockMarket); this script opens
// nothing while its /tel/stock-hold.txt is fresh (nodeecon.js contract).
//
// Telemetry: /tel/stock.txt every tick — health, mode (pre-4S / 4S), phase,
// wealth, cash, positions with the forecast behind each, the orders sent and
// any the game refused, the 4S verdict, the claims it honoured, and
// nodeecon.js's record (equity, returnPerSec, capitalCap, incomePerSec, manip).
//
// RAM: 28.5GB static (node tools/sim/stocks/ram.mjs; the old 4S-only script
// was 24.7GB). getVolatility is never referenced (estimated from prices);
// getForecast (2.5) and buyShort/sellShort (5) are billed in every node — a
// deliberate trade against a port-fed 4S helper, which would add a second
// process and a per-tick handoff to save 2.5GB.

import { enter as traceEnter, leave as traceLeave } from 'trace.js'
import { newState, observe, decide, forecastOf, forecastSd, volOf, ticksToBoundary, SYMBOL_META, phaseRecord, phasePriorFrom } from 'stockstrat.js'
import { buy4SVerdict, manipCurveAt, growthRate } from 'stockplan.js'
import { canShortStock } from 'sfgate.js'
import { reserveFor, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
import { reporter, record, describe } from 'status.js'
import { remainingLife } from 'hacknetplan.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
// The record this file publishes and the hold it honours are specified in
// nodeecon.js (the one module that reads them): equity, returnPerSec,
// capitalCap, incomePerSec, manip; /tel/stock-hold.txt.
import { STOCK_HOLD_FILE, STOCK_HOLD_MS, feeReserveOf, FEE_FLOOR_S } from 'nodeecon.js'

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
 * Which companies the batcher can serve NOW, from what batch.js publishes
 * (/tel/batch.txt, 0GB to read): its `hackingLevel`, and the hosts its last
 * manip pass named in `expFarm.manip.blocked` ("host: why" — not rooted,
 * level too low, no batch fits). A company is servable when one of its
 * servers is certainly within the level (SYMBOL_META.req max <= level) and is
 * not currently blocked. Unreadable/stale batch.txt -> nothing servable and
 * no boost (fail closed; `servable.why` says so). No ns call: RAM flat.
 */
export function servableOf(batch, now = Date.now()) {
  const age = now - Date.parse(batch?.at ?? '')
  const level = batch?.hackingLevel
  if (!(age >= 0 && age < 5 * 60e3) || typeof level !== 'number') return { syms: new Set(), hosts: {}, level: null, nu: 0, why: 'batch.txt stale or unreadable — no manipulation requested, none credited' }
  const m = batch.expFarm?.manip ?? {}
  const blocked = new Set((m.blocked ?? []).map((b) => String(b).split(':')[0].trim()))
  const syms = new Set()
  const hosts = {}
  for (const [sym, meta] of Object.entries(SYMBOL_META)) {
    if (!meta.req || !(meta.req[1] <= level)) continue
    const ok = meta.servers.filter((h) => !blocked.has(h))
    if (!ok.length) continue
    syms.add(sym)
    hosts[sym] = ok
  }
  // Delivered nudges/s: only what the batcher is actually SERVING.
  const nu = m.serve === true && typeof m.nudgesPerSec === 'number' && m.nudgesPerSec > 0 ? m.nudgesPerSec : 0
  return { syms, hosts, level, nu, why: null }
}

/**
 * Which server's batch should carry {stock: true}, and on which side
 * (nodeecon.js `manip`): ONE servable company — the largest position among
 * the servable ones; with none held, the servable company with the strongest
 * forecast (so the batcher can price serving it at all — without a request
 * it reports no nudge rate and the boost below can never start). 'grow' for
 * a long, 'hack' for a short (PlayerInfluencing.ts). One company because that
 * is what manipCurve is priced on (tools/sim/stocks/manipcurve.mjs); servable
 * only because an unservable request delivers nothing (live 2026-09-25:
 * "vitalife: needs hacking 820, have 300").
 */
export function manipOf(positions, prices, servable = null, forecast = null) {
  const ok = (s) => SYMBOL_META[s]?.servers?.length && (!servable || servable.syms.has(s))
  const hostsOf = (s) => (servable ? servable.hosts[s] : SYMBOL_META[s].servers)
  const top = Object.entries(positions)
    .map(([s, [L, , Sh]]) => ({ s, v: (L + Sh) * prices[s], side: L >= Sh ? 'grow' : 'hack' }))
    .filter((x) => x.v > 0 && ok(x.s))
    .sort((a, b) => b.v - a.v)[0]
  let pick = top ?? null
  if (!pick && forecast) {
    const best = Object.keys(positions)
      .filter((s) => ok(s) && typeof forecast(s) === 'number' && forecast(s) > 0.5)
      .sort((a, b) => forecast(b) - forecast(a))[0]
    if (best) pick = { s: best, side: 'grow' }
  }
  const out = {}
  if (pick) for (const h of hostsOf(pick.s)) out[h] = pick.side
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
  // Created at the first tick (below), so the phase prior from the last run
  // is mapped against the wall time of the priming read.
  let st = null
  const PHASE_FILE = '/tel/stock-phase.txt'
  let phasePrior = null
  let freshTicks = null
  let phaseLockTick = null
  let last = { orders: [], refused: [] }
  let v4s = null
  // Return accounting (nodeecon.js returnPerSec/incomePerSec): each tick's
  // P&L is the change in post-trade equity plus the cash our own orders moved,
  // so deposits and withdrawals by other spenders never read as return.
  let prevEquity = null
  let prevPos = null // the book as THIS script left it last tick
  const ret = [] // [{pnl, capitalSec}] over the last hour of ticks
  let lifePnl = 0
  let startWealth = null
  const HIST = '/tel/stock-hist.txt'
  let lifeSec = 0
  // THE FEE RESERVE (nodeecon.feeReserveOf): cash that leaves between ticks
  // with no balance check (class and gym fees, player and sleeves) is measured
  // as the external flow per second — cash at a tick's start minus cash after
  // the previous tick's own trades — and twice FEE_FLOOR_S of its median is
  // kept uninvested (book.reserve). Without it every fee raise was reinvested
  // at the hold's release and cash ran below zero mid-leg; twice the floor so
  // the fee payers' own FEE_FLOOR_S start gate does not flap at the edge.
  const feeFlows = []
  let cashAfterPrev = null
  let cashAfterAt = null
  let feeReserve = { drainPerSec: 0, reserve: 0, n: 0 }
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
    traceLeave('stock')
    await ns.stock.nextUpdate()
    // Black-box section (trace.js): open from the tick until the next wait.
    traceEnter('stock')
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
      if (!st) {
        fetchFromHome(ns, PHASE_FILE)
        phasePrior = phasePriorFrom(readJson(ns, PHASE_FILE), Date.now(), info.lastAugReset)
        // A market initialised by this life's install / node entry
        // (Prestige.ts initStockMarket at lastAugReset) starts at the known
        // InitStockMetadata forecasts: the HMM starts there instead of at
        // the stationary prior (tools/sim/stocks/warmup.mjs: first-hour P&L
        // p10/p25/p50 47/67/98% -> 72/105/134% on fresh markets).
        const ticksSinceInit = Math.round((Date.now() - info.lastAugReset) / 6000)
        freshTicks = ticksSinceInit >= 0 && ticksSinceInit <= 150 ? ticksSinceInit : null
        st = newState(syms, { phasePrior, freshTicks })
      }
      observe(st, prices, forecasts)
      const prec = phaseRecord(st, Date.now(), info.lastAugReset)
      if (prec) {
        ns.write(PHASE_FILE, JSON.stringify({ at: new Date().toISOString(), ...prec }), 'w')
        if (ns.getHostname() !== 'home') ns.scp(PHASE_FILE, 'home', ns.getHostname())
      }
      counters.missedTicks = st.missed

      const positions = Object.fromEntries(syms.map((s) => [s, ns.stock.getPosition(s)]))
      const cash = ns.getServerMoneyAvailable('home')
      if (cashAfterPrev !== null && Date.now() > cashAfterAt) {
        feeFlows.push((cash - cashAfterPrev) / ((Date.now() - cashAfterAt) / 1000))
        if (feeFlows.length > 20) feeFlows.shift()
      }
      feeReserve = feeReserveOf(feeFlows, 2 * FEE_FLOOR_S)
      const posValue = equityOf(positions, ask, bid)
      const wealth = cash + posValue
      if (startWealth === null) startWealth = wealth

      // ---- money discipline ------------------------------------------------
      const hold = holdOf(ns, info)
      fetchFromHome(ns, '/tel/batch.txt')
      const servable = servableOf(readJson(ns, '/tel/batch.txt'))
      // stockstrat DEFAULTS.manipBoostPerNudge x delivered nudges/s, on the
      // servable companies only (tools/sim/stocks/servable.mjs).
      const boostPts = st.opt.manipBoostPerNudge * servable.nu
      const boost = boostPts > 0 ? Object.fromEntries([...servable.syms].map((s) => [s, boostPts])) : null
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
      const book = { cash, positions, maxShares, ask, bid, canShort, raiseCash, reserve: feeReserve.reserve, boost }
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
      cashAfterPrev = cashBefore + flows
      cashAfterAt = Date.now()
      const posAfter = orders.length ? Object.fromEntries(syms.map((s) => [s, ns.stock.getPosition(s)])) : positions
      const equity = equityOf(posAfter, ask, bid)
      if (prevEquity !== null) {
        // The market move on the book AS WE LEFT IT: last tick's positions at
        // this tick's prices. NOT posValue - prevEquity: shares another script
        // sold in between (act-liquidate.js raise/install, raise_*) are an
        // external flow, and booking them as P&L read every raise as a loss —
        // live 2026-09-26 13:23 a $72.8m JGN raise showed as lifePnl -$68m,
        // and every post-install "warm-up loss" in stock-hist.txt had this in it.
        const pnl = equityOf(prevPos, ask, bid) - prevEquity
        const capital = prevEquity + Math.max(0, cash - (claimKnown ? Math.min(R, cash) : 0))
        ret.push({ pnl, capitalSec: capital * 6 })
        if (ret.length > 600) ret.shift()
        lifePnl += pnl + (equity - posValue + flows) // + the spread/commission the trades cost
        lifeSec += 6
      }
      prevEquity = equity
      prevPos = posAfter
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
        phasePrior,
        // THE WARM-UP, measured (plan.js reads realisedCapital from
        // stock-hist.txt; this is the same run's summary): how this run
        // started, when the phase locked, and the P&L (flows excluded) so far.
        warmup: {
          prior: st.fresh ? 'init-forecast' : phasePrior ? 'phase-prior' : 'stationary',
          freshTicks,
          phaseLockTick: (phaseLockTick = phaseLockTick ?? (st.phase !== null ? st.t : null)),
          pnlFrac: startWealth > 0 ? lifePnl / startWealth : null,
          hours: (st.t * 6) / 3600,
        },
        toBoundary: ticksToBoundary(st),
        ticksSeen: st.t,
        wealth,
        cash,
        positionsValue: posValue,
        claims: { ...claims, reserve: claimKnown ? R : null, unreadable: !claimKnown, raiseCash },
        feeReserve,
        lastAugReset: info.lastAugReset,
        equity,
        // Net return on the capital managed, per second, over the last hour
        // of ticks (null until 10 ticks). Measured, not the offline table.
        returnPerSec: ret.length >= 10 && wCap > 0 ? wPnl / wCap : null,
        // Market capacity: every stock at maxShares, at today's prices.
        capitalCap: syms.reduce((a, s) => a + maxShares[s] * prices[s], 0),
        incomePerSec: lifeSec >= 60 ? lifePnl / lifeSec : null,
        // WHERE THE MONEY WENT. lifePnl is what trading made (market moves,
        // spread and commission, telescoped per tick); externalFlows is the
        // rest of the wealth change since this process started — money other
        // spenders took (negative) or income that arrived (positive). Live
        // 2026-09-25 a "-47% in 5 min" was $287.2m of darkweb programs
        // (moneySourceA.other = TOR + all five port openers), not a trade.
        startWealth,
        lifePnl,
        externalFlows: wealth - startWealth - lifePnl,
        manip: manipOf(positions, prices, servable, (s) => forecastOf(st, s)),
        servable: { level: servable.level, syms: [...servable.syms], nudgesPerSec: servable.nu, boostPoints: boostPts, why: servable.why },
        // Return per second at each nudge rate the batcher could deliver, at
        // this wealth and mode (stockplan.MANIP_TABLE, harness, NOT CALIBRATED).
        manipCurve: manipCurveAt(has4S ? '4S-long' : 'pre-long', wealth),
        // LIVE CALIBRATION: the measured return over the last hour against the
        // harness's prediction at the same capital and mode (no manipulation
        // assumed — a served manip shows as a positive error).
        calibration: (() => {
          const measured = ret.length >= 10 && wCap > 0 ? wPnl / wCap : null
          const g = growthRate(has4S ? (canShort ? '4S-ls' : '4S-long') : canShort ? 'pre-ls' : 'pre-long', wealth)
          const predicted = g === null ? null : g / 3600
          return {
            predictedPerSec: predicted,
            measuredPerSec: measured,
            ticks: ret.length,
            errorPct: measured !== null && predicted ? +((100 * (measured - predicted)) / predicted).toFixed(1) : null,
            note: ret.length < 600 ? 'less than an hour of ticks — noisy' : 'last hour',
          }
        })(),
        hold,
        held,
        last,
        diag,
        buy4S: v4s,
        why: hold ? `stock hold by ${hold.by} (${hold.why}) ${hold.ageS}s old — opening nothing` : !claimKnown ? 'a higher claim is UNREADABLE (join/augmentations) — trading anyway, positions are one tick from cash' : null,
      })
      // A bounded history for post-mortems (every 10 ticks, last 360 rows = 6h).
      if (counters.ticks % 10 === 0) {
        try {
          const row = JSON.stringify({ at: new Date().toISOString(), t: st.t, wealth: Math.round(wealth), equity: Math.round(equity), cash: Math.round(cash), lifePnl: Math.round(lifePnl), externalFlows: Math.round(wealth - startWealth - lifePnl), phase: st.phase, held: held.map((h) => `${h.sym}:${h.f}±${h.sd}`) })
          // Off home, start from home's copy (a restart may land on another host).
          if (counters.ticks === 10) fetchFromHome(ns, HIST)
          const lines = (ns.read(HIST) || '').split('\n').filter(Boolean)
          lines.push(row)
          ns.write(HIST, lines.slice(-360).join('\n') + '\n', 'w')
          if (ns.getHostname() !== 'home') ns.scp(HIST, 'home', ns.getHostname())
        } catch {
          /* history is best-effort; the status file carries the error path */
        }
      }
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
