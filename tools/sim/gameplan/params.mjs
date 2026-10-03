// THE UNCERTAIN PARAMETERS and how a world is drawn from them.
//
// NOT CALIBRATED: the DISTRIBUTIONS here are assumptions. Each lo/mid/hi is
// ported from nodechoice/nextnode.mjs (919b8ca) and read as the 10th / 50th /
// 90th percentile of a split normal (z = ±1.2816); the correlation structure
// (RHO, SIGMA_PLAYED) is new in this file and is NOT measured by anything.
// What IS measured: the played nodes' g (economy.mjs), the Bladeburner k
// = 0.916 (nodechoice/bbcal6.mjs, the live BN6 leg / the model's median).
//
// These hand distributions are the BASE of posterior.mjs: plan.mjs draws
// through posterior.json (the hand prior updated by observe.mjs's readings of
// finished nodes and the in-run channel); with an empty log, or --prior, every
// draw here is exactly the hand one.
//
// A WORLD is one setting of every parameter: { g(n), k, open, sf{...}, bbOff }.
// The deterministic "mid" world (every z = 0) is nextnode's cal/mid/mid cell.
// A DRAW is a vector of standard-normal z's; the same draws price every first
// move (common random numbers), so regret is a paired difference.

import { SF_PARAMS, splitQ } from './effects.mjs'
import { baseBonus } from './go.mjs'

/** Bladeburner route: clear = open + leg x k - early savings (nextnode.mjs §3). */
export const BB_PARAMS = {
  k: { lo: 0.8, mid: 0.916, hi: 1.15, what: 'live / model leg; mid MEASURED on BN6 (bbcal6.mjs); lo/hi = nextnode opt/pess' },
  open: { lo: 1.5, mid: 2.5, hi: 4.0, what: 'hours entry -> combat 100 (MEASURED BN6 2.5h); lo/hi = nextnode opt/pess' },
}
/** Economy: share of an unplayed node's ln g deviation that is common to all unplayed nodes. ASSUMED. */
export const RHO = 0.5
/** Economy: a played node's replay g = measured x exp(SIGMA_PLAYED z). ASSUMED (one run each; nextnode used 0). */
export const SIGMA_PLAYED = 0.15
const Z90 = 1.2816

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function normal(r) {
  let u = 0
  while (u <= 1e-12) u = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

/** The ids of every uncertain parameter, for the value-of-information table. */
export function paramIds(nodes) {
  return [...nodes.map((n) => `g${n}`), 'k', 'open', ...Object.keys(SF_PARAMS)]
}

/** One draw: z per parameter (g's already combined with the common factor). */
export function drawZ(r, nodes, econ, { rho = econ.rho ?? RHO } = {}) {
  const zc = normal(r)
  const z = { zc }
  for (const n of nodes) {
    const zn = normal(r)
    z[`g${n}`] = econ.ownG.has(n) ? zn : Math.sqrt(rho) * zc + Math.sqrt(1 - rho) * zn
  }
  z.k = normal(r)
  z.open = normal(r)
  for (const k of Object.keys(SF_PARAMS)) z[k] = normal(r)
  return z
}

/**
 * A world from z's (missing z = 0, the median). econ: {ownG Map, gScen, gamma, amc, runs, profile}.
 * `phase1: true` prices exactly as phase 1 did (no IPvGO model, SF14.1 = g x 1.02, the
 * Bladeburner opening unscaled, HackingSpeedMultiplier unread): GP3's regression mode.
 */
export function worldOf(econ, z = {}, { sigmaPlayed = SIGMA_PLAYED, bbOff = false, phase1 = false } = {}) {
  // econ from posterior.mjs posteriorOf().applied carries the update: zMap (a
  // scalar's prior z -> posterior z), gShift/gScale (the unplayed latent's
  // location and spread), gSd (a node observed since the base: its own log sd).
  // A plain economy (no posterior) prices exactly the hand prior.
  const zm = econ.zMap ?? {}
  const zz = (k) => (zm[k] ? zm[k](z[k] ?? 0) : z[k] ?? 0)
  const gShift = econ.gShift ?? 0
  const gScale = econ.gScale ?? 1
  const lg = { lo: Math.log(econ.gScen.lo), mid: Math.log(econ.gScen.mid), hi: Math.log(econ.gScen.hi) }
  const gCache = new Map()
  const g = (n) => {
    let v = gCache.get(n)
    if (v === undefined) {
      v = econ.ownG.has(n)
        ? econ.ownG.get(n) * Math.exp((econ.gSd?.get(n) ?? sigmaPlayed) * zz(`g${n}`))
        : Math.exp(gShift === 0 && gScale === 1 ? splitQ(lg.lo, lg.mid, lg.hi, zz(`g${n}`)) : lg.mid + gShift + (splitQ(lg.lo, lg.mid, lg.hi, zz(`g${n}`)) - lg.mid) * gScale) * Math.pow(econ.amc[n], -econ.gamma)
      gCache.set(n, v)
    }
    return v
  }
  const q = (p, k) => splitQ(p.lo, p.mid, p.hi, zz(k))
  const sf = {}
  for (const [k, p] of Object.entries(SF_PARAMS)) sf[k] = k === 'z9' ? zz(k) : Math.max(p.min ?? -Infinity, q(p, k))
  // The Go model's per-world inputs (go.mjs): the measured runs' mean Daedalus
  // bonus over one install window, and who calibrates the favor life's reference.
  const cyc = econ.profile?.cycleHours ?? 2
  const runs = econ.runs ?? []
  return {
    g,
    k: Math.max(0.3, q(BB_PARAMS.k, 'k')),
    open: Math.max(0.5, q(BB_PARAMS.open, 'open')),
    sf,
    bbOff,
    phase1,
    z,
    go: {
      abar: baseBonus(cyc, sf.goP),
      // a node whose own g was measured (BN12 borrows BN1's) carries its own favor life in it
      played: (n) => econ.ownG.has(n),
      // the runs the unplayed latent is the mean of; BN2's Red Pill came from the gang, not Daedalus favor
      refNodes: runs.map((r) => r.bn).filter((n) => n !== 2),
      memo: new Map(),
    },
  }
}

/**
 * nextnode.mjs's named cells as z's: bb off|pess|cal|opt, sc (economy) lo|mid|hi
 * for every UNPLAYED node together, sa (SF effects) lo|mid|hi together.
 */
export function cellZ(cell, nodes, econ) {
  const s = { lo: -Z90, mid: 0, hi: Z90 }
  const z = {}
  for (const n of nodes) z[`g${n}`] = econ.ownG.has(n) ? 0 : s[cell.sc]
  for (const k of Object.keys(SF_PARAMS)) z[k] = s[cell.sa]
  const b = { pess: Z90, cal: 0, opt: -Z90, off: 0 }[cell.bb]
  z.k = b
  z.open = b
  return z
}
