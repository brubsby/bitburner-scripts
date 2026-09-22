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

/** BitNode 2 grants gang access outright and sells The Red Pill through it. */
export const GANG_IS_THE_NODE = 2

/**
 * Script income scale at or above which the batcher funds the install ladder
 * unaided, so a gang cannot repay its karma gate.
 *
 * BitNode 4 measured 0.0225 and the gang won by 63%; BitNode 10 measured 0.5
 * and it won by 1%. 0.25 sits between them, nearer the losing side — chosen so
 * that the threshold only ever REFUSES a gang where income is clearly healthy,
 * and leaves every ambiguous node to the simulation.
 */
export const HEALTHY_INCOME_SCALE = 0.25

/**
 * @param {object} o
 * @param {number} o.node          current BitNode
 * @param {object} o.mults         that node's multiplier table (bitNodeMultipliers.js)
 * @param {number} o.grindHours    measured hours still to spend reaching karma -54,000
 * @param {number} o.gangGainHours hours the gang's income would save over the node
 * @returns {{worth: boolean|null, gainHours, grindHours, why}}
 */
export function gangVerdict(o = {}) {
  const { node, mults, grindHours, gangGainHours } = o
  const keep = (why) => ({ worth: null, gainHours: null, grindHours: num(grindHours) ? grindHours : null, why })

  // BitNode 2 is not a trade-off: the gang catalogue carries The Red Pill
  // there (FactionHelpers.tsx:180-183) and access is granted without karma.
  if (node === GANG_IS_THE_NODE) {
    return { worth: true, gainHours: null, grindHours: 0, why: 'BitNode 2 grants gang access outright and sells The Red Pill through the gang catalogue — not a trade-off' }
  }
  if (!mults || typeof mults !== 'object') return keep(`no multiplier table for BitNode ${node} — refusing to price the gang`)
  if (!num(grindHours) || grindHours < 0) return keep('no measured karma grind — the gang cannot be priced without what it costs to reach')
  // NO MEASURED GAIN: fall back to the node's income scale, which is the term
  // the whole comparison turns on and is known from the multiplier table
  // alone. A gang earns its karma gate where the batcher CANNOT fund the
  // install ladder; tools/sim/gang-vs-nogang.mjs measured 102h (63%) at a
  // scale of 0.0225 in BitNode 4 and 0.9h (1%) at 0.5 in BitNode 10.
  //
  // This is a WEAKER claim than the simulation and says so: it only refuses a
  // gang where script income is plainly healthy, which is the case the BitNode
  // 4 answer got wrong. Anywhere ambiguous it still refuses to judge, so the
  // bootstrap is left alone rather than cancelled on a guess.
  if (!num(gangGainHours)) {
    const scale = (mults.ServerMaxMoney ?? 1) * (mults.ScriptHackMoney ?? 1)
    if (!num(scale)) return keep('no measured gang gain and no readable income scale')
    if (scale >= HEALTHY_INCOME_SCALE) {
      return {
        worth: false,
        gainHours: null,
        grindHours,
        why:
          `NOT worth it in BitNode ${node} on income scale alone: ServerMaxMoney x ScriptHackMoney = ${scale.toFixed(4)}, at or above the ${HEALTHY_INCOME_SCALE} where the batcher funds the install ladder by itself. ` +
          `The karma gate costs ${grindHours.toFixed(1)}h of work slot for a leg the gang barely shortens (measured 0.9h / 1% in BitNode 10 at this scale). Unmeasured here — the simulation is tools/sim/gang-vs-nogang.mjs --node ${node}.`,
      }
    }
    return keep(`no measured gang gain, and income scale ${scale.toFixed(4)} is below ${HEALTHY_INCOME_SCALE} where a gang plausibly pays — refusing rather than assuming either answer`)
  }

  const worth = gangGainHours > grindHours
  const scale = (mults.ServerMaxMoney ?? 1) * (mults.ScriptHackMoney ?? 1)
  return {
    worth,
    gainHours: gangGainHours,
    grindHours,
    why:
      `${worth ? 'WORTH IT' : 'NOT worth it'} in BitNode ${node}: the gang saves ${gangGainHours.toFixed(1)}h and the karma gate costs ${grindHours.toFixed(1)}h of work slot ` +
      `(script income scale ${scale.toFixed(4)} — the gang wins where the batcher cannot fund the install ladder)`,
  }
}
