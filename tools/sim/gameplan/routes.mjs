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
//          W      the w0r1d_d43m0n hacking-level bonus at the exit (divides the exit level)
//          favor  the favor life: hours to bank 150 x FavorToDonate favor on
//                 Daedalus with the Go farm on it (FactionWorkRepGain, the Go
//                 Daedalus bonus, the Go favor stream and its cap); the
//                 reference is the favor life inside the g it was measured
//                 with (the node's own if played, else the measured runs' mean)
//          BN14's is the 'go' route below (the same formula at GoPower 4; hack does not apply there)
//   blade  B = open - min(early, max(0, open - 0.5)) + leg(node, SF6, SF7) x k
//          available where the node has Bladeburner (BladeburnerRank > 0) and
//          the player can join it (BN6/BN7, or SF6/SF7 held)
//   C = min over available routes (the route is chosen per clear, knowing the world)
//
//   blade's opening is scaled per node: open + (gym hours to combat 100 in the
//          node - in BN6), both simulated by bbsim (the game's own skill
//          formula at the node's combat level multipliers: BN14 x0.5)
//
// NODE-SPECIAL ROUTES are hooks; a placeholder prices nothing (returns null)
// and is flagged NOT CALIBRATED in the plan's output. BN14's is a model (phase
// 2): the hacking route with the Go farm at GoPower 4.
//
// world.phase1 prices as phase 1 did (GP3's regression mode): no Go model,
// SF14.1 = g x 1.02, the opening unscaled, BN14 on the plain hacking route.

import { earlyOf, gFactorOf, hackSfOf, EFFECTS, sfKeyStr } from './effects.mjs'
import { goScale, goGFactor, w0rldDiv, exitShift, favorLifeOf } from './go.mjs'

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
export function hackParts({ node, lv, world, S }) {
  const nodeLevel = EFFECTS[node]?.nodeLevel ? EFFECTS[node].nodeLevel(lv(node)) : 1
  const l14 = lv(14)
  let g = world.g(node) * gFactorOf(lv, world.sf)
  let goG = 1
  let W = 1
  let favor = 0
  let fref = 0
  if (world.phase1) {
    if (l14 >= 1) g *= 1 + PHASE1_D14
  } else {
    const s = goScale(S.mults(node).GoPower, l14)
    goG = goGFactor(s, world.go.abar, world.sf.eps14)
    g *= goG
    W = w0rldDiv(s, world.sf.w0)
    // BN2's Red Pill is sold by the gang (no Daedalus favor life in its g, nor in a replay)
    if (node !== 2) {
      favor = favorHours(node, l14, world, S)
      fref = favorRef(node, world, S)
    }
  }
  const hsim = S.hackHours(node, nodeLevel, sfKeyStr(hackSfOf(lv)), g, world.phase1 ? { speed1: true } : undefined)
  if (!isFinite(hsim)) return null
  const hx = exitShift(hsim, g, W) + favor - fref
  const early = earlyOf(lv, node, world.sf)
  return { h: Math.max(0.5 * hx, hx - early), hsim, g, goG, W, favor, favorRef: fref, early }
}

export const ROUTES = [
  {
    id: 'hack',
    status: 'SIMULATED (exitplan via hackexit.mjs) + the IPvGO model (go.mjs); g calibrated on played nodes, NOT CALIBRATED on unplayed',
    applies: (node, lv, world) => node !== 14 || world.phase1,
    hours: (a) => hackParts(a)?.h ?? null,
  },
  {
    id: 'blade',
    status: "SIMULATED (bbsim, the game's Bladeburner; opening scaled by the simulated gym); k CALIBRATED on BN6 only",
    applies: (node, lv, world, S) => !world.bbOff && S.bbRank(node) > 0 && (node === 6 || node === 7 || lv(6) > 0 || lv(7) > 0),
    hours({ node, lv, world, S }) {
      const l6 = Math.max(1, Math.min(3, lv(6)))
      const l7 = Math.min(3, lv(7))
      const leg = S.bbLeg(node, l6, l7)
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
    status: 'MODELLED (go.mjs): the hacking route at GoPower 4 — Go favor + Daedalus bonus on the favor life at FWRG 0.2, g x goG, w0r1d_d43m0n at the exit; HackingSpeed 0.3 in the sim. eps14/w0 ASSUMED, cheats NOT PRICED',
    applies: (node, lv, world) => node === 14 && !world.phase1,
    hours: (a) => hackParts(a)?.h ?? null,
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
    node: 13,
    status: "NOT CALIBRATED — placeholder: no Stanek's Gift model (this repo runs none)",
    applies: (node) => node === 13,
    hours: () => null,
  },
]

/**
 * C(node, state, world) -> { h, via, by: {route: hours|null} }.
 * `lv(n)` is the state's SF level of n; S is a loaded surrogate.
 */
export function clearTime(node, lv, world, S, routes = ROUTES) {
  const by = {}
  let best = null
  for (const r of routes) {
    if (!r.applies(node, lv, world, S)) continue
    const h = r.hours({ node, lv, world, S })
    by[r.id] = h
    if (h !== null && isFinite(h) && (best === null || h < best.h)) best = { h, via: r.id }
  }
  return best ? { ...best, by } : { h: Infinity, via: null, by }
}
