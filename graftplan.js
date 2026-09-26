// GRAFTING, PRICED IN HOURS OFF THE EXIT — not in augmentations acquired.
//
// Grafting (BitNode 10 / Source-File 10) buys an augmentation for MONEY and
// TIME, with no faction reputation and no install: applyAugmentation runs the
// moment the work finishes (GraftingWork.tsx:50). The bill is Entropy — one
// stack per graft, multiplying EVERY player multiplier by 0.98
// (EntropyAccumulation.ts, CONSTANTS.EntropyEffect).
//
// ---------------------------------------------------------------------------
// WHY THIS MODULE EXISTS, AND THE MISTAKE IT ENCODES AGAINST.
//
// Asked by hand on 2026-09-23 whether to graft, the first answer was NO, at a
// cost of 114 hours. That answer priced the wrong strategy: "graft the 24
// CHEAPEST augmentations to reach the Daedalus 30-augmentation gate". The
// cheapest augmentations are the WORST possible grafts — each costs a flat 2%
// on every multiplier and returns almost nothing (BitWire, +5% hacking).
//
// Optimised properly against the same live inputs, the answer inverts: six
// grafts, $3.70b, 5.2h of work slot, SAVING 64.9h of a 683h exit. Five of the
// six are reputation multipliers, because the exit's reputation leg is 196h —
// 29% of the whole trajectory — and `faction_rep` also multiplies DONATED
// reputation (Faction/formulas/donation.ts:8), so it keeps paying after the
// grind leg collapses at 150 favour.
//
// The lesson is the one this repo keeps relearning: a strategy priced once, in
// the shape it first occurred to someone, is not a priced strategy. So this
// module SEARCHES — greedily, on the actual exit delta — rather than ranking
// by any proxy. A proxy was what got it wrong twice: first "cheapest", then a
// hand-built multiplier score that still picked the wrong six.
//
// And then a third time, in the search itself (2026-09-26): the 64.9h above
// came from "exit with the multipliers bumped from now, minus the slot hours",
// money checked against a budget — a graft priced as if paid for in the final
// window but credited to every earlier life. Since then the graft is a leg of
// the simulated trajectory (exitplan `finalGrafts`: paid from the final
// window's money, run on the work slot, entropy included), and the decision
// is withH - withoutH (chooseGrafts), committed through plan.js
// (progress.js graftDecisionOf) and executed only when the final window is
// now.
// ---------------------------------------------------------------------------
import { drain } from 'coop.js'

const num = (v) => typeof v === 'number' && isFinite(v)

/** CONSTANTS.AugmentationGraftingCostMult. */
export const GRAFT_COST_MULT = 3
/** CONSTANTS.AugmentationGraftingTimeBase and MillisecondsPerHalfHour. */
export const GRAFT_TIME_BASE_MS = 3600000
export const HALF_HOUR_MS = 1800000
/** CONSTANTS.EntropyEffect — raised to the stack count, times every mult. */
export const ENTROPY_EFFECT = 0.98
/** graftAugmentation THROWS anywhere else (NetscriptFunctions/Grafting.ts:58). */
export const GRAFT_CITY = 'New Tokyo'

/** PersonObjects/formulas/intelligence.ts:1, at weight 1 — GraftingHelpers'
 *  graftingIntBonus divides the time by this. */
export const graftingIntBonus = (intelligence) => 1 + Math.pow(num(intelligence) && intelligence > 0 ? intelligence : 0, 0.8) / 600

export function graftCost(baseCost) {
  if (!num(baseCost) || baseCost < 0) return null
  return baseCost * GRAFT_COST_MULT
}

/**
 * GraftableAugmentation.time — `(TimeBase * log2(sum of non-1 mults) + 30min)/2`,
 * then divided by the intelligence bonus. The sum is over multiplier VALUES,
 * not their excess over 1, which is why a six-multiplier Neurotrainer takes far
 * longer than a single +8% hacking implant.
 */
export function graftTimeMs(mults, intelligence) {
  if (!mults || typeof mults !== 'object') return null
  const sum = Object.values(mults).filter((x) => num(x) && x !== 1).reduce((a, c) => a + c, 0)
  const ms = (GRAFT_TIME_BASE_MS * Math.log2(Math.max(sum, 1)) + HALF_HOUR_MS) / 2
  const bonus = graftingIntBonus(intelligence)
  return bonus > 0 ? ms / bonus : null
}

/** Every player multiplier is scaled by this. Sleeves are NOT — applyEntropy
 *  rewrites Player.mults alone, so fleet output is entropy-immune. */
export function entropyNerf(stacks) {
  if (!num(stacks) || stacks < 0) return null
  return Math.pow(ENTROPY_EFFECT, stacks)
}

/**
 * Are this augmentation's prerequisites satisfied?
 *
 * THE TRAP: `getGraftingAvailableAugs()` does NOT filter on prerequisites, so
 * an augmentation appears in `ns.grafting.getGraftableAugmentations()` and then
 * `graftAugmentation` RETURNS FALSE for it (Grafting.ts:74) rather than
 * throwing. A planner that trusts the list, and an actor that ignores the
 * return value, together produce a graft that was reported as started and
 * never was. 34 augmentations in the game carry prerequisites.
 */
export function prereqsMet(aug, ownedNames) {
  const pre = Array.isArray(aug?.prereqs) ? aug.prereqs : []
  if (!pre.length) return true
  const have = ownedNames instanceof Set ? ownedNames : new Set(Array.isArray(ownedNames) ? ownedNames : [])
  return pre.every((p) => have.has(p))
}

/**
 * chooseGrafts (below) REFUSES — returns `{ grafts: null, why }` — rather than guessing whenever the
 * exit cannot be priced or the inputs are unreadable. A graft is money spent
 * and entropy that survives every install until the BitNode ends
 * (Prestige.ts:128 re-applies it; only prestigeSourceFile clears it), so a
 * guess here is not recoverable by noticing later.
 */
/**
 * The prerequisite chain an augmentation needs, in graft order, from a pool.
 * Returns [] when nothing is needed and null when a link is missing from the
 * pool entirely — which is a refusal, not an empty chain.
 */
function chainFor(aug, ownedNames, pool, seen = new Set()) {
  const out = []
  for (const name of Array.isArray(aug?.prereqs) ? aug.prereqs : []) {
    if (ownedNames.has(name) || seen.has(name)) continue
    const link = pool.find((p) => p.name === name)
    if (!link) return null
    seen.add(name)
    const deeper = chainFor(link, ownedNames, pool, seen)
    if (deeper === null) return null
    out.push(...deeper, link)
  }
  return out
}

/**
 * ONE GRAFT AS THE EXIT SIMULATOR TAKES IT (exitplan finalGrafts): the cost
 * (baseCost x 3), the work-slot hours at focus (GraftingWork.process: rate x
 * intelligence bonus x focusPenalty, which is 1 focused), and the multipliers
 * the exit legs read — hacking (the climb), hacking_exp (the exp rate) and
 * faction_rep (the reputation leg) — each with the graft's entropy stack
 * (x0.98 on EVERY player multiplier, GraftingWork.tsx:61-63) folded in, unless
 * the Congruity Implant is owned (`entropy: false`). Null when unreadable.
 */
export function graftSpecOf(aug, intelligence, { entropy = true } = {}) {
  const cost = graftCost(aug?.baseCost)
  const ms = graftTimeMs(aug?.mults, intelligence)
  if (cost === null || !(cost > 0) || ms === null) return null
  const e = entropy ? ENTROPY_EFFECT : 1
  const m = (k) => (num(aug.mults[k]) && aug.mults[k] > 0 ? aug.mults[k] : 1)
  return { name: aug.name, cost, slotH: ms / 3600000, hacking: m('hacking') * e, exp: m('hacking_exp') * e, rep: m('faction_rep') * e }
}

/** The graft-start balances the with-run searches, as fractions of join money + every graft's cost. */
export const GRAFT_START_FRACTIONS = [0, 0.1, 0.3, 0.6, 1]

/** Could this augmentation shorten the exit at all? Only through a channel the exit legs read. */
const moves = (a) => ['hacking', 'hacking_exp', 'faction_rep'].some((k) => num(a?.mults?.[k]) && a.mults[k] > 1)

/**
 * WHICH AUGMENTATIONS TO GRAFT, IN WHICH ORDER — trajectory against
 * trajectory. `priceExit(inputs)` is exitplan.bestExitPolicy's hours (the
 * caller wraps it, so this module stays pure); the without-run is `base` with
 * no grafts, the with-run the SAME inputs plus `finalGrafts` (graftSpecOf per
 * graft), which the simulator pays for out of the final window's money, runs
 * on the work slot one at a time, and applies to the climb. The money, the
 * slot hours and the entropy are all INSIDE the comparison:
 * `deltaH = withH - withoutH`, nothing subtracted beside it.
 *
 * The shortcut this replaced — `baseline - hours - slotHours` on inputs whose
 * multipliers were bumped from NOW for the whole node, with the money only
 * checked against a budget — credited a graft paid for later with every
 * earlier life's climb. On the live BitNode 8 inputs of 2026-09-26 it
 * reported 61h saved where grafting now (from a $0.3b life) costs +0.8h.
 *
 * Greedy on the with-run's exit, a prerequisite chain taken as one step;
 * stops when nothing shortens it, so "graft nothing" is a result. `budgetMs`
 * bounds the search (it runs on the game's main thread): a stop is published
 * as `truncated`.
 */
export function chooseGrafts(o = {}) {
  return drain(chooseGraftsGen(o))
}
/**
 * The generator chooseGrafts drains: yields after every exit simulation, so
 * progress.js can run the search in slices (coop.js) and give the page back.
 * `o.now` is the budget's clock (the pacer's work clock there: a pause does
 * not count against budgetMs).
 */
export function* chooseGraftsGen(o = {}) {
  const { candidates, priceExit, base, intelligence, ownedNames } = o
  const maxGrafts = num(o.maxGrafts) && o.maxGrafts > 0 ? o.maxGrafts : 12
  const entropy = o.entropy !== false
  const budgetMs = num(o.budgetMs) && o.budgetMs > 0 ? o.budgetMs : Infinity
  const clock = typeof o.now === 'function' ? o.now : () => Date.now()
  if (typeof priceExit !== 'function') return { grafts: null, why: 'no exit pricing function supplied' }
  if (!base || typeof base !== 'object') return { grafts: null, why: 'no exit policy inputs' }
  if (!Array.isArray(candidates)) return { grafts: null, why: 'no graft candidates supplied' }
  const without = { ...base }
  delete without.finalGrafts
  const baseline = priceExit(without)
  yield
  if (!num(baseline)) return { grafts: null, why: 'the exit could not be priced without grafting — nothing to compare against' }

  const owned = new Set(Array.isArray(ownedNames) ? ownedNames : [])
  // Only what the game would let us graft (not special, not owned), and
  // priceable. Prerequisites stay in `all` whatever they move: a weak G1 is
  // the price of the G2 behind it.
  const all = candidates.filter((a) => a && typeof a.name === 'string' && a.isSpecial !== true && !owned.has(a.name) && num(a.baseCost) && a.baseCost > 0 && a.mults && typeof a.mults === 'object' && graftSpecOf(a, intelligence) !== null)
  const pool = all.filter(moves)
  const none = (why) => ({ grafts: [], baseline, withoutH: baseline, withH: baseline, exitHours: baseline, deltaH: 0, netHours: 0, slotHours: 0, spend: 0, truncated: false, why })
  if (!pool.length) return none('no graftable augmentation moves the exit — grafting nothing')

  // The with-run's own policy parameter, searched like an install time: the
  // balance at which the grafting starts, as a fraction of what the window
  // must hold in all (the join money plus every graft). 0 = as soon as each
  // is affordable; 1 = after the whole hoard.
  const join = num(without.joinMoney) && without.joinMoney > 0 ? without.joinMoney : 0
  const withRunAt = function* (set) {
    const specs = set.map((a) => graftSpecOf(a, intelligence, { entropy }))
    const total = join + specs.reduce((x, g) => x + g.cost, 0)
    let best = null
    for (const f of GRAFT_START_FRACTIONS) {
      const hours = priceExit({ ...without, finalGrafts: specs, graftStartMoney: f * total })
      yield
      if (num(hours) && (!best || hours < best.h)) best = { h: hours, startMoney: f * total, fraction: f }
    }
    return best
  }
  const withRun = function* (set) {
    return (yield* withRunAt(set))?.h ?? null
  }
  const chosen = []
  let bestH = baseline
  let truncated = false
  const t0 = clock()
  // RESUME FROM A COMMITTED SET (o.seed, names in graft order): a search the
  // CPU budget stopped continues from where the plan stands next time,
  // instead of restarting and stopping at the same place. Kept only while it
  // still beats grafting nothing on today's inputs.
  if (Array.isArray(o.seed) && o.seed.length) {
    const seeded = []
    for (const n of o.seed) {
      const a = all.find((x) => x.name === n)
      if (!a || !prereqsMet(a, new Set([...owned, ...seeded.map((s) => s.name)]))) break
      seeded.push(a)
    }
    const h = seeded.length ? yield* withRun(seeded) : null
    if (h !== null && h < baseline) {
      chosen.push(...seeded)
      bestH = h
    }
  }
  for (let step = 0; step < maxGrafts && !truncated; step++) {
    let best = null
    for (const a of pool) {
      if (clock() - t0 > budgetMs) {
        truncated = true
        break
      }
      if (chosen.includes(a)) continue
      const willOwn = new Set([...owned, ...chosen.map((c) => c.name)])
      // A CHAIN IS ONE STEP: greedy on single additions cannot see through a
      // prerequisite that is individually negative to the strong augmentation
      // behind it, so a candidate whose prerequisites are unmet is evaluated
      // as the whole bundle it needs. chainFor returns null for a MISSING
      // link — a refusal, not an empty chain.
      const chain = prereqsMet(a, willOwn) ? [] : chainFor(a, willOwn, all)
      if (chain === null) continue
      const bundle = [...chain, a]
      if (!bundle.every((x, i) => prereqsMet(x, new Set([...willOwn, ...bundle.slice(0, i).map((y) => y.name)])))) continue
      const h = yield* withRun([...chosen, ...bundle])
      if (h === null) continue
      if (!best || h < best.h) best = { bundle, h }
    }
    if (!best || !(best.h < bestH)) break
    chosen.push(...best.bundle)
    bestH = best.h
  }

  if (!chosen.length) return { ...none(`grafting nothing: no graft shortens the simulated exit (${baseline.toFixed(2)}h without)${truncated ? ' — search stopped at its CPU budget' : ''}`), truncated }
  const specs = chosen.map((a) => graftSpecOf(a, intelligence, { entropy }))
  const spend = specs.reduce((x, g) => x + g.cost, 0)
  const slotHours = specs.reduce((x, g) => x + g.slotH, 0)
  const start = yield* withRunAt(chosen)
  return {
    startMoney: start?.startMoney ?? null,
    startFraction: start?.fraction ?? null,
    grafts: chosen.map((a, i) => ({ name: a.name, cost: specs[i].cost, timeMs: specs[i].slotH * 3600000, mults: a.mults, spec: specs[i] })),
    baseline,
    withoutH: baseline,
    withH: bestH,
    exitHours: bestH,
    deltaH: bestH - baseline,
    netHours: baseline - bestH,
    slotHours,
    spend,
    truncated,
    entropyAfter: (num(o.entropy0) ? o.entropy0 : 0) + (entropy ? chosen.length : 0),
    city: GRAFT_CITY,
    why: `${chosen.length} graft(s) in the final window for $${(spend / 1e9).toFixed(2)}b and ${slotHours.toFixed(1)}h of work slot: exit ${baseline.toFixed(2)}h without -> ${bestH.toFixed(2)}h with (entropy ${ENTROPY_EFFECT}^${chosen.length} on every multiplier inside the run)${truncated ? ' — search stopped at its CPU budget' : ''}`,
  }
}

/**
 * THE GRAFT CANDIDATES from the planner's snapshots: every catalogue
 * augmentation not owned or queued, with its stats, prerequisites and BASE
 * price. graftCost is `augmentation.baseCost x 3` (GraftableAugmentation.ts)
 * — the raw base, with neither the BitNode's AugmentationMoneyCost nor the
 * queue multiplier — while the snapshot's price is getAugCost's
 * `baseCost x AugmentationMoneyCost x (1.9 x SF11 factor)^queuedNonSoA`
 * (AugmentationHelpers.ts), so it is divided back out here. The special
 * augmentations (NOT_GRAFTABLE: getGraftingAvailableAugs drops isSpecial)
 * are excluded by name. The actor still reads the game's refusal
 * (act-graft.js), so a price divided back wrongly fails loud, not silent.
 *
 * o: {names, stats, prereqs, price, owned (Set|array), augMoneyCost,
 *     queuedNonSoA, sf11}. Returns [] with nothing readable, never throws.
 */
// Every augmentation with `isSpecial: true` in Augmentations.ts — which
// getGraftingAvailableAugs drops (GraftingHelpers.ts:15). NeuroFlux and the
// Red Pill are among them. [GP7] re-derives this list from source.
export const NOT_GRAFTABLE = new Set(["SoA - Beauty of Aphrodite", "BigD's Big ... Brain", 'BLADE-51b Tesla Armor', 'BLADE-51b Tesla Armor: Energy Shielding Upgrade', 'BLADE-51b Tesla Armor: IPU Upgrade', 'BLADE-51b Tesla Armor: Omnibeam Upgrade', 'BLADE-51b Tesla Armor: Power Cells Upgrade', 'BLADE-51b Tesla Armor: Unibeam Upgrade', "Blade's Runners", "The Blade's Simulacrum", 'SoA - Chaos of Dionysus', 'EMS-4 Recombination', 'EsperTech Bladeburner Eyewear', 'SoA - Flood of Poseidon', 'GOLEM Serum', 'SoA - Hunt of Artemis', 'Hyperion Plasma Cannon V1', 'Hyperion Plasma Cannon V2', 'I.N.T.E.R.L.I.N.K.E.D', 'SoA - Knowledge of Apollo', 'SoA - Might of Ares', 'NeuroFlux Governor', 'ORION-MKIV Shoulder', "Stanek's Gift - Genesis", "Stanek's Gift - Awakening", "Stanek's Gift - Serenity", 'The W1ngs of Icarus', 'The B00ts of Perseus', 'The H4mmer of Daedalus', 'The St4ff of Asclepius', 'The L4w of Bayes', 'The B1ade of Solomonoff', 'The Red Pill', 'SoA - Trickery of Hermes', 'Vangelis Virus', 'Vangelis Virus 3.0', 'SoA - phyzical WKS harmonizer', 'SoA - Wisdom of Athena', 'Z.O.Ë.'])
export function graftCandidatesOf(o = {}) {
  const owned = o.owned instanceof Set ? o.owned : new Set(Array.isArray(o.owned) ? o.owned : [])
  const amc = num(o.augMoneyCost) && o.augMoneyCost > 0 ? o.augMoneyCost : null
  if (amc === null) return []
  const q = num(o.queuedNonSoA) && o.queuedNonSoA >= 0 ? o.queuedNonSoA : 0
  const sf11 = num(o.sf11) ? Math.min(3, Math.max(0, Math.floor(o.sf11))) : 0
  const queueMult = Math.pow(1.9 * [1, 0.96, 0.94, 0.93][sf11], q)
  const out = []
  for (const name of o.names ?? []) {
    if (owned.has(name) || NOT_GRAFTABLE.has(name)) continue
    const stats = o.stats?.[name]
    const price = o.price?.[name]
    if (!stats || !num(price) || !(price > 0)) continue
    const mults = Object.fromEntries(Object.entries(stats).filter(([, v]) => num(v) && v !== 1))
    out.push({ name, mults, baseCost: price / amc / queueMult, prereqs: Array.isArray(o.prereqs?.[name]) ? o.prereqs[name] : [] })
  }
  return out
}
