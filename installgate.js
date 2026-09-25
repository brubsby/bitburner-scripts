// Should we install the queued augmentations *now*? Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// THE FACT THAT DECIDES THIS, and which the first version of this file missed
//
// Skill level is (PersonObjects/formulas/skill.ts:13)
//
//     level = mult * (32 * ln(exp + 534.6) - 200)
//
// LINEAR in the multiplier, LOGARITHMIC in experience. Leaving BitNode 4 needs
// hacking 9000 — w0r1d_d43m0n's base 3000 scaled by WorldDaemonDifficulty = 3
// (ServerHelpers.ts:423). Inverting the formula at mult = 1:
//
//     level 2500  ->  4.4e36 exp
//     level 9000  ->  7.2e124 exp      ~1e116 years at any rate we will ever have
//
// and at a hacking multiplier of 10x the same level 9000 needs 8.5e14 exp, which
// is ordinary. So experience is not the constraint and never was: **the hacking
// multiplier is the entire game**, and multipliers come only from installing
// augmentations. An install resets exp to zero (Prestige.ts:86 sets skills back
// to 1), but exp is worth only its logarithm, so that is a cheap price for a
// permanent linear gain.
//
// The first version of this file had it backwards. It treated an install as a
// destructive act to be justified against a grind, and its floor on the life's
// age made the effective threshold `M > 1.5` in every situation. In a node that
// can only be left by multiplying, a gate that refuses to install is not
// conservative — it is the failure mode. It would have held forever while the
// run ground experience that cannot, even in principle, reach the target.
//
// ---------------------------------------------------------------------------
// THE MODEL
//
// Suppose a life of length A ends in an install that multiplies the relevant
// multipliers by M. After k such cycles the multiplier is M^k and the level is
// M^k * f(exp), with f the logarithmic term above. Reaching L needs
//
//     k >= ln(L / f(exp)) / ln(M)        so       total time = A * k
//
// so the total time to reach L is
//
//     T(A) = A * ln(L / f(E(A))) / ln(M(A))
//
// and BOTH halves depend on A. This is where the second version of this file
// went wrong: it minimised only `A / ln(M)`, treating the experience term as a
// constant. That objective has no interior minimum — it is improved by making A
// smaller without limit — and the live run did exactly that, installing a
// single NeuroFlux three times in under an hour, resetting hacking to 1 each
// time. Optimising half of an expression is not a simplification, it is a
// different problem with a degenerate answer.
//
// Keeping the experience term, the rule compares INSTALLING NOW against
// WAITING, on the only quantity the objective cares about:
//
//     rateNow  = ln(M)        / A
//     rateWait = ln(M_future) / (A + wait)
//     install  iff  expOk AND no reachable (M_future, wait) beats rateNow
//
// `M_future` comes from augplan.js pricing a projected budget, so it is what
// waiting could ACTUALLY buy, not a guess.
//
// THE HISTORY OF THIS FILE IS THE ARGUMENT FOR THAT SHAPE. Two earlier rules
// both asked a question about the PAST and both shipped a live regression:
//
//   v1  payback horizon, H* = A/(M-1) < T. Its floor on A made the threshold
//       M > 1.5 in every situation — in a node that can only be left by
//       multiplying, a gate that refuses to install IS the failure.
//   v2  marginal-versus-average on ln(M)/A. `marginal` was measured across one
//       five-minute sample, and augmentation purchases are lumpy, so any
//       ordinary gap between them read as "accumulation has stopped". It
//       installed a single NeuroFlux (M = 1.0303) three times in four hours;
//       hacking went 260 -> 183 across them while the multiplier gained 7%.
//   v2a a three-sample stall timer. That only DELAYED the same bad trade: it
//       still could not tell a quiet window from a finished cycle.
//
// Neither could answer the question that decides it — *would waiting buy more?*
// That is not knowable from the past at all, which is why the fix is an input
// rather than a better statistic.
//
// WHAT IS STILL NOT PRICED, stated plainly rather than discovered later:
//   - the rebuild is charged only as A, the life's age. That is a real
//     measurement (it is how long this capability took to build) but it does
//     not separate the parts that rebuild fast from the parts that do not.
//   - Go node power is destroyed by every install (Go.ts:34-47 zeroes it),
//     taking the accumulated faction_rep bonus with it. Nothing here models it.
//   - reputation is not projected forward, only money is. A faction threshold
//     about to be crossed is invisible to `futures`.
// All three bias toward installing too eagerly, which is the direction that has
// cost us before.

/**
 * Multipliers that matter, and why these and not others.
 *
 * `hacking` leads because the exit condition scales with it LINEARLY — it
 * decides whether level 9000 is reachable at all. The rest are the factors that
 * multiply the income and reputation rates INDEPENDENTLY of each other:
 *
 *     income  ~  money_per_hack x hacks_per_second x success_rate
 *                (hacking_money)  (hacking_speed)   (hacking_chance)
 *
 * so all three belong, and `hacking_grow` belongs for the same reason one step
 * removed — it sets how fast a drained target refills, which bounds sustained
 * income. `faction_rep` is the currency that buys augmentations at all.
 *
 * THE BASKET USED TO BE hacking/hacking_money/faction_rep ONLY, and that was
 * too narrow. Measured against the game's own augmentation table:
 *
 *   HiveMind, Neuralstimulator      scored ZERO despite real value
 *   CranialSignalProcessors G4/G5   undervalued 2.33x / 2.15x
 *   QLink, BigDsBigBrain            undervalued 1.83x / 2.00x
 *   NeuroFlux Governor              undervalued 2.00x
 *
 * Note the last line: NeuroFlux touches EVERY channel, so a wider basket lifts
 * it too. The correction is relative — a concentrated augmentation gains up to
 * 133% where NeuroFlux gains 100% — so this narrows a bias toward NeuroFlux
 * rather than eliminating it. Worth stating plainly, because the intuition that
 * prompted the change ("we overvalue NeuroFlux") is right in direction and
 * about 17% in size.
 *
 * STILL EXCLUDED: hacking_exp. Skill level is `mult * (32*ln(exp+534.6) - 200)`
 * (skill.ts:13), logarithmic in experience, so an experience multiplier is
 * worth only its log — genuinely near-worthless against this objective, unlike
 * the rate channels above. That is an argument from the formula, not a
 * preference, and it is the one exclusion this file will defend.
 */
export const RATE_CHANNELS = ['hacking', 'hacking_money', 'hacking_speed', 'hacking_chance', 'hacking_grow', 'faction_rep']

/** The smallest ticket batch the count gate will install for, unless fewer
 *  than this remain to be banked. See shouldInstall's COUNT BATCH block: it is
 *  an anti-thrash floor, stated as a policy rather than derived. */
export const COUNT_MIN_BATCH = 3

/**
 * Combine per-augmentation multiplier objects into one progress factor.
 *
 * WEIGHTS, when given, are per-channel exponents: M = Π channel^w — the
 * hacking-mult-EQUIVALENT of the purchase, with objective.js deriving each w
 * as that channel's measured transmission into remaining-run progress,
 * normalised so `hacking` (the exit condition's own axis) is exactly 1. With
 * no weights every channel gets exponent 1 — the flat basket this file
 * carried before the transmissions were measurable, and the explicit
 * fallback whenever derivation refuses. A weight that is absent or
 * unreadable for a channel falls back to 1 for that channel rather than 0:
 * silently zeroing a channel is how HiveMind and Neuralstimulator went
 * unpriced for two days.
 */
export function progressFactor(statsList, channels = RATE_CHANNELS, weights = null) {
  let M = 1
  for (const stats of statsList ?? []) {
    if (!stats) continue
    for (const ch of channels) {
      const v = stats[ch]
      // A stats object only carries the fields its augmentation touches, so an
      // absent channel is 1. Treating absence as 0 would make every
      // augmentation look catastrophic and the gate would never fire.
      if (typeof v === 'number' && isFinite(v) && v > 0) {
        const w = weights ? weights[ch] : 1
        M *= typeof w === 'number' && isFinite(w) && w >= 0 ? Math.pow(v, w) : v
      }
    }
  }
  return M
}

/** Level from experience and multiplier — the game's own formula (skill.ts:13). */
export const skillFromExp = (exp, mult = 1) => Math.max(1, Math.floor(mult * (32 * Math.log(exp + 534.6) - 200)))

/** Experience needed for a level at a given multiplier (skill.ts:19). */
export const expForSkill = (skill, mult = 1) => Math.exp((skill / mult + 200) / 32) - 534.6

/**
 * The multiplier needed to reach `target` given the experience realistically
 * bankable in one life. This is the number the whole run is chasing, and it is
 * published so the objective is visible rather than implied.
 */
export function multiplierNeeded(target, exp) {
  const f = 32 * Math.log(Math.max(exp, 0) + 534.6) - 200
  return f > 0 ? target / f : Infinity
}

/**
 * The decision.
 *
 * @param {object} o
 * @param {number} o.ageMs   Date.now() - getResetInfo().lastAugReset — this life's age.
 * @param {number} o.M       progressFactor() over the queued augmentations.
 * @param {number} o.queued  how many augmentations are queued.
 * @param {object} [o.prev]  the previous sample `{ ageMs, M, stalledFor }`, persisted between runs.
 * @param {number} [o.exp]   current hacking experience — the experience term needs it.
 * @param {number} [o.target] the level that ends the BitNode. Defaults to 9000 (BN4).
 * @param {number} [o.favorGain] ratio of the post-install faction-work rate
 *                             multiplier to the current one, from reputation
 *                             banked converting to favour. >= 1; 1 means none.
 * @param {number} [o.goBonusPct] the IPvGO faction-reputation bonus, as a
 *                             PERCENT (go.js publishes `factionRepBonusPct`).
 *                             An install destroys it, so it divides M.
 * @param {object} [o.binding] objective.bindingGate's verdict — which exit gate
 *                             is outstanding and whether an install destroys
 *                             progress on it. Absent means no opinion.
 * @param {boolean} [o.terminal] the plan buys The Red Pill. Bypasses every rate
 *                             test — see the block comment at the M check. Pass
 *                             it ONLY for the augmentation that ends the node;
 *                             it is an override, not a hint.
 * @param {number} [o.rho] the ACHIEVABLE long-run rate, ln(M) per hour, from
 *                             scorecard.achievableRate over completed lives in
 *                             THIS BitNode. When present the stopping rule is
 *                             marginal-vs-rho; when absent it falls back to the
 *                             old average-vs-average form and says so in
 *                             `rhoSource`. Never pass a guess: a fabricated rho
 *                             decides when every future life ends.
 * @param {string} [o.rhoMeta] provenance for the number above, published verbatim.
 * NO minAgeMs, AND NO minStalls. Both are gone, and their absence is the
 * point: a floor on the life's age is a number nobody derived, standing in for
 * an argument nobody finished. This file's own JSDoc called minAgeMs
 * "belt-and-braces... NOT load-bearing" while it was, in fact, the only thing
 * holding the live run — which is what an undeclared constant does.
 *
 * Everything that decides now is derived from the objective:
 *   - the EXPERIENCE term, `f * ln(target/f) >= 32`, solved from the cycle
 *     equation at the top of this file rather than chosen;
 *   - MARGINAL vs RHO, the renewal-reward stopping rule, measured from
 *     completed lives in this BitNode;
 *   - the COUNT gate, read straight off the exit condition (30 distinct
 *     augmentations);
 *   - the FIRST-SAMPLE guard, which is arithmetic: a rate needs two points.
 *
 * The ramp that minAgeMs was crudely protecting is handled honestly by the
 * futures, which project 0.25h to 4h ahead — so "this life has not got going
 * yet" is answered by looking at what waiting would actually buy, instead of by
 * a fifteen-minute constant that is wrong for every life that is not fifteen
 * minutes long.
 */
export function shouldInstall(o) {
  // FIRST STATEMENT IN THE FUNCTION, and it has to stay that way. rho decides
  // WHICH stopping rule is in force — measured marginal-vs-rho, or the
  // average-vs-average fallback this file documents as getting more patient
  // the longer a life stalls — and every exit path must be able to say which.
  // base() and no() both omitted the fields, so the early "first sample this
  // cycle" return published no rho at all and telemetry could not distinguish
  // "rho was never supplied" from "we exited before reading it". Exactly the
  // case the fallback's own comment warns about: a fallback that is silent is
  // a fallback nobody audits.
  //
  // no() is called from the argument guards a few lines below, and base()/no()
  // close over these names, so declaring them any later puts those early
  // returns in the temporal dead zone: `Cannot access 'rho' before
  // initialization`, thrown at module load, which took 14 checks out of the
  // suite when this was first written five lines too low.
  const rho = typeof o?.rho === 'number' && isFinite(o.rho) && o.rho > 0 ? o.rho : null
  const rhoSource = rho !== null ? (o?.rhoMeta ?? 'measured') : 'fallback: no completed lives in this BitNode yet'

  const { ageMs, M, queued, prev } = o
  const exp = o.exp ?? 0
  const target = o.target ?? 9000
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0

  // Refusing is the safe direction for a MISSING reading, and every refusal
  // names what was missing. "I could not tell" must never encode as "it is
  // fine" (CLAUDE.md, "Failure must be loud").
  if (!num(queued) || queued < 1) return no('nothing is queued')
  if (!num(ageMs)) return no('life age is unreadable')
  if (!num(M)) return no(`the multiplier is unreadable (M=${M})`)

  // --- THE TERMINAL PLAN: the one install this gate must never refuse -------
  //
  // Every test below asks the same question — does installing buy more
  // multiplier per hour than waiting? That question is well-posed for every
  // augmentation except the one that ends the BitNode, and for that one it is
  // not merely wrong but INVERTED.
  //
  // The Red Pill has no multipliers at all (Augmentations.ts: no mults field).
  // augplan.js prices it with a synthetic selection value so the optimiser will
  // pick it, then subtracts that value back out of the reported M so the
  // synthetic number cannot contaminate a real one (augplan.js:911-916,984).
  // Both halves of that are right. The consequence is that a plan whose only
  // purchase is The Red Pill reports M = exp(0) = 1 exactly — and `M <= 1` used
  // to return `no` right here.
  //
  // So the gate refused the final install of the run, on the grounds that
  // finishing the BitNode does not raise the hacking multiplier. It does not.
  // That is the point of it. This is the same shape as the desk-guard deadlock
  // and the min-3-samples stall: a guard that blocks the exact thing it exists
  // to protect.
  //
  // Nothing is forfeited by installing here. Installing The Red Pill is not
  // the ending — backdooring w0r1d_d43m0n is — and augmentations bought after
  // it still install normally, so there is no bundling opportunity lost and no
  // way to strand the run. progress.js decides sprint-versus-more-installs
  // afterwards on its own arithmetic.
  const terminal = o.terminal === true

  // --- THE COUNT BATCH: the other install M says nothing about ---------------
  //
  // Daedalus needs N DISTINCT augmentations (DaedalusAugsRequirement, 30 here)
  // and they only count once INSTALLED — haveAugmentations reads
  // Player.augmentations, which a queued purchase is not in. So when the count
  // gate binds, augplan correctly plans "tickets": the cheapest distinct
  // augmentations, bought for the count and carrying no valued multiplier. It
  // labels them `kind: 'ticket'`, `m: 1`.
  //
  // And `M <= 1` refused every one of them, right here, before the count logic
  // below was ever read. A ticket batch has M = 1 by construction, so the gate
  // refused the one install the count gate needed — exactly the shape of the
  // Red Pill deadlock above, one gate to the left.
  //
  // Live in BitNode 10 on 2026-09-24: seven tickets planned, M = 1, countGain 7,
  // countShort 18, and NOTHING installed for 11.9 hours. It is worse than a
  // held install, because progress.js only BUYS inside `if (gate.install)` — so
  // the tickets were never even purchased, and the save showed zero queued
  // while the plan showed seven. The count had been frozen at 12 all that time,
  // on the gate that stands between the run and the exit.
  //
  // `countStalls` below HOLDS a zero-count install (the NeuroFlux treadmill).
  // Nothing could PERMIT a count install. This is that half.
  const countShortEarly = num(o.countShort) ? o.countShort : 0
  const countGainEarly = num(o.countGain) ? o.countGain : 0
  // A FLOOR, so the rule cannot thrash. Installing resets money to $1262 and
  // restarts the batcher, so a one-ticket batch planned on the first pass of a
  // new life would reset the money that was about to buy several more. Three,
  // or whatever is left if fewer than three remain — the batch that finishes
  // the gate is never refused for being small. A policy, not a proof: the
  // honest version prices "install now" against "wait for a bigger batch" in
  // count per hour, and nothing here does that yet.
  const countFloor = Math.min(COUNT_MIN_BATCH, Math.max(countShortEarly, 1))
  // A COUNT BATCH IS CONSIDERED whenever it would bank distinct augmentations
  // toward an outstanding gate, so it always reaches the decision below past
  // both early returns. Whether to install it NOW is a separate question:
  //
  //   PRICED — countplan.js's finite-horizon DP, against a fresh-life earnings
  //   curve MEASURED from completed lives (tel.js's ledger). It fills a batch
  //   in a mature life until the 1.9^n escalation outruns income, which is
  //   exactly where the floor went wrong: at three it installed, while money
  //   was flowing fast enough that adding up to ~seven was the faster path.
  //
  //   FLOOR — COUNT_MIN_BATCH, only while the curve is unmeasured. countplan
  //   REFUSES (installNow: null) until it has enough lives, because the first
  //   attempt at this guessed a fresh life's income 100x too high and concluded
  //   "install after every single ticket". An uncalibrated model driving an
  //   irreversible install is the failure CLAUDE.md is written against.
  const timing = o.countTiming ?? null
  const timingPriced = timing && (timing.installNow === true || timing.installNow === false)
  const countBanks = countShortEarly > 0 && countGainEarly > 0
  const countWants = timingPriced ? timing.installNow === true : countGainEarly >= countFloor
  const countDecidedBy = timingPriced ? 'priced' : 'floor'
  if (!terminal && !countBanks) {
    if (M <= 1) return no(`the queued augmentations give no gain on ${RATE_CHANNELS.join('/')} (M=${M})`, { countShort: countShortEarly, countGain: countGainEarly, countFloor })
  }

  // Both are pure functions of M and the life's age, so they are computed
  // BEFORE the early returns — base() publishes them on every path, and a
  // `const` declared after a `return` that calls base() is a TDZ error, not a
  // missing field. (Second time in this file; the first was `stalledFor`.)
  // --- THE GO REPUTATION BONUS: reported, NOT charged against M ------------
  //
  // IPvGO node power multiplies faction reputation (Go/effects/effect.ts:90)
  // and Go.prestigeAugmentation zeroes it on every install (Go/Go.ts:34-47), so
  // an install really does throw the accumulated bonus away. My first version
  // charged it as a divisor on M — `Meff = M / (1 + pct/100)` — and that was
  // WRONG, in the way that matters most: it deadlocked the run.
  //
  // The bonus REGROWS. Measured across this life: 9.98% ten minutes after an
  // install, 14.05% at 35 minutes, 62.58% at 6.1 hours — and the life was 6.1
  // hours old. It rebuilds on the same timescale as everything else. So:
  //
  //     before an install:            capability = mult * (1 + B)
  //     after it, once rebuilt:       capability = mult * M * (1 + B)
  //
  // The SAME B appears on both sides and cancels. What the install actually
  // costs is the transient while B regrows — and that is the rebuild, which is
  // precisely what `A` measures. Charging it again as a divisor double-counts
  // it, and because B grows without bound relative to any fixed haul, the bar
  // rises forever: at B = 62.5% an install needed M > 1.625 merely to break
  // even, and the gate refused nine augmentations worth M = 1.3587 while
  // hacking sat at 412 against the 9000 needed to leave. A node that can only
  // be exited by installing had been made unable to install.
  //
  // It also broke the arithmetic. With Meff < 1, ln(Meff) is NEGATIVE, and
  // `rateNow >= rateWait` compares two negative rates whose ordering no longer
  // means what the rule assumes (live: rateNow -0.0294 vs rateWait -0.0148).
  //
  // So the bonus is published for visibility and is NOT applied. If a future
  // BitNode makes it permanent — Go.ts:34-47 is the line to re-read — this is
  // where the divisor goes back.
  const goBonusPct = num(o.goBonusPct) ? o.goBonusPct : 0

  // --- WHAT THE INSTALL GAINS: faction favour --------------------------------
  //
  // The exact mirror of the Go bonus above, and the reason both belong here.
  // Reputation banked this life is converted to FAVOUR at the install
  // (Faction/formulas/favor.ts:22), favour survives every install, and it
  // multiplies all future faction work by `1 + favor/100`
  // (PersonObjects/formulas/reputation.ts:9).
  //
  //     Go node power   zeroed and REGROWS -> cancels, must not multiply M
  //     faction favour  granted and PERMANENT -> multiplies M
  //
  // Same channel, opposite treatment, and the test that separates them is the
  // same one: does it survive? So `favorGain` is the ratio of the post-install
  // rate multiplier to the current one, supplied by the caller for the faction
  // it intends to work next.
  //
  // This term REWARDS WAITING, which is worth noticing given that two earlier
  // versions of this file installed too eagerly: immediately after an install
  // reputation is ~0, so the gain is ~1 and contributes nothing; it grows only
  // as reputation banks up. It cannot manufacture a reason to install early.
  //
  // Horizon-free by construction — it is a ratio of two rates, not a value
  // integrated over remaining time, so it needs no estimate of how long the
  // BitNode has left.
  const favorGain = num(o.favorGain) && o.favorGain >= 1 ? o.favorGain : 1
  const Meff = M * favorGain

  // ln(M) per hour if we install now.
  const hours = ageMs / 3600000
  const rateNow = Math.log(Meff) / hours



  // The marginal rate needs two samples. Without a previous one there is no way
  // to tell whether purchases are still arriving, so WAIT — one cycle of delay,
  // and never an install decided on no evidence.
  //
  // `terminal` skips it, and the reason is worth stating because this guard is
  // the most defensible of the five: the question it answers is "are better
  // purchases still arriving?", and for the augmentation that ENDS the node
  // there is no better purchase for a second sample to discover. It was also
  // the guard a first attempt at the override missed — the M check and this one
  // are far apart in the file, so the test pins each separately.
  //
  // A COUNT BATCH skips it for the same reason, and it is the mistake this
  // comment predicts: the count override was first written against the M check
  // alone and still held every ticket batch here. "Are better purchases still
  // arriving?" is a multiplier-rate question. A ticket's value is that it is
  // DISTINCT, which the plan states directly; there is no rate for a second
  // sample to reveal, and batch size is the anti-thrash floor's job, not this
  // guard's. IG16 pins each guard separately, as the terminal case does.
  if (!terminal && !countBanks && (!prev || !num(prev.ageMs) || !num(prev.M) || prev.M <= 0 || ageMs <= prev.ageMs)) {
    return {
      ...base(),
      install: false,
      marginal: null,
      sample: { ageMs, M },
      why: `hold: first sample this cycle (M=${M.toFixed(4)}) — a second is needed to tell whether augmentations are still arriving`,
    }
  }

  // Only `terminal` can reach here without a previous sample, and the marginal
  // rate is undefined without one. It reports null rather than a number derived
  // from nothing — the decision does not consult it on that path, and a
  // fabricated rate would show up in telemetry as though it had been measured.
  const dt = prev ? (ageMs - prev.ageMs) / 3600000 : null
  const marginal = dt === null ? null : (Math.log(M) - Math.log(prev.M)) / dt

  // --- THE EXPERIENCE TERM ---------------------------------------------------
  //
  // `ln(M)/A` was minimised treating the experience half of the level equation
  // as fixed. Reaching level L needs `M^k * f(E(A)) >= L`, so a shorter cycle
  // shrinks f(E(A)) and needs MORE cycles; optimising only `A/ln(M)` drives A
  // toward zero, which is what produced three installs in four hours. With M
  // fixed, and using E ~ rho*A so A*E' = E, installing is worth it only once
  //
  //     g + A*g' >= 0   with g = ln(L/f)   <=>   f * ln(L/f) >= 32
  //
  // Honest about its strength: this is WEAK. It is satisfied by 1e2 experience,
  // so it blocks the opening seconds of a life and nothing else.
  const f = 32 * Math.log(Math.max(exp, 0) + 534.6) - 200
  const expOk = f > 0 && f * Math.log(target / f) >= 32

  // --- THE RULE: compare installing NOW against WAITING ----------------------
  //
  // Both previous versions asked a question about the PAST — "has accumulation
  // slowed?" — and neither could answer the one that matters: would waiting buy
  // more? A quiet five-minute window looks identical to a finished cycle, which
  // is why the stall timer only delayed the bad trade instead of preventing it.
  //
  // The objective is to maximise log-multiplier per unit time, so the decision
  // is a direct comparison of rates:
  //
  //     rateNow  = ln(M)       / A
  //     rateWait = ln(M_future) / (A + wait)
  //     install  iff  rateNow >= rateWait   for every wait considered
  //
  // `M_future` is not a guess. augplan.js prices what a projected budget could
  // actually buy — the caller supplies the best (M, wait) pair it found by
  // planning against `money + income * wait`. So the gate now knows the thing
  // it never knew: whether anything better is coming, and when.
  //
  // This subsumes the stall timer. A cycle with more augmentations reachable
  // has rateWait > rateNow and holds, however long it has been quiet; a cycle
  // with nothing left to buy has M_future == M, so rateWait < rateNow purely
  // because the denominator grew, and it installs on the first look.
  let rateWait = -Infinity
  let bestWait = null
  for (const cand of o.futures ?? []) {
    if (!num(cand?.waitMs) || !num(cand?.M) || cand.waitMs <= 0 || cand.M <= 1) continue
    // Waiting banks MORE reputation, so its favour gain is at least as large.
    // The caller supplies it per-future; absent, it falls back to the current
    // gain rather than 1, because assuming a future install forfeits favour it
    // would actually receive would bias toward installing now.
    const g = num(cand.favorGain) && cand.favorGain >= 1 ? cand.favorGain : favorGain
    const r = Math.log(cand.M * g) / ((ageMs + cand.waitMs) / 3600000)
    if (r > rateWait) {
      rateWait = r
      bestWait = cand
    }
  }
  // --- THE STOPPING RULE: marginal against rho, not average against average --
  //
  // A run is a renewal process — install, reset, rebuild — and what it wants to
  // maximise is the LONG-RUN average of ln(M) per hour, not this life's own
  // average. The optimal policy for that is marginal: keep accumulating while
  // the marginal rate of ln(M) exceeds the rate a fresh life sustains, and cash
  // in the moment it falls below. `rho` (scorecard.achievableRate) is that rate,
  // measured from completed lives IN THIS BITNODE.
  //
  // What this fixes is not a tuning error but a structural one. The average-vs-
  // average form below reduces to
  //
  //     ln(M_future)/ln(M_now)  >  1 + wait/A
  //
  // so as A grows the bar falls toward 1 and any improvement at all justifies
  // waiting. Every hour a life wastes therefore makes the gate MORE patient —
  // the opposite of what a stalled run needs, and self-reinforcing besides.
  // The marginal rule never mentions A, so no amount of dead time can move it.
  //
  // rho is null on the first life of a BitNode, by definition: there are no
  // completed lives to measure. That path keeps the old comparison and SAYS so
  // in `rhoSource`, because a fallback that is silent is a fallback nobody
  // audits.
  let marginalBest = null
  if (rho !== null) {
    for (const cand of o.futures ?? []) {
      if (!num(cand?.waitMs) || !num(cand?.M) || cand.waitMs <= 0 || cand.M <= 1) continue
      const g = num(cand.favorGain) && cand.favorGain >= 1 ? cand.favorGain : favorGain
      // The MARGINAL rate of this wait: reward it adds over the hours it costs.
      const r = (Math.log(cand.M * g) - Math.log(Meff)) / (cand.waitMs / 3600000)
      if (marginalBest === null || r > marginalBest) marginalBest = r
    }
  }
  const rateWaitBeats = rho !== null ? marginalBest !== null && marginalBest > rho : bestWait !== null && rateWait > rateNow
  // --- THE DECISION, WHEN THE EXIT CAN BE PRICED: trajectory against
  // trajectory (CLAUDE.md). progress.js simulates the node's exit for each
  // choice on one input builder — install now, install after each candidate
  // wait (with that wait's batch), and never install again — and the soonest
  // exit wins. The rate rule above (ln(M) per hour of this life, against rho)
  // is a shortcut of exactly the forbidden shape and survives only as the
  // named fallback for a pass whose exit cannot be priced.
  const ex = o.exitCompare
  const exitDecides = !!ex && typeof ex.nowH === 'number' && isFinite(ex.nowH) && ex.nowH > 0
  let exitWait = null
  if (exitDecides) {
    for (const w of ex.waits ?? []) {
      if (typeof w?.H === 'number' && isFinite(w.H) && (exitWait === null || w.H < exitWait.H)) exitWait = w
    }
  }
  const neverBest = exitDecides && typeof ex.neverH === 'number' && isFinite(ex.neverH) && ex.neverH < ex.nowH && !(exitWait && exitWait.H <= ex.neverH)
  const exitWaitBeats = exitDecides && exitWait !== null && exitWait.H < ex.nowH
  if (exitDecides) {
    bestWait = exitWait ? (o.futures ?? []).find((f) => f.waitMs === exitWait.waitMs) ?? null : null
  }
  const waitBeats = exitDecides ? exitWaitBeats || neverBest : rateWaitBeats
  const decidedBy = exitDecides ? 'exit-sim' : `rate-fallback (${ex?.why ?? 'no exit comparison supplied'})`
  // M <= 1 means the queued augmentations add nothing on the rate channels, so
  // there is no trade to make. This also keeps ln(M) positive, which the rate
  // comparison below depends on — a negative rate inverts the ordering and the
  // rule stops meaning what it says.
  const netGain = Meff > 1
  // `terminal` short-circuits every rate test, not just the M veto: no wait can
  // beat ending the BitNode, and the experience floor exists to stop installing
  // before a life has banked anything — a consideration that does not survive
  // contact with the last install of the run.
  // --- THE COUNT GATE: ln(M) that does not advance the exit is not progress --
  //
  // The objective is TIME TO LEAVE THE BITNODE, and ln(M) is only a proxy for
  // it — a proxy that stops being valid the moment the multiplier is no longer
  // what binds. Daedalus admits on 30 DISTINCT augmentations, and once the
  // hacking multiplier is already past the exit requirement, an install that
  // banks multiplier while adding no distinct augmentation moves the run zero
  // distance toward the exit. Its reward against the real objective is not
  // small, it is zero.
  //
  // It is worse than zero, in fact, which is why this holds rather than merely
  // discounting: every install RESETS faction reputation, and reputation is
  // precisely what buys the next distinct augmentation. So a zero-count install
  // destroys the thing the count gate is waiting on. Measured in BitNode 1 —
  // the distinct count after six consecutive installs:
  //
  //     17 -> 18 (+1) -> 18 (+0) -> 21 (+3) -> 21 (+0) -> 21 (+0) -> 21 (+0)
  //
  // Each of those lives banked ln(M) 0.59-0.95 in NeuroFlux, cleared this gate
  // honestly, reset reputation to zero, and left the exit exactly as far away
  // as before. A treadmill the objective scored as success every time.
  //
  // DEADLOCK IS THE OBVIOUS RISK and the escape is a real terminal condition,
  // not a timer: hold only while at least one distinct augmentation is still
  // REACHABLE LATER — the caller reports that from the plan's own `skipped`
  // list, which names every augmentation held back by reputation or money. If
  // nothing is reachable by waiting, waiting cannot help and the rate rule
  // stands unchanged. That is the same discipline the desk guard needed and
  // did not have: a hold must be able to state what would end it.
  const countShort = num(o.countShort) ? o.countShort : 0
  const countGain = num(o.countGain) ? o.countGain : 0
  const countStalls = countShort > 0 && countGain === 0 && o.countReachableLater === true

  // THE BINDING GATE. Installing is only progress while the multiplier is what
  // stands between the run and the door. Past that point an install DESTROYS
  // the resources the remaining gates are made of — money resets to $1262,
  // faction reputation to zero — so it is not a smaller gain, it is a loss.
  // objective.bindingGate decides which gate is outstanding; this only obeys.
  //
  // `gate: null` means the caller could not describe the exit state, and that
  // must read as NO OPINION rather than "nothing binds" — the whole failure
  // being fixed is an objective that confidently scored the wrong thing.
  const destructive = o.binding?.destroyedByInstall === true

  // THE COUNT INSTALL. Banks distinct augmentations toward a gate the exit
  // cannot pass without, whatever M is. `destructive` still vetoes it: if the
  // binding gate is one an install would destroy, banking count does not
  // outrank losing it.
  //
  // It deliberately does NOT wait on `countReachableLater`. That flag is true
  // whenever any skipped augmentation could be bought by waiting — and with a
  // gang generating reputation continuously it is true forever, which is the
  // deadlock the countStalls comment warns about: a hold that cannot state what
  // would end it. The floor above is the anti-thrash guard instead.
  const countInstall = countBanks && countWants && !destructive
  // expOk is the rate rule's own guard (enough exp to bank); the simulated
  // exit prices the climb itself, so it does not apply there.
  // A HOLD THE USER MANDATED outranks even the terminal install: The Red Pill
  // stays affordable, and installing mid-campaign resets the combat exp and
  // membership the campaign is building. Live 2026-09-25 the terminal rule
  // installed straight through the Covenant campaign (binding.mandated) and
  // destroyed ~$8.5q plus the campaign's progress.
  const mandateHold = o.binding?.destroyedByInstall === true && o.binding?.mandated === true
  const install = !mandateHold && (terminal || countInstall || ((exitDecides || expOk) && netGain && !waitBeats && !countStalls && !destructive))

  return {
    ...base(),
    install,
    terminal,
    marginal,
    expOk,
    f,
    goBonusPct,
    favorGain,
    Meff,
    rateWait: isFinite(rateWait) ? rateWait : null,
    bestWait,
    rho,
    rhoSource,
    marginal1: marginalBest,
    countShort,
    countGain,
    countStalls,
    countBanks,
    countInstall,
    countFloor,
    countWants,
    countDecidedBy,
    countTimingWhy: timing?.why ?? null,
    decidedBy,
    exitNowH: exitDecides ? ex.nowH : null,
    exitBestWaitH: exitWait?.H ?? null,
    exitNeverH: exitDecides && typeof ex.neverH === 'number' ? ex.neverH : null,
    holdForever: neverBest || undefined,
    binding: o.binding ?? null,
    destructive,
    mandateHold: mandateHold || undefined,
    why: mandateHold
      ? `hold: ${o.binding?.why ?? 'a mandated campaign is running'} — held even though ${terminal ? 'The Red Pill is queued' : 'the gate would install'}; it installs once the campaign completes`
      : terminal
      ? `install: THE RED PILL is in the plan (${queued} aug(s)) — the augmentation that ends the BitNode carries no multiplier, so M=${M.toFixed(4)} is expected and is NOT a reason to hold. Installing.`
      : countInstall && !(expOk && netGain && !waitBeats)
      ? `install: COUNT BATCH — ${countGain} distinct augmentation(s) toward the ${countShort} the exit still needs, ` +
        `decided by the ${countDecidedBy === 'priced' ? 'priced timing: ' + (timing?.why ?? '') : 'floor of ' + countFloor + ' (the timing is not yet priced: ' + (timing?.why ?? 'no timing supplied') + ')'}. ` +
        `M=${M.toFixed(4)} is expected for tickets and is NOT a reason to hold.`
      : countBanks && !countWants && !destructive && !(expOk && netGain && !waitBeats)
      ? `hold: COUNT BATCH of ${countGain} not yet — ` +
        (countDecidedBy === 'priced'
          ? `the priced timing says a bigger batch is faster: ${timing?.why ?? ''}`
          : `below the floor of ${countFloor}, and the timing is not yet priced (${timing?.why ?? 'no timing supplied'})`)
      : install && exitDecides
      ? `install: ${queued} aug(s) — the simulated exit installing now is ${ex.nowH.toFixed(1)}h, the best wait ${exitWait ? exitWait.H.toFixed(1) + 'h (' + (exitWait.waitMs / 3600000).toFixed(1) + 'h wait)' : 'unpriced'}, never installing ${typeof ex.neverH === 'number' ? ex.neverH.toFixed(1) + 'h' : 'unpriced'}`
      : !install && exitDecides && waitBeats && !destructive && !countStalls
      ? neverBest
        ? `hold: never installing again exits sooner (${ex.neverH.toFixed(1)}h) than installing now (${ex.nowH.toFixed(1)}h) — this is the final window`
        : `hold: waiting ${(exitWait.waitMs / 3600000).toFixed(1)}h then installing exits at ${exitWait.H.toFixed(1)}h, installing now at ${ex.nowH.toFixed(1)}h (simulated exits)`
      : install
      ? `install: ${queued} aug(s), M=${M.toFixed(4)} -> ${Meff.toFixed(4)} with the x${favorGain.toFixed(4)} favour gain (Go bonus ${goBonusPct.toFixed(1)}% regrows, so it is not charged). Installing now accumulates ${rateNow.toFixed(4)} ln(M)/h; nothing reachable beats it` +
        (bestWait ? ` (best wait ${(bestWait.waitMs / 3600000).toFixed(1)}h -> M=${bestWait.M.toFixed(4)} = ${rateWait.toFixed(4)}/h)` : ' (nothing further is reachable)')
      : destructive
        ? `hold: installing would DESTROY the gate the run is waiting on — ${o.binding?.why}. ` +
          `The multiplier is no longer what stands between this run and the exit, so ln(M)=${M.toFixed(4)} buys nothing and the reset costs everything.`
      : countStalls
        ? `hold: ${queued} aug(s) give M=${M.toFixed(4)} but ZERO distinct augmentations, and the exit needs ${countShort} more. ` +
          `Installing would bank the multiplier and reset the reputation that buys the next one — no distance toward Daedalus. ` +
          `Holding while at least one augmentation is still reachable by waiting.`
      : !netGain
        ? `hold: ${queued} aug(s) give M=${M.toFixed(4)} — no gain on ${RATE_CHANNELS.join('/')}`
        : !expOk
          ? `hold: ${queued} aug(s), M=${M.toFixed(4)}. Experience is too low to bank (f=${f.toFixed(1)}, need f*ln(target/f) >= 32)`
          : rho !== null
            ? `hold: ${queued} aug(s), M=${M.toFixed(4)}. The best wait still accumulates ${marginalBest.toFixed(4)} ln(M)/h at the margin, above the ${rho.toFixed(4)} ln(M)/h a fresh life sustains in this BitNode (${o.rhoMeta ?? 'measured'}) — keep accumulating`
            : `hold: ${queued} aug(s), M=${M.toFixed(4)}. Waiting ${(bestWait.waitMs / 3600000).toFixed(1)}h buys M=${bestWait.M.toFixed(4)} at ${rateWait.toFixed(4)} ln(M)/h, beating ${rateNow.toFixed(4)} now — keep accumulating (no rho yet: first life of this BitNode)`,
  }

  function base() {
    return { M, queued, ageMs, exp, target, rateNow, rho, rhoSource, sample: { ageMs, M } }
  }
  // `extra` so an early refusal can still publish the state that explains it.
  // The M<=1 return used to fire before the count was read, so /tel showed
  // countShort/countGain as NULL on exactly the path that was stalling on the
  // count — the evidence and the fault shared one early return.
  function no(why, extra = {}) {
    return {
      install: false,
      why: `hold: ${why}`,
      M,
      queued,
      ageMs,
      marginal: null,
      rho,
      rhoSource,
      sample: { ageMs, M: num(M) ? M : 1 },
      ...extra,
    }
  }
}

const hrs = (ms) => (isFinite(ms) ? `${(ms / 3600000).toFixed(1)}h` : 'forever')

/* ========================================================================= */

/**
 * How much of what the futures PROMISED actually arrived.
 *
 * WHY THIS HAS TO EXIST. The stopping rule weighs "install now" against
 * "install after waiting", and the wait side is a *projection* — planPurchases
 * run against a reputation and a bank balance that do not exist yet. Nothing
 * ever checked it. CLAUDE.md's rule is explicit that a model whose output
 * drives a decision must reproduce something the live game shows and print the
 * error before its conclusions are used; `incomeCalibration` does exactly that
 * for income and lands within 0.5%. The futures block drives the single most
 * important decision in the run and had no such check at all.
 *
 * Observed live, BitNode 5, first life: the gate reported
 *
 *   hold: 14 aug(s), M=1.8587. Waiting 0.3h buys M=3.1299 ...
 *
 * on pass after pass. Twenty-two minutes later BOTH projected inputs had been
 * exceeded — money +$3.06b against $1.57b projected, worked-faction reputation
 * +5,271 against 2,776 projected — and the plan's M had not moved off 1.8587.
 * The promised future was never reached and never will be: with M_future fixed
 * above M_now, the average-vs-average fallback (the `rho === null` path, taken
 * on the first life of every BitNode by definition) holds for all A > 0.30h,
 * and A was 20h. Zero installs in 20.78 hours.
 *
 * WHAT IS MEASURED, and why it is the GAIN and not the level. Comparing
 * predicted M against realised M would have scored the case above as
 * 1.8587/3.1299 = 0.59 — "somewhat optimistic" — when the honest reading is
 * that waiting delivered NOTHING: the realised gain over the baseline was 0
 * against a predicted gain of 1.2712. Scoring the gain gives trust = 0, which
 * collapses the adjusted future back onto the present and lets the rule fire.
 * A projection that does come true keeps trust near 1 and goes on deferring,
 * which is the behaviour we want to preserve.
 *
 * Fails OPEN on absence, deliberately: with no resolved sample there is nothing
 * measured, `trust` is null, and the caller must leave the futures alone and
 * say so. Inventing a number here would be the fabricated-calibration mistake
 * CLAUDE.md names twice.
 *
 * @param {Array} pending  [{dueAt, waitMs, predictedM, baselineM}] from the previous pass
 * @param {number} actualM the plan's M measured NOW
 * @param {number} now     epoch ms
 */
export function scoreFutures(pending, actualM, now, priorSamples = []) {
  const ln = Math.log
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const prior = Array.isArray(priorSamples) ? priorSamples.filter((s) => fin(s?.ratio)) : []
  if (!Array.isArray(pending) || !fin(actualM) || actualM <= 0 || !fin(now)) {
    return trustFrom(prior, [], 'no usable pending projections')
  }
  const samples = []
  for (const p of pending) {
    if (!fin(p?.dueAt) || p.dueAt > now) continue
    if (!fin(p?.predictedM) || !fin(p?.baselineM) || p.predictedM <= 0 || p.baselineM <= 0) continue
    const predictedGain = ln(p.predictedM) - ln(p.baselineM)
    // A projection that promised nothing cannot be scored for delivery.
    if (!(predictedGain > 1e-9)) continue
    const realisedGain = ln(actualM) - ln(p.baselineM)
    samples.push({
      waitMs: p.waitMs,
      predictedM: p.predictedM,
      baselineM: p.baselineM,
      actualM,
      predictedGain,
      realisedGain,
      // Clamped: over-delivery is not evidence that the NEXT projection is
      // better than perfect, and a negative realisation (M fell) is zero
      // delivery, not negative delivery.
      ratio: Math.max(0, Math.min(1, realisedGain / predictedGain)),
    })
  }
  return trustFrom(prior, samples, 'no projection has come due yet')
}

/**
 * Trust is the median delivery over a ROLLING history, not just the
 * projections that happened to mature on this one pass.
 *
 * Keeping history matters for the same reason the carry-forward does: passes
 * run every few minutes and horizons are 15 minutes and up, so any single pass
 * usually matures nothing. Recomputing from scratch each time would throw the
 * measurement away as fast as it was made and leave trust permanently null —
 * which is exactly the bug the first version of this shipped with.
 */
function trustFrom(prior, fresh, whyEmpty) {
  const all = [...prior, ...fresh].slice(-8)
  if (!all.length) return { samples: [], trust: null, source: `${whyEmpty} — futures left unadjusted` }
  const rs = all.map((s) => s.ratio).sort((a, b) => a - b)
  const mid = Math.floor(rs.length / 2)
  const trust = rs.length % 2 ? rs[mid] : (rs[mid - 1] + rs[mid]) / 2
  return {
    samples: all,
    trust,
    source: `median delivery over ${all.length} matured projection(s)${fresh.length ? `, ${fresh.length} new this pass` : ' (carried)'}`,
  }
}

/**
 * Shrink each future toward the present by how much projections actually
 * deliver. trust = 1 leaves them untouched; trust = 0 collapses every future
 * onto M_now, so no wait can beat installing and the rule decides on what is
 * real. Applied in LOG space because the whole rule is about ln(M).
 */
export function discountFutures(futures, baselineM, trust) {
  if (!Array.isArray(futures)) return []
  if (typeof trust !== 'number' || !isFinite(trust) || trust >= 1) return futures
  if (!(typeof baselineM === 'number' && isFinite(baselineM) && baselineM > 0)) return futures
  const t = Math.max(0, trust)
  return futures.map((f) => {
    if (!(typeof f?.M === 'number' && isFinite(f.M) && f.M > 0)) return f
    const adjusted = Math.exp(Math.log(baselineM) + t * (Math.log(f.M) - Math.log(baselineM)))
    return { ...f, M: adjusted, MUndiscounted: f.M, trustApplied: t }
  })
}

/**
 * Build the projection list to publish this pass: everything still pending,
 * plus this pass's own projections.
 *
 * Pure and exported so it can be TESTED. The first version of this lived
 * inline in progress.js and simply overwrote the list each pass, so no
 * projection survived the ~5 minutes to its own 15-minute horizon and trust
 * stayed null for ever. The unit tests passed throughout, because they
 * exercised scoreFutures() on a hand-built list and never on what the caller
 * would actually hand it one pass later.
 */
export function carryPredictions(prev, futures, baselineM, now, cap = 40) {
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const pending = (Array.isArray(prev) ? prev : []).filter((p) => fin(p?.dueAt) && p.dueAt > now)
  const fresh = (Array.isArray(futures) ? futures : [])
    .filter((f) => fin(f?.M) && fin(f?.waitMs) && f.waitMs > 0)
    .map((f) => ({
      madeAt: now,
      dueAt: now + f.waitMs,
      waitMs: f.waitMs,
      // The claim under audit is what the MODEL said, before any discount we
      // chose to apply to it.
      predictedM: fin(f.MUndiscounted) ? f.MUndiscounted : f.M,
      baselineM,
    }))
  return [...pending, ...fresh].slice(-cap)
}
