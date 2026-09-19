// Which augmentations to buy, in what order — pure arithmetic, no ns calls.
//
//   import { planPurchases } from 'augplan.js'
//
// STAGING NOTE. This file lives at tools/staging/augplan/augplan.js and is NOT
// deployed. The one line that changes on deploy is the import below: under node
// it reaches installgate.js by relative path, in the game it is the bare
// 'installgate.js' every other script uses. tools/staging/augplan/gameresolve.mjs
// makes the bare form work under node, which is why the deployed spelling is
// what is written here — a staged file that is not the thing that ships is a
// staged file that has not been tested.
//
// Importing this costs nothing in the game: it references no ns function, so it
// contributes 0GB to its importer beyond what installgate.js already costs
// (also 0GB). That matters because the scripts that need it already carry
// 12-14GB of Singularity surface.
//
// ===========================================================================
// WHAT THIS REPLACES, AND WHY THE OLD THING WAS WRONG
//
// progress.js buys like this, on every five-minute pass:
//
//     offers.sort((a, b) => b.price - a.price)
//     for (const o of offers) {
//       if (money < o.price) continue
//       if (sing.purchaseAugmentation(o.faction, o.aug)) queued++
//     }
//
// Three defects, and they compound:
//
//   1. It buys ACROSS TIME rather than planning a set. Whatever is affordable
//      at minute 5 takes rank 0 — the cheapest exponent — and everything bought
//      later pays 1.9x more for it. The first purchase of a cycle is the most
//      valuable position there is and it is spent on whatever happened to be
//      there.
//   2. It ranks by PRICE, not by VALUE. On this run's real offer set that buys
//      Neuralstimulator at $3,000m, whose multipliers are hacking_chance,
//      hacking_speed and hacking_grow — all of which are worth **nothing**
//      against the objective this repo is actually pursuing (see below). It is
//      the third most expensive augmentation available and it moves the number
//      that decides the run by 0.0%.
//   3. It ignores prerequisites. `checkIfPlayerCanPurchaseAugmentation`
//      (Faction/FactionHelpers.tsx:88-95) rejects a purchase whose prereqs are
//      unmet, and descending PRICE order puts "Cranial Signal Processors -
//      Gen V" before Gen I..IV, so the purchase silently fails and the loop
//      moves on. `purchaseAugmentation` returns false; nothing reports it.
//
// ===========================================================================
// THE OBJECTIVE
//
// Maximise  sum_i ln(m_i)  subject to the money we have.
//
// `m_i` is the augmentation's multiplier product over installgate.js's
// RATE_CHANNELS — hacking, hacking_money, faction_rep — imported from that file
// rather than copied. Its header derives why those are the channels: skill
// level is
//
//     level = mult * (32 * ln(exp + 534.6) - 200)      skill.ts:13
//
// LINEAR in the multiplier and only LOGARITHMIC in experience, so BitNode 4's
// hacking 9000 is unreachable by grinding at any rate and the run is entirely
// multiplier-bound. An exp multiplier is worth its logarithm, i.e. nearly
// nothing; a hacking multiplier is worth its full value.
//
// The logarithm is not decoration. It makes the objective ADDITIVE over a set,
// which is the only reason an exact method exists at all.
//
// ===========================================================================
// THE COST, AND WHY THIS IS NOT A KNAPSACK
//
// getAugCost (Augmentation/AugmentationHelpers.ts:127-161):
//
//   r        = 1.9 * [1, 0.96, 0.94, 0.93][SF11 level]              :29-31
//              CONSTANTS.MultipleAugMultiplier = 1.9      Constants.ts:41
//   generic  = r ^ (queued augmentations NOT in soaAugmentationNames)  :32-37
//
//   ordinary   money = base * generic * BN.AugmentationMoneyCost        :157
//              rep   = baseRep        * BN.AugmentationRepCost          :158
//   NeuroFlux  money = base * 1.14^getLevel() * BN.AugMoneyCost * generic  :136-137
//              rep   = baseRep * 1.14^getLevel() * BN.AugRepCost        :135
//   SoA (x9)   money = base * 7  ^(SoA augs owned OR QUEUED)            :151
//              rep   = baseRep * 1.3^(SoA augs owned OR QUEUED)         :152
//
// Four consequences, every one of them load-bearing:
//
// **(a) The k-th non-SoA purchase of a cycle costs `intrinsic * r^k`.** The
// weight belongs to the POSITION, not the item. So for a FIXED SET the total is
// minimised by pairing the largest intrinsic with the smallest weight —
// descending base cost — by the rearrangement inequality. That is a theorem,
// not a heuristic, and augplan.test.mjs [AP1] proves it against brute force over
// every permutation rather than asserting it.
//
// **(b) Because of (a) the cost of adding an item depends on how many other
// items are in the set.** The marginal cost of the 5th augmentation is 1.9^4 =
// 13x its sticker price. A knapsack cannot express that; this is a
// rank-dependent selection problem and it needs the DP in §3.
//
// **(c) Reputation is never consumed.** checkIfPlayerCanPurchaseAugmentation
// COMPARES `faction.playerReputation < augCosts.repCost` (FactionHelpers.tsx:102)
// and purchaseAugmentation's only spend is `Player.loseMoney` (:120). So rep is
// a threshold on availability and money is the only budget. Augmentations the
// reputation does not reach are reported in `skipped` with the shortfall, never
// silently dropped — "which augmentation is one faction errand away" is the most
// useful thing this file can tell the run.
//
// **(d) Two escalations run on SEPARATE counters, and QUEUED copies count on
// both.** NeuroFlux's getLevel() (Augmentation.ts:238-246) is owned level PLUS
// every queued copy, so a level bought inside this plan raises both the 1.14
// exponent and the 1.9 one — 2.166x per level within a cycle. And SoA's
// exponent is `soaAugmentationNames.filter(n => Player.hasAugmentation(n)).length`
// (:150), where Person.hasAugmentation (PersonObjects/Person.ts:232-240) counts
// QUEUED augs unless explicitly told not to — so SoA augmentations bought in
// this plan escalate each other by 7x money and 1.3x rep, while contributing
// nothing to, and taking nothing from, the generic 1.9 count. Measured against
// the game's own getAugCost: a second SoA costs $1m -> $7m whether the first is
// owned or merely queued. Both this repo's earlier tools/staging/augplan.js and
// the brief for this file say "already installed"; both are wrong, and the
// error is a factor of 7 on the second SoA purchase.
//
// ===========================================================================
// §3 THE METHOD — exact, a Pareto DP over (index, rank, chain prefixes)
//
// `n` is small (tens) and `r^k` grows so fast that the affordable count is
// smaller still, so an exact method is tractable and a heuristic would be a
// choice rather than a necessity.
//
// Items divide into three kinds:
//
//   SINGLETONS  ordinary augmentations with no unmet prerequisite. Processed in
//               DESCENDING intrinsic cost. Because every earlier-processed
//               chosen item is more expensive and every later one is cheaper,
//               the c-th singleton chosen IS at position c among the singletons
//               — which is what makes the rank known at decision time, and it
//               is exactly the arrangement (a) says is optimal.
//   CHAINS      items that must be taken in a fixed order, as a PREFIX:
//               NeuroFlux levels (ascending level, by the game's own
//               getLevel()), and each prerequisite group (topological order).
//   SoA         a SEPARATE rank-dependent problem with ratio 7 and its own
//               counter, sharing only the money budget.
//
// State `(i, rank, prefixes)`: i singletons decided, `rank` non-SoA purchases
// made so far (so the next one costs intrinsic * r^rank), `prefixes[j]` items
// taken from chain j. Every transition raises `i + rank` by exactly one, so the
// DP is a clean layered sweep with no explicit topological sort.
//
// At each state a PARETO FRONTIER of `(cost, value)` pairs is kept: anything
// dominated (cost >= and value <=) or over budget is discarded. The answer is
// the best point on the union of the final states' frontiers, convolved with
// the SoA frontier.
//
// WHY THIS IS EXACT, stated precisely because "exact" is a strong claim:
//   - any optimal solution can be rewritten with its singletons in descending
//     cost order without increasing cost (swap an out-of-order adjacent pair;
//     rearrangement says the descending assignment over the two positions they
//     occupy is no worse), so restricting to that canonical form loses nothing;
//   - the DP enumerates every subset and every interleaving of that form;
//   - chain precedence is respected by construction;
//   - a convolution of two exact Pareto frontiers is exact.
// [AP7] checks it against brute force over all subsets on small inputs. If the
// frontier cap is ever reached the result carries `exact: false` and a string
// naming where — a heuristic that says it is one.
//
// THE ONE PLACE IT IS A DOCUMENTED RESTRICTION. A prerequisite group whose
// order is only PARTIAL on the eligible offers (the game has three such groups:
// Embedded Netburner Module, PC Direct-Neural Interface, BLADE-51b Tesla Armor)
// is flattened to a topological chain and taken as a prefix. That can never
// produce an illegal plan, but it can miss a legal cheaper one — e.g. buying
// the Analyze Engine without the Core V2 Upgrade. When it happens the result
// says so in `restricted`, with the group named.
//
// ===========================================================================
// §4 THE STOPPING RULE — augmentations are FUEL, not capital
//
// prestigeSourceFile does `this.augmentations = []`
// (PersonObjects/Player/PlayerObjectGeneralMethods.ts:174) and Prestige.ts:242-248
// resets home RAM and cores on node entry. Source-Files are the only thing that
// crosses a BitNode. So multiplier is not capital that compounds forever: its
// entire value is clearing `multiplierNeeded(9000, exp)` (installgate.js), after
// which it is discarded.
//
// Given `targetM`, the planner therefore returns the CHEAPEST set that clears
// the bar instead of the most valuable set that fits — money past the bar
// should have gone to income or to home RAM, which survives the install.
// Both answers are scans of the same frontier, not two algorithms.
//
// Today this never fires: we hold about 1.13x and need roughly 13x, so
// "cheapest that clears" and "most valuable affordable" coincide. It is tested
// synthetically ([AP8]) precisely because live data will not exercise it.
//
// ===========================================================================
// CALIBRATION. Every cost this file computes is checked against the game's own
// getAugCost, called through tools/sim/game.bundle.mjs, in [AP6] — including
// the NeuroFlux double escalation and the SoA counter. What is NOT calibrated
// is the live offer set: on 2026-09-13 the save is BitNode 4, SF1.1 only, with
// `factions: []`, so ns.singularity throws and there is no live offer set at
// all. The measurement in measure.mjs therefore runs on the game's real
// catalogue restricted to the factions progress.js joins, at swept reputation
// and money, and says so. See NOTES.md §7.
// ===========================================================================

import { RATE_CHANNELS } from 'installgate.js'
// One definition of what an augmentation is worth, exceptions included — see
// objective.js's header for the three scorers this consolidates.
import { augValue, TERMINAL_AUG, TERMINAL_LN, TICKET_LN } from 'objective.js'

/** CONSTANTS.MultipleAugMultiplier, Constants.ts:41. */
export const BASE_PRICE_MULT = 1.9



/** The SF11 discount ladder, AugmentationHelpers.ts:30. */
export const SF11_DISCOUNT = [1, 0.96, 0.94, 0.93]

/** CONSTANTS.NeuroFluxGovernorLevelMult, Constants.ts:36. */
export const NFG_LEVEL_MULT = 1.14

/** CONSTANTS.SoACostMult / SoARepMult, Constants.ts:100-101. */
export const SOA_COST_MULT = 7
export const SOA_REP_MULT = 1.3

export const NFG = 'NeuroFlux Governor'

/**
 * soaAugmentationNames, AugmentationHelpers.ts:17-27.
 *
 * Transcribed because ns.singularity exposes no call that returns the list, and
 * the one call that knows about it — getAugmentationBasePrice, Singularity.ts:144-149,
 * which skips the BitNode money multiplier for exactly these nine — costs 2.5GB
 * to answer a question whose answer is a constant. Getting it wrong mis-PRICES a
 * plan rather than making a wrong purchase, because the executor re-reads every
 * price from the game before it spends. Asserted against the game's own list in
 * [AP6] — which is how the "SoA - " prefix and the lower-case "phyzical WKS
 * harmonizer" were found. tools/staging/augplan.js carries the unprefixed names,
 * so its `isSoa()` matches NOTHING: every SoA augmentation is priced there as an
 * ordinary one, counted into the 1.9 exponent it is explicitly excluded from and
 * missing the 7x escalation it does carry. A transcribed list is a fork, and this
 * is what a fork drifting looks like.
 */
export const SOA_AUGS = [
  'SoA - Beauty of Aphrodite',
  'SoA - Chaos of Dionysus',
  'SoA - Flood of Poseidon',
  'SoA - Hunt of Artemis',
  'SoA - Knowledge of Apollo',
  'SoA - Might of Ares',
  'SoA - Trickery of Hermes',
  'SoA - phyzical WKS harmonizer',
  'SoA - Wisdom of Athena',
]
const SOA_SET = new Set(SOA_AUGS)
export const isSoa = (name) => SOA_SET.has(name)

/** The generic price ratio `r` at a given Source-File 11 level. */
export const genericPriceMultiplier = (sf11 = 0) =>
  BASE_PRICE_MULT * (SF11_DISCOUNT[Math.max(0, Math.min(3, sf11 | 0))] ?? 1)

/** The value of one augmentation: its multiplier product over the channels. */
export const valueOf = (mults, channels = RATE_CHANNELS, weights = null, name = null) =>
  Math.exp(augValue({ name, mults }, { channels, weights }).real)

/**
 * What a fixed list of intrinsic prices costs when bought in the given order,
 * starting at rank `offset`. Sum of `price_k * r^(offset+k)`.
 */
export function orderedCost(prices, r, offset = 0) {
  let sum = 0
  for (let k = 0; k < prices.length; k++) sum += prices[k] * Math.pow(r, offset + k)
  return sum
}

/**
 * The cheapest order for a fixed set of independent items, and its cost.
 *
 * Descending intrinsic price. Rearrangement inequality — see (a) in the header.
 * Exported so the claim can be tested directly against brute force ([AP1])
 * instead of only being exercised through the planner.
 */
export function cheapestOrder(prices, r) {
  const sorted = [...prices].sort((a, b) => b - a)
  return { order: sorted, cost: orderedCost(sorted, r) }
}

/**
 * How many NeuroFlux levels the reputation allows.
 *
 * Level j's requirement is `baseRep * 1.14^(owned + j)`, i.e. the CURRENT
 * quoted requirement times 1.14^j, and reputation is never consumed — so this
 * is a threshold count, not a budget.
 */
export function nfgLevelsRepAllows(repReq, rep) {
  if (!(repReq > 0)) return 0
  if (!(rep >= repReq)) return 0
  return Math.floor(Math.log(rep / repReq) / Math.log(NFG_LEVEL_MULT)) + 1
}

/* ------------------------------------------------------------------------ */
/* Pareto frontiers                                                          */
/*                                                                           */
const nodeMoneyMultOf = (o) => (typeof o?.nodeMoneyMult === 'number' && isFinite(o.nodeMoneyMult) && o.nodeMoneyMult > 0 ? o.nodeMoneyMult : 1)

/* A frontier is an array of {cost, value, ...} kept sorted by ascending cost */
/* with strictly ascending value. That invariant is what makes both the       */
/* "most valuable affordable" and the "cheapest that clears the bar" scans    */
/* one pass each — the stopping rule in §4 is a different read of the same    */
/* structure, not a second search.                                           */
/* ------------------------------------------------------------------------ */

const EPS = 1e-9

function insertPareto(frontier, pt) {
  // Reject if something already there is at least as cheap and at least as good.
  for (const q of frontier) {
    if (q.cost > pt.cost + EPS) break
    if (q.value >= pt.value - EPS) return false
  }
  // Drop everything this dominates, then insert in cost order. Built into a new
  // array rather than compacted in place: an in-place write advances past
  // entries that have not been read yet the moment the insertion point is
  // passed, which silently corrupts the frontier and therefore the answer.
  const out = []
  let inserted = false
  for (const q of frontier) {
    if (!inserted && q.cost >= pt.cost) {
      out.push(pt)
      inserted = true
    }
    if (q.cost >= pt.cost - EPS && q.value <= pt.value + EPS) continue
    out.push(q)
  }
  if (!inserted) out.push(pt)
  frontier.length = 0
  for (const q of out) frontier.push(q)
  return true
}

/** Merge two frontiers under a budget: every affordable pairing, Pareto-reduced. */
function convolve(a, b, budget) {
  const out = []
  for (const x of a) {
    for (const y of b) {
      const cost = x.cost + y.cost
      if (cost > budget + EPS) continue
      insertPareto(out, { cost, value: x.value + y.value, left: x, right: y })
    }
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Input normalisation                                                       */
/* ------------------------------------------------------------------------ */

const num = (x) => typeof x === 'number' && isFinite(x)

/**
 * Split the offers into singletons, chains, SoA and skipped, applying every
 * availability rule. Everything removed here lands in `skipped` with a reason —
 * a filter that throws a row away is a filter that cannot tell the run what
 * reputation would unlock.
 */
function normalise(o) {
  const channels = o.channels ?? RATE_CHANNELS
  const nodeMoneyMult = o.nodeMoneyMult ?? 1
  const nodeRepMult = o.nodeRepMult ?? 1
  const owned = new Set(o.owned ?? [])
  const skipped = []
  const restricted = []

  // One row per augmentation. The same aug is often sold by several factions at
  // the same price (getAugCost takes only the Augmentation), so the only thing
  // that differs is whether we have the reputation — keep the best seller.
  const byName = new Map()
  for (const a of o.offers ?? []) {
    if (!a || typeof a.name !== 'string') continue
    const prev = byName.get(a.name)
    if (!prev) {
      byName.set(a.name, a)
      continue
    }
    const margin = (x) => (x.factionRep ?? 0) - (x.repReq ?? 0)
    if (margin(a) > margin(prev)) byName.set(a.name, a)
  }

  const rows = []
  for (const a of byName.values()) {
    const isNFG = a.isNFG ?? a.name === NFG
    const isSoA = a.isSoA ?? isSoa(a.name)
    const baseCost = a.baseCost ?? a.price
    if (!num(baseCost) || baseCost < 0) {
      // A price we cannot read must not silently become free or infinite.
      skipped.push({ name: a.name, faction: a.faction, why: 'unreadable-price', detail: String(a.baseCost ?? a.price) })
      continue
    }
    rows.push({
      name: a.name,
      faction: a.faction,
      baseCost,
      repReq: a.repReq ?? 0,
      factionRep: a.factionRep ?? 0,
      donationCost: a.donationCost,
      mults: a.mults ?? {},
      prereqs: (a.prereqs ?? []).filter((p) => !owned.has(p)),
      isNFG,
      isSoA,
      m: valueOf(a.mults ?? {}, channels, o.channelWeights ?? null),
      nfgLevel: a.nfgLevel ?? 0,
      nfgMaxLevels: a.nfgMaxLevels,
    })
  }

  const have = new Set(rows.map((r) => r.name))

  /* ---- reputation gating (c): a threshold, reported not discarded --------- */
  const repOk = []
  for (const r of rows) {
    if (r.isSoA) {
      // SoA rep escalates with rank; feasibility is decided inside the SoA DP.
      repOk.push(r)
      continue
    }
    if (r.factionRep >= r.repReq) {
      repOk.push(r)
      continue
    }
    // A DONATABLE faction has no rep wall, only a price: past 150 favour the
    // shortfall converts to dollars (donation.ts:8), and the caller computes
    // that cost per offer. The DP charges it as a FIXED cost — donations do
    // not scale with the 1.9^queued exponent, they are not aug purchases.
    //
    // DELIBERATELY CONSERVATIVE for same-faction sets: each item carries its
    // own full shortfall, though donating for the highest-rep aug would cover
    // the rest. The executor donates only the true shortfall at buy time, so
    // the plan can only under-select, never over-spend.
    if (typeof r.donationCost === 'number' && isFinite(r.donationCost) && r.donationCost > 0) {
      repOk.push({ ...r, donation: r.donationCost })
      continue
    }
    skipped.push({
      name: r.name,
      faction: r.faction,
      why: 'reputation',
      need: r.repReq,
      have: r.factionRep,
      short: r.repReq - r.factionRep,
    })
  }

  /* ---- zero-value items --------------------------------------------------- */
  // Taking one costs money AND pushes every later purchase up an exponent while
  // adding nothing to `sum ln(m)`. It is strictly dominated by not taking it,
  // so excluding it cannot change the optimum. Reported rather than dropped,
  // because "the third most expensive thing on the list is worth nothing to us"
  // is the finding that motivates this whole file.
  const valuable = []
  // Only the CHEAPEST `ticketsWanted` distinct augmentations get the dominance
  // value. Boosting every one of them would let the DP buy well past the
  // shortfall, spending real budget on low-multiplier augmentations for a count
  // that is already satisfied — the mirror of the treadmill rather than a fix
  // for it. The cap is what keeps this a targeted override instead of a new
  // objective.
  const ticketBoost = new Set()
  if (o.ticketsWanted > 0) {
    const ownedSet = new Set(o.owned ?? [])
    repOk
      // ONLY the ones the M objective throws away. An augmentation with real
      // multiplier value is already bought on its merits and needs no
      // dominance boost — boosting it would relabel a genuine purchase as a
      // ticket and, worse, put a synthetic value on a row that did not need
      // one. This is precisely the set the sweep below was written for,
      // promoted from scavenging leftovers into the DP where it can actually
      // win against the NeuroFlux chain.
      .filter((r) => r.name !== NFG && !ownedSet.has(r.name) && !(r.m > 1 + 1e-12))
      .sort((a, b) => (a.baseCost ?? 0) - (b.baseCost ?? 0))
      .slice(0, o.ticketsWanted)
      .forEach((r) => ticketBoost.add(r.name))
  }

  for (const r of repOk) {
    // THE RED PILL HAS NO MULTIPLIERS AND ENDS THE GAME. The zero-value rule
    // below is exactly right for everything else and would silently skip the
    // one augmentation the entire run exists to buy — m = 1, price $0,
    // "strictly dominated by not taking it" by an objective that cannot see
    // the finish line. It enters with a value large enough to always be
    // taken when its reputation is reachable (2.5M at Daedalus, or a
    // donation past 150 favour, which the donationCost machinery prices like
    // any other rep wall).
    // The terminal augmentation's value is objective.js's to define, not this
    // file's — it was defined here AND in installgate.js AND (missing) in
    // factionplan.js, which is how Daedalus came to rank last for selling it.
    if (r.name === TERMINAL_AUG) {
      valuable.push({ ...r, m: Math.exp(augValue(r, { channels, weights: o.channelWeights ?? null, ...(o.oneoff ?? {}) }).ln) })
      continue
    }
    // A DISTINCT AUGMENTATION WE DO NOT OWN IS A TICKET, and while the count
    // gate binds a ticket outranks any multiplier.
    //
    // Daedalus admits on 30 DISTINCT augmentations and NeuroFlux — the only
    // repeatable one — contributes exactly zero to that count, forever. But
    // NeuroFlux is the most efficient ln(M) purchase in the game and escalates
    // 2.166x per level, so it absorbs the ENTIRE budget: the sweep below was
    // written to spend "only what remains", and nothing ever remains.
    //
    // Measured live in BitNode 1, stuck nine augmentations short with the
    // hacking multiplier already past the exit bar — the distinct count after
    // each of the last six installs:
    //
    //     17 -> 18 (+1) -> 18 (+0) -> 21 (+3) -> 21 (+0) -> 21 (+0)
    //
    // Four of five installs bought nothing but NeuroFlux levels. Each life
    // banked ln(M) 0.59-0.95, the gate was satisfied every time, the
    // multiplier climbed, and the only gate still binding never moved. A
    // treadmill that the objective scores as success.
    //
    // TICKET_LN is a DOMINANCE threshold, not a utility estimate, and the
    // distinction matters: it is not "a ticket is worth e^1 of multiplier", it
    // is "no quantity of NeuroFlux substitutes for one ticket, so a ticket must
    // outrank the whole chain". It is set above the largest single-life
    // NeuroFlux haul this run has actually recorded (0.95) with room to spare,
    // and below a genuinely large multiplier augmentation, so real value can
    // still compete. Like The Red Pill's, it is subtracted back out of the
    // reported M — the install gate and rho spend real hours against that
    // number and must never see a synthetic one.
    const isTicket = ticketBoost.has(r.name)
    if (isTicket) {
      valuable.push({
        ...r,
        m: Math.exp(augValue(r, { channels, weights: o.channelWeights ?? null, countShort: o.ticketsWanted, isTicket: true, ...(o.oneoff ?? {}) }).ln),
      })
      continue
    }
    if (r.m > 1 + 1e-12) {
      valuable.push(r)
      continue
    }
    // r.m came from valueOf(), which is MULTIPLIER-ONLY by design. An
    // augmentation whose worth is money, programs or the focus penalty
    // therefore arrives here with m == 1 and was filed as 'no-value' — which
    // is how CashRoot Starter Kit ($1m + BruteSSH.exe at every install) came
    // to be skipped at every price, forever. Ask the single scorer for the
    // FULL value before concluding an augmentation is worthless.
    const full = augValue(r, { channels, weights: o.channelWeights ?? null, ...(o.oneoff ?? {}) })
    if (full.ln > 1e-12) {
      valuable.push({ ...r, m: Math.exp(full.ln), oneoff: full.why ?? null })
      continue
    }
    skipped.push({
      name: r.name,
      faction: r.faction,
      why: 'no-value',
      m: r.m,
      price: r.baseCost * nodeMoneyMult,
      channels,
      ...(full.why ? { oneoffWhy: full.why } : {}),
    })
  }

  /* ---- SoA ---------------------------------------------------------------- */
  // AugmentationHelpers.ts:151-152 — no BitNode multiplier on either axis, which
  // Singularity.ts:144-149 calls out explicitly.
  const soa = valuable.filter((r) => r.isSoA).sort((a, b) => b.baseCost - a.baseCost)

  /* ---- NeuroFlux as a chain ---------------------------------------------- */
  const chains = []
  const nfgRow = valuable.find((r) => r.isNFG)
  if (nfgRow) {
    // NFG THROUGH DONATIONS. Each level's reputation requirement escalates
    // 1.14x (AugmentationHelpers.ts:133-138); past 150 favour every one of
    // those requirements is a dollar figure, priced per level at the SAME
    // $/rep the caller derived for the first shortfall. This was excluded
    // scope while nfg.js handled donations at runtime — until post-install
    // passes (rep freshly zeroed, real augs owned) planned NOTHING but
    // tickets, logM read 0, and the derived objective refused every early
    // pass for want of a valued plan. The planner must see what the runtime
    // was already buying.
    const perRep =
      typeof nfgRow.donation === 'number' && isFinite(nfgRow.donation) && nfgRow.repReq > nfgRow.factionRep
        ? nfgRow.donation / (nfgRow.repReq - nfgRow.factionRep)
        : null
    const donationFor = (t) => (perRep !== null ? Math.max(0, nfgRow.repReq * Math.pow(NFG_LEVEL_MULT, t) - nfgRow.factionRep) * perRep : 0)
    const repCap = perRep !== null ? 64 : nfgLevelsRepAllows(nfgRow.repReq, nfgRow.factionRep)
    const first = nfgRow.baseCost * Math.pow(NFG_LEVEL_MULT, nfgRow.nfgLevel) * nodeMoneyMult
    // A level whose intrinsic price PLUS its donation exceeds the budget can
    // never be taken (its rank multiplier is >= 1), so the chain is bounded
    // without a guess.
    let moneyCap = 0
    while (moneyCap < 64 && first * Math.pow(NFG_LEVEL_MULT, moneyCap) + donationFor(moneyCap) <= (o.money ?? 0)) moneyCap++
    const cap = Math.min(repCap, moneyCap, nfgRow.nfgMaxLevels ?? Infinity)
    if (cap > 0) {
      chains.push({
        id: NFG,
        kind: 'nfg',
        items: Array.from({ length: cap }, (_, t) => ({
          name: NFG,
          faction: nfgRow.faction,
          kind: 'nfg',
          level: nfgRow.nfgLevel + t + 1,
          intrinsic: first * Math.pow(NFG_LEVEL_MULT, t),
          donation: donationFor(t),
          value: Math.log(nfgRow.m),
          m: nfgRow.m,
        })),
      })
    }
    if (repCap === 0) {
      skipped.push({
        name: NFG,
        faction: nfgRow.faction,
        why: 'reputation',
        need: nfgRow.repReq * nodeRepMult,
        have: nfgRow.factionRep,
        short: nfgRow.repReq * nodeRepMult - nfgRow.factionRep,
      })
    } else if (cap < repCap) {
      skipped.push({ name: NFG, faction: nfgRow.faction, why: 'money', detail: `reputation allows ${repCap} level(s); only ${cap} are within reach of the budget` })
    }
  }

  /* ---- prerequisite groups (§3, the documented restriction) -------------- */
  const ordinary = valuable.filter((r) => !r.isSoA && !r.isNFG)
  const pool = new Map(ordinary.map((r) => [r.name, r]))

  // Drop anything whose prereq is neither owned nor on offer: it cannot be
  // bought this cycle at any price, and saying so is more useful than a
  // mysteriously absent row.
  for (const r of [...pool.values()]) {
    const missing = r.prereqs.filter((p) => !pool.has(p))
    if (missing.length) {
      // It may be missing because the prereq itself was rep-gated or valueless;
      // either way the dependent is unreachable.
      pool.delete(r.name)
      skipped.push({ name: r.name, faction: r.faction, why: 'prereq-unavailable', needs: missing })
    }
  }
  // Re-run to a fixed point: removing one dependent can orphan another.
  for (let changed = true; changed; ) {
    changed = false
    for (const r of [...pool.values()]) {
      const missing = r.prereqs.filter((p) => !pool.has(p))
      if (missing.length) {
        pool.delete(r.name)
        skipped.push({ name: r.name, faction: r.faction, why: 'prereq-unavailable', needs: missing })
        changed = true
      }
    }
  }

  // Weakly-connected components over the prereq edges.
  const parent = new Map([...pool.keys()].map((k) => [k, k]))
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  for (const r of pool.values()) for (const p of r.prereqs) parent.set(find(r.name), find(p))
  const groups = new Map()
  for (const r of pool.values()) {
    const g = find(r.name)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(r)
  }

  const singles = []
  for (const members of groups.values()) {
    if (members.length === 1 && members[0].prereqs.length === 0) {
      singles.push(members[0])
      continue
    }
    // Topological order, cheapest first among ready items — the order a human
    // would buy them in, and the only order the game permits.
    const order = []
    const done = new Set()
    const left = [...members].sort((a, b) => a.baseCost - b.baseCost)
    while (left.length) {
      const idx = left.findIndex((r) => r.prereqs.every((p) => done.has(p)))
      if (idx < 0) break // a cycle; the game has none, but do not hang on one
      const [r] = left.splice(idx, 1)
      order.push(r)
      done.add(r.name)
    }
    for (const r of left) skipped.push({ name: r.name, faction: r.faction, why: 'prereq-cycle' })

    // Is the induced prereq order TOTAL? If so the prefix model is exact.
    const anc = new Map(order.map((r) => [r.name, new Set()]))
    for (const r of order) {
      const s = anc.get(r.name)
      for (const p of r.prereqs) {
        s.add(p)
        for (const q of anc.get(p) ?? []) s.add(q)
      }
    }
    let total = true
    for (let i = 0; i < order.length && total; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if (!anc.get(order[i].name).has(order[j].name) && !anc.get(order[j].name).has(order[i].name)) {
          total = false
          break
        }
      }
    }
    if (!total) restricted.push({ group: order.map((r) => r.name), why: 'partial prerequisite order flattened to a chain — legal, but a cheaper legal subset may exist' })

    chains.push({
      id: order[0].name,
      kind: 'prereq',
      items: order.map((r) => ({
        name: r.name,
        faction: r.faction,
        kind: 'aug',
        intrinsic: r.baseCost * nodeMoneyMult,
        donation: r.donation ?? 0,
        value: Math.log(r.m),
        m: r.m,
      })),
    })
  }

  // Singletons descending — the canonical order the DP's rank argument needs.
  singles.sort((a, b) => b.baseCost - a.baseCost)

  return {
    channels,
    nodeMoneyMult,
    nodeRepMult,
    skipped,
    restricted,
    soa,
    chains,
    // Which names carry the count-gate dominance value, so planPurchases can
    // subtract it back out of the reported M. Returned rather than flagged on
    // the items: `buy` rows are rebuilt field-by-field downstream and a
    // property attached here does not survive the trip.
    ticketBoost,
    singles: singles.map((r) => ({
      name: r.name,
      faction: r.faction,
      kind: 'aug',
      intrinsic: r.baseCost * nodeMoneyMult,
      donation: r.donation ?? 0,
      value: Math.log(r.m),
      m: r.m,
    })),
    considered: have.size,
  }
}

/* ------------------------------------------------------------------------ */
/* The DP                                                                    */
/* ------------------------------------------------------------------------ */

function runCore({ singles, chains, r, money, frontierCap }) {
  const n = singles.length
  const radix = chains.map((c) => c.items.length + 1)
  const maxChain = chains.reduce((s, c) => s + c.items.length, 0)
  let capHit = null

  const code = (p) => {
    let v = 0
    for (let j = radix.length - 1; j >= 0; j--) v = v * radix[j] + p[j]
    return v
  }

  // Layer L = i + rank. Every transition raises it by exactly one, so a plain
  // sweep is a valid topological order and no sorting is needed.
  const layers = new Map()
  const start = { i: 0, rank: 0, p: new Array(chains.length).fill(0) }
  const put = (L, st, pt) => {
    let layer = layers.get(L)
    if (!layer) layers.set(L, (layer = new Map()))
    const key = `${st.i},${st.rank},${code(st.p)}`
    let e = layer.get(key)
    if (!e) layer.set(key, (e = { st, f: [] }))
    if (e.f.length >= frontierCap) {
      capHit = capHit ?? key
      return
    }
    insertPareto(e.f, pt)
  }
  put(0, start, { cost: 0, value: 0, from: null, act: null })

  const finals = []
  for (let L = 0; L <= n + maxChain; L++) {
    const layer = layers.get(L)
    if (!layer) continue
    for (const { st, f } of layer.values()) {
      if (st.i === n) for (const pt of f) finals.push(pt)
      for (const pt of f) {
        // skip singleton i
        if (st.i < n) put(L + 1, { i: st.i + 1, rank: st.rank, p: st.p }, { cost: pt.cost, value: pt.value, from: pt, act: null })
        // take singleton i at rank
        if (st.i < n) {
          const it = singles[st.i]
          const cost = pt.cost + it.intrinsic * Math.pow(r, st.rank) + (it.donation ?? 0)
          if (cost <= money + EPS) {
            put(L + 1, { i: st.i + 1, rank: st.rank + 1, p: st.p }, { cost, value: pt.value + it.value, from: pt, act: { it, rank: st.rank } })
          }
        }
        // take the next item of each chain at rank
        for (let j = 0; j < chains.length; j++) {
          const t = st.p[j]
          if (t >= chains[j].items.length) continue
          const it = chains[j].items[t]
          const cost = pt.cost + it.intrinsic * Math.pow(r, st.rank) + (it.donation ?? 0)
          if (cost > money + EPS) continue
          const p2 = st.p.slice()
          p2[j] = t + 1
          put(L + 1, { i: st.i, rank: st.rank + 1, p: p2 }, { cost, value: pt.value + it.value, from: pt, act: { it, rank: st.rank } })
        }
      }
    }
    layers.delete(L - 1)
  }

  const frontier = []
  for (const pt of finals) insertPareto(frontier, pt)
  return { frontier, capHit }
}

/** The SoA sub-problem: ratio 7, its own counter, rank-dependent rep gate. */
function runSoa({ soa, soaOwned, soaRepMult, frontierCap }, money) {
  // Descending base cost, for the same rearrangement reason as the main set.
  let frontier = [{ cost: 0, value: 0, from: null, act: null }]
  let capHit = null
  let states = new Map([['0,0', frontier]])
  for (let i = 0; i < soa.length; i++) {
    const next = new Map()
    for (const [key, f] of states) {
      const [, kStr] = key.split(',')
      const k = Number(kStr)
      const push = (kk, pt) => {
        const kkey = `${i + 1},${kk}`
        let arr = next.get(kkey)
        if (!arr) next.set(kkey, (arr = []))
        if (arr.length >= frontierCap) {
          capHit = capHit ?? kkey
          return
        }
        insertPareto(arr, pt)
      }
      const it = soa[i]
      const price = it.baseCost * Math.pow(SOA_COST_MULT, soaOwned + k)
      const repNeeded = it.repReq * Math.pow(soaRepMult, soaOwned + k)
      for (const pt of f) {
        push(k, { cost: pt.cost, value: pt.value, from: pt, act: null })
        if (it.factionRep < repNeeded) continue
        const cost = pt.cost + price
        if (cost > money + EPS) continue
        push(k + 1, {
          cost,
          value: pt.value + Math.log(it.m),
          from: pt,
          act: { it: { name: it.name, faction: it.faction, kind: 'soa', intrinsic: price, m: it.m }, rank: k },
        })
      }
    }
    states = next
  }
  const out = []
  for (const f of states.values()) for (const pt of f) insertPareto(out, pt)
  return { frontier: out.length ? out : [{ cost: 0, value: 0, from: null, act: null }], capHit }
}

function walk(pt) {
  const steps = []
  for (let q = pt; q && q.from !== undefined; q = q.from) {
    if (q.act) steps.push(q.act)
    if (!q.from) break
  }
  return steps.reverse()
}

/* ------------------------------------------------------------------------ */
/* The entry point                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Plan a set of augmentation purchases.
 *
 * @param {object} o
 * @param {Array}  o.offers   [{ name, faction, baseCost, repReq, factionRep, mults,
 *                              prereqs?, isNFG?, isSoA?, nfgLevel?, nfgMaxLevels? }]
 *                            `baseCost` is the price with NOTHING queued. If the
 *                            caller passes ns.singularity.getAugmentationPrice
 *                            instead, that is the same number whenever the queue
 *                            is empty — which under the architecture in NOTES.md
 *                            §4 it always is at plan time — and `nodeMoneyMult`
 *                            must then be left at 1, because the live price has
 *                            already applied it.
 * @param {number} o.money    the budget.
 * @param {number} [o.r]      the generic ratio; default 1.9 (SF11 level 0). Pass
 *                            genericPriceMultiplier(sf11) if SF11 is held.
 * @param {number} [o.nodeMoneyMult] BitNodeMultipliers.AugmentationMoneyCost. It
 *                            is 1 in BitNode 4 (BitNode.tsx:627-655 does not set
 *                            it, so BitNodeMultipliers.ts:13 applies) and 2-5 in
 *                            BN3/5/7/9/10/12/13/14 — read it, do not assume it.
 * @param {number} [o.nodeRepMult] BitNodeMultipliers.AugmentationRepCost. Used
 *                            only to report NeuroFlux rep shortfalls; callers
 *                            passing live rep requirements should leave it at 1.
 * @param {string[]} [o.channels] default installgate.js RATE_CHANNELS.
 * @param {number} [o.targetM] the stopping bar of §4 — e.g.
 *                            multiplierNeeded(9000, exp) / currentMult. When a
 *                            plan can clear it, the CHEAPEST clearing plan is
 *                            returned instead of the most valuable affordable one.
 * @param {string[]} [o.owned] already-installed augmentation names, for prereqs.
 * @param {number} [o.soaOwned] SoA augmentations already owned OR queued.
 * @param {number} [o.frontierCap] safety valve; hitting it sets `exact: false`.
 *
 * @returns {{buy: Array, totalCost: number, M: number, logM: number,
 *            skipped: Array, exact: boolean, approximation: ?string,
 *            restricted: Array, stats: object}}
 */
export function planPurchases(o) {
  const money = o?.money
  if (!num(money)) throw new Error(`augplan: money is unreadable (${String(money)}) — refusing to plan against a budget nobody can name`)
  const r = o.r ?? BASE_PRICE_MULT
  if (!num(r) || r <= 1) throw new Error(`augplan: price ratio r must be > 1, got ${String(r)}`)
  const frontierCap = o.frontierCap ?? 20000

  const empty = (why) => ({
    buy: [],
    totalCost: 0,
    M: 1,
    logM: 0,
    skipped: [],
    exact: true,
    approximation: null,
    restricted: [],
    stats: { why, offers: (o.offers ?? []).length, money, r },
  })
  if (!(money > 0)) return { ...empty('no money'), skipped: norm0(o) }
  if (!o.offers || o.offers.length === 0) return empty('no offers')

  const norm = normalise({ ...o, money })
  const core = runCore({ singles: norm.singles, chains: norm.chains, r, money, frontierCap })
  const soaRes = runSoa(
    { soa: norm.soa, soaOwned: o.soaOwned ?? 0, soaRepMult: SOA_REP_MULT, frontierCap },
    money,
  )

  const combined = convolve(core.frontier, soaRes.frontier, money)
  if (!combined.length) {
    return {
      ...empty('nothing affordable'),
      skipped: norm.skipped.concat(
        norm.singles.map((s) => ({ name: s.name, faction: s.faction, why: 'money', price: s.intrinsic })),
      ),
      restricted: norm.restricted,
    }
  }

  // §4. The frontier is sorted by ascending cost with ascending value, so
  // "cheapest that clears the bar" is the first entry at or above it and
  // "most valuable affordable" is the last entry. One structure, two reads.
  const bar = num(o.targetM) && o.targetM > 1 ? Math.log(o.targetM) : null
  let pick = combined[combined.length - 1]
  let stoppedAt = null
  if (bar !== null) {
    const clearing = combined.find((p) => p.value >= bar - EPS)
    if (clearing) {
      pick = clearing
      stoppedAt = o.targetM
    }
  }

  const steps = walk(pick.left).concat(walk(pick.right))
  const chosen = new Set(steps.map((s) => s.it.name))

  // Rebuild the schedule so `price` is what will actually be charged. The DP's
  // running cost is the same arithmetic, but recomputing it here means the
  // published per-item price is derived from the published rank rather than
  // trusted from a backpointer — the executor compares against these.
  let rank = 0
  let soaRank = o.soaOwned ?? 0
  let total = 0
  const buy = []
  for (const s of steps) {
    const isSoAStep = s.it.kind === 'soa'
    const donation = !isSoAStep && s.it.donation > 0 ? s.it.donation : 0
    const price = (isSoAStep ? s.it.intrinsic : s.it.intrinsic * Math.pow(r, rank)) + donation
    total += price
    buy.push({
      name: s.it.name,
      faction: s.it.faction,
      kind: s.it.kind,
      level: s.it.level,
      rank: isSoAStep ? soaRank : rank,
      price,
      ...(donation > 0 ? { donation } : {}),
      m: s.it.m,
      cumulative: total,
    })
    if (isSoAStep) soaRank++
    else rank++
  }

  const skipped = norm.skipped.slice()
  for (const s of norm.singles) if (!chosen.has(s.name)) skipped.push({ name: s.name, faction: s.faction, why: stoppedAt ? 'target-reached' : 'money', price: s.intrinsic, m: s.m })
  for (const c of norm.chains) {
    for (const it of c.items) {
      if (it.kind === 'nfg') continue
      if (!chosen.has(it.name)) skipped.push({ name: it.name, faction: it.faction, why: stoppedAt ? 'target-reached' : 'money', price: it.intrinsic, m: it.m })
    }
  }
  for (const it of norm.soa) if (!chosen.has(it.name)) skipped.push({ name: it.name, faction: it.faction, why: stoppedAt ? 'target-reached' : 'money', price: it.baseCost, m: it.m })

  // The Red Pill's synthetic selection value must NOT reach the reported M —
  // the install gate spends real hours against that number, and a fake e^10
  // would make every plan look like the discovery of fire. Selection uses the
  // synthetic; the report uses the truth (its real m is exactly 1).
  let syntheticLn = buy.filter((b) => b.name === TERMINAL_AUG).length * TERMINAL_LN
  if (syntheticLn > 0) for (const b of buy) if (b.name === TERMINAL_AUG) b.m = 1
  // Same decontamination for ticket value: selection used the synthetic, the
  // report carries the truth. Their REAL multiplier is restored rather than
  // set to 1 — unlike The Red Pill a ticket often has genuine value too, and
  // zeroing it would understate M in the other direction.
  for (const b of buy) {
    // Keyed off the boost SET rather than a flag on the row: `buy` entries are
    // rebuilt field-by-field from normalised items, so a property attached
    // upstream silently does not survive — it read as "no tickets were bought"
    // while three boosted augmentations sat in the plan with m = e^2 intact,
    // which would have shipped the synthetic value into the reported M and
    // from there into rho and the install gate.
    if (!norm.ticketBoost?.has(b.name)) continue
    syntheticLn += TICKET_LN
    b.m = b.m / Math.exp(TICKET_LN)
    // Labelled `ticket` whichever mechanism chose it. The sweep below marks
    // its own the same way, so "is this purchase here for the count?" has one
    // answer in the plan and in telemetry, independent of which path selected
    // it. `kind` is otherwise only read for 'soa' and 'nfg' (chain handling),
    // so this cannot collide.
    b.kind = 'ticket'
  }

  // ---------------------------------------------------------------------
  // THE TICKET SWEEP — the endgame's second objective, lexicographic after M.
  //
  // Daedalus admits at DaedalusAugsRequirement DISTINCT augmentations
  // (FactionInfo.tsx:142), and Daedalus gates the Red Pill, which ends the
  // node. So once `o.ticketsWanted > 0`, every rep-affordable unowned
  // augmentation the M-optimal plan left behind is a TICKET worth buying
  // with leftover budget — including, especially, the ones the zero-value
  // rule above correctly calls worthless for M. Measured live before this
  // existed: a $10M ticket sat unbought next to $34b for exactly that reason.
  //
  // Lexicographic, not folded into the DP: tickets never displace an
  // M-purchase (they spend only what remains), they append at the HIGHEST
  // ranks (cheapest intrinsics at the most expensive 1.9^rank positions —
  // the rearrangement inequality's preferred order), and they stop at
  // ticketsWanted or the budget, whichever first.
  if (o.ticketsWanted > 0) {
    const ownedSet = new Set(o.owned ?? [])
    const inPlan = new Set(buy.map((b) => b.name))
    // A ticket is reachable if its reputation is affordable OUTRIGHT or by
    // DONATION (the caller attaches donationCost past 150 favour). Excluding
    // donatable augs stalled the Daedalus COUNT gate: post-install rep resets
    // to 0, so at the end every remaining ticket is donation-gated, and a
    // sweep that only took rep-affordable augs left dollars on the table
    // while the count sat one short. `ticketCost` folds the donation in;
    // ordering is by that true cost, cheapest first.
    const ticketCost = (a) => a.baseCost * nodeMoneyMultOf(o) + (typeof a.donationCost === 'number' && isFinite(a.donationCost) && (a.factionRep ?? 0) < (a.repReq ?? 0) ? a.donationCost : 0)
    const reachable = (a) => (a.factionRep ?? 0) >= (a.repReq ?? Infinity) || (typeof a.donationCost === 'number' && isFinite(a.donationCost) && a.donationCost >= 0)
    const tickets = (o.offers ?? [])
      .filter(
        (a) =>
          typeof a?.name === 'string' &&
          a.name !== NFG &&
          !ownedSet.has(a.name) &&
          !inPlan.has(a.name) &&
          typeof a.baseCost === 'number' &&
          isFinite(a.baseCost) &&
          a.baseCost >= 0 &&
          reachable(a) &&
          (a.prereqs ?? []).every((pr) => ownedSet.has(pr) || inPlan.has(pr)),
      )
      .sort((a, b) => ticketCost(a) - ticketCost(b))
    // Starts from what the DP ALREADY bought for the count, not from zero.
    // The sweep is now a fallback for tickets the DP could not fit, so a
    // counter that ignored the DP's would let the two mechanisms between them
    // buy 2*ticketsWanted — spending real budget on a gate that was already
    // closed.
    let added = buy.filter((b) => b.kind === 'ticket').length
    for (const t of tickets) {
      if (added >= o.ticketsWanted) break
      // Re-checked INSIDE the loop: the candidate list was filtered against
      // the plan once, up front, so two factions selling the SAME aug both
      // survive the filter — and Daedalus counts DISTINCT augmentations, so
      // the second copy is worth nothing and was bought anyway (live: two
      // Neurotrainer IIs, $85.5M and $162M, in the very first swept plan).
      if (inPlan.has(t.name)) continue
      const donation = (t.factionRep ?? 0) < (t.repReq ?? 0) && typeof t.donationCost === 'number' && isFinite(t.donationCost) ? t.donationCost : 0
      const price = t.baseCost * nodeMoneyMultOf(o) * Math.pow(r, rank) + donation
      if (total + price > money + EPS) break
      total += price
      buy.push({ name: t.name, faction: t.faction, kind: 'ticket', rank, price, ...(donation > 0 ? { donation } : {}), m: 1, cumulative: total })
      inPlan.add(t.name)
      rank++
      added++
    }
  }

  const capHit = core.capHit ?? soaRes.capHit
  return {
    buy,
    totalCost: total,
    M: Math.exp(pick.value - syntheticLn),
    logM: pick.value - syntheticLn,
    skipped,
    exact: !capHit,
    approximation: capHit
      ? `Pareto frontier cap of ${frontierCap} reached at state ${capHit}; the plan is a lower bound on the optimum, not the optimum`
      : null,
    restricted: norm.restricted,
    stats: {
      offers: o.offers.length,
      considered: norm.considered,
      singletons: norm.singles.length,
      chains: norm.chains.map((c) => ({ id: c.id, kind: c.kind, length: c.items.length })),
      soa: norm.soa.length,
      frontier: combined.length,
      money,
      r,
      spent: total,
      left: money - total,
      targetM: o.targetM ?? null,
      stoppedAtTarget: stoppedAt !== null,
    },
  }
}

/** Reasons an offer list is unusable, for the money <= 0 early exit. */
function norm0(o) {
  return (o.offers ?? []).map((a) => ({ name: a?.name, faction: a?.faction, why: 'money', price: a?.baseCost ?? a?.price }))
}

/**
 * What the shipped progress.js greedy does, so the two can be compared on the
 * same input rather than argued about. Sort by price descending, buy anything
 * still affordable, in one pass.
 *
 * This is a faithful model of progress.js:326-333 INCLUDING its bugs: it does
 * not check prerequisites, so a purchase the game would reject is counted as
 * failed rather than as bought, exactly as `purchaseAugmentation` returning
 * false is silently ignored there.
 */
export function greedyByPrice({ offers, money, r = BASE_PRICE_MULT, nodeMoneyMult = 1, channels = RATE_CHANNELS, owned = [], channelWeights = null }) {
  const have = new Set(owned)
  const rows = (offers ?? [])
    .filter((a) => (a.factionRep ?? 0) >= (a.repReq ?? 0))
    .map((a) => ({ ...a, price: (a.baseCost ?? a.price) * nodeMoneyMult, m: valueOf(a.mults ?? {}, channels, channelWeights) }))
    .sort((a, b) => b.price - a.price)
  const buy = []
  const failed = []
  let left = money
  let rank = 0
  for (const a of rows) {
    const price = a.price * Math.pow(r, a.isSoA || isSoa(a.name) ? 0 : rank)
    if (price > left) continue
    if (!(a.prereqs ?? []).every((p) => have.has(p))) {
      failed.push({ name: a.name, why: 'prereq', needs: (a.prereqs ?? []).filter((p) => !have.has(p)) })
      continue
    }
    left -= price
    buy.push({ name: a.name, faction: a.faction, price, m: a.m, rank })
    have.add(a.name)
    if (!(a.isSoA || isSoa(a.name))) rank++
  }
  const M = buy.reduce((p, b) => p * b.m, 1)
  return { buy, failed, totalCost: money - left, M, logM: Math.log(M) }
}
