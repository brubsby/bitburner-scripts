// EXIT JUMP AT INSTALL — the proving record (live BN9 2026-09-29, 16:17Z install).
//
//   node tools/sim/exitjump/attribute.mjs [fixture.json]
//
// The install actor priced "install now" at 50.26h (plan 'now' mean 50.06h);
// the next life priced the same trajectory at mean 94.1h. This rebuilds both
// sides from tools/test/fixture-bn9-exitjump-1645.json and swaps the input
// groups one at a time — the pre-install sim's model of the post-install life
// against the actual post-install inputs — then prices both sides again on
// the one trader belief (plan.traderBeliefOf) and asks the cadence question
// (install now vs wait) on the fixed model.
//
// CALIBRATION: the CHECK lines below reproduce the two recorded exits (the
// actor's 50.26h point and the plan's 94.1h mean) before anything is
// attributed; the pre side's one free parameter (this life's live trader
// return, never archived) is calibrated to the actor and says so.
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import("../../../plan.js");
const E = await import("../../../exitplan.js");
const B = await import("../../../bayes.js");
const N = await import("../../../nodeecon.js");
const O = await import("../../../objective.js");

const F = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-1645.json"), "utf8"));
const POST = F.exitinputs;
const ROWS = F.stockHist;
const INSTALL_AT = Date.parse(F.installLast.at);
const ELAPSED_H = (Date.parse(F.exitinputsAt) - INSTALL_AT) / 3.6e6;
const ps = F.plan.posteriors;
const c = ps.cadence;
const basePost = {
  drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
  gymSdLn: 0.1,
  cadence: { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } },
  expPost: { perSec: ps.exp.perSec, sd: ps.exp.sdLn },
  income: { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn },
};
const pre = F.pre;
const preInputs = (over = {}) => ({
  ...POST,
  money: 0.448e9,
  hacking: pre.hacking,
  hackingExp: pre.hackingExp,
  hackingMult: POST.hackingMult * pre.hackingMultOverPost,
  expPerSec: pre.expPerSec,
  repPerSec: ((POST.repPerSec * pre.hacking) / POST.hacking) * pre.hackingMultOverPost,
  installGains: pre.batchGains,
  persistBaseline: pre.batchGains,
  nextInstallGain: pre.batchGains.hacking,
  capitalReturnPerSec: pre.liveReturnPerHour / 3600,
  capitalWarmupH: 0,
  cycleHours: pre.cycleHours,
  multGainPerCycle: Math.exp(pre.lnPerHour * pre.cycleHours),
  ...over,
});
function price(inputs, { wait = null, trader = null, seed }) {
  const draws = P.makeDraws({ ...basePost, trader: trader ? { perSec: trader } : null }, 24, seed);
  const f = (x) => {
    const r = wait !== null ? E.bestExitPolicy({ ...x, firstInstallH: wait }, 400, 1) : E.bestExitPolicy(x);
    return r.degenerate ? null : r.best?.hours ?? null;
  };
  const hs = draws.map((d) => f(P.applyDraw(inputs, d))).filter((h) => Number.isFinite(h));
  return { point: f(inputs), mean: hs.reduce((a, b) => a + b, 0) / hs.length };
}
const SEED_PRE = P.seedOf(F.installLast.lastAugReset, 9);
const SEED_POST = P.seedOf(F.lastAugReset, 9);
const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
const pct = (a, b) => `${((100 * Math.abs(a - b)) / b).toFixed(1)}%`;

// The old estimators.
const fitPost = N.realisedCapital(ROWS);
const tpPost = B.traderPosterior(ROWS, { warmupH: fitPost?.warmupH ?? 0 });
const oldPre = price(preInputs(), { wait: 0, seed: SEED_PRE });
const oldPost = price(POST, { trader: tpPost.perSec, seed: SEED_POST });
console.log(`CHECK pre  'now' point ${oldPre.point.toFixed(2)}h vs the actor's recorded ${F.installLast.exits.actorH}h (error ${pct(oldPre.point, F.installLast.exits.actorH)}; live trader return ${pre.liveReturnPerHour}/h calibrated to it — ${pre.liveReturnWhy.slice(0, 80)}...)`);
console.log(`CHECK post mean ${oldPost.mean.toFixed(2)}h vs the plan's recorded ${F.plan.exit.meanH}h (error ${pct(oldPost.mean, F.plan.exit.meanH)})`);
console.log(`the gate the draws hung on: realised fit before the install ${N.realisedCapital(ROWS.filter((r) => r.at < F.installLast.at)) ? "priced" : "NULL"}; after ${(fitPost.r * 3600).toFixed(3)}/h; the trader posterior ${tpPost.perHour.mean.toFixed(3)}/h`);
console.log(`\nATTRIBUTION (old estimators): pre 'now' point ${oldPre.point.toFixed(2)}h mean ${oldPre.mean.toFixed(2)}h -> post point ${oldPost.point.toFixed(2)}h mean ${oldPost.mean.toFixed(2)}h (+${ELAPSED_H.toFixed(2)}h elapsed)`);
const groups = [
  ["post-install cash + book (the install resets both)", {}],
  ["graft carry (the 24 committed, both sides)", { inputs: { finalGrafts: POST.finalGrafts, graftStartMoney: POST.graftStartMoney } }],
  ["trader point: realised fit 1.75/h for live 1.2/h", { inputs: { capitalReturnPerSec: POST.capitalReturnPerSec, capitalWarmupH: POST.capitalWarmupH } }],
  ["trader draws: posterior 0.39/h for none", { trader: tpPost.perSec }],
  ["exp posterior: 75/s @180 (money) for 550/s @223 (farm)", { inputs: { expPerSec: (POST.expPerSec * (pre.hacking + 50)) / (POST.hacking + 50) } }],
  ["income posterior (age 0.42h for 0.83h)", { inputs: { incomePerSec: POST.incomePerSec, incomeFlatPerSec: POST.incomeFlatPerSec } }],
  ["cadence and life length: 4h @0.0119/h for 0.5h @0.0173/h", { inputs: { cycleHours: POST.cycleHours, multGainPerCycle: POST.multGainPerCycle } }],
  ["hacknet (rebuilt per life; this life's stream ends at the install)", { inputs: { lifeIncome: POST.lifeIncome, hacknet: POST.hacknet } }],
  ["gang (not in either side's inputs)", {}],
];
console.log(`${"group".padEnd(66)} ${"point".padStart(8)} ${"mean".padStart(8)}`);
for (const [name, g] of groups) {
  const r = price(preInputs(g.inputs ?? {}), { wait: 0, trader: g.trader ?? null, seed: SEED_PRE });
  console.log(`${name.padEnd(66)} ${f2(r.point - oldPre.point).padStart(8)} ${f2(r.mean - oldPre.mean).padStart(8)}`);
}

// The fix: one belief, both sides.
const bPre = P.traderBeliefOf(ROWS.filter((r) => r.at < "2026-09-29T16:12:09"));
const bPost = P.traderBeliefOf(ROWS);
const cash = N.postInstallMoney(9) + O.ONEOFF_EFFECTS["CashRoot Starter Kit"].startingMoney;
const fx = (b) => ({ capitalReturnPerSec: b.r, capitalWarmupH: b.warmupH, installCash: cash });
const newPre = price(preInputs(fx(bPre)), { wait: 0, trader: bPre.post.perSec, seed: SEED_POST });
const newPost = price({ ...POST, ...fx(bPost) }, { trader: bPost.post.perSec, seed: SEED_POST });
const newPostFarm = price({ ...POST, ...fx(bPost), expPerSec: (pre.expPerSec * (POST.hacking + 50)) / (pre.hacking + 50) }, { trader: bPost.post.perSec, seed: SEED_POST });
console.log(`\nFIXED (one trader belief ${(bPre.r * 3600).toFixed(3)}/h -> ${(bPost.r * 3600).toFixed(3)}/h, install cash $${cash}, common draws):`);
console.log(`  pre 'now' point ${newPre.point.toFixed(2)}h mean ${newPre.mean.toFixed(2)}h; post point ${newPost.point.toFixed(2)}h mean ${newPost.mean.toFixed(2)}h: gap ${f2(newPost.mean - (newPre.mean - ELAPSED_H))}h; with the farm on ${f2(newPostFarm.mean - (newPre.mean - ELAPSED_H))}h`);

// The cadence: install now vs wait, the same batch (a lower bound on what a wait buys).
for (const [label, over, tr] of [["old", {}, null], ["fixed", fx(bPre), bPre.post.perSec]]) {
  const row = [0, 0.25, 0.5, 1, 2, 4].map((w) => `w${w} ${price(preInputs(over), { wait: w, trader: tr, seed: SEED_PRE }).mean.toFixed(2)}`);
  console.log(`cadence (${label}): ${row.join("  ")}`);
}
// What one more hour buys: the exit's sensitivity to the hacking multiplier.
const d1 = price(preInputs({ ...fx(bPre), installGains: { ...pre.batchGains, hacking: pre.batchGains.hacking * 1.01 } }), { wait: 0, trader: bPre.post.perSec, seed: SEED_PRE });
const d0 = price(preInputs(fx(bPre)), { wait: 0, trader: bPre.post.perSec, seed: SEED_PRE });
console.log(`one more NeuroFlux level (+1% hacking) in the batch: ${f2(d1.mean - d0.mean)}h — a wait pays when it buys more than its hours in these`);
