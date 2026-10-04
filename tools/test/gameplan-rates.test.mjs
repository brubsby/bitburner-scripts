// THE FITTED RATES AND THE GANG COVARIATE (tools/sim/gameplan/rates.mjs, gmodel.mjs).
//
//   RT1  rates.mjs on synthetic lives whose answer is known: the pooled within-node slope, every
//        node's level, the node-level regression's predictive, a node's own reading combined by
//        precision, the in-run reading, finalRatesOf's formula and the per-node profile slice
//   RT2  the gang covariate: 1 for BN2 only; on synthetic g where BN2 alone is high and WDD has no
//        effect, the full model credits WDD with BN2 (BN14 high) and the gang model does not
//   RT3  REGRESSION: --rates const reproduces the numbers before the fit (the base g, BN14's exit at
//        g 0.0885, the old exit inputs, the old models' LOO) — game half (ratestest.mjs)
//   RT4  CALIBRATION on the played nodes: replay at the backed-out g, the leave-one-out hours under
//        the kept g model, the rates' own leave-one-out — game half
//   RT5  the node in progress's reading reaches its own pricing and no other node's — game half
//
// RT3-RT5 need the nodechoice game bundle and the live telemetry (TELEMETRY); when either is
// missing they WARN with the reason — "could not check" is never a PASS.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import * as R from '../sim/gameplan/rates.mjs'
import { looCompare, gJointOf, FEATURES, MODELS } from '../sim/gameplan/gmodel.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GP = path.join(HERE, '../sim/gameplan')

// deterministic normal noise
const rngOf = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const normalOf = (r) => () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())

/** A synthetic multiplier table: every node all-1 but the fields set per node. */
const multsTable = (over) => (n) => ({ HackExpGain: 1, HackingSpeedMultiplier: 1, ScriptHackMoney: 1, ServerMaxMoney: 1, ScriptHackMoneyGain: 1, WorldDaemonDifficulty: 1, AugmentationMoneyCost: 1, HackingLevelMultiplier: 1, ...(over[n] ?? {}) })

function rt1() {
  const c = new Check('RT1', 'rates.mjs recovers a known slope and node levels; the predictive, a own reading, the in-run reading and finalRatesOf are the stated formulas')
  const B = 3.0
  const A = { 1: 10, 4: 12, 8: 9, 9: 11, 10: 13 }
  const mo = multsTable({ 4: { ScriptHackMoney: 0.2 }, 8: { ScriptHackMoneyGain: 0 }, 9: { HackExpGain: 0.05, WorldDaemonDifficulty: 2 }, 10: { HackingSpeedMultiplier: 0.5, WorldDaemonDifficulty: 2 }, 14: { HackingSpeedMultiplier: 0.3, WorldDaemonDifficulty: 5 } })
  const sfm = () => ({ hacking_exp: 1.2, hacking_money: 1.1 })
  const nz = normalOf(rngOf(7))
  const runs = Object.entries(A).map(([n, a], j) => {
    n = Number(n)
    const m = mo(n)
    const windows = []
    for (let i = 0; i < 120; i++) {
      const lpk = Math.round(60 * Math.exp((i / 119) * Math.log(100)))
      const h = i * 0.25
      const exp = Math.exp(R.expOffset(m, sfm()) + a + B * Math.log(lpk / R.LREF) + 0.3 * nz())
      const io = R.incomeOffset(m, sfm())
      const income = isFinite(io) ? Math.exp(io + a + 8 + (B + 0.5) * Math.log(lpk / R.LREF) + 0.3 * nz()) : null
      windows.push({ h, age: h, lpk, level: lpk, exp, income })
    }
    return { bn: n, start: `2026-10-0${j}T00:00`, end: 'x', hours: 30, sfOnEntry: [], windows }
  })
  runs.push({ bn: 14, start: '2026-10-09T00:00', end: '2026-10-09T05:00', hours: 5, sfOnEntry: [], windows: [] })
  const fit = R.fitRates({ runs, multsOf: mo, sfMultsOf: sfm })
  const e = fit.channels.exp
  c.examined(1)
  if (!(Math.abs(e.b - B) < 0.05)) c.fail(`pooled exp slope ${e.b.toFixed(3)} vs the true ${B}`)
  for (const [n, a] of Object.entries(A)) {
    c.examined(1)
    if (!(Math.abs(e.nodes[n].mean - a) < 0.25)) c.fail(`BN${n} exp level ${e.nodes[n].mean.toFixed(2)} vs the true ${a}`)
  }
  c.examined(1)
  if (!(Math.abs(fit.channels.income.b - (B + 0.5)) < 0.05)) c.fail(`pooled income slope ${fit.channels.income.b.toFixed(3)} vs the true ${B + 0.5}`)
  c.examined(1)
  if (fit.channels.income.readings.some((r) => r.bn === 8)) c.fail('BN8 (ScriptHackMoneyGain 0) entered the income fit: its offset is -Infinity')
  // a node with no run: the node-level regression's predictive; a node with one: the precision product
  const p14 = e.nodes[14]
  c.examined(1)
  if (p14.readings.length || Math.abs(p14.mean - p14.prior.mean) > 1e-12) c.fail('BN14 (no run) is not the predictive itself')
  const n1 = e.nodes[1]
  const r1 = n1.readings[0]
  const want = (n1.prior.mean / n1.prior.sd ** 2 + r1.y / r1.sd ** 2) / (1 / n1.prior.sd ** 2 + 1 / r1.sd ** 2)
  c.examined(1)
  if (!(Math.abs(n1.mean - want) < 1e-9)) c.fail(`BN1's level ${n1.mean} is not the precision-weighted ${want}`)
  // the in-run reading at the pooled slope: a BN14 run generated at level 11.5
  const live = { bn: 14, start: 'L', end: 'L2', sfOnEntry: [], windows: Array.from({ length: 20 }, (_, i) => ({ h: i * 0.17, lpk: 60 + 2 * i, exp: Math.exp(R.expOffset(mo(14), sfm()) + 11.5 + e.b * Math.log((60 + 2 * i) / R.LREF)), income: null })) }
  const rr = R.inRunReadings(live, fit, mo, sfm)
  c.examined(2)
  if (!(rr.length === 1 && rr[0].param === 'xr14' && Math.abs(Math.log(rr[0].value) - 11.5) < 1e-9)) c.fail(`in-run reading ${JSON.stringify(rr[0])} is not xr14 = e^11.5`)
  if (!(rr[0]?.sd > e.sdB * Math.abs(Math.log(15000 / R.LREF) - Math.log(80 / R.LREF)) * 0.99)) c.fail('the in-run reading\'s sd omits the slope\'s over the distance to the exit level')
  const fit2 = R.fitRates({ runs, multsOf: mo, sfMultsOf: sfm, inRun: rr })
  c.examined(1)
  if (!(fit2.channels.exp.nodes[14].readings.length === 1 && fit2.channels.exp.nodes[14].sd < p14.sd)) c.fail('the in-run reading did not reach BN14 (or did not narrow it)')
  // finalRatesOf: rate = exp(offset + a + b ln(Lx/LREF)), Lx = 3000 WDD; income 0 where scripts earn nothing
  const prof = R.profileRates(fit)
  const m14 = mo(14)
  const fr = R.finalRatesOf({ m: m14, s: sfm(), rates: prof, node: 14 })
  const wantE = Math.exp(Math.log(1 * 0.3 * 1.2) + prof.nodes[14].xa + prof.b * Math.log(15000 / R.LREF))
  c.examined(3)
  if (!(Math.abs(fr.expPerSec / wantE - 1) < 1e-12 && fr.Lx === 15000)) c.fail(`finalRatesOf BN14 exp ${fr.expPerSec} vs ${wantE}`)
  if (R.finalRatesOf({ m: mo(8), s: sfm(), rates: prof, node: 8 }).incomePerSec !== 0) c.fail('BN8-like node: scripted income must be 0')
  const sl = R.profileFor({ cycleHours: 2, rates: prof }, 14)
  if (!(sl.rates.xa === prof.nodes[14].xa && !sl.rates.nodes && R.finalRatesOf({ m: m14, s: sfm(), rates: sl.rates, node: 14 }).expPerSec === fr.expPerSec)) c.fail('profileFor(…, 14) is not the node\'s slice, or prices differently from the whole profile')
  c.note(`synthetic: exp slope ${e.b.toFixed(3)} (true ${B}), income ${fit.channels.income.b.toFixed(3)} (true ${B + 0.5}); levels ${Object.keys(A).map((n) => `BN${n} ${e.nodes[n].mean.toFixed(2)}/${A[n]}`).join(' ')}; BN14 predictive ${p14.mean.toFixed(2)} +- ${p14.sd.toFixed(2)} -> with its in-run reading ${fit2.channels.exp.nodes[14].mean.toFixed(2)} +- ${fit2.channels.exp.nodes[14].sd.toFixed(2)}`)
  return c
}

function rt2() {
  const c = new Check('RT2', 'the gang covariate: BN2 only; a BN2-only effect is credited to WDD by the full model and to the gang by fullG')
  const mo = multsTable({ 2: { WorldDaemonDifficulty: 5, AugmentationMoneyCost: 1 }, 4: { WorldDaemonDifficulty: 3 }, 9: { WorldDaemonDifficulty: 2 }, 10: { WorldDaemonDifficulty: 2, AugmentationMoneyCost: 5 }, 14: { WorldDaemonDifficulty: 5, AugmentationMoneyCost: 1.5 } })
  c.examined(14)
  for (let n = 1; n <= 14; n++) if (FEATURES.gang(mo(n), n) !== (n === 2 ? 1 : 0)) c.fail(`gang feature of BN${n} is ${FEATURES.gang(mo(n), n)}`)
  c.examined(1)
  if (!MODELS.fullG?.includes('gang') || !MODELS.full.every((f) => MODELS.fullG.includes(f))) c.fail('fullG is not full + gang')
  // g: 0.05 everywhere (WDD no effect), BN2 x2.8 (its gang)
  const runs = [[1, 0.05], [2, 0.14], [4, 0.052], [8, 0.048], [9, 0.05], [10, 0.049]].map(([bn, g]) => ({ bn, g, sd: 0.15 }))
  const data = runs.map((r) => ({ bn: r.bn, y: Math.log(r.g), sd: 0.15 }))
  const Jf = gJointOf('full', data, [14], mo)
  const Jg = gJointOf('fullG', data, [14], mo)
  const g14f = Math.exp(Jf.mean.get(14))
  const g14g = Math.exp(Jg.mean.get(14))
  const wddF = Jf.beta.mean[Jf.feats.indexOf('lnWDD') + 1]
  const wddG = Jg.beta.mean[Jg.feats.indexOf('lnWDD') + 1]
  c.examined(2)
  if (!(wddF > wddG + 0.05)) c.fail(`the full model's WDD slope ${wddF.toFixed(3)} is not above fullG's ${wddG.toFixed(3)}: the gang did not take BN2's effect`)
  if (!(g14g < g14f)) c.fail(`BN14's g under fullG ${g14g.toFixed(4)} is not below full's ${g14f.toFixed(4)}`)
  const L = looCompare(runs, mo)
  c.examined(1)
  if (!['fullG', 'amcG', 'exchG', 'full', 'amc', 'exch', 'hand'].every((k) => k in L.models)) c.fail(`looCompare omits a model: ${Object.keys(L.models)}`)
  c.note(`BN2-only effect: WDD slope full ${wddF.toFixed(3)} vs fullG ${wddG.toFixed(3)}; BN14 g full ${g14f.toFixed(4)} vs fullG ${g14g.toFixed(4)} (truth 0.05); LOO best ${L.best} (${Object.entries(L.models).map(([k, v]) => `${k} ${v.elpd.toFixed(2)}`).join(', ')})`)
  return c
}

function gameHalf() {
  const cs = [
    new Check('RT3', 'REGRESSION: --rates const reproduces the numbers before the fit (base g, BN14 at g 0.0885, the old exit inputs, the old LOO)'),
    new Check('RT4', 'CALIBRATION of the fitted rates on the played nodes: replay at the backed-out g, leave-one-out hours, the rates\' own leave-one-out (|z| <= 2.5)'),
    new Check('RT5', "the node in progress's own reading reaches its pricing (and BN14.2/14.3's: one slice per node) and no other node's"),
  ]
  const need = [path.join(GP, '../nodechoice/game.bundle.mjs')]
  const missing = need.filter((f) => !fs.existsSync(f))
  if (missing.length) {
    for (const c of cs) c.warn('could not check: missing ' + missing.map((f) => path.relative(path.join(HERE, '../..'), f)).join(', '), 'build with: node tools/sim/nodechoice/build.mjs')
    return cs
  }
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'ratestest.mjs')], { encoding: 'utf8', timeout: 900e3 })
  let out
  try {
    out = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    for (const c of cs) c.warn('could not check: ratestest.mjs produced no result', (r.stderr || '').slice(-800) || `exit ${r.status}`)
    return cs
  }
  for (const [c, res] of [[cs[0], out.rt3], [cs[1], out.rt4], [cs[2], out.rt5]]) {
    if (res.skip) {
      c.warn('could not check: ' + res.skip)
      continue
    }
    c.examined(res.examined)
    for (const n of res.notes) c.note(n)
    for (const f of res.fails) c.fail(f)
  }
  return cs
}

export async function run() {
  return [rt1(), rt2(), ...gameHalf()]
}
