// The PP3c plan pass (tools/test/planperf.test.mjs) timed decision by
// decision, synchronously and repeated, with each decision's answer — for
// comparing the exit simulation's CPU before and after a change without the
// slice pacer's noise.
//
//   node tools/sim/plancpu-bench.mjs [--reps 5] [--flat]
//
// CALIBRATION: a timing tool; its answers are the planner's own functions on
// the PP3c fixture, and it decides nothing.
//
// Prints each decision's key, mean and per-draw samples' checksum (so an
// answer that moved is visible) and the median ms over the reps.

import fs from "node:fs";
import path from "node:path";
import "../test/gameresolve.mjs";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const X = await import(path.join(REPO_ROOT, "exitplan.js"));
const P = await import(path.join(REPO_ROOT, "plan.js"));
const GP = await import(path.join(REPO_ROOT, "gangplan.js"));
const GW = await import(path.join(REPO_ROOT, "gangworth.js"));
const { bitNodeMults } = await import(path.join(REPO_ROOT, "bitNodeMultipliers.js"));

const argv = process.argv.slice(2);
const reps = +(argv[argv.indexOf("--reps") + 1] || 1) || 1;
const flat = argv.includes("--flat");
const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-plancpu-1341.json"), "utf8"));
function postOf(ps) {
  const c = ps.cadence;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  };
}
const POST = postOf(F.posteriors1341);
const INPUTS0 = { ...F.exitinputs, cadenceFrom: F.exitinputs.cadenceFrom ?? "purchase model" };
const b = P.traderBeliefOf([{ t: 0, wealth: 1e6, lifePnl: 0 }, { t: 10, wealth: 1e6, lifePnl: 0 }]);
const CURVE = flat ? null : { inputs: { capitalReturnPerSec: b.r, capitalScaleW: b.Wstar, capitalShape: b.shape }, draws: P.makeDraws({ ...POST, trader: b.post }, P.PLAN.N, P.seedOf(1790660521043, 9)) };
const INPUTS = CURVE ? { ...INPUTS0, ...CURVE.inputs } : INPUTS0;
const DRAWS = CURVE ? CURVE.draws : P.makeDraws(POST, P.PLAN.N, P.seedOf(1790660521043, 9));
const NOW = Date.parse(F.at1341);
const gains = F.install1341.gains;
const H = (spec) => P.trajectoryOf(spec)(INPUTS);
const point = {
  now: { hours: H({ kind: "wait", waitH: 0 }) },
  waits: F.install1341.waitsH.map((w) => {
    const g = w >= F.install1341.gainsFromH ? gains : null;
    return { waitH: w, hours: H({ kind: "wait", waitH: w, gains: g }), installGains: g };
  }),
  never: { hours: H({ kind: "never" }) },
  committedGains: gains,
};
const prev = { key: F.install1341.key, installAt: F.install1341.installAt, gains, spec: { kind: "wait", installAt: F.install1341.installAt, waitH: 4, gains }, decidedAt: F.at1341, why: "fixture" };
const withG = { ...INPUTS, finalGrafts: F.grafts1356.grafts, graftStartMoney: F.grafts1356.startMoney };
const basisOf = (g) => P.basisOf({ key: F.install1356.key, installAt: F.install1356.installAt, gains: g, spec: { ...F.install1356.spec, gains: g } }, Date.parse(F.at1356));
const graftOpts = (basis) => {
  const traj = P.trajectoryOf(basis);
  return [
    { key: "none", noiseKey: P.noiseKeyOf(basis, INPUTS), sim: (d) => traj(P.applyDraw(INPUTS, d), d) },
    { key: "grafts", noiseKey: P.noiseKeyOf(basis, withG), sim: (d) => traj(P.applyDraw(withG, d), d) },
  ];
};
const sim = GP.simulateGang({ faction: "Slum Snakes", isHacking: false, respect: 1, wantedLevel: 1, territory: 1 / 7, power: 1, territoryClashChance: 0, territoryWarfareEngaged: false }, [], { softcap: bitNodeMults(9).GangSoftcap, horizonH: 100, stepSec: 300, mode: "money", assignFn: GP.trainRatio(4.2, false, 1), ascend: { minGain: 1.09 }, rivals: Object.fromEntries(["Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead", "NiteSec", "The Black Hand"].map((n) => [n, { power: 1, territory: 1 / 7 }])), warfare: { fraction: 0, engageRatio: 1 } });
const sched = GW.gangIncomeSchedule(sim);
const grinds = { fleet: 2.0, player: 1.2 };
const eBudget = F.exitinputs1416.eBudget ?? 0.1;
const armH = (k, bb) => {
  const r = GW.gangArms(X.bestExitPolicy, bb, sched, k === "none" ? {} : { [k]: grinds[k] }, eBudget, 400, { lower: false });
  return k === "none" ? r.withoutH : r.arms?.[k]?.withH ?? null;
};
const by = { karma: 0.5, rep: 3, exp: 50, money: 1e4 };
const finish = (inputs) => GW.gangExit(X.bestExitPolicy, inputs, sched, grinds.fleet, eBudget)?.withH ?? null;
const sleeveFns = [
  ["karma", (bb) => finish(bb)],
  ["rep", (bb) => finish({ ...bb, sleeveRep: { perSec: by.rep, delayH: 0 }, repBoost: { K: (bb.repPerSec + by.rep) / bb.repPerSec, e: 0.3 } })],
  ["exp", (bb) => finish({ ...bb, expPerSec: (bb.expPerSec ?? 0) + by.exp, spendPerSec: 1600 })],
  ["money", (bb) => finish({ ...bb, extraIncome: [{ atH: 0, perSec: by.money }], eBudget })],
];
const I2 = CURVE ? { ...F.exitinputs1416, ...CURVE.inputs } : F.exitinputs1416;
const { inputs: b0 } = GW.withRepEstimate(I2);
const decs = {
  grafts: () => P.decideAmong({ options: graftOpts(basisOf(F.install1341.gains)), draws: DRAWS, redecide: true, budgetMs: 1e9 }),
  install: () => P.decideInstall({ inputs: INPUTS, point, prev, draws: DRAWS, redecide: true, budgetMs: 1e9, now: NOW }),
  graftsRebased: () => P.decideAmong({ options: graftOpts(basisOf(F.install1356.gains)), draws: DRAWS, redecide: true, budgetMs: 1e9 }),
  gang: () => P.decideAmong({ options: ["none", "fleet", "player"].map((k) => ({ key: k, sim: (dr) => armH(k, P.applyDraw(b0, dr)) })), draws: DRAWS, redecide: true, budgetMs: 1e9 }),
  sleeveObjective: () => P.decideAmong({ options: sleeveFns.map(([k, f]) => ({ key: k, sim: (dr) => f(P.applyDraw(I2, dr)) })), draws: DRAWS, redecide: true, budgetMs: 1e9 }),
};
const times = Object.fromEntries(Object.keys(decs).map((k) => [k, []]));
const ans = {};
for (let r = 0; r < reps; r++) {
  for (const [k, f] of Object.entries(decs)) {
    const t0 = performance.now();
    const d = f();
    times[k].push(performance.now() - t0);
    ans[k] = { key: d.key, meanH: d.meanH, options: (d.options ?? []).map((o) => `${o.key}:${o.meanH}`).join(" ") };
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
let tot = 0;
for (const k of Object.keys(decs)) {
  const m = med(times[k]);
  tot += m;
  console.log(`${k.padEnd(16)} ${m.toFixed(1).padStart(7)}ms  ${ans[k].key} ${ans[k].meanH}h  [${ans[k].options}]`);
}
console.log(`total ${tot.toFixed(1)}ms (median of ${reps}, first rep included)`);
