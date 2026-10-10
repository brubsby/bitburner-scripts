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
//                   draw as a natural spawn, ContractGenerator.ts:72-95),
//                   only while ctauto.js is solving. Its expected MONEY
//                   (contractplan.expectedReward) as money now, and — in the
//                   final window, once the exit faction is joined — its
//                   expected share of that faction's REPUTATION (the reward
//                   goes to one joined hacking-work faction at random or is
//                   split over all of them), banked on the exit's rep leg.
//                   The exit simulator carries the same contracts as the
//                   final window's policy (exitplan contractRep: every hash
//                   from the join), so this purchase also moves that stream
//                   one level up. Before an install its reputation reaches the
//                   batch at W, which the planner's ladders price at today's
//                   reputation, not W's — not simulated (a floor, named).
//
// WHY MONEY IS NOT THE MEASURE (audit 2026-09-29, BitNode 9): money at the
// install point was $8.8t against a batch the planner cannot grow past it
// (the ladder flat from $6.6t), and in the final window the exit is bound by
// the work slot (grafts + the Daedalus leg), not money — a fleet worth
// $1e12/s there moved the exit by +0.26h. A hash sold is worth ~nothing; a
// hash turned into the exit faction's reputation or the fleet's study exp is
// worth what the rep leg and the level make of it.
//
// WHAT IS NOT SIMULATED, and is therefore never bought (named in `skipped`):
// company favor (persists to the next BitNode, and company reputation is not
// on the exit trajectory), corporation funds/research (no corporation in the
// trajectory), gym and study boosts outside the final window (their effect
// before an install is on joins and levels this simulator does not model).
//
// THE BLADEBURNER ROUTE (plan.txt decisions.bladeRoute.key 'blade',
// splitctl.committedRouteOf) exits by the black ops, not the World Daemon:
// everything above prices the wrong exit there (live BN7.1 2026-10-10:
// withH = sellH = 2.87e65h for every option). On that route the spend is
// decideBladeHashSpend below: the two Bladeburner exchanges priced on the
// black-op exit progress.js simulates (bladeRoute.hashExchange), against the
// sale's money priced at what money buys on that route.
//
// CALIBRATION: the formulas are the game's, pinned by [HS1..HS3] against the
// game bundle. The DECISION inherits exitplan's calibration and nothing more:
// no live measurement of "hashes spent on X shortened the exit by Y" exists.


import { capitalFV, serverCandidates, applyServerPurchase, cacheCost, hashCapacityOf, hashRate, DOLLARS_PER_HASH } from 'hacknetplan.js'

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
 *   effect.exitRep      reputation with the exit faction banked now (final window)
 *   effect.contractLevels  contract upgrade levels the purchase uses up (the
 *                       record's modelled contract stream starts that much higher)
 *   effect.noContracts  the selling policy: the record's contract stream removed
 *
 * In the final window the fleet's exp (a sleeve's transfer) is flat: where the
 * record's exp rate is level-shaped it is added to expFlatPerSec as well.
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
    exitRep: num(f.exitRep) && f.exitRep > 0 ? f.exitRep : 0,
    contractLevels: num(f.contractLevels) && f.contractLevels > 0 ? f.contractLevels : 0,
  }
  const base = record?.inputs
  if (!base) return null
  const x = { eRep: record.eRep, eBudget: record.eBudget }
  if (record.finalWindow === true) {
    // The fleet's study exp is a FLAT term (a sleeve's transfer does not rise
    // with the player's level): where the record's exp rate is level-shaped,
    // it rides expFlatPerSec too, or the exit would scale it with the level.
    const shaped = base.expScalesWithLevel === true
    // A contract bought now: its expected share of the exit faction's
    // reputation, banked now; the modelled contract stream (contractRep) then
    // starts that many levels higher, so the purchase is not counted twice.
    // effect.noContracts: the SELLING policy — every hash sold from now on, so
    // the record's contract stream is not in this trajectory at all.
    const cr = f.noContracts === true ? { contractRep: undefined } : base.contractRep && e.contractLevels > 0 ? { contractRep: { ...base.contractRep, level0: (num(base.contractRep.level0) ? base.contractRep.level0 : 0) + e.contractLevels } } : {}
    const inp = {
      ...base,
      ...x,
      money: Math.max(0, (base.money ?? 0) + e.money),
      incomePerSec: (base.incomePerSec ?? 0) + e.incomePerSec,
      expPerSec: (base.expPerSec ?? 0) + e.expPerSec,
      ...(shaped && e.expPerSec > 0 ? { expFlatPerSec: (base.expFlatPerSec ?? 0) + e.expPerSec } : {}),
      ...(e.exitRep > 0 ? { exitRep: (base.exitRep ?? 0) + e.exitRep } : {}),
      ...cr,
      ...(covenant ? { covenant: { ...covenant, combatH: covenant.combatH * e.covenantHScale } } : {}),
    }
    return bestExitPolicy(inp, 0, 0)?.best?.hours ?? null
  }
  if (!num(record.W)) return null
  // EXP BEFORE THE INSTALL is reset by it, but not wasted: a higher level
  // this life raises the batcher's income on the way to W (income scales
  // with level + 50 — trajectory.incomeModel, the same model the gate's
  // money at W uses). So a study boost prices as the extra money at W from
  // exp arriving faster. Its reputation effect (faction work is linear in
  // the level) is not simulated: a floor. No incomeModel supplied: 0, named
  // by the caller.
  const im = fns.incomeModel
  const expDelta = (e.expPerSec ?? 0) - (b.expPerSec ?? 0)
  const expMoney = (() => {
    if (typeof im !== 'function' || !(expDelta > 0) || !(record.W > 0)) return 0
    const flat = num(base.flatIncomePerSec) ? base.flatIncomePerSec : 0
    const m = (xps) => im({ incomePerSec: Math.max(0, (base.incomePerSec ?? 0) - flat), hacking: base.hacking, hackingExp: base.hackingExp, hackingMult: base.hackingMult, expPerSec: xps })?.moneyBy(record.W)
    const x0 = (base.expPerSec ?? 0) + (b.expPerSec ?? 0)
    const a = m(x0 + expDelta)
    const z = m(x0)
    return num(a) && num(z) ? Math.max(0, a - z) : 0
  })()
  // THE TRADER'S BOOK on both sides (hacknetplan.capitalFV, the one the spend
  // verdicts and the hacknet batch use): money now compounds to W, income
  // compounds from when it arrives. Without it, a sale's $12.5m and an
  // upgrade's +$93/s were compared as if the book (82%/h in BitNode 9) did
  // not exist — understating every sale against every income upgrade.
  const fv = capitalFV(base, record.W)
  const net = e.money * fv.lump + e.incomePerSec * fv.stream + expMoney
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
    // A POLICY, not a purchase (o.policy 'contracts'): the record's final
    // window already spends every hash from the join on contracts, so one
    // contract against one sale is a tie by construction (the stream buys
    // it a few seconds later). The alternative is then the selling POLICY —
    // this sale and every later hash sold (noContracts).
    const withSell = exitAfter(record, { money: (o.cost / 4) * 1e6, ...(o.policy === 'contracts' ? { noContracts: true } : {}) }, fns, covenant, baseEffect)
    if (!num(withX) || !num(withSell)) {
      exits.push({ name: o.name, target: o.target ?? null, cost: o.cost, why: 'an exit could not be priced' })
      continue
    }
    // RANKED AT THE MARGIN. The policy's deltaH says whether contracts beat
    // selling at all; which upgrade the NEXT hashes go to is the marginal
    // question — this contract against selling just its hashes on the
    // stream-bearing record (near a tie: the stream's price rises with every
    // contract), so an upgrade worth more per hash at the margin (study
    // levels) is not starved by the whole stream's value divided by one price.
    let perHash = (withX - withSell) / o.cost
    let marginalH = null
    if (o.policy === 'contracts') {
      const one = exitAfter(record, { money: (o.cost / 4) * 1e6 }, fns, covenant, baseEffect)
      marginalH = num(one) ? withX - one : null
      perHash = num(marginalH) ? Math.min(marginalH, 0) / o.cost : perHash
    }
    exits.push({ name: o.name, target: o.target ?? null, cost: o.cost, withH: withX, sellH: withSell, deltaH: withX - withSell, perHash, ...(marginalH !== null ? { policy: o.policy, marginalH } : {}), note: o.why ?? null })
  }
  return chooseSpend(exits, { hashes, capacity, skipped, sellAll })
}

/**
 * The tail every spend decision shares: the winners (deltaH under -1s) by
 * exit-hours per hash; buy the best affordable now, else save for it when
 * the cache can hold it, else sell and name the capacity-bound choice.
 */
function chooseSpend(exits, { hashes, capacity, skipped, sellAll, decidedBy = 'exit-sim' }) {
  const TIE_H = 1 / 3600
  const winners = exits.filter((x) => num(x.deltaH) && x.deltaH < -TIE_H).sort((a, b) => a.perHash - b.perHash)
  if (!winners.length) return sellAll(`no upgrade shortens the exit against selling the same hashes (${exits.length} simulated)`, decidedBy, { exits })
  for (const w of winners) {
    if (w.cost <= hashes) return { action: 'buy', name: w.name, target: w.target, cost: w.cost, why: `exit ${w.withH.toFixed(3)}h with ${w.name}${w.target ? ` on ${w.target}` : ''} vs ${w.sellH.toFixed(3)}h selling the same ${w.cost} hashes`, decidedBy, exits, skipped }
    if (num(capacity) && w.cost <= capacity) return { action: 'save', name: w.name, target: w.target, cost: w.cost, why: `saving for ${w.name} (${w.cost} of ${Math.floor(hashes)} hashes): it beats selling by ${(-w.deltaH * 60).toFixed(1)} min of exit; overflow would sell itself at the same rate, so holding loses nothing but time`, decidedBy, exits, skipped }
  }
  // Every winner costs more than the hashes can hold: sell, and say which
  // upgrade a larger cache would have bought (hacknet.js reads this).
  const w = winners[0]
  return sellAll(`the best upgrade (${w.name}, ${w.cost} hashes) exceeds the hash capacity ${capacity}`, decidedBy, { exits, capacityBound: { name: w.name, target: w.target, cost: w.cost, capacity, deltaH: w.deltaH } })
}

// ---------------------------------------------------------------------------
// THE BLADEBURNER ROUTE: hashes priced on the black-op exit
// ---------------------------------------------------------------------------
//
// On the committed Bladeburner route (splitctl.committedRouteOf) the exit is
// bbplan.bladeExitGen's last black op. Two hash upgrades act on it directly
// (Hacknet/HacknetHelpers.tsx:539-555):
//   Exchange for Bladeburner Rank  Bladeburner.changeRank(+100): rank feeds
//                                  the black-op rank gates; maxRank rises with
//                                  it, so it also pays floor(maxRank/3) skill
//                                  points (Bladeburner.ts:1283-1291) — ~+33 SP
//   Exchange for Bladeburner SP    skillPoints += 10: the skill plan
//                                  (bbplan.planSkills) spends them
// both 250 x (level + 1) hashes (HashUpgrade.getCost; HashUpgradesMetadata
// costPerLevel 250), the levels reset with the hashes and the servers at an
// install (HashManager.prestige).
//
// PRICED BY THE EXIT, from ONE start (progress.js's startFor, the route's
// own): bladeExchangeGen runs the exit with EXCHANGE_FD_N purchases of each
// and divides. The exit is simulated in 5-minute steps (dt 300) and one
// purchase moves it by about one step (live BN7.1 2026-10-10: +100 rank alone
// read -8.4 min, +1000 -23.7 min — a gate crossed or not), so the
// per-purchase effect is the finite difference over ten. Published on
// plan.txt (decisions.bladeRoute.hashExchange) for hashspend.js and hacknet.js.
//
// THE JOINT TRAJECTORY (exchangeTrajectory): hashes arrive at the servers'
// rate, are spent greedily on whichever exchange gives the most exit-hours
// per hash at its escalating cost, bank only to the cache's capacity (an
// exchange costing more than the capacity is unreachable), until the exit
// (moved earlier by the purchases themselves) or the route's install. A
// capacity purchase (hacknet.js: a server, level, RAM, cores, or CACHE) is
// worth the trajectory with it minus without it — the hacknet claimant priced
// on the committed exit, not on money at the install.
//
// NOT SIMULATED (named): a purchase's effect is taken as the same at every
// time before the exit (rank bought later crosses the same gates later); the
// finite difference averages the first ten purchases' effects; the exit's
// own sampling spread (bladeMembers) is not carried — one start, paired.

export const BLADE_EXCHANGE = { rank: { name: 'Exchange for Bladeburner Rank', value: 100 }, sp: { name: 'Exchange for Bladeburner SP', value: 10 } }
/** Purchases bladeExchangeGen's finite difference spans (see above). */
export const EXCHANGE_FD_N = 10
/** BladeburnerConstants.RanksPerSkillPoint (bbplan BBC.RanksPerSkillPoint; not imported: hashplan.js is in hashspend.js's RAM graph). */
const RANKS_PER_SP = 3
/** How old a published exchange price may be (progress.js re-prices every pass, ~5 min). */
export const EXCHANGE_FRESH_MS = 30 * 60e3

/** The Bladeburner start after `n` purchases of an exchange, as the game applies it. */
export function bladeExchangeStart(s0, kind, n = 1) {
  if (!s0 || !(n > 0)) return s0
  if (kind === 'sp') return { ...s0, skillPoints: (s0.skillPoints ?? 0) + BLADE_EXCHANGE.sp.value * n }
  if (kind !== 'rank') return s0
  const rank = (s0.rank ?? 0) + BLADE_EXCHANGE.rank.value * n
  const max0 = s0.maxRank ?? s0.rank ?? 0
  const maxRank = Math.max(max0, rank)
  return { ...s0, rank, maxRank, skillPoints: (s0.skillPoints ?? 0) + Math.floor(maxRank / RANKS_PER_SP) - Math.floor(max0 / RANKS_PER_SP) }
}

/**
 * The two exchanges on the black-op exit: {baseH, n, rank, sp}, each
 * {value, withH, perPurchaseH} (perPurchaseH < 0 shortens the exit), or {why}.
 * `exitGen` is bbplan.bladeExitGen (injected: this module stays light).
 */
export function* bladeExchangeGen(s0, exitGen, { n = EXCHANGE_FD_N } = {}) {
  if (!s0 || s0.joined !== true) return { why: 'not in the Bladeburner division: neither exchange can be bought (HacknetHelpers: "You have not joined Bladeburner")' }
  const hoursOf = function* (s) {
    const r = yield* exitGen(s)
    return num(r?.hours) ? r.hours : null
  }
  const baseH = yield* hoursOf(s0)
  if (baseH === null) return { why: 'the black-op exit is unpriced from this start' }
  const out = { baseH, n }
  for (const kind of ['rank', 'sp']) {
    const withH = yield* hoursOf(bladeExchangeStart(s0, kind, n))
    out[kind] = { value: BLADE_EXCHANGE[kind].value, withH, perPurchaseH: withH === null ? null : (withH - baseH) / n }
  }
  return out
}

/** The published exchange prices when usable for this node now, else {why}. */
export function exchangeOf(plan, { node = null, now = Date.now() } = {}) {
  const x = plan?.decisions?.bladeRoute?.hashExchange
  if (!x) return { why: 'progress.js published no exchange prices (plan.txt decisions.bladeRoute.hashExchange)' }
  if (num(plan.node) && num(node) && plan.node !== node) return { why: "the exchange prices are another node's" }
  if (!num(x.baseH)) return { why: `no exchange prices: ${x.why ?? 'unpriced'}` }
  if (!(now - Date.parse(x.at) < EXCHANGE_FRESH_MS)) return { why: 'the exchange prices are stale (>30 min)' }
  if (!num(x.rank?.perPurchaseH) || !num(x.sp?.perPurchaseH)) return { why: 'the exchange prices are unreadable' }
  return x
}

/** Hours the hashes have on this route: the black-op exit, or the route's own install before it (HashManager.prestige). */
export function bladeHashHorizonH(br, now = Date.now()) {
  const exitH = num(br?.bladeH) ? br.bladeH : null
  const b = br?.installBasis
  const inst = num(b?.installAt) ? Math.max(0, (b.installAt - now) / 3.6e6) : num(b?.waitH) ? Math.max(0, b.waitH) : null
  if (exitH === null) return inst
  return inst === null ? exitH : Math.min(exitH, inst)
}

/** The exchanges' levels this life, read off the game's next price (HashUpgrade.getCost: 250 x (level + 1)). */
export const exchangeLevelOf = (nextCost) => (pos(nextCost) ? Math.max(0, Math.round(nextCost / 250) - 1) : null)

/**
 * THE JOINT TRAJECTORY of hashes into the exchanges, from now to the horizon.
 *   hashes0, capacity, ratePerSec  the cache now, its size, the servers' rate
 *   horizonH   the exit (or install) with no purchase; the purchases move it
 *   levels     {rank, sp} upgrade levels bought this life
 *   gainH      {rank, sp} exit hours per purchase (exchangeOf perPurchaseH)
 * Greedy by exit-hours per hash at each exchange's NEXT cost, among those the
 * capacity can hold; hashes bank until the choice is affordable (saving never
 * overflows: cost <= capacity). The purchase in progress at the horizon is
 * credited by the fraction of its cost banked, so the value moves smoothly
 * with the rate (a level upgrade is worth its share, not 0 or 1 purchase).
 * Returns {gainH (<= 0), buys: {rank, sp}, endH, partial}.
 */
export function exchangeTrajectory({ hashes0 = 0, capacity, ratePerSec, horizonH, levels = {}, gainH = {}, maxBuys = 20000 }) {
  const out = { gainH: 0, buys: { rank: 0, sp: 0 }, endH: 0, partial: 0 }
  if (!pos(capacity) || !num(ratePerSec) || ratePerSec < 0 || !num(horizonH) || !(horizonH > 0)) return { ...out, why: 'capacity, rate or horizon unreadable' }
  const lv = { rank: num(levels.rank) ? levels.rank : 0, sp: num(levels.sp) ? levels.sp : 0 }
  let h = Math.min(Math.max(0, num(hashes0) ? hashes0 : 0), capacity)
  let t = 0
  for (let i = 0; i < maxBuys; i++) {
    let best = null
    for (const k of ['rank', 'sp']) {
      const g = gainH[k]
      if (!num(g) || !(g < 0)) continue
      const c = upgradeCost(BLADE_EXCHANGE[k].name, lv[k])
      if (!(c <= capacity)) continue
      if (!best || -g / c > -best.g / best.c) best = { k, g, c }
    }
    if (!best) break
    const endH = horizonH + out.gainH
    const waitH = h >= best.c ? 0 : ratePerSec > 0 ? (best.c - h) / ratePerSec / 3600 : Infinity
    if (t + waitH >= endH) {
      const banked = Math.min(best.c, h + (ratePerSec > 0 ? Math.max(0, endH - t) * 3600 * ratePerSec : 0))
      out.partial = banked / best.c
      out.gainH += best.g * out.partial
      t = Math.max(t, endH)
      break
    }
    t += waitH
    h = Math.max(h, best.c) - best.c
    lv[best.k]++
    out.buys[best.k]++
    out.gainH += best.g
  }
  out.endH = t
  return out
}

/** Total hash rate and capacity of a server fleet, on the game's model (hacknetplan.hashRate, HacknetServer.updateHashCapacity). */
export function fleetHashState(servers, mults, nodeMoney) {
  let rate = 0
  let capacity = 0
  for (const s of servers ?? []) {
    const r = hashRate(s.level, num(s.ramUsed) ? s.ramUsed : 0, s.ram, s.cores, mults?.hacknet_node_money, nodeMoney)
    if (!num(r)) return null
    rate += r
    capacity += hashCapacityOf(num(s.cache) ? s.cache : 1) ?? 0
  }
  return { rate, capacity }
}

/**
 * THE HACKNET CLAIMANT ON THE BLADEBURNER ROUTE: every capacity purchase
 * (server, level, RAM, cores — and CACHE, whose capacity decides which
 * escalating exchange can be banked for) priced as exchangeTrajectory with
 * it minus without it, greedy by exit-hours per dollar, inside `budget`.
 * `servers` carry `cache`. Returns {items:[{kind, index, cost, hashGainPerSec,
 * capGain, deltaH}], cost, deltaH, baseGainH, servers (the fleet after), stoppedBy}.
 */
/** Cache steps a server offers in one candidate (planRouteHacknetBatch). */
const CACHE_RUN = 8
/** applyServerPurchase, `count` times (a cache run). */
function applyCount(fleet, c) {
  let f = fleet
  for (let i = 0; i < (c.count ?? 1); i++) f = applyServerPurchase(f, c)
  return f
}

export function planRouteHacknetBatch({ servers, mults, nodeMoney, hashes = 0, exchange, levels, horizonH, budget = Infinity, maxItems = 200 }) {
  const out = { items: [], cost: 0, deltaH: 0, baseGainH: null, stoppedBy: null }
  if (!exchange || !num(exchange.rank?.perPurchaseH) || !num(exchange.sp?.perPurchaseH)) return { ...out, stoppedBy: 'no exchange prices' }
  const gainH = { rank: exchange.rank.perPurchaseH, sp: exchange.sp.perPurchaseH }
  let fleet = (servers ?? []).map((s) => ({ ...s, cache: num(s.cache) ? s.cache : 1 }))
  const stateOf = (f) => fleetHashState(f, mults, nodeMoney)
  const trajOf = (st) => exchangeTrajectory({ hashes0: hashes, capacity: st.capacity, ratePerSec: st.rate, horizonH, levels, gainH }).gainH
  let st = stateOf(fleet)
  if (!st) return { ...out, stoppedBy: "the fleet's hash rate is unreadable" }
  let g0 = trajOf(st)
  out.baseGainH = g0
  let left = num(budget) ? budget : Infinity
  while (out.items.length < maxItems) {
    const cands = serverCandidates(fleet, mults, nodeMoney, DOLLARS_PER_HASH)
    if (!Array.isArray(cands)) return { ...out, stoppedBy: cands.why }
    // CACHE IN RUNS: one step is often worth nothing alone (live BN7.1: 256
    // -> 320 hashes still cannot bank the 500-hash second rank exchange; three
    // steps on one server can), so each server offers 1..CACHE_RUN steps.
    fleet.forEach((s, i) => {
      for (let k = 1; k <= CACHE_RUN; k++) {
        const c = cacheCost(s.cache, k)
        if (isFinite(c) && c > 0) cands.push({ kind: 'cache', index: i, count: k, cost: c, hashGainPerSec: 0 })
      }
    })
    let best = null
    for (const c of cands) {
      if (!(c.cost <= left)) continue
      const after = applyCount(fleet, c)
      const s1 = stateOf(after)
      if (!s1) continue
      const d = trajOf(s1) - g0
      if (!(d < -1e-9)) continue
      if (!best || -d / c.cost > -best.d / best.c.cost) best = { c, d, s1, after }
    }
    if (!best) return { ...out, servers: fleet, stoppedBy: out.items.length ? 'nothing else shortens the black-op exit' : 'no purchase shortens the black-op exit' }
    out.items.push({ kind: best.c.kind, index: best.c.index, ...(best.c.count ? { count: best.c.count } : {}), cost: best.c.cost, hashGainPerSec: best.c.hashGainPerSec, capGain: best.s1.capacity - st.capacity, deltaH: best.d })
    out.cost += best.c.cost
    out.deltaH += best.d
    left -= best.c.cost
    fleet = best.after
    st = best.s1
    g0 += best.d
  }
  return { ...out, servers: fleet, stoppedBy: `maxItems ${maxItems}` }
}

/**
 * THE SPENDER'S DECISION ON THE BLADEBURNER ROUTE: each exchange's next
 * purchase on the black-op exit (exchange.perPurchaseH) against SELLING the
 * same hashes, the sale's money priced at what money buys on this route:
 *   route.moneyLegs (committedRouteOf: the exit reads income through a route
 *                purchase) — the sale is unpriced here, so no exchange is
 *                bought against it: the floor (sell), named
 *   none       — the money moves the exit only through the hacknet claimant's
 *                route-priced purchases (sale.perDollarH: hacknet.js's best
 *                exit-hours per dollar, <= 0; 0 when it buys nothing)
 * Same tail as decideHashSpend (buy / save / capacity-bound).
 */
export function decideBladeHashSpend({ hashes, capacity, exchange, levels = {}, route = null, sale = null, skipped = [] }) {
  const sellAll = (why, decidedBy, extra = {}) => ({ action: 'sell', count: pos(hashes) ? Math.floor(hashes / 4) : 0, why, decidedBy, skipped, ...extra })
  if (!num(hashes) || hashes < 0) return { action: 'none', why: 'hash count unreadable', decidedBy: 'refused', skipped }
  if (!exchange || !num(exchange.baseH)) return sellAll(`the Bladeburner route's exchanges are unpriced (${exchange?.why ?? 'no prices'}): every hash is sold (the floor)`, 'floor')
  const legs = Array.isArray(route?.moneyLegs) ? route.moneyLegs.filter(Boolean) : []
  if (legs.length) return sellAll(`the black-op exit reads money (${legs.join('; ')}): a sale is not priced here, so no exchange is bought against it — the floor (sell)`, 'route-unpriced')
  const perDollarH = num(sale?.perDollarH) && sale.perDollarH < 0 ? sale.perDollarH : 0
  const exits = []
  for (const k of ['rank', 'sp']) {
    const name = BLADE_EXCHANGE[k].name
    const cost = upgradeCost(name, num(levels[k]) ? levels[k] : 0)
    const g = exchange[k]?.perPurchaseH
    if (!pos(cost) || !num(g)) {
      exits.push({ name, target: null, cost: cost ?? null, why: 'an exit could not be priced' })
      continue
    }
    const money = (cost / 4) * 1e6
    const withH = exchange.baseH + g
    const sellH = exchange.baseH + money * perDollarH
    exits.push({ name, target: null, cost, withH, sellH, deltaH: withH - sellH, perHash: (withH - sellH) / cost, note: `+${BLADE_EXCHANGE[k].value} ${k === 'rank' ? 'rank' : 'skill points'} on the black-op exit (${(g * 60).toFixed(2)} min per purchase); the sale's $${money.toExponential(2)} ${perDollarH < 0 ? `funds the hacknet claimant's route purchases (${(money * perDollarH * 60).toFixed(2)} min)` : 'buys nothing the black-op exit reads (no route money leg, and the hacknet claimant buys nothing that shortens it)'}` })
  }
  return chooseSpend(exits, { hashes, capacity, skipped, sellAll, decidedBy: 'route-exit-sim' })
}
