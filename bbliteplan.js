// bb-lite — the Bladeburner division on a lean RAM surface. PURE (0GB): the
// coordinator bb-lite.js, its one-shot actors (bb-lite-*.js) and the tests
// import this. Every policy decision is bbplan.js's (chooseAction,
// planSkills) on a view built here from the actors' reads, so the lean loop
// and the exit model price the same policy (CLAUDE.md "Same inputs, one
// builder").
//
// WHY A LEAN DAEMON. bladeburner.js references 25 ns.bladeburner functions;
// each is 4GB and NOT scaled by Source-File 4 (RamCostGenerator.ts applies
// SF4Cost only to ns.singularity), so it needs 92.75GB in ONE block. Live in
// BN6 (2026-10-01) the division was joined ~5h after combat 100 for want of
// that block; in BN4 (2026-10-02) at a 64GB home the largest rooted host was
// 32GB and every one was full of workers. bb-lite splits the surface by
// purpose into one-shot actors no larger than act.js's actors, so it runs
// wherever act.js's do (home's action slot), from the first minute the
// division is joinable.
//
// WHAT THE LEAN SURFACE GIVES UP, each named with its direction:
//   - cities: it stays in the division's current city (no switchCity /
//     getCityEstimatedPopulation / getCityChaos / getCityCommunities, 16GB) —
//     pessimistic where another city's population is larger; Raid is never
//     chosen (it needs a community count).
//   - levels: the game's autolevel stays on (every action at its max level,
//     LevelableAction.autoLevel; Bladeburner.ts:1005), POLICY.pinTop — no
//     setActionLevel (4GB): an action whose top level fails minP is not a
//     candidate rather than run lower.
//   - the team size (setTeamSize/getTeamSize, 8GB): operations at team 0.
//   - stopBladeburnerAction (2GB): a leftover action is not stopped when the
//     slot is not ours; any player work started by its owner cancels it
//     (Bladeburner.ts:1353-1366).
//   - the calibration reads (getActionTime/getActionCurrentTime, 8GB) and
//     the true-population read: the ENV is recovered from the LOW end of the
//     shown range, as bladeburner.js did before 2026-10-01.
// The full daemon takes over the moment a host holds it (the handover below).

import { POLICY, TYPE, LEVELED, BLACK_OPS, dataOf, typeOf, skillMultsOf, envFromChance, chooseAction, staminaGainOf, staminaBonusOf, actionTime, JOIN_COMBAT, BBC } from 'bbplan.js'

export const LITE_FILE = '/tel/bb-lite.txt'
export const BB_FILE = '/tel/bladeburner.txt'
/** Actors answer the coordinator on this port (ports are 0GB and global: an actor off home needs no scp to reply). */
export const LITE_PORT = 12611
/** The one-shot actors and what each one references (RAM: base 1.6 + 4GB per ns.bladeburner function). */
export const ACTOR = {
  join: 'bb-lite-join.js', // joinBladeburnerDivision, joinBladeburnerFaction (inBladeburner 0)
  read: 'bb-lite-read.js', // getActionEstimatedSuccessChance, getActionCountRemaining, getActionMaxLevel
  act: 'bb-lite-act.js', // getStamina, getRank, startAction, getCurrentAction (1)
  skill: 'bb-lite-skill.js', // getSkillPoints, getSkillLevel, upgradeSkill
  level: 'bb-lite-level.js', // setActionAutolevel, setActionLevel, getActionMaxLevel
}
/** The lean policy: bbplan.POLICY with every action at its (auto) max level. */
export const LITE_POLICY = { ...POLICY, pinTop: true }
/** bb-lite.txt older than this is no lean actor (a pass is <= 60s). */
export const LITE_FRESH_MS = 3 * 60e3
/** bladeburner.txt from bladeburner.js younger than this means the full daemon is in its loop. */
export const FULL_FRESH_MS = 2 * 60e3
/** The pass cadence bounds: an action's own time, never under 5s nor over 60s. */
export const PASS_MIN_MS = 5e3
export const PASS_MAX_MS = 60e3

const num = (x) => typeof x === 'number' && isFinite(x)

/**
 * Is the lean actor alive? bladeburner.js does not act while it is.
 * rec = /tel/bb-lite.txt. Alive: this life, fresh, not stopped, not handed over.
 */
export function liteAliveOf(rec, info, now = Date.now()) {
  if (!rec) return { alive: false, why: 'no /tel/bb-lite.txt' }
  if (rec.lastAugReset !== info?.lastAugReset) return { alive: false, why: 'bb-lite.txt is from another life' }
  if (rec.health === 'stopped' || rec.exited === true) return { alive: false, why: `bb-lite stopped (${rec.result ?? '?'})` }
  if (rec.result === 'handed-over') return { alive: false, why: 'bb-lite handed over' }
  const at = Date.parse(rec.at ?? '')
  if (!Number.isFinite(at) || now - at > LITE_FRESH_MS) return { alive: false, why: `bb-lite.txt is ${Number.isFinite(at) ? `${((now - at) / 60e3).toFixed(1)} min` : 'un'}stale` }
  return { alive: true, why: `bb-lite ${rec.result ?? '?'} at ${rec.at}` }
}

/**
 * Is the full daemon in its loop? rec = /tel/bladeburner.txt. bb-lite stands
 * down (exits, 'handed-over') when bladeburner.js has published from this
 * life recently and is not stopped — it waits for exactly that ('handover-wait').
 */
export function fullTakingOverOf(rec, info, now = Date.now()) {
  if (!rec || rec.daemon !== 'bladeburner.js') return { over: false }
  if (rec.lastAugReset !== info?.lastAugReset) return { over: false }
  if (rec.health === 'stopped' || rec.exited === true) return { over: false }
  if (rec.result === 'capability-absent' || rec.result === 'disabled-in-node') return { over: false }
  const at = Date.parse(rec.at ?? '')
  if (!Number.isFinite(at) || now - at > FULL_FRESH_MS) return { over: false }
  return { over: true, why: `bladeburner.js is running on ${rec.host ?? '?'} (${rec.result} at ${rec.at})` }
}

/** The four combat stats, the lowest, and whether the division takes us (NetscriptFunctions/Bladeburner.ts:347-352). */
export function joinableOf(skills) {
  const combat = { strength: skills?.strength ?? 0, defense: skills?.defense ?? 0, dexterity: skills?.dexterity ?? 0, agility: skills?.agility ?? 0 }
  const low = Math.min(...Object.values(combat))
  return { combat, low, ok: low >= JOIN_COMBAT }
}

/**
 * The bbplan view from the lean reads (bbplan.js "The view every policy call reads").
 *
 *   person   {skills, mults} (ns.getPlayer)
 *   reads    bb-lite-read.js: { actions: [{name, lo, hi, count, maxLevel}], blackOp: {name, lo, hi} | null }
 *   levels   skill levels (bb-lite-skill.js's last read; {} before any)
 *   stamina, maxStamina, rank   bb-lite-act.js's reads
 *
 * ENV per family from the LOW end of the range at the action's max level
 * (autolevel: the level the game shows the range at), the largest unclamped
 * read of each family (bladeburner.js's rule without the population read).
 * One city: the division's own (cityFactor 1); Raid out (no community count).
 */
export function leanViewOf({ person, reads, levels = {}, stamina, maxStamina, rank = 0, bnRank = 1, resting = false }) {
  const sm = skillMultsOf(levels)
  let Kc = 0
  let Ko = 0
  let KcAny = 0
  let KoAny = 0
  const actions = []
  for (const r of reads?.actions ?? []) {
    const d = dataOf(r.name)
    if (!d || d.kind === 'blackop' || d.name === 'Raid') continue
    const L = num(r.maxLevel) && r.maxLevel >= 1 ? r.maxLevel : 1
    if (num(r.lo) && r.lo > 0) {
      const K = envFromChance(r.lo, d, L, person, sm)
      if (r.lo < 0.999) {
        if (d.kind === 'contract') Kc = Math.max(Kc, K)
        else Ko = Math.max(Ko, K)
      }
      if (d.kind === 'contract') KcAny = Math.max(KcAny, K)
      else KoAny = Math.max(KoAny, K)
    }
    actions.push({ d, count: num(r.count) ? r.count : 0, maxLevel: L, width: num(r.hi) && num(r.lo) ? Math.max(0, r.hi - r.lo) : 0 })
  }
  if (!(Kc > 0)) Kc = KcAny
  if (!(Ko > 0)) Ko = KoAny
  for (const a of actions) a.K = a.d.kind === 'contract' ? Kc : Ko
  let blackOp = null
  const bo = reads?.blackOp
  if (bo && dataOf(bo.name)) {
    const d = dataOf(bo.name)
    blackOp = { d, K: num(bo.lo) && bo.lo > 0 ? envFromChance(bo.lo, d, 1, person, sm) : 0, width: num(bo.hi) && num(bo.lo) ? Math.max(0, bo.hi - bo.lo) : 0 }
  }
  const ms = num(maxStamina) && maxStamina > 0 ? maxStamina : 1
  return {
    person, sm, levels, bnRank, rank: num(rank) ? rank : 0,
    stamina: num(stamina) ? stamina : ms, maxStamina: ms,
    staminaGain: staminaGainOf(person, sm, ms), maxStaminaBase: true, staminaBonus: staminaBonusOf(person, sm, ms),
    resting,
    ref: { pop: BBC.PopulationThreshold, chaos: 0 },
    city: null,
    actions,
    blackOp,
    K: { contracts: Kc, operations: Ko },
  }
}

/** Stamina hysteresis, bladeburner.js's: rest at or below restLow x max until restHigh x max. */
export function restingOf(prev, stamina, maxStamina, pol = POLICY) {
  if (!num(stamina) || !num(maxStamina) || !(maxStamina > 0)) return !!prev
  if (stamina <= pol.restLow * maxStamina) return true
  if (prev && stamina >= pol.restHigh * maxStamina) return false
  return !!prev
}

/** The lean decision: bbplan.chooseAction under LITE_POLICY. */
export function leanPick(view) {
  return chooseAction(view, LITE_POLICY)
}

/** How long until the next pass: the picked action's own time (bbplan.actionTime), in [PASS_MIN_MS, PASS_MAX_MS]. */
export function passWaitMs(pick, view) {
  let s = 30
  if (pick && pick.type !== TYPE.general) {
    const d = dataOf(pick.name)
    if (d) s = actionTime(d, pick.level ?? 1, view.person, view.sm)
  }
  return Math.max(PASS_MIN_MS, Math.min(PASS_MAX_MS, s * 1000 + 250))
}

/** The type the API wants for an action name. */
export const typeOfName = (name) => {
  const d = dataOf(name)
  return d ? typeOf(d) : TYPE.general
}

/** Every leveled action's API identity, and the black ops in order (BLACK_OPS[n].n === n). */
export const LEAN_ACTIONS = LEVELED.filter((d) => d.name !== 'Raid').map((d) => ({ type: typeOf(d), name: d.name }))
export const BLACK_OP_NAMES = BLACK_OPS.map((b) => b.name)

/**
 * The lean record for /tel/bladeburner.txt: the fields the plan
 * (bbplan.bladeStartOf), sleeve.js and the health checks read, from the lean
 * reads — `daemon: 'bb-lite'` says which daemon wrote it, and `cities`,
 * `calibration` and `outcomes` are absent (the lean surface does not read
 * them; bladeStartOf then prices the six cities at the threshold population).
 */
export function liteRecordOf({ info, host, result, joined, factionJoined = null, rank = null, rankPerHour = null, skillPoints = null, levels = null, stamina = null, maxStamina = null, resting = false, slot = null, pick = null, running = null, reads = null, skillsAt = null, samples = [], detail = '' }) {
  const bo = reads?.blackOp ?? null
  const done = num(reads?.done) ? reads.done : null
  const d = bo ? dataOf(bo.name) : null
  return {
    bitNode: info.currentNode,
    lastAugReset: info.lastAugReset,
    host,
    daemon: 'bb-lite',
    result,
    joined,
    factionJoined,
    rank: num(rank) ? +rank.toFixed(2) : null,
    rankPerHour: num(rankPerHour) ? +rankPerHour.toFixed(2) : null,
    skillPoints,
    levels,
    stamina: num(stamina) ? +stamina.toFixed(2) : null,
    maxStamina: num(maxStamina) ? +maxStamina.toFixed(2) : null,
    resting,
    city: null,
    slot,
    action: pick ? { type: pick.type, name: pick.name, level: pick.level ?? null, p: pick.p ?? null, ev: pick.ev ?? null, why: pick.why } : null,
    running,
    blackOps: done === null ? null : { done, next: bo?.name ?? null, reqdRank: d?.reqdRank ?? null, chance: bo ? [+(bo.lo ?? 0).toFixed(4), +(bo.hi ?? 0).toFixed(4)] : null },
    exitReady: done !== null && done >= BLACK_OPS.length,
    counts: reads ? Object.fromEntries(reads.actions.map((a) => [a.name, num(a.count) ? +a.count.toFixed(1) : 0])) : null,
    maxLevels: reads ? Object.fromEntries(reads.actions.map((a) => [a.name, a.maxLevel])) : null,
    skillsAt,
    samples,
    detail,
  }
}

/** Rank per hour over the last hour of minute samples ([{t, rank}]). */
export function rankPerHourOf(samples, now) {
  if (!Array.isArray(samples) || samples.length < 2) return null
  const hourAgo = samples.find((s) => now - s.t <= 3600e3) ?? samples[0]
  const last = samples[samples.length - 1]
  return now > hourAgo.t && last.t > hourAgo.t ? ((last.rank - hourAgo.rank) / (last.t - hourAgo.t)) * 3600e3 : null
}
