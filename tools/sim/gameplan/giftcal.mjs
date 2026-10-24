// THE GIFT'S HACKING FACTOR PER LIFE, MEASURED vs THE GAMEPLAN'S MODEL — the calibration of
// Stanek's Gift's exit divisor W (docs/postponed-after-reset.md item 2).
//
//   node tools/sim/gameplan/giftcal.mjs            the per-life table and the fit (reads .telemetry/history.jsonl)
//   node tools/sim/gameplan/giftcal.mjs --write-fixture   also freeze the lives into tools/test/fixture-giftcal-lives.json
//
// WHAT IS MEASURED: within one life every augmentation is fixed, so the hacking SKILL multiplier
// M(t) = level / (32 ln(exp + 534.6) - 200) (skill.ts:13, history.jsonl's skills.hacking and
// exp.hacking) moves only with the gift's Hacking fragments (StaneksGift.calculateMults, hacking
// and hacking_exp x effect; the IPvGO bonuses touch no skill multiplier before The Red Pill's
// w0r1d_d43m0n). An install clears every charge (StaneksGift.prestigeAugmentation), so
// h = M(end of life) / M(start of life) IS the gift's factor that life reached. Lives on the
// hacking route with the gift accepted: BN13.1 (2026-10-10..13) and BN10.3 (2026-10-18..19).
// Excluded and printed: lives holding The Red Pill (w0r1d_d43m0n's hacking bonus), lives on the
// Bladeburner layout (BN13.2/13.3: combat fragments, no Hacking), lives whose first readable
// level (>= 30) comes later than 0.3h in (the start's multiplier is not seen).
//
// WHAT THE MODEL SAYS for the same life: stanekplan.js's node model as the gameplan runs it
// (stanek.mjs): the grid's tabled layout (layoutFor), its Hacking fragments' effects at
// c = chargeFactor(threads, numCharge), threads = threadsOf(home RAM x LAYOUT_F, cores),
// numCharge = the life's charging seconds x stDuty / k (round robin, one call a second).
// home RAM is the life's MEASURED home (history.jsonl home.ram), not the gameplan's
// homeAt(u, stRam) ramp, so the comparison isolates the charge model from the RAM ramp.
//
// THE CALIBRATION: h_cal(L) = 1 for L <= delay; exp(kappa x ln h_model(L - delay)) after —
// kappa scales the model's ln effect (the charger the live stack actually ran: host, f, duty,
// layout), delay is the charger's start after an install (BN10.3: the factor sits at 1.00 for
// the first ~0.35-0.4h of every life, then jumps: stanek.js re-lays and relaunches charge.js
// after the install's boot). Fitted by least squares on ln h over the lives. stanekplan.nodeModel
// takes { cal: { kappa, delayH } } (GIFT_CAL below) and the gameplan's stanek route and the BN8
// model price the gift with it.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { compileLayout, multsAt, chargeFactor, threadsOf, TYPE, GIFT_CAL } from '../../../stanekplan.js'
import { layoutFor, LAYOUT_F } from './stanek.mjs'
import { SF_PARAMS } from './effects.mjs'
// bitNodeMultipliers.js imports bare 'sfgate.js': resolved by gameresolve's hook, so loaded after it
const { bitNodeMults } = await import('../../../bitNodeMultipliers.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../../..')
export const FIXTURE = path.join(ROOT, 'tools/test/fixture-giftcal-lives.json')
const has = (k) => process.argv.includes(`--${k}`)

/** The measured lives: [{ bn, l13, start, L, h, ram, cores, augs, why? }] (why set: excluded). */
export async function giftLivesOf(histPath, { from = '2026-10-10T23:40', nodes = [13, 10] } = {}) {
  const rl = readline.createInterface({ input: fs.createReadStream(histPath) })
  const lives = []
  let cur = null
  for await (const l of rl) {
    if (l.slice(7, 31) < from) continue
    const j = JSON.parse(l)
    if (!nodes.includes(j.bitNode)) {
      cur = null
      continue
    }
    const ps = j.playtimeSinceLastAug / 3.6e6
    if (!cur || ps < cur.lastPs - 0.005 || cur.bn !== j.bitNode) {
      const sf = new Map(j.sourceFiles?.data ?? [])
      cur = { bn: j.bitNode, l13: sf.get(13) ?? 0, start: j.at, rows: [], gift: false, redPill: false }
      lives.push(cur)
    }
    cur.lastPs = ps
    const augs = j.augmentations ?? []
    cur.gift ||= augs.some((a) => /^Stanek's Gift/.test(a))
    cur.redPill ||= augs.includes('The Red Pill')
    const e = j.exp?.hacking ?? 0
    const d = 32 * Math.log(e + 534.6) - 200
    if (j.skills.hacking >= 30 && d > 20) cur.rows.push({ ps, M: j.skills.hacking / d, ram: j.home?.ram, cores: j.home?.cores ?? 1, augs: augs.length })
  }
  rl.close()
  const out = []
  for (const c of lives) {
    const base = { bn: c.bn, l13: c.l13, start: c.start }
    if (!c.gift) continue
    if (c.rows.length < 3) {
      out.push({ ...base, why: `${c.rows.length} readable rows` })
      continue
    }
    const r0 = c.rows[0]
    const r1 = c.rows.at(-1)
    const early = c.rows.filter((r) => r.ps <= r0.ps + 0.1)
    const M0 = Math.min(...early.map((r) => r.M))
    const life = { ...base, L: r1.ps, h: r1.M / M0, ram: Math.max(...c.rows.map((r) => r.ram ?? 0)), cores: r1.cores, augs: r1.augs, t0: r0.ps }
    if (c.redPill) life.why = "The Red Pill installed (w0r1d_d43m0n's hacking bonus)"
    else if (r0.ps > 0.3) life.why = `first readable level at ${r0.ps.toFixed(2)}h (the life's start is not seen)`
    else if (c.bn === 13 && c.start >= '2026-10-23') life.why = 'the Bladeburner layout (BN13.2/13.3: no Hacking fragment)'
    out.push(life)
  }
  return out
}

/** The model's hacking factor for a measured life (the gameplan's layout and charge model at the life's own home RAM). */
export function modelH(life, { cal = null, duty = SF_PARAMS.stDuty.mid, f = LAYOUT_F } = {}) {
  const m = bitNodeMults(life.bn)
  const lay = layoutFor(m, life.l13)
  const cl = compileLayout(lay.placed)
  const T = threadsOf(life.ram * f, life.cores ?? 1)
  const chargeH = Math.max(0, life.L - (cal?.delayH ?? 0))
  if (!(chargeH > 0) || !cl.charged.some((q) => q.type === TYPE.Hacking)) return 1
  const N = (chargeH * 3600 * duty) / cl.k
  const h = multsAt(cl, chargeFactor(T, N), m.StaneksGiftPowerMultiplier).hacking
  return cal ? Math.exp((cal.kappa ?? 1) * Math.log(h)) : h
}

/** Fit { kappa, delayH } by least squares on ln h over the used lives (delay on a 0.05h grid). */
export function fitGiftCal(lives) {
  let best = null
  for (let d = 0; d <= 0.8 + 1e-9; d += 0.05) {
    // for a fixed delay, ln h_meas = kappa ln h_model(L - d): closed form
    let sxy = 0
    let sxx = 0
    let n0 = 0
    for (const l of lives) {
      const x = Math.log(modelH(l, { cal: { kappa: 1, delayH: d } }))
      const y = Math.log(l.h)
      sxy += x * y
      sxx += x * x
      if (x === 0) n0 += y * y
    }
    const kappa = sxx > 0 ? sxy / sxx : 1
    let sse = 0
    for (const l of lives) {
      const r = Math.log(l.h) - Math.log(modelH(l, { cal: { kappa, delayH: d } }))
      sse += r * r
    }
    if (!best || sse < best.sse) best = { kappa, delayH: +d.toFixed(2), sse, n: lives.length }
  }
  return best
}

async function main() {
  let lives
  if (has('fixture')) lives = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).lives
  else {
    const tel = [process.env.TELEMETRY, path.join(ROOT, '.telemetry'), '/home/tbusby/Repos/bitburner-scripts/.telemetry'].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'history.jsonl')))
    lives = await giftLivesOf(path.join(tel, 'history.jsonl'))
    if (has('write-fixture')) {
      fs.writeFileSync(FIXTURE, JSON.stringify({ note: `tools/sim/gameplan/giftcal.mjs --write-fixture ${new Date().toISOString()}: per-life gift factor from history.jsonl`, lives }, null, 0))
      console.log(`wrote ${FIXTURE} (${lives.length} lives)`)
    }
  }
  const used = lives.filter((l) => !l.why)
  const fit = fitGiftCal(used)
  console.log(`STANEK'S GIFT, THE HACKING FACTOR PER LIFE — ${used.length} lives used of ${lives.length} (BN13.1, BN10.3), measured h = M(end)/M(start) from history.jsonl`)
  console.log(`  FIT  kappa ${fit.kappa.toFixed(3)} (x the model's ln effect)  delay ${fit.delayH}h (the charger's start after an install)  rms ln error ${Math.sqrt(fit.sse / fit.n).toFixed(3)}`)
  console.log(`  COMMITTED (stanekplan.GIFT_CAL)  kappa ${GIFT_CAL.kappa}  delay ${GIFT_CAL.delayH}h`)
  console.log('  node start                 SF13  life h  home GB   measured h   model h (uncal)   calibrated (committed)   err')
  let s2 = 0
  let s2u = 0
  for (const l of lives) {
    if (l.why) {
      console.log(`  BN${l.bn} ${l.start.slice(0, 16)}  ${l.l13}   ${l.L !== undefined ? l.L.toFixed(2).padStart(6) : '     -'}  EXCLUDED: ${l.why}${l.h ? ` (h ${l.h.toFixed(3)})` : ''}`)
      continue
    }
    const mu = modelH(l)
    const mc = modelH(l, { cal: GIFT_CAL })
    const e = Math.log(mc / l.h)
    s2 += e * e
    s2u += Math.log(mu / l.h) ** 2
    console.log(`  BN${l.bn} ${l.start.slice(0, 16)}  ${l.l13}   ${l.L.toFixed(2).padStart(6)}  ${String(l.ram).padStart(8)}   ${l.h.toFixed(3).padStart(8)}   ${mu.toFixed(3).padStart(10)}        ${mc.toFixed(3).padStart(10)}            ${(100 * (mc / l.h - 1)).toFixed(0).padStart(4)}%`)
  }
  console.log(`  rms ln error: the model uncalibrated ${Math.sqrt(s2u / used.length).toFixed(3)}, calibrated (committed) ${Math.sqrt(s2 / used.length).toFixed(3)}`)
  // the life-length dependence, the question the backlog item asked
  for (const [lo, hi] of [[0, 0.5], [0.5, 1], [1, 2], [2, 4], [4, 99]]) {
    const sel = used.filter((l) => l.L > lo && l.L <= hi)
    if (!sel.length) continue
    const gm = (f) => Math.exp(sel.reduce((a, l) => a + Math.log(f(l)), 0) / sel.length)
    console.log(`  lives ${lo}-${hi === 99 ? '' : hi}h (${sel.length}): measured h (geo mean) ${gm((l) => l.h).toFixed(3)}, model ${gm((l) => modelH(l)).toFixed(3)}, calibrated ${gm((l) => modelH(l, { cal: GIFT_CAL })).toFixed(3)}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
