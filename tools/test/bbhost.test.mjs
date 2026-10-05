// [BH] A SERVER FOR bb-lite.js's ACTORS when they starve on the Bladeburner slot.
//
// Live BN14.2 (2026-10-05): Bladeburner sat idle ~9h. bb-lite.js published
// "BB-LITE STARVED: no rooted host has 13.6GB free" pass after pass — home was
// 32GB with go.js (20.75GB) on it in a Go-first node, the fleet 16GB hosts full
// of seed.js's early.js — while $3.8m sat in hand and a 32GB cloud server cost
// $1.76m. seed.js bought a server only for go.js, and only when go.js fit
// nowhere (placeGo, d.action 'blocked'); go.js fit on home, so nothing was ever
// bought. The lead bought one by hand at ~22:30Z, bb-lite reserved 14.6GB on
// it at once and rank rose again.
//
//   BH1  the live shape through seed.js placeLiteHost on a mock game priced by the game's RAM
//        calculator (SF4.3, BN14): the actor fits on no rooted host, so seed.js execs gohost.js
//        [32, 'bb-host'] at $3.8m; not at $1.5m, not without the Bladeburner slot claim, not when
//        bb-lite is not starved or is another life's, not when bb-host exists, not when a 32GB
//        fleet host holding only seed workers can carry the reservation; homeup.js about to spend
//        the same dollars on home RAM holds it a pass (both covered: buys)
//   BH2  gohost.js buys 'bb-host' by name and reads it back; refuses a name outside CLOUD_HOSTS
//   BH3  once bb-host exists: bb-lite reserves on it (even with prev = a go-host holding go.js),
//        and seed.js's worker pass leaves the 14.6GB actor headroom free there (it did not read
//        bb-lite's reservation at all) while filling the rest; the live 22:48Z go-host (reserved,
//        refilled by seed.js to 31.2 of 32GB) is cleared back to the headroom
//   BH4  sizing: LITE_ACTOR_GB is the largest actor in BN14 at SF4.3 (bb-lite-act.js priced 24.6GB
//        live: bbplan.js's { attempt: ... } verdict billed codingcontract.attempt, 10GB), and the
//        purchase holds coordinator + that actor
//   BH5  watchdog.js holds bb-lite's reservation with the RAISED ones (share.js, 'anywhere' daemons),
//        except when placing bb-lite.js itself

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const RP = await import('raiseplace.js')
const LP = await import('bbliteplan.js')
const BN = await import('bitNodeMultipliers.js')
const HC = await import('homecost.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const F = JSON.parse(SRC('tools/test/fixture-bn14-gofirst.json'))
const n14 = BN.bitNodeMults(14)
const INFO = { currentNode: 14, lastAugReset: F.reset.lastAugReset, ownedSF: new Map(F.reset.ownedSF), ownedAugs: new Map(), bitNodeOptions: {} }

export async function run() {
  const checks = []
  let R = null
  try {
    R = await import('./ram.mjs')
    await R.load()
    R.asSave({ bitNode: 14, sf: Object.fromEntries(F.reset.ownedSF) })
  } catch {
    R = null
  }
  const priced = (s) => {
    const r = R?.ramOf(s)
    if (!r || r.error || !Number.isFinite(r.cost)) throw new Error(`${s} does not price: ${r?.error ?? 'no RAM calculator'}`)
    return r.cost
  }
  const now = Date.now()
  const iso = (msAgo) => new Date(now - msAgo).toISOString()

  /** seed.js's ns on a mock world; RAM from the game's calculator. */
  const mock = (hosts, { files = {}, cash = 0, here = 'foodnstuff' } = {}) => {
    const world = { hosts, files: new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])), execs: [], kills: [], prints: [] }
    let pid = 1
    const used = (h) => world.hosts[h].procs.reduce((a, p) => a + p.ram * p.threads, 0)
    const ns = {
      getResetInfo: () => INFO,
      getHostname: () => here,
      write: (f, d) => world.files.set(f, String(d)),
      read: (f) => world.files.get(f) ?? '',
      scp: () => true,
      scan: (h) => (h === 'home' ? Object.keys(world.hosts).filter((x) => x !== 'home') : ['home']),
      hasRootAccess: () => true,
      fileExists: () => false,
      getServerNumPortsRequired: () => 0,
      nuke: () => true,
      getHackingLevel: () => 50,
      getServerMaxMoney: (h) => (h === 'home' || /host$/.test(h) ? 0 : 1e6),
      getServerSecurityLevel: () => 5,
      getServerMinSecurityLevel: () => 5,
      getWeakenTime: () => 60e3,
      getServerRequiredHackingLevel: () => 1,
      getServerMaxRam: (h) => world.hosts[h].max,
      getServerUsedRam: (h) => used(h),
      getScriptRam: (s) => priced(s),
      getServerMoneyAvailable: () => cash,
      ps: (h) => world.hosts[h].procs.map((p) => ({ filename: p.filename, threads: p.threads, args: p.args ?? [], pid: p.pid })),
      kill: (id) => {
        for (const [h, v] of Object.entries(world.hosts)) {
          const p = v.procs.find((q) => q.pid === id)
          if (p) {
            v.procs = v.procs.filter((q) => q !== p)
            world.kills.push(`${p.filename}@${h}`)
            return true
          }
        }
        return false
      },
      scriptKill: (s, h) => {
        const n = world.hosts[h].procs.length
        world.hosts[h].procs = world.hosts[h].procs.filter((p) => p.filename !== s)
        if (world.hosts[h].procs.length !== n) world.kills.push(`${s}@${h}`)
        return true
      },
      exec: (s, h, threads = 1, ...args) => {
        const ram = Math.max(priced(s), RP.RAISED[s] && s !== 'go.js' ? RP.RAISED[s].gb : 0)
        if (world.hosts[h].max - used(h) < ram * threads - 1e-9) return 0
        const id = ++pid
        world.hosts[h].procs.push({ filename: s, threads, ram, args, pid: id })
        world.execs.push({ s: `${s}@${h}`, args })
        return id
      },
      sleep: async () => {},
      tprint: (m) => world.prints.push(String(m)),
    }
    return { ns, world, free: (h) => world.hosts[h].max - used(h) }
  }
  const pp = (filename, threads = 1, args = []) => ({ filename, ram: priced(filename), threads, args, pid: Math.floor(Math.random() * 1e9) })
  /** The live world: go.js on the 32GB home, the 16GB fleet full of seed's early.js, bb-lite.js's coordinator beside seed.js. */
  const live = (extra = {}) => ({
    home: { max: 32, procs: [pp('go.js'), pp('early.js', 1)] },
    foodnstuff: { max: 16, procs: [pp('seed.js'), pp('bb-lite.js'), pp('early.js', 1)] },
    'sigma-cosmetics': { max: 16, procs: [pp('early.js', 6)] },
    joesguns: { max: 16, procs: [pp('early.js', 6)] },
    'nectar-net': { max: 16, procs: [pp('early.js', 6)] },
    'hong-fang-tea': { max: 16, procs: [pp('early.js', 6)] },
    'harakiri-sushi': { max: 16, procs: [pp('early.js', 6)] },
    n00dles: { max: 4, procs: [pp('hgw.js', 2)] },
    ...extra,
  })
  const starvedWhy = 'no rooted host has 13.6GB free for bb-lite-read.js'
  const liteRec = (o = {}) => ({
    at: iso(20e3), health: 'waiting', bitNode: 14, lastAugReset: INFO.lastAugReset, host: 'foodnstuff', daemon: 'bb-lite', reserve: null,
    result: 'actor-unplaced', joined: true, detail: `no reads yet: ${starvedWhy}`,
    actorErrors: [1, 2, 3, 4].map((i) => ({ at: iso(i * 45e3), why: starvedWhy })),
    ...o,
  })
  // 32GB home: no progress.js, so the claim is act.js's bootstrap one (bbslot.slotClaim).
  const actRec = (owner = 'bladeburner') => ({ at: iso(10e3), slot: { owner, at: iso(30e3), lastAugReset: INFO.lastAugReset, why: 'the Bladeburner route (actplan 0b)' } })
  const files = (o = {}) => ({ '/tel/bb-lite.txt': liteRec(o.lite), '/tel/act.txt': actRec(o.owner), ...(o.homeup ? { '/tel/homeup.txt': o.homeup } : {}) })

  // ---- BH1 ---------------------------------------------------------------------
  {
    const c = new Check('BH1', "BN14.2 live shape (32GB home holding go.js, 16GB fleet full, bb-lite starved on the Bladeburner slot, $3.8m): seed.js execs gohost.js [32, 'bb-host']; every condition that should hold it does")
    try {
      const SEED = await import('seed.js')
      const actorGb = priced('bb-lite-read.js')
      // The reproduction itself: the read actor fits on no rooted host.
      {
        const g = mock(live())
        const fits = Object.keys(g.world.hosts).filter((h) => g.free(h) >= actorGb)
        c.examined(1)
        if (fits.length) c.fail(`BH1 the live world should starve the ${actorGb}GB actor; it fits on ${fits.join(', ')}`)
        else c.note(`live world: bb-lite-read.js ${actorGb}GB fits nowhere (home ${g.free('home').toFixed(2)}GB free beside go.js ${priced('go.js')}GB; fleet max 16GB)`)
      }
      const runCase = async (tag, { world = live(), f = files(), cash = 3.8e6, want }) => {
        const g = mock(world, { files: f, cash })
        const got = await SEED.placeLiteHost(g.ns, Object.keys(g.world.hosts))
        const ex = g.world.execs.find((e) => e.s.startsWith('gohost.js@'))
        c.examined(1)
        if (!!ex !== want) c.fail(`BH1 ${tag}: gohost.js ${ex ? 'launched' : 'not launched'}, want ${want ? 'launched' : 'not'}`, JSON.stringify({ execs: g.world.execs, got }))
        else if (want && (JSON.stringify(ex.args) !== JSON.stringify([32, RP.BB_HOST]) || got !== RP.BB_HOST)) c.fail(`BH1 ${tag}: gohost.js must be asked for the 32GB '${RP.BB_HOST}'`, JSON.stringify({ args: ex.args, got }))
        else c.note(`${tag}: ${ex ? `${ex.s} ${JSON.stringify(ex.args)}` : 'held'}`)
        return g
      }
      const g0 = await runCase('$3.8m, starved, Bladeburner slot', { want: true })
      if (!g0.world.prints.some((m) => /bb-host/.test(m))) c.fail('BH1 the purchase must be said (tprint)')
      await runCase('$1.5m (a 32GB server is $1.76m in BN14)', { cash: 1.5e6, want: false })
      await runCase('the slot is held for crime', { f: files({ owner: 'crime' }), want: false })
      await runCase('no claim at all', { f: { '/tel/bb-lite.txt': liteRec() }, want: false })
      await runCase('bb-lite acting (not starved)', { f: files({ lite: { result: 'started', actorErrors: [] } }), want: false })
      await runCase('one refusal, not three', { f: files({ lite: { actorErrors: [{ at: iso(10e3), why: starvedWhy }] } }), want: false })
      await runCase('refusals older than 10 min', { f: files({ lite: { actorErrors: [1, 2, 3].map((i) => ({ at: iso(10 * 60e3 + i * 1e3), why: starvedWhy })) } }), want: false })
      await runCase("bb-lite.txt from another life", { f: files({ lite: { lastAugReset: INFO.lastAugReset - 1 } }), want: false })
      await runCase('bb-host already exists', { world: live({ 'bb-host': { max: 32, procs: [pp('early.js', 13)] } }), want: false })
      await runCase('a 32GB fleet host holding only seed workers (the reservation clears it)', { world: live({ 'silver-helix': { max: 32, procs: [pp('early.js', 13)] } }), want: false })
      // go-host holding go.js does NOT count as room: 32 - 20.75 = 11.25GB.
      await runCase('a 32GB go-host holding go.js', { world: live({ 'go-host': { max: 32, procs: [pp('go.js')] } }), want: true })
      // homeup.js about to spend the same dollars on home RAM.
      const hu = (cost, msAgo = 30e3, o = {}) => ({ at: iso(msAgo), health: 'waiting', reserve: 0, next: { kind: 'RAM', cost }, ...o })
      await runCase('homeup.js live, $3m home upgrade, $3.8m covers one not both', { f: files({ homeup: hu(3e6) }), want: false })
      await runCase('homeup.js live, $3m home upgrade, $5m covers both', { f: files({ homeup: hu(3e6) }), cash: 5e6, want: true })
      await runCase('homeup.js record 10 min old (nothing would take the money)', { f: files({ homeup: hu(3e6, 10 * 60e3) }), want: true })
      await runCase(`homeup.js waiting on the $${(HC.ramUpgradeCost(32, n14.HomeComputerRamCost) / 1e6).toFixed(2)}m 32GB -> 64GB upgrade (live)`, { f: files({ homeup: hu(HC.ramUpgradeCost(32, n14.HomeComputerRamCost)) }), want: true })
      // The verdict is published on seed.js's record.
      if (!/bbHost: lastLiteHost/.test(SRC('seed.js'))) c.fail("BH1 /tel/seed.txt must carry the bb-host verdict ('bbHost')")
      if (!/await placeLiteHost\(ns, all\)/.test(SRC('seed.js'))) c.fail('BH1 seed.js pass() must run placeLiteHost')
      if (/ns\.cloud\./.test(SRC('seed.js'))) c.fail('BH1 seed.js must not reference ns.cloud (gohost.js is the one-shot that pays for it)')
      // The pure verdict: price and the node's limit.
      const pure = (o) => LP.liteHostBuyOf({ lite: liteRec(), info: INFO, claim: { owner: 'bladeburner' }, hosts: [], cash: 3.8e6, mults: n14, now, ...o })
      const p1 = pure({})
      const p2 = pure({ mults: BN.bitNodeMults(9), cash: 1e12 })
      c.examined(2)
      if (!p1.buy || p1.ram !== 32 || Math.abs(p1.cost - 32 * 55000 * (n14.CloudServerCost ?? 1)) > 1e-6) c.fail('BH1 liteHostBuyOf: 32GB at the game price', JSON.stringify(p1))
      else c.note(`liteHostBuyOf: ${p1.why}`)
      if (p2.buy) c.fail('BH1 BitNode 9 (CloudServerLimit 0): never buy', JSON.stringify(p2))
    } catch (e) {
      c.fail(`BH1 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  // ---- BH2 ---------------------------------------------------------------------
  {
    const c = new Check('BH2', "gohost.js buys 'bb-host' by name and reads it back; a name outside CLOUD_HOSTS is refused")
    try {
      const GH = await import('gohost.js')
      const runGh = async (args, cash = 3.8e6) => {
        const fl = new Map()
        const servers = new Set()
        let bought = null
        const ns = {
          args,
          cloud: {
            getServerCost: (r) => r * 55000,
            purchaseServer: (n, r) => {
              if (cash < r * 55000) return ''
              servers.add(n)
              bought = { n, r }
              return n
            },
          },
          getServerMoneyAvailable: () => cash,
          serverExists: (h) => servers.has(h),
          getServerMaxRam: (h) => (bought && h === bought.n ? bought.r : 0),
          write: (f, d) => fl.set(f, d),
          scp: () => true,
          getHostname: () => 'foodnstuff',
          tprint() {},
        }
        await GH.main(ns)
        return { rec: JSON.parse(fl.get('/tel/gohost.txt') ?? 'null'), bought }
      }
      const r1 = await runGh([32, 'bb-host'])
      const r2 = await runGh([32, 'pserv-0'])
      c.examined(2)
      if (!r1.rec?.ok || r1.bought?.n !== 'bb-host' || r1.bought?.r !== 32 || r1.rec?.name !== 'bb-host' || !/bb-lite/.test(r1.rec?.why ?? '')) c.fail("BH2 gohost.js [32, 'bb-host'] buys bb-host 32GB and says what for", JSON.stringify(r1))
      else c.note(`gohost.js: ${r1.rec.why}`)
      if (r2.rec?.ok || r2.bought || !/not a host gohost\.js buys/.test(r2.rec?.why ?? '')) c.fail('BH2 a name outside CLOUD_HOSTS is refused', JSON.stringify(r2))
    } catch (e) {
      c.fail(`BH2 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  // ---- BH3 ---------------------------------------------------------------------
  {
    const c = new Check('BH3', "with bb-host bought: bb-lite reserves on it (ahead of a go-host holding go.js), and seed.js's worker pass keeps the 14.6GB actor headroom free there while filling the rest")
    try {
      const hosts = [
        { host: 'home', max: 32 },
        { host: 'foodnstuff', max: 16 },
        { host: 'go-host', max: 32 },
        { host: 'bb-host', max: 32 },
      ]
      c.examined(2)
      if (LP.reserveHostOf('foodnstuff', hosts, 'go-host') !== 'bb-host') c.fail('BH3 the reservation moves to bb-host even from prev = go-host')
      if (LP.reserveHostOf('foodnstuff', hosts.filter((h) => h.host !== 'bb-host'), 'go-host') !== 'go-host') c.fail('BH3 without bb-host, prev still holds (no wandering)')
      // seed.js pass() on the world right after the purchase: bb-host empty, bb-lite alive with its reservation there.
      const SEED = await import('seed.js')
      const f = files({ lite: { result: 'actor-unplaced', reserve: { host: 'bb-host', gb: LP.LITE_ACTOR_GB } } })
      const g = mock(live({ 'bb-host': { max: 32, procs: [] } }), { files: f, cash: 0 })
      const hold = LP.liteReserveOf({ lite: liteRec({ reserve: { host: 'bb-host', gb: LP.LITE_ACTOR_GB } }), full: null, info: INFO, canJoin: true, hosts: Object.entries(g.world.hosts).map(([h, v]) => ({ host: h, max: v.max })), now })
      c.examined(1)
      if (hold?.host !== 'bb-host' || hold.gb !== LP.LITE_ACTOR_GB) c.fail('BH3 liteReserveOf: bb-host, the actor headroom', JSON.stringify(hold))
      await SEED.pass(g.ns, { target: '', kill: false, floor: 0.05, watch: false, every: 60e3 })
      const onBb = g.world.hosts['bb-host'].procs
      c.examined(1)
      if (!(g.free('bb-host') >= LP.LITE_ACTOR_GB - 1e-9)) c.fail(`BH3 seed.js left ${g.free('bb-host').toFixed(2)}GB on bb-host, under bb-lite's ${LP.LITE_ACTOR_GB}GB`, JSON.stringify(onBb.map((p) => `${p.threads}x${p.filename}`)))
      if (!onBb.some((p) => p.filename === 'early.js' || p.filename === 'hgw.js')) c.fail('BH3 the rest of bb-host still gets a worker', JSON.stringify(onBb))
      if (g.world.execs.some((e) => e.s.startsWith('gohost.js@'))) c.fail('BH3 no second purchase once bb-host exists', JSON.stringify(g.world.execs))
      // ...and a running actor's own GB counts toward the headroom: no churn when seed passes mid-actor.
      const kills0 = g.world.kills.length
      g.world.hosts['bb-host'].procs.push(pp('bb-lite-act.js'))
      await SEED.pass(g.ns, { target: '', kill: false, floor: 0.05, watch: false, every: 60e3 })
      c.examined(1)
      if (g.world.kills.slice(kills0).some((k) => k.endsWith('@bb-host'))) c.fail('BH3 a bb-lite actor running on bb-host must not make seed.js re-place its worker there', JSON.stringify(g.world.kills.slice(kills0)))
      // LIVE 22:48Z: the hand-bought go-host reserved by bb-lite ({go-host, 14.6}) and refilled by
      // seed.js to 31.2 of 32GB ("no rooted host has 24.6GB free for bb-lite-act.js (the reserved
      // go-host has 0.80GB)"). seed.js must re-place its worker there and leave the headroom.
      {
        const f2 = files({ lite: { reserve: { host: 'go-host', gb: LP.LITE_ACTOR_GB } } })
        const g2 = mock(live({ 'go-host': { max: 32, procs: [pp('early.js', 13)] } }), { files: f2, cash: 0 })
        const before = g2.free('go-host')
        await SEED.pass(g2.ns, { target: '', kill: false, floor: 0.05, watch: false, every: 60e3 })
        c.examined(1)
        if (!(g2.free('go-host') >= LP.LITE_ACTOR_GB - 1e-9)) c.fail(`BH3 live 22:48Z: seed.js left ${g2.free('go-host').toFixed(2)}GB on the reserved go-host (was ${before.toFixed(2)})`, JSON.stringify(g2.world.hosts['go-host'].procs.map((p) => `${p.threads}x${p.filename}`)))
        else c.note(`live 22:48Z go-host: ${before.toFixed(2)}GB free -> ${g2.free('go-host').toFixed(2)}GB after seed.js (${g2.world.hosts['go-host'].procs.map((p) => `${p.threads}x${p.filename}`).join(', ')})`)
        // ...and every actor then fits there.
        const big = Math.max(...Object.values(LP.ACTOR).map((a) => priced(a)))
        if (!(g2.free('go-host') >= big - 1e-9)) c.fail(`BH3 the largest actor (${big}GB) does not fit the headroom seed.js leaves`)
      }
      c.note(`bb-host after seed.js:${g.world.hosts['bb-host'].procs.map((p) => `${p.threads}x${p.filename} ${p.ram}`).join(', ')}, ${g.free('bb-host').toFixed(2)}GB free with an actor running (reservation ${LP.LITE_ACTOR_GB}GB)`)
    } catch (e) {
      c.fail(`BH3 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  // ---- BH4 ---------------------------------------------------------------------
  {
    const c = new Check('BH4', "the reservation and the purchase are sized to bb-lite's LARGEST actor in BN14 at SF4.3 (live 22:48Z bb-lite-act.js priced 24.6GB against a 14.6GB reservation: a property named 'attempt' in bbplan.js billed codingcontract.attempt)")
    try {
      const sizes = Object.fromEntries(Object.values(LP.ACTOR).map((a) => [a, priced(a)]))
      const big = Math.max(...Object.values(sizes))
      c.examined(Object.keys(sizes).length)
      if (big !== LP.LITE_ACTOR_GB) c.fail(`BH4 LITE_ACTOR_GB ${LP.LITE_ACTOR_GB} but the largest actor prices ${big}GB in BN14`, JSON.stringify(sizes))
      else c.note(`BN14 SF4.3 actors: ${Object.entries(sizes).map(([a, g]) => `${a} ${g}`).join(', ')}; coordinator ${priced('bb-lite.js')}GB`)
      if (priced('bb-lite.js') !== LP.LITE_COORD_GB) c.fail(`BH4 LITE_COORD_GB ${LP.LITE_COORD_GB} but bb-lite.js prices ${priced('bb-lite.js')}GB in BN14`)
      const v = LP.liteHostBuyOf({ lite: liteRec(), info: INFO, claim: { owner: 'bladeburner' }, hosts: [], cash: 1e9, mults: n14, now })
      c.examined(1)
      if (!(v.ram >= priced('bb-lite.js') + big)) c.fail(`BH4 the ${v.ram}GB purchase cannot hold coordinator + largest actor (${priced('bb-lite.js') + big}GB)`)
      // The shape that caused it: no blackOpWorth verdict key may be named like an ns function.
      const names = R?.pricedNames?.() ?? null
      const keys = [...SRC('bbplan.js').matchAll(/return \{ (\w+): (?:true|false),/g)].map((m) => m[1])
      c.examined(keys.length)
      if (!keys.length) c.fail("BH4 found no blackOpWorth verdicts in bbplan.js to check (the scan looked at nothing)")
      if (keys.includes('attempt')) c.fail("BH4 bbplan.js returns { attempt: ... } again: codingcontract.attempt (10GB) billed to every importer")
      if (names && keys.some((k) => names.has(k))) c.fail(`BH4 a bbplan.js verdict key is an ns function name: ${keys.join(', ')}`)
    } catch (e) {
      c.fail(`BH4 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  // ---- BH5 ---------------------------------------------------------------------
  {
    const c = new Check('BH5', "watchdog.js holds bb-lite's reservation like the RAISED ones (share.js and 'anywhere' daemons stay off it), except when placing bb-lite.js itself")
    try {
      const WD = await import('watchdog.js')
      const fl = new Map([['/tel/bb-lite.txt', JSON.stringify(liteRec({ result: 'started', reserve: { host: 'go-host', gb: LP.LITE_ACTOR_GB } }))]])
      const maxes = { home: 64, foodnstuff: 16, 'go-host': 32 }
      const ns = {
        getResetInfo: () => INFO,
        read: (f) => fl.get(f) ?? '',
        scan: (h) => (h === 'home' ? ['foodnstuff', 'go-host'] : ['home']),
        hasRootAccess: () => true,
        getServerMaxRam: (h) => maxes[h],
      }
      const held = WD.fullHeld(ns)
      const self = WD.fullHeld(ns, 'bb-lite.js')
      c.examined(2)
      if (!held.some((r) => r.script === 'bb-lite.js' && r.host === 'go-host' && r.gb === LP.LITE_ACTOR_GB)) c.fail("BH5 watchdog fullHeld must carry bb-lite's go-host reservation", JSON.stringify(held))
      if (self.some((r) => r.script === 'bb-lite.js')) c.fail('BH5 placing bb-lite.js itself, its own headroom is room', JSON.stringify(self))
      if (!/const held = fullHeld\(ns, script\)/.test(SRC('watchdog.js'))) c.fail("BH5 watchdog placeFor must pass the script it places to fullHeld")
      c.note(`watchdog fullHeld: ${JSON.stringify(held)}`)
    } catch (e) {
      c.fail(`BH5 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  return checks
}
