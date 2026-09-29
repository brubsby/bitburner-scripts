// [GM] The graft set is the node's memory, not one pass's opinion.
//
// Live BN9 2026-09-29: the projected exit went 103.6h (06:29Z) -> 193.1h
// (10:28Z) on one exit-model version. Replayed one input group at a time
// (exitplan.bestExitPolicy on the 06:26 inputs vs the 10:26 fixture), the
// graft set is the whole move: the node had carried a 29-graft set (hacking
// x14.65, fixture-bn9-freshlife-0546) and by 10:26 committed 12 (x2.45).
//
// How it was lost: the trader's realised fit (nodeecon.realisedCapital) first
// reads non-null ~08:50Z, at 0.6%/h on its first 11 points. At that rate the
// 29 set's $75t cannot be paid for and loses to grafting nothing, so the
// seeded search dropped it (graftplan kept a seed "only while it still beats
// grafting nothing") and the ONLY copy — the committed decision — went with
// it. The search then restarted from nothing at GRAFT_SEARCH_MS a pass, and
// re-searched only on events (30 minutes apart): one or two bundles each, 12
// grafts by 10:26. Re-priced on the 10:26 inputs the lost 29 read 124h
// against the 12's 196h (point, bestExitPolicy).
//
//   GM1 THE TRIGGER    the 08:50 fit makes the 29 set lose to grafting nothing;
//                      the 10:27 fit makes it win by >100h
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
    const c = new Check("GM1", "THE TRIGGER: the trader's first realised fit (08:50Z, 0.6%/h) makes the node's 29-graft set lose to grafting nothing; the 10:27 fit makes it win");
    const f0850 = fitAt("08:50");
    const f1027 = fitAt("10:27");
    c.examined(4);
    if (!f0850 || !f1027) c.fail(`the fits could not be reproduced: 08:50 ${JSON.stringify(f0850)}, 10:27 ${JSON.stringify(f1027)}`);
    else {
      const pct = (f) => `${(f.r * 360000).toFixed(1)}%/h (warm-up ${f.warmupH.toFixed(2)}h, ${f.points} points)`;
      c.note(`realised fit 08:50 ${pct(f0850)}; 10:27 ${pct(f1027)} (published ${(I.capitalReturnPerSec * 360000).toFixed(1)}%/h)`);
      if (fitAt("08:40") !== null) c.fail("before 08:50 the fit must still be null (the live return stood in)");
      if (!(f0850.r * 3600 < 0.01)) c.fail(`the 08:50 fit must read < 1%/h: ${pct(f0850)}`);
      const at0850 = { ...base, capitalReturnPerSec: f0850.r, capitalWarmupH: f0850.warmupH };
      const s0850 = search(at0850, [SEED29], 0);
      const s1027 = search(base, [SEED29], 0);
      c.note(`29 set on the 08:50 fit: none ${s0850.withoutH.toFixed(1)}h, seed kept: ${s0850.seededFrom === 0}; on 10:27: none ${s1027.withoutH.toFixed(1)}h, with ${s1027.withH.toFixed(1)}h`);
      if (s0850.seededFrom === 0) c.fail("on the 08:50 fit the 29 set must lose to grafting nothing (that is what discarded it)");
      if (!(s1027.seededFrom === 0 && s1027.withoutH - s1027.withH > 100)) c.fail(`on the 10:27 inputs the 29 set must beat grafting nothing by >100h: ${s1027.withoutH} -> ${s1027.withH}`);
    }
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
    if (!/^held \(no event\): stays on a/.test(d.why ?? "")) c.fail(`a held reason must carry one prefix: ${d.why}`);
    checks.push(c);
  }
  return checks;
}
