// Faction favour: the threshold that turns money into reputation. Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY THIS MATTERS MORE THAN IT LOOKS
//
// Below the donation threshold, reputation is TIME-ONLY: you earn it by working
// for a faction and nothing else converts into it. Above the threshold, money
// buys it directly (Faction/formulas/donation.ts:8-10). That is not a
// convenience — it is the difference between two entirely different economies,
// and it is what turned a ten-hour Daedalus grind into a single purchase
// earlier in this project.
//
// It also explains a failure we actually took. On 2026-09-14 an install
// destroyed $6.37b of accumulated cash. The obvious reading was "we were 43
// seconds from affording the next augmentation" — which was WRONG, because the
// binding constraint was reputation (13,231 needed for NeuroFlux 25 against
// 3,089 held), not money. Below the threshold, surplus cash converts into
// exactly nothing, so it piles up until an install deletes it. Pricing that
// cash is pointless; crossing the threshold is the fix.
//
// ---------------------------------------------------------------------------
// HOW FAVOUR WORKS, and the part that is easy to get wrong
//
// Favour is NOT earned continuously. It is granted at an INSTALL, from the
// reputation banked during the life that just ended (Faction/formulas/favor.ts:22):
//
//     newFavor = repToFavor(favorToRep(oldFavor) + reputationThisLife)
//
// So reputation is converted to favour exactly once per install, and reputation
// itself resets. Working a faction for a long time and never installing banks
// favour progress that has not been claimed; installing with little reputation
// wastes the conversion. That coupling is why this module exists next to the
// install gate rather than inside a faction script.
//
// The curve is `favorToRep(f) = 25000 * (e^(k*f) - 1)` with k = log(1.02), so
// reputation required grows exponentially in favour: 150 favour needs ~462,507
// banked reputation, and the last few points cost more than the first hundred.

// Faction/formulas/favor.ts:10 — the nearest representable value of log(1.02),
// deliberately NOT Math.log(1.02), which lacks the precision the game relies on.
const LOG_1_02 = 0.019802627296179712

/** Faction/formulas/favor.ts:8 */
export const MAX_FAVOR = 35331

/** Total reputation ever banked that corresponds to a favour level. */
export const favorToRep = (f) => Math.max(0, 25000 * Math.expm1(LOG_1_02 * f))

/** Favour corresponding to a total banked reputation. */
export const repToFavor = (r) => Math.min(MAX_FAVOR, Math.max(0, Math.log1p(r / 25000) / LOG_1_02))

/**
 * Favour after an install, given current favour and the reputation earned this
 * life. This is the ONLY way favour increases (favor.ts:22).
 */
export const addRepToFavor = (favor, repThisLife) => repToFavor(favorToRep(favor) + Math.max(0, repThisLife))

/**
 * Favour needed before a faction accepts donations.
 *
 * `BaseFavorToDonate` is 150 (Constants.ts:31) scaled by the BitNode's
 * FavorToDonateToFaction. BitNode 4 does not override it, so it is 150 here —
 * but pass the multiplier rather than assuming, because several BitNodes do.
 */
export const favorNeededToDonate = (favorToDonateMult = 1) => Math.floor(150 * favorToDonateMult)

/**
 * Reputation from a donation (donation.ts:8). THREE factors, and the third is
 * the one that gets forgotten: the BitNode's FactionWorkRepGain, which is 0.75
 * in BitNode 4. Omitting it overstates every donation by a third.
 */
export const repFromDonation = (amount, repMult = 1, nodeWorkRepMult = 1) =>
  (amount / 1e6) * repMult * nodeWorkRepMult

/** Money needed to buy a given reputation by donation (donation.ts:12). */
export const donationForRep = (rep, repMult = 1, nodeWorkRepMult = 1) =>
  repMult > 0 && nodeWorkRepMult > 0 ? (rep * 1e6) / repMult / nodeWorkRepMult : Infinity

/**
 * How far a faction is from accepting donations.
 *
 * `repToBank` is reputation that must be earned and then CONVERTED BY AN
 * INSTALL — it is not reputation you can hold and spend. A faction sitting at
 * 149 favour with 400k reputation banked has not crossed anything until the
 * next install happens.
 *
 * Returns `null` for an unreadable faction rather than a shape that reads as
 * "already there" — an unknown must never present as satisfied.
 */
export function donationGap(faction, o = {}) {
  const favorToDonateMult = o.favorToDonateMult ?? 1
  const need = favorNeededToDonate(favorToDonateMult)
  const favor = faction?.favor
  const rep = faction?.rep ?? 0
  if (typeof favor !== 'number' || !isFinite(favor) || favor < 0) return null

  // Favour this faction WOULD have if we installed right now.
  const favorIfInstalled = addRepToFavor(favor, rep)
  const canDonateNow = favor >= need

  return {
    name: faction?.name ?? null,
    favor,
    rep,
    need,
    canDonateNow,
    favorIfInstalled,
    // Reputation still to bank, over and above what is already held, before an
    // install would carry this faction across the threshold.
    repToBank: canDonateNow ? 0 : Math.max(0, favorToRep(need) - favorToRep(favor) - rep),
    crossesOnNextInstall: !canDonateNow && favorIfInstalled >= need,
  }
}

/**
 * Rank joined factions by how close each is to the donation threshold.
 *
 * Closest first, with any that can already donate at the front. Factions whose
 * favour cannot be read are reported separately rather than silently dropped —
 * a missing faction is a gap in the picture, not an absence of one.
 */
export function favorPath(factions, o = {}) {
  const gaps = []
  const unreadable = []
  for (const f of factions ?? []) {
    const g = donationGap(f, o)
    if (g) gaps.push(g)
    else unreadable.push(f?.name ?? '(unnamed)')
  }
  gaps.sort((a, b) => Number(b.canDonateNow) - Number(a.canDonateNow) || a.repToBank - b.repToBank)
  return {
    donating: gaps.filter((g) => g.canDonateNow).map((g) => g.name),
    crossingOnNextInstall: gaps.filter((g) => g.crossesOnNextInstall).map((g) => g.name),
    nearest: gaps[0] ?? null,
    gaps,
    unreadable,
  }
}

/**
 * The permanent reputation uplift from crossing the donation threshold.
 *
 * Below the threshold reputation has exactly one source: working. Above it,
 * money becomes a SECOND source running alongside the first
 * (Faction/formulas/donation.ts:9), so the faction's total reputation rate goes
 *
 *     r_work    = baseRepPerSec * (1 + favor/100)        [reputation.ts:9]
 *     r_donate  = income/1e6 * faction_rep * FactionWorkRepGain
 *     uplift    = 1 + r_donate / r_work
 *
 * EXPRESSED AS A RATIO, DELIBERATELY. The obvious way to value this unlock is
 * "how much reputation does it buy over the rest of the BitNode", which needs a
 * horizon — and every version of the install gate that relied on a horizon
 * shipped a bug. A ratio of two rates needs none, and it is the same shape as
 * the favour rate gain it sits beside.
 *
 * IT IS INCOME-DEPENDENT, which is why it could never be a constant: measured
 * live, the uplift is x1.004 at $30k/s, x1.10 at $750k/s and x1.67 at $5m/s.
 * The unlock is nearly worthless while income is small and dominant once income
 * is large, and that is a real property of the game rather than a modelling
 * artefact.
 *
 * Returns 1 (no uplift) when the faction is already past the threshold — the
 * gain is in CROSSING it, and a faction that has crossed already has it priced
 * into its observed rate — or when any input is unreadable.
 */
export function donationUplift(o = {}) {
  const { favorAfter, baseRepPerSec, incomePerSec, repMult, nodeWorkRepMult } = o
  const need = favorNeededToDonate(o.favorToDonateMult ?? 1)
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  if (!num(favorAfter) || favorAfter < need) return 1
  if (!num(baseRepPerSec) || baseRepPerSec <= 0) return 1
  if (!num(incomePerSec) || !num(repMult) || !num(nodeWorkRepMult)) return 1

  const rWork = baseRepPerSec * (1 + favorAfter / 100)
  if (!(rWork > 0)) return 1
  const rDonate = repFromDonation(incomePerSec, repMult, nodeWorkRepMult)
  const uplift = 1 + rDonate / rWork
  return isFinite(uplift) && uplift >= 1 ? uplift : 1
}

/**
 * Reputation across the install boundary: the LADDER.
 *
 * Faction reputation RESETS at every install (Faction.ts:79) — what survives
 * is favour, converted from the banked rep through addRepToFavor. So a
 * reputation requirement is not "rep / rate hours away"; it is reachable only
 * when the grind fits inside ONE install window, and until then every window
 * is an investment. The gate installs on a measured ~1.7h median cadence,
 * which makes this THE binding constraint on every high-rep augmentation —
 * the schedule used to publish "BitRunners -> 275,000 rep, 21.1h", a segment
 * spanning ~12 installs that could never execute as stated.
 *
 * TWO FORCES SHORTEN EACH SUCCESSIVE WINDOW, and both are needed:
 *
 *   favour     banked_n -> addRepToFavor -> x(1 + f/100) next life
 *   THE MULT   every install compounds the hacking multiplier, and rep gain
 *              is linear in level — measured ~3.4%/install across this run.
 *
 * Favour alone is NOT enough for the big targets, and pretending it is was
 * this function's first bug: fitting 275k rep in a 1.72h window needs favour
 * ~508, which is 5.8e8 banked reputation — never. With measured rate growth
 * compounding at g per cycle the ladder terminates honestly:
 *
 *     rate_n   = baseRepPerSec * g^n * (1 + favor_n / 100)
 *     banked_n = rate_n * windowH * 3600
 *     ...until repReq / rate_n <= windowH, then one final grind.
 *
 * `rateGrowthPerCycle` should be MEASURED (mult ratio across recent installs)
 * and defaults to 1 — the conservative, favour-only ladder — when it is not.
 *
 * THE DONATION TERMINAL — the ladder's TRUE end, when the caller supplies it.
 * At favour `donateAt` (150 in BN4) reputation stops being time and becomes
 * money (donation.ts:8), so the ladder should stop the moment a cycle's
 * favour crosses the threshold AND that cycle's income can cover the
 * donation — not climb on to whatever favour makes the GRIND fit, which
 * overshoots badly: measured live, BitRunners 275k grind-terminates at
 * favour 243 (18 cycles) while favour 150 arrives at cycle 6. Income per
 * cycle compounds by the same measured g; money resets at installs, so each
 * cycle's donation budget is what THAT life earns. The current life also
 * checks donation first when favour is already across, crediting money in
 * hand. `via` says which terminal fired.
 *
 * Returns null on unreadable inputs; `{cycles: Infinity}` when 200 cycles of
 * compounding cannot fit the grind — visible, not silently capped.
 */
export function repLadder(repReq, o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  const { windowH, baseRepPerSec, favor = 0, currentRep = 0, remainingWindowH, hoursNow, rateGrowthPerCycle } = o
  const { donateAt, repMult, nodeWorkRepMult, incomePerSec, money = 0 } = o
  if (!num(repReq) || !num(windowH) || windowH <= 0 || !num(baseRepPerSec) || baseRepPerSec <= 0 || !num(favor)) return null
  const g = num(rateGrowthPerCycle) && rateGrowthPerCycle >= 1 ? rateGrowthPerCycle : 1
  // The donation terminal arms only when EVERYTHING it needs is readable —
  // a half-specified donation model must degrade to the grind ladder, not
  // guess at dollar conversion rates.
  const canDonate = num(donateAt) && donateAt > 0 && num(repMult) && repMult > 0 && num(nodeWorkRepMult) && nodeWorkRepMult > 0 && num(incomePerSec) && incomePerSec > 0

  // This life first: the caller supplies its trajectory-priced hours for the
  // remaining requirement (hoursNow), and how much of this life's window is
  // left. Fits -> no ladder at all. When favour is already across the
  // threshold, donating is a second way to fit — money in hand counts, and
  // the cheaper of the two strategies wins.
  const remaining = num(remainingWindowH) ? remainingWindowH : windowH
  const needNow = Math.max(0, repReq - (num(currentRep) ? currentRep : 0))
  if (needNow === 0) return { reachableNow: true, cycles: 0, totalHours: 0, finalGrindH: 0, favorAtUnlock: favor, via: 'grind' }
  const grindNowH = num(hoursNow) ? hoursNow : needNow / (baseRepPerSec * (1 + favor / 100)) / 3600
  let nowH = grindNowH
  let nowVia = 'grind'
  let nowDollars = 0
  if (canDonate && favor >= donateAt) {
    const dollars = donationForRep(needNow, repMult, nodeWorkRepMult)
    const donateH = Math.max(0, dollars - (num(money) ? money : 0)) / incomePerSec / 3600
    if (donateH < nowH) {
      nowH = donateH
      nowVia = 'donation'
      nowDollars = dollars
    }
  }
  if (nowH <= remaining) {
    return { reachableNow: true, cycles: 0, totalHours: nowH, finalGrindH: nowH, favorAtUnlock: favor, via: nowVia, ...(nowVia === 'donation' ? { donationDollars: nowDollars } : {}) }
  }

  // The ladder. Cycle 1 banks what this life still can (its rep so far plus
  // the rest of its window); later cycles bank a full window each, at rates
  // lifted by both compounding forces. Each cycle checks BOTH terminals and
  // takes the cheaper: money resets at installs, so a donation cycle spends
  // only what that life's (compounded) income earns.
  let f = favor
  let banked = (num(currentRep) ? currentRep : 0) + baseRepPerSec * (1 + f / 100) * remaining * 3600
  let hours = remaining
  for (let n = 1; n <= 200; n++) {
    f = addRepToFavor(f, banked)
    const rate = baseRepPerSec * Math.pow(g, n) * (1 + f / 100)
    const grindH = repReq / rate / 3600
    let finalH = grindH
    let via = 'grind'
    let dollars = 0
    if (canDonate && f >= donateAt) {
      dollars = donationForRep(repReq, repMult, nodeWorkRepMult)
      const donateH = dollars / (incomePerSec * Math.pow(g, n)) / 3600
      if (donateH < finalH) {
        finalH = donateH
        via = 'donation'
      }
    }
    if (finalH <= windowH) {
      return {
        reachableNow: false,
        cycles: n,
        totalHours: hours + finalH,
        finalGrindH: finalH,
        favorAtUnlock: f,
        via,
        ...(via === 'donation' ? { donationDollars: dollars } : {}),
      }
    }
    banked = rate * windowH * 3600
    hours += windowH
  }
  return { reachableNow: false, cycles: Infinity, totalHours: Infinity, finalGrindH: Infinity, favorAtUnlock: f, via: 'none' }
}

/**
 * How many NeuroFlux levels a donation budget buys, at escalating rep prices.
 *
 * THE CROSSING'S CASH VALUE. Crossing 150 favour at ANY faction opens
 * money->NFG, because every faction sells NeuroFlux — and this converts a
 * dollar budget into the level count that budget actually reaches, with the
 * rep requirement escalating 1.14x per level (AugmentationHelpers.ts:133-138)
 * and each level's reputation bought at donation.ts:8 prices. The AUG price
 * itself is deliberately excluded: it is paid from the same pocket but scales
 * with 1.9^queued, which belongs to augplan's ordering problem, so this is an
 * upper bound on levels per budget and the caller values conservatively
 * elsewhere (one install's worth, though the unlock recurs).
 */
export function nfgLevelsByDonation(budget, nfgRepReq, repMult = 1, nodeWorkRepMult = 1, levelMult = 1.14) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  if (!num(budget) || !num(nfgRepReq) || !num(repMult) || !num(nodeWorkRepMult) || !num(levelMult)) return 0
  let levels = 0
  let rep = nfgRepReq
  let left = budget
  for (let i = 0; i < 100; i++) {
    const cost = donationForRep(rep, repMult, nodeWorkRepMult)
    if (cost > left) break
    left -= cost
    rep *= levelMult
    levels++
  }
  return levels
}

/**
 * The banked reputation still needed before the NEXT install crosses the
 * donation threshold. Additive in rep-space (favor.ts's curve converts total
 * banked rep, so splitting the grind across installs loses NOTHING — which is
 * why the crossing must NOT be priced through the install-window ladder).
 * Null when favour is unreadable; 0 when already across.
 */
export function repToCross(favor, o = {}) {
  if (typeof favor !== 'number' || !isFinite(favor) || favor < 0) return null
  const need = favorNeededToDonate(o.favorToDonateMult ?? 1)
  if (favor >= need) return 0
  return favorToRep(need) - favorToRep(favor)
}
