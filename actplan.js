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
//   0. progress.js acted recently          -> idle (it owns the work slot) —
//      unless the claim is Bladeburner's and its actor cannot act
//      (bladeStall): then the slot earns the server that unblocks it
//      (the best money crime) until bb-host exists or bb-lite acts
//   0b. the Bladeburner division can exist  -> the route is presumed until the
//       and the plan has not said 'hack'       plan prices it: combat to 100
//                                              (bodyplan.combatBarPlanOf: gym
//                                              when its fee is paid, else the
//                                              best money crime), then the
//                                              slot is Bladeburner's (bb-lite);
//                                              stalled -> lent to the money
//                                              crime as in 0; a gym class still
//                                              running past the bar is stopped
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

import { COMBAT, GYMS, crimeLeg, bestCrimeFor, combatBarPlanOf } from 'bodyplan.js'
import { GANG_FACTIONS, KARMA_FOR_GANG } from 'gangplan.js'
// Pure: a gang whose every channel is zero by the node's multipliers.
import { gangChannelsDead } from 'gangworth.js'
// Pure: the floor against our own unchecked fee spending.
import { feeFundable, FEE_FLOOR_S, CLASS_BASE_FEE } from 'nodeecon.js'

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
/** Powerhouse Gym: 120 x costMult 20 per second (ClassWork.tsx:57, bodyplan GYMS). */
export const GYM_FEE_PER_SEC = CLASS_BASE_FEE.gym * 20
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
 *   equity: number,                          the stock trader's equity (0 without one)
 *   bladeStall: {stalled, why, hostCost?} | null   bbliteplan.bladeSlotStallOf: can the
 *                                            Bladeburner claim be exercised (act.js reads it)
 * }
 * @returns {kind, args, why} with kind in idle|join|work|crime|gym|travel|liquidate
 */
export function decide(s = {}) {
  const p = s.player
  if (!p || !Array.isArray(s.factions) || !num(s.now)) return { kind: 'idle', why: 'state unreadable' }
  // CASH IS NOT WEALTH (nodeecon.wealthOf). Where stock.js holds the book,
  // cash reads ~$0 while the run is rich: "can we afford it" is cash +
  // equity, and a purchase that needs cash in hand is preceded by a sized
  // raise (kind 'liquidate' -> act-liquidate.js raise X). Without a trader
  // equity is 0 and every gate below reads exactly as it did.
  const cash = num(p.money) ? p.money : null
  const wealth = cash === null ? null : cash + (num(s.equity) && s.equity > 0 ? s.equity : 0)
  const raiseFor = (need, what) =>
    cash !== null && cash < need && wealth >= need
      ? { kind: 'liquidate', args: ['raise', Math.ceil(need * 1.02)], why: `${what}: $${Math.round(need)} needed in cash, $${Math.round(cash)} held — raising it from the stock book ($${Math.round(wealth - cash)} of equity)` }
      : null

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
    // A CLAIM ITS CLAIMANT CANNOT EXERCISE IS NOT A CLAIM (bladeLend).
    if (owner === 'bladeburner' && s.bladeStall?.stalled === true) return bladeLend(s, p, cash, 'progress.js', null)
    return { kind: 'idle', why: `progress.js holds the work slot for ${owner} work (${Math.round((s.now - at) / 60000)} min ago)` }
  }

  // 0b. THE BLADEBURNER ROUTE BEFORE THE PLANNER CAN PRICE IT.
  //
  // Where the division exists (BN6/7, or Source-File 6/7) the route is
  // presumed from the first minute: the node choice priced these nodes on it
  // (nodechoice/nextnode.mjs, 919b8ca) and the planner, once home holds it,
  // re-decides on live inputs (decisions.bladeRoute). Live BN4 2026-10-02:
  // the planner's first pass was 2h40m after entry (32GB home); until then
  // this bootstrap ran Homicide for a gang priced on the World Daemon exit
  // (6.1h of 389.8h), while the committed exit was the black ops at ~49h.
  // Live BN6 2026-10-01: the join came 7.7h after entry for combat reached
  // at 2.5h. So: combat to the division's bar, by the priced plan (gym when
  // its fee is paid for a pass, else the best money crime, which trains all
  // four stats while it earns the fee), then the slot is Bladeburner's —
  // published (`slot`), read by bb-lite.js through bbslot.slotClaim.
  const bl = s.blade
  if (bl?.open === true && bl.route !== 'hack') {
    const bar = num(bl.bar) ? bl.bar : 100
    const short = Object.fromEntries(COMBAT.filter((st) => !(num(p.skills?.[st]) && p.skills[st] >= bar)).map((st) => [st, bar]))
    const tag = bl.route === 'blade' ? 'the committed Bladeburner route' : "the Bladeburner route (presumed until the plan prices it)"
    if (Object.keys(short).length) {
      const plan = (() => {
        try {
          return combatBarPlanOf(short, bl.person ?? p, s.node, { cash: wealth ?? 0, incomePerSec: num(s.incomePerSec) ? s.incomePerSec : 0, trainingMult: num(s.trainingMult) ? s.trainingMult : 1, holdS: FEE_FLOOR_S })
        } catch {
          return null
        }
      })()
      const now = plan?.now ?? null
      if (now?.kind === 'crime') {
        if (s.work?.kind === 'crime' && s.work.type === now.crime) return { kind: 'idle', why: `${now.crime} running for ${tag}: ${plan.why}` }
        return { kind: 'crime', args: [now.crime], why: `combat to ${bar} for ${tag}: ${plan.why}` }
      }
      if (now?.kind === 'gym') {
        if (p.city !== now.city) {
          const r = raiseFor(TRAVEL_COST, `the fare to ${now.city}`)
          if (r) return r
          if (num(cash) && cash >= TRAVEL_COST) return { kind: 'travel', args: [now.city], why: `combat to ${bar} for ${tag}: ${now.gym} is in ${now.city}` }
        } else {
          if (s.work?.kind === 'gym' && s.work.stat === now.stat) return { kind: 'idle', why: `training ${now.stat} at ${now.gym} for ${tag}: ${p.skills[now.stat]}/${bar}` }
          // THE FEE FLOOR IN CASH (nodeecon.feeFundable): the plan priced the
          // gym on wealth; the fee is charged from cash every second with no
          // balance check (ClassWork.tsx:57-72), so it starts only while cash
          // covers FEE_FLOOR_S of it — raised from the book when only equity
          // does, else the money crime trains and earns it. This read
          // `cash >= 0`, which starts a $2,400/s class on $1.
          const cm = GYMS.find((g) => g.name === now.gym)?.costMult
          const fee = CLASS_BASE_FEE.gym * (num(cm) ? cm : 20)
          if (feeFundable(cash, fee)) return { kind: 'gym', args: [now.gym, GYM_CLASS[now.stat]], stat: now.stat, why: `combat ${now.stat} ${p.skills?.[now.stat]}/${bar} for ${tag}: ${plan.why}` }
          const rg = raiseFor(fee * FEE_FLOOR_S, `${FEE_FLOOR_S}s of the ${now.gym} fee (charged with no balance check)`)
          if (rg) return rg
          const money = (() => {
            try {
              return bestCrimeFor('money', bl.person ?? p, s.node, { focus: 1 })
            } catch {
              return null
            }
          })()
          if (money) {
            if (s.work?.kind === 'crime' && s.work.type === money.crime) return { kind: 'idle', why: `${money.crime} running for ${tag}: the ${now.gym} fee ($${fee}/s) is not covered for ${FEE_FLOOR_S}s by cash $${Math.round(cash ?? NaN)}` }
            return { kind: 'crime', args: [money.crime], why: `combat to ${bar} for ${tag}: the ${now.gym} fee ($${fee}/s) is not covered for ${FEE_FLOOR_S}s by cash $${Math.round(cash ?? NaN)} — ${money.crime} trains combat and earns it` }
          }
        }
      }
      // Unpriceable (unreadable person/node) or nothing affordable: the old bootstrap below.
    } else {
      // A CLAIM ITS CLAIMANT CANNOT EXERCISE IS NOT A CLAIM (bladeLend): the
      // slot stays Bladeburner's (so seed.js buys the host and bb-lite acts
      // the moment it can) and earns meanwhile.
      if (s.bladeStall?.stalled === true) return bladeLend(s, p, cash, "act.js's bootstrap", 'bladeburner')
      // NO FEE PAST THE BAR: a gym class this bootstrap started is charged
      // every second until something replaces it, and an idle claim replaces
      // nothing — live BN14.3 the agility class started 15:10:55Z at 94/100
      // ran on under the idle claim, and cash read -$13k at 15:18Z. stopAction
      // is Player.finishWork only (Singularity.ts:563-568): a Bladeburner
      // action, if one started meanwhile, is untouched.
      if (s.work?.kind === 'gym') return { kind: 'stop', args: [], slot: 'bladeburner', why: `combat at ${bar} for ${tag}: stopping the ${s.work.stat ?? ''} gym class this bootstrap started — its fee runs on past the bar until something replaces it` }
      if (bl.joined === true) return { kind: 'idle', slot: 'bladeburner', why: `the work slot is Bladeburner's: ${tag}, in the division, combat at ${bar} — bb-lite.js / bladeburner.js act on this claim (no planner pass yet)` }
      return { kind: 'idle', slot: 'bladeburner', why: `combat at ${bar} for ${tag}: waiting for bb-lite.js to join the division (the slot is held for it)` }
    }
  }

  // THE GANG'S WORTH: progress.js's priced verdict, OVERRIDDEN by the node's
  // structure when every gang channel is zero (gangworth.gangChannelsDead —
  // GangSoftcap 0, BitNode 8). That does not wait on a verdict: an unpriced
  // one (no measured income) used to leave the gang pending and this file
  // running Homicide toward -54,000 for a gang that earns ~$1/cycle.
  const deadWhy = gangChannelsDead(s.node)
  const gw = deadWhy ? { worth: false, structural: true, why: deadWhy } : s.gangWorth
  // THE WORK SLOT JOINS THE KARMA GRIND only where the gang decision priced
  // it in (gangworth.gangArms 'player'): with the 'fleet' arm the sleeves
  // grind and the slot keeps its plan. A verdict without arms (older
  // publisher, unpriced) keeps the old behaviour.
  const slotGrinds = gw?.playerSlot !== false

  // 1b. In a gang faction already, but the gang's own karma gate is unmet —
  // keep the crime loop running. Outside BitNode 2 this is the long leg of
  // the bootstrap by far, and joining the faction does not end it.
  if (s.gangNode === true && gw?.worth !== false && slotGrinds && s.gangKarma !== undefined && s.factions.some((f) => GANG_FACTIONS.includes(f))) {
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

  // 1. The gang bootstrap — but only where a gang PAYS FOR ITSELF.
  //
  // `gangNode` means "this node ALLOWS a gang", which is not the same as
  // "a gang is worth the karma gate". Outside BitNode 2 that gate is -54,000
  // and costs a full work-slot grind; gangworth.js prices whether the gang's
  // income repays it INSIDE this node. It answers 102h (63%) in BitNode 4 and
  // 0.9h (1%) in BitNode 10, where the batcher is 22x less nerfed and funds
  // the install ladder by itself.
  //
  // An explicit false skips the bootstrap. An UNKNOWN verdict leaves the old
  // behaviour standing rather than silently abandoning the gang — the failure
  // being fixed is an unexamined assumption, and inverting it unexamined would
  // be the same mistake pointing the other way.
  if (s.gangNode === true && gw?.worth === false) {
    // Fall through to the faction/work path below.
  } else if (s.gangNode === true && !s.factions.some((f) => GANG_FACTIONS.includes(f))) {
    const combatShort = COMBAT.filter((st) => !(num(p.skills?.[st]) && p.skills[st] >= SLUM_SNAKES.combat))
    const karmaShort = !(num(p.karma) && p.karma <= SLUM_SNAKES.karma)
    const moneyShort = !(num(wealth) && wealth >= SLUM_SNAKES.money)
    // THE GANG'S KARMA GATE SURVIVES THE FACTION'S. Joining Slum Snakes wants
    // karma -9; the GANG wants -54,000 outside BitNode 2
    // (GangConstants.GangKarmaRequirement), and karma survives an install
    // while faction membership does NOT. So the state this branch actually
    // meets after a mid-bootstrap install is: karma far past the faction gate,
    // out of the faction, money and combat reset.
    //
    // Block 1b already knows this, but 1b only runs once we are IN the
    // faction — so the same gate was missing from precisely the branch an
    // install drops us into. Live on 2026-09-21: karma -50,311 of -54,000,
    // 3,689 short, and this branch read karma as DONE (it is past -9), picked
    // the best MONEY crime for the $1m join gate, and settled on Shoplift at
    // 0.0173 karma/s against Homicide's 0.2565 — a 15x worse rate on the one
    // axis still gating the gang, while Homicide pays that karma AND the
    // combat exp the join needs AND money.
    const gangKarmaShort = slotGrinds && s.gangKarma !== undefined && num(s.gangKarma) && !(num(p.karma) && p.karma <= s.gangKarma)
    if (!combatShort.length && !karmaShort && !moneyShort) {
      const last = s.tried?.[SLUM_SNAKES.name] ?? 0
      if (s.now - last < 60e3) return { kind: 'idle', why: `Slum Snakes requirements met; join tried ${Math.round((s.now - last) / 1000)}s ago, waiting for the invitation` }
      // The invitation wants the $1m IN HAND (FactionJoinCondition money).
      const r = raiseFor(SLUM_SNAKES.money, 'the Slum Snakes invitation wants $1m in hand')
      if (r) return r
      return { kind: 'join', args: [SLUM_SNAKES.name], why: 'Slum Snakes requirements met: combat 30, $1m, karma -9' }
    }
    if (karmaShort || moneyShort || gangKarmaShort) {
      // Karma short: the TRAJECTORY to the karma target picks the crime, and
      // the target is the FURTHER of the two gates still open — the gang's
      // when it is, because a crime chosen for the faction's -9 can be
      // fifteen times slower at the karma that actually creates the gang.
      // Only money short, with BOTH karma gates met: the best money crime at
      // current stats — at combat ~35 that is Mug at 2.4x Homicide's dollars.
      const karmaGoal = gangKarmaShort ? s.gangKarma : SLUM_SNAKES.karma
      const anyKarmaShort = karmaShort || gangKarmaShort
      const leg = anyKarmaShort ? crimeLeg({ karma: karmaGoal }, p, s.node, { focus: 1 }) : null
      const money = anyKarmaShort ? null : bestCrimeFor('money', p, s.node, { focus: 1 })
      const crime = anyKarmaShort ? (leg?.crime ?? 'Homicide') : (money?.crime ?? 'Mug')
      if (s.work?.kind === 'crime' && s.work.type === crime) return { kind: 'idle', why: `crime loop (${crime}) already running: karma ${Math.round(p.karma)}/${karmaGoal}, ${Math.round(p.money)}/${SLUM_SNAKES.money}` }
      return {
        kind: 'crime',
        args: [crime],
        why: anyKarmaShort
          ? `karma ${Math.round(p.karma)}/${karmaGoal} (${gangKarmaShort ? "the GANG's gate" : "Slum Snakes'"}): ${crime} pays karma, combat exp and money together${leg ? ` (~${leg.hours < 1 ? `${(leg.hours * 60).toFixed(1)} min` : `${leg.hours.toFixed(1)}h`})` : ''}`
          : `money short for Slum Snakes: ${crime} is the best money crime at these stats${money ? ` (${Math.round(money.rates.money)}/s)` : ''}`,
      }
    }
    // Combat short, karma and money in hand.
    if (p.city !== GYM.city) {
      if (!(num(wealth) && wealth >= TRAVEL_COST)) return { kind: 'idle', why: `need $${TRAVEL_COST} to travel to ${GYM.city} for the gym` }
      const r = raiseFor(TRAVEL_COST, `the fare to ${GYM.city}`)
      if (r) return r
      return { kind: 'travel', args: [GYM.city], why: `combat ${combatShort.join('/')} short; Powerhouse is in ${GYM.city}` }
    }
    const stat = combatShort[0]
    if (s.work?.kind === 'gym' && s.work.stat === stat) return { kind: 'idle', why: `training ${stat} at ${GYM.name}: ${p.skills[stat]}/${SLUM_SNAKES.combat}` }
    // The gym fee is charged every second with no balance check
    // (ClassWork.tsx:57-72): start it only while cash covers FEE_FLOOR_S of it.
    // Afforded on wealth; paid in cash — so below zero nothing starts (the
    // escape in act.js restores it), and a cash floor the book covers is raised.
    if (!feeFundable(wealth, GYM_FEE_PER_SEC)) return { kind: 'idle', why: `training ${stat} at ${GYM.name} costs $${GYM_FEE_PER_SEC}/s and cash + equity does not cover ${FEE_FLOOR_S}s of it — not starting it` }
    if (!(cash >= 0)) return { kind: 'idle', why: `cash $${Math.round(cash ?? NaN)} is below zero — no fee-charging work starts until it is back (act.js negative-cash escape)` }
    const rg = raiseFor(GYM_FEE_PER_SEC * FEE_FLOOR_S, `${FEE_FLOOR_S}s of the ${GYM.name} fee (charged with no balance check)`)
    if (rg) return rg
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

/**
 * THE STALLED BLADEBURNER CLAIM, LENT TO THE MONEY CRIME. The claim stays
 * Bladeburner's — seed.js buys bb-host only on it (bbliteplan.liteHostBuyOf)
 * and bb-lite acts on it the moment its actors place, its startAction ending
 * the crime (Bladeburner.ts:179) — but the slot does not idle under it.
 *
 * PRICED SIMPLY, and said so: a committed route that cannot act is worth the
 * server that unblocks it (bb-host, s.bladeStall.hostCost), and the best money
 * crime is the fastest early cash at combat ~100 (no planner pass: nothing
 * else here earns). The ETA is (cost - cash) / the crime's money rate. Not a
 * trajectory comparison: the alternative is an idle slot, which earns 0 and
 * buys nothing.
 * Returns the decision with `lent` {owner, by, to, why} for act.txt.
 */
function bladeLend(s, p, cash, by, slot) {
  const st = s.bladeStall
  const money = (() => {
    try {
      return bestCrimeFor('money', s.blade?.person ?? p, s.node, { focus: 1 })
    } catch {
      return null
    }
  })()
  const lent = { owner: 'bladeburner', by, to: money?.crime ?? null, why: st.why }
  const tagSlot = slot ? { slot } : {}
  if (!money) return { kind: 'idle', ...tagSlot, lent, why: `the Bladeburner claim (${by}) cannot be exercised — ${st.why} — and no money crime prices at these stats: the slot idles` }
  const rate = num(money.rates?.money) ? money.rates.money : null
  const cost = num(st.hostCost) ? st.hostCost : null
  const eta = cost !== null && rate && num(cash) ? Math.max(0, cost - cash) / rate : null
  const price = cost !== null ? `the 32GB bb-host ($${Math.round(cost)}; cash $${Math.round(cash ?? NaN)}${eta !== null ? `, ~${(eta / 60).toFixed(0)} min of ${money.crime}` : ''})` : 'the server that unblocks it (bb-host)'
  const why = `the Bladeburner claim (${by}) cannot be exercised: ${st.why}. The stalled route is worth ${price}; ${money.crime} is the best money crime here (${rate ? `$${Math.round(rate)}/s` : 'rate unpriced'}) — the slot earns until bb-host exists or bb-lite acts`
  if (s.work?.kind === 'crime' && s.work.type === money.crime) return { kind: 'idle', ...tagSlot, lent, why: `${money.crime} running: ${why}` }
  return { kind: 'crime', args: [money.crime], ...tagSlot, lent, why }
}

/**
 * THE OWNER'S WORK, RE-ISSUED. progress.js claims the slot for a kind of
 * work and orders it once per batch; act.js starts it. Anything that ends it
 * afterwards — the negative-cash escape stopping a paid class (softlockStep,
 * on a raise the trader re-invested a moment later), a Bladeburner
 * startAction (Bladeburner.ts:179 finishes the player's work first) — left
 * the claimed slot EMPTY until the next batch: live BN6 2026-10-01 the gym
 * (defense to 100 for Bladeburners) ran from 10:27:25Z, was gone by
 * 10:27:56Z, and nothing worked until the 10:32Z batch re-ordered it.
 *
 * Re-issue the last work order of the CURRENT batch when, and only when:
 *   - progress.txt is fresh, this life, and its owner is the kind that order
 *     serves (body -> gym/crime, faction -> work, crime -> crime, company ->
 *     company; never a graft — it is paid up front, and never 'bladeburner',
 *     whose daemon restarts its own action);
 *   - the game shows NO work: the rep snapshot (getCurrentWork) is fresh and
 *     taken after the order ran;
 *   - a paid class is fundable for FEE_FLOOR_S (else the escape stops it
 *     again — the raise is the escape's job, not this);
 *   - at most REISSUE.max per batch, REISSUE.gapMs apart.
 * s: { now, lastAugReset, progress, lastWork {kind, args, at, batchAt},
 *      batchAt (the batch act.js last executed), batchWork (whether that
 *      batch held a work order: false lets this life's earlier one stand),
 *      work (snapshot), workAt, cash, city (the player's), gymCostMult
 *      (gym name -> costMult), gymCityOf (gym name -> city), reissued {n, at} }
 * Returns {kind, args, why} to run, or {skip: why} / null (nothing to say).
 */
/**
 * THE BODY LEG'S PRICED DEBT from /tel/progress.txt (slot.credit): {floor,
 * feePerSec, gym, ...} when progress.js's last pass priced the gym on credit,
 * in this life (lastAugReset; undefined skips the check) and within
 * PROGRESS_FRESH_MS; else null — an unpriced debt (nodeecon.classDebtVerdict).
 */
export function bodyCreditOf(progress, lastAugReset, now = Date.now()) {
  const c = progress?.slot?.owner === 'body' ? progress.slot.credit : null
  if (!c || !num(c.floor) || !num(c.feePerSec)) return null
  if (lastAugReset !== undefined && c.lastAugReset !== lastAugReset) return null
  const at = Date.parse(c.at ?? progress.at ?? '')
  if (!(num(at) && now - at < PROGRESS_FRESH_MS)) return null
  return c
}

export const REISSUE = { max: 3, gapMs: 90e3, snapMaxAgeMs: 120e3, settleMs: 5e3 }
const OWNER_KINDS = { body: ['gym', 'crime'], faction: ['work'], crime: ['crime'], company: ['company'] }
export function reissueWorkOf(s) {
  const lw = s.lastWork
  if (!lw || !lw.kind) return null
  const at = Date.parse(s.progress?.at ?? '')
  const owner = s.progress?.slot?.owner ?? null
  if (!(num(at) && s.now - at < PROGRESS_FRESH_MS) || s.progress?.health === 'error') return null
  if (!OWNER_KINDS[owner]?.includes(lw.kind)) return null
  // THE OWNER'S LAST ORDER OF THIS LIFE, when the current batch ordered no
  // work (s.batchWork false): progress.js orders a body leg once and then
  // reads it as running ('already'); a stop between its read and the next
  // batch (live BN14.1 2026-10-04 01:52:07Z, the gym fee drove cash below
  // zero and the game ended the class 7s before the pass) left the claimed
  // slot empty under a batch with no work order to re-issue.
  if (lw.batchAt !== s.batchAt && s.batchWork !== false) return null
  const ranAt = Date.parse(lw.at ?? '')
  const snapAt = Date.parse(s.workAt ?? '')
  if (!num(snapAt) || s.now - snapAt > REISSUE.snapMaxAgeMs || !num(ranAt) || snapAt < ranAt + REISSUE.settleMs) return null
  if (s.work) return null
  const r = s.reissued ?? { n: 0, at: 0 }
  if (r.n >= REISSUE.max) return { skip: `the ${owner} slot's ${lw.kind} order (batch ${lw.batchAt}) has stopped ${r.n} times after re-issue — leaving it to the next batch` }
  if (s.now - (r.at ?? 0) < REISSUE.gapMs) return { skip: `re-issued ${Math.round((s.now - r.at) / 1000)}s ago` }
  if (lw.kind === 'gym') {
    const cm = s.gymCostMult?.(lw.args?.[0])
    const fee = CLASS_BASE_FEE.gym * (num(cm) ? cm : 20)
    // THE GYM'S CITY (live BN14.1 2026-10-04 01:52-01:55Z: the batch's joins
    // flew the player to Ishima, which has no gym, and gymWorkout at
    // Powerhouse refuses from there). The flight first when the fare and a
    // pass of the fee are in cash; else the money crime earns them.
    const gymCity = s.gymCityOf?.(lw.args?.[0]) ?? null
    if (gymCity && typeof s.city === 'string' && s.city !== gymCity) {
      if (num(s.cash) && s.cash >= TRAVEL_COST && feeFundable(s.cash - TRAVEL_COST, fee)) return { kind: 'travel', args: [gymCity], why: `progress.js holds the slot for ${owner} and its gym order (batch ${lw.batchAt}) is at ${lw.args?.[0]} in ${gymCity}; the player is in ${s.city}: the $${TRAVEL_COST} flight first (the gym re-issues next)` }
      if (s.fundCrime) return { kind: 'crime', args: [s.fundCrime], why: `progress.js holds the slot for ${owner}; its gym (${lw.args?.[0]}) is in ${gymCity} and the player in ${s.city} with $${Math.round(s.cash ?? 0)} — under the $${TRAVEL_COST} flight plus ${FEE_FLOOR_S}s of the $${fee}/s fee: ${s.fundCrime} earns it and trains combat meanwhile` }
      return { skip: `the gym (${lw.args?.[0]}) is in ${gymCity}, the player in ${s.city}, and the flight plus a pass of the fee are not in cash` }
    }
    // ON PRICED CREDIT (progress.js slot.credit, bodyplan.combatBarPlanOf):
    // the gym re-issues on a negative balance above the floor the plan priced
    // (the escape stops it FEE_FLOOR_S of fee below that); past the floor the
    // money crime takes over.
    const cr = bodyCreditOf(s.progress, s.lastAugReset, s.now)
    const onCredit = cr && cr.gym === lw.args?.[0] && num(s.cash) && s.cash >= cr.floor
    if (!onCredit && !feeFundable(s.cash, fee)) {
      // NOT IDLE (live 2026-10-02 17:42Z: the body slot sat empty on an
      // unpaid gym): the best money crime trains every combat stat and earns
      // the fee (bodyplan.combatBarPlanOf prices the same fallback).
      if (s.fundCrime) return { kind: 'crime', args: [s.fundCrime], why: `progress.js holds the slot for ${owner} and its gym order (batch ${lw.batchAt}) stopped; the ${lw.args?.[0] ?? 'gym'} fee ($${fee}/s) is not covered for ${FEE_FLOOR_S}s by cash $${Math.round(s.cash ?? 0)} — ${s.fundCrime} trains combat and earns it meanwhile` }
      return { skip: `the ${lw.args?.[0] ?? 'gym'} fee ($${fee}/s) is not covered for ${FEE_FLOOR_S}s by cash $${Math.round(s.cash ?? 0)} — the negative-cash escape would stop it again` }
    }
  }
  return { kind: lw.kind, args: lw.args, why: `progress.js holds the slot for ${owner} (${Math.round((s.now - at) / 60000)} min ago) and its ${lw.kind} order (batch ${lw.batchAt}, ran ${lw.at}) is no longer running — the game shows no work (snapshot ${s.workAt}): re-issued` }
}
