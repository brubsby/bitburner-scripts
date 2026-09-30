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
 * chooseGrafts (below) REFUSES — returns `{ grafts: null, why }` — rather than guessing whenever
 * nothing can be priced (neither grafting nothing nor any graft set) or the
 * inputs are unreadable. An unpriceable 'none' alone is NOT a refusal: it is
 * the dominated option (+Infinity). And a refusal is never a decision to drop
 * the committed set — the caller keeps it (progress.js graftDecisionOf). A graft is money spent
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
  return { name: aug.name, cost, slotH: ms / 3600000, hacking: m('hacking') * e, exp: m('hacking_exp') * e, rep: m('faction_rep') * e, money: m('hacking_money') * e }
}

/**
 * GRAFTS IN THE LIVES BEFORE THE FINAL WINDOW — the schedule of a chosen set.
 *
 * A graft is installed the moment it finishes (GraftingWork.finish ->
 * applyAugmentation, GraftingWork.tsx:51; AugmentationHelpers.ts:65 pushes it
 * onto Player.augmentations) and every install re-applies that list
 * (Prestige.ts:122) with its entropy (Prestige.ts:128) — so a graft made in
 * ANY life rides through every later install. The final window was the only
 * place the exit simulator put grafts until 2026-09-29; the money a graft
 * costs is the life's own (the balance resets at every install), and its
 * slot hours hold the life open (an install cancels a graft in progress and
 * keeps its price: prestigeAugmentation -> finishWork(true)).
 *
 * The families searched, each a prefix moved out of the final window
 * (exitplan `lifeGrafts`, life 1 = the current life):
 *   costliest    -> life 1   descending price, prerequisites first — the
 *                            grafts whose money legs the final window pays
 *                            dearest
 *   cheapest     -> life 1   ascending price, prerequisites first — what the
 *                            current balance already covers
 *   set order    -> life 1   the greedy's own order (strongest first)
 *   set order    -> life 2   the next life
 * each at prefix sizes 1,2,3,4,6,8,12,16,24,... until two sizes in a row do
 * not improve on it, then every size outward from the family's best while it
 * improves; the rest stays in the final window at the set's start fraction.
 * The trajectory with the schedule against the same set in the final window
 * alone is withH - withoutH like every other choice here. Returns
 * {h, lifeGrafts [{name, life}], order (indices into chosen: life grafts first,
 * then the final window's in set order), startMoney, summary}.
 */
export const SCHEDULE_MS = 100
/**
 * ONE EXIT SIMULATION AS A GENERATOR. `priceExitGen(inputs)` (plan.
 * trajectoryGenOf: yields after every install policy it prices) when given,
 * else the synchronous `priceExit` as one step. A synchronous simulation of a
 * 20-graft set waiting on a large start balance is one long step: priced
 * that way the graft search held steps of ~10ms on the dev machine (2-4x that
 * in the game's page) against the pacer's 40ms slice.
 */
function pricerOf(priceExit, priceExitGen) {
  // A simulation the policy memo already holds returns without a yield
  // (exitplan.bestExitPolicyGen): the yield after it keeps a run of memo hits
  // from becoming one step (a whole re-priced search, 11ms in one step here).
  if (typeof priceExitGen === 'function') {
    return function* (x) {
      const h = yield* priceExitGen(x)
      yield
      return h
    }
  }
  return function* (x) {
    const h = priceExit(x)
    yield
    return h
  }
}
export const SCHEDULE_MIN_GAIN = { hours: 0.25, rel: 0.005 }
const PREFIXES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48]
/**
 * An order of `idx` with every prerequisite (within the set) before what
 * needs it, the ready item picked by `better(a, b)` < 0. Empty when the
 * prerequisites cannot be ordered (a cycle, or one missing from the set that
 * no owned augmentation satisfies — the caller's set came from a search that
 * already checked them, so this does not happen in practice).
 */
function readyOrder(chosen, idx, better) {
  const out = []
  const left = new Set(idx)
  while (left.size) {
    const ready = [...left].filter((i) => (Array.isArray(chosen[i].prereqs) ? chosen[i].prereqs : []).every((p) => !chosen.some((c, j) => c.name === p && left.has(j))))
    if (!ready.length) return []
    ready.sort(better)
    out.push(ready[0])
    left.delete(ready[0])
  }
  return out
}
export function* scheduleGen({ chosen, specs, priceExit, priceExitGen = null, without, join = 0, fraction = 0, finalH, deadline = () => false }) {
  const price = pricerOf(priceExit, priceExitGen)
  const n = chosen.length
  const idx = chosen.map((_, i) => i)
  // Cheapest first, prerequisites (within the set) before what needs them.
  const cheap = readyOrder(chosen, idx, (a, b) => specs[a].cost - specs[b].cost || a - b)
  // COSTLIEST FIRST: the final window pays each graft it keeps with a money
  // leg on the post-install book (the leg the slot waits behind), while the
  // current life pays from a balance that already covers it — so the grafts
  // worth moving out of the window are the dearest, up to the life's own
  // length of slot (past it the life lengthens). Live BN9 2026-09-30 00:00Z:
  // the cheapest 8 in life 1 read 28.19h; the dearest 9 read 23.32h.
  const dear = readyOrder(chosen, idx, (a, b) => specs[b].cost - specs[a].cost || a - b)
  const families = [
    ...(dear.length === n ? [{ name: 'costliest first, current life', order: dear, life: 1 }] : []),
    ...(cheap.length === n ? [{ name: 'cheapest first, current life', order: cheap, life: 1 }] : []),
    { name: 'set order, current life', order: idx, life: 1 },
    { name: 'set order, next life', order: idx, life: 2 },
  ]
  let best = { h: finalH, lifeGrafts: [], order: idx, startMoney: null, family: 'final window only', c: 0 }
  const tried = []
  let truncated = false
  const priceAt = function* (fam, c) {
    const early = new Set(fam.order.slice(0, c))
    const lifeGrafts = fam.order.slice(0, c).map((i) => ({ ...specs[i], life: fam.life }))
    const rest = idx.filter((i) => !early.has(i))
    const restCost = rest.reduce((a, i) => a + specs[i].cost, 0)
    const startMoney = rest.length ? fraction * (join + restCost) : 0
    const h = yield* price({ ...without, lifeGrafts, finalGrafts: rest.map((i) => specs[i]), graftStartMoney: startMoney })
    tried.push({ family: fam.name, c, h: num(h) ? +h.toFixed(3) : null })
    if (num(h) && h < best.h) best = { h, lifeGrafts: lifeGrafts.map((g) => ({ name: g.name, life: fam.life })), order: [...fam.order.slice(0, c), ...rest], startMoney, family: fam.name, c }
    return h
  }
  for (const fam of families) {
    let famBest = Infinity
    let famC = null
    let worse = 0
    const seen = new Map()
    for (const c of [...PREFIXES.filter((k) => k < n), n]) {
      if (deadline()) {
        truncated = true
        break
      }
      const h = yield* priceAt(fam, c)
      seen.set(c, h)
      if (num(h) && h < famBest) {
        famBest = h
        famC = c
        worse = 0
      } else if (++worse >= 2) break
    }
    if (truncated) break
    // EVERY SIZE BETWEEN THE GRID POINTS AROUND THE FAMILY'S BEST: the exit
    // over the prefix size is unimodal-ish but its optimum sits where the
    // moved grafts' slot fills the life, which the doubling grid steps over
    // (live 00:00Z: 8 -> 12 skipped the best, 9). Walk outward from the
    // best one size at a time while it improves, both ways.
    if (famC !== null) {
      for (const dir of [1, -1]) {
        let c = famC + dir
        while (c >= 1 && c <= n && !truncated) {
          if (deadline()) {
            truncated = true
            break
          }
          const h = seen.has(c) ? seen.get(c) : yield* priceAt(fam, c)
          seen.set(c, h)
          if (!(num(h) && h < famBest)) break
          famBest = h
          c += dir
        }
      }
    }
    if (truncated) break
  }
  return {
    ...best,
    summary: {
      family: best.family,
      early: best.lifeGrafts.length,
      lives: [...new Set(best.lifeGrafts.map((x) => x.life))],
      h: num(best.h) ? +best.h.toFixed(3) : null,
      finalOnlyH: num(finalH) ? +finalH.toFixed(3) : null,
      tried,
      truncated,
    },
  }
}

/**
 * A committed graft list as exit inputs: the grafts carrying a `life` (the
 * schedule's earlier lives) as exitplan `lifeGrafts`, the rest as
 * `finalGrafts` with the start balance. Null for an empty list.
 */
export function graftInputsOf(specs, startMoney) {
  const all = (Array.isArray(specs) ? specs : []).filter(Boolean)
  if (!all.length) return null
  const lifeGrafts = all.filter((g) => Number.isInteger(g.life) && g.life >= 1)
  const finalGrafts = all.filter((g) => !(Number.isInteger(g.life) && g.life >= 1))
  return { finalGrafts, ...(lifeGrafts.length ? { lifeGrafts } : {}), graftStartMoney: num(startMoney) ? startMoney : 0 }
}

/**
 * ONE AUGMENTATION, ONE SOURCE. An augmentation owned cannot be grafted
 * (GraftingHelpers.getGraftingAvailableAugs drops Player.hasAugmentation),
 * and a grafted one leaves the faction catalogue. The exit simulation took
 * the install batch (installGains, a product of multipliers) and the graft
 * set (per-graft multipliers) as independent, so an augmentation in both was
 * counted twice: live BN9 2026-09-30 the batch bought CRTX42-AA while it was
 * being grafted, and PC Direct-Neural Interface, Artificial Bio-neural
 * Network Implant, Cranial Signal Processors - Gen V and Enhanced Myelin
 * Sheathing while the final window grafted them too (hacking x1.70 counted
 * twice). CRTX42-AA's graft finishing took it out of the batch and the held
 * exit moved 16.0h -> 21.5h with no event (EXIT UNSTABLE); the four left
 * priced ~21h where the set without them reads ~47h.
 *
 * The rule, by what happens first on the trajectory: a graft of THIS life
 * (life 1, or the one running) completes before the install, so it is owned
 * when the batch is bought — the batch's offers exclude it (graftsOfLifeNow).
 * A graft after the first install (the final window, a later life) comes
 * after the batch — a batch augmentation is dropped from the set
 * (graftsOffBatch) and never a candidate.
 */
export function graftsOfLifeNow(carry, work = null) {
  const out = new Set()
  for (const g of Array.isArray(carry?.lifeGrafts) ? carry.lifeGrafts : []) if (g && typeof g.name === 'string' && g.life === 1) out.add(g.name)
  if (work?.type === 'GRAFTING' && typeof work.augmentation === 'string') out.add(work.augmentation)
  return out
}
/** specs without the grafts after the first install whose augmentation the batch buys: {kept, dropped (names)}. */
export function graftsOffBatch(specs, batchNames) {
  const b = batchNames instanceof Set ? batchNames : new Set(Array.isArray(batchNames) ? batchNames : [])
  const kept = []
  const dropped = []
  for (const g of Array.isArray(specs) ? specs : []) {
    if (g && typeof g.name === 'string' && b.has(g.name) && g.life !== 1) dropped.push(g.name)
    else kept.push(g)
  }
  return { kept, dropped }
}
/**
 * AUG COUNTED TWICE: the install decision's inputs graft an augmentation the
 * batch also buys. batchNames: the batch the plan buys (and the queued ones);
 * inputs: the exit inputs the install decision priced. {ok, both, why}.
 */
export function graftBatchCheckOf({ batchNames = null, inputs = null } = {}) {
  if (!inputs) return { ok: null, why: 'no install decision priced this pass' }
  if (!batchNames) return { ok: null, why: 'no install batch read this pass' }
  const b = batchNames instanceof Set ? batchNames : new Set(batchNames)
  const grafts = [...(Array.isArray(inputs.lifeGrafts) ? inputs.lifeGrafts : []), ...(Array.isArray(inputs.finalGrafts) ? inputs.finalGrafts : [])]
  const both = grafts.map((g) => g?.name).filter((n) => typeof n === 'string' && b.has(n))
  if (!both.length) return { ok: true, why: `no augmentation both bought (${b.size} in the batch) and grafted (${grafts.length})` }
  return { ok: false, both, why: `AUG COUNTED TWICE: ${both.length} augmentation(s) in the install batch AND the graft set the install decision priced (${both.slice(0, 4).join(', ')}${both.length > 4 ? ', ...' : ''}) — their multipliers enter the exit twice` }
}

/**
 * THE RUNNING GRAFT AS THE SIMULATOR TAKES IT: already paid (its price left
 * the balance when the work started, GraftingWork.tsx:33) and only its
 * remaining slot time left. A cycle is 200ms of real time (CONSTANTS.
 * MilliPerCycle) and graftSpecOf's slotH is already the real time at focus
 * (GraftingWork.process: MilliPerCycle x graftingIntBonus x focusPenalty per
 * cycle against the aug's time), so cyclesWorked x 200ms is what is done;
 * unfocused work (x0.8) finishes later than this. `work` is getCurrentWork's
 * record ({type 'GRAFTING', augmentation, cyclesWorked}). Every other spec
 * is returned unchanged.
 */
// eslint-disable-next-line no-unused-vars
export function inProgressSpecsOf(specs, work, intelligence = 0) {
  const list = Array.isArray(specs) ? specs : []
  if (work?.type !== 'GRAFTING' || typeof work.augmentation !== 'string') return list
  const doneH = num(work.cyclesWorked) && work.cyclesWorked > 0 ? (work.cyclesWorked * 200) / 3600000 : 0
  return list.map((g) => (g?.name === work.augmentation && num(g.slotH) ? { ...g, cost: 0, paid: true, slotH: Math.max(0, g.slotH - doneH) } : g))
}

/** Same graft names, in any order and whatever their schedule. */
export function sameGraftSet(a, b) {
  const n = (xs) => new Set((Array.isArray(xs) ? xs : []).map((g) => g?.name).filter((x) => typeof x === 'string'))
  const A = n(a)
  const B = n(b)
  return A.size === B.size && [...A].every((x) => B.has(x))
}

/**
 * Same graft names AND the same life for each (spec.life: an earlier life,
 * absent: the final window) — the same trajectory. Order within a life is
 * not compared (the executor grafts what its prerequisites allow).
 */
export function sameGraftSchedule(a, b) {
  if (!sameGraftSet(a, b)) return false
  const lifeOf = (xs) => new Map((Array.isArray(xs) ? xs : []).filter((g) => typeof g?.name === 'string').map((g) => [g.name, Number.isInteger(g.life) ? g.life : 0]))
  const A = lifeOf(a)
  const B = lifeOf(b)
  return [...A].every(([n, l]) => B.get(n) === l)
}

/**
 * THE BEST GRAFT SET ON ONE TRAJECTORY: `sets` [{from, specs, startMoney,
 * inputs}] each priced by `price(inputs)` (the trajectory's point); the
 * least finite exit wins, ties to the first (this pass's). Returns {set,
 * priced: [{from, n, h}]}; set null when none is priced.
 */
export function graftSetOn(price, sets) {
  let best = null
  const priced = []
  for (const a of Array.isArray(sets) ? sets : []) {
    let h = null
    try {
      h = price(a.inputs)
    } catch {
      h = null
    }
    priced.push({ from: a.from, n: a.specs?.length ?? 0, h: num(h) ? +h.toFixed(3) : null })
    if (num(h) && (!best || h < best.h)) best = { h, a }
  }
  return { set: best ? best.a : null, priced }
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
  const priceExitGen = typeof o.priceExitGen === 'function' ? o.priceExitGen : null
  const maxGrafts = num(o.maxGrafts) && o.maxGrafts > 0 ? o.maxGrafts : 12
  const entropy = o.entropy !== false
  const budgetMs = num(o.budgetMs) && o.budgetMs > 0 ? o.budgetMs : Infinity
  const clock = typeof o.now === 'function' ? o.now : () => Date.now()
  if (typeof priceExit !== 'function' && !priceExitGen) return { grafts: null, why: 'no exit pricing function supplied' }
  const price = pricerOf(priceExit, priceExitGen)
  if (!base || typeof base !== 'object') return { grafts: null, why: 'no exit policy inputs' }
  if (!Array.isArray(candidates)) return { grafts: null, why: 'no graft candidates supplied' }
  const without = { ...base }
  delete without.finalGrafts
  const priced = yield* price(without)
  // GRAFTING NOTHING MAY BE UNPRICEABLE — and that is a price, not a refusal.
  // Without the grafts' hacking multiplier the level the exit needs can be out
  // of reach: the simulator returns null (degenerate) or a number past any
  // horizon. That makes 'none' the WORST option, dominated by any with-run
  // that is priced, so it is searched against as +Infinity.
  //
  // It was a refusal until 2026-09-29, and a refusal dropped the committed
  // grafts from every other decision's inputs: live BN9 13:41Z and 14:51Z the
  // committed install's batch (hacking x1.41) could not reach 6000 without
  // the node's 28 grafts (x~14); the search refused ("the exit could not be
  // priced without grafting"), the install decision re-priced its incumbent
  // without them (26,648h mean) and switched to w4 for "26,581.67h sooner".
  // A refusal is now only "nothing could be priced, with OR without".
  const unpricedNone = !num(priced)
  const baseline = unpricedNone ? Infinity : priced

  const owned = new Set(Array.isArray(ownedNames) ? ownedNames : [])
  // Only what the game would let us graft (not special, not owned), and
  // priceable. Prerequisites stay in `all` whatever they move: a weak G1 is
  // the price of the G2 behind it.
  const all = candidates.filter((a) => a && typeof a.name === 'string' && a.isSpecial !== true && !owned.has(a.name) && num(a.baseCost) && a.baseCost > 0 && a.mults && typeof a.mults === 'object' && graftSpecOf(a, intelligence) !== null)
  const pool = all.filter(moves)
  const REFUSE_UNPRICED = 'the exit could not be priced without grafting, and no graft set was priced either — nothing to compare'
  const none = (why) => ({ grafts: [], baseline, withoutH: baseline, withH: baseline, exitHours: baseline, deltaH: 0, netHours: 0, slotHours: 0, spend: 0, truncated: false, why })
  if (!pool.length) return unpricedNone ? { grafts: null, why: REFUSE_UNPRICED, unpricedNone } : none('no graftable augmentation moves the exit — grafting nothing')

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
      const hours = yield* price({ ...without, finalGrafts: specs, graftStartMoney: f * total })
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
  // The greedy leaves the schedule stage its slice (SCHEDULE_MS) of the budget.
  const greedyMs = Number.isFinite(budgetMs) ? Math.max(budgetMs / 2, budgetMs - SCHEDULE_MS) : budgetMs
  // RESUME FROM A KNOWN SET (o.seeds, each a list of names in graft order;
  // o.seed is one): a search the CPU budget stopped continues from where the
  // plan stands next time, instead of restarting and stopping at the same
  // place. Several seeds (the committed set, and the best set any search of
  // this node found — progress.js graftMemory) are priced and the best that
  // beats grafting nothing on today's inputs is the start. A seed name that is
  // not graftable now (owned, queued, unpriced) is SKIPPED, not the end of
  // the seed: its dependants fall out on their own prerequisite check.
  //
  // Why several: one committed set was the only memory, and a transient input
  // that made it lose to grafting nothing threw it away for good (live BN9
  // 2026-09-29 ~08:50Z: the trader's first realised fit read 0.6%/h, the
  // committed 29-graft set could not be paid for, the budgeted search
  // restarted from nothing and had rebuilt 12 grafts by 10:26 — exit 184h
  // point where the 29 re-priced on the same inputs read 124h).
  const seeds = [...(Array.isArray(o.seeds) ? o.seeds : []), ...(Array.isArray(o.seed) ? [o.seed] : [])].filter((s) => Array.isArray(s) && s.length)
  let seededFrom = null
  for (let si = 0; si < seeds.length; si++) {
    const seeded = []
    for (const n of seeds[si]) {
      const a = all.find((x) => x.name === n)
      if (!a || seeded.includes(a) || !prereqsMet(a, new Set([...owned, ...seeded.map((s) => s.name)]))) continue
      seeded.push(a)
    }
    const h = seeded.length ? yield* withRun(seeded) : null
    if (h !== null && h < bestH) {
      chosen.length = 0
      chosen.push(...seeded)
      bestH = h
      seededFrom = si
    }
  }
  // The greedy's additions, one bundle a step, while one shortens the exit.
  const growSet = function* () {
    let added = 0
    for (let step = 0; step < maxGrafts && !truncated; step++) {
      let best = null
      for (const a of pool) {
        if (clock() - t0 > greedyMs) {
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
      added += best.bundle.length
    }
    return added
  }
  // THE PRUNE: the greedy only ever ADDS, and it starts from the node's
  // remembered sets (the seeds) — so a set that grew around an expensive
  // graft was never priced without it. Live BN9 2026-09-29 18:42Z: the
  // remembered 24-graft set carries QLink ($75t: 3 x its $25t base), and on
  // the trader's curve r(W) the final window earns $75t in ~225h at the
  // market's saturated ~$3.3e11/h; the same set without QLink priced 102h
  // against 262h with it (point, the committed install's trajectory), and no
  // search could see it. Each round tries dropping one graft (with every
  // member of the set that needs it), the most expensive first, and keeps
  // the first drop that shortens the with-run's exit — then the greedy may
  // add again around the smaller set. A set is never pruned to nothing
  // (grafting nothing is the decision's other option).
  const pruned = []
  const prune = function* () {
    let dropped = 0
    for (let round = 0; round < 64 && !truncated && chosen.length > 1; round++) {
      let took = false
      const order = chosen.map((a) => ({ a, cost: graftSpecOf(a, intelligence, { entropy })?.cost ?? 0 })).sort((x, y) => y.cost - x.cost)
      for (const { a } of order) {
        if (clock() - t0 > greedyMs) {
          truncated = true
          break
        }
        // a, and every member whose prerequisite chain (within the set) reaches it.
        const drop = new Set([a.name])
        for (let grew = true; grew; ) {
          grew = false
          for (const x of chosen) if (!drop.has(x.name) && (Array.isArray(x.prereqs) ? x.prereqs : []).some((p) => drop.has(p))) (drop.add(x.name), (grew = true))
        }
        const rest = chosen.filter((x) => !drop.has(x.name))
        if (!rest.length) continue
        const h = yield* withRun(rest)
        if (h !== null && h < bestH) {
          chosen.length = 0
          chosen.push(...rest)
          bestH = h
          pruned.push(...drop)
          dropped += drop.size
          took = true
          break
        }
      }
      if (!took) break
    }
    return dropped
  }
  // Prune FIRST: a seeded set is the mature one, and the greedy's pass over
  // the pool (every candidate x the start fractions) is what the CPU budget
  // stops — pruned after it, a remembered set was never pruned at all.
  for (let pass = 0; pass < 4 && !truncated; pass++) {
    yield* prune()
    const added = truncated ? 0 : yield* growSet()
    if (!added) break
  }

  if (!chosen.length) {
    if (unpricedNone) return { grafts: null, why: `${REFUSE_UNPRICED}${truncated ? ' (search stopped at its CPU budget)' : ''}`, unpricedNone, truncated, seededFrom }
    return { ...none(`grafting nothing: no graft shortens the simulated exit (${baseline.toFixed(2)}h without)${truncated ? ' — search stopped at its CPU budget' : ''}`), truncated, seededFrom }
  }
  const specs = chosen.map((a) => graftSpecOf(a, intelligence, { entropy }))
  const spend = specs.reduce((x, g) => x + g.cost, 0)
  const slotHours = specs.reduce((x, g) => x + g.slotH, 0)
  const start = yield* withRunAt(chosen)
  // WHICH LIVES THE SET IS GRAFTED IN (scheduleGen): the final window, or —
  // for a prefix — the current life or the next. Its own slice of the budget.
  const sched = start ? yield* scheduleGen({ chosen, specs, priceExit, priceExitGen, without, join, fraction: start.fraction, finalH: start.h, deadline: () => clock() - t0 > budgetMs }) : null
  const withLife = (i) => (lifeOf.has(chosen[i].name) ? { ...specs[i], life: lifeOf.get(chosen[i].name) } : specs[i])
  // A schedule holds the current life open (the install waits for its
  // grafts), so it must beat the final window by more than noise-level
  // hours: SCHEDULE_MIN_GAIN (hours, or that share of the exit).
  const minGain = Math.max(SCHEDULE_MIN_GAIN.hours, SCHEDULE_MIN_GAIN.rel * (num(start?.h) ? start.h : 0))
  const scheduledH = sched && num(sched.h) && sched.h < start.h - minGain ? sched.h : null
  if (scheduledH !== null) bestH = scheduledH
  const lifeOf = new Map((scheduledH !== null ? sched.lifeGrafts : []).map((x) => [x.name, x.life]))
  const order = scheduledH !== null ? sched.order : chosen.map((a, i) => i)
  const startMoney = sched && scheduledH !== null ? sched.startMoney : start?.startMoney ?? null
  return {
    startMoney,
    startFraction: start?.fraction ?? null,
    grafts: order.map((i) => ({ name: chosen[i].name, cost: specs[i].cost, timeMs: specs[i].slotH * 3600000, mults: chosen[i].mults, spec: withLife(i), ...(lifeOf.has(chosen[i].name) ? { life: lifeOf.get(chosen[i].name) } : {}) })),
    schedule: sched ? { ...sched.summary, finalOnlyH: start.h, chosenH: bestH, taken: scheduledH !== null, minGainH: +minGain.toFixed(3) } : null,
    // Grafting nothing unpriceable: withoutH null (JSON has no Infinity), and
    // the gain is unbounded — published as such, not as a number.
    baseline: unpricedNone ? null : baseline,
    withoutH: unpricedNone ? null : baseline,
    unpricedNone,
    withH: bestH,
    exitHours: bestH,
    deltaH: unpricedNone ? null : bestH - baseline,
    netHours: unpricedNone ? null : baseline - bestH,
    slotHours,
    spend,
    truncated,
    seededFrom,
    // Grafts the prune dropped from the seeded/grown set (each shortened the exit without it).
    pruned: [...new Set(pruned)],
    entropyAfter: (num(o.entropy0) ? o.entropy0 : 0) + (entropy ? chosen.length : 0),
    city: GRAFT_CITY,
    why: `${lifeOf.size ? `${lifeOf.size} of ${chosen.length} graft(s) in earlier lives (${[...new Set(lifeOf.values())].sort().map((l) => `life ${l}`).join(', ')}), the rest` : `${chosen.length} graft(s)`} in the final window for $${(spend / 1e9).toFixed(2)}b and ${slotHours.toFixed(1)}h of work slot: exit ${unpricedNone ? 'unpriceable (the level is out of reach)' : `${baseline.toFixed(2)}h`} without -> ${bestH.toFixed(2)}h with (entropy ${ENTROPY_EFFECT}^${chosen.length} on every multiplier inside the run)${pruned.length ? `; pruned ${[...new Set(pruned)].join(', ')}` : ''}${truncated ? ' — search stopped at its CPU budget' : ''}`,
  }
}

/**
 * THE COMMITTED GRAFT SET, WHATEVER THIS PASS'S GRAFT DECISION DID — the set
 * every other decision prices the node with (progress.js carriedGraftsOf) and
 * the set a refused search keeps (graftDecisionOf).
 *
 * A graft decision DECIDES ('grafts' -> its set, 'none' -> nothing) or it
 * does not (a refusal, a throw, a budget stop with nothing feasible: key
 * null). A non-decision is never "graft nothing": the set is, in order, what
 * the non-decision kept (`kept`), the last decided record of this life
 * (`prev`), of the node (`prevAny`), then the node's graft memory — its
 * stored specs, else its names walked through `candidates` like a seed
 * (ungraftable names skipped, prerequisites in order). Installed names are
 * dropped (they are in the multiplier). Returns {grafts, startMoney, from}
 * ({grafts: []} when 'none' was decided), or null when nothing is committed
 * anywhere.
 *
 * Live BN9 2026-09-29 13:41Z and 14:51Z: a refused search published key null
 * and the carry read that as "no grafts", so the install decision priced the
 * node without its 28 committed grafts (hacking x~14) and switched onto a
 * pricing artefact ("26581.67h sooner").
 */
export function committedGraftsOf(o = {}) {
  const own = o.installed instanceof Set ? o.installed : new Set(Array.isArray(o.installed) ? o.installed : [])
  const live = (gs) => (Array.isArray(gs) ? gs : []).filter((g) => g && typeof g.name === 'string' && !own.has(g.name))
  const decided = (d) => d && (d.key === 'grafts' || d.key === 'none')
  const of = (d, from) => (d.key === 'none' ? { grafts: [], startMoney: null, from } : { grafts: live(d.grafts), startMoney: num(d.startMoney) ? d.startMoney : null, from })
  if (decided(o.cur)) return of(o.cur, "this pass's graft decision")
  const k = o.cur?.kept
  if (k && Array.isArray(k.grafts) && k.grafts.length) return { grafts: live(k.grafts), startMoney: num(k.startMoney) ? k.startMoney : null, from: k.from ?? 'the set the graft decision kept' }
  if (decided(o.prev)) return of(o.prev, 'the last committed graft decision')
  if (decided(o.prevAny)) return of(o.prevAny, "the node's last committed graft decision")
  const m = o.memory
  if (Array.isArray(m?.grafts) && m.grafts.length) return { grafts: live(m.grafts), startMoney: num(m.startMoney) ? m.startMoney : null, from: "the node's graft memory" }
  if (Array.isArray(m?.names) && m.names.length && Array.isArray(o.candidates)) {
    const walked = []
    for (const n of m.names) {
      if (own.has(n) || walked.some((a) => a.name === n)) continue
      const a = o.candidates.find((x) => x?.name === n)
      if (!a || !prereqsMet(a, new Set([...own, ...walked.map((w) => w.name)]))) continue
      walked.push(a)
    }
    const specs = walked.map((a) => graftSpecOf(a, o.intelligence, { entropy: o.entropy !== false })).filter(Boolean)
    if (specs.length) return { grafts: specs, startMoney: num(m.startMoney) ? m.startMoney : null, from: `the node's graft memory (${specs.length} of ${m.names.length} names)` }
  }
  return null
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
