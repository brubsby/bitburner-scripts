// [HC] THE LIVE HACKING EXIT IN BITNODE 12 — calibrated on the finished hacking clears, its shape bounded.
//
// Live BN12.7 2026-11-13 07:08-12:00Z: the route decision priced the hacking exit at 2-4h (vs the black ops
// 6.7h), switched route and installed nine times; BN12.1 took 21.2h by hacking, BN12.2-12.6 6.1-7.3h by the
// black ops. The cause (tools/sim/hackarmcal.mjs, exitplan.cadenceShapeOf): the purchase sequence's scale,
// ln g over the model's 96-life mean, was 25-31, and the catalogue's front was priced x5.6 and x3.5 a
// half-hour life — mult 1.83 -> 45.7 in three lives. The scale is bounded by the range its calibration covers
// (exitplan.SHAPE_SCALE_MAX).
//
//   HC1 THE INCIDENT      the live BN12.7 inputs (fixture-bn12-hackarm-1604.json): unbounded, the arm prices
//                         < 4.5h on a multiplier past x20 in the install cycles (reproduced: 3.67h); bounded,
//                         > 5.5h and the first shaped life at most SHAPE_SCALE_MAX x the model's ln
//   HC2 THE BOUND         every record of a finished hacking clear (hackarmcal ROWS) runs at a scale inside
//                         the bound and prices exactly as unbounded; the bound is within 10% of the largest
//   HC3 THE TABLE         the BN12.1 records' remaining hours, model vs measured, printed; the shaped ones
//                         within x/÷2 (a regression on the calibrated clear goes red)
//   HC4 THE RULE          routepin.NODE_ROUTE_RULES[12] stays on unless hackarmcal's lift check holds on the
//                         committed data (the BN12.1 replay in band AND the arm's BN12 entry price above every
//                         measured Bladeburner clear); the check itself can say both
//   HC5 WIRING            exitHours bounds the shape's scale (o.shapeScaleMax ?? SHAPE_SCALE_MAX)
//   HC6 THE BOUNDED SHAPE every life at the bound x its model ln, past the sequence too; unbounded as before
import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const X = await import('../../exitplan.js')
const H = await import('../sim/hackarmcal.mjs')
const RP = await import('../../routepin.js')

const fx = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test', f), 'utf8'))
const LIVE = fx('fixture-bn12-hackarm-1604.json')
const ENTRY = fx('fixture-bn12-entry-dryrun.json')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))
const multOf = (r) => Number(/mult [\d.]+ -> ([\d.]+)/.exec(r?.best?.legs?.find((l) => l.leg === 'install cycles')?.detail ?? '')?.[1])
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

export async function run() {
  const checks = []
  const I = LIVE.exitinputs.inputs

  {
    const c = new Check('HC1', 'THE INCIDENT: the live BN12.7 inputs priced 3.7h on an unbounded shape (mult past x20 in three half-hour lives); bounded, the arm is no longer the incident')
    const un = X.bestExitPolicy({ ...I, shapeScaleMax: Infinity })
    const bd = X.bestExitPolicy(I)
    const s = X.cadenceShapeOf(I.cadenceShape, { cycleHours: I.cycleHours, multGainPerCycle: I.multGainPerCycle })
    const su = X.cadenceShapeOf(I.cadenceShape, { cycleHours: I.cycleHours, multGainPerCycle: I.multGainPerCycle, scaleMax: Infinity })
    c.examined(4)
    c.note(`hacking ${I.hacking}, cycle ${I.cycleHours}h, g x${I.multGainPerCycle.toFixed(4)}; shape scale unbounded ${f2(su?.scale)}, bounded ${f2(s?.scale)} (SHAPE_SCALE_MAX ${X.SHAPE_SCALE_MAX})`)
    c.note(`unbounded: ${f2(un.best?.hours)}h, install cycles mult -> ${f2(multOf(un))} (${un.best?.installsFirst} installs); bounded: ${f2(bd.best?.hours)}h, mult -> ${f2(multOf(bd))} (${bd.best?.installsFirst} installs)`)
    if (!(un.best?.hours < 4.5 && multOf(un) > 20)) c.fail(`the incident must reproduce unbounded (< 4.5h on a multiplier past x20): ${f2(un.best?.hours)}h, x${f2(multOf(un))}`)
    if (!(bd.best?.hours > 5.5)) c.fail(`bounded, the arm must not price the incident (> 5.5h): ${f2(bd.best?.hours)}h`)
    if (!(multOf(bd) < 10)) c.fail(`bounded, the install cycles must not reach x10 in half-hour lives: x${f2(multOf(bd))}`)
    const ln1 = s ? Math.log(I.multGainPerCycle * s.at(1)) : NaN
    const cap = X.SHAPE_SCALE_MAX * Math.max(...I.cadenceShape.ln.slice(0, 3))
    c.note(`the first shaped life: ln ${f2(ln1)} (bound ${f2(cap)}; unbounded ${f2(su ? Math.log(I.multGainPerCycle * su.at(1)) : NaN)})`)
    if (!(ln1 <= cap + 1e-9)) c.fail(`the first shaped life must be at most SHAPE_SCALE_MAX x the model's front: ln ${ln1} > ${cap}`)
    checks.push(c)
  }

  const rows = H.ROWS.map((r) => H.priceRow(r))
  {
    const c = new Check('HC2', "THE BOUND COVERS THE CALIBRATION: every finished hacking clear's record runs inside SHAPE_SCALE_MAX and prices exactly as unbounded; the bound sits within 10% of the largest such scale")
    const scaled = rows.filter((r) => Number.isFinite(r.scale))
    const maxS = Math.max(...scaled.map((r) => r.scale))
    c.examined(rows.length)
    c.note(`${scaled.length} shaped record(s), scales ${scaled.map((r) => `${r.clear} ${f2(r.scale)}`).join(', ')}; largest ${f2(maxS)}, bound ${X.SHAPE_SCALE_MAX}`)
    if (scaled.length < 5) c.fail(`the calibration must carry shaped records (${scaled.length})`)
    for (const r of rows) if (Number.isFinite(r.modelH) && Number.isFinite(r.oldH) && Math.abs(r.modelH - r.oldH) > 1e-6 * r.oldH) c.fail(`${r.clear} ${r.file}: the bound moved a calibrated record (${f2(r.oldH)}h -> ${f2(r.modelH)}h)`)
    if (!(X.SHAPE_SCALE_MAX >= maxS && X.SHAPE_SCALE_MAX <= 1.1 * maxS)) c.fail(`SHAPE_SCALE_MAX ${X.SHAPE_SCALE_MAX} must cover the largest calibrated scale ${f2(maxS)} and stay within 10% of it`)
    checks.push(c)
  }

  {
    const c = new Check('HC3', 'THE TABLE: the BN12.1 records priced against the hours BN12.1 actually ran from each to its clear (21.2h node); the shaped ones within x/÷2')
    const r12 = rows.filter((r) => r.clear === 'BN12.1')
    c.examined(r12.length)
    for (const r of r12) c.note(`${r.file.replace(/^fixture-|\.json$/g, '')}: hacking ${r.hacking}, L ${r.cycleHours}h, scale ${f2(r.scale)} — model ${f2(r.modelH)}h vs measured ${f2(r.measuredH)}h (ln ${f2(r.lnErr)})`)
    const shaped = r12.filter((r) => r.shaped)
    if (shaped.length < 3) c.fail(`the BN12.1 shaped records must be priced (${shaped.length})`)
    for (const r of shaped) if (!(Number.isFinite(r.lnErr) && Math.abs(r.lnErr) <= H.TOL_LN)) c.fail(`${r.file}: ${f2(r.modelH)}h vs ${f2(r.measuredH)}h is outside x/÷2`)
    checks.push(c)
  }

  {
    const c = new Check('HC4', "THE RULE: NODE_ROUTE_RULES[12] stays on unless the lift check holds (BN12.1 replay in band AND the arm's BN12 entry price above every measured Bladeburner clear)")
    const entry = H.entryOfDryrun(ENTRY)
    const lc = H.liftCheckOf({ rows, entry, blade: LIVE.bladeClears })
    const rule = RP.nodeRuleOf(12, null)
    c.examined(3)
    c.note(lc.why)
    if (!entry) c.fail('the entry dry-run fixture carries no BN12 entry hackH')
    if (!lc.lift && rule?.route !== 'blade') c.fail(`the rule is lifted while the criterion does not hold: ${lc.why}`)
    if (lc.lift) c.note('the criterion HOLDS on the committed data: lift NODE_ROUTE_RULES[12]')
    // the check is not constant: in band with an entry price above the clears it lifts; at or below it keeps
    const inBand = [{ clear: 'BN12.1', lnErr: 0.1 }, { clear: 'BN12.1', lnErr: -0.05 }]
    const yes = H.liftCheckOf({ rows: inBand, entry: { label: 'x', hackH: 9 }, blade: [{ hours: 7 }] })
    const no = H.liftCheckOf({ rows: inBand, entry: { label: 'x', hackH: 6.9 }, blade: [{ hours: 7 }] })
    const off = H.liftCheckOf({ rows: [...inBand, { clear: 'BN12.1', lnErr: 0.9 }], entry: { label: 'x', hackH: 9 }, blade: [{ hours: 7 }] })
    if (!(yes.lift === true && no.lift === false && off.lift === false)) c.fail(`the lift check must lift in band above the clears and keep otherwise: ${yes.lift} ${no.lift} ${off.lift}`)
    checks.push(c)
  }

  {
    const c = new Check('HC5', "WIRING: exitHours bounds the shape's scale at o.shapeScaleMax ?? SHAPE_SCALE_MAX; cadenceShapeOf takes the min")
    const ep = code('exitplan.js')
    c.examined(2)
    if (!/scaleMax: o\.shapeScaleMax \?\? SHAPE_SCALE_MAX/.test(ep)) c.fail('exitHours must pass scaleMax: o.shapeScaleMax ?? SHAPE_SCALE_MAX to cadenceShapeOf')
    if (!/const scale = Math\.min\(lnG \/ meanN,/.test(ep)) c.fail('cadenceShapeOf must bound the scale: Math.min(lnG / meanN, scaleMax)')
    checks.push(c)
  }

  {
    const c = new Check('HC6', 'THE BOUNDED SHAPE: every life at the bounded scale x its model ln, past the sequence too (the mean, scaled by the bound — never back at ln g); unbounded the total is the mean\'s, as before')
    const seq = [0.1, 0.02, 0, 0]
    const g = Math.exp(1) // ln g 1 over a model mean of 0.03: scale 33
    const s = X.cadenceShapeOf({ L: 1, ln: seq }, { cycleHours: 1, multGainPerCycle: g, scaleMax: 5 })
    const u = X.cadenceShapeOf({ L: 1, ln: seq }, { cycleHours: 1, multGainPerCycle: g, scaleMax: Infinity })
    const lnAt = (sh, i) => Math.log(g * sh.at(i))
    c.examined(3)
    c.note(`bounded: ${[1, 2, 3, 4, 5, 6].map((i) => lnAt(s, i).toFixed(3)).join(' ')}; unbounded: ${[1, 2, 3, 4, 5, 6].map((i) => lnAt(u, i).toFixed(3)).join(' ')}`)
    if (Math.abs(s.scale - 5) > 1e-12 || Math.abs(lnAt(s, 1) - 0.5) > 1e-9 || Math.abs(lnAt(s, 2) - 0.1) > 1e-9) c.fail('bounded, life j is priced at seq_j x the bound')
    if (Math.abs(lnAt(s, 6) - 5 * 0.03) > 1e-9) c.fail(`past the sequence a bounded life is the mean x the bound (0.15), not ln g: ${lnAt(s, 6)}`)
    const tot = [1, 2, 3, 4].reduce((a, i) => a + lnAt(u, i), 0)
    if (Math.abs(tot - 4) > 1e-9 || Math.abs(lnAt(u, 6) - 1) > 1e-9) c.fail(`unbounded the sequence's total is the mean's and past it ln g, as before: ${tot}, ${lnAt(u, 6)}`)
    checks.push(c)
  }
  return checks
}
