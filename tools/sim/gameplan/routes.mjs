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
//          goG    the Go rate bonus on g at scale GoPower x (SF14 ? 2 : 1)
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
//          sleeves = min(3, SF10 + (BN10 ? 1 : 0)) + 4 (sleeves.mjs); the leg at 6/7 = the
//          5-infiltrator leg x the live fleet pick's leg ratio (surrogate BB_FLEET_N)
//          available where the node has Bladeburner (BladeburnerRank > 0) and
//          the player can join it (BN6/BN7, or SF6/SF7 held)
//   C = min over available routes (the route is chosen per clear, knowing the world)
//
//   blade's opening is scaled per node: open + (gym hours to combat 100 in the
//          node - in BN6), both simulated by bbsim (the game's own skill
//          formula at the node's combat level multipliers: BN14 x0.5)
//
//   stanek H with the gift accepted at the node's start (stanek.mjs): g x gMul, W x the
//          gift's exit divisor, the favor life x favorMul — wherever the gift is
//          available (BN13, or SF13 >= 1); min over routes = accept or never, per node
//
// NODE-SPECIAL ROUTES are hooks; a placeholder prices nothing (returns null)
// and is flagged NOT CALIBRATED in the plan's output. BN14's is a model (phase
// 2): the hacking route with the Go farm at GoPower 4.
//
// world.phase1 prices as phase 1 did (GP3's regression mode): no Go model,
// SF14.1 = g x 1.02, the opening unscaled, BN14 on the plain hacking route.

import { earlyOf, gFactorOf, hackSfOf, EFFECTS, sfKeyStr, LIVE_SFS, sleevesOf } from './effects.mjs'
import { goScale, goGFactor, w0rldDiv, exitShift, favorLifeOf, goWindow } from './go.mjs'
import { giftAvailable, stanekFactors } from './stanek.mjs'

/** phase 1's SF14.1 effect (nextnode d14 mid): GP3's regression mode only. */
export const PHASE1_D14 = 0.02

/** The favor life's hours for node n at SF14 level l in this world (memoised on the world). */
export function favorHours(n, l, world, S) {
  const k = `${n}|${l}`
  let v = world.go.memo.get(k)
  if (v === undefined) {
    v = favorLifeOf(S.mults(n), l, world.sf, world.go.abar).hours
    world.go.memo.set(k, v)
  }
  return v
}
/** The favor life already inside node n's g: its own (played, SF14 0) or the measured runs' mean. */
export function favorRef(n, world, S) {
  if (world.go.played(n)) return favorHours(n, 0, world, S)
  const ns = world.go.refNodes
  return ns.reduce((a, m) => a + favorHours(m, 0, world, S), 0) / ns.length
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
    goG = goGFactor(s, world.go.abar, world.sf.eps14)
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
    // BN2's Red Pill is sold by the gang (no Daedalus favor life in its g, nor in a replay)
    if (node !== 2) {
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

/** hackParts, kept on the call's ctx for the routes that build on it (stanek). */
const hackOnCtx = (a) => {
  const p = hackParts(a)
  if (a.ctx) a.ctx.hack = p
  return p?.h ?? null
}

export const ROUTES = [
  {
    id: 'hack',
    status: 'SIMULATED (exitplan via hackexit.mjs) + the IPvGO model (go.mjs); g calibrated on played nodes, NOT CALIBRATED on unplayed',
    applies: (node, lv, world) => node !== 14 || world.phase1,
    hours: hackOnCtx,
  },
  {
    id: 'blade',
    status: "SIMULATED (bbsim, the game's Bladeburner; opening scaled by the simulated gym); k CALIBRATED on BN6 only",
    applies: (node, lv, world, S) => !world.bbOff && S.bbRank(node) > 0 && (node === 6 || node === 7 || lv(6) > 0 || lv(7) > 0),
    hours({ node, lv, world, S }) {
      const l6 = Math.max(1, Math.min(3, lv(6)))
      const l7 = Math.min(3, lv(7))
      // the fleet: sleeves.mjs sleeveCount (SF10 + BN10's own + 4 Covenant); phase 1 priced 5 infiltrators
      const leg = S.bbLeg(node, l6, l7, world.phase1 ? 5 : sleevesOf(lv, node, world.fleet))
      if (!leg) return null
      // the opening measured in BN6 (2.5h), plus the gym hours this node's combat multipliers add over BN6's
      const open = world.phase1 ? world.open : Math.max(0.5, world.open + (S.bbJoin(node, l6, l7) ?? 0) - (S.bbJoin(6, l6, l7) ?? 0))
      return open - Math.min(earlyOf(lv, node, world.sf), Math.max(0, open - 0.5)) + leg.median * world.k
    },
  },
  // ---- node-special hooks
  {
    id: 'go',
    node: 14,
    status: 'MODELLED (go.mjs): the hacking route at GoPower 4 — Go favor + Daedalus bonus on the favor life at FWRG 0.2, g x goG, w0r1d_d43m0n over the post-TRP climb; HackingSpeed 0.3 in the sim. eps14 ASSUMED, w0 DERIVED, cheats NOT PRICED',
    applies: (node, lv, world) => node === 14 && !world.phase1,
    hours: hackOnCtx,
  },
  {
    id: 'stocks',
    node: 8,
    status: 'NOT CALIBRATED — placeholder: BN8 is priced by the hacking route with the trader as capital; no stock-only exit model',
    applies: (node) => node === 8,
    hours: () => null,
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
    status: "MODELLED (stanekplan.js, stanek.mjs): the hacking route (BN14: go) with Stanek's Gift accepted at the node's start — in BN13, or anywhere at SF13>=1; source formulas, MEASURED home RAM, ASSUMED elasticities/rep/duty; with the gift on the Bladeburner route NOT PRICED",
    readsSf13: true, // the only route that reads SF13 (clearTime memoises the others without it)
    applies: (node, lv, world) => !world.phase1 && !world.stanekOff && giftAvailable(node, lv) && (!world.stanekBn13Only || node === 13),
    hours: (a) => stanekParts(a)?.h ?? null,
  },
]

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
  return best ? { ...best, by } : { h: Infinity, via: null, by }
}
/** The SFs the routes other than stanek read (clearTime's memo key): every live SF but 13. */
const CT_SFS = LIVE_SFS.filter((n) => n !== 13)
