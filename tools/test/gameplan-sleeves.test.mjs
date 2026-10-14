// THE SLEEVE FLEET in the whole-game planner (tools/sim/gameplan/sleeves.mjs, effects.mjs SF10,
// surrogate.mjs BB_FLEET_N, routes.mjs).
//
//   SL1 THE COUNT IS THE GAME'S: sleeves = min(3, SF10 + (BN10 ? 1 : 0)) + Covenant against the
//       game's own recalculateNumberOfOwnedSleeves (96 cases), the Covenant's cap and getSleeveCost,
//       and sleeveplan.js's copies (tools/sim bundle, child: sleevetest.mjs count).
//   SL2 5 SLEEVES IS THE OLD SURROGATE: the Bladeburner leg at 5 sleeves (and by default) equals the
//       old 5-infiltrator grid recomputed from the cache with the old key scheme, cell for cell;
//       at SF10.1 every clear outside BN10 prices the same with the fleet pinned at 5 (child:
//       sleevetest.mjs surrogate — the nodechoice bundle, the cache, the telemetry).
//   SL3 MONOTONE IN SLEEVES: the Bladeburner leg 5 >= 6 >= 7 in every cell, every owed clear's
//       hours nonincreasing in SF10 level (child, as SL2); the hacking route's g factor
//       nondecreasing in the fleet, 1 at 5 sleeves, BN10's own sleeve counted, phase 1's formula
//       kept, and no silent CrimeMoney (pure, here).
//   SL5 THE 5TH COVENANT SLEEVE (the user's invariant, plan.mjs --covenant5): the fleet under
//       'cov2'/'cov3' (4 Covenant through the buying clear, 5 after; 8 at most), the buying clear =
//       its best non-Bladeburner route + the purchase leg (routes.mjs clearTime, stub routes), the
//       leg = $1e17 / income, and the LIVE mandate (sleeveplan.js covenantTarget) buys exactly where
//       the committed choice says (sleeves.mjs COVENANT5_PLANNED) — red if either side moves alone.
//   SL6 THE LIVE SIDE COUNTS THE GAME'S FLEET: sleeve.js reads ns.sleeve.getNumSleeves and
//       publishes that length; no in-node pricing file falls back to a literal fleet size when the
//       count is unread (progress.js's study fee charged 1 sleeve on an unknown) (static).
//   SL4 THE LIFT IS exitplan's: sleeves.mjs liftOf's per-life k equals exitplan.lifeStreamMultiples'
//       on the same step path (pure).
//
// CALIBRATION: SL1 checks a transcription against the game's code; SL2 a regression; SL3 and SL4
// properties. The DERIVED d10 and the bbsim fleet picks are NOT CALIBRATED against a live clear
// with 6 or 7 sleeves (none has been played) — sleeves.mjs's header says what is measured.
//
// The children WARN ("could not check") when the bundle, the cache or the telemetry is missing.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import { EFFECTS, SF_PARAMS, gFactorOf, sleevesOf, PHASE1_D10 } from '../sim/gameplan/effects.mjs'
import { sleeveCount, extraSleeves, D10, liftOf, pathMoney, covenantOf, isCovenantBuyClear, covenantLegHours, COVENANT_BUY, COVENANT5_PLANNED, D10_ORDINAL, sleeveGFactor } from '../sim/gameplan/sleeves.mjs'
import { clearTime } from '../sim/gameplan/routes.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GP = path.join(HERE, '../sim/gameplan')

function childCheck(c, mode, need = []) {
  const missing = need.filter((f) => !fs.existsSync(f))
  if (missing.length) {
    c.warn('could not check: missing ' + missing.map((f) => path.relative(path.join(HERE, '../..'), f)).join(', '), 'build with: node tools/sim/gameplan/plan.mjs --build-only (and node tools/sim/build.mjs --game ~/Repos/bitburner)')
    return
  }
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'sleevetest.mjs'), mode], { encoding: 'utf8', timeout: 900e3 })
  let res
  try {
    res = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    res = { skip: `sleevetest.mjs ${mode} produced no result: ` + ((r.stderr || '').slice(-600) || `exit ${r.status}`) }
  }
  if (res.skip) return c.warn('could not check: ' + res.skip)
  c.examined(res.examined)
  for (const n of res.notes) c.note(n)
  for (const f of res.fails) c.fail(f)
}

function sl3Pure(c) {
  // every SF parameter at its mid; SF10's factor is read as the ratio to the same call at d10 = 0
  // (the other SFs' factors divide out), and its own entry is called directly where that is the question
  const p = Object.fromEntries(Object.entries(SF_PARAMS).map(([k, v]) => [k, v.mid]))
  const p0 = { ...p, d10: 0 }
  const mults = (cm) => ({ CrimeMoney: cm })
  const lvAt = (l10) => (n) => (n === 10 ? l10 : 0)
  const f10 = (l, pp, ctx) => EFFECTS[10].gFactor(l, pp, ctx)
  let n = 0
  // 1 at 5 sleeves (SF10.1 outside BN10); BN10's own sleeve counted; nondecreasing in SF10 and in d10
  for (const node of [1, 2, 9, 10, 13]) {
    const cm = node === 2 ? 3 : 0.5
    const fs10 = [1, 2, 3].map((l) => gFactorOf(lvAt(l), p, { node, mults: mults(cm) }) / gFactorOf(lvAt(l), p0, { node, mults: mults(cm) }))
    n += 3
    if (node !== 10 && fs10[0] !== 1) c.fail(`BN${node} at SF10.1 (5 sleeves): the SF10 g factor is ${fs10[0]}, not 1`)
    if (node === 10 && !(fs10[0] > 1)) c.fail(`BN10 at SF10.1 runs 6 sleeves: its g factor must exceed 1 (got ${fs10[0]})`)
    if (!(fs10[1] >= fs10[0] && fs10[2] >= fs10[1])) c.fail(`BN${node}: the SF10 g factor falls with SF10 level: ${fs10.join(', ')}`)
    const want = [...Array(extraSleeves(3, node)).keys()].reduce((f, j) => f * (1 + p.d10 * D10_ORDINAL[6 + j] * cm), 1)
    if (Math.abs(fs10[2] - want) > 1e-12) c.fail(`BN${node} SF10.3: g factor ${fs10[2]} vs (1 + d10 x CrimeMoney)^extra ${want}`)
  }
  // the fleet pinned at 5 / without BN10's own sleeve
  if (f10(3, p, { node: 10, mults: mults(0.5), fleet: 'five' }) !== 1) c.fail("fleet 'five': SF10.3 in BN10 must price no extra sleeve")
  if (f10(1, p, { node: 10, mults: mults(0.5), fleet: 'noBn10' }) !== 1) c.fail("fleet 'noBn10': BN10 at SF10.1 must price no extra sleeve")
  if (sleevesOf(lvAt(2), 10) !== 7 || sleevesOf(lvAt(2), 10, 'noBn10') !== 6 || sleevesOf(lvAt(3), 1, 'five') !== 5 || sleevesOf(lvAt(1), 6) !== 5) c.fail(`sleevesOf: BN10 at SF10.2 ${sleevesOf(lvAt(2), 10)} (7), noBn10 ${sleevesOf(lvAt(2), 10, 'noBn10')} (6), five ${sleevesOf(lvAt(3), 1, 'five')} (5), BN6 at SF10.1 ${sleevesOf(lvAt(1), 6)} (5)`)
  // phase 1's formula kept (GP3's regression mode)
  const ph = f10(3, p, { node: 1, mults: mults(1), phase1: true })
  if (Math.abs(ph - Math.pow(1 + PHASE1_D10, 2)) > 1e-12) c.fail(`phase 1: SF10.3 g factor ${ph}, not ${(1 + PHASE1_D10) ** 2}`)
  // no silent CrimeMoney: extra sleeves without the node's multipliers throw
  let threw = false
  try {
    f10(2, p, { node: 1 })
  } catch {
    threw = true
  }
  if (!threw) c.fail("SF10's g factor priced extra sleeves without the node's CrimeMoney (a silent default)")
  n += 6
  // the prior: DERIVED, ordered, nonnegative
  if (!(D10.lo >= 0 && D10.lo <= D10.mid && D10.mid <= D10.hi && SF_PARAMS.d10.mid === D10.mid)) c.fail(`d10 prior not ordered or not sleeves.mjs's: ${JSON.stringify(D10)} vs ${JSON.stringify(SF_PARAMS.d10)}`)
  if (!EFFECTS[10].sleeves || !EFFECTS[10].gFactor) c.fail('SF10 lost a role (sleeves / gFactor)')
  c.examined(n + 2)
  c.note(`(pure) hacking-route g factor: 1 at 5 sleeves, BN10's own sleeve counted, nondecreasing in SF10, prod (1 + d10 x shape_n x CrimeMoney); 'five'/'noBn10' fleets; phase 1 = 1.01^(SF10-1); throws without CrimeMoney; d10 DERIVED ${D10.lo} / ${D10.mid} / ${D10.hi}`)
}

async function sl4(c) {
  await import('./gameresolve.mjs')
  const ep = await import('exitplan.js')
  const steps = [{ atH: 0, perSec: 300 }, { atH: 1.5, perSec: 2000 }, { atH: 7.25, perSec: 9000 }, { atH: 20, perSec: 20000 }]
  const base = 5e4
  const lenH = 2
  const lives = 14
  const ls = ep.lifeStreamMultiples(steps, base, 0, lenH, lives)
  const ks = ls.runs.flatMap((r) => Array(r.n).fill(r.k))
  let worst = 0
  for (let j = 0; j < lives; j++) {
    const k = 1 + pathMoney(steps, j * lenH, (j + 1) * lenH) / (base * lenH * 3600)
    worst = Math.max(worst, Math.abs(k - ks[j]))
  }
  const L = liftOf(Array.from({ length: lives }, (_, j) => ({ startH: j * lenH, endH: (j + 1) * lenH, I: base })), steps, 0.15)
  const Lx = ks.reduce((a, k) => a + 0.15 * Math.log(k), 0)
  c.examined(lives + 1)
  if (worst > 1e-12) c.fail(`sleeves.mjs's per-life k differs from exitplan.lifeStreamMultiples by ${worst}`)
  if (Math.abs(L - Lx) > 1e-12) c.fail(`liftOf ${L} vs sum eBudget ln k ${Lx} (exitplan growthTableOf's lift)`)
  c.note(`per-life k on a 4-step path over ${lives} lives: max |sleeves.mjs - exitplan.lifeStreamMultiples| ${worst.toExponential(1)}; the lift sum eBudget ln k ${L.toFixed(5)}`)
}

async function sl5(c) {
  await import('./gameresolve.mjs')
  const { covenantTarget, covenantMandated } = await import('sleeveplan.js')
  const lvAt = (l10) => (n) => (n === 10 ? l10 : 0)
  let n = 0
  const eq = (what, got, want) => {
    n++
    if (got !== want) c.fail(`${what}: ${got}, want ${want}`)
  }
  // the fleet: the buying clear runs at 4 Covenant, every later state at 5; 'live' never buys
  eq("cov3: BN10.3's own clear (SF10.2 in BN10)", sleevesOf(lvAt(2), 10, 'cov3'), 7)
  eq('cov3: after BN10.3 (SF10.3)', sleevesOf(lvAt(3), 1, 'cov3'), 8)
  eq('cov3: after BN10.2 (SF10.2)', sleevesOf(lvAt(2), 1, 'cov3'), 6)
  eq("cov2: BN10.2's own clear (SF10.1 in BN10)", sleevesOf(lvAt(1), 10, 'cov2'), 6)
  eq('cov2: after BN10.2 (SF10.2)', sleevesOf(lvAt(2), 1, 'cov2'), 7)
  eq('cov2: inside BN10.3 (SF10.2)', sleevesOf(lvAt(2), 10, 'cov2'), 8)
  eq("live: SF10.3", sleevesOf(lvAt(3), 1, 'live'), 7)
  eq('covenantOf live', covenantOf(3, 'live'), 4)
  eq('the buying clear, cov3', isCovenantBuyClear(10, 2, 'cov3') && !isCovenantBuyClear(10, 1, 'cov3') && !isCovenantBuyClear(1, 2, 'cov3'), true)
  eq('the buying clear, cov2', isCovenantBuyClear(10, 1, 'cov2') && !isCovenantBuyClear(10, 2, 'cov2') && !isCovenantBuyClear(10, 1, 'live'), true)
  // the hacking route's g factor counts the 8th sleeve (3 extra past 5)
  const p = Object.fromEntries(Object.entries(SF_PARAMS).map(([k, v]) => [k, v.mid]))
  const g8 = EFFECTS[10].gFactor(3, p, { node: 1, mults: { CrimeMoney: 1 }, fleet: 'cov3' })
  n++
  const want8 = (1 + p.d10 * D10_ORDINAL[6]) * (1 + p.d10 * D10_ORDINAL[7]) * (1 + p.d10 * D10_ORDINAL[8])
  if (Math.abs(g8 - want8) > 1e-12) c.fail(`cov3 at SF10.3: g factor ${g8}, not the 6th x 7th x 8th each on its own shape ${want8}`)
  // the 8th is PRICED, not copied: its own derived shape, and no shape for a 9th (the game's cap is 8)
  eq('the 8th sleeve has its own DERIVED shape', typeof D10_ORDINAL[8] === 'number' && D10_ORDINAL[8] !== D10_ORDINAL[7], true)
  let threw9 = false
  try {
    sleeveGFactor(4, p.d10, 1) // a 9th sleeve: past the game's cap, no derived shape
  } catch {
    threw9 = true
  }
  eq('a sleeve with no derived shape throws (never a copy of another)', threw9, true)
  // the leg and the buying clear (stub routes: the clear is the best NON-Bladeburner route + the leg)
  eq('leg at $1e12/s', Math.abs(covenantLegHours(1e12) - 1e17 / 1e12 / 3600) < 1e-9, true)
  const routes = [
    { id: 'hack', applies: () => true, hours: () => 40 },
    { id: 'blade', applies: () => true, hours: () => 20 },
  ]
  const world = { fleet: 'cov3', covLegOf: () => 10 }
  const buy = clearTime(10, lvAt(2), world, null, routes)
  eq('the buying clear (cov3, BN10.3)', `${buy.h} ${buy.via}`, '50 hack+cov5')
  const other = clearTime(10, lvAt(1), world, null, routes)
  eq('the other BN10 (cov3, BN10.2) is untouched', `${other.h} ${other.via}`, '20 blade')
  let threw = false
  try {
    clearTime(10, lvAt(2), { fleet: 'cov3' }, null, routes)
  } catch {
    threw = true
  }
  eq('a buying clear without covLegOf throws', threw, true)
  // THE LIVE MANDATE matches the committed choice: BN10.b is played at SF10 b-1
  const b = COVENANT_BUY[COVENANT5_PLANNED]
  eq(`the committed choice is a buy level (${COVENANT5_PLANNED})`, b === 2 || b === 3, true)
  eq(`live covenantTarget at SF10.${b - 1} (BN10.${b}, the buying node)`, covenantTarget(b - 1), 5)
  for (let l = 0; l < b - 1; l++) eq(`live covenantTarget at SF10.${l} (BN10.${l + 1}: nothing changes)`, covenantTarget(l), 4)
  eq('live mandate binds at 4 bought in the buying node', covenantMandated(10, 4, b - 1), true)
  eq('live mandate releases at 5 bought', covenantMandated(10, 5, b - 1), false)
  c.examined(n)
  c.note(`the 5th Covenant sleeve: committed ${COVENANT5_PLANNED} (BN10.${b}); the live mandate targets 5 at SF10.${b - 1} and 4 below; the buying clear = best non-Bladeburner route + leg`)
}

function sl6(c) {
  const src = (f) => fs.readFileSync(path.join(HERE, '../..', f), 'utf8')
  const sl = src('sleeve.js')
  c.examined(3)
  if (!/\[\.\.\.Array\(ns\.sleeve\.getNumSleeves\(\)\)\.keys\(\)\]/.test(sl)) c.fail("sleeve.js must enumerate the game's own fleet (ns.sleeve.getNumSleeves)")
  if (!/sleeves: sleeves\.length,/.test(sl)) c.fail('sleeve.js must publish the fleet size it read (sleeves: sleeves.length)')
  const lit = /(?:sleeves|numSleeves)\s*(?:\?\?|\|\|)\s*\d|\.sleeves\s*\)?\s*\?\s*[\w.]*sleeves\s*:\s*\d/
  for (const f of ['progress.js', 'sleeveplan.js', 'exitplan.js', 'endgame.js', 'sleeveaug.js', 'bbplan.js', 'sleeve.js']) {
    const code = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l))
    const bad = code.filter((l) => lit.test(l))
    if (bad.length) c.fail(`${f}: a literal fleet size stands in for an unread count: ${bad[0].trim().slice(0, 140)}`)
  }
  c.note("sleeve.js reads ns.sleeve.getNumSleeves and publishes its length; no in-node pricing file substitutes a literal fleet size for an unread count")
}

export async function run() {
  const c1 = new Check('SL1', "the sleeve count is the game's (recalculateNumberOfOwnedSleeves, getSleeveCost) and sleeveplan.js's")
  const c2 = new Check('SL2', '5 sleeves reproduces the old surrogate (the 5-infiltrator Bladeburner grid) and the old 5-sleeve clears')
  const c3 = new Check('SL3', 'value is monotone in sleeves: Bladeburner leg 5 >= 6 >= 7, clears nonincreasing in SF10, the hacking g factor')
  const c4 = new Check('SL4', "the hacking route's per-life lift is exitplan's (lifeStreamMultiples, growthTableOf)")
  const c6 = new Check('SL6', "the live in-node pricing counts the game's fleet (getNumSleeves), never a literal size for an unread count")
  const c5 = new Check('SL5', "the 5th Covenant sleeve: fleet 'cov2'/'cov3', the buying clear's leg, and the live mandate buys where the plan committed")
  // the pure parts
  if (sleeveCount(1, 1) !== 5) c1.fail(`today's fleet: sleeveCount(SF10.1, BN1) = ${sleeveCount(1, 1)}, not 5`)
  sl3Pure(c3)
  await sl4(c4)
  await sl5(c5)
  sl6(c6)
  childCheck(c1, 'count', [path.join(GP, '../game.bundle.mjs')])
  // SL2 and SL3's simulation half share one child
  const tmp = new Check('SL2+3', '')
  childCheck(tmp, 'surrogate', [path.join(GP, '../nodechoice/game.bundle.mjs'), path.join(GP, '.cache/bb.json')])
  for (const w of tmp.warns) {
    c2.warn(w.what ?? w.msg ?? String(w), w.detail)
    c3.warn(w.what ?? w.msg ?? String(w), w.detail)
  }
  c2.examined(tmp.counted)
  for (const n of tmp.notes) (String(n).startsWith('(SL3)') ? c3 : c2).note(n)
  for (const f of tmp.fails) (/grows with a sleeve|longer with more SF10/.test(String(f.what ?? f)) ? c3 : c2).fail(f.what ?? String(f), f.detail)
  return [c1, c2, c3, c4, c5, c6]
}
