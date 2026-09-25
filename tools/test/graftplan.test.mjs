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

/** A priceExit stub with the real shape: hours fall as the multipliers rise. */
function fakeExit() {
  return (b) => {
    const hm = b.hackingMult ?? 1;
    const ex = b.expPerSec ?? 1;
    const rp = b.repPerSec ?? 1;
    // installs + climb + reputation, the three legs that actually move.
    return 400 / Math.pow(hm, 0.5) + 60 / Math.pow(ex / 300, 0.5) + 200 / (rp / 3.5);
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
    // NET OF THE WORK SLOT, not gross — grafting is player work.
    if (!(r.slotHours > 0)) c4.fail("the plan must account for the hours grafting occupies");
    if (Math.abs(r.netHours - (r.baseline - r.exitHours - r.slotHours)) > 1e-6) {
      c4.fail("netHours must be baseline - exit - slotHours, so the work slot is really subtracted");
    }
    // GRAFT NOTHING is a result, not an inexpressible case: junk only.
    const none = gp.chooseGrafts({ candidates: junk, priceExit: exit, base: BASE, money: 3.77e9, intelligence: 95, ownedNames: [] });
    if (none.grafts === null) c4.fail("a pool of bad augs is not an error");
    if (none.grafts.length !== 0) c4.fail(`junk-only must graft NOTHING, got ${none.grafts.map((g) => g.name).join(", ")}`);
    if (!/nothing/.test(none.why)) c4.fail("and it must say so");
    // Budget is respected.
    const broke = gp.chooseGrafts({ candidates: good, priceExit: exit, base: BASE, money: 1e6, intelligence: 95, ownedNames: [] });
    if (broke.grafts.length !== 0) c4.fail("nothing affordable means nothing grafted");
    if (r.spend > 3.77e9) c4.fail(`the plan must stay inside the budget, spent $${r.spend}`);
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
      ["money unreadable", { ...ok, money: null }],
      ["exit unpriceable", { ...ok, priceExit: () => null }],
    ]) {
      const r = gp.chooseGrafts(o);
      if (r.grafts !== null || !r.why) c5.fail(`${what} must REFUSE by name, got ${JSON.stringify(r).slice(0, 90)}`);
    }
    c5.note("five unreadable inputs each refuse by name rather than planning a spend");
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

  return checks;
}
