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
// A BITNODE CHANGE DOES reset them (`prestigeSourceFile` calls sleeve.prestige()
// on each: exp 0, shock 100, sync = max(memory,1), city Sector-12), with BitNode
// 10 alone capping shock at 25 and flooring sync at 25
// (PlayerObjectGeneralMethods.ts:142-152). The COUNT persists across nodes.
// ---------------------------------------------------------------------------
import { CRIMES, crimeChance, intelligenceBonus, personProblem } from 'bodyplan.js'

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
    const pick = bestSleeveCrime(s, node, objective === 'karma' ? 'karma' : objective === 'money' ? 'money' : 'karma')
    if (!pick) {
      tasks.push(null)
      why.push(`sleeve ${i}: cannot price any crime — refusing to assign one`)
      continue
    }
    tasks.push(pick.crime)
    why.push(`sleeve ${i}: ${pick.crime} at ${(pick.rates.chance * 100).toFixed(0)}% for ${objective}`)
  }
  return { tasks, why, breakevenHours: breakeven, objective, horizonHours }
}
