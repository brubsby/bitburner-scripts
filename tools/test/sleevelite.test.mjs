// SLEEVE-LITE: the sleeves while sleeve.js (49.75GB) has no host (sleeveliteplan.js, sleeve-lite.js).
//
//   SL1  liteStepOf: idle at the entry; the route's fleet at the join (blade, joined, a fresh routeFleet);
//        held once set; stands down while sleeve.js runs or once it assigned in this life; re-acts after
//        an install (a new life)
//   SL2  THE PREMISES, on the game's own Sleeve class: Sleeve.prestige leaves a sleeve on shock RECOVERY
//        (not idle); an idle sleeve banks its cycles (storedCycles) and replays them at 15 a tick — the
//        same shock after the catch-up as recovery from the start
//   SL3  THE COMPARISON (CLAUDE.md "Tests assert the comparison"): bbsim BN5.2, paired seeds — the fleet
//        at the join beats the fleet 3h after it (recovery until then), and idling at the entry (the bank)
//        beats recovery when the fleet is 3h late
//   SL4  wired: the watchdog JOB triggers on liteStepOf, sleeve-lite.js acts on it with setToIdle /
//        setToBladeburnerAction, progress.js prices routeFleet on the lite's count before sleeve.js runs
//
// Measured: sleeveliteplan.js header (tools/sim/bbboot.mjs --levers, 60 paired seeds).

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const sl = await import('sleeveliteplan.js')

export async function run() {
  const checks = []
  const node = 5
  const life = Date.parse('2026-10-24T18:00:00Z')
  const now = life + 2 * 3600e3
  const iso = (t) => new Date(t).toISOString()
  const rf = { config: { infiltrate: 3, support: 5, fa: 0 }, key: 'i3s5f0', n: 8, joined: true, lastAugReset: life, at: iso(now - 60e3), why: 'test' }
  const plan = (key, routeFleet = rf) => ({ node, decisions: { bladeRoute: { key, routeFleet } } })
  const blade = (joined) => ({ bitNode: node, joined })

  {
    const c = new Check('SL1', 'liteStepOf: idle at the entry, the fleet at the join, held once set, stands down for sleeve.js, re-acts in a new life')
    checks.push(c)
    const step = (o) => sl.liteStepOf({ node, lifeStart: life, now, n: 8, ...o })
    const expect = (name, got, act) => {
      c.examined(1)
      if (got.act !== act) c.fail(`${name}: act ${got.act}, want ${act}`, got.why)
    }
    expect('entry, nothing published', step({}), 'idle')
    expect('blade route before the join', step({ plan: plan('blade'), blade: blade(false) }), 'idle')
    const idleRec = { bitNode: node, lastAugReset: life, key: 'idle', n: 8, at: iso(now - 600e3) }
    expect('idle recorded this life', step({ rec: idleRec }), null)
    const f = step({ rec: idleRec, plan: plan('blade'), blade: blade(true) })
    expect('blade, joined, fresh routeFleet', f, 'fleet')
    c.examined(1)
    const acts = (f.tasks ?? []).map((t) => t?.action ?? null)
    if (acts.filter((a) => a === 'Infiltrate Synthoids').length !== 3 || acts.filter((a) => a === 'Support main sleeve').length !== 5) c.fail(`the fleet's tasks ${JSON.stringify(acts)} are not i3s5`)
    const fleetRec = { ...idleRec, key: f.key }
    expect('the fleet recorded', step({ rec: fleetRec, plan: plan('blade'), blade: blade(true) }), null)
    expect('a different routeFleet', step({ rec: fleetRec, plan: plan('blade', { ...rf, config: { infiltrate: 4, support: 4, fa: 0 } }), blade: blade(true) }), 'fleet')
    expect('a stale routeFleet holds the set fleet', step({ rec: fleetRec, plan: plan('blade', { ...rf, at: iso(now - 5 * 3600e3) }), blade: blade(true) }), null)
    expect('the route left blade: back to idle', step({ rec: fleetRec, plan: plan('hack'), blade: blade(true) }), 'idle')
    expect('a routeFleet from the last life', step({ rec: idleRec, plan: plan('blade', { ...rf, lastAugReset: life - 1 }), blade: blade(true) }), null)
    const running = { action: 'running', lastAugReset: life, at: iso(now - 30e3) }
    expect('sleeve.js running', step({ reserve: running, plan: plan('blade'), blade: blade(true) }), null)
    expect('a stale running record', step({ reserve: { ...running, at: iso(now - 3600e3) } }), 'idle')
    const assigned = { bitNode: node, result: 'assigned', at: iso(now - 60e3) }
    expect('sleeve.js assigned this life', step({ sleeveTel: assigned }), null)
    expect('sleeve.js assigned in the last life', step({ sleeveTel: { ...assigned, at: iso(life - 60e3) } }), 'idle')
    expect('sleeve.js assigned in another node', step({ sleeveTel: { ...assigned, bitNode: 13 } }), 'idle')
    expect('a new life (the install re-tasks every sleeve)', sl.liteStepOf({ node, lifeStart: life + 3600e3, now, n: 8, rec: idleRec }), 'idle')
    c.examined(3)
    if (sl.liteSleevesOf(idleRec, node) !== 8) c.fail(`liteSleevesOf(this node's record) = ${sl.liteSleevesOf(idleRec, node)}`)
    if (sl.liteSleevesOf({ ...idleRec, bitNode: 13 }, node) !== 0) c.fail('liteSleevesOf counts another node\'s record')
    if (sl.liteSleevesOf(null, node) !== 0) c.fail('liteSleevesOf(null) is not 0')
  }

  {
    const c = new Check('SL2', "the game's Sleeve: prestige leaves RECOVERY; an idle sleeve banks cycles and replays them at 15 a tick")
    checks.push(c)
    try {
      const { default: g } = await import('../sim/nodechoice/game.mjs')
      const P = new g.PlayerObject()
      g.setPlayer(P)
      const mk = () => {
        const s = new g.Sleeve()
        s.memory = 100
        s.prestige()
        return s
      }
      const a = mk()
      c.examined(1)
      if (a.currentWork?.type !== 'RECOVERY') c.fail(`after Sleeve.prestige the sleeve's work is ${a.currentWork?.type ?? 'idle'}, not RECOVERY: the 'idle at entry' premise in sleeveliteplan.js is wrong`)
      // b idles K cycles (banked), then recovers; a recovers from the start. Same total cycles -> same shock.
      const b = mk()
      b.stopWork()
      const K = 9000 // 30 min of ticks
      for (let i = 0; i < K; i++) b.process(1)
      c.examined(1)
      if (Math.abs(b.storedCycles - K) > 1e-9) c.fail(`an idle sleeve stored ${b.storedCycles} cycles over ${K} ticks (Sleeve.ts:267 banks every tick)`)
      b.shockRecovery()
      const ticks = Math.ceil(K / 14) + 20
      for (let i = 0; i < K + ticks; i++) a.process(1)
      for (let i = 0; i < ticks; i++) b.process(1)
      c.examined(1)
      c.note(`after ${(K / 18000).toFixed(2)}h idle + ${ticks} ticks: banked ${b.shock.toFixed(4)} vs recovering throughout ${a.shock.toFixed(4)} (stored left ${b.storedCycles})`)
      if (!(b.storedCycles < 15)) c.fail(`the bank was not spent within K/14 ticks: ${b.storedCycles} left`)
      // within the cycles still stored (< 15 each: Sleeve.process spends in chunks of 5..15) — 0.0003 x int bonus a cycle
      if (Math.abs(a.shock - b.shock) > 0.01) c.fail(`banked ${b.shock} != recovering throughout ${a.shock}: the replay is not the same work`)
      // and a sleeve that stays idle spends nothing: its shock does not move (no passive recovery without work)
      const z = mk()
      z.stopWork()
      for (let i = 0; i < 1800; i++) z.process(1)
      c.examined(1)
      if (z.shock !== 100) c.fail(`an idle sleeve's shock moved to ${z.shock} (Sleeve.ts:268 returns before any decay without work)`)
    } catch (e) {
      c.fail(`could not run the game's Sleeve: ${String(e?.stack ?? e).slice(0, 300)}`)
    }
  }

  {
    const c = new Check('SL3', 'bbsim BN5.2, paired seeds: the fleet at the join < the fleet 3h late (recovery); idle at the entry < recovery when 3h late')
    checks.push(c)
    try {
      const m = await import('../sim/bbboot.mjs')
      const cell = m.CELLS['BN5.2']
      const d1 = []
      const d2 = []
      for (const seed of [201, 202, 203]) {
        const run = (arm) => m.runOne({ ...cell, seed, maxH: 40, arm })
        const atJoin = run({})
        const late = run({ policy: { sleevesFromH: 3 } })
        const lateBank = run({ spec: { sleeveBank: true }, policy: { sleevesFromH: 3 } })
        c.examined(3)
        if (!(atJoin.hours > 0 && late.hours > 0 && lateBank.hours > 0)) {
          c.fail(`seed ${seed}: an arm did not finish (${atJoin.hours}, ${late.hours}, ${lateBank.hours})`)
          continue
        }
        d1.push(atJoin.hours - late.hours)
        d2.push(lateBank.hours - late.hours)
      }
      const mean = (x) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length)
      c.note(`at join - 3h late ${mean(d1).toFixed(2)}h; idle-banked 3h late - recovering 3h late ${mean(d2).toFixed(2)}h (seeds 201-203)`)
      if (!(mean(d1) < -0.3)) c.fail(`the fleet at the join vs 3h late: ${mean(d1).toFixed(3)}h (per seed ${d1.map((x) => x.toFixed(2)).join(', ')}) — the lite's fleet at the join is not priced as a win`)
      if (!(mean(d2) < -0.3)) c.fail(`idle at the entry vs recovery, fleet 3h late: ${mean(d2).toFixed(3)}h (per seed ${d2.map((x) => x.toFixed(2)).join(', ')}) — the bank (bbsim o.sleeveBank) is not modelled`)
    } catch (e) {
      c.fail(`bbsim threw: ${String(e?.stack ?? e).slice(0, 300)}`)
    }
  }

  {
    const c = new Check('SL4', 'wired: the watchdog JOB triggers on liteStepOf; sleeve-lite.js sets idle / the Bladeburner action; progress.js prices routeFleet on the lite count')
    checks.push(c)
    const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
    const wd = src('watchdog.js')
    const i = wd.indexOf("script: 'sleeve-lite.js'")
    const entry = i >= 0 ? wd.slice(i, wd.indexOf('\n  },', i)) : ''
    c.examined(1)
    if (!entry) c.fail("watchdog.js has no 'sleeve-lite.js' entry: nothing launches the lite")
    else {
      if (!/host:\s*'anywhere'/.test(entry)) c.fail('the sleeve-lite.js entry is not placed anywhere (15.25GB on a 128GB home)')
      if (!/trigger:[\s\S]*liteStepOf\(/.test(entry)) c.fail('the sleeve-lite.js trigger does not decide by liteStepOf')
      if (!/RAISED\['sleeve\.js'\]\.file/.test(entry)) c.fail("the trigger does not read the watchdog's own sleeve.js record (it would act beside a running sleeve.js)")
    }
    const act = src('sleeve-lite.js')
    c.examined(1)
    for (const k of ['liteStepOf(', 'ns.sleeve.setToIdle(', 'ns.sleeve.setToBladeburnerAction(', 'ns.sleeve.getNumSleeves(']) if (!act.includes(k)) c.fail(`sleeve-lite.js does not call ${k}`)
    const pr = src('progress.js')
    c.examined(1)
    if (!/const nSleeves = ours \?[^\n]*: liteSleevesOf\(/.test(pr)) c.fail("progress.js's nSleeves has no lite fallback: before sleeve.js runs no routeFleet is chosen and the lite has no fleet to set")
    const boot = src('boot.js')
    c.examined(1)
    if (!/script: 'sleeve-lite\.js',\s*\n\s*where: 'anywhere',\s*\n\s*kind: 'job'/.test(boot)) c.fail("boot.js's manifest does not budget sleeve-lite.js as an anywhere job (C10/C12 cover it from there)")
  }

  return checks
}
