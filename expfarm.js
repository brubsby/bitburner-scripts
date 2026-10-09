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
// The same figures as plain names for the arithmetic below: a member access
// named like an ns function (`RAM.hack`, `RAM.weaken`) is billed by the RAM
// calculator to every importer that reaches it (freshlife.js paid 0.25GB).
const RAM_HACK = 1.7
const RAM_WEAKEN = 1.75

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
  const gbms = RAM_HACK * T + k * RAM_WEAKEN * 4 * T
  return exp / gbms
}

/** Weaken-only exp per GB-ms on the same server — the floor a desync degrades to. */
export function weakenScore(t) {
  const e = expPerThread(t?.baseDifficulty)
  return e > 0 && pos(t?.hackTime) ? e / (RAM_WEAKEN * 4 * t.hackTime) : 0
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
  const perHackGBms = RAM_HACK * T + k * RAM_WEAKEN * 4 * T
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
/**
 * THE EXP A MANIP BATCH DISPLACES: the farm's rate on the RAM the manip
 * pipelines hold, less what those batches earn in exp themselves.
 */
export function manipLostExp(expPerSec, manipGB, fleetGB, batchRate, farmRate) {
  if (!pos(expPerSec) || !pos(manipGB) || !pos(fleetGB) || !pos(farmRate) || !num(batchRate)) return null
  return expPerSec * Math.min(1, manipGB / fleetGB) * Math.max(0, 1 - batchRate / farmRate)
}

/**
 * SERVE OR FARM — the one decision, shared by the batcher (manipVerdict) and
 * the port-opener price (exitplan.programExit): serving the trader's
 * manipulation is chosen only when the node's exit with it (return r, exp
 * less what the manip RAM displaces) beats the exit farming exp (return r0)
 * by more than a minute. Live 2026-09-26 23:14 the opener price credited
 * manipulation's upside (12.49h vs 14.46h) while the batcher, pricing the
 * same manipulation with its exp cost, refused it (39.09h vs 13.20h).
 * Returns {serve, hours, farmH, serveH, why} or {serve: false, hours: null, why}.
 */
export function serveOrFarm(bestExitPolicy, inputs, { r0, r, lostExpPerSec }) {
  if (typeof bestExitPolicy !== 'function' || !inputs) return { serve: false, hours: null, why: 'no exit inputs' }
  const farm = bestExitPolicy({ ...inputs, ...(num(r0) ? { capitalReturnPerSec: r0 } : {}) })
  const farmH = farm?.best?.hours
  if (!num(farmH)) return { serve: false, hours: null, why: `farming exit unpriceable (${farm?.why ?? 'ok'})` }
  if (!num(r) || !num(lostExpPerSec)) return { serve: false, hours: farmH, farmH, serveH: null, why: 'manipulation unpriced: farming' }
  const srv = bestExitPolicy({ ...inputs, capitalReturnPerSec: r, expPerSec: Math.max(1e-9, (inputs.expPerSec ?? 0) - lostExpPerSec) })
  const serveH = srv?.best?.hours
  if (!num(serveH)) return { serve: false, hours: farmH, farmH, serveH: null, why: `serving exit unpriceable (${srv?.why ?? 'ok'}): farming` }
  const serve = serveH < farmH - 1 / 60
  return { serve, hours: serve ? serveH : farmH, farmH, serveH, why: `exit ${serveH.toFixed(2)}h serving manip (r ${r.toExponential(2)}/s, -${lostExpPerSec.toFixed(0)} exp/s) vs ${farmH.toFixed(2)}h farming exp${num(r0) ? ` (r ${r0.toExponential(2)}/s)` : ''}` }
}

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
  const lost = manipLostExp(inputs.expPerSec, manipGB, fleetGB, batchRate, farmRate)
  const d = serveOrFarm(bestExitPolicy, inputs, { r0, r, lostExpPerSec: lost })
  if (!num(d.farmH) || !num(d.serveH)) return no(`exit unpriceable (${d.why})`)
  return {
    serve: d.serve,
    priced: true,
    withH: d.serveH,
    withoutH: d.farmH,
    lostExpPerSec: lost,
    returnPerSec: r,
    why: d.why,
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
 * THE FLEET'S SPLIT BETWEEN MONEY BATCHES AND THE EXP FARM — one exit per
 * candidate split, on one input set (progress.js farmVerdictOf publishes it;
 * batch.js runs it in every node). Priced every pass from WHEREVER the fleet
 * is: the inputs are measured at the running split share0 and every other
 * split is the counterfactual.
 *
 *   share  the fraction of the fleet batching money (1 = money mode, 0 = the
 *          farm alone); candidates SHARES plus share0
 *   exp    flat + X x (1 - s + s/k), X the farm-alone script exp recovered
 *          from the measured one: X = script / (1 - s0 + s0/k)
 *   income measured + (s - s0) x moneyPerSec, moneyPerSec = what batching
 *          the whole fleet earns (money mode: the batcher's measured
 *          earnings; farm mode: batch.txt moneyPreview.modelIncomePerSec,
 *          the target-count model). LINEAR in s: a target's pipeline
 *          saturates, so a part of the fleet earns more than its share of
 *          the whole — linearity understates a small money share (a floor on
 *          the mixed splits).
 *
 * k is the farm's script exp over money batching's on the whole fleet
 * (money mode: perGB x totalGB / usedGB; farm mode: batch.txt
 * moneyPreview.k). The SCRIPT exp is the input builder's exp rate less its
 * flat part (exitInputsOf: expPerSec is the script-exp posterior + the
 * sleeves' transfer, expFlatPerSec the transfer), so every split scales the
 * same stream and the pricing from either end is the same set of exits.
 *
 * THE LATCH THIS REPLACES (live BN12 2026-10-09): progress.js published
 * `farm: true, why: 'the farm is running ... its own record is the
 * measurement now'` for as long as the farm ran — priced once, ~0.1h into the
 * life (hacking 426, money batches ramping at ~$6m/s), never again; and it
 * chose between the two ends only, while the exit priced a quarter of the
 * fleet on money ~0.6h sooner than the farm alone (tools/test/farmsplit).
 *
 * A different split is chosen only when it beats the running one by more
 * than a minute, so a tie keeps what runs.
 * { frac (the chosen money share), farm (frac < 1), shareH, runH, farmH, moneyH, withH (= farmH),
 *   withoutH (= moneyH), grid [{frac, hours}], mixed, k, share0 } — `frac`, never
 * `share`: that name is billed as ns.share() (2.40GB) in every importer.
 * or { farm: null, why }.
 */
export const SHARES = [0, 0.1, 0.25, 0.5, 0.75, 1]
export function splitVerdict(bestExitPolicy, inputs, { share0, scriptExpPerSec, k, moneyPerSec = null, shares = SHARES } = {}) {
  if (typeof bestExitPolicy !== 'function' || !inputs) return { farm: null, why: 'no exit inputs' }
  if (!(num(share0) && share0 >= 0 && share0 <= 1)) return { farm: null, why: `running split unknown (share0 ${share0})` }
  if (!pos(scriptExpPerSec) || !pos(inputs.expPerSec)) return { farm: null, why: 'no measured script exp rate' }
  if (!pos(k)) return { farm: null, why: 'the farm/money exp multiple k is unreadable' }
  if (!(num(moneyPerSec) && moneyPerSec >= 0)) return { farm: null, why: 'what money batching earns is unpriced' }
  const flat = pos(inputs.expFlatPerSec) ? Math.min(inputs.expFlatPerSec, inputs.expPerSec) : 0
  const X = (inputs.expPerSec - flat) / (1 - share0 + share0 / k)
  const at = (s) => (s === share0 ? inputs : { ...inputs, expPerSec: flat + X * (1 - s + s / k), incomePerSec: Math.max(0, (inputs.incomePerSec ?? 0) + (s - share0) * moneyPerSec) })
  const H = (x) => bestExitPolicy(x)?.best?.hours ?? null
  const grid = [...new Set([...shares, share0])].sort((a, b) => a - b).map((s) => ({ frac: s, hours: H(at(s)) }))
  const hOf = (s) => grid.find((g) => g.frac === s)?.hours ?? null
  const runH = hOf(share0)
  const farmH = hOf(0)
  const moneyH = hOf(1)
  if (!num(runH) || !num(farmH) || !num(moneyH)) return { farm: null, why: 'an exit could not be priced' }
  let best = { frac: share0, hours: runH }
  for (const g of grid) if (num(g.hours) && g.hours < best.hours) best = g
  const frac = best.hours < runH - 1 / 60 ? best.frac : share0
  const shareH = hOf(frac)
  return { frac, farm: frac < 1, shareH, runH, farmH, moneyH, withH: farmH, withoutH: moneyH, grid, mixed: grid.filter((g) => g.frac !== share0).map((g) => ({ f: Math.abs(g.frac - share0), frac: g.frac, hours: g.hours })), k, share0 }
}

/** The money-side call (batch.txt expFarmPreview): splitVerdict with k from the preview. */
export function farmOrMoney(bestExitPolicy, inputs, { scriptExpPerSec, perGB, usedGB, totalGB, batchMoneyPerSec = 0 } = {}) {
  if (typeof bestExitPolicy !== 'function' || !inputs) return { farm: null, why: 'no exit inputs' }
  if (!pos(scriptExpPerSec) || !pos(inputs.expPerSec)) return { farm: null, why: 'no measured script exp rate' }
  if (!pos(perGB) || !pos(usedGB) || !pos(totalGB)) return { farm: null, why: 'farm preview unreadable' }
  const batchMoney = pos(batchMoneyPerSec) ? batchMoneyPerSec : 0
  const r = splitVerdict(bestExitPolicy, inputs, { share0: 1, scriptExpPerSec, k: (perGB * totalGB) / usedGB, moneyPerSec: batchMoney })
  return r.farm === null ? r : { ...r, batchMoney }
}

/**
 * THE TARGET COUNT AND WHAT MONEY BATCHING EARNS — batch.js's money-mode
 * argmax (it picks n with this) and, while the farm runs, the money side of
 * the farm verdict (batch.txt moneyPreview). One model for both. Pure.
 *
 *   count   candidate targets, best first
 *   planAt(i, slice)  -> { money, gb, hackTimeMs, score } or null: batch.js
 *           planBatch for candidate i on an even slice of the fleet, `score`
 *           its batchedScore (exp per GB-ms)
 *   fleetGB the fleet's RAM; spacingMs the batcher's landing gap
 *   farmScore, farmGB  the farm's exp per GB-ms and the RAM it holds (for k)
 *
 * income(n) = sum_i min(money_i / (4 spacing), slice x money_i / (gb_i x 4
 * hackTime_i)), slice = fleetGB / n — a target's pipeline saturates at
 * gb_i x hackTime_i / spacing GB (the dispatcher's period floor 4 spacing).
 * k = the farm's exp over the batches' on the RAM each would hold. NOT
 * CALIBRATED: the model over-predicted live income by ~40% in BN1 (CLAUDE.md,
 * target-count.mjs), and k's money side has no live measurement while the
 * farm runs. Returns { n, inc (money/ms), modelIncomePerSec, moneyGB,
 * batchScorePerGBms, k } — n = 1 when nothing plans.
 */
export function moneyModelOf(count, planAt, { fleetGB, spacingMs, farmScore = null, farmGB = null } = {}) {
  let best = { n: 1, inc: -1, gb: 0, sw: 0 }
  for (let n = 1; n <= count; n++) {
    const slice = fleetGB / n
    let inc = 0
    let gb = 0
    let sw = 0
    for (let i = 0; i < n; i++) {
      const p = planAt(i, slice)
      if (!p) continue
      inc += Math.min(p.money / (4 * spacingMs), (slice * p.money) / (p.gb * p.hackTimeMs * 4))
      const held = Math.min(slice, (p.gb * p.hackTimeMs) / spacingMs)
      gb += held
      if (pos(p.score)) sw += p.score * held
    }
    if (inc > best.inc) best = { n, inc, gb, sw }
  }
  const batchScore = best.gb > 0 ? best.sw / best.gb : 0
  const k = pos(farmScore) && pos(farmGB) && batchScore > 0 ? (farmScore * farmGB) / (batchScore * best.gb) : null
  return { n: best.n, inc: best.inc, modelIncomePerSec: best.inc > 0 ? best.inc * 1000 : 0, moneyGB: Math.round(best.gb), batchScorePerGBms: batchScore, k }
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

/**
 * WHAT EACH PORT OPENER ADDS TO THE FARM, per tier of open ports.
 *
 * servers: [{host, ports, ramGB, rooted, score}] — every non-home, non-bought
 * server; `score` is expScore where it could be a target (hackable, money > 0)
 * else 0. Rooting needs `ports` open ports and nothing else (NetscriptFunctions
 * nuke checks the port count only). The farm's exp is linear in its RAM and in
 * its best target's score, so tier k (k openers owned) supports
 *     R_k = fleetGB + sum(ram of unrooted servers with ports <= k)
 *     S_k = best score among rooted servers or unrooted ones with ports <= k
 * and the exp multiple of owning k openers against owning `owned` is
 * (R_k x S_k) / (R_owned x S_owned). NOT CALIBRATED — the same linearity the
 * farm's model assumes (batch.txt expFarm.model).
 */
export function portTiers(servers, fleetGB, owned) {
  if (!Array.isArray(servers) || !(fleetGB > 0) || !num(owned)) return null
  const tier = (k) => {
    let ram = fleetGB
    let best = 0
    for (const s of servers) {
      const open = s.rooted || s.ports <= k
      if (!open) continue
      if (!s.rooted) ram += num(s.ramGB) ? s.ramGB : 0
      if (num(s.score) && s.score > best) best = s.score
    }
    return { ports: k, ramGB: Math.round(ram), bestScore: best }
  }
  const base = tier(owned)
  const out = []
  for (let k = owned + 1; k <= 5; k++) {
    const t = tier(k)
    out.push({ ...t, expMultiple: base.bestScore > 0 ? (t.ramGB * t.bestScore) / (base.ramGB * base.bestScore) : null })
  }
  return { owned, base, tiers: out }
}
