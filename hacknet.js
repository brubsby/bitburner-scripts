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
// Hacknet SERVERS (BN9 / SF9) are a different economy — hashes — and this
// file refuses phase 2 there rather than pricing hashes as dollars.

import { reporter } from 'status.js'
import { bestUpgrade, verdict, remainingLife } from 'hacknetplan.js'
import { spendable, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { hasHacknetServers } from 'sfgate.js'

const NEED = { levels: 100, ram: 8, cores: 4 }
const STATUS = '/tel/hacknet.txt'
const GATE_FILE = '/tel/installgate.txt'
const SCHEDULE = '/tel/factionplan.txt'
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
    nodes.push({ level: s.level, ram: s.ram, cores: s.cores, production: s.production })
  }
  return { nodes: n, levels, ram, cores, list: nodes, productionPerSec: nodes.reduce((a, b) => a + (b.production ?? 0), 0) }
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
    default:
      return false
  }
}

export async function main(ns) {
  ns.disableLog('ALL')
  const note = reporter(ns, STATUS, {})
  ns.atExit(() => note.exit('stopped', { detail: 'hacknet.js exited — killed, threw, or an install took it' }), 'status')

  const info = ns.getResetInfo()
  let bought = 0
  let lastBuy = null

  while (true) {
    try {
      const t = totals(ns)
      const done = t.levels >= NEED.levels && t.ram >= NEED.ram && t.cores >= NEED.cores
      const money = ns.getServerMoneyAvailable('home')
      const base = { at: new Date().toISOString(), lastAugReset: info.lastAugReset, nodes: t.nodes, levels: t.levels, ram: t.ram, cores: t.cores, need: NEED, done, productionPerSec: t.productionPerSec, bought, lastBuy }

      if (!done) {
        // PHASE 1: the invitation, bought at a tenth of cash so it never
        // starves a real spender — these are hundreds of thousands of dollars.
        publish(ns, { ...base, phase: 'netburners' })
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

      // PHASE 2: the claimant.
      if (hasHacknetServers(info)) {
        publish(ns, { ...base, phase: 'refused', why: 'hacknet servers (hashes) are not priced by hacknetplan.js' })
        await ns.sleep(60000)
        continue
      }
      const nodeMoney = bitNodeMults(info.currentNode)?.HacknetNodeMoney
      const mults = ns.getPlayer().mults
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
          const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
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
      await ns.sleep(10000)
    }
  }
}
