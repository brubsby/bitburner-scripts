import { progressFactor, RATE_CHANNELS } from 'installgate.js'

// The objective function, DERIVED instead of assumed. Pure, no ns.
//
// installgate.js exports progressFactor and RATE_CHANNELS and has no ns surface
// of its own, so importing them here is free.
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES
//
// RATE_CHANNELS weighted every channel's log-multiplier equally — the last
// hand-tuned constant in the decision core, pricing every purchase the DP
// makes. Equal weights were the honest choice while the flywheel's stages
// were unmeasured; now every transmission coefficient IS measured, and the
// weights can be computed instead of asserted:
//
//   how much sooner does hacking 9000 arrive if channel i were 10% higher?
//
// ---------------------------------------------------------------------------
// THE MODEL
//
// The run is N remaining install windows; each window buys Δ = ln(g) of
// hacking-mult-equivalent progress (g = the measured multiplier growth per
// install). A channel's weight is its marginal contribution to TOTAL
// remaining progress per unit ln, normalised so `hacking` = 1:
//
//   hacking       direct: its ln IS exit progress. Indirect: level scales
//                 linearly with it, and level drives both income (the
//                 (level+50) model) and rep rates (reputation.ts:17), so it
//                 also lifts every future window through both elasticities.
//                     w_raw(hacking) = 1 + N·(e_B + e_R)
//   income chans  transmit through the budget: every future window's plan
//                 re-runs at a bigger budget, worth e_B per unit ln, N times.
//                     w_raw(income·i) = t_i · N·e_B
//                 with a per-channel transmission t_i, because income is NOT
//                 uniform in them:
//                     money  t=1     (income strictly linear in it)
//                     speed  t=1     (cycle time strictly inverse in it)
//                     chance t=1−chanceObs  (the batcher runs targets at
//                            ~100% observed success — a chance multiplier on
//                            a saturated chance does nothing; batch.txt's
//                            cal.chanceObs measures exactly this)
//                     grow   t=growShare    (a grow multiplier frees grow
//                            threads; the freed share of batch RAM is the
//                            plan's own g/(h+g+w1+w2), measured per target)
//   faction_rep   transmits through the reputation side, worth e_R per unit
//                 ln per window — and past the donation threshold it ALSO
//                 divides every donation's dollar cost (donation.ts:8), which
//                 the e_R probe captures when the caller perturbs
//                 donationCost together with factionRep.
//                     w_raw(faction_rep) = N·e_R
//   hacking_exp   the excluded channel, now priced instead of zeroed: level
//                 responds to exp only logarithmically — ∂ln(level)/∂ln(exp)
//                 = 32·mult/level (skill.ts:13 differentiated) — so it gets
//                 that fraction of hacking's INDIRECT part (the direct part
//                 is the multiplier axis itself, which exp does not touch).
//                     w_raw(hacking_exp) = (32·mult/level) · N·(e_B + e_R)
//
// e_B and e_R are ELASTICITIES OF THE ACTUAL PLAN, measured by the caller
// each pass: re-run planPurchases with money ×k (and with factionRep ×k +
// donationCost ÷k) and read Δln(M)/ln(k). They are not constants and not
// formulas — they are what the real purchase optimiser does with a bigger
// budget, at this pass's real offers.
//
// Normalisation by w_raw(hacking) keeps M meaning "equivalent hacking-mult
// factor", so the install gate's exit-condition arithmetic and its
// cross-pass marginal comparisons keep their semantics. Weights drift as N
// shrinks and the elasticities move; that drift is slow against the gate's
// pass cadence, and the caller publishes the weights every pass so a jump is
// visible rather than silent.
//
// REFUSAL: any unreadable input returns null, and every consumer falls back
// to the flat basket — the pre-derivation behaviour, degraded to loudly
// (`weightsSource: 'flat'` in telemetry), never a guessed weight.

/**
 * Derive the channel weights from measured flywheel state.
 *
 * @param o {{
 *   remainingWindows: number,   // ln(needMult/mult)/ln(g), the caller's ladder
 *   eBudget: number,            // Δln(planM)/ln(k) at money ×k, measured
 *   eRep: number,               // Δln(planM)/ln(k) at rep ×k, measured
 *   hackingMult: number, level: number,
 *   chanceObs: number,          // batcher's observed success rate, ~1 saturated
 *   growShare: number,          // g/(h+g+w1+w2) from the live batch plans
 * }}
 * @returns weights keyed by channel (hacking = 1), plus `raw` diagnostics — or null.
 */
export function deriveWeights(o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  const { remainingWindows: N, eBudget: eB, eRep: eR, hackingMult, level, chanceObs, growShare } = o
  if (!num(N) || N <= 0 || !num(eB) || !num(eR) || !num(hackingMult) || hackingMult <= 0 || !num(level) || level < 1) return null
  const tChance = num(chanceObs) && chanceObs <= 1 ? 1 - chanceObs : null
  const tGrow = num(growShare) && growShare <= 1 ? growShare : null
  if (tChance === null || tGrow === null) return null

  const indirect = N * (eB + eR)
  const wHacking = 1 + indirect
  const expShare = Math.min(1, (32 * hackingMult) / Math.max(1, level))
  const raw = {
    hacking: wHacking,
    hacking_money: N * eB,
    hacking_speed: N * eB,
    hacking_chance: tChance * N * eB,
    hacking_grow: tGrow * N * eB,
    faction_rep: N * eR,
    hacking_exp: expShare * indirect,
  }
  const weights = {}
  for (const [k, v] of Object.entries(raw)) weights[k] = v / wHacking
  return { weights, raw, indirect }
}

/**
 * A channel weight from a MEASURED PATH IMPROVEMENT — the pattern for
 * channels that transmit through a discrete path choice rather than a smooth
 * flywheel term. Charisma is the worked case: it does nothing for the
 * hacking path, but it compresses the megacorp desk wall (chaMult divides
 * the exp-curve exponent), and the desk path only matters when that
 * compression lifts it past the schedule's best alternative. So the weight
 * is the OPTION's marginal value:
 *
 *   probe the desk path's rate at chaMult and at chaMult x K
 *   rateGain = max(0, min(R1, needed) - max(R0, current best))-ish — the
 *              caller supplies the honest delta for its own comparison; a
 *              probe that does not beat the incumbent contributes ZERO,
 *              because charisma bought for a path never taken buys nothing
 *   weight   = rateGain / ln(K) x remainingHours / rawHacking
 *
 * — per unit ln of the multiplier, in the same normalised units as
 * deriveWeights (rawHacking is that derivation's hacking numerator, so the
 * two families compose into one basket). Refuses on unreadable inputs; a
 * zero gain returns exactly 0, a real value meaning "priced, and worthless
 * on the current frontier", distinct from null's "could not price".
 */
export function pathGainWeight(o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x)
  const { rateGain, lnK, remainingHours, rawHacking } = o
  if (!num(rateGain) || !num(lnK) || lnK <= 0 || !num(remainingHours) || remainingHours <= 0 || !num(rawHacking) || rawHacking <= 0) return null
  return (Math.max(0, rateGain) / lnK) * (remainingHours / rawHacking)
}

// ---------------------------------------------------------------------------
// THE VALUE OF ONE AUGMENTATION — the single definition, and why it is single
// ---------------------------------------------------------------------------
//
// Three modules used to answer this question independently:
//
//   augplan.valueOf       what to BUY
//   factionplan.logValue  what to GRIND
//   progress.heldM        what is already QUEUED
//
// Each called progressFactor directly, each was individually correct, and each
// had its own tests. The composition was not correct, and no single-module test
// could have said so — which is why the failures below all reached production
// with a green suite:
//
//   - The Red Pill has NO multipliers and ends the BitNode. augplan was taught
//     that with a synthetic selection value. installgate was taught it with
//     `terminal`. factionplan was never taught, so DAEDALUS — the only faction
//     that can finish the run — scored ln(1) = 0 and ranked last, while the
//     schedule chose a 4.98-hour ECorp grind for multipliers the run no longer
//     needed.
//   - NeuroFlux is the most efficient ln(M) purchase and can never advance the
//     DISTINCT count Daedalus admits on. Four of five consecutive installs
//     added zero augmentations while banking ln(M) 0.59-0.95 each.
//   - progress.heldM valued queued augmentations on the FLAT basket while
//     plan.M valued planned ones on the DERIVED weights, then multiplied the
//     two together and handed the product to the install gate as one number —
//     two different objectives in one product, feeding rho and every install
//     decision since.
//
// So value lives here now, once. Teaching it a fact teaches every consumer.
// The structural guard is [OB1]: nothing outside this file may call
// progressFactor, so a fourth local scorer cannot quietly appear.

/**
 * The augmentation that ends the BitNode. It has no multipliers, and an
 * objective that scores only multipliers cannot see the finish line.
 */
export const TERMINAL_AUG = 'The Red Pill'
export const TERMINAL_LN = 10

/**
 * Dominance value of one DISTINCT augmentation while the exit's count gate is
 * unmet. A threshold, not a utility estimate: Daedalus admits on a count, no
 * quantity of NeuroFlux substitutes for one unit of it, so a ticket must
 * outrank the chain. Set above the largest single-life NeuroFlux haul actually
 * recorded (0.95) and below a genuinely large multiplier augmentation, so real
 * value still competes.
 */
export const TICKET_LN = 2

/**
 * What one augmentation is worth, in ln units, with every exception applied.
 *
 * @param {object} aug   `{ name, mults }`
 * @param {object} [ctx]
 *   channels      basket to score over (default RATE_CHANNELS)
 *   weights       derived per-channel exponents, or null for the flat basket
 *   countShort    distinct augmentations the exit still needs; 0 disables the
 *                 ticket rule entirely
 *   isTicket      caller's decision that THIS augmentation counts toward the
 *                 shortfall (it knows what is owned and how many are already
 *                 taken); the rule here only prices it
 *
 * @returns {{ ln, real, synthetic, kind }}
 *   real       ln of the TRUE multiplier basket — what may be reported
 *   synthetic  dominance value added for selection — what must NOT be
 *   ln         real + synthetic, what a ranking should order by
 *
 * The split is the whole point. A synthetic value that reaches a reported M
 * contaminates rho, the install gate and the lifetimes ledger, which spend real
 * hours against that number.
 */
export function augValue(aug, ctx = {}) {
  const mults = aug?.mults ?? {}
  const real = Math.log(Math.max(1e-300, progressFactor([mults], ctx.channels ?? RATE_CHANNELS, ctx.weights ?? null)))

  if (aug?.name === TERMINAL_AUG) {
    return { ln: real + TERMINAL_LN, real, synthetic: TERMINAL_LN, kind: 'terminal' }
  }
  const short = typeof ctx.countShort === 'number' && isFinite(ctx.countShort) ? ctx.countShort : 0
  if (short > 0 && ctx.isTicket === true) {
    return { ln: real + TICKET_LN, real, synthetic: TICKET_LN, kind: 'ticket' }
  }

  // Value that is not in `mults` at all — money, programs, the focus penalty.
  // Added rather than substituted: BitRunners Neurolink has real multipliers
  // AND grants two port programs, and it is worth both. oneoffValue returns 0
  // with a reason for every ordinary augmentation, so this costs nothing on
  // the common path and cannot silently inflate anything else.
  const one = oneoffValue(aug, ctx)
  if (one.ln > 0) {
    return { ln: real + one.ln, real, synthetic: one.ln, kind: one.kind, why: one.reason }
  }
  return { ln: real, real, synthetic: 0, kind: 'aug', ...(one.reason ? { why: one.reason } : {}) }
}

/**
 * WHICH EXIT GATE BINDS, and whether installing would destroy progress on it.
 *
 * ln(M) is a PROXY for time-to-exit, valid only while the multiplier is what
 * stands between the run and the door. Once it is not, the proxy does not
 * merely lose accuracy — it inverts, because an install resets money to $1262
 * (PlayerObjectGeneralMethods.ts:102) and faction reputation to zero, and those
 * are exactly the resources the remaining gates are made of.
 *
 * Measured in BitNode 1, with 31 distinct augmentations against Daedalus's 30
 * and hacking 6519 against an exit bar of 3000 — five consecutive lives:
 *
 *     0.13h  lnM 0.207  augs 31
 *     0.13h  lnM 0.198  augs 31
 *     0.13h  lnM 0.217  augs 31
 *     0.14h  lnM 0.167  augs 31
 *     0.16h  lnM 0.149  augs 31
 *
 * Eight-minute lives, no augmentations, banking a multiplier nothing needed —
 * and each one destroying a balance that had reached $8.5 TRILLION against a
 * $100b requirement. Every one of those installs scored at rho exactly, which
 * is what a self-reinforcing equilibrium looks like from inside the objective.
 *
 * @param {object} ctx
 *   countShort        distinct augmentations the exit still needs
 *   joinMoneyShort    money that must be IN HAND for the next join, 0 if met
 *   terminalShort     money still needed to acquire the augmentation that ends
 *                     the node, 0 when owned, planned, or already affordable
 *   exitLevelReached  is the hacking level already past what the exit needs?
 *
 * @returns {{ gate, destroyedByInstall, why }} — `gate` is null when nothing is
 *   known, which callers must treat as "no opinion", never as "nothing binds".
 */
export function bindingGate(ctx = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  if (!num(ctx.countShort) || !num(ctx.joinMoneyShort) || !num(ctx.terminalShort) || typeof ctx.exitLevelReached !== 'boolean') {
    return { gate: null, destroyedByInstall: false, why: 'exit state unreadable' }
  }
  // THE MULTIPLIER BRANCH, decided by SIMULATION when one is available.
  //
  // This used to be a bare threshold — `!ctx.exitLevelReached`, meaning
  // "hacking >= exitLevel RIGHT NOW" — and it short-circuited every gate below
  // it. Hacking resets to 1 at every install, so it was true immediately after
  // each one and the money gate was never consulted. The ladder therefore
  // never compared the two things the end of a node actually trades off:
  // installing (bigger multiplier, faster income, but money and reputation
  // reset) against holding (keep the cash, finish on today's multiplier).
  //
  // exitplan.bestExitPolicy runs both as trajectories and returns the faster.
  // Measured live at hacking 4051/4500, mult 9.25, $8.85b, income $39m/s:
  // holding 7.14h, install-once 4.75h, install-twice 5.18h — an interior
  // optimum the threshold could not express. The whole swing is the climb back
  // to the exit level AFTER the terminal install resets skills, which is
  // exponential in exitLevel/mult: 3.03h at mult 9.25, 0.06h at 12.40.
  //
  // The threshold survives as the FALLBACK, because a policy that cannot be
  // priced must not silently become "hold". Which one decided is reported.
  const policy = ctx.exitPolicy?.best
  if (policy && typeof policy.installsFirst === 'number' && isFinite(policy.installsFirst)) {
    if (policy.installsFirst > 0) {
      return {
        gate: 'multiplier',
        destroyedByInstall: false,
        source: 'simulated',
        why:
          `simulated: installing ${policy.installsFirst} more time(s) then finishing takes ` +
          `${policy.hours.toFixed(2)}h against ${(ctx.exitPolicy.tried?.find((t) => t.installsFirst === 0)?.hours ?? NaN).toFixed(2)}h ` +
          `for holding — the multiplier is still worth more than the cash`,
      }
    }
    // installsFirst === 0: holding wins, so fall through to the gates below,
    // which know that an install would destroy what we are accumulating.
  } else if (!ctx.exitLevelReached) {
    return {
      gate: 'multiplier',
      destroyedByInstall: false,
      source: 'threshold-fallback',
      why:
        'the exit level is not reachable yet — installing is what fixes that. ' +
        `(No simulated policy: ${ctx.exitPolicy?.why ?? 'none supplied'}.)`,
    }
  }
  if (ctx.countShort > 0) {
    return {
      gate: 'count',
      destroyedByInstall: false,
      why: `${ctx.countShort} distinct augmentation(s) short — installing advances this when the plan contains one`,
    }
  }
  // THE JOIN IS OUTSTANDING UNTIL WE ARE A MEMBER, not until we can afford it.
  //
  // This used to bind on `joinMoneyShort > 0` alone, and joinMoneyShort is a
  // BUDGET HOLD — "how much must I keep back", which is correctly 0 the moment
  // the balance covers it. Read as a state signal it says the opposite of the
  // truth: having the money made the gate report 'none' ("no exit gate is
  // outstanding"), which freed the install gate to spend it.
  //
  // Measured live in BitNode 5, six times in three hours: the run reached
  // $6,267b / $6,317b / $7,479b / $29,614b / $30,678b against a $100b
  // requirement, and installed every time, resetting to $1262 without ever
  // joining Daedalus. Distinct augmentations stayed at 36 throughout, so the
  // installs were not advancing the count gate either — the node simply could
  // not be exited.
  //
  // Holding $30t and being a member are different states. The gate binds until
  // membership, and once the money is in hand it says so in as many words,
  // because at that point the correct act is to JOIN, not to keep accumulating.
  //
  // `exitFactionJoined` must be an explicit `false` to bind this way. Unknown
  // falls back to the shortfall test rather than binding forever: a gate that
  // blocks every install on an unreadable signal is a deadlock, which is the
  // failure this whole ladder was built to avoid.
  const affordedButUnjoined =
    ctx.exitFactionJoined === false && num(ctx.exitFactionMoneyReq) && ctx.exitFactionMoneyReq > 0
  if (ctx.joinMoneyShort > 0 || affordedButUnjoined) {
    const short = ctx.joinMoneyShort > 0
    return {
      gate: 'money',
      destroyedByInstall: true,
      why: short
        ? `$${Math.round(ctx.joinMoneyShort)} must be IN HAND for the next join, and an install resets money to $1262`
        : `the $${Math.round(ctx.exitFactionMoneyReq)} for the exit faction is ALREADY IN HAND but it is not joined yet — ` +
          `installing now would destroy the money without ever using it`,
    }
  }
  // THE LAST PURCHASE, which is gated the same way the join is and one step
  // later. Acquiring the terminal augmentation costs either a donation or a
  // reputation grind, and an install destroys BOTH — money to $1262, faction
  // reputation to zero. Membership is destroyed too, so every life re-enters
  // this state from the beginning.
  //
  // Traced rather than observed: once Daedalus is joined the join claim goes to
  // zero, this gate read `none`, and the rate rule installs on its own cadence
  // — measured at 0.13-0.16h. The donation needs ~$598b at ~$477b/h, about an
  // hour, so roughly seven installs would fire inside the window and the run
  // would loop forever: hold to $100b, join, install, lose it, repeat.
  //
  // `waitBeats` cannot rescue it, and the reason is worth stating because it
  // looks like it should: futures are built from the plan's REPORTED M, and the
  // terminal augmentation's value is deliberately decontaminated out of that
  // number. So a future in which the exit becomes affordable scores exactly the
  // same as one in which it does not.
  if (ctx.terminalShort > 0) {
    return {
      gate: 'terminal',
      destroyedByInstall: true,
      why:
        `$${Math.round(ctx.terminalShort)} still needed to acquire the augmentation that ends the BitNode, and an ` +
        `install resets money to $1262, reputation to zero and faction membership with them`,
    }
  }
  return { gate: 'none', destroyedByInstall: false, why: 'no exit gate is outstanding' }
}

/* ========================================================================= */

/**
 * AUGMENTATIONS WHOSE VALUE IS NOT IN THEIR MULTIPLIERS.
 *
 * progressFactor() reads RATE_CHANNELS off `aug.mults`, so an augmentation
 * that grants money, programs or a behavioural change scores M = 1 and is
 * worth exactly nothing to the planner. That is not a rounding error: it means
 * the thing is NEVER bought, however cheap or useful, because every ranking in
 * this repo is on ln(M). The Red Pill already had an override for precisely
 * this reason (TERMINAL_AUG); these are the rest of the family, enumerated
 * from Augmentation/Augmentations.ts rather than remembered.
 *
 * BigD's Big Brain ($1e12 + every program) is deliberately absent: it is not
 * obtainable in normal play. Unstable Circadian Modulator is commented out in
 * the game source, so it is absent too — listing either would be pricing a
 * thing that cannot be bought.
 */
export const ONEOFF_EFFECTS = {
  // Augmentations.ts:324 — the canonical case, and the one that prompted this.
  'CashRoot Starter Kit': { startingMoney: 1e6, programs: ['BruteSSH.exe'] },
  // Augmentations.ts:1215
  'BitRunners Neurolink': { programs: ['FTPCrack.exe', 'relaySMTP.exe'] },
  // Augmentations.ts:1420
  PCMatrix: { programs: ['DeepscanV1.exe', 'AutoLink.exe'] },
  // PlayerObjectGeneralMethods.ts:622-624 — focusPenalty() returns 1 instead
  // of 0.8 when this is owned, i.e. unfocused work runs at full rate.
  'Neuroreceptor Management Implant': { focusPenaltyRemoved: true },
}

/** DarkWeb/DarkWebItems.ts:6-20. The price is what NOT having it costs. */
export const PROGRAM_PRICE = {
  'BruteSSH.exe': 500e3,
  'FTPCrack.exe': 1500e3,
  'relaySMTP.exe': 5e6,
  'HTTPWorm.exe': 30e6,
  'SQLInject.exe': 250e6,
  'DeepscanV1.exe': 500e3,
  'DeepscanV2.exe': 25e6,
  'AutoLink.exe': 1e6,
  'ServerProfiler.exe': 500e3,
  'Formulas.exe': 5e9,
}

/** money = 1000 + CONSTANTS.Donations (PlayerObjectGeneralMethods.ts:102). */
export const POST_INSTALL_MONEY = 1262

/**
 * What a one-off effect is worth, in the same ln units as everything else.
 *
 * TWO DIFFERENT MECHANISMS, priced differently because they ARE different:
 *
 *   money + programs   Delivered at the START of every future life, not now.
 *                      Their worth is therefore a BUDGET effect at the moment
 *                      the budget is smallest — post-install money is $1262,
 *                      so CashRoot's $1m is ~800x the opening balance — and it
 *                      recurs for every remaining install. Converted through
 *                      the SAME measured budget elasticity the channel weights
 *                      use (eBudget = dln(planM)/dln(money)), so this sits in
 *                      the same units as the rest of M rather than in a
 *                      constant someone chose.
 *
 *   focus penalty      Not a budget effect at all — a RATE effect. Unfocused
 *                      work runs at 0.8 and this removes that, so it is worth
 *                      exactly a faction_rep multiplier of 1/0.8, and it is
 *                      priced by running that synthetic multiplier through
 *                      progressFactor with the live weights. No new units, no
 *                      new constant. Worth ZERO when the run works focused,
 *                      which is the normal case here — and saying zero for a
 *                      stated reason is the honest answer, not a defect.
 *
 * REFUSES rather than guesses: without a measured eBudget or a remaining-window
 * count there is no way to convert money into ln, and inventing a coefficient
 * here would be the fabricated-calibration mistake CLAUDE.md names twice. A
 * refusal returns ln 0 WITH a reason, so "worth nothing" and "could not price"
 * are distinguishable in telemetry.
 */
export function oneoffValue(aug, ctx = {}) {
  const eff = ONEOFF_EFFECTS[aug?.name]
  if (!eff) return { ln: 0, kind: null, reason: null }
  const num = (x) => typeof x === 'number' && isFinite(x)

  if (eff.focusPenaltyRemoved) {
    // Only worth something if the run actually works unfocused.
    if (ctx.unfocused !== true) {
      return { ln: 0, kind: 'oneoff:focus', reason: 'work is focused, so the focus penalty is not being paid' }
    }
    const penalty = num(ctx.focusPenalty) && ctx.focusPenalty > 0 && ctx.focusPenalty < 1 ? ctx.focusPenalty : 0.8
    const ln = Math.log(
      progressFactor([{ faction_rep: 1 / penalty }], ctx.channels ?? RATE_CHANNELS, ctx.weights ?? null),
    )
    return { ln, kind: 'oneoff:focus', reason: `unfocused work runs at ${penalty}; this removes that` }
  }

  const owned = ctx.ownedPrograms instanceof Set ? ctx.ownedPrograms : new Set(ctx.ownedPrograms ?? [])
  let grant = num(eff.startingMoney) ? eff.startingMoney : 0
  for (const p of eff.programs ?? []) {
    if (owned.has(p)) continue // already have it; the grant buys nothing
    const price = PROGRAM_PRICE[p]
    if (!num(price)) return { ln: 0, kind: 'oneoff:grant', reason: `no price known for ${p}` }
    grant += price
  }
  if (grant <= 0) return { ln: 0, kind: 'oneoff:grant', reason: 'every granted program is already owned' }

  const priced = moneyLn(grant, ctx)
  if (priced.ln === null) return { ln: 0, kind: 'oneoff:grant', reason: priced.reason }
  return { ln: priced.ln, kind: 'oneoff:grant', reason: `${Math.round(grant)} granted per life x ${priced.windows.toFixed(1)} remaining, against a ${Math.round(priced.opening)} budget` }
}

/**
 * Dollars -> ln(M): what `dollars` more, at the live budget, does to the
 * plan's multiplier over the remaining windows. The ONE bridge between money
 * and the objective, used for one-off cash grants and for pricing an hour of
 * crime against an hour of faction work. Refuses (`ln: null`) without a
 * measured elasticity, a remaining-window count, or a live budget.
 */
export function moneyLn(dollars, ctx = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x)
  const eB = ctx.eBudget
  const N = ctx.remainingWindows
  if (!num(dollars) || dollars <= 0) return { ln: null, reason: 'no dollars to price' }
  if (!num(eB) || eB < 0) return { ln: null, reason: 'budget elasticity not measured — cannot price money as ln' }
  if (!num(N) || N <= 0) return { ln: null, reason: 'remaining-window count unreadable — cannot price money over the run' }

  // THE REFERENCE BUDGET IS THE LIVE ONE, not the post-install opening, and
  // the difference is the whole correctness of this function.
  //
  // eBudget is a LOCAL elasticity — dln(planM)/dln(money) measured by
  // re-running the purchase optimiser at the CURRENT budget. Taking the log
  // against the $1262 opening applies that local slope across three orders of
  // magnitude: the first version of this priced CashRoot at ln 7.081, against
  // ~0.5 for an entire install cycle, which would have made it dominate every
  // ranking at any price. That is an extrapolation artefact, not a valuation.
  //
  // Referencing the live budget is also SELF-CORRECTING in exactly the way the
  // real effect behaves. $1.5m against $50b is noise and prices as ~0 — right,
  // because the grant changes nothing when we are rich. Against a fresh
  // BitNode's $1262 it is transformative and prices high — also right, and
  // that is precisely when CashRoot is worth buying. No cap, no floor, no
  // constant: the state does the work.
  const opening =
    num(ctx.money) && ctx.money > 0
      ? ctx.money
      : num(ctx.openingMoney) && ctx.openingMoney > 0
        ? ctx.openingMoney
        : POST_INSTALL_MONEY
  return { ln: N * eB * Math.log((opening + dollars) / opening), windows: N, opening, reason: null }
}


/**
 * THE VALUE OF HOME RAM IN ln(M), so the home claim can compete on the same
 * terms as everything else (budget.js lnCompete).
 *
 * The batcher's income scales with the RAM it runs on — the proportionality
 * budget.js's fleet exception already uses — so one more gigabyte of home
 * earns incomePerSec x deltaGB / ramTotal per second, every window from now
 * on (home survives installs). That is dollars per window, and moneyLn
 * prices dollars over the remaining windows against the projected budget.
 *
 *   o: { incomePerSec, deltaGB, ramTotal, windowH, cost, eBudget,
 *        remainingWindows, budget, join: { valueLn, claim, money } }
 *
 * TWO CHANNELS, summed. (1) The plan channel: moneyLn prices the extra
 * dollars through the measured budget elasticity. (2) The join channel:
 * while the exit faction's money requirement is unmet, every dollar of
 * income brings the join closer, and budget.js prices that dollar at
 * valueLn / claim (the join rival's exact linear figure). Home's extra
 * income runs for min(time to the join at today's income, one window) —
 * the window because money resets at the install that ends it — so
 *   lnJoin = incomePerSec x deltaGB / ramTotal x min(T, window) x valueLn / claim.
 * The two are one figure: with eBudget 0 (money moves no purchase) home
 * still wins the join's hold exactly when it pays itself back before the
 * join — the moneyReturn exception, derived rather than declared.
 *
 * Returns { ln, lnPerDollar, dollarsPerWindow, lnPlan, lnJoin, reason }.
 * Every input must be readable and positive or the value is null with the
 * reason — the claim then HOLDS, as it always did. A join claim of 0 is a
 * known nothing (lnJoin 0); an absent or unreadable join input refuses,
 * because an underpriced home figure is what lets a rival spend through
 * the one asset that survives installs. Deliberately assumes the batcher
 * is RAM-bound (it is, most of every life): a spare-RAM moment would price
 * home at zero and waive a permanent asset for a transient reading.
 */
export function homeLn(o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  for (const k of ['incomePerSec', 'deltaGB', 'ramTotal', 'windowH', 'cost']) {
    if (!num(o[k])) return { ln: null, lnPerDollar: null, dollarsPerWindow: null, reason: `${k} unreadable — home keeps its claim` }
  }
  const dollarsPerWindow = (o.incomePerSec * o.deltaGB * o.windowH * 3600) / o.ramTotal
  const refuse = (reason) => ({ ln: null, lnPerDollar: null, dollarsPerWindow, lnPlan: null, lnJoin: null, reason })
  const v = moneyLn(dollarsPerWindow, { money: o.budget, eBudget: o.eBudget, remainingWindows: o.remainingWindows })
  if (v.ln === null) return refuse(v.reason)
  const j = o.join
  const fin = (x) => typeof x === 'number' && isFinite(x)
  if (!j || typeof j !== 'object') return refuse('join inputs unreadable — home keeps its claim')
  let lnJoin = 0
  if (!fin(j.claim) || j.claim < 0) return refuse('join claim unreadable — home keeps its claim')
  if (j.claim > 0) {
    if (!fin(j.valueLn) || j.valueLn < 0) return refuse('join value unreadable — home keeps its claim')
    if (!fin(j.money) || j.money < 0) return refuse('money unreadable — home keeps its claim')
    const tJoin = Math.max(0, (j.claim - j.money) / o.incomePerSec)
    const secs = Math.min(tJoin, o.windowH * 3600)
    lnJoin = ((o.incomePerSec * o.deltaGB) / o.ramTotal) * secs * (j.valueLn / j.claim)
  }
  const ln = v.ln + lnJoin
  return { ln, lnPerDollar: ln / o.cost, dollarsPerWindow, lnPlan: v.ln, lnJoin, reason: null }
}
