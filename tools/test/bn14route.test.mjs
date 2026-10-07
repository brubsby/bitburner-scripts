// THE BN14 ROUTE DECISION, replayed on the live 21:20Z pass (fixture-bn14-bladeroute-2120.json:
// plan.txt's posteriors and decisions.bladeRoute, /tel/exitinputs.txt, /tel/lifetimes.txt,
// /tel/go.txt). Live: decisions.bladeRoute kept 'blade' on a hack arm whose draws reached
// 3.4e78h (mean 1.4e77h, gain -1.4e77h, VOW 2.3e77h) — a degenerate exit passed on as a
// duration — and the hack arm priced BN14 with a cadence pooled from Bladeburner-route lives
// and without any of the Go node's mechanics.
//
//   GR1  a degenerate exit (> exitplan.DEGENERATE_H) is unpriced (null) in every no-count
//        trajectory, so the hack arm's stats stay finite on the published draws
//   GR2  the cadence posterior excludes Bladeburner-route lives (bayes regime 'blade'):
//        BN14's hack-route prior from BN9/BN6's hacking lives, not BN4's black-op lives
//   GR3  the w0r1d_d43m0n climb in exitplan is tools/sim/gameplan/go.mjs goWindow's first
//        passage (per game, W stepping) on a constant-rate climb, to 1e-6h
//   GR4  goplan.goExitInputsOf's g factor is 1 (the ASSUMED eps14 power, retired 2026-10-07):
//        the farm itself carries GoPower x SF14, priced per life in exitplan (gofarm.test GF*)
//   GR5  every Go term can only shorten the exit (w0 climb, Daedalus rep bonus, favor stream,
//        each later life's farm)
//   GR6  the decision replayed: corrected hack arm vs the published blade draws — finite
//        stats, the rule's own record, the key it takes (noted with the medians)
//   GR7  wiring: progress.js puts the Go terms and goCadenceMult in the exit inputs;
//        plan.applyDraw carries goCadenceMult into every drawn cadence

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const P = await import('plan.js')
const X = await import('exitplan.js')
const G = await import('goplan.js')
const F = await import('favor.js')
const GO = await import('../sim/gameplan/go.mjs')

const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn14-bladeroute-2120.json'), 'utf8'))
const fin = (x) => typeof x === 'number' && isFinite(x)
const ps = fx.plan.posteriors
const br = fx.plan.bladeRoute
const postOf = (cad) => ({ drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s }, gymSdLn: 0.1, cadence: cad, expPost: { perSec: ps.exp.perSec, sd: ps.exp.sdLn }, income: { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } })
const cadOld = { rate: { mean: Math.log(ps.cadence.lnPerHour), sd: ps.cadence.rateSdLn }, life: { mean: Math.log(ps.cadence.cycleHours), sd: ps.cadence.lifeSdLn }, own: { weight: 0 } }
const seed = P.seedOf(fx.plan.lastAugReset, 14)
const base = fx.exitinputs.inputs

export async function run() {
  const checks = []
  const traj = P.trajectoryOf(null, {})

  const c1 = new Check('GR1', 'a degenerate exit is unpriced (null), never a duration: the hack arm stays finite on the published draws')
  checks.push(c1)
  {
    c1.examined(1)
    if (!(Math.abs(br.margins?.[0]?.meanH ?? 0) > 1e70)) c1.fail('fixture: the published hack arm mean must be the 1e77h overflow it was captured for — the replay no longer tests what it claims')
    const draws = P.makeDraws(postOf(cadOld), br.n, seed)
    const hs = draws.map((d) => traj(P.applyDraw(base, d), d))
    const big = hs.filter((h) => fin(h) && h > X.DEGENERATE_H)
    const nulls = hs.filter((h) => h === null).length
    c1.examined(hs.length)
    c1.note(`as published: ${nulls} of ${hs.length} hack draws unpriced (degenerate), max priced ${Math.max(...hs.filter(fin)).toFixed(1)}h`)
    if (big.length) c1.fail(`${big.length} hack draws priced past DEGENERATE_H (${big[0].toExponential(2)}h) — passed on as durations`)
    if (!nulls) c1.fail('fixture: no degenerate draw any more (draw 7, ln(M) 0.006/h, was 3.4e78h)')
    const never = P.trajectoryOf({ kind: 'never' }, {})
    c1.examined(1)
    if (never(base) !== null) c1.fail(`'never' on BN14 (hacking 15000 at mult 0.55 with no install) priced ${never(base)}h — must be unpriced`)
  }

  const c2 = new Check('GR2', 'the cadence posterior excludes Bladeburner-route lives (they buy combat, not ln(hacking mult))')
  checks.push(c2)
  const cNew = X.installCadence(fx.lifetimes, 14)
  {
    c2.examined(1)
    c2.note(cNew.why)
    if (!/Bladeburner-route li/.test(cNew.why)) c2.fail('the posterior does not name the excluded Bladeburner-route lives')
    if (!(cNew.stats.lnPerHour > 1.5 * ps.cadence.lnPerHour)) c2.fail(`BN14's hack-route rate ${cNew.stats.lnPerHour.toFixed(4)}/h is not above the blade-pooled ${ps.cadence.lnPerHour.toFixed(4)}/h`)
    // Adding blade-route lives to a ledger must not move the posterior at all.
    const hackOnly = fx.lifetimes.filter((e) => !/on the Bladeburner route/.test(e.installWhy ?? ''))
    const c0 = X.installCadence(hackOnly, 14)
    c2.examined(1)
    // The blade lives' successors are only their own node's: BN6's last hacking life's successor IS a blade life, so its g changes — compare BN9-only.
    const bn9 = fx.lifetimes.filter((e) => e.bitNode === 9)
    const withBlade = [...bn9, ...fx.lifetimes.filter((e) => e.bitNode === 4)]
    const a = X.installCadence(bn9, 14)
    const b = X.installCadence(withBlade, 14)
    c2.examined(1)
    if (!(Math.abs(a.stats.lnPerHour - b.stats.lnPerHour) < 1e-12)) c2.fail(`BN4's blade-route lives moved BN14's rate ${a.stats.lnPerHour} -> ${b.stats.lnPerHour}`)
    c2.note(`hack-route lives only ${c0.stats.lnPerHour.toFixed(4)}/h; BN9 alone ${a.stats.lnPerHour.toFixed(4)}/h, + BN4's blade lives ${b.stats.lnPerHour.toFixed(4)}/h`)
  }

  const gx = G.goExitInputsOf({ goPower: 4, sf14: 0, goTel: fx.go, cycleHours: cNew.stats.cycleHours, ownWeight: cNew.weight, exitFaction: 'Daedalus', favorStreamOf: F.goFavorStreamOf })

  const c3 = new Check('GR3', "exitplan's w0r1d_d43m0n climb = go.mjs goWindow (first passage, W stepping per game) on a constant-rate climb")
  checks.push(c3)
  {
    const flat = { ...base, expScalesWithLevel: false, freshExpLagH: 0, finalRootCost: 0, cycleHours: 2.36, multGainPerCycle: 1.1167 }
    for (const [k, pph, s14] of [[10, 1570, 0], [25, 1570, 0], [10, 400, 1], [38, 2380, 0]]) {
      const w0 = { ...gx.go.w0, powerPerH: pph, sf14: s14 }
      const without = X.exitHours(flat, k)
      const withW = X.exitHours({ ...flat, go: { w0 } }, k)
      const leg = (r) => r.legs.find((l) => l.leg === 'climb to exit level')?.hours
      const L0 = leg(without)
      const ref = GO.goWindow({ L0, u0: flat.exitLevel / without.mult, w0: pph, s: 4 * (s14 ? 2 : 1), tau: 1 / w0.gamesPerH })
      c3.examined(1)
      c3.note(`${k} installs, w0 ${pph}/h${s14 ? ' SF14' : ''}: climb ${L0.toFixed(3)}h -> ${leg(withW).toFixed(4)}h (goWindow ${ref.hours.toFixed(4)}h, ${ref.games} games, W ${ref.W.toFixed(3)})`)
      if (!(Math.abs(leg(withW) - ref.hours) < 1e-6)) c3.fail(`${k} installs: exitplan ${leg(withW)}h vs goWindow ${ref.hours}h`)
    }
  }

  const c4 = new Check('GR4', "goExitInputsOf's g factor is 1 (eps14 retired); the farm carries GoPower and SF14 to exitplan's per-life channel")
  checks.push(c4)
  for (const [gp, s14, w] of [[4, 0, 0], [4, 1, 0.5], [1, 0, 1], [1, 1, 0]]) {
    const r = G.goExitInputsOf({ goPower: gp, sf14: s14, ownWeight: w })
    c4.examined(1)
    if (r.goCadenceMult !== 1) c4.fail(`GoPower ${gp} SF14 ${s14}: goCadenceMult ${r.goCadenceMult} (the eps power is retired)`)
    if (!(r.go?.farm?.goPower === gp && r.go.farm.sf14 === s14 && r.go.farm.embedded?.ownShare === w)) c4.fail(`GoPower ${gp} SF14 ${s14}: the farm must carry them and the own share ${w}`, JSON.stringify(r.go?.farm))
  }
  {
    const k = X.bestExitPolicy({ ...base, cycleHours: cNew.stats.cycleHours, multGainPerCycle: cNew.stats.multGainPerCycle, go: gx.go }).best.installsFirst
    const r = X.exitHours({ ...base, cycleHours: cNew.stats.cycleHours, multGainPerCycle: cNew.stats.multGainPerCycle, go: gx.go }, k)
    c4.examined(1)
    c4.note(`BN14.1 (GoPower 4, SF14 0), ${k} installs: ${r.go?.life ? `each later life ${r.go.life.now.plan} ln ${r.go.life.now.ln.toFixed(4)} less ${r.go.life.ownShare.toFixed(2)} x ${r.go.life.then.ln.toFixed(4)}: g x${Math.exp(r.go.life.ln).toFixed(4)}` : 'no later life'}`)
    // This pass measured no batch response (eRep 0, eBudget 0): no lift, the floor every other later-life lift takes.
    if (!(r.go?.life?.ln === 0)) c4.fail('with no measured batch response the farm lifts nothing (a floor, never a guess)', JSON.stringify(r.go))
    const r2 = X.exitHours({ ...base, cycleHours: cNew.stats.cycleHours, multGainPerCycle: cNew.stats.multGainPerCycle, go: gx.go, eRep: 0.0368 }, k)
    c4.note(`at BN9.2's measured eRep 0.0368: each later life ${r2.go?.life?.now?.plan} ln ${r2.go?.life?.now?.ln?.toFixed(4)}: g x${Math.exp(r2.go?.life?.ln ?? 0).toFixed(4)}`)
    if (k > 1 && !(r2.go?.life?.ln > 0)) c4.fail('at GoPower 4 with a measured eRep the farm must lift each later life', JSON.stringify(r2.go))
  }

  const c5 = new Check('GR5', 'every Go term only shortens the exit (BN14 point, corrected cadence)')
  checks.push(c5)
  const cad = { cycleHours: cNew.stats.cycleHours, multGainPerCycle: cNew.stats.multGainPerCycle }
  const point = (o) => P.hoursOrNull(X.bestExitPolicy(o))
  const h0 = point({ ...base, ...cad })
  const steps = [
    ['w0', { go: { w0: gx.go.w0 } }],
    ['+ Daedalus rep bonus', { go: { w0: gx.go.w0, rep: gx.go.rep } }],
    ['+ favor stream', { go: { w0: gx.go.w0, rep: gx.go.rep, favorStream: gx.go.favorStream } }],
    ["+ each later life's farm", { go: gx.go }],
  ]
  let prev = h0
  const row = [`none ${h0.toFixed(2)}h`]
  for (const [name, extra] of steps) {
    const h = point({ ...base, ...cad, ...extra })
    c5.examined(1)
    row.push(`${name} ${h.toFixed(2)}h`)
    if (!(fin(h) && h <= prev + 1e-9)) c5.fail(`${name}: ${prev}h -> ${h}h (a Go bonus lengthened the exit)`)
    prev = h
  }
  c5.note(row.join(', '))

  const c6 = new Check('GR6', 'the route decision replayed: corrected hack arm (cadence, Go terms) vs the published blade draws')
  checks.push(c6)
  {
    const inputs = { ...base, ...cad, go: gx.go, goCadenceMult: gx.goCadenceMult, multGainPerCycle: Math.exp(Math.log(cad.multGainPerCycle) * gx.goCadenceMult) }
    const draws = P.makeDraws(postOf(cNew.posterior), br.n, seed)
    const options = [
      { key: 'hack', noiseKey: P.noiseKeyOf(null, inputs), sim: (d) => traj(P.applyDraw(inputs, d), d) },
      { key: 'blade', noiseKey: 'bladeburner', sim: (d) => br.samples[d.i] },
    ]
    const d = P.decideAmong({ options, prev: { key: 'blade' }, draws, redecide: true, budgetMs: 1e9 })
    const o = Object.fromEntries((d.options ?? []).map((x) => [x.key, x]))
    c6.examined(3)
    c6.note(`-> ${d.key}: hack mean ${o.hack?.meanH}h q50 ${o.hack?.q50}h (q10 ${o.hack?.q10}, q90 ${o.hack?.q90}); blade mean ${o.blade?.meanH}h q50 ${o.blade?.q50}h; P(best) hack ${o.hack?.pBest}`)
    c6.note(String(d.why).slice(0, 300))
    if (!(fin(o.hack?.meanH) && o.hack.meanH < X.DEGENERATE_H)) c6.fail(`hack arm mean ${o.hack?.meanH} — not a duration`)
    if (fin(d.gainH) && Math.abs(d.gainH) > X.DEGENERATE_H) c6.fail(`paired gain ${d.gainH}h — overflow in the rule`)
    if (!(o.hack?.q50 < 150)) c6.fail(`corrected hack arm median ${o.hack?.q50}h — the cadence/Go corrections did not reach the arm (was 222h as published)`)
  }

  const c7 = new Check('GR7', 'wiring: the exit inputs carry the Go terms; every draw carries goCadenceMult')
  checks.push(c7)
  {
    const prog = fs.readFileSync(path.join(REPO_ROOT, 'progress.js'), 'utf8')
    const planSrc = fs.readFileSync(path.join(REPO_ROOT, 'plan.js'), 'utf8')
    for (const [src, re, what] of [
      [prog, /goExitInputsOf\(\{ goPower: bitNodeMults\(info\?\.currentNode\)\?\.GoPower/, 'exitInputsBaseOf builds goExitInputsOf from the node GoPower'],
      [prog, /go: goNow\.go,\s*goCadenceMult: goNow\.goCadenceMult,/, 'the inputs carry go and goCadenceMult'],
      [prog, /multGainPerCycle: [^\n]*goNow\.goCadenceMult/, 'the point cadence carries the g factor'],
      [planSrc, /const gm = fin\(inputs\.goCadenceMult\)/, 'applyDraw reads goCadenceMult'],
      [planSrc, /if \(!spec\) \{\s*return function\* \(x\) \{\s*return hoursOrNull\(yield\* bestExitPolicyGen\(x\)\)/, 'the default trajectory refuses a degenerate exit (trajectoryGenOf; trajectoryOf drains it)'],
    ]) {
      c7.examined(1)
      if (!re.test(src)) c7.fail(`${what} — not found`)
    }
    const d = P.makeDraws(postOf(cNew.posterior), 4, seed)
    const x = { ...base, cycleHours: 2.36, multGainPerCycle: 1.1, goCadenceMult: 1.2 }
    for (const di of d) {
      c7.examined(1)
      const a = P.applyDraw(x, di)
      const b = P.applyDraw({ ...x, goCadenceMult: 1 }, di)
      if (!(Math.abs(Math.log(a.multGainPerCycle) - 1.2 * Math.log(b.multGainPerCycle)) < 1e-9)) c7.fail(`draw ${di.i}: ln M ${Math.log(a.multGainPerCycle)} vs 1.2 x ${Math.log(b.multGainPerCycle)}`)
    }
  }
  return checks
}
