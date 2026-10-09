// EXIT JUMP AT INSTALL — live BN12 2026-10-09, the 14:01:56Z install.
//
//   node tools/sim/exitjump/attribute-bn12-1401.mjs [fixture.json]
//
// The install (22 augs, 12 NeuroFlux levels) priced 'now' at 18.07h; the new
// life priced its committed trajectory at 9.52h (14:07Z, not archived),
// 17.19h (14:17Z), 13.73h (14:22Z, the fixture). Both sides are rebuilt from
// tools/test/fixture-bn12-exitjump-1401.json the way progress.js builds them
// (lifeplan.lifeTable -> lifeInputsOf on the cadence posterior) and priced
// with every later life at the purchase model's mean (the old model) and by
// its purchase sequence (exitplan.cadenceShapeOf).
//
// CALIBRATION: the CHECK lines reproduce the actor's recorded 'now' and the
// plan's recorded 14:22Z point on the old model before anything is
// attributed. The pre side's player is the 14:01:56Z save row, its exp rate
// the install's carry; its table is rebuilt from the 14:26Z snapshots (the
// pre-install favors were not archived).
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import("../../../plan.js");
const E = await import("../../../exitplan.js");
const LP = await import("../../../lifeplan.js");
const BM = await import("../../../bitNodeMultipliers.js");

const F = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(REPO_ROOT, "tools/test/fixture-bn12-exitjump-1401.json"), "utf8"));
const POST = F.post.inputs;
const L = POST.cycleHours;
const G = F.pre.batchGains;
const covOf = (n) => {
  const m = n === 12 ? BM.bitNodeMults(12, 1) : BM.bitNodeMults(n);
  return m ? Math.log(m.AugmentationMoneyCost * m.AugmentationRepCost) : 0;
};
const pubRow = POST.cadence.table.find((r) => r.L === L);
const moneyScale = pubRow.money / LP.lifeTable({ inputs: POST, catalogue: LP.catalogueFromOffers(F.offers, F.owned), favor: {}, owned: F.owned, repPerHour0: POST.repPerSec * 3600, grid: [L] })[0].money;
const tableOf = (owned, nfgLevel0) => {
  const C = LP.catalogueFromOffers(F.offers, owned);
  return { table: LP.lifeTable({ inputs: POST, catalogue: C, favor: C.favor, owned, repPerHour0: POST.repPerSec * 3600, moneyScale, nfgLevel0 }) };
};
const recPost = tableOf([...F.owned, ...F.post.planBatch], F.nfgOwned + F.post.planNfg);
const recPre = tableOf(F.owned, F.nfgOwned);
const postOf = (rec, ledger, hackMultNow, Lc = L) => {
  const row = rec.table.find((r) => r.L === Lc);
  return E.installCadence(ledger, 12, { hackMultNow, covOf, modelPrior: { lnPerHour: row.lnMean / Lc, cycleHours: Lc } }).posterior;
};
const preBase = { ...POST, hacking: F.pre.hacking, hackingExp: F.pre.hackingExp, hackingMult: POST.hackingMult / G.hacking, expPerSec: F.pre.expPerSec, repPerSec: POST.repPerSec / G.rep, installGains: G, persistBaseline: G, nextInstallGain: G.hacking };
const preOwn = LP.lifeInputsOf(preBase, recPre, L, postOf(recPre, F.ledger.slice(0, -1), F.pre.hackMultRaw));
const preShared = LP.lifeInputsOf(preBase, recPre, L, postOf(recPre, F.ledger, F.post.hackMultRaw));
const postX = LP.lifeInputsOf(POST, recPost, L, postOf(recPost, F.ledger, F.post.hackMultRaw));
const OLD = { cadenceShape: null };
const preNow = (x) => P.trajectoryOf({ kind: "wait", waitH: 0, gains: G })(x);
const postC = (x) => P.trajectoryOf(F.post.install.spec)(x);
const elapsedH = (Date.parse(F.post.at) - Date.parse(F.installLast.at)) / 3.6e6;
const pct = (a, b) => `${((100 * (a - b)) / b).toFixed(1)}%`;
const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);

const preOld = preNow({ ...preOwn, ...OLD });
const postOld = postC({ ...postX, ...OLD });
console.log(`CHECK pre  'now' (old model) ${preOld.toFixed(2)}h vs the actor's recorded ${F.installLast.exits.actorH}h (error ${pct(preOld, F.installLast.exits.actorH)})`);
console.log(`CHECK post committed ${F.post.install.key} (old model) ${postOld.toFixed(2)}h vs the plan's recorded ${F.post.install.pointH}h (error ${pct(postOld, F.post.install.pointH)})`);
console.log(`CHECK table L${L}: rebuilt mean ln ${recPost.table.find((r) => r.L === L).lnMean.toFixed(4)} vs the published ${pubRow.lnMean.toFixed(4)}`);
console.log();
console.log(`the purchase sequence at L${L} (pre side, after the 22): ${recPre.table.find((r) => r.L === L).seq.map((v) => v.toFixed(3)).join(" ")} — mean ${recPre.table.find((r) => r.L === L).lnMean.toFixed(4)}`);
console.log(`the posterior's later life: pre x${preOwn.multGainPerCycle.toFixed(4)} (ledger before the 10.4h life), post x${postX.multGainPerCycle.toFixed(4)}`);
console.log();
const rows = [
  ["old model, each side's own belief", preOld, postOld],
  ["old model, one belief (the post ledger)", preNow({ ...preShared, ...OLD }), postOld],
  ["sequence, one belief", preNow(preShared), postC(postX)],
  ["sequence, each side's own belief", preNow(preOwn), postC(postX)],
];
for (const [k, pre, post] of rows) {
  const j = P.exitJumpOf({ ...F.installLast, exits: { actorH: pre } }, { pointH: post, n: 24 }, { lastAugReset: F.post.lastAugReset, now: Date.parse(F.post.at) });
  console.log(`${k.padEnd(42)} pre 'now' ${pre.toFixed(2)}h less ${elapsedH.toFixed(2)}h vs post ${post.toFixed(2)}h: jump ${f2(post - (pre - elapsedH))}h ${j.ok ? "ok" : "EXIT JUMP"}`);
}
console.log();
console.log(`the committed trajectory at each later-life length (post side, one belief):`);
for (const r of recPost.table) {
  const x = LP.lifeInputsOf(POST, recPost, r.L, postOf(recPost, F.ledger, F.post.hackMultRaw));
  if (!x) continue;
  console.log(`  L${String(r.L).padEnd(4)} mean ${postC({ ...x, ...OLD }).toFixed(2)}h -> sequence ${postC(x).toFixed(2)}h   (lives ${r.seq.slice(0, 5).map((v) => v.toFixed(3)).join(" ")}${r.seq.length > 5 ? " ..." : ""})`);
}
