// STAGED ns.ramOverride REWRITE of training.js, with the game-knowledge.md
// §1/§10 defects FIXED.
//
// The ns.ramOverride scaffolding is unchanged from the deployed file; only the
// body that was preserved as `act(ns)` has been repaired. Every constant below
// is cited against ~/Repos/bitburner (v3.0.2, commit b5b09b8a8).
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 2.6GB — excludes: ns.singularity.travelToCity / universityCourse / gymWorkout (2GB each at base, 32GB each at SF4.1), stopAction (1/16GB) and isBusy (0.5/8GB), ns.getServer (2GB), ns.hacknet.getStudyMult / getTrainingMult (0.5GB each), plus common.js's spawn/kill/ps/hacknet reads.
//
// Why this is sound: Netscript bills a script for every ns identifier in its
// import graph whether or not the call is reachable (RamCalculations.ts:407
// prices Identifier nodes, findFunc at :225-243 matches bare names), but only
// CALLING a Source-File-gated function throws. So this file may carry the
// references, declare 2.6GB, refuse to act when sfgate.js says it cannot, and be
// correct — instead of being unloadable in every BitNode that cannot use it.
//
// 2.6 = RamCostConstants.Base (1.6) + ns.getResetInfo (1.0). That is everything
// called before the capability decision: sfgate.js is pure, status.js touches
// only ns.write (0GB), and atExit / tprint / print / flags are all 0GB.
//
// When the capability IS present the allocation is raised to the file's FULL
// static price before anything expensive runs, because `dynamicRamUsage` only
// rises and crossing the allocation kills the script
// (NetscriptHelpers.tsx:498-520). A raise the host cannot afford is SILENTLY
// DENIED (NetscriptFunctions.ts:1210-1214 returns the old value), which is why
// it goes through ramgrow.js and why this file returns rather than continuing.
//
// Registered in tools/sim/bncheck.mjs STRUCTURAL. Asserted by
// tools/test/ramoverride.test.mjs [R1..R5]: the game's own calculator prices
// this file in four regimes and the suite fails if the override is ignored or
// if RAISE_CEILING does not reach the full static price.
//
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN.
//
// 1. Class names. "Study Computer Science" and "Data Strucures" are not enum
//    members — UniversityClassType is "Computer Science" / "Data Structures" /
//    "Networks" / "Algorithms" / "Management" / "Leadership" (Work/Enums.ts:7-14),
//    and universityCourse routes the argument through a strict nsGetMember
//    (Singularity.ts:238; EnumHelper.ts:63-70 fuzz-matches only under
//    {fuzzy:true}). Both threw.
//
// 2. ALL FOUR gym stats threw. GymType uses skill SHORT CODES — "str", "def",
//    "dex", "agi" (Work/Enums.ts:17-22, with the comment "Uses skill short
//    codes to allow easier fuzzy matching with player input"), not
//    "strength"/"defense"/… gymWorkout is the same strict nsGetMember
//    (Singularity.ts:298). So the gym half of this script has never worked.
//
// 3. Gym base cost and exp were 2.67x and 4x wrong. The game gives every gym
//    class `money: -120, exp: 1` (Work/ClassWork.tsx:54-73); this file said
//    cost 320 / exp 4, which is the Algorithms/Leadership row.
//
// 4. Two omitted mechanics, both now modelled:
//      - a 10% discount when the location's own server is backdoored
//        (Work/Formulas.ts:100-105, `(server as Server)?.backdoorInstalled ? 0.9 : 1`)
//      - the hacknet hash multipliers, Work/Formulas.ts:113:
//          `isMember("GymType", type) ? getTrainingMult() : getStudyMult()`
//        applied to EXP only (:116), not to cost (:119). They are DIFFERENT
//        multipliers for gym and university, so with Improve Studying bought
//        and Improve Gym Training not (or vice versa) they reorder this
//        script's own ranking.
//
// 5. NOT in game-knowledge.md, and silent: the enum member is
//    `VolhavenZBInstituteOfTechnology = "ZB Institute of Technology"` —
//    lowercase "of" (Locations/Enums.ts:59). This file said "ZB Institute Of
//    Technology". universityCourse matches the university name with an exact
//    `switch` whose default arm merely LOGS and returns false
//    (Singularity.ts:242-276), so every ZB selection would have quietly done
//    nothing even after fix (1). Volhaven's ZB is the best exp multiplier for
//    hacking at 4x, so this is not a corner case.
//
// 6. Also silent: startClassFromClassEntry threw away the boolean that
//    universityCourse / gymWorkout return. Wrong city, wrong name, wrong class
//    — all of them return false and log to the script log nobody reads. It now
//    throws, which the caller publishes.
//
// 7. NOT in game-knowledge.md: `player[player_skill_name_lambda(skill)]` reads
//    flat skill names off ns.getPlayer(), which returns them nested under
//    `.skills` (NetscriptFunctions.ts:1371-1390). Every read was `undefined`,
//    so `--target-level` could never fire (`undefined < N` is false, so the
//    filter emptied the list and the script declared victory immediately) and
//    the "train the lowest skill" reduce always returned element 0.
//
// NOT changed, and verified correct against source: every location cost_mult /
// exp_mult (LocationsMetadata.ts — Crush 3/2, Snap 10/5, Summit 4/3, Iron 1/1,
// Powerhouse 20/10, Rothman 3/2, Millenium 7/4, ZB 5/4), every university base
// cost and exp (ClassWork.tsx:24-53), the 5 game cycles per second
// (Work/Formulas.ts:38, `gameCPS = 1000 / CONSTANTS.MilliPerCycle`) and the
// $200k travel cost (constants.js, Constants.ts:28 `TravelCost: 200e3`).
// ---------------------------------------------------------------------------
import { runCallbackExit } from "common.js"
import { exp_types, travel_cost, city_names } from "constants.js"
import { canUseSingularity, singularityRamMultiplier } from 'sfgate.js'
import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'

const RAMOVERRIDE_STATUS = '/tel/training.txt'

/** This file's FULL static price as a function of the Singularity RAM
 *  multiplier (sfgate.js:71-77 — 1 inside BN4, 16 at SF4.1, 4 at SF4.2, 1 at
 *  SF4.3). 10.25 = everything not under ns.singularity (7.25 as before, plus
 *  ns.getServer 2GB for the backdoor discount and 0.5GB each for
 *  ns.hacknet.getStudyMult / getTrainingMult); 7.5 = the ns.singularity surface
 *  at base price, unchanged. Both measured with the game's own calculator
 *  (tools/staging/fix4/measure.mjs) and re-checked on every run by
 *  ramoverride.test.mjs [R5]. */
const RAISE_CEILING = (mult) => 10.25 + 7.5 * mult

export async function main(ns) {
  ns.ramOverride(2.6)

  const rerrors = []
  const note = reporter(ns, RAMOVERRIDE_STATUS, () => ({ errors: rerrors.slice(-5) }))
  ns.atExit(() => note.exit('stopped', { detail: 'training.js exited' }))

  // Ask the GAME what this save can do, through the shared rules. Not a
  // try/catch around the namespace: RAM is billed before a line executes, so
  // such a guard can never fire (CLAUDE.md, "a guard that can never fire").
  const info = ns.getResetInfo()
  if (!canUseSingularity(info)) {
    note('waiting', {
      result: 'capability-absent',
      gate: 'canUseSingularity',
      bitNode: info.currentNode,
      detail:
        'canUseSingularity() is false for this save, so training.js cannot act. Staying at the 2.6GB floor ' +
        'instead of reserving its full price. Train by hand: City tab -> a university or gym -> pick a course. Rothman University (Sector-12) and Powerhouse Gym (Sector-12) are the usual choices.',
    })
    return
  }

  const want = RAISE_CEILING(singularityRamMultiplier(info))
  if (!(await raiseRam(ns, want, RAMOVERRIDE_STATUS, 'training.js needs its full allocation before the first gated call'))) return

  try {
    note('ok', { result: 'running', allocation: want, detail: 'allocation raised; running the original body' })
    await act(ns, note)
    note('ok', { result: 'finished', detail: 'training.js returned normally' })
  } catch (err) {
    ns.print(record(rerrors, err))
    note('error', { result: 'error', detail: describe(err) })
    throw err
  }
}



/** Work/Formulas.ts:38 — `gameCPS = 1000 / CONSTANTS.MilliPerCycle`, 5/s. */
const game_cycles_per_second = 5;
/** CONSTANTS.MilliPerCycle. Used to turn a per-cycle rate into a per-ms rate. */
const milli_per_cycle = 200;

let skill_options = {
  all: ["hacking", "strength", "defense", "dexterity", "agility", "charisma"],
  combat: ["strength", "defense", "dexterity", "agility"],
  uni: ["hacking", "charisma"],
  hackdef: ["hacking", "defense"],
  hacking: ["hacking"],
  strength: ["strength"],
  defense: ["defense"],
  dexterity: ["dexterity"],
  agility: ["agility"],
  charisma: ["charisma"],
};

/**
 * ns.getPlayer() returns thirteen fields and the skills are nested under
 * `.skills` (NetscriptFunctions.ts:1371-1390). `player.hacking_skill` and
 * `player.strength` are 2021-API names and read `undefined` today.
 */
const playerSkill = (player, skill) => player.skills[skill];

/**
 * The six university classes, keyed by the game's own enum members.
 *
 * Work/Enums.ts:7-14 for the names; Work/ClassWork.tsx:24-53 for the numbers,
 * which are per game cycle before the location multiplier:
 *   Computer Science  money   0   hackExp 0.5  intExp 0.01
 *   Data Structures   money -40   hackExp 1    intExp 0.01
 *   Networks          money -80   hackExp 2    intExp 0.01
 *   Algorithms        money -320  hackExp 4    intExp 0.01
 *   Management        money -160  chaExp  2    intExp 0.01
 *   Leadership        money -320  chaExp  4    intExp 0.01
 * The intelligence exp was previously omitted entirely.
 */
const uniClasses = (ns) => {
  const C = ns.enums.UniversityClassType
  return {
    [C.computerScience]: { base_cost: 0, base_hacking_exp: 0.5, base_intelligence_exp: 0.01 },
    [C.dataStructures]: { base_cost: 40, base_hacking_exp: 1, base_intelligence_exp: 0.01 },
    [C.networks]: { base_cost: 80, base_hacking_exp: 2, base_intelligence_exp: 0.01 },
    [C.algorithms]: { base_cost: 320, base_hacking_exp: 4, base_intelligence_exp: 0.01 },
    [C.management]: { base_cost: 160, base_charisma_exp: 2, base_intelligence_exp: 0.01 },
    [C.leadership]: { base_cost: 320, base_charisma_exp: 4, base_intelligence_exp: 0.01 },
  }
}

/**
 * The four gym classes, keyed by the game's own enum members — which are the
 * SHORT CODES "str"/"def"/"dex"/"agi" (Work/Enums.ts:17-22), not the skill
 * names this file used to pass.
 *
 * Work/ClassWork.tsx:54-73: every one of them is `money: -120` and 1 exp per
 * cycle. The file previously claimed 320 and 4, i.e. 2.67x the real cost for 4x
 * the real exp — which made every gym look strictly better than every
 * university course per dollar, and mis-stated the exp rate outright.
 *
 * `skill` is the ordinary skill name this script ranks by; `stat` is what the
 * API wants.
 */
const gymClasses = (ns) => {
  const G = ns.enums.GymType
  return {
    [G.strength]: { skill: "strength", base_cost: 120, base_strength_exp: 1 },
    [G.defense]: { skill: "defense", base_cost: 120, base_defense_exp: 1 },
    [G.dexterity]: { skill: "dexterity", base_cost: 120, base_dexterity_exp: 1 },
    [G.agility]: { skill: "agility", base_cost: 120, base_agility_exp: 1 },
  }
}

/**
 * Universities and gyms, keyed by the game's LocationName enum — which is what
 * singularity.universityCourse / gymWorkout compare against with an exact
 * `switch` (Singularity.ts:242-276, :302-360).
 *
 * cost_mult / exp_mult from Locations/data/LocationsMetadata.ts; all eight
 * values were already correct in this file and are kept.
 *
 * `host` is the location's own server, needed for the backdoor discount
 * (Work/Formulas.ts:100-105 looks the location up in serverMetadata by
 * specialName). Server/data/servers.ts: rothman-uni:951, zb-institute:979,
 * summit-uni:1006, crush-fitness:1347, iron-gym:1367, millenium-fitness:1382,
 * powerhouse-fitness:1406, snap-fitness:1431.
 */
const uniLocations = (ns) => {
  const L = ns.enums.LocationName
  const T = ns.enums.CityName
  return {
    [L.AevumSummitUniversity]: { city: T.Aevum, cost_mult: 4, exp_mult: 3, host: "summit-uni" },
    [L.Sector12RothmanUniversity]: { city: T.Sector12, cost_mult: 3, exp_mult: 2, host: "rothman-uni" },
    [L.VolhavenZBInstituteOfTechnology]: { city: T.Volhaven, cost_mult: 5, exp_mult: 4, host: "zb-institute" },
  }
}

const gymLocations = (ns) => {
  const L = ns.enums.LocationName
  const T = ns.enums.CityName
  return {
    [L.AevumCrushFitnessGym]: { city: T.Aevum, cost_mult: 3, exp_mult: 2, host: "crush-fitness" },
    [L.AevumSnapFitnessGym]: { city: T.Aevum, cost_mult: 10, exp_mult: 5, host: "snap-fitness" },
    [L.Sector12IronGym]: { city: T.Sector12, cost_mult: 1, exp_mult: 1, host: "iron-gym" },
    [L.Sector12PowerhouseGym]: { city: T.Sector12, cost_mult: 20, exp_mult: 10, host: "powerhouse-fitness" },
    [L.VolhavenMilleniumFitnessGym]: { city: T.Volhaven, cost_mult: 7, exp_mult: 4, host: "millenium-fitness" },
  }
}

// exp_types comes from constants.js: hacking/strength/defense/dexterity/
// agility/charisma/intelligence _exp. One source of truth; sleeve.js and
// crime.js name the same seven fields.

let EPSILON_SLEEP = 5000;

/**
 * Is this location's own server backdoored? 10% off tuition if so.
 *
 * Work/Formulas.ts:100-105:
 *   const serverMeta = serverMetadata.find(s => s.specialName === location.name)
 *   const server = GetServer(serverMeta ? serverMeta.hostname : "")
 *   const discount = (server as Server)?.backdoorInstalled ? 0.9 : 1
 *   return classInfo.earnings.money * location.costMult * discount
 *
 * A host we cannot see yet (not yet scanned into the network) makes getServer
 * throw, which must not take the whole ranking down — an unknown backdoor state
 * is reported as "not backdoored", the same thing GetServer("") resolves to in
 * the game. That is the one place a default is right here, and it is said out
 * loud rather than assumed.
 */
function backdoorDiscount(ns, host) {
  try {
    return ns.getServer(host).backdoorInstalled ? 0.9 : 1;
  } catch {
    return 1;
  }
}

function buildClassEntry(ns, classInfoEntry, locationInfoEntry, classType, hashMult, world) {
  let className = classInfoEntry[0];
  let locationName = locationInfoEntry[0];
  let classInfo = classInfoEntry[1];
  let locationInfo = locationInfoEntry[1];
  let returnClass = {};

  // Work/Formulas.ts:116 — scaleWorkStats(classInfo.earnings,
  // (location.expMult / gameCPS) * hashMult, false). Person multipliers are
  // applied on top (:117) and are not modelled: they are the same for every
  // location, so they cannot change the ranking, but they DO mean the absolute
  // numbers here are pre-augmentation.
  exp_types.forEach(expType => {
    let expBase = classInfo["base_" + expType] || 0;
    returnClass[expType] = (expBase * locationInfo.exp_mult * hashMult) / game_cycles_per_second;
    returnClass[expType + '_per_millisecond'] = returnClass[expType] / milli_per_cycle;
  });

  // Work/Formulas.ts:119 — earnings.money = calculateCost(...) / gameCPS, and
  // calculateCost (:100-105) is `earnings.money * costMult * discount`. The
  // hash multiplier is deliberately NOT here: :116 applies it to the exp only.
  let discount = world.discounts[locationInfo.host];
  returnClass.cost = (classInfo.base_cost * locationInfo.cost_mult * discount) / game_cycles_per_second;
  returnClass.cost_per_millisecond = returnClass.cost / milli_per_cycle;
  returnClass.backdoored = discount !== 1;
  returnClass.hash_mult = hashMult;
  returnClass.time = -1; // continuous
  returnClass.city = locationInfo.city;
  returnClass.class_name = className;
  returnClass.location_name = locationName;
  returnClass.travel_cost = returnClass.city != world.city ? travel_cost : 0;
  returnClass.class_type = classType;

  let combinedName = [locationName, className].join(" ");
  return [combinedName, returnClass];
}

function getTrainingClasses(ns, noTravel, city) {
  let trainingClasses = [];

  // Hacknet hash upgrades (Work/Formulas.ts:113). These are two DIFFERENT
  // multipliers — "Improve Studying" and "Improve Gym Training",
  // Hacknet/Enums.ts:6-7 — so buying one and not the other changes which side
  // of this comparison wins. HashManager.ts:34-42 is 1 + value*level/100.
  // ns.hacknet.getStudyMult / getTrainingMult (NetscriptFunctions/Hacknet.ts:
  // 212-223) already return 1 when there are no hacknet servers, so no
  // Source-File 9 gate is needed here; they cost 0.5GB each
  // (RamCostGenerator.ts:119-120, RamCostConstants.Hacknet = 0.5 at :38).
  const studyMult = ns.hacknet.getStudyMult();
  const trainingMult = ns.hacknet.getTrainingMult();

  const unis = Object.entries(uniLocations(ns));
  const gyms = Object.entries(gymLocations(ns));
  // One getPlayer and one getServer per LOCATION, not per location x class:
  // this runs every loop and there are 38 entries to build.
  const world = {
    city: ns.getPlayer().city,
    discounts: Object.fromEntries(unis.concat(gyms).map(([, info]) => [info.host, backdoorDiscount(ns, info.host)])),
  };

  Object.entries(uniClasses(ns)).forEach(uniClassEntry => {
    unis.forEach(uniLocationEntry => {
      trainingClasses.push(buildClassEntry(ns, uniClassEntry, uniLocationEntry, "uni", studyMult, world));
    })
  });
  Object.entries(gymClasses(ns)).forEach(gymClassEntry => {
    gyms.forEach(gymLocationEntry => {
      trainingClasses.push(buildClassEntry(ns, gymClassEntry, gymLocationEntry, "gym", trainingMult, world));
    })
  });

  if (noTravel) {
    trainingClasses = trainingClasses.filter(classEntry => classEntry[1].travel_cost == 0);
  }

  if (city) {
    trainingClasses = trainingClasses.filter(classEntry => classEntry[1].city == city);
  }

  let possibleClasses = Object.fromEntries(trainingClasses);
  //ns.tprint("possible classes" + JSON.stringify(possibleClasses, null, 2));
  return possibleClasses;
}

function getFastestClassForSkill(ns, skill, noTravel, city) {
  let candidates = Object.entries(getTrainingClasses(ns, noTravel, city))
    .filter(classEntry => classEntry[1][`${skill}_exp_per_millisecond`]);
  if (!candidates.length) {
    // Previously this reduced an empty array and threw a bare TypeError from
    // deep inside a lambda. Say which filter emptied it.
    throw new Error(
      `no class trains ${skill}` +
        (city ? ` in ${city}` : '') +
        (noTravel ? ' without travelling' : '') +
        '. Universities train hacking and charisma; gyms train the four combat skills.',
    );
  }
  return candidates.reduce((result, next) => result[1][`${skill}_exp_per_millisecond`] >
    next[1][`${skill}_exp_per_millisecond`] ? result : next);
}

/**
 * Start the class, and BELIEVE THE RETURN VALUE.
 *
 * universityCourse (Singularity.ts:235-292) and gymWorkout (:295-372) both
 * return a boolean and both have a `default:` arm that merely calls
 * helpers.log() and returns false — for a location name that is not an exact
 * match, or for being in the wrong city. The previous version discarded that,
 * so a typo'd location name produced a script that looped forever training
 * nothing and reporting nothing.
 */
function startClassFromClassEntry(ns, classEntry) {
  let classData = classEntry[1];
  let classType = classData.class_type;
  let player = ns.getPlayer();
  if (classData.city != player.city) {
    if (!ns.singularity.travelToCity(classData.city)) {
      throw new Error(`unable to get to ${classData.city}, currently in ${player.city} (travel costs $${travel_cost})`);
    }
  }
  // focus = false. Class work is the ONE kind of work with no focus penalty —
  // Player.focusPenalty() is referenced only from CrimeWork.ts:65,
  // FactionWork.tsx:39,44, CompanyWork.tsx:37, CreateProgramWork.ts:59 and
  // GraftingWork.tsx:41 — so studying unfocused earns the full rate, and the
  // default `focus = true` would only have dragged the UI to the Work page
  // (Singularity.ts:284-286, :365-367) against cmd.js and upkeep.js.
  let started;
  if (classType == "uni") {
    started = ns.singularity.universityCourse(classData.location_name, classData.class_name, false);
  } else if (classType == "gym") {
    started = ns.singularity.gymWorkout(classData.location_name, classData.class_name, false);
  } else {
    throw new Error("Internal error, class type not determined");
  }
  if (!started) {
    throw new Error(
      `${classType == "uni" ? "universityCourse" : "gymWorkout"}("${classData.location_name}", ` +
        `"${classData.class_name}") returned false. The game logs the reason to this script's log; the ` +
        `usual causes are being in the wrong city (we are in ${ns.getPlayer().city}, the location is in ` +
        `${classData.city}) or a location name that is not an exact LocationName enum member.`,
    );
  }
}

function usage(ns) {
  ns.tprint(`Usage: run training.js [--skill] &lt${Object.keys(skill_options)}&gt [--city &ltcity&gt] [--no-travel] [--target-level &ltlevel&gt] [--time &ltmilliseconds&gt]`);
}

async function act(ns, note) {
  let flag_data = ns.flags([
    ["skill", ""],
    ["callback", ""],
    ["no-travel", false],
    ["city", ""],
    ["target-level", 0],
    ["time", 0],
    ["help", false],
    ["switch-time", 30000],
    ["equal-time", false],
    ["tail", false],
  ]);

  let skillOption = flag_data.skill || flag_data._[0];
  let callback = flag_data.callback || flag_data._[1];
  let player = ns.getPlayer();
  let city = flag_data.city;
  let noTravel = flag_data["no-travel"];
  let time = flag_data.time;
  let switchTime = flag_data["switch-time"];
  let targetLevel = flag_data["target-level"];
  let equalTime = flag_data["equal-time"];

  const bail = (health, fields) => {
    note(health, fields);
    runCallbackExit(ns, callback);
  };

  if (!skillOption || flag_data.help) {
    usage(ns);
    bail('waiting', { result: 'usage', detail: 'no --skill given' });
  }

  if (!Object.keys(skill_options).includes(skillOption)) {
    ns.tprint(`Skill: ${skillOption} is not a valid skill name for this script. accepted values are ${Object.keys(skill_options)}`);
    bail('error', { result: 'bad-skill', skill: skillOption, detail: `unknown --skill ${skillOption}` });
  }

  if (city && !city_names.includes(city)) {
    ns.tprint(`City: ${city} is not a valid city. exiting...`);
    bail('error', { result: 'bad-city', city, detail: `unknown --city ${city}` });
  }

  if (targetLevel && targetLevel < 0) {
    ns.tprint(`target level (${targetLevel}) must be positive. exiting...`);
    bail('error', { result: 'bad-target-level', detail: `--target-level ${targetLevel}` });
  }

  if (time && time < 0) {
    ns.tprint(`time (${time}) must be a positive amount of milliseconds. exiting...`);
    bail('error', { result: 'bad-time', detail: `--time ${time}` });
  }

  if (switchTime <= 0) {
    ns.tprint(`switch time (${switchTime}) must be a positive amount of milliseconds. exiting...`);
    bail('error', { result: 'bad-switch-time', detail: `--switch-time ${switchTime}` });
  }

  if (flag_data.tail) {
    ns.ui.openTail();
  }

  let skills = skill_options[skillOption];
  let scriptStartTime = performance.now();
  let counter = 0;

  while (true) {
    player = ns.getPlayer();
    // playerSkill, not player[...] — ns.getPlayer() nests skills (see above).
    let pertinentPlayerSkillEntries = skills.map(skill => [skill, playerSkill(player, skill)]);
    // remove skills who have been sufficiently leveled
    if (targetLevel) {
      pertinentPlayerSkillEntries = pertinentPlayerSkillEntries.filter(skillEntry => skillEntry[1] < targetLevel);
      if (!pertinentPlayerSkillEntries.length) {
        ns.tprint(`Finished training ${skillOption}: [${skill_options[skillOption]}] to ${targetLevel}`);
        ns.singularity.stopAction();
        bail('ok', {
          result: 'target-reached',
          skillOption,
          targetLevel,
          levels: Object.fromEntries(skills.map(s => [s, playerSkill(player, s)])),
          detail: `every skill in ${skillOption} reached ${targetLevel}`,
        });
        break;
      }
    }

    let skill;
    if (equalTime) {
      // round robin
      skill = pertinentPlayerSkillEntries[counter % pertinentPlayerSkillEntries.length][0];
    } else {
      // select lowest
      skill = pertinentPlayerSkillEntries.reduce((result, next) => next[1] < result[1] ? next : result)[0];
    }
    ns.print(`skill to train; ${skill}`);
    let startTime = performance.now();
    let classEntry = getFastestClassForSkill(ns, skill, noTravel, city);
    startClassFromClassEntry(ns, classEntry);
    note('ok', {
      result: 'training',
      skill,
      level: playerSkill(player, skill),
      targetLevel: targetLevel || null,
      location: classEntry[1].location_name,
      class: classEntry[1].class_name,
      city: classEntry[1].city,
      exp_per_second: classEntry[1][`${skill}_exp_per_millisecond`] * 1000,
      cost_per_second: classEntry[1].cost_per_millisecond * 1000,
      backdoored: classEntry[1].backdoored,
      hash_mult: classEntry[1].hash_mult,
      detail: `training ${skill} at ${classEntry[1].location_name}`,
    });
    while (ns.singularity.isBusy()) {
      await ns.sleep(EPSILON_SLEEP);
      if (performance.now() - startTime > switchTime) {
        break;
      }
      if (time && performance.now() - scriptStartTime > time) {
        ns.singularity.stopAction();
        bail('ok', { result: 'time-limit', ms: time, detail: `--time ${time}ms elapsed` });
      }
    }
    counter++;
  }
}
