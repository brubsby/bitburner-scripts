// [BF] THE FULL BLADEBURNER DAEMON'S PLACEMENT GUARANTEE.
//
// Until 2026-10-03 only boot.js placed bladeburner.js, once per boot, and it
// needs its RAISED 92.75GB free in one block on one host — at the 128GB tier
// the hosts that can hold it (home, rothman-uni, millenium-fitness in BN4)
// are the ones batch.js fills during that same boot. Nothing retried, and
// the watchdog did not know the script: homeplan.js priced the 64 -> 128GB
// home upgrade at -10.2h almost entirely on a daemon that might never start.
//
//   BF1 the decision (bbliteplan.fullPlacementOf): home first; else the tightest rooted host with the block
//       free; else a RESERVATION on a host whose batch workers, once drained, leave the block (the previous
//       reservation kept while it qualifies); blocked by name when no host could ever hold it; nothing below
//       the 128GB tier or on a committed 'hack' route; progress.js's home block honoured
//   BF2 watchdog.js END TO END on a mock game: (a) placed on home; (b) no host has the block -> reserved on a
//       fleet host, batch.js (fullReserveOf) stops refilling it, the workers drain, the next cycle places it
//       there and releases the reservation; (c) the handover — bb-lite.js stopped the cycle bladeburner.js
//       starts, never two Bladeburner daemons after it; a launch whose raise is denied is retried
//   BF3 batch.js honours the reservation (fresh, this life, a known host) and publishes it; the watchdog's other
//       placements do not take the reserved block either
//   BF4 the copies agree: FULL_GB = bladeburner.js's RAISE_CEILING = boot.js's raisesTo; FULL_TIER = its tier;
//       FULL_FREEABLE = batch.js's workers; watchdog's import closure is transitive (bbplan.js -> coop.js)
//   BF5 the healthcheck: BLADEBURNER FULL NOT PLACED after 15 min absent where the tier admits it — not
//       before, not below the tier, not on the 'hack' route, not while bladeburner.js reports

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const LP = await import('bbliteplan.js')
const WD = await import('watchdog.js')
const { bladeburnerHealth } = await import('../bbhealth.mjs')

const LAR = 1_700_000_000_000
const INFO = { currentNode: 4, lastAugReset: LAR, ownedSF: new Map([[4, 3], [6, 1], [1, 3]]), ownedAugs: new Map(), bitNodeOptions: {} }
const BLADE_PLAN = { node: 4, decisions: { bladeRoute: { key: 'blade' } } }

/** Static RAM the mock charges at launch (bladeburner.js declares its floor). */
const RAM = { 'bladeburner.js': 3.25, 'bb-lite.js': 5.6, 'h.js': 1.7, 'g.js': 1.75, 'w.js': 1.75, 'progress.js': 2.6, 'watchdog.js': 9, 'batch.js': 8.8, 'stack.js': 30 }
const STOP = new Error('mock: stop after the planned cycles')

/**
 * A mock game for watchdog.main: hosts {name: {max, rooted, procs: [{filename, threads, ram, pid}]}},
 * a flat file map on home, and `between(cycle, world)` run at every ns.sleep (batch.js's side).
 * bladeburner.js raises itself to FULL_GB at launch and exits when its host cannot hold it.
 */
function mockGame({ hosts, files = {}, cycles = 1, between = null }) {
  const world = { hosts, files: { '/tel/plan.txt': JSON.stringify(BLADE_PLAN), ...files }, log: [], execs: [], kills: [], cycle: 0 }
  let pid = 100
  const used = (h) => world.hosts[h].procs.reduce((a, p) => a + p.ram * p.threads, 0)
  const ns = {
    disableLog() {},
    print() {},
    tprint: (m) => world.log.push(String(m)),
    atExit() {},
    read: (f) => world.files[f] ?? '',
    write: (f, d) => {
      world.files[f] = String(d)
      return true
    },
    rm: (f) => delete world.files[f],
    fileExists: () => true,
    getResetInfo: () => INFO,
    scan: (h) => (h === 'home' ? Object.keys(world.hosts).filter((x) => x !== 'home') : ['home']),
    hasRootAccess: (h) => world.hosts[h]?.rooted !== false,
    ps: (h) => world.hosts[h].procs.map((p) => ({ filename: p.filename, threads: p.threads, pid: p.pid, args: [] })),
    getServerMaxRam: (h) => world.hosts[h].max,
    getServerUsedRam: (h) => used(h),
    getScriptRam: (s) => RAM[s] ?? 2,
    scp: () => true,
    exec: (s, h, threads = 1) => {
      const ram = RAM[s] ?? 2
      if (world.hosts[h].max - used(h) < ram * threads) return 0
      const p = { filename: s, threads, ram, pid: ++pid }
      world.execs.push({ script: s, host: h, cycle: world.cycle })
      if (s === 'bladeburner.js') {
        // ramgrow.js: the raise to the full price on its own host, or the script exits.
        if (world.hosts[h].max - used(h) - ram >= LP.FULL_GB - ram) p.ram = LP.FULL_GB
        else {
          world.log.push(`bladeburner.js raise denied on ${h}`)
          return p.pid
        }
      }
      world.hosts[h].procs.push(p)
      return p.pid
    },
    scriptKill: (s, h) => {
      const before = world.hosts[h].procs.length
      world.hosts[h].procs = world.hosts[h].procs.filter((p) => p.filename !== s)
      if (world.hosts[h].procs.length !== before) world.kills.push({ script: s, host: h, cycle: world.cycle })
      return true
    },
    serverExists: () => true,
    getServer: (h) => ({ backdoorInstalled: true, cpuCores: 1, hostname: h }),
    hasTorRouter: () => true,
    getPlayer: () => ({ factions: [], money: 0, skills: { hacking: 1 } }),
    getServerMoneyAvailable: () => 0,
    getHostname: () => 'home',
    stock: { hasTixApiAccess: () => true },
    sleep: async () => {
      world.cycle++
      if (between) between(world.cycle, world)
      if (world.cycle >= cycles) throw STOP
    },
  }
  return { ns, world }
}

async function drive(game) {
  try {
    await WD.main(game.ns)
  } catch (e) {
    if (e !== STOP) throw e
  }
  return game.world
}

const proc = (filename, ram, threads = 1) => ({ filename, ram, threads, pid: Math.floor(Math.random() * 1e6) })
const workers = (gb) => [proc('w.js', 1.75, Math.round(gb / 1.75))]
const runningOn = (world, s) => Object.entries(world.hosts).filter(([, x]) => x.procs.some((p) => p.filename === s)).map(([h]) => h)
const reserveRec = (world) => JSON.parse(world.files[LP.FULL_RESERVE_FILE] || 'null')
const wdRec = (world) => JSON.parse(world.files['/tel/watchdog.txt'] || 'null')?.daemons?.['bladeburner.js'] ?? null

export async function run() {
  const checks = []

  // ---- BF1 -----------------------------------------------------------------
  {
    const c = new Check('BF1', 'the placement decision: home, else the tightest free host, else a reservation, else blocked by name')
    const H = (host, max, used, workerGb = 0, extra = {}) => ({ host, max, used, workerGb, ...extra })
    const base = { homeMax: 256, plan: BLADE_PLAN, node: 4, homeBlock: 19.25 }
    const cases = [
      ['home has the block', { ...base, hosts: [H('home', 256, 40), H('rothman-uni', 128, 0)] }, { action: 'place', host: 'home' }],
      ["home's free RAM is progress.js's block", { ...base, homeMax: 128, hosts: [H('home', 128, 20), H('rothman-uni', 128, 0), H('summit-uni', 128, 10)] }, { action: 'place', host: 'summit-uni' }],
      ['progress.js running: its block is already in used', { ...base, homeMax: 128, progressRunning: true, hosts: [H('home', 128, 30), H('rothman-uni', 128, 120, 110)] }, { action: 'place', host: 'home' }],
      ['no block free: reserve where the workers drain to it', { ...base, homeMax: 128, hosts: [H('home', 128, 100), H('rothman-uni', 128, 120, 110), H('millenium-fitness', 128, 125, 20)] }, { action: 'reserve', host: 'rothman-uni' }],
      ['the previous reservation is kept', { ...base, homeMax: 128, prev: { host: 'millenium-fitness' }, hosts: [H('home', 128, 100), H('rothman-uni', 128, 120, 110), H('millenium-fitness', 128, 125, 120)] }, { action: 'reserve', host: 'millenium-fitness' }],
      ['a hacknet server is never a candidate', { ...base, homeMax: 128, hosts: [H('home', 128, 100), H('hacknet-server-0', 256, 0, 0, { hacknet: true })] }, { action: 'blocked' }],
      ['nothing could ever hold it', { ...base, homeMax: 128, hosts: [H('home', 128, 100), H('rothman-uni', 64, 60, 60)] }, { action: 'blocked' }],
      ['below the tier', { ...base, homeMax: 64, hosts: [H('home', 64, 10), H('rothman-uni', 128, 0)] }, { action: 'wait', admitted: false }],
      ["the 'hack' route", { ...base, plan: { node: 4, decisions: { bladeRoute: { key: 'hack' } } }, hosts: [H('home', 256, 10)] }, { action: 'wait', admitted: false }],
      ["another node's 'hack' plan does not bind", { ...base, plan: { node: 9, decisions: { bladeRoute: { key: 'hack' } } }, hosts: [H('home', 256, 10)] }, { action: 'place', host: 'home' }],
    ]
    for (const [label, o, want] of cases) {
      c.examined(1)
      const d = LP.fullPlacementOf(o)
      for (const [k, v] of Object.entries(want)) if (d[k] !== v) c.fail(`BF1 ${label}: ${k} ${d[k]}, want ${v}`, d.why)
      if (!d.why) c.fail(`BF1 ${label}: no why`)
    }
    const r = LP.fullPlacementOf({ ...base, homeMax: 128, hosts: [H('home', 128, 100), H('rothman-uni', 128, 120, 110)] })
    if (r.gb !== LP.FULL_GB) c.fail(`BF1 the reservation is ${r.gb}GB, not the raised ${LP.FULL_GB}GB`)
    c.note(`reserve: ${r.why}`)
    checks.push(c)
  }

  // ---- BF2 -----------------------------------------------------------------
  {
    const c = new Check('BF2', 'watchdog.js on a mock game: placed on home; reserved on a fleet host, drained, placed; bb-lite.js handed over')
    // (a) home has the room.
    {
      const w = await drive(mockGame({ cycles: 2, hosts: { home: { max: 512, procs: [proc('watchdog.js', 9), proc('batch.js', 8.8)] }, 'rothman-uni': { max: 128, procs: [proc('bb-lite.js', 5.6)] } } }))
      c.examined(3)
      const on = runningOn(w, 'bladeburner.js')
      if (on.length !== 1 || on[0] !== 'home') c.fail('BF2a bladeburner.js is not placed on home', JSON.stringify({ on, execs: w.execs, state: wdRec(w)?.state }))
      if (w.hosts.home.procs.find((p) => p.filename === 'bladeburner.js')?.ram !== LP.FULL_GB) c.fail('BF2a bladeburner.js on home did not hold its raised block')
      if (runningOn(w, 'bb-lite.js').length) c.fail('BF2a bb-lite.js still runs beside bladeburner.js', JSON.stringify(w.kills))
      if (reserveRec(w)?.host !== null) c.fail('BF2a the reservation is not released once bladeburner.js runs', JSON.stringify(reserveRec(w)))
      if (wdRec(w)?.absentSince) c.fail('BF2a the absence clock still runs with bladeburner.js up')
      c.note(`(a) cycle ${w.execs.find((e) => e.script === 'bladeburner.js')?.cycle}: on ${on.join(',')}; bb-lite stopped ${JSON.stringify(w.kills)}; watchdog: ${wdRec(w)?.state}`)
    }
    // (b) the tier's home is full of the stack; rothman-uni is full of batch.js's workers.
    {
      const seen = []
      const between = (cycle, world) => {
        // batch.js's side of one cycle: honour a fresh reservation (fullReserveOf), let the
        // running h/g/w finish, and refill every host up to its max minus what is reserved.
        const res = LP.fullReserveOf(JSON.parse(world.files[LP.FULL_RESERVE_FILE] || 'null'), INFO, Object.keys(world.hosts), Date.now())
        seen.push({ cycle, res: res?.host ?? null, freeThere: res ? world.hosts[res.host].max - world.hosts[res.host].procs.reduce((a, p) => a + p.ram * p.threads, 0) : null })
        for (const [h, x] of Object.entries(world.hosts)) {
          if (h === 'home') continue
          x.procs = x.procs.filter((p) => !LP.FULL_FREEABLE.includes(p.filename))
          const usedNow = x.procs.reduce((a, p) => a + p.ram * p.threads, 0)
          const room = x.max - usedNow - (res?.host === h ? res.gb : 0)
          if (room >= 1.75) x.procs.push(...workers(Math.floor(room / 1.75) * 1.75))
        }
      }
      const w = await drive(mockGame({
        cycles: 4,
        between,
        hosts: {
          home: { max: 128, procs: [proc('watchdog.js', 9), proc('batch.js', 8.8), proc('stack.js', 30), proc('progress.js', 2.6, 1), ...workers(60)] },
          'rothman-uni': { max: 128, procs: workers(126) },
          'millenium-fitness': { max: 128, procs: [proc('stock.js', 28.5), ...workers(98)] },
          'silver-helix': { max: 64, procs: [proc('bb-lite.js', 5.6), ...workers(56)] },
        },
      }))
      c.examined(5)
      const first = seen[0]
      // millenium-fitness: 99.5GB once its workers drain (stock.js stays), the tightest that can hold the block.
      if (first?.res !== 'millenium-fitness') c.fail('BF2b cycle 1 did not reserve the tightest host whose workers drain to the block', JSON.stringify(seen))
      const ex = w.execs.find((e) => e.script === 'bladeburner.js')
      if (!ex) c.fail('BF2b bladeburner.js was never placed after the reservation', JSON.stringify({ seen, state: wdRec(w)?.state, log: w.log.slice(-5) }))
      else if (ex.host !== 'millenium-fitness' || ex.cycle < 1) c.fail(`BF2b placed on ${ex.host} at cycle ${ex.cycle}, not on the reserved host after the drain`)
      const on = runningOn(w, 'bladeburner.js')
      if (on.length !== 1) c.fail('BF2b not exactly one bladeburner.js after the placement', on.join(','))
      if (runningOn(w, 'bb-lite.js').length) c.fail('BF2b bb-lite.js not stopped after the handover', JSON.stringify(w.kills))
      if (reserveRec(w)?.host !== null) c.fail('BF2b the reservation outlives the placement', JSON.stringify(reserveRec(w)))
      c.note(`(b) cycles: ${JSON.stringify(seen)}; placed ${JSON.stringify(ex)}; bb-lite stopped ${JSON.stringify(w.kills)}`)
    }
    // (c) the handover order, and a raise that is denied is retried (not one-shot like boot.js).
    {
      let raced = false
      const between = (cycle, world) => {
        // batch.js ignores nothing here, but one cycle a worker lands between the
        // watchdog's read and the raise: the launch fails its raise and exits.
        if (cycle === 1 && !raced) {
          raced = true
          world.hosts['rothman-uni'].procs.push(...workers(10))
        } else world.hosts['rothman-uni'].procs = world.hosts['rothman-uni'].procs.filter((p) => !LP.FULL_FREEABLE.includes(p.filename))
      }
      const g = mockGame({ cycles: 3, between, hosts: { home: { max: 128, procs: [proc('watchdog.js', 9), proc('stack.js', 90)] }, 'rothman-uni': { max: 128, procs: workers(30) }, 'silver-helix': { max: 64, procs: [proc('bb-lite.js', 5.6)] } } })
      // The first launch races a worker in (exec sees the room, the raise does not).
      const exec0 = g.ns.exec
      let first = true
      g.ns.exec = (s, h, t) => {
        if (s === 'bladeburner.js' && first) {
          first = false
          g.world.hosts[h].procs.push(...workers(20))
        }
        return exec0(s, h, t)
      }
      const w = await drive(g)
      c.examined(2)
      const bbExecs = w.execs.filter((e) => e.script === 'bladeburner.js')
      if (bbExecs.length < 2 || runningOn(w, 'bladeburner.js').length !== 1) c.fail('BF2c a denied raise is not retried on a later cycle', JSON.stringify({ bbExecs, log: w.log }))
      const killedAt = w.kills.find((k) => k.script === 'bb-lite.js')
      const startedAt = bbExecs.find((e) => runningOn(w, 'bladeburner.js').includes(e.host))
      if (!killedAt) c.fail('BF2c bb-lite.js never stopped')
      else if (bbExecs.some((e) => e.cycle === 0) && killedAt.cycle === 0) c.fail('BF2c bb-lite.js stopped on a cycle whose bladeburner.js launch failed its raise', JSON.stringify({ killedAt, bbExecs }))
      c.note(`(c) launches ${JSON.stringify(bbExecs)}; bb-lite stopped ${JSON.stringify(killedAt)}; started ${JSON.stringify(startedAt)}; ${w.log.filter((l) => /raise denied/.test(l)).join('; ')}`)
    }
    checks.push(c)
  }

  // ---- BF3 -----------------------------------------------------------------
  {
    const c = new Check('BF3', 'batch.js honours a fresh, this-life reservation on a host it knows, and publishes it; the watchdog leaves it alone too')
    const now = Date.now()
    const rec = LP.fullReserveRecordOf({ action: 'reserve', host: 'rothman-uni', gb: LP.FULL_GB, why: 'test' }, INFO, now)
    const hostsK = ['home', 'rothman-uni']
    const cases = [
      ['fresh', rec, 'rothman-uni'],
      ['stale', { ...rec, at: new Date(now - LP.FULL_RESERVE_FRESH_MS - 1000).toISOString() }, null],
      ['another life', { ...rec, lastAugReset: LAR - 1 }, null],
      ['unknown host', { ...rec, host: 'gone' }, null],
      ['released', LP.fullReserveRecordOf({ action: 'running', why: 'up' }, INFO, now), null],
    ]
    for (const [label, r, want] of cases) {
      c.examined(1)
      const got = LP.fullReserveOf(r, INFO, hostsK, now)?.host ?? null
      if (got !== want) c.fail(`BF3 ${label}: ${got}, want ${want}`)
    }
    const b = SRC('batch.js')
    c.examined(3)
    if (!/\(h === fullRes\?\.host \? fullRes\.gb : 0\)/.test(b)) c.fail("BF3 batch.js's reserveFor does not hold the full daemon's block")
    if (!/fullReserveOf\(JSON\.parse\(ns\.read\(FULL_RESERVE_FILE\)/.test(b)) c.fail('BF3 batch.js does not read the reservation every tick')
    if (!/fullReserve: fullRes/.test(b)) c.fail('BF3 batch.js does not publish the reservation it honours')
    const wd = SRC('watchdog.js')
    c.examined(2)
    if (!/const free = ns\.getServerMaxRam\(h\) - ns\.getServerUsedRam\(h\) - heldFor\(held, h\)/.test(wd)) c.fail("BF3 the watchdog's placeFor takes the reserved block for another daemon")
    if (!/- \(h === 'home' \? homeReserve : 0\) - heldFor\(held, h\)/.test(wd)) c.fail("BF3 shareThreads sizes share.js into the reserved block")
    checks.push(c)
  }

  // ---- BF4 -----------------------------------------------------------------
  {
    const c = new Check('BF4', "the copies agree: the raised price, the tier, the drainable workers; the watchdog's import closure is transitive")
    c.examined(5)
    const bbjs = SRC('bladeburner.js')
    const ceil = bbjs.match(/const RAISE_CEILING = \(mult\) => ([\d.]+)/)
    if (!ceil || +ceil[1] !== LP.FULL_GB) c.fail(`BF4 bladeburner.js RAISE_CEILING ${ceil?.[1]} != FULL_GB ${LP.FULL_GB}`)
    const boot = SRC('boot.js')
    const ent = boot.slice(boot.indexOf("script: 'bladeburner.js'"), boot.indexOf("script: 'bladeburner.js'") + 200)
    if (!new RegExp(`tier: ${LP.FULL_TIER},`).test(ent) || !new RegExp(`raisesTo: ${LP.FULL_GB},`).test(ent)) c.fail(`BF4 boot.js's bladeburner.js entry disagrees with FULL_TIER ${LP.FULL_TIER} / FULL_GB ${LP.FULL_GB}`, ent)
    const wk = SRC('batch.js').match(/workers: \{ hack: '([^']+)', grow: '([^']+)', weaken: '([^']+)' \}/)
    if (!wk || JSON.stringify(wk.slice(1).sort()) !== JSON.stringify([...LP.FULL_FREEABLE].sort())) c.fail(`BF4 batch.js's workers ${wk?.slice(1)} != FULL_FREEABLE ${LP.FULL_FREEABLE}`)
    const { bladeburnerHealth: _h, FULL_TIER_GB } = await import('../bbhealth.mjs')
    if (FULL_TIER_GB !== LP.FULL_TIER) c.fail(`BF4 bbhealth's tier ${FULL_TIER_GB} != FULL_TIER ${LP.FULL_TIER}`)
    // The closure: bladeburner.js -> bbliteplan.js -> bbplan.js -> coop.js, bayes.js.
    const files = Object.fromEntries(['bladeburner.js', 'bbliteplan.js', 'bbplan.js', 'coop.js', 'bayes.js', 'sfgate.js', 'bbslot.js', 'status.js', 'ramgrow.js', 'bitNodeMultipliers.js'].map((f) => [f, SRC(f)]))
    const g = mockGame({ hosts: { home: { max: 512, procs: [] }, 'rothman-uni': { max: 128, procs: [] } } })
    const shipped = []
    g.ns.read = (f) => files[f] ?? g.world.files[f] ?? ''
    g.ns.scp = (list) => shipped.push(...(Array.isArray(list) ? list : [list]))
    g.world.hosts.home.max = 128
    g.world.hosts.home.procs = [proc('stack.js', 120)]
    await drive(g)
    if (!shipped.includes('coop.js') || !shipped.includes('bayes.js')) c.fail('BF4 the watchdog ships bladeburner.js without its transitive imports', shipped.join(', '))
    c.note(`shipped with bladeburner.js: ${[...new Set(shipped)].join(', ')}`)
    checks.push(c)
  }

  // ---- BF5 -----------------------------------------------------------------
  {
    const c = new Check('BF5', 'BLADEBURNER FULL NOT PLACED fires after 15 min absent where the tier admits it, and only there')
    const T0 = Date.parse('2026-10-03T03:00:00Z')
    const iso = (minAgo) => new Date(T0 - minAgo * 60e3).toISOString()
    const state = { bitNode: 4, sourceFiles: [[6, 1]], currentWork: null, home: { ram: 128 }, playtimeSinceLastAug: 5 * 3600e3 }
    const liteRec = { at: iso(1), health: 'ok', bitNode: 4, daemon: 'bb-lite', result: 'acting', joined: true, rank: 100 }
    const wd = (since) => ({ at: iso(0.5), daemons: { 'bladeburner.js': { state: 'reserve: rothman-uni ...', absentSince: since === null ? undefined : iso(since) } } })
    const fire = (o) => bladeburnerHealth({ bb: liteRec, pl: BLADE_PLAN, state, nowMs: T0, ...o }).fails.filter((f) => f.what.startsWith('BLADEBURNER FULL NOT PLACED'))
    const cases = [
      ['absent 20 min (watchdog clock)', { wd: wd(20) }, 1],
      ['absent 20 min (own snapshot)', { prev: { bitNode: 4, fullAbsentSince: T0 - 20 * 60e3 } }, 1],
      ['absent 5 min', { wd: wd(5) }, 0],
      ['below the tier', { wd: wd(60), state: { ...state, home: { ram: 64 } } }, 0],
      ["the 'hack' route", { wd: wd(60), pl: { node: 4, decisions: { bladeRoute: { key: 'hack' } } } }, 0],
      ['bladeburner.js reporting', { wd: wd(60), bb: { ...liteRec, daemon: 'bladeburner.js', result: 'acting' } }, 0],
      ['bladeburner.js record stale', { wd: wd(60), bb: { ...liteRec, daemon: 'bladeburner.js', at: iso(30) } }, 1],
    ]
    for (const [label, o, n] of cases) {
      c.examined(1)
      const got = fire(o)
      if (got.length !== n) c.fail(`BF5 ${label}: fired ${got.length}, want ${n}`, JSON.stringify(got).slice(0, 300))
      else if (n) c.note(`${label}: ${got[0].what.slice(0, 160)} | ${String(got[0].detail).slice(0, 80)}`)
    }
    // The clock carries: a first run notes and stamps, a later one fires.
    c.examined(1)
    const r1 = bladeburnerHealth({ bb: liteRec, pl: BLADE_PLAN, state, nowMs: T0 })
    const r2 = bladeburnerHealth({ bb: { ...liteRec, at: new Date(T0 + 16 * 60e3).toISOString() }, pl: BLADE_PLAN, state, prev: r1.snap, nowMs: T0 + 16 * 60e3 })
    if (r1.fails.some((f) => f.what.startsWith('BLADEBURNER FULL')) || !r2.fails.some((f) => f.what.startsWith('BLADEBURNER FULL'))) c.fail('BF5 the snapshot does not carry the absence clock across runs', JSON.stringify({ r1: r1.snap, r2: r2.fails }))
    const hc = SRC('tools/healthcheck.mjs')
    c.examined(1)
    if (!/bladeburnerHealth\(\{[^}]*wd: tel\["watchdog\.txt"\] \?\? readTel\("watchdog\.txt"\)/.test(hc)) c.fail('BF5 healthcheck.mjs does not hand bladeburnerHealth the watchdog record')
    checks.push(c)
  }
  return checks
}
