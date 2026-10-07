// [BR] boot.js SEATS A PLANNED HOME RESIDENT, OR SAYS LOUDLY THAT IT DID NOT.
//
// Live BN9.2 entry 2026-10-07 13:21Z (and 01:30Z the same day): home 64GB,
// act.js's action slot 19.4GB, early.js x4 (9.6GB, seed.js's EVICTABLE worker)
// on home and settings.js (2.3GB one-shot) still finishing. boot.js measured
// 64 - 6.4 - 9.6 - 19.35 (torbuy/cmd/autobuy/backdoor) - 2.3 - 19.4 = 6.95GB
// for watchdog.js's 8.95GB, wrote "watchdog.js: planned 8.95GB but no host had
// it free" and exited — nothing revived scripts or ran jobs (the healthcheck's
// "shape that froze BitNode 10 for 4.5h"). `run watchdog.js` by hand worked.
//
//   BR1 raiseplace.homeResidentRoomOf on the live numbers: 6.95GB measured; ok once settings.js finishes
//       or early.js is evicted; evicts only what the shortfall needs; refuses when nothing would do
//   BR2 boot.js END TO END on a mock game in the live shape: watchdog.js starts on home, no failure for it,
//       nothing critical
//   BR3 settings.js never exits: boot.js stops waiting, evicts early.js on home ONLY (retire.js --host home;
//       the fleet's early.js keeps running) and starts watchdog.js
//   BR4 home held by non-evictable daemons: nothing is killed, watchdog.js is CRITICAL in /tel/boot.txt
//       (surviving the exit record), health 'error' before the exit, a CRITICAL terminal line
//   BR5 --dry: nothing evicted, nothing started, the would-be eviction reported
//   BR6 retire.js --host limits the kill to that host

import './gameresolve.mjs'
import { Check } from './harness.mjs'

const RP = await import('raiseplace.js')
const BOOT = await import('boot.js')
const RETIRE = await import('retire.js')

// Prices as /tel/boot.txt published them live (BN9.2, SF4 level in the price).
const RAM = {
  'boot.js': 6.4, 'seed.js': 7.8, 'homeup.js': 7.6, 'rfalink.js': 2.25, 'errlog.js': 2.25, 'torbuy.js': 2.45, 'cmd.js': 8.15,
  'autobuy.js': 4.15, 'backdoor.js': 4.6, 'settings.js': 2.3, 'tel.js': 6, 'watchdog.js': 8.95, 'buyserv.js': 9.6, 'hacknet.js': 11.4,
  'gang.js': 31.9, 'act.js': 7.8, 'sleeve.js': 3.25, 'stock.js': 28.6, 'hashspend.js': 3.25, 'bb-lite.js': 5.6, 'early.js': 2.4,
  'retire.js': 2.85, 'act-liquidate.js': 19.4, 'act-graft.js': 14, 'snap-static.js': 9.25, 'act-company.js': 8.25,
  'upkeep.js': 2.2, 'batch.js': 9.8, 'fast.js': 2.6, 'progress.js': 2.6, 'share.js': 4, 'go.js': 20.75, 'bootnag.js': 4.35,
  'nfg.js': 3.4, 'faction.js': 2.6, 'endgame.js': 3.2, 'ctauto.js': 22, 'sleeveaug.js': 37, 'bladeburner.js': 3.25, 'hgw.js': 1.75,
}
const ACTORS = ['act-liquidate.js', 'act-graft.js', 'act-company.js', 'snap-static.js']
const proc = (filename, threads = 1, ram = RAM[filename] ?? 2) => ({ filename, threads, ram, pid: Math.floor(Math.random() * 1e9) })
// Already running elsewhere at the live boot (not in its `started`), on a full fleet host.
const FLEET = ['seed.js', 'homeup.js', 'rfalink.js', 'errlog.js', 'tel.js', 'hacknet.js', 'act.js', 'hashspend.js', 'bb-lite.js'].map((s) => proc(s))
const fleetGb = FLEET.reduce((a, p) => a + p.ram, 0)

/**
 * A mock game for boot.main: `oneshotLife` = sleeps a one-shot lives (Infinity = hangs);
 * retire.js does its kill at the next sleep and exits. A fake clock moves 200ms a sleep.
 */
function mockGame({ home, fleet = [], oneshotLife = 1, args = [] }) {
  const world = {
    hosts: { home: { max: 64, procs: home }, 'omega-net': { max: Math.ceil(fleetGb + fleet.reduce((a, p) => a + p.ram * p.threads, 0)), procs: [...FLEET, ...fleet] } },
    files: { '/tel/stock.txt': JSON.stringify({ at: new Date().toISOString(), equity: 1e9 }) },
    log: [], execs: [], kills: [], spawned: null, exit: null, sleeps: 0, clock: 0,
  }
  const used = (h) => world.hosts[h].procs.reduce((a, p) => a + p.ram * p.threads, 0)
  let pid = 1000
  const ns = {
    args,
    disableLog() {},
    print() {},
    tprint: (m) => world.log.push(String(m)),
    atExit: (fn) => (world.exit = fn),
    read: (f) => world.files[f] ?? '',
    write: (f, d) => ((world.files[f] = String(d)), true),
    ls: (h, sub) => (h === 'home' ? ACTORS.filter((f) => f.includes(sub)) : []),
    scan: (h) => (h === 'home' ? ['omega-net'] : ['home']),
    hasRootAccess: () => true,
    nuke: () => true,
    ps: (h) => world.hosts[h].procs.map((p) => ({ filename: p.filename, threads: p.threads, pid: p.pid, args: p.args ?? [] })),
    getServerMaxRam: (h) => world.hosts[h].max,
    getServerUsedRam: (h) => used(h),
    getScriptRam: (s) => RAM[s] ?? 2,
    scp: () => true,
    exec: (s, h, threads = 1, ...a) => {
      const ram = RAM[s] ?? 2
      if (world.hosts[h].max - used(h) < ram * threads) return 0
      const p = { ...proc(s, threads, ram), pid: ++pid, args: a, born: world.sleeps }
      world.hosts[h].procs.push(p)
      world.execs.push({ script: s, host: h, args: a })
      return p.pid
    },
    spawn: (s, opts) => (world.spawned = { script: s, threads: opts?.threads }),
    sleep: async () => {
      world.sleeps++
      world.clock += 200
      for (const [h, x] of Object.entries(world.hosts)) {
        for (const r of x.procs.filter((p) => p.filename === 'retire.js')) {
          const at = r.args.indexOf('--host')
          const only = at >= 0 ? r.args[at + 1] : null
          const names = r.args.filter((v, i) => v.endsWith('.js') && i !== at + 1)
          for (const [hh, y] of Object.entries(world.hosts)) {
            if (only && hh !== only) continue
            for (const q of y.procs.filter((q) => names.includes(q.filename))) world.kills.push(`${q.filename} on ${hh}`)
            y.procs = y.procs.filter((q) => !names.includes(q.filename))
          }
          x.procs = x.procs.filter((p) => p !== r)
          void h
        }
        x.procs = x.procs.filter((p) => !(p.filename === 'settings.js' && world.sleeps - (p.born ?? 0) >= oneshotLife))
      }
    },
  }
  return { ns, world }
}

async function drive(game) {
  const realNow = Date.now
  const t0 = realNow()
  Date.now = () => t0 + game.world.clock
  try {
    await BOOT.main(game.ns)
  } finally {
    Date.now = realNow
  }
  game.world.record = JSON.parse(game.world.files['/tel/boot.txt'] || 'null')
  if (game.world.exit) game.world.exit()
  game.world.final = JSON.parse(game.world.files['/tel/boot.txt'] || 'null')
  return game.world
}

const liveHome = () => [proc('boot.js'), proc('early.js', 4)]
const on = (w, h, s) => w.hosts[h].procs.some((p) => p.filename === s)

export async function run() {
  const checks = []

  // ---- BR1 -------------------------------------------------------------------
  {
    const c = new Check('BR1', 'homeResidentRoomOf on the live 13:21Z numbers')
    const free = 64 - 6.4 - 9.6 - (2.45 + 8.15 + 4.15 + 4.6) - 2.3
    const procs = [{ script: 'boot.js', gb: 6.4 }, { script: 'early.js', gb: 9.6 }, { script: 'settings.js', gb: 2.3 }, { script: 'cmd.js', gb: 8.15 }]
    const cases = [
      ['live: settings.js finishing, early.js on home', { need: 8.95, free, action: 19.4, procs, transient: ['settings.js', 'retire.js'] }, (d) => !d.fits && d.ok && Math.abs(d.room - 6.95) < 1e-9 && d.wait.join() === 'settings.js' && d.stop.length === 0],
      ['settings.js no longer trusted to exit', { need: 8.95, free, action: 19.4, procs, transient: [] }, (d) => !d.fits && d.ok && d.stop.join() === 'early.js' && d.wait.length === 0],
      ['fits as measured', { need: 8.95, free: free + 2.3, action: 19.4, procs }, (d) => d.fits && d.ok && !d.stop.length],
      ['nothing would make room (only daemons on home)', { need: 8.95, free: 2, action: 19.4, procs: [{ script: 'cmd.js', gb: 8.15 }] }, (d) => !d.fits && !d.ok && !d.stop.length && /short of 8\.95GB/.test(d.why)],
      ['unpriced', { need: NaN, free, action: 19.4, procs }, (d) => !d.fits && !d.ok],
    ]
    for (const [label, o, ok] of cases) {
      c.examined(1)
      const d = RP.homeResidentRoomOf(o)
      if (!ok(d)) c.fail(`BR1 ${label}`, JSON.stringify(d))
      else c.note(`${label}: ${d.why}`)
    }
    checks.push(c)
  }

  // ---- BR2 -------------------------------------------------------------------
  {
    const c = new Check('BR2', 'boot.js in the live shape: watchdog.js is started on home, nothing critical')
    c.examined(1)
    const w = await drive(mockGame({ home: liveHome(), oneshotLife: 2 }))
    const r = w.final
    if (r?.actionSlot !== 19.4) c.fail(`BR2 the mock is not the live shape: action slot ${r?.actionSlot}GB, want 19.4`)
    if (!r?.admit?.some((e) => e.script === 'watchdog.js' && e.where === 'home')) c.fail('BR2 the plan does not admit watchdog.js on home (not the live plan)')
    if (!on(w, 'home', 'watchdog.js')) c.fail('BR2 watchdog.js is not running on home', JSON.stringify({ failed: r?.failed, started: r?.started }))
    if ((r?.failed ?? []).some((x) => /^watchdog\.js:/.test(x))) c.fail('BR2 boot.txt still records a watchdog.js failure', JSON.stringify(r.failed))
    if ((r?.critical ?? []).length) c.fail('BR2 boot.txt records something critical', JSON.stringify(r.critical))
    c.note(`started: ${(r?.started ?? []).join(' | ')}; evicted: ${JSON.stringify(r?.evicted)}; spawned ${JSON.stringify(w.spawned)}`)
    checks.push(c)
  }

  // ---- BR3 -------------------------------------------------------------------
  {
    const c = new Check('BR3', 'a one-shot that never exits: early.js is evicted on HOME only, watchdog.js starts')
    c.examined(1)
    const w = await drive(mockGame({ home: liveHome(), fleet: [proc('early.js', 2)], oneshotLife: Infinity }))
    const r = w.final
    if (!on(w, 'home', 'watchdog.js')) c.fail('BR3 watchdog.js is not running on home', JSON.stringify({ failed: r?.failed, evicted: r?.evicted }))
    if (!w.kills.includes('early.js on home')) c.fail('BR3 early.js was not evicted on home', JSON.stringify(w.kills))
    if (!on(w, 'omega-net', 'early.js')) c.fail("BR3 the fleet's early.js was killed too (retire.js must be --host home)", JSON.stringify(w.kills))
    if (!(r?.evicted ?? []).includes('early.js on home')) c.fail('BR3 boot.txt does not record the eviction', JSON.stringify(r?.evicted))
    if (w.kills.some((k) => !/^early\.js on home$/.test(k))) c.fail('BR3 something other than early.js on home was killed', JSON.stringify(w.kills))
    c.note(`kills ${JSON.stringify(w.kills)}; ${(r?.started ?? []).find((x) => /^watchdog/.test(x))}; ${w.sleeps} sleeps`)
    checks.push(c)
  }

  // ---- BR4 -------------------------------------------------------------------
  {
    const c = new Check('BR4', 'no room to be made: nothing killed, watchdog.js CRITICAL in boot.txt (past the exit), health error, a CRITICAL line')
    c.examined(1)
    // Home already holds 30GB of daemons the plan does not know about (not EVICTABLE).
    const w = await drive(mockGame({ home: [proc('boot.js'), proc('stanek.js', 1, 30)], oneshotLife: 1 }))
    if (on(w, 'home', 'watchdog.js')) c.fail('BR4 the mock left room for watchdog.js — not the shape under test')
    if (w.kills.length) c.fail('BR4 something was killed although no eviction could make room', JSON.stringify(w.kills))
    if (w.record?.health !== 'error') c.fail(`BR4 boot.txt health before the exit is '${w.record?.health}', want 'error'`)
    if (!(w.final?.critical ?? []).some((x) => /^watchdog\.js NOT RUNNING/.test(x))) c.fail('BR4 the exit record does not carry watchdog.js as critical', JSON.stringify(w.final?.critical))
    if (!w.log.some((l) => /^boot: CRITICAL watchdog\.js NOT RUNNING/.test(l))) c.fail('BR4 no CRITICAL terminal line', JSON.stringify(w.log))
    c.note(`critical: ${(w.final?.critical ?? []).join(' | ').slice(0, 220)}`)
    checks.push(c)
  }

  // ---- BR5 -------------------------------------------------------------------
  {
    const c = new Check('BR5', '--dry: the would-be eviction is reported, nothing evicted or started')
    c.examined(1)
    const w = await drive(mockGame({ home: liveHome(), oneshotLife: Infinity, args: ['--dry'] }))
    if (w.kills.length || w.execs.length) c.fail('BR5 a dry run changed the game', JSON.stringify({ kills: w.kills, execs: w.execs }))
    if (!(w.final?.started ?? []).some((x) => /^watchdog\.js on home .*DRY RUN/.test(x))) c.fail('BR5 the dry run does not report watchdog.js placed', JSON.stringify(w.final?.started))
    checks.push(c)
  }

  // ---- BR6 -------------------------------------------------------------------
  {
    const c = new Check('BR6', 'retire.js --host home kills only on home')
    c.examined(1)
    const hosts = { home: ['early.js', 'cmd.js'], 'omega-net': ['early.js'] }
    const kills = []
    const ns = {
      args: ['--host', 'home', 'early.js'],
      disableLog() {},
      tprint() {},
      atExit() {},
      write: () => true,
      scan: (h) => (h === 'home' ? ['omega-net'] : ['home']),
      hasRootAccess: () => true,
      scriptKill: (s, h) => {
        if (!hosts[h].includes(s)) return false
        hosts[h] = hosts[h].filter((x) => x !== s)
        kills.push(`${s} on ${h}`)
        return true
      },
    }
    await RETIRE.main(ns)
    if (kills.join() !== 'early.js on home') c.fail('BR6 retire.js --host home', JSON.stringify(kills))
    checks.push(c)
  }
  return checks
}
