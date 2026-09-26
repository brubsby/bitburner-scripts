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
// the rest of the node (installs never touch sleeves). This file gathers the
// offers and buys; the decision — the exit simulated with the batch against
// the exit without it — is progress.js sleeveAugExitOf (and covenantExitOf
// for another sleeve). Two passes: offers out, verdict back, purchase.
//
// Every input is telemetry another script already publishes; anything
// unreadable refuses (a guessed share or leg would buy on a stand-in).

import { canUseSleeve, sfLevel } from 'sfgate.js'
import { sleeveStudyExpPerSec, sleevesFromCovenant, covenantActive, covenantSleeveCost, COVENANT, COVENANT_MANDATE } from 'sleeveplan.js'
import { spendable, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
// Pure table (0GB): the node's HomeComputerRamCost, which the price carries.
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { reporter } from 'status.js'
import { spendExitFromRecord } from 'exitplan.js'
import { stockRecordFromText, raiseRequestFor, raiseFileOf, STOCK_FILE } from 'nodeecon.js'

const STATUS = '/tel/sleeveaug.txt'
const GATE_FILE = '/tel/installgate.txt'
const EXIT_INPUTS = '/tel/exitinputs.txt'
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
    // CASH vs WEALTH: a priced purchase the stock book must fund posts a raise
    // request and WAITS for act.js to serve it (the raise's hold lasts
    // RAISE_HOLD_MS, well inside the 10 minutes to this job's next run), then
    // decides again on the cash that landed.
    const first = decideAndBuy(ns, flags, note)
    if (first?.raise && !flags.dry) {
      ns.write(raiseFileOf('sleeveaug'), JSON.stringify(first.raise), 'w')
      const until = Date.now() + 150e3
      while (Date.now() < until && ns.getServerMoneyAvailable('home') < first.raise.target) await ns.sleep(5000)
      decideAndBuy(ns, flags, note)
    }
    ns.write(raiseFileOf('sleeveaug'), JSON.stringify({ at: new Date().toISOString(), by: 'sleeveaug', target: 0, why: 'no raise pending' }), 'w')
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
  const status = readJson(ns, '/tel/status.txt')
  const schedule = readJson(ns, '/tel/factionplan.txt')
  const stats = readJson(ns, '/tel/snap-augstats.txt')?.data?.stats
  if (!fresh(fleet) || !fresh(status)) return note('waiting', { result: 'stale', detail: `sleeve.txt or status.txt missing/stale — rates unknown` })
  if (fleet.disableSleeveExp !== false) return note('ok', { result: 'disabled', detail: `disableSleeveExpAndAugmentation is ${fleet.disableSleeveExp} — sleeve augs cannot be bought (or it is unknown)` })
  if (!stats || typeof stats !== 'object') return note('waiting', { result: 'no-stats', detail: '/tel/snap-augstats.txt unreadable — aug multipliers unknown' })

  // Budget: what the join, augmentation and home claims leave (budget.js).
  const home = (() => {
    const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores, bitNodeMults(info.currentNode)?.HomeComputerRamCost)
    return up ? up.cost : 0
  })()
  const gate = ns.read(GATE_FILE)
  // WEALTH decides, CASH pays (nodeecon.wealthOf): where stock.js holds the
  // book, cash is ~$0. Each purchase below is AFFORDED on cash + equity; when
  // only the book covers it, `cashFor` records the balance to raise and the
  // purchase waits for it (main posts the request to act.js).
  const stock = stockRecordFromText(ns.read(STOCK_FILE), info.lastAugReset)
  const equity = stock.ok ? stock.equity : 0
  const wealthNow = () => ns.getServerMoneyAvailable('home') + equity
  let raise = null
  const cashFor = (target, why) => {
    if (ns.getServerMoneyAvailable('home') >= target) return true
    const r = raiseRequestFor({ cash: ns.getServerMoneyAvailable('home'), equity, target, by: 'sleeveaug', why, lastAugReset: info.lastAugReset })
    if (r && (!raise || r.target > raise.target)) raise = r
    return false
  }
  let budget = spendable('sleeveaugs', wealthNow(), {
    join: joinClaim(gate, info.lastAugReset),
    augmentations: augClaim(gate, info.lastAugReset),
    home,
  })

  const decisions = []
  const bought = []

  // --- 1. ANOTHER SLEEVE, before any augmentation: the bigger purchase, and
  // the one the Covenant campaign (if the gate is holding for it) priced
  // ahead of the augmentation plan. See sleeveplan.js COVENANT.
  const another = (() => {
    const n = ns.sleeve.getNumSleeves()
    const from = sleevesFromCovenant(n, sfLevel(info, 10), info.currentNode)
    if (info.currentNode !== 10) return { buy: false, why: 'Covenant sleeves are sold only inside BitNode 10' }
    if (from === null || from >= COVENANT.maxSleeves) return { buy: false, why: from === null ? 'purchase count unreadable' : 'all Covenant sleeves bought' }
    if (!ns.getPlayer().factions.includes(COVENANT.faction)) return { buy: false, why: `not a ${COVENANT.faction} member (the body step trains for it only when the simulated exit with the campaign is faster)` }
    const cost = ns.sleeve.getSleeveCost()
    const money = wealthNow()
    let g = null
    try {
      g = JSON.parse(gate || 'null')
    } catch {
      g = null
    }
    const join = joinClaim(gate, info.lastAugReset)
    // THE MANDATE (sleeveplan.COVENANT_MANDATE, the user's decision): as a
    // member in its node, buy up to `target` whenever the money clears the
    // join claim, and one more (up to `opportunistic`) only when it does so
    // without holding for it — never a price this window cannot already pay.
    if (info.currentNode === COVENANT_MANDATE.node && from < COVENANT_MANDATE.opportunistic) {
      const room = num(join) ? money - join : null
      if (room === null) return { buy: false, why: 'join claim unreadable — not spending' }
      const why = from < COVENANT_MANDATE.target ? `mandated: sleeve #${from + 1} of ${COVENANT_MANDATE.target} (${COVENANT_MANDATE.decided})` : `opportunistic: sleeve #${from + 1} affordable now without holding`
      if (!(room >= cost)) return { buy: false, why: `${why} — $${ns.format.number(room)} of $${ns.format.number(cost)} free (cash + equity)` }
      return cashFor(join + cost, why) ? { buy: true, cost, why, more: true } : { buy: false, why: `${why} — affordable on cash + equity; raising $${ns.format.number(join + cost)} cash from the stock book first` }
    }
    // Only when the simulated exit WITH the campaign beats the one without
    // (progress.js covenantExitOf). That comparison already spent this price
    // before the rest of the window's money, so the sleeve goes first; the
    // join claim is still never touched.
    const campaign = covenantActive(g, info.lastAugReset)
    if (!campaign) return { buy: false, why: `the campaign is not on: ${g?.covenantExit?.why ?? 'no comparison published'}` }
    if (!(num(join) && money - join >= cost)) return { buy: false, why: `campaign on; cash + equity $${ns.format.number(money)} of $${ns.format.number(cost)} (+ join claim ${join})` }
    return cashFor(join + cost, campaign.why) ? { buy: true, cost, why: campaign.why } : { buy: false, why: `campaign on and affordable on cash + equity; raising $${ns.format.number(join + cost)} cash from the stock book first` }
  })()
  decisions.push({ sleeve: another })
  if (another.buy && !flags.dry) {
    // Under the mandate, as many as the money clears in one go (each is 10x
    // the last, so this is at most a few).
    for (let k = 0; k < COVENANT_MANDATE.opportunistic; k++) {
      const r = ns.sleeve.purchaseSleeve()
      if (!r?.success) {
        if (k === 0) decisions.push({ sleeve: 'refused', why: r?.message ?? 'purchaseSleeve failed' })
        break
      }
      bought.push(`Covenant sleeve #${sleevesFromCovenant(ns.sleeve.getNumSleeves(), sfLevel(info, 10), info.currentNode)}`)
      if (!another.more) break
      const n2 = sleevesFromCovenant(ns.sleeve.getNumSleeves(), sfLevel(info, 10), info.currentNode)
      if (n2 === null || n2 >= COVENANT_MANDATE.opportunistic) break
      const j2 = joinClaim(ns.read(GATE_FILE), info.lastAugReset)
      if (!(typeof j2 === 'number' && ns.getServerMoneyAvailable('home') - j2 >= ns.sleeve.getSleeveCost())) break
    }
  }

  // --- 1b. SLEEVE MEMORY (Covenant, BN10, members only). Memory sets the
  // sync a sleeve starts every LATER BitNode with (Sleeve.prestige: sync =
  // max(memory, 1)); it does nothing in this node. Cost per point
  // $1t x 1.02^(memory-1) (getMemoryUpgradeCost) — ~$305t for 1 -> 100.
  // Trajectory against trajectory (exitplan.spendExitFromRecord): the exit
  // with that money gone against not. Its value is all in later nodes, which
  // this cannot simulate — so it buys only when the in-node cost is under a
  // minute of exit (money not binding): free here, strictly positive later.
  // After the mandated sleeves, never before them. Otherwise the verdict and
  // its cost are published and nothing is bought.
  const memory = (() => {
    if (info.currentNode !== COVENANT_MANDATE.node) return { buy: [], why: 'memory is sold only inside BitNode 10' }
    if (!ns.getPlayer().factions.includes(COVENANT.faction)) return { buy: [], why: `not a ${COVENANT.faction} member` }
    const from = sleevesFromCovenant(ns.sleeve.getNumSleeves(), sfLevel(info, 10), info.currentNode)
    if (from === null || from < COVENANT_MANDATE.target) return { buy: [], why: 'the mandated sleeves come first' }
    const wants = []
    for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
      const m = ns.sleeve.getSleeve(i).memory
      if (typeof m === 'number' && m < 100) wants.push({ i, amount: 100 - m, cost: ns.sleeve.getMemoryUpgradeCost(i, 100 - m) })
    }
    if (!wants.length) return { buy: [], why: 'every sleeve is at memory 100' }
    const total = wants.reduce((t, w) => t + w.cost, 0)
    let rec = null
    try {
      rec = JSON.parse(ns.read(EXIT_INPUTS) || 'null')
    } catch {
      rec = null
    }
    const ex = spendExitFromRecord(rec, info.lastAugReset, total, 0)
    if (typeof ex.deltaH !== 'number') return { buy: [], total, why: `in-node cost unpriced (${ex.why}) — not buying` }
    const join = joinClaim(gate, info.lastAugReset)
    if (!(typeof join === 'number' && wealthNow() - join >= total)) return { buy: [], total, deltaH: ex.deltaH, why: 'cash + equity does not clear the join claim' }
    if (!(ex.deltaH < 1 / 60)) return { buy: [], total, deltaH: ex.deltaH, why: `costs this node ${ex.deltaH.toFixed(2)}h of exit — not free; later-node value is unsimulated, so this waits for a decision` }
    if (!cashFor(join + total, 'sleeve memory')) return { buy: [], total, deltaH: ex.deltaH, why: 'affordable on cash + equity; raising the cash from the stock book first' }
    return { buy: wants, total, deltaH: ex.deltaH, why: `$${ns.format.number(total)} costs this node ${(ex.deltaH * 60).toFixed(2)} min of exit; every later node starts these sleeves at sync 100` }
  })()
  decisions.push({ memory: { why: memory.why, total: memory.total ?? null, deltaH: memory.deltaH ?? null } })
  if (memory.buy.length && !flags.dry) {
    for (const w of memory.buy) {
      if (ns.sleeve.upgradeMemory(w.i, w.amount)?.success) bought.push(`sleeve ${w.i} memory +${w.amount}`)
      else break
    }
  }

  // --- 2. AUGMENTATIONS. This job gathers the offers; the DECISION is
  // progress.js's sleeveAugExitOf — the exit simulated after buying a batch
  // against the exit without it (CLAUDE.md: trajectories against
  // trajectories). It buys exactly the batch that comparison published, and
  // only while the comparison is this life's and fresh.
  let verdict = null
  try {
    const g = JSON.parse(gate || 'null')
    if (g && g.lastAugReset === info.lastAugReset && g.sleeveAugExit && Date.now() - Date.parse(g.sleeveAugExit.at) < 20 * 60e3) verdict = g.sleeveAugExit
  } catch {
    verdict = null
  }
  const join = joinClaim(gate, info.lastAugReset)
  const offers = []
  for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
    const sl = ns.sleeve.getSleeve(i)
    const task = fleet.assigned?.find((a) => a.i === i)?.task ?? null
    const objective = task === 'CLASS' ? 'exp' : task === 'FACTION' ? 'rep' : task
    const ownStudy = sleeveStudyExpPerSec(sl, 'Algorithms')?.perSec ?? null
    // Back to today's hacking exp at the sleeve's own study rate: its skill is
    // what its rep runs on, and a purchase zeroes the exp.
    const retrainHours = num(sl.exp?.hacking) && num(ownStudy) && ownStudy > 0 ? sl.exp.hacking / ownStudy / 3600 : null
    const augs = ns.sleeve.getSleevePurchasableAugs(i).map((a) => ({ name: a.name, cost: a.cost, mults: stats[a.name] ?? null }))
    offers.push({ i, task, objective, shock: sl.shock, retrainHours, augs: augs.filter((a) => a.mults), unpriced: augs.filter((a) => !a.mults).map((a) => a.name) })

    if (!verdict || verdict.i !== i || !verdict.buy?.length) continue
    if (sl.shock > 0) {
      decisions.push({ i, buy: [], why: `shock ${sl.shock.toFixed(2)} > 0 — the game refuses purchases until it is 0` })
      continue
    }
    const priced = verdict.buy.map((n) => augs.find((a) => a.name === n))
    if (priced.some((a) => !a)) {
      decisions.push({ i, buy: [], why: 'the published batch names an aug no longer offered — waiting for a fresh comparison' })
      continue
    }
    const total = priced.reduce((t, a) => t + a.cost, 0)
    if (!(num(join) && wealthNow() - join >= total)) {
      decisions.push({ i, buy: [], why: `batch $${ns.format.number(total)} would touch the join claim (${join}) — on cash + equity` })
      continue
    }
    if (!cashFor(join + total, `sleeve ${i} augmentation batch (sleeveAugExit)`)) {
      decisions.push({ i, buy: [], why: `batch $${ns.format.number(total)} affordable on cash + equity; raising the cash from the stock book first` })
      continue
    }
    decisions.push({ i, buy: verdict.buy, why: verdict.why })
    if (flags.dry) continue
    for (const a of priced) {
      if (ns.sleeve.purchaseSleeveAug(i, a.name)) {
        bought.push(`sleeve ${i}: ${a.name} ($${ns.format.number(a.cost)})`)
      } else {
        decisions.push({ i, refused: a.name, why: 'purchaseSleeveAug returned false (money, shock or availability changed)' })
        break
      }
    }
  }
  if (!verdict) decisions.push({ augs: 'no fresh sleeveAugExit comparison from progress.js yet' })
  else if (!verdict.buy?.length) decisions.push({ augs: verdict.why })

  note('ok', { result: bought.length ? 'bought' : raise ? 'raising' : 'nothing', bought, decisions, budget, raise, offers })
  return { raise }
}
