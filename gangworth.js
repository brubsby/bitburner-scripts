// IS A GANG WORTH IT IN THIS BITNODE? Priced per node, not assumed.
//
// The gang route was measured once, in BitNode 4, where it won by 102h (63%).
// tools/sim/gang-vs-nogang.mjs says in its own header that the verdict does
// not transfer between nodes — prestigeSourceFile nulls Player.gang and zeroes
// karma, so every node pays its own ~36h grind and the gang must repay it
// INSIDE that node. Nothing enforced that, and the BitNode 4 answer was
// carried into BitNode 10 by default: four hours of Homicide were spent there
// reporting karma progress as progress before the question was re-asked.
//
// Re-asked, BitNode 10 answers 0.9h (1%), because the two nodes differ in the
// one term the gang exists to fix:
//
//                 ServerMaxMoney x ScriptHackMoney -> script income
//   BitNode 4     0.1125 x 0.2                        0.0225x
//   BitNode 10    1.0    x 0.5                        0.5x      (22x better)
//
// The gang wins where the batcher CANNOT fund the install ladder. Where it can,
// the gang shaves the reputation leg and little else — and the karma gate still
// costs a full work-slot grind to reach.
//
// THIS IS A CHEAP ESTIMATE, not the simulation. tools/sim/gang-vs-nogang.mjs
// runs exitplan.bestExitPolicy twice and is far too heavy for a game tick. This
// compares the same two quantities — hours saved by gang income against hours
// spent reaching the karma gate — from the node's own multipliers and the
// measured grind. It REFUSES rather than guessing when an input is missing,
// because the failure it replaces was an unexamined assumption, and a made-up
// number is just a faster way back to one.

const num = (v) => typeof v === 'number' && isFinite(v)

/**
 * HOW MANY HOURS THE GANG'S INCOME SAVES, priced the way
 * tools/sim/gang-vs-nogang.mjs prices it: the same exit policy search run
 * twice, once with the gang's money added to income and once without.
 *
 * This is the honest version of the number gangVerdict needs. The alternative
 * was a per-node constant — which is exactly how BitNode 4's answer ended up
 * governing BitNode 10, so it is not an alternative.
 *
 * `bestExitPolicy` searches installs-first policies and returns the cheapest,
 * so the delta is between two OPTIMISED trajectories rather than two fixed
 * ones. It REFUSES if either side cannot be priced: a one-sided answer would
 * be a difference against nothing.
 *
 * @param {function} bestExitPolicy exitplan.bestExitPolicy, injected so this
 *                                  module stays pure and testable.
 * @param {object}   base           the exit-policy inputs (gates, measured rates).
 * @param {number}   gangIncomePerSec money the gang would add, per second.
 */
export function gangGainHours(bestExitPolicy, base, gangIncomePerSec, maxInstalls = 60) {
  if (typeof bestExitPolicy !== 'function') return { hours: null, why: 'no exit policy search supplied' }
  if (!base || typeof base !== 'object') return { hours: null, why: 'no exit policy inputs' }
  if (!num(gangIncomePerSec) || gangIncomePerSec <= 0) {
    return { hours: null, why: 'no measured gang income for this node — refusing rather than assuming another node\'s answer' }
  }
  const income = num(base.incomePerSec) ? base.incomePerSec : null
  if (income === null) return { hours: null, why: 'no measured script income to compare against' }
  const without = bestExitPolicy({ ...base }, maxInstalls)
  const with_ = bestExitPolicy({ ...base, incomePerSec: income + gangIncomePerSec }, maxInstalls)
  const a = without?.best?.hours
  const b = with_?.best?.hours
  if (!num(a) || !num(b)) return { hours: null, why: `exit policy unpriceable (${without?.why ?? 'ok'} / ${with_?.why ?? 'ok'})` }
  return {
    hours: a - b,
    withoutHours: a,
    withHours: b,
    atSearchEdge: !!(without?.atSearchEdge || with_?.atSearchEdge),
    why: `exit ${a.toFixed(1)}h without the gang vs ${b.toFixed(1)}h with it, at $${(gangIncomePerSec / 1e6).toFixed(2)}m/s of gang income`,
  }
}

/**
 * A fresh gang's income trajectory from gangplan.simulateGang's samples
 * (cumulative money at hour h) as hourly steps [{atH, perSec}] from the gang's
 * creation. Null when the simulation produced nothing usable.
 */
export function gangIncomeSchedule(sim, stepH = 1) {
  const s = Array.isArray(sim?.samples) ? sim.samples.filter((x) => num(x?.h) && num(x?.money)) : []
  if (s.length < 2) return null
  const at = (h) => {
    let m = 0
    for (const x of s) {
      if (x.h > h) break
      m = x.money
    }
    return m
  }
  const out = []
  const end = s[s.length - 1].h
  for (let h = 0; h + stepH <= end + 1e-9; h += stepH) out.push({ atH: h, perSec: Math.max(0, (at(h + stepH) - at(h)) / (stepH * 3600)) })
  // Past the simulated horizon the last hour's rate holds.
  return out.length ? out : null
}

/**
 * THE GANG AS TRAJECTORY AGAINST TRAJECTORY (CLAUDE.md): the node's exit
 * without a gang against the exit with one whose income arrives only when the
 * karma grind ends — the schedule shifted by grindHours, and each later life's
 * augmentation growth lifted by the measured eBudget. `savedH` > 0 means the
 * gang reaches the exit sooner, grind included. The grind's use of the work
 * slot before the final window is not simulated (faction rep there moves the
 * install cadence, which exitplan holds at its measured rate) — stated.
 */
export function gangExit(bestExitPolicy, base, schedule, grindHours, eBudget = null, maxInstalls = 400) {
  if (typeof bestExitPolicy !== 'function' || !base) return { savedH: null, why: 'no exit policy or inputs' }
  if (!Array.isArray(schedule) || !schedule.length) return { savedH: null, why: 'no gang income trajectory (measured or simulated)' }
  if (!num(grindHours) || grindHours < 0) return { savedH: null, why: 'karma grind unpriced' }
  const without = bestExitPolicy({ ...base }, maxInstalls)
  const withG = bestExitPolicy({ ...base, extraIncome: schedule.map((x) => ({ atH: x.atH + grindHours, perSec: x.perSec })), eBudget }, maxInstalls)
  const a = without?.best?.hours
  const b = withG?.best?.hours
  if (!num(a) || !num(b)) return { savedH: null, why: `exit unpriceable (${without?.why ?? 'ok'} / ${withG?.why ?? 'ok'})` }
  return { savedH: a - b, withoutH: a, withH: b, why: `exit ${a.toFixed(1)}h without a gang vs ${b.toFixed(1)}h with one after a ${grindHours.toFixed(1)}h karma grind` }
}

/** BitNode 2 grants gang access outright and sells The Red Pill through it. */
export const GANG_IS_THE_NODE = 2

/**
 * @param {object} o
 * @param {number} o.node          current BitNode
 * @param {object} o.mults         that node's multiplier table (bitNodeMultipliers.js)
 * @param {number} o.grindHours    measured hours still to spend reaching karma -54,000
 * @param {object} o.gangExit      gangExit(): the simulated exit with the gang (income after the grind) against without
 * @returns {{worth: boolean|null, gainHours, grindHours, why}}
 */
export function gangVerdict(o = {}) {
  const { node, mults, grindHours, inGang } = o
  const keep = (why) => ({ worth: null, gainHours: null, grindHours: num(grindHours) ? grindHours : null, why })

  // THE GATE IS ALREADY PAID. This function answers one question — "is the
  // gang's income worth SPENDING the work slot to reach karma -54,000" — and
  // once a gang exists that question has no answer rather than a missing input.
  //
  // It used to fall through to `keep('no measured karma grind — the gang
  // cannot be priced without what it costs to reach')`, because karmaChannelCtx
  // stops supplying grindHours the moment we are in a gang. Live on 2026-09-23
  // that is exactly what it said, and it reads as a data problem: it sent the
  // reader looking for a broken measurement when the truth was that the run had
  // simply acquired the gang (karma drifted past the gate during a 6.5h
  // disconnect, as a by-product of crime done for other reasons — the slot was
  // never spent on it). A diagnostic that misnames its cause costs the reader
  // the time to disprove it, which is the whole reason this file exists.
  //
  // `worth` stays NULL and does not become true, deliberately. writeSleevePlan
  // keys the fleet's objective off `worth === true`, so a truthy answer here
  // would send every sleeve off to grind karma the run no longer has any use
  // for. `gatePaid` is the field that carries the real state.
  if (inGang === true) {
    return {
      worth: null,
      gatePaid: true,
      gainHours: null,
      grindHours: 0,
      why: `already in a gang in BitNode ${node} — the karma gate is paid and its cost is sunk, so "is the gate worth paying" no longer has an answer. Operate the gang: its income is upside with nothing left to recover.`,
    }
  }

  // BitNode 2 is not a trade-off: the gang catalogue carries The Red Pill
  // there (FactionHelpers.tsx:180-183) and access is granted without karma.
  if (node === GANG_IS_THE_NODE) {
    return { worth: true, gainHours: null, grindHours: 0, why: 'BitNode 2 grants gang access outright and sells The Red Pill through the gang catalogue — not a trade-off' }
  }
  if (!mults || typeof mults !== 'object') return keep(`no multiplier table for BitNode ${node} — refusing to price the gang`)
  if (!num(grindHours) || grindHours < 0) return keep('no measured karma grind — the gang cannot be priced without what it costs to reach')
  // THE VERDICT IS ONE COMPARISON: gangExit's savedH (the exit with the
  // gang, its income delayed by the grind, against without). It replaced
  // `gangGainHours > grindHours` — a gain priced from t=0 minus the grind as
  // flat hours — and an income-scale threshold used when nothing was
  // measured, both shortcuts CLAUDE.md now forbids. Without a comparison this
  // refuses; progress.js always supplies one (measured income, or
  // gangplan.simulateGang's trajectory for a fresh gang in this node).
  const ex = o.gangExit
  if (!ex || !num(ex.savedH)) return keep(`no simulated exit comparison: ${ex?.why ?? 'none supplied'}`)
  const worth = ex.savedH > 0
  return {
    worth,
    gainHours: ex.savedH,
    grindHours,
    withH: ex.withH ?? null,
    withoutH: ex.withoutH ?? null,
    why: `${worth ? 'WORTH IT' : 'NOT worth it'} in BitNode ${node}: ${ex.why} (${ex.savedH >= 0 ? 'saves' : 'costs'} ${Math.abs(ex.savedH).toFixed(1)}h, grind included)`,
  }
}

/**
 * IS A GANG STILL PENDING — i.e. should anything still be priced as buying one?
 *
 * `objective.karmaValue` weights an augmentation's COMBAT multipliers by the
 * hours they shave off the karma grind. That is only value if the run intends
 * to grind. progress.js decided "pending" from capability alone —
 * `canUseGang(info) && not already in one` — with no reference to the verdict
 * this module exists to produce, so in a node that priced the gang as NOT
 * worth its gate the augmentation planner went on paying for combat
 * multipliers to reach it faster.
 *
 * An UNKNOWN verdict leaves the gang pending, matching actplan: the failure
 * being fixed is an unexamined assumption, and inverting it unexamined is the
 * same mistake pointing the other way.
 */
export function gangIsPending({ canUse, node, inGang, verdict } = {}) {
  if (canUse !== true) return { pending: false, why: 'this save cannot have a gang' }
  if (inGang === true) return { pending: false, why: 'already in a gang — nothing left to buy' }
  if (node === GANG_IS_THE_NODE) return { pending: true, karmaWaived: true, why: 'BitNode 2 grants gang access outright' }
  if (verdict?.worth === false) {
    return { pending: false, why: `the gang is priced NOT worth its karma gate in BitNode ${node}, so combat multipliers buy nothing toward one` }
  }
  return { pending: true, why: verdict?.worth === true ? 'the gang is priced worth its gate here' : 'the gang is unpriced — left pending rather than cancelled on an unknown' }
}

/**
 * THE REMEMBERED GANG INCOME, but only if it is THIS node's.
 *
 * /tel/gang-last.txt is the rate a gang in some previous life actually earned,
 * and it survives a BitNode change like every other telemetry file. Read
 * without a node check it hands one node's economy to another: live on
 * 2026-09-22 it carried $276m/s measured by the BitNode 4 gang and was being
 * read in BitNode 10, whose income scale is 22x different and whose gang was
 * already priced as not worth having. That is the same defect this module was
 * written to stop — the BitNode 4 answer governing BitNode 10 — surviving one
 * layer down in the channel weights.
 *
 * A record with no `bitNode` at all is REFUSED rather than assumed local:
 * gang.js wrote that field as null for its whole life, so "missing" is a
 * shape that really occurs and really means unknown.
 */
export function rememberedGangIncome(record, node) {
  if (!record || typeof record !== 'object') return { perSec: null, why: 'no remembered gang income' }
  if (!num(record.moneyPerSec) || record.moneyPerSec <= 0) return { perSec: null, why: 'remembered gang income unreadable' }
  if (!num(record.bitNode)) {
    return { perSec: null, why: 'the remembered gang income does not say which BitNode measured it — refusing rather than assuming this one' }
  }
  if (record.bitNode !== node) {
    return { perSec: null, why: `the remembered gang income was measured in BitNode ${record.bitNode}, not ${node} — income scale differs by node, so it says nothing here` }
  }
  return { perSec: record.moneyPerSec, why: `$${(record.moneyPerSec / 1e6).toFixed(2)}m/s measured by a gang in this node` }
}
