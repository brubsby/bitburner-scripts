// WHAT AN IPvGO BONUS IS WORTH TO THE EXIT — per channel, in exit hours per
// unit ln of the multiplier, from a with-vs-without exit simulation.
//
// goplan.chooseOpponent ranks opponents by weight x d ln E/dn x nodePower/h.
// Until 2026-09-29 the weights were objective.exitWeights', which price an
// AUGMENTATION: a gain applied to the whole income stream, in every later
// life. A Go bonus is neither, and priced that way it was wrong three times
// over (live BN9, 2026-09-29):
//
//   (a) THE STREAM. exitWeights' hacking_money/hacking_speed scale the exit's
//       incomePerSec — $10.2M/s, which is getTotalScriptIncome and so mostly
//       stock.js's realised trades (StockMarket/BuyingAndSelling.tsx:175 adds
//       them to the script's onlineMoneyMade). The Go multiplier reaches
//       only what hack() earns (Hacking.ts:54 money, :75 speed): the batcher,
//       $11.6k/s (batch.txt totals.earnedPerSec) — a thousandth of it.
//   (b) THE LIFE. An augmentation persists; Go.prestigeAugmentation
//       (Go/Go.ts:34-47) zeroes every opponent's node power at EVERY install.
//       The bonus acts from now until the next install and not after.
//   (c) THE EXP PATH. hacking_speed also speeds the exp the scripts earn (the
//       batcher and batch.js's exp farm). Exp before an install is reset by
//       it, so that path is worth something only in the final window, where
//       the bonus lasts until the terminal install.
//
// THE MODEL, channel by channel, on progress.js's published exit inputs
// (/tel/exitinputs.txt) with the bonus alive for exactly its life:
//
//   Next install at W (not the final window). The exit policies simulated
//   all install at W (spendRuns min 1), so a bonus reaches the exit ONLY
//   through what it adds to the batch bought at W:
//     money   dollars at W: stream x elasticity x W x 3600 per unit ln,
//             priced at the ladder's PLATEAU SECANT (exit hours per dollar
//             from the batch at W to the next ladder level whose gains
//             differ — the expected value of a dollar whose position on the
//             lumpy augmentation ladder is unknown; objective.exitWeights'
//             hacknet channel priced it the same way).
//     rep     reputation at W: eRep (d ln planM / d ln rep, the planner's
//             own probe) x the share of the life's reputation still to come
//             (W / (age + W), a constant rate over the life), in exit hours
//             per ln of the batch (the simulated hacking sensitivity).
//     exp     0: every skill's exp is reset by the install.
//   Final window (no install before the terminal one): the bonus lasts
//   through every money, reputation and join-level leg and ends at the
//   terminal install, so each channel's stream is scaled in the simulation:
//     money   extraIncome +stream x elasticity (the legs before the climb)
//     rep     repPerSec x e^d
//     exp     preInstallExpMult (exitplan: removed for the post-install climb)
//     hacknet lifeIncome x e^d (exitplan runs it on hold-to-exit legs only)
//
// ELASTICITIES of each stream to its multiplier, from the game formulas:
//   hacking_money       the batcher's income, x hackShare: at a fixed steal
//                       fraction a richer hack() needs fewer hack threads and
//                       their weaken, the grow side is unchanged, so income
//                       per GB rises by the hack side's share of the batch's
//                       threads (a floor: a re-optimised fraction does better).
//   hacking_speed       the batcher's income x 1 (every H/G/W time scales as
//                       1/speed, Hacking.ts:75, so a RAM-bound batcher cycles
//                       its RAM that much faster), and script exp x 1.
//   hacknet_node_money  hacknet production x 1 (HacknetHelpers.tsx:414, the
//                       hash rate is re-read every cycle).
//   faction_rep         the player's faction reputation x 1.
//
// COMMON RANDOM NUMBERS. Each channel's with-run and the shared without-run
// are simulated on the SAME parameter draws (plan.makeDraws, through
// plan.applyDraw), and the weight is the mean of the paired differences —
// how the plan compares every option, so draw noise cancels.
//
// NOT PRICED (floors, named): a hacking level reached before an install that
// opens a join (and so a bigger batch) — the ladder is by money only; the
// stock-manipulation nudges a faster hack() adds (not served while
// batch.txt's manip verdict is off); a sleeve's share of repPerSec, which the
// player's faction_rep does not touch (playerRepShare, default 1 — an
// overstatement in the final window only).
//
// Pure: no ns surface. The exit simulator, the ladder reader and the draw
// applicator are injected, as objective.exitWeights takes them.

import { drain } from 'coop.js'
import { bladeExitGen } from 'bbplan.js'
import { addRepToFavor } from 'favor.js'

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0
const frac = (x) => num(x) && x >= 0 && x <= 1

/** The four channels a Go opponent can feed that the exit can price. */
export const GO_CHANNELS = ['hacking_money', 'hacking_speed', 'hacknet_node_money', 'faction_rep']

/** Finite step for the simulated (final-window) channels, in ln. */
const D = 0.05

/**
 * Hours per unit ln of each Go channel, the bonus alive until the next
 * install. See the header.
 *
 *   record   /tel/exitinputs.txt (progress.js), fresh and this life's
 *   o: {
 *     lastAugReset, now,
 *     bestExitPolicy, spendRuns    exitplan.js
 *     applyDraw, draws             plan.js — absent: one draw at the point inputs
 *     batchMoneyPerSec             what hack() earns (batch.txt totals.earnedPerSec)
 *     hackShare                    (h + w1) / (h + g + w1 + w2) over the batch
 *     scriptExpPerSec              exp the scripts earn (tel.js status expPerSec)
 *     hacknetPerSec                default record.inputs.lifeIncome
 *     ageH                         hours since the last install
 *     playerRepShare               default 1
 *     budgetMs, clock              the draws stop at the budget (never below 2)
 *   }
 *
 * Returns { weights: {channel: hours per ln}, detail, n, horizon, why } or
 * { weights: null, why } — a refusal is named, never a zero.
 */
export function goWeights(record, o = {}) {
  return drain(goWeightsGen(record, o))
}

/** The generator goWeights drains: yields after every exit simulation (coop.js). */
export function* goWeightsGen(record, o = {}) {
  const refuse = (why) => ({ weights: null, why })
  const { bestExitPolicy, spendRuns } = o
  const now = num(o.now) ? o.now : Date.now()
  if (!record?.inputs || typeof bestExitPolicy !== 'function' || typeof spendRuns !== 'function') return refuse('no exit inputs or simulator')
  if (record.lastAugReset !== o.lastAugReset) return refuse('exit inputs are from another life')
  if (!(now - Date.parse(record.at) < 15 * 60e3)) return refuse('exit inputs are stale (>15 min)')

  const batch = num(o.batchMoneyPerSec) && o.batchMoneyPerSec >= 0 ? o.batchMoneyPerSec : null
  if (batch === null) return refuse("the batcher's income is unmeasured — hacking_money/hacking_speed act on it alone")
  // No batcher income: hacking_money weighs 0 whatever the share (a batcher
  // with no targets yet, the opening of a life), so the share is not needed.
  if (!frac(o.hackShare) && batch > 0) return refuse("the batch's hack-side thread share is unmeasured")
  const hackShare = frac(o.hackShare) ? o.hackShare : 0
  const hacknet = num(o.hacknetPerSec) && o.hacknetPerSec >= 0 ? o.hacknetPerSec : pos(record.inputs.lifeIncome) ? record.inputs.lifeIncome : 0
  const repShare = frac(o.playerRepShare) ? o.playerRepShare : 1

  const draws = Array.isArray(o.draws) && o.draws.length && typeof o.applyDraw === 'function' ? o.draws : [null]
  const at = (inputs, d) => (d === null ? inputs : o.applyDraw(inputs, d))
  const clock = typeof o.clock === 'function' ? o.clock : () => Date.now()
  const budgetMs = num(o.budgetMs) && o.budgetMs > 0 ? o.budgetMs : Infinity
  const extra = { eRep: record.eRep, eBudget: record.eBudget }

  const runs = spendRuns(record, 0)
  if (!runs) return refuse('the exit inputs carry no install point or batch ladder')
  const T = (inputs) => bestExitPolicy({ ...inputs, ...extra }, runs.max, runs.min)?.best?.hours

  const acc = { hacking_money: [], hacking_speed: [], hacknet_node_money: [], faction_rep: [] }
  const detail = {}
  const t0 = clock()
  let n = 0

  if (record.finalWindow === true) {
    // THE BONUS LASTS THE WHOLE FINAL WINDOW, and ends at the terminal install.
    const scriptExp = num(o.scriptExpPerSec) && o.scriptExpPerSec >= 0 ? o.scriptExpPerSec : null
    if (scriptExp === null) return refuse('script exp rate unmeasured — hacking_speed acts on it in the final window')
    const base = runs.without
    const e = Math.expm1(D)
    const expShare = pos(base.expPerSec) ? Math.min(1, scriptExp / base.expPerSec) : 0
    const withIncome = (x, add) => (add > 0 ? { ...x, extraIncome: addIncome(x.extraIncome, add) } : x)
    for (const d of draws) {
      if (n >= 2 && clock() - t0 > budgetMs) break
      const b = at(base, d)
      const T0 = T(b)
      yield
      const Tm = T(withIncome(b, batch * hackShare * e))
      yield
      const Ts = T({ ...withIncome(b, batch * e), preInstallExpMult: 1 + expShare * e })
      yield
      const Th = hacknet > 0 ? T({ ...b, lifeIncome: hacknet * Math.exp(D) }) : T0
      if (hacknet > 0) yield
      const Tr = pos(b.repPerSec) ? T({ ...b, repPerSec: b.repPerSec * (1 + repShare * e) }) : T0
      if (pos(b.repPerSec)) yield
      if (![T0, Tm, Ts, Th, Tr].every(num)) continue
      acc.hacking_money.push((T0 - Tm) / D)
      acc.hacking_speed.push((T0 - Ts) / D)
      acc.hacknet_node_money.push((T0 - Th) / D)
      acc.faction_rep.push((T0 - Tr) / D)
      n++
    }
    Object.assign(detail, { expShare: +expShare.toFixed(4) })
  } else {
    const W = record.W
    if (!pos(W)) return refuse('no install point W — the bonus has no life to price')
    // THE PLATEAU SECANT (see the header): exit hours per dollar at W.
    const ladder = (record.gainsByMoney ?? []).filter((r) => num(r?.money) && r?.gains).sort((x, y) => x.money - y.money)
    const key = (g) => JSON.stringify(g)
    const here = runs.without.installGains ? key(runs.without.installGains) : null
    const hi = ladder.find((r) => r.money > record.moneyAtW && key(r.gains) !== here)
    const lo = [...ladder].reverse().find((r) => r.money < record.moneyAtW && key(r.gains) !== here)
    const span = hi ? hi.money - (lo ? lo.money : 0) : null
    const rHi = hi ? spendRuns(record, -(hi.money - record.moneyAtW), { allowGain: true }) : null
    const eRep = num(record.eRep) && record.eRep > 0 ? record.eRep : 0
    const ageH = num(o.ageH) && o.ageH >= 0 ? o.ageH : 0
    const repFrac = W / (ageH + W)
    const g0 = runs.without.installGains ?? { hacking: 1, rep: 1, income: 1, exp: 1 }
    const perLnDollars = {
      hacking_money: batch * hackShare * W * 3600,
      hacking_speed: batch * W * 3600,
      hacknet_node_money: hacknet * W * 3600,
    }
    for (const d of draws) {
      if (n >= 2 && clock() - t0 > budgetMs) break
      const b = at(runs.without, d)
      const T0 = T(b)
      yield
      if (!num(T0)) continue
      // Above the ladder's top the batch is saturated: a dollar buys nothing (a known 0).
      let hpd = 0
      if (rHi && span > 0) {
        const Thi = T(at(rHi.with, d))
        yield
        if (!num(Thi)) continue
        hpd = Math.max(0, T0 - Thi) / span
      }
      // Exit hours per ln of the batch, for the reputation path (only when it has one).
      let hpl = 0
      if (eRep > 0) {
        const gh = { ...g0, hacking: (pos(g0.hacking) ? g0.hacking : 1) * Math.exp(D) }
        const Th = T({ ...b, installGains: gh, nextInstallGain: gh.hacking })
        yield
        if (!num(Th)) continue
        hpl = Math.max(0, T0 - Th) / D
      }
      for (const c of ['hacking_money', 'hacking_speed', 'hacknet_node_money']) acc[c].push(hpd * perLnDollars[c])
      acc.faction_rep.push(eRep * repShare * repFrac * hpl)
      n++
    }
    Object.assign(detail, {
      W: +W.toFixed(4),
      hoursPerTDollar: acc.hacking_money.length && perLnDollars.hacking_money > 0 ? +((mean(acc.hacking_money) / perLnDollars.hacking_money) * 1e12).toPrecision(4) : null,
      plateau: hi ? { lo: lo ? lo.money : 0, hi: hi.money, moneyAtW: record.moneyAtW } : 'saturated (above the ladder top)',
      dollarsPerLn: Object.fromEntries(Object.entries(perLnDollars).map(([k, v]) => [k, Math.round(v)])),
      repFrac: +repFrac.toFixed(4),
      eRep,
    })
  }
  if (n === 0) return refuse('no draw could price the exit with and without the bonus')
  const weights = Object.fromEntries(GO_CHANNELS.map((c) => [c, Math.max(0, mean(acc[c]))]))
  const horizon = record.finalWindow === true ? 'the final window (until the terminal install)' : `the next install, in ${record.W.toFixed(2)}h`
  const favor = yield* favorWeightGen(record, { T, at, draws: draws.slice(0, n), member: o.exitMember, exitFaction: o.exitFaction ?? 'Daedalus' })
  return {
    weights,
    favor,
    unit: 'exit hours per unit ln of the multiplier',
    n,
    horizon,
    streams: { batchMoneyPerSec: batch, hackShare, hacknetPerSec: hacknet, scriptExpPerSec: o.scriptExpPerSec ?? null, playerRepShare: repShare },
    detail,
    ms: +(clock() - t0).toFixed(1),
    why: null,
  }
}

function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
}

// ---------------------------------------------------------------------------
// THE EXIT FACTION'S FAVOR FROM ITS GO WINS (goWeightsGen's `favor`).
//
// Not a multiplier channel: a win against a faction's AI that leaves the
// streak even sets that faction's favor to addRepToFavor(favor,
// getMaxRep()/200) on the spot, for a MEMBER, until the node's total reaches
// getMaxRep() (Go/boardAnalysis/scoring.ts:66-78; effect.ts:30-43: 100k, or
// 200k/300k/400k at SF14 1/2/3 — activeSourceFileLvl, so the level held
// ENTERING the node, not the node being played). The total (Go stats `rep`)
// survives every install and is cleared only at the node's end (Go/Go.ts:
// 25-47 prestigeAugmentation vs prestigeSourceFile), and favor itself
// survives installs (Faction.ts:77-79) — so unlike node power this is a
// STOCK, banked once per node per opponent, and it counts toward the
// donation threshold exactly as install-banked favor does (donation.ts:16-18
// reads faction.favor).
//
// THE PRICE, exit hours per rep-equivalent of the cap left, simulated both
// ways on the same draws (the exit inputs carry the stream: the measured one
// while go.js plays the exit faction, else the plan's — goplan.goExitInputsOf):
//   final window   the stream as planned vs no stream at all: this window is
//                  the cap's last chance.
//   earlier life   the whole cap banked NOW (exitFavor + cap, no stream) vs
//                  the plan as it stands (the farm in the final window): what
//                  playing it now rather than later is worth.
// divided by the cap left — the secant over the whole cap, because the
// threshold at 150 makes the per-rep value lumpy.
// Zero, named, when the player is not a member (a win banks nothing) or the
// cap is spent; null (refused, named) when membership is unread.
// NOT PRICED (named): favor with factions other than the exit's (their
// augmentations' reputation) — the Bladeburner route's Tetrads/Netburners/
// Slum Snakes favor among them.

function* favorWeightGen(record, { T, at, draws, member, exitFaction }) {
  const inp = record.inputs
  const st = inp.favorStream && inp.favorStream.repPerH > 0 ? inp.favorStream : inp.go?.favorStream && inp.go.favorStream.repPerH > 0 ? inp.go.favorStream : null
  const base = { faction: exitFaction, hoursPerRep: 0, capRep: st ? st.capRep ?? null : 0 }
  if (member !== true && member !== false) return { ...base, hoursPerRep: null, why: `membership of ${exitFaction} unread: a win banks favor only for a member (scoring.ts:70)` }
  if (!member) return { ...base, why: `not a member of ${exitFaction}: a win banks it no favor (scoring.ts:70)` }
  if (!st) return { ...base, why: 'no favor stream in the exit inputs (go.js unmeasured and no planned farm)' }
  if (!(num(st.capRep) && st.capRep > 0)) return { ...base, capRep: 0, why: `the node's Go favor for ${exitFaction} is spent (getMaxRep reached)` }
  const strip = (x) => ({ ...x, favorStream: null, ...(x.go ? { go: { ...x.go, favorStream: null } } : {}) })
  const fin = record.finalWindow === true
  const diffs = []
  for (const d of draws) {
    const b = at(inp, d)
    const Tw = fin ? T(b) : T(strip({ ...b, exitFavor: addRepToFavor(num(b.exitFavor) && b.exitFavor > 0 ? b.exitFavor : 0, st.capRep) }))
    yield
    const Tn = fin ? T(strip(b)) : T(b)
    yield
    if (num(Tw) && num(Tn)) diffs.push(Tn - Tw)
  }
  if (!diffs.length) return { ...base, hoursPerRep: null, why: 'no draw priced the exit with and without the favor' }
  const saved = mean(diffs)
  return {
    ...base,
    hoursPerRep: Math.max(0, saved) / st.capRep,
    savedH: +saved.toFixed(4),
    n: diffs.length,
    why: fin
      ? `final window: the ${Math.round(st.capRep)} rep-eq left of ${exitFaction}'s Go favor, streamed vs never, saves ${saved.toFixed(3)}h`
      : `earlier life: ${Math.round(st.capRep)} rep-eq of ${exitFaction}'s Go favor banked now vs streamed in the final window saves ${saved.toFixed(3)}h`,
  }
}

// ---------------------------------------------------------------------------
// THE BLADEBURNER ROUTE (bladeGoWeightsGen).
//
// goWeightsGen above prices every channel on the HACKING exit
// (/tel/exitinputs.txt, exitplan's policies). On the committed Bladeburner
// route (plan.txt decisions.bladeRoute.key === 'blade') the exit is the 21
// black ops (bbplan.bladeExit), and the hacking exit's hours are not this
// trajectory's. Live BN4.3 2026-10-03: go.js read "Tetrads (combat: no exit
// weight)" while the combat levels are what every black op's success chance
// is made of (bbplan.successChance) — and the channels it did price were
// priced on an exit the route is not taking.
//
// So on that route every channel is priced on the black-op exit, the bonus
// alive from now to the committed install (Go.prestigeAugmentation zeroes it,
// Go/Go.ts:34-47), with and without, on the route's one start builder
// (progress.js pc.bladeCtx.startFor):
//
//   combat              str/def/dex/agi level multipliers x e^D from now,
//                       x e^-D at the install (bbplan s0.steps: a multiplier
//                       that keeps exp). THE EXIT IS LUMPY in D: an op's
//                       success crosses the policy's bar or does not, so a
//                       small D moves the exit by nothing or by a whole step
//                       (live BN4.3 fixture: D 0.05 -> 39.8 h/ln, 0.1 ->
//                       11.4). The weight is the least-squares slope through
//                       the origin over BLADE_D_GRID — a Tetrads farm moves
//                       the multiplier by ln 1.3-1.7 over a window, the scale
//                       the slope is read at.
//   hacking_money       dollars at the install (stream x elasticity x W x
//   hacking_speed       3600 per ln, goWeightsGen's arithmetic) x exit hours
//   hacknet_node_money  per dollar of the install's batch (batchAt, the
//                       planner re-run, on this exit through bladeContentOf:
//                       the plateau secant across the batch's money step).
//                       No install before the exit: a known 0 (money moves
//                       this exit only through an install's batch).
//   faction_rep         eRep (d ln planM / d ln rep) x the life's share still
//                       to come x exit hours per ln of the batch (every gain
//                       raised to e^D).
//   crime_success       not on this route (SlumSnakes stays skipped by name).
//
// NOT SIMULATED (named): installs after the committed one (each is the next
// decision's), and the hack-side share when batch.txt is unmeasured (1, an
// upper bound — conservative against combat).
//
// Pure: startFor and batchAt are the caller's (progress.js).

/** The combat bonus sizes (ln) the slope is fit over — see above. */
export const BLADE_D_GRID = [0.1, 0.2, 0.3, 0.4]

const COMBAT = ['strength', 'defense', 'dexterity', 'agility']

/**
 * Exit hours per unit ln of each Go channel on the black-op exit.
 *
 *   startFor(spec)     the route's start builder (progress.js pc.bladeCtx.startFor)
 *   spec               the committed install spec ({kind:'wait', waitH, blade}) or null
 *   maxH               the exit simulation's horizon
 *   batchAt(m)         the install's batch content ({gains, simulacrum}) bought with $m,
 *                      or a generator returning it (run in this generator's steps)
 *   moneyAtInstall     money at the committed install
 *   batchMoneyPerSec   what hack() earns ($/s); streamSource names where it came from
 *   hackShare          the batch's hack-side thread share (absent: 1, an upper bound)
 *   hacknetPerSec      hacknet production ($/s)
 *   eRep, ageH, playerRepShare   as goWeightsGen
 *
 * Returns {weights: {combat, hacking_money, hacking_speed, hacknet_node_money,
 * faction_rep}, route: 'blade', windowH, unit, horizon, detail, why: null} or
 * {weights: null, route: 'blade', why}.
 */
export function* bladeGoWeightsGen(o = {}) {
  const refuse = (why) => ({ weights: null, route: 'blade', why })
  const { startFor, spec = null, batchAt = null } = o
  if (typeof startFor !== 'function') return refuse('no Bladeburner start to price from')
  const maxH = pos(o.maxH) ? o.maxH : 400
  const W = spec?.kind === 'wait' && num(spec.waitH) ? Math.max(0, spec.waitH) : Infinity
  // EVERY CALL OUT IS ITS OWN STEP. startFor and batchAt are the caller's
  // (progress.js: batchAt is a planPurchases re-plan, several ms each), and
  // the plateau search below asks up to 18 of them. Run back to back they
  // were one step under the pacer — live BN4.3 2026-10-03 10:53Z: "PLAN
  // BLOCKED THE PAGE: 91.1ms ... longest step 89ms in 'goweights-blade'
  // (step 9058 of 10564)", the ladder after the re-planned batch's exit. A
  // yield after each keeps a step to one call; the work and its order are
  // unchanged, so the weights are identical.
  const exitOf = function* (sp, steps) {
    const s0 = startFor(sp)
    yield
    const r = yield* bladeExitGen({ ...s0, maxH, ...(steps.length ? { steps } : {}) })
    return num(r?.hours) ? r.hours : null
  }
  const T0 = yield* exitOf(spec, [])
  if (!num(T0)) return refuse('the black-op exit is unpriced from this start')
  const installs = num(W) && W < T0
  const detail = { exitH: +T0.toFixed(3), installAtH: num(W) ? +W.toFixed(3) : null }

  // ---- combat: the slope over the grid -----------------------------------
  let sxy = 0
  let sxx = 0
  const curve = []
  for (const D of BLADE_D_GRID) {
    const up = Object.fromEntries(COMBAT.map((k) => [k, Math.exp(D)]))
    const down = Object.fromEntries(COMBAT.map((k) => [k, Math.exp(-D)]))
    const T = yield* exitOf(spec, [{ atH: 0, gains: up }, ...(installs ? [{ atH: W, gains: down }] : [])])
    if (!num(T)) return refuse(`the black-op exit with combat x e^${D} is unpriced`)
    curve.push([D, +T.toFixed(3)])
    sxy += D * (T0 - T)
    sxx += D * D
  }
  const w = { combat: Math.max(0, sxy / sxx), hacking_money: 0, hacking_speed: 0, hacknet_node_money: 0, faction_rep: 0 }
  detail.combatCurve = curve

  // ---- the batch's channels: only through the committed install ----------
  if (!installs) {
    detail.batch = "no install before the exit: money and reputation move this exit only through an install's batch — a known 0"
  } else {
    if (typeof batchAt !== 'function' || !num(o.moneyAtInstall)) return refuse('an install is committed but its batch cannot be re-planned (batchAt / moneyAtInstall) — the money and reputation channels act through it')
    const m0 = Math.max(0, o.moneyAtInstall)
    const specOf = (b) => ({ ...spec, blade: { gains: b?.gains ?? {}, simulacrum: b?.simulacrum === true } })
    const keyOf = (b) => JSON.stringify(b?.gains ?? {}) + (b?.simulacrum === true ? '+sim' : '')
    const b0 = yield* callOut(batchAt(m0))
    yield
    if (!b0) return refuse('the install batch could not be planned')
    const Tb = yield* exitOf(specOf(b0), [])
    if (!num(Tb)) return refuse('the black-op exit on the re-planned batch is unpriced')
    // THE PLATEAU SECANT: the nearest money up and down whose batch differs
    // (x1.25 a probe, at most x8 / ÷8), the exit read at the upper one.
    const base = Math.max(1e6, m0)
    let hi = null
    let bHi = null
    for (let m = base * 1.25; m <= base * 8; m *= 1.25) {
      const b = yield* callOut(batchAt(m))
      yield
      if (b && keyOf(b) !== keyOf(b0)) {
        hi = m
        bHi = b
        break
      }
    }
    let lo = 0
    for (let m = m0 / 1.25; m >= m0 / 8 && m > 0; m /= 1.25) {
      const b = yield* callOut(batchAt(m))
      yield
      if (b && keyOf(b) !== keyOf(b0)) {
        lo = m
        break
      }
    }
    let hpd = 0
    if (bHi) {
      const Thi = yield* exitOf(specOf(bHi), [])
      if (!num(Thi)) return refuse('the black-op exit on the next batch up is unpriced')
      hpd = Math.max(0, Tb - Thi) / (hi - lo)
      detail.plateau = { lo: Math.round(lo), hi: Math.round(hi), moneyAtInstall: Math.round(m0), exitAtHi: +Thi.toFixed(3) }
    } else detail.plateau = `no different batch within x8 of $${(m0 / 1e6).toFixed(1)}m: a dollar buys nothing nearby (a known 0)`
    const batch = num(o.batchMoneyPerSec) && o.batchMoneyPerSec >= 0 ? o.batchMoneyPerSec : 0
    const hackShare = frac(o.hackShare) ? o.hackShare : 1
    const hacknet = num(o.hacknetPerSec) && o.hacknetPerSec >= 0 ? o.hacknetPerSec : 0
    const perLn = { hacking_money: batch * hackShare * W * 3600, hacking_speed: batch * W * 3600, hacknet_node_money: hacknet * W * 3600 }
    for (const k of Object.keys(perLn)) w[k] = hpd * perLn[k]
    detail.hoursPerMDollar = +(hpd * 1e6).toPrecision(4)
    detail.streams = { batchMoneyPerSec: batch, source: o.streamSource ?? null, hackShare, hacknetPerSec: hacknet }
    // Reputation: exit hours per ln of the batch (every gain raised to e^D,
    // so ln of the batch grows by exactly D in relative terms).
    const eRep = num(o.eRep) && o.eRep > 0 ? o.eRep : 0
    const nonEmpty = Object.values(b0.gains ?? {}).some((g) => pos(g) && g !== 1)
    if (eRep > 0 && nonEmpty) {
      const D = 0.1
      const g1 = Object.fromEntries(Object.entries(b0.gains).map(([k, g]) => [k, pos(g) ? Math.pow(g, Math.exp(D)) : g]))
      const Tr = yield* exitOf(specOf({ ...b0, gains: g1 }), [])
      if (!num(Tr)) return refuse('the black-op exit on the scaled batch is unpriced')
      const hpl = Math.max(0, Tb - Tr) / D
      const ageH = num(o.ageH) && o.ageH >= 0 ? o.ageH : 0
      const repShare = frac(o.playerRepShare) ? o.playerRepShare : 1
      w.faction_rep = eRep * repShare * (W / (ageH + W)) * hpl
      detail.rep = { eRep, hoursPerLnBatch: +hpl.toFixed(3), repFrac: +(W / (ageH + W)).toFixed(4) }
    } else detail.rep = eRep > 0 ? 'the batch is empty: reputation has nothing to buy into it (a known 0)' : 'eRep 0 or unmeasured: reputation is not binding the batch (a known 0)'
  }
  return {
    weights: w,
    route: 'blade',
    windowH: +Math.min(installs ? W : T0, T0).toFixed(4),
    unit: 'black-op exit hours per unit ln of the multiplier',
    horizon: installs ? `the committed install, in ${W.toFixed(2)}h` : `the black-op exit, in ${T0.toFixed(2)}h (no install before it)`,
    detail,
    why: null,
  }
}

/**
 * A call out that may itself be sliced: a batchAt returning a generator (progress.js
 * re-plans through augplan.planPurchasesGen) runs inside this one's steps; a plain
 * value passes through.
 */
export function* callOut(x) {
  return x && typeof x.next === 'function' && typeof x[Symbol.iterator] === 'function' ? yield* x : x
}

/** extraIncome steps [{atH, perSec}] with `add` $/s on top of every step from now on. */
function addIncome(steps, add) {
  const st = Array.isArray(steps) ? steps.filter((x) => num(x?.atH) && num(x?.perSec)).sort((a, b) => a.atH - b.atH) : []
  const out = st.map((x) => ({ atH: x.atH, perSec: x.perSec + add }))
  if (!st.length || st[0].atH > 0) out.unshift({ atH: 0, perSec: add })
  return out
}
