// incomecal.mjs — CALIBRATION of the exit model's income (exitplan.incomeModelOf
// over freshlife.steadyIncomeOf) against the measured late lives of finished
// nodes (history.jsonl), and of the model it replaced.
//
//   node tools/sim/incomecal.mjs                  the table (model vs measured, error printed)
//   node tools/sim/incomecal.mjs --write-fixture  also writes tools/test/fixture-incomecal.json
//
// WHAT IS MEASURED: per life, the income over 10-minute windows in which the
// balance only rose and the batcher's RAM (home + purchased servers) did not
// change; the life's median window in its second half. Every stream is in it
// (scripts, trader, sleeves, hacknet): the model is the scripts' alone, so a
// measured late life above the model by the trader's share is expected.
//
// THE STATE A LIFE IS PRICED AT: its median window's hacking level, home +
// purchased RAM (the network added as steadyIncomeOf adds it), and the player's
// hacking multipliers rebuilt from the installed augmentations
// (fixture-augs.json) x Source-File 1's (+16/24/28%). NOT in the rebuild: the
// NeuroFlux level (one entry per name in the save digest), the other
// Source-Files' hacking multipliers, the gift — so the multipliers are a floor.
//
// THE TWO MODELS, from an ANCHOR life to the node's LATE life:
//   old   the level-scaled income: anchor income x (L_late + 50) / (L_anchor + 50)
//         (exitplan before 2026-10-18: today's fleet and money multipliers held)
//   new   the state's: q x grid(late state), q = anchor income / grid(anchor
//         state) clipped to exitplan.Q_BAND (incomeModelOf's q; the late life's
//         RAM and multipliers as measured). The anchor is an EARLY life — the
//         live problem extrapolates from life 1.
// The first prices how the extrapolation fails; the second how the formula
// carries a measured anchor to the late state. The RAM and multipliers the
// exit model itself projects (home bought in the leg, kappa) are NOT checked
// here: no recorded exit-model input history exists for BN10.1.
//
// TOLERANCE (the decision it protects: the BN10.3 Covenant leg, ~50h priced
// against a 47h exit without it): x/÷2.5 on the late income, |ln| <= 0.92. A
// factor 2.5 moves the leg ~x2.5 and the mandate's verdict (it is priced, not
// chosen) not at all; the 35x it replaces moved the exit 400h.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const TEL = process.env.TELEMETRY ?? path.join(REPO, '.telemetry')
const fl = await import(path.join(REPO, 'freshlife.js'))
const { bitNodeMults } = await import(path.join(REPO, 'bitNodeMultipliers.js'))

export const TOL_LN = Math.log(2.5)
/** exitplan's band on the anchor's formula error (Q_BAND): one early life's measured/formula ratio, clipped. */
const xpMod = await import(path.join(REPO, 'exitplan.js'))
const clampQ = (q) => Math.min(xpMod.Q_BAND, Math.max(1 / xpMod.Q_BAND, q))
const KEYS = ['hacking', 'hacking_speed', 'hacking_money', 'hacking_grow', 'hacking_chance', 'hacking_exp']
const SF1 = [1, 1.16, 1.24, 1.28]

/** The finished nodes calibrated, with their anchor and late lives (index in the run's lives with a measured late income). */
export const NODES = [
  { name: 'BN10.1', bn: 10, from: '2026-09-22T02:06', to: '2026-09-25T12:52', anchor: 5, late: 23 },
  { name: 'BN13.1', bn: 13, from: '2026-10-10T23:44', to: '2026-10-13T01:01', anchor: 8, late: 21 },
  { name: 'BN9.1', bn: 9, from: '2026-09-28T18:38', to: '2026-10-01T02:49', anchor: 4, late: 10 },
  { name: 'BN8.1', bn: 8, from: '2026-09-25T12:52', to: '2026-09-27T20:51', anchor: null, late: null },
]

export function multsOf(augNames, sf, augs) {
  const A = new Map(augs.map((a) => [a.name, a.mults]))
  const m = Object.fromEntries(KEYS.map((k) => [k, 1]))
  for (const n of augNames) {
    const a = A.get(n)
    if (a) for (const k of KEYS) m[k] *= a[k] ?? 1
  }
  const s1 = SF1[Math.min(3, sf[1] ?? 0)]
  for (const k of KEYS) m[k] *= s1
  return m
}

async function livesOf(from, to) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(TEL, 'history.jsonl')) })
  const lives = []
  let cur = null
  let prev = null
  for await (const line of rl) {
    const at = line.slice(7, 7 + from.length)
    if (at < from || line.slice(7, 7 + to.length) > to) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    const h = r.totalPlaytime / 3.6e6
    const age = (r.playtimeSinceLastAug ?? 0) / 3.6e6
    if (!cur || age < cur.lastAge - 0.01) {
      cur = { n: lives.length + 1, sf: Object.fromEntries(r.sourceFiles?.data ?? []), augs: r.augmentations ?? [], w: [], lastAge: age }
      lives.push(cur)
      prev = null
    }
    cur.lastAge = age
    const ps = (r.purchasedServers ?? []).filter((s) => s.hostname.startsWith('pserv')).reduce((a, s) => a + s.ram, 0)
    const R = (r.home?.ram ?? 0) + ps
    if (prev && h - prev.h >= 1 / 6) {
      if (r.money >= prev.money && prev.R === R) cur.w.push({ age, I: (r.money - prev.money) / ((h - prev.h) * 3600), L: (r.skills.hacking + prev.L) / 2, R })
      prev = { h, money: r.money, L: r.skills.hacking, R }
    } else if (!prev) prev = { h, money: r.money, L: r.skills.hacking, R }
  }
  return lives.map((l) => {
    const W = l.w.filter((x) => x.age > 0.5 * l.lastAge && x.I > 0).sort((a, b) => a.I - b.I)
    const m = W.length ? W[Math.floor(W.length / 2)] : null
    return m ? { n: l.n, sf: l.sf, augs: l.augs, L: Math.round(m.L), R: m.R, I: m.I, windows: W.length } : { n: l.n, I: null }
  })
}

/** One node's row: { name, measured, old, new, errOld, errNew } from its anchor and late states (fixture form). */
export function rowOf(x) {
  if (!x.anchor) return { name: x.name, why: x.why }
  const bn = bitNodeMults(x.bn, 1)
  const g = (s) => fl.steadyIncomeOf({ bn, mults: s.mults, level: s.L, ramGB: s.R })
  const ga = g(x.anchor)
  const gl = g(x.late)
  const oldP = x.anchor.I * ((x.late.L + 50) / (x.anchor.L + 50))
  const q = ga > 0 ? clampQ(x.anchor.I / ga) : null
  const newP = q ? q * gl : null
  return { name: x.name, q, measured: x.late.I, old: oldP, new: newP, formula: gl, errOld: Math.log(oldP / x.late.I), errNew: newP ? Math.log(newP / x.late.I) : null, errFormula: gl > 0 ? Math.log(gl / x.late.I) : null }
}

export async function buildFixture() {
  const augs = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/test/fixture-augs.json'), 'utf8')).augmentations
  const out = []
  for (const nd of NODES) {
    if (nd.anchor === null) {
      out.push({ name: nd.name, bn: nd.bn, anchor: null, why: `ScriptHackMoneyGain ${bitNodeMults(nd.bn, 1).ScriptHackMoneyGain}: scripts earn nothing in BitNode ${nd.bn}, the model returns null (the trader is the capital term, unchanged)` })
      continue
    }
    const lives = await livesOf(nd.from, nd.to)
    const st = (n) => {
      const l = lives.find((x) => x.n === n)
      if (!l || l.I === null) throw new Error(`${nd.name}: life ${n} has no measured late income`)
      return { life: n, L: l.L, R: l.R, I: l.I, windows: l.windows, mults: multsOf(l.augs, l.sf, augs) }
    }
    out.push({ name: nd.name, bn: nd.bn, anchor: st(nd.anchor), late: st(nd.late) })
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fx = await buildFixture()
  console.log(`INCOME CALIBRATION (tolerance x/÷${Math.exp(TOL_LN).toFixed(1)} on the late income; measured = every stream, the model = the scripts)`)
  console.log('node     anchor -> late life      measured     old model (err)        new model (err)        formula alone (err)')
  for (const x of fx) {
    const r = rowOf(x)
    if (!x.anchor) {
      console.log(`${x.name.padEnd(8)} not applicable: ${x.why}`)
      continue
    }
    const e = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} (x${Math.exp(v).toPrecision(3)})`
    const ok = Math.abs(r.errNew) <= TOL_LN ? 'PASS' : 'FAIL'
    console.log(`${x.name.padEnd(8)} life ${x.anchor.life} (L${x.anchor.L}, q ${r.q.toFixed(2)}) -> ${x.late.life} (L${x.late.L}) $${r.measured.toExponential(2)}  $${r.old.toExponential(2)} ${e(r.errOld).padEnd(16)} $${r.new.toExponential(2)} ${e(r.errNew).padEnd(16)} $${r.formula.toExponential(2)} ${e(r.errFormula)}  ${ok}`)
  }
  if (process.argv.includes('--write-fixture')) {
    const p = path.join(REPO, 'tools/test/fixture-incomecal.json')
    fs.writeFileSync(p, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'tools/sim/incomecal.mjs from .telemetry/history.jsonl', tolLn: TOL_LN, nodes: fx }, null, 1))
    console.log(`wrote ${p}`)
  }
}
