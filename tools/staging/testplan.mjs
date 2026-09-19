// Check augplan.js's closed-form arithmetic against a step-by-step simulation
// of the game's own getAugCost, and check the ordering claims by brute force.
//
// The simulation is transcribed from Augmentation/AugmentationHelpers.ts:29-37
// and 128-160 — the same source the module cites. This is not a second model of
// the game; it is the same rule applied one purchase at a time, which is the
// thing the geometric series is supposed to be equal to.
import { buildPlan, mergeOrder, nfgBlockCost, nfgChainCost, augBlockCost, nfgLevelsRepAllows, AUG_PRICE_MULT, NFG_LEVEL_MULT, NFG } from './augplan.js'

const MULT = 1.9 // CONSTANTS.MultipleAugMultiplier
const NFGM = 1.14 // CONSTANTS.NeuroFluxGovernorLevelMult

/** getAugCost().moneyCost, applied to a mutable "queue" the way the game does. */
function liveCost(aug, world) {
  const generic = Math.pow(MULT, world.queuedNonSoa)
  if (aug.name === NFG) return aug.base * Math.pow(NFGM, world.nfgLevel) * generic
  if (aug.soa) return aug.base * Math.pow(7, world.soaInstalled)
  return aug.base * generic
}
function queue(aug, world) {
  if (aug.name === NFG) world.nfgLevel++
  if (!aug.soa) world.queuedNonSoa++
}

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

// --- 1. nfgBlockCost is the sum of k sequential NeuroFlux purchases ---------
{
  let worstErr = 0
  for (const base of [1e6, 5.2e7, 3.1e9]) {
    for (const level0 of [0, 3, 11]) {
      for (const q0 of [0, 2, 7]) {
        for (const k of [0, 1, 2, 5, 12, 20]) {
          const world = { queuedNonSoa: q0, nfgLevel: level0, soaInstalled: 0 }
          const aug = { name: NFG, base }
          const first = liveCost(aug, world)
          let sim = 0
          for (let j = 0; j < k; j++) {
            sim += liveCost(aug, world)
            queue(aug, world)
          }
          const closed = nfgBlockCost(first, k)
          worstErr = Math.max(worstErr, sim === 0 ? 0 : Math.abs(sim - closed) / sim)
        }
      }
    }
  }
  check('nfgBlockCost == sequential simulation', worstErr < 1e-12, `worst relative error ${worstErr.toExponential(2)}`)
}

// --- 2. augBlockCost is the sum of sequential ordinary purchases ------------
{
  let worstErr = 0
  for (const q0 of [0, 1, 6]) {
    for (const offset of [0, 3]) {
      const bases = [9e9, 4e9, 1.2e9, 3e8, 5e7]
      const world = { queuedNonSoa: q0 + offset, nfgLevel: 0, soaInstalled: 0 }
      const list = bases.map((base) => ({ base }))
      // Prices as the buy script sees them: read once, before anything is
      // queued in this run, at queue depth q0.
      const seen = { queuedNonSoa: q0, nfgLevel: 0, soaInstalled: 0 }
      const priced = list.map((a) => ({ price: liveCost({ ...a, name: 'x' }, seen) }))
      let sim = 0
      for (const a of list) {
        sim += liveCost({ ...a, name: 'x' }, world)
        queue({ name: 'x' }, world)
      }
      const closed = augBlockCost(priced, offset)
      worstErr = Math.max(worstErr, Math.abs(sim - closed) / sim)
    }
  }
  check('augBlockCost == sequential simulation', worstErr < 1e-12, `worst relative error ${worstErr.toExponential(2)}`)
}

// --- 3. descending price really is the cheapest order (brute force) ---------
{
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])))
  let worst = 0
  let bad = 0
  for (let trial = 0; trial < 300; trial++) {
    const n = 2 + Math.floor(Math.random() * 5)
    const prices = Array.from({ length: n }, () => Math.exp(Math.random() * 12) * 1e6)
    const cost = (order) => order.reduce((s, p, j) => s + p * Math.pow(MULT, j), 0)
    const best = Math.min(...perms(prices).map(cost))
    const desc = cost(prices.slice().sort((a, b) => b - a))
    worst = Math.max(worst, (desc - best) / best)
    if (desc > best * (1 + 1e-12)) bad++
  }
  check('most-expensive-first is the minimum over all orders', bad === 0, `${bad}/300 counterexamples, worst excess ${worst.toExponential(2)}`)
}

// --- 4. the merge is exactly optimal, by brute force -----------------------
{
  // Enumerate EVERY interleaving of m ordinary augmentations (descending) with
  // a NeuroFlux chain of k levels, and compare the cheapest one found against
  // what mergeOrder produces. Also score the two fixed orders the repo argues
  // about, so the size of the mistake is on record.
  function* inter(m, k, acc = [], ai = 0, ni = 0) {
    if (ai === m && ni === k) { yield acc; return }
    if (ai < m) yield* inter(m, k, [...acc, ai], ai + 1, ni)
    if (ni < k) yield* inter(m, k, [...acc, 'n'], ai, ni + 1)
  }
  const costOf = (seq, prices, p0) => {
    let pos = 0, nfg = 0, sum = 0
    for (const s of seq) {
      sum += (s === 'n' ? p0 * Math.pow(NFGM, nfg++) : prices[s]) * Math.pow(MULT, pos)
      pos++
    }
    return sum
  }
  let bad = 0, worstMerge = 0, worstNfgFirst = 0, worstAugsFirst = 0, nfgFirstBad = 0
  for (let trial = 0; trial < 400; trial++) {
    const m = 1 + Math.floor(Math.random() * 5)
    const k = 1 + Math.floor(Math.random() * 6)
    const prices = Array.from({ length: m }, () => Math.exp(Math.random() * 16) * 1e6).sort((a, b) => b - a)
    const p0 = Math.exp(Math.random() * 16) * 1e6
    const augs = prices.map((price, i) => ({ name: `A${i}`, faction: 'F', price }))
    const nfg = { faction: 'F', price: p0 }
    let best = Infinity
    for (const s of inter(m, k)) best = Math.min(best, costOf(s, prices, p0))
    const got = mergeOrder(augs, nfg, k, 'best').total
    const nf = mergeOrder(augs, nfg, k, 'nfg-first').total
    const af = mergeOrder(augs, nfg, k, 'augs-first').total
    if (got > best * (1 + 1e-9)) bad++
    if (nf > best * (1 + 1e-9)) nfgFirstBad++
    worstMerge = Math.max(worstMerge, (got - best) / best)
    worstNfgFirst = Math.max(worstNfgFirst, (nf - best) / best)
    worstAugsFirst = Math.max(worstAugsFirst, (af - best) / best)
  }
  check('mergeOrder is optimal over every interleaving', bad === 0, `${bad}/400 suboptimal, worst excess ${(worstMerge * 100).toFixed(6)}%`)
  console.log(`      for comparison: always-NeuroFlux-first suboptimal on ${nfgFirstBad}/400, worst excess ${(worstNfgFirst * 100).toFixed(1)}%`)
  console.log(`                      always-augmentations-first worst excess ${(worstAugsFirst * 100).toFixed(1)}%`)
}

// --- 4b. what the mandated order costs in a realistic BitNode 4 shape ------
{
  // Base money costs straight out of Augmentation/Augmentations.ts.
  const augs = [
    ['Embedded Netburner Module Core V3', 7.5e9],
    ['Neuralstimulator', 3e9],
    ['Artificial Bio-neural Network Implant', 3e9],
    ['Cranial Signal Processors - Gen III', 5.5e8],
    ['DataJack', 4.5e8],
    ['BitWire', 1e7],
  ].map(([name, price]) => ({ name, faction: 'F', price, repReq: 0, rep: 1e12 }))
  console.log('      NeuroFlux base cost $750k, x1.14 per owned level (Augmentations.ts:1160-1161)')
  console.log('      lvl   nextPrice    best: k, $total        nfg-first: k, $total     penalty')
  for (const L of [0, 20, 40, 50, 60, 80, 100]) {
    const nfgPrice = 750e3 * Math.pow(NFGM, L)
    const mk = (mode) => buildPlan({ budget: 1e12, mode, nfg: { faction: 'F', price: nfgPrice, repReq: 1, rep: 1e30, maxLevels: 1000 }, augs })
    const best = mk('best')
    const nf = mk('nfg-first')
    console.log(`      ${String(L).padEnd(5)} $${nfgPrice.toExponential(2).padEnd(11)} k=${String(best.levels).padEnd(3)} $${best.total.toExponential(3).padEnd(13)} k=${String(nf.levels).padEnd(3)} $${nf.total.toExponential(3).padEnd(13)} ${(best.levels / Math.max(1, nf.levels)).toFixed(2)}x levels`)
  }
}

// --- 5. every `expected` matches the game's live price at that step ---------
{
  const augs = [
    { name: 'A', faction: 'F', price: 8e9, repReq: 0, rep: 1e9 },
    { name: 'B', faction: 'F', price: 2e9, repReq: 0, rep: 1e9 },
    { name: 'S', faction: 'F', price: 5e8, repReq: 0, rep: 1e9 }, // ordinary
    { name: 'Knowledge of Apollo', faction: 'F', price: 1e8, repReq: 0, rep: 1e9 }, // SoA
  ]
  const nfg = { faction: 'F', price: 1e9, repReq: 1e5, rep: 1e7, maxLevels: 100 }
  const plan = buildPlan({ budget: 1e12, nfg, augs })

  // Recover base costs so the simulation starts where the buy script did.
  const q0 = 0
  const world = { queuedNonSoa: q0, nfgLevel: 0, soaInstalled: 0 }
  const bases = {}
  for (const a of augs) bases[a.name] = a.price / (a.name === 'Knowledge of Apollo' ? 1 : Math.pow(MULT, q0))
  bases[NFG] = nfg.price / Math.pow(MULT, q0)

  let worst = 0
  let sim = 0
  for (const item of plan.order) {
    const aug = { name: item.name, base: bases[item.name], soa: item.kind === 'soa' }
    const live = liveCost(aug, world)
    worst = Math.max(worst, Math.abs(live - item.expected) / item.expected)
    sim += live
    queue(aug, world)
  }
  check('every planned price equals the live price at that step', worst < 1e-12, `worst relative error ${worst.toExponential(2)}`)
  check('plan.total equals the simulated spend', close(sim, plan.total), `$${sim.toExponential(6)} vs $${plan.total.toExponential(6)}`)
  check('SoA is last and unmultiplied', plan.order[plan.order.length - 1].kind === 'soa' && close(plan.order[plan.order.length - 1].expected, 1e8))
}

// --- 6. reputation cap on NeuroFlux levels ---------------------------------
{
  // repCost for level j is repReq * 1.14^j, so rep = repReq * 1.14^4 should buy
  // exactly 5 levels (j = 0..4).
  const repReq = 1e5
  check('nfgLevelsRepAllows is exact at the boundary', nfgLevelsRepAllows(repReq, repReq * Math.pow(NFGM, 4)) === 5, `got ${nfgLevelsRepAllows(repReq, repReq * Math.pow(NFGM, 4))}`)
  check('nfgLevelsRepAllows is 0 below the first level', nfgLevelsRepAllows(repReq, repReq * 0.999) === 0)
  const plan = buildPlan({ budget: 1e30, nfg: { faction: 'F', price: 1e3, repReq, rep: repReq * Math.pow(NFGM, 4), maxLevels: 100 }, augs: [] })
  check('the plan stops at the reputation cap', plan.levels === 5 && plan.nfgStoppedBy === 'rep', `levels=${plan.levels} stoppedBy=${plan.nfgStoppedBy}`)
}

// --- 7. the wall: a level costs 2.166x the last, so ~12 is the ceiling ------
{
  // Uncapped reputation and money, but the price compounds. Report where an
  // income-scale budget runs out, which is the "walls out after roughly 12"
  // claim in CLAUDE.md.
  const price = 1e9
  for (const budget of [1e12, 1e15, 1e18]) {
    const plan = buildPlan({ budget, nfg: { faction: 'F', price, repReq: 1, rep: 1e30, maxLevels: 1000 }, augs: [] })
    console.log(`      budget $${budget.toExponential(0)} at a $${price.toExponential(0)} next level -> ${plan.levels} NeuroFlux levels`)
  }
  const plan = buildPlan({ budget: 1e15, nfg: { faction: 'F', price, repReq: 1, rep: 1e30, maxLevels: 1000 }, augs: [] })
  check('a 1e6x budget buys ~18 levels, not ~1e6', plan.levels > 12 && plan.levels < 22, `${plan.levels}`)
}

// --- 8. affordability: nothing is ever planned that cannot be paid for ------
{
  let bad = 0
  for (let trial = 0; trial < 2000; trial++) {
    const n = Math.floor(Math.random() * 8)
    const augs = Array.from({ length: n }, (_, i) => ({
      name: `A${i}`,
      faction: 'F',
      price: Math.exp(Math.random() * 20) * 1e5,
      repReq: Math.random() < 0.3 ? 1e12 : 0,
      rep: 1e9,
    }))
    const nfg = Math.random() < 0.8 ? { faction: 'F', price: Math.exp(Math.random() * 16) * 1e5, repReq: 1e4, rep: Math.exp(Math.random() * 14) * 1e4, maxLevels: 100 } : null
    const budget = Math.exp(Math.random() * 30) * 1e5
    const plan = buildPlan({ budget, nfg, augs })
    if (plan.total > budget * (1 + 1e-9)) bad++
    // and the running total in the order must be monotone and end at total
    let acc = 0
    for (const o of plan.order) {
      acc += o.expected
      if (!close(acc, o.cumulative)) bad++
    }
    if (plan.order.length && !close(acc, plan.total)) bad++
  }
  check('2000 random plans all fit their budget with consistent running totals', bad === 0, `${bad} violations`)
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exit(failures ? 1 : 0)
