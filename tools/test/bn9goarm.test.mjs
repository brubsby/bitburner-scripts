// [GA] EXIT UNSTABLE ON THE BLADEBURNER ROUTE — live BN9.2 2026-10-07: THE
// GO ARM OF THE MOMENT PRICED AS THE FARM'S RATE.
//
// The committed install (one install at 23:25:42Z, w2 when chosen at 21:25Z)
// was held with no event while its exit swung 15.1h (21:30Z) -> 29.3h
// (21:40Z) -> 15.1h (21:45Z) -> 24.9h (21:50Z): EXIT UNSTABLE -14.07h, then
// +9.86h; the day's exit series alternated the same way (the "PLAN
// MISCALIBRATED" structural error: lag-1 -0.49, X 8.2). The key never
// changed meaning — w1.75 -> w1.667 -> w1.583 is one install time on its
// remaining wait. What moved was one input: bbplan.bladeGoCombatOf zeroed the
// Tetrads farm's regrowth (s0.goCombat.perHour) whenever /tel/go.txt named
// another opponent, and go.js's Thompson arm switched Tetrads <-> Daedalus
// every few minutes (Daedalus@7 at 21:40:05Z, Tetrads@5 21:42-21:45:36Z,
// Daedalus@5 from 21:45:48Z). An install zeroes the effect (x2.435), so the
// committed install's exit is ~10h longer when nothing regrows it — and the
// install-vs-never choice inverts with it. The measured rate is this life's
// nodes over its age: a time average that already carries the hours go.js
// gives other opponents, so the arm of the minute is not a rate.
//
// Fixture: tools/test/fixture-bn9-goarm-2150.json (tools/sim/exitjump/
// mkfix-bn9-goarm-2150.mjs, a read-only capture).
//
//   GA1 CALIBRATION: the 21:50Z committed point reproduced from the capture on the
//       record's own goCombat (rate 0, 'not farming')
//   GA2 THE CAUSE: the rate alone (0 vs the farm's measured average) moves the committed
//       exit by > 8h and inverts install vs never
//   GA3 THE FIX: bladeGoCombatOf gives the same rate on the Tetrads and the Daedalus record,
//       so the committed exit and the decision are the same whichever arm go.js is on
//   GA4 STABILITY: the live pair 21:45Z -> 21:50Z through plan.exitStabilityOf fails on the
//       old rate and passes on the fixed one (the check itself unchanged)

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const PL = await import('plan.js')
const { drain } = await import('coop.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-goarm-2150.json'), 'utf8'))

const nm = bitNodeMults(9)
const P = fx.person.player
const lv = (m) => ({ ...m, strength: m.strength * nm.StrengthLevelMultiplier, defense: m.defense * nm.DefenseLevelMultiplier, dexterity: m.dexterity * nm.DexterityLevelMultiplier, agility: m.agility * nm.AgilityLevelMultiplier, charisma: m.charisma * nm.CharismaLevelMultiplier })
const person = { skills: P.skills, exp: P.exp, mults: lv(P.mults), city: P.city, money: P.money }
const br = fx.bladeRoute
const now = Date.parse(fx.at)
const retrainSecsOf = BP.retrainSecsOfFor({ node: nm, trainingMult: br.start.trainingMult ?? 1, flatPerSec: fx.inputs.flatIncomePerSec, holdS: BB.POLICY.retrainLegS, start: { cash: fx.inputs.money ?? P.money, city: P.city }, install: { cash: 1000, city: 'Sector-12' } })
const committed = { kind: 'wait', waitH: Math.max(0, (fx.install.installAt - now) / 3.6e6), blade: fx.install.spec.blade }
const startFor = (spec, goCombat) =>
  BB.bladeStartOf({ tel: fx.tel, person, sleeves: br.sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: br.calibration.rank.applied, successScale: br.calibration.success.applied, rankSdLn: br.calibration.rank.sdLn, successSdLn: br.calibration.success.sdLn, leanUntilH: br.lean?.untilH ?? null, retrainSecsOf, goCombat, now })
const meanOf = (spec, goCombat) => drain(BB.bladeExitMeanGen(startFor(spec, goCombat)))
// go.js's record of 21:51Z (Daedalus) and the same record on Tetrads (21:45Z's arm): only the arm differs.
const recOn = (opponent) => ({ ...fx.go, at: fx.at, opponent })

export async function run() {
  const checks = []

  // ---- GA1 --------------------------------------------------------------------
  const c1 = new Check('GA1', "CALIBRATION: the 21:50Z committed point reproduced on the record's own goCombat")
  checks.push(c1)
  const goLive = br.start.goCombat
  const live = meanOf(committed, goLive)
  c1.examined(1)
  c1.note(`committed ${fx.install.key}: ${live.hours.toFixed(3)}h vs the live ${fx.install.pointH}h (goCombat x${goLive.effect}, ${goLive.perHour}/h, ${goLive.rateSource})`)
  if (!(goLive.perHour === 0 && goLive.rateSource === 'not farming')) c1.fail('the fixture must carry the live record\'s zeroed rate', JSON.stringify(goLive))
  if (!(Math.abs(live.hours - fx.install.pointH) < 0.1)) c1.fail(`the live point is not reproduced: ${live.hours} vs ${fx.install.pointH}`)

  // ---- GA2 --------------------------------------------------------------------
  const c2 = new Check('GA2', "THE CAUSE: the farm's rate alone moves the committed exit > 8h and inverts install vs never")
  checks.push(c2)
  const lifeH = (now - fx.lastAugReset) / 3.6e6
  const measured = { ...goLive, perHour: goLive.nodes / lifeH }
  const c0 = live.hours
  const n0 = meanOf({ kind: 'never' }, goLive).hours
  const cM = meanOf(committed, measured).hours
  const nM = meanOf({ kind: 'never' }, measured).hours
  c2.examined(4)
  c2.note(`rate 0: committed ${c0.toFixed(2)}h, never ${n0.toFixed(2)}h; the farm's ${Math.round(measured.perHour)}/h: committed ${cM.toFixed(2)}h, never ${nM.toFixed(2)}h`)
  if (!(c0 - cM > 8)) c2.fail(`the rate should carry the swing (> 8h): ${c0} vs ${cM}`)
  if (!(n0 < c0 && cM < nM)) c2.fail('the arm of the moment should invert install vs never (the flip the decision rode)', JSON.stringify({ c0, n0, cM, nM }))

  // ---- GA3 --------------------------------------------------------------------
  const c3 = new Check('GA3', 'THE FIX: one rate whichever arm go.js is on this minute')
  checks.push(c3)
  const opts = { node: 9, lastAugReset: fx.lastAugReset, now }
  const onD = BB.bladeGoCombatOf(recOn('Daedalus'), opts)
  const onT = BB.bladeGoCombatOf(recOn('Tetrads'), opts)
  c3.examined(4)
  c3.note(`Daedalus record: ${onD.why}`)
  c3.note(`Tetrads record: ${onT.why}`)
  if (!(onD.perHour > 0 && onD.perHour === onT.perHour && onD.effect === onT.effect && onD.rateSource.startsWith('measured'))) c3.fail("the measured rate must not depend on the arm of the minute", JSON.stringify({ onD, onT }))
  const hD = meanOf(committed, onD).hours
  const hT = meanOf(committed, onT).hours
  const nD = meanOf({ kind: 'never' }, onD).hours
  const nT = meanOf({ kind: 'never' }, onT).hours
  c3.note(`committed ${hD.toFixed(3)}h / ${hT.toFixed(3)}h, never ${nD.toFixed(3)}h / ${nT.toFixed(3)}h (Daedalus / Tetrads)`)
  if (!(hD === hT && nD === nT)) c3.fail('the exits must be the same on either arm', JSON.stringify({ hD, hT, nD, nT }))
  if (!(Math.abs(onD.perHour - fx.prev.goCombat.perHour) / fx.prev.goCombat.perHour < 0.05)) c3.fail(`the rate should be the one the 21:45Z (Tetrads) pass published: ${onD.perHour} vs ${fx.prev.goCombat.perHour}`)

  // ---- GA4 --------------------------------------------------------------------
  const c4 = new Check('GA4', 'STABILITY: the live pair 21:45Z -> 21:50Z through plan.exitStabilityOf — the old rate fails, the fixed one passes')
  checks.push(c4)
  const recOf = (at, meanH, pointSeH, src) => ({ at, node: 9, lastAugReset: fx.lastAugReset, ver: 'x', events: [], exit: { meanH: +meanH.toFixed(3), source: src }, decisions: { install: { pointSeH } } })
  const prev = recOf(fx.prev.at, fx.prev.pointH, fx.prev.pointSeH, `install decision (${fx.prev.key}, Tetrads)`)
  const seOf = (goC) => drain(BB.bladeExitMeanGen(startFor(committed, goC))).sdH / Math.sqrt(BB.BLADE_ENSEMBLE.Q)
  const before = PL.exitStabilityOf(prev, recOf(fx.at, c0, seOf(goLive), 'old rate (Daedalus: 0)'))
  const after = PL.exitStabilityOf(prev, recOf(fx.at, hD, seOf(onD), 'fixed rate'))
  c4.examined(2)
  c4.note(`before: ${before.why}`)
  c4.note(`after: ${after.why}`)
  if (before.ok !== false) c4.fail('the old rate must reproduce the live EXIT UNSTABLE', JSON.stringify(before))
  if (after.ok !== true) c4.fail('the fixed rate must hold the committed exit within the check', JSON.stringify(after))
  return checks
}
