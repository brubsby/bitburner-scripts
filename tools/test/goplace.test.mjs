// [GP] go.js's PRICED placement (goplace.js): the money to the 128GB home tier
// with go.js placed now vs waiting for that tier, on one set of inputs.
//
// Live BN9.2 (entered 2026-10-07 13:13Z, chosen for the Go farm on a hacking
// exit): seed.txt read "effective Go power 2 (GoPower 1 x2 for SF14) < 4:
// go.js at its 128GB home tier" — raiseplace.goFirstOf's FIXED threshold —
// with $115k/s of hacknet production for Netburners to multiply and four
// early.js threads (~$0.3/s) the only thing the 32GB home would displace.
// Fixture: tools/test/fixture-bn9-goplace.json (the live telemetry at the
// 32GB opening and at 64GB with the trader running).
//
//   GP1  BN9.2 (x2): the verdict IS the comparison (goFirst === withoutH - withH > tol) and it places —
//        on home at 32GB (early.js displaced) and on a fleet host at 64GB; the "with" run with a
//        zero-rate farm and nothing displaced is the "without" run exactly (one simulator, one input set)
//   GP2  BitNode 14 (x8) is a case of the rule: the BN14.1 opening places; the same x8 where the
//        displaced workers ARE the income (no hacknet) waits; x2 with 60% displaced waits 2h from the tier, places 200h
//   GP3  the endpoint: GO_BOOT_TIER = boot.js's go.js tier; goMilestoneOf = the game's RAM prices summed
//        (BN9 32GB: $50.4m + $159.3m); raiseplace's reserve charges workersGb (the shortfall, at most the workers)
//   GP4  unpriced is said, never zero: no/stale status, another life's hacknet, no rate -> priced false, wait
//   GP5  the threshold is gone (no goFirstOf / GO_FIRST_EFFECT anywhere a placer reads), and the
//        shortcut, brought back, disagrees with the comparison on GP1 and GP2's cases
//   GP6  seed.js placeGo on the live BN9.2 shapes: 32GB -> go.js on home (early.js evicted); 64GB -> a
//        32GB fleet host (its early.js evicted); a shape the comparison refuses -> nothing touched, 'wait'
//   GP7  watchdog.js on the live 64GB shape places go.js on a fleet host and publishes the verdict
//        (daemons['go.js'].go), which tools/gohealth.mjs goVerdictOf reads for GO NOT PLAYING

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const GPL = await import('goplace.js')
const RP = await import('raiseplace.js')
const BN = await import('bitNodeMultipliers.js')
const HC = await import('homecost.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const FX = JSON.parse(SRC('tools/test/fixture-bn9-goplace.json'))
const FB14 = JSON.parse(SRC('tools/test/fixture-bn14-gofirst.json'))
const n9 = BN.bitNodeMults(9)
const n14 = BN.bitNodeMults(14)
const TOL = GPL.GO_PLACE_TOL_H
const LAR = FX.reset.lastAugReset
const INFO9 = { currentNode: 9, lastAugReset: LAR, ownedSF: new Map([[1, 3], [4, 3], [14, 3], [9, 1]]), ownedAugs: new Map(), bitNodeOptions: {} }

/** A snapshot's records re-stamped so the newest is `now` (freshness as it was live). */
function restamp(snap, now = Date.now()) {
  const shift = (r) => (r && r.at ? { ...r, at: new Date(now - (Date.parse(snap.at) - Date.parse(r.at))).toISOString() } : r)
  return { status: shift(snap.status), hacknet: shift(snap.hacknet), stock: shift(snap.stock) }
}
const streamsAt = (snap, o = {}) => {
  const now = Date.now()
  const r = restamp(snap, now)
  return GPL.goPlaceStreamsOf({ ...r, posterior: FX.posterior, lastAugReset: LAR, goPower: n9.GoPower, sf14: 3, now, ...o })
}

/** The live RAM of each process the fixtures name (go.js, workers at SF4.3 prices; daemons near enough). */
const RAM = { 'go.js': 20.75, 'early.js': 2.4, 'hgw.js': 2, 'seed.js': 7.8, 'homeup.js': 7.6, 'errlog.js': 2, 'tel.js': 4, 'hashspend.js': 3.25, 'hacknet.js': 5, 'act.js': 6, 'bb-lite.js': 5.6, 'rfalink.js': 2.25, 'stock.js': 28.6, 'cmd.js': 8.15, 'autobuy.js': 4.15, 'backdoor.js': 7.1, 'buyserv.js': 7.1, 'watchdog.js': 8.95, 'snap-static.js': 9.25, 'act-liquidate.js': 19.4, 'act-company.js': 8.25, 'act-graft.js': 14, 'gohost.js': 4 }
const ramOf = (s) => Math.max(RAM[s] ?? 2, RP.RAISED[s] && s !== 'go.js' ? RP.RAISED[s].gb : 0)

/** raisedPlacementOf's host records from a snapshot (what seed.js builds). */
function hostRecs(snap) {
  return Object.entries(snap.maxRam).map(([host, max]) => {
    const procs = snap.hosts[host] ?? []
    const gb = (names) => procs.filter(([s]) => names.includes(s)).reduce((a, [s, t]) => a + ramOf(s) * t, 0)
    return { host, max, used: procs.reduce((a, [s, t]) => a + ramOf(s) * t, 0), workerGb: gb(RP.FREEABLE), evictGb: gb(RP.EVICTABLE), relocGb: host === 'home' ? gb(RP.RELOCATABLE) : 0, yieldGb: host === 'home' ? gb(RP.GO_OUTRANKS) : 0, hacknet: false }
  })
}
const workerGbOf = (recs) => recs.reduce((a, h) => a + h.workerGb + h.evictGb, 0)

/** The verdict as seed.js asks it: the placement the rule would take, priced. */
function verdictAt(snap, { keep, streams = streamsAt(snap), goPower = n9.GoPower, sf14 = 3, mults = n9 } = {}) {
  const recs = hostRecs(snap)
  const homeMax = snap.homeMax
  const d = RP.goPlacementOf({ go: { goFirst: true, why: 'priced below' }, homeMax, need: 20.75, homeKeep: keep, homeBlock: homeMax >= RP.JOB_RUNNER_TIER ? 13 + 6.25 : 0, progressRunning: false, hosts: recs })
  const m = GPL.goMilestoneOf({ homeMax, ramCostMult: mults.HomeComputerRamCost })
  const v = GPL.goPlaceValueOf({ streams, goPower, sf14, target: m.target, displacedGb: d.action === 'reserve' ? d.workersGb : 0, workerGb: workerGbOf(recs), executable: d.action !== 'blocked' })
  return { d, v, m, recs }
}

/** The deleted shortcut: a fixed threshold on effective Go power. */
const threshold = (goPower, sf14) => goPower * (sf14 >= 1 ? 2 : 1) >= 4

export async function run() {
  const checks = []

  // ---- GP1 -------------------------------------------------------------------
  {
    const c = new Check('GP1', 'BN9.2 (x2): the verdict is withoutH - withH on shared inputs, and it places — home at 32GB, a fleet host at 64GB; the with-run at zero rate is the without-run')
    for (const [tag, snap, keep, wantHost] of [
      ['32GB opening (13:19Z)', FX.open32, 9.25, (h) => h === 'home'],
      ['64GB, trader running (13:37Z)', FX.home64, 19.4, (h) => h !== 'home'],
    ]) {
      const { d, v, m } = verdictAt(snap, { keep })
      c.examined(4)
      if (!v.priced) {
        c.fail(`GP1 ${tag}: unpriced`, v.why)
        continue
      }
      if (v.goFirst !== v.withoutH - v.withH > TOL) c.fail(`GP1 ${tag}: the verdict is not the comparison (goFirst ${v.goFirst}, withoutH ${v.withoutH}, withH ${v.withH})`)
      if (!v.goFirst) c.fail(`GP1 ${tag}: the live BN9.2 state must place go.js`, v.why)
      if (!(d.action === 'reserve' || d.action === 'place') || !wantHost(d.host)) c.fail(`GP1 ${tag}: placement ${d.action} on ${d.host}`, d.why)
      if (v.arm !== 'Netburners') c.fail(`GP1 ${tag}: hacknet is the income — Netburners must be the arm, got ${v.arm}`, JSON.stringify(v.arms))
      c.note(`${tag}: ${d.action} ${d.host} (${(d.workersGb ?? 0).toFixed(2)}GB of workers) — ${v.why}`)
      // One simulator, one input set: the farm at rate 0 with nothing displaced IS the without-run.
      const s = streamsAt(snap)
      const zero = GPL.hoursTo({ start: s.wealth, target: m.target, incomeAt: GPL.incomeAtOf({ hackIncome: s.hackIncome, hacknetIncome: s.hacknetIncome, farm: { name: 'Netburners', pph: 0, n0: 0 }, d: 0, goPower: 1, sf14: 3 }) })
      if (Math.abs(zero - v.withoutH) > 1e-12) c.fail(`GP1 ${tag}: the with-run at zero rate (${zero}h) differs from the without-run (${v.withoutH}h): the runs are not on one input set`)
    }
    // The trader's share is taken out of the script income, not counted as hacking.
    const s64 = streamsAt(FX.home64)
    c.examined(1)
    const raw = FX.home64.status.incomePerSec
    const tr = FX.home64.stock.scriptIncome.perSec
    if (Math.abs(s64.hackIncome - Math.max(0, raw - tr)) > 1e-9) c.fail(`GP1 hacking stream ${s64.hackIncome}, want script ${raw} less the trader's ${tr}`)
    checks.push(c)
  }

  // ---- GP2 -------------------------------------------------------------------
  {
    const c = new Check('GP2', 'BitNode 14 (x8) is a case of the rule, not a branch: its opening places, the same x8 with the workers as the only income waits; x2 with 60% of the workers displaced waits 2h from the tier and places 200h from it')
    const at = new Date().toISOString()
    const mk = ({ income, hacknet, wealth, lar = FB14.reset.lastAugReset }) =>
      GPL.goPlaceStreamsOf({ status: { at, incomePerSec: income, wealth }, hacknet: { at, lastAugReset: lar, moneyPerSec: hacknet }, posterior: FX.posterior, lastAugReset: lar, goPower: n14.GoPower, sf14: 0 })
    const target = GPL.goMilestoneOf({ homeMax: 32, ramCostMult: n14.HomeComputerRamCost }).target
    // (a) BN14.1 19:26Z: script $8.59/s, hacknet $588.65/s, cash $3.77m; home's 5 early.js (12GB) of ~100GB of workers.
    const a = GPL.goPlaceValueOf({ streams: mk({ income: FB14.status.incomePerSec, hacknet: FB14.hacknet.moneyPerSec, wealth: 3771337 }), goPower: 4, sf14: 0, target, displacedGb: 12, workerGb: 12 + 6 * 14.4 + 7 })
    // (b) the same x8 with no hacknet and go.js taking every worker there is.
    const b = GPL.goPlaceValueOf({ streams: mk({ income: 50, hacknet: 0, wealth: 1e6 }), goPower: 4, sf14: 0, target, displacedGb: 40, workerGb: 40 })
    // (c) x2 (BN9 with SF14), hacking only, 60% of the workers displaced, the tier two hours away.
    const cc = GPL.goPlaceValueOf({ streams: mk({ income: 50, hacknet: 0, wealth: target - 50 * 7200 }), goPower: 1, sf14: 1, target, displacedGb: 24, workerGb: 40 })
    // (d) the same 60% with the tier 200h away: the farm's speed bonus outgrows the loss — the horizon is part of the price.
    const dd = GPL.goPlaceValueOf({ streams: mk({ income: 50, hacknet: 0, wealth: target - 50 * 3600 * 200 }), goPower: 1, sf14: 1, target, displacedGb: 24, workerGb: 40 })
    for (const [tag, v, want] of [['BN14.1 opening', a, true], ['x8, workers are the income', b, false], ['x2, 60% displaced, tier 2h away', cc, false], ['x2, 60% displaced, tier 200h away', dd, true]]) {
      c.examined(2)
      if (v.goFirst !== want) c.fail(`GP2 ${tag}: goFirst ${v.goFirst}, want ${want}`, v.why)
      if (v.priced && v.goFirst !== v.withoutH - v.withH > TOL) c.fail(`GP2 ${tag}: the verdict is not the comparison`)
      c.note(`${tag}: ${v.why.slice(0, 260)}`)
    }
    checks.push(c)
  }

  // ---- GP3 -------------------------------------------------------------------
  {
    const c = new Check('GP3', "the endpoint and the charge: GO_BOOT_TIER = boot.js's go.js tier; goMilestoneOf sums the game's RAM prices; a reserve charges the shortfall, at most the workers")
    const boot = SRC('boot.js')
    const m = boot.match(/script: 'go\.js',\s*where: 'home',\s*tier: (\d+)/)
    c.examined(3)
    if (!m || Number(m[1]) !== GPL.GO_BOOT_TIER) c.fail(`GP3 boot.js admits go.js at ${m?.[1]}GB, goplace.GO_BOOT_TIER is ${GPL.GO_BOOT_TIER}`)
    const ms = GPL.goMilestoneOf({ homeMax: 32, ramCostMult: n9.HomeComputerRamCost })
    const want = HC.ramUpgradeCost(32, 5) + HC.ramUpgradeCost(64, 5)
    if (Math.abs(ms.target - want) > 1 || ms.toRam !== 128 || Math.abs(HC.ramUpgradeCost(32, 5) - 50414492) > 1) c.fail(`GP3 BN9 32GB endpoint $${ms.target} (want $${want}, the live $50414492 + $159309795)`)
    const ms128 = GPL.goMilestoneOf({ homeMax: 128, ramCostMult: 5 })
    if (ms128.toRam !== 256 || Math.abs(ms128.target - HC.ramUpgradeCost(128, 5)) > 1) c.fail('GP3 at the tier the endpoint is the next upgrade')
    c.note(ms.why)
    // workersGb: a 32GB host of 13 early.js (31.2GB) for a 20.75GB block takes 19.95GB of them.
    const d = RP.raisedPlacementOf({ script: 'go.js', homeMax: 64, need: 20.75, tier: 8, hosts: [{ host: 'zer0', max: 32, used: 31.2, workerGb: 0, evictGb: 31.2 }] })
    c.examined(1)
    if (d.action !== 'reserve' || Math.abs(d.workersGb - 19.95) > 1e-9) c.fail(`GP3 reserve on zer0 must charge 19.95GB of workers, got ${d.workersGb}`, JSON.stringify(d))
    checks.push(c)
  }

  // ---- GP4 -------------------------------------------------------------------
  {
    const c = new Check('GP4', 'unpriced is said, never zero: no or stale status, another life, no target -> priced false, goFirst false, why names it')
    const target = 1e8
    const now = Date.now()
    const ok = streamsAt(FX.open32)
    const cases = [
      ['no status.txt', streamsAt(FX.open32, { status: null })],
      ['status 20 min old', streamsAt(FX.open32, { status: { ...FX.open32.status, at: new Date(now - 20 * 60e3).toISOString() } })],
      ['hacknet from another life', streamsAt(FX.open32, { lastAugReset: LAR + 1 })],
    ]
    for (const [tag, s] of cases) {
      c.examined(1)
      const v = GPL.goPlaceValueOf({ streams: s, goPower: 1, sf14: 3, target })
      if (s.ok || v.priced !== false || v.goFirst !== false || !/UNPRICED/.test(v.why)) c.fail(`GP4 ${tag}: must be unpriced, said so`, JSON.stringify({ ok: s.ok, why: s.why, v: v.why }))
    }
    c.examined(2)
    const vt = GPL.goPlaceValueOf({ streams: ok, goPower: 1, sf14: 3, target: null })
    if (vt.priced !== false || vt.goFirst) c.fail('GP4 no endpoint must be unpriced', vt.why)
    const vg = GPL.goPlaceValueOf({ streams: ok, goPower: undefined, sf14: 3, target })
    if (vg.effective !== null || vg.goFirst) c.fail('GP4 an unknown GoPower must read unknown (effective null)', JSON.stringify(vg))
    // Nothing reaches the endpoint: no income at all is not a verdict either way.
    const vz = GPL.goPlaceValueOf({ streams: { ...ok, hackIncome: 0, hacknetIncome: 0 }, goPower: 4, sf14: 1, target })
    c.examined(1)
    if (vz.priced !== false || vz.goFirst) c.fail('GP4 zero income on both runs must be unpriced (neither reaches the endpoint)', vz.why)
    checks.push(c)
  }

  // ---- GP5 -------------------------------------------------------------------
  {
    const c = new Check('GP5', 'the fixed threshold is gone, and brought back it disagrees with the comparison on the live BN9.2 state and on x8-with-nothing-to-gain')
    for (const f of ['raiseplace.js', 'seed.js', 'watchdog.js', 'tools/healthcheck.mjs', 'tools/gohealth.mjs']) {
      c.examined(1)
      const code = SRC(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      if (/goFirstOf|GO_FIRST_EFFECT/.test(code)) c.fail(`GP5 ${f} still uses the fixed threshold (goFirstOf / GO_FIRST_EFFECT)`)
    }
    for (const f of ['seed.js', 'watchdog.js']) {
      c.examined(1)
      if (!/goPlaceValueOf\(/.test(SRC(f))) c.fail(`GP5 ${f} must decide go.js's placement through goplace.goPlaceValueOf`)
    }
    c.examined(1)
    if (!/goVerdictOf\(/.test(SRC('tools/healthcheck.mjs'))) c.fail('GP5 the healthcheck must read the placers\' priced verdict (gohealth.goVerdictOf)')
    // The shortcut against the comparison, on the cases GP1/GP2 pin.
    const live = verdictAt(FX.open32, { keep: 9.25 }).v
    c.examined(2)
    if (threshold(1, 3) === live.goFirst) c.fail('GP5 the threshold and the comparison agree on live BN9.2 — the fixture no longer distinguishes them')
    else c.note(`BN9.2 32GB: threshold says ${threshold(1, 3) ? 'place' : 'wait'}, the comparison ${live.goFirst ? 'place' : 'wait'} (${(live.gainH * 60).toFixed(1)} min to $${(live.target / 1e6).toFixed(1)}m)`)
    // ...and x8 where go.js would take the only income (GP2's case b): the threshold places, the comparison waits.
    const at = new Date().toISOString()
    const lar = FB14.reset.lastAugReset
    const s8 = GPL.goPlaceStreamsOf({ status: { at, incomePerSec: 50, wealth: 1e6 }, hacknet: { at, lastAugReset: lar, moneyPerSec: 0 }, posterior: FX.posterior, lastAugReset: lar, goPower: 4, sf14: 0 })
    const v8 = GPL.goPlaceValueOf({ streams: s8, goPower: 4, sf14: 0, target: GPL.goMilestoneOf({ homeMax: 32, ramCostMult: 1 }).target, displacedGb: 40, workerGb: 40 })
    c.examined(1)
    if (threshold(4, 0) === v8.goFirst) c.fail('GP5 the threshold and the comparison agree on x8-with-the-workers-as-income — the case no longer distinguishes them', v8.why)
    checks.push(c)
  }

  // ---- GP6 -------------------------------------------------------------------
  {
    const c = new Check('GP6', 'seed.js placeGo on the live BN9.2 shapes: 32GB -> home (early.js evicted), 64GB -> a 32GB fleet host (its early.js evicted); refused -> nothing touched, the reservation released')
    const SEED = await import('seed.js')
    const mock = (snap, { files = {}, info = INFO9 } = {}) => {
      const hosts = Object.fromEntries(Object.entries(snap.maxRam).map(([h, max]) => [h, { max, procs: (snap.hosts[h] ?? []).map(([s, t]) => ({ filename: s, threads: t, ram: ramOf(s), args: [], pid: 0 })) }]))
      const world = { hosts, files: new Map(Object.entries(files)), execs: [], kills: [], prints: [] }
      let pid = 1
      const used = (h) => world.hosts[h].procs.reduce((a, p) => a + p.ram * p.threads, 0)
      const ns = {
        getResetInfo: () => info,
        getHostname: () => 'foodnstuff',
        write: (f, d) => world.files.set(f, String(d)),
        read: (f) => world.files.get(f) ?? '',
        scp: () => true,
        hasRootAccess: () => true,
        getServerMaxRam: (h) => world.hosts[h].max,
        getServerUsedRam: (h) => used(h),
        getScriptRam: (s) => RAM[s] ?? 2,
        getServerMoneyAvailable: () => snap.status.cash,
        ps: (h) => world.hosts[h].procs.map((p) => ({ filename: p.filename, threads: p.threads, args: p.args ?? [], pid: p.pid })),
        scriptKill: (s, h) => {
          const n = world.hosts[h].procs.length
          world.hosts[h].procs = world.hosts[h].procs.filter((p) => p.filename !== s)
          if (world.hosts[h].procs.length !== n) world.kills.push(`${s}@${h}`)
          return true
        },
        exec: (s, h, threads = 1, ...args) => {
          const ram = ramOf(s)
          if (world.hosts[h].max - used(h) < ram * threads) return 0
          world.hosts[h].procs.push({ filename: s, threads, ram, args, pid: ++pid })
          world.execs.push(`${s}@${h}`)
          return pid
        },
        sleep: async () => {},
        tprint: (m) => world.prints.push(String(m)),
      }
      return { ns, world }
    }
    const telFiles = (snap, over = {}) => {
      const r = restamp(snap)
      const out = { '/tel/status.txt': JSON.stringify({ ...r.status, ...(over.status ?? {}) }), '/tel/hacknet.txt': JSON.stringify({ ...r.hacknet, ...(over.hacknet ?? {}) }), '/tel/go-posterior.txt': JSON.stringify(FX.posterior) }
      if (r.stock) out['/tel/stock.txt'] = JSON.stringify(r.stock)
      return out
    }
    try {
      // (a) the 32GB opening.
      {
        const g = mock(FX.open32, { files: telFiles(FX.open32) })
        const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
        c.examined(3)
        if (host !== 'home' || !g.world.execs.includes('go.js@home')) c.fail('GP6a BN9.2 32GB: go.js must be placed on home', JSON.stringify({ host, execs: g.world.execs, kills: g.world.kills, rec: g.world.files.get(RP.RAISED['go.js'].file) }))
        if (!g.world.kills.includes('early.js@home')) c.fail('GP6a the home worker is what go.js displaces (evicted)', JSON.stringify(g.world.kills))
        if (g.world.kills.some((k) => !k.endsWith('@home'))) c.fail('GP6a nothing off home is touched', JSON.stringify(g.world.kills))
        c.note(`32GB: ${g.world.execs.join(', ')}; stopped ${g.world.kills.join(', ')}; ${g.world.prints.find((m) => /placed go\.js/.test(m))?.slice(0, 220) ?? ''}`)
      }
      // (b) 64GB with the trader's book: home keeps progress.js's block and the 19.4GB slot -> a fleet host.
      {
        const g = mock(FX.home64, { files: telFiles(FX.home64) })
        const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
        c.examined(2)
        if (!host || host === 'home' || !(g.world.hosts[host].max >= 32)) c.fail('GP6b BN9.2 64GB: go.js on a 32GB+ fleet host', JSON.stringify({ host, execs: g.world.execs, kills: g.world.kills, rec: g.world.files.get(RP.RAISED['go.js'].file) }))
        else if (!g.world.kills.includes(`early.js@${host}`)) c.fail(`GP6b the seed workers on ${host} are evicted for it`, JSON.stringify(g.world.kills))
        c.note(`64GB: go.js on ${host}; stopped ${g.world.kills.join(', ')}`)
      }
      // (c) a shape the comparison refuses: hacking is the income, hacknet none, go.js would take home's workers.
      {
        const solo = { ...FX.open32, hosts: { home: [['early.js', 4]] }, maxRam: { home: 32, foodnstuff: 16 } }
        const near = GPL.goMilestoneOf({ homeMax: 32, ramCostMult: n9.HomeComputerRamCost }).target - 40 * 7200
        const g = mock(solo, { files: telFiles(solo, { status: { incomePerSec: 40, wealth: near }, hacknet: { moneyPerSec: 0 } }) })
        const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
        const rec = JSON.parse(g.world.files.get(RP.RAISED['go.js'].file) ?? 'null')
        c.examined(2)
        if (host !== null || g.world.execs.length || g.world.kills.length) c.fail('GP6c a refused placement touches nothing', JSON.stringify({ host, execs: g.world.execs, kills: g.world.kills }))
        if (rec?.action !== 'wait' || rec?.host !== null || !/wait|never/.test(rec?.why ?? '')) c.fail("GP6c the reservation is released as 'wait' with the comparison's why", JSON.stringify(rec))
        c.note(`refused: ${String(rec?.why).slice(0, 200)}`)
      }
      // (d) no telemetry at all: unpriced, untouched, said.
      {
        const g = mock(FX.open32)
        const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
        const rec = JSON.parse(g.world.files.get(RP.RAISED['go.js'].file) ?? 'null')
        c.examined(1)
        if (host !== null || g.world.execs.length || g.world.kills.length || !/UNPRICED/.test(rec?.why ?? '')) c.fail('GP6d no telemetry: nothing placed, UNPRICED said', JSON.stringify({ host, rec }))
      }
    } catch (e) {
      c.fail(`GP6 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  // ---- GP7 -------------------------------------------------------------------
  {
    const c = new Check('GP7', "watchdog.js on the live BN9.2 64GB shape: go.js placed on a fleet host, the priced verdict published as daemons['go.js'].go and read back by gohealth.goVerdictOf")
    try {
      const { mockGame, drive, runningOn } = await import('./bbfull.test.mjs')
      const { goVerdictOf, goNodeHealth } = await import('../gohealth.mjs')
      const snap = FX.home64
      const hosts = Object.fromEntries(Object.entries(snap.maxRam).map(([h, max]) => [h, { max, procs: (snap.hosts[h] ?? []).map(([s, t]) => ({ filename: s, threads: t, ram: ramOf(s), pid: Math.floor(Math.random() * 1e6) })) }]))
      const r = restamp(snap)
      const files = { '/tel/plan.txt': 'null', '/tel/status.txt': JSON.stringify(r.status), '/tel/hacknet.txt': JSON.stringify(r.hacknet), '/tel/stock.txt': JSON.stringify(r.stock), '/tel/go-posterior.txt': JSON.stringify(FX.posterior) }
      const g = mockGame({ cycles: 3, info: INFO9, files, hosts })
      const orig = g.ns.getScriptRam
      g.ns.getScriptRam = (s, h) => RAM[s] ?? orig(s, h)
      const exec = g.ns.exec
      g.ns.exec = (s, h, t = 1, ...a) => {
        if (s !== 'go.js') return exec(s, h, t, ...a)
        const used = g.world.hosts[h].procs.reduce((x, p) => x + p.ram * p.threads, 0)
        if (g.world.hosts[h].max - used < 20.75) return 0
        g.world.hosts[h].procs.push({ filename: 'go.js', threads: 1, ram: 20.75, pid: 777 })
        g.world.execs.push({ script: 'go.js', host: h, cycle: g.world.cycle })
        return 777
      }
      const w = await drive(g)
      const wd = JSON.parse(w.files['/tel/watchdog.txt'] || 'null')
      const on = runningOn(w, 'go.js')
      c.examined(3)
      if (on.length !== 1 || on[0] === 'home') c.fail(`GP7 go.js must run on one fleet host, runs on ${JSON.stringify(on)}`, JSON.stringify({ rec: wd?.daemons?.['go.js'], kills: w.kills.slice(0, 8) }))
      const v = wd?.daemons?.['go.js']?.go
      if (!v || v.goFirst !== true || !(v.withoutH - v.withH > TOL)) c.fail("GP7 watchdog.txt daemons['go.js'].go must carry the placing comparison", JSON.stringify(v))
      const read = goVerdictOf({ seed: null, wd, state: { playtimeSinceLastAug: 30 * 60e3 } })
      if (!read?.goFirst) c.fail('GP7 goVerdictOf must read the watchdog\'s verdict', JSON.stringify(read))
      // The outcome check then fires on a 30-min life with no go.js record.
      const h = goNodeHealth({ state: { bitNode: 9, playtimeSinceLastAug: 30 * 60e3 }, go: null, verdict: read })
      c.examined(1)
      if (!h.fail) c.fail('GP7 a placing verdict with go.js absent 30 min must FAIL GO NOT PLAYING', JSON.stringify(h))
      c.note(`watchdog 64GB: go.js on ${on.join(', ')} — ${String(v?.why ?? '').slice(0, 200)}`)
    } catch (e) {
      c.fail(`GP7 threw: ${e?.stack ?? e}`)
    }
    checks.push(c)
  }

  return checks
}
