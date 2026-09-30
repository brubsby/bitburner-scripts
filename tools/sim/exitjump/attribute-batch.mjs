// INSTALLED A DIFFERENT BATCH — the proving record (live BN9 2026-09-30, 08:19:55Z install).
//
//   node tools/sim/exitjump/attribute-batch.mjs [fixture.json]
//
// The install gate priced "install 12 augmentations now" at 19.66h (plan 'now'
// mean 19.52h); the purchase step ordered 8 (ADR-V2 Pheromone Gene and three
// NeuroFlux levels were never ordered) and act.js installed them; the next
// life priced its committed trajectory at a point of 53.49h (mean 20.66h) —
// EXIT JUMP AT INSTALL +33.9h. This replays both points from
// tools/test/fixture-bn9-batch-0819.json and swaps the input groups one at a
// time (pre side, 'install now', with each group taken from the new life), and
// then cumulatively, so the chain closes on the new life's own point.
//
// CALIBRATION: the CHECK lines reproduce the two recorded points first.
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const E = await import(path.join(REPO_ROOT, "exitplan.js"));

const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);

// THE BATCH ACTUALLY INSTALLED: the 12 priced less ADR-V2 (faction_rep x1.2,
// no hacking/exp/money) and three NeuroFlux levels (each x(1.01+bonus) on
// every channel). The level's factor is read off the game: the new life's
// hacking multiplier over the old one is the 8 augmentations' hacking gain.
export function boughtGainsOf(F) {
  const pre = F.pre.exitinputs.inputs;
  const post = F.post.exitinputs.inputs;
  const g12 = pre.installGains;
  const hack8 = post.hackingMult / pre.hackingMult;
  const nfg = Math.pow(g12.hacking / hack8, 1 / 3);
  const growShare = 0.3648068669527897; // installgate objective.growShare at 08:19:37
  return { hacking: hack8, rep: g12.rep / (1.2 * Math.pow(nfg, 3)), income: g12.income / (Math.pow(nfg, 9) * Math.pow(Math.pow(nfg, 3), growShare)), exp: g12.exp / Math.pow(nfg, 3), nfgLevel: nfg };
}
export function pointOf(inputs, { wait = 0, gains = undefined } = {}) {
  const g = gains === undefined ? inputs.installGains : gains;
  const x = { ...inputs, ...(wait === null ? {} : { firstInstallH: wait }), ...(g ? { installGains: g, nextInstallGain: g.hacking, persistBaseline: inputs.persistBaseline ?? g } : { installGains: null, nextInstallGain: null }) };
  const r = E.bestExitPolicy(x, 400, 1);
  return r.best ?? null;
}
// Groups: the new life's value of each, swapped into the pre-install 'now'.
export const GROUPS = [
  ["cash + book (the batch spends it; the install resets the trader)", ["money", "capitalCap", "capitalReturnPerSec", "capitalScaleW", "capitalShape", "capitalWarmupH", "installCash"]],
  ["cadence: the purchase model's life length and per-life gain", ["cycleHours", "multGainPerCycle", "cadenceRateMedian"]],
  ["fresh-life ramp: exp posterior, the formula's hacking stream", ["expPerSec", "freshExpLagH", "freshHackCum", "expScalesWithLevel"]],
  ["income posterior (measured life 4 -> formula at age 0.08h)", ["incomePerSec", "incomeFlatPerSec", "flatIncomePerSec", "lifeIncome"]],
  ["reputation: rate, contracts, Go favour", ["repPerSec", "eBudget", "contractRep", "favorStream", "exitRep", "exitFavor"]],
  ["carried streams: gang, sleeves, hacknet", ["carriedIncome", "freshHacknet", "hacknet"]],
  ["grafts carried (the committed set, re-searched in the new life)", ["finalGrafts", "lifeGrafts", "graftStartMoney"]],
];
const take = (base, keys, from) => {
  const o = { ...base };
  for (const k of keys) {
    if (from[k] === undefined) delete o[k];
    else o[k] = from[k];
  }
  return o;
};
export function attribution(F) {
  const pre = F.pre.exitinputs.inputs;
  const post = F.post.exitinputs.inputs;
  const b8 = boughtGainsOf(F);
  const g8 = { hacking: b8.hacking, rep: b8.rep, income: b8.income, exp: b8.exp };
  const p12 = pointOf(pre).hours;
  const p8 = pointOf(pre, { gains: g8 }).hours;
  const postPoint = pointOf(post, { wait: 0, gains: null }).hours;
  const one = GROUPS.map(([name, keys]) => ({ name, dH: pointOf(take(pre, keys, post), { gains: g8 }).hours - p8 }));
  let cur = { ...pre };
  let last = p8;
  const chain = [];
  for (const [name, keys] of GROUPS) {
    cur = take(cur, keys, post);
    const h = pointOf(cur, { gains: g8 }).hours;
    chain.push({ name, h, dH: h - last });
    last = h;
  }
  // The life state: the multiplier the batch installed, the reset level and exp — no first install.
  const state = { ...cur, hacking: post.hacking, hackingExp: post.hackingExp, hackingMult: post.hackingMult };
  const hs = pointOf(state, { wait: 0, gains: null }).hours;
  chain.push({ name: "the install itself: the new life's level, exp and multiplier (no first install)", h: hs, dH: hs - last });
  return { p12, p8, postPoint, g8, one, chain };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const F = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-batch-0819.json"), "utf8"));
  const PRE = F.pre.exitinputs.inputs;
  const POST = F.post.exitinputs.inputs;
  const il = F.installLast;
  const A = attribution(F);
  console.log(`CHECK pre 'now' (12 priced) point ${A.p12.toFixed(2)}h vs the actor's recorded ${il.exits.actorH}h`);
  console.log(`CHECK post point ${A.postPoint.toFixed(2)}h vs the new life's recorded ${F.post.plan.exitJump.first.pointH}h`);
  console.log(`\nTHE BATCH: priced 12 -> ${A.p12.toFixed(2)}h; the 8 bought (hacking x${A.g8.hacking.toFixed(3)}, rep x${A.g8.rep.toFixed(3)}, income x${A.g8.income.toFixed(3)}, exp x${A.g8.exp.toFixed(3)}) -> ${A.p8.toFixed(2)}h: ${f2(A.p8 - A.p12)}h`);
  console.log(`\nONE AT A TIME on the 8-aug 'now' (${A.p8.toFixed(2)}h):`);
  for (const r of A.one) console.log(`  ${r.name.padEnd(72)} ${f2(r.dH).padStart(8)}h`);
  console.log(`\nCUMULATIVE (closes on the new life's point):`);
  for (const r of A.chain) console.log(`  ${r.name.padEnd(72)} ${f2(r.dH).padStart(8)}h  -> ${r.h.toFixed(2)}h`);
  // The cadence the purchase model would choose with the batch out of its catalogue.
  const cad = (inp) => inp.cadence?.table?.map((r) => `L${r.L} x${r.gain} $${(r.money / 1e9).toFixed(1)}b H${r.H}`).join("  ");
  console.log(`\npre cadence table:  ${cad(PRE)}`);
  console.log(`post cadence table: ${cad(POST)}`);
}
