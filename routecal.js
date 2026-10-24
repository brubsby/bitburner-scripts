// THE ROUTE CALIBRATION BAND — a route is chosen on its EXPECTED hours under the model error its own
// calibration measured, never on the model's point (2026-10-23).
//
// WHY: the gameplan priced BN2.2/2.3 by the gift + hacking at ~8.4h each against a Bladeburner clear at
// ~8.5h, and took hacking on the point. But the hacking route's g is the worst-calibrated quantity in the
// plan on BN2 (leave-one-out +163%: the g model without BN2.1 priced it 2.6x its measured 22.4h), while a
// clean Bladeburner clear at rank multiplier 1 came in at 8.3-9.0h three times running (BN3.3, the BN3
// replay, BN11.3) against the route's 9.3h. The Bladeburner route is not tight either — over its 16
// out-of-sample clears the RMS is 0.39 (BN11.2 25.7h and BN3.1 21.9h against 9.3h) — but a 0.1h point gap
// between a route known to x1.5 and one known to x2.6 is not a decision; the expected hours are.
//
// THE RULE (one rule, every node, both deciders — the gameplan's clearTime, tools/sim/gameplan/routes.mjs,
// and the live route decision, plan.decideBladeRouteGen):
//   ln(true hours) ~ N(ln(model hours), s^2)       the model's hours are the MEDIAN (its errors in ln hours)
//   s(route, node) = max(s_pooled(family), |r_node(family)|)
//   E[hours] = model hours x exp(s^2 / 2)          RISK-NEUTRAL: take the route with the lowest E[hours]
// where
//   family    'hacking' = the hacking exit and everything priced on it (hack, stanek, go): their error is g's
//             transfer; 'blade' = the black-op exit (blade, bladeStanek): its error is k's
//   r         a finished clear's out-of-sample residual ln(measured / predicted):
//               hacking the g model's leave-one-out prediction through the route the clear played, at its
//                       own entry state (plan.mjs CALIBRATION, the same residuals the discrepancy term fits)
//               blade   the plan's Bladeburner route at the clear's entry state against its hours, on every
//                     clear whose k is NOT in the posterior (observe.mjs withholds them: out of sample)
//   s_pooled  the RMS of the family's residuals (bias folded into the width, not corrected: the
//             calibrations g and k are where bias is corrected)
//   r_node    the node's own residual where it has one: a node the model is known to miss is priced with
//             its own miss (BN2: |ln 0.38| = 0.97)
// A switch away from a committed route still needs the commitment rule's P(win) >= theta on the same
// draws, now with each arm's own route error drawn independently (it does not cancel between routes).
//
// The gameplan RE-MEASURES s on every run and prints a CHECK against this table (plan.mjs ROUTE CHOICE
// UNDER MODEL ERROR): the live game decides on these numbers, so a FAIL there means update ROUTE_CAL from
// that run's printout and commit the two together.
//
// NOT CALIBRATED as a live quantity: the live arms are exitplan / bbplan.bladeExit on live inputs, and
// their own errors are not the gameplan's. They carry the gameplan's measured band until a live
// calibration of each arm replaces it; the band multiplies the REMAINING hours, so its absolute weight
// shrinks as the node runs out.
//
// Pure: no ns, no RAM. (The family is 'hacking', never a `hack` key: the RAM calculator bills `hack` as ns.hack.)

/** Measured by tools/sim/gameplan/plan.mjs on 2026-10-23 (BN13.3 in progress): see its ROUTE CHOICE section. */
export const ROUTE_CAL = {
  measuredAt: '2026-10-23',
  hacking: { pooled: 0.42, n: 8, nodes: { 1: 0.32, 2: 0.96, 4: 0.41, 8: 0.2, 9: 0.03, 10: 0.37, 12: 0.07, 13: 0.05 } },
  blade: { pooled: 0.39, n: 16, nodes: { 3: 0.44, 6: 0.09, 7: 0.09, 9: 0.32, 10: 0.15, 11: 0.59, 13: 0.57 } },
}

/** The family a route's error belongs to. */
export function routeFamilyOf(route) {
  return route === 'blade' || route === 'bladeStanek' ? 'blade' : 'hacking'
}

/** s(route, node) in ln hours: max(the family's pooled RMS, the node's own residual). null cal: 0. */
export function routeSdOf(route, node, cal = ROUTE_CAL) {
  const f = cal?.[routeFamilyOf(route)]
  if (!f) return 0
  const own = f.nodes?.[node]
  const p = Number.isFinite(f.pooled) ? f.pooled : 0
  return Number.isFinite(own) ? Math.max(p, Math.abs(own)) : p
}

/** E[hours] / median under ln-normal error of sd s. */
export function expectedFactorOf(s) {
  return Number.isFinite(s) ? Math.exp((s * s) / 2) : 1
}

/** The p10 / p90 of the hours under the band: model x exp(-+1.2816 s). */
export function bandOf(h, s) {
  return [h * Math.exp(-1.2816 * s), h * Math.exp(1.2816 * s)]
}

export const ROUTE_RULE_TEXT = 'route chosen on E[hours] = model x exp(s^2/2), s = max(the route family\'s pooled leave-one-out RMS, the node\'s own) in ln hours (routecal.js)'
