// THE LIVE EXIT, leg by leg, on the inputs progress.js last published
// (/tel/exitinputs.txt) and the committed install decision's basis
// (/tel/plan.txt) — read over the control port, or from files given.
//
//   node tools/sim/liveexit.mjs [--inputs f.json --plan f.json] [--drop NAME]... [--4s] [--nograft]
//
// --drop NAME   remove a graft (and nothing else) from the committed set
// --4s          the trader on the 4S prior curve from the final window on (traderw RW_PRIOR['4S-long'])
// --nograft     no grafts at all
// Prints the best policy's legs on the point inputs. A read-only tool.
// CALIBRATION: the CHECK line reproduces the plan's own point for the
// committed install (decisions.install.pointH) from the unmodified inputs.
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const X = await import(path.join(REPO_ROOT, "exitplan.js"));
const P = await import(path.join(REPO_ROOT, "plan.js"));

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
async function tel(file) {
  const r = await fetch("http://localhost:12526/rpc", { method: "POST", body: JSON.stringify({ method: "getFile", params: { server: "home", filename: file } }) });
  return JSON.parse((await r.json()).result);
}
const ei = arg("--inputs") ? JSON.parse(fs.readFileSync(arg("--inputs"), "utf8")) : await tel("/tel/exitinputs.txt");
const plan = arg("--plan") ? JSON.parse(fs.readFileSync(arg("--plan"), "utf8")) : await tel("/tel/plan.txt");
let inputs = { ...ei.inputs };
const drops = argv.flatMap((a, i) => (a === "--drop" ? [argv[i + 1]] : []));
if (drops.length) {
  inputs.finalGrafts = (inputs.finalGrafts ?? []).filter((g) => !drops.includes(g.name));
  inputs.lifeGrafts = (inputs.lifeGrafts ?? []).filter((g) => !drops.includes(g.name));
}
if (argv.includes("--nograft")) {
  delete inputs.finalGrafts;
  delete inputs.lifeGrafts;
  delete inputs.graftStartMoney;
}
if (argv.includes("--final")) {
  inputs.finalGrafts = [...(inputs.lifeGrafts ?? []).map(({ life, ...g }) => g), ...(inputs.finalGrafts ?? [])];
  delete inputs.lifeGrafts;
}
if (argv.includes("--4s")) {
  const T = await import(path.join(REPO_ROOT, "traderw.js"));
  const pr = T.RW_PRIOR["4S-long"];
  inputs = { ...inputs, capitalReturnPerSec: pr.r0PerHour / 3600, capitalScaleW: pr.Wstar, capitalShape: pr.shape };
}
const fw = arg("--4sbuy");
if (fw) {
  const T = await import(path.join(REPO_ROOT, "traderw.js"));
  const { bitNodeMults } = await import(path.join(REPO_ROOT, "bitNodeMultipliers.js"));
  const pr = T.RW_PRIOR["4S-long"];
  inputs.fourS = { cost: 25e9 * bitNodeMults(ei.bitNode).FourSigmaMarketDataApiCost, when: fw, r0PerSec: pr.r0PerHour / 3600, Wstar: pr.Wstar, shape: pr.shape };
}
const sm = arg("--start");
if (sm !== null) inputs.graftStartMoney = +sm;
const basis = P.basisOf(plan.decisions?.install ?? null, Date.now());
console.log(`exit inputs ${ei.at}; plan ${plan.at} exit mean ${plan.exit?.meanH}h; basis ${JSON.stringify(basis && { kind: basis.kind, waitH: basis.waitH })}`);
console.log(`money $${(inputs.money / 1e9).toFixed(2)}b, trader r0 ${(inputs.capitalReturnPerSec * 3600).toFixed(3)}/h W* ${inputs.capitalScaleW?.toExponential(2)}, graftStart $${((inputs.graftStartMoney ?? 0) / 1e9).toFixed(2)}b, grafts life ${(inputs.lifeGrafts ?? []).length} final ${(inputs.finalGrafts ?? []).length}`);
const w = Math.max(0, basis?.waitH ?? 0);
const g = basis?.gains ?? null;
{
  const b0 = X.bestExitPolicy({ ...ei.inputs, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1).best?.hours;
  const pt = plan.decisions?.install?.pointH;
  console.log(`CHECK the plan's committed point ${pt}h vs this replay ${b0?.toFixed(3)}h (${typeof pt === "number" && b0 ? ((b0 / pt - 1) * 100).toFixed(2) : "?"}%; the plan priced it at ${plan.decisions?.install?.decidedAt ?? "?"}, the inputs at ${ei.at})`);
}
const pol = X.bestExitPolicy({ ...inputs, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1);
const b = pol.best;
console.log(`best: ${b?.installsFirst} installs, ${b?.hours?.toFixed(2)}h, final mult ${b?.mult?.toFixed(2)}`);
for (const l of b?.legs ?? []) console.log(`  ${l.leg.padEnd(26)} ${l.hours.toFixed(2).padStart(8)}h  ${l.detail ?? ""}`);
