// THE COVENANT MANDATE IN THE ROUTE DECISION (backlog 17b; plan.decideBladeRouteGen `mandate`,
// progress.js covenantMandateOf -> bladeRouteOf). BN10.3 is played under the user's invariant (the
// 5th Covenant sleeve, $1e17, bought before the exit; endgame.js holds the exit until it lands), so
// the live route decision must price each route to "exit HOLDING the sleeve" — before this, L4's
// pricer compared the black-op exit against the World Daemon exit and could pick Bladeburner, after
// which the hold would wait on money the blade route never makes.
//
// Replayed on a BN10 ENTRY (tools/sim/nodechoice/hackexit.mjs freshInputs, the builder bladeroute
// and nextnode use) with the BN9 13:41 pass's structural draws (fixture-bn9-plancpu-1341.json) and a
// fresh BN10 division (BladeburnerRank 0.8, BitNode.tsx case 10).
//
//   MC1  the hacking arm carries the campaign: its point is the trajectory of the SAME inputs with
//        exitplan `covenant` (the $1e17 leg and the combat legs), and it is slower than without it
//   MC2  the Bladeburner arm is the black-op exit THEN the hacking arm's mandated trajectory, per draw
//        on the same draw: the record equals decideAmong on those two hand-built trajectories, and
//        the published lower estimate is the black-op exit + the mandate's marginal on the hacking arm
//   MC3  the decision moves: the fixture's faster route without the mandate is 'blade', with it 'hack'
//   MC4  a mandate that binds but is unpriced leaves both arms unpriced (held, never priced as absent)
//   MC5  the wiring (source guards): progress.js bladeRouteOf builds the mandate with
//        covenantMandateOf (covenantMandated, the next sleeve's price, covenantCombatHours) and passes
//        it to decideBladeRouteGen; the Simulacrum verdict prices against the black-op exit alone

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const P = await import('plan.js')
const BB = await import('bbplan.js')
const { makePacer } = await import('coop.js')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-plancpu-1341.json'), 'utf8'))
const ps = F.posteriors1341
const DRAWS = P.makeDraws({ drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s }, gymSdLn: 0.1, cadence: null, expPost: null, income: null }, P.PLAN.N, P.seedOf(1790660521043, 10))
const { freshInputs, defaultProfile } = await import('../sim/nodechoice/hackexit.mjs')
// BN10.3's entry: SF10.2 held (the level the mandate's target 5 is keyed on), the rest as the plan has them
const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [6, 3], [7, 2], [8, 1], [9, 3], [10, 2], [11, 1], [12, 1], [13, 2], [14, 3]]
const INPUTS = freshInputs({ node: 10, sf: SF, g: 0.0405, profile: defaultProfile({ cycleHours: 2.63 }) })
const COV = { cost: 1e17, joinMoney: 75e9, combatH: 2, member: false, sleeveExpPerSec: 0 }
const mults = { strength: 1.12, defense: 1.12, dexterity: 1.12, agility: 1.12, charisma: 1.12, strength_exp: 1.15, defense_exp: 1.15, dexterity_exp: 1.15, agility_exp: 1.15, charisma_exp: 1.15, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
const fresh = { skills: { hacking: 300, strength: 20, defense: 20, dexterity: 20, agility: 20, charisma: 20, intelligence: 131 }, exp: {}, mults }
const startAt = (cyc) => BB.bladeStartOf({ tel: null, person: fresh, sleeves: { infiltrate: 5, support: 0, fa: 0 }, gymExpPerSec: 37.661, bnRank: 0.8, install: cyc > 0 ? { everyH: cyc, firstH: cyc, combatGain: 1 } : null })
const BASIS = null

async function decide(mandate, prev = null) {
  const pacer = makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: async () => {} })
  return pacer.slices(P.decideBladeRouteGen({ base: INPUTS, traj: P.trajectoryOf(BASIS), basis: BASIS, bladeStartAt: startAt, prev, draws: DRAWS, redecide: true, budgetMs: 1e9, clock: pacer.cpuNow, mandate }), 'route')
}

export async function run() {
  const checks = []
  const none = await decide(null)
  const withM = await decide({ covenant: COV, why: 'test: the 5th sleeve mandated' })
  const traj = P.trajectoryOf(BASIS)
  const r3 = (x) => (typeof x === 'number' ? +x.toFixed(3) : x)

  const c1 = new Check('MC1', 'the hacking arm carries the Covenant campaign (exitplan covenant) and is slower for it')
  checks.push(c1)
  c1.examined(3)
  const hackCov = traj({ ...INPUTS, covenant: COV })
  const hackNo = traj(INPUTS)
  c1.note(`hacking arm: ${r3(hackNo)}h without the mandate, ${r3(hackCov)}h with it; the record's hackH ${withM.hackH}`)
  if (!(typeof hackCov === 'number' && hackCov > hackNo)) c1.fail(`the campaign must cost the hacking arm time ($1e17 leg): ${hackCov}h vs ${hackNo}h without`)
  if (r3(withM.hackH) !== r3(hackCov)) c1.fail(`the mandated record's hacking point ${withM.hackH}h is not the trajectory WITH the campaign (${r3(hackCov)}h) — the mandate left the hacking arm`)
  if (r3(none.hackH) !== r3(hackNo)) c1.fail(`without a mandate the hacking point ${none.hackH}h must be the plain trajectory ${r3(hackNo)}h`)

  const c2 = new Check('MC2', 'the Bladeburner arm is the black-op exit THEN the mandated hacking trajectory, on the same draws — the shared rule on two hand-built trajectories')
  checks.push(c2)
  c2.examined(4)
  const m = withM.mandate ?? {}
  c2.note(`blade: black-op exit ${m.bladeExitH}h + continuation ${m.contH}h = ${withM.bladeH}h (lower estimate ${m.lowerH}h, flips the points: ${m.flips}); without the mandate ${none.bladeH}h`)
  if (!(m.priced === true && r3(m.bladeExitH) === r3(none.bladeH))) c2.fail(`the black-op exit ${m.bladeExitH}h must be the unmandated blade arm ${none.bladeH}h (priced: ${m.priced})`)
  if (!(Math.abs(withM.bladeH - (m.bladeExitH + withM.hackH)) < 2e-3)) c2.fail(`blade arm ${withM.bladeH}h != black-op exit ${m.bladeExitH}h + the mandated hacking trajectory ${withM.hackH}h — the mandate left the Bladeburner arm`)
  if (!(Math.abs(m.lowerH - (m.bladeExitH + (withM.hackH - hackNo))) < 2e-3)) c2.fail(`lower estimate ${m.lowerH}h != black-op exit + the mandate's marginal on the hacking arm`)
  // the shared rule on hand-built trajectories (the record IS decideAmong on them)
  const Q = BB.BLADE_ENSEMBLE.Q
  const memo = new Map()
  const bladeOf = (d) => {
    const c0 = INPUTS.cycleHours
    const k = Math.round(Math.log(P.applyDraw(INPUTS, d).cycleHours / c0) / 0.25)
    const mem = BB.bladeMemberOfDraw(d, Q) ?? 0
    const key = `${k}|${mem}`
    if (!memo.has(key)) memo.set(key, BB.bladeExit(BB.bladeMemberOf(startAt(c0 * Math.exp(0.25 * k)), mem, Q)).hours)
    return memo.get(key)
  }
  const hackOf = (d) => traj(P.applyDraw({ ...INPUTS, covenant: COV }, d), d)
  const ref = P.decideAmong({ options: [{ key: 'hack', noiseKey: P.noiseKeyOf(BASIS, { ...INPUTS, covenant: COV }), sim: hackOf }, { key: 'blade', noiseKey: 'bladeburner', sim: (d) => bladeOf(d) + hackOf(d) }], draws: DRAWS, redecide: true, budgetMs: 1e9 })
  if (ref.key !== withM.key || !(Math.abs((ref.meanH ?? 0) - (withM.meanH ?? 0)) < 1e-6)) c2.fail(`decideBladeRouteGen chose '${withM.key}' (mean ${withM.meanH}), the shared rule on the hand-built trajectories '${ref.key}' (mean ${ref.meanH})`)

  const c3 = new Check('MC3', "the decision moves: 'blade' is the fixture's faster route without the mandate, 'hack' with it")
  checks.push(c3)
  c3.examined(2)
  c3.note(`without: hack ${none.hackH}h vs blade ${none.bladeH}h -> ${none.key}; with: hack ${withM.hackH}h vs blade ${withM.bladeH}h -> ${withM.key}`)
  if (none.key !== 'blade') c3.fail(`fixture: without the mandate the route must be 'blade' (got '${none.key}': hack ${none.hackH}h vs blade ${none.bladeH}h) — the replay no longer tests the 17b failure`)
  if (withM.key !== 'hack') c3.fail(`with the mandate the route is '${withM.key}' — the Bladeburner exit cannot buy the sleeve`)

  const c4 = new Check('MC4', 'a mandate that binds but is unpriced: both arms unpriced, the committed route held')
  checks.push(c4)
  c4.examined(2)
  const unp = await decide({ covenant: null, unpriced: true, why: 'test: combat legs unpriced' }, { key: 'hack', at: new Date().toISOString() })
  c4.note(`unpriced mandate: key ${unp.key}, unpriced ${JSON.stringify(unp.unpriced)}, mandate ${JSON.stringify(unp.mandate)}`)
  if (!(Array.isArray(unp.unpriced) && unp.unpriced.includes('hack') && unp.unpriced.includes('blade'))) c4.fail('an unpriced mandate must leave both arms unpriced (published)')
  if (unp.key !== 'hack' || unp.mandate?.unpriced !== true) c4.fail(`an unpriced mandate must hold the committed route and say so (key ${unp.key}, mandate.unpriced ${unp.mandate?.unpriced})`)

  const c5 = new Check('MC5', 'progress.js: bladeRouteOf prices the mandate (covenantMandateOf -> decideBladeRouteGen); the Simulacrum against the black-op exit')
  checks.push(c5)
  const prog = fs.readFileSync(path.join(REPO_ROOT, 'progress.js'), 'utf8')
  const fnAt = prog.indexOf('function covenantMandateOf(')
  const fnBody = fnAt >= 0 ? prog.slice(fnAt, prog.indexOf('\n}\n', fnAt)) : ''
  const guards = [
    [/mandate = covenantMandateOf\(ns, info, player, readFleet\(ns, info\)\)/.test(prog), 'bladeRouteOf builds the mandate with covenantMandateOf'],
    [/yield\* decideBladeRouteGen\(\{[^\n]*\bmandate \}\)/.test(prog), 'bladeRouteOf passes `mandate` to decideBladeRouteGen'],
    [/covenantMandated\(info\?\.currentNode, from, sfLevel\(info, 10\)\)/.test(fnBody), 'covenantMandateOf binds on sleeveplan.covenantMandated'],
    [/covenantSleeveCost\(from\)/.test(fnBody) && /covenantCombatHours\(/.test(fnBody) && /joinMoney: COVENANT\.joinMoney/.test(fnBody), "covenantMandateOf prices the next sleeve, the combat legs and the invite money"],
    [/withoutH: d\.mandate\?\.priced \? d\.mandate\.bladeExitH : d\.bladeH/.test(prog), 'the Simulacrum verdict prices against the black-op exit alone'],
  ]
  for (const [ok, what] of guards) {
    c5.examined(1)
    if (!ok) c5.fail(`progress.js: ${what} — not found`)
  }

  // MC6 THE COMBAT LEG AS THE ROUTE RUNS IT (live BN10.3 2026-10-18 11:35Z: combat 1-46, no augs, BN10's
  // level multiplier 0.4 -> covenantCombatHours 13674747338185746h, the mandate unpriced, both arms unpriced)
  const c6 = new Check('MC6', "the mandate's combat leg: live vs the final window, the faster; an absurd leg is never priced, an unpriced one names its cause")
  checks.push(c6)
  const sl = await import('sleeveplan.js')
  const { bitNodeMults } = await import('bitNodeMultipliers.js')
  const nm = bitNodeMults(10, 3)
  const lvm = (k) => 1.3 * nm[`${k[0].toUpperCase()}${k.slice(1)}LevelMultiplier`]
  const startP = { skills: { strength: 46, defense: 3, dexterity: 9, agility: 9 }, exp: { strength: 4566, defense: 91, dexterity: 282, agility: 282 }, mults: { strength: lvm('strength'), defense: lvm('defense'), dexterity: lvm('dexterity'), agility: lvm('agility'), strength_exp: 1.3, defense_exp: 1.3, dexterity_exp: 1.3, agility_exp: 1.3 } }
  const live = sl.covenantCombatHours(startP, null, 1)
  const leg = sl.covenantCombatLegOf(live)
  c6.examined(4)
  c6.note(`node start: live ${live?.hours?.toExponential(3)}h -> ${leg.hours}h (${leg.basis}): ${leg.why}`)
  if (!(live?.hours > sl.COVENANT_COMBAT_MAX_H)) c6.fail(`fixture: at BN10's node-start multipliers the live legs must read absurd (${live?.hours}h)`)
  if (leg.hours !== sl.COVENANT_COMBAT_FINAL.hours || leg.basis !== 'final window' || !/ABSURD/.test(leg.why)) c6.fail('node start: the leg is the final window\'s measured one, the absurd live value named', JSON.stringify(leg))
  const quick = sl.covenantCombatLegOf({ hours: 0.3 })
  if (quick.hours !== 0.3 || quick.basis !== 'live') c6.fail('a live leg shorter than the final window is the leg (the route trains now)', JSON.stringify(quick))
  const noFinal = sl.covenantCombatLegOf({ hours: 1e16 }, null)
  if (noFinal.hours !== null || noFinal.unpriced !== true || !/ABSURD/.test(noFinal.why)) c6.fail('no final-window leg and an absurd live one: UNPRICED, cause named (never the absurd value)', JSON.stringify(noFinal))
  const fnAt6 = prog.indexOf('function covenantMandateOf(')
  const body6 = fnAt6 >= 0 ? prog.slice(fnAt6, prog.indexOf('\n}\n', fnAt6)) : ''
  const ex = prog.indexOf('function covenantExitOf(')
  const exBody = ex >= 0 ? prog.slice(ex, prog.indexOf('\n}\n', ex)) : ''
  c6.examined(2)
  if (!/const leg = member \? null : covenantCombatLegOf\(legs\)/.test(body6) || /legs \? legs\.hours : null/.test(body6)) c6.fail('progress.js covenantMandateOf: the combat leg through covenantCombatLegOf, never the raw live hours')
  if (!/covenantCombatLegOf\(legs\)/.test(exBody) || /legs \? legs\.hours : null/.test(exBody)) c6.fail('progress.js covenantExitOf: the combat leg through covenantCombatLegOf, never the raw live hours')
  return checks
}
