// [SR] THE SPLIT SERVES THE COMMITTED ROUTE.
//
// Live BN7.1 2026-10-10 (fixture-bn7-splitroute-0946.json, the pass's own
// batch.txt meter and model, exit inputs, expfarm control state and plan):
// the Bladeburner route is committed (black ops 13.2h; the World Daemon
// 98.6h), and the split controller priced the money/exp split on the World
// Daemon exit — a flat surface (153 vs 155h, +-52 min earlier; 100.48 vs
// 100.50h now) — walking 0.10 -> 0.05 -> 0.20 -> ... -> 0.75 -> 0.60 -> 0.45:
// 24 exploit switches this life, SPLIT OSCILLATING (5 reversals in 10
// switches over 3h). The black-op exit (bbplan.bladeExitGen) reads no
// hacking exp and no batcher stream: live, the route's only income legs are
// absent (the full daemon placed: lean.untilH null, no routeBuy; The Blade's
// Simulacrum 5992h of money away against a 13.2h exit).
//
//   SR1 THE LIVE SHAPE, RED/GREEN: 16 passes from the live state, the controller without the
//       route reverses on the World Daemon price; with committedRouteOf(the
//       live plan) it holds the running 45% ('route-hold', no switch), names
//       the committed exit, and the calibration still ingests the segment
//   SR2 THE HEALTHCHECK: splitHealth fails SPLIT OSCILLATING on the live
//       record and not on the route-hold record (the reversals in the window
//       are the wrong-exit pricing before it, ageing out)
//   SR3 committedRouteOf: the acted key only ('hack' / a pinned record /
//       another node -> null); income legs named from the route's own record
//       (the full daemon's home purchase; a Simulacrum within a 20x income)
//   SR4 WITH AN INCOME LEG the money end dominates (non-increasing in money,
//       blind to exp): passes step up by <= stepMax, never down — no reversal
//       over 12 passes, ending at maxFrac
//   SR5 WIRING: progress.js passes committedRouteOf(the plan record, this
//       node) to splitControl

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const C = await import("../../splitctl.js");
const X = await import("../../exitplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn7-splitroute-0946.json"), "utf8"));
const T0 = Date.parse(F.at);
const PAST_DWELL_MS = 31 * 60e3;
const passAt = (dtMs, route, state = F.expfarm.control.state, frac = null) => {
  const m = F.batch.splitMeasure;
  const measure = frac === null ? { ...m, ageSec: (m.ageSec ?? 0) + dtMs / 1000 } : { ...m, frac, segId: `t${dtMs}:${frac}`, ageSec: 20 * 60, settled: true, n: 9 };
  return C.splitControl({
    bestExitPolicy: X.bestExitPolicy,
    inputs: C.splitRaw(F.exitinputs.inputs),
    share0: frac ?? F.expfarm.share0,
    measure,
    model: F.batch.splitModel,
    state,
    nowMs: T0 + dtMs,
    lastAugReset: F.lastAugReset,
    bitNode: F.node,
    scriptExpPerSec: F.expfarm.scriptExpPerSec,
    hackPerSec: F.exitinputs.inputs?.split?.hackPerSec ?? null,
    route,
  });
};

export async function run() {
  const checks = [];
  const ROUTE = C.committedRouteOf(F.plan, { node: F.node });

  {
    const c = new Check("SR1", "THE LIVE SHAPE: past the dwell the controller on the World Daemon price switches; on the committed Bladeburner route it holds the running split and says why");
    checks.push(c);
    // 16 passes 31 min apart, each on a settled segment at the running share
    // (the live meter's rates: a flat plant, as the live surface is flat).
    const walk = (route) => {
      let state = F.expfarm.control.state;
      let frac = F.expfarm.share0;
      const path = [frac];
      for (let i = 1; i <= 16; i++) {
        const r = passAt(PAST_DWELL_MS * i, route, state, frac);
        state = r.state;
        frac = r.frac;
        path.push(frac);
      }
      const d = path.slice(1).map((x, i) => Math.sign(x - path[i])).filter(Boolean);
      return { path, switches: d.length, reversals: d.slice(1).filter((x, i) => x !== d[i]).length };
    };
    const wOld = walk(null);
    const wNew = walk(ROUTE);
    c.note(`without the route: ${wOld.path.join(" ")} (${wOld.switches} switches, ${wOld.reversals} reversals)`);
    c.note(`with the route:    ${wNew.path.join(" ")}`);
    if (wOld.reversals < 1) c.fail(`the replay no longer reproduces the oscillation on the World Daemon price (${wOld.path.join(" ")}) — it tests nothing`);
    if (wNew.switches !== 0) c.fail(`on the committed Bladeburner route the split must not move: ${wNew.path.join(" ")}`);
    const neu = passAt(PAST_DWELL_MS, ROUTE);
    c.note(`with the route:    [${neu.kind}] ${String(neu.why).slice(0, 260)}`);
    c.examined(33);
    if (neu.kind !== "route-hold" || neu.frac !== F.expfarm.share0) c.fail(`on the committed Bladeburner route the split must hold ${F.expfarm.share0}: got ${neu.frac} [${neu.kind}]`);
    if (neu.state.switches.length !== F.expfarm.control.state.switches.length) c.fail("a route hold must record no switch");
    if (!/committed route is 'blade'/.test(neu.why) || !/13\.2/.test(neu.why)) c.fail(`the reason must name the committed route and its exit: ${neu.why}`);
    if (!neu.state.obs.some((o) => o.segId === F.batch.splitMeasure.segId)) c.fail("the running segment must still be ingested (the calibration continues under the hold)");
  }

  {
    const c = new Check("SR2", "THE HEALTHCHECK: SPLIT OSCILLATING on the live record, not on the route-hold one");
    checks.push(c);
    const live = C.splitHealth({ control: F.expfarm.control }, F.batch);
    const neu = passAt(PAST_DWELL_MS, ROUTE);
    const { state, grid, ...pub } = neu;
    const held = C.splitHealth({ control: { ...pub, state } }, F.batch);
    c.examined(2);
    c.note(`live: ${live.map((x) => x.what).join(" | ").slice(0, 200)}`);
    if (!live.some((x) => /SPLIT OSCILLATING/.test(x.what))) c.fail("the live record must reproduce SPLIT OSCILLATING");
    if (held.some((x) => /SPLIT OSCILLATING/.test(x.what))) c.fail(`a route hold is not oscillation: ${held.map((x) => x.what).join(" | ")}`);
  }

  {
    const c = new Check("SR3", "committedRouteOf: the acted 'blade' key only, same node; income legs from the route record");
    checks.push(c);
    const br = F.plan.decisions.bladeRoute;
    const cases = [
      ["live", F.plan, F.node, (r) => r && r.key === "blade" && r.moneyLegs.length === 0 && Math.abs(r.exitH - br.bladeH) < 1e-9],
      ["hack", { ...F.plan, decisions: { bladeRoute: { ...br, key: "hack" } } }, F.node, (r) => r === null],
      ["another node", F.plan, 9, (r) => r === null],
      ["no plan", null, F.node, (r) => r === null],
      ["route home purchase", { ...F.plan, decisions: { bladeRoute: { ...br, lean: { untilH: 3, routeBuy: { buyAtH: 2.1, cost: 5e10 } } } } }, F.node, (r) => r?.moneyLegs.length === 1 && /home purchase/.test(r.moneyLegs[0])],
      ["simulacrum in reach", { ...F.plan, decisions: { bladeRoute: { ...br, simulacrum: { ...br.simulacrum, moneyH: 100, withoutH: 13.2, buy: false } } } }, F.node, (r) => r?.moneyLegs.length === 1 && /Simulacrum/.test(r.moneyLegs[0])],
    ];
    for (const [name, plan, node, ok] of cases) {
      const r = C.committedRouteOf(plan, { node });
      c.note(`${name}: ${r ? `${r.key} ${r.why}; legs ${r.moneyLegs.length}` : "null"}`);
      if (!ok(r)) c.fail(`${name}: ${JSON.stringify(r)}`);
    }
    c.examined(cases.length);
  }

  {
    const c = new Check("SR4", "WITH AN INCOME LEG: steps toward the money end by <= stepMax, never down, over 12 passes; ends at maxFrac");
    checks.push(c);
    const route = { ...ROUTE, moneyLegs: ["the full daemon's home purchase (test)"] };
    let state = F.expfarm.control.state;
    let frac = F.expfarm.share0;
    const path = [frac];
    for (let i = 1; i <= 12; i++) {
      const r = passAt(PAST_DWELL_MS * i, route, state, frac);
      state = r.state;
      if (r.frac < frac - 1e-9) c.fail(`pass ${i}: ${frac} -> ${r.frac} [${r.kind}] — the money end dominates, never down`);
      if (r.frac - frac > C.SPLIT.stepMax + 1e-9) c.fail(`pass ${i}: a step of ${(r.frac - frac).toFixed(2)} > stepMax`);
      frac = r.frac;
      path.push(frac);
    }
    c.examined(12);
    c.note(`path ${path.join(" -> ")}`);
    if (Math.abs(frac - C.SPLIT.maxFrac) > 1e-9) c.fail(`must end at the money end ${C.SPLIT.maxFrac}: ${frac}`);
  }

  {
    const c = new Check("SR5", "WIRING: progress.js gives splitControl the committed route from the plan record, this node");
    checks.push(c);
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    c.examined(1);
    if (!/route = committedRouteOf\(readJson\(ns, PLAN_FILE\), \{ node: info\?\.currentNode/.test(prog)) c.fail("progress.js: no committedRouteOf on the plan record");
    if (!/splitControl\(\{[^\n]*, route \}\)/.test(prog)) c.fail("progress.js: splitControl is not given the route");
  }

  return checks;
}
