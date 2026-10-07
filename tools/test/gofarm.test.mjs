// [GF] THE GO FARM PRICED INSIDE THE HACKING EXIT — live BN9.2 2026-10-07 22:40Z.
//
// decisions.bladeRoute held 'blade' (13.8h) against the hacking route's exit
// "expected 58.34h later" (hack point 68.27h). The hacking exit credited the
// Go farm three ways: w0r1d_d43m0n on the post-Red-Pill climb at the
// 12,550/h prior, Daedalus on the final window's grind, and an ASSUMED
// elasticity on g — "g x1.005 (eps 0.12 ASSUMED, abar 0.551, own lives'
// share 0.86 excluded)". Each later life's own farm (node power from 0 at
// every install, Go/Go.ts:34-47) acting on that life's batch was not
// simulated at all, and g was measured on lives that played a weaker farm.
//
// Now (goplan.goExitInputsOf -> exitplan.goLifeLnOf): every later life farms
// the best arm or half-and-half pair of Daedalus / Netburners / The Black
// Hand / Illuminati from its install at the measured rates, CalculateEffect
// at the node's GoPower and SF14, on the streams each multiplies, through the
// planner's measured responses of a life's batch, go.js's RAM off the
// scripts; g is de-biased by the farm the cadence lives played
// (goplan.GO_EMBEDDED on their share); the final window prices Netburners
// on the rebuilt fleet against Daedalus from the install, the climb
// Illuminati against w0r1d_d43m0n (now at the harness's 30,174/h).
//
// Fixture: tools/test/fixture-bn9-gofarm-2240.json
// (tools/sim/exitjump/mkfix-bn9-gofarm-2240.mjs, a read-only capture).
//
//   GF1 CALIBRATION: the published hack point reproduced from the captured exit inputs
//   GF2 THE CHANNEL REPLACES THE ASSUMPTION: goExitInputsOf carries the farm, goCadenceMult 1,
//       nothing ASSUMED; w0 at the harness rate until go.js measures its own
//   GF3 THE COMPARISON: the hacking exit with the farm vs without it, on one set of inputs
//       that differ only in `go` (and the per-life channel alone: the farm vs no arms)
//   GF4 THE EFFECT IS THE GAME'S: CalculateEffect's Illuminati speeds at GoPower 1 x2, and a
//       life's mean bonus integrated as the time mean
//   GF5 DE-BIAS: g loses the cadence lives' own farm on their share, at their GoPower/SF14/rates
//   GF6 THE ARMS ARE SIMULATED: the best plan is the max over every plan; the final window's
//       two schedules and the climb's two arms are both priced and the sooner kept
//   GF7 THE ROUTE (reported): the hack arm on the new channel vs the published blade point
//   GF8 WIRING: progress.js passes the batcher's RAM; exitplan's cycles carry the lift

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const X = await import('exitplan.js')
const G = await import('goplan.js')
const F = await import('favor.js')
const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-gofarm-2240.json'), 'utf8'))

const live = fx.exitInputs.inputs
// The captured inputs carry the retired eps power inside g: taken back out.
const gRaw = Math.exp(Math.log(live.multGainPerCycle) / live.goCadenceMult)
const gx = G.goExitInputsOf({ goPower: fx.go.goPower, sf14: fx.go.sf14, goTel: fx.go, ownWeight: live.cadence.weight, exitFaction: 'Daedalus', favorStreamOf: F.goFavorStreamOf, fleetGB: fx.batchRam.total })
const base = { ...live, go: gx.go, goCadenceMult: gx.goCadenceMult, multGainPerCycle: gRaw }
const T = (x) => X.bestExitPolicy(x)
const H = (x) => T(x).best.hours
const at = (x) => X.exitHours(x, T(x).best.installsFirst)
const withFarm = (x, farm) => ({ ...x, go: { ...x.go, farm: { ...x.go.farm, ...farm } } })

export async function run() {
  const checks = []

  // ---- GF1 --------------------------------------------------------------------
  const c1 = new Check('GF1', 'CALIBRATION: the published hack point (decisions.bladeRoute.hackH) from the captured exit inputs')
  checks.push(c1)
  const h0 = H(live)
  const err = (h0 - fx.bladeRoute.hackH) / fx.bladeRoute.hackH
  c1.examined(1)
  c1.note(`hack arm ${h0.toFixed(3)}h vs the live ${fx.bladeRoute.hackH}h (priced ${fx.bladeRoute.pricedAt}, inputs ${fx.exitInputs.at}): ${(err * 100).toFixed(2)}%`)
  // The inputs were written 1.5s after the pass priced it (money and rates moved): 1% of a 68h exit.
  if (!(Math.abs(err) < 0.01)) c1.fail(`the live point is not reproduced: ${h0} vs ${fx.bladeRoute.hackH}`)

  // ---- GF2 --------------------------------------------------------------------
  const c2 = new Check('GF2', 'THE CHANNEL REPLACES THE ASSUMPTION: the farm in the inputs, goCadenceMult 1, nothing ASSUMED')
  checks.push(c2)
  const f = gx.go.farm
  c2.examined(4)
  c2.note(gx.go.why)
  if (gx.goCadenceMult !== 1) c2.fail(`goCadenceMult must be 1 (the eps power on ln g is retired): ${gx.goCadenceMult}`)
  if (/ASSUMED|eps14|\beps\b/.test(gx.go.why)) c2.fail('the farm is priced, not assumed: no eps in the record', gx.go.why)
  for (const k of G.GO_LIFE_ARMS) {
    const a = f?.arms?.[k]
    if (!(a && a.powerPerH === G.POWER_PER_HOUR[k] && a.bonusPower === G.OPPONENTS[k].power && a.channel === G.OPPONENTS[k].channel)) c2.fail(`arm ${k} must carry its measured rate, bonusPower and channel`, JSON.stringify(a))
  }
  if (!(f.goPower === fx.go.goPower && f.sf14 === fx.go.sf14)) c2.fail('the farm must carry the node GoPower and the SF14 level', JSON.stringify(f))
  if (!(Math.abs(f.ramShare - G.GO_RAM_GB / fx.batchRam.total) < 1e-12)) c2.fail(`go.js's RAM share must be ${G.GO_RAM_GB}GB of the batcher's ${fx.batchRam.total}GB`, f.ramShare)
  if (!(f.embedded.goPower === G.GO_EMBEDDED.goPower && f.embedded.sf14 === G.GO_EMBEDDED.sf14 && f.embedded.rateScale === G.GO_EMBEDDED.rateScale && f.embedded.ownShare === live.cadence.weight)) c2.fail('the embedded farm must be GO_EMBEDDED on the cadence\'s own weight', JSON.stringify(f.embedded))
  if (!(gx.go.w0.powerPerH === G.W0_HARNESS.powerPerHour)) c2.fail(`unmeasured w0 must price at the harness rate ${G.W0_HARNESS.powerPerHour}/h`, JSON.stringify(gx.go.w0))
  const meas = G.goExitInputsOf({ goPower: 1, sf14: 3, goTel: { w0: { rate: { pph: 22222, source: 'measured: 40 games' } } } })
  if (!(meas.go.w0.powerPerH === 22222)) c2.fail('a measured w0 rate must replace the harness one', JSON.stringify(meas.go.w0))

  // ---- GF3 --------------------------------------------------------------------
  const c3 = new Check('GF3', 'THE COMPARISON: the hacking exit with the Go farm vs without it, on shared inputs')
  checks.push(c3)
  const off = { ...base, go: null }
  const keys = new Set([...Object.keys(base), ...Object.keys(off)])
  const differ = [...keys].filter((k) => JSON.stringify(base[k]) !== JSON.stringify(off[k]))
  const hOn = H(base)
  const hOff = H(off)
  const noLife = withFarm(base, { arms: {} })
  const hNoLife = H(noLife)
  c3.examined(3)
  c3.note(`farm on ${hOn.toFixed(2)}h, off ${hOff.toFixed(2)}h: the farm is worth ${(hOff - hOn).toFixed(2)}h; the per-life channel alone (w0 and Daedalus kept) ${(hNoLife - hOn).toFixed(2)}h; the retired eps form (live) ${h0.toFixed(2)}h`)
  if (JSON.stringify(differ) !== '["go"]') c3.fail('the two runs must differ only in the choice (go)', JSON.stringify(differ))
  if (!(hOn < hOff)) c3.fail(`the farm must shorten the hacking exit: ${hOn} vs ${hOff}`)
  if (!(hOn < hNoLife)) c3.fail(`each later life's farm must shorten it: ${hOn} vs ${hNoLife} without the per-life arms`)
  if (!(hOn < h0)) c3.fail(`the explicit channel prices more than the eps it replaced on this node: ${hOn} vs ${h0}`)

  // ---- GF4 --------------------------------------------------------------------
  const c4 = new Check('GF4', "THE EFFECT IS THE GAME'S: CalculateEffect (effect.ts:16-22) at GoPower 1 x2, and a life's time mean")
  checks.push(c4)
  const want = [[2, 2.45], [5, 3.05], [10, 3.65]]
  for (const [h, x] of want) {
    const got = G.effectAt(G.POWER_PER_HOUR.Illuminati * h, G.OPPONENTS.Illuminati.power, 1, 3)
    c4.note(`Illuminati ${G.POWER_PER_HOUR.Illuminati}/h for ${h}h: hacking speed x${got.toFixed(3)}`)
    if (!(Math.abs(got - x) < 0.01)) c4.fail(`expected x${x} after ${h}h`, got)
  }
  // A flat level path (no exp): Kr is the time mean of the Daedalus bonus (midpoint vs Simpson).
  const plans = X.goLifePlansOf({ goPower: 1, sf14: 3, arms: { Daedalus: f.arms.Daedalus } }, { L: 2, mult: 1, expF: 0, expS: 0, expK: 0, fleet: [], flatPerSec: 0, incomeAtLevel1: 0 })
  const mean = G.meanEffect(G.POWER_PER_HOUR.Daedalus, G.OPPONENTS.Daedalus.power, 2, 1, 3)
  c4.examined(4)
  c4.note(`Daedalus over a 2h life: Kr ${plans[0].Kr.toFixed(4)} vs the time mean ${mean.toFixed(4)}`)
  if (!(Math.abs(plans[0].Kr / mean - 1) < 0.005)) c4.fail('the life\'s integration must be the time mean of the effect', JSON.stringify(plans))

  // ---- GF5 --------------------------------------------------------------------
  const c5 = new Check('GF5', "DE-BIAS: g loses the cadence lives' own farm on their share")
  checks.push(c5)
  const r = at(base)
  const life = r.go?.life
  const hNoDe = H(withFarm(base, { embedded: { ...f.embedded, ownShare: 0 } }))
  const hFull = H(withFarm(base, { embedded: { ...f.embedded, rateScale: 1 } }))
  c5.examined(3)
  c5.note(`each later life: ${life?.now?.plan} ln ${life?.now?.ln?.toFixed(4)} less ${life?.ownShare?.toFixed(3)} x the cadence lives' ${life?.then?.plan} ln ${life?.then?.ln?.toFixed(4)}: g x${Math.exp(life?.ln ?? 0).toFixed(4)}`)
  c5.note(`the exit: ${hOn.toFixed(2)}h; no de-bias ${hNoDe.toFixed(2)}h (an upper bound for the farm); de-biased at the full table rate ${hFull.toFixed(2)}h`)
  if (!life || !(Math.abs(life.ln - (life.now.ln - life.ownShare * life.then.ln)) < 1e-12)) c5.fail('g must be lifted by now - ownShare x then', JSON.stringify(life))
  if (!(life.ownShare === live.cadence.weight && life.then.ln > 0)) c5.fail('the cadence lives carried a farm (ln > 0) on the posterior\'s own weight', JSON.stringify(life))
  if (!(hNoDe <= hOn && hOn <= hFull)) c5.fail(`removing more of the embedded farm can only lengthen the exit: ${hNoDe} <= ${hOn} <= ${hFull}`)

  // ---- GF6 --------------------------------------------------------------------
  const c6 = new Check('GF6', 'THE ARMS ARE SIMULATED: the best plan, the final window\'s two schedules and the climb\'s two arms')
  checks.push(c6)
  const k = T(base).best.installsFirst
  const rep = X.exitHours({ ...base, goFinal: 'rep' }, k, true).hours
  const hn = X.exitHours({ ...base, goFinal: 'hacknet' }, k, true).hours
  const both = X.exitHours(base, k, true).hours
  c6.examined(4)
  c6.note(`at ${k} installs: Daedalus from the window's install ${rep.toFixed(3)}h, Netburners to the join then Daedalus ${hn.toFixed(3)}h -> ${both.toFixed(3)}h (${r.go?.final}); the climb on ${r.go?.climb}`)
  if (!(both === Math.min(rep, hn))) c6.fail('the final window must keep the sooner schedule', JSON.stringify({ rep, hn, both }))
  // goLifeLnOf's best is the max over every plan it prices.
  if (!life.now.plan.length || !(life.now.ln > 0)) c6.fail('a plan must be chosen and gain', JSON.stringify(life.now))
  // Without the hidden opponent, at that run's own best policy: the climb with Illuminati
  // against the same run with only Illuminati removed from the arms (the lives' plan unchanged).
  const noW0 = { ...base, go: { ...base.go, w0: null } }
  const kW = T(noW0).best.installsFirst
  const rNoW0 = X.exitHours(noW0, kW)
  const { Illuminati: _ill, ...others } = base.go.farm.arms
  const rNoIll = X.exitHours(withFarm(noW0, { arms: others }), kW)
  const climbOf = (x) => x.legs.find((l) => l.leg === 'climb to exit level')?.hours
  c6.note(`without w0r1d_d43m0n (its best: ${kW} installs): the climb on ${rNoW0.go?.climb} ${climbOf(rNoW0)?.toFixed(3)}h vs ${climbOf(rNoIll)?.toFixed(3)}h with no arm on it; with w0r1d_d43m0n ${climbOf(r)?.toFixed(3)}h`)
  if (r.go?.climb !== 'w0r1d_d43m0n') c6.fail('on the live inputs the hidden opponent wins the climb (its bonus is on the level, Illuminati\'s on the exp)', r.go?.climb)
  if (rNoW0.go?.life?.now?.plan !== rNoIll.go?.life?.now?.plan) c6.fail('the lives\' plan must not change with the climb arm', JSON.stringify([rNoW0.go?.life?.now, rNoIll.go?.life?.now]))
  if (!(rNoW0.go?.climb === 'Illuminati' && climbOf(rNoW0) < climbOf(rNoIll))) c6.fail('without w0, Illuminati must be priced on the climb and shorten it', JSON.stringify({ a: rNoW0.go?.climb, b: climbOf(rNoW0), c: climbOf(rNoIll) }))

  // ---- GF7 --------------------------------------------------------------------
  const c7 = new Check('GF7', 'THE ROUTE (reported): the hacking arm on the explicit channel vs the published blade point')
  checks.push(c7)
  c7.examined(1)
  c7.note(`hack ${hOn.toFixed(2)}h (was ${h0.toFixed(2)}h on the eps form; ${hOff.toFixed(2)}h with no farm) vs blade ${fx.bladeRoute.bladeH}h published (the blade arm does not read the hacking exit's Go terms)`)
  for (const l of r.legs) c7.note(`  ${l.leg}: ${l.hours.toFixed(2)}h`)
  if (!Number.isFinite(hOn)) c7.fail('the hacking arm must price')

  // ---- GF8 --------------------------------------------------------------------
  const c8 = new Check('GF8', "WIRING: progress.js passes the batcher's RAM; exitplan's later lives carry the lift")
  checks.push(c8)
  const prog = fs.readFileSync(path.join(REPO_ROOT, 'progress.js'), 'utf8')
  const ex = fs.readFileSync(path.join(REPO_ROOT, 'exitplan.js'), 'utf8')
  const pats = [
    [prog, /goExitInputsOf\(\{[^\n]*fleetGB: readJson\(ns, '\/tel\/batch\.txt'\)\?\.ram\?\.total/, "exitInputsBaseOf passes batch.txt's ram.total"],
    [ex, /const cycleAt = \(i, t\) => gCyc \*/, 'the powered cycles carry the Go lift'],
    [ex, /mult \*= gCyc \* liftBefore/, 'the walked cycles carry the Go lift'],
    [ex, /const gCyc = multGainPerCycle \* goGain/, 'gCyc is g times the farm'],
  ]
  c8.examined(pats.length)
  for (const [src, re, what] of pats) if (!re.test(src)) c8.fail(`${what}: ${re}`)
  return checks
}
