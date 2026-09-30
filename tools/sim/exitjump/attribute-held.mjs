// A HELD PASS'S EXIT MOVED WITH NO EVENT — which input group moved it.
//
//   node tools/sim/exitjump/attribute-held.mjs [fixture.json]
//
// Default fixture: tools/test/fixture-bn9-held-0644.json — the two plan
// passes around the live BN9 EXIT UNSTABLE of 2026-09-30 (06:39:33Z mean
// 16.03h -> 06:44:33Z mean 21.51h, same held install w2.2), each with the
// exit inputs it priced. Prices the committed install's POINT the way the
// plan prices it (plan.basisOf at the pass's own time, bestExitPolicy with
// firstInstallH = the basis wait and the basis's installed batch), then swaps
// the input groups from the earlier pass to the later one one at a time
// ("A + group") and back again ("B - group"), so an interaction shows as the
// two columns disagreeing.
//
// CALIBRATION: the CHECK lines reproduce both passes' published points
// (decisions.install.pointH) from their own inputs before attributing.
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const E = await import(path.join(REPO_ROOT, "exitplan.js"));

const F = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-held-0644.json"), "utf8"));
export const GROUPS = {
  "trader belief": ["capitalReturnPerSec", "capitalScaleW", "capitalShape", "capitalCap", "capitalFit", "capitalWarmupH"],
  "cadence (life length)": ["cycleHours", "multGainPerCycle", "cadence", "cadenceRateMedian", "cadenceFrom"],
  "install batch": ["installGains", "persistBaseline", "nextInstallGain"],
  "grafts": ["lifeGrafts", "finalGrafts", "graftStartMoney"],
  "player state": ["hacking", "hackingExp", "hackingMult", "money", "installCash"],
  "exp rate": ["expPerSec", "expFlatPerSec", "expScalesWithLevel", "expSource"],
  "fresh-life ramp": ["freshExpLagH", "freshHackCum", "freshHacknet"],
  "carried streams": ["carriedIncome", "streams"],
  "income/rep": ["incomePerSec", "lifeIncome", "incomeFlatPerSec", "flatIncomePerSec", "repPerSec", "hacknet", "eBudget", "eRep", "contractRep"],
};
function pointOf(inputs, basis) {
  const g = basis?.gains ?? null;
  const r = E.bestExitPolicy({ ...inputs, firstInstallH: Math.max(0, basis?.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1);
  return { h: r.best?.hours ?? null, installs: r.best?.installsFirst ?? null, mult: r.best?.mult ?? null };
}
const A = F.a, B = F.b;
const basisA = P.basisOf(A.plan.decisions.install, Date.parse(A.plan.at));
const basisB = P.basisOf(B.plan.decisions.install, Date.parse(B.plan.at));
const pa = pointOf(A.exitinputs.inputs, basisA);
const pb = pointOf(B.exitinputs.inputs, basisB);
const f = (x) => (x == null ? "  null" : x.toFixed(3));
console.log(`CHECK A ${A.plan.at}: replay ${f(pa.h)}h (${pa.installs} installs) vs published point ${A.plan.decisions.install.pointH}h`);
console.log(`CHECK B ${B.plan.at}: replay ${f(pb.h)}h (${pb.installs} installs) vs published point ${B.plan.decisions.install.pointH}h`);
const swap = (base, from, keys) => {
  const o = { ...base };
  for (const k of keys) {
    if (k in from) o[k] = from[k];
    else delete o[k];
  }
  return o;
};
console.log(`\n${"group".padEnd(24)} ${"A + group".padStart(18)} ${"B - group".padStart(18)}`);
const rows = [];
for (const [name, keys] of Object.entries(GROUPS)) {
  const up = pointOf(swap(A.exitinputs.inputs, B.exitinputs.inputs, keys), basisA);
  const dn = pointOf(swap(B.exitinputs.inputs, A.exitinputs.inputs, keys), basisB);
  rows.push({ name, up: up.h - pa.h, dn: pb.h - dn.h });
  console.log(`${name.padEnd(24)} ${(up.h - pa.h >= 0 ? "+" : "") + (up.h - pa.h).toFixed(3)}h (${up.installs} inst) ${(pb.h - dn.h >= 0 ? "+" : "") + (pb.h - dn.h).toFixed(3)}h (${dn.installs} inst)`);
}
{
  const up = pointOf(A.exitinputs.inputs, basisB);
  const dn = pointOf(B.exitinputs.inputs, basisA);
  console.log(`${"basis (wait, batch)".padEnd(24)} ${(up.h - pa.h >= 0 ? "+" : "") + (up.h - pa.h).toFixed(3)}h (${up.installs} inst) ${(pb.h - dn.h >= 0 ? "+" : "") + (pb.h - dn.h).toFixed(3)}h (${dn.installs} inst)`);
}
console.log(`${"total".padEnd(24)} ${"+" + (pb.h - pa.h).toFixed(3)}h`);
// Pairs: the cadence group interacts with whatever makes an extra life look worth it.
const cad = GROUPS["cadence (life length)"];
for (const [name, keys] of Object.entries(GROUPS)) {
  if (keys === cad) continue;
  const up = pointOf(swap(A.exitinputs.inputs, B.exitinputs.inputs, [...cad, ...keys]), basisA);
  console.log(`cadence + ${name.padEnd(22)} ${(up.h - pa.h >= 0 ? "+" : "") + (up.h - pa.h).toFixed(3)}h (${up.installs} inst)`);
}
// Each side on its own cadence choice only at n fixed: is the extra life better?
for (const [lbl, inp, bas] of [["A", A.exitinputs.inputs, basisA], ["B", B.exitinputs.inputs, basisB]]) {
  const g = bas.gains;
  const one = E.bestExitPolicy({ ...inp, cycleHours: 1e6, firstInstallH: bas.waitH, installGains: g, nextInstallGain: g.hacking }, 400, 1).best;
  console.log(`${lbl}: forced 1 install ${f(one?.hours)}h (${one?.installsFirst} inst); on its own cadence ${f(pointOf(inp, bas).h)}h`);
}
