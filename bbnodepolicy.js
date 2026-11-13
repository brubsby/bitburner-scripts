// THE BLADEBURNER POLICY PER NODE. Pure, no ns calls (0GB; imported by bladeburner.js, bb-lite's actors,
// progress.js's exit model, sleeve.js's fleet and the gameplan's bbsim specs, so every one plays and prices
// the same policy).
//
// THE BOOTSTRAP PHASE OFF WHERE IT LOSES (2026-10-25). bbplan.POLICY's bootstrap (bootMinP 0.15, Raid
// 0.25, skills every 120s until the first black op and its rank 2.5k: bbplan.phasePolicyOf) was priced
// on BN5.2 / BN2.2 / BN13.3 (tools/sim/bbboot.mjs header: -0.37 / -0.73 / +0.06h). At BitNode 15's
// BladeburnerRank 0.2 the rank-2.5k boot lasts ~50h of node time, and its low-chance bars cost far more
// than they buy — bbboot.mjs --levers --cells BN15.1 (the game's own classes, 16 paired seeds 501-516,
// the gift on, 8 sleeves, SF8.3, int 157):
//   the bootstrap policy vs none   exit +20.43 +- 5.02h (96.9h vs 76.5h), first black op +10.04 +- 2.95h
// NOT CALIBRATED live (no node has played Bladeburner at rank x0.2). A node not listed plays POLICY.
//
// BN12: THE BOOT RAIDS AT THE BOOT'S OWN BAR, AND A FLOOR OF FIVE INFILTRATORS (2026-11-13,
// tools/sim/bb12.mjs: bbsim calibrated on BN12.2-12.6 as played — first black op mean ln(model/live)
// +0.07, the clear -0.06; levers paired at BN12.7-12.10 from BN12.4's and BN12.6's measured starts):
//   Raid at bootMinP 0.15 (POLICY: 0.25)  clear -0.05 +- 0.01h, first black op -0.12 +- 0.02h, rank 2.5k
//     -0.18 +- 0.02h (8 cells x 24 fresh seeds 501-524). Its BN13-without-the-gift cost (+2.6h, the reason
//     for the 0.25) is a gift-less node's: BN12 plays with the gift on. The exit model still prices the
//     boot's Raids at minP (bbplan.bladeExitGen's deliberate trade): the override keeps a finite bar.
//   the fleet's infiltrators (8 sleeves, i5 s3 = 0, 4 cells x 16 seeds 601-616): i6 s2 -0.08..+0.03,
//     i7 s1 / i8 / i6 f2 / i7 f1 / i5 f3 / i5 g3 -0.05..+0.14; under five: i4 s4 +0.06..+0.10, i4 f4
//     +0.10..+0.17, i3 s5 +0.14..+0.29, i3 f5 +0.26..+0.41, i2 s6 +0.58..+0.88h. The exit model the
//     chooser runs (bbplan.chooseSleeveConfigGen) ranks all of these within ~0.5h (i2 s6 7.64h beside
//     i5 s3 7.79h from one BN12.8 state): it cannot see what thin contract/operation counts cost, and the
//     live chooser held i3 s5 (BN12.6) and i2 f6 (BN12.2/12.3). So the chooser picks among fleets with
//     at least FLEET_FLOOR_NODES[node].infiltrate infiltrators — still priced, never a pinned fleet.
import { POLICY } from 'bbplan.js'

export const BOOT_OFF = { bootMinP: null, bootRaidMinP: null, bootSkillEveryS: null }
export const BOOT_OFF_NODES = {
  15: 'bbboot.mjs --levers --cells BN15.1 (16 paired seeds, 2026-10-25): the bootstrap policy +20.43 +- 5.02h on the exit (first black op +10.04 +- 2.95h) at BladeburnerRank 0.2',
}
/** Policy fields set per node (merged over POLICY), each with the measurement that set it. */
export const NODE_FIELDS = {
  12: { fields: { bootRaidMinP: 0.15 }, why: 'bb12.mjs (2026-11-13, 8 cells x 24 paired seeds): Raid at the boot bar 0.15 clear -0.05 +- 0.01h, first black op -0.12 +- 0.02h' },
}
/** The fleet's infiltrator floor per node (sleeve.js's and progress.js's fleet chooser), for a fleet of at least `n` sleeves (the measured size). */
export const FLEET_FLOOR_NODES = {
  12: { infiltrate: 5, n: 8, why: 'bb12.mjs (2026-11-13): under five infiltrators +0.06..+0.88h on the clear (i4 s4 .. i2 s6), what the exit model cannot see' },
}

const overrideOf = (node) => {
  if (BOOT_OFF_NODES[node]) return { ...BOOT_OFF }
  if (NODE_FIELDS[node]) return { ...NODE_FIELDS[node].fields }
  return null
}
const MEMO = new WeakMap()
/** The policy `pol` as played in BitNode `node`: the bootstrap fields off, or the node's fields, where listed (one object per pol and node). */
export function nodePolicyOf(node, pol = POLICY) {
  const o = overrideOf(node)
  if (!o || !pol || typeof pol !== 'object') return pol
  let m = MEMO.get(pol)
  if (!m) MEMO.set(pol, (m = new Map()))
  if (!m.has(node)) m.set(node, { ...pol, ...o, ...(BOOT_OFF_NODES[node] ? { bootOff: node } : { nodeFields: node }) })
  return m.get(node)
}

/** The exit model's override (bbplan.bladeStartOf `policy`): the node's fields, else null. */
export const nodePolicyOverrideOf = (node) => overrideOf(node)

/**
 * The fleet configurations the Bladeburner fleet chooser may pick in BitNode `node` for `n` sleeves
 * (bbplan.chooseSleeveConfigGen `allow`): a predicate, or null where the node has no floor or the fleet is
 * smaller than the one measured.
 */
export function fleetAllowOf(node, n) {
  const f = FLEET_FLOOR_NODES[node]
  if (!f || !(n >= f.n)) return null
  return (c) => (c?.infiltrate ?? 0) >= f.infiltrate
}
