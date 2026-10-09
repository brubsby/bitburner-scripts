// [FS] THE EXP-FARM / MONEY SPLIT IS PRICED ON THE EXIT, EVERY PASS, OVER SPLITS.
//
// Live BN12 2026-10-09 14:50Z: batch.js's exp farm held 32,233GB of the
// fleet's 36,260GB and money batches ran only on the trader's manip host
// ($127k/s); the hacking-money ledger sat at $4.087b from 0.34h into the life.
// /tel/expfarm.txt read
//   farm: true, why: "the farm is running (batch.txt expFarm): its own record
//   is the measurement now"
// — the split was priced ONCE, when the farm switched on ~0.1h into the life
// (hacking 426, money batches ramping at ~$6m/s), then latched with no exit
// hours and no why; and only ever between the two ends (all money / all farm).
// On the live inputs the exit prices a quarter of the fleet on money ~0.6h
// sooner than the farm alone: the exit's remaining legs are install cycles and
// final-window money (graft start, the $100b join hoard), and the farm's exp is
// past the point where it moves them (exp x0.5 costs 0.14h).
//
//   FS1  no latch: progress.js prices the split from the farm side every pass
//        on batch.js's moneyPreview; batch.js publishes the verdict's why and
//        runs the priced money share beside the farm
//   FS2  splitVerdict is one exit per split on ONE input set; priced from the
//        farm end and from the money end it is the same set of exits
//   FS3  the live 14:47Z state over the measured counterfactual range: the
//        farm alone is NOT the optimum; a mixed split is chosen
//   FS4  the money model is ONE model: batch.js's target-count argmax, the
//        farm's money preview and the mixed split's money targets are
//        expfarm.moneyModelOf
//
// CALIBRATION: FS3's money side is the earnings ledger's measurement in this
// node (previous life, money mode at ~8h: $2.01e8/s hacking money, 3.3e3
// script exp/s; farm mode 9-10h: 2.46e5 exp/s — k ~74), and a range around
// it down to k 10 and $3e7/s; batch.js's live moneyPreview model is NOT
// CALIBRATED (no money-mode measurement while the farm runs) and says so in
// batch.txt.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const E = await import("../../expfarm.js");
const X = await import("../../exitplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn12-farmsplit-1450.json"), "utf8"));
const I = F.exitinputs.inputs;
const H = (x) => X.bestExitPolicy(x)?.best?.hours ?? null;
const code = (f) =>
  fs
    .readFileSync(path.join(REPO_ROOT, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const fnBody = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  const j = src.indexOf("\nfunction ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------
  {
    const c = new Check("FS1", "no latch: the split is re-priced from the farm side every pass, published with its why, and its money share is run");
    const p = code("progress.js");
    const b = code("batch.js");
    const fv = fnBody(p, "farmVerdictOf");
    c.examined(8);
    if (!fv) c.fail("progress.js farmVerdictOf not found");
    else {
      if (/its own record is the measurement now/.test(fv)) c.fail("farmVerdictOf still latches: a running farm is published as farm: true without pricing the money side (live BN12 2026-10-09)");
      if (!/splitVerdict\(\s*bestExitPolicy\s*,\s*inputs\s*,\s*\{\s*share0\s*,/.test(fv)) c.fail("farmVerdictOf must price the farm-mode split with expfarm.splitVerdict({share0, ...}) on the shared exit inputs");
      if (!/b\.moneyPreview/.test(fv)) c.fail("farmVerdictOf must read batch.txt moneyPreview (what money batching would earn) in farm mode");
      if (!/priced:\s*false/.test(fv)) c.fail("an unpriceable farm side must be published as priced: false, not as a fresh verdict");
      if (!/moneyShare:\s*r\.frac/.test(fv)) c.fail("the verdict must publish the chosen money share (moneyShare)");
    }
    if (!/moneyPreview,/.test(b) || !/moneyPreview = expMode\(nodeMults\)/.test(b)) c.fail("batch.js must compute and publish moneyPreview while the farm runs");
    if (!/expFarmVerdict:\s*\{\s*\.\.\.farmVerdictRecord\(ns\)/.test(b)) c.fail("batch.js must publish the split's verdict and why (batch.txt expFarmVerdict)");
    if (!/farm\.moneyShare = farm\.on && !expMode\(nodeMults\) \? farmMoneyShareOf\(ns\) : 0/.test(b) || !/want = \[\.\.\.want, \.\.\.farm\.moneyHosts\]/.test(b)) c.fail("batch.js must run the priced money share beside the farm (farm.moneyShare -> money targets)");
    c.note(`the live latched record: ${JSON.stringify(F.expfarm)}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("FS2", "splitVerdict: one exit per split on one input set; the farm end and the money end price the same exits");
    const scriptExp = F.status.expPerSec;
    const k = 40;
    const M = 1e8;
    const r = E.splitVerdict(X.bestExitPolicy, I, { share0: 0, scriptExpPerSec: scriptExp, k, moneyPerSec: M });
    c.examined(6);
    if (r.farm === null) c.fail(`the farm side could not be priced: ${r.why}`);
    else {
      // Each split's hours ARE the exit on the shared inputs with only the split changed.
      const flat = I.expFlatPerSec > 0 ? Math.min(I.expFlatPerSec, I.expPerSec) : 0;
      const at = (s) => ({ ...I, expPerSec: flat + (I.expPerSec - flat) * (1 - s + s / k), incomePerSec: I.incomePerSec + s * M });
      for (const g of r.grid) {
        const h = g.frac === 0 ? H(I) : H(at(g.frac));
        if (Math.abs(g.hours - h) > 1e-9) c.fail(`share ${g.frac}: ${g.hours}h is not the exit on the shared inputs (${h}h)`);
      }
      const best = r.grid.reduce((a, g) => (g.hours < a.hours ? g : a), { share: 0, hours: r.runH });
      const want = best.hours < r.runH - 1 / 60 ? best.frac : 0;
      if (r.frac !== want) c.fail(`the chosen share must be the cheapest exit beyond a minute: ${r.frac} vs ${want}`);
      // Mirror: priced from the money end on the money inputs, the same exits.
      const m = E.splitVerdict(X.bestExitPolicy, at(1), { share0: 1, scriptExpPerSec: scriptExp, k, moneyPerSec: M });
      if (m.farm === null) c.fail(`the mirror could not be priced: ${m.why}`);
      else {
        const off = r.grid.map((g) => Math.abs(g.hours - (m.grid.find((x) => x.frac === g.frac)?.hours ?? NaN))).reduce((a, x) => Math.max(a, x), 0);
        if (!(off < 1e-6)) c.fail(`the two ends must price the same exits (max diff ${off}h)`);
        else if (m.frac !== r.frac) c.fail(`the two ends must choose the same split when neither runs it: farm end ${r.frac}, money end ${m.frac}`);
        else c.note(`k ${k}, money $${M.toExponential(1)}/s, from either end: ${r.grid.map((g) => `${g.frac * 100}% ${g.hours.toFixed(2)}h`).join(", ")} -> ${r.frac * 100}% money`);
      }
      // Controls: a free money side wins outright; a worthless one keeps the farm alone.
      const rich = E.splitVerdict(X.bestExitPolicy, I, { share0: 0, scriptExpPerSec: scriptExp, k: 1, moneyPerSec: 1e9 });
      if (rich.frac !== 1) c.fail(`with k 1 and +$1e9/s batching the split must go all money: ${rich.frac}`);
      const none = E.splitVerdict(X.bestExitPolicy, I, { share0: 0, scriptExpPerSec: scriptExp, k: 1e3, moneyPerSec: 0 });
      if (none.frac !== 0) c.fail(`with no money and k 1000 the farm alone must stay: ${none.frac}`);
    }
    if (E.splitVerdict(X.bestExitPolicy, I, { share0: 0, scriptExpPerSec: scriptExp, k: 40, moneyPerSec: null }).farm !== null) c.fail("an unpriced money side must refuse (farm: null), not keep or switch silently");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("FS3", "the live 14:47Z state over the measured range: the farm alone is not the optimum");
    const scriptExp = F.status.expPerSec;
    const led = F.earnings.prevLife1791517017164;
    const kMeasured = led.farmMode_9to10h.scriptExpPerSec / led.moneyMode_8h.scriptExpPerSec;
    const rows = [];
    for (const k of [10, 20, kMeasured]) {
      for (const M of [3e7, led.moneyMode_8h.hackMoneyPerSec]) {
        const r = E.splitVerdict(X.bestExitPolicy, I, { share0: 0, scriptExpPerSec: scriptExp, k, moneyPerSec: M });
        c.examined(1);
        if (r.farm === null) c.fail(`k ${k} M ${M}: ${r.why}`);
        else rows.push({ k, M, r });
      }
    }
    for (const { k, M, r } of rows) c.note(`k ${k.toFixed(0)}, money $${M.toExponential(2)}/s: ${r.grid.map((g) => `${g.frac * 100}% ${g.hours.toFixed(2)}h`).join(", ")} -> ${r.frac * 100}% money (${(r.farmH - r.shareH).toFixed(2)}h sooner than the farm alone)`);
    for (const { k, M, r } of rows) {
      if (r.frac === 0) c.fail(`k ${k.toFixed(0)}, $${M.toExponential(2)}/s: the farm alone chosen (${r.farmH.toFixed(2)}h) — the exit prices a split sooner: ${r.grid.map((g) => `${g.frac}:${g.hours.toFixed(2)}`).join(" ")}`);
      if (r.frac === 1 && k >= 20) c.fail(`k ${k.toFixed(0)}: all money chosen (${r.moneyH.toFixed(2)}h) where the farm's exp is worth hours`);
    }
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("FS4", "one money model: the target-count argmax, the money preview and the mixed split's targets are expfarm.moneyModelOf");
    const b = code("batch.js");
    c.examined(4);
    if (!/const bestN = moneyModelOf\(cand\.length, moneyPlanAt\(cand, ram, scoreHackRam\)/.test(b)) c.fail("the target-count argmax must be expfarm.moneyModelOf");
    if (!/moneyModelOf\(cand\.length, moneyPlanAt\(cand, ram, scoreHackRam\), \{ fleetGB: totalRam, spacingMs: SETTINGS\.spacing, farmScore: farm\.score, farmGB \}/.test(b)) c.fail("the farm's money preview must be the same moneyModelOf");
    if (!/moneyModelOf\(cand\.length, moneyPlanAt\(cand, ram, scoreHackRam\), \{ fleetGB: farm\.moneyShare \* totalRam/.test(b)) c.fail("the mixed split's money targets must be the same moneyModelOf on the money share");
    // The model on a two-target toy: the head saturates, so the second target is worth adding.
    const plans = [
      { money: 1e6, gb: 100, hackTimeMs: 1000, score: 1e-3 },
      { money: 5e5, gb: 100, hackTimeMs: 1000, score: 1e-3 },
    ];
    const m = E.moneyModelOf(2, (i) => plans[i], { fleetGB: 2000, spacingMs: 200, farmScore: 4e-3, farmGB: 1000 });
    // n=1: min(1e6/800, 2000*1e6/(100*4000)) = 1250/ms; n=2: 1250 + 625 = 1875/ms (each saturates at 500GB)
    if (m.n !== 2 || Math.abs(m.modelIncomePerSec - 1875e3) > 1e-6 || m.moneyGB !== 1000 || Math.abs(m.k - 4) > 1e-12) c.fail(`moneyModelOf toy: ${JSON.stringify(m)}`);
    else c.note(`toy: n ${m.n}, $${m.modelIncomePerSec}/s on ${m.moneyGB}GB, k ${m.k}`);
    checks.push(c);
  }

  return checks;
}
