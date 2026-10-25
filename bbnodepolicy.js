// THE BLADEBURNER POLICY PER NODE. Pure, no ns calls (0GB; imported by bladeburner.js, bb-lite's actors,
// progress.js's exit model and the gameplan's bbsim specs, so every one plays and prices the same policy).
//
// THE BOOTSTRAP PHASE OFF WHERE IT LOSES (2026-10-25). bbplan.POLICY's bootstrap (bootMinP 0.15, Raid
// 0.25, skills every 120s until the first black op and its rank 2.5k: bbplan.phasePolicyOf) was priced
// on BN5.2 / BN2.2 / BN13.3 (tools/sim/bbboot.mjs header: -0.37 / -0.73 / +0.06h). At BitNode 15's
// BladeburnerRank 0.2 the rank-2.5k boot lasts ~50h of node time, and its low-chance bars cost far more
// than they buy — bbboot.mjs --levers --cells BN15.1 (the game's own classes, 16 paired seeds 501-516,
// the gift on, 8 sleeves, SF8.3, int 157):
//   the bootstrap policy vs none   exit +20.43 +- 5.02h (96.9h vs 76.5h), first black op +10.04 +- 2.95h
// NOT CALIBRATED live (no node has played Bladeburner at rank x0.2). A node not listed plays POLICY.
import { POLICY } from 'bbplan.js'

export const BOOT_OFF = { bootMinP: null, bootRaidMinP: null, bootSkillEveryS: null }
export const BOOT_OFF_NODES = {
  15: 'bbboot.mjs --levers --cells BN15.1 (16 paired seeds, 2026-10-25): the bootstrap policy +20.43 +- 5.02h on the exit (first black op +10.04 +- 2.95h) at BladeburnerRank 0.2',
}

const MEMO = new WeakMap()
/** The policy `pol` as played in BitNode `node`: the bootstrap fields off where BOOT_OFF_NODES lists it (one object per pol and node). */
export function nodePolicyOf(node, pol = POLICY) {
  if (!BOOT_OFF_NODES[node] || !pol || typeof pol !== 'object') return pol
  let m = MEMO.get(pol)
  if (!m) MEMO.set(pol, (m = new Map()))
  if (!m.has(node)) m.set(node, { ...pol, ...BOOT_OFF, bootOff: node })
  return m.get(node)
}

/** The exit model's override (bbplan.bladeStartOf `policy`): the bootstrap fields off in a listed node, else null. */
export const nodePolicyOverrideOf = (node) => (BOOT_OFF_NODES[node] ? { ...BOOT_OFF } : null)
