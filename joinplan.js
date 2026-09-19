// When can we JOIN a faction we are not in? Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// factionplan.js ranks factions by the value of working them — but only JOINED
// factions, so the ranking is blind to the top of the augmentation table.
// Measured against the game's own data on 2026-09-14: the best augmentation
// reachable from our two joined factions multiplies progress by x1.28, while
// BitRunners — one backdoor away, gated on hacking 505 — sells a x2.84, and the
// endgame factions hold x35 and x64. A planner that cannot see across the join
// boundary concludes that NeuroFlux (x1.06/level) is competitive, and it is
// right ONLY because the question was constrained wrong.
//
// So this module prices the boundary itself: given a faction's invitation
// requirements (ns.singularity.getFactionInviteRequirements, Singularity.ts:730,
// which returns the game's own declarative requirement objects) and a small
// set of measured rates, it forecasts HOURS UNTIL ELIGIBLE. factionplan.js
// then adds that wait to every horizon of the faction's value walk, which has
// exactly the semantics a 5-minute re-planner needs: a distant faction prices
// low today, its rate climbs as the wait shrinks, and the schedule switches to
// it the pass it becomes worth it — no special cases, no cliff.
//
// ---------------------------------------------------------------------------
// WHAT CAN BE FORECAST, AND WHAT MUST REFUSE
//
// Only quantities with a measurable rate can be given an ETA:
//
//   skills.hacking      exp grows at a measured rate; level = mult*(32*ln(exp+534.6)-200)
//                       (PersonObjects/formulas/skill.ts:13), so invert for the
//                       exp the target needs and divide the gap by the rate.
//   backdoorInstalled   a backdoor needs the server's required hacking level
//                       first, so it forecasts AS a hacking-level target; the
//                       backdoor itself is automated (backdoor.js) and takes
//                       minutes, which rounds to zero against multi-hour waits.
//   money               gap / measured income per second.
//
//   skills.<combat>     a gym class at a known exp rate (bodyplan.js), ACTIVE
//   karma / kills       a crime trajectory (bodyplan.js), ACTIVE, one leg per
//                       invitation whose exp is credited to the combat legs
//
// Everything else — jobs by title, files, bladeburner rank, infiltrations —
// has no rate this stack measures, so an UNSATISFIED requirement of those
// types yields null: "cannot tell", which the caller must treat as not-priceable.
// A SATISFIED requirement of any type is 0 hours regardless, which is what
// lets compound requirements pass through partial knowledge.
//
// `numAugmentations` is the deliberate odd case: the count only moves at an
// install, not with time, so there is no rate to divide by. Unsatisfied means
// null even though we roughly control it — guessing "one install away" would
// price Daedalus as imminent from the day the run starts.
//
// THE REFUSAL IS THE POINT. This repo's standing rule is that "I could not
// tell" must never present as an answer (CLAUDE.md, invariant B8). A faction
// whose wait cannot be forecast is reported as such and ranked at zero, not
// silently given a flattering ETA — overstating a locked faction would divert
// real work toward a gate that may never open.

// ---------------------------------------------------------------------------
// ACTIVE VERSUS PASSIVE WAITS — the split that company work forces
//
// A hacking-level or money wait is PASSIVE: batching produces both while we
// grind faction reputation, so the wait costs the schedule nothing beyond
// deferring the locked faction. Company reputation is ACTIVE: the work slot
// is exclusive (starting company work stops faction work and vice versa), so
// every forecast hour of it displaces an hour of grinding.
//
// The two also OVERLAP in wall-clock: hacking keeps rising while we sit at a
// desk at ECorp. So for a conjunction the total is
//
//     hours = max( max(passive parts), sum(active parts) )
//
// — passive parts run concurrently with everything, active parts serialise
// only with each other. joinWait reports both `hours` (wall-clock) and
// `activeHours` (the displacing part) so factionplan.js can charge them
// differently.

import { expForSkill, skillFromExp } from 'installgate.js'
import { hoursToCompanyRep, qualifies, SOFTWARE_TRACK, offsetOf } from 'companyplan.js'
import { repLadder } from 'favor.js'
import { crimeLeg, gymLegs, COMBAT } from 'bodyplan.js'

/**
 * CONSTANTS.TravelCost (Constants.ts:28). Travel between cities is a flat fee
 * and takes no game time at all, which is what makes a `city` requirement
 * cost hours = 0 rather than being unpriceable.
 */
const TRAVEL_COST = 200e3


/**
 * Hours until a hacking-level target, from measured exp flow.
 *
 * `exp` and `expPerSec` are the LIVE values; `mult` is the CURRENT hacking
 * multiplier. The forecast is therefore only valid within this life — an
 * install moves the multiplier and resets nothing here, which is fine, because
 * the caller replans every pass and each pass re-reads the live inputs.
 *
 * Returns 0 when the target is already met, null when it cannot be forecast
 * (no positive rate, unreadable inputs).
 */
export function hoursToHackingLevel(target, o = {}) {
  const { exp, mult, expPerSec } = o
  const num = (x) => typeof x === 'number' && isFinite(x)
  if (!num(target) || !num(exp) || exp < 0 || !num(mult) || mult <= 0) return null
  // The game FLOORS the displayed level (skill.ts:13 via Math.floor), and the
  // requirement compares against the floored value — so the exp that puts the
  // unfloored curve at exactly `target` can still display target-1 by one ULP.
  // Nudge upward until the game's own floored function agrees the level is
  // reached; the nudge is relative, so it is sub-second at any real exp rate.
  let needExp = expForSkill(target, mult)
  if (skillFromExp(needExp, mult) < target) needExp = needExp * (1 + 1e-9) + 1e-9
  if (exp >= needExp) return 0
  if (!num(expPerSec) || expPerSec <= 0) return null
  return (needExp - exp) / expPerSec / 3600
}

/**
 * Hacking-level targets across the install boundary. Exp RESETS every
 * install, so a per-life forecast for a target beyond this life's reach is
 * fiction (it once priced fulcrumassets at 172,658h) — but the MULTIPLIER
 * compounds at the measured per-install growth, so each successive window
 * reaches higher. Ladder the windows: cycle n reaches
 * skillFromExp(expPerSec·gⁿ·window, mult·gⁿ), and both the exp rate and the
 * multiplier ride the same measured g (the exp rate grows WITH the
 * multiplier — faster hacks, richer targets — so one factor for both is the
 * conservative single-parameter model).
 *
 * PASSIVE, like every level wait: batching produces this while anything else
 * is being worked. Falls back to the plain per-life forecast when no window
 * is measured.
 */
function hoursToLevelWindowed(target, state) {
  const perLife = hoursToHackingLevel(target, {
    exp: state.hackingExp,
    mult: state.hackingMult,
    expPerSec: state.expPerSec,
  })
  const wH = state.windowH
  if (!(typeof wH === 'number' && isFinite(wH) && wH > 0)) return perLife
  const remaining = Math.max(0.05, wH - (typeof state.lifeAgeH === 'number' && state.lifeAgeH > 0 ? state.lifeAgeH : 0))
  if (perLife !== null && perLife <= remaining) return perLife
  const g = typeof state.rateGrowthPerCycle === 'number' && state.rateGrowthPerCycle >= 1 ? state.rateGrowthPerCycle : 1
  const { hackingMult, expPerSec } = state
  if (!(hackingMult > 0) || !(expPerSec > 0)) return perLife
  let hours = remaining
  for (let n = 1; n <= 200; n++) {
    const mult = hackingMult * Math.pow(g, n)
    const rate = expPerSec * Math.pow(g, n)
    const reach = skillFromExp(rate * wH * 3600, mult)
    if (reach >= target) {
      const need = Math.max(0, expForSkill(target, mult) * 1.000000001)
      return hours + need / rate / 3600
    }
    hours += wH
  }
  return null // 200 windows of compounding cannot reach it — refuse, loudly absent
}

/** Hours left in this life, from the measured install window; null if unmeasured. */
function remainingWindowH(state) {
  const wH = state?.windowH
  if (!(typeof wH === 'number' && isFinite(wH) && wH > 0)) return null
  const age = typeof state.lifeAgeH === 'number' && state.lifeAgeH > 0 ? state.lifeAgeH : 0
  return Math.max(0.05, wH - age)
}

/**
 * Hours until one requirement object is satisfied — the game's own JSON shape
 * (NetscriptDefinitions.d.ts:11342-11515). 0 = satisfied now, a positive
 * number = forecast, null = cannot tell.
 *
 * `state` carries measurements:
 *   hacking, hackingExp, hackingMult, expPerSec   — the skill forecast
 *   money, incomePerSec                           — the money forecast
 *   augCount                                      — installed+queued augmentations
 *   backdoors: {host: true}                       — already-backdoored servers
 *   serverLevels: {host: requiredHackingLevel}    — for backdoor forecasting
 *
 * Compound semantics mirror the game's evaluation (FactionJoinCondition.ts):
 * `everyCondition` needs them all — the answer is the MAX, and one null makes
 * the whole thing null UNLESS the known parts already dominate nothing (any
 * unknown poisons a conjunction, because the unknown part could be the
 * binding one). `someCondition` needs any — the MIN over the known branches
 * stands even if other branches are unknown, because a satisfiable branch is
 * enough. `not` of a satisfied condition is unfulfillable by waiting (we do
 * not forecast LOSING progress), so it is null unless already satisfied.
 */
export function timeToMeet(req, state = {}) {
  const r = meet(req, state)
  return r === null ? null : r.hours
}

/** The full evaluator: `{hours, active}` where `active` is the portion that
 *  displaces faction work (company employment). Passive and active overlap in
 *  wall-clock, so `hours >= active` always. */
export function meet(req, state = {}) {
  if (!req || typeof req !== 'object' || typeof req.type !== 'string') return null
  const num = (x) => typeof x === 'number' && isFinite(x)
  const passive = (h) => (h === null ? null : { hours: h, active: 0 })

  switch (req.type) {
    case 'skills': {
      // Partial<Skills>. Hacking is PASSIVE (batching raises it under any
      // other work). The four combat stats are ACTIVE: a gym class holds the
      // work slot, one stat at a time (bodyplan.js has the rate). Charisma
      // has no trainer wired here and stays satisfied-or-null.
      //
      // The combat legs start from the person AFTER any crime leg the same
      // invitation needs (joinWait precomputes it as state.bodyAfterCrime):
      // homicide for karma also trains every combat stat, so pricing the gym
      // from today's exp would charge for exp the crimes have already paid.
      let worst = 0
      const combat = {}
      for (const [skill, target] of Object.entries(req.skills ?? {})) {
        if (!num(target)) return null
        if (skill === 'hacking') {
          const h = hoursToLevelWindowed(target, state)
          if (h === null) return num(state.hacking) && state.hacking >= target ? passive(worst) : null
          worst = Math.max(worst, h)
        } else if (COMBAT.includes(skill)) {
          const have = state.skills?.[skill]
          if (num(have) && have >= target) continue
          combat[skill] = target
        } else {
          const have = state.skills?.[skill]
          if (!(num(have) && have >= target)) return null
          // satisfied: contributes 0
        }
      }
      if (!Object.keys(combat).length) return passive(worst)
      // THE INSTALL BOUNDARY. Every skill's exp resets at an install
      // (prestigeAugmentation), and unlike hacking there is no measured
      // per-install growth for the combat rates to ladder on — so a gym leg
      // must fit inside ONE life. The crime credit only stands when crime and
      // gym both fit in what is left of THIS life; otherwise the gym is priced
      // from a fresh life's zero exp, and a leg longer than a whole window is
      // reported as unreachable (Infinity — a real answer, distinct from null).
      const remaining = remainingWindowH(state)
      const crimeH = state.crimeLeg?.hours ?? 0
      let g = gymLegs(combat, state.bodyAfterCrime ?? state.body, state.trainingMult)
      if (!g) return null
      if (!isFinite(g.hours)) return null // no rate at all: unreadable, not "never"
      let why
      if (remaining !== null && crimeH + g.hours > remaining) {
        const fresh = gymLegs(combat, state.body, state.trainingMult)
        if (!fresh || !isFinite(fresh.hours)) return null
        g = { ...fresh, uncredited: true }
        if (g.hours > state.windowH) why = `${g.hours.toFixed(1)}h of gym does not fit one ${state.windowH.toFixed(2)}h install window`
      }
      if (why) return { hours: Infinity, active: Infinity, gym: { ...g, why } }
      return { hours: Math.max(worst, g.hours), active: g.hours, gym: g }
    }

    case 'karma': {
      // ACTIVE: crime holds the work slot. One leg covers karma AND kills for
      // the whole invitation (bodyplan.crimeLeg), precomputed by joinWait so
      // the same crimes are not charged twice; charged HERE when a karma
      // requirement exists, and by numPeopleKilled otherwise.
      if (!num(req.karma)) return null
      if (num(state.body?.karma) && state.body.karma <= req.karma) return passive(0)
      const leg = state.crimeLeg ?? crimeLeg({ karma: req.karma }, state.body, state.node, { focus: state.focus })
      if (!leg || !isFinite(leg.hours)) return null
      return { hours: leg.hours, active: leg.hours, crime: { type: leg.crime, hours: leg.hours, karma: leg.karma, kills: leg.kills } }
    }

    case 'numPeopleKilled': {
      if (!num(req.numPeopleKilled)) return null
      if (num(state.body?.numPeopleKilled) && state.body.numPeopleKilled >= req.numPeopleKilled) return passive(0)
      const leg = state.crimeLeg ?? crimeLeg({ kills: req.numPeopleKilled }, state.body, state.node, { focus: state.focus })
      if (!leg || !isFinite(leg.hours)) return null
      // Kills reset at every install (PlayerObjectGeneralMethods.ts:83, in
      // prestigeAugmentation) where karma does not (:146, prestigeSourceFile
      // only) — so a kill count must be earned inside one life.
      const remaining = remainingWindowH(state)
      if (remaining !== null && leg.hours > remaining) {
        const why = `${leg.hours.toFixed(1)}h of ${leg.crime} does not fit the ${remaining.toFixed(2)}h left of this life; kills reset at install`
        return { hours: Infinity, active: Infinity, crime: { type: leg.crime, hours: leg.hours, karma: leg.karma, kills: leg.kills, why } }
      }
      const crime = { type: leg.crime, hours: leg.hours, karma: leg.karma, kills: leg.kills }
      // Already charged by the karma requirement of the same invitation; the
      // leg is still named here so the blocker reads as what it is.
      if (leg.karma !== null && state.crimeLeg) return { hours: 0, active: 0, crime }
      return { hours: leg.hours, active: leg.hours, crime }
    }

    case 'backdoorInstalled': {
      if (state.backdoors?.[req.server]) return passive(0)
      const lvl = state.serverLevels?.[req.server]
      if (!num(lvl)) return null
      const h = hoursToLevelWindowed(lvl, state)
      // At-level but not yet backdoored: backdoor.js acts within its next pass,
      // minutes against the multi-hour scale here. Report a small floor rather
      // than 0 so "eligible now" stays distinguishable from "almost".
      return h === null ? null : passive(Math.max(h, 0.1))
    }

    case 'money': {
      if (!num(req.money)) return null
      if (num(state.money) && state.money >= req.money) return passive(0)
      if (!num(state.money) || !num(state.incomePerSec) || state.incomePerSec <= 0) return null
      return passive((req.money - state.money) / state.incomePerSec / 3600)
    }

    case 'city': {
      // TRAVEL IS INSTANT. Singularity.travelToCity does no netscriptDelay and
      // no work — it charges CONSTANTS.TravelCost ($200k) and returns
      // (Singularity.ts:375-393). So the honest price of a `city` requirement
      // is zero hours and a rounding-error sum, not the refusal this used to
      // fall through to.
      //
      // That refusal was expensive. `city` is the ONLY unmet branch of Tian Di
      // Hui's someCondition, so the whole faction priced as unpriceable and
      // ranked nowhere — eight augmentations behind 138,750 reputation, while
      // the schedule ground 1,138,561 at ECorp for multipliers the run no
      // longer needed. The same refusal hid every city faction.
      //
      // Reported as a real cost rather than free, because it is not free: a
      // run too poor for $200k genuinely cannot take this branch, and at that
      // point the shortfall is priced off income exactly like `money`.
      //
      // The destination rides along as `travel`, the same way the Leadership
      // step rides along as `train`. A price nobody can act on is not a plan:
      // pricing this at zero hours while no code travels would have ranked
      // Tian Di Hui first and then waited forever for an invitation that only
      // arrives once the player is standing in the city.
      if (!num(state.money)) return null
      const go = typeof req.city === 'string' ? { travel: { city: req.city } } : {}
      if (state.money >= TRAVEL_COST) return { ...passive(0), ...go }
      if (!num(state.incomePerSec) || state.incomePerSec <= 0) return null
      return { ...passive((TRAVEL_COST - state.money) / state.incomePerSec / 3600), ...go }
    }

    case 'hacknetLevels':
    case 'hacknetRAM':
    case 'hacknetCores': {
      // MONEY, AND NOTHING ELSE. Hacknet capacity is bought outright — the API
      // needs no Source-File (RamCostConstants.Hacknet is a flat 0.5GB, not
      // SF4-scaled), there is no grind and no cooldown, and hacknet.js buys the
      // cheapest upgrade that moves a requirement and stops.
      //
      // So the honest price is the price of the upgrades, and the honest answer
      // to "how long" is how long earning that costs — which at any mid-run
      // income is zero hours. Refusing instead made Netburners UNPRICEABLE, and
      // an unpriceable faction ranks nowhere: five distinct augmentations, the
      // cheapest faction in the game to unlock, invisible to the planner while
      // the run sat nine augmentations short of Daedalus's thirty.
      //
      // `hacknetSpend` is supplied by the caller because this module has no ns
      // surface and cannot price the upgrade curve itself. Absent, this still
      // REFUSES rather than guessing — a fabricated zero here would claim
      // Netburners is free from the first second of a run, which is the
      // numAugmentations mistake in a different costume.
      const spend = state.hacknetSpend
      if (!num(spend) || spend < 0) return null
      if (!num(state.money)) return null
      if (state.money >= spend) return passive(0)
      if (!num(state.incomePerSec) || state.incomePerSec <= 0) return null
      return passive((spend - state.money) / state.incomePerSec / 3600)
    }

    case 'numAugmentations': {
      // The count moves at INSTALLS — which is no longer a refusal, because
      // the lifetimes ledger measures augs-per-install and the ticket sweep
      // buys the cheap tail deliberately. Short of a measured rate the old
      // refusal stands: guessing a count trajectory would price Daedalus as
      // imminent from day one, the exact failure this case always refused.
      if (num(state.augCount) && num(req.numAugmentations) && state.augCount >= req.numAugmentations) return passive(0)
      const per = state.augsPerWindow
      if (num(per) && per > 0 && num(state.windowH) && state.windowH > 0 && num(state.augCount) && num(req.numAugmentations)) {
        return passive(Math.ceil((req.numAugmentations - state.augCount) / per) * state.windowH)
      }
      return null
    }

    case 'companyReputation': {
      // ACTIVE: every forecast hour here displaces an hour of faction work.
      // The walk, the promotion ladder and the charisma wall live in
      // companyplan.js; this only threads the live inputs through. The
      // requirement's `reputation` is the EFFECTIVE value — the game applies
      // the 25% backdoor discount before reporting it (FactionJoinCondition.ts,
      // toJSON via calculateEffectiveRequiredReputation).
      const ctx = state.companyCtx
      if (!ctx || typeof req.company !== 'string' || !num(req.reputation)) return null
      const w = hoursToCompanyRep(req.reputation, {
        company: req.company,
        currentRep: ctx.repByCompany?.[req.company],
        measuredRepPerSec: ctx.measuredRates?.[req.company],
        heldPosition: ctx.jobs?.[req.company] ?? null,
        // Company FAVOUR survives installs and multiplies the rate by
        // (1 + favor/100) — the ladder that makes a megacorp join converge
        // across lives even though reputation itself resets at each one.
        favor: ctx.favorByCompany?.[req.company] ?? 0,
        hacking: ctx.hacking,
        // Hacking rises from batching during the stint — measured in the
        // OUTER state (the same exp flow the skill forecasts use), and it
        // unlocks the hacking-gated promotion bars mid-walk.
        hackExp: state.hackingExp,
        hackExpRate: state.expPerSec,
        hackMult: state.hackingMult,
        charisma: ctx.charisma,
        chaExp: ctx.chaExp,
        chaMult: ctx.chaMult,
        chaExpMult: ctx.chaExpMult,
        intelligence: ctx.intelligence,
        companyRepMult: ctx.companyRepMult,
        nodeCompanyRepMult: ctx.nodeCompanyRepMult,
        nodeCompanyExpMult: ctx.nodeCompanyExpMult,
        // Leadership at the best university, for the training CANDIDATE —
        // whether training actually enters the plan is decided by comparing
        // total hours, per forecast, not by any rule here.
        uniChaExpPerSec: ctx.uniChaExpPerSec,
      })
      if (w === null) return null
      // THE INSTALL BOUNDARY, for companies too. Company reputation resets at
      // every install exactly like faction reputation (Company.ts:77-80), so
      // a stint longer than the remaining window LADDERS through company
      // favour and multiplier growth rather than accumulating. The stint's
      // average rate feeds repLadder with the favour stripped back out
      // (repLadder re-applies it); folding training time into that average is
      // deliberate honesty — charisma resets per install as well, so the
      // study is RE-PAID every cycle, not amortised once.
      let hours = w.hours
      let spans = 0
      const favor = ctx.favorByCompany?.[req.company] ?? 0
      const currentRep = ctx.repByCompany?.[req.company] ?? 0
      if (num(state.windowH) && state.windowH > 0 && w.hours > 0) {
        const remaining = Math.max(0.05, state.windowH - (num(state.lifeAgeH) ? state.lifeAgeH : 0))
        // The ladder's base rate comes from a FAVOUR-FREE, TRAINING-FREE run
        // of the same simulation, and repLadder applies favour itself. The
        // obvious shortcut — divide the real stint's average by the favour
        // multiplier — is subtly wrong: the training block is a fixed chunk
        // inside favour-scaled hours, so the blend dilutes differently at
        // different favours and banked favour appeared to LENGTHEN the
        // ladder (caught by JP6). Training is honestly absent per-cycle too:
        // within a ~1.7h window the study never amortises, and charisma
        // resets each install anyway.
        const clean = hoursToCompanyRep(req.reputation, {
          company: req.company,
          currentRep,
          heldPosition: ctx.jobs?.[req.company] ?? null,
          favor: 0,
          hacking: ctx.hacking,
          hackExp: state.hackingExp,
          hackExpRate: state.expPerSec,
          hackMult: state.hackingMult,
          charisma: ctx.charisma,
          chaExp: ctx.chaExp,
          chaMult: ctx.chaMult,
          chaExpMult: ctx.chaExpMult,
          intelligence: ctx.intelligence,
          companyRepMult: ctx.companyRepMult,
          nodeCompanyRepMult: ctx.nodeCompanyRepMult,
          nodeCompanyExpMult: ctx.nodeCompanyExpMult,
          uniChaExpPerSec: null,
        })
        if (clean && clean.hours > 0) {
          const l = repLadder(req.reputation, {
            windowH: state.windowH,
            remainingWindowH: remaining,
            baseRepPerSec: Math.max(0, req.reputation - currentRep) / (clean.hours * 3600),
            favor,
            currentRep,
            hoursNow: w.hours,
            rateGrowthPerCycle: state.rateGrowthPerCycle,
          })
          if (l && !l.reachableNow) {
            hours = l.totalHours
            spans = l.cycles
          }
        }
      }
      // Training and desk hours BOTH displace faction work — all active.
      // `train` is surfaced so the acting layer knows to study before it
      // clocks in, rather than re-deriving the plan a second way.
      return {
        hours,
        active: hours,
        ...(w.trainH > 0 ? { train: { toCha: w.trainToCha, hours: w.trainH } } : {}),
        ...(spans > 0 ? { spansInstalls: spans, holdH: w.hours } : {}),
      }
    }

    case 'employedBy': {
      // Holding the job satisfies it; being HIRABLE satisfies it too, because
      // applyToCompany is instant for a rung the stats qualify for. Neither is
      // a forecast — both are 0. Unqualified is unknown, not scheduled: we do
      // not model training stats.
      if (state.companyCtx?.jobs?.[req.company]) return passive(0)
      const off = offsetOf(req.company)
      const ctx = state.companyCtx
      if (off === null || !ctx) return null
      return SOFTWARE_TRACK.some((p) => qualifies(p, off, ctx)) ? passive(0) : null
    }

    case 'everyCondition': {
      // Passive parts run concurrently with everything; active parts serialise
      // only with each other. See the header.
      let worstPassive = 0
      let activeSum = 0
      for (const c of req.conditions ?? []) {
        const r = meet(c, state)
        if (r === null) return null // an unknown conjunct could be the binding one
        activeSum += r.active
        // An infinite active leg would make hours - active NaN; its passive
        // share is simply nothing, the sum already carries the Infinity.
        worstPassive = Math.max(worstPassive, r.active === Infinity ? 0 : r.hours - r.active)
      }
      return { hours: Math.max(worstPassive, activeSum), active: activeSum }
    }

    case 'someCondition': {
      let best = null
      for (const c of req.conditions ?? []) {
        const r = meet(c, state)
        // Ties break toward the branch that displaces less faction work.
        if (r !== null && (best === null || r.hours < best.hours || (r.hours === best.hours && r.active < best.active))) best = r
      }
      return best // known branches suffice; unknown ones can only be worse than the best known
    }

    case 'not': {
      // The only way to check is to evaluate the inner condition as satisfied
      // NOW. We never forecast becoming worse (losing karma, quitting a job),
      // so an unmet `not` is unknown, not scheduled.
      //
      // `not employedBy` is the one shape where "satisfied now" is NOT what
      // the inner evaluator answers: employedBy prices HIRABLE as 0 hours,
      // which is right for a join that needs the job and wrong for one that
      // forbids it — the CIA does not care whether we could work there, only
      // whether we do. Live, that read every "not employed by CIA/NSA" as
      // unknown and made Speakers for the Dead, The Dark Army and The
      // Syndicate unpriceable for a job we have never held.
      if (req.condition?.type === 'employedBy') {
        const jobs = state.companyCtx?.jobs
        if (!jobs || typeof jobs !== 'object') return null
        return jobs[req.condition.company] ? null : passive(0)
      }
      const r = meet(req.condition, state)
      return r === null ? null : r.hours === 0 ? null : passive(0)
    }

    default:
      // jobTitle, file, bladeburnerRank, location, numInfiltrations, bitNodeN…
      // — no rate this stack measures. Refuse rather than guess.
      return null
  }
}

/**
 * ONE crime leg per invitation. Karma and kill requirements anywhere in the
 * invitation (the conjunctive spine and any someCondition branch) are
 * gathered into the strictest pair and simulated once; the person that
 * comes out of that leg is what the combat-stat legs start from. Without
 * this, "karma -45 and 30 kills and combat 300" would be priced as three
 * independent grinds when the homicides that pay the first two also train
 * the third.
 */
function withCrimeLeg(list, state) {
  if (!state?.body) return state
  const want = { karma: null, kills: null }
  const gather = (r) => {
    if (!r || typeof r !== 'object') return
    if (r.type === 'karma' && typeof r.karma === 'number') want.karma = want.karma === null ? r.karma : Math.min(want.karma, r.karma)
    if (r.type === 'numPeopleKilled' && typeof r.numPeopleKilled === 'number') want.kills = Math.max(want.kills ?? 0, r.numPeopleKilled)
    if (r.type === 'everyCondition' || r.type === 'someCondition') for (const c of r.conditions ?? []) gather(c)
  }
  for (const r of list) gather(r)
  // Already met requirements need no leg — and must not produce one, or the
  // exp credit would be invented.
  if (want.karma !== null && state.body.karma <= want.karma) want.karma = null
  if (want.kills !== null && state.body.numPeopleKilled >= want.kills) want.kills = null
  if (want.karma === null && want.kills === null) return state
  const leg = crimeLeg(want, state.body, state.node, { focus: state.focus })
  if (!leg) return state
  return { ...state, crimeLeg: leg, bodyAfterCrime: leg.person }
}

/**
 * Hours until a faction's whole invitation is earned, with the blockers named.
 *
 * Returns `{ hours, known, blockers }`:
 *   hours     forecast to eligibility, 0 if eligible now, null if not priceable
 *   known     false when hours is null — the caller must SHOW the faction as
 *             unpriceable, not drop it (a hidden faction is a silent zero)
 *   blockers  each requirement with its own forecast, for telemetry — "gated
 *             on hacking 505, ~9.3h away" is checkable, a bare number is not
 */
export function joinWait(requirements, state = {}) {
  const list = Array.isArray(requirements) ? requirements : null
  if (!list) return { hours: null, activeHours: 0, known: false, blockers: [] }
  state = withCrimeLeg(list, state)
  // The list is a conjunction (the game requires all of them), so it composes
  // exactly like everyCondition: passive parts concurrent, active parts serial.
  let worstPassive = 0
  let activeSum = 0
  let known = true
  const blockers = []
  for (const r of list) {
    const m = meet(r, state)
    blockers.push({
      type: r?.type ?? '?',
      hours: m === null ? null : m.hours,
      ...(m !== null && m.active > 0 ? { activeHours: m.active } : {}),
      ...(m?.train ? { train: m.train } : {}),
      ...(m?.travel ? { travel: m.travel } : {}),
      ...(m?.gym ? { gym: m.gym } : {}),
      ...(m?.crime ? { crime: m.crime } : {}),
      ...(m?.spansInstalls ? { spansInstalls: m.spansInstalls, holdH: m.holdH } : {}),
      detail:
        r?.server ??
        r?.company ??
        (r?.skills ? JSON.stringify(r.skills) : undefined) ??
        (typeof r?.karma === 'number' ? `karma <= ${r.karma}` : undefined) ??
        (typeof r?.numPeopleKilled === 'number' ? `kills >= ${r.numPeopleKilled}` : undefined) ??
        (r?.type === 'not' ? `not ${r.condition?.type ?? '?'} ${r.condition?.company ?? ''}`.trim() : undefined),
    })
    if (m === null) known = false
    else {
      activeSum += m.active
      worstPassive = Math.max(worstPassive, m.active === Infinity ? 0 : m.hours - m.active)
    }
  }
  return {
    hours: known ? Math.max(worstPassive, activeSum) : null,
    // Reported separately because max() is not invertible: the caller charges
    // passive hours as a release time and active hours as exclusive work, and
    // neither can be recovered from the combined figure once one dominates.
    passiveHours: known ? worstPassive : 0,
    activeHours: known ? activeSum : 0,
    known,
    blockers,
  }
}
