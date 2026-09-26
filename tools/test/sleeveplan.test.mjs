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
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
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
  mults.faction_rep = 1;
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
    const plan = sp.sleeveAssignments([sleeve({ sync: 100 })], NODE1, { objective: "karma", horizonHours: 40, playerIntelligence: 0, money: 1e12 });
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

  // ---------------------------------------------------------------------
  const c8 = new Check("SP8", "the exp transfer to the player is the game's, and additive only");
  {
    c8.examined(6);
    // The formula, against source: class earnings are per-CYCLE and scaled by
    // location.expMult / gameCPS, so per second the gameCPS cancels.
    const cw = game("src/Work/ClassWork.tsx");
    const algo = Number(cw.match(/algorithms\][\s\S]{0,200}?hackExp:\s*([\d.]+)/)?.[1]);
    if (algo !== sp.CLASSES.Algorithms.exp) c8.fail(`Algorithms hackExp is ${algo} in source, ${sp.CLASSES.Algorithms.exp} here`);
    const fm = game("src/Work/Formulas.ts");
    if (!/location\.expMult\s*\/\s*gameCPS/.test(fm)) c8.fail("calculateClassEarnings no longer scales by location.expMult / gameCPS");
    // The transfer itself, and that it is SYNC-scaled.
    const wk = game("src/PersonObjects/Sleeve/Work/Work.ts");
    if (!/applyWorkStatsExp\(Player, shockedStats, mult \* sync\)/.test(wk)) {
      c8.fail("applySleeveGains no longer hands the PLAYER the sleeve's exp scaled by sync — fleetExpToPlayer assumes it does");
    }
    const one = sp.sleeveStudyExpPerSec(sleeve({ sync: 100 }));
    if (one?.perSec !== 4 * 4) c8.fail(`Algorithms at the best university is exp 4 x expMult 4 = 16/s, got ${one?.perSec}`);
    if (one?.university !== "ZB Institute of Technology") c8.fail("the best university is ZB (expMult 4)");
    const half = sp.fleetExpToPlayer([sleeve({ sync: 50 })]);
    const full = sp.fleetExpToPlayer([sleeve({ sync: 100 })]);
    if (Math.abs(half.hacking * 2 - full.hacking) > 1e-9) c8.fail("the transfer is linear in sync");
    if (Math.abs(full.hacking - 16) > 1e-9) c8.fail(`at sync 100 the whole 16/s transfers, got ${full.hacking}`);
    // Shock scales it (it scales exp), unlike karma.
    if (!(sp.fleetExpToPlayer([sleeve({ sync: 100, shock: 50 })]).hacking < full.hacking)) {
      c8.fail("shock scales the exp transfer — SleeveClassWork.calculateRates applies shockBonus");
    }
    // KNOWN ZERO vs UNKNOWN. The BitNode option is readable, so it is a zero
    // that can be planned around; an unreadable sleeve is not.
    const off = sp.fleetExpToPlayer([sleeve()], { disableSleeveExp: true });
    if (off?.hacking !== 0) c8.fail("disableSleeveExpAndAugmentation means a KNOWN zero transfer");
    if (!/disableSleeveExpAndAugmentation/.test(off?.why ?? "")) c8.fail("and it must name the option");
    if (!/disableSleeveExpAndAugmentation/.test(game("src/Work/Formulas.ts"))) {
      c8.fail("processWorkStats no longer gates sleeve exp on that option — the refusal here is stale");
    }
    if (sp.fleetExpToPlayer([sleeve(), { index: 1 }]) !== null) c8.fail("one unreadable sleeve must refuse the whole total");
    if (sp.fleetExpToPlayer(null) !== null) c8.fail("an unreadable fleet must refuse");

    // CALIBRATION, printed whether it passes or fails (CLAUDE.md): the model
    // must be stated against a quantity the live game shows, so nobody reads
    // "the largest sleeve term" as "sleeves dominate the trajectory".
    // ADDITIVE ONLY. Returning the fleet's rate where the player's is
    // unmeasured survived every other assertion here, because it only shows up
    // on the path where exitplan was already refusing.
    if (sp.expPerSecWithFleet(316, 7.68) !== 316 + 7.68) c8.fail("a measured rate gains the fleet's");
    for (const bad of [null, undefined, 0, NaN]) {
      const r = sp.expPerSecWithFleet(bad, 7.68);
      if (r === 7.68) c8.fail(`with the player's rate ${bad}, the fleet alone is NOT the climb rate — refuse instead`);
      if (!(r === null || r === 0)) c8.fail(`unmeasured player rate must pass through, got ${r}`);
    }
    if (sp.expPerSecWithFleet(316, null) !== 316) c8.fail("an unknown fleet must leave the player's rate alone");

    const live = sp.fleetExpToPlayer([sleeve({ sync: 48 })]);
    c8.note(`1 sleeve at sync 48 studying Algorithms hands the player ${live.hacking.toFixed(2)} hacking exp/s; measured live 2026-09-22 the player earned 316/s, so +${((live.hacking / 316) * 100).toFixed(1)}% — real, and not dominant at one sleeve`);
  }
  checks.push(c8);

  // ---------------------------------------------------------------------
  const c9 = new Check("SP9", "sleeve faction reputation matches the game's own formulas, and is NOT sync-scaled");
  {
    let g;
    try {
      await import("../sim/env.mjs");
      g = await import("../sim/game.bundle.mjs");
    } catch (e) {
      c9.warn(`could not load the game bundle: ${e.message}`, "the formula is then self-consistent but unverified against source");
    }
    if (g?.getHackingWorkRepGain && g?.getFactionFieldWorkRepGain) {
      const saved = g.currentNodeMults.FactionWorkRepGain;
      for (const [hack, combat, cha, int, frep, bn] of [
        [1, 1, 1, 0, 1, 1],
        [400, 200, 50, 0, 1.6, 0.75],
        [2500, 900, 300, 30, 3.5, 0.5],
        // FIELD WORK MUST WIN SOMEWHERE, or "always pick hacking" passes —
        // it did. A sleeve this repo trains for crime has high combat and
        // hacking 1, which is precisely where field work is worth ~285x
        // hacking work, so omitting the shape omitted the realistic case.
        [1, 400, 100, 0, 1, 1],
      ]) {
        c9.examined(1);
        g.currentNodeMults.FactionWorkRepGain = bn;
        const person = {
          skills: { hacking: hack, strength: combat, defense: combat, dexterity: combat, agility: combat, charisma: cha, intelligence: int },
          mults: { faction_rep: frep },
        };
        const sl = sleeve({
          skills: person.skills,
          mults: { ...sleeve().mults, faction_rep: frep },
          shock: 0,
          sync: 1, // deliberately the WORST sync — reputation must not care
        });
        const mine = sp.sleeveFactionRepPerSec(sl, { nodeWorkRepMult: bn, sharePower: g.calculateCurrentShareBonus(), favor: 0 });
        const gameHack = g.getHackingWorkRepGain(person, 0) * 5;
        const gameField = g.getFactionFieldWorkRepGain(person, 0) * 5;
        const want = Math.max(gameHack, gameField);
        const rel = Math.abs(mine.base - want) / want;
        if (rel > 1e-9) c9.fail(`hacking ${hack}/combat ${combat}: mine ${mine.base}, game ${want} (${(rel * 100).toFixed(4)}%)`);
        const wantType = gameHack >= gameField ? "hacking" : "field";
        if (mine.workType !== wantType) c9.fail(`at hacking ${hack}/combat ${combat} the better work type is ${wantType}, picked ${mine.workType}`);
      }
      g.currentNodeMults.FactionWorkRepGain = saved;
      c9.note("both work types equal the game's own functions x5 cycles at four stat shapes (hacking wins three, field the trained-combat one), and the better is picked");
    }

    c9.examined(4);
    // NOT SYNC-SCALED — the property that makes an unsynchronised fleet
    // full-value for reputation while it is nearly worthless for karma.
    const lo = sp.sleeveFactionRepPerSec(sleeve({ sync: 1 }), { nodeWorkRepMult: 1 });
    const hi = sp.sleeveFactionRepPerSec(sleeve({ sync: 100 }), { nodeWorkRepMult: 1 });
    if (Math.abs(lo.base - hi.base) > 1e-12) c9.fail("faction reputation is not scaled by sync — SleeveFactionWork.getReputationRate applies shockBonus only");
    const swk = game("src/PersonObjects/Sleeve/Work/SleeveFactionWork.ts");
    if (/syncBonus/.test(swk)) c9.fail("SleeveFactionWork has grown a sync term — this model says it has none");
    // NOT [^)]* — that stops at the nested this.getFaction() and reported a
    // missing shockBonus that was plainly there. Match to the end of the line.
    if (!/calculateFactionRep\(.*\*\s*sleeve\.shockBonus\(\)/.test(swk)) c9.fail("getReputationRate no longer applies shockBonus");
    // Shock DOES scale it.
    if (!(sp.sleeveFactionRepPerSec(sleeve({ shock: 50 }), { nodeWorkRepMult: 1 }).base < hi.base)) c9.fail("shock must scale faction reputation");
    // The darknet charisma term is zero without SF15 lvl 3, which is why it is
    // absent from the model. If the game stops gating it, the model is wrong.
    if (!/activeSourceFileLvl\(15\)\s*>=\s*3/.test(game("src/PersonObjects/formulas/reputation.ts"))) {
      c9.fail("getDarknetCharismaBonus is no longer gated on Source-File 15 level 3 — this model omits it on that basis");
    }

    c9.examined(3);
    // ONE SLEEVE PER FACTION, so the fleet figure is a MAX and never a sum.
    // setToFactionWork throws when another sleeve holds the faction.
    const nsSleeve = game("src/NetscriptFunctions/Sleeve.ts");
    if (!/cannot work for faction[\s\S]{0,80}because Sleeve/.test(nsSleeve)) {
      c9.fail("the one-sleeve-per-faction rule is gone from setToFactionWork — fleetFactionRepPerSec takes a max because of it");
    }
    const four = sp.fleetFactionRepPerSec([0, 1, 2, 3].map((i) => sleeve({ index: i })), { nodeWorkRepMult: 1 });
    const alone = sp.fleetFactionRepPerSec([sleeve()], { nodeWorkRepMult: 1 });
    if (Math.abs(four.base - alone.base) > 1e-12) {
      c9.fail(`four sleeves cannot stack on one faction: got ${four.base} vs ${alone.base} for one — a sum would overstate the exit reputation leg by the fleet size`);
    }
    if (sp.fleetFactionRepPerSec([sleeve(), { index: 1 }], { nodeWorkRepMult: 1 }) !== null) c9.fail("an unreadable sleeve must refuse the total");
    if (sp.fleetFactionRepPerSec([], { nodeWorkRepMult: 1 })?.base !== 0) c9.fail("no sleeves is a known zero");
    // Additive-only, same discipline as the exp transfer.
    if (sp.repPerSecWithFleet(3.54, 0.5) !== 3.54 + 0.5) c9.fail("a measured rate gains the fleet's");
    for (const bad of [null, undefined, 0, NaN]) {
      if (sp.repPerSecWithFleet(bad, 0.5) === 0.5) c9.fail(`with the player's rate ${bad}, the sleeve alone is not the reputation leg`);
    }
    if (sp.repPerSecWithFleet(3.54, null) !== 3.54) c9.fail("an unknown fleet leaves the player's rate alone");
    const live = sp.sleeveFactionRepPerSec(sleeve({ skills: { ...sleeve().skills, hacking: 94 } }), { nodeWorkRepMult: 1 });
    c9.note(`a sleeve at the player's live hacking 94 would earn ${live.base.toFixed(3)} rep/s base vs the player's measured 3.54 — and at sync 1, since reputation ignores sync`);
  }
  checks.push(c9);

  // ---------------------------------------------------------------------
  const c10 = new Check("SP10", "the fleet you ARRIVE with is a reset fleet, and nodeplan prices that one");
  {
    c10.examined(6);
    // prestigeSourceFile resets every sleeve; only the COUNT survives.
    const gm = game("src/PersonObjects/Player/PlayerObjectGeneralMethods.ts");
    if (!/prestigeSourceFile[\s\S]{0,400}?sleeves\.forEach\(\(sleeve\) => sleeve\.prestige\(\)\)/.test(gm)) {
      c10.fail("prestigeSourceFile no longer resets every sleeve — arrivingFleet is built on that");
    }
    if (/prestigeAugmentation[\s\S]{0,600}?sleeve\.prestige\(\)/.test(gm.slice(0, gm.indexOf("prestigeSourceFile")))) {
      c10.fail("prestigeAugmentation now resets sleeves too — installs were assumed NOT to");
    }
    const sl = game("src/PersonObjects/Sleeve/Sleeve.ts");
    if (!/this\.sync = Math\.max\(this\.memory, 1\)/.test(sl)) c10.fail("sleeve.prestige no longer sets sync = max(memory, 1)");
    if (!/this\.shock = 100/.test(sl)) c10.fail("sleeve.prestige no longer sets shock = 100");
    // BitNode 10's exception.
    if (!/bitNodeN === 10[\s\S]{0,300}?Math\.min\(25[\s\S]{0,120}?Math\.max\(25/.test(gm)) {
      c10.fail("BitNode 10 no longer caps shock at 25 and floors sync at 25 — arrivingFleet encodes that exception");
    }

    // A trained, synchronised fleet must arrive nearly worthless for KARMA.
    const trained = [sleeve({ sync: 63, shock: 0, memory: 1, skills: { hacking: 200, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 50, intelligence: 0 } })];
    const now = sp.fleetRates(trained, NODE1).karmaPerSec;
    const toBn2 = sp.fleetRates(sp.arrivingFleet(trained, 2), NODE1).karmaPerSec;
    const toBn10 = sp.fleetRates(sp.arrivingFleet(trained, 10), NODE1).karmaPerSec;
    if (!(toBn2 < now / 1000)) c10.fail(`a reset fleet must be orders of magnitude weaker: ${toBn2} vs ${now} today`);
    if (!(toBn10 > toBn2)) c10.fail("BitNode 10 floors sync at 25, so it must arrive stronger than BitNode 2 at sync 1");
    if (sp.arrivingFleet(trained, 2)[0].skills.strength !== 1) c10.fail("an arriving sleeve is at skill 1");
    if (sp.arrivingFleet(null, 2) !== null) c10.fail("an unreadable fleet must refuse");

    // nodeplan must actually USE an assist, and must price the grind as the
    // player alone when none is supplied.
    const { karmaHours } = await import("../../nodeplan.js");
    const alone = karmaHours({ chance: 0.5, karma: 0 });
    const helped = karmaHours({ chance: 0.5, karma: 0, assistPerSec: 0.5 });
    if (!(helped.hours < alone.hours)) c10.fail("an assist must shorten nodeplan's karma leg");
    if (alone.assistPerSec !== 0) c10.fail("no assist supplied means zero credited, not unknown");
    for (const bad of [null, -1, NaN]) {
      if (karmaHours({ chance: 0.5, karma: 0, assistPerSec: bad }).hours !== alone.hours) {
        c10.fail(`an unreadable assist (${bad}) must not be credited`);
      }
    }
    c10.note(`live-shaped fleet: ${now.toFixed(4)} karma/s today, ${toBn2.toFixed(6)} arriving in BitNode 2 (${(now / toBn2).toFixed(0)}x weaker), ${toBn10.toFixed(6)} in BitNode 10 where sync floors at 25`);
  }
  checks.push(c10);

  // ---------------------------------------------------------------------
  const c11 = new Check("SP11", "faction work is assignable, one sleeve per faction, and sync is not its price");
  {
    c11.examined(8);
    const N = NODE1;
    const opts = { objective: "rep", repFaction: "Daedalus", horizonHours: 200, playerIntelligence: 0, nodeWorkRepMult: 1, sharePower: 1.23 };

    // SYNC IS NOT A REPUTATION COST. This branch used to fire for every
    // objective, so a fleet told to earn reputation spent ~28h synchronising
    // and bought nothing: syncBonus() appears only in the exp transfer and in
    // karma, never in SleeveFactionWork.
    const unsynced = sleeve({ sync: 20 });
    const repPlan = sp.sleeveAssignments([unsynced], N, opts);
    if (repPlan.tasks[0] === "sync") c11.fail("a reputation objective must NOT synchronise — sync scales karma and the exp transfer, not faction reputation");
    const karmaPlan = sp.sleeveAssignments([unsynced], N, { ...opts, objective: "karma" });
    if (karmaPlan.tasks[0] !== "sync") c11.fail("a karma objective at sync 20 past the break-even still synchronises");
    const moneyPlan = sp.sleeveAssignments([unsynced], N, { ...opts, objective: "money" });
    if (moneyPlan.tasks[0] === "sync") c11.fail("money is not sync-scaled either — Player.gainMoney carries no sync term");
    if (!sp.SYNC_SCALED.has("karma")) c11.fail("karma IS sync-scaled");
    for (const o of ["money", "rep"]) if (sp.SYNC_SCALED.has(o)) c11.fail(`${o} is not sync-scaled`);

    // A TRAINED sleeve actually takes the faction task, and it is an object
    // carrying the faction and work type — setToFactionWork needs both.
    const trained = sleeve({ sync: 20, skills: { hacking: 1, strength: 600, defense: 600, dexterity: 600, agility: 600, charisma: 200, intelligence: 0 } });
    const t = sp.sleeveAssignments([trained], N, opts).tasks[0];
    if (!t || typeof t !== "object" || t.kind !== "faction") c11.fail(`a trained sleeve on a rep objective takes faction work, got ${JSON.stringify(t)}`);
    else {
      if (t.faction !== "Daedalus") c11.fail("the task must name the faction");
      if (!["hacking", "field", "security"].includes(t.workType)) c11.fail(`the task must name a FactionWorkType, got ${t.workType}`);
    }

    // ONE SLEEVE PER FACTION — the second must NOT also be given it, because
    // setToFactionWork throws and the whole tick's assignments would be lost.
    const two = sp.sleeveAssignments([trained, { ...trained, index: 1 }], N, opts);
    const factionTasks = two.tasks.filter((x) => x && typeof x === "object" && x.kind === "faction");
    if (factionTasks.length !== 1) c11.fail(`exactly one sleeve may hold a faction, ${factionTasks.length} were given it`);
    if (two.tasks[1] && typeof two.tasks[1] === "object") c11.fail("the second sleeve must fall through to another objective, not idle");

    // THE HOLDER KEEPS IT. Live BN8 2026-09-25: "Sleeve 1 cannot work for
    // faction Tian Di Hui because Sleeve 3 is already working for them"
    // (Sleeve.ts:153-163) — the planner gave the faction to the first eligible
    // sleeve while another still held it, and sleeve.js applies in index order.
    const holder = { ...trained, index: 1, task: { type: "FACTION", factionName: "Daedalus", factionWorkType: "hacking" } };
    const held = sp.sleeveAssignments([{ ...trained, index: 0 }, holder], N, opts);
    const heldFaction = held.tasks.map((x, i) => (x && typeof x === "object" && x.kind === "faction" ? i : -1)).filter((i) => i >= 0);
    if (!(heldFaction.length === 1 && heldFaction[0] === 1)) c11.fail(`the sleeve already working for the faction must keep it and no other sleeve be given it; faction tasks went to ${JSON.stringify(heldFaction)}`);
    else c11.note("a sleeve already holding the faction keeps it (sleeve 0 falls through)");

    // No faction supplied (not a member): never emit faction work.
    const none = sp.sleeveAssignments([trained], N, { ...opts, repFaction: null });
    if (none.tasks.some((x) => x && typeof x === "object")) c11.fail("with no faction published, nothing may be assigned faction work");
    c11.note(`trained sleeve -> ${JSON.stringify(t)}; a second one falls through to ${JSON.stringify(two.tasks[1])}`);
  }
  checks.push(c11);

  // ---------------------------------------------------------------------
  const c12 = new Check("SP12", "what is PUBLISHED is what the fleet delivers, not what it could deliver");
  {
    c12.examined(7);
    const studying = sleeve({ sync: 100, task: "CLASS" });
    const inGym = sleeve({ sync: 100, task: "CLASS" });
    const onCrime = sleeve({ sync: 100, task: "CRIME" });
    const onFaction = sleeve({ sync: 100, task: "FACTION" });

    // THE BUG: a sleeve doing anything else was credited with the Algorithms
    // study rate, and sleeve.js fed that straight into bestExitPolicy as the
    // rate the exit climb runs on — 14.48 hacking exp/s from a sleeve standing
    // in a gym. Combat exp is not hacking exp.
    const actual = sp.fleetExpToPlayer([onCrime, onFaction], { onlyStudying: true });
    if (actual === null) c12.fail("a readable fleet doing other work is not unreadable");
    else if (actual.hacking !== 0) c12.fail(`no sleeve is studying, so the hacking transfer is ZERO, got ${actual.hacking}`);
    const real = sp.fleetExpToPlayer([studying], { onlyStudying: true });
    if (!(real.hacking > 0)) c12.fail("a sleeve that IS studying must transfer");
    // The hypothetical still exists, and must differ — otherwise the flag does nothing.
    const hypo = sp.fleetExpToPlayer([onCrime, onFaction], { onlyStudying: false });
    if (!(hypo.hacking > 0)) c12.fail("the planning figure still answers 'what if they studied'");
    if (hypo.hacking === actual.hacking) c12.fail("actual and hypothetical must not be the same number");

    // And the ACTOR must publish the actual one to the field progress.js feeds
    // to the exit climb.
    const src = fs.readFileSync(path.join(REPO_ROOT, "sleeve.js"), "utf8");
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const expT = bare.match(/const expT = fleetExpToPlayer\([^)]*\)/)?.[0] ?? "";
    if (!/onlyStudying:\s*true/.test(expT)) {
      c12.fail(`expToPlayerHacking must be the ACTUAL transfer: ${expT || "(assignment not found)"}`,
        "progress.js feeds it to bestExitPolicy as the exit climb's exp rate; a hypothetical there overstates the trajectory");
    }

    c12.examined(4);
    // A non-crime objective is a KNOWN ZERO karma, not an unreadable fleet.
    // Asked for 'rep' this returned null, and progress.js logged "sleeve.js
    // could not price the fleet" about a fleet it could see perfectly well.
    const rep = sp.fleetRates([sleeve({ sync: 100 })], NODE1, { objective: "rep" });
    if (rep === null) c12.fail("a 'rep' objective must not read as an unreadable fleet — sleeves earning reputation commit no crime");
    else {
      if (rep.karmaPerSec !== 0) c12.fail("a fleet committing no crime pays zero karma");
      if (!/known zero/.test(rep.why)) c12.fail("and it must say the zero is KNOWN");
    }
    // Crime objectives are unaffected.
    const karma = sp.fleetRates([sleeve({ sync: 100 })], NODE1, { objective: "karma" });
    if (!(karma && karma.karmaPerSec > 0)) c12.fail("a karma objective still prices the crime");
    c12.note(`gym+faction fleet: actual ${actual.hacking} exp/s, hypothetical ${hypo.hacking.toFixed(2)}; 'rep' objective karma = known 0`);
  }
  checks.push(c12);

  // ---------------------------------------------------------------------
  const c13 = new Check("SP13", "the plan says WHERE its horizon came from — priced, capped, carried or none");
  {
    c13.examined(5);
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const fn = src.match(/function writeSleevePlan\([\s\S]*?\n\}/)?.[0] ?? "";
    if (!fn) c13.fail("could not locate writeSleevePlan in progress.js", "a rotted check, not a clean repo");
    const bare = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

    // The three cases are not interchangeable: a sleeve deciding to spend 100h
    // training must not read "capped" and "priced" as the same fact. A flat
    // `horizonHours: 1000` with no provenance took twenty minutes of inference
    // across other files to explain, which is the cost this pins down.
    for (const f of ["horizonRawHours", "horizonSource", "horizonWhy"]) {
      if (!new RegExp(`\\b${f}\\s*:`).test(bare)) {
        c13.fail(`the sleeve plan must publish \`${f}\``, "a horizon whose origin cannot be read is a number nobody can check");
      }
    }
    for (const word of ["capped", "priced", "carried", "unpriceable"]) {
      if (!new RegExp(`'${word}'`).test(bare)) c13.fail(`horizonSource must be able to say '${word}'`);
    }
    // THE CAP MUST LIVE HERE, not at the call site — that split is what dropped
    // horizonRawHours when this function was extracted.
    // NOT a bare mention: the cap is named in the horizonWhy strings too, so
    // `/MAX_PLANNING_HORIZON_H/` passed while the cap itself had been moved
    // back out. Pin the assignment that actually applies it.
    if (!/const horizonHours\s*=[^\n]*MAX_PLANNING_HORIZON_H/.test(bare)) {
      c13.fail("writeSleevePlan must own the cap", "applying it at the call site is what silently lost the raw figure in a refactor");
    }
    c13.note("horizon carries raw, capped, source and why — the three cases are distinguishable from the file alone");
  }
  checks.push(c13);

  // ---------------------------------------------------------------------
  const c14 = new Check("SP14", "the fleet record carries the skills that explain its rates");
  {
    c14.examined(2);
    const src = fs.readFileSync(path.join(REPO_ROOT, "sleeve.js"), "utf8");
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const assigned = bare.match(/assigned:\s*sleeves\.map\([\s\S]*?\)\),/)?.[0] ?? "";
    if (!assigned) c14.fail("could not locate the assigned record in sleeve.js");
    // Field work sums str/def/dex/agi and every crime weights them, so these
    // four are what explain the published rep and karma rates. Without them a
    // reader sees a rate climbing and cannot tell training from mis-crediting.
    for (const k of ["str", "def", "dex", "agi"]) {
      if (!new RegExp(`\\b${k}\\s*:`).test(assigned)) {
        c14.fail(`each sleeve must publish ${k}`, "sleeveplan's train-or-work search is a claim about these stats; without them nothing can check it against the game");
      }
    }
    if (!/skills\s*:/.test(assigned)) c14.fail("the per-sleeve record must carry a skills block");
    c14.note("each sleeve publishes str/def/dex/agi/hack beside its task, so the training leg is auditable");
  }
  checks.push(c14);

  // ---------------------------------------------------------------------
  const c15 = new Check("SP15", "money is the LAST objective, not the default — exp outranks it ~600x");
  {
    c15.examined(6);
    const sl = sleeve({ sync: 90.5, skills: { hacking: 1, strength: 77, defense: 77, dexterity: 77, agility: 76, charisma: 1, intelligence: 0 } });
    const o = { horizonHours: 1000, playerIntelligence: 95, nodeWorkRepMult: 1, sharePower: 1.03, money: 1e12 };

    // THE EXP OBJECTIVE EXISTS AND NEEDS NO TRAINING. Study exp is flat in the
    // sleeve's own stats, so there is nothing for the train-or-work search to
    // find — and at sync 100 it is simply Algorithms at the best university.
    const synced = sp.sleeveAssignments([sleeve({ sync: 100 })], NODE1, { ...o, objective: "exp" });
    if (synced.tasks[0] !== "hacking") c15.fail(`a synced sleeve on 'exp' studies, got ${JSON.stringify(synced.tasks[0])}`);
    if (!/does not scale with the sleeve/.test(synced.why.join(" "))) c15.fail("and it must say training buys nothing here");
    // Below full sync it synchronises FIRST, because sync does scale the transfer.
    const under = sp.sleeveAssignments([sl], NODE1, { ...o, objective: "exp" });
    if (under.tasks[0] !== "sync") c15.fail("sync scales the exp transfer, so an under-synced sleeve synchronises first");
    if (!sp.SYNC_SCALED.has("exp")) c15.fail("'exp' must be in SYNC_SCALED");

    // THE LADDER. money is reachable only when sleeve exp is impossible.
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const fn = src.match(/function writeSleevePlan\([\s\S]*?\n\}/)?.[0] ?? "";
    const bare = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    if (!fn) c15.fail("could not locate writeSleevePlan", "a rotted check, not a clean repo");
    // Order matters and the string order in the source is the ladder.
    const order = ["'karma'", "'rep'", "'money'", "'exp'"].map((k) => [k, bare.indexOf(k)]).filter(([, i]) => i >= 0);
    const idx = Object.fromEntries(order);
    if (idx["'exp'"] === undefined) {
      c15.fail("the objective ladder must be able to choose 'exp'", "on money a sleeve delivered 0.003% of income; studying, 1.8% of the player's exp rate");
    }
    if (idx["'money'"] === undefined) c15.fail("money must remain reachable for saves where sleeve exp is disabled");
    // money must be GATED on expDisabled, not be the bare fallback.
    if (!/expDisabled/.test(bare)) {
      c15.fail("money must be chosen only when sleeve exp is impossible", "otherwise it is picked whenever no faction is workable, which is most of a node whose only real reputation is the gang's own");
    }
    c15.note(`'exp' assignment: sync ${under.tasks[0]} below 100, then ${synced.tasks[0]} at 100; money gated on expDisabled`);
  }
  checks.push(c15);

  const c16 = new Check("SP16", "sleeve augs: decided by two simulated exits in progress.js; sleeveaug.js buys exactly that batch");
  {
    const fs = (await import("node:fs")).default;
    const path = (await import("node:path")).default;
    const { fileURLToPath } = await import("node:url");
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../progress.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const fn = src.slice(src.indexOf("function sleeveAugExitOf"), src.indexOf("function covenantExitOf"));
    if (typeof sp.sleeveAugBatch === "function") c16.fail("the leg-hours shortcut must not come back");
    if (!/const without = bestExitPolicy\(split\(1, 1, 0, 0\)\)/.test(fn)) c16.fail("the base trajectory must be the same builder with no batch");
    if (!/bestExitPolicy\(sl\.objective === 'rep' \? split\(G, 1, sl\.retrainHours \?\? 0, cost\) : split\(1, G, 0, cost\)\)/.test(fn)) c16.fail("each batch must be a simulated exit on the same builder");
    if (!/money: Math\.max\(0, base\.money - cost\)/.test(fn) || !/replanAt\(Math\.max\(0, liveMoney - cost\)\)/.test(fn)) c16.fail("the batch run must spend the price and re-plan the pending augs on what is left");
    if (!/const deltaH = best\.hours - without\.best\.hours/.test(fn)) c16.fail("the decision is the difference of the two exits");

    const { main } = await import("../../sleeveaug.js");
    const now = new Date().toISOString();
    const run = async (o = {}) => {
      const files = {
        "/tel/sleeve.txt": JSON.stringify({ at: now, disableSleeveExp: false, assigned: [{ i: 0, task: "FACTION" }] }),
        "/tel/status.txt": JSON.stringify({ at: now, incomePerSec: 1e8 }),
        "/tel/factionplan.txt": JSON.stringify({}),
        "/tel/snap-augstats.txt": JSON.stringify({ data: { stats: { A: { faction_rep: 1.2 }, B: { hacking: 1.1 } } } }),
        "/tel/installgate.txt": JSON.stringify({ lastAugReset: o.life ?? 1, planned: false, plan: null, joinClaim: o.join ?? 0, sleeveAugExit: { at: o.stale ? new Date(Date.now() - 3600e3).toISOString() : now, i: 0, buy: o.buy ?? ["A", "B"], why: "t" } }),
      };
      const log = [];
      const ns = {
        args: [], flags: () => ({ dry: false }), disableLog() {}, atExit() {},
        read: (f) => files[f] ?? "", write: (f, d) => (files[f] = d),
        getResetInfo: () => ({ currentNode: 10, lastAugReset: 1, ownedSF: new Map() }),
        getPlayer: () => ({ factions: [] }), getServerMoneyAvailable: () => o.money ?? 1e12, getServerMaxRam: () => 2 ** 30, getServer: () => ({ cpuCores: 8 }),
        format: { number: (x) => String(x) },
        sleeve: {
          getNumSleeves: () => 1, getSleeveCost: () => 1e13, purchaseSleeve: () => ({ success: false }),
          getSleeve: () => ({ shock: o.shock ?? 0, sync: 100, exp: { hacking: 1000 }, mults: { hacking_exp: 1 } }),
          getSleevePurchasableAugs: () => [{ name: "A", cost: 1e9 }, { name: "B", cost: 2e9 }, { name: "C", cost: 5e9 }],
          purchaseSleeveAug: (i, n) => (log.push(n), true),
        },
      };
      await main(ns);
      return { log, out: JSON.parse(files["/tel/sleeveaug.txt"] || "{}") };
    };
    c16.examined(10);
    const ok = await run();
    if (ok.log.join() !== "A,B") c16.fail(`must buy exactly the published batch, bought ${ok.log}`);
    if (!Array.isArray(ok.out.offers) || ok.out.offers[0]?.augs?.length !== 2 || ok.out.offers[0]?.objective !== "rep") c16.fail("the offers (with mults and objective) must be published for the comparison");
    if (!(ok.out.offers?.[0]?.retrainHours > 0)) c16.fail("the retrain the purchase forces must be published");
    if ((await run({ stale: true })).log.length) c16.fail("a stale verdict must not buy");
    if ((await run({ life: 2 })).log.length) c16.fail("another life's verdict must not buy");
    if ((await run({ shock: 5 })).log.length) c16.fail("shock > 0: the game refuses; do not try");
    if ((await run({ buy: ["A", "Z"] })).log.length) c16.fail("a batch naming an aug no longer offered must wait for a fresh comparison");
    if ((await run({ money: 2.5e9, join: 1e9 })).log.length) c16.fail("the join claim is never spent");
  }
  checks.push(c16);

  const c17 = new Check("SP17", "Covenant sleeves: cost ladder, count, and one published comparison decides");
  {
    c17.examined(8);
    if (sp.covenantSleeveCost(0) !== 10e12 || sp.covenantSleeveCost(2) !== 1e15 || sp.covenantSleeveCost(5) !== Infinity) c17.fail("cost is 10^n x $10t for n < 5 (getSleeveCost)");
    if (sp.sleevesFromCovenant(1, 0, 10) !== 0 || sp.sleevesFromCovenant(3, 1, 10) !== 1 || sp.sleevesFromCovenant(4, 3, 4) !== 1) c17.fail("count = fleet - min(3, SF10 + inBN10)");
    const A = sp.covenantActive;
    if (!A({ lastAugReset: 1, covenantExit: { active: true } }, 1)) c17.fail("a published faster trajectory is active");
    if (A({ lastAugReset: 1, covenantExit: { active: false, deltaH: -5 } }, 1)) c17.fail("only `active` decides — a faster delta outside the final window is not");
    if (A({ lastAugReset: 1, covenantExit: { active: "yes" } }, 1)) c17.fail("active must be exactly true");
    if (A({ lastAugReset: 1, covenantExit: { active: true } }, 2)) c17.fail("another life's gate file is never active");
    if (A({ lastAugReset: 1 }, 1)) c17.fail("no comparison published is not active");
    if (typeof sp.covenantCampaign === "function" || typeof sp.extraSleeveHoursSaved === "function") c17.fail("the snapshot shortcut (hours saved on a leg) must not come back — decisions compare simulated trajectories");
  }
  checks.push(c17);

  const c18 = new Check("SP18", "sleeveaug.js buys a Covenant sleeve only as a member and only when the published trajectory comparison is on");
  {
    const { main } = await import("../../sleeveaug.js");
    const now = new Date().toISOString();
    const world = (o = {}) => {
      const files = {
        "/tel/sleeve.txt": JSON.stringify({ at: now, disableSleeveExp: false, factionRepPerSec: 0.46, assigned: [{ i: 0, task: "FACTION" }] }),
        "/tel/status.txt": JSON.stringify({ at: now, incomePerSec: o.income ?? 1e8, expPerSec: 7000 }),
        "/tel/factionplan.txt": JSON.stringify({ measuredBaseRepPerSec: 3.54, totalHours: 50 }),
        "/tel/sleeveplan.txt": JSON.stringify({ horizonHours: 1000 }),
        "/tel/snap-augstats.txt": JSON.stringify({ data: { stats: {} } }),
        "/tel/installgate.txt": JSON.stringify({ lastAugReset: 1, planned: false, plan: null, joinClaim: o.join ?? 0, covenantExit: { active: !!o.active, why: "test" } }),
      };
      const log = [];
      const ns = {
        args: [], flags: () => ({ dry: false }), disableLog() {}, atExit() {},
        read: (f) => files[f] ?? "", write: (f, d) => (files[f] = d),
        getResetInfo: () => ({ currentNode: o.node ?? 10, lastAugReset: 1, ownedSF: new Map() }),
        getPlayer: () => ({ factions: o.member === false ? [] : ["The Covenant"] }),
        getServerMoneyAvailable: () => o.money ?? 2e13, getServerMaxRam: () => 2 ** 30, getServer: () => ({ cpuCores: 8 }),
        format: { number: (x) => String(x) },
        sleeve: {
          getNumSleeves: () => 1, getSleeveCost: () => 1e13,
          purchaseSleeve: () => (log.push("purchaseSleeve"), { success: true }),
          getSleeve: () => ({ shock: 100, sync: 100, exp: { hacking: 0 }, mults: { hacking_exp: 1 } }),
          getSleevePurchasableAugs: () => [], purchaseSleeveAug: () => false,
        },
      };
      return { ns, log };
    };
    const run = async (o) => {
      const w = world(o);
      await main(w.ns);
      return w;
    };
    c18.examined(7);
    if ((await run({ active: true, money: 5e12 })).log.length) c18.fail("the mandate never buys what the money cannot clear");
    if (!(await run({ active: true })).log.includes("purchaseSleeve")) c18.fail("an active comparison must buy");
    // Under the mandate (BN10, fewer than 4 bought) a member buys whenever the
    // money clears the join claim — the user decided the campaign; only its
    // timing is priced.
    if (!(await run({ active: false, income: 1e15 })).log.includes("purchaseSleeve")) c18.fail("the mandate must buy as a member with the money, comparison or not");
    if ((await run({ active: true, member: false })).log.length) c18.fail("never without Covenant membership");
    if ((await run({ active: true, node: 4 })).log.length) c18.fail("never outside BitNode 10");
    if ((await run({ active: true, money: 1.5e13, join: 1e13 })).log.length) c18.fail("the join claim is never spent");
    if (!(await run({ active: true, money: 2.5e13, join: 1e13 })).log.includes("purchaseSleeve")) c18.fail("money beyond the join claim buys");
  }
  checks.push(c18);

  const c19 = new Check("SP19", "progress.js decides the Covenant by comparing two simulated exits on one set of inputs, on both paths");
  {
    const fs = (await import("node:fs")).default;
    const path = (await import("node:path")).default;
    const { fileURLToPath } = await import("node:url");
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../progress.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    c19.examined(6);
    const fn = src.slice(src.indexOf("function covenantExitOf"), src.indexOf("function exitInputsOf"));
    if (!/bestExitPolicy\(\{ \.\.\.inputs\(\), covenant: \{/.test(fn)) c19.fail("the campaign trajectory must be the SAME inputs plus `covenant`");
    if (!/const deltaH = \(useB \? pathB\.hours : withC\.best\.hours\) - base\.hours/.test(fn)) c19.fail("the decision must be the difference of simulated exits (the chosen path's against the base)");
    if (!/const wB = bestExitPolicy\(\{ \.\.\.inputs\(\), firstInstallH: 0, covenant: \{ cost, joinMoney: COVENANT\.joinMoney, combatH: lb\.hours,[^}]*\} \}, 400, 1\)/.test(fn)) c19.fail("path B must be its own simulated exit: install now (firstInstallH 0, at least one install), then the campaign at the post-install combat hours");
    if (!/const useB = !!pathB && pathB\.hours < withC\.best\.hours/.test(fn)) c19.fail("path B is chosen only when its exit beats path A's");
    if (!/base\.installsFirst !== 0 \|\| withC\.best\.installsFirst !== 0\) return out\(false/.test(fn)) c19.fail("active only in the final window");
    if ((src.match(/covenantExitOf\(ns, info, player, schedule,/g) || []).length < 3) c19.fail("both the planned and the nothing-to-buy path must publish the comparison");
    if (!/const cv = covenantActive\(readJson\(ns, '\/tel\/installgate\.txt'\), info\?\.lastAugReset\)\s*if \(!cv\) return null[\s\S]{0,700}const bodyStep = covenantStep \?\?/.test(src)) c19.fail("the Covenant gym legs must run only while the campaign is on, ahead of the schedule's own body step");
    const rf = src.slice(src.indexOf("function readFleet"), src.indexOf("function readFleet") + 3200);
    if (!/sleeves: Number\.isInteger\(f\.sleeves\) \? f\.sleeves : null/.test(rf)) c19.fail("readFleet must return the fleet size the comparison counts from");
  }
  checks.push(c19);

  const c20 = new Check("SP20", "the sleeve objective is the soonest of simulated exits, one per objective, from the player-alone base");
  {
    const fs = (await import("node:fs")).default;
    const path = (await import("node:path")).default;
    const { fileURLToPath } = await import("node:url");
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../progress.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const fn = src.slice(src.indexOf("function sleeveObjectiveByExit"), src.indexOf("function spendVerdictsOf"));
    c20.examined(6);
    if (!/const base = inputsFn\(\{ expToPlayerHacking: 0, factionRepPerSec: 0 \}\)/.test(fn)) c20.fail("the base must be the shared builder with the fleet removed");
    if (!/if \(repFaction && by\.rep > 0\) fns\.push\(\['rep', \(b\) => finish\(\{ \.\.\.b, sleeveRep: \{ perSec: by\.rep, delayH: 0 \}, \.\.\.\(playerRep > 0 \? \{ repBoost: \{ K: \(playerRep \+ by\.rep\) \/ playerRep, e: eRep \} \} : \{\}\) \}/.test(fn)) c20.fail("rep: the sleeve's rep on the exit leg always; repBoost only with a measured player rate (it vanished whenever the rate was estimated)");
    if (!/\['money', \(b\) => finish\(\{ \.\.\.b, extraIncome: \[\{ atH: 0, perSec: by\.money \}\], eBudget: eB \}/.test(fn)) c20.fail("money: crime income from now through eBudget");
    if (!/\['karma', \(b\) => finish\(b, \{ karmaPerSec: by\.karma/.test(fn)) c20.fail("karma: the fleet's karma shortening the gang's grind");
    if (!/\.sort\(\(a, b\) => \(Math\.abs\(a\[1\] - b\[1\]\) < 1 \/ 60 \? 0 : a\[1\] - b\[1\]\)\)/.test(fn)) c20.fail("the soonest exit must win (ties within a minute keep the earlier-listed objective)");
    // Each candidate is a trajectory of the base, run on the point AND on every posterior draw (the plan's commitment rule).
    if (!/const cands = fns\.map\(\(\[o, f\]\) => \[o, f\(base\)\]\)/.test(fn) || !/decideAmong\(\{ options: fns/.test(fn)) c20.fail("the objective must be priced on the base and committed through plan.decideAmong on the shared draws");
    if (!/objectiveDecidedBy: byExit\?\.objective === 'covenant' \? 'covenant-mandate' : byExit\?\.objective \? 'exit-sim' : `ladder-fallback/.test(src)) c20.fail("the ladder survives only as the named fallback");
  }
  checks.push(c20);

  const c21 = new Check("SP21", "synchronise, shock recovery and train-first are decided by two simulated exits when priced");
  {
    const { bestExitPolicy } = await import("../../exitplan.js");
    c21.examined(8);
    const now = Date.now();
    const rec = { at: new Date(now).toISOString(), lastAugReset: 1, inputs: { money: 1e9, incomePerSec: 1e8, hacking: 800, hackingExp: 1e9, hackingMult: 1.5, expPerSec: 1e4, repPerSec: 30, exitRep: 0, exitFavor: 0, terminalRep: 2.5e6, exitLevel: 3000, joinMoney: 100e9, cycleHours: 4, multGainPerCycle: 1.1 }, eRep: 0.2, eBudget: 0.1 };
    const ex = sp.sleeveExitOf(rec, 1, bestExitPolicy, now);
    if (typeof ex !== "function") c21.fail("a fresh same-life record builds exitOf");
    else {
      if (ex("karma", { perSec: 1, delayH: 0 }) !== null) c21.fail("karma is progress.js's to price — refuse");
      for (const k of ["rep", "exp", "money"]) if (!(ex(k, { perSec: 10, delayH: 0 }) > 0)) c21.fail(`${k} must price`);
      if (!(ex("rep", { perSec: 10, delayH: 0 }) < ex("rep", { perSec: 10, delayH: 5 }))) c21.fail("the same rate later must be slower");
    }
    if (sp.sleeveExitOf({ ...rec, lastAugReset: 2 }, 1, bestExitPolicy, now) !== null) c21.fail("another life's inputs refuse");
    if (sp.sleeveExitOf({ ...rec, at: new Date(now - 3600e3).toISOString() }, 1, bestExitPolicy, now) !== null) c21.fail("stale inputs refuse");
    // The decisions follow the stub exitOf.
    const sleeve = { index: 0, sync: 40, shock: 0, skills: { hacking: 50, strength: 10, defense: 10, dexterity: 10, agility: 10, charisma: 1, intelligence: 0 }, exp: { hacking: 1000, strength: 100, defense: 100, dexterity: 100, agility: 100, charisma: 0 }, mults: { hacking_exp: 1, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1, charisma_exp: 1, hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, crime_success: 1, crime_money: 1, faction_rep: 1 }, city: "Sector-12", memory: 1 };
    const favorSync = (k, t) => (t.delayH > 0 ? 10 : 20) + (t.perSec === 0 ? 5 : 0);
    const favorNow = (k, t) => (t.delayH > 0 ? 20 : 10) + (t.perSec === 0 ? 5 : 0);
    const a1 = sp.sleeveAssignments([sleeve], null, { objective: "exp", horizonHours: 50, exitOf: favorSync, playerIntelligence: 0, money: 1e12 });
    if (a1?.tasks?.[0] !== "sync") c21.fail(`exp: a faster exit after synchronising must synchronise: ${a1?.why?.[0]}`);
    const a2 = sp.sleeveAssignments([sleeve], null, { objective: "exp", horizonHours: 5000, exitOf: favorNow, playerIntelligence: 0, money: 1e12 });
    if (a2?.tasks?.[0] === "sync") c21.fail(`exp: studying now must win when its exit is sooner, whatever the break-even says: ${a2?.why?.[0]}`);
    const a3 = sp.sleeveAssignments([{ ...sleeve, sync: 100, shock: 50 }], null, { objective: "exp", horizonHours: 5000, exitOf: favorNow, playerIntelligence: 0, money: 1e12 });
    if (a3?.tasks?.[0] === "shock") c21.fail(`shock: working now must win when its exit is sooner: ${a3?.why?.[0]}`);
  }
  checks.push(c21);

  const c22 = new Check("SP22", "the fleet's task reads from the OBJECT sleeve.js carries, not only a bare string");
  {
    c22.examined(4);
    const base = { index: 0, sync: 100, shock: 0, skills: { hacking: 50, intelligence: 0 }, exp: { hacking: 0 }, mults: { hacking_exp: 1 } };
    const studyingObj = sp.fleetExpToPlayer([{ ...base, task: { type: "CLASS", classType: "Algorithms" } }], { onlyStudying: true });
    const studyingStr = sp.fleetExpToPlayer([{ ...base, task: "CLASS" }], { onlyStudying: true });
    const crimeObj = sp.fleetExpToPlayer([{ ...base, task: { type: "CRIME" } }], { onlyStudying: true });
    if (!(studyingObj?.hacking > 0)) c22.fail(`a sleeve whose task is {type:'CLASS'} must transfer study exp (live: it read 0): ${JSON.stringify(studyingObj)}`);
    if (studyingObj?.hacking !== studyingStr?.hacking) c22.fail("object and string forms must agree");
    if (crimeObj?.hacking !== 0) c22.fail("a sleeve at crime transfers no study exp");
    if (sp.taskType({ type: "FACTION" }) !== "FACTION" || sp.taskType(null) !== null) c22.fail("taskType reads the object's type and refuses nothing as null");
  }
  checks.push(c22);

  const c23 = new Check("SP23", "a tie (under a minute of exit) keeps the sleeve working — no synchronise or train on floating-point noise");
  {
    c23.examined(2);
    const sleeve = { index: 0, sync: 40, shock: 0, skills: { hacking: 50, strength: 10, defense: 10, dexterity: 10, agility: 10, charisma: 1, intelligence: 0 }, exp: { hacking: 1000, strength: 100, defense: 100, dexterity: 100, agility: 100, charisma: 0 }, mults: { hacking_exp: 1, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1, charisma_exp: 1, hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, crime_success: 1, crime_money: 1, faction_rep: 1 }, city: "Sector-12", memory: 1 };
    const almost = (k, t) => 40.77 - (t.delayH > 0 ? 1e-9 : 0);
    const a = sp.sleeveAssignments([sleeve], null, { objective: "exp", horizonHours: 50, exitOf: almost, playerIntelligence: 0 });
    if (a?.tasks?.[0] === "sync") c23.fail(`a 1e-9h edge must not send the sleeve to synchronise: ${a?.why?.[0]}`);
    const p = sp.sleevePolicy({ ...sleeve, sync: 100 }, NODE1, { objective: "money", horizonHours: 50, exitOf: almost });
    if (!p) c23.fail("the policy must price (a null result would pass this check vacuously)");
    else if (p.task === "train") c23.fail(`a 1e-9h edge must not send the sleeve to train: ${p.why}`);
    if (p && p.decidedBy !== "exit-sim") c23.fail(`the policy must be decided by the exit here: ${p.decidedBy}`);
  }
  checks.push(c23);

  const c24 = new Check("SP24", "shock: the 'work now' side climbs as shock falls passively (a schedule), not a flat shocked rate");
  {
    c24.examined(2);
    const calls = [];
    const exitOf = (k, t) => (calls.push(t), t.steps ? 30 : t.perSec === 0 ? 40 : 31);
    const sleeve = { index: 0, sync: 100, shock: 60, skills: { hacking: 50, strength: 10, defense: 10, dexterity: 10, agility: 10, charisma: 1, intelligence: 0 }, exp: { hacking: 1000 }, mults: { hacking_exp: 1 }, city: "Sector-12", memory: 1 };
    const a = sp.sleeveAssignments([sleeve], null, { objective: "exp", horizonHours: 50, exitOf, playerIntelligence: 0, money: 1e12 });
    const withSteps = calls.find((t) => Array.isArray(t.steps));
    if (!withSteps || !(withSteps.steps.length > 2) || !(withSteps.steps[withSteps.steps.length - 1].perSec > withSteps.steps[0].perSec)) c24.fail(`the working side must be a rising schedule: ${JSON.stringify(calls[0])}`);
    if (a?.tasks?.[0] === "shock") c24.fail("with working-now sooner, the sleeve must not recover");
  }
  checks.push(c24);

  const c25 = new Check("SP25", "the Covenant mandate: binds in BN10 below 4 bought; combat legs stack the fleet's gym exp on the player's stat");
  {
    c25.examined(6);
    if (sp.COVENANT_MANDATE.target !== 4 || sp.COVENANT_MANDATE.opportunistic !== 5 || sp.COVENANT_MANDATE.node !== 10) c25.fail(`the user's decision is #1-#4 in BN10, #5 opportunistic: ${JSON.stringify(sp.COVENANT_MANDATE)}`);
    if (!sp.covenantMandated(10, 0) || !sp.covenantMandated(10, 3) || sp.covenantMandated(10, 4) || sp.covenantMandated(4, 0) || sp.covenantMandated(10, null)) c25.fail("binds in BN10 while fewer than 4 are bought, nowhere else, never on an unknown count");
    const player = { exp: { strength: 0, defense: 0, dexterity: 0, agility: 0 }, mults: { strength: 1, defense: 1, dexterity: 1, agility: 1, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1 } };
    const alone = sp.covenantCombatHours(player, null, 1);
    const P = alone.legs[0].playerRate;
    const helped = sp.covenantCombatHours(player, { strength: P, defense: P, dexterity: P, agility: P }, 1);
    if (Math.abs(helped.hours - alone.hours / 2) > 1e-9) c25.fail(`a fleet matching the player's gym rate halves the legs: ${alone.hours} -> ${helped.hours}`);
    if (helped.current !== "strength" || alone.legs.length !== 4) c25.fail("all four stats are legs, trained in a fixed order");
    const tm2 = sp.covenantCombatHours(player, { strength: P, defense: P, dexterity: P, agility: P }, 2);
    if (Math.abs(tm2.hours - helped.hours / 2) > 1e-9) c25.fail("the training multiplier scales player and fleet alike");
    const a = sp.sleeveAssignments([{ index: 0, sync: 100 }, { index: 1, sync: 50 }], null, { objective: "covenant", trainStat: "agility", money: 1e12 });
    if (a?.tasks?.join() !== "agility,agility") c25.fail(`every sleeve trains the campaign's stat: ${a?.tasks}`);
  }
  checks.push(c25);

  const c26 = new Check("SP26", "sleeve memory: bought to 100 only when free in this node (< a minute of exit), only after the mandate, only in BN10 as a member");
  {
    const { main } = await import("../../sleeveaug.js");
    const now = new Date().toISOString();
    const run = async (o = {}) => {
      // An exit that depends on the next batch: a long climb at a low multiplier.
      const inputs = { money: 1e16, incomePerSec: 1e12, hacking: 3000, hackingExp: 1e12, hackingMult: 1, expPerSec: 1e5, repPerSec: 30, exitRep: 0, exitFavor: 0, terminalRep: 0, exitLevel: 6000, joinMoney: 100e9, cycleHours: 4, multGainPerCycle: 1.1 };
      const ladder = [0, 0.5, 0.9, 1, 2].map((f) => ({ money: (o.ladderScale ?? 1e16) * f, gains: { hacking: 1 + (o.ladderSlope ?? 0) * f, rep: 1, income: 1, exp: 1 } }));
      const files = {
        "/tel/sleeve.txt": JSON.stringify({ at: now, disableSleeveExp: false, assigned: [] }),
        "/tel/status.txt": JSON.stringify({ at: now, incomePerSec: 1e12 }),
        "/tel/factionplan.txt": JSON.stringify({}),
        "/tel/snap-augstats.txt": JSON.stringify({ data: { stats: {} } }),
        "/tel/installgate.txt": JSON.stringify({ lastAugReset: 1, planned: false, plan: null, joinClaim: 0 }),
        "/tel/exitinputs.txt": JSON.stringify({ at: now, lastAugReset: 1, W: 2, finalWindow: false, moneyAtW: o.ladderScale ?? 1e16, gainsByMoney: ladder, eRep: 0, eBudget: 0, inputs }),
      };
      const log = [];
      const ns = {
        args: [], flags: () => ({ dry: false }), disableLog() {}, atExit() {},
        read: (f) => files[f] ?? "", write: (f, d) => (files[f] = d),
        getResetInfo: () => ({ currentNode: o.node ?? 10, lastAugReset: 1, ownedSF: new Map() }),
        getPlayer: () => ({ factions: o.member === false ? [] : ["The Covenant"] }),
        getServerMoneyAvailable: () => o.money ?? 1e16, getServerMaxRam: () => 2 ** 30, getServer: () => ({ cpuCores: 8 }),
        format: { number: (x) => String(x) },
        sleeve: {
          getNumSleeves: () => o.fleet ?? 5, getSleeveCost: () => 1e17, purchaseSleeve: () => ({ success: false }),
          getSleeve: () => ({ shock: 0, sync: 100, memory: 1, exp: { hacking: 0 }, mults: { hacking_exp: 1 } }),
          getSleevePurchasableAugs: () => [], purchaseSleeveAug: () => false,
          getMemoryUpgradeCost: () => 3.05e14, upgradeMemory: (i, a) => (log.push(`mem ${i} +${a}`), { success: true }),
        },
      };
      await main(ns);
      return log;
    };
    c26.examined(5);
    const free = await run({});
    if (free.length !== 5 || free[0] !== "mem 0 +99") c26.fail(`money not binding: every sleeve to 100 — got ${free}`);
    if ((await run({ fleet: 3 })).length) c26.fail("never before the mandated sleeves (fewer than 4 bought)");
    if ((await run({ node: 4 })).length) c26.fail("only in BitNode 10");
    if ((await run({ member: false })).length) c26.fail("only as a Covenant member");
    // Money binding: the next batch shrinks with the spend -> the exit is slower -> no buy.
    if ((await run({ ladderScale: 2e15, ladderSlope: 50, money: 2e15 })).length) c26.fail("when the spend costs the node's exit time it must wait for a decision");
  }
  checks.push(c26);

  const c27 = new Check("SP27", "combat levels carry the node's LevelMultiplier: exp that reads 850 at x1 is short at BN10's x0.4");
  {
    c27.examined(3);
    // The game's own formula, read rather than remembered.
    const person = game("src/PersonObjects/Person.ts");
    for (const [k, key] of [["strength", "StrengthLevelMultiplier"], ["agility", "AgilityLevelMultiplier"]]) {
      if (!new RegExp(`this\\.mults\\.${k} \\* currentNodeMults\\.${key}`).test(person)) c27.fail(`Person.ts no longer levels ${k} as mults.${k} x ${key}`);
    }
    // exp enough for 850 at x1.5 (raw) is far short at x1.5 x 0.4.
    const exp = Math.exp((850 / 1.5 + 200) / 32);
    const raw = { exp: { strength: exp, defense: exp, dexterity: exp, agility: exp }, mults: { strength: 1.5, defense: 1.5, dexterity: 1.5, agility: 1.5, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1 } };
    const levelled = { ...raw, mults: { ...raw.mults, strength: 0.6, defense: 0.6, dexterity: 0.6, agility: 0.6 } };
    if (sp.covenantCombatHours(raw, null, 1).hours !== 0) c27.fail("fixture: at x1.5 raw the exp reaches 850");
    const lv = sp.covenantCombatHours(levelled, null, 1);
    if (!(lv.hours > 0) || lv.current !== "strength") c27.fail(`at x0.6 effective the same exp is short and strength trains first: ${JSON.stringify(lv)}`);
  }
  checks.push(c27);

  const c28 = new Check("SP28", "path B's batch: combat-level augs with rep met and prerequisites in hand; the post-install person has lifted mults and zero combat exp");
  {
    c28.examined(5);
    const offers = [
      { name: "Legs", faction: "G", repReq: 10, factionRep: 100, mults: { agility: 1.6 }, prereqs: [] },
      { name: "Graphene Legs", faction: "G", repReq: 10, factionRep: 100, mults: { agility: 2.5 }, prereqs: ["Legs"] },
      { name: "Rep-short", faction: "G", repReq: 1000, factionRep: 100, mults: { strength: 2 }, prereqs: [] },
      { name: "Orphan", faction: "G", repReq: 1, factionRep: 100, mults: { defense: 1.5 }, prereqs: ["Missing"] },
      { name: "Hack", faction: "G", repReq: 1, factionRep: 100, mults: { hacking: 2 }, prereqs: [] },
    ];
    const b = sp.combatBatch(offers, []);
    const names = (b?.names ?? []).sort().join();
    if (names !== "Graphene Legs,Legs") c28.fail(`batch: combat-level, rep met, prereqs satisfiable — got ${names}`);
    if (Math.abs((b?.gains?.agility ?? 0) - 4) > 1e-12) c28.fail("agility gain is the product (1.6 x 2.5)");
    if (sp.combatBatch(offers, ["Legs", "Graphene Legs"]) !== null) c28.fail("nothing left once owned");
    const after = sp.afterCombatInstall({ mults: { agility: 2, agility_exp: 1 }, exp: { agility: 5e7, hacking: 9 } }, b);
    if (after.mults.agility !== 8 || after.exp.agility !== 0 || after.exp.hacking !== 9) c28.fail("post-install: mults x gains, combat exp zeroed, other exp kept");
    const pr = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../progress.js"), "utf8");
    if (!/const ready = \[\.\.\.left\]\.filter\(\(n\) => \(sing\.augPrereq\(n\) \?\? \[\]\)\.every\(\(q\) => have\.has\(q\) \|\| seq\.includes\(q\)\)\)/.test(pr)) c28.fail("the batch must be ordered prerequisites-first");
  }
  checks.push(c28);

  return checks;
}
