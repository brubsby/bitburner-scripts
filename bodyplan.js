// Combat stats and karma as FORECASTS. Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// joinplan.js could price exactly three quantities — hacking, money, and a
// backdoor (which is a hacking target in disguise). Everything else returned
// null, "cannot tell", and a faction with one unpriceable requirement was
// dropped from the ranking. Measured live on 2026-09-19 (docs/pricing-gaps.md):
// 47 null blockers across 11 factions, and 28 of them were a COMBAT STAT, six
// more were karma, two were kills. Slum Snakes — strength/defense/dexterity/
// agility of 30 each, a few minutes at a gym — was unpriceable. Daedalus's
// second admission route (combat 1500 instead of hacking 2500) was invisible,
// so the planner could not even compare the two.
//
// This module gives those quantities the same treatment hacking already has:
// a measured-or-derived rate, inverted through the game's own skill curve, and
// where the rate itself moves with the state (crime success rises with the
// stats the crime trains) a stepped simulation rather than a division.
//
// ---------------------------------------------------------------------------
// THE TWO CHANNELS, both from game source
//
// GYM   Work/Formulas.ts:calculateClassEarnings — per cycle
//         classInfo.earnings (gym: 1 exp of the one stat, ClassWork.tsx:54-73)
//         x location.expMult / gameCPS x hashManager.getTrainingMult()
//         then multWorkStats: x person.mults[<stat>_exp]
//       gameCPS is 5, so PER SECOND the rate is simply
//         expMult x trainingMult x mults.<stat>_exp
//       No focus penalty: ClassWork.process applies applyWorkStats with no
//       focusPenalty term (ClassWork.tsx:101-107; the penalty is applied by
//       Crime/Faction/Company/CreateProgram/Grafting work only). No BitNode
//       term: ClassGymExpGain has no consumer in gameplay code (grep on
//       2026-09-15, re-verified 2026-09-19). Cost is 120 x costMult per second
//       (ClassWork.tsx:57 `money: -120`), which no mid-run income notices.
//
// CRIME Work/Formulas.ts:calculateCrimeWorkStats and Work/CrimeWork.ts:commit —
//       per ATTEMPT (every `time` ms):
//         exp_i   = crime.<stat>_exp x mults.<stat>_exp x CrimeExpGain x focus
//         money   = crime.money x mults.crime_money x CrimeMoney       (success only)
//         kills   = crime.kills                                        (success only)
//         karma   = crime.karma x focus
//       and on FAILURE exp and karma are paid at a quarter (CrimeWork.ts:76-77),
//       so the expectation is x (3 x chance + 1) / 4 for exp and karma, x chance
//       for money and kills. The chance is Crime.ts:successRate:
//         (sum weight_i x skill_i + 0.025 x int) / 975 / difficulty
//         x mults.crime_success x CrimeSuccessRate x (1 + int^0.8 / 600), capped at 1.
//       Because the chance depends on the stats the crime itself raises, a
//       crime leg is a TRAJECTORY: simulateCrime steps the person forward,
//       recomputing the chance from the exp it has banked so far.
//
// ---------------------------------------------------------------------------
// WHAT IS REFUSED
//
// Every input is read from ns.getPlayer() and the BitNode multiplier table by
// the caller. A missing multiplier, exp, or node term makes the leg null —
// "cannot tell" — never 1. That is invariant B8: a quiet default here would
// price a faction as minutes away in a node where CrimeSuccessRate is 0.

import { expForSkill, skillFromExp } from 'installgate.js'

const num = (x) => typeof x === 'number' && isFinite(x)

/** The four stats haveCombatSkills(n) requires (FactionJoinCondition.ts:164). */
export const COMBAT = ['strength', 'defense', 'dexterity', 'agility']

/** Constants.ts:16, :50 — the crime success-rate denominators. */
export const MAX_SKILL_LEVEL = 975
export const INTELLIGENCE_CRIME_WEIGHT = 0.025

/** CONSTANTS.TravelCost (Constants.ts:28); travel is instant. */
export const TRAVEL_COST = 200e3

/** CONSTANTS.BaseFocusBonus (Constants.ts:87): the unfocused rate. */
export const UNFOCUSED = 0.8

/**
 * Every gym in the game — Locations/data/LocationsMetadata.ts. The `host` is
 * the location's own server, whose backdoor discounts the class COST by 10%
 * (Work/Formulas.ts:100-105); it does not touch exp, so it is not priced here.
 */
export const GYMS = [
  { name: 'Crush Fitness Gym', city: 'Aevum', expMult: 2, costMult: 3 },
  { name: 'Snap Fitness Gym', city: 'Aevum', expMult: 5, costMult: 10 },
  { name: 'Iron Gym', city: 'Sector-12', expMult: 1, costMult: 1 },
  { name: 'Powerhouse Gym', city: 'Sector-12', expMult: 10, costMult: 20 },
  { name: 'Millenium Fitness Gym', city: 'Volhaven', expMult: 4, costMult: 7 },
]

/** ClassWork.tsx:57 — every gym class costs 120 x costMult per second. */
export const GYM_BASE_COST = 120

/**
 * Crime/Crimes.ts, transcribed. Keys are the game's enum VALUES
 * (Crime/Enums.ts:1-14) — the strings ns.singularity.commitCrime accepts.
 * `time` in ms, `karma` is the amount LOST per success, weights are the
 * success-rate coefficients. bodyplan.test.mjs [BP1] parses Crimes.ts and
 * fails if any number here has drifted from the source.
 */
export const CRIMES = {
  Shoplift: { time: 2e3, money: 15e3, difficulty: 1 / 20, karma: 0.1, kills: 0,
    exp: { dexterity: 2, agility: 2 }, weight: { dexterity: 1, agility: 1 } },
  'Rob Store': { time: 60e3, money: 400e3, difficulty: 1 / 5, karma: 0.5, kills: 0,
    exp: { hacking: 30, dexterity: 45, agility: 45 }, weight: { hacking: 0.5, dexterity: 2, agility: 1 } },
  Mug: { time: 4e3, money: 36e3, difficulty: 1 / 5, karma: 0.25, kills: 0,
    exp: { strength: 3, defense: 3, dexterity: 3, agility: 3 },
    weight: { strength: 1.5, defense: 0.5, dexterity: 1.5, agility: 0.5 } },
  Larceny: { time: 90e3, money: 800e3, difficulty: 1 / 3, karma: 1.5, kills: 0,
    exp: { hacking: 45, dexterity: 60, agility: 60 }, weight: { hacking: 0.5, dexterity: 1, agility: 1 } },
  'Deal Drugs': { time: 10e3, money: 120e3, difficulty: 1, karma: 0.5, kills: 0,
    exp: { dexterity: 5, agility: 5, charisma: 10 }, weight: { charisma: 3, dexterity: 2, agility: 1 } },
  'Bond Forgery': { time: 300e3, money: 4.5e6, difficulty: 1 / 2, karma: 0.1, kills: 0,
    exp: { hacking: 100, dexterity: 150, charisma: 15 }, weight: { hacking: 0.05, dexterity: 1.25 } },
  'Traffick Arms': { time: 40e3, money: 600e3, difficulty: 2, karma: 1, kills: 0,
    exp: { strength: 20, defense: 20, dexterity: 20, agility: 20, charisma: 40 },
    weight: { charisma: 1, strength: 1, defense: 1, dexterity: 1, agility: 1 } },
  Homicide: { time: 3e3, money: 45e3, difficulty: 1, karma: 3, kills: 1,
    exp: { strength: 2, defense: 2, dexterity: 2, agility: 2 },
    weight: { strength: 2, defense: 2, dexterity: 0.5, agility: 0.5 } },
  'Grand Theft Auto': { time: 80e3, money: 1.6e6, difficulty: 8, karma: 5, kills: 0,
    exp: { strength: 20, defense: 20, dexterity: 20, agility: 80, charisma: 40 },
    weight: { hacking: 1, strength: 1, dexterity: 4, agility: 2, charisma: 2 } },
  Kidnap: { time: 120e3, money: 3.6e6, difficulty: 5, karma: 6, kills: 0,
    exp: { strength: 80, defense: 80, dexterity: 80, agility: 80, charisma: 80 },
    weight: { charisma: 1, strength: 1, dexterity: 1, agility: 1 } },
  Assassination: { time: 300e3, money: 12e6, difficulty: 8, karma: 10, kills: 1,
    exp: { strength: 300, defense: 300, dexterity: 300, agility: 300 },
    weight: { strength: 1, dexterity: 2, agility: 1 } },
  Heist: { time: 600e3, money: 120e6, difficulty: 18, karma: 15, kills: 0,
    exp: { hacking: 450, strength: 450, defense: 450, dexterity: 450, agility: 450, charisma: 450 },
    weight: { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1 } },
}

const SKILLS = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma']

/** PersonObjects/formulas/intelligence.ts:1. */
export const intelligenceBonus = (int, weight = 1) => 1 + (weight * Math.pow(num(int) ? int : 0, 0.8)) / 600

/**
 * Is `person` readable enough to simulate? `skills`, `exp` and `mults` for the
 * six trainable skills, plus the crime multipliers. Returns a reason or null.
 */
export function personProblem(person) {
  if (!person || typeof person !== 'object') return 'no person'
  for (const s of SKILLS) {
    if (!num(person.skills?.[s])) return `skills.${s} unreadable`
    if (!num(person.exp?.[s]) || person.exp[s] < 0) return `exp.${s} unreadable`
    if (!num(person.mults?.[s]) || person.mults[s] <= 0) return `mults.${s} unreadable`
    if (!num(person.mults?.[`${s}_exp`]) || person.mults[`${s}_exp`] < 0) return `mults.${s}_exp unreadable`
  }
  if (!num(person.skills?.intelligence)) return 'skills.intelligence unreadable'
  return null
}

function nodeProblem(node) {
  for (const k of ['CrimeSuccessRate', 'CrimeMoney', 'CrimeExpGain']) {
    if (!num(node?.[k]) || node[k] < 0) return `node ${k} unreadable`
  }
  return null
}

/** Crime.ts:successRate, exactly. `person.skills` must carry the six skills and intelligence. */
export function crimeChance(crime, person, node) {
  const c = typeof crime === 'string' ? CRIMES[crime] : crime
  if (!c || personProblem(person) || nodeProblem(node) || !num(person.mults?.crime_success)) return null
  let chance = 0
  for (const [s, w] of Object.entries(c.weight)) chance += w * person.skills[s]
  chance += INTELLIGENCE_CRIME_WEIGHT * person.skills.intelligence
  chance /= MAX_SKILL_LEVEL
  chance /= c.difficulty
  chance *= person.mults.crime_success
  chance *= node.CrimeSuccessRate
  chance *= intelligenceBonus(person.skills.intelligence, 1)
  return Math.min(chance, 1)
}

/**
 * Expected gains PER SECOND of committing one crime repeatedly at the person's
 * CURRENT stats: `{ chance, money, karma, kills, exp: {stat: perSec} }`.
 * `karma` is positive here — the amount of karma LOST per second.
 */
export function crimeRates(crime, person, node, focus = 1) {
  const c = typeof crime === 'string' ? CRIMES[crime] : crime
  const chance = crimeChance(c, person, node)
  if (chance === null || !num(person.mults?.crime_money) || !num(focus) || focus <= 0) return null
  const perSec = 1000 / c.time
  // CrimeWork.ts:76-77: failure pays exp and karma at a quarter.
  const failFactor = (3 * chance + 1) / 4
  const exp = {}
  for (const s of SKILLS) {
    const base = c.exp[s] ?? 0
    exp[s] = base * person.mults[`${s}_exp`] * node.CrimeExpGain * focus * failFactor * perSec
  }
  return {
    chance,
    money: c.money * person.mults.crime_money * node.CrimeMoney * chance * perSec,
    karma: c.karma * focus * failFactor * perSec,
    kills: c.kills * chance * perSec,
    exp,
  }
}

/** A deep-enough copy of the mutable parts of a person for simulation. */
function clonePerson(p) {
  return {
    skills: { ...p.skills },
    exp: { ...p.exp },
    mults: p.mults,
    karma: num(p.karma) ? p.karma : 0,
    numPeopleKilled: num(p.numPeopleKilled) ? p.numPeopleKilled : 0,
    money: num(p.money) ? p.money : 0,
    city: p.city,
  }
}

function relevel(p) {
  for (const s of SKILLS) p.skills[s] = skillFromExp(p.exp[s], p.mults[s])
}

/**
 * Step a person through `crime` until `until(person)` holds. Returns
 * `{ hours, person }` (the person AFTER the leg — its exp is what a gym leg
 * that follows starts from) or `{ hours: Infinity }` past `maxHours`, or
 * null when the inputs cannot be read. The step grows with elapsed time so a
 * 5-minute leg is resolved to seconds and a 500-hour one does not take a
 * 5-minute planner pass to compute.
 */
export function simulateCrime(crime, person, node, o = {}) {
  const c = typeof crime === 'string' ? CRIMES[crime] : crime
  const until = typeof o.until === 'function' ? o.until : null
  if (!c || !until || personProblem(person) || nodeProblem(node)) return null
  const focus = num(o.focus) ? o.focus : 1
  const maxHours = num(o.maxHours) ? o.maxHours : 2000
  // THE SLEEVE FLEET, if there is one. `assist` is constant karma and kills
  // per second contributed by something other than the player's own work slot
  // — in practice sleeveplan.fleetRates. It is integrated alongside the
  // player's crime because that is literally what the game does:
  // SleeveCrimeWork.ts:47 decrements the SAME Player.karma.
  //
  // Held CONSTANT on purpose. Sleeves gain combat exp from their crimes, so
  // their success chance rises and this understates them — conservative in the
  // direction that makes a karma gate look MORE expensive, which is the safe
  // direction for a verdict that decides whether to spend 18h grinding.
  //
  // An `assist` that cannot be read is not an `assist` of zero: the caller
  // passes null and must say so. Passing 0 here is a claim that there is no
  // fleet, and callers who do not know must not make it.
  const assistKarma = num(o.assist?.karmaPerSec) && o.assist.karmaPerSec >= 0 ? o.assist.karmaPerSec : 0
  const assistKills = num(o.assist?.killsPerSec) && o.assist.killsPerSec >= 0 ? o.assist.killsPerSec : 0
  const p = clonePerson(person)
  if (until(p)) return { hours: 0, person: p }
  let sec = 0
  for (let i = 0; i < 100000; i++) {
    const r = crimeRates(c, p, node, focus)
    if (!r) return null
    // 1-second resolution for the first ~3 minutes, then a 0.5% geometric
    // step: a 40-second Slum Snakes leg resolves to the second and a
    // 2000-hour Illuminati one finishes in ~2,500 iterations.
    const step = Math.max(1, sec / 200)
    for (const s of SKILLS) p.exp[s] += r.exp[s] * step
    p.karma -= (r.karma + assistKarma) * step
    p.numPeopleKilled += (r.kills + assistKills) * step
    p.money += r.money * step
    relevel(p)
    sec += step
    if (until(p)) return { hours: sec / 3600, person: p }
    if (sec / 3600 > maxHours) return { hours: Infinity, person: p }
  }
  return { hours: Infinity, person: p }
}

/**
 * The best crime for ONE objective at the person's current stats: 'money'
 * (dollars/s), 'karma' (karma lost/s), 'kills' (kills/s) or a skill name
 * (exp/s). A snapshot, not a trajectory — the right tool when the question
 * is "what is the slot worth this pass"; crimeLeg is the trajectory for "how
 * long to a target". Returns `{ crime, rates }` or null when unreadable.
 */
export function bestCrimeFor(objective, person, node, o = {}) {
  if (personProblem(person) || nodeProblem(node)) return null
  const focus = num(o.focus) ? o.focus : 1
  let best = null
  for (const name of Object.keys(CRIMES)) {
    const r = crimeRates(name, person, node, focus)
    if (!r) continue
    const v = objective === 'money' ? r.money : objective === 'karma' ? r.karma : objective === 'kills' ? r.kills : r.exp?.[objective]
    if (!num(v)) return null
    if (v > 0 && (!best || v > best.value)) best = { crime: name, rates: r, value: v }
  }
  return best
}

/**
 * The cheapest crime that satisfies a karma ceiling and/or a kill count —
 * ONE leg for both, because the same crime pays both at once and a faction
 * that asks for karma -45 and 30 kills (Speakers for the Dead) is not asking
 * for two separate grinds.
 *
 * `want`: `{ karma: <= this | null, kills: >= this | null }`.
 * Returns `{ hours, crime, person, karma, kills }` — `person` is the state
 * after the leg, so the combat exp the crimes granted can be credited to a
 * gym leg priced next. null when nothing is asked or inputs are unreadable.
 */
export function crimeLeg(want, person, node, o = {}) {
  const karmaTo = num(want?.karma) ? want.karma : null
  const killsTo = num(want?.kills) ? want.kills : null
  if (karmaTo === null && killsTo === null) return null
  if (personProblem(person) || nodeProblem(node)) return null
  const until = (p) => (karmaTo === null || p.karma <= karmaTo) && (killsTo === null || p.numPeopleKilled >= killsTo)
  let best = null
  for (const name of Object.keys(CRIMES)) {
    // A crime that never kills cannot satisfy a kill count, whatever its karma.
    if (killsTo !== null && !(CRIMES[name].kills > 0) && !(num(person.numPeopleKilled) && person.numPeopleKilled >= killsTo)) continue
    const r = simulateCrime(name, person, node, { ...o, until })
    if (!r) continue
    if (!best || r.hours < best.hours) best = { hours: r.hours, crime: name, person: r.person, karma: karmaTo, kills: killsTo }
  }
  return best
}

/**
 * THE KARMA GRIND ACROSS INSTALL CYCLES.
 *
 * crimeLeg assumes one continuous stretch, which is right for a gang inside
 * BitNode 2 (access is granted outright, so the only karma that matters is
 * the faction's -9) and WRONG everywhere else, where the gate is -54,000 and
 * the run installs many times on the way.
 *
 * Karma survives an install — prestigeSourceFile zeroes it, prestigeAugmentation
 * does not — but the COMBAT SKILLS THAT MAKE HOMICIDE SUCCEED do not: that
 * function sets every skill to 1 and every exp to 0. Measured on the live BN4
 * run, homicide's success rate falls from 92.7% to 1.16% across an install,
 * and the karma rate with it from 0.945/s to the 0.259/s floor where only the
 * quarter-karma paid on FAILURE is still coming in.
 *
 * So the grind is a sawtooth, and its average depends on how fast skills
 * rebuild — which is exactly what a combat multiplier changes. This walks the
 * cycles, resetting exp at each install and keeping the multipliers (which
 * augmentations do survive), and returns the total hours.
 *
 * `o`: { cycleHours, karmaTarget, focus, maxCycles }. Refuses (null) on an
 * unreadable person, node or cycle length rather than assuming one.
 */
export function karmaGrindAcrossCycles(person, node, o = {}) {
  const karmaTarget = num(o.karmaTarget) ? o.karmaTarget : null
  const cycleHours = num(o.cycleHours) && o.cycleHours > 0 ? o.cycleHours : null
  if (karmaTarget === null || cycleHours === null) return null
  if (personProblem(person) || nodeProblem(node)) return null
  const maxCycles = num(o.maxCycles) && o.maxCycles > 0 ? o.maxCycles : 200
  const until = (pp) => pp.karma <= karmaTarget

  const p = clonePerson(person)
  if (until(p)) return { hours: 0, cycles: 0, atCycleCap: false }
  let hours = 0
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    // One cycle of homicide, or the rest of the grind if it finishes first.
    const leg = simulateCrime('Homicide', p, node, { ...o, until, maxHours: cycleHours })
    if (!leg) return null
    if (leg.hours <= cycleHours && until(leg.person)) {
      return { hours: hours + leg.hours, cycles: cycle, atCycleCap: false }
    }
    // The cycle ran out: carry karma and multipliers, lose skills to the install.
    //
    // THE FLEET DOES NOT LOSE ITS SKILLS HERE, and that is not an omission:
    // `prestigeAugmentation` never calls sleeve.prestige() (it only re-tasks
    // each sleeve, PlayerObjectGeneralMethods.ts:120), so sleeve exp, skills
    // and sync all survive an install. Across a multi-cycle grind the player's
    // contribution keeps restarting from level 1 and the fleet's does not —
    // which is exactly why `o.assist` is a constant carried through the whole
    // loop rather than something reset alongside `p.exp`.
    hours += cycleHours
    p.karma = leg.person.karma
    p.numPeopleKilled = leg.person.numPeopleKilled
    for (const s of SKILLS) p.exp[s] = 0
    relevel(p)
  }
  // A cap reached is REPORTED, never returned as though it were the answer.
  return { hours: Infinity, cycles: maxCycles, atCycleCap: true }
}

/**
 * Where to train. The best gym in the game is Powerhouse (x10) in Sector-12
 * and travel is instant for $200k, so the answer is Powerhouse unless the run
 * cannot afford the ticket — then the best gym in the current city, and null
 * (refuse) if the current city has none.
 */
export function bestGym(person) {
  const byMult = [...GYMS].sort((a, b) => b.expMult - a.expMult)
  const here = byMult.find((g) => g.city === person?.city)
  if (here && here.expMult === byMult[0].expMult) return here
  if (num(person?.money) && person.money >= TRAVEL_COST) return byMult[0]
  return here ?? null
}

/** Exp per second of one stat at `gym` — Work/Formulas.ts:calculateClassEarnings, per second. */
export function gymRate(gym, stat, person, trainingMult) {
  const m = person?.mults?.[`${stat}_exp`]
  if (!gym || !num(gym.expMult) || !num(m) || m < 0 || !num(trainingMult) || trainingMult <= 0) return null
  return gym.expMult * trainingMult * m
}

/**
 * Hours until `stat` reaches `target` at `ratePerSec`, from the person's
 * current exp — the same inversion joinplan uses for hacking (skill.ts:13
 * floors the level, so nudge past the exact boundary). 0 if already there,
 * Infinity with no rate, null if unreadable.
 */
export function hoursToStat(stat, target, person, ratePerSec) {
  const exp = person?.exp?.[stat]
  const mult = person?.mults?.[stat]
  if (!num(target) || !num(exp) || exp < 0 || !num(mult) || mult <= 0) return null
  let need = expForSkill(target, mult)
  if (skillFromExp(need, mult) < target) need = need * (1 + 1e-9) + 1e-9
  if (exp >= need) return 0
  if (!num(ratePerSec)) return null
  if (ratePerSec <= 0) return Infinity
  return (need - exp) / ratePerSec / 3600
}

/**
 * Gym time for a set of stat targets, trained ONE AT A TIME (a gym class
 * trains a single stat). Returns `{ hours, gym, legs: [{stat, to, hours}] }`
 * — only stats still short are listed — or null when the person or the gym
 * cannot be read. `trainingMult` is hashManager.getTrainingMult(); the caller
 * reads it, because assuming 1 would be wrong in exactly the node that sells
 * the upgrade.
 */
/**
 * THE NEXT GYM LEG of a join forecast, across EVERY gym blocker. joinplan
 * reports one blocker per `skills` requirement — Slum Snakes' combat 30 is
 * four blockers, one stat each — so taking the first blocker with a gym
 * (the old body step) returned null the moment strength reached 30: the
 * step stopped claiming the work slot and faction work took it back with
 * defense, dexterity and agility still at 1 (live BN8 2026-09-26 11:47).
 * Legs are taken in requirement order (strength, defense, dexterity,
 * agility); a blocker whose gym carries a `why` (does not fit the window)
 * disqualifies the whole step, as before. Returns {gym, city, stat, to,
 * hours} or null when every leg is met.
 */
export function nextGymLeg(blockers, skills) {
  const gyms = (blockers ?? []).map((b) => b?.gym).filter(Boolean)
  if (gyms.some((g) => g.why)) return null
  for (const g of gyms) {
    for (const l of g.legs ?? []) {
      if ((skills?.[l.stat] ?? 0) < l.to) return { gym: g.gym, city: g.city, stat: l.stat, to: l.to, hours: l.hours }
    }
  }
  return null
}

export function gymLegs(targets, person, trainingMult) {
  if (personProblem(person)) return null
  const gym = bestGym(person)
  if (!gym) return null
  const legs = []
  let hours = 0
  for (const [stat, to] of Object.entries(targets ?? {})) {
    if (!SKILLS.includes(stat) || !num(to)) return null
    const h = hoursToStat(stat, to, person, gymRate(gym, stat, person, trainingMult))
    if (h === null) return null
    if (h > 0) legs.push({ stat, to, hours: h })
    hours += h
  }
  return { hours, gym: gym.name, city: gym.city, legs }
}
