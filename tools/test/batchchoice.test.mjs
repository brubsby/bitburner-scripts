// [BC] THE BATCH BY THE EXIT — the install buys the better of the committed
// batch and the fresh one, priced on one set of inputs and draws.
//
// Live BN9 2026-09-30 (fixture-bn9-twoexits-1325-1405: the pass before, the
// committing pass and the installing pass of each incident, and
// /tel/install-last.txt as act.js wrote it). Both installs fired TWO EXITS AT
// INSTALL:
//   13:25:15Z  committed at 13:20Z to w0.059 on ECorp HVMind + ADR-V2 + The
//              Shadow's Simulacrum + 14 NeuroFlux (x1.586 rep); the 13:25 pass
//              planned and bought ENM DMA Upgrade + ECorp HVMind + DataJack +
//              14 NeuroFlux (x1.150 rep). Plan 'now' 15.869h vs the commitment
//              15.01h less 5 min; actor 14.88h vs the commitment's point 14.022h.
//   14:05:50Z  committed at 14:00Z to w0.093 on ENM AE + Neuralstimulator +
//              HyperSight + ADR-V2 + Shadow's + ASP + 3 NeuroFlux (x1.422 rep);
//              the 14:05 pass dropped ADR-V2 and Shadow's (x1.030 rep). Plan
//              'now' 14.816h vs 13.25h; actor 14.89h vs 13.17h.
// THE CAUSE. The purchase planner ranks batches on weights that are the
// exit's SLOPES at the last published batch and inputs (objective.exitWeights,
// a +5% finite difference). The 14:05 pass planned on the 14:00 record: its
// batch already held the rep augmentations and on its inputs the exit did not
// move with rep at all (x1.03 -> x1.42 rep: 13.079h -> 13.077h), so the rep
// weight was 0 and ADR-V2 and Shadow's were 'no-value'; on the 14:05 inputs
// (the rep rate 19.3 -> 13.3/s) the same two augmentations were worth 1.49h.
// At 13:25 the rep slope read 0.98h per ln at the x1.586 batch against a
// secant of 2.9h per ln down to x1.150. And in the wait's last half hour
// plan.committedBatchOf took the re-planned batch ALWAYS (13:20: +0.16h worse;
// 13:55: +0.57h worse), so "fresh" was never checked against "better".
//
//   BC1 THE INCIDENTS, REPLAYED: on the installing pass's inputs and one draw
//       set, chooseBatch takes the committed batch over the fresh plan (0.94h
//       and 1.49h better on the point); installed on it, TWO EXITS AT INSTALL
//       passes where the live install failed it (before/after printed)
//   BC2 THE LAST HALF HOUR: committedBatchOf keeps the better of the two by
//       the exit — 13:20 keeps the committed (the re-planned +0.16h), 14:00
//       takes the re-planned (-0.45h)
//   BC3 THE PROXY: exitWeights on the record the installing pass planned on
//       reads the rep slope 0 (14:00) / 0.98h per ln (13:20) while the exit
//       itself prices the rep augmentations 1.49h / 0.94h on the installing
//       pass — the planner's weights are a local, one-pass-old slope
//   BC4 THE INCUMBENT: the planner on the 14:05 weights drops the rep
//       augmentations, on the 14:00 weights keeps them; ranked by the exit
//       on the 14:05 inputs the incumbent's batch wins; a committed batch the
//       raise cannot reach is not a candidate; the tie goes to the incumbent
//   BC5 WIRING: progress.js chooses the plan through batchChoiceStep on the
//       pass's first inputs before anything prices the batch, records the
//       committed batch's names, publishes the choice in the plan record, the
//       gate's objective and the install order; act.js copies it into
//       install-last.txt

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const O = await import("../../objective.js");
const A = await import("../../augplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-twoexits-1325-1405.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const fin = (x) => typeof x === "number" && isFinite(x);
const draws = P.makeDraws(P.posteriorsOf({ exitSamples: [] }), 24, 0xbc1);
const names = (g) => g.plan.buy.map((b) => b.name);
const short = (ns) => {
  const m = new Map();
  for (const n of ns) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([n, k]) => (k > 1 ? `${k}x ${n.replace("NeuroFlux Governor", "NFG")}` : n.split(" ").slice(0, 2).join(" "))).join(", ");
};
/** The exit of installing `g` at `waitH` on `inputs`, as the plan prices it once shipped (the batch is the baseline too). */
const pointOf = (inputs, g, waitH = 0) => E.bestExitPolicy({ ...inputs, firstInstallH: waitH, installGains: g, nextInstallGain: g.hacking, persistBaseline: g }, 400, 1).best?.hours ?? null;

export async function run() {
  const checks = [];

  {
    const c = new Check("BC1", "THE INCIDENTS, REPLAYED: on the installing pass's inputs and one draw set the committed batch beats the fresh plan the live install bought; installed on it, TWO EXITS AT INSTALL passes where the live install failed it");
    for (const [id, I] of Object.entries({ "13:25": F.i1325, "14:05": F.i1405 })) {
      c.examined(1);
      const a = I.a.plan.decisions.install;
      const b = I.b.plan.decisions.install;
      const tB = Date.parse(I.installLast.at);
      const inputs = I.b.exitinputs.inputs;
      const cands = [
        { key: "fresh", names: names(I.b.gate), gains: b.batchGains },
        { key: "committed", names: names(I.a.gate), gains: a.gains },
      ];
      if (P.gainsKeyOf(inputs.installGains) !== P.gainsKeyOf(b.batchGains)) c.fail(`${id}: fixture: the installing pass's inputs must carry the batch it bought`);
      const ch = P.chooseBatch({ candidates: cands, inputs, waitH: 0, installAt: a.installAt, draws, now: tB, budgetMs: 1e9, clock: () => 0 });
      c.note(`${id}: committed [${short(cands[1].names)}] vs fresh [${short(cands[0].names)}]: ${ch.why}`);
      if (ch.key !== "committed") c.fail(`${id}: the committed batch must be chosen`, ch.why);
      if (ch.by !== "draws" || ch.n !== 24) c.fail(`${id}: at the install the choice is by the mean over all 24 shared draws`, `${ch.by} n=${ch.n}`);
      if (!(ch.gainH > 0.2)) c.fail(`${id}: the committed batch must price sooner than the fresh plan by more than the batch jitter`, String(ch.gainH));
      // BEFORE: the live record, and the live install-last verdict.
      const before = P.installExitsOf(b, { actorH: I.installLast.exits.actorH, now: tB, si: 0.02 });
      c.note(`${id} BEFORE (live, fresh batch): ${before.why}`);
      if (before.ok !== false || I.installLast.exits.ok !== false) c.fail(`${id}: the live install must reproduce TWO EXITS AT INSTALL`, before.why);
      // AFTER: the same pass installing the chosen batch — the actor and the
      // plan's 'now' point are its exit on these inputs; the plan's mean
      // moves with the point (the live mean/point ratio).
      const rowC = ch.rows.find((r) => r.key === "committed");
      const rowF = ch.rows.find((r) => r.key === "fresh");
      const pointAfter = rowC.pointH;
      const meanAfter = +((b.meanH * pointAfter) / b.pointH).toFixed(3);
      const after = P.installExitsOf({ ...b, meanH: meanAfter, pointH: pointAfter }, { actorH: pointAfter, now: tB, si: 0.02 });
      c.note(`${id} AFTER (committed batch): point ${rowF.pointH}h -> ${pointAfter}h (draws mean ${rowF.meanH}h -> ${rowC.meanH}h), plan 'now' mean ~${meanAfter}h: ${after.why}`);
      if (after.ok !== true) c.fail(`${id}: installing the chosen batch must pass TWO EXITS AT INSTALL`, after.why);
      // The fresh batch (what was bought) on the same replay still fails: the guard stays a guard.
      const ctl = P.installExitsOf({ ...b, meanH: +((b.meanH * rowF.pointH) / b.pointH).toFixed(3), pointH: rowF.pointH }, { actorH: rowF.pointH, now: tB, si: 0.02 });
      if (ctl.ok !== false) c.fail(`${id}: control: the fresh batch on the same replay must still fail TWO EXITS AT INSTALL`, ctl.why);
    }
    // Without draws the choice is by the point; the incumbent takes a tie.
    c.examined(2);
    const I = F.i1405;
    const g = I.a.plan.decisions.install.gains;
    const tie = P.chooseBatch({ candidates: [{ key: "fresh", names: ["X"], gains: { ...g } }, { key: "committed", names: ["Y"], gains: g }], inputs: I.b.exitinputs.inputs, draws: [] });
    if (tie.key !== "fresh" || tie.rows.length !== 1 || tie.rows[0].alias?.[0] !== "committed") c.fail("one batch under two keys is one candidate (the first key, the other an alias)", JSON.stringify(tie.rows.map((r) => [r.key, r.alias])));
    const pt = P.chooseBatch({ candidates: [{ key: "fresh", gains: I.b.plan.decisions.install.batchGains }, { key: "committed", gains: g }], inputs: I.b.exitinputs.inputs, draws: [] });
    if (pt.by !== "point" || pt.key !== "committed") c.fail("without draws the choice is by the point", `${pt.by} ${pt.key}`);
    checks.push(c);
  }

  {
    const c = new Check("BC2", "THE LAST HALF HOUR: committedBatchOf keeps the better of the committed and the re-planned batch by the exit — 13:20 keeps the committed one (the re-planned priced +0.16h live), 14:00 takes the re-planned one (-0.45h live)");
    for (const [id, I, want] of [["13:20", F.i1325, "held"], ["14:00", F.i1405, "taken"]]) {
      c.examined(1);
      const now = Date.parse(I.a.plan.at);
      const spec = P.basisOf(I.a0.plan.decisions.install, now);
      const prevGains = I.a0.plan.decisions.install.gains;
      const newGains = I.a.plan.decisions.install.gains;
      const inputs = I.a.exitinputs.inputs;
      const pt = (gg) => E.bestExitPolicy({ ...inputs, firstInstallH: spec.waitH, installGains: gg, nextInstallGain: gg.hacking }, 400, 1).best?.hours;
      const prevH = pt(prevGains);
      const newH = pt(newGains);
      const cb = P.committedBatchOf({ prevGains, newGains, prevH, newH, waitH: spec.waitH });
      const got = cb.event ? "event" : cb.held ? "held" : "taken";
      c.note(`${id}: wait ${spec.waitH.toFixed(3)}h, committed ${prevH.toFixed(3)}h vs re-planned ${newH.toFixed(3)}h -> ${got} (live: ${I.a.plan.committedBatch.why})`);
      if (got !== want) c.fail(`${id}: expected ${want}, got ${got}`, cb.why);
      if (got === "held" && cb.gains !== prevGains) c.fail(`${id}: a kept batch is the committed one`);
    }
    checks.push(c);
  }

  {
    const c = new Check("BC3", "THE PROXY: the purchase planner's rep weight is the exit's slope at the last published batch and inputs — 0 on the 14:00 record, 0.98h per ln on the 13:20 one — while the exit prices the rep augmentations 1.49h / 0.94h on the installing pass");
    for (const [id, I, zero] of [["14:00 -> 14:05", F.i1405, true], ["13:20 -> 13:25", F.i1325, false]]) {
      c.examined(1);
      const rec = I.a.exitinputs;
      const w = O.exitWeights(rec, rec.lastAugReset, E.bestExitPolicy, E.spendRuns, { chanceObs: 0.996, growShare: 0.589 }, Date.parse(I.b.exitinputs.at));
      const gC = I.a.plan.decisions.install.gains;
      const gF = I.b.plan.decisions.install.batchGains;
      const hC = pointOf(I.b.exitinputs.inputs, gC);
      const hF = pointOf(I.b.exitinputs.inputs, gF);
      const secant = (hF - hC) / Math.log(gC.rep / gF.rep);
      c.note(`${id}: rep slope on the record ${w?.sensitivities?.rep?.toFixed(3)}h/ln (weight ${w?.weights?.faction_rep?.toFixed(4)}; live published ${I.b.gate.objective.weights.faction_rep}), exit on the installing pass: committed ${hC.toFixed(3)}h vs fresh ${hF.toFixed(3)}h (rep x${gC.rep.toFixed(3)} vs x${gF.rep.toFixed(3)}: ${secant.toFixed(2)}h per ln)`);
      if (!w) {
        c.fail(`${id}: exitWeights must price the record`);
        continue;
      }
      if (Math.abs(w.weights.faction_rep - I.b.gate.objective.weights.faction_rep) > 0.002) c.fail(`${id}: the replayed rep weight must be the one the live planner used`, `${w.weights.faction_rep} vs ${I.b.gate.objective.weights.faction_rep}`);
      if (zero && w.sensitivities.rep !== 0) c.fail(`${id}: the rep slope on the 14:00 record is 0 (the kink)`, String(w.sensitivities.rep));
      if (!(secant > 2 * Math.max(w.sensitivities.rep, 0.1))) c.fail(`${id}: the exit's own rep secant must exceed the planner's slope`, `${secant} vs ${w.sensitivities.rep}`);
      if (!(hC < hF)) c.fail(`${id}: the exit prices the committed (rep) batch sooner on the installing pass`);
    }
    checks.push(c);
  }

  {
    const c = new Check("BC4", "THE INCUMBENT: the planner on the 14:05 weights drops ADR-V2 and The Shadow's Simulacrum, on the 14:00 weights keeps them; ranked by the exit on the 14:05 inputs the incumbent's batch wins; an unreachable committed batch is not a candidate");
    c.examined(4);
    const one = { hacking_chance: 1, hacking_speed: 1, hacking_money: 1, hacking_grow: 1, hacking: 1, hacking_exp: 1, faction_rep: 1 };
    // Augmentations.ts (the 14:00 batch's): moneyCost and multipliers.
    const offers = [
      { name: "Embedded Netburner Module Analyze Engine", baseCost: 6e9, mults: { ...one, hacking_speed: 1.1 } },
      { name: "Neuralstimulator", baseCost: 3e9, mults: { ...one, hacking_speed: 1.02, hacking_chance: 1.1, hacking_exp: 1.12 } },
      { name: "HyperSight Corneal Implant", baseCost: 2.75e9, mults: { ...one, hacking_speed: 1.03, hacking_money: 1.1 } },
      { name: "ADR-V2 Pheromone Gene", baseCost: 5.5e8, mults: { ...one, faction_rep: 1.2 } },
      { name: "The Shadow's Simulacrum", baseCost: 4e8, mults: { ...one, faction_rep: 1.15 } },
      { name: "Artificial Synaptic Potentiation", baseCost: 8e7, mults: { ...one, hacking_speed: 1.02, hacking_chance: 1.05, hacking_exp: 1.05 } },
    ].map((o) => ({ ...o, faction: "Slum Snakes", repReq: 0, factionRep: 1e9, prereqs: [] }));
    const I = F.i1405;
    const plan = (w) => A.planPurchases({ offers, money: I.b.gate.plan.stats.money, r: 1.9, channelWeights: w, channels: Object.keys(w).filter((k) => k !== "hacknet_node_money") });
    const gainsOf = (p) => {
      const g = { hacking: 1, rep: 1, income: 1, exp: 1 };
      for (const b of p.buy) {
        const m = offers.find((o) => o.name === b.name).mults;
        g.hacking *= m.hacking;
        g.rep *= m.faction_rep;
        g.income *= m.hacking_money * m.hacking_chance * m.hacking_speed;
        g.exp *= m.hacking_exp;
      }
      return g;
    };
    const pFresh = plan(I.b.gate.objective.weights);
    const pInc = plan(I.a.gate.objective.weights);
    const has = (p, n) => p.buy.some((b) => b.name === n);
    c.note(`14:05 weights (rep ${I.b.gate.objective.weights.faction_rep}): [${pFresh.buy.map((b) => b.name.split(" ")[0]).join(", ")}]; 14:00 weights (rep ${I.a.gate.objective.weights.faction_rep}): [${pInc.buy.map((b) => b.name.split(" ")[0]).join(", ")}]`);
    if (has(pFresh, "ADR-V2 Pheromone Gene") || has(pFresh, "The Shadow's Simulacrum")) c.fail("on the 14:05 weights (rep 0) the planner must drop the rep augmentations (the incident's mechanism)");
    if (!has(pInc, "ADR-V2 Pheromone Gene") || !has(pInc, "The Shadow's Simulacrum")) c.fail("on the 14:00 weights the planner keeps them");
    const inputs = { ...I.b.exitinputs.inputs };
    const base = I.b.plan.decisions.install.batchGains;
    const lift = (g) => ({ hacking: base.hacking * g.hacking, rep: base.rep * g.rep, income: base.income * g.income, exp: base.exp * g.exp });
    const ch = P.chooseBatch({ candidates: [{ key: "fresh", names: pFresh.buy.map((b) => b.name), gains: lift(gainsOf(pFresh)) }, { key: "incumbent", names: pInc.buy.map((b) => b.name), gains: lift(gainsOf(pInc)) }], inputs, draws: [], prefer: "incumbent" });
    c.note(`by the exit on the 14:05 inputs: ${ch.why}`);
    if (ch.key !== "incumbent") c.fail("ranked by the exit, the incumbent's batch (with the rep augmentations) must win", ch.why);
    // An unreachable committed batch is not a candidate, and says so.
    const un = P.chooseBatch({ candidates: [{ key: "fresh", gains: base }, { key: "committed", gains: I.a.plan.decisions.install.gains, buyable: false, why: "not buyable at the raise's reach: 2 missing" }], inputs, draws: [] });
    if (un.key !== "fresh" || un.unbuyable?.[0]?.key !== "committed") c.fail("a committed batch the raise cannot reach must not be chosen, and is named", JSON.stringify(un));
    // A tie goes to the incumbent.
    const g0 = I.a.plan.decisions.install.gains;
    const tie = P.chooseBatch({ candidates: [{ key: "fresh", gains: { ...g0, exp: g0.exp * (1 + 1e-7) } }, { key: "committed", gains: g0 }], inputs, draws: [], tieH: 1e-3 });
    if (tie.key !== "committed") c.fail("equal exits: the incumbent (committed) is kept", tie.why);
    checks.push(c);
  }

  {
    const c = new Check("BC5", "WIRING: progress.js chooses the plan through batchChoiceStep on the pass's first exit inputs before anything prices the batch, names the committed batch in the plan record, publishes the choice (plan record, gate objective, install order); act.js copies it into install-last.txt");
    const pg = code("progress.js");
    const act = code("act.js");
    c.examined(8);
    const first = pg.indexOf("firstInputs = await paced(exitInputsGen(");
    const choose = pg.indexOf("const bc = await batchChoiceStep(ns, info, { plan, inputs: firstInputs");
    const life = pg.indexOf("await lifeLengthDecisionOf(ns, info,");
    if (!(first > 0 && choose > first && life > choose)) c.fail("the batch choice runs on the pass's first exit inputs, before the life length decision (the first decision to price the batch)");
    if (!/if \(bc\?\.plan && bc\.plan !== plan\) \{\s*plan = bc\.plan/.test(pg)) c.fail("the chosen batch becomes the plan (what the purchase step orders and every later exit input carries)");
    if (!/draws: near \? pc\.draws \?\? \[\] : \[\]/.test(pg) || !/installAt: near \? prevInst\.installAt : null/.test(pg)) c.fail("near the install the choice is priced on the plan's draws at the committed install time");
    if (!/key: 'committed', names, gains: gainsOf\(names\), plan: cp, buyable/.test(pg) || !/diff\.missing\.length === 0/.test(pg)) c.fail("the committed batch is a candidate only when every augmentation of it is bought at the raise's reach");
    if (!/pcx\.committedBatch = \{ \.\.\.\(pcx\.committedBatch \?\? \{\}\), gainsKey: inst\.gainsKey, names:/.test(pg)) c.fail("the plan record names the committed batch (committedBatch.names)");
    if (!/batch: pc\.decisions\.batch \?\? null/.test(pg)) c.fail("the plan record publishes the batch choice (decisions.batch)");
    if (!/orders\[orders\.length - 1\]\.batchChoice = batchChoiceNow/.test(pg)) c.fail("the install order carries the batch choice");
    if (!/batchChoice: o\.batchChoice \?\? null/.test(act)) c.fail("act.js copies the install order's batch choice into /tel/install-last.txt");
    if (!/batchWeights: bc\.weights/.test(pg)) c.fail("the gate's objective publishes the weights the shipped batch was planned on (the next pass's incumbent)");
    checks.push(c);
  }

  return checks;
}
