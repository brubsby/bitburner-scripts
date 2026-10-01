// BLADEBURNER — the formulas, the policy, and the exit model. PURE: no ns
// identifiers, 0GB, so bladeburner.js, sleeve.js, progress.js and the offline
// tools all import the same code (CLAUDE.md "Separate pure logic from ns I/O").
//
// Every formula is cited against ~/Repos/bitburner (src/Bladeburner/*). The
// data tables were generated from the game's own classes
// (tools/sim/nodechoice bundle) and tools/test/bbplan.test.mjs [BB1] fails the
// suite the moment either drifts. The formulas are checked against the game's
// classes on random states by [BB2..BB6].
//
// ---------------------------------------------------------------------------
// THE ONE IDEA THAT MAKES THIS WORK IN-GAME: the success-chance "environment".
//
// Action.getSuccessChance (Actions/Action.ts:110-137) is
//
//   p = min(1, competence / difficulty)
//   competence = sum_stat w[stat] * effStat^decay[stat]          (core)
//              * intBonus(int, 0.75) * staminaPenalty * teamBonus * popFactor
//              * skill(All) * skill(Contract|Operation) [* Stealth] [* Kill]
//              * person.mults.bladeburner_success_chance
//   difficulty = baseDifficulty * difficultyFac^(level-1) * chaosFactor
//
// Split it as p(L) = min(1, ENV * core(sm) * chanceMult(sm) / difficulty(L)),
// where ENV = intBonus * stamina * team * pop * augMult / chaos does not
// depend on the Bladeburner skills or the action level. In the game, the API
// shows ONE number per action (getActionEstimatedSuccessChance, read at one
// level); from it ENV is recovered exactly, and then the chance at every level
// and under every candidate skill purchase is a pure function. So the daemon
// pays one probe per action, and the skill planner and the exit model reason
// on the same closed form the tests check against the game.
//
// What the API shows is a RANGE built from the population ESTIMATE
// (Action.ts:85-108 getSuccessRange); the policy decides on its LOW end —
// what we can be sure of — and sharpens the estimate (Field Analysis) when the
// range is wide. Offline (bbsim, the exit model) the real population is known
// and ENV is computed from it.
//
// ---------------------------------------------------------------------------
// THE EXIT. Bladeburner/ui/BlackOpPage.tsx:39-50 and
// NetscriptFunctions/Singularity.ts:1154-1158: once all 21 black operations are
// complete (the last is Operation Daedalus, rank 400k, difficulty 80,000),
// destroyW0r1dD43m0n accepts with NO hacking level, NO root and NO Red Pill.
// Completing Daedalus does not end the node by itself; endgame.js does, under
// its hold file and its --next. Nothing in this module or in bladeburner.js
// ever calls destroyW0r1dD43m0n.

import { drain } from 'coop.js'

// --- constants: Bladeburner/data/Constants.ts -------------------------------
export const BBC = {
  CyclesPerSecond: 5,
  StaminaGainPerSecond: 0.0085,
  BaseStaminaLoss: 0.285,
  MaxStaminaToGainFactor: 70000,
  DifficultyToTimeFactor: 10,
  DiffMultExponentialFactor: 0.28,
  DiffMultLinearFactor: 650,
  EffAgiLinearFactor: 10e3,
  EffDexLinearFactor: 10e3,
  EffAgiExponentialFactor: 0.04,
  EffDexExponentialFactor: 0.035,
  PopulationThreshold: 1e9,
  PopulationExponent: 0.7,
  ChaosThreshold: 50,
  BaseStatGain: 1,
  BaseIntGain: 0.003,
  ActionCountGrowthPeriod: 480,
  RankToFactionRepFactor: 2,
  RankNeededForFaction: 25,
  ContractSuccessesPerLevel: 3,
  OperationSuccessesPerLevel: 2.5,
  RanksPerSkillPoint: 3,
  ContractBaseMoneyGain: 250e3,
  HrcHpGain: 2,
  HrcStaminaGain: 1,
}

/** NetscriptFunctions/Bladeburner.ts:347-352: joinBladeburnerDivision needs every combat stat >= 100. */
export const JOIN_COMBAT = 100
/** BlackOperations.ts: 21 operations, the last is Operation Daedalus. */
export const DAEDALUS = 'Operation Daedalus'

/** Bladeburner/Enums.ts BladeburnerActionType / BladeburnerGeneralActionName. */
export const TYPE = { general: 'General', contract: 'Contracts', operation: 'Operations', blackOp: 'Black Operations' }
export const GENERAL = {
  training: 'Training',
  fieldAnalysis: 'Field Analysis',
  recruitment: 'Recruitment',
  diplomacy: 'Diplomacy',
  regen: 'Hyperbolic Regeneration Chamber',
  incite: 'Incite Violence',
}
/** Bladeburner/Enums.ts SpecialBladeburnerActionTypeForSleeve. */
export const SLEEVE_ACTION = { infiltrate: 'Infiltrate Synthoids', support: 'Support main sleeve', contracts: 'Take on contracts' }

/** BladeburnerMultName (Bladeburner/Enums.ts:77-93). */
export const MULT = {
  all: 'Total Success Chance',
  stealth: 'Stealth Success Chance',
  retire: 'Retirement Success Chance', // (not 'kill': the RAM calculator bills any identifier named like ns.kill, 0.5GB)
  contract: 'Contract Success Chance',
  operation: 'Operation Success Chance',
  estimate: 'Synthoid Data Estimate',
  time: 'Action Time',
  str: 'Effective Strength',
  def: 'Effective Defense',
  dex: 'Effective Dexterity',
  agi: 'Effective Agility',
  cha: 'Effective Charisma',
  stamina: 'Stamina',
  money: 'Contract Money',
  exp: 'Experience Gain',
}

// --- data: generated from the game's classes (.scratch/gentable.mjs shape;
// [BB1] compares every field against Bladeburner/data/*.ts) ------------------
// Stat order for weights/decays: hacking, strength, defense, dexterity, agility, charisma, intelligence.
export const STATS = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma', 'intelligence']
// growth: growthFunction() = getRandomIntInclusive(lo*10, hi*10)/10 per ActionCountGrowthPeriod.
const L = (o) => o
export const CONTRACTS = {
  Tracking: L({ baseDifficulty: 125, difficultyFac: 1.02, rewardFac: 1.041, rankGain: 0.3, rankLoss: 0, hpLoss: 0.5, isStealth: true, isKill: false, growth: [0.5, 7.5], minCount: 25, maxCount: 150, weights: [0, 0.05, 0.05, 0.35, 0.35, 0.1, 0.05], decays: [0, 0.91, 0.91, 0.91, 0.91, 0.9, 1] }),
  'Bounty Hunter': L({ baseDifficulty: 250, difficultyFac: 1.04, rewardFac: 1.085, rankGain: 0.9, rankLoss: 0, hpLoss: 1, isStealth: false, isKill: true, growth: [0.5, 7.5], minCount: 5, maxCount: 150, weights: [0, 0.15, 0.15, 0.25, 0.25, 0.1, 0.1], decays: [0, 0.91, 0.91, 0.91, 0.91, 0.8, 0.9] }),
  Retirement: L({ baseDifficulty: 200, difficultyFac: 1.03, rewardFac: 1.065, rankGain: 0.6, rankLoss: 0, hpLoss: 1, isStealth: false, isKill: true, growth: [0.5, 7.5], minCount: 5, maxCount: 150, weights: [0, 0.2, 0.2, 0.2, 0.2, 0.1, 0.1], decays: [0, 0.91, 0.91, 0.91, 0.91, 0.8, 0.9] }),
}
export const OPERATIONS = {
  Investigation: L({ baseDifficulty: 400, difficultyFac: 1.03, rewardFac: 1.07, rankGain: 2.2, rankLoss: 0.2, hpLoss: 0, isStealth: true, isKill: false, growth: [1, 4], minCount: 1, maxCount: 100, weights: [0.25, 0.05, 0.05, 0.2, 0.1, 0.25, 0.1], decays: [0.85, 0.9, 0.9, 0.9, 0.9, 0.7, 0.9] }),
  'Undercover Operation': L({ baseDifficulty: 500, difficultyFac: 1.04, rewardFac: 1.09, rankGain: 4.4, rankLoss: 0.4, hpLoss: 2, isStealth: true, isKill: false, growth: [1, 4], minCount: 1, maxCount: 100, weights: [0.2, 0.05, 0.05, 0.2, 0.2, 0.2, 0.1], decays: [0.8, 0.9, 0.9, 0.9, 0.9, 0.7, 0.9] }),
  'Sting Operation': L({ baseDifficulty: 650, difficultyFac: 1.04, rewardFac: 1.095, rankGain: 5.5, rankLoss: 0.5, hpLoss: 2.5, isStealth: true, isKill: false, growth: [0.3, 4], minCount: 1, maxCount: 150, weights: [0.25, 0.05, 0.05, 0.25, 0.1, 0.2, 0.1], decays: [0.8, 0.85, 0.85, 0.85, 0.85, 0.7, 0.9] }),
  Raid: L({ baseDifficulty: 800, difficultyFac: 1.045, rewardFac: 1.1, rankGain: 55, rankLoss: 2.5, hpLoss: 50, isStealth: false, isKill: true, growth: [0.2, 4], minCount: 1, maxCount: 150, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.7, 0.8, 0.8, 0.8, 0.8, 0, 0.9] }),
  'Stealth Retirement Operation': L({ baseDifficulty: 1000, difficultyFac: 1.05, rewardFac: 1.11, rankGain: 22, rankLoss: 2, hpLoss: 10, isStealth: true, isKill: true, growth: [0.1, 2], minCount: 1, maxCount: 150, weights: [0.1, 0.1, 0.1, 0.3, 0.3, 0, 0.1], decays: [0.7, 0.8, 0.8, 0.8, 0.8, 0, 0.9] }),
  Assassination: L({ baseDifficulty: 1500, difficultyFac: 1.06, rewardFac: 1.14, rankGain: 44, rankLoss: 4, hpLoss: 5, isStealth: true, isKill: true, growth: [0.1, 2], minCount: 1, maxCount: 150, weights: [0.1, 0.1, 0.1, 0.3, 0.3, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.8] }),
}
export const BLACK_OPS = [
  { name: 'Operation Typhoon', reqdRank: 2500, baseDifficulty: 2000, rankGain: 50, rankLoss: 10, hpLoss: 100, isStealth: false, isKill: true, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Zero', reqdRank: 5000, baseDifficulty: 2500, rankGain: 60, rankLoss: 15, hpLoss: 50, isStealth: true, isKill: false, weights: [0.2, 0.15, 0.15, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation X', reqdRank: 7500, baseDifficulty: 3000, rankGain: 75, rankLoss: 15, hpLoss: 100, isStealth: false, isKill: true, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Titan', reqdRank: 10000, baseDifficulty: 4000, rankGain: 100, rankLoss: 20, hpLoss: 100, isStealth: false, isKill: true, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Ares', reqdRank: 12500, baseDifficulty: 5000, rankGain: 125, rankLoss: 20, hpLoss: 200, isStealth: false, isKill: true, weights: [0, 0.25, 0.25, 0.25, 0.25, 0, 0], decays: [0, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Archangel', reqdRank: 15000, baseDifficulty: 7500, rankGain: 200, rankLoss: 20, hpLoss: 25, isStealth: false, isKill: true, weights: [0, 0.2, 0.2, 0.3, 0.3, 0, 0], decays: [0, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Juggernaut', reqdRank: 20000, baseDifficulty: 10000, rankGain: 300, rankLoss: 40, hpLoss: 300, isStealth: false, isKill: true, weights: [0, 0.25, 0.25, 0.25, 0.25, 0, 0], decays: [0, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Red Dragon', reqdRank: 25000, baseDifficulty: 12500, rankGain: 500, rankLoss: 50, hpLoss: 500, isStealth: false, isKill: true, weights: [0.05, 0.2, 0.2, 0.25, 0.25, 0, 0.05], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation K', reqdRank: 30000, baseDifficulty: 15000, rankGain: 750, rankLoss: 60, hpLoss: 1000, isStealth: false, isKill: true, weights: [0.05, 0.2, 0.2, 0.25, 0.25, 0, 0.05], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Deckard', reqdRank: 40000, baseDifficulty: 20000, rankGain: 1000, rankLoss: 75, hpLoss: 200, isStealth: false, isKill: true, weights: [0, 0.24, 0.24, 0.24, 0.24, 0, 0.04], decays: [0, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Tyrell', reqdRank: 50000, baseDifficulty: 25000, rankGain: 1500, rankLoss: 100, hpLoss: 500, isStealth: false, isKill: true, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Wallace', reqdRank: 75000, baseDifficulty: 30000, rankGain: 2000, rankLoss: 150, hpLoss: 1500, isStealth: false, isKill: true, weights: [0, 0.24, 0.24, 0.24, 0.24, 0, 0.04], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Shoulder of Orion', reqdRank: 100000, baseDifficulty: 35000, rankGain: 2500, rankLoss: 500, hpLoss: 1500, isStealth: true, isKill: false, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Hyron', reqdRank: 125000, baseDifficulty: 40000, rankGain: 3000, rankLoss: 1000, hpLoss: 500, isStealth: false, isKill: true, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Morpheus', reqdRank: 150000, baseDifficulty: 45000, rankGain: 4000, rankLoss: 1000, hpLoss: 100, isStealth: true, isKill: false, weights: [0.05, 0.15, 0.15, 0.3, 0.3, 0, 0.05], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Ion Storm', reqdRank: 175000, baseDifficulty: 50000, rankGain: 5000, rankLoss: 1000, hpLoss: 5000, isStealth: false, isKill: true, weights: [0, 0.24, 0.24, 0.24, 0.24, 0, 0.04], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Annihilus', reqdRank: 200000, baseDifficulty: 55000, rankGain: 7500, rankLoss: 1000, hpLoss: 10000, isStealth: false, isKill: true, weights: [0, 0.24, 0.24, 0.24, 0.24, 0, 0.04], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Ultron', reqdRank: 250000, baseDifficulty: 60000, rankGain: 10000, rankLoss: 2000, hpLoss: 10000, isStealth: false, isKill: true, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Centurion', reqdRank: 300000, baseDifficulty: 70000, rankGain: 15000, rankLoss: 5000, hpLoss: 10000, isStealth: false, isKill: false, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: 'Operation Vindictus', reqdRank: 350000, baseDifficulty: 75000, rankGain: 20000, rankLoss: 20000, hpLoss: 20000, isStealth: false, isKill: false, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
  { name: DAEDALUS, reqdRank: 400000, baseDifficulty: 80000, rankGain: 40000, rankLoss: 10000, hpLoss: 100000, isStealth: false, isKill: false, weights: [0.1, 0.2, 0.2, 0.2, 0.2, 0, 0.1], decays: [0.6, 0.8, 0.8, 0.8, 0.8, 0, 0.75] },
]
/** Bladeburner/data/Skills.ts — mults are percent per level (Bladeburner.ts:775-785). */
export const SKILLS = {
  "Blade's Intuition": { baseCost: 3, costInc: 2.1, maxLvl: Infinity, mults: { [MULT.all]: 3 } },
  Cloak: { baseCost: 2, costInc: 1.1, maxLvl: Infinity, mults: { [MULT.stealth]: 5.5 } },
  'Short-Circuit': { baseCost: 2, costInc: 2.1, maxLvl: Infinity, mults: { [MULT.retire]: 5.5 } },
  'Digital Observer': { baseCost: 2, costInc: 2.1, maxLvl: Infinity, mults: { [MULT.operation]: 4 } },
  Tracer: { baseCost: 2, costInc: 2.1, maxLvl: Infinity, mults: { [MULT.contract]: 4 } },
  Overclock: { baseCost: 3, costInc: 1.4, maxLvl: 90, mults: { [MULT.time]: -1 } },
  Reaper: { baseCost: 2, costInc: 2.1, maxLvl: Infinity, mults: { [MULT.str]: 2, [MULT.def]: 2, [MULT.dex]: 2, [MULT.agi]: 2 } },
  'Evasive System': { baseCost: 2, costInc: 2.1, maxLvl: Infinity, mults: { [MULT.dex]: 4, [MULT.agi]: 4 } },
  Datamancer: { baseCost: 3, costInc: 1, maxLvl: Infinity, mults: { [MULT.estimate]: 5 } },
  "Cyber's Edge": { baseCost: 1, costInc: 3, maxLvl: Infinity, mults: { [MULT.stamina]: 2 } },
  'Hands of Midas': { baseCost: 2, costInc: 2.5, maxLvl: Infinity, mults: { [MULT.money]: 10 } },
  Hyperdrive: { baseCost: 1, costInc: 2.5, maxLvl: Infinity, mults: { [MULT.exp]: 10 } },
}

for (const [k, v] of Object.entries(CONTRACTS)) Object.assign(v, { name: k, kind: 'contract' })
for (const [k, v] of Object.entries(OPERATIONS)) Object.assign(v, { name: k, kind: 'operation' })
BLACK_OPS.forEach((b, n) => Object.assign(b, { n, kind: 'blackop' }))
export const LEVELED = [...Object.values(CONTRACTS), ...Object.values(OPERATIONS)]
export const dataOf = (name) => CONTRACTS[name] ?? OPERATIONS[name] ?? BLACK_OPS.find((b) => b.name === name) ?? null
export const typeOf = (d) => (d.kind === 'contract' ? TYPE.contract : d.kind === 'operation' ? TYPE.operation : TYPE.blackOp)

// --- formulas ---------------------------------------------------------------

/** Bladeburner.ts:775-785 updateSkillMultipliers: product over skills of (1 + base*level/100). */
let SKILL_LIST = null
export function skillMultsOf(levels = {}) {
  if (!SKILL_LIST) SKILL_LIST = Object.entries(SKILLS).map(([name, s]) => [name, Object.entries(s.mults)])
  const m = {}
  for (let i = 0; i < SKILL_LIST.length; i++) {
    const lvl = levels[SKILL_LIST[i][0]]
    if (!lvl) continue
    const ms = SKILL_LIST[i][1]
    for (let j = 0; j < ms.length; j++) {
      const k = ms[j][0]
      m[k] = Math.max(0, (m[k] ?? 1) * (1 + (ms[j][1] * lvl) / 100))
    }
  }
  return m
}
const sm1 = (sm, k) => sm[k] ?? 1

/** Bladeburner.ts:758-773 getEffectiveSkillLevel. */
export function effStat(person, stat, sm) {
  const v = person.skills[stat] ?? 0
  switch (stat) {
    case 'strength': return v * sm1(sm, MULT.str)
    case 'defense': return v * sm1(sm, MULT.def)
    case 'dexterity': return v * sm1(sm, MULT.dex)
    case 'agility': return v * sm1(sm, MULT.agi)
    case 'charisma': return v * sm1(sm, MULT.cha)
    default: return v
  }
}

/** LevelableAction.ts:58-64 / Action.ts:140-142 (black ops have no level). */
export const difficultyOf = (d, level = 1) => (d.kind === 'blackop' ? d.baseDifficulty : d.baseDifficulty * Math.pow(d.difficultyFac, level - 1))
/** completeAction / getActionStats: difficulty^0.28 + difficulty/650. */
export const diffMultOf = (diff) => Math.pow(diff, BBC.DiffMultExponentialFactor) + diff / BBC.DiffMultLinearFactor

/** intelligence.ts calculateIntelligenceBonus(int, 0.75). */
export const intBonus = (int) => 1 + (0.75 * Math.pow(int, 0.8)) / 600

/** The weighted-stat core of competence (Action.ts:112-115). */
export function coreOf(d, person, sm) {
  let c = 0
  for (let i = 0; i < STATS.length; i++) {
    const w = d.weights[i]
    if (!w) continue
    c += w * Math.pow(effStat(person, STATS[i], sm), d.decays[i])
  }
  return c
}

/** The skill chance multipliers (Action.ts:123-127, Contract/Operation getActionTypeSkillSuccessBonus). */
export function chanceMultOf(d, sm) {
  let m = sm1(sm, MULT.all) * sm1(sm, d.kind === 'contract' ? MULT.contract : MULT.operation)
  if (d.isStealth) m *= sm1(sm, MULT.stealth)
  if (d.isKill) m *= sm1(sm, MULT.retire)
  return m
}

/** Bladeburner.ts:168-170. */
export const staminaPenaltyOf = (stamina, maxStamina) => Math.min(1, stamina / (0.5 * maxStamina))
/** Action.ts:30-34 getPopulationSuccessFactor (black ops: 1). */
export const popFactorOf = (pop) => Math.pow(pop / BBC.PopulationThreshold, BBC.PopulationExponent)
/** Action.ts:36-45 getChaosSuccessFactor (black ops: 1). */
export const chaosFactorOf = (chaos) => (chaos > BBC.ChaosThreshold ? Math.sqrt(1 + (chaos - BBC.ChaosThreshold)) : 1)
/** Operation.ts:96-98 operationTeamSuccessBonus (contracts: 1). */
export const teamBonusOf = (teamCount) => Math.pow(teamCount + 1, 0.05)

/**
 * The environment ENV in p = min(1, ENV * core * chanceMult / difficulty): every
 * factor that is neither a Bladeburner skill nor the action level.
 * env: { int, stamina, maxStamina, pop, chaos, teamCount, augMult }
 */
export function envOf(d, env) {
  let k = intBonus(env.int ?? 0) * staminaPenaltyOf(env.stamina ?? 1, env.maxStamina ?? 1) * (env.augMult ?? 1)
  if (d.kind !== 'contract') k *= teamBonusOf(env.teamCount ?? 0)
  if (d.kind !== 'blackop') k *= popFactorOf(env.pop ?? BBC.PopulationThreshold) / chaosFactorOf(env.chaos ?? 0)
  return k
}

/** The game's getSuccessChance (Action.ts:110-137 + Operation.ts:105-110 Raid with no communities). */
export function successChance(d, level, person, sm, env) {
  if (d.name === 'Raid' && (env.comms ?? 1) <= 0) return 0
  return pFrom(envOf(d, env), d, level, person, sm)
}
/** p from a known ENV. */
export function pFrom(K, d, level, person, sm) {
  if (!(K > 0)) return 0
  return Math.min(1, (K * coreOf(d, person, sm) * chanceMultOf(d, sm)) / difficultyOf(d, level))
}
/** Invert one observed (unclamped) chance to ENV: what the daemon does with the API's number. */
export function envFromChance(p, d, level, person, sm) {
  const denom = coreOf(d, person, sm) * chanceMultOf(d, sm)
  if (!(denom > 0)) return 0
  return (p * difficultyOf(d, level)) / denom
}

/** Action.ts:51-58: the agility/dexterity factor of the action time ("always > 1"). */
export function statFacOf(person, sm) {
  const agi = effStat(person, 'agility', sm)
  const dex = effStat(person, 'dexterity', sm)
  return 0.5 * (Math.pow(agi, BBC.EffAgiExponentialFactor) + Math.pow(dex, BBC.EffDexExponentialFactor) + agi / BBC.EffAgiLinearFactor + dex / BBC.EffDexLinearFactor)
}
/** Action.ts:47-63 getActionTime (+ BlackOperation.ts:33 x1.5), in SECONDS. */
export function actionTime(d, level, person, sm, statFac = statFacOf(person, sm)) {
  const base = difficultyOf(d, level) / BBC.DifficultyToTimeFactor
  const t = Math.max(1, (base * sm1(sm, MULT.time)) / statFac)
  return Math.ceil(t * (d.kind === 'blackop' ? 1.5 : 1))
}

/** Formulas.ts:5-26 calculateActionRankGain (bnRank = BitNode BladeburnerRank). */
export const rankGainOf = (d, level, bnRank) => (d.kind === 'blackop' ? d.rankGain * bnRank : d.rankGain * Math.pow(d.rewardFac, level - 1) * bnRank)
/** Formulas.ts:28-44 calculateActionRankLoss (no BitNode term). */
export const rankLossOf = (d, level) => (d.kind === 'blackop' ? d.rankLoss : d.rankLoss * Math.pow(d.rewardFac, level - 1))
/** Bladeburner.ts:920-925 / 1018-1022: the player's stamina per attempt. */
export const staminaCostOf = (d, level) => BBC.BaseStaminaLoss * diffMultOf(difficultyOf(d, level))
/** Field Analysis: 0.1 x BladeburnerRank (Formulas.ts:9-11). */
export const fieldAnalysisRank = (bnRank) => 0.1 * bnRank

/** Bladeburner.ts:1328-1344 calculateMaxStamina. */
export function maxStaminaOf(person, sm, staminaBonus = 0) {
  const base = Math.pow(effStat(person, 'agility', sm), 0.8)
  return Math.max(1e-9, (base + staminaBonus) * sm1(sm, MULT.stamina) * (person.mults?.bladeburner_max_stamina ?? 1))
}
/** Bladeburner.ts:1318-1326 calculateStaminaGainPerSecond. */
export function staminaGainOf(person, sm, maxStamina) {
  const gain = (BBC.StaminaGainPerSecond + maxStamina / BBC.MaxStaminaToGainFactor) * Math.pow(effStat(person, 'agility', sm), 0.17)
  return Math.max(0, gain * sm1(sm, MULT.stamina) * (person.mults?.bladeburner_stamina_gain ?? 1))
}

/** Skill.ts:24-54 calculateCost (closed form, rounded at the end, as the game does). */
export function skillCost(name, level, count = 1, skillCostMult = 1) {
  const s = SKILLS[name]
  return Math.round(count * skillCostMult * (s.baseCost + s.costInc * (level + (count - 1) / 2)))
}
/** Skill.ts:56-104 calculateMaxUpgradeCount. */
export function maxUpgradeCount(name, level, sp, skillCostMult = 1) {
  const s = SKILLS[name]
  const m = -s.baseCost - s.costInc * level + s.costInc / 2
  const delta = Math.sqrt(m * m + (2 * s.costInc * sp) / skillCostMult)
  const r = Math.round((m + delta) / s.costInc)
  if (skillCost(name, level, r + 1, skillCostMult) <= sp) return r + 1
  if (skillCost(name, level, r, skillCostMult) <= sp) return r
  return r - 1
}
/** LevelableAction.ts:38-40. */
export const successesNeeded = (maxLevel, perLevel) => Math.ceil(0.5 * maxLevel * (2 * perLevel + (maxLevel - 1)))
export const perLevelOf = (d) => (d.kind === 'contract' ? BBC.ContractSuccessesPerLevel : BBC.OperationSuccessesPerLevel)
/** Bladeburner.ts:1281-1290: skill points are floor(maxRank / 3) in total. */
export const totalSkillPointsAt = (maxRank) => Math.floor(maxRank / BBC.RanksPerSkillPoint)

/** Bladeburner.ts:705-734 getActionStats, BEFORE gainStats applies person.mults.*_exp. */
export function actionExpOf(d, level, person, sm, success) {
  const diff = difficultyOf(d, level)
  const t = actionTime(d, level, person, sm)
  const u = t * BBC.BaseStatGain * (success ? 1 : 0.5) * diffMultOf(diff)
  const ui = t * BBC.BaseIntGain * (success ? 1 : 0.5) * diffMultOf(diff)
  const x = sm1(sm, MULT.exp)
  const out = {}
  for (let i = 0; i < STATS.length; i++) out[STATS[i]] = (STATS[i] === 'intelligence' ? ui : u) * d.weights[i] * x
  return out
}

/** skill.ts calculateSkill / calculateExp. */
export const levelFromExp = (exp, mult) => (mult === 0 ? 1 : Math.max(1, Math.floor(mult * (32 * Math.log(exp + 534.6) - 200))))
export const expForLevel = (level, mult) => Math.max(0, Math.exp((level / mult + 200) / 32) - 534.6)

// --- the policy (one function, three callers: bladeburner.js, bbsim, the exit model) ---

export const POLICY = {
  // A contract/operation at a level is a candidate only if its LOW-end chance
  // clears this. tools/sim/bb6.mjs's search on the game's classes (BN6, our
  // stack, 3 seeds) over {0.3,0.4,0.5,0.7} x {0.7,0.8,0.9,0.97} is FLAT:
  // 33.0-35.8h in every cell, inside the seed noise — the thresholds barely
  // matter; the city choice, the skill objective and the sleeves do.
  minP: 0.4,
  // A black operation is attempted at this LOW-end chance or above.
  blackThr: 0.8,
  // Stamina hysteresis (fractions of max): rest at or below restLow until restHigh.
  restLow: 0.55,
  restHigh: 0.95,
  // Sharpen the population estimate (Field Analysis) when the best candidate's shown range is wider than this.
  maxWidth: 0.1,
  // Raid multiplies chaos by 1.01-1.05 per completion (Bladeburner.ts:845);
  // stop raiding a city past this. Below the ChaosThreshold (50) chaos costs
  // nothing, so the guard sits just under it.
  raidChaos: 45,
  // Combat level below which (after an install reset) the player retrains before acting.
  gymTo: JOIN_COMBAT,
  // What a skill point is scored on (skillScore): 'sum' = every action's best
  // rank/s, 'max' = the incumbent's. On the game's classes (BN6, 9 seeds,
  // three sleeve fleets) the two finish within 1.2h of each other; the exit
  // model tracks the game to -8..+2% under 'sum' and -12..+16% under 'max',
  // so 'sum' is what the plan can price (tools/sim/bb6.mjs).
  skillObjective: 'sum',
  // Skills the planner may buy. Hands of Midas (money), Datamancer (estimate
  // accuracy only) and Hyperdrive (exp) do not enter the rank objective.
  skills: ["Blade's Intuition", 'Digital Observer', 'Short-Circuit', 'Cloak', 'Reaper', 'Evasive System', 'Overclock', 'Tracer', "Cyber's Edge"],
}

/**
 * The view every policy call reads. Built by bladeburner.js from the API, by
 * bbsim from the game's classes, by the exit model from its own state.
 *
 * { person: {skills, mults}, sm (skill mults), levels (skill levels), bnRank,
 *   rank, stamina, maxStamina, staminaGain, resting,
 *   ref: {pop, chaos}               // the city the actions' K were measured in
 *   cities: [{name, pop, chaos, comms}]   // pop = what the caller can see
 *   city: name of the current city
 *   actions: [{ d, count, maxLevel, K, width }],  // K = ENV in `ref`; width = shown range (current city)
 *   blackOp: { d, K, width } | null }               // null once all 21 are done
 *
 * A city's ENV is K x cityFactor: population and chaos are the only
 * city-dependent factors of the chance (Action.ts:30-45), so one probe in one
 * city prices the same action in all six.
 */
export const cityFactor = (c, ref) => (popFactorOf(Math.max(0, c.pop)) / chaosFactorOf(c.chaos ?? 0)) / (popFactorOf(Math.max(1, ref.pop)) / chaosFactorOf(ref.chaos ?? 0))
const citiesOf = (v) => (v.cities?.length ? v.cities : [{ name: v.city ?? null, pop: v.ref?.pop ?? BBC.PopulationThreshold, chaos: v.chaos ?? 0, comms: v.comms ?? 0 }])
const refOf = (v) => v.ref ?? { pop: BBC.PopulationThreshold, chaos: 0 }

/** Per-view memo of what every action evaluation shares: the time factor and each action's core x skill chance multiplier. */
function memoOf(v) {
  if (!v.__memo) v.__memo = { statFac: statFacOf(v.person, v.sm), core: new Map() }
  return v.__memo
}
function coreCmOf(v, d) {
  const m = memoOf(v)
  let c = m.core.get(d)
  if (c === undefined) {
    c = coreOf(d, v.person, v.sm)
    m.core.set(d, c)
  }
  return c * chanceMultOf(d, v.sm)
}
const EFF = [MULT.str, MULT.def, MULT.dex, MULT.agi, MULT.cha, MULT.time]
/** The memo survives a skill change that moves no effective stat and no action time (the chance-only skills). */
const sameEff = (a, b) => EFF.every((k) => (a[k] ?? 1) === (b[k] ?? 1))

/** The best level of one action: max EV rank/s with p_lo >= minP, levels 1..maxLevel. f scales ENV (the city). */
export function bestLevel(a, v, pol = POLICY, f = 1) {
  const K = a.K * f
  if (!(a.count >= 1) || !(K > 0)) return null
  const d = a.d
  const core = coreCmOf(v, d)
  const top = a.maxLevel ?? 1
  // p(L) >= minP  <=>  difficulty(L) <= K*core/minP  — a closed form for the highest level.
  const cap = (K * core) / pol.minP
  const hi = d.baseDifficulty > cap ? 0 : Math.min(top, 1 + Math.floor(Math.log(cap / d.baseDifficulty) / Math.log(d.difficultyFac) + 1e-9))
  if (hi < 1) return null
  const sf = memoOf(v).statFac
  let best = null
  // rewardFac > difficultyFac^2 for every action (1.041/1.02^2 ... 1.14/1.06^2),
  // so rank per second rises with the level even as the chance falls; only the
  // failure loss and the whole-second time ceiling can make a lower level
  // better, and never by more than a couple of levels.
  for (let L = hi; L >= Math.max(1, hi - 2); L--) {
    const p = Math.min(1, (K * core) / difficultyOf(d, L))
    const t = actionTime(d, L, v.person, v.sm, sf)
    const ev = (p * rankGainOf(d, L, v.bnRank) - (1 - p) * rankLossOf(d, L)) / t
    if (!best || ev > best.ev) best = { a, L, p, t, ev }
  }
  return best
}

/** Stamina duty: the share of time spent on an action costing `cost` per `t` seconds, resting in the regeneration chamber otherwise. */
export function dutyOf(cost, t, gain, maxStamina) {
  const drain = cost / t
  if (gain >= drain) return 1
  const hrc = (maxStamina * BBC.HrcStaminaGain) / 100 / 60 // the chamber's 1%/60s on top of the passive gain
  return Math.min(1, (gain + hrc) / (drain + hrc))
}

/**
 * Where each action is best done. EV rises with ENV, so an action's best city
 * is the one with the largest cityFactor among those it may be done in: every
 * city for all but Raid, the cities with a community and chaos under the
 * guard for Raid (Operations.ts:147-150). Two candidates, not six.
 */
function cityChoices(v, pol) {
  const ref = refOf(v)
  let any = null
  let raid = null
  for (const c of citiesOf(v)) {
    const f = cityFactor(c, ref)
    if (!any || f > any.f) any = { c, f }
    if ((c.comms ?? 0) >= 1 && (c.chaos ?? 0) <= pol.raidChaos && (!raid || f > raid.f)) raid = { c, f }
  }
  return { any, raid }
}

/** The best (city, action, level) by EV rank/s; `weight(best)` lets the skill score fold in the stamina duty. */
function bestOver(v, pol, weight = null) {
  const { any, raid } = cityChoices(v, pol)
  let best = null
  for (const a of v.actions) {
    const at = a.d.name === 'Raid' ? raid : any
    if (!at) continue
    const b = bestLevel(a, v, pol, at.f)
    if (!b) continue
    const score = weight ? b.ev * weight(b) : b.ev
    if (!best || score > best.score) best = { ...b, city: at.c, score }
  }
  return best
}

/** Which action next. Returns { type, name, level?, city?, why, ev, p, blackOp? }. */
export function chooseAction(v, pol = POLICY) {
  const gen = (name, why, city = v.city ?? null) => ({ type: TYPE.general, name, why, city })
  if (v.resting) return gen(GENERAL.regen, `stamina ${fmt(v.stamina)}/${fmt(v.maxStamina)}: resting to ${pol.restHigh * 100}%`)
  const bo = v.blackOp
  if (bo && v.rank >= bo.d.reqdRank) {
    const p = pFrom(bo.K, bo.d, 1, v.person, v.sm)
    if (p >= pol.blackThr) return { type: TYPE.blackOp, name: bo.d.name, city: v.city ?? null, why: `black op ${bo.d.n + 1}/21 at ${(p * 100).toFixed(1)}% (>= ${pol.blackThr * 100}%)`, p, blackOp: true }
  }
  const best = bestOver(v, pol)
  if (best && (best.city.chaos ?? 0) > BBC.ChaosThreshold) return gen(GENERAL.diplomacy, `chaos ${fmt(best.city.chaos)} > ${BBC.ChaosThreshold} in ${best.city.name ?? 'the best city'}`, best.city.name ?? null)
  if (best && (best.city.name ?? null) === (v.city ?? null) && (best.a.width ?? 0) > pol.maxWidth) return gen(GENERAL.fieldAnalysis, `${best.a.d.name}'s shown range is ${((best.a.width ?? 0) * 100).toFixed(0)}% wide: sharpen the estimate`)
  if (best) return { type: typeOf(best.a.d), name: best.a.d.name, level: best.L, city: best.city.name ?? null, p: best.p, ev: best.ev, why: `${best.a.d.name} L${best.L} in ${best.city.name ?? 'this city'} at ${(best.p * 100).toFixed(0)}%: ${best.ev.toPrecision(3)} rank/s` }
  // Nothing clears minP. If even the best city is past the chaos threshold,
  // chaos is the reason (it divides every chance by sqrt(1 + chaos - 50)):
  // Diplomacy there. Otherwise Field Analysis — it earns rank (0.1/30s), needs
  // no stamina and sharpens the estimate, the usual reason nothing clears.
  const calm = cityChoices(v, pol).any?.c
  if (calm && (calm.chaos ?? 0) > BBC.ChaosThreshold) return gen(GENERAL.diplomacy, `nothing clears ${pol.minP * 100}% and the best city has chaos ${fmt(calm.chaos)} > ${BBC.ChaosThreshold}`, calm.name ?? null)
  return gen(GENERAL.fieldAnalysis, `no contract or operation clears ${pol.minP * 100}% (low end) in any city — field analysis`)
}
const fmt = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(1) : String(x))

/** Which city to stand in when nothing city-specific is being done: population over chaos. cities: [{name, pop, chaos}]. */
export function bestCity(cities) {
  let best = null
  for (const c of cities) {
    const v = popFactorOf(Math.max(0, c.pop)) / chaosFactorOf(c.chaos ?? 0)
    if (!best || v > best.v) best = { ...c, v }
  }
  return best
}

/** The objective a skill purchase is scored on: the next black op's chance while it is rank-eligible and short, else steady rank/s with the stamina duty. */
export function skillScore(v, pol = POLICY) {
  const bo = v.blackOp
  if (bo && v.rank >= bo.d.reqdRank) {
    const p = pFrom(bo.K, bo.d, 1, v.person, v.sm)
    if (p < pol.blackThr) return { kind: 'blackop', v: p }
  }
  const duty = (b) => dutyOf(staminaCostOf(b.a.d, b.L), b.t, v.staminaGain ?? Infinity, v.maxStamina ?? 1)
  if (pol.skillObjective === 'sum') {
    // The sum over actions of each one's best rank/s (its best city, gated at
    // minP/2): a purchase that brings the next operation into reach counts,
    // where the max over actions sees only the incumbent (the lock-in that
    // held the model on Tracking for 20h).
    const loose = { ...pol, minP: pol.minP / 2 }
    const { any, raid } = cityChoices(v, pol)
    let s = 0
    for (const a of v.actions) {
      const at = a.d.name === 'Raid' ? raid : any
      const b = at ? bestLevel(a, v, loose, at.f) : null
      if (b) s += Math.max(0, b.ev * duty(b))
    }
    return { kind: 'rank', v: s }
  }
  const best = bestOver(v, pol, duty)
  return { kind: 'rank', v: best ? best.score : 0 }
}

/** Re-derive the view's skill-dependent fields after a hypothetical level change. */
function withLevels(v, levels) {
  const sm = skillMultsOf(levels)
  const maxStamina = v.maxStaminaBase ? maxStaminaOf(v.person, sm, v.staminaBonus ?? 0) : v.maxStamina
  return { ...v, __memo: v.__memo && sameEff(v.sm, sm) ? v.__memo : null, levels, sm, maxStamina, staminaGain: v.maxStaminaBase ? staminaGainOf(v.person, sm, maxStamina) : v.staminaGain }
}

/**
 * Which skills to buy with the points held: greedy on the relative gain of
 * skillScore per skill point, in chunks of ~1/20 of the points (as bbsim's
 * did, now the one shared rule). Returns [{ name, count, cost, why }] in order.
 */
export function planSkills(v, sp, pol = POLICY, skillCostMult = 1, chunks = 20) {
  const out = []
  let levels = { ...(v.levels ?? {}) }
  let cur = withLevels(v, levels)
  for (let iter = 0; iter < 60 && sp >= 1; iter++) {
    const base = skillScore(cur, pol)
    let pick = null
    for (const name of pol.skills) {
      const lvl = levels[name] ?? 0
      const s = SKILLS[name]
      if (lvl >= s.maxLvl) continue
      let k = Math.max(1, maxUpgradeCount(name, lvl, Math.max(1, Math.floor(sp / chunks)), skillCostMult))
      k = Math.min(k, s.maxLvl - lvl)
      const cost = skillCost(name, lvl, k, skillCostMult)
      if (!(cost > 0) || cost > sp) continue
      const s1 = skillScore(withLevels(cur, { ...levels, [name]: lvl + k }), pol)
      const gain = s1.kind === base.kind ? s1.v - base.v : s1.kind === 'rank' ? Infinity : -Infinity
      const val = (base.v > 0 ? gain / base.v : gain) / cost
      if (!pick || val > pick.val) pick = { name, k, cost, val }
    }
    if (!pick || !(pick.val > 0)) {
      // Nothing measurably moves the objective now: bank Blade's Intuition, which raises every chance.
      const name = "Blade's Intuition"
      const lvl = levels[name] ?? 0
      const k = maxUpgradeCount(name, lvl, Math.max(1, Math.floor(sp / 2)), skillCostMult)
      if (k >= 1) {
        const cost = skillCost(name, lvl, k, skillCostMult)
        if (cost <= sp) {
          out.push({ name, count: k, cost, why: 'nothing moves the objective now; banked in the all-chance skill' })
          levels = { ...levels, [name]: lvl + k }
          sp -= cost
        }
      }
      break
    }
    out.push({ name: pick.name, count: pick.k, cost: pick.cost, why: `${base.kind === 'blackop' ? 'next black op chance' : 'rank/s'} +${(pick.val * pick.cost * 100).toFixed(2)}%` })
    levels = { ...levels, [pick.name]: (levels[pick.name] ?? 0) + pick.k }
    sp -= pick.cost
    cur = withLevels(cur, levels)
  }
  return out
}

// --- the exit model ---------------------------------------------------------
//
// bladeExit: hours from now to the 21st black operation, simulating THIS
// file's policy on expected values in steps of `dt` game seconds. It is what
// the plan layer prices the Bladeburner route with, in-game, inside the plan's
// CPU budget. It is checked against tools/sim/nodechoice/bbsim.mjs (the
// game's own classes running the same policy) by tools/sim/bb6.mjs, which
// prints the error; NOT CALIBRATED against a live game — no node of this run
// has had Bladeburner.
//
// The cities are modelled in expectation: each one's population, chaos and
// communities move with the operations done there (Bladeburner.ts:792-888,
// completeOperation / completeContract), the passive chaos decay
// (Bladeburner.ts:1395-1400) and the random events (Bladeburner.ts:602-698,
// one per 240-600s in a random city: riots +1 then x1.05-1.2, new communities,
// population swings). What it does not model, each named with its direction:
//   - migrations between cities (zero-sum in population and communities): either way;
//   - HP damage and hospital bills: money is not modelled — optimistic;
//   - the exp the sleeves pass to the player: pessimistic.
//
// s (state):
//   person {skills, exp, mults}       mults: *_exp, and strength..charisma as LEVEL mults (incl. the node's), bladeburner_*
//   int                               intelligence level (constant)
//   joined, rank, maxRank, skillPoints, levels{}, staminaBonus, blackOpsDone,
//   counts{name}, maxLevels{name}, successes{name}
//   cities [{name, pop, chaos, comms}] (default: six at pop, chaos 0, 77.5 communities)
//   bnRank, skillCostMult             node multipliers BladeburnerRank / BladeburnerSkillCost
//   sleeves {infiltrate, support, fa}
//   gymExpPerSec                      exp per second a stat gains at the gym (to the join bar and after installs)
//   install {firstH, everyH?, combatGain?, gains?, simulacrum?}
//                                     an augmentation install (Prestige.ts prestigeAugmentation): every
//                                     exp to 0 and the stats with it (PlayerObjectGeneralMethods.ts:80-100);
//                                     the division, rank, skills, skill points, black ops done and the
//                                     stamina bonus PERSIST (Player.bladeburner is kept; Bladeburner.ts:260-264
//                                     only resets the action and re-joins the faction at rank >= 25), so
//                                     no re-join. `gains` multiplies person.mults (the batch's combat level
//                                     and exp multipliers, bladeburner_* — success chance through env.augMult,
//                                     stamina through maxStaminaOf/staminaGainOf); combatGain (legacy) the
//                                     four combat level multipliers. everyH absent: that one install only.
//                                     Max stamina follows agility (calculateMaxStamina scales the current
//                                     stamina with it), which the retrain restores.
//   simulacrum                        The Blade's Simulacrum installed (Bladeburner.ts:179, :1355): the
//                                     player's work runs beside the action, so the gym trains combat
//                                     IN PARALLEL (the lowest stat, gymExpPerSec) instead of blocking
//                                     the retrain. install.simulacrum: installed by that install.
//   maxH, dt
//
// The retrain is the POLICY (progress.js bladeGymStep): whenever a combat stat
// is below max(JOIN_COMBAT, pol.gymTo) on the committed route, the slot trains
// at the gym before Bladeburner acts — at the start (a life that begins below
// it, e.g. right after an install) as after each install.
export const CITY_NAMES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven']
const EVENT_MEAN_S = 420 // getRandomIntInclusive(240, 600)

/** The exit model, drained synchronously (the tests, bb6.mjs, bbsim checks). */
export function bladeExit(s0, pol = POLICY) {
  return drain(bladeExitGen(s0, pol))
}

/** The exit model as a generator that yields every 10 steps and after each skill plan (a few ms of work), for the plan's pacer and sleeve.js. */
export function* bladeExitGen(s0, pol = POLICY) {
  const dt = s0.dt ?? 300
  const maxS = (s0.maxH ?? 400) * 3600
  const person = { skills: { ...s0.person.skills }, exp: { ...s0.person.exp }, mults: { ...s0.person.mults } }
  const lvMult = (st) => person.mults[st] ?? 1
  const relevel = () => {
    for (const st of ['strength', 'defense', 'dexterity', 'agility', 'charisma']) person.skills[st] = levelFromExp(person.exp[st] ?? 0, lvMult(st))
  }
  const gainExp = (x, k) => {
    for (const st of ['strength', 'defense', 'dexterity', 'agility', 'charisma']) person.exp[st] = (person.exp[st] ?? 0) + (x[st] ?? 0) * k * (person.mults[`${st}_exp`] ?? 1)
  }
  const st = {
    rank: s0.rank ?? 0,
    maxRank: s0.maxRank ?? s0.rank ?? 0,
    sp: s0.skillPoints ?? 0,
    levels: { ...(s0.levels ?? {}) },
    bonus: s0.staminaBonus ?? 0,
    bo: s0.blackOpsDone ?? 0,
    counts: {},
    maxL: {},
    succ: {},
  }
  for (const d of LEVELED) {
    st.counts[d.name] = s0.counts?.[d.name] ?? (d.minCount + d.maxCount) / 2
    st.maxL[d.name] = s0.maxLevels?.[d.name] ?? 1
    st.succ[d.name] = s0.successes?.[d.name] ?? 0
  }
  // Unknown cities: City.ts rolls each population uniform in [1e9, 1.5e9] and
  // communities in [5, 150]; the policy stands in the best of six, so the six
  // are the expected order statistics (k/7 quantiles), not six copies of the mean.
  const cities = (s0.cities?.length ? s0.cities : CITY_NAMES.map((name, k) => ({ name, pop: 1e9 + (0.5e9 * (k + 1)) / 7, chaos: 0, comms: 5 + (145 * (k + 1)) / 7 }))).map((c) => ({ ...c }))
  const sl = s0.sleeves ?? {}
  const inf = sl.infiltrate ?? 0
  const sup = sl.support ?? 0
  const fa = sl.fa ?? 0
  // SleeveInfiltrateWork: each of n sleeves adds n^-0.5/2 to every count per 60s (Bladeburner.ts:1252-1264).
  const infPerSec = inf > 0 ? (inf * (Math.pow(inf, -0.5) / 2)) / 60 : 0
  const growthPerSec = (d) => (d.growth[0] + d.growth[1]) / 2 / BBC.ActionCountGrowthPeriod
  // ENV measured in a reference city of population 1e9 and no chaos; each real city scales it (cityFactor).
  const env = { int: s0.int ?? 0, pop: BBC.PopulationThreshold, chaos: 0, teamCount: sup, augMult: person.mults.bladeburner_success_chance ?? 1 }
  const bnRank = s0.bnRank ?? 1
  const costMult = s0.skillCostMult ?? 1
  let t = 0
  const trace = []
  let joinH = 0
  let installs = 0
  const gymRate = s0.gymExpPerSec ?? 0
  // gymExpPerSec is the exp a stat GAINS per second at the gym (after the exp
  // multipliers), the quantity bodyplan measured live (37.661/s, 2026-09-19).
  const gymTo = (target) => {
    let need = 0
    for (const c of ['strength', 'defense', 'dexterity', 'agility']) {
      const want = expForLevel(target, lvMult(c))
      need += Math.max(0, want - (person.exp[c] ?? 0))
      if ((person.exp[c] ?? 0) < want) person.exp[c] = want
    }
    relevel()
    return need <= 0 ? 0 : gymRate > 0 ? need / gymRate : Infinity
  }
  relevel()
  // THE SIMULACRUM: the gym beside the action (the lowest combat stat, one class at a time).
  let simOn = s0.simulacrum === true
  const startExpMult = person.mults.strength_exp ?? 1
  const gymParallel = (secs) => {
    if (!(gymRate > 0)) return
    let low = 'strength'
    for (const c of ['defense', 'dexterity', 'agility']) if ((person.skills[c] ?? 0) < (person.skills[low] ?? 0)) low = c
    person.exp[low] = (person.exp[low] ?? 0) + gymRate * ((person.mults[`${low}_exp`] ?? 1) / startExpMult) * secs
    relevel()
  }
  if (!s0.joined) {
    const h = gymTo(JOIN_COMBAT)
    if (!isFinite(h)) return { hours: null, why: 'not in the division and no gym rate to reach combat 100' }
    t += h
    joinH = h / 3600
  } else if (!simOn) {
    // In the division but below the retrain bar (a life that began with an
    // install): the policy trains first (progress.js bladeGymStep).
    const h = gymTo(Math.max(JOIN_COMBAT, pol.gymTo))
    if (isFinite(h) && h > 0) {
      t += h
      joinH = h / 3600
    }
  }
  const inst = s0.install ?? null
  const firstInstallS = inst ? (Number.isFinite(inst.firstH) ? inst.firstH : inst.everyH) : null
  let nextInstall = Number.isFinite(firstInstallS) && firstInstallS >= 0 ? firstInstallS * 3600 : Infinity
  let lastSkill = -Infinity
  let smKey = null
  let smNow = null
  const viewOf = () => {
    const key = JSON.stringify(st.levels)
    if (key !== smKey) {
      smKey = key
      smNow = skillMultsOf(st.levels)
    }
    const sm = smNow
    const maxStamina = maxStaminaOf(person, sm, st.bonus)
    const stamina = maxStamina // the duty model keeps it inside the 55-95% band: penalty 1
    const e = { ...env, stamina, maxStamina }
    const actions = LEVELED.map((d) => ({ d, count: st.counts[d.name], maxLevel: st.maxL[d.name], K: envOf(d, e), width: 0 }))
    const bd = BLACK_OPS[st.bo]
    return {
      person, sm, levels: st.levels, bnRank, rank: st.rank, stamina, maxStamina,
      staminaGain: staminaGainOf(person, sm, maxStamina), maxStaminaBase: true, staminaBonus: st.bonus,
      ref: { pop: BBC.PopulationThreshold, chaos: 0 }, cities, city: null, resting: false, actions,
      blackOp: bd ? { d: bd, K: envOf(bd, e), width: 0 } : null,
    }
  }
  const gainRank = (dr) => {
    st.rank = Math.max(0, st.rank + dr)
    if (st.rank > st.maxRank) {
      const before = totalSkillPointsAt(st.maxRank)
      st.maxRank = st.rank
      st.sp += totalSkillPointsAt(st.maxRank) - before
    }
  }
  // Bladeburner.ts:792-888: what n attempts (expected successes ns) do to the city they are done in.
  const cityEffect = (c, name, n, ns) => {
    switch (name) {
      case 'Bounty Hunter': c.chaos += 0.02 * ns; c.pop -= ns; break
      case 'Retirement': c.chaos += 0.04 * ns; c.pop -= ns; break
      case 'Sting Operation': c.pop *= Math.pow(0.999, ns); c.chaos += 0.1 * n; break
      case 'Raid': c.pop *= Math.pow(0.99, ns) * Math.pow(0.9925, n - ns); c.comms = Math.max(0, c.comms - ns); c.chaos *= Math.pow(1.03, n); break
      case 'Stealth Retirement Operation': c.pop *= Math.pow(0.995, ns); c.chaos *= Math.pow(0.98, n); break
      case 'Assassination': c.pop -= ns; break
    }
    c.pop = Math.max(0, c.pop)
  }
  const cityTick = (secs) => {
    const ev = secs / EVENT_MEAN_S / CITY_NAMES.length // expected events per city
    for (const c of cities) {
      c.chaos = Math.max(0, c.chaos - 0.0001 * secs)
      c.chaos += ev * 0.2 * (1.125 + 0.125 * c.chaos) // riots: +1 then x(1.05..1.20)
      c.comms += ev * 0.05 // a new community
      c.pop *= 1 + ev * (0.05 * 0.15 + 0.2 * 0.16 - 0.2 * 0.14) // new community / new synthoids / fewer synthoids
    }
  }
  let sinceYield = 0
  while (t < maxS && st.bo < BLACK_OPS.length) {
    if (++sinceYield >= 10) {
      sinceYield = 0
      yield
    }
    if (t >= nextInstall) {
      // An install: combat (and every) exp to 0, the multipliers the batch bought.
      const g = inst.combatGain ?? 1
      for (const c of ['strength', 'defense', 'dexterity', 'agility']) person.mults[c] = lvMult(c) * g
      for (const [k, x] of Object.entries(inst.gains ?? {})) if (Number.isFinite(x) && x > 0) person.mults[k] = (person.mults[k] ?? 1) * x
      env.augMult = person.mults.bladeburner_success_chance ?? 1
      if (inst.simulacrum === true) simOn = true
      for (const c of ['strength', 'defense', 'dexterity', 'agility', 'charisma']) person.exp[c] = 0
      relevel()
      installs++
      nextInstall = inst.everyH > 0 ? nextInstall + inst.everyH * 3600 : Infinity
      if (simOn) continue // the retrain runs beside the actions (gymParallel)
      const h = gymTo(pol.gymTo)
      cityTick(h)
      t += h
      continue
    }
    if (t - lastSkill >= (s0.skillEveryS ?? 3600) && st.sp >= 1) {
      for (const b of planSkills(viewOf(), st.sp, pol, costMult, s0.skillChunks ?? 8)) {
        st.levels[b.name] = (st.levels[b.name] ?? 0) + b.count
        st.sp -= b.cost
      }
      lastSkill = t
      sinceYield = 0
      yield // a skill plan is the heaviest single piece of a step
    }
    const v = viewOf()
    // Sleeves on Field Analysis (stamina-free, always succeeds): 0.1 rank per 30s each.
    if (fa > 0) gainRank(fa * fieldAnalysisRank(bnRank) * (dt / 30))
    for (const d of LEVELED) st.counts[d.name] += (growthPerSec(d) + infPerSec) * dt
    cityTick(dt)
    const pick = chooseAction(v, pol)
    if (pick.blackOp) {
      const d = BLACK_OPS[st.bo]
      const p = Math.max(pick.p, 1e-6)
      const tt = actionTime(d, 1, person, v.sm)
      // Expected attempts 1/p, each a full action time; failures cost rank (the stamina is rested between).
      const f = dutyOf(staminaCostOf(d, 1), tt, v.staminaGain, v.maxStamina)
      t += tt / p / f
      gainRank(-((1 - p) / p) * rankLossOf(d, 1))
      gainRank(rankGainOf(d, 1, bnRank))
      gainExp(actionExpOf(d, 1, person, v.sm, true), 1)
      relevel()
      st.bo++
      continue
    }
    if (simOn) gymParallel(dt)
    let left = dt
    for (let k = 0; k < 3 && left > 1e-9; k++) {
      const c = k === 0 ? pick : chooseAction(viewOf(), pol)
      const city = cities.find((x) => x.name === c.city) ?? null
      const d = c.type === TYPE.general ? null : dataOf(c.name)
      if (!d) {
        // General actions: Field Analysis pays rank; Diplomacy cuts chaos by cha^0.045 + cha/1000 percent per 60s (Bladeburner.ts:736-744, 1186-1195).
        if (c.name === GENERAL.fieldAnalysis) gainRank(fieldAnalysisRank(bnRank) * (left / 30))
        if (c.name === GENERAL.diplomacy && city) {
          const pctCut = Math.pow(person.skills.charisma, 0.045) + person.skills.charisma / 1000
          city.chaos *= Math.pow(1 - pctCut / 100, left / 60)
        }
        left = 0
        break
      }
      const tt = actionTime(d, c.level, person, v.sm)
      const f = dutyOf(staminaCostOf(d, c.level), tt, v.staminaGain, v.maxStamina)
      let n = (left * f) / tt
      let used = left
      if (n > st.counts[d.name]) {
        n = Math.max(0, st.counts[d.name])
        used = (n * tt) / f
      }
      if (d.name === 'Raid' && city) {
        // Each success consumes a community; a city without one cannot be raided (Operations.ts:147-150).
        const cap = city.comms / Math.max(c.p, 1e-9)
        if (n > cap) {
          n = cap
          used = (n * tt) / f
        }
      }
      const p = c.p
      st.counts[d.name] -= n
      st.succ[d.name] += n * p
      while (st.succ[d.name] >= successesNeeded(st.maxL[d.name], perLevelOf(d))) st.maxL[d.name]++
      gainRank(n * (p * rankGainOf(d, c.level, bnRank) - (1 - p) * rankLossOf(d, c.level)))
      if (city) cityEffect(city, d.name, n, n * p)
      gainExp(actionExpOf(d, c.level, person, v.sm, true), n * (p + (1 - p) * 0.5))
      relevel()
      left -= Math.max(used, 1e-6)
    }
    t += dt
    if (trace.length < 400 && Math.floor(t / 36000) !== Math.floor((t - dt) / 36000)) trace.push({ h: +(t / 3600).toFixed(1), rank: Math.round(st.rank), bo: st.bo, str: person.skills.strength, agi: person.skills.agility })
  }
  const done = st.bo >= BLACK_OPS.length
  return {
    hours: done ? t / 3600 : null,
    joinH,
    rank: st.rank,
    blackOps: st.bo,
    installs,
    simulacrum: simOn,
    levels: st.levels,
    stats: { ...person.skills },
    cities,
    trace,
    why: done ? null : `not finished in ${s0.maxH ?? 400}h (rank ${Math.round(st.rank)}, ${st.bo}/21 black ops)`,
  }
}

/** The sleeve fleet's Bladeburner configurations worth comparing, for n sleeves. */
export function sleeveConfigs(n) {
  const out = [{ infiltrate: 0, support: 0, fa: 0 }]
  for (let k = 1; k <= n; k++) {
    out.push({ infiltrate: k, support: 0, fa: n - k })
    if (k < n) out.push({ infiltrate: k, support: n - k, fa: 0 })
  }
  out.push({ infiltrate: 0, support: n, fa: 0 }, { infiltrate: 0, support: 0, fa: n })
  const seen = new Set()
  return out.filter((c) => {
    const k = `${c.infiltrate}|${c.support}|${c.fa}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * The sleeves' Bladeburner assignment, priced as exits: every configuration
 * simulated to the 21st black op from the same state, the fastest kept
 * (CLAUDE.md "Decisions compare simulated trajectories"). Returns
 * { config, hours, byConfig: [{config, hours}] }.
 */
export function chooseSleeveConfig(s0, n, pol = POLICY) {
  return drain(chooseSleeveConfigGen(s0, n, pol))
}
export function* chooseSleeveConfigGen(s0, n, pol = POLICY) {
  const byConfig = []
  for (const config of sleeveConfigs(n)) byConfig.push({ config, hours: (yield* bladeExitGen({ ...s0, sleeves: config }, pol)).hours })
  const ok = byConfig.filter((x) => x.hours !== null)
  ok.sort((a, b) => a.hours - b.hours)
  return { config: ok[0]?.config ?? null, hours: ok[0]?.hours ?? null, byConfig }
}

/** A sleeve config as per-sleeve tasks (sleeve index order): infiltrate first, then support, then field analysis. */
export function sleeveTasksOf(config, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    if (i < config.infiltrate) out.push({ kind: 'bladeburner', action: SLEEVE_ACTION.infiltrate })
    else if (i < config.infiltrate + config.support) out.push({ kind: 'bladeburner', action: SLEEVE_ACTION.support })
    else if (i < config.infiltrate + config.support + config.fa) out.push({ kind: 'bladeburner', action: GENERAL.fieldAnalysis })
    else out.push(null)
  }
  return out
}

/**
 * The exit model's start, from what the stack publishes: /tel/bladeburner.txt
 * (`tel`, the daemon's reads of the game) and the player. One builder for the
 * plan's route decision, sleeve.js's fleet choice and the tests (CLAUDE.md
 * "Same inputs, one builder").
 *
 *   person   {skills, exp, mults} with LEVEL mults including the node's (progress.js levelledPerson)
 *   sleeves  {infiltrate, support, fa}
 *   install  {firstH, everyH?, combatGain?, gains?, simulacrum?} | null — an install of the plan's (bladeExitGen header)
 *   simulacrum  The Blade's Simulacrum already installed
 */
export function bladeStartOf({ tel = null, person, sleeves = {}, install = null, gymExpPerSec, bnRank = 1, skillCostMult = 1, simulacrum = false, maxH = 400, dt = 300 }) {
  const joined = tel?.joined === true
  const num = (x) => typeof x === 'number' && isFinite(x)
  return {
    person: { skills: { ...person.skills }, exp: { ...(person.exp ?? {}) }, mults: { ...person.mults } },
    int: person.skills?.intelligence ?? 0,
    joined,
    rank: joined && num(tel.rank) ? tel.rank : 0,
    maxRank: joined && num(tel.rank) ? tel.rank : 0,
    skillPoints: joined && num(tel.skillPoints) ? tel.skillPoints : 0,
    levels: joined && tel.levels ? { ...tel.levels } : {},
    blackOpsDone: joined && num(tel.blackOps?.done) ? tel.blackOps.done : 0,
    counts: joined && tel.counts ? { ...tel.counts } : undefined,
    maxLevels: joined && tel.maxLevels ? { ...tel.maxLevels } : undefined,
    cities: joined && Array.isArray(tel.cities) && tel.cities.length === CITY_NAMES.length ? tel.cities.map((c) => ({ name: c.name, pop: c.popEst, chaos: c.chaos, comms: c.comms })) : undefined,
    bnRank,
    skillCostMult,
    sleeves,
    gymExpPerSec,
    install,
    simulacrum: simulacrum === true,
    maxH,
    dt,
  }
}

// --- installs and The Blade's Simulacrum, on this route's exit ------------------

export const SIMULACRUM = "The Blade's Simulacrum"
/** The multipliers an augmentation moves on the black-op exit (bladeExitGen install.gains). */
export const BLADE_GAIN_KEYS = ['strength', 'defense', 'dexterity', 'agility', 'charisma', 'strength_exp', 'defense_exp', 'dexterity_exp', 'agility_exp', 'charisma_exp', 'bladeburner_success_chance', 'bladeburner_max_stamina', 'bladeburner_stamina_gain']

/**
 * A batch's content on the Bladeburner route: the product of each
 * augmentation's BLADE_GAIN_KEYS multipliers (statsOf(name): the game's
 * getAugmentationStats, snapshot) and whether it carries The Blade's
 * Simulacrum. Names without stats contribute nothing (named in `unpriced`).
 * Returns {gains (keys != 1 only), simulacrum, n, unpriced}.
 */
export function bladeContentOf(names, statsOf) {
  const gains = {}
  const unpriced = []
  for (const n of names ?? []) {
    let m = null
    try {
      m = statsOf(n)
    } catch {
      m = null
    }
    if (!m || typeof m !== 'object') {
      if (n !== SIMULACRUM) unpriced.push(n)
      continue
    }
    for (const k of BLADE_GAIN_KEYS) if (Number.isFinite(m[k]) && m[k] > 0 && m[k] !== 1) gains[k] = (gains[k] ?? 1) * m[k]
  }
  for (const k of Object.keys(gains)) gains[k] = +gains[k].toFixed(6)
  return { gains, simulacrum: (names ?? []).includes(SIMULACRUM), n: (names ?? []).length, unpriced }
}

/**
 * The install a plan spec makes on this route (plan.js install specs):
 * {kind:'wait', waitH, blade:{gains, simulacrum}} -> one install at waitH with
 * that content; 'never' or null -> none. The installs after it are the next
 * decisions' (each priced the same way), not a cadence.
 */
export function bladeInstallOfSpec(spec) {
  if (!spec || spec.kind !== 'wait') return null
  const w = Number.isFinite(spec.waitH) ? Math.max(0, spec.waitH) : 0
  return { firstH: w, gains: spec.blade?.gains ?? null, simulacrum: spec.blade?.simulacrum === true }
}

/**
 * THE BLADE'S SIMULACRUM, priced as a spend on the black-op exit
 * (Augmentations.ts:284: $150b x the node's AugmentationMoneyCost x 1.9^queued,
 * 1.25k x AugmentationRepCost Bladeburners reputation; it takes effect only
 * at an install). With it the player's work runs beside the Bladeburner
 * action (Bladeburner.ts:179, :1355): the gym trains combat in parallel
 * (bladeExitGen simulacrum) and the slot stops being one queue.
 *
 *   s0          bladeStartOf(...) of the committed trajectory, no install
 *   withoutH    the committed exit (hours from now)
 *   cost        money price now; repReq  the reputation it needs
 *   wealth      cash + equity now; moneyPerH  the node's income per hour
 *   rep         Bladeburners reputation now; repPerRank  2 x faction_rep x (1 + favor/100) (Formulas.ts:46-49)
 *   rankPerH    the rank rate (measured, else the model's)
 *   owned / queued  already installed / bought and waiting
 *
 * Reach is when BOTH money and reputation are there (linear in the measured
 * rates — reputation from rank, Bladeburner.ts:1276-1281; it resets at an
 * install, which this trajectory has none of before the purchase). The
 * exit WITH it: an install at the reach carrying it (exp reset, retrain in
 * parallel). The bound: the exit were it installed NOW at no cost (its whole
 * value on this trajectory). Returns {buy, why, reachH, moneyH, repH, withH,
 * withoutH, boundH, boundGainH, gainH, cost, repReq}.
 */
export function simulacrumVerdict(o) {
  return drain(simulacrumVerdictGen(o))
}
export function* simulacrumVerdictGen({ s0, withoutH, cost, repReq, wealth = 0, moneyPerH = 0, rep = 0, repPerRank = 0, rankPerH = 0, owned = false, queued = false } = {}) {
  const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null)
  const base = { cost: Number.isFinite(cost) ? Math.round(cost) : null, repReq: Number.isFinite(repReq) ? Math.round(repReq) : null, withoutH: r2(withoutH) }
  if (owned) return { ...base, buy: false, why: `${SIMULACRUM} is installed: the exit already runs the gym beside the actions` }
  if (queued) return { ...base, buy: false, why: `${SIMULACRUM} is bought and waits for an install: the install decision prices it (its batch carries it)` }
  if (!s0 || !Number.isFinite(withoutH)) return { ...base, buy: false, why: 'no committed Bladeburner exit to price it against' }
  const moneyH = !Number.isFinite(cost) ? Infinity : wealth >= cost ? 0 : moneyPerH > 0 ? (cost - wealth) / moneyPerH : Infinity
  const repH = !Number.isFinite(repReq) ? Infinity : rep >= repReq ? 0 : repPerRank > 0 && rankPerH > 0 ? (repReq - rep) / (repPerRank * rankPerH) : Infinity
  const reachH = Math.max(moneyH, repH)
  const bound = yield* bladeExitGen({ ...s0, install: { firstH: 0, gains: null, simulacrum: true } })
  const boundH = bound.hours
  const out = { ...base, moneyH: r2(moneyH), repH: r2(repH), reachH: r2(reachH), boundH: r2(boundH), boundGainH: Number.isFinite(boundH) ? r2(withoutH - boundH) : null }
  const money = !Number.isFinite(cost) ? 'money: the price is unread (snap-augprice)' : Number.isFinite(moneyH) ? `money in ${moneyH.toFixed(1)}h ($${(cost / 1e9).toFixed(1)}b against $${(wealth / 1e9).toFixed(3)}b at $${(moneyPerH / 1e6).toFixed(1)}m/h)` : `money never ($${(cost / 1e9).toFixed(1)}b, no income)`
  const repTxt = !Number.isFinite(repReq) ? 'reputation: the requirement is unread' : `reputation in ${Number.isFinite(repH) ? repH.toFixed(1) + 'h' : 'never'} (${Math.round(rep)} of ${Math.round(repReq)} at ${(repPerRank * rankPerH).toFixed(1)}/h)`
  if (!(reachH < withoutH)) return { ...out, buy: false, withH: null, gainH: null, why: `unreachable before the exit: ${money}, ${repTxt} — the exit is ${withoutH.toFixed(1)}h away; installed now at no cost it would be worth ${out.boundGainH ?? '?'}h` }
  const w = yield* bladeExitGen({ ...s0, install: { firstH: reachH, gains: null, simulacrum: true } })
  const withH = Number.isFinite(w.hours) ? w.hours : null
  const gainH = withH === null ? null : withoutH - withH
  const buy = gainH !== null && gainH > 0
  return { ...out, buy, withH: r2(withH), gainH: r2(gainH), why: buy ? `buy (${money}, ${repTxt}) and install at ${reachH.toFixed(1)}h: the exit ${withH.toFixed(1)}h against ${withoutH.toFixed(1)}h (${gainH.toFixed(1)}h sooner)` : `not worth it: bought at ${reachH.toFixed(1)}h and installed, the exit is ${withH === null ? 'unpriced' : withH.toFixed(1) + 'h'} against ${withoutH.toFixed(1)}h (the install's reset costs more than the parallel gym returns)` }
}
