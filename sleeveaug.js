// Buys sleeve augmentations when they pay for themselves, then exits.
//
//   run sleeveaug.js          decide and buy
//   run sleeveaug.js --dry    decide only
//
// A watchdog JOB, not a daemon: the four ns.sleeve calls below are 4GB each
// (SleeveBase, not scaled by Source-File 4), paid only for the seconds this
// runs instead of forever on sleeve.js.
//
// Nothing bought these before, and they are the cheapest permanent purchase in
// the game: baseCost with no x1.9 escalation and no reputation spent, kept for
// the rest of the node (installs never touch sleeves). The pricing, the reset
// every purchase causes, and what is refused are in sleeveplan.js
// sleeveAugBatch. This file only gathers the inputs, asks, and buys.
//
// Every input is telemetry another script already publishes; anything
// unreadable refuses (a guessed share or leg would buy on a stand-in).

import { canUseSleeve } from 'sfgate.js'
import { sleeveAugBatch, sleeveStudyExpPerSec, expForLevel } from 'sleeveplan.js'
import { spendable, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
import { reporter } from 'status.js'

const STATUS = '/tel/sleeveaug.txt'
const GATE_FILE = '/tel/installgate.txt'
// A telemetry read older than this is not today's rate.
const FRESH_MS = 10 * 60 * 1000

const readJson = (ns, f) => {
  try {
    return JSON.parse(ns.read(f) || 'null')
  } catch {
    return null
  }
}
const fresh = (r) => r && Date.now() - Date.parse(r.at) < FRESH_MS
const num = (v) => typeof v === 'number' && isFinite(v)

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL')
  const flags = ns.flags([['dry', false]])
  const note = reporter(ns, STATUS, () => ({ dry: flags.dry }))
  let settled = false
  // Killed or thrown past: say so, with the last body kept (status.js).
  ns.atExit(() => {
    if (!settled) note.exit('stopped', { detail: 'sleeveaug.js stopped before finishing — purchases may be partial' })
  }, 'status')
  try {
    decideAndBuy(ns, flags, note)
    settled = true
  } catch (e) {
    settled = true
    note('error', { result: 'error', detail: String(e).slice(0, 200) })
  }
}

function decideAndBuy(ns, flags, note) {
  const info = ns.getResetInfo()
  if (!canUseSleeve(info)) return note('ok', { result: 'no-sleeves', detail: 'no Sleeve API (needs SF10 or BitNode 10)' })

  const fleet = readJson(ns, '/tel/sleeve.txt')
  const plan = readJson(ns, '/tel/sleeveplan.txt')
  const status = readJson(ns, '/tel/status.txt')
  const schedule = readJson(ns, '/tel/factionplan.txt')
  const stats = readJson(ns, '/tel/snap-augstats.txt')?.data?.stats
  if (!fresh(fleet) || !fresh(status)) return note('waiting', { result: 'stale', detail: `sleeve.txt or status.txt missing/stale — rates unknown` })
  if (fleet.disableSleeveExp !== false) return note('ok', { result: 'disabled', detail: `disableSleeveExpAndAugmentation is ${fleet.disableSleeveExp} — sleeve augs cannot be bought (or it is unknown)` })
  if (!stats || typeof stats !== 'object') return note('waiting', { result: 'no-stats', detail: '/tel/snap-augstats.txt unreadable — aug multipliers unknown' })

  // Budget: what the join, augmentation and home claims leave (budget.js).
  const home = (() => {
    const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
    return up ? up.cost : 0
  })()
  const gate = ns.read(GATE_FILE)
  let budget = spendable('sleeveaugs', ns.getServerMoneyAvailable('home'), {
    join: joinClaim(gate, info.lastAugReset),
    augmentations: augClaim(gate, info.lastAugReset),
    home,
  })

  const playerRep = num(schedule?.measuredBaseRepPerSec) && schedule.measuredBaseRepPerSec > 0 ? schedule.measuredBaseRepPerSec : num(schedule?.estimatedBaseRepPerSec) && schedule.estimatedBaseRepPerSec > 0 ? schedule.estimatedBaseRepPerSec : null
  const horizon = num(plan?.horizonHours) ? plan.horizonHours : null
  const decisions = []
  const bought = []

  for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
    const sl = ns.sleeve.getSleeve(i)
    const task = fleet.assigned?.find((a) => a.i === i)?.task ?? null
    if (sl.shock > 0) {
      decisions.push({ i, buy: [], why: `shock ${sl.shock.toFixed(2)} > 0 — the game refuses purchases until it is 0` })
      continue
    }
    const objective = task === 'CLASS' ? 'exp' : task === 'FACTION' ? 'rep' : task
    let sleeveShare = null
    let legHours = null
    let retrainHours = 0
    const ownStudy = sleeveStudyExpPerSec(sl, 'Algorithms')?.perSec ?? null
    if (objective === 'exp') {
      sleeveShare = num(ownStudy) && num(status.expPerSec) && status.expPerSec > 0 ? (ownStudy * sl.sync / 100) / status.expPerSec : null
      legHours = horizon
    } else if (objective === 'rep') {
      sleeveShare = num(fleet.factionRepPerSec) && playerRep ? fleet.factionRepPerSec / playerRep : null
      legHours = num(schedule?.totalHours) && horizon !== null ? Math.min(schedule.totalHours, horizon) : null
      // Back to today's hacking exp at the sleeve's own study rate. Its skill
      // is what the rep rate runs on, and the purchase zeroes the exp.
      retrainHours = num(sl.exp?.hacking) && num(ownStudy) && ownStudy > 0 ? sl.exp.hacking / ownStudy / 3600 : null
    }
    const candidates = ns.sleeve.getSleevePurchasableAugs(i).map((a) => ({ name: a.name, cost: a.cost, mults: stats[a.name] ?? null }))
    const unpriced = candidates.filter((a) => !a.mults).map((a) => a.name)
    const d = sleeveAugBatch({ candidates: candidates.filter((a) => a.mults), objective, share: sleeveShare, legHours, incomePerSec: status.incomePerSec, budget, retrainHours })
    decisions.push({ i, task, objective, share: sleeveShare, legHours, retrainHours, offered: candidates.length, unpriced, ...d })

    if (flags.dry) continue
    for (const a of d.buy) {
      if (ns.sleeve.purchaseSleeveAug(i, a.name)) {
        bought.push(`sleeve ${i}: ${a.name} ($${ns.format.number(a.cost)})`)
        budget -= a.cost
      } else {
        decisions.push({ i, refused: a.name, why: 'purchaseSleeveAug returned false (money, shock or availability changed)' })
        break
      }
    }
  }

  return note('ok', { result: bought.length ? 'bought' : 'nothing', bought, decisions, budget })
}
