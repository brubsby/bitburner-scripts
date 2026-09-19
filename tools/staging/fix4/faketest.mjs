// Offline behaviour check for the fix4 scripts against a FAKE ns.
//
// These scripts must not be run against the live game (crime.js commits crimes,
// training.js spends money and player time), so the only honest way to exercise
// the repaired logic is a stub ns that answers exactly what the real API
// answers, shaped from ~/Repos/bitburner source.
//
// NOT CALIBRATED against the live game: nothing here reproduces a quantity the
// running save displays. It checks internal consistency and the specific
// defects that were fixed — that the enum members used are the game's, that the
// karma expectation matches CrimeWork.ts:70-85, that the gym numbers match
// ClassWork.tsx:54-73, and that the ranking changes when the hash multipliers
// diverge. It cannot tell you the absolute rates are right in this save.
//
//   node tools/staging/fix4/faketest.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

let failures = 0;
const ok = (cond, what, extra = "") => {
  console.log(`${cond ? "  ok  " : " FAIL "} ${what}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ---------------------------------------------------------------- the enums */
// Copied from src/Crime/Enums.ts:1-14, src/Work/Enums.ts:7-22,
// src/Locations/Enums.ts, src/Bladeburner/Enums.ts:1-6. If a script disagrees
// with these it disagrees with the game.
const enums = {
  CrimeType: {
    shoplift: "Shoplift", robStore: "Rob Store", mug: "Mug", larceny: "Larceny",
    dealDrugs: "Deal Drugs", bondForgery: "Bond Forgery", traffickArms: "Traffick Arms",
    homicide: "Homicide", grandTheftAuto: "Grand Theft Auto", kidnap: "Kidnap",
    assassination: "Assassination", heist: "Heist",
  },
  UniversityClassType: {
    computerScience: "Computer Science", dataStructures: "Data Structures",
    networks: "Networks", algorithms: "Algorithms", management: "Management",
    leadership: "Leadership",
  },
  GymType: { strength: "str", defense: "def", dexterity: "dex", agility: "agi" },
  CityName: {
    Aevum: "Aevum", Chongqing: "Chongqing", Sector12: "Sector-12",
    NewTokyo: "New Tokyo", Ishima: "Ishima", Volhaven: "Volhaven",
  },
  LocationName: {
    AevumCrushFitnessGym: "Crush Fitness Gym",
    AevumSnapFitnessGym: "Snap Fitness Gym",
    AevumSummitUniversity: "Summit University",
    Sector12IronGym: "Iron Gym",
    Sector12PowerhouseGym: "Powerhouse Gym",
    Sector12RothmanUniversity: "Rothman University",
    VolhavenMilleniumFitnessGym: "Millenium Fitness Gym",
    VolhavenZBInstituteOfTechnology: "ZB Institute of Technology",
  },
  BladeburnerActionType: {
    General: "General", Contract: "Contracts", Operation: "Operations",
    BlackOp: "Black Operations",
  },
};

/**
 * Load a fix4 script with extra `export` lines appended, so its internals can
 * be called without changing the file that ships.
 *
 * Everything happens in tools/staging/fix4/.sandbox — NOTHING is written to the
 * repo root, which hot-deploys into the live game within ~150ms, and the root
 * modules are COPIED in rather than imported in place. The bare specifiers the
 * game resolves against home ("common.js", "status.js", …) are rewritten to
 * "./common.js" so node can resolve them.
 */
const SANDBOX = path.join(HERE, ".sandbox");
/** The root modules these four scripts import, plus what those import. Copied,
 *  never edited — the originals are live deploy targets. */
const DEPS = ["common.js", "constants.js", "sfgate.js", "status.js", "ramgrow.js"];

function sandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  for (const d of DEPS) fs.copyFileSync(path.join(REPO, d), path.join(SANDBOX, d));
  // Netscript resolves bare "status.js" against home; node needs "./status.js".
  for (const d of DEPS) {
    const p = path.join(SANDBOX, d);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/from\s+(['"])([A-Za-z0-9_.-]+\.js)\1/g, "from $1./$2$1"));
  }
}

async function loadWithExports(file, names) {
  const code =
    fs.readFileSync(path.join(HERE, file), "utf8").replace(/from\s+(['"])([A-Za-z0-9_.-]+\.js)\1/g, "from $1./$2$1") +
    `\nexport { ${names.join(", ")} };\n`;
  const tmp = path.join(SANDBOX, file);
  fs.writeFileSync(tmp, code);
  return await import(`file://${tmp}?t=${Date.now()}`);
}

/* --------------------------------------------------------------- crime.js */
// Crime data lifted from src/Crime/Crimes.ts, enough to rank by karma.
// Constructor order (Crime.ts): workName, tooltipText, type, time, money,
// difficulty, karma, params.
const CRIME_DATA = {
  "Shoplift": { time: 2e3, money: 15e3, karma: 0.1, kills: 0, chance: 0.9, dexterity_exp: 2, agility_exp: 2 },
  "Homicide": { time: 3e3, money: 45e3, karma: 3, kills: 1, chance: 0.2, strength_exp: 2, defense_exp: 2, dexterity_exp: 2, agility_exp: 2 },
  "Mug": { time: 4e3, money: 36e3, karma: 0.25, kills: 0, chance: 0.6, strength_exp: 3, defense_exp: 3, dexterity_exp: 3, agility_exp: 3 },
};

function fakeNsCrime({ focused = true, ownNeuro = false } = {}) {
  return {
    enums,
    singularity: {
      isFocused: () => focused,
      getCrimeChance: (name) => {
        if (!Object.values(enums.CrimeType).includes(name)) {
          throw new Error(`Argument crimeType should be a CrimeType enum member. Provided value: "${name}".`);
        }
        return (CRIME_DATA[name] ?? { chance: 0.5 }).chance;
      },
      getCrimeStats: (name) => {
        if (!Object.values(enums.CrimeType).includes(name)) {
          throw new Error(`Argument crimeType should be a CrimeType enum member. Provided value: "${name}".`);
        }
        const d = CRIME_DATA[name] ?? { time: 1e3, money: 0, karma: 0, kills: 0 };
        return {
          money: d.money, karma: d.karma, kills: d.kills, time: d.time,
          hacking_exp: d.hacking_exp ?? 0, strength_exp: d.strength_exp ?? 0,
          defense_exp: d.defense_exp ?? 0, dexterity_exp: d.dexterity_exp ?? 0,
          agility_exp: d.agility_exp ?? 0, charisma_exp: d.charisma_exp ?? 0,
          intelligence_exp: d.intelligence_exp ?? 0,
        };
      },
    },
    getPlayer: () => ({ skills: { hacking: 10, strength: 5, defense: 6, dexterity: 7, agility: 8, charisma: 9, intelligence: 0 }, money: 0, city: "Sector-12" }),
    print: () => {},
  };
}

async function testCrime() {
  console.log("\ncrime.js");
  const m = await loadWithExports("crime.js", ["crimeNames", "getExpectedCrimeReturns", "statValue", "focusPenalty", "SKILL_FIELDS"]);
  const ns = fakeNsCrime();

  const names = m.crimeNames(ns);
  ok(names.length === 12, "twelve crimes come straight out of ns.enums.CrimeType");
  ok(names.includes("Assassination"), '"Assassination" is present (never "assassinate")');
  ok(!names.includes("shoplift"), "no lower-case member survives");

  // The strict enum check would throw on any literal that is not a member —
  // the exact failure the deployed file hits on its first getCrimeChance call.
  let threw = false;
  try { ns.singularity.getCrimeChance("shoplift"); } catch { threw = true; }
  ok(threw, "the stub reproduces nsGetMember's strictness (EnumHelper.ts:63-70)");

  const r = m.getExpectedCrimeReturns(ns, 1);
  const h = r["Homicide"], c = 0.2;
  ok(near(h.karma, 3 * ((3 * c + 1) / 4)), "E[karma] = karma*(3c+1)/4 (CrimeWork.ts:75-78)", `${h.karma} vs ${3 * ((3 * c + 1) / 4)}`);
  ok(!near(h.karma, 3 * c), "and is NOT karma*chance, which is what shipped", `${3 * c}`);
  ok(near(h.money, 45e3 * c), "E[money] = money*chance (success-only, CrimeWork.ts:72)");
  ok(near(h.kills, 1 * c), "E[kills] = kills*chance (CrimeWork.ts:73)");
  ok(near(h.strength_exp, 2 * ((3 * c + 1) / 4)), "E[exp] uses the same (3c+1)/4 factor (CrimeWork.ts:76)");

  // Focus penalty scales exp and karma but not money (WorkStats.ts:49-50).
  const r8 = m.getExpectedCrimeReturns(ns, 0.8);
  ok(near(r8["Homicide"].karma, h.karma * 0.8), "focus penalty scales karma");
  ok(near(r8["Homicide"].money, h.money), "focus penalty does NOT scale money (CrimeWork.ts:68 scaleMoney=false)");

  // The getPlayer() shape fix.
  const p = ns.getPlayer();
  ok(m.statValue(p, "strength") === 5, "statValue reads player.skills.strength");
  ok(m.statValue(p, "hacking") === 10, "statValue reads player.skills.hacking");
  ok(p.strength === undefined, "…because the flat player.strength really is undefined");

  ok(m.focusPenalty(fakeNsCrime({ focused: false }), { ownedAugs: new Set() }) === 0.8, "unfocused without the implant is 0.8 (Constants.ts:87)");
  ok(m.focusPenalty(fakeNsCrime({ focused: false }), { ownedAugs: new Set(["Neuroreceptor Management Implant"]) }) === 1, "the Neuroreceptor implant makes it 1 (PlayerObjectGeneralMethods.ts:622-628)");
}

/* -------------------------------------------------------------- training.js */
function fakeNsTraining({ study = 1, training = 1, backdoored = [] , city = "Sector-12" } = {}) {
  return {
    enums,
    hacknet: { getStudyMult: () => study, getTrainingMult: () => training },
    getServer: (host) => ({ backdoorInstalled: backdoored.includes(host) }),
    getPlayer: () => ({ skills: { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 0 }, city, money: 1e9 }),
    print: () => {}, tprint: () => {},
  };
}

async function testTraining() {
  console.log("\ntraining.js");
  const m = await loadWithExports("training.js", ["getTrainingClasses", "getFastestClassForSkill", "uniClasses", "gymClasses", "playerSkill"]);
  const ns = fakeNsTraining();

  const gym = m.gymClasses(ns);
  ok(Object.keys(gym).join(",") === "str,def,dex,agi", "gym classes are keyed by the GymType short codes (Work/Enums.ts:17-22)", Object.keys(gym).join(","));
  ok(Object.values(gym).every(g => g.base_cost === 120), "every gym class costs 120/cycle (ClassWork.tsx:54-73)");
  ok(gym["str"].base_strength_exp === 1, "every gym class gives 1 exp/cycle, not 4");

  const uni = m.uniClasses(ns);
  ok(Object.keys(uni).includes("Computer Science"), '"Computer Science", not "Study Computer Science"');
  ok(Object.keys(uni).includes("Data Structures"), '"Data Structures", not "Data Strucures"');

  const classes = m.getTrainingClasses(ns, false, "");
  ok(Object.keys(classes).length === 6 * 3 + 4 * 5, "6 uni classes x 3 unis + 4 gym classes x 5 gyms = 38 entries", String(Object.keys(classes).length));
  ok(Object.keys(classes).some(k => k.startsWith("ZB Institute of Technology")), "ZB is spelled with a lowercase 'of' (Locations/Enums.ts:59)");

  // Powerhouse: exp_mult 10, base 1/cycle -> 10/5 = 2 exp/s -> 0.002/ms.
  const ph = classes["Powerhouse Gym str"];
  ok(near(ph.strength_exp_per_millisecond, (1 * 10) / 5 / 200), "Powerhouse str = base 1 * expMult 10 / 5 cycles/s / 200ms", String(ph.strength_exp_per_millisecond));
  ok(near(ph.cost, (120 * 20) / 5), "Powerhouse cost = 120 * costMult 20 / 5 = 480/cycle", String(ph.cost));

  // The backdoor discount (Work/Formulas.ts:100-105).
  const bd = m.getTrainingClasses(fakeNsTraining({ backdoored: ["powerhouse-fitness"] }), false, "");
  ok(near(bd["Powerhouse Gym str"].cost, (120 * 20 * 0.9) / 5), "backdooring powerhouse-fitness takes 10% off tuition", String(bd["Powerhouse Gym str"].cost));
  ok(near(bd["Powerhouse Gym str"].strength_exp_per_millisecond, ph.strength_exp_per_millisecond), "…and does NOT change exp (Formulas.ts:116 vs :119)");

  // The hash multipliers, applied to exp only and DIFFERENTLY per side.
  const hm = m.getTrainingClasses(fakeNsTraining({ study: 3, training: 1 }), false, "");
  ok(near(hm["Rothman University Algorithms"].hacking_exp_per_millisecond, classes["Rothman University Algorithms"].hacking_exp_per_millisecond * 3), "getStudyMult multiplies university exp");
  ok(near(hm["Powerhouse Gym str"].strength_exp_per_millisecond, classes["Powerhouse Gym str"].strength_exp_per_millisecond), "…and leaves gym exp alone");
  ok(near(hm["Rothman University Algorithms"].cost, classes["Rothman University Algorithms"].cost), "…and leaves cost alone (Formulas.ts:119)");

  // The ranking itself.
  ok(m.getFastestClassForSkill(ns, "hacking", false, "")[0] === "ZB Institute of Technology Algorithms", "best hacking class is ZB Algorithms (expMult 4 x base 4)", m.getFastestClassForSkill(ns, "hacking", false, "")[0]);
  ok(m.getFastestClassForSkill(ns, "strength", false, "")[0] === "Powerhouse Gym str", "best strength class is Powerhouse (expMult 10)");
  ok(m.getFastestClassForSkill(fakeNsTraining({}), "hacking", true, "")[0] === "Rothman University Algorithms", "--no-travel from Sector-12 falls back to Rothman");

  let threw = false;
  try { m.getFastestClassForSkill(ns, "hacking", false, "Chongqing"); } catch { threw = true; }
  ok(threw, "an empty candidate list throws with a message naming the filter, instead of a bare reduce TypeError");

  ok(m.playerSkill(ns.getPlayer(), "hacking") === 1, "playerSkill reads player.skills.hacking");
}

/* ---------------------------------------------------------------- sleeve.js */
async function testSleeve() {
  console.log("\nsleeve.js");
  const m = await loadWithExports("sleeve.js", ["skillCrimeMap", "skillCourseMap", "cityGymMap", "cityUniMap", "isAlreadyCommitting", "lowestPlayerCombatSkill", "lowestPlayerUniSkill"]);
  const ns = { enums };

  const crimes = m.skillCrimeMap(ns);
  ok(crimes.hacking === "Rob Store", '"Rob Store", not "RobStore" (Crime/Enums.ts:3)');
  ok(crimes.charisma === "Deal Drugs", '"Deal Drugs", not "DealDrugs" (Crime/Enums.ts:6)');
  ok(Object.values(m.cityUniMap(ns)).includes("ZB Institute of Technology"), "ZB spelled the game's way here too");

  // The precedence bug: `!x == y` parses as `(!x) == y`, which is false for
  // every non-empty string, so the guard fired on every tick.
  ok(m.isAlreadyCommitting(null, "Mug") === false, "a null task is not already committing (getTask returns null when idle, Sleeve.ts:323)");
  ok(m.isAlreadyCommitting({ type: "CRIME", crimeType: "Mug" }, "Mug") === true, "matching crimeType is already committing");
  ok(m.isAlreadyCommitting({ type: "CRIME", crimeType: "Homicide" }, "Mug") === false, "a different crime is not");
  ok(m.isAlreadyCommitting({ type: "CLASS", classType: "str" }, "Mug") === false, "a non-crime task is not");
  // The shipped expression, for contrast.
  const shipped = (task, want) => !task.crime == want;
  ok(shipped({ crime: "Mug" }, "Mug") === false && shipped({ crime: "Homicide" }, "Mug") === false,
    "the shipped `!task.crime == want` is false for BOTH match and mismatch — it could never guard anything");

  const p = { skills: { hacking: 10, strength: 1, defense: 2, dexterity: 3, agility: 4, charisma: 5 } };
  ok(m.lowestPlayerCombatSkill(p) === "strength", "lowest combat skill reads player.skills.*");
  ok(m.lowestPlayerUniSkill(p) === "charisma", "lowest uni skill reads player.skills.hacking, not hacking_skill");
}

/* ----------------------------------------------------------- bladeburner.js */
function fakeNsBlade({ skillLevels = {}, bonusMs = 0, timeMs = 30000 } = {}) {
  return {
    enums,
    bladeburner: {
      getSkillLevel: (n) => skillLevels[n] ?? 0,
      getBonusTime: () => bonusMs,
      getActionTime: () => timeMs,
      getStamina: () => [50, 100],
    },
    getPlayer: () => ({
      skills: { hacking: 100, strength: 200, defense: 200, dexterity: 200, agility: 300, charisma: 50, intelligence: 10 },
      mults: { bladeburner_stamina_gain: 1.2, bladeburner_analysis: 1.5 },
    }),
  };
}

async function testBladeburner() {
  console.log("\nbladeburner.js");
  const m = await loadWithExports("bladeburner.js", ["actionTypes", "actionConstants", "getSkillMultipliers", "getStaminaGainPerSecond", "actionTimeWithBonus", "sameAction"]);
  const ns = fakeNsBlade();

  const T = m.actionTypes(ns);
  ok(T.general === "General" && T.contract === "Contracts" && T.operation === "Operations" && T.blackOp === "Black Operations",
    "action types are the game's enum members (Bladeburner/Enums.ts:1-6)", JSON.stringify(T));

  const sr = m.actionConstants["Stealth Retirement Operation"];
  ok(sr.baseDifficulty === 1000 && sr.difficultyFac === 1.05 && sr.rewardFac === 1.11 && sr.hpLoss === 10,
    "Stealth Retirement is 1000 / 1.05 / 1.11 / hpLoss 10 (Operations.ts:161-166)", JSON.stringify(sr));
  const asn = m.actionConstants["Assassination"];
  ok(asn.baseDifficulty === 1500 && asn.rewardFac === 1.14, "Assassination keeps 1500 / 1.14 — the values the duplicate key stole");

  // getActionTime returns MILLISECONDS (Bladeburner.ts:125-130), and so does
  // getBonusTime (:365-368). No x1000 anywhere.
  ok(m.actionTimeWithBonus(ns, {}) === 30000, "no bonus time -> the action's own ms", String(m.actionTimeWithBonus(ns, {})));
  ok(m.actionTimeWithBonus(fakeNsBlade({ bonusMs: 60000 }), {}) === Math.ceil(30000 / 5), "banked bonus time -> 1/5 of it, still ms");

  // Skill multipliers (Bladeburner.ts:775-785, data/Skills.ts).
  const sm = m.getSkillMultipliers(fakeNsBlade({ skillLevels: { "Reaper": 10, "Evasive System": 5, "Cyber's Edge": 20 } }));
  ok(near(sm.effective_agility, 1.2 * 1.2), "EffAgi = (1+2*Reaper/100)(1+4*EvasiveSystem/100) = 1.2*1.2", String(sm.effective_agility));
  ok(near(sm.stamina, 1.4), "Stamina = 1 + 2*CybersEdge/100 = 1.4", String(sm.stamina));
  const base = m.getSkillMultipliers(ns);
  ok(base.effective_agility === 1 && base.stamina === 1, "with no skills the multipliers are 1 — the stub's answer, now derived rather than hardcoded");

  // Stamina gain (Bladeburner.ts:1318-1326, data/Constants.ts:4,6).
  const g = m.getStaminaGainPerSecond(ns);
  const effAgi = 300;
  const expected = (0.0085 + 100 / 70000) * Math.pow(effAgi, 0.17) * 1 * 1.2;
  ok(near(g, expected, 1e-12), "stamina/s matches calculateStaminaGainPerSecond", `${g} vs ${expected}`);
  ok(Number.isFinite(g), "…and is FINITE: player.mults.bladeburner_stamina_gain, not the v1 flat name that made it NaN");

  ok(m.sameAction(null, { type: "Contracts", name: "Tracking" }) === false, "getCurrentAction() null is handled (Bladeburner.ts:120-124)");
  ok(m.sameAction({ type: "Contracts", name: "Tracking" }, { type: "Contracts", name: "Tracking" }) === true, "identical action compares equal");
  ok(m.sameAction({ type: "Contracts", name: "Tracking" }, { type: "Contracts", name: "Retirement" }) === false, "different name does not");
}

sandbox();
await testCrime();
await testTraining();
await testSleeve();
await testBladeburner();

fs.rmSync(SANDBOX, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
