// [EX] Why the BN9 exit read ~2x the point: four questions, each a with-vs-
// without exit on the live 01:40 state (fixture-bn9-0140.json: hacking 156
// after ~7h, 35.7 exp/s at HackExpGain 0.05, $6.7m/s, $61b).
//
//   EX1 EXP FARM   money batches vs the exp farm, priced (expfarm.farmOrMoney)
//                  — was a BitNode-8 flag; now a verdict in every node
//   EX2 CADENCE    the life length is chosen on the exit's own inputs: the
//                  purchase model had nulled the next install's batch
//   EX3 GRAFTS     leave-one-out on the committed 28-graft set (QLink $75t)
//   EX4 MC TAIL    the cross-node cadence spread no longer perturbs the
//                  purchase model's gain while this node has no life of its own
//
// CALIBRATION: EX1's farm multiple is expfarm.js's model (NOT CALIBRATED in
// this node: the farm has not run here); its HWGW side is the measured
// script exp. EX2-EX4 run the exit simulator on its own published inputs.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const xp = await import("../../exitplan.js");
const ef = await import("../../expfarm.js");
const lp = await import("../../lifeplan.js");
const pl = await import("../../plan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-0140.json"), "utf8"));
const I = F.exitinputs.inputs;
const H = (x) => xp.bestExitPolicy(x)?.best?.hours ?? null;
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

export async function run() {
  const checks = [];
  const point = H(I);

  // -------------------------------------------------------------------
  {
    const c = new Check("EX1", "EXP FARM: money batches vs the farm is two exits in every node, not a BitNode-8 flag");
    // The live money target (sigma-cosmetics: hack 9.6s at min security, chance 1).
    const t = { baseDifficulty: 20, hackTime: F.batch.target.hackTimeSec * 1000, chance: 1 };
    const perGB = ef.expScore(t, 1) / ef.batchedScore(t);
    const r = ef.farmOrMoney(xp.bestExitPolicy, I, { scriptExpPerSec: F.status.expPerSec, perGB, usedGB: F.batch.ram.used, totalGB: F.batch.ram.total, batchMoneyPerSec: F.batch.totals.earnedPerSec });
    c.examined(4);
    if (r.farm === null) c.fail(`the farm could not be priced: ${r.why}`);
    else {
      c.note(`farm unit / HWGW exp per GB-ms x${perGB.toFixed(2)} (the ratio is independent of baseDifficulty); fleet ${F.batch.ram.used}/${F.batch.ram.total}GB -> script exp x${r.k.toFixed(2)}: ${F.status.expPerSec} -> ${(F.status.expPerSec * r.k).toFixed(1)}/s; batch money lost $${r.batchMoney}/s of $${Math.round(I.incomePerSec)}/s`);
      c.note(`exit: money ${r.withoutH.toFixed(2)}h, farm ${r.withH.toFixed(2)}h (${(r.withH - r.withoutH).toFixed(2)}h); mixed ${r.mixed.map((m) => `f${m.f} ${m.hours?.toFixed(2)}h`).join(", ")}`);
      if (!r.farm) c.fail(`at BN9's rates the farm must win: ${r.withH} vs ${r.withoutH}`);
      // Where hacking money is what the exit runs on, money must win: the same
      // decision, not a flag (a BN1-like state: income all from batching).
      // (Income $50m/s of which the batcher earns $45m/s; no trader.)
      const moneyNode = ef.farmOrMoney(xp.bestExitPolicy, { ...I, capitalReturnPerSec: 0, incomePerSec: 5e7 }, { scriptExpPerSec: F.status.expPerSec, perGB, usedGB: F.batch.ram.used, totalGB: F.batch.ram.total, batchMoneyPerSec: 4.5e7 });
      if (moneyNode.farm !== false) c.fail(`where the batcher IS the income the verdict must keep batching: ${JSON.stringify(moneyNode).slice(0, 200)}`);
      else c.note(`control (income all from batching): money ${moneyNode.withoutH.toFixed(1)}h vs farm ${moneyNode.withH.toFixed(1)}h — batching kept`);
    }
    if (ef.farmOrMoney(xp.bestExitPolicy, I, { scriptExpPerSec: null, perGB, usedGB: 1, totalGB: 1 }).farm !== null) c.fail("an unmeasured exp rate must refuse, not farm");
    const b = code("batch.js");
    if (!/farm\.on = !flags\.nofarm && \(expMode\(nodeMults\) \|\| farmVerdictOn\(ns\)\)/.test(b)) c.fail("batch.js must farm on the priced verdict, not only in BitNode 8");
    if (!/expFarmPreview: farmPreview/.test(b)) c.fail("batch.js must publish the farm preview in money mode");
    if (!/ns\.write\('\/tel\/expfarm\.txt', JSON\.stringify\(farmVerdictOf\(/.test(code("progress.js"))) c.fail("progress.js must publish the farm verdict");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("EX2", "CADENCE: the life length is priced on the exit's own inputs (the next install's batch kept)");
    const cat = F.catalogue;
    const catalogue = lp.catalogueOf(cat);
    const args = { catalogue, favor: cat.favor, owned: cat.owned, repPerHour0: I.repPerSec * 3600, bestExitPolicy: xp.bestExitPolicy };
    const now = lp.cadenceByPurchases({ inputs: I, ...args });
    // The old pricing: the next install's batch nulled.
    const oldBEP = (x) => xp.bestExitPolicy({ ...x, installGains: null, nextInstallGain: null });
    const old = lp.cadenceByPurchases({ inputs: I, ...args, bestExitPolicy: oldBEP });
    c.examined(3);
    if (!now || !old) c.fail("the cadence could not be priced");
    else {
      const full = (r) => H({ ...I, cycleHours: r.cycleHours, multGainPerCycle: r.multGainPerCycle });
      const nowFull = full(now);
      const oldFull = full(old);
      c.note(`old (batch nulled): ${old.cycleHours}h x${old.multGainPerCycle.toFixed(3)} — table ${old.exitH.toFixed(2)}h, full exit ${oldFull.toFixed(2)}h`);
      c.note(`new: ${now.cycleHours}h x${now.multGainPerCycle.toFixed(3)} — table ${now.exitH.toFixed(2)}h, full exit ${nowFull.toFixed(2)}h (${(nowFull - oldFull).toFixed(2)}h)`);
      c.note(`per length: ${now.table.map((x) => `${x.L}h ${x.H}h`).join(", ")}`);
      if (Math.abs(now.exitH - nowFull) > 1e-6) c.fail(`the chosen length's price must BE the exit's (table ${now.exitH} vs full ${nowFull})`);
      if (nowFull > oldFull + 1e-9) c.fail(`pricing on the exit's inputs cannot choose a later exit (${nowFull} vs ${oldFull})`);
    }
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("EX3", "GRAFTS: every committed graft, left out, against the set (QLink $75t included)");
    const G = I.finalGrafts ?? [];
    c.examined(G.length);
    const rows = G.map((g, i) => ({ g, d: H({ ...I, finalGrafts: G.filter((_, j) => j !== i) }) - point })).sort((a, b) => b.d - a.d);
    const q = rows.find((r) => r.g.name === "QLink");
    c.note(`point exit ${point.toFixed(2)}h with ${G.length} grafts ($${(G.reduce((a, g) => a + g.cost, 0) / 1e12).toFixed(1)}t, ${G.reduce((a, g) => a + g.slotH, 0).toFixed(1)}h of slot)`);
    for (const r of rows.slice(0, 4)) c.note(`  without ${r.g.name}: ${r.d >= 0 ? "+" : ""}${r.d.toFixed(2)}h`);
    for (const r of rows.slice(-3)) c.note(`  without ${r.g.name}: ${r.d >= 0 ? "+" : ""}${r.d.toFixed(2)}h`);
    if (q && !(q.d > 5)) c.fail(`QLink must be worth its $75t on this state (without it ${q.d.toFixed(2)}h)`);
    const neg = rows.filter((r) => r.d < 0);
    if (neg.length) c.note(`leave-one-out improves on ${neg.map((r) => `${r.g.name} (${r.d.toFixed(2)}h: ${r.g.hacking < 1 ? "hacking x" + r.g.hacking + " — a prerequisite, see graftplan" : "check"})`).join("; ")}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("EX4", "MC TAIL: with no life of its own in this node, the cross-node cadence spread does not perturb the purchase model's gain");
    const cp = F.cadencePosterior;
    const post = (w) => ({ drift: { a: 20, b: 20 * 0.01 * 0.01, nu: 4 }, jitter: { a: 20, b: 20 * 0.0004 }, trader: null, exp: null, rep: null, gymSdLn: 0.1, income: null, cadence: { rate: { mean: Math.log(cp.lnPerHour), sd: cp.rateSdLn }, life: { mean: Math.log(cp.cycleHours), sd: cp.lifeSdLn }, own: { weight: w } } });
    const stats = (w) => {
      const hs = pl.makeDraws(post(w), 200, 7).map((d) => H(pl.applyDraw(I, d))).filter((x) => typeof x === "number").sort((a, b) => a - b);
      return { mean: hs.reduce((a, b) => a + b, 0) / hs.length, q10: hs[Math.floor(hs.length * 0.1)], q50: hs[Math.floor(hs.length * 0.5)], q90: hs[Math.floor(hs.length * 0.9)] };
    };
    const w0 = stats(0);
    const w1 = stats(1);
    c.examined(2);
    c.note(`point ${point.toFixed(1)}h; cadence draw with the cross-node spread (old): mean ${w1.mean.toFixed(1)}h q10 ${w1.q10.toFixed(1)} q50 ${w1.q50.toFixed(1)} q90 ${w1.q90.toFixed(1)}`);
    c.note(`own weight 0 (this node has no gaining life): mean ${w0.mean.toFixed(1)}h q10 ${w0.q10.toFixed(1)} q50 ${w0.q50.toFixed(1)} q90 ${w0.q90.toFixed(1)}`);
    if (!(Math.abs(w0.mean - point) < 0.05 * point)) c.fail(`with no own-node evidence the drawn exit must sit on the point (mean ${w0.mean} vs ${point})`);
    if (!(w1.q90 - w1.q10 > w0.q90 - w0.q10)) c.fail("the old draw must be the wider one (the regression this fixes)");
    checks.push(c);
  }

  return checks;
}
