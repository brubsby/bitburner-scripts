// TIME TO THE DOOR, simulated — not a threshold ladder.
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES, AND WHY A THRESHOLD WAS NOT ENOUGH
// ---------------------------------------------------------------------------
//
// objective.bindingGate decides whether installing is allowed by walking a
// LEXICOGRAPHIC ladder, and its first rung short-circuits every other:
//
//     if (!ctx.exitLevelReached) return { gate: 'multiplier', ... }
//
// with `exitLevelReached` meaning "hacking >= exitLevel RIGHT NOW". Hacking
// resets to 1 at every install, so that rung is true immediately after each
// one and the money gate below it is never consulted. The ladder therefore
// never compares the two things a run actually has to trade off:
//
//     install now   faster income and a bigger multiplier, but money resets
//                   to $1262 and faction reputation and membership to zero
//     hold          keep the cash, but finish the run on today's multiplier
//
// Measured live in BitNode 5 at hacking 4051/4500, mult 9.25, $8.85b, income
// $39m/s, median life 0.625h: holding costs 3.68h and installing once more
// costs 1.22h — a 3x difference the ladder had no way to see. It reached the
// right answer anyway, by a threshold that happened to correlate.
//
// The correlation is not safe. The whole swing is the climb back to the exit
// level AFTER The Red Pill install resets skills, and that is exponential in
// exitLevel/mult:
//
//     mult  9.25 -> hacking 4500 in 3.03h
//     mult 12.40 -> hacking 4500 in 0.06h
//
// So the moment hacking crosses the exit level the ladder flips to the money
// gate and freezes the multiplier — immediately before the one leg where the
// multiplier is worth hours. The flag tests the wrong hacking level: the
// current one, not the post-install one.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES INSTEAD
// ---------------------------------------------------------------------------
//
// Simulate the remaining run end to end under each candidate policy — "install
// k more times, then hoard" for k = 0, 1, 2, ... — and return the k with the
// shortest total. Every leg is priced from a MEASURED rate, and the module
// refuses rather than guessing when one is missing.
//
// Pure: no ns surface, so importing it costs nothing and it runs under plain
// node for testing.

/** level from exp and multiplier — PersonObjects/formulas/skill.ts:13 */
export const levelAt = (exp, mult) => Math.max(1, Math.floor(mult * (32 * Math.log(Math.max(0, exp) + 534.6) - 200)))

/** exp needed for a level at a multiplier — skill.ts:19 inverted */
export const expForLevel = (level, mult) => Math.exp((level / mult + 200) / 32) - 534.6

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

/**
 * Hours to climb from `exp0` to `level`, at a measured exp rate.
 *
 * Returns 0 when already there, Infinity when the rate is zero and the level
 * is not reached — Infinity is a real answer here ("never at this rate"),
 * distinct from the null this module uses for "could not tell".
 */
export function hoursToLevel(level, mult, exp0, expPerSec) {
  if (!pos(mult) || !num(exp0) || exp0 < 0) return null
  const need = expForLevel(level, mult)
  if (need <= exp0) return 0
  if (!pos(expPerSec)) return Infinity
  return (need - exp0) / expPerSec / 3600
}

/**
 * Hours to accumulate `target` money from `money0`, with income RISING as the
 * hacking level rises.
 *
 * Income scales with (level + 50) — the same shape trajectory.js's incomeModel
 * uses — so a post-install state that starts at level 1 earns almost nothing
 * and accelerates. Modelling that matters: the flat rate overstates the
 * opening of every life by the whole rebuild.
 *
 * Integrated numerically rather than in closed form because the level is
 * itself a log of accumulating exp; the step is small against the multi-hour
 * scale of the answer and the cost is irrelevant offline.
 */
export function hoursToMoney(target, o = {}) {
  const { money0 = 0, incomeAtLevel1, mult, exp0 = 0, expPerSec, maxHours = 1e4, stepH = 1 / 120 } = o
  if (!num(target) || target <= money0) return 0
  if (!pos(incomeAtLevel1) || !pos(mult) || !num(exp0)) return null
  let money = money0
  let exp = Math.max(0, exp0)
  let h = 0
  while (h < maxHours) {
    const lvl = levelAt(exp, mult)
    // income(level) = incomeAtLevel1 * (level + 50) / 51
    const rate = (incomeAtLevel1 * (lvl + 50)) / 51
    money += rate * stepH * 3600
    exp += pos(expPerSec) ? expPerSec * stepH * 3600 : 0
    h += stepH
    if (money >= target) return h
  }
  return Infinity
}

/**
 * Hours to bank `target` reputation, or to buy it outright past the donation
 * threshold.
 *
 * Donations are not a shortcut to be assumed: they need favor >= 150
 * (donation.ts:17) and the money still has to be earned, so the caller passes
 * the donation cost and this prices it as a money leg like any other.
 */
export function hoursToRep(target, o = {}) {
  // favorToDonate has NO DEFAULT on purpose. The threshold is
  // 150 * currentNodeMults.FavorToDonateToFaction (Faction/formulas/donation.ts:17),
  // and this module is pure — it cannot read node multipliers. Baking 150 in
  // would be right in BitNode 1 and silently wrong everywhere else, which is
  // the failure [C5] exists to catch (and did catch, on this very line).
  // Absent, the donation route is simply not offered and the reputation is
  // ground instead: slower, never wrong.
  const { rep0 = 0, repPerSec, donationCost = null, favor = 0, favorToDonate = null, moneyLeg = null } = o
  if (!num(target) || target <= rep0) return { hours: 0, how: 'already held' }
  if (pos(favorToDonate) && favor >= favorToDonate && pos(donationCost) && typeof moneyLeg === 'function') {
    const h = moneyLeg(donationCost)
    if (num(h)) return { hours: h, how: `donated $${Math.round(donationCost)}` }
  }
  if (!pos(repPerSec)) return { hours: null, how: 'no measured reputation rate' }
  return { hours: (target - rep0) / repPerSec / 3600, how: 'ground' }
}

/**
 * Total hours to the exit under "install `installsFirst` more times, then
 * stop installing and finish".
 *
 * THE LEGS, in the order the game forces them:
 *   1. k install cycles          k x measured life length; mult x g^k
 *   2. hoard to the join money   from $1262, on the post-install trajectory
 *   3. reputation for the exit   ground, or donated past 150 favor
 *   4. the final install         skills reset to 1
 *   5. climb to the exit level   exponential in exitLevel/mult — the leg the
 *                                whole trade is really about
 *
 * Returns { hours, legs, mult } or { hours: null, why } — never a guess.
 */
export function exitHours(o = {}) {
  const {
    installsFirst = 0,
    // measured state
    money = 0,
    incomePerSec,
    hacking,
    hackingExp = 0,
    hackingMult,
    expPerSec,
    repPerSec,
    exitRep = 0,
    exitFavor = 0,
    // measured per-cycle behaviour, from the lifetimes ledger
    cycleHours,
    multGainPerCycle,
    // the gates
    exitLevel,
    joinMoney = 0,
    terminalRep = 0,
    donationCost = null,
    favorToDonate = null,
  } = o

  if (!pos(incomePerSec) || !pos(hacking) || !pos(hackingMult) || !pos(exitLevel)) {
    return { hours: null, why: 'live state unreadable (income, hacking, multiplier or exit level)' }
  }
  if (!num(installsFirst) || installsFirst < 0) return { hours: null, why: 'installsFirst must be >= 0' }
  if (installsFirst > 0 && (!pos(cycleHours) || !pos(multGainPerCycle))) {
    return { hours: null, why: 'no measured cycle length or per-cycle multiplier gain — cannot price an install' }
  }

  // Income at level 1 for THIS fleet, derived from the live pair. Everything
  // downstream of an install starts here, which is what makes the rebuild
  // visible instead of assumed away.
  const incomeAtLevel1 = (incomePerSec * 51) / (hacking + 50)

  const legs = []
  let h = 0
  let mult = hackingMult
  let exp = hackingExp
  let cash = money

  if (installsFirst > 0) {
    h += installsFirst * cycleHours
    mult = hackingMult * Math.pow(multGainPerCycle, installsFirst)
    exp = 0
    cash = 1262 // PlayerObjectGeneralMethods.ts:102
    legs.push({ leg: 'install cycles', hours: installsFirst * cycleHours, detail: `${installsFirst} x ${cycleHours.toFixed(2)}h, mult ${hackingMult.toFixed(2)} -> ${mult.toFixed(2)}` })
  }

  const moneyLeg = (target) => hoursToMoney(target, { money0: cash, incomeAtLevel1, mult, exp0: exp, expPerSec })

  if (joinMoney > cash) {
    const hm = moneyLeg(joinMoney)
    if (!num(hm)) return { hours: null, why: 'could not price the join-money leg' }
    h += hm
    legs.push({ leg: 'hoard join money', hours: hm, detail: `$${Math.round(joinMoney)} in hand` })
    // The hoard leg also banks exp, which the climb below inherits.
    exp += pos(expPerSec) ? expPerSec * hm * 3600 : 0
  }

  if (terminalRep > 0) {
    const r = hoursToRep(terminalRep, { rep0: exitRep, repPerSec, donationCost, favor: exitFavor, favorToDonate, moneyLeg })
    if (!num(r.hours)) return { hours: null, why: `could not price the reputation leg: ${r.how}` }
    h += r.hours
    legs.push({ leg: 'exit reputation', hours: r.hours, detail: `${Math.round(terminalRep)} rep, ${r.how}` })
    exp += pos(expPerSec) ? expPerSec * r.hours * 3600 : 0
  }

  // The final install: skills reset, and the climb runs on the multiplier we
  // froze at. This is the leg the whole install-vs-hold trade turns on.
  const climb = hoursToLevel(exitLevel, mult, 0, expPerSec)
  if (!num(climb)) return { hours: null, why: 'could not price the final climb' }
  h += climb
  legs.push({ leg: 'climb to exit level', hours: climb, detail: `hacking ${exitLevel} at mult ${mult.toFixed(2)}` })

  return { hours: h, legs, mult }
}

/**
 * The optimisation: try every policy and return the best.
 *
 * `maxInstalls` bounds the search, and the bound is REPORTED — a silently
 * truncated search reads as "this is the optimum" when it may only be the edge
 * of where we looked (CLAUDE.md: no silent caps).
 */
export function bestExitPolicy(o = {}, maxInstalls = 6) {
  const tried = []
  let best = null
  for (let k = 0; k <= maxInstalls; k++) {
    const r = exitHours({ ...o, installsFirst: k })
    tried.push({ installsFirst: k, hours: r.hours, why: r.why ?? null })
    if (num(r.hours) && (best === null || r.hours < best.hours)) best = { ...r, installsFirst: k }
  }
  if (!best) return { best: null, tried, why: tried[0]?.why ?? 'no policy could be priced' }
  return {
    best,
    tried,
    atSearchEdge: best.installsFirst === maxInstalls,
    searchedTo: maxInstalls,
  }
}

/**
 * What an install cycle actually costs and buys, measured from the lifetimes
 * ledger rather than assumed.
 *
 * Both numbers are medians over recent lives IN THIS BITNODE, because early
 * lives of a node are not representative — BN5's first life ran 21.59h against
 * a recent median of 0.625h, and a mean would let that one distort every
 * decision after it. `multGainPerCycle` is the median ratio between successive
 * `hackMult` values, which is the only honest way to say "what does one more
 * install buy" when the answer changes as the catalogue empties.
 *
 * Refuses (null) below `minN` lives: with one sample there is no ratio, and
 * inventing one would price an install we have never actually observed.
 */
export function cycleStats(ledger, bitNode, { minN = 3, recent = 6 } = {}) {
  if (!Array.isArray(ledger)) return null
  const lives = ledger.filter((e) => e && e.bitNode === bitNode && pos(e.lifeH) && pos(e.hackMult))
  if (lives.length < minN) return { cycleHours: null, multGainPerCycle: null, n: lives.length, why: `only ${lives.length} completed life/lives in this BitNode (need ${minN})` }
  const tail = lives.slice(-recent)
  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const gains = []
  for (let i = 1; i < tail.length; i++) {
    const g = tail[i].hackMult / tail[i - 1].hackMult
    if (pos(g) && g >= 1) gains.push(g)
  }
  return {
    cycleHours: med(tail.map((e) => e.lifeH)),
    multGainPerCycle: gains.length ? med(gains) : null,
    n: tail.length,
    why: gains.length ? null : 'no usable multiplier ratio between consecutive lives',
  }
}
