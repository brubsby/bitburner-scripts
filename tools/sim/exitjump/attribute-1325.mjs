// EXIT JUMP AT INSTALL, the +10h residual — the proving record (live BN9 2026-09-30, 13:25:15Z install).
//
//   node tools/sim/exitjump/attribute-1325.mjs [fixture.json] [--split GROUP]
//
// The batch was right (17 of 17 priced and bought); the actor priced "install
// now" at 14.88h (plan 'now' mean 15.87h); the new life priced its committed
// trajectory at a point of 25.10h (mean 26.51h) 0.085h later: +10.3h.
//
// THE FRAME. The pre-install inputs describe the OLD life (level 1811, its
// measured rates) and the install's simulation carries them into the new
// life: exp rate x the batch's exp gain x (level + 50) / (1811 + 50), ground
// reputation x the batch's rep gain x level / 1811, the scripts' income at
// level 1 x the batch's money gain, the gang's forecast by node hours, the
// grafts one life earlier. `projected(F)` writes exactly that as inputs of
// the new life at its first pass (its level, exp and multiplier from the
// game), so the pre side's model of the post-install state and the actual
// post-install inputs are the same KIND of inputs and swap group by group.
//
// CALIBRATION: the CHECK lines reproduce the two recorded points, and the
// projection's point against the actor's less the hours since (the frame
// carries the install's own simulation, nothing else).
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const E = await import(path.join(REPO_ROOT, "exitplan.js"));
const P = await import(path.join(REPO_ROOT, "plan.js"));
const B = await import(path.join(REPO_ROOT, "bayes.js"));

const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);

export function pointOf(inputs, { wait = 0, gains = undefined } = {}) {
  const g = gains === undefined ? inputs.installGains : gains;
  if (!g) {
    const x = { ...inputs };
    for (const k of ["installGains", "nextInstallGain", "persistBaseline", "firstInstallH"]) delete x[k];
    return E.bestExitPolicy(x).best ?? null;
  }
  return E.bestExitPolicy({ ...inputs, firstInstallH: wait, installGains: g, nextInstallGain: g.hacking, persistBaseline: inputs.persistBaseline ?? g }, 400, 1).best ?? null;
}

// The pre-install simulation's own new life, as inputs at the new life's first pass.
export function projected(F) {
  const pre = F.pre.exitinputs.inputs;
  const post = F.post.exitinputs.inputs;
  const g = pre.installGains;
  const dH = (Date.parse(F.post.exitinputs.at) - Date.parse(F.pre.exitinputs.at)) / 3.6e6;
  const L = post.hacking;
  const flat = pre.flatIncomePerSec ?? 0;
  const shift = (list) => {
    const s = list.map((x) => ({ atH: x.atH - dH, perSec: x.perSec }));
    const inForce = s.filter((x) => x.atH <= 0).pop();
    return [...(inForce ? [{ atH: 0, perSec: inForce.perSec }] : []), ...s.filter((x) => x.atH > 0)];
  };
  const x = { ...pre };
  for (const k of ["installGains", "nextInstallGain", "persistBaseline"]) delete x[k];
  Object.assign(x, {
    hacking: post.hacking,
    hackingExp: post.hackingExp,
    hackingMult: pre.hackingMult * g.hacking,
    money: pre.installCash,
    lifeIncome: null,
    expPerSec: (pre.expPerSec - (pre.expFlatPerSec ?? 0)) * g.exp * ((L + 50) / (pre.hacking + 50)) + (pre.expFlatPerSec ?? 0),
    repPerSec: pre.repPerSec * g.rep * (L / pre.hacking),
    incomePerSec: (((pre.incomePerSec - flat) * 51) / (pre.hacking + 50)) * g.income * ((L + 50) / 51) + flat,
    carriedIncome: Object.fromEntries(Object.entries(pre.carriedIncome ?? {}).map(([k, v]) => [k, shift(v)])),
    lifeGrafts: (pre.lifeGrafts ?? []).filter((z) => z.life > 1).map((z) => ({ ...z, life: z.life - 1 })),
  });
  return { x, dH };
}

export const GROUPS = [
  ["the committed life length L6 -> L8 (and its per-life gain)", ["cycleHours", "multGainPerCycle", "cadenceRateMedian", "cadence"]],
  ["exp posterior at age 0.08h", ["expPerSec", "expFlatPerSec", "expScalesWithLevel"]],
  ["reputation rate (measured x rep gain x level -> formula estimate)", ["repPerSec"]],
  ["income posterior (measured -> formula prior)", ["incomePerSec", "incomeFlatPerSec", "flatIncomePerSec"]],
  ["gang forecast ($0/s after the install)", ["carriedIncome"]],
  ["grafts (the set re-searched: Xanipher <-> nextSENS)", ["finalGrafts", "lifeGrafts", "graftStartMoney"]],
  ["hash contracts + Go favor", ["eBudget", "contractRep", "favorStream", "exitRep", "exitFavor"]],
  ["hacknet (this life's fleet, the final window's)", ["freshHacknet", "hacknet", "lifeIncome"]],
  ["trader book + cash", ["money", "capitalCap", "capitalReturnPerSec", "capitalScaleW", "capitalShape", "capitalWarmupH", "installCash"]],
  ["fresh-life ramp (exp lag)", ["freshExpLagH", "freshHackCum"]],
];
const take = (base, keys, from) => {
  const o = { ...base };
  for (const k of keys) {
    if (from[k] === undefined) delete o[k];
    else o[k] = from[k];
  }
  return o;
};
export function attribution(F, { groups = GROUPS } = {}) {
  const pre = F.pre.exitinputs.inputs;
  const post = F.post.exitinputs.inputs;
  const p0 = pointOf(pre).hours;
  const postPoint = pointOf(post, { gains: null }).hours;
  const { x: proj, dH } = projected(F);
  const pj = pointOf(proj, { gains: null }).hours;
  // A + group (the projection with the new life's group) and B - group (the new life with the projection's).
  const rows = groups.map(([name, keys]) => ({
    name,
    keys,
    up: pointOf(take(proj, keys, post), { gains: null }).hours - pj,
    dn: postPoint - pointOf(take(post, keys, proj), { gains: null }).hours,
  }));
  let cur = { ...proj };
  let last = pj;
  const chain = [];
  for (const [name, keys] of groups) {
    cur = take(cur, keys, post);
    const h = pointOf(cur, { gains: null }).hours;
    chain.push({ name, h, dH: h - last });
    last = h;
  }
  const rest = pointOf(post, { gains: null }).hours;
  chain.push({ name: "everything else", h: rest, dH: rest - last });
  return { p0, pj, dH, postPoint, rows, chain, proj };
}

// THE FIX, replayed: what the install would have carried (progress.js
// `carry` at the install order: the script exp posterior at its level and
// multiplier, the gang's carried stream) and what the new life's first pass
// builds from it with the shipped functions (plan.installCarryOf,
// bayes.carriedRatePrior, bayes.afterRamp, bayes.ratePosterior,
// plan.gangBridgeOf). The hacking_exp multiplier's ratio is the batch's exp
// gain (installGains.exp: NeuroFlux x14 is the batch's only hacking_exp).
// The running scripts' 33.8 exp/s at age 0.085h is the recorded observation.
export const OBS_EXP_PER_SEC = 33.8;
export function carryOf(F) {
  const pre = F.pre.exitinputs.inputs;
  const ep = F.pre.plan.posteriors.exp;
  const at = F.pre.exitinputs.at;
  return { at, exp: { perSec: ep.perSec, sdLn: ep.sdLn, level: pre.hacking, mult: 1, at }, gang: { steps: pre.carriedIncome.gang, at } };
}
export function withCarry(F, { carry = carryOf(F) } = {}) {
  const pre = F.pre.exitinputs.inputs;
  const post = F.post.exitinputs.inputs;
  const life = F.post.plan.lastAugReset;
  const now = Date.parse(F.post.exitinputs.at);
  const c = P.installCarryOf({ ...F.installLast, carry }, life);
  const prior = B.carriedRatePrior(c?.exp ?? null, { level: post.hacking, mult: pre.installGains.exp, what: "exp" });
  const obs = B.afterRamp({ perSec: OBS_EXP_PER_SEC, hours: (now - life) / 3.6e6, source: "the running scripts' exp" });
  const exp = prior ? B.ratePosterior(prior, obs, { what: "exp" }) : null;
  const bridge = P.gangBridgeOf(post.carriedIncome?.gang ?? null, c?.gang ?? null, { now, lifeStart: life });
  const inputs = { ...post, ...(exp ? { expPerSec: exp.perSec } : {}), ...(bridge ? { carriedIncome: { ...post.carriedIncome, gang: bridge.steps } } : {}) };
  return { inputs, exp, bridge, now, life, point: pointOf(inputs, { gains: null })?.hours ?? null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const fx = args.find((a) => a.endsWith(".json"));
  const F = JSON.parse(fs.readFileSync(fx ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-1325.json"), "utf8"));
  const il = F.installLast;
  const A = attribution(F);
  const pre = F.pre.exitinputs.inputs, post = F.post.exitinputs.inputs;
  console.log(`CHECK pre 'now' point ${A.p0.toFixed(2)}h vs the actor's recorded ${il.exits.actorH}h`);
  console.log(`CHECK post point ${A.postPoint.toFixed(2)}h vs the new life's recorded ${F.post.plan.exitJump.first.pointH}h`);
  console.log(`CHECK the projection (the install's own new life) ${A.pj.toFixed(2)}h vs the pre point less ${A.dH.toFixed(3)}h: ${(A.p0 - A.dH).toFixed(2)}h`);
  console.log(`\nrates at the new life's level ${post.hacking}: exp ${A.proj.expPerSec.toFixed(0)}/s -> ${post.expPerSec.toFixed(0)}/s; rep ${A.proj.repPerSec.toFixed(2)}/s -> ${post.repPerSec.toFixed(2)}/s; income $${(A.proj.incomePerSec / 1e3).toFixed(1)}k/s -> $${(post.incomePerSec / 1e3).toFixed(1)}k/s`);
  console.log(`\n${"group".padEnd(66)} ${"proj + group".padStart(12)} ${"post - group".padStart(12)}`);
  for (const r of A.rows) console.log(`  ${r.name.padEnd(64)} ${f2(r.up).padStart(12)} ${f2(r.dn).padStart(12)}`);
  console.log(`\nCUMULATIVE (from the projection ${A.pj.toFixed(2)}h; closes on the new life's point):`);
  for (const r of A.chain) console.log(`  ${r.name.padEnd(64)} ${f2(r.dH).padStart(8)}h  -> ${r.h.toFixed(2)}h`);
  const W = withCarry(F);
  console.log(`\nWITH THE FIX (the install's carry, the new life's first pass): exp ${W.exp.perSec.toFixed(0)}/s (${W.exp.why.slice(0, 90)}...); gang ${W.bridge ? `bridged, $${(W.bridge.steps[0].perSec / 1e6).toFixed(1)}m/s now` : "not bridged"}`);
  const j = P.exitJumpOf(il, { pointH: W.point, n: 24 }, { lastAugReset: W.life, now: W.now });
  console.log(`  post point ${W.point.toFixed(2)}h: ${j.why}`);
  if (args.includes("--split")) {
    const sp = args[args.indexOf("--split") + 1];
    const grp = GROUPS.find(([n]) => n.startsWith(sp));
    for (const k of grp[1]) console.log(`  ${k.padEnd(22)} ${f2(pointOf(take(A.proj, [k], post), { gains: null }).hours - A.pj).padStart(8)}h`);
  }
}
