// [RC] THE GATE'S CLAIMS FOLLOW THE COMMITTED ROUTE.
//
// Live BN7.1 2026-10-10 13:32Z (/tel/installgate.txt, /tel/plan.txt): the
// Bladeburner route is committed (black ops 9.97h vs the World Daemon
// 103.2h; install decision 'never', route 'blade'), yet the gate published
// joinClaim 1e11 — Daedalus's $100b join requirement, a HACKING-exit leg —
// and budgetClaim $9.45b for an aug batch the committed decision never
// installs. budget.js held both, so every discretionary spender read $0
// spendable (hacknet.js priced capacity at ~-20 min of exit for ~$1e9 and
// bought nothing).
//
//   RC1 THE LIVE SHAPE, RED/GREEN: the old publisher (joinMoneyClaim) holds
//       1e11 on that plan; routeJoinClaimOf holds 0 with its why, and budget's
//       joinClaim reads the published 0 as a KNOWN nothing
//   RC2 THE HACKING ROUTE is unchanged: no plan / bladeRoute 'hack' / another
//       node -> the Daedalus claim as given; an unreadable one stays null
//   RC3 THE SIMULACRUM leg: a buying verdict holds its cost; buying with no
//       price is unknown (null); a non-buying verdict holds nothing
//   RC4 THE AUG HOLD: never-install on the blade route (this life) -> 0;
//       a waiting install, another life's plan, or the hacking route's
//       'never' (the final window, The Red Pill's batch) keep the hold
//   RC5 WIRING: both claim-carrying gate writes publish gateJoinOf's
//       joinClaim/joinValueLn/joinClaimWhy, homeCompete prices on it, and
//       budgetClaim honours routeAugHoldOf

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const C = await import("../../splitctl.js");
const B = await import("../../budget.js");
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");

const LIFE = 1791587540219;
// The live plan record, trimmed to the fields the readers touch.
const LIVE_PLAN = {
  node: 7,
  lastAugReset: LIFE,
  decisions: {
    install: { key: "never", route: "blade", install: false },
    bladeRoute: {
      key: "blade",
      bladeH: 9.974,
      hackH: 103.216,
      lean: { untilH: null },
      simulacrum: { cost: 450e9, repReq: 1250, withoutH: 9.97, moneyH: 6617.11, repH: 0, reachH: 6617.11, buy: false, why: "unreachable before the exit: money in 6617.1h ($450.0b against $10.097b at $66.5m/h)" },
    },
  },
};
const HACK_CLAIM = 1e11; // joinMoneyClaim on the live candidates: Daedalus's $100b, balance ~$10b
const withRoute = (patch) => ({ ...LIVE_PLAN, decisions: { ...LIVE_PLAN.decisions, ...patch } });

export async function run() {
  const checks = [];

  const c1 = new Check("RC1", "live BN7.1 blade route: joinClaim 1e11 (Daedalus) -> 0, with its why, read by budget as a known zero");
  {
    c1.examined(4);
    // RED: the old publisher wrote joinMoneyClaim unconditionally.
    const old = HACK_CLAIM;
    const r = C.routeJoinClaimOf?.(LIVE_PLAN, { node: 7, hackClaim: HACK_CLAIM });
    if (!r) c1.fail("splitctl.routeJoinClaimOf is missing: the gate publishes the hacking exit's join claim on every route", `old publisher: joinClaim ${old}`);
    else {
      if (r.claim !== 0) c1.fail(`blade route join claim ${r.claim}, expected 0 (no faction join on the black-op exit)`, `old publisher: ${old}`);
      if (r.route !== "blade") c1.fail(`route ${r.route}, expected 'blade'`);
      if (!/black ops/.test(r.why ?? "") || !/Daedalus/.test(r.why ?? "")) c1.fail(`the why must name the route and the dropped claim: ${r.why}`);
      const gate = JSON.stringify({ lastAugReset: LIFE, planned: true, plan: { totalCost: 0, buy: [] }, joinClaim: r.claim });
      if (B.joinClaim(gate, LIFE) !== 0) c1.fail("budget.joinClaim must read the published 0 as a known zero");
      c1.note(`old ${old} -> ${r.claim}: ${r.why}`);
    }
  }
  checks.push(c1);

  const c2 = new Check("RC2", "the hacking route keeps the Daedalus claim; unreadable stays unknown");
  {
    c2.examined(5);
    const f = C.routeJoinClaimOf ?? (() => ({}));
    if (f(null, { node: 7, hackClaim: HACK_CLAIM }).claim !== HACK_CLAIM) c2.fail("no plan record must hold the hacking claim (fail toward holding)");
    if (f(withRoute({ bladeRoute: { key: "hack" } }), { node: 7, hackClaim: HACK_CLAIM }).claim !== HACK_CLAIM) c2.fail("the hacking route must hold the Daedalus claim");
    if (f(LIVE_PLAN, { node: 9, hackClaim: HACK_CLAIM }).claim !== HACK_CLAIM) c2.fail("another node's blade record must not release the claim");
    if (f(null, { node: 7, hackClaim: null }).claim !== null) c2.fail("an unreadable hacking claim must stay null (unknown), never 0");
    if (f(null, { node: 7, hackClaim: 0 }).claim !== 0) c2.fail("a met hacking claim is a known 0");
  }
  checks.push(c2);

  const c3 = new Check("RC3", "the Simulacrum: a buying verdict holds its cost; unpriced is unknown; not buying holds nothing");
  {
    c3.examined(3);
    const f = C.routeJoinClaimOf ?? (() => ({}));
    const sim = (s) => withRoute({ bladeRoute: { ...LIVE_PLAN.decisions.bladeRoute, simulacrum: s } });
    if (f(sim({ cost: 450e9, buy: true, why: "buy" }), { node: 7, hackClaim: HACK_CLAIM }).claim !== 450e9) c3.fail("a buying Simulacrum must hold its cost");
    if (f(sim({ cost: null, buy: true }), { node: 7, hackClaim: HACK_CLAIM }).claim !== null) c3.fail("a buying Simulacrum with no price must read unknown");
    if (f(sim(null), { node: 7, hackClaim: HACK_CLAIM }).claim !== 0) c3.fail("no Simulacrum verdict on the blade route holds nothing");
  }
  checks.push(c3);

  const c4 = new Check("RC4", "aug hold: never-install blade route (this life) releases the batch; every other shape holds it");
  {
    c4.examined(4);
    const f = C.routeAugHoldOf ?? (() => ({ zero: false }));
    const live = f(LIVE_PLAN, { node: 7, lastAugReset: LIFE });
    if (live.zero !== true) c4.fail(`live blade 'never' must release the $9.45b aug hold: ${JSON.stringify(live)}`);
    if (f(withRoute({ install: { key: "w4", route: "blade" } }), { node: 7, lastAugReset: LIFE }).zero) c4.fail("a waiting blade install must keep the hold");
    if (f(LIVE_PLAN, { node: 7, lastAugReset: LIFE + 1 }).zero) c4.fail("another life's plan must keep the hold");
    if (f(withRoute({ bladeRoute: { key: "hack" } }), { node: 7, lastAugReset: LIFE }).zero) c4.fail("the hacking route's 'never' (the Red Pill batch) must keep the hold");
  }
  checks.push(c4);

  const c5 = new Check("RC5", "wiring: the gate writes publish the route's join claim and the route's aug hold");
  {
    c5.examined(4);
    const src = code("progress.js");
    for (const k of ["0", "1"]) {
      if (!new RegExp(`const gateJoin${k} = gateJoinOf\\(`).test(src) || !new RegExp(`joinClaim: gateJoin${k}\\.joinClaim,`).test(src) || !new RegExp(`joinClaimWhy: gateJoin${k}\\.joinClaimWhy`).test(src) || !new RegExp(`homeCompete\\(\\{ claim: gateJoin${k}\\.joinClaim, valueLn: gateJoin${k}\\.joinValueLn`).test(src))
        c5.fail(`gate write ${k} does not publish gateJoinOf's claim (or homeCompete prices the old one)`);
    }
    if (/joinClaim: joinMoneyClaim\(/.test(src)) c5.fail("a gate write still publishes joinMoneyClaim directly (route-blind)");
    if (!/budgetClaim: augHold1\.zero\s*\?\s*0/.test(src)) c5.fail("budgetClaim does not honour routeAugHoldOf");
  }
  checks.push(c5);

  return checks;
}
