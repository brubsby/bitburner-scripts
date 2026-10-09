// [LS] THE LIVES ONE BY ONE — the install prices the next life as the life prices itself.
//
// Live BN12 2026-10-09 (fixture-bn12-exitjump-1401.json, mkfix in
// tools/sim/exitjump/mkfix-bn12-1401.mjs): the 14:01:56Z install (22 augs,
// 12 NeuroFlux levels) priced 'now' at 18.07h (plan mean 22.08h); the new
// life priced its committed trajectory at 9.52h at 0.085h (EXIT JUMP AT
// INSTALL -8.46h against 2.70h), 17.19h at 14:17Z, 13.73h at 14:22Z.
//
// The cause: every later life was priced at the purchase model's MEAN life
// over its 48h horizon (lifeplan.lifeTable lnMean, the cadence posterior's
// prior), but the catalogue depletes — at 6h a life's sequence buys ln 0.705,
// 0.457, 0.123, 0.060, then ~0 (mean 0.17). The install's 'now' priced the
// next life at the mean (x1.13 on the posterior); the next life prices
// itself by its own planned batch (x1.43 by 2h), and only its LATER lives at
// the mean. Same life, two models: the pre-install side was the pessimistic
// one, by ~5h on a ~14h exit.
//
//   LS1 THE INCIDENT REPRODUCED  the old model on the rebuilt inputs: the
//                                actor's 'now' (18.07h, <10%) and the new
//                                life's 14:22Z point (13.73h, <5%); EXIT JUMP
//                                fails (plan.exitJumpOf)
//   LS2 THE SHAPE                exitplan.cadenceShapeOf: the sequence's total
//                                kept, scaled by the posterior over the mean,
//                                a batch beyond the table's baseline skips the
//                                catalogue's front, the mean past the horizon,
//                                nothing on another L
//   LS3 THE FIX ON THE FIXTURE   both sides built through lifeTable ->
//                                lifeInputsOf (the rows carry `seq`, the
//                                inputs `cadenceShape`): EXIT JUMP passes
//   LS4 WIRING                   lifeTableGen publishes seq; lifeInputsOf
//                                carries cadenceShape at L; exitHours walks
//                                the shaped lives one by one

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const LP = await import("../../lifeplan.js");
const BM = await import("../../bitNodeMultipliers.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn12-exitjump-1401.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const POST = F.post.inputs;
const L = POST.cycleHours;
const G = F.pre.batchGains;
const covOf = (n) => {
  const m = n === 12 ? BM.bitNodeMults(12, 1) : BM.bitNodeMults(n);
  return m ? Math.log(m.AugmentationMoneyCost * m.AugmentationRepCost) : 0;
};
// The purchase model's table as progress.js purchaseCadenceGen builds it:
// the node's offers less what each side owns after its next install's batch.
const pubRow = POST.cadence.table.find((r) => r.L === L);
const moneyScale = pubRow.money / LP.lifeTable({ inputs: POST, catalogue: LP.catalogueFromOffers(F.offers, F.owned), favor: {}, owned: F.owned, repPerHour0: POST.repPerSec * 3600, grid: [L] })[0].money;
const tableOf = (owned, nfgLevel0) => {
  const C = LP.catalogueFromOffers(F.offers, owned);
  return { table: LP.lifeTable({ inputs: POST, catalogue: C, favor: C.favor, owned, repPerHour0: POST.repPerSec * 3600, moneyScale, nfgLevel0 }) };
};
// POST: after the purchase step's plan (3 augs, 2 NeuroFlux levels). PRE:
// after the 22 being installed — the 13 owned now, NeuroFlux 13.
const recPost = tableOf([...F.owned, ...F.post.planBatch], F.nfgOwned + F.post.planNfg);
const recPre = tableOf(F.owned, F.nfgOwned);
const postOf = (rec, ledger, hackMultNow) => {
  const row = rec.table.find((r) => r.L === L);
  return E.installCadence(ledger, 12, { hackMultNow, covOf, modelPrior: { lnPerHour: row.lnMean / L, cycleHours: L } }).posterior;
};
// The pre-install side: the player at 14:01:56Z, the install's carried exp
// rate, the multiplier and reputation rate before the batch, the ledger
// without the life that install ended, 'now' with the batch as the baseline.
const preBase = {
  ...POST,
  hacking: F.pre.hacking,
  hackingExp: F.pre.hackingExp,
  hackingMult: POST.hackingMult / G.hacking,
  expPerSec: F.pre.expPerSec,
  repPerSec: POST.repPerSec / G.rep,
  installGains: G,
  persistBaseline: G,
  nextInstallGain: G.hacking,
};
const preX = LP.lifeInputsOf(preBase, recPre, L, postOf(recPre, F.ledger.slice(0, -1), F.pre.hackMultRaw));
const postX = LP.lifeInputsOf(POST, recPost, L, postOf(recPost, F.ledger, F.post.hackMultRaw));
const OLD = { cadenceShape: null };
const preNow = (x) => P.trajectoryOf({ kind: "wait", waitH: 0, gains: G })(x);
const postCommitted = (x) => P.trajectoryOf(F.post.install.spec)(x);
const jumpOf = (preH, postH) => P.exitJumpOf({ ...F.installLast, exits: { actorH: preH } }, { pointH: postH, n: 24 }, { lastAugReset: F.post.lastAugReset, now: Date.parse(F.post.at) });

export async function run() {
  const checks = [];

  {
    const c = new Check("LS1", "THE INCIDENT REPRODUCED: the old model (every later life at the mean) on the rebuilt inputs prices the actor's 'now' within 10% and the new life's 14:22Z point within 5%, and EXIT JUMP fails");
    const pre = preNow({ ...preX, ...OLD });
    const post = postCommitted({ ...postX, ...OLD });
    const postPub = postCommitted({ ...POST, ...OLD });
    const actor = F.installLast.exits.actorH;
    c.examined(3);
    c.note(`table L${L}: rebuilt mean ln ${recPost.table.find((r) => r.L === L).lnMean.toFixed(4)} vs the published ${pubRow.lnMean.toFixed(4)} (money x${moneyScale.toFixed(4)} as published)`);
    c.note(`pre 'now' ${f3(pre)}h vs the actor's ${actor}h (${((100 * (pre - actor)) / actor).toFixed(1)}%); post ${f3(post)}h, on the published inputs ${f3(postPub)}h, vs the plan's ${F.post.install.pointH}h (${((100 * (post - F.post.install.pointH)) / F.post.install.pointH).toFixed(1)}%)`);
    if (Math.abs(pre / actor - 1) > 0.1) c.fail(`the pre side does not reproduce the actor: ${pre} vs ${actor}`);
    if (Math.abs(post / F.post.install.pointH - 1) > 0.05) c.fail(`the post side does not reproduce the plan: ${post} vs ${F.post.install.pointH}`);
    if (Math.abs(postPub / F.post.install.pointH - 1) > 0.05) c.fail(`the published inputs do not reproduce the plan: ${postPub} vs ${F.post.install.pointH}`);
    const j = jumpOf(pre, post);
    c.note(j.why.slice(0, 240));
    if (j.ok !== false) c.fail(`EXIT JUMP must fail on the old model: ${j.why}`);
    checks.push(c);
  }

  {
    const c = new Check("LS2", "THE SHAPE (exitplan.cadenceShapeOf): the sequence's lives in order, scaled by the posterior over the mean, the total kept; a bigger first batch skips the catalogue's front; the mean past the horizon; nothing on another L");
    if (typeof E.cadenceShapeOf !== "function") {
      c.fail("exitplan.cadenceShapeOf is not exported");
      checks.push(c);
    } else {
      const seq = [0.7, 0.2, 0.1, 0, 0];
      const mean = 0.2;
      const g = Math.exp(0.1); // the posterior at half the model's mean
      const s = E.cadenceShapeOf({ L: 6, ln: seq }, { cycleHours: 6, multGainPerCycle: g });
      const lnOf = (sh, i) => Math.log(g * sh.at(i));
      const tot = [1, 2, 3, 4, 5].reduce((a, i) => a + lnOf(s, i), 0);
      c.examined(6);
      c.note(`lives ${[1, 2, 3, 4, 5, 6].map((i) => lnOf(s, i).toFixed(3)).join(" ")}; total ${tot.toFixed(4)} (mean x n x 0.5 = ${(mean * 5 * 0.5).toFixed(4)})`);
      if (Math.abs(lnOf(s, 1) - 0.35) > 1e-9 || Math.abs(lnOf(s, 2) - 0.1) > 1e-9 || Math.abs(lnOf(s, 4)) > 1e-9) c.fail("life j must be priced at seq_j x (ln g / mean)");
      if (Math.abs(tot - 0.5) > 1e-9) c.fail(`the sequence's total (scaled) must be kept: ${tot}`);
      if (Math.abs(s.at(6) - 1) > 1e-12 || s.end !== 6) c.fail(`past the sequence the mean (factor 1): ${s.at(6)}, end ${s.end}`);
      const k = E.cadenceShapeOf({ L: 6, ln: seq }, { cycleHours: 6, multGainPerCycle: g, skipLn: 0.35 });
      c.note(`skip 0.35: ${[1, 2, 3, 4, 5].map((i) => Math.log(g * k.at(i)).toFixed(3)).join(" ")}`);
      // 0.35 of model ln skipped = half of life 1: the next life is the
      // second half of life 1 and the first half of life 2 (0.35 + 0.1).
      if (Math.abs(Math.log(g * k.at(1)) - 0.225) > 1e-9 || Math.abs(Math.log(g * k.at(2)) - 0.075) > 1e-9) c.fail("a batch beyond the baseline takes the catalogue's front: life 1 starts half way into the sequence's first life");
      if (E.cadenceShapeOf({ L: 4, ln: seq }, { cycleHours: 6, multGainPerCycle: g }) !== null) c.fail("a shape for another L must not apply");
      // In the exit: the same total over the sequence's lives as the mean's.
      const base = { ...POST, firstInstallH: 1, installGains: POST.installGains, persistBaseline: POST.installGains };
      const n = postX.cadenceShape?.ln?.length ?? 0;
      const mOld = E.exitHours({ ...base, cadenceShape: null }, n + 1, false);
      const mNew = E.exitHours({ ...base, cadenceShape: { L, ln: postX.cadenceShape?.ln ?? [] } }, n + 1, false);
      const multOf = (r) => Number(/mult [\d.]+ -> ([\d.]+)/.exec(r.legs.find((l) => l.leg === "install cycles")?.detail ?? "")?.[1]);
      c.note(`${n + 1} installs on the live inputs: mult ${multOf(mOld)} at the mean, ${multOf(mNew)} by the sequence`);
      if (!(n > 0) || Math.abs(multOf(mOld) / multOf(mNew) - 1) > 0.01) c.fail(`over the whole sequence the shaped and the mean lives buy the same: ${multOf(mOld)} vs ${multOf(mNew)}`);
      checks.push(c);
    }
  }

  {
    const c = new Check("LS3", "THE FIX ON THE FIXTURE: both sides built through lifeTable -> lifeInputsOf on one cadence belief, every later life by the purchase sequence — EXIT JUMP passes; and the jump on the old model on that same belief fails");
    // ONE BELIEF: the cadence posterior with the life the install ended in
    // the ledger (the post side's). The pre side's own posterior had not yet
    // seen that 10.4h life (the deadlock) — evidence, not a second model —
    // noted below with what it moves.
    const preShared = LP.lifeInputsOf(preBase, recPre, L, postOf(recPre, F.ledger, F.post.hackMultRaw));
    const pre = preNow(preShared);
    const post = postCommitted(postX);
    const j = jumpOf(pre, post);
    const jOld = jumpOf(preNow({ ...preShared, ...OLD }), postCommitted({ ...postX, ...OLD }));
    const jOwn = jumpOf(preNow(preX), post);
    c.examined(2);
    c.note(`one belief: pre 'now' ${f3(pre)}h (old ${f3(preNow({ ...preShared, ...OLD }))}h); post ${f3(post)}h (old ${f3(postCommitted({ ...postX, ...OLD }))}h): ${j.why.slice(0, 200)}`);
    c.note(`the old model on that belief: ${jOld.why.slice(0, 200)}`);
    c.note(`the pre side on its own posterior (before the 10.4h life entered the ledger, gain x${Math.exp(preX.multGainPerCycle > 0 ? Math.log(preX.multGainPerCycle) : 0).toFixed(4)} a life vs x${postX.multGainPerCycle.toFixed(4)}): ${f3(preNow(preX))}h — ${jOwn.why.slice(0, 160)}`);
    if (!preX.cadenceShape || !postX.cadenceShape) c.fail("lifeInputsOf must carry the sequence (cadenceShape) at the committed L");
    if (j.ok !== true) c.fail(`EXIT JUMP must pass on the fixed model: ${j.why}`);
    if (jOld.ok !== false) c.fail(`on one belief the old model must still fail (the shape is the fix, not the belief): ${jOld.why}`);
    checks.push(c);
  }

  {
    const c = new Check("LS4", "WIRING: lifeTableGen publishes each life's ln gain (seq), lifeInputsOf carries it as cadenceShape, exitHours walks the shaped lives one by one and the per-life bound carries the same shape");
    const lp = code("lifeplan.js");
    const ep = code("exitplan.js");
    const need = [
      [lp, /seq: seq\.map\(\(s\) => \+Math\.max\(0, s\.lnGain\)/, "lifeplan.js: lifeTableGen rows carry seq"],
      [lp, /cadenceShape: Array\.isArray\(row\.seq\)/, "lifeplan.js: lifeInputsOf carries cadenceShape"],
      [ep, /const shape = cadenceShapeOf\(o\.cadenceShape,/, "exitplan.js: exitHours reads the shape"],
      [ep, /cycleExtraAt\(i\) \* shapeAt\(i\)/, "exitplan.js: each later cycle carries the shape"],
      [ep, /i >= shapeEnd && t >= repFrom/, "exitplan.js: no constant-power shortcut inside the shape"],
      [ep, /shapeLn \/ lives/, "exitplan.js: the per-life bound carries the shape"],
    ];
    c.examined(need.length);
    for (const [src, re, what] of need) if (!re.test(src)) c.fail(what);
    checks.push(c);
  }

  return checks;
}
