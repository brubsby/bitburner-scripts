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
// already in the state), and an alternative pays its switch cost. Switch only
// when the expected gain net of that cost is positive AND the probability that
// the alternative is better net of it is at least THETA — an expected-regret
// rule whose scale comes from the posterior, not a hand-set hour tolerance.

import { rngOf, hashOf, normalOf, gammaOf, igDraw, nigDraw, PRIORS, traderPosterior, driftPosterior, driftCalibration, logRatePosterior, jitterPosterior } from 'bayes.js'
import { routeExitFixed, countExitFixed } from 'countexit.js'
import { drain } from 'coop.js'
import { bestExitPolicy, bestExitPolicyGen } from 'exitplan.js'
import { realisedCapital } from 'nodeecon.js'

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
export function posteriorsOf({ stockRows = null, warmupH = 0, exitSamples = null, obs = {}, optionPoints = null, income = null, cadence = null, expPost = null, traderBelief = null } = {}) {
  const jitter = jitterPosterior(optionPoints ?? [])
  // THE TRADER'S RETURN: the belief the exit inputs' point was taken from
  // (traderBeliefOf), so the point and the draws are one distribution; the
  // rows path is kept for callers that have no belief.
  const trader = traderBelief ? traderBelief.post ?? null : stockRows ? traderPosterior(stockRows, { warmupH }) : null
  const drift = driftPosterior(exitSamples ?? [])
  const calibration = driftCalibration(exitSamples ?? [])
  const exp = logRatePosterior(obs?.exp)
  const rep = logRatePosterior(obs?.rep)
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
 * stands in only where no run has a posterior. Returns {r, sd, warmupH, post,
 * fit, source, why} or null (no trader history).
 */
export function traderBeliefOf(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  let fit = null
  try {
    fit = realisedCapital(rows)
  } catch {
    fit = null
  }
  const warmupH = fin(fit?.warmupH) ? fit.warmupH : 0
  const post = traderPosterior(rows, { warmupH })
  if (post && fin(post.perSec?.mean) && post.perSec.mean > 0) {
    return { r: post.perSec.mean, sd: post.perSec.sd, warmupH, post, fit, source: 'posterior', why: `trader posterior (the draws' own distribution, its mean the point): ${(post.perHour.mean * 100).toFixed(1)}%/h +- ${(post.perHour.sd * 100).toFixed(1)} — ${post.why}${fit ? `; warm-up ${warmupH.toFixed(3)}h from the realised fit (${(fit.r * 360000).toFixed(1)}%/h on the young runs alone, not the point)` : ''}` }
  }
  if (fit && fin(fit.r) && fit.r > 0) return { r: fit.r, sd: null, warmupH, post: null, fit, source: 'fit', why: `no trader posterior (too few flow-free intervals): the realised fit — ${fit.why}` }
  return null
}

// A held decision's reason: the decision's own, once — not re-prefixed every
// pass it is held ("held (no event): held (no event): ... stays on").
const heldWhy = (prev) => String(prev?.why ?? '').replace(/^(held \(no event\): )+/, '')

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
    const ln = cad && fin(cad.rate?.mean) && fin(cad.rate?.sd) ? Math.exp(cad.rate.mean + cad.rate.sd * normalOf(st('cadenceRate'))) : null
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
    const repResid = Math.exp(PRIORS.repEstimateSdLn * normalOf(st('repEstimate')))
    const incomeLn = post.income && fin(post.income.mean) && fin(post.income.sd) ? post.income.mean + post.income.sd * normalOf(st('income')) : null
    const r = post.trader ? Math.max(1e-9, post.trader.perSec.mean + post.trader.perSec.sd * zT) : null
    out.push({ i, seed, r, s2, si2, incomeLn, repResid, zc, lnPerHour: ln, cycleH, cadOwnW: fin(cad?.own?.weight) ? cad.own.weight : null, expMult: Math.exp(e), repRate: repLn === null ? null : Math.exp(repLn), gymMult: Math.exp(gym) })
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
  if (inputs.cadenceFrom === 'purchase model') {
    // The life's length is the purchase model's DECISION (lifeplan), not a
    // random input: kept. What a life of that length buys is this draw's
    // rate from the cadence posterior whose PRIOR is the purchase model
    // (bayes.cadencePosterior modelPrior, its stated structural error) and
    // whose evidence is this node's own gaining lives — the measured cadence
    // moves the model by its precision, it no longer scales the model's gain
    // by a power of its own weight.
    if (fin(d.lnPerHour) && d.lnPerHour > 0 && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.multGainPerCycle = Math.exp(d.lnPerHour * inputs.cycleHours)
  } else {
    if (fin(d.cycleH) && d.cycleH > 0 && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.cycleHours = d.cycleH
    if (fin(d.lnPerHour) && d.lnPerHour > 0 && fin(o.cycleHours) && o.cycleHours > 0) o.multGainPerCycle = Math.exp(d.lnPerHour * o.cycleHours)
  }
  if (fin(inputs.expPerSec)) o.expPerSec = inputs.expPerSec * d.expMult
  if (fin(inputs.repPerSec) && fin(d.repRate)) o.repPerSec = d.repRate
  // The hacking stream is a draw from its posterior (earlier lives, updated
  // by this life's measurement); the flat part measured beside it is kept.
  if (inputs.incomeFromPrior === true && fin(d.incomeLn)) o.incomePerSec = (fin(inputs.incomeFlatPerSec) && inputs.incomeFlatPerSec > 0 ? inputs.incomeFlatPerSec : 0) + Math.exp(d.incomeLn)
  if (inputs.repFromEstimate === true && fin(inputs.repPerSec) && fin(d.repResid)) o.repPerSec = inputs.repPerSec * d.repResid
  return o
}

/**
 * A route's detour under one draw: join legs x the gym residual, and the
 * grind rescaled from the rate it was priced at (`repPoint`) to the drawn one.
 */
export function detourOf(route, d, repPoint = null) {
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
 * Evaluate every option on every draw, DRAW-MAJOR so a budget stop leaves all
 * options at the same N (still paired). options [{key, sim: (d) => hours|null}].
 * Returns {samples: {key: (number|null)[]}, n, ms, overBudget, raw}.
 */
export function evaluate(options, draws, opts = {}) {
  return drain(evaluateGen(options, draws, opts))
}
/**
 * The generator evaluate drains: yields after every simulation, so the
 * caller can run it in slices (coop.js). `now` is the budget's clock — the
 * pacer's WORK clock in progress.js, so a pause never truncates the draws.
 */
export function* evaluateGen(options, draws, { budgetMs = PLAN.budgetMs, now = clock } = {}) {
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
    for (const o of options) {
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
    n++
  }
  return { samples, raw, n, ms: +(now() - t0).toFixed(1), overBudget }
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
 */
export function summarize(samples) {
  const keys = Object.keys(samples)
  const N = Math.max(0, ...keys.map((k) => samples[k].length))
  const filled = {}
  const out = {}
  for (const k of keys) {
    const xs = samples[k]
    const ok = xs.filter(fin)
    const pFeasible = N ? ok.length / N : 0
    const worst = ok.length ? Math.max(...ok) : null
    filled[k] = pFeasible >= 0.5 ? xs.map((x) => (fin(x) ? x : 1.5 * worst)) : null
    const s = filled[k] ? [...filled[k]].sort((a, b) => a - b) : []
    out[k] = { pFeasible: +pFeasible.toFixed(3), meanH: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3) : null, q10: fin(quant(s, 0.1)) ? +quant(s, 0.1).toFixed(3) : null, q50: fin(quant(s, 0.5)) ? +quant(s, 0.5).toFixed(3) : null, q90: fin(quant(s, 0.9)) ? +quant(s, 0.9).toFixed(3) : null, pBest: 0 }
  }
  for (let d = 0; d < N; d++) {
    let best = null
    for (const k of keys) if (filled[k] && (best === null || filled[k][d] < filled[best][d])) best = k
    if (best !== null) out[best].pBest += 1 / N
  }
  for (const k of keys) out[k].pBest = +out[k].pBest.toFixed(3)
  return { stats: out, filled, N }
}

/**
 * THE COMMITMENT RULE. `committed` = the key of the option the plan holds (or
 * null); switchCost {key: hours} = what moving TO that option costs beyond
 * its own simulated path. Returns {choice, switched, stays, why, gainH, pWin,
 * regretH, stats}.
 */
export function decide({ samples, committed = null, switchCost = {}, theta = PLAN.theta, committedPrevH = null } = {}) {
  const { stats, filled, N } = summarize(samples)
  const feasible = Object.keys(stats).filter((k) => filled[k])
  if (!feasible.length || !N) return { choice: null, switched: false, stays: false, why: 'no option is feasible in half the draws', stats }
  const argmin = feasible.reduce((a, k) => (stats[k].meanH < stats[a].meanH ? k : a), feasible[0])
  if (committed === null || !filled[committed]) {
    const why = committed === null ? `no committed option: the least expected exit (${stats[argmin].meanH}h, P(best) ${stats[argmin].pBest})` : `the committed option ${committed} is no longer feasible (${stats[committed]?.pFeasible ?? 0} of draws): the least expected exit, ${argmin}`
    // An incumbent priced finite last pass and unpriceable now is the same
    // artefact as a 10x gain (an input it needs went missing): flagged.
    const sanity = committed !== null && fin(committedPrevH) ? switchSanityOf({ from: committed, to: argmin, gainH: Infinity, exitH: stats[argmin].meanH, fromH: null, prevH: committedPrevH }) : null
    return { choice: argmin, switched: committed !== null, stays: false, why: sanity ? `${sanity.why} — ${why}` : why, ...(sanity ? { switchSanity: sanity } : {}), stats }
  }
  const c = filled[committed]
  let best = null
  let regret = 0
  for (const k of feasible) {
    if (k === committed) continue
    const cost = fin(switchCost[k]) ? switchCost[k] : PLAN.switchCostH
    const D = c.map((hc, d) => hc - (filled[k][d] + cost))
    const gain = D.reduce((a, b) => a + b, 0) / N
    const pWin = D.filter((x) => x > 0).length / N
    regret = Math.max(regret, D.reduce((a, b) => a + Math.max(0, b), 0) / N)
    if (!best || gain > best.gain) best = { key: k, gain, pWin, cost }
  }
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
  if (prev.invitesKey !== undefined && cur.invitesKey !== undefined && prev.invitesKey !== cur.invitesKey) ev.push('the invitation/joined set changed')
  const pt = prev.posteriors?.trader
  if (pt && cur.trader && Math.abs(cur.trader.perSec.mean - pt.mean) > P.traderMoveSd * Math.max(pt.sd, 1e-12)) ev.push(`trader posterior moved ${((cur.trader.perSec.mean - pt.mean) / pt.sd).toFixed(1)} sd`)
  if (!pt !== !cur.trader) ev.push('trader posterior appeared/vanished')
  const sPrev = prev.posteriors?.s
  if (fin(sPrev) && cur.drift && (cur.drift.s / sPrev > P.driftMoveFactor || sPrev / cur.drift.s > P.driftMoveFactor)) ev.push(`structural error moved ${(100 * sPrev).toFixed(0)}% -> ${(100 * cur.drift.s).toFixed(0)}%`)
  return ev
}

/** The posterior summary a plan record carries (and redecideEvents compares). */
export function posteriorSummary(post) {
  return {
    trader: post.trader ? { mean: post.trader.perSec.mean, sd: post.trader.perSec.sd, perHour: +post.trader.perHour.mean.toFixed(4), lives: post.trader.lives, why: post.trader.why } : null,
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
export const routeKey = (r) => `${r?.name ?? ''}|${r?.faction ?? ''}|${r?.via ?? ''}`

function optionRows(options, stats, pointOf) {
  return options.map((o) => ({ key: o.key, pointH: r3(pointOf(o)), ...stats[o.key] })).sort((a, b) => (a.meanH ?? Infinity) - (b.meanH ?? Infinity))
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
export function* decideRouteGen({ inputs, count, routes, point, repPoint = null, prev = null, draws, redecide = true, budgetMs = PLAN.budgetMs, topK = PLAN.topK, theta = PLAN.theta, now = Date.now(), clock: budgetClock = clock } = {}) {
  const byKey = new Map((routes ?? []).map((r) => [routeKey(r), r]))
  const lifeOf = new Map((point?.tried ?? []).map((t) => [routeKey(t), t.lifeH ?? null]))
  const pointH = new Map((point?.tried ?? []).map((t) => [routeKey(t), t.hours]))
  const committedKey = prev?.key && byKey.has(prev.key) ? prev.key : null
  const sim = (route) => (d) => routeExitFixed(bestExitPolicy, applyDraw(inputs, d), count, route, { lifeH: lifeOf.get(routeKey(route)) ?? null, detourH: detourOf(route, d, repPoint) })
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
  const options = keys.map((k) => ({ key: k, sim: sim(byKey.get(k)) }))
  const ev = yield* evaluateGen(options, draws, { budgetMs, now: budgetClock })
  const { stats } = summarize(ev.samples)
  const rows = optionRows(options, stats, (o) => pointH.get(o.key))
  const cpu = { n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
  if (!redecide && committedKey) {
    return { ...pick(byKey.get(committedKey)), key: committedKey, ...stats[committedKey], held: true, why: `held (no event): ${heldWhy(prev)}`.slice(0, 400), decidedAt: prev.decidedAt, options: prev.options ?? rows, ...heldSanity(prev), ...cpu }
  }
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta, committedPrevH: fin(prev?.meanH) ? prev.meanH : null })
  if (d.choice === null) return { key: null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
  return { ...pick(byKey.get(d.choice)), key: d.choice, ...stats[d.choice], held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, why: d.why, ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
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
export function* decideInstallGen({ inputs, count = null, point, repPoint = null, prev = null, draws, redecide = true, budgetMs = PLAN.budgetMs, theta = PLAN.theta, now = Date.now(), sameLife = true, clock: budgetClock = clock } = {}) {
  const opts = []
  const ctx = { count, repPoint }
  // Every option is a TRAJECTORY SPEC (trajectoryOf): the same spec prices the
  // same trajectory wherever it is used — here, and as the basis of every
  // other decision this plan makes (the graft decision prices on the
  // committed install's spec).
  const add = (key, spec, pointH, extra = {}) => {
    const f = trajectoryOf(spec, ctx)
    const fg = trajectoryGenOf(spec, ctx)
    opts.push({ key, spec, pointH, noiseKey: noiseKeyOf(spec, inputs), sim: (d) => f(applyDraw(inputs, d), d), simGen: (d) => fg(applyDraw(inputs, d), d), ...extra })
  }
  const P0 = point ?? {}
  if (P0.now && fin(P0.now.hours)) add('now', { kind: 'wait', installAt: now, waitH: 0, n: P0.now.n ?? null, lifeH: P0.now.lifeH ?? null, gains: null }, P0.now.hours)
  for (const w of P0.waits ?? []) {
    if (!(fin(w?.waitH) && w.waitH > 0 && fin(w.hours))) continue
    if (w.route && count) {
      // INSTALL ONCE THE ROUTE'S DETOUR IS DONE (+ extra): the wait is the
      // drawn detour, so the route's own uncertainty rides this option.
      const extra = fin(w.extra) ? w.extra : 0
      add(`r${extra}`, { kind: 'route', route: w.route, routeKey: routeKey(w.route), extra, lifeH: w.lifeH ?? null }, w.hours, { routeKey: routeKey(w.route), extra })
      continue
    }
    add(`w${w.waitH}`, { kind: 'wait', installAt: now + w.waitH * 3.6e6, waitH: w.waitH, n: w.n ?? null, lifeH: w.lifeH ?? null, gains: w.installGains ?? null }, w.hours)
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
        let pointH = null
        try {
          pointH = trajectoryOf(specNow, ctx)(inputs)
        } catch {
          pointH = null
        }
        add('committed', specNow, fin(pointH) ? pointH : null)
        committedKey = 'committed'
      }
    }
  }
  if (!opts.length) return { key: null, install: false, why: 'no install option priced', decidedAt: prev?.decidedAt ?? null }
  const use = !redecide && committedKey ? opts.filter((o) => o.key === committedKey) : opts
  const ev = yield* evaluateGen(use, draws, { budgetMs, now: budgetClock })
  const { stats } = summarize(ev.samples)
  const rows = optionRows(use, stats, (o) => o.pointH)
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
    const commitment = carried ? pc : { key: outKey, meanH: stats[key]?.meanH ?? null, pointH: r3(o.pointH), q10: stats[key]?.q10 ?? null, q90: stats[key]?.q90 ?? null, at: new Date(now).toISOString(), installAt, noiseKey: o.noiseKey, n: ev.n }
    return { key: outKey, install: key === 'now', installAt, waitH: r3(waitH), routeKey: o.routeKey ?? null, extra: o.extra ?? null, fixed: { n: sp.n ?? null, lifeH: sp.lifeH ?? null }, gains: sp.gains ?? null, gainsKey: gainsKeyOf(sp.gains), samples: samplesOf(ev.samples[key]), ...(key === 'now' && !sp.gains && count === null ? { batchGains: inputs?.installGains ?? null } : {}), spec: specOut, noiseKey: o.noiseKey, ...stats[key], pointH: r3(o.pointH), commitment, ...(key === 'now' && elapsed ? { elapsedFrom: prev?.key ?? null } : {}), ...extra, n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
  }
  if (!redecide && committedKey) return record(committedKey, { held: true, why: `held (no event): ${heldWhy(prev)}`.slice(0, 400), decidedAt: prev.decidedAt, options: prev.options ?? rows, ...heldSanity(prev) })
  // The incumbent's last price: its commitment (refreshed every held pass), else its record's mean.
  const prevH = committedKey ? (fin(prev?.commitment?.meanH) ? prev.commitment.meanH : fin(prev?.meanH) ? prev.meanH : null) : null
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta, committedPrevH: prevH })
  if (d.choice === null) return { key: null, install: false, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
  return record(d.choice, { held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, why: d.why, ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows })
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
export function trajectoryOf(spec, { count = null, repPoint = null } = {}) {
  if (!spec) return (x) => bestExitPolicy(x).best?.hours ?? null
  if (spec.kind === 'never') return (x) => bestExitPolicy(x, 0, 0).best?.hours ?? null
  if (spec.kind === 'route') {
    return (x, d = null) => {
      const det = d ? detourOf(spec.route, d, repPoint) : spec.route?.detourH
      return count ? routeExitFixed(bestExitPolicy, x, count, spec.route, { firstInstallH: det + (spec.extra ?? 0), lifeH: spec.lifeH ?? null, detourH: det }) : null
    }
  }
  const w = fin(spec.waitH) ? Math.max(0, spec.waitH) : 0
  const g = spec.gains ?? null
  if (count) return (x) => countExitFixed(bestExitPolicy, x, count, { firstInstallH: w, n: spec.n ?? 1, lifeH: spec.lifeH ?? null })
  return (x) => {
    const r = bestExitPolicy({ ...x, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1)
    return r.degenerate ? null : r.best?.hours ?? null
  }
}

/**
 * trajectoryOf as a GENERATOR per simulation: (inputs, d?) => a generator
 * returning the same hours, yielding after each policy the no-count wait and
 * never trajectories price (exitplan.bestExitPolicyGen). The count and route
 * trajectories run in one step (countexit prices through the sync policy).
 */
export function trajectoryGenOf(spec, ctx = {}) {
  const { count = null } = ctx
  if (spec && !count && (spec.kind === 'never' || spec.kind === 'wait')) {
    if (spec.kind === 'never') {
      return function* (x) {
        return (yield* bestExitPolicyGen(x, 0, 0)).best?.hours ?? null
      }
    }
    const w = fin(spec.waitH) ? Math.max(0, spec.waitH) : 0
    const g = spec.gains ?? null
    return function* (x) {
      const r = yield* bestExitPolicyGen({ ...x, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1)
      return r.degenerate ? null : r.best?.hours ?? null
    }
  }
  const f = trajectoryOf(spec, ctx)
  // eslint-disable-next-line require-yield
  return function* (x, d = null) {
    return f(x, d)
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

/**
 * The structural-noise key of a trajectory: the install point (to the
 * minute) or 'never' or the route, and whether the inputs carry committed
 * grafts. Equal trajectories share noise draws, whichever decision prices them.
 */
export function noiseKeyOf(spec, inputs) {
  const g = Array.isArray(inputs?.finalGrafts) && inputs.finalGrafts.length ? `g${inputs.finalGrafts.length}` : 'g0'
  if (!spec) return `default|${g}`
  if (spec.kind === 'never') return `never|${g}`
  if (spec.kind === 'route') return `route:${spec.routeKey ?? routeKey(spec.route)}|${spec.extra ?? 0}|${g}`
  return `at:${Math.round((spec.installAt ?? 0) / 60e3)}|${g}`
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
  return { kind: 'wait', installAt: rec.installAt, waitH: Math.max(0, (rec.installAt - now) / 3.6e6), n: rec.fixed?.n ?? sp?.n ?? null, lifeH: rec.fixed?.lifeH ?? sp?.lifeH ?? null, gains: rec.gains ?? sp?.gains ?? null }
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
  const { finalGrafts, graftStartMoney, ...rest } = inputs
  void finalGrafts
  void graftStartMoney
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
export function installExitsOf(install, { actorH = null, now = Date.now(), si = 0.02 } = {}) {
  if (!install?.key || !fin(install.meanH)) return { ok: null, why: 'no install decision this pass' }
  if (install.key !== 'now') return { ok: null, why: `the plan installs at ${install.key}, not now: no install exit to compare` }
  const N = Math.max(1, install.n ?? 1)
  const tolOf = (h) => Math.max(INSTALL_EXIT_TOL.rel * h, (4 * Math.SQRT2 * si * h) / Math.sqrt(N))
  const checks = []
  const c = install.commitment ?? null
  const agedH = c?.at && fin(Date.parse(c.at)) ? Math.max(0, (now - Date.parse(c.at)) / 3.6e6) : 0
  const own = c && c.key !== 'now' ? c : null
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
  if (!checks.length) return { ok: null, why: 'installing now: no commitment and no install-actor exit to compare' }
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
export function exitJumpOf(rec, exit, { lastAugReset = null, now = Date.now(), prev = null, si = 0.02 } = {}) {
  const carry = (why) => (prev && prev.install ? prev : { ok: null, why })
  if (!rec?.at || !fin(lastAugReset)) return carry('no install record, or no life stamp')
  const installAt = Date.parse(rec.at)
  // The install that began THIS life: act.js records it moments before the
  // install runs; the new life's lastAugReset is the install itself.
  if (!fin(installAt) || rec.lastAugReset === lastAugReset || Math.abs(installAt - lastAugReset) > EXIT_JUMP.matchMin * 60e3) return { ok: null, why: 'the last install record is not the install that began this life' }
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
export function* decideAmongGen({ options, prev = null, draws, redecide = true, budgetMs = PLAN.budgetMs, theta = PLAN.theta, now = Date.now(), pointOf = () => null, clock: budgetClock = clock } = {}) {
  const keys = new Set((options ?? []).map((o) => o.key))
  const committedKey = prev?.key && keys.has(prev.key) ? prev.key : null
  const use = !redecide && committedKey ? options.filter((o) => o.key === committedKey) : options
  if (!use?.length) return { key: null, why: 'no option', decidedAt: prev?.decidedAt ?? null }
  const ev = yield* evaluateGen(use, draws, { budgetMs, now: budgetClock })
  const { stats } = summarize(ev.samples)
  const rows = optionRows(use, stats, (o) => pointOf(o.key))
  const cpu = { n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
  if (!redecide && committedKey) return { key: committedKey, ...stats[committedKey], samples: samplesOf(ev.samples[committedKey]), held: true, why: `held (no event): ${heldWhy(prev)}`.slice(0, 400), decidedAt: prev.decidedAt, options: prev.options ?? rows, ...heldSanity(prev), ...cpu }
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta, committedPrevH: committedKey && fin(prev?.meanH) ? prev.meanH : null })
  if (d.choice === null) return { key: null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
  return { key: d.choice, ...stats[d.choice], samples: samplesOf(ev.samples[d.choice]), held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, why: d.why, ...(d.switchSanity ? { switchSanity: d.switchSanity } : {}), decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
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
  const carried = names(installInputs.finalGrafts)
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
export function planCheck(plan, { gate = null, progress = null, now = Date.now() } = {}) {
  const fails = []
  const notes = []
  const fail = (what, detail) => fails.push({ what, detail })
  const plannerRuns = progress && fin(Date.parse(progress.at)) && (now - Date.parse(progress.at)) / 60e3 < PLAN_CAL.staleMin
  if (!plan) {
    if (plannerRuns) fail('PLAN MISSING: /tel/plan.txt absent while progress.js runs', 'the deciders have no committed plan to read — every choice is back to a per-pass argmin')
    return { fails, notes }
  }
  const age = (now - Date.parse(plan.at)) / 60e3
  if (!(age < PLAN_CAL.staleMin)) fail(`PLAN STALE: /tel/plan.txt is ${fin(age) ? age.toFixed(0) : '?'} min old`, 'progress.js has not reached a decision pass since — find where the pass returns early')
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
  // EXIT JUMP AT INSTALL (exitJumpOf, carried through the life by the pass).
  const ej = plan.exitJump ?? null
  if (ej?.ok === false) fail(String(ej.why).startsWith('EXIT JUMP AT INSTALL') ? ej.why : `EXIT JUMP AT INSTALL: ${ej.why}`, "the install's simulation of the next life and the next life's own pricing disagree about one state — an input is estimated one way before the install and another after it (compare the two exits' inputs group by group: tools/sim/exitjump/attribute.mjs)")
  else if (ej?.why && ej.install) notes.push(`plan exit across the install: ${ej.why}`)
  // SWITCH ARTEFACT (switchSanityOf): taken, never blocked — reported here.
  for (const [name, dd] of Object.entries(plan.decisions ?? {})) {
    const ss = dd?.switchSanity
    if (ss?.ok === false) fail(`${String(ss.why).startsWith('SWITCH ARTEFACT') ? ss.why : `SWITCH ARTEFACT: ${ss.why}`} [${name}${dd.held ? ', held since' : ''} ${dd.decidedAt ?? ''}]`, 'a switch gained more than 10x the exit it chose: the incumbent was priced on something the plan does not hold (a dropped input, an unpriceable leg) — the switch was taken; find what the incumbent lost')
  }
  const c = plan.calibration
  if (c && fin(c.cover80) && c.n >= PLAN_CAL.minN && (c.cover80 < PLAN_CAL.lo || c.cover80 > PLAN_CAL.hi)) fail(`PLAN MISCALIBRATED: the 80% forecast interval covered ${(100 * c.cover80).toFixed(0)}% of ${c.n} realised moves`, `${c.why} — ${c.cover80 < PLAN_CAL.lo ? 'intervals too narrow: the posterior is overconfident, so switches and holds are being made on noise' : 'intervals too wide: the posterior is underconfident, so real differences are being ignored'}`)
  else if (c) notes.push(`plan calibration: ${c.why ?? 'none'}`)
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
  if (jump?.install?.at === rec.at && plan?.exitJump?.install?.at !== rec.at) {
    if (jump.ok === false) fails.push({ what: String(jump.why).startsWith('EXIT JUMP AT INSTALL') ? jump.why : `EXIT JUMP AT INSTALL: ${jump.why}`, detail: 'the install priced the next life on one model and the life priced itself on another — plan.exitJumpOf, /tel/exitjump.txt' })
    else if (jump.why) notes.push(`last install's exit across the install: ${jump.why}`)
  }
  const ex = rec.exits ?? null
  if (!ex) {
    notes.push(`last install (${ageH.toFixed(1)}h ago) recorded no exit comparison${rec.terminal ? ' (terminal install)' : ''}`)
    return { fails, notes }
  }
  if (ex.ok === false) fails.push({ what: `TWO EXITS AT INSTALL (${rec.at}): ${String(ex.why ?? '').replace(/^TWO EXITS AT INSTALL: /, '')}`, detail: `the install ran on one exit while the plan had committed another for the same act — act.js /tel/install-last.txt; plan.installExitsOf` })
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
