// What to buy, and in what order — pure arithmetic, no ns calls, no DOM.
//
//   import { buildPlan, SOA_AUGS, NFG, AUG_PRICE_MULT } from 'augplan.js'
//
// Importing this is free: it references no ns function at all, so it costs the
// script base (1.6GB) inside its importer and nothing extra. That matters more
// here than anywhere else in the repo, because the scripts that need this logic
// are already carrying 12-14GB of Singularity surface on a 32GB home.
//
// Keeping it pure also means the buy-order argument can be *tested* under plain
// node, against a step-by-step simulation of the game's own cost rule and
// against brute-force enumeration of every possible order — instead of being
// tested by spending money in a live save. It was, and the test changed the
// answer. See NOTES-shop.md.
//
// ---------------------------------------------------------------------------
// The cost rules everything here is built on, read from game source.
//
// Augmentation/AugmentationHelpers.ts:29-36
//   getBaseAugmentationPriceMultiplier()    -> CONSTANTS.MultipleAugMultiplier
//                                              * [1,0.96,0.94,0.93][SF11 level]
//   getGenericAugmentationPriceMultiplier() -> that ^ (number of queued
//                                              augmentations whose name is NOT
//                                              in soaAugmentationNames)
//   CONSTANTS.MultipleAugMultiplier = 1.9   (Constants.ts:41)
//
// Augmentation/AugmentationHelpers.ts:128-160, getAugCost():
//   NeuroFlux Governor
//       multiplier = 1.14 ^ aug.getLevel()      (Constants.ts:36)
//       repCost    = baseRep  * multiplier * BN.AugmentationRepCost
//       moneyCost  = baseCost * multiplier * BN.AugmentationMoneyCost
//                             * getGenericAugmentationPriceMultiplier()
//   SoA augmentations (the nine in soaAugmentationNames)
//       moneyCost  = baseCost * 7   ^ (SoA augs already INSTALLED)
//       repCost    = baseRep  * 1.3 ^ (SoA augs already INSTALLED)
//       — no 1.9^queued term, and they do not count toward anyone else's.
//   everything else
//       moneyCost  = baseCost * getGenericAugmentationPriceMultiplier()
//                             * BN.AugmentationMoneyCost
//       repCost    = baseRep  * BN.AugmentationRepCost
//
// Three consequences, all load-bearing below:
//
//   1. **Money cost is multiplied by 1.9 for each already-queued augmentation;
//      reputation cost is not.** Reputation is a gate, not a budget — buying an
//      augmentation does not spend it (FactionHelpers.tsx:118-120 calls only
//      Player.loseMoney), so two augmentations from one faction each need rep
//      >= their own requirement and that is all.
//
//   2. **NeuroFlux is the only repeatable augmentation, and every queued NFG
//      counts toward its own 1.9^queued exponent** (Augmentation.ts:238-246:
//      getLevel() = owned level + number of queued NFGs). So one level costs
//      1.14 * 1.9 = 2.166x the previous one *within a single install cycle*,
//      and the 1.9 part of that resets at install while the 1.14 part does not.
//      That is the wall.
//
//   3. Whatever order is used, the cost of the j-th purchase is
//      `intrinsic_j * 1.9^j`, where `intrinsic` is the price the game would
//      quote with nothing yet queued in this run — the live price for an
//      ordinary augmentation, and `nfgPrice * 1.14^(levels already taken)` for
//      NeuroFlux. Everything about ordering is therefore a question of which
//      item deserves the small exponents.
//
// In BitNode 4 both BitNode multipliers above are 1 (BitNode/BitNode.tsx:627-655
// sets neither AugmentationMoneyCost nor AugmentationRepCost, so the defaults at
// BitNodeMultipliers.ts:13,16 apply). Nothing here reads them: prices come from
// ns.singularity.getAugmentationPrice, which has already applied them.
// ---------------------------------------------------------------------------

/** CONSTANTS.MultipleAugMultiplier, Constants.ts:41. */
export const AUG_PRICE_MULT = 1.9

/** CONSTANTS.NeuroFluxGovernorLevelMult, Constants.ts:36. */
export const NFG_LEVEL_MULT = 1.14

/** What one more NeuroFlux level costs relative to the last, inside one cycle. */
export const NFG_STEP = AUG_PRICE_MULT * NFG_LEVEL_MULT // 2.166

export const NFG = 'NeuroFlux Governor'

/**
 * soaAugmentationNames, AugmentationHelpers.ts:16-27.
 *
 * Transcribed rather than fetched because ns.singularity has no call that
 * returns this list, and the alternative — getAugmentationBasePrice, documented
 * at Singularity.ts:140-150 as the one call that skips the BitNode money
 * multiplier for exactly these nine — costs 2.5GB to answer a question whose
 * answer is a constant. They come from Shadows of Anarchy, an infiltration
 * faction, so a hacking bot normally sees none of them; getting this list wrong
 * shows up as a mispriced plan, not as a wrong purchase, because the executor
 * re-reads every price from the game before it spends.
 */
export const SOA_AUGS = [
  'Beauty of Aphrodite',
  'Chaos of Dionysus',
  'Flood of Poseidon',
  'Hunt of Artemis',
  'Knowledge of Apollo',
  'Might of Ares',
  'Trickery of Hermes',
  'WKS Harmonizer',
  'Wisdom of Athena',
]

export const isSoa = (name) => SOA_AUGS.includes(name)

/**
 * What `t` NeuroFlux levels cost as one contiguous block, starting `from`
 * levels into the run, priced as if the block began at position 0.
 *
 * Level (from+q) has intrinsic price first * 1.14^(from+q) and sits at internal
 * position q, so it costs that times 1.9^q — and the whole block is a geometric
 * series in 1.9*1.14. Closed form rather than a loop because it is evaluated
 * inside a search over block lengths. Checked against a purchase-by-purchase
 * simulation of getAugCost to 2e-15 relative error.
 */
export function nfgChainCost(first, from, t) {
  if (!(t > 0) || !(first > 0)) return 0
  return (first * Math.pow(NFG_LEVEL_MULT, from) * (Math.pow(NFG_STEP, t) - 1)) / (NFG_STEP - 1)
}

/** The whole NeuroFlux block, from the next level, k levels deep. */
export const nfgBlockCost = (first, k) => nfgChainCost(first, 0, k)

/**
 * What a list of ordinary augmentations costs when `offset` other non-SoA
 * augmentations are queued ahead of them in the same run.
 */
export function augBlockCost(list, offset = 0) {
  let sum = 0
  for (let j = 0; j < list.length; j++) sum += list[j].price * Math.pow(AUG_PRICE_MULT, offset + j)
  return sum
}

/**
 * How many NeuroFlux levels the reputation allows, given the next level's
 * requirement.
 *
 * repCost for level j is baseRep * 1.14^(L0+j) = repReq * 1.14^j, and
 * reputation is not consumed, so this is a threshold rather than a budget.
 */
export function nfgLevelsRepAllows(repReq, rep) {
  if (!(repReq > 0)) return 0
  if (rep < repReq) return 0
  return Math.floor(Math.log(rep / repReq) / Math.log(NFG_LEVEL_MULT)) + 1
}

/**
 * The cheapest order for a fixed shopping list. This is the whole argument.
 *
 * -- the rule for items with no precedence ---------------------------------
 * Total spend is sum_j intrinsic_j * 1.9^j: the weights are fixed by POSITION,
 * not by item. By the rearrangement inequality the sum of products of two
 * sequences is minimised when one ascends against the other descending, so
 * pairing the largest price with the smallest weight — **most expensive
 * first** — is optimal. Not a heuristic; for a fixed set it is the cheapest
 * order that exists. Confirmed by enumerating every permutation of random sets:
 * zero counterexamples.
 *
 * -- what NeuroFlux breaks --------------------------------------------------
 * NeuroFlux levels must be taken in ASCENDING level order (you cannot buy level
 * 9 before level 8) while their intrinsic prices ASCEND at 1.14x a level. So
 * they are a precedence chain in exactly the wrong order, and "most expensive
 * first" cannot be applied to them.
 *
 * -- the rule that covers both ---------------------------------------------
 * Exchange argument on adjacent BLOCKS. For block B (size s, internal cost C_B)
 * immediately before block C (size t, internal cost C_C), swapping them changes
 * the total from C_B + 1.9^s*C_C to C_C + 1.9^t*C_B, so B belongs first iff
 *
 *     C_B / (1.9^s - 1)  >  C_C / (1.9^t - 1)
 *
 * Call that ratio rho. For a singleton it is price/0.9, i.e. ordering singletons
 * by rho *is* "most expensive first". So the general algorithm is: at each step
 * take whichever is available with the highest rho — the next ordinary
 * augmentation, or the best PREFIX of the NeuroFlux chain. (This is Sidney's
 * decomposition for scheduling with chain precedence, specialised to a
 * geometric cost.)
 *
 * Checked by brute force against every possible interleaving of random
 * instances: **exactly optimal on 400/400**, against "always NeuroFlux first"
 * or "always augmentations first", the better of which was still up to 4.3x
 * worse than optimal and wrong on 137/400.
 *
 * -- what this means for "buy NeuroFlux first" ------------------------------
 * That rule (CLAUDE.md, install procedure step 3) is the correct answer in the
 * regime it was learned in — the BitNode 1 endgame, where every ordinary
 * augmentation was already owned and the NeuroFlux levels being bought were
 * deep enough to be the most expensive items in the game. It is rho picking the
 * chain. Early in a life it is the wrong answer, and expensively so: with a
 * realistic six-augmentation list against a $1t budget at NeuroFlux level 0,
 * NeuroFlux-first buys **5** levels and augmentations-first buys **13**. The
 * crossover for that list is around NeuroFlux level 50. `mode` exists so the
 * mandated order can still be forced, and the plan reports what each would have
 * cost either way.
 */
export function mergeOrder(augs, nfg, k, mode = 'best') {
  const M = AUG_PRICE_MULT
  const order = []
  let ai = 0
  let ni = 0
  let pos = 0
  let total = 0

  const takeAug = () => {
    const a = augs[ai++]
    const expected = a.price * Math.pow(M, pos)
    total += expected
    pos++
    order.push({ kind: 'aug', name: a.name, faction: a.faction, expected })
  }
  const takeNfg = () => {
    const expected = nfg.price * Math.pow(NFG_LEVEL_MULT, ni) * Math.pow(M, pos)
    total += expected
    ni++
    pos++
    order.push({ kind: 'nfg', name: NFG, faction: nfg.faction, expected })
  }

  while (ai < augs.length || ni < k) {
    if (ni >= k) {
      takeAug()
      continue
    }
    if (ai >= augs.length) {
      takeNfg()
      continue
    }
    if (mode === 'nfg-first') {
      takeNfg()
      continue
    }
    if (mode === 'augs-first') {
      takeAug()
      continue
    }

    // Best prefix of the remaining NeuroFlux chain. Longer prefixes can beat
    // shorter ones: the chain's cheap head drags its own ratio down, and taking
    // it together with the expensive tail it unlocks is sometimes what wins.
    let chainRho = -1
    for (let t = 1; t <= k - ni; t++) {
      const rho = nfgChainCost(nfg.price, ni, t) / (Math.pow(M, t) - 1)
      if (rho > chainRho) chainRho = rho
    }
    const augRho = augs[ai].price / (M - 1)
    // Ties go to NeuroFlux: identical cost either way, and it keeps the
    // behaviour on the side of the documented rule.
    if (chainRho >= augRho) takeNfg()
    else takeAug()
  }

  return { order, total }
}

/**
 * Build the purchase plan.
 *
 * input = {
 *   budget,                  // dollars we are willing to spend in total
 *   nfg: null | { faction, price, repReq, rep, maxLevels },
 *   augs: [ { name, faction, price, repReq, rep } ],
 *   mode: 'best' | 'nfg-first' | 'augs-first',
 * }
 *
 * `price` for every entry is the current ns.singularity.getAugmentationPrice
 * value, i.e. already multiplied by 1.9^(augmentations queued before now).
 */
export function buildPlan(input) {
  const budget = Math.max(0, input.budget || 0)
  const mode = input.mode || 'best'
  const all = (input.augs || []).map((a) => ({ ...a, soa: isSoa(a.name) }))

  const dropped = []
  const eligible = []
  for (const a of all) {
    if (!(a.rep >= a.repReq)) {
      // Recorded, not silently discarded: "which augmentation is one faction
      // errand away" is the most useful thing this file can tell the director,
      // and it is exactly what a filter throws away.
      dropped.push({ name: a.name, faction: a.faction, why: 'rep', need: a.repReq, have: a.rep })
      continue
    }
    eligible.push(a)
  }

  const regs = eligible.filter((a) => !a.soa).sort((a, b) => b.price - a.price)
  const soas = eligible.filter((a) => a.soa).sort((a, b) => b.price - a.price)

  const nfg = input.nfg && input.nfg.price > 0 ? input.nfg : null
  const repCap = nfg ? nfgLevelsRepAllows(nfg.repReq, nfg.rep) : 0
  const cap = nfg ? Math.min(repCap, nfg.maxLevels === undefined ? Infinity : nfg.maxLevels) : 0

  const costOf = (list, k) => (nfg || k === 0 ? mergeOrder(list, nfg || { price: 0 }, k, mode).total : augBlockCost(list, 0))

  // ---- 1. trim the ordinary augmentations to something we can pay for ------
  //
  // Dropping from the TAIL drops the cheapest, which under every ordering rule
  // here also carries the largest exponent — so each drop removes the most cost
  // per unit of value given up. Ordinary augmentations are selected against the
  // WHOLE budget, before NeuroFlux gets a look at it: a real augmentation is
  // worth far more than +1% to everything, and Daedalus counts DISTINCT
  // augmentations. NeuroFlux then takes whatever is left. Ordering (step 3) and
  // priority (this step) are separate decisions and it is easy to conflate them.
  const chosen = regs.slice()
  const overflow = []
  while (chosen.length && costOf(chosen, 0) > budget) overflow.push(chosen.pop())

  // ---- 2. backfill ---------------------------------------------------------
  //
  // Having bought the expensive ones, a cheap one may still fit in what is left.
  // Without this, $10b against augmentations of $9b / $1b / $0.5b buys one and
  // leaves $1b idle, when $9b + $0.5b*1.9 = $9.95b buys two.
  for (const a of overflow.slice().reverse()) {
    const trial = chosen.concat([a])
    if (costOf(trial, 0) <= budget) {
      chosen.length = 0
      chosen.push(...trial)
    }
  }
  for (const a of overflow) {
    if (!chosen.includes(a)) dropped.push({ name: a.name, faction: a.faction, why: 'money', price: a.price })
  }

  // ---- 3. how many NeuroFlux levels fit ------------------------------------
  //
  // Monotone in k — another level costs money AND pushes something else up an
  // exponent — so a linear scan finds the maximum without a search.
  let levels = 0
  let nfgStoppedBy = nfg ? null : 'unavailable'
  if (nfg) {
    while (levels < cap && costOf(chosen, levels + 1) <= budget) levels++
    nfgStoppedBy = levels >= cap ? (repCap <= levels ? 'rep' : 'cap') : 'money'
  }

  const merged = nfg ? mergeOrder(chosen, nfg, levels, mode) : { order: [], total: augBlockCost(chosen, 0) }
  const order = nfg
    ? merged.order
    : chosen.map((a, j) => ({ kind: 'aug', name: a.name, faction: a.faction, expected: a.price * Math.pow(AUG_PRICE_MULT, j) }))
  let total = nfg ? merged.total : augBlockCost(chosen, 0)

  // ---- 4. SoA augmentations ------------------------------------------------
  //
  // Order-independent in both directions: their price is 7^(SoA augs already
  // INSTALLED), which a purchase in this cycle does not change, and they are
  // excluded from everyone else's queued count (AugmentationHelpers.ts:32-36).
  // So they cost the same wherever they go, and go last, where a shortfall
  // costs nothing else.
  const soaChosen = []
  for (const a of soas) {
    if (total + a.price <= budget) {
      soaChosen.push(a)
      order.push({ kind: 'soa', name: a.name, faction: a.faction, expected: a.price })
      total += a.price
    } else {
      dropped.push({ name: a.name, faction: a.faction, why: 'money', price: a.price })
    }
  }

  // Running total, so the executor can say how far it got in dollars and a
  // reader can see where the money goes.
  let cumulative = 0
  order.forEach((o, j) => {
    cumulative += o.expected
    o.step = j
    o.cumulative = cumulative
  })

  // What the two fixed orders would have cost for exactly this set. Published
  // rather than merely used, because "buy NeuroFlux first" is written down as a
  // rule elsewhere in this repo and the place to settle an argument with a rule
  // is data, not a comment.
  const asNfgFirst = nfg ? mergeOrder(chosen, nfg, levels, 'nfg-first').total : total
  const asAugsFirst = nfg ? mergeOrder(chosen, nfg, levels, 'augs-first').total : total

  return {
    order,
    levels,
    mode,
    nfgFaction: nfg ? nfg.faction : null,
    nfgStoppedBy,
    augs: chosen.length,
    soa: soaChosen.length,
    total,
    budget,
    dropped,
    ordering: {
      chosen: total,
      nfgFirst: asNfgFirst,
      augsFirst: asAugsFirst,
      // > 1 means the mandated "NeuroFlux first" order would have cost that
      // much more than the order actually used. 1 means they agree.
      nfgFirstPenalty: total > 0 ? asNfgFirst / total : 1,
    },
  }
}

/**
 * Which faction to buy a given augmentation from.
 *
 * Any faction that lists it sells it at the same price — getAugCost takes only
 * the Augmentation (AugmentationHelpers.ts:128) — so the only thing that
 * matters is having the reputation. Highest reputation wins, which also keeps a
 * NeuroFlux run on one faction instead of hopping for no reason.
 */
export function bestSeller(sellers, repOf) {
  let best = null
  for (const f of sellers) {
    const rep = repOf(f)
    if (best === null || rep > best.rep) best = { faction: f, rep }
  }
  return best
}
