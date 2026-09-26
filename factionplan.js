// Which faction to work, priced economically. Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// WHY A STATIC LIST IS THE WRONG ANSWER
//
// progress.js used to pick from a hand-ordered HACK_FACTIONS list — Daedalus,
// BitRunners, The Black Hand, NiteSec, CyberSec — and take the first one
// joined. That encodes one true fact (Daedalus sells better augmentations than
// CyberSec) and then applies it to a question it does not answer: *where is an
// hour of work worth most, right now?*
//
// The answer moves. It depends on how much reputation each faction already has,
// how far its next augmentations are, what those augmentations actually
// multiply, and how close the faction is to accepting donations. A fixed list
// cannot express any of that, and live it was demonstrably wrong: it ground
// NiteSec while CyberSec sat 110,783 reputation closer to the donation
// threshold, because NiteSec ranks higher.
//
// ---------------------------------------------------------------------------
// THE MODEL
//
// Working a faction buys reputation, and reputation is only worth what it
// UNLOCKS. So value each faction by the multiplier its locked augmentations
// would add, against the time to earn the reputation that releases them:
//
//     for each faction, sort its unbought augmentations by repReq ascending
//     walk that list accumulating sum(ln m_i)
//     at each step, rate = accumulated ln(M) / hours to reach that repReq
//     the faction's value is the BEST rate over that walk
//
// Taking the best rate over the walk, rather than the total, is what stops a
// single very distant augmentation from making a faction look good: reaching
// the first two cheap ones at a high rate is worth more than a long march to a
// better one, and the walk finds whichever is true.
//
// REPUTATION IS THE SCARCE SIDE, so this prices rep-time and not money. That
// holds while money strands — we destroyed $6.37b in one install for want of
// reputation to spend it on. If money ever becomes binding instead, this model
// is the wrong one and augplan.js's budget is the right one; the two are
// deliberately separate so that switch is visible rather than silent.
//
// THE FAVOUR TERM is reported, not folded in. Crossing the donation threshold
// converts money into reputation permanently, which is worth more than any
// single augmentation — but its value depends on future income, which this
// module cannot see. So `crossesOnNextInstall` is surfaced for the caller to
// weigh, rather than buried in a number that looks objective and is not.

import { RATE_CHANNELS } from 'installgate.js'
// Valuation lives in ONE place — see objective.js's header for the three
// independent scorers this replaces and what each of them got wrong.
import { augValue, TICKET_LN } from 'objective.js'

/**
 * The augmentation that ENDS the BitNode, which has no multipliers at all.
 *
 * Its ln-value here must match the synthetic selection value augplan.js gives
 * it (Math.exp(10), so ln = 10) — asserted by [FP15], because the two live in
 * different files and a silent divergence puts the run's last purchase back out
 * of reach.
 */
/**
 * ln of the multiplier one augmentation adds, on the channels that matter.
 *
 * THE RED PILL IS NOT SCORED THAT WAY, because it has no multipliers — it ends
 * the node. Scored on the rate channels it is worth exactly ln(1) = 0, which
 * ranked DAEDALUS, the only faction that can finish the run, at the bottom of
 * the work schedule. Live in BitNode 1 with all 30 distinct augmentations
 * already installed and hacking 5994 against an exit bar of 3000: the schedule
 * had chosen a 4.98-hour ECorp grind for multipliers the run no longer needed,
 * and would have kept choosing one after Daedalus became joinable, because
 * Daedalus's whole point scored zero.
 *
 * This is the THIRD module to need telling. augplan.js gives it a synthetic
 * selection value so the optimiser will buy it; installgate.js has `terminal`
 * so the gate will not refuse the install; this is the one that decides what to
 * GRIND, and nobody had told it. The pattern is worth naming: every module that
 * scores by multiplier has to be told, separately, that the augmentation the
 * entire run exists to reach has none.
 */
export const logValue = (mults, channels = RATE_CHANNELS, weights = null, name = null) =>
  augValue({ name, mults }, { channels, weights }).ln

/**
 * Value of working one faction: the best ln(M) per hour reachable by grinding
 * its locked augmentations, and the horizon at which that best occurs.
 *
 * @param {object} f  `{ name, rep, augs: [{ name, repReq, mults }] }`
 * @param {number} baseRepPerSec  reputation per second BEFORE the favour
 *                     multiplier, which this applies from the faction's own
 *                     favour (reputation.ts:9).
 * @returns `{ name, rate, hours, unlocks, repNeeded }`, or null if unreadable.
 */
export function valueOfWorking(f, baseRepPerSec, o = {}) {
  const channels = o.channels ?? RATE_CHANNELS
  const rep = f?.rep
  if (typeof rep !== 'number' || !isFinite(rep) || rep < 0) return null
  if (!(baseRepPerSec > 0)) return null

  // FAVOUR MULTIPLIES THE RATE, not just the donation threshold.
  // PersonObjects/formulas/reputation.ts:9 — `favorMult = 1 + favor / 100`,
  // applied to every faction work gain. So a high-favour faction earns
  // reputation materially faster, and ignoring that mis-ranks in exactly the
  // direction the static list already got wrong: CyberSec at 95.1 favour earns
  // 1.951x, NiteSec at 35.4 earns 1.354x — a 44% difference on top of having
  // nearer augmentations.
  //
  // A missing or unreadable favour falls back to 1x rather than being guessed
  // upward: understating a faction's rate can only make us work a different one,
  // while overstating it sends work to a faction that will not pay.
  const favor = typeof f?.favor === 'number' && isFinite(f.favor) && f.favor >= 0 ? f.favor : 0
  const repPerSec = baseRepPerSec * (1 + favor / 100)

  // Only augmentations we do not hold and have not reached yet: anything
  // already affordable on reputation needs no more WORK, so it contributes
  // nothing to the value of working.
  const locked = (f.augs ?? [])
    .filter((a) => typeof a?.repReq === 'number' && isFinite(a.repReq) && a.repReq > rep)
    .sort((a, b) => a.repReq - b.repReq)

  // THE JOIN BOUNDARY, priced as a wait in the denominator.
  //
  // A faction we cannot join yet (`joinWaitHours` > 0, forecast by joinplan.js
  // from the game's own invitation requirements) is not worthless — it is the
  // same value walk, delayed. Adding the wait to EVERY horizon is what makes
  // the greedy scheduler handle it with no special cases: today the wait
  // dominates and the faction ranks low; each pass the wait shrinks, its rate
  // climbs, and it takes the top the pass it deserves to. Measured live, this
  // is the difference between "NeuroFlux is competitive" and seeing that
  // BitRunners' x2.84 sits 9 hours away behind hacking 505.
  //
  // An UNKNOWN wait is not zero and not infinity — the faction is refused a
  // rate entirely (null, reported by rankFactions as unpriceable). Zero would
  // rank a locked faction as open; infinity would silently hide it. Both are
  // the "unknown read as an answer" bug this repo keeps paying for.
  let wait = 0
  if (f?.joinWaitHours !== undefined && f.joinWaitHours !== 0) {
    if (typeof f.joinWaitHours !== 'number' || !isFinite(f.joinWaitHours) || f.joinWaitHours < 0) return null
    wait = f.joinWaitHours
  }
  // ACTIVE work (company employment, from joinplan.js) is the other kind of
  // pre-grind cost. It differs from the wait in both directions: it can start
  // NOW (no release to wait for), and it is exclusive (each hour displaces an
  // hour of grinding). The two overlap in wall-clock — hacking rises while we
  // sit at the desk — so the pre-grind cost is max(wait, work), not the sum.
  let work = 0
  if (f?.joinWorkHours !== undefined && f.joinWorkHours !== 0) {
    if (typeof f.joinWorkHours !== 'number' || !isFinite(f.joinWorkHours) || f.joinWorkHours < 0) return null
    work = f.joinWorkHours
  }

  let acc = 0
  let best = { rate: 0, hours: 0, unlocks: [], repNeeded: 0 }
  const unlocks = []
  // THE GRIND IS A TRAJECTORY. Faction rep gain is linear in hacking level
  // (reputation.ts:17) and the level rises the whole time, so "rep / rate"
  // overstates every horizon — measured live, a snapshot-20h haul is ~17h.
  // `o.repTime(rep, favorMult, startH)` is trajectory.js's inversion; absent
  // or refusing, the constant-rate division stands (the old, bounded-above
  // answer). The pre-grind phase shifts startH: the level keeps rising while
  // we wait or sit at a desk, so the grind starts at a HIGHER rate.
  const preH = Math.max(wait, work)
  const grindTime = (repNeeded) => {
    if (typeof o.repTime === 'function') {
      const h = o.repTime(repNeeded, 1 + favor / 100, (o.startHours ?? 0) + preH)
      if (typeof h === 'number' && isFinite(h) && h >= 0) return h
    }
    return repNeeded / repPerSec / 3600
  }
  // THE COUNT GATE'S TICKETS (o.tickets = {names: Set, left}): while the
  // exit's distinct-augmentation count is short, each unowned distinct
  // augmentation is worth TICKET_LN on top of its multipliers — the same
  // dominance value augplan buys them by — at most `left` of them per walk.
  // Without it the schedule scored a ticket by its multipliers alone: live
  // BN8 2026-09-26, one augmentation short, it ground BitRunners toward 460k
  // reputation while LuminCloaking-V1 (Slum Snakes, 1,500 rep, $10m) would
  // have finished the gate.
  let ticketsLeft = o.tickets && o.tickets.left > 0 ? o.tickets.left : 0
  for (const a of locked) {
    const isTicket = ticketsLeft > 0 && o.tickets.names.has(a.name)
    if (isTicket) ticketsLeft--
    const v = logValue(a.mults, channels, o.channelWeights ?? null, a.name) + (isTicket ? TICKET_LN : 0)
    // A zero-value augmentation still costs reputation to pass, so it is walked
    // through rather than skipped — otherwise a wall of worthless augmentations
    // in front of a good one would be invisible.
    acc += v
    unlocks.push(a.name)
    const contH = grindTime(a.repReq - rep)
    // THE INSTALL BOUNDARY. Faction rep resets every install (Faction.ts:79),
    // and the gate installs on a ~1.7h measured cadence — so a grind longer
    // than the remaining window does not accumulate, it LADDERS: each life
    // banks favour and the multiplier compounds, until the grind fits one
    // window. o.ladder (favor.js's repLadder, built from the measured window
    // and growth) prices that truthfully; without it the continuous figure
    // stands, which is the fiction that published "BitRunners 21.1h" across
    // what would have been twelve rep wipes.
    let hoursAll = preH + contH
    let spans = 0
    // `banked: true` entries are LADDER-EXEMPT: their requirement is
    // cumulative banked reputation (the favour crossing), which the install
    // boundary cannot wipe — favor.ts converts the TOTAL banked at each
    // install, so a grind split across five lives loses nothing (FV10 pins
    // the additivity). Laddering them would charge a reset that never happens.
    if (!a.banked && typeof o.ladder === 'function') {
      const l = o.ladder({ repReq: a.repReq, currentRep: rep, favor, hoursNow: contH, extraStartH: (o.startHours ?? 0) + preH })
      if (l) {
        hoursAll = preH + l.totalHours
        spans = l.reachableNow ? 0 : l.cycles
      }
    }
    if (!(hoursAll > 0)) continue
    // Floor at ~4 game-seconds: a near-zero horizon (rep advanced to within a
    // rounding error of an unlock by earlier segments) otherwise divides into
    // an astronomically large rate — a live schedule published a 0.00h segment
    // at rate 3.4e13, which outranks everything real. An unlock that close is
    // effectively free; it should win comfortably, not corrupt the scale.
    const rate = acc / Math.max(hoursAll, 0.001) // Infinity ladder -> rate 0: visible in the ranking, never chosen
    if (rate > best.rate) {
      best = {
        rate,
        hours: hoursAll,
        unlocks: [...unlocks],
        repNeeded: a.repReq - rep,
        // holdH is the continuous-grind alternative: what the unlock costs if
        // the GATE chooses to hold installs instead. The schedule prices the
        // current policy; the hold decision belongs to the gate, and this is
        // how it can see the option.
        ...(spans > 0 ? { spansInstalls: spans, holdH: preH + contH } : {}),
      }
    }
  }
  return { name: f?.name ?? null, joinWaitHours: wait, joinWorkHours: work, ...best }
}

/**
 * Rank joined factions by the value of working them.
 *
 * Factions that cannot be priced are reported in `unreadable` rather than
 * dropped or defaulted to zero — an unknown is a gap in the ranking, not
 * evidence that a faction is worthless.
 */
export function rankFactions(factions, baseRepPerSec, o = {}) {
  const ranked = []
  const unreadable = []
  for (const f of factions ?? []) {
    const v = valueOfWorking(f, baseRepPerSec, o)
    if (v) ranked.push(v)
    else unreadable.push(f?.name ?? '(unnamed)')
  }
  ranked.sort((a, b) => b.rate - a.rate)
  // Every faction priced at zero means nothing locked is worth reputation —
  // a real state (all good augmentations already reachable, or none carry the
  // channels we value), and one the caller must be able to distinguish from
  // "could not tell".
  return { best: ranked.find((r) => r.rate > 0) ?? null, ranked, unreadable, allZero: ranked.length > 0 && ranked.every((r) => r.rate === 0) }
}

/**
 * The full schedule for this install: which faction to work, to what
 * reputation, and what to switch to next.
 *
 * WHY A SCHEDULE AND NOT JUST "THE BEST ONE RIGHT NOW". The greedy choice is
 * already optimal — the segments do not interact, because reputation earned at
 * one faction neither helps nor hinders another, so total time to unlock a
 * chosen SET is the sum of its parts regardless of order. What greedy does not
 * give you is VISIBILITY: "work CyberSec for 2.1h, then NiteSec for 3.4h" is a
 * claim that can be checked against what actually happens, and a single
 * best-right-now pick is not.
 *
 * It also fixes a real lag. progress.js re-evaluates every five minutes, so
 * without this the run keeps grinding a faction for up to five minutes after
 * its last useful augmentation has already been unlocked. The schedule names
 * the reputation at which the current segment ENDS, so the caller can switch
 * the moment it is crossed rather than at the next tick.
 *
 * Each segment advances the faction's reputation to its best horizon and
 * re-ranks, so a faction reappears later if its next tranche is worth returning
 * to — which is exactly the "hit the cap, move on, come back" pattern.
 */
export function planSchedule(factions, baseRepPerSec, o = {}) {
  const maxSegments = o.maxSegments ?? 8
  // Work on a copy: this walks reputation forward hypothetically and must not
  // mutate the caller's view of the world.
  const state = (factions ?? []).map((f) => ({ ...f, augs: [...(f.augs ?? [])] }))
  const segments = []
  let elapsedH = 0

  for (let i = 0; i < maxSegments; i++) {
    // A join wait is a RELEASE TIME, not work. Hacking level and money rise
    // from batching whether or not we grind a faction, so the wait is PASSIVE:
    // working a joined faction during it costs nothing. Charging the wait as
    // if it were exclusive time made "idle 1.5h for BitRunners" outrank
    // "work CyberSec meanwhile" — caught by FP9, the exact wrong plan.
    //
    // So the schedule works like scheduling with release times:
    //   - rank only AVAILABLE factions (joined, or wait already elapsed)
    //   - a work segment is TRUNCATED at the next release, because the
    //     released faction may outrank the remainder of the grind
    //   - only when nothing is workable does a wait get charged as real
    //     time, on the segment of the faction being waited for
    const view = state.map((f) =>
      f.joinWaitHours ? { ...f, joinWaitHours: Math.max(0, f.joinWaitHours - elapsedH) } : f,
    )
    const availables = view.filter((f) => !f.joinWaitHours)
    const locked = view.filter((f) => f.joinWaitHours > 0)
    const releasing = locked.length ? locked.reduce((a, b) => (a.joinWaitHours <= b.joinWaitHours ? a : b)) : null
    const nextRelease = releasing ? releasing.joinWaitHours : null

    const { best } = rankFactions(availables, baseRepPerSec, { ...o, startHours: elapsedH })
    if (best && best.rate > 0) {
      const f = state.find((x) => x.name === best.name)
      if (!f) break
      let hours = best.hours
      let repNeeded = best.repNeeded
      let truncated = false
      // A segment that starts with company work is not truncated: its first
      // phase earns COMPANY rep, not faction rep, and splitting it would need
      // two-currency bookkeeping for a case the 5-minute replanner already
      // handles by re-ranking. The simplification costs at most one segment
      // of ordering, never correctness.
      if (!best.joinWorkHours && nextRelease !== null && nextRelease < hours) {
        // Stop at the release and re-rank: rep earned so far is banked, so a
        // truncated grind loses nothing, and the released faction gets to
        // compete for the very hour it becomes joinable.
        const favor = typeof f.favor === 'number' && isFinite(f.favor) && f.favor >= 0 ? f.favor : 0
        hours = nextRelease
        // Bank what the TRAJECTORY earns in the truncated window, not the
        // snapshot: under a rising rate the constant-rate figure undercredits
        // the pause, and the resumed segment would re-grind rep already held.
        repNeeded =
          typeof o.repAmount === 'function'
            ? (o.repAmount(elapsedH, hours, 1 + favor / 100) ?? baseRepPerSec * (1 + favor / 100) * hours * 3600)
            : baseRepPerSec * (1 + favor / 100) * hours * 3600
        truncated = true
      }
      segments.push({
        faction: best.name,
        startH: elapsedH,
        hours,
        untilRep: f.rep + repNeeded,
        unlocks: truncated ? [] : best.unlocks,
        rate: best.rate,
        ...(truncated ? { pausedForJoin: releasing.name } : {}),
        ...(best.spansInstalls ? { spansInstalls: best.spansInstalls, holdH: best.holdH } : {}),
        // Surfaced so the caller knows this segment BEGINS with employment —
        // "work ECorp the company" is a different instruction from "grind
        // ECorp the faction", and only the caller can act on the difference.
        ...(best.joinWorkHours > 0 ? { workH: best.joinWorkHours } : {}),
      })
      elapsedH += hours
      // Tickets this segment unlocks are spent: later segments do not score them again.
      if (!truncated && o.tickets) {
        for (const u of best.unlocks) if (o.tickets.names.delete(u)) o.tickets.left--
      }
      // Advance this faction to the horizon (or truncation point) we just
      // bought, so the next pass prices the tranche after it.
      f.rep += repNeeded
      if (f.joinWorkHours) f.joinWorkHours = 0
    } else if (locked.length) {
      // Nothing workable: the wait is now genuinely idle, so it is charged as
      // real time to the faction being waited for — visible as joinInH.
      const { best: lb } = rankFactions(locked, baseRepPerSec, { ...o, startHours: elapsedH })
      if (!lb || lb.rate <= 0) break
      const f = state.find((x) => x.name === lb.name)
      if (!f) break
      segments.push({
        faction: lb.name,
        startH: elapsedH,
        hours: lb.hours,
        untilRep: f.rep + lb.repNeeded,
        unlocks: lb.unlocks,
        rate: lb.rate,
        joinInH: lb.joinWaitHours,
        ...(lb.spansInstalls ? { spansInstalls: lb.spansInstalls, holdH: lb.holdH } : {}),
      })
      elapsedH += lb.hours
      f.rep += lb.repNeeded
      f.joinWaitHours = 0
    } else {
      break
    }
  }
  // `current` must be ACTIONABLE. A first segment that is a locked faction
  // ("BitRunners, join in 9h") is a forecast, not an instruction — working it
  // is impossible, and handing it to the caller as `current` would make
  // progress.js try to start work at a faction we are not in. The first
  // segment at a faction JOINED NOW is the one to act on; the locked one stays
  // visible in `segments` and in `nextJoin`.
  //
  // Joined-now means "entered with no join wait", NOT "carries no pause flag".
  // It used to skip every `pausedForJoin` segment, and a truncated grind is
  // exactly the one to work NOW — the pause only says where it ends. Live
  // 2026-09-24 the plan read NiteSec (paused) -> The Black Hand (paused) ->
  // BitRunners, so `current` skipped both and landed on BitRunners, which is
  // released by the pause rather than by a joinInH wait and so carried no flag
  // at all: progress.js ordered work at a faction we had not joined every
  // pass, and the sleeve, handed the same unjoined faction, fell back to
  // studying for 0.2% of the player's exp instead of adding rep.
  // From the INPUT: the walk above zeroes joinWaitHours as joins land.
  const joinedNow = new Set((factions ?? []).filter((f) => !f.joinWaitHours).map((f) => f.name))
  const actionable = segments.find((sg) => !sg.joinInH && joinedNow.has(sg.faction)) ?? null
  // A join shows up two ways: an idle-wait segment (joinInH) or a work segment
  // truncated at the release (pausedForJoin, the join lands as it ends). Both
  // are "a faction opens at hour X", and nextJoin must report whichever comes
  // first — going quiet in the truncation flow made the live schedule read
  // "nextJoin: none" while a pause for BitRunners sat in plain sight above it.
  const idleJoin = segments.find((sg) => sg.joinInH)
  const pausedAt = segments.find((sg) => sg.pausedForJoin)
  const nextJoin =
    idleJoin && (!pausedAt || idleJoin.startH + idleJoin.joinInH <= pausedAt.startH + pausedAt.hours)
      ? { faction: idleJoin.faction, atH: idleJoin.startH + idleJoin.joinInH }
      : pausedAt
        ? { faction: pausedAt.pausedForJoin, atH: pausedAt.startH + pausedAt.hours }
        : null
  return { segments, totalHours: elapsedH, current: actionable, nextJoin }
}

/**
 * The best mutually-compatible set of exclusive factions.
 *
 * Some factions ban each other on joining (FactionHelpers.tsx:44-46 marks every
 * entry in `enemies` as banned), and the city factions are the live case. The
 * stack's previous answer was to refuse ALL of them, on a stated belief that
 * "joining one locks out the other five".
 *
 * THAT BELIEF IS FALSE, and the enemy sets say so:
 *
 *     Sector-12 / Aevum          ban the other four, but NOT each other
 *     Chongqing / New Tokyo / Ishima   ban Sector-12, Aevum, Volhaven — not each other
 *     Volhaven                   bans all five
 *
 * So up to THREE are compatible, and refusing every one of them forfeits real
 * augmentations for a constraint that does not exist as described. Refusing all
 * is never optimal: whatever set we would have ended up with, joining it is at
 * least as good as joining nothing.
 *
 * Exact rather than greedy. The candidate list is small (six cities), so this
 * enumerates every subset and keeps the best feasible one — a greedy pick by
 * individual value can miss a pair that is worth more together than the best
 * single, which is exactly the Sector-12/Aevum case.
 *
 * COMMITTING TO A GROUP IS THE POINT. The choice is made once over the whole
 * candidate set, not invite-by-invite, so an early invitation from a weak group
 * cannot lock us out of a better one that has not arrived yet.
 */
export function bestCompatibleSet(candidates, o = {}) {
  const list = (candidates ?? []).filter((c) => c && typeof c.name === 'string')
  if (!list.length) return { chosen: [], value: 0, rejected: [], considered: 0 }
  if (list.length > (o.maxEnumerate ?? 20)) {
    // Refuse to guess rather than silently switching to a heuristic: an
    // approximate answer here is an irreversible join.
    return { chosen: [], value: 0, rejected: [], considered: list.length, error: 'too many candidates to enumerate exactly' }
  }

  const hostile = (a, b) =>
    (a.enemies ?? []).includes(b.name) || (b.enemies ?? []).includes(a.name)

  // TICKET VALUE, on the set's DISTINCT augs. A city faction's augs are near
  // worthless as multipliers (combat/charisma), so the old multiplier-only
  // value declined them all — correct while the goal was M, wrong once the
  // goal became Daedalus's aug COUNT and the hacking factions ran dry. Each
  // distinct unowned aug a set adds is a ticket toward that count; the union
  // across the set is what matters (two cities selling the same aug is one
  // ticket, not two), and the contribution is capped at the real shortfall
  // so a set is never over-credited for tickets we do not need. ticketValue
  // is 0 unless the caller is genuinely count-short, so early lives never
  // join a combat-aug city for nothing.
  const ticketValue = typeof o.ticketValue === 'number' && isFinite(o.ticketValue) && o.ticketValue > 0 ? o.ticketValue : 0
  const ticketsShort = typeof o.ticketsShort === 'number' && isFinite(o.ticketsShort) && o.ticketsShort > 0 ? o.ticketsShort : 0

  let best = { chosen: [], value: -1 }
  for (let mask = 0; mask < 1 << list.length; mask++) {
    const pick = list.filter((_, i) => mask & (1 << i))
    let ok = true
    for (let i = 0; ok && i < pick.length; i++) {
      for (let j = i + 1; j < pick.length; j++) {
        if (hostile(pick[i], pick[j])) { ok = false; break }
      }
    }
    if (!ok) continue
    let value = pick.reduce((t, c) => t + (typeof c.value === 'number' && isFinite(c.value) ? c.value : 0), 0)
    if (ticketValue > 0 && ticketsShort > 0) {
      const distinct = new Set()
      for (const c of pick) for (const a of c.augs ?? []) distinct.add(a)
      value += ticketValue * Math.min(distinct.size, ticketsShort)
    }
    if (value > best.value) best = { chosen: pick.map((c) => c.name), value }
  }
  return {
    chosen: best.chosen,
    value: Math.max(0, best.value),
    rejected: list.map((c) => c.name).filter((n) => !best.chosen.includes(n)),
    considered: list.length,
  }
}

/**
 * The hold options a schedule offers the install gate.
 *
 * A spanning segment says "this unlock takes N install cycles at the current
 * cadence — OR holdH hours of continuous grinding if installs pause". The
 * schedule prices the cadence; whether pausing is worth it is the GATE's
 * decision, made by its marginal-rate rule over futures. This extracts the
 * candidates: one per spanning segment, each naming the faction, the
 * continuous hours, and the reputation target that many hours would reach —
 * exactly what a future needs to re-plan purchases against.
 *
 * Capped (default 12h) because the rule compares average rates and a
 * pathological many-day hold should not even be offered; deduplicated by
 * faction keeping the SHORTEST hold, since a longer one for the same faction
 * subsumes it only if the gate already accepted the shorter.
 */
export function holdCandidates(segments, o = {}) {
  const maxH = o.maxH ?? 12
  const byFaction = new Map()
  for (const seg of segments ?? []) {
    if (!(seg?.spansInstalls > 0) || !(seg.holdH > 0) || seg.holdH > maxH) continue
    const have = byFaction.get(seg.faction)
    if (!have || seg.holdH < have.holdH) {
      byFaction.set(seg.faction, { faction: seg.faction, holdH: seg.holdH, repTarget: seg.untilRep })
    }
  }
  return [...byFaction.values()].sort((a, b) => a.holdH - b.holdH)
}
