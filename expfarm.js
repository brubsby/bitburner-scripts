// HACKING EXP PER GB-SECOND — the fleet's objective where hacking pays nothing.
//
// Pure: no ns surface, so batch.js imports it for free and it runs under node.
//
// In a node with ScriptHackMoneyGain = 0 (BitNode 8) every dollar a hack
// drains is thrown away (NetscriptHelpers.tsx:648), and the exit is the climb
// to hacking 3000 x WorldDaemonDifficulty. What the fleet produces that the
// exit can use is hacking EXP, so the batcher should maximise exp per
// GB-second, not money drained. (Stock manipulation is the one exception; it
// is priced separately against the trader's return — manipVerdict below.)
//
// THE GAME'S EXP RULES, all from source:
//
//   per thread, every op:  e = (3 + 0.3 x baseDifficulty) x hacking_exp x HackExpGain
//                          (Hacking.ts:30-38 calculateHackingExpGain)
//   weaken                 e per thread, unconditionally (NetscriptFunctions.ts:365-374)
//   grow                   e per thread, unconditionally (NetscriptFunctions.ts:291-300);
//                          fortifies 0.004/thread ONLY if the money moved (ServerHelpers.ts:209-214)
//   hack, success          e per thread IF moneyDrained > 0, else e/4 (NetscriptHelpers.tsx:618-641)
//                          moneyDrained = money x percentHacked x threads, clamped to money —
//                          continuous, so ANY positive balance pays full exp
//                          fortifies 0.002 x min(threads, ceil(1/percentHacked)) (NetscriptHelpers.tsx:~673)
//   hack, failure          e/4 per thread, no fortify (NetscriptHelpers.tsx:680)
//   times                  hack T, grow 3.2T, weaken 4T; T linear in (2.5 x required x security + 500)
//                          (Hacking.ts:59-74), so it is taken at MINIMUM security
//
// THE CONSEQUENCE. A weaken holds 1.75GB for 4T, a hack 1.7GB for T: per
// GB-second a hack earns ~4x a weaken, provided (a) security is at minimum
// when it launches, (b) the balance is positive when it lands, and (c) it is
// NOT padded to land at weaken time — batch.js's HWGW pads every hack to 4T
// (additionalMsec), which makes all four ops earn the same ~e/(7T) and throws
// the whole advantage away. So the exp farm runs WAVES:
//
//   W_k  weaken, launched early with a pad, lands just AFTER wave k's hacks
//   G_k  a 1-thread grow, launched early with a pad, lands just BEFORE them —
//        it only keeps the balance off zero (hacks decay it geometrically)
//   H_k  hacks, launched by the controller at L_k - T with NO pad, so each
//        thread holds RAM for T only; split into chunks with
//        percentHacked x threads < 1 so no chunk drains the balance to zero
//        (a clamped drain would leave every later chunk at e/4)
//
// A wave whose launch finds security above minimum is SKIPPED (its W and G
// still land and still pay exp) — the same closed loop batch.js uses, and it
// makes a desync degrade toward weaken-only exp rather than compound.
//
// CALIBRATION: none. The exp rate is not yet measured live against this
// model; batch.txt publishes `expFarm.model` (predicted exp/s) beside tel.js's
// measured getTotalScriptExpGain so the two can be compared. NOT CALIBRATED.

export const FORTIFY = 0.002 // ServerConstants.ServerFortifyAmount
export const WEAKEN_AMOUNT = 0.05 // ServerConstants.ServerWeakenAmount (x ServerWeakenRate)
export const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 }

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

/** Exp per thread of any op on a server, up to the player-wide factor (Hacking.ts:30-38). */
export function expPerThread(baseDifficulty) {
  return pos(baseDifficulty) ? 3 + 0.3 * baseDifficulty : 0
}

/**
 * The exp-farm score of one target: exp per GB-second of the hack+weaken unit,
 * in "e per ms of RAM-time" (player-wide factors drop out of the ranking).
 *
 *   t: { baseDifficulty, hackTime (ms, AT MIN SECURITY), chance (at min), phi }
 *   weakenRate: ServerWeakenRate (1 outside BN11/BN12-style nodes)
 *
 * Per hack thread: exp e(p + (1-p)/4) plus its covering weaken k = 0.002p/(0.05 W)
 * threads at e each; RAM-time 1.7T + k x 1.75 x 4T. (The 1-thread grow per
 * wave is negligible and left out.)
 */
export function expScore(t, weakenRate = 1, margin = 1.1) {
  const e = expPerThread(t?.baseDifficulty)
  const T = t?.hackTime
  const p = num(t?.chance) ? Math.min(1, Math.max(0, t.chance)) : null
  if (!(e > 0) || !pos(T) || p === null || !pos(weakenRate)) return 0
  const k = (FORTIFY * p * margin) / (WEAKEN_AMOUNT * weakenRate)
  const exp = e * (p + (1 - p) / 4) + e * k
  const gbms = RAM.hack * T + k * RAM.weaken * 4 * T
  return exp / gbms
}

/** Weaken-only exp per GB-ms on the same server — the floor a desync degrades to. */
export function weakenScore(t) {
  const e = expPerThread(t?.baseDifficulty)
  return e > 0 && pos(t?.hackTime) ? e / (RAM.weaken * 4 * t.hackTime) : 0
}

/** HWGW (every op padded to weaken time) exp per GB-ms — what batch.js earns as a side effect. */
export function batchedScore(t) {
  const e = expPerThread(t?.baseDifficulty)
  return e > 0 && pos(t?.hackTime) ? e / (1.73 * 4 * t.hackTime) : 0
}

/**
 * Size one wave.
 *   poolGB   RAM the farm may hold in steady state
 *   T        hack time at min security (ms); periodMs the wave spacing
 *   phi      percentHacked per thread at min security (the game's, with
 *            ScriptHackMoney) — chunks keep phi x threads < chunkFrac
 * Returns { hack, weaken, chunkMax, periodMs } threads per wave.
 *
 * Steady state holds T/period waves of hacks and 4T/period waves of weakens,
 * so hack x 1.7 x T/period + weaken x 1.75 x 4T/period = poolGB.
 */
export function waveSize({ poolGB, T, periodMs, phi, chance = 1, weakenRate = 1, margin = 1.1, chunkFrac = 0.5 }) {
  if (!pos(poolGB) || !pos(T) || !pos(periodMs) || !pos(phi)) return null
  const k = (FORTIFY * chance * margin) / (WEAKEN_AMOUNT * weakenRate)
  const perHackGBms = RAM.hack * T + k * RAM.weaken * 4 * T
  // Capped where a wave would decay the balance past ~e^-500 (see below):
  // the RAM beyond it is left to the next wave rather than paid e/4.
  const hackN = Math.min(Math.floor((poolGB * periodMs) / perHackGBms), Math.floor(500 / phi))
  if (hackN < 1) return null
  const weakenN = Math.max(1, Math.ceil(hackN * k))
  const chunkMax = Math.max(1, Math.floor(chunkFrac / phi))
  // A wave's chunks multiply the balance by (1 - phi x n_i); keep the product
  // far above the smallest double (1e-308) even from a $1 balance: the sum of
  // -ln(1 - phi n_i) must stay under ~600. For small chunks that sum is
  // ~phi x hack, so a wave larger than 600/phi threads is refused (shorten
  // the period instead).
  const chunks = Math.ceil(hackN / chunkMax)
  const decay = chunks * -Math.log(1 - phi * Math.min(chunkMax, hackN))
  return { hack: hackN, weaken: weakenN, chunkMax, chunks, periodMs, decay, safe: decay < 600 }
}

/** The wave period for a pool: at least 1s (loop jitter 200ms, landing gap 300ms), at most T/10, and short enough that a wave stays underflow-safe. */
export function wavePeriod({ poolGB, T, phi, chance = 1, weakenRate = 1 }) {
  if (!pos(T)) return null
  let p = Math.max(1000, T / 10)
  for (let i = 0; i < 20; i++) {
    const w = waveSize({ poolGB, T, periodMs: p, phi, chance, weakenRate })
    if (!w || w.safe || p <= 1000) break
    p = Math.max(1000, p / 2)
  }
  return p
}

/**
 * THE MANIPULATION VERDICT — trajectory against trajectory.
 *
 * Serving the trader's manip hosts (batch.js HWGW with {stock: true} on one
 * side) costs exp — the RAM those batches hold earns the batched rate instead
 * of the farm's — and buys return: stock.js publishes `manipCurve`
 * [{nudgesPerSec, returnPerSec}], its return at a nudge rate. The decision is
 * two exits on the SAME published inputs (/tel/exitinputs.txt):
 *
 *   without: capitalReturnPerSec r(0),   expPerSec as measured
 *   with:    capitalReturnPerSec r(nu),  expPerSec - lostExp
 *
 * where nu is what the serving would deliver and lostExp the exp its RAM
 * would have earned in the farm minus what it earns batched. No curve, no
 * inputs, or no exp rate -> { serve: false, priced: false, why } — the manip
 * value is not simulated, so it is not folded in.
 *
 *   o.bestExitPolicy  exitplan's, injected (pure)
 *   o.inputs          record.inputs
 *   o.curve           stock record manipCurve
 *   o.nu              nudges per second serving would deliver
 *   o.manipGB         RAM the served batches hold
 *   o.farmRate, o.batchRate   exp per GB-ms in the farm vs in the batches
 *   o.fleetGB         RAM the farm would otherwise hold (for the exp fraction)
 */
export function manipVerdict(o = {}) {
  const { bestExitPolicy, inputs, curve, nu, manipGB, farmRate, batchRate, fleetGB } = o
  const no = (why) => ({ serve: false, priced: false, why })
  if (typeof bestExitPolicy !== 'function' || !inputs) return no('no fresh exit inputs from progress.js')
  if (!Array.isArray(curve) || curve.length < 2) return no('stock.js publishes no manipCurve [{nudgesPerSec, returnPerSec}] — the return manipulation buys is not simulated, so it is not served')
  if (!pos(inputs.expPerSec)) return no('no measured exp rate to price the farm against')
  if (!num(nu) || nu < 0 || !pos(manipGB) || !pos(fleetGB) || !pos(farmRate) || !num(batchRate)) return no('manip cost unreadable')
  const r = rateAt(curve, nu)
  const r0 = rateAt(curve, 0)
  if (r === null || r0 === null) return no('manipCurve unreadable')
  const lost = inputs.expPerSec * Math.min(1, manipGB / fleetGB) * Math.max(0, 1 - batchRate / farmRate)
  const without = bestExitPolicy({ ...inputs, capitalReturnPerSec: r0 })
  const withM = bestExitPolicy({ ...inputs, capitalReturnPerSec: r, expPerSec: Math.max(1e-9, inputs.expPerSec - lost) })
  const a = without?.best?.hours
  const b = withM?.best?.hours
  if (!num(a) || !num(b)) return no(`exit unpriceable (${without?.why ?? 'ok'} / ${withM?.why ?? 'ok'})`)
  return {
    serve: b < a - 1 / 60,
    priced: true,
    withH: b,
    withoutH: a,
    lostExpPerSec: lost,
    returnPerSec: r,
    why: `exit ${b.toFixed(2)}h serving manip (r ${r.toExponential(2)}/s, -${lost.toFixed(0)} exp/s) vs ${a.toFixed(2)}h farming exp (r ${r0.toExponential(2)}/s)`,
  }
}

/** Piecewise-linear read of the trader's curve; clamps past its ends. */
export function rateAt(curve, nu) {
  const pts = (curve ?? []).filter((x) => num(x?.nudgesPerSec) && num(x?.returnPerSec)).sort((a, b) => a.nudgesPerSec - b.nudgesPerSec)
  if (!pts.length || !num(nu)) return null
  if (nu <= pts[0].nudgesPerSec) return pts[0].returnPerSec
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]
    const hi = pts[i]
    if (nu <= hi.nudgesPerSec) return lo.returnPerSec + ((nu - lo.nudgesPerSec) / (hi.nudgesPerSec - lo.nudgesPerSec || 1)) * (hi.returnPerSec - lo.returnPerSec)
  }
  return pts[pts.length - 1].returnPerSec
}

/**
 * Whether the fleet should farm exp instead of money: where scripted hacking
 * pays nothing (ScriptHackMoneyGain 0, NetscriptHelpers.tsx:648), every
 * drained dollar is waste and exp is the only product. Null table -> false
 * (money mode, the behaviour every other node was measured in).
 */
export const expMode = (mults) => mults?.ScriptHackMoneyGain === 0

/**
 * Why a requested manip host cannot be served by the HWGW batcher, or null.
 * The batcher moves money with an unflagged hack and puts it back with a
 * flagged grow (or the reverse), so BOTH sides need what hack needs: root
 * (every op) and the hacking level (netscriptCanHack, Hacking/
 * netscriptCanHack.ts); a grow-only side stops nudging once the balance is at
 * max. And a server with moneyMax 0 has nothing to move. `s` is
 * {exists, root, maxMoney, required, level}.
 */
export function manipBlocker(host, s) {
  if (!s || s.exists === false) return `${host}: no such server`
  if (!s.root) return `${host}: not rooted yet`
  if (!(s.maxMoney > 0)) return `${host}: moneyMax is 0 — no money to move`
  if (s.required > s.level) return `${host}: needs hacking ${s.required}, have ${s.level} — the batch's hack cannot run yet`
  return null
}

/** The verdict's reason when requests exist but none can be served. */
export function manipUnservableWhy(requested, blocked) {
  const n = Object.keys(requested ?? {}).length
  if (!n) return 'no manip requested'
  return `manip requested on ${n} host(s), none servable: ${blocked.join('; ') || 'no batch fits the fleet'}`
}
