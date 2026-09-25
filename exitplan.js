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
  const { money0 = 0, incomeAtLevel1, mult, exp0 = 0, expPerSec, maxHours = 1e4, extraAt = null } = o
  let stepH = o.stepH ?? 1 / 120
  if (!num(target) || target <= money0) return 0
  if (!pos(incomeAtLevel1) || !pos(mult) || !num(exp0)) return null
  let money = money0
  let exp = Math.max(0, exp0)
  let h = 0
  // THE STEP IS ADAPTIVE AND THE ITERATIONS ARE CAPPED. This runs on the
  // game's main thread inside every exit simulation, hundreds of times a
  // pass: at a fixed 30s step a slow leg was up to 1.2M iterations, and the
  // game froze (2026-09-25). The step is 1/200 of the leg's length at today's
  // rate (never below 30s), and the loop stops at 4000 iterations — the leg
  // is then reported as the maxHours it could not beat.
  {
    const lvl0 = levelAt(exp, mult)
    const r0 = (incomeAtLevel1 * (lvl0 + 50)) / 51 + (typeof extraAt === 'function' ? extraAt(0) : 0)
    const est = r0 > 0 ? (target - money) / r0 / 3600 : maxHours
    stepH = Math.max(stepH, Math.min(maxHours, est) / 200)
  }
  let iter = 0
  while (h < maxHours && iter++ < 4000) {
    const lvl = levelAt(exp, mult)
    // income(level) = incomeAtLevel1 * (level + 50) / 51
    const rate = (incomeAtLevel1 * (lvl + 50)) / 51 + (typeof extraAt === 'function' ? extraAt(h) : 0)
    // The last step lands exactly: without this the answer is quantised to
    // stepH, and a with/without comparison of a small spend reads as zero
    // (or as a whole step) — noise deciding purchases.
    if (money + rate * stepH * 3600 >= target) return h + (target - money) / rate / 3600
    money += rate * stepH * 3600
    exp += pos(expPerSec) ? expPerSec * stepH * 3600 : 0
    h += stepH
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
 * THE FIRST INSTALL, when it is the decision (the install gate): `firstInstallH`
 * is how long this life runs before it (0 = install now; default one cadence),
 * and `installGains` {hacking, rep, income} is what that batch multiplies —
 * hacking the level climb, rep the ground reputation rate and (through
 * faction_rep, donation.ts:8) the donation price, income the money legs. Later
 * installs carry the measured per-cycle hacking gain only; their rep and
 * income gains are priced at x1 — a floor, stated.
 *
 * Returns { hours, legs, mult } or { hours: null, why } — never a guess.
 */
/**
 * A sleeve term as a function of hours FROM NOW: `steps` [{atH, perSec}] (each
 * replaces the rate from its hour on) when given, else `perSec` from `delayH`.
 * Null input -> always 0.
 */
function sleeveRateFn(term) {
  if (!term) return () => 0
  if (Array.isArray(term.steps) && term.steps.length) {
    const st = term.steps.filter((x) => num(x?.atH) && num(x?.perSec) && x.perSec >= 0).sort((a, b) => a.atH - b.atH)
    return (t) => {
      let v = 0
      for (const x of st) if (x.atH <= t) v = x.perSec
      return v
    }
  }
  const S = pos(term.perSec) ? term.perSec : 0
  const D = num(term.delayH) && term.delayH > 0 ? term.delayH : 0
  return (t) => (t >= D ? S : 0)
}

/** The hours at which a step function can change, after `from`. */
function sleeveBreaks(term, from) {
  if (!term) return []
  if (Array.isArray(term.steps)) return term.steps.map((x) => x?.atH).filter((a) => num(a) && a > from).sort((a, b) => a - b)
  return num(term.delayH) && term.delayH > from ? [term.delayH] : []
}

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
    firstInstallH = null,
    installGains = null,
    extraIncome = null,
    eBudget = null,
    repBoost = null,
    sleeveExp = null,
    eRep = null,
    persistBaseline = null,
    perCycleExtra = null,
    lifeIncome = null,
  } = o
  // INCOME THAT THE NEXT INSTALL DESTROYS (lifeIncome, $/s): hacknet
  // production — hashes sold, or a node's money — from servers/nodes that
  // prestigeAugmentation deletes (PlayerObjectGeneralMethods.ts:130). It is
  // NOT hacking income, so it is not scaled by the (level + 50) shape. Under
  // "hold to the exit" (installsFirst 0) it runs on every money leg; under any
  // policy with an install it ends at the first one, before any leg this
  // function simulates — its value there is the money it adds at the install
  // point, which the caller prices (moneyAtW). The rebuilt hacknet of a later
  // life is not modelled: a floor.
  const lifeInc = installsFirst === 0 && pos(lifeIncome) ? lifeIncome : 0
  // SOMETHING EVERY LATER LIFE ALSO BUYS (perCycleExtra {hacking, rep, income,
  // fromInstall}): from install number `fromInstall` on, each install carries
  // these extra gains on top of the measured cadence — k NeuroFlux levels a
  // life once a faction's donation pipe is open, for instance. rep and income
  // act through eRep / eBudget like any persisting gain.
  const cycleExtraAt = (() => {
    if (!perCycleExtra) return () => 1
    // Per-install lifts (byInstall[j] multiplies install j+1, the first
    // included): a sequence of one-window money hauls, each lifting the
    // batch of the install that ends its window.
    if (Array.isArray(perCycleExtra.byInstall)) return (i) => (pos(perCycleExtra.byInstall[i]) ? perCycleExtra.byInstall[i] : 1)
    const f = (pos(perCycleExtra.hacking) ? perCycleExtra.hacking : 1) *
      (pos(perCycleExtra.rep) && num(eRep) && eRep > 0 ? Math.pow(perCycleExtra.rep, eRep) : 1) *
      (pos(perCycleExtra.income) && num(eBudget) && eBudget > 0 ? Math.pow(perCycleExtra.income, eBudget) : 1)
    const from = num(perCycleExtra.fromInstall) && perCycleExtra.fromInstall >= 1 ? perCycleExtra.fromInstall : 2
    return (i) => (i + 1 >= from ? f : 1)
  })()
  // INCOME THAT ARRIVES LATER (extraIncome [{atH, perSec}], absolute node
  // hours from now; each step REPLACES the extra from its hour on) — a gang
  // that starts earning when its karma grind ends, for instance. It feeds the
  // money legs at the hour they run, and, with eBudget (the planner's measured
  // dln(planM)/dln(money)), each later life's augmentation growth:
  // g x ((income + extra)/income)^eBudget for a cycle starting at that hour.
  const steps = Array.isArray(extraIncome) ? extraIncome.filter((x) => num(x?.atH) && num(x?.perSec) && x.perSec >= 0).sort((a, b) => a.atH - b.atH) : []
  const extraAt = (t) => {
    let v = 0
    for (const x of steps) if (x.atH <= t) v = x.perSec
    return v
  }
  // REPUTATION THAT RUNS FASTER ALL NODE (repBoost {K, e}): a sleeve working
  // factions beside the player multiplies the reputation every life earns by
  // K, and the planner measures what that buys as eRep = dln(planM)/dln(rep)
  // (progress.js, reputation arriving 50% faster) — so each later life's gain
  // is lifted by K^e, the reputation twin of eBudget.
  const repLift = repBoost && pos(repBoost.K) && repBoost.K >= 1 && num(repBoost.e) && repBoost.e > 0 ? Math.pow(repBoost.K, repBoost.e) : 1
  // repBoost.fromH: the lift starts with the first cycle beginning at or after
  // that hour (a sleeve that trains or recovers first adds its rep later).
  const repFrom = num(repBoost?.fromH) && repBoost.fromH > 0 ? repBoost.fromH : 0
  const growthAt = (t) => (t >= repFrom ? repLift : 1) * (num(eBudget) && eBudget > 0 && pos(incomePerSec) ? Math.pow((incomePerSec + extraAt(t)) / incomePerSec, eBudget) : 1)

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
  let incomeAtLevel1 = (incomePerSec * 51) / (hacking + 50)
  let repRate = repPerSec
  let donation = donationCost

  const legs = []
  let h = 0
  let mult = hackingMult
  let exp = hackingExp
  let cash = money

  if (installsFirst > 0) {
    const firstH = num(firstInstallH) && firstInstallH >= 0 ? firstInstallH : cycleHours
    h += firstH + (installsFirst - 1) * cycleHours
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
    const firstGain = pos(installGains?.hacking) && installGains.hacking >= 1 ? installGains.hacking : pos(nextInstallGain) && nextInstallGain >= 1 ? nextInstallGain : multGainPerCycle
    if (pos(installGains?.rep) && installGains.rep >= 1) {
      if (pos(repRate)) repRate *= installGains.rep
      if (pos(donation)) donation /= installGains.rep
    }
    if (pos(installGains?.income) && installGains.income >= 1) incomeAtLevel1 *= installGains.income
    // AUGMENTATIONS PERSIST: the batch's reputation and income gains act in
    // EVERY later life, so each later install buys more — by the measured
    // responses (eRep, eBudget) of the planner's own batch to reputation and
    // money, the same K^e lift repBoost and extraIncome use. Unmeasured, no
    // lift (a floor).
    // RELATIVE TO THE PLAN THE CADENCE ALREADY REPRESENTS: the measured
    // per-life growth embeds a typical batch's own rep and income flywheel,
    // so only a batch's gain BEYOND the current plan's (persistBaseline, the
    // gains exitInputsOf was built with) lifts later lives. Applying the full
    // gain double-counted the baseline: live 2026-09-24 it priced the exit at
    // 15.5h against 66h the pass before. No baseline, no lift.
    const ratio = (k) => (pos(installGains?.[k]) && pos(persistBaseline?.[k]) ? installGains[k] / persistBaseline[k] : 1)
    const persistLift =
      (num(eRep) && eRep > 0 ? Math.pow(ratio('rep'), eRep) : 1) *
      (num(eBudget) && eBudget > 0 ? Math.pow(ratio('income'), eBudget) : 1)
    // Cycle by cycle, so a later-arriving income can lift the cycles after it.
    mult = hackingMult * firstGain * (Array.isArray(perCycleExtra?.byInstall) ? cycleExtraAt(0) : 1)
    for (let i = 1; i < installsFirst; i++) mult *= multGainPerCycle * growthAt(firstH + (i - 1) * cycleHours) * persistLift * cycleExtraAt(i)
    exp = 0
    cash = 1262 // PlayerObjectGeneralMethods.ts:102
    legs.push({ leg: 'install cycles', hours: firstH + (installsFirst - 1) * cycleHours, detail: `first after ${firstH.toFixed(2)}h, then ${installsFirst - 1} x ${cycleHours.toFixed(2)}h, mult ${hackingMult.toFixed(2)} -> ${mult.toFixed(2)}` })
  }

  // The exp rate can rise mid-window (a Covenant sleeve's transfer), so the
  // legs read this rather than the input.
  let expRate = expPerSec
  // The batch's hacking_exp scales the player's own exp from the install on.
  if (installsFirst > 0 && pos(installGains?.exp) && installGains.exp >= 1 && pos(expRate)) expRate *= installGains.exp
  const moneyLeg = (target) => {
    const t0 = h
    return hoursToMoney(target, { money0: cash, incomeAtLevel1, mult, exp0: exp, expPerSec: expRate, extraAt: steps.length || lifeInc ? (rel) => (steps.length ? extraAt(t0 + rel) : 0) + lifeInc : null })
  }
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
    const fleetOn = !!sleeveRep && (pos(sleeveRep.perSec) || (Array.isArray(sleeveRep.steps) && sleeveRep.steps.some((x) => pos(x?.perSec))))
    const sRep = sleeveRateFn(fleetOn ? sleeveRep : null)
    let r = hoursToRep(terminalRep, { rep0: exitRep, repPerSec: fleetOn ? (pos(repRate) ? repRate : 0) + sRep(h) : repRate, donationCost: donation, favor: exitFavor, favorToDonate, moneyLeg })
    // GROUND REPUTATION AS A TRAJECTORY. Faction-work rep is linear in the
    // player's hacking level (reputation.ts:16), and after an install the
    // level restarts from 1 and climbs as exp accrues — so the rep leg runs
    // at repPerSec x level(t)/level-now, not at today's rate. The sleeve's
    // term is not scaled (sleeves keep their skills across installs) and
    // joins at its delayH, measured FROM NOW like sleeveExp. Integrated in
    // two-minute steps; the last lands exactly.
    if (r.how === 'ground' && (fleetOn || installsFirst > 0)) {
      const P = pos(repRate) ? repRate : 0
      const legStart = h
      const need = terminalRep - exitRep
      const scale = installsFirst > 0 && pos(hacking) ? (e) => levelAt(e, mult) / hacking : () => 1
      // Adaptive step (1/300 of the leg at today's rate, never below 2 min)
      // and a hard iteration cap — see hoursToMoney: this froze the game.
      const r0 = P * scale(exp) + sRep(legStart)
      const est = r0 > 0 ? need / r0 / 3600 : 1e4
      const step = Math.max(1 / 30, Math.min(1e4, est) / 300)
      let acc = 0
      let t = 0
      let e = exp
      let iter = 0
      for (;;) {
        if (t > 1e4 || iter++ > 3000) {
          t = Infinity
          break
        }
        // Land exactly on the sleeve's next rate change inside this step.
        const nb = sleeveBreaks(fleetOn ? sleeveRep : null, legStart + t)[0]
        const dt = typeof nb === 'number' && nb - (legStart + t) < step ? Math.max(1e-9, nb - (legStart + t)) : step
        const rate = P * scale(e) + sRep(legStart + t)
        const add = rate * dt * 3600
        if (rate > 0 && acc + add >= need) {
          t += (need - acc) / rate / 3600
          break
        }
        acc += add
        e += pos(expRate) ? expRate * dt * 3600 : 0
        t += dt
      }
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
  // The sleeve's exp as its own term (sleeveExp {perSec, delayH}, delayH from
  // NOW): it joins the climb only once its delay has passed — the synchronise,
  // shock recovery or training it spends first. Piecewise, like sleeveRep.
  let climb
  const expOn = !!sleeveExp && (pos(sleeveExp.perSec) || (Array.isArray(sleeveExp.steps) && sleeveExp.steps.some((x) => pos(x?.perSec))))
  if (expOn) {
    // Segment by segment between the sleeve's rate changes: constant rate in
    // each, so each lands exactly.
    const need = expForLevel(exitLevel, mult)
    const P = pos(expRate) ? expRate : 0
    const sExp = sleeveRateFn(sleeveExp)
    if (!pos(mult)) climb = null
    else if (need <= 0) climb = 0
    else {
      let acc = 0
      let t = h
      climb = Infinity
      for (const b of [...sleeveBreaks(sleeveExp, h), Infinity]) {
        const rate = P + sExp(t)
        const span = b - t
        if (rate > 0 && acc + rate * span * 3600 >= need) {
          climb = t - h + (need - acc) / rate / 3600
          break
        }
        if (!isFinite(span)) break
        acc += rate * span * 3600
        t = b
      }
    }
  } else climb = hoursToLevel(exitLevel, mult, 0, expRate)
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
// Memo: many callers in one pass simulate identical inputs. Keyed on the
// inputs' JSON (functions excluded, as JSON drops them); bounded.
const policyMemo = new Map()
export function bestExitPolicy(o = {}, maxInstalls = 400, minInstalls = 0) {
  let key = null
  try {
    key = `${maxInstalls}|${minInstalls}|${JSON.stringify(o)}`
  } catch {
    key = null
  }
  if (key !== null && policyMemo.has(key)) return policyMemo.get(key)
  const tried = []
  let best = null
  let worse = 0
  for (let k = minInstalls; k <= maxInstalls; k++) {
    const r = exitHours({ ...o, installsFirst: k })
    tried.push({ installsFirst: k, hours: r.hours, why: r.why ?? null })
    if (num(r.hours) && (best === null || r.hours < best.hours)) {
      best = { ...r, installsFirst: k }
      worse = 0
    } else if (best !== null && num(r.hours)) {
      // Past the optimum the exit only grows (each install adds a cycle and a
      // near-constant gain): stop after 15 installs in a row fail to beat it.
      if (++worse >= 15) break
    }
  }
  const out = !best
    ? { best: null, tried, why: tried[0]?.why ?? 'no policy could be priced' }
    : { best, tried, atSearchEdge: best.installsFirst === maxInstalls, searchedTo: tried[tried.length - 1]?.installsFirst ?? maxInstalls }
  if (key !== null) {
    if (policyMemo.size > 500) policyMemo.clear()
    policyMemo.set(key, out)
  }
  return out
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
/**
 * THE ENDPOINT MODEL for exit simulations: the node's measured ln(M) growth
 * per hour and the cadence it came at, over the SAME lives.
 *
 * Why not cycleStats: its median per-install gain discards the lives that do
 * the work — the multiplier grows in occasional large batches between runs of
 * count-ticket and near-empty lives, so the median ratio sits near 1 (BN10,
 * 2026-09-24: 1.05) while the node actually grew x2.8 in 48.9h. Fed the
 * median, the exit priced at 1e39-1e43 hours, and every trajectory
 * comparison built on it was comparing noise. nodeplan.compoundGain had the
 * geometric mean right but paired it with the MEDIAN life length, which the
 * many 20-minute ticket lives drag down; gain and cadence must come from the
 * same lives, so this uses total ln growth over total hours and the MEAN
 * life length, and derives the per-install gain from the two.
 *
 * { cycleHours, multGainPerCycle, lnPerHour, n } or null below minN lives or
 * when the multiplier did not grow (a rate of zero is not an endpoint model).
 */
export function endpointCycleStats(ledger, bitNode, { minN = 3 } = {}) {
  if (!Array.isArray(ledger)) return null
  const lives = ledger.filter((e) => e && e.bitNode === bitNode && pos(e.lifeH) && pos(e.hackMult))
  if (lives.length < minN) return null
  const grown = lives.slice(1)
  const hours = grown.reduce((t, e) => t + e.lifeH, 0)
  const ratio = lives[lives.length - 1].hackMult / lives[0].hackMult
  if (!pos(hours) || !(ratio > 1)) return null
  const lnPerHour = Math.log(ratio) / hours
  const cycleHours = hours / grown.length
  return { cycleHours, multGainPerCycle: Math.exp(lnPerHour * cycleHours), lnPerHour, n: lives.length, from: lives[0].hackMult, to: lives[lives.length - 1].hackMult, hours }
}

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

/**
 * A SPEND, trajectory against trajectory: the node's exit if $cost is spent
 * now for +gainPerSec income, against the exit if it is not — on one input set.
 *
 *   o.inputs      exitInputsOf's object (the without-run is exactly this)
 *   o.W           hours until the next install the plan intends (the gate's
 *                 choice: 0 = now, a wait, or null with o.finalWindow)
 *   o.finalWindow true when no install is coming (the gate holds forever):
 *                 the spend and its income ride the final window to the exit
 *   o.persists    true when the income survives installs (home RAM, cores);
 *                 false for anything an install destroys (cloud, hacknet)
 *   o.moneyAt(h)  money on hand h hours from now without the spend
 *   o.gainsAt(m)  installGains of the batch the planner buys with $m (null ok)
 *
 * In-life income only changes the money at the install, i.e. the batch that
 * install can buy — which is exactly where a spend can crowd out
 * augmentations, and so is priced by re-planning, not by a claim.
 * Returns { deltaH, withH, withoutH } or { deltaH: null, why }.
 */
export function spendExit(o = {}) {
  const { inputs, cost, gainPerSec, persists = false, finalWindow = false } = o
  if (!inputs || !pos(cost) || !num(gainPerSec) || gainPerSec < 0) return { deltaH: null, why: 'spend unreadable (cost or gain)' }
  if (finalWindow) {
    const without = bestExitPolicy(inputs, 0, 0)
    const withS = bestExitPolicy({ ...inputs, money: Math.max(0, (inputs.money ?? 0) - cost), incomePerSec: inputs.incomePerSec + gainPerSec }, 0, 0)
    if (!without.best || !withS.best) return { deltaH: null, why: `final window unpriced: ${without.why ?? withS.why}` }
    return { deltaH: withS.best.hours - without.best.hours, withH: withS.best.hours, withoutH: without.best.hours }
  }
  const W = o.W
  if (!num(W) || W < 0 || typeof o.moneyAt !== 'function') return { deltaH: null, why: 'install point or money trajectory unreadable' }
  const m0 = o.moneyAt(W)
  const m1 = m0 - cost + gainPerSec * W * 3600
  const gainsAt = typeof o.gainsAt === 'function' ? o.gainsAt : () => null
  const exitWith = (m, extraIncome) => {
    const g = m >= 0 ? gainsAt(m) : null
    if (m < 0) return { best: null, why: 'the spend is not affordable by the install' }
    return bestExitPolicy({ ...inputs, incomePerSec: inputs.incomePerSec + extraIncome, firstInstallH: W, ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) }, 400, 1)
  }
  // Income that persists also buys more augmentations in EVERY later life:
  // the planner measures that response as eBudget = dln(planM)/dln(money)
  // (progress.js, the plan re-run at x1.5 money), so a later life's gain
  // becomes g x K^eBudget at income xK. Unmeasured, it is left out — the
  // verdict is then a floor, and says so.
  const K = persists && gainPerSec > 0 ? (inputs.incomePerSec + gainPerSec) / inputs.incomePerSec : 1
  const e = num(o.eBudget) && o.eBudget >= 0 ? o.eBudget : null
  const without = exitWith(m0, 0)
  const withS = (() => {
    const r = exitWith(m1, persists ? gainPerSec : 0)
    if (!(K > 1) || e === null || !pos(inputs.multGainPerCycle)) return r
    const g = inputs.multGainPerCycle * Math.pow(K, e)
    const gAt = m1 >= 0 ? gainsAt(m1) : null
    return m1 < 0 ? r : bestExitPolicy({ ...inputs, incomePerSec: inputs.incomePerSec + gainPerSec, multGainPerCycle: g, firstInstallH: W, ...(gAt ? { installGains: gAt, nextInstallGain: gAt.hacking } : {}) }, 400, 1)
  })()
  if (!without.best || !withS.best) return { deltaH: null, why: `unpriced: ${without.why ?? withS.why}` }
  return {
    deltaH: withS.best.hours - without.best.hours,
    withH: withS.best.hours,
    withoutH: without.best.hours,
    ...(persists && K > 1 && e === null ? { floor: 'later lives priced without the augmentation-growth response (eBudget unmeasured)' } : {}),
  }
}

/**
 * WITH AND WITHOUT A SPEND, from progress.js's published exit inputs
 * (/tel/exitinputs.txt): the two input sets for "spend $spent now" against
 * "don't", for scripts that cannot re-plan themselves (gang.js).
 *   - final window (no install coming): the spend leaves the money short.
 *   - otherwise: the next install at W buys the batch the planner priced at
 *     moneyAtW - spent, interpolated geometrically between the published
 *     ladder's levels.
 * Null when the record carries no install point or ladder.
 */
export function spendRuns(record, spent, o = {}) {
  const base = record?.inputs
  // A NEGATIVE spend is money gained (hashplan.js: hashes sold, a contract's
  // reward) and is refused unless the caller says so, so a sign error in an
  // existing caller cannot silently price a cost as a windfall.
  if (!base || !num(spent) || (spent < 0 && o.allowGain !== true)) return null
  if (record.finalWindow === true) return { without: { ...base }, with: { ...base, money: Math.max(0, (base.money ?? 0) - spent) }, max: 0, min: 0 }
  if (!num(record.W) || record.W < 0 || !num(record.moneyAtW) || !Array.isArray(record.gainsByMoney) || !record.gainsByMoney.length) return null
  // Between two ladder levels, interpolated geometrically per channel (gains
  // multiply), so a spend is charged its crowding-out, not the next level
  // down. Below the lowest level: that level; above the highest: the highest.
  const ladder = [...record.gainsByMoney].filter((r) => num(r?.money) && r?.gains).sort((a, b) => a.money - b.money)
  const gAt = (m) => {
    if (!ladder.length) return null
    if (m <= ladder[0].money) return ladder[0].gains
    for (let i = 1; i < ladder.length; i++) {
      const lo = ladder[i - 1]
      const hi = ladder[i]
      if (m <= hi.money) {
        const f = hi.money > lo.money ? (m - lo.money) / (hi.money - lo.money) : 1
        const out = {}
        for (const k of new Set([...Object.keys(lo.gains), ...Object.keys(hi.gains)])) {
          const a = pos(lo.gains[k]) ? lo.gains[k] : 1
          const b = pos(hi.gains[k]) ? hi.gains[k] : 1
          out[k] = Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a)))
        }
        return out
      }
    }
    return ladder[ladder.length - 1].gains
  }
  const inputsWith = (g) => ({ ...base, firstInstallH: record.W, ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) })
  return { without: inputsWith(gAt(record.moneyAtW)), with: inputsWith(gAt(record.moneyAtW - spent)), max: 400, min: 1 }
}

/**
 * A spend with an income stream, from the published exit inputs, for callers
 * that cannot re-plan themselves: the exit if $cost is paid now for
 * +gainPerSec from now on (spendRuns takes the price out of the next batch or
 * the final window; the income rides extraIncome through eBudget) against the
 * exit if not. { deltaH, withH, withoutH } or { deltaH: null, why }.
 */
export function spendExitFromRecord(record, lastAugReset, cost, gainPerSec, now = Date.now()) {
  if (!record?.inputs || record.lastAugReset !== lastAugReset || !(now - Date.parse(record.at) < 15 * 60e3)) return { deltaH: null, why: 'no fresh exit inputs' }
  if (!num(cost) || cost < 0 || !num(gainPerSec) || gainPerSec < 0) return { deltaH: null, why: 'cost or income unreadable' }
  const runs = spendRuns(record, cost)
  if (!runs) return { deltaH: null, why: 'the exit inputs carry no install point or batch ladder' }
  const e = { eRep: record.eRep, eBudget: record.eBudget }
  const without = bestExitPolicy({ ...runs.without, ...e }, runs.max, runs.min)?.best?.hours
  const withS = bestExitPolicy({ ...runs.with, ...e, extraIncome: [{ atH: 0, perSec: gainPerSec }] }, runs.max, runs.min)?.best?.hours
  if (!num(without) || !num(withS)) return { deltaH: null, why: 'an exit could not be priced' }
  return { deltaH: withS - without, withH: withS, withoutH: without }
}
