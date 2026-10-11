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

/**
 * How much a flat income over a step is worth at its end when the book it
 * joins compounds: (e^{x} - 1)/x with x = ln(1 + gain/W), the step's own
 * log growth read from the capital's gain. 1 with no growth, or when the
 * step reaches the cap (a dollar past it earns nothing).
 */
function incFactor(W, gain, cap) {
  if (!(W > 0) || !(gain > 0) || !(W + gain < cap)) return 1
  const f = gain / W
  // f / ln(1 + f): its series below 0.3 (relative error < 3e-5; the money legs' steps
  // grow the book <= ~28%), the log beyond.
  if (f < 0.3) return 1 + f * (0.5 + f * (-1 / 12 + f * (1 / 24 - f * (19 / 720))))
  return f / Math.log1p(f)
}

/** level from exp and multiplier — PersonObjects/formulas/skill.ts:13 */
export const levelAt = (exp, mult) => Math.max(1, Math.floor(mult * (32 * Math.log(Math.max(0, exp) + 534.6) - 200)))

/** exp needed for a level at a multiplier — skill.ts:19 inverted */
export const expForLevel = (level, mult) => Math.exp((level / mult + 200) / 32) - 534.6

// Pure: the serve-or-farm decision the batcher makes (prices openers' manipulation).
import { serveOrFarm } from 'expfarm.js'
import { cadencePosterior } from 'bayes.js'
import { capitalFV } from 'hacknetplan.js'
import { contractsForHashes } from 'contractplan.js'
import { favorToRep, repToFavor, addRepToFavor, crossGoFavorH } from 'favor.js'
import { effectAt } from 'goplan.js'
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
  // o.coarse: a quarter of the steps (a screening estimate, ~10% — a caller
  // that only needs to know the leg is well inside another uses it first).
  const coarse = o.coarse === true
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
    stepH = Math.max(stepH, Math.min(maxHours, est) / (coarse ? 50 : 100))
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
    if (rMax > 0) legH = Math.min(stepH, Math.max(0.02 / (rMax * 3600), len / 3600 / (coarse ? 10 : 30)))
  }
  let rNow = 0 // the book's rate at the step's start (stepAt sets it; capitalGain reuses it)
  const stepAt = (m) => {
    rNow = !(m > 0) ? 0 : capC.tab ? rateTab(capC, m) : capitalRateAt(m, capC)
    const rn = m < gateW ? capitalRateAt(gateW, capC) : rNow
    return rn > 0 ? Math.min(legH, (coarse ? 1 : 0.25) / (rn * 3600)) : legH
  }
  let iter = 0
  const exAt = typeof extraAt === 'function' ? extraAt : null
  const xrAt = typeof o.expRateAt === 'function' ? o.expRateAt : null
  const xr0 = pos(expPerSec) ? expPerSec : 0
  const tgtAt = typeof o.targetAt === 'function' ? o.targetAt : null
  const trap = shapedCap && lvlIncome > 0
  // The level at the next step's start, when this step computed it (the trapezoid's end).
  let lvlNext = null
  // A landing bisected inside a curved step reads the step's own rate (traderw.capitalStepFn).
  // The flat rate's own closed form otherwise (no capital in the warm-up).
  const stepFnOf = (m, dt, capOn) => (!capOn ? () => 0 : shapedCap ? capitalStepFn(m, dt, capC, rNow) : m < cap ? (x) => Math.min(m * Math.expm1(r * x), cap - m + r * cap * x) : (x) => r * cap * x)
  while (h < maxHours && iter++ < 4000) {
    const lvl = lvlNext ?? levelAt(exp, mult)
    lvlNext = null
    // income(level) = incomeAtLevel1 * (level + 50) / 51
    const rate = (lvlIncome * (lvl + 50)) / 51 + flat + (exAt !== null ? exAt(h) : 0)
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
      const inc = rate - spend
      stepNow = stepAt(money)
      if (inc > 0 && money < gateW) stepNow = Math.min(stepNow, Math.max(1e-4, (gateW - money) / inc / 3600))
    }
    let sH = r > 0 && h < warmH && warmH - h < stepNow ? warmH - h : stepNow
    let dt = sH * 3600
    // THE LEVEL'S INCOME AS A TRAPEZOID on a curve: the level climbs inside
    // the step (x40 in a fresh window's first hour at a grafted multiplier),
    // and the income read at the step's opening level alone under-paid every
    // step of the climb (+1% on a $1e8 -> $179b leg). The exp step is the
    // same Euler step the loop takes below.
    const xr = xrAt !== null ? Math.max(0, xrAt(lvl)) : xr0
    let dExp = xr * dt
    let rateS = rate
    if (trap && dExp > 0) {
      let lvl2 = levelAt(exp + dExp, mult)
      // ...and a step in which the level's income would move by more than
      // LVL_STEP of itself is shortened to that (the fresh window's climb:
      // one step of a leg sized by the book's growth read level 10 at its
      // start and 3000 at its end).
      const lim = (coarse ? 4 : 1) * LVL_STEP * (lvl + 50)
      if (lvl2 - lvl > lim) {
        sH *= lim / (lvl2 - lvl)
        dt = sH * 3600
        dExp = xr * dt
        lvl2 = levelAt(exp + dExp, mult)
      }
      rateS = rate + (lvlIncome * (lvl2 - lvl)) / 51 / 2
      lvlNext = lvl2
    }
    // The capital term over the step: exponential below the cap, linear at
    // it (traderw.capitalGain; on a curve, at the step's midpoint rate).
    const capOn = r > 0 && h >= warmH
    const capGain = !capOn ? 0 : shapedCap ? capitalGain(money, dt, capC, rNow) : money < cap ? Math.min(money * Math.expm1(r * dt), cap - money + r * cap * dt) : r * cap * dt
    // THE INCOME COMPOUNDS INSIDE THE STEP on the curve: dW/dt = r W + I at
    // the step's own rate r (the capital term's midpoint rate, read back from
    // its gain: r dt = ln(1 + gain/W)) is W e^{r dt} + I (e^{r dt} - 1)/r —
    // the income arriving in the step earns from its arrival. Added flat it
    // missed that: $1m -> $179b with $60k/s of income read 5.07h against a
    // fine integral's 4.74h (+7%), the error growing with the step. Only
    // below the cap (above it a dollar more earns nothing) and on a curve
    // (the flat rate keeps its old closed form).
    const incF = shapedCap ? incFactor(money, capGain, capC.cap) : 1
    const add = (rateS - spend) * dt * incF + Math.max(0, capGain)
    if (!(add > 0) && money + add <= 0) return Infinity // the spend empties the balance first
    // The last step lands exactly: without this the answer is quantised to
    // stepH, and a with/without comparison of a small spend reads as zero
    // (or as a whole step) — noise deciding purchases.
    //
    // o.targetAt(h) (optional): a target that FALLS while the money is saved —
    // a donation shrinking as faction work earns the same reputation
    // (hoursToRep, workWhileDonating). Landed by solving the step linearly.
    if (tgtAt !== null) {
      const T0 = tgtAt(h)
      const T1 = tgtAt(h + sH)
      if (money >= T0) return h
      if (add > 0 && money + add >= T1) {
        if (!(capGain > 0)) return h + Math.min(1, Math.max(0, (T0 - money) / (add + T0 - T1))) * sH
        // Compounding: land on the curve against the falling target (below).
        const stepGain = stepFnOf(money, dt, capOn)
        let lo = 0
        let hi = dt
        for (let k = 0; k < LAND_HALVINGS; k++) {
          const mid = (lo + hi) / 2
          const c = stepGain(mid)
          if (money + (rateS - spend) * mid * (shapedCap ? incFactor(money, c, capC.cap) : 1) + Math.max(0, c) >= tgtAt(h + mid / 3600)) hi = mid
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
      const stepGain = stepFnOf(money, dt, capOn)
      const addOver = (s) => {
        const c = stepGain(s)
        return (rateS - spend) * s * (shapedCap ? incFactor(money, c, capC.cap) : 1) + Math.max(0, c)
      }
      let lo = 0
      let hi = dt
      for (let k = 0; k < LAND_HALVINGS; k++) {
        const mid = (lo + hi) / 2
        if (money + addOver(mid) >= target) hi = mid
        else lo = mid
      }
      return h + hi / 3600
    }
    money += add
    // o.expRateAt(level): the exp rate rising with the level (expRateShape),
    // at the step's opening level; absent, the constant rate.
    exp += dExp
    h += sH
  }
  return Infinity
}
/** The largest relative move of the level's income inside one money-leg step (hoursToMoney). */
export const LVL_STEP = 0.25
/** Halvings of a money leg's landing step: the step / 2^26 (< 1e-4 s on a 2h step). */
export const LAND_HALVINGS = 26

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
/**
 * THE FINAL WINDOW'S GENERATED CONTRACTS as the exit faction's reputation by
 * absolute hour t, or null when `c` is absent or unreadable.
 *
 *   c.perContract   expected faction reputation of ONE contract, over every
 *                   faction it can reach (contractplan.expectedReward)
 *   c.factions      how many joined hacking-work factions share it (the exit
 *                   faction included): the exit faction's share is 1/factions
 *                   — one at random or all split evenly (gainCodingContractReward)
 *   c.hashCum       [[ageH, hashes]]: the rebuilt fleet's gross production
 *                   since the window's install (lifeplan.freshHacknetStreams),
 *                   used when an install opens the window
 *   c.hashPerSec    the live fleet's rate, when the final window is now
 *   c.level0        the upgrade's level now (the install resets it to 0)
 *
 * From `joinAt` (the rep leg cannot start before the join, and a contract
 * solved before it pays other factions) every hash buys contracts at the
 * rising price contractplan.contractsForHashes integrates. The fleet's money
 * (freshHacknet, lifeIncome) is left as it was: every money leg of the
 * window precedes the join, so a hash sold after it reaches no leg.
 */
function contractRepFn(c, { installsFirst, joinAt, finalStart }) {
  if (!c || !pos(c.perContract) || !(Number.isInteger(c.factions) && c.factions >= 1)) return null
  const perFaction = c.perContract / c.factions
  if (installsFirst > 0) {
    const cum = Array.isArray(c.hashCum) ? c.hashCum.filter((p) => Array.isArray(p) && num(p[0]) && num(p[1])) : []
    if (cum.length < 2) return null
    const at = (age) => {
      if (age <= cum[0][0]) return cum[0][1]
      for (let i = 1; i < cum.length; i++) if (age <= cum[i][0]) return cum[i - 1][1] + ((cum[i][1] - cum[i - 1][1]) * (age - cum[i - 1][0])) / (cum[i][0] - cum[i - 1][0] || 1)
      const n = cum.length
      return cum[n - 1][1] + ((cum[n - 1][1] - cum[n - 2][1]) / (cum[n - 1][0] - cum[n - 2][0] || 1)) * (age - cum[n - 1][0])
    }
    const h0 = at(joinAt - finalStart)
    return (t) => perFaction * contractsForHashes(Math.max(0, at(t - finalStart) - h0), 0)
  }
  if (!pos(c.hashPerSec)) return null
  const lvl = num(c.level0) && c.level0 >= 0 ? c.level0 : 0
  return (t) => perFaction * contractsForHashes(Math.max(0, t - joinAt) * 3600 * c.hashPerSec, lvl)
}

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

/**
 * Step functions of node hours ([{atH, perSec}], each step replacing the
 * rate from its hour on) summed into one. Null/empty lists are skipped; a
 * single list comes back sorted and filtered as extraIncome always was.
 */
export function mergeSteps(lists) {
  const parts = (Array.isArray(lists) ? lists : []).map((l) => (Array.isArray(l) ? l.filter((x) => num(x?.atH) && num(x?.perSec) && x.perSec >= 0).sort((a, b) => a.atH - b.atH) : [])).filter((l) => l.length)
  if (parts.length <= 1) return parts[0] ?? []
  const hs = [...new Set(parts.flatMap((l) => l.map((x) => x.atH)))].sort((a, b) => a - b)
  const at = (l, t) => {
    let v = 0
    for (const x of l) {
      if (x.atH > t) break
      v = x.perSec
    }
    return v
  }
  return hs.map((t) => ({ atH: t, perSec: parts.reduce((a, l) => a + at(l, t), 0) }))
}

/**
 * mergeSteps of (extraIncome, carriedIncome) once per pair of input objects:
 * every policy of every draw shares them (applyDraw copies the inputs, not
 * the arrays), and the filter/sort per exit simulation was ~4% of a plan pass.
 * The lists must not be mutated once passed in.
 */
const stepsMemo = new WeakMap()
/** Each lift step's growth factor, once per (steps, income, eBudget): a gang's ~100 steps took a pow each, per exit simulation. */
const growthMemo = new WeakMap()
function growthTableOf(list, income, e) {
  let byKey = growthMemo.get(list)
  if (!byKey) growthMemo.set(list, (byKey = new Map()))
  const key = `${income}|${e}`
  let v = byKey.get(key)
  if (!v) {
    if (byKey.size > 64) byKey.clear()
    byKey.set(key, (v = list.map((x) => Math.pow((income + x.perSec) / income, e))))
  }
  return v
}
const NO_STEPS = {}
/**
 * THE MONEY MULTIPLE EACH LATER LIFE WALKS (exitHours perLife). `steps`
 * [{atH, perSec}] sorted, each in force from its atH to the next (before the
 * first, 0; the last holds); life j (0-based) spans [startH + j x lenH, +lenH).
 * k_j = 1 + integral of max(0, perSec) over the life / (base x lenH). Lives
 * whose span sits inside one step share a k, so the result is run-length
 * encoded: {runs: [{k, n}], mean, first, last, peak}. base <= 0 or no steps:
 * every k is 1.
 */
export function lifeStreamMultiples(steps, base, startH, lenH, lives) {
  const one = { runs: [{ k: 1, n: lives }], mean: 1, first: 1, last: 1, peak: 1 }
  if (!pos(base) || !Array.isArray(steps) || !steps.length || !pos(lenH) || !(lives > 0)) return one
  const rate = (i) => (i < 0 ? 0 : Math.max(0, steps[i].perSec))
  // Integral of the rate from 0 to T (hours x $/s): prefix sums at each
  // step's start, then the step in force by bisection — exitHours runs this
  // per simulation, up to 400 lives over ~100 steps.
  const n = steps.length
  const x0 = steps.map((s) => Math.max(0, s.atH))
  const cum = new Array(n)
  cum[0] = 0
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + rate(i - 1) * Math.max(0, x0[i] - x0[i - 1])
  const integ = (T) => {
    if (T <= x0[0]) return 0
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (x0[m] <= T) lo = m
      else hi = m - 1
    }
    return cum[lo] + rate(lo) * (T - x0[lo])
  }
  const runs = []
  let sum = 0
  let peak = 1
  let first = null
  let last = 1
  const lastAt = steps[steps.length - 1].atH
  let j = 0
  while (j < lives) {
    const a = startH + j * lenH
    // Every life starting at or after the last step walks the last rate: one run.
    if (a >= lastAt) {
      const k = 1 + rate(steps.length - 1) / base
      const n = lives - j
      runs.push({ k, n })
      sum += k * n
      peak = Math.max(peak, k)
      if (first === null) first = k
      last = k
      break
    }
    const k = 1 + (integ(a + lenH) - integ(a)) / (base * lenH)
    const prev = runs[runs.length - 1]
    if (prev && Math.abs(prev.k - k) < 1e-12) prev.n++
    else runs.push({ k, n: 1 })
    sum += k
    peak = Math.max(peak, k)
    if (first === null) first = k
    last = k
    j++
  }
  return { runs, mean: sum / lives, first: first ?? 1, last, peak }
}

function stepsOf(extra, carried) {
  const a = Array.isArray(extra) ? extra : NO_STEPS
  const b = carried && typeof carried === 'object' ? carried : NO_STEPS
  let byB = stepsMemo.get(a)
  if (!byB) stepsMemo.set(a, (byB = new WeakMap()))
  let v = byB.get(b)
  if (!v) byB.set(b, (v = mergeSteps([a === NO_STEPS ? null : a, ...(b === NO_STEPS ? [] : Object.values(b))])))
  return v
}

/**
 * THE PURCHASE MODEL'S MONEY -> GAIN, for the later lives' money lifts
 * (exitHours lifeLift). `cadence.table` (lifeplan.cadenceByPurchases, carried
 * on the exit inputs): per life length L, the money a life of that length
 * earns (calibrated) and the mean gain its lifeSequence buys over the node's
 * lives from the depleting catalogue at 1.9x escalation. Read as ln(ln G)
 * against ln(money), piecewise linear, non-decreasing; below the table ln G
 * falls in proportion to the money, above it it stays at the richest row (a
 * floor on what more money buys: never extrapolated upward). mL: the money of
 * a life of `L` hours (interpolated in ln L); gL its gain. Returns
 * {mL, gL, lnGainAt(m), lnGainRatio(K)} or null (no table, not the purchase
 * model's cadence, or nothing bought at any length).
 */
/**
 * THE LIVES ONE BY ONE. The purchase model's table row at L carries each
 * life's own ln gain (lifeplan.lifeTableGen `seq`): the catalogue depletes,
 * so the first lives after an install buy most of what it holds. The exit's
 * cycle gain (multGainPerCycle) is the cadence posterior at L — the model's
 * MEAN life scaled by this node's own lives — so life j is priced at
 *   ln g_j = (ln multGainPerCycle / mean) x seq_j
 * — the same total over the sequence, in the order the purchases happen.
 * `skipLn`: the first install's batch beyond the batch the table was built
 * after (installGains / persistBaseline, hacking): those augmentations are
 * gone from the front of the catalogue, so the sequence starts that far in
 * (fractional lives, in the model's ln). Past the sequence's horizon, the
 * mean, as every life was priced before (the table prices no further) — or,
 * for a sequence grown past its mean's horizon (shape.n), the rate its last
 * quarter reached. Returns {at(i): the factor on install i's cycle gain
 * (i >= 1; past the sequence, 1 or the reached rate's), end: the first install
 * index past the sequence} or null (no shape, another L, or a cadence that
 * buys nothing).
 */
export function cadenceShapeOf(shape, { cycleHours, multGainPerCycle, skipLn = 0 } = {}) {
  if (!shape || !Array.isArray(shape.ln) || !shape.ln.length || !pos(cycleHours) || !num(shape.L) || Math.abs(shape.L - cycleHours) > 1e-9) return null
  if (!pos(multGainPerCycle) || multGainPerCycle <= 1) return null
  const seq = shape.ln.map((v) => (num(v) && v > 0 ? v : 0))
  const n = seq.length
  const total = seq.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  const mean = total / n
  const lnG = Math.log(multGainPerCycle)
  // THE SEQUENCE AT THE MULTIPLIER REACHED (lifeplan.lifeGrowthOf): the
  // row's sequence runs past its mean's horizon (shape.n lives), each life
  // buying with the money and reputation of the multiplier the sequence has
  // reached, and shape.mean is the row's lnMean — the model at TODAY's money
  // over those n lives, the quantity the cadence posterior's prior and the
  // ledger's recorded predictions are (lifetimes cadenceModel). So the scale
  // is the posterior over that model, and what the growth adds on top of it
  // is priced on top (where measured lives drive the posterior, part of the
  // growth they measured is in g already: the shape errs high there, stated).
  // Without them (a row before the growth): the mean of the whole sequence.
  const nMean = Number.isInteger(shape.n) && shape.n > 0 && shape.n < n ? shape.n : n
  const meanN = pos(shape.mean) ? shape.mean : nMean === n ? mean : seq.slice(0, nMean).reduce((a, b) => a + b, 0) / nMean
  if (!(meanN > 0)) return null
  const scale = lnG / meanN
  const S = [0]
  for (const v of seq) S.push(S[S.length - 1] + v)
  // Past the sequence: its mean — or, where it runs past the mean's horizon
  // (shape.n), the rate its last quarter reached (the lives there buy at the
  // multiplier reached, not at the first lives').
  const tail = nMean === n ? mean : seq.slice(n - Math.max(1, Math.floor(n / 4))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(n / 4))
  const past = tail > 0 ? tail : mean
  const pastF = nMean === n ? 1 : Math.exp(scale * past - lnG)
  // Cumulative model ln at fractional life x (the rate past the horizon).
  const Sat = (x) => {
    if (x <= 0) return 0
    if (x >= n) return total + (x - n) * past
    const k = Math.floor(x)
    return S[k] + (x - k) * seq[k]
  }
  // Where the sequence starts: the fractional life at which the cumulative reaches skipLn.
  let x0 = 0
  const skip = num(skipLn) && skipLn > 0 ? skipLn : 0
  if (skip >= total) x0 = n + (skip - total) / past
  else if (skip > 0) {
    let k = 0
    while (k < n && S[k + 1] < skip) k++
    x0 = k + (seq[k] > 0 ? (skip - S[k]) / seq[k] : 0)
  }
  const lives = Math.max(0, Math.ceil(n - x0 - 1e-9))
  const f = []
  for (let j = 1; j <= lives; j++) f.push(Math.exp(scale * (Sat(x0 + j) - Sat(x0 + j - 1)) - lnG))
  return { at: (i) => (i >= 1 && i <= f.length ? f[i - 1] : i > f.length ? pastF : 1), end: f.length + 1, x0, scale, lives: f.length, pastF }
}

export function purchaseGainOf(cadence, L, from = null) {
  if (from !== 'purchase model' && cadence?.source !== 'purchase model') return null
  const rows = (Array.isArray(cadence?.table) ? cadence.table : []).filter((r) => pos(r?.L) && pos(r?.money) && pos(r?.gain))
  const pts = rows
    .filter((r) => r.gain > 1)
    .map((r) => [Math.log(r.money), Math.log(Math.log(r.gain))])
    .sort((a, b) => a[0] - b[0])
  if (!pts.length || !pos(L)) return null
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1]
  const lnlnAt = (lm) => {
    if (lm <= pts[0][0]) return pts[0][1] + (lm - pts[0][0])
    const last = pts[pts.length - 1]
    if (lm >= last[0]) return last[1]
    let j = 1
    while (pts[j][0] < lm) j++
    const [x0, y0] = pts[j - 1]
    const [x1, y1] = pts[j]
    return y0 + ((y1 - y0) * (lm - x0)) / (x1 - x0)
  }
  const lnGainAt = (m) => (pos(m) ? Math.exp(lnlnAt(Math.log(m))) : 0)
  const byL = rows.map((r) => [Math.log(r.L), Math.log(r.money)]).sort((a, b) => a[0] - b[0])
  const ll = Math.log(L)
  let lmL
  if (ll <= byL[0][0]) lmL = byL[0][1] + (ll - byL[0][0])
  else if (ll >= byL[byL.length - 1][0]) lmL = byL[byL.length - 1][1]
  else {
    let j = 1
    while (byL[j][0] < ll) j++
    lmL = byL[j - 1][1] + ((byL[j][1] - byL[j - 1][1]) * (ll - byL[j - 1][0])) / (byL[j][0] - byL[j - 1][0])
  }
  const mL = Math.exp(lmL)
  const base = lnGainAt(mL)
  return { mL, gL: Math.exp(base), lnGainAt, lnGainRatio: (K) => lnGainAt(mL * K) - base }
}

// ---------------------------------------------------------------------------
// THE GO FARM IN A LIFE (o.go.farm, goplan.goExitInputsOf) — what each later
// life's batch gains from the farm that life plays, simulated over the life.
//
// Node power restarts at 0 at every install (Go.prestigeAugmentation,
// Go/Go.ts:34-47) and accrues at the arm's rate while go.js plays it (and
// keeps its effect after go.js moves on, until the install); the bonus is
// CalculateEffect (Go/effects/effect.ts:16-22, goplan.effectAt) at the node's
// GoPower and SF14, and it multiplies (effect.ts calculateMults):
//   Netburners    hacknet_node_money — the rebuilt fleet's flow (freshHacknet)
//   TheBlackHand  hacking_money — the hack side of the scripts' money
//                 (hackShare, goweights' elasticity)
//   Illuminati    hacking_speed — every H/G/W time /speed (Hacking.ts:75), so
//                 the scripts' money AND exp: the level, so faction work
//                 (linear in the level, reputation.ts:16)
//   Daedalus      faction_rep
// go.js's RAM takes `ramShare` of the scripts' stream (money and exp) while
// it runs. Over one life of L hours from its install, at multiplier `mult`,
// in GO_LIFE_STEPS midpoint steps, with the farm against without go.js:
//   Km = sum(fleet eN + flat + scripts(level) eI (1 + hs (eB - 1)) (1 - ram)) / sum(fleet + flat + scripts(level0))
//   Kr = sum(level eD) / sum(level0)       (the scripts' exp x eI x (1 - ram))
// and the life's batch grows by ln = lnInc(Km) + liftShare x eRep x ln Kr —
// the planner's own responses (the purchase model's money -> gain, eRep), the
// ones the later lives' other lifts use (exitHours lifeLift). Plans: each arm
// the whole life, and every ordered pair half and half (a coarse mix grid);
// the best is kept, and no farm (ln 0) when every plan costs more than it
// earns. Not simulated: the fleet's faster rebuild on its own larger
// production (flow x eN: a floor), Illuminati's level in the hacknet or
// contract streams.
// ---------------------------------------------------------------------------

const GO_LIFE_STEPS = 24
const goLifeMemo = new Map()

/**
 * Every per-life farm plan's money and reputation multiples (Km, Kr) at the
 * farm `f` ({goPower, sf14, arms, hackShare, ramShare}) with its rates scaled
 * by `rateScale`. ctx: {L, mult, expF, expS, expK (the exp rate F + S + K (level + 50):
 * F the sleeves' flat part, S and K the scripts' constant and per-level
 * parts — those the bonus and the RAM scale), fleet (sorted [{atH, perSec}] from the install), flatPerSec,
 * incomeAtLevel1}. Memoised on those numbers. Returns [{plan, Km, Kr}].
 */
export function goLifePlansOf(f, ctx, rateScale = 1) {
  const L = ctx?.L
  if (!f || !f.arms || !pos(L) || !pos(ctx.mult)) return []
  const key = JSON.stringify([f.goPower, f.sf14, f.arms, f.hackShare, f.ramShare, L, ctx.mult, ctx.expF, ctx.expS, ctx.expK, ctx.fleet, ctx.flatPerSec, ctx.incomeAtLevel1, rateScale])
  const hit = goLifeMemo.get(key)
  if (hit) return hit
  const arms = Object.keys(f.arms).filter((k) => pos(f.arms[k]?.powerPerH) && pos(f.arms[k]?.bonusPower))
  const ram = num(f.ramShare) ? Math.min(1, Math.max(0, f.ramShare)) : 0
  const hs = num(f.hackShare) ? Math.min(1, Math.max(0, f.hackShare)) : 0
  const N = GO_LIFE_STEPS
  const dt = L / N
  const fleet = Array.isArray(ctx.fleet) ? ctx.fleet : []
  const fleetAt = (age) => {
    let v = 0
    for (const x of fleet) {
      if (x.atH <= age) v = x.perSec
      else break
    }
    return v
  }
  const expF = pos(ctx.expF) ? ctx.expF : 0
  const expK = pos(ctx.expK) ? ctx.expK : 0
  const expS = pos(ctx.expS) ? ctx.expS : 0
  const flat = pos(ctx.flatPerSec) ? ctx.flatPerSec : 0
  const inc1 = pos(ctx.incomeAtLevel1) ? ctx.incomeAtLevel1 : 0
  // One path: exp from 0 at the affine rate, the scripts' part (k) x the
  // Illuminati bonus x what go.js leaves of their RAM; the level at each
  // step's middle.
  const pathOf = (scaleAt) => {
    const lv = []
    let e = 0
    for (let j = 0; j < N; j++) {
      const sc = scaleAt(j)
      const r = expF + expS + expK > 0 ? affineRate(expF + expS * sc, expK * sc) : null
      const em = r ? expAfterHours(e, dt / 2, ctx.mult, r) : e
      lv.push(Math.max(1, contLevel(em, ctx.mult)))
      if (r) e = expAfterHours(e, dt, ctx.mult, r)
    }
    return lv
  }
  const lvl0 = pathOf(() => 1)
  const fl = Array.from({ length: N }, (_, j) => fleetAt((j + 0.5) * dt))
  let m0 = 0
  let l0 = 0
  for (let j = 0; j < N; j++) {
    m0 += fl[j] + flat + (inc1 * (lvl0[j] + 50)) / 51
    l0 += lvl0[j]
  }
  const plans = [...arms.map((k) => [[k, L]])]
  for (const a of arms) for (const b of arms) if (a !== b) plans.push([[a, L / 2], [b, L]])
  const out = plans.map((plan) => {
    // Each arm's power at step j's middle: banked while it is played, kept after.
    const E = Array.from({ length: N }, (_, j) => {
      const t = (j + 0.5) * dt
      const e = {}
      let from = 0
      for (const [k, until] of plan) {
        const n = f.arms[k].powerPerH * rateScale * Math.max(0, Math.min(t, until) - from)
        e[k] = n > 0 ? effectAt(n, f.arms[k].bonusPower, f.goPower ?? 1, f.sf14 ?? 0) : 1
        from = until
      }
      return (k) => e[k] ?? 1
    })
    const lv = pathOf((j) => E[j]('Illuminati') * (1 - ram))
    let m = 0
    let l = 0
    for (let j = 0; j < N; j++) {
      const x = E[j]
      m += fl[j] * x('Netburners') + flat + ((inc1 * (lv[j] + 50)) / 51) * x('Illuminati') * (1 + hs * (x('TheBlackHand') - 1)) * (1 - ram)
      l += lv[j] * x('Daedalus')
    }
    return { plan: plan.map(([k, u]) => (u < L ? `${k} to ${u.toFixed(2)}h` : k)).join(' then '), Km: m0 > 0 ? m / m0 : 1, Kr: l0 > 0 ? l / l0 : 1 }
  })
  if (goLifeMemo.size > 256) goLifeMemo.clear()
  goLifeMemo.set(key, out)
  return out
}

/**
 * The best plan's ln lift of a life's batch: ln = lnInc(Km) + liftShare x
 * eRep x ln Kr over goLifePlansOf, and no farm (ln 0) when none gains.
 * Returns {ln, plan, Km, Kr}.
 */
export function goLifeLnOf(f, ctx, rateScale = 1, { lnInc = () => 0, eRep = 0, liftShare = 1 } = {}) {
  let best = { ln: 0, plan: 'none', Km: 1, Kr: 1 }
  for (const p of goLifePlansOf(f, ctx, rateScale)) {
    const ln = lnInc(p.Km) + (pos(eRep) ? liftShare * eRep * Math.log(p.Kr) : 0)
    if (num(ln) && ln > best.ln) best = { ...p, ln }
  }
  return best
}

export function exitHours(o = {}, installsAt = null, quiet = false) {
  // installsAt: the policy's install count, when the caller passes it beside
  // the inputs rather than in them (the policy search: a copy of the inputs
  // per policy priced was ~8% of the plan's CPU). quiet: the legs' text is
  // not built (the search prices every policy and reads only the best's).
  const D = quiet ? () => '' : (f) => f()
  const installsFirst = num(installsAt) ? installsAt : num(o.installsFirst) ? o.installsFirst : 0
  const {
    // measured state
    money = 0,
    incomePerSec,
    hacking,
    hackingExp = 0,
    hackingMult,
    expPerSec,
    repPerSec,
    // The exit faction TODAY: its reputation in hand (a member's) and its
    // favor (a faction's favor persists through installs, member or not).
    exitRep: exitRepNow = 0,
    exitFavor: exitFavorNow = 0,
    // measured per-cycle behaviour, from the lifetimes ledger
    cycleHours,
    multGainPerCycle,
    // The hacking-multiplier gain of the batch ACTUALLY being assembled for
    // the next install, when there is one. Optional; see below.
    nextInstallGain = null,
    // the gates
    exitLevel,
    joinMoney: joinMoneyNow = 0,
    // The exit faction's hacking requirement for the INVITATION (Daedalus:
    // haveSkill hacking 2500, FactionInfo.tsx), which must hold at the same
    // time as the money in hand: the reputation leg cannot start before it.
    joinLevel: joinLevelNow = 0,
    // THE INVITATION AGAIN AFTER AN INSTALL (rejoinMoney / rejoinLevel): a
    // member publishes joinMoney 0 (nothing to join today), but every install
    // ends the membership (Faction.prestigeAugmentation: isMember = false,
    // alreadyInvited = false), so a final window after one hoards the money
    // and climbs to the level again. Absent: as before.
    rejoinMoney = 0,
    rejoinLevel = 0,
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
    // THE FINAL WINDOW'S HASHES AS REPUTATION (contractRep, hacknet SERVERS
    // only — contractRepFn below): from the exit faction's join, every hash
    // buys a generated coding contract whose reward shares faction rep over
    // the joined hacking-work factions, the exit faction among them. Absent:
    // the rep leg is ground (or donated) exactly as before.
    contractRep = null,
    // A MULTIPLIER ON THE EXP RATE THAT THE NEXT INSTALL DESTROYS (an IPvGO
    // hacking_speed bonus, goweights.js): under "hold to the exit" it scales
    // every exp accrual before the terminal install and is gone for the climb
    // after it (Go.prestigeAugmentation zeroes node power, Go/Go.ts:34-47).
    // Under any policy with an install it ends before any leg simulated here,
    // so it does nothing. Default 1: every other caller prices as before.
    preInstallExpMult = 1,
    // THE SAME FOR REPUTATION (preInstallRepMult): the IPvGO Daedalus bonus
    // multiplies faction_rep (Go/effects/effect.ts calculateMults) and the
    // install zeroes its node power (Go.prestigeAugmentation), so the rate
    // measured today — the formula at today's faction_rep — carries a factor
    // the life after any install starts without. Divided out of the rate (and
    // into a donation's price) from the first install on; its regrowth in
    // the new life is not simulated, on either side of an install (the new
    // life prices at its own current bonus): a floor. Live BN9 2026-09-30
    // 21:31Z: +51% in the rate the install priced the final window on.
    preInstallRepMult = 1,
    // THE EXP RATE RISES WITH THE LEVEL (expRateShape): expPerSec is the rate
    // at today's level `hacking`, and every leg integrates it as (level + 50)
    // (freshlife.js, the game's hack/grow/weaken times). expFlatPerSec is the
    // part that does not (the sleeves' exp transfer). Absent: the constant
    // rate, exactly as before.
    expScalesWithLevel = false,
    expFlatPerSec = 0,
  } = o
  // WHAT AN INSTALL DOES TO THE EXIT FACTION (Faction.ts prestigeAugmentation,
  // run on every faction by Prestige.ts): favor += repToFavor of the rep in
  // hand (addRepToFavor), then the rep is 0 and the membership gone. So under
  // any policy with an install the final window starts from 0 rep, at the
  // converted favor, and joins again — it was priced from today's rep, at
  // today's favor, joined (live BN9 2026-09-30 21:31:41Z: 201k Daedalus rep
  // counted after the install, favor 85.5 where the install banks 131.4, the
  // $100b re-join unpriced; tools/sim/exitjump/attribute-2131.mjs).
  const lostAtInstall = installsFirst > 0
  const exitRep = lostAtInstall ? 0 : exitRepNow
  const exitFavor0 = num(exitFavorNow) && exitFavorNow > 0 ? exitFavorNow : 0
  const exitFavor = lostAtInstall && num(exitRepNow) && exitRepNow > 0 ? addRepToFavor(exitFavor0, exitRepNow) : exitFavor0
  const joinMoney = lostAtInstall ? Math.max(num(joinMoneyNow) ? joinMoneyNow : 0, num(rejoinMoney) ? rejoinMoney : 0) : joinMoneyNow
  const joinLevel = lostAtInstall ? Math.max(num(joinLevelNow) ? joinLevelNow : 0, num(rejoinLevel) ? rejoinLevel : 0) : joinLevelNow
  // THE FINAL WINDOW'S TWO GO SCHEDULES (o.goFinal, priced at the window's
  // start below): offered where an install opens the window with a fleet to
  // rebuild and a join to hoard for; both simulated, the sooner kept.
  const farmF = o.go?.farm ?? null
  const netb = farmF?.arms?.Netburners
  const canHacknet = !!(farmF && netb && pos(netb.powerPerH) && pos(netb.bonusPower) && installsFirst > 0 && Array.isArray(o.freshHacknet) && o.freshHacknet.some((x) => num(x?.atH) && pos(x?.perSec)) && pos(joinMoney) && joinMoney > (num(installCash) && installCash >= 0 ? installCash : 1262))
  if (canHacknet && o.goFinal !== 'rep' && o.goFinal !== 'hacknet') {
    const a = exitHours({ ...o, goFinal: 'rep' }, installsFirst, quiet)
    const b = exitHours({ ...o, goFinal: 'hacknet' }, installsFirst, quiet)
    return num(b.hours) && (!num(a.hours) || b.hours < a.hours) ? b : a
  }
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
  // THE COMMITTED STREAMS (o.carriedIncome {name: [{atH, perSec}]}), every
  // one a step function of node hours like extraIncome and summed with it: the
  // plan's committed choices that earn money beside the scripts — the gang
  // (its income as it grows, a gang persisting through installs), the sleeves
  // on crime (committed objective 'money') — so every decision prices the
  // node with them, not only the decision that chose them. A decision that
  // prices one of them itself (the sleeve objective, the gang) removes its
  // own stream from carriedIncome first: each stream counted once.
  const steps = stepsOf(extraIncome, o.carriedIncome)
  // The augmentation lift (eBudget, below) reads extraIncome alone: a
  // carried stream is priced in the money legs, never as a lift on the
  // measured cadence — its denominator (incomePerSec) is the scripts' stream
  // only, and a gang's $m/s over a $20k/s hacking stream lifted every cycle
  // x1.6 (eBudget 0.1): a multiplier of 1.7e7 after 47 installs.
  const liftSteps = stepsOf(extraIncome, null)
  // The step in force at t: the last (in sorted order) with atH <= t, by
  // bisection — the money legs ask it every integration step and a simulated
  // gang schedule has ~100 steps (it was a scan, the gang and sleeve
  // decisions' largest cost after the climb).
  const stepIn = (list, t) => {
    let lo = 0
    let hi = list.length - 1
    let at = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (list[m].atH <= t) {
        at = m
        lo = m + 1
      } else hi = m - 1
    }
    return at
  }
  const stepAt = (t) => stepIn(steps, t)
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
  const stepGrowth = growOn ? growthTableOf(liftSteps, incomePerSec, eBudget) : null
  void stepGrowth
  const repLiftAt = (t) => (t >= repFrom ? repLift : 1)
  // The later income step in force at t, as the factor K on the scripts' stream.
  const incomeKAt = (t) => {
    if (!pos(incomePerSec) || !liftSteps.length) return 1
    const i = stepIn(liftSteps, t)
    return i < 0 ? 1 : (incomePerSec + Math.max(0, liftSteps[i].perSec)) / incomePerSec
  }
  // The largest per-cycle extra (the check's allowance).
  const perCycleExtraMax = (() => {
    if (!perCycleExtra) return 1
    if (Array.isArray(perCycleExtra.byInstall)) return Math.max(1, ...perCycleExtra.byInstall.filter(pos))
    return cycleExtraAt(1e9)
  })()

  // Income is priced when ANY source is measured positive. A node whose only
  // income is the trader's compounding return (BitNode 8: scripted hacking
  // pays ScriptHackMoneyGain = 0) has incomePerSec 0 and is still priceable.
  const flatInc = num(flatIncomePerSec) && flatIncomePerSec > 0 ? flatIncomePerSec : 0
  const capR = num(capitalReturnPerSec) && capitalReturnPerSec > 0 ? capitalReturnPerSec : 0
  // THE TRADER'S CURVE IN FORCE (every money leg reads it): the inputs' own
  // until the 4S TIX API is bought (o.fourS), the 4S curve from then on.
  let curve = { r: capR, W: capitalScaleW, sh: capitalShape }
  // THE 4S MARKET DATA TIX API (o.fourS {cost, when: 'life1' | 'final', r0PerSec, Wstar, shape}):
  // bought once, it PERSISTS through every install of the node (prestigeAugmentation
  // leaves Player.has4SDataTixApi alone; only prestigeSourceFile clears it,
  // PlayerObjectGeneralMethods.ts:166) and the trader reads the real forecasts
  // (ns.stock.getForecast needs it alone, NetscriptFunctions/StockMarket.ts:229)
  // — its curve r(W) is the 4S one from the purchase on. 'life1': paid in the
  // current life like a graft of that life (the life first earns the price
  // from its balance, then runs its own length: lifeGraftLeg), the curve
  // switched from the next life on; 'final': paid first thing in the final
  // window from the post-install balance. With no install before the final
  // window both are the final window's first leg. Not simulated: the 4S
  // curve inside the rest of the current life and in the intermediate lives'
  // batches (their money is the measured cadence) — both only favour buying.
  const four = o.fourS && pos(o.fourS.cost) && pos(o.fourS.r0PerSec) ? o.fourS : null
  const fourCurve = four ? { r: four.r0PerSec, W: pos(four.Wstar) ? four.Wstar : curve.W, sh: four.shape ?? curve.sh } : null
  const FOUR_NAME = '4S Market Data TIX API'
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
    const moneyH = cost <= money0 ? 0 : hoursToMoney(cost, { money0, incomeAtLevel1, mult: m, exp0, expPerSec, expRateAt: shapedHere ? expRateShape(expPerSec, { scales: true, ref: hacking, flat: pos(expFlatPerSec) ? expFlatPerSec : 0 }) : null, extraAt: steps.length ? (rel) => extraAt(atH + rel) : null, flatPerSec: flatInc + (first && pos(lifeIncome) ? lifeIncome : 0), capitalReturnPerSec: curve.r, capitalCap, capitalScaleW: curve.W, capitalShape: curve.sh, spendPerSec, capitalWarmupH: !first && num(capitalWarmupH) ? capitalWarmupH : 0 })
    if (!num(moneyH)) return { lifeH: null, why: `could not price the money for ${specs.length} graft(s) in an earlier life ($${Math.round(cost)})` }
    const lifeH = moneyH + Math.max(slot, baseH)
    return { lifeH, extraH: lifeH - baseH, moneyH, slotH: slot, cost, n: specs.filter((x) => x.name !== FOUR_NAME).length, g, ...(specs.some((x) => x.name === FOUR_NAME) ? { fourS: true } : {}) }
  }

  // GRAFTS IN THE LIVES BEFORE THE FINAL WINDOW (o.lifeGrafts [{life, ...graftSpecOf}]).
  // Resolved against this policy's install count: a graft scheduled in a life
  // the policy does not have (life > installsFirst) is grafted in the final
  // window instead, ahead of o.finalGrafts (lifeGraftsOf).
  const lifeSched = lifeGraftsOf(o.lifeGrafts, installsFirst)
  if (lifeSched.bad) return { hours: null, why: lifeSched.bad }
  // 4S in the current life: its price joins life 1's (a graft of that life with no slot and no multipliers).
  const fourInLife1 = !!four && installsFirst > 0 && four.when === 'life1'
  if (fourInLife1) lifeSched.byLife.set(1, [...(lifeSched.byLife.get(1) ?? []), { name: FOUR_NAME, cost: four.cost, slotH: 0, hacking: 1, exp: 1, rep: 1, money: 1, life: 1 }])
  const finalGrafts = [...lifeSched.spill, ...(Array.isArray(o.finalGrafts) ? o.finalGrafts : [])]
  // What the earlier lives' grafts did to the player's multipliers: exp and
  // the reputation/donation rates act from the final window on (below).
  let lifeGE = 1
  // The exit faction's favor at the final window: today's, or what a favor life banked (o.favorLife).
  let favorBanked = num(exitFavor) && exitFavor > 0 ? exitFavor : 0
  let favorLifeOut = null
  let goLifeOut = null
  let goFinalOut = null
  let lifeLegsOut = []
  let perLifeOut = null
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
    if (pos(preInstallRepMult) && preInstallRepMult > 1) {
      if (pos(repRate)) repRate /= preInstallRepMult
      if (pos(donation)) donation *= preInstallRepMult
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
    void persistLiftRef
    // THE LATER LIVES' LIFTS, ONE FUNCTION (lifeLift): the reputation lifts
    // (this batch's rep beyond the baseline, a graft's rep, a sleeve's
    // repBoost) as K^eRep scaled by liftShare; the MONEY lifts (this batch's
    // income beyond the baseline, a graft's hacking_money, a later income
    // step) through the PURCHASE MODEL where the cadence is its
    // (lifeplan.cadenceByPurchases: each life length's money and the gain its
    // lifeSequence buys from the depleting catalogue at 1.9x escalation) — a
    // life of money m lifted by K buys G(mK) / G(m), not K^e. Live BN9
    // 2026-09-29 20:22Z the 3 grafts of life 1 lifted every later 0.5h life
    // by their money^eBudget x rep^eRep, unscaled: 42 lives of x1.153 each
    // (mult 1.10 -> 20.3, exit 33.2h) where the purchase model buys x1.0016
    // with a 0.5h life's $62m. Without the purchase model's table, K^e scaled
    // by liftShare.
    const buyer = purchaseGainOf(o.cadence, cycleHours, o.cadenceFrom)
    const ratioRep = ratio('rep')
    const ratioInc = ratio('income')
    const lnRepPart = (gRep) => (num(eRep) && eRep > 0 ? eRep * Math.log(ratioRep * gRep) : 0)
    const lnIncPart = (K) => (!(K > 0) || K === 1 || !(num(eBudget) && eBudget > 0) ? 0 : buyer ? buyer.lnGainRatio(K) : eBudget * Math.log(K) * liftShare)
    const lifeLift = (t, gRep, gMoney) => Math.exp(liftShare * (lnRepPart(gRep) + Math.log(repLiftAt(t))) + lnIncPart(ratioInc * gMoney * incomeKAt(t)))
    // Cycle by cycle, so a later-arriving income can lift the cycles after it.
    mult = hackingMult * firstGain * (Array.isArray(perCycleExtra?.byInstall) ? cycleExtraAt(0) : 1)
    // THE GO FARM IN EVERY LATER LIFE (o.go.farm, goLifeLnOf): each life
    // installed from here on farms from 0 — the best arm (or pair) of the
    // node's farm lifts its batch by goNow.ln, through the same responses as
    // every other lift. DE-BIASED: the measured cadence's own lives (share
    // `embedded.ownShare`, the cadence posterior's own weight) already carried
    // the farm they played (goplan.GO_EMBEDDED: GoPower 1, no SF14, the
    // release-1 rates), so that farm's lift is taken out of g on their share
    // — g x e^(now - ownShare x then). The current life's batch (the first
    // install) is its own measured plan: untouched.
    let goGain = 1
    if (o.go?.farm && installsFirst > 1) {
      const f = o.go.farm
      const shapedL = expScalesWithLevel === true && pos(hacking)
      const R = (pos(expPerSec) ? expPerSec : 0) * (pos(installGains?.exp) && installGains.exp >= 1 ? installGains.exp : 1)
      const F = shapedL ? Math.min(R, pos(expFlatPerSec) ? expFlatPerSec : 0) : 0
      const fleetL = Array.isArray(o.freshHacknet) ? o.freshHacknet.filter((x) => num(x?.atH) && num(x?.perSec) && x.perSec >= 0).sort((a, b) => a.atH - b.atH) : []
      const ctx = { L: cycleHours, mult, expF: F, expS: shapedL ? 0 : R, expK: shapedL ? (R - F) / (hacking + 50) : 0, fleet: fleetL, flatPerSec: flatInc, incomeAtLevel1 }
      const resp = { lnInc: (K) => lnIncPart(ratioInc * K) - lnIncPart(ratioInc), eRep: num(eRep) && eRep > 0 ? eRep : 0, liftShare }
      const now = goLifeLnOf(f, ctx, 1, resp)
      const emb = f.embedded ?? null
      const ownShare = num(emb?.ownShare) ? Math.min(1, Math.max(0, emb.ownShare)) : 0
      const then = emb && ownShare > 0 ? goLifeLnOf({ ...f, goPower: emb.goPower ?? 1, sf14: emb.sf14 ?? 0 }, ctx, num(emb.rateScale) && emb.rateScale >= 0 ? emb.rateScale : 1, resp) : { ln: 0, plan: 'none', Km: 1, Kr: 1 }
      const ln = now.ln - ownShare * then.ln
      goGain = Math.exp(ln)
      goLifeOut = { ln, now, then, ownShare, lives: installsFirst - 1 }
    }
    const gCyc = multGainPerCycle * goGain
    // THE CATALOGUE DEPLETES (o.cadenceShape, lifeplan.lifeInputsOf): later
    // life j buys the purchase sequence's j-th life, scaled by the posterior,
    // after whatever the first install's batch took beyond the table's own
    // baseline batch — not the 48h mean every life. Live BN12 2026-10-09: the
    // install at 14:01:56Z priced its next life at the 6h mean (x1.13) where
    // the sequence's first 6h life buys x2.0, and the new life priced that
    // life by its own planned batch (x1.43 at 2h): 18.1h against 13.7h, EXIT
    // JUMP AT INSTALL. Past the sequence, the mean as before.
    const shape = cadenceShapeOf(o.cadenceShape, { cycleHours, multGainPerCycle, skipLn: pos(installGains?.hacking) && pos(persistBaseline?.hacking) ? Math.log(installGains.hacking / persistBaseline.hacking) : 0 })
    const shapeAt = shape ? shape.at : () => 1
    const shapeEnd = shape ? shape.end : 0
    // A GRAFT PERSISTS THROUGH EVERY LATER INSTALL (it is pushed onto
    // Player.augmentations, AugmentationHelpers.ts:65, which Prestige.ts:122
    // re-applies; its entropy stack too, Prestige.ts:128). So a graft in life
    // j multiplies the multiplier from then on, its hacking_money the
    // level-scaled income, and its reputation (and income, where the batch
    // responds to money: eBudget) lifts every LATER life's batch by the same
    // measured K^e responses persistLift uses — from the install after the
    // grafting life (the life that grafts earns its batch's reputation with
    // the slot partly held by the grafting).
    let graftRepK = 1
    let graftMoneyK = 1
    const applyLifeGrafts = (leg) => {
      mult *= leg.g.hacking
      lifeGE *= leg.g.exp
      incomeAtLevel1 *= leg.g.money
      if (pos(repRate)) repRate *= leg.g.rep
      if (pos(donation)) donation /= leg.g.rep
      if (pos(leg.g.rep)) graftRepK *= leg.g.rep
      if (pos(leg.g.money)) graftMoneyK *= leg.g.money
    }
    if (g1) applyLifeGrafts(g1)
    // The check's baseline: after the first install and life 1's grafts; the
    // later lives' own grafts are purchases of their own (graftHackLater).
    const multAfterFirst = mult
    let graftHackLater = 1
    // 4S bought in life 1: every later life's legs, and the final window's, trade on the 4S curve.
    if (fourInLife1) curve = fourCurve
    const lifeLegs = g1 ? [{ life: 1, ...g1 }] : []
    // Nothing varies by cycle (no later income, no delayed rep lift, no
    // per-install extra): one power, not a loop — the policy search prices
    // k = 1..400 and the loop made it quadratic (live BN9 2026-09-29, 0.5h
    // cycles, the optimum at ~325 installs). Lives that graft are walked one
    // by one up to the last of them, and the power covers the rest.
    const cycleAt = (i, t) => gCyc * lifeLift(t, graftRepK, graftMoneyK) * cycleExtraAt(i) * shapeAt(i)
    // ...and past the last hour at which anything varies (the last income
    // step, where it moves the growth; the rep lift's start; a per-cycle
    // extra's first install) every later cycle is the same: one power again.
    // Exact — the loop multiplied the same factor.
    const lastStepH = growOn && liftSteps.length ? liftSteps[liftSteps.length - 1].atH : 0
    const cycleFrom = perCycleExtra && !Array.isArray(perCycleExtra.byInstall) ? (num(perCycleExtra.fromInstall) && perCycleExtra.fromInstall >= 1 ? perCycleExtra.fromInstall : 2) : 0
    const stableAt = (i, t) => !Array.isArray(perCycleExtra?.byInstall) && i + 1 >= cycleFrom && i >= shapeEnd && t >= repFrom && t >= lastStepH
    const lastGraftLife = lifeSched.lastLife
    let t = firstH
    let i = 1
    // The next hour at which a cycle's factor can change (a lift step, the rep
    // lift's start), after t — the lives between walk as one power.
    const nextBreak = (t) => {
      let nb = Infinity
      if (t < repFrom) nb = repFrom
      if (growOn && liftSteps.length) {
        const j = stepIn(liftSteps, t) + 1
        if (j < liftSteps.length && liftSteps[j].atH < nb) nb = liftSteps[j].atH
      }
      return nb
    }
    for (; i < installsFirst && (i < lastGraftLife || !stableAt(i, t)); i++) {
      // A RUN OF PLAIN LIVES (no graft, no per-install extra, the per-cycle
      // extra already on) until the factor next changes: one power, exactly
      // the product the one-by-one walk took (a gang's income schedule has
      // ~100 steps, each hours long: a 0.5h cadence walked ~200 lives per
      // exit simulation).
      if (i >= lastGraftLife && !Array.isArray(perCycleExtra?.byInstall) && i + 1 >= cycleFrom && i >= shapeEnd) {
        const nb = nextBreak(t)
        const n = Math.min(installsFirst - i, Math.max(1, Math.ceil((nb - t) / cycleHours - 1e-12)))
        if (n > 1) {
          mult *= Math.pow(cycleAt(i, t), n)
          t += n * cycleHours
          i += n - 1
          continue
        }
      }
      const life = i + 1
      // Install `life` ends this life: its batch is lifted by the grafts of
      // the lives before it, not by this life's own.
      const liftBefore = lifeLift(t, graftRepK, graftMoneyK)
      let len = cycleHours
      if (lifeSched.byLife.has(life)) {
        const leg = lifeGraftLeg(lifeSched.byLife.get(life), { baseH: cycleHours, money0: num(installCash) && installCash >= 0 ? installCash : 1262, mult, exp0: 0, first: false, atH: t })
        if (!num(leg.lifeH)) return { hours: null, why: leg.why }
        len = leg.lifeH
        h += len - cycleHours
        applyLifeGrafts(leg)
        if (pos(leg.g.hacking)) graftHackLater *= leg.g.hacking
        lifeLegs.push({ life, ...leg })
      }
      mult *= gCyc * liftBefore * cycleExtraAt(i) * shapeAt(i)
      t += len
    }
    if (i < installsFirst) mult *= Math.pow(cycleAt(i, t), installsFirst - i)
    lifeLegsOut = lifeLegs
    // THE EXIT FACTION'S FAVOR BANKED IN AN EARLIER LIFE (o.favorLife {rep}):
    // the LAST life before the final window (life installsFirst, a fresh life
    // after an install — the current one cannot reach the join here) joins
    // the exit faction and grinds `rep` before its install, which converts it
    // to favor (Faction.ts:79 prestigeAugmentation: setFavor(addRepToFavor(
    // favor, playerReputation))). The final window's reputation then runs at
    // x(1 + favor/100) (reputation.ts:8-13) and, past favorToDonate
    // (donation.ts:17), may be donated. The life's own legs are that window's
    // join (money in hand from the install balance, the join level) and the
    // rep leg, simulated as a final window of the policy one install shorter
    // (no grafts, no climb): it lasts max(its cycle, those legs). Its batch is
    // held at the cadence's (the Daedalus augmentations the banked rep could
    // buy are not simulated — a floor). Absent, or a policy with fewer than
    // two installs: no favor life, exactly as before.
    const fl = o.favorLife
    if (fl && pos(fl.rep) && installsFirst >= 2 && pos(terminalRep)) {
      const nested = exitHours({ ...o, favorLife: null, favorStream: null, lifeGrafts: (Array.isArray(o.lifeGrafts) ? o.lifeGrafts : []).filter((g) => Number.isInteger(g?.life) && g.life < installsFirst), finalGrafts: [], graftStartMoney: 0, fourS: four && four.when === 'life1' ? four : null, covenant: null, terminalRep: fl.rep, exitRep: 0, exitFavor, exitLevel: 1, finalRootCost: 0, freshExpLagH: 0, slotBusyH: 0, donationCost: null }, installsFirst - 1, true)
      if (!num(nested.hours) || !num(nested.finalStartH)) return { hours: null, why: `could not price the favor life (${fl.rep} rep): ${nested.why ?? 'unpriced'}` }
      const L = nested.hours - nested.finalStartH
      const last = lifeLegs.find((l) => l.life === installsFirst)
      const lenLast = last ? last.lifeH : cycleHours
      const ext = Math.max(0, L + (last ? last.slotH : 0) - lenLast)
      h += ext
      const f1 = addRepToFavor(num(exitFavor) && exitFavor > 0 ? exitFavor : 0, fl.rep)
      favorLifeOut = { life: installsFirst, rep: fl.rep, legsH: L, lifeH: lenLast + ext, extraH: ext, favor: f1 }
      favorBanked = f1
    }
    // THE PRICED PER-LIFE GAIN against what the purchase model buys (plan
    // perLifeGainCheckOf: PER-LIFE GAIN UNBOUGHT): the later lives' mean ln
    // gain, and the most a life of this length can buy — its modelled money
    // times every income the node carries (the carried streams included),
    // through the same table.
    if (installsFirst > 1) {
      // PER LIFE, AT ITS OWN HOURS. Each later life k (2..installsFirst)
      // spans [firstH + (k-2) x cycleHours, + cycleHours) from now; its money
      // multiple is 1 + (the carried streams integrated over exactly those
      // hours) / (incomePerSec x cycleHours) — the money that life walks, not
      // the schedule's PEAK. The peak was a gang schedule's last simulated
      // hour ($7.76m/s at hour ~100 over ~$62k/s: x125) applied to every
      // life, so no over-priced life could ever show (live BN9 2026-09-29).
      // The bound is the mean of the per-life bounds, against the mean
      // priced gain. Lives stretched by grafts are placed at the cadence
      // (their extra hours only move later lives onto richer steps, so this
      // errs low on the stream, and a graft life's money is its own leg).
      const lives = installsFirst - 1
      const ks = lifeStreamMultiples(steps, incomePerSec, firstH, cycleHours, lives)
      const kAll = ks.mean
      const lnBought = (k) => buyer.lnGainAt(buyer.mL * k * ratioInc * graftMoneyK)
      // The sequence's shape over exactly these lives is what the purchase
      // model buys on them (cadenceShapeOf): in the bound as in the price.
      let shapeLn = 0
      for (let j = 1; j < installsFirst; j++) shapeLn += Math.log(shapeAt(j))
      const boughtFixed = buyer ? Math.log(gCyc / buyer.gL) + liftShare * (lnRepPart(graftRepK) + Math.log(repLift)) + Math.log(perCycleExtraMax) + shapeLn / lives : null
      const boughtMoney = buyer ? ks.runs.reduce((a, r) => a + r.n * lnBought(r.k), 0) / lives : null
      perLifeOut = { lives, cycleHours, pricedLn: Math.log(mult / multAfterFirst / graftHackLater) / lives, boughtLn: buyer ? boughtMoney + boughtFixed : null, moneyL: buyer ? buyer.mL : null, kAll, kFirst: ks.first, kLast: ks.last, kPeak: ks.peak }
    }
    if (lifeLegs.length) {
      legs.push({ leg: 'grafts in earlier lives', hours: lifeLegs.reduce((a, l) => a + l.extraH, 0), detail: D(() => lifeLegs.map((l) => `life ${l.life}: ${l.n} graft(s)${l.fourS ? ' + the 4S TIX API' : ''} $${(l.cost / 1e9).toFixed(2)}b, ${l.slotH.toFixed(2)}h slot, money ${l.moneyH.toFixed(2)}h, life ${l.lifeH.toFixed(2)}h (+${l.extraH.toFixed(2)}h), hacking x${l.g.hacking.toFixed(3)}`).join('; ')) })
    }
    exp = 0
    // PlayerObjectGeneralMethods.ts:102 ($1262), or Prestige.ts:158's $250m in
    // BitNode 8 — which REPLACES the balance, positions included (the market
    // re-initialises, Prestige.ts:166-170).
    cash = num(installCash) && installCash >= 0 ? installCash : 1262
    legs.push({ leg: 'install cycles', hours: firstH + (installsFirst - 1) * cycleHours, detail: D(() => `first after ${firstH.toFixed(2)}h, then ${installsFirst - 1} x ${cycleHours.toFixed(2)}h, mult ${hackingMult.toFixed(2)} -> ${mult.toFixed(2)}${goLifeOut ? `; the Go farm each later life: ${goLifeOut.now.plan} (money x${goLifeOut.now.Km.toFixed(3)}, rep x${goLifeOut.now.Kr.toFixed(3)}: ln ${goLifeOut.now.ln.toFixed(4)}) less the cadence lives' own ${goLifeOut.then.plan} (ln ${goLifeOut.then.ln.toFixed(4)} x ${goLifeOut.ownShare.toFixed(2)}): g x${Math.exp(goLifeOut.ln).toFixed(4)}` : ''}`) })
    if (favorLifeOut) legs.push({ leg: 'favor life', hours: favorLifeOut.extraH, detail: D(() => `life ${favorLifeOut.life} joins the exit faction and banks ${Math.round(favorLifeOut.rep)} rep in ${favorLifeOut.legsH.toFixed(2)}h (life ${favorLifeOut.lifeH.toFixed(2)}h, +${favorLifeOut.extraH.toFixed(2)}h): favor ${favorLifeOut.favor.toFixed(1)} in the final window`) })
  }

  // The exp rate can rise mid-window (a Covenant sleeve's transfer), so the
  // legs read this rather than the input.
  let expRate = expPerSec
  // THE PLAYER'S EXP MULTIPLIERS DO NOT REACH THE SLEEVES' TRANSFER: the flat
  // part of a shaped rate (expFlatPerSec, the fleet's exp to the player) is
  // applied without the player's hacking_exp ("The receiving sleeves and the
  // player do not apply their xp multipliers from augs", applySleeveGains,
  // Sleeve/Work/Work.ts:16-24) — so a graft's or a batch's exp multiplies the
  // rest only. It multiplied the whole rate: live BN9 2026-09-30 the fleet's
  // 66 exp/s studying read x4.2 (x2.26 life grafts, x1.86 the batch) and
  // priced the fleet's study at -0.81h where it is ~0.
  const flatIn = expScalesWithLevel === true && pos(hacking) && pos(expFlatPerSec) && pos(expRate) ? Math.min(expFlatPerSec, expRate) : 0
  const byPlayerMult = (m) => {
    if (pos(expRate)) expRate = (expRate - flatIn) * m + flatIn
  }
  // Earlier lives' grafts' hacking_exp (lifeGrafts), from the final window on.
  if (lifeGE !== 1) byPlayerMult(lifeGE)
  // The batch's hacking_exp scales the player's own exp from the install on.
  if (installsFirst > 0 && pos(installGains?.exp) && installGains.exp >= 1) byPlayerMult(installGains.exp)
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
  // THE FINAL WINDOW'S OWN HACKNET (o.freshHacknet [{atH: hours since the
  // window's install, perSec}], lifeplan.freshHacknetFlow): the fleet an
  // install deletes is rebuilt in every fresh life, the final one included,
  // and in BitNode 9 it out-earns the scripts ~40x. Only where an install
  // opens the window: under hold-to-exit the live fleet is lifeInc.
  const fleet = installsFirst > 0 && Array.isArray(o.freshHacknet) ? o.freshHacknet.filter((x) => num(x?.atH) && num(x?.perSec) && x.perSec >= 0).sort((a, b) => a.atH - b.atH) : []
  const fleetAt = (age) => {
    let lo = 0
    let hi = fleet.length - 1
    let at = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (fleet[m].atH <= age) {
        at = m
        lo = m + 1
      } else hi = m - 1
    }
    return at < 0 ? 0 : fleet[at].perSec
  }
  let eNet = null
  const moneyLeg = (target, targetAt = null) => {
    const t0 = h
    const age0 = h - finalStart
    const fl = eNet ? (age) => fleetAt(age) * eNet(age) : fleetAt
    const ex = steps.length && fleet.length ? (rel) => extraAt(t0 + rel) + fl(age0 + rel) : steps.length ? (rel) => extraAt(t0 + rel) : fleet.length ? (rel) => fl(age0 + rel) : null
    // flatPerSec carries the node's flat income PLUS, under hold-to-exit only,
    // the hacknet stream the next install would destroy (lifeInc).
    return hoursToMoney(target, { money0: cash, incomeAtLevel1, mult, exp0: exp, expPerSec: expRate, expRateAt: shaped ? expAt() : null, extraAt: ex, flatPerSec: flatInc + lifeInc, capitalReturnPerSec: curve.r, capitalCap, capitalScaleW: curve.W, capitalShape: curve.sh, targetAt, spendPerSec, capitalWarmupH: installsFirst > 0 && num(capitalWarmupH) ? Math.max(0, capitalWarmupH - (h - finalStart)) : 0 })
  }
  // The final window starts here; `slotH` is what it needs of the work slot.
  const finalStart = h
  // THE FINAL WINDOW'S FARM BEFORE THE RED PILL (o.goFinal 'rep' | 'hacknet';
  // absent: both simulated, the sooner kept). 'rep': Daedalus from the
  // window's install (o.go.rep, the ground reputation leg's faction_rep).
  // 'hacknet': Netburners (o.go.farm.arms) on the fleet the window rebuilds
  // (freshHacknet x CalculateEffect from the install, its effect kept after
  // the switch, Go.ts:34-47 zeroes it only at an install) until the join, then
  // Daedalus from 0 at the join. Offered where the window has a fleet and a
  // join to hoard for. Not simulated: Illuminati before the Red Pill (the join
  // level and the level-scaled grind), go.js's RAM in the window's scripts.
  // (The two schedules branch at the top of this function, before anything is simulated twice.)
  const goHacknet = canHacknet && o.goFinal === 'hacknet'
  let goJoinAge = null
  eNet = goHacknet ? (age) => effectAt(netb.powerPerH * Math.max(0, goJoinAge === null ? age : Math.min(age, goJoinAge)), netb.bonusPower, farmF.goPower ?? 1, farmF.sf14 ?? 0) : null
  if (farmF) goFinalOut = { final: goHacknet ? 'Netburners to the join, then Daedalus' : 'Daedalus from the install' }
  // THE SLEEVES' EXP TRANSFER ACROSS THE WINDOW (sleeveExp): it reaches the
  // player from the window's start, not only on the climb — every money leg,
  // the join level and the level-scaled rep leg bank it, and at a fresh
  // life's level 1 the scripts' own rate is a sliver of it (live BN9
  // 2026-09-30: 66 exp/s studying against ~18 exp/s from the scripts at
  // level 1). Priced on the climb alone (sleeve.js's study price) it could
  // not move the exit at all; across the window it is small but real
  // (-0.015h for the fleet there, tools/sim/slotlevers.mjs lever 3). FLAT beside
  // the level-shaped rate (the player's exp mults do not apply to it:
  // applySleeveGains), at the rate in force when the window opens (a delay
  // or ramp ending inside the window is priced from the climb on only — a
  // floor). Taken back out before the climb, which adds it piecewise itself.
  const sExpW = sleeveExp && (pos(sleeveExp.perSec) || (Array.isArray(sleeveExp.steps) && sleeveExp.steps.some((x) => pos(x?.perSec)))) ? sleeveRateFn(sleeveExp)(finalStart) : 0
  if (sExpW > 0) {
    expRate = (pos(expRate) ? expRate : 0) + sExpW
    if (shaped) expFlat += sExpW
  }
  let slotH = 0
  // THE WORK SLOT HELD FROM NOW (o.slotBusyH): something else occupies it for
  // this many hours first — the gang's karma grind (gangworth.gangExit). Only
  // when the final window IS now (installsFirst 0); a grind inside an earlier
  // life moves that life's cadence, which this model holds at its measured
  // rate — not simulated, and gangworth says so.
  const busyH = installsFirst === 0 && num(o.slotBusyH) && o.slotBusyH > 0 ? o.slotBusyH : 0
  slotH += busyH

  // 4S bought in the final window (or now, when the final window is now): its
  // price first, from the window's balance, then every later leg on the 4S curve.
  if (four && !fourInLife1) {
    if (four.cost > cash) {
      const hm = moneyLeg(four.cost)
      if (!num(hm)) return { hours: null, why: 'could not price the money for the 4S TIX API' }
      h += hm
      exp = expAdv(exp, hm)
      cash = four.cost
      legs.push({ leg: '4S money', hours: hm, detail: D(() => `$${Math.round(four.cost)} for the ${FOUR_NAME}`) })
    }
    cash -= four.cost
    curve = fourCurve
  }

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
  // THE ORDER ON THE WORK SLOT (o.slotOrder 'grafts' | 'rep'; absent: the
  // better of the two, simulated): the final window's grafts and a ground
  // reputation leg share one slot, so one waits for the other. Grafts first
  // DOMINATES whenever the set leaves the reputation rate no lower at any
  // hour — hacking x rep >= 1 and exp >= 1 over the set: the grind then
  // starts later, at a level that is only higher, on a rate that is only
  // higher, while the contracts, sleeves and favor stream bank through the
  // wait — so the other order is simulated only when that screen fails
  // (a set whose entropy outweighs it). Interleavings are not searched.
  // 'rep': the grafts are paid where they are (before the join) but made
  // after the reputation leg, and none of their multipliers reach it.
  let slotOrder = o.slotOrder === 'rep' ? 'rep' : 'grafts'
  // REPLAYS ONLY (o.slotQueue === false): the accounting before the queue —
  // the grind priced from the join's level beside the grafts, the overlap
  // settled by the window's slot total. Records published before it reproduce
  // on it (their CHECK lines); no live caller sets it ([XM4]).
  const preQueue = o.slotQueue === false
  let applyGrafts = null
  let graftsAfter = 0
  if (finalGrafts.length) {
    if (o.slotOrder !== 'grafts' && o.slotOrder !== 'rep' && terminalRep > 0 && !preQueue) {
      let sH = 1
      let sE = 1
      let sR = 1
      for (const g of finalGrafts) {
        sH *= pos(g?.hacking) ? g.hacking : 1
        sE *= pos(g?.exp) ? g.exp : 1
        sR *= pos(g?.rep) ? g.rep : 1
      }
      if (!(sH * sR >= 1 && sE >= 1)) {
        const a = exitHours({ ...o, slotOrder: 'grafts' }, installsFirst, quiet)
        const b = exitHours({ ...o, slotOrder: 'rep' }, installsFirst, quiet)
        return num(b.hours) && (!num(a.hours) || b.hours < a.hours) ? b : a
      }
    }
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
      legs.push({ leg: 'graft start money', hours: hm, detail: D(() => `$${Math.round(startAt)} before the first graft`) })
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
        legs.push({ leg: 'graft money', hours: hm, detail: D(() => `$${Math.round(g.cost)} for ${g.name}`) })
      }
      cash -= g.cost
      if (slotOrder === 'grafts') graftDone = Math.max(h, graftDone) + g.slotH
      slotH += g.slotH
      gH *= g.hacking
      gE *= g.exp
      graftRep *= g.rep
      gM *= pos(g.money) ? g.money : 1
    }
    const gSlot = finalGrafts.reduce((a, g) => a + g.slotH, 0)
    applyGrafts = () => {
      mult *= gH
      // hacking_money and its entropy: the level-scaled income from the window on.
      incomeAtLevel1 *= gM
      // The player's exp multiplier: not the flat part (the sleeves', applySleeveGains).
      const flatNow = shaped ? expFlat : sExpW
      if (pos(expRate)) expRate = (expRate - flatNow) * gE + flatNow
      preExpBoost *= gE
      if (pos(repRate)) repRate *= graftRep
      if (pos(donation)) donation /= graftRep
    }
    if (slotOrder === 'grafts') {
      applyGrafts()
      applyGrafts = null
    }
    legs.push({ leg: 'grafts', hours: 0, detail: D(() => `${finalGrafts.length} graft(s)${lifeSched.spill.length ? ` (${lifeSched.spill.length} scheduled in lives this policy does not have)` : ''}, ${slotOrder === 'grafts' ? `slot until +${(graftDone - finalStart).toFixed(2)}h` : `${gSlot.toFixed(2)}h of slot after the reputation leg`}, hacking x${gH.toFixed(3)}, exp x${gE.toFixed(3)}, rep x${graftRep.toFixed(3)}`) })
    graftsAfter = slotOrder === 'rep' ? gSlot : 0
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
      legs.push({ leg: 'covenant money', hours: hm, detail: D(() => `$${Math.round(target)} in hand`) })
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
    legs.push({ leg: 'hoard join money', hours: hm, detail: D(() => `$${Math.round(joinMoney)} in hand${goHacknet ? `; the rebuilt fleet x${eNet(h - finalStart).toFixed(3)} by Netburners at the join` : ''}`) })
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
    legs.push({ leg: 'climb to join level', hours: hj, detail: D(() => `hacking ${joinLevel} with $${Math.round(joinMoney)} in hand`) })
  }

  if (terminalRep > 0) {
    if (goHacknet) goJoinAge = h - finalStart
    const fleetOn = !!sleeveRep && (pos(sleeveRep.perSec) || (Array.isArray(sleeveRep.steps) && sleeveRep.steps.some((x) => pos(x?.perSec))))
    const sRep = sleeveRateFn(fleetOn ? sleeveRep : null)
    // THE CONTRACTS' REPUTATION (contractRep): banked from the join (this
    // hour — the rep leg cannot start before it) until the ground work ends,
    // which is after the slot frees: rep by absolute hour t, or null.
    const slotWait = Math.max(0, Math.max(busyH, graftDone - finalStart) - (h - finalStart))
    const cRep = contractRepFn(contractRep, { installsFirst, joinAt: h, finalStart })
    // workWhileDonating (o, set by progress.js where donations open at favor
    // 0 — BitNode 8): the donation leg is priced with the slot's work (and
    // the best sleeve's, constant at its rate now) shrinking what is owed.
    // Reputation per hour is held at today's level-rate: a floor after an
    // install, when the level climbs back.
    const wwd = o.workWhileDonating === true
    // THE EXIT FACTION'S FAVOR. repPerSec (and a sleeve's term) is a BASE
    // rate — measured / (1 + favor/100) of the faction worked (progress.js
    // measuredBaseRepPerSec) — and faction work pays x(1 + favor/100) of the
    // faction worked (reputation.ts:8-13; SleeveFactionWork.getReputationRate
    // passes the faction's favor too), so the exit faction's own favor scales
    // both: today's (exitFavor), or what a favor life banked (favorBanked).
    // THE FAVOR IT GAINS DURING THE LEG (o.favorStream {repPerH, capRep}):
    // IPvGO wins against a faction's AI add favor to it while the player is a
    // member (Go/boardAnalysis/scoring.ts:66-78: every second win of a streak,
    // addRepToFavor(favor, getMaxRep()/200)), until the node's total reaches
    // getMaxRep() (Go/effects/effect.ts:30-43: 100k without Source-File 14),
    // `capRep` of it left: rep-equivalent per hour from the join. Contracts
    // are paid without favor (gainCodingContractReward).
    const fav0 = favorBanked
    // THE PLANNED FARM (o.go, goplan.goExitInputsOf): where go.js does not play
    // the exit faction today, the final window's farm on it is the plan's —
    // its favor stream from the join (o.go.favorStream, the same formula) and
    // its faction_rep bonus (o.go.rep below). A measured stream wins.
    const fsIn = o.favorStream && pos(o.favorStream.repPerH) ? o.favorStream : o.go?.favorStream && pos(o.go.favorStream.repPerH) ? o.go.favorStream : null
    const fStream = fsIn
    const fCap = fStream ? (num(fStream.capRep) && fStream.capRep >= 0 ? fStream.capRep : Infinity) : 0
    // THE DAEDALUS GO BONUS ON THE GRIND (o.go.rep {powerPerH, bonusPower,
    // goPower, sf14}): faction_rep x effect(node power) (Go/effects/effect.ts
    // CalculateEffect, goplan.effectAt), the power banked from the final
    // window's install (Go.prestigeAugmentation zeroes it, Go/Go.ts:34-47) at
    // the farm's rate — tj hours after the join, h - finalStart into the window.
    const gRep = o.go?.rep && pos(o.go.rep.powerPerH) && pos(o.go.rep.bonusPower) ? o.go.rep : null
    const goRepAt = gRep ? ((t0) => (tj) => effectAt(gRep.powerPerH * (t0 + Math.max(0, tj)), gRep.bonusPower, gRep.goPower ?? 1, gRep.sf14 ?? 0))(goHacknet ? 0 : Math.max(0, h - finalStart)) : null
    const fmBase = fStream ? (tj) => 1 + repToFavor(favorToRep(fav0) + Math.min(fCap, fStream.repPerH * Math.max(0, tj))) / 100 : () => 1 + fav0 / 100
    const fmAt = goRepAt ? (tj) => fmBase(tj) * goRepAt(tj) : fmBase
    const fm0 = fmAt(0)
    const P0 = pos(repRate) ? repRate : 0
    let r = hoursToRep(terminalRep, {
      rep0: exitRep,
      repPerSec: wwd ? P0 * fm0 : fleetOn ? (P0 + sRep(h)) * fm0 : pos(repRate) ? repRate * fm0 : repRate,
      donationCost: donation,
      favor: fav0,
      favorToDonate,
      moneyLeg,
      workWhileDonating: wwd,
      sleeveRepPerSec: wwd && fleetOn ? sRep(h) * fm0 : 0,
      slotFreeAt: Math.max(0, Math.max(busyH, graftDone - finalStart) - (h - finalStart)),
    })
    if (wwd && r.how === 'ground' && fleetOn) r = hoursToRep(terminalRep, { rep0: exitRep, repPerSec: (P0 + sRep(h)) * fm0 })
    // THE GO FAVOR CROSSES THE DONATION THRESHOLD INSIDE THE LEG (o.repRoute
    // 'cross'). The stream's favor is the faction's favor the moment it is
    // given (scoring.ts:74-77 setFavor, no install), and donating reads only
    // faction.favor >= 150 x FavorToDonate (donation.ts:16-18,
    // FactionRoot.tsx:104) — Go favor counts exactly as install-banked favor
    // does, and adds in rep space (addRepToFavor). So a window that opens
    // below the threshold with favorToRep(fav0) + the stream's cap left >=
    // favorToRep(threshold) can stop grinding and DONATE the remainder once
    // the stream has crossed it, crossGoFavorH hours after the join (each
    // getMaxRep()/200 award at the stream's rate). Priced before 2026-10-06
    // as a grind to the end: the favor only scaled the work (fmAt). Two
    // trajectories, the sooner kept: the grind (repRoute 'ground'), and
    // the money leg to the whole donation landing no sooner than the
    // crossing. NOT PRICED (a floor on the cross): the reputation the slot
    // grinds before the crossing, which would shrink the donation.
    const ftdN = num(favorToDonate) && favorToDonate >= 0 ? favorToDonate : null
    const crossH = fStream && ftdN !== null && fav0 < ftdN && pos(donation) && typeof r.how === 'string' && !r.how.startsWith('donated') ? crossGoFavorH(fav0, ftdN, fStream.repPerH, fCap) : null
    if (num(crossH) && o.repRoute !== 'ground' && o.repRoute !== 'donate') {
      if (o.repRoute === 'cross') {
        const hm = moneyLeg(donation)
        if (!num(hm)) return { hours: null, why: 'could not price the donation after the IPvGO favor crossing' }
        r = { hours: Math.max(crossH, hm), how: `donated $${Math.round(donation)} once IPvGO favor crossed ${ftdN} (+${crossH.toFixed(2)}h after the join)` }
      } else {
        const a = exitHours({ ...o, repRoute: 'cross' }, installsFirst, quiet)
        const b = exitHours({ ...o, repRoute: 'ground' }, installsFirst, quiet)
        return num(a.hours) && (!num(b.hours) || a.hours < b.hours) ? a : b
      }
    }
    // GROUND REPUTATION AS A TRAJECTORY. Faction-work rep is linear in the
    // player's hacking level (reputation.ts:16), and after an install the
    // level restarts from 1 and climbs as exp accrues — so the rep leg runs
    // at repPerSec x level(t)/level-now, not at today's rate. The sleeve's
    // term is not scaled (sleeves keep their skills across installs) and
    // joins at its delayH, measured FROM NOW like sleeveExp. Integrated in
    // two-minute steps; the last lands exactly.
    // THE WORK SLOT IS ONE QUEUE. The ground work holds the slot, so it starts
    // only once whatever holds it first is done (slotWait after the join: a
    // karma grind, the final window's grafts), at the LEVEL of that hour. It
    // was priced from the join's level with the slot's overlap settled only
    // by the window's total ("work slot binds"): a sooner join (more money)
    // then started the grind at a lower level while the slot was still
    // grafting, and the exit got LATER with income (live BN9 15:56Z: a
    // $10m/s gang stream 9.627h, $400m/s 9.698h, $1t/s 9.747h). The
    // contracts, the sleeves and the favor stream bank from the join,
    // through the wait; the player's own work from the wait's end. Returns
    // hours from the join; `slot` is the part of them on the work slot.
    const groundLeg = () => {
      const P = P0
      const legStart = h
      const need = terminalRep - exitRep
      const varies = installsFirst > 0 && pos(hacking)
      // The contracts as a rate constant inside each step (their banked rep
      // at the step's two ends), from the join.
      const qW = preQueue ? 0 : slotWait
      const cAt = cRep ? (t) => cRep(legStart + (preQueue ? slotWait : 0) + t) : () => 0
      const scale = varies ? (e) => levelAt(e, mult) / hacking : () => 1
      // One log per step: the level read for the rate is the level the
      // affine exp step starts from (expAdv's own path, not re-derived).
      const aff = shaped ? expAt().affine ?? null : null
      // Adaptive step (1/REP_STEPS of the leg at today's rate, never below 2
      // min) and a hard iteration cap — see hoursToMoney: this froze the game.
      // THE TRAPEZOID: the rate at both ends of each step (the level the
      // affine exp step reaches is computed anyway, for the next step), the
      // landing solved on the step's linear rate. The left sum it replaced
      // needed 300 steps a leg for a bias of ~0.5% of the leg (the rate only
      // rises); the trapezoid at REP_STEPS is within 0.05% of a 3000-step
      // integral ([FM8]) — the rep leg was ~40% of the plan pass's CPU.
      // A rate that does not vary with the level steps from one sleeve
      // break to the next; the wait's end is a break too.
      const eW = varies && qW > 0 ? expAdv(exp, qW) : exp
      const r0 = (P * scale(eW) + sRep(legStart + qW)) * fmAt(qW)
      // THE STEP FROM A RATE THE LEG REACHES, not its first minute's. Right
      // after an install with no leg before the grind (the exit faction
      // already joined: no join money to hoard, no join level to climb), the
      // leg starts at exp 0, level ~1: r0 is ~1/level-now of the grind, the
      // step est/REP_STEPS ran to the 250h cap, and the trapezoid over a
      // level climbing from 1 priced the grind 4-8x long (live BN9
      // 2026-09-30 18:06Z: Daedalus joined, the committed exit 22.1h ->
      // 39.9h, no event; the 1-install rep leg 10.5h against 2.5h converged
      // at 60 rep/s). today's level's rate (scale 1) bounds the step.
      const rRef = (P + sRep(legStart + qW)) * fmAt(qW)
      const est = Math.max(r0, rRef) > 0 ? need / Math.max(r0, rRef) / 3600 : 1e4
      const step = varies || cRep || fStream ? Math.max(1 / 30, Math.min(1e4, est) / (num(o.repSteps) && o.repSteps > 0 ? o.repSteps : REP_STEPS)) : 1e4
      let acc = cAt(0)
      let t = 0
      let e = exp
      let iter = 0
      // THE WAIT IN ONE STEP when no sleeve works the faction: only the
      // contracts bank then (the favor stream scales work, and there is
      // none), and their cumulative is exact — stepping through it at the
      // grind's step doubled the leg's cost (the plan pass +20%, [PP3]).
      if (qW > 0 && !fleetOn) {
        const cW = cAt(qW)
        if (cW >= need) {
          // The contracts alone cover it inside the wait: land by bisection.
          let lo = 0
          let hi = qW
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2
            if (cAt(mid) >= need) hi = mid
            else lo = mid
          }
          return { hours: hi, slot: 0, how: 'ground', contracts: need }
        }
        acc = cW
        e = eW
        t = qW
      }
      let L = varies ? contLevel(e, mult) : 0
      // The player's own work: none while the slot is held.
      const lvlRate = (lv, at) => (at < qW ? 0 : P * (varies ? Math.max(1, Math.floor(lv)) / hacking : 1))
      for (;;) {
        // The contracts (and sleeves) banked while the slot was busy may cover it.
        if (acc >= need) break
        if (t > 1e4 || iter++ > 3000) {
          t = Infinity
          break
        }
        // Land exactly on the sleeve's next rate change, and on the slot's
        // freeing, inside this step.
        const nb = fleetOn ? sleeveBreaks(sleeveRep, legStart + t)[0] : undefined
        let dt = Math.min(1e4 - t + 1e-9, typeof nb === 'number' && nb - (legStart + t) < step ? Math.max(1e-9, nb - (legStart + t)) : step)
        if (t < qW) dt = Math.max(1e-9, Math.min(dt, qW - t))
        // The sleeve's rate is constant inside the step (breaks end steps);
        // the favor multiplier is read at both ends, as the level is.
        const sec = dt * 3600
        const sl = fleetOn ? sRep(legStart + t) : 0
        const cr = cRep ? (cAt(t + dt) - cAt(t)) / sec : 0
        const r1 = (lvlRate(L, t) + sl) * fmAt(t) + cr
        let e2 = e
        let L2 = L
        if (varies) {
          e2 = aff ? affineStepFrom(e, L, dt, mult, aff, expAt()) : expAdv(e, dt)
          L2 = contLevel(e2, mult)
        }
        // A step ending on the wait's end is still inside it.
        const r2 = (lvlRate(L2, t) + sl) * fmAt(t + dt) + cr
        const add = ((r1 + r2) / 2) * sec
        if (add > 0 && acc + add >= need) {
          // acc + r1 x + (r2 - r1) x^2 / (2 sec) = need, 0 < x <= sec.
          const a = (r2 - r1) / (2 * sec)
          const rem = need - acc
          const x = Math.abs(a) * sec < 1e-9 * Math.max(r1, 1e-300) ? rem / r1 : (-r1 + Math.sqrt(Math.max(0, r1 * r1 + 4 * a * rem))) / (2 * a)
          t += Math.min(sec, Math.max(0, x)) / 3600
          break
        }
        acc += add
        e = e2
        L = L2
        t += dt
      }
      return { hours: t, slot: Math.max(0, t - qW), how: 'ground', contracts: cRep && num(t) ? Math.min(need, cAt(t)) : 0 }
    }
    const trajectory = fleetOn || installsFirst > 0 || cRep || fStream || goRepAt
    if (r.how === 'ground' && trajectory) r = groundLeg()
    // DONATING IS AN OPTION, NOT AN OBLIGATION (o.repRoute 'donate' |
    // 'ground'; absent: both): past the threshold the player may still
    // grind, and with a banked favor (x2.5 at 150) and a level that climbs
    // after the install the grind can beat saving the money. The two are
    // different TRAJECTORIES, not two leg lengths — a ground leg holds the
    // work slot (a graft, a gym campaign binds against it) and a donation
    // does not — so each is simulated to the exit and the sooner returned.
    // Only where a favor is banked or streamed, so a favor-0 threshold
    // (BitNode 8) prices as before.
    else if (typeof r.how === 'string' && r.how.startsWith('donated') && (fav0 > 0 || fStream) && o.repRoute !== 'donate' && o.repRoute !== 'cross') {
      if (o.repRoute === 'ground') r = trajectory ? groundLeg() : hoursToRep(terminalRep, { rep0: exitRep, repPerSec: pos(repRate) ? repRate * fm0 : repRate })
      else {
        const a = exitHours({ ...o, repRoute: 'donate' }, installsFirst, quiet)
        const b = exitHours({ ...o, repRoute: 'ground' }, installsFirst, quiet)
        return num(b.hours) && (!num(a.hours) || b.hours < a.hours) ? b : a
      }
    }
    if (!num(r.hours)) return { hours: null, why: `could not price the reputation leg: ${r.how}` }
    // A constant-rate grind (no trajectory) waits for the slot the same way.
    if (r.how === 'ground' && !num(r.slot)) r = { ...r, hours: (preQueue ? 0 : slotWait) + r.hours, slot: r.hours }
    h += r.hours
    if (r.how === 'ground') slotH += r.slot
    const waitH = r.how === 'ground' ? r.hours - r.slot : 0
    if (waitH > 0) legs.push({ leg: 'reputation waits for the slot', hours: waitH, detail: D(() => `the work slot is held ${slotWait.toFixed(2)}h past the join (${busyH > 0 ? 'the karma grind' : ''}${busyH > 0 && graftDone > finalStart + busyH ? ', ' : ''}${graftDone > finalStart + busyH ? 'the grafts' : ''}); contracts, sleeves and favor bank meanwhile`) })
    legs.push({ leg: 'exit reputation', hours: r.hours - waitH, detail: D(() => `${Math.round(terminalRep)} rep, ${r.how}${r.contracts > 0 ? ` (${Math.round(r.contracts)} of it from generated contracts, ${contractRep.factions} faction(s) sharing)` : ''}`) })
    exp = expAdv(exp, r.hours)
  }
  // 'rep' first: the grafts take the slot now, and their multipliers reach
  // the climb only.
  if (applyGrafts) {
    graftDone = Math.max(h, graftDone) + graftsAfter
    applyGrafts()
  }

  // The final install: skills reset, and the climb runs on the multiplier we
  // froze at. This is the leg the whole install-vs-hold trade turns on.
  // The sleeve's exp as its own term (sleeveExp {perSec, delayH}, delayH from
  // NOW): it joins the climb only once its delay has passed — the synchronise,
  // shock recovery or training it spends first. Piecewise, like sleeveRep.
  // The last graft finishes before the install that starts the climb.
  // The terminal install ends a pre-install exp bonus: the climb runs without it.
  if (preExpBoost !== 0) expRate = Math.max(0, expRate - preExpBoost)
  if (sExpW > 0) {
    expRate = Math.max(0, expRate - sExpW)
    if (shaped) expFlat = Math.max(0, expFlat - sExpW)
  }
  if (graftDone > h) {
    legs.push({ leg: 'grafts finish', hours: graftDone - h, detail: D(() => 'the climb waits for the last graft (an install cancels one in progress)') })
    h = graftDone
  }
  const expOn = !!sleeveExp && (pos(sleeveExp.perSec) || (Array.isArray(sleeveExp.steps) && sleeveExp.steps.some((x) => pos(x?.perSec))))
  // GO.JS'S RAM ON THE CLIMB (o.go.farm.ramShare): the farm plays through it
  // (w0r1d_d43m0n or Illuminati), so the scripts' part of the exp rate runs
  // on what it leaves; the flat part (the sleeves') is untouched.
  const ramC = farmF && num(farmF.ramShare) ? Math.min(1, Math.max(0, farmF.ramShare)) : 0
  if (ramC > 0 && pos(expRate)) {
    const fl0 = shaped ? Math.min(expRate, expFlat) : 0
    expRate = (expRate - fl0) * (1 - ramC) + fl0
  }
  // Hours from exp 0 to hacking `lvl` at `mult` in the fresh life after the terminal install.
  const climbFor = (lvl) => {
    let climb
    if (expOn) {
      // Segment by segment between the sleeve's rate changes: constant rate in
      // each, so each lands exactly.
      const need = expForLevel(lvl, mult)
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
          const tn = hoursToLevelShaped(lvl, mult, acc, rateAt)
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
    } else climb = climbTo(lvl, 0)
    return climb
  }
  // THE HIDDEN OPPONENT ON THE CLIMB (o.go.w0 {powerPerH, gamesPerH,
  // bonusPower 2, goPower, sf14}): The Red Pill installed, go.js can play
  // w0r1d_d43m0n (netscriptGoImplementation.ts:359), whose bonus is the
  // hacking SKILL multiplier (Go/Constants.ts bonusPower 2; effect.ts) — so
  // the exit level is reached at exitLevel / W of the climb's own multiplier
  // (expForLevel(L, mult x W) = expForLevel(L / W, mult)). Node power lands
  // once per FINISHED game (endGoGame), so W steps: W_k = effect(w0 tau k)
  // after k games (tau = 1/gamesPerH), and the climb ends at the first
  // passage — T(exitLevel / W_k) inside game k's span, or the moment game k
  // ends when the jump to W_k already clears the level (tools/sim/gameplan
  // go.mjs goWindow, the same scan; bisected here: T(W_k) falls and the
  // span's end rises in k). The policy search then prices WHEN to install The
  // Red Pill (fewer installs, a lower multiplier, a longer farmed climb).
  // Not priced, named: the higher level's faster exp (the shaped rate reads
  // the level without W — a floor), the openers' money leg's level.
  const w0 = o.go?.w0 && pos(o.go.w0.powerPerH) && pos(o.go.w0.gamesPerH) && pos(o.go.w0.bonusPower) ? o.go.w0 : null
  let climb = climbFor(exitLevel)
  let w0Out = null
  // A climb with no farm past any played horizon can be hours with it — the
  // low-install policies the farm makes feasible: the scan runs to
  // DEGENERATE_H of games at most (past it the exit is unpriced either way).
  if (w0 && num(climb) && climb > 0) {
    const tau = 1 / w0.gamesPerH
    const Wk = (k) => (k > 0 ? effectAt((w0.powerPerH / w0.gamesPerH) * k, w0.bonusPower, w0.goPower ?? 1, w0.sf14 ?? 0) : 1)
    const Tk = (k) => (k > 0 ? climbFor(exitLevel / Wk(k)) : climb)
    const done = (k) => {
      const t = Tk(k)
      return num(t) && t <= (k + 1) * tau
    }
    let lo = 0
    let hi = Math.max(0, Math.ceil(Math.min(climb, DEGENERATE_H) / tau))
    // done(hi) holds when climb <= DEGENERATE_H: T(W_hi) <= T(1) = climb <= (hi + 1) tau.
    if (!done(lo) && done(hi)) {
      while (hi - lo > 1) {
        const m = Math.floor((lo + hi) / 2)
        if (done(m)) hi = m
        else lo = m
      }
      lo = hi
    }
    const t = Math.max(Tk(lo), lo * tau)
    if (num(t) && t < climb) {
      w0Out = { games: lo, W: Wk(lo), withoutH: climb }
      climb = t
    }
  }
  // ILLUMINATI ON THE CLIMB INSTEAD (o.go.farm.arms.Illuminati): hacking_speed
  // x CalculateEffect from the Red Pill's install speeds the scripts' exp
  // (every H/G/W time /speed, Hacking.ts:75); the flat part (the sleeves')
  // is not theirs. Stepped (5% of the elapsed climb, >= 3 min), the rate
  // affine inside each step at its midpoint bonus, landing exactly in the
  // step that reaches the level. The sooner of the two arms is the climb.
  // Not simulated: a split between them, and Illuminati with a sleeve's
  // piecewise exp (expOn) — w0r1d_d43m0n alone there.
  const ill = farmF?.arms?.Illuminati
  if (ill && pos(ill.powerPerH) && pos(ill.bonusPower) && !expOn && pos(expRate) && pos(mult)) {
    const base = expAt()
    const aff = base.affine ?? { F: expRate, k: 0 }
    const F0 = shaped ? Math.min(aff.F, expFlat) : 0
    const S0 = aff.F - F0
    const eI = (t) => effectAt(ill.powerPerH * t, ill.bonusPower, farmF.goPower ?? 1, farmF.sf14 ?? 0)
    const need = expForLevel(exitLevel, mult)
    let e = 0
    let t = 0
    let tI = Infinity
    // SCREENED FIRST: the bonus only rises, so a climb at the bonus it would
    // reach by the other arm's finish, from the start, bounds it below — when
    // that is no sooner, Illuminati cannot win and the steps are skipped.
    const horizon = num(climb) ? Math.min(climb, DEGENERATE_H) : DEGENERATE_H
    const xMax = eI(horizon)
    const lb = hoursToLevelShaped(exitLevel, mult, 0, affineRate(F0 + S0 * xMax, aff.k * xMax))
    if (num(lb) && lb >= horizon) t = DEGENERATE_H
    for (let it = 0; it < 2000 && t < DEGENERATE_H; it++) {
      const dt = Math.max(0.05, 0.05 * t)
      const x = eI(t + dt / 2)
      const r = affineRate(F0 + S0 * x, aff.k * x)
      const land = need <= e ? 0 : hoursToLevelShaped(exitLevel, mult, e, r)
      if (num(land) && land <= dt) {
        tI = t + land
        break
      }
      e = expAfterHours(e, dt, mult, r)
      t += dt
    }
    if (num(tI) && (!num(climb) || tI < climb)) {
      w0Out = { arm: 'Illuminati', E: eI(tI), withoutH: num(w0Out?.withoutH) ? w0Out.withoutH : climb, w0H: climb }
      climb = tI
    }
  }
  if (farmF || w0) goFinalOut = { ...(goFinalOut ?? {}), climb: w0Out?.arm === 'Illuminati' ? 'Illuminati' : w0Out ? 'w0r1d_d43m0n' : 'none (the climb is not shortened)' }
  if (!num(climb)) return { hours: null, why: 'could not price the final climb' }
  // The climb starts in a FRESH life: exp reset, fleet re-rooted, low targets
  // first — its measured lag behind a constant rate is charged once.
  const lagH = climb > 0 && num(freshExpLagH) && freshExpLagH > 0 ? freshExpLagH : 0
  h += climb + lagH
  legs.push({ leg: 'climb to exit level', hours: climb + lagH, detail: D(() => `hacking ${exitLevel} at mult ${mult.toFixed(2)} from a fresh life (exp reset by the terminal install${lagH ? `, +${lagH.toFixed(2)}h measured fresh-life ramp` : ''})${w0Out?.arm === 'Illuminati' ? `; Illuminati farmed from The Red Pill: hacking speed x${w0Out.E.toFixed(3)} at the level, ${w0Out.w0H.toFixed(2)}h on w0r1d_d43m0n, ${w0Out.withoutH.toFixed(2)}h without a farm` : w0Out ? `; w0r1d_d43m0n farmed from The Red Pill: x${w0Out.W.toFixed(3)} after ${w0Out.games} game(s), ${w0Out.withoutH.toFixed(2)}h without it` : ''}`) })
  // Rooting w0r1d_d43m0n: the openers bought again from the reset balance,
  // concurrent with the climb — only the excess binds.
  if (pos(finalRootCost)) {
    const money0 = num(installCash) && installCash >= 0 ? installCash : 1262
    const rootIn = { money0, incomeAtLevel1, mult, exp0: 0, expPerSec: expRate, expRateAt: shaped ? expAt() : null, flatPerSec: flatInc, capitalReturnPerSec: curve.r, capitalCap, capitalScaleW: curve.W, capitalShape: curve.sh, capitalWarmupH: num(capitalWarmupH) ? capitalWarmupH : 0 }
    // SCREENED FIRST: the leg binds only past the climb, and it almost never
    // does (minutes against hours) — a coarse estimate with 50% to spare
    // settles it at a quarter of the steps; it was half of every exit
    // simulation's money-leg work (the plan pass's largest single cost).
    let rootH = 0
    if (finalRootCost > money0) {
      const quick = hoursToMoney(finalRootCost, { ...rootIn, coarse: true })
      rootH = num(quick) && quick * 1.5 <= climb + lagH ? quick : hoursToMoney(finalRootCost, rootIn)
    }
    if (!num(rootH)) return { hours: null, why: 'could not price re-buying the port openers after the terminal install' }
    const extra = Math.max(0, rootH - (climb + lagH))
    legs.push({ leg: 'root w0r1d_d43m0n', hours: extra, detail: D(() => `$${Math.round(finalRootCost)} of openers from $${Math.round(money0)} after the install: ${rootH.toFixed(2)}h, concurrent with the climb`) })
    h += extra
  }

  // The work slot can bind the window: the passive legs overlap it, a ground
  // reputation leg and the Covenant gym legs do not overlap each other.
  if (slotH > h - finalStart) {
    legs.push({ leg: 'work slot binds', hours: slotH - (h - finalStart), detail: D(() => `${slotH.toFixed(1)}h of work slot in a ${(h - finalStart).toFixed(1)}h window`) })
    h = finalStart + slotH
  }

  // The earlier lives' grafting legs, for the executor: life 1's length is
  // how long the current life is held open for its grafts.
  return { hours: h, legs, mult, finalStartH: finalStart, ...(goLifeOut || goFinalOut ? { go: { ...(goLifeOut ? { life: goLifeOut } : {}), ...goFinalOut } } : {}), ...(favorLifeOut ? { favorLife: favorLifeOut } : {}), ...(perLifeOut ? { perLife: perLifeOut } : {}), ...(lifeLegsOut.length ? { lifeGraftLegs: lifeLegsOut.map((l) => ({ life: l.life, n: l.n, cost: l.cost, moneyH: l.moneyH, slotH: l.slotH, lifeH: l.lifeH, extraH: l.extraH })) } : {}) }
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
/** Steps of the exit's ground-reputation leg (trapezoid; [FM8]). */
export const REP_STEPS = 40
export const DEGENERATE_H = 1e5
export const POLICY_HEAD = 24
export const POLICY_WORSE = 15
// The closing scan's half-width around a galloped optimum. It was
// POLICY_WORSE (15): 31 policies a search, half the policies priced at a 0.5h
// cadence; at 6 every fixture's search [PP2] is still identical to the
// one-by-one walk (336 of 336) and the plan pass's exits move < 0.5%.
export const POLICY_CLOSE = 6

export function bestExitPolicy(o = {}, maxInstalls = 400, minInstalls = 0) {
  return drain(bestExitPolicyGen(o, maxInstalls, minInstalls))
}

/**
 * bestExitPolicy as a GENERATOR that yields after each policy priced (one
 * exitHours), so a caller running it in coop.js slices never blocks the page
 * for a whole search. Same result as bestExitPolicy, which drains it.
 */
/**
 * The memo's key for exit inputs: every field the simulation reads, as JSON,
 * with each object-valued field's JSON cached by identity (the draws copy
 * the inputs, not their arrays: the grafts, the carried streams, the fleet's
 * table, the curve's shape) — the whole-object stringify was ~5% of a pass.
 * The inputs' descriptive fields (text, the cadence's record, the purchase
 * model's inputs) are skipped. Objects must not be mutated once passed in.
 */
const MEMO_SKIP = new Set(['cadence', 'incomeSource', 'expSource', 'repSource', 'capitalFit', 'streams', 'hacknet', 'freshHackCum'])
const jsonMemo = new WeakMap()
function memoKeyOf(o) {
  let out = ''
  for (const k in o) {
    if (MEMO_SKIP.has(k)) continue
    const v = o[k]
    if (v === undefined || typeof v === 'function') continue
    let j
    if (v !== null && typeof v === 'object') {
      j = jsonMemo.get(v)
      if (j === undefined) jsonMemo.set(v, (j = JSON.stringify(v)))
    } else j = JSON.stringify(v)
    out += `${k}:${j},`
  }
  return out
}

export function* bestExitPolicyGen(o = {}, maxInstalls = 400, minInstalls = 0) {
  let key = null
  try {
    // Keyed on what the simulation reads: the inputs' descriptive fields
    // (text, the cadence's own record, the purchase model's inputs) are
    // skipped — they were most of the key's bytes, stringified per search.
    key = `${maxInstalls}|${minInstalls}|${memoKeyOf(o)}`
  } catch {
    key = null
  }
  if (key !== null && policyMemo.has(key)) return policyMemo.get(key)
  const seen = new Map()
  let best = null
  // One policy priced (a plain function: a generator object per policy was
  // ~4% of the plan's CPU); `fresh` says whether it was new — the callers
  // yield after each new one, as before.
  let fresh = false
  const at = (k) => {
    const had = seen.get(k)
    if (had) {
      fresh = false
      return had
    }
    const r = exitHours(o, k, true)
    const row = { installsFirst: k, hours: r.hours, why: r.why ?? null }
    seen.set(k, row)
    // Strictly shorter, or as short at fewer installs (the one-by-one
    // search's first minimum).
    if (num(r.hours) && (best === null || r.hours < best.hours || (r.hours === best.hours && k < best.installsFirst))) best = { ...r, installsFirst: k }
    fresh = true
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
      const row = at(k)
      if (fresh) yield
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
        at(kk)
        if (fresh) yield
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
          at(m)
          if (fresh) yield
          if (best.installsFirst === m) {
            if (m < kb) b = kb
            else a = kb
          } else if (m < kb) a = m
          else b = m
        }
      }
      // The closing scan: POLICY_CLOSE either side of the best, until it holds.
      for (let round = 0; round < 20; round++) {
        const kb = best.installsFirst
        for (let j = Math.max(minInstalls, kb - POLICY_CLOSE); j <= Math.min(maxInstalls, kb + POLICY_CLOSE); j++) {
          at(j)
          if (fresh) yield
        }
        if (best.installsFirst === kb) break
      }
    }
  }
  const tried = [...seen.values()].sort((x, y) => x.installsFirst - y.installsFirst)
  // The best policy's legs with their text (the search priced it quiet).
  if (best) best = { ...exitHours(o, best.installsFirst), installsFirst: best.installsFirst }
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
