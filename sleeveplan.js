// WHAT A SLEEVE FLEET IS WORTH, and what each sleeve should be doing.
//
// Until now nothing in this repo modelled sleeves. `gangworth.js` priced the
// karma gate as hours of the PLAYER's work slot; `bodyplan.karmaGrindAcrossCycles`
// integrated the player's crime alone; `sleeve.js` ran a static task list with
// a hardcoded sync -> shock -> homicide fallback. So the fleet's contribution
// to every trajectory was exactly zero, and three of its policy questions were
// answered by a constant rather than priced.
//
// This module is PURE — no ns identifiers, 0GB — so progress.js and sleeve.js
// can both import it.
//
// ---------------------------------------------------------------------------
// THE PHYSICS, cited against ~/Repos/bitburner (v3.0.2, b5b09b8a8).
//
// KARMA. SleeveCrimeWork.ts:44-50 credits the player
//   `Player.karma -= crime.karma * sleeve.syncBonus()`   ONLY ON SUCCESS,
// where syncBonus() = sync/100 (Sleeve.ts:178). This differs from the player's
// own crime in two ways that matter, and bodyplan's crimeRates models the
// PLAYER, so it is the wrong function to point at a sleeve:
//
//   * no quarter-on-failure. CrimeWork.ts:74 does `karma /= 4` on a failure;
//     the sleeve path does not — a failed sleeve crime pays NO karma. The
//     player's failFactor (3c+1)/4 must not be applied here.
//   * no focus penalty. CrimeWork.ts:86 scales by focusBonus; the sleeve path
//     has no such term. A sleeve is never "unfocused".
//
// Kills come with it: `Player.numPeopleKilled += crime.kills`, also success-only,
// which is what pays the Speakers for the Dead gate.
//
// SHOCK DOES NOT TOUCH KARMA. shockBonus() = (100-shock)/100 (Sleeve.ts:174)
// and it is applied in SleeveCrimeWork.getExp — to the EXP gains only. It is
// not in Crime.successRate (Crime.ts:123-136, which reads skills and mults),
// and karma is not scaled by it. So for a karma objective, shock recovery buys
// NOTHING, and the sleeve.js fallback that recovered shock before committing
// Homicide was spending hours per sleeve for no karma at all.
//
// SYNC IS THE WHOLE KARMA MECHANISM and it does not decay. Shock does, passively,
// in Sleeve.process (Sleeve.ts:269-272) whatever the sleeve is doing; sync only
// moves while the sleeve is assigned to Synchronize (SleeveSynchroWork.ts:15-18).
//
// INSTALLS DO NOT RESET SLEEVES. `prestigeAugmentation` never calls
// sleeve.prestige() — it only re-tasks each sleeve to synchronize or shock
// recovery (PlayerObjectGeneralMethods.ts:120). Sleeve exp, skills and sync all
// SURVIVE an install. The player's do not. That is why the fleet term belongs
// in `karmaGrindAcrossCycles` specifically: that function zeroes the player's
// exp at every install boundary, so across a multi-cycle grind the fleet's
// contribution is the STABLE half and the player's is the half that keeps
// starting over.
//
// THE EXP TRANSFER — the largest sleeve term, and NOT YET MODELLED HERE.
//
// applySleeveGains (Sleeve/Work/Work.ts:16-24) does three things with the
// gains of whatever a sleeve is doing:
//
//   applyWorkStatsExp(sleeve, gains, mult)                    the sleeve itself
//   Player.gainMoney(gains.money * mult)                      UNSCALED by sync
//   applyWorkStatsExp(Player, gains, mult * syncBonus)        the PLAYER
//   ...and every OTHER sleeve, at mult * syncBonus * their shockBonus
//
// So a sleeve at a gym trains the player and the whole rest of the fleet at
// sync% of its own rate, and a sleeve at university raises the PLAYER's hacking
// — which feeds the BitNode exit level, the hardest gate in the run. Sync is
// therefore not the karma term this module first treated it as; it is the
// exchange rate on everything a sleeve produces except money.
//
// `sleeveCrimeRates` and `sleevePolicy` below price karma, kills and money ONLY.
// They do not price the exp a sleeve hands the player, so every number they
// produce is a LOWER BOUND on what the sleeve is worth, and the `train` verdict
// is reinforced rather than undermined by the omission: training is exactly the
// activity whose unpriced term is largest. Pricing it properly means valuing
// player exp against the exit trajectory, which belongs with exitplan, not here.
//
// A BITNODE CHANGE DOES reset them (`prestigeSourceFile` calls sleeve.prestige()
// on each: exp 0, shock 100, sync = max(memory,1), city Sector-12), with BitNode
// 10 alone capping shock at 25 and flooring sync at 25
// (PlayerObjectGeneralMethods.ts:142-152). The COUNT persists across nodes.
// ---------------------------------------------------------------------------
import { CRIMES, GYMS, crimeChance, gymRate, intelligenceBonus, personProblem } from 'bodyplan.js'
import { skillFromExp } from 'installgate.js'

const num = (v) => typeof v === 'number' && isFinite(v)

/** SleeveSynchroWork.ts:15-18 — per CYCLE, and there are 5 cycles per second
 *  (CONSTANTS.MilliPerCycle = 200, Sleeve.process:265). The intelligence that
 *  scales it is the PLAYER's, at weight 0.5. */
export const SYNC_PER_CYCLE = 0.0002
/** SleeveRecoveryWork.ts:14-17 — dedicated recovery, scaled by the SLEEVE's
 *  intelligence at weight 0.75. */
export const SHOCK_RECOVERY_PER_CYCLE = 0.0002
/** Sleeve.process:269-272 — shock ALSO falls while the sleeve does anything
 *  else, at half the dedicated rate. Recovery is therefore worth 3x passive,
 *  not infinitely more, and a plan that ignores the passive term overstates
 *  what parking a sleeve on recovery buys. */
export const SHOCK_PASSIVE_PER_CYCLE = 0.0001
export const CYCLES_PER_SEC = 5

/** Sync gained per second of Synchronize, at this player's intelligence. */
export function syncPerSec(playerIntelligence) {
  if (!num(playerIntelligence) || playerIntelligence < 0) return null
  return SYNC_PER_CYCLE * CYCLES_PER_SEC * intelligenceBonus(playerIntelligence, 0.5)
}

/** Shock lost per second — dedicated recovery, and passively while working. */
export function shockPerSec(sleeveIntelligence, recovering) {
  if (!num(sleeveIntelligence) || sleeveIntelligence < 0) return null
  const per = recovering ? SHOCK_RECOVERY_PER_CYCLE + SHOCK_PASSIVE_PER_CYCLE : SHOCK_PASSIVE_PER_CYCLE
  return per * CYCLES_PER_SEC * intelligenceBonus(sleeveIntelligence, 0.75)
}

/**
 * HOW LONG A HORIZON MAKES SYNCHRONIZING WORTH IT.
 *
 * A sleeve at sync `s` delivers karma proportional to `s`. Over a horizon H it
 * delivers `s*H` if it just works. If it synchronises first it delivers
 * nothing for `t = (100-s)/rate` and then `100*(H-t)`. Setting those equal:
 *
 *     s*H = 100*(H - (100-s)/rate)
 *     H*(100-s) = 100*(100-s)/rate
 *     H = 100/rate                              <- the (100-s) cancels
 *
 * So the break-even horizon does NOT depend on the sleeve's current sync: it is
 * one constant per save, ~27.8h at intelligence 0, less as intelligence grows.
 * Above it, synchronise to 100 first; below it, never synchronise at all.
 * Partial synchronising is never right, because both sides are linear in time.
 *
 * This is the number sleeve.js's fallback was implicitly answering with "always
 * sync first, at any horizon".
 */
export function syncBreakevenHours(playerIntelligence) {
  const r = syncPerSec(playerIntelligence)
  if (r === null || r <= 0) return null
  return 100 / r / 3600
}

/**
 * KARMA AND KILLS ONE SLEEVE DELIVERS PER SECOND committing `crime`.
 *
 * Deliberately NOT bodyplan.crimeRates: that function models the player, whose
 * karma survives a failed attempt at a quarter and is scaled by focus. Neither
 * is true of a sleeve (see the header). Using it here would overstate a
 * low-chance sleeve's karma by up to 33%.
 */
export function sleeveCrimeRates(sleeve, node, crime = 'Homicide') {
  const c = typeof crime === 'string' ? CRIMES[crime] : crime
  if (!c) return null
  if (personProblem(sleeve)) return null
  if (!num(sleeve.sync) || sleeve.sync < 0) return null
  const chance = crimeChance(c, sleeve, node)
  if (chance === null) return null
  const perSec = 1000 / c.time
  const syncBonus = sleeve.sync / 100
  return {
    chance,
    karma: c.karma * syncBonus * chance * perSec,
    kills: c.kills * chance * perSec,
    // Money a sleeve earns goes to the player too, scaled by shock
    // (SleeveCrimeWork.getExp -> scaleWorkStats(..., shockBonus)).
    money: c.money * (sleeve.mults?.crime_money ?? 1) * (node?.CrimeMoney ?? 1) * chance * perSec * ((100 - (num(sleeve.shock) ? sleeve.shock : 0)) / 100),
  }
}

/** The crime that maximises `objective` ('karma' | 'kills' | 'money') for this
 *  sleeve at its current stats. Returns `{crime, rates}` or null. */
export function bestSleeveCrime(sleeve, node, objective = 'karma') {
  let best = null
  for (const name of Object.keys(CRIMES)) {
    const r = sleeveCrimeRates(sleeve, node, name)
    if (!r) continue
    const v = r[objective]
    if (!num(v)) continue
    if (v > 0 && (!best || v > best.value)) best = { crime: name, rates: r, value: v }
  }
  return best
}

/**
 * WHAT THE WHOLE FLEET ADDS, as rates the trajectory machinery can integrate.
 *
 * `{ karmaPerSec, killsPerSec, sleeves, contributing, why }`, or `null` when
 * the fleet is UNREADABLE — which is not the same as absent and must not be
 * collapsed into it. A save with no Source-File 10 has a KNOWN fleet of zero
 * and gets `{karmaPerSec: 0, sleeves: 0}`; a save whose /tel/sleeve.txt is
 * missing or stale gets `null`, and every caller is required to say so rather
 * than price the grind as though the sleeves were not there.
 *
 * Sleeves already assigned to something else (sync, shock, study) contribute
 * nothing and are counted in `contributing` so the difference is visible.
 */
export function fleetRates(sleeves, node, o = {}) {
  if (!Array.isArray(sleeves)) return null
  const objective = o.objective ?? 'karma'
  const crime = o.crime ?? null
  let karmaPerSec = 0
  let killsPerSec = 0
  let contributing = 0
  const unreadable = []
  for (const s of sleeves) {
    // An idle or non-crime sleeve is a KNOWN zero, not an unreadable one.
    if (o.onlyAssigned && s?.task !== 'CRIME') continue
    const pick = crime ? { crime, rates: sleeveCrimeRates(s, node, crime) } : bestSleeveCrime(s, node, objective)
    if (!pick || !pick.rates) {
      unreadable.push(s?.index ?? '?')
      continue
    }
    karmaPerSec += pick.rates.karma
    killsPerSec += pick.rates.kills
    contributing++
  }
  // One unreadable sleeve makes the SUM wrong, and a sum that is quietly short
  // by one sleeve is the failure this module exists to stop repeating.
  if (unreadable.length) return null
  return {
    karmaPerSec,
    killsPerSec,
    sleeves: sleeves.length,
    contributing,
    why: sleeves.length
      ? `${contributing} sleeve(s) delivering ${karmaPerSec.toFixed(4)} karma/s and ${killsPerSec.toFixed(4)} kills/s`
      : 'no sleeves — a known zero, not an unmeasured one',
  }
}

/**
 * WHAT EACH SLEEVE SHOULD DO, given the run's objective and how long the run
 * expects to keep caring about it.
 *
 * `o.horizonHours` is what makes this a trajectory decision rather than a
 * snapshot: synchronising is an investment that only repays past
 * syncBreakevenHours, and shock recovery only repays on an objective that
 * shock actually scales. With no horizon supplied this REFUSES to recommend
 * either investment and puts every sleeve straight to work — the choice that
 * cannot waste a horizon it was not told about.
 *
 * Returns `{ tasks: [...], why: [...] }` with one entry per sleeve.
 */
export function sleeveAssignments(sleeves, node, o = {}) {
  if (!Array.isArray(sleeves)) return null
  const objective = o.objective ?? 'karma'
  const horizonHours = num(o.horizonHours) && o.horizonHours > 0 ? o.horizonHours : null
  const breakeven = syncBreakevenHours(o.playerIntelligence)
  const tasks = []
  const why = []
  for (const s of sleeves) {
    const i = s?.index ?? tasks.length
    const sync = num(s?.sync) ? s.sync : null
    if (sync === null) {
      tasks.push(null)
      why.push(`sleeve ${i}: sync unreadable — no assignment, refusing to guess`)
      continue
    }
    // PRECEDENCE, NOT A SEARCH: synchronise outranks training when both are
    // indicated. That is a policy and is called one — sync multiplies
    // everything the sleeve subsequently hands the player (applySleeveGains
    // scales the exp transfer by syncBonus, see the header), so it is the
    // exchange rate the later legs are paid at, and doing it first is the
    // ordering that cannot be wrong by more than the delay. It is NOT proven
    // optimal against the training leg; proving that needs the exp transfer
    // priced, which this module does not yet do.
    if (sync < 100 && horizonHours !== null && breakeven !== null && horizonHours > breakeven) {
      tasks.push('sync')
      why.push(`sleeve ${i}: sync ${sync.toFixed(1)} and ${horizonHours.toFixed(1)}h horizon is past the ${breakeven.toFixed(1)}h break-even — synchronise`)
      continue
    }
    if (sync < 100 && horizonHours === null) {
      why.push(`sleeve ${i}: sync ${sync.toFixed(1)} but no horizon supplied — not investing in synchronise blind`)
    } else if (sync < 100) {
      why.push(`sleeve ${i}: sync ${sync.toFixed(1)}, but a ${horizonHours.toFixed(1)}h horizon is short of the ${breakeven === null ? '?' : breakeven.toFixed(1)}h break-even — work instead`)
    }
    // SHOCK IS NOT A KARMA TERM. It scales exp and money only, so recovering
    // it while the objective is karma buys nothing at all.
    const shock = num(s?.shock) ? s.shock : 0
    if (objective !== 'karma' && shock > 0 && horizonHours !== null && horizonHours > (breakeven ?? Infinity)) {
      tasks.push('shock')
      why.push(`sleeve ${i}: shock ${shock.toFixed(1)} scales the ${objective} this objective wants — recover`)
      continue
    }
    // TRAIN OR WORK — searched, not assumed. A sleeve out of a BitNode change
    // has every skill at 1, where its best money crime pays ~$300/s and its
    // Homicide chance is 0.5%; sending it straight to crime is barely
    // distinguishable from leaving it idle. sleevePolicy prices both and T = 0
    // is in its grid, so "work now" still wins wherever it should.
    const policy = horizonHours === null ? null : sleevePolicy(s, node, { ...o, objective })
    if (policy && policy.task === 'train') {
      // The weighted stat this sleeve is furthest behind on. sleeve.js maps the
      // long skill names to GymType members; the shipped gym branch picked the
      // lowest PLAYER combat skill, which is the wrong body entirely.
      const stat = [...policy.trainStat].sort((a, b) => (s.skills?.[a] ?? 0) - (s.skills?.[b] ?? 0))[0]
      tasks.push(stat)
      why.push(`sleeve ${i}: ${policy.why} — training ${stat} first`)
      continue
    }
    const pick = bestSleeveCrime(s, node, objective === 'karma' ? 'karma' : objective === 'money' ? 'money' : 'karma')
    if (!pick) {
      tasks.push(null)
      why.push(`sleeve ${i}: cannot price any crime — refusing to assign one`)
      continue
    }
    tasks.push(pick.crime)
    why.push(`sleeve ${i}: ${pick.crime} at ${(pick.rates.chance * 100).toFixed(0)}% for ${objective}${policy ? ` — ${policy.why}` : ''}`)
  }
  return { tasks, why, breakevenHours: breakeven, objective, horizonHours }
}

/**
 * TRAIN FIRST, OR WORK NOW?
 *
 * The third constant sleeve.js was answering by hand, and the one that matters
 * most for a fresh fleet. A sleeve out of `prestigeSourceFile` has every skill
 * at 1, so its Homicide chance is 0.5% and its best money crime pays ~$300/s —
 * against a batcher earning millions. Committing it to crime immediately is
 * very nearly the same as leaving it idle, which is what the run was doing.
 *
 * This is a SEARCH, not a rule: for each candidate training time T it prices
 * what the sleeve delivers over the horizon — nothing for T, then the improved
 * rate for what is left — and takes the best T. T = 0 is in the grid, so "work
 * now" wins whenever it should and no threshold has to be guessed.
 *
 * TWO APPROXIMATIONS, both named rather than hidden:
 *
 *   1. Training time is split EVENLY across the stats the chosen crime weights.
 *      Chance is linear in each skill but skill is logarithmic in exp
 *      (skill.ts), so the true optimum spreads rather than piling into the
 *      highest weight — but the exact split is a constrained optimisation this
 *      does not solve. An even split is a lower bound on what training buys, so
 *      the error is in the direction of training too little.
 *   2. The rate after training is held constant for the rest of the horizon,
 *      when in truth the crime keeps training the sleeve further. Also a lower
 *      bound.
 *
 * Both understate training, so a `work` verdict from this function is solid and
 * a `train` verdict is conservative.
 *
 * Returns `{ task, trainStat, trainHours, value, why }`, or null if unreadable.
 */
export function sleevePolicy(sleeve, node, o = {}) {
  const objective = o.objective === 'money' ? 'money' : 'karma'
  const horizonHours = num(o.horizonHours) && o.horizonHours > 0 ? o.horizonHours : null
  if (horizonHours === null) return null
  if (personProblem(sleeve) || !num(sleeve?.sync)) return null
  const trainingMult = num(o.trainingMult) && o.trainingMult > 0 ? o.trainingMult : 1
  const gym = [...GYMS].sort((a, b) => b.expMult - a.expMult)[0]
  // SleeveClassWork.calculateRates and SleeveCrimeWork.getExp both scale gains
  // by shockBonus (Sleeve.ts:174) — exp included, which is why shock is a term
  // here even though it is not one for karma.
  const shockBonus = (100 - (num(sleeve.shock) ? sleeve.shock : 0)) / 100

  const pick = bestSleeveCrime(sleeve, node, objective)
  if (!pick) return null
  const base = { task: pick.crime, trainStat: null, trainHours: 0, value: pick.rates[objective] * horizonHours * 3600 }

  // The stats this crime's success chance actually weights. A stat with no
  // weight is time thrown away.
  const stats = Object.keys(CRIMES[pick.crime].weight).filter((k) => k !== 'hacking' && k !== 'charisma')
  if (!stats.length) return { ...base, why: `${pick.crime} weights no trainable combat stat — work now` }

  let best = base
  const trials = []
  for (let i = 1; i <= 19; i++) {
    const T = (horizonHours * i) / 20
    const trained = { ...sleeve, skills: { ...sleeve.skills }, exp: { ...sleeve.exp } }
    let ok = true
    for (const st of stats) {
      const rate = gymRate(gym, st, sleeve, trainingMult)
      if (rate === null) {
        ok = false
        break
      }
      trained.exp[st] = (trained.exp[st] ?? 0) + rate * shockBonus * ((T * 3600) / stats.length)
      trained.skills[st] = skillFromExp(trained.exp[st], sleeve.mults?.[st] ?? 1)
    }
    if (!ok) break
    const after = sleeveCrimeRates(trained, node, pick.crime)
    if (!after) break
    const value = after[objective] * (horizonHours - T) * 3600
    trials.push({ T, value })
    if (value > best.value) best = { task: 'train', trainStat: stats, trainHours: T, value, after: after.chance, afterRate: after[objective] }
  }
  if (!trials.length) return { ...base, why: `${pick.crime} now — training could not be priced` }
  if (best.task !== 'train') {
    return { ...base, why: `${pick.crime} at ${(pick.rates.chance * 100).toFixed(1)}% now beats every training split over ${horizonHours.toFixed(1)}h` }
  }
  return {
    ...best,
    why:
      `train ${best.trainStat.join('/')} at ${gym.name} for ${best.trainHours.toFixed(1)}h of a ${horizonHours.toFixed(1)}h horizon, ` +
      `then ${pick.crime}: ${(pick.rates.chance * 100).toFixed(1)}% -> ${(best.after * 100).toFixed(1)}% chance, ` +
      `${(best.value / base.value).toFixed(1)}x what working now delivers`,
  }
}

/**
 * UNIVERSITIES — Locations/data/LocationsMetadata.ts. `expMult` is the whole
 * difference between them; ZB is the best in the game and sleeve.js's study
 * branch already travels to Volhaven for it.
 */
export const UNIVERSITIES = [
  { name: 'ZB Institute of Technology', city: 'Volhaven', expMult: 4 },
  { name: 'Summit University', city: 'Aevum', expMult: 3 },
  { name: 'Rothman University', city: 'Sector-12', expMult: 2 },
]

/**
 * CLASSES — Work/ClassWork.tsx:23-60, the per-cycle `earnings` of each. Only
 * the two that matter here: the highest hacking course and the highest
 * charisma one. A gym class has base exp 1, which is why bodyplan's `gymRate`
 * needs no table.
 */
export const CLASSES = {
  Algorithms: { skill: 'hacking', exp: 4, cost: 320 },
  Leadership: { skill: 'charisma', exp: 4, cost: 320 },
}

/**
 * EXP PER SECOND A SLEEVE GAINS from studying `course` at the best university.
 *
 * calculateClassEarnings (Work/Formulas.ts:99-112) scales the class's per-cycle
 * earnings by `location.expMult / gameCPS * hashMult` and multiplies by the
 * person's own multipliers; SleeveClassWork.calculateRates then scales the
 * whole thing by shockBonus. Per SECOND the gameCPS cancels, leaving
 *
 *     exp * expMult * studyMult * mults[skill_exp] * shockBonus
 *
 * — the same shape as bodyplan's gymRate, whose base exp is 1.
 */
export function sleeveStudyExpPerSec(sleeve, course = 'Algorithms', o = {}) {
  const c = CLASSES[course]
  if (!c) return null
  const uni = [...UNIVERSITIES].sort((a, b) => b.expMult - a.expMult)[0]
  const mult = sleeve?.mults?.[`${c.skill}_exp`]
  if (!num(mult) || mult < 0) return null
  const studyMult = num(o.studyMult) && o.studyMult > 0 ? o.studyMult : 1
  const shockBonus = (100 - (num(sleeve?.shock) ? sleeve.shock : 0)) / 100
  return { skill: c.skill, university: uni.name, city: uni.city, perSec: c.exp * uni.expMult * studyMult * mult * shockBonus }
}

/**
 * WHAT THE FLEET HANDS THE PLAYER, per second, in exp.
 *
 * This is the term the header names as the largest and this module did not
 * price. applySleeveGains (Sleeve/Work/Work.ts:16-24) applies the sleeve's
 * gains to the PLAYER scaled by `syncBonus()` — so a sleeve studying
 * Algorithms raises the player's hacking, which is the input to the exit
 * climb, the longest leg in a BitNode.
 *
 * TWO REFUSALS, both real gates rather than defensive noise:
 *
 *   * `disableSleeveExpAndAugmentation` is a BitNode OPTION (readable through
 *     ns.getResetInfo().bitNodeOptions) and processWorkStats zeroes EVERY exp
 *     field for a sleeve when it is set — Work/Formulas.ts:118-129. In such a
 *     save the transfer is a KNOWN zero, not an unknown, and saying which
 *     matters: a zero can be planned around, an unknown cannot.
 *   * an unreadable sleeve returns null for the whole fleet, for the same
 *     reason fleetRates does: a total quietly short by one sleeve is worse
 *     than no total.
 */
export function fleetExpToPlayer(sleeves, o = {}) {
  if (!Array.isArray(sleeves)) return null
  if (o.disableSleeveExp === true) {
    return { hacking: 0, charisma: 0, contributing: 0, why: 'bitNodeOptions.disableSleeveExpAndAugmentation is set — sleeves grant no exp at all in this save (a known zero)' }
  }
  let hacking = 0
  let charisma = 0
  let contributing = 0
  for (const sl of sleeves) {
    if (!num(sl?.sync)) return null
    const study = sleeveStudyExpPerSec(sl, 'Algorithms', o)
    if (!study) return null
    // Only a sleeve actually STUDYING transfers study exp. One committing
    // crime transfers the crime's exp instead, which is a different and much
    // smaller number; counting every sleeve as though it were at university
    // would be the optimistic direction.
    if (o.onlyStudying && sl.task !== 'CLASS') continue
    hacking += study.perSec * (sl.sync / 100)
    contributing++
  }
  return { hacking, charisma, contributing, why: `${contributing} sleeve(s) studying would hand the player ${hacking.toFixed(2)} hacking exp/s` }
}

/**
 * THE HACKING EXP RATE THE EXIT CLIMB RUNS ON, with the fleet in it.
 *
 * ADDITIVE ONLY, and that restriction is the whole function. When the player's
 * own rate is unmeasured this returns it unchanged — null — rather than the
 * fleet's contribution alone: a climb priced on 7.68 exp/s with the player's
 * 316/s missing is not a conservative estimate, it is a different trajectory
 * that happens to be a number, and exitplan's refusal on a null rate was
 * already the correct behaviour. Lives in this module rather than in
 * progress.js so it can be tested without importing an ns-bound file.
 */
export function expPerSecWithFleet(base, fleetHacking) {
  const b = num(base) && base > 0 ? base : null
  if (b === null) return num(base) ? base : null
  const f = num(fleetHacking) && fleetHacking > 0 ? fleetHacking : 0
  return b + f
}
