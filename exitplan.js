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
 * THE COVENANT CAMPAIGN (optional `covenant`), placed in the FINAL window —
 * the one window long enough to hold it, since money and combat exp both
 * reset at an install (sleeveplan.js COVENANT). It adds:
 *   - a money leg to max(sleeve price, $75b invite money), then spends the price;
 *   - its combat legs on the WORK SLOT, which the passive legs (hoards, climb)
 *     can overlap but a ground reputation leg cannot: the window is at least
 *     combat + ground-rep hours;
 *   - after the purchase, the new sleeve's exp transfer on the climb.
 * It adds NOTHING to the exit reputation leg: one sleeve per faction
 * (setToFactionWork throws otherwise) and the fleet's best one already works
 * it (fleetFactionRepPerSec is a max). Comparing this against the same policy
 * without it is the in-node price of the sleeve; its use in later nodes
 * (sleevesFromCovenant persists) is not simulated here.
 *
 * THE FLEET'S REPUTATION AS ITS OWN TERM (optional `sleeveRep`
 * {perSec, delayH}): the player grinds at `repPerSec` from the start and the
 * best sleeve adds `perSec` only after `delayH` — the retrain a sleeve
 * augmentation forces (every purchase zeroes the sleeve's exp, and its rep is
 * linear in its skill). With delayH 0 it is exactly repPerSec + perSec, so the
 * with/without comparison of a sleeve purchase runs both trajectories in this
 * one shape.
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
    // The hacking-multiplier gain of the batch ACTUALLY being assembled for
    // the next install, when there is one. Optional; see below.
    nextInstallGain = null,
    // the gates
    exitLevel,
    joinMoney = 0,
    terminalRep = 0,
    donationCost = null,
    favorToDonate = null,
    covenant = null,
    sleeveRep = null,
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
    // THE FIRST INSTALL IS NOT A MEDIAN ONE. multGainPerCycle is the median
    // ratio across recent lives, which predicts a typical future cycle — and is
    // a poor predictor of the one about to happen whenever the catalogue has
    // just changed. Live in BitNode 10 on 2026-09-24, the count gate had just
    // been met, the catalogue opened up to real hacking augmentations, and the
    // plan was a 14-aug batch at M = 22.1 while the median said x1.05. Every
    // install priced at x1.05 left the effective multiplier below 1 after six
    // of them, so the climb to hacking 6000 priced at 2.8e89 hours — while the
    // batch sitting in the plan would have taken it to ~14 in one install.
    //
    // So the first install uses the planned batch's own gain when one is
    // supplied, and the median covers only the installs after it. The planned
    // gain is a LOWER bound for that install: the gate is still letting the
    // batch grow, so what actually installs will be at least this.
    const firstGain = pos(nextInstallGain) && nextInstallGain >= 1 ? nextInstallGain : multGainPerCycle
    mult = hackingMult * firstGain * Math.pow(multGainPerCycle, installsFirst - 1)
    exp = 0
    cash = 1262 // PlayerObjectGeneralMethods.ts:102
    legs.push({ leg: 'install cycles', hours: installsFirst * cycleHours, detail: `${installsFirst} x ${cycleHours.toFixed(2)}h, mult ${hackingMult.toFixed(2)} -> ${mult.toFixed(2)}` })
  }

  // The exp rate can rise mid-window (a Covenant sleeve's transfer), so the
  // legs read this rather than the input.
  let expRate = expPerSec
  const moneyLeg = (target) => hoursToMoney(target, { money0: cash, incomeAtLevel1, mult, exp0: exp, expPerSec: expRate })
  // The final window starts here; `slotH` is what it needs of the work slot.
  const finalStart = h
  let slotH = 0

  if (covenant) {
    if (!pos(covenant.cost) || !num(covenant.combatH) || covenant.combatH < 0) return { hours: null, why: 'covenant campaign unpriced (cost or combat hours)' }
    const target = covenant.member ? covenant.cost : Math.max(covenant.cost, covenant.joinMoney ?? 0)
    if (target > cash) {
      const hm = moneyLeg(target)
      if (!num(hm)) return { hours: null, why: 'could not price the Covenant money leg' }
      h += hm
      exp += pos(expRate) ? expRate * hm * 3600 : 0
      cash = target
      legs.push({ leg: 'covenant money', hours: hm, detail: `$${Math.round(target)} in hand` })
    }
    cash -= covenant.cost
    slotH += covenant.member ? 0 : covenant.combatH
    if (pos(covenant.sleeveExpPerSec)) expRate = (pos(expRate) ? expRate : 0) + covenant.sleeveExpPerSec
  }

  if (joinMoney > cash) {
    const hm = moneyLeg(joinMoney)
    if (!num(hm)) return { hours: null, why: 'could not price the join-money leg' }
    h += hm
    cash = joinMoney
    legs.push({ leg: 'hoard join money', hours: hm, detail: `$${Math.round(joinMoney)} in hand` })
    // The hoard leg also banks exp, which the climb below inherits.
    exp += pos(expRate) ? expRate * hm * 3600 : 0
  }

  if (terminalRep > 0) {
    const fleetOn = sleeveRep && pos(sleeveRep.perSec)
    let r = hoursToRep(terminalRep, { rep0: exitRep, repPerSec: fleetOn ? (pos(repPerSec) ? repPerSec : 0) + sleeveRep.perSec : repPerSec, donationCost, favor: exitFavor, favorToDonate, moneyLeg })
    if (fleetOn && r.how === 'ground') {
      // Piecewise: player alone for delayH, then player + sleeve.
      const P = pos(repPerSec) ? repPerSec : 0
      const S = sleeveRep.perSec
      const D = num(sleeveRep.delayH) && sleeveRep.delayH > 0 ? sleeveRep.delayH : 0
      const need = terminalRep - exitRep
      const t = P > 0 && P * D * 3600 >= need ? need / P / 3600 : (need + S * D * 3600) / (P + S) / 3600
      r = { hours: t, how: 'ground' }
    }
    if (!num(r.hours)) return { hours: null, why: `could not price the reputation leg: ${r.how}` }
    h += r.hours
    if (r.how === 'ground') slotH += r.hours
    legs.push({ leg: 'exit reputation', hours: r.hours, detail: `${Math.round(terminalRep)} rep, ${r.how}` })
    exp += pos(expRate) ? expRate * r.hours * 3600 : 0
  }

  // The final install: skills reset, and the climb runs on the multiplier we
  // froze at. This is the leg the whole install-vs-hold trade turns on.
  const climb = hoursToLevel(exitLevel, mult, 0, expRate)
  if (!num(climb)) return { hours: null, why: 'could not price the final climb' }
  h += climb
  legs.push({ leg: 'climb to exit level', hours: climb, detail: `hacking ${exitLevel} at mult ${mult.toFixed(2)}` })

  // The work slot can bind the window: the passive legs overlap it, a ground
  // reputation leg and the Covenant gym legs do not overlap each other.
  if (slotH > h - finalStart) {
    legs.push({ leg: 'work slot binds', hours: slotH - (h - finalStart), detail: `${slotH.toFixed(1)}h of work slot in a ${(h - finalStart).toFixed(1)}h window` })
    h = finalStart + slotH
  }

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
  const all = ledger.filter((e) => e && e.bitNode === bitNode && pos(e.lifeH) && pos(e.hackMult))
  // COUNT-TICKET INSTALLS ARE NOT MULTIPLIER CYCLES, and must not be measured
  // as if they were.
  //
  // When the Daedalus count gate binds, installgate installs batches of
  // "tickets" — the cheapest distinct augmentations, bought for the count and
  // carrying no hacking multiplier. Each one leaves `hackMult` exactly where it
  // was and lasts ~20 minutes. Live in BitNode 10 on 2026-09-24, five of the
  // last six lives were tickets, so this median read `multGainPerCycle: 1.0`
  // and `cycleHours: 0.33`: "installs never raise the multiplier, and a cycle
  // is twenty minutes".
  //
  // That was not a statistical nuisance, it was a deadlock. bestExitPolicy,
  // told installing cannot grow the multiplier, correctly chose to hold; so
  // bindingGate's multiplier branch never fired and it fell through to the
  // join-money gate, which is `destroyedByInstall` — holding $2.8t to protect
  // a $100b join that hacking 2500 made impossible without installs. Hacking
  // crawled 261 -> 263 in twenty minutes while money piled up.
  //
  // The signature is observable in the ledger alone: the aug count ROSE and
  // the multiplier did NOT. Filtered before the recent window is taken, or a
  // window of six mostly-ticket lives would leave one or two to median. A life
  // missing `augs` is kept — unclassifiable is not the same as a ticket.
  let ticketsExcluded = 0
  const lives = []
  for (let i = 0; i < all.length; i++) {
    const prev = all[i - 1]
    const isTicket =
      prev !== undefined &&
      pos(all[i].augs) &&
      pos(prev.augs) &&
      all[i].augs > prev.augs &&
      Math.abs(all[i].hackMult / prev.hackMult - 1) < 1e-9
    if (isTicket) {
      ticketsExcluded++
      continue
    }
    lives.push(all[i])
  }
  if (lives.length < minN) {
    return {
      cycleHours: null,
      multGainPerCycle: null,
      n: lives.length,
      ticketsExcluded,
      why: `only ${lives.length} multiplier life/lives in this BitNode (need ${minN})${ticketsExcluded ? ` — ${ticketsExcluded} count-ticket install(s) excluded` : ''}`,
    }
  }
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
    ticketsExcluded,
    why: gains.length ? null : 'no usable multiplier ratio between consecutive lives',
  }
}

/**
 * The multiplier the hacking LEVEL curve actually uses: raw x the BitNode's
 * HackingLevelMultiplier (Person.ts:59-62). ns.getPlayer().mults is the raw
 * value, so every level projection must pass through this — see
 * progress.js's effectiveHackingMult for the history (2.86x wrong in BN10).
 * Pure so it can be tested; null rather than the raw value when either input
 * is unreadable.
 */
export function effectiveHackingMultOf(raw, hackingLevelMultiplier) {
  if (!(typeof raw === 'number' && isFinite(raw) && raw > 0)) return null
  const bn = hackingLevelMultiplier
  if (!(typeof bn === 'number' && isFinite(bn) && bn >= 0)) return null
  return raw * bn
}

/**
 * The hacking-multiplier gain of a batch: the product of each augmentation's
 * `mults.hacking` (1 when it has none). Deliberately NOT the plan's `M`, which
 * is channel-WEIGHTED — the moment faction_rep or hacking_exp carries weight,
 * `M` counts value that does not raise the level at all, and a climb priced on
 * it would be optimistic by exactly that amount. null when nothing is readable.
 */
export function batchHackingGain(multsList) {
  if (!Array.isArray(multsList)) return null
  let g = 1
  let read = 0
  for (const m of multsList) {
    if (!m || typeof m !== 'object') continue
    read++
    const h = m.hacking
    if (typeof h === 'number' && isFinite(h) && h > 0) g *= h
  }
  return read ? g : null
}
