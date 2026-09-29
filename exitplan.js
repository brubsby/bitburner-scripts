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

// Pure: the serve-or-farm decision the batcher makes (prices openers' manipulation).
import { serveOrFarm } from 'expfarm.js'
import { cadencePosterior } from 'bayes.js'
import { capitalFV } from 'hacknetplan.js'
import { drain } from 'coop.js'
import { capitalOf, isShaped, capitalEarnAt, capitalRateAt, capitalGain, capitalStepFn, rateTab } from 'traderw.js'

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

// ---------------------------------------------------------------------------
// THE EXP RATE RISES WITH THE LEVEL (inputs.expScalesWithLevel).
//
// A thread's exp is fixed per op (Hacking.ts:30-38: (3 + 0.3 baseDifficulty) x
// hacking_exp x HackExpGain) and an op lasts a time proportional to
// 1 / (level + 50) (Hacking.ts:60-81), so a fleet of fixed RAM on its best exp
// target earns exp at a rate proportional to (level + 50) — freshlife.js
// simulates it, and at constant RAM its rate tracks (L + 50) to <1% (BN9 inputs:
// 462 -> 501 exp/s from level 200 to 222, (272/250) = 1.088). The constant
// rate the exit used was the rate AT TODAY'S LEVEL applied from level 1 after
// every install: too fast at the bottom of a fresh life (the measured
// "fresh-life lag" patched that) and far too slow at the top — the climb to
// hacking 6000 ran at the level-200 rate. `rateAt(level)` gives exp/s at a
// (continuous) level; the level follows the exp by calculateSkill (skill.ts:7).
// ---------------------------------------------------------------------------

/** The continuous level of an exp at a multiplier (calculateSkill without the floor). */
const contLevel = (exp, mult) => mult * (32 * Math.log(Math.max(0, exp) + 534.6) - 200)
const EXP_CHUNK = 0.01 // level chunk: 1% of (level + 50)
const EXP_ITER_CAP = 5000

// ---------------------------------------------------------------------------
// THE CLIMB IN CLOSED FORM. The chunked integration below (chunks of 1% of
// (level + 50), up to 5000 per call) was the plan's hot spot: live BN9
// 2026-09-29 13:44 one exit simulation took up to 318ms of synchronous work
// and the Monte Carlo stopped at 3 of 24 draws (tools/sim/climbprof.mjs: the
// two chunk loops were ~60% of an exit simulation's CPU). The rate every
// caller builds is AFFINE in the level — expRateShape's F + k (max(1, L) + 50),
// plus a sleeve's constant — and for that rate the time is an exponential
// integral. With u = E + 534.6 = exp((L/M + 200)/32) and r = F + k (L + 50):
//
//   dt = dE / r = u dL / (32 M r),  x = r / a,  a = 32 M k
//   t(L) = u(L) g(x(L)) / a  (+ const),   g(x) = e^-x Ei(x)
//
// (d/dL of u g / a is u/(32 M a) (g + 1/x - g) = u / (32 M r)). k = 0 is the
// constant rate, dE / F. Below level 1 (a multiplier under ~1.0013 at zero
// exp) the rate is clamped at max(1, L): constant there. A rateAt that is not
// tagged affine (rateAt.affine = {F, k}) keeps the chunked integration, which
// is also the reference the closed form is tested against ([FL8]).
// ---------------------------------------------------------------------------

const EULER_GAMMA = 0.5772156649015329
/** g(x) = e^-x Ei(x), x > 0: the power series below 40, the asymptotic series above (error < 1e-16 either side). */
export function eiScaled(x) {
  if (!(x > 0)) return NaN
  if (x >= 40) {
    let term = 1
    let sum = 1
    for (let n = 1; n < 80; n++) {
      const next = (term * n) / x
      if (next >= term || next < 1e-17 * sum) break
      term = next
      sum += term
    }
    return sum / x
  }
  let term = 1
  let sum = 0
  for (let n = 1; n < 500; n++) {
    term *= x / n
    const add = term / n
    sum += add
    if (add < 1e-17 * sum) break
  }
  return (EULER_GAMMA + Math.log(x) + sum) * Math.exp(-x)
}

/** Tag a rate function as affine in the level: rate(L) = F + k (max(1, L) + 50). */
export function affineRate(F, k) {
  const f = (level) => F + k * (Math.max(1, level) + 50)
  f.affine = { F, k }
  return f
}
const affineOf = (rateAt) => {
  const a = rateAt?.affine
  return a && num(a.F) && num(a.k) && a.F >= 0 && a.k >= 0 && a.F + a.k > 0 ? a : null
}

/**
 * The closed-form clock for an affine rate at a multiplier: T(E) seconds up to
 * an additive constant, and its inverse. null where the numbers leave doubles
 * (the caller falls back to the chunks, which overflow the same way).
 */
function affineClock(mult, { F, k }) {
  const E1 = mult < 1.0013 ? expForLevel(1, mult) : 0 // below E1 the clamped level: constant rate
  const r1 = F + 51 * k
  if (k === 0) return { T: (E) => E / F, E1: 0, r1: F, inv: (T) => T * F }
  const a = 32 * mult * k
  // Above E1: T(E) = u g(x) / a, x = r(L) / a, u = E + 534.6.
  const Tup = (E) => {
    const u = E + 534.6
    const x = (F + k * (contLevel(E, mult) + 50)) / a
    return (u * eiScaled(x)) / a
  }
  // Continuous across E1: the clamped part runs at r1.
  const TE1 = E1 > 0 ? Tup(E1) : 0
  const T = (E) => (E < E1 ? (E - E1) / r1 + TE1 : Tup(E))
  return { T, Tup, E1, r1, TE1, a }
}

/**
 * Seconds from exp0 to exp `need` at an affine rate (closed form). Returns
 * null when not representable (the caller then chunks).
 */
function affineSeconds(exp0, need, mult, aff) {
  const c = affineClock(mult, aff)
  const t = c.T(need) - c.T(exp0)
  return num(t) && t >= 0 ? t : null
}

/**
 * A SHORT STEP IN CLOSED FORM, or null. With c = 32 M k, u = E + 534.6 and
 * r the rate at E: dr/dE = c/u, so E'' = c r / u, E''' = c r (c - r) / u^2,
 * E'''' = c r (c^2 - 4 c r + 2 r^2) / u^3. In a = c t / u, b = r t / u the
 * step is r t (1 + a/2 + a (a - b)/6 + ...), and the first term left out is
 * r t a (a^2 - 4 a b + 2 b^2) / 24: the step is taken when that is below
 * 1e-6 of it (the reputation leg's ~300 steps then carry < 3e-4 of the exp
 * they add between them, against the 0.5% the climb is held to).
 * The level's clamp at 1 is the caller's (not applied here).
 */
function taylorStep(E, r, sec, mult, k) {
  const u = E + 534.6
  const c = 32 * mult * k
  const a = (c * sec) / u
  const b = (r * sec) / u
  if (!(Math.abs(a * (a * a - 4 * a * b + 2 * b * b)) < 24e-6) || !(a < 0.05) || !(b < 0.05)) return null
  return E + r * sec * (1 + a / 2 + (a * (a - b)) / 6)
}

/**
 * The exp after `sec` seconds from exp0 at an affine rate: the inverse of the
 * clock. A short step (the reputation leg's minutes) is its Taylor series
 * (taylorStep); a longer one is solved on the clock (monotone Newton).
 */
function affineExpAfter(exp0, sec, mult, aff) {
  const { F, k } = aff
  let E = Math.max(0, exp0)
  if (k === 0) return E + F * sec
  let left = sec
  // Below level 1 (a multiplier under ~1.0013 at low exp): the clamped rate.
  if (mult < 1.0013) {
    const E1 = expForLevel(1, mult)
    if (E < E1) {
      const r1 = F + 51 * k
      const need = (E1 - E) / r1
      if (need >= left) return E + r1 * left
      left -= need
      E = E1
    }
  }
  const L = contLevel(E, mult)
  const r = F + k * (Math.max(1, L) + 50)
  const short = taylorStep(E, r, left, mult, k)
  if (short !== null) return short
  const c = affineClock(mult, aff)
  const rAt = (x) => F + k * (Math.max(1, contLevel(x, mult)) + 50)
  const target = c.Tup(E) + left
  if (!num(target)) return null
  // T(E) is CONCAVE (dT/dE = 1/r(E), and r rises with the level): Newton
  // from below the root stays below it and converges monotonically, with no
  // bracket to build (each clock read is an exponential integral: the
  // bracket's doublings were most of a reputation step's cost). E + r t is
  // below the root (the rate only rises).
  // Started from the series (when it is not wild), never below E + r t.
  const u = E + 534.6
  const a = (32 * mult * k * left) / u
  const b = (r * left) / u
  let x = E + r * left
  if (a < 0.3 && b < 0.3) x = Math.max(x, E + r * left * (1 + a / 2 + (a * (a - b)) / 6))
  for (let i = 0; i < 60; i++) {
    const f = c.Tup(x) - target
    if (!num(f)) return null
    const step = -f * rAt(x)
    x += step
    if (Math.abs(step) <= 1e-13 * (x + 534.6) || Math.abs(f) <= 1e-12 * Math.abs(target)) return x
  }
  // Not converged (a step spanning many e-folds of the rate): bisect on the clock.
  let lo = E + r * left
  let hi = Math.max(lo, x)
  for (let i = 0; i < 200 && !(c.Tup(hi) >= target); i++) hi = E + (hi - E) * 2
  if (!(c.Tup(hi) >= target)) return null
  for (let i = 0; i < 200 && hi - lo > 1e-13 * hi; i++) {
    const m = (lo + hi) / 2
    if (c.Tup(m) >= target) hi = m
    else lo = m
  }
  x = (lo + hi) / 2
  return x
}

/**
 * expAfterHours(E, hours, mult, rateAt) for an affine rate whose continuous
 * level at E the caller already holds (L = contLevel(E, mult)): the same
 * second-order step without re-deriving the level, else expAfterHours itself.
 * Bitwise the same result as expAfterHours.
 */
function affineStepFrom(E, L, hours, mult, aff, rateAt) {
  if (!(hours > 0)) return E
  const { F, k } = aff
  const sec = hours * 3600
  if (k === 0 || E < 0 || mult < 1.0013) return expAfterHours(E, hours, mult, rateAt)
  const r = F + k * (Math.max(1, L) + 50)
  const short = taylorStep(E, r, sec, mult, k)
  return short !== null ? short : expAfterHours(E, hours, mult, rateAt)
}

/**
 * Hours from `exp0` to the exp of `level` when the rate is `rateAt(level)`.
 * An affine rate (expRateShape's, rateAt.affine) in closed form; any other
 * rate in chunks of 1% of (level + 50), each at its mid-level rate. Infinity
 * when the rate is zero on the way; null on bad input.
 */
export function hoursToLevelShaped(level, mult, exp0, rateAt) {
  if (!pos(mult) || !num(exp0) || exp0 < 0 || typeof rateAt !== 'function') return null
  const need = expForLevel(level, mult)
  if (need <= exp0) return 0
  const aff = affineOf(rateAt)
  if (aff) {
    const s = affineSeconds(exp0, need, mult, aff)
    if (s !== null) return s / 3600
  }
  return hoursToLevelChunked(level, mult, exp0, rateAt)
}

/** The chunked climb (the reference; the path for a rate that is not affine). */
export function hoursToLevelChunked(level, mult, exp0, rateAt) {
  if (!pos(mult) || !num(exp0) || exp0 < 0 || typeof rateAt !== 'function') return null
  const need = expForLevel(level, mult)
  if (need <= exp0) return 0
  let E = exp0
  let t = 0
  for (let it = 0; E < need && it < EXP_ITER_CAP; it++) {
    const l = contLevel(E, mult)
    const dl = Math.max(0.5, EXP_CHUNK * (l + 50))
    const E2 = Math.min(need, expForLevel(l + dl, mult))
    const r = rateAt(l + dl / 2)
    if (!(r > 0)) return Infinity
    t += Math.max(0, E2 - E) / r
    E = Math.max(E2, E + 1e-9)
  }
  return E >= need ? t / 3600 : Infinity
}

/** The exp after `hours` at `rateAt(level)`, from `exp0`: closed form for an affine rate, else the chunks. */
export function expAfterHours(exp0, hours, mult, rateAt) {
  if (!(hours > 0) || !pos(mult) || typeof rateAt !== 'function') return exp0
  const aff = affineOf(rateAt)
  if (aff) {
    const e = affineExpAfter(exp0, hours * 3600, mult, aff)
    if (num(e)) return e
  }
  return expAfterHoursChunked(exp0, hours, mult, rateAt)
}

/** The chunked exp after `hours` (the reference; the last chunk partial). */
export function expAfterHoursChunked(exp0, hours, mult, rateAt) {
  if (!(hours > 0) || !pos(mult) || typeof rateAt !== 'function') return exp0
  let E = Math.max(0, exp0)
  let left = hours * 3600
  for (let it = 0; left > 0 && it < EXP_ITER_CAP; it++) {
    const l = contLevel(E, mult)
    const dl = Math.max(0.5, EXP_CHUNK * (l + 50))
    const E2 = expForLevel(l + dl, mult)
    const r = rateAt(l + dl / 2)
    if (!(r > 0)) return E
    const need = Math.max(0, E2 - E) / r
    if (need >= left) return E + r * left
    left -= need
    E = Math.max(E2, E + 1e-9)
  }
  return E
}

/**
 * The exp-rate shape an exit run uses: constant (the old model, and the
 * default) or rising with the level. `rate` is the rate at the reference
 * level `ref` (today's), `flat` the part that does not move with the level
 * (the sleeves' exp transfer). Returns rateAt(level), tagged affine
 * (rateAt.affine = {F, k}) so the climb runs in closed form.
 */
export function expRateShape(rate, { scales = false, ref = null, flat = 0 } = {}) {
  const R = pos(rate) ? rate : 0
  if (!scales || !pos(ref)) return affineRate(R, 0)
  const F = Math.min(R, pos(flat) ? flat : 0)
  const k = (R - F) / (ref + 50)
  return affineRate(F, k)
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
  // BITNODE 8 TERMS (nodeecon.incomeOf), each defaulting to "absent", so every
  // other node integrates exactly what it always did:
  //   flatPerSec           income that does not move with the hacking level
  //   capitalReturnPerSec  the stock trader's measured return, paid as
  //                        r x min(money, capitalCap). It COMPOUNDS on the
  //                        balance being integrated — after an install it
  //                        restarts from the post-install balance, not from
  //                        today's $/s — which is why it cannot be a rate.
  const flat = num(o.flatPerSec) && o.flatPerSec > 0 ? o.flatPerSec : 0
  const r = num(o.capitalReturnPerSec) && o.capitalReturnPerSec > 0 ? o.capitalReturnPerSec : 0
  const cap = num(o.capitalCap) && o.capitalCap > 0 ? o.capitalCap : Infinity
  // THE RETURN DEPENDS ON THE BOOK (traderw.js): with capitalScaleW /
  // capitalShape the capital earns r0 s(W) W — nothing below the commission
  // threshold, the plateau, then the market's capacity — not r x min(W, cap).
  // Absent, capitalGain is exactly the flat closed form below.
  const capC = capitalOf(o)
  const shapedCap = r > 0 && isShaped(o)
  // MONEY GOING OUT EVERY SECOND (o.spendPerSec): class and gym fees, which
  // the game charges through loseMoney with no balance check
  // (Work/Formulas.ts calculateClassEarnings: money = -cost x costMult per
  // second). It slows every money leg, and a balance that the spend drives to
  // zero with nothing coming in never reaches its target (Infinity).
  const spend = num(o.spendPerSec) && o.spendPerSec > 0 ? o.spendPerSec : 0
  // THE TRADER'S WARM-UP (o.capitalWarmupH): hours from the leg's start during
  // which the capital earns nothing — after an install the market is
  // re-initialised and the estimator relearns (nodeecon.fitCapital).
  const warmH = num(o.capitalWarmupH) && o.capitalWarmupH > 0 ? o.capitalWarmupH : 0
  const lvlIncome = num(incomeAtLevel1) && incomeAtLevel1 > 0 ? incomeAtLevel1 : 0
  let stepH = o.stepH ?? 1 / 120
  if (!num(target) || target <= money0) return 0
  if (!(lvlIncome > 0 || flat > 0 || r > 0) || !pos(mult) || !num(exp0)) return null
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
    const r0 = (lvlIncome * (lvl0 + 50)) / 51 + flat + (typeof extraAt === 'function' ? extraAt(0) : 0) + capitalEarnAt(Math.max(0, money), capC)
    const est = r0 > 0 ? (target - money) / r0 / 3600 : maxHours
    stepH = Math.max(stepH, Math.min(maxHours, est) / 200)
    // A compounding balance must not be stepped past ~2% growth: the linear
    // estimate above over-states an exponential leg by orders of magnitude,
    // and a step of 2/r is not an integration of e^rt. (4000 steps of 2%
    // still span e^80.) The iteration cap keeps its meaning: maxHours/4000.
    if (r > 0 && !shapedCap) stepH = Math.min(stepH, Math.max(0.02 / (r * 3600), maxHours / 4000))
    // ...but maxHours/4000 is 2.5h, which let every ordinary leg take 2.5h
    // steps — ~x6 of growth, with the level-scaled income held at its
    // start-of-step value and the warm-up rounded up to a step. So the step
    // is also bounded by 1/100 of the leg's COMPOUNDING length ln(T/m)/r
    // (never below the 2% step): a leg of hours takes ~100 steps, and only
    // a leg too long for that still takes the coarse step.
    if (r > 0 && !shapedCap && money > 0 && target > money) stepH = Math.min(stepH, Math.max(0.02 / (r * 3600), Math.log(target / money) / (r * 3600) / 100))
  }
  // THE SAME BOUNDS ON A CURVE. r(W) spans x40 from $1e11 to $1e13, so one
  // rate for the leg either crawls (the plateau's 2% on a saturated book) or
  // overshoots (the saturated rate on the plateau). The leg's compounding
  // length is the integral of dlnW / r(W) (16 points in log W, once per leg;
  // the flat rate's ln(T/m)/r), and 1/100 of it bounds the step as for the
  // flat rate — and each step is also held to <= 25% growth at the book's
  // CURRENT rate, so the plateau is stepped finely and the saturated tail
  // coarsely. A book below the commission threshold earns nothing until the
  // other income carries it over: its rate is read just past the threshold,
  // so one income-sized step cannot leave it idle for the leg's 1/200th (a
  // 50h step at $1m read 248h against 204h with a 0.013h warm-up).
  const gateW = shapedCap && pos(capC.sh?.Wmin) ? capC.sh.Wmin * 1.0001 : 0
  let legH = stepH
  if (shapedCap && target > money) {
    const la = Math.log(Math.max(money, gateW, 1))
    const lb = Math.log(target)
    let len = 0
    let rMax = 0
    if (lb > la) {
      const K = 16
      const d = (lb - la) / K
      for (let k = 0; k < K; k++) {
        const W = Math.exp(la + (k + 0.5) * d)
        const rn = capC.tab ? rateTab(capC, W) : capitalRateAt(W, capC)
        if (rn > rMax) rMax = rn
        len += d / Math.max(rn, 1e-15)
      }
    }
    if (rMax > 0) legH = Math.min(stepH, Math.max(0.02 / (rMax * 3600), len / 3600 / 50))
  }
  let rNow = 0 // the book's rate at the step's start (stepAt sets it; capitalGain reuses it)
  const stepAt = (m) => {
    rNow = !(m > 0) ? 0 : capC.tab ? rateTab(capC, m) : capitalRateAt(m, capC)
    const rn = m < gateW ? capitalRateAt(gateW, capC) : rNow
    return rn > 0 ? Math.min(legH, 0.25 / (rn * 3600)) : legH
  }
  let iter = 0
  while (h < maxHours && iter++ < 4000) {
    const lvl = levelAt(exp, mult)
    // income(level) = incomeAtLevel1 * (level + 50) / 51
    const rate = (lvlIncome * (lvl + 50)) / 51 + flat + (typeof extraAt === 'function' ? extraAt(h) : 0)
    // THE WARM-UP ENDS ON ITS HOUR, not on the next step boundary: a 2.5h
    // step starting inside a 0.16h warm-up earned no capital for all of it
    // (live BN8 2026-09-26: the $250m -> $100b hoard read 10.25h against
    // 8.66h). The step is cut at the warm-up's end; no capital, no cut.
    // Below the commission threshold the step ends where the income carries
    // the book over it: the capital starts then, not a step later.
    // (Income-driven growth is not step-bounded, as for the flat rate: the
    // capital misses the income arriving inside a step — <= 2% on a leg,
    // tools/test/traderrw.test.mjs RW3, the flat rate's own 1.7%.)
    let stepNow = stepH
    if (shapedCap) {
      stepNow = stepAt(money)
      const inc = rate - spend
      if (inc > 0 && money < gateW) stepNow = Math.min(stepNow, Math.max(1e-4, (gateW - money) / inc / 3600))
    }
    const sH = r > 0 && h < warmH && warmH - h < stepNow ? warmH - h : stepNow
    const dt = sH * 3600
    // The capital term over the step: exponential below the cap, linear at
    // it (traderw.capitalGain; on a curve, at the step's midpoint rate).
    const capGain = !(r > 0 && h >= warmH) ? 0 : shapedCap ? capitalGain(money, dt, capC, rNow) : money < cap ? Math.min(money * Math.expm1(r * dt), cap - money + r * cap * dt) : r * cap * dt
    // A landing bisected inside a curved step reads the step's own rate (traderw.capitalStepFn).
    // The flat rate's own closed form otherwise (no capital in the warm-up).
    const stepFn = () => (!(r > 0 && h >= warmH) ? () => 0 : shapedCap ? capitalStepFn(money, dt, capC, rNow) : money < cap ? (x) => Math.min(money * Math.expm1(r * x), cap - money + r * cap * x) : (x) => r * cap * x)
    const add = rate * dt + Math.max(0, capGain) - spend * dt
    if (!(add > 0) && money + add <= 0) return Infinity // the spend empties the balance first
    // The last step lands exactly: without this the answer is quantised to
    // stepH, and a with/without comparison of a small spend reads as zero
    // (or as a whole step) — noise deciding purchases.
    //
    // o.targetAt(h) (optional): a target that FALLS while the money is saved —
    // a donation shrinking as faction work earns the same reputation
    // (hoursToRep, workWhileDonating). Landed by solving the step linearly.
    if (typeof o.targetAt === 'function') {
      const T0 = o.targetAt(h)
      const T1 = o.targetAt(h + sH)
      if (money >= T0) return h
      if (add > 0 && money + add >= T1) {
        if (!(capGain > 0)) return h + Math.min(1, Math.max(0, (T0 - money) / (add + T0 - T1))) * sH
        // Compounding: land on the curve against the falling target (below).
        const stepGain = stepFn()
        let lo = 0
        let hi = dt
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2
          const c = stepGain(mid)
          if (money + rate * mid + Math.max(0, c) - spend * mid >= o.targetAt(h + mid / 3600)) hi = mid
          else lo = mid
        }
        return h + hi / 3600
      }
    } else if (add > 0 && money + add >= target) {
      // A COMPOUNDING STEP LANDS ON ITS CURVE, not on the chord. The step is
      // up to maxHours/4000 = 2.5h, over which a balance at the trader's
      // ~0.7/h return grows ~x6; interpolating that linearly put the landing
      // up to most of a step early — 8.03h for $250m -> $100b against the
      // exact ln(400)/r = 8.50h (live BN8 inputs, 2026-09-26), and a leg
      // split in two (a graft paid on the way) read ~3h SHORTER than the same
      // money in one leg. Bisected on the same step expression; a step with
      // no capital term is linear and keeps the exact chord. Defence in
      // depth since the step bound above (1/100 of the leg): with it the
      // chord's error is ~1e-3h, so [GP10] pins the bound, not this.
      if (!(capGain > 0)) return h + ((target - money) / add) * sH
      const stepGain = stepFn()
      const addOver = (s) => {
        const c = stepGain(s)
        return rate * s + Math.max(0, c) - spend * s
      }
      let lo = 0
      let hi = dt
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2
        if (money + addOver(mid) >= target) hi = mid
        else lo = mid
      }
      return h + hi / 3600
    }
    money += add
    // o.expRateAt(level): the exp rate rising with the level (expRateShape),
    // at the step's opening level; absent, the constant rate.
    exp += typeof o.expRateAt === 'function' ? Math.max(0, o.expRateAt(lvl)) * dt : pos(expPerSec) ? expPerSec * dt : 0
    h += sH
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
  //
  // ZERO IS A THRESHOLD, not an absence: BitNode 8 sets
  // FavorToDonateToFaction = 0 (BitNode.tsx:776), so every faction accepts
  // donations from favor 0. This read `pos(favorToDonate)` and so priced every
  // BN8 reputation leg as a grind while the node sold it for money.
  const { rep0 = 0, repPerSec, donationCost = null, favor = 0, favorToDonate = null, moneyLeg = null } = o
  if (!num(target) || target <= rep0) return { hours: 0, how: 'already held' }
  if (num(favorToDonate) && favorToDonate >= 0 && favor >= favorToDonate && pos(donationCost) && typeof moneyLeg === 'function') {
    // WORK WHILE SAVING (o.workWhileDonating): the work slot keeps earning
    // the same reputation while the money is saved, so the donation still
    // owed at hour t is cost x (1 - rep earned by t / need) and the leg ends
    // when the money meets it — never later than grinding alone. The work
    // is the player's (from o.slotFreeAt, when something else holds the slot
    // first, e.g. a karma grind) plus a sleeve's (o.sleeveRepPerSec, not
    // slot-bound). Off unless the caller asks, so a node where the route
    // opens only at 150 favor prices as it always did.
    const P = o.workWhileDonating === true && pos(repPerSec) ? repPerSec : 0
    const S = o.workWhileDonating === true && pos(o.sleeveRepPerSec) ? o.sleeveRepPerSec : 0
    if (P > 0 || S > 0) {
      const need = target - rep0
      const free = num(o.slotFreeAt) && o.slotFreeAt > 0 ? o.slotFreeAt : 0
      const earned = (t) => (P * Math.max(0, t - free) + S * t) * 3600
      const targetAt = (t) => donationCost * Math.max(0, 1 - earned(t) / need)
      const h = moneyLeg(donationCost, targetAt)
      if (num(h)) return { hours: h, how: `donated the remainder after ${Math.round(earned(h))} rep of work (of $${Math.round(donationCost)})` }
    }
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

/**
 * THE GRAFT SCHEDULE OF THE LIVES BEFORE THE FINAL WINDOW, against one
 * policy's install count: o.lifeGrafts is [{life, ...graftSpecOf}] with life 1
 * the current life (it ends at the next install). Lives 1..installsFirst come
 * before the final window; a graft scheduled in a later life than the policy
 * has is grafted in the final window instead (`spill`, in schedule order,
 * ahead of finalGrafts). Returns {byLife: Map<life, specs>, spill, lastLife,
 * bad} — `bad` names an unreadable entry (a refusal, not a skip).
 */
export function lifeGraftsOf(list, installsFirst) {
  const byLife = new Map()
  const spill = []
  let lastLife = 0
  if (!Array.isArray(list) || !list.length) return { byLife, spill, lastLife, bad: null }
  const rows = list.map((x, idx) => ({ x, idx }))
  for (const { x } of rows) if (!x || !Number.isInteger(x.life) || x.life < 1) return { byLife, spill, lastLife, bad: `life graft ${x?.name ?? '?'} has no life index (an integer >= 1)` }
  rows.sort((a, b) => a.x.life - b.x.life || a.idx - b.idx)
  for (const { x } of rows) {
    if (x.life > installsFirst) {
      spill.push(x)
      continue
    }
    if (!byLife.has(x.life)) byLife.set(x.life, [])
    byLife.get(x.life).push(x)
    lastLife = Math.max(lastLife, x.life)
  }
  return { byLife, spill, lastLife, bad: null }
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
    // The exit faction's hacking requirement for the INVITATION (Daedalus:
    // haveSkill hacking 2500, FactionInfo.tsx), which must hold at the same
    // time as the money in hand: the reputation leg cannot start before it.
    joinLevel = 0,
    // AFTER THE TERMINAL INSTALL (The Red Pill must be INSTALLED before
    // w0r1d_d43m0n exists, ServerHelpers.ts:342): money is reset to the
    // node's post-install balance and every program with it, and the daemon
    // needs 5 open ports (servers.ts: numOpenPortsRequired 5) — finalRootCost
    // is what re-buying the openers (and TOR) costs, priced from installCash
    // at the trader's return, concurrent with the climb. freshExpLagH: the
    // MEASURED ramp of a fresh life's exp (hours behind a constant rate while
    // the fleet is re-rooted and only low targets are hackable).
    finalRootCost = 0,
    freshExpLagH = 0,
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
    // WHERE THE MONEY COMES FROM (nodeecon.incomeOf), all optional and all
    // "absent" by default so every node but BitNode 8 prices exactly as before:
    //   flatIncomePerSec     the part of incomePerSec that does NOT scale with
    //                        the hacking level (the rest is scripted hacking)
    //   capitalReturnPerSec  the stock trader's measured return on the balance,
    //   capitalCap           paid on min(money, cap) and compounding
    //   installCash          the balance an install leaves: $1262, or BN8's
    //                        $250m (nodeecon.postInstallMoney)
    flatIncomePerSec = 0,
    capitalReturnPerSec = 0,
    capitalCap = null,
    // THE CURVE r(W) (traderw.js): the knee W* and the fixed shape; absent,
    // the flat r x min(W, cap).
    capitalScaleW = null,
    capitalShape = null,
    installCash = null,
    // Money spent every second from now on (class/gym fees): slows every money
    // leg (hoursToMoney spendPerSec). Legs that need no money are unaffected —
    // a spend the exit never has to fund does not delay it; keeping cash from
    // going negative is a floor the spender enforces, not an exit cost.
    spendPerSec = 0,
    // Hours after each install during which the trader's capital earns
    // nothing (nodeecon.fitCapital). Applied to the money legs of the final
    // window only when an install precedes them.
    capitalWarmupH = 0,
    // Hacknet money (nodeecon.incomeOf lifePerSec): NOT part of incomePerSec,
    // and destroyed by the next install — see lifeInc below.
    lifeIncome = null,
    // A MULTIPLIER ON THE EXP RATE THAT THE NEXT INSTALL DESTROYS (an IPvGO
    // hacking_speed bonus, goweights.js): under "hold to the exit" it scales
    // every exp accrual before the terminal install and is gone for the climb
    // after it (Go.prestigeAugmentation zeroes node power, Go/Go.ts:34-47).
    // Under any policy with an install it ends before any leg simulated here,
    // so it does nothing. Default 1: every other caller prices as before.
    preInstallExpMult = 1,
    // THE EXP RATE RISES WITH THE LEVEL (expRateShape): expPerSec is the rate
    // at today's level `hacking`, and every leg integrates it as (level + 50)
    // (freshlife.js, the game's hack/grow/weaken times). expFlatPerSec is the
    // part that does not (the sleeves' exp transfer). Absent: the constant
    // rate, exactly as before.
    expScalesWithLevel = false,
    expFlatPerSec = 0,
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
  // The step in force at t: the last (in sorted order) with atH <= t, by
  // bisection — the money legs ask it every integration step and a simulated
  // gang schedule has ~100 steps (it was a scan, the gang and sleeve
  // decisions' largest cost after the climb).
  const stepAt = (t) => {
    let lo = 0
    let hi = steps.length - 1
    let at = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (steps[m].atH <= t) {
        at = m
        lo = m + 1
      } else hi = m - 1
    }
    return at
  }
  const extraAt = (t) => {
    const i = stepAt(t)
    return i < 0 ? 0 : steps[i].perSec
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
  // Each step's growth factor once, not a power per cycle per policy.
  const growOn = num(eBudget) && eBudget > 0 && pos(incomePerSec)
  const stepGrowth = steps.map((x) => (growOn ? Math.pow((incomePerSec + x.perSec) / incomePerSec, eBudget) : 1))
  const growthAt = (t) => {
    const i = growOn ? stepAt(t) : -1
    return (t >= repFrom ? repLift : 1) * (i < 0 ? 1 : stepGrowth[i])
  }

  // Income is priced when ANY source is measured positive. A node whose only
  // income is the trader's compounding return (BitNode 8: scripted hacking
  // pays ScriptHackMoneyGain = 0) has incomePerSec 0 and is still priceable.
  const flatInc = num(flatIncomePerSec) && flatIncomePerSec > 0 ? flatIncomePerSec : 0
  const capR = num(capitalReturnPerSec) && capitalReturnPerSec > 0 ? capitalReturnPerSec : 0
  // A hold-to-exit run whose only income is hacknet (BitNode 9's opening) is priceable too.
  const incomeOk = num(incomePerSec) && incomePerSec >= 0 && (incomePerSec > 0 || capR > 0 || lifeInc > 0)
  if (!incomeOk || !pos(hacking) || !pos(hackingMult) || !pos(exitLevel)) {
    return { hours: null, why: 'live state unreadable (income, hacking, multiplier or exit level)' }
  }
  if (!num(installsFirst) || installsFirst < 0) return { hours: null, why: 'installsFirst must be >= 0' }
  if (installsFirst > 0 && (!pos(cycleHours) || !pos(multGainPerCycle))) {
    return { hours: null, why: 'no measured cycle length or per-cycle multiplier gain — cannot price an install' }
  }

  // Income at level 1 for THIS fleet, derived from the live pair. Everything
  // downstream of an install starts here, which is what makes the rebuild
  // visible instead of assumed away.
  // Only the level-scaled part: flatIncomePerSec rides beside it unscaled, and
  // hacking_money augmentations (installGains.income) lift this part alone —
  // they do nothing for a stock portfolio.
  let incomeAtLevel1 = (Math.max(0, incomePerSec - flatInc) * 51) / (hacking + 50)
  let repRate = repPerSec
  let donation = donationCost

  const legs = []
  let h = 0
  let mult = hackingMult
  let exp = hackingExp
  let cash = money

  // ONE LIFE'S GRAFTS, before the final window (lifeGrafts): the life first
  // earns the grafts' price from its opening balance (a money leg on that
  // life's multiplier — the balance a graft is paid from, GraftingWork.tsx:33,
  // resets at the install, so a life can only graft what it earns), then
  // holds the work slot for their graft time, and still has its OWN length
  // left for its batch: lifeH = moneyH + max(slotH, baseH). The grafts must
  // finish before the install that ends the life — an install cancels a graft
  // in progress and keeps its price (prestigeAugmentation -> finishWork(true),
  // PlayerObjectGeneralMethods.ts:137; GraftingWork.finish applies nothing
  // when cancelled). The batch is held at its planned gain: the money paid
  // for the grafts is re-earned after them (conservative — the batch's
  // money restarts from ~0 rather than from the opening balance).
  const lifeGraftLeg = (specs, { baseH, money0, mult: m, exp0, first, atH = 0 }) => {
    let cost = 0
    let slot = 0
    const g = { hacking: 1, exp: 1, rep: 1, money: 1 }
    for (const x of specs) {
      if (!x || !(pos(x.cost) || (x.paid === true && x.cost === 0)) || !num(x.slotH) || x.slotH < 0 || !pos(x.hacking) || !pos(x.exp) || !pos(x.rep)) return { lifeH: null, why: `graft ${x?.name ?? '?'} (life ${x?.life ?? '?'}) unpriced (cost, time or multipliers)` }
      cost += x.cost
      slot += x.slotH
      g.hacking *= x.hacking
      g.exp *= x.exp
      g.rep *= x.rep
      g.money *= pos(x.money) ? x.money : 1
    }
    const shapedHere = expScalesWithLevel === true && pos(hacking)
    const moneyH = cost <= money0 ? 0 : hoursToMoney(cost, { money0, incomeAtLevel1, mult: m, exp0, expPerSec, expRateAt: shapedHere ? expRateShape(expPerSec, { scales: true, ref: hacking, flat: pos(expFlatPerSec) ? expFlatPerSec : 0 }) : null, extraAt: steps.length ? (rel) => extraAt(atH + rel) : null, flatPerSec: flatInc + (first && pos(lifeIncome) ? lifeIncome : 0), capitalReturnPerSec: capR, capitalCap, capitalScaleW: o.capitalScaleW, capitalShape: o.capitalShape, spendPerSec, capitalWarmupH: !first && num(capitalWarmupH) ? capitalWarmupH : 0 })
    if (!num(moneyH)) return { lifeH: null, why: `could not price the money for ${specs.length} graft(s) in an earlier life ($${Math.round(cost)})` }
    const lifeH = moneyH + Math.max(slot, baseH)
    return { lifeH, extraH: lifeH - baseH, moneyH, slotH: slot, cost, n: specs.length, g }
  }

  // GRAFTS IN THE LIVES BEFORE THE FINAL WINDOW (o.lifeGrafts [{life, ...graftSpecOf}]).
  // Resolved against this policy's install count: a graft scheduled in a life
  // the policy does not have (life > installsFirst) is grafted in the final
  // window instead, ahead of o.finalGrafts (lifeGraftsOf).
  const lifeSched = lifeGraftsOf(o.lifeGrafts, installsFirst)
  if (lifeSched.bad) return { hours: null, why: lifeSched.bad }
  const finalGrafts = [...lifeSched.spill, ...(Array.isArray(o.finalGrafts) ? o.finalGrafts : [])]
  // What the earlier lives' grafts did to the player's multipliers: exp and
  // the reputation/donation rates act from the final window on (below).
  let lifeGE = 1
  let lifeLegsOut = []
  if (installsFirst > 0) {
    const firstH0 = num(firstInstallH) && firstInstallH >= 0 ? firstInstallH : cycleHours
    // A LIFE THAT GRAFTS IS LONGER (lifeGraftLeg): its own length, after the
    // grafts' money is earned from the life's opening balance.
    let firstH = firstH0
    let g1 = null
    if (lifeSched.byLife.has(1)) {
      g1 = lifeGraftLeg(lifeSched.byLife.get(1), { baseH: firstH0, money0: money, mult: hackingMult, exp0: hackingExp, first: true })
      if (!num(g1.lifeH)) return { hours: null, why: g1.why }
      firstH = g1.lifeH
    }
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
    const persistLiftRef =
      (num(eRep) && eRep > 0 ? Math.pow(ratio('rep'), eRep) : 1) *
      (num(eBudget) && eBudget > 0 ? Math.pow(ratio('income'), eBudget) : 1)
    // ...AS A SHARE OF A LATER LIFE'S OWN BATCH. eRep / eBudget are measured
    // on THIS life's batch (persistBaseline, x1.13 hacking live): K^e is what
    // a batch of that size gains. A later life buying far less cannot gain
    // more than in proportion — a 0.5h life's x1.0016 batch lifted by the
    // x1.26 measured on a x1.13 one compounded x1.26 every half hour: live
    // BN9 2026-09-29 19:32Z the same trajectory read 14.1h on 0.5h lives
    // (16 installs, mult 1.13 -> 73.4 on x1.0027 lives) against 70.8h on 12h
    // lives, and the purchase model's life length flipped 12h -> 0.5h
    // (lifeplan.cadenceByPurchases prices every length through this) — the
    // exit 45.7h -> 12.9h on a pass that re-decided nothing. The lift's ln is
    // scaled by ln(g) / ln(the baseline batch's hacking), capped at 1 (never
    // more than measured).
    const lnRef = pos(persistBaseline?.hacking) && persistBaseline.hacking > 1 ? Math.log(persistBaseline.hacking) : null
    const liftShare = lnRef && pos(multGainPerCycle) ? Math.max(0, Math.min(1, Math.log(Math.max(1, multGainPerCycle)) / lnRef)) : 1
    const persistLift = Math.exp(Math.log(persistLiftRef) * liftShare)
    // Cycle by cycle, so a later-arriving income can lift the cycles after it.
    mult = hackingMult * firstGain * (Array.isArray(perCycleExtra?.byInstall) ? cycleExtraAt(0) : 1)
    // A GRAFT PERSISTS THROUGH EVERY LATER INSTALL (it is pushed onto
    // Player.augmentations, AugmentationHelpers.ts:65, which Prestige.ts:122
    // re-applies; its entropy stack too, Prestige.ts:128). So a graft in life
    // j multiplies the multiplier from then on, its hacking_money the
    // level-scaled income, and its reputation (and income, where the batch
    // responds to money: eBudget) lifts every LATER life's batch by the same
    // measured K^e responses persistLift uses — from the install after the
    // grafting life (the life that grafts earns its batch's reputation with
    // the slot partly held by the grafting).
    let graftLift = 1
    const applyLifeGrafts = (leg) => {
      mult *= leg.g.hacking
      lifeGE *= leg.g.exp
      incomeAtLevel1 *= leg.g.money
      if (pos(repRate)) repRate *= leg.g.rep
      if (pos(donation)) donation /= leg.g.rep
      graftLift *= (num(eRep) && eRep > 0 ? Math.pow(leg.g.rep, eRep) : 1) * (num(eBudget) && eBudget > 0 ? Math.pow(leg.g.money, eBudget) : 1)
    }
    if (g1) applyLifeGrafts(g1)
    const lifeLegs = g1 ? [{ life: 1, ...g1 }] : []
    // Nothing varies by cycle (no later income, no delayed rep lift, no
    // per-install extra): one power, not a loop — the policy search prices
    // k = 1..400 and the loop made it quadratic (live BN9 2026-09-29, 0.5h
    // cycles, the optimum at ~325 installs). Lives that graft are walked one
    // by one up to the last of them, and the power covers the rest.
    const cycleAt = (i, t) => multGainPerCycle * growthAt(t) * persistLift * cycleExtraAt(i) * graftLift
    const flat = !perCycleExtra && !steps.length && !(repFrom > 0)
    const lastGraftLife = lifeSched.lastLife
    let t = firstH
    let i = 1
    for (; i < installsFirst && (!flat || i < lastGraftLife); i++) {
      const life = i + 1
      // Install `life` ends this life: its batch is lifted by the grafts of
      // the lives before it, not by this life's own.
      const liftBefore = graftLift
      let len = cycleHours
      if (lifeSched.byLife.has(life)) {
        const leg = lifeGraftLeg(lifeSched.byLife.get(life), { baseH: cycleHours, money0: num(installCash) && installCash >= 0 ? installCash : 1262, mult, exp0: 0, first: false, atH: t })
        if (!num(leg.lifeH)) return { hours: null, why: leg.why }
        len = leg.lifeH
        h += len - cycleHours
        applyLifeGrafts(leg)
        lifeLegs.push({ life, ...leg })
      }
      mult *= multGainPerCycle * growthAt(t) * persistLift * cycleExtraAt(i) * liftBefore
      t += len
    }
    if (i < installsFirst) mult *= Math.pow(cycleAt(i, 0), installsFirst - i)
    lifeLegsOut = lifeLegs
    if (lifeLegs.length) {
      legs.push({ leg: 'grafts in earlier lives', hours: lifeLegs.reduce((a, l) => a + l.extraH, 0), detail: lifeLegs.map((l) => `life ${l.life}: ${l.n} graft(s) $${(l.cost / 1e9).toFixed(2)}b, ${l.slotH.toFixed(2)}h slot, money ${l.moneyH.toFixed(2)}h, life ${l.lifeH.toFixed(2)}h (+${l.extraH.toFixed(2)}h), hacking x${l.g.hacking.toFixed(3)}`).join('; ') })
    }
    exp = 0
    // PlayerObjectGeneralMethods.ts:102 ($1262), or Prestige.ts:158's $250m in
    // BitNode 8 — which REPLACES the balance, positions included (the market
    // re-initialises, Prestige.ts:166-170).
    cash = num(installCash) && installCash >= 0 ? installCash : 1262
    legs.push({ leg: 'install cycles', hours: firstH + (installsFirst - 1) * cycleHours, detail: `first after ${firstH.toFixed(2)}h, then ${installsFirst - 1} x ${cycleHours.toFixed(2)}h, mult ${hackingMult.toFixed(2)} -> ${mult.toFixed(2)}` })
  }

  // The exp rate can rise mid-window (a Covenant sleeve's transfer), so the
  // legs read this rather than the input.
  let expRate = expPerSec
  // Earlier lives' grafts' hacking_exp (lifeGrafts), from the final window on.
  if (lifeGE !== 1 && pos(expRate)) expRate *= lifeGE
  // The batch's hacking_exp scales the player's own exp from the install on.
  if (installsFirst > 0 && pos(installGains?.exp) && installGains.exp >= 1 && pos(expRate)) expRate *= installGains.exp
  // preInstallExpMult: added as an AMOUNT, so it is removed exactly before the
  // climb whatever is added to the rate in between (a Covenant sleeve).
  let preExpBoost = installsFirst === 0 && pos(preInstallExpMult) && preInstallExpMult !== 1 && pos(expRate) ? expRate * (preInstallExpMult - 1) : 0
  expRate += preExpBoost
  // The exp model of every leg below: constant, or rising with the level
  // from today's rate at today's level (expRateShape). The flat part (the
  // sleeves', a Covenant sleeve's) does not rise.
  const shaped = expScalesWithLevel === true && pos(hacking)
  let expFlat = shaped && pos(expFlatPerSec) ? expFlatPerSec : 0
  // One rate function per (rate, flat): the legs call this per step.
  let expAtFn = null
  let expAtKey = null
  const expAt = () => {
    if (expAtFn === null || expAtKey[0] !== expRate || expAtKey[1] !== expFlat) {
      expAtFn = expRateShape(expRate, { scales: shaped, ref: hacking, flat: expFlat })
      expAtKey = [expRate, expFlat]
    }
    return expAtFn
  }
  const expAdv = (e, hours) => (shaped ? expAfterHours(e, hours, mult, expAt()) : e + (pos(expRate) ? expRate * hours * 3600 : 0))
  const climbTo = (level, e) => (shaped ? hoursToLevelShaped(level, mult, e, expAt()) : hoursToLevel(level, mult, e, expRate))
  const moneyLeg = (target, targetAt = null) => {
    const t0 = h
    // flatPerSec carries the node's flat income PLUS, under hold-to-exit only,
    // the hacknet stream the next install would destroy (lifeInc).
    return hoursToMoney(target, { money0: cash, incomeAtLevel1, mult, exp0: exp, expPerSec: expRate, expRateAt: shaped ? expAt() : null, extraAt: steps.length ? (rel) => extraAt(t0 + rel) : null, flatPerSec: flatInc + lifeInc, capitalReturnPerSec: capR, capitalCap, capitalScaleW, capitalShape, targetAt, spendPerSec, capitalWarmupH: installsFirst > 0 && num(capitalWarmupH) ? Math.max(0, capitalWarmupH - (h - finalStart)) : 0 })
  }
  // The final window starts here; `slotH` is what it needs of the work slot.
  const finalStart = h
  let slotH = 0
  // THE WORK SLOT HELD FROM NOW (o.slotBusyH): something else occupies it for
  // this many hours first — the gang's karma grind (gangworth.gangExit). Only
  // when the final window IS now (installsFirst 0); a grind inside an earlier
  // life moves that life's cadence, which this model holds at its measured
  // rate — not simulated, and gangworth says so.
  const busyH = installsFirst === 0 && num(o.slotBusyH) && o.slotBusyH > 0 ? o.slotBusyH : 0
  slotH += busyH

  // GRAFTS IN THE FINAL WINDOW (o.finalGrafts [{name, cost, slotH, hacking,
  // exp, rep}], graftplan.graftSpecOf): each is paid when the balance reaches
  // its price (a money leg from the balance in hand, which then compounds from
  // what is left), then occupies the WORK SLOT for its graft time — one at a
  // time, after anything already holding the slot (busyH). Its multipliers
  // (entropy's 0.98 per graft already folded in by graftSpecOf) apply to the
  // final climb, and to the reputation leg, from the window on. The climb
  // waits for the last graft: the Red Pill install that precedes the climb
  // cancels a graft in progress and keeps its money (GraftingWork.finish).
  // A graft persists through every later install (Prestige.ts re-applies
  // Player.augmentations), so it can equally be made in a life BEFORE the
  // final window — o.lifeGrafts, priced above (lifeGraftLeg: that life's own
  // money and slot, lengthening it) — and those scheduled in a life this
  // policy does not have land here, first. Not simulated: the grafted
  // augmentation leaving the later lives' purchase catalogue (the measured
  // cadence is held). hacking_money (x entropy, `money`) scales the
  // level-scaled income from the window on; specs without it price as
  // before. Absent, every node prices exactly as before.
  let graftDone = finalStart + busyH
  let graftRep = 1
  if (finalGrafts.length) {
    let gH = 1
    let gE = 1
    // WHEN THE GRAFTING STARTS (o.graftStartMoney, the with-run's policy
    // parameter — graftplan searches it): the first graft waits until the
    // balance reaches this. Where money is capital (BitNode 8) paying a graft
    // the moment the balance covers it empties the compounding balance each
    // time (live 2026-09-26: eight grafts as soon as affordable took 34h of
    // money legs), while waiting delays the slot. Later grafts are paid at the
    // hour the previous payment was (the simulator does not advance the
    // balance to each graft's slot start) — earlier than the game pays them,
    // so the lost compounding is overstated: a conservative with-run.
    const startAt = num(o.graftStartMoney) && o.graftStartMoney > cash ? o.graftStartMoney : 0
    if (startAt > 0) {
      const hm = moneyLeg(startAt)
      if (!num(hm)) return { hours: null, why: 'could not price the money the grafting starts at' }
      h += hm
      exp = expAdv(exp, hm)
      cash = startAt
      legs.push({ leg: 'graft start money', hours: hm, detail: `$${Math.round(startAt)} before the first graft` })
    }
    let gM = 1
    for (const g of finalGrafts) {
      if (!g || !(pos(g.cost) || (g.paid === true && g.cost === 0)) || !num(g.slotH) || g.slotH < 0 || !pos(g.hacking) || !pos(g.exp) || !pos(g.rep)) return { hours: null, why: `graft ${g?.name ?? '?'} unpriced (cost, time or multipliers)` }
      if (g.cost > cash) {
        const hm = moneyLeg(g.cost)
        if (!num(hm)) return { hours: null, why: `could not price the money for graft ${g.name}` }
        h += hm
        exp = expAdv(exp, hm)
        cash = g.cost
        legs.push({ leg: 'graft money', hours: hm, detail: `$${Math.round(g.cost)} for ${g.name}` })
      }
      cash -= g.cost
      graftDone = Math.max(h, graftDone) + g.slotH
      slotH += g.slotH
      gH *= g.hacking
      gE *= g.exp
      graftRep *= g.rep
      gM *= pos(g.money) ? g.money : 1
    }
    mult *= gH
    // hacking_money and its entropy: the level-scaled income from the window on.
    incomeAtLevel1 *= gM
    if (pos(expRate)) expRate *= gE
    preExpBoost *= gE
    if (pos(repRate)) repRate *= graftRep
    if (pos(donation)) donation /= graftRep
    legs.push({ leg: 'grafts', hours: 0, detail: `${finalGrafts.length} graft(s)${lifeSched.spill.length ? ` (${lifeSched.spill.length} scheduled in lives this policy does not have)` : ''}, slot until +${(graftDone - finalStart).toFixed(2)}h, hacking x${gH.toFixed(3)}, exp x${gE.toFixed(3)}, rep x${graftRep.toFixed(3)}` })
  }

  if (covenant) {
    if (!pos(covenant.cost) || !num(covenant.combatH) || covenant.combatH < 0) return { hours: null, why: 'covenant campaign unpriced (cost or combat hours)' }
    const target = covenant.member ? covenant.cost : Math.max(covenant.cost, covenant.joinMoney ?? 0)
    if (target > cash) {
      const hm = moneyLeg(target)
      if (!num(hm)) return { hours: null, why: 'could not price the Covenant money leg' }
      h += hm
      exp = expAdv(exp, hm)
      cash = target
      legs.push({ leg: 'covenant money', hours: hm, detail: `$${Math.round(target)} in hand` })
    }
    cash -= covenant.cost
    slotH += covenant.member ? 0 : covenant.combatH
    if (pos(covenant.sleeveExpPerSec)) {
      expRate = (pos(expRate) ? expRate : 0) + covenant.sleeveExpPerSec
      expFlat += shaped ? covenant.sleeveExpPerSec : 0
    }
  }

  if (joinMoney > cash) {
    const hm = moneyLeg(joinMoney)
    if (!num(hm)) return { hours: null, why: 'could not price the join-money leg' }
    h += hm
    cash = joinMoney
    legs.push({ leg: 'hoard join money', hours: hm, detail: `$${Math.round(joinMoney)} in hand` })
    // The hoard leg also banks exp, which the climb below inherits.
    exp = expAdv(exp, hm)
  }
  // THE JOIN'S HACKING LEVEL, concurrent with the hoard (the exp banked
  // while hoarding counts): the invitation needs the level AND the money in
  // hand, so only the part of the climb the hoard did not cover is added.
  // Live 2026-09-26 the plan chose to install while the legacy gate held on
  // the join money; the plan's trajectory now carries the whole join.
  if (pos(joinLevel) && joinMoney > 0 && pos(mult) && levelAt(exp, mult) < joinLevel) {
    const hj = climbTo(joinLevel, exp)
    if (!num(hj)) return { hours: null, why: `could not price the climb to the join level ${joinLevel}` }
    h += hj
    exp = expAdv(exp, hj)
    legs.push({ leg: 'climb to join level', hours: hj, detail: `hacking ${joinLevel} with $${Math.round(joinMoney)} in hand` })
  }

  if (terminalRep > 0) {
    const fleetOn = !!sleeveRep && (pos(sleeveRep.perSec) || (Array.isArray(sleeveRep.steps) && sleeveRep.steps.some((x) => pos(x?.perSec))))
    const sRep = sleeveRateFn(fleetOn ? sleeveRep : null)
    // workWhileDonating (o, set by progress.js where donations open at favor
    // 0 — BitNode 8): the donation leg is priced with the slot's work (and
    // the best sleeve's, constant at its rate now) shrinking what is owed.
    // Reputation per hour is held at today's level-rate: a floor after an
    // install, when the level climbs back.
    const wwd = o.workWhileDonating === true
    let r = hoursToRep(terminalRep, {
      rep0: exitRep,
      repPerSec: wwd ? repRate : fleetOn ? (pos(repRate) ? repRate : 0) + sRep(h) : repRate,
      donationCost: donation,
      favor: exitFavor,
      favorToDonate,
      moneyLeg,
      workWhileDonating: wwd,
      sleeveRepPerSec: wwd && fleetOn ? sRep(h) : 0,
      slotFreeAt: Math.max(0, Math.max(busyH, graftDone - finalStart) - (h - finalStart)),
    })
    if (wwd && r.how === 'ground' && fleetOn) r = hoursToRep(terminalRep, { rep0: exitRep, repPerSec: (pos(repRate) ? repRate : 0) + sRep(h) })
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
      const varies = installsFirst > 0 && pos(hacking)
      const scale = varies ? (e) => levelAt(e, mult) / hacking : () => 1
      // One log per step: the level read for the rate is the level the
      // affine exp step starts from (expAdv's own path, not re-derived).
      const aff = shaped ? expAt().affine ?? null : null
      // Adaptive step (1/300 of the leg at today's rate, never below 2 min)
      // and a hard iteration cap — see hoursToMoney: this froze the game.
      const r0 = P * scale(exp) + sRep(legStart)
      const est = r0 > 0 ? need / r0 / 3600 : 1e4
      const step = Math.max(1 / 30, Math.min(1e4, est) / 300)
      let acc = 0
      let t = 0
      let e = exp
      let iter = 0
      let L = varies ? contLevel(e, mult) : 0
      for (;;) {
        if (t > 1e4 || iter++ > 3000) {
          t = Infinity
          break
        }
        // Land exactly on the sleeve's next rate change inside this step.
        const nb = fleetOn ? sleeveBreaks(sleeveRep, legStart + t)[0] : undefined
        const dt = typeof nb === 'number' && nb - (legStart + t) < step ? Math.max(1e-9, nb - (legStart + t)) : step
        const rate = P * (varies ? Math.max(1, Math.floor(L)) / hacking : 1) + (fleetOn ? sRep(legStart + t) : 0)
        const add = rate * dt * 3600
        if (rate > 0 && acc + add >= need) {
          t += (need - acc) / rate / 3600
          break
        }
        acc += add
        if (varies) {
          e = aff ? affineStepFrom(e, L, dt, mult, aff, expAt()) : expAdv(e, dt)
          L = contLevel(e, mult)
        }
        t += dt
      }
      r = { hours: t, how: 'ground' }
    }
    if (!num(r.hours)) return { hours: null, why: `could not price the reputation leg: ${r.how}` }
    h += r.hours
    if (r.how === 'ground') slotH += r.hours
    legs.push({ leg: 'exit reputation', hours: r.hours, detail: `${Math.round(terminalRep)} rep, ${r.how}` })
    exp = expAdv(exp, r.hours)
  }

  // The final install: skills reset, and the climb runs on the multiplier we
  // froze at. This is the leg the whole install-vs-hold trade turns on.
  // The sleeve's exp as its own term (sleeveExp {perSec, delayH}, delayH from
  // NOW): it joins the climb only once its delay has passed — the synchronise,
  // shock recovery or training it spends first. Piecewise, like sleeveRep.
  // The last graft finishes before the install that starts the climb.
  // The terminal install ends a pre-install exp bonus: the climb runs without it.
  if (preExpBoost !== 0) expRate = Math.max(0, expRate - preExpBoost)
  if (graftDone > h) {
    legs.push({ leg: 'grafts finish', hours: graftDone - h, detail: 'the climb waits for the last graft (an install cancels one in progress)' })
    h = graftDone
  }
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
    else if (shaped) {
      // Rising with the level: per segment the player's shaped rate plus the
      // sleeve's constant one, the level chunks of hoursToLevelShaped.
      let acc = 0
      let t = h
      climb = Infinity
      const base = expAt()
      for (const b of [...sleeveBreaks(sleeveExp, h), Infinity]) {
        const s = sExp(t)
        const rateAt = base.affine ? affineRate(base.affine.F + (pos(s) ? s : 0), base.affine.k) : (l) => base(l) + s
        const span = b - t
        const tn = hoursToLevelShaped(exitLevel, mult, acc, rateAt)
        if (num(tn) && tn <= span) {
          climb = t - h + tn
          break
        }
        if (!isFinite(span)) break
        acc = expAfterHours(acc, span, mult, rateAt)
        t = b
      }
    } else {
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
  } else climb = climbTo(exitLevel, 0)
  if (!num(climb)) return { hours: null, why: 'could not price the final climb' }
  // The climb starts in a FRESH life: exp reset, fleet re-rooted, low targets
  // first — its measured lag behind a constant rate is charged once.
  const lagH = climb > 0 && num(freshExpLagH) && freshExpLagH > 0 ? freshExpLagH : 0
  h += climb + lagH
  legs.push({ leg: 'climb to exit level', hours: climb + lagH, detail: `hacking ${exitLevel} at mult ${mult.toFixed(2)} from a fresh life (exp reset by the terminal install${lagH ? `, +${lagH.toFixed(2)}h measured fresh-life ramp` : ''})` })
  // Rooting w0r1d_d43m0n: the openers bought again from the reset balance,
  // concurrent with the climb — only the excess binds.
  if (pos(finalRootCost)) {
    const money0 = num(installCash) && installCash >= 0 ? installCash : 1262
    const rootH = finalRootCost <= money0 ? 0 : hoursToMoney(finalRootCost, { money0, incomeAtLevel1, mult, exp0: 0, expPerSec: expRate, expRateAt: shaped ? expAt() : null, flatPerSec: flatInc, capitalReturnPerSec: capR, capitalCap, capitalScaleW, capitalShape, capitalWarmupH: num(capitalWarmupH) ? capitalWarmupH : 0 })
    if (!num(rootH)) return { hours: null, why: 'could not price re-buying the port openers after the terminal install' }
    const extra = Math.max(0, rootH - (climb + lagH))
    legs.push({ leg: 'root w0r1d_d43m0n', hours: extra, detail: `$${Math.round(finalRootCost)} of openers from $${Math.round(money0)} after the install: ${rootH.toFixed(2)}h, concurrent with the climb` })
    h += extra
  }

  // The work slot can bind the window: the passive legs overlap it, a ground
  // reputation leg and the Covenant gym legs do not overlap each other.
  if (slotH > h - finalStart) {
    legs.push({ leg: 'work slot binds', hours: slotH - (h - finalStart), detail: `${slotH.toFixed(1)}h of work slot in a ${(h - finalStart).toFixed(1)}h window` })
    h = finalStart + slotH
  }

  // The earlier lives' grafting legs, for the executor: life 1's length is
  // how long the current life is held open for its grafts.
  return { hours: h, legs, mult, ...(lifeLegsOut.length ? { lifeGraftLegs: lifeLegsOut.map((l) => ({ life: l.life, n: l.n, cost: l.cost, moneyH: l.moneyH, slotH: l.slotH, lifeH: l.lifeH, extraH: l.extraH })) } : {}) }
}

/**
 * The optimisation: try every policy and return the best.
 *
 * `maxInstalls` bounds the search, and the bound is REPORTED — a silently
 * truncated search reads as "this is the optimum" when it may only be the edge
 * of where we looked (CLAUDE.md: no silent caps).
 *
 * THE SEARCH STRIDES PAST ITS HEAD. It was one install at a time until 15 in
 * a row failed to beat the best — fine while the optimum was a few installs
 * away, but under the purchase model's 0.5h cadence (live BN9 2026-09-29) the
 * optimum sits at ~300 installs and every exit simulation priced ~340
 * policies; with 10 options x 24 draws the plan's Monte Carlo ran out of
 * budget at 3 draws. Now: the first POLICY_HEAD installs one by one, exactly
 * as before (an optimum inside the head, or one the 15-worse rule ends near,
 * is found by the same steps). Only while the exit is STILL IMPROVING at the
 * head's end does it gallop (doubling strides), bisect the bracket the gallop
 * closes, and then scan POLICY_WORSE installs either side of the best, again
 * until that scan stops moving it. The exit over k is unimodal (a linear
 * cycle cost plus a tail convex in ln M — every live and fixture inputs set
 * checked, [XP-S]); the closing scan absorbs the level floor's plateaus.
 * `tried` lists every policy priced, in install order.
 */
// Memo: many callers in one pass simulate identical inputs. Keyed on the
// inputs' JSON (functions excluded, as JSON drops them); bounded.
const policyMemo = new Map()
/** Exits longer than this are not durations but "unreachable": comparisons between them decide nothing. */
export const DEGENERATE_H = 1e5
export const POLICY_HEAD = 24
export const POLICY_WORSE = 15

export function bestExitPolicy(o = {}, maxInstalls = 400, minInstalls = 0) {
  return drain(bestExitPolicyGen(o, maxInstalls, minInstalls))
}

/**
 * bestExitPolicy as a GENERATOR that yields after each policy priced (one
 * exitHours), so a caller running it in coop.js slices never blocks the page
 * for a whole search. Same result as bestExitPolicy, which drains it.
 */
export function* bestExitPolicyGen(o = {}, maxInstalls = 400, minInstalls = 0) {
  let key = null
  try {
    key = `${maxInstalls}|${minInstalls}|${JSON.stringify(o)}`
  } catch {
    key = null
  }
  if (key !== null && policyMemo.has(key)) return policyMemo.get(key)
  const seen = new Map()
  let best = null
  function* at(k) {
    const had = seen.get(k)
    if (had) return had
    const r = exitHours({ ...o, installsFirst: k })
    const row = { installsFirst: k, hours: r.hours, why: r.why ?? null }
    seen.set(k, row)
    // Strictly shorter, or as short at fewer installs (the one-by-one
    // search's first minimum).
    if (num(r.hours) && (best === null || r.hours < best.hours || (r.hours === best.hours && k < best.installsFirst))) best = { ...r, installsFirst: k }
    yield
    return row
  }
  // The head: one by one, the 15-worse rule.
  let worse = 0
  let k = minInstalls
  let stopped = false
  const headEnd = Math.min(maxInstalls, minInstalls + POLICY_HEAD - 1)
  const linearFrom = function* (from, to) {
    for (k = from; k <= to; k++) {
      const before = best
      const row = yield* at(k)
      if (best !== before) worse = 0
      else if (best !== null && num(row.hours)) {
        if (++worse >= POLICY_WORSE) return true
      }
    }
    return false
  }
  stopped = yield* linearFrom(minInstalls, headEnd)
  if (!stopped && headEnd < maxInstalls) {
    if (best === null || worse > 0) {
      // Nothing priced yet, or past the best already: the one-by-one rule
      // to its end, as it always ran.
      yield* linearFrom(headEnd + 1, maxInstalls)
    } else {
      // Still improving at the head's end: gallop.
      let prev = headEnd
      let lo = headEnd - 1
      let hi = null
      // At most log2(maxInstalls / POLICY_HEAD) + 1 strides reach the cap; 64 bounds it.
      for (let step = POLICY_HEAD, g = 0; g < 64; step *= 2, g++) {
        const kk = Math.min(maxInstalls, prev + step)
        yield* at(kk)
        if (best.installsFirst === kk) {
          lo = prev
          prev = kk
          if (kk === maxInstalls) break
        } else {
          hi = kk
          break
        }
      }
      // Bisect (lo, hi) around the best: the minimum of a unimodal exit lies
      // strictly inside.
      if (hi !== null) {
        let a = lo
        let b = hi
        for (let it = 0; it < 64 && b - a > 3; it++) {
          const kb = best.installsFirst
          const m = kb - a > b - kb ? Math.floor((a + kb) / 2) : Math.ceil((kb + b) / 2)
          if (m === kb || m <= a || m >= b) break
          yield* at(m)
          if (best.installsFirst === m) {
            if (m < kb) b = kb
            else a = kb
          } else if (m < kb) a = m
          else b = m
        }
      }
      // The closing scan: POLICY_WORSE either side of the best, until it holds.
      for (let round = 0; round < 20; round++) {
        const kb = best.installsFirst
        for (let j = Math.max(minInstalls, kb - POLICY_WORSE); j <= Math.min(maxInstalls, kb + POLICY_WORSE); j++) yield* at(j)
        if (best.installsFirst === kb) break
      }
    }
  }
  const tried = [...seen.values()].sort((x, y) => x.installsFirst - y.installsFirst)
  const out = !best
    ? { best: null, tried, why: tried[0]?.why ?? 'no policy could be priced' }
    : {
        best,
        tried,
        atSearchEdge: best.installsFirst === maxInstalls,
        searchedTo: tried[tried.length - 1]?.installsFirst ?? maxInstalls,
        // DEGENERATE: the best exit is longer than any node is played (1e5h,
        // eleven years). Live in BitNode 8 every policy priced ~1.5e26h — no
        // install cadence was measured, so only "never install" priced, and
        // its climb to 3000 at mult 1.34 is astronomical. Comparisons between
        // two such exits are noise, and callers that decide by them must
        // refuse (exitHoursComparable).
        ...(best.hours > DEGENERATE_H ? { degenerate: true, degenerateWhy: `best exit ${best.hours.toExponential(2)}h (${best.installsFirst} installs) exceeds ${DEGENERATE_H}h — ${tried.some((t) => t.installsFirst > 0 && t.hours === null) ? `installs unpriced: ${tried.find((t) => t.installsFirst > 0)?.why}` : 'no policy reaches the exit'}` } : {}),
      }
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
/**
 * What $1 now, and $1/s from now, are worth at W hours with the trader's book
 * compounding at r = inputs.capitalReturnPerSec on min(balance, capitalCap)
 * (hoursToMoney's capital term), from inputs.money, after capitalWarmupH.
 *   lump    the factor on a dollar held from now to W
 *   stream  seconds-equivalent of $1/s reinvested from now to W
 * The book compounds only until it reaches the cap (a dollar above it earns
 * nothing), so both stop growing there. r = 0: lump 1, stream W x 3600.
 */
export function capitalFutureValue(inputs, W) {
  // One implementation (hacknetplan.capitalFV, which the hacknet batch values
  // purchases with): the spend verdict and the batch must agree on a dollar.
  return capitalFV(inputs, W)
}

export function spendExit(o = {}) {
  const { inputs, cost, gainPerSec, persists = false, finalWindow = false } = o
  if (!inputs || !pos(cost) || !num(gainPerSec) || gainPerSec < 0) return { deltaH: null, why: 'spend unreadable (cost or gain)' }
  // HACKING EXP AS THE RETURN (o.expGainPerSec): where scripted hacking pays
  // nothing (BitNode 8) home RAM's only return is exp, and home survives every
  // install, so the with-run climbs on expPerSec + this. Only a PERSISTING
  // spend carries it: exp earned before an install is reset by it
  // (Prestige.ts), so a destroyed purchase's exp never reaches the climb.
  // Absent (0) everywhere else, so no other verdict changes.
  const expGain = persists && num(o.expGainPerSec) && o.expGainPerSec > 0 && num(inputs.expPerSec) ? o.expGainPerSec : 0
  const withExp = (x) => (expGain > 0 ? { ...x, expPerSec: inputs.expPerSec + expGain } : x)
  if (finalWindow) {
    const without = bestExitPolicy(inputs, 0, 0)
    const withS = bestExitPolicy(withExp({ ...inputs, money: Math.max(0, (inputs.money ?? 0) - cost), incomePerSec: inputs.incomePerSec + gainPerSec }), 0, 0)
    if (!without.best || !withS.best) return { deltaH: null, why: `final window unpriced: ${without.why ?? withS.why}` }
    return { deltaH: withS.best.hours - without.best.hours, withH: withS.best.hours, withoutH: without.best.hours }
  }
  const W = o.W
  if (!num(W) || W < 0 || typeof o.moneyAt !== 'function') return { deltaH: null, why: 'install point or money trajectory unreadable' }
  const m0 = o.moneyAt(W)
  // THE TRADER'S RETURN ON BOTH SIDES (capitalFutureValue): dollars spent now
  // stop compounding until W — and the spend's income, reinvested as it
  // arrives, compounds from when it arrives. Both only until the book reaches
  // its cap (above it an extra dollar earns nothing) and only after the
  // warm-up. This charged the cost e^(rW) UNCAPPED and let the income earn
  // nothing: in BitNode 9 (r 2.3e-4/s, 82%/h) a 3-minute-payback hacknet
  // upgrade was charged e^19 = 1.6e8 times its price over a 21h life, while
  // the book reaches its $5.3t cap in ~9h. With r = 0 (every node without a
  // trader) both factors are exactly 1 and m1 is unchanged.
  const fv = capitalFutureValue(inputs, W)
  const m1 = m0 - cost * fv.lump + gainPerSec * fv.stream
  const moneyAtW = { m0, m1, lumpFactor: fv.lump, streamSec: fv.stream }
  const gainsAt = typeof o.gainsAt === 'function' ? o.gainsAt : () => null
  const exitWith = (m, extraIncome, exp = false) => {
    const g = m >= 0 ? gainsAt(m) : null
    if (m < 0) return { best: null, why: 'the spend is not affordable by the install' }
    const x = { ...inputs, incomePerSec: inputs.incomePerSec + extraIncome, firstInstallH: W, ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) }
    return bestExitPolicy(exp ? withExp(x) : x, 400, 1)
  }
  // Income that persists also buys more augmentations in EVERY later life:
  // the planner measures that response as eBudget = dln(planM)/dln(money)
  // (progress.js, the plan re-run at x1.5 money), so a later life's gain
  // becomes g x K^eBudget at income xK. Unmeasured, it is left out — the
  // verdict is then a floor, and says so.
  // (incomePerSec 0 is a real input in BitNode 8, where the income is the
  // trader's return: a ratio against it is undefined, not infinite.)
  const K = persists && gainPerSec > 0 && pos(inputs.incomePerSec) ? (inputs.incomePerSec + gainPerSec) / inputs.incomePerSec : 1
  const e = num(o.eBudget) && o.eBudget >= 0 ? o.eBudget : null
  const without = exitWith(m0, 0)
  const withS = (() => {
    const r = exitWith(m1, persists ? gainPerSec : 0, true)
    if (!(K > 1) || e === null || !pos(inputs.multGainPerCycle)) return r
    const g = inputs.multGainPerCycle * Math.pow(K, e)
    const gAt = m1 >= 0 ? gainsAt(m1) : null
    return m1 < 0 ? r : bestExitPolicy(withExp({ ...inputs, incomePerSec: inputs.incomePerSec + gainPerSec, multGainPerCycle: g, firstInstallH: W, ...(gAt ? { installGains: gAt, nextInstallGain: gAt.hacking } : {}) }), 400, 1)
  })()
  if (!without.best || !withS.best) return { deltaH: null, why: `unpriced: ${without.why ?? withS.why}`, moneyAtW }
  return {
    deltaH: withS.best.hours - without.best.hours,
    withH: withS.best.hours,
    withoutH: without.best.hours,
    moneyAtW,
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

/**
 * THE INSTALL CADENCE: a posterior, never a borrowed node.
 *
 * This used to be "measured in this node once it has three lives, else the
 * node with the most lives". BN1's first lives therefore priced on BN8's
 * cadence (x1.103 per 9.31h, dragged by BN8's 14h life and a count-ticket
 * stall) — an exit of ~250h against ~50h on BN1's own two lives. Now
 * bayes.cadencePosterior: per-node rate and life length as random effects
 * around a cross-node mean (covariate: the node's augmentation price), stall
 * lives excluded, re-recorded ledger entries merged — a node's own lives
 * dominate within one or two, other nodes only shrink toward the mean. The
 * point inputs are its medians; plan.makeDraws draws both in every Monte
 * Carlo draw. `hackMultNow` (this life's multiplier, raw) lets the last
 * finished life's gain count; `covOf(node)` the covariate.
 * { stats: {cycleHours, multGainPerCycle, lnPerHour, n}, source: 'posterior',
 * node, lives, weight, posterior, why } or null when no life in any node has
 * a measured gain.
 */
export function installCadence(ledger, node, { hackMultNow = null, covOf = null, modelPrior = null } = {}) {
  const c = cadencePosterior(ledger, node, { hackMultNow, covOf, modelPrior })
  if (!c) return null
  return {
    stats: { cycleHours: c.cycleHours, multGainPerCycle: c.multGainPerCycle, lnPerHour: c.lnPerHour, n: c.own.lives },
    source: 'posterior',
    node,
    lives: c.own.gained,
    stalls: c.own.stalls,
    weight: c.own.weight,
    posterior: c,
    why: c.why,
  }
}

/**
 * A PORT OPENER (and TOR, when it is still missing), trajectory against
 * trajectory, where money is capital (BitNode 8).
 *
 * Programs do not survive an install (prestigeHomeComputer clears them,
 * ServerHelpers.ts:226-239), so buying one is buying it EVERY life: the
 * with-run pays `cost` now AND out of every later life's opening balance
 * (installCash - cost), while its script exp rises by `expGainPerSec` all
 * node. The without-run is the published inputs untouched. The lost
 * compounding is in both money legs because they compound from the lower
 * balance. Not simulated, and named: faction invitations that need a
 * backdoor on a server this opener unlocks, and the in-life effect of a
 * higher level on reputation before an install.
 * { deltaH, withH, withoutH } or { deltaH: null, why }.
 */
export function programExit(inputs, cost, expGainPerSec, { manip = null } = {}) {
  if (!inputs || !pos(cost) || !num(expGainPerSec) || expGainPerSec < 0) return { deltaH: null, why: 'program cost or exp gain unreadable' }
  if (!pos(inputs.expPerSec)) return { deltaH: null, why: 'no measured exp rate' }
  const without = bestExitPolicy(inputs)
  const withInputs = {
    ...inputs,
    money: (inputs.money ?? 0) - cost,
    expPerSec: inputs.expPerSec + expGainPerSec,
    ...(num(inputs.installCash) ? { installCash: Math.max(0, inputs.installCash - cost) } : {}),
  }
  // THE STOCK-MANIPULATION CHANNEL the purchase opens, priced as the batcher
  // would decide it (expfarm.serveOrFarm): with the opener, the better of
  // farming exp and serving the manipulation (its return r, less the exp its
  // RAM displaces) — never the upside alone.
  let manipDecision = null
  let withP
  if (manip && num(manip.r) && num(manip.lostExpPerSec)) {
    manipDecision = serveOrFarm(bestExitPolicy, withInputs, { r0: null, r: manip.r, lostExpPerSec: manip.lostExpPerSec })
    withP = num(manipDecision.hours) ? { best: { hours: manipDecision.hours } } : bestExitPolicy(withInputs)
  } else withP = bestExitPolicy(withInputs)
  if (!without.best || without.degenerate) return { deltaH: null, why: `exit unpriced or degenerate without the purchase (${without.why ?? without.degenerateWhy})` }
  // Priced without it, unreachable with it: the purchase takes the capital the
  // exit's money legs need (e.g. $250m every life from a $250m opening).
  if (!withP.best || withP.degenerate) return { deltaH: Infinity, withH: Infinity, withoutH: without.best.hours, why: `the purchase leaves the exit unreachable (${withP.why ?? withP.degenerateWhy})` }
  return { deltaH: withP.best.hours - without.best.hours, withH: withP.best.hours, withoutH: without.best.hours, ...(manipDecision ? { manip: { serve: manipDecision.serve, why: manipDecision.why } } : {}) }
}
