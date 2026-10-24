// THE TRADER'S RETURN AS A FUNCTION OF MARKET AGE AND BOOK — r(W, a), fitted on
// every market-life the live game has recorded.
//
//   node tools/sim/stocks/rwage.mjs                  fit + the per-market table (reads .telemetry)
//   node tools/sim/stocks/rwage.mjs --write-fixture  also freeze the bins into tools/test/fixture-rwage-bins.json
//   node tools/sim/stocks/rwage.mjs --fixture        fit the frozen fixture instead of the telemetry
//
// WHY (docs/postponed-after-reset.md item 9, 17b; 49c98e2): traderw.js RW_PRIOR is
// the shipped strategy's r(W) on FRESH 5-hour simulated markets. Its knee W* (where
// the book outgrows what the market can absorb) is a fresh market's. The live
// ledger says the knee moves with the market's age: at $1e12-1e13 a 8-16h-old
// pre-4S market paid 0.33/h where the fresh curve says 0.07/h, and 4S books of
// $1e13-1e14 past 16h paid 0.32/h against 0.05/h (capacity.mjs found the sim -62%
// per bin / -85% in dollars on books >= $1e12). Every install re-initialises the
// market (Prestige.ts:166-170 initStockMarket), so in BitNode 8 — where the trader
// is the only income — every life restarts on the young knee. A curve with no age
// prices a BN8 life's late book far too low and its early book right.
//
// THE MODEL (traderw.js rwAgeRate; ramp and gate kept from RW_PRIOR's shape):
//   r(W, a) = r0 x ramp(W) x sat(W / W*(a))
//   W*(a)   = W1 x max(a, aMin)^beta            a = hours since the market's last
//                                               initialisation (playtimeSinceLastAug)
// fitted per regime (pre-long / 4S-long) by weighted least squares on the ledger's
// bins (hours of trading as the weight). A no-age fit (beta = 0) and the shipped
// RW_PRIOR are printed beside it, with leave-one-node-out errors, so the age term
// has to earn its place out of sample.
//
// THE DATA: /tel/stock-rw.txt (bayes.rwLedgerOf: per run, per 0.1-decade book bin,
// the precision-weighted log return per hour) — a run's start age is read from
// history.jsonl at its firstAt; a bin's age is the start + the hours of the run's
// smaller-book bins + half its own (the book grows within a run: the order of the
// bins by book is their order in time, APPROXIMATE where a run's book falls back).
// BitNode 8.1 (2026-09-25..27) predates the ledger: its 6h of minute rows
// (tools/test/fixture-bn8-stockhist.txt, 2026-09-26 04:11-10:15Z, two lives) are
// binned by the same bayes.rwLedgerOf, aged by history.jsonl, and printed as
// their own group (BN8's trader can short: StockMarket.ts allows it in BN8) — and
// the BN8.1 trader's realised fits recorded in tools/test/fixture-bn8-*.json are
// printed against the model at their own books and ages.
//
// CALIBRATION, printed every run: per market (ledger run), the measured money
// earned over its bins against each model's, the hours-weighted geometric error,
// and the summary per regime. A regression test (tools/test/rwage.test.mjs) holds
// the committed constants to the frozen fixture.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { RW_PRIOR, RW_AGE, rwShape, rwAgeRate } from '../../../traderw.js'
import { rwLedgerOf } from '../../../bayes.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../../..')
export const FIXTURE = path.join(ROOT, 'tools/test/fixture-rwage-bins.json')
const has = (k) => process.argv.includes(`--${k}`)

/** The telemetry directory (the worktree's own, else the main checkout's). */
export function telemetryDir() {
  const c = [process.env.TELEMETRY, path.join(ROOT, '.telemetry'), '/home/tbusby/Repos/bitburner-scripts/.telemetry'].filter(Boolean)
  return c.find((d) => fs.existsSync(path.join(d, 'stock-rw.txt'))) ?? null
}

/** history.jsonl at each wanted ISO time: { bn, ageH } (one pass; times sorted). */
export async function ageAtOf(histPath, times) {
  const want = [...new Set(times)].sort()
  const out = new Map()
  if (!want.length || !fs.existsSync(histPath)) return out
  const rl = readline.createInterface({ input: fs.createReadStream(histPath) })
  let i = 0
  for await (const line of rl) {
    if (i >= want.length) break
    const at = line.slice(7, 31)
    if (at < want[i]) continue
    const j = JSON.parse(line)
    while (i < want.length && want[i] <= at) out.set(want[i++], { bn: j.bitNode, ageH: j.playtimeSinceLastAug / 3.6e6 })
  }
  rl.close()
  return out
}

/** A ledger run's bins in time order with their market age. */
function runBins(r, startAgeH, skipH) {
  const bins = Object.values(r.bins)
    .filter((c) => c[0] > 0 && c[5] > 0)
    .map((c) => ({ W: 10 ** (c[3] / c[0]), x: c[1] / c[0], h: c[5], n: c[4] }))
    .sort((a, b) => a.W - b.W)
  // The ledger skips the first skipH of a run that starts with its life (the warm-up).
  let cum = startAgeH < skipH ? skipH : startAgeH
  return bins.map((b) => {
    const age = cum + b.h / 2
    cum += b.h
    return { ...b, age }
  })
}

/** Every bin: the ledger's runs + BN8.1's minute rows. [{ run, bn, reg, group, age, W, x, h }]. */
export async function marketBinsOf(tel) {
  const led = JSON.parse(fs.readFileSync(path.join(tel, 'stock-rw.txt'), 'utf8'))
  const bn8File = path.join(ROOT, 'tools/test/fixture-bn8-stockhist.txt')
  const bn8Rows = fs.existsSync(bn8File) ? fs.readFileSync(bn8File, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const ages = await ageAtOf(path.join(tel, 'history.jsonl'), [...led.runs.map((r) => r.firstAt).filter(Boolean), ...bn8Rows.map((r) => r.at)])
  const rows = []
  for (const r of led.runs) {
    const a0 = ages.get(r.firstAt)
    if (!a0) continue
    const skip = RW_PRIOR[r.regime]?.skipH ?? 1
    for (const b of runBins(r, a0.ageH, skip)) rows.push({ run: r.id, bn: r.node ?? a0.bn, reg: r.regime, group: r.regime, ...b })
  }
  // BN8.1: the same ledger fold on its minute rows, each run aged by history.jsonl
  // (no s4 flag in those rows: pre-4S, the books never reached the $26b 4S price).
  if (bn8Rows.length) {
    const led8 = rwLedgerOf(null, bn8Rows, { priors: RW_PRIOR, warmupH: 0, node: 8 })
    for (const r of led8.runs) {
      const a0 = ages.get(r.firstAt)
      if (!a0) continue
      for (const b of runBins(r, a0.ageH, RW_PRIOR['pre-long'].skipH)) rows.push({ run: `8.1-${r.id}`, bn: 8, reg: 'pre-long', group: 'bn8', ...b })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// THE FIT
// ---------------------------------------------------------------------------
function nelderMead(f, x0, step, iters = 1200) {
  const n = x0.length
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map((x) => ({ x, f: f(x) }))
  for (let it = 0; it < iters; it++) {
    S.sort((a, b) => a.f - b.f)
    const c = Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i].x[j] / n
    const w = S[n]
    const at = (t) => c.map((v, j) => v + t * (w.x[j] - v))
    const r = at(-1)
    const fr = f(r)
    if (fr < S[0].f) {
      const e = at(-2)
      const fe = f(e)
      S[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr }
    } else if (fr < S[n - 1].f) S[n] = { x: r, f: fr }
    else {
      const k = at(0.5)
      const fk = f(k)
      if (fk < w.f) S[n] = { x: k, f: fk }
      else S = S.map((s, i) => (i === 0 ? s : ((x) => ({ x, f: f(x) }))(s.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j])))))
    }
  }
  S.sort((a, b) => a.f - b.f)
  return S[0]
}

/** The model's params object from the fit vector. */
const paramsOf = (reg, v, ageOn) => ({ r0PerHour: Math.exp(v[0]), W1: Math.exp(v[1]), beta: ageOn === true ? v[2] : typeof ageOn === 'number' ? ageOn : 0, aMin: RW_AGE[reg]?.aMin ?? 0.5, n: RW_PRIOR[reg].shape.n })

/** Model rate per hour at a bin for params p (the curve traderw.rwAgeRate evaluates). */
export const modelRate = (reg, p, W, age) => rwAgeRate(W, age, reg, p)

/**
 * THE OBJECTIVE: the mean rate (least squares on the bins' measured rates, unbiased for the
 * mean) with RELATIVE weights, h / (r_prev + R_FLOOR)^2, the model's rate frozen from the
 * previous pass (iteratively reweighted least squares). A money leg's hours are the integral of
 * d ln W / r, so a rate error matters in proportion to the rate: 0.05/h is nothing on the
 * 0.9/h plateau and most of a saturated book's 0.1/h. Tried first (2026-10-23, the numbers in
 * the commit): plain hours-weighted LS (r0 0.95, W1 3.1e10, beta 1.61 — the saturated region
 * under-weighted); (x - r)/(r + f) with r live in the denominator (biased UP: r0 1.36/h, a
 * larger r shrinks every residual); the log ratio (biased DOWN by Jensen on noisy bins: r0
 * 0.76/h against a 0.9/h plateau). Reweighting with the rate frozen keeps the estimator
 * unbiased and the weights relative. R_FLOOR keeps a bin whose model rate is ~0 (far past the
 * knee) from dominating on noise.
 */
export const R_FLOOR = 0.05
/** Books the fit uses: BitNode 8's money legs run from $250m to ~$1e13 (the Red Pill's donation); far-past-capacity cash piles (BN10.3's $1e15-1e17) are printed, not fitted. */
export const FIT_WMAX = 3e13
function sse(reg, p, rows, wts) {
  let s = 0
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i]
    const d = b.x - modelRate(reg, p, b.W, b.age)
    s += wts[i] * d * d
  }
  return s
}

/** Fit one regime on rows: { p, sse }. ageOn false: beta = 0 (the no-age curve, W1 its knee); a number: beta fixed at it (shared with another regime). */
export function fitRegime(reg, rows0, { ageOn = true, passes = 4 } = {}) {
  const rows = rows0.filter((b) => b.W <= FIT_WMAX)
  const pr = RW_PRIOR[reg]
  let x = ageOn === true ? [Math.log(pr.r0PerHour), Math.log(pr.Wstar), 0.5] : [Math.log(pr.r0PerHour), Math.log(pr.Wstar) - (typeof ageOn === 'number' ? 2 : 0)]
  const step = ageOn === true ? [0.2, 1, 0.3] : [0.2, 1]
  let best = null
  for (let k = 0; k < passes; k++) {
    const p0 = paramsOf(reg, x, ageOn)
    const wts = rows.map((b) => b.h / (Math.max(0, modelRate(reg, p0, b.W, b.age)) + R_FLOOR) ** 2)
    const f = (v) => sse(reg, paramsOf(reg, v, ageOn), rows, wts) + (ageOn === true && (v[2] < -1 || v[2] > 4) ? 1e12 : 0)
    best = nelderMead(f, x, k === 0 ? step : step.map((s) => s / 3))
    x = best.x
  }
  return { p: paramsOf(reg, x, ageOn), sse: best.f }
}

// ---------------------------------------------------------------------------
// THE REPORT
// ---------------------------------------------------------------------------
const fmt = (x) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-2 && x !== 0) ? x.toExponential(2) : x.toFixed(2))
const priorRate = (reg, W) => RW_PRIOR[reg].r0PerHour * rwShape(W, RW_PRIOR[reg].Wstar, RW_PRIOR[reg].shape)

/** Per market: measured $ earned vs each model's, over the market's bins. */
export function perMarket(rows, models) {
  const byRun = new Map()
  for (const b of rows) {
    if (!byRun.has(b.run)) byRun.set(b.run, [])
    byRun.get(b.run).push(b)
  }
  const out = []
  for (const [run, bs] of byRun) {
    const h = bs.reduce((a, b) => a + b.h, 0)
    const meas = bs.reduce((a, b) => a + b.x * b.W * b.h, 0)
    const rMeas = bs.reduce((a, b) => a + b.x * b.h, 0) / h
    const m = {}
    for (const [k, fn] of Object.entries(models)) {
      m[k] = { earned: bs.reduce((a, b) => a + fn(b) * b.W * b.h, 0), rate: bs.reduce((a, b) => a + fn(b) * b.h, 0) / h }
    }
    out.push({ run, bn: bs[0].bn, reg: bs[0].reg, group: bs[0].group, age0: Math.min(...bs.map((b) => b.age - b.h / 2)), age1: Math.max(...bs.map((b) => b.age + b.h / 2)), W0: Math.min(...bs.map((b) => b.W)), W1: Math.max(...bs.map((b) => b.W)), h, meas, rMeas, m })
  }
  return out
}

/** Summary errors of a model over markets: $ error over all bins, hours-weighted rate error, |dlnE| per market. */
export function summary(markets, k) {
  const meas = markets.reduce((a, x) => a + x.meas, 0)
  const mod = markets.reduce((a, x) => a + x.m[k].earned, 0)
  const H = markets.reduce((a, x) => a + x.h, 0)
  const rateErr = markets.reduce((a, x) => a + x.h * (x.m[k].rate - x.rMeas), 0) / H
  const rateAbs = markets.reduce((a, x) => a + x.h * Math.abs(x.m[k].rate - x.rMeas), 0) / H
  return { meas, mod, dollarErr: mod / meas - 1, rateErr, rateAbs, H }
}

/** Leave-one-node-out: each node's markets predicted by the fit on the others. */
export function lono(rows, reg, { ageOn, shareFrom = null }) {
  const nodes = [...new Set(rows.filter((b) => b.reg === reg && b.group !== 'bn8').map((b) => b.bn))]
  const pred = new Map()
  for (const n of nodes) {
    const train = rows.filter((b) => b.reg === reg && b.group !== 'bn8' && b.bn !== n)
    // shareFrom: beta from that regime's fit WITHOUT this node either
    const beta = shareFrom ? fitRegime(shareFrom, rows.filter((b) => b.reg === shareFrom && b.group !== 'bn8' && b.bn !== n), { ageOn: true }).p.beta : null
    const { p } = fitRegime(reg, train, { ageOn: beta ?? ageOn })
    for (const b of rows.filter((b) => b.reg === reg && b.group !== 'bn8' && b.bn === n)) pred.set(b, modelRate(reg, p, b.W, b.age))
  }
  return pred
}

async function main() {
  let rows
  if (has('fixture')) rows = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).rows
  else {
    const tel = telemetryDir()
    if (!tel) throw new Error('rwage: no .telemetry/stock-rw.txt (run with --fixture)')
    rows = await marketBinsOf(tel)
    if (has('write-fixture')) {
      fs.writeFileSync(FIXTURE, JSON.stringify({ note: `tools/sim/stocks/rwage.mjs --write-fixture ${new Date().toISOString()}: the ledger's bins with market age (+ BN8.1 from fixture-bn8-stockhist.txt)`, rows: rows.map((b) => ({ ...b, W: +b.W.toPrecision(6), x: +b.x.toPrecision(6), h: +b.h.toFixed(4), age: +b.age.toFixed(4) })) }))
      console.log(`wrote ${FIXTURE} (${rows.length} bins)`)
    }
  }
  console.log(`THE TRADER'S RETURN r(W, age) — ${rows.length} bins, ${new Set(rows.map((b) => b.run)).size} market-lives (${rows.filter((b) => b.group === 'bn8').length} bins BN8.1)`)
  const fits = {}
  for (const reg of ['pre-long', '4S-long']) {
    const train = rows.filter((b) => b.reg === reg && b.group !== 'bn8')
    const age = fitRegime(reg, train, { ageOn: true })
    const flat = fitRegime(reg, train, { ageOn: false })
    // 4S: the age exponent shared with pre-4S (the same market's capacity grows; 14 4S market-lives over 5 nodes)
    const shared = reg === '4S-long' && fits['pre-long'] ? fitRegime(reg, train, { ageOn: fits['pre-long'].age.p.beta }) : null
    fits[reg] = { age, flat, shared }
    const c = RW_AGE[reg]
    console.log(`\n${reg}: ${train.length} bins, ${train.reduce((a, b) => a + b.h, 0).toFixed(1)}h of trading`)
    console.log(`  FIT (age)    r0 ${age.p.r0PerHour.toFixed(3)}/h  W1 ${age.p.W1.toExponential(3)}  beta ${age.p.beta.toFixed(3)}  (aMin ${age.p.aMin}h, n ${age.p.n})  wSSE ${age.sse.toFixed(2)}`)
    if (shared) console.log(`  FIT (shared) r0 ${shared.p.r0PerHour.toFixed(3)}/h  W1 ${shared.p.W1.toExponential(3)}  beta ${shared.p.beta.toFixed(3)} (pre-4S's)  wSSE ${shared.sse.toFixed(2)}`)
    console.log(`  FIT (no age) r0 ${flat.p.r0PerHour.toFixed(3)}/h  W* ${flat.p.W1.toExponential(3)}                wSSE ${flat.sse.toFixed(2)}`)
    console.log(`  COMMITTED    r0 ${c.r0PerHour.toFixed(3)}/h  W1 ${c.W1.toExponential(3)}  beta ${c.beta.toFixed(3)}  (traderw.js RW_AGE)   the knee at 1/4/12/24/48h: ${[1, 4, 12, 24, 48].map((a) => (c.W1 * Math.max(a, c.aMin) ** c.beta).toExponential(1)).join(' / ')}`)
    console.log(`  RW_PRIOR     r0 ${RW_PRIOR[reg].r0PerHour.toFixed(3)}/h  W* ${RW_PRIOR[reg].Wstar.toExponential(3)} (fresh 5h sim markets, no age)`)
    const noLono = has('no-lono')
    const pLono = noLono ? new Map() : lono(rows, reg, { ageOn: true })
    const pLonoF = noLono ? new Map() : lono(rows, reg, { ageOn: false })
    const pLonoS = noLono || !shared ? new Map() : lono(rows, reg, { ageOn: true, shareFrom: 'pre-long' })
    const models = {
      committed: (b) => rwAgeRate(b.W, b.age, reg),
      fitAge: (b) => modelRate(reg, age.p, b.W, b.age),
      noAge: (b) => modelRate(reg, flat.p, b.W, b.age),
      prior: (b) => priorRate(reg, b.W),
      lonoAge: (b) => pLono.get(b) ?? NaN,
      lonoNoAge: (b) => pLonoF.get(b) ?? NaN,
      ...(shared ? { fitShared: (b) => modelRate(reg, shared.p, b.W, b.age), lonoShared: (b) => pLonoS.get(b) ?? NaN } : {}),
    }
    const mk = perMarket(train, models)
    console.log(`  per market (ledger run): age span, book span, hours; the money it earned over its bins, measured vs each model ($), and the hours-weighted rate (/h)`)
    console.log(`   run  BN  age h       book                h    measured $  committed $ (err)    no-age $ (err)     RW_PRIOR $ (err)  | rate meas  comm   LOO-age  LOO-noage`)
    const e = (a, b) => (b > 0 ? `${((a / b - 1) * 100).toFixed(0).padStart(5)}%` : '    - ')
    for (const x of mk.sort((a, b) => (a.run > b.run ? 1 : -1))) {
      console.log(`  ${String(x.run).padStart(4)} ${String(x.bn).padStart(3)} ${x.age0.toFixed(1).padStart(5)}-${x.age1.toFixed(1).padEnd(5)} ${x.W0.toExponential(1)}-${x.W1.toExponential(1)} ${x.h.toFixed(2).padStart(6)}  ${fmt(x.meas).padStart(9)}  ${fmt(x.m.committed.earned).padStart(9)} ${e(x.m.committed.earned, x.meas)}  ${fmt(x.m.noAge.earned).padStart(9)} ${e(x.m.noAge.earned, x.meas)}  ${fmt(x.m.prior.earned).padStart(9)} ${e(x.m.prior.earned, x.meas)} | ${x.rMeas.toFixed(2).padStart(6)} ${x.m.committed.rate.toFixed(2).padStart(6)} ${x.m.lonoAge.rate.toFixed(2).padStart(7)} ${x.m.lonoNoAge.rate.toFixed(2).padStart(7)}`)
    }
    for (const [k, lbl] of [['committed', 'committed (age)'], ['fitAge', 'fit (age)'], ['noAge', 'fit (no age)'], ['prior', 'RW_PRIOR'], ['lonoAge', 'LOO by node (age)'], ['lonoNoAge', 'LOO by node (no age)']]) {
      const s = summary(mk, k)
      console.log(`  ${lbl.padEnd(22)} money over all bins ${fmt(s.mod)} vs measured ${fmt(s.meas)} (${(100 * s.dollarErr).toFixed(0)}%); hours-weighted rate error ${s.rateErr >= 0 ? '+' : ''}${s.rateErr.toFixed(3)}/h, mean |error| ${s.rateAbs.toFixed(3)}/h`)
    }
    // the fitted range alone (BN8's books)
    const inR = perMarket(train.filter((b) => b.W <= FIT_WMAX), models)
    for (const k of ['committed', 'fitAge', 'noAge', 'prior', ...(shared ? ['fitShared'] : []), ...(noLono ? [] : ['lonoAge', 'lonoNoAge', ...(shared ? ['lonoShared'] : [])])]) {
      const s = summary(inR, k)
      console.log(`  books <= $${FIT_WMAX.toExponential(0)} (the fitted range): ${k.padEnd(9)} ${(100 * s.dollarErr).toFixed(0)}% in dollars, mean |rate error| ${s.rateAbs.toFixed(3)}/h`)
    }
    // THE GRID: measured vs committed by market age x book (hours-weighted rate /h, hours)
    console.log('  by market age (rows) x log10 book (cols): measured / committed rate per hour (hours)')
    const ageB = [0, 2, 4, 8, 16, 1000]
    const wB = [6, 8, 9, 10, 11, 12, 13, 14, 18]
    console.log('  age\\W ' + wB.slice(0, -1).map((w, i) => `${w}-${wB[i + 1]}`.padStart(19)).join(''))
    for (let a = 0; a < ageB.length - 1; a++) {
      let line = `  ${ageB[a]}-${ageB[a + 1] > 100 ? '' : ageB[a + 1]}`.padEnd(8)
      for (let k = 0; k < wB.length - 1; k++) {
        const sel = train.filter((b) => b.age >= ageB[a] && b.age < ageB[a + 1] && Math.log10(b.W) >= wB[k] && Math.log10(b.W) < wB[k + 1])
        const H = sel.reduce((s, b) => s + b.h, 0)
        if (!H) {
          line += ''.padStart(19)
          continue
        }
        const x = sel.reduce((s, b) => s + b.x * b.h, 0) / H
        const m = sel.reduce((s, b) => s + rwAgeRate(b.W, b.age, reg) * b.h, 0) / H
        line += `${x.toFixed(2)}/${m.toFixed(2)}(${H.toFixed(1)})`.padStart(19)
      }
      console.log(line)
    }
    // big, old books: the claim the age model exists for
    const big = mk.filter((x) => x.W1 >= 1e12)
    if (big.length) {
      for (const k of ['committed', 'noAge', 'prior']) {
        const s = summary(big, k)
        console.log(`  books reaching >= $1e12 (${big.length} markets): ${k.padEnd(9)} ${(100 * s.dollarErr).toFixed(0)}% in dollars`)
      }
    }
  }
  // BN8.1
  const b8 = rows.filter((b) => b.group === 'bn8')
  if (b8.length) {
    console.log(`\nBN8.1 (2026-09-26, pre-ledger minute rows, long+short allowed): ${b8.length} bins, ${b8.reduce((a, b) => a + b.h, 0).toFixed(2)}h`)
    const mk = perMarket(b8, { committed: (b) => rwAgeRate(b.W, b.age, 'pre-long'), prior: (b) => priorRate('pre-long', b.W) })
    for (const x of mk) console.log(`  ${x.run}  age ${x.age0.toFixed(1)}-${x.age1.toFixed(1)}h  book ${x.W0.toExponential(1)}-${x.W1.toExponential(1)}  ${x.h.toFixed(2)}h  rate measured ${x.rMeas.toFixed(3)}/h, committed ${x.m.committed.rate.toFixed(3)}/h (${((x.m.committed.rate / x.rMeas - 1) * 100).toFixed(0)}%), RW_PRIOR ${x.m.prior.rate.toFixed(3)}/h`)
    const s = summary(mk, 'committed')
    console.log(`  BN8.1 overall: hours-weighted rate error ${s.rateErr >= 0 ? '+' : ''}${s.rateErr.toFixed(3)}/h; money ${(100 * s.dollarErr).toFixed(0)}%`)
  }
  for (const c of BN8_CHECKS) {
    const W = bookAfter(c.W0, c.a0, c.hours, 'pre-long')
    console.log(`  CHECK ${c.what}: measured ${c.measured}; the committed curve from $${fmt(c.W0)} at age ${c.a0}h over ${c.hours}h -> ${c.reads(W)}`)
  }
}

/** The book after `hours` from W0 at market age a0 under the committed curve alone (0.01h steps). */
export function bookAfter(W0, a0, hours, reg) {
  let W = W0
  const dt = 0.01
  for (let t = 0; t < hours - 1e-9; t += dt) W *= Math.exp(rwAgeRate(W, a0 + t + dt / 2, reg) * Math.min(dt, hours - t))
  return W
}

/**
 * BN8.1's own readings of the trader that are not ledger bins (printed every run):
 *  - CLAUDE.md "Healthy components are not progress": on 2026-09-25 the trader compounded
 *    $250m to $57b over the 5.8h stall (the life 09-25 14:48 -> 20:57Z, from its install);
 *  - nodeecon.realisedCapital as recorded in the BN8.1 fixtures: 1.95-2.04e-4/s over 2.8-5.9h
 *    of young runs (fixture-bn8-0042/1128/1232/2252/2314/graft), i.e. 0.70-0.73/h.
 */
export const BN8_CHECKS = [
  { what: 'BN8.1 stall life $250m -> $57b in 5.8h (CLAUDE.md)', W0: 2.5e8, a0: 0, hours: 5.8, measured: '$5.7e10', reads: (W) => `$${W.toExponential(2)} (${((Math.log(W / 2.5e8) / Math.log(57e9 / 2.5e8) - 1) * 100).toFixed(0)}% in ln growth)` },
  { what: 'BN8.1 realised fits 0.70-0.73/h on young books ~$2.5-5e8 over ~3-6h', W0: 2.5e8, a0: 0, hours: 4, measured: '0.70-0.73/h', reads: (W) => `${(Math.log(W / 2.5e8) / 4).toFixed(3)}/h` },
]

if (import.meta.url === `file://${process.argv[1]}`) await main()
