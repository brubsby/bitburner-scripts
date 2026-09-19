// Phase 2: price everything, decide the order, check we can pay for the whole
// thing, and only then spend a dollar.
//
//   run sing-augbuy.js --cycle <id>              buy the plan
//   run sing-augbuy.js --cycle <id> --dry        publish the plan, buy nothing
//   run sing-augbuy.js --cycle <id> --reserve 1e12
//
// Reads /tel/sing-augsurvey.txt (phase 1), writes /tel/sing-augbuy.txt. Pricing
// and spending are in ONE script on purpose: a price read in one process and
// spent in another is a price that can move in between, and the 1.9x per queued
// augmentation makes that move large.
//
// ---------------------------------------------------------------------------
// The rule this file exists to enforce.
//
// **Check the money price of the WHOLE purchase before spending anything on any
// part of it.**
//
// nfg.js got this backwards and it cost $10.5 TRILLION: it read the NeuroFlux
// card, saw the reputation was short, donated enough money to cover the
// shortfall — and only discovered afterwards that the level's *money* price was
// out of reach anyway. The reputation was bought for an augmentation that was
// never going to be purchased. The donation is not refundable.
//
// So, in order:
//   1. price every candidate (money AND reputation) with nothing purchased;
//   2. build the whole plan and its running total (augplan.js);
//   3. refuse to start unless the total fits in money - reserve;
//   4. re-read the live price immediately before each individual purchase, and
//      stop the moment one of them is DEARER than the plan said. Cheaper is
//      fine and expected — a refused purchase leaves the queue shallower — and
//      treating it as an error would let one skipped augmentation cancel every
//      purchase after it.
//
// Nothing here donates, works, or joins. If reputation is the binding
// constraint this file says so — but only for augmentations whose money price
// it has already confirmed is affordable, which is precisely the check nfg.js
// was missing. `repWanted` in the status file is that list, and it is what
// sing-donate.js should act on.
// ---------------------------------------------------------------------------

import { reporter, describe, record } from 'status.js'
import { buildPlan, bestSeller, NFG, AUG_PRICE_MULT, NFG_STEP, nfgLevelsRepAllows } from 'augplan.js'

const STATUS = '/tel/sing-augbuy.txt'
const SURVEY = '/tel/sing-augsurvey.txt'
const PLAN = '/tel/aug-plan.txt'

// How far a live price may differ from the planned one before we stop.
//
// The plan's arithmetic is exact (closed-form geometric series against the
// game's own formulas), so the only honest sources of difference are floating
// point and something else buying an augmentation underneath us. 0.5% is far
// above the first and far below the second.
const PRICE_TOLERANCE = 0.005

export async function main(ns) {
  const flags = ns.flags([
    ['cycle', ''],
    ['dry', false],
    // Dollars to keep back. The plan's total must fit inside money - reserve.
    ['reserve', 0],
    // Hard cap on NeuroFlux levels in one cycle. Not a money guard — the money
    // guard is the budget — but a way for the director to say "leave room for
    // real augmentations next cycle" without modelling anything.
    ['max-nfg', 100],
    // Comma-separated names never to buy. The Red Pill is the case this exists
    // for: it is free ($0 base cost), so it sorts last and costs nothing, but
    // installing it is a decision about leaving the BitNode and not one this
    // script should make on its own.
    ['exclude', ''],
    // 'best' | 'nfg-first' | 'augs-first'. See augplan.js: 'best' is the
    // adjacent-block exchange rule, which brute-force enumeration of every
    // possible interleaving makes exactly optimal, and which reproduces
    // "NeuroFlux first" precisely in the regime where that is the right answer.
    // The other two are there to force a fixed order and to measure it.
    ['order', 'best'],
  ])
  ns.disableLog('ALL')

  const errors = []
  const bought = []
  const failed = []
  // Things worth knowing that are not failures. Kept apart from `failed`
  // because `failed` is what the director reads to decide whether the cycle
  // stopped early, and a note mixed into it would read as a stop.
  const notes = []
  let plan = null
  let repWanted = []

  const note = reporter(ns, STATUS, () => ({
    cycle: flags.cycle,
    bought,
    failed,
    notes: notes.slice(-12),
    repWanted,
    errors: errors.slice(-5),
  }))
  let settled = false
  ns.atExit(() => {
    if (!settled) {
      note.exit('stopped', {
        result: 'stopped',
        // The dangerous case: killed with purchases already made. Say how many,
        // because the money is gone and the queue multiplier has moved.
        detail: `sing-augbuy.js exited without reporting — ${bought.length} purchase(s) already made`,
      })
    }
  })

  try {
    const sing = ns.singularity
    const money = () => ns.getServerMoneyAvailable('home')

    // ---- read phase 1 -----------------------------------------------------
    const raw = ns.read(SURVEY)
    if (!raw) {
      settled = true
      note('error', { result: 'error', detail: `${SURVEY} is missing — run sing-augsurvey.js first` })
      return
    }
    const survey = JSON.parse(raw)
    if (survey.health !== 'ok') {
      settled = true
      note('error', { result: 'error', detail: `survey is unhealthy (${survey.health}): ${survey.detail || ''}` })
      return
    }
    // Never act on a previous cycle's survey. Between the director writing its
    // request and the child picking it up there is a window in which a
    // complete, well-formed, WRONG file is on disk.
    if (flags.cycle && survey.cycle !== flags.cycle) {
      settled = true
      note('error', { result: 'error', detail: `survey is for cycle ${survey.cycle}, wanted ${flags.cycle}` })
      return
    }

    const excluded = flags.exclude ? flags.exclude.split(',').map((s) => s.trim()).filter(Boolean) : []

    // ---- reputation, once per faction ------------------------------------
    //
    // getFactionRep is 1GB (SingularityFn2/3) and is read HERE rather than in
    // the survey so it is current at the moment it is spent against. Cached per
    // faction because it cannot change inside this loop.
    const repCache = {}
    const repOf = (faction) => {
      if (repCache[faction] === undefined) repCache[faction] = sing.getFactionRep(faction)
      return repCache[faction]
    }

    // ---- price every candidate -------------------------------------------
    //
    // Money price and reputation requirement are per-augmentation, not per
    // faction (getAugCost takes only the Augmentation — AugmentationHelpers.ts
    // :128), so the faction choice is purely "who do we have the reputation
    // with", which is what bestSeller answers.
    const augs = []
    for (const c of survey.candidates || []) {
      if (excluded.includes(c.name)) continue
      const seller = bestSeller(c.sellers, repOf)
      if (!seller) continue
      augs.push({
        name: c.name,
        faction: seller.faction,
        price: sing.getAugmentationPrice(c.name),
        repReq: sing.getAugmentationRepReq(c.name),
        rep: seller.rep,
      })
      await ns.sleep(0)
    }

    // ---- NeuroFlux -------------------------------------------------------
    //
    // Priced separately because it is the only repeatable augmentation and its
    // cost rule is different: getAugCost gives the NEXT level's money and
    // reputation cost, where money = base * 1.14^level * 1.9^queued and
    // reputation = base * 1.14^level (AugmentationHelpers.ts:129-138). Every
    // queued NFG counts toward BOTH exponents, so a level inside one cycle
    // costs 1.14 * 1.9 = 2.166x the last — which is the wall. The 1.9 part
    // resets at install; the 1.14 part does not.
    const nfgSellers = excluded.includes(NFG) ? [] : survey.nfgSellers || []
    let nfg = null
    if (nfgSellers.length) {
      const seller = bestSeller(nfgSellers, repOf)
      nfg = {
        faction: seller.faction,
        rep: seller.rep,
        price: sing.getAugmentationPrice(NFG),
        repReq: sing.getAugmentationRepReq(NFG),
        maxLevels: flags['max-nfg'],
      }
    }

    // ---- plan -------------------------------------------------------------
    const budget = Math.max(0, money() - flags.reserve)
    plan = buildPlan({ budget, nfg, augs, mode: flags.order })
    plan.at = new Date().toISOString()
    plan.cycle = flags.cycle
    plan.money = Math.round(money())
    plan.reserve = flags.reserve
    // Published as its own artifact so a human, or autopilot, can read the
    // intended sequence before anything is spent — and afterwards, to compare
    // what was planned against what the purchases actually cost.
    ns.write(PLAN, JSON.stringify(plan, null, 2), 'w')

    // What reputation would unlock, filtered by whether the money is there.
    //
    // This is the nfg.js fix stated as data. An entry with moneyAffordable
    // false must NOT be chased with a donation: that is exactly the $10.5t
    // mistake. The price used is what the augmentation would cost appended to
    // the end of the current plan, which is the cheapest it can be.
    const tailMult = Math.pow(AUG_PRICE_MULT, plan.order.filter((o) => o.kind !== 'soa').length)
    const leftover = budget - plan.total
    repWanted = (plan.dropped || [])
      .filter((d) => d.why === 'rep')
      .map((d) => {
        const p = augs.find((x) => x.name === d.name)
        const priceIfAppended = p ? p.price * tailMult : null
        return {
          name: d.name,
          faction: d.faction,
          needRep: Math.round(d.need),
          haveRep: Math.round(d.have),
          shortfall: Math.round(d.need - d.have),
          moneyPrice: priceIfAppended === null ? null : Math.round(priceIfAppended),
          moneyAffordable: priceIfAppended !== null && priceIfAppended <= leftover,
        }
      })
      .sort((a, b) => a.shortfall - b.shortfall)

    // NeuroFlux gets the same treatment, money first. The order of these two
    // tests is the whole point: ask what it costs BEFORE asking whether the
    // reputation is there.
    const nfgReport = nfg
      ? {
          faction: nfg.faction,
          nextPrice: Math.round(nfg.price),
          nextRepReq: Math.round(nfg.repReq),
          rep: Math.round(nfg.rep),
          levelsMoneyAllows: plan.levels,
          levelsRepAllows: nfgLevelsRepAllows(nfg.repReq, nfg.rep),
          // Money first. If the next level's price alone is out of budget then
          // reputation is irrelevant and buying any would be waste.
          blockedBy: nfg.price > budget ? 'money' : plan.nfgStoppedBy,
          stepMultiplier: NFG_STEP,
          // What the fixed "NeuroFlux first" order would have cost for exactly
          // this set. 1.00 means the two agree — which they do once the levels
          // being bought are the most expensive items in the plan.
          nfgFirstPenalty: plan.ordering.nfgFirstPenalty,
        }
      : { blockedBy: 'no faction sells NeuroFlux' }

    if (!plan.order.length) {
      settled = true
      note('waiting', {
        result: 'waiting',
        plan,
        nfg: nfgReport,
        detail: `nothing to buy: budget $${Math.round(budget)}, ${(plan.dropped || []).length} candidate(s) blocked`,
      })
      return
    }

    if (flags.dry) {
      settled = true
      note('ok', {
        result: 'dry',
        plan,
        nfg: nfgReport,
        detail: `would buy ${plan.order.length} (${plan.levels} NFG + ${plan.augs} aug + ${plan.soa} SoA) for $${Math.round(plan.total)}`,
      })
      return
    }

    // ---- the gate ---------------------------------------------------------
    //
    // buildPlan already fits the plan inside the budget; this asserts it against
    // live money one more time, because between the pricing loop and here the
    // batcher has been earning and something else may have been spending. Spend
    // NOTHING if the whole thing does not fit.
    if (plan.total > money() - flags.reserve) {
      settled = true
      note('waiting', {
        result: 'waiting',
        plan,
        nfg: nfgReport,
        detail: `plan costs $${Math.round(plan.total)} but only $${Math.round(money() - flags.reserve)} is spendable — buying nothing`,
      })
      return
    }

    // ---- execute ----------------------------------------------------------
    for (const item of plan.order) {
      // The live price, which is exact: getAugCost re-reads the queue every
      // time (AugmentationHelpers.ts:128-160), so this already includes every
      // purchase made in this loop.
      const live = sing.getAugmentationPrice(item.name)

      // Only the UPSIDE is a reason to stop, and that asymmetry is not a
      // rounding convenience — it is the thing that keeps one refused purchase
      // from cancelling the rest of the plan.
      //
      // purchaseAugmentation refusing (a missing prerequisite, most likely)
      // leaves the queue where it was, so every remaining item is now 1.9x
      // CHEAPER than planned. Aborting on |live - expected| would turn a single
      // skipped augmentation into a cycle that buys nothing after it. Cheaper
      // than planned is always safe: the affordability guarantee above was
      // computed at the higher price.
      //
      // Dearer than planned is not safe. It means something else queued an
      // augmentation underneath us, or augplan.js's arithmetic is wrong — and
      // both are worth a human reading the status file before more money moves.
      if (item.expected > 0 ? live > item.expected * (1 + PRICE_TOLERANCE) : live > 0) {
        failed.push({ name: item.name, why: 'price drift upward', expected: Math.round(item.expected), live: Math.round(live) })
        break
      }
      if (item.expected > 0 && live < item.expected * (1 - PRICE_TOLERANCE)) {
        // Expected after a refusal; recorded so "why did this cost less than
        // the plan said" is answerable from the status file alone.
        notes.push(`${item.name}: $${Math.round(live)} not the planned $${Math.round(item.expected)} — an earlier purchase was refused, so the queue is shallower`)
      }
      if (live > money() - flags.reserve) {
        failed.push({ name: item.name, why: 'money moved', need: Math.round(live), have: Math.round(money()) })
        break
      }

      if (sing.purchaseAugmentation(item.faction, item.name)) {
        bought.push({ name: item.name, faction: item.faction, paid: Math.round(live), kind: item.kind })
      } else {
        // purchaseAugmentation returns false for: not a member, faction does not
        // sell it, already purchased/installed, a missing prerequisite, or money
        // or reputation short (FactionHelpers.tsx:60-106). A prerequisite is the
        // likely one here, and it is deliberately NOT pre-checked:
        // getAugmentationPrereq costs 5GB, and a refused purchase only ever
        // makes the REST of the plan cheaper than planned — the queue multiplier
        // did not advance — so the affordability guarantee above survives it.
        // sing-aug.js re-runs the whole cycle, and by then the prerequisite is
        // queued (hasAugmentation counts queued, Person.ts:232-240) and the
        // dependent is eligible.
        failed.push({ name: item.name, faction: item.faction, why: 'purchaseAugmentation refused (prereq, membership, or a price that moved)' })
      }
      await ns.sleep(0)
    }

    const spent = bought.reduce((a, b) => a + b.paid, 0)
    settled = true
    note(bought.length ? 'ok' : 'waiting', {
      result: bought.length ? 'ok' : 'waiting',
      plan,
      nfg: nfgReport,
      spent: Math.round(spent),
      planned: Math.round(plan.total),
      // "issues", not "stopped": a refusal does not end the loop, it only skips
      // one augmentation. Saying "stopped" for a skipped prerequisite is how a
      // healthy cycle gets read as a broken one.
      detail: `bought ${bought.length}/${plan.order.length} for $${Math.round(spent)}${failed.length ? `; ${failed.length} issue(s), last: ${failed[failed.length - 1].why}` : ''}`,
    })
    if (bought.length) ns.tprint(`sing-augbuy: ${bought.length} queued for $${Math.round(spent)} (${plan.levels} NFG levels)`)
  } catch (err) {
    settled = true
    try {
      ns.print(`sing-augbuy error: ${record(errors, err)}`)
      note('error', { result: 'error', plan, detail: describe(err) })
    } catch {
      /* nothing left to try */
    }
  }
}
