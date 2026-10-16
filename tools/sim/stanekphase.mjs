// STANEK'S GIFT: PRICED PHASE RE-LAYOUTS WITHIN A LIFE (L2 of the dynamic layout).
//
//   node tools/sim/stanekphase.mjs --blade --node 7 --l7 2 [--l13 1 --l6 3 --seeds 15 --wseeds 7 --bounds 3,6,9,12,15] [--json FILE]
//   node tools/sim/stanekphase.mjs --calib     the live Bladeburner+gift node vs bbsim at the same node age
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"), from the SAME state
// (the node's start, the Bladeburner route: one life, no install), the same bbsim spec and seeds:
//   WITHOUT  the gift on one layout the whole node (the incumbent: stanekplan.BLADE_LAYOUTS; and,
//            separately, the plan's early layout held the whole node — the pure switch effect)
//   WITH     the early layout from t 0, re-laid to the late layout once `when` holds (a black-op
//            count), the re-lay landing one stanek.js pass (300s) later. The charge is per fragment
//            (stanekplan.chargeTrackOf): unchanged fragments keep it, removed/changed ones lose it
//            and the new ones regrow (highestCharge on the first call, numCharge +duty/k per second).
// The decision is withH - withoutH per seed (paired), mean and its standard error over the seeds.
//
// CANDIDATES (never chosen on linear weights alone): for each boundary b, each phase's weights are
// MEASURED on bbsim — -d ln(exit hours)/d ln(mult) with each fragment type's keys x1.5 and /1.5
// only inside that phase (o.multsPhase), central differences on common seeds — the layout optimised
// on them at that phase's charge factor (stanekplan.chargeFactor at the phase's middle on the mid
// charger), and every (early, late, b) plan then priced as the full trajectory above.
//
// CALIBRATION: NOT CALIBRATED for the switch (no node has re-laid mid-node). The gift's charger is
// checked against the live game by --calib (highestCharge, numCharge per fragment, black ops and
// rank at the live node age); bbsim's leg without the gift is k-calibrated (posterior). Printed.

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import { specOf, gridOf, bladeLayoutFor, TYPE_KEYS } from './bbstanek.mjs'

const sp = await import('../../stanekplan.js')

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const se = (xs) => (xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : Infinity)
const lnMean = (xs) => (xs.every((x) => Number.isFinite(x) && x > 0) ? mean(xs.map(Math.log)) : Infinity)

/** The gift arm of a phase plan: [{placed, when}] on the BLADE_HOST charger at gbMax (thrAt/duty: chargeTrackOf). */
export function phasedGiftOf(phases, gbMax = sp.BLADE_HOST.gbMax.mid, lagS = 300) {
  return { phases, thrAt: sp.bladeThrAt({ gbMax }), duty: sp.BLADE_HOST.duty, lagS }
}

/** Hours of a plan on each seed (null = not finished). */
export function hoursOf(cell, phases, seeds, gbMax) {
  return seeds.map((seed) => runBladeburner({ ...specOf({ ...cell, seed }), stanek: phasedGiftOf(phases, gbMax) }).hours ?? Infinity)
}

/** Paired comparison: d = with - without per seed; {d, se, withH, withoutH} (means). */
export function pairedOf(withH, withoutH) {
  const d = withH.map((h, i) => h - withoutH[i])
  return { d: mean(d), se: se(d), withH: mean(withH), withoutH: mean(withoutH) }
}

/**
 * The phase's weights: -d ln h / d ln mult for each fragment type with its keys x step only inside
 * [from, to) (o.multsPhase), the gift arm on `phases` (the incumbent), common seeds.
 */
export function phaseWeights(cell, phases, { from, to }, seeds, step = 1.5, gbMax) {
  const w = {}
  for (const [type, keys] of Object.entries(TYPE_KEYS)) {
    const run = (x) => seeds.map((seed) => runBladeburner({ ...specOf({ ...cell, seed }), stanek: phasedGiftOf(phases, gbMax), multsPhase: { mults: Object.fromEntries(keys.map((k) => [k, x])), from, to } }).hours ?? Infinity)
    w[type] = Math.max(0, -(lnMean(run(step)) - lnMean(run(1 / step))) / (2 * Math.log(step)))
  }
  return w
}

const typesTxt = (w) => Object.entries(w).map(([t, v]) => `${sp.TYPE_NAME[t]} ${v.toFixed(3)}`).join(' ')

/** The Bladeburner cell's phase-plan search and prices. */
export function priceBlade({ node, l6 = 3, l7, l13 = 1, seeds, wseeds, bounds, gbMax = sp.BLADE_HOST.gbMax.mid, log = console.log }) {
  const cell = { node, l6, l7, l13 }
  const gr = gridOf(node, l13)
  const inc = bladeLayoutFor(gr).placed
  const one = (placed) => [{ placed, when: null }]
  const incH = hoursOf(cell, one(inc), seeds, gbMax)
  // the incumbent's black-op clock (the phase's middle charge factor)
  const endH = mean(incH.filter(Number.isFinite))
  log(`BN${node} SF13.${l13} SF7.${l7} SF6.${l6} grid ${gr.width}x${gr.height}|${gr.nodePower}: incumbent ${sp.layoutKeyOf(inc)} exit ${endH.toFixed(3)}h (mean of ${seeds.length} seeds)`)
  const boTimes = (() => {
    const at = []
    runBladeburner({ ...specOf({ ...cell, seed: seeds[0] }), stanek: phasedGiftOf(one(inc), gbMax), onStep: ({ t, bb }) => { if (bb.numBlackOpsComplete > at.length) at.push(t / 3600) } })
    return at
  })()
  const cAt = (h) => sp.chargeFactor(sp.bladeThrAt({ gbMax })(h * 3600), (sp.BLADE_HOST.duty * h * 3600) / Math.max(1, sp.chargeRootsOf(inc).length))
  const plans = []
  for (const b of bounds) {
    const tb = boTimes[b - 1] ?? endH
    const when = { blackOps: b }
    const wE = phaseWeights(cell, one(inc), { from: null, to: when }, wseeds, 1.5, gbMax)
    const wL = phaseWeights(cell, one(inc), { from: when, to: null }, wseeds, 1.5, gbMax)
    const cE = cAt(tb / 2)
    const cL = cAt((tb + endH) / 2)
    const E = sp.optimiseLayout({ ...gr, weights: wE, c: cE, budget: 1e5 }).placed
    const L = sp.optimiseLayout({ ...gr, weights: wL, c: cL, budget: 1e5 }).placed
    log(`  b=${b} black ops (~${tb.toFixed(1)}h): early w ${typesTxt(wE)} c ${cE.toFixed(3)} -> ${sp.layoutKeyOf(E)}; late w ${typesTxt(wL)} c ${cL.toFixed(3)} -> ${sp.layoutKeyOf(L)}`)
    for (const [eSrc, early] of [['incumbent', inc], ['early-opt', E]]) {
      if (sp.layoutKeyOf(early) === sp.layoutKeyOf(L)) continue
      const withH = hoursOf(cell, [{ placed: early, when: null }, { placed: L, when }], seeds, gbMax)
      const vsInc = pairedOf(withH, incH)
      const earlyH = eSrc === 'incumbent' ? incH : hoursOf(cell, one(early), seeds, gbMax)
      const vsEarly = pairedOf(withH, earlyH)
      const p = { b, when, eSrc, early, late: L, withH: vsInc.withH, withoutH: vsInc.withoutH, d: vsInc.d, se: vsInc.se, dSwitch: vsEarly.d, seSwitch: vsEarly.se, earlyHeldH: vsEarly.withoutH, perSeed: withH.map((h, i) => [seeds[i], +h.toFixed(3), +incH[i].toFixed(3)]) }
      plans.push(p)
      log(`    ${eSrc.padEnd(9)} ${sp.layoutKeyOf(early)} -> ${sp.layoutKeyOf(L)} at ${sp.whenText(when)}: ${p.withH.toFixed(3)}h vs incumbent ${p.withoutH.toFixed(3)}h  d ${p.d.toFixed(3)} +- ${p.se.toFixed(3)}h; vs the early layout held ${p.earlyHeldH.toFixed(3)}h: switch d ${p.dSwitch.toFixed(3)} +- ${p.seSwitch.toFixed(3)}h`)
    }
  }
  // the single-layout alternatives the plans are measured against too (L1-like: one layout, no switch)
  const best = plans.reduce((a, p) => (a === null || p.d < a.d ? p : a), null)
  return { cell, grid: `${gr.width}x${gr.height}|${gr.nodePower}`, incumbent: inc, incH: mean(incH), plans, best, boTimes }
}

/** The live Bladeburner+gift node vs bbsim at its node age (charger and progress). */
export function calibLive(tel) {
  const st = JSON.parse(fs.readFileSync(path.join(tel, 'stanek.txt'), 'utf8'))
  const bb = JSON.parse(fs.readFileSync(path.join(tel, 'bladeburner.txt'), 'utf8'))
  const node = st.node
  const ageH = (Date.parse(st.at) - st.lastNodeReset) / 3600e3
  const fr = (st.fragments ?? []).filter((f) => f.type !== 'Booster')
  const k = fr.length
  const live = { H: fr[0]?.highestCharge, n: fr[0]?.numCharge, rank: bb.rank, blackOps: bb.blackOps?.done }
  // the charger the live game runs: H = threads x core bonus (MEASURED) from the node's start; duty from numCharge
  const dutyLive = live.n * live.H / (ageH * 3600 * live.H / k)
  console.log(`LIVE BN${node} ${ageH.toFixed(2)}h in: ${k} charged fragments, highestCharge ${live.H}, numCharge ${live.n?.toFixed(0)} -> duty ${dutyLive.toFixed(3)} (BLADE_HOST.duty ${sp.BLADE_HOST.duty}); rank ${Math.round(live.rank)}, black ops ${live.blackOps}`)
  const midH = sp.bladeThrAt({ gbMax: sp.BLADE_HOST.gbMax.mid })(ageH * 3600)
  console.log(`  model charger (mid ${sp.BLADE_HOST.gbMax.mid}GB, 1 core): highestCharge ${midH} vs live ${live.H} (${((midH / live.H - 1) * 100).toFixed(0)}%); numCharge ${(sp.BLADE_HOST.duty * ageH * 3600 / k).toFixed(0)} vs live ${live.n?.toFixed(0)} (${((sp.BLADE_HOST.duty * ageH * 3600 / k / live.n - 1) * 100).toFixed(1)}%)`)
  // bbsim's state at the same node age, this node's cell (SF7 = the level held: node 7 at SF7.1 is BN7.2), the placed layout
  const l7 = +(process.env.CALIB_L7 ?? 1)
  const placed = (st.fragments ?? []).map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rot }))
  const rows = [1, 2, 3, 4, 5].map((seed) => {
    let at = null
    runBladeburner({ ...specOf({ node, l6: 3, l7, l13: 1, seed }), stanek: phasedGiftOf([{ placed, when: null }]), onStep: ({ t, bb: b }) => { if (at === null && t >= ageH * 3600) at = { rank: b.rank, bo: b.numBlackOpsComplete } } })
    return at
  })
  const rk = rows.map((r) => r?.rank ?? NaN).sort((a, b) => a - b)[2]
  const bo = rows.map((r) => r?.bo ?? NaN).sort((a, b) => a - b)[2]
  console.log(`  bbsim BN${node} SF7.${l7} at ${ageH.toFixed(2)}h (median of 5 seeds, mid charger, the live layout): rank ${Math.round(rk)} vs live ${Math.round(live.rank)} (${((rk / live.rank - 1) * 100).toFixed(0)}%), black ops ${bo} vs live ${live.blackOps}`)
  return { ageH, live, dutyLive, midH, sim: { rank: rk, blackOps: bo } }
}

/**
 * THE HACKING ROUTE'S PHASE PLAN on the live exit model (exitplan.bestExitPolicy on progress.js's
 * published inputs and committed install basis — tools/sim/stanekperlife.mjs priceLive's builder),
 * a gift charged on the live fleet at f on the given grid: WITHOUT = the incumbent (the tabled
 * layout) every life; WITH = the incumbent until tsH into each life, then B (stanekplan.switchInputsOf:
 * B's changed fragments regrow from 0, the round robin over B's k), re-laid to the incumbent at each
 * install (free: the install zeroes the charge). B in L1's options (live weights, node-model lives)
 * and every other option; tsH in HACK_PHASE_FRACS x the life. Also each B held the whole life (L1).
 */
export async function priceHack({ tel, width, height, nodePower, f = 0.2, nodeCands = [] }) {
  const X = await import('../../exitplan.js')
  const P = await import('../../plan.js')
  const rd = (n) => JSON.parse(fs.readFileSync(path.join(tel, n), 'utf8'))
  const ei = rd('exitinputs.txt')
  const plan = rd('plan.txt')
  const st = rd('stanek.txt')
  const basis = P.basisOf(plan.decisions?.install ?? null, Date.now())
  const w = Math.max(0, basis?.waitH ?? 0)
  const gains = basis?.gains ?? null
  const raw = { ...ei.inputs }
  delete raw.giftLife
  const hoursOfI = (inp) => X.bestExitPolicy({ ...inp, firstInstallH: w, ...(gains ? { installGains: gains, nextInstallGain: gains.hacking ?? null } : {}) }, 400, 1).best?.hours ?? null
  const tabled = sp.layoutForGrid(width, height, nodePower, 'hack').placed
  const ctx0 = { layout: [], nodePower, fleetGB: st.fleet.gb, hosts: st.fleet.hosts, fNow: 0, cycleH: raw.cycleHours }
  const base = sp.layoutInputsOf(raw, ctx0, f, tabled)
  const ctx = { ...ctx0, layout: tabled, fNow: f }
  const H0 = hoursOfI(base)
  const weights = sp.liveWeightsOf(H0, sp.liveWeightInputsOf(base).map((x) => ({ type: x.type, hours: hoursOfI(x.inputs) })))
  const { options } = sp.liveLayoutOptionsOf({ base, ctx, f, width, height, nodePower, incumbent: tabled }, weights)
  for (const [src, placed] of nodeCands) if (!options.some((o) => o.key === sp.layoutKeyOf(placed))) options.push({ src, placed, key: sp.layoutKeyOf(placed), inputs: sp.layoutInputsOf(base, ctx, f, placed) })
  const rows = []
  for (const o of options) {
    if (o.src === 'incumbent') continue
    rows.push({ src: o.src, key: o.key, tsH: null, hours: hoursOfI(o.inputs) })
    for (const q of sp.HACK_PHASE_FRACS) {
      const tsH = q * raw.cycleHours
      rows.push({ src: o.src, key: o.key, tsH, hours: hoursOfI(sp.switchInputsOf(base, ctx, f, o.placed, tsH)) })
    }
  }
  return { H0, rows, cycleH: raw.cycleHours, at: ei.at, node: ei.bitNode, fleetGB: st.fleet.gb, weights }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  console.log('CALIBRATION: NOT CALIBRATED for the switch (no node has re-laid mid-node); the leg without the gift is k-calibrated; the charger is checked by --calib.')
  if (args.includes('--calib')) calibLive(opt('tel', path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.telemetry')))
  if (args.includes('--hack')) {
    const { nodeMults } = await import('./nodechoice/hackexit.mjs')
    const { perLifeRunOf, giftBaseOf } = await import('./gameplan/stanek.mjs')
    const { midWorld } = await import('./stanekperlife.mjs')
    const node = +opt('node', 13)
    const l13 = +opt('l13', 1)
    const m = nodeMults(node)
    const gs = sp.giftSize(m.StaneksGiftExtraSize, l13)
    const pol = perLifeRunOf(node, l13, midWorld(2.6), m, { H0: 25, g: 0.1 }, { budget: 2e4 })
    const o = { ...giftBaseOf(node, l13, midWorld(2.6), m, { H0: 25, g: 0.1 }).base, hours: pol.perLife.hours, f: pol.perLife.f }
    const lp = sp.lifePolicyOf(o, { width: gs.width, height: gs.height, budget: 2e4, g: 0.1 })
    const seen = new Map()
    lp.layouts.forEach((pl, i) => seen.has(sp.layoutKeyOf(pl)) || seen.set(sp.layoutKeyOf(pl), [`node model ${lp.lives[i].stage}`, pl]))
    const r = await priceHack({ tel: opt('tel', path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.telemetry')), width: gs.width, height: gs.height, nodePower: m.StaneksGiftPowerMultiplier, f: +opt('f', 0.2), nodeCands: [...seen.values()] })
    console.log(`HACKING ROUTE, the live exit model on BN${r.node}'s published inputs (${r.at}), life ${r.cycleH}h, fleet ${r.fleetGB.toFixed(0)}GB, the BN${node} SF13.${l13} grid ${gs.width}x${gs.height}: incumbent (tabled) every life ${r.H0.toFixed(3)}h`)
    for (const x of r.rows) console.log(`  ${x.src.padEnd(20)} ${String(x.key).padEnd(44)} ${x.tsH === null ? 'held the whole life (L1)' : `from ${x.tsH.toFixed(2)}h into each life`.padEnd(24)} ${x.hours?.toFixed(3)}h  d ${(x.hours - r.H0).toFixed(3)}h`)
    const best = r.rows.filter((x) => x.tsH !== null).reduce((a, x) => (a === null || x.hours < a.hours ? x : a), null)
    const bestHeld = r.rows.filter((x) => x.tsH === null).reduce((a, x) => (a === null || x.hours < a.hours ? x : a), null)
    console.log(`BEST SWITCH: ${best?.src} ${best?.key} from ${best?.tsH?.toFixed(2)}h: d ${(best?.hours - r.H0).toFixed(3)}h vs the incumbent; the best layout held the whole life d ${(bestHeld?.hours - r.H0).toFixed(3)}h`)
    console.log('CALIBRATION: NOT CALIBRATED — the inputs are live (a Bladeburner node\'s hacking exit), the gift on them hypothetical; the exit model is life-averaged (a within-life channel shift is not representable beyond the time-average).')
    if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify(r))
  }
  if (args.includes('--refine')) {
    // THE OUT-OF-SAMPLE PRICE: the search's top plans (by d on its seeds) re-priced on FRESH seeds
    // (101..), so the choice is not selected on the noise it is reported with; the literal printed is
    // the BLADE_PHASE_PRICED entry: d vs the INCUMBENT (BLADE_LAYOUTS held — what runs without the plan), the plan
    // chosen on d + 2se (listed by stanekplan only where d + 2se < 0).
    const r = JSON.parse(fs.readFileSync(opt('refine'), 'utf8'))
    const rseeds = Array.from({ length: +opt('rseeds', 40) }, (_, i) => 101 + i)
    // the top K of each early source (the incumbent's switch pairs tightly; an optimised early layout
    // decorrelates the trajectory, so its search d is noisy and needs the fresh seeds most)
    const K = +opt('top', 2)
    const bySrc = (src) => r.plans.filter((p) => p.eSrc === src).sort((a, b) => a.d - b.d).slice(0, K)
    const top = [...bySrc('incumbent'), ...bySrc('early-opt')]
    const cell = r.cell
    const one = (placed) => [{ placed, when: null }]
    const incH = hoursOf(cell, one(r.incumbent), rseeds)
    const heldMemo = new Map()
    const heldOf = (early) => {
      const k = sp.layoutKeyOf(early)
      if (!heldMemo.has(k)) {
        const h = hoursOf(cell, one(early), rseeds)
        const v = pairedOf(h, incH)
        console.log(`  HELD ${k} the whole node (no switch; not a phase plan): vs the incumbent ${v.d.toFixed(3)} +- ${v.se.toFixed(3)}h`)
        heldMemo.set(k, h)
      }
      return heldMemo.get(k)
    }
    let best = null
    for (const p of top) {
      const earlyH = p.eSrc === 'incumbent' ? incH : heldOf(p.early)
      const withH = hoursOf(cell, [{ placed: p.early, when: null }, { placed: p.late, when: p.when }], rseeds)
      const q = pairedOf(withH, earlyH)
      const vi = pairedOf(withH, incH)
      console.log(`  REFINE BN${cell.node}|${cell.l13}|${cell.l7} ${p.eSrc} ${sp.layoutKeyOf(p.early)} -> ${sp.layoutKeyOf(p.late)} at ${sp.whenText(p.when)}: search d ${p.d.toFixed(3)}h; fresh ${rseeds.length} seeds: switch d ${q.d.toFixed(3)} +- ${q.se.toFixed(3)}h (${q.withoutH.toFixed(3)} -> ${q.withH.toFixed(3)}h), vs the incumbent ${vi.d.toFixed(3)} +- ${vi.se.toFixed(3)}h`)
      if (!best || vi.d + 2 * vi.se < best.vi.d + 2 * best.vi.se) best = { p, q, vi }
    }
    if (best) {
      const { p, vi: q } = best
      const lit = (pl) => JSON.stringify(pl).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+:)/g, ', ')
      console.log(`LITERAL '${cell.node}|${cell.l13}|${cell.l7}': { early: ${lit(p.early)}, late: ${lit(p.late)}, when: ${lit(p.when)}, withoutH: ${q.withoutH.toFixed(3)}, withH: ${q.withH.toFixed(3)}, d: ${q.d.toFixed(4)}, se: ${q.se.toFixed(4)}, n: ${rseeds.length} }, // ${q.d + 2 * q.se < 0 ? 'WINS (d + 2se < 0)' : 'does not win: not listed'}`)
    }
  }
  if (args.includes('--blade')) {
    const seeds = Array.from({ length: +opt('seeds', 15) }, (_, i) => i + 1)
    const wseeds = Array.from({ length: +opt('wseeds', 7) }, (_, i) => i + 1)
    const bounds = String(opt('bounds', '3,6,9,12,15')).split(',').map(Number)
    const r = priceBlade({ node: +opt('node', 7), l6: +opt('l6', 3), l7: +opt('l7', 2), l13: +opt('l13', 1), seeds, wseeds, bounds })
    const b = r.best
    if (b) console.log(`BEST: ${b.eSrc} -> late at ${sp.whenText(b.when)}: d ${b.d.toFixed(3)} +- ${b.se.toFixed(3)}h vs the incumbent (${b.withoutH.toFixed(3)} -> ${b.withH.toFixed(3)}h)`)
    if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify(r))
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
  process.exit(0)
}
