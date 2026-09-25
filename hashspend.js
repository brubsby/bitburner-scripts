// The hash spender: every hash goes where the simulated exit says it is worth
// the most — an upgrade, or the $250k it sells for.
//
//   run hashspend.js          (boot.js places it 'anywhere'; idempotent)
//
// Hashes exist only with hacknet SERVERS (sfgate.hasHacknetServers: BitNode 9,
// or any node with Source-File 9). Everywhere else this publishes
// `capability-absent` at its 3.25GB floor and returns — it never reserves the
// hash API's RAM in a node that cannot call it.
//
// THE DECISION is hashplan.decideHashSpend: for each upgrade, the node's exit
// with it bought now against the exit with the same hashes SOLD now, on
// progress.js's published exit inputs (/tel/exitinputs.txt). No fixed goal
// list, no "always sell", no "always boost the target". See hashplan.js for
// where each upgrade's effect sits in the trajectory and what is not
// simulated (and therefore never bought).
//
// WHAT THIS READS, all telemetry files written on home and PULLED here first
// (it runs anywhere; ns.read is local — invariant C10):
//   /tel/exitinputs.txt   the trajectory (progress.js)
//   /tel/batch.txt        the batcher's targets, their $/s, thread plan, RAM use
//   /tel/installgate.txt  the Covenant campaign, when one is running
//   /tel/sleeve.txt       the fleet's study exp (at study multiplier 1)
//   /tel/ctauto.txt       whether contracts are being solved at all
// and from the game: hash count/capacity/costs, the study/training
// multipliers, each target's required level, min security, growth and max
// money, and the h/g/w worker prices.
//
// Publishes /tel/hashspend.txt: the decision with every simulated exit, what
// was skipped and why, and what was actually done — read back from the game
// (the hash count after the spend), not from the call's return alone.

// RAMOVERRIDE 3.25GB (= base 1.6 + getResetInfo 1.0 + getHostname 0.05 + scp 0.6: the capability-absent path publishes and mirrors home, and a call past the allocation KILLS the script, NetscriptHelpers.tsx:498) — excludes: the ns.hacknet hash surface (numHashes / hashCapacity / hashCost / spendHashes / getStudyMult / getTrainingMult, 0.5GB each), ns.getPlayer, the target reads (getServerRequiredHackingLevel / getServerMinSecurityLevel / getServerGrowth / getServerMaxMoney), ns.getScriptRam — unreachable until sfgate.hasHacknetServers(ns.getResetInfo()) is true, and raised through ramgrow.js to RAISE_CEILING before the first of them.

import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'
import { hasHacknetServers, totalSfLevels } from 'sfgate.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { bestExitPolicy, spendRuns } from 'exitplan.js'
import { decideHashSpend, batchIncomeRatio, minSecAfter, maxMoneyAfter, NOT_SIMULATED } from 'hashplan.js'
import { expectedReward } from 'contractplan.js'
import { covenantActive, COVENANT } from 'sleeveplan.js'

const STATUS = '/tel/hashspend.txt'
const LOOP_MS = 30000
/** How many of the batcher's targets are priced for the two server upgrades. */
const TARGETS = 2
/**
 * This file's full static price. No Singularity surface, so it does not move
 * with the Source-File 4 level; kept in the RAISE_CEILING(mult) shape that
 * tools/test/ramoverride.test.mjs [R5] evaluates per regime. Measured with
 * the game's own calculator (tools/test/ram.mjs priceCode).
 */
const RAISE_CEILING = (mult) => 7.25 + 0 * mult

const fin = (x) => typeof x === 'number' && isFinite(x)

export async function main(ns) {
  ns.ramOverride(3.25)
  ns.disableLog('ALL')
  const errors = []
  const note = reporter(ns, STATUS, () => ({ errors: errors.slice(-5) }))
  // Placed off home: the daemon only mirrors /tel/* from home (invariant C12).
  const mirror = () => {
    try {
      if (ns.getHostname() !== 'home') ns.scp(STATUS, 'home', ns.getHostname())
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }
  const say = (health, fields) => {
    note(health, fields)
    mirror()
  }
  ns.atExit(() => {
    note.exit('stopped', { detail: 'hashspend.js exited — killed, threw, or an install took it' })
    mirror()
  })

  const info = ns.getResetInfo()
  if (!hasHacknetServers(info)) {
    say('waiting', {
      result: 'capability-absent',
      lastAugReset: info.lastAugReset,
      bitNode: info.currentNode,
      detail: 'no hacknet servers in this save (sfgate.hasHacknetServers: BitNode 9 or Source-File 9, and the disableHacknetServer option off). Nothing produces hashes, so there is nothing to spend; staying at the 3.25GB floor.',
    })
    return
  }
  if (!(await raiseRam(ns, RAISE_CEILING(1), STATUS, 'hashspend.js needs its full allocation before the first hash call'))) return

  while (true) {
    try {
      say('ok', pass(ns, info))
    } catch (err) {
      ns.print(record(errors, err))
      try {
        say('error', { lastAugReset: info.lastAugReset, detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
    }
    await ns.sleep(LOOP_MS)
  }
}

function pull(ns, file) {
  if (ns.getHostname() === 'home') return
  try {
    ns.scp(file, ns.getHostname(), 'home')
  } catch {
    /* the previous copy stays; its own stamp decides freshness */
  }
}

function readJson(ns, file) {
  try {
    return JSON.parse(ns.read(file) || 'null')
  } catch {
    return null
  }
}

const freshWithin = (rec, ms) => !!rec && Date.now() - Date.parse(rec.at) < ms

/** One pass: build the options, decide, act, and return the published body. */
function pass(ns, info) {
  for (const f of ['/tel/exitinputs.txt', '/tel/batch.txt', '/tel/installgate.txt', '/tel/sleeve.txt', '/tel/ctauto.txt']) pull(ns, f)
  const record0 = readJson(ns, '/tel/exitinputs.txt')
  const batch = readJson(ns, '/tel/batch.txt')
  const gate = readJson(ns, '/tel/installgate.txt')
  const sleeve = readJson(ns, '/tel/sleeve.txt')
  const ct = readJson(ns, '/tel/ctauto.txt')
  const hashes = ns.hacknet.numHashes()
  const capacity = ns.hacknet.hashCapacity()
  const player = ns.getPlayer()
  const options = []
  const skipped = Object.entries(NOT_SIMULATED).map(([name, why]) => ({ name, why }))
  const finalWindow = record0?.finalWindow === true

  // --- the batcher's targets: Increase Maximum Money / Reduce Minimum Security
  const targets = freshWithin(batch, 5 * 60e3) && Array.isArray(batch.targets) ? batch.targets : null
  if (!targets) skipped.push({ name: 'Increase Maximum Money / Reduce Minimum Security', why: 'no fresh /tel/batch.txt: no target income to scale' })
  else {
    const uptime = batch.uptimeSec
    const ramBound = fin(batch.ram?.utilPct) && batch.ram.utilPct >= 80
    const ram = { h: ns.getScriptRam('h.js', 'home') || 1.7, g: ns.getScriptRam('g.js', 'home') || 1.75, w: ns.getScriptRam('w.js', 'home') || 1.75 }
    const priced = targets
      .filter((t) => t?.host && t.earned > 0 && fin(uptime) && uptime > 0)
      .map((t) => ({ t, incomePerSec: t.earned / uptime }))
      .sort((a, b) => b.incomePerSec - a.incomePerSec)
      .slice(0, TARGETS)
    if (!priced.length) skipped.push({ name: 'Increase Maximum Money / Reduce Minimum Security', why: 'no batcher target has earned yet' })
    const who = { hacking: player.skills.hacking, mults: player.mults }
    for (const { t, incomePerSec } of priced) {
      const host = t.host
      const before = { required: ns.getServerRequiredHackingLevel(host), minSec: ns.getServerMinSecurityLevel(host), serverGrowth: ns.getServerGrowth(host), moneyMax: ns.getServerMaxMoney(host) }
      const mm = batchIncomeRatio(t.plan, before, { ...before, moneyMax: maxMoneyAfter(before.moneyMax, 1) }, who, { ramBound, ram })
      if (fin(mm)) options.push({ name: 'Increase Maximum Money', target: host, cost: ns.hacknet.hashCost('Increase Maximum Money', 1), effect: { incomePerSec: incomePerSec * (mm - 1) }, why: `x${mm.toFixed(4)} on $${incomePerSec.toFixed(0)}/s` })
      else skipped.push({ name: 'Increase Maximum Money', target: host, why: 'the batch plan or the target is unreadable (prepping?)' })
      const ms = minSecAfter(before.minSec, 1)
      if (ms < before.minSec) {
        const r = batchIncomeRatio(t.plan, before, { ...before, minSec: ms }, who, { ramBound, ram })
        if (fin(r)) options.push({ name: 'Reduce Minimum Security', target: host, cost: ns.hacknet.hashCost('Reduce Minimum Security', 1), effect: { incomePerSec: incomePerSec * (r - 1) }, why: `x${r.toFixed(4)} on $${incomePerSec.toFixed(0)}/s (${ramBound ? 'RAM-bound' : 'pipeline-bound'})` })
        else skipped.push({ name: 'Reduce Minimum Security', target: host, why: 'the batch plan or the target is unreadable (prepping?)' })
      } else skipped.push({ name: 'Reduce Minimum Security', target: host, why: 'minimum security is already 1' })
    }
  }

  // --- exp and gym: only the final window carries them (an install resets exp)
  const studyMult = ns.hacknet.getStudyMult()
  const trainingMult = ns.hacknet.getTrainingMult()
  let baseEffect = null
  const fleetExp1 = freshWithin(sleeve, 10 * 60e3) && fin(sleeve.expToPlayerHacking) && sleeve.expToPlayerHacking > 0 ? sleeve.expToPlayerHacking : null
  if (!finalWindow) skipped.push({ name: 'Improve Studying', why: 'an install is coming: exp is reset by it, and before it study moves nothing the exit simulator sees' })
  else if (fleetExp1 === null) skipped.push({ name: 'Improve Studying', why: 'the fleet is not handing the player study exp (sleeve.txt expToPlayerHacking)' })
  else {
    // sleeve.js prices study at multiplier 1 (sleeveplan.js studyExp default),
    // and the game applies HashManager.getStudyMult on top (Work/Formulas.ts).
    baseEffect = { expPerSec: fleetExp1 * studyMult }
    options.push({ name: 'Improve Studying', target: null, cost: ns.hacknet.hashCost('Improve Studying', 1), effect: { expPerSec: fleetExp1 * (studyMult + 0.2) }, why: `fleet study exp x${studyMult.toFixed(2)} -> x${(studyMult + 0.2).toFixed(2)}` })
  }
  const cov = covenantActive(gate, info.lastAugReset)
  let covenant = null
  if (!finalWindow || !cov || cov.member || !(cov.combatH > 0)) skipped.push({ name: 'Improve Gym Training', why: !finalWindow ? 'an install is coming: gym exp is reset by it' : 'no Covenant combat leg is running — the only gym leg on the exit trajectory (other body legs are priced by joinplan, not the exit simulator)' })
  else {
    covenant = { cost: cov.cost, joinMoney: COVENANT.joinMoney, combatH: cov.combatH, member: false, sleeveExpPerSec: 0 }
    options.push({ name: 'Improve Gym Training', target: null, cost: ns.hacknet.hashCost('Improve Gym Training', 1), effect: { covenantHScale: trainingMult / (trainingMult + 0.2) }, why: `combat ${cov.combatH.toFixed(1)}h x${(trainingMult / (trainingMult + 0.2)).toFixed(3)}` })
  }

  // --- a coding contract: its expected money, only while ctauto.js solves
  if (!freshWithin(ct, 15 * 60e3)) skipped.push({ name: 'Generate Coding Contract', why: 'ctauto.js is not reporting: a generated contract would sit unsolved' })
  else {
    const sfLevels = totalSfLevels(info)
    const r = expectedReward({ totalSourceFileLevels: sfLevels, nodeContractMoney: bitNodeMults(info.currentNode)?.CodingContractMoney, hasHackingFaction: (player.factions?.length ?? 0) > 0, hasJob: Object.keys(player.jobs ?? {}).length > 0 })
    if (r && r.money > 0) options.push({ name: 'Generate Coding Contract', target: null, cost: ns.hacknet.hashCost('Generate Coding Contract', 1), effect: { money: r.money }, why: `expected $${r.money.toExponential(2)} (its ${r.factionRep.toFixed(0)} reputation is not simulated)` })
    else skipped.push({ name: 'Generate Coding Contract', why: 'no expected money (CodingContractMoney 0, or unreadable)' })
  }

  const decision = decideHashSpend({ hashes, capacity, record: record0, lastAugReset: info.lastAugReset, fns: { bestExitPolicy, spendRuns }, options, skipped, covenant, baseEffect })
  const did = act(ns, decision, hashes)
  return { result: 'decided', lastAugReset: info.lastAugReset, bitNode: info.currentNode, hashes, capacity, studyMult, trainingMult, decision, did }
}

/** Carry the decision out, and read the hash count back — the signal the call itself did not produce. */
function act(ns, d, before) {
  if (d.action === 'buy') {
    const ok = ns.hacknet.spendHashes(d.name, d.target ?? '', 1)
    const after = ns.hacknet.numHashes()
    return { action: 'buy', name: d.name, target: d.target ?? null, ok, hashesBefore: before, hashesAfter: after, confirmed: ok && before - after >= d.cost - 1e-6 }
  }
  if (d.action === 'sell' && d.count > 0) {
    const ok = ns.hacknet.spendHashes('Sell for Money', '', d.count)
    const after = ns.hacknet.numHashes()
    return { action: 'sell', count: d.count, ok, hashesBefore: before, hashesAfter: after, confirmed: ok && before - after >= 4 * d.count - 1e-6 }
  }
  return { action: d.action, why: d.why }
}
