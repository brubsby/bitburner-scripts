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
import { bestUpgrade, verdict, remainingLife, bestServerUpgrade, netburnersServerStep, ramPolicy, hashRate, cacheCost, hashCapacityOf, DOLLARS_PER_HASH } from 'hacknetplan.js'
import { spendable, reserveFor, augClaim, joinClaim } from 'budget.js'
import { stockRecordFromText, raiseRequestFor, raiseFileOf, STOCK_FILE } from 'nodeecon.js'
import { nextHomeUpgrade } from 'homecost.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { hasHacknetServers } from 'sfgate.js'

const NEED = { levels: 100, ram: 8, cores: 4 }
const STATUS = '/tel/hacknet.txt'
const GATE_FILE = '/tel/installgate.txt'
const SCHEDULE = '/tel/factionplan.txt'
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
  return remainingLife({
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
      return ns.hacknet.upgradeCache(best.index, 1)
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

export async function main(ns) {
  ns.disableLog('ALL')
  const note = reporter(ns, STATUS, {})
  ns.atExit(() => note.exit('stopped', { detail: 'hacknet.js exited — killed, threw, or an install took it' }), 'status')

  const info = ns.getResetInfo()
  // Servers or nodes is a property of the save for the whole life (the
  // Source-File set and the node cannot change without killing this script).
  const servers = hasHacknetServers(info)
  const nodeMoney = bitNodeMults(info.currentNode)?.HacknetNodeMoney
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

      // PHASE 2: the claimant. Nodes are priced in dollars directly; servers
      // in dollars at the hash sell floor (hacknetplan.bestServerUpgrade), so
      // everything below — exit verdict, payback, budget — is shared.
      const plan = servers ? bestServerUpgrade(t.list, mults, nodeMoney, DOLLARS_PER_HASH) : bestUpgrade(t.list, mults, nodeMoney)
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
          const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores, bitNodeMults(info.currentNode)?.HomeComputerRamCost)
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
      const opts = exitV?.buy ? { exitApproved: true } : plan.best && life.hours !== null ? { payback: { moneyReturn: { cost: plan.best.cost, gainPerSec: plan.best.gainPerSec, horizonSec: life.hours * 3600 } } } : {}
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
      const cache = servers ? cacheOffer(ns, info, t, serverFields.hashCap, spendable('hacknet', money, claims, {})) : null
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
      if (cache?.buy && buy(ns, cache)) {
        bought++
        lastBuy = { at: new Date().toISOString(), ...cache }
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
