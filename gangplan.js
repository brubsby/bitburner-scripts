// Gang management as arithmetic. Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// WHY A GANG, AND WHY IT IS THE WHOLE RUN IN BITNODE 2
//
// A gang converts member stats into three things every 2-second cycle
// (Gang/Gang.ts:processGains): RESPECT, which unlocks recruits and becomes
// faction reputation at respect x faction_rep x (1 + favor/100) / 75; MONEY,
// paid straight to the player; and WANTED level, which scales everything by
// respect / (respect + wanted). The gang's faction sells almost every
// augmentation in the game, so in a node where a gang can be formed the
// gang faction is not one faction among many — it is the augmentation
// ladder, with reputation that never has to be ground at a desk.
//
// ---------------------------------------------------------------------------
// FORMULAS, all from Gang/formulas/formulas.ts and Gang/GangMember.ts
//
//   statWeight(task, m) = sum_stat task.<stat>Weight/100 x m.<stat>
//   respect/cycle = (11 x baseRespect x (sw - 4d) x terrR x pen) ^ soft
//   money/cycle   = ( 5 x baseMoney   x (sw - 3.2d) x terrM x pen) ^ soft
//   wanted/cycle  =  7 x baseWanted / (3 x (sw - 3.5d) x terrW) ^ 0.8, capped at 100
//                   (or 0.4 x baseWanted x (sw - 3.5d) x terrW for negative baseWanted)
//   terrX = max(0.005, (territory x 100) ^ task.territory.X / 100)
//   pen   = respect / (respect + wanted)
//   soft  = (0.2 x territory + 0.8) x GangSoftcap
//   exp/cycle per stat = weight/1500 x difficulty^0.9 x ((mult-1)/4 + 1) x ascMult
//   skill = max(floor(mult x ascMult x (32 ln(exp + 534.5) - 200)), 1)
//   ascMult(points) = max(sqrt(points / 2000), 1); ascending banks max(exp - 1000, 0)
//   points per stat, zeroes exp and upgrades, and costs the gang the member's
//   earnedRespect (Gang.ts:393).
//   recruits allowed = floor(max(ln respect, 0) / ln 5) + 3, max 12
//   equipment cost = base / discount, discount = respect^0.01 + respect/5e6
//                    + power^0.01 + power/1e6 - 1, floored at 1
//
// gangplan.test.mjs [GP1] parses tasks.ts and upgrades.ts and fails on drift.
//
// ---------------------------------------------------------------------------
// THE DECISIONS THIS MODULE MAKES
//
// assign(): one task per member. Below twelve members the objective is
// RESPECT, because each recruit multiplies every later gain; at twelve it is
// whatever the caller says is binding (`mode`: 'respect' for reputation,
// 'money'). Wanted is held down by assigning the justice task to as many
// members as needed to keep the wanted rate <= 0 whenever the penalty would
// otherwise fall below `minPenalty`. A member whose stats cannot clear any
// productive task's difficulty threshold trains the stats that task weighs.
//
// shouldAscend(): ascend when the multiplier gain on the gang's primary
// stats is at least `minGain`, AND the respect left after paying the
// member's earnedRespect keeps every current recruit — losing a member to
// an ascension is a loss the multiplier does not repay for hours.
//
// bestEquipment(): the cheapest multiplier per dollar across what a member
// does not own, within a budget the caller has already cleared with
// budget.js. Augmentations (the 5-50 billion tier) survive ascension;
// everything else is wiped by it, which the ranking accounts for by
// pricing non-augmentation gear against the time to the member's next
// ascension.

const num = (x) => typeof x === 'number' && isFinite(x)

export const CYCLE_SEC = 0.2 // CONSTANTS.MilliPerCycle
export const MAX_MEMBERS = 12
export const FREE_MEMBERS = 3
export const RECRUIT_BASE = 5
export const RESPECT_TO_REP = 75
export const ASC_POINTS_FLOOR = 1000
export const KARMA_FOR_GANG = -54000 // GangConstants.GangKarmaRequirement, outside BitNode 2

/** GangConstants.Names — the factions that can host a gang; the last two are hacking gangs. */
export const GANG_FACTIONS = ['Slum Snakes', 'Tetrads', 'The Syndicate', 'The Dark Army', 'Speakers for the Dead', 'NiteSec', 'The Black Hand']
export const HACKING_GANGS = ['NiteSec', 'The Black Hand']

const T = (name, o) => ({
  name,
  baseRespect: 0, baseWanted: 0, baseMoney: 0, difficulty: 1,
  hackWeight: 0, strWeight: 0, defWeight: 0, dexWeight: 0, agiWeight: 0, chaWeight: 0,
  territory: { money: 1, respect: 1, wanted: 1 },
  isCombat: true, isHacking: true,
  ...o,
})

/** Gang/data/tasks.ts, transcribed. Names are the game's GangTaskName strings. */
export const TASKS = [
  T('Unassigned', { hackWeight: 100 }),
  T('Ransomware', { baseRespect: 0.00005, baseWanted: 0.0001, baseMoney: 3, hackWeight: 100, difficulty: 1, isCombat: false }),
  T('Phishing', { baseRespect: 0.00008, baseWanted: 0.003, baseMoney: 7.5, hackWeight: 85, chaWeight: 15, difficulty: 3.5, isCombat: false }),
  T('Identity Theft', { baseRespect: 0.0001, baseWanted: 0.075, baseMoney: 18, hackWeight: 80, chaWeight: 20, difficulty: 5, isCombat: false }),
  T('DDoS Attacks', { baseRespect: 0.0004, baseWanted: 0.2, hackWeight: 100, difficulty: 8, isCombat: false }),
  T('Plant Virus', { baseRespect: 0.0006, baseWanted: 0.4, hackWeight: 100, difficulty: 12, isCombat: false }),
  T('Fraud & Counterfeiting', { baseRespect: 0.0004, baseWanted: 0.3, baseMoney: 45, hackWeight: 80, chaWeight: 20, difficulty: 20, isCombat: false }),
  T('Money Laundering', { baseRespect: 0.001, baseWanted: 1.25, baseMoney: 360, hackWeight: 75, chaWeight: 25, difficulty: 25, isCombat: false }),
  T('Cyberterrorism', { baseRespect: 0.01, baseWanted: 6, hackWeight: 80, chaWeight: 20, difficulty: 36, isCombat: false }),
  T('Ethical Hacking', { baseWanted: -0.001, baseMoney: 3, hackWeight: 90, chaWeight: 10, difficulty: 1, isCombat: false }),
  T('Mug People', { baseRespect: 0.00005, baseWanted: 0.00005, baseMoney: 3.6, strWeight: 25, defWeight: 25, dexWeight: 25, agiWeight: 10, chaWeight: 15, difficulty: 1, isHacking: false }),
  T('Deal Drugs', { baseRespect: 0.00006, baseWanted: 0.002, baseMoney: 15, agiWeight: 20, dexWeight: 20, chaWeight: 60, difficulty: 3.5, territory: { money: 1.2, respect: 1, wanted: 1.15 }, isHacking: false }),
  T('Strongarm Civilians', { baseRespect: 0.00004, baseWanted: 0.02, baseMoney: 7.5, hackWeight: 10, strWeight: 25, defWeight: 25, dexWeight: 20, agiWeight: 10, chaWeight: 10, difficulty: 5, territory: { money: 1.6, respect: 1.1, wanted: 1.5 }, isHacking: false }),
  T('Run a Con', { baseRespect: 0.00012, baseWanted: 0.05, baseMoney: 45, strWeight: 5, defWeight: 5, agiWeight: 25, dexWeight: 25, chaWeight: 40, difficulty: 14, isHacking: false }),
  T('Armed Robbery', { baseRespect: 0.00014, baseWanted: 0.1, baseMoney: 114, hackWeight: 20, strWeight: 15, defWeight: 15, agiWeight: 10, dexWeight: 20, chaWeight: 20, difficulty: 20, isHacking: false }),
  T('Traffick Illegal Arms', { baseRespect: 0.0002, baseWanted: 0.24, baseMoney: 174, hackWeight: 15, strWeight: 20, defWeight: 20, dexWeight: 20, chaWeight: 25, difficulty: 32, territory: { money: 1.4, respect: 1.3, wanted: 1.25 }, isHacking: false }),
  T('Threaten & Blackmail', { baseRespect: 0.0002, baseWanted: 0.125, baseMoney: 72, hackWeight: 25, strWeight: 25, dexWeight: 25, chaWeight: 25, difficulty: 28, isHacking: false }),
  T('Human Trafficking', { baseRespect: 0.004, baseWanted: 1.25, baseMoney: 360, hackWeight: 30, strWeight: 5, defWeight: 5, dexWeight: 30, chaWeight: 30, difficulty: 36, territory: { money: 1.5, respect: 1.5, wanted: 1.6 }, isHacking: false }),
  T('Terrorism', { baseRespect: 0.01, baseWanted: 6, hackWeight: 20, strWeight: 20, defWeight: 20, dexWeight: 20, chaWeight: 20, difficulty: 36, territory: { money: 1, respect: 2, wanted: 2 }, isHacking: false }),
  T('Vigilante Justice', { baseWanted: -0.001, hackWeight: 20, strWeight: 20, defWeight: 20, dexWeight: 20, agiWeight: 20, difficulty: 1, territory: { money: 1, respect: 1, wanted: 0.9 } }),
  T('Train Combat', { strWeight: 25, defWeight: 25, dexWeight: 25, agiWeight: 25, difficulty: 100 }),
  T('Train Hacking', { hackWeight: 100, difficulty: 45 }),
  T('Train Charisma', { chaWeight: 100, difficulty: 8 }),
  T('Territory Warfare', { hackWeight: 15, strWeight: 20, defWeight: 20, dexWeight: 20, agiWeight: 20, chaWeight: 5, difficulty: 5 }),
]
export const TASK = Object.fromEntries(TASKS.map((t) => [t.name, t]))

/** Gang/data/upgrades.ts, transcribed. `type`: w/a/v/r/g (weapon, armor, vehicle, rootkit, augmentation). */
export const UPGRADES = [
  ['Baseball Bat', 1e6, 'w', { str: 1.04, def: 1.04 }],
  ['Katana', 12e6, 'w', { str: 1.08, def: 1.08, dex: 1.08 }],
  ['Malorian-3516', 25e6, 'w', { str: 1.1, def: 1.1, dex: 1.1, agi: 1.1 }],
  ['Hansen-HA7', 50e6, 'w', { str: 1.12, def: 1.1, agi: 1.1 }],
  ['Arasaka-HJSH18', 60e6, 'w', { str: 1.2, def: 1.15 }],
  ['Militech-M251s', 100e6, 'w', { str: 1.25, def: 1.2 }],
  ['Nokota-D5', 150e6, 'w', { str: 1.3, def: 1.25 }],
  ['Techtronika-SPT32', 225e6, 'w', { str: 1.3, dex: 1.25, agi: 1.3 }],
  ['Bulletproof Vest', 2e6, 'a', { def: 1.04 }],
  ['Full Body Armor', 5e6, 'a', { def: 1.08 }],
  ['Liquid Body Armor', 25e6, 'a', { def: 1.15, agi: 1.15 }],
  ['Graphene Plating Armor', 40e6, 'a', { def: 1.2 }],
  ['Herrera Outlaw GTS', 3e6, 'v', { agi: 1.04, cha: 1.04 }],
  ['Yaiba ASM-R250 Muramasa', 9e6, 'v', { agi: 1.08, cha: 1.08 }],
  ['Rayfield Caliburn', 18e6, 'v', { agi: 1.12, cha: 1.12 }],
  ['Quadra Sport R-7', 30e6, 'v', { agi: 1.16, cha: 1.16 }],
  ['NUKE Rootkit', 5e6, 'r', { hack: 1.05 }],
  ['Soulstealer Rootkit', 25e6, 'r', { hack: 1.1 }],
  ['Demon Rootkit', 75e6, 'r', { hack: 1.15 }],
  ['Hmap Node', 40e6, 'r', { hack: 1.12 }],
  ['Jack the Ripper', 75e6, 'r', { hack: 1.15 }],
  ['Bionic Arms', 10e9, 'g', { str: 1.3, dex: 1.3 }],
  ['Bionic Legs', 10e9, 'g', { agi: 1.6 }],
  ['Bionic Spine', 15e9, 'g', { str: 1.15, def: 1.15, dex: 1.15, agi: 1.15 }],
  ['BrachiBlades', 20e9, 'g', { str: 1.4, def: 1.4 }],
  ['Nanofiber Weave', 12e9, 'g', { str: 1.2, def: 1.2 }],
  ['Synthetic Heart', 25e9, 'g', { str: 1.5, agi: 1.5 }],
  ['Synfibril Muscle', 15e9, 'g', { str: 1.3, def: 1.3 }],
  ['BitWire', 5e9, 'g', { hack: 1.05 }],
  ['Neuralstimulator', 10e9, 'g', { hack: 1.15 }],
  ['DataJack', 7.5e9, 'g', { hack: 1.1 }],
  ['Graphene Bone Lacings', 50e9, 'g', { str: 1.7, def: 1.7 }],
].map(([name, cost, type, mults]) => ({ name, cost, type, mults }))

export const STATS = ['hack', 'str', 'def', 'dex', 'agi', 'cha']

/** Player.canAccessGang (PlayerObjectGangMethods.ts:12): free in BN2, else SF2 and karma <= -54000. */
export function gangAllowed({ bitNode, sf2, karma, disabled = false } = {}) {
  if (disabled) return { ok: false, why: 'gang disabled by BitNode options' }
  if (bitNode === 2) return { ok: true }
  if (!(sf2 > 0)) return { ok: false, why: 'no Source-File 2' }
  if (!num(karma)) return { ok: false, why: 'karma unreadable' }
  if (karma > KARMA_FOR_GANG) return { ok: false, why: `karma ${Math.round(karma)} must reach ${KARMA_FOR_GANG}` }
  return { ok: true }
}

export const ascMult = (points) => Math.max(Math.sqrt((num(points) ? points : 0) / 2000), 1)
export const skillOf = (exp, mult) => Math.max(Math.floor(mult * (32 * Math.log(exp + 534.5) - 200)), 1)
export const wantedPenalty = (g) => g.respect / (g.respect + g.wantedLevel)

export function statWeight(task, m) {
  return (task.hackWeight / 100) * m.hack + (task.strWeight / 100) * m.str + (task.defWeight / 100) * m.def + (task.dexWeight / 100) * m.dex + (task.agiWeight / 100) * m.agi + (task.chaWeight / 100) * m.cha
}
const terr = (g, exp) => Math.max(0.005, Math.pow(g.territory * 100, exp) / 100)
const soft = (g, softcap) => (0.2 * g.territory + 0.8) * softcap

/** Per-cycle gains of one member on one task. `g`: {respect, wantedLevel, territory}; `softcap`: GangSoftcap. */
export function respectGain(g, m, task, softcap) {
  if (task.baseRespect === 0) return 0
  const sw = statWeight(task, m) - 4 * task.difficulty
  if (sw <= 0) return 0
  return Math.pow(11 * task.baseRespect * sw * terr(g, task.territory.respect) * wantedPenalty(g), soft(g, softcap))
}
export function moneyGain(g, m, task, softcap) {
  if (task.baseMoney === 0) return 0
  const sw = statWeight(task, m) - 3.2 * task.difficulty
  if (sw <= 0) return 0
  return Math.pow(5 * task.baseMoney * sw * terr(g, task.territory.money) * wantedPenalty(g), soft(g, softcap))
}
export function wantedGain(g, m, task) {
  if (task.baseWanted === 0) return 0
  const sw = statWeight(task, m) - 3.5 * task.difficulty
  if (sw <= 0) return 0
  const tm = terr(g, task.territory.wanted)
  if (task.baseWanted < 0) return 0.4 * task.baseWanted * sw * tm
  return Math.min(100, (7 * task.baseWanted) / Math.pow(3 * sw * tm, 0.8))
}
/** Exp per cycle per stat (GangMember.ts:calculateExpGain). `m` carries <stat>_mult and <stat>_asc_points. */
export function expGain(task, m) {
  const d = Math.pow(task.difficulty, 0.9)
  const out = {}
  for (const s of STATS) {
    const mult = ((m[`${s}_mult`] ?? 1) - 1) / 4 + 1
    out[s] = ((task[`${s}Weight`] ?? 0) / 1500) * d * mult * ascMult(m[`${s}_asc_points`])
  }
  return out
}

/** Respect needed to hold `n` members (getRecruitsAvailable inverted): 5^(n-3) beyond the three free ones. */
export const respectForMembers = (n) => (n <= FREE_MEMBERS ? 0 : Math.pow(RECRUIT_BASE, n - FREE_MEMBERS))
export const recruitsAllowed = (respect) => Math.min(MAX_MEMBERS, Math.floor(Math.max(Math.log(Math.max(respect, 1e-9)), 0) / Math.log(RECRUIT_BASE)) + FREE_MEMBERS)

/** Gang.ts:getDiscount. */
export function discount(respect, power) {
  return Math.max(1, Math.pow(respect, 0.01) + respect / 5e6 + Math.pow(power, 0.01) + power / 1e6 - 1)
}

/** The productive tasks a gang of this kind can use (tasks.ts isHacking / isCombat flags). */
export const tasksFor = (isHackingGang) => TASKS.filter((t) => (isHackingGang ? t.isHacking : t.isCombat) && t.name !== 'Unassigned' && t.name !== 'Territory Warfare')

/**
 * One task per member. `g`: {respect, wantedLevel, territory, isHacking};
 * `members`: getMemberInformation objects; `o`: {softcap, mode: 'respect'|'money', minPenalty=0.9}.
 * Returns `{ assignments: {name: task}, why: {name: reason}, rates: {respect, money, wanted} }`
 * in per-second units, or null when inputs are unreadable.
 */
export function assign(g, members, o = {}) {
  if (!g || !num(g.respect) || !num(g.wantedLevel) || !num(g.territory) || typeof g.isHacking !== 'boolean') return null
  if (!Array.isArray(members) || !num(o.softcap)) return null
  const minPenalty = num(o.minPenalty) ? o.minPenalty : 0.9
  const mode = members.length < MAX_MEMBERS ? 'respect' : o.mode === 'money' ? 'money' : 'respect'
  const pool = tasksFor(g.isHacking)
  const justice = g.isHacking ? TASK['Ethical Hacking'] : TASK['Vigilante Justice']
  const train = g.isHacking ? TASK['Train Hacking'] : TASK['Train Combat']
  const assignments = {}
  const why = {}
  const picks = []
  for (const m of members) {
    let best = null
    for (const t of pool) {
      if (t.baseRespect === 0 && t.baseMoney === 0) continue
      const value = mode === 'money' ? moneyGain(g, m, t, o.softcap) : respectGain(g, m, t, o.softcap)
      if (value > 0 && (!best || value > best.value)) best = { task: t, value, wanted: wantedGain(g, m, t) }
    }
    if (!best) {
      // Nothing clears its difficulty: train what the cheapest productive task weighs.
      assignments[m.name] = train.name
      why[m.name] = 'no productive task clears its difficulty at these stats'
      continue
    }
    picks.push({ m, best })
  }
  // Wanted control: while the projected penalty is below the floor, move the
  // member whose switch costs the least value to the justice task.
  let wantedRate = picks.reduce((a, p) => a + p.best.wanted, 0)
  // Per-cycle wanted gain is tiny against the level, so the honest check is
  // the SIGN at the current penalty: if the penalty is already under the
  // floor and wanted is still rising, convert members until it falls.
  const pen = wantedPenalty(g)
  picks.sort((a, b) => a.best.value - b.best.value)
  let converted = 0
  while (pen < minPenalty && wantedRate > 0 && converted < picks.length) {
    const p = picks[converted++]
    wantedRate += wantedGain(g, p.m, justice) - p.best.wanted
    assignments[p.m.name] = justice.name
    why[p.m.name] = `wanted penalty ${pen.toFixed(3)} below ${minPenalty}: lowering wanted`
  }
  for (const p of picks.slice(converted)) {
    assignments[p.m.name] = p.best.task.name
    why[p.m.name] = `${mode}: ${p.best.task.name} best at ${p.best.value.toExponential(2)}/cycle`
  }
  const rates = { respect: 0, money: 0, wanted: 0 }
  for (const m of members) {
    const t = TASK[assignments[m.name]]
    rates.respect += respectGain(g, m, t, o.softcap) / CYCLE_SEC
    rates.money += moneyGain(g, m, t, o.softcap) / CYCLE_SEC
    rates.wanted += wantedGain(g, m, t) / CYCLE_SEC
  }
  return { assignments, why, rates, mode }
}

/**
 * Ascend? `m` is the member, `result` the game's getAscensionResult (ratio
 * per stat, plus `respect` it would cost), `g` the gang. Requires the
 * geometric-mean gain over the gang's primary stats >= minGain and that
 * the respect left keeps every current member.
 */
export function shouldAscend(m, result, g, o = {}) {
  if (!result || !g || !num(g.respect)) return { ascend: false, why: 'unreadable' }
  const minGain = num(o.minGain) ? o.minGain : 1.25
  const stats = g.isHacking ? ['hack'] : ['str', 'def', 'dex', 'agi']
  const gain = Math.pow(stats.reduce((a, s) => a * (num(result[s]) ? result[s] : 1), 1), 1 / stats.length)
  if (!(gain >= minGain)) return { ascend: false, why: `gain x${gain.toFixed(3)} below x${minGain}`, gain }
  const left = g.respect - (num(result.respect) ? result.respect : 0)
  const need = respectForMembers(o.members ?? MAX_MEMBERS)
  if (left < need) return { ascend: false, why: `would drop respect to ${left.toFixed(0)}, below the ${need.toFixed(0)} that keeps ${o.members} members`, gain }
  return { ascend: true, why: `gain x${gain.toFixed(3)}, respect ${left.toFixed(0)} keeps every member`, gain }
}

/**
 * The best purchase for one member within `budget`: highest multiplier gain
 * per dollar on the stats the gang uses. Returns `{name, cost, gainPerDollar}` or null.
 * `owned`: names held; `disc`: the gang discount (cost is base / disc).
 */
export function bestEquipment(m, owned, budget, disc, isHacking) {
  if (!num(budget) || budget <= 0 || !num(disc) || disc < 1) return null
  const stats = isHacking ? ['hack', 'cha'] : ['str', 'def', 'dex', 'agi', 'cha']
  let best = null
  for (const u of UPGRADES) {
    if (owned?.includes(u.name)) continue
    const cost = u.cost / disc
    if (cost > budget) continue
    let ln = 0
    for (const s of stats) if (u.mults[s]) ln += Math.log(u.mults[s])
    if (ln <= 0) continue
    const gpd = ln / cost
    if (!best || gpd > best.gainPerDollar) best = { name: u.name, cost, gainPerDollar: gpd, type: u.type }
  }
  return best
}

// ---------------------------------------------------------------------------
// THE RESPECT TRAJECTORY. The gang faction cannot be worked (Singularity.ts
// refuses workForFaction for it) — its reputation arrives passively as
//
//     rep += faction_rep x GROSS respect gained x (1 + favor/100) / 75
//                                                          (Gang.ts:152-155)
//
// GROSS: ascension subtracts a member's earned respect from the gang's total
// (Gang.ts:391) but never from the faction's reputation, so the reputation
// trajectory integrates gains, not the respect balance. And the gains grow —
// every cycle adds exp (GangMember.ts:calculateExpGain), the skill curve
// lifts the stat weight, recruits arrive at 5^(n-3) respect — so a snapshot
// rate underprices every unlock. This simulates the game's own loop under
// gang.js's own assignment policy (assign(), re-run every step), which is
// what gang.js will actually do, so the forecast is of the policy in force.
//
// Left out, both in the conservative direction: ascension (would raise
// long-run exp multipliers) and equipment (would raise stats). Territory is
// held constant (warfare is off until power dominates). Wanted follows
// Gang.ts:157-166 with the per-process justice factor, at the game's
// 10-cycle process granularity (GangConstants.minCyclesToProcess).
// ---------------------------------------------------------------------------

export const CYCLES_PER_PROCESS = 10 // GangConstants.minCyclesToProcess: 2000ms / 200ms

/** A fresh recruit (GangMember constructor): every exp 0, every mult 1, no ascension. */
export function freshMember(name) {
  const m = { name, task: 'Unassigned', earnedRespect: 0, upgrades: [], augmentations: [] }
  for (const s of STATS) {
    m[`${s}_exp`] = 0
    m[`${s}_mult`] = 1
    m[`${s}_asc_points`] = 0
    m[s] = skillOf(0, 1)
  }
  return m
}

/**
 * Forward-simulate the gang. `g`: {respect, wantedLevel, territory, isHacking};
 * `members`: getMemberInformation objects (stats, <stat>_exp, <stat>_mult,
 * <stat>_asc_points); `o`: {softcap, horizonH=24, stepSec=60, mode}.
 *
 * Returns { samples: [{h, respect, gross, members, wantedLevel}], respectPerSec }
 * — `gross` is cumulative gross respect gained since h=0 (the reputation
 * integrand), `respectPerSec` the policy's rate at h=0 — or null when the
 * inputs are unreadable. Samples are one per step, so callers interpolate.
 */
export function simulateGang(g, members, o = {}) {
  if (!g || !num(g.respect) || !num(g.wantedLevel) || !num(g.territory) || typeof g.isHacking !== 'boolean') return null
  if (!Array.isArray(members) || !num(o.softcap)) return null
  const horizonH = num(o.horizonH) && o.horizonH > 0 ? o.horizonH : 24
  const stepSec = num(o.stepSec) && o.stepSec > 0 ? o.stepSec : 60
  const cyclesPerStep = Math.max(1, Math.round(stepSec / CYCLE_SEC))
  const processesPerStep = Math.max(1, Math.round(cyclesPerStep / CYCLES_PER_PROCESS))
  const ms = members.map((m) => {
    const c = { ...m, earnedRespect: num(m.earnedRespect) ? m.earnedRespect : 0, augmentations: Array.isArray(m.augmentations) ? m.augmentations : [] }
    for (const s of STATS) {
      if (!num(c[`${s}_exp`])) c[`${s}_exp`] = 0
      if (!num(c[`${s}_mult`])) c[`${s}_mult`] = 1
      if (!num(c[`${s}_asc_points`])) c[`${s}_asc_points`] = 0
      c[s] = skillOf(c[`${s}_exp`], c[`${s}_mult`] * ascMult(c[`${s}_asc_points`]))
    }
    return c
  })
  // ASCENSION, as gang.js decides it (shouldAscend at o.ascend.minGain, keeping
  // every member) and as the game applies it (GangMember.ts:ascend): points
  // += max(exp - 1000, 0) per stat, exp -> 0, upgrades lost (multipliers
  // rebuilt from augmentations alone), and the member's EARNED respect
  // deducted from the gang's balance — never from the faction's reputation.
  // o.ascend null/absent: never ascend.
  const ascend = o.ascend && num(o.ascend.minGain) ? o.ascend : null
  let ascensions = 0
  const tryAscend = () => {
    if (!ascend) return
    for (const m of ms) {
      const gains = {}
      let any = false
      for (const s of STATS) {
        gains[s] = Math.max(m[`${s}_exp`] - ASC_POINTS_FLOOR, 0)
        if (gains[s] > 0) any = true
      }
      if (!any) continue
      const result = { respect: m.earnedRespect }
      for (const s of STATS) result[s] = ascMult(m[`${s}_asc_points`] + gains[s]) / ascMult(m[`${s}_asc_points`])
      const v = shouldAscend(m, result, state, { minGain: ascend.minGain, members: ms.length })
      if (!v.ascend) continue
      for (const s of STATS) {
        m[`${s}_asc_points`] += gains[s]
        m[`${s}_exp`] = 0
        m[`${s}_mult`] = 1
      }
      for (const name of m.augmentations) {
        const u = UPGRADES.find((x) => x.name === name)
        if (u) for (const s of STATS) if (u.mults[s]) m[`${s}_mult`] *= u.mults[s]
      }
      for (const s of STATS) m[s] = skillOf(0, m[`${s}_mult`] * ascMult(m[`${s}_asc_points`]))
      state.respect = Math.max(1, state.respect - m.earnedRespect)
      m.earnedRespect = 0
      ascensions++
    }
  }
  const state = { respect: g.respect, wantedLevel: g.wantedLevel, territory: g.territory, isHacking: g.isHacking }
  let gross = 0
  let respectPerSec = null
  let recruitIndex = 0
  const samples = [{ h: 0, respect: state.respect, gross: 0, members: ms.length, wantedLevel: state.wantedLevel, ascensions: 0 }]
  const steps = Math.ceil((horizonH * 3600) / stepSec)
  for (let i = 1; i <= steps; i++) {
    // Recruit first, as gang.js does at the top of its loop; then ascend.
    while (ms.length < MAX_MEMBERS && state.respect >= respectForMembers(ms.length + 1)) ms.push(freshMember(`sim${recruitIndex++}`))
    tryAscend()
    // `o.assignFn` lets a caller forecast a DIFFERENT policy than assign()
    // — that is how policies are compared, by their trajectories.
    const plan = (o.assignFn ?? assign)(state, ms, { softcap: o.softcap, mode: o.mode })
    if (!plan) return null
    if (respectPerSec === null) respectPerSec = plan.rates.respect
    // Per-cycle gains at this step's stats and penalty (Gang.ts:processGains).
    let respectGainPerCycle = 0
    let wantedGainPerCycle = 0
    let justice = 0
    const tasks = ms.map((m) => TASK[plan.assignments[m.name]])
    for (let k = 0; k < ms.length; k++) {
      const t = tasks[k]
      const r = respectGain(state, ms[k], t, o.softcap)
      respectGainPerCycle += r
      ms[k].earnedRespect += r * cyclesPerStep
      wantedGainPerCycle += wantedGain(state, ms[k], t)
      if (t.baseWanted < 0) justice++
    }
    const gained = respectGainPerCycle * cyclesPerStep
    gross += gained
    state.respect += gained
    // Wanted: the game applies the justice factor once per process of 10 cycles.
    for (let p = 0; p < processesPerStep; p++) {
      if (state.wantedLevel !== 1 || wantedGainPerCycle >= 0) {
        const old = state.wantedLevel
        const next = (old + wantedGainPerCycle * CYCLES_PER_PROCESS) * (1 - justice * 0.001)
        state.wantedLevel = next
        if (state.wantedLevel < 1 || (wantedGainPerCycle <= 0 && state.wantedLevel > old)) state.wantedLevel = 1
      }
    }
    // Exp and skills (Gang.ts:processExperienceGains).
    for (let k = 0; k < ms.length; k++) {
      const e = expGain(tasks[k], ms[k])
      const m = ms[k]
      for (const s of STATS) {
        m[`${s}_exp`] += e[s] * cyclesPerStep
        m[s] = skillOf(m[`${s}_exp`], m[`${s}_mult`] * ascMult(m[`${s}_asc_points`]))
      }
    }
    samples.push({ h: (i * stepSec) / 3600, respect: state.respect, gross, members: ms.length, wantedLevel: state.wantedLevel, ascensions })
  }
  return { samples, respectPerSec: respectPerSec ?? 0, horizonH, stepSec, ascensions }
}

/**
 * Faction reputation at `h` hours along a forecast: repNow plus the gross
 * respect gained by then, converted at the game's ratio. `o`: {facRepMult,
 * favor}. Beyond the horizon the last sample's gross is held flat — a floor,
 * never an extrapolation. null when anything is unreadable.
 */
export function gangRepAt(forecast, h, repNow, o = {}) {
  if (!forecast || !Array.isArray(forecast.samples) || !forecast.samples.length || !num(h) || h < 0 || !num(repNow)) return null
  if (!num(o.facRepMult) || o.facRepMult <= 0) return null
  const favor = num(o.favor) && o.favor >= 0 ? o.favor : 0
  const s = forecast.samples
  let gross
  if (h >= s[s.length - 1].h) gross = s[s.length - 1].gross
  else {
    let i = 1
    while (i < s.length && s[i].h < h) i++
    const a = s[i - 1]
    const b = s[i]
    const f = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h)
    gross = a.gross + f * (b.gross - a.gross)
  }
  return repNow + (o.facRepMult * gross * (1 + favor / 100)) / RESPECT_TO_REP
}

/**
 * Hours until the gang faction's reputation reaches `target`, or Infinity
 * when the forecast horizon does not reach it (known: not inside the
 * horizon), or null when unreadable.
 */
export function hoursToGangRep(forecast, target, repNow, o = {}) {
  if (!num(target)) return null
  const r0 = gangRepAt(forecast, 0, repNow, o)
  if (r0 === null) return null
  if (target <= r0) return 0
  const s = forecast.samples
  for (let i = 1; i < s.length; i++) {
    const rb = gangRepAt(forecast, s[i].h, repNow, o)
    if (rb >= target) {
      const ra = gangRepAt(forecast, s[i - 1].h, repNow, o)
      const f = rb === ra ? 1 : (target - ra) / (rb - ra)
      return s[i - 1].h + f * (s[i].h - s[i - 1].h)
    }
  }
  return Infinity
}

// ---------------------------------------------------------------------------
// POLICY CHOICE BY TRAJECTORY. assign() is greedy — the best task THIS cycle —
// and a greedy policy never trains, because training earns nothing this
// cycle. But Train Combat pays difficulty^0.9 = 63x the exp of Mug People
// (GangMember.ts:calculateExpGain), and Terrorism pays ~100x its respect once
// a member's stat weight clears 4 x difficulty (formulas.ts). Measured on the
// live gang 2026-09-19: greedy reached the first gang-catalogue unlock
// (5,000 rep) in 28.5h; "train until Terrorism clears, then greedy" in 3.4h.
// So the policy is chosen by what its trajectory reaches, not by this cycle.
// ---------------------------------------------------------------------------

/** "Train until `clearTask` clears its difficulty, then the greedy pick" as an assignFn. */
export function trainUntil(clearTaskName) {
  const clearTask = TASK[clearTaskName]
  if (!clearTask) return null
  return (g, ms, o) => {
    const plan = assign(g, ms, o)
    if (!plan) return null
    const train = g.isHacking ? TASK['Train Hacking'] : TASK['Train Combat']
    for (const m of ms) {
      if (plan.assignments[m.name] === 'Vigilante Justice' || plan.assignments[m.name] === 'Ethical Hacking') continue
      if (statWeight(clearTask, m) - 4 * clearTask.difficulty <= 0) {
        plan.assignments[m.name] = train.name
        plan.why[m.name] = `train until ${clearTaskName} clears (stat weight ${statWeight(clearTask, m).toFixed(0)} of ${4 * clearTask.difficulty})`
      }
    }
    // Rates for what is actually assigned now.
    const rates = { respect: 0, money: 0, wanted: 0 }
    for (const m of ms) {
      const t = TASK[plan.assignments[m.name]]
      rates.respect += respectGain(g, m, t, o.softcap) / CYCLE_SEC
      rates.money += moneyGain(g, m, t, o.softcap) / CYCLE_SEC
      rates.wanted += wantedGain(g, m, t) / CYCLE_SEC
    }
    return { ...plan, rates }
  }
}

/** The candidate policies for a gang of this kind: greedy, and train-until-X for every respect task harder than the easiest. */
export function policies(isHacking) {
  const out = [{ name: 'greedy', assignFn: assign }]
  for (const t of tasksFor(isHacking)) {
    if (!(t.baseRespect > 0) || t.difficulty <= 1) continue
    out.push({ name: `train until ${t.name}`, assignFn: trainUntil(t.name) })
  }
  return out
}

/**
 * Choose the policy whose trajectory reaches `o.targetGross` (gross respect
 * to gain — the reputation target converted by the caller) soonest; with no
 * target, or none reachable inside the horizon, the one with the most gross
 * respect at the horizon. Returns { chosen: {name, assignFn, forecast},
 * table: [{name, hoursToTarget, grossAtHorizon}] } or null.
 */
/**
 * The ascension rules to choose between: never, or gang.js's shouldAscend at
 * a gain floor. Ascending costs the member's earned respect (recruits slip)
 * and buys a lasting multiplier (exp accrues faster ever after) — which wins
 * depends on where the next recruit threshold and the next unlock sit, so
 * it is chosen by trajectory like the task policy.
 */
export const ASCENSION_RULES = [
  { name: 'never', ascend: null },
  { name: 'gain>=1.1', ascend: { minGain: 1.1 } },
  { name: 'gain>=1.25', ascend: { minGain: 1.25 } },
  { name: 'gain>=1.5', ascend: { minGain: 1.5 } },
  { name: 'gain>=2', ascend: { minGain: 2 } },
]

/**
 * Two stages, coordinate-wise (a full cross is 45 simulations a minute in
 * the game thread): the task policy is chosen under the incumbent ascension
 * rule (o.ascend, default gain>=1.25), then the ascension rule under the
 * chosen task policy. The returned `chosen` carries both; `table` has every
 * row of both stages with `stage` marked.
 */
export function choosePolicy(g, members, o = {}) {
  const incumbent = o.ascend === undefined ? { minGain: 1.25 } : o.ascend
  const s1 = chooseAmong(g, members, { ...o, ascend: incumbent }, (o.policies ?? policies(g?.isHacking)).map((p) => ({ ...p, ascend: incumbent })), 'task')
  if (!s1) return null
  const rules = o.ascensionRules ?? ASCENSION_RULES
  const s2 = chooseAmong(g, members, o, rules.map((r) => ({ name: `${s1.chosen.name} / ascend ${r.name}`, assignFn: s1.chosen.assignFn, ascend: r.ascend, ascendName: r.name })), 'ascension')
  const chosen = s2 ? s2.chosen : s1.chosen
  return { chosen: { name: s1.chosen.name, ascendName: chosen.ascendName ?? 'gain>=1.25', assignFn: chosen.assignFn, ascend: chosen.ascend, forecast: chosen.forecast }, table: [...s1.table, ...(s2?.table ?? [])] }
}

function chooseAmong(g, members, o, cands, stage) {
  const table = []
  let best = null
  for (const p of cands) {
    const f = simulateGang(g, members, { ...o, assignFn: p.assignFn, ascend: p.ascend })
    if (!f) continue
    const last = f.samples[f.samples.length - 1]
    let hoursToTarget = null
    if (num(o.targetGross) && o.targetGross > 0) {
      hoursToTarget = Infinity
      for (let i = 1; i < f.samples.length; i++) {
        if (f.samples[i].gross >= o.targetGross) {
          const a = f.samples[i - 1]
          const b = f.samples[i]
          hoursToTarget = a.h + ((o.targetGross - a.gross) / (b.gross - a.gross || 1)) * (b.h - a.h)
          break
        }
      }
    }
    const row = { stage, name: p.name, hoursToTarget, grossAtHorizon: last.gross, membersAtHorizon: last.members, ascensions: f.ascensions }
    table.push(row)
    const better =
      !best ||
      (row.hoursToTarget !== null && best.row.hoursToTarget !== null && isFinite(row.hoursToTarget) && row.hoursToTarget < best.row.hoursToTarget) ||
      ((row.hoursToTarget === null || !isFinite(row.hoursToTarget)) && (best.row.hoursToTarget === null || !isFinite(best.row.hoursToTarget)) && row.grossAtHorizon > best.row.grossAtHorizon)
    if (better) best = { p, f, row }
  }
  if (!best) return null
  return { chosen: { name: best.p.name, ascendName: best.p.ascendName, assignFn: best.p.assignFn, ascend: best.p.ascend, forecast: best.f }, table }
}
