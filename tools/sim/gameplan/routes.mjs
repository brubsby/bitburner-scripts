// THE ROUTES a clear can take, and C(node, state, world) — the hours of one clear.
//
// NOT CALIBRATED as a whole (see each route's `status`). The two priced routes
// were ported from nodechoice/nextnode.mjs §4 (919b8ca) in phase 1; phase 2
// adds the IPvGO model to the hacking route and the gym scale to the opening:
//
//   hack   H = max(0.5 x Hx, Hx - early)              Hx = Hsim shifted by the
//          IPvGO model (go.mjs), Hsim = hacking exit from a fresh entry at
//          g = g(node) x prod gFactor(SF) x goG, the node played at its level
//          (BN12: SF12 + 1):
//            Hx = max(min(Hsim, .5), Hsim - ln(W)/g) + favor(node, SF14) - favor_ref(node)
//          goG    the Go rate bonus on g at scale GoPower x (SF14 ? 2 : 1), the farm now
//                 (release 3c x goP) over the farm the measured g's had (4391/h: go.mjs GO_REF)
//          W      the w0r1d_d43m0n hacking-level bonus at the exit (divides the exit level):
//                 effect(w0 x L*) at the node's scale, L* the window — the post-TRP
//                 climb at this g (surrogate, phase-averaged) shortened by the bonus
//                 it banks (go.mjs goWindow's fixed point). world.go.w0Window = h
//                 fixes it at h hours (the old model: 1h)
//          favor  the favor life: hours to bank 150 x FavorToDonate favor on
//                 Daedalus with the Go farm on it (FactionWorkRepGain, the Go
//                 Daedalus bonus, the Go favor stream and its cap); the
//                 reference is the favor life inside the g it was measured
//                 with (the node's own if played, else the measured runs' mean)
//          BN14's is the 'go' route below (the same formula at GoPower 4; hack does not apply there)
//   blade  B = open - min(early, max(0, open - 0.5)) + leg(node, SF6, SF7, sleeves) x k
//          the leg with the Go farm on Tetrads from the node's start (go.mjs bladeGoOf: the
//          combat level multipliers x effect(nodes) at GoPower x the SF14 doubling, no install
//          so no wipe) — bbsim plays bbplan's current POLICY and code (the surrogate's key hashes both)
//          sleeves = min(3, SF10 + (BN10 ? 1 : 0)) + 4 (sleeves.mjs); the leg at 6/7 = the
//          5-infiltrator leg x the live fleet pick's leg ratio (surrogate BB_FLEET_N)
//          available where the node has Bladeburner (BladeburnerRank > 0) and
//          the player can join it (BN6/BN7, or SF6/SF7 held)
//   C = the route chosen on its EXPECTED hours under its measured model error (routecal.js: E = point x
//       exp(s^2/2), s = max(the family's pooled leave-one-out RMS, the node's own)) in the choice world (the
//       mid world), and that route committed in every drawn world (world.routeErr, params.mjs routeErrOf);
//       without world.routeErr (tests, --route-rule point): min over the available routes' points
//
//   blade's opening is scaled per node: open + (gym hours to combat 100 in the
//          node - in BN6), both simulated by bbsim (the game's own skill
//          formula at the node's combat level multipliers: BN14 x0.5)
//
//   bladeStanek  B with the gift accepted at the node's start: the join + joinD and the leg x
//          ratio from bbsim's two arms on shared seeds (bbstanek.mjs --table, bladestanek.mjs) —
//          NOT CALIBRATED (no Bladeburner node has run with the gift)
//
//   stanek H with the gift accepted at the node's start (stanek.mjs): g x gMul, W x the
//          gift's exit divisor, the favor life x favorMul — wherever the gift is
//          available (BN13, or SF13 >= 1); min over routes = accept or never, per node
//
//   lab (BN15) the hacking route with The Red Pill from the darknet LABYRINTH instead of Daedalus
//          (BN15 only: FactionHelpers.tsx:205 removes it from Daedalus' list; labyrinth.ts:419-427 puts
//          it in the 5th lab, EternalLab, depth 29, charisma 3000, reached after the 4 earlier labs'
//          augmentations are INSTALLED — 5 lab clears, an install after each): H (the hack formula
//          without the Daedalus favor life) + LAB15 (DERIVED, tools/sim/lab15.mjs: the charisma climbs and the
//          crawl to depth 28 the hacking exit does not price). The hack and stanek routes do not
//          apply in BN15 (there is no Daedalus Red Pill to price them on).
//
// NODE-SPECIAL ROUTES are hooks; a placeholder prices nothing (returns null)
// and is flagged NOT CALIBRATED in the plan's output. BN14's is a model (phase
// 2): the hacking route with the Go farm at GoPower 4. BN8's is a model (bn8.mjs,
// 2026-10-23): the stock-only exit, which replaces the hacking and stanek routes there
// (world.bn8; plan.mjs --bn8-hack restores them).
//
// world.phase1 prices as phase 1 did (GP3's regression mode): no Go model,
// SF14.1 = g x 1.02, the opening unscaled, BN14 on the plain hacking route.

import { earlyOf, gFactorOf, hackSfOf, EFFECTS, sfKeyStr, LIVE_SFS, sleevesOf } from './effects.mjs'
import { goScale, goGFactor, w0rldDiv, exitShift, favorLifeOf, goWindow } from './go.mjs'
import { giftAvailable, stanekFactors } from './stanek.mjs'
import { giftLegOf } from './bladestanek.mjs'
import { isCovenantBuyClear } from './sleeves.mjs'
import { NODE_ROUTE_RULES } from '../../../routepin.js'
import { legOf as lab15LegOf, SCENARIOS as LAB15_SCENARIOS, MEASURED_AT as LAB15_MEASURED_AT } from '../lab15.mjs'

/** phase 1's SF14.1 effect (nextnode d14 mid): GP3's regression mode only. */
export const PHASE1_D14 = 0.02

/**
 * The favor life's hours for node n at SF14 level l in this world (memoised on the world).
 * era 'now': with the farm every clear from here plays (release 3c x goP); 'ref': with the
 * farm the measured runs had (go.mjs GO_REF) — what is already inside a measured g.
 */
export function favorHours(n, l, world, S, era = 'now') {
  const k = `${n}|${l}|${era}`
  let v = world.go.memo.get(k)
  if (v === undefined) {
    v = favorLifeOf(S.mults(n), l, world.sf, world.go.aref ?? world.go.abar, era).hours
    world.go.memo.set(k, v)
  }
  return v
}
/** The favor life already inside node n's g: its own (played, SF14 0) or the measured runs' mean — at the reference farm. */
export function favorRef(n, world, S) {
  if (world.go.played(n)) return favorHours(n, 0, world, S, 'ref')
  const ns = world.go.refNodes
  return ns.reduce((a, m) => a + favorHours(m, 0, world, S, 'ref'), 0) / ns.length
}

/**
 * The hacking route with the Go model, every term exposed (plan.mjs prints it).
 * Returns { h, hsim, g, goG, W, favor, favorRef, early } or null.
 */
export function hackParts({ node, lv, world, S, st = null }) {
  const nodeLevel = EFFECTS[node]?.nodeLevel ? EFFECTS[node].nodeLevel(lv(node)) : 1
  const l14 = lv(14)
  let g = world.g(node) * gFactorOf(lv, world.sf, { node, mults: S.mults(node), phase1: !!world.phase1, fleet: world.fleet })
  let goG = 1
  let W = 1
  let win = null
  let favor = 0
  let fref = 0
  const sfKey = sfKeyStr(hackSfOf(lv))
  if (world.phase1) {
    if (l14 >= 1) g *= 1 + PHASE1_D14
  } else {
    const s = goScale(S.mults(node).GoPower, l14)
    goG = goGFactor(s, world.go.abar, world.sf.eps14, world.go.aref ?? world.go.abar)
    g *= goG
    // THE WINDOW (go.mjs goWindow): w0r1d_d43m0n is played from The Red Pill install to
    // the exit — the post-TRP climb at this g, shortened by the bonus it banks.
    // world.go.w0Window a number: the old fixed window (regression mode).
    const fixed = world.go?.w0Window
    if (typeof fixed === 'number') {
      W = w0rldDiv(s, world.sf.w0, fixed)
      win = { hours: fixed, L0: fixed, W }
    } else {
      const c = world.sf.w0 > 0 ? S.hackClimb(node, nodeLevel, sfKey, g) : null
      win = c ? goWindow({ L0: c.L0, u0: c.u0, w0: world.sf.w0, s }) : { hours: 0, L0: 0, W: 1 }
      W = win.W
    }
    // BN2's Red Pill is sold by the gang (no Daedalus favor life in its g, nor in a replay);
    // BN15's is in the darknet labyrinth (labyrinth.ts:419-427: no Daedalus rep for it either)
    if (node !== 2 && node !== 15) {
      favor = favorHours(node, l14, world, S)
      fref = favorRef(node, world, S)
    }
    // Stanek's Gift accepted (stanek.mjs factors): g, the exit divisor, the favor life
    if (st) {
      g *= st.gMul
      W *= st.W
      favor *= st.favorMul
    }
  }
  // world.disc: the model discrepancy on the simulated hours (discrepancy.mjs; 1 when there is none)
  const sf = sfKey
  const opts = world.phase1 ? { speed1: true } : undefined
  const disc = world.disc ? world.disc(node) : 1
  const hsim = S.hackHours(node, nodeLevel, sf, g, opts) * disc
  if (!isFinite(hsim)) return null
  // the bonus's worth: the exit level divided by W with the installs re-planned (exitShift, the
  // default), or — world.go.w0Live — only the climb's own shortening L0 - L*, what a final life
  // that does not anticipate the bonus (today's exitplan) realises (go.mjs WHAT IT SAYS)
  const hx = (world.go?.w0Live && win ? exitShift(hsim, g, st ? st.W : 1) - Math.max(0, win.L0 - win.hours) : exitShift(hsim, g, W)) + favor - fref
  const early = earlyOf(lv, node, world.sf)
  // sim: the simulation's key, so the gift's run (giftParts) re-runs it at its own g without rebuilding it
  return { h: Math.max(0.5 * hx, hx - early), hsim, g, goG, W, win, favor, favorRef: fref, early, sim: { nodeLevel, sf, opts, disc, w0Live: !!world.go?.w0Live } }
}

/**
 * The hacking route of `base` (hackParts, no gift) with Stanek's factors st: the same
 * simulation at g x gMul, the exit divisor x W, the favor life x favorMul. Equal to
 * hackParts({ ...a, st }) (tools/test/stanek.test.mjs ST5), without recomputing the rest.
 */
export function giftParts(base, st, { node, S }) {
  const g = base.g * st.gMul
  const hsim = S.hackHours(node, base.sim.nodeLevel, base.sim.sf, g, base.sim.opts) * base.sim.disc
  if (!isFinite(hsim)) return null
  const W = base.W * st.W
  const favor = base.favor * st.favorMul
  // --w0-live: the hidden opponent's part is the climb's shortening (base.win), the gift's W shifts the exit
  const live = base.sim.w0Live && base.win
  const hx = (live ? exitShift(hsim, g, st.W) - Math.max(0, base.win.L0 - base.win.hours) : exitShift(hsim, g, W)) + favor - base.favorRef
  return { h: Math.max(0.5 * hx, hx - base.early), hsim, g, goG: base.goG, W, win: base.win, favor, favorRef: base.favorRef, early: base.early, sim: base.sim }
}

/**
 * THE GIFT ACCEPTED at the node's start: the hacking route (BN14: its go route) run
 * again with Stanek's factors (stanek.mjs), which depend on the no-gift run's hours and
 * g. Returns { ...hackParts, st, base } (base = the no-gift parts) or null.
 */
export function stanekParts(a) {
  const base = a.ctx && 'hack' in a.ctx ? a.ctx.hack : hackParts(a)
  if (!base || !isFinite(base.h)) return null
  const st = stanekFactors(a.node, a.lv(13), a.world, a.S.mults(a.node), { H0: base.h, g: base.g })
  const p = giftParts(base, st, a)
  return p ? { ...p, st, base } : null
}

/**
 * The Bladeburner route's hours; gift = the bladeStanek table entry (bladestanek.giftLegOf) or null.
 * With the gift: the join shifted by the table's joinD and the leg x its ratio — the same open,
 * early, fleet leg and k as without, so the two routes differ only in the gift.
 */
export function bladeHours({ node, lv, world, S }, gift = null) {
  const l6 = Math.max(1, Math.min(3, lv(6)))
  const l7 = Math.min(3, lv(7))
  // the fleet: sleeves.mjs sleeveCount (SF10 + BN10's own + 4 Covenant); phase 1 priced 5 infiltrators
  const leg = S.bbLeg(node, l6, l7, world.phase1 ? 5 : sleevesOf(lv, node, world.fleet))
  if (!leg) return null
  // the opening measured in BN6 (2.5h), plus the gym hours this node's combat multipliers add over BN6's
  const open = world.phase1 ? world.open : Math.max(0.5, world.open + (S.bbJoin(node, l6, l7) ?? 0) - (S.bbJoin(6, l6, l7) ?? 0) + (gift?.joinD ?? 0))
  return open - Math.min(earlyOf(lv, node, world.sf), Math.max(0, open - 0.5)) + leg.median * world.k * (gift?.ratio ?? 1)
}

/** hackParts, kept on the call's ctx for the routes that build on it (stanek). */
const hackOnCtx = (a) => {
  const p = hackParts(a)
  if (a.ctx) a.ctx.hack = p
  return p?.h ?? null
}

/**
 * THE LABYRINTH LEG (BN15's 'lab' route), DERIVED (tools/sim/lab15.mjs, second derivation 2026-10-26): the labs
 * ride on the hacking route's lives (the farm and the crawler are scripts on free RAM, no work slot), so the leg
 * is what they add — the install each lab 1-4 forces when it clears before its life's own install, and the
 * hours a climb is HELD past the last life before the final window (chaplan.labScheduleOf). The charisma
 * multiplier per life is MEASURED (labtraj.js, tools/sim/chatraj.mjs: every hacking-route clear's installed
 * charisma product per life — Speech Processor / Nuoptimal / Speech Enhancement / Magnetism / Neural Wit /
 * the corporations' SmartJaw, Social Dynamics, ADR-V2, nextSENS, and NeuroFlux), transferred to BN15's hacking
 * length: lo / mid / hi = the leg's 25 / 50 / 75% quantiles over the trajectories that reach The Red Pill;
 * pFail the share that do not (the in-game arm prices those as the black ops from the stall, labroute.js).
 * The first slice's notes, still true:
 *   the charisma climb  lab 5 needs 3000 (labyrinth.ts labData), lab 4 2500, lab 3 1500 — level =
 *                       mult x (32 ln(exp + 534.6) - 200); SF1.3 x SF2.3 x SF3.3 x BN15's 1.1 ~ 2.28
 *   the crawl           depth 28 across the air gaps at 8/16/24 (Enums.ts AIR_GAP_DEPTH), measured
 *   the five lives      each lab's augmentation must be INSTALLED before the next lab exists
 * The 'lab' route is priced at world.lab15 ?? mid.
 */
const lab15Of = (k) => +lab15LegOf(LAB15_SCENARIOS[k]).h.toFixed(2)
const LAB15_FAIL = lab15LegOf(LAB15_SCENARIOS.mid).pFail
export const LAB15 = {
  lo: lab15Of('lo'),
  mid: lab15Of('mid'),
  hi: lab15Of('hi'),
  pFail: LAB15_FAIL === null ? null : +LAB15_FAIL.toFixed(3),
  status: `DERIVED (tools/sim/lab15.mjs: the labs riding the hacking lives, climbs by chaplan calibrated -2.7%; crawl+maze MEASURED by ${LAB15_MEASURED_AT}; the charisma trajectory MEASURED on ${lab15LegOf(LAB15_SCENARIOS.mid).n} hacking-route clears, its transfer to BN15 NOT CALIBRATED; P(fail) ${LAB15_FAIL === null ? '?' : LAB15_FAIL.toFixed(2)} not in lo/mid/hi — the in-game arm prices it as the black ops)`,
}

export const ROUTES = [
  {
    id: 'hack',
    status: 'SIMULATED (exitplan via hackexit.mjs) + the IPvGO model (go.mjs); g calibrated on played nodes, NOT CALIBRATED on unplayed',
    // BN8 is its own model (bn8.mjs) unless the world turns it off (plan.mjs --bn8-hack: the old placeholder pricing)
    // BN15: no Daedalus Red Pill (FactionHelpers.tsx:205) — its hacking exit is the 'lab' route
    applies: (node, lv, world) => (node !== 14 || world.phase1) && !(node === 8 && bn8On(world)) && node !== 15,
    hours: hackOnCtx,
  },
  {
    id: 'lab',
    node: 15,
    status: `MODELLED + DERIVED: the hacking route (hackexit at BN15's multipliers, no Daedalus favor life) + LAB15 ${LAB15.status} (lo ${LAB15.lo} / mid ${LAB15.mid} / hi ${LAB15.hi} h): the charisma climb to 3000, the crawl to depth 28, five lab lives — the mechanics PLAYED headlessly (dnetlab.mjs, charisma injected); ${NODE_ROUTE_RULES[15]?.labReady === true ? 'the acted route (routepin NODE_ROUTE_RULES[15].labReady: the in-game arm prices it with its fallback to the black ops, labroute.js)' : 'NOT the acted route yet (routepin NODE_ROUTE_RULES[15].labReady false: the stack acts on the black ops), so it applies only with plan.mjs --lab15-ready'}`,
    // only a route the stack can PLAY: routepin.NODE_ROUTE_RULES[15] acts on the black ops until the labyrinth
    // route is built (labReady); plan.mjs --lab15-ready (world.lab15Ready) prices it as if it were
    applies: (node, lv, world) => node === 15 && !world.phase1 && (NODE_ROUTE_RULES[15]?.labReady === true || world.lab15Ready === true),
    hours: (a) => {
      const h = hackOnCtx(a)
      return h === null ? null : h + (a.world.lab15 ?? LAB15.mid)
    },
  },
  {
    id: 'blade',
    status: "SIMULATED (bbsim, the game's Bladeburner, bbplan's POLICY, the Go farm's Tetrads combat channel; opening scaled by the simulated gym); k CALIBRATED on BN6.1/BN4.3/BN14.1 (posterior)",
    applies: (node, lv, world, S) => !world.bbOff && S.bbRank(node) > 0 && (node === 6 || node === 7 || lv(6) > 0 || lv(7) > 0),
    hours: (a) => bladeHours(a),
  },
  // ---- node-special hooks
  {
    id: 'go',
    node: 14,
    status: 'MODELLED (go.mjs): the hacking route at GoPower 4 — Go favor + Daedalus bonus on the favor life at FWRG 0.2, g x goG, w0r1d_d43m0n over the post-TRP climb; HackingSpeed 0.3 in the sim. eps14 ASSUMED, w0 DERIVED (KataGo), cheats 0 on 5x5 (MEASURED), NOT PRICED on 19x19',
    applies: (node, lv, world) => node === 14 && !world.phase1,
    hours: hackOnCtx,
  },
  {
    id: 'stocks',
    node: 8,
    status:
      "SIMULATED (bn8.mjs): the trader the only income through installs (traderw.rwAgeRate, the market's age reset each install, x kappa8(home) MEASURED on BN8.1), the game's catalogue at BN8's prices with the rep DONATED, Daedalus (30 installed, $100b, hacking 2500), The Red Pill, the climb to 3000; the gift accepted or never (stanekplan.GIFT_CAL); the policy searched (life length x lives). BN8.1 REPLAYED within tolerance (milestones +-15%); NOT CALIBRATED: the purchase policy (cheapest first), sleeves and the IPvGO farm (NOT PRICED), factions past the hacking/city/gang ones",
    applies: (node, lv, world) => node === 8 && bn8On(world),
    hours: (a) => a.world.bn8.hoursOf(a.lv, a.world),
  },
  {
    id: 'corp',
    node: 3,
    status: 'NOT CALIBRATED — placeholder: no corporation model (this repo runs none)',
    applies: (node) => node === 3,
    hours: () => null,
  },
  {
    id: 'stanek',
    status: "MODELLED (stanekplan.js, stanek.mjs): the hacking route (BN14: go) with Stanek's Gift accepted at the node's start — in BN13, or anywhere at SF13>=1; source formulas, MEASURED home RAM, ASSUMED elasticities/rep/duty; ONE tabled layout every life (the live per-life layout, priced by tools/sim/stanekperlife.mjs at -0.0..-1.2h on the node model, NOT SIMULATED here); the gift on the Bladeburner route is 'bladeStanek'",
    readsSf13: true, // the only route that reads SF13 (clearTime memoises the others without it)
    applies: (node, lv, world) => !world.phase1 && !world.stanekOff && giftAvailable(node, lv) && (!world.stanekBn13Only || node === 13) && !(node === 8 && bn8On(world)) && node !== 15,
    hours: (a) => stanekParts(a)?.h ?? null,
  },
  {
    id: 'bladeStanek',
    status: "SIMULATED, NOT CALIBRATED (tools/sim/bbstanek.mjs -> gameplan/bladestanek.mjs): the Bladeburner route with Stanek's Gift accepted at the node's start — bbsim both arms on shared seeds (Genesis x0.9 from t 0, stanekplan.BLADE_LAYOUTS charged by BLADE_HOST at gbMax mid: MEASURED host sizes, ASSUMED spread); the leg ratio at the planner's 5-infiltrator fleet applied to the route's leg; the batcher's money on the charger's host NOT PRICED",
    readsSf13: true,
    applies: (node, lv, world, S) => !world.phase1 && !world.stanekOff && !world.bladeStanekOff && (!world.stanekBn13Only || node === 13) && giftAvailable(node, lv) && ROUTES.find((r) => r.id === 'blade').applies(node, lv, world, S),
    hours(a) {
      const gift = giftLegOf(a.node, a.lv(13), a.lv(6), a.lv(7))
      if (!gift) {
        MISSING_BLADE_GIFT.add(`BN${a.node} SF13.${a.lv(13)} SF7.${a.lv(7)}`)
        return null
      }
      return bladeHours(a, gift)
    },
  },
]
/** BitNode 8's own model is on: the world carries its pricer (plan.mjs loads bn8.mjs; the bn8-hack flag or phase 1: off). */
export const bn8On = (world) => !world.phase1 && typeof world.bn8?.hoursOf === 'function'

/** The (node, SF13, SF7) cells the bladeStanek route found no table entry for (plan.mjs prints them: NOT PRICED there). */
export const MISSING_BLADE_GIFT = new Set()

/**
 * C(node, state, world) -> { h, via, by: {route: hours|null} }.
 * `lv(n)` is the state's SF level of n; S is a loaded surrogate.
 */
export function clearTime(node, lv, world, S, routes = ROUTES) {
  // The routes that do not read SF13 are memoised on the world by every other SF level
  // the routes read (SF13 is live for the stanek route alone and would otherwise compute
  // them 4 times over); the stanek route runs on top, from the memoised hacking parts.
  let key = null
  // only where SF13 can matter (with the gift off every SF13 level is the same call anyway)
  if (routes === ROUTES && !world.stanekOff && !world.phase1) {
    key = node
    for (const n of CT_SFS) key = key * 8 + lv(n)
  }
  let memo = null
  if (key !== null) {
    // per world AND surrogate (a direct-sim surrogate on the same world is another table)
    const byS = (world._ct ??= new WeakMap())
    memo = byS.get(S)
    if (!memo) byS.set(S, (memo = new Map()))
  }
  let base = memo ? memo.get(key) : undefined
  if (!base) {
    const by = {}
    const ctx = {}
    let best = null
    for (const r of routes) {
      if (r.readsSf13 || !r.applies(node, lv, world, S)) continue
      const h = r.hours({ node, lv, world, S, ctx })
      by[r.id] = h
      if (h !== null && isFinite(h) && (best === null || h < best.h)) best = { h, via: r.id }
    }
    base = { best, by, ctx }
    if (memo) memo.set(key, base)
  }
  let { best, by } = base
  for (const r of routes) {
    if (!r.readsSf13 || !r.applies(node, lv, world, S)) continue
    const h = r.hours({ node, lv, world, S, ctx: base.ctx })
    by = { ...by, [r.id]: h }
    if (h !== null && isFinite(h) && (best === null || h < best.h)) best = { h, via: r.id }
  }
  // THE ROUTE CALIBRATION BAND (routecal.js; world.routeErr, params.mjs routeErrOf): the route is chosen on
  // its EXPECTED hours under its measured model error — in the choice world (the mid world) E = point x
  // exp(s^2/2); a drawn world plays the route the choice world chose (committed before the world is known,
  // never the draw's own cheapest) at its drawn hours x the band's part the draws do not carry. Absent
  // (tests, --route-rule point, phase 1): the minimum over the points, as before.
  const re = !world.phase1 ? world.routeErr ?? null : null
  const okH = (h) => h !== null && h !== undefined && isFinite(h)
  const valOf = (id) => (re ? by[id] * (re.isChoice ? re.fullFactor(id, node) : re.extraFactor(id, node)) : by[id])
  const chooseOf = (ids) => {
    const live = ids.filter((id) => okH(by[id]))
    if (!live.length) return null
    if (re && !re.isChoice) {
      // the choice world's choice, memoised on it per (node, every live SF level, the surrogate)
      const cw = re.choiceWorld()
      let k = node
      for (const n of LIVE_SFS) k = k * 8 + lv(n)
      const byS = (cw._choice ??= new WeakMap())
      let m = byS.get(S)
      if (!m) byS.set(S, (m = new Map()))
      if (!m.has(k)) m.set(k, clearTime(node, lv, cw, S, routes).choice ?? null)
      const id = m.get(k)
      if (id && live.includes(id)) return id
    }
    const score = (id) => (re ? by[id] * re.fullFactor(id, node) : by[id])
    return live.reduce((b, id) => (b === null || score(id) < score(b) ? id : b), null)
  }
  if (re) {
    const id = chooseOf(Object.keys(by))
    best = id ? { h: valOf(id), via: id } : null
  }
  // THE 5TH COVENANT SLEEVE'S CLEAR (the user's invariant: plan.mjs --covenant5 10.2|10.3, world.fleet
  // 'cov2'|'cov3'): the BN10 clear that buys it is a hacking-route clear (hack or stanek; the Bladeburner
  // route never builds the economy — sleeves.mjs covenantLegHours) held for the purchase leg
  // (world.covLegOf(lv): $1e17 at the final window's income) before the node is destroyed
  if (isCovenantBuyClear(node, lv(10), world.fleet)) {
    if (typeof world.covLegOf !== 'function') throw new Error(`clearTime: fleet ${world.fleet} buys the 5th Covenant sleeve in BN10.${lv(10) + 1} but the world has no covLegOf (worldOf covLegOf)`)
    const leg = world.covLegOf(lv)
    let buy = null
    if (re) {
      const id = chooseOf(Object.keys(by).filter((k) => k !== 'blade' && k !== 'bladeStanek'))
      if (id) buy = { h: valOf(id) + leg, via: `${id}+cov5`, choice: id }
    } else for (const [id, h] of Object.entries(by)) if (id !== 'blade' && id !== 'bladeStanek' && h !== null && isFinite(h) && (buy === null || h + leg < buy.h)) buy = { h: h + leg, via: `${id}+cov5`, choice: id }
    return { ...(buy ?? { h: Infinity, via: null, choice: null }), by: { ...by, cov5: leg } }
  }
  return best ? { ...best, choice: best.via, by } : { h: Infinity, via: null, choice: null, by }
}
/** The SFs the routes other than stanek read (clearTime's memo key): every live SF but 13. */
const CT_SFS = LIVE_SFS.filter((n) => n !== 13)
