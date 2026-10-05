// THE UNCERTAIN PARAMETERS and how a world is drawn from them.
//
// NOT CALIBRATED: the DISTRIBUTIONS here are assumptions. Each lo/mid/hi is
// ported from nodechoice/nextnode.mjs (919b8ca) and read as the 10th / 50th /
// 90th percentile of a split normal (z = ±1.2816); the correlation structure
// (RHO, SIGMA_PLAYED) is new in this file and is NOT measured by anything.
// What IS measured: the played nodes' g (economy.mjs), the Bladeburner k
// = 1.223 (BN6.1: the live leg / the planner's own leg — ONE definition,
// below).
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
import { baseBonus, refBonus } from './go.mjs'

/**
 * Bladeburner route: clear = open + leg x k - early savings (nextnode.mjs §3).
 *
 * k: ONE DEFINITION, the one the route formula applies and observe.mjs reads
 * a clear with: k = (hours - opening + early) / leg, leg = the planner's own
 * leg (surrogate.bbLeg: bbsim, the game's classes, the fleet from the join).
 * BN6.1 reads 1.223 ((35.79 - 2.38) / 27.32). The base used to be 0.916 —
 * bbcal6.mjs's live leg over the leg AS RUN (the fleet 24.8h late), a
 * different denominator than the one it multiplied, so the prior was 25%
 * optimistic about every Bladeburner route it priced. k is everything
 * between the clean simulated leg and a live one: the operations (a fleet
 * idle after an install, the lean daemon until a host holds the full one,
 * the placement waits) and the exit model's own error. The in-game exit
 * (bbplan.bladeExit) prices the state AS IT IS — the fleet running, the
 * daemon acting, the cities read — so its rank calibration (bbplan
 * rankWindowOkOf/rankRatePosterior, v2) is the model's error alone, measured
 * only where the model's own trajectory runs, and is ~1 where the model
 * reproduces bbsim. lo/hi: the old opt/pess spread (x0.873, x1.255) around
 * the measured mid.
 */
export const BB_PARAMS = {
  // REFRESHED 2026-10-05 from the posterior (posterior.json after BN4.3: the hand prior 1.068/1.223/1.535
  // around BN6.1's 1.223, updated by BN4.3's 0.900): both readings are now inside it (observe.mjs baseIn),
  // and the next clear (BN14.1) updates it. Both were read against the leg of the policy they played
  // and no Go farm; the grid now prices the current policy WITH the farm (go.mjs bladeGoOf), so k
  // carries the operations gap only if that gap is policy-independent — BN14.1 (the current policy for
  // its second half, its own farm in its leg) is the first reading that tests it.
  k: { lo: 0.933, mid: 1.034, hi: 1.139, what: "live leg / the planner's own (clean) leg; the posterior over BN6.1 (1.223) and BN4.3 (0.900) — observe.mjs readings, refreshed as the prior 2026-10-05" },
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
export function paramIds(nodes, econ = null) {
  return [...nodes.map((n) => `g${n}`), ...(econ?.gJoint ? ['tauG'] : []), ...(econ?.disc ? nodes.filter((n) => econ.disc.applies(n)).map((n) => `delta${n}`) : []), 'k', 'open', ...Object.keys(SF_PARAMS)]
}

/** One draw: z per parameter (g's already combined with the common factor). */
export function drawZ(r, nodes, econ, { rho = econ.rho ?? RHO, rDisc = null, rStanek = null } = {}) {
  const zc = normal(r)
  const z = { zc }
  const J = econ.gJoint
  if (J) {
    // the covariate model (gmodel.mjs): tau from its posterior by zTau, then the
    // unplayed nodes' ln g jointly (their correlation is the shared beta and tau);
    // z[g n] is node n's standardised value, so worldOf / the VOI binning read it as before
    z.tauG = zc
    const u = J.nodes.map(() => normal(r))
    const lg = J.sampler.sample(zc, u)
    J.nodes.forEach((n, i) => (z[`g${n}`] = (lg[i] - J.mean.get(n)) / J.sd.get(n)))
    for (const n of nodes) if (!J.mean.has(n)) z[`g${n}`] = normal(r)
  } else
    for (const n of nodes) {
      const zn = normal(r)
      z[`g${n}`] = econ.ownG.has(n) ? zn : Math.sqrt(rho) * zc + Math.sqrt(1 - rho) * zn
    }
  z.k = normal(r)
  z.open = normal(r)
  for (const k of Object.keys(SF_PARAMS)) if (!SF_PARAMS[k].stream) z[k] = normal(r)
  // Stanek's parameters (effects.SF_PARAMS stream 'stanek') from their own stream rStanek when
  // given (plan.mjs), so adding them left every other draw as it was
  for (const k of Object.keys(SF_PARAMS)) if (SF_PARAMS[k].stream) z[k] = normal(rStanek ?? r)
  // the model discrepancy (discrepancy.mjs): one z per node it applies to, from its own
  // stream rDisc when given (plan.mjs), so the draws with and without it are paired
  if (econ.disc) for (const n of nodes) if (econ.disc.applies(n)) z[`delta${n}`] = normal(rDisc ?? r)
  return z
}

/**
 * A world from z's (missing z = 0, the median). econ: {ownG Map, gScen, gamma, amc, runs, profile}.
 * `phase1: true` prices exactly as phase 1 did (no IPvGO model, SF14.1 = g x 1.02, the
 * Bladeburner opening unscaled, HackingSpeedMultiplier unread): GP3's regression mode.
 */
export function worldOf(econ, z = {}, { sigmaPlayed = SIGMA_PLAYED, bbOff = false, phase1 = false, stanekOff = false, stanekBn13Only = false, w0Window = null, w0Live = false, fleet = 'live' } = {}) {
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
        : econ.gJoint?.mean.has(n)
        ? Math.exp(econ.gJoint.mean.get(n) + econ.gJoint.sd.get(n) * zz(`g${n}`))
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
    // Stanek's Gift (stanek.mjs): off = the gift never accepted (the pre-Stanek plan exactly);
    // bn13Only = the gift in BN13 alone (SF13 grants nothing outside it: SF13's own value)
    stanekOff,
    stanekBn13Only,
    // the sleeve fleet (sleeves.mjs): 'live' = min(3, SF10 + (BN10 ? 1 : 0)) + 4; 'five' = 5 everywhere
    // (SF10.2/10.3 and BN10's own sleeve worth nothing: the pre-fleet plan); 'noBn10' = no BN10 extra
    fleet,
    cycleHours: cyc,
    profile: econ.profile,
    z,
    // the discrepancy factor on node n's hacking-route hours (1 without one; discrepancy.mjs)
    disc: (n) => (econ.disc && !phase1 && econ.disc.applies(n) ? Math.exp(econ.disc.sd * (z[`delta${n}`] ?? 0)) : 1),
    go: {
      // the farm now (release 3c x goP) over one install window, and the farm the measured runs had (GO_REF):
      // goG credits the difference; the favor-life rep is divided by the reference's
      abar: baseBonus(cyc, sf.goP),
      aref: refBonus(cyc),
      // a node whose own g was measured (BN12 borrows BN1's) carries its own favor life in it
      played: (n) => econ.ownG.has(n),
      // the runs the unplayed latent is the mean of; BN2's Red Pill came from the gang, not Daedalus favor
      refNodes: runs.map((r) => r.bn).filter((n) => n !== 2),
      // the w0r1d_d43m0n window: null = the post-TRP climb fixed point (go.mjs goWindow);
      // a number = that many fixed hours (the old model: 1h, the regression mode)
      w0Window,
      // true: the bonus is worth only the climb's shortening (today's exitplan does not anticipate it)
      w0Live,
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
