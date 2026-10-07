// [BG] THE SECOND BN14.1 INSTALL — live 2026-10-04 10:22:41Z: THE GO FARM'S
// COMBAT EFFECT.
//
// The install actor priced the next life at 33.46h (never 40.1h); the new
// life priced itself at 80.18h at 10:27:44Z: EXIT JUMP AT INSTALL +46.8h,
// with every input carried this time (success k 1.067 n 345, the fleet, the
// division). The cause is one multiplier neither price modelled: the Tetrads
// farm (go.js) held x2.61 on every combat LEVEL multiplier at 10:19Z
// (nodePower ~54k over the 8.8h life, BN14 GoPower 4 — Go/effects/effect.ts
// CalculateEffect), the install zeroed it (Go/Go.ts:34-47), and the exit
// model read player.mults as permanent. The actor carried x2.61 through the
// install; the new life froze its own x1.0 for 80h. The batch itself was
// exactly what was priced (13 = 13; the save moved by x1.10 str, x1.2705 dex,
// x1.32 exp once the Go effect is divided out).
//
// Fixture: tools/test/fixture-bn14-install-1022.json (tools/sim/exitjump/
// mkfix-bn14-1022.py; replay: tools/sim/exitjump/replay-bn14-1022.mjs).
//
//   BG1 THE CAUSE, REPLAYED: the actor's now/never and the new life's point reproduced on the
//       old model; zeroing the Go effect at the install alone carries > 35h of the 47h
//   BG2 THE FIX: with s0.goCombat (zeroed at the install, regrown at the farm's measured rate)
//       the actor's next life and the new life's own price agree inside the exit-jump tolerance
//   BG3 THE MODEL: no goCombat is the old model exactly; an install divides the effect out; the
//       regrowth only helps; a farm that does not grow changes nothing without an install
//   BG4 bladeGoCombatOf: the record read, measured / carried / prior rate (held whichever
//       opponent go.js is on this minute), stale and never-farmed named, another life or node refused
//   BG5 THE LEDGER: the 10:22Z jump is voided as a model artefact
//   BG6 WIRING: the plan's start carries goCombat into every Bladeburner exit and sleeve.js

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const GP = await import('goplan.js')
const IG = await import('installgate.js')
const R = await import('../sim/exitjump/replay-bn14-1022.mjs')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const fx = R.fx

export async function run() {
  const checks = []
  const COMBAT = ['strength', 'defense', 'dexterity', 'agility']

  // ---- BG1 --------------------------------------------------------------------
  const c1 = new Check('BG1', "THE CAUSE, REPLAYED: the live prices reproduced; the Go effect zeroed at the install carries > 35h of the jump")
  checks.push(c1)
  const aNow = R.meanOf({ ...R.A, install: R.nowSpec }).hours
  const aNever = R.meanOf(R.A).hours
  const nl = R.meanOf(R.N(1)).hours
  const goReset = { ...R.gains, ...Object.fromEntries(COMBAT.map((k) => [k, R.gains[k] / R.goPre])) }
  const aReset = R.meanOf({ ...R.A, install: { ...R.nowSpec, gains: goReset } }).hours
  c1.examined(4)
  c1.note(`old model: actor now ${aNow.toFixed(2)}h (live ${fx.installLast.batchCheck.pricedH}), never ${aNever.toFixed(2)}h (live 40.1), new life ${nl.toFixed(2)}h (live ${fx.live1027.pointH}); jump ${(nl - aNow).toFixed(2)}h (live +46.81h)`)
  c1.note(`the pre-install Go effect x${R.goPre.toFixed(3)} (n ${Math.round(R.nPre)}); the actor's now with it zeroed at the install: ${aReset.toFixed(2)}h (+${(aReset - aNow).toFixed(2)}h)`)
  if (!(Math.abs(aNow - fx.installLast.batchCheck.pricedH) < 2)) c1.fail(`the actor's now is not reproduced: ${aNow} vs ${fx.installLast.batchCheck.pricedH}`)
  if (!(Math.abs(aNever - 40.1) < 2)) c1.fail(`the actor's never is not reproduced: ${aNever} vs 40.1`)
  if (!(Math.abs(nl - fx.live1027.pointH) < 2)) c1.fail(`the new life's point is not reproduced: ${nl} vs ${fx.live1027.pointH}`)
  if (!(R.goPre > 2.4 && R.goPre < 2.8)) c1.fail(`the pre-install Go effect read off the levels should be ~x2.6: ${R.goPre}`)
  if (!(aReset - aNow > 35)) c1.fail(`zeroing the Go effect at the install should carry > 35h of the jump: ${aNow} -> ${aReset}`)
  // The batch was what was priced: the save's multipliers, the Go effect divided out.
  const goAt = (n) => GP.effectAt(n, GP.OPPONENTS.Tetrads.power, 4, 0)
  const go0955 = fx.multsPre0955.strength / (fx.multsPost1035.strength / goAt(fx.goStats1035.Tetrads.nodePower) / R.gains.strength)
  const dexMoved = fx.multsPost1035.dexterity / goAt(fx.goStats1035.Tetrads.nodePower) / (fx.multsPre0955.dexterity / go0955)
  if (!(Math.abs(dexMoved - R.gains.dexterity) < 1e-6 && fx.installLast.batchCheck.pricedN === fx.installLast.batchCheck.boughtN)) c1.fail(`the batch bought must be the batch priced: dex moved x${dexMoved} vs x${R.gains.dexterity}`)

  // ---- BG2 --------------------------------------------------------------------
  const c2 = new Check('BG2', "THE FIX: the Go effect zeroed at the install and regrown — the actor's next life and the new life's price agree")
  checks.push(c2)
  const tolH = fx.exitJump.first.checks[0].tolH
  c2.examined(2)
  for (const rate of [R.ratePre, 4906]) {
    const fNow = R.meanOf({ ...R.A, install: R.nowSpec, goCombat: R.goOf(R.goPre, rate) }).hours
    const fNever = R.meanOf({ ...R.A, goCombat: R.goOf(R.goPre, rate) }).hours
    const fNl = R.meanOf({ ...R.N(1), goCombat: R.goOf(1, rate) }).hours
    c2.note(`rate ${Math.round(rate)}/h: actor now ${fNow.toFixed(2)}h, never ${fNever.toFixed(2)}h, new life ${fNl.toFixed(2)}h: jump ${(fNl - fNow).toFixed(2)}h (tolerance ${tolH}h); the install's saving ${(fNever - fNow).toFixed(2)}h`)
    if (!(Math.abs(fNl - fNow) < tolH / 2)) c2.fail(`at ${Math.round(rate)}/h the two prices must agree within half the tolerance (${tolH / 2}h): ${fNow} vs ${fNl}`)
    if (!(fNl < 45)) c2.fail(`the new life on the fixed model rebuilds the farm: its exit should be far below the frozen 80h, got ${fNl}`)
    if (!(fNever - fNow < 3)) c2.fail(`the 10:22Z install should not price as a clear saving on the fixed model: ${fNever - fNow}h`)
  }

  // ---- BG3 --------------------------------------------------------------------
  const c3 = new Check('BG3', 'THE MODEL: the old model without goCombat; an install divides the effect out; regrowth only helps')
  checks.push(c3)
  c3.examined(4)
  const single = (o, extra = {}) => BB.bladeExit({ ...R.startOf(o), ...extra }).hours
  const base0 = single({ ...R.A, install: R.nowSpec })
  const flat = single({ ...R.A, install: null, goCombat: { ...R.goOf(R.goPre, 0) } })
  const flatNone = single({ ...R.A, install: null })
  // An install with the effect divided out by goCombat == the same install whose combat gains carry 1/effect.
  const viaGo = single({ ...R.A, install: R.nowSpec, goCombat: R.goOf(R.goPre, 0) })
  const viaGains = single({ ...R.A, install: { ...R.nowSpec, gains: goReset } })
  const slow = single({ ...R.N(1), goCombat: R.goOf(1, 2000) })
  const fast = single({ ...R.N(1), goCombat: R.goOf(1, 8000) })
  c3.note(`no install: goCombat with no growth ${flat?.toFixed(3)}h = none ${flatNone?.toFixed(3)}h; an install: goCombat zeroing ${viaGo?.toFixed(3)}h = gains/effect ${viaGains?.toFixed(3)}h (carried: ${base0?.toFixed(3)}h); regrowth 2000/h ${slow?.toFixed(2)}h vs 8000/h ${fast?.toFixed(2)}h`)
  if (flat !== flatNone) c3.fail('a farm that does not grow changes nothing without an install', `${flat} vs ${flatNone}`)
  if (!(Math.abs(viaGo - viaGains) < 1e-9)) c3.fail('the install must divide the Go effect out of the combat level multipliers, exactly', `${viaGo} vs ${viaGains}`)
  if (!(slow - fast > 5)) c3.fail('the regrowth must move the exit (2000/h vs 8000/h, > 5h apart)', `${fast} vs ${slow}`)
  const st = BB.bladeStartOf({ person: R.personPre, gymExpPerSec: 10, goCombat: null })
  const stBad = BB.bladeStartOf({ person: R.personPre, gymExpPerSec: 10, goCombat: { effect: null } })
  if ('goCombat' in st || 'goCombat' in stBad) c3.fail('an unread goCombat must leave the start without one (the old model)')

  // ---- BG4 --------------------------------------------------------------------
  const c4 = new Check('BG4', 'bladeGoCombatOf: the record, the rate and its source')
  checks.push(c4)
  const life = fx.lifeStartPreMs
  const now = Date.parse(fx.installLast.exits.commitment.at)
  const rec = { at: new Date(now - 60e3).toISOString(), bitNode: 14, lastAugReset: life, opponent: 'Tetrads', goPower: 4, sf14: 0, bonuses: { Tetrads: (R.goPre - 1) * 100, 'The Black Hand': 35.77 } }
  const m = BB.bladeGoCombatOf(rec, { node: 14, lastAugReset: life, now })
  const early = BB.bladeGoCombatOf({ ...rec, bonuses: { Tetrads: 26.455 }, lastAugReset: fx.lifeStartPostMs }, { node: 14, lastAugReset: fx.lifeStartPostMs, now: fx.lifeStartPostMs + 0.2 * 3.6e6, carried: { perHour: m.perHour, source: 'the 10:22Z life' } })
  const prior = BB.bladeGoCombatOf({ ...rec, bonuses: { Tetrads: 0 }, lastAugReset: fx.lifeStartPostMs }, { node: 14, lastAugReset: fx.lifeStartPostMs, now: fx.lifeStartPostMs + 0.1 * 3.6e6 })
  const other = BB.bladeGoCombatOf({ ...rec, opponent: 'The Black Hand' }, { node: 14, lastAugReset: life, now })
  const stale = BB.bladeGoCombatOf(rec, { node: 14, lastAugReset: life, now: now + 3.6e6 })
  // Nothing measured or carried and go.js not on Tetrads: no regrowth (the prior is a farm on Tetrads alone).
  const notFarming = BB.bladeGoCombatOf({ ...rec, opponent: 'The Black Hand', bonuses: { Tetrads: 0 }, lastAugReset: fx.lifeStartPostMs }, { node: 14, lastAugReset: fx.lifeStartPostMs, now: fx.lifeStartPostMs + 0.1 * 3.6e6 })
  const otherLife = BB.bladeGoCombatOf(rec, { node: 14, lastAugReset: life + 1, now })
  const otherNode = BB.bladeGoCombatOf(rec, { node: 4, lastAugReset: life, now })
  c4.examined(8)
  c4.note(`measured: ${m.why}`)
  c4.note(`early (0.2h, carried): ${early.why}`)
  c4.note(`prior: ${prior.why}`)
  c4.note(`another opponent: ${other.why}; stale: ${stale.why}; another life: ${otherLife.why}`)
  if (!(Math.abs(m.effect - R.goPre) < 1e-9 && Math.abs(GP.effectAt(m.nodes, 0.7, 4, 0) - m.effect) < 1e-6)) c4.fail('the effect and its nodePower must round-trip', JSON.stringify(m))
  if (!(Math.abs(m.perHour - m.nodes / ((now - life) / 3.6e6)) < 1e-6 && m.rateSource.startsWith('measured'))) c4.fail("the rate is this life's nodes over its age", JSON.stringify(m))
  if (!(Math.abs(m.perHour - 6127) < 150)) c4.fail(`the 10:22Z life's farm rate should read ~6.1k/h: ${m.perHour}`)
  if (!(early.perHour === m.perHour && early.rateSource.startsWith('carried'))) c4.fail('a life younger than GO_COMBAT.minAgeH must carry the last measured rate', JSON.stringify(early))
  if (!(prior.perHour === GP.POWER_PER_HOUR.Tetrads && prior.rateSource.startsWith('prior') && prior.effect === 1)) c4.fail('with nothing measured or carried: the prior, named', JSON.stringify(prior))
  // THE ARM OF THE MOMENT IS NOT A RATE (live BN9 2026-10-07 21:40-21:50Z, tools/test/bn9goarm.test.mjs): the measured rate is a time average over go.js's arms.
  if (!(other.perHour === m.perHour && other.effect === m.effect && other.rateSource === m.rateSource)) c4.fail("another opponent this minute: the life's measured rate still holds (a time average over the arms)", JSON.stringify({ other, m }))
  if (!(notFarming.perHour === 0 && notFarming.rateSource === 'not farming')) c4.fail('nothing measured or carried and go.js on another opponent: no regrowth, named', JSON.stringify(notFarming))
  if (!(stale.perHour === 0 && stale.effect > 1)) c4.fail('a stale record: the effect (it still resets) and no regrowth', JSON.stringify({ stale }))
  if (!(otherLife.effect === null && otherNode.effect === null && BB.bladeGoCombatOf(null).effect === null)) c4.fail('another life, another node or no record: unread, named')

  // ---- BG5 --------------------------------------------------------------------
  const c5 = new Check('BG5', 'THE LEDGER: the 10:22Z jump is voided as a model artefact')
  checks.push(c5)
  const at = fx.exitJump.install.at
  const led = IG.bladeInstallJumpsNext(fx.bladeInstallJumps, fx.exitJump, { node: 14, blade: true })
  c5.examined(2)
  c5.note(`void ${at}: ${IG.installVoidOf(at)?.why ?? 'none'}; the BN14 ledger after it: ${JSON.stringify(led)}`)
  if (!(IG.BLADE_JUMP_VOID.has(at) && IG.installVoidOf(at)?.why)) c5.fail(`${at} must be voided with a reason (installgate.BLADE_JUMP_VOIDS)`)
  if (led.some((x) => x.at === at)) c5.fail('the voided jump must leave the ledger', JSON.stringify(led))

  // ---- BG6 --------------------------------------------------------------------
  const c6 = new Check('BG6', "WIRING: the plan's start carries goCombat into every Bladeburner exit, and sleeve.js prices the same")
  checks.push(c6)
  const pj = SRC('progress.js')
  const slj = SRC('sleeve.js')
  const bbj = SRC('bbplan.js')
  c6.examined(5)
  if (!/const goCombat = bladeGoCombatOf\(readJson\(ns, '\/tel\/go\.txt'\)/.test(pj)) c6.fail('progress.js must read the farm from /tel/go.txt through bladeGoCombatOf')
  if (!/retrainSecsOf, goCombat \}\)/.test(pj)) c6.fail("progress.js's startFor must pass goCombat")
  if (!/goCombat: goCombat\.effect === null \?/.test(pj)) c6.fail("the plan's start must publish goCombat (sleeve.js and the next life read it)")
  if (!/goCombat: plan\?\.decisions\?\.bladeRoute\?\.start\?\.goCombat/.test(slj)) c6.fail("sleeve.js must price its fleet on the plan's goCombat")
  if (!/if \(goC\) \{\s*for \(const c of \['strength', 'defense', 'dexterity', 'agility'\]\) person\.mults\[c\] = lvMult\(c\) \/ goE/.test(bbj)) c6.fail("the install must divide the farm's effect out (bladeExitGen)")
  return checks
}
