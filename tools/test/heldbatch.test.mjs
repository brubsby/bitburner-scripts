// [HB] One augmentation, one source: the install batch and the graft set.
//
// Live BN9 2026-09-30 (fixture-bn9-held-0644: the 06:39:33Z and 06:44:33Z
// plan passes with the exit inputs each priced, the batch the purchase step
// planned and the running work): EXIT UNSTABLE 16.026h (held w2.209) ->
// 21.511h (held w2.126) over 5 minutes with no event, and EXIT NOT
// APPROACHING (15.7h -> 21.4h over 1.6h).
// The proving record (tools/sim/exitjump/attribute-held.mjs), the committed
// install's POINT swapped group by group 06:39 -> 06:44:
//   - the 06:39 record was NOT a held pass carrying stale values: its point
//     (15.92h) and mean (16.03h) are one pass's pricing (pricedAt 06:39:33),
//     as the 06:44 one (20.67h / 21.51h);
//   - trader belief, exp rate, fresh-life ramp, carried streams, cadence:
//     each < 0.35h (the 4S regime was bought at ~01:00Z and was an event
//     then: 'trader posterior moved 4.5 sd');
//   - the graft CRTX42-AA finishing (hackingMult x1.058, the graft leaving
//     lifeGrafts): +0.17h — neutral, as a finished graft should be;
//   - the batch losing CRTX42-AA (hacking x1.08, exp x1.15; owned now, so no
//     longer in the faction catalogue): +4.4h. At 06:39 the batch was buying
//     the augmentation being grafted — counted twice. Four more are still
//     counted twice at 06:44: PC Direct-Neural Interface, Artificial
//     Bio-neural Network Implant, Cranial Signal Processors - Gen V and
//     Enhanced Myelin Sheathing are in the batch AND the final window's
//     grafts (hacking x1.70 twice). The graft set without them reads ~47h.
//
//   HB1 ATTRIBUTION   replays both points; the graft's completion alone is
//                     neutral; the batch's CRTX42-AA carries the jump
//   HB2 THE RULE      graftsOfLifeNow / graftsOffBatch / graftBatchCheckOf on
//                     the live records: CRTX42-AA out of the 06:39 offers, the
//                     four out of the 06:44 set; AUG COUNTED TWICE fails on
//                     both live records and passes the filtered inputs
//   HB3 NO JUMP       priced with one source per augmentation, the 06:39 and
//                     06:44 points agree within the hours that passed plus
//                     noise — the completed graft moves nothing
//   HB4 WIRING        progress.js keeps this life's grafts out of the offers,
//                     the batch out of graft candidates and committed sets
//                     (an event when a committed graft leaves), records
//                     graftBatch; planCheck fails on it; a trader regime
//                     change is an event
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const G = await import("../../graftplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-held-0644.json"), "utf8"));
const A = F.a;
const B = F.b;
const CRTX = "CRTX42-AA Gene Modification";
const FOUR = ["PC Direct-Neural Interface", "Artificial Bio-neural Network Implant", "Cranial Signal Processors - Gen V", "Enhanced Myelin Sheathing"];
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const basisOf = (x) => P.basisOf(x.plan.decisions.install, Date.parse(x.plan.at));
const pointOf = (inputs, basis, gains = basis.gains) => E.bestExitPolicy({ ...inputs, firstInstallH: basis.waitH, installGains: gains, nextInstallGain: gains.hacking }, 400, 1).best?.hours ?? null;
const bA = basisOf(A);
const bB = basisOf(B);
const iA = A.exitinputs.inputs;
const iB = B.exitinputs.inputs;

export async function run() {
  const out = [];
  {
    const c = new Check("HB1", "the 06:39 -> 06:44 jump is the batch's CRTX42-AA, not the graft finishing nor a stale held pass");
    const pa = pointOf(iA, bA);
    const pb = pointOf(iB, bB);
    c.examined(2);
    c.note(`replay 06:39 ${pa.toFixed(3)}h (published point ${A.plan.decisions.install.pointH}h, mean ${A.plan.exit.meanH}h); 06:44 ${pb.toFixed(3)}h (published ${B.plan.decisions.install.pointH}h, mean ${B.plan.exit.meanH}h)`);
    if (Math.abs(pa / A.plan.decisions.install.pointH - 1) > 0.03) c.fail("the 06:39 replay is off its published point", `${pa} vs ${A.plan.decisions.install.pointH}`);
    if (Math.abs(pb / B.plan.decisions.install.pointH - 1) > 0.01) c.fail("the 06:44 replay is off its published point", `${pb} vs ${B.plan.decisions.install.pointH}`);
    for (const x of [A, B]) {
      const d = x.plan.decisions.install;
      if (!(d.held && d.pricedAt && Date.parse(d.pricedAt) >= Date.parse(x.plan.at) - 5e3)) c.fail(`the ${x.plan.at} held decision was not priced on its own pass`, `pricedAt ${d.pricedAt}`);
      if (Math.abs(d.meanH - d.pointH) > (d.q90 - d.q10) / 2) c.fail(`the ${x.plan.at} mean disagrees with its point beyond its own spread`, `${d.meanH} vs ${d.pointH}`);
    }
    // The graft finishing: the multiplier and the set, nothing else.
    const done = pointOf({ ...iA, hackingMult: iB.hackingMult, hacking: iB.hacking, hackingExp: iB.hackingExp, lifeGrafts: iB.lifeGrafts }, bA);
    // ... and the batch losing it (owned now): A's batch without CRTX42-AA's raw multipliers.
    const noCrtx = { ...bA.gains, hacking: bA.gains.hacking / 1.08, exp: bA.gains.exp / 1.15 };
    const lost = pointOf({ ...iA, hackingMult: iB.hackingMult, hacking: iB.hacking, hackingExp: iB.hackingExp, lifeGrafts: iB.lifeGrafts }, bA, noCrtx);
    c.note(`graft finished (mult x${(iB.hackingMult / iA.hackingMult).toFixed(3)}, out of lifeGrafts): ${(done - pa >= 0 ? "+" : "") + (done - pa).toFixed(3)}h; then the batch without CRTX42-AA: ${(lost - done >= 0 ? "+" : "") + (lost - done).toFixed(3)}h (the whole jump ${(pb - pa).toFixed(3)}h)`);
    if (!(Math.abs(done - pa) < 0.5)) c.fail("the graft finishing moves the exit", `${pa} -> ${done}`);
    if (!(lost - done > 0.6 * (pb - pa))) c.fail("the batch's CRTX42-AA does not carry the jump", `${done} -> ${lost} of ${pa} -> ${pb}`);
    if (!A.batch.includes(CRTX) || B.batch.includes(CRTX)) c.fail("the fixture's batches do not show CRTX42-AA bought at 06:39 and gone at 06:44", JSON.stringify([A.batch.includes(CRTX), B.batch.includes(CRTX)]));
    out.push(c);
  }
  {
    const c = new Check("HB2", "one source per augmentation on the live records (graftsOfLifeNow, graftsOffBatch, AUG COUNTED TWICE)");
    const lifeA = G.graftsOfLifeNow(iA, A.work);
    if (!lifeA.has(CRTX)) c.fail("the running graft is not kept out of the 06:39 offers", [...lifeA].join(", "));
    const lifeB = G.graftsOfLifeNow(iB, B.work);
    c.note(`this life's grafts: 06:39 ${[...lifeA].join(", ")}; 06:44 ${[...lifeB].join(", ")}`);
    for (const n of lifeB) if (B.batch.includes(n)) c.fail("a graft of this life is in the 06:44 batch", n);
    const off = G.graftsOffBatch(B.plan.decisions.grafts.grafts, new Set(B.batch));
    c.examined(B.plan.decisions.grafts.grafts.length);
    c.note(`06:44 committed set ${B.plan.decisions.grafts.grafts.length} -> ${off.kept.length}; dropped ${off.dropped.join(", ")}`);
    if (off.dropped.sort().join("|") !== [...FOUR].sort().join("|")) c.fail("the batch's four are not the ones dropped", off.dropped.join(", "));
    // A graft of life 1 is never dropped by the batch (it is owned first).
    const keep = G.graftsOffBatch([{ name: "X", life: 1 }, { name: "Y" }, { name: "Z", life: 2 }], ["X", "Y", "Z"]);
    if (keep.kept.map((g) => g.name).join() !== "X" || keep.dropped.join() !== "Y,Z") c.fail("graftsOffBatch drops a life-1 graft or keeps a later one", JSON.stringify(keep));
    const cA = G.graftBatchCheckOf({ batchNames: A.batch, inputs: iA });
    const cB = G.graftBatchCheckOf({ batchNames: B.batch, inputs: iB });
    c.note(`06:39: ${cA.why}`);
    c.note(`06:44: ${cB.why}`);
    if (cA.ok !== false || !cA.both.includes(CRTX)) c.fail("AUG COUNTED TWICE does not fail on the 06:39 record", cA.why);
    if (cB.ok !== false || cB.both.length !== 4) c.fail("AUG COUNTED TWICE does not fail on the 06:44 record", cB.why);
    const fixed = { ...iB, finalGrafts: G.graftsOffBatch(iB.finalGrafts, B.batch).kept };
    if (G.graftBatchCheckOf({ batchNames: B.batch, inputs: fixed }).ok !== true) c.fail("AUG COUNTED TWICE fails on filtered inputs", "");
    const pc = P.planCheck({ at: new Date().toISOString(), graftBatch: cB }, { now: Date.now() });
    if (!pc.fails.some((f) => /AUG COUNTED TWICE/.test(f.what))) c.fail("planCheck does not fail on graftBatch ok false", JSON.stringify(pc.fails.map((f) => f.what)));
    out.push(c);
  }
  {
    const c = new Check("HB3", "priced with one source per augmentation, the graft finishing moves the exit by the hours that passed plus noise");
    // 06:39 with the fix: CRTX42-AA out of the offers — the batch the
    // planner buys without it is the 06:44 batch (its hacking and exp are the
    // 06:39 batch's divided by CRTX42-AA's x1.08 / x1.15 exactly; the freed
    // money went to reputation augmentations: rep x1.09 -> x1.51) — and the
    // batch's augmentations out of the later grafts; 06:44 likewise.
    const same = Math.abs(bB.gains.hacking * 1.08 / bA.gains.hacking - 1) < 1e-6 && Math.abs(bB.gains.exp * 1.15 / bA.gains.exp - 1) < 1e-6;
    if (!same) c.fail("the 06:44 batch is not the 06:39 batch without CRTX42-AA", JSON.stringify([bA.gains, bB.gains]));
    // One life length for both (the purchase model's per-pass choice, 0.5h at
    // 06:39 and 3h at 06:44: without the double count the exit installs again
    // and the life length matters — 107h vs 47h on the 06:39 inputs; priced
    // on the 06:44 choice here, the choice itself is the cadence's, not this).
    const cad = Object.fromEntries(["cycleHours", "multGainPerCycle", "cadence", "cadenceRateMedian", "cadenceFrom"].map((k) => [k, iB[k]]));
    const pa = pointOf({ ...iA, ...cad, finalGrafts: G.graftsOffBatch(iA.finalGrafts, A.batch).kept }, bA, bB.gains);
    const pb = pointOf({ ...iB, finalGrafts: G.graftsOffBatch(iB.finalGrafts, B.batch).kept }, bB);
    const dtH = (Date.parse(B.plan.at) - Date.parse(A.plan.at)) / 3.6e6;
    const tol = Math.max(0.5, 0.05 * pa);
    c.examined(2);
    c.note(`one source: 06:39 ${pa.toFixed(2)}h, 06:44 ${pb.toFixed(2)}h (expected ${(pa - dtH).toFixed(2)}h +- ${tol.toFixed(2)}h); as published: ${A.plan.decisions.install.pointH}h -> ${B.plan.decisions.install.pointH}h`);
    if (!(Math.abs(pb - (pa - dtH)) <= tol)) c.fail("the exit still jumps across the graft's completion", `${pa} -> ${pb}`);
    if (!(pb > B.plan.decisions.install.pointH + 5)) c.fail("the honest exit is not slower than the double-counted one", `${pb} vs ${B.plan.decisions.install.pointH}`);
    out.push(c);
  }
  {
    const c = new Check("HB4", "the wiring: offers, candidates, committed sets, the check and the regime event");
    const pg = code("progress.js");
    const need = [
      ["graftedThisLife = graftsOfLifeNow(graftCarry, work)", "this life's grafts computed from the carry and the running work"],
      ["if (graftedThisLife.has(aug)) continue", "the batch's offers skip this life's grafts"],
      ["owned: new Set([...installed, ...pending, ...batchNow])", "graft candidates exclude the batch"],
      ["const liveOf = (gs) => offBatch(", "the committed set and memory leave the batch out"],
      ["committed graft(s) bought by the install batch instead", "a committed graft leaving is an event"],
      ["pcx.graftBatch = graftBatchCheckOf(", "the pass records AUG COUNTED TWICE"],
      ["graftBatch: pc.graftBatch ?? null", "the plan record carries it"],
      ["batchNamesNow = batchNamesOf(ns, info, plan, pending, replanAt)", "the batch's names before the graft decision"],
      ["traderRegime })", "the trader regime reaches redecideEvents"],
    ];
    for (const [s, what] of need) if (!pg.includes(s)) c.fail(`progress.js: ${what}`, s);
    c.examined(need.length);
    const ev = P.redecideEvents({ lastAugReset: 1, decidedAt: new Date().toISOString(), traderRegime: "pre-long" }, { lastAugReset: 1, now: Date.now(), traderRegime: "4S-long" });
    if (!ev.some((e) => /regime changed pre-long -> 4S-long/.test(e))) c.fail("a trader regime change is not an event", JSON.stringify(ev));
    const same = P.redecideEvents({ lastAugReset: 1, decidedAt: new Date().toISOString(), traderRegime: "4S-long" }, { lastAugReset: 1, now: Date.now(), traderRegime: "4S-long" });
    if (same.length) c.fail("an unchanged regime is an event", JSON.stringify(same));
    const unk = P.redecideEvents({ lastAugReset: 1, decidedAt: new Date().toISOString() }, { lastAugReset: 1, now: Date.now(), traderRegime: "4S-long" });
    if (unk.length) c.fail("a record from before the regime was recorded is an event", JSON.stringify(unk));
    out.push(c);
  }
  return out;
}
