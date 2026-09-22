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

/** BitNode 2 grants gang access outright and sells The Red Pill through it. */
export const GANG_IS_THE_NODE = 2

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
  if (!num(gangGainHours)) return keep('no measured gang gain — refusing rather than assuming the BitNode 4 answer')

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
