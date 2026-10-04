// THE ECONOMY RATES OF THE HACKING ROUTE, FITTED: the player's hacking exp/s
// and the money $/s as functions of the node's PROGRESS LEVEL and its BitNode
// multipliers, fitted to the measured lives (history.jsonl), replacing the
// hacking exit's two constants (hackexit.defaultProfile: exp 1.3e9-2.2e9/s, BN10's
// end rate, applied from level 1 in every node x HackExpGain x speed; income
// $4e8/s at level 1 x the money factor — "NOT CALIBRATED").
//
// WHAT IS MEASURED (history.jsonl, the save digest every ~30s): per 10-minute
// window inside one life, the exp rate (d exp.hacking / dt; exp is in the digest
// from BN10 on) and, where the balance only rose in the window (no purchase),
// the income (d money / dt: every source — scripts, gang, hacknet, trader).
// THE PROGRESS LEVEL Lpk is the highest hacking level the node has reached so
// far: a fresh life after an install starts at level 1 on the fleet (home RAM,
// money) the node has already built — BN10's life 17 read 7.7e8 exp/s at level 5
// — so the rate is a function of how far the node has got, not of today's level.
//
// THE MODEL (each of exp and income; y = ln rate):
//   y_w = off_n + a_n + b ln(Lpk_w / LREF) + e_w        (window w of node run n)
//   off_n  the node's KNOWN scale (source): exp per op x HackExpGain
//          (Hacking.ts:30-38 calculateHackingExpGain), ops/s x HackingSpeed
//          (Hacking.ts:72-77 calculateHackingTime), x the player's hacking_exp
//          from the Source-Files held on entry; money per op x ScriptHackMoney x
//          ServerMaxMoney x ScriptHackMoneyGain (the money factor hackexit uses),
//          x HackingSpeed, x hacking_money
//   b      the within-node slope in ln Lpk, POOLED over the runs (node dummies)
//   a_n    the node's own level: a_n = alpha + gamma ln(max(MF_FLOOR, money factor))
//          + v_n, v_n ~ N(0, tau^2) — exp only: RAM is bought with money, so a
//          money-poor node runs a smaller fleet (BN8: 5e5/s, BN9: 2e5/s against
//          BN10's 2e9/s at the same progress); income's money factor is its offset.
//          Fitted with gmodel.fitBLR (beta integrated out, tau on a grid).
//   the FINAL WINDOW's rate of node n: exp(off_n + a_n + b ln(Lx_n / LREF)), Lx_n =
//          3000 x WorldDaemonDifficulty (the exit level): the rate the run climbs
//          the exit level on. hackexit holds it CONSTANT over the final window
//          (expScalesWithLevel false; income flat): the measured final lives are
//          flat (BN1's last life 1.2-1.3e8 exp/s from level 6185 to 7074; BN10's
//          1.08-1.09e9 from 5976 to 6351; BN1's income 1.04-1.21e12 $/s).
//
// A node's own data: a played (finished) run reads a_n from its own windows (sd from
// their scatter, autocorrelation-deflated, plus the slope's sd x the distance from
// its data to its exit level); the node IN PROGRESS reads the same quantity through
// observe.mjs into posterior.json (params xr<n> / ir<n>, the latest of the stream
// applied), so its own data prices its own clear and the node's later levels
// (BN14.1 now: BN14.2/14.3 share the reading). A node with a reading: the model's
// predictive for it fitted WITHOUT its reading x the reading (precision-weighted).
//
// CALIBRATION, printed every run (plan.mjs, tools/test/gameplan-rates.test.mjs):
// leave-one-out over the finished hacking-route runs — each run's measured final-
// window rate (the median window of its last LAST_H hours) against the model fitted
// without that run, z = (ln measured - ln predicted) / predictive sd. That is the
// stated error of the transfer to an unplayed node. In-sample the played nodes'
// rates are their own (and their g is backed out through them: economy.mjs).
// THE HOURS ARE LOGARITHMIC IN THE EXP RATE (the exit's level term is 32 ln(exp) -
// 200, skill.ts): a factor 5 in the rate moves an exit by ln((u + 51)/u)/g, ~0.5-1h;
// the income moves only the $100b join and the Red Pill donation legs.
//
// NOT MODELLED: the rate's dependence on the policy (a Bladeburner-route run's
// fleet; the gang's money is in the income), a node whose level never reached the
// exit (BN6, BN4.3: their a_n still enter — the slope and the node spread are
// what they inform), the exp from sleeves (flat, <= 16/s).

import fs from 'node:fs'
import path from 'node:path'
import { fitBLR, predictJoint, betaSummary } from './gmodel.mjs'

export const RATES_VERSION = 'rates-1'
export const LREF = 1000
export const MF_FLOOR = 1e-3
/** Windows below this progress level are the opening (no fleet yet): not fitted. */
export const MIN_LPK = 50
export const WINDOW_H = 1 / 6
/** The final window of a finished run, for the LOO check: its last LAST_H hours. */
export const LAST_H = 3
/** Runs from here on (economy.MEASURED_RUNS' first): older segments ran other scripts. */
export const RATES_SINCE = '2026-09-19T16:32'
const TAU_GRID = Array.from({ length: 200 }, (_, i) => 0.02 + i * 0.02) // 0.02 .. 4
const halfNormal = (s) => (t) => -0.5 * (t / s) ** 2

export const moneyFactorOf = (m) => m.ScriptHackMoney * m.ServerMaxMoney * m.ScriptHackMoneyGain
/** The node's exit level (ServerHelpers.ts:423: 3000 x WorldDaemonDifficulty). */
export const exitLevelOf = (m) => 3000 * m.WorldDaemonDifficulty
/** off_n for exp: ln(HackExpGain x HackingSpeed x hacking_exp). */
export const expOffset = (m, s, speed = m.HackingSpeedMultiplier) => Math.log(m.HackExpGain * speed * s.hacking_exp)
/** off_n for income: ln(money factor x HackingSpeed x hacking_money); -Infinity where scripts earn nothing (BN8). */
export const incomeOffset = (m, s, speed = m.HackingSpeedMultiplier) => (moneyFactorOf(m) > 0 ? Math.log(moneyFactorOf(m) * speed * s.hacking_money) : -Infinity)

/**
 * The windows of every node run in history.jsonl: per run { bn, start, end, hours, sfOnEntry,
 * windows: [{ h, age, lpk, level, exp: rate|null, income: rate|null }] }.
 */
export function readRuns(file) {
  const runs = []
  let cur = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof r.bitNode !== 'number' || typeof r.totalPlaytime !== 'number') continue
    if (!cur || cur.bn !== r.bitNode) {
      cur = { bn: r.bitNode, start: r.at, sfOnEntry: r.sourceFiles?.data ?? [], rows: [] }
      runs.push(cur)
    }
    cur.end = r.at
    cur.rows.push({ h: r.totalPlaytime / 3.6e6, age: (r.playtimeSinceLastAug ?? 0) / 3.6e6, level: r.skills?.hacking ?? 0, exp: typeof r.exp?.hacking === 'number' ? r.exp.hacking : null, money: r.money })
  }
  for (const run of runs) {
    const R = run.rows
    run.hours = R.length ? R[R.length - 1].h - R[0].h : 0
    run.windows = []
    let lpk = 1
    let i = 0
    while (i < R.length) {
      let k = i
      let mono = true
      // one window: <= WINDOW_H, inside one life (the age never falls back)
      while (k + 1 < R.length && R[k + 1].h - R[i].h < WINDOW_H && R[k + 1].age > R[k].age - 0.01) {
        if (!(R[k + 1].money >= R[k].money)) mono = false
        k++
      }
      for (let j = i; j <= k; j++) lpk = Math.max(lpk, R[j].level)
      const dt = (R[k].h - R[i].h) * 3600
      if (dt > 300) {
        const de = R[i].exp !== null && R[k].exp !== null ? R[k].exp - R[i].exp : null
        const dm = R[k].money - R[i].money
        run.windows.push({ h: R[i].h - R[0].h, age: R[i].age, lpk, level: R[i].level, exp: de !== null && de > 0 ? de / dt : null, income: mono && dm > 0 ? dm / dt : null })
      }
      i = k + 1
    }
    delete run.rows
  }
  return runs
}

const lsq = (X, y) => {
  const p = X[0].length
  const A = Array.from({ length: p }, () => new Float64Array(p + 1))
  for (let r = 0; r < X.length; r++)
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) A[i][j] += X[r][i] * X[r][j]
      A[i][p] += X[r][i] * y[r]
    }
  for (let i = 0; i < p; i++) {
    let m = i
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r
    ;[A[i], A[m]] = [A[m], A[i]]
    if (!(Math.abs(A[i][i]) > 1e-12)) throw new Error('rates: singular fit (a run with no windows?)')
    for (let r = 0; r < p; r++)
      if (r !== i) {
        const f = A[r][i] / A[i][i]
        for (let c = i; c <= p; c++) A[r][c] -= f * A[i][c]
      }
  }
  const c = A.map((row, i) => row[p] / row[i])
  const res = y.map((v, r) => v - X[r].reduce((s, x, i) => s + x * c[i], 0))
  return { c, res }
}
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * The pooled within-node slope and every run's own level (a_n, its sd), for one channel.
 * runs: [{ key, bn, m, s, windows }] (m = node mults, s = SF mults on entry).
 * Returns { b, sdB, s2 (window residual variance), per: Map key -> { a, sd, n, hours, meanX } }.
 */
export function fitChannel(runs, channel) {
  const off = (r) => (channel === 'exp' ? expOffset(r.m, r.s) : incomeOffset(r.m, r.s))
  const use = runs.filter((r) => isFinite(off(r))).map((r) => ({ r, w: r.windows.filter((w) => w[channel] > 0 && w.lpk >= MIN_LPK) })).filter((x) => x.w.length >= 3)
  if (use.length < 2) return null
  const X = []
  const y = []
  use.forEach((u, j) => {
    for (const w of u.w) {
      X.push([...use.map((_, k) => (k === j ? 1 : 0)), Math.log(w.lpk / LREF)])
      y.push(Math.log(w[channel]) - off(u.r))
    }
  })
  const { c, res } = lsq(X, y)
  const b = c[c.length - 1]
  const s2 = res.reduce((a, v) => a + v * v, 0) / Math.max(1, res.length - c.length)
  // the slope's sd: the within-node regression's, the windows deflated to one per WINDOW_EFF
  const xs = use.flatMap((u) => {
    const mx = u.w.reduce((a, w) => a + Math.log(w.lpk / LREF), 0) / u.w.length
    return u.w.map((w) => Math.log(w.lpk / LREF) - mx)
  })
  const sxx = xs.reduce((a, v) => a + v * v, 0)
  const per = new Map()
  use.forEach((u, j) => {
    const hours = new Set(u.w.map((w) => Math.floor(w.h))).size
    const meanX = u.w.reduce((a, w) => a + Math.log(w.lpk / LREF), 0) / u.w.length
    per.set(u.r.key, { a: c[j], n: u.w.length, hours, meanX, sdWin: Math.sqrt(s2) })
  })
  // autocorrelation: windows inside one hour are not independent — the effective count is the hours covered
  const nEff = use.reduce((a, u) => a + new Set(u.w.map((w) => Math.floor(w.h))).size, 0)
  const sdB = Math.sqrt(s2 / Math.max(1e-9, sxx) * (X.length / Math.max(1, nEff)))
  for (const v of per.values()) v.sd = Math.sqrt(s2 / Math.max(1, v.hours))
  return { b, sdB, s2, per, runs: use.length }
}

/** A run's reading of a_n AT its exit level: its own a, its sd plus the slope's over the extrapolation. */
export const readingAtExit = (p, b, sdB, lnLx) => ({ y: p.a, sd: Math.sqrt(p.sd ** 2 + (sdB * (lnLx - p.meanX)) ** 2) })

/** The design row of the node-level regression: exp [1, ln mf]; income [1]. */
const rowOf = (channel, m) => (channel === 'exp' ? [1, Math.log(Math.max(MF_FLOOR, moneyFactorOf(m)))] : [1])

/**
 * The node-level regression of a_n (fitBLR, tau on a grid) over the given readings
 * [{ bn, y, sd }] and its predictive for node n: { mean, sd } of a_n.
 */
export function nodeLevelFit(channel, readings, multsOf) {
  const data = readings.map((d) => ({ x: rowOf(channel, multsOf(d.bn)), y: d.y, sd: d.sd }))
  const my = data.reduce((a, d) => a + d.y, 0) / Math.max(1, data.length)
  const fit = fitBLR(data, { p: rowOf(channel, multsOf(1)).length, b0: { mean: my, sd: 10 }, sb: 1, tauPrior: halfNormal(2), grid: TAU_GRID })
  return { fit, beta: betaSummary(fit), predict: (n) => {
    const pj = predictJoint(fit, [rowOf(channel, multsOf(n))])
    return { mean: pj.mean[0], sd: pj.sd[0] }
  } }
}

/** Precision-weighted product of a predictive {mean, sd} and readings [{y, sd}]. */
const combine = (pr, rs) => {
  let prec = 1 / pr.sd ** 2
  let num = pr.mean * prec
  for (const r of rs) {
    prec += 1 / r.sd ** 2
    num += r.y / r.sd ** 2
  }
  return { mean: num / prec, sd: Math.sqrt(1 / prec) }
}

/**
 * THE FIT. runs = readRuns(...) (all of history), with multsOf(n) and sfMultsOf(sfPairs).
 * finished: the run keys (start times) whose windows fit the model — every run from
 * RATES_SINCE of >= 2h but the last (in progress). inRun: readings of the node in
 * progress from posterior.json ({ param: 'xr14'|'ir14', value (= exp(a)), sd (log) }).
 * Returns { version, LREF, channels: { exp | income: { b, sdB, sdWin, runs, readings, beta (the
 * node-level regression), nodes: { n: { mean, sd, prior, readings } } (a_n), loo } } }.
 */
export function fitRates({ runs, multsOf, sfMultsOf, inRun = [], liveKey = null }) {
  const live = liveKey ?? runs[runs.length - 1]?.start
  const fin = runs.filter((r) => r.start >= RATES_SINCE && r.start !== live && r.hours >= 2).map((r) => ({ ...r, key: r.start, m: multsOf(r.bn), s: sfMultsOf(r.sfOnEntry) }))
  const out = { version: RATES_VERSION, LREF, channels: {} }
  for (const ch of ['exp', 'income']) {
    const f = fitChannel(fin, ch)
    if (!f) throw new Error(`rates: fewer than 2 runs with ${ch} windows since ${RATES_SINCE} — history.jsonl too short`)
    const lnLx = (bn) => Math.log(exitLevelOf(multsOf(bn)) / LREF)
    // the finished runs' readings at their own exit level (several runs of one node: each a reading)
    const readings = fin.filter((r) => f.per.has(r.key)).map((r) => ({ bn: r.bn, key: r.key, ...readingAtExit(f.per.get(r.key), f.b, f.sdB, lnLx(r.bn)) }))
    // the node in progress, through the posterior log (observe.mjs): its own reading
    const pIn = ch === 'exp' ? 'xr' : 'ir'
    const own = inRun.filter((o) => new RegExp(`^${pIn}\\d+$`).test(o.param)).map((o) => ({ bn: Number(o.param.slice(2)), y: Math.log(o.value), sd: o.sd, key: o.key, inRun: true }))
    const all = [...readings, ...own]
    const nodes = {}
    for (let n = 1; n <= 14; n++) {
      const mine = all.filter((d) => d.bn === n)
      // the population is the FINISHED runs: an in-run reading prices its own node only (a partial
      // node, mostly its opening; and a new reading then rebuilds that node's curves alone)
      const nl = nodeLevelFit(ch, readings.filter((d) => d.bn !== n), multsOf)
      const pr = nl.predict(n)
      const post = mine.length ? combine(pr, mine) : pr
      nodes[n] = { mean: post.mean, sd: post.sd, prior: pr, readings: mine.map((d) => ({ y: d.y, sd: d.sd, inRun: !!d.inRun })) }
    }
    // LEAVE-ONE-OUT: each finished hacking-route run's measured final-window rate vs the
    // model without that run (its node's other runs and the in-run reading also held out)
    const loo = []
    for (const r of fin) {
      if (!f.per.has(r.key)) continue
      const tail = r.windows.filter((w) => w[ch] > 0 && w.h >= r.hours - LAST_H)
      if (tail.length < 3) continue
      const meas = Math.log(median(tail.map((w) => w[ch])))
      const lpk = tail[tail.length - 1].lpk
      const rest = fin.filter((x) => x.key !== r.key)
      const fr = fitChannel(rest, ch)
      if (!fr) continue
      const rd = rest.filter((x) => fr.per.has(x.key) && x.bn !== r.bn).map((x) => ({ bn: x.bn, ...readingAtExit(fr.per.get(x.key), fr.b, fr.sdB, lnLx(x.bn)) }))
      const pr = nodeLevelFit(ch, rd, multsOf).predict(r.bn)
      const off = ch === 'exp' ? expOffset(r.m, r.s) : incomeOffset(r.m, r.s)
      // the prediction AT the run's own final progress level (the measured tail's), so the
      // check tests the transfer of a_n and b, not the exit-level convention
      const x = Math.log(lpk / LREF)
      const pred = off + pr.mean + fr.b * x
      const sd = Math.sqrt(pr.sd ** 2 + (fr.sdB * x) ** 2 + f.s2 / Math.max(1, tail.length))
      loo.push({ bn: r.bn, key: r.key, lpk, measured: Math.exp(meas), predicted: Math.exp(pred), z: (meas - pred) / sd, sd, err: meas - pred })
    }
    const nl = nodeLevelFit(ch, readings, multsOf)
    out.channels[ch] = { b: f.b, sdB: f.sdB, sdWin: Math.sqrt(f.s2), runs: f.runs, readings: all.map(({ bn, y, sd, inRun: ir }) => ({ bn, y, sd, inRun: !!ir })), beta: nl.beta, nodes, loo }
  }
  return out
}

/**
 * The profile slice hackexit reads (profile.rates): the slopes and every node's point
 * a_n (posterior mean) — { version, LREF, b, bI, nodes: { n: { xa, ia } } }.
 */
export function profileRates(fit) {
  const nodes = {}
  for (let n = 1; n <= 14; n++) nodes[n] = { xa: +fit.channels.exp.nodes[n].mean.toPrecision(8), ia: +fit.channels.income.nodes[n].mean.toPrecision(8) }
  return { version: fit.version, LREF: fit.LREF, b: +fit.channels.exp.b.toPrecision(8), bI: +fit.channels.income.b.toPrecision(8), nodes }
}

/**
 * The in-progress node's readings for observe.mjs: a_n of each channel from the run's
 * own windows, at the pooled slope of the finished runs (fit), with the slope's sd
 * over the distance from its data to its exit level. [] when the run has < 3 windows.
 */
export function inRunReadings(run, fit, multsOf, sfMultsOf) {
  const m = multsOf(run.bn)
  const s = sfMultsOf(run.sfOnEntry)
  const lnLx = Math.log(exitLevelOf(m) / LREF)
  const out = []
  for (const [ch, p] of [['exp', 'xr'], ['income', 'ir']]) {
    const off = ch === 'exp' ? expOffset(m, s) : incomeOffset(m, s)
    if (!isFinite(off)) continue
    const c = fit.channels[ch]
    const w = run.windows.filter((x) => x[ch] > 0 && x.lpk >= MIN_LPK)
    if (w.length < 3) continue
    const ys = w.map((x) => Math.log(x[ch]) - off - c.b * Math.log(x.lpk / LREF))
    const a = ys.reduce((q, v) => q + v, 0) / ys.length
    const hours = new Set(w.map((x) => Math.floor(x.h))).size
    const meanX = w.reduce((q, x) => q + Math.log(x.lpk / LREF), 0) / w.length
    const r = readingAtExit({ a, sd: c.sdWin / Math.sqrt(Math.max(1, hours)), meanX }, c.b, c.sdB, lnLx)
    out.push({ param: `${p}${run.bn}`, value: Math.exp(r.y), sd: +r.sd.toFixed(4), space: 'log', at: run.end, node: run.bn, stream: `${p}${run.bn}|history.jsonl|${run.start}`, source: `history.jsonl: BN${run.bn} in progress since ${run.start}, ${w.length} windows to level ${w[w.length - 1].lpk} (${ch} a_n at the pooled slope ${c.b.toFixed(2)})`, key: `${p}${run.bn}|${run.start}|${run.end}` })
  }
  return out
}

/**
 * THE FINAL WINDOW'S RATES from a fitted rates profile (gameplan/rates.mjs; source of the
 * offsets: Hacking.ts:30-38 exp per op x HackExpGain, Hacking.ts:72-77 op time / HackingSpeed,
 * the money factor per op): rate = exp(offset + a_n + b ln(Lx / LREF)), Lx = 3000 x
 * WorldDaemonDifficulty (ServerHelpers.ts:423). `rates` is the whole profile.rates
 * ({LREF, b, bI, nodes: {n: {xa, ia}}}) or one node's slice ({LREF, b, bI, xa, ia}).
 * A node whose scripts earn nothing (ScriptHackMoneyGain 0, BN8) has income 0 (the trader
 * is its capital). Returns { expPerSec, incomePerSec, Lx }.
 */
export function finalRatesOf({ m, s, speed = m.HackingSpeedMultiplier, rates, node }) {
  const r = rates.nodes ? rates.nodes[node] : rates
  if (!r || !(typeof r.xa === 'number') || !(typeof r.ia === 'number')) throw new Error(`rates: profile.rates has no fitted node level for BN${node} (gameplan/rates.mjs profileRates)`)
  const Lx = 3000 * m.WorldDaemonDifficulty
  const x = Math.log(Lx / rates.LREF)
  const mf = m.ScriptHackMoney * m.ServerMaxMoney * m.ScriptHackMoneyGain
  const expPerSec = Math.exp(Math.log(m.HackExpGain * speed * s.hacking_exp) + r.xa + rates.b * x)
  const incomePerSec = mf > 0 ? Math.exp(Math.log(mf * speed * s.hacking_money) + r.ia + rates.bI * x) : 0
  return { expPerSec, incomePerSec, Lx }
}

/** The part of a profile one node's simulation reads (the surrogate's cache key): the rates sliced to the node. */
export function profileFor(profile, node) {
  if (!profile?.rates?.nodes) return profile
  const { nodes, ...rest } = profile.rates
  return { ...profile, rates: { ...rest, ...nodes[node] } }
}

/** The default history file. */
export const historyFile = (telemetry) => path.join(telemetry, 'history.jsonl')
