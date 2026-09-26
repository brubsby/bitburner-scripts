// [GP] grafting priced in hours off the exit — graftplan.js.
//
// The failure this exists to prevent is a wrong ANSWER, not a crash. Asked by
// hand whether to graft, the first reply was "no, it costs 114h" — because it
// priced the strategy that first came to mind (the 24 CHEAPEST augmentations,
// to clear the Daedalus count gate) instead of searching. Optimised properly
// the same inputs say graft six, saving 64.9h. The cheapest augmentations are
// the worst possible grafts: a flat 2% on every multiplier for +5% on one.
//
// So what is pinned here is that the module SEARCHES rather than ranks, that
// it can return "graft nothing", and that the game's own constants and gates
// still hold.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const gp = await import("../../graftplan.js");
const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");

/**
 * A priceExit stub with the real shape: hours fall as the multipliers rise,
 * and the grafts (b.finalGrafts, graftSpecOf entries) are legs of the run —
 * their multipliers act, and their slot hours and money are charged, INSIDE
 * it (1h per $1b), the way exitplan's final window charges them.
 */
function fakeExit() {
  return (b) => {
    const gs = b.finalGrafts ?? [];
    const prod = (k) => gs.reduce((a, g) => a * g[k], 1);
    const hm = (b.hackingMult ?? 1) * prod("hacking");
    const ex = (b.expPerSec ?? 1) * prod("exp");
    const rp = (b.repPerSec ?? 1) * prod("rep");
    const slot = gs.reduce((a, g) => a + g.slotH, 0);
    const money = gs.reduce((a, g) => a + g.cost, 0) / 1e9;
    // installs + climb + reputation, the three legs that actually move.
    return 400 / Math.pow(hm, 0.5) + 60 / Math.pow(ex / 300, 0.5) + 200 / (rp / 3.5) + slot + money;
  };
}
const BASE = { hackingMult: 0.53, expPerSec: 316, repPerSec: 3.54 };
const aug = (name, mults, baseCost, extra = {}) => ({ name, mults, baseCost, ...extra });

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("GP1", "every grafting constant and formula is the game's");
  {
    c1.examined(6);
    const consts = game("src/Constants.ts");
    const pairs = [
      ["AugmentationGraftingCostMult", gp.GRAFT_COST_MULT],
      ["AugmentationGraftingTimeBase", gp.GRAFT_TIME_BASE_MS],
      ["MillisecondsPerHalfHour", gp.HALF_HOUR_MS],
      ["EntropyEffect", gp.ENTROPY_EFFECT],
    ];
    for (const [key, mine] of pairs) {
      const src = Number(consts.match(new RegExp(`${key}:\\s*([0-9.]+)`))?.[1]);
      if (!isFinite(src)) c1.fail(`could not read ${key} from Constants.ts`, "a rotted parser, not a clean repo");
      else if (src !== mine) c1.fail(`${key}: graftplan ${mine} vs source ${src}`);
    }
    // The time formula, transcribed from GraftableAugmentation.time.
    const ga = game("src/PersonObjects/Grafting/GraftableAugmentation.ts");
    if (!/Math\.log2\(antiLog\)/.test(ga)) c1.fail("the graft time is no longer log2 of the multiplier sum");
    if (!/\)\s*\/\s*2;/.test(ga)) c1.fail("the graft time is no longer halved");
    // Value-for-value at a known shape: one mult of 1.2 -> sum 1.2.
    const want = ((3600000 * Math.log2(1.2) + 1800000) / 2);
    if (Math.abs(gp.graftTimeMs({ hacking: 1.2 }, 0) - want) > 1e-9) c1.fail("graftTimeMs must match the game's expression at intelligence 0");
    // Intelligence divides it.
    if (!(gp.graftTimeMs({ hacking: 1.2 }, 500) < want)) c1.fail("intelligence must shorten the graft");
    if (gp.graftCost(1e7) !== 3e7) c1.fail("graft cost is baseCost x 3");
    if (gp.graftCost(-1) !== null || gp.graftTimeMs(null, 0) !== null) c1.fail("unreadable inputs must refuse");
    // The city gate is real and is not ours to invent.
    if (!/CityName\.NewTokyo/.test(game("src/NetscriptFunctions/Grafting.ts"))) c1.fail("the New Tokyo gate is gone from graftAugmentation");
    if (gp.GRAFT_CITY !== "New Tokyo") c1.fail("GRAFT_CITY must be the game's string");
    c1.note(`cost x${gp.GRAFT_COST_MULT}, entropy ${gp.ENTROPY_EFFECT}^stacks, time (base*log2(sum)+30min)/2 — all read from source`);
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("GP2", "entropy is per-graft, hits every multiplier, and survives installs");
  {
    c2.examined(4);
    if (gp.entropyNerf(0) !== 1) c2.fail("no grafts, no penalty");
    if (Math.abs(gp.entropyNerf(24) - Math.pow(0.98, 24)) > 1e-12) c2.fail("24 grafts is 0.98^24");
    if (gp.entropyNerf(-1) !== null) c2.fail("an unreadable stack count must refuse");
    // The two facts the whole verdict rests on, read from the game.
    const prestige = game("src/Prestige.ts");
    if (!/Player\.applyEntropy\(Player\.entropy\)/.test(prestige)) {
      c2.fail("prestigeAugmentation no longer re-applies entropy — this module prices it as surviving installs");
    }
    const gm = game("src/PersonObjects/Player/PlayerObjectGeneralMethods.ts");
    if (!/prestigeSourceFile[\s\S]{0,200}?this\.entropy = 0/.test(gm)) {
      c2.fail("only a BitNode change clears entropy — if that changed, the per-node framing is wrong");
    }
    // Sleeves are NOT affected: applyEntropy rewrites Player.mults alone.
    const ent = game("src/PersonObjects/Grafting/EntropyAccumulation.ts");
    if (/sleeve/i.test(ent)) c2.fail("entropy now touches sleeves — fleet output was priced as immune");
    c2.note("entropy survives installs (Prestige.ts) and clears only on a BitNode change; sleeves are immune");
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("GP3", "prerequisites gate the plan, because the game's availability list does not");
  {
    c3.examined(5);
    // The trap, asserted against source: the list ignores prereqs, the call does not.
    const helpers = game("src/PersonObjects/Grafting/GraftingHelpers.ts");
    if (/prereq/i.test(helpers)) c3.fail("getGraftingAvailableAugs now filters prerequisites — this module's ordering assumes it does not");
    if (!/hasAugmentationPrereqs/.test(game("src/NetscriptFunctions/Grafting.ts"))) {
      c3.fail("graftAugmentation no longer checks prerequisites — act-graft.js's refusal message names it");
    }
    if (!gp.prereqsMet({ prereqs: [] }, [])) c3.fail("no prerequisites is always met");
    if (gp.prereqsMet({ prereqs: ["A"] }, [])) c3.fail("an unmet prerequisite must block");
    if (!gp.prereqsMet({ prereqs: ["A"] }, ["A"])) c3.fail("an owned prerequisite satisfies");

    // And the PLAN must respect it: a strong aug behind an unowned prereq is
    // only reachable after the prereq, never before.
    const pool = [
      // Gate is individually NEGATIVE (+2% hacking for a 2% entropy stack);
      // Strong behind it is worth far more than the pair costs. A greedy that
      // only adds one aug at a time cannot see past Gate and takes neither —
      // which is exactly the shape prerequisites create, since a G1 implant is
      // deliberately weaker than the G2 it gates.
      aug("Gate", { hacking: 1.02 }, 1e6),
      aug("Strong", { hacking: 2.0 }, 1e6, { prereqs: ["Gate"] }),
    ];
    const r = gp.chooseGrafts({ candidates: pool, priceExit: fakeExit(), base: BASE, money: 1e9, intelligence: 0, ownedNames: [] });
    const names = r.grafts.map((g) => g.name);
    if (names.includes("Strong") && names.indexOf("Gate") > names.indexOf("Strong")) {
      c3.fail(`a prerequisite must be grafted BEFORE what needs it, got ${names.join(" -> ")}`);
    }
    if (names.includes("Strong") && !names.includes("Gate")) c3.fail("Strong cannot be grafted without Gate");
    if (!names.includes("Strong")) c3.fail("the pair is worth far more than it costs — a plan that takes neither has not looked through the prerequisite");
    // A chain with a MISSING link is refused, not half-built. NOTE: chainFor's
    // own `return null` is shadowed by the bundle-validity check below it —
    // mutating either alone leaves the behaviour correct, so this pins the
    // OUTCOME (nothing planned) rather than either guard.
    const orphan = gp.chooseGrafts({ candidates: [aug("Orphan", { hacking: 2.0 }, 1e6, { prereqs: ["NotInPool"] })], priceExit: fakeExit(), base: BASE, money: 1e9, intelligence: 0, ownedNames: [] });
    if (orphan.grafts.length !== 0) c3.fail("an augmentation whose prerequisite is not obtainable must not be planned");
    c3.note(`with a prereq chain the plan ordered: ${names.join(" -> ") || "(nothing)"}`);
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("GP4", "it SEARCHES: cheap augs lose, good ones win, and 'graft nothing' is expressible");
  {
    c4.examined(6);
    const exit = fakeExit();
    // THE CASE THAT REVERSED THE HAND ANSWER. A pool of cheap junk plus a few
    // strong reputation augs: ranking by price takes the junk, searching does not.
    const junk = Array.from({ length: 20 }, (_, i) => aug(`Junk${i}`, { hacking: 1.01 }, 4e6));
    const good = [
      aug("RepBig", { faction_rep: 1.2, company_rep: 1.2 }, 550e6),
      aug("RepMid", { faction_rep: 1.15 }, 400e6),
      aug("HackMid", { hacking: 1.08, hacking_exp: 1.15 }, 225e6),
    ];
    const r = gp.chooseGrafts({ candidates: [...junk, ...good], priceExit: exit, base: BASE, money: 3.77e9, intelligence: 95, ownedNames: [] });
    if (!r.grafts) c4.fail(`must produce a plan: ${r.why}`);
    const names = r.grafts.map((g) => g.name);
    if (!names.includes("RepBig")) c4.fail(`the search must take the strong reputation aug, got ${names.join(", ")}`);
    if (names.filter((n) => n.startsWith("Junk")).length > names.length / 2) {
      c4.fail(`a price-ranked plan takes the junk; a searched one must not: ${names.join(", ")}`);
    }
    if (!(r.netHours > 0)) c4.fail("a plan that does not beat doing nothing must not be returned as the plan");
    // THE SLOT IS INSIDE THE RUN, not subtracted beside it: the decision is
    // the with-run's exit minus the without-run's, recomputed here on the same
    // inputs with the plan's own grafts and start balance.
    if (!(r.slotHours > 0)) c4.fail("the plan must report the hours grafting occupies");
    const wo = exit(BASE);
    const wi = exit({ ...BASE, finalGrafts: r.grafts.map((g) => g.spec), graftStartMoney: r.startMoney });
    if (Math.abs(r.deltaH - (wi - wo)) > 1e-9 || Math.abs(r.netHours + r.deltaH) > 1e-9) {
      c4.fail(`the decision must be withH - withoutH on one input set: deltaH ${r.deltaH} vs ${wi - wo}`);
    }
    // GRAFT NOTHING is a result, not an inexpressible case: junk only.
    const none = gp.chooseGrafts({ candidates: junk, priceExit: exit, base: BASE, money: 3.77e9, intelligence: 95, ownedNames: [] });
    if (none.grafts === null) c4.fail("a pool of bad augs is not an error");
    if (none.grafts.length !== 0) c4.fail(`junk-only must graft NOTHING, got ${none.grafts.map((g) => g.name).join(", ")}`);
    if (!/nothing/.test(none.why)) c4.fail("and it must say so");
    // Money is a cost INSIDE the run: priced dear enough, nothing is grafted.
    const dear = gp.chooseGrafts({ candidates: good.map((a) => ({ ...a, baseCost: a.baseCost * 1e3 })), priceExit: exit, base: BASE, intelligence: 95, ownedNames: [] });
    if (dear.grafts.length !== 0) c4.fail("grafts whose money costs the run more than they save must not be planned");
    c4.note(`searched plan: ${names.join(", ")} — $${(r.spend / 1e6).toFixed(0)}m, ${r.slotHours.toFixed(1)}h slot, net +${r.netHours.toFixed(1)}h`);
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("GP5", "unreadable inputs REFUSE — a graft is money and permanent entropy");
  {
    c5.examined(5);
    const exit = fakeExit();
    const ok = { candidates: [aug("A", { hacking: 1.2 }, 1e6)], priceExit: exit, base: BASE, money: 1e9, intelligence: 0 };
    for (const [what, o] of [
      ["no priceExit", { ...ok, priceExit: null }],
      ["no base", { ...ok, base: null }],
      ["no candidates", { ...ok, candidates: null }],
      ["exit unpriceable", { ...ok, priceExit: () => null }],
    ]) {
      const r = gp.chooseGrafts(o);
      if (r.grafts !== null || !r.why) c5.fail(`${what} must REFUSE by name, got ${JSON.stringify(r).slice(0, 90)}`);
    }
    c5.note("four unreadable inputs each refuse by name rather than planning a spend");
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c6 = new Check("GP6", "act-graft.js reads the boolean the game refuses with");
  {
    c6.examined(3);
    const src = fs.readFileSync(path.join(REPO_ROOT, "act-graft.js"), "utf8");
    if (!/=== true/.test(src)) c6.fail("act-graft.js must test the return value explicitly — graftAugmentation returns false, it does not throw");
    if (!/refused/.test(src)) c6.fail("a refusal must be published as a refusal, not as ok:false with no reason");
    if (!/prerequisites/i.test(src)) c6.fail("the refusal message must name the prerequisite case — the availability list does not filter it");
    c6.note("the actor distinguishes throw (wrong city), refusal (money/prereqs) and success");
  }
  checks.push(c6);

  // ---------------------------------------------------------------------
  const X = await import("../../exitplan.js");
  const c7 = new Check("GP7", "exitplan finalGrafts: a graft is paid, slotted and applied INSIDE the final window, and absent it nothing changes");
  {
    c7.examined(7);
    const F = await import("./fixture-bn8-graft.mjs");
    const I = { ...F.INPUTS };
    const H = (x, k) => X.exitHours({ ...x, installsFirst: k });
    const base0 = H(I, 0);
    const K = X.bestExitPolicy(I).best?.installsFirst ?? 3;
    const base3 = H(I, K);
    if (!(base0.hours > 0) || !(base3.hours > 0)) c7.fail("the fixture's exit must price", JSON.stringify([base0.why, base3.why]));
    // 1. Absent -> byte-identical legs (every other node, every other caller).
    if (JSON.stringify(H({ ...I, finalGrafts: [] }, K)) !== JSON.stringify(base3)) c7.fail("an empty graft list must price exactly as no grafts");
    // 2. A graft that buys nothing costs: money, slot and entropy are charged.
    const dud = { name: "Dud", cost: 5e9, slotH: 1, hacking: 0.98, exp: 0.98, rep: 0.98 };
    const withDud = H({ ...I, finalGrafts: [dud] }, K);
    if (!(withDud.hours > base3.hours)) c7.fail(`a graft that only adds entropy must lengthen the exit: ${withDud.hours} vs ${base3.hours}`);
    // 3. The money: a graft dearer than the window's opening balance is a money leg.
    if (!withDud.legs.some((l) => l.leg === "graft money")) c7.fail("a graft dearer than the balance must be a money leg of the window");
    // 4. The slot: the climb waits for the last graft (an install cancels one).
    const long = { name: "Long", cost: 1e6, slotH: 500, hacking: 2, exp: 2, rep: 1 };
    const withLong = H({ ...I, finalGrafts: [long] }, K);
    if (!(withLong.hours >= base3.legs[0].hours + 500)) c7.fail(`a 500h graft must hold the exit past the window start + 500h, got ${withLong.hours}`);
    // ...and the CLIMB starts after it even where the slot does not bind the
    // window: a 9h graft ends after the hoard, so the climb runs from +9h.
    const withNine = H({ ...I, finalGrafts: [{ name: "Nine", cost: 1e6, slotH: 9, hacking: 1, exp: 1, rep: 1 }] }, K);
    const climbOf = (r) => r.legs.find((l) => l.leg === "climb to exit level")?.hours ?? 0;
    if (!(withNine.hours >= base3.legs[0].hours + 9 + climbOf(withNine) - 1e-6)) c7.fail(`the climb must wait for the last graft: ${withNine.hours}h`);
    // 2b. The money: a graft that buys nothing and carries no entropy still costs its price.
    const priced = H({ ...I, finalGrafts: [{ name: "Priced", cost: 20e9, slotH: 0, hacking: 1, exp: 1, rep: 1 }] }, K);
    if (!(priced.hours > base3.hours + 0.05)) c7.fail(`a $20b graft must lengthen the money legs: ${priced.hours} vs ${base3.hours}`);
    // 5. The multiplier: a strong HACKING graft shortens the climb, on the final window only.
    const strong = { name: "Strong", cost: 1e6, slotH: 0.5, hacking: 1.5 * 0.98, exp: 1, rep: 1 };
    const withStrong = H({ ...I, finalGrafts: [strong] }, K);
    const climb = (r) => r.legs.find((l) => l.leg === "climb to exit level")?.hours;
    if (!(climb(withStrong) < climb(base3))) c7.fail("a hacking graft must shorten the final climb");
    if (Math.abs(withStrong.legs[0].hours - base3.legs[0].hours) > 1e-9) c7.fail("the lives before the final window keep their measured cadence — a final-window graft must not change them");
    // 6. The start balance is a real parameter: waiting for more money moves the money leg.
    const a = H({ ...I, finalGrafts: [dud], graftStartMoney: 0 }, K);
    const b = H({ ...I, finalGrafts: [dud], graftStartMoney: 50e9 }, K);
    if (!(b.legs.some((l) => l.leg === "graft start money")) || a.legs.some((l) => l.leg === "graft start money")) c7.fail("graftStartMoney must add the start-balance leg, and 0 must not");
    // 7. NOT_GRAFTABLE is the game's isSpecial list.
    const src = game("src/Augmentation/Augmentations.ts");
    const en = game("src/Augmentation/Enums.ts");
    const enumMap = {};
    for (const m of en.matchAll(/^\s*(\w+) = "([^"]+)",/gm)) enumMap[m[1]] = m[2];
    const special = [];
    for (const m of src.matchAll(/\[AugmentationName\.(\w+)\]:\s*\{([\s\S]*?)\n    \},/g)) if (/isSpecial:\s*true/.test(m[2])) special.push(enumMap[m[1]] ?? m[1]);
    if (special.length < 10) c7.fail(`parsed only ${special.length} special augmentations from source — a rotted parser, not a clean list`);
    const missing = special.filter((n) => !gp.NOT_GRAFTABLE.has(n));
    const extra = [...gp.NOT_GRAFTABLE].filter((n) => !special.includes(n));
    if (missing.length || extra.length) c7.fail(`NOT_GRAFTABLE drifted from source isSpecial: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}`);
    // And the price is divided back to the base the graft cost uses.
    const cands = gp.graftCandidatesOf({ names: ["A", "The Red Pill"], stats: { A: { hacking: 1.1 }, "The Red Pill": {} }, prereqs: {}, price: { A: 3.61e9, "The Red Pill": 1 }, owned: [], augMoneyCost: 1, queuedNonSoA: 2, sf11: 0 });
    if (cands.length !== 1 || Math.abs(cands[0].baseCost - 1e9) > 1) c7.fail(`a price at 2 queued (x1.9^2) must divide back to its base: ${JSON.stringify(cands)}`);
    c7.note(`fixture ${F.AT}: exit at ${K} installs ${base3.hours.toFixed(2)}h; +entropy-only graft ${withDud.hours.toFixed(2)}h; +strong graft climb ${climb(base3).toFixed(2)}h -> ${climb(withStrong).toFixed(2)}h; ${special.length} special augmentations`);
  }
  checks.push(c7);

  // ---------------------------------------------------------------------
  const c8 = new Check("GP8", "the graft decision is the SIMULATED with-vs-without on the live BN8 fixture, not a formula");
  {
    c8.examined(4);
    const F = await import("./fixture-bn8-graft.mjs");
    const priceExit = (x) => {
      const r = X.bestExitPolicy(x);
      return r.degenerate ? null : r.best?.hours ?? null;
    };
    const r = gp.chooseGrafts({ candidates: F.CANDIDATES, priceExit, base: F.INPUTS, intelligence: F.INTELLIGENCE, ownedNames: F.OWNED });
    if (!r.grafts) c8.fail(`the fixture must price: ${r.why}`);
    else {
      // The decision, recomputed independently on the SAME inputs.
      const withoutH = priceExit(F.INPUTS);
      const withH = priceExit({ ...F.INPUTS, finalGrafts: r.grafts.map((g) => g.spec), graftStartMoney: r.startMoney });
      if (Math.abs(r.withoutH - withoutH) > 1e-9 || Math.abs(r.withH - withH) > 1e-9 || Math.abs(r.deltaH - (withH - withoutH)) > 1e-9) {
        c8.fail(`deltaH must be bestExitPolicy(with) - bestExitPolicy(without): ${r.deltaH} vs ${withH - withoutH}`);
      }
      // A graft paid in the final window credits the final window only: the
      // node-wide bump (the replaced shortcut) must price differently.
      const gH = r.grafts.reduce((a, g) => a * g.spec.hacking, 1);
      const bumped = priceExit({ ...F.INPUTS, hackingMult: F.INPUTS.hackingMult * gH });
      if (r.grafts.length && Math.abs(bumped - withH) < 1e-6) c8.fail("the with-run must not be the whole-node multiplier bump");
      if (!(r.grafts.length > 0 && r.deltaH < 0)) c8.fail(`on the 2026-09-26 BN8 state the search must find a saving (got ${r.why})`);
      // Starting the grafting later than 'each when affordable' must be searched.
      if (!(typeof r.startMoney === "number" && r.startMoney >= 0)) c8.fail("the with-run's start balance must be published");
      c8.note(`BN8 ${F.AT}: ${r.why}; start balance $${(r.startMoney / 1e9).toFixed(1)}b; grafts ${r.grafts.map((g) => g.name).join(", ")}`);
    }
  }
  checks.push(c8);

  // ---------------------------------------------------------------------
  const c9 = new Check("GP9", "progress.js commits the graft decision through the plan and grafts only in the final window");
  {
    c9.examined(7);
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const fn = src.slice(src.indexOf("function graftDecisionOf("), src.indexOf("function carriedGraftsOf("));
    if (!/yield\* chooseGraftsGen\(/.test(fn) || !/yield\* decideAmongGen\(/.test(fn)) c9.fail("graftDecisionOf must search with chooseGrafts and commit with plan.decideAmong, both run in the pass pacer's slices (generators)");
    if (!/key: 'none', noiseKey: noiseKeyOf\(basis, withoutIn\), sim:/.test(fn) || !/key: 'grafts', noiseKey: noiseKeyOf\(basis, withIn\), sim:/.test(fn) || !/const basis = basisOf\(pc\.prev\?\.decisions\?\.install/.test(fn)) c9.fail("the plan's options must be the two trajectories, none and grafts, priced on the committed install's trajectory (basisOf)");
    if (!/canUseGrafting\(info\)/.test(fn)) c9.fail("grafting must be gated on sfgate.canUseGrafting");
    if (!/\.\.\.\(graftCarry \?\? \{\}\)/.test(src)) c9.fail("exitInputsOf must carry the committed grafts into every decision's trajectory");
    if (!/d\.finalWindowNow === true && installKey === 'never'/.test(src)) c9.fail("a graft must be ordered only when the committed trajectory's final window is now");
    if (!/work\?\.type === 'GRAFTING'\) \{[\s\S]{0,400}install HELD/.test(src)) c9.fail("an install must be held while a graft runs (it cancels the graft and keeps its money)");
    if (!/grafts: pc\.decisions\.grafts \?\? pc\.prev\?\.decisions\?\.grafts/.test(src)) c9.fail("/tel/plan.txt must carry decisions.grafts");
    if (!/graft: \["GraftingWork"\]/.test(fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8"))) c9.fail("healthcheck ORDER NOT HELD must know the 'graft' slot owner");
    c9.note("search -> plan.decideAmong(none, grafts) -> exitInputsOf carries it -> ordered only in the final window -> install held while grafting");
  }
  checks.push(c9);

  // ---------------------------------------------------------------------
  const c10 = new Check("GP10", "a compounding money leg lands on its curve: exact against ln(T/m)/r, and split == whole (a graft paid mid-hoard is not flattered)");
  {
    c10.examined(3);
    const F = await import("./fixture-bn8-graft.mjs");
    const r = F.INPUTS.capitalReturnPerSec;
    const o = { incomeAtLevel1: 0, mult: 1, exp0: 0, capitalReturnPerSec: r, capitalCap: F.INPUTS.capitalCap, flatPerSec: 0 };
    const whole = X.hoursToMoney(100e9, { ...o, money0: 250e6 });
    const exact = Math.log(100e9 / 250e6) / (r * 3600);
    if (!(Math.abs(whole - exact) < 0.01)) c10.fail(`$250m -> $100b at r=${r}/s: ${whole}h vs exact ${exact}h`);
    const split = X.hoursToMoney(5e9, { ...o, money0: 250e6 }) + X.hoursToMoney(100e9, { ...o, money0: 5e9 });
    if (!(Math.abs(split - whole) < 0.01)) c10.fail(`one leg split in two must cost the same: ${split}h vs ${whole}h`);
    // With a LEVEL-SCALED income beside the capital (the step holds it at its
    // start-of-step value) the split must still equal the whole.
    const lv = { ...o, incomeAtLevel1: 2e4, mult: 3, exp0: 0, expPerSec: 8000 };
    const wholeL = X.hoursToMoney(100e9, { ...lv, money0: 250e6 });
    const t1 = X.hoursToMoney(5e9, { ...lv, money0: 250e6 });
    const splitL = t1 + X.hoursToMoney(100e9, { ...lv, money0: 5e9, exp0: 8000 * t1 * 3600 });
    if (!(Math.abs(splitL - wholeL) < 0.05)) c10.fail(`with level-scaled income, split ${splitL}h must equal whole ${wholeL}h`);
    // The warm-up ends on its hour: 0.16h of no capital adds ~0.16h, not a whole step.
    const warm = X.hoursToMoney(100e9, { ...o, money0: 250e6, capitalWarmupH: 0.16 });
    if (!(Math.abs(warm - whole - 0.16) < 0.02)) c10.fail(`a 0.16h warm-up must add ~0.16h: ${warm - whole}h`);
    c10.note(`$250m -> $100b: ${whole.toFixed(4)}h (exact ${exact.toFixed(4)}h), split ${split.toFixed(4)}h, +0.16h warm-up ${(warm - whole).toFixed(3)}h`);
  }
  checks.push(c10);

  return checks;
}
