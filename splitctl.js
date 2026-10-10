// THE MONEY / EXP SPLIT, CLOSED LOOP — measure what the running split yields,
// calibrate the model with it, decide the next split on the exit.
//
// Pure: no ns surface. batch.js imports the METER (it owns the counters);
// progress.js imports the CONTROLLER (it owns the exit simulation).
//
// WHY. expfarm.splitVerdict (601eba2) priced the fleet's money share every pass
// but OPEN-LOOP: the money side was the target-count model (moneyModelOf, +40%
// over live income in BN1) and the farm/money exp ratio k a remembered
// snapshot, and nothing fed what the running split actually produced back into
// the price. Live BN12 2026-10-09 16:00Z at 10% money: the farm held ~4.5TB of
// a 36TB fleet (utilisation 25%: its waves are target-limited, the farm exp
// does NOT fall as the money share rises) while the verdict priced the farm's
// exp as (1 - s) of the fleet; k in batch.txt read 5.0, 35.9, 5.4 on three
// consecutive minutes (farm.held is a snapshot of sub-second holds).
//
// THE PLANT. The decision is s, the fraction of the fleet batching money (the
// rest farms exp). batch.js measures, under the running s0, three streams from
// its OWN counters (not a model, not tel.js):
//
//   money     $ the money targets' balances fell by (the drop attribution
//             batch.js already uses for `earned`), per second
//   farmExp   exp units the farm launched: threads x (3 + 0.3 baseDifficulty)
//             (Hacking.ts:30-38), hacks x (p + (1-p)/4) (NetscriptHelpers.tsx
//             618-641) — "units" because the player-wide factor
//             (hacking_exp x HackExpGain) is common to every stream and cancels
//             in every ratio the controller uses; progress.js publishes it
//             against tel.js's script exp as expUnitScale
//   moneyExp  the same units from the money targets' batches and prep
//
// in one-minute buckets, only after the segment SETTLED (every money target
// batching for a full weaken time, the farm out of prep), windowed to the last
// 30 buckets, with the bucket-to-bucket standard error and the RAM each side
// actually held (GB-seconds), so a rate per GB is published too.
//
// THE CALIBRATION. Each stream j has a model curve m_j(s) (batch.js
// splitModel: moneyModelOf at fleet s x total for money and its exp;
// expfarm.farmHoldGB on (1 - s) x total for the farm — the farm's own wave
// sizing, so its saturation is in the model). The truth is taken as
//
//     y_j(s) = m_j(s) x exp(a_j + b_j (s - 0.5))
//
// — a scale and a tilt on the model, a Bayesian linear regression of
// ln(measured / model) on s with the MODEL AS PRIOR: a ~ N(0, ln 1.5),
// b ~ N(0, 1). Every settled segment is one observation, its variance the
// window's relative standard error squared plus a floor plus drift x age (old
// segments forget: the plant moves as the level climbs). One measured share
// pins the scale; a second identifies the tilt. Where nothing is measured the
// curve is the model's shape at the measured scale. The observations OUTLIVE
// AN INSTALL (same node): they are ratios to a model recomputed at the new
// life's level and fleet, so the last life's are this life's prior.
//
// THE DECISION is still "minimise the simulated exit" (CLAUDE.md: decisions
// compare simulated trajectories). Every candidate s on a 5% grid is one exit
// on the SHARED inputs with only the split changed (inputsAt):
//
//     income(s) = (income - hacking stream) + M(s)
//     exp(s)    = flat + script x E(s) / E(s0),   E = F + B
//
// with M, F, B the calibrated curves. inputsAt is the ONE income-at-share
// function: progress.js conditions the exit inputs EVERY decision reads on
// the controller's split with it (splitConditioned) — live 16:43Z the exit
// priced a whole future at the $1.70e5/s the batcher earned while the farm
// held the fleet.
//
// THE CONTROL LAW (converge without oscillating):
//   start     whenever the running split is not one this controller chose
//             this life (a life's opening, batch.js restarted at 0% — live
//             17:49Z): straight to the posterior's optimum, on the exploit's
//             confidence rule — there is no decided state to protect
//   dwell     a wait for the measurement (minBuckets after settle, at least
//             dwellMs on the split, x3 while oscillating; maxDwellMs bounds
//             an unsettled one) — PRICED: waiting costs waitH x (1 - H(best)/
//             H(s0)) of exit, the measurement is worth at most the gain's
//             posterior sd; when the gain is clear of that band, or waiting
//             costs more than the band, the step-limited move is taken now
//             (live 17:53Z held 0% for a published 41 min at a 4.1h gap)
//   step      a move is at most stepMax (3 grid steps) toward the optimum
//   cost      a retarget is priced: for the ramp time tau (MEASURED: each
//             segment's settle time, prior 10 min) the moved RAM produces
//             nothing — rates at money min(s0,s1) and farm 1 - max(s0,s1).
//             Composed as progress fractions: cost = tau x (1 - H(s1)/H_ramp)
//             (an approximation of the transient, not a simulation of it —
//             published as such)
//   exploit   when the WHOLE path's gain (to the optimum, every retarget
//             paid) clears the hysteresis (1 min; x3 oscillating) by zGain
//             posterior sd — the spread of the gain over the sigma points
//   explore   otherwise, the value of SAMPLE information: the draws' mean
//             regret of staying (EVPI, each draw's optimum over the range)
//             times the part of a trial share's predictive variance one more
//             measurement removes; the best trial within a step limit in the
//             direction the regret points, if that beats its price (a dwell
//             there + two retargets) by exploreMinH
//   return    after a trial's dwell, back to where it came from unless the
//             mean now prefers the trial (a probe is information, not a move)
//   loud      every pass publishes the estimates, model-vs-measured error per
//             stream, dwell, last switch and why; `oscillating` (>= 3
//             direction reversals in 3h, explore/return pairs set aside, or
//             >= 3 such probes) and `diverged` (a stream measured beyond +-40%
//             of its model — the BN1 miss) are healthcheck failures
//             (tools/healthcheck.mjs SPLIT OSCILLATING / SPLIT MODEL OFF;
//             SPLIT UNMEASURED when the farm runs with no meter).
//
// CALIBRATION of this file: the controller IS the calibration of the split's
// model; its own law is tested closed-loop against plants whose true rates
// are the model x0.3..x1.4 with shape errors, on the real exit simulator
// (tools/test/splitctl.test.mjs SC1, 5 seeds offline). The retarget cost's
// progress-fraction composition is NOT simulated; neither is the level's
// growth within a life in M (the measured rate never carried it either).

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

export const SPLIT = {
  bucketMs: 60e3,
  windowBuckets: 30,
  maxUnsettledMs: 30 * 60e3,
  step: 0.05,
  maxFrac: 0.95,
  stepMax: 0.15,
  dwellMs: 10 * 60e3,
  minBuckets: 5,
  maxDwellMs: 45 * 60e3,
  hystH: 1 / 60,
  priorSdA: Math.log(1.5),
  priorSdB: 1,
  obsFloorSd: 0.03,
  driftVarPerH: 0.0003,
  oneBucketSd: 0.3,
  maxObs: 16,
  oscWindowMs: 3 * 3600e3,
  oscReversals: 3,
  oscDamp: 3,
  divergeTol: 0.4,
  rampPriorSec: 600,
  pendingMs: 5 * 60e3,
  // The trial window around the running split, in grid steps (EVPI looks over
  // the whole range on 10% steps beside it).
  voiSteps: 2,
  zGain: 1,
  newSeSd: 0.03,
  // Exploration needs its value to beat its price by this, not by the
  // switching hysteresis: a measurement that pays for itself is worth
  // taking, and what stops re-probing is that a measured share is no longer
  // learnable (value x v/(v + v_new)).
  exploreMinH: 1 / 60,
}

/** The candidate grid: 0, 5%, ..., 100% (100% priced for reference; the controller stops at maxFrac). */
export const SPLIT_GRID = Array.from({ length: 21 }, (_, i) => i / 20)
const snap = (s) => Math.round(s * 1e6) / 1e6

// ------------------------------------------------------------------- METER

const blank = (t0) => ({ t0, money: 0, farmE: 0, moneyE: 0, mGBs: 0, fGBs: 0 })

/** A new measurement segment for the money fraction `frac`, begun at nowMs (batch.js applies a share). */
export function meterNew(frac, nowMs) {
  return { segId: `${nowMs}:${frac}`, frac, start: nowMs, settledAt: null, forced: false, cur: blank(nowMs), buckets: [], gb: { money: 0, farm: 0 } }
}

/** Count `v` of stream key ('money' $, 'farmE' / 'moneyE' exp units) into the open bucket. */
export function meterAdd(m, key, v) {
  if (m && num(v) && v > 0 && key in m.cur) m.cur[key] += v
}

/**
 * Advance the meter one controller tick. `ready`: every money target batching
 * for a full weaken time and the farm out of prep — the first time it is true
 * the segment SETTLES and measurement starts from zero (the ramp is excluded:
 * prep is not the steady state being priced). A segment that never settles is
 * force-settled after maxUnsettledMs and says so (forced), so a plant that
 * cannot reach steady state is measured as what it is rather than never.
 */
export function meterTick(m, nowMs, dtMs, { ready, moneyGB, farmGB } = {}) {
  if (!m) return
  m.gb = { money: num(moneyGB) ? moneyGB : 0, farm: num(farmGB) ? farmGB : 0 }
  if (m.settledAt === null) {
    const forced = !ready && nowMs - m.start >= SPLIT.maxUnsettledMs
    if (ready || forced) {
      m.settledAt = nowMs
      m.forced = forced
      m.cur = blank(nowMs)
    }
    return
  }
  const dt = num(dtMs) && dtMs > 0 ? dtMs : 0
  m.cur.mGBs += (m.gb.money * dt) / 1000
  m.cur.fGBs += (m.gb.farm * dt) / 1000
  if (nowMs - m.cur.t0 >= SPLIT.bucketMs) {
    m.buckets.push({ ...m.cur, dt: (nowMs - m.cur.t0) / 1000 })
    if (m.buckets.length > SPLIT.windowBuckets) m.buckets.shift()
    m.cur = blank(nowMs)
  }
}

/** The segment's measurement: per-second rates over the window, bucket SE, RAM held, rates per GB. */
export function meterReport(m, nowMs) {
  if (!m) return null
  const B = m.buckets
  const T = B.reduce((a, b) => a + b.dt, 0)
  const stat = (key) => {
    if (!B.length || !(T > 0)) return null
    const perSec = B.reduce((a, b) => a + b[key], 0) / T
    let se = null
    if (B.length >= 2) {
      const r = B.map((b) => b[key] / b.dt)
      const mu = r.reduce((a, x) => a + x, 0) / r.length
      se = Math.sqrt(r.reduce((a, x) => a + (x - mu) ** 2, 0) / (r.length - 1) / r.length)
    }
    return { perSec, se }
  }
  const mGB = T > 0 ? B.reduce((a, b) => a + b.mGBs, 0) / T : null
  const fGB = T > 0 ? B.reduce((a, b) => a + b.fGBs, 0) / T : null
  const money = stat('money')
  const farmExp = stat('farmE')
  const moneyExp = stat('moneyE')
  const per = (x, gb) => (x && pos(gb) ? x.perSec / gb : null)
  return {
    segId: m.segId,
    frac: m.frac,
    startedAt: new Date(m.start).toISOString(),
    ageSec: Math.round((nowMs - m.start) / 1000),
    settled: m.settledAt !== null,
    settleSec: m.settledAt !== null ? Math.round((m.settledAt - m.start) / 1000) : null,
    forced: m.forced,
    n: B.length,
    windowSec: Math.round(T),
    money,
    farmExp,
    moneyExp,
    heldGB: { money: mGB, farm: fGB, now: { ...m.gb } },
    perGB: { moneyPerGBs: per(money, mGB), farmExpPerGBs: per(farmExp, fGB), moneyExpPerGBs: per(moneyExp, mGB) },
    units: 'money $/s; exp in units of (3 + 0.3 baseDifficulty) per thread (hack x (p + (1-p)/4)), before the player-wide exp factor',
  }
}

// ----------------------------------------------------------- CALIBRATION

/** Linear read of a published model curve {shares, <key>: [...]} at s; null when absent. */
export function curveAt(model, key, s) {
  const xs = model?.shares
  const ys = model?.[key]
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || !xs.length || !num(s)) return null
  if (s <= xs[0]) return num(ys[0]) ? ys[0] : null
  for (let i = 1; i < xs.length; i++) {
    if (s <= xs[i]) {
      const y0 = ys[i - 1]
      const y1 = ys[i]
      if (!num(y0) || !num(y1)) return null
      return y0 + ((s - xs[i - 1]) / (xs[i] - xs[i - 1] || 1)) * (y1 - y0)
    }
  }
  const y = ys[ys.length - 1]
  return num(y) ? y : null
}

/**
 * Posterior of one stream's calibration (a, b): ln(meas/model) = a + b (s - 0.5),
 * prior N(0, priorSdA^2) x N(0, priorSdB^2), one observation per segment.
 * Returns { a, b, C (2x2 covariance), n }.
 */
export function fitStream(obs, key, nowMs, o = SPLIT) {
  let p00 = 1 / o.priorSdA ** 2
  let p01 = 0
  let p11 = 1 / o.priorSdB ** 2
  let r0 = 0
  let r1 = 0
  let n = 0
  for (const ob of obs ?? []) {
    const q = ob?.[key]
    if (!q || !pos(q.model) || !num(q.meas) || !num(ob.frac)) continue
    const meas = Math.max(q.meas, 0.01 * q.model)
    const z = Math.log(meas / q.model)
    const x = ob.frac - 0.5
    const rel = pos(q.se) && q.meas > 0 ? q.se / q.meas : o.oneBucketSd
    const ageH = num(ob.at) ? Math.max(0, (nowMs - ob.at) / 3.6e6) : 0
    const v = rel ** 2 + o.obsFloorSd ** 2 + o.driftVarPerH * ageH
    p00 += 1 / v
    p01 += x / v
    p11 += (x * x) / v
    r0 += z / v
    r1 += (x * z) / v
    n++
  }
  const det = p00 * p11 - p01 * p01
  const C = [
    [p11 / det, -p01 / det],
    [-p01 / det, p00 / det],
  ]
  return { a: C[0][0] * r0 + C[0][1] * r1, b: C[1][0] * r0 + C[1][1] * r1, C, n }
}

/** Predictive variance of ln(y/model) at split s under a fitted stream. */
export function predVar(f, s) {
  const x = s - 0.5
  return f.C[0][0] + 2 * x * f.C[0][1] + x * x * f.C[1][1]
}

/** Unscented sigma points of a 2-D Gaussian: mean +- sqrt(2 lambda_i) v_i. */
function sigmaPoints(f) {
  const [[c00, c01], [, c11]] = f.C
  const tr = (c00 + c11) / 2
  const d = Math.sqrt(((c00 - c11) / 2) ** 2 + c01 * c01)
  const out = []
  for (const lam of [tr + d, tr - d]) {
    if (!(lam > 0)) continue
    let vx = c01
    let vy = lam - c00
    if (Math.abs(vx) + Math.abs(vy) < 1e-15) {
      vx = c00 >= c11 ? 1 : 0
      vy = c00 >= c11 ? 0 : 1
      if (Math.abs(lam - c00) > Math.abs(lam - c11)) [vx, vy] = [vy, vx]
    }
    const nrm = Math.hypot(vx, vy)
    const k = Math.sqrt(2 * lam) / nrm
    out.push({ a: f.a + k * vx, b: f.b + k * vy }, { a: f.a - k * vx, b: f.b - k * vy })
  }
  return out
}

const STREAMS = [
  ['money', 'money'],
  ['farmExp', 'farmExp'],
  ['moneyExp', 'moneyExp'],
]

/** Calibrated curve y(s) = model(s) x exp(a + b (s - 0.5)); null where the model is unpriced. */
function calibrated(model, key, th) {
  return (s) => {
    const m = curveAt(model, key, s)
    return m === null ? null : Math.max(0, m) * Math.exp(th.a + th.b * (s - 0.5))
  }
}

/**
 * THE EXIT INPUTS AT SPLIT s — the ONE income/exp-at-share function: the
 * controller prices every candidate with it, and progress.js conditions the
 * exit inputs every other decision reads with it (splitConditioned), so the
 * trajectory the run is priced on is the split it will run.
 *
 *   income(s) = (income - hackPerSec) + M(s)     the hacking stream REPLACED
 *               by the calibrated money curve at s — the non-hacking income
 *               (trader, contracts, hacknet) kept as measured
 *   exp(s)    = flat + script x E(s) / E(s0)     E = F + B, anchored at s0
 *
 * hackPerSec: the hacking stream the inputs carry (progress.js: the income
 * posterior's hacking part, else the level stream). Unknown -> the anchor
 * form income + M(s) - M(s0) (exactly `inputs` at s0). WHY REPLACED, NOT
 * ANCHORED: the measured hacking stream is whatever the batcher earned under
 * the split it ran — live BN12 16:43Z it read $1.70e5/s (from $6.68e7/s) with
 * the exp farm holding the fleet, and the exit priced the whole future at it
 * (28.9-46h). M(s) is the steady state of the split, measured where it ran.
 * `ramp` = {lo, hi} prices the transient: money from min(s0, s1), the farm
 * on 1 - max(s0, s1).
 */
export function inputsAt(inputs, model, th, s0, s, ramp = null, hackPerSec = null) {
  const M = calibrated(model, 'money', th.money)
  const F = calibrated(model, 'farmExp', th.farmExp)
  const Bx = calibrated(model, 'moneyExp', th.moneyExp)
  const m0 = M(s0)
  const e0 = (F(s0) ?? 0) + (Bx(s0) ?? 0)
  if (m0 === null || !(e0 > 0)) return null
  const mS = M(ramp ? ramp.lo : s)
  const eS = ramp ? (F(ramp.hi) ?? 0) + (Bx(ramp.lo) ?? 0) : (F(s) ?? 0) + (Bx(s) ?? 0)
  if (mS === null) return null
  const flat = pos(inputs.expFlatPerSec) ? Math.min(inputs.expFlatPerSec, inputs.expPerSec) : 0
  const script = Math.max(0, inputs.expPerSec - flat)
  const replaced = num(hackPerSec) && hackPerSec >= 0
  if (!replaced && snap(s) === snap(s0) && !ramp) return inputs
  const income = replaced ? Math.max(0, (inputs.incomePerSec ?? 0) - hackPerSec) + mS : Math.max(0, (inputs.incomePerSec ?? 0) + mS - m0)
  return { ...inputs, incomePerSec: income, expPerSec: Math.max(1e-9, flat + (script * eS) / e0) }
}

/** The calibration a published controller record carries (control.calib scale/tilt) as th. */
export function thetaOf(calib) {
  const one = (c) => (c && pos(c.scale) && num(c.tilt) ? { a: Math.log(c.scale), b: c.tilt } : null)
  const t = { money: one(calib?.money), farmExp: one(calib?.farmExp), moneyExp: one(calib?.moneyExp) }
  return t.money && t.farmExp && t.moneyExp ? t : null
}

/**
 * THE EXIT INPUTS CONDITIONED ON THE SPLIT THE RUN WILL FOLLOW (progress.js
 * exitInputsGen, every exit of the pass): income and exp at the controller's
 * target split through inputsAt, with the calibration and model it published
 * — the same function and numbers the controller decided with. Carries
 * `split` {conditioned, s0, target, hackPerSec, base {incomePerSec,
 * expPerSec}, hackAtTarget, why} and `incomeSplitDelta` (plan.applyDraw moves
 * each Monte Carlo draw of the hacking stream by it). Unconditioned (and
 * says why) when the controller has no fresh same-life record, batch.js no
 * model, or the target is unknown.
 *
 *   ctx: { rec: /tel/expfarm.txt, batch: /tel/batch.txt, lastAugReset, nowMs, hackPerSec }
 */
export function splitConditioned(inputs, ctx = {}) {
  const { rec, batch, lastAugReset = null, nowMs = Date.now(), hackPerSec = null } = ctx
  const no = (why) => ({ ...inputs, split: { conditioned: false, why } })
  if (!inputs) return inputs
  if (!rec || rec.lastAugReset !== lastAugReset || !(nowMs - Date.parse(rec.at ?? '') < 15 * 60e3)) return no('no fresh split verdict for this life (/tel/expfarm.txt): the inputs are as measured at the running split')
  if (rec.priced !== true || !num(rec.moneyShare)) return no(`the split verdict is unpriced (${String(rec.why ?? '').slice(0, 80)})`)
  const th = thetaOf(rec.control?.calib)
  if (!th) return no('the split verdict carries no calibration (open loop)')
  const model = batch?.splitModel
  if (!Array.isArray(model?.shares)) return no('batch.js publishes no splitModel')
  const s0 = batch?.expFarm ? (num(batch.expFarm.moneyShare) ? batch.expFarm.moneyShare : 0) : 1
  const target = rec.moneyShare
  const x = inputsAt(inputs, model, th, s0, target, null, hackPerSec)
  if (!x) return no('the model cannot price the running or target split')
  const M = calibrated(model, 'money', th.money)
  const hackAt = M(target)
  return {
    ...x,
    incomeSplitDelta: num(hackPerSec) && hackPerSec >= 0 && num(hackAt) ? hackAt - hackPerSec : x.incomePerSec - (inputs.incomePerSec ?? 0),
    split: {
      conditioned: true,
      s0,
      target,
      hackPerSec: num(hackPerSec) ? hackPerSec : null,
      hackAtTarget: hackAt,
      base: { incomePerSec: inputs.incomePerSec ?? null, expPerSec: inputs.expPerSec ?? null },
      why: `income and exp at the controller's ${Math.round(target * 100)}% split (running ${Math.round(s0 * 100)}%): hacking ${num(hackPerSec) ? `$${Math.round(hackPerSec)}/s as measured -> ` : ''}$${Math.round(hackAt ?? 0)}/s calibrated (splitctl.inputsAt, the controller's own pricing)`,
    },
  }
}

/** The inputs as measured at the running split (undo splitConditioned): what the controller anchors on. */
export function splitRaw(inputs) {
  if (!inputs?.split?.conditioned) return inputs
  const { split, incomeSplitDelta, ...rest } = inputs
  return { ...rest, incomePerSec: split.base.incomePerSec, expPerSec: split.base.expPerSec }
}

// ------------------------------------------------------------ CONTROLLER

/**
 * Direction reversals among recent switches (A->B then B->A-ward). A PROBE —
 * an explore and the return that undoes it — is a measurement, not a swing of
 * the law: each such pair is set aside (counted as `probes`) and reversals are
 * counted among the remaining moves. Probes are bounded on their own: as many
 * probes as oscReversals in the window is churn too (splitControl).
 */
export function reversalsOf(switches, nowMs, windowMs = SPLIT.oscWindowMs) {
  const rec = (switches ?? []).filter((w) => num(w.at) && nowMs - w.at <= windowMs && num(w.from) && num(w.to) && w.to !== w.from)
  const moves = []
  let probes = 0
  for (const w of rec) {
    const p = moves[moves.length - 1]
    if (w.kind === 'return' && p && p.kind === 'explore' && snap(p.from) === snap(w.to) && snap(p.to) === snap(w.from)) {
      moves.pop()
      probes++
      continue
    }
    moves.push(w)
  }
  let rev = 0
  for (let i = 1; i < moves.length; i++) if (Math.sign(moves[i].to - moves[i].from) !== Math.sign(moves[i - 1].to - moves[i - 1].from)) rev++
  return { reversals: rev, switches: rec.length, probes }
}

/** Fresh controller state for a node; a new life keeps `obs` (calibration) and resets the rest. */
export const ctlNew = (lastAugReset, bitNode = null) => ({ v: 1, bitNode, lastAugReset, obs: [], switches: [], target: null, targetAt: null, s0: null, s0Since: null })

/**
 * ONE PASS OF THE CONTROLLER.
 *   bestExitPolicy  exitplan's (injected: pure)
 *   inputs          the shared exit inputs (progress.js exitInputsOf), measured at s0
 *   share0          the split batch.js is running (batch.txt expFarm.moneyShare)
 *   measure         batch.txt splitMeasure (meterReport) — the running segment
 *   model           batch.txt splitModel {shares, money, farmExp, moneyExp}
 *   state           the previous pass's control.state (same life) or null
 *   nowMs, lastAugReset, scriptExpPerSec (tel.js, for expUnitScale)
 *   learn           false = OPEN LOOP (measurements ignored) — the test's baseline only
 *   route           committedRouteOf(plan.txt): on a committed route other than
 *                   'hack' the split is not priced on exitplan's exit (5b)
 * Returns { frac, priced, kind, why, grid, best, runH, farmH, moneyH, shareH, state, ...published fields }.
 */
export function splitControl(o) {
  const { bestExitPolicy, inputs, share0, measure, model, nowMs, lastAugReset = null, bitNode = null, scriptExpPerSec = null, hackPerSec = null, learn = true, route = null } = o
  const P = { ...SPLIT, ...(o.params ?? {}) }
  // THE CALIBRATION OUTLIVES AN INSTALL (same node): each observation is a
  // ratio measured/model, and the model is recomputed at the new life's level
  // and fleet, so last life's ratios are this life's prior (aged by the drift
  // term). Switches, target and the dwell clock are per life.
  let state = o.state && o.state.v === 1 && (o.state.bitNode ?? null) === bitNode ? structuredClone(o.state) : ctlNew(lastAugReset, bitNode)
  if (state.lastAugReset !== lastAugReset) state = { ...ctlNew(lastAugReset, bitNode), obs: state.obs }
  const no = (why) => ({ frac: null, priced: false, why, state })
  if (typeof bestExitPolicy !== 'function' || !inputs) return no('no exit inputs')
  if (!(num(share0) && share0 >= 0 && share0 <= 1)) return no(`running split unknown (share0 ${share0})`)
  if (!pos(inputs.expPerSec)) return no('no measured exp rate in the exit inputs')
  if (!Array.isArray(model?.shares) || !Array.isArray(model?.money) || !Array.isArray(model?.farmExp) || !Array.isArray(model?.moneyExp)) return no('batch.js publishes no splitModel (the model curves the calibration multiplies)')
  const s0 = snap(share0)

  // ---- 1. ingest the running segment (settled, on the running share) -----
  const seg = measure && num(measure.frac) && snap(measure.frac) === s0 ? measure : null
  if (seg && seg.settled && seg.n >= 1 && seg.money && seg.farmExp && seg.moneyExp) {
    const q = (key, mk) => ({ meas: seg[key].perSec, se: seg[key].se, model: curveAt(model, mk, s0) })
    const ob = { segId: seg.segId, frac: s0, at: nowMs, n: seg.n, settleSec: seg.settleSec, forced: !!seg.forced, money: q('money', 'money'), farmExp: q('farmExp', 'farmExp'), moneyExp: q('moneyExp', 'moneyExp') }
    const i = state.obs.findIndex((x) => x.segId === ob.segId)
    if (i >= 0) state.obs[i] = ob
    else state.obs.push(ob)
    while (state.obs.length > P.maxObs) state.obs.shift()
  }

  // ---- 2. calibrate ------------------------------------------------------
  const used = learn ? state.obs : []
  const fit = {}
  for (const [key] of STREAMS) fit[key] = fitStream(used, key, nowMs, P)
  const th = { money: { a: fit.money.a, b: fit.money.b }, farmExp: { a: fit.farmExp.a, b: fit.farmExp.b }, moneyExp: { a: fit.moneyExp.a, b: fit.moneyExp.b } }
  const cur = state.obs.find((x) => seg && x.segId === seg.segId) ?? null
  const calib = {}
  const diverged = []
  for (const [key] of STREAMS) {
    const f = fit[key]
    const q = cur?.[key]
    const err = q && pos(q.model) && num(q.meas) ? q.meas / q.model - 1 : null
    calib[key] = {
      scale: Math.exp(f.a),
      sdA: Math.sqrt(f.C[0][0]),
      tilt: f.b,
      sdB: Math.sqrt(f.C[1][1]),
      n: f.n,
      modelAtS0: curveAt(model, key, s0),
      measuredAtS0: q?.meas ?? null,
      seAtS0: q?.se ?? null,
      err,
    }
    if (err !== null && cur.n >= P.minBuckets && Math.abs(err) > P.divergeTol) diverged.push(`${key} measured ${(err * 100).toFixed(0)}% vs model (n ${cur.n}, tolerance +-${P.divergeTol * 100}%)`)
  }
  const expUnitScale = cur && pos(scriptExpPerSec) && pos(cur.farmExp?.meas + cur.moneyExp?.meas) ? scriptExpPerSec / (cur.farmExp.meas + cur.moneyExp.meas) : null

  // ---- 3. oscillation and the dwell clock ---------------------------------
  const osc = reversalsOf(state.switches, nowMs, P.oscWindowMs)
  const oscillating = osc.reversals >= P.oscReversals || osc.probes >= P.oscReversals
  const damp = oscillating ? P.oscDamp : 1
  const hyst = P.hystH * damp
  // THE DWELL CLOCK runs from when the running split first ran (the earliest
  // segment batch.js measured at it), not from the current segment: a
  // segment restarts whenever the money targets change (the fleet grows),
  // and a clock that restarted with it could dwell forever.
  if (state.s0 !== s0) {
    state.s0 = s0
    state.s0Since = seg ? nowMs - seg.ageSec * 1000 : nowMs
  }
  const segAgeMs = seg ? seg.ageSec * 1000 : 0
  const splitAgeMs = num(state.s0Since) ? nowMs - state.s0Since : segAgeMs
  const settledEnough = !!(seg && seg.settled && seg.n >= P.minBuckets)
  // THE WAIT the dwell would impose: until the segment holds minBuckets
  // (bucketsLeft one-minute buckets after it settles, at most maxDwellMs on
  // the split), then at least dwellMs (x damp) on the split. 62e2718 PUBLISHED
  // maxDwellMs - age as the wait whenever the buckets were short — live
  // 17:53Z "41.1 min left" with 2 buckets to go — and held it unpriced.
  const bucketsLeft = seg && seg.settled ? Math.max(0, P.minBuckets - seg.n) : null
  const waitBucketsMs = settledEnough ? 0 : bucketsLeft !== null ? bucketsLeft * P.bucketMs : Math.max(0, P.maxDwellMs - splitAgeMs)
  const dwellLeftMs = seg ? Math.max(Math.max(0, P.dwellMs * damp - splitAgeMs), Math.min(waitBucketsMs, Math.max(0, P.maxDwellMs - splitAgeMs))) : null
  const pending = state.target !== null && snap(state.target) !== s0 && num(state.targetAt) && nowMs - state.targetAt < P.pendingMs
  // THE START: the running split is not one this controller chose this life —
  // a life's opening split, or batch.js restarted mid-life (it comes back at
  // 0% until it reads a verdict: live 17:49Z), or an open-loop leftover. Its
  // measurement is of a split nobody decided, so there is nothing for a dwell
  // or a step limit to protect. (62e2718 required the segment UNSETTLED too;
  // 0% has no money targets and settles at once, so the start never fired.)
  const starting = !pending && !state.switches.some((w) => snap(w.to) === s0)
  const deciding = true

  // ---- 4. price the grid at the posterior mean (10% steps while nothing
  // will be decided — publication only; 5% when deciding) -----------------
  const memo = new Map()
  const H = (t, s, ramp = null) => {
    const key = `${JSON.stringify(t)}|${s}|${ramp ? `${ramp.lo},${ramp.hi}` : ''}`
    if (memo.has(key)) return memo.get(key)
    const x = inputsAt(inputs, model, t, s0, s, ramp, hackPerSec)
    const h = x ? (bestExitPolicy(x)?.best?.hours ?? null) : null
    memo.set(key, num(h) ? h : null)
    return memo.get(key)
  }
  const shares = [...new Set([...SPLIT_GRID.filter((s) => deciding || Math.round(s * 20) % 2 === 0), s0].map(snap))].sort((a, b) => a - b)
  const grid = shares.map((s) => ({ frac: s, hours: H(th, s) }))
  const hOf = (s) => grid.find((g) => g.frac === snap(s))?.hours ?? null
  const runH = hOf(s0)
  if (!num(runH)) return no('the running split could not be priced')
  let best = { frac: s0, hours: runH }
  for (const g of grid) if (g.frac <= P.maxFrac + 1e-9 && num(g.hours) && g.hours < best.hours) best = g

  // ---- 5. ramp (retarget) cost, from measured settle times ---------------
  const settles = state.obs.map((x) => (x.forced ? P.maxUnsettledMs / 1000 : x.settleSec)).filter(num)
  const tauSec = (P.rampPriorSec + settles.reduce((a, x) => a + x, 0)) / (1 + settles.length)
  const tauH = tauSec / 3600
  const costOf = (t, s1) => {
    if (snap(s1) === s0) return 0
    const h1 = H(t, s1)
    const hr = H(t, s1, { lo: Math.min(s0, s1), hi: Math.max(s0, s1) })
    return num(h1) && num(hr) && hr > 0 ? tauH * Math.max(0, 1 - h1 / hr) : tauH
  }

  const published = {
    calib,
    diverged,
    expUnitScale,
    ramp: { tauSec: Math.round(tauSec), measured: settles.length, note: 'retarget cost = tau x (1 - H(s1)/H_ramp): the transient composed as progress fractions, NOT simulated' },
    oscillating,
    reversals3h: osc.reversals,
    switches3h: osc.switches,
    probes3h: osc.probes,
    segment: seg ? { segId: seg.segId, frac: seg.frac, ageMin: Math.round(segAgeMs / 6e3) / 10, splitAgeMin: Math.round(splitAgeMs / 6e3) / 10, settled: seg.settled, settleSec: seg.settleSec, forced: seg.forced, n: seg.n } : null,
    dwellLeftMin: dwellLeftMs === null ? null : Math.round(dwellLeftMs / 6e3) / 10,
    lastSwitch: state.switches.length ? state.switches[state.switches.length - 1] : null,
    learn,
  }
  const done = (frac, kind, why, extra = {}) => {
    if (snap(frac) !== s0 && kind !== 'pending') {
      state.switches.push({ at: nowMs, from: s0, to: snap(frac), kind, why: why.slice(0, 160) })
      while (state.switches.length > 24) state.switches.shift()
      state.target = snap(frac)
      state.targetAt = nowMs
    }
    if (snap(frac) === s0) {
      state.target = null
      state.targetAt = null
    }
    return { frac: snap(frac), priced: true, kind, why, grid, best, runH, shareH: hOf(frac) ?? runH, farmH: hOf(0), moneyH: hOf(1), state, ...published, ...extra }
  }

  // ---- 5b. THE COMMITTED ROUTE is not the exit priced above ---------------
  // Everything above prices the split on exitplan's exit — the World Daemon,
  // the hacking route. On the committed Bladeburner route (plan.txt
  // decisions.bladeRoute.key 'blade', committedRouteOf) that is not the exit
  // the run takes: live BN7.1 2026-10-10 the controller walked 15 -> 30 -> 60
  // -> 45 (5 reversals, 11 switches in 3h: SPLIT OSCILLATING) on a 153-vs-155h
  // World Daemon surface (+-52 min) while the committed exit was 13.3h by the
  // black ops. The black-op exit (bbplan.bladeExitGen) reads no hacking exp
  // and no batcher stream; it reads income only through the legs the route
  // record names (committedRouteOf moneyLegs). With none, no split moves the
  // committed exit: HOLD the running split (measurements still calibrate).
  // With one, the exit is non-increasing in money and blind to exp, so the
  // money end dominates: step toward it — never back, so never a reversal.
  if (route && route.key && route.key !== 'hack') {
    const routeH = num(route.exitH) ? `${route.exitH.toFixed(2)}h` : '?h'
    const head = `the committed route is '${route.key}' (exit ${routeH}${route.why ? `; ${String(route.why).slice(0, 80)}` : ''}), not the World Daemon exit the split is priced on (${runH.toFixed(2)}h here, best ${Math.round(best.frac * 100)}% ${best.hours.toFixed(2)}h)`
    const legs = Array.isArray(route.moneyLegs) ? route.moneyLegs.filter(Boolean) : []
    if (!legs.length) return done(s0, 'route-hold', `route hold ${Math.round(s0 * 100)}%: ${head} — its exit reads no batcher stream, so no split moves it; not switching`, { route })
    if (pending) return done(state.target, 'pending', `waiting for batch.js to apply ${Math.round(state.target * 100)}% (published ${((nowMs - state.targetAt) / 6e4).toFixed(1)} min ago; route money)`)
    const top = snap(P.maxFrac)
    const to = snap(Math.min(top, s0 + P.stepMax))
    if (s0 >= top - 1e-9) return done(s0, 'route-hold', `route hold ${Math.round(s0 * 100)}%: ${head} — it reads income (${legs.join('; ')}) and no exp: at the money end`, { route })
    if (seg && dwellLeftMs > 0) return done(s0, 'route-hold', `route hold ${Math.round(s0 * 100)}% for the dwell (${(dwellLeftMs / 6e4).toFixed(1)} min): ${head} — it reads income (${legs.join('; ')}) and no exp, so money dominates; stepping to ${Math.round(to * 100)}% after the dwell`, { route })
    return done(to, 'route-money', `route money: ${Math.round(s0 * 100)}% -> ${Math.round(to * 100)}%: ${head} — it reads income (${legs.join('; ')}) and no exp: the money end dominates (not priced: monotone)`, { route })
  }

  // ---- 6. the posterior's draws: the money and farm streams' principal
  // axes, two sigma points each ------------------------------------------
  const draws = []
  for (const [key] of [STREAMS[0], STREAMS[1]]) for (const p of sigmaPoints(fit[key]).slice(0, 2)) draws.push({ ...th, [key]: p })

  // ---- 7. exploit -----------------------------------------------------------
  // The hysteresis is on the WHOLE attainable gain (to the optimum, every
  // step's retarget paid), the step limit only paces the path: a per-step
  // hysteresis stops on a flat surface where each 15% step gains < 1 min and
  // the path gains several (SC1: stuck at 25% of a 90% optimum).
  // And the gain must stand CLEAR OF THE POSTERIOR'S OWN SPREAD (zGain x its
  // sd over the draws): acting on the mean where the draws disagree by more
  // than the gain chases the calibration's bias — SC1 at first walked
  // 55 -> 60 -> 55 -> 60 on a 0.3-min true difference that the shrunk tilt
  // priced at 1.9 min.
  const toward = (s) => snap(s0 + Math.max(-P.stepMax, Math.min(P.stepMax, s - s0)))
  const s1 = toward(best.frac)
  const h1 = hOf(s1) ?? H(th, s1)
  const c1 = costOf(th, s1)
  const nSteps = Math.ceil(Math.abs(best.frac - s0) / P.stepMax - 1e-9)
  const pathGain = runH - best.hours - nSteps * c1
  const gain = num(h1) ? runH - h1 - c1 : -Infinity
  let sdGain = 0
  if (s1 !== s0) {
    const gs = draws.map((t) => {
      const a = H(t, s0)
      const z = H(t, best.frac)
      return num(a) && num(z) ? a - z : null
    }).filter(num)
    const g0 = runH - best.hours
    sdGain = gs.length ? Math.sqrt(gs.reduce((acc, g) => acc + (g - g0) ** 2, 0) / gs.length) : 0
  }
  const sure = pathGain - P.zGain * sdGain

  // THE DWELL IS PRICED, not a fixed wait (live 17:53Z: it held 0% for a
  // published 41 min while the controller priced 20% 4.1h sooner). Waiting
  // the rest of the dwell at s0 instead of moving costs that wait's share of
  // progress at the gap — waitH x (1 - H(best)/H(s0)), the same progress-
  // fraction composition as the retarget cost (an approximation, NOT
  // simulated); the measurement it waits for is worth at most what it could
  // change, the gain's posterior sd. The dwell stands only while that value
  // exceeds its cost and the gain is not already clear of the uncertainty
  // band; otherwise the exploit below acts now (step limit and all).
  const waitH = num(dwellLeftMs) ? dwellLeftMs / 3.6e6 : 0
  const dwellCostH = s1 !== s0 && num(best.hours) && runH > 0 ? waitH * Math.max(0, 1 - best.hours / runH) : 0
  const dwellPriced = { waitMin: Math.round(waitH * 600) / 10, bucketsLeft, costMin: Math.round(dwellCostH * 600) / 10, valueMin: Math.round(sdGain * 600) / 10, gainMin: Math.round(pathGain * 600) / 10, sureMin: Math.round(sure * 600) / 10 }
  const dwellOverride = s1 !== s0 && pathGain > hyst && num(h1) && h1 < runH && (sure > hyst || dwellCostH > sdGain)
  published.dwell = { ...dwellPriced, overridden: dwellOverride && dwellLeftMs > 0 }
  // The start goes straight to the posterior's optimum — calibrated by the
  // earlier lives' measurements, the model where there are none — on the
  // exploit's confidence rule (gain clear of the posterior's sd), so a model
  // the plant has not delivered yet cannot move it far (live BN12 16:52Z: the
  // open loop went 25% -> 100% on a fresh life's model at k 0.9 while
  // batch.txt still read $0/s).
  if (starting && best.frac !== s0) {
    const g0 = runH - best.hours
    if (g0 - P.zGain * sdGain > hyst) return done(best.frac, 'start', `start: ${Math.round(s0 * 100)}% -> ${Math.round(best.frac * 100)}% — the running split is not one this controller chose this life (a life's opening, or batch.js restarted); the posterior's optimum (${state.obs.length} measured segment(s) carried) ${best.hours.toFixed(2)}h vs ${runH.toFixed(2)}h, +-${(sdGain * 60).toFixed(1)} min`, { gainH: g0, sdGainH: sdGain })
  }
  if (pending) return done(state.target, 'pending', `waiting for batch.js to apply ${Math.round(state.target * 100)}% (published ${((nowMs - state.targetAt) / 6e4).toFixed(1)} min ago)`)
  if (!seg) return done(s0, 'dwell', `no measurement segment on the running ${Math.round(s0 * 100)}% yet (batch.js splitMeasure on ${measure?.frac ?? 'none'})`)
  if (dwellLeftMs > 0 && !dwellOverride) return done(s0, 'dwell', `dwell: ${(dwellLeftMs / 6e4).toFixed(1)} min left on ${Math.round(s0 * 100)}% (${seg.settled ? `settled, ${seg.n}/${P.minBuckets} buckets` : `ramping ${Math.round(segAgeMs / 6e4)} min`}, ${Math.round(splitAgeMs / 6e4)} min on this split${oscillating ? `, x${damp} oscillation damping` : ''}); best now ${Math.round(best.frac * 100)}% ${best.hours.toFixed(2)}h vs ${runH.toFixed(2)}h — waiting costs ${(dwellCostH * 60).toFixed(1)} min, the measurement could move the gain ${(sdGain * 60).toFixed(1)} min`)
  if (dwellLeftMs > 0 && dwellOverride) return done(s1, 'exploit', `exploit (dwell priced out): ${Math.round(s0 * 100)}% -> ${Math.round(s1 * 100)}% toward ${Math.round(best.frac * 100)}% (${best.hours.toFixed(2)}h vs ${runH.toFixed(2)}h here); ${(dwellLeftMs / 6e4).toFixed(1)} min more dwell would cost ${(dwellCostH * 60).toFixed(1)} min of exit against a measurement worth <= ${(sdGain * 60).toFixed(1)} min (gain ${(pathGain * 60).toFixed(1)} min, ${sure > hyst ? 'clear of the uncertainty band' : 'waiting costs more than the band'})`, { gainH: pathGain, sdGainH: sdGain, costH: c1 })

  // A TRIAL RETURNS unless it proved better: an explore move was made for
  // information, not because the mean preferred it, so once its dwell is
  // over the controller goes back to where it came from whenever the mean
  // does not favour staying (no confidence margin: the origin is measured).
  // Without it, exploration ratcheted the split away from the optimum while
  // the confidence margin blocked the way back (SC1: 55 -> 60 -> 65).
  const last = state.switches.length ? state.switches[state.switches.length - 1] : null
  if (last && last.kind === 'explore' && snap(last.to) === s0 && num(last.from)) {
    const hb = hOf(last.from) ?? H(th, last.from)
    const cb = costOf(th, last.from)
    if (num(hb) && hb + cb < runH) return done(last.from, 'return', `return: ${Math.round(s0 * 100)}% -> ${Math.round(last.from * 100)}% — the trial measured, the mean prefers where it came from (${hb.toFixed(3)}h + ${(cb * 60).toFixed(1)} min retarget vs ${runH.toFixed(3)}h here)`, { gainH: runH - hb - cb })
  }
  if (s1 !== s0 && sure > hyst && num(h1) && h1 < runH + hyst) return done(s1, 'exploit', `exploit: ${Math.round(s0 * 100)}% -> ${Math.round(s1 * 100)}% toward the optimum ${Math.round(best.frac * 100)}% (${best.hours.toFixed(2)}h vs ${runH.toFixed(2)}h here, +-${(sdGain * 60).toFixed(1)} min over the posterior; ${nSteps} step(s) of <= ${P.stepMax * 100}% at ${(c1 * 60).toFixed(1)} min retarget each, tau ${Math.round(tauSec / 60)} min); this step ${runH.toFixed(2)}h -> ${h1.toFixed(2)}h`, { gainH: pathGain, sdGainH: sdGain, costH: c1 })

  // ---- 8. explore: the value of SAMPLE information vs a trial's price ------
  // EVPI: the draws' mean regret of staying, each draw's optimum over the
  // whole range on 10% steps (a local window missed a 35% optimum seen from
  // 70%: the draws only disagreed about 60-80%, worth < 1 min — SC1 "from
  // 70%" held there 9.7 min of exit from the truth), each draw's path paid in
  // retargets. It is the value of knowing EXACTLY; one measurement at the trial
  // share only removes the part of that share's predictive variance a
  // measurement can (v / (v + v_new), the larger of money's and the farm's) —
  // so a share already measured is not worth measuring again, which is what
  // ended SC1's explore/exploit ping-pong between two measured neighbours.
  const local = [...new Set([...SPLIT_GRID.filter((s) => s <= P.maxFrac + 1e-9 && Math.round(s * 20) % 2 === 0), ...shares.filter((s) => s <= P.maxFrac + 1e-9 && Math.abs(s - s0) <= P.voiSteps * P.step + 1e-9)].map(snap))]
  let regret = 0
  const votes = new Map()
  for (const t of draws) {
    let bs = s0
    let bh = H(t, s0)
    if (!num(bh)) continue
    const h0 = bh
    for (const s of local) {
      const h = H(t, s)
      if (num(h) && h < bh) {
        bh = h
        bs = s
      }
    }
    if (bs !== s0) {
      const r = h0 - bh - Math.ceil(Math.abs(bs - s0) / P.stepMax - 1e-9) * costOf(th, toward(bs))
      if (r > 0) {
        regret += r
        const dir = Math.sign(bs - s0)
        votes.set(dir, (votes.get(dir) ?? 0) + r)
      }
    }
  }
  const evpi = draws.length ? regret / draws.length : 0
  const dir = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  // THE TRIAL: in the direction the draws' regret points, the share within
  // one step limit whose measurement is worth most net of its price — the
  // nearest UNMEASURED share, in effect: a neighbour already measured has
  // little left to learn (SC1 seed 11 re-probed a measured 40% every 35 min
  // while the uncertainty that mattered was about 55-65%).
  const vNew = P.obsFloorSd ** 2 + P.newSeSd ** 2
  const stayH = (P.dwellMs * damp) / 3.6e6
  const voi = { evpiH: evpi, draws: draws.length, trial: null }
  let pick = null
  for (let k = 1; dir && k * P.step <= P.stepMax + 1e-9; k++) {
    const t = snap(s0 + dir * k * P.step)
    if (t < 0 || t > P.maxFrac + 1e-9) break
    const learnable = Math.max(...['money', 'farmExp'].map((key) => {
      const v = predVar(fit[key], t)
      return v > 0 ? v / (v + vNew) : 0
    }))
    const ht = hOf(t) ?? H(th, t)
    const price = num(ht) ? stayH * Math.max(0, 1 - runH / ht) + 2 * costOf(th, t) : Infinity
    const net = evpi * learnable - price
    if (!pick || net > pick.net) pick = { trial: t, learnable, valueH: evpi * learnable, priceH: price, net, ht }
  }
  if (pick) {
    Object.assign(voi, { trial: pick.trial, learnable: pick.learnable, valueH: pick.valueH, priceH: pick.priceH })
    if (pick.net > P.exploreMinH * damp) return done(pick.trial, 'explore', `explore: ${Math.round(s0 * 100)}% -> ${Math.round(pick.trial * 100)}% — a measurement there could move the optimum (value ${(pick.valueH * 60).toFixed(1)} min = knowing ${(evpi * 60).toFixed(1)} x ${(pick.learnable * 100).toFixed(0)}% learnable > trial ${(pick.priceH * 60).toFixed(1)} min); exit ${runH.toFixed(2)}h here, ${pick.ht.toFixed(2)}h there at the mean`, { voi, gainH: pathGain, sdGainH: sdGain, costH: c1 })
  }
  return done(s0, 'hold', `hold ${Math.round(s0 * 100)}%: exit ${runH.toFixed(2)}h; best ${Math.round(best.frac * 100)}% ${best.hours.toFixed(2)}h — the path there gains ${num(pathGain) ? (pathGain * 60).toFixed(1) : '?'} +- ${(sdGain * 60).toFixed(1)} min after ${nSteps} retarget(s) of ${(c1 * 60).toFixed(1)} min (needs ${P.zGain} sd clear of ${(hyst * 60).toFixed(1)}); value of a measurement ${((voi.valueH ?? 0) * 60).toFixed(1)} min`, { voi, gainH: pathGain, sdGainH: sdGain, costH: c1 })
}

/**
 * HEALTH of the published controller (/tel/expfarm.txt `control`), for
 * tools/healthcheck.mjs. Returns [{what, detail}] problems (empty = fine).
 * `batch` is batch.txt (for the meter's presence while the farm runs).
 */
/**
 * THE COMMITTED ROUTE the split serves, from the plan record (/tel/plan.txt,
 * the previous pass; decisions.bladeRoute is the ACTED key, the route pin
 * applied). Same node only. Returns null on the hacking route (or unread),
 * else {key, exitH, hackH, why, moneyLegs}: the legs through which the
 * route's exit reads income, each a reason —
 *   lean.routeBuy     the full daemon's home purchase, paid from income
 *                     (homeplan.routeFullAtOf: buyAtH moves with the income)
 *   simulacrum        The Blade's Simulacrum within reach of a 20x income
 *                     (its money leg / 20 inside the exit): the split moves
 *                     the income by far less, so beyond that it cannot matter
 */
export function committedRouteOf(plan, { node = null } = {}) {
  const br = plan?.decisions?.bladeRoute ?? null
  if (!br || br.key !== 'blade') return null
  if (num(plan.node) && num(node) && plan.node !== node) return null
  const exitH = num(br.bladeH) ? br.bladeH : null
  const legs = []
  const rb = br.lean?.routeBuy ?? null
  if (rb && (num(rb.buyAtH) || num(rb.cost))) legs.push(`the full daemon's home purchase (${num(rb.cost) ? `$${(rb.cost / 1e9).toFixed(2)}b` : '?'}, at ${num(rb.buyAtH) ? `${rb.buyAtH.toFixed(2)}h` : '?'})`)
  const sim = br.simulacrum ?? null
  if (sim && sim.buy !== true && num(sim.moneyH) && sim.moneyH > 0 && num(sim.withoutH) && sim.moneyH / 20 < sim.withoutH) legs.push(`The Blade's Simulacrum's money (${sim.moneyH.toFixed(1)}h at this income, exit ${sim.withoutH.toFixed(1)}h)`)
  return { key: 'blade', exitH, hackH: num(br.hackH) ? br.hackH : null, why: `black ops ${exitH === null ? '?' : exitH.toFixed(2)}h vs the World Daemon ${num(br.hackH) ? br.hackH.toFixed(2) : '?'}h`, moneyLegs: legs }
}

export function splitHealth(rec, batch) {
  const out = []
  if (batch?.expFarm && !batch.splitMeasure) out.push({ what: 'SPLIT UNMEASURED: batch.js runs the farm but publishes no splitMeasure', detail: 'the money/exp split runs open-loop — batch.js predates the closed loop (restart it)' })
  const c = rec?.control
  if (!c) return out
  // A route hold makes no switches: the reversals still in the window are
  // the pricing on the wrong exit before it, ageing out — not oscillation now.
  if (c.oscillating && !String(c.kind ?? '').startsWith('route-')) out.push({ what: `SPLIT OSCILLATING: ${c.reversals3h} direction reversals and ${c.probes3h ?? 0} probe(s) in ${c.switches3h} switches over 3h`, detail: `last: ${JSON.stringify(c.lastSwitch ?? null).slice(0, 200)}` })
  if (Array.isArray(c.diverged) && c.diverged.length) out.push({ what: `SPLIT MODEL OFF: ${c.diverged.join('; ')}`, detail: 'the controller prices on the measurement, but the model (expfarm.moneyModelOf / farmHoldGB) is beyond the BN1 tolerance — fix the model, every other consumer of it is wrong by as much' })
  return out
}
