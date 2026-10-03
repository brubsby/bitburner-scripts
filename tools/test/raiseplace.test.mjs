// [RP] EVERY RAISE-SIZED DAEMON GETS THE PLACEMENT GUARANTEE (raiseplace.js).
//
// Live BN4 2026-10-03: sleeve.js was absent from the 03:08Z install until
// 09:20Z. Only boot.js placed it, once; at 09:18Z it chose millenium-fitness,
// which batch.js had filled, and the raise was denied ("ns.ramOverride(49.75)
// returned 3.25"). The same boot started bb-lite.js on the-hub while
// bladeburner.js ran on rothman-uni. The bladeburner.js guarantee ([BF]) is
// now every raise-sized daemon's.
//
//   RP1 the copies agree: RAISED's price = each script's RAISE_CEILING = boot.js's raisesTo, its tier =
//       boot.js's; every raise-sized 'anywhere' entry in boot.js is in RAISED and has a watchdog entry with
//       its own place/onRunning; FREEABLE = batch.js's workers
//   RP2 watchdog.js on a mock game, the live 09:18Z shape: no host has sleeve.js's 49.75GB -> reserved on
//       one, batch.js (reservesOf) drains it, the next cycle places sleeve.js there at its raised price,
//       the reservation is released; bladeburner.js already running is left alone
//   RP3 a sleeve.js already running anywhere (placed by hand on omnitek, 09:20Z) is satisfied: no launch,
//       nothing reserved
//   RP4 a launch whose raise is denied is retried the next cycle
//   RP5 two daemons at once (sleeve.js and hashspend.js on a 64GB home): each reserves without taking the
//       other's block, both end up running at their raised prices
//   RP6 the healthcheck: SLEEVES NOT RUNNING / HASHSPEND NOT RUNNING after 15 min where the capability
//       exists and the tier admits them — not before, not without the capability, not below the tier
//   RP7 boot.js does not start bb-lite.js while bladeburner.js runs anywhere

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'
import { mockGame, drive, proc, workers, runningOn, INFO, BLADE_PLAN } from './bbfull.test.mjs'

const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const RP = await import('raiseplace.js')
const { raisedHealth } = await import('../raisehealth.mjs')

const SLEEVES = { ...INFO, ownedSF: new Map([...INFO.ownedSF, [10, 1]]) }
const BOTH = { ...INFO, ownedSF: new Map([...INFO.ownedSF, [10, 1], [9, 1]]) }
const recOf = (world, s) => JSON.parse(world.files['/tel/watchdog.txt'] || 'null')?.daemons?.[s] ?? null
const resOf = (world, s) => JSON.parse(world.files[RP.RAISED[s].file] || 'null')

/** batch.js's side of a cycle: honour every live reservation, let h/g/w finish, refill up to max minus what is reserved. */
const batchCycle = (info) => (cycle, world) => {
  const res = RP.reservesOf((f) => world.files[f], info, Object.keys(world.hosts), Date.now())
  world.seen = [...(world.seen ?? []), { cycle, res: res.map((r) => `${r.script}@${r.host}`) }]
  for (const [h, x] of Object.entries(world.hosts)) {
    if (h === 'home') continue
    x.procs = x.procs.filter((p) => !RP.FREEABLE.includes(p.filename))
    const usedNow = x.procs.reduce((a, p) => a + p.ram * p.threads, 0)
    const room = x.max - usedNow - RP.heldOn(res, h)
    if (room >= 1.75) x.procs.push(...workers(Math.floor(room / 1.75) * 1.75))
  }
}

export async function run() {
  const checks = []

  // ---- RP1 -----------------------------------------------------------------
  {
    const c = new Check('RP1', "the copies agree: RAISED, each script's RAISE_CEILING, boot.js's manifest, the watchdog's entries")
    const boot = SRC('boot.js')
    const wd = SRC('watchdog.js')
    // boot.js's STACK as data (homeblade's parser): every 'anywhere' entry that raises.
    const open = boot.indexOf('[', boot.indexOf('const STACK = ['))
    let depth = 0
    let STACK = null
    for (let i = open; i < boot.length; i++) {
      if (boot[i] === '[') depth++
      else if (boot[i] === ']' && --depth === 0) {
        STACK = new Function(`return ${boot.slice(open, i + 1)}`)()
        break
      }
    }
    const raisedInBoot = (STACK ?? []).filter((e) => e.where === 'anywhere' && e.raisesTo > 0).map((e) => [e.script, e.raisesTo, e.tier])
    c.examined(raisedInBoot.length)
    if (raisedInBoot.length < 3) c.fail(`RP1 found ${raisedInBoot.length} raise-sized entries in boot.js — the check is not looking`)
    for (const [s, gb, tier] of raisedInBoot) {
      const r = RP.RAISED[s]
      if (!r) {
        c.fail(`RP1 ${s} raises to ${gb}GB in boot.js and is not in raiseplace.RAISED — boot-only again`)
        continue
      }
      if (r.gb !== gb) c.fail(`RP1 ${s}: RAISED ${r.gb}GB vs boot.js raisesTo ${gb}GB`)
      if (tier !== r.tier) c.fail(`RP1 ${s}: RAISED tier ${r.tier} vs boot.js tier ${tier}`)
      const ceil = SRC(s).match(/const RAISE_CEILING = \(mult\) => ([\d.]+)/)
      if (!ceil || +ceil[1] !== r.gb) c.fail(`RP1 ${s}: RAISE_CEILING ${ceil?.[1]} vs RAISED ${r.gb}`)
      if (!new RegExp(`script: '${s.replace('.', '\\.')}',[\\s\\S]{0,200}place: \\(ns, hosts, rec\\) => raisedPlace\\(ns, hosts, rec, '${s.replace('.', '\\.')}'\\),\\s*onRunning: \\(ns, rec\\) => raisedRunning\\(ns, rec, '${s.replace('.', '\\.')}'\\)`).test(wd)) c.fail(`RP1 watchdog.js has no placement entry for ${s}`)
    }
    const wk = SRC('batch.js').match(/workers: \{ hack: '([^']+)', grow: '([^']+)', weaken: '([^']+)' \}/)
    if (!wk || JSON.stringify(wk.slice(1).sort()) !== JSON.stringify([...RP.FREEABLE].sort())) c.fail(`RP1 batch.js's workers ${wk?.slice(1)} != FREEABLE ${RP.FREEABLE}`)
    c.note(`raise-sized: ${raisedInBoot.map(([s, gb]) => `${s} ${gb}GB @${RP.RAISED[s]?.tier}GB`).join(', ')}`)
    checks.push(c)
  }

  // ---- RP2 -----------------------------------------------------------------
  {
    const c = new Check('RP2', "the live 09:18Z shape: sleeve.js reserved on a filled host, drained, placed at its raised price, released")
    const g = mockGame({
      info: SLEEVES,
      cycles: 4,
      between: batchCycle(SLEEVES),
      hosts: {
        home: { max: 128, procs: [proc('watchdog.js', 9), proc('stack.js', 100)] },
        'rothman-uni': { max: 128, procs: [proc('bladeburner.js', RP.RAISED['bladeburner.js'].gb), ...workers(34)] },
        'millenium-fitness': { max: 128, procs: workers(126) },
        omnitek: { max: 256, procs: [proc('stock.js', 28.5), ...workers(226)] },
      },
    })
    const w = await drive(g)
    c.examined(5)
    const ex = w.execs.find((e) => e.script === 'sleeve.js')
    const first = w.seen?.[0]?.res ?? []
    if (!first.some((r) => r.startsWith('sleeve.js@'))) c.fail('RP2 cycle 1 did not reserve a host for sleeve.js', JSON.stringify({ seen: w.seen, state: recOf(w, 'sleeve.js')?.state }))
    if (!ex) c.fail('RP2 sleeve.js never placed', JSON.stringify({ seen: w.seen, state: recOf(w, 'sleeve.js')?.state, log: w.log }))
    const on = runningOn(w, 'sleeve.js')
    if (on.length !== 1 || w.hosts[on[0]].procs.find((p) => p.filename === 'sleeve.js')?.ram !== RP.RAISED['sleeve.js'].gb) c.fail('RP2 not exactly one sleeve.js at its raised price', JSON.stringify(on))
    if (resOf(w, 'sleeve.js')?.host !== null) c.fail('RP2 the reservation outlives the placement', JSON.stringify(resOf(w, 'sleeve.js')))
    if (w.execs.some((e) => e.script === 'bladeburner.js') || runningOn(w, 'bladeburner.js').join() !== 'rothman-uni') c.fail('RP2 the running bladeburner.js was disturbed', JSON.stringify(w.execs))
    c.note(`cycles ${JSON.stringify(w.seen)}; placed ${JSON.stringify(ex)}; watchdog '${recOf(w, 'sleeve.js')?.state}'`)
    checks.push(c)
  }

  // ---- RP3 -----------------------------------------------------------------
  {
    const c = new Check('RP3', 'a sleeve.js already running anywhere (by hand on omnitek) is satisfied')
    const w = await drive(mockGame({ info: SLEEVES, cycles: 2, hosts: { home: { max: 128, procs: [proc('stack.js', 100)] }, omnitek: { max: 256, procs: [proc('sleeve.js', 49.75)] }, 'millenium-fitness': { max: 128, procs: [] } } }))
    c.examined(2)
    if (w.execs.some((e) => e.script === 'sleeve.js')) c.fail('RP3 a running sleeve.js was placed again', JSON.stringify(w.execs))
    if (resOf(w, 'sleeve.js')?.host !== null || recOf(w, 'sleeve.js')?.absentSince) c.fail('RP3 a running sleeve.js holds a reservation or an absence clock', JSON.stringify({ res: resOf(w, 'sleeve.js'), rec: recOf(w, 'sleeve.js') }))
    checks.push(c)
  }

  // ---- RP4 -----------------------------------------------------------------
  {
    const c = new Check('RP4', 'a denied raise is retried the next cycle (boot.js tried once)')
    const g = mockGame({ info: SLEEVES, cycles: 3, between: (cy, world) => { world.hosts['millenium-fitness'].procs = world.hosts['millenium-fitness'].procs.filter((p) => !RP.FREEABLE.includes(p.filename)) }, hosts: { home: { max: 64, procs: [proc('stack.js', 60)] }, 'millenium-fitness': { max: 128, procs: workers(20) } } })
    const exec0 = g.ns.exec
    let first = true
    g.ns.exec = (s, h, t) => {
      if (s === 'sleeve.js' && first) {
        first = false
        g.world.hosts[h].procs.push(...workers(70)) // batch.js lands between the read and the raise
      }
      return exec0(s, h, t)
    }
    const w = await drive(g)
    const ex = w.execs.filter((e) => e.script === 'sleeve.js')
    c.examined(2)
    if (!w.log.some((l) => /sleeve\.js raise denied/.test(l))) c.fail('RP4 the first raise was not denied — the case is not reproduced', w.log.join('; '))
    if (ex.length < 2 || runningOn(w, 'sleeve.js').length !== 1) c.fail('RP4 not retried to a running sleeve.js', JSON.stringify({ ex, log: w.log }))
    c.note(`launches ${JSON.stringify(ex)}; ${w.log.filter((l) => /denied/.test(l)).join('; ')}`)
    checks.push(c)
  }

  // ---- RP5 -----------------------------------------------------------------
  {
    const c = new Check('RP5', 'two raise-sized daemons at once: each reserves without taking the other\'s block; both run at their raised prices')
    const g = mockGame({ info: BOTH, cycles: 4, between: batchCycle(BOTH), hosts: { home: { max: 64, procs: [proc('stack.js', 60)] }, 'the-hub': { max: 64, procs: workers(63) }, 'silver-helix': { max: 64, procs: workers(63) }, 'zer0': { max: 32, procs: workers(31) } } })
    const w = await drive(g)
    c.examined(3)
    for (const s of ['sleeve.js', 'hashspend.js']) {
      const on = runningOn(w, s)
      if (on.length !== 1 || w.hosts[on[0]].procs.find((p) => p.filename === s)?.ram !== RP.RAISED[s].gb) c.fail(`RP5 ${s} not running once at its raised price`, JSON.stringify({ on, seen: w.seen, state: recOf(w, s)?.state, log: w.log }))
    }
    if (w.log.some((l) => /raise denied/.test(l))) c.fail('RP5 a raise was denied — one reservation took the other\'s block', w.log.join('; '))
    c.note(`cycles ${JSON.stringify(w.seen)}; sleeve on ${runningOn(w, 'sleeve.js')}, hashspend on ${runningOn(w, 'hashspend.js')}`)
    checks.push(c)
  }

  // ---- RP6 -----------------------------------------------------------------
  {
    const c = new Check('RP6', 'SLEEVES NOT RUNNING / HASHSPEND NOT RUNNING after 15 min, only where the capability exists and the tier admits them')
    const T0 = Date.parse('2026-10-03T09:15:00Z')
    const iso = (m) => new Date(T0 - m * 60e3).toISOString()
    const state = { bitNode: 4, sourceFiles: [[10, 1], [9, 1]], home: { ram: 128 } }
    const wd = (s, m) => ({ at: iso(0.5), daemons: { [s]: { state: 'reserve: millenium-fitness ...', absentSince: iso(m) } } })
    const sleeveOld = { at: iso(370), health: 'stopped', bitNode: 4, result: 'stopped' }
    const fire = (o, label) => raisedHealth({ tel: { 'sleeve.txt': sleeveOld, 'hashspend.txt': { at: iso(1), health: 'ok', bitNode: 4, result: 'decided' } }, state, nowMs: T0, ...o }).fails.filter((f) => f.what.startsWith(label))
    const cases = [
      ['sleeve absent 370 min (the 03:08Z-09:20Z gap, watchdog clock)', { wd: wd('sleeve.js', 370) }, 'SLEEVES NOT RUNNING', 1],
      ['sleeve absent 5 min', { wd: wd('sleeve.js', 5) }, 'SLEEVES NOT RUNNING', 0],
      ['no Source-File 10', { wd: wd('sleeve.js', 370), state: { ...state, sourceFiles: [[9, 1]] } }, 'SLEEVES NOT RUNNING', 0],
      ['home under the 64GB tier', { wd: wd('sleeve.js', 370), state: { ...state, home: { ram: 32 } } }, 'SLEEVES NOT RUNNING', 0],
      ['sleeve.js reporting', { wd: wd('sleeve.js', 370), tel: { 'sleeve.txt': { at: iso(1), health: 'ok', bitNode: 4, result: 'assigned' } } }, 'SLEEVES NOT RUNNING', 0],
      ['hashspend reporting', { wd: wd('hashspend.js', 60) }, 'HASHSPEND NOT RUNNING', 0],
      ['hashspend absent (own snapshot)', { tel: { 'sleeve.txt': null, 'hashspend.txt': null }, prev: { bitNode: 4, 'hashspend.js': T0 - 20 * 60e3 } }, 'HASHSPEND NOT RUNNING', 1],
    ]
    for (const [label, o, name, n] of cases) {
      c.examined(1)
      const got = fire(o, name)
      if (got.length !== n) c.fail(`RP6 ${label}: ${name} fired ${got.length}, want ${n}`, JSON.stringify(got).slice(0, 300))
      else if (n) c.note(`${label}: ${got[0].what.slice(0, 170)}`)
    }
    c.examined(1)
    if (!/raisedHealth\(\{ tel: \{ "sleeve\.txt": readTel\("sleeve\.txt"\), "hashspend\.txt": readTel\("hashspend\.txt"\) \}, wd: tel\["watchdog\.txt"\] \?\? readTel\("watchdog\.txt"\), state, prev: prev\?\.raised/.test(SRC('tools/healthcheck.mjs')) || !/now\.raised = r\.snap/.test(SRC('tools/healthcheck.mjs'))) c.fail('RP6 healthcheck.mjs does not run raisedHealth with its previous snapshot')
    checks.push(c)
  }

  // ---- RP7 -----------------------------------------------------------------
  {
    const c = new Check('RP7', 'boot.js does not start bb-lite.js while bladeburner.js runs anywhere')
    const boot = SRC('boot.js')
    c.examined(2)
    const ent = boot.slice(boot.indexOf("script: 'bb-lite.js'"), boot.indexOf("script: 'bb-lite.js'") + 600)
    if (!/standsDownFor: 'bladeburner\.js'/.test(ent)) c.fail("RP7 boot.js's bb-lite.js entry does not stand down for bladeburner.js")
    if (!/if \(entry\.standsDownFor && hosts\.some\(\(host\) => ns\.hasRootAccess\(host\) && ns\.ps\(host\)\.some\(\(proc\) => proc\.filename === entry\.standsDownFor\)\)\) \{[\s\S]{0,160}continue/.test(boot)) c.fail('RP7 boot.js does not skip an entry whose standsDownFor is running')
    // The loop order: the guard sits before the placement, after the already-running check.
    const iRun = boot.indexOf('if (running.length) continue')
    const iGuard = boot.indexOf('if (entry.standsDownFor')
    const iPlace = boot.indexOf('const need = Math.max(entry.cost, entry.raisesTo ?? 0) * threads')
    if (!(iRun > 0 && iRun < iGuard && iGuard < iPlace)) c.fail('RP7 the stand-down guard is not between the running check and the placement')
    checks.push(c)
  }
  return checks
}
