// [IL] THE INSTALL LOOP ON THE BLADEBURNER ROUTE — live BN4.3 2026-10-03.
//
// Lives 03:08:17Z (11.43h), 14:38:51Z (0.66h), 15:18:36Z. The 14:38Z install
// ran on a plan decision held from 14:28Z ('stays on committed: no
// alternative') while the gate's own fresh pricing read now 3.4h vs never
// 3.1h; the 15:18Z install (3 NeuroFlux levels) priced now 3.47h vs never
// 3.74h. Each new life then priced itself over the install's 'now' (EXIT JUMP
// AT INSTALL +1.04h, +0.89h): the $1262 after an install cannot pay the gym,
// the body step crimes for cash between legs (0.55h to the bar against the
// model's 0.33h), and zero rank is earned meanwhile. A new life's stats are
// the retrain's, so the next install looked nearly free: one every ~40 min.
//
// Fixture: tools/test/fixture-bn4-installloop-1518.json (tools/sim/exitjump/
// mkfix-bn4-1518.py; replay: tools/sim/exitjump/replay-bn4-1518.mjs).
//
//   IL1 REPLAY: on the captured 15:18Z state with the save's multipliers the black-op exit model
//       itself prices the 3-NFG install as a COST at every position of the daemon's skill clock
//       (the clock alone moves 'never' by ~0.4h — the margin the live decision acted on)
//   IL2 THE GUARD (installgate.bladeLoopGuardOf) on the live numbers: the 14:38Z install (fresh
//       comparison against it) and the 15:18Z install (young life, measured bias) hold; a clear
//       gain in an old life and a large one in a young life still install
//   IL3 shouldInstall on the blade route: the plan's 'install' is overridden by the guard, named
//   IL4 THE MEASURED BIAS: the ledger takes each install's first exit-jump sample once, per node,
//       and the bias is their mean
//   IL5 HEALTHCHECK INSTALL LOOP: the ledger of lives flags 14:39Z-15:19Z (0.67h), not the 11.4h life
//   IL6 WIRING: progress.js carries the ledger in plan.txt and passes the bias to the gate;
//       healthcheck runs installLoopOf

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const IG = await import('installgate.js')
const { installLoopOf } = await import('../bbhealth.mjs')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn4-installloop-1518.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

export async function run() {
  const checks = []

  // ---- IL1 --------------------------------------------------------------------
  const c1 = new Check('IL1', 'REPLAY: on the captured 15:18Z state the black-op exit model prices the 3-NFG install as a cost at every skill-clock position')
  checks.push(c1)
  const person = { skills: F.person1515.skills, exp: F.person1515.exp, mults: { ...F.mults } }
  const startFor = (spec, sks) => {
    const s0 = BB.bladeStartOf({ tel: F.tel, person, sleeves: F.sleeves, gymExpPerSec: F.gymExpPerSec, bnRank: 1, skillCostMult: 1, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: F.rankScale, successScale: F.successScale })
    s0.skillSinceS = sks
    return s0
  }
  const nevers = []
  for (const sks of [0, 1200, 2400, 3500]) {
    const never = BB.bladeExit(startFor({ kind: 'never' }, sks)).hours
    const now = BB.bladeExit(startFor({ kind: 'wait', waitH: 0, blade: { gains: F.nfg3 } }, sks)).hours
    nevers.push(never)
    c1.examined(2)
    c1.note(`skill clock ${sks}s: never ${never?.toFixed(3)}h, install now ${now?.toFixed(3)}h (${now - never >= 0 ? '+' : ''}${(now - never).toFixed(3)}h)`)
    if (!(typeof now === 'number' && typeof never === 'number')) c1.fail(`unpriced at skill clock ${sks}s`)
    else if (!(now > never)) c1.fail(`the 3-NFG install priced as a saving at skill clock ${sks}s (${now.toFixed(3)} < ${never.toFixed(3)})`)
  }
  c1.note(`'never' over the skill clock: ${Math.min(...nevers).toFixed(2)}-${Math.max(...nevers).toFixed(2)}h; live priced now ${F.live['1518'].nowH.toFixed(3)} vs never ${F.live['1518'].neverH.toFixed(3)} (a 0.27h margin inside that spread)`)

  // ---- IL2 --------------------------------------------------------------------
  const c2 = new Check('IL2', 'THE GUARD on the live numbers: 14:38Z and 15:18Z hold; a clear gain still installs')
  checks.push(c2)
  const g1438 = IG.bladeLoopGuardOf({ nowH: F.live['1438'].nowH, neverH: F.live['1438'].neverH, biasH: null, lifeH: F.live['1438'].lifeH })
  const g1518 = IG.bladeLoopGuardOf({ nowH: F.live['1518'].nowH, neverH: F.live['1518'].neverH, biasH: F.live['1438'].jumpDiffH, biasWhy: 'the 14:38Z install', lifeH: F.live['1518'].lifeH })
  const g1518nb = IG.bladeLoopGuardOf({ nowH: F.live['1518'].nowH, neverH: F.live['1518'].neverH, biasH: null, lifeH: F.live['1518'].lifeH })
  // An old life's saving must clear the bias AND the margin (BLADE_LOOP.minGainH, BN14.1 2026-10-04):
  // 1h saved against a 0.9h bias is 0.1h net — inside the margin, held; 2h saved installs.
  const gOldThin = IG.bladeLoopGuardOf({ nowH: 2.0, neverH: 3.0, biasH: 0.9, lifeH: 5 })
  const gOld = IG.bladeLoopGuardOf({ nowH: 2.0, neverH: 4.0, biasH: 0.9, lifeH: 5 })
  const gYoungBig = IG.bladeLoopGuardOf({ nowH: 2.0, neverH: 3.0, biasH: 0.2, lifeH: 0.3 })
  const gNoNever = IG.bladeLoopGuardOf({ nowH: 2.0, neverH: null, lifeH: 5 })
  c2.examined(7)
  for (const [n, g, want] of [['14:38Z', g1438, false], ['15:18Z', g1518, false], ['15:18Z, no bias', g1518nb, false], ['old life, 1h saving, 0.9h bias (0.1h net, inside the margin)', gOldThin, false], ['old life, 2h saving, 0.9h bias', gOld, true], ['young life, 1h saving, 0.2h bias', gYoungBig, true], ['never unpriced', gNoNever, null]]) {
    c2.note(`${n}: ok ${g.ok} — ${g.why}`)
    if (g.ok !== want) c2.fail(`${n}: ok ${g.ok}, want ${want}`, g.why)
  }

  // ---- IL3 --------------------------------------------------------------------
  const c3 = new Check('IL3', "shouldInstall on the blade route: the plan's 'install' is overridden by the guard, and the override is named")
  checks.push(c3)
  const bayes = { key: 'now', install: true, H: F.live['1518'].nowH, held: false, why: 'stays on now' }
  const base = { exitCompare: { route: 'blade', nowH: F.live['1518'].nowH, neverH: F.live['1518'].neverH, waits: [], bayes }, bladeRoute: true, ageMs: F.live['1518'].lifeH * 3.6e6, M: 1.048, queued: 3, exp: 7.7e6, target: 9000, rho: 0.066 }
  const held = IG.shouldInstall({ ...base, bladeInstallBiasH: F.live['1438'].jumpDiffH, bladeInstallBiasWhy: 'the 14:38Z install' })
  const go = IG.shouldInstall({ ...base, ageMs: 5 * 3.6e6, exitCompare: { ...base.exitCompare, nowH: 2.0, neverH: 3.5 }, bladeInstallBiasH: 0.9 })
  c3.examined(2)
  c3.note(`15:18Z: install ${held.install} — ${String(held.why).slice(0, 220)}`)
  c3.note(`old life, 1.5h saving, 0.9h bias: install ${go.install} — ${String(go.why).slice(0, 160)}`)
  if (held.install !== false) c3.fail('the 15:18Z install must hold under the guard', held.why)
  if (!/INSTALL LOOP GUARD/.test(String(held.why)) || !/INSTALL LOOP GUARD/.test(String(held.planOverride))) c3.fail('the hold must be named (why and planOverride)', `${held.why} | ${held.planOverride}`)
  if (go.install !== true) c3.fail('a clear priced gain must still install', go.why)

  // ---- IL4 --------------------------------------------------------------------
  const c4 = new Check('IL4', "THE MEASURED BIAS: each install's first exit-jump sample once, per node; the bias is their mean")
  checks.push(c4)
  const ej = F.exitJump1518
  const l1 = IG.bladeInstallJumpsNext([{ at: '2026-10-03T14:38:49.295Z', node: 4, diffH: 1.041, what: 'point' }], ej, { node: 4, blade: true })
  const l2 = IG.bladeInstallJumpsNext(l1, ej, { node: 4, blade: true })
  const lHack = IG.bladeInstallJumpsNext([], ej, { node: 4, blade: false })
  const lOther = IG.bladeInstallJumpsNext([{ at: 'x', node: 6, diffH: 5 }], ej, { node: 4, blade: true })
  const b = IG.bladeInstallBiasOf(l2, { node: 4 })
  c4.examined(5)
  c4.note(`ledger ${JSON.stringify(l2)}; bias ${b.biasH}h — ${b.why}`)
  if (l1.length !== 2 || l1[1].diffH !== 0.894) c4.fail('the 15:18Z install must enter the ledger at +0.894h', JSON.stringify(l1))
  if (l2.length !== 2) c4.fail('the same install must not enter twice')
  if (lHack.length !== 0) c4.fail('an install off the blade route is not this ledger\'s')
  if (lOther.length !== 1 || lOther[0].node !== 4) c4.fail('another node\'s entries must not carry', JSON.stringify(lOther))
  if (!(Math.abs(b.biasH - (1.041 + 0.894) / 2) < 1e-3)) c4.fail(`bias ${b.biasH}, want the mean ${(1.041 + 0.894) / 2}`)
  if (IG.bladeInstallBiasOf([], { node: 4 }).biasH !== null) c4.fail('no ledger: the bias is unknown (null), not 0')

  // ---- IL5 --------------------------------------------------------------------
  const c5 = new Check('IL5', 'HEALTHCHECK INSTALL LOOP: the lives ledger flags the 0.67h life, not the 11.4h one')
  checks.push(c5)
  const at = Date.parse('2026-10-03T15:30:00Z')
  const loop = installLoopOf(F.lifetimes, { bitNode: 4, nowMs: at, lifeStartMs: F.lifeStartMs })
  const later = installLoopOf(F.lifetimes, { bitNode: 4, nowMs: at + 4 * 3.6e6, lifeStartMs: F.lifeStartMs })
  c5.examined(2)
  c5.note(loop.why)
  if (loop.short.length !== 1 || loop.short[0].lifeH > 0.7 || !loop.short[0].startAt.startsWith('2026-10-03T14:3')) c5.fail('the 14:38Z life (0.66h, ended by the 15:18Z install) must be flagged', JSON.stringify(loop))
  if (later.short.length) c5.fail('outside the window the check must clear', later.why)

  // ---- IL6 --------------------------------------------------------------------
  const c6 = new Check('IL6', 'WIRING: plan.txt carries the ledger, the gate gets the bias, healthcheck runs installLoopOf')
  checks.push(c6)
  const pj = SRC('progress.js')
  const hc = SRC('tools/healthcheck.mjs')
  c6.examined(4)
  if (!/bladeInstallJumps,\n/.test(pj) || !/const bladeInstallJumps = bladeLedgerOf\(pc, info\)/.test(pj)) c6.fail('progress.js must carry bladeInstallJumps in the plan record')
  if (!/bladeInstallBiasH: b\.biasH/.test(pj)) c6.fail('progress.js must pass bladeInstallBiasH to shouldInstall')
  if (!/installLoopOf\(Array\.isArray\(lt\)/.test(hc)) c6.fail('healthcheck must run installLoopOf on lifetimes.txt')
  if (!/bladeGuard\?\.ok !== false/.test(SRC('installgate.js'))) c6.fail('installgate must gate the blade install on the guard')
  return checks
}
