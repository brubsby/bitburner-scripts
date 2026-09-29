// THE 4S TIX API ON THE EXIT TRAJECTORY, on a captured live plan
// (tools/sim/capture-plan.mjs): progress.js fourSDecisionOf's comparison —
// none vs bought this life ('life1') vs bought at the final window ('final')
// — on the committed install decision's basis, the plan's own 24 posterior
// draws (rebuilt from the record's posterior summary, as planperf does), for
// the captured graft set and for the set the search picks.
//
//   node tools/sim/fours.mjs capture.json [--set captured|searched|none]...
//
// CALIBRATION: the CHECK line reproduces the captured plan's install point
// from the captured inputs; every hour after it is the planner's own
// simulator. The 4S curve is traderw RW_PRIOR['4S-long'] (the sim's, NOT
// CALIBRATED against a live 4S trader: none has run in this node).
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const T = await import(path.join(REPO_ROOT, "traderw.js"));
const GP = await import(path.join(REPO_ROOT, "graftplan.js"));
const { bitNodeMults } = await import(path.join(REPO_ROOT, "bitNodeMultipliers.js"));

const argv = process.argv.slice(2);
const C = JSON.parse(fs.readFileSync(argv[0] ?? "/tmp/plan-capture.json", "utf8"));
const sets = argv.flatMap((a, i) => (a === "--set" ? [argv[i + 1]] : []));
const I = C.exitinputs.inputs;
const ps = C.plan.posteriors;
const c = ps.cadence;
const post = {
  drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
  gymSdLn: ps.gymSdLn ?? 0.1,
  cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
  expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
  income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  trader: ps.trader ? { perSec: { mean: ps.trader.mean, sd: ps.trader.sd }, lnWstar: { mean: Math.log(ps.trader.Wstar), sd: ps.trader.lnWstarSd }, rho: ps.trader.rho } : null,
};
const draws = P.makeDraws(post, P.PLAN.N, P.seedOf(C.plan.lastAugReset, C.plan.node));
const basis = P.basisOf(C.plan.decisions.install, Date.parse(C.exitinputs.at));
const traj = P.trajectoryOf(basis);
const base = { ...I };
delete base.finalGrafts;
delete base.lifeGrafts;
delete base.graftStartMoney;
delete base.fourS;
const pr = T.RW_PRIOR["4S-long"];
const cost = 25e9 * bitNodeMults(C.node).FourSigmaMarketDataApiCost;
const spec = (when) => ({ cost, when, r0PerSec: pr.r0PerHour / 3600, Wstar: pr.Wstar, shape: pr.shape });
console.log(`capture ${C.at}: basis ${basis?.kind} ${basis?.waitH?.toFixed(2)}h; 4S TIX API $${(cost / 1e9).toFixed(0)}b, curve r0 ${pr.r0PerHour}/h W* $${pr.Wstar.toExponential(2)}; ${draws.length} draws`);
console.log(`CHECK the plan's install point ${C.plan.decisions.install.pointH}h vs the captured inputs re-priced ${traj(I)?.toFixed(3)}h`);
const setsOf = {
  captured: () => ({ lifeGrafts: I.lifeGrafts, finalGrafts: I.finalGrafts, graftStartMoney: I.graftStartMoney }),
  none: () => ({}),
  searched: () => {
    const seed = [...(I.lifeGrafts ?? []), ...(I.finalGrafts ?? [])].map((g) => g.name);
    const r = GP.chooseGrafts({ candidates: C.candidates, priceExit: (x) => traj(x), base, intelligence: 0, ownedNames: C.owned, seeds: [seed, C.plan.graftMemory?.names ?? []], budgetMs: Infinity });
    console.log(`  searched set: ${r.grafts?.length} grafts, pruned ${r.pruned?.join(", ") || "none"}, point ${r.withH?.toFixed(2)}h`);
    return GP.graftInputsOf(r.grafts.map((g) => g.spec), r.startMoney) ?? {};
  },
};
for (const s of sets.length ? sets : ["captured", "searched"]) {
  const withSet = { ...base, ...setsOf[s]() };
  const nk = P.noiseKeyOf(basis, withSet);
  const options = [
    { key: "none", noiseKey: nk, sim: (d) => traj(P.applyDraw(withSet, d), d) },
    { key: "life1", noiseKey: nk, sim: (d) => traj(P.applyDraw({ ...withSet, fourS: spec("life1") }, d), d) },
    { key: "final", noiseKey: nk, sim: (d) => traj(P.applyDraw({ ...withSet, fourS: spec("final") }, d), d) },
  ];
  const d = P.decideAmong({ options, prev: { key: "none" }, draws, redecide: true, budgetMs: 1e9 });
  const pt = Object.fromEntries(["none", "life1", "final"].map((k) => [k, traj(k === "none" ? withSet : { ...withSet, fourS: spec(k) })]));
  console.log(`\nset ${s}: point none ${pt.none?.toFixed(2)}h, life1 ${pt.life1?.toFixed(2)}h, final ${pt.final?.toFixed(2)}h`);
  for (const o of d.options) console.log(`  ${o.key.padEnd(6)} mean ${o.meanH}h q10 ${o.q10} q50 ${o.q50} q90 ${o.q90} pBest ${o.pBest}`);
  console.log(`  decision: ${d.key} — ${d.why}`);
}
