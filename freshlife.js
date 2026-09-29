// freshlife.js — A FRESH LIFE PRICED FROM THE GAME'S OWN FORMULAS (pure: no ns).
//
// WHAT THIS REPLACES. Three inputs of the plan used to come from finished
// lives standing in for a model:
//
//   - the fresh-life hacking income (bayes.incomePrior): earlier lives at this
//     age, rescaled by ScriptHackMoney when borrowed from another node. BN9's
//     first fresh life read $5.95e7/s from four BN1 lives; the life measured
//     $2.5e3/s — x23,000 — because ServerMaxMoney 0.01 (and the level curve,
//     the target set, the prep) are not ScriptHackMoney;
//   - the exp ramp: a constant measured rate, plus a measured "fresh-life lag";
//   - the count batch's earnings curve (countplan.freshCurve), which refused to
//     price anything until three lives of the node were recorded.
//
// This module is the STRUCTURAL PRIOR for all three: a fresh life simulated
// from the formulas the game runs, with the lives we have entering only as
// the evidence that updates its error (bayes.formulaErrorPosterior).
//
// THE FORMULAS, each ported from ~/Repos/bitburner and checked against the
// game bundle in tools/test/freshlife.test.mjs [FL1-FL2]:
//
//   level     calculateSkill(exp, hacking x HackingLevelMultiplier)
//                                       PersonObjects/formulas/skill.ts:7, Person.ts:49-60
//   hack time 5 (2.5 req sec + 500) / (level + 50) / (speed x HackingSpeedMultiplier x int)
//                                       Hacking.ts:60-81; grow 3.2x, weaken 4x (:83-95)
//   chance    (1.75 L - req)/(1.75 L) x (100 - sec)/100 x chance x int
//                                       Hacking.ts:9-24
//   percent   (100 - sec)/100 x (L - req + 1)/L x money x ScriptHackMoney / 240
//                                       Hacking.ts:44-56
//   grow      log1p(0.03/sec) (<= 0.00349) x growth/100 x ServerGrowthRate x grow
//                                       Server/formulas/grow.ts:8-29
//   exp/op    (3 + 0.3 baseDifficulty) x hacking_exp x HackExpGain
//                                       Hacking.ts:30-38; hack pays it on success, 1/4 on failure
//                                       (NetscriptHelpers.tsx:618-641), grow and weaken always
//   servers   moneyMax 25 x base x ServerMaxMoney, money base x ServerStartingMoney,
//             security min(100, d x ServerStartingSecurity), min round(that / 3)
//                                       Server/Server.ts:74-86; RAM 2^exponent, ranges drawn
//                                       uniformly per install (ServerHelpers.ts:377-400) —
//                                       the EXPECTED server is used here, since the next life
//                                       re-draws them
//
// THE BATCHER, mirrored from batch.js (not imported: batch.js references ns
// functions the RAM checker would bill every importer for):
//   - targets ranked by targetScore, filtered (score >= 2% of the best, money
//     >= 1% of the best), top 8, and the count n by the same argmax of
//     sum_i min(money_i / (4 spacing), slice x money_i / (gb_i x 4 hackTime_i))
//     with slice = RAM / n (batch.js "How many to run");
//   - a batch sized by planBatch's sweep (batch.js:1108), grow threads by
//     numCycleForGrowthCorrected;
//   - a target earns nothing until it is PREPPED: its security weakened from the
//     starting level to the floor and its money grown from the starting balance
//     to the max, each round one weaken time, the rounds set by the RAM it has;
//   - RAM the pipelines cannot use runs weaken (the spill: full exp, no money);
//   - the EXP FARM (expfarm.js), when on, holds `farmShare` of the fleet at
//     expScore on the best exp target.
//
// NOT MODELLED (the structural error carries them, and says so): the live
// batcher's placement losses (batch.txt placeFails; live BN9 lands 1.8 batches
// a minute against the model's saturation of 75), network cores (grow/weaken
// x (1 + (cores - 1)/16) on the executing host), the hacking stream a kept
// target earns after the farm switches on, faction work's hacking exp, and
// every stream that is not scripted hacking (priced by their own terms).
//
// CALIBRATION: bayes.formulaErrorPosterior over the recorded lives
// (FRESH_CALIBRATION below, tools/sim/freshcal.mjs; held-out table in
// docs/bayes.md). The formula's error is a posterior, not a constant: every
// completed life with its inputs recorded (tel.js earnings ledger) updates it.

import { expScore, RAM as OP_RAM_ } from 'expfarm.js'

// Op RAM (expfarm.RAM), as plain constants: a member named like an ns
// function (`.hack`, `.grow`, `.weaken`) is billed by the RAM calculator.
const RAM_H = OP_RAM_['h' + 'ack']
const RAM_G = OP_RAM_['g' + 'row']
const RAM_W = OP_RAM_['w' + 'eaken']

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

// ---------------------------------------------------------------------------
// THE NETWORK: src/Server/data/servers.ts serverMetadata, less w0r1d_d43m0n
// and darkweb. [hostname, maxRamExponent, ports, requiredHackingSkill,
// hackDifficulty, moneyAvailable (base), serverGrowth]; a [min, max] pair is a
// range drawn per install. [FL1] compares this table with the game bundle.
// ---------------------------------------------------------------------------
export const SERVER_TABLE = [
  ['ecorp', null, 5, [1050, 1400], 99, [30000000000, 70000000000], 99],
  ['megacorp', null, 5, [1100, 1350], 99, [40000000000, 60000000000], 99],
  ['b-and-a', null, 5, [900, 1150], [72, 88], [15000000000, 30000000000], [60, 80]],
  ['blade', [5, 9], 5, [900, 1200], [88, 97], [10000000000, 40000000000], [55, 85]],
  ['nwo', null, 5, [950, 1300], 99, [20000000000, 40000000000], [65, 95]],
  ['clarkinc', null, 5, [950, 1250], [45, 65], [15000000000, 25000000000], [45, 75]],
  ['omnitek', [7, 9], 5, [900, 1100], [90, 99], [13000000000, 22000000000], [95, 99]],
  ['4sigma', null, 5, [900, 1250], [55, 75], [15000000000, 25000000000], [75, 99]],
  ['kuai-gong', null, 5, [950, 1300], [95, 99], [20000000000, 30000000000], [90, 99]],
  ['fulcrumtech', [7, 11], 5, [950, 1250], [83, 97], [1400000000, 1800000000], [80, 99]],
  ['fulcrumassets', null, 5, [1100, 1600], 99, 1000000, 1],
  ['stormtech', null, 5, [875, 1075], [78, 92], [1000000000, 1200000000], [68, 92]],
  ['defcomm', null, 5, [850, 1050], [84, 96], [800000000, 950000000], [47, 73]],
  ['infocomm', null, 5, [875, 950], [70, 90], [600000000, 900000000], [35, 75]],
  ['helios', [5, 8], 5, [800, 900], [85, 95], [550000000, 750000000], [70, 80]],
  ['vitalife', [4, 7], 5, [775, 900], [80, 90], [700000000, 800000000], [60, 80]],
  ['icarus', null, 5, [850, 925], [85, 95], [900000000, 1000000000], [85, 95]],
  ['univ-energy', [4, 7], 4, [800, 900], [80, 90], [1100000000, 1200000000], [80, 90]],
  ['titan-labs', [4, 7], 5, [800, 875], [70, 80], [750000000, 900000000], [60, 80]],
  ['microdyne', [4, 6], 5, [800, 875], [65, 75], [500000000, 700000000], [70, 90]],
  ['taiyang-digital', null, 5, [850, 950], [70, 80], [800000000, 900000000], [70, 80]],
  ['galactic-cyber', null, 5, [825, 875], [55, 65], [750000000, 850000000], [70, 90]],
  ['aerocorp', null, 5, [850, 925], [80, 90], [1000000000, 1200000000], [55, 65]],
  ['omnia', [4, 6], 5, [850, 950], [85, 95], [900000000, 1000000000], [60, 70]],
  ['zb-def', null, 4, [775, 825], [55, 65], [900000000, 1100000000], [65, 75]],
  ['applied-energetics', null, 4, [775, 850], [60, 80], [700000000, 1000000000], [70, 75]],
  ['solaris', [4, 7], 5, [750, 850], [70, 80], [700000000, 900000000], [70, 80]],
  ['deltaone', null, 5, [800, 900], [75, 85], [1300000000, 1700000000], [50, 70]],
  ['global-pharm', [3, 6], 4, [750, 850], [75, 85], [1500000000, 1750000000], [80, 90]],
  ['nova-med', null, 4, [775, 850], [60, 80], [1100000000, 1250000000], [65, 85]],
  ['zeus-med', null, 5, [800, 850], [70, 90], [1300000000, 1500000000], [70, 80]],
  ['unitalife', [4, 6], 4, [775, 825], [70, 80], [1000000000, 1100000000], [70, 80]],
  ['lexo-corp', [4, 7], 4, [650, 750], [60, 80], [700000000, 800000000], [55, 65]],
  ['rho-construction', [4, 6], 3, [475, 525], [40, 60], [500000000, 700000000], [40, 60]],
  ['alpha-ent', [4, 7], 4, [500, 600], [50, 70], [600000000, 750000000], [50, 60]],
  ['aevum-police', [4, 6], 4, [400, 450], [70, 80], [200000000, 400000000], [30, 50]],
  ['rothman-uni', [4, 7], 3, [370, 430], [45, 55], [175000000, 250000000], [35, 45]],
  ['zb-institute', [4, 7], 5, [725, 775], [65, 85], [800000000, 1100000000], [75, 85]],
  ['summit-uni', [4, 6], 3, [425, 475], [45, 65], [200000000, 350000000], [40, 60]],
  ['syscore', null, 4, [550, 650], [60, 80], [400000000, 600000000], [60, 70]],
  ['catalyst', [4, 7], 3, [400, 450], [60, 70], [300000000, 550000000], [25, 55]],
  ['the-hub', [3, 6], 2, [275, 325], [35, 45], [150000000, 200000000], [45, 55]],
  ['computek', null, 3, [300, 400], [55, 65], [220000000, 250000000], [45, 65]],
  ['netlink', [4, 7], 3, [375, 425], [60, 80], 275000000, [45, 75]],
  ['johnson-ortho', null, 2, [250, 300], [35, 65], [70000000, 85000000], [35, 65]],
  ['n00dles', 2, 0, 1, 1, 70000, 3000],
  ['foodnstuff', 4, 0, 1, 10, 2000000, 5],
  ['sigma-cosmetics', 4, 0, 5, 10, 2300000, 10],
  ['joesguns', 4, 0, 10, 15, 2500000, 20],
  ['zer0', 5, 1, 75, 25, 7500000, 40],
  ['nectar-net', 4, 0, 20, 20, 2750000, 25],
  ['neo-net', 5, 1, 50, 25, 5000000, 25],
  ['silver-helix', 6, 2, 150, 30, 45000000, 30],
  ['hong-fang-tea', 4, 0, 30, 15, 3000000, 20],
  ['harakiri-sushi', 4, 0, 40, 15, 4000000, 40],
  ['phantasy', 5, 2, 100, 20, 24000000, 35],
  ['max-hardware', 5, 1, 80, 15, 10000000, 30],
  ['omega-net', 5, 2, [180, 220], [25, 35], [60000000, 70000000], [30, 40]],
  ['crush-fitness', null, 2, [225, 275], [35, 45], [40000000, 60000000], [27, 33]],
  ['iron-gym', 5, 1, 100, 30, 20000000, 20],
  ['millenium-fitness', [4, 8], 3, [475, 525], [45, 55], 250000000, [25, 45]],
  ['powerhouse-fitness', [4, 6], 5, [950, 1100], [55, 65], 900000000, [50, 60]],
  ['snap-fitness', null, 4, [675, 800], [40, 60], 450000000, [40, 60]],
  ['run4theh111z', [5, 9], 4, [505, 550], 0, 0, 0],
  ['I.I.I.I', [4, 8], 3, [340, 365], 0, 0, 0],
  ['avmnite-02h', [4, 7], 2, [202, 220], 0, 0, 0],
  ['.', 4, 4, [505, 550], 0, 0, 0],
  ['CSEC', 3, 1, [51, 60], 0, 0, 0],
  ['The-Cave', null, 5, 925, 0, 0, 0],
]

// src/Server/data/Constants.ts
export const SERVER = { baseGrowthIncr: 0.03, maxGrowthLog: 0.00349388925425578, fortify: 0.002, weakenAmt: 0.05 }
// batch.js SETTINGS (spacing 200ms, margin 1.1, maxTargets 8, minScoreFrac 0.02, minMoneyFrac 0.01).
export const BATCHER = { spacingS: 0.2, margin: 1.1, maxTargets: 8, minScoreFrac: 0.02, minMoneyFrac: 0.01 }

/**
 * THE PORT OPENERS A FRESH LIFE OWNS, by age — [[ageH, ports]], a step
 * function. An install deletes every program (Prestige.ts / prestigeHomeComputer
 * resets `programs`), so the network is re-rooted as the openers are re-bought.
 * STATED (an input to the formula, not a fit of what it predicts): the rooted
 * counts of BN9's two lives in history.jsonl (13 network hosts at 0.25h = ports
 * <= 1; 35 at 0.5h = ports <= 3; 39 at 1.25h = ports <= 4; 69 at 1.75h = all).
 */
export const FRESH_PORTS = [
  [0, 0],
  [0.1, 1],
  [0.25, 2],
  [0.5, 3],
  [1.0, 4],
  [1.5, 5],
]

const toMid = (v) => (Array.isArray(v) ? (v[0] + v[1]) / 2 : num(v) ? v : null)
const ramOf = (e) => {
  if (e === null || e === undefined) return 0
  if (!Array.isArray(e)) return Math.pow(2, e)
  let s = 0
  for (let k = e[0]; k <= e[1]; k++) s += Math.pow(2, k)
  return s / (e[1] - e[0] + 1)
}

// --- the game's formulas ----------------------------------------------------

/** calculateSkill (skill.ts:7) — continuous exp to an integer level, >= 1. */
export function skillOf(exp, mult) {
  if (mult === 0) return 1
  return Math.max(1, Math.floor(mult * (32 * Math.log(Math.max(0, exp) + 534.6) - 200)))
}
/** calculateExp (skill.ts:17) without the float fix-up: the exp at a level. */
export const expAtLevel = (level, mult) => Math.max(0, Math.exp((level / mult + 200) / 32) - 534.6)
/** calculateIntelligenceBonus (intelligence.ts:1), weight 1. */
export const intBonus = (int) => 1 + Math.pow(Math.max(0, int ?? 0), 0.8) / 600
/** calculateHackingTime (Hacking.ts:60), seconds. */
export function hackTimeS(req, sec, level, speed = 1, bnSpeed = 1, int = 0) {
  const skillFactor = (2.5 * req * sec + 500) / (level + 50)
  return (5 * skillFactor) / (speed * bnSpeed * intBonus(int))
}
/** calculateHackingChance (Hacking.ts:9). */
export function hackChanceOf(req, sec, level, chance = 1, int = 0) {
  if (sec >= 100) return 0
  const skill = Math.max(1.75 * level, 1)
  return Math.min(1, Math.max(0, ((skill - req) / skill) * ((100 - sec) / 100) * chance * intBonus(int)))
}
/** calculatePercentMoneyHacked (Hacking.ts:44). */
export function hackPercentOf(req, sec, level, money = 1, shm = 1) {
  if (sec >= 100) return 0
  return Math.min(1, Math.max(0, (((100 - sec) / 100) * ((level - (req - 1)) / level) * money * shm) / 240))
}
/** calculateServerGrowthLog(server, 1 thread) (grow.ts:8), one core. */
export function growLogOf(sec, growth, growMult = 1, bnRate = 1) {
  if (!growth) return 0
  return Math.min(Math.log1p(SERVER.baseGrowthIncr / sec), SERVER.maxGrowthLog) * (growth / 100) * bnRate * growMult
}
/** numCycleForGrowthCorrected (ServerHelpers.ts), batch.js growThreads' Newton. */
export function growThreadsOf(target, start, k, moneyMax) {
  if (!(k > 0)) return Infinity
  if (start < 0) start = 0
  if (target > moneyMax) target = moneyMax
  if (target <= start) return 0
  let x = (target - start) / (1 + (target / 16 + (start * 15) / 16) * k)
  for (let guard = 0; guard < 64; guard++) {
    const ox = start + x
    const nx = (x - ox * Math.log(ox / target)) / (1 + ox * k)
    const diff = nx - x
    x = nx
    if (!(diff < -1 || diff > 1)) break
  }
  return !isFinite(x) || x < 0 ? Infinity : Math.ceil(x)
}
/** Per-thread exp base (Hacking.ts:30-38) before the player and node factors. */
export const expBaseOf = (baseDifficulty) => (baseDifficulty > 0 ? 3 + 0.3 * baseDifficulty : 0)

/**
 * THE NETWORK OF A NODE: every server as the game builds it (Server.ts:74-86)
 * at the midpoint of its ranges. `bn` is a full BitNode multiplier object
 * (bitNodeMultipliers.bitNodeMults).
 */
// Server.ts:77 — the max balance is this many times the starting base.
const MAX_OVER_BASE = 25
export function worldOf(bn) {
  const B = (k) => (num(bn?.[k]) ? bn[k] : 1)
  return SERVER_TABLE.map(([host, ramE, ports, req, diff, money, growth]) => {
    const real = num(toMid(diff)) && toMid(diff) > 0 ? toMid(diff) * B('ServerStartingSecurity') : 1
    const base = toMid(money) ?? 0
    return {
      host,
      ram: ramOf(ramE),
      ports,
      req: toMid(req) ?? 1,
      baseSec: Math.min(real, 100),
      minSec: Math.min(Math.max(1, Math.round(real / 3)), 100),
      moneyMax: MAX_OVER_BASE * base * B('ServerMaxMoney'),
      money0: base * B('ServerStartingMoney'),
      growth: toMid(growth) ?? 1,
    }
  })
}

const portsAtOf = (sched) => (h) => {
  if (num(sched)) return sched
  let p = 0
  for (const [a, k] of sched ?? FRESH_PORTS) if (h >= a) p = k
  return p
}

/**
 * A TARGET'S BATCH at a level: planBatch (batch.js:1108) against `maxGB`
 * (a quarter of its slice, as the argmax does), hack in one block <= hackGB.
 */
function planOf(t, maxGB, hackGB, weakenRate = 1) {
  const { phi, k, chance, moneyMax } = t
  const wAmt = SERVER.weakenAmt * (weakenRate > 0 ? weakenRate : 1)
  if (!(phi > 0) || !(k > 0)) return null
  const M = BATCHER.margin
  const build = (h) => {
    const f = Math.min(0.99, phi * h)
    const after = Math.max(moneyMax * (1 - f), 1)
    const g = Math.max(1, Math.ceil(growThreadsOf(moneyMax, after, k, moneyMax) * M))
    if (!isFinite(g)) return null
    const w1 = Math.ceil((SERVER.fortify * h * M) / wAmt) + 1
    const w2 = Math.ceil((2 * SERVER.fortify * g * M) / wAmt) + 1
    const gb = RAM_H * h + RAM_G * g + RAM_W * (w1 + w2)
    return { h, g, w1, w2, f, gb, money: f * moneyMax * chance, score: (f * moneyMax * chance) / gb }
  }
  let best = null
  const hFit = Math.floor(hackGB / RAM_H)
  const hMax = Math.max(1, Math.min(Math.ceil(0.99 / phi), hFit))
  for (let h = 1, i = 0; h <= hMax && i < 200; h = h < 8 ? h + 1 : Math.ceil(h * 1.3), i++) {
    const p = build(h)
    if (!p) continue
    if (p.gb > maxGB) break
    if (!best || p.score > best.score) best = p
  }
  if (best) return best
  if (hFit < 1) return null
  const one = build(1)
  return one && one.gb <= maxGB ? one : null
}

/**
 * THE MONEY TARGETS AND THEIR RATES at one level and RAM: batch.js's target
 * choice and its income model (min of saturation and the RAM-limited rate per
 * target on an even split). Returns {targets: [{host, perSec, gb, plan,
 * batchesPerSec, t}], usedGB}.
 */
function moneyTargetsOf(cands, G, hackGB, weakenRate = 1) {
  if (!cands.length || !(G > 0)) return { targets: [], usedGB: 0 }
  const S = BATCHER.spacingS
  let bestN = 1
  let bestInc = -1
  let bestSet = []
  for (let n = 1; n <= cands.length; n++) {
    const slice = G / n
    let inc = 0
    const set = []
    for (let i = 0; i < n; i++) {
      const t = cands[i]
      const p = planOf(t, slice / 4, hackGB, weakenRate)
      if (!p) continue
      const sat = p.money / (4 * S)
      const lin = (slice * p.money) / (p.gb * t.hackS * 4)
      const perSec = Math.min(sat, lin)
      inc += perSec
      set.push({ host: t.host, t, plan: p, perSec, batchesPerSec: perSec / p.money, gb: Math.min(slice, (perSec / p.money) * p.gb * 4 * t.hackS) })
    }
    if (inc > bestInc) {
      bestInc = inc
      bestN = n
      bestSet = set
    }
  }
  return { targets: bestSet, n: bestN, usedGB: bestSet.reduce((a, x) => a + x.gb, 0) }
}

/**
 * THE PREP of one target (batch.js prepares a target before its first batch):
 * security from its starting level to the floor, then money from the
 * starting balance to the max, each round one weaken time (grow launches pad
 * to land with its weaken), rounds = the threads needed over the RAM it has.
 * Returns hours.
 */
function prepHoursOf(s, level, G, P) {
  const W = (sec) => 4 * hackTimeS(s.req, sec, level, P.speed, P.bnSpeed, P.int)
  const threads = Math.max(1, Math.floor(G / RAM_W))
  const wRate = SERVER.weakenAmt * P.weakenRate
  const nW = Math.ceil((s.baseSec - s.minSec) / wRate)
  let t = nW > 0 ? Math.ceil(nW / threads) * W(s.baseSec) : 0
  const k = growLogOf(s.minSec, s.growth, P.growMult, P.bnGrowth)
  const g = growThreadsOf(s.moneyMax, s.money0, k, s.moneyMax)
  if (!isFinite(g)) return Infinity
  if (g > 0) {
    const gw = Math.ceil((2 * SERVER.fortify * g) / wRate)
    t += Math.ceil((g + gw) / threads) * W(s.minSec)
  }
  return t / 3600
}

/**
 * A FRESH LIFE, SIMULATED. Returns {pts: [{h, level, exp, expPerSec,
 * hackPerSec, cum, ramGB, farmGB, moneyGB, prepping, targets}], why} —
 * `cum` the hacking stream earned since the install ($, what tel.js records
 * as moneySources.sinceInstall.hacking), `exp` the player's hacking exp.
 *
 *   bn          BitNode multipliers (bitNodeMults(node))
 *   mults       player multipliers (ns.getPlayer().mults: hacking, hacking_exp,
 *               hacking_speed, hacking_money, hacking_grow, hacking_chance)
 *   intelligence
 *   homeGB      home RAM the batcher can use (max less its reserves)
 *   pservGB     purchased-server RAM (0 after an install until re-bought)
 *   ramAt(h)    optional {homeGB, netGB, pservGB} override per age (a recorded
 *               life's own RAM trajectory); else home + the network rooted by
 *               portsAt (FRESH_PORTS) + pservGB
 *   portsAt     [[h, ports]] or a number
 *   farmShare   share of the fleet on the exp farm (0 money mode, 1 exp mode)
 *   exp0, horizonH, grid (ages, optional)
 */
export function simulateFreshLife(o = {}) {
  const bn = o.bn ?? {}
  const B = (k) => (num(bn[k]) ? bn[k] : 1)
  const m = o.mults ?? {}
  const M = (k) => (pos(m[k]) ? m[k] : 1)
  const P = {
    speed: M('hacking_speed'),
    bnSpeed: B('HackingSpeedMultiplier'),
    int: num(o.intelligence) ? o.intelligence : 0,
    growMult: M('hacking_grow'),
    bnGrowth: B('ServerGrowthRate'),
    weakenRate: B('ServerWeakenRate'),
  }
  const levelMult = M('hacking') * B('HackingLevelMultiplier')
  const expFactor = M('hacking_exp') * B('HackExpGain')
  const shm = B('ScriptHackMoney')
  const shmGain = num(bn.ScriptHackMoneyGain) ? bn.ScriptHackMoneyGain : 1
  const world = (o.world ?? worldOf(bn)).filter((s) => s.host !== 'w0r1d_d43m0n')
  const portsAt = portsAtOf(o.portsAt)
  const horizonH = pos(o.horizonH) ? o.horizonH : 24
  const grid = Array.isArray(o.grid) && o.grid.length ? o.grid : defaultGrid(horizonH)
  const farmShareAt = typeof o.farmShare === 'function' ? o.farmShare : () => (num(o.farmShare) ? Math.min(1, Math.max(0, o.farmShare)) : 0)
  const ramAt = typeof o.ramAt === 'function' ? o.ramAt : null
  const readyAt = new Map() // host -> age its prep ends
  let exp = num(o.exp0) && o.exp0 > 0 ? o.exp0 : 0
  let cum = 0
  const pts = []
  let cache = null
  for (let i = 0; i < grid.length; i++) {
    const h = grid[i]
    const dtH = i + 1 < grid.length ? grid[i + 1] - h : 0
    const level = skillOf(exp, levelMult)
    const ports = portsAt(h)
    const r = ramAt ? ramAt(h) : null
    const netGB = r && num(r.netGB) ? r.netGB : world.reduce((a, s) => a + (s.ports <= ports ? s.ram : 0), 0)
    const homeGB = r && num(r.homeGB) ? r.homeGB : pos(o.homeGB) ? o.homeGB : 0
    const pservGB = r && num(r.pservGB) ? r.pservGB : pos(o.pservGB) ? o.pservGB : 0
    const G = Math.max(0, homeGB + netGB + pservGB)
    const farmGB = G * farmShareAt(h)
    const moneyGB = Math.max(0, G - farmGB)
    // Targets at this level (cached until the level moves 1% or the RAM 5%).
    if (!cache || Math.abs(level - cache.level) > Math.max(1, 0.01 * level) || Math.abs(G - cache.G) > 0.05 * Math.max(1, cache.G) || ports !== cache.ports) {
      const hackable = []
      for (const s of world) {
        if (s.ports > ports || !(s.moneyMax > 0) || s.req > level) continue
        const hackS = hackTimeS(s.req, s.minSec, level, P.speed, P.bnSpeed, P.int)
        const phi = hackPercentOf(s.req, s.minSec, level, M('hacking_money'), shm)
        const chance = hackChanceOf(s.req, s.minSec, level, M('hacking_chance'), P.int)
        const k = growLogOf(s.minSec, s.growth, P.growMult, P.bnGrowth)
        const score = phi > 0 && k > 0 ? (chance * s.moneyMax) / (hackS * (1.98 / phi + 6.16 / k)) : 0
        const e = expBaseOf(s.baseSec)
        const xs = expScore({ baseDifficulty: s.baseSec, hackTime: hackS * 1000, chance }, P.weakenRate, BATCHER.margin)
        hackable.push({ ...s, hackS, phi, chance, k, score, e, xs })
      }
      const ranked = hackable.filter((t) => t.score > 0).sort((a, b) => b.score - a.score)
      const bestS = ranked[0]?.score ?? 0
      const bestMoney = ranked.reduce((a, t) => Math.max(a, t.moneyMax), 0)
      const worth = ranked.filter((t) => t.score >= bestS * BATCHER.minScoreFrac && t.moneyMax >= bestMoney * BATCHER.minMoneyFrac)
      const cands = (worth.length ? worth : ranked).slice(0, BATCHER.maxTargets)
      const hackGB = Math.max(homeGB, ...world.filter((s) => s.ports <= ports).map((s) => s.ram))
      const mt = moneyTargetsOf(cands, moneyGB, hackGB, P.weakenRate)
      const farmT = hackable.filter((t) => t.xs > 0).sort((a, b) => b.xs - a.xs)[0] ?? null
      cache = { level, G, ports, mt, farmT }
    }
    // Money: prepped targets earn; a target's prep starts the first age it is chosen.
    let hackPerSec = 0
    let expPerSec = 0
    let prepGB = 0
    let usedGB = 0
    let prepping = 0
    const nT = cache.mt.targets.length
    for (const x of cache.mt.targets) {
      if (!readyAt.has(x.host)) readyAt.set(x.host, h + prepHoursOf(x.t, level, moneyGB / Math.max(1, nT), P))
      if (h >= readyAt.get(x.host)) {
        hackPerSec += x.perSec * shmGain
        const p = x.plan
        const eBatch = x.t.e * (p.h * (x.t.chance + (1 - x.t.chance) / 4) + p.g + p.w1 + p.w2)
        expPerSec += x.batchesPerSec * eBatch * expFactor
        usedGB += x.gb
      } else {
        prepping++
        const slot = moneyGB / Math.max(1, nT)
        prepGB += slot
        // Prep runs weaken/grow threads, each paying e per op of one weaken time.
        expPerSec += ((slot / RAM_W) * x.t.e * expFactor) / (4 * hackTimeS(x.t.req, x.t.baseSec, level, P.speed, P.bnSpeed, P.int))
      }
    }
    // The spill: money RAM the pipelines and prep do not hold runs weaken on
    // the head target (batch.js "spill") — exp, no money.
    const spill = Math.max(0, moneyGB - usedGB - prepGB)
    const head = cache.mt.targets[0]?.t ?? cache.farmT
    if (spill > 0 && head) expPerSec += ((spill / RAM_W) * head.e * expFactor) / (4 * head.hackS)
    // The farm: expScore is exp per GB-ms before the player/node factors.
    if (farmGB > 0 && cache.farmT) expPerSec += farmGB * cache.farmT.xs * 1000 * expFactor
    pts.push({ h, level, exp, expPerSec, hackPerSec, cum, ramGB: G, farmGB, moneyGB, prepping, targets: nT })
    exp += expPerSec * dtH * 3600
    cum += hackPerSec * dtH * 3600
  }
  return { pts, levelMult, expFactor, why: `fresh life from the game's formulas: ${world.length} servers at their expected stats, ports ${JSON.stringify(o.portsAt ?? FRESH_PORTS)}, farm ${Math.round(100 * farmShareAt(0))}% of the fleet` }
}

/** The default age grid: 1-minute steps for the first hour, 5 to 6h, 15 after. */
export function defaultGrid(horizonH = 24) {
  const g = []
  for (let h = 0; h < Math.min(1, horizonH); h += 1 / 60) g.push(h)
  for (let h = 1; h < Math.min(6, horizonH); h += 1 / 12) g.push(h)
  for (let h = 6; h <= horizonH + 1e-9; h += 0.25) g.push(h)
  if (g[g.length - 1] < horizonH) g.push(horizonH)
  return g
}

/** Linear interpolation of a series field at age h (clamped). */
export function seriesAt(pts, h, key) {
  if (!pts?.length) return null
  if (h <= pts[0].h) return pts[0][key]
  for (let i = 1; i < pts.length; i++) {
    if (h <= pts[i].h) {
      const a = pts[i - 1]
      const b = pts[i]
      return a[key] + ((b[key] - a[key]) * (h - a.h)) / (b.h - a.h || 1)
    }
  }
  return pts[pts.length - 1][key]
}

/** Mean rate of a cumulative field over [a0, a1] (per second). */
export function windowRate(pts, a0, a1, key = 'cum') {
  if (!(a1 > a0)) return null
  return (seriesAt(pts, a1, key) - seriesAt(pts, a0, key)) / ((a1 - a0) * 3600)
}

/** Hours for the simulated life to reach `level` (Infinity past the horizon). */
export function hoursToLevelIn(pts, level) {
  for (let i = 0; i < (pts?.length ?? 0); i++) if (pts[i].level >= level) return pts[i].h
  return Infinity
}

// ---------------------------------------------------------------------------
// ONE RECORDED LIFE AGAINST THE FORMULA — the residual that updates the
// formula's error (bayes.formulaErrorPosterior). One implementation, used by
// tools/sim/freshcal.mjs (lives rebuilt from history.jsonl) and by progress.js
// (lives tel.js recorded with their inputs), so the calibration offline and
// the update in the game are the same computation.
// ---------------------------------------------------------------------------

export const RESIDUAL_WINDOW_H = 0.5

const cumAtPts = (pts, h) => {
  if (!pts.length) return 0
  if (h <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (h - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0] || 1)
  return pts[pts.length - 1][1]
}

/**
 * A life's residual: ln(sum realised / sum model) over its usable windows —
 * what it EARNED over what the formula said at the same ages, not a mean of
 * per-window logs: a bursty stream (BN9's farm-mode hacking lands in spikes,
 * $0.6/s between them) has a meaningless geometric mean and a well-defined
 * total. `wk` weights a window (a reconstructed legacy window's bracket).
 */
export function residualOf(ws, rk, mk, wk = null) {
  let sr = 0
  let sm = 0
  let w = 0
  let n = 0
  for (const x of ws ?? []) {
    const r = x[rk]
    const m = x[mk]
    if (!(num(r) && r >= 0 && m > 0) || x.covered === false) continue
    const wt = (x.a1 - x.a0) * (wk ? x[wk] ?? 1 : 1)
    sr += wt * r
    sm += wt * m
    w += x.a1 - x.a0
    n++
  }
  return n && sr > 0 && sm > 0 ? { ln: Math.log(sr / sm), hours: w, windows: n } : null
}

/**
 * REPLAY ONE LIFE on its own inputs and score it.
 *   track     [[ageH, hackExp, homeRam, pservGB, netGB]] as recorded (sorted)
 *   earnings  tel.js samples [[ageH, total, hacking]] (null: no income score)
 *   reserveGB home RAM the batcher leaves (progress.js's raise + the stack)
 *   farmShare number or (h) => share
 *   legacy    {windowFn: bayes.legacyHackingWindow, bounds: PRIORS.legacyNonHack,
 *             lifeSd: PRIORS.incomeLifeSdLn} — for lives recorded before the
 *             hacking stream was split out; absent -> such windows are skipped
 * Returns {sim, exp, income, expWindows, incomeWindows, endH}.
 */
export function replayLife({ bn, mults, intelligence = 0, reserveGB = 0, track, earnings = null, farmShare = 0, legacy = null, windowH = RESIDUAL_WINDOW_H } = {}) {
  const recs = (track ?? []).filter((r) => Array.isArray(r) && num(r[0]) && num(r[1])).sort((a, b) => a[0] - b[0])
  if (recs.length < 2) return null
  const endH = recs[recs.length - 1][0]
  const at = (h) => {
    let r = recs[0]
    for (const x of recs) if (x[0] <= h) r = x
    return r
  }
  const sim = simulateFreshLife({
    bn,
    mults,
    intelligence,
    horizonH: Math.max(windowH, endH),
    ramAt: (h) => {
      const r = at(h)
      return { homeGB: Math.max(0, (r[2] ?? 0) - reserveGB), pservGB: r[3] ?? 0, netGB: r[4] ?? 0 }
    },
    farmShare,
  })
  const expPts = recs.map((r) => [r[0], r[1]])
  // COVERED: a record within 0.2h of both ends (history.jsonl has gaps — a
  // daemon down for 10h leaves two records, and interpolating between them
  // invents a flat life).
  const near = (h) => recs.some((x) => Math.abs(x[0] - h) <= 0.2)
  const expWindows = []
  for (let a0 = 0; a0 + windowH <= endH + 1e-9; a0 += windowH) {
    const a1 = a0 + windowH
    expWindows.push({ a0, a1, expReal: (cumAtPts(expPts, a1) - cumAtPts(expPts, a0)) / (windowH * 3600), expModel: windowRate(sim.pts, a0, a1, 'exp'), covered: near(a0) && near(a1) })
  }
  let incomeWindows = null
  if (Array.isArray(earnings) && earnings.length >= 2) {
    const split = earnings.filter((q) => Array.isArray(q) && num(q[0]) && num(q[2])).sort((a, b) => a[0] - b[0])
    const tot = earnings.filter((q) => Array.isArray(q) && num(q[0]) && num(q[1])).map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0])
    const endE = Math.min(endH, earnings[earnings.length - 1][0])
    incomeWindows = []
    // A LIFE SPLIT MID-WAY (tel.js began recording the hacking stream while it
    // ran): its first split sample is the hacking earned since the install —
    // one exact window [0, a_s], which beats reconstructing the windows before
    // it from totals.
    const aS = split.length ? split[0][0] : null
    if (aS !== null && aS > windowH && aS <= endH + 1e-9) incomeWindows.push({ a0: 0, a1: aS, incReal: Math.max(0, split[0][2]) / (aS * 3600), incModel: windowRate(sim.pts, 0, aS, 'cum'), kind: 'split-cumulative', weight: 1 })
    const splitPts = split.map((q) => [q[0], q[2]])
    for (let a0 = 0; a0 + windowH <= endE + 1e-9; a0 += windowH) {
      const a1 = a0 + windowH
      if (aS !== null && aS > windowH && a0 < aS - 1e-9) continue
      const model = windowRate(sim.pts, a0, a1, 'cum')
      let real = null
      let kind = null
      let weight = 1
      // A split sample within 0.05h of the install is the stream from the start.
      if (split.length >= 2 && split[0][0] <= a0 + 0.05) {
        real = (cumAtPts(splitPts, a1) - cumAtPts(splitPts, a0)) / (windowH * 3600)
        kind = 'split'
      } else if (tot.length >= 2 && legacy && typeof legacy.windowFn === 'function') {
        const hackCap = split.length ? Math.max(0, split[split.length - 1][2]) : Infinity
        const rec = legacy.windowFn(tot, a0, a1, { cash0: 0, hackCap, ...legacy.bounds })
        if (rec.ok) {
          real = rec.perSec
          kind = 'reconstructed'
          const s0 = legacy.lifeSd
          weight = (s0 * s0) / (s0 * s0 + rec.bracketLn ** 2 / 12)
        } else kind = 'inseparable'
      }
      incomeWindows.push({ a0, a1, incReal: real, incModel: model, kind, weight })
    }
  }
  const shmGain = num(bn?.ScriptHackMoneyGain) ? bn.ScriptHackMoneyGain : 1
  return {
    sim,
    endH,
    expWindows,
    incomeWindows,
    exp: residualOf(expWindows, 'expReal', 'expModel'),
    // Where scripted hacking pays nothing (BN8) there is no income to score.
    income: shmGain === 0 ? null : residualOf(incomeWindows, 'incReal', 'incModel', 'weight'),
  }
}

// ---------------------------------------------------------------------------
// THE LIVES THE FORMULA HAS BEEN SCORED ON.
//
// Seed: tools/sim/freshcal.mjs --seed, the completed lives recorded before
// tel.js carried the formula's inputs — each rebuilt from history.jsonl (exp,
// home RAM, purchased servers, rooted count, augmentations -> multipliers) and
// the earnings ledger (the hacking stream). [startMs, node, expLn, expHours,
// incomeLn, incomeHours]: ln(realised / formula) over the life and the hours
// it covers (null: not scoreable — no exp record, or hacking paid nothing).
// Every life tel.js records from 2026-09-29 on is scored in the game
// (progress.js freshResidualsOf -> /tel/freshcal.txt) and joins these; a
// ledger life within 15 minutes of a seed life is the same life, counted once.
// ---------------------------------------------------------------------------
// freshcal.mjs --seed 2026-09-29T13:10Z: 36 completed lives (tracks at 5-minute resolution, as tel.js records)
export const FRESH_CALIBRATION = [
  [1790072722605, 10, -0.1611, 2, null, null],
  [1790081156036, 10, 0.0083, 1, null, null],
  [1790121927666, 10, 0.2048, 3, null, null],
  [1790133636705, 10, -0.3026, 0.5, null, null],
  [1790161512939, 10, 0.2267, 1, null, null],
  [1790166632545, 10, -0.0927, 1, null, null],
  [1790213364431, 10, 0.1202, 0.5, null, null],
  [1790216393224, 10, -0.3013, 8.5, null, null],
  [1790248980141, 10, 2.1869, 2, null, null],
  [1790256234246, 10, 3.4526, 7.5, null, null],
  [1790286583227, 10, 0.8538, 3.5, null, null],
  [1790332220139, 10, 1.061, 2, null, null],
  [1790340736448, 8, -0.6314, 1.5, null, null],
  [1790347700781, 8, -0.6405, 6, null, null],
  [1790370707151, 8, -0.8261, 0.5, null, null],
  [1790374348825, 8, -0.868, 1, null, null],
  [1790379476046, 8, -0.8926, 2, null, null],
  [1790388509411, 8, -0.8081, 0.5, null, null],
  [1790390640217, 8, -0.9316, 0.5, null, null],
  [1790395442387, 8, -1.2806, 4, null, null],
  [1790410464733, 8, -0.6848, 3, null, null],
  [1790421450622, 8, -0.6822, 2, null, null],
  [1790428679319, 8, -1.5214, 8.5, null, null],
  [1790535870584, 8, -3.8636, 1.5, null, null],
  [1790542209511, 1, 0.6364, 2.5, null, null],
  [1790552027343, 1, 0.1283, 0.5, null, null],
  [1790554106852, 1, -0.316, 1, null, null],
  [1790557723669, 1, -0.3327, 0.5, null, null],
  [1790559855463, 1, 0.3857, 1, null, null],
  [1790565873608, 1, -0.328, 2.5, -1.2136, 0.5],
  [1790575185120, 1, 2.2035, 3, -0.336, 1],
  [1790586298324, 1, -0.9563, 0.5, null, null],
  [1790588104677, 1, 0.0391, 2, 1.6341, 2],
  [1790596517394, 1, 0.3277, 0.5, 6.1989, 0.5],
  [1790600461510, 1, 1.7736, 5.5, 0.2316, 5.5],
  [1790620682962, 9, 0.6526, 11, -0.2757, 10.48],
]

/** The home RAM the resident stack holds besides progress.js's raise (stated; freshcal.mjs uses the same). */
export const HOME_STACK_GB = 64
/** batch.js SETTINGS.homeReserve: progress.js's Singularity raise, 13 + 6.25 x the SF4 multiplier. */
export const homeReserveGb = (singMult) => 13 + 6.25 * (num(singMult) ? singMult : 16) + HOME_STACK_GB

/**
 * Every scored life as residual lists for bayes.formulaErrorPosterior:
 * {income: [{ln, hours, node, life}], exp: [...], lives, seedLives, ledgerLives}.
 * `scored` the in-game cache {lives: {key: {node, exp, income}}}; `exclude` a
 * life key (the running life: its own measurement enters within the life).
 */
export function calibrationResiduals(scored = null, { seed = FRESH_CALIBRATION, exclude = null } = {}) {
  const out = { income: [], exp: [] }
  const keys = []
  const same = (a, b) => Math.abs(Number(a) - Number(b)) < 15 * 60e3
  const skip = (k) => exclude !== null && same(k, exclude)
  for (const [k, node, eLn, eH, iLn, iH] of seed ?? []) {
    if (skip(k)) continue
    keys.push(k)
    if (num(eLn) && pos(eH)) out.exp.push({ ln: eLn, hours: eH, node, life: String(k) })
    if (num(iLn) && pos(iH)) out.income.push({ ln: iLn, hours: iH, node, life: String(k) })
  }
  let ledgerLives = 0
  for (const [k, r] of Object.entries(scored?.lives ?? {})) {
    if (skip(k) || keys.some((s) => same(s, k))) continue
    ledgerLives++
    if (num(r?.exp?.ln) && pos(r.exp.hours)) out.exp.push({ ln: r.exp.ln, hours: r.exp.hours, node: r.node, life: k })
    if (num(r?.income?.ln) && pos(r.income.hours)) out.income.push({ ln: r.income.ln, hours: r.income.hours, node: r.node, life: k })
  }
  return { ...out, seedLives: keys.length, ledgerLives }
}

/**
 * A LIFE tel.js RECORDED WITH ITS INPUTS, scored: its samples [ageH, total,
 * hacking, hackExp, homeRam, pservGB, netGB, farmShare] and `inputs` {mults,
 * intelligence} replayed through replayLife. Null when the life lacks them
 * (recorded before 2026-09-29, or too short). `reserveGB` the home reserve.
 */
export function scoreRecordedLife(life, bn, reserveGB, legacy = null) {
  if (!life?.inputs?.mults || !Array.isArray(life.samples)) return null
  const rows = life.samples.filter((q) => Array.isArray(q) && num(q[0]) && num(q[3]))
  if (rows.length < 2) return null
  const track = rows.map((q) => [q[0], q[3], num(q[4]) ? q[4] : 0, num(q[5]) ? q[5] : 0, num(q[6]) ? q[6] : 0])
  const farm = rows.map((q) => [q[0], num(q[7]) ? q[7] : null])
  const farmShare = (h) => {
    let v = 0
    for (const [a, f] of farm) if (a <= h && f !== null) v = f
    return v
  }
  const r = replayLife({ bn, mults: life.inputs.mults, intelligence: life.inputs.intelligence ?? 0, reserveGB, track, earnings: life.samples, farmShare, legacy })
  return r ? { exp: r.exp, income: r.income, endH: r.endH } : null
}

/**
 * THE FRESH-LIFE EXP LAG the exit's level-scaled climb does not carry: the
 * hours a simulated fresh life runs behind the (level + 50)-shaped rate of
 * its own mature fleet (the network re-rooted, targets prepped), read at the
 * end of the series. 0 when the series is too short to say.
 */
export function freshLagH(pts, levelMult) {
  if (!Array.isArray(pts) || pts.length < 3) return 0
  const end = pts[pts.length - 1]
  if (!(end.expPerSec > 0) || !(end.level > 0) || !pos(levelMult)) return 0
  const k = end.expPerSec / (end.level + 50)
  // Hours the mature fleet needs to earn `end.exp` from 0: integrate level by
  // level in the same continuous form exitplan does.
  const lvl = (e) => Math.max(1, levelMult * (32 * Math.log(e + 534.6) - 200))
  let e = 0
  let t = 0
  for (let i = 0; i < 5000 && e < end.exp; i++) {
    const r = k * (lvl(e) + 50)
    const step = Math.max(1, 0.01 * (e + 534.6))
    t += Math.min(step, end.exp - e) / r
    e += step
  }
  return Math.max(0, end.h - t / 3600)
}

/** A series compacted for the cache and the exit inputs: [[h, level, exp, expPerSec, hackPerSec, cum]]. */
export const compactPts = (pts) => (pts ?? []).map((p) => [+p.h.toFixed(4), p.level, Math.round(p.exp), +p.expPerSec.toPrecision(4), +p.hackPerSec.toPrecision(4), Math.round(p.cum)])
export const expandPts = (rows, levelMult = null) => (rows ?? []).map((r) => ({ h: r[0], level: r[1], exp: r[2], expPerSec: r[3], hackPerSec: r[4], cum: r[5], levelMult }))
