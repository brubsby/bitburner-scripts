// Who gets the money. Pure, no ns calls, free to import.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Five scripts spend money and none of them knew about the others. Their
// reserves were hardcoded, scattered, and in one case contradictory:
//
//   buyserv.js   $5e6 own constant, plus a persisted one
//   homeup.js    0 in the file, 2e12 in the watchdog's args
//   nfg.js       $5e12 own constant, $5e11 in the watchdog's args   <- 10x apart
//   progress.js  spends whatever is left when it plans augmentations
//
// The effects were not theoretical. buyserv.js spent every surplus dollar every
// 15 seconds, which pinned the balance a thousandfold below homeup.js's trigger
// for an entire life — so home, the one purchase that SURVIVES an install, was
// never upgraded while 77% of gross income went into cloud servers that the
// next install deleted.
//
// ---------------------------------------------------------------------------
// THE MODEL
//
// The run is multiplier-bound: skill level is `mult * (32*ln(exp+534.6) - 200)`
// (PersonObjects/formulas/skill.ts:13), linear in the multiplier and only
// logarithmic in experience, and leaving BitNode 4 needs hacking 9000. So every
// purchase is valued by how much sooner it reaches that, and the ordering falls
// out of WHAT SURVIVES:
//
//   augmentations    survive installs. They ARE the multiplier. First claim.
//   home RAM/cores   survive installs (Prestige.ts leaves them alone; only a
//                    BitNode change resets them). Income for the rest of the node.
//   cloud servers    DESTROYED by every install (ServerHelpers.ts:226-239).
//                    Worth only the income they earn before the next one.
//   money itself     destroyed by every install — $1262 afterwards. Holding
//                    cash through an install is a pure loss.
//
// So the priority is not a preference, it is the survival order. A dollar spent
// on an augmentation is banked permanently; the same dollar in a purchased
// server is a lease that expires at the next install, which the install gate is
// actively trying to bring forward.
//
// ---------------------------------------------------------------------------
// HOW IT IS USED
//
// Each spender imports this and computes its OWN reserve from shared inputs.
// There is deliberately no coordinating daemon and no lock: the claims are a
// pure function of published state, so every script computes the same answer
// without talking to any other. A spender that cannot read a claim treats it as
// UNKNOWN and holds back — never as zero, which would let it spend money that
// is already promised.

/** Spend priority, highest first. The order is the survival order, not taste. */
export const PRIORITY = ['join', 'augmentations', 'home', 'servers', 'neuroflux', 'hacknet', 'gang']

/**
 * The spenders that publish a COST, and so can be held back for.
 *
 * Not every spender is a claimant. `augmentations` has a planned total from
 * augplan.js and `home` has an exact next-upgrade price from homecost.js — both
 * are specific sums somebody is about to need. `servers` and `neuroflux` spend
 * opportunistically against whatever is left; there is no figure to reserve.
 *
 * Summing over PRIORITY instead of this list made every lower spender wait on a
 * `servers` claim that by construction never exists, so neuroflux could never
 * spend at all. Caught by BU1 rather than in the live game.
 */
export const CLAIMANTS = ['join', 'augmentations', 'home']

/**
 * How much a spender must leave untouched.
 *
 * @param {string} spender  one of PRIORITY.
 * @param {object} claims   what the higher-priority spenders currently want:
 *                          `{ augmentations, home }` in dollars. A claim of
 *                          `null`/`undefined` means UNREADABLE, and is treated
 *                          as `fallback` rather than 0 — see below.
 * @param {object} [o]
 * @param {number} [o.fallback] what an unreadable claim is worth. Defaults to
 *                          Infinity, i.e. "if you cannot tell what is promised,
 *                          do not spend". Callers that must make progress
 *                          anyway can pass a finite figure, but they are then
 *                          choosing to guess and should say so.
 */
export function reserveFor(spender, claims = {}, o = {}) {
  const fallback = o.fallback ?? Infinity
  const rank = PRIORITY.indexOf(spender)
  if (rank < 0) return fallback

  let held = 0
  for (const key of CLAIMANTS) {
    if (PRIORITY.indexOf(key) >= rank) continue
    let v = claims[key]

    // ------------------------------------------------------------------
    // THE PAYBACK EXCEPTION — the one condition under which a lower-priority
    // spender may spend through the HOME claim, and why it is not a hole in
    // the safety property this file exists for.
    //
    // PRIORITY is survival order: home outranks servers because home survives
    // installs and cloud servers do not. That was the right order when home
    // cost ~$50k/GB — but home's price DOUBLES with size while fleet RAM does
    // not, and by the 4TB tier home costs ~$15.5M/GB against fleet's ~$0.2M/GB.
    // Measured live on 2026-09-15: the full hold funnelled every dollar into
    // a $31.7b permanent 2TB while 65x-cheaper fleet RAM — which would have
    // compounded income into that same purchase SOONER — bought nothing.
    //
    // The marginal economics, per dollar diverted from the home fund to fleet:
    //   gain: 1/fleetDollarPerGB gigabytes, alive for ~horizonSec (the fleet
    //         dies at the next install; half a window is the honest average)
    //   cost: the home block arrives 1/incomePerSec later, so its deltaGB is
    //         absent for that long
    // Fleet wins while
    //   fleetDollarPerGB  <  incomePerSec * horizonSec / deltaGB
    // and the comparison SELF-LIMITS: CloudServerSoftcap raises the fleet's
    // marginal $/GB as it grows, so spending stops at the economic knee
    // rather than at zero.
    //
    // MECHANISM AND SAFETY. The home claim may be published as
    // {amount, deltaGB}; the caller supplies opts.payback =
    // {fleetDollarPerGB, incomePerSec, horizonSec}, all MEASURED. The claim
    // is waived only when every input is readable, positive, and the
    // inequality holds. A plain-number home claim (the legacy shape), a cores
    // upgrade (deltaGB absent — not RAM-comparable), or ANY unreadable input
    // keeps the full hold: the exception must fail closed, or it is the
    // `?? 0` bug with a longer justification. BU8 reintroduces each failure
    // shape and watches the hold come back.
    // ------------------------------------------------------------------
    if (key === 'home' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const amt = v.amount
      if (typeof amt !== 'number' || !isFinite(amt) || amt < 0) return fallback
      const d = v.deltaGB
      const pb = o.payback
      const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
      if (num(d) && pb && num(pb.fleetDollarPerGB) && num(pb.incomePerSec) && num(pb.horizonSec) && pb.fleetDollarPerGB < (pb.incomePerSec * pb.horizonSec) / d) {
        continue // fleet spending through this hold BUYS the upgrade sooner
      }
      // THE MONEY-RETURN FORM of the same exception, for a spend that pays
      // DOLLARS back (hacknet.js): if the purchase returns more than it
      // costs before the horizon, the home fund is ahead by the horizon,
      // not behind — holding it would only delay the very block it protects.
      // Same fail-closed shape: every input measured and positive, and the
      // inequality strict, or the full hold stands. BU9 pins it.
      const mr = pb?.moneyReturn
      if (mr && num(mr.cost) && num(mr.gainPerSec) && num(mr.horizonSec) && mr.gainPerSec * mr.horizonSec > mr.cost) {
        continue
      }
      // THE ln(M) FORM for home (the competition below): the planner prices
      // the next home upgrade in ln per dollar (objective.homeLn, published
      // as homeLnPerDollar) and a spend that buys strictly more ln per
      // dollar goes through. No figure -> the hold stands.
      const lc = o.lnCompete
      if (lc) {
        const own = typeof lc.lnPerDollar === 'number' && !Number.isNaN(lc.lnPerDollar) && lc.lnPerDollar > 0
        const rival = lc.rivals?.home
        if (own && typeof rival === 'number' && isFinite(rival) && rival >= 0 && lc.lnPerDollar > rival) continue
      }
      v = amt
    }

    // ------------------------------------------------------------------
    // THE ln(M) COMPETITION — the join and augmentation claims may be spent
    // through by a purchase that buys MORE ln(M) per dollar than the claim
    // it displaces. Both sides are priced by the same objective:
    //   augmentations: the plan's least valuable item, ln(m)/price — the
    //                  item a diverted dollar actually drops.
    //   join:          the exit faction's value (catalogue ln + TERMINAL_LN)
    //                  over its money requirement — saving from income, a
    //                  dollar spent delays the join by 1/income, i.e. by
    //                  1/requirement of the whole saving time, so the linear
    //                  cost per dollar is value/requirement exactly.
    // The caller supplies opts.lnCompete = {lnPerDollar, rivals: {augmentations,
    // join}} — its own ln per dollar (measured by trajectory: value with the
    // spend minus value without, over cost) and each rival's. A claim is
    // waived only when its rival figure is readable and STRICTLY below the
    // spender's; unreadable rivals keep the hold. The HOME claim competes
    // through its own branch above, on objective.homeLn's figure. BU13
    // pins every shape.
    // ------------------------------------------------------------------
    if ((key === 'join' || key === 'augmentations') && o.lnCompete) {
      const lc = o.lnCompete
      const fin = (x) => typeof x === 'number' && isFinite(x)
      // The spender's figure may be Infinity — "what could I contest at
      // all?" (gang.js asks that to size its search) — a rival's may not.
      const own = typeof lc.lnPerDollar === 'number' && !Number.isNaN(lc.lnPerDollar) && lc.lnPerDollar > 0
      const rival = lc.rivals?.[key]
      if (own && fin(rival) && rival >= 0 && lc.lnPerDollar > rival) continue
    }

    // A claim nobody could read is not a claim of zero. This is the direction
    // that matters: treating "unknown" as "nothing is promised" is how a
    // low-priority spender empties an account the high-priority one was about
    // to use, which is precisely what happened to homeup.js.
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return fallback
    held += v
  }
  return held
}

/**
 * The rivals' ln(M) per dollar for the competition above, from the gate
 * file: {augmentations, join}, each null when unreadable (a null rival keeps
 * its claim). Stale-life files read as unreadable, like augClaim.
 */
export function marginalLnPerDollar(text, lastAugReset) {
  const out = { augmentations: null, join: null, home: null }
  if (!text) return out
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return out
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out
  if (typeof lastAugReset === 'number' && d.lastAugReset !== lastAugReset) return out
  const fin = (x) => typeof x === 'number' && isFinite(x)
  // Augmentations: the plan's least ln per dollar; an explicit empty plan
  // means nothing is displaced -> 0 (any positive spend beats it).
  if (d.plan === null || d.plan === undefined) {
    if (d.planned === false) out.augmentations = 0
  } else if (Array.isArray(d.plan.buy)) {
    let least = null
    for (const it of d.plan.buy) {
      if (!fin(it?.price) || it.price <= 0 || !fin(it?.m) || it.m <= 0) {
        least = null
        break
      }
      const lpd = Math.log(it.m) / it.price
      if (least === null || lpd < least) least = lpd
    }
    out.augmentations = d.plan.buy.length === 0 ? 0 : least
  }
  // Join: value over requirement; a zero claim displaces nothing.
  if (fin(d.joinClaim)) {
    if (d.joinClaim === 0) out.join = 0
    else if (fin(d.joinValueLn) && d.joinValueLn >= 0) out.join = d.joinValueLn / d.joinClaim
  }
  // Home: the planner's figure, as published.
  if (fin(d.homeLnPerDollar) && d.homeLnPerDollar >= 0) out.home = d.homeLnPerDollar
  return out
}

/** What is actually spendable by this spender right now. Never negative. */
export function spendable(spender, money, claims = {}, o = {}) {
  if (typeof money !== 'number' || !isFinite(money) || money <= 0) return 0
  const reserve = reserveFor(spender, claims, o)
  return isFinite(reserve) ? Math.max(0, money - reserve) : 0
}

/**
 * The augmentation claim, from what the planner published.
 *
 * Returns a NUMBER when the claim is known — including **0**, which is a real
 * answer meaning "there is nothing queued and nothing planned" — and `null`
 * only when it genuinely could not be determined.
 *
 * THE DISTINCTION IS THE WHOLE POINT, and getting it wrong is what this
 * function exists to prevent. "No plan" and "I could not read the plan" are
 * different facts with opposite safe actions: the first permits spending, the
 * second must block it. Collapsing them — which `augClaim(...) ?? 0` does at a
 * call site — silently converts every failure into permission. That exact
 * coercion was written at two call sites and defeated budget.js's entire
 * protection until it was caught.
 *
 * ABSENCE IS NEVER THE SIGNAL. progress.js publishes this file on every pass,
 * including passes with nothing to buy, precisely so that "no claim" is a
 * positive statement rather than an inference from a missing file. A missing
 * file therefore means the publisher is not running, which is exactly when a
 * spender should stop.
 */
export function augClaim(text, lastAugReset) {
  if (!text) return null
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return null
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  // A plan priced against a fleet and a reputation that no longer exist is
  // worse than no plan at all, so a stale life reads as unknown, not as zero.
  if (typeof lastAugReset === 'number' && d.lastAugReset !== lastAugReset) return null
  // An explicit "nothing planned" is a known claim of zero.
  if (d.plan === null || d.plan === undefined) return d.planned === false ? 0 : null
  // The publisher may discount its own claim by projected income — the
  // NET amount that must be HELD, not the plan's gross cost. Live failure
  // this fixes: a $33.7b aug plan against $19.8b cash held EVERY dollar and
  // starved the fleet to zero servers, while income at $7.3M/s would cover
  // the whole plan within one install window anyway. The gross cost stays
  // the fallback: an unreadable discount must widen the hold, never narrow it.
  const net = d.budgetClaim
  if (typeof net === 'number' && isFinite(net) && net >= 0) return net
  const cost = d.plan.totalCost
  if (typeof cost !== 'number' || !isFinite(cost) || cost < 0) return null
  return cost
}

/**
 * Money that must be HELD, not spent, to satisfy a faction's money requirement.
 *
 * Reads the same file and obeys the same staleness rule as augClaim.
 *
 * WHY THIS OUTRANKS EVERYTHING. Daedalus admits on 30 distinct augmentations,
 * a hacking level, and **$100b in hand** — and money in hand is the one
 * requirement a spender can destroy. Live in BitNode 1 with the other two gates
 * already met and income at $477b/h, the balance went DOWN, $6.02b to $5.10b,
 * because buyserv.js was converting it into cloud servers as fast as it
 * arrived. Nothing in the budget knew the join existed, so the run could not
 * reach the only requirement standing between it and the exit — not slowly,
 * but never.
 *
 * It sits above `augmentations` because augmentations are a means and this is
 * the end: the augmentation count for Daedalus was already satisfied, and
 * buying more of them would not have helped. A claim that cannot be read still
 * BLOCKS rather than reading as zero, exactly as augClaim does — the spender
 * that guesses zero here is the spender that empties the account.
 */
export function joinClaim(text, lastAugReset) {
  if (!text) return null
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return null
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  if (typeof lastAugReset === 'number' && d.lastAugReset !== lastAugReset) return null
  // ONLY a finite non-negative number is a claim. An explicit 0 is a known
  // nothing; everything else — absent, null, NaN, negative, a string — is
  // unknown and therefore blocks.
  //
  // `null` is deliberately NOT read as zero, which an earlier draft did. The
  // publisher returns null precisely when it could not read the candidate set,
  // and that serialises to `null` — so the one case that most needs to block
  // would have licensed the fleet to spend the join money instead.
  const v = d.joinClaim
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null
}
