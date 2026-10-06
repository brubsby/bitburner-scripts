// [SL] A BLADEBURNER CLAIM ITS ACTOR CANNOT EXERCISE IS NOT A CLAIM.
//
// Live BN14.3 entry (2026-10-06 14:43Z), and BN14.2 before it (~9h): the work
// slot was Bladeburner's (act.js's bootstrap claim at combat 100; progress.js's
// slot.owner in BN14.2), bb-lite.js starved — "no rooted host has 13.6GB free
// for bb-lite-read.js": a 32GB home holding go.js (20.75GB) and act.js, a 16GB
// fleet holding seed.js's workers — so nothing acted on the claim, and act.js
// idled under it. The fix of 73a4644 (seed.js buys a 32GB bb-host for $1.76m)
// waited on cash nothing earned: at 15:18Z cash read -$13,213, the agility
// class act.js had started at 94/100 having run on past the bar. The lead
// unblocked it by hand with `run act-crime.js Homicide` at ~15:25Z.
//
//   SL1  bbliteplan.bladeSlotStallOf: the live bb-lite.txt (15:20Z) is stalled; not with bb-host
//        present, not with bb-lite acting, not with the full daemon in its loop, not with too few
//        or too old refusals; no actor at all is stalled only past STARVED_WINDOW_MS into the life
//   SL2  actplan.decide on the live shape (combat >= 100, cash -$13,213, starved bb-lite):
//        the bootstrap claim (0b) and progress.js's claim (block 0) both LEND the slot to the best
//        money crime, keep the claim (slot 'bladeburner' on 0b), and say so (`lent`, the bb-host
//        price); with bb-host present or bb-lite acting both defer as before; a gym class the
//        bootstrap started is stopped past the bar when nothing is stalled; the 0b gym starts only
//        while CASH covers FEE_FLOOR_S of its fee (it read `cash >= 0`)
//   SL3  act.js end to end on a mock game (BN14, SF4.3, RAM from the game's calculator): the live
//        world — home 32GB with go.js + act.js, bb-lite starved, a paid class running at -$13k —
//        stops the class and execs act-crime.js with the best money crime, publishes `lent` and
//        the stall; the next pass does NOT stop the crime on the minute-old snapshot that still
//        shows the class (softlockStep workAt/startedAt); bb-host on the network or bb-lite acting:
//        no crime
//   SL4  the claim reads honestly: bbslot.slotClaim keeps the claim ours and carries the lend;
//        bbhealth names BLADEBURNER SLOT STALLED, not ORDER NOT HELD; progress.js publishes
//        slot.bladeStall

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const LP = await import('bbliteplan.js')
const AP = await import('actplan.js')
const NE = await import('nodeecon.js')
const BS = await import('bbslot.js')
const BN = await import('bitNodeMultipliers.js')
const { bladeburnerHealth } = await import('../bbhealth.mjs')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

const n14 = BN.bitNodeMults(14)
const NOW = Date.now()
const LIFE = NOW - 40 * 60e3 // BN14.3 entered 14:43Z; the live shape is ~15:20Z
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const INFO = { currentNode: 14, lastAugReset: LIFE, lastNodeReset: LIFE, ownedSF: new Map([[1, 3], [4, 3], [5, 1], [2, 1], [10, 1], [8, 1], [9, 1], [6, 1]]), ownedAugs: new Map(), bitNodeOptions: {} }
const STARVED = 'no rooted host has 13.6GB free for bb-lite-read.js'
/** /tel/bb-lite.txt at 15:20:26Z, live (result actor-unplaced, five refusals in 30s). */
const liteRec = (o = {}) => ({
  at: iso(20e3), health: 'waiting', bitNode: 14, lastAugReset: LIFE, host: 'foodnstuff', daemon: 'bb-lite', reserve: null,
  result: 'actor-unplaced', joined: true, detail: `no reads yet: ${STARVED}`,
  actorErrors: [{ at: iso(50e3), why: STARVED }, { at: iso(35e3), why: 'no rooted host has 13.6GB free for bb-lite-level.js' }, { at: iso(35e3), why: STARVED }, { at: iso(20e3), why: 'no rooted host has 13.6GB free for bb-lite-level.js' }, { at: iso(20e3), why: STARVED }],
  ...o,
})
/** The player at 15:25Z (state.json): combat past 100, cash -$13,213 as at 15:18Z. */
const player = (o = {}) => {
  const exp = { hacking: 1119.66, strength: 4393.38, defense: 3516.94, dexterity: 3275.02, agility: 5871.17, charisma: 32.77, intelligence: 36952.4 }
  const mults = {}
  for (const s of Object.keys(exp)) {
    mults[s] = 1
    mults[`${s}_exp`] = 1
  }
  mults.crime_success = 1
  mults.crime_money = 1
  return { skills: { hacking: 20, strength: 127, defense: 116, dexterity: 113, agility: 142, charisma: 4, intelligence: 137 }, exp, mults, karma: -191.7, numPeopleKilled: 0, city: 'Sector-12', money: -13213, factions: [], ...o }
}
const NODE = { CrimeSuccessRate: n14.CrimeSuccessRate, CrimeMoney: n14.CrimeMoney, CrimeExpGain: n14.CrimeExpGain, GangSoftcap: n14.GangSoftcap, GangUniqueAugs: n14.GangUniqueAugs }
const HOST_COST = 32 * 55000 * (n14.CloudServerCost ?? 1)
const stallOf = (o = {}) => ({ ...LP.bladeSlotStallOf({ lite: liteRec(), full: null, info: INFO, bbHostExists: false, now: NOW, ...o }), hostCost: HOST_COST })
const blade = (o = {}) => ({ open: true, route: 'blade', joined: false, bar: 100, person: player(), ...o })
const base = (o = {}) => ({ now: NOW, gangNode: true, gangKarma: -54000, factions: [], player: player(), node: NODE, progress: null, schedule: null, work: null, tried: {}, equity: 0, blade: blade(), bladeStall: stallOf(), ...o })
const progressClaim = (owner = 'bladeburner', agoMs = 60e3) => ({ at: iso(agoMs), health: 'ok', slot: { owner } })

export async function run() {
  const checks = []

  // ---- SL1 ------------------------------------------------------------------
  {
    const c = new Check('SL1', 'bladeSlotStallOf: the live starved bb-lite is a stalled claim; bb-host, an acting bb-lite or the full daemon is not')
    const cases = [
      ['live 15:20Z: actor-unplaced, 5 refusals in 30s, no bb-host', {}, true],
      ['bb-host exists', { bbHostExists: true }, false],
      ['bb-host unknown (progress.js reads records only): still judged on the records', { bbHostExists: null }, true],
      ['bb-lite acting', { lite: liteRec({ result: 'started', actorErrors: [] }) }, false],
      ['two refusals, not three', { lite: liteRec({ actorErrors: [{ at: iso(10e3), why: STARVED }, { at: iso(5e3), why: STARVED }] }) }, false],
      ['refusals older than 10 min', { lite: liteRec({ actorErrors: [1, 2, 3].map((i) => ({ at: iso(11 * 60e3 + i), why: STARVED })) }) }, false],
      ['the full daemon in its loop', { full: { daemon: 'bladeburner.js', at: iso(30e3), lastAugReset: LIFE, health: 'ok', result: 'started' } }, false],
      ['no Bladeburner actor at all, 40 min into the life', { lite: null }, true],
      ['no Bladeburner actor at all, 5 min into the life', { lite: null, info: { ...INFO, lastAugReset: NOW - 5 * 60e3 } }, false],
      ['bb-lite.txt from the last life', { lite: liteRec({ lastAugReset: LIFE - 1 }), info: { ...INFO, lastAugReset: NOW - 5 * 60e3 } }, false],
    ]
    for (const [tag, o, want] of cases) {
      c.examined(1)
      const v = LP.bladeSlotStallOf({ lite: liteRec(), full: null, info: INFO, bbHostExists: false, now: NOW, ...o })
      if (v.stalled !== want) c.fail(`SL1 ${tag}: stalled ${v.stalled}, want ${want}`, v.why)
      else c.note(`${tag}: ${v.stalled ? 'STALLED' : 'not stalled'} — ${v.why}`)
    }
    // One test of starvation: seed.js's purchase and the lend agree.
    c.examined(1)
    if (!/liteStarvedOf\(lite, now\)/.test(SRC('bbliteplan.js').match(/export function liteHostBuyOf[\s\S]*?\n}\n/)?.[0] ?? '')) c.fail('SL1 liteHostBuyOf must judge starvation with liteStarvedOf (one test for the buy and the lend)')
    checks.push(c)
  }

  // ---- SL2 ------------------------------------------------------------------
  {
    const c = new Check('SL2', 'actplan.decide, live shape: a stalled Bladeburner claim lends the slot to the best money crime (both claimants); bb-host or an acting bb-lite defers; no gym fee past the bar or below the cash floor')
    const want = (tag, d, pred, why = '') => {
      c.examined(1)
      if (!pred(d)) c.fail(`SL2 ${tag}${why ? `: ${why}` : ''}`, JSON.stringify(d))
      else c.note(`${tag}: ${d.kind}${d.args ? ` ${JSON.stringify(d.args)}` : ''} — ${String(d.why).slice(0, 220)}`)
    }
    // 0b: the bootstrap's claim (no planner pass this life — the BN14.3 shape).
    const d0b = AP.decide(base())
    want('0b, starved, cash -$13,213', d0b, (d) => d.kind === 'crime' && d.slot === 'bladeburner' && d.lent?.owner === 'bladeburner' && d.lent.to === d.args[0] && /bb-host/.test(d.why) && /\$1760000|1760000/.test(d.why), 'crime under the kept claim, lent, priced against the bb-host')
    const money = AP.decide(base()).args?.[0]
    want('0b, the lent crime already running', AP.decide(base({ work: { kind: 'crime', type: money } })), (d) => d.kind === 'idle' && d.slot === 'bladeburner' && d.lent?.to === money)
    want('0b, bb-host present', AP.decide(base({ bladeStall: stallOf({ bbHostExists: true }) })), (d) => d.kind === 'idle' && d.slot === 'bladeburner' && !d.lent)
    want('0b, bb-lite acting', AP.decide(base({ bladeStall: stallOf({ lite: liteRec({ result: 'started', actorErrors: [] }) }) })), (d) => d.kind === 'idle' && d.slot === 'bladeburner' && !d.lent)
    want('0b, no stall verdict (old act.js)', AP.decide(base({ bladeStall: undefined })), (d) => d.kind === 'idle' && d.slot === 'bladeburner')
    // Block 0: progress.js's claim (the BN14.2 shape).
    const d0 = AP.decide(base({ progress: progressClaim('bladeburner') }))
    want("block 0, progress.js's 'bladeburner' claim, starved", d0, (d) => d.kind === 'crime' && d.lent?.by === 'progress.js' && !d.slot, 'crime, lent by progress.js, no bootstrap slot record')
    want("block 0, progress.js's claim, bb-host present", AP.decide(base({ progress: progressClaim('bladeburner'), bladeStall: stallOf({ bbHostExists: true }) })), (d) => d.kind === 'idle' && /holds the work slot for bladeburner/.test(d.why))
    want("block 0, progress.js's claim, bb-lite acting", AP.decide(base({ progress: progressClaim('bladeburner'), bladeStall: stallOf({ lite: liteRec({ result: 'started', actorErrors: [] }) }) })), (d) => d.kind === 'idle')
    want("block 0, a 'faction' claim is never lent", AP.decide(base({ progress: progressClaim('faction') })), (d) => d.kind === 'idle' && !d.lent)
    // The crime is the best money crime at these stats.
    {
      const BP = await import('bodyplan.js')
      const best = BP.bestCrimeFor('money', player(), NODE, { focus: 1 })
      c.examined(1)
      if (best?.crime !== d0b.args?.[0]) c.fail(`SL2 the lent crime must be bodyplan.bestCrimeFor('money'): ${best?.crime} vs ${d0b.args?.[0]}`)
      else c.note(`best money crime at combat 113-142: ${best.crime} ($${Math.round(best.rates.money)}/s) — bb-host in ~${((HOST_COST + 13213) / best.rates.money / 60).toFixed(0)} min`)
    }
    // No fee past the bar: the gym class the bootstrap started is stopped when nothing is stalled.
    want('0b at the bar, the bootstrap gym class still running, bb-lite acting', AP.decide(base({ work: { kind: 'gym', stat: 'agility' }, player: player({ money: 4e5 }), bladeStall: stallOf({ lite: liteRec({ result: 'started', actorErrors: [] }) }) })), (d) => d.kind === 'stop' && d.slot === 'bladeburner')
    want('0b at the bar, gym class running, stalled: the crime replaces it', AP.decide(base({ work: { kind: 'gym', stat: 'agility' } })), (d) => d.kind === 'crime' && !!d.lent)
    // The cash floor on the 0b gym (agility 94/100, Powerhouse $2,400/s): $200k
    // is under 120s of the fee, so no class; $585k starts it; equity raises it.
    const short = (money, equity = 0) => AP.decide(base({ player: player({ money, skills: { ...player().skills, agility: 94 }, exp: { ...player().exp, agility: 3000 } }), blade: blade({ person: player({ money, skills: { ...player().skills, agility: 94 }, exp: { ...player().exp, agility: 3000 } }) }), equity }))
    const fee = NE.CLASS_BASE_FEE.gym * 20
    for (const [money, equity, ok] of [[200e3, 0, (d) => d.kind !== 'gym'], [585e3, 0, (d) => true], [100e3, 5e6, (d) => d.kind !== 'gym']]) {
      const d = short(money, equity)
      want(`0b agility 94/100, cash $${money}, equity $${equity}`, d, (x) => ok(x) && (x.kind !== 'gym' || NE.feeFundable(money, fee)), `a gym started on cash under ${NE.FEE_FLOOR_S}s of $${fee}/s`)
    }
    {
      c.examined(1)
      const src = SRC('actplan.js')
      if (/if \(cash >= 0\) return \{ kind: 'gym'/.test(src)) c.fail("SL2 the 0b gym must start on feeFundable(cash, fee), not `cash >= 0`")
    }
    checks.push(c)
  }

  // ---- SL3 ------------------------------------------------------------------
  {
    const c = new Check('SL3', 'act.js on a mock BN14 game, live world: stops the class, runs the money crime under the lent claim, does not stop it on a stale snapshot; defers with bb-host or an acting bb-lite')
    try {
      const R = await import('./ram.mjs')
      await R.load()
      R.asSave({ bitNode: 14, sf: Object.fromEntries(INFO.ownedSF) })
      const priced = (s) => {
        const r = R.ramOf(s)
        if (!r || r.error || !Number.isFinite(r.cost)) throw new Error(`${s} does not price: ${r?.error ?? '?'}`)
        return r.cost
      }
      const ACT = await import('act.js')
      const STOP = new Error('SL3-STOP')
      const runAct = async ({ hosts, files, cash = -13213, passes = 1, player: pl = player({ money: cash }) }) => {
        const w = { files: new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])), execs: [], sleeps: 0, publishes: [] }
        const used = (h) => hosts[h].procs.reduce((a, p) => a + priced(p), 0)
        const ns = {
          disableLog() {},
          print() {},
          atExit() {},
          getResetInfo: () => INFO,
          getHostname: () => 'home',
          write: (f, d, mode) => {
            w.files.set(f, mode === 'a' ? (w.files.get(f) ?? '') + String(d) : String(d))
            if (f === '/tel/act.txt') w.publishes.push(JSON.parse(String(d)))
          },
          read: (f) => w.files.get(f) ?? '',
          scp: () => true,
          scan: (h) => (h === 'home' ? Object.keys(hosts).filter((x) => x !== 'home') : ['home']),
          hasRootAccess: () => true,
          getServerMaxRam: (h) => hosts[h].max,
          getServerUsedRam: (h) => used(h),
          getScriptRam: (s) => priced(s),
          getServerMoneyAvailable: () => cash,
          getPlayer: () => pl,
          getServer: () => ({ cpuCores: 1, backdoorInstalled: false }),
          serverExists: () => true,
          gang: { inGang: () => false },
          isRunning: () => false,
          exec: (s, h, t = 1, ...args) => {
            if (hosts[h].max - used(h) < priced(s) - 1e-9) return 0
            w.execs.push({ s, h, args })
            const kind = { 'act-crime.js': 'crime', 'act-stop.js': 'stop', 'act-gym.js': 'gym' }[s]
            if (kind) w.files.set('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: kind, args, ok: true }))
            return w.execs.length
          },
          sleep: async () => {
            w.sleeps++
            // One nap per pass; an error pass (no decision) still ends the run, loudly below.
            if (w.publishes.filter((p) => p.decision).length >= passes || w.sleeps > passes + 2) throw STOP
          },
        }
        try {
          await ACT.main(ns)
        } catch (e) {
          if (e !== STOP) throw e
        }
        return w
      }
      // The live world: home 32GB holding go.js and act.js; seed.js + bb-lite.js on foodnstuff; seed's early.js on the rest.
      const world = (extra = {}) => ({
        home: { max: 32, procs: ['go.js', 'act.js'] },
        foodnstuff: { max: 16, procs: ['seed.js', 'bb-lite.js'] },
        'sigma-cosmetics': { max: 16, procs: ['early.js', 'early.js', 'early.js'] },
        joesguns: { max: 16, procs: ['early.js', 'early.js', 'early.js'] },
        n00dles: { max: 4, procs: [] },
        ...extra,
      })
      // The rep snapshot: a paid class (the agility class past the bar), read 30s ago.
      const repSnap = { at: iso(30e3), lastAugReset: LIFE, data: { work: { type: 'CLASS', classType: 'agi', location: 'Powerhouse Gym' } } }
      const files = (o = {}) => ({ '/tel/bb-lite.txt': liteRec(o.lite), '/tel/bladeburner.txt': { at: iso(10 * 60e3), bitNode: 14, lastAugReset: LIFE, daemon: 'bb-lite', joined: false, result: 'not-joined' }, '/tel/snap-rep.txt': repSnap, ...(o.extra ?? {}) })
      {
        const actorGb = priced('bb-lite-read.js')
        const hs = world()
        const fits = Object.keys(hs).filter((h) => hs[h].max - hs[h].procs.reduce((a, p) => a + priced(p), 0) >= actorGb)
        c.examined(1)
        if (fits.length) c.fail(`SL3 the live world must starve the ${actorGb}GB bb-lite actor; it fits on ${fits.join(', ')}`)
      }
      // Pass 1 and 2 on the live world.
      const w = await runAct({ hosts: world(), files: files(), passes: 2 })
      const execs = w.execs.map((e) => e.s)
      const pub = w.publishes.filter((p) => p.decision)
      const errs = w.publishes.filter((p) => p.health === 'error' && !/SL3-STOP/.test(String(p.detail)))
      if (errs.length) c.fail('SL3 act.js threw inside its pass on the mock', JSON.stringify(errs.map((p) => p.detail)))
      c.examined(1)
      const crime = w.execs.find((e) => e.s === 'act-crime.js')
      const stops = w.execs.filter((e) => e.s === 'act-stop.js')
      if (!crime) c.fail('SL3 live world: act.js must exec act-crime.js under the stalled claim', JSON.stringify({ execs, decisions: pub.map((p) => p.decision) }))
      else c.note(`pass 1: ${execs.filter((s) => !/^snap-/.test(s)).join(', ')} — crime ${JSON.stringify(crime.args)} on ${crime.h}`)
      if (stops.length !== 1) c.fail(`SL3 the paid class at -$13k is stopped exactly once (the escape); the second pass must not stop the crime on the snapshot read before it started — ${stops.length} stops`, JSON.stringify(execs))
      if (execs.indexOf('act-stop.js') > execs.indexOf('act-crime.js')) c.fail('SL3 the stop must precede the crime', JSON.stringify(execs))
      const last = pub[pub.length - 1]
      if (!last?.lent || last.lent.owner !== 'bladeburner' || last.lent.to !== crime?.args?.[0] || last.slot?.owner !== 'bladeburner') c.fail('SL3 act.txt must publish the lend and keep the Bladeburner claim', JSON.stringify({ lent: last?.lent, slot: last?.slot }))
      if (last?.bladeStall?.stalled !== true) c.fail('SL3 act.txt must publish the stall verdict', JSON.stringify(last?.bladeStall))
      if (last && !(last.softlock?.level >= 1)) c.fail('SL3 the escape still reports the negative cash (level >= 1)', JSON.stringify(last.softlock))
      if (pub.length >= 2) c.note(`pass 2: ${pub[1].decision.kind} — ${String(pub[1].decision.why).slice(0, 160)}; softlock: ${String(pub[1].softlock?.why ?? '').slice(0, 160)}`)
      // bb-host on the network: no crime (the purchase the money was for is made).
      const wh = await runAct({ hosts: world({ 'bb-host': { max: 32, procs: [] } }), files: files() })
      c.examined(1)
      if (wh.execs.some((e) => e.s === 'act-crime.js')) c.fail('SL3 bb-host present: act.js must defer to the Bladeburner claim (no crime)', JSON.stringify(wh.execs.map((e) => e.s)))
      // bb-lite acting: no crime.
      const wa = await runAct({ hosts: world(), files: files({ lite: { result: 'started', actorErrors: [] } }) })
      c.examined(1)
      if (wa.execs.some((e) => e.s === 'act-crime.js')) c.fail('SL3 bb-lite acting: act.js must defer (no crime)', JSON.stringify(wa.execs.map((e) => e.s)))
      // progress.js's claim (the BN14.2 shape): the same lend.
      const wp = await runAct({ hosts: world(), files: files({ extra: { '/tel/progress.txt': progressClaim('bladeburner', 60e3) } }) })
      c.examined(1)
      if (!wp.execs.some((e) => e.s === 'act-crime.js')) c.fail("SL3 progress.js's 'bladeburner' claim, starved: act.js must lend the slot to the crime", JSON.stringify(wp.execs.map((e) => e.s)))
      else c.note("progress.js's claim, starved: act-crime.js too (block 0)")
    } catch (e) {
      c.fail(`SL3 threw: ${e?.stack ?? e}`)
    }
    // The escape's rule itself.
    {
      const rec = { ok: false, why: 'stale' }
      const cls = { type: 'CLASS', classType: 'agi' }
      const a = NE.softlockStep({ cash: -13213, stock: rec, work: cls, workAt: NOW - 30e3, startedAt: NOW - 5e3, now: NOW })
      const b = NE.softlockStep({ cash: -13213, stock: rec, work: cls, workAt: NOW - 1e3, startedAt: NOW - 5e3, now: NOW })
      const legacy = NE.softlockStep({ cash: -13213, stock: rec, work: cls, now: NOW })
      c.examined(3)
      if (a.actions.some((x) => x.kind === 'stop')) c.fail('SL3 softlockStep: a class read BEFORE act.js last started work stops nothing', JSON.stringify(a))
      if (!b.actions.some((x) => x.kind === 'stop')) c.fail('SL3 softlockStep: a class read AFTER the last start is stopped', JSON.stringify(b))
      if (!legacy.actions.some((x) => x.kind === 'stop')) c.fail('SL3 softlockStep: without the stamps the class is stopped as before', JSON.stringify(legacy))
    }
    checks.push(c)
  }

  // ---- SL4 ------------------------------------------------------------------
  {
    const c = new Check('SL4', 'the lent claim reads honestly: slotClaim keeps it ours and names the lend; bbhealth says BLADEBURNER SLOT STALLED; progress.js publishes slot.bladeStall')
    const fakeNs = (files) => ({ read: (f) => (files[f] === undefined ? '' : JSON.stringify(files[f])) })
    const lent = { owner: 'bladeburner', by: "act.js's bootstrap", to: 'Homicide', why: 'bb-lite cannot act', at: iso(10e3), lastAugReset: LIFE }
    const act = { at: iso(10e3), slot: { owner: 'bladeburner', at: iso(10e3), lastAugReset: LIFE, why: 'held' }, lent }
    const r1 = BS.slotClaim(fakeNs({ '/tel/act.txt': act }), 'home', INFO, NOW)
    const r2 = BS.slotClaim(fakeNs({ '/tel/act.txt': { ...act, lent: null } }), 'home', INFO, NOW)
    const r3 = BS.slotClaim(fakeNs({ '/tel/act.txt': act, '/tel/progress.txt': { at: iso(60e3), slot: { owner: 'bladeburner' } } }), 'home', INFO, NOW)
    const r4 = BS.slotClaim(fakeNs({ '/tel/act.txt': { ...act, lent: { ...lent, lastAugReset: LIFE - 1 } } }), 'home', INFO, NOW)
    c.examined(4)
    if (!(r1.ours === true && r1.lent?.to === 'Homicide' && /lent to Homicide/.test(r1.why))) c.fail('SL4 a lent bootstrap claim stays ours (bb-lite acts the moment it can; seed.js buys on it) and names the lend', JSON.stringify(r1))
    if (!(r2.ours === true && r2.lent === null)) c.fail('SL4 no lend: lent null, explicitly', JSON.stringify(r2))
    if (!(r3.ours === true && r3.by === 'progress.js' && r3.lent?.to === 'Homicide')) c.fail("SL4 progress.js's claim carries act.js's lend too", JSON.stringify(r3))
    if (r4.lent) c.fail("SL4 a lend from another life is no lend", JSON.stringify(r4))
    // bbhealth: the stall's own name.
    const state = { bitNode: 14, sourceFiles: { ctor: 'JSONMap', data: [...INFO.ownedSF] }, playtimeSinceLastAug: NOW - LIFE, home: { ram: 32 }, currentWork: { ctor: 'CrimeWork', data: { type: 'CRIME' } } }
    const bb = { at: iso(30e3), bitNode: 14, lastAugReset: LIFE, daemon: 'bb-lite', joined: true, result: 'actor-unplaced', detail: STARVED, health: 'waiting', running: null }
    const h = bladeburnerHealth({ bb, lite: liteRec(), pr: { at: iso(60e3), slot: { owner: 'bladeburner' } }, act: { ...act, lent: { ...lent, to: 'Homicide' } }, state, nowMs: NOW })
    const names = h.fails.map((f) => f.what)
    c.examined(1)
    if (!names.some((n) => /^BLADEBURNER SLOT STALLED/.test(n))) c.fail('SL4 bbhealth must fail BLADEBURNER SLOT STALLED on a lent slot', JSON.stringify(names))
    if (names.some((n) => /^ORDER NOT HELD/.test(n))) c.fail('SL4 a lent slot running its crime is not ORDER NOT HELD', JSON.stringify(names))
    const h2 = bladeburnerHealth({ bb, lite: liteRec(), pr: { at: iso(60e3), slot: { owner: 'bladeburner' } }, act: { ...act, lent: null }, state, nowMs: NOW })
    c.examined(1)
    if (!h2.fails.some((f) => /^ORDER NOT HELD/.test(f.what))) c.fail('SL4 crime under an unlent Bladeburner claim is still ORDER NOT HELD', JSON.stringify(h2.fails.map((f) => f.what)))
    else c.note(`lent: ${names.filter((n) => /STALLED/.test(n)).join('; ')}`)
    // progress.js: the claim's honesty on its record.
    c.examined(1)
    const p = SRC('progress.js')
    if (!/bladeStall: slotOwner === 'bladeburner' \? bladeSlot : null/.test(p) || !/bladeSlotStallOf\(\{ lite: readJson\(ns, LITE_FILE\), full: readJson\(ns, BB_FILE\), info \}\)/.test(p)) c.fail('SL4 progress.js must publish slot.bladeStall from bladeSlotStallOf on the daemons\' records')
    // act.js: the stall is computed and the lend published every pass (null explicitly).
    c.examined(1)
    const a = SRC('act.js')
    if (!/bladeStall: bladeStallFor\(ns, info, node\)/.test(a) || !/const lent = d\.lent \?/.test(a) || !/publish\(\{[^)]*\blent, bladeStall: state\.bladeStall/.test(a)) c.fail('SL4 act.js must feed bladeStall to decide and publish lent + bladeStall every pass')
    checks.push(c)
  }
  return checks
}
