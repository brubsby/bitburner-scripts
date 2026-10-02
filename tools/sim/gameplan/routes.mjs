// THE ROUTES a clear can take, and C(node, state, world) — the hours of one clear.
//
// NOT CALIBRATED as a whole (see each route's `status`). The two priced routes
// are ported unchanged from nodechoice/nextnode.mjs §4 (919b8ca):
//
//   hack   H = max(0.5 x Hsim, Hsim - early)          Hsim = hacking exit from a
//          fresh entry at g = g(node) x prod gFactor(SF), the node played at
//          its level (BN12: SF12 + 1)
//   blade  B = open - min(early, max(0, open - 0.5)) + leg(node, SF6, SF7) x k
//          available where the node has Bladeburner (BladeburnerRank > 0) and
//          the player can join it (BN6/BN7, or SF6/SF7 held)
//   C = min over available routes (the route is chosen per clear, knowing the world)
//
// NODE-SPECIAL ROUTES are hooks with a placeholder that prices nothing (returns
// null): each is flagged NOT CALIBRATED and listed in the plan's output. Phase 2
// replaces a placeholder with a model by giving it an `hours` that returns a
// number — the order search picks it up with no other change (BN14 first).

import { earlyOf, gFactorOf, hackSfOf, EFFECTS, sfKeyStr } from './effects.mjs'

export const ROUTES = [
  {
    id: 'hack',
    status: 'SIMULATED (exitplan via hackexit.mjs); g calibrated on played nodes, NOT CALIBRATED on unplayed',
    applies: () => true,
    hours({ node, lv, world, S }) {
      const nodeLevel = EFFECTS[node]?.nodeLevel ? EFFECTS[node].nodeLevel(lv(node)) : 1
      const g = world.g(node) * gFactorOf(lv, world.sf)
      const h = S.hackHours(node, nodeLevel, sfKeyStr(hackSfOf(lv)), g)
      if (!isFinite(h)) return null
      return Math.max(0.5 * h, h - earlyOf(lv, node, world.sf))
    },
  },
  {
    id: 'blade',
    status: 'SIMULATED (bbsim, the game\'s Bladeburner); k CALIBRATED on BN6 only',
    applies: (node, lv, world, S) => !world.bbOff && S.bbRank(node) > 0 && (node === 6 || node === 7 || lv(6) > 0 || lv(7) > 0),
    hours({ node, lv, world, S }) {
      const leg = S.bbLeg(node, Math.max(1, Math.min(3, lv(6))), Math.min(3, lv(7)))
      if (!leg) return null
      return world.open - Math.min(earlyOf(lv, node, world.sf), Math.max(0, world.open - 0.5)) + leg.median * world.k
    },
  },
  // ---- node-special hooks: placeholders, NOT CALIBRATED, price nothing in phase 1
  {
    id: 'go',
    node: 14,
    status: 'NOT CALIBRATED — placeholder: no model of a Go-driven BN14 exit (phase 2, first)',
    applies: (node) => node === 14,
    hours: () => null,
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
