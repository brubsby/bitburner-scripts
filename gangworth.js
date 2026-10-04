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

import { capitalFV } from 'hacknetplan.js'
import { drain, callGen } from 'coop.js'

const num = (v) => typeof v === 'number' && isFinite(v)

/** Two simulated exits closer than this are the same exit (progress.js objective sort uses 1/60). */
export const EXIT_RESOLUTION_H = 1 / 60

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
  // THE GRIND HOLDS THE WORK SLOT (exitplan slotBusyH) where the model can
  // price what the slot would otherwise earn: with base.workWhileDonating
  // (donations open at favor 0 — BitNode 8) the exit's reputation leg is
  // work-plus-donation, so every hour of crime is an hour of reputation the
  // money must buy instead. BitNode 8 is where this decides the answer: with
  // GangSoftcap 0 a gang earns ~$60/s (gangplan at x^0 = 1 per member per
  // cycle, Gang/formulas/formulas.ts:71), and without the slot's cost that
  // tiny income read as "WORTH IT". Elsewhere it stays unsimulated, as the
  // header says, so no other node's verdict moves.
  const slot = base.workWhileDonating === true ? { slotBusyH: grindHours } : {}
  const withG = bestExitPolicy({ ...base, ...slot, extraIncome: schedule.map((x) => ({ atH: x.atH + grindHours, perSec: x.perSec })), eBudget }, maxInstalls)
  const a = without?.best?.hours
  const b = withG?.best?.hours
  if (!num(a) || !num(b)) return { savedH: null, why: `exit unpriceable (${without?.why ?? 'ok'} / ${withG?.why ?? 'ok'})` }
  return { savedH: a - b, withoutH: a, withH: b, why: `exit ${a.toFixed(1)}h without a gang vs ${b.toFixed(1)}h with one after a ${grindHours.toFixed(1)}h karma grind` }
}
/**
 * gangExit as a generator over exitplan.bestExitPolicyGen: the same two
 * trajectories, yielding inside each policy search so the plan's pacer
 * slices it (live 22:35Z: PLAN BLOCKED THE PAGE, 238ms in one
 * 'plan-sleeveObjective' step — the karma objective's two exits in one step).
 */
export function* gangExitGen(bestExitPolicyGen, base, schedule, grindHours, eBudget = null, maxInstalls = 400) {
  if (typeof bestExitPolicyGen !== 'function' || !base) return { savedH: null, why: 'no exit policy or inputs' }
  if (!Array.isArray(schedule) || !schedule.length) return { savedH: null, why: 'no gang income trajectory (measured or simulated)' }
  if (!num(grindHours) || grindHours < 0) return { savedH: null, why: 'karma grind unpriced' }
  const without = yield* bestExitPolicyGen({ ...base }, maxInstalls)
  // THE GRIND HOLDS THE WORK SLOT (exitplan slotBusyH) where the model can
  // price what the slot would otherwise earn: with base.workWhileDonating
  // (donations open at favor 0 — BitNode 8) the exit's reputation leg is
  // work-plus-donation, so every hour of crime is an hour of reputation the
  // money must buy instead. BitNode 8 is where this decides the answer: with
  // GangSoftcap 0 a gang earns ~$60/s (gangplan at x^0 = 1 per member per
  // cycle, Gang/formulas/formulas.ts:71), and without the slot's cost that
  // tiny income read as "WORTH IT". Elsewhere it stays unsimulated, as the
  // header says, so no other node's verdict moves.
  const slot = base.workWhileDonating === true ? { slotBusyH: grindHours } : {}
  const withG = yield* bestExitPolicyGen({ ...base, ...slot, extraIncome: schedule.map((x) => ({ atH: x.atH + grindHours, perSec: x.perSec })), eBudget }, maxInstalls)
  const a = without?.best?.hours
  const b = withG?.best?.hours
  if (!num(a) || !num(b)) return { savedH: null, why: `exit unpriceable (${without?.why ?? 'ok'} / ${withG?.why ?? 'ok'})` }
  return { savedH: a - b, withoutH: a, withH: b, why: `exit ${a.toFixed(1)}h without a gang vs ${b.toFixed(1)}h with one after a ${grindHours.toFixed(1)}h karma grind` }
}

/**
 * WHERE THE REPUTATION RATE CAME FROM, for the verdict. exitInputsOf fills an
 * unmeasured rate with the formula estimate itself (repFromEstimate, the
 * plan's labelled prior; plan.applyDraw draws its residual) — ONE mechanism,
 * shared by every arm and every draw. This only reads the label.
 */
export function withRepEstimate(base) {
  if (!base || typeof base !== 'object') return { inputs: base, repSource: null }
  if (base.repFromEstimate === true) return { inputs: base, repSource: base.repSource ?? 'reputation from the formula estimate (no faction work measured this life)' }
  return { inputs: base, repSource: num(base.repPerSec) && base.repPerSec > 0 ? 'measured' : null }
}

/**
 * THE GANG DECISION'S ARMS, trajectory against trajectory on one base
 * (CLAUDE.md): the exit WITHOUT a gang, against the exit with the gang's
 * income arriving when the karma grind ends, for each way to grind:
 *   fleet    the sleeves grind (their karma ramping as they train —
 *            sleeveplan.fleetKarmaGrind); the work slot keeps its plan
 *   player   the sleeves AND the work slot grind (a shorter grind); the slot's
 *            hours are charged as an UPPER bound — every leg of the exit waits
 *            for them (grind hours + the exit with the gang from the start) —
 *            because the slot's use in lives before the final window moves
 *            the install cadence, which exitplan holds at its measured rate.
 *            The slot joins only if it wins under that bound ("if it pays").
 * Not simulated, stated: the fleet's own alternative (its exp transfer or
 * reputation) during the grind — lives before the final window, whose
 * cadence the model holds at its measured rate; the gang faction's
 * reputation and augmentations. `grinds` {fleet, player}: hours or null.
 * Returns {best: 'none'|'fleet'|'player', savedH, withoutH, arms, why}.
 */
export function gangArms(bestExitPolicy, base0, schedule, grinds = {}, eBudget = null, maxInstalls = 400, opts = {}) {
  return drain(gangArmsGen(bestExitPolicy, base0, schedule, grinds, eBudget, maxInstalls, opts))
}
/**
 * gangArms as a generator: `bestExitPolicy` the search or its generator
 * (exitplan.bestExitPolicyGen, coop.callGen). Given the generator it yields
 * inside every policy search — the plan's per-draw arms were two or three
 * whole searches in one 'plan-gang' step. The same result.
 */
export function* gangArmsGen(bestExitPolicy, base0, schedule, grinds = {}, eBudget = null, maxInstalls = 400, { lower: wantLower = true } = {}) {
  if (typeof bestExitPolicy !== 'function' || !base0) return { best: null, savedH: null, why: 'no exit policy or inputs' }
  if (!Array.isArray(schedule) || !schedule.length) return { best: null, savedH: null, why: 'no gang income trajectory (measured or simulated)' }
  const { inputs: base, repSource } = withRepEstimate(base0)
  const without = yield* callGen(bestExitPolicy, { ...base }, maxInstalls)
  const a = without?.best?.hours
  if (!num(a) || without?.degenerate) return { best: null, savedH: null, repSource, why: `exit unpriceable without the gang (${without?.why ?? 'degenerate'})` }
  const shifted = (H) => schedule.map((x) => ({ atH: x.atH + H, perSec: x.perSec }))
  const exitWithExtra = function* (extra) {
    return (yield* callGen(bestExitPolicy, { ...base, ...extra, eBudget }, maxInstalls))?.best?.hours
  }
  const arms = {}
  const gF = grinds.fleet
  if (num(gF) && gF >= 0) {
    const h = yield* exitWithExtra({ extraIncome: shifted(gF) })
    arms.fleet = { grindH: gF, withH: num(h) ? h : null }
  }
  const gP = grinds.player
  if (num(gP) && gP >= 0) {
    // The slot-free bound is for the record; a caller pricing only withH (the plan's per-draw arms) skips it.
    const lower = wantLower ? yield* exitWithExtra({ extraIncome: shifted(gP), slotBusyH: gP }) : null
    const fromStart = yield* exitWithExtra({ extraIncome: shifted(0) })
    arms.player = { grindH: gP, withH: num(fromStart) ? gP + fromStart : null, lowerH: num(lower) ? lower : null }
  }
  let best = 'none'
  let bestH = a
  for (const [k, v] of Object.entries(arms)) {
    if (num(v.withH) && v.withH < bestH - EXIT_RESOLUTION_H) {
      best = k
      bestH = v.withH
    }
  }
  const armWhy = Object.entries(arms).map(([k, v]) => `${k} (grind ${v.grindH.toFixed(1)}h) ${num(v.withH) ? v.withH.toFixed(1) + 'h' : 'unpriced'}${num(v.lowerH) ? ` [slot free: ${v.lowerH.toFixed(1)}h]` : ''}`).join(', ')
  return {
    best,
    savedH: a - bestH,
    withoutH: a,
    withH: bestH,
    arms,
    repSource,
    why: `exit ${a.toFixed(1)}h without a gang; with: ${armWhy || 'no grind priced'} -> ${best}${repSource && repSource !== 'measured' ? ` (${repSource}; every arm)` : ''}`,
  }
}

/**
 * A gang whose every channel is zero by the node's multipliers: null when it
 * has one, else the reason. GangSoftcap 0 raises both a member's respect and
 * money gain to the power 0 (Gang/formulas/formulas.ts:27,71): each is exactly
 * 1 per cycle whatever the member, task or territory — ~$1 and ~1 respect per
 * member per cycle — and the gang faction's reputation is respect / 75
 * (Gang.ts:154-155), so no reputation either. Nothing to buy with it:
 * GangUniqueAugs 0 means the gang factions sell no unique augmentation.
 * This is the node's structure, not a measurement, so it decides the verdict
 * without any income reading.
 */
export function gangChannelsDead(mults) {
  if (!mults || typeof mults !== 'object') return null
  if (mults.GangSoftcap === 0) {
    return `GangSoftcap is 0 — a member's respect and money are pow(x, 0) = 1 per cycle (Gang/formulas/formulas.ts:27,71), so the gang earns ~$1 and ~1/75 reputation per member per cycle${mults.GangUniqueAugs === 0 ? ', and GangUniqueAugs 0 leaves its factions nothing unique to sell' : ''}: the -54,000 karma gate buys nothing`
  }
  return null
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
  // STRUCTURALLY WORTHLESS, whatever the income reads. Checked before the
  // trajectory comparison because that comparison needs a measured income,
  // and an UNMEASURED income left the verdict unknown -> gang pending ->
  // the work slot and the sleeves on Homicide for a 15h karma grind (live in
  // BitNode 8, 2026-09-25).
  const dead = gangChannelsDead(mults)
  if (dead) return { worth: false, gainHours: null, grindHours: num(grindHours) ? grindHours : null, structural: true, why: `NOT worth it in BitNode ${node}: ${dead}` }
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
  // THE ARMS (gangArms): which grind the gang wins with — the fleet alone, or
  // the fleet and the work slot. `playerSlot` is what act.js/progress.js
  // read to give the slot to the grind; false keeps it on the plan.
  if (ex.arms) {
    // THE PLAN'S COMMITTED DECISION IS THE VERDICT (decisions.gang): one
    // decider. The point comparison is published beside it, never instead —
    // live 2026-09-28 the plan committed 'fleet' while this re-derived 'none'
    // from the point and every consumer read 'NOT worth it'.
    const dk = o.decision?.key
    if (dk === 'none' || dk === 'fleet' || dk === 'player') {
      const worthD = dk !== 'none'
      const gD = worthD ? ex.arms[dk]?.grindH : null
      return {
        worth: worthD,
        arm: dk,
        playerSlot: dk === 'player',
        decidedBy: 'plan',
        gainHours: ex.savedH,
        grindHours: num(gD) ? gD : grindHours,
        withH: ex.withH ?? null,
        withoutH: ex.withoutH ?? null,
        arms: ex.arms,
        repSource: ex.repSource ?? null,
        decision: o.decision,
        why: `${worthD ? `WORTH IT (${dk === 'player' ? 'sleeves and the work slot grind' : 'the sleeves grind; the work slot keeps its plan'})` : 'NOT worth it — the partial grind stops'} in BitNode ${node}: the plan commits '${dk}' (${String(o.decision?.why ?? '').slice(0, 120)}); point: ${ex.why}`,
      }
    }
    const worth = ex.best !== 'none' && ex.savedH > EXIT_RESOLUTION_H
    const g = worth ? ex.arms[ex.best]?.grindH : null
    return {
      worth,
      arm: worth ? ex.best : 'none',
      playerSlot: worth && ex.best === 'player',
      gainHours: ex.savedH,
      grindHours: num(g) ? g : grindHours,
      withH: ex.withH ?? null,
      withoutH: ex.withoutH ?? null,
      arms: ex.arms,
      decidedBy: 'point',
      repSource: ex.repSource ?? null,
      ...(o.decision ? { decision: o.decision } : {}),
      why: `${worth ? `WORTH IT (${ex.best === 'player' ? 'sleeves and the work slot grind' : 'the sleeves grind; the work slot keeps its plan'})` : 'NOT worth it — the partial grind stops'} in BitNode ${node}: ${ex.why} (${ex.savedH >= 0 ? 'saves' : 'costs'} ${Math.abs(ex.savedH).toFixed(1)}h, grind included)`,
    }
  }
  // A saving inside the planner's own exit resolution is not a saving. The
  // objective comparison in progress.js treats two simulated exits within a
  // minute as equal (EXIT_RESOLUTION_H), and a gate that costs a karma grind
  // must clear the same bar. BitNode 8 is the case: GangSoftcap 0 leaves a
  // gang ~$60/s, which moved a 54.6h exit by 14 seconds and read "WORTH IT",
  // sending the work slot to crime for a gate that buys nothing. The grind's
  // own cost in an earlier life is not simulated (header), so a tie is not
  // a licence to pay it.
  const worth = ex.savedH > EXIT_RESOLUTION_H
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
export function gangIsPending({ canUse, node, inGang, verdict, mults = null } = {}) {
  if (canUse !== true) return { pending: false, why: 'this save cannot have a gang' }
  if (inGang === true) return { pending: false, why: 'already in a gang — nothing left to buy' }
  // Structure outranks an unpriced verdict: a gang with every channel at
  // zero is not pending however the income reads (gangChannelsDead).
  const dead = node !== GANG_IS_THE_NODE ? gangChannelsDead(mults) : null
  if (dead) return { pending: false, why: `not pending: ${dead}` }
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

/**
 * THE GANG FACTION'S REPUTATION LEVELS the planner re-plans its batch at
 * (progress.js publishExitInputs gainsByGangRep): the distinct unlock levels
 * above the reputation now, at most `n`, spread evenly over ALL of them and
 * always including the last — the nearest n alone stopped short of where a
 * few hours of a 2M-respect gang reach (live 21:38Z: 131k now, ~2-3M at W),
 * so every trajectory landed past the ladder's end and equipment priced 0.
 */
export function gangRepLevels(repReqs, repNow, n = 10) {
  const all = [...new Set((repReqs ?? []).filter((r) => num(r) && r > (num(repNow) ? repNow : 0)))].sort((a, b) => a - b)
  if (all.length <= n) return all
  const out = new Set()
  for (let i = 1; i <= n; i++) out.add(all[Math.round((i * all.length) / n) - 1])
  return [...out].sort((a, b) => a - b)
}

/**
 * GANG EQUIPMENT, trajectory against trajectory, on the committed plan's own
 * inputs (/tel/exitinputs.txt, progress.js publishExitInputs): the node's exit
 * with the gang run as gangplan simulated it WITH the planned equipment
 * against the best way of running it WITHOUT buying — the same policy bare
 * (`bareSim`) and every alternative the caller names (`o.alternatives`
 * [{sim, label}]: the incumbent policy, the committed trajectory). Comparing
 * only against the same policy bare credits the gear with what a different
 * no-gear policy earns anyway: live 21:38Z the refused money-split policy
 * reached 1.1M gang reputation bare, while the respect policy then running
 * reached 1.96M with no gear at all.
 *
 * What each run carries, and where:
 *   PRICE       out of the player's WEALTH now — cash plus the trader's book —
 *               so it stops compounding until the install point W: charged
 *               `spent x lump` at W (hacknetplan.capitalFV, the trader's
 *               r(W) on the book's own path; lump 1 where nothing trades).
 *               Every re-buy the simulation makes after an ascension is
 *               charged at t0 as well, which overstates the lost compounding
 *               (a conservative with-run).
 *   MONEY       each gang's money before W, reinvested as it arrives (the
 *               same FV per hour), moves the batch the install at W buys
 *               along the planner's own money ladder (exitplan.spendRuns: the
 *               crowding-out of the augmentation batch, priced by the
 *               planner). After W each run's gang income REPLACES the
 *               committed gang stream (carriedIncome.gang), counted once and
 *               never as an eBudget lift (exitplan: a carried stream is
 *               priced in the money legs) — the old comparison fed both
 *               gangs in as extraIncome, whose lift on the scripts' $64k/s
 *               priced a $27b money-split policy at -6h on money alone.
 *   RESPECT     the gang faction's reputation at W (o.rep + o.gangRepAt),
 *               through the planner's reputation ladder (gainsByGangRep: the
 *               batch at W re-planned with the gang faction's reputation at
 *               each unlock level), as that row's gains over row 0's (the
 *               money ladder is planned at the reputation now). This is what
 *               equipment buys in respect mode, where the gang earns $0 and a
 *               money-only comparison priced deltaH 0 and refused every
 *               dollar (live 2026-09-29 18:45Z, $23b at k=4.22). No ladder ->
 *               the channel is unpriced and SAID so (`unpriced`).
 *   FINAL WINDOW no install is coming: the price leaves the money short in the
 *               exit's own legs (the graft start money, the join money in
 *               hand), and the gangs' incomes feed those legs.
 *
 * ITS OWN HORIZON. Equipment is lost on ascension (GangMember.ts ascend():
 * upgrades.length = 0; gang augmentations survive) and NOT on install
 * (Prestige.ts:131-143 only scales ascension points by 0.95): the simulation
 * carries every ascension it makes, and past the with-run's last simulated
 * hour its income falls back to `bareSim`'s. Its value in later lives (money
 * after the simulated horizon, reputation toward later batches) is NOT
 * simulated: a floor, stated in `floor`.
 *
 * Returns {deltaH, withH, withoutH, without (the label that won), moneyAtW,
 * repAtW, unpriced, floor, why}; deltaH null (refuse) on a stale or foreign
 * record, or any unreadable input.
 */
export function gangEquipExit(record, lastAugReset, bestExitPolicy, withSim, bareSim, spent, now = Date.now(), spendRunsFn = null, o = {}) {
  if (typeof spendRunsFn !== 'function') return { deltaH: null, why: 'no spendRuns supplied' }
  if (!record || typeof bestExitPolicy !== 'function' || record.lastAugReset !== lastAugReset || !(now - Date.parse(record.at) < 15 * 60e3) || !record.inputs) {
    return { deltaH: null, why: 'no fresh exit inputs from progress.js' }
  }
  const sw = gangIncomeSchedule(withSim)
  const sb = gangIncomeSchedule(bareSim)
  if (!sw || !sb || !num(spent) || spent < 0) return { deltaH: null, why: 'a gang trajectory or the spend is unreadable' }
  const inputs = record.inputs
  const ageH = Math.max(0, (now - Date.parse(record.at)) / 3600e3)
  const e = num(record.eBudget) ? record.eBudget : null
  const unpriced = []
  const floor = ["the equipment's effect past the simulated horizon (and on later lives' reputation) is not simulated"]
  // Past the with-run's last simulated hour its income is bareSim's: the
  // equipment's difference is priced over the horizon the simulation saw.
  const endH = sw.length
  const withSteps = [...sw, { atH: endH, perSec: sb[sb.length - 1].perSec }]
  const carried = (steps) => ({ ...(inputs.carriedIncome ?? {}), gang: steps })
  const alts = [{ sim: bareSim, steps: sb, label: 'the same policy without the equipment' }]
  for (const a of Array.isArray(o?.alternatives) ? o.alternatives : []) {
    const st = gangIncomeSchedule(a?.sim)
    if (st) alts.push({ sim: a.sim, steps: st, label: a.label ?? 'an alternative' })
  }
  const W = record.finalWindow === true ? null : num(record.W) ? Math.max(0, record.W - ageH) : null
  if (record.finalWindow !== true && (W === null || !num(record.moneyAtW))) return { deltaH: null, why: 'the exit inputs carry no install point or money at it' }
  // The money each gang adds before W, compounded to W (0 in the final window).
  const gangFV = (steps) => {
    if (W === null) return 0
    let v = 0
    for (let h = 0; h < W; h++) {
      const span = Math.min(1, W - h)
      const r = steps[Math.min(h, steps.length - 1)].perSec
      if (r > 0) v += r * span * 3600 * capitalFV(inputs, Math.max(0, W - h - span / 2)).lump
    }
    return v
  }
  // The reputation ladder, when published and readable.
  const ladder = record.gainsByGangRep
  const r = o?.rep
  let rows = null
  if (W !== null) {
    if (!ladder || !Array.isArray(ladder.rows) || !ladder.rows.length) unpriced.push("the gang faction's reputation (no gainsByGangRep ladder published)")
    else if (!r || typeof o.gangRepAt !== 'function' || !num(r.repNow) || !num(r.facRepMult)) unpriced.push("the gang faction's reputation (repNow / facRepMult unreadable)")
    else rows = ladder.rows.filter((x) => num(x?.rep) && x?.gains).sort((a, b) => a.rep - b.rep)
    if (rows && !rows.length) {
      rows = null
      unpriced.push("the gang faction's reputation (an empty ladder)")
    }
  }
  const rowAt = (rep) => (rows ? rows.filter((x) => x.rep <= rep + 1e-6).at(-1) ?? rows[0] : null)
  const ref = alts[0]
  const refFV = gangFV(ref.steps)
  const lump = W === null ? 1 : capitalFV(inputs, W).lump
  // One run's exit inputs: its price, its gang money and its reputation.
  const runOf = (sim, steps, cost) => {
    if (W === null) {
      const runs = spendRunsFn(record, cost)
      if (!runs) return null
      return { x: { ...runs.with, carriedIncome: carried(steps), eBudget: e }, max: runs.max, min: runs.min, m: null, rep: null }
    }
    const net = cost * lump - (gangFV(steps) - refFV)
    const runs = spendRunsFn(record, net, { allowGain: true })
    if (!runs) return null
    let g = runs.with.installGains ?? null
    let rep = null
    if (rows) {
      rep = o.gangRepAt(sim, W, r.repNow, { facRepMult: r.facRepMult, favor: r.favor })
      const row = num(rep) ? rowAt(rep) : null
      if (row && row !== rows[0]) {
        const g0 = g ?? {}
        const keys = new Set([...Object.keys(g0), ...Object.keys(row.gains), ...Object.keys(rows[0].gains)])
        g = Object.fromEntries([...keys].map((k) => {
          const a = num(row.gains[k]) && row.gains[k] > 0 ? row.gains[k] : 1
          const b = num(rows[0].gains[k]) && rows[0].gains[k] > 0 ? rows[0].gains[k] : 1
          return [k, (num(g0[k]) && g0[k] > 0 ? g0[k] : 1) * (a / b)]
        }))
      }
      if (num(rep) && rep > rows[rows.length - 1].rep && !floor.some((f) => /ladder's last level/.test(f))) floor.push("reputation past the ladder's last level is priced at that level")
    }
    return { x: { ...runs.with, ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}), carriedIncome: carried(steps), eBudget: e }, max: runs.max, min: runs.min, m: record.moneyAtW - net, rep }
  }
  const exitOf = (arm) => (arm ? bestExitPolicy(arm.x, arm.max, arm.min)?.best?.hours : null)
  const wRun = runOf(withSim, withSteps, spent)
  const a = exitOf(wRun)
  let best = null
  for (const alt of alts) {
    const arm = runOf(alt.sim, alt.steps, 0)
    const h = exitOf(arm)
    if (num(h) && (!best || h < best.h)) best = { h, arm, label: alt.label }
  }
  if (!num(a) || !best) return { deltaH: null, why: 'an exit could not be priced' }
  const b = best.h
  const moneyAtW = W === null ? null : { with: wRun.m, without: best.arm.m, lump }
  const repAtW = rows ? { with: wRun.rep, without: best.arm.rep } : null
  return {
    deltaH: a - b,
    withH: a,
    withoutH: b,
    without: best.label,
    moneyAtW,
    repAtW,
    unpriced: unpriced.length ? unpriced : null,
    floor,
    why: `exit ${a.toFixed(2)}h with the equipment vs ${b.toFixed(2)}h without (${best.label})${moneyAtW ? `; money at W $${(moneyAtW.with / 1e9).toFixed(1)}b vs $${(moneyAtW.without / 1e9).toFixed(1)}b, the price x${lump.toFixed(2)} compounded` : ''}${repAtW && num(repAtW.with) && num(repAtW.without) ? `; gang rep at W ${Math.round(repAtW.with).toLocaleString()} vs ${Math.round(repAtW.without).toLocaleString()}` : ''}${unpriced.length ? `; UNPRICED: ${unpriced.join(', ')}` : ''}`,
  }
}

/**
 * THE LIVE GANG'S INCOME, as the exit should carry it (progress.js
 * gangCarriedNow): the trajectory the gang is actually running — its own
 * published forecast (/tel/gang.txt `forecast`: the ADOPTED policy's
 * simulation from its real members, multipliers, respect, wanted penalty,
 * money split and only the equipment the spend allowed) — from the
 * forecast's age on; past the forecast's end, the fresh-gang schedule
 * entered where its respect reaches the forecast's final respect, never
 * below the forecast's last hour (a gang does not get weaker by waiting).
 *
 * The fresh-gang schedule entered at the live RESPECT alone (the previous
 * carry) knew nothing of the gang's mode, split or ascensions: live BN9
 * 2026-09-29 20:40Z the gang farmed respect ($0/s, m=0) while the carry
 * credited it ~$0.5m/s from its "hour 7.7", and an ascension round (respect
 * 1.8m -> 1.04m) moved that entry hour backwards.
 *
 * `live`: the gang.txt record; `fresh`: [{atH, perSec}] hourly;
 * `respectPath`: [[h, respect]] of the fresh simulation; `now` in ms.
 * Returns {steps, why, source} or null when the forecast is unusable (the
 * caller then keeps its respect-matched fallback, named).
 */
export const GANG_FORECAST_MAX_AGE_MS = 30 * 60e3
export function gangCarriedSchedule(live, fresh, respectPath, now = Date.now()) {
  const fc = live?.forecast
  const at = Date.parse(fc?.at ?? '')
  if (!fc || !Array.isArray(fc.samples) || fc.samples.length < 2 || !num(at) || now < at || !(now - at < GANG_FORECAST_MAX_AGE_MS)) return null
  const own = gangIncomeSchedule({ samples: fc.samples })
  if (!own) return null
  const ageH = (now - at) / 3600e3
  const last = fc.samples[fc.samples.length - 1]
  const endH = Math.max(0, last.h - ageH)
  // The forecast's hours still ahead (gangIncomeSchedule steps are whole hours).
  const steps = own.filter((x) => x.atH + 1 > ageH).map((x) => ({ atH: Math.max(0, x.atH - ageH), perSec: x.perSec }))
  const floor = own[own.length - 1].perSec
  let tailWhy = 'held at its last hour'
  if (Array.isArray(fresh) && fresh.length && Array.isArray(respectPath) && respectPath.length && num(last.respect)) {
    const hit = respectPath.find(([, r]) => r >= last.respect)
    const entry = hit ? hit[0] : respectPath[respectPath.length - 1][0]
    const tail = fresh.filter((x) => x.atH >= entry).map((x) => ({ atH: endH + (x.atH - entry), perSec: Math.max(floor, x.perSec) }))
    if (tail.length) {
      steps.push(...tail)
      tailWhy = `then the fresh gang from its hour ${entry.toFixed(1)} (respect ${last.respect.toExponential(2)}), never below $${(floor / 1e6).toFixed(2)}m/s`
    }
  }
  if (!steps.length) return null
  return { steps, source: 'forecast', why: `the gang's adopted policy (${fc.policy ?? '?'}) forecast ${last.h.toFixed(1)}h from ${fc.at}, ${ageH.toFixed(2)}h old; ${tailWhy}` }
}
