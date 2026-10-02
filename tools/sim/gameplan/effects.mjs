// SOURCE-FILE EFFECTS — one explicit, inspectable entry per Source-File, each a
// function of the state, each citing the game source it rests on and saying
// what it is: SIMULATED (the game's own code runs inside a sim), ASSUMED (a
// number with a lo/mid/hi bound, NOT CALIBRATED), or NOT PRICED (0h, stated).
//
// NOT CALIBRATED (phase 1). Every ASSUMED entry below is ported unchanged from
// nodechoice/nextnode.mjs at 919b8ca (§2 there), lo/mid/hi included, so this
// planner reproduces it where the models coincide. Phase 2 replaces them one
// at a time; an entry's `status` is what the plan prints, so a replaced entry
// changes its own label. Nothing live has checked any ASSUMED number.
//
// HOW AN EFFECT REACHES A CLEAR TIME (clear.mjs):
//   hackKey(l)      the level enters the hacking-exit simulation's key (the
//                   game's applySourceFile on a fresh player: hackexit.sfMults)
//   bbKey(l)        the level enters the Bladeburner simulation's key (bbsim)
//   gFactor(l, p)   a factor on the hacking route's latent growth g
//   early(l, n, p)  hours the SF saves in node n's first life (both routes;
//                   on the Bladeburner route it shortens the opening only)
//   nodeLevel(l)    the level of the node the clear is played at (BN12 only)
// A Source-File with none of these is INERT: it changes no clear time, so the
// order search treats its clears as pure cost (they drift to where the stack
// is best).
//
// The quantile convention for every lo/mid/hi here and in params.mjs:
// lo = 10th percentile, mid = median, hi = 90th (split normal, z = ±1.2816).

// Source: SourceFile/applySourceFile.ts (multiplier SFs) — quoted per entry.
const SF11_R = [1, 0.96, 0.94, 0.93] // AugmentationHelpers.ts:30 [1, .96, .94, .93][activeSourceFileLvl(11)]

// SF9.2 / SF9.3 hours saved in the node's first life, MARGINAL over the level
// below: tools/sim/sf-early sensitivity table (run 2026-09-30, joint/BN4/BN10
// fits x takeoff 128/1024): lo = min over variants, mid = joint takeoff128,
// hi = max. Nodes it did not simulate take DEF9x (the median of the simulated).
// (Copied verbatim from nextnode.mjs.)
export const E92 = { 4: [0.9, 3.1, 4.2], 10: [1.1, 3.3, 3.4], 6: [0.3, 0.7, 0.7], 7: [0.3, 0.7, 0.7], 11: [0.1, 0.2, 0.2], 13: [1.7, 1.9, 1.9], 14: [0.6, 3.8, 3.8], 8: [0.0, 0.3, 0.5] }
export const E93 = { 4: [0.0, 0.0, 0.9], 10: [0.3, 0.3, 6.1], 6: [1.0, 1.0, 3.0], 7: [1.0, 1.0, 3.0], 11: [0.8, 0.8, 0.9], 13: [5.2, 5.4, 5.4], 14: [1.1, 1.1, 7.6], 8: [0, 0, 0] }
export const DEF92 = [0.3, 1.9, 3.8]
export const DEF93 = [0.3, 1.0, 3.0]

/**
 * The ASSUMED SF-effect parameters, lo / mid / hi (nextnode.mjs SA table).
 * A draw sets each to a value; the deterministic "mid" world uses mid.
 * `e9` is a quantile position (z) applied to every node's E92/E93 triple.
 */
export const SF_PARAMS = {
  phi11: { lo: 0.3, mid: 0.6, hi: 1.0, min: 0, what: 'SF11: g x (ln1.9/ln(1.9 r))^phi, r = .96/.94/.93' },
  d14: { lo: 0.0, mid: 0.02, hi: 0.05, min: 0, what: 'SF14.1: every Go bonus doubled -> g x (1+d)' },
  d10: { lo: 0.0, mid: 0.01, hi: 0.03, min: 0, what: 'SF10.2/10.3: +1 sleeve each -> g x (1+d) per level' },
  d8: { lo: 0.0, mid: 0.005, hi: 0.02, min: 0, what: 'SF8.2: shorts -> g x (1+d)' },
  e43: { lo: 0.2, mid: 0.7, hi: 1.5, min: 0, what: 'SF4.3: Singularity RAM 436->247GB -> hours saved in the first life' },
  z9: { lo: -1.2816, mid: 0, hi: 1.2816, what: 'SF9.2/9.3: quantile position in the sf-early lo/mid/hi tables' },
}

/** Split-normal quantile through (Q10 lo, Q50 mid, Q90 hi) at standard-normal z. */
export function splitQ(lo, mid, hi, z) {
  return z < 0 ? mid + (z / 1.2816) * (mid - lo) : mid + (z / 1.2816) * (hi - mid)
}

export const EFFECTS = {
  1: {
    status: 'SIMULATED',
    source: 'applySourceFile.ts case 1: every player multiplier x (1 + sum 16/2^i %)',
    hackKey: (l) => l,
    note: 'held at 3 already; on the Bladeburner route it is part of the grid base (surrogate.mjs BB_BASE)',
  },
  2: {
    status: 'NOT PRICED',
    source: 'applySourceFile.ts case 2: crime_money, crime_success, charisma x (1 + sum 24/2^i %) — read by neither route model',
    note: 'SF2.1 (gang anywhere) is already held; levels 2-3 add only crime/charisma multipliers',
  },
  3: {
    status: 'NOT PRICED',
    source: 'applySourceFile.ts case 3: charisma, work_money; PlayerObjectCorporationMethods.ts:21 corporation anywhere at SF3.3',
    note: 'a corporation outside BN3 (SF3.3) is a route this repo does not run — phase 2 (routes.mjs corp hook)',
  },
  4: {
    status: 'ASSUMED',
    source: 'Netscript/RamCostGenerator.ts:87 Singularity RAM by activeSourceFileLvl(4); measured 436 -> 247GB at level 3',
    early: (l, n, p) => (l >= 3 ? p.e43 : 0),
  },
  5: {
    status: 'SIMULATED',
    source: 'applySourceFile.ts case 5: hacking, hacking_exp, hacking_money, ... x (1 + sum 8/2^i %)',
    hackKey: (l) => l,
  },
  6: {
    status: 'SIMULATED',
    source: 'applySourceFile.ts case 6: combat levels and exp x (1 + sum 8/2^i %) — inside bbsim',
    bbKey: (l) => l,
  },
  7: {
    status: 'SIMULATED',
    source: 'applySourceFile.ts case 7: bladeburner stamina, analysis, success x (1 + sum 8/2^i %) — inside bbsim',
    bbKey: (l) => l,
    note: "SF7.3's Blade's Simulacrum is NOT PRICED (the Bladeburner policy holds the work slot and does not install)",
  },
  8: {
    status: 'ASSUMED',
    source: 'NetscriptFunctions/StockMarket.ts:47 shorts at SF8.2, limit orders at SF8.3; applySourceFile.ts case 8 hacking_grow (not read by the exit model)',
    hackKey: (l) => (l > 0 ? 1 : 0), // the trader (WSE+TIX free) — hackexit.freshInputs
    gFactor: (l, p) => (l >= 2 ? 1 + p.d8 : 1),
  },
  9: {
    status: 'ASSUMED (simulated by tools/sim/sf-early, uncalibrated there)',
    source: 'Prestige.ts:242 128GB home at SF9.2; Prestige.ts:329 hacknet server at SF9.3',
    early: (l, n, p) => {
      let h = 0
      if (l >= 2) h += Math.max(0, splitQ(...(E92[n] ?? DEF92), p.z9))
      if (l >= 3) h += Math.max(0, splitQ(...(E93[n] ?? DEF93), p.z9))
      return h
    },
  },
  10: {
    status: 'ASSUMED',
    source: 'PersonObjects/Sleeve/SleeveCovenantPurchases.tsx:63 sleeves = min(3, SF10 lvl) + covenant',
    gFactor: (l, p) => Math.pow(1 + p.d10, Math.max(0, l - 1)),
    note: 'the extra sleeves are NOT simulated on the Bladeburner route (5 infiltrators fixed: conservative)',
  },
  11: {
    status: 'ASSUMED',
    source: 'Augmentation/AugmentationHelpers.ts:30 queued-aug price x 1.9 x [1,.96,.94,.93][lvl]; Work/Formulas.ts:132 company favor',
    gFactor: (l, p) => Math.pow(Math.log(1.9) / Math.log(1.9 * SF11_R[Math.min(3, l)]), p.phi11),
  },
  12: {
    status: 'NOT PRICED',
    source: 'Prestige.ts:256 NeuroFlux levels = SF12 level at every node start; BitNode.tsx:919 BN12 multipliers 1.02^-lvl',
    nodeLevel: (l) => l + 1,
    note: 'owed once, so the BN12 level is always 1 and the NeuroFlux head start is unpriced',
  },
  13: {
    status: 'NOT PRICED',
    source: "CotMG/StaneksGift.ts:22 Stanek's Gift size + SF13 level",
    note: "Stanek's Gift is not run by this repo — phase 2 (routes.mjs stanek hook)",
  },
  14: {
    status: 'ASSUMED',
    source: 'Go/effects/effect.ts:18 every Go bonus x2 with SF14; netscriptGoImplementation.ts:488,564 cheats at 14.2, +25% at 14.3',
    gFactor: (l, p) => (l >= 1 ? 1 + p.d14 : 1),
    note: 'only the level-1 doubling is priced; 14.2/14.3 NOT PRICED',
  },
}

const ROLES = ['hackKey', 'bbKey', 'gFactor', 'early', 'nodeLevel']
/** The SFs a clear time reads (the non-inert ones). */
export const LIVE_SFS = Object.keys(EFFECTS).map(Number).filter((n) => ROLES.some((r) => EFFECTS[n][r]))
export const isInert = (n) => !LIVE_SFS.includes(n)

/** The product of every gFactor (nextnode.phi). `lv(n)` gives the level. */
export function gFactorOf(lv, p) {
  let f = 1
  for (const n of LIVE_SFS) if (EFFECTS[n].gFactor) f *= EFFECTS[n].gFactor(lv(n), p)
  return f
}
/** The sum of every early-game saving for a clear of node `node` (nextnode.early). */
export function earlyOf(lv, node, p) {
  let h = 0
  for (const n of LIVE_SFS) if (EFFECTS[n].early) h += EFFECTS[n].early(lv(n), node, p)
  return h
}
/** The hacking simulation's Source-File key: [[n, keyed level]] for every hackKey. */
export const hackSfOf = (lv) => LIVE_SFS.filter((n) => EFFECTS[n].hackKey).map((n) => [n, EFFECTS[n].hackKey(lv(n))]).filter(([, l]) => l > 0)
export const bbSfOf = (lv) => LIVE_SFS.filter((n) => EFFECTS[n].bbKey).map((n) => [n, EFFECTS[n].bbKey(lv(n))])

/** The mid value of every SF-effect parameter. */
export const sfParamsMid = () => Object.fromEntries(Object.entries(SF_PARAMS).map(([k, v]) => [k, v.mid]))

/** A Source-File key as text: [[1,3],[5,1]] -> '1.3,5.1' (the surrogate's curve key). */
export const sfKeyStr = (pairs) => pairs.map(([n, l]) => `${n}.${l}`).join(',')
