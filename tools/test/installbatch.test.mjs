// [IB] INSTALLED A DIFFERENT BATCH — the batch the install ran on is the batch
// its decision priced, or it is re-priced first.
//
// Live BN9 2026-09-30 (fixture-bn9-batch-0819: the 08:19:37Z pass that ordered
// the install, the new life's 08:24:57Z and 08:29:57Z passes, and the 07:09-07:24
// passes around the 62ead9c deploy; /tel/install-last.txt as act.js wrote it):
// the gate priced "install: 12 aug(s)" now at 19.66h (plan 'now' mean 19.52h);
// the purchase step ordered 8 — ADR-V2 Pheromone Gene and NeuroFlux x3 never
// ordered — and the install ran on them. The new life priced its committed
// trajectory at a point of 53.49h: EXIT JUMP AT INSTALL +33.9h.
// The proving record (tools/sim/exitjump/attribute-batch.mjs):
//   - WHY 4 WERE NOT BOUGHT: money. The plan was built on cash + book at face
//     value ($577.9b; the book $576.4b at 08:19:15); the purchase step orders on
//     batchFits (book x0.97 haircut, +2% margin): through ADR-V2 the batch is
//     $557.3b x 1.02 = $568.5b against ~$559b reachable. It stopped there, and
//     the NeuroFlux levels after it were priced at ranks that no longer held.
//     No rep, prerequisite or escalation failure; the raise delivered.
//   - THE BATCH: the 8 bought price +2.6h over the 12 priced (22.46h vs 19.89h).
//   - THE REST OF THE JUMP IS THE CADENCE (+30.0h alone): the purchase model
//     chose 6h lives at x1.149 before the install and 0.5h lives at x1.004
//     after it. Before the install its catalogue still held the batch the
//     install buys: at the same $40b a 6h life bought x1.149 with it and x1.066
//     once 8 of them were owned — the batch priced twice (first install's gains
//     AND every later life's purchases). After it, the chooser (on graft-less
//     inputs) took 0.5h lives, which the full exit prices at 54h. Fresh ramp
//     +1.6h, streams +4.8h alone (+0.9h in the chain), reputation +1.2h, grafts
//     +2.3h alone (-2.4h in the chain), cash + book 0.
//   - THE 07:14 SPIKE (44.5h mean, point 109h) was the same chooser taking
//     0.5h lives (x1.0023, 173 installs); on 6h lives that pass prices 32.5h.
//     07:19 it returned to 6h lives: the fall to ~20h is that, not a graft
//     double count; the ~20h itself carries the batch twice (24.7h on the
//     cadence the new life measured with the batch owned).
//
//   IB1 ATTRIBUTION  replays both points; the batch +2.6h; the cadence the jump
//   IB2 THE BUDGET   the live numbers: the plan at face value does not fit a
//                    raise; batchReach is what fits
//   IB3 THE GUARD    installBatchVerdictOf holds the live 8-of-12 (re-priced
//                    +2.6h, a 0.5h wait for the 12 prices better); installs the
//                    same batch, a trim within tolerance, a trim that still wins
//   IB4 THE CHECK    INSTALLED A DIFFERENT BATCH fails on the live record, passes
//                    a same batch and a re-priced trim
//   IB5 ONE SOURCE   the purchase model's lives own the next install's batch
//                    (ownedAfterBatch): not bought twice, NeuroFlux priced on
//                    from the batch's levels; the live tables show the gap
//   IB6 WIRING       progress.js plans at reach, re-prices a trimmed batch
//                    before the install order, records pricedBatch/batchCheck;
//                    act.js refuses a count that differs and records both
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { preQueue } from "./prequeue.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const N = await import("../../nodeecon.js");
const L = await import("../../lifeplan.js");
const A = await import("../sim/exitjump/attribute-batch.mjs");

// Published before the work-slot queue: replayed on the accounting that priced it (prequeue.mjs).
const F = preQueue(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-batch-0819.json"), "utf8")));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const IL = F.installLast;
const PRICED = F.pre.gate.plan.buy.map((b) => b.name);
const BOUGHT = IL.batch;

export async function run() {
  const out = [];
  const R = A.attribution(F);

  {
    const c = new Check("IB1", "attribution: the recorded points replay; the 8 bought price worse than the 12 priced; the cadence carries the jump");
    c.examined(2 + A.GROUPS.length);
    const e1 = Math.abs(R.p12 / IL.exits.actorH - 1);
    const e2 = Math.abs(R.postPoint / F.post.plan.exitJump.first.pointH - 1);
    c.note(`pre 'now' 12 priced ${R.p12.toFixed(2)}h vs the actor's ${IL.exits.actorH}h (${(100 * e1).toFixed(1)}%); post ${R.postPoint.toFixed(2)}h vs recorded ${F.post.plan.exitJump.first.pointH}h (${(100 * e2).toFixed(1)}%)`);
    if (!(e1 < 0.03 && e2 < 0.03)) c.fail("the replay does not reproduce the recorded points", `${e1} ${e2}`);
    const dB = R.p8 - R.p12;
    c.note(`the batch: 12 -> ${R.p12.toFixed(2)}h, the 8 bought -> ${R.p8.toFixed(2)}h (${dB.toFixed(2)}h)`);
    if (!(dB > 1.5)) c.fail("the 8 bought should price materially worse than the 12 priced", String(dB));
    const cad = R.one.find((r) => r.name.startsWith("cadence"));
    const rest = R.one.filter((r) => r !== cad);
    for (const r of R.one) c.note(`  ${r.name}: ${r.dH >= 0 ? "+" : ""}${r.dH.toFixed(2)}h`);
    if (!(cad.dH > 20 && rest.every((r) => Math.abs(r.dH) < cad.dH / 4))) c.fail("the cadence group should carry the jump", JSON.stringify(R.one));
    const end = R.chain[R.chain.length - 1].h;
    if (!(Math.abs(end - R.postPoint) < 1.5)) c.fail("the cumulative chain should close on the new life's point", `${end} vs ${R.postPoint}`);
    out.push(c);
  }

  {
    const c = new Check("IB2", "the budget: the plan at face value does not fit the raise; batchReach does");
    c.examined(3);
    const book = F.stockLast.wealth;
    const face = F.pre.gate.probeMoney;
    const through9 = F.pre.gate.plan.buy[8].cumulative;
    const through8 = F.pre.gate.plan.buy[7].cumulative;
    c.note(`book $${(book / 1e9).toFixed(2)}b, planned on $${(face / 1e9).toFixed(2)}b; reach $${(N.batchReach(0, book) / 1e9).toFixed(2)}b; through ADR-V2 $${(through9 / 1e9).toFixed(2)}b, through 8 $${(through8 / 1e9).toFixed(2)}b`);
    if (N.batchFits(0, book, through9)) c.fail("the 9th item should not fit a raise on the live book");
    if (!N.batchFits(0, book, through8)) c.fail("the 8 should fit");
    if (!(through9 < face)) c.fail("the plan at face value should have planned the 9th");
    if (!(N.batchReach(0, book) < through9 && N.batchFits(0, book, N.batchReach(0, book)) && !N.batchFits(0, book, N.batchReach(0, book) * 1.001))) c.fail("batchReach is the largest total batchFits accepts");
    out.push(c);
  }

  {
    const c = new Check("IB3", "the guard: the live 8-of-12 holds; the same batch, a trim within tolerance and a trim that still wins install");
    const pre = F.pre.exitinputs.inputs;
    const waitH = A.pointOf(pre, { wait: 0.5 }).hours;
    const v = P.installBatchVerdictOf({ priced: PRICED, bought: BOUGHT, pricedH: R.p12, repricedH: R.p8, alternatives: [{ key: "wait 0.50h", H: waitH }] });
    c.examined(5);
    c.note(v.why);
    if (v.install !== false || v.action !== "hold") c.fail("the live trimmed batch should hold", JSON.stringify(v));
    if (v.missing.length !== 4 || !v.missing.includes("ADR-V2 Pheromone Gene") || v.missing.filter((n) => n === "NeuroFlux Governor").length !== 3) c.fail("the four not bought are named", JSON.stringify(v.missing));
    const same = P.installBatchVerdictOf({ priced: PRICED, bought: [...PRICED].reverse(), pricedH: R.p12, repricedH: null });
    if (!(same.same && same.install)) c.fail("the batch priced installs", JSON.stringify(same));
    const near = P.installBatchVerdictOf({ priced: PRICED, bought: PRICED.slice(0, 11), pricedH: 19.9, repricedH: 20.2 });
    if (!(near.install && !near.same)) c.fail("a trim within tolerance installs", JSON.stringify(near));
    const wins = P.installBatchVerdictOf({ priced: PRICED, bought: BOUGHT, pricedH: 19.9, repricedH: 22.5, alternatives: [{ key: "wait 2h", H: 24 }] });
    if (!wins.install) c.fail("a trim whose re-priced exit still beats every alternative installs", JSON.stringify(wins));
    const unpriced = P.installBatchVerdictOf({ priced: PRICED, bought: BOUGHT, pricedH: 19.9, repricedH: null });
    if (unpriced.install !== false) c.fail("an unpriced trimmed batch holds", JSON.stringify(unpriced));
    out.push(c);
  }

  {
    const c = new Check("IB4", "INSTALLED A DIFFERENT BATCH: fails on the live record; passes a same batch and a re-priced trim");
    c.examined(4);
    const live = P.differentBatchCheckOf(IL);
    c.note(live.why);
    if (live.ok !== false || !live.why.startsWith("INSTALLED A DIFFERENT BATCH")) c.fail("the live install ran on 8 of 12 unpriced: must fail", JSON.stringify(live));
    const rc = P.installRecordCheck(IL, { now: Date.parse(IL.at) + 3600e3 });
    if (!rc.fails.some((f) => f.what.startsWith("INSTALLED A DIFFERENT BATCH"))) c.fail("installRecordCheck (the healthcheck's F section) must carry it", JSON.stringify(rc.fails));
    const ok = P.differentBatchCheckOf({ ...IL, why: "install: 8 aug(s) ...", pricedBatch: BOUGHT });
    if (ok.ok !== true) c.fail("the batch priced passes", JSON.stringify(ok));
    const v = P.installBatchVerdictOf({ priced: PRICED, bought: BOUGHT, pricedH: 19.9, repricedH: 22.5, alternatives: [{ key: "wait 2h", H: 24 }] });
    const trimmed = P.differentBatchCheckOf({ ...IL, pricedBatch: PRICED, batchCheck: v });
    if (trimmed.ok !== true) c.fail("a trim re-priced and justified passes", JSON.stringify(trimmed));
    out.push(c);
  }

  {
    const c = new Check("IB5", "one source: the purchase model's lives own the next install's batch");
    c.examined(4);
    const oa = L.ownedAfterBatch(["A"], PRICED);
    if (!(oa.nfgLevel0 === 3 && oa.owned.has("ADR-V2 Pheromone Gene") && oa.owned.has("A") && !oa.owned.has("NeuroFlux Governor"))) c.fail("ownedAfterBatch: augmentations owned, NeuroFlux as levels", JSON.stringify({ n: oa.nfgLevel0, o: [...oa.owned] }));
    const items = [
      { name: "X", price: 1e9, repReq: 0, hackMult: 1.1, prereq: [], factions: ["F"] },
      { name: "Y", price: 2e9, repReq: 0, hackMult: 1.05, prereq: [], factions: ["F"] },
    ];
    const nfg = { price: 1e6, repReq: 0, hackMult: 1.01, factions: ["F"] };
    const seq = (o) => L.lifeSequence({ items, nfg, favor: { F: 0 }, owned: [...o.owned], L: 6, lives: 1, moneyAt: () => 5e9, repPerHour0: 1e6, nfgLevel0: o.nfgLevel0 })[0];
    const before = seq({ owned: new Set(), nfgLevel0: 0 });
    const after = seq(L.ownedAfterBatch([], ["X", "NeuroFlux Governor", "NeuroFlux Governor"]));
    c.note(`a life before the batch is owned buys ${before.chosen.join("+")} +${before.nfgLevels} NeuroFlux (x${Math.exp(before.lnGain).toFixed(4)}); after, ${after.chosen.join("+")} +${after.nfgLevels} (x${Math.exp(after.lnGain).toFixed(4)})`);
    if (after.chosen.includes("X") || !before.chosen.includes("X")) c.fail("an augmentation in the batch is bought by the batch, not again by the lives after it");
    const nf0 = seq({ owned: new Set(["X", "Y"]), nfgLevel0: 0 }).nfgLevels;
    const nf5 = seq({ owned: new Set(["X", "Y"]), nfgLevel0: 20 }).nfgLevels;
    if (!(nf5 < nf0)) c.fail("NeuroFlux levels the batch buys raise the price the later lives start from", `${nf0} vs ${nf5}`);
    // The live tables: the same money buys less once the batch is owned.
    const pre6 = F.pre.exitinputs.inputs.cadence.table.find((r) => r.L === 6);
    const post6 = F.post2.exitinputs.inputs.cadence.table.find((r) => r.L === 6);
    c.note(`live 6h life: x${pre6.gain} at $${(pre6.money / 1e9).toFixed(1)}b with the batch in the catalogue, x${post6.gain} at $${(post6.money / 1e9).toFixed(1)}b with 8 of it owned`);
    if (!(Math.abs(pre6.money / post6.money - 1) < 0.05 && pre6.gain > post6.gain * 1.05)) c.fail("the live tables should show the gap at the same money");
    out.push(c);
  }

  {
    // The live purchase model 0.5h into the next life (fixture-bn9-cadence-0850):
    // the rebuilt catalogue reproduces the published per-life gains, and with
    // the gate's batch (ADR-V2, The Shadow's Simulacrum, NeuroFlux x6) owned
    // each length buys less — a small batch now, so a small gap (~0.3h on the
    // committed w0.75 through the posterior), but the same double count.
    const c = new Check("IB7", "the live purchase model after the install: rebuilt gains match the published table; the batch owned buys less at every length");
    const CB = await import("../sim/exitjump/cadence-batch.mjs");
    const C = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-cadence-0850.json"), "utf8"));
    const Rb = CB.rebuild(C);
    Rb.table = C["exitinputs.txt"].inputs.cadence.table;
    const a = CB.cadenceOf(Rb, { afterBatch: false });
    const b = CB.cadenceOf(Rb, { afterBatch: true });
    c.examined(Rb.table.length);
    const off = Rb.table.filter((r, i) => Math.abs(a.table[i].gain - r.gain) > 1e-3);
    c.note(`published gains ${Rb.table.map((r) => `L${r.L} x${r.gain}`).join(" ")}; rebuilt ${a.table.map((r) => `x${r.gain}`).join(" ")}; batch owned ${b.table.map((r) => `x${r.gain}`).join(" ")}`);
    if (off.length) c.fail("the rebuilt catalogue does not reproduce the published gains (uncalibrated)", JSON.stringify(off));
    if (!b.table.every((r, i) => r.L < 1 || r.gain < a.table[i].gain)) c.fail("with the batch owned every life length of an hour or more should buy less");
    out.push(c);
  }

  {
    const c = new Check("IB6","wiring: plan at reach; a trimmed batch re-priced before the install order; act.js refuses a different count and records the batches");
    const pg = code("progress.js");
    const act = code("act.js");
    const checks = [
      ["progress.js plans at batchReach", /money: reachOf\(liveMoney\)/.test(pg) && /replanAt = \(m, offersAt = null\) => planPurchases\(\{ \.\.\.planArgs, money: reachOf\(m\)/.test(pg)],
      ["the purchase model gets the next batch", /purchaseCadenceGen\(ns, info, out, cOffers, ownedAugsNow, nextBatch\)/.test(pg) && /ownedAfterBatch\(owned0, batch\)/.test(pg)],
      ["the verdict gates the install order", pg.indexOf("installBatchVerdictOf({ priced: pricedBatch") > 0 && pg.indexOf("installBatchVerdictOf({ priced: pricedBatch") < pg.indexOf("order('install', ['boot.js'], gate.why)") && /if \(batchCheck && batchCheck\.install === false && !installRefused\) installRefused = batchCheck\.why/.test(pg)],
      ["the order carries pricedBatch and batchCheck", /\.pricedBatch = pricedBatch/.test(pg) && /\.batchCheck = batchCheck/.test(pg)],
      ["act.js refuses a count that differs", /bought !== o\.batch\.length - \(o\.requireQueued \?\? 0\)/.test(act)],
      ["act.js records both", /pricedBatch: o\.pricedBatch \?\? null, batchCheck: o\.batchCheck \?\? null/.test(act)],
    ];
    c.examined(checks.length);
    for (const [what, ok] of checks) if (!ok) c.fail(what);
    out.push(c);
  }
  return out;
}
