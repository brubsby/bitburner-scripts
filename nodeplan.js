// WHICH BITNODE NEXT, simulated rather than argued.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// Every other choice in this repo is priced against a measured trajectory.
// The choice of BITNODE — the largest single commitment the run makes, tens of
// hours at a time — was argued from a multiplier table and one RAM
// measurement, by me, in chat. That is exactly the shape of reasoning the rest
// of the codebase exists to replace.
//
// The reasoning was also nearly wrong in a way that only a number catches. The
// case for BitNode 4 was that SF4.1 taxes every Singularity script 16x (a
// measured 945GB across the stack) and that BN4's money nerfs are the ones a
// gang bypasses (GangSoftcap 1.0, gang money is not on its nerf list). Both
// true. What the argument waved past was the PRICE of that gang: outside
// BitNode 2 it needs karma <= -54,000, and homicide pays 1.0 karma/sec at
// best, so the bypass costs ~15 hours before it earns anything. That is not a
// footnote against a node that takes tens of hours; it is a leg of the plan.
//
// ---------------------------------------------------------------------------
// WHAT IT MODELS, AND WHAT IT REFUSES TO
// ---------------------------------------------------------------------------
//
// Time is simulated. Value is NOT invented. A source file's worth is reported
// as what it does, plus a measured figure where one exists (SF4's RAM), and
// never as a single utility number that would let "sleeves" and "Singularity
// RAM" be added together. Ranking by an invented utility would look decisive
// and mean nothing; ranking by hours means something and leaves the last step
// to a stated preference.
//
// Every projection is a RATIO against the node we measured in, so an
// unreadable multiplier refuses by name instead of silently becoming 1.

import { bitNodeMults } from 'bitNodeMultipliers.js'
import { exitHours, bestExitPolicy, levelAt } from 'exitplan.js'

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

/** w0r1d_d43m0n's requiredHackingSkill before the node scales it (ServerHelpers.ts:423). */
export const EXIT_BASE_LEVEL = 3000
/** GangConstants.GangKarmaRequirement — the gang gate outside BitNode 2. */
export const GANG_KARMA = -54000
/** Crimes.ts homicide: 3s for 3 karma, the best karma/sec in the game by 16x. */
export const HOMICIDE = { seconds: 3, karma: 3 }
/** CONSTANTS.BaseFocusBonus — unfocused work scales karma and gains by this. */
export const UNFOCUSED = 0.8

/** The hacking level w0r1d_d43m0n demands in `node`. */
export function exitLevelFor(node) {
  const m = bitNodeMults(node)
  const d = m?.WorldDaemonDifficulty
  return pos(d) ? EXIT_BASE_LEVEL * d : null
}

/**
 * HOURS OF HOMICIDE TO THE GANG GATE.
 *
 * Karma is paid on failure too, at a quarter (CrimeWork.ts:77), so the rate is
 * `(p + (1-p)/4)` of the nominal — never zero, and never the naive `p`. It is
 * then scaled by focusPenalty, which is 1 only while actually focused: at 0.8
 * the same grind runs a quarter longer for nothing.
 *
 * `chance` is homicide's CURRENT success rate; it climbs during the grind
 * because homicide pays combat exp, so this is an UPPER bound that the live
 * planner's crimeLeg refines. Returns null with a reason rather than a guess.
 */
export function karmaHours(o = {}) {
  const { chance, karma = 0, target = GANG_KARMA, focused = true } = o
  if (!num(chance) || chance < 0 || chance > 1) return { hours: null, why: 'homicide success rate unreadable' }
  if (!num(karma)) return { hours: null, why: 'current karma unreadable' }
  const remaining = karma - target
  if (remaining <= 0) return { hours: 0, why: null, perSec: null }
  const focus = focused ? 1 : UNFOCUSED
  const perSec = ((chance + (1 - chance) / 4) * HOMICIDE.karma * focus) / HOMICIDE.seconds
  if (!pos(perSec)) return { hours: null, why: 'homicide pays no karma at this success rate' }
  return { hours: remaining / perSec / 3600, perSec, why: null }
}

/**
 * COMPOUND multiplier growth per install cycle, from the lifetimes ledger.
 *
 * exitplan.cycleStats reports the MEDIAN ratio between successive hackMult
 * values, which is the right robust summary for "a typical cycle" and the
 * wrong one for "where does the multiplier end up". Multiplier growth is
 * multiplicative and dominated by the occasional large augmentation, so the
 * median discards precisely the cycles that do the work: over BitNode 2's
 * ledger the median ratio was 1.02 while the multiplier actually went
 * 1.34 -> 5.91 across 13 cycles, a compound 1.123. Fed the median, the node
 * model priced BitNode 4 at 1.8e11 hours and pinned itself at the edge of the
 * install search — right, and useless.
 *
 * So this takes the geometric mean, which is the only summary that reproduces
 * the endpoint it is summarising. Refuses below `minN` cycles rather than
 * extrapolating a rate from one or two.
 *
 * (cycleStats itself is left alone: it feeds the LIVE install gate, where the
 * question really is "what does the next cycle look like" and a median is
 * defensible. The two summaries answer different questions and the difference
 * is worth a note here rather than a silent change there.)
 */
export function compoundGain(ledger, node, { minN = 3 } = {}) {
  if (!Array.isArray(ledger)) return { gain: null, why: 'no lifetimes ledger' }
  const lives = ledger.filter((e) => e && e.bitNode === node && pos(e.lifeH) && pos(e.hackMult))
  if (lives.length < minN) return { gain: null, why: `only ${lives.length} life/lives in BitNode ${node} (need ${minN})` }
  const first = lives[0].hackMult
  const last = lives[lives.length - 1].hackMult
  const cycles = lives.length - 1
  if (!pos(first) || !pos(last) || last < first) return { gain: null, why: 'multiplier did not grow across the ledger' }
  const hours = lives.map((e) => e.lifeH).sort((a, b) => a - b)
  const mid = Math.floor(hours.length / 2)
  return {
    gain: Math.pow(last / first, 1 / cycles),
    cycleHours: hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2,
    cycles,
    from: first,
    to: last,
    why: null,
  }
}

/**
 * Project a measured income into another node, as a RATIO of multipliers.
 *
 * Script income is money taken from servers: it scales with what a server
 * HOLDS (ServerMaxMoney) and with what a hack TAKES (ScriptHackMoney). Both
 * are per-node, so the honest projection is the product of the two ratios —
 * and it is a ratio, so the node we measured in cancels out of everything
 * except its own multipliers.
 *
 * This deliberately does NOT model growth-rate or security differences, which
 * change the batcher's shape rather than scaling its take. Their absence is
 * stated in `assumes` rather than hidden.
 */
export function projectIncome(incomePerSec, from, to) {
  if (!pos(incomePerSec)) return { incomePerSec: null, why: 'measured income unreadable' }
  const a = bitNodeMults(from)
  const b = bitNodeMults(to)
  if (!a || !b) return { incomePerSec: null, why: `no multiplier table for BitNode ${!a ? from : to}` }
  const f = (m) => (pos(m.ScriptHackMoney) ? m.ScriptHackMoney : null) * (pos(m.ServerMaxMoney) ? m.ServerMaxMoney : null)
  const fa = f(a)
  const fb = f(b)
  if (!pos(fa) || !pos(fb)) return { incomePerSec: null, why: 'ScriptHackMoney or ServerMaxMoney unreadable in one of the nodes' }
  return { incomePerSec: (incomePerSec * fb) / fa, ratio: fb / fa, why: null }
}

/** Experience rate projected the same way, off HackExpGain. */
export function projectExp(expPerSec, from, to) {
  if (!pos(expPerSec)) return { expPerSec: null, why: 'measured experience rate unreadable' }
  const a = bitNodeMults(from)?.HackExpGain
  const b = bitNodeMults(to)?.HackExpGain
  if (!pos(a) || !pos(b)) return { expPerSec: null, why: 'HackExpGain unreadable in one of the nodes' }
  return { expPerSec: (expPerSec * b) / a, ratio: b / a, why: null }
}

/**
 * TIME TO CLEAR ONE CANDIDATE NODE, from a fresh entry.
 *
 * Reuses exitplan.exitHours — the same simulation that decides when to install
 * inside a node — with the candidate's gates and a baseline projected into it.
 * The gang leg is added when the node needs one and we can form one, because
 * outside BitNode 2 it is ~15 hours that no other model was counting.
 *
 * THE INSTALL COUNT IS SEARCHED, NOT ASSUMED. Asking exitHours for zero
 * installs asks how long it takes to reach the node's exit level on today's
 * multiplier, and in a node whose exit is 9000 that answer is astronomical —
 * 3.4e56 hours in the first fixture written against this. Clearing a node IS
 * the install cycle, so bestExitPolicy searches it and this reports the
 * policy it found, plus whether that policy sat at the edge of the search.
 *
 * The default reaches 40 because the search edge is not a detail: a node whose
 * exit is 9000 needs the multiplier to climb ~12x, which at a measured 1.1 per
 * cycle is 26 installs. A cap of 12 returned 8.3e14 hours and reported itself
 * pinned — right, and useless. `atSearchEdge` rides out on every row so a
 * pinned answer can never be read as a finished one.
 *
 * `o`: { node, from, measured: {incomePerSec, expPerSec, hacking, hackingMult,
 *        hackingExp, money, cycleHours, multGainPerCycle},
 *        gang: {wanted, haveSF2, chance, karma, focused} | null,
 *        maxInstalls }
 */
export function nodeHours(o = {}) {
  const { node, from, measured = {}, gang = null, maxInstalls = 40 } = o
  const exitLevel = exitLevelFor(node)
  if (!pos(exitLevel)) return { hours: null, why: `BitNode ${node}: WorldDaemonDifficulty unreadable` }

  const inc = projectIncome(measured.incomePerSec, from, node)
  if (inc.why) return { hours: null, why: `BitNode ${node}: ${inc.why}` }
  const exp = projectExp(measured.expPerSec, from, node)
  if (exp.why) return { hours: null, why: `BitNode ${node}: ${exp.why}` }

  const policy = bestExitPolicy({
    money: measured.money ?? 0,
    incomePerSec: inc.incomePerSec,
    hacking: measured.hacking,
    hackingExp: measured.hackingExp ?? 0,
    hackingMult: measured.hackingMult,
    expPerSec: exp.expPerSec,
    cycleHours: measured.cycleHours,
    multGainPerCycle: measured.multGainPerCycle,
    exitLevel,
  }, maxInstalls)
  const core = policy.best
  if (!core || core.hours === null) return { hours: null, why: `BitNode ${node}: ${policy.why ?? 'no exit policy could be priced'}` }

  // The gang leg. In BitNode 2 access is granted outright; everywhere else it
  // costs karma we do not have, and only if we hold SF2 at all.
  let gangLeg = 0
  let gangWhy = null
  if (gang?.wanted) {
    if (node === 2) gangWhy = 'BitNode 2 grants gang access outright'
    else if (!gang.haveSF2) gangWhy = 'no SF2 — no gang outside BitNode 2'
    else {
      const k = karmaHours({ chance: gang.chance, karma: gang.karma, focused: gang.focused })
      if (k.hours === null) return { hours: null, why: `BitNode ${node}: ${k.why}` }
      gangLeg = k.hours
      gangWhy = `${k.hours.toFixed(1)}h of homicide to karma ${GANG_KARMA}`
    }
  }

  return {
    hours: core.hours + gangLeg,
    exitHours: core.hours,
    installs: core.installsFirst,
    atSearchEdge: !!policy.atSearchEdge,
    gangHours: gangLeg,
    gangWhy,
    exitLevel,
    incomeRatio: inc.ratio,
    expRatio: exp.ratio,
    legs: core.legs,
    assumes: 'income scaled by ScriptHackMoney x ServerMaxMoney and experience by HackExpGain; growth-rate and security differences change the batcher shape and are not modelled',
    why: null,
  }
}

/**
 * Rank candidate nodes by hours, reporting what each one awards.
 *
 * Deliberately returns hours and rewards SIDE BY SIDE rather than one score.
 * `sfLevel` is what the run would hold AFTER clearing the node, since a source
 * file's marginal worth is a step, not a total — SF4 1->2 is the 16x->4x
 * Singularity cut and 2->3 is only 4x->1x.
 */
export function rankNodes(o = {}) {
  const { candidates = [], from, owned = {}, measured = {}, gang = null, rewards = {} } = o
  const rows = []
  for (const node of candidates) {
    const r = nodeHours({ node, from, measured, gang })
    const have = num(owned[node]) ? owned[node] : 0
    rows.push({
      node,
      hours: r.hours,
      exitHours: r.exitHours ?? null,
      installs: r.installs ?? null,
      atSearchEdge: r.atSearchEdge ?? false,
      gangHours: r.gangHours ?? null,
      gangWhy: r.gangWhy ?? null,
      exitLevel: r.exitLevel ?? exitLevelFor(node),
      sfFrom: have,
      sfTo: have >= 3 ? have : have + 1,
      maxed: have >= 3,
      reward: rewards[node] ?? null,
      why: r.why,
    })
  }
  // Readable hours first, ascending; refusals last, carrying their reason.
  rows.sort((a, b) => {
    if (a.hours === null && b.hours === null) return a.node - b.node
    if (a.hours === null) return 1
    if (b.hours === null) return -1
    return a.hours - b.hours
  })
  return rows
}

export { levelAt }
