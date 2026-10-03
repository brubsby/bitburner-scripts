// The PP3c plan pass (tools/test/planperf.test.mjs) timed decision by
// decision, synchronously and repeated, with each decision's answer — for
// comparing the exit simulation's CPU before and after a change without the
// slice pacer's noise.
//
//   node tools/sim/plancpu-bench.mjs [--reps 5] [--flat] [--ocba both|on|off]
//
// --ocba (default both): every decision with the adaptive allocation
// (plan.ocbaEvaluateGen, PLAN.ocba) and with every option on every draw,
// INTERLEAVED rep by rep so machine load hits both alike; prints the
// simulations each ran, the ms, P(correct selection) and whether the two
// chose the same option. Adds the 21:12Z re-decision (fixture-bn9-redecide-2112)
// with every one of its 26 waits in the draws, and screened (PP5).
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
const ocbaArg = argv.includes("--ocba") ? argv[argv.indexOf("--ocba") + 1] : "both";
const MODES = ocbaArg === "on" ? ["ocba"] : ocbaArg === "off" ? ["full"] : ["full", "ocba"];
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
// THE 21:12Z RE-DECISION (PP5): 26 waits on 21 grafts.
const R = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-redecide-2112.json"), "utf8"));
const RD = P.makeDraws(postOf(R.posteriors), P.PLAN.N, P.seedOf(R.lastAugReset, R.node));
const RH = (spec) => P.trajectoryOf(spec)(R.exitinputs);
const Rpoint = {
  now: { hours: RH({ kind: "wait", waitH: 0 }) },
  waits: R.install.options.filter((o) => /^w[\d.]+$/.test(o.key)).map((o) => {
    const w = +o.key.slice(1);
    const gw = w >= 2 ? R.install.gains : null;
    return { waitH: w, hours: RH({ kind: "wait", waitH: w, gains: gw }), installGains: gw };
  }),
  never: { hours: RH({ kind: "never" }) },
  committedGains: R.prev.gains,
};
const off = { ...P.PLAN.ocba, on: false };
const decs = {
  grafts: (ocba) => P.decideAmong({ options: graftOpts(basisOf(F.install1341.gains)), draws: DRAWS, redecide: true, budgetMs: 1e9, ocba }),
  install: (ocba) => P.decideInstall({ inputs: INPUTS, point, prev, draws: DRAWS, redecide: true, budgetMs: 1e9, now: NOW, ocba }),
  installAll: (ocba) => P.decideInstall({ inputs: INPUTS, point, prev, draws: DRAWS, redecide: true, budgetMs: 1e9, now: NOW, installTopK: Infinity, installReach: Infinity, ocba }),
  graftsRebased: (ocba) => P.decideAmong({ options: graftOpts(basisOf(F.install1356.gains)), draws: DRAWS, redecide: true, budgetMs: 1e9, ocba }),
  gang: (ocba) => P.decideAmong({ options: ["none", "fleet", "player"].map((k) => ({ key: k, sim: (dr) => armH(k, P.applyDraw(b0, dr)) })), draws: DRAWS, redecide: true, budgetMs: 1e9, ocba }),
  gangHeldNone: (ocba) => P.decideAmong({ options: ["none", "fleet", "player"].map((k) => ({ key: k, sim: (dr) => armH(k, P.applyDraw(b0, dr)) })), prev: { key: "none" }, draws: DRAWS, redecide: true, budgetMs: 1e9, ocba }),
  sleeveObjective: (ocba) => P.decideAmong({ options: sleeveFns.map(([k, f]) => ({ key: k, sim: (dr) => f(P.applyDraw(I2, dr)) })), draws: DRAWS, redecide: true, budgetMs: 1e9, ocba }),
  sleeveHeldRep: (ocba) => P.decideAmong({ options: sleeveFns.map(([k, f]) => ({ key: k, sim: (dr) => f(P.applyDraw(I2, dr)) })), prev: { key: "rep" }, draws: DRAWS, redecide: true, budgetMs: 1e9, ocba }),
  redecide2112: (ocba) => P.decideInstall({ inputs: R.exitinputs, point: Rpoint, prev: R.prev, draws: RD, redecide: true, budgetMs: 1e9, now: Date.parse(R.at), reachSd: R.posteriors.s, ocba }),
  redecide2112All: (ocba) => P.decideInstall({ inputs: R.exitinputs, point: Rpoint, prev: R.prev, draws: RD, redecide: true, budgetMs: 1e9, now: Date.parse(R.at), installTopK: Infinity, installReach: Infinity, ocba }),
};
const times = Object.fromEntries(MODES.flatMap((m) => Object.keys(decs).map((k) => [`${m}:${k}`, []])));
const ans = {};
for (let r = 0; r < reps; r++) {
  for (const [k, f] of Object.entries(decs)) {
    for (const m of r % 2 ? [...MODES].reverse() : MODES) {
      const t0 = performance.now();
      const d = f(m === "ocba" ? P.PLAN.ocba : off);
      times[`${m}:${k}`].push(performance.now() - t0);
      ans[`${m}:${k}`] = { key: d.key, meanH: d.meanH, n: d.n, alloc: d.alloc ?? null, margins: d.margins ?? null, options: (d.options ?? []).map((o) => `${o.key}:${o.meanH}${o.nDraws ? `/${o.nDraws}` : ""}`).join(" ") };
    }
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const tot = Object.fromEntries(MODES.map((m) => [m, { ms: 0, sims: 0 }]));
let same = 0;
for (const k of Object.keys(decs)) {
  for (const m of MODES) {
    const x = ans[`${m}:${k}`];
    const ms = med(times[`${m}:${k}`]);
    tot[m].ms += ms;
    tot[m].sims += x.alloc?.sims ?? 0;
    console.log(`${m.padEnd(5)} ${k.padEnd(16)} ${ms.toFixed(1).padStart(7)}ms  ${String(x.alloc?.sims ?? "?").padStart(4)} sims  ${x.key} ${x.meanH}h n${x.n}${x.alloc?.mode === "ocba" ? `  PCS>=${x.alloc.pcs}` : ""}  [${x.options}]`);
  }
  if (MODES.length === 2) {
    const a = ans[`full:${k}`];
    const o = ans[`ocba:${k}`];
    const ok = a.key === o.key && a.meanH === o.meanH;
    same += ok ? 1 : 0;
    console.log(`      ${k.padEnd(16)} ${ok ? "SAME choice and committed mean" : `DIFFERENT: full ${a.key} ${a.meanH}h, ocba ${o.key} ${o.meanH}h`}`);
  }
}
for (const m of MODES) console.log(`total ${m.padEnd(5)} ${tot[m].ms.toFixed(1)}ms, ${tot[m].sims} simulations (median of ${reps}, first rep included)`);
if (MODES.length === 2) console.log(`saved: ${(100 * (1 - tot.ocba.ms / tot.full.ms)).toFixed(1)}% of the ms, ${(100 * (1 - tot.ocba.sims / tot.full.sims)).toFixed(1)}% of the simulations; ${same}/${Object.keys(decs).length} decisions the same`);
// THE VOC GATE ON THESE DECISIONS (plan.redecideGateOf): their margins as a
// held plan would carry them, the timer's event, the adaptive pass's work as
// the cost — would the 30-minute re-decide run?
if (MODES.includes("ocba")) {
  const decisions = {};
  for (const k of ["install", "gang", "sleeveObjective", "graftsRebased", "redecide2112"]) {
    const d = ans[`ocba:${k}`];
    decisions[k === "redecide2112" ? "countRoute" : k === "graftsRebased" ? "grafts" : k === "sleeveObjective" ? "sleeveObjective" : k] = { key: d.key, options: [{}], margins: d.margins };
  }
  for (const [k, d] of Object.entries(decisions)) console.log(`voc   ${k.padEnd(16)} margins ${JSON.stringify(d.margins)}  VOC ${(d.margins ?? []).reduce((s, m) => s + P.marginVoc(m.meanH, m.sdH), 0).toPrecision(3)}h`);
  const prevRec = { decidedAt: new Date(Date.now() - 31 * 60e3).toISOString(), decisions };
  const ev = P.redecideEvents({ ...prevRec, lastAugReset: 1 }, { lastAugReset: 1, now: Date.now() });
  const g = P.redecideGateOf(prevRec, ev, { now: Date.now(), costMs: tot.ocba.ms });
  console.log(`voc   gate: ${g.verdict} — ${g.why}`);
}
