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
import { PRIORS } from 'bayes.js'
import { OPPONENTS, POWER_PER_HOUR, effectAt, keyOfGame, nodePowerFromBonus } from 'goplan.js'

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

/**
 * THE TRUE POPULATION, READ OFF THE SHOWN RANGE. getSuccessRange
 * (Action.ts:144-167) builds the range from BOTH chances — `est` at the
 * population estimate and `real` at the true population — and then scales
 * one end by r = pop / popEst:
 *     r < 1:  [ (real - |real-est|) * r, real + |real-est| ]
 *     r > 1:  [ real - |real-est|, (real + |real-est|) * r ]
 * A black operation has no population factor (BlackOperation.ts:56-62), so
 * its real chance IS its estimated chance and its range is exactly
 * [p*r, p] or [p, p*r]: r is the ratio of the ends. Which end is p is
 * decided by the formula's chance `pEst` (the black op's whole competence is
 * known: stats, skills, int, stamina, team, augs — no city term), so the
 * side is never guessed. Returns r, or null where the range cannot say
 * (an end clamped at 0 or 1, no formula chance).
 *
 * Live 2026-10-01 13:22Z: Chongqing popEst 1.178e9, true 1.158e9 (the save);
 * Operation Typhoon showed [0.0363, 0.0370] -> r 0.981 (true 0.983 — the
 * published range is rounded to 4 places). The exit model had been pricing
 * every city at its ESTIMATE — Chongqing at 1.72e9 earlier, x1.30 on every
 * success chance — and each Field Analysis that corrected it moved the exit.
 */
export function popRatioFromRange(lo, hi, pEst) {
  if (!(lo > 0) || !(hi > 0) || !(hi < 1) || !(pEst > 0)) return null
  if (hi === lo) return 1
  // The end nearer the formula's chance is the chance itself; the other is it times r.
  return Math.abs(hi - pEst) <= Math.abs(lo - pEst) ? lo / hi : hi / lo
}
/**
 * The side without the formula: a city-dependent action's range in the same
 * city ([cLo, cHi]) is predicted exactly under each hypothesis — r < 1:
 * est = cHi, real = est r^0.7, low end (2 real - est) r; r > 1: est = cLo,
 * high end min(1, (2 real - est) r) with real clamped at 1 — and the
 * hypothesis that reproduces the shown end wins. The formula's chance
 * (popRatioFromRange) decided the side before; in the game's own classes it
 * picked the wrong side often enough to read r inverted (bbdaemon [BD5]: 407
 * of 407 attempts succeeded against 0.59 predicted). Returns r or null.
 */
export function popRatioFromRanges(boLo, boHi, cLo, cHi) {
  if (!(boLo > 0) || !(boHi > 0) || !(boHi < 1)) return null
  if (boHi === boLo) return 1
  const rIn = boLo / boHi // r < 1
  const rOut = boHi / boLo // r > 1
  if (!(cLo > 0) || !(cHi > 0) || !(cHi < 0.999)) return null
  const e = PopulationExponentOf()
  const realIn = cHi * Math.pow(rIn, e)
  const predLoIn = (2 * realIn - cHi) * rIn
  const realOut = Math.min(1, cLo * Math.pow(rOut, e))
  const predHiOut = Math.min(1, (2 * realOut - cLo) * rOut)
  const errIn = Math.abs(predLoIn - cLo) / Math.max(cLo, 1e-12)
  const errOut = Math.abs(predHiOut - cHi) / Math.max(cHi, 1e-12)
  return errIn <= errOut ? rIn : rOut
}
/**
 * A CITY WHOSE TRUE POPULATION THE RANGES CANNOT SHOW (r null). Raid,
 * Stealth Retirement and Sting move the estimate by the same COUNT as the
 * population (Bladeburner.ts:822-855 changeEstEqually), so in a city whose
 * estimate sat far below the truth every Raid drained the estimate to the 0
 * clamp while the population kept ~75%: live BN14.1 20:00Z Aevum popEst 4,
 * true ~1.5e9 with 75 communities left, and the hardest probe's range was
 * [p, 1] (r > 1/p) — unreadable. Taking popEst (4) as the truth dropped the
 * division's best city from the policy, the model and the sim alike
 * (tools/sim/bb14: 12.4h from 20:01Z on popEst, 10.7h on the true city).
 *   anchor {pop, comms}: the last read with r known; each Raid success since
 *     took 1% of the population and one community (Bladeburner.ts:832-837):
 *     pop x 0.99^(communities consumed). Failures (-0.5..-1%, uncounted) and
 *     random events are not followed: optimistic by those.
 *   no anchor: the median of the readable cities' true populations — a
 *     typical city, not an empty one.
 * Returns {pop, from} or null (nothing to go on: the estimate stands).
 */
/**
 * What our own attempts did to a city's population since its anchor
 * (Bladeburner.ts:822-855): Raid fails take 0.5-1% (mean 0.75%; its
 * successes are counted by the communities), Stealth Retirement successes
 * 0.5%, Sting successes 0.1%. n attempts, s successes. Returns the anchor moved.
 */
export const POP_SHIFT = { Raid: { fail: 0.9925 }, 'Stealth Retirement Operation': { success: 0.995 }, 'Sting Operation': { success: 0.999 } }
export function anchorAfter(anchor, name, n, s) {
  const k = POP_SHIFT[name]
  if (!anchor || !k || !(n >= 0) || !(s >= 0)) return anchor
  return { ...anchor, pop: anchor.pop * Math.pow(k.success ?? 1, s) * Math.pow(k.fail ?? 1, Math.max(0, n - s)) }
}
export function unreadPopOf(c, anchor, readablePops = []) {
  const num = (x) => typeof x === 'number' && isFinite(x)
  if (anchor && num(anchor.pop) && anchor.pop > 0) {
    const used = num(anchor.comms) && num(c.comms) ? Math.max(0, anchor.comms - c.comms) : 0
    return { pop: anchor.pop * Math.pow(0.99, used), from: 'anchor' }
  }
  const sorted = readablePops.filter((x) => num(x) && x > 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  const m = Math.floor(sorted.length / 2)
  return { pop: sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2, from: 'median' }
}
const PopulationExponentOf = () => BBC.PopulationExponent
/** The probe the daemon reads r from in every city: the hardest black op (its chance never clamps at 1). */
export const POP_PROBE = 'Operation Daedalus'

/**
 * SUCCESS CALIBRATION: a posterior on k, the factor between the success
 * chance the formula predicted and what the game rolled (p_true = min(1, k p)).
 * The formula is the game's own (Action.ts:110-137, [BB2]), so the prior is
 * tight: ln k ~ N(0, PRIOR_SD) — a stated assumption; a k away from 1 means
 * an INPUT is wrong (the population, the ENV probe, the stamina), never the
 * formula. groups: [{p, n, s}] (n attempts at predicted chance p, s
 * successes), exact binomial likelihood on a grid of ln k. Weights grow with
 * the evidence (each attempt is one Bernoulli term), so twenty attempts move
 * k little and a thousand pin it. Returns {k, lnK, sdLn, n, s, expected, why}.
 */
export const SUCCESS_CAL = { priorSdLn: 0.15, grid: 121, span: 1.2, keep: 400, maxP: 0.97 }
export function successPosterior(groups, { priorSdLn = SUCCESS_CAL.priorSdLn } = {}) {
  const G = (groups ?? []).filter((x) => x && x.p > 0 && x.p <= 1 && x.n > 0 && x.s >= 0 && x.s <= x.n)
  const n = G.reduce((a, x) => a + x.n, 0)
  const s = G.reduce((a, x) => a + x.s, 0)
  const expected = G.reduce((a, x) => a + x.n * x.p, 0)
  if (!n) return { k: 1, lnK: 0, sdLn: priorSdLn, n: 0, s: 0, expected: 0, why: `no measured attempts: the formula (k = 1, x/÷ ${Math.exp(1.2816 * priorSdLn).toFixed(2)} at 80%, stated)` }
  const N = SUCCESS_CAL.grid
  const xs = []
  const lw = []
  let mx = -Infinity
  for (let i = 0; i < N; i++) {
    const x = -SUCCESS_CAL.span + (2 * SUCCESS_CAL.span * i) / (N - 1)
    const k = Math.exp(x)
    let ll = -(x * x) / (2 * priorSdLn * priorSdLn)
    for (const g of G) {
      const q = Math.min(1 - 1e-9, Math.max(1e-9, k * g.p))
      ll += g.s * Math.log(q) + (g.n - g.s) * Math.log(1 - q)
    }
    xs.push(x)
    lw.push(ll)
    if (ll > mx) mx = ll
  }
  let W = 0
  let m1 = 0
  for (let i = 0; i < N; i++) {
    const w = Math.exp(lw[i] - mx)
    W += w
    m1 += w * xs[i]
  }
  const mean = m1 / W
  let v = 0
  for (let i = 0; i < N; i++) v += (Math.exp(lw[i] - mx) / W) * (xs[i] - mean) * (xs[i] - mean)
  const sd = Math.sqrt(v)
  return {
    k: +Math.exp(mean).toFixed(4),
    lnK: +mean.toFixed(4),
    sdLn: +sd.toFixed(4),
    n,
    s,
    expected: +expected.toFixed(2),
    why: `${s} of ${n} attempts succeeded against ${expected.toFixed(1)} predicted: k = ${Math.exp(mean).toFixed(3)} x/÷ ${Math.exp(1.2816 * sd).toFixed(2)} at 80% (prior k = 1 x/÷ ${Math.exp(1.2816 * priorSdLn).toFixed(2)}, the game's formula; exact binomial likelihood)`,
  }
}

/**
 * WHAT HAPPENED BETWEEN TWO READS, from counters the daemon already pays
 * for. Every attempt, success or failure, takes one from the action's count
 * (Bladeburner.ts:931, :978) while the count grows by growthFunction()/480
 * per second (:1386-1391) — the same distribution for every action of a
 * growth range, so an UNWORKED action with the same range (COUNT_TWIN) is
 * the worked one's clock: attempts = twin's growth - worked count's change,
 * an integer up to the growth noise (~0.1 over a minute). Successes from
 * the rank: each success pays gain(L) x U(0.9, 1.1), each failure costs
 * loss(L) x U(0.9, 1.1) (addOffset 10%; contracts lose nothing), so s is the
 * integer that explains the rank delta within the offsets. The old check
 * ("the rank moved by half a success since the attempt began") read every
 * pass that spanned several completions as ONE success — live 13:22Z it
 * published 20/20 observed against 0.66 expected while the game's own
 * counters read Retirement 21 of 36 in the same 43 minutes.
 * Returns {n, s} or {n: null, why}.
 */
export const COUNT_TWIN = { Tracking: 'Bounty Hunter', 'Bounty Hunter': 'Tracking', Retirement: 'Bounty Hunter', Investigation: 'Undercover Operation', 'Undercover Operation': 'Investigation', 'Stealth Retirement Operation': 'Assassination', Assassination: 'Stealth Retirement Operation' }
export function attemptsOf({ d, level, bnRank = 1, count0, count1, twin0, twin1, rank0, rank1 }) {
  const fin1 = (x) => typeof x === 'number' && isFinite(x)
  if (!d || d.kind === 'blackop') return { n: null, why: 'not a contract or operation' }
  if (![count0, count1, twin0, twin1, rank0, rank1].every(fin1)) return { n: null, why: 'a counter is unread' }
  const raw = twin1 - twin0 - (count1 - count0)
  const n = Math.round(raw)
  if (n < 0 || Math.abs(raw - n) > 0.35) return { n: null, why: `attempts ${raw.toFixed(2)} is not a count (the twin's growth noise, or a sleeve working either action)` }
  if (n > 40) return { n: null, why: `${n} attempts in one read: too many to attribute` }
  if (n === 0) return { n: 0, s: 0 }
  const g = rankGainOf(d, level, bnRank)
  const l = rankLossOf(d, level)
  const dR = rank1 - rank0
  const s = Math.max(0, Math.min(n, Math.round((dR + n * l) / (g + l))))
  const resid = dR - (s * g - (n - s) * l)
  const tol = 0.1 * (s * g + (n - s) * l) + 0.02 * g
  if (Math.abs(resid) > tol) return { n: null, why: `rank moved ${dR.toFixed(3)} where ${s} of ${n} explain ${(s * g - (n - s) * l).toFixed(3)} (+-${tol.toFixed(3)}): something else moved it` }
  return { n, s }
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
/** Training's permanent bonus (Bladeburner.ts:1104 staminaBonus), read back out of the game's max stamina. */
export function staminaBonusOf(person, sm, maxStamina) {
  const m = sm1(sm, MULT.stamina) * (person.mults?.bladeburner_max_stamina ?? 1)
  if (!(m > 0) || !(maxStamina > 0)) return 0
  return Math.max(0, maxStamina / m - Math.pow(effStat(person, 'agility', sm), 0.8))
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
  // THE BLACK-OP ATTEMPT IS PRICED, not thresholded (blackOpWorth, 2026-10-05):
  // attempt when the op's reward pays for its expected failures' time at the
  // best action's rank rate while rank still gates the ladder, and when the
  // remaining ladder's attempt time outruns the chance rank work buys once it
  // does not. On the game's classes from the live BN14.1 state (00:26Z,
  // rank 48k, 1/21; tools/sim/bb14/arms.mjs, 40 CRN-paired seeds): 7.82h ->
  // 7.43h (-0.40h +/- 0.04, 39/40) against the fixed 0.8 — which was no
  // optimum: 0.9 and 1.0 beat it (-0.19h, -0.13h), 0.4 lost +0.41h.
  // blackRule 'threshold' restores the fixed bar (blackThr).
  blackRule: 'priced',
  // The fixed bar ('threshold'), and still the switch of the skill objective
  // to the next black op's chance (skillScore; 0.8 vs 1.0 measured flat).
  blackThr: 0.8,
  // Stamina hysteresis (fractions of max): rest at or below restLow until restHigh.
  restLow: 0.55,
  restHigh: 0.95,
  // Sharpen the population estimate (Field Analysis) when the best candidate's shown range is wider than this.
  maxWidth: 0.1,
  // Raid multiplies chaos by 1.01-1.05 per completion (Bladeburner.ts:845);
  // stop raiding a city past this. Below the ChaosThreshold (50) chaos costs
  // nothing (Action.ts:36-45: the factor is 1), so a raid there is free of
  // chaos and the one that crosses is the last: the guard IS the threshold.
  // Measured (bb14/arms.mjs, 00:26Z state, priced black ops, 40 seeds):
  // 45 -> 50 -0.16h +/- 0.03; 48.5 -0.09h, 49 -0.13h, 51 +0.02h, 52 +0.86h,
  // 55 +1.6h — past the threshold every action in the city pays sqrt(1+c-50).
  raidChaos: 50,
  // Combat level below which (after an install reset) the player retrains before acting.
  gymTo: JOIN_COMBAT,
  // THE RETRAIN AS IT RUNS (progress.js bladeGymStep): one gym class per
  // stat short of the bar, each ordered by one progress.js pass and run by
  // act.js until the next pass sees the stat there — so a leg lasts at least
  // one pass (~300s), and the stat goes on training past the bar until then.
  // Live 2026-10-02 after the 10:10:17Z install: four legs of ~5 min each
  // (strength 10:13-10:18Z, 19 -> 247; defense, dexterity, agility to
  // 10:33Z), 0.38h with the cash bootstrap, against 0.05h for exp-to-the-bar
  // at the gym rate (the model as it was: every install 0.33h too cheap).
  retrainLegS: 300,
  // THE SKILL POLICY, re-tuned 2026-10-04 on the live BN14.1 state
  // (tools/sim/bb14/arms.mjs: the game's classes from rank 1134, 100
  // CRN-paired seeds; tools/test/fixture-bn14-bbaudit.json). Shipped before:
  // 'sum' / every 3600s / chunks 8 / the black-op objective whenever the next
  // black op was rank-eligible and short -> 28.1h to the 21st black op.
  //  - skillBlackFrom 'daedalus': the objective switches to the next black
  //    op's chance only once rank covers EVERY remaining black op (Operation
  //    Daedalus's 400k). Before that a point spent on a short black op's
  //    chance is a point not compounding rank, and rank (and the skills it
  //    buys) raises that chance anyway: -4.5h at the old cadence, and it is
  //    what made a faster cadence look harmful (2026-10-02: every point went
  //    to the black op's cheapest chance increments — 600s was +9.3h under
  //    the old switch, -6.2h without it).
  //  - every 600s, chunks 1 (each round buys the best whole-budget purchase),
  //    objective 'max' (the incumbent action's rank/s at its stamina duty):
  //    17.6h, -1.66h +/- 0.17 against 'sum'/chunks 2 at the same cadence;
  //    3600s is +1.6h. 'sum' was chosen in BN6 for the model's fit
  //    (-8..+2% vs -12..+16%); re-measured on BN14 by tools/sim/bb14/fit.mjs.
  skillBlackFrom: 'daedalus',
  skillObjective: 'max',
  // THE CADENCE SKILL POINTS ARE SPENT AT, and the chunk the greedy buys in:
  // one number for the daemon (bladeburner.js), the exit model (bladeExitGen)
  // and the game-physics sim (bbsim pol.shared), so the model prices the
  // policy the daemon runs (the greedy's path depends on it).
  skillEveryS: 600,
  skillChunks: 1,
  // Skills the planner may buy. Hands of Midas (money), Datamancer (estimate
  // accuracy only) and Hyperdrive (exp) do not enter the rank objective.
  skills: ["Blade's Intuition", 'Digital Observer', 'Short-Circuit', 'Cloak', 'Reaper', 'Evasive System', 'Overclock', 'Tracer', "Cyber's Edge"],
}

/**
 * THE SKILL POLICY EVERY LIVE RUN PLAYED BEFORE 2026-10-04 (BN4.3, BN6.1,
 * BN14.1 to ~14:30Z): the replays and calibrations of those runs price it
 * (bladeStartOf policy), since the exit model must price the policy that ran.
 */
export const POLICY_V1 = { skillBlackFrom: 'eligible', skillObjective: 'sum', skillEveryS: 3600, skillChunks: 8, blackRule: 'threshold', raidChaos: 45 }
/**
 * THE POLICY THE DAEMON PLAYED 2026-10-04 ~14:30Z to 2026-10-05 ~01:00Z (BN14.1):
 * the re-tuned skill policy (POLICY) with the fixed black-op bar (blackThr
 * 0.8) and Raid guarded at chaos 45. A replay of a capture from that window prices it.
 */
export const POLICY_V2 = { blackRule: 'threshold', raidChaos: 45 }

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
  // pol.pinTop: the action runs at its max level and no other — the game's
  // autolevel (LevelableAction.autoLevel, on by default; Bladeburner.ts:1005
  // sets level = maxLevel after every attempt). bb-lite.js leaves it on rather
  // than pay ns.bladeburner.setActionLevel (4GB): a candidate is its top level
  // when that clears minP, else not a candidate.
  if (pol.pinTop && hi < top) return null
  const sf = memoOf(v).statFac
  let best = null
  // rewardFac > difficultyFac^2 for every action (1.041/1.02^2 ... 1.14/1.06^2),
  // so rank per second rises with the level even as the chance falls; only the
  // failure loss and the whole-second time ceiling can make a lower level
  // better, and never by more than a couple of levels.
  for (let L = hi; L >= (pol.pinTop ? top : Math.max(1, hi - 2)); L--) {
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

/**
 * THE BLACK-OP ATTEMPT, PRICED (pol.blackRule 'priced'; replaces the fixed
 * blackThr). From the game's mechanics (Bladeburner.ts:1013-1090,
 * BlackOperation.ts): an attempt takes the op's action time (x1.5) and its
 * stamina whatever the roll; success pays rankGain x BladeburnerRank and
 * unlocks the next op; failure costs rankLoss (rank only: skill points follow
 * maxRank, Bladeburner.ts:1281-1290), HP (hospital money only) and team
 * members, and the op's chance does not change — a failed attempt is time.
 * So the choice is between two uses of the same seconds, priced in the
 * same unit (the best rank action's rate R at its stamina duty):
 *
 *  - RANK-GATED (some remaining op still needs more rank than we hold):
 *    the op is done either now or in the burst once rank stops gating, at a
 *    cost of ~its action time then. Now: p(G + R tau) - (1-p) L rank-seconds
 *    against R tau for the action it displaces. Attempt iff
 *        p G - (1-p) L  >=  (1-p) R tau            (tau at the op's duty)
 *    i.e. the reward must pay for the failures' time: a chance threshold
 *    p* = (R tau + L) / (G + R tau + L) that FALLS as the op's reward grows
 *    against the time it takes and RISES with the rank rate. (Black-op
 *    rewards grow ~170x from Zero to Vindictus while their time grows ~30x.)
 *  - CHANCE-GATED (rank covers every remaining op): rank work now buys only
 *    chance (skill points, rank/3 each). Doing the whole remaining ladder at
 *    competence c costs sum_j tau_j / p_j(c) seconds; one more second of
 *    rank work raises ln c by g (the best skill's d ln c per point x R/3) and
 *    cuts that cost by g x sum_{p_j<1} tau_j / p_j. Attempt iff
 *        g x A <= 1,   A = sum over the remaining ops with p < 1 of tau_j/p_j
 *    (the next op's failures also pay to regrow rank they drop below its
 *    requirement), or the rank-gated test says so.
 * NOT PRICED, named: the Go farm's chance growth (it runs during attempts
 * too: either use of the seconds gets it), combat exp (a black op's
 * attempt carries ~10x a contract's exp per second, half on failure), team
 * casualties (team bonus is (n+1)^0.05).
 * Returns {take, why, pStar?, tau, g?, A?}. The key is NOT `attempt`: the RAM
 * calculator bills any identifier named like an ns function, and `attempt`
 * is codingcontract.attempt (10GB) — it priced bb-lite-act.js at 24.6GB
 * against its 14.6GB reservation (since 7744427; [BL4], [BL8] failed).
 */
export function blackOpWorth(v, pol, R, p) {
  const bo = v.blackOp
  const d = bo.d
  const gainS = v.staminaGain ?? Infinity
  const maxS = v.maxStamina ?? 1
  const sf = memoOf(v).statFac
  const tauOf = (x) => {
    const t = actionTime(x, 1, v.person, v.sm, sf)
    return t / Math.max(1e-6, dutyOf(staminaCostOf(x, 1), t, gainS, maxS))
  }
  const fa = fieldAnalysisRank(v.bnRank ?? 1) / 30
  const r = Math.max(R ?? 0, fa)
  const G = rankGainOf(d, 1, v.bnRank ?? 1)
  const L = rankLossOf(d, 1)
  const tau = tauOf(d)
  if (p >= 1) return { take: true, why: 'certain', tau }
  if (!(p > 0)) return { take: false, why: 'no chance', tau }
  const lhs = p * G - (1 - p) * L
  const rhs = (1 - p) * r * tau
  const pStar = (r * tau + L) / (G + r * tau + L)
  if (lhs >= rhs) return { take: true, why: `reward pays its failures: p >= ${(pStar * 100).toFixed(1)}% (G ${G.toFixed(0)}, ${tau.toFixed(0)}s at ${r.toPrecision(3)} rank/s)`, pStar, tau }
  const last = BLACK_OPS[BLACK_OPS.length - 1]
  if (v.rank < last.reqdRank || pol.blackEndgame === false) return { take: false, why: `p < ${(pStar * 100).toFixed(1)}% (reward ${G.toFixed(0)} vs ${tau.toFixed(0)}s at ${r.toPrecision(3)} rank/s)`, pStar, tau }
  // Chance-gated: the ladder's attempt time against the chance rank work buys.
  const K = bo.K
  let A = 0
  for (let j = d.n; j < BLACK_OPS.length; j++) {
    const x = BLACK_OPS[j]
    const pj = pFrom(K, x, 1, v.person, v.sm)
    if (pj >= 1) continue
    if (!(pj > 0)) return { take: false, why: `op ${j + 1} has no chance yet`, pStar, tau }
    let t = tauOf(x) / pj
    if (j === d.n) t += (1 / pj - 1) * (Math.max(0, x.rankLoss - (v.rank - x.reqdRank)) / r)
    A += t
  }
  // g: the best skill's d ln(competence) per point on the hardest op, x the points rank work earns per second.
  const cm = v.skillCostMult ?? 1
  const cOf = (sm) => coreOf(last, v.person, sm) * chanceMultOf(last, sm)
  const c0 = cOf(v.sm)
  let best = 0
  for (const name of pol.skills ?? []) {
    const lvl = v.levels?.[name] ?? 0
    if (lvl >= SKILLS[name].maxLvl) continue
    const cost = skillCost(name, lvl, 1, cm)
    const c1 = cOf(skillMultsOf({ ...(v.levels ?? {}), [name]: lvl + 1 }))
    const x = Math.log(c1 / c0) / cost
    if (x > best) best = x
  }
  const g = (best * r) / BBC.RanksPerSkillPoint
  if (g * A <= 1) return { take: true, why: `the ladder's ${(A / 3600).toFixed(2)}h of attempts outruns the chance rank work buys (${(g * 3600 * 100).toFixed(1)}%/h): g A ${(g * A).toFixed(2)} <= 1`, pStar, tau, g, A }
  return { take: false, why: `rank work buys ${(g * 3600 * 100).toFixed(1)}%/h of chance against ${(A / 3600).toFixed(2)}h of attempts: g A ${(g * A).toFixed(2)} > 1`, pStar, tau, g, A }
}

/** Which action next. Returns { type, name, level?, city?, why, ev, p, blackOp? }. */
export function chooseAction(v, pol = POLICY) {
  const held = {}
  const pick = chooseActionOf(v, pol, held)
  // A rank-eligible black op the priced rule holds: its verdict rides on the pick (bladeburner.js publishes it).
  if (held.w && !pick.blackOp) pick.blackHeld = held.w
  return pick
}
function chooseActionOf(v, pol, held) {
  const gen = (name, why, city = v.city ?? null) => ({ type: TYPE.general, name, why, city })
  if (v.resting) return gen(GENERAL.regen, `stamina ${fmt(v.stamina)}/${fmt(v.maxStamina)}: resting to ${pol.restHigh * 100}%`)
  const bo = v.blackOp
  // THE BEST RANK ACTION, at its stamina duty (below): also the black op's opportunity cost.
  const duty = (b) => dutyOf(staminaCostOf(b.a.d, b.L), b.t, v.staminaGain ?? Infinity, v.maxStamina ?? 1)
  let best
  if (bo && v.rank >= bo.d.reqdRank) {
    const p = pFrom(bo.K, bo.d, 1, v.person, v.sm)
    if (pol.blackRule === 'priced') {
      best = bestOver(v, pol, duty)
      const w = blackOpWorth(v, pol, best ? best.score : 0, p)
      if (w.take) return { type: TYPE.blackOp, name: bo.d.name, city: v.city ?? null, why: `black op ${bo.d.n + 1}/21 at ${(p * 100).toFixed(1)}%: ${w.why}`, p, blackOp: true, worth: w }
      held.w = { ...w, p }
    } else if (p >= pol.blackThr) return { type: TYPE.blackOp, name: bo.d.name, city: v.city ?? null, why: `black op ${bo.d.n + 1}/21 at ${(p * 100).toFixed(1)}% (>= ${pol.blackThr * 100}%)`, p, blackOp: true }
  }
  // RANK PER WALL SECOND, not per acting second: stamina binds (live BN6: the
  // player acts ~42% of the time and rests the rest), so an action is worth
  // its EV rank/s times the share of time its stamina drain lets it run
  // (dutyOf, the chamber resting the remainder) — the objective skillScore
  // already prices. Live 13:22Z (Chongqing, true population): Tracking L18
  // 0.040 rank/s acting, duty 0.33 (it drains 0.092 stamina/s) -> 0.0133;
  // Retirement L10 0.0285, duty 0.42 -> 0.0121: a 40% lead acting is a 10%
  // lead per wall second, and an action that drains less can overtake.
  if (best === undefined) best = bestOver(v, pol, duty)
  if (best && (best.city.chaos ?? 0) > BBC.ChaosThreshold) return gen(GENERAL.diplomacy, `chaos ${fmt(best.city.chaos)} > ${BBC.ChaosThreshold} in ${best.city.name ?? 'the best city'}`, best.city.name ?? null)
  if (best && (best.city.name ?? null) === (v.city ?? null) && (best.a.width ?? 0) > pol.maxWidth) return gen(GENERAL.fieldAnalysis, `${best.a.d.name}'s shown range is ${((best.a.width ?? 0) * 100).toFixed(0)}% wide: sharpen the estimate`)
  if (best) return { type: typeOf(best.a.d), name: best.a.d.name, level: best.L, city: best.city.name ?? null, p: best.p, ev: best.ev, why: `${best.a.d.name} L${best.L} in ${best.city.name ?? 'this city'} at ${(best.p * 100).toFixed(0)}%: ${best.ev.toPrecision(3)} rank/s acting, ${best.score.toPrecision(3)} at its stamina duty` }
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

/**
 * The objective a skill purchase is scored on: steady rank/s with the stamina
 * duty, or the next black op's chance while it is short and rank-eligible —
 * under skillBlackFrom 'daedalus' only once rank covers the last black op
 * (POLICY note), under 'eligible' (the BN6-era rule) as soon as the next one is.
 */
export const blackFromRankOf = (pol = POLICY) => (pol.skillBlackFrom === 'daedalus' ? BLACK_OPS[BLACK_OPS.length - 1].reqdRank : Number.isFinite(pol.skillBlackFrom) ? pol.skillBlackFrom : 0)
export function skillScore(v, pol = POLICY) {
  const bo = v.blackOp
  if (bo && v.rank >= bo.d.reqdRank) {
    const p = pFrom(bo.K, bo.d, 1, v.person, v.sm)
    // skillBlackNear: a short black op within this much of the bar takes the objective whatever the rank.
    const near = Number.isFinite(pol.skillBlackNear) && p >= pol.blackThr - pol.skillBlackNear
    if (p < (pol.skillBlackThr ?? pol.blackThr) && (v.rank >= blackFromRankOf(pol) || near)) return { kind: 'blackop', v: p }
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
  return drain(planSkillsGen(v, sp, pol, skillCostMult, chunks))
}
/**
 * planSkills as a generator: it yields after every candidate skill priced
 * (each a skillScore over every action), so a caller's pacer can slice it.
 * Live 2026-10-02 00:17Z sleeve.js held the page 12.9s pricing its fleet:
 * one exit-model step carried a whole skill plan (60 rounds x 9 skills).
 */
export function* planSkillsGen(v, sp, pol = POLICY, skillCostMult = 1, chunks = 20) {
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
      let cost = skillCost(name, lvl, k, skillCostMult)
      if (cost > sp) {
        // Not affordable now: priced at its next level all the same — the
        // best value per point may be worth SAVING for (below).
        k = 1
        cost = skillCost(name, lvl, 1, skillCostMult)
      }
      if (!(cost > 0)) continue
      const s1 = skillScore(withLevels(cur, { ...levels, [name]: lvl + k }), pol)
      const gain = s1.kind === base.kind ? s1.v - base.v : s1.kind === 'rank' ? Infinity : -Infinity
      const val = (base.v > 0 ? gain / base.v : gain) / cost
      if (!pick || val > pick.val) pick = { name, k, cost, val }
      yield
    }
    // SAVE FOR THE BEST VALUE PER POINT. Spending whatever fits as soon as
    // it fits (the daemon plans every minute it holds a point) bought the
    // cheap skills one point at a time and never reached a dearer one with
    // more rank per point — the exit model, planning hourly, bought
    // differently, so the model did not simulate the daemon (24.6h hourly vs
    // 28.3h planned every 5 minutes, live 13:22Z state). Banking for the
    // best ratio makes the purchases the same whatever the cadence.
    if (pick && pick.val > 0 && pick.cost > sp) break
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
//   goCombat {effect, nodes, perHour, power, goPower, sf14}
//                                     THE GO FARM'S COMBAT CHANNEL (bladeGoCombatOf; Tetrads,
//                                     Go/effects/effect.ts:16-22 x the four combat LEVEL mults): `effect`
//                                     is the part of person.mults the farm holds now, growing as
//                                     effect(nodes + perHour x t), and ZEROED at an install
//                                     (Go/Go.ts:34-47 nodePower = 0): the install divides it out and the
//                                     farm regrows from 0. Absent: the multipliers as they are, for ever
//                                     (live BN14.1 2026-10-04 10:22Z: the actor carried the farm's x2.61
//                                     through its install, the new life froze its x1.0 for 80h — EXIT
//                                     JUMP AT INSTALL +46.8h, tools/sim/exitjump/replay-bn14-1022.mjs).
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
/**
 * THE RETRAIN AS THE POLICY RUNS IT (POLICY.retrainLegS, progress.js
 * bladeGymStep): one gym leg per combat stat short of `target`, each at least
 * one pass long, the stat training on past the bar until the leg ends.
 * gymExpPerSec is the exp STRENGTH gains per second at the gym with the
 * strength_exp multiplier refExpMult (the quantity bodyplan measured live,
 * 37.661/s 2026-09-19); a stat trains at it x its own exp multiplier over
 * refExpMult (calculateClassEarnings: the same class gain x the stat's
 * mult), so a batch's exp multipliers speed the retrain after its install.
 * person.mults: LEVEL mults (strength..agility) and *_exp. Returns
 * {secs, exp} (exp: the person's after the retrain); secs Infinity with no
 * gym rate and a stat short.
 */
export function retrainOf(person, gymExpPerSec, refExpMult, target, pol = POLICY) {
  const legS = Number.isFinite(pol.retrainLegS) && pol.retrainLegS > 0 ? pol.retrainLegS : 0
  const exp = { ...person.exp }
  let secs = 0
  for (const c of ['strength', 'defense', 'dexterity', 'agility']) {
    const want = expForLevel(target, person.mults[c] ?? 1)
    const have = exp[c] ?? 0
    if (have >= want) continue
    const r = (gymExpPerSec ?? 0) * ((person.mults[`${c}_exp`] ?? 1) / (refExpMult || 1))
    if (!(r > 0)) return { secs: Infinity, exp: person.exp }
    const sd = Math.max((want - have) / r, legS)
    exp[c] = have + r * sd
    secs += sd
  }
  return { secs, exp }
}
export const CITY_NAMES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven']
const EVENT_MEAN_S = 420 // getRandomIntInclusive(240, 600)

/**
 * ONE RANDOM EVENT, drawn as the game draws it (Bladeburner.ts:602-698
 * randomEvent; :565-588 triggerMigration; City.ts changePopulationByCount and
 * BasePopGrowth below PopGrowthCeiling). cities: [{pop, comms, chaos}],
 * mutated; rng: uniform [0, 1). The exit model carries these in expectation
 * (cityTick); this is what the expectation is checked against, and what the
 * unread cities' prior is built from (CITY_PRIOR).
 */
export const CITY_PRIOR_AGES = [0, 1, 2, 4, 6, 8, 12, 16, 24, 36, 48, 72, 96]
/**
 * THE SIX CITIES NOBODY HAS READ, at the division's age (hours since it was
 * created). Generated by tools/sim/bbcityprior.mjs from the game's mechanics
 * (City.ts's start, drawCityEvent once per U{240..600}s, no actions), 4000
 * seeds; [BB-CP] regenerates it. Per rank by population: the population at
 * the MEAN success factor (pop^0.7, Action.ts getPopulationSuccessFactor),
 * the mean communities and chaos. The random events spread the populations
 * (migrations, +8..24% / -8..20% swings), so the best city grows well past
 * the start's 1.5e9 bound: 2.11e9 at 6h, 3.36e9 at 24h.
 */
export const CITY_PRIOR = [
  { ageH: 0, pop: [1.427, 1.356, 1.284, 1.213, 1.141, 1.072], comms: [76.9, 77.7, 77.8, 77.2, 79.1, 76], chaos: [0, 0, 0, 0, 0, 0] },
  { ageH: 1, pop: [1.596, 1.414, 1.301, 1.204, 1.106, 0.974], comms: [78.3, 77.5, 78.1, 78, 76.9, 76.4], chaos: [0.27, 0.26, 0.27, 0.25, 0.26, 0.27] },
  { ageH: 2, pop: [1.721, 1.477, 1.326, 1.205, 1.08, 0.908], comms: [77.8, 78.7, 78.9, 77.6, 76.3, 76.2], chaos: [0.47, 0.47, 0.47, 0.48, 0.49, 0.47] },
  { ageH: 4, pop: [1.932, 1.581, 1.375, 1.206, 1.04, 0.834], comms: [77.7, 79.4, 78.2, 77.3, 76.4, 77.3], chaos: [0.77, 0.78, 0.75, 0.78, 0.74, 0.79] },
  { ageH: 6, pop: [2.11, 1.665, 1.412, 1.211, 1.019, 0.795], comms: [78.3, 78.7, 78.8, 77.5, 76.7, 77.2], chaos: [0.98, 1.04, 1.04, 1.03, 1, 0.99] },
  { ageH: 8, pop: [2.269, 1.746, 1.454, 1.229, 1.014, 0.766], comms: [78.8, 79, 77.3, 78.7, 77.6, 76.6], chaos: [1.25, 1.2, 1.27, 1.26, 1.23, 1.19] },
  { ageH: 12, pop: [2.546, 1.898, 1.545, 1.272, 1.023, 0.746], comms: [79.4, 79.8, 78.1, 78.4, 77.8, 76.4], chaos: [1.66, 1.68, 1.67, 1.66, 1.63, 1.66] },
  { ageH: 16, pop: [2.808, 2.046, 1.636, 1.334, 1.06, 0.753], comms: [79.6, 80.5, 79.3, 78.5, 77.6, 76], chaos: [2.1, 2.12, 2.05, 2.15, 2.06, 2.1] },
  { ageH: 24, pop: [3.355, 2.345, 1.846, 1.472, 1.152, 0.809], comms: [80.8, 80.4, 80.6, 78.2, 78.1, 76.9], chaos: [3.05, 3.06, 3.14, 3.02, 3.1, 2.93] },
  { ageH: 36, pop: [4.114, 2.846, 2.224, 1.761, 1.361, 0.942], comms: [82, 81.2, 81.3, 79.6, 78.5, 77.5], chaos: [4.82, 5.05, 5.1, 4.96, 4.83, 4.72] },
  { ageH: 48, pop: [4.979, 3.468, 2.686, 2.124, 1.641, 1.123], comms: [83.2, 81.8, 80.3, 80.9, 79.2, 79.9], chaos: [7.43, 7.63, 7.52, 7.73, 7.56, 7.64] },
  { ageH: 72, pop: [7.386, 5.053, 3.893, 3.087, 2.382, 1.624], comms: [84, 83.9, 82.8, 82.6, 81.9, 80.4], chaos: [17.55, 17.46, 18.35, 17.8, 16.95, 17.72] },
  { ageH: 96, pop: [10.747, 7.421, 5.694, 4.507, 3.468, 2.372], comms: [86.8, 85.4, 85, 84.1, 83, 81.6], chaos: [40.1, 43.21, 39.75, 38.92, 40.29, 41.3] },
]
/** cityPriorOf(ageH): six cities {name, pop, comms, chaos}, log-linear in age between CITY_PRIOR rows (held at the last). */
export function cityPriorOf(ageH = 0) {
  const a = Number.isFinite(ageH) && ageH > 0 ? ageH : 0
  let i = 0
  while (i < CITY_PRIOR.length - 2 && CITY_PRIOR[i + 1].ageH <= a) i++
  const r0 = CITY_PRIOR[i]
  const r1 = CITY_PRIOR[i + 1]
  const w = Math.max(0, Math.min(1, (a - r0.ageH) / (r1.ageH - r0.ageH)))
  const lerp = (x, y) => x + (y - x) * w
  return CITY_NAMES.map((name, k) => ({ name, pop: 1e9 * Math.exp(lerp(Math.log(r0.pop[k]), Math.log(r1.pop[k]))), comms: lerp(r0.comms[k], r1.comms[k]), chaos: lerp(r0.chaos[k], r1.chaos[k]) }))
}
/**
 * THE DIVISION'S AGE, carried on /tel/bladeburner.txt (joinedAt): the record
 * before this one's, same node, keeps its time; otherwise the first record
 * that sees the division joined starts it. A daemon that starts mid-division
 * with no earlier record dates it now — too young, so the unread cities are
 * priced low (the old pessimistic default at age 0), never high.
 */
export function joinedAtOf(prev, node, joined, nowIso = new Date().toISOString()) {
  if (prev && prev.bitNode === node && typeof prev.joinedAt === 'string' && Number.isFinite(Date.parse(prev.joinedAt))) return prev.joinedAt
  return joined ? nowIso : null
}
/**
 * WHAT EVERY /tel/bladeburner.txt RECORD CARRIES from the last full read of
 * this node's division (bladeburner.js's reporter base): the division
 * persists through an install (Prestige.ts keeps Player.bladeburner), so a
 * record that does not read it — waiting on the slot, a RAM raise denied,
 * stopped — must not erase it. Live BN14.1 2026-10-04 01:32Z: after the
 * install bladeburner.js and sleeve.js were refused their RAM on the 256GB
 * home at boot; the refusal record (no bitNode, no division) replaced the
 * division read, the plan priced the next life as a division never joined
 * (176.95h at 01:37Z against the install actor's 81.97h — EXIT JUMP +95h),
 * and the relaunched daemon (01:40Z, the watchdog) found no calibration or
 * joinedAt to carry: the measured success calibration and the division's
 * age were lost, the exit still +45h at 01:52Z.
 * rec: the record to carry from (any daemon's); node: this BitNode.
 * Returns {} or the carried fields, citiesAt dating the city reads.
 */
export const DIVISION_CARRY = ['joined', 'joinedAt', 'rank', 'skillPoints', 'levels', 'stamina', 'maxStamina', 'city', 'team', 'blackOps', 'counts', 'maxLevels', 'cities', 'citiesAt', 'staminaBonus', 'successes', 'calibration', 'skillsAt']
export function divisionCarryOf(rec, node) {
  if (!rec || typeof rec !== 'object' || rec.bitNode !== node || rec.joined !== true) return {}
  const out = {}
  for (const k of DIVISION_CARRY) if (rec[k] !== undefined && rec[k] !== null) out[k] = rec[k]
  // The cities as read then: dated, so the model advances them in expectation (bladeStartOf citiesAgeH).
  // A full bladeburner.js record READ them at rec.at, whatever date it carried:
  // live BN14.1 every record from 02:49Z on carried citiesAt 02:49:33Z (the
  // carry fed itself), so each pass advanced freshly read cities by hours of
  // expected random events (6.4h at 09:14Z, growing with the wall clock) —
  // the exit 39.7h at age 0 vs 54.0h at 3h on one state.
  const fresh = rec.daemon === 'bladeburner.js' && !rec.staleSince && typeof rec.at === 'string'
  if (Array.isArray(rec.cities) && rec.cities.length && (fresh || typeof out.citiesAt !== 'string')) out.citiesAt = fresh ? rec.at : rec.staleSince ?? rec.at ?? null
  return out
}
export function drawCityEvent(cities, rng) {
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const baseGrowth = (c) => {
    if (c.pop < 1.5e9) c.pop += 100
  }
  const move = (src, dst, pct) => {
    const n = Math.round(src.pop * pct)
    src.pop = Math.max(0, src.pop - n)
    dst.pop += n
    baseGrowth(dst)
  }
  const a = Math.floor(rng() * cities.length)
  let b = Math.floor(rng() * (cities.length - 1))
  if (b >= a) b++
  const src = cities[a]
  const dst = cities[b]
  const x = rng()
  if (x <= 0.05 || (x <= 0.1 && src.comms <= 0)) {
    src.comms++
    src.pop += Math.round((src.pop * ri(10, 20)) / 100)
    baseGrowth(src)
  } else if (x <= 0.1) {
    src.comms--
    dst.comms++
    move(src, dst, ri(10, 20) / 100)
  } else if (x <= 0.3) {
    src.pop += Math.round((src.pop * ri(8, 24)) / 100)
    baseGrowth(src)
  } else if (x <= 0.5) {
    let pct = ri(3, 15) / 100
    if (rng() < 0.05 && src.comms > 0) {
      pct *= ri(2, 4)
      src.comms--
      dst.comms++
    }
    move(src, dst, pct)
  } else if (x <= 0.7) src.chaos = (src.chaos + 1) * (1 + ri(5, 20) / 100)
  else if (x <= 0.9) src.pop = Math.max(0, src.pop - Math.round((src.pop * ri(8, 20)) / 100))
}

/** The exit model, drained synchronously (the tests, bb6.mjs, bbsim checks). */
// --- sleeves on contracts (the train-then-contract fleet) -----------------
//
// A sleeve may take CONTRACTS (never operations: SleeveBladeburnerWork's
// actionId is General | Contract) and its successes pay the SHARED division:
// completeAction(sleeve, id, isPlayer=false) -> changeRank (Bladeburner.ts
// :951, :1266), so they buy rank, skill points, max levels and deplete the
// shared counts like the player's. It rolls the game's own chance with the
// SLEEVE as the person (Action.ts getSuccessChance: its stats, its
// intelligence, its bladeburner_success_chance) in the PLAYER's city
// (getCurrentCity) at the division's stamina penalty, and costs no stamina
// (isPlayer false). Its exp is paid x its shockBonus and shared out
// (Work.ts applySleeveGains): to the player x its sync, to every other
// sleeve x its sync x the receiver's shockBonus. Before contracts a sleeve
// may RECOVER shock (SleeveRecoveryWork 0.0002/cycle on top of the passive
// 0.0001, x intBonus — Sleeve.ts:270) and TRAIN at the gym
// (calculateClassEarnings: expMult x the stat's exp mult per second, x
// shockBonus; a shock-100 sleeve gains nothing). Augmentations need shock 0
// (Sleeve.ts:357) and are not priced here.
// NOT SIMULATED, named: a failed contract's HP damage (a sleeve at 0 HP is
// shocked +0.5 — optimistic), gym fees and the travel to Sector-12 (~$12k/s
// for five, $200k each — negligible against any Bladeburner node's money).
export const SLEEVE_BB = { gymExpPerSec: 10, passiveShockPerS: 0.0005, recoveryShockPerS: 0.001, fresh: { shock: 100, sync: 100, int: 0 } }
const COMBAT = ['strength', 'defense', 'dexterity', 'agility']
const CONTRACT_LIST = Object.values(CONTRACTS)
// The weight a stat carries over the three contracts (the gym's greedy target).
const CONTRACT_W = Object.fromEntries(COMBAT.map((c) => [c, CONTRACT_LIST.reduce((a, d) => a + d.weights[STATS.indexOf(c)], 0)]))
/** A sleeve body for the exit model from ns.sleeve.getSleeve (or a fresh node's: shock 100, skills 1). */
export function sleeveBodyOf(s = null) {
  const f = SLEEVE_BB.fresh
  const skills = { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: f.int, ...(s?.skills ?? {}) }
  return {
    ...(Number.isFinite(s?.i) ? { i: s.i } : {}),
    shock: Number.isFinite(s?.shock) ? s.shock : f.shock,
    sync: Number.isFinite(s?.sync) ? s.sync : f.sync,
    skills,
    exp: { strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0, ...(s?.exp ?? {}) },
    mults: { ...(s?.mults ?? {}) },
  }
}
const sbOf = (b) => Math.max(0, (100 - b.shock) / 100)
const relevelBody = (b) => {
  for (const c of [...COMBAT, 'charisma']) b.skills[c] = levelFromExp(b.exp[c] ?? 0, b.mults[c] ?? 1)
}
/** The stat a training sleeve takes next: the largest gain in the contracts' weighted competence per exp. */
export function sleeveGymStatOf(b) {
  let best = 'dexterity', bv = -1
  for (const c of COMBAT) {
    const m = b.mults[c] ?? 1
    const L = Math.max(1, b.skills[c] ?? 1)
    // dLevel/dExp = 32 m / (exp + 534.6); d(L^0.91)/dL = 0.91 L^-0.09
    const v = (CONTRACT_W[c] * 0.91 * Math.pow(L, -0.09) * 32 * m * (b.mults[`${c}_exp`] ?? 1)) / ((b.exp[c] ?? 0) + 534.6)
    if (v > bv) { bv = v; best = c }
  }
  return best
}
/** The contracts' weighted combat level of a sleeve body (the gym's target measure). */
export function sleeveContractLevelOf(b) {
  let a = 0, w = 0
  for (const c of COMBAT) {
    a += CONTRACT_W[c] * (b.skills[c] ?? 1)
    w += CONTRACT_W[c]
  }
  return a / w
}
/**
 * What a contract sleeve does now, by its state: 'recover' while its shock is
 * above cfg.recoverTo (absent: never), 'train' while its contract-weighted
 * combat level is below cfg.trainTo (absent: never), else 'contract'.
 */
export function sleevePhaseOf(b, cfg = {}) {
  if (Number.isFinite(cfg.recoverTo) && b.shock > cfg.recoverTo) return 'recover'
  if (Number.isFinite(cfg.trainTo) && sleeveContractLevelOf(b) < cfg.trainTo && sbOf(b) > 0) return 'train'
  return 'contract'
}
/**
 * The best contract for a sleeve now: max p x rank / time over the counts
 * left. THE LEVEL IS THE ACTION'S, shared with the player (LevelableAction
 * .level; a sleeve has no level of its own), and bladeburner.js sets every
 * contract to its MAX level on each read pass (bladeburner.js
 * setActionLevel(maxLevel), autolevel off) — so a sleeve rolls at the max
 * level (atMax, the default) unless the daemon is changed to hold a
 * sleeve's level; atMax false: the best level up to the max.
 */
export function sleeveContractOf(b, sm, { int, augMult = 1, cityF = 1, counts, maxL, bnRank = 1, atMax = true }) {
  const e = { int, stamina: 1, maxStamina: 1, augMult }
  let best = null
  const sf = statFacOf(b, sm)
  for (const d of CONTRACT_LIST) {
    if (!((counts[d.name] ?? 0) >= 1)) continue
    const K = envOf(d, e) * cityF
    for (let L = Math.max(1, maxL[d.name] ?? 1); L >= 1; L--) {
      const p = pFrom(K, d, L, b, sm)
      const tt = actionTime(d, L, b, sm, sf)
      const r = (p * rankGainOf(d, L, bnRank) - (1 - p) * rankLossOf(d, L)) / tt
      if (!best || r > best.r) best = { d, L, p, tt, r }
      if (atMax || p >= 1) break // atMax: the action's level; p 1: every lower level is surer but pays less
    }
  }
  return best
}

export function bladeExit(s0, pol = POLICY) {
  return drain(bladeExitGen(s0, pol))
}

/** The exit model as a generator that yields every 10 steps and after each skill plan (a few ms of work), for the plan's pacer and sleeve.js. */
export function* bladeExitGen(s0, pol = POLICY) {
  // s0.policy: the policy as the daemon RAN it (bladeStartOf policy) — a replay of an older run prices its own policy.
  if (s0.policy) pol = { ...pol, ...s0.policy }
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
    boRank: 0,
    counts: {},
    maxL: {},
    succ: {},
  }
  // THE DIVISION'S AGE (s0.divisionAgeH, bladeStartOf from tel.joinedAt):
  // what an unread input is priced at. An action's count the daemon did not
  // read (bb-lite never reads Raid's) is its start's mean plus its growth
  // since (LevelableAction.ts:40, Bladeburner.ts:1386-1391) — it was 75.5
  // (the start alone) while the live Raid count stood at ~200.
  const ageS = Number.isFinite(s0.divisionAgeH) && s0.divisionAgeH > 0 ? s0.divisionAgeH * 3600 : 0
  for (const d of LEVELED) {
    st.counts[d.name] = s0.counts?.[d.name] ?? (d.minCount + d.maxCount) / 2 + ((d.growth[0] + d.growth[1]) / 2 / BBC.ActionCountGrowthPeriod) * ageS
    st.maxL[d.name] = s0.maxLevels?.[d.name] ?? 1
    // The successes behind the max level: published by the daemon when it
    // has them, else the least the level implies (successesNeeded at the
    // level below — LevelableAction.ts:38-40). 0 made every level-up wait
    // for a whole level's worth again (live: Tracking at max level 18 with
    // 198 successes needs 207 for 19, not 207 more).
    st.succ[d.name] = s0.successes?.[d.name] ?? (st.maxL[d.name] > 1 ? successesNeeded(st.maxL[d.name] - 1, perLevelOf(d)) : 0)
  }
  // Unknown cities (bb-lite reads none): the six at the division's age
  // (cityPriorOf — the game's start and its random events, per rank by
  // population: the policy stands in the best of six). They were the
  // START's order statistics (1.07-1.43e9) at any age: live BN4 at 6.8h the
  // true six were 1.19-2.69e9, and every bb-lite-era exit was priced on
  // cities 30-90% too small (the forecast fell 2.5h per hour until the full
  // daemon published the true ones; tools/sim/bbcal4.mjs).
  const cities = (s0.cities?.length ? s0.cities : cityPriorOf(ageS / 3600)).map((c) => ({ ...c }))
  const sl = s0.sleeves ?? {}
  let inf = sl.infiltrate ?? 0
  let sup = sl.support ?? 0
  let fa = sl.fa ?? 0
  // SLEEVES ON CONTRACTS (sleeveContractOf; sl.contracts of them, the
  // bodies of s0.sleeveBodies at the positions sleeveTasksOf gives them —
  // after the infiltrators, supporters and analysts, in sleeve index order;
  // a fresh node's body where none is given), each by its own STATE (sleevePhaseOf — the rule sleeve.js runs,
  // so a re-decision every pass does not restart a clock): recover shock
  // above sl.recoverTo, train at the gym below sl.trainTo, else the best contract.
  let csN = Math.max(0, Math.floor(sl.contracts ?? 0))
  let csCfg = { recoverTo: sl.recoverTo, trainTo: sl.trainTo }
  const allBodies = (Array.isArray(s0.sleeveBodies) ? s0.sleeveBodies : []).map((b) => sleeveBodyOf(b)).sort((a, b) => (a.i ?? 0) - (b.i ?? 0))
  let bodies = []
  const pickBodies = () => {
    const off = inf + sup + fa
    while (allBodies.length < off + csN) allBodies.push(sleeveBodyOf(null))
    bodies = allBodies.slice(off, off + csN)
    for (const b of bodies) relevelBody(b)
  }
  const csRank = { rank: 0, contracts: 0, trainS: 0 }
  // SleeveInfiltrateWork: each of n sleeves adds n^-0.5/2 to every count per 60s (Bladeburner.ts:1252-1264).
  let infPerSec = inf > 0 ? (inf * (Math.pow(inf, -0.5) / 2)) / 60 : 0
  pickBodies()
  const growthPerSec = (d) => (d.growth[0] + d.growth[1]) / 2 / BBC.ActionCountGrowthPeriod
  // ENV measured in a reference city of population 1e9 and no chaos; each real city scales it (cityFactor).
  // CALIBRATION (bladeStartOf rankScale / successScale): the posteriors the
  // plan publishes (decisions.bladeRoute.calibration) — the success chance
  // the game rolled over the formula's, and the rank the game paid over the
  // model's own one-hour trajectory. Both 1 (the formula) until measured.
  const successScale = Number.isFinite(s0.successScale) && s0.successScale > 0 ? s0.successScale : 1
  let rankScale = Number.isFinite(s0.rankScale) && s0.rankScale > 0 ? s0.rankScale : 1
  const augSuccess = () => (person.mults.bladeburner_success_chance ?? 1) * successScale
  const env = { int: s0.int ?? 0, pop: BBC.PopulationThreshold, chaos: 0, teamCount: sup, augMult: augSuccess() }
  const bnRank = s0.bnRank ?? 1
  const costMult = s0.skillCostMult ?? 1
  let t = 0
  const trace = []
  let joinH = 0
  let installs = 0
  const gymRate = s0.gymExpPerSec ?? 0
  const startExpMult = person.mults.strength_exp ?? 1
  // THE GO FARM'S COMBAT CHANNEL (s0.goCombat, bladeGoCombatOf): goE is the
  // effect person.mults holds now; the farm grows it as effect(goN0 +
  // perHour x (t - goT0)); an install divides it out and restarts the farm at
  // 0 nodes (Go/Go.ts:34-47). Synced at each step's start, so every t jump
  // (a retrain, a black op, rest) is caught up on the next step.
  // NOT SIMULATED, named: the regrowth DURING a retrain (its legs are priced
  // on the multipliers at its start — pessimistic, alike in every arm), and
  // the farm switching opponent (it keeps the one it farms now).
  const goC = s0.goCombat && Number.isFinite(s0.goCombat.effect) && s0.goCombat.effect >= 1 ? s0.goCombat : null
  let goE = goC ? goC.effect : 1
  let goN0 = goC && Number.isFinite(goC.nodes) && goC.nodes >= 0 ? goC.nodes : 0
  let goT0 = 0
  const goRate = goC && Number.isFinite(goC.perHour) && goC.perHour > 0 ? goC.perHour : 0
  const goSync = () => {
    if (!(goRate > 0)) return
    const e = effectAt(goN0 + (goRate * Math.max(0, t - goT0)) / 3600, goC.power ?? OPPONENTS.Tetrads.power, goC.goPower ?? 1, goC.sf14 ?? 0)
    if (!(e > 0) || Math.abs(e / goE - 1) < 1e-4) return
    for (const c of ['strength', 'defense', 'dexterity', 'agility']) person.mults[c] = (person.mults[c] ?? 1) * (e / goE)
    goE = e
    relevel()
  }
  // THE RETRAIN AS THE POLICY RUNS IT (retrainOf): Infinity with no gym rate
  // (the caller refuses: a retrain it cannot price is not free).
  // THE RETRAIN'S MONEY AND TRAVEL (s0.retrainSecsOf(person, target, phase),
  // the caller's bodyplan.combatBarPlanOf on the cash, city and income of
  // that moment — 'start' this life's, 'install' the $1262 and Sector-12 an
  // install leaves): the fee floor, the crime for cash and the flight to the
  // gym's city, as the body step runs them. The retrain takes the longer of
  // that and the policy's legs (retrainOf). Live BN4.3 the body step crimed
  // between legs for want of the fee (0.55h to the bar against the model's
  // 0.33h); live BN14.1 the player stood in Ishima on a Powerhouse order.
  // Absent or unpriced: the legs alone (named in retrainWhy).
  let retrainWhy = null
  const gymTo = (target, phase) => {
    const r = retrainOf(person, gymRate, startExpMult, target, pol)
    let secs = r.secs
    if (isFinite(secs) && secs > 0 && typeof s0.retrainSecsOf === 'function') {
      let m = null
      try {
        m = s0.retrainSecsOf(person, target, phase)
      } catch (e) {
        retrainWhy = `the retrain's money threw: ${String(e).slice(0, 80)}`
      }
      if (Number.isFinite(m) && m > secs) secs = m
      else if (!Number.isFinite(m) && !retrainWhy) retrainWhy = `the retrain's money unpriced at ${phase}: the gym legs alone`
    }
    person.exp = r.exp
    relevel()
    return secs
  }
  const noGym = (when) => ({ hours: null, joinH: null, installs: 0, why: `${when}: the retrain has no gym rate (gymExpPerSec ${s0.gymExpPerSec ?? 'absent'}) — unpriced, not free` })
  relevel()
  // THE SIMULACRUM: the gym beside the action (the lowest combat stat, one class at a time).
  let simOn = s0.simulacrum === true
  const gymParallel = (secs) => {
    if (!(gymRate > 0)) return
    let low = 'strength'
    for (const c of ['defense', 'dexterity', 'agility']) if ((person.skills[c] ?? 0) < (person.skills[low] ?? 0)) low = c
    person.exp[low] = (person.exp[low] ?? 0) + gymRate * ((person.mults[`${low}_exp`] ?? 1) / startExpMult) * secs
    relevel()
  }
  let retrainIdleS = 0 // a retrain at the start: the division's world goes on meanwhile (applied below, once its helpers exist)
  if (!s0.joined) {
    const h = gymTo(JOIN_COMBAT, 'start')
    if (!isFinite(h)) return { hours: null, why: 'not in the division and no gym rate to reach combat 100' }
    t += h
    joinH = h / 3600
  } else if (!simOn) {
    // In the division but below the retrain bar (a life that began with an
    // install): the policy trains first (progress.js bladeGymStep). With no
    // gym rate this used to skip the retrain AND keep the stats it had set
    // to the bar — free stats (sleeve.js's start, whose person had no city:
    // live 2026-10-02 its fleet search priced a life at the bar for nothing).
    const h = gymTo(Math.max(JOIN_COMBAT, pol.gymTo), 'start')
    if (!isFinite(h)) return noGym('below the retrain bar')
    if (h > 0) {
      t += h
      joinH = h / 3600
      retrainIdleS = h
    }
  }
  const inst = s0.install ?? null
  const firstInstallS = inst ? (Number.isFinite(inst.firstH) ? inst.firstH : inst.everyH) : null
  let nextInstall = Number.isFinite(firstInstallS) && firstInstallS >= 0 ? firstInstallS * 3600 : Infinity
  // THE SKILL CLOCK IS THE DAEMON'S (s0.skillSinceS: seconds since its last
  // spend, bladeStartOf from /tel/bladeburner.txt skillsAt): the model's
  // hourly spends fall where the daemon's will, not at every pass's t = 0
  // (a pass spent the points the daemon holds until its next hour). Absent:
  // the daemon spends at once (a fresh process — and after each install,
  // which restarts it).
  let lastSkill = Number.isFinite(s0.skillSinceS) && s0.skillSinceS >= 0 ? -s0.skillSinceS : -Infinity
  let smKey = null
  let smNow = null
  // THE LEAN DAEMON (s0.lean: {untilH, city}): while bb-lite.js is the actor
  // (bbliteplan: LITE_POLICY — every action at its autolevel max level; the
  // division's own city, no switchCity; no Raid, it cannot read communities;
  // operations at team 0, no setTeamSize), the model runs THAT policy, then
  // the full daemon's from untilH (bladeStartOf: the handover the caller
  // expects). It priced the full daemon throughout: rank too fast while bb-lite
  // acted, and Raid's count spent from the first hour while bb-lite banked
  // every one — and in the count-bound end of the trajectory a banked Raid is
  // worth ~700 rank at level 25+ against ~60 at level 1 (tools/sim/bbcal4.mjs:
  // the exit fell 2.4-6.3h per wall hour on every bb-lite life of BN4.3).
  let leanUntilS = s0.lean && (Number.isFinite(s0.lean.untilH) || s0.lean.untilH === Infinity) ? Math.max(0, s0.lean.untilH) * 3600 : 0
  const leanPol = { ...pol, pinTop: true }
  const lean = () => leanUntilS > 0 && t < leanUntilS
  const leanCityOf = () => {
    const named = s0.lean?.city ? cities.find((c) => c.name === s0.lean.city) : null
    if (named) return [named]
    // The division's city unknown: the six's mean success factor (pop^0.7), their mean chaos.
    const f = cities.reduce((a, c) => a + popFactorOf(Math.max(0, c.pop)), 0) / cities.length
    return [{ name: null, pop: Math.pow(f, 1 / BBC.PopulationExponent) * BBC.PopulationThreshold, chaos: cities.reduce((a, c) => a + (c.chaos ?? 0), 0) / cities.length, comms: 0 }]
  }
  const polNow = () => (lean() ? leanPol : pol)
  const viewOf = () => {
    const v = viewFull()
    if (!lean()) return v
    const e = { ...env, teamCount: 0, stamina: v.maxStamina, maxStamina: v.maxStamina }
    return { ...v, __memo: null, cities: leanCityOf(), actions: v.actions.filter((a) => a.d.name !== 'Raid').map((a) => ({ ...a, K: envOf(a.d, e) })), blackOp: v.blackOp ? { ...v.blackOp, K: envOf(v.blackOp.d, e) / successScale } : null }
  }
  const viewFull = () => {
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
      person, sm, levels: st.levels, bnRank, skillCostMult: costMult, rank: st.rank, stamina, maxStamina,
      staminaGain: staminaGainOf(person, sm, maxStamina), maxStaminaBase: true, staminaBonus: st.bonus,
      ref: { pop: BBC.PopulationThreshold, chaos: 0 }, cities, city: null, resting: false, actions,
      // A BLACK OP'S CHANCE IS THE FORMULA'S, never x successScale: it has no
      // city term (BlackOperation.ts:56-62), so its shown range is the game's
      // own chance and bladeburner.js gates on exactly that number (live
      // 09:59Z 2026-10-03: Typhoon shown 0.738, deferred at blackThr 0.8,
      // while the model attempted it at 0.738 x 1.206 = 0.89). The success
      // calibration is measured on contracts and operations, whose chance
      // carries the population (the input it corrects).
      blackOp: bd ? { d: bd, K: envOf(bd, e) / successScale, width: 0 } : null,
    }
  }
  // rankScale (the rank calibration) scales every rank gain, a black op's
  // reward included. NAMED, NOT CORRECTED: the v3 windows measure k on the
  // rest (rankCalStep: a black op's reward is the game's constant,
  // Formulas.ts calculateActionRankGain), so a k away from 1 lifts that
  // constant by (k - 1) x the reward too — optimistic by that much rank.
  // Left as it was because the exit is rough in it (BN6 10:10Z, k 1.065:
  // unscaled rewards moved one install's single exit +0.9h and its
  // neighbour none — tools/test/bladejump.test.mjs BJ3/BJ7/BJ8) and the v3
  // k sits near 1, where the term vanishes. Returns the rank moved.
  const gainRank = (dr) => {
    const r0 = st.rank
    st.rank = Math.max(0, st.rank + (dr > 0 ? dr * rankScale : dr))
    if (st.rank > st.maxRank) {
      const before = totalSkillPointsAt(st.maxRank)
      st.maxRank = st.rank
      st.sp += totalSkillPointsAt(st.maxRank) - before
    }
    return st.rank - r0
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
  // s0.cityRng (a uniform [0,1) source): the game's random events DRAWN
  // (drawCityEvent) instead of carried in expectation — the tool that
  // measures what the expectation loses (tools/sim/bbcal4.mjs: from the live
  // BN4 states, drawn and expected exits agree within ~1h, either sign).
  // Absent: the expectation (the plan's model).
  const rng = typeof s0.cityRng === 'function' ? s0.cityRng : null
  let evClock = rng ? 240 + Math.floor(rng() * 361) : 0
  const cityTick = (secs) => {
    if (rng) {
      for (const c of cities) c.chaos = Math.max(0, c.chaos - 0.0001 * secs)
      evClock -= secs
      while (evClock <= 0) {
        drawCityEvent(cities, rng)
        evClock += 240 + Math.floor(rng() * 361)
      }
      return
    }
    const ev = secs / EVENT_MEAN_S / CITY_NAMES.length // expected events per city
    for (const c of cities) {
      c.chaos = Math.max(0, c.chaos - 0.0001 * secs)
      c.chaos += ev * 0.2 * (1.125 + 0.125 * c.chaos) // riots: +1 then x(1.05..1.20)
      c.comms += ev * 0.05 // a new community
      c.pop *= 1 + ev * (0.05 * 0.15 + 0.2 * 0.16 - 0.2 * 0.14) // new community / new synthoids / fewer synthoids
    }
  }
  // The contract sleeves over `secs` from the model's t, in `city` (the player's; null: the best for the chance).
  const shareOut = (from, x, k) => {
    // applySleeveGains: `x` already shocked; to the player x sync (no exp mults), to the others x sync x their shockBonus.
    const sync = from.sync / 100
    for (const c of COMBAT) {
      const g = (x[c] ?? 0) * k
      if (!(g > 0)) continue
      person.exp[c] = (person.exp[c] ?? 0) + g * sync
      for (let j = 0; j < csN; j++) if (bodies[j] !== from) bodies[j].exp[c] += g * sync * sbOf(bodies[j])
    }
  }
  const sleeveStep = (secs, city) => {
    if (!(csN > 0) || !(secs > 0)) return
    const sm = smNow ?? skillMultsOf(st.levels)
    let anyExp = false
    for (let j = 0; j < csN; j++) {
      const b = bodies[j]
      const ib = intBonus(b.skills.intelligence ?? 0)
      const phase = sleevePhaseOf(b, csCfg)
      b.shock = Math.max(0, b.shock - (SLEEVE_BB.passiveShockPerS + (phase === 'recover' ? SLEEVE_BB.recoveryShockPerS : 0)) * ib * secs)
      if (phase === 'recover') continue
      if (phase === 'train') {
        const c = sleeveGymStatOf(b)
        const g = SLEEVE_BB.gymExpPerSec * (b.mults[`${c}_exp`] ?? 1) * sbOf(b) * secs
        b.exp[c] += g
        shareOut(b, { [c]: g }, 1)
        csRank.trainS += secs
        anyExp = true
        continue
      }
      const cs = city ?? cities.reduce((a, x) => (cityFactor(x, refOf({})) > cityFactor(a, refOf({})) ? x : a), cities[0])
      const best = sleeveContractOf(b, sm, { int: b.skills.intelligence ?? 0, augMult: (b.mults.bladeburner_success_chance ?? 1) * successScale, cityF: cs ? cityFactor(cs, refOf({})) : 1, counts: st.counts, maxL: st.maxL, bnRank })
      if (!best || !(best.r > 0)) continue
      const n = Math.min(secs / best.tt, Math.max(0, st.counts[best.d.name]))
      const p = best.p
      st.counts[best.d.name] -= n
      st.succ[best.d.name] += n * p
      while (st.succ[best.d.name] >= successesNeeded(st.maxL[best.d.name], perLevelOf(best.d))) st.maxL[best.d.name]++
      csRank.rank += gainRank(n * p * rankGainOf(best.d, best.L, bnRank))
      gainRank(-n * (1 - p) * rankLossOf(best.d, best.L))
      csRank.contracts += n
      if (cs) cityEffect(cs, best.d.name, n, n * p)
      const x = actionExpOf(best.d, best.L, b, sm, true)
      const k = n * (p + (1 - p) * 0.5) * sbOf(b)
      for (const c of COMBAT) b.exp[c] += (x[c] ?? 0) * k * (b.mults[`${c}_exp`] ?? 1)
      shareOut(b, x, k)
      anyExp = true
    }
    if (anyExp) {
      for (let j = 0; j < csN; j++) relevelBody(bodies[j])
      relevel()
    }
  }
  const idle = (secs) => {
    sleeveStep(secs, null)
    for (const d of LEVELED) st.counts[d.name] += (growthPerSec(d) + infPerSec) * secs
    if (fa > 0) gainRank(fa * fieldAnalysisRank(bnRank) * (secs / 30))
    cityTick(secs)
  }
  // Cities read hours ago (s0.citiesAgeH, carried by bb-lite): the random events since, in expectation.
  if (s0.cities?.length && Number.isFinite(s0.citiesAgeH) && s0.citiesAgeH > 0) cityTick(s0.citiesAgeH * 3600)
  if (retrainIdleS > 0) idle(retrainIdleS)
  // THE STAMINA THE PLAYER HAS NOW (s0.stamina, s0.maxStamina from the
  // daemon). The steps below price stamina in expectation — the duty cycle
  // between restLow and restHigh, whose time-average is their midpoint — so
  // the start is that average plus what is banked or owed: stamina above it
  // is rest the player will not need, below it rest still to do, each at the
  // chamber's rate (passive gain + 1% of max per 60s, Bladeburner.ts:1201,
  // 1318-1326). Only where stamina binds (the best action's duty < 1). The
  // success penalty (stamina below half, Bladeburner.ts:168-170) never
  // applies on the policy's band (restLow 0.55 > 0.5), so the steps keep it 1.
  let staminaOffsetS = 0
  if (s0.joined && joinH === 0 && Number.isFinite(s0.stamina) && Number.isFinite(s0.maxStamina) && s0.maxStamina > 0 && st.bo < BLACK_OPS.length) {
    const v0 = viewOf()
    const g0 = v0.staminaGain
    const h0 = (v0.maxStamina * BBC.HrcStaminaGain) / 100 / 60
    const b0 = bestOver(v0, polNow(), (b) => dutyOf(staminaCostOf(b.a.d, b.L), b.t, g0, v0.maxStamina))
    const binds = b0 && dutyOf(staminaCostOf(b0.a.d, b0.L), b0.t, g0, v0.maxStamina) < 1
    if (binds && g0 + h0 > 0) {
      // In the game's units (s0.maxStamina is the game's; the view's may differ by Training's bonus): as a share of max.
      const frac = Math.max(0, Math.min(1, s0.stamina / s0.maxStamina))
      const mid = (pol.restLow + pol.restHigh) / 2
      staminaOffsetS = ((frac - mid) * v0.maxStamina) / (g0 + h0)
      if (staminaOffsetS < 0) {
        // Rest still owed: the chamber first; the world goes on meanwhile.
        const owe = -staminaOffsetS
        for (const d of LEVELED) st.counts[d.name] += (growthPerSec(d) + infPerSec) * owe
        cityTick(owe)
        if (fa > 0) gainRank(fa * fieldAnalysisRank(bnRank) * (owe / 30))
      }
      t -= staminaOffsetS
    }
  }
  const credit = Math.max(0, staminaOffsetS)
  const pathEvery = s0.pathEveryS > 0 ? s0.pathEveryS : 0
  const path = pathEvery ? [{ h: +((t + credit) / 3600).toFixed(4), rank: +st.rank.toFixed(3) }] : []
  let sinceYield = 0
  let snapOut = null
  // MID-TRAJECTORY STEPS (s0.steps: [{atH, rankScaleMult?, gains?, full?,
  // sleeves?}]): a change at a time that is not an install, keeping every
  // exp — the full daemon taking over from bb-lite when a home upgrade
  // admits it (full: the lean phase, s0.lean, ends), a multiplier that grows
  // with no reset (the Go farm's combat channel), the fleet changing (a
  // replay of the sleeves as they ran). homeplan.js prices the next home
  // upgrade with these. Absent: none (every other caller).
  // A step is dated in WALL hours from now: a banked-stamina credit starts
  // the model's clock at -credit (the rank path above), so a step at 0h is
  // the first step, not one that waits for the credit to be spent.
  const steps = (Array.isArray(s0.steps) ? s0.steps : []).filter((x) => Number.isFinite(x?.atH)).map((x) => ({ ...x, atS: Math.max(0, x.atH) * 3600 - credit })).sort((a, b) => a.atS - b.atS)
  let stepAt = 0
  const applySteps = () => {
    while (stepAt < steps.length && steps[stepAt].atS <= t) {
      const x = steps[stepAt++]
      if (Number.isFinite(x.rankScaleMult) && x.rankScaleMult > 0) rankScale *= x.rankScaleMult
      // The full daemon takes over (homeplan: the home tier that admits it): the lean phase ends here.
      if (x.full === true) leanUntilS = Math.min(leanUntilS, x.atS)
      // The fleet changes (a replay of the sleeves as they ran: tools/sim/bbcal4.mjs).
      if (x.sleeves) {
        inf = x.sleeves.infiltrate ?? 0
        sup = x.sleeves.support ?? 0
        fa = x.sleeves.fa ?? 0
        csN = Math.max(0, Math.floor(x.sleeves.contracts ?? 0))
        csCfg = { recoverTo: x.sleeves.recoverTo, trainTo: x.sleeves.trainTo }
        pickBodies()
        infPerSec = inf > 0 ? (inf * (Math.pow(inf, -0.5) / 2)) / 60 : 0
        env.teamCount = sup
      }
      if (x.gains) {
        for (const [k, g] of Object.entries(x.gains)) if (Number.isFinite(g) && g > 0) person.mults[k] = (person.mults[k] ?? 1) * g
        env.augMult = augSuccess()
        relevel()
      }
    }
  }
  while (t < maxS && st.bo < BLACK_OPS.length) {
    if (steps.length) applySteps()
    goSync()
    if (++sinceYield >= 2) {
      sinceYield = 0
      yield
    }
    if (t >= nextInstall) {
      // An install: combat (and every) exp to 0, the multipliers the batch bought.
      const g = inst.combatGain ?? 1
      for (const c of ['strength', 'defense', 'dexterity', 'agility']) person.mults[c] = lvMult(c) * g
      for (const [k, x] of Object.entries(inst.gains ?? {})) if (Number.isFinite(x) && x > 0) person.mults[k] = (person.mults[k] ?? 1) * x
      // The install zeroes every Go opponent's nodePower (Go/Go.ts:34-47): the farm's combat effect leaves the multipliers and regrows from 0.
      if (goC) {
        for (const c of ['strength', 'defense', 'dexterity', 'agility']) person.mults[c] = lvMult(c) / goE
        goE = 1
        goN0 = 0
        goT0 = t
      }
      env.augMult = augSuccess()
      if (inst.simulacrum === true) simOn = true
      for (const c of ['strength', 'defense', 'dexterity', 'agility', 'charisma']) person.exp[c] = 0
      relevel()
      installs++
      nextInstall = inst.everyH > 0 ? nextInstall + inst.everyH * 3600 : Infinity
      // The install restarts the daemon, and its first pass spends at once —
      // on the reset stats, before the retrain (live 2026-10-02: the 10:10:17Z
      // install, purchases at 10:10:21Z); its hourly clock starts there.
      if (st.sp >= 1) {
        for (const b of yield* planSkillsGen(viewOf(), st.sp, polNow(), costMult, s0.skillChunks ?? pol.skillChunks ?? 8)) {
          st.levels[b.name] = (st.levels[b.name] ?? 0) + b.count
          st.sp -= b.cost
        }
      }
      lastSkill = t
      if (simOn) continue // the retrain runs beside the actions (gymParallel)
      const h = gymTo(Math.max(JOIN_COMBAT, pol.gymTo), 'install')
      if (!isFinite(h)) return { ...noGym(`the install at ${(t / 3600).toFixed(2)}h`), installs }
      // The world goes on while the slot is at the gym (counts grow, sleeves infiltrate or analyse).
      idle(h)
      t += h
      continue
    }
    if (t - lastSkill >= (s0.skillEveryS ?? pol.skillEveryS ?? 3600) && st.sp >= 1) {
      for (const b of yield* planSkillsGen(viewOf(), st.sp, polNow(), costMult, s0.skillChunks ?? pol.skillChunks ?? 8)) {
        st.levels[b.name] = (st.levels[b.name] ?? 0) + b.count
        st.sp -= b.cost
      }
      lastSkill = t
      sinceYield = 0
      yield // a skill plan is the heaviest single piece of a step
    }
    if (s0.snapAtS != null && !snapOut && t >= s0.snapAtS) snapOut = structuredClone({ t, st, person, cities, levels: st.levels })
    const v = viewOf()
    // Sleeves on Field Analysis (stamina-free, always succeeds): 0.1 rank per 30s each.
    if (fa > 0) gainRank(fa * fieldAnalysisRank(bnRank) * (dt / 30))
    for (const d of LEVELED) st.counts[d.name] += (growthPerSec(d) + infPerSec) * dt
    cityTick(dt)
    const pick = chooseAction(v, polNow())
    if (s0.actTrace && s0.actTrace.length < 5000) s0.actTrace.push({ h: +(t / 3600).toFixed(3), rank: +st.rank.toFixed(1), name: pick.name, level: pick.level ?? null, p: pick.p ?? null, ev: pick.ev ?? null, why: pick.why, sp: st.sp, maxStamina: v.maxStamina, gain: v.staminaGain })
    if (pick.blackOp) {
      const d = BLACK_OPS[st.bo]
      const p = Math.max(pick.p, 1e-6)
      const tt = actionTime(d, 1, person, v.sm)
      // Expected attempts 1/p, each a full action time; failures cost rank (the stamina is rested between).
      const f = dutyOf(staminaCostOf(d, 1), tt, v.staminaGain, v.maxStamina)
      sleeveStep(tt / p / f, null)
      t += tt / p / f
      // The black op's own rank (its expected failures' losses and its reward) is kept apart on the path (bo): the rank windows measure the rest.
      st.boRank += gainRank(-((1 - p) / p) * rankLossOf(d, 1))
      st.boRank += gainRank(rankGainOf(d, 1, bnRank))
      gainExp(actionExpOf(d, 1, person, v.sm, true), 1)
      relevel()
      st.bo++
      continue
    }
    if (simOn) gymParallel(dt)
    let left = dt
    for (let k = 0; k < 3 && left > 1e-9; k++) {
      const c = k === 0 ? pick : chooseAction(viewOf(), polNow())
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
      gainRank(n * p * rankGainOf(d, c.level, bnRank))
      gainRank(-n * (1 - p) * rankLossOf(d, c.level))
      if (city) cityEffect(city, d.name, n, n * p)
      gainExp(actionExpOf(d, c.level, person, v.sm, true), n * (p + (1 - p) * 0.5))
      relevel()
      left -= Math.max(used, 1e-6)
    }
    sleeveStep(dt, cities.find((x) => x.name === pick.city) ?? null)
    t += dt
    const tEvery = s0.traceEveryS ?? 36000
    if (trace.length < 400 && Math.floor(t / tEvery) !== Math.floor((t - dt) / tEvery)) trace.push({ h: +(t / 3600).toFixed(1), rank: Math.round(st.rank), bo: st.bo, str: person.skills.strength, agi: person.skills.agility })
    // THE RANK PATH in wall hours from now (rankCalStep's prediction): a
    // banked-stamina credit moved the clock back without wall time passing.
    if (pathEvery && path.length < 400 && Math.floor((t + credit) / pathEvery) !== Math.floor((t + credit - dt) / pathEvery)) path.push({ h: +((t + credit) / 3600).toFixed(4), rank: +st.rank.toFixed(3), ...(st.boRank ? { bo: +st.boRank.toFixed(3) } : {}) })
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
    path: pathEvery ? path : undefined,
    staminaOffsetH: +(staminaOffsetS / 3600).toFixed(3),
    ...(csN > 0 ? { sleeveContracts: { rank: +csRank.rank.toFixed(1), contracts: +csRank.contracts.toFixed(1), trainH: +(csRank.trainS / 3600).toFixed(2), stats: bodies.slice(0, csN).map((b) => ({ shock: +b.shock.toFixed(1), str: b.skills.strength, def: b.skills.defense, dex: b.skills.dexterity, agi: b.skills.agility })) } } : {}),
    scales: { success: successScale, rank: rankScale },
    ...(goC ? { goEffect: +goE.toFixed(4) } : {}),
    ...(retrainWhy ? { retrainWhy } : {}),
    ...(snapOut ? { snap: snapOut } : {}),
    why: done ? null : `not finished in ${s0.maxH ?? 400}h (rank ${Math.round(st.rank)}, ${st.bo}/21 black ops)`,
  }
}

/**
 * THE MODEL'S OWN SCATTER (installgate.bladeLoopGuardOf's margin): one
 * trajectory priced at the daemon's skill-clock positions (s0.skillSinceS +
 * each offset, mod the hour) — the same state, nothing changed but when the
 * policy's hourly spend falls. The model's policy is discrete (an action
 * crosses its chance bar, a skill purchase lands an hour later), so the exit
 * moves in steps: live BN14.1 at 01:52Z 'never' read 109.9-115.4h over the
 * clock, while installs were bought on priced savings of 2.1h (01:32Z) and
 * 5.0h (02:07Z). A saving inside this spread is the clock, not the batch.
 * s0: a bladeStartOf start; offsets in seconds. Returns {spreadH, hours}.
 */
/**
 * THE EXIT AS AN EXPECTATION OVER WHAT THE START DOES NOT PIN (live BN14.1
 * 2026-10-04, tools/sim/bbcal14.mjs). The model is deterministic but ROUGH:
 * its policy is discrete (an hourly skill spend, an action crossing its
 * chance bar, a black op gated at blackThr, a level-up), and the late,
 * rank-compounding phase amplifies a 1-3% rank lead at 15h into 5h at the
 * exit. From one 09:14Z state the single exit read 36.3-48.1h over the
 * daemon's skill clock, 35.7-47.3h over success k 1.00-1.15 (non-monotone),
 * 39.7-54.0h over the cities' age 0-3h — so every pass's small drift (5 min
 * of clock, one attempt's update of k, a few stamina points) moved the
 * published point by hours with no event: exitcal X 16.7, EXIT UNSTABLE
 * 38.2 -> 47.2h in 5 min, TWO EXITS AT INSTALL 36.99 vs 43.76h.
 *
 * The exit is priced as the mean over Q MEMBERS, a fixed stratified design
 * (a Latin hypercube, the same in every pass, so it adds no pass-to-pass
 * noise of its own) over the three inputs the start carries only as an
 * estimate:
 *   - the skill clock's phase: (m + 0.5)/Q of the hour after the daemon's
 *     (its spends fall at an hour the model cannot know to the minute once
 *     an install or restart moves them);
 *   - the rank calibration k: exp(lnK + sdLn z), z the member's normal
 *     quantile — its posterior, not its point (s0.rankSdLn);
 *   - the success calibration k likewise (s0.successSdLn).
 * The plan prices the POINT as the members' mean and DRAW i on member
 * i mod Q (plan.decideBladeRouteGen, progress.js bladeInstallCompareOf), so
 * the members' spread is in the published interval, and an update of k
 * inside its own posterior moves the exit inside that interval.
 * Q: 6 measured against 4 and 8 on the BN14.1 captures (bbcal14.mjs: the
 * pass-to-pass sd of the mean 0.5-0.7h at Q 8, against 1.9-2.1h single);
 * ~32ms a member in node and in-game (sleeve.txt cpuMs).
 */
export const BLADE_ENSEMBLE = { Q: 6 }
/** Acklam's rational approximation to the standard normal quantile (|err| < 1.2e-9). */
export function normQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - lo) return -normQuantile(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}
/** Member m's strata {u, zRank, zSuccess}: a fixed permutation of the Q strata per input (a seeded shuffle, the same in every pass), so each margin is stratified and the inputs are not aligned. */
export function bladeMemberDesign(m, Q = BLADE_ENSEMBLE.Q) {
  const n = Math.max(1, Q | 0)
  const i = ((m % n) + n) % n
  const at = (salt) => {
    // The stratum member i takes on this input: its rank among n fixed hashes.
    const h = (j) => Math.imul((j + 1) ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b) >>> 0
    const hi = h(i)
    let r = 0
    for (let j = 0; j < n; j++) if (h(j) < hi || (h(j) === hi && j < i)) r++
    return (r + 0.5) / n
  }
  return { u: (i + 0.5) / n, zRank: n > 1 ? normQuantile(at(0x5b1)) : 0, zSuccess: n > 1 ? normQuantile(at(0x7c3)) : 0 }
}
/**
 * Member m of the start s0 (bladeStartOf): the skill clock moved by the
 * member's phase, the calibrations at the member's quantile of their
 * posteriors. A fresh daemon (no skillSinceS: it spends at once) keeps its
 * clock. Q 1: s0 itself.
 */
export function bladeMemberOf(s0, m, Q = BLADE_ENSEMBLE.Q) {
  if (!(Q > 1)) return s0
  const { u, zRank, zSuccess } = bladeMemberDesign(m, Q)
  const every = s0.skillEveryS ?? s0.policy?.skillEveryS ?? POLICY.skillEveryS ?? 3600
  const sd = (x) => (Number.isFinite(x) && x > 0 ? x : 0)
  const out = { ...s0 }
  if (Number.isFinite(s0.skillSinceS) && s0.skillSinceS >= 0) out.skillSinceS = (s0.skillSinceS + u * every) % every
  if (sd(s0.rankSdLn) > 0) out.rankScale = (s0.rankScale ?? 1) * Math.exp(s0.rankSdLn * zRank)
  if (sd(s0.successSdLn) > 0) out.successScale = (s0.successScale ?? 1) * Math.exp(s0.successSdLn * zSuccess)
  return out
}
/** The member a plan draw prices (draw i on member i mod Q: paired across every option and pass of the life). */
export const bladeMemberOfDraw = (d, Q = BLADE_ENSEMBLE.Q) => (Number.isFinite(d?.i) ? ((d.i % Q) + Q) % Q : null)
/**
 * The exit over the Q members: {hours: their mean (null if fewer than half
 * finish), members: [hours|null], sdH, spreadH, unfinished}. hoursOfMember(m)
 * may be supplied by a caller that memoises members (a generator returning
 * hours); default: bladeExitGen on bladeMemberOf(s0, m).
 */
export function* bladeExitMeanGen(s0, { Q = BLADE_ENSEMBLE.Q, pol = POLICY, hoursOfMember = null } = {}) {
  // Nothing to spread (no skill clock, no posterior sd): every member is s0 — one simulation.
  if (!hoursOfMember && s0 && !(Number.isFinite(s0.skillSinceS) && s0.skillSinceS >= 0) && !(s0.rankSdLn > 0) && !(s0.successSdLn > 0)) {
    const h = (yield* bladeExitGen(s0, pol))?.hours
    return bladeMeanOf(Array(Math.max(1, Q)).fill(typeof h === 'number' && isFinite(h) ? h : null))
  }
  const members = []
  for (let m = 0; m < Q; m++) {
    const h = hoursOfMember ? yield* hoursOfMember(m) : (yield* bladeExitGen(bladeMemberOf(s0, m, Q), pol))?.hours
    members.push(typeof h === 'number' && isFinite(h) ? h : null)
  }
  return bladeMeanOf(members)
}
export function bladeMeanOf(members) {
  const f = members.filter((h) => h !== null)
  if (!f.length || f.length * 2 < members.length) return { hours: null, members, sdH: null, spreadH: null, unfinished: members.length - f.length }
  const mean = f.reduce((a, b) => a + b, 0) / f.length
  const sdH = f.length > 1 ? Math.sqrt(f.reduce((a, b) => a + (b - mean) ** 2, 0) / (f.length - 1)) : 0
  return { hours: mean, members, sdH, spreadH: Math.max(...f) - Math.min(...f), unfinished: members.length - f.length }
}

export const SCATTER_OFFSETS_S = [900, 1800, 2700]
export function* bladeScatterGen(s0, offsets = SCATTER_OFFSETS_S, pol = POLICY) {
  const hours = []
  const base = Number.isFinite(s0.skillSinceS) ? s0.skillSinceS : 0
  for (const off of [null, ...offsets]) {
    const r = yield* bladeExitGen(off === null ? s0 : { ...s0, skillSinceS: (base + off) % (s0.skillEveryS ?? s0.policy?.skillEveryS ?? pol.skillEveryS ?? 3600) }, pol)
    if (typeof r?.hours === 'number' && isFinite(r.hours)) hours.push(+r.hours.toFixed(3))
  }
  return { spreadH: hours.length > 1 ? +(Math.max(...hours) - Math.min(...hours)).toFixed(3) : null, hours }
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
 * THE CONTRACT FLEETS (sleeves taking contracts, bladeExitGen sleeveStep),
 * compared beside sleeveConfigs(n). A small set: each configuration is six
 * exit members in sleeve.js's pass. Priced 2026-10-10 on the live BN7.1
 * state (13:09Z, rank 13.7k, sleeves shock 73-77 at stats 1; the mean of
 * the plan's six members, paired; tools/test/bladecontracts.test.mjs SC5
 * re-prices it on the fixture): against the incumbent five support
 * (11.2-11.3h) the best were one infiltrate with one or two sleeves on
 * contracts trained to 100: -0.13 to -0.37h (+/- 0.12-0.15) — inside the
 * fleet's keep tolerance (sleeveplan.FLEET_KEEP, 3% / 1.645 se); untrained
 * -0.13..-0.19h, four on contracts +0.1..+0.17h (they exhaust the contract
 * counts, ~3.1k over 11h), recovering to shock 50 first +0.01..+0.05h. In a
 * FRESH division (shock 100, rank 0) none beat one infiltrate / four
 * support (+0.08..+1.2h): the player's own early contracts compete for the
 * counts, and a shocked sleeve gains a quarter of its exp. Augmentations need shock
 * 0 (Sleeve.ts:357): 12.9h of recovery from 73, past this node's exit.
 * Kept in the search so a node where they pay (a long one, sleeves already
 * recovered) prices them from the start.
 */
export function sleeveContractConfigs(n) {
  if (n < 3) return []
  return [
    { infiltrate: 1, support: n - 2, fa: 0, contracts: 1, trainTo: 100 },
    { infiltrate: 1, support: n - 3, fa: 0, contracts: 2, trainTo: 100 },
    { infiltrate: 1, support: n - 2, fa: 0, contracts: 1, recoverTo: 50, trainTo: 100 },
  ]
}
/** A configuration's key (fleet events, the incumbent match): i/s/f, and c with its schedule where it has contracts. */
export const sleeveConfigKey = (c) => (c ? `i${c.infiltrate ?? 0}s${c.support ?? 0}f${c.fa ?? 0}${c.contracts > 0 ? `c${c.contracts}${Number.isFinite(c.recoverTo) ? `r${c.recoverTo}` : ''}${Number.isFinite(c.trainTo) ? `t${c.trainTo}` : ''}` : ''}` : null)

/**
 * The sleeves' Bladeburner assignment, priced as exits: every configuration
 * simulated to the 21st black op from the same state, the fastest kept
 * (CLAUDE.md "Decisions compare simulated trajectories"). Returns
 * { config, hours, byConfig: [{config, hours}] }.
 */
export function chooseSleeveConfig(s0, n, pol = POLICY, opts = {}) {
  return drain(chooseSleeveConfigGen(s0, n, pol, opts))
}
/**
 * Q (BLADE_ENSEMBLE): each configuration's exit is its members' mean, with
 * seH (their sd over sqrt(Q)) — the configurations sit within the model's
 * roughness of each other (live BN14.1 09:12Z: 32.3, 34.1, 34.2, 35.3h), and
 * a single exit each picked whichever the pass's clock favoured. Q 1: one
 * exit each (the tests' cheap path).
 */
export function* chooseSleeveConfigGen(s0, n, pol = POLICY, { Q = 1, contracts = true } = {}) {
  const byConfig = []
  for (const config of [...sleeveConfigs(n), ...(contracts ? sleeveContractConfigs(n) : [])]) {
    if (Q > 1) {
      let why = null
      const e = yield* bladeExitMeanGen({ ...s0, sleeves: config }, { Q, pol, hoursOfMember: function* (m) {
        const r = yield* bladeExitGen(bladeMemberOf({ ...s0, sleeves: config }, m, Q), pol)
        if (r.hours == null && r.why) why = r.why
        return r.hours
      } })
      byConfig.push({ config, hours: e.hours ?? null, seH: Number.isFinite(e.sdH) ? e.sdH / Math.sqrt(Q) : null, ...(e.hours == null && why ? { why } : {}) })
      continue
    }
    const r = yield* bladeExitGen({ ...s0, sleeves: config }, pol)
    byConfig.push({ config, hours: r.hours ?? null, ...(r.hours == null && r.why ? { why: r.why } : {}) })
  }
  const ok = byConfig.filter((x) => x.hours !== null)
  ok.sort((a, b) => a.hours - b.hours)
  return { config: ok[0]?.config ?? null, hours: ok[0]?.hours ?? null, byConfig }
}

/**
 * THE FLEET THE EXIT IS PRICED WITH: what the sleeves will do on this route.
 * sleeve.js's committed Bladeburner configuration (sleeve.txt blade.config)
 * where it has one; otherwise what the sleeves are ASSIGNED now
 * (assigned[].task: INFILTRATE, SUPPORT, BLADEBURNER = Field Analysis, the
 * only Bladeburner action the fleet takes; anything else contributes
 * nothing). Live 2026-10-01: sleeve.js had no blade config (every option
 * priced on the hacking install cadence finished nowhere in 400h), the five
 * sleeves did Homicide, and the route priced all five on Infiltrate — a
 * 26.6h exit for a trajectory the model puts at 42.7h.
 * fleet: /tel/sleeve.txt of this node (or null). Returns {sleeves, source, why}.
 */
export function bladeFleetOf(fleet, { lifeStart = null } = {}) {
  const zero = { infiltrate: 0, support: 0, fa: 0 }
  if (!fleet) return { sleeves: zero, source: 'none', why: 'no /tel/sleeve.txt from this node: no sleeve on Bladeburner' }
  // A RECORD FROM BEFORE THIS LIFE'S INSTALL prices nobody: the install
  // stops every sleeve's work (Sleeve.prestige -> stopWork,
  // Sleeve.ts:229-246) and only a running sleeve.js assigns them again.
  // Live BN4 2026-10-03 03:08-09:20Z sleeve.js had no host: the route priced
  // its last life's committed fleet (1 infiltrate, 4 support) for six hours
  // while all five sleeves idled.
  // staleSince: a record republished over an old body (status.js note.exit,
  // ramgrow.raiseRam carry) — its fleet is as of then, not of its `at`.
  const at = Date.parse(fleet.staleSince ?? fleet.at ?? '')
  if (Number.isFinite(lifeStart) && (!Number.isFinite(at) || at < lifeStart)) return { sleeves: zero, source: 'stale', why: `/tel/sleeve.txt is from before this life's install (${fleet.staleSince ?? fleet.at ?? 'undated'}): the install stopped every sleeve, and sleeve.js has not assigned them since — none on Bladeburner` }
  const c = fleet.blade?.config
  // The bodies (sleeve.txt persons): what a contract sleeve trains and rolls with (bladeStartOf sleeveBodies).
  const bodies = Array.isArray(fleet.persons) ? fleet.persons.map((x) => sleeveBodyOf(x)) : null
  if (c && typeof c === 'object') return { sleeves: { infiltrate: c.infiltrate ?? 0, support: c.support ?? 0, fa: c.fa ?? 0, ...(c.contracts > 0 ? { contracts: c.contracts, ...(Number.isFinite(c.recoverTo) ? { recoverTo: c.recoverTo } : {}), ...(Number.isFinite(c.trainTo) ? { trainTo: c.trainTo } : {}) } : {}) }, bodies, source: 'committed', why: `sleeve.js's committed fleet (${fleet.blade?.why ?? 'blade.config'})` }
  const out = { ...zero }
  const other = []
  for (const a of Array.isArray(fleet.assigned) ? fleet.assigned : []) {
    const t = String(a?.task ?? '')
    if (t === 'INFILTRATE') out.infiltrate++
    else if (t === 'SUPPORT') out.support++
    else if (t === 'BLADEBURNER') out.fa++
    else other.push(t || 'idle')
  }
  return { sleeves: out, source: 'assigned', why: `no committed Bladeburner fleet (${String(fleet.blade?.why ?? 'none').slice(0, 120)}): the sleeves as assigned — ${out.infiltrate} infiltrate, ${out.support} support, ${out.fa} field analysis${other.length ? `, ${other.length} elsewhere (${[...new Set(other)].join(', ')})` : ''}` }
}

/**
 * THE RANK RATE, REALISED AGAINST THE MODEL ON THE INPUTS THAT HELD (v3).
 * k is the model's own residual: the rank the game paid over the rank the
 * model predicts FROM THE STATE AS READ. A window is a chain of segments,
 * one per plan pass: segment i is predicted from pass i's own path (its
 * rank, stats, skills, stamina, cities, fleet and the Go farm's combat
 * effect as read then; rankScale 1) over the hours to pass i+1, and
 * realised as the rank between the two reads. The window closes once its
 * segments cover RANK_CAL.windowH; its sample is ln(sum realised / sum
 * predicted). Windows do not overlap, so the samples are independent.
 *
 * WHY SEGMENTS (v2 -> v3, live BN14.1 2026-10-04): v2 predicted the whole
 * hour from the window's FIRST state, so every input that moved over the
 * hour entered k as if it were the model's error — above all the Tetrads
 * farm's combat effect regrowing faster than the opening start's rate, and
 * the fleet sleeve.js flipped pass to pass. The next start reads that
 * drift (it carries the realised effect), so the exit applied it twice: k
 * 1.196 priced the 20:01Z state at 9.33h (members' mean) against the game's
 * own classes' 10.72h, the model at k 1 10.59h (tools/sim/bb14/kfix.mjs).
 * From a state as read the model's next hour IS the game's (14:13Z +599 vs
 * +608, 20:01Z +6526 vs +6528; the live hour after 14:13Z ran +885): the
 * lead was the inputs [BA6]. Re-read every pass, drift is an input, not a
 * residual (tools/sim/bb14/kchain.mjs replays a recorder's passes).
 *
 * BLACK OPS are left out on both sides: the path carries the model's
 * black-op rank apart (path[].bo) and the realised side subtracts each
 * black op completed in the segment (its reward, Formulas.ts
 * calculateActionRankGain: rankGain x BladeburnerRank). That rank is the
 * game's constant — what moves is WHEN, which the success calibration
 * prices — and a lump the model expects inside a five-minute segment would
 * be counted again every pass the real attempt fails. (bladeExit still
 * scales a black op's reward by k too: named at its gainRank.)
 *
 * The posterior is ratePosterior's (bayes.js): prior ln k ~ N(0,
 * PRIORS.repEstimateSdLn) — the model as written — and the windows'
 * hour-weighted mean with the pooled scatter (rankRatePosterior).
 */
// v: the window definition. Samples of another version are dropped by
// rankRatePosterior: v1's (any daemon, any inputs) measured the lean
// daemon and the unread inputs; v2's (one path from the window's opening
// state) measured the inputs' drift over the hour.
// maxSegH: a segment longer than this (passes missed) is not "the inputs as
// read" — the window is dropped. pathH covers it; pathEveryS is the model's
// step (dt 300s), so a five-minute segment reads the path's own points.
export const RANK_CAL = { windowH: 1, maxSegH: 0.75, keep: 48, pathH: 1, pathEveryS: 300, v: 3, obsNu0: 4 }
/**
 * WHAT A WINDOW MAY MEASURE (rankCalStep `full`). k is the model's error on
 * the trajectory it simulates — bladeburner.js's policy from complete
 * inputs — and nothing else, so the planner applies the same quantity it
 * measures. A segment counts only when, at BOTH ends:
 *   - bladeburner.js is the daemon acting (bb-lite runs a lean policy,
 *     LITE_POLICY: pinned levels, one city, no Raid — another trajectory);
 *   - every city's population is read (tel.cities with pop): an unread city
 *     is the prior's, and its error is the prior's, not the model's;
 *   - the fleet the route priced is this life's (bladeFleetOf source not 'stale').
 * Live BN4 2026-10-02/03: the windows were bb-lite's against the
 * full-daemon model on the start's default cities (realised/model 1.12,
 * 1.29, 1.37, 1.50, 2.75) and then the full daemon's with a fleet that was
 * not running (0.84, 0.38, 0.78, 0.83): k read 1.24, then 1.05, and
 * corrected neither error. Returns {ok, why}.
 */
export function rankWindowOkOf({ tel = null, fleetSource = null } = {}) {
  if (!tel || tel.daemon !== 'bladeburner.js') return { ok: false, why: `the daemon is ${tel?.daemon ?? 'absent'}, not bladeburner.js (the policy the model simulates)` }
  const cs = Array.isArray(tel.cities) ? tel.cities : []
  if (cs.length !== CITY_NAMES.length || !cs.every((c) => typeof c.pop === 'number' && isFinite(c.pop) && c.pop >= 0)) return { ok: false, why: 'a city population is unread (the prior prices it)' }
  if (fleetSource === 'stale') return { ok: false, why: "the fleet record is from before this life's install" }
  return { ok: true, why: null }
}
/** The game's rank for black ops number from..to-1 completed (Formulas.ts calculateActionRankGain BlackOp; addOffset is +-10% about it). */
export function blackOpRankOf(from, to, bnRank = 1) {
  let r = 0
  if (!(Number.isFinite(from) && Number.isFinite(to))) return 0
  for (let n = Math.max(0, from); n < Math.min(to, BLACK_OPS.length); n++) r += rankGainOf(BLACK_OPS[n], 1, bnRank)
  return r
}
/**
 * One plan pass on the rank ledger. path: this pass's model path (bladeExit
 * with pathEveryS, rankScale 1) from the state as read, or null; blackOps:
 * the black ops done as read; bnRank: the node's BladeburnerRank. Returns
 * {pending, samples, closed}; pending holds the window's sums and the last
 * pass's {at, rank, blackOps, path}.
 */
export function rankCalStep(prev, { at, lastAugReset, rank, ours = true, full = true, path = null, successScale = 1, blackOps = 0, bnRank = 1 }) {
  const atMs = Date.parse(at)
  const samples = Array.isArray(prev?.samples) ? prev.samples.slice(-RANK_CAL.keep) : []
  let pending = prev?.pending ?? null
  let closed = null
  // Another definition's window (v2: one path from its opening state) does not continue.
  if (pending && (pending.v !== RANK_CAL.v || !pending.last)) pending = null
  // Not the model's trajectory at this end (rankWindowOkOf), or another life: the window is dropped, not closed.
  if (pending && (pending.lastAugReset !== lastAugReset || !ours || !full || !Number.isFinite(rank))) pending = null
  if (pending && Number.isFinite(atMs)) {
    const L = pending.last
    const dh = (atMs - Date.parse(L.at)) / 3.6e6
    // The same read again (the daemon has not written since): nothing to add, the segment runs on.
    if (dh === 0) return { pending, samples, closed: null }
    if (!(dh > 0) || dh > RANK_CAL.maxSegH) pending = null
    else {
      const pred = rankOnPath(L.path, dh, { exBlackOps: true }) - L.rank
      const real = rank - L.rank - blackOpRankOf(L.blackOps ?? 0, blackOps ?? 0, bnRank)
      pending = { ...pending, h: pending.h + dh, pred: pending.pred + pred, real: pending.real + real, segs: pending.segs + 1, last: null }
      if (pending.h >= RANK_CAL.windowH) {
        if (pending.pred > 0 && pending.real > 0) {
          closed = { at: pending.at, to: at, h: +pending.h.toFixed(3), segs: pending.segs, pred: +pending.pred.toFixed(3), real: +pending.real.toFixed(3), lnK: +Math.log(pending.real / pending.pred).toFixed(4), successScale: pending.successScale ?? 1, v: RANK_CAL.v }
          samples.push(closed)
        }
        pending = null
      }
    }
  }
  if (!(ours && full && Array.isArray(path) && path.length && Number.isFinite(rank))) pending = null
  else {
    if (!pending) pending = { at, lastAugReset, h: 0, pred: 0, real: 0, segs: 0, successScale, v: RANK_CAL.v }
    pending.last = { at, rank, blackOps: blackOps ?? 0, path }
  }
  return { pending, samples: samples.slice(-RANK_CAL.keep), closed }
}
/**
 * Rank at hour e on a path [{h, rank, bo?}] (h from the path's start, linear
 * between points). exBlackOps: less the path's black-op rank (bo) — the
 * quantity the v3 windows measure.
 */
export function rankOnPath(path, e, { exBlackOps = false } = {}) {
  if (!Array.isArray(path) || !path.length) return NaN
  const r = (p) => p.rank - (exBlackOps ? p.bo ?? 0 : 0)
  let p0 = path[0]
  if (e <= p0.h) return r(p0)
  for (let i = 1; i < path.length; i++) {
    const p1 = path[i]
    if (e <= p1.h) return r(p0) + ((r(p1) - r(p0)) * (e - p0.h)) / (p1.h - p0.h || 1)
    p0 = p1
  }
  return r(p0)
}
export function rankRatePosterior(samples, { priorSdLn = PRIORS.repEstimateSdLn, obsSdLn = PRIORS.rateSdLn, v = RANK_CAL.v } = {}) {
  const S = (Array.isArray(samples) ? samples : []).filter((x) => Number.isFinite(x?.lnK) && x.h > 0 && (v === null || x.v === v))
  const hours = S.reduce((a, x) => a + x.h, 0)
  const prior = `the model as written (k = 1, x/÷ ${Math.exp(1.2816 * priorSdLn).toFixed(2)} at 80%, stated)`
  if (!S.length) return { k: 1, lnK: 0, sdLn: priorSdLn, n: 0, hours: 0, measuredWeight: 0, why: `no closed window yet: ${prior}` }
  const m = S.reduce((a, x) => a + x.lnK * x.h, 0) / hours
  // THE WINDOWS' OWN SCATTER (RANK_CAL.obsNu0): a window's ln(real/pred) is
  // noisier than the stated PRIORS.rateSdLn per sqrt(hour) — live BN14.1 the
  // seven 1h windows read -0.65 +0.64 -0.42 +0.02 +0.27 -0.10 +0.23 (sd
  // 0.44), so one window moved k 1 -> 0.71 and the next back to ~1 (the
  // exit -24h at 03:52Z with no other change). The observation sd is the
  // pooled estimate (the stated sd as obsNu0 pseudo-windows, then the
  // windows' weighted scatter about their mean), never below the stated one:
  // a posterior, so k moves with the evidence's real weight.
  const nu0 = RANK_CAL.obsNu0
  const ss = S.reduce((a, x) => a + x.h * (x.lnK - m) ** 2, 0)
  const obsSd = Math.max(obsSdLn, Math.sqrt((nu0 * obsSdLn * obsSdLn + ss) / (nu0 + Math.max(0, S.length - 1))))
  const sm = obsSd * Math.sqrt(1 / hours)
  const wp = 1 / (priorSdLn * priorSdLn)
  const wm = 1 / (sm * sm)
  const mean = (m * wm) / (wp + wm)
  const sd = Math.sqrt(1 / (wp + wm))
  return { k: +Math.exp(mean).toFixed(4), lnK: +mean.toFixed(4), sdLn: +sd.toFixed(4), n: S.length, hours: +hours.toFixed(2), obsSdLn: +obsSd.toFixed(4), measuredWeight: +(wm / (wp + wm)).toFixed(3), why: `rank realised / the model's path: ${S.length} window(s) over ${hours.toFixed(2)}h, mean ratio ${Math.exp(m).toFixed(3)}, window sd ${obsSd.toFixed(2)}/sqrt(h) (weight ${((100 * wm) / (wp + wm)).toFixed(0)}%) -> k ${Math.exp(mean).toFixed(3)} x/÷ ${Math.exp(1.2816 * sd).toFixed(2)} at 80% [prior: ${prior}]` }
}

/**
 * THE STATE MOVES THE EXIT MODEL TAKES AS EVENTS (EXIT UNSTABLE). Between
 * passes the model's inputs drift with what it simulates (rank, exp, counts,
 * stamina, skill purchases — its own policy): that is no event, and an exit
 * that jumps on it is a fault the check must catch. What it cannot foresee
 * is: the sleeves' fleet changing; a black op done (a discrete step taken
 * at another time than modelled); a random event moving the BEST city's
 * true population or communities (the model carries events in expectation —
 * a realised one, by more than BLADE_EVENT.popRel, is news); the success or
 * rank calibration moving (a posterior update, BLADE_EVENT.calSd of its sd).
 * An estimate corrected by Field Analysis is NOT one: the model prices the
 * true population (popRatioFromRange). Returns the state; bladeEventsOf
 * compares two.
 */
export const BLADE_EVENT = { popRel: 0.04, calSd: 0.5, calMin: 0.02 }
export function bladeStateOf({ tel = null, sleeves = null, cal = null } = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x)
  const cities = Array.isArray(tel?.cities) ? tel.cities.map((c) => ({ name: c.name, pop: num(c.pop) ? c.pop : c.popEst, chaos: c.chaos ?? 0, comms: c.comms ?? 0 })) : []
  const best = cities.length ? bestCity(cities) : null
  return {
    fleet: sleeveConfigKey(sleeves),
    blackOps: num(tel?.blackOps?.done) ? tel.blackOps.done : null,
    best: best ? { name: best.name, pop: Math.round(best.pop), comms: best.comms } : null,
    kRank: cal?.rank ? { lnK: cal.rank.lnK, sdLn: cal.rank.sdLn } : null,
    kSuccess: cal?.success ? { lnK: cal.success.lnK, sdLn: cal.success.sdLn } : null,
  }
}
export function bladeEventsOf(prev, cur) {
  const ev = []
  if (!prev || !cur) return ev
  if (prev.fleet && cur.fleet && prev.fleet !== cur.fleet) ev.push(`the sleeves' Bladeburner fleet changed ${prev.fleet} -> ${cur.fleet}`)
  if (Number.isFinite(prev.blackOps) && Number.isFinite(cur.blackOps) && prev.blackOps !== cur.blackOps) ev.push(`black op ${cur.blackOps}/21 done`)
  if (prev.best && cur.best) {
    if (prev.best.name !== cur.best.name) ev.push(`the best city moved ${prev.best.name} -> ${cur.best.name} (a random event)`)
    else if (prev.best.pop > 0 && Math.abs(cur.best.pop / prev.best.pop - 1) > BLADE_EVENT.popRel) ev.push(`${cur.best.name}'s true population ${(prev.best.pop / 1e9).toFixed(3)}e9 -> ${(cur.best.pop / 1e9).toFixed(3)}e9 (a random event)`)
    else if (prev.best.comms !== cur.best.comms && (cur.best.comms === 0 || prev.best.comms === 0)) ev.push(`${cur.best.name}'s communities ${prev.best.comms} -> ${cur.best.comms}`)
  }
  for (const [k, label] of [['kRank', 'rank'], ['kSuccess', 'success']]) {
    const a = prev[k]
    const b = cur[k]
    if (a && b && Number.isFinite(a.lnK) && Number.isFinite(b.lnK) && Math.abs(b.lnK - a.lnK) > Math.max(BLADE_EVENT.calMin, BLADE_EVENT.calSd * (a.sdLn ?? 0))) ev.push(`the ${label} calibration moved k ${Math.exp(a.lnK).toFixed(3)} -> ${Math.exp(b.lnK).toFixed(3)}`)
  }
  return ev
}

/** A sleeve config as per-sleeve tasks (sleeve index order): infiltrate first, then support, then field analysis. */
export function sleeveTasksOf(config, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    if (i < config.infiltrate) out.push({ kind: 'bladeburner', action: SLEEVE_ACTION.infiltrate })
    else if (i < config.infiltrate + config.support) out.push({ kind: 'bladeburner', action: SLEEVE_ACTION.support })
    else if (i < config.infiltrate + config.support + config.fa) out.push({ kind: 'bladeburner', action: GENERAL.fieldAnalysis })
    // A contract sleeve: sleeve.js runs sleevePhaseOf on its body each pass (recover / gym / the best contract).
    else if (i < config.infiltrate + config.support + config.fa + (config.contracts ?? 0)) out.push({ kind: 'bladeContract', recoverTo: config.recoverTo ?? null, trainTo: config.trainTo ?? null })
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
export function bladeStartOf({ tel = null, person, sleeves = {}, sleeveBodies = null, install = null, gymExpPerSec, bnRank = 1, skillCostMult = 1, simulacrum = false, maxH = 400, dt = 300, rankScale = 1, successScale = 1, rankSdLn = 0, successSdLn = 0, leanUntilH = null, retrainSecsOf = null, goCombat = null, policy = null, now = Date.now() }) {
  const joined = tel?.joined === true
  const num = (x) => typeof x === 'number' && isFinite(x)
  // The daemon's skill clock (bladeburner.js skillsAt: its last spend; null: none since it started).
  const skillsAtMs = typeof tel?.skillsAt === 'string' ? Date.parse(tel.skillsAt) : NaN
  const skillSinceS = joined && num(skillsAtMs) && num(now) ? Math.max(0, (now - skillsAtMs) / 1000) : undefined
  // A city's TRUE population where the daemon read it off the range
  // (popRatioFromRange: `pop`), else its estimate: the game rolls every
  // attempt on the true one (Action.ts getPopulationSuccessFactor, est false).
  const popOf = (c) => (num(c.pop) && c.pop >= 0 ? c.pop : c.popEst)
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
    cities: joined && Array.isArray(tel.cities) && tel.cities.length === CITY_NAMES.length ? tel.cities.map((c) => ({ name: c.name, pop: popOf(c), chaos: c.chaos, comms: c.comms })) : undefined,
    successes: joined && tel.successes && typeof tel.successes === 'object' ? { ...tel.successes } : undefined,
    // The division's age (tel.joinedAt, joinedAtOf): what the unread cities and counts are priced at.
    divisionAgeH: joined && typeof tel.joinedAt === 'string' && num(Date.parse(tel.joinedAt)) && num(now) ? Math.max(0, (now - Date.parse(tel.joinedAt)) / 3.6e6) : 0,
    // Cities the full daemon read earlier (bb-lite carries them, bbliteplan.carriedOf): their age, advanced in expectation.
    citiesAgeH: joined && typeof tel.citiesAt === 'string' && num(Date.parse(tel.citiesAt)) && num(now) ? Math.max(0, (now - Date.parse(tel.citiesAt)) / 3.6e6) : 0,
    stamina: joined && num(tel.stamina) ? tel.stamina : undefined,
    maxStamina: joined && num(tel.maxStamina) ? tel.maxStamina : undefined,
    staminaBonus: joined && num(tel.staminaBonus) ? tel.staminaBonus : 0,
    skillSinceS,
    // bb-lite.js acting (tel.daemon): its lean policy until the full daemon is expected (leanUntilH; Infinity: until a step admits it).
    lean: joined && tel.daemon === 'bb-lite' && (num(leanUntilH) || leanUntilH === Infinity) && leanUntilH > 0 ? { untilH: leanUntilH, city: typeof tel.city === 'string' ? tel.city : null } : undefined,
    rankScale: num(rankScale) && rankScale > 0 ? rankScale : 1,
    successScale: num(successScale) && successScale > 0 ? successScale : 1,
    // The calibrations' posterior sds (ln k): what bladeMemberOf spreads the members over.
    rankSdLn: num(rankSdLn) && rankSdLn > 0 ? rankSdLn : 0,
    successSdLn: num(successSdLn) && successSdLn > 0 ? successSdLn : 0,
    bnRank,
    skillCostMult,
    sleeves,
    // The sleeves' bodies (sleeveBodyOf of ns.sleeve.getSleeve): what a contract sleeve trains and rolls with.
    ...(Array.isArray(sleeveBodies) && sleeveBodies.length ? { sleeveBodies: sleeveBodies.map((b) => sleeveBodyOf(b)) } : {}),
    gymExpPerSec,
    // The retrain's money and travel (bladeExitGen gymTo): the caller's priced combat-bar plan, or none.
    ...(typeof retrainSecsOf === 'function' ? { retrainSecsOf } : {}),
    // The Go farm's combat channel (bladeGoCombatOf): reset at an install, regrown at its rate.
    ...(goCombat && Number.isFinite(goCombat.effect) && goCombat.effect >= 1 ? { goCombat: { effect: goCombat.effect, nodes: goCombat.nodes ?? 0, perHour: goCombat.perHour ?? 0, power: goCombat.power ?? OPPONENTS.Tetrads.power, goPower: goCombat.goPower ?? 1, sf14: goCombat.sf14 ?? 0 } } : {}),
    install,
    // The policy the daemon played, where it is not POLICY (a replay of a run before 2026-10-04: POLICY_V1).
    ...(policy ? { policy } : {}),
    simulacrum: simulacrum === true,
    maxH,
    dt,
  }
}

/**
 * THE GO FARM'S COMBAT CHANNEL for bladeStartOf (s0.goCombat), from go.js's
 * record (/tel/go.txt: bonuses, opponent, goPower, sf14, at, lastAugReset).
 *
 * In BitNode 14 (GoPower 4) the Tetrads farm is the largest combat
 * multiplier there is: x2.61 on every combat level at 10:19Z 2026-10-04
 * (nodePower ~54k after 8.8h), against x1.10 from the 13-aug batch. It is
 * held in player.mults, so the exit model priced it as permanent: the
 * install actor carried it through the install (Go/Go.ts:34-47 zeroes every
 * nodePower) and the new life froze its own x1.0 for the whole trajectory —
 * 33.5h against 80.2h, EXIT JUMP AT INSTALL +46.8h
 * (tools/sim/exitjump/replay-bn14-1022.mjs).
 *
 *   effect   1 + bonuses.Tetrads/100 (getStats bonusPercent = CalculateEffect - 1)
 *   nodes    the nodePower behind it (goplan.nodePowerFromBonus)
 *   perHour  the farm's nodePower per hour while it farms Tetrads: MEASURED as
 *            this life's nodes over its age (from GO_COMBAT.minAgeH; the
 *            average over the life, which is what the next life repeats),
 *            else `carried` (the previous life's measured rate, the plan's
 *            record), else the prior goplan.POWER_PER_HOUR.Tetrads (a farm
 *            on Tetrads alone; live BN14.1 measured 4.9-6.2k/h against its
 *            10.4k — the farm shares its hours). The measured and the
 *            carried rate are TIME AVERAGES over a life whose hours go.js
 *            already shares among opponents (its Thompson arm), so they hold
 *            whichever opponent the record names at this instant. They were
 *            zeroed while go.js farmed another opponent: live BN9 2026-10-07
 *            the arm flipped Tetrads <-> Daedalus every few minutes and the
 *            committed install's exit with it — 15.1h (21:45Z, Tetrads) ->
 *            25.1h (21:50Z, Daedalus), 29.3h at 21:40Z (Daedalus), the rate
 *            28.5k/h -> 0 with no event: EXIT UNSTABLE, and the install
 *            choice inverted with it (rate 0: never 17.5h beats the
 *            install's 25.1h; the farm's rate: the install 14.6h beats
 *            never's 15.6h). 0 only where nothing is measured or carried
 *            and go.js is not on Tetrads (the prior is a farm on Tetrads
 *            alone), or the record is stale (go.js not running; the effect
 *            still resets at an install).
 * Returns {effect, nodes, perHour, rateSource, power, goPower, sf14, why}
 * or {effect: null, why} when the record cannot be read (named: the
 * multipliers then price as they are, for ever, through any install).
 */
export const GO_COMBAT = { minAgeH: 0.5, staleMs: 15 * 60e3 }
export function bladeGoCombatOf(rec, { node = null, lastAugReset = null, now = Date.now(), carried = null } = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x)
  const T = OPPONENTS.Tetrads
  const none = (why) => ({ effect: null, why: `${why}: the Go farm's combat effect is unread — the multipliers price as they are, for ever, through any install` })
  if (!rec || typeof rec !== 'object') return none('no /tel/go.txt')
  if (node !== null && rec.bitNode !== node) return none(`/tel/go.txt is from BitNode ${rec.bitNode}`)
  if (num(lastAugReset) && rec.lastAugReset !== lastAugReset) return none('/tel/go.txt is from another life')
  const pct = rec.bonuses?.[T.game]
  if (!num(pct) || pct < 0) return none(`no ${T.game} bonus in /tel/go.txt`)
  const goPower = num(rec.goPower) && rec.goPower > 0 ? rec.goPower : 1
  const sf14 = num(rec.sf14) ? rec.sf14 : 0
  const effect = 1 + pct / 100
  const nodes = pct > 0 ? nodePowerFromBonus(pct, T.power, goPower, sf14) ?? 0 : 0
  const out = { effect, nodes, power: T.power, goPower, sf14 }
  const ageMs = num(now) && typeof rec.at === 'string' ? now - Date.parse(rec.at) : NaN
  if (!(ageMs < GO_COMBAT.staleMs)) return { ...out, perHour: 0, rateSource: 'stale', why: `x${effect.toFixed(3)} now (n ${Math.round(nodes)}), /tel/go.txt ${num(ageMs) ? `${(ageMs / 60e3).toFixed(0)} min old` : 'undated'}: no regrowth priced; the effect resets at an install` }
  // The arm of this minute is not a rate: the averages below already carry the hours go.js gives other opponents.
  const onTetrads = keyOfGame(rec.opponent) === 'Tetrads'
  const armNote = onTetrads ? '' : `; go.js is on ${rec.opponent ?? 'nothing'} this minute — a time average over its arms, not zeroed by the arm of the moment`
  const lifeH = num(lastAugReset) && num(now) ? (now - lastAugReset) / 3.6e6 : NaN
  let perHour = null
  let rateSource = null
  if (lifeH >= GO_COMBAT.minAgeH && nodes > 0) {
    perHour = nodes / lifeH
    rateSource = `measured: n ${Math.round(nodes)} over this life's ${lifeH.toFixed(2)}h`
  } else if (num(carried?.perHour) && carried.perHour > 0) {
    perHour = carried.perHour
    rateSource = `carried: ${carried.source ?? 'the previous life'}`
  } else if (!onTetrads) {
    return { ...out, perHour: 0, rateSource: 'not farming', why: `x${effect.toFixed(3)} now (n ${Math.round(nodes)}), go.js farms ${rec.opponent ?? 'nothing'} and no Tetrads rate is measured or carried: no regrowth priced; the effect resets at an install` }
  } else {
    perHour = POWER_PER_HOUR.Tetrads
    rateSource = 'prior: goplan.POWER_PER_HOUR.Tetrads (a farm on Tetrads alone)'
  }
  return { ...out, perHour, rateSource, why: `Tetrads x${effect.toFixed(3)} now (n ${Math.round(nodes)}), regrowing ${Math.round(perHour)}/h (${rateSource}${armNote}); zeroed at an install (Go/Go.ts:34-47)` }
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
 * The install a committed route basis makes (decisions.bladeRoute.installBasis:
 * {kind: 'wait', waitH, installAt, blade?} or {kind: 'none' | 'never'}), for
 * a reader of the plan record (sleeve.js): one install at its time with the
 * batch's content the basis carries (blade.gains; a record without it: gains
 * null, named) — or none. Never the hacking route's cadence.
 */
export function bladeInstallOfBasis(basis, now = Date.now()) {
  if (!basis || basis.kind !== 'wait') return null
  const at = Number.isFinite(basis.installAt) ? (basis.installAt - now) / 3.6e6 : Number.isFinite(basis.waitH) ? basis.waitH : null
  // The batch's content where the record carries it (progress.js publishes
  // installBasis.blade since 2026-10-02): the same install the plan prices.
  return at === null ? null : { firstH: Math.max(0, at), gains: basis.blade?.gains ?? null, simulacrum: basis.blade?.simulacrum === true }
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
  // On the members, as withoutH (the route's point, their mean): one exit
  // each side would compare a mean with a single member's roughness.
  const bound = yield* bladeExitMeanGen({ ...s0, install: { firstH: 0, gains: null, simulacrum: true } })
  const boundH = bound.hours
  const out = { ...base, moneyH: r2(moneyH), repH: r2(repH), reachH: r2(reachH), boundH: r2(boundH), boundGainH: Number.isFinite(boundH) ? r2(withoutH - boundH) : null }
  const money = !Number.isFinite(cost) ? 'money: the price is unread (snap-augprice)' : Number.isFinite(moneyH) ? `money in ${moneyH.toFixed(1)}h ($${(cost / 1e9).toFixed(1)}b against $${(wealth / 1e9).toFixed(3)}b at $${(moneyPerH / 1e6).toFixed(1)}m/h)` : `money never ($${(cost / 1e9).toFixed(1)}b, no income)`
  const repTxt = !Number.isFinite(repReq) ? 'reputation: the requirement is unread' : `reputation in ${Number.isFinite(repH) ? repH.toFixed(1) + 'h' : 'never'} (${Math.round(rep)} of ${Math.round(repReq)} at ${(repPerRank * rankPerH).toFixed(1)}/h)`
  if (!(reachH < withoutH)) return { ...out, buy: false, withH: null, gainH: null, why: `unreachable before the exit: ${money}, ${repTxt} — the exit is ${withoutH.toFixed(1)}h away; installed now at no cost it would be worth ${out.boundGainH ?? '?'}h` }
  const w = yield* bladeExitMeanGen({ ...s0, install: { firstH: reachH, gains: null, simulacrum: true } })
  const withH = Number.isFinite(w.hours) ? w.hours : null
  const gainH = withH === null ? null : withoutH - withH
  const buy = gainH !== null && gainH > 0
  return { ...out, buy, withH: r2(withH), gainH: r2(gainH), why: buy ? `buy (${money}, ${repTxt}) and install at ${reachH.toFixed(1)}h: the exit ${withH.toFixed(1)}h against ${withoutH.toFixed(1)}h (${gainH.toFixed(1)}h sooner)` : `not worth it: bought at ${reachH.toFixed(1)}h and installed, the exit is ${withH === null ? 'unpriced' : withH.toFixed(1) + 'h'} against ${withoutH.toFixed(1)}h (the install's reset costs more than the parallel gym returns)` }
}
