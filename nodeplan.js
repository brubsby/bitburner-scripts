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
// BN10_SYNC_FLOOR rather than a bare 25: [C5] flags an unregistered literal,
// correctly — the game multiplies 25 by CloudServerLimit elsewhere, and a
// number with no cited source cannot be told apart from that one.
import { BN10_SYNC_FLOOR } from 'sleeveplan.js'

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
/*
 * ON `assistPerSec` AND THE LIMITS OF THIS MODULE.
 *
 * The sleeve term below is correct for what it models. It does NOT make this
 * module's node ranking trustworthy on its own: watchdog.js:473 declines to use
 * `rankNodes` for a SEPARATE and still-unfixed reason — `projectIncome` /
 * `projectExp` carry the CURRENT multiplier into a fresh node, while
 * prestigeSourceFile strips every augmentation, so a candidate node is credited
 * with this life's 16.18x and almost everything returns ~0h.
 *
 * That is the same class of error the sleeve term exists to avoid — today's
 * state carried across a boundary that resets it — and it is called out here
 * rather than left for the next reader to rediscover. Fixing it is a separate
 * piece of work; until it is fixed, a sleeve-aware karma leg makes this module
 * less wrong, not right.
 */
export function karmaHours(o = {}) {
  const { chance, karma = 0, target = GANG_KARMA, focused = true } = o
  if (!num(chance) || chance < 0 || chance > 1) return { hours: null, why: 'homicide success rate unreadable' }
  if (!num(karma)) return { hours: null, why: 'current karma unreadable' }
  const remaining = karma - target
  if (remaining <= 0) return { hours: 0, why: null, perSec: null }
  const focus = focused ? 1 : UNFOCUSED
  const playerPerSec = ((chance + (1 - chance) / 4) * HOMICIDE.karma * focus) / HOMICIDE.seconds
  // THE SLEEVE FLEET, if one is supplied. SleeveCrimeWork.ts:47 decrements the
  // same Player.karma, so the fleet's karma is simply added to the player's.
  //
  // It must be the ARRIVING fleet's rate, not today's. This function ranks
  // candidate BitNodes, and prestigeSourceFile resets every sleeve on entry —
  // exp 0, skills 1, sync back to max(memory,1). Measured on the live fleet:
  // 0.63 karma/s today against 0.000051 arriving in BitNode 2, because sync 1
  // pays one percent and skill 1 gives Homicide a half-percent chance and the
  // two errors multiply. sleeveplan.arrivingFleet builds that shape; passing
  // today's rate here would overstate the help by four orders of magnitude.
  //
  // An unknown fleet contributes 0, which prices the grind as the player alone
  // — the direction that overstates the gate rather than a node's appeal.
  const assist = num(o.assistPerSec) && o.assistPerSec > 0 ? o.assistPerSec : 0
  const perSec = playerPerSec + assist
  if (!pos(perSec)) return { hours: null, why: 'homicide pays no karma at this success rate' }
  return { hours: remaining / perSec / 3600, perSec, playerPerSec, assistPerSec: assist, why: null }
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

  // THE GANG GRIND IS CONCURRENT, NOT A LEG.
  //
  // Karma is zeroed only by prestigeSourceFile — entering a BitNode — and
  // never by prestigeAugmentation, so it accumulates monotonically across
  // every install cycle of a node (PlayerObjectGeneralMethods.ts:146). The
  // grind therefore runs on the PLAYER'S WORK SLOT alongside the batcher's
  // climb; it does not stop scripts earning or levelling, and it is paid once
  // per node rather than once per cycle.
  //
  // The first version of this added it to the exit time. That was wrong in a
  // way that mattered: an 18.5h grind on top of a 53.3h exit made BitNode 10
  // look 16.2h cheaper overall and flipped the recommended order. Once the
  // grind is concurrent it adds wall-clock time only if it OUTLASTS the node.
  //
  // What it really costs is the work slot — faction reputation not earned for
  // those hours. exitHours does not model the work slot as a resource, so
  // that cost is REPORTED and never summed, the same discipline this module
  // applies to source-file value. `gangAdds` is the honest wall-clock figure.
  let gangGrind = 0
  let gangWhy = null
  if (gang?.wanted) {
    if (node === 2) gangWhy = 'BitNode 2 grants gang access outright'
    else if (!gang.haveSF2) gangWhy = 'no SF2 — no gang outside BitNode 2'
    else {
      const k = karmaHours({ chance: gang.chance, karma: gang.karma, focused: gang.focused, assistPerSec: gang.assistPerSec })
      if (k.hours === null) return { hours: null, why: `BitNode ${node}: ${k.why}` }
      gangGrind = k.hours
      gangWhy =
        `${k.hours.toFixed(1)}h of homicide to karma ${GANG_KARMA}, concurrent with the climb` +
        (k.assistPerSec > 0
          ? ` (${((k.assistPerSec / k.perSec) * 100).toFixed(1)}% of it from the sleeve fleet AS IT ARRIVES — reset to sync ${node === 10 ? BN10_SYNC_FLOOR : 1} and skill 1, not as it stands today)`
          : ' (no sleeve fleet priced — the player grinds it alone)')
    }
  }
  // Only the overhang is wall-clock.
  const gangAdds = Math.max(0, gangGrind - core.hours)

  return {
    hours: core.hours + gangAdds,
    exitHours: core.hours,
    gangGrindHours: gangGrind,
    gangAdds,
    workSlotHours: gangGrind,
    installs: core.installsFirst,
    atSearchEdge: !!policy.atSearchEdge,
    gangWhy,
    exitLevel,
    incomeRatio: inc.ratio,
    expRatio: exp.ratio,
    legs: core.legs,
    assumes: 'income scaled by ScriptHackMoney x ServerMaxMoney and experience by HackExpGain; growth-rate and security differences change the batcher shape and are not modelled',
    // What the projection cannot see in THIS node, named per row so a
    // comparison across nodes shows which rows are bounds rather than
    // estimates (CLAUDE.md: not simulated is published, never folded in).
    notModelled: (() => {
      const m = bitNodeMults(node)
      const out = []
      if (m && m.CloudServerLimit === 0) out.push('no cloud servers here (CloudServerLimit 0): the measured income was earned partly on a purchased fleet this node does not have — an optimistic income')
      if (node === 9) out.push('hacknet-server hash income, the main money in BitNode 9 (ScriptHackMoney x ServerMaxMoney = 0.001), is not in the projection — a pessimistic income')
      return out
    })(),
    why: null,
  }
}

/**
 * WHAT THE KARMA GRIND ACTUALLY COSTS.
 *
 * The grind adds no wall-clock — it hides inside the climb — but it is not
 * free, because the player's work slot is a resource with exactly one
 * occupant. exitHours prices two legs the slot can shorten, and they are
 * DIFFERENT legs:
 *
 *   hoard join money   $100b for Daedalus   <- crime money shortens this
 *   exit reputation    2.5m Daedalus rep    <- faction work shortens this
 *
 * So the question is not "how much is the slot worth" but "which leg is
 * binding". Homicide is not idle time: it pays money and combat experience
 * while it pays karma. In a node like BitNode 4, where money is nerfed to
 * 0.2 x 0.1125 and reputation only to 0.75, the crime money may well be worth
 * more than the reputation it displaces — and that is a result, not an
 * assumption, so this computes both and reports the difference.
 *
 * The slot is a time-average over the node: diverting it for `grindHours` out
 * of a node of H hours scales the reputation it earns by (1 - grindHours/H)
 * and adds crime money for the same fraction. H depends on those rates, so
 * this iterates to a fixed point and REFUSES rather than returning a
 * half-converged number.
 *
 * `o`: { node, from, measured, gates: {joinMoney, terminalRep, ...},
 *        slot: {repPerSec, crimeMoneyPerSec}, grindHours }
 */
export function workSlotCost(o = {}) {
  // 120 because the REAL gates make policies long: with Daedalus's $100b
  // hoard and 2.5m reputation in play, the optimum sat past 40 installs at
  // every reputation rate tried and the edge guard refused the lot. A
  // refusal is better than a wrong number, but a default that always refuses
  // is just a broken tool.
  const { node, from, measured = {}, gates = {}, slot = {}, grindHours, maxInstalls = 120, iters = 8 } = o
  if (!pos(grindHours)) return { costHours: null, why: 'no grind to price' }
  if (!num(slot.repPerSec) || slot.repPerSec < 0) return { costHours: null, why: 'work-slot reputation rate unreadable' }
  if (!num(slot.crimeMoneyPerSec) || slot.crimeMoneyPerSec < 0) return { costHours: null, why: 'crime money rate unreadable' }

  const inc = projectIncome(measured.incomePerSec, from, node)
  if (inc.why) return { costHours: null, why: inc.why }
  const exp = projectExp(measured.expPerSec, from, node)
  if (exp.why) return { costHours: null, why: exp.why }
  const exitLevel = exitLevelFor(node)
  if (!pos(exitLevel)) return { costHours: null, why: `BitNode ${node}: WorldDaemonDifficulty unreadable` }

  const run = (repPerSec, extraIncome) => {
    const p = bestExitPolicy({
      money: measured.money ?? 0,
      incomePerSec: inc.incomePerSec + extraIncome,
      hacking: measured.hacking,
      hackingExp: measured.hackingExp ?? 0,
      hackingMult: measured.hackingMult,
      expPerSec: exp.expPerSec,
      cycleHours: measured.cycleHours,
      multGainPerCycle: measured.multGainPerCycle,
      exitLevel,
      repPerSec,
      ...gates,
    }, maxInstalls)
    return p.best && p.best.hours !== null ? { hours: p.best.hours, edge: !!p.atSearchEdge, legs: p.best.legs } : null
  }

  // (a) the slot on faction work for the whole node.
  const faction = run(slot.repPerSec, 0)
  if (!faction) return { costHours: null, why: 'could not price the node with the work slot on faction work' }

  // (b) the slot diverted to homicide for grindHours — a time-average that
  // depends on the node length it is averaging over, hence the fixed point.
  let H = faction.hours
  let grind = null
  let converged = false
  for (let i = 0; i < iters; i++) {
    const share = Math.min(1, grindHours / Math.max(grindHours, H))
    grind = run(slot.repPerSec * (1 - share), slot.crimeMoneyPerSec * share)
    if (!grind) return { costHours: null, why: 'could not price the node with the work slot on homicide' }
    if (Math.abs(grind.hours - H) < 0.01) { converged = true; H = grind.hours; break }
    H = grind.hours
  }
  if (!converged) return { costHours: null, why: `the work-slot average did not converge in ${iters} iterations` }
  if (faction.edge || grind.edge) return { costHours: null, why: 'install search pinned at its edge — widen maxInstalls before trusting this' }

  return {
    costHours: grind.hours - faction.hours,
    withFactionWork: faction.hours,
    withGrind: grind.hours,
    grindShare: Math.min(1, grindHours / Math.max(grindHours, grind.hours)),
    // Both rates are per SECOND and grindHours is in hours — the first cut
    // multiplied them directly and under-reported by 3600x.
    repForgone: slot.repPerSec * grindHours * 3600,
    moneyEarned: slot.crimeMoneyPerSec * grindHours * 3600,
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
      gangGrindHours: r.gangGrindHours ?? null,
      gangAdds: r.gangAdds ?? null,
      workSlotHours: r.workSlotHours ?? null,
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
