// [GL] Grafts in the lives before the final window.
//
// Until 2026-09-29 the exit simulator put every graft in the final window, so
// the lives before it contributed their augmentation batch and nothing else.
// But a graft is installed the moment it finishes and rides through every
// later install (its entropy too), so a graft can be made in ANY life —
// paid from that life's money, holding that life open for its slot hours.
//
//   GL1 THE GAME        GraftingWork applies the augmentation on finish (not
//                       when cancelled), charges the price at start; the
//                       install cancels work in progress; every install
//                       re-applies Player.augmentations and the entropy; only
//                       a Source-File prestige clears the entropy; cost x3,
//                       time (1h log2(sum)+30min)/2
//   GL2 THE SIMULATOR   exitplan lifeGrafts: life 1's grafts lengthen the life
//                       to moneyH + max(slot, base); their multiplier reaches
//                       the climb; a life the policy does not have spills its
//                       grafts into the final window (exactly the final-only
//                       price); no lifeGrafts prices exactly as before
//   GL3 THE SCHEDULE    graftplan.scheduleGen on the live 17:48 inputs: the
//                       cheapest grafts in the current life beat the final
//                       window alone (withH < finalOnlyH by more than the
//                       minimum gain); graftInputsOf splits a committed list
//   GL4 THE 17:42 FLIP  on the install decision's w0.38 the node's 24-graft
//                       memory prices far below both the 1 graft the stale
//                       search kept and grafting nothing; graftSetOn picks it
//   GL5 CPU             chooseGrafts on the live inputs at the plan's graft
//                       budget: the schedule stage runs inside it
//   GL6 WIRING          progress.js executes life-1 grafts, holds the install
//                       for them (bounded), carries lifeGrafts, re-prices the
//                       memory set on rebase; plan.js keys count lifeGrafts
//   GL7 THE RUNNING GRAFT inProgressSpecsOf: paid, remaining slot only

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const GP = await import("../../graftplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-graftlives-1742.json"), "utf8"));
const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");
const repo = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const fin = (x) => typeof x === "number" && isFinite(x);

const noGrafts = (inp) => {
  const o = { ...inp };
  delete o.finalGrafts;
  delete o.lifeGrafts;
  delete o.graftStartMoney;
  return o;
};
const basisOf = (p) => ({ kind: "wait", waitH: p.install.waitH, gains: p.install.gains });

export async function run() {
  const out = [];

  {
    const c = new Check("GL1", "THE GAME: a graft installs at finish and persists through installs; an install cancels one in progress; entropy survives installs");
    const gw = game("src/Work/GraftingWork.tsx");
    const pr = game("src/Prestige.ts");
    const pm = game("src/PersonObjects/Player/PlayerObjectGeneralMethods.ts");
    const ah = game("src/Augmentation/AugmentationHelpers.ts");
    const ga = game("src/PersonObjects/Grafting/GraftableAugmentation.ts");
    const k = game("src/Constants.ts");
    const need = [
      [gw, /if \(params\) Player\.loseMoney\(gAugs\[this\.augmentation\]\.cost/, "GraftingWork: the price is taken when the work starts"],
      [gw, /if \(!cancelled\) \{\s*applyAugmentation\(\{ name: augName, level: 1 \}\)/, "GraftingWork.finish: applied only when not cancelled"],
      [gw, /Player\.entropy \+= 1;\s*Player\.applyEntropy\(Player\.entropy\)/, "GraftingWork.finish: one entropy stack per graft"],
      [ah, /Player\.augmentations\.push\(ownedAug\)/, "applyAugmentation: onto Player.augmentations (installed, not queued)"],
      [pr, /Player\.reapplyAllAugmentations\(\);[\s\S]{0,200}Player\.applyEntropy\(Player\.entropy\)/, "prestigeAugmentation: re-applies the augmentations and the entropy"],
      [pm, /this\.finishWork\(true, true\)/, "Player.prestigeAugmentation: work in progress finished as CANCELLED"],
      [pm, /prestigeSourceFile[\s\S]{0,80}this\.entropy = 0/, "only prestigeSourceFile clears the entropy"],
      [ga, /baseCost \* CONSTANTS\.AugmentationGraftingCostMult/, "graft cost = baseCost x AugmentationGraftingCostMult"],
      [k, /AugmentationGraftingCostMult: 3,/, "AugmentationGraftingCostMult 3"],
      [k, /EntropyEffect: 0\.98,/, "EntropyEffect 0.98"],
    ];
    for (const [src, re, what] of need) {
      c.examined(1);
      if (!re.test(src)) c.fail(`game source moved: ${what}`, String(re));
    }
    c.note(`${need.length} source facts matched`);
    out.push(c);
  }

  {
    const c = new Check("GL2", "THE SIMULATOR: lifeGrafts lengthen their life, lift the climb, spill into the final window when the policy has no such life, and change nothing when absent");
    const base = noGrafts(F.p1748.exitinputs);
    const specs = F.p1748.graftMemory.grafts.map((g) => ({ ...g }));
    const cheap = [...specs].sort((a, b) => a.cost - b.cost).slice(0, 2);
    const k = 3;
    const r0 = X.exitHours({ ...base, installsFirst: k, firstInstallH: 0.5 });
    const r1 = X.exitHours({ ...base, installsFirst: k, firstInstallH: 0.5, lifeGrafts: cheap.map((g) => ({ ...g, life: 1 })) });
    c.examined(2);
    if (!fin(r0.hours) || !fin(r1.hours)) c.fail("unpriced", `${r0.why ?? ""} ${r1.why ?? ""}`);
    else {
      const leg = r1.lifeGraftLegs?.find((l) => l.life === 1);
      const slot = cheap.reduce((a, g) => a + g.slotH, 0);
      if (!leg) c.fail("no life-1 grafting leg published", JSON.stringify(r1.lifeGraftLegs));
      else {
        const want = leg.moneyH + Math.max(slot, 0.5);
        if (Math.abs(leg.lifeH - want) > 1e-9) c.fail(`life 1 is ${leg.lifeH}h, not moneyH + max(slot, base) = ${want}h`);
        if (!(leg.extraH > 0)) c.fail("a life that grafts must be longer than its base", JSON.stringify(leg));
      }
      // The climb's multiplier: the grafts' hacking, times their reputation
      // (and money) lift on each LATER life's batch — K^eRep x M^eBudget, the
      // measured responses — here installs 2..k.
      const gH = cheap.reduce((a, g) => a * g.hacking, 1);
      const gR = cheap.reduce((a, g) => a * g.rep, 1);
      const gM = cheap.reduce((a, g) => a * (g.money ?? 1), 1);
      const lift = (base.eRep > 0 ? Math.pow(gR, base.eRep) : 1) * (base.eBudget > 0 ? Math.pow(gM, base.eBudget) : 1);
      const want = gH * Math.pow(lift, k - 1);
      if (Math.abs(r1.mult / r0.mult - want) > 1e-9 * want) c.fail(`the climb's multiplier moved x${r1.mult / r0.mult}, not the grafts' hacking x${gH} with ${k - 1} later batches lifted x${lift}`);
      c.note(`k=${k}: ${r0.hours.toFixed(3)}h -> ${r1.hours.toFixed(3)}h with ${cheap.length} grafts in life 1 (life +${leg?.extraH?.toFixed(3)}h, mult x${(r1.mult / r0.mult).toFixed(4)})`);
    }
    // Spill: a life the policy does not have is the final window.
    const spill = X.exitHours({ ...base, installsFirst: 1, firstInstallH: 0.5, lifeGrafts: cheap.map((g) => ({ ...g, life: 5 })), graftStartMoney: 0 });
    const fw = X.exitHours({ ...base, installsFirst: 1, firstInstallH: 0.5, finalGrafts: cheap, graftStartMoney: 0 });
    c.examined(2);
    if (!(fin(spill.hours) && fin(fw.hours) && Math.abs(spill.hours - fw.hours) < 1e-9)) c.fail(`a graft in a life the policy lacks must price as the final window: ${spill.hours} vs ${fw.hours}`);
    // Absent: identical to the inputs without the field; an empty list too.
    for (const kk of [0, 1, 4]) {
      const a = X.exitHours({ ...base, installsFirst: kk, firstInstallH: 0.5 });
      const b = X.exitHours({ ...base, installsFirst: kk, firstInstallH: 0.5, lifeGrafts: [] });
      c.examined(1);
      if (a.hours !== b.hours) c.fail(`an empty lifeGrafts changed the price at k=${kk}: ${a.hours} vs ${b.hours}`);
    }
    // A bad entry is a refusal, named.
    const bad = X.exitHours({ ...base, installsFirst: 2, lifeGrafts: [{ ...cheap[0], life: 0 }] });
    c.examined(1);
    if (bad.hours !== null || !/life index/.test(bad.why ?? "")) c.fail("a life graft without a life index must refuse, named", JSON.stringify(bad).slice(0, 200));
    out.push(c);
  }

  {
    const c = new Check("GL3", "THE SCHEDULE on the live 17:48 inputs: grafts the current life can pay for beat the final window alone; the committed list splits into lifeGrafts and finalGrafts");
    const p = F.p1748;
    const traj = P.trajectoryOf(basisOf(p));
    const wo = noGrafts(p.exitinputs);
    const r = GP.chooseGrafts({ candidates: F.candidates, priceExit: traj, base: wo, intelligence: 0, ownedNames: F.ownedInstalled, seeds: [p.graftMemory.names] });
    c.examined(1);
    if (!r.grafts?.length || !r.schedule) c.fail("no graft set or schedule", r.why);
    else {
      const early = r.grafts.filter((g) => g.life === 1);
      c.note(`${r.why}; schedule ${r.schedule.family}: ${r.schedule.h}h vs ${r.schedule.finalOnlyH}h final-only (min gain ${r.schedule.minGainH}h); early: ${early.map((g) => g.name).join(", ")}`);
      if (!r.schedule.taken || !early.length) c.fail("the live inputs' schedule should graft in the current life", JSON.stringify({ ...r.schedule, tried: undefined }));
      if (!(r.withH < r.schedule.finalOnlyH - r.schedule.minGainH)) c.fail(`the scheduled exit ${r.withH}h does not beat the final window alone ${r.schedule.finalOnlyH}h by the minimum gain`);
      // withH IS the with-run on the split inputs (nothing added beside it).
      const inputs = { ...wo, ...GP.graftInputsOf(r.grafts.map((g) => g.spec), r.startMoney) };
      const h = traj(inputs);
      c.examined(1);
      if (!(fin(h) && Math.abs(h - r.withH) < 1e-6)) c.fail(`withH ${r.withH} is not the trajectory of the committed split (${h})`);
      if (!Array.isArray(inputs.lifeGrafts) || inputs.lifeGrafts.length !== early.length || inputs.finalGrafts.length !== r.grafts.length - early.length) c.fail("graftInputsOf did not split by life", JSON.stringify({ l: inputs.lifeGrafts?.length, f: inputs.finalGrafts?.length }));
      // Every life graft's prerequisites precede it in the committed order.
      const order = r.grafts.map((g) => g.name);
      for (const g of r.grafts) {
        const a = F.candidates.find((x) => x.name === g.name);
        for (const pre of a?.prereqs ?? []) if (order.includes(pre) && order.indexOf(pre) > order.indexOf(g.name)) c.fail(`${g.name} precedes its prerequisite ${pre} in the committed order`);
      }
    }
    if (GP.graftInputsOf([], 5) !== null) c.fail("graftInputsOf([]) must be null");
    out.push(c);
  }

  {
    const c = new Check("GL4", "THE 17:42 FLIP: on w0.38 the 24-graft memory beats the searched 1 graft and nothing; the rebase's set choice (graftSetOn) takes it");
    const p = F.p1742;
    const traj = P.trajectoryOf(basisOf(p));
    const wo = noGrafts(p.exitinputs);
    const mem = p.graftMemory;
    const sets = [
      { from: "this pass", specs: p.exitinputs.finalGrafts, startMoney: 0 },
      { from: "the node's graft memory", specs: mem.grafts, startMoney: mem.startMoney },
    ].map((a) => ({ ...a, inputs: { ...wo, ...GP.graftInputsOf(a.specs, a.startMoney) } }));
    const pick = GP.graftSetOn((x) => traj(x), sets);
    const none = traj(wo);
    c.examined(3);
    c.note(`w${p.install.waitH}: none ${fin(none) ? none.toFixed(2) : none}h; ${pick.priced.map((x) => `${x.from} (${x.n}) ${x.h}h`).join("; ")}; live record: ${p.grafts.key} (${p.grafts.flippedOnRebase ?? ""})`);
    if (pick.set?.from !== "the node's graft memory") c.fail("the memory set must win on the install decision's trajectory", JSON.stringify(pick.priced));
    const memH = pick.priced.find((x) => x.from === "the node's graft memory")?.h;
    if (!(fin(memH) && fin(none) && memH < none - 50)) c.fail(`the memory set (${memH}h) should beat grafting nothing (${none}h) by far`);
    if (!GP.sameGraftSet(mem.grafts, [...mem.grafts].reverse()) || GP.sameGraftSet(mem.grafts, p.exitinputs.finalGrafts)) c.fail("sameGraftSet is wrong");
    out.push(c);
  }

  {
    const c = new Check("GL5", "CPU: the graft search with its schedule stage at the plan's budget (250ms) on the live inputs");
    const p = F.p1748;
    const traj = P.trajectoryOf(basisOf(p));
    const t0 = performance.now();
    const r = GP.chooseGrafts({ candidates: F.candidates, priceExit: traj, base: noGrafts(p.exitinputs), intelligence: 0, ownedNames: F.ownedInstalled, seeds: [p.graftMemory.names], budgetMs: 250, now: () => performance.now() });
    const ms = performance.now() - t0;
    c.examined(1);
    c.note(`${ms.toFixed(0)}ms, truncated ${r.truncated}, schedule tried ${r.schedule?.tried?.length ?? 0} (truncated ${r.schedule?.truncated})`);
    // One exit simulation past the deadline at most (~40ms), and a margin for a loaded test machine.
    if (ms > 250 + 150) c.fail(`the search overran its budget: ${ms.toFixed(0)}ms`);
    if (!(GP.SCHEDULE_MS > 0 && GP.SCHEDULE_MS < 250)) c.fail("SCHEDULE_MS must be a slice of the graft budget");
    out.push(c);
  }

  {
    const c = new Check("GL6", "WIRING: progress.js grafts this life's scheduled grafts, holds the install for them (bounded), carries lifeGrafts, and re-prices every held set on rebase; plan.js keys count them");
    const prog = repo("progress.js");
    const plan = repo("plan.js");
    const need = [
      [prog, /const pool = finalNow \? d\.grafts : lifeNow/, "the graft step takes this life's scheduled grafts before the final window"],
      [prog, /gate\.install && !forcedInstall && lifeGraftHold\?\.hold/, "the install is held for this life's scheduled grafts"],
      [prog, /function lifeGraftHoldOf[\s\S]{0,900}heldH > capH/, "the hold is bounded"],
      [prog, /return graftInputsOf\(inProgressSpecsOf\(c\.grafts, work, intel\)/, "the carry splits lifeGrafts from finalGrafts"],
      [prog, /yield\* rp\.pick\(\)/, "the rebase re-prices every held set first"],
      [prog, /delete withoutIn\.lifeGrafts/, "the without-run has no life grafts"],
      [plan, /inputs\.lifeGrafts\.length/, "noiseKeyOf counts life grafts"],
      [plan, /names\(installInputs\.lifeGrafts\)/, "graftCarryCheckOf counts life grafts"],
    ];
    for (const [src, re, what] of need) {
      c.examined(1);
      if (!re.test(src)) c.fail(`missing: ${what}`, String(re));
    }
    // The noise key is the graft count wherever the schedule puts them.
    const k1 = P.noiseKeyOf({ kind: "never" }, { finalGrafts: [1, 2, 3] });
    const k2 = P.noiseKeyOf({ kind: "never" }, { finalGrafts: [1], lifeGrafts: [2, 3] });
    if (k1 !== k2) c.fail(`noise key changes with the schedule: ${k1} vs ${k2}`);
    if (P.inputsKeyOf({ a: 1, lifeGrafts: [1] }) !== P.inputsKeyOf({ a: 1 })) c.fail("inputsKeyOf must ignore lifeGrafts");
    out.push(c);
  }

  {
    const c = new Check("GL7", "THE RUNNING GRAFT: paid (cost 0) with only its remaining slot hours; priced by exitplan");
    const specs = [
      { name: "A", cost: 5e9, slotH: 2, hacking: 1.1, exp: 1, rep: 1 },
      { name: "B", cost: 1e9, slotH: 1, hacking: 1, exp: 1, rep: 1 },
    ];
    const s = GP.inProgressSpecsOf(specs, { type: "GRAFTING", augmentation: "A", cyclesWorked: 18000 }, 0);
    c.examined(2);
    if (!(s[0].paid === true && s[0].cost === 0 && Math.abs(s[0].slotH - 1) < 1e-9)) c.fail("A: 18000 cycles x 200ms = 1h done of 2h", JSON.stringify(s[0]));
    if (s[1] !== specs[1]) c.fail("B must be unchanged");
    if (GP.inProgressSpecsOf(specs, { type: "FACTION" }) !== specs) c.fail("no graft running: unchanged");
    const base = noGrafts(F.p1748.exitinputs);
    const h = X.exitHours({ ...base, installsFirst: 1, firstInstallH: 0.5, lifeGrafts: [{ ...s[0], life: 1 }] });
    if (!fin(h.hours)) c.fail("a paid running graft must price", h.why);
    out.push(c);
  }

  return out;
}
