// What to do with hashes — decided by SIMULATED EXIT, not by a rule. Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// hash.js (the old spender, not in the stack) spent hashes by a command-line
// goal list — "money", "server <target>", "maxgym" — fixed at launch. In
// BitNode 9 the hash economy IS the economy: ScriptHackMoney 0.1 and
// ServerMaxMoney 0.01 (BitNode.tsx case 9) put script hacking at a thousandth
// of BitNode 1, while the free level-100 server the node hands out on entry
// (Prestige.ts:329-338) produces ~0.28 hashes/s = $70k/s at the sell rate.
// What those hashes buy is therefore the largest recurring decision in the
// node, and "always sell" / "always boost the target" are both shortcuts.
//
// ---------------------------------------------------------------------------
// THE DECISION (CLAUDE.md: decisions compare simulated trajectories)
//
// Every candidate upgrade X costs c hashes. The alternative for the SAME c
// hashes is to sell them: c/4 x $1e6, now. So the two trajectories are
//
//     exit with X bought now      vs      exit with c hashes sold now
//
// built from ONE input set — progress.js's published exit inputs
// (/tel/exitinputs.txt: the player alone, the install point W, the money
// expected at W and the batch the planner buys at each money level) — and
// run through exitplan.bestExitPolicy. deltaH = with - sell. X is bought only
// when deltaH < 0; among winners, the most exit-hours saved PER HASH wins.
// With no winner every hash is sold (the floor: the game itself sells hashes
// past capacity at exactly this rate, so selling is never worse than what
// the game does with an unspent hash — only sooner).
//
// WHERE EACH EFFECT SITS IN THE TRAJECTORY. Server and training upgrades
// last until the next install (HashManager.prestige, called from
// PlayerObjectGeneralMethods.ts:131); money does not survive it either.
//
//   sell            money now. Before an install: more money at W, so a
//                   bigger batch (spendRuns, the planner's own ladder).
//                   In the final window: money in hand.
//   max money       +2% moneyMax on a batcher target (x value 1.02,
//                   Server.changeMaximumMoney, softcap above $10t). Income
//                   gain = that target's measured $/s x (moneyMax ratio - 1)
//                   — a RAM-bound batcher's take per GB is linear in the
//                   money it holds (grow threads regrow a FRACTION, which
//                   moneyMax does not change). Until the install: more money
//                   at W; final window: income on the money legs.
//   min security    minDifficulty x 0.98, floored at 1
//                   (Server.changeMinimumSecurity). Income ratio from the
//                   game's hacking formulas (Hacking.ts time/percent/chance,
//                   grow.ts growth log) applied to the batch's OWN thread
//                   plan — batchIncomeRatio below, [HS3] against the game.
//   study / gym     +20% exp at university / gym (HashManager.getMult). Exp
//                   is reset by an install, so before one it moves nothing
//                   the simulator sees; in the FINAL window, study scales
//                   the fleet's study exp on the climb and gym scales the
//                   Covenant campaign's combat hours (the only gym legs the
//                   exit simulator carries).
//   contract        one random contract (HacknetHelpers.tsx:556-560: same
//                   draw as a natural spawn, ContractGenerator.ts:72-95).
//                   Its expected MONEY (contractplan.expectedReward) as money
//                   now, only while ctauto.js is solving; its reputation is
//                   not simulated (a floor).
//
// WHAT IS NOT SIMULATED, and is therefore never bought (named in `skipped`):
// company favor (persists to the next BitNode, and company reputation is not
// on the exit trajectory), corporation funds/research and Bladeburner rank/SP
// (no corporation / Bladeburner in the trajectory), gym and study boosts
// outside the final window (their effect before an install is on joins and
// levels this simulator does not model).
//
// CALIBRATION: the formulas are the game's, pinned by [HS1..HS3] against the
// game bundle. The DECISION inherits exitplan's calibration and nothing more:
// no live measurement of "hashes spent on X shortened the exit by Y" exists.


const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

/**
 * Hacknet/data/HashUpgradesMetadata.tsx — the whole catalogue, names exactly
 * as HashUpgradeEnum spells them (Hacknet/Enums.ts). `flat` is a fixed cost
 * (`cost`), otherwise costPerLevel grows linearly: HashUpgrade.getCost.
 */
export const UPGRADES = {
  'Sell for Money': { flat: 4, value: 1e6 },
  'Sell for Corporation Funds': { perLevel: 100, value: 1e9 },
  'Reduce Minimum Security': { perLevel: 50, value: 0.98, target: 'server' },
  'Increase Maximum Money': { perLevel: 50, value: 1.02, target: 'server' },
  'Improve Studying': { perLevel: 50, value: 20 },
  'Improve Gym Training': { perLevel: 50, value: 20 },
  'Exchange for Corporation Research': { perLevel: 200, value: 1000 },
  'Exchange for Bladeburner Rank': { perLevel: 250, value: 100 },
  'Exchange for Bladeburner SP': { perLevel: 250, value: 10 },
  'Generate Coding Contract': { perLevel: 25, value: 1 },
  'Company Favor': { perLevel: 200, value: 5, target: 'company' },
}

/** Upgrades the exit simulator cannot see, and why — published, never bought. */
export const NOT_SIMULATED = {
  'Sell for Corporation Funds': 'no corporation on the exit trajectory',
  'Exchange for Corporation Research': 'no corporation on the exit trajectory',
  'Exchange for Bladeburner Rank': 'no Bladeburner on the exit trajectory',
  'Exchange for Bladeburner SP': 'no Bladeburner on the exit trajectory',
  'Company Favor': 'company favor persists into the next BitNode and company reputation is not on the exit trajectory',
}

/** HashUpgrade.getCost: flat x count, else costPerLevel x count(count + 2 x level + 1)/2. */
export function upgradeCost(name, level, count = 1) {
  const u = UPGRADES[name]
  if (!u || !num(level) || level < 0 || !num(count) || count < 0) return null
  if (u.flat) return u.flat * count
  return u.perLevel * 0.5 * count * (count + 2 * level + 1)
}

/** HashManager.getMult: 1 + value x level / 100 (Improve Studying / Gym Training). */
export const trainingMultAt = (level) => (num(level) && level >= 0 ? 1 + (20 * level) / 100 : null)

// --- the game's hacking formulas, for the min-security response ------------

/** Hacking.ts calculateHackingTime, seconds (intelligence bonus x1; it cancels in every ratio here). */
export function hackTimeSec(required, sec, hacking, speedMult = 1, nodeSpeed = 1) {
  if (!num(required) || !num(sec) || !pos(hacking) || !pos(speedMult) || !pos(nodeSpeed)) return null
  const skillFactor = (2.5 * required * sec + 500) / (hacking + 50)
  return (5 * skillFactor) / (speedMult * nodeSpeed)
}

/** Hacking.ts calculatePercentMoneyHacked WITHOUT the node's ScriptHackMoney (it cancels in the ratio). */
export function hackPercent(required, sec, hacking, moneyMult = 1) {
  if (!num(required) || !num(sec) || !pos(hacking)) return null
  if (sec >= 100) return 0
  const v = (((100 - sec) / 100) * ((hacking - (required - 1)) / hacking) * moneyMult) / 240
  return Math.min(1, Math.max(0, v))
}

/** Hacking.ts calculateHackingChance (intelligence bonus x1). */
export function hackChanceAt(required, sec, hacking, chanceMult = 1) {
  if (!num(required) || !num(sec) || !pos(hacking)) return null
  if (sec >= 100) return 0
  const skillMult = Math.max(1.75 * hacking, 1)
  const v = ((skillMult - required) / skillMult) * ((100 - sec) / 100) * chanceMult
  return Math.min(1, Math.max(0, v))
}

/** grow.ts calculateServerGrowthLog at 1 thread, 1 core (ServerBaseGrowthIncr 0.03, ServerMaxGrowthLog). */
export function growLogAt(sec, serverGrowth, growMult = 1, nodeGrowthRate = 1) {
  if (!pos(sec) || !num(serverGrowth)) return null
  const adj = Math.min(Math.log1p(0.03 / sec), 0.00349388925425578)
  return adj * (serverGrowth / 100) * nodeGrowthRate * growMult
}

/** Server.changeMinimumSecurity(0.98^count, true): floored at 1. */
export const minSecAfter = (minSec, count = 1) => (pos(minSec) ? Math.max(1, minSec * Math.pow(0.98, count)) : null)

/** Server.changeMaximumMoney(1.02) applied `count` times, softcap above $10t included. */
export function maxMoneyAfter(moneyMax, count = 1) {
  if (!pos(moneyMax)) return null
  let m = moneyMax
  for (let i = 0; i < count; i++) {
    let n = 1.02
    const softCap = 10e12
    if (m > softCap) n = 1 + (n - 1) / Math.log(m - softCap) / Math.log(8)
    m *= n
  }
  return m
}

/**
 * The batch's income after a target changes, relative to before.
 *
 * The batch keeps its hack FRACTION f; everything else follows from the game:
 *   hack threads   x pct(before)/pct(after)           (h = f / pct)
 *   grow threads   x growLog(before)/growLog(after)   (regrow the same fraction)
 *   weaken threads follow their op (0.002/hack, 0.004/grow, 0.05/weaken)
 *   duration       x hackTime(after)/hackTime(before) (grow 3.2x, weaken 4x of it)
 *   money/batch    x chance(after)/chance(before) x moneyMax(after)/moneyMax(before)
 *
 * RAM-bound (the batcher is using its RAM): income is money per RAM-second,
 * so the ratio carries the thread and duration terms. Not RAM-bound: income
 * is capped by the pipeline, not the RAM, and only the money per batch moves.
 * `plan` is batch.txt's own {h, g, w1, w2}; `ram` the GB per thread of each
 * worker (ns.getScriptRam of h.js / g.js / w.js).
 */
export function batchIncomeRatio(plan, before, after, player, o = {}) {
  const { ramBound = true, ram = { h: 1.7, g: 1.75, w: 1.75 } } = o
  if (!plan || !pos(plan.h) || !num(plan.g) || !num(plan.w1) || !num(plan.w2)) return null
  if (!before || !after || !player) return null
  const m = player.mults ?? {}
  const pct = (s) => hackPercent(s.required, s.minSec, player.hacking, m.hacking_money ?? 1)
  const ch = (s) => hackChanceAt(s.required, s.minSec, player.hacking, m.hacking_chance ?? 1)
  const gl = (s) => growLogAt(s.minSec, s.serverGrowth, m.hacking_grow ?? 1, o.nodeGrowthRate ?? 1)
  const tt = (s) => hackTimeSec(s.required, s.minSec, player.hacking, m.hacking_speed ?? 1)
  const p0 = pct(before), p1 = pct(after), c0 = ch(before), c1 = ch(after), t0 = tt(before), t1 = tt(after)
  if (![p0, p1, c0, c1, t0, t1].every(pos) || !pos(before.moneyMax) || !pos(after.moneyMax)) return null
  const moneyRatio = (c1 / c0) * (after.moneyMax / before.moneyMax)
  if (!ramBound) return moneyRatio
  const g0 = gl(before), g1 = gl(after)
  const growScale = plan.g > 0 ? (pos(g0) && pos(g1) ? g0 / g1 : null) : 1
  if (growScale === null) return null
  const hScale = p0 / p1
  const ramSec = (hs, gs, t) => t * (plan.h * hs * ram.h + plan.g * gs * ram.g * 3.2 + (plan.w1 * hs + plan.w2 * gs) * ram.w * 4)
  return moneyRatio * (ramSec(1, 1, t0) / ramSec(hScale, growScale, t1))
}

// --- the comparison ---------------------------------------------------------

/**
 * The exit, in hours, after an EFFECT applied now, on the published record.
 *
 *   effect.money        dollars now (a sale, a contract; negative = a cost)
 *   effect.incomePerSec extra income until the next install
 *   effect.expPerSec    the fleet's TOTAL extra hacking exp/s under the option (final
 *                       window only); it REPLACES baseEffect.expPerSec
 *   effect.covenantHScale  combat hours x this (final window, Covenant only)
 *
 * Before an install: every in-life effect only changes the money at W, so
 * the run is spendRuns(record, -(money + income x W)) — the planner's own
 * batch at that money. Exp and gym effects are reset by the install and
 * contribute nothing the simulator sees. In the final window the effects act
 * on the one remaining window directly. Returns hours or null.
 */
export function exitAfter(record, effect, fns, covenant = null, baseEffect = null) {
  const { bestExitPolicy, spendRuns } = fns
  // baseEffect: what BOTH trajectories carry (the fleet's study exp the
  // published inputs leave out), so the comparison differs only in the choice.
  const b = baseEffect ?? {}
  const f = effect ?? {}
  const e = {
    money: (b.money ?? 0) + (f.money ?? 0),
    incomePerSec: (b.incomePerSec ?? 0) + (f.incomePerSec ?? 0),
    expPerSec: f.expPerSec !== undefined ? f.expPerSec : b.expPerSec ?? 0,
    covenantHScale: f.covenantHScale ?? 1,
  }
  const base = record?.inputs
  if (!base) return null
  const x = { eRep: record.eRep, eBudget: record.eBudget }
  if (record.finalWindow === true) {
    const inp = {
      ...base,
      ...x,
      money: Math.max(0, (base.money ?? 0) + e.money),
      incomePerSec: (base.incomePerSec ?? 0) + e.incomePerSec,
      expPerSec: (base.expPerSec ?? 0) + e.expPerSec,
      ...(covenant ? { covenant: { ...covenant, combatH: covenant.combatH * e.covenantHScale } } : {}),
    }
    return bestExitPolicy(inp, 0, 0)?.best?.hours ?? null
  }
  if (!num(record.W)) return null
  const net = e.money + e.incomePerSec * record.W * 3600
  const runs = spendRuns(record, -net, { allowGain: true })
  if (!runs) return null
  return bestExitPolicy({ ...runs.with, ...x }, runs.max, runs.min)?.best?.hours ?? null
}

/** A record is usable when it is this life's and fresh (the same rule spendExitFromRecord applies). */
export function recordUsable(record, lastAugReset, now = Date.now()) {
  if (!record?.inputs) return 'no exit inputs from progress.js'
  if (record.lastAugReset !== lastAugReset) return 'exit inputs are from another life'
  if (!(now - Date.parse(record.at) < 15 * 60e3)) return 'exit inputs are stale (>15 min)'
  if (record.finalWindow !== true && !num(record.W)) return 'exit inputs carry no install point'
  return null
}

/**
 * THE SPENDER'S DECISION.
 *
 * ctx:
 *   hashes, capacity            what is held and what can be held
 *   record, lastAugReset, now   the published exit inputs
 *   fns                         { bestExitPolicy, spendRuns } from exitplan.js
 *   options                     [{ name, target, cost, effect, why }] — each
 *                               option's hash cost (ns.hacknet.hashCost, the
 *                               game's own) and its effect on the trajectory
 *   skipped                     [{ name, why }] options not simulated
 *
 * Returns { action: 'buy'|'save'|'sell', ... , exits, why, decidedBy }.
 * A tie (|deltaH| under a second) is not a win: selling keeps it.
 */
export function decideHashSpend(ctx) {
  const { hashes, capacity, record, lastAugReset, now = Date.now(), fns, options = [], skipped = [] } = ctx
  const sellAll = (why, decidedBy, extra = {}) => ({ action: 'sell', count: pos(hashes) ? Math.floor(hashes / 4) : 0, why, decidedBy, skipped, ...extra })
  if (!num(hashes) || hashes < 0) return { action: 'none', why: 'hash count unreadable', decidedBy: 'refused', skipped }
  const bad = recordUsable(record, lastAugReset, now)
  if (bad) return sellAll(`${bad}: no upgrade can be priced, so every hash is sold (the floor the game itself applies to overflow)`, 'floor')
  const exits = []
  const covenant = ctx.covenant ?? null
  const baseEffect = ctx.baseEffect ?? null
  for (const o of options) {
    if (!pos(o?.cost)) {
      exits.push({ name: o?.name, target: o?.target ?? null, cost: o?.cost ?? null, why: 'hash cost unreadable' })
      continue
    }
    const withX = exitAfter(record, o.effect, fns, covenant, baseEffect)
    const withSell = exitAfter(record, { money: (o.cost / 4) * 1e6 }, fns, covenant, baseEffect)
    if (!num(withX) || !num(withSell)) {
      exits.push({ name: o.name, target: o.target ?? null, cost: o.cost, why: 'an exit could not be priced' })
      continue
    }
    exits.push({ name: o.name, target: o.target ?? null, cost: o.cost, withH: withX, sellH: withSell, deltaH: withX - withSell, perHash: (withX - withSell) / o.cost, note: o.why ?? null })
  }
  const TIE_H = 1 / 3600
  const winners = exits.filter((x) => num(x.deltaH) && x.deltaH < -TIE_H).sort((a, b) => a.perHash - b.perHash)
  if (!winners.length) return sellAll(`no upgrade shortens the exit against selling the same hashes (${exits.length} simulated)`, 'exit-sim', { exits })
  for (const w of winners) {
    if (w.cost <= hashes) return { action: 'buy', name: w.name, target: w.target, cost: w.cost, why: `exit ${w.withH.toFixed(3)}h with ${w.name}${w.target ? ` on ${w.target}` : ''} vs ${w.sellH.toFixed(3)}h selling the same ${w.cost} hashes`, decidedBy: 'exit-sim', exits, skipped }
    if (num(capacity) && w.cost <= capacity) return { action: 'save', name: w.name, target: w.target, cost: w.cost, why: `saving for ${w.name} (${w.cost} of ${Math.floor(hashes)} hashes): it beats selling by ${(-w.deltaH * 60).toFixed(1)} min of exit; overflow would sell itself at the same rate, so holding loses nothing but time`, decidedBy: 'exit-sim', exits, skipped }
  }
  // Every winner costs more than the hashes can hold: sell, and say which
  // upgrade a larger cache would have bought (hacknet.js reads this).
  const w = winners[0]
  return sellAll(`the best upgrade (${w.name}, ${w.cost} hashes) exceeds the hash capacity ${capacity}`, 'exit-sim', { exits, capacityBound: { name: w.name, target: w.target, cost: w.cost, capacity, deltaH: w.deltaH } })
}
