// THE GANG AS A PRICED TRAJECTORY (live BN1 2026-09-28 00:14Z).
//
// The state: karma -576 falling ~266/h, gang.txt refused (karma -573 of
// -54,000), all five sleeves in CLASS (shock 82) with karmaPerSec 0, and the
// gang verdict UNPRICED: "no simulated exit comparison: exit unpriceable
// (could not price the reputation leg: no measured reputation rate)". A
// partial grind nobody had decided.
//
//   GD1  the grind is a TRAJECTORY: sleeves on their best karma crime train as
//        they go (their exp shared to each other and the player,
//        Sleeve/Work/Work.ts:16-24) — far faster than the constant 0.03/s
//        snapshot, and faster again with the work slot on crime.
//   GD2  the decision is gangworth.gangArms on the live exit inputs: none /
//        fleet / fleet+player, the unmeasured reputation rate filled by the
//        formula estimate in EVERY arm (labelled); the slot joins only if it
//        wins with its hours charged as an upper bound.
//   GD3  the verdict carries the arm; act.js's crime loop and progress.js's
//        slot yield follow `playerSlot`; the sleeve objective follows the
//        decision; plan.txt carries decisions.gang; sleeve.js publishes the
//        persons the grind is computed from.
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const SP = await import("../../sleeveplan.js");
const BP = await import("../../bodyplan.js");
const GW = await import("../../gangworth.js");
const GP = await import("../../gangplan.js");
const X = await import("../../exitplan.js");
const IG = await import("../../installgate.js");
const T = await import("../../trajectory.js");
const AP = await import("../../actplan.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");

const FIX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn1-gang-0014.json"), "utf8"));
const SK = ["hacking", "strength", "defense", "dexterity", "agility", "charisma"];
const node = bitNodeMults(1);
const unitMults = (combat = 1) => ({ ...Object.fromEntries(SK.map((k) => [k, ["strength", "defense", "dexterity", "agility"].includes(k) ? combat : 1])), ...Object.fromEntries(SK.map((k) => [`${k}_exp`, 1])), crime_success: 1, crime_money: 1 });

// Sleeves: the published skills (sleeve.txt `assigned`, before `persons`
// existed); exp inverted from the level at mults 1 (no sleeve augs), int 0.
const sleeves = FIX.sleeves.map((s) => {
  const skills = { hacking: s.skills.hack, strength: s.skills.str, defense: s.skills.def, dexterity: s.skills.dex, agility: s.skills.agi, charisma: 1, intelligence: 0 };
  return { skills, exp: Object.fromEntries(SK.map((k) => [k, Math.max(0, IG.expForSkill(skills[k], 1))])), mults: unitMults(1), sync: s.sync, shock: s.shock };
});
// The player: state.json skills and exp; the combat LEVEL multiplier is not
// in the digest — 1.34 is strength 92 at 3,882 exp inverted (skillFromExp),
// exp multipliers 1 (the conservative direction for a grind).
const player = { skills: { ...FIX.player.skills }, exp: { ...FIX.player.exp }, mults: unitMults(1.34) };
const grindO = { karmaTarget: -54000, karma: FIX.player.karma, cycleHours: FIX.exitInputs.cycleHours };

function gangSchedule() {
  const G = { faction: "Slum Snakes", isHacking: false, respect: 1, wantedLevel: 1, territory: 1 / 7, power: 1, territoryClashChance: 0, territoryWarfareEngaged: false };
  const rivals = Object.fromEntries(["Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead", "NiteSec", "The Black Hand"].map((n) => [n, { power: 1, territory: 1 / 7 }]));
  const sim = GP.simulateGang(G, [], { softcap: node.GangSoftcap, horizonH: 100, stepSec: 300, mode: "money", assignFn: GP.trainRatio(4.2, false, 1), ascend: { minGain: 1.09 }, rivals, warfare: { fraction: 0, engageRatio: 1 } });
  return GW.gangIncomeSchedule(sim);
}

export async function run() {
  const checks = [];

  const g1 = new Check("GD1", "the karma grind is a trajectory: the fleet on its best karma crime trains as it goes, and the work slot on crime shortens it further");
  const fleet = SP.fleetKarmaGrind(sleeves, node, grindO);
  const both = SP.fleetKarmaGrind(sleeves, node, { ...grindO, player });
  {
    g1.examined(5);
    if (!fleet || !both) g1.fail("the replayed fleet must be simulable");
    else {
      const constH = (-54000 - FIX.player.karma) / -fleet.karmaPerSecNow / 3600;
      g1.note(`fleet alone ${fleet.hours.toFixed(1)}h (karma ${fleet.karmaPerSecNow.toFixed(3)}/s now -> ${fleet.karmaPerSecEnd.toFixed(2)}/s, ${fleet.crimes.join("/")}); with the work slot ${both.hours.toFixed(1)}h; held constant it would be ${constH.toFixed(0)}h`);
      if (!(fleet.hours < 24 && fleet.hours > 2)) g1.fail(`five sync-100 sleeves ramping on Homicide reach -54,000 in hours, not ${fleet.hours}h`);
      if (!(fleet.hours < constH / 10)) g1.fail("the ramp must be simulated: the constant-rate snapshot overstates the grind tenfold");
      if (!(both.hours < fleet.hours)) g1.fail("the work slot on crime must shorten the grind");
      if (fleet.karmaPerSecEnd <= fleet.karmaPerSecNow) g1.fail("sleeves' karma rate must rise as they train");
      // Passive shock recovery while working (Sleeve.ts:270): 0.0001/cycle x 5 cycles/s at int 0.
      const shockWant = Math.max(0, sleeves[0].shock - 0.0005 * fleet.hours * 3600);
      if (!(Math.abs(fleet.shockEnd - shockWant) < 0.5)) g1.fail(`shock falls passively as the fleet works: ${fleet.shockEnd} vs ${shockWant.toFixed(1)}`);
      // The share: one sleeve alone trains slower than one of five (each gets the others' exp).
      const one = SP.fleetKarmaGrind([sleeves[0]], node, { ...grindO, karmaTarget: FIX.player.karma - 2000 });
      const five = SP.fleetKarmaGrind(sleeves, node, { ...grindO, karmaTarget: FIX.player.karma - 10000 });
      if (!(five.hours < one.hours)) g1.fail("five sleeves sharing exp must deliver 5x the karma in less time than one delivers 1x (exp shared, Work.ts:23)");
    }
    if (SP.fleetKarmaGrind(sleeves, node, { ...grindO, cycleHours: null }) !== null) g1.fail("no cycle length: refuse (null), never assume one");
  }
  checks.push(g1);

  const g2 = new Check("GD2", "the gang decision is exit WITH the gang (per grind arm) vs WITHOUT, on the live inputs; an unmeasured reputation rate is the formula estimate in every arm, labelled");
  let arms = null;
  {
    g2.examined(6);
    const sched = gangSchedule();
    const est = T.estimateBaseRepPerSec({ hacking: FIX.player.skills.hacking, intelligence: FIX.player.skills.intelligence, factionRepMult: 1, nodeWorkRepMult: 1, sharePower: 1 });
    const base = { ...FIX.exitInputs, repPerSecEstimate: est };
    const unpriced = GW.gangArms(X.bestExitPolicy, FIX.exitInputs, sched, { fleet: fleet.hours, player: both.hours }, FIX.eBudget);
    if (unpriced.best !== null) g2.fail("with no measured rate and no estimate the exit is unpriced: refuse");
    arms = GW.gangArms(X.bestExitPolicy, base, sched, { fleet: fleet.hours, player: both.hours }, FIX.eBudget);
    g2.note(arms.why);
    if (!arms.arms?.fleet || !arms.arms?.player) {
      g2.fail(`the replay must price every arm (${arms.why})`);
      checks.push(g2);
      return checks;
    }
    if (!/estimated/.test(arms.repSource ?? "")) g2.fail("the estimate must be labelled on the verdict");
    const none = X.bestExitPolicy({ ...base, repPerSec: est }, 400).best.hours;
    if (Math.abs(arms.withoutH - none) > 1e-9) g2.fail("the WITHOUT arm is the plain exit on the same inputs");
    const withF = X.bestExitPolicy({ ...base, repPerSec: est, eBudget: FIX.eBudget, extraIncome: sched.map((x) => ({ atH: x.atH + fleet.hours, perSec: x.perSec })) }, 400).best.hours;
    if (Math.abs(arms.arms.fleet.withH - withF) > 1e-9) g2.fail("the fleet arm is the exit with the gang's income from the end of the fleet's grind");
    if (arms.best !== "fleet" || !(arms.savedH > 0)) g2.fail(`on the replay the gang wins with the fleet grinding (got ${arms.best}, ${arms.savedH}h)`);
    if (!(arms.arms.player.withH >= arms.arms.player.grindH + 0)) g2.fail("the slot arm carries its hours as an upper bound");
    if (arms.best === "player") g2.fail("the slot must not join when its hours are not repaid");
  }
  checks.push(g2);

  const g3 = new Check("GD3", "the verdict carries the arm; the crime loop, the slot yield, the sleeve objective and plan.txt follow it; sleeve.js publishes its persons");
  {
    g3.examined(8);
    const v = GW.gangVerdict({ node: 1, mults: node, inGang: false, grindHours: fleet.hours, gangExit: arms });
    g3.note(v.why);
    if (!(v.worth === true && v.arm === "fleet" && v.playerSlot === false)) g3.fail(`fleet arm: worth, arm 'fleet', playerSlot false (got ${JSON.stringify({ worth: v.worth, arm: v.arm, playerSlot: v.playerSlot })})`);
    const lose = GW.gangVerdict({ node: 1, mults: node, inGang: false, grindHours: 11, gangExit: { ...arms, best: "none", savedH: 0, withH: arms.withoutH } });
    if (lose.worth !== false || !/partial grind stops/.test(lose.why)) g3.fail("a losing gang says so and stops the partial grind");
    // act.js: in Slum Snakes with the gang's karma unmet — the crime loop only for the 'player' arm.
    const p = { skills: { hacking: 142, strength: 92, defense: 30, dexterity: 30, agility: 30, charisma: 1, intelligence: 121 }, exp: { hacking: 1e4, strength: 4e3, defense: 600, dexterity: 600, agility: 600, charisma: 0 }, mults: unitMults(1.34), karma: -576, numPeopleKilled: 3, city: "Sector-12", money: 5e6 };
    const st = (gw) => ({ now: Date.now(), gangNode: true, factions: ["Slum Snakes"], player: p, node, progress: null, schedule: null, work: null, tried: {}, gangKarma: -54000, gangWorth: gw });
    const dFleet = AP.decide(st(v));
    if (dFleet.kind === "crime" && /gang needs karma/.test(dFleet.why)) g3.fail("the 'fleet' arm keeps the work slot off the karma grind", dFleet.why);
    const dPlayer = AP.decide(st({ ...v, arm: "player", playerSlot: true }));
    if (dPlayer.kind !== "crime") g3.fail("the 'player' arm puts the work slot on the karma grind", `${dPlayer.kind}: ${dPlayer.why}`);
    const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
    const prog = src("progress.js");
    if (!/!gangCancelled && !\(inGangFaction && gangPrev\?\.playerSlot === false\)/.test(prog)) g3.fail("progress.js yields the slot to the gang bootstrap only while the decision wants it");
    if (!/else if \(verdict\?\.worth === true && verdict\?\.gatePaid !== true && verdict\?\.arm && verdict\.arm !== 'none'\) byExit = \{ objective: 'karma', gang: true/.test(prog)) g3.fail("the sleeve objective follows the gang decision");
    if (!/gang: pc\.decisions\.gang \?\? pc\.prev\?\.decisions\?\.gang \?\? null/.test(prog) || !/await planDecide\(pc, 'gang'/.test(prog)) g3.fail("the gang is a plan decision (decisions.gang on the shared draws)");
    if (!/exitCmp = gangArms\(bestExitPolicy, base, sched, \{ fleet: arms\.fleet, player: arms\.player \}/.test(prog)) g3.fail("progress.js prices the gang with gangArms on the ramping grinds");
    if (!/persons: sleeves\.map\(\(x\) => \(\{ i: x\.index, sync: x\.sync, shock: x\.shock, skills: x\.skills, exp: x\.exp, mults: x\.mults \}\)\)/.test(src("sleeve.js"))) g3.fail("sleeve.js publishes the persons the grind is computed from");
  }
  checks.push(g3);
  return checks;
}
