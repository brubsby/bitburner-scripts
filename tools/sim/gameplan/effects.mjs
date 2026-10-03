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
// Phase 2 so far: SF14 (and BN14) — the IPvGO model, go.mjs: source formulas
// (GP4 runs them against the game), the measured BN9 Go farm, and the Go
// entries of SF_PARAMS (MEASURED mid with a spread, or ASSUMED, each says).
// SF13 (and BN13) — Stanek's Gift, stanekplan.js + stanek.mjs: source formulas
// (ST1 runs them against the game), MEASURED home RAM, ASSUMED st* entries.
//
// HOW AN EFFECT REACHES A CLEAR TIME (clear.mjs):
//   hackKey(l)      the level enters the hacking-exit simulation's key (the
//                   game's applySourceFile on a fresh player: hackexit.sfMults)
//   bbKey(l)        the level enters the Bladeburner simulation's key (bbsim)
//   gFactor(l, p, ctx)  a factor on the hacking route's latent growth g (ctx: node, mults, phase1, fleet)
//   sleeves(l, node) the sleeve fleet the clear runs with (SF10; the Bladeburner leg's fleet axis)
//   early(l, n, p)  hours the SF saves in node n's first life (both routes;
//                   on the Bladeburner route it shortens the opening only)
//   nodeLevel(l)    the level of the node the clear is played at (BN12 only)
//   go              the level enters the IPvGO model (go.mjs, via routes.mjs)
//   stanek          the level enters Stanek's Gift (stanek.mjs, via routes.mjs's stanek route)
// A Source-File with none of these is INERT: it changes no clear time, so the
// order search treats its clears as pure cost (they drift to where the stack
// is best).
//
// The quantile convention for every lo/mid/hi here and in params.mjs:
// lo = 10th percentile, mid = median, hi = 90th (split normal, z = ±1.2816).

// Source: SourceFile/applySourceFile.ts (multiplier SFs) — quoted per entry.
import { D10, extraSleeves, sleeveCount } from './sleeves.mjs'

/** phase 1's SF10.2/10.3 effect (nextnode d10 mid, node-free, per level): GP3's regression mode only. */
export const PHASE1_D10 = 0.01

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
  // --- the IPvGO farm (go.mjs; read by routes.mjs for every node, scaled by GoPower x the SF14 doubling)
  eps14: { lo: 0.0, mid: 0.12, hi: 0.3, min: 0, what: 'Go: elasticity of g to the Go rate bonus, g x ((1+s abar)/(1+abar))^eps (ASSUMED; mid = nextnode d14 2% at SF14.1)' },
  goP: { lo: 0.7, mid: 1.0, hi: 1.16, min: 0.1, what: 'Go: Daedalus node power / the measured 4391/h (MEASURED mid; hi = BN9 streak x1.16; lo ASSUMED: games lost to other opponents)' },
  rep14: { lo: 72, mid: 97, hi: 150, min: 10, what: 'Go: Daedalus work rep/h per hacking level, favor 0, FWRG 1 (MEASURED p10/p50/p90 over telemetry segments)' },
  lvl14: { lo: 3500, mid: 4700, hi: 5900, min: 2500, what: 'Go: the hacking level a favor life is ground at (MEASURED range, BN1/4/5/8/9/10)' },
  // DERIVED, not hand: go.mjs w0PriorMC (endGoGame's payout x W0_PRIOR_INPUTS: win rate, black's scores, games/h); GP8 re-derives it
  w0: { lo: 1020, mid: 1570, hi: 2380, min: 0, what: 'Go: w0r1d_d43m0n node power/h (DERIVED p10/p50/p90: the payout rules x win rate ~0.04, loss score ~87/267, ~8.8 games/h; was ASSUMED 0/200/1000)' },
  // DERIVED, not hand: sleeves.mjs (the extra sleeve's money crime trajectory lifting every measured life through exitplan's eBudget lift; was ASSUMED 0/0.01/0.03 node-free)
  d10: { lo: D10.lo, mid: D10.mid, hi: D10.hi, min: 0, what: 'SF10.2/10.3 (+1 sleeve each; +1 more inside BN10): hacking route g x (1 + d x CrimeMoney) per sleeve past 5 (DERIVED, sleeves.mjs: the live fall-through to a money crime x the measured lives; eBudget and income ASSUMED)' },
  d8: { lo: 0.0, mid: 0.005, hi: 0.02, min: 0, what: 'SF8.2: shorts -> g x (1+d)' },
  e43: { lo: 0.2, mid: 0.7, hi: 1.5, min: 0, what: 'SF4.3: Singularity RAM 436->247GB -> hours saved in the first life' },
  z9: { lo: -1.2816, mid: 0, hi: 1.2816, what: 'SF9.2/9.3: quantile position in the sf-early lo/mid/hi tables' },
  // --- Stanek's Gift (stanekplan.js via stanek.mjs; read by routes.mjs's stanek route). stream: 'stanek'
  // = drawn from their own random stream (params.drawZ), so every other draw is unchanged by them.
  stRam: { lo: 15, mid: 21, hi: 22.5, min: 8, stream: 'stanek', what: "Stanek: log2 home GB at a no-gift hacking exit (MEASURED p10/p50/p90, history.jsonl: 10 exits 14..25)" },
  stEpsM: { lo: 0.03, mid: 0.09, hi: 0.2, min: 0, stream: 'stanek', what: 'Stanek: elasticity of g to income (ASSUMED; mid = phi11 0.6 / (10 augs a life x ln 1.9))' },
  stEpsR: { lo: 0.03, mid: 0.12, hi: 0.3, min: 0, stream: 'stanek', what: "Stanek: elasticity of g to faction rep (ASSUMED; mid = eps14's, the Go rep channel)" },
  stFr: { lo: 2, mid: 4, hi: 8, min: 1, stream: 'stanek', what: "Stanek: the augs' faction_rep multiplier at a node's end (ASSUMED; the Church rep clock -> Awakening/Serenity)" },
  stDuty: { lo: 0.6, mid: 0.9, hi: 1, min: 0.1, stream: 'stanek', what: 'Stanek: share of each life the charger holds its threads (ASSUMED: restarts, the first minutes of a life)' },
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
    status: 'SIMULATED (Bladeburner: bbsim fleet axis) + DERIVED (hacking: sleeves.mjs)',
    source: 'PersonObjects/Sleeve/SleeveCovenantPurchases.tsx:63 sleeves = min(3, SF10 lvl + (BN10 ? 1 : 0)) + covenant (4 held)',
    // the hacking route: g x (1 + d10 x CrimeMoney)^(sleeves past 5) (sleeves.mjs); BN10's own extra
    // sleeve counts inside BN10. ctx.phase1: phase 1's g x 1.01^(l-1) (GP3's regression mode)
    gFactor: (l, p, ctx = {}) => {
      if (ctx.phase1) return Math.pow(1 + PHASE1_D10, Math.max(0, l - 1))
      if (ctx.fleet === 'five') return 1
      const x = extraSleeves(l, ctx.fleet === 'noBn10' ? null : ctx.node)
      if (x === 0) return 1
      // no silent CrimeMoney 1: a caller pricing extra sleeves must say which node's multipliers
      if (typeof ctx.mults?.CrimeMoney !== 'number') throw new Error(`SF10 gFactor: ${x} extra sleeve(s) at SF10.${l} in BN${ctx.node} need the node's CrimeMoney (gFactorOf ctx.mults)`)
      return Math.pow(1 + p.d10 * ctx.mults.CrimeMoney, x)
    },
    // the Bladeburner route: the leg at sleeveCount(l, node) sleeves (surrogate bbLeg's fleet axis)
    sleeves: (l, node, fleet = 'live') => (fleet === 'five' ? 5 : sleeveCount(l, fleet === 'noBn10' ? null : node)),
    note: 'Bladeburner: the leg x leg(live pick, n)/leg(live pick, 5) (surrogate BB_FLEET_N); hacking: the extra sleeve on its best money crime (the live fall-through: one sleeve per faction); a 2nd faction\'s rep and the exp transfer NOT PRICED; the 5th Covenant sleeve ($1e17, BN10 only) NOT a move (no Covenant axis)',
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
    status: 'MODELLED (stanekplan.js, stanek.mjs)',
    source: "CotMG/StaneksGift.ts:20-32 grid 9 + node StaneksGiftExtraSize + SF13 level; BitNodeUtils.ts:17 the gift outside BN13 at SF13>=1; formulas/effect.ts; Prestige.ts:125,184",
    stanek: true, // read by routes.mjs's stanek route: access (any node at SF13 >= 1) and the grid's size
    note: "the gift accepted or never at each node's start (min over routes); hacking route only — the Bladeburner route with the gift is NOT PRICED; st* ASSUMED/MEASURED in SF_PARAMS",
  },
  14: {
    status: 'MODELLED (go.mjs)',
    source: 'Go/effects/effect.ts:18-21 every Go bonus x2 at SF14>=1; effect.ts:30-43 favor cap 100k->200/300/400k rep; cheats netscriptGoImplementation.ts:486-497,564',
    go: true, // read by routes.mjs through go.mjs, for every node (the scale is GoPower x the doubling, so it is not a node-free gFactor)
    note: 'x2 on the g channel (eps14), on the favor life (Daedalus rep bonus and the favor cap) and on w0r1d_d43m0n; 14.2/14.3 cheats NOT PRICED',
  },
}

const ROLES = ['hackKey', 'bbKey', 'gFactor', 'early', 'nodeLevel', 'go', 'stanek', 'sleeves']
/** The SFs a clear time reads (the non-inert ones). */
export const LIVE_SFS = Object.keys(EFFECTS).map(Number).filter((n) => ROLES.some((r) => EFFECTS[n][r]))
export const isInert = (n) => !LIVE_SFS.includes(n)

/** The product of every gFactor (nextnode.phi). `lv(n)` gives the level. */
export function gFactorOf(lv, p, ctx = {}) {
  // ctx: { node, mults (the node's BitNode multipliers), phase1, fleet } — read by SF10's (the sleeve count is per node)
  let f = 1
  for (const n of LIVE_SFS) if (EFFECTS[n].gFactor) f *= EFFECTS[n].gFactor(lv(n), p, ctx)
  return f
}
/** The sleeve fleet a clear of `node` runs with (SF10's sleeves role; 5 when SF10 has none). */
export const sleevesOf = (lv, node, fleet = 'live') => (EFFECTS[10]?.sleeves ? EFFECTS[10].sleeves(lv(10), node, fleet) : 5)
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
