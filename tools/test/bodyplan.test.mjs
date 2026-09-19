// [BP] combat stats and karma as forecasts — bodyplan.js and its joinplan wiring.
//
// The failure this exists to prevent: 28 of the 47 null join blockers measured
// live on 2026-09-19 were a combat stat and 8 more were karma or kills, so 11
// of 34 factions were unpriceable — Slum Snakes among them, at strength 30.
// What is pinned here is fidelity to game source (the crime table, the
// success formula, the gym rate) and the SHAPE of the trajectory: crime exp is
// credited to the gym, one crime leg per invitation, refusals stay refusals.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const bp = await import("../../bodyplan.js");
const { CRIMES, GYMS, crimeChance, crimeRates, simulateCrime, crimeLeg, gymRate, hoursToStat, gymLegs, bestGym, COMBAT } = bp;
const { joinWait, timeToMeet } = await import("../../joinplan.js");
const { moneyLn } = await import("../../objective.js");
const { bestCrimeFor } = bp;
const { skillFromExp, expForSkill } = await import("../../installgate.js");

/** A fresh-life person: every skill 1, exp 0, multipliers 1. */
function fresh(over = {}) {
  const skills = { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 0 };
  const exp = { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 };
  const mults = {};
  for (const s of Object.keys(exp)) {
    mults[s] = 1;
    mults[`${s}_exp`] = 1;
  }
  mults.crime_success = 1;
  mults.crime_money = 1;
  return { skills, exp, mults, karma: 0, numPeopleKilled: 0, city: "Sector-12", money: 1e9, ...over };
}
const NODE1 = { CrimeSuccessRate: 1, CrimeMoney: 1, CrimeExpGain: 1 };

/** Parse Crime/Crimes.ts into the same shape as CRIMES — the source is the authority. */
function crimesFromSource() {
  const src = fs.readFileSync(path.join(GAME, "src/Crime/Crimes.ts"), "utf8");
  const enums = fs.readFileSync(path.join(GAME, "src/Crime/Enums.ts"), "utf8");
  const names = Object.fromEntries([...enums.matchAll(/^\s*(\w+) = "([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  const out = {};
  const blocks = src.split(/\[CrimeType\./).slice(1);
  for (const b of blocks) {
    const key = b.match(/^(\w+)\]/)[1];
    const body = b.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, "");
    const nums = [...body.matchAll(/^\s*([\d.e]+(?:\s*\/\s*[\d.]+)?),\s*$/gm)].map((m) => eval(m[1]));
    // After the strings and the enum reference, the positional args are time, money, difficulty, karma.
    const [time, money, difficulty, karma] = nums;
    const field = (re) => {
      const m = body.match(re);
      return m ? Number(m[1]) : 0;
    };
    const exp = {};
    const weight = {};
    for (const s of ["hacking", "strength", "defense", "dexterity", "agility", "charisma"]) {
      const e = field(new RegExp(`${s}_exp:\\s*([\\d.]+)`));
      const w = field(new RegExp(`${s}_success_weight:\\s*([\\d.]+)`));
      if (e) exp[s] = e;
      if (w) weight[s] = w;
    }
    out[names[key]] = { time, money, difficulty, karma, kills: field(/kills:\s*(\d+)/), exp, weight };
  }
  return out;
}

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("BP1", "the crime table matches Crime/Crimes.ts number for number");
  {
    const src = crimesFromSource();
    const names = Object.keys(src);
    if (names.length !== 12) c1.fail(`parsed ${names.length} crimes from source, expected 12`);
    for (const n of names) {
      c1.examined(1);
      const a = CRIMES[n];
      const b = src[n];
      if (!a) {
        c1.fail(`${n} is in the game and not in CRIMES`);
        continue;
      }
      for (const k of ["time", "money", "difficulty", "karma", "kills"]) {
        if (Math.abs(a[k] - b[k]) > 1e-12) c1.fail(`${n}.${k}: CRIMES ${a[k]} vs source ${b[k]}`);
      }
      for (const [k, v] of Object.entries(b.exp)) if (a.exp[k] !== v) c1.fail(`${n}.exp.${k}: ${a.exp[k]} vs ${v}`);
      for (const [k, v] of Object.entries(b.weight)) if (a.weight[k] !== v) c1.fail(`${n}.weight.${k}: ${a.weight[k]} vs ${v}`);
      for (const k of Object.keys(a.exp)) if (!(k in b.exp)) c1.fail(`${n}.exp.${k} is not in source`);
      for (const k of Object.keys(a.weight)) if (!(k in b.weight)) c1.fail(`${n}.weight.${k} is not in source`);
    }
    for (const n of Object.keys(CRIMES)) if (!src[n]) c1.fail(`${n} is in CRIMES and not in the game`);
    c1.note(`${names.length} crimes compared on time/money/difficulty/karma/kills/exp/weights`);
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("BP2", "success chance and expected rates follow Crime.ts and CrimeWork.ts");
  {
    // Hand-computed from Crime.ts:successRate for Mug at these stats.
    const p = fresh({ skills: { hacking: 10, strength: 100, defense: 50, dexterity: 100, agility: 50, charisma: 1, intelligence: 20 } });
    c2.examined(1);
    const want = ((1.5 * 100 + 0.5 * 50 + 1.5 * 100 + 0.5 * 50 + 0.025 * 20) / 975 / (1 / 5)) * (1 + Math.pow(20, 0.8) / 600);
    const got = crimeChance("Mug", p, NODE1);
    if (Math.abs(got - Math.min(want, 1)) > 1e-12) c2.fail(`Mug chance ${got} vs hand ${Math.min(want, 1)}`);

    // Rates: exp and karma at (3c+1)/4, money and kills at c, per second.
    c2.examined(1);
    const r = crimeRates("Homicide", p, NODE1, 1);
    const c = crimeChance("Homicide", p, NODE1);
    const perSec = 1000 / 3e3;
    if (Math.abs(r.karma - 3 * ((3 * c + 1) / 4) * perSec) > 1e-12) c2.fail("karma must be quartered on failure");
    if (Math.abs(r.kills - 1 * c * perSec) > 1e-12) c2.fail("kills are success-only");
    if (Math.abs(r.money - 45e3 * c * perSec) > 1e-9) c2.fail("money is success-only");
    if (Math.abs(r.exp.strength - 2 * ((3 * c + 1) / 4) * perSec) > 1e-12) c2.fail("exp must be quartered on failure");

    // Multipliers and node terms land where the game puts them.
    c2.examined(1);
    const p2 = fresh({ ...p, mults: { ...p.mults, strength_exp: 2, crime_money: 3, crime_success: 0.5 } });
    const n2 = { CrimeSuccessRate: 0.5, CrimeMoney: 2, CrimeExpGain: 4 };
    const c2v = crimeChance("Homicide", p2, n2);
    if (Math.abs(c2v - c * 0.25) > 1e-12) c2.fail("crime_success and CrimeSuccessRate multiply the chance");
    const r2 = crimeRates("Homicide", p2, n2, 0.8);
    if (Math.abs(r2.exp.strength - 2 * 2 * 4 * 0.8 * ((3 * c2v + 1) / 4) * perSec) > 1e-12) c2.fail("exp: stat_exp x CrimeExpGain x focus");
    if (Math.abs(r2.money - 45e3 * 3 * 2 * c2v * perSec) > 1e-9) c2.fail("money: crime_money x CrimeMoney, NOT focus-scaled");
    if (Math.abs(r2.karma - 3 * 0.8 * ((3 * c2v + 1) / 4) * perSec) > 1e-12) c2.fail("karma is focus-scaled");

    // Refusals.
    c2.examined(1);
    if (crimeChance("Mug", { ...p, mults: { ...p.mults, crime_success: undefined } }, NODE1) !== null) c2.fail("missing crime_success must refuse");
    if (crimeChance("Mug", p, { CrimeMoney: 1, CrimeExpGain: 1 }) !== null) c2.fail("missing CrimeSuccessRate must refuse");
    if (crimeChance("Not A Crime", p, NODE1) !== null) c2.fail("unknown crime must refuse");
    c2.note("Mug chance, Homicide rate split, multiplier placement and three refusals checked by hand");
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("BP3", "the gym rate is expMult x trainingMult x stat_exp per second, inverted through skill.ts");
  {
    c3.examined(1);
    const p = fresh({ mults: { ...fresh().mults, strength_exp: 1.5 } });
    const power = GYMS.find((g) => g.name === "Powerhouse Gym");
    if (!power || power.expMult !== 10 || power.city !== "Sector-12") c3.fail("Powerhouse Gym must be the x10 Sector-12 gym (LocationsMetadata.ts:323-327)");
    if (gymRate(power, "strength", p, 1) !== 15) c3.fail(`Powerhouse strength rate must be 10 x 1.5 = 15/s, got ${gymRate(power, "strength", p, 1)}`);
    if (gymRate(power, "strength", p, 1.2) !== 18) c3.fail("the hash training multiplier scales the rate");
    if (gymRate(power, "strength", p, undefined) !== null) c3.fail("an unread training multiplier must refuse, not assume 1");

    // Round trip: T hours at the rate really reaches the level, and not a second early.
    c3.examined(1);
    const h = hoursToStat("strength", 30, p, 15);
    const reach = skillFromExp(15 * h * 3600, 1);
    if (reach < 30) c3.fail(`hoursToStat(30) reaches only ${reach}`);
    if (skillFromExp(15 * (h * 3600 - 1), 1) >= 30) c3.fail("a second earlier must not have reached it");
    c3.note(`strength 30 from zero at 15 exp/s: ${(h * 60).toFixed(2)} minutes`);

    c3.examined(1);
    if (hoursToStat("strength", 30, { ...p, exp: { ...p.exp, strength: expForSkill(40, 1) } }, 15) !== 0) c3.fail("already there costs 0");
    if (hoursToStat("strength", 30, p, 0) !== Infinity) c3.fail("no rate is Infinity, not null");
    if (hoursToStat("strength", 30, p, null) !== null) c3.fail("unreadable rate is null");

    // Gym choice: Powerhouse from anywhere with the fare; the local best without it; null with neither.
    c3.examined(1);
    if (bestGym({ city: "Volhaven", money: 1e6 })?.name !== "Powerhouse Gym") c3.fail("with $200k the answer is Powerhouse");
    if (bestGym({ city: "Volhaven", money: 0 })?.name !== "Millenium Fitness Gym") c3.fail("broke in Volhaven trains at Millenium");
    if (bestGym({ city: "Chongqing", money: 0 }) !== null) c3.fail("broke in a city with no gym must refuse");

    // Four stats train one at a time: the legs sum.
    c3.examined(1);
    const legs = gymLegs({ strength: 30, defense: 30, dexterity: 30, agility: 30 }, fresh(), 1);
    if (!legs || legs.legs.length !== 4) c3.fail("four short stats must give four legs");
    const each = hoursToStat("strength", 30, fresh(), 10);
    if (Math.abs(legs.hours - 4 * each) > 1e-9) c3.fail("legs must sum, not overlap — a class trains one stat");
    c3.note(`Slum Snakes' combat 30 x4 from a fresh life at Powerhouse: ${(legs.hours * 60).toFixed(1)} minutes`);
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("BP4", "a crime leg is a trajectory: chance rises as the crime trains, and the leg is bounded");
  {
    c4.examined(1);
    const p = fresh();
    const r = simulateCrime("Homicide", p, NODE1, { until: (q) => q.karma <= -200 });
    if (!r || !(r.hours > 0) || !isFinite(r.hours)) c4.fail(`homicide to karma -200 from fresh must be finite, got ${r?.hours}`);
    if (!(r.person.skills.strength > 1)) c4.fail("the leg must have trained strength on the way");
    if (!(r.person.karma <= -200)) c4.fail("the leg must end past the target");
    const c0 = crimeChance("Homicide", p, NODE1);
    const c1v = crimeChance("Homicide", r.person, NODE1);
    if (!(c1v > c0)) c4.fail(`chance must rise along the leg: ${c0} -> ${c1v}`);
    // A frozen-chance division would OVERSTATE the leg; the trajectory must beat it.
    const frozen = 200 / (crimeRates("Homicide", p, NODE1, 1).karma * 3600);
    if (!(r.hours < frozen)) c4.fail(`trajectory ${r.hours}h must beat the frozen-rate ${frozen}h`);
    c4.note(`karma -200 by homicide from fresh: ${(r.hours * 60).toFixed(1)} min (frozen-rate would say ${(frozen * 60).toFixed(1)}), chance ${c0.toFixed(3)} -> ${c1v.toFixed(3)}`);

    c4.examined(1);
    const leg = crimeLeg({ karma: -9 }, p, NODE1);
    if (!leg || !CRIMES[leg.crime]) c4.fail("crimeLeg must pick a real crime");
    const worse = Object.keys(CRIMES).map((n) => simulateCrime(n, p, NODE1, { until: (q) => q.karma <= -9 }).hours);
    if (leg.hours !== Math.min(...worse)) c4.fail("crimeLeg must be the fastest crime, not the first");

    c4.examined(1);
    const kills = crimeLeg({ kills: 5 }, p, NODE1);
    if (!kills || !(CRIMES[kills.crime].kills > 0)) c4.fail("a kill count can only be met by a crime that kills");
    const both = crimeLeg({ karma: -45, kills: 30 }, p, NODE1);
    if (!both || !(both.person.karma <= -45) || !(both.person.numPeopleKilled >= 30)) c4.fail("one leg must satisfy both karma and kills");

    c4.examined(1);
    if (crimeLeg({}, p, NODE1) !== null) c4.fail("nothing asked must be null, not a zero leg");
    if (crimeLeg({ karma: -9 }, { ...p, exp: undefined }, NODE1) !== null) c4.fail("unreadable exp must refuse");
    const capped = simulateCrime("Heist", fresh({ mults: { ...fresh().mults, crime_success: 1e-9 } }), NODE1, { until: (q) => q.karma <= -1e9, maxHours: 1 });
    if (capped.hours !== Infinity) c4.fail("past maxHours the leg is Infinity, a real 'never', not null");
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("BP5", "joinplan: the combat factions price, with crime exp credited to the gym, and refuse without a body");
  {
    const state = { hacking: 4000, hackingExp: 1e9, hackingMult: 9, expPerSec: 1e5, money: 1e12, incomePerSec: 1e8,
      skills: fresh().skills, body: fresh(), node: NODE1, trainingMult: 1, focus: 1, companyCtx: { jobs: { ECorp: "Junior" } } };
    const combat = (n) => ({ type: "skills", skills: { strength: n, defense: n, dexterity: n, agility: n } });

    // Slum Snakes: combat 30, money $1m, karma -9.
    c5.examined(1);
    const snakes = joinWait([combat(30), { type: "money", money: 1e6 }, { type: "karma", karma: -9 }], state);
    if (!snakes.known || !(snakes.hours > 0) || !isFinite(snakes.hours)) c5.fail(`Slum Snakes must price finite: ${JSON.stringify(snakes)}`);
    const crime = snakes.blockers.find((b) => b.crime)?.crime;
    const gym = snakes.blockers.find((b) => b.gym)?.gym;
    if (!crime || !gym) c5.fail("the blockers must carry the crime and gym legs for the actor");
    if (snakes.activeHours !== snakes.hours) c5.fail("crime and gym are ACTIVE — they displace faction work");
    if (Math.abs(snakes.activeHours - (crime.hours + gym.hours)) > 1e-9) c5.fail("active hours are the crime leg plus the gym legs, in sequence");
    c5.note(`Slum Snakes from a fresh life: ${(snakes.hours * 60).toFixed(1)} min = ${crime.type} ${(crime.hours * 60).toFixed(1)} + gym ${(gym.hours * 60).toFixed(1)}`);

    // The credit: with the karma leg, the gym is SHORTER than from today's exp.
    c5.examined(1);
    const gymAlone = joinWait([combat(30)], state).blockers[0].gym;
    if (!(gym.hours < gymAlone.hours)) c5.fail(`crime exp must shorten the gym: with ${gym.hours} vs without ${gymAlone.hours}`);
    if (gym.legs.length >= 4 && gymAlone.legs.length === 4 && gym.legs.length === 4) {
      /* fine — both short on all four, hours differ */
    }

    // One leg for karma AND kills (Speakers-shaped), charged once.
    c5.examined(1);
    const speakers = joinWait(
      [
        { type: "not", condition: { type: "employedBy", company: "Central Intelligence Agency" } },
        { type: "skills", skills: { hacking: 100 } },
        combat(300),
        { type: "numPeopleKilled", numPeopleKilled: 30 },
        { type: "karma", karma: -45 },
      ],
      { ...state, windowH: 1000, lifeAgeH: 0 },
    );
    if (!speakers.known) c5.fail(`Speakers must price: ${JSON.stringify(speakers.blockers)}`);
    const legs = speakers.blockers.filter((b) => b.crime);
    if (legs.length !== 2) c5.fail("both karma and kills report the crime leg");
    if (legs[0].crime.type !== legs[1].crime.type) c5.fail("the same single leg must serve both");
    const charged = legs.filter((b) => b.hours > 0);
    if (charged.length !== 1) c5.fail(`the leg must be charged exactly once, got ${charged.length}`);
    if (!speakers.blockers.find((b) => b.type === "not" && b.hours === 0)) c5.fail("'not employed by CIA' with no CIA job is satisfied now, not unknown");

    // The install window: kills reset, so a kill leg longer than the life is Infinity; a gym that
    // does not fit one window is Infinity; both stay KNOWN (a real answer), never null.
    c5.examined(1);
    const shortLife = joinWait([combat(1200)], { ...state, windowH: 0.5, lifeAgeH: 0.2 });
    if (!shortLife.known) c5.fail("an unreachable-this-life gym must still be known");
    if (shortLife.hours !== Infinity) c5.fail(`combat 1200 in a 0.5h window must be Infinity, got ${shortLife.hours}`);
    if (!shortLife.blockers[0].gym?.why) c5.fail("the blocker must say WHY it is unreachable");
    const fits = joinWait([combat(30)], { ...state, windowH: 0.5, lifeAgeH: 0.2 });
    if (!(fits.hours > 0 && isFinite(fits.hours))) c5.fail("combat 30 fits a 0.3h remainder and must price");

    // Refusals: no body, no node, no training multiplier.
    c5.examined(1);
    if (joinWait([combat(30)], { ...state, body: undefined }).known) c5.fail("no body: combat must refuse");
    if (joinWait([{ type: "karma", karma: -9 }], { ...state, node: null }).known) c5.fail("no node terms: karma must refuse");
    if (joinWait([combat(30)], { ...state, trainingMult: undefined }).known) c5.fail("no training multiplier: gym must refuse");
    if (timeToMeet({ type: "karma", karma: -9 }, { ...state, body: { ...fresh(), karma: -20 } }) !== 0) c5.fail("karma already past the ceiling is 0");
    if (timeToMeet({ type: "not", condition: { type: "employedBy", company: "ECorp" } }, state) !== null) c5.fail("not-employed while employed must refuse (we do not forecast quitting)");
    if (timeToMeet({ type: "not", condition: { type: "employedBy", company: "ECorp" } }, { ...state, companyCtx: undefined }) !== null) c5.fail("not-employed with no job list must refuse");
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c6 = new Check("BP6", "bestCrimeFor picks by the asked objective at current stats, and money prices as ln through the one bridge");
  {
    c6.examined(1);
    const live = fresh({ skills: { hacking: 146, strength: 39, defense: 34, dexterity: 35, agility: 37, charisma: 1, intelligence: 61 }, mults: { ...fresh().mults, crime_success: 1, crime_money: 1 } });
    const bn2 = { CrimeSuccessRate: 1, CrimeMoney: 3, CrimeExpGain: 1 };
    const money = bestCrimeFor("money", live, bn2);
    if (!money || money.crime === "Homicide") c6.fail(`the money crime at low combat is a cheap fast one, not Homicide, got ${money?.crime}`);
    const hom = crimeRates("Homicide", live, bn2, 1);
    if (!(money.rates.money >= hom.money)) c6.fail("the money pick must earn at least what Homicide earns");
    const karma = bestCrimeFor("karma", live, bn2);
    if (karma?.crime !== "Homicide") c6.fail(`the karma crime at those stats is Homicide, got ${karma?.crime}`);
    const str = bestCrimeFor("strength", live, bn2);
    if (!str || !(str.rates.exp.strength > 0)) c6.fail("a skill objective returns the crime with the most exp/s for it");
    if (bestCrimeFor("money", { ...live, exp: undefined }, bn2) !== null) c6.fail("unreadable person must refuse");
    if (bestCrimeFor("nonsense", live, bn2) !== null) c6.fail("an unknown objective must refuse");
    c6.note(`live stats, BN2: money ${money.crime} ${Math.round(money.rates.money)}/s, karma ${karma.crime} ${karma.rates.karma.toFixed(3)}/s`);

    c6.examined(1);
    const v = moneyLn(1e6, { money: 1e6, eBudget: 0.5, remainingWindows: 4 });
    if (Math.abs(v.ln - 4 * 0.5 * Math.log(2)) > 1e-12) c6.fail("moneyLn must be N x eB x ln((money + dollars) / money)");
    for (const [label, ctx] of [["no elasticity", { money: 1e6, remainingWindows: 4 }], ["no windows", { money: 1e6, eBudget: 0.5 }]]) {
      if (moneyLn(1e6, ctx).ln !== null) c6.fail(`${label}: must refuse`);
    }
    if (moneyLn(0, { money: 1e6, eBudget: 0.5, remainingWindows: 4 }).ln !== null) c6.fail("no dollars: refuse");
  }
  checks.push(c6);

  return checks;
}
