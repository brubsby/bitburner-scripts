// The early-game Singularity strategy, as one decision function. Pure.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// progress.js prices its whole acting surface as ONE block: 9.55 + 81 x 16 =
// 1,305GB at Source-File 4.1, and refuses to run at all until home can spare
// it. In the BitNode 5 run that was hour 9 of 45: nine hours in which no
// invitation was accepted, no faction was worked and no crime was committed,
// while the planner that decides those things is pure and would have run at
// 2.6GB from the first minute. Each Singularity call priced ALONE is small —
// joinFaction 48GB, workForFaction 48GB, gymWorkout 32GB, travelToCity 32GB,
// commitCrime 80GB at 16x — so act.js runs them as single-call scripts, one
// at a time, on whichever rooted host has the room. The largest call is the
// floor, not the sum.
//
// This module is the DECISION. It is deliberately a small set of rules for
// the regime BEFORE the planner can act, and it hands over the moment
// progress.js reports a live acting pass: the rules here are the
// bootstrap, not a second planner.
//
// ---------------------------------------------------------------------------
// THE RULES, in priority order
//
//   0. progress.js acted recently          -> idle (it owns the work slot)
//   1. gang-capable node, no gang faction  -> the Slum Snakes bootstrap:
//        requirements met                  -> join
//        karma or money short              -> the crime loop (bodyplan picks
//                                             the crime; it pays karma, combat
//                                             exp AND money at once — x3 in BN2)
//        combat short, in Sector-12        -> gym at Powerhouse, one stat
//        combat short, elsewhere           -> travel (needs $200k)
//   2. a faction is joined                 -> work the schedule's current
//                                             faction, or the first joined one
//   3. nothing joined, no gang node        -> try the hack-line invitations
//                                             (an uninvited join just returns
//                                             false, 48GB for a moment)
//
// Every action carries `why`, and the idle cases say why too.

import { COMBAT, crimeLeg, bestCrimeFor } from 'bodyplan.js'
import { GANG_FACTIONS, KARMA_FOR_GANG } from 'gangplan.js'

const num = (x) => typeof x === 'number' && isFinite(x)

/** Faction/FactionInfo.tsx:665 — the cheapest gang faction to enter. [AC1] re-reads the source. */
export const SLUM_SNAKES = { name: 'Slum Snakes', combat: 30, money: 1e6, karma: -9 }

/**
 * THE KARMA THE GANG ITSELF NEEDS, which is not the karma the FACTION needs.
 *
 * PlayerObjectGangMethods.canAccessGang: inside BitNode 2 gang access is
 * granted outright, so the only karma that matters is the -9 Slum Snakes ask
 * for entry. ANYWHERE ELSE it additionally requires karma <= -54,000
 * (GangConstants.GangKarmaRequirement), which is ~6000x further.
 *
 * Every gang run so far has been in BitNode 2, so the bootstrap stopped at
 * -9, joined the faction, and fell silent — and outside BN2 that would leave
 * gang.js refusing forever with "karma must reach -54000" while nothing in
 * the plan was driving karma at all. The faction join is a WAYPOINT, not the
 * goal: crime continues until the gang can actually be formed.
 */
export const gangKarmaTarget = (inBitNode2) => (inBitNode2 ? SLUM_SNAKES.karma : KARMA_FOR_GANG)
/** Where the x10 gym is (bodyplan.GYMS). */
export const GYM = { name: 'Powerhouse Gym', city: 'Sector-12' }
export const GYM_CLASS = { strength: 'str', defense: 'def', dexterity: 'dex', agility: 'agi' }
export const TRAVEL_COST = 200e3
/** Factions whose invitations arrive from backdoor.js's work; tried in this order. */
export const HACK_LINE = ['CyberSec', 'NiteSec', 'The Black Hand', 'BitRunners', 'Netburners']
/** Do not re-try an uninvited join more often than this. */
export const RETRY_MS = 10 * 60 * 1000
/** A progress.txt older than this is not an acting planner. */
export const PROGRESS_FRESH_MS = 15 * 60 * 1000

/**
 * @param s  {
 *   now, gangNode, gangKarma, factions, player: {skills, exp, mults, karma, numPeopleKilled, city, money},
 *   node: {CrimeSuccessRate, CrimeMoney, CrimeExpGain},
 *   progress: {at, health} | null,           the latest /tel/progress.txt
 *   schedule: {current: {faction}} | null,   the latest /tel/factionplan.txt
 *   work: {kind, faction?, type?} | null,    what act.js last started this life
 *   tried: {faction: lastAttemptMs},
 * }
 * @returns {kind, args, why} with kind in idle|join|work|crime|gym|travel
 */
export function decide(s = {}) {
  const p = s.player
  if (!p || !Array.isArray(s.factions) || !num(s.now)) return { kind: 'idle', why: 'state unreadable' }

  // 0. The planner owns the slot only when it says it TOOK it.
  //
  // This used to defer on `progress.at` alone — "a progress.txt newer than 15
  // minutes means the planner is acting". But progress.js publishes on every
  // pass whether or not it touched the work slot, so `at` is a HEARTBEAT and
  // the condition was true forever: act.js stood down permanently whenever the
  // planner was alive, which is whenever anything is working.
  //
  // Live in BitNode 4 that froze the gang bootstrap mid-sequence. act.js
  // started gym strength for the Slum Snakes gate (all four combat stats at
  // 30) and never got the slot back to advance to the next stat: strength
  // reached 137 against a target of 30 while defense, dexterity and agility
  // stayed at 1, and an invitation the planner itself priced at 1.3 minutes
  // away went unclaimed for the best part of an hour. The component that knew
  // the right next move (`combatShort[0]` below would have picked defense the
  // moment strength passed 30) was the one that could never run.
  //
  // progress.js now publishes `slot.owner` — 'crime', 'faction', or null when
  // it has yielded. An ABSENT owner field reads as no claim, which is the
  // permissive direction; that is deliberate, because the failure it replaces
  // was act.js doing nothing at all, and a planner too old to trust should not
  // be able to hold the slot by inertia.
  const at = Date.parse(s.progress?.at ?? '')
  const owner = s.progress?.slot?.owner ?? null
  if (num(at) && s.now - at < PROGRESS_FRESH_MS && s.progress?.health !== 'error' && owner) {
    return { kind: 'idle', why: `progress.js holds the work slot for ${owner} work (${Math.round((s.now - at) / 60000)} min ago)` }
  }

  // 1b. In a gang faction already, but the gang's own karma gate is unmet —
  // keep the crime loop running. Outside BitNode 2 this is the long leg of
  // the bootstrap by far, and joining the faction does not end it.
  if (s.gangNode === true && s.gangKarma !== undefined && s.factions.some((f) => GANG_FACTIONS.includes(f))) {
    const target = num(s.gangKarma) ? s.gangKarma : SLUM_SNAKES.karma
    if (!(num(p.karma) && p.karma <= target)) {
      const leg = crimeLeg({ karma: target }, p, s.node, { focus: 1 })
      const crime = leg?.crime ?? 'Homicide'
      const eta = leg ? ` (~${leg.hours.toFixed(1)}h to karma ${target})` : ''
      if (s.work?.kind === 'crime' && s.work.type === crime) {
        return { kind: 'idle', why: `crime loop (${crime}) already running for the gang: karma ${Math.round(p.karma)}/${target}${eta}` }
      }
      return { kind: 'crime', args: [crime], why: `gang needs karma ${target}, have ${Math.round(p.karma)}: ${crime}${eta}` }
    }
  }

  // 1. The gang bootstrap.
  if (s.gangNode === true && !s.factions.some((f) => GANG_FACTIONS.includes(f))) {
    const combatShort = COMBAT.filter((st) => !(num(p.skills?.[st]) && p.skills[st] >= SLUM_SNAKES.combat))
    const karmaShort = !(num(p.karma) && p.karma <= SLUM_SNAKES.karma)
    const moneyShort = !(num(p.money) && p.money >= SLUM_SNAKES.money)
    if (!combatShort.length && !karmaShort && !moneyShort) {
      const last = s.tried?.[SLUM_SNAKES.name] ?? 0
      if (s.now - last < 60e3) return { kind: 'idle', why: `Slum Snakes requirements met; join tried ${Math.round((s.now - last) / 1000)}s ago, waiting for the invitation` }
      return { kind: 'join', args: [SLUM_SNAKES.name], why: 'Slum Snakes requirements met: combat 30, $1m, karma -9' }
    }
    if (karmaShort || moneyShort) {
      // Karma short: the TRAJECTORY to the karma target picks the crime.
      // Only money short: the best money crime at current stats — at combat
      // ~35 that is Mug at 2.4x Homicide's dollars, and karma is already paid.
      const leg = karmaShort ? crimeLeg({ karma: SLUM_SNAKES.karma }, p, s.node, { focus: 1 }) : null
      const money = karmaShort ? null : bestCrimeFor('money', p, s.node, { focus: 1 })
      const crime = karmaShort ? (leg?.crime ?? 'Homicide') : (money?.crime ?? 'Mug')
      if (s.work?.kind === 'crime' && s.work.type === crime) return { kind: 'idle', why: `crime loop (${crime}) already running: karma ${Math.round(p.karma)}/${SLUM_SNAKES.karma}, ${Math.round(p.money)}/${SLUM_SNAKES.money}` }
      return {
        kind: 'crime',
        args: [crime],
        why: karmaShort
          ? `karma short for Slum Snakes: ${crime} pays karma, combat exp and money together${leg ? ` (~${(leg.hours * 60).toFixed(1)} min to karma ${SLUM_SNAKES.karma})` : ''}`
          : `money short for Slum Snakes: ${crime} is the best money crime at these stats${money ? ` (${Math.round(money.rates.money)}/s)` : ''}`,
      }
    }
    // Combat short, karma and money in hand.
    if (p.city !== GYM.city) {
      if (!(num(p.money) && p.money >= TRAVEL_COST)) return { kind: 'idle', why: `need $${TRAVEL_COST} to travel to ${GYM.city} for the gym` }
      return { kind: 'travel', args: [GYM.city], why: `combat ${combatShort.join('/')} short; Powerhouse is in ${GYM.city}` }
    }
    const stat = combatShort[0]
    if (s.work?.kind === 'gym' && s.work.stat === stat) return { kind: 'idle', why: `training ${stat} at ${GYM.name}: ${p.skills[stat]}/${SLUM_SNAKES.combat}` }
    return { kind: 'gym', args: [GYM.name, GYM_CLASS[stat]], stat, why: `combat ${stat} ${p.skills?.[stat]}/${SLUM_SNAKES.combat} for Slum Snakes` }
  }

  // 2. Work a joined faction — unless this is a gang node with no schedule
  // yet: the gang carries the faction's reputation, faction work is unpriced
  // until the planner acts, and crime money is measured. Measured beats
  // unknown, so the slot earns money until progress.js can say otherwise.
  if (s.factions.length && s.gangNode === true && !s.schedule?.current?.faction) {
    const money = bestCrimeFor('money', p, s.node, { focus: 1 })
    if (money) {
      if (s.work?.kind === 'crime' && s.work.type === money.crime) return { kind: 'idle', why: `crime loop (${money.crime}) for money: gang node, no schedule to price faction work against` }
      return { kind: 'crime', args: [money.crime], why: `gang node, no schedule yet: ${money.crime} is the best money crime (${Math.round(money.rates.money)}/s); the gang carries the reputation` }
    }
  }
  // The gang's own faction cannot be worked (the game refuses); its rep is the gang's.
  const workable = s.gangFaction ? s.factions.filter((f) => f !== s.gangFaction) : s.factions
  if (s.factions.length && !workable.length) return { kind: 'idle', why: `only the gang faction (${s.gangFaction}) is joined, and it cannot be worked` }
  if (workable.length) {
    const target = s.schedule?.current?.faction && workable.includes(s.schedule.current.faction) ? s.schedule.current.faction : workable[0]
    if (s.work?.kind === 'work' && s.work.faction === target) return { kind: 'idle', why: `working ${target}` }
    return { kind: 'work', args: [target, 'hacking'], why: s.schedule?.current?.faction === target ? `schedule's current faction` : `first joined faction (no schedule yet)` }
  }

  // 3. Nothing joined: try the hack line for a pending invitation.
  const due = HACK_LINE.find((f) => s.now - (s.tried?.[f] ?? 0) >= RETRY_MS)
  if (due) return { kind: 'join', args: [due], why: `no faction joined; trying ${due} (an uninvited join just returns false)` }
  return { kind: 'idle', why: 'no faction joined; every hack-line join was tried in the last 10 min' }
}
