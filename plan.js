// ONE COMMITTED PLAN — Monte Carlo over the posteriors (bayes.js) through the
// existing exit simulators, and a commitment rule that switches only when the
// evidence says so. Pure: no ns surface; progress.js wires the I/O and writes
// /tel/plan.txt. Design: docs/bayes.md.
//
// THE PROBLEM THIS SOLVES (live, BitNode 8, 2026-09-26): every pass re-ran the
// exit simulations on point estimates and took the argmin by ANY margin, while
// the forecast moved ~9-12h per hour of wall time. The count route went to The
// Syndicate (27.3h), the player trained strength 1 -> 202 for it, and five
// minutes later it was SmartJaw @ Bachman; installs held 4h on a 0.14h/114h
// near-tie. A decision that cannot tell a re-fit from a real difference is a
// random walk with sunk costs.
//
// THE RULE (decide): options are evaluated on the SAME parameter draws
// (common random numbers), so a comparison is paired; the committed option is
// priced on its REMAINING path from the current state (its sunk progress is
// already in the state), and an alternative pays its switch cost. Switch when
// the expected gain net of that cost exceeds the value of waiting one more
// re-decide interval for information (a preposterior on the paired draws,
// valueOfWaiting) — the expected-loss rule, default since 2026-10-02. The rule
// before it (switch only when the expected gain is positive AND P(better) >=
// THETA) is one flag away (COMMIT.rule 'p-better', decideByPBetter) and its
// verdict is logged beside every decision. The spreads are the CALIBRATED
// ones: exitcal.js measures how the forecast moves against its own interval
// and scales them by one width multiplier (docs/bayes.md "Calibration").

import { rngOf, hashOf, normalOf, gammaOf, igDraw, nigDraw, PRIORS, traderRwPosterior, rwLedgerOf, driftPosterior, driftCalibration, logRatePosterior, jitterPosterior } from 'bayes.js'
import { routeExitFixed, routeExitFixedGen, countExitFixedGen } from 'countexit.js'
import { drain } from 'coop.js'
import { exitCalibrationReport } from 'exitcal.js'
import { bestExitPolicy, bestExitPolicyGen } from 'exitplan.js'
import { realisedCapital } from 'nodeecon.js'
import { RW_PRIOR, rwShape } from 'traderw.js'
// Pure: the Bladeburner exit model (decideBladeRouteGen).
import { bladeExitGen, bladeExitMeanGen, bladeMemberOf, bladeMemberOfDraw, BLADE_ENSEMBLE } from 'bbplan.js'
import { installVoidOf } from 'installgate.js'

const fin = (x) => typeof x === 'number' && isFinite(x)

export const PLAN_FILE = '/tel/plan.txt'
export const PLAN = {
  N: 24, // draws per decision (cap; the budget may stop earlier)
  theta: 0.8, // P(alternative better net of switch cost) needed to switch
  // WORK time per pass for the Monte Carlo decisions together (the draws stop
  // there, all options at the same N). It no longer bounds a page freeze —
  // the searches run in slices (coop.js) — only how long a pass takes: at
  // 40ms slices, 1200ms is ~30 yields, each a MessageChannel round trip
  // (not timer-throttled in a hidden tab).
  budgetMs: 1200,
  sliceMs: 40, // work between yields (the pacer yields once a slice is spent)
  maxBlockMs: 50, // the longest synchronous block a pass may hold (healthcheck F)
  maxAgeMin: 30, // re-decide at least this often even without an event
  switchCostH: 0.05, // a re-order's own cost (stated); travel/commission added per option
  topK: 6, // routes carried into the Monte Carlo besides the committed one
  // THE INSTALL DECISION ACTS, so it always gets its draws. On a re-decision
  // it prices every wait the batch planner offers (26 options live BN9
  // 2026-09-29 21:12Z, on a 21-graft set) after the graft and 4S draws had
  // spent the pass's budget: 5 of 24 draws (PLAN UNDER-SAMPLED). Now the
  // options are SCREENED by their point (installScreenOf: the committed
  // incumbent always, then the best installTopK within installReach
  // structural errors of the best point), and the decision's budget has a
  // floor (installFloorMs) whatever the decisions before it spent.
  installTopK: 3,
  installReach: 3,
  installFloorMs: 1000,
  // THE LIFE LENGTH (decideLifeLengthGen): the incumbent and the best
  // lifeTopK other lengths by point within lifeReach structural errors enter
  // the draws; a switch pays lifeSwitchCostH (stated: re-planning the later
  // lives costs nothing in the game — it is the rule's own margin).
  lifeTopK: 2,
  lifeReach: 3,
  lifeSwitchCostH: 0.05,
  // ADAPTIVE SIMULATION ALLOCATION on a re-decision (ocbaEvaluateGen): n0
  // paired draws for every option, then the leaders (incumbent + best
  // alternative) to every draw and the rest by OCBA until P(correct
  // selection) >= pcs; simBudget caps the simulations (null: options x N).
  // on: false restores every option on every draw.
  ocba: { on: true, n0: 8, pcs: 0.95, simBudget: null },
  // RATIONAL METAREASONING for the scheduled re-decide (redecideGateOf): skip
  // the timer's re-decision when the value of computing it (the expected exit
  // hours a re-decision would recover, from the committed margins' spread) is
  // below its cost — the re-deciding pass's main-thread work in hours times
  // stallCostH exit-hours per hour of stall (STATED, NOT CALIBRATED: an upper
  // bound, everything the page runs waits on the stall). Never past maxSkipH
  // since the last decision; never on any other event.
  voc: { on: true, stallCostH: 1, maxSkipH: 4, unstableNoteH: 2 },
  traderMoveSd: 1, // posterior mean moved by this many sds = an event
  driftMoveFactor: 1.5, // structural error scale moved by this factor = an event
}

const clock = () => {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/**
 * Every posterior the plan draws from, from data the caller read:
 * stockRows (/tel/stock-hist.txt), warmupH (nodeecon.realisedCapital),
 * exitSamples (installgate exitCalibration.samples), ledger (lifetimes),
 * bitNode, obs {exp: [{at, v}], rep: [...]} (this life's pass observations).
 * Each is null when its data is absent — and then the draw keeps the point
 * input (named in `missing`), never a silent zero.
 */
export function posteriorsOf({ stockRows = null, warmupH = 0, exitSamples = null, obs = {}, optionPoints = null, income = null, cadence = null, expPost = null, traderBelief = null, calState = null, prevPlan = null } = {}) {
  const jitter = jitterPosterior(optionPoints ?? [])
  // THE TRADER'S RETURN: the belief the exit inputs' point was taken from
  // (traderBeliefOf), so the point and the draws are one distribution; the
  // rows path is kept for callers that have no belief.
  const trader = traderBelief ? traderBelief.post ?? null : stockRows ? traderBeliefOf(stockRows, { warmupH })?.post ?? null : null
  const drift = driftPosterior(exitSamples ?? [])
  // THE EXIT FORECAST'S CALIBRATION (exitcal.js): the legacy one-step
  // coverage (driftCalibration, its top-level fields unchanged), the
  // diagnosis, the forecast-revision test, the width multiplier and the
  // e-processes, carried pass to pass in `state` (calState: the last plan's
  // calibration.state, any node). A report that throws is published as
  // such, never as calibrated.
  let calibration
  try {
    calibration = exitCalibrationReport(exitSamples ?? [], { state: calState, points: optionPoints, prevPlan, legacy: driftCalibration(exitSamples ?? []) })
  } catch (e) {
    calibration = { ...driftCalibration(exitSamples ?? []), error: `exitcal threw: ${String(e).slice(0, 160)}`, state: calState }
  }
  const exp = logRatePosterior(obs?.exp)
  // Faction-work samples only (progress.js tags them `work: 'faction'`): an
  // untagged entry is a pass's published rate, whatever the slot was doing.
  const rep = logRatePosterior((obs?.rep ?? []).filter((o) => o?.work === 'faction'))
  const missing = []
  if (!trader) missing.push('trader return (no stock history past warm-up): point input kept')
  if (!cadence) missing.push('install cadence (no life in any node with a measured gain): point cadence kept')
  if (!exp && !expPost) missing.push('exp rate (no observation): point kept')
  if (!rep) missing.push('rep rate (no observation): point kept')
  return { trader, drift, calibration, cadence, exp, expPost, rep, gymSdLn: PRIORS.gymSdLn, jitter, income, missing }
}

/**
 * THE TRADER'S RETURN, ONE BELIEF for the point and the draws. The exit's
 * money legs compound the book at `capitalReturnPerSec`; the Monte Carlo
 * redraws it from the trader posterior (applyDraw d.r). They were two
 * estimators: the point was the realised fit (nodeecon.realisedCapital: the
 * runs seen from their start — young books only), else this life's live
 * return (stock.js returnPerSec, one young book), while the draws were
 * bayes.traderPosterior over every run — and the draws existed only once the
 * fit had 8 points. Live BN9 2026-09-29: installed at 16:17Z on 'now' 50.26h
 * (point = the live 1.2/h, draws none: the fit was null), and the first pass
 * after the young book's fit reached 8 points (16:32Z) priced the same
 * trajectory at 94.1h (point 1.75/h, draws 0.38/h) — EXIT JUMP AT INSTALL.
 * Now: the posterior (pooled over every run by random effects) is the point
 * (its mean) and the draws; the fit supplies only the warm-up; the fit's rate
 * stands in only where no run has a posterior.
 *
 * AND THE RETURN DEPENDS ON THE BOOK (traderw.js, 2026-09-29): one pooled
 * rate read a $1m book, a $3b one and a $194b one as noisy measurements of
 * one number (0.38-0.53/h), and the exit compounded every book at it — from
 * the final life's ~$1m (where the trader cannot pay its commissions and
 * earns nothing) to the $75t QLink (where the market absorbs ~2% of it an
 * hour). The belief is now the curve r(W) = r0 s(W/W*): the posterior on r0
 * and W* (bayes.traderRwPosterior; prior: the shipped strategy on the game's
 * market, tools/sim/stocks/rw.mjs) is the point (r = r0's mean, Wstar =
 * exp(ln W*'s mean)) and the draws. `regime`: 'pre-long' | '4S-long' (the
 * trader's stock.txt mode). Returns {r, sd, Wstar, shape, regime, warmupH,
 * post, fit, source, why} or null (no trader history).
 */
export function traderBeliefOf(rows, { regime = 'pre-long', warmupH: warmIn = null, ledger = null } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  let fit = null
  try {
    fit = realisedCapital(rows)
  } catch {
    fit = null
  }
  const warmupH = fin(warmIn) ? warmIn : fin(fit?.warmupH) ? fit.warmupH : 0
  // THE CURVE r(W) = r0 s(W/W*) (traderw.js, the game's market simulated):
  // the posterior on r0 and W* is the point (its means) and the draws
  // (makeDraws: r0 and ln W*, correlated). Runs of the other regime (a 4S
  // life, stock.js s4) are not this curve's evidence. `ledger`: the
  // persistent evidence (bayes.rwLedgerOf, progress.js /tel/stock-rw.txt) —
  // the rows' 6h window alone loses the big books' hours as they scroll out.
  const reg = RW_PRIOR[regime] ? regime : 'pre-long'
  const prior = RW_PRIOR[reg]
  const post = traderRwPosterior(rows, { warmupH, prior, regime: reg, ledger: ledger ?? rwLedgerOf(null, rows, { priors: RW_PRIOR, warmupH }), shape: (W, Ws) => rwShape(W, Ws, prior.shape) })
  if (post && fin(post.perSec?.mean) && post.perSec.mean > 0) {
    return { r: post.perSec.mean, sd: post.perSec.sd, Wstar: post.Wstar, shape: prior.shape, regime: reg, warmupH, post, fit, source: post.source, why: `trader r(W) ${post.source} (the draws' own distribution, its means the point): ${post.why}${fit ? `; warm-up ${warmupH.toFixed(3)}h from the realised fit (${(fit.r * 360000).toFixed(1)}%/h on the young runs alone, not the point)` : ''}` }
  }
  return null
}

// A held decision's reason: the decision's own, once — not re-prefixed every
// pass it is held ("held (no event): held (no event): ... stays on").
const heldWhy = (prev) => String(prev?.why ?? '').replace(/^(held \(no event(?: since [^)]*)?\)(?::|; at that decision:) )+/, '')

/**
 * N parameter draws, seeded: draw i is the same vector in every option and in
 * every pass that uses the same seed (the caller seeds per life), which is
 * what makes comparisons paired and re-decisions move only with the data.
 */
export function makeDraws(post, N, seed) {
  const out = []
  for (let i = 0; i < N; i++) {
    // One sub-stream per component, so a component that is absent (or a
    // gamma draw that consumes a variable number of uniforms) never shifts
    // another component's z: draw i stays draw i as posteriors come and go.
    const st = (name) => rngOf((seed ^ hashOf(name) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)
    const zT = normalOf(st('trader'))
    // The forecast error is Student-t (bayes.driftPosterior): s^2 from its
    // IG, then this draw's mixture weight lam ~ Gamma(nu/2, nu/2), so the
    // error drawn is s z / sqrt(lam) — heavy tails in the interval as in the fit.
    const nu = post.drift.nu ?? PRIORS.driftNu
    const lam = gammaOf(nu / 2, st('driftLam')) / (nu / 2)
    const s2 = igDraw(post.drift, st('drift')) / lam
    const si2 = igDraw(post.jitter ?? PRIORS.jitter, st('jitter'))
    const zc = normalOf(st('common'))
    // The install cadence (bayes.cadencePosterior, hierarchical over nodes):
    // this draw's node-level ln(M)/h and life length — the exit spans many
    // lives, so it is the node's mean that is uncertain, not one life's.
    const cad = post.cadence
    // The cadence rate's z, kept: inputs that carry their own cadence belief
    // (inputs.cadence.post, lifeplan.lifeInputsOf — one per life length)
    // draw from it with this same z, so every length is paired.
    const zCad = normalOf(st('cadenceRate'))
    const ln = cad && fin(cad.rate?.mean) && fin(cad.rate?.sd) ? Math.exp(cad.rate.mean + cad.rate.sd * zCad) : null
    const cycleH = cad && fin(cad.life?.mean) && fin(cad.life?.sd) ? Math.exp(cad.life.mean + cad.life.sd * normalOf(st('cadenceLife'))) : null
    // The script exp rate: the formula prior's posterior (bayes.ratePosterior,
    // updated by this life's measurement) when there is one — its spread
    // around the median the inputs carry; else the pass observations' own.
    const e = post.expPost && fin(post.expPost.sd) ? post.expPost.sd * normalOf(st('exp')) : post.exp ? nigDraw(post.exp.post, st('exp')).mu - post.exp.mean : 0
    const repLn = post.rep ? nigDraw(post.rep.post, st('rep')).mu : null
    const gym = post.gymSdLn * normalOf(st('gym'))
    // Income drawn from the previous-lives prior (bayes.incomePrior) — used
    // only where this life's income is not measurable yet (inputs.incomeFromPrior).
    // The reputation estimate's residual (inputs.repFromEstimate only).
    const zRep = normalOf(st('repEstimate'))
    const repResid = Math.exp(PRIORS.repEstimateSdLn * zRep)
    const incomeLn = post.income && fin(post.income.mean) && fin(post.income.sd) ? post.income.mean + post.income.sd * normalOf(st('income')) : null
    const r = post.trader ? Math.max(1e-9, post.trader.perSec.mean + post.trader.perSec.sd * zT) : null
    // The curve's knee, correlated with the level as the posterior has it
    // (bayes.traderRwPosterior rho); its own sub-stream, so no other z moves.
    const tw = post.trader?.lnWstar
    const rho = fin(post.trader?.rho) ? post.trader.rho : 0
    const Wstar = tw && fin(tw.mean) && fin(tw.sd) ? Math.exp(tw.mean + tw.sd * (rho * zT + Math.sqrt(1 - rho * rho) * normalOf(st('traderW')))) : null
    // The contract stream's realised mean over the life (applyDraw): its own
    // sub-stream, so no other component's z moves.
    const zContract = normalOf(st('contract'))
    out.push({ i, seed, r, Wstar, s2, si2, incomeLn, repResid, zRep, zc, zCad, zContract, lnPerHour: ln, cycleH, cadOwnW: fin(cad?.own?.weight) ? cad.own.weight : null, expMult: Math.exp(e), repRate: repLn === null ? null : Math.exp(repLn), gymMult: Math.exp(gym) })
  }
  return out
}

/**
 * The exit inputs under one draw: only the uncertain fields move. The
 * trader's return and the reputation rate are drawn ABSOLUTE from their
 * posteriors (pooled over the life), so one noisy pass measurement (live
 * 13.04 -> 10.72 -> 13.41 rep/s in three passes) moves them by its share of
 * the evidence, not wholesale; the exp rate trends with the level inside a
 * life, so it is the current point times its posterior spread.
 */
export function applyDraw(inputs, d) {
  const o = { ...inputs }
  if (fin(d.r)) o.capitalReturnPerSec = d.r
  // The knee only where the inputs carry the curve (a flat-rate input stays flat).
  if (fin(d.Wstar) && d.Wstar > 0 && fin(inputs.capitalScaleW)) o.capitalScaleW = d.Wstar
  // THE 4S CURVE UNDER THE SAME DRAW (inputs.fourS, exitplan): its prior
  // point moved by this draw's ratio to the pre-4S point — one belief about
  // how far the live market sits from the sim, applied to both regimes.
  if (inputs.fourS && fin(inputs.fourS.r0PerSec)) {
    const kr = fin(d.r) && fin(inputs.capitalReturnPerSec) && inputs.capitalReturnPerSec > 0 ? d.r / inputs.capitalReturnPerSec : 1
    const kw = fin(d.Wstar) && d.Wstar > 0 && fin(inputs.capitalScaleW) && inputs.capitalScaleW > 0 ? d.Wstar / inputs.capitalScaleW : 1
    o.fourS = { ...inputs.fourS, r0PerSec: inputs.fourS.r0PerSec * kr, ...(fin(inputs.fourS.Wstar) ? { Wstar: inputs.fourS.Wstar * kw } : {}) }
  }
  // THE GO RATE BONUS ON g (inputs.goCadenceMult, goplan.goExitInputsOf): the
  // point's ln(M) carries it, so every drawn ln(M) does too.
  const gm = fin(inputs.goCadenceMult) && inputs.goCadenceMult > 0 ? inputs.goCadenceMult : 1
  if (inputs.cadenceFrom === 'purchase model') {
    // The life's length is the purchase model's DECISION (lifeplan), not a
    // random input: kept. What a life of that length buys is this draw's
    // rate from the cadence posterior whose PRIOR is the purchase model
    // (bayes.cadencePosterior modelPrior, its stated structural error) and
    // whose evidence is this node's own gaining lives — the measured cadence
    // moves the model by its precision, it no longer scales the model's gain
    // by a power of its own weight.
    // ONE BELIEF PER LIFE LENGTH: inputs built for a length L carry the
    // posterior AT L (inputs.cadence.post, whose median is the point's
    // multGainPerCycle); the draw takes it with its own z, so the point and
    // the draws are one distribution and every length is paired.
    const cp = inputs.cadence?.post
    if (cp && fin(cp.mean) && fin(cp.sd) && fin(d.zCad) && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.multGainPerCycle = Math.exp(Math.exp(cp.mean + cp.sd * d.zCad) * inputs.cycleHours * gm)
    else if (fin(d.lnPerHour) && d.lnPerHour > 0 && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.multGainPerCycle = Math.exp(d.lnPerHour * inputs.cycleHours * gm)
  } else {
    if (fin(d.cycleH) && d.cycleH > 0 && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.cycleHours = d.cycleH
    if (fin(d.lnPerHour) && d.lnPerHour > 0 && fin(o.cycleHours) && o.cycleHours > 0) o.multGainPerCycle = Math.exp(d.lnPerHour * o.cycleHours * gm)
  }
  if (fin(inputs.expPerSec)) o.expPerSec = inputs.expPerSec * d.expMult
  // THE FACTION-WORK RATE'S OWN POSTERIOR (inputs.repSdLn, progress.js
  // repRatePosterior: the formula x k, k's sd): the point times this draw's
  // residual. It replaces the pass-observation draw below, whose buffer held
  // whatever the worked faction gained — grafting included (live BN9
  // 2026-09-30 17:51Z: 5.96/s against the formula's ~60/s).
  const repPost = fin(inputs.repSdLn) && inputs.repSdLn > 0 && fin(inputs.repPerSec) && fin(d.zRep)
  if (repPost) o.repPerSec = inputs.repPerSec * Math.exp(inputs.repSdLn * d.zRep)
  else if (fin(inputs.repPerSec) && fin(d.repRate)) o.repPerSec = d.repRate
  // The hacking stream is a draw from its posterior (earlier lives, updated
  // by this life's measurement); the flat part measured beside it is kept.
  if (inputs.incomeFromPrior === true && fin(d.incomeLn)) o.incomePerSec = (fin(inputs.incomeFlatPerSec) && inputs.incomeFlatPerSec > 0 ? inputs.incomeFlatPerSec : 0) + Math.exp(d.incomeLn)
  // THE CONTRACT STREAM IS COMPOUND POISSON (contractplan.contractStream):
  // its money over a life of H hours has variance contractMoneyVarPerSec x H
  // x 3600, so the life's mean rate moves by sqrt(var / (H x 3600)) z — never
  // below zero contract money. The flat income carries it too (it is flat).
  if (fin(inputs.contractMoneyVarPerSec) && inputs.contractMoneyVarPerSec > 0 && fin(inputs.contractMoneyPerSec) && inputs.contractMoneyPerSec > 0 && fin(d.zContract) && fin(o.incomePerSec)) {
    const H = fin(o.cycleHours) && o.cycleHours > 0 ? o.cycleHours : 24
    const dx = Math.max(-inputs.contractMoneyPerSec, Math.sqrt(inputs.contractMoneyVarPerSec / (H * 3600)) * d.zContract)
    o.incomePerSec = Math.max(0, o.incomePerSec + dx)
    if (fin(o.flatIncomePerSec)) o.flatIncomePerSec = Math.max(0, o.flatIncomePerSec + dx)
    if (fin(o.incomeFlatPerSec)) o.incomeFlatPerSec = Math.max(0, o.incomeFlatPerSec + dx)
  }
  if (!repPost && inputs.repFromEstimate === true && fin(inputs.repPerSec) && fin(d.repResid)) o.repPerSec = inputs.repPerSec * d.repResid
  return o
}

/**
 * A route's detour under one draw: join legs x the gym residual, and the
 * grind rescaled from the rate it was priced at (`repPoint`) to the drawn one.
 */
export function detourOf(route, d, repPoint = null, repSdLn = null) {
  // With the faction-work posterior's sd (inputs.repSdLn) the grind moves by
  // this draw's residual on it, exactly as applyDraw moves the rate.
  if (fin(route?.joinH) && fin(route?.grindH) && route.grindH > 0 && fin(repSdLn) && repSdLn > 0 && fin(d.zRep)) return route.joinH * d.gymMult + route.grindH / Math.exp(repSdLn * d.zRep)
  if (fin(route?.joinH) && fin(route?.grindH)) return route.joinH * d.gymMult + (route.grindH > 0 && fin(repPoint) && repPoint > 0 && fin(d.repRate) ? (route.grindH * repPoint) / d.repRate : route.grindH)
  return route?.detourH ?? null
}

/**
 * The structural discrepancy of option `key` in draw d: exp(e - var/2),
 * e = sc zc + si z_key. The common part (sc^2 = s^2 - si^2, the exit
 * forecast's measured relative error less the option-specific share) is
 * shared by every option: it moves them together and cancels in a paired
 * comparison. The option-specific part si is MEASURED from the ranking's own
 * pass-to-pass jitter (bayes.jitterPosterior); z_key is seeded by the key,
 * so it does not depend on the order options are listed in.
 */
export function discrepancyOf(d, key) {
  const zi = normalOf(rngOf((d.seed ^ hashOf(key) ^ Math.imul(d.i + 1, 0x85ebca6b)) >>> 0))
  const si2 = Math.min(d.si2 ?? 0, d.s2)
  const sc = Math.sqrt(Math.max(0, d.s2 - si2))
  return Math.exp(sc * d.zc + Math.sqrt(si2) * zi - d.s2 / 2)
}

/**
 * Evaluate the options on the shared draws. Two modes, both PAIRED (common
 * random numbers: draw i is the same parameter vector, and the same
 * structural-noise z for a trajectory, in every option that prices it):
 *
 *   alloc null — every option on every draw, DRAW-MAJOR so a budget stop
 *     leaves all options at the same N (the held passes, the batch choice);
 *   alloc {committed, switchCost, n0, pcs, simBudget} — ADAPTIVE ALLOCATION
 *     (OCBA, Chen et al. 2000, on paired differences as in sequential
 *     Bayesian R&S with CRN, Gorder & Kolonko arXiv:1410.6782): see
 *     ocbaEvaluateGen.
 *
 * options [{key, sim: (d) => hours|null}]. Returns {samples: {key:
 * (number|null)[]}, n, ms, overBudget, raw, alloc}; under adaptive
 * allocation an option's samples are a PREFIX of the draws (draws 0..n_k-1),
 * so any two options compare on the draws both priced.
 */
export function evaluate(options, draws, opts = {}) {
  return drain(evaluateGen(options, draws, opts))
}
/**
 * The generator evaluate drains: yields after every simulation, so the
 * caller can run it in slices (coop.js). `now` is the budget's clock — the
 * pacer's WORK clock in progress.js, so a pause never truncates the draws.
 */
export function* evaluateGen(options, draws, { budgetMs = PLAN.budgetMs, now = clock, alloc = null } = {}) {
  // Keys index the samples: a repeated key merges two trajectories into one
  // array and breaks every per-draw pairing after it (decideInstallGen add).
  // Loud, never merged.
  const dup = options.map((o) => o.key).find((k, i, a) => a.indexOf(k) !== i)
  if (dup !== undefined) throw new Error(`evaluateGen: option key '${dup}' appears twice — two trajectories would share one samples array`)
  if (alloc && alloc.on !== false && options.length > 1) return yield* ocbaEvaluateGen(options, draws, { budgetMs, now, ...alloc })
  const t0 = now()
  const samples = Object.fromEntries(options.map((o) => [o.key, []]))
  const raw = Object.fromEntries(options.map((o) => [o.key, []]))
  let n = 0
  let overBudget = false
  for (const d of draws) {
    if (n >= 2 && now() - t0 > budgetMs) {
      overBudget = true
      break
    }
    for (const o of options) yield* simInto(o, d, samples, raw)
    n++
  }
  return { samples, raw, n, ms: +(now() - t0).toFixed(1), overBudget, alloc: { mode: 'full', sims: n * options.length, full: n * options.length, saved: 0 } }
}

/** One simulation of option o on draw d, appended to its samples (the structural noise keyed by its trajectory). */
function* simInto(o, d, samples, raw) {
  let h = null
  try {
    // o.simGen: the same simulation as a generator that yields inside
    // (one policy priced per step, exitplan.bestExitPolicyGen), so one
    // exit simulation never blocks the page for its whole search.
    h = typeof o.simGen === 'function' ? yield* o.simGen(d) : o.sim(d)
  } catch {
    h = null
  }
  raw[o.key].push(fin(h) ? h : null)
  // The structural noise belongs to the TRAJECTORY (o.noiseKey), not the
  // option's label: the same trajectory priced by two decisions gets the
  // same draws of it, so their exits agree exactly (consistencyOf).
  samples[o.key].push(fin(h) ? h * discrepancyOf(d, o.noiseKey ?? o.key) : null)
  yield
}

/** Φ⁻¹ by bisection on phi (60 halvings of [-8, 8]). */
export function phiInv(p) {
  let lo = -8
  let hi = 8
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (phi(mid) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * ADAPTIVE SIMULATION ALLOCATION. The plan prices on the browser's main
 * thread, and a re-decision spent the same 24 draws on an option 30h behind
 * the incumbent as on its closest rival. Now:
 *
 *   stage 1  n0 paired draws for every option (draw-major);
 *   then     the LEADERS — the committed option and the best alternative by
 *            paired mean net of its switch cost (no incumbent: the best
 *            option) — run draw-major to every draw: they are the pair
 *            decide() gates on and the exits the plan publishes (the
 *            trajectory-consistency and exit-stability checks read them), so
 *            they are priced exactly as the full run prices them. Every other
 *            option gets further draws only while its paired difference with
 *            the best leader is uncertain relative to its mean: OCBA's ratio
 *            n_k ∝ (σ_k/δ_k)², scaled so that each non-leader's
 *            P(correctly behind) = Φ(δ_k √n_k / σ_k) reaches its Bonferroni
 *            share of `pcs`: n_k* = (z σ_k / δ_k)², z = Φ⁻¹(1 − (1−pcs)/(K−L)).
 *            An option promoted to leader mid-run catches up on the draws it
 *            skipped, so the leaders always share their draws.
 *
 * Stops at the draws, the work budget (`budgetMs`; the leaders stay in
 * lockstep) or `simBudget` simulations. CRN is kept: an option's samples are
 * the prefix 0..n_k-1 of the one draw sequence, its noise keyed as before.
 *
 * `alloc` on the result: {mode 'ocba', n0, sims, full (options x the
 * leaders' draws: what the full run spends for the same leaders), saved,
 * savedFrac, pcs (the Bonferroni APCS of the final state), settled,
 * perOption {key: n}, leaders, why}.
 */
export function* ocbaEvaluateGen(options, draws, { budgetMs = PLAN.budgetMs, now = clock, committed = null, switchCost = {}, n0 = PLAN.ocba.n0, pcs: pcsTarget = PLAN.ocba.pcs, simBudget = PLAN.ocba.simBudget } = {}) {
  const t0 = now()
  const N = draws.length
  const K = options.length
  const samples = Object.fromEntries(options.map((o) => [o.key, []]))
  const raw = Object.fromEntries(options.map((o) => [o.key, []]))
  const byKey = new Map(options.map((o) => [o.key, o]))
  const keys = options.map((o) => o.key)
  const inc = committed !== null && byKey.has(committed) ? committed : null
  const costOf = (k) => (inc === null || k === inc ? 0 : fin(switchCost?.[k]) ? switchCost[k] : PLAN.switchCostH)
  const cap = fin(simBudget) && simBudget > 0 ? Math.floor(simBudget) : K * N
  const first = Math.max(2, Math.min(N, fin(n0) ? Math.floor(n0) : 8))
  let sims = 0
  let overBudget = false
  const nOf = (k) => samples[k].length
  const timeUp = () => now() - t0 > budgetMs
  const stop = () => {
    if (sims >= cap) return true
    if (timeUp()) {
      overBudget = true
      return true
    }
    return false
  }
  // STAGE 1: n0 draws for every option, draw-major (the full loop's budget rule: at least 2 draws).
  for (let i = 0; i < first && sims < cap; i++) {
    if (i >= 2 && timeUp()) {
      overBudget = true
      break
    }
    for (let j = 0; j < K && sims < cap; j++) {
      yield* simInto(byKey.get(keys[j]), draws[i], samples, raw)
      sims++
    }
  }
  // Paired (H_b + c_b) - (H_a + c_a) over the draws both priced, feasible in both.
  const pairOf = (a, b) => {
    const m = Math.min(nOf(a), nOf(b))
    let s = 0
    let s2 = 0
    let n = 0
    for (let i = 0; i < m; i++) {
      const x = samples[a][i]
      const y = samples[b][i]
      if (!fin(x) || !fin(y)) continue
      const dd = y + costOf(b) - (x + costOf(a))
      s += dd
      s2 += dd * dd
      n++
    }
    const mean = n ? s / n : null
    const sd = n >= 2 ? Math.sqrt(Math.max(0, (s2 - n * mean * mean) / (n - 1))) : null
    return { mean, sd, n }
  }
  const feasOf = (k) => (nOf(k) ? samples[k].filter(fin).length / nOf(k) : 0)
  // Feasibility (decide: half the draws) still open at this n: within 2 binomial sd of a half.
  const feasOpen = (k) => nOf(k) > 0 && nOf(k) < N && Math.abs(feasOf(k) - 0.5) <= 2 * Math.sqrt(0.25 / nOf(k))
  // THE LEADERS: the incumbent, and the best other feasible option by paired
  // mean net of its switch cost against the option with the most draws.
  const leadersOf = () => {
    // The anchor is FEASIBLE (an infeasible one pairs with nothing); with no
    // feasible option at all every option leads — the full run, unchanged.
    const feasible = keys.filter((k) => feasOf(k) >= 0.5)
    if (!feasible.length) return [...keys]
    const anchor = feasible.reduce((a, k) => (nOf(k) > nOf(a) ? k : a), inc !== null && feasible.includes(inc) ? inc : feasible[0])
    let best = null
    let bestNet = Infinity
    for (const k of keys) {
      if (k === inc || feasOf(k) < 0.5) continue
      const net = k === anchor ? 0 : pairOf(anchor, k).mean
      if (fin(net) && net < bestNet) {
        best = k
        bestNet = net
      }
    }
    const L = []
    if (inc !== null) L.push(inc)
    if (best !== null && !L.includes(best)) L.push(best)
    if (!L.length) L.push(anchor)
    return L
  }
  // The best leader: every non-leader is compared with it, as OCBA compares with the best.
  const refOf = (L) => {
    if (L.length === 1) return L[0]
    const p = pairOf(L[0], L[1])
    return fin(p.mean) && p.mean < 0 ? L[1] : L[0]
  }
  // THE MARGIN A NON-LEADER MUST BE BEHIND BY. Under the expected-loss
  // commitment (COMMIT.rule) an alternative is ranked by its gain over the
  // incumbent LESS its value of waiting (valueOfWaiting), so with the
  // reference an alternative b (it beats the incumbent by mean) an option k
  // can only be chosen over b if gain_k > gain_b - VOW_b: k is out of the
  // running once it is behind b by more than VOW_b (its own net is at most its
  // gain). Under the P(better) rule, or with the incumbent the reference, 0.
  const shiftOf = (ref) => {
    if (inc === null || ref === inc || COMMIT.rule !== 'expected-loss') return 0
    const D = []
    const m = Math.min(nOf(inc), nOf(ref))
    for (let i = 0; i < m; i++) if (fin(samples[inc][i]) && fin(samples[ref][i])) D.push(samples[inc][i] - (samples[ref][i] + costOf(ref)))
    const v = valueOfWaiting(D, { widthMult: COMMIT.widthMult, rho: COMMIT.rho ?? COMMIT.rhoDefault }).vowH
    return fin(v) && v > 0 ? v : 0
  }
  // n_k* for a non-leader against the reference: OCBA's (σ/δ)² ratio at the
  // Bonferroni z, δ the paired gap less the margin above.
  const targetOf = (k, ref, z, shift = 0) => {
    if (feasOf(k) < 0.5) return feasOpen(k) ? N : nOf(k)
    const p = pairOf(ref, k)
    if (!(p.n >= 2) || !fin(p.mean) || !fin(p.sd)) return N
    const gap = p.mean - shift
    // A deterministic difference: settled behind (or tied: the full run's tie-break reads the same draws).
    if (p.sd === 0) return gap >= 0 ? nOf(k) : N
    if (!(gap > 0)) return N
    return Math.min(N, Math.max(first, Math.ceil(((z * p.sd) / gap) ** 2)))
  }
  // P(a non-leader is behind `ref` by more than `shift`), from its paired mean and standard error.
  const behind = (k, ref, shift) => {
    const p = pairOf(ref, k)
    if (!fin(p.mean)) return 0
    const gap = p.mean - shift
    const se = fin(p.sd) && p.n > 0 ? p.sd / Math.sqrt(p.n) : Infinity
    return se === 0 ? (gap >= 0 ? 1 : 0) : phi(gap / se)
  }
  const apcsOf = (L) => {
    const ref = refOf(L)
    const shift = shiftOf(ref)
    let miss = 0
    for (const k of keys) {
      if (L.includes(k)) continue
      if (feasOf(k) < 0.5) {
        if (feasOpen(k)) miss += 0.5
        continue
      }
      miss += 1 - behind(k, ref, shift)
    }
    return Math.max(0, 1 - miss)
  }
  let level = Math.min(...keys.map(nOf))
  // Bounded rounds: each adds a draw to the leaders, or (at the last draw)
  // promotes and catches up a new leader — at most K of those.
  const rounds = N + K + 2
  for (let r = 0; r < rounds && !overBudget && sims < cap; r++) {
    const leaders = leadersOf()
    // Leaders catch up to the level (a promoted leader prices the draws it skipped).
    for (const l of leaders) {
      for (let i = nOf(l); i < level && !stop(); i++) {
        yield* simInto(byKey.get(l), draws[i], samples, raw)
        sims++
      }
    }
    if (overBudget || sims >= cap) break
    // Non-leaders: OCBA targets against the best leader, never past the leaders' level.
    const others = keys.filter((k) => !leaders.includes(k))
    if (others.length) {
      const z = phiInv(1 - (1 - pcsTarget) / others.length)
      const ref = refOf(leaders)
      const shift = shiftOf(ref)
      for (const k of others) {
        const t = Math.min(level, targetOf(k, ref, z, shift))
        for (let i = nOf(k); i < t && !stop(); i++) {
          yield* simInto(byKey.get(k), draws[i], samples, raw)
          sims++
        }
      }
    }
    if (overBudget || sims >= cap) break
    if (level >= N) {
      // Done when the leaders on the final data are all at the last draw.
      if (leadersOf().every((l) => nOf(l) >= N)) break
      continue
    }
    if (stop()) break
    level++
  }
  const leaders = leadersOf()
  const n = Math.min(...leaders.map(nOf))
  const full = n * K
  const pcs = apcsOf(leaders)
  const perOption = Object.fromEntries(keys.map((k) => [k, nOf(k)]))
  const saved = Math.max(0, full - sims)
  const rest = keys.filter((k) => !leaders.includes(k)).map((k) => `${k} ${perOption[k]}`).join(', ')
  return {
    samples,
    raw,
    n,
    ms: +(now() - t0).toFixed(1),
    overBudget,
    alloc: {
      mode: 'ocba',
      n0: first,
      sims,
      full,
      saved,
      savedFrac: full ? +(saved / full).toFixed(3) : 0,
      pcs: +pcs.toFixed(4),
      settled: pcs >= pcsTarget,
      perOption,
      leaders,
      why: `${sims} of ${full} simulations (${saved} saved): ${leaders.join(' & ')} on ${n} draws, the rest ${rest || 'none'}; P(correct selection) >= ${pcs.toFixed(3)} (Bonferroni)${sims >= cap && cap < K * N ? `; stopped by the ${cap}-simulation budget` : ''}${overBudget ? '; stopped by the work budget' : ''}`,
    },
  }
}

const quant = (s, q) => {
  if (!s.length) return null
  const x = (s.length - 1) * q
  const lo = Math.floor(x)
  const hi = Math.ceil(x)
  return s[lo] + (s[hi] - s[lo]) * (x - lo)
}

/**
 * Per option: feasible fraction, mean, 10/50/90%, P(best). An infeasible draw
 * (null) of a mostly-feasible option is filled with 1.5x that option's worst
 * feasible draw — pessimistic, named, never 0.
 *
 * RAGGED SAMPLES (adaptive allocation, ocbaEvaluateGen): an option priced on
 * fewer draws (a prefix) has its feasibility and quantiles over its own
 * draws (`nDraws`), and its meanH is the CRN CONTROL-VARIATE estimate on all
 * N: the mean of an option priced on every draw (the anchor) plus the
 * paired mean difference over the draws both priced (`meanOwnH` keeps its
 * raw mean) — so means on different draw counts compare as the paired
 * differences do, not across different draws. P(best) counts each draw among
 * the options that priced it.
 */
export function summarize(samples) {
  const keys = Object.keys(samples)
  const N = Math.max(0, ...keys.map((k) => samples[k].length))
  const filled = {}
  const out = {}
  for (const k of keys) {
    const xs = samples[k]
    const nk = xs.length
    const ok = xs.filter(fin)
    const pFeasible = nk ? ok.length / nk : 0
    const worst = ok.length ? Math.max(...ok) : null
    filled[k] = pFeasible >= 0.5 ? xs.map((x) => (fin(x) ? x : 1.5 * worst)) : null
    const s = filled[k] ? [...filled[k]].sort((a, b) => a - b) : []
    out[k] = { pFeasible: +pFeasible.toFixed(3), meanH: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3) : null, q10: fin(quant(s, 0.1)) ? +quant(s, 0.1).toFixed(3) : null, q50: fin(quant(s, 0.5)) ? +quant(s, 0.5).toFixed(3) : null, q90: fin(quant(s, 0.9)) ? +quant(s, 0.9).toFixed(3) : null, pBest: 0 }
  }
  const anchor = keys.find((k) => filled[k] && filled[k].length === N) ?? null
  if (anchor !== null) {
    const fa = filled[anchor]
    const meanA = fa.reduce((a, b) => a + b, 0) / N
    for (const k of keys) {
      const fk = filled[k]
      if (!fk || fk.length >= N || !fk.length) continue
      let dsum = 0
      for (let i = 0; i < fk.length; i++) dsum += fk[i] - fa[i]
      out[k] = { ...out[k], meanOwnH: out[k].meanH, meanH: +(meanA + dsum / fk.length).toFixed(3), nDraws: fk.length }
    }
  }
  for (const k of keys) if (!filled[k] && samples[k].length < N) out[k] = { ...out[k], nDraws: samples[k].length }
  for (let d = 0; d < N; d++) {
    let best = null
    for (const k of keys) if (filled[k] && d < filled[k].length && (best === null || filled[k][d] < filled[best][d])) best = k
    if (best !== null) out[best].pBest += 1 / N
  }
  for (const k of keys) out[k].pBest = +out[k].pBest.toFixed(3)
  return { stats: out, filled, N }
}

/**
 * The paired differences H_c,d - (H_a,d + cost) over the draws BOTH priced
 * (adaptive allocation prices some options on a prefix of the draws; with
 * equal counts this is every draw, as before).
 */
export function pairedD(c, a, cost = 0) {
  const m = Math.min(c.length, a.length)
  const D = []
  for (let d = 0; d < m; d++) D.push(c[d] - (a[d] + cost))
  return D
}

/**
 * THE COMMITMENT RULE — which rule decides, and the calibration it reads.
 *   'expected-loss' (default, 2026-10-02): switch to the alternative with the
 *     largest E[D] - VOW > 0, D the CRN paired difference in hours net of the
 *     switch cost (H_committed - (H_alt + c)), VOW the value of waiting one
 *     more re-decide interval for information (valueOfWaiting). Eckman &
 *     Henderson (IJOC 2022): decide on the expected loss, not a probability.
 *   'p-better' (the rule until 2026-10-02): switch only when E[D] > 0 AND
 *     P(D > 0) >= theta. ONE FLAG AWAY: setCommitCalibration({rule:
 *     'p-better'}) restores it; either way every decision records both
 *     verdicts (`commit`), and exitcal.commitLogOf keeps the last 40.
 * widthMult: the exit predictive's width multiplier (exitcal recal.applied —
 * one multiplier on the plan's spreads: the exit interval and D's spread
 * about its mean). rho: the posterior sd's shrink per re-decide interval
 * (exitcal.infoRateOf), rhoDefault (stated) without one. Set once per pass by
 * progress.js (planCtxOf) from the calibration report.
 */
export const COMMIT = { rule: 'expected-loss', widthMult: 1, rho: null, rhoDefault: 0.9, source: 'no calibration set: width x1, rho stated' }
export function setCommitCalibration({ rule = COMMIT.rule, widthMult = 1, rho = null, source = null } = {}) {
  const prev = { ...COMMIT }
  COMMIT.rule = rule === 'p-better' ? 'p-better' : 'expected-loss'
  COMMIT.widthMult = fin(widthMult) && widthMult > 0 ? widthMult : 1
  COMMIT.rho = fin(rho) && rho >= 0 && rho < 1 ? rho : null
  COMMIT.source = source ?? `width x${COMMIT.widthMult}, rho ${COMMIT.rho ?? `${COMMIT.rhoDefault} (stated)`}`
  return prev
}
/** The rule as plan.txt states it. */
export function commitRuleText() {
  const rho = COMMIT.rho ?? COMMIT.rhoDefault
  const el = `switch to the alternative with the largest expected gain net of switch cost less the value of waiting one re-decide interval (rho ${rho}, spread x${COMMIT.widthMult})`
  const pb = `switch only when P(alternative better net of switch cost) >= ${PLAN.theta} and the expected gain is positive`
  return `${COMMIT.rule === 'expected-loss' ? el : pb} [shadow: ${COMMIT.rule === 'expected-loss' ? pb : el}]; re-decide on events (${PLAN.maxAgeMin} min max age)`
}

/**
 * THE VALUE OF WAITING one re-decide interval, a preposterior on the paired
 * draws D (hours, net of the switch cost). Today the posterior of D has sd
 * sigma (x widthMult, the calibration's multiplier on every spread); after
 * one more interval it is rho sigma, so the mean it will then have is drawn
 * with sd tau = sigma sqrt(1 - rho^2) — approximated by the draws' own shape
 * shrunk toward their mean by k = widthMult sqrt(1 - rho^2) (skew kept: a
 * small likely gain over a rare large loss is worth waiting on). Deciding
 * then is worth E[max(mu', 0)]; deciding now max(mu, 0). VOW = the
 * difference (>= 0, Jensen): the expected loss a switch now locks in that the
 * information would have avoided. Waiting itself is charged nothing (stated —
 * a remaining-path gain is not lost by holding one interval).
 * Returns {gainH, vowH, netH, sdH, k}.
 */
export function valueOfWaiting(D, { widthMult = 1, rho = COMMIT.rhoDefault } = {}) {
  const x = (D ?? []).filter(fin)
  const N = x.length
  if (!N) return { gainH: null, vowH: null, netH: null, sdH: null, k: null }
  const m = fin(widthMult) && widthMult > 0 ? widthMult : 1
  const gain = x.reduce((a, b) => a + b, 0) / N
  const k = m * Math.sqrt(Math.max(0, 1 - rho * rho))
  let later = 0
  for (const v of x) later += Math.max(0, gain + k * (v - gain))
  const vow = Math.max(0, later / N - Math.max(0, gain))
  const sd = Math.sqrt(x.reduce((a, v) => a + (v - gain) * (v - gain), 0) / N) * m
  return { gainH: gain, vowH: vow, netH: gain - vow, sdH: sd, k }
}

/** The paired comparison both rules read: per alternative D (net of its switch cost), E[D], P(D > 0). */
function pairedOf(samples, committed, switchCost) {
  const { stats, filled, N } = summarize(samples)
  const feasible = Object.keys(stats).filter((k) => filled[k])
  const argmin = feasible.length ? feasible.reduce((a, k) => (stats[k].meanH < stats[a].meanH ? k : a), feasible[0]) : null
  const alts = []
  let regret = 0
  if (committed !== null && filled[committed]) {
    const c = filled[committed]
    for (const k of feasible) {
      if (k === committed) continue
      const cost = fin(switchCost[k]) ? switchCost[k] : PLAN.switchCostH
      const D = pairedD(c, filled[k], cost)
      const gain = D.reduce((a, b) => a + b, 0) / D.length
      const pWin = D.filter((x) => x > 0).length / D.length
      regret = Math.max(regret, D.reduce((a, b) => a + Math.max(0, b), 0) / D.length)
      alts.push({ key: k, D, gain, pWin, cost })
    }
  }
  return { stats, filled, N, feasible, argmin, alts, regret }
}

/**
 * THE P(BETTER) RULE, exactly as it decided until 2026-10-02 (kept computable:
 * the shadow verdict, and the active rule under COMMIT.rule 'p-better').
 */
export function decideByPBetter({ samples, committed = null, switchCost = {}, theta = PLAN.theta, committedPrevH = null } = {}) {
  const { stats, filled, N, feasible, argmin, alts, regret } = pairedOf(samples, committed, switchCost)
  if (!feasible.length || !N) return { choice: null, switched: false, stays: false, why: 'no option is feasible in half the draws', stats }
  if (committed === null || !filled[committed]) return noIncumbentOf(stats, committed, argmin, committedPrevH)
  let best = null
  for (const a of alts) if (!best || a.gain > best.gain) best = a
  if (best && best.gain > 0 && best.pWin >= theta) {
    const why = `switch ${committed} -> ${best.key}: expected ${best.gain.toFixed(2)}h sooner net of a ${best.cost.toFixed(2)}h switch cost, better in ${(100 * best.pWin).toFixed(0)}% of ${N} paired draws (>= ${(100 * theta).toFixed(0)}%)`
    const sanity = switchSanityOf({ from: committed, to: best.key, gainH: best.gain, exitH: stats[best.key]?.meanH, fromH: stats[committed]?.meanH, prevH: committedPrevH })
    return { choice: best.key, switched: true, stays: false, gainH: +best.gain.toFixed(3), pWin: +best.pWin.toFixed(3), regretH: +regret.toFixed(3), why: sanity ? `${sanity.why} — ${why}` : why, ...(sanity ? { switchSanity: sanity } : {}), stats }
  }
  return {
    choice: committed,
    switched: false,
    stays: true,
    gainH: best ? +best.gain.toFixed(3) : null,
    pWin: best ? +best.pWin.toFixed(3) : null,
    regretH: +regret.toFixed(3),
    why: best ? `stays on ${committed}: the best alternative ${best.key} is expected ${best.gain.toFixed(2)}h ${best.gain >= 0 ? 'sooner' : 'later'} net of a ${best.cost.toFixed(2)}h switch cost and better in ${(100 * best.pWin).toFixed(0)}% of ${N} paired draws (needs a positive gain and ${(100 * theta).toFixed(0)}%)` : `stays on ${committed}: no alternative`,
    stats,
  }
}
function noIncumbentOf(stats, committed, argmin, committedPrevH) {
  const why = committed === null ? `no committed option: the least expected exit (${stats[argmin].meanH}h, P(best) ${stats[argmin].pBest})` : `the committed option ${committed} is no longer feasible (${stats[committed]?.pFeasible ?? 0} of draws): the least expected exit, ${argmin}`
  // An incumbent priced finite last pass and unpriceable now is the same
  // artefact as a 10x gain (an input it needs went missing): flagged.
  const sanity = committed !== null && fin(committedPrevH) ? switchSanityOf({ from: committed, to: argmin, gainH: Infinity, exitH: stats[argmin].meanH, fromH: null, prevH: committedPrevH }) : null
  return { choice: argmin, switched: committed !== null, stays: false, why: sanity ? `${sanity.why} — ${why}` : why, ...(sanity ? { switchSanity: sanity } : {}), stats }
}

/**
 * THE COMMITMENT RULE. `committed` = the key of the option the plan holds (or
 * null); switchCost {key: hours} = what moving TO that option costs beyond
 * its own simulated path. The active rule is COMMIT.rule (see COMMIT); BOTH
 * verdicts are returned in `commit` {rule, switch, agree, old: {switch, key,
 * gainH, pWin}, new: {switch, key, gainH, vowH, netH, sdH, pWin}, widthMult,
 * rho}. Returns {choice, switched, stays, why, gainH, pWin, regretH, vowH,
 * stats, commit}.
 */
export function decide({ samples, committed = null, switchCost = {}, theta = PLAN.theta, committedPrevH = null, rule = COMMIT.rule, widthMult = COMMIT.widthMult, rho = COMMIT.rho ?? COMMIT.rhoDefault } = {}) {
  const old = decideByPBetter({ samples, committed, switchCost, theta, committedPrevH })
  const { stats, filled, N, alts, regret } = pairedOf(samples, committed, switchCost)
  if (old.choice === null || committed === null || !filled[committed]) return { ...old, commit: { rule, switch: old.switched === true, agree: true, why: 'no incumbent to hold: the least expected exit under either rule' } }
  let best = null
  for (const a of alts) {
    const v = valueOfWaiting(a.D, { widthMult, rho })
    if (!best || v.netH > best.netH) best = { ...a, ...v }
  }
  const newSwitch = !!best && best.netH > 0
  const oldSwitch = old.switched === true
  const commit = {
    rule,
    switch: rule === 'p-better' ? oldSwitch : newSwitch,
    agree: oldSwitch === newSwitch && (!newSwitch || old.choice === best.key),
    old: { switch: oldSwitch, key: old.choice, gainH: old.gainH ?? null, pWin: old.pWin ?? null },
    new: best ? { switch: newSwitch, key: best.key, gainH: +best.gainH.toFixed(3), vowH: +best.vowH.toFixed(3), netH: +best.netH.toFixed(3), sdH: +best.sdH.toFixed(3), pWin: +best.pWin.toFixed(3) } : { switch: false, key: null },
    widthMult: +(+widthMult).toFixed(3),
    rho: +(+rho).toFixed(3),
  }
  if (rule === 'p-better') return { ...old, commit }
  const shadow = `[the P >= ${(100 * theta).toFixed(0)}% rule would ${oldSwitch ? `switch to ${old.choice}` : 'hold'}]`
  const vowWhy = (b) => `the ${b.vowH.toFixed(2)}h that waiting one re-decide interval is worth (rho ${commit.rho}, spread x${commit.widthMult}, sd ${b.sdH.toFixed(2)}h)`
  if (newSwitch) {
    const why = `switch ${committed} -> ${best.key}: expected ${best.gainH.toFixed(2)}h sooner net of a ${best.cost.toFixed(2)}h switch cost, more than ${vowWhy(best)}; better in ${(100 * best.pWin).toFixed(0)}% of ${N} paired draws ${shadow}`
    const sanity = switchSanityOf({ from: committed, to: best.key, gainH: best.gainH, exitH: stats[best.key]?.meanH, fromH: stats[committed]?.meanH, prevH: committedPrevH })
    return { choice: best.key, switched: true, stays: false, gainH: +best.gainH.toFixed(3), pWin: +best.pWin.toFixed(3), regretH: +regret.toFixed(3), vowH: +best.vowH.toFixed(3), why: sanity ? `${sanity.why} — ${why}` : why, ...(sanity ? { switchSanity: sanity } : {}), stats, commit }
  }
  return {
    choice: committed,
    switched: false,
    stays: true,
    gainH: best ? +best.gainH.toFixed(3) : null,
    pWin: best ? +best.pWin.toFixed(3) : null,
    regretH: +regret.toFixed(3),
    vowH: best ? +best.vowH.toFixed(3) : null,
    why: best ? `stays on ${committed}: the best alternative ${best.key} is expected ${best.gainH.toFixed(2)}h ${best.gainH >= 0 ? 'sooner' : 'later'} net of a ${best.cost.toFixed(2)}h switch cost, ${best.gainH > 0 ? 'not more than' : 'against'} ${vowWhy(best)}; better in ${(100 * best.pWin).toFixed(0)}% of ${N} paired draws ${shadow}` : `stays on ${committed}: no alternative`,
    stats,
    commit,
  }
}

/**
 * SWITCH SANITY. A switch whose expected gain is more than SWITCH_SANITY.ratio
 * times the exit it switches TO says the incumbent was priced on something
 * other than the plan — an input dropped, a leg unpriceable — not that the
 * plan found 26,000 hours. Live BN9 2026-09-29 14:51Z: "switch committed ->
 * w4: expected 26581.67h sooner" onto a 66h exit, because the incumbent was
 * re-priced without the node's 28 committed grafts (GRAFTS DROPPED).
 *
 * It NEVER BLOCKS the switch: a real collapse of the incumbent (an input that
 * genuinely changed) must still be acted on, and a guard that holds a bad
 * incumbent is worse than the artefact. It is reported: `switchSanity` on the
 * decision record, carried on the held passes after it (the same decision),
 * and a FAIL in planCheck (SWITCH ARTEFACT). Returns null when sane.
 */
export const SWITCH_SANITY = { ratio: 10 }
export function switchSanityOf({ from = null, to = null, gainH, exitH, fromH = null, prevH = null, ratio = SWITCH_SANITY.ratio } = {}) {
  if (!fin(exitH) || !(exitH > 0)) return null
  // gainH Infinity: the incumbent is unpriceable now (no feasible half of the
  // draws) — an artefact when it was priced finite last pass (prevH).
  const unpriced = gainH === Infinity
  if (unpriced ? !fin(prevH) : !fin(gainH) || !(gainH > ratio * exitH)) return null
  return {
    ok: false,
    from,
    to,
    gainH: unpriced ? null : +gainH.toFixed(3),
    exitH: +exitH.toFixed(3),
    fromH: fin(fromH) ? +fromH.toFixed(3) : null,
    prevH: fin(prevH) ? +prevH.toFixed(3) : null,
    ratio,
    why: unpriced
      ? `SWITCH ARTEFACT: ${from} -> ${to}: the incumbent, ${prevH.toFixed(1)}h when last priced, is unpriceable now — probably priced without an input the plan holds (taken, not blocked)`
      : `SWITCH ARTEFACT: ${from} -> ${to} gains ${gainH.toFixed(1)}h against a ${exitH.toFixed(1)}h exit (> ${ratio}x) — the incumbent${fin(fromH) ? ` (${fromH.toFixed(1)}h)` : ''}${fin(prevH) ? `, ${prevH.toFixed(1)}h when last priced,` : ''} was probably priced without an input the plan holds (taken, not blocked)`,
  }
}
/** The switch-sanity flag of a held decision: the one its decision made. */
const heldSanity = (prev) => (prev?.switchSanity?.ok === false ? { switchSanity: prev.switchSanity } : {})

/**
 * RE-DECIDE ON EVENTS, not every pass. prev = the last plan record (or null),
 * cur = {lastAugReset, invitesKey, trader, drift, committedAvailable, now}.
 * Returns the list of events (empty = hold the committed plan).
 */
export function redecideEvents(prev, cur, o = {}) {
  const P = { ...PLAN, ...o }
  const ev = []
  if (!prev) return ['no plan yet']
  if (prev.lastAugReset !== cur.lastAugReset) ev.push('new life (install)')
  if (!prev.decidedAt || (cur.now - Date.parse(prev.decidedAt)) / 60e3 >= P.maxAgeMin) ev.push(`${P.maxAgeMin} min since the last decision`)
  if (cur.committedAvailable === false) ev.push('the committed option is gone (bought, finished or unpriced)')
  if (prev.forceRedecide) ev.push(prev.forceRedecide)
  // A NEW EXIT MODEL re-decides: a held decision was chosen on the old
  // model's arithmetic (live 2026-09-30 18:30Z: 8e594a2 corrected the rep
  // rate, and the L8 / 5-graft decisions made on the broken one would
  // otherwise hold up to maxAgeMin). [PL-VER]
  if (prev.ver != null && cur.ver != null && prev.ver !== cur.ver) ev.push(`the exit model changed (${prev.ver} -> ${cur.ver})`)
  if (prev.invitesKey !== undefined && cur.invitesKey !== undefined && prev.invitesKey !== cur.invitesKey) ev.push('the invitation/joined set changed')
  const pt = prev.posteriors?.trader
  if (pt && cur.trader && Math.abs(cur.trader.perSec.mean - pt.mean) > P.traderMoveSd * Math.max(pt.sd, 1e-12)) ev.push(`trader posterior moved ${((cur.trader.perSec.mean - pt.mean) / pt.sd).toFixed(1)} sd`)
  if (!pt !== !cur.trader) ev.push('trader posterior appeared/vanished')
  // THE CURVE'S KNEE (traderw.js): the exit's money legs past ~$1e11 move
  // with W* while r0 stays put — a move of it is an event as the level's is.
  const lw = cur.trader?.lnWstar
  if (pt && lw && fin(lw.mean)) {
    if (!fin(pt.Wstar)) ev.push("the trader's r(W) curve appeared (the return at the book's own size)")
    else if (Math.abs(lw.mean - Math.log(pt.Wstar)) > P.traderMoveSd * Math.max(fin(pt.lnWstarSd) ? pt.lnWstarSd : lw.sd, 1e-6)) ev.push(`trader curve's knee W* moved $${pt.Wstar.toExponential(2)} -> $${Math.exp(lw.mean).toExponential(2)}`)
  }
  // THE TRADER'S REGIME (traderw.rwRegimeOf: pre-4S / 4S) is a belief about
  // which curve the book compounds on, not a sample on it: a switch is an
  // event whether or not the posterior's mean has moved past traderMoveSd yet
  // (live BN9 2026-09-30 ~01:00Z the 4S purchase fired only through the
  // posterior's 4.5 sd move, which a slower-moving fit would not have).
  if (prev.traderRegime !== undefined && prev.traderRegime !== null && cur.traderRegime !== undefined && cur.traderRegime !== null && prev.traderRegime !== cur.traderRegime) ev.push(`the trader's regime changed ${prev.traderRegime} -> ${cur.traderRegime}`)
  const sPrev = prev.posteriors?.s
  if (fin(sPrev) && cur.drift && (cur.drift.s / sPrev > P.driftMoveFactor || sPrev / cur.drift.s > P.driftMoveFactor)) ev.push(`structural error moved ${(100 * sPrev).toFixed(0)}% -> ${(100 * cur.drift.s).toFixed(0)}%`)
  return ev
}

/**
 * RATIONAL METAREASONING FOR THE SCHEDULED RE-DECIDE (Hay, Russell, Tolpin &
 * Shimony, UAI 2012; Callaway et al. 2018). The plan re-decides on events —
 * those always run — and, failing any, every PLAN.maxAgeMin. That timer's
 * re-decision is a computation with a price: a full Monte Carlo over every
 * option, on the game's main thread. Its VALUE is what it could recover: the
 * committed choice changes only if an alternative turns out better, so per
 * decision and alternative, with the paired margin D = H_alt + switch cost -
 * H_choice ~ N(m, s²) as the deciding pass priced it (marginsOf: s is the
 * per-draw spread, the whole posterior uncertainty of the difference — far
 * more than one re-decision's new data can move it, so this over-states the
 * value, never under-states it):
 *
 *   VOC = Σ E[max(0, -D)] = Σ s φ(m/s) - m Φ(-m/s)        (exit hours)
 *
 * — the probability a re-decision changes the action times the gain when it
 * does. COST = the last re-deciding pass's plan work in hours x
 * PLAN.voc.stallCostH (exit-hours per hour of main-thread stall, stated).
 * SKIP iff VOC < COST. Never skipped: any event that is not the timer (a new
 * life / install, a model-version change, a committed option gone, a route,
 * node, regime, posterior or stream change — every one of them is new
 * evidence or a new structure); a decision whose margins are unknown (a
 * record from before the gate, a margin that could not be priced); and past
 * PLAN.voc.maxSkipH since the last decision.
 *
 * prev: the last plan record; events: redecideEvents(prev, cur).
 * Returns {verdict: 'none' | 'run' | 'skip', skip, voc, costH, costMs, per
 * {decision: VOC}, ageH, why}.
 */
export const isScheduledEvent = (e) => typeof e === 'string' && / min since the last decision$/.test(e)
/** E[max(0, -D)] for D ~ N(m, s²): the expected gain a re-decision recovers on one margin. */
export function marginVoc(m, s) {
  if (!fin(m)) return Infinity
  if (!fin(s) || s <= 0) return Math.max(0, -m)
  const z = m / s
  return Math.max(0, s * Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI) - m * phi(-z))
}
export const VOC_DECISIONS = ['install', 'countRoute', 'lifeLength', 'grafts', 'gang', 'sleeveObjective', 'fourS', 'bladeRoute']
export function redecideGateOf(prev, events, { now = Date.now(), costMs = null, voc = PLAN.voc } = {}) {
  const ev = Array.isArray(events) ? events : []
  if (!ev.length) return { verdict: 'none', skip: false, voc: null, costH: null, why: 'no event: the committed plan is held' }
  const other = ev.filter((e) => !isScheduledEvent(e))
  if (other.length) return { verdict: 'run', skip: false, voc: null, costH: null, why: `re-decides on ${other.length === 1 ? 'an event' : `${other.length} events`} (never gated): ${other.join('; ').slice(0, 200)}` }
  if (!voc || voc.on === false) return { verdict: 'run', skip: false, voc: null, costH: null, why: 'the value-of-computation gate is off (PLAN.voc.on)' }
  if (!prev) return { verdict: 'run', skip: false, voc: null, costH: null, why: 'no previous plan to read margins from' }
  const ageH = (now - Date.parse(prev.decidedAt ?? '')) / 3.6e6
  if (!(ageH < voc.maxSkipH)) return { verdict: 'run', skip: false, voc: null, costH: null, ageH: fin(ageH) ? +ageH.toFixed(3) : null, why: `the last decision is ${fin(ageH) ? ageH.toFixed(2) : '?'}h old (>= ${voc.maxSkipH}h): re-decided whatever its value` }
  const cMs = fin(costMs) && costMs > 0 ? costMs : PLAN.budgetMs
  const costH = (cMs / 3.6e6) * voc.stallCostH
  const per = {}
  const unknown = []
  let total = 0
  for (const name of VOC_DECISIONS) {
    const d = prev.decisions?.[name]
    // Only the Monte Carlo decisions (their priced option rows) are what the timer re-decides.
    if (!d || d.key === null || d.key === undefined || d.applicable === false || !Array.isArray(d.options)) continue
    if (!Array.isArray(d.margins)) {
      unknown.push(name)
      continue
    }
    let v = 0
    for (const m of d.margins) v += marginVoc(m?.meanH, m?.sdH)
    per[name] = +v.toPrecision(3)
    total += v
  }
  const base = { voc: fin(total) ? +total.toPrecision(3) : null, costH: +costH.toPrecision(3), costMs: Math.round(cMs), per, ageH: +ageH.toFixed(3) }
  if (unknown.length) return { verdict: 'run', skip: false, ...base, voc: null, why: `margins unknown for ${unknown.join(', ')} (a record from before the gate, or unpriced): re-decided` }
  const skip = fin(total) && total < costH
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0]
  const why = skip
    ? `skipped the scheduled re-decide: value of computation ${total.toExponential(2)}h < its cost ${costH.toExponential(2)}h (${Math.round(cMs)}ms of main thread x ${voc.stallCostH}) — every committed margin is far outside its posterior spread${top ? ` (largest: ${top[0]} ${top[1]}h)` : ''}`
    : `ran the scheduled re-decide: value of computation ${fin(total) ? total.toExponential(2) : '?'}h >= its cost ${costH.toExponential(2)}h${top ? ` (largest: ${top[0]} ${top[1]}h)` : ''}`
  return { verdict: skip ? 'skip' : 'run', skip, ...base, why }
}
/**
 * The gate's record on the plan (plan.txt redecideGate): this pass's verdict,
 * since when the timer's re-decides have been skipped (null once one runs),
 * and a short log of verdicts.
 */
export function redecideGateRecordOf(prevRec, gate, at, max = 24) {
  const last = prevRec?.redecideGate ?? null
  const skippedSince = gate?.skip ? last?.skippedSince ?? at : null
  const skips = gate?.skip ? (last?.skips ?? 0) + 1 : 0
  const entry = { at, verdict: gate?.verdict ?? 'none', voc: gate?.voc ?? null, costH: gate?.costH ?? null }
  const log = gate?.verdict && gate.verdict !== 'none' ? [...(Array.isArray(last?.log) ? last.log : []), entry].slice(-max) : Array.isArray(last?.log) ? last.log : []
  return { ...gate, at, skippedSince, skips, log }
}

/**
 * THE CARRIED STREAMS AS AN EVENT. exitInputsOf carries the plan's committed
 * money streams (carriedIncome {name: [{atH, perSec}]}: the gang's simulated
 * income, the sleeves on crime) into every exit; a stream re-simulated on a
 * new state (the gang's respect 5.15e4 -> 2.63e5 across gang.js's restart,
 * live 2026-09-29 20:22 -> 20:27Z) moved the held exit 33.1h -> 43.7h with
 * nothing re-deciding (EXIT UNSTABLE). A stream's mean $/s over the next
 * 4h and 24h is its summary; one that moved by more than `rel` (or
 * appeared, or vanished) is an event: the plan re-decides on it, as on a
 * moved posterior.
 */
export const STREAM_EVENT = { rel: 0.25, horizons: [4, 24] }
export function streamSummaryOf(carried, horizons = STREAM_EVENT.horizons) {
  if (!carried || typeof carried !== 'object') return {}
  const out = {}
  for (const [name, list] of Object.entries(carried)) {
    if (!Array.isArray(list) || !list.length) continue
    const xs = list.filter((x) => fin(x?.atH) && fin(x?.perSec)).sort((a, b) => a.atH - b.atH)
    for (const H of horizons) {
      let area = 0
      for (let i = 0; i < xs.length; i++) {
        const a = Math.max(0, xs[i].atH)
        const b = Math.min(H, i + 1 < xs.length ? xs[i + 1].atH : H)
        if (b > a) area += Math.max(0, xs[i].perSec) * (b - a)
      }
      out[`${name}@${H}h`] = +(area / H).toPrecision(4)
    }
  }
  return out
}
export function streamEventsOf(prev, cur, rel = STREAM_EVENT.rel) {
  if (!prev || typeof prev !== 'object' || !cur || typeof cur !== 'object') return []
  const ev = []
  for (const name of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    const a = prev[name] ?? 0
    const b = cur[name] ?? 0
    if (a === b) continue
    const m = Math.max(a, b)
    if (m > 0 && Math.abs(b - a) / m > rel) ev.push(`carried stream '${name.replace(/@.*/, '')}' moved $${a.toExponential(2)}/s -> $${b.toExponential(2)}/s (mean over the next ${name.replace(/.*@/, '')})`)
  }
  return ev
}

/** The posterior summary a plan record carries (and redecideEvents compares). */
export function posteriorSummary(post) {
  return {
    trader: post.trader ? { mean: post.trader.perSec.mean, sd: post.trader.perSec.sd, perHour: +post.trader.perHour.mean.toFixed(4), Wstar: fin(post.trader.Wstar) ? +post.trader.Wstar.toPrecision(4) : null, lnWstarSd: fin(post.trader.lnWstar?.sd) ? +post.trader.lnWstar.sd.toFixed(3) : null, rho: post.trader.rho ?? null, rw: post.trader.table ?? null, source: post.trader.source ?? null, lives: post.trader.lives, why: post.trader.why } : null,
    s: post.drift.s,
    driftWhy: post.drift.why,
    driftExcluded: post.drift.excluded ?? null,
    driftNu: post.drift.nu ?? null,
    cadence: post.cadence ? { lnPerHour: post.cadence.lnPerHour, rateSdLn: post.cadence.rate.sd, cycleHours: post.cadence.cycleHours, lifeSdLn: post.cadence.life.sd, ownWeight: post.cadence.own.weight, ownLives: post.cadence.own.gained, stalls: post.cadence.own.stalls, dups: post.cadence.dups, modelPrior: post.cadence.modelPrior ?? null, why: post.cadence.why } : null,
    exp: post.expPost ? { perSec: post.expPost.perSec, sdLn: +post.expPost.sd.toFixed(3), measuredWeight: post.expPost.measuredWeight ?? 0, why: post.expPost.why } : post.exp ? { n: post.exp.n, sdLn: post.exp.sd } : null,
    rep: post.rep ? { n: post.rep.n, sdLn: post.rep.sd } : null,
    gymSdLn: post.gymSdLn,
    income: post.income ? { perSec: post.income.perSec, sdLn: +post.income.sd.toFixed(3), lives: post.income.lives, source: post.income.source ?? null, measuredWeight: post.income.measuredWeight ?? 0, why: post.income.why } : null,
    optionErr: post.jitter ? { si: post.jitter.si, n: post.jitter.n, why: post.jitter.why } : null,
    stated: 'priors in bayes.js PRIORS / docs/bayes.md; the gym residual is NOT CALIBRATED (a stated prior)',
    missing: post.missing,
  }
}

/** Append an observation {at, v} to a same-life buffer, capped. */
export function withObs(buf, v, at, max = 48, tags = {}) {
  const b = Array.isArray(buf) ? buf : []
  return fin(v) && v > 0 ? [...b, { at, v, ...tags }].slice(-max) : b
}

// ---------------------------------------------------------------------------
// THE DECISIONS. Each takes this pass's point results (the existing searches
// chose each option's inner policy: composition n, life length), evaluates
// the options on the shared draws, and applies the commitment rule. With no
// event (redecide false) only the committed option is evaluated — its
// distribution is published fresh every pass, the choice is not re-made.
// ---------------------------------------------------------------------------

const r3 = (x) => (fin(x) ? +x.toFixed(3) : null)

/** The evaluation's adaptive allocation for a re-decision (null: every option on every draw). */
const allocOf = (ocba, committed, switchCost = {}) => (ocba && ocba.on !== false ? { ...ocba, committed, switchCost } : null)

/**
 * THE CHOICE'S MARGINS, for the value-of-computation gate (redecideGateOf):
 * per alternative a, the paired D = (H_a + switch cost) - H_choice over the
 * draws both priced (mean and per-draw sd: the posterior spread of the
 * difference), closest first, up to `max`. [] = no alternative was priced.
 */
export function marginsOf(samples, choice, { switchCost = {}, defaultCost = PLAN.switchCostH, max = 4 } = {}) {
  const { filled } = summarize(samples)
  const c = filled[choice]
  if (!c) return null
  const out = []
  for (const k of Object.keys(filled)) {
    if (k === choice || !filled[k]) continue
    const cost = fin(switchCost[k]) ? switchCost[k] : defaultCost
    const D = pairedD(filled[k], c, -cost)
    if (D.length < 2) continue
    const m = D.reduce((a, b) => a + b, 0) / D.length
    const v = D.reduce((a, b) => a + (b - m) * (b - m), 0) / (D.length - 1)
    out.push({ alt: k, meanH: +m.toFixed(3), sdH: +Math.sqrt(v).toFixed(3), n: D.length })
  }
  return out.sort((a, b) => a.meanH - b.meanH).slice(0, max)
}
/**
 * A pass's adaptive allocation over its decisions (plan.txt cpu.alloc): the
 * simulations run against what the full run would have spent for the same
 * leaders' draws, and the weakest P(correct selection). Null when no decision
 * this pass ran the adaptive allocation (a held pass).
 */
export function allocSummaryOf(decisions) {
  let sims = 0
  let full = 0
  let pcsMin = null
  const per = {}
  for (const [name, d] of Object.entries(decisions ?? {})) {
    const a = d?.alloc
    if (!a || a.mode !== 'ocba' || d.held === true) continue
    sims += a.sims
    full += a.full
    if (fin(a.pcs)) pcsMin = pcsMin === null ? a.pcs : Math.min(pcsMin, a.pcs)
    per[name] = { sims: a.sims, full: a.full, pcs: a.pcs }
  }
  const n = Object.keys(per).length
  if (!n) return null
  const saved = Math.max(0, full - sims)
  return { decisions: n, sims, full, saved, savedFrac: full ? +(saved / full).toFixed(3) : 0, pcsMin, per, why: `${sims} of ${full} simulations over ${n} re-decided decision(s) (${full ? ((100 * saved) / full).toFixed(0) : 0}% saved by the adaptive allocation), weakest P(correct selection) ${pcsMin ?? '?'}` }
}
export const routeKey = (r) => `${r?.name ?? ''}|${r?.faction ?? ''}|${r?.via ?? ''}`

// Every row carries the trajectory it priced (noiseKey) and the pass that
// priced it (pricedAt): a decision's options are published only as priced
// with its committed exit, on its basis (optionsBasisOf: OPTIONS OFF BASIS).
function optionRows(options, stats, pointOf, pricedAt = null) {
  return options.map((o) => ({ key: o.key, pointH: r3(pointOf(o)), ...stats[o.key], noiseKey: o.noiseKey ?? null, pricedAt })).sort((a, b) => (a.meanH ?? Infinity) - (b.meanH ?? Infinity))
}
/**
 * A HELD DECISION, published on THIS pass's pricing only. It used to carry
 * the options (and the switching rule's numbers) of the pass that decided,
 * beside a committed exit re-priced every pass on moved inputs: live BN9
 * 2026-09-29 19:22Z the held install read 70.98h while its options (from
 * 18:52Z, every one ~3x its point) said 241-373h and its reason "the best
 * alternative w13.41 is expected 63.73h sooner" — a 63h gain against a 71h
 * exit, on another basis. Now: the options are this pass's rows (the
 * committed option alone when held), and the decision's own reason is kept
 * dated, as what it said then.
 */
function heldFields(prev, rows, pricedAt) {
  return { held: true, why: `held (no event since ${prev?.decidedAt ?? '?'}); at that decision: ${heldWhy(prev)}`.slice(0, 400), decidedAt: prev?.decidedAt ?? null, options: rows, pricedAt, ...(prev && 'margins' in prev ? { margins: prev.margins } : {}) }
}
const pick = (r) => (r ? { name: r.name, faction: r.faction ?? null, via: r.via ?? null, price: fin(r.price) ? Math.round(r.price) : null, detourH: r3(r.detourH), joinH: r3(r.joinH), grindH: r3(r.grindH) } : {})

/**
 * WHICH DISTINCT AUGMENTATION FINISHES THE COUNT, committed. `point` is
 * countexit.bestCountRoute's result on the point inputs (its `tried` carries
 * each route's life length); `routes` this pass's route objects (a committed
 * route's detour is its REMAINING detour from the current state). Returns the
 * decision record for /tel/plan.txt.
 */
export function decideRoute(o = {}) {
  return drain(decideRouteGen(o))
}
/** The generator decideRoute drains (yields inside the Monte Carlo). */
export function* decideRouteGen({ inputs, count, routes, point, repPoint = null, prev = null, draws, redecide = true, budgetMs = PLAN.budgetMs, topK = PLAN.topK, theta = PLAN.theta, now = Date.now(), clock: budgetClock = clock, ocba = PLAN.ocba } = {}) {
  const byKey = new Map((routes ?? []).map((r) => [routeKey(r), r]))
  const lifeOf = new Map((point?.tried ?? []).map((t) => [routeKey(t), t.lifeH ?? null]))
  const pointH = new Map((point?.tried ?? []).map((t) => [routeKey(t), t.hours]))
  const committedKey = prev?.key && byKey.has(prev.key) ? prev.key : null
  const sim = (route) => (d) => routeExitFixed(bestExitPolicy, applyDraw(inputs, d), count, route, { lifeH: lifeOf.get(routeKey(route)) ?? null, detourH: detourOf(route, d, repPoint, inputs?.repSdLn ?? null) })
  // The same simulation yielding per policy (up to 7 afford-waits of a whole
  // count-aware search each, in one step as `sim`).
  const simGen = (route) => (d) => routeExitFixedGen(bestExitPolicyGen, applyDraw(inputs, d), count, route, { lifeH: lifeOf.get(routeKey(route)) ?? null, detourH: detourOf(route, d, repPoint, inputs?.repSdLn ?? null) })
  let keys = []
  if (!redecide && committedKey) keys = [committedKey]
  else {
    for (const t of point?.tried ?? []) {
      const k = routeKey(t)
      if (t.hours !== null && byKey.has(k) && !keys.includes(k)) keys.push(k)
      if (keys.length >= topK) break
    }
    if (committedKey && !keys.includes(committedKey)) keys.push(committedKey)
  }
  if (!keys.length) return { key: null, why: `no priced route (${point?.why ?? 'none'})`, decidedAt: prev?.decidedAt ?? null }
  const options = keys.map((k) => ({ key: k, sim: sim(byKey.get(k)), simGen: simGen(byKey.get(k)) }))
  const ev = yield* evaluateGen(options, draws, { budgetMs, now: budgetClock, alloc: !redecide && committedKey ? null : allocOf(ocba, committedKey) })
  const { stats } = summarize(ev.samples)
  const pricedAt = new Date(now).toISOString()
  const rows = optionRows(options, stats, (o) => pointH.get(o.key), pricedAt)
  const cpu = { n: ev.n, ms: ev.ms, overBudget: ev.overBudget, alloc: ev.alloc }
  if (!redecide && committedKey) {
    return { ...pick(byKey.get(committedKey)), key: committedKey, ...stats[committedKey], ...heldFields(prev, rows, pricedAt), ...heldSanity(prev), ...cpu }
  }
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta, committedPrevH: fin(prev?.meanH) ? prev.meanH : null })
  if (d.choice === null) return { key: null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...cpu }
  return { ...pick(byKey.get(d.choice)), key: d.choice, ...stats[d.choice], held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, vowH: d.vowH ?? null, margins: marginsOf(ev.samples, d.choice), ...(d.commit ? { commit: d.commit } : {}), why: d.why, ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...cpu }
}

/**
 * WHEN TO INSTALL, committed. `point` {now: {n, lifeH, hours}, waits: [{waitH,
 * n, lifeH, hours, installGains}], never: {hours} | null} from this pass's
 * searches; `count` the count model (null where the count is met or there is
 * no count gate). The committed install time `prev.installAt` (absolute ms)
 * is its own option, priced on its REMAINING wait. Returns {key, install
 * (true = now), installAt, ...stats, why}.
 */
export function decideInstall(o = {}) {
  return drain(decideInstallGen(o))
}
/** The generator decideInstall drains (yields inside the Monte Carlo). */
export function* decideInstallGen({ inputs, count = null, point, repPoint = null, prev: prev0 = null, draws, redecide = true, budgetMs = PLAN.budgetMs, theta = PLAN.theta, now = Date.now(), sameLife = true, clock: budgetClock = clock, installTopK = PLAN.installTopK, installReach = PLAN.installReach, reachSd = null, route: onRoute = null, trajOf = null, ocba = PLAN.ocba } = {}) {
  const opts = []
  const ctx = { count, repPoint }
  // THE ROUTE THE OPTIONS ARE PRICED ON. 'blade' (the committed Bladeburner
  // route, progress.js bladeInstallCompareOf): every option is the black-op
  // exit (bbplan.bladeExit through `trajOf`), the install's effect on THAT
  // trajectory. A record priced on the other route is not this decision's
  // incumbent: its commitment is another model's exit (no hold, no carry) —
  // the route switch re-decides.
  const routeOf = (r) => r?.route ?? 'hack'
  const prev = prev0 && routeOf(prev0) !== (onRoute ?? 'hack') ? null : prev0
  const tOf = (spec) => (trajOf ? trajOf(spec, ctx) : { f: trajectoryOf(spec, ctx), fg: trajectoryGenOf(spec, ctx), noiseKey: noiseKeyOf(spec, inputs) })
  // Every option is a TRAJECTORY SPEC (trajectoryOf): the same spec prices the
  // same trajectory wherever it is used — here, and as the basis of every
  // other decision this plan makes (the graft decision prices on the
  // committed install's spec).
  // ONE KEY, ONE TRAJECTORY. Two waits of the same length (two faction holds
  // both at 4.99h, the lifeplan target on a round wait) were two options
  // under one key: evaluateGen pushed both into one samples array (48 of 24
  // draws), summarize read every single-key option as feasible in 24/48 = 0.5
  // (or 24/72 = 0.333 beside a triple) and decide() paired draw d of one
  // option with draw d/2 of another. Live BN9 2026-09-29 19:27Z: the held
  // incumbent, 71.0h and feasible in every draw, read "no longer feasible
  // (0.333 of draws)" — SWITCH ARTEFACT committed -> w3.32. The same spec
  // twice is priced once; the same length with another batch gets its own key.
  const add = (key0, spec, pointH, extra = {}) => {
    let key = key0
    const same = opts.find((o) => o.key === key0)
    if (same) {
      if (JSON.stringify(same.spec) === JSON.stringify(spec)) return
      let k = 2
      while (opts.some((o) => o.key === `${key0}#${k}`)) k++
      key = `${key0}#${k}`
    }
    const { f, fg, noiseKey, se } = tOf(spec)
    opts.push({ key, spec, pointH, noiseKey, ...(typeof se === 'function' ? { seOf: se } : {}), sim: (d) => f(applyDraw(inputs, d), d), simGen: (d) => fg(applyDraw(inputs, d), d), ...extra })
  }
  const P0 = point ?? {}
  // A point option's Bladeburner content (bladeInstallCompareOf): rides the spec, so the record keeps it (basisOf).
  const bladeOf = (x) => (x?.blade ? { blade: x.blade } : {})
  if (P0.now && fin(P0.now.hours)) add('now', { kind: 'wait', installAt: now, waitH: 0, n: P0.now.n ?? null, lifeH: P0.now.lifeH ?? null, gains: null, ...bladeOf(P0.now) }, P0.now.hours)
  for (const w of P0.waits ?? []) {
    if (!(fin(w?.waitH) && w.waitH > 0 && fin(w.hours))) continue
    if (w.route && count) {
      // INSTALL ONCE THE ROUTE'S DETOUR IS DONE (+ extra): the wait is the
      // drawn detour, so the route's own uncertainty rides this option.
      const extra = fin(w.extra) ? w.extra : 0
      add(`r${extra}`, { kind: 'route', route: w.route, routeKey: routeKey(w.route), extra, lifeH: w.lifeH ?? null }, w.hours, { routeKey: routeKey(w.route), extra })
      continue
    }
    // A HOLD WAIT CARRIES ITS HOLD (factionplan.holdCandidates: the slot
    // grinds `hold.faction` to `hold.repTarget` for the wait): its batch buys
    // what that grind unlocks, so the commitment is the grind too — the
    // record keeps it (basisOf), the work slot enacts it (installHoldOf), and
    // the committed batch is re-planned on the grind actually running. It was
    // dropped: live BN9 2026-09-30 09:14Z, 10:10Z and 11:50Z the plan switched
    // to a BitRunners hold (Neural Accelerator, hacking x1.277) the slot never
    // worked, the next pass re-priced the commitment as a plain wait (x1.138,
    // +3.3h), and 30 min later the same hold won again: INSTALL DEFERRED
    // REPEATEDLY.
    add(`w${w.waitH}`, { kind: 'wait', installAt: now + w.waitH * 3.6e6, waitH: w.waitH, n: w.n ?? null, lifeH: w.lifeH ?? null, gains: w.installGains ?? null, ...(w.hold ? { hold: w.hold } : {}), ...bladeOf(w) }, w.hours)
  }
  if (!count && P0.never && fin(P0.never.hours)) add('never', { kind: 'never' }, P0.never.hours)
  // The committed install time, on its remaining wait. A route option is
  // relative to its own detour, so it is committed by key while the route
  // is the same.
  let committedKey = null
  // The committed install ran out its wait this pass: 'now' IS the committed
  // trajectory (same act, same batch function), not a switch to another one.
  let elapsed = false
  if (sameLife && prev && typeof prev.key === 'string' && prev.key.startsWith('r') && opts.some((o) => o.key === prev.key && o.routeKey === prev.routeKey)) committedKey = prev.key
  else if (sameLife && prev && (fin(prev.installAt) || prev.key === 'never')) {
    if (prev.key === 'never') committedKey = opts.some((o) => o.key === 'never') ? 'never' : null
    else {
      const spec = basisOf(prev, now)
      if (spec && spec.waitH <= 0.05) {
        committedKey = opts.some((o) => o.key === 'now') ? 'now' : null
        elapsed = committedKey === 'now'
      } else if (spec) {
        // THE COMMITTED INSTALL BUYS WHAT THE PLANNER BUYS AT ITS INSTALL
        // POINT — re-planned this pass (point.gainsAt, the same batch function
        // as every wait option and, at wait 0, as 'now'), not the batch frozen
        // when it was first chosen. Frozen, the commitment priced a batch the
        // purchase step never buys: live BN9 2026-09-29 the committed w0.166
        // carried hacking x1.397 / income x1.951 (70.6h) while the 18 augs
        // actually bought at 05:41 were x1.02 / x1.06 (104h installing).
        // point.committedGains: the caller's batch at this remaining wait,
        // computed outside the sliced search (a purchase plan is one long
        // synchronous step); point.gainsAt(waitH) where no precomputed one.
        const g = count !== null ? null : P0.committedGains ?? (typeof P0.gainsAt === 'function' ? P0.gainsAt(spec.waitH) : null)
        const specNow = g ? { ...spec, gains: g } : spec
        // Through the trajectory's GENERATOR: on the blade route the point is
        // a mean over Q member simulations (bbplan.BLADE_ENSEMBLE), and the
        // synchronous `f` ran them in one step before this generator's first
        // yield — live BN14.1 2026-10-04: PLAN BLOCKED THE PAGE, 154.5ms in
        // 'plan-install' step 1 (77.1ms with one simulation). The same
        // numbers; the page gets the thread back between them.
        let pointH = null
        try {
          pointH = yield* tOf(specNow).fg(inputs)
        } catch {
          pointH = null
        }
        add('committed', specNow, fin(pointH) ? pointH : null)
        committedKey = 'committed'
      }
    }
  }
  if (!opts.length) return { key: null, install: false, why: 'no install option priced', decidedAt: prev?.decidedAt ?? null }
  const screen = !redecide && committedKey ? null : installScreenOf(opts, committedKey, { topK: installTopK, reach: installReach, sd: reachSd })
  const use = screen ? screen.use : opts.filter((o) => o.key === committedKey)
  const ev = yield* evaluateGen(use, draws, { budgetMs, now: budgetClock, alloc: screen ? allocOf(ocba, committedKey) : null })
  const { stats } = summarize(ev.samples)
  const pricedAt = new Date(now).toISOString()
  const rows = optionRows(use, stats, (o) => o.pointH, pricedAt)
  const record = (key, extra) => {
    const o = opts.find((x) => x.key === key)
    const sp = o.spec
    const installAt = sp.kind === 'wait' ? sp.installAt : null
    const waitH = sp.kind === 'wait' ? sp.waitH : sp.kind === 'route' ? o.pointH : null
    const { route, ...specOut } = sp
    const outKey = key === 'committed' ? `w${r3(sp.waitH)}` : key
    // THE COMMITMENT: the exit this plan priced for the install it committed
    // to (mean over the draws and the point), and when. Refreshed every pass
    // the plan holds an install point; carried unchanged through the pass on
    // which the committed wait runs out ('now' by elapse), so the exit the
    // install actor acts on can be compared with the exit the plan committed
    // to for the same act (installExitsOf: TWO EXITS AT INSTALL). A 'now'
    // chosen by a switch starts a new commitment.
    // A record from before commitments were published: its own exit, undated.
    const pc = prev?.commitment ?? (prev && prev.key !== 'now' && fin(prev.meanH) ? { key: prev.key, meanH: prev.meanH, pointH: null, at: null, installAt: prev.installAt ?? null, noiseKey: prev.noiseKey ?? null, n: prev.n ?? null } : null)
    const carried = key === 'now' && elapsed && pc && fin(pc.meanH) && (!pc.at || now - Date.parse(pc.at) <= 60 * 60e3)
    // THE POINT'S OWN MONTE CARLO ERROR (a trajectory that is a mean over
    // members, progress.js bladeInstallCompareOf: their sd over sqrt(Q)) —
    // what a re-pricing of the same trajectory moves by with no news; the
    // exit checks and the calibration read it (installExitsOf, exitcal).
    let pointSeH = null
    try {
      pointSeH = typeof o.seOf === 'function' ? o.seOf() : null
    } catch {
      pointSeH = null
    }
    pointSeH = fin(pointSeH) ? r3(pointSeH) : null
    const commitment = carried ? pc : { key: outKey, meanH: stats[key]?.meanH ?? null, pointH: r3(o.pointH), ...(pointSeH !== null ? { pointSeH } : {}), q10: stats[key]?.q10 ?? null, q90: stats[key]?.q90 ?? null, at: new Date(now).toISOString(), installAt, noiseKey: o.noiseKey, n: ev.n }
    return { key: outKey, ...(onRoute ? { route: onRoute } : {}), install: key === 'now', installAt, waitH: r3(waitH), routeKey: o.routeKey ?? null, extra: o.extra ?? null, fixed: { n: sp.n ?? null, lifeH: sp.lifeH ?? null }, gains: sp.gains ?? null, gainsKey: gainsKeyOf(sp.gains), samples: samplesOf(ev.samples[key]), ...(key === 'now' && !sp.gains && count === null ? { batchGains: inputs?.installGains ?? null } : {}), spec: specOut, noiseKey: o.noiseKey, ...stats[key], pointH: r3(o.pointH), ...(pointSeH !== null ? { pointSeH } : {}), commitment, ...(key === 'now' && elapsed ? { elapsedFrom: prev?.key ?? null } : {}), ...extra, n: ev.n, ms: ev.ms, overBudget: ev.overBudget, alloc: ev.alloc }
  }
  if (!redecide && committedKey) return record(committedKey, { ...heldFields(prev, rows, pricedAt), ...heldSanity(prev) })
  // The incumbent's last price: its commitment (refreshed every held pass), else its record's mean.
  const prevH = committedKey ? (fin(prev?.commitment?.meanH) ? prev.commitment.meanH : fin(prev?.meanH) ? prev.meanH : null) : null
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta, committedPrevH: prevH })
  const screened = screen?.screened?.length ? { screened: screen.screened, screen: screen.why } : {}
  screenedWhyOf(d, screen)
  if (d.choice === null) return { key: null, ...(onRoute ? { route: onRoute } : {}), install: false, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, pricedAt, n: ev.n, ms: ev.ms, overBudget: ev.overBudget, alloc: ev.alloc, ...screened }
  return record(d.choice, { held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, vowH: d.vowH ?? null, margins: marginsOf(ev.samples, d.choice), ...(d.commit ? { commit: d.commit } : {}), why: d.why, ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...screened })
}

/**
 * "NO ALTERNATIVE" MUST NOT HIDE A PRICED ONE: an option screened out of the
 * draws by its point (installScreenOf) was priced and lost — the decision's
 * why names it and its point. Live BN14.1 2026-10-05 02:04Z the install
 * decision read 'stays on never: no alternative' while installing now priced
 * 8.92h against never's 7.64h, and was read as "the install arm is not
 * generated at all". Mutates d.why.
 */
export function screenedWhyOf(d, screen) {
  if (!d || typeof d.why !== 'string' || !d.why.endsWith('no alternative') || !screen?.screened?.length) return d
  const sc = [...screen.screened].sort((a, b) => (fin(a.pointH) ? a.pointH : Infinity) - (fin(b.pointH) ? b.pointH : Infinity))
  d.why = `${d.why} within the screen — priced and screened out by point: ${sc
    .slice(0, 4)
    .map((x) => `${x.key} ${fin(x.pointH) ? `${x.pointH.toFixed(2)}h` : 'unpriced'}`)
    .join(', ')}${sc.length > 4 ? ` (+${sc.length - 4} more)` : ''}`
  return d
}

/**
 * WHICH INSTALL OPTIONS ENTER THE DRAWS on a re-decision: the committed
 * incumbent always (it is what a switch is measured against), then the
 * options by point, best first, up to `topK` of them, each within `reach`
 * structural errors of the best point (`sd`, the drift posterior's scale;
 * 0.1 where none) — as a graft challenger enters only if its point could win
 * (progress.js graftDecisionOf). An option whose point is unpriced enters only
 * as the incumbent. Returns {use, screened [{key, pointH}], why}.
 */
export function installScreenOf(opts, committedKey = null, { topK = PLAN.installTopK, reach = PLAN.installReach, sd = null } = {}) {
  const s = fin(sd) && sd > 0 ? sd : 0.1
  const priced = opts.filter((o) => fin(o.pointH)).sort((a, b) => a.pointH - b.pointH)
  const best = priced.length ? priced[0].pointH : null
  const limit = fin(best) ? best * (1 + reach * s) : null
  const keep = new Set()
  if (committedKey && opts.some((o) => o.key === committedKey)) keep.add(committedKey)
  let taken = 0
  for (const o of priced) {
    if (taken >= topK || !(o.pointH <= limit)) break
    if (!keep.has(o.key)) keep.add(o.key)
    taken++
  }
  if (!keep.size && opts.length) keep.add(opts[0].key)
  const use = opts.filter((o) => keep.has(o.key))
  const screened = opts.filter((o) => !keep.has(o.key)).map((o) => ({ key: o.key, pointH: fin(o.pointH) ? r3(o.pointH) : null }))
  const why = `${use.length} of ${opts.length} options in the draws: ${committedKey ? `the incumbent '${committedKey}' and ` : ''}the best ${taken} by point within ${(reach * s * 100).toFixed(0)}% of the best (${fin(best) ? best.toFixed(2) : '?'}h)`
  return { use, screened, why }
}

/**
 * A TRAJECTORY, priced: the one function every decision uses for "the node's
 * exit if the plan installs like THIS" — so the install decision and every
 * decision priced on its basis (grafts, and whatever follows) price the same
 * trajectory from the same inputs, not two models of it.
 *   {kind: 'wait', waitH, n, lifeH, gains}  install after waitH (gains: that
 *     batch's multipliers), then the policy search; the count-aware fixed
 *     policy where the count gate is short
 *   {kind: 'never'}                          hold to the exit
 *   {kind: 'route', route, extra, lifeH}     install once the route's detour
 *     (drawn, where `d` is given) is done
 * Returns (inputs, d?) => hours | null.
 */
export function trajectoryOf(spec, ctx = {}) {
  // THE SAME FUNCTION as trajectoryGenOf, drained: one definition of every
  // trajectory, so the synchronous pricing and the sliced one can never
  // disagree (bestExitPolicy is bestExitPolicyGen drained).
  const g = trajectoryGenOf(spec, ctx)
  return (x, d = null) => drain(g(x, d))
}

/** A policy search's best hours, or null when it is unpriced or degenerate (past DEGENERATE_H). */
export const hoursOrNull = (r) => (!r || r.degenerate || !fin(r.best?.hours) ? null : r.best.hours)

/**
 * trajectoryOf as a GENERATOR per simulation: (inputs, d?) => a generator
 * returning the same hours, yielding after each policy every kind prices
 * (exitplan.bestExitPolicyGen; the count and route kinds through
 * countexit.countExitFixedGen / routeExitFixedGen over it).
 *
 * Every kind slices. The default policy (no committed install — the
 * hacking arm on the Bladeburner route, hackBasisOf null) and the count
 * kinds ran in ONE step as the synchronous `f`: live BN14 2026-10-04, PLAN
 * BLOCKED THE PAGE, 64.8ms block, 39.7ms in 'plan-lifeLength' step 1 of 59
 * (51.2ms / 28.5ms at 10:30Z) — the life length decision's first option's
 * point, a whole policy search before its first yield.
 *
 * A DEGENERATE EXIT IS UNPRICED, not a duration (exitplan.DEGENERATE_H: past
 * 1e5h no node is played). The wait kind always refused it; the default and
 * never kinds passed it on, and one draw of a slow cadence (ln(M) 0.006/h)
 * priced live BN14's hacking arm at 3.4e78h — its mean 1.4e77h, the paired
 * gain -1.4e77h and the value of waiting 2.3e77h decided the route on
 * overflow (decisions.bladeRoute 2026-10-03 21:20Z). null is "infeasible in
 * this draw": summarize fills it at 1.5x the option's worst priced draw.
 */
export function trajectoryGenOf(spec, { count = null, repPoint = null } = {}) {
  if (!spec) {
    return function* (x) {
      return hoursOrNull(yield* bestExitPolicyGen(x))
    }
  }
  if (spec.kind === 'never') {
    return function* (x) {
      return hoursOrNull(yield* bestExitPolicyGen(x, 0, 0))
    }
  }
  if (spec.kind === 'route') {
    return function* (x, d = null) {
      const det = d ? detourOf(spec.route, d, repPoint, x?.repSdLn ?? null) : spec.route?.detourH
      return count ? yield* routeExitFixedGen(bestExitPolicyGen, x, count, spec.route, { firstInstallH: det + (spec.extra ?? 0), lifeH: spec.lifeH ?? null, detourH: det }) : null
    }
  }
  const w = fin(spec.waitH) ? Math.max(0, spec.waitH) : 0
  const g = spec.gains ?? null
  if (count) {
    return function* (x) {
      return yield* countExitFixedGen(bestExitPolicyGen, x, count, { firstInstallH: w, n: spec.n ?? 1, lifeH: spec.lifeH ?? null })
    }
  }
  return function* (x) {
    const r = yield* bestExitPolicyGen({ ...x, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1)
    return r.degenerate ? null : r.best?.hours ?? null
  }
}

/** The policy (installs first) of a no-count trajectory, for callers that need more than the hours. */
export function policyOf(spec, x) {
  if (spec?.kind === 'never') return bestExitPolicy(x, 0, 0)
  if (spec?.kind === 'wait') {
    const g = spec.gains ?? null
    return bestExitPolicy({ ...x, firstInstallH: Math.max(0, spec.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1)
  }
  return bestExitPolicy(x)
}

/** policyOf as a generator (exitplan.bestExitPolicyGen: yields per policy). */
export function* policyGenOf(spec, x) {
  if (spec?.kind === 'never') return yield* bestExitPolicyGen(x, 0, 0)
  if (spec?.kind === 'wait') {
    const g = spec.gains ?? null
    return yield* bestExitPolicyGen({ ...x, firstInstallH: Math.max(0, spec.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1)
  }
  return yield* bestExitPolicyGen(x)
}

/**
 * PER-LIFE GAIN UNBOUGHT. The committed trajectory's later lives compound a
 * per-life gain (exitplan exitHours perLife.pricedLn: the mean ln gain of
 * the lives after the first install, graft purchases excluded); the purchase
 * model (lifeplan.cadenceByPurchases: each life length's modelled money and
 * what lifeSequence buys with it from the depleting catalogue at 1.9x
 * escalation) says what a life of that length CAN buy — with every income
 * the node carries multiplied into its money (perLife.boughtLn, a generous
 * bound). Priced beyond it, the exit rests on lives that buy more than the
 * planner could: live BN9 2026-09-29 20:22Z, 42 lives of x1.153 each at
 * 0.5h where a 0.5h life's $62m buys x1.0016. Tolerance: 5% of the bound, at
 * least 0.005. Returns {ok (true|false|null), ...}.
 */
export const PER_LIFE_TOL = { rel: 0.05, abs: 0.005 }
export function perLifeGainCheckOf(best) {
  const pl = best?.perLife
  if (!pl || !fin(pl.pricedLn)) return { ok: null, why: 'no later lives on the committed trajectory' }
  if (!fin(pl.boughtLn)) return { ok: null, pricedLn: +pl.pricedLn.toFixed(5), why: "no purchase-model table on the inputs (the cadence is not the purchase model's): the per-life gain is the measured cadence's" }
  const tol = Math.max(PER_LIFE_TOL.abs, PER_LIFE_TOL.rel * pl.boughtLn)
  const ok = pl.pricedLn <= pl.boughtLn + tol
  const out = { ok, lives: pl.lives, cycleHours: pl.cycleHours, pricedLn: +pl.pricedLn.toFixed(5), boughtLn: +pl.boughtLn.toFixed(5), moneyL: pl.moneyL, kAll: fin(pl.kAll) ? +pl.kAll.toFixed(2) : null, kPeak: fin(pl.kPeak) ? +pl.kPeak.toFixed(2) : null }
  const x = (v) => `x${Math.exp(v).toFixed(4)}`
  const m = `$${(pl.moneyL ?? 0).toExponential(2)}`
  return { ...out, why: ok ? `${pl.lives} later lives of ${pl.cycleHours}h at ${x(pl.pricedLn)} each, within the ${x(pl.boughtLn)} a life's ${m} (x${out.kAll} mean over those lives with the streams they walk, x${out.kPeak ?? '?'} at most) buys` : `PER-LIFE GAIN UNBOUGHT: ${pl.lives} later lives of ${pl.cycleHours}h priced at ${x(pl.pricedLn)} each, beyond the ${x(pl.boughtLn)} the purchase model buys with a life's ${m} (x${out.kAll} mean over those lives with the streams they walk, x${out.kPeak ?? '?'} at most)` }
}

/**
 * The structural-noise key of a trajectory: the install point (to the
 * minute) or 'never' or the route, and whether the inputs carry committed
 * grafts. Equal trajectories share noise draws, whichever decision prices them.
 */
export function noiseKeyOf(spec, inputs) {
  // Every committed graft, wherever the schedule puts it (final window or an earlier life).
  const nG = (Array.isArray(inputs?.finalGrafts) ? inputs.finalGrafts.length : 0) + (Array.isArray(inputs?.lifeGrafts) ? inputs.lifeGrafts.length : 0)
  // THE LATER LIVES' LENGTH is on the basis (decideLifeLengthGen): two
  // lengths are two trajectories, and LIFE LENGTH OFF BASIS reads it here.
  const L = lifeLOf(inputs)
  const g = `${L === null ? '' : `L${L}|`}g${nG}`
  if (!spec) return `default|${g}`
  if (spec.kind === 'never') return `never|${g}`
  if (spec.kind === 'route') return `route:${spec.routeKey ?? routeKey(spec.route)}|${spec.extra ?? 0}|${g}`
  return `at:${Math.round((spec.installAt ?? 0) / 60e3)}|${g}`
}

/**
 * The later lives' length L the inputs price (the purchase model's cadence:
 * lifeplan.lifeInputsOf), or null where the cadence is the measured one (no L
 * is decided there). `lifeOfNoiseKey`: the same L read back from a noise key.
 */
export function lifeLOf(inputs) {
  return inputs?.cadenceFrom === 'purchase model' && fin(inputs.cycleHours) && inputs.cycleHours > 0 ? +inputs.cycleHours.toFixed(3) : null
}
export function lifeOfNoiseKey(k) {
  // String.match, not RegExp.exec: a bare `exec` is billed as ns.exec (1.3GB).
  const m = String(k ?? '').match(/\|L([\d.]+)\|g\d+$/)
  return m ? +m[1] : null
}
export const lifeKeyOf = (L) => `L${+(+L).toFixed(3)}`

/**
 * THE LATER LIVES' LENGTH, committed. The purchase model's chooser
 * (lifeplan.cadenceByPurchases) picked L every pass by the argmin of its own
 * exits — on the default policy (this life's install AT L), without the
 * committed install's batch, with no draws and no incumbent — and every other
 * decision priced on whatever it picked. Live BN9 2026-09-30 it drove the exit
 * with nothing re-deciding: 07:04Z 0.5h -> 3h (15.5h -> 26.2h, EXIT
 * UNSTABLE), 07:14Z 0.5h (point 109h against 32.5h at 6h), 08:24Z 0.5h right
 * after the install (the full simulation 54h), 08:30Z 8h, 08:35Z 6h (42.7h ->
 * 27.5h), 09:20Z 6h -> 4h (14.1h -> 24.9h).
 *
 * Now L is a plan decision like the install: each option is the COMMITTED
 * TRAJECTORY (`basis`: the committed install's spec — this life's install time
 * is the install decision's, L governs the lives after it; null: the default
 * policy, named) priced on inputs whose later lives run L (`options` [{L,
 * inputs, cad}] — lifeplan.lifeInputsOf: grafts, carried streams, the trader's
 * r(W) belief and the next install's batch as every decision has them, the
 * per-life gain drawn from the posterior AT L). Same draws, same exit
 * machinery (trajectoryOf) and the same noise keys (L on the key) as the
 * install decision. On a re-decision the incumbent and the best `topK` lengths
 * by point within `reach` structural errors enter the draws
 * (installScreenOf); a switch needs a positive expected gain net of
 * `switchCostH` and P(better) >= theta. Held (no event), only the incumbent is
 * priced. Returns the decision record {key 'L<h>', lifeH, ...stats, samples,
 * noiseKey, options, screened, table, basis, why, ...}.
 */
export function decideLifeLength(o = {}) {
  return drain(decideLifeLengthGen(o))
}
export function* decideLifeLengthGen({ options: optsIn = [], basis = null, ctx = {}, prev = null, draws = [], redecide = true, budgetMs = PLAN.budgetMs, theta = PLAN.theta, now = Date.now(), clock: budgetClock = clock, topK = PLAN.lifeTopK, reach = PLAN.lifeReach, reachSd = null, switchCostH = PLAN.lifeSwitchCostH, ocba = PLAN.ocba } = {}) {
  const f = trajectoryOf(basis, ctx)
  const fg = trajectoryGenOf(basis, ctx)
  const opts = (optsIn ?? [])
    .filter((o) => o && fin(o.L) && o.L > 0 && o.inputs)
    .map((o) => ({ key: lifeKeyOf(o.L), L: +(+o.L).toFixed(3), inputs: o.inputs, cad: o.cad ?? null, noiseKey: noiseKeyOf(basis, o.inputs), sim: (d) => f(applyDraw(o.inputs, d), d), simGen: (d) => fg(applyDraw(o.inputs, d), d), pointH: null }))
  const basisOut = basis ? { kind: basis.kind, waitH: r3(basis.waitH ?? null), installAt: basis.installAt ?? null, gainsKey: gainsKeyOf(basis.gains ?? null) } : { kind: 'default policy (no committed install)' }
  if (!opts.length) return { key: null, lifeH: null, why: 'no life length priced: no purchase-model row buys anything', basis: basisOut, decidedAt: prev?.decidedAt ?? null }
  const committedKey = prev?.key && opts.some((o) => o.key === prev.key) ? prev.key : null
  const hold = !redecide && committedKey !== null
  // The points: every length on a re-decision (the screen reads them), the
  // incumbent alone when held.
  for (const o of opts) {
    if (hold && o.key !== committedKey) continue
    let h = null
    try {
      h = yield* fg(o.inputs)
    } catch {
      h = null
    }
    o.pointH = fin(h) ? h : null
    yield
  }
  const screen = hold ? null : installScreenOf(opts, committedKey, { topK, reach, sd: reachSd })
  const use = screen ? screen.use : opts.filter((o) => o.key === committedKey)
  const lifeCost = Object.fromEntries(use.filter((o) => o.key !== committedKey).map((o) => [o.key, switchCostH]))
  const ev = yield* evaluateGen(use, draws, { budgetMs, now: budgetClock, alloc: screen ? allocOf(ocba, committedKey, lifeCost) : null })
  const { stats } = summarize(ev.samples)
  const pricedAt = new Date(now).toISOString()
  const rows = optionRows(use, stats, (o) => o.pointH, pricedAt).map((r) => ({ ...r, L: opts.find((o) => o.key === r.key)?.L ?? null }))
  const table = opts.map((o) => ({ L: o.L, pointH: r3(o.pointH), perLife: o.cad && fin(o.cad.gain) ? +o.cad.gain.toFixed(6) : null, model: o.cad && fin(o.cad.model) ? +o.cad.model.toPrecision(4) : null, drawn: use.includes(o) }))
  const cpu = { n: ev.n, ms: ev.ms, overBudget: ev.overBudget, alloc: ev.alloc }
  const record = (key, extra) => {
    const o = opts.find((x) => x.key === key)
    return { key, lifeH: o.L, ...stats[key], pointH: r3(o.pointH), samples: samplesOf(ev.samples[key]), noiseKey: o.noiseKey, perLife: o.cad && fin(o.cad.gain) ? +o.cad.gain.toFixed(6) : null, basis: basisOut, table, ...extra, ...cpu }
  }
  if (hold) return record(committedKey, { ...heldFields(prev, rows, pricedAt), ...heldSanity(prev) })
  const prevH = committedKey && fin(prev?.meanH) ? prev.meanH : null
  const switchCost = Object.fromEntries(use.filter((o) => o.key !== committedKey).map((o) => [o.key, switchCostH]))
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost, theta, committedPrevH: prevH })
  const screened = screen?.screened?.length ? { screened: screen.screened, screen: screen.why } : {}
  screenedWhyOf(d, screen)
  if (d.choice === null) return { key: null, lifeH: null, why: d.why, basis: basisOut, table, decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...screened, ...cpu }
  // The incumbent gone (its length no longer buys anything): the choice is a switch.
  const gone = prev?.key && committedKey === null
  const switched = d.switched === true || (gone && d.choice !== prev.key)
  const why = gone ? `the committed ${prev.key} is no longer priced (nothing bought at that length): ${d.why}` : d.why
  return record(d.choice, { held: false, switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, vowH: d.vowH ?? null, margins: marginsOf(ev.samples, d.choice, { defaultCost: switchCostH }), ...(d.commit ? { commit: d.commit } : {}), why, ...(switched && prev?.key ? { from: prev.key } : {}), ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...screened })
}

/**
 * LIFE LENGTH OFF BASIS. Every decision prices the committed later-lives
 * length (decisions.lifeLength.lifeH): its committed option and every option
 * row carry it on their noise key (noiseKeyOf `|L<h>|`), and a decision priced
 * without noise keys (gang, sleeve objective) stamps `pricedL`. A decision
 * priced this pass on another L is off basis — the plan's exit is then two
 * trajectories. The life length decision's own rows are its alternatives and
 * are not checked; its committed option must be on its own L. Decisions carried
 * from an earlier pass (not re-priced this one) are skipped, and counted.
 * Returns {ok (true|false|null), fails, checked, why}.
 */
export function lifeLengthBasisOf(plan) {
  const d = plan?.decisions ?? {}
  const ll = d.lifeLength
  if (!ll?.key || !fin(ll.lifeH)) return { ok: null, fails: [], checked: 0, why: 'no committed life length (the measured cadence, or no purchase model)' }
  const Lc = +(+ll.lifeH).toFixed(3)
  const fails = []
  let checked = 0
  let carried = 0
  const own = lifeOfNoiseKey(ll.noiseKey)
  if (own !== null && own !== Lc) fails.push(`lifeLength: its committed ${ll.key} is priced on L${own}`)
  const passAt = Date.parse(ll.pricedAt ?? plan?.at ?? '')
  for (const [name, x] of Object.entries(d)) {
    if (name === 'lifeLength' || !x || typeof x !== 'object') continue
    // Priced before the committed length was (another pass): carried, not this pass's pricing.
    const at = Date.parse(x.pricedAt ?? '')
    if (fin(at) && fin(passAt) && at < passAt - 10 * 60e3) {
      carried++
      continue
    }
    const seen = []
    for (const k of [x.noiseKey, x.basisNoiseKey, ...(Array.isArray(x.options) ? x.options.map((o) => o?.noiseKey) : [])]) {
      const L = lifeOfNoiseKey(k)
      if (L !== null) seen.push(L)
    }
    if (fin(x.pricedL)) seen.push(+(+x.pricedL).toFixed(3))
    if (!seen.length) continue
    checked++
    const off = [...new Set(seen.filter((L) => L !== Lc))]
    if (off.length) fails.push(`${name}: priced on L${off.join(', L')} (committed ${ll.key})`)
  }
  if (!checked && !fails.length) return { ok: null, fails, checked, carried, why: `no decision this pass carries its later lives' length${carried ? ` (${carried} carried from an earlier pass)` : ''}` }
  return { ok: !fails.length, fails, checked, carried, why: fails.length ? `LIFE LENGTH OFF BASIS: ${fails.join('; ')}` : `every decision of ${checked} priced on the committed ${ll.key}${carried ? ` (${carried} carried from an earlier pass, not checked)` : ''}` }
}

/**
 * THE COMMITTED INSTALL AS A BASIS: the spec of a committed install record on
 * its REMAINING wait now. null when nothing is committed (the caller prices on
 * the default policy and says so).
 */
export function basisOf(rec, now = Date.now()) {
  if (!rec || !rec.key) return null
  if (rec.key === 'never') return { kind: 'never' }
  const sp = rec.spec ?? null
  if (sp?.kind === 'route') return null // a route basis needs this pass's route object: priced by the install decision only
  if (!fin(rec.installAt)) return null
  const hold = sp?.hold ?? null
  return { kind: 'wait', installAt: rec.installAt, waitH: Math.max(0, (rec.installAt - now) / 3.6e6), n: rec.fixed?.n ?? sp?.n ?? null, lifeH: rec.fixed?.lifeH ?? sp?.lifeH ?? null, gains: rec.gains ?? sp?.gains ?? null, ...(hold ? { hold } : {}), ...(sp?.blade ? { blade: sp.blade } : {}) }
}

/**
 * The committed install as a basis for a HACKING trajectory: a record priced
 * on the Bladeburner route (route 'blade') plans installs on the black-op
 * exit — its 'never' is not the hacking route's plan — so the decisions that
 * price the World Daemon exit (grafts, the life length, 4S, the batch) take
 * the default policy there.
 */
export function hackBasisOf(rec, now = Date.now()) {
  return rec?.route === 'blade' ? null : basisOf(rec, now)
}

/**
 * THE BLADEBURNER TRAJECTORY'S NOISE KEY: one key per install plan on the
 * black-op exit, so the route decision's blade arm and the install
 * decision's committed option — the same trajectory — get the same
 * structural draws and publish one exit (consistencyOf's rule for the
 * hacking trajectories). No install (null basis, 'never'): 'bladeburner'.
 */
export function bladeNoiseKeyOf(spec) {
  if (!spec || spec.kind === 'never' || !fin(spec.installAt)) return 'bladeburner'
  return `bladeburner|at:${Math.round(spec.installAt / 60e3)}`
}

/**
 * THE COMMITTED HOLD, ENACTED. A committed install whose wait is a hold
 * (spec.hold {faction, repTarget}) is a promise that the work slot grinds
 * that faction until the target (or the install): its batch was priced on
 * the augmentation the grind unlocks. Returns {faction, repTarget, why} when
 * the slot should be there this pass, else null with nothing to enact:
 * another life, the install time passed, the faction not joined, the target
 * reached. `rec` the plan's install decision; `repOf(faction)` the
 * faction's reputation now (null unreadable: nothing enacted, named).
 */
export function installHoldOf(rec, { lastAugReset = null, planLife = null, now = Date.now(), joined = [], repOf = null } = {}) {
  const h = rec?.spec?.hold ?? null
  if (!h || typeof h.faction !== 'string' || !fin(h.repTarget)) return null
  if (planLife !== null && lastAugReset !== null && planLife !== lastAugReset) return null
  if (!fin(rec.installAt) || rec.installAt <= now) return null
  if (!(joined ?? []).includes(h.faction)) return { faction: null, repTarget: h.repTarget, why: `the committed hold's faction ${h.faction} is not joined: the hold cannot be worked (its batch will be re-priced without it)` }
  const rep = typeof repOf === 'function' ? repOf(h.faction) : null
  if (!fin(rep)) return { faction: null, repTarget: h.repTarget, why: `${h.faction}'s reputation is unreadable: the hold is not enacted this pass` }
  if (rep >= h.repTarget) return null
  return { faction: h.faction, repTarget: h.repTarget, rep, why: `the committed install ${rec.key} holds for ${h.faction} to ${Math.round(h.repTarget).toLocaleString()} rep (${Math.round(rep).toLocaleString()} now; install at ${new Date(rec.installAt).toISOString().slice(11, 16)}Z)` }
}

/**
 * THE COMMITTED BATCH, re-planned on events, not on every pass's replan
 * jitter. The purchase planner's batch at the committed install's remaining
 * wait flips between near-equal batches pass to pass (live BN9 2026-09-30
 * held w1.4: hacking x1.150/x1.138/x1.127, income x3.15/x5.11/x4.93 on
 * consecutive passes; 07:04Z x2.94 -> x2.70), each flip moving the held exit
 * 0.4-0.7h with nothing decided. The batch is kept (`held`) while the
 * re-planned one prices within `tolH` (5% of the exit, at least 0.5h: the
 * flips; a lost augmentation is 3h) of it; beyond, the re-planned one is
 * taken and the move is an EVENT (the install decision re-decides on it). A
 * drift in small steps accumulates against the KEPT batch, so it too becomes
 * an event once it matters.
 * In the last `freshH` hours of the wait the BETTER of the two on this pass's
 * inputs is taken — the batch the install buys is chosen the same way
 * (chooseBatchGen, the committed batch against the fresh one at the raise's
 * reach). It was "the re-planned batch, always": live BN9 2026-09-30 13:20Z
 * took a re-planned batch +0.16h worse, 13:25Z bought another one (ENM DMA
 * Upgrade and DataJack for ADR-V2 and The Shadow's Simulacrum) the exit
 * priced 0.94h worse than the committed one, and the install fired TWO EXITS
 * AT INSTALL; 14:05Z the same without ADR-V2 and The Shadow's Simulacrum
 * (1.49h). The purchase planner's batches flip between near-equal ones on its
 * linearised weights (objective.exitWeights: the exit's slope at the last
 * published batch and inputs; 0 for rep on the 14:00Z record), so "fresh"
 * was not "better".
 * prevGains/newGains: the batches; prevH/newH: the committed trajectory's
 * point on each (this pass's inputs). Returns {gains, held, event, why}.
 */
export const BATCH_HOLD = { rel: 0.05, minTolH: 0.5, freshH: 0.5 }
export function committedBatchOf({ prevGains = null, newGains = null, prevH = null, newH = null, waitH = null, o = BATCH_HOLD } = {}) {
  const key = (g) => gainsKeyOf(g ?? null)
  if (!newGains) return { gains: prevGains, held: !!prevGains, event: null, why: prevGains ? 'no re-planned batch this pass: the committed batch kept' : 'no batch' }
  if (!prevGains || key(prevGains) === key(newGains)) return { gains: newGains, held: false, event: null, why: prevGains ? 'the re-planned batch is the committed one' : 'no committed batch: the re-planned one' }
  if (!fin(prevH) || !fin(newH)) return { gains: newGains, held: false, event: `the committed install's batch changed (${fin(prevH) ? '' : 'the committed batch is unpriced'}${!fin(prevH) && !fin(newH) ? ', ' : ''}${fin(newH) ? '' : 'the re-planned batch is unpriced'})`, why: 'one of the batches is unpriced: the re-planned one, as an event' }
  const tolH = Math.max(o.minTolH, o.rel * Math.max(prevH, newH))
  const d = newH - prevH
  const g = (x) => `h${(x.hacking ?? 1).toFixed(3)} $${(x.income ?? 1).toFixed(3)}`
  if (Math.abs(d) > tolH) return { gains: newGains, held: false, event: `the committed install's batch moved ${g(prevGains)} -> ${g(newGains)} (${d > 0 ? '+' : ''}${d.toFixed(2)}h, beyond ${tolH.toFixed(2)}h)`, why: `re-planned batch ${d > 0 ? '+' : ''}${d.toFixed(2)}h: taken, an event` }
  if (fin(waitH) && waitH <= o.freshH) {
    if (d < 0) return { gains: newGains, held: false, event: null, why: `the last ${o.freshH}h of the wait: the re-planned batch prices ${d.toFixed(2)}h (within ${tolH.toFixed(2)}h) — the better one, taken (the install buys the better: chooseBatchGen)` }
    return { gains: prevGains, held: true, event: null, why: `the last ${o.freshH}h of the wait: the re-planned batch prices +${d.toFixed(2)}h (within ${tolH.toFixed(2)}h) — the committed batch is the better one and kept (the install buys the better: chooseBatchGen)` }
  }
  return { gains: prevGains, held: true, event: null, why: `the re-planned batch prices ${d > 0 ? '+' : ''}${d.toFixed(2)}h, within ${tolH.toFixed(2)}h: the committed batch kept` }
}

/**
 * THE BATCH IS CHOSEN BY THE EXIT, not by the planner's proxy. The purchase
 * planner (augplan.planPurchases) maximises a weighted sum of ln multipliers
 * whose weights are the exit's SLOPES at the last published batch and inputs
 * (objective.exitWeights: hours per ln, a +5% finite difference) — local, and
 * one pass old. The exit is not linear in the batch and moves with the
 * inputs: live BN9 2026-09-30 the 14:00Z record priced rep x1.03 and x1.42
 * alike (13.079h / 13.077h: rep slope 0, the rep augmentations 'no-value' to
 * the 14:05Z planner), while on the 14:05Z inputs (the rep rate 19.3 ->
 * 13.3/s) the same two augmentations were worth 1.49h (15.19h -> 13.71h,
 * nothing past x1.42); at 13:25Z the slope read 0.98h per ln against a
 * secant of 2.9h per ln. The batch flips pass to pass between batches that
 * are near-equal by the proxy and 0.9-1.5h apart by the exit — and at 13:25Z
 * and 14:05Z the install bought the worse one against a commitment priced on
 * the better: TWO EXITS AT INSTALL.
 *
 * So every candidate batch is priced by the exit itself, on ONE set of
 * inputs and ONE draw set, and the best is bought: `candidates` [{key, names,
 * gains, buyable, why}] (the fresh plan, the plan on the last pass's weights,
 * the committed batch where it is still buyable at the raise's reach — each
 * the caller's), a wait `waitH` (the committed install's remaining wait, 0 at
 * the install) at `installAt` (the committed install time: the candidates
 * share its structural noise key). Candidates with the same gains are one
 * trajectory (the first key kept). With `draws` the choice is the lowest mean
 * over the draws all candidates priced (paired; ties to `prefer`, the
 * incumbent), else the lowest point. Each candidate is priced with itself as
 * the inputs' persistBaseline (`ownBaseline`): how the plan prices it once it
 * is the plan. Returns {key, names, gains, gainsKey,
 * rows [{key, n, gainsKey, pointH, meanH, ...}], gainH (the fresh plan's mean
 * or point less the chosen's), unbuyable, why, n, ms, overBudget}.
 */
export const BATCH_CHOICE = { nearH: 0.5, floorMs: 300, tieH: 1e-6 }
export function chooseBatch(o = {}) {
  return drain(chooseBatchGen(o))
}
export function* chooseBatchGen({ candidates = [], inputs = null, waitH = 0, installAt = null, draws = [], prefer = 'committed', freshKey = 'fresh', ownBaseline = true, budgetMs = PLAN.budgetMs, now = Date.now(), clock: budgetClock = clock, tieH = BATCH_CHOICE.tieH } = {}) {
  const unbuyable = candidates.filter((c) => c && c.buyable === false).map((c) => ({ key: c.key, why: c.why ?? null }))
  const seen = new Map()
  const use = []
  for (const c of candidates) {
    if (!c || c.buyable === false || !c.gains) continue
    const gk = gainsKeyOf(c.gains)
    if (seen.has(gk)) {
      seen.get(gk).alias.push(c.key)
      continue
    }
    const o = { ...c, gainsKey: gk, alias: [] }
    seen.set(gk, o)
    use.push(o)
  }
  const fresh = use.find((c) => c.key === freshKey || c.alias.includes(freshKey)) ?? null
  if (!use.length) return { key: null, names: null, gains: null, rows: [], unbuyable, why: 'no candidate batch to price' }
  if (!inputs) return { key: fresh?.key ?? use[0].key, names: (fresh ?? use[0]).names ?? null, gains: (fresh ?? use[0]).gains, gainsKey: (fresh ?? use[0]).gainsKey, rows: [], unbuyable, why: 'no exit inputs: the fresh plan, unpriced against the rest' }
  const w = fin(waitH) ? Math.max(0, waitH) : 0
  const at = fin(installAt) ? installAt : now + w * 3.6e6
  const specOf = (g) => ({ kind: 'wait', installAt: at, waitH: w, n: null, lifeH: null, gains: g })
  const opts = use.map((c) => {
    const spec = specOf(c.gains)
    const f = trajectoryOf(spec)
    const fg = trajectoryGenOf(spec)
    // AS THE PLAN PRICES IT ONCE SHIPPED: the batch is also the baseline
    // the measured cadence represents (exit inputs persistBaseline = the
    // plan's batch), so the choice's price of the chosen batch is the price
    // the install decision's 'now' and the install actor put on it.
    const x = ownBaseline && inputs && 'persistBaseline' in inputs ? { ...inputs, persistBaseline: c.gains } : inputs
    return { ...c, spec, pointGen: () => fg(x), pointH: null, noiseKey: noiseKeyOf(spec, x), sim: (d) => f(applyDraw(x, d), d), simGen: (d) => fg(applyDraw(x, d), d) }
  })
  // THE POINTS AS GENERATORS, a step each: every candidate's point was a
  // whole policy search, all of them in ONE step (the map above) before the
  // first yield. The same numbers.
  for (const o of opts) {
    let pointH = null
    try {
      pointH = yield* o.pointGen()
    } catch {
      pointH = null
    }
    o.pointH = fin(pointH) ? pointH : null
    yield
  }
  let stats = {}
  let ev = { n: 0, ms: 0, overBudget: false, samples: {} }
  if (opts.length > 1 && Array.isArray(draws) && draws.length) {
    ev = yield* evaluateGen(opts, draws, { budgetMs, now: budgetClock })
    stats = summarize(ev.samples).stats
  }
  const meanOf = (k) => (fin(stats[k]?.meanH) && stats[k].pFeasible >= 0.5 ? stats[k].meanH : null)
  const byDraws = opts.every((o) => meanOf(o.key) !== null)
  const valueOf = (o) => (byDraws ? meanOf(o.key) : o.pointH)
  const ranked = opts.filter((o) => fin(valueOf(o))).sort((a, b) => valueOf(a) - valueOf(b))
  let best = ranked[0] ?? fresh ?? opts[0]
  const inc = ranked.find((o) => o.key === prefer || o.alias.includes(prefer))
  if (inc && best !== inc && Math.abs(valueOf(inc) - valueOf(best)) <= tieH) best = inc
  const freshOpt = fresh ? opts.find((o) => o.gainsKey === fresh.gainsKey) ?? null : null
  const r3v = (x) => (fin(x) ? +x.toFixed(3) : null)
  const rows = opts.map((o) => ({ key: o.key, ...(o.alias.length ? { alias: o.alias } : {}), n: Array.isArray(o.names) ? o.names.length : null, names: o.names ?? null, gainsKey: o.gainsKey, gains: o.gains, pointH: r3v(o.pointH), meanH: meanOf(o.key), q10: stats[o.key]?.q10 ?? null, q90: stats[o.key]?.q90 ?? null, ...(o.why ? { why: o.why } : {}) }))
  const gainH = freshOpt && fin(valueOf(freshOpt)) && fin(valueOf(best)) ? r3v(valueOf(freshOpt) - valueOf(best)) : null
  const how = byDraws ? `mean over ${ev.n} shared draws` : 'point'
  const list = rows.map((r) => `${r.key} ${r.n ?? '?'} aug(s) ${byDraws ? `${r.meanH}h mean` : `${r.pointH}h`}`).join(', ')
  const why = freshOpt && best.gainsKey === freshOpt.gainsKey
    ? `the fresh plan is the best batch by the exit (${how}): ${list}`
    : `BATCH BY THE EXIT: '${best.key}' over the fresh plan by ${gainH}h (${how}, one set of inputs, wait ${w.toFixed(2)}h): ${list}`
  return { key: best.key, names: best.names ?? null, gains: best.gains, gainsKey: best.gainsKey, by: byDraws ? 'draws' : 'point', rows, gainH, unbuyable, waitH: r3v(w), why, n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
}

/**
 * INSTALL DEFERRED REPEATEDLY. Each switch of the install decision to a LATER
 * install time is a deferral, and it promises an exit date (the switch's
 * pass + its mean exit). A plan that keeps deferring its own install while
 * the exit date slides past each promise is not choosing better waits — it
 * is renegotiating: every wait is priced as if it were the last one, and the
 * next pass defers again (live BN9 2026-09-30: 09:14Z promised 23:18Z,
 * 10:10Z 23:07Z, 11:50Z 00:40Z; at 12:35Z the exit read 04:07Z, 3.5-5h past
 * each, and the committed install had moved 09:35Z -> 13:24Z).
 * installDeferralsOf(prev, rec) carries the life's ledger and appends this
 * pass's deferral; installDeferralCheckOf(rec) fails when `n` or more
 * deferrals of this life have each been overshot by more than their own
 * claimed gain (at least `minH`) — the waiting delivered less than nothing.
 */
export const DEFER = { n: 3, minH: 0.5, max: 12 }
export function installDeferralsOf(prev, rec) {
  const same = prev && prev.lastAugReset === rec?.lastAugReset && prev.node === rec?.node
  const ledger = same && Array.isArray(prev.installDeferrals) ? prev.installDeferrals : []
  const a = prev?.decisions?.install
  const b = rec?.decisions?.install
  if (!same || !b?.switched || !fin(a?.installAt) || !fin(b?.installAt) || !(b.installAt > a.installAt + 60e3) || !fin(rec?.exit?.meanH)) return ledger
  const at = Date.parse(rec.at)
  const d = { at: rec.at, from: a.key ?? null, fromInstallAt: new Date(a.installAt).toISOString(), to: b.key, toInstallAt: new Date(b.installAt).toISOString(), meanH: rec.exit.meanH, promisedExitAt: new Date(at + rec.exit.meanH * 3.6e6).toISOString(), gainH: fin(b.gainH) ? b.gainH : null, hold: b.spec?.hold?.faction ?? null }
  return [...ledger, d].slice(-DEFER.max)
}
export function installDeferralCheckOf(rec, o = DEFER) {
  const L = Array.isArray(rec?.installDeferrals) ? rec.installDeferrals : []
  if (!L.length) return { ok: null, n: 0, why: 'no install deferral this life' }
  if (!fin(rec?.exit?.meanH)) return { ok: null, n: L.length, why: `${L.length} deferral(s) this life; no exit this pass to compare` }
  const exitAt = Date.parse(rec.at) + rec.exit.meanH * 3.6e6
  const rows = L.map((d) => {
    const short = (exitAt - Date.parse(d.promisedExitAt)) / 3.6e6
    const tol = Math.max(o.minH, fin(d.gainH) ? d.gainH : 0)
    return { at: d.at, from: d.fromInstallAt, to: d.toInstallAt, promised: d.promisedExitAt, shortH: +short.toFixed(2), tolH: +tol.toFixed(2), missed: short > tol, hold: d.hold ?? null }
  })
  const missed = rows.filter((r) => r.missed)
  const hh = (s) => String(s).slice(11, 16)
  const list = rows.map((r) => `${hh(r.at)}Z ${hh(r.from)}->${hh(r.to)}Z promised ${hh(r.promised)}Z (${r.shortH > 0 ? '+' : ''}${r.shortH}h${r.missed ? `, beyond its ${r.tolH}h gain` : ''}${r.hold ? `, a ${r.hold} hold` : ''})`).join('; ')
  const ok = missed.length < o.n
  return { ok, n: rows.length, missed: missed.length, exitAt: new Date(exitAt).toISOString(), rows, why: ok ? `${rows.length} install deferral(s) this life, ${missed.length} overshot: ${list}` : `INSTALL DEFERRED REPEATEDLY: ${missed.length} of ${rows.length} deferrals this life promised an exit the plan now puts later by more than each switch's own gain (exit now ${hh(new Date(exitAt).toISOString())}Z): ${list}` }
}

/**
 * A RATE READ OFF ONE PASS, SMOOTHED. The faction reputation rate is the
 * worked faction's reputation delta over one 5-minute pass
 * (progress.js planFactionWork); a pass on which the slot was elsewhere for
 * part of the interval reads a fraction of it. Live BN9 2026-09-30 09:19Z-
 * 09:34Z it read 4.0, 4.4, 17.8, 4.2, 17.7 rep/s against ~17 either side,
 * and each flip moved the held exit 7-8h (EXIT UNSTABLE, no event). The
 * rate is the MEDIAN of this life's samples over the last `windowH` hours
 * (robust to a minority of short intervals, lagging a steady climb by about
 * half the window). `obs` [{at, v}]. Returns {v, n, raw, why} (v null: no
 * sample in the window). progress.js feeds it faction-work samples ONLY
 * (repSampleOf): a median over whatever the factions gained while the slot
 * grafted is still that (live 17:51Z: 5.96/s held for an hour) — and the
 * rate the exit prices is the posterior (bayes.repRatePosterior), this beside it.
 */
export const RATE_SMOOTH = { windowH: 1, max: 24 }
export function robustRateOf(obs, now = Date.now(), { windowH = RATE_SMOOTH.windowH } = {}) {
  const S = (obs ?? []).filter((o) => fin(o?.v) && o.v > 0 && fin(Date.parse(o?.at)) && now - Date.parse(o.at) <= windowH * 3.6e6 && Date.parse(o.at) <= now + 60e3)
  if (!S.length) return { v: null, n: 0, raw: null, why: `no sample in the last ${windowH}h` }
  const xs = S.map((o) => o.v).sort((a, b) => a - b)
  const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
  const raw = S[S.length - 1].v
  return { v: m, n: S.length, raw, why: `median of ${S.length} sample(s) over the last ${windowH}h: ${m.toFixed(2)} (this pass ${raw.toFixed(2)})` }
}

/**
 * ONE FACTION-WORK SAMPLE, OR WHY NOT. The reputation a faction gains between
 * two passes is the player's faction work only when the work slot was ON
 * that faction's hacking work — at both ends of the interval, focused — and
 * even then it carries everything else that reaches every faction
 * (contracts, the Go favour stream): that incidental rate, the median over
 * the OTHER joined factions' deltas, is taken off. Live BN9 2026-09-30
 * 17:51Z the slot was grafting and the last-worked faction's delta (5.96/s,
 * ~6-7/s at every joined faction) was published as the player's rate —
 * 9% of the formula's. `prev`, `cur`: {at, lastAugReset, work: {type,
 * faction, workType, focused}, reps: {faction: rep}, favors, formula (the
 * formula base rate at that pass)}. Returns {ok, why, sample?: {at, faction,
 * v, lnK, h, incidental}}: v the base rate (favour divided out), lnK
 * ln(v / the formula averaged over the interval), h the interval's hours.
 */
export const REP_SAMPLE = { minDtS: 60, maxGapH: 1 }
export function repSampleOf(prev, cur, { minDtS = REP_SAMPLE.minDtS, maxGapH = REP_SAMPLE.maxGapH } = {}) {
  const no = (why) => ({ ok: false, why })
  if (!prev?.at || !cur?.at) return no('no previous pass')
  if (prev.lastAugReset !== cur.lastAugReset) return no('the previous pass is another life')
  const onFaction = (w) => w?.type === 'FACTION' && typeof w.faction === 'string' && (w.workType == null || String(w.workType).toLowerCase() === 'hacking') && w.focused !== false
  const wp = prev.work ?? null
  const wc = cur.work ?? null
  if (!onFaction(wc)) return no(`the slot is not on faction hacking work now (${wc?.type ?? 'none'}${wc?.faction ? ` ${wc.faction}` : ''}${wc?.focused === false ? ', unfocused' : ''})`)
  if (!onFaction(wp)) return no(`the slot was not on faction hacking work at the previous pass (${wp?.type ?? 'none'}${wp?.faction ? ` ${wp.faction}` : ''}${wp?.focused === false ? ', unfocused' : ''})`)
  if (wp.faction !== wc.faction) return no(`the slot moved ${wp.faction} -> ${wc.faction} inside the interval`)
  const f = wc.faction
  const dt = (Date.parse(cur.at) - Date.parse(prev.at)) / 1000
  if (!(dt >= minDtS)) return no(`interval ${fin(dt) ? dt.toFixed(0) : '?'}s < ${minDtS}s`)
  if (dt > maxGapH * 3600) return no(`interval ${(dt / 3600).toFixed(2)}h > ${maxGapH}h (a gap, not a pass)`)
  const r0 = prev.reps?.[f]
  const r1 = cur.reps?.[f]
  if (!fin(r0) || !fin(r1)) return no(`${f}'s reputation unread at one end`)
  // In BASE terms (each faction's delta over its own favour multiplier):
  // live, what the unworked factions gained was one base rate at ~all of
  // them (17:56Z-18:11Z: 6.74/s at 7 of 10), so it is favour-scaled.
  const fm = (g) => 1 + (fin(prev.favors?.[g]) ? prev.favors[g] : 0) / 100
  const others = Object.keys(cur.reps ?? {}).filter((g) => g !== f && fin(cur.reps[g]) && fin(prev.reps?.[g])).map((g) => Math.max(0, cur.reps[g] - prev.reps[g]) / dt / fm(g)).sort((a, b) => a - b)
  const incidental = others.length ? (others.length % 2 ? others[(others.length - 1) / 2] : (others[others.length / 2 - 1] + others[others.length / 2]) / 2) : 0
  const gained = (r1 - r0) / dt / fm(f)
  const v = gained - incidental
  if (!(v > 0)) return no(`${f} gained ${gained.toFixed(2)}/s base, no more than the ${incidental.toFixed(2)}/s base every faction gained`)
  const fms = [prev.formula, cur.formula].filter((x) => fin(x) && x > 0)
  if (!fms.length) return no('no formula rate to compare with')
  const formula = fms.reduce((a, b) => a + b, 0) / fms.length
  return { ok: true, why: `${f}: ${v.toFixed(2)}/s base over ${(dt / 60).toFixed(1)} min on faction hacking work (${incidental.toFixed(2)}/s base incidental taken off), formula ${formula.toFixed(2)}/s -> k ${(v / formula).toFixed(3)}`, sample: { at: cur.at, faction: f, v, lnK: Math.log(v / formula), h: dt / 3600, incidental } }
}

/**
 * ONE PLAN, ONE EXIT: the install decision's committed option and the graft
 * decision's committed option are the SAME trajectory when the graft decision
 * was priced on the install's basis and its choice is what the install's
 * inputs carried. Their exits must then agree within Monte Carlo noise (they
 * share draws and noise keys, so in fact exactly). Returns {ok, installH,
 * graftsH, diffH, tolH, sameBasis, why}.
 */
/** The batch a trajectory installs (spec.gains), as a key: null = no batch named (the default). */
export function gainsKeyOf(gains) {
  if (!gains || typeof gains !== 'object') return null
  const k = ['hacking', 'rep', 'income', 'exp'].map((n) => (fin(gains[n]) ? gains[n].toPrecision(9) : '-')).join(',')
  return `b${(hashOf(k) >>> 0).toString(36)}`
}
/** A decision's per-draw exits of its chosen option (null = infeasible draw), for comparing two decisions on the SAME draws. */
export function samplesOf(xs) {
  return Array.isArray(xs) ? xs.map((x) => (fin(x) ? +x.toFixed(3) : null)) : null
}
/**
 * THE INPUTS a decision priced, as a key: the exit inputs without the grafts
 * a graft option adds (finalGrafts, graftStartMoney), hashed. Two decisions
 * with the same basis noise key and the same inputs key price one trajectory
 * from one state.
 */
export function inputsKeyOf(inputs) {
  if (!inputs || typeof inputs !== 'object') return null
  // streams: the carried streams' descriptions (text), not inputs.
  const { finalGrafts, graftStartMoney, lifeGrafts, streams, ...rest } = inputs
  void finalGrafts
  void graftStartMoney
  void lifeGrafts
  void streams
  let s = null
  try {
    s = JSON.stringify(rest)
  } catch {
    return null
  }
  return `i${(hashOf(s) >>> 0).toString(36)}`
}
/**
 * TWO EXITS AT INSTALL. When the plan's install decision is 'now', three
 * numbers price ONE act — installing this batch now:
 *   - the plan's 'now' (its mean over the draws, and its point),
 *   - the commitment the plan made for this install (install.commitment: the
 *     committed wait's exit on the last pass it was held, carried through the
 *     pass on which the wait ran out), less the hours since it was priced,
 *   - the install actor's own simulated exit (installgate's nowH, `actorH`:
 *     the number act.js records in /tel/install-last.txt as its reason).
 * They must agree. Live BN9 2026-09-29: the plan committed 70.6h (80%
 * 62.3-78.6h) to installing at 05:41, and the install at 05:42 recorded
 * "the simulated exit installing now is 104.0h" — the committed wait priced a
 * batch (futures planned without the count tickets) the purchase step never
 * buys. Tolerance: 5% of the exit, or the Monte Carlo's option-specific noise
 * (as consistencyOf) where larger; a pass's own drift is well inside it (the
 * commitment is at most one pass old). Returns {ok, checks, tolH, why}.
 */
export const INSTALL_EXIT_TOL = { rel: 0.05, maxCarryMin: 60 }
export function installExitsOf(install, { actorH = null, now = Date.now(), si = 0.02, ver = null } = {}) {
  if (!install?.key || !fin(install.meanH)) return { ok: null, why: 'no install decision this pass' }
  if (install.key !== 'now') return { ok: null, why: `the plan installs at ${install.key}, not now: no install exit to compare` }
  const N = Math.max(1, install.n ?? 1)
  const c = install.commitment ?? null
  // Two prices of a trajectory that is a mean over members each carry its
  // Monte Carlo error (pointSeH): 4 of their joint sd, as the draws' term.
  const seJoint = Math.hypot(fin(install.pointSeH) ? install.pointSeH : 0, fin(c?.pointSeH) ? c.pointSeH : fin(install.pointSeH) ? install.pointSeH : 0)
  const tolOf = (h) => Math.max(INSTALL_EXIT_TOL.rel * h, (4 * Math.SQRT2 * si * h) / Math.sqrt(N), 4 * seJoint)
  const checks = []
  const agedH = c?.at && fin(Date.parse(c.at)) ? Math.max(0, (now - Date.parse(c.at)) / 3.6e6) : 0
  // A commitment priced on another exit model is not this model's promise:
  // a deploy between the two re-prices, it is not two exits. [TX6]
  const crossModel = !!(c && c.ver != null && ver != null && c.ver !== ver)
  const own = c && c.key !== 'now' && !crossModel ? c : null
  if (own && fin(own.meanH)) {
    const expH = own.meanH - agedH
    checks.push({ what: 'plan now vs the plan\'s commitment', a: install.meanH, b: +expH.toFixed(3), aName: `the plan's 'now' ${install.meanH}h`, bName: `its commitment ${own.key} ${own.meanH}h priced ${(agedH * 60).toFixed(0)} min ago` })
  }
  if (fin(actorH)) {
    // Point against point where the commitment carries one (no Monte Carlo
    // noise on either side), else against the plan's own 'now' point.
    if (own && fin(own.pointH)) checks.push({ what: 'install actor vs the plan\'s commitment', a: actorH, b: +(own.pointH - agedH).toFixed(3), aName: `the install actor's ${(+actorH).toFixed(2)}h`, bName: `the commitment ${own.key}'s point ${own.pointH}h priced ${(agedH * 60).toFixed(0)} min ago` })
    const nowPoint = fin(install.pointH) ? install.pointH : install.meanH
    checks.push({ what: 'install actor vs the plan\'s now', a: actorH, b: nowPoint, aName: `the install actor's ${(+actorH).toFixed(2)}h`, bName: `the plan's 'now' ${nowPoint}h` })
  }
  if (!checks.length) return { ok: null, why: crossModel ? `installing now: the commitment was priced on another exit model (${c.ver} -> ${ver}), not compared` : 'installing now: no commitment and no install-actor exit to compare' }
  for (const k of checks) {
    k.diffH = +(k.a - k.b).toFixed(3)
    k.tolH = +tolOf(Math.max(k.a, k.b)).toFixed(3)
    k.ok = Math.abs(k.diffH) <= k.tolH
  }
  const bad = checks.filter((k) => !k.ok)
  const worst = [...checks].sort((a, b) => Math.abs(b.diffH) - Math.abs(a.diffH))[0]
  return {
    ok: bad.length === 0,
    checks,
    diffH: worst.diffH,
    tolH: worst.tolH,
    why: bad.length
      ? `TWO EXITS AT INSTALL: ${bad.map((k) => `${k.aName} vs ${k.bName} differ by ${k.diffH}h (tolerance ${k.tolH}h)`).join('; ')}`
      : `one exit at install: ${checks.map((k) => `${k.aName} ~ ${k.bName}`).join('; ')}`,
  }
}

/**
 * EXIT JUMP AT INSTALL. The install actor prices "install this batch now" as
 * a trajectory through the next life; once that life begins, the plan prices
 * the SAME trajectory from inside it. The two must agree: the exit the next
 * life publishes is the install's exit less the hours since, within the
 * forecast's tolerance. Live BN9 2026-09-29: installed at 16:17Z on 50.26h
 * (plan 'now' mean 50.06h, 80% 45.8-54.4h); at 16:32Z the new life priced
 * the committed trajectory at 94.1h (80% 79.3-112.1h) — the point from one
 * trader-return estimator and the draws from another (traderBeliefOf). This
 * morning's install at 104h read 272h at life age 0.08h.
 *
 * Every exit the new life publishes in its first EXIT_JUMP.windowH hours is
 * compared, point with the actor's point and mean with the plan's 'now' mean
 * (install-last `exits`), each less the elapsed hours; the record keeps the
 * first and the worst and fails if any breaks tolerance (rel of the exit, or
 * minTolH, or the Monte Carlo's noise where larger). `prev` is the record the
 * life has carried so far. Returns {ok, install, first, worst, n, why} or
 * {ok: null, why} when there is nothing to compare.
 */
export const EXIT_JUMP = { rel: 0.15, minTolH: 1, windowH: 1, matchMin: 10 }
/**
 * The install record (act.js /tel/install-last.txt) is the install that began
 * the life stamped `lastAugReset`: act.js records it moments before the
 * install runs, and the new life's lastAugReset is the install itself.
 */
export function installBeganLife(rec, lastAugReset) {
  const installAt = Date.parse(rec?.at ?? '')
  return fin(installAt) && fin(lastAugReset) && rec.lastAugReset !== lastAugReset && Math.abs(installAt - lastAugReset) <= EXIT_JUMP.matchMin * 60e3
}

/**
 * WHAT THE INSTALL CARRIED INTO THE LIFE IT BEGAN (install-last `carry`,
 * built by progress.js at the install order): the beliefs the install's own
 * simulation priced the next life on, for the states the next life cannot
 * measure in its first minutes. Live BN9 2026-09-30 13:25Z (17 of 17 bought,
 * EXIT JUMP AT INSTALL +10.3h at life age 0.085h): the exp posterior read the
 * running scripts' 34 exp/s five minutes into a life (the fleet re-rooting)
 * at 25% weight, 1.4e3/s at level 468 where the install simulated 7.0e3/s
 * (the old life's measured rate x the batch's exp gain, level-scaled) — +6.8h
 * to +7.7h alone; and gang.js's forecast read $0/s over its whole horizon for
 * ~20 minutes after the install (its post-install respect mode), where the
 * install carried the pre-install forecast ($126m/s rising) — +1.1h to
 * +10.6h. Returns the record's carry when it began this life, else null.
 *   exp   {perSec, sdLn, level, mult, at}  the script exp posterior at the
 *         install pass, the level and hacking_exp multiplier it was read at
 *   gang  {steps [{atH, perSec}], at}       the gang's carried stream, node
 *         hours from `at`
 */
export function installCarryOf(rec, lastAugReset) {
  if (!rec?.carry || typeof rec.carry !== 'object' || !installBeganLife(rec, lastAugReset)) return null
  return rec.carry
}

/**
 * THE GANG'S POST-INSTALL GAP, BRIDGED. gang.js forecasts its adopted policy
 * and the first ~20 minutes after an install it adopts a respect policy with
 * no money in its whole horizon (live BN9 2026-09-30 08:19Z and 13:25Z: $0/s
 * to 8h, $13m/s back by 08:44Z) — a transient of the gang's own controller,
 * not the gang's income: members, respect and territory persist through the
 * install (Prestige.ts keeps Player.gang). Within INSTALL_CARRY.gangGraceH of
 * the life's start, a live stream with no money is replaced by the install's
 * carried stream, shifted by the node hours since it was built. Past the
 * grace, or with any money in the live forecast, the live one stands.
 * `live` [{atH, perSec}] or null; `carry` installCarryOf(...).gang.
 * Returns {steps, why} or null (nothing to bridge).
 */
export const INSTALL_CARRY = { gangGraceH: 0.5 }
export function gangBridgeOf(live, carry, { now = Date.now(), lifeStart = null, graceH = INSTALL_CARRY.gangGraceH } = {}) {
  if (!carry || !Array.isArray(carry.steps) || !carry.steps.some((s) => fin(s?.perSec) && s.perSec > 0)) return null
  if (!fin(lifeStart)) return null
  const ageH = (now - lifeStart) / 3.6e6
  if (!(ageH >= 0 && ageH < graceH)) return null
  if (Array.isArray(live) && live.some((s) => fin(s?.perSec) && s.perSec > 0)) return null
  const at = Date.parse(carry.at ?? '')
  if (!fin(at) || at > now + 60e3) return null
  const dH = Math.max(0, (now - at) / 3.6e6)
  const s = carry.steps.filter((x) => fin(x?.atH) && fin(x?.perSec)).map((x) => ({ atH: x.atH - dH, perSec: x.perSec }))
  const inForce = s.filter((x) => x.atH <= 0).pop()
  const steps = [...(inForce ? [{ atH: 0, perSec: inForce.perSec }] : []), ...s.filter((x) => x.atH > 0)]
  if (!steps.length) return null
  return { steps, why: `the install's carried gang stream (built ${carry.at}, ${dH.toFixed(2)}h ago; $${(steps[0].perSec / 1e6).toFixed(1)}m/s now): gang.js's forecast has no money ${ageH.toFixed(2)}h into the life, inside the ${graceH}h post-install grace` }
}

export function exitJumpOf(rec, exit, { lastAugReset = null, now = Date.now(), prev = null, si = 0.02, ver = null } = {}) {
  const carry = (why) => (prev && prev.install ? prev : { ok: null, why })
  // A DEPLOY INSIDE THE WINDOW re-prices the exit on another model: a
  // correction, not a jump. Keep the verdict the install's own model reached
  // and stop comparing (live 2026-09-30 14:45Z: 40f64df priced the new life
  // 3.8h sooner mid-window and this fired on the improvement). [EJ5]
  if (prev?.install && prev.ver != null && ver != null && prev.ver !== ver) return { ...prev, why: `${String(prev.why ?? '').replace(/ \(the exit model changed.*$/, '')} (the exit model changed ${prev.ver} -> ${ver} inside the window: later passes not compared)` }
  if (!rec?.at || !fin(lastAugReset)) return carry('no install record, or no life stamp')
  const installAt = Date.parse(rec.at)
  // The install that began THIS life: act.js records it moments before the
  // install runs; the new life's lastAugReset is the install itself.
  if (!installBeganLife(rec, lastAugReset)) return { ok: null, why: 'the last install record is not the install that began this life' }
  if (prev?.install && prev.install.at !== rec.at) prev = null
  const ex = rec.exits ?? null
  const preMean = fin(ex?.planH) ? ex.planH : null
  const prePoint = fin(ex?.actorH) ? ex.actorH : fin(ex?.planPointH) ? ex.planPointH : null
  if (preMean === null && prePoint === null) return { ok: null, why: `the install (${rec.at}) recorded no exit${rec.terminal ? ' (terminal install)' : ''}` }
  const install = { at: rec.at, actorH: prePoint, planH: preMean, q10: ex?.commitment?.q10 ?? null, q90: ex?.commitment?.q90 ?? null }
  const elapsedH = Math.max(0, (now - installAt) / 3.6e6)
  if (elapsedH > EXIT_JUMP.windowH) return prev?.install ? prev : { ok: null, install, why: `no exit priced in the first ${EXIT_JUMP.windowH}h after the install` }
  if (!exit || (!fin(exit.meanH) && !fin(exit.pointH))) return prev?.install ? prev : { ok: null, install, why: 'no exit priced yet this life' }
  const N = Math.max(1, exit.n ?? 24)
  const tolOf = (h) => Math.max(EXIT_JUMP.rel * h, EXIT_JUMP.minTolH, (4 * Math.SQRT2 * si * h) / Math.sqrt(N))
  const checks = []
  if (fin(prePoint) && fin(exit.pointH)) checks.push({ what: 'point', a: exit.pointH, b: +(prePoint - elapsedH).toFixed(3), aName: `the new life's point ${(+exit.pointH).toFixed(2)}h`, bName: `the install actor's ${prePoint.toFixed(2)}h less ${elapsedH.toFixed(2)}h` })
  if (fin(preMean) && fin(exit.meanH)) checks.push({ what: 'mean', a: exit.meanH, b: +(preMean - elapsedH).toFixed(3), aName: `the new life's mean ${(+exit.meanH).toFixed(2)}h`, bName: `the plan's 'now' mean ${preMean.toFixed(2)}h less ${elapsedH.toFixed(2)}h` })
  if (!checks.length) return prev?.install ? prev : { ok: null, install, why: 'no exit of the same kind to compare (point with point, mean with mean)' }
  for (const k of checks) {
    k.diffH = +(k.a - k.b).toFixed(3)
    k.tolH = +tolOf(Math.max(k.a, k.b)).toFixed(3)
    k.ok = Math.abs(k.diffH) <= k.tolH
  }
  const sample = { at: new Date(now).toISOString(), elapsedH: +elapsedH.toFixed(3), meanH: fin(exit.meanH) ? exit.meanH : null, pointH: fin(exit.pointH) ? exit.pointH : null, source: exit.source ?? null, ok: checks.every((k) => k.ok), checks }
  const badness = (x) => Math.max(0, ...(x?.checks ?? []).map((k) => Math.abs(k.diffH) / Math.max(1e-9, k.tolH)))
  const first = prev?.first ?? sample
  const worst = prev?.worst && badness(prev.worst) >= badness(sample) ? prev.worst : sample
  const ok = (prev?.ok !== false) && sample.ok
  const w = worst.checks.filter((k) => !k.ok)
  return {
    ok,
    install,
    first,
    worst,
    ver: prev?.ver ?? ver,
    n: (prev?.n ?? 0) + 1,
    why: ok
      ? `one trajectory across the install (${rec.at}): ${checks.map((k) => `${k.aName} ~ ${k.bName}`).join('; ')}`
      : `EXIT JUMP AT INSTALL (${rec.at}): ${w.map((k) => `${k.aName} vs ${k.bName}: ${k.diffH > 0 ? '+' : ''}${k.diffH}h (tolerance ${k.tolH}h)`).join('; ')} at ${worst.elapsedH}h into the life — the install priced the next life on one model and the life prices itself on another`,
  }
}

export function consistencyOf(install, grafts, { si = 0.02, atInstall = null } = {}) {
  const g = graftConsistencyOf(install, grafts, { si })
  if (!atInstall) return g
  // The install check runs whatever the graft decision did this pass; the
  // graft result stays readable on its own (graftOk / graftWhy).
  const ie = installExitsOf(install, { ...atInstall, si })
  const ok = g.ok === false || ie.ok === false ? false : g.ok === true || ie.ok === true ? true : null
  const why = ie.ok === false ? (g.ok === false ? `${ie.why}; ${g.why}` : ie.why) : ie.ok === null ? g.why : `${g.why}; ${ie.why}`
  return { ...g, ok, why, graftOk: g.ok ?? null, graftWhy: g.why ?? null, install: ie }
}
function graftConsistencyOf(install, grafts, { si = 0.02 } = {}) {
  if (!install?.key || !fin(install.meanH)) return { ok: null, why: 'no install decision this pass' }
  if (!grafts?.key || !grafts.basisNoiseKey) return { ok: null, why: 'no graft decision priced on a basis this pass' }
  const sameBasis = grafts.basisNoiseKey === install.noiseKey
  // ONE BASIS IS A TRAJECTORY AND ITS INPUTS. Both keys known and different:
  // the two decisions priced the same trajectory from two input builds (the
  // graft decision's, early in the pass, and the install decision's) — the
  // rebase that puts them on one did not run. Named, and it fails.
  if (sameBasis && install.inputsKey && grafts.inputsKey && install.inputsKey !== grafts.inputsKey) {
    const d = fin(grafts.meanH) ? +(grafts.meanH - install.meanH).toFixed(3) : null
    return { ok: false, sameBasis, sameInputs: false, installH: install.meanH, graftsH: grafts.meanH, diffH: d, why: `INCONSISTENT INPUTS: the install decision (${install.meanH}h) and the graft decision (${grafts.meanH}h) priced one trajectory from different inputs (${install.inputsKey} vs ${grafts.inputsKey}) — the rebase onto the install decision's inputs did not run` }
  }
  // ONE BATCH: the install decision re-plans its committed batch every pass
  // (point.committedGains); the graft decision, earlier in the pass, priced
  // the LAST pass's record — same install minute and inputs, so the same
  // noise and inputs keys, but another trajectory (live BN9 2026-09-29 13:56:
  // committed hacking x1.657 vs the graft basis's earlier batch, points 67.5h
  // vs 69.9h, both on all 24 draws; reported 71.7h vs 74.3h). The rebase runs
  // on a batch that differs; still differing here, it did not.
  if (sameBasis && grafts.basisGainsKey !== undefined && install.gainsKey !== undefined && grafts.basisGainsKey !== install.gainsKey) {
    const d = fin(grafts.meanH) ? +(grafts.meanH - install.meanH).toFixed(3) : null
    return { ok: false, sameBasis, sameBatch: false, installH: install.meanH, graftsH: grafts.meanH, diffH: d, why: `INCONSISTENT BATCH: the install decision (${install.meanH}h) and the graft decision (${grafts.meanH}h) priced one install time with different batches (${install.gainsKey} vs ${grafts.basisGainsKey}) — the rebase onto the install decision's batch did not run` }
  }
  // ONE DRAW SET: a budget-stopped Monte Carlo averages a prefix of the
  // draws, and two decisions stopped at different counts average different
  // prefixes. Where both carry their per-draw exits, the means compared are
  // over the draws BOTH priced (feasible in both).
  let gH = grafts.meanH
  let iH = install.meanH
  let N = Math.max(1, Math.min(install.n ?? 1, grafts.n ?? 1))
  let common = null
  if (Array.isArray(install.samples) && Array.isArray(grafts.samples)) {
    const m = Math.min(install.samples.length, grafts.samples.length)
    const pairs = []
    for (let i = 0; i < m; i++) if (fin(install.samples[i]) && fin(grafts.samples[i])) pairs.push([install.samples[i], grafts.samples[i]])
    if (pairs.length) {
      iH = +(pairs.reduce((a, p) => a + p[0], 0) / pairs.length).toFixed(3)
      gH = +(pairs.reduce((a, p) => a + p[1], 0) / pairs.length).toFixed(3)
      N = pairs.length
      common = { n: pairs.length, of: [install.samples.length, grafts.samples.length] }
    }
  }
  const tolH = Math.max(0.02 * iH, (4 * Math.SQRT2 * si * iH) / Math.sqrt(N))
  if (!sameBasis) return { ok: null, sameBasis, installH: install.meanH, graftsH: grafts.meanH, why: `the graft decision was priced on ${grafts.basisNoiseKey}, the install committed ${install.noiseKey}: not comparable this pass (re-priced on the next)` }
  const diffH = +(gH - iH).toFixed(3)
  const ok = Math.abs(diffH) <= tolH
  const on = common ? ` on the ${common.n} draws both priced (of ${common.of[0]} and ${common.of[1]})` : ''
  return { ok, sameBasis, installH: iH, graftsH: gH, diffH, tolH: +tolH.toFixed(3), ...(common ? { common } : {}), why: ok ? `install and graft decisions price one trajectory: ${iH}h vs ${gH}h${on}` : `INCONSISTENT: the install decision's committed exit ${iH}h and the graft decision's ${gH}h differ by ${diffH}h (tolerance ${tolH.toFixed(2)}h) on the same basis${on}` }
}

/**
 * ANY DISCRETE CHOICE among simulated trajectories, committed (the sleeve
 * objective): options [{key, sim: (d) => hours}] on the shared draws; the
 * previous record's key is the incumbent. Same rule and record shape as the
 * route decision.
 */
export function decideAmong(o = {}) {
  return drain(decideAmongGen(o))
}
/** The generator decideAmong drains (yields inside the Monte Carlo). */
export function* decideAmongGen({ options, prev = null, draws, redecide = true, budgetMs = PLAN.budgetMs, theta = PLAN.theta, now = Date.now(), pointOf = () => null, clock: budgetClock = clock, ocba = PLAN.ocba } = {}) {
  const keys = new Set((options ?? []).map((o) => o.key))
  const committedKey = prev?.key && keys.has(prev.key) ? prev.key : null
  const use = !redecide && committedKey ? options.filter((o) => o.key === committedKey) : options
  if (!use?.length) return { key: null, why: 'no option', decidedAt: prev?.decidedAt ?? null }
  const ev = yield* evaluateGen(use, draws, { budgetMs, now: budgetClock, alloc: !redecide && committedKey ? null : allocOf(ocba, committedKey) })
  const { stats } = summarize(ev.samples)
  const pricedAt = new Date(now).toISOString()
  const rows = optionRows(use, stats, (o) => pointOf(o.key), pricedAt)
  const cpu = { n: ev.n, ms: ev.ms, overBudget: ev.overBudget, alloc: ev.alloc }
  if (!redecide && committedKey) return { key: committedKey, ...stats[committedKey], samples: samplesOf(ev.samples[committedKey]), ...heldFields(prev, rows, pricedAt), ...heldSanity(prev), ...cpu }
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta, committedPrevH: committedKey && fin(prev?.meanH) ? prev.meanH : null })
  if (d.choice === null) return { key: null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...cpu }
  return { key: d.choice, ...stats[d.choice], samples: samplesOf(ev.samples[d.choice]), held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, vowH: d.vowH ?? null, margins: marginsOf(ev.samples, d.choice), ...(d.commit ? { commit: d.commit } : {}), why: d.why, ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows, pricedAt, ...cpu }
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

/**
 * A PURCHASE, committed to NOT buying until the evidence says buy. A spend
 * verdict is "exit with it" against "exit without it" (exitplan.spendExit),
 * one deterministic pair; its uncertainty here is the simulator's measured
 * OPTION-SPECIFIC error only (si, bayes.jitterPosterior) on the two
 * trajectories — parameter draws are NOT propagated (each spendExit re-plans
 * the augmentation batch: too heavy to repeat per draw on the main thread),
 * stated in the verdict. Buy iff the saving is positive and
 * P(with < without) = Phi(-delta / (sqrt 2 si H)) >= theta.
 */
export function decideSpend({ deltaH, withoutH, si, theta = PLAN.theta, dominant = null } = {}) {
  if (!fin(deltaH) || !fin(withoutH) || !(withoutH > 0)) return null
  // A MONEY-DOMINANT SPEND (`dominant`: {paybackH, W, surplus} from the
  // caller): it returns its cost before the install point W and leaves
  // strictly more money there. With and without are then the same trajectory
  // but for more money at W, and the exit is non-increasing in that money
  // (the planner buys a superset batch), so the pair is ordered in EVERY
  // draw: the simulator's option-specific error — the jitter between
  // DIFFERENT trajectories — does not apply. Live in BitNode 9 (2026-09-28)
  // the 4.43h error bar refused a hacknet upgrade paying back in 3 minutes of
  // a 21h life; no small income purchase could ever clear it.
  if (dominant && fin(dominant.paybackH) && fin(dominant.W) && dominant.paybackH < dominant.W && deltaH <= 0) {
    return { buy: true, pBuy: 1, sdH: 0, dominant: true, why: `buy: money-dominant — repays its cost in ${dominant.paybackH < 1 ? `${(dominant.paybackH * 60).toFixed(1)}min` : `${dominant.paybackH.toFixed(2)}h`} of the ${dominant.W.toFixed(2)}h to the install and leaves more money there (exit ${deltaH === 0 ? 'unchanged' : `${Math.abs(deltaH).toFixed(3)}h sooner`}; ordered in every draw, so no error bar applies)` }
  }
  const sd = Math.SQRT2 * (fin(si) && si > 0 ? si : Math.sqrt(PRIORS.jitter.b / (PRIORS.jitter.a - 1))) * withoutH
  const pBuy = phi(-deltaH / sd)
  const buy = deltaH < 0 && pBuy >= theta
  return { buy, pBuy: +pBuy.toFixed(3), sdH: +sd.toFixed(3), why: `${buy ? 'buy' : 'hold'}: the exit ${deltaH < 0 ? 'shortens' : 'lengthens'} by ${Math.abs(deltaH).toFixed(3)}h against a ${sd.toFixed(2)}h option-specific error — P(better) ${(100 * pBuy).toFixed(0)}% (${buy ? '>=' : 'needs'} ${(100 * theta).toFixed(0)}%; parameter uncertainty not propagated for spends)` }
}

/**
 * THE HEALTHCHECK'S READ OF /tel/plan.txt (tools/healthcheck.mjs section F,
 * and the suite). Fails loud on: no plan while the planner runs, a stale
 * plan, a plan from another life, a plan that recorded an error, a pass that
 * broke the CPU budget, and predictive intervals that do not cover what they
 * claim (the 80% interval of the one-step forecast covering outside
 * [PLAN_CAL.lo, PLAN_CAL.hi] over at least PLAN_CAL.minN pairs).
 * Returns {fails: [{what, detail}], notes: [string]}.
 */
export const PLAN_CAL = { minN: 8, lo: 0.55, hi: 0.97, staleMin: 45 }

/**
 * EXIT UNSTABLE. Between two consecutive passes of one life with NO EVENT
 * (nothing re-decided: the plan holds its commitments), the committed exit
 * may move only by the hours that passed (a followed plan's exit falls 1h per
 * hour) plus the Monte Carlo's own noise: the draws are the same vectors
 * every pass (seeded per life, makeDraws), so a held trajectory re-priced on
 * unchanged beliefs moves by far less than its standard error. Tolerance:
 * EXIT_STABLE.k standard errors of the difference of the two means (each
 * sd/sqrt(n) over its per-draw exits), at least minTolH. Beyond it something
 * moved that the plan does not treat as an event — a graft set replaced under
 * a held key, an input read at a different point — and it fails loudly. Live
 * BN9 2026-09-29: 19.5h, 176h, 71.0h, 45.7h, 12.9h on consecutive passes.
 * prev/rec: plan records. Returns {ok (true|false|null), ...numbers, why}.
 */
export const EXIT_STABLE = { k: 4, minTolH: 0.5, maxGapMin: 20 }
/** The later lives' length a plan record's exit is on: the committed life length, else its install decision's noise key. */
export function planLifeOf(rec) {
  const ll = rec?.decisions?.lifeLength
  if (ll?.key && fin(ll.lifeH)) return +(+ll.lifeH).toFixed(3)
  return lifeOfNoiseKey(rec?.decisions?.install?.noiseKey)
}
export function exitStabilityOf(prev, rec) {
  const cur = exitStabilityNow(prev, rec)
  // A failure stays on the record for an hour (the healthcheck runs every 15
  // minutes; a pass-to-pass check read only on its own pass would be missed).
  const pf = prev?.exitStability
  const last = pf?.ok === false ? { at: prev.at, why: pf.why } : pf?.lastFail ?? null
  const keep = last && cur.ok !== false && fin(Date.parse(last.at)) && Date.parse(rec?.at) - Date.parse(last.at) <= 60 * 60e3 && prev?.lastAugReset === rec?.lastAugReset
  return keep ? { ...cur, lastFail: last } : cur
}
function exitStabilityNow(prev, rec) {
  const ex = rec?.exit
  const px = prev?.exit
  if (!ex || !fin(ex.meanH) || !px || !fin(px.meanH)) return { ok: null, why: 'no exit on this pass or the last' }
  if (prev.lastAugReset !== rec.lastAugReset || prev.node !== rec.node) return { ok: null, why: 'the last pass was another life' }
  // A deploy re-prices the exit on another model: a correction, not drift.
  if (prev.ver !== undefined && rec.ver !== undefined && prev.ver !== rec.ver) return { ok: null, why: `the exit model changed (${prev.ver} -> ${rec.ver}): not comparable` }
  const events = Array.isArray(rec.events) ? rec.events : []
  if (events.length) return { ok: null, why: `re-decided this pass (${events.join('; ').slice(0, 160)}): the exit may move` }
  const dtH = (Date.parse(rec.at) - Date.parse(px.at ?? prev.at)) / 3.6e6
  if (!(dtH >= 0) || dtH * 60 > EXIT_STABLE.maxGapMin) return { ok: null, why: `the last exit is ${fin(dtH) ? (dtH * 60).toFixed(0) : '?'} min old: not consecutive passes` }
  // THE LATER LIVES' LENGTH IS ON THE BASIS: a held plan's exit cannot move
  // to another L without the switch being an event (decideLifeLengthGen). Live
  // BN9 2026-09-30 07:04Z the purchase model's chooser moved 0.5h -> 3h and
  // the exit 15.5h -> 26.2h on a pass that re-decided nothing.
  const lp = planLifeOf(prev)
  const lc = planLifeOf(rec)
  if (lp !== null && lc !== null && lp !== lc) return { ok: false, prevH: px.meanH, curH: ex.meanH, dtH: +dtH.toFixed(3), lifeL: { prev: lp, cur: lc }, prevAt: prev.at, why: `EXIT UNSTABLE: the later lives' length moved L${lp} -> L${lc} with no event (${px.meanH}h -> ${ex.meanH}h over ${(dtH * 60).toFixed(0)} min) — a length switch must be the life length decision's, and an event` }
  const seOf = (x, d) => {
    const s = Array.isArray(d?.samples) ? d.samples.filter(fin) : []
    if (s.length >= 2) {
      const m = s.reduce((a, b) => a + b, 0) / s.length
      const v = s.reduce((a, b) => a + (b - m) * (b - m), 0) / (s.length - 1)
      return Math.sqrt(v / s.length)
    }
    // No per-draw exits: the 80% interval's width as ~2.56 sd, over N draws.
    const lo = fin(x.rawQ10) ? x.rawQ10 : x.q10
    const hi = fin(x.rawQ90) ? x.rawQ90 : x.q90
    return fin(lo) && fin(hi) ? (hi - lo) / 2.563 / Math.sqrt(Math.max(1, d?.n ?? 24)) : null
  }
  // A point that is a mean over members carries its own Monte Carlo error
  // (pointSeH): the draws' standard error does not see it (each member
  // repeats over the draws), so the larger of the two.
  const withPoint = (se, d) => (fin(d?.pointSeH) ? Math.max(fin(se) ? se : 0, d.pointSeH) : se)
  const se1 = withPoint(seOf(px, prev.decisions?.install), prev.decisions?.install)
  const se2 = withPoint(seOf(ex, rec.decisions?.install), rec.decisions?.install)
  const se = fin(se1) && fin(se2) ? Math.sqrt(se1 * se1 + se2 * se2) : fin(se1) ? se1 * Math.SQRT2 : fin(se2) ? se2 * Math.SQRT2 : null
  const tolH = Math.max(EXIT_STABLE.minTolH, fin(se) ? EXIT_STABLE.k * se : 0.1 * px.meanH)
  const expectedH = px.meanH - dtH
  const diffH = ex.meanH - expectedH
  const ok = Math.abs(diffH) <= tolH
  const out = { ok, prevH: px.meanH, curH: ex.meanH, expectedH: +expectedH.toFixed(3), diffH: +diffH.toFixed(3), tolH: +tolH.toFixed(3), dtH: +dtH.toFixed(3), prevAt: prev.at, prevSource: px.source ?? null, curSource: ex.source ?? null }
  return { ...out, why: ok ? `exit ${px.meanH}h -> ${ex.meanH}h over ${(dtH * 60).toFixed(0)} min with no event: within ${tolH.toFixed(2)}h of the ${expectedH.toFixed(2)}h a held plan expects` : `EXIT UNSTABLE: ${px.meanH}h (${px.source ?? '?'}, ${prev.at}) -> ${ex.meanH}h (${ex.source ?? '?'}) over ${(dtH * 60).toFixed(0)} min with no event — ${diffH > 0 ? '+' : ''}${diffH.toFixed(2)}h against the ${expectedH.toFixed(2)}h a held plan expects (tolerance ${tolH.toFixed(2)}h = ${EXIT_STABLE.k} standard errors of the draws)` }
}

/**
 * OPTIONS OFF BASIS. Every option a decision publishes must be priced on the
 * basis of the committed exit it is compared with:
 *   - within a decision, every option row was priced on the pass the
 *     decision's own exit was (row.pricedAt === decision.pricedAt) — a held
 *     decision carrying its deciding pass's options beside a re-priced exit
 *     is off basis (live 19:22Z: a 71h exit beside 241-373h options);
 *   - the graft decision's options are priced on the install decision's
 *     committed trajectory: the same install time (noise key without its
 *     graft count), the same inputs, and its committed side IS the install's
 *     trajectory (the same noise key, graft count included) — live 19:22Z the
 *     install priced 9 grafts (g9) while the graft decision's options were
 *     on 6 (g6), and the one-plan check only said 'not comparable'.
 * Returns {ok (true|false|null), fails: [..], checked, why}.
 */
/**
 * THE DECISIONS THE BLADEBURNER ROUTE MAKES MOOT. With decisions.bladeRoute
 * 'blade' and the install decision on that route (route 'blade'), the
 * committed exit is the black ops' (bbplan.bladeExit, noise key
 * 'bladeburner'). Four decisions still price the World Daemon exit — they
 * are the route decision's HACK ARM, the alternative it is compared with —
 * and none of them is on the committed trajectory:
 *   grafts      no graft starts on the route (progress.js graftStep: the work
 *               slot is the division's — d66a620); the committed set is the
 *               hack arm's plan.
 *   lifeLength  the later lives' length is the hacking cadence; on the route
 *               every install is the black-op install decision's.
 *   fourS       a money purchase: the black-op exit prices no money.
 *   batch       chosen on the hacking exit's channel weights; the black-op
 *               install decision prices whatever batch is bought on its own
 *               exit (bladeContentOf) — a batch chosen BY that exit is not
 *               simulated (named, not folded in).
 * Live 2026-10-01 13:37Z: OPTIONS OFF BASIS failed on the graft options
 * (default|L12|g7) beside the committed exit (bladeburner). They were never
 * on its basis and never could be; the record says so instead
 * (applicable: false, notApplicable: why) and the basis check skips them
 * by that field, naming each. Returns {on, why, moot: {name: why}}.
 */
export const BLADE_MOOT = {
  grafts: 'no graft starts on the committed Bladeburner route (the work slot is the division\'s): this prices the World Daemon exit — the route decision\'s hack arm — and is not acted on',
  lifeLength: 'the later lives\' length is the hacking route\'s cadence; on the committed Bladeburner route every install is the black-op install decision\'s: this prices the hack arm only',
  fourS: 'a money purchase priced on the World Daemon exit; the committed black-op exit prices no money: the hack arm\'s decision, not on the committed exit\'s basis',
  sleeveObjective: 'the fleet\'s objective (karma, reputation, exp, money) priced on the World Daemon exit; on the committed Bladeburner route the fleet is sleeve.js\'s Bladeburner mix, priced on the black-op exit — not run (live 22:59Z it opened and never closed before the page froze)',
  batch: 'chosen on the World Daemon exit\'s channel weights; on the committed Bladeburner route the install decision prices the bought batch\'s content on the black-op exit — a batch chosen by the black-op exit is not simulated',
  gang: 'the gang (none / the fleet grinds / the fleet and the slot grind) is priced on the World Daemon exit; on the committed Bladeburner route nothing acts on it — act.js hands the work slot to the division before its gang branches (0b), and the fleet is never on karma (sleeveObjectiveByExit: blade) — so this life\'s last priced verdict is carried, not re-priced (live BN14 2026-10-04 00:19Z the re-pricing held the page 261.7ms, \'gang-grind\')',
}
export function bladeMootOf(decisions) {
  const br = decisions?.bladeRoute
  const inst = decisions?.install
  const on = br?.key === 'blade' && inst?.route === 'blade'
  return on ? { on, why: 'the committed route is Bladeburner and the install decision prices the black-op exit', moot: { ...BLADE_MOOT } } : { on: false, why: br?.key === 'blade' ? 'the route is Bladeburner but the install decision is not priced on it yet' : 'not on the Bladeburner route', moot: {} }
}
/** Mark the moot decisions on a record's decisions (progress.js publish): applicable false, with the reason. */
export function markBladeMoot(decisions) {
  const m = bladeMootOf(decisions)
  const out = { ...decisions }
  for (const name of Object.keys(BLADE_MOOT)) {
    const x = out[name]
    if (!x || typeof x !== 'object') continue
    if (m.on) out[name] = { ...x, applicable: false, notApplicable: m.moot[name] }
    else if ('applicable' in x || 'notApplicable' in x) {
      // Off the route (or a record carried from it): the mark goes with it.
      const { applicable: _a, notApplicable: _n, ...rest } = x
      out[name] = rest
    }
  }
  return out
}

export function optionsBasisOf(plan) {
  const d = plan?.decisions ?? {}
  const fails = []
  const skipped = []
  let checked = 0
  for (const name of ['install', 'grafts', 'countRoute', 'sleeveObjective', 'lifeLength']) {
    const x = d[name]
    if (!x?.key || !Array.isArray(x.options) || !x.options.length) continue
    checked++
    // The committed option's own row must read the decision's exit (any
    // record format): the held install's 'committed' row, else its key's.
    const own = x.options.find((o) => o.key === x.key) ?? (name === 'install' && x.held ? x.options.find((o) => o.key === 'committed') : null)
    if (own && fin(own.meanH) && fin(x.meanH) && Math.abs(own.meanH - x.meanH) > 1e-3 * Math.max(1, x.meanH)) fails.push(`${name}: its committed option's row reads ${own.meanH}h where its exit is ${x.meanH}h — the rows are another pass's pricing`)
    if (!x.pricedAt) continue // a record from before options carried their pass
    const off = x.options.filter((o) => o.pricedAt !== x.pricedAt)
    if (off.length) fails.push(`${name}: ${off.length} of ${x.options.length} option(s) priced on another pass (${[...new Set(off.map((o) => o.pricedAt ?? 'unstamped'))].slice(0, 2).join(', ')}) than its exit (${x.pricedAt})`)
  }
  const inst = d.install
  const g = d.grafts
  // A decision the committed route makes moot (markBladeMoot) prices the
  // other route's exit by design: its own rows are still checked above; the
  // cross-check against the committed exit is skipped, by name.
  if (g?.key && g.applicable === false) skipped.push(`grafts: not applicable (${String(g.notApplicable ?? 'no reason given').slice(0, 120)})`)
  if (inst?.key && inst.noiseKey && g?.key && g.applicable !== false && Array.isArray(g.options) && g.options.length && !g.flippedOnRebase) {
    checked++
    const at = (k) => String(k ?? '').replace(/\|g\d+$/, '')
    const offAt = g.options.filter((o) => o.noiseKey && at(o.noiseKey) !== at(inst.noiseKey))
    if (offAt.length) fails.push(`grafts: option(s) ${offAt.map((o) => `${o.key} on ${o.noiseKey}`).join(', ')} priced on another install time than the committed exit (${inst.noiseKey})`)
    const mine = { noiseKey: g.options.find((o) => o.key === g.key)?.noiseKey ?? g.basisNoiseKey ?? null }
    if (mine.noiseKey && mine.noiseKey !== inst.noiseKey) fails.push(`grafts: the committed '${g.key}' is priced on ${mine.noiseKey} while the install decision's exit is on ${inst.noiseKey} — two graft sets`)
    if (inst.inputsKey && g.inputsKey && inst.inputsKey !== g.inputsKey) fails.push(`grafts: priced from inputs ${g.inputsKey}, the install decision from ${inst.inputsKey}`)
    if (inst.pricedAt && g.pricedAt && Date.parse(g.pricedAt) < Date.parse(inst.pricedAt) - 10 * 60e3) fails.push(`grafts: priced at ${g.pricedAt}, the install decision at ${inst.pricedAt}`)
  }
  const sk = skipped.length ? `; skipped: ${skipped.join('; ')}` : ''
  if (!checked) return { ok: null, fails, checked, skipped, why: `no decision with stamped options this pass${sk}` }
  return { ok: !fails.length, fails, checked, skipped, why: fails.length ? `OPTIONS OFF BASIS: ${fails.join('; ')}${sk}` : `every option of ${checked} check(s) priced on its committed exit's basis${sk}` }
}

/**
 * GRAFTS DROPPED: the committed graft set must be in the install decision's
 * inputs. The plan is one trajectory — an install decision priced without the
 * grafts the node has committed to prices a different node (live BN9
 * 2026-09-29 13:41Z and 14:51Z: a refused graft search dropped the 28
 * committed grafts, the incumbent install re-priced at ~26,000h, and the plan
 * switched on the artefact).
 *
 * Expected: the graft decision's committed set when it DECIDED ('grafts' ->
 * its set, 'none' -> nothing); when it did not (a refusal, a throw, a pass
 * that did not reach it), the set it kept (`kept`), else the node's graft
 * memory — a non-decision never means "graft nothing". Installed names are
 * dropped from both sides (they are in the multiplier). A graft decision that
 * flipped when rebased this pass is a note: the install decision priced the
 * pre-flip set and re-decides next pass (forceRedecide).
 * Returns {ok (true|false|null), expected, carried, why}.
 */
export function graftCarryCheckOf({ install = null, installInputs = null, grafts = null, memory = null, installed = [] } = {}) {
  if (!install?.key || !installInputs) return { ok: null, why: 'no install decision priced this pass' }
  const own = new Set(installed instanceof Set ? installed : Array.isArray(installed) ? installed : [])
  const names = (xs) => (Array.isArray(xs) ? xs : []).map((g) => (typeof g === 'string' ? g : g?.name)).filter((n) => typeof n === 'string' && !own.has(n))
  const carried = [...names(installInputs.finalGrafts), ...names(installInputs.lifeGrafts)]
  let expected = null
  let source = null
  if (grafts?.key === 'grafts') {
    expected = names(grafts.grafts)
    source = 'the committed graft decision'
  } else if (grafts?.key === 'none') {
    expected = []
    source = "the graft decision ('none')"
  } else if (Array.isArray(grafts?.kept?.grafts) && grafts.kept.grafts.length) {
    expected = names(grafts.kept.grafts)
    source = `the set the graft decision kept (${grafts.why ? String(grafts.why).slice(0, 80) : 'no decision'})`
  } else if (Array.isArray(memory?.names) && memory.names.length) {
    expected = names(memory.names)
    source = `the node's graft memory (graft decision: ${grafts ? String(grafts.why ?? 'no key').slice(0, 80) : 'not reached'})`
  } else return { ok: null, carried, why: 'no committed graft set and no graft memory' }
  const a = new Set(carried)
  const b = new Set(expected)
  const missing = expected.filter((n) => !a.has(n))
  const extra = carried.filter((n) => !b.has(n))
  if (!missing.length && !extra.length) return { ok: true, expected: expected.length, carried: carried.length, source, why: `the install decision's inputs carry ${carried.length} graft(s), as ${source}` }
  if (grafts?.flippedOnRebase) return { ok: null, expected: expected.length, carried: carried.length, source, why: `graft decision flipped on rebase (${grafts.flippedOnRebase}): the install decision priced the pre-flip set (${carried.length}); re-decided next pass` }
  return {
    ok: false,
    expected: expected.length,
    carried: carried.length,
    missing: missing.slice(0, 40),
    extra: extra.slice(0, 40),
    source,
    why: `GRAFTS DROPPED: the install decision (${install.key}) priced ${carried.length} graft(s) where ${source} holds ${expected.length}${missing.length ? ` — missing ${missing.length} (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''})` : ''}${extra.length ? ` — ${extra.length} not committed (${extra.slice(0, 3).join(', ')})` : ''}`,
  }
}
/** The note a voided install's failed exit check becomes (installgate.installVoidOf). */
const voidNoteOf = (v) => `VOIDED INSTALL ${v.at} (installgate.BLADE_JUMP_VOID — ${v.why}) — not failed`
/**
 * THE FORECAST'S CALIBRATION, read for the healthcheck (exitcal.js). The
 * alarm is ANYTIME-VALID: the e-processes on the recalibrated revisions
 * (narrow: E z^2 <= 1, wide: P(inside 80%) <= 0.8) fail at e >= 1/alpha, so
 * the check may be read every 15 minutes forever with a false-alarm
 * probability <= alpha per test. It replaced the coverage band [0.55, 0.97]
 * at n >= 8 (PLAN_CAL lo/hi — still used for a record written before the
 * e-processes, which carries none). Also FAILS: the width multiplier pinned
 * at its bound (one multiplier cannot correct it), the recalibration scoring
 * WORSE in CRPS than the raw intervals (a narrowing that loses accuracy), a
 * report that threw. Notes: the verdict (overstated / structural), the
 * multiplier, CRPS, the suspects, the differences, the commitment shadow.
 */
export function calibrationCheckOf(c, fail, notes) {
  if (!c) return
  if (c.error) fail(`PLAN CALIBRATION BROKEN: ${c.error}`, 'the exit calibration report threw: no e-process, no multiplier — the plan runs on its raw intervals (exitcal.js)')
  const ep = c.eprocess
  if (!ep) {
    if (fin(c.cover80) && c.n >= PLAN_CAL.minN && (c.cover80 < PLAN_CAL.lo || c.cover80 > PLAN_CAL.hi)) fail(`PLAN MISCALIBRATED: the 80% forecast interval covered ${(100 * c.cover80).toFixed(0)}% of ${c.n} realised moves`, `${c.why} — ${c.cover80 < PLAN_CAL.lo ? 'intervals too narrow: the posterior is overconfident, so switches and holds are being made on noise' : 'intervals too wide: the posterior is underconfident, so real differences are being ignored'}`)
    else notes.push(`plan calibration: ${c.why ?? 'none'}`)
    return
  }
  const verdict = c.martingale?.why ?? c.why ?? ''
  if (ep.narrow?.alarm) fail(`PLAN MISCALIBRATED: the exit forecast's revisions exceed its recalibrated intervals — e-process ${ep.narrow.e.toPrecision(3)} >= ${1 / ep.alpha} over ${ep.narrow.n} revisions (anytime-valid at ${ep.alpha}; first crossed ${ep.narrow.crossedAt})`, `too narrow or biased even at x${c.recal?.applied ?? '?'} (exitcal recal): ${verdict.slice(0, 400)}`)
  if (ep.wide?.alarm) fail(`PLAN MISCALIBRATED: the exit forecast's recalibrated intervals are too wide — e-process ${ep.wide.e.toPrecision(3)} >= ${1 / ep.alpha} over ${ep.wide.n} revisions (anytime-valid at ${ep.alpha}; first crossed ${ep.wide.crossedAt})`, `underconfident even at x${c.recal?.applied ?? '?'}: ${verdict.slice(0, 400)}`)
  if (c.recal?.atBound) fail(`PLAN RECALIBRATION AT BOUND: ${c.recal.why}`, 'the forecast is off by more than one width multiplier can correct — the structural error is the fix (the verdict and its reasons)')
  if (c.crps?.since?.worse) fail(`PLAN RECALIBRATION WORSENED ACCURACY: CRPS ${c.crps.since.recalH}h recalibrated against ${c.crps.since.rawH}h raw over ${c.crps.since.n} revisions`, 'the multiplier moved the intervals and the forecast scored worse: the recalibration is chasing coverage at the cost of accuracy')
  notes.push(`plan calibration: ${String(c.why ?? '').slice(0, 500)}`)
  if (c.recal) notes.push(`plan width multiplier: ${c.recal.why}`)
  if (c.crps?.window) notes.push(`plan CRPS (mean, hours, this node's window of ${c.crps.window.n}): one-step iid model ${c.crps.window.legacyH}, martingale raw ${c.crps.window.martingaleH}, recalibrated ${c.crps.window.recalH}; since the state began raw ${c.crps.since?.rawH} vs recalibrated ${c.crps.since?.recalH} over ${c.crps.since?.n}`)
  if (c.suspects) notes.push(`plan calibration suspects: (a) ${c.suspects.prior?.why} (b) ${c.suspects.serial?.why}`)
  if (!ep.narrow?.alarm && !ep.wide?.alarm) notes.push(`plan e-processes: ${ep.narrow?.why}; ${ep.wide?.why}`)
  notes.push(`plan e-processes, unscaled model: ${ep.rawNarrow?.why}; ${ep.rawWide?.why}`)
  if (c.values) notes.push(`plan differences: ${c.values.diff?.why ?? 'none'}; switches: ${c.values.switches?.why ?? 'none'}`)
  const log = c.state?.commitLog ?? []
  const dis = log.filter((x) => x.agree === false)
  if (log.length) notes.push(`plan commitment shadow: ${log.length} decision(s) logged, ${dis.length} where the expected-loss and P >= 0.8 rules disagree${dis.length ? ` (last: ${dis[dis.length - 1].name} at ${dis[dis.length - 1].at}: ${dis[dis.length - 1].rule} ${dis[dis.length - 1].switch ? 'switched' : 'held'})` : ''}`)
}
export function planCheck(plan, { gate = null, progress = null, now = Date.now(), bootstrap = null } = {}) {
  const fails = []
  const notes = []
  const fail = (what, detail) => fails.push({ what, detail })
  const plannerRuns = progress && fin(Date.parse(progress.at)) && (now - Date.parse(progress.at)) / 60e3 < PLAN_CAL.staleMin
  if (!plan) {
    if (plannerRuns) fail('PLAN MISSING: /tel/plan.txt absent while progress.js runs', 'the deciders have no committed plan to read — every choice is back to a per-pass argmin')
    return { fails, notes }
  }
  const age = (now - Date.parse(plan.at)) / 60e3
  // BELOW THE STACK'S TIER progress.js is not placed at all (boot.js admits it
  // at 64GB): a stale plan is the bootstrap, not a planner returning early.
  // Live BN6 2026-10-01: 32GB home, PLAN STALE for the whole crime-money
  // opening. The bootstrap has its own check (BOOTSTRAP STALLED). [BY9]
  if (!(age < PLAN_CAL.staleMin)) {
    if (bootstrap) notes.push(`plan ${fin(age) ? age.toFixed(0) : '?'} min old: ${bootstrap} — progress.js is not placed yet`)
    else fail(`PLAN STALE: /tel/plan.txt is ${fin(age) ? age.toFixed(0) : '?'} min old`, 'progress.js has not reached a decision pass since — find where the pass returns early')
  }
  if (gate && gate.lastAugReset !== undefined && plan.lastAugReset !== gate.lastAugReset && Date.parse(plan.at) < Date.parse(gate.at)) fail('PLAN FROM ANOTHER LIFE: plan.txt lastAugReset differs from the gate\'s', 'a reader would follow a previous life\'s commitment')
  if (plan.health === 'error') fail(`PLAN BROKEN: ${plan.error ?? 'health error'}`, 'a decision threw or the context could not be built; the named fallbacks decide meanwhile')
  // THE PAGE-FREEZE CHECK is the longest synchronous block, not the total:
  // the searches yield between slices. A record from before the slicing (cpu
  // without maxBlockMs) is judged on its total, as it was then.
  const cpu = plan.cpu
  // The section that holds the longest single step (cpu.sections): where the
  // un-sliced work is.
  const worst = cpu?.sections ? Object.entries(cpu.sections).sort((a, b) => (b[1].maxStepMs ?? 0) - (a[1].maxStepMs ?? 0))[0] : null
  const where = worst ? ` — longest step ${worst[1].maxStepMs}ms in '${worst[0]}' (step ${worst[1].maxStepAt} of ${worst[1].steps})` : ''
  if (cpu && fin(cpu.maxBlockMs) && cpu.maxBlockMs > (cpu.maxBlockLimitMs ?? PLAN.maxBlockMs)) fail(`PLAN BLOCKED THE PAGE: a ${cpu.maxBlockMs}ms synchronous block against ${cpu.maxBlockLimitMs ?? PLAN.maxBlockMs}ms${where}`, 'a piece of work ran without yielding (coop.js slices): split that section\'s step with more yields, or speed it; a step that moves between sections from pass to pass is a GC pause, not code')
  else if (worst) notes.push(`plan longest step: ${worst[1].maxStepMs}ms in '${worst[0]}'`)
  else if (cpu && !('maxBlockMs' in cpu) && cpu.overBudget) fail(`PLAN OVER CPU BUDGET: ${cpu.ms}ms against ${cpu.budgetMs}ms`, 'the Monte Carlo runs on the game\'s main thread (the page has frozen before) — lower PLAN.N or PLAN.topK')
  if (cpu && cpu.truncated) notes.push(`plan Monte Carlo truncated at its ${cpu.budgetMs}ms work budget (${cpu.draws} of ${cpu.N} draws)`)
  if (cpu && fin(cpu.draws) && cpu.draws < 8 && fin(cpu.N)) fail(`PLAN UNDER-SAMPLED: ${cpu.draws} of ${cpu.N} draws`, 'the work budget stopped the Monte Carlo before its probabilities mean anything — the decision rests on too few paired draws')
  // TWO EXITS AT INSTALL (plan.installExitsOf) and the graft decision's
  // basis (graftConsistencyOf) are separate failures with separate causes.
  const cons = plan.consistency ?? null
  const ie = cons?.install ?? null
  const graftOk = cons && 'graftOk' in cons ? cons.graftOk : cons?.ok
  const graftWhy = cons && 'graftWhy' in cons ? cons.graftWhy : cons?.why
  if (ie?.ok === false) fail(String(ie.why).startsWith('TWO EXITS AT INSTALL') ? ie.why : `TWO EXITS AT INSTALL: ${ie.why}`, 'the install actor, the plan\'s \'now\' and the exit the plan committed for this install price one act differently — one of them is pricing another batch or trajectory (plan.installExitsOf; every install time\'s batch comes from replanAt, the purchase step\'s planner)')
  else if (ie?.why) notes.push(`plan install exits: ${ie.why}`)
  if (graftOk === false) fail(`PLAN INCONSISTENT: ${graftWhy}`, 'two decisions of the one plan price its committed trajectory differently — they are not reading the same basis (plan.basisOf / trajectoryOf)')
  else if (graftWhy) notes.push(`plan consistency: ${graftWhy}`)
  // GRAFTS DROPPED (graftCarryCheckOf, recorded by the pass as plan.graftCarry).
  const gc = plan.graftCarry ?? null
  if (gc?.ok === false) fail(String(gc.why).startsWith('GRAFTS DROPPED') ? gc.why : `GRAFTS DROPPED: ${gc.why}`, 'the install decision priced a node without the grafts it has committed to — every exit and switch this pass is off another trajectory (progress.js carriedGraftsOf / graftDecisionOf: a refused or unreached graft decision must keep the committed set)')
  else if (gc?.why) notes.push(`plan graft carry: ${gc.why}`)
  // AUG COUNTED TWICE (graftplan.graftBatchCheckOf, recorded as plan.graftBatch).
  const gb = plan.graftBatch ?? null
  if (gb?.ok === false) fail(String(gb.why).startsWith('AUG COUNTED TWICE') ? gb.why : `AUG COUNTED TWICE: ${gb.why}`, 'an augmentation is both bought by the install batch and grafted on the committed trajectory — owned once, priced twice (graftplan.graftsOfLifeNow keeps this life\'s grafts out of the offers; graftsOffBatch keeps the batch out of the later grafts)')
  else if (gb?.why) notes.push(`plan graft/batch: ${gb.why}`)
  // EXIT JUMP AT INSTALL (exitJumpOf, carried through the life by the pass).
  const ej = plan.exitJump ?? null
  // A VOIDED INSTALL (installgate.BLADE_JUMP_VOIDS): its jump measured lost
  // inputs, not the install — a note naming the void, never a failure.
  const ejVoid = ej?.ok === false ? installVoidOf(ej.install?.at) : null
  if (ejVoid) notes.push(`${voidNoteOf(ejVoid)}: ${String(ej.why ?? '').replace(/^EXIT JUMP AT INSTALL:? ?/, 'EXIT JUMP AT INSTALL ')}`)
  else if (ej?.ok === false) fail(String(ej.why).startsWith('EXIT JUMP AT INSTALL') ? ej.why : `EXIT JUMP AT INSTALL: ${ej.why}`, "the install's simulation of the next life and the next life's own pricing disagree about one state — an input is estimated one way before the install and another after it (compare the two exits' inputs group by group: tools/sim/exitjump/attribute.mjs)")
  else if (ej?.why && ej.install) notes.push(`plan exit across the install: ${ej.why}`)
  // EXIT UNSTABLE (exitStabilityOf, against the last pass: recorded by the
  // pass as plan.exitStability) and OPTIONS OFF BASIS (on this record).
  const es = plan.exitStability ?? null
  if (es?.ok === false || es?.lastFail) fail(es.ok === false ? es.why : `${es.lastFail.why} [at ${es.lastFail.at}, within the hour]`, 'the committed exit moved beyond its own Monte Carlo noise on a pass that re-decided nothing — an input or a committed choice changed without being an event (a graft set replaced under a held key, a noisy point input); diff the two passes\' exitinputs field by field')
  else if (es?.why) notes.push(`plan exit stability: ${es.why}`)
  // THE VALUE-OF-COMPUTATION GATE (redecideGateOf) holding the timer's
  // re-decides while the held exit moves beyond its noise: the margins it
  // reads are the deciding pass's, and EXIT UNSTABLE says the pricing under
  // them moved. A note, not a fail — EXIT UNSTABLE fails on its own.
  const rg = plan.redecideGate ?? null
  const skippedH = rg?.skippedSince ? (Date.parse(plan.at) - Date.parse(rg.skippedSince)) / 3.6e6 : null
  if (fin(skippedH) && skippedH > (PLAN.voc?.unstableNoteH ?? 2) && (es?.ok === false || es?.lastFail)) notes.push(`VOC GATE HOLDING THROUGH EXIT UNSTABLE: the scheduled re-decides skipped for ${skippedH.toFixed(1)}h (${rg.skips ?? '?'} passes, since ${rg.skippedSince}) while the held exit moves beyond its noise — the margins the gate reads are the last decision's (${String(rg.why ?? '').slice(0, 160)})`)
  else if (rg?.verdict && rg.verdict !== 'none') notes.push(`plan re-decide gate: ${rg.verdict}${fin(skippedH) ? ` (skipping for ${skippedH.toFixed(1)}h)` : ''} — ${String(rg.why ?? '').slice(0, 200)}`)
  // ADAPTIVE ALLOCATION (ocbaEvaluateGen): the simulations a re-decision saved, and its weakest P(correct selection).
  if (plan.cpu?.alloc?.decisions) notes.push(`plan draws: ${plan.cpu.alloc.why}`)
  const ob = optionsBasisOf(plan)
  if (ob.ok === false) fail(ob.why, "a decision published options priced on another basis than the committed exit they are compared with (a held decision's old options, a graft set the install did not price) — every number in a decision must be one pass's pricing of one trajectory")
  else if (ob.why) notes.push(`plan options basis: ${ob.why}`)
  // LIFE LENGTH OFF BASIS (lifeLengthBasisOf): every decision on the committed L.
  const lb = lifeLengthBasisOf(plan)
  if (lb.ok === false) fail(lb.why, "a decision priced later lives of another length than the plan committed (decisions.lifeLength) — its inputs were built before the life length decision, or from another builder than progress.js exitInputsGen (lifeplan.lifeInputsOf on the committed L)")
  else if (lb.why) notes.push(`plan life length basis: ${lb.why}`)
  const ll0 = plan.decisions?.lifeLength
  if (ll0?.key) notes.push(`plan life length: ${ll0.key}${ll0.held ? ' (held)' : ''} — ${String(ll0.why ?? '').slice(0, 160)}`)
  // INSTALL DEFERRED REPEATEDLY (installDeferralCheckOf, recorded by the pass).
  const idf = plan.installDeferral ?? null
  if (idf?.ok === false) fail(idf.why, "the install decision keeps switching to a later install while the exit slides past every switch's promise — a wait priced on something the committed policy does not do (a hold nobody works, a batch the next pass re-plans away): compare each switch's option with the next pass's committed batch (tools/sim/exitjump/attribute-pair.mjs)")
  else if (idf?.why && idf.n) notes.push(`plan install deferrals: ${idf.why}`)
  const plg = plan.perLifeGain ?? null
  if (plg?.ok === false) fail(plg.why, "the committed trajectory's later lives compound a gain the purchase model cannot buy with a life's money — a lift applied per cycle whatever the life buys (exitplan lifeLift, lifeplan table)")
  else if (plg?.why) notes.push(`plan per-life gain: ${plg.why}`)
  // SWITCH ARTEFACT (switchSanityOf): taken, never blocked — reported here.
  for (const [name, dd] of Object.entries(plan.decisions ?? {})) {
    const ss = dd?.switchSanity
    if (ss?.ok === false) fail(`${String(ss.why).startsWith('SWITCH ARTEFACT') ? ss.why : `SWITCH ARTEFACT: ${ss.why}`} [${name}${dd.held ? ', held since' : ''} ${dd.decidedAt ?? ''}]`, 'a switch gained more than 10x the exit it chose: the incumbent was priced on something the plan does not hold (a dropped input, an unpriceable leg) — the switch was taken; find what the incumbent lost')
  }
  calibrationCheckOf(plan.calibration, fail, notes)
  // THE FINAL INSTALL VERDICT agrees with the plan, or the gate names the
  // rule that overrode it (installgate planOverride). Live 2026-09-26 the plan
  // said "now" while the legacy join-money veto held, with nothing recording
  // which decider won or why.
  if (gate && plan.lastAugReset === gate.lastAugReset && typeof gate.planAgrees === 'boolean') {
    if (gate.planAgrees === false && !gate.planOverride) fail(`PLAN OVERRIDDEN: the plan says ${gate.planDecision?.key ?? '?'} (install ${gate.planDecision?.install}) and the gate ${gate.install ? 'installs' : 'holds'}, naming no rule`, `gate: ${String(gate.why ?? '').slice(0, 200)}`)
    else if (gate.planAgrees === false) notes.push(`plan install overridden by ${gate.planOverride}`)
  }
  if (plan.exit) notes.push(`plan exit: mean ${plan.exit.meanH}h, 80% ${plan.exit.q10}-${plan.exit.q90}h (${plan.exit.source})`)
  const d = plan.decisions ?? {}
  if (d.countRoute?.key) notes.push(`plan route: ${d.countRoute.name} at ${d.countRoute.faction} via ${d.countRoute.via}${d.countRoute.held ? ' (held)' : ''} — ${String(d.countRoute.why ?? '').slice(0, 160)}`)
  if (d.install?.key) notes.push(`plan install: ${d.install.key}${d.install.held ? ' (held)' : ''} — ${String(d.install.why ?? '').slice(0, 160)}`)
  if (cpu) notes.push(fin(cpu.maxBlockMs) ? `plan cpu: ${cpu.cpuMs}ms work over ${cpu.wallMs}ms wall, longest block ${cpu.maxBlockMs}ms (${cpu.yields} yields), ${cpu.draws} draws` : `plan cpu: ${cpu.ms}ms of ${cpu.budgetMs}ms, ${cpu.draws} draws`)
  return { fails, notes }
}

/**
 * THE BATCH ORDERED AGAINST THE BATCH PRICED. The install gate prices
 * "install now" on the plan's whole batch; the purchase step can order less
 * (the raise's reach, a stale price, a refusal) and the install used to run
 * on whatever was ordered. Live BN9 2026-09-30 08:19Z: priced 12 at 19.66h,
 * ordered and installed 8 — the 8 alone price +2.6h, and the next life's exit
 * jumped +33.9h (tools/sim/exitjump/attribute-batch.mjs).
 *
 * `priced`, `bought`: the batches as names (NeuroFlux once per level, the
 * queue included in both). `pricedH`: the gate's exit installing `priced`
 * now; `repricedH`: the same exit on `bought`; `alternatives` [{key, H, why}]:
 * the exits of not installing `bought` now (each wait's own batch, holding
 * for the rest). Installs `bought` only when it is the batch priced, or its
 * re-priced exit is within tolerance of the priced one, or it still beats
 * every alternative; otherwise holds. Returns {ok, same, install, action,
 * pricedN, boughtN, missing, extra, pricedH, repricedH, altKey, altH, tolH, why}.
 */
export const BATCH_TOL = { rel: 0.03, minH: 0.5 }
export function batchDiffOf(priced, bought) {
  const count = (xs) => (xs ?? []).reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map())
  const a = count(priced)
  const b = count(bought)
  const missing = []
  const extra = []
  for (const [n, k] of a) for (let i = 0; i < k - (b.get(n) ?? 0); i++) missing.push(n)
  for (const [n, k] of b) for (let i = 0; i < k - (a.get(n) ?? 0); i++) extra.push(n)
  return { missing, extra, same: !missing.length && !extra.length }
}
export function installBatchVerdictOf({ priced = [], bought = [], pricedH = null, repricedH = null, alternatives = [], tol = BATCH_TOL } = {}) {
  const d = batchDiffOf(priced, bought)
  const base = { pricedN: priced.length, boughtN: bought.length, missing: d.missing, extra: d.extra, pricedH: fin(pricedH) ? +pricedH.toFixed(3) : null }
  const short = (xs) => [...new Map(xs.map((n) => [n, xs.filter((x) => x === n).length])).entries()].map(([n, k]) => (k > 1 ? `${n} x${k}` : n)).join(', ')
  if (d.same) return { ok: true, same: true, install: true, action: 'install', ...base, repricedH: base.pricedH, altKey: null, altH: null, tolH: null, why: `the batch ordered is the batch priced (${bought.length})` }
  const diff = `priced ${priced.length}, ordered ${bought.length}${d.missing.length ? `; not ordered: ${short(d.missing)}` : ''}${d.extra.length ? `; not priced: ${short(d.extra)}` : ''}`
  if (!bought.length) return { ok: true, same: false, install: false, action: 'hold', ...base, repricedH: null, altKey: null, altH: null, tolH: null, why: `nothing ordered (${diff}) — nothing to install` }
  if (!fin(pricedH) || !fin(repricedH)) return { ok: true, same: false, install: false, action: 'hold', ...base, repricedH: fin(repricedH) ? +repricedH.toFixed(3) : null, altKey: null, altH: null, tolH: null, why: `HOLD: the batch ordered is not the batch priced (${diff}) and ${fin(pricedH) ? 'the ordered batch' : 'the priced batch'} could not be priced — not installing on an unpriced batch` }
  const tolH = Math.max(tol.minH, tol.rel * pricedH)
  const alt = (alternatives ?? []).filter((a) => a && fin(a.H)).sort((x, y) => x.H - y.H)[0] ?? null
  const r = (x) => +x.toFixed(3)
  if (repricedH - pricedH <= tolH) return { ok: true, same: false, install: true, action: 'install', ...base, repricedH: r(repricedH), altKey: alt?.key ?? null, altH: alt ? r(alt.H) : null, tolH: r(tolH), why: `install the ordered batch: ${diff}; re-priced ${repricedH.toFixed(2)}h against the ${pricedH.toFixed(2)}h priced (within ${tolH.toFixed(2)}h)` }
  if (alt && repricedH <= alt.H) return { ok: true, same: false, install: true, action: 'install', ...base, repricedH: r(repricedH), altKey: alt.key, altH: r(alt.H), tolH: r(tolH), why: `install the ordered batch: ${diff}; re-priced ${repricedH.toFixed(2)}h (priced ${pricedH.toFixed(2)}h) still beats ${alt.key} ${alt.H.toFixed(2)}h` }
  return { ok: true, same: false, install: false, action: 'hold', ...base, repricedH: r(repricedH), altKey: alt?.key ?? null, altH: alt ? r(alt.H) : null, tolH: r(tolH), why: `HOLD: the batch ordered is not the batch priced (${diff}); re-priced ${repricedH.toFixed(2)}h against the ${pricedH.toFixed(2)}h priced (+${(repricedH - pricedH).toFixed(2)}h, tolerance ${tolH.toFixed(2)}h)${alt ? ` and ${alt.key} prices ${alt.H.toFixed(2)}h` : ', no alternative priced'} — buy the rest or re-plan next pass` }
}

/**
 * INSTALLED A DIFFERENT BATCH (/tel/install-last.txt): the batch the install
 * ran on against the batch its decision priced. An install on a batch that
 * differs passes only with the re-pricing that justified it recorded
 * (`batchCheck` install true, on the bought set). A record from before
 * `pricedBatch` existed is read by the gate's own count ("install: N aug(s)").
 * Returns {ok, why} (ok null: nothing to compare).
 */
export function differentBatchCheckOf(rec) {
  if (!rec?.at || !Array.isArray(rec.batch)) return { ok: null, why: 'no install batch recorded' }
  const installed = rec.batch
  const priced = Array.isArray(rec.pricedBatch) ? rec.pricedBatch : null
  // String.match, not RegExp.exec: a bare `exec` is billed as ns.exec (1.3GB).
  const m = priced ? null : String(rec.why ?? '').match(/install: (\d+) aug\(s\)/)
  const pricedN = priced ? priced.length : m ? +m[1] : null
  if (pricedN === null) return { ok: null, why: `the install (${rec.at}) recorded no priced batch` }
  const d = priced ? batchDiffOf(priced, installed) : { same: pricedN === installed.length, missing: [], extra: [] }
  if (d.same) return { ok: true, why: `the install (${rec.at}) ran on the batch it priced (${installed.length})` }
  const bc = rec.batchCheck ?? null
  if (bc?.install === true && bc.same === false && fin(bc.repricedH)) return { ok: true, why: `the install (${rec.at}) ran on ${installed.length} of the ${pricedN} priced, re-priced on the bought set: ${bc.why}` }
  const names = d.missing.length ? `; not bought: ${d.missing.join(', ')}` : ''
  return { ok: false, why: `INSTALLED A DIFFERENT BATCH (${rec.at}): the decision priced ${pricedN} augmentation(s) and the install ran on ${installed.length}${names} — never re-priced on the batch bought (${bc ? bc.why : 'no batch check recorded'})` }
}

/**
 * THE LAST INSTALL'S EXITS (/tel/install-last.txt, written by act.js from the
 * install order before the install runs). After an install plan.txt belongs
 * to the next life, so this record is where the comparison survives: the
 * order carries installExitsOf's verdict on the pass that ordered it. A
 * failed one stays a failure for `holdH` hours after the install (the
 * healthcheck's F section reads it every run). Returns {fails, notes}.
 */
export function installRecordCheck(rec, { now = Date.now(), holdH = 12, jump = null, plan = null } = {}) {
  const fails = []
  const notes = []
  if (!rec || !rec.at) return { fails, notes }
  const ageH = (now - Date.parse(rec.at)) / 3.6e6
  if (!(ageH >= 0 && ageH <= holdH)) return { fails, notes }
  // EXIT JUMP AT INSTALL, after the fact (/tel/exitjump.txt, the record the
  // next life's passes kept): it outlives plan.txt's copy, which the life
  // after replaces. Reported here only when plan.txt no longer carries it.
  // A VOIDED INSTALL (installgate.BLADE_JUMP_VOIDS): both comparisons
  // measured its lost inputs — notes naming the void, never failures.
  const voided = installVoidOf(rec.at)
  if (jump?.install?.at === rec.at && plan?.exitJump?.install?.at !== rec.at) {
    if (jump.ok === false && voided) notes.push(`${voidNoteOf(voided)}: ${String(jump.why ?? '').replace(/^EXIT JUMP AT INSTALL:? ?/, 'EXIT JUMP AT INSTALL ')}`)
    else if (jump.ok === false) fails.push({ what: String(jump.why).startsWith('EXIT JUMP AT INSTALL') ? jump.why : `EXIT JUMP AT INSTALL: ${jump.why}`, detail: 'the install priced the next life on one model and the life priced itself on another — plan.exitJumpOf, /tel/exitjump.txt' })
    else if (jump.why) notes.push(`last install's exit across the install: ${jump.why}`)
  }
  const db = differentBatchCheckOf(rec)
  if (db.ok === false) fails.push({ what: db.why, detail: 'the install ran on a batch its decision never priced — the purchase step ordered less than the plan (raise reach, a stale price, a refusal) and nothing re-priced it (plan.installBatchVerdictOf; progress.js holds or re-prices, act.js refuses a count that differs from the order)' })
  else if (db.ok === true) notes.push(`last install's batch: ${db.why}`)
  const ex = rec.exits ?? null
  if (!ex) {
    notes.push(`last install (${ageH.toFixed(1)}h ago) recorded no exit comparison${rec.terminal ? ' (terminal install)' : ''}`)
    return { fails, notes }
  }
  if (ex.ok === false && voided) notes.push(`${voidNoteOf(voided)}: TWO EXITS AT INSTALL (${rec.at}): ${String(ex.why ?? '').replace(/^TWO EXITS AT INSTALL: /, '')}`)
  else if (ex.ok === false) fails.push({ what: `TWO EXITS AT INSTALL (${rec.at}): ${String(ex.why ?? '').replace(/^TWO EXITS AT INSTALL: /, '')}`, detail: `the install ran on one exit while the plan had committed another for the same act — act.js /tel/install-last.txt; plan.installExitsOf` })
  else notes.push(`last install (${ageH.toFixed(1)}h ago): ${ex.why ?? 'exits not compared'}`)
  return { fails, notes }
}

/**
 * THE MODEL VERSION: a hash of every module in `root`'s import graph
 * (following `from '<x>.js'`), read through `readFn(file) -> source`. Nothing
 * to bump by hand, so nothing to forget: a change to any module the planner
 * imports — or a new module it starts importing — is a new version. An
 * unreadable file hashes as 'unreadable' (a fixed marker, never silence).
 * Returns '<hash>.<modules>'.
 */
export function modelVersionFrom(readFn, root = 'progress.js') {
  const seen = new Set()
  const parts = []
  const visit = (file) => {
    if (seen.has(file)) return
    // A graph is finite; a cap still names a runaway (a reader that invents paths).
    if (seen.size >= 500) throw new Error(`modelVersionFrom: more than 500 modules under ${root}`)
    seen.add(file)
    const src = String(readFn(file) ?? '')
    parts.push(`${file}:${src.length ? hashOf(src) : 'unreadable'}`)
    for (const m of src.matchAll(/from\s+'([^']+\.js)'/g)) visit(m[1].replace(/^\//, ''))
  }
  visit(root)
  return `${hashOf(parts.sort().join('|')).toString(36)}.${parts.length}`
}

/** A per-life seed: the same draws for every pass of one life (CRN across passes). */
export const seedOf = (lastAugReset, node) => hashOf(`${node ?? ''}:${lastAugReset ?? 0}`)

/**
 * THE BLADEBURNER ROUTE (decisions.bladeRoute): exit by the 21 black ops
 * against the exit the plan already prices, on the same draws, by the plan's
 * commitment rule (decide: switch only when P(win) >= theta).
 *
 *   'hack'   `traj` (the committed trajectory) on each draw of `base` — the
 *            work slot on faction work and grafts, the World Daemon exit.
 *   'blade'  bbplan.bladeExitGen from bladeStartAt(cycleHours): the work slot
 *            on Bladeburner, an install (combat exp to 0, the retrain) at the
 *            draw's cadence. One simulation per cadence step of e^0.25 around
 *            the point's (memo) — nothing else of the route is drawn yet, and its
 *            structural noise is the hacking simulator's (discrepancyOf on its
 *            own key 'bladeburner').
 *
 * Not simulated, named: the hacking exit still progressing on the blade route
 * (only the slot moved) — the blade arm is the black-op exit alone, so the
 * comparison leans to 'hack'. The blade model is NOT CALIBRATED live; against
 * the game's own classes it is within -2..+15% (tools/sim/bb6.mjs).
 *
 * Returns the decideAmong record plus { hackH, bladeH } (the points).
 */
export function* decideBladeRouteGen({ base, traj, trajGen = null, basis = null, bladeStartAt, bladeStart = null, bladeNoiseKey = 'bladeburner', prev = null, draws, redecide = true, budgetMs = PLAN.budgetMs, clock: budgetClock = clock, post = true, now = Date.now() } = {}) {
  // The cadence in steps of e^0.25 (28%) around the point's: the drawn
  // cadences collapse to a handful of simulations (~50-100ms each), however
  // wide the cadence posterior is.
  // `bladeStart` (the committed Bladeburner install plan, progress.js
  // bladeRouteOf): ONE start, no cadence — the installs on this route are
  // the install decision's (priced on this same trajectory), not the hacking
  // route's cadence; the arm is then one simulation.
  // THE MEMBERS (bbplan.bladeMemberOf, BLADE_ENSEMBLE): draw i prices member
  // i mod Q (the skill clock's phase and the calibrations' posterior
  // quantiles), and the point is the members' mean — the model is rough in
  // those inputs, so a single member's exit moved hours with every pass.
  const Q = BLADE_ENSEMBLE.Q
  const memo = new Map()
  const c0 = fin(base?.cycleHours) && base.cycleHours > 0 ? base.cycleHours : null
  function* bladeH(cyc, m) {
    const k = bladeStart ? 0 : c0 && fin(cyc) && cyc > 0 ? Math.round(Math.log(cyc / c0) / 0.25) : 0
    const key = `${k}|${m}`
    if (!memo.has(key)) memo.set(key, (yield* bladeExitGen(bladeMemberOf(bladeStart ?? bladeStartAt(c0 ? c0 * Math.exp(0.25 * k) : 0), m, Q))).hours)
    return memo.get(key)
  }
  // THE HACKING ARM SLICED (`trajGen`, trajectoryGenOf on the same basis):
  // through the synchronous `traj` its point and every draw were a whole
  // policy search in one step — on the Bladeburner route the default policy
  // (hackBasisOf null), the same piece that blocked 'plan-lifeLength' live
  // BN14 2026-10-04. The same numbers.
  const hackGen = typeof trajGen === 'function' ? trajGen : function* (x, d = null) {
    return traj(x, d)
  }
  let pointHack = null
  try {
    pointHack = yield* hackGen(base)
  } catch {
    pointHack = null
  }
  yield
  const ens = yield* bladeExitMeanGen(null, { Q, hoursOfMember: (m) => bladeH(base?.cycleHours, m) })
  const pointBlade = ens.hours
  const memberOf = (d) => bladeMemberOfDraw(d, Q) ?? 0
  const options = [
    { key: 'hack', noiseKey: noiseKeyOf(basis, base), sim: (d) => traj(applyDraw(base, d), d), simGen: (d) => hackGen(applyDraw(base, d), d) },
    { key: 'blade', noiseKey: bladeNoiseKey, sim: (d) => drain(bladeH(applyDraw(base, d)?.cycleHours, memberOf(d))), simGen: (d) => bladeH(applyDraw(base, d)?.cycleHours, memberOf(d)) },
  ]
  const was = prev?.key === 'hack' || prev?.key === 'blade' ? prev : null
  const d = post
    ? yield* decideAmongGen({ options, prev: was, draws, redecide: redecide || !was, budgetMs, clock: budgetClock, now, pointOf: (k) => (k === 'hack' ? pointHack : pointBlade) })
    : { key: fin(pointBlade) && (!fin(pointHack) || pointBlade < pointHack) ? 'blade' : fin(pointHack) ? 'hack' : null, why: 'no posterior: the point comparison' }
  return { ...d, hackH: fin(pointHack) ? +pointHack.toFixed(3) : null, bladeH: fin(pointBlade) ? +pointBlade.toFixed(3) : null, bladeMembers: { Q, hours: ens.members.map((h) => (fin(h) ? +h.toFixed(3) : null)), sdH: fin(ens.sdH) ? +ens.sdH.toFixed(3) : null }, bladeSims: memo.size }
}
