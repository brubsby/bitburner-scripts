// THE EXIT AGAINST INCOME: more money never makes the true exit later (the
// player can always ignore it), so a sweep that rises is the policy search's
// fault. Sweeps a carried gang stream, the plain income and the trader r0 on
// a fixture's exit inputs.
//
//   node tools/sim/incomesweep.mjs [fixture.json] [--legs]
//
// NOT CALIBRATED: a property of the model against itself (the exit's shape in
// income), not a prediction of a live quantity. liveexit.mjs's CHECK line is
// the calibration of the exit on the same inputs.
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const X = await import(path.join(REPO_ROOT, "exitplan.js"));
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--")) ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-gangrespect-1556.json");
const f = JSON.parse(fs.readFileSync(file, "utf8"));
const ei = f.exitinputs ?? f;
const base = { ...ei.inputs, eRep: ei.eRep ?? ei.inputs.eRep, eBudget: ei.eBudget ?? ei.inputs.eBudget };
const legs = argv.includes("--legs");
function run(label, inp) {
  const t = performance.now();
  const b = X.bestExitPolicy(inp).best;
  const ms = performance.now() - t;
  console.log(`${label.padEnd(22)} ${b?.hours?.toFixed(4)}h installs ${b?.installsFirst} (${ms.toFixed(0)}ms)`);
  if (legs) for (const l of b?.legs ?? []) console.log(`    ${l.leg.padEnd(26)} ${l.hours.toFixed(3).padStart(8)}h  ${(l.detail ?? "").slice(0, 200)}`);
}
const steps = base.carriedIncome?.gang ?? [{ atH: 0, perSec: 0 }];
for (const g of [0, 1e6, 1e7, 3e7, 1e8, 2e8, 4e8, 1e9, 1e10, 1e12]) {
  run(`gang $${g.toExponential(0)}/s`, { ...base, carriedIncome: { ...base.carriedIncome, gang: steps.map((s) => ({ atH: s.atH, perSec: g })) } });
}
for (const k of [0.5, 1, 2, 4, 10]) {
  run(`income x${k}`, { ...base, incomePerSec: base.incomePerSec * k, flatIncomePerSec: (base.flatIncomePerSec ?? 0) * k, lifeIncome: (base.lifeIncome ?? 0) * k });
}
for (const k of [0.5, 1, 2, 4, 10]) run(`r0 x${k}`, { ...base, capitalReturnPerSec: base.capitalReturnPerSec * k });
