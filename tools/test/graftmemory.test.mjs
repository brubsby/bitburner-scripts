// [GM] The graft set is the node's memory, not one pass's opinion.
//
// Live BN9 2026-09-29: the projected exit went 103.6h (06:29Z) -> 193.1h
// (10:28Z) on one exit-model version. Replayed one input group at a time
// (exitplan.bestExitPolicy on the 06:26 inputs vs the 10:26 fixture), the
// graft set is the whole move: the node had carried a 29-graft set (hacking
// x14.65, fixture-bn9-freshlife-0546) and by 10:26 committed 12 (x2.45).
//
// How it was lost: the trader's realised fit (nodeecon.realisedCapital) first
// read non-null ~08:50Z, at 0.6%/h on its first 11 points — a clock bug:
// flowed intervals (hacknet cash every row) left the index but stayed on the
// clock, so the slope was growth over ALL elapsed time (fixed: 19.7%/h then,
// 62.9%/h at 11:15 against 61-87%/h on the flow-free intervals). At that rate the
// 29 set's $75t cannot be paid for and loses to grafting nothing, so the
// seeded search dropped it (graftplan kept a seed "only while it still beats
// grafting nothing") and the ONLY copy — the committed decision — went with
// it. The search then restarted from nothing at GRAFT_SEARCH_MS a pass, and
// re-searched only on events (30 minutes apart): one or two bundles each, 12
// grafts by 10:26. Re-priced on the 10:26 inputs the lost 29 read 124h
// against the 12's 196h (point, bestExitPolicy).
//
//   GM1 THE TRIGGER    the diluted 08:50 fit (0.6%/h) made the 29 set lose to
//                      grafting nothing; the fixed fit keeps it
//   GM2 THE MEMORY     a budgeted search seeded with the committed 12 only (the
//                      old memory) stays >50h behind the one also seeded with
//                      the node's remembered 29
//   GM3 SKIP, DON'T CUT a seed name that is not graftable now is skipped, not
//                      the end of the seed
//   GM4 WIRING         progress.js seeds from the committed set AND graftMemory,
//                      persists graftMemory on every plan record, continues a
//                      budget-stopped search on the next pass; plan.js does not
//                      re-prefix a held decision's reason
//
// CALIBRATION: every hour here is exitplan's simulator on the live inputs; the
// fixture's exit (plan q50 193.1h, install point 184.2h) is the plan's own
// trajectory for the same inputs, which this reproduces to the graft decision's
// withoutH/withH it published (checked in GM2's notes).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const xp = await import("../../exitplan.js");
const gp = await import("../../graftplan.js");
const ne = await import("../../nodeecon.js");
const pl = await import("../../plan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-grafts-1026.json"), "utf8"));
const F0 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-freshlife-0546.json"), "utf8"));
const I = F.exitinputs.inputs;
const SEED29 = F0.exitinputs.inputs.finalGrafts.map((g) => g.name);
const COMMITTED12 = F.planGrafts.grafts.map((g) => g.name);
const H = (x) => xp.bestExitPolicy(x)?.best?.hours ?? null;
const base = (() => {
  const b = { ...I };
  delete b.finalGrafts;
  delete b.graftStartMoney;
  return b;
})();
const fitAt = (hhmm) => ne.realisedCapital(F.stockHist.filter((r) => r.at <= `2026-09-29T${hhmm}`));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

// A budget counted in exit simulations (deterministic; the live budget is
// GRAFT_SEARCH_MS of the pacer's CPU clock, ~1-2 bundles a search).
function search(inputs, seeds, sims = Infinity) {
  let n = 0;
  const priceExit = (x) => {
    n++;
    return H(x);
  };
  const r = gp.chooseGrafts({ candidates: F.candidates, priceExit, base: inputs, intelligence: F.intelligence, ownedNames: F.owned, seeds, budgetMs: sims, now: () => n });
  return { ...r, sims: n };
}

export async function run() {
  const checks = [];

  {
    const c = new Check("GM1", "THE TRIGGER: the trader fit's diluted clock read 0.6%/h at 08:50Z and discarded the 29-graft set; the fit on its measured time reads the flow-free rate and keeps it");
    // The pre-fix fit: flowed intervals skipped from the index but left on
    // the clock (reproduced here so the trigger stays demonstrable).
    const diluted = (rows) => {
      const pts = [];
      let s0 = null;
      let y = 0;
      for (let i = 0; i < rows.length; i++) {
        const b = rows[i];
        if (i === 0 || b.t < rows[i - 1].t) {
          s0 = b;
          y = 0;
          pts.length = 0;
          pts.push({ T: b.t * ne.STOCK_TICK_S, y });
          continue;
        }
        const a = rows[i - 1];
        if (!ne.flowNegligible(a, b)) continue;
        y += Math.log(1 + (b.lifePnl - a.lifePnl) / a.wealth);
        pts.push({ T: b.t * ne.STOCK_TICK_S, y });
      }
      void s0;
      const n = pts.length;
      const mT = pts.reduce((x, p) => x + p.T, 0) / n;
      const mY = pts.reduce((x, p) => x + p.y, 0) / n;
      return pts.reduce((x, p) => x + (p.T - mT) * (p.y - mY), 0) / pts.reduce((x, p) => x + (p.T - mT) ** 2, 0);
    };
    const life = (hhmm) => F.stockHist.filter((r) => r.at >= "2026-09-29T05:43" && r.at <= `2026-09-29T${hhmm}`);
    // The rate on the flow-free intervals themselves (what bayes.traderPosterior averages).
    const flowFree = (rows) => {
      let g = 0;
      let T = 0;
      for (let i = 1; i < rows.length; i++) if (ne.flowNegligible(rows[i - 1], rows[i])) {
        g += Math.log(1 + (rows[i].lifePnl - rows[i - 1].lifePnl) / rows[i - 1].wealth);
        T += (rows[i].t - rows[i - 1].t) * ne.STOCK_TICK_S;
      }
      return g / T;
    };
    const pct = (r) => `${(r * 360000).toFixed(1)}%/h`;
    const old0850 = diluted(life("08:50"));
    const f0850 = fitAt("08:50");
    const f1027 = fitAt("10:27");
    const ff = flowFree(life("10:27"));
    c.examined(5);
    c.note(`08:50: diluted clock ${pct(old0850)}, fixed ${f0850 ? pct(f0850.r) : null}; 10:27: fixed ${f1027 ? pct(f1027.r) : null} (warm-up ${f1027?.warmupH.toFixed(2)}h) vs flow-free intervals ${pct(ff)}; published then ${pct(I.capitalReturnPerSec)}`);
    if (!(old0850 * 3600 < 0.01)) c.fail(`the pre-fix fit must reproduce the 08:50 0.6%/h: ${pct(old0850)}`);
    if (!f0850 || !(f0850.r * 3600 > 0.1)) c.fail(`the fixed fit at 08:50 must read the measured intervals' rate, not 0.6%/h: ${JSON.stringify(f0850)}`);
    if (!f1027 || Math.abs(f1027.r / ff - 1) > 0.25) c.fail(`the fixed fit at 10:27 must be within 25% of the flow-free intervals' rate ${pct(ff)}: ${f1027 && pct(f1027.r)}`);
    const sOld = search({ ...base, capitalReturnPerSec: old0850, capitalWarmupH: 0 }, [SEED29], 0);
    const sNew = search({ ...base, capitalReturnPerSec: f0850.r, capitalWarmupH: f0850.warmupH }, [SEED29], 0);
    c.note(`29 set on the diluted 08:50 fit: none ${sOld.withoutH.toFixed(1)}h, kept ${sOld.seededFrom === 0}; on the fixed 08:50 fit: none ${sNew.withoutH.toFixed(1)}h, with ${sNew.withH.toFixed(1)}h`);
    if (sOld.seededFrom === 0) c.fail("on the diluted fit the 29 set must lose to grafting nothing (that is what discarded it)");
    if (sNew.seededFrom !== 0) c.fail("on the fixed fit the 29 set must be kept");
    // A synthetic book at exactly 1e-4/s with a flow on every other interval: the rate is not halved.
    const synth = [];
    let w = 1e9, pnl = 0, fl = 0;
    for (let t = 9; t <= 1209; t += 10) {
      if (((t - 9) / 10) % 2 === 1) { w += 0.1 * w; fl += 0.1 * (w / 1.1); }
      const gg = w * Math.expm1(1e-4 * 60); w += gg; pnl += gg;
      synth.push({ t, wealth: w, lifePnl: pnl, externalFlows: fl });
    }
    const rs = ne.realisedCapital(synth);
    c.note(`synthetic 1e-4/s with a 10% flow every other interval: ${rs?.r.toExponential(3)}/s`);
    if (!(rs && Math.abs(rs.r / 1e-4 - 1) < 0.05)) c.fail(`flows on half the intervals must not halve the rate: ${rs?.r}`);
    checks.push(c);
  }

  {
    const c = new Check("GM2", "THE MEMORY: a budgeted search seeded only with the committed 12 (the old memory) stays behind one also seeded with the node's remembered 29");
    const SIMS = 150; // ~ one live search's worth of exit simulations
    const old = search(base, [COMMITTED12], SIMS);
    const mem = search(base, [COMMITTED12, SEED29], SIMS);
    c.examined(3);
    const p12 = H({ ...base, finalGrafts: F.planGrafts.grafts, graftStartMoney: F.planGrafts.startMoney ?? 0 });
    c.note(`published: grafts withoutH ${F.planGrafts.withoutH.toFixed(1)}h withH ${F.planGrafts.withH.toFixed(1)}h (install basis); here the committed 12 re-priced ${p12.toFixed(1)}h, without ${H(base).toFixed(1)}h`);
    c.note(`one budgeted search (${SIMS} sims): committed-only seed -> ${old.grafts.length} grafts ${old.withH.toFixed(1)}h; with the memory -> ${mem.grafts.length} grafts ${mem.withH.toFixed(1)}h (from seed ${mem.seededFrom})`);
    if (mem.seededFrom !== 1) c.fail(`the remembered 29 must be the start on the 10:27 inputs (seededFrom ${mem.seededFrom})`);
    if (!(old.withH - mem.withH > 50)) c.fail(`the memory must be worth >50h here: ${old.withH} vs ${mem.withH}`);
    if (!(mem.withH < 130)) c.fail(`with the memory the exit must be back near the 29 set's 124h: ${mem.withH}`);
    checks.push(c);
  }

  {
    const c = new Check("GM3", "SKIP, DON'T CUT: a seed name that is not graftable now is skipped; the rest of the seed is kept");
    // QLink owned (e.g. installed): the old walk stopped at it (8th of 29) and kept 7.
    const owned = [...F.owned, "QLink"];
    const r = gp.chooseGrafts({ candidates: F.candidates, priceExit: H, base, intelligence: F.intelligence, ownedNames: owned, seeds: [SEED29], budgetMs: 0, now: () => 1 });
    c.examined(1);
    const want = SEED29.filter((n) => n !== "QLink");
    const got = (r.grafts ?? []).map((g) => g.name);
    c.note(`seed of ${SEED29.length} with QLink owned -> ${got.length} kept`);
    if (!want.every((n) => got.includes(n))) c.fail(`every graftable seed name must be kept: missing ${want.filter((n) => !got.includes(n)).join(", ")}`);
    checks.push(c);
  }

  {
    const c = new Check("GM4", "WIRING: progress.js seeds from the committed set and graftMemory, persists graftMemory on every plan record, continues a budget-stopped search; held reasons are not re-prefixed");
    const p = code("progress.js");
    c.examined(5);
    if (!/seeds: \[seed, memSeed\]/.test(p)) c.fail("graftDecisionOf must seed the search with the committed set AND the node's graft memory");
    if (!/graftMemory: pc\.decisions\.grafts\?\.memory \?\? pc\.prevAny\?\.graftMemory \?\? null/.test(p)) c.fail("the plan record must carry graftMemory whether or not the graft step ran");
    if (!/const continuing = prev\?\.truncated === true/.test(p) || !/prev\.key === undefined \|\| continuing\)/.test(p)) c.fail("a budget-stopped search must continue on the next pass");
    if (!/memSeed\.every\(\(n\) => found\.includes\(n\)\)/.test(p)) c.fail("the memory must only advance to a set that contains it");
    const prev = { key: "a", why: "held (no event): held (no event): stays on a", decidedAt: new Date().toISOString() };
    const d = pl.decideAmong({ options: [{ key: "a", sim: () => 1 }, { key: "b", sim: () => 2 }], prev, draws: [{ i: 0 }, { i: 1 }], redecide: false });
    c.note(`held reason: ${d.why}`);
    // One prefix, dated (plan.heldFields): the decision's own reason is what it said then.
    const d2 = pl.decideAmong({ options: [{ key: "a", sim: () => 1 }, { key: "b", sim: () => 2 }], prev: { ...prev, why: d.why }, draws: [{ i: 0 }, { i: 1 }], redecide: false });
    if (!/^held \(no event since [^)]*\); at that decision: stays on a$/.test(d.why ?? "") || d2.why !== d.why) c.fail(`a held reason must carry one prefix: ${d.why} / ${d2.why}`);
    checks.push(c);
  }
  return checks;
}
