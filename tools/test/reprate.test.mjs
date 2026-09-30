// [RR] THE GROUND REPUTATION LEG IS PRICED AT THE PLAYER'S FACTION-WORK RATE.
//
// Live BN9 2026-09-30 (fixture-bn9-reprate-1756.json): the 17:35:58Z install
// priced "install now" at 7.96h. The new life's work slot went to GRAFTING
// (act.js ran the graft at 17:51:08Z; 5 grafts, 6.67h of slot). From 17:51Z
// the exit inputs' repPerSec read 5.96/s: planFactionWork's one-pass
// reputation delta at the last-worked faction (BitRunners, worked for a few
// minutes from 17:46:22Z before the graft took the slot) — i.e. what every
// joined faction gains with nobody working it (contracts, the Go favor
// stream: ~6-7/s at all ten). 140a69b's median-of-the-last-hour held it,
// 9d02320's plan rep buffer drew from it, and the exit's final grind was
// priced at it: exit reputation 2.7h -> 14.4h, the new life at 21.2h against
// the install's 7.6h (EXIT JUMP AT INSTALL, +13.6h at 0.33h). The 17:51Z pass
// re-decided on it (the purchase model found lives of 2-6h buying nothing at
// 5.96/s: L2 "no longer priced" -> L8; the graft set 4 -> 5, all this life).
// At 18:06Z Daedalus was joined, the join money leg vanished, and the ground
// leg's first step was sized off the level-1 rate after the install: the
// committed exit 22.1h -> 39.9h with no event (EXIT UNSTABLE; +33h jump).
//
//   RR1 THE INCIDENT REPRODUCED   on the recorded inputs the committed
//                                 trajectory reads ~22h (recorded 21.2h) and
//                                 EXIT JUMP fails; the rep rate alone moves it
//                                 > 10h; the recorded 5.96/s is the median
//                                 incidental rate every faction gained
//   RR2 THE SAMPLE RULE           plan.repSampleOf: faction hacking work at
//                                 both ends, focused, one faction, one life,
//                                 no gap; the incidental rate taken off —
//                                 every recorded transition of this life is
//                                 refused, a synthetic faction-work interval
//                                 recovers k
//   RR3 THE POSTERIOR             bayes.repRatePosterior: formula x k; the
//                                 carry widened by one life's scatter; valid
//                                 samples move it by their hours; one short
//                                 interval does not (the median)
//   RR4 THE REPLAY                the fixed input at every pass 17:41-18:11 is
//                                 the formula x k (the save's faction_rep,
//                                 share 1) — near the faction-work rate while
//                                 grafting; the actor re-priced on it; EXIT
//                                 JUMP passes through 18:11 on the decisions
//                                 the fixed rate holds (17:46's), and the
//                                 17:51 re-decisions price later than them
//                                 under the fixed rate at every pass
//   RR5 THE STEP                  exitplan groundLeg: the 18:06 inputs
//                                 (Daedalus joined) within 3% of a 30000-step
//                                 integral at 6-60 rep/s; joined or not
//                                 agree within the hoard leg
//   RR6 THE DRAWS                 plan.applyDraw moves the rate by k's own sd
//                                 (inputs.repSdLn) and ignores a buffer's
//                                 absolute draw; posteriorsOf keeps only
//                                 faction-work observations; detourOf agrees
//   RR7 WIRING                    progress.js: the sample rule and the
//                                 posterior in planFactionWork on the snap-rep
//                                 work, the share-1 formula, the carry on the
//                                 install order, repSdLn in the exit inputs,
//                                 the plan's rep observations filtered

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const B = await import("../../bayes.js");
const E = await import("../../exitplan.js");
const T = await import("../../trajectory.js");
const BN = await import("../../bitNodeMultipliers.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-reprate-1756.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const fin = (x) => typeof x === "number" && isFinite(x);
const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);

// THE FORMULA at this life's multipliers (the save at 18:18Z, same life: no
// install since 17:35Z, the graft still running) and the pre-install life's
// (the batch's rep gain divided out: PCMatrix 1.0777 x NFG 1.01^9).
const NODE = BN.bitNodeMults(9);
const G = F.pre.inputs.installGains;
const formulaAt = (h, fr = F.player.faction_rep) => T.estimateBaseRepPerSec({ hacking: h, intelligence: F.player.intelligence, factionRepMult: fr, nodeWorkRepMult: NODE.FactionWorkRepGain, sharePower: 1 });
const formulaPre = (h) => formulaAt(h, F.player.faction_rep / G.rep);
// The pre-install life's k: its published (measured) rates in its last hour
// over the formula at their levels.
const preK = (() => {
  const end = Date.parse(F.installLast.at);
  const xs = F.preLifeMeasured.filter((m) => end - Date.parse(m.at) <= 3.6e6).map((m) => Math.log(m.repPerSec / formulaPre(m.hacking))).sort((a, b) => a - b);
  const med = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  return { mean: med, sd: B.PRIORS.rateSdLn * Math.sqrt(1 / 1), n: xs.length, at: F.installLast.at };
})();

const installAt = Date.parse(F.installLast.at);
const committedOf = (i) => {
  const prevPlan = i > 0 ? F.passes[i - 1].plan : F.pre.plan;
  return P.trajectoryOf(P.basisOf(prevPlan.decisions?.install ?? null, Date.parse(F.passes[i].at)), {});
};
const actorOf = (inputs) => E.bestExitPolicy({ ...inputs, firstInstallH: 0, nextInstallGain: inputs.installGains.hacking, persistBaseline: inputs.persistBaseline ?? inputs.installGains }, 400, 1).best.hours;
/** EXIT JUMP over the passes, as publishPlan carries it (point only). */
function jumpOver(rec, points) {
  let j = null;
  for (const p of points) j = P.exitJumpOf(rec, { pointH: p.h, n: 24 }, { lastAugReset: F.pre.inputs && F.passes[0].lastAugReset, now: Date.parse(p.at), prev: j });
  return j;
}

export async function run() {
  const checks = [];

  {
    const c = new Check("RR1", "THE INCIDENT REPRODUCED: the recorded passes' committed trajectory reads ~21-24h against the install's 7.6h (EXIT JUMP), the rep rate alone moves it > 10h, and the recorded 5.96/s is the incidental rate every joined faction gained");
    const pts = F.passes.map((p, i) => ({ at: p.at, h: committedOf(i)(p.inputs) }));
    for (const [i, p] of F.passes.entries()) c.note(`${p.at.slice(11, 19)}Z level ${p.inputs.hacking} rep ${p.inputs.repPerSec.toFixed(2)}/s -> committed point ${pts[i].h.toFixed(2)}h (recorded exit ${p.plan.exit?.meanH}h, ${p.plan.exit?.source})`);
    const j = jumpOver(F.installLast, pts);
    c.note(j.why.slice(0, 260));
    if (j.ok !== false) c.fail(`EXIT JUMP must fail on the recorded inputs: ${j.why}`);
    const at56 = F.passes.find((p) => p.at.startsWith("2026-09-30T17:56"));
    const i56 = F.passes.indexOf(at56);
    const h0 = committedOf(i56)(at56.inputs);
    const h1 = committedOf(i56)({ ...at56.inputs, repPerSec: formulaAt(at56.inputs.hacking) });
    c.note(`17:56Z: rep 5.96/s -> the formula's ${formulaAt(at56.inputs.hacking).toFixed(2)}/s moves the point ${f2(h1 - h0)}h`);
    if (!(h0 - h1 > 10)) c.fail(`the rep rate must be the jump (> 10h at 17:56Z): ${h0} -> ${h1}`);
    // The recorded sample against what every faction gained 17:56Z -> 18:11Z.
    const a = F.factionplan.at1756, b = F.factionplan.at1811;
    const dt = (Date.parse(b.at) - Date.parse(a.at)) / 1000;
    const per = Object.keys(a.reps).filter((f) => fin(b.reps[f])).map((f) => ({ f, v: (b.reps[f] - a.reps[f]) / dt / (1 + (a.favors[f] ?? 0) / 100) })).sort((x, y) => x.v - y.v);
    const med = per[Math.floor(per.length / 2)].v;
    c.note(`17:56Z -> 18:11Z, grafting, nobody working a faction: base rep/s ${per.map((x) => `${x.f} ${x.v.toFixed(2)}`).join(", ")}; median ${med.toFixed(2)}; the recorded 'measured' ${a.measuredBaseRepPerSec.toFixed(2)} (${a.baseRepWhy})`);
    if (!(a.workingFaction === null && Math.abs(a.measuredBaseRepPerSec - 5.964) < 0.01)) c.fail(`the record must hold the 5.96 sample with no faction worked: ${a.workingFaction} ${a.measuredBaseRepPerSec}`);
    if (!(a.measuredBaseRepPerSec < 3 * med && a.measuredBaseRepPerSec > med / 3)) c.fail(`the recorded rate must be the incidental rate's size (x3): ${a.measuredBaseRepPerSec} vs ${med}`);
    c.examined(F.passes.length + per.length);
    checks.push(c);
  }

  {
    const c = new Check("RR2", "THE SAMPLE RULE (plan.repSampleOf): faction hacking work at both ends, focused, one faction, one life, no gap, the incidental rate off — every recorded transition of this life is refused; a synthetic faction-work interval recovers k");
    const a = F.factionplan.at1756, b = F.factionplan.at1811;
    const graft = { type: "GRAFTING", faction: null, workType: null, focused: true };
    const rec = (fp, work, formula) => ({ at: fp.at, lastAugReset: fp.lastAugReset, work, reps: fp.reps, favors: fp.favors, formula });
    const fA = formulaAt(F.passes.find((p) => p.at.startsWith("2026-09-30T17:56")).inputs.hacking);
    const fB = formulaAt(F.passes.at(-1).inputs.hacking);
    const cases = [];
    // Recorded: grafting at both ends.
    cases.push(["17:56Z -> 18:11Z grafting at both ends", P.repSampleOf(rec(a, graft, fA), rec(b, graft, fB)), false]);
    // Recorded: 17:46Z no work (the work order ran at 17:46:22Z), 17:51Z BitRunners.
    const br = { type: "FACTION", faction: "BitRunners", workType: "hacking", focused: true };
    cases.push(["17:46Z no work -> 17:51Z BitRunners", P.repSampleOf({ ...rec(a, null, fA), at: "2026-09-30T17:46:01.000Z" }, { ...rec(b, br, fB), at: "2026-09-30T17:51:01.650Z" }), false]);
    // Faction work at the end, grafting at the start (and the reverse).
    cases.push(["grafting -> BitRunners", P.repSampleOf(rec(a, graft, fA), rec(b, br, fB)), false]);
    cases.push(["BitRunners -> grafting", P.repSampleOf(rec(a, br, fA), rec(b, graft, fB)), false]);
    // Hypothetically on BitRunners at both ends over the recorded reps: what it gained is what every faction gained.
    const hyp = P.repSampleOf(rec(a, br, fA), rec(b, br, fB));
    cases.push(["BitRunners at both ends, the recorded reps (incidental only)", hyp, hyp.ok ? "tiny" : false]);
    // Synthetic faction work: BitRunners gains the formula x k x (1 + favor) on top of the recorded reps.
    const k = 0.9;
    const dt = (Date.parse(b.at) - Date.parse(a.at)) / 1000;
    const fav = a.favors.BitRunners;
    const synth = { ...b.reps, BitRunners: b.reps.BitRunners + ((k * (fA + fB)) / 2) * (1 + fav / 100) * dt };
    const good = P.repSampleOf(rec(a, br, fA), { ...rec(b, br, fB), reps: synth });
    cases.push(["synthetic: BitRunners worked at k 0.9", good, true]);
    cases.push(["unfocused", P.repSampleOf(rec(a, { ...br, focused: false }, fA), { ...rec(b, { ...br, focused: false }, fB), reps: synth }), false]);
    cases.push(["field work", P.repSampleOf(rec(a, { ...br, workType: "field" }, fA), { ...rec(b, { ...br, workType: "field" }, fB), reps: synth }), false]);
    cases.push(["the slot moved faction", P.repSampleOf(rec(a, { ...br, faction: "NiteSec" }, fA), { ...rec(b, br, fB), reps: synth }), false]);
    cases.push(["another life", P.repSampleOf({ ...rec(a, br, fA), lastAugReset: 1 }, { ...rec(b, br, fB), reps: synth }), false]);
    cases.push(["a > 1h gap", P.repSampleOf({ ...rec(a, br, fA), at: "2026-09-30T16:00:00.000Z" }, { ...rec(b, br, fB), reps: synth }), false]);
    for (const [name, r, want] of cases) {
      c.note(`${name}: ${r.ok ? "SAMPLE" : "refused"} — ${r.why}`);
      if (want === true && !r.ok) c.fail(`${name} must be a sample: ${r.why}`);
      if (want === false && r.ok) c.fail(`${name} must be refused: ${r.why}`);
      if (want === "tiny" && !(r.sample.v < 0.1 * fA)) c.fail(`${name}: with nobody working, the sample must be ~0, not ${r.sample.v}`);
    }
    if (good.ok && Math.abs(Math.exp(good.sample.lnK) - k) > 0.03) c.fail(`the synthetic interval must recover k ${k}: ${Math.exp(good.sample.lnK)}`);
    c.examined(cases.length);
    checks.push(c);
  }

  {
    const c = new Check("RR3", "THE POSTERIOR (bayes.repRatePosterior): formula x k; the carry widened by one life's scatter; valid samples move it by their hours; one short interval does not (the median)");
    const f = 60;
    const p0 = B.repRatePosterior({ formula: f });
    const pc = B.repRatePosterior({ formula: f, carried: { mean: Math.log(0.9), sd: 0.1, at: "x" } });
    const S = (k, h, n) => Array.from({ length: n }, (_, i) => ({ at: `t${i}`, lnK: Math.log(k), h }));
    const p1 = B.repRatePosterior({ formula: f, carried: { mean: Math.log(0.9), sd: 0.1 }, samples: S(1.2, 5 / 60, 12) });
    const p2 = B.repRatePosterior({ formula: f, carried: { mean: Math.log(0.9), sd: 0.1 }, samples: [...S(1.2, 5 / 60, 12), { at: "short", lnK: Math.log(0.1), h: 5 / 60 }] });
    const pn = B.repRatePosterior({ formula: null });
    c.note(`no carry: ${p0.perSec.toFixed(2)}/s (k ${p0.k}, sd ${p0.sd}); carried k 0.9 sd 0.1: ${pc.perSec.toFixed(2)}/s sd ${pc.sd.toFixed(3)}; + 1h of k 1.2: ${p1.perSec.toFixed(2)}/s (weight ${(100 * p1.measuredWeight).toFixed(0)}%); + one 5-min 0.1: ${p2.perSec.toFixed(2)}/s`);
    if (!(p0.k === 1 && p0.perSec === f && p0.source === "formula" && p0.sd === B.PRIORS.repEstimateSdLn)) c.fail(`no carry, no sample: the formula itself: ${JSON.stringify(p0)}`);
    if (!(Math.abs(pc.k - 0.9) < 1e-9 && Math.abs(pc.sd - Math.hypot(0.1, B.PRIORS.carryLifeSdLn)) < 1e-9 && pc.source === "carried")) c.fail(`the carry: k 0.9, sd widened by one life: ${JSON.stringify(pc)}`);
    if (!(p1.k > 0.9 && p1.k < 1.2 && p1.measuredWeight > 0.2 && p1.n === 12)) c.fail(`an hour of samples moves k toward 1.2 by its weight: ${p1.k}`);
    if (!(Math.abs(p2.k - p1.k) / p1.k < 0.05)) c.fail(`one short interval must not move the median-based posterior (> 5%): ${p1.k} -> ${p2.k}`);
    if (pn !== null) c.fail("no formula: null, never a number");
    c.examined(5);
    checks.push(c);
  }

  {
    const c = new Check("RR4", "THE REPLAY: the fixed input 17:41-18:11 is the formula x k near the faction-work rate while grafting; EXIT JUMP passes through 18:11 against the actor re-priced on it, on the decisions the fixed rate holds (17:46's) — and the 17:51 re-decisions price later than those under the fixed rate at every pass");
    const held = F.passes.find((p) => p.at.startsWith("2026-09-30T17:46")).inputs;
    const heldTraj = P.trajectoryOf(null, {});
    let examined = 0;
    for (const [label, carried] of [["the formula prior (no carry)", null], [`the pre-install life's k ${Math.exp(preK.mean).toFixed(3)} (${preK.n} measured rates in its last hour)`, preK]]) {
      // The pre side: the install actor on the fixed rate (the carried k, the pre life's formula at 2934).
      const prePost = B.repRatePosterior({ formula: formulaPre(F.pre.inputs.hacking), carried: carried && { ...carried, sd: 1e-9 }, lifeSdLn: 0 });
      const preInputs = { ...F.pre.inputs, repPerSec: prePost.perSec, repSdLn: prePost.sd };
      const actorRecorded = actorOf(F.pre.inputs);
      const actorFixed = actorOf(preInputs);
      c.note(`${label}: the actor's rep ${F.pre.inputs.repPerSec.toFixed(2)}/s (formula with the share bonus of 17:35Z) -> ${prePost.perSec.toFixed(2)}/s; actor ${actorRecorded.toFixed(3)}h (recorded ${F.installLast.exits.actorH}h) -> ${actorFixed.toFixed(3)}h`);
      if (Math.abs(actorRecorded - F.installLast.exits.actorH) > 0.1) c.fail(`CHECK: the actor's replay must reproduce the recorded ${F.installLast.exits.actorH}h: ${actorRecorded}`);
      const rec = { ...F.installLast, exits: { ...F.installLast.exits, actorH: +actorFixed.toFixed(3) } };
      // The post side: every pass's samples refused (RR2), so the posterior is the prior at the pass's formula.
      const pts = [];
      for (const [i, p] of F.passes.entries()) {
        const post = B.repRatePosterior({ formula: formulaAt(p.inputs.hacking), carried, samples: [] });
        const x = { ...p.inputs, repPerSec: post.perSec, repSdLn: post.sd };
        const recIn = committedOf(i)(x);
        const heldIn = heldTraj({ ...x, cycleHours: held.cycleHours, multGainPerCycle: held.multGainPerCycle, lifeGrafts: held.lifeGrafts, finalGrafts: held.finalGrafts });
        const redecided = i >= 2;
        pts.push({ at: p.at, h: redecided ? heldIn : recIn });
        const faction = formulaAt(p.inputs.hacking) * Math.exp(preK.mean);
        c.note(`  ${p.at.slice(11, 19)}Z level ${p.inputs.hacking}: rep ${p.inputs.repPerSec.toFixed(2)} -> ${post.perSec.toFixed(2)}/s (faction-work rate ${faction.toFixed(2)}/s, x${(post.perSec / faction).toFixed(3)}); point on the recorded decisions ${recIn.toFixed(2)}h, on 17:46's ${heldIn.toFixed(2)}h${redecided ? " (used)" : ""}`);
        if (Math.abs(Math.log(post.perSec / faction)) > Math.log(1.15)) c.fail(`${p.at}: the fixed input must stay within 15% of the faction-work rate while grafting: ${post.perSec} vs ${faction}`);
        if (redecided && !(heldIn < recIn)) c.fail(`${p.at}: under the fixed rate the 17:51 re-decisions (L8, 5 grafts this life) must price later than 17:46's: ${recIn} vs ${heldIn}`);
        examined++;
      }
      const j = jumpOver(rec, pts);
      c.note(`  ${j.why.slice(0, 240)}`);
      if (j.ok !== true) c.fail(`${label}: EXIT JUMP must pass on the replay: ${j.why}`);
    }
    c.examined(examined);
    checks.push(c);
  }

  {
    const c = new Check("RR5", "THE STEP (exitplan groundLeg): the 18:06 inputs (Daedalus joined, no join leg before the grind) within 3% of a 30000-step integral at 6-60 rep/s, and joined or not agree within the hoard leg");
    const x = F.passes.find((p) => p.at.startsWith("2026-09-30T18:06")).inputs;
    let n = 0;
    for (const rep of [5.96, 30, 60]) {
      const leg = (o) => (E.exitHours({ ...x, repPerSec: rep, ...o }, 1).legs ?? []).find((l) => l.leg === "exit reputation")?.hours;
      const h = leg({});
      const ref = leg({ repSteps: 30000 });
      const jm = leg({ joinMoney: 1e11 });
      c.note(`rep ${rep}/s: 1-install rep leg ${h.toFixed(2)}h (30000 steps ${ref.toFixed(2)}h, ${f2((100 * (h - ref)) / ref)}%); with the $100b join leg ${jm.toFixed(2)}h`);
      if (!(Math.abs(h - ref) / ref < 0.03)) c.fail(`rep ${rep}: the default step must be within 3% of the fine integral: ${h} vs ${ref}`);
      if (!(Math.abs(h - jm) < 0.5)) c.fail(`rep ${rep}: joined or not must agree within the hoard leg: ${h} vs ${jm}`);
      n++;
    }
    c.examined(n);
    checks.push(c);
  }

  {
    const c = new Check("RR6", "THE DRAWS: plan.applyDraw moves the rate by k's own sd (inputs.repSdLn) and ignores a buffer's absolute draw; posteriorsOf keeps only faction-work observations; detourOf agrees");
    const at = (i) => new Date(Date.parse("2026-09-30T17:40:00Z") + i * 3e5).toISOString();
    const untagged = Array.from({ length: 6 }, (_, i) => ({ at: at(i), v: 5.964, ver: "v", boot: 1 }));
    const post = P.posteriorsOf({ obs: { rep: untagged } });
    if (post.rep !== null) c.fail(`untagged (published-rate) observations must not make a rep posterior: ${JSON.stringify(post.rep)}`);
    const tagged = untagged.map((o) => ({ ...o, v: 60, work: "faction" }));
    const post2 = P.posteriorsOf({ obs: { rep: tagged } });
    if (!post2.rep) c.fail("faction-work observations must make one");
    const draws = P.makeDraws({ ...post2, gymSdLn: 0.1 }, 24, 7);
    const base = { repPerSec: 66, repSdLn: 0.2 };
    const got = draws.map((d) => P.applyDraw(base, d).repPerSec);
    const want = draws.map((d) => 66 * Math.exp(0.2 * d.zRep));
    const bad = got.filter((g, i) => Math.abs(g - want[i]) > 1e-9).length;
    c.note(`24 draws: repPerSec = 66 x exp(0.2 z): ${bad} mismatched; median ${[...got].sort((a, b) => a - b)[12].toFixed(2)}; the buffer's absolute draws (ignored) median ${[...draws.map((d) => d.repRate)].sort((a, b) => a - b)[12].toFixed(2)}`);
    if (bad) c.fail(`applyDraw must use repSdLn x zRep: ${bad} of 24 differ`);
    const route = { joinH: 1, grindH: 4 };
    const dd = draws.map((d) => P.detourOf(route, d, 66, 0.2) - (1 * d.gymMult + 4 / Math.exp(0.2 * d.zRep)));
    if (dd.some((v) => Math.abs(v) > 1e-9)) c.fail("detourOf must move the grind by the same residual");
    c.examined(24 + 2);
    checks.push(c);
  }

  {
    const c = new Check("RR7", "WIRING: progress.js's planFactionWork takes samples by the work rule on the snap-rep work and prices the posterior on the share-1 formula; the exit inputs carry repSdLn; the install order carries k; the plan's rep observations are faction work only");
    const src = code("progress.js");
    const need = [
      [/const repSample = repSampleOf\(/, "planFactionWork samples through plan.repSampleOf"],
      [/const w = sing\.currentWork\(\)/, "the work is the snap-rep snapshot's (sing.currentWork)"],
      [/const repPost = repRatePosterior\(\{ formula: formulaNow, carried: repCarry, samples: repSamples \}\)/, "the rate is the posterior"],
      [/let base = repPost \? repPost\.perSec : null/, "the base rate is the posterior's"],
      [/baseRepFormula: estimateBaseRepPerSec\(\{[^}]*sharePower: 1,/, "the posterior's formula is at share 1"],
      [/installCarryOf\(readJson\(ns, '\/tel\/install-last\.txt'\), info\?\.lastAugReset\)\?\.rep/, "the carry comes from the install"],
      [/rep: schedule\?\.repPost\?\.carryable/, "the install order carries k"],
      [/repSdLn: schedule\.repPost\.sd/, "the exit inputs carry k's sd"],
      [/rep: repObsOf\(ns, info, pc\.obs\?\.rep, at\)/, "the plan's rep observations are the valid samples"],
      [/work: 'faction'/, "tagged as faction work"],
    ];
    for (const [re, what] of need) if (!re.test(src)) c.fail(`progress.js: ${what}`);
    if (/if \(dt > 5 && dr > 0\) base = dr \/ dt/.test(src)) c.fail("the one-pass delta at the last-worked faction must not be the rate");
    if (!/o\?\.work === 'faction'/.test(code("plan.js"))) c.fail("plan.posteriorsOf must keep faction-work observations only");
    c.examined(need.length + 2);
    checks.push(c);
  }

  return checks;
}
