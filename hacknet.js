// Hacknet: first the Netburners invitation, then an honest CLAIMANT.
//
//   run hacknet.js
//
// PHASE 1 — THE INVITATION. Netburners wants hacking 80, 100 total hacknet
// levels, 8 total RAM and 4 total cores (src/Faction/FactionInfo.tsx,
// inviteReqs). That is one more faction, and factions are the binding
// constraint on leaving a BitNode: Daedalus needs 30 distinct augmentations
// and a faction is the only place to buy them. The hacknet API needs no
// Source-File, so this unlock is free to automate. Phase 1 buys the cheapest
// upgrade that moves a requirement and stops the moment all three are met.
//
// PHASE 2 — THE ECONOMY. Until 2026-09-19 this script EXITED here, and the
// eight nodes it left behind produced money nothing forecast and cost money
// nothing had weighed (docs/pricing-gaps.md §4: "invisible in both
// directions"). Now it keeps running and, every 30 seconds, asks
// hacknetplan.js the only question that matters for a node the next install
// will destroy:
//
//     does the best next purchase pay for itself before this life ends?
//
// with the life's remaining length read from the measured install window
// progress.js publishes (/tel/factionplan.txt windowH, lifeAgeH). If yes, and
// the cost fits inside what budget.js leaves after every higher claim (join
// money, the augmentation plan, the home upgrade), it buys and re-asks. If
// not, it publishes the refusal and its reason. It never buys against an
// unmeasured horizon and never buys through a claim it cannot read.
//
// Runs ANYWHERE (boot.js places it off home, where a 32GB start has no room
// for it): the claims and the window are telemetry files that live on home,
// so each pass copies them here with ns.scp(file, here, 'home') before
// reading — a copy that fails leaves the previous copy, whose `at` stamp
// then reads as stale and refuses.
//
// HACKNET SERVERS (BitNode 9, or any node with Source-File 9 —
// sfgate.hasHacknetServers). The same API buys servers that produce HASHES
// and carry RAM. Both phases run on the server model instead
// (hacknetplan.js): phase 1 buys the cheapest purchase per unit of a still-
// short Netburners total (servers count exactly like nodes,
// FactionJoinCondition.ts iterateHacknet); phase 2 prices each purchase in
// DOLLARS at the $250k/hash sell floor, so the exit verdict, the payback
// fallback and budget.js treat it exactly like a node purchase. What the
// hashes are then spent on is hashspend.js's decision, not this file's.
// Two more things this file owns in server mode:
//   - the RAM POLICY (`ramPolicy` in /tel/hacknet.txt): per server, whether
//     the batcher's $/GB beats the hashes a GB of scripts costs there
//     (hashRate's 1 - ramUsed/maxRam term). batch.js and seed.js refuse a
//     hacknet server's RAM unless this says so, fresh.
//   - CACHE, bought only when hashspend.js reports that the upgrade its exit
//     simulation chose costs more hashes than the servers can hold.
// And in both modes it publishes `moneyPerSec` — hacknet production as
// money (a node's $/s, or hashes at the sell floor) — because it is not
// script income and progress.js's exit inputs would otherwise never see it.

import { reporter } from 'status.js'
import { bestUpgrade, verdict, remainingLife, committedInstallH, planHacknetBatchGen, netburnersServerStep, ramPolicy, hashRate, cacheCost, hashCapacityOf, DOLLARS_PER_HASH } from 'hacknetplan.js'
import { spendable, reserveFor, augClaim, joinClaim } from 'budget.js'
import { stockRecordFromText, raiseRequestFor, raiseFileOf, STOCK_FILE } from 'nodeecon.js'
import { nextHomeUpgrade } from 'homecost.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { hasHacknetServers } from 'sfgate.js'
// Pure: runs the batch planner in slices so a big batch never holds the page.
import { makePacer } from 'coop.js'
// Pure: the committed route, and the hashes' trajectory on the Bladeburner route's exit.
import { committedRouteOf } from 'splitctl.js'
import { exchangeOf, bladeHashHorizonH, planRouteHacknetBatch } from 'hashplan.js'

const NEED = { levels: 100, ram: 8, cores: 4 }
const STATUS = '/tel/hacknet.txt'
const GATE_FILE = '/tel/installgate.txt'
const SCHEDULE = '/tel/factionplan.txt'
/** progress.js's committed plan: its install decision is when this life ends. */
const PLAN_FILE = '/tel/plan.txt'
/** progress.js's exit inputs: the trader's return, cap and the balance, for the batch's money-at-install values. */
const EXIT_INPUTS = '/tel/exitinputs.txt'
/** Per-pass bounds: purchases planned, and the page-thread slice (ms) between yields. */
const BATCH_MAX_ITEMS = 400
const BATCH_SLICE_MS = 20
const BATCH_FILE = '/tel/batch.txt'
/** hashspend.js's report: a capacity-bound choice asks this file for cache. */
const HASHSPEND_FILE = '/tel/hashspend.txt'
/** A window older than this is a different life's or a dead planner's. */
const SCHEDULE_FRESH_MS = 20 * 60 * 1000
/**
 * watchdog.js's JOB_MIN_INTERVAL: progress.js cannot run — so cannot install —
 * sooner than this after the pass that published the gate. HN4 pins the two
 * constants equal (watchdog.js cannot be imported here: its ns surface would
 * be billed to this script).
 */
const PLANNER_PASS_MS = 300000

function totals(ns) {
  const n = ns.hacknet.numNodes()
  let levels = 0
  let ram = 0
  let cores = 0
  const nodes = []
  for (let i = 0; i < n; i++) {
    const s = ns.hacknet.getNodeStats(i)
    levels += s.level
    ram += s.ram
    cores += s.cores
    // name/ramUsed/cache exist only for hacknet SERVERS
    // (NetscriptFunctions/Hacknet.ts:88-92); production is then hashes/s.
    nodes.push({ name: s.name, level: s.level, ram: s.ram, cores: s.cores, production: s.production, ramUsed: s.ramUsed, cache: s.cache })
  }
  return { nodes: n, levels, ram, cores, list: nodes, productionPerSec: nodes.reduce((a, b) => a + (b.production ?? 0), 0) }
}

/**
 * THE RATE MODEL'S CALIBRATION, every pass: hacknetplan.hashRate against the
 * game's own hashRate (getNodeStats.production) per server. A model that
 * prices purchases must reproduce the number the game already shows.
 */
function rateCheck(list, mult, nodeMoney) {
  let worst = 0
  let n = 0
  for (const s of list) {
    const m = hashRate(s.level, s.ramUsed ?? 0, s.ram, s.cores, mult, nodeMoney)
    if (typeof m !== 'number' || typeof s.production !== 'number') continue
    n++
    const err = s.production > 0 ? Math.abs(m / s.production - 1) : m > 0 ? Infinity : 0
    if (err > worst) worst = err
  }
  return { servers: n, maxRelErr: n ? worst : null, verdict: !n ? 'no servers' : worst <= 0.01 ? 'ok' : 'MODEL DISAGREES WITH THE GAME' }
}

/** Bring a home telemetry file to this host; a no-op on home. */
function fetchFromHome(ns, file) {
  const here = ns.getHostname()
  if (here === 'home') return
  try {
    ns.scp(file, here, 'home')
  } catch {
    /* the previous copy stays; its stamp decides freshness */
  }
}

/**
 * Hours left in this life: hacknetplan.remainingLife over the planner's ledger
 * window (factionplan.txt) and the install gate's own decision (installgate.txt).
 * Each witness is dropped (null) when stale or from another life, so a dead
 * planner cannot keep a horizon alive.
 */
function remainingLifeH(ns, lastAugReset) {
  fetchFromHome(ns, SCHEDULE)
  fetchFromHome(ns, GATE_FILE)
  const readFresh = (file) => {
    let s
    try {
      s = JSON.parse(ns.read(file) || 'null')
    } catch {
      return null
    }
    if (!s) return null
    const ageMs = Date.now() - Date.parse(s.at ?? 0)
    if (!(ageMs < SCHEDULE_FRESH_MS)) return null
    if (typeof s.lastAugReset === 'number' && s.lastAugReset !== lastAugReset) return null
    return { ...s, ageMs }
  }
  const sched = readFresh(SCHEDULE)
  const gate = readFresh(GATE_FILE)
  // The committed plan's install time outranks both (hacknetplan.remainingLife).
  fetchFromHome(ns, PLAN_FILE)
  let planH = null
  try {
    const p = JSON.parse(ns.read(PLAN_FILE) || 'null')
    planH = committedInstallH(p?.decisions?.install, { lastAugReset, planLastAugReset: p?.lastAugReset, at: p?.at ?? '' })
  } catch {
    /* unreadable: the ledger and the gate decide, as before */
  }
  return remainingLife({
    plan: planH === null ? null : { hours: planH },
    ledger: sched ? { windowH: sched.windowH, lifeAgeH: sched.lifeAgeH, ageMs: sched.ageMs } : null,
    gate: gate ? { install: gate.install, waitMs: gate.bestWait?.waitMs, ageMs: gate.ageMs, passMs: PLANNER_PASS_MS } : null,
  })
}

/** Publish the status on home, wherever this runs — the daemon reads home. */
function publish(ns, obj) {
  ns.write(STATUS, JSON.stringify(obj, null, 2), 'w')
  if (ns.getHostname() !== 'home') ns.scp(STATUS, 'home', ns.getHostname())
}

function buy(ns, best) {
  switch (best.kind) {
    case 'node':
      return ns.hacknet.purchaseNode() >= 0
    case 'level':
      return ns.hacknet.upgradeLevel(best.index, 1)
    case 'ram':
      return ns.hacknet.upgradeRam(best.index, 1)
    case 'core':
      return ns.hacknet.upgradeCore(best.index, 1)
    case 'cache':
      return ns.hacknet.upgradeCache(best.index, best.count ?? 1)
    default:
      return false
  }
}

/**
 * The server-mode fields of the report: hash rate and capacity, the rate
 * model's calibration against the game, and the RAM policy batch.js and
 * seed.js obey. The batcher's $/GB/s is its own (earnedPerSec over ram.total,
 * batch.txt, fresh); unreadable leaves every server's RAM to its hashes.
 */
function serverReport(ns, t, mults, nodeMoney) {
  fetchFromHome(ns, BATCH_FILE)
  let batchPerGBs = null
  try {
    const b = JSON.parse(ns.read(BATCH_FILE) || 'null')
    const fresh = b && Date.now() - Date.parse(b.at) < 5 * 60e3
    if (fresh && b.totals?.earnedPerSec > 0 && b.ram?.total > 0) batchPerGBs = b.totals.earnedPerSec / b.ram.total
  } catch {
    /* unreadable: every hacknet server keeps its RAM for hashes */
  }
  return {
    mode: 'servers',
    // The purchase model progress.js carries into the exit (exitInputsOf
    // `hacknet`): each later life rebuilds its fleet from zero
    // (lifeplan.freshLifeMoney), priced with these.
    model: { mults: { hacknet_node_money: mults.hacknet_node_money, hacknet_node_purchase_cost: mults.hacknet_node_purchase_cost, hacknet_node_level_cost: mults.hacknet_node_level_cost, hacknet_node_ram_cost: mults.hacknet_node_ram_cost, hacknet_node_core_cost: mults.hacknet_node_core_cost }, nodeMoney },
    hashesPerSec: t.productionPerSec,
    // Capacity from cache (HacknetServer.updateHashCapacity: 32 x 2^cache), NOT
    // stats.hashCapacity: that property name is billed as ns.hacknet.hashCapacity
    // (0.5GB) by the RAM checker, which prices identifiers by name (invariant B1).
    hashCap: t.list.reduce((a, x) => a + (hashCapacityOf(x.cache) ?? 0), 0),
    rateModel: rateCheck(t.list, mults.hacknet_node_money, nodeMoney),
    ramPolicy: ramPolicy(t.list, mults, nodeMoney, batchPerGBs),
  }
}

/**
 * CACHE, servers only: hashspend.js's exit simulation chose an upgrade whose
 * hash cost exceeds what the servers can hold (`decision.capacityBound`).
 * Capacity produces nothing by itself, so it has no payback of its own; it
 * is bought only for that simulated choice, the cheapest step, through EVERY
 * claim (`free` is spendable with no exit waiver: the cache's price was not
 * part of that simulation).
 */
function cacheOffer(ns, info, t, capacity, free) {
  fetchFromHome(ns, HASHSPEND_FILE)
  let hs = null
  try {
    hs = JSON.parse(ns.read(HASHSPEND_FILE) || 'null')
  } catch {
    return { buy: false, why: 'hashspend report unreadable' }
  }
  if (!hs || hs.lastAugReset !== info.lastAugReset || !(Date.now() - Date.parse(hs.at) < 10 * 60e3)) return { buy: false, why: 'no fresh hashspend report' }
  const cb = hs.decision?.capacityBound
  if (!cb || !(cb.cost > capacity)) return { buy: false, why: 'no capacity-bound choice' }
  let best = null
  t.list.forEach((x, i) => {
    const c = cacheCost(x.cache ?? 1, 1)
    if (isFinite(c) && c > 0 && (!best || c < best.cost)) best = { kind: 'cache', index: i, cost: c }
  })
  if (!best) return { buy: false, why: 'every cache is maxed' }
  const ok = best.cost <= free
  return { ...best, buy: ok, for: cb.name, why: ok ? `${cb.name} needs ${cb.cost} hashes against capacity ${capacity}` : `cache $${best.cost.toExponential(2)} exceeds the $${Math.round(free)} the claims leave` }
}


/** What budget.js leaves room for: the join, augmentation and home claims (fail closed when unreadable). */
function claimsOf(ns, info) {
  return {
    join: joinClaim(ns.read(GATE_FILE), info.lastAugReset),
    augmentations: augClaim(ns.read(GATE_FILE), info.lastAugReset),
    home: (() => {
      const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores, bitNodeMults(info)?.HomeComputerRamCost)
      if (!up) return 0
      const ram = ns.getServerMaxRam('home')
      return { amount: up.cost, deltaGB: up.kind === 'RAM' ? ram : ram / 16 }
    })(),
  }
}

/**
 * ONE SERVER-MODE PASS: plan the batch (sliced), take the exit verdict on it,
 * fund it with one sized raise, buy it in order. Returns {bought, lastBuy,
 * again} — `again` when the batch was cut short by cash and a raise is out.
 *
 * The verdict: progress.js prices the published batch (cost, income) as one
 * spend (installgate spendExit.hacknet, `batch: true`) and approves it when it
 * is money-dominant; this buys the batch's prefix up to the approved cost.
 * Without a fresh verdict the batch's own test stands — every item adds money
 * at the install by construction — named `batch-dominance`, and it spends
 * through the home and (join-money-not-in-hand) join claims only, never the
 * augmentation claim and never the book.
 */
async function serverBatchPass(ns, { info, t, mults, nodeMoney, money, base, state }) {
  // THE COMMITTED ROUTE: on the Bladeburner route the hashes buy rank and
  // skill points on the black-op exit, not money at an install — priced there.
  fetchFromHome(ns, PLAN_FILE)
  let plan = null
  let route = null
  try {
    plan = JSON.parse(ns.read(PLAN_FILE) || 'null')
    route = committedRouteOf(plan, { node: info.currentNode })
  } catch {
    route = null
  }
  if (route?.key === 'blade') return routeBatchPass(ns, { info, t, mults, nodeMoney, money, base, state, plan, route })
  const life = remainingLifeH(ns, info.lastAugReset)
  fetchFromHome(ns, EXIT_INPUTS)
  const capital = (() => {
    try {
      const r = JSON.parse(ns.read(EXIT_INPUTS) || 'null')
      if (!r?.inputs || r.lastAugReset !== info.lastAugReset || !(Date.now() - Date.parse(r.at) < 15 * 60e3)) return null
      const x = r.inputs
      return { capitalReturnPerSec: x.capitalReturnPerSec, capitalCap: x.capitalCap, capitalScaleW: x.capitalScaleW ?? null, capitalShape: x.capitalShape ?? null, capitalWarmupH: x.capitalWarmupH, money: x.money }
    } catch {
      return null
    }
  })()
  const pacer = makePacer({ sliceMs: BATCH_SLICE_MS, yieldFn: () => ns.sleep(0) })
  const batch = life.hours === null ? { items: [], cost: 0, gainPerSec: 0, stoppedBy: life.why } : await pacer.slices(planHacknetBatchGen({ servers: t.list, mults, nodeMoney, W: life.hours, capital, maxItems: BATCH_MAX_ITEMS }), 'hacknet-batch')
  fetchFromHome(ns, GATE_FILE)
  const exitV = (() => {
    try {
      const g = JSON.parse(ns.read(GATE_FILE) || 'null')
      const x = g?.spendExit
      const h = x?.hacknet
      if (!x || x.lastAugReset !== info.lastAugReset || !(Date.now() - Date.parse(x.at) < 15 * 60e3) || !h || !(h.cost > 0) || h.batch !== true) return null
      return { buy: h.buy === true, approvedCost: h.cost, why: `exit-sim: ${h.why}`, decidedBy: 'exit-sim' }
    } catch {
      return null
    }
  })()
  const v = exitV ?? (batch.items.length ? { buy: true, approvedCost: batch.cost, why: `every item adds money at the install (${life.hours.toFixed(2)}h, ${capital ? 'trader compounding' : 'no trader record'}); no fresh exit verdict on the batch`, decidedBy: 'batch-dominance' } : { buy: false, why: batch.stoppedBy ?? 'empty batch', decidedBy: 'batch-dominance' })
  // The prefix the verdict covers (the batch moves a little between passes).
  const prefix = []
  let prefixCost = 0
  if (v.buy) {
    for (const it of batch.items) {
      if (prefixCost + it.cost > v.approvedCost * 1.02) break
      prefix.push(it)
      prefixCost += it.cost
    }
  }
  const claims = claimsOf(ns, info)
  const payback = prefix.length && life.hours !== null ? { payback: { moneyReturn: { cost: prefixCost, gainPerSec: prefix.reduce((a, x) => a + x.gainPerSec, 0), horizonSec: life.hours * 3600 } } } : {}
  const opts = exitV?.buy ? { exitApproved: true, ...payback } : payback
  const free = spendable('hacknet', money, claims, opts)
  // ONE RAISE for the whole approved prefix (nodeecon: wealth decides, cash
  // pays); only an exit-approved batch may sell the book.
  {
    fetchFromHome(ns, STOCK_FILE)
    const stock = stockRecordFromText(ns.read(STOCK_FILE), info.lastAugReset)
    const req = exitV?.buy && prefixCost > free ? raiseRequestFor({ cash: money, equity: stock.ok ? stock.equity : 0, target: reserveFor('hacknet', claims, opts) + prefixCost, by: 'hacknet', why: `hacknet batch the exit simulation approved: ${prefix.length} purchases, $${Math.round(prefixCost)}`, lastAugReset: info.lastAugReset }) : null
    ns.write(raiseFileOf('hacknet'), JSON.stringify(req ?? { at: new Date().toISOString(), by: 'hacknet', target: 0, why: 'no raise needed' }), 'w')
    if (ns.getHostname() !== 'home') ns.scp(raiseFileOf('hacknet'), 'home', ns.getHostname())
  }
  // Buy in the batch's order while the cash lasts; a purchase the game
  // refuses (read back from its return) ends the pass.
  let spent = 0
  let n = 0
  for (const it of prefix) {
    if (spent + it.cost > free) break
    if (!buy(ns, it)) break
    spent += it.cost
    n++
    state.bought++
    state.lastBuy = { at: new Date().toISOString(), ...it, batch: true }
    if (n % 50 === 0) await ns.sleep(0)
  }
  const cache = cacheOffer(ns, info, t, base.hashCap, spendable('hacknet', money - spent, claims, {}))
  if (cache?.buy && buy(ns, cache)) {
    state.bought++
    state.lastBuy = { at: new Date().toISOString(), ...cache }
  }
  const st = pacer.stats
  publish(ns, {
    ...base,
    bought: state.bought,
    lastBuy: state.lastBuy,
    phase: 'claimant',
    best: batch.items[0] ?? null,
    batch: { n: batch.items.length, cost: batch.cost, gainPerSec: batch.gainPerSec, hashGainPerSec: batch.hashGainPerSec, netAtW: batch.netAtW, stoppedBy: batch.stoppedBy, W: life.hours, capital: capital ? 'trader' : null, first: batch.items.slice(0, 8).map(({ kind, index, cost, gainPerSec, netAtW }) => ({ kind, index, cost, gainPerSec, netAtW })) },
    pass: { planned: batch.items.length, approved: prefix.length, boughtNow: n, spentNow: spent, cpuMs: Math.round(st.cpuMs), maxBlockMs: +st.maxBlockMs.toFixed(1), yields: st.yields },
    remainingLifeH: life.hours,
    verdict: v,
    spendable: free,
    affordable: prefixCost <= free,
    cache,
    claims: { join: claims.join, augmentations: claims.augmentations, home: typeof claims.home === 'object' ? claims.home.amount : claims.home },
  })
  return { again: n < prefix.length && exitV?.buy === true }
}

/**
 * ONE SERVER-MODE PASS ON THE BLADEBURNER ROUTE (committedRouteOf 'blade').
 *
 * The money-at-install batch above values a hash at the $250k sell floor and
 * an upgrade by the money it adds before the install — on this route the
 * hashes buy rank and skill points on the black-op exit, and live BN7.1
 * 2026-10-10 it refused every purchase ("no purchase adds money at the
 * install") while the 256-hash cache could never bank the second rank
 * exchange (500 hashes). Here each purchase — server, level, RAM, cores and
 * CACHE — is priced as the joint trajectory (hashplan.planRouteHacknetBatch:
 * capacity -> hash rate -> the escalating exchanges -> exit hours) with it
 * minus without it, from the exchange prices progress.js published on the
 * route's own start. The money's alternative use on the route: with a money
 * leg on the exit (committedRouteOf moneyLegs) it is unpriced here, and
 * nothing is bought; with none, the money moves the black-op exit only
 * through these purchases. The claims budget.js keeps stand (the route's
 * exit-sim approval waives the augmentation and home claims, never the join's).
 *
 * Publishes `route` with the best purchase's exit-hours per dollar, unbudgeted
 * (an upper bound): hashspend.js prices a hash SALE's money with it.
 */
async function routeBatchPass(ns, { info, t, mults, nodeMoney, money, base, state, plan, route }) {
  const br = plan?.decisions?.bladeRoute ?? null
  const exchange = exchangeOf(plan, { node: info.currentNode })
  fetchFromHome(ns, HASHSPEND_FILE)
  let hs = null
  try {
    hs = JSON.parse(ns.read(HASHSPEND_FILE) || 'null')
  } catch {
    hs = null
  }
  const hsOk = !!hs && hs.lastAugReset === info.lastAugReset && Date.now() - Date.parse(hs.at) < 10 * 60e3
  const levels = hsOk && hs.exchangeLevels && typeof hs.exchangeLevels.rank === 'number' && typeof hs.exchangeLevels.sp === 'number' ? hs.exchangeLevels : null
  const hashes = hsOk && typeof hs.hashes === 'number' ? hs.hashes : 0
  const horizonH = bladeHashHorizonH(br)
  const claims = claimsOf(ns, info)
  const free = spendable('hacknet', money, claims, { exitApproved: true })
  const legs = Array.isArray(route.moneyLegs) ? route.moneyLegs.filter(Boolean) : []
  const servers = t.list.map((x) => ({ level: x.level, ram: x.ram, cores: x.cores, ramUsed: x.ramUsed, cache: x.cache }))
  const refuse = typeof exchange.baseH !== 'number' ? `the exchanges are unpriced: ${exchange.why}` : !levels ? 'no fresh exchange levels from hashspend.js' : !(horizonH > 0) ? 'no exit horizon on the route' : legs.length ? `the black-op exit reads money (${legs.join('; ')}): the money's alternative use is unpriced here, so no hacknet purchase is priced against it` : null
  const plan1 = (budget, maxItems) => planRouteHacknetBatch({ servers, mults, nodeMoney, hashes, exchange, levels, horizonH, budget, maxItems })
  const batch = refuse ? { items: [], cost: 0, deltaH: 0, baseGainH: null, stoppedBy: refuse } : plan1(free, 200)
  // THE MARGINAL DOLLAR (what a hash sale's money buys here, for hashspend.js):
  // the best purchase the budget left unbought, priced on the fleet after the
  // batch — and only when the claims leave money at all (free > 0); below the
  // reserve a sale's money fills the claims and buys nothing on this exit.
  const top = refuse ? null : planRouteHacknetBatch({ servers: batch.servers ?? servers, mults, nodeMoney, hashes, exchange, levels, horizonH, budget: Infinity, maxItems: 1 })
  const best = top?.items?.[0] ?? null
  const perDollarH = best && free > 0 ? best.deltaH / best.cost : 0
  // No book is sold for a route purchase (no raise): the cash the claims leave pays.
  ns.write(raiseFileOf('hacknet'), JSON.stringify({ at: new Date().toISOString(), by: 'hacknet', target: 0, why: 'no raise needed (Bladeburner route: purchases from free cash only)' }), 'w')
  if (ns.getHostname() !== 'home') ns.scp(raiseFileOf('hacknet'), 'home', ns.getHostname())
  let spent = 0
  let n = 0
  for (const it of batch.items) {
    if (spent + it.cost > free) break
    if (!buy(ns, it)) break
    spent += it.cost
    n++
    state.bought++
    state.lastBuy = { at: new Date().toISOString(), ...it, route: 'blade' }
    if (n % 50 === 0) await ns.sleep(0)
  }
  const v = refuse ? { buy: false, why: refuse, decidedBy: 'route-unpriced' } : batch.items.length ? { buy: true, approvedCost: batch.cost, why: `${batch.items.length} purchase(s), $${Math.round(batch.cost)}: the black-op exit ${(batch.deltaH * 60).toFixed(2)} min through the hashes they add (rank/SP exchanges over ${horizonH.toFixed(2)}h)`, decidedBy: 'route-exit-sim' } : { buy: false, why: `${batch.stoppedBy}${best ? ` within the $${Math.round(free)} the claims leave (next unbought: ${best.kind} $${Math.round(best.cost)}, ${(best.deltaH * 60).toFixed(2)} min)` : ''}`, decidedBy: 'route-exit-sim' }
  publish(ns, {
    ...base,
    bought: state.bought,
    lastBuy: state.lastBuy,
    phase: 'claimant',
    route: { key: route.key, exitH: route.exitH, horizonH, why: route.why, moneyLegs: legs, exchange: typeof exchange.baseH === 'number' ? { at: exchange.at, rankPerPurchaseH: exchange.rank.perPurchaseH, spPerPurchaseH: exchange.sp.perPurchaseH } : { why: exchange.why }, levels, hashes, baseGainH: batch.baseGainH, best, perDollarH, perDollarWhy: !best ? 'no unbought purchase shortens the exit' : free > 0 ? 'the best purchase the budget left unbought' : 'the claims leave no money: a sale fills them and buys nothing here' },
    best: batch.items[0] ?? null,
    batch: { n: batch.items.length, cost: batch.cost, deltaH: batch.deltaH, stoppedBy: batch.stoppedBy, first: batch.items.slice(0, 8) },
    pass: { planned: batch.items.length, approved: batch.items.length, boughtNow: n, spentNow: spent },
    remainingLifeH: horizonH,
    verdict: v,
    spendable: free,
    affordable: batch.cost <= free,
    cache: { buy: false, why: 'Bladeburner route: cache is priced in the route batch' },
    claims: { join: claims.join, augmentations: claims.augmentations, home: typeof claims.home === 'object' ? claims.home.amount : claims.home },
  })
  return { again: false }
}

export async function main(ns) {
  ns.disableLog('ALL')
  const note = reporter(ns, STATUS, {})
  ns.atExit(() => note.exit('stopped', { detail: 'hacknet.js exited — killed, threw, or an install took it' }), 'status')

  const info = ns.getResetInfo()
  // Servers or nodes is a property of the save for the whole life (the
  // Source-File set and the node cannot change without killing this script).
  const servers = hasHacknetServers(info)
  const nodeMoney = bitNodeMults(info)?.HacknetNodeMoney
  let bought = 0
  let lastBuy = null

  while (true) {
    try {
      const t = totals(ns)
      const done = t.levels >= NEED.levels && t.ram >= NEED.ram && t.cores >= NEED.cores
      const money = ns.getServerMoneyAvailable('home')
      const mults = ns.getPlayer().mults
      // Hacknet production AS MONEY, for progress.js's exit inputs
      // (lifeIncome): a node's $/s as the game reports it; a server's hashes
      // at the sell floor, which is what they are worth at the least.
      const moneyPerSec = servers ? t.productionPerSec * DOLLARS_PER_HASH : t.productionPerSec
      const serverFields = servers ? serverReport(ns, t, mults, nodeMoney) : {}
      const base = { at: new Date().toISOString(), lastAugReset: info.lastAugReset, nodes: t.nodes, levels: t.levels, ram: t.ram, cores: t.cores, need: NEED, done, productionPerSec: t.productionPerSec, moneyPerSec, bought, lastBuy, ...serverFields }

      if (!done) {
        // PHASE 1: the invitation, bought at a tenth of cash so it never
        // starves a real spender — these are hundreds of thousands of dollars.
        publish(ns, { ...base, phase: 'netburners' })
        if (servers) {
          // SERVERS: the cheapest purchase per unit of a short total. The
          // node rule below ("buy 8 nodes") would pay 50k x 3.2^n per server
          // — the eighth alone $172m — where one server's RAM doublings close
          // the RAM total for ~$2.3m (the BN9 entry server is already at
          // level 100 / 10 cores).
          const step = netburnersServerStep(t.list, NEED, mults)
          if (step?.best && step.best.cost < money / 10 && buy(ns, step.best)) {
            bought++
            lastBuy = { at: new Date().toISOString(), ...step.best, for: 'netburners' }
            await ns.sleep(100)
            continue
          }
          await ns.sleep(10000)
          continue
        }
        if (t.nodes < 8 && ns.hacknet.getPurchaseNodeCost() < money / 10) {
          ns.hacknet.purchaseNode()
          await ns.sleep(100)
          continue
        }
        let did = false
        for (let i = 0; i < t.nodes; i++) {
          if (t.levels < NEED.levels && ns.hacknet.getLevelUpgradeCost(i, 10) < money / 10) {
            ns.hacknet.upgradeLevel(i, 10)
            did = true
            break
          }
          if (t.ram < NEED.ram && ns.hacknet.getRamUpgradeCost(i, 1) < money / 10) {
            ns.hacknet.upgradeRam(i, 1)
            did = true
            break
          }
          if (t.cores < NEED.cores && ns.hacknet.getCoreUpgradeCost(i, 1) < money / 10) {
            ns.hacknet.upgradeCore(i, 1)
            did = true
            break
          }
        }
        await ns.sleep(did ? 100 : 10000)
        continue
      }

      // PHASE 2 WITH SERVERS: THE BATCH. Every purchase that adds money at
      // the install point, taken by value per dollar
      // (hacknetplan.planHacknetBatchGen, the trader's compounding on both
      // sides), bought in ONE pass on ONE sized raise — not one purchase per
      // 30s cycle each waiting on its own verdict and raise (live 2026-09-28:
      // 2 upgrades in 10 minutes against a batch of hundreds).
      if (servers) {
        const state = { bought, lastBuy }
        const r = await serverBatchPass(ns, { info, t, mults, nodeMoney, money, base, state })
        bought = state.bought
        lastBuy = state.lastBuy
        await ns.sleep(r.again ? 5000 : 30000)
        continue
      }
      // PHASE 2 WITH NODES: the claimant, one purchase at a time, priced in
      // dollars directly.
      const plan = bestUpgrade(t.list, mults, nodeMoney)
      const life = remainingLifeH(ns, info.lastAugReset)
      // THE EXIT VERDICT (installgate spendExit.hacknet): the node's exit with
      // this upgrade against without, from progress.js. Used when it is this
      // life's, fresh, and priced the same upgrade (within 1%). Otherwise the
      // payback rule below, named as the fallback it is.
      fetchFromHome(ns, GATE_FILE)
      const exitV = (() => {
        try {
          const g = JSON.parse(ns.read(GATE_FILE) || 'null')
          const x = g?.spendExit
          const h = x?.hacknet
          if (!x || x.lastAugReset !== info.lastAugReset || !(Date.now() - Date.parse(x.at) < 15 * 60e3) || !h || !(h.cost > 0) || !plan.best) return null
          if (Math.abs(h.cost / plan.best.cost - 1) > 0.01) return null
          return { buy: h.buy === true, why: `exit-sim: ${h.why}`, decidedBy: 'exit-sim' }
        } catch {
          return null
        }
      })()
      const v = exitV ?? (life.hours === null ? { buy: false, why: life.why, decidedBy: 'payback-fallback' } : { ...verdict(plan.best, life.hours), decidedBy: 'payback-fallback' })
      // What budget.js leaves after the join, augmentation and home claims.
      // Unreadable claims fail closed to "nothing spendable" — see budget.js.
      const claims = {
        join: joinClaim(ns.read(GATE_FILE), info.lastAugReset),
        augmentations: augClaim(ns.read(GATE_FILE), info.lastAugReset),
        home: (() => {
          const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores, bitNodeMults(info)?.HomeComputerRamCost)
          if (!up) return 0
          const ram = ns.getServerMaxRam('home')
          return { amount: up.cost, deltaGB: up.kind === 'RAM' ? ram : ram / 16 }
        })(),
      }
      // Through the HOME claim only when the purchase returns more than it
      // costs before the install (budget.js's money-return exception); the
      // join and augmentation claims are never waived.
      // An exit verdict already re-planned the augmentations on the money this
      // leaves, so it may spend through the augmentation and home claims —
      // never the join's (budget.js exitApproved).
      // Both, when both hold: the exit waiver for the augmentation and home
      // claims, and the money return (payback inside the life) for the home
      // and — while the join money is not yet in hand — the join claim.
      const payback = plan.best && life.hours !== null ? { payback: { moneyReturn: { cost: plan.best.cost, gainPerSec: plan.best.gainPerSec, horizonSec: life.hours * 3600 } } } : {}
      const opts = exitV?.buy ? { exitApproved: true, ...payback } : payback
      const free = spendable('hacknet', money, claims, opts)
      const affordable = plan.best ? plan.best.cost <= free : false
      // AN APPROVED UPGRADE THE BOOK MUST FUND (nodeecon: wealth decides, cash
      // pays): the exit verdict priced it on cash + the trader's equity, so a
      // cash shortfall asks act.js for a sized raise. The payback fallback is
      // unpriced and never sells the book.
      {
        fetchFromHome(ns, STOCK_FILE)
        const stock = stockRecordFromText(ns.read(STOCK_FILE), info.lastAugReset)
        const req = exitV?.buy && plan.best && !affordable ? raiseRequestFor({ cash: money, equity: stock.ok ? stock.equity : 0, target: reserveFor('hacknet', claims, opts) + plan.best.cost, by: 'hacknet', why: `hacknet upgrade the exit simulation approved ($${Math.round(plan.best.cost)})`, lastAugReset: info.lastAugReset }) : null
        ns.write(raiseFileOf('hacknet'), JSON.stringify(req ?? { at: new Date().toISOString(), by: 'hacknet', target: 0, why: 'no raise needed' }), 'w')
        if (ns.getHostname() !== 'home') ns.scp(raiseFileOf('hacknet'), 'home', ns.getHostname())
      }
      const cache = null
      publish(ns, {
            ...base,
            phase: 'claimant',
            best: plan.best ?? null,
            considered: plan.considered ?? 0,
            planWhy: plan.why ?? null,
            remainingLifeH: life.hours,
            verdict: v,
            spendable: free,
            affordable,
            cache,
            claims: { join: claims.join, augmentations: claims.augmentations, home: typeof claims.home === 'object' ? claims.home.amount : claims.home },
      })
      if (v.buy && affordable && buy(ns, plan.best)) {
        bought++
        lastBuy = { at: new Date().toISOString(), ...plan.best }
        await ns.sleep(200)
        continue
      }
      await ns.sleep(30000)
    } catch (err) {
      ns.print(`hacknet error: ${err}`)
      // Say so: a frozen report reads as "nothing worth buying", and in server
      // mode it also freezes the ramPolicy batch.js and seed.js obey (they
      // fail closed on its staleness, so the hashes stay safe).
      try {
        publish(ns, { at: new Date().toISOString(), lastAugReset: info.lastAugReset, phase: 'error', why: String(err).slice(0, 300) })
      } catch {
        /* nothing left to try */
      }
      await ns.sleep(10000)
    }
  }
}
