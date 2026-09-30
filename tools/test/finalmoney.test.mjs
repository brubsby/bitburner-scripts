// [FM] THE FINAL WINDOW'S MONEY LEG, now that it binds (198f8a2: the trader's
// return is a curve r(W), saturating at ~$3-5e11/h pre-4S): every stream in
// it once, with its own growth driver; the 4S TIX API priced on the exit
// trajectory; the graft set searched down as well as up; the money legs
// integrated to their ODE.
//
//   FM1 THE GAME: 4S persists through installs (only prestigeSourceFile clears
//       it), the API alone serves getForecast, its price is
//       MarketDataTixApi4SCost x FourSigmaMarketDataApiCost ($100b in BN9)
//   FM2 THE SIMULATOR: exitplan fourS — 'life1' lengthens this life by the
//       price's money and trades on the 4S curve from the next life on (the
//       final window included); 'final' / a final window that is now pays it
//       first; absent, nothing moves
//   FM3 ONE BELIEF: plan.applyDraw moves the 4S curve by the draw's ratio to
//       the pre-4S point
//   FM4 THE ACTOR: stock.js follows the plan's decisions.fourS
//       (stockplan.fourSPlanOf), falls back to buy4SVerdict only without a
//       fresh decision of this life; progress.js decides, carries, holds and
//       publishes it
//   FM5 THE COMMITTED STREAMS: carriedIncome (gang, sleeves) summed into the
//       money legs, kept out of the eBudget lift, stripped by the decision
//       that prices its own stream
//   FM6 THE FINAL WINDOW'S HACKNET: lifeplan.freshHacknetFlow is never
//       negative, charges every server bought, and feeds only a window an
//       install opens
//   FM7 THE PRUNE on the live 18:42Z inputs: the remembered 24-graft set
//       carries QLink ($75t); the search as shipped drops it and the exit
//       falls from ~262h to ~96h on the committed trajectory
//   FM8 THE INTEGRATION: a money leg with a level-scaled income within 0.5%
//       of a fine RK4 (the left sum it replaced was +5-7% from a small book);
//       the reputation leg's trapezoid within 0.05% of 3000 steps; the root
//       leg's coarse screen never under-reads the leg by the third it relies on
//
// CALIBRATION: the simulator's own terms against fine integrals of the same
// ODE, and the game's source for every mechanic; the live fixture is the
// planner's own record (tools/sim/capture-plan.mjs).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const T = await import("../../traderw.js");
const SP = await import("../../stockplan.js");
const L = await import("../../lifeplan.js");
const GP = await import("../../graftplan.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");

const GAME = path.resolve(REPO_ROOT, "../bitburner");
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const src = (f) => fs.readFileSync(path.join(GAME, f), "utf8");
const C = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-qlink-1842.json"), "utf8"));
const I = C.exitinputs.inputs;
const PR4 = T.RW_PRIOR["4S-long"];
const COST = 25e9 * bitNodeMults(9).FourSigmaMarketDataApiCost;
const fourS = (when) => ({ cost: COST, when, r0PerSec: PR4.r0PerHour / 3600, Wstar: PR4.Wstar, shape: PR4.shape });
const noGrafts = (() => {
  const b = { ...I };
  delete b.finalGrafts;
  delete b.lifeGrafts;
  delete b.graftStartMoney;
  return b;
})();
const leg = (r, name) => (r.legs ?? []).find((l) => l.leg === name) ?? null;
const rateAt = (steps, h) => {
  let v = 0;
  for (const x of steps) {
    if (x.atH > h) break;
    v = x.perSec;
  }
  return v;
};

export async function run() {
  const checks = [];

  {
    const c = new Check("FM1", "THE GAME: 4S persists through installs, the API alone serves the trader, and its price is the node's");
    let ok = 0;
    try {
      const pg = src("src/PersonObjects/Player/PlayerObjectGeneralMethods.ts");
      const aug = pg.slice(pg.indexOf("export function prestigeAugmentation"), pg.indexOf("export function prestigeSourceFile"));
      const sf = pg.slice(pg.indexOf("export function prestigeSourceFile"), pg.indexOf("export function prestigeSourceFile") + 4000);
      if (/has4SDataTixApi/.test(aug)) c.fail("prestigeAugmentation touches has4SDataTixApi: the install clears 4S");
      else ok++;
      if (!/this\.has4SDataTixApi = false/.test(sf)) c.fail("prestigeSourceFile no longer clears has4SDataTixApi (read the node-exit reset)");
      else ok++;
      const ns = src("src/NetscriptFunctions/StockMarket.ts");
      const gf = ns.slice(ns.indexOf("getForecast:"), ns.indexOf("getForecast:") + 600);
      if (!/has4SDataTixApi/.test(gf) || /has4SData\b(?!TixApi)/.test(gf)) c.fail("getForecast's gate is not the 4S TIX API alone");
      else ok++;
      const cost = src("src/StockMarket/StockMarketCosts.ts");
      if (!/MarketDataTixApi4SCost \* currentNodeMults\.FourSigmaMarketDataApiCost/.test(cost)) c.fail("the API's price is not MarketDataTixApi4SCost x FourSigmaMarketDataApiCost");
      else ok++;
    } catch (e) {
      c.fail(`could not read the game source at ${GAME}`, String(e).slice(0, 120));
    }
    c.examined(5);
    if (COST !== 100e9) c.fail(`BitNode 9's API price must be $100b: $${COST}`);
    c.note(`${ok}/4 source facts hold; BitNode 9 price $${(COST / 1e9).toFixed(0)}b (x${bitNodeMults(9).FourSigmaMarketDataApiCost})`);
    checks.push(c);
  }

  {
    const c = new Check("FM2", "THE SIMULATOR: fourS 'life1' lengthens this life by the price's money and trades on the 4S curve from the next life on; 'final' pays it first in the window; absent, nothing moves");
    // A final window that must hold $75t (the QLink start balance): the 4S curve halves the saturated leg.
    const big = { ...noGrafts, joinMoney: 75e12 };
    const k = 5;
    const w0 = X.exitHours(big, k);
    const w1 = X.exitHours({ ...big, fourS: fourS("life1") }, k);
    const wf = X.exitHours({ ...big, fourS: fourS("final") }, k);
    const h0 = X.exitHours({ ...big, fourS: null }, 0);
    const hf = X.exitHours({ ...big, fourS: fourS("life1") }, 0);
    c.examined(5);
    const l1 = leg(w1, "grafts in earlier lives");
    const j0 = leg(w0, "hoard join money")?.hours;
    const j1 = leg(w1, "hoard join money")?.hours;
    c.note(`installs ${k}: without ${w0.hours?.toFixed(2)}h (join $75t ${j0?.toFixed(2)}h); 4S in life 1 ${w1.hours?.toFixed(2)}h (life 1 +${l1?.hours?.toFixed(2)}h, join ${j1?.toFixed(2)}h); 4S at the window ${wf.hours?.toFixed(2)}h ('4S money' ${leg(wf, "4S money")?.hours?.toFixed(2)}h)`);
    if (!(l1 && l1.hours > 0 && /4S TIX API/.test(l1.detail))) c.fail("4S in life 1 must lengthen life 1 by its money (a 'grafts in earlier lives' leg naming it)", JSON.stringify(l1));
    if (!(j1 < 0.7 * j0)) c.fail(`the final window's $75t must be earned on the 4S curve (r0 1.135/h, W* $1e12): ${j1}h vs ${j0}h pre-4S`);
    if (!leg(wf, "4S money")) c.fail("4S at the final window must be its first money leg");
    if (!leg(hf, "4S money")) c.fail("with no install before the final window, 'life1' is the window's first leg");
    if (!(X.exitHours(big, k).hours === w0.hours)) c.fail("absent, nothing moves");
    checks.push(c);
  }

  {
    const c = new Check("FM3", "ONE BELIEF: applyDraw moves the 4S curve by the draw's ratio to the pre-4S point");
    const inp = { ...noGrafts, fourS: fourS("life1") };
    const d = { r: inp.capitalReturnPerSec * 1.3, Wstar: inp.capitalScaleW * 0.5 };
    const o = P.applyDraw(inp, d);
    c.examined(2);
    const kr = o.fourS.r0PerSec / inp.fourS.r0PerSec;
    const kw = o.fourS.Wstar / inp.fourS.Wstar;
    c.note(`draw r x1.3, W* x0.5 -> 4S r0 x${kr.toFixed(3)}, W* x${kw.toFixed(3)}`);
    if (!(Math.abs(kr - 1.3) < 1e-9 && Math.abs(kw - 0.5) < 1e-9)) c.fail("the 4S curve must move with the draw's ratio");
    if (inp.fourS.r0PerSec !== PR4.r0PerHour / 3600) c.fail("applyDraw must not mutate the inputs' 4S curve");
    checks.push(c);
  }

  {
    const c = new Check("FM4", "THE ACTOR: stock.js follows decisions.fourS; progress.js decides, carries, holds and publishes it");
    const life = 1790698635790;
    const now = Date.parse("2026-09-29T19:00:00Z");
    const rec = (key, at = "2026-09-29T18:50:00Z", reset = life) => JSON.stringify({ at, lastAugReset: reset, decisions: { fourS: { key, why: "test" } } });
    c.examined(8);
    if (SP.fourSPlanOf(rec("now"), life, now)?.key !== "now") c.fail("a fresh 'now' of this life must be followed");
    if (SP.fourSPlanOf(rec("none"), life, now)?.key !== "none") c.fail("a fresh 'none' must be followed");
    if (SP.fourSPlanOf(rec("now", "2026-09-29T17:00:00Z"), life, now) !== null) c.fail("a stale decision must not be followed");
    if (SP.fourSPlanOf(rec("now", undefined, life - 1), life, now) !== null) c.fail("another life's decision must not be followed");
    if (SP.fourSPlanOf(rec("owned"), life, now) !== null) c.fail("only 'now' / 'none' are purchase decisions");
    const st = code("stock.js");
    if (!/fourSPlanOf\(ns\.read\('\/tel\/plan\.txt'\), info\.lastAugReset\)/.test(st) || !/decidedBy: 'plan \(decisions\.fourS\)'/.test(st) || !/fallback: /.test(st)) c.fail("stock.js must read the plan's decision and name its fallback");
    const pg = code("progress.js");
    if (!/async function fourSDecisionOf/.test(pg) || !/fourS: pc\.decisions\.fourS \?\? pc\.prev\?\.decisions\?\.fourS \?\? null/.test(pg)) c.fail("progress.js must decide and publish decisions.fourS");
    if (!/const f4 = fourSCarriedOf\(planCtx, info\)/.test(pg) || !/gate\.install && !forcedInstall && fourSHold\?\.hold/.test(pg)) c.fail("progress.js must carry the committed purchase into every decision's inputs and hold the install for it");
    checks.push(c);
  }

  {
    const c = new Check("FM5", "THE COMMITTED STREAMS: carriedIncome summed into the money legs, kept out of the eBudget lift, stripped by the decision that prices its own");
    const m = X.mergeSteps([[{ atH: 0, perSec: 1 }, { atH: 2, perSec: 3 }], [{ atH: 1, perSec: 10 }]]);
    c.examined(5);
    const want = [{ atH: 0, perSec: 1 }, { atH: 1, perSec: 11 }, { atH: 2, perSec: 13 }];
    if (JSON.stringify(m) !== JSON.stringify(want)) c.fail("mergeSteps must sum step functions", JSON.stringify(m));
    const base = { ...noGrafts, joinMoney: 1e12, eBudget: 0.2 };
    const gang = [{ atH: 0, perSec: 5e6 }];
    const a = X.exitHours(base, 3);
    const b = X.exitHours({ ...base, carriedIncome: { gang } }, 3);
    const e = X.exitHours({ ...base, extraIncome: gang }, 3);
    c.note(`join $1t: ${leg(a, "hoard join money")?.hours?.toFixed(2)}h alone, ${leg(b, "hoard join money")?.hours?.toFixed(2)}h with a carried $5m/s; final mult ${a.mult.toFixed(3)} / carried ${b.mult.toFixed(3)} / as extraIncome (the lift) ${e.mult.toFixed(3)}`);
    if (!(leg(b, "hoard join money").hours < leg(a, "hoard join money").hours)) c.fail("a carried stream must feed the money legs");
    if (b.mult !== a.mult) c.fail("a carried stream must not lift the cadence (eBudget)");
    if (!(e.mult > a.mult)) c.fail("extraIncome keeps its lift (the decisions that price their own stream)");
    const pg = code("progress.js");
    if (!/const \{ sleeves, \.\.\.rest \} = b\.carriedIncome/.test(pg) || !/const \{ gang, \.\.\.rest \} = b\.carriedIncome/.test(pg)) c.fail("the sleeve and gang decisions must strip their own carried stream");
    if (!/out\.carriedIncome = carried/.test(pg) || !/function\* gangCarriedGen/.test(pg) || !/function sleevesCarriedNow/.test(pg)) c.fail("exitInputsOf must carry the gang and the sleeves");
    checks.push(c);
  }

  {
    const c = new Check("FM6", "THE FINAL WINDOW'S HACKNET: freshHacknetFlow never negative, every server charged, and only in a window an install opens");
    const flow = L.freshHacknetFlow(I, 48);
    c.examined(4);
    if (!Array.isArray(flow) || !flow.length) c.fail("the live inputs carry a hacknet servers model: a flow is expected");
    else {
      if (flow.some((x) => !(x.perSec >= 0))) c.fail("the flow must never be negative");
      // Charged: what the stream pays out over 48h <= what the fleet earned less what it cost.
      const rec = [];
      L.freshLifeMoney(I, 48, 1, rec, { steps: Math.ceil(48 / 0.125), decisions: Math.ceil(48 / 0.25) });
      const earned = rec.reduce((a, r) => a + (r.earn ?? 0), 0);
      const bought = rec.reduce((a, r) => a + (r.buy ?? 0), 0);
      let paid = 0;
      for (let i = 0; i < flow.length; i++) paid += flow[i].perSec * (((flow[i + 1]?.atH ?? 48) - flow[i].atH) * 3600);
      c.note(`48h fresh fleet: earned $${(earned / 1e9).toFixed(1)}b, bought $${(bought / 1e9).toFixed(1)}b, paid to the balance $${(paid / 1e9).toFixed(1)}b; $${(rateAt(flow, 8) / 1e6).toFixed(2)}m/s at 8h, $${(rateAt(flow, 24) / 1e6).toFixed(2)}m/s at 24h`);
      if (!(paid <= earned - bought + 1e-6 * earned)) c.fail("every server bought must be repaid before the stream pays out");
      const inp = { ...noGrafts, joinMoney: 5e12, freshHacknet: flow };
      const x0 = X.exitHours({ ...noGrafts, joinMoney: 5e12 }, 3);
      const x1 = X.exitHours(inp, 3);
      const y0 = X.exitHours({ ...noGrafts, joinMoney: 5e12 }, 0);
      const y1 = X.exitHours(inp, 0);
      c.note(`join $5t after 3 installs: ${leg(x0, "hoard join money")?.hours?.toFixed(2)}h -> ${leg(x1, "hoard join money")?.hours?.toFixed(2)}h with the window's fleet; hold-to-exit unchanged ${y0.hours === y1.hours}`);
      if (!(leg(x1, "hoard join money").hours < leg(x0, "hoard join money").hours)) c.fail("the window's fleet must feed its money legs");
      if (y0.hours !== y1.hours) c.fail("under hold-to-exit the live fleet is lifeIncome: freshHacknet must not count it twice");
    }
    checks.push(c);
  }

  {
    const c = new Check("FM7", "THE PRUNE on the live 18:42Z inputs: the remembered set carries QLink ($75t); the search drops it on the committed trajectory");
    const basis = P.basisOf(C.plan.decisions.install, Date.parse(C.exitinputs.at));
    const traj = P.trajectoryOf(basis);
    const seed = [...(I.lifeGrafts ?? []), ...(I.finalGrafts ?? [])].map((g) => g.name);
    const r = GP.chooseGrafts({ candidates: C.candidates, priceExit: (x) => traj(x), base: noGrafts, intelligence: 0, ownedNames: C.owned, seeds: [seed, C.plan.graftMemory?.names ?? []], budgetMs: Infinity });
    const committed = traj({ ...noGrafts, lifeGrafts: I.lifeGrafts, finalGrafts: I.finalGrafts, graftStartMoney: I.graftStartMoney });
    c.examined(3);
    const names = (r.grafts ?? []).map((g) => g.name);
    c.note(`committed 24 (QLink in life 1, $75.15t): ${committed?.toFixed(2)}h; searched: ${names.length} grafts, ${r.withH?.toFixed(2)}h, pruned ${r.pruned?.join(", ") || "none"}`);
    if (!seed.includes("QLink")) c.fail("fixture: the remembered set must carry QLink");
    if (names.includes("QLink") || !(r.pruned ?? []).includes("QLink")) c.fail("the prune must drop QLink here");
    // 0.48 of it when this landed (126.8h vs 262.3h); 0.51 since the ground
    // leg queues behind the searched set's 22 grafts on the work slot ([XM]).
    if (!(r.withH < 0.55 * committed)) c.fail(`without QLink the exit must be far shorter: ${r.withH} vs ${committed}`);
    checks.push(c);
  }

  {
    const c = new Check("FM8", "THE INTEGRATION: money legs with a level-scaled income against a fine RK4; the reputation trapezoid against 3000 steps; the root screen's coarse estimate never under-reads by a third");
    const sh = T.RW_PRIOR["pre-long"].shape;
    // A fine reference: dW/dt = r(W) W + I(level(E)), dE/dt = rate, RK4 at 2s steps with the level continuous-floored as the model reads it.
    const ref = (target, o) => {
      const capC = T.capitalOf(o);
      const f = (W, E) => T.capitalEarnAt(Math.max(W, 0), capC) + (o.incomeAtLevel1 * (X.levelAt(E, o.mult) + 50)) / 51 + o.flatPerSec;
      let W = o.money0;
      let E = o.exp0;
      let t = 0;
      const dt = 2;
      while (W < target && t < 1e4 * 3600) {
        const k1 = f(W, E);
        const k2 = f(W + (k1 * dt) / 2, E + (o.expPerSec * dt) / 2);
        const k3 = f(W + (k2 * dt) / 2, E + (o.expPerSec * dt) / 2);
        const k4 = f(W + k3 * dt, E + o.expPerSec * dt);
        const dW = ((k1 + 2 * k2 + 2 * k3 + k4) * dt) / 6;
        if (W + dW >= target) return (t + ((target - W) / dW) * dt) / 3600;
        W += dW;
        E += o.expPerSec * dt;
        t += dt;
      }
      return Infinity;
    };
    let worst = 0;
    let wc = null;
    let n = 0;
    for (const m0 of [1e6, 1e8]) {
      for (const tgt of [1e9, 1.8e11]) {
        for (const lvl1 of [3e4, 3e5]) {
          for (const mult of [2, 10]) {
            const o = { money0: m0, incomeAtLevel1: lvl1, mult, exp0: 0, expPerSec: 100, flatPerSec: 3e4, capitalReturnPerSec: 0.73 / 3600, capitalScaleW: 4.6e11, capitalShape: sh };
            const h = X.hoursToMoney(tgt, o);
            const r0 = ref(tgt, o);
            const e = Math.abs(h / r0 - 1);
            n++;
            if (e > worst) {
              worst = e;
              wc = { m0, tgt, lvl1, mult, h, r0 };
            }
          }
        }
      }
    }
    c.examined(n + 2);
    c.note(`hoursToMoney vs RK4 over ${n} legs with a level-scaled income (constant exp rate): worst ${(100 * worst).toFixed(2)}% ($${wc.m0.toExponential(0)} -> $${wc.tgt.toExponential(1)}, $${wc.lvl1}/s at level 1, mult ${wc.mult}: ${wc.h.toFixed(3)}h vs ${wc.r0.toFixed(3)}h)`);
    if (!(worst < 0.005)) c.fail(`a money leg must be within 0.5% of its ODE: ${(100 * worst).toFixed(2)}%`);
    // The root leg's screen (exitplan: a coarse estimate settles the leg only
    // when 1.5x of it is still inside the climb): its premise is that the
    // coarse estimate never under-reads the exact leg by a third.
    let worstUnder = 0;
    let m = 0;
    for (const m0 of [1262, 1e6]) {
      for (const lvl1 of [0, 3e4, 3e6]) {
        for (const mult of [1, 10, 100]) {
          for (const flat of [0, 3e4, 3e6]) {
            if (!(lvl1 > 0 || flat > 0)) continue;
            const o = { money0: m0, incomeAtLevel1: lvl1, mult, exp0: 0, expPerSec: 500, flatPerSec: flat, capitalReturnPerSec: 0.73 / 3600, capitalScaleW: 4.6e11, capitalShape: sh };
            const exact = X.hoursToMoney(287.2e6, o);
            const quick = X.hoursToMoney(287.2e6, { ...o, coarse: true });
            m++;
            worstUnder = Math.max(worstUnder, 1 - quick / exact);
          }
        }
      }
    }
    c.note(`root-leg screen over ${m} legs: the coarse estimate under-reads the exact by at most ${(100 * Math.max(0, worstUnder)).toFixed(2)}% (the screen needs < 33%)`);
    if (!(worstUnder < 0.2)) c.fail(`the coarse screen must not under-read the leg: ${(100 * worstUnder).toFixed(1)}%`);
    // The reputation leg's trapezoid at REP_STEPS against 3000 (a 2500000-rep leg from a fresh install).
    const repIn = { ...noGrafts, terminalRep: 2.5e6, exitRep: 0 };
    const a = X.exitHours(repIn, 3);
    const repA = leg(a, "exit reputation")?.hours;
    const repF = leg(X.exitHours({ ...repIn, repSteps: 3000 }, 3), "exit reputation")?.hours;
    const repOld = leg(X.exitHours({ ...repIn, repSteps: 300 }, 3), "exit reputation")?.hours;
    c.note(`reputation leg (2.5M rep after 3 installs): ${repA?.toFixed(4)}h at REP_STEPS ${X.REP_STEPS} vs ${repF?.toFixed(4)}h at 3000 (${((repA / repF - 1) * 100).toFixed(3)}%); 300 trapezoid steps ${repOld?.toFixed(4)}h`);
    if (!(Math.abs(repA / repF - 1) < 5e-4)) c.fail(`the reputation trapezoid at ${X.REP_STEPS} steps must be within 0.05% of 3000`);
    checks.push(c);
  }

  return checks;
}
