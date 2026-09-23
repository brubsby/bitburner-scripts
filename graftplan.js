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
// module SEARCHES — greedily, on the actual exit delta, net of the work slot
// the graft consumes — rather than ranking by any proxy. A proxy was what got
// it wrong twice: first "cheapest", then a hand-built multiplier score that
// still picked the wrong six.
// ---------------------------------------------------------------------------
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
 * WHICH AUGMENTATIONS TO GRAFT, IN WHICH ORDER.
 *
 * Greedy on the marginal NET hours each addition buys: the exit trajectory
 * re-priced with the set's multipliers and its entropy, minus the work-slot
 * hours the grafts themselves consume. Stops as soon as nothing improves, so
 * "graft nothing" is a result this can return rather than a case it cannot
 * express.
 *
 * `priceExit` is injected (exitplan.bestExitPolicy, wrapped) so this module
 * stays pure and testable, the same way gangworth takes it.
 *
 * REFUSES — returns `{ grafts: null, why }` — rather than guessing whenever the
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

export function chooseGrafts(o = {}) {
  const { candidates, priceExit, base, money, intelligence, ownedNames } = o
  const entropy0 = num(o.entropy0) && o.entropy0 >= 0 ? o.entropy0 : 0
  const maxGrafts = num(o.maxGrafts) && o.maxGrafts > 0 ? o.maxGrafts : 12
  if (typeof priceExit !== 'function') return { grafts: null, why: 'no exit pricing function supplied' }
  if (!base || typeof base !== 'object') return { grafts: null, why: 'no exit policy inputs' }
  if (!Array.isArray(candidates)) return { grafts: null, why: 'no graft candidates supplied' }
  if (!num(money) || money < 0) return { grafts: null, why: 'money unreadable — refusing to plan a spend' }

  const baseline = priceExit(base)
  if (!num(baseline)) return { grafts: null, why: 'the exit could not be priced without grafting — nothing to compare against' }

  // Only what the game would actually let us graft.
  const pool = candidates.filter((a) => {
    if (!a || typeof a.name !== 'string') return false
    if (a.isSpecial === true) return false
    if (!num(a.baseCost) || a.baseCost <= 0) return false
    if (!a.mults || typeof a.mults !== 'object') return false
    return true
  })
  if (!pool.length) return { grafts: [], baseline, netHours: 0, why: 'no graftable augmentation is priceable — grafting nothing' }

  const owned = new Set(Array.isArray(ownedNames) ? ownedNames : [])
  const chosen = []
  let spent = 0
  let bestNet = 0
  const evaluate = (set) => {
    const nerf = entropyNerf(entropy0 + set.length)
    if (nerf === null) return null
    const prod = (k) => set.reduce((a, c) => a * (num(c.mults[k]) ? c.mults[k] : 1), 1)
    const slotHours = set.reduce((a, c) => a + (graftTimeMs(c.mults, intelligence) ?? 0), 0) / 3600000
    const hours = priceExit({
      ...base,
      hackingMult: num(base.hackingMult) ? base.hackingMult * prod('hacking') * nerf : base.hackingMult,
      expPerSec: num(base.expPerSec) ? base.expPerSec * prod('hacking_exp') * nerf : base.expPerSec,
      repPerSec: num(base.repPerSec) ? base.repPerSec * prod('faction_rep') * nerf : base.repPerSec,
    })
    if (!num(hours)) return null
    return { hours, slotHours, net: baseline - hours - slotHours }
  }

  for (let step = 0; step < maxGrafts; step++) {
    let best = null
    for (const a of pool) {
      if (chosen.includes(a)) continue
      const cost = graftCost(a.baseCost)
      if (cost === null || spent + cost > money) continue
      // Prerequisites are enforced at graft time even though the availability
      // list ignores them, so the ORDER matters: an augmentation is only
      // reachable once its prerequisites are owned or already earlier in this
      // plan.
      const willOwn = new Set([...owned, ...chosen.map((c) => c.name)])
      // A CHAIN IS ONE STEP. Greedy on single additions cannot see through a
      // prerequisite that is individually negative to the strong augmentation
      // behind it — and prerequisites are exactly where that happens, since a
      // G1 implant is deliberately weaker than its G2. So a candidate whose
      // prerequisites are unmet is evaluated as the whole BUNDLE it would
      // require, and taken or rejected as one.
      // chainFor returns null for a MISSING link — a refusal, not an empty
      // chain — so it is checked before it is spread.
      const chain = prereqsMet(a, willOwn) ? [] : chainFor(a, willOwn, pool)
      if (chain === null) continue
      const bundle = [...chain, a]
      const bundleCost = bundle.reduce((x, c) => x + (graftCost(c.baseCost) ?? Infinity), 0)
      if (!isFinite(bundleCost) || spent + bundleCost > money) continue
      // Still unreachable after pulling its chain in (a missing link).
      if (!bundle.every((x, i) => prereqsMet(x, new Set([...willOwn, ...bundle.slice(0, i).map((y) => y.name)])))) continue
      const v = evaluate([...chosen, ...bundle])
      if (!v) continue
      if (!best || v.net > best.v.net) best = { bundle, v, cost: bundleCost }
    }
    if (!best || !(best.v.net > bestNet)) break
    chosen.push(...best.bundle)
    spent += best.cost
    bestNet = best.v.net
  }

  const final = evaluate(chosen)
  return {
    grafts: chosen.map((a) => ({ name: a.name, cost: graftCost(a.baseCost), timeMs: graftTimeMs(a.mults, intelligence), mults: a.mults })),
    baseline,
    exitHours: final ? final.hours : baseline,
    slotHours: final ? final.slotHours : 0,
    netHours: bestNet,
    spend: spent,
    entropyAfter: entropy0 + chosen.length,
    city: GRAFT_CITY,
    why: chosen.length
      ? `${chosen.length} graft(s) for $${(spent / 1e9).toFixed(2)}b and ${(final?.slotHours ?? 0).toFixed(1)}h of work slot, cutting the exit ${baseline.toFixed(1)}h -> ${(final?.hours ?? baseline).toFixed(1)}h — net ${bestNet.toFixed(1)}h after the slot time, at ${ENTROPY_EFFECT}^${chosen.length} on every player multiplier`
      : `grafting nothing: no augmentation affordable within $${(money / 1e9).toFixed(2)}b repays its own entropy here`,
  }
}
