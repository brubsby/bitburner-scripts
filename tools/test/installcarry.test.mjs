// [IC] WHAT THE INSTALL CARRIES: the next life's first exits price the
// trajectory the install priced.
//
// Live BN9 2026-09-30 13:25:15Z: 17 of 17 priced and bought (batchCheck ok);
// the actor priced "install now" at 14.88h (plan 'now' mean 15.87h); the new
// life's first pass (13:30:20Z, age 0.085h) priced its committed trajectory
// at a point of 25.10h (mean 26.51h) — EXIT JUMP AT INSTALL +10.3h against
// 3.77h. THE PROVING RECORD (fixture-bn9-exitjump-1325,
// tools/sim/exitjump/attribute-1325.mjs): the install's own simulation of
// the new life written as that life's inputs (the projection), swapped group
// by group with the actual post-install inputs, both directions:
//   exp posterior         +6.8h / +7.7h  the formula prior (4.9e3/s at age
//                         0.08h) with the running scripts' 34 exp/s (the
//                         fleet re-rooting) at 25% weight -> 1.4e3/s at
//                         level 468, where the install simulated 7.0e3/s
//   gang forecast         +10.6h / +1.1h gang.js $0/s over its whole 8h
//                         horizon (post-install respect mode, ~20 min); the
//                         install carried $126m/s rising. Masked on the post
//                         side by the income prior ($2.1m/s formula vs the
//                         install's $72k/s; -11h the other way)
//   life length L6 -> L8  +0.9h / +1.6h  (switched on the new life's first
//                         pass; on the carried inputs the rule holds L6)
//   reputation rate       +1.3h / +1.0h  (the old life's measured base rate
//                         per level 1.39x the game formula; the new life's
//                         formula estimate, and its own measurement at 0.17h)
//   grafts, contracts + Go favor, hacknet, trader, ramp: each < 0.6h
//
//   IC1 THE RECORD            both points replayed (pre 14.96h vs 14.88h,
//                             post 25.64h vs 25.10h); the projection prices
//                             the pre point less the elapsed hours; the
//                             attribution as above
//   IC2 THE FIX ON THE RECORD the new life built from the install's carry
//                             with the shipped functions: exp = the
//                             projection's rate, the gang bridged, the point
//                             and mean within EXIT JUMP's tolerance; the life
//                             length rule holds L6 on those inputs
//   IC3 THE PIECES            installCarryOf only for the life the install
//                             began; carriedRatePrior (the multiplier ratio,
//                             the level shape, sd); afterRamp; gangBridgeOf
//                             (grace, live money, the shift)
//   IC4 WIRING                progress.js: the install order carries `carry`
//                             (exp posterior + level + multiplier, the gang
//                             stream); expPostOf's prior is the carry's, its
//                             observation after the ramp; gangCarriedGen
//                             bridges before its own forecast; act.js copies
//                             `carry` into /tel/install-last.txt

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const B = await import("../../bayes.js");
const A = await import("../sim/exitjump/attribute-1325.mjs");
const R = await import("../sim/exitjump/lifelength.mjs");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-1325.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const rel = (a, b) => Math.abs(a / b - 1);

export async function run() {
  const out = [];
  const il = F.installLast;
  const life = F.post.plan.lastAugReset;
  const now = Date.parse(F.post.exitinputs.at);
  const elapsed = (now - Date.parse(il.at)) / 3.6e6;
  const post = F.post.exitinputs.inputs;
  const pre = F.pre.exitinputs.inputs;

  {
    const c = new Check("IC1", "the 13:25Z install's +10.3h reproduced and attributed on the captured passes");
    const X = A.attribution(F);
    c.examined(2 + X.rows.length);
    c.note(`pre 'now' ${X.p0.toFixed(2)}h (actor ${il.exits.actorH}h); post ${X.postPoint.toFixed(2)}h (recorded ${F.post.plan.exitJump.first.pointH}h); projection ${X.pj.toFixed(2)}h (pre less ${elapsed.toFixed(3)}h: ${(X.p0 - elapsed).toFixed(2)}h)`);
    if (rel(X.p0, il.exits.actorH) > 0.02) c.fail(`pre point ${X.p0.toFixed(2)}h is not the actor's ${il.exits.actorH}h (2%)`);
    if (rel(X.postPoint, F.post.plan.exitJump.first.pointH) > 0.03) c.fail(`post point ${X.postPoint.toFixed(2)}h is not the recorded ${F.post.plan.exitJump.first.pointH}h (3%)`);
    if (Math.abs(X.pj - (X.p0 - elapsed)) > 0.25) c.fail(`the projection ${X.pj.toFixed(2)}h is not the install's own simulation (${(X.p0 - elapsed).toFixed(2)}h)`, "projected() must carry the old life's rates into the new life exactly as exitHours does");
    const row = (s) => X.rows.find((r) => r.name.startsWith(s));
    for (const r of X.rows) c.note(`  ${r.name.padEnd(64)} ${r.up.toFixed(2).padStart(7)} ${r.dn.toFixed(2).padStart(7)}`);
    const exp = row("exp posterior");
    if (!(exp.up > 5 && exp.dn > 5)) c.fail(`the exp posterior is not the leading group both ways (${exp.up.toFixed(2)} / ${exp.dn.toFixed(2)})`);
    if (!(row("gang").up > 5)) c.fail(`the gang's $0 forecast alone is not > +5h on the projection (${row("gang").up.toFixed(2)})`);
    for (const r of X.rows.filter((r) => !/^(exp posterior|gang|income)/.test(r.name))) {
      if (Math.abs(r.up) > 2 || Math.abs(r.dn) > 2) c.fail(`${r.name}: ${r.up.toFixed(2)} / ${r.dn.toFixed(2)} — expected < 2h each way`);
    }
    out.push(c);
  }

  {
    const c = new Check("IC2", "the new life built from the install's carry prices the install's trajectory (EXIT JUMP within tolerance)");
    const W = A.withCarry(F);
    c.examined(4);
    const proj = A.projected(F).x;
    c.note(`exp ${W.exp.perSec.toFixed(0)}/s (projection ${proj.expPerSec.toFixed(0)}/s, published ${post.expPerSec.toFixed(0)}/s); gang ${W.bridge ? `$${(W.bridge.steps[0].perSec / 1e6).toFixed(1)}m/s bridged` : "NOT bridged"}; point ${W.point.toFixed(2)}h`);
    if (rel(W.exp.perSec, proj.expPerSec) > 0.01) c.fail(`the carried exp posterior ${W.exp.perSec.toFixed(0)}/s is not the rate the install simulated (${proj.expPerSec.toFixed(0)}/s)`);
    if (W.exp.measuredWeight !== 0) c.fail(`the ramp's 33.8 exp/s at age ${(elapsed).toFixed(3)}h entered the posterior (weight ${W.exp.measuredWeight})`);
    if (!W.bridge) c.fail("the gang's $0 forecast 0.08h into the life was not bridged");
    // The mean on the post plan's own draws, the exp posterior the fixed one.
    const ps = { ...F.post.plan.posteriors, exp: { perSec: W.exp.perSec, sdLn: W.exp.sd } };
    const draws = P.makeDraws(R.postOf(ps), 24, P.seedOf(life, 9));
    const traj = P.trajectoryOf(null, {});
    const hs = draws.map((d) => traj(P.applyDraw(W.inputs, d), d)).filter(Number.isFinite);
    const meanH = hs.reduce((a, b) => a + b, 0) / hs.length;
    const j = P.exitJumpOf(il, { pointH: W.point, meanH, n: 24 }, { lastAugReset: life, now });
    c.note(`mean ${meanH.toFixed(2)}h over ${hs.length} draws; ${j.why}`);
    if (j.ok !== true) c.fail(`EXIT JUMP AT INSTALL still fires on the carried inputs: ${j.why}`);
    const jOld = P.exitJumpOf(il, { pointH: F.post.plan.exitJump.first.pointH, meanH: F.post.plan.exit.meanH, n: 24 }, { lastAugReset: life, now });
    if (jOld.ok !== false) c.fail("the check no longer fails the recorded exits (25.10h / 26.51h)");
    // The life length on the carried inputs: the rule holds L6.
    const { opts } = R.optionsOf({ inputs: W.inputs, plan: F.post.plan, at: F.post.plan.at, lastAugReset: life, node: 9 });
    const dl = P.decideLifeLength({ options: opts, basis: null, prev: { key: "L6", decidedAt: F.pre.plan.at }, draws, redecide: true, now, budgetMs: 1e9, reachSd: F.post.plan.posteriors?.s ?? null });
    c.note(`life length on the carried inputs: ${dl.key} — ${dl.why.slice(0, 140)}`);
    if (dl.key !== "L6") c.fail(`the life length switched to ${dl.key} on the carried inputs`);
    out.push(c);
  }

  {
    const c = new Check("IC3", "installCarryOf, carriedRatePrior, afterRamp, gangBridgeOf");
    const carry = A.carryOf(F);
    const rec = { ...il, carry };
    const ok = (cond, what) => {
      c.examined(1);
      if (!cond) c.fail(what);
    };
    ok(P.installCarryOf(rec, life) === carry, "the carry of the install that began this life is not returned");
    ok(P.installCarryOf(rec, il.lastAugReset) === null, "the carry is returned in the life the install ENDED");
    ok(P.installCarryOf(rec, life + 11 * 60e3 + (Date.parse(il.at) - life)) === null, "a carry from an install 11 min away from the life's start is returned");
    ok(P.installCarryOf(il, life) === null, "a record without carry returns something");
    ok(P.installCarryOf(null, life) === null, "no record returns something");
    const pr = B.carriedRatePrior({ perSec: 1000, sdLn: 0.1, level: 950, mult: 2 }, { level: 450, mult: 3 });
    ok(Math.abs(pr.perSec - 1000 * 1.5 * (500 / 1000)) < 1e-9, `carriedRatePrior: ${pr.perSec} is not 1000 x 1.5 x 500/1000`);
    ok(Math.abs(pr.sd - Math.hypot(0.1, B.PRIORS.carryLifeSdLn)) < 1e-12, "carriedRatePrior's sd is not the carried sd with one life's scatter");
    ok(B.carriedRatePrior({ perSec: 1000, level: 950 }, { level: null }) === null, "carriedRatePrior priced without this life's level");
    ok(B.carriedRatePrior(null, { level: 5 }) === null, "carriedRatePrior priced without a carry");
    ok(B.afterRamp({ perSec: 1, hours: 0.2, source: "s" }) === null, "an observation inside the ramp survived");
    ok(Math.abs(B.afterRamp({ perSec: 1, hours: 1, source: "s" }).hours - (1 - B.PRIORS.freshRampH)) < 1e-12, "afterRamp does not count hours from the ramp's end");
    ok(B.afterRamp(null) === null, "afterRamp(null) is not null");
    const g = carry.gang;
    const at0 = Date.parse(g.at);
    const b1 = P.gangBridgeOf([{ atH: 0, perSec: 0 }], g, { now: at0 + 0.5 * 3.6e6, lifeStart: at0 });
    ok(b1 === null, "bridged at the end of the grace");
    const b2 = P.gangBridgeOf([{ atH: 0, perSec: 5e6 }], g, { now: at0 + 0.1 * 3.6e6, lifeStart: at0 });
    ok(b2 === null, "bridged over a live forecast with money");
    const b3 = P.gangBridgeOf([{ atH: 0, perSec: 0 }], g, { now: at0 + 1.5 * 3.6e6, lifeStart: at0 + 1.45 * 3.6e6 });
    ok(b3 && b3.steps[0].atH === 0 && b3.steps[0].perSec === g.steps[1].perSec && Math.abs(b3.steps[1].atH - (g.steps[2].atH - 1.5)) < 1e-9, `the carried stream is not shifted by the hours since it was built: ${JSON.stringify(b3?.steps?.slice(0, 2))}`);
    ok(P.gangBridgeOf(null, { steps: [{ atH: 0, perSec: 0 }], at: g.at }, { now: at0, lifeStart: at0 }) === null, "a carried stream with no money bridged");
    ok(P.gangBridgeOf(null, g, { now: at0, lifeStart: null }) === null, "bridged without the life's start");
    out.push(c);
  }

  {
    const c = new Check("IC4", "wiring: the install order carries, act.js records, the new life reads");
    const pj = code("progress.js");
    const aj = code("act.js");
    const has = (src, re, what) => {
      c.examined(1);
      if (!re.test(src)) c.fail(what);
    };
    has(pj, /orders\[orders\.length - 1\]\.carry = /, "progress.js: the install order carries no `carry`");
    has(pj, /exp: ep && ep\.perSec > 0 \? \{ perSec: ep\.perSec, sdLn: ep\.sd \?\? null, level: player\?\.skills\?\.hacking \?\? null, mult: player\?\.mults\?\.hacking_exp \?\? null/, "progress.js: the carry's exp is not the posterior with its level and hacking_exp multiplier");
    has(pj, /gang: Array\.isArray\(gang\) && gang\.length \? \{ steps: gang, at \}/, "progress.js: the carry's gang is not the gate's carried stream");
    has(aj, /carry: o\.carry \?\? null/, "act.js: /tel/install-last.txt does not record the order's carry");
    const ep = pj.slice(pj.indexOf("function expPostOf("), pj.indexOf("function incomePostOf("));
    has(ep, /carriedRatePrior\(installCarryOf\(readJson\(ns, '\/tel\/install-last\.txt'\), info\?\.lastAugReset\)\?\.exp/, "expPostOf: the prior is not the install's carried exp");
    has(ep, /const pr = carried \?\? /, "expPostOf: the carried prior does not come first");
    has(ep, /afterRamp\(obs0, BAYES_PRIORS\.freshRampH\)/, "expPostOf: the observation is not counted from the ramp's end");
    const gg = pj.slice(pj.indexOf("function* gangCarriedGen("), pj.indexOf("function* gangCarriedGen(") + 3000);
    has(gg, /gangBridgeOf\(own\?\.steps \?\? null, installCarryOf\(readJson\(ns, '\/tel\/install-last\.txt'\), info\?\.lastAugReset\)\?\.gang/, "gangCarriedGen: the carried gang stream is not bridged");
    c.examined(1);
    if (gg.indexOf("gangBridgeOf(") > gg.indexOf("if (own) return")) c.fail("gangCarriedGen: its own forecast returns before the bridge");
    out.push(c);
  }
  return out;
}
