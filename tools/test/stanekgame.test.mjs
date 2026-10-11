// Stanek's Gift IN THE GAME — stanek.js (accept, place, charger), charge.js, act.js's
// purchase gate, progress.js's allocation, batch.js's hold, the health check.
//
//   SG1 THE GATE'S TRUTH TABLE (stanekplan.giftStateOf / giftOrderGate): in BN13 before the
//       accept a non-NFG buyaug, a graft and an install are refused and NFG is not; accepted,
//       or not a gift node (BN7; SF13 outside BN13), nothing is refused; FORFEITED (a non-NFG
//       aug installed) is not blocked but flagged with a reason naming it.
//   SG2 THE SHIPPED LAYOUTS are the gameplan's (tools/sim/gameplan/stanek.mjs layoutFor at
//       BN13's extra size 1 / power 2, SF13 0..3), keyed by the grid the game computes
//       (giftSize), and every placement is legal in order (canPlace — ST1 checks canPlace
//       against the game's own StaneksGift).
//   SG3 A MOCK BN13 START: the game's accept rule (Helper.tsx canAcceptStaneksGift: nothing but
//       NFG installed OR queued), a planner batch [NFG, BitWire, a graft, install] dispatched
//       through the gate BEFORE stanek.js has run, then stanek.js's real main() against a
//       mock ns, then the batch again. Asserts: the accept precedes the first non-NFG
//       purchase; no state ever has a non-NFG aug queued/installed without Genesis; the layout
//       is placed and the charger launched at the default fraction; a second run is a no-op.
//       RED: the same scenario with an all-allowing gate is caught by the same detector.
//   SG4 THE BAN PATH IS NEVER SILENT: a hand-installed non-NFG aug (forfeited) -> stanek.js
//       health 'fail' and GIFT NOT ACCEPTED from stanekHealthOf; a hand-QUEUED one ->
//       acceptGift refused, health 'fail', GIFT NOT ACCEPTED (refused), and the gate refuses
//       the install that would make it permanent. A running charger whose gift charge mass
//       stays flat pass to pass, or a gathered charge.js error -> FRAGMENTS NOT CHARGING.
//   SG5 THE CHOKE POINTS (static): act.js's runActor gates buyaug/graft/install before its
//       exec, the order loop gates before the install branch; no root script but the three
//       actors calls purchaseAugmentation / installAugmentations / graftAugmentation;
//       progressBlockGb equals batch.js SETTINGS.homeReserve; batch.js holds stanekHoldsOf on
//       every host; progress.js prices fractions of stanek.js's measured fleet (basis 'fleet'); the watchdog JOB and the boot manifest declare stanek.js; progress.js prices
//       every option through chargeInputsOf and the trajectory.
//   SG6 THE ALLOCATION IS A COMPARISON OF EXITS: at f = the measured fraction the inputs are
//       the measured ones (same exit hours); chooseAlloc returns the min of the priced exits
//       (and keeps an incumbent within tolerance); the RAM side is priced (the same GB costs
//       more of a smaller fleet); the placement concentrates (highestCharge = one script). exitplan.bestExitPolicy on a fixture.
//       NOT CALIBRATED: no node of this playthrough has run the gift (stanekplan header).
//   SG8 THE LIVE SHAPE: a full 1-core home, rooted hosts free or full of h/g/w, no decision ->
//       the charger runs on the fleet at DEFAULT_F (UNPRICED), batch.js holds the rest per
//       host, heartbeats gathered home, the fragments charge. RED: home only -> named cause.
//   SG7 THE GIFT PINS THE HACKING ROUTE (routepin.giftPinOf): accepted and no file pin -> 'hack',
//       a priced 'blade' acted on as 'hack' with the hours forgone; a file pin is kept.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import './gameresolve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const sp = await import('../../stanekplan.js')
const { canAccessCotMG } = await import('../../sfgate.js')
const stateOf = (ri) => sp.giftStateOf(ri, canAccessCotMG(ri))
const NFG = sp.NFG
const GEN = sp.GENESIS

const info = (node, installed = [], sf13 = 0) => ({ currentNode: node, lastAugReset: 1000, lastNodeReset: 0, ownedSF: new Map(sf13 ? [[13, sf13]] : []), ownedAugs: new Map(installed.map((n) => [n, 1])) })

function sg1() {
  const c = new Check('SG1', "the purchase gate's truth table (giftStateOf / giftOrderGate)")
  const cases = [
    // [label, info, order, allow, forfeited]
    ['BN13 fresh: non-NFG buyaug', info(13), { kind: 'buyaug', args: ['CyberSec', 'BitWire'] }, false, false],
    ['BN13 fresh: NFG buyaug', info(13), { kind: 'buyaug', args: ['CyberSec', NFG] }, true, false],
    ['BN13 fresh: graft', info(13), { kind: 'graft', args: ['BitWire'] }, false, false],
    ['BN13 fresh: install', info(13), { kind: 'install', args: ['boot.js'] }, false, false],
    ['BN13 fresh, NFG installed: install', info(13, [NFG]), { kind: 'install', args: [] }, false, false],
    ['BN13 fresh: work', info(13), { kind: 'work', args: [] }, true, false],
    ['BN13 accepted: non-NFG buyaug', info(13, [GEN, NFG, 'BitWire']), { kind: 'buyaug', args: ['x', 'BitWire'] }, true, false],
    ['BN13 accepted: install', info(13, [GEN]), { kind: 'install', args: [] }, true, false],
    ['BN13 forfeited: buyaug', info(13, ['BitWire']), { kind: 'buyaug', args: ['x', 'NeuroTrainer I'] }, true, true],
    ['BN7: non-NFG buyaug', info(7), { kind: 'buyaug', args: ['x', 'BitWire'] }, true, false],
    ['BN7 with SF13: install', info(7, [], 1), { kind: 'install', args: [] }, true, false],
  ]
  c.examined(cases.length)
  for (const [label, ri, o, allow, forfeited] of cases) {
    const st = stateOf(ri)
    const g = sp.giftOrderGate(st, o)
    if (g.allow !== allow) c.fail(`${label}: allow ${g.allow}, expected ${allow}`, g.why ?? st.why)
    if (!!g.forfeited !== forfeited) c.fail(`${label}: forfeited ${g.forfeited}, expected ${forfeited}`)
    if (!allow && !/STANEK GATE/.test(g.why ?? '')) c.fail(`${label}: a refusal must say why (STANEK GATE ...)`, g.why)
    if (forfeited && !/FORFEITED/.test(g.why ?? '')) c.fail(`${label}: a forfeit must be named`, g.why)
  }
  const s7 = stateOf(info(7, [], 1))
  if (s7.want !== false || !s7.available) c.fail('SF13 outside BN13: available but not wanted (GIFT_NODES)', JSON.stringify(s7))
  return c
}

async function sg7() {
  const c = new Check('SG7', "the gift pins the hacking route (routepin.giftPinOf): the gameplan's stanek route = hack + gift")
  const rp = await import('../../routepin.js')
  const none = rp.routePinOf('', 13)
  const acc = stateOf(info(13, [GEN]))
  const pin = rp.giftPinOf(none, acc)
  c.examined(4)
  if (!pin.pinned || pin.route !== 'hack') c.fail('gift accepted, no file pin: must pin hack', JSON.stringify(pin))
  const d = rp.pinnedRouteOf({ key: 'blade', hackH: 30, bladeH: 20, why: 'priced' }, pin)
  if (d.key !== 'hack' || d.pin?.pricedKey !== 'blade' || d.pin?.forgoneH !== 10) c.fail("a priced 'blade' route must be acted on as 'hack' with the hours forgone published", JSON.stringify(d))
  if (rp.giftPinOf(none, stateOf(info(13))).pinned) c.fail('not accepted: no pin from the gift')
  const file = rp.routePinOf('hack 13', 13)
  if (rp.giftPinOf(file, acc) !== file) c.fail('a file pin must be kept as it is')
  return c
}

async function sg2() {
  const c = new Check('SG2', 'the shipped layouts = the gameplan optimiser at BN13, legal on the game grid')
  const { layoutFor } = await import('../sim/gameplan/stanek.mjs')
  const m = { StaneksGiftExtraSize: 1, StaneksGiftPowerMultiplier: 2 } // BitNode.tsx case 13
  for (const l13 of [0, 1, 2, 3]) {
    const { width, height } = sp.giftSize(1, l13)
    const key = `${width}x${height}|2`
    const tab = sp.LAYOUTS[key]
    c.examined(1)
    if (!tab) {
      c.fail(`no shipped layout for BN13 at SF13 ${l13} (${key})`)
      continue
    }
    const ref = layoutFor(m, l13)
    if (JSON.stringify(ref.placed) !== JSON.stringify(tab)) c.fail(`${key}: shipped layout differs from layoutFor (the optimiser changed: re-table stanekplan.LAYOUTS)`, JSON.stringify(ref.placed))
    for (let i = 0; i < tab.length; i++) {
      const p = tab[i]
      if (!sp.canPlace(tab.slice(0, i), width, height, p.x, p.y, p.rot, sp.fragmentById(p.id))) c.fail(`${key}: placement ${i} (${JSON.stringify(p)}) is illegal`)
    }
    const lf = sp.layoutForGrid(width, height, 2)
    if (lf.placed !== tab) c.fail(`${key}: layoutForGrid did not return the table`)
    c.note(`${key} (SF13 ${l13}): ${tab.length} fragments, ${sp.chargeRootsOf(tab).length} charged`)
  }
  const fb = sp.layoutForGrid(4, 3, 0.5)
  if (!/searched in-game/.test(fb.source)) c.fail('an untabled grid must say it was searched in-game', fb.source)
  return c
}

/** The game, as far as the gift is concerned: Helper.tsx canAcceptStaneksGift, Stanek.ts, the aug queue. */
function mockGame({ node = 13, sf13 = 0, installed = [], queued = [], homeMax = 1024, homeUsed = 100, homeCores = 4, others = [] } = {}) {
  const g = { installed: new Map(installed.map((n) => [n, 1])), queued: [...queued], frags: [], charge: new Map(), log: [], files: {}, remote: {}, procs: [], nextPid: 10, atExit: null }
  // The fleet: home + `others` [{ host, max, used (non-charger use), cores, workers: [{filename, threads}] }].
  g.hosts = new Map([['home', { max: homeMax, used: homeUsed, cores: homeCores, workers: [] }], ...others.map((o) => [o.host, { max: o.max, used: o.used, cores: o.cores ?? 1, workers: o.workers ?? [] }])])
  const usedOn = (h) => g.hosts.get(h).used + g.procs.filter((p) => p.host === h).reduce((s, p) => s + p.threads * 2, 0)
  // One second of every running charge.js (StaneksGift.charge at its threads x core bonus, round robin).
  g.tick = (rounds = 1) => {
    for (let r = 0; r < rounds; r++)
      for (const p of g.procs.filter((q) => q.filename === 'charge.js'))
        for (const [x, y] of JSON.parse(p.args[0])) {
          const key = `${x},${y}`
          const af = g.charge.get(key) ?? { highestCharge: 0, numCharge: 0 }
          g.charge.set(key, sp.chargeOnce(af, p.threads * sp.coreBonus(g.hosts.get(p.host).cores)))
        }
  }
  const grid = sp.giftSize(1, sf13)
  const canAccept = () => (node === 13 || sf13 > 0) && [...g.installed.keys(), ...g.queued].filter((a) => a !== NFG).length === 0
  const need = () => {
    if (!g.installed.has(GEN)) throw new Error("Stanek's Gift is not installed")
  }
  g.event = (ev, name = null) => g.log.push({ ev, name, gift: g.installed.has(GEN), queued: [...g.queued], installed: [...g.installed.keys()] })
  g.ns = {
    disableLog() {},
    atExit(f) {
      g.atExit = f
    },
    getResetInfo: () => ({ currentNode: node, lastAugReset: 1000, lastNodeReset: 0, ownedSF: new Map(sf13 ? [[13, sf13]] : []), ownedAugs: new Map(g.installed) }),
    stanek: {
      acceptGift() {
        if (g.installed.has(GEN)) return true
        if (!canAccept()) return false
        g.installed.set(GEN, 1)
        g.event('accept')
        return true
      },
      giftWidth: () => (need(), grid.width),
      giftHeight: () => (need(), grid.height),
      activeFragments: () => (need(), g.frags.map((p) => ({ id: p.id, x: p.x, y: p.y, rotation: p.rot, type: sp.fragmentById(p.id).type, highestCharge: g.charge.get(`${p.x},${p.y}`)?.highestCharge ?? 0, numCharge: g.charge.get(`${p.x},${p.y}`)?.numCharge ?? 0, chargedEffect: 1 }))),
      clearGift() {
        need()
        g.frags = []
        g.event('clear')
      },
      placeFragment(x, y, rot, id) {
        need()
        const f = sp.fragmentById(id)
        if (!sp.canPlace(g.frags, grid.width, grid.height, x, y, rot, f)) return false
        g.frags.push({ id, x, y, rot })
        return true
      },
    },
    read: (f) => g.files[f] ?? '',
    write: (f, d) => {
      g.files[f] = d
    },
    scan: (h) => (h === 'home' ? [...g.hosts.keys()].filter((x) => x !== 'home') : ['home']),
    hasRootAccess: (h) => g.hosts.has(h),
    getServerMaxRam: (h) => g.hosts.get(h).max,
    getServerUsedRam: (h) => usedOn(h),
    getServer: (h) => ({ cpuCores: g.hosts.get(h).cores }),
    getScriptRam: () => 1.75,
    ps: (h) => [...g.hosts.get(h).workers.map((w, i) => ({ pid: 1000 + i, filename: w.filename, threads: w.threads, args: [] })), ...g.procs.filter((p) => p.host === h).map((p) => ({ ...p }))],
    scp: (file, dest, src) => {
      if (dest === 'home' && g.remote[`${src}:${file}`] !== undefined) g.files[file] = g.remote[`${src}:${file}`]
      return true
    },
    kill(pid) {
      g.procs = g.procs.filter((p) => p.pid !== pid)
      return true
    },
    exec(script, host, threads, ...args) {
      // The game refuses a launch that does not fit (no RAM is taken).
      if (usedOn(host) + threads * 2 > g.hosts.get(host).max + 1e-9) return 0
      const pid = g.nextPid++
      g.procs.push({ pid, host, filename: script, threads, args })
      g.event('exec', script)
      return pid
    },
  }
  // The planner's orders, through act.js's gate (or another gate, for the red run).
  g.dispatch = (o, gate = (st, ord) => sp.giftOrderGate(st, ord)) => {
    const v = gate(stateOf(g.ns.getResetInfo()), o)
    if (!v.allow) return { ok: false, why: v.why }
    if (o.kind === 'buyaug') {
      g.queued.push(o.args[1])
      g.event('queue', o.args[1])
    } else if (o.kind === 'graft') {
      g.installed.set(o.args[0], 1)
      g.event('graft', o.args[0])
    } else if (o.kind === 'install') {
      for (const q of g.queued) g.installed.set(q, (g.installed.get(q) ?? 0) + 1)
      g.queued = []
      g.event('install')
    }
    return { ok: true, forfeited: v.forfeited, why: v.why }
  }
  g.run = async () => {
    const mod = await import('../../stanek.js')
    g.atExit = null
    await mod.main(g.ns)
    if (g.atExit) g.atExit()
    return JSON.parse(g.files[sp.STANEK_FILE] ?? 'null')
  }
  return g
}

/** The invariant the gate exists for: no state with a non-NFG aug queued or installed while Genesis is absent. */
const violations = (log) => log.filter((e) => !e.gift && [...e.queued, ...e.installed].some((n) => n !== NFG && n !== GEN))

const BATCH = [
  { kind: 'buyaug', args: ['CyberSec', NFG] },
  { kind: 'buyaug', args: ['CyberSec', 'BitWire'] },
  { kind: 'graft', args: ['Neuralstimulator'] },
  { kind: 'install', args: ['boot.js'] },
]

async function sg3() {
  const c = new Check('SG3', 'a mock BN13 start: the accept precedes every non-NFG purchase; layout placed; charger launched')
  const g = mockGame()
  const first = BATCH.map((o) => ({ kind: o.kind, ...g.dispatch(o) }))
  c.examined(first.length)
  const want1 = [true, false, false, false]
  first.forEach((r, i) => {
    if (r.ok !== want1[i]) c.fail(`before the accept, ${BATCH[i].kind} ${BATCH[i].args.join(' ')}: ok ${r.ok}, expected ${want1[i]}`, r.why)
  })
  const rec = await g.run()
  if (!rec?.gift?.accepted) c.fail('stanek.js did not accept the gift on a clean BN13 start', JSON.stringify(rec)?.slice(0, 300))
  if (!rec?.layout?.ok) c.fail('the layout was not placed', JSON.stringify(rec?.layout)?.slice(0, 300))
  if (JSON.stringify(rec?.layout?.placed) !== JSON.stringify(sp.LAYOUTS['6x5|2'])) c.fail('BN13 at SF13 0 must place the 6x5|2 table')
  const wantThreads = Math.floor((sp.DEFAULT_F * 1024) / 2)
  if (rec?.charger?.threads !== wantThreads) c.fail(`charger threads ${rec?.charger?.threads}, expected ${wantThreads} (DEFAULT_F x the fleet (= home here) / 2.0GB)`, rec?.charger?.why)
  const ch = g.procs.find((p) => p.filename === 'charge.js')
  if (!ch || JSON.stringify(JSON.parse(ch.args[0])) !== JSON.stringify(sp.chargeRootsOf(sp.LAYOUTS['6x5|2']))) c.fail('charge.js not launched with the non-booster roots', JSON.stringify(ch))
  if (rec?.health !== 'ok') c.fail(`stanek.js health ${rec?.health}`, rec?.why)
  if (!/DEFAULT_F.*UNPRICED/.test(rec?.alloc?.source ?? '')) c.fail('with no plan decision the allocation must say it is the default, UNPRICED', rec?.alloc?.source)
  const second = BATCH.map((o) => g.dispatch(o))
  if (!second.every((r) => r.ok)) c.fail('after the accept every order must pass', JSON.stringify(second))
  const acceptAt = g.log.findIndex((e) => e.ev === 'accept')
  const firstNonNfg = g.log.findIndex((e) => (e.ev === 'queue' || e.ev === 'graft') && e.name !== NFG)
  if (!(acceptAt >= 0 && firstNonNfg > acceptAt)) c.fail(`the accept (event ${acceptAt}) must precede the first non-NFG purchase (event ${firstNonNfg})`)
  const v = violations(g.log)
  if (v.length) c.fail(`${v.length} state(s) with a non-NFG aug and no gift`, JSON.stringify(v[0]))
  // idempotent: a second run neither clears nor relaunches
  const nLog = g.log.length
  const rec2 = await g.run()
  if (g.log.slice(nLog).some((e) => e.ev === 'clear' || e.ev === 'exec')) c.fail('a second stanek.js run re-placed or relaunched with nothing changed')
  if (rec2?.health !== 'ok') c.fail(`second run health ${rec2?.health}`, rec2?.why)
  // with a priced plan decision of this life, the charger follows it
  g.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { f: 0.05, basis: 'fleet', why: 'test' } } })
  const rec3 = await g.run()
  if (rec3?.charger?.threads !== Math.floor((0.05 * 1024) / 2) || !/the plan/.test(rec3?.alloc?.source ?? '')) c.fail(`the plan's f=0.05 not followed: ${rec3?.charger?.threads} threads, ${rec3?.alloc?.source}`)
  // a decision of the OLD basis (a fraction of home, no basis field) is not followed
  g.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { f: 0.05, why: 'old home-fraction decision' } } })
  const rec4 = await g.run()
  if (!/UNPRICED/.test(rec4?.alloc?.source ?? '')) c.fail('a decision without basis "fleet" must not be followed (it priced a fraction of home)', rec4?.alloc?.source)
  // RED: the same scenario with no gate is caught by the detector
  const r = mockGame()
  for (const o of BATCH) r.dispatch(o, () => ({ allow: true }))
  await r.run()
  if (!violations(r.log).length) c.fail('RED RUN NOT CAUGHT: an all-allowing gate produced no violation — the detector cannot fail')
  else c.note(`red run: an all-allowing gate gives ${violations(r.log).length} violating state(s) and ${r.log.some((e) => e.ev === 'accept') ? 'an accept' : 'NO accept'} (caught)`)
  return c
}

async function sg4() {
  const c = new Check('SG4', 'the ban path is never silent: forfeited / refused / not charging all fail the health check')
  const now = Date.now()
  // forfeited: a non-NFG aug installed by hand
  const f = mockGame({ installed: ['BitWire'] })
  const rf = await f.run()
  c.examined(3)
  if (rf?.health !== 'fail' || !rf?.gift?.forfeited) c.fail(`forfeited: stanek.js health ${rf?.health}, forfeited ${rf?.gift?.forfeited}`, rf?.why)
  const hf = sp.stanekHealthOf({ stanek: rf, charge: null, now, nodeStartMs: now })
  if (!hf.some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('forfeited: no GIFT NOT ACCEPTED (even inside the grace)', JSON.stringify(hf))
  const gf = f.dispatch({ kind: 'buyaug', args: ['x', 'NeuroTrainer I'] })
  if (!gf.ok || !gf.forfeited) c.fail('forfeited: the gate must not block (nothing left to save) but must flag it', JSON.stringify(gf))
  // refused: a non-NFG aug QUEUED by hand
  const q = mockGame({ queued: ['BitWire'] })
  const rq = await q.run()
  if (rq?.health !== 'fail' || !/QUEUED/.test(rq?.refused ?? '')) c.fail(`queued: stanek.js must report the refusal and why`, JSON.stringify(rq)?.slice(0, 300))
  const hq = sp.stanekHealthOf({ stanek: rq, charge: null, now, nodeStartMs: now })
  if (!hq.some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('queued: no GIFT NOT ACCEPTED', JSON.stringify(hq))
  const iq = q.dispatch({ kind: 'install', args: [] })
  if (iq.ok) c.fail('queued: the gate let the install through — that makes the forfeit permanent')
  // not accepted past the grace, no refusal (stanek.js never ran the accept)
  const late = { at: new Date(now).toISOString(), node: 13, lastAugReset: 1000, gift: { want: true, accepted: false, forfeited: false, node: 13, why: 'not accepted yet' } }
  if (!sp.stanekHealthOf({ stanek: late, charge: null, now, nodeStartMs: now - 30 * 60e3 }).some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('30 min into BN13 and not accepted: no GIFT NOT ACCEPTED')
  if (sp.stanekHealthOf({ stanek: late, charge: null, now, nodeStartMs: now - 5 * 60e3 }).some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('5 min into BN13: inside the grace, must not fail yet')
  // not charging: judged by the gift's OWN charge (highestCharge x numCharge), pass to pass
  const ok = mockGame()
  const ro = await ok.run()
  if (sp.stanekHealthOf({ stanek: ro, charge: null, now: Date.now() }).length) c.fail('a charger just launched (no previous pass to compare) must be healthy', JSON.stringify(sp.stanekHealthOf({ stanek: ro, charge: null, now: Date.now() })))
  const back = (r, min) => ({ ...r, at: new Date(Date.now() - min * 60e3).toISOString() })
  ok.files[sp.STANEK_FILE] = JSON.stringify(back(ro, 5))
  const flat = await ok.run() // no tick: charge.js held threads and nothing charged
  const hFlat = sp.stanekHealthOf({ stanek: flat, charge: null, now: Date.now() })
  if (!hFlat.some((p) => p.problem === 'FRAGMENTS NOT CHARGING' && /did not grow/.test(p.detail))) c.fail('a running charger with a flat charge mass for 5 min: no FRAGMENTS NOT CHARGING naming it', JSON.stringify(hFlat))
  if (flat?.health !== 'fail') c.fail(`stanek.js must publish fail on a flat charge mass, got ${flat?.health}`, flat?.why)
  ok.files[sp.STANEK_FILE] = JSON.stringify(back(flat, 5))
  ok.tick(30)
  const grew = await ok.run()
  if (sp.stanekHealthOf({ stanek: grew, charge: null, now: Date.now() }).length) c.fail('a growing charge mass must be healthy', JSON.stringify(sp.stanekHealthOf({ stanek: grew, charge: null, now: Date.now() })))
  const errBeat = { at: new Date().toISOString(), lastAugReset: 1000, hosts: { home: { at: new Date().toISOString(), error: 'chargeFragment(0, 0) threw: x' } } }
  if (!sp.stanekHealthOf({ stanek: grew, charge: errBeat, now: Date.now() }).some((p) => /chargeFragment/.test(p.detail))) c.fail('a fresh charge.js error in the gathered heartbeats: not reported')
  if (sp.stanekHealthOf({ stanek: null }).length !== 1) c.fail('no stanek.txt must be reported (STANEK UNREPORTED)')
  return c
}

const strip = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

function sg5() {
  const c = new Check('SG5', 'the choke points and the wiring (static)')
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const act = rd('act.js')
  const ra = act.indexOf('async function runActor(')
  const raBody = act.slice(ra, act.indexOf('\n}\n', ra))
  const gi = raBody.indexOf('const gate = giftOrderGate(giftStateOf(ri, canAccessCotMG(ri)), { kind, args })')
  const fresh = raBody.indexOf('const ri = ns.getResetInfo()')
  const gr = raBody.search(/if \(!gate\.allow\) return \{ ran: false, ok: false/)
  const ex = raBody.indexOf('ns.exec(actor')
  c.examined(1)
  if (!(fresh > 0 && gi > fresh && gr > gi && ex > gr)) c.fail("act.js runActor must gate buyaug/graft/install (giftOrderGate on a FRESH getResetInfo) and RETURN on a refusal before its exec", `gate at ${gi}, return at ${gr}, exec at ${ex}`)
  if (!/if \(kind === 'buyaug' \|\| kind === 'graft' \|\| kind === 'install'\)/.test(raBody)) c.fail('act.js runActor gate must cover buyaug, graft and install')
  const loopGate = act.indexOf("const ri = ns.getResetInfo()\n            const gate = giftOrderGate(giftStateOf(ri, canAccessCotMG(ri)), o)")
  const installBranch = act.indexOf("if (o.kind === 'install') {\n            // THE MANUAL HOLD")
  if (!(loopGate > 0 && installBranch > loopGate)) c.fail("act.js's order loop must gate before the install branch", `${loopGate} / ${installBranch}`)
  // ...and act on it there: runActor's own gate would refuse the install only AFTER the
  // liquidation and the home spend-down this branch runs first.
  const loopAct = act.slice(loopGate, loopGate + 400)
  if (!/\n\s*if \(!gate\.allow\) \{\n\s*results\.push\(\{[^\n]*skipped: gate\.why[^\n]*\n\s*if \(CHAIN\.has\(o\.kind\)\) chainFailed[^\n]*\n\s*if \(o\.kind === 'install'\) break\n\s*continue/.test(loopAct)) c.fail("act.js's order-loop gate must skip the order, break the chain and stop the batch at an install — before the liquidation and spend-down")
  const actors = new Set(['act-buyaug.js', 'act-install.js', 'act-graft.js'])
  const callers = []
  for (const f of fs.readdirSync(REPO).filter((f) => f.endsWith('.js'))) {
    c.examined(1)
    if (actors.has(f)) continue
    if (/\.(purchaseAugmentation|installAugmentations|graftAugmentation)\s*\(/.test(strip(rd(f)))) callers.push(f)
  }
  if (callers.length) c.fail(`augmentation purchases outside the gated actors: ${callers.join(', ')}`)
  const batch = rd('batch.js')
  const m = batch.match(/homeReserve: \(mult\) => ([^,\n]+),/)
  const ref = m ? Function('mult', `return ${m[1]}`) : null
  for (const k of [1, 4, 16]) if (!ref || ref(k) !== sp.progressBlockGb(k)) c.fail(`progressBlockGb(${k}) = ${sp.progressBlockGb(k)} vs batch.js SETTINGS.homeReserve ${ref?.(k)}`)
  if (!/\n\s*heldOn\(stanekRes, h\) \+/.test(batch) || !/stanekHoldsOf\(JSON\.parse\(ns\.read\(STANEK_FILE\)/.test(batch)) c.fail("batch.js must hold stanekHoldsOf on EVERY host in reserveFor (heldOn(stanekRes, h))")
  const wd = rd('watchdog.js')
  if (!/script: 'stanek\.js',\s*host: 'home',\s*args: \[\],\s*trigger: \(ns\) => canAccessFeature\(ns\.getResetInfo\(\), 13\)/.test(wd)) c.fail('watchdog.js must run stanek.js as a JOB on home triggered by canAccessFeature(13)')
  if (!/script: 'stanek\.js',\s*where: 'home',\s*kind: 'job'/.test(rd('boot.js'))) c.fail('boot.js must declare stanek.js (kind job) — the watchdog watches only what boot declares (B7.9)')
  const pr = rd('progress.js')
  if (!/const h = yield\* tg\(chargeInputsOf\(base, ctx, f\)\)/.test(pr)) c.fail('progress.js stanekDecisionOf must price every option through chargeInputsOf and the trajectory simulator')
  const sd = pr.slice(pr.indexOf('async function stanekDecisionOf('), pr.indexOf('\n}\n', pr.indexOf('async function stanekDecisionOf(')))
  if (!/allocOptionsOf\(fleetGB, hosts\)/.test(sd) || !/st\?\.fleet\?\.gb/.test(sd) || /batch\.txt/.test(sd)) c.fail("progress.js stanekDecisionOf must price fractions of stanek.js's measured FLEET (st.fleet), not home and not /tel/batch.txt")
  if (!/basis: ALLOC_BASIS/.test(sd)) c.fail('progress.js stanekDecisionOf must stamp basis "fleet" on the decision (stanek.js follows only that basis)')
  if (!/stanek: pc\.decisions\.stanek \?\? pc\.prev\?\.decisions\?\.stanek \?\? null/.test(pr)) c.fail('progress.js must publish decisions.stanek in /tel/plan.txt')
  if (!/giftPinOf\(routePinOf\(/.test(pr)) c.fail("progress.js must pin the hacking route where the gift is accepted (routepin.giftPinOf)")
  // charge.js stays 2.0GB: only chargeFragment among the priced calls
  const ch = strip(rd('charge.js'))
  const nsCalls = [...new Set([...ch.matchAll(/\bns\.([a-zA-Z.]+)\(/g)].map((x) => x[1]))].filter((n) => !['read', 'write', 'atExit', 'sleep', 'disableLog'].includes(n))
  if (nsCalls.join() !== 'stanek.chargeFragment') c.fail(`charge.js calls more than chargeFragment (RAM per thread): ${nsCalls.join(', ')}`)
  return c
}

async function sg6() {
  const c = new Check('SG6', 'the charging allocation is a comparison of simulated exits (NOT CALIBRATED: no gift run measured)')
  const { bestExitPolicy, expForLevel } = await import('../../exitplan.js')
  const base = { money: 8.85e9, incomePerSec: 39e6, hacking: 4051, hackingExp: expForLevel(4051, 9.25), hackingMult: 9.25, expPerSec: 190000, repPerSec: 200, exitRep: 0, exitFavor: 78, cycleHours: 0.625, multGainPerCycle: 1.34, exitLevel: 4500, joinMoney: 100e9, terminalRep: 2.5e6, donationCost: 791e9 }
  const H = (inp) => bestExitPolicy(inp, 6).best?.hours ?? null
  const layout = sp.LAYOUTS['6x5|2']
  const fleetHosts = [{ host: 'home', cores: 4, capGb: 2 ** 14 - 100 }, ...Array.from({ length: 25 }, (_, i) => ({ host: `p${i}`, cores: 1, capGb: 2 ** 12 }))]
  const ctx = { layout, nodePower: 2, fleetGB: 2 ** 14 + 25 * 2 ** 12, hosts: fleetHosts, fNow: 0.1, cycleH: base.cycleHours }
  const same = sp.chargeInputsOf(base, ctx, 0.1)
  c.examined(1)
  for (const k of ['incomePerSec', 'expPerSec', 'repPerSec', 'hackingMult']) if (Math.abs(same[k] / base[k] - 1) > 1e-12) c.fail(`f = fNow must reproduce the measured ${k}`, `${same[k]} vs ${base[k]}`)
  const priced = sp.allocOptionsOf(ctx.fleetGB, ctx.hosts).map((f) => ({ f, hours: H(sp.chargeInputsOf(base, ctx, f)) }))
  c.examined(priced.length)
  const ch = sp.chooseAlloc(priced, null)
  const min = Math.min(...priced.map((p) => p.hours))
  if (ch.hours !== min) c.fail(`chooseAlloc did not pick the fastest exit: ${ch.hours} vs ${min}`)
  c.note(`exits by f (home 16TB 4 cores + 25 x 4TB, fNow 0.1): ${priced.map((p) => `${p.f}:${p.hours?.toFixed(2)}h`).join(' ')} -> ${ch.why}`)
  const inc = sp.chooseAlloc([{ f: 0.1, hours: 10.05 }, { f: 0.2, hours: 10.0 }], 0.1)
  if (inc.f !== 0.1) c.fail('an incumbent within 0.1h must be kept', inc.why)
  // The RAM side: the same GB costs the batcher more when the fleet is smaller.
  const small = { ...ctx, hosts: [{ host: 'home', cores: 4, capGb: 2 ** 14 }], fleetGB: 2 ** 14, fNow: 0 }
  const big = { ...ctx, hosts: [{ host: 'home', cores: 4, capGb: 2 ** 14 }, { host: 'x', cores: 1, capGb: 0, maxRam: 7 * 2 ** 14 }], fleetGB: 8 * 2 ** 14, fNow: 0 }
  const lnS = sp.chargeLnOf({ ...small, f: 0.5 })
  const lnB = sp.chargeLnOf({ ...big, f: 1 / 16 })
  if (!(lnS.gb === lnB.gb && lnS.lnIncome < lnB.lnIncome)) c.fail(`the RAM side is not priced: ${lnS.gb}GB of a ${small.fleetGB}GB fleet lnIncome ${lnS.lnIncome} vs of ${big.fleetGB}GB ${lnB.lnIncome}`)
  // highestCharge is ONE script's power: the same GB in one script beats it split (the placement concentrates)
  const one = sp.chargerPlaceOf(64, [{ host: 'a', cores: 1, capGb: 64 }, { host: 'b', cores: 1, capGb: 32 }, { host: 'c', cores: 1, capGb: 32 }])
  if (one.H !== 32 || one.hosts.length !== 1 || one.hosts[0].host !== 'a') c.fail('chargerPlaceOf must fill the largest host first (H = one script)', JSON.stringify(one))
  const cored = sp.chargerPlaceOf(32, [{ host: 'a', cores: 1, capGb: 32 }, { host: 'b', cores: 8, capGb: 32 }])
  if (cored.hosts[0].host !== 'b') c.fail('chargerPlaceOf must weigh the core bonus (same GB, more cores first)', JSON.stringify(cored))
  const split = sp.chargeLnOf({ layout, nodePower: 2, fleetGB: 128, hosts: [{ host: 'a', cores: 1, capGb: 32 }, { host: 'b', cores: 1, capGb: 32 }], f: 0.5, cycleH: 1 })
  const whole = sp.chargeLnOf({ layout, nodePower: 2, fleetGB: 128, hosts: [{ host: 'a', cores: 1, capGb: 64 }], f: 0.5, cycleH: 1 })
  if (!(whole.lnHack > split.lnHack)) c.fail(`one 32-thread script must out-charge two 16-thread ones: ${whole.lnHack} vs ${split.lnHack}`)
  const hold = { at: new Date().toISOString(), lastAugReset: 1, charger: { hosts: [{ host: 'a', target: 50, now: 20 }, { host: 'b', target: 8, now: 8 }] } }
  if (JSON.stringify(sp.stanekHoldsOf(hold, 1)) !== JSON.stringify([{ host: 'a', gb: 60 }])) c.fail('stanekHoldsOf must hold each host\'s target GB not yet held', JSON.stringify(sp.stanekHoldsOf(hold, 1)))
  if (sp.stanekHoldsOf({ ...hold, lastAugReset: 2 }, 1).length) c.fail('stanekHoldsOf must ignore another life')
  return c
}

/**
 * SG8 THE LIVE SHAPE (BN13.1 2026-10-11 00:14Z): a 128GB 1-core home with residents and
 * progress.js's 19.25GB block leaving no 2GB thread, rooted 32GB/16GB hosts — one with
 * free RAM, the rest full of batch h/g/w — and no plan decision yet. The charger must
 * run on the fleet at DEFAULT_F (labelled UNPRICED), batch.js must hold the rest on the
 * worker-filled targets, the heartbeats must be gathered home, and the fragments charge.
 * RED: the same shape with home the only rooted host -> no thread anywhere and
 * FRAGMENTS NOT CHARGING naming the binding cause (residents and reserves fill it).
 */
async function sg8() {
  const c = new Check('SG8', 'the live BN13.1 shape: home full, rooted hosts free or full of h/g/w, no decision -> the charger runs on the fleet')
  const w = (n) => [{ filename: 'w.js', threads: n }]
  const others = [
    { host: 'iron-gym', max: 32, used: 5.25, workers: w(3) },
    ...['max-hardware', 'zer0', 'neo-net'].map((host) => ({ host, max: 32, used: 31.5, workers: w(18) })),
    ...['harakiri-sushi', 'nectar-net', 'foodnstuff'].map((host) => ({ host, max: 16, used: 15.75, workers: w(9) })),
    { host: 'sigma-cosmetics', max: 16, used: 15.2, workers: [] }, // residents (buyserv, bb-lite)
    { host: 'n00dles', max: 4, used: 4, workers: [] },
  ]
  const g = mockGame({ homeMax: 128, homeUsed: 110, homeCores: 1, others })
  const rec = await g.run()
  c.examined(1)
  const ch = rec?.charger ?? {}
  const onFleet = g.procs.filter((p) => p.filename === 'charge.js')
  if (!(ch.threads > 0) || !onFleet.length) c.fail(`no charger thread anywhere: ${ch.why}`, JSON.stringify(ch).slice(0, 400))
  if (onFleet.some((p) => p.host === 'home')) c.fail('a charger on home, which has no 2GB thread beyond progress.js\'s block')
  if (!onFleet.every((p) => p.args[2] === p.host)) c.fail('charge.js must be told its host (args[2]) for its heartbeat file', JSON.stringify(onFleet.map((p) => p.args)))
  if (!/UNPRICED/.test(rec?.alloc?.source ?? '')) c.fail('no decision yet: the allocation must say DEFAULT_F, UNPRICED', rec?.alloc?.source)
  const fleetGB = 128 + 4 * 32 + 4 * 16 + 4
  if (ch.want !== Math.floor((sp.DEFAULT_F * fleetGB) / 2) || rec?.fleet?.gb !== fleetGB) c.fail(`want ${ch.want} / fleet ${rec?.fleet?.gb}: expected DEFAULT_F x ${fleetGB}GB fleet`)
  const holds = sp.stanekHoldsOf(rec, 1000)
  if (ch.threads < ch.want && !holds.length) c.fail('short of its target on worker-filled hosts and batch.js holds nothing there', JSON.stringify(ch.hosts))
  if (holds.some((h) => h.host === 'home')) c.fail('a hold on home, which the placement never targets here', JSON.stringify(holds))
  const ig = ch.hosts?.find((h) => h.host === 'iron-gym')
  if (!(ig?.now > 0)) c.fail('iron-gym (32GB, 26.75GB free) must charge at once', JSON.stringify(ch.hosts))
  if (rec?.health === 'fail') c.fail(`stanek.js health fail on the live shape: ${rec?.why}`)
  c.note(`live shape: ${ch.threads}/${ch.want} threads on ${onFleet.map((p) => `${p.host}:${p.threads}`).join(' ')}, H ${ch.H} (target ${ch.Htarget}); holds ${holds.map((h) => `${h.host}:${h.gb}GB`).join(' ') || 'none'}; ${rec?.why}`)
  // heartbeats: charge.js writes on its host; stanek.js gathers them home
  for (const p of onFleet) g.remote[`${p.host}:/tel/charge-${p.host}.txt`] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, host: p.host, error: null })
  g.tick(20)
  g.files[sp.STANEK_FILE] = JSON.stringify({ ...rec, at: new Date(Date.now() - 5 * 60e3).toISOString() })
  const rec2 = await g.run()
  const beats = JSON.parse(g.files[sp.CHARGE_FILE] ?? 'null')
  if (!onFleet.every((p) => beats?.hosts?.[p.host]?.host === p.host)) c.fail('the fleet heartbeats were not gathered into /tel/charge.txt', JSON.stringify(beats).slice(0, 300))
  if (!(rec2?.progress?.gained > 0)) c.fail('the gift charged (20 rounds) and the record shows no gain', JSON.stringify(rec2?.progress))
  if (rec2?.fragments?.every((f) => !(f.highestCharge > 0))) c.fail('every fragment still at 0 charge after the charger ran')
  const h2 = sp.stanekHealthOf({ stanek: rec2, charge: beats, now: Date.now() })
  if (h2.some((p) => p.problem === 'FRAGMENTS NOT CHARGING')) c.fail('charging on the fleet must be healthy', JSON.stringify(h2))
  // the batcher yields: the held hosts' workers finish -> the next pass reaches the target
  for (const h of holds) {
    const o = g.hosts.get(h.host)
    const wGb = o.workers.reduce((s, x) => s + x.threads * 1.75, 0)
    o.used -= wGb
    o.workers = []
  }
  const rec3 = await g.run()
  if (holds.length && !(rec3?.charger?.threads > ch.threads)) c.fail(`the batcher yielded and the charger did not grow: ${ch.threads} -> ${rec3?.charger?.threads}`, rec3?.charger?.why)
  // RED: home the only rooted host (the old home-only charger's world)
  const r = mockGame({ homeMax: 128, homeUsed: 110, homeCores: 1 })
  const rr = await r.run()
  const hr = sp.stanekHealthOf({ stanek: rr, charge: null, now: Date.now() })
  const nc = hr.find((p) => p.problem === 'FRAGMENTS NOT CHARGING')
  if (!nc || !/no rooted host has a 2GB thread of room/.test(nc.detail) || !/GB room beyond a [\d.]+GB reserve/.test(nc.detail)) c.fail('RED RUN NOT CAUGHT: home-only and full must fail FRAGMENTS NOT CHARGING naming the binding cause (residents and the reserve)', JSON.stringify(hr))
  else c.note(`red run (home only, full): ${nc.detail}`)
  return c
}

export async function run() {
  return [sg1(), await sg2(), await sg3(), await sg4(), sg5(), await sg6(), await sg7(), await sg8()]
}
