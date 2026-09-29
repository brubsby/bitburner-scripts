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
  return {
    weights,
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

/** extraIncome steps [{atH, perSec}] with `add` $/s on top of every step from now on. */
function addIncome(steps, add) {
  const st = Array.isArray(steps) ? steps.filter((x) => num(x?.atH) && num(x?.perSec)).sort((a, b) => a.atH - b.atH) : []
  const out = st.map((x) => ({ atH: x.atH, perSec: x.perSec + add }))
  if (!st.length || st[0].atH > 0) out.unshift({ atH: 0, perSec: add })
  return out
}
