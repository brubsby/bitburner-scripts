// [SP] the sleeve fleet as a trajectory term — sleeveplan.js.
//
// The failure this exists to prevent: until 2026-09-22 NOTHING in this repo
// modelled sleeves. gangworth.js priced the karma gate as hours of the
// player's work slot alone, so a fleet that pays a third of that grind moved
// the gang verdict by exactly zero, and sleeve.js answered three trajectory
// questions with hardcoded constants — always synchronise first, always
// recover shock next, always Homicide after.
//
// What is pinned here is fidelity to the GAME's sleeve path, which differs
// from the player's crime path in ways that all push the same direction
// (a sleeve's karma is worth LESS per attempt than crimeRates would say), plus
// the two break-evens that replace the constants.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const sp = await import("../../sleeveplan.js");
const { CRIMES, crimeRates, intelligenceBonus, simulateCrime, karmaGrindAcrossCycles } = await import("../../bodyplan.js");

const NODE1 = { CrimeSuccessRate: 1, CrimeMoney: 1, CrimeExpGain: 1 };

/** A sleeve as ns.sleeve.getSleeve returns it (Sleeve.ts:200-210). */
function sleeve(over = {}) {
  const skills = { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 0 };
  const exp = { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 };
  const mults = {};
  for (const s of Object.keys(exp)) {
    mults[s] = 1;
    mults[`${s}_exp`] = 1;
  }
  mults.crime_success = 1;
  mults.crime_money = 1;
  return { skills, exp, mults, sync: 100, shock: 0, memory: 1, city: "Sector-12", index: 0, ...over };
}

const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("SP1", "the sleeve rate constants are the game's, read out of its source");
  {
    // SleeveSynchroWork.ts / SleeveRecoveryWork.ts / Sleeve.process.
    const sync = game("src/PersonObjects/Sleeve/Work/SleeveSynchroWork.ts");
    const rec = game("src/PersonObjects/Sleeve/Work/SleeveRecoveryWork.ts");
    const sl = game("src/PersonObjects/Sleeve/Sleeve.ts");
    c1.examined(3);

    const syncRate = Number(sync.match(/sleeve\.sync\s*\+\s*calculateIntelligenceBonus\([^)]*\)\s*\*\s*([\d.]+)/)?.[1]);
    if (!(syncRate > 0)) c1.fail("could not read the synchronise rate out of SleeveSynchroWork.ts", "that is a rotted parser, not a clean repo");
    else if (syncRate !== sp.SYNC_PER_CYCLE) c1.fail(`SYNC_PER_CYCLE ${sp.SYNC_PER_CYCLE} vs source ${syncRate}`);

    const recRate = Number(rec.match(/sleeve\.shock\s*-\s*([\d.]+)/)?.[1]);
    if (!(recRate > 0)) c1.fail("could not read the shock recovery rate out of SleeveRecoveryWork.ts");
    else if (recRate !== sp.SHOCK_RECOVERY_PER_CYCLE) c1.fail(`SHOCK_RECOVERY_PER_CYCLE ${sp.SHOCK_RECOVERY_PER_CYCLE} vs source ${recRate}`);

    const passive = Number(sl.match(/this\.shock\s*-\s*([\d.]+)\s*\*\s*calculateIntelligenceBonus/)?.[1]);
    if (!(passive > 0)) c1.fail("could not read the PASSIVE shock decay out of Sleeve.process");
    else if (passive !== sp.SHOCK_PASSIVE_PER_CYCLE) c1.fail(`SHOCK_PASSIVE_PER_CYCLE ${sp.SHOCK_PASSIVE_PER_CYCLE} vs source ${passive}`);

    // 5 cycles per second: CONSTANTS.MilliPerCycle.
    const milli = Number(game("src/Constants.ts").match(/MilliPerCycle:\s*(\d+)/)?.[1]);
    if (!(milli > 0)) c1.fail("could not read MilliPerCycle out of Constants.ts");
    else if (1000 / milli !== sp.CYCLES_PER_SEC) c1.fail(`CYCLES_PER_SEC ${sp.CYCLES_PER_SEC} vs 1000/${milli}`);

    // The intelligence WEIGHTS differ per site and were easy to transpose.
    const syncW = Number(sync.match(/calculateIntelligenceBonus\(Player\.skills\.intelligence,\s*([\d.]+)\)/)?.[1]);
    const recW = Number(rec.match(/calculateIntelligenceBonus\(sleeve\.skills\.intelligence,\s*([\d.]+)\)/)?.[1]);
    if (syncW !== 0.5) c1.fail(`the synchronise intelligence weight is ${syncW} in source`);
    if (recW !== 0.75) c1.fail(`the shock recovery intelligence weight is ${recW} in source`);
    // And the one that is the PLAYER's rather than the sleeve's.
    if (!/calculateIntelligenceBonus\(Player\.skills\.intelligence/.test(sync)) {
      c1.fail("synchronise is scaled by the PLAYER's intelligence in source — sleeveplan says so too");
    }
    if (Math.abs(sp.syncPerSec(0) - 0.0002 * 5) > 1e-15) c1.fail("syncPerSec at intelligence 0 is the bare rate");
    if (Math.abs(sp.syncPerSec(100) - 0.001 * intelligenceBonus(100, 0.5)) > 1e-15) c1.fail("syncPerSec must carry the player's intelligence bonus");
    if (sp.syncPerSec(null) !== null) c1.fail("unreadable intelligence must refuse, not default to zero");
    if (sp.shockPerSec(0, true) <= sp.shockPerSec(0, false)) c1.fail("dedicated recovery must beat passive decay");
    if (Math.abs(sp.shockPerSec(0, true) / sp.shockPerSec(0, false) - 3) > 1e-12) c1.fail("recovery is 3x passive: (0.0002 + 0.0001) / 0.0001");
    c1.note(`sync ${sp.syncPerSec(0).toFixed(5)}/s, shock ${sp.shockPerSec(0, true).toFixed(5)}/s recovering vs ${sp.shockPerSec(0, false).toFixed(5)}/s passive — all three read from game source`);
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("SP2", "a sleeve's karma is NOT the player's: success only, no focus term");
  {
    c2.examined(Object.keys(CRIMES).length);
    // SleeveCrimeWork.ts credits karma inside `if (success)`; CrimeWork.ts
    // divides by 4 on failure instead. Read both, so a game change shows up
    // here rather than as a quietly optimistic fleet.
    const sw = game("src/PersonObjects/Sleeve/Work/SleeveCrimeWork.ts");
    const pw = game("src/Work/CrimeWork.ts");
    const inSuccess = /if\s*\(success\)\s*\{[^}]*Player\.karma\s*-=\s*crime\.karma\s*\*\s*sleeve\.syncBonus\(\)/s.test(sw);
    if (!inSuccess) c2.fail("SleeveCrimeWork no longer credits karma only on success — sleeveCrimeRates assumes it does");
    if (/karma\s*\/=\s*4/.test(sw)) c2.fail("SleeveCrimeWork has grown a quarter-on-failure term");
    if (!/karma\s*\/=\s*4/.test(pw)) c2.fail("CrimeWork no longer quarters karma on failure — bodyplan's failFactor assumes it does");
    if (/focusPenalty|focusBonus/.test(sw)) c2.fail("SleeveCrimeWork has grown a focus term");

    // At a 100% chance the two agree; below it the sleeve must be STRICTLY
    // worse, because the player keeps a quarter of a failure and it does not.
    const full = sleeve({ skills: { hacking: 999, strength: 999, defense: 999, dexterity: 999, agility: 999, charisma: 999, intelligence: 0 } });
    const fr = sp.sleeveCrimeRates(full, NODE1, "Homicide");
    const pr = crimeRates("Homicide", full, NODE1, 1);
    if (Math.abs(fr.chance - 1) > 1e-12) c2.fail("the saturated sleeve should be at chance 1");
    if (Math.abs(fr.karma - pr.karma) > 1e-12) c2.fail(`at chance 1 sleeve and player karma agree: ${fr.karma} vs ${pr.karma}`);

    const weak = sleeve();
    const wf = sp.sleeveCrimeRates(weak, NODE1, "Homicide");
    const wp = crimeRates("Homicide", weak, NODE1, 1);
    if (!(wf.karma < wp.karma)) c2.fail(`below chance 1 a sleeve pays LESS karma than the player: ${wf.karma} vs ${wp.karma}`);
    // The exact ratio is chance / ((3*chance+1)/4).
    const want = wf.chance / ((3 * wf.chance + 1) / 4);
    if (Math.abs(wf.karma / wp.karma - want) > 1e-9) c2.fail("the sleeve/player karma ratio must be chance / failFactor");
    c2.note(`at ${(wf.chance * 100).toFixed(1)}% chance a sleeve pays ${((1 - wf.karma / wp.karma) * 100).toFixed(0)}% less karma than crimeRates would say`);

    // Sync scales it linearly and is the whole mechanism.
    const half = sp.sleeveCrimeRates(sleeve({ sync: 50 }), NODE1, "Homicide");
    const one = sp.sleeveCrimeRates(sleeve({ sync: 100 }), NODE1, "Homicide");
    if (Math.abs(half.karma * 2 - one.karma) > 1e-12) c2.fail("karma is linear in sync");
    // SHOCK IS NOT A KARMA TERM. sleeve.js recovered shock before Homicide.
    const shocked = sp.sleeveCrimeRates(sleeve({ shock: 99 }), NODE1, "Homicide");
    if (Math.abs(shocked.karma - one.karma) > 1e-12) c2.fail("shock must not change karma at all — it scales exp and money only");
    if (!(shocked.money < one.money)) c2.fail("shock DOES scale money");
    if (sp.sleeveCrimeRates(sleeve({ sync: undefined }), NODE1) !== null) c2.fail("an unreadable sync must refuse");
    if (sp.sleeveCrimeRates(sleeve(), NODE1, "Not A Crime") !== null) c2.fail("an unknown crime must refuse");
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("SP3", "the synchronise break-even is a horizon, not a habit");
  {
    c3.examined(4);
    const be = sp.syncBreakevenHours(0);
    if (!(be > 27 && be < 28)) c3.fail(`the break-even at intelligence 0 is 100/0.001/3600 = 27.8h, got ${be}`);
    // It must NOT depend on the sleeve's current sync — that is the whole
    // point of the derivation, and getting it wrong would make the policy
    // hysteretic (sync a bit, stop, sync again).
    for (const s of [1, 25, 50, 99]) {
      const plan = sp.sleeveAssignments([sleeve({ sync: s })], NODE1, { objective: "karma", horizonHours: be + 1, playerIntelligence: 0 });
      if (plan.tasks[0] !== "sync") c3.fail(`at sync ${s} and a horizon past break-even, synchronise — got ${plan.tasks[0]}`);
      const short = sp.sleeveAssignments([sleeve({ sync: s })], NODE1, { objective: "karma", horizonHours: be - 1, playerIntelligence: 0 });
      if (short.tasks[0] === "sync") c3.fail(`at sync ${s} and a horizon short of break-even, do NOT synchronise`);
    }
    // Numerically: past break-even, syncing first really does deliver more.
    const rate = sp.syncPerSec(0);
    const deliver = (s0, H, doSync) => {
      const t = doSync ? (100 - s0) / rate / 3600 : 0;
      return doSync ? 100 * Math.max(0, H - t) : s0 * H;
    };
    for (const [H, want] of [[be + 5, true], [be - 5, false]]) {
      const better = deliver(25, H, true) > deliver(25, H, false);
      if (better !== want) c3.fail(`the closed form disagrees with the integral at H=${H.toFixed(1)}h`);
    }
    // No horizon: refuse the investment rather than assume one.
    const blind = sp.sleeveAssignments([sleeve({ sync: 25 })], NODE1, { objective: "karma", playerIntelligence: 0 });
    if (blind.tasks[0] === "sync") c3.fail("with no horizon supplied, synchronising is an investment against an unknown — do not");
    if (!blind.why[0].includes("no horizon")) c3.fail("and it must SAY that is why");
    // Intelligence shortens it.
    if (!(sp.syncBreakevenHours(500) < be)) c3.fail("intelligence must shorten the break-even");
    c3.note(`break-even ${be.toFixed(1)}h at intelligence 0, ${sp.syncBreakevenHours(500).toFixed(1)}h at 500 — independent of current sync at both`);
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("SP4", "shock recovery is never the answer to a karma objective");
  {
    c4.examined(2);
    const long = sp.syncBreakevenHours(0) + 100;
    const s = sleeve({ sync: 100, shock: 90 });
    const karma = sp.sleeveAssignments([s], NODE1, { objective: "karma", horizonHours: long, playerIntelligence: 0 });
    if (karma.tasks[0] === "shock") {
      c4.fail("shock does not scale karma (Sleeve.ts:174 feeds getExp only), so recovering it for a karma objective buys nothing");
    }
    const money = sp.sleeveAssignments([s], NODE1, { objective: "money", horizonHours: long, playerIntelligence: 0 });
    if (money.tasks[0] !== "shock") c4.fail("shock DOES scale money, so a money objective at a long horizon recovers it first");
    c4.note(`shock 90: karma objective -> ${karma.tasks[0]}, money objective -> ${money.tasks[0]}`);
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("SP5", "an unreadable fleet refuses; an absent one is a known zero");
  {
    c5.examined(4);
    const none = sp.fleetRates([], NODE1);
    if (none === null) c5.fail("no sleeves is a KNOWN zero — refusing here would make every pre-SF10 save unpriceable");
    if (none.karmaPerSec !== 0 || none.sleeves !== 0) c5.fail("an empty fleet contributes zero");
    if (sp.fleetRates(null, NODE1) !== null) c5.fail("an unreadable fleet must refuse");
    if (sp.fleetRates([sleeve(), { index: 1 }], NODE1) !== null) {
      c5.fail("ONE unreadable sleeve makes the SUM wrong — a fleet total quietly short by a sleeve is the failure mode, so refuse the total");
    }
    const two = sp.fleetRates([sleeve(), sleeve({ index: 1 })], NODE1);
    const one = sp.fleetRates([sleeve()], NODE1);
    if (Math.abs(two.karmaPerSec - 2 * one.karmaPerSec) > 1e-12) c5.fail("the fleet total is the sum");
    if (two.contributing !== 2) c5.fail("contributing counts the sleeves actually delivering");
    c5.note(`1 fresh sleeve at sync 100 delivers ${one.karmaPerSec.toFixed(4)} karma/s; the empty fleet is 0, the unreadable one is null`);
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c6 = new Check("SP6", "the fleet is a term in the karma grind, and a missing fleet is not a zero one");
  {
    c6.examined(6);
    // A fresh-life player, the shape karmaChannelCtx passes after an install.
    const player = sleeve({ karma: 0, numPeopleKilled: 0, money: 0, sync: undefined });
    delete player.sync;
    delete player.shock;
    const until = (pp) => pp.karma <= -54000;
    const alone = simulateCrime("Homicide", player, NODE1, { until, maxHours: 500 });
    if (!alone || !(alone.hours > 0)) c6.fail("the lone-player grind must price");

    // A fleet of four synchronised sleeves at the player's own stats.
    const fleet = sp.fleetRates([0, 1, 2, 3].map((i) => sleeve({ index: i, sync: 100 })), NODE1);
    const helped = simulateCrime("Homicide", player, NODE1, { until, maxHours: 500, assist: fleet });
    if (!(helped.hours < alone.hours)) {
      c6.fail(`a fleet delivering ${fleet.karmaPerSec.toFixed(4)} karma/s must shorten the grind: ${helped.hours.toFixed(1)}h vs ${alone.hours.toFixed(1)}h alone`);
    }
    // And the kills it pays must land too — Speakers for the Dead wants 30.
    if (!(fleet.killsPerSec > 0)) c6.fail("Homicide kills, so the fleet pays the kill gate as well");
    const killUntil = (pp) => pp.numPeopleKilled >= 30;
    const kAlone = simulateCrime("Homicide", player, NODE1, { until: killUntil, maxHours: 500 });
    const kHelped = simulateCrime("Homicide", player, NODE1, { until: killUntil, maxHours: 500, assist: fleet });
    if (!(kHelped.hours < kAlone.hours)) c6.fail("the fleet's kills must count toward a kill gate");

    // A NULL assist must price exactly as the lone player does — the fleet is
    // unknown, so nothing is claimed for it. This is the direction that makes
    // a karma gate look MORE expensive, which is the safe one.
    const unknown = simulateCrime("Homicide", player, NODE1, { until, maxHours: 500, assist: null });
    if (Math.abs(unknown.hours - alone.hours) > 1e-9) c6.fail("an unreadable fleet must not be credited");

    // Across install cycles the fleet must STILL help — this is where it
    // matters most, because the player's exp is zeroed each cycle and the
    // sleeves' is not (prestigeAugmentation never calls sleeve.prestige()).
    const gAlone = karmaGrindAcrossCycles(player, NODE1, { karmaTarget: -54000, cycleHours: 2, focus: 1 });
    const gHelped = karmaGrindAcrossCycles(player, NODE1, { karmaTarget: -54000, cycleHours: 2, focus: 1, assist: fleet });
    if (!gAlone || !gHelped) c6.fail("both multi-cycle grinds must price");
    else if (!(gHelped.hours < gAlone.hours)) {
      c6.fail(`the fleet must shorten the ACROSS-CYCLES grind too: ${gHelped.hours}h vs ${gAlone.hours}h`);
    } else {
      c6.note(`4 sleeves at sync 100 cut the -54,000 grind from ${gAlone.hours.toFixed(1)}h to ${gHelped.hours.toFixed(1)}h across 2h install cycles`);
    }
    // A negative or nonsense assist must not be credited either.
    const bad = simulateCrime("Homicide", player, NODE1, { until, maxHours: 500, assist: { karmaPerSec: -5 } });
    if (Math.abs(bad.hours - alone.hours) > 1e-9) c6.fail("a negative assist must be ignored, not subtracted");
  }
  checks.push(c6);

  // ---------------------------------------------------------------------
  const c7 = new Check("SP7", "train-or-work is searched over the horizon, and working now can still win");
  {
    c7.examined(5);
    const fresh = sleeve({ sync: 45 });
    // A fresh sleeve is worth almost nothing at crime, so training must win by
    // a wide margin — this is the gap that left the fleet shoplifting.
    const p = sp.sleevePolicy(fresh, NODE1, { objective: "karma", horizonHours: 40 });
    if (!p) c7.fail("a readable sleeve and horizon must price");
    else if (p.task !== "train") c7.fail(`a skill-1 sleeve over 40h must train first, got ${p.task}`);
    else if (!(p.trainHours > 0 && p.trainHours < 40)) c7.fail(`training time must be inside the horizon, got ${p.trainHours}`);

    // T = 0 IS IN THE GRID, so a saturated sleeve works now. Without this the
    // check only proves the function likes training.
    const done = sleeve({ sync: 100, skills: { hacking: 999, strength: 999, defense: 999, dexterity: 999, agility: 999, charisma: 999, intelligence: 0 } });
    const q = sp.sleevePolicy(done, NODE1, { objective: "karma", horizonHours: 40 });
    if (q?.task !== "Homicide") c7.fail(`a sleeve already at 100% chance must work now, got ${q?.task}`);

    // And a horizon too short to repay training must work now too.
    const tiny = sp.sleevePolicy(fresh, NODE1, { objective: "karma", horizonHours: 0.01 });
    if (!tiny) c7.fail("a short horizon must still price");
    // The search must be MONOTONE in the obvious direction: a longer horizon
    // never makes training less attractive in absolute value delivered.
    const short = sp.sleevePolicy(fresh, NODE1, { objective: "karma", horizonHours: 10 });
    const long = sp.sleevePolicy(fresh, NODE1, { objective: "karma", horizonHours: 100 });
    if (!(long.value > short.value)) c7.fail("more horizon must deliver more");
    if (!(long.trainHours >= short.trainHours)) c7.fail("more horizon must not train less");

    // No horizon: refuse, rather than search against an invented one.
    if (sp.sleevePolicy(fresh, NODE1, { objective: "karma" }) !== null) c7.fail("no horizon must refuse");
    if (sp.sleevePolicy({ index: 0 }, NODE1, { objective: "karma", horizonHours: 40 }) !== null) c7.fail("an unreadable sleeve must refuse");

    // The assignment that comes out is a stat sleeve.js can actually pass to
    // setToGymWorkout — one of the four, not 'train'.
    // At sync 100 the synchronise leg is done, so the next decision is the
    // train-or-work one. (A sleeve BELOW 100 past the break-even synchronises
    // first — SP3 — because sync is the exchange rate on everything it later
    // delivers, not only on karma.)
    const plan = sp.sleeveAssignments([sleeve({ sync: 100 })], NODE1, { objective: "karma", horizonHours: 40, playerIntelligence: 0 });
    if (!["strength", "defense", "dexterity", "agility"].includes(plan.tasks[0])) {
      c7.fail(`the emitted task must be a gym stat sleeve.js maps to a GymType, got ${plan.tasks[0]}`);
    }
    // TRAINING TIME COSTS THE HORIZON. Dropping the `- T` term left every
    // other assertion here green: the saturated sleeve still worked now
    // (training buys it nothing either way) and both monotone checks held,
    // while the search silently preferred the longest training split on every
    // fresh sleeve. Re-derive the value from the rate it priced.
    for (const H of [10, 40, 100]) {
      const r = sp.sleevePolicy(fresh, NODE1, { objective: "karma", horizonHours: H });
      if (r?.task !== "train") continue;
      const want = r.afterRate * (H - r.trainHours) * 3600;
      if (Math.abs(r.value - want) > 1e-9) {
        c7.fail(`at ${H}h the value must be the post-training rate over what is LEFT of the horizon: ${r.value} vs ${want}`);
      }
      if (!(r.trainHours < H)) c7.fail("training cannot consume the whole horizon and still deliver");
    }
    c7.note(`skill-1 sleeve over 40h: ${p.why}`);
  }
  checks.push(c7);

  return checks;
}
