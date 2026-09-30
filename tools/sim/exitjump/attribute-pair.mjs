// ANY TWO PASSES' EXITS — which input group moved the committed point.
//
//   node tools/sim/exitjump/attribute-pair.mjs <A> <B> [--dir /tmp/fx/hist]
//   node tools/sim/exitjump/attribute-pair.mjs --fixture f.json
//
// A, B: the snapshot stamps of two passes in the per-pass history (the
// plan.txt.<HHMMSS>.* / exitinputs.txt.<HHMMSS>.* files; the newest of that
// stamp by mtime, since the names carry no date). A fixture is
// {a: {plan, exitinputs}, b: {plan, exitinputs}} (tools/test/fixture-*.json).
//
// Prices each pass's committed install POINT the way the plan prices it
// (plan.basisOf at the pass's own time, bestExitPolicy with firstInstallH =
// the basis wait and the basis's batch), then swaps input groups from A to B
// one at a time ("A + group") and back ("B - group"); the committed basis
// (wait, batch) is its own row. The rep rate is its own group (it is the
// input the 09:25 -> 09:30 jump read as 4.4 -> 17.8 rep/s).
//
// CALIBRATION: the CHECK lines reproduce both passes' published points
// (decisions.install.pointH) from their own inputs before attributing.
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const E = await import(path.join(REPO_ROOT, "exitplan.js"));

export const GROUPS = {
  "trader belief": ["capitalReturnPerSec", "capitalScaleW", "capitalShape", "capitalCap", "capitalFit", "capitalWarmupH"],
  "cadence (life length)": ["cycleHours", "multGainPerCycle", "cadence", "cadenceRateMedian", "cadenceFrom"],
  "install batch (inputs)": ["installGains", "persistBaseline", "nextInstallGain"],
  grafts: ["lifeGrafts", "finalGrafts", "graftStartMoney"],
  "player state": ["hacking", "hackingExp", "hackingMult", "money", "installCash"],
  "exp rate": ["expPerSec", "expFlatPerSec", "expScalesWithLevel", "expSource"],
  "rep rate": ["repPerSec"],
  "fresh-life ramp": ["freshExpLagH", "freshHackCum", "freshHacknet"],
  "carried streams": ["carriedIncome", "streams"],
  "income/other": ["incomePerSec", "lifeIncome", "incomeFlatPerSec", "flatIncomePerSec", "hacknet", "eBudget", "eRep", "contractRep", "favorStream"],
};

const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
// `when`: an ISO time or its prefix ("2026-09-30T09:15"); the plan pass whose
// `at` starts with it (the newest by mtime), and the exit inputs published
// nearest before that pass's `at` (the inputs its install decision priced).
function fromHist(dir, when) {
  const read = (kind) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${kind}.`))
      .map((f) => {
        try {
          return { f, m: fs.statSync(path.join(dir, f)).mtimeMs, j: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) };
        } catch {
          return null;
        }
      })
      .filter((x) => x && typeof x.j?.at === "string")
      .sort((a, b) => b.m - a.m);
  const plans = read("plan.txt").filter((x) => x.j.at.startsWith(when));
  if (!plans.length) throw new Error(`no plan pass at ${when} in ${dir}`);
  const plan = plans[0].j;
  const t = Date.parse(plan.at);
  const ei = read("exitinputs.txt").filter((x) => Date.parse(x.j.at) <= t + 5e3 && t - Date.parse(x.j.at) < 4 * 60e3).sort((a, b) => Date.parse(b.j.at) - Date.parse(a.j.at))[0];
  if (!ei) throw new Error(`no exit inputs within 4 min before the ${plan.at} pass`);
  return { plan, exitinputs: ei.j };
}
export function loadPair() {
  if (opt("--fixture")) return JSON.parse(fs.readFileSync(opt("--fixture"), "utf8"));
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
  const dir = opt("--dir") ?? "/tmp/fx/hist";
  return { a: fromHist(dir, pos[0]), b: fromHist(dir, pos[1]) };
}

export function pointOf(inputs, basis) {
  const g = basis?.gains ?? null;
  const r = E.bestExitPolicy({ ...inputs, firstInstallH: Math.max(0, basis?.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1);
  return { h: r.best?.hours ?? null, installs: r.best?.installsFirst ?? null };
}
const swap = (base, from, keys) => {
  const o = { ...base };
  for (const k of keys) {
    if (k in from) o[k] = from[k];
    else delete o[k];
  }
  return o;
};
export function attribute(F) {
  const A = F.a, B = F.b;
  const basisA = P.basisOf(A.plan.decisions.install, Date.parse(A.plan.at));
  const basisB = P.basisOf(B.plan.decisions.install, Date.parse(B.plan.at));
  const pa = pointOf(A.exitinputs.inputs, basisA);
  const pb = pointOf(B.exitinputs.inputs, basisB);
  const rows = [];
  for (const [name, keys] of Object.entries(GROUPS)) {
    const up = pointOf(swap(A.exitinputs.inputs, B.exitinputs.inputs, keys), basisA);
    const dn = pointOf(swap(B.exitinputs.inputs, A.exitinputs.inputs, keys), basisB);
    rows.push({ name, up: up.h - pa.h, dn: pb.h - dn.h });
  }
  {
    // The basis: B's wait and batch on A's inputs, and back. The wait's own
    // hours (B is later) are in it; the batch half is split out below.
    const up = pointOf(A.exitinputs.inputs, basisB);
    const dn = pointOf(B.exitinputs.inputs, basisA);
    rows.push({ name: "basis (wait + batch)", up: up.h - pa.h, dn: pb.h - dn.h });
    const upB = pointOf(A.exitinputs.inputs, { ...basisA, gains: basisB.gains });
    const dnB = pointOf(B.exitinputs.inputs, { ...basisB, gains: basisA.gains });
    rows.push({ name: "  of which the batch", up: upB.h - pa.h, dn: pb.h - dnB.h });
  }
  return { pa, pb, basisA, basisB, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const F = loadPair();
  const r = attribute(F);
  const f = (x) => (x == null ? "  null" : x.toFixed(3));
  const s = (x) => (x >= 0 ? "+" : "") + x.toFixed(3);
  const gk = (b) => (b?.gains ? `h${b.gains.hacking?.toFixed(3)} r${b.gains.rep?.toFixed(3)} $${b.gains.income?.toFixed(3)}` : "no batch");
  console.log(`CHECK A ${F.a.plan.at}: replay ${f(r.pa.h)}h vs published point ${F.a.plan.decisions.install.pointH}h (mean ${F.a.plan.exit?.meanH}h; ${F.a.plan.decisions.install.key}, ${gk(r.basisA)}, rep ${F.a.exitinputs.inputs.repPerSec?.toFixed(2)}/s)`);
  console.log(`CHECK B ${F.b.plan.at}: replay ${f(r.pb.h)}h vs published point ${F.b.plan.decisions.install.pointH}h (mean ${F.b.plan.exit?.meanH}h; ${F.b.plan.decisions.install.key}, ${gk(r.basisB)}, rep ${F.b.exitinputs.inputs.repPerSec?.toFixed(2)}/s)`);
  console.log(`events at B: ${JSON.stringify(F.b.plan.events ?? [])}`);
  console.log(`\n${"group".padEnd(24)} ${"A + group".padStart(10)} ${"B - group".padStart(10)}`);
  for (const x of r.rows) console.log(`${x.name.padEnd(24)} ${s(x.up).padStart(10)} ${s(x.dn).padStart(10)}`);
  console.log(`${"total".padEnd(24)} ${s(r.pb.h - r.pa.h).padStart(10)}`);
  // --split GROUP: that group's fields one at a time.
  const sp = opt("--split");
  if (sp && GROUPS[sp]) {
    for (const k of GROUPS[sp]) {
      const up = pointOf(swap(F.a.exitinputs.inputs, F.b.exitinputs.inputs, [k]), r.basisA);
      console.log(`  ${k.padEnd(22)} ${s(up.h - r.pa.h).padStart(10)}  ${JSON.stringify(F.a.exitinputs.inputs[k])?.slice(0, 60)} -> ${JSON.stringify(F.b.exitinputs.inputs[k])?.slice(0, 60)}`);
    }
  }
}
