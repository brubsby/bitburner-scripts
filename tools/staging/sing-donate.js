// Buy reputation with money, once favor allows it — and refuse to buy it for
// something that is blocked on anything else.
//
//   run sing-donate.js BitRunners --rep 2.5e6 --price 4.2e12
//   run sing-donate.js BitRunners --rep 2.5e6 --unpriced   # opt out, loudly
//   run sing-donate.js BitRunners --check                  # price it, spend nothing
//
// `--rep` is the TARGET TOTAL reputation, not a delta. `--price` is the dollar
// cost of the thing the reputation is being bought FOR. Read the next section
// before removing that argument.
//
// ---------------------------------------------------------------------------
// 1. The $10.5t bug this script exists to not repeat.
//
// nfg.js buys NeuroFlux levels. Its loop, at nfg.js:141-176, does this:
//
//     const shortfall = needRep - haveRep
//     if (!(shortfall > 0)) {            // rep is fine ->
//         const price = ...              //   only HERE does it look at price
//         break
//     }
//     const cost = shortfall * 1e6       // rep is short ->
//     if (money - cost < reserve) break  //   checks it can afford the DONATION
//     donate(cost)                       //   ...and never the augmentation
//
// The money price of the augmentation is only ever consulted on the branch
// where reputation was ALREADY sufficient. On the branch that spends money, it
// is not consulted at all. So the script bought $10.5t of reputation for a
// NeuroFlux level whose own dollar price it could not afford, discovered that
// on the next pass, and stopped. The reputation survives; the money does not.
//
// The asymmetry is the thing to hold on to: **reputation is not consumed by a
// failed purchase, money is.** Donating early is recoverable. Donating for
// something unaffordable is a pure, permanent loss.
//
// Two structural fixes here, not one comment:
//
//   a. `--price` has no usable default. Omit it and the script REFUSES and
//      exits 'blocked'; you must pass `--unpriced` to say you meant it. A bug
//      of omission cannot reproduce the original, because omission is the
//      thing that is fatal.
//   b. The gate is `money >= donation + price + reserve`, evaluated BEFORE any
//      money moves, and re-evaluated after calibration with the measured rate.
//      Not `money >= donation`.
//
// This script cannot see the price itself: `getAugmentationPrice` is 2.5GB and
// `getAugmentationsFromFaction` 5GB (RamCostGenerator.ts:204-208), and pulling
// them in here would put the whole of sing-aug.js's surface into a script that
// already spends 5GB on donateToFaction alone. The caller that knows what it is
// buying passes the price down. That is the cost of the two-script split, and
// it is why `--price` is mandatory rather than optional.
//
// ---------------------------------------------------------------------------
// 2. The formula, and the factor that is missing from every summary of it.
//
// `Faction/formulas/donation.ts:8-10`, read, not recalled:
//
//     export function repFromDonation(amt, person) {
//       return (amt / CONSTANTS.DonateMoneyToRepDivisor)
//            * person.mults.faction_rep
//            * currentNodeMults.FactionWorkRepGain;
//     }
//
// There are THREE factors. `DonateMoneyToRepDivisor` is 1e6 (Constants.ts:33).
// The usual shorthand — `amt / 1e6 * faction_rep` — drops
// `currentNodeMults.FactionWorkRepGain`, which is **0.75 in BitNode 4**
// (BitNode.tsx:645). Donations here buy 25% less reputation than that shorthand
// predicts.
//
// That inverts nfg.js's safety margin. nfg.js deliberately over-donates by
// assuming faction_rep = 1, and its own comment records the live value as
// ~1.33. In BN4 that assumption yields
//
//     rep = shortfall * 1.33 * 0.75 = shortfall * 0.9975
//
// — a 0.25% SHORTFALL, not a surplus. At faction_rep below 1/0.75 = 1.3333 the
// "always an upper bound" comment is simply false in this BitNode, and a
// purchase that looked funded fails by a hair. The break-even is exactly 4/3.
//
// `favorNeededToDonate()` is `Math.floor(CONSTANTS.BaseFavorToDonate *
// currentNodeMults.FavorToDonateToFaction)` (donation.ts:17) with
// BaseFavorToDonate = 150 (Constants.ts:31). BN4 does not set
// FavorToDonateToFaction, so it is the class default 1 (BitNodeMultipliers.ts:143)
// and the threshold here is 150 exactly. It is NOT 150 everywhere: BN3 halves
// it to 75 and BN8 zeroes it.
//
// ---------------------------------------------------------------------------
// 3. Why it measures the rate instead of computing it.
//
// CLAUDE.md: "Any offline model whose output drives a decision must reproduce a
// quantity the live game already displays, and print the error, before its
// conclusions are used." The table below covers BitNodes 1-15, but BN12 scales
// its multipliers by level and a hardcoded table is exactly the failure mode
// that put daedalus-plan.mjs 24% out.
//
// So the amount is not computed from the table. It is MEASURED: donate a small
// probe donation, read the reputation delta, and derive dollars-per-reputation from what
// the game actually did. The table only supplies the expected value for the
// CHECK line, which is printed with its error on every run, pass or fail.
//
// The measurement is exact, not sampled. `donate()` mutates
// `faction.playerReputation` synchronously (donation.ts:30) and `getFactionRep`
// reads that same field (Singularity.ts:876-881), and there is **no `await`
// between the three calls** — so no game cycle can tick, and concurrent faction
// work (FactionWork.process, FactionWork.tsx:52-54) cannot contaminate the
// delta. Do not insert a sleep in that block.
//
// ---------------------------------------------------------------------------
// 4. RAM: 10.1GB.
//
//   base              1.6   RamCostConstants.Base
//   donateToFaction   5     SingularityFn3 (RamCostGenerator.ts:195) — the job
//   getFactionRep     1     SingularityFn2/3 (:192) — the target, and both ends
//                           of the calibration measurement
//   getFactionFavor   1     SingularityFn2/3 (:193) — donateToFaction returns a
//                           bare false when favor is short (:920-931), which is
//                           indistinguishable from every other false. The
//                           director needs "favor 143 of 150" to decide whether
//                           to keep grinding or give up; this is that number.
//   getPlayer         0.5   SingularityFn1/4 (:661) — .mults.faction_rep for the
//                           expected rate, .money (so no getServerMoneyAvailable),
//                           and .factions to fail fast on non-membership
//   getResetInfo      1     (:664) — .currentNode, so the expected rate and the
//                           favor threshold are right in every BitNode and not
//                           just this one
//
// NOT referenced: `workForFaction` / `joinFaction` (sing-faction.js's job — and
// donating never needs to be atomic with joining), `getAugmentation*` (see §1),
// `getFactionFavorGain` (0.75GB, tells you favor at install, which is
// sing-aug.js's decision), `getBitNodeMultipliers` (4GB and SF5-gated, to learn
// one number the probe measures for free).
//
// ⚠ A LOCAL VARIABLE NAME CAN COST RAM. `RamCalculations.ts:436-438` walks a
// MemberExpression's `property` as well as its `object`, and every Identifier it
// meets becomes a dependency; `findFunc` (:226-244) then searches the ENTIRE
// RamCosts tree recursively BY BARE NAME. So any identifier anywhere — a local
// `const`, a property on a plain object — that happens to match an ns function
// name in any namespace is billed. The calibration amount below was originally
// `const probe`, which silently cost 0.2GB via `dnet.probe`
// (RamCostGenerator.ts:244). It is `calAmount` for that reason and no other.
// Check new names before adding them; see NOTES-faction.md §5 for the script.

import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/sing-donate.txt'

// Constants.ts:31,33
const BASE_FAVOR_TO_DONATE = 150
const DIVISOR = 1e6

// Extracted from BitNode/BitNode.tsx by walking every `case n: return new
// BitNodeMultipliers({...})`. Unlisted nodes take the class defaults of 1
// (BitNodeMultipliers.ts). BN12 sets both from a level-scaled `inc`/`dec`
// (BitNode.tsx:964) and is therefore deliberately absent: see UNKNOWN_NODES.
const FACTION_WORK_REP_GAIN = { 2: 0.5, 4: 0.75, 13: 0.6, 14: 0.2 }
const FAVOR_TO_DONATE = { 3: 0.5, 8: 0 }
const UNKNOWN_NODES = new Set([12])

/** Expected reputation per dollar donated. Pure; free. */
export function expectedRate(factionRepMult, node) {
  const bnMult = FACTION_WORK_REP_GAIN[node] ?? 1
  return (factionRepMult * bnMult) / DIVISOR
}

/** donation.ts:17. Pure; free. */
export function favorNeeded(node) {
  return Math.floor(BASE_FAVOR_TO_DONATE * (FAVOR_TO_DONATE[node] ?? 1))
}

export async function main(ns) {
  const flags = ns.flags([
    ['rep', 0], // target TOTAL reputation
    ['price', -1], // dollar cost of the thing the rep is for; -1 = not supplied
    ['unpriced', false], // explicit opt-out of the price gate
    ['reserve', 0], // money floor to leave untouched
    ['max', Infinity], // hard cap on this run's total donation
    ['check', false], // price everything, spend nothing
    ['help', false],
  ])
  const faction = flags._[0]

  ns.disableLog('ALL')

  const errors = []
  let node = null
  let spent = 0

  const note = reporter(ns, STATUS, () => ({
    faction: faction || null,
    bitNode: node,
    spent,
    errors: errors.slice(-5),
  }))
  ns.atExit(() => note.exit('stopped', { detail: 'sing-donate.js exited', spent }))

  const stop = (health, detail, extra) => {
    note(health, { result: health === 'ok' ? 'ok' : health, detail, ...(extra || {}) })
    ns.tprint(`sing-donate: ${detail}`)
  }

  if (flags.help || !faction) {
    ns.tprint('sing-donate.js <faction> --rep <target total rep> --price <$ cost of what the rep is for> [--reserve N] [--max N] [--check] [--unpriced]')
    note('ok', { result: 'ok', detail: 'help' })
    return
  }

  try {
    node = ns.getResetInfo().currentNode
    const player = ns.getPlayer()

    if (!player.factions.includes(faction)) {
      return stop('error', `not a member of '${faction}' — donateToFaction would return false (Singularity.ts:899-902)`)
    }

    // --- gate 0: is this even a donation faction -------------------------
    // Not checked here on purpose. `donateToFaction` refuses when
    // `!faction.getInfo().offersWork()` (Singularity.ts:907-910) — Bladeburners,
    // Church of the Machine God, Shadows of Anarchy — and refusing costs
    // nothing, because every one of its guards returns before `donate()` is
    // called. Paying 1GB for getFactionWorkTypes to predict a free failure is a
    // bad trade; the probe's return value reports it instead.

    // --- gate 1: favor ----------------------------------------------------
    const need = favorNeeded(node)
    const favor = ns.singularity.getFactionFavor(faction)
    if (favor < need) {
      return stop(
        'waiting',
        `favor ${favor.toFixed(1)} of ${need} — cannot donate yet${UNKNOWN_NODES.has(node) ? ' (BN12 scales this; threshold is a guess)' : ''}`,
        { favor, favorNeeded: need },
      )
    }

    // --- gate 2: is there anything to buy ---------------------------------
    const have = ns.singularity.getFactionRep(faction)
    const target = Number(flags.rep)
    if (!(target > 0)) return stop('error', '--rep must be a positive target reputation')
    const shortfall = target - have
    if (shortfall <= 0) {
      return stop('ok', `already at ${Math.round(have)} rep of ${Math.round(target)} — nothing to buy`, { rep: have, target })
    }

    // --- gate 3: THE PRICE GATE — see the header, section 1 ---------------
    // This runs before a single dollar moves, and it is the whole point of the
    // script. Note what is on the right-hand side: the donation AND the price
    // of the thing AND the reserve.
    const price = Number(flags.price)
    if (price < 0 && !flags.unpriced) {
      return stop(
        'blocked',
        'refusing to donate: --price not supplied. Pass the dollar cost of what this reputation is FOR, or --unpriced to opt out. nfg.js burned $10.5t on exactly this omission.',
      )
    }
    const otherCost = flags.unpriced || price < 0 ? 0 : price

    const money = player.money
    const rate = expectedRate(player.mults.faction_rep, node)
    const estDonation = Math.min(shortfall / rate, Number(flags.max))
    const estRequired = estDonation + otherCost + Number(flags.reserve)

    // The CHECK block: expected-vs-live is printed on every run, pass or fail.
    const check = {
      factionRepMult: player.mults.faction_rep,
      bitNodeFactionWorkRepGain: FACTION_WORK_REP_GAIN[node] ?? 1,
      bitNodeKnown: !UNKNOWN_NODES.has(node),
      expectedRepPerDollar: rate,
      // What the usual shorthand (amt / 1e6 * faction_rep) would have said.
      shorthandRepPerDollar: player.mults.faction_rep / DIVISOR,
      shorthandErrorPct: ((FACTION_WORK_REP_GAIN[node] ?? 1) - 1) * 100,
    }

    if (money < estRequired) {
      return stop(
        'waiting',
        `cannot afford the whole purchase: need $${estRequired.toExponential(3)} ` +
          `(donation $${estDonation.toExponential(3)} + price $${otherCost.toExponential(3)} + reserve $${Number(flags.reserve).toExponential(3)}) ` +
          `but have $${money.toExponential(3)}. Nothing donated.`,
        { rep: have, target, shortfall, estDonation, price: otherCost, money, check },
      )
    }

    if (flags.check) {
      return stop('ok', `--check: would donate ~$${estDonation.toExponential(3)} for ${Math.round(shortfall)} rep, leaving $${(money - estRequired).toExponential(3)} after the $${otherCost.toExponential(3)} purchase`, {
        rep: have,
        target,
        shortfall,
        estDonation,
        price: otherCost,
        money,
        check,
      })
    }

    // --- calibrate: measure the real rate ---------------------------------
    // Small relative to the real donation, floored so the reputation delta is
    // comfortably above float noise at any plausible reputation, and ceilinged
    // so it can never itself be the thing that breaks the budget.
    const calAmount = Math.max(1e6, Math.min(estDonation * 0.002, 1e9, money - otherCost - Number(flags.reserve)))

    // NO await inside this block. See header §3.
    const before = ns.singularity.getFactionRep(faction)
    const calOk = ns.singularity.donateToFaction(faction, calAmount)
    const after = ns.singularity.getFactionRep(faction)
    // ---------------------------------------------------------------------

    if (!calOk) {
      return stop(
        'error',
        `donateToFaction('${faction}', ${calAmount.toExponential(3)}) returned false with favor ${favor.toFixed(1)} >= ${need} and money in hand — ` +
          `most likely this faction does not offer work (Singularity.ts:907-910) or a gang owns it (:903-906). Nothing further donated.`,
        { check },
      )
    }
    spent += calAmount
    const measuredRate = (after - before) / calAmount
    check.measuredRepPerDollar = measuredRate
    check.errorPct = rate > 0 ? ((measuredRate - rate) / rate) * 100 : null
    ns.print(
      `CHECK rep/$: expected ${rate.toExponential(4)} measured ${measuredRate.toExponential(4)} ` +
        `error ${check.errorPct === null ? 'n/a' : check.errorPct.toFixed(2) + '%'}`,
    )

    if (!(measuredRate > 0)) {
      return stop('error', `probe donated $${calAmount.toExponential(3)} and moved reputation by ${(after - before).toExponential(3)} — cannot derive a rate`, { check })
    }

    // --- re-gate with the MEASURED rate, then donate the remainder --------
    // If the table was wrong the true cost is different, and the price gate has
    // to be re-run against reality before the large amount moves. Only the
    // bounded probe has been spent at this point.
    const remaining = target - after
    if (remaining <= 0) {
      return stop('ok', `probe alone reached ${Math.round(after)} of ${Math.round(target)} rep`, { rep: after, target, check })
    }

    const moneyNow = ns.getPlayer().money
    const donation = Math.min(remaining / measuredRate, Number(flags.max) - spent)
    const required = donation + otherCost + Number(flags.reserve)

    if (donation <= 0) {
      return stop('waiting', `--max $${Number(flags.max).toExponential(3)} reached after the calibration probe`, { rep: after, target, check })
    }
    if (moneyNow < required) {
      return stop(
        'waiting',
        `measured rate ${measuredRate.toExponential(4)} rep/$ (${check.errorPct.toFixed(1)}% off the table) makes this unaffordable: ` +
          `need $${required.toExponential(3)}, have $${moneyNow.toExponential(3)}. Stopped after the $${calAmount.toExponential(3)} probe.`,
        { rep: after, target, donation, price: otherCost, money: moneyNow, check },
      )
    }

    // Ceil, not round: a rounding error downward leaves the target unmet and
    // costs another whole run to notice.
    const amount = Math.ceil(donation)
    if (!ns.singularity.donateToFaction(faction, amount)) {
      return stop('error', `donateToFaction('${faction}', ${amount}) returned false after a successful probe`, { rep: after, target, check })
    }
    spent += amount

    const finalRep = ns.singularity.getFactionRep(faction)
    const hit = finalRep >= target
    stop(
      hit ? 'ok' : 'error',
      `donated $${spent.toExponential(4)} to ${faction}: ${Math.round(have)} -> ${Math.round(finalRep)} rep (target ${Math.round(target)})` +
        (hit ? '' : ' — SHORT, the measured rate did not hold'),
      { rep: finalRep, target, price: otherCost, money: ns.getPlayer().money, check },
    )
  } catch (err) {
    ns.print(record(errors, err))
    note('error', { result: 'error', detail: describe(err), spent })
    ns.tprint(`sing-donate: ERROR ${describe(err)}`)
  }
}
