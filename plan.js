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

import { rngOf, hashOf, normalOf, igDraw, nigDraw, PRIORS, traderPosterior, driftPosterior, driftCalibration, lnGainPosterior, logRatePosterior, jitterPosterior } from 'bayes.js'
import { routeExitFixed, countExitFixed } from 'countexit.js'
import { drain } from 'coop.js'
import { bestExitPolicy } from 'exitplan.js'

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
export function posteriorsOf({ stockRows = null, warmupH = 0, exitSamples = null, ledger = null, bitNode = null, obs = {}, optionPoints = null } = {}) {
  const jitter = jitterPosterior(optionPoints ?? [])
  const trader = stockRows ? traderPosterior(stockRows, { warmupH }) : null
  const drift = driftPosterior(exitSamples ?? [])
  const calibration = driftCalibration(exitSamples ?? [])
  const lnGain = ledger ? lnGainPosterior(ledger, bitNode) : null
  const exp = logRatePosterior(obs?.exp)
  const rep = logRatePosterior(obs?.rep)
  const missing = []
  if (!trader) missing.push('trader return (no stock history past warm-up): point input kept')
  if (!lnGain) missing.push('ln(M)/h (fewer than 3 lives in the ledger): point cadence kept')
  if (!exp) missing.push('exp rate (no observation): point kept')
  if (!rep) missing.push('rep rate (no observation): point kept')
  return { trader, drift, calibration, lnGain, exp, rep, gymSdLn: PRIORS.gymSdLn, jitter, missing }
}

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
    const s2 = igDraw(post.drift, st('drift'))
    const si2 = igDraw(post.jitter ?? PRIORS.jitter, st('jitter'))
    const zc = normalOf(st('common'))
    const ln = post.lnGain ? nigDraw(post.lnGain.post, st('lnGain')).mu : null
    const e = post.exp ? nigDraw(post.exp.post, st('exp')).mu - post.exp.mean : 0
    const repLn = post.rep ? nigDraw(post.rep.post, st('rep')).mu : null
    const gym = post.gymSdLn * normalOf(st('gym'))
    const r = post.trader ? Math.max(1e-9, post.trader.perSec.mean + post.trader.perSec.sd * zT) : null
    out.push({ i, seed, r, s2, si2, zc, lnPerHour: ln, expMult: Math.exp(e), repRate: repLn === null ? null : Math.exp(repLn), gymMult: Math.exp(gym) })
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
  if (fin(d.lnPerHour) && d.lnPerHour > 0 && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.multGainPerCycle = Math.exp(d.lnPerHour * inputs.cycleHours)
  if (fin(inputs.expPerSec)) o.expPerSec = inputs.expPerSec * d.expMult
  if (fin(inputs.repPerSec) && fin(d.repRate)) o.repPerSec = d.repRate
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
        h = o.sim(d)
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
export function decide({ samples, committed = null, switchCost = {}, theta = PLAN.theta } = {}) {
  const { stats, filled, N } = summarize(samples)
  const feasible = Object.keys(stats).filter((k) => filled[k])
  if (!feasible.length || !N) return { choice: null, switched: false, stays: false, why: 'no option is feasible in half the draws', stats }
  const argmin = feasible.reduce((a, k) => (stats[k].meanH < stats[a].meanH ? k : a), feasible[0])
  if (committed === null || !filled[committed]) {
    return {
      choice: argmin,
      switched: committed !== null,
      stays: false,
      why: committed === null ? `no committed option: the least expected exit (${stats[argmin].meanH}h, P(best) ${stats[argmin].pBest})` : `the committed option ${committed} is no longer feasible (${stats[committed]?.pFeasible ?? 0} of draws): the least expected exit, ${argmin}`,
      stats,
    }
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
    return { choice: best.key, switched: true, stays: false, gainH: +best.gain.toFixed(3), pWin: +best.pWin.toFixed(3), regretH: +regret.toFixed(3), why: `switch ${committed} -> ${best.key}: expected ${best.gain.toFixed(2)}h sooner net of a ${best.cost.toFixed(2)}h switch cost, better in ${(100 * best.pWin).toFixed(0)}% of ${N} paired draws (>= ${(100 * theta).toFixed(0)}%)`, stats }
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
    lnGain: post.lnGain ? { mean: post.lnGain.mean, sd: post.lnGain.sd } : null,
    exp: post.exp ? { n: post.exp.n, sdLn: post.exp.sd } : null,
    rep: post.rep ? { n: post.rep.n, sdLn: post.rep.sd } : null,
    gymSdLn: post.gymSdLn,
    optionErr: post.jitter ? { si: post.jitter.si, n: post.jitter.n, why: post.jitter.why } : null,
    stated: 'priors in bayes.js PRIORS / docs/bayes.md; the gym residual is NOT CALIBRATED (a stated prior)',
    missing: post.missing,
  }
}

/** Append an observation {at, v} to a same-life buffer, capped. */
export function withObs(buf, v, at, max = 48) {
  const b = Array.isArray(buf) ? buf : []
  return fin(v) && v > 0 ? [...b, { at, v }].slice(-max) : b
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
    return { ...pick(byKey.get(committedKey)), key: committedKey, ...stats[committedKey], held: true, why: `held (no event): ${prev?.why ?? ''}`.slice(0, 400), decidedAt: prev.decidedAt, options: prev.options ?? rows, ...cpu }
  }
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta })
  if (d.choice === null) return { key: null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
  return { ...pick(byKey.get(d.choice)), key: d.choice, ...stats[d.choice], held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
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
    opts.push({ key, spec, pointH, noiseKey: noiseKeyOf(spec, inputs), sim: (d) => f(applyDraw(inputs, d), d), ...extra })
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
  if (sameLife && prev && typeof prev.key === 'string' && prev.key.startsWith('r') && opts.some((o) => o.key === prev.key && o.routeKey === prev.routeKey)) committedKey = prev.key
  else if (sameLife && prev && (fin(prev.installAt) || prev.key === 'never')) {
    if (prev.key === 'never') committedKey = opts.some((o) => o.key === 'never') ? 'never' : null
    else {
      const spec = basisOf(prev, now)
      if (spec && spec.waitH <= 0.05) committedKey = opts.some((o) => o.key === 'now') ? 'now' : null
      else if (spec) {
        add('committed', spec, null)
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
    return { key: key === 'committed' ? `w${r3(sp.waitH)}` : key, install: key === 'now', installAt, waitH: r3(waitH), routeKey: o.routeKey ?? null, extra: o.extra ?? null, fixed: { n: sp.n ?? null, lifeH: sp.lifeH ?? null }, gains: sp.gains ?? null, spec: specOut, noiseKey: o.noiseKey, ...stats[key], ...extra, n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
  }
  if (!redecide && committedKey) return record(committedKey, { held: true, why: `held (no event): ${prev?.why ?? ''}`.slice(0, 400), decidedAt: prev.decidedAt, options: prev.options ?? rows })
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta })
  if (d.choice === null) return { key: null, install: false, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, n: ev.n, ms: ev.ms, overBudget: ev.overBudget }
  return record(d.choice, { held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, regretH: d.regretH ?? null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows })
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
export function consistencyOf(install, grafts, { si = 0.02 } = {}) {
  if (!install?.key || !fin(install.meanH)) return { ok: null, why: 'no install decision this pass' }
  if (!grafts?.key || !grafts.basisNoiseKey) return { ok: null, why: 'no graft decision priced on a basis this pass' }
  const sameBasis = grafts.basisNoiseKey === install.noiseKey
  const gH = grafts.meanH
  const N = Math.max(1, Math.min(install.n ?? 1, grafts.n ?? 1))
  const tolH = Math.max(0.02 * install.meanH, (4 * Math.SQRT2 * si * install.meanH) / Math.sqrt(N))
  if (!sameBasis) return { ok: null, sameBasis, installH: install.meanH, graftsH: gH, why: `the graft decision was priced on ${grafts.basisNoiseKey}, the install committed ${install.noiseKey}: not comparable this pass (re-priced on the next)` }
  const diffH = +(gH - install.meanH).toFixed(3)
  const ok = Math.abs(diffH) <= tolH
  return { ok, sameBasis, installH: install.meanH, graftsH: gH, diffH, tolH: +tolH.toFixed(3), why: ok ? `install and graft decisions price one trajectory: ${install.meanH}h vs ${gH}h` : `INCONSISTENT: the install decision's committed exit ${install.meanH}h and the graft decision's ${gH}h differ by ${diffH}h (tolerance ${tolH.toFixed(2)}h) on the same basis` }
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
  if (!redecide && committedKey) return { key: committedKey, ...stats[committedKey], held: true, why: `held (no event): ${prev?.why ?? ''}`.slice(0, 400), decidedAt: prev.decidedAt, options: prev.options ?? rows, ...cpu }
  const d = decide({ samples: ev.samples, committed: committedKey, switchCost: {}, theta })
  if (d.choice === null) return { key: null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
  return { key: d.choice, ...stats[d.choice], held: false, switched: d.switched, stays: d.stays, gainH: d.gainH ?? null, pWin: d.pWin ?? null, why: d.why, decidedAt: new Date(now).toISOString(), options: rows, ...cpu }
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
export function decideSpend({ deltaH, withoutH, si, theta = PLAN.theta } = {}) {
  if (!fin(deltaH) || !fin(withoutH) || !(withoutH > 0)) return null
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
  if (plan.consistency?.ok === false) fail(`PLAN INCONSISTENT: ${plan.consistency.why}`, 'two decisions of the one plan price its committed trajectory differently — they are not reading the same basis (plan.basisOf / trajectoryOf)')
  else if (plan.consistency?.why) notes.push(`plan consistency: ${plan.consistency.why}`)
  const c = plan.calibration
  if (c && fin(c.cover80) && c.n >= PLAN_CAL.minN && (c.cover80 < PLAN_CAL.lo || c.cover80 > PLAN_CAL.hi)) fail(`PLAN MISCALIBRATED: the 80% forecast interval covered ${(100 * c.cover80).toFixed(0)}% of ${c.n} realised moves`, `${c.why} — ${c.cover80 < PLAN_CAL.lo ? 'intervals too narrow: the posterior is overconfident, so switches and holds are being made on noise' : 'intervals too wide: the posterior is underconfident, so real differences are being ignored'}`)
  else if (c) notes.push(`plan calibration: ${c.why ?? 'none'}`)
  if (plan.exit) notes.push(`plan exit: mean ${plan.exit.meanH}h, 80% ${plan.exit.q10}-${plan.exit.q90}h (${plan.exit.source})`)
  const d = plan.decisions ?? {}
  if (d.countRoute?.key) notes.push(`plan route: ${d.countRoute.name} at ${d.countRoute.faction} via ${d.countRoute.via}${d.countRoute.held ? ' (held)' : ''} — ${String(d.countRoute.why ?? '').slice(0, 160)}`)
  if (d.install?.key) notes.push(`plan install: ${d.install.key}${d.install.held ? ' (held)' : ''} — ${String(d.install.why ?? '').slice(0, 160)}`)
  if (cpu) notes.push(fin(cpu.maxBlockMs) ? `plan cpu: ${cpu.cpuMs}ms work over ${cpu.wallMs}ms wall, longest block ${cpu.maxBlockMs}ms (${cpu.yields} yields), ${cpu.draws} draws` : `plan cpu: ${cpu.ms}ms of ${cpu.budgetMs}ms, ${cpu.draws} draws`)
  return { fails, notes }
}

/** A per-life seed: the same draws for every pass of one life (CRN across passes). */
export const seedOf = (lastAugReset, node) => hashOf(`${node ?? ''}:${lastAugReset ?? 0}`)
