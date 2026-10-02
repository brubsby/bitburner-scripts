// bb-lite.js — the lean Bladeburner daemon, its one-shot actors, the
// handover to bladeburner.js, the bootstrap that commits the route before the
// planner can run, the fleet before the join, and the RAM that makes it fit.
//
//   BL1  the lean view reproduces the GAME's chance for every action (ENV off the low end at the
//        autolevel max level), and the lean pick is bbplan.chooseAction under pinTop — never a
//        level the game will not run
//   BL2  bb-lite.js END TO END against the game's own ns.bladeburner (the bbdaemon harness shape):
//        no join below combat 100; joins at 100 and the faction at rank 25; acts only on a claim
//        (progress.js's, else act.js's bootstrap claim); rank rises and skills are bought on the
//        hourly clock; never health error
//   BL3  the handover: bb-lite stands down on bladeburner.js's 'handover-wait' record and starts
//        nothing after it; bladeburner.js does not act (no start, no stop, no skill) while
//        bb-lite.txt is alive, and acts once it has stopped — never two actors
//   BL4  RAM: the coordinator and every actor priced by the game's calculator; each actor fits the
//        action slot (the largest act-*.js) in BN4 and at SF4.3, and boot.js admits bb-lite.js at a
//        64GB home where bladeburner.js (92.75GB) cannot be placed on any host the BN4 fleet has
//   BL5  the fleet before the join, priced on the black-op exit: a shocked fresh fleet -> money
//        (never karma), an unshocked synced fleet -> the gym; progress.js wires it on the blade route
//        and the healthcheck does not call the gang grind missing on that route
//   BL6  actplan 0b: the route presumed where the division exists — crime while the gym fee is
//        unpaid, the gym once it is, the slot claimed for Bladeburner at combat 100; the plan's
//        'hack' and a fresh planner claim both override it
//   BL7  the combat bar with the fee priced (bodyplan.combatBarPlanOf) on the live 17:27Z BN4
//        state: the mixed policy, crime first; an unpaid gym re-issue falls back to the money crime

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import { makeWorld } from './bbworld.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
export async function run() {
  const checks = []
  const load = new Check('BL0', 'the game bundle and the bb-lite modules load')
  checks.push(load)
  let g, setBitNode, bp, lp, coord, actors, bbjs
  try {
    const m = await import('../sim/nodechoice/game.mjs')
    g = m.default
    setBitNode = m.setBitNode
    bp = await import('bbplan.js')
    lp = await import('bbliteplan.js')
    coord = await import('bb-lite.js')
    bbjs = await import('bladeburner.js')
    actors = {}
    for (const f of Object.values(lp.ACTOR)) actors[f] = await import(f)
    load.examined(1)
  } catch (e) {
    load.fail('could not load', String(e?.stack ?? e).slice(0, 500))
    return checks
  }

  const world = (o) => makeWorld({ g, setBitNode, actors, coord }, o)

  // ---- BL1 -------------------------------------------------------------------
  {
    const c = new Check('BL1', "the lean view reproduces the game's chance for every action; the lean pick is chooseAction under pinTop")
    checks.push(c)
    const w = world({ combat: 60, joined: true, seed: 3 })
    const bb = w.P.bladeburner
    // Some successes so max levels differ per action.
    for (const ct of Object.values(bb.contracts)) {
      ct.successes = 30
      for (let i = 0; i < 6; i++) ct.setMaxLevel(g.BladeburnerConstants.ContractSuccessesPerLevel)
      ct.level = ct.maxLevel
    }
    const ans = w.baseNs('bb-lite-read.js', [JSON.stringify({ from: 0 })])
    await actors[lp.ACTOR.read].main(ans)
    const out = JSON.parse(w.ns.readPort(lp.LITE_PORT))
    const person = { skills: { ...w.P.skills }, mults: { ...w.P.mults } }
    const [stamina, maxStamina] = [bb.stamina, bb.maxStamina]
    const v = lp.leanViewOf({ person, reads: out, stamina, maxStamina, rank: bb.rank, bnRank: 1 })
    // The shown range is [real - |real - est|, real + |real - est|] x r on one side
    // (Action.ts getSuccessRange): its low end is a fixed fraction of the real
    // chance across a city's actions — while neither the real nor the estimated
    // chance is clamped at 1. Within such a family one read prices every action.
    const objOf = (a) => bb.contracts[a.d.name] ?? bb.operations[a.d.name]
    const unclamped = (a) => objOf(a).getSuccessChance(bb, w.P) < 1 && objOf(a).getSuccessChance(bb, w.P, { est: true }) < 1
    let worst = 0
    let judged = 0
    for (const fam of ['contract', 'operation']) {
      const acts = v.actions.filter((a) => a.d.kind === fam)
      if (!acts.length || !acts.every(unclamped)) continue
      for (const a of acts) {
        const lo = objOf(a).getSuccessRange(bb, w.P)[0]
        const p = Math.min(1, bp.pFrom(a.K, a.d, a.maxLevel, person, v.sm))
        c.examined(1)
        judged++
        worst = Math.max(worst, Math.abs(p - lo))
      }
    }
    c.note(`${v.actions.length} actions, ${judged} in unclamped families, worst |lean chance - game low end| ${worst.toExponential(2)}; levels ${v.actions.map((a) => `${a.d.name.split(' ')[0]} L${a.maxLevel}`).join(', ')}`)
    if (!judged) c.fail('no family was unclamped — the fixture judges nothing (lower the stats)')
    if (!(worst < 1e-6)) c.fail(`the lean view's chance is off the game's by ${worst}`)
    const pick = lp.leanPick(v)
    const same = bp.chooseAction(v, { ...bp.POLICY, pinTop: true })
    c.examined(2)
    if (pick.name !== same.name || pick.level !== same.level) c.fail(`leanPick ${pick.name} L${pick.level} is not chooseAction(pinTop) ${same.name} L${same.level}`)
    if (pick.level && pick.level !== v.actions.find((a) => a.d.name === pick.name)?.maxLevel) c.fail(`the lean pick runs ${pick.name} at L${pick.level}, not its (auto) max level`)
    // pinTop never offers a lower level: the full policy's pick at a level below max is NOT a lean candidate at that level.
    for (const a of v.actions) {
      const b = bp.bestLevel(a, v, { ...bp.POLICY, pinTop: true })
      if (b && b.L !== a.maxLevel) c.fail(`bestLevel(pinTop) offered ${a.d.name} L${b.L} with max ${a.maxLevel}`)
    }
    c.note(`lean pick: ${pick.name}${pick.level ? ` L${pick.level}` : ''} — ${pick.why}`)
  }

  // ---- BL2 -------------------------------------------------------------------
  {
    const c = new Check('BL2', 'bb-lite end to end on the game API: joins at 100 (not below), the faction at 25, acts on a claim only, rank rises, skills hourly, never error')
    checks.push(c)
    const low = world({ combat: 60 })
    await low.runFor(0.05)
    c.examined(2)
    if (low.P.bladeburner) c.fail('joined with combat 60')
    if (low.tel('/tel/bb-lite.txt')?.result !== 'not-joined') c.fail(`below 100 the record must say not-joined: ${low.tel('/tel/bb-lite.txt')?.result}`)
    if (low.tel('/tel/bladeburner.txt')?.joined !== false || low.tel('/tel/bladeburner.txt')?.daemon !== 'bb-lite') c.fail('bladeburner.txt must carry the lean record (daemon bb-lite, joined false)')

    // No claim: joins, but starts nothing.
    const nc = world({ combat: 150, owner: 'faction' })
    await nc.runFor(0.2)
    c.examined(1)
    if (!nc.P.bladeburner) c.fail('did not join the division at combat 150')
    if (nc.callLog.some((x) => x.name === 'startAction')) c.fail(`started an action with the slot held for 'faction': ${JSON.stringify(nc.callLog.find((x) => x.name === 'startAction'))}`)
    if (nc.tel('/tel/bb-lite.txt')?.result !== 'slot-not-ours') c.fail(`expected slot-not-ours, got ${nc.tel('/tel/bb-lite.txt')?.result}`)

    // act.js's bootstrap claim (no planner): acts.
    const ab = world({ combat: 150, owner: 'bladeburner', ownerFile: 'act' })
    await ab.runFor(0.2)
    c.examined(1)
    if (!ab.callLog.some((x) => x.name === 'startAction')) c.fail("act.js's bootstrap claim (no planner) did not let it act", JSON.stringify(ab.tel('/tel/bb-lite.txt')).slice(0, 300))

    // Hours of acting on progress.js's claim.
    const w = world({ combat: 200, mult: 1.3, seed: 7 })
    const r = await w.runFor(6)
    const bb = w.P.bladeburner
    const s = w.tel('/tel/bb-lite.txt')
    const rec = w.tel('/tel/bladeburner.txt')
    const skillLv = Object.values(bb?.skills ?? {}).reduce((x, y) => x + y, 0)
    const skillCalls = w.callLog.filter((x) => x.name === 'upgradeSkill')
    const execs = w.execLog.length
    c.examined(5)
    c.note(`6 game hours: ${r}; rank ${bb?.rank?.toFixed(1)}, faction ${g.Factions['Bladeburners'].isMember}, ${bb?.numBlackOpsComplete ?? 0} black ops, ${skillLv} skill levels in ${new Set(skillCalls.map((x) => Math.floor(x.t / 3600))).size} hourly spends, ${execs} actor runs, last ${s?.result}: ${String(s?.detail ?? '').slice(0, 120)}`)
    if (!(bb?.rank > 25)) c.fail(`rank only ${bb?.rank} after 6 game hours`)
    if (bb?.rank >= 25 && !g.Factions['Bladeburners'].isMember) c.fail('rank >= 25 and not in the Bladeburners faction')
    if (!(skillLv > 0)) c.fail('no skill bought in 6 game hours')
    // The skill clock is the model's: spends at least POLICY.skillEveryS apart.
    const spendHours = [...new Set(skillCalls.map((x) => x.t))].sort((x, y) => x - y)
    for (let i = 1; i < spendHours.length; i++) if (spendHours[i] - spendHours[i - 1] < bp.POLICY.skillEveryS - 120) c.fail(`skills spent ${spendHours[i] - spendHours[i - 1]}s apart (the model's clock is ${bp.POLICY.skillEveryS}s)`)
    if (s?.health === 'error' || rec?.health === 'error') c.fail(`health error: ${s?.detail}`)
    if (rec?.daemon !== 'bb-lite' || rec?.joined !== true || !(rec?.rank > 0) || !rec?.counts || !rec?.maxLevels) c.fail('bladeburner.txt must carry the lean record the plan reads (joined, rank, counts, maxLevels)', JSON.stringify(rec).slice(0, 300))
    // The plan's start builder reads it.
    const s0 = bp.bladeStartOf({ tel: rec, person: { skills: w.P.skills, exp: w.P.exp, mults: w.P.mults }, gymExpPerSec: 10 })
    if (!(s0.joined && s0.rank > 0)) c.fail('bbplan.bladeStartOf does not read the lean record as joined with a rank')
  }

  // ---- BL3 -------------------------------------------------------------------
  {
    const c = new Check('BL3', 'the handover: bb-lite stands down for bladeburner.js; bladeburner.js waits while bb-lite is alive; never two actors')
    checks.push(c)
    const w = world({ combat: 200, joined: true, seed: 11 })
    // bb-lite acts for a while...
    await w.runFor(0.3)
    const before = w.callLog.length
    // ...then bladeburner.js arrives: its loop publishes 'handover-wait' while bb-lite.txt is alive.
    const fullNs = { ...w.baseNs('bladeburner.js'), raiseRam: true }
    // Run one bladeburner.js pass to completion of its first sleep (it waits: bb-lite is alive).
    const r1 = await w.runFor(10 / 3600, bbjs.main, fullNs)
    const rec1 = w.tel('/tel/bladeburner.txt')
    c.examined(2)
    c.note(`bladeburner.js with bb-lite alive: ${r1}, result ${rec1?.result} (${String(rec1?.detail ?? '').slice(0, 100)})`)
    if (rec1?.result !== 'handover-wait' || rec1?.daemon !== 'bladeburner.js') c.fail(`bladeburner.js must wait ('handover-wait'), got ${rec1?.result}`, JSON.stringify(rec1).slice(0, 300))
    if (w.callLog.slice(before).some((x) => x.who === 'bladeburner.js')) c.fail(`bladeburner.js acted while bb-lite was alive: ${JSON.stringify(w.callLog.slice(before).find((x) => x.who === 'bladeburner.js'))}`)
    // bb-lite's next pass sees it and exits.
    const mark = w.callLog.length
    const r2 = await w.runFor(0.1)
    const lite = w.tel('/tel/bb-lite.txt')
    c.examined(2)
    c.note(`bb-lite after the 'handover-wait' record: ${r2}, ${lite?.result}`)
    if (r2 !== 'returned' || lite?.result !== 'handed-over') c.fail(`bb-lite must return 'handed-over', got ${r2} / ${lite?.result}`)
    if (w.callLog.slice(mark).some((x) => x.who.startsWith('bb-lite'))) c.fail('bb-lite started something after seeing bladeburner.js')
    // Its atExit equivalent: the record says stopped (the reporter's exit); simulate it as the game would.
    w.files.set('/tel/bb-lite.txt', JSON.stringify({ ...lite, health: 'stopped', exited: true }))
    const r3 = await w.runFor(0.05, bbjs.main, fullNs)
    const rec3 = w.tel('/tel/bladeburner.txt')
    c.examined(1)
    c.note(`bladeburner.js after bb-lite stopped: ${r3}, ${rec3?.result}; its starts ${w.callLog.filter((x) => x.who === 'bladeburner.js' && x.name === 'startAction').length}`)
    if (!['acting', 'started'].includes(rec3?.result)) c.fail(`bladeburner.js must act once bb-lite has stopped: ${rec3?.result} ${String(rec3?.detail ?? '').slice(0, 120)}`)
    // The pure halves.
    const info = { lastAugReset: w.LAR }
    const now = Date.parse(w.stamp())
    c.examined(4)
    if (lp.liteAliveOf({ lastAugReset: w.LAR, at: w.stamp(), health: 'ok', result: 'acting' }, info, now).alive !== true) c.fail('a fresh acting bb-lite record must read alive')
    if (lp.liteAliveOf({ lastAugReset: w.LAR, at: w.stamp(), health: 'stopped', result: 'acting' }, info, now).alive) c.fail('a stopped bb-lite record must not read alive')
    if (lp.fullTakingOverOf({ daemon: 'bladeburner.js', lastAugReset: w.LAR, at: w.stamp(), health: 'stopped', result: 'acting' }, info, now).over) c.fail("a stopped bladeburner.js record is no handover")
    if (lp.fullTakingOverOf({ daemon: 'bb-lite', lastAugReset: w.LAR, at: w.stamp(), health: 'ok', result: 'acting' }, info, now).over) c.fail("bb-lite's own record is no handover")
    // The watchdog's half: it stops bb-lite once bladeburner.js runs anywhere.
    const wd = fs.readFileSync(path.join(REPO, 'watchdog.js'), 'utf8')
    c.examined(1)
    if (!/script: 'bb-lite\.js',[\s\S]{0,120}invariant: \(ns\) => canJoinBladeburner\(ns\.getResetInfo\(\)\) && !running\(ns, scanAll\(ns\), 'bladeburner\.js'\)/.test(wd)) c.fail('watchdog.js must watch bb-lite.js with the invariant "the division exists and bladeburner.js is not running"')
  }

  // ---- BL4 -------------------------------------------------------------------
  {
    const c = new Check('BL4', 'RAM: the coordinator and actors priced by the game; every actor fits the action slot; boot admits bb-lite at 64GB where 92.75GB has no host')
    checks.push(c)
    const ram = await import('./ram.mjs')
    await ram.load()
    const { planStack, MIN_OPS } = await import('stack.js')
    for (const [label, save] of [['BN4', { bitNode: 4, sf: { 4: 2 } }], ['SF4.3', { bitNode: 1, sf: { 4: 3 } }]]) {
      ram.asSave(save)
      const price = (f) => ram.ramOf(f).cost
      const actorsRam = Object.values(lp.ACTOR).map((f) => [f, price(f)])
      const actRam = fs.readdirSync(REPO).filter((f) => /^act-.*\.js$/.test(f)).map(price).filter((x) => x > 0)
      const slot = Math.max(...actRam)
      const lite = price('bb-lite.js')
      const full = price('bladeburner.js')
      c.examined(actorsRam.length + 1)
      c.note(`${label}: bb-lite.js ${lite}GB resident; actors ${actorsRam.map(([f, r]) => `${f.replace('bb-lite-', '').replace('.js', '')} ${r}`).join(', ')}GB; act.js's action slot ${slot}GB; bladeburner.js declares ${full}GB, raises to 92.75GB`)
      if (!(lite <= 6)) c.fail(`${label}: bb-lite.js costs ${lite}GB — the coordinator must stay small (no 4GB call)`)
      for (const [f, r] of actorsRam) if (!(r > 0 && r <= Math.max(slot, 14.6))) c.fail(`${label}: ${f} ${r}GB does not fit the action slot ${slot}GB`)
      // The manifest at a 64GB home: bb-lite admitted (anywhere, tier 32); bladeburner.js deferred.
      const boot = fs.readFileSync(path.join(REPO, 'boot.js'), 'utf8')
      const m = boot.match(/const STACK = (\[[\s\S]*?\n\])\n/)
      const STACK = new Function(`return ${m[1]}`)()
      const plan = planStack(STACK, { homeRam: 64, costOf: (s) => price(s) ?? 0, bootRam: price('boot.js'), minOps: MIN_OPS, actionRam: slot })
      const adm = plan.admit.find((e) => e.script === 'bb-lite.js')
      c.examined(2)
      if (!adm) c.fail(`${label}: boot.js does not admit bb-lite.js at a 64GB home`, JSON.stringify(plan.defer.find((e) => e.script === 'bb-lite.js')).slice(0, 200))
      if (plan.admit.some((e) => e.script === 'bladeburner.js')) c.fail(`${label}: bladeburner.js admitted at 64GB — it is tier 128`)
    }
    // The live BN4 fleet at 17:30Z (/tel/status.txt): no host had 92.75GB at all.
    const BN4_HOSTS = { home: 64, 'iron-gym': 32, 'max-hardware': 32, zer0: 32, 'neo-net': 32, CSEC: 8, 'harakiri-sushi': 16, foodnstuff: 16, 'sigma-cosmetics': 16, joesguns: 16, 'hong-fang-tea': 16, 'nectar-net': 16, n00dles: 4 }
    const biggest = Math.max(...Object.values(BN4_HOSTS))
    c.examined(1)
    c.note(`live BN4 17:30Z: largest host ${biggest}GB (home, holding the stack), largest off home 32GB, all full of workers — bladeburner.js (92.75GB) cannot be placed anywhere; the largest bb-lite actor (14.6GB) fits home's action slot`)
  }

  // ---- BL5 -------------------------------------------------------------------
  {
    const c = new Check('BL5', 'the fleet before the join, priced on the black-op exit; wired on the blade route; the gang grind not demanded there')
    checks.push(c)
    const sp = await import('sleeveplan.js')
    const { bitNodeMults } = await import('bitNodeMultipliers.js')
    const n4 = bitNodeMults(4)
    const person = livePerson(n4)
    const fresh = Array.from({ length: 5 }, () => ({ shock: 98, sync: 100, skills: {} }))
    const a = sp.preJoinFleetObjectiveOf({ person, node: n4, sleeves: fresh, cash: 250e3, incomePerSec: 650 })
    const trained = Array.from({ length: 5 }, () => ({ shock: 0, sync: 100, skills: { str: 100, def: 100, dex: 100, agi: 100 } }))
    const b = sp.preJoinFleetObjectiveOf({ person, node: n4, sleeves: trained, cash: 250e3, incomePerSec: 650 })
    c.examined(2)
    c.note(`fresh fleet (shock 98): ${a.objective} — ${JSON.stringify(a.hours)}; trained, unshocked: ${b.objective} — ${JSON.stringify(b.hours)}`)
    if (a.objective !== 'money') c.fail(`a freshly shocked fleet must earn money before the join (gym exp x shockBonus ~ 0), got ${a.objective}`, a.why)
    if (a.objective === 'karma' || b.objective === 'karma') c.fail('karma is never the objective before the join on the Bladeburner route')
    if (b.objective !== 'gym') c.fail(`an unshocked, synced fleet should train the player (exp x sync), got ${b.objective}`, b.why)
    if (!(a.hours.money <= a.hours.karma + 1e-9)) c.fail('money must never be slower than nothing (karma) to the join')
    const after = sp.preJoinFleetObjectiveOf({ person: { ...person, skills: { ...person.skills, strength: 120, defense: 120, dexterity: 120, agility: 120 } }, node: n4, sleeves: fresh })
    c.examined(1)
    if (after.objective !== null) c.fail('at combat 100 there is no pre-join objective (the join is bb-lite\'s)')
    // progress.js: the blade branch prices it, and the gang verdict does not override it.
    const pj = fs.readFileSync(path.join(REPO, 'progress.js'), 'utf8')
    c.examined(3)
    if (!/preJoinFleetObjectiveOf\(\{ person: levelledPerson\(player, info\)/.test(pj)) c.fail('progress.js sleeveObjectiveByExit must price the pre-join fleet on the blade route')
    if (!/else if \(byExit\?\.blade !== true && verdict\?\.worth === true/.test(pj)) c.fail('writeSleevePlan must not let the gang verdict override the blade route\'s fleet objective')
    if (!/if \(br\.joined === true\) return out\('money'/.test(pj)) c.fail('in the division the published objective is the money fallback (sleeve.js runs the Bladeburner mix)')
    // healthcheck: the gang grind and karma are notes on the blade route.
    const hc = fs.readFileSync(path.join(REPO, 'tools/healthcheck.mjs'), 'utf8')
    c.examined(2)
    if (!/if \(bladeRouteHere\) note\(`gang grind: not the route/.test(hc)) c.fail('healthcheck must not fail GANG GRIND NOT RUNNING on the Bladeburner route')
    if (!/const karmaIsTheGate = verdict\?\.worth !== false && !bladeRouteHere;/.test(hc)) c.fail('healthcheck must not demand falling karma on the Bladeburner route')
    // sleeve crime money is unscaled by shock (SleeveCrimeWork.getExp scaleWorkStats(.., false)).
    const s0 = { skills: { hacking: 50, strength: 50, defense: 50, dexterity: 50, agility: 50, charisma: 1, intelligence: 0 }, exp: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 }, mults: { crime_money: 1, crime_success: 1, hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, hacking_exp: 1, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1, charisma_exp: 1 }, sync: 100 }
    const m0 = sp.sleeveCrimeRates({ ...s0, shock: 0 }, n4, 'Mug').money
    const m100 = sp.sleeveCrimeRates({ ...s0, shock: 100 }, n4, 'Mug').money
    c.examined(1)
    if (!(m100 > 0 && Math.abs(m100 - m0) < 1e-9)) c.fail(`sleeve crime money must not scale with shock: ${m0} at shock 0, ${m100} at shock 100`)
  }

  // ---- BL6 -------------------------------------------------------------------
  {
    const c = new Check('BL6', 'actplan 0b: the Bladeburner route presumed where the division exists; the plan and a fresh planner claim override it')
    checks.push(c)
    const ap = await import('actplan.js')
    const { bitNodeMults } = await import('bitNodeMultipliers.js')
    const n4 = bitNodeMults(4)
    const node = { CrimeSuccessRate: n4.CrimeSuccessRate, CrimeMoney: n4.CrimeMoney, CrimeExpGain: n4.CrimeExpGain, GangSoftcap: n4.GangSoftcap, GangUniqueAugs: n4.GangUniqueAugs }
    const person = livePerson(n4)
    const now = Date.parse('2026-10-02T17:30:00Z')
    const s = (o = {}) => ({ now, gangNode: true, gangKarma: -54000, factions: ['Slum Snakes'], player: { ...person, money: o.money ?? 250e3, karma: -4777, numPeopleKilled: 0 }, node, progress: null, schedule: null, work: null, tried: {}, equity: 0, blade: { open: true, route: null, joined: false, bar: 100, person }, ...o })
    const poor = ap.decide(s())
    const rich = ap.decide(s({ money: 50e6 }))
    const done = ap.decide(s({ player: { ...person, skills: { ...person.skills, strength: 120, defense: 120, dexterity: 120, agility: 120 }, money: 1e6, karma: -4777 }, blade: { open: true, route: null, joined: true, bar: 100, person } }))
    const hack = ap.decide(s({ blade: { open: true, route: 'hack', joined: false, bar: 100, person } }))
    const planned = ap.decide(s({ progress: { at: new Date(now - 60e3).toISOString(), slot: { owner: 'body' } } }))
    c.examined(5)
    c.note(`cash $250k: ${poor.kind} ${poor.args ?? ''}; cash $50m: ${rich.kind} ${rich.args ?? ''}; combat 120 + joined: ${done.kind} slot ${done.slot}; route 'hack': ${hack.kind} ${hack.args ?? ''}; fresh planner claim: ${planned.kind}`)
    if (poor.kind !== 'crime') c.fail(`with $250k against Powerhouse's $2,400/s the bootstrap must commit the money crime, got ${poor.kind}`, poor.why)
    if (rich.kind !== 'gym') c.fail(`with the fee paid the bootstrap must train at the gym, got ${rich.kind}`, rich.why)
    if (done.kind !== 'idle' || done.slot !== 'bladeburner') c.fail(`at combat 100 in the division the slot is Bladeburner's, got ${done.kind}/${done.slot}`)
    if (/Bladeburner/.test(hack.why ?? '')) c.fail("the plan's 'hack' route must override the presumption")
    if (planned.kind !== 'idle' || /Bladeburner/.test(planned.why)) c.fail('a fresh planner claim outranks the bootstrap')
    // bbslot reads act.js's claim only without a fresh planner.
    const { slotClaim } = await import('bbslot.js')
    const LAR = now - 3 * 3600e3
    const fsOf = (m) => ({ read: (f) => m[f] ?? '' })
    const actRec = JSON.stringify({ at: new Date(now).toISOString(), lastAugReset: LAR, slot: { owner: 'bladeburner', at: new Date(now).toISOString(), lastAugReset: LAR } })
    const a1 = slotClaim(fsOf({ '/tel/act.txt': actRec }), 'home', { lastAugReset: LAR }, now)
    const a2 = slotClaim(fsOf({ '/tel/act.txt': actRec, '/tel/progress.txt': JSON.stringify({ at: new Date(now - 60e3).toISOString(), slot: { owner: 'body' } }) }), 'home', { lastAugReset: LAR }, now)
    c.examined(2)
    if (!a1.ours || a1.by !== 'act.js') c.fail("with no planner pass, act.js's bootstrap claim holds", a1.why)
    if (a2.ours) c.fail("a fresh planner claim outranks act.js's bootstrap claim", a2.why)
  }

  // ---- BL7 -------------------------------------------------------------------
  {
    const c = new Check('BL7', 'the combat bar with the gym fee priced: the live 17:27Z BN4 state; an unpaid gym re-issue falls back to the money crime')
    checks.push(c)
    const bodyplan = await import('bodyplan.js')
    const { bitNodeMults } = await import('bitNodeMultipliers.js')
    const n4 = bitNodeMults(4)
    const person = livePerson(n4)
    const T = { strength: 100, defense: 100, dexterity: 100, agility: 100 }
    const p = bodyplan.combatBarPlanOf(T, person, n4, { cash: 250e3, incomePerSec: 650 })
    c.examined(1)
    c.note(p.why)
    if (p.best !== 'mixed' || p.now?.kind !== 'crime') c.fail(`at $250k against $2,400/s the fastest is the money crime first, then the gym: got ${p.best} / ${JSON.stringify(p.now)}`)
    if (!(p.hours.mixed < p.hours.gym && p.hours.mixed < p.hours.crime)) c.fail(`mixed must beat gym-only (the live stall) and crime-only: ${JSON.stringify(p.hours)}`)
    const rich = bodyplan.combatBarPlanOf(T, person, n4, { cash: 50e6, incomePerSec: 650 })
    c.examined(1)
    if (rich.now?.kind !== 'gym') c.fail(`with the fees paid the gym comes first: ${JSON.stringify(rich.now)}`)
    // progress.js wires the fallback in both places a gym leg is ordered.
    const pj = fs.readFileSync(path.join(REPO, 'progress.js'), 'utf8')
    c.examined(2)
    if (!/if \(plan\?\.now\?\.kind === 'crime'\) return \{ kind: 'crime', type: plan\.now\.crime/.test(pj)) c.fail('bladeGymStep must order the priced crime when the plan says crime')
    if (!/const crime = fb\?\.now\?\.kind === 'crime' \? fb\.now\.crime : null/.test(pj)) c.fail('an unfundable gym body leg must fall back to the priced crime, not idle')
    const ap = await import('actplan.js')
    const lw = { kind: 'gym', args: ['Powerhouse Gym', 'str'], at: '2026-10-02T17:40:00Z', batchAt: 'B' }
    const base = { now: Date.parse('2026-10-02T17:42:00Z'), progress: { at: '2026-10-02T17:41:00Z', slot: { owner: 'body' } }, lastWork: lw, batchAt: 'B', work: null, workAt: '2026-10-02T17:41:30Z', cash: 264e3, gymCostMult: () => 20, reissued: { n: 0, at: 0 } }
    const r1 = ap.reissueWorkOf({ ...base, fundCrime: 'Mug' })
    const r2 = ap.reissueWorkOf(base)
    c.examined(2)
    if (r1?.kind !== 'crime' || r1.args?.[0] !== 'Mug') c.fail(`an unpaid gym re-issue must fall back to the money crime: ${JSON.stringify(r1)}`)
    if (!r2?.skip) c.fail('without a fallback crime the unpaid gym is skipped, as before')
  }
  // ---- BL8 -------------------------------------------------------------------
  {
    const c = new Check('BL8', "the reservation: batch.js keeps bb-lite's footprint free on one host; actors go to a host with the room (and past a refusal); early.js retires beside the batcher")
    checks.push(c)
    const ram = await import('./ram.mjs')
    await ram.load()
    for (const save of [{ bitNode: 4, sf: { 4: 2 } }, { bitNode: 1, sf: { 4: 3 } }]) {
      ram.asSave(save)
      const coordGb = ram.ramOf('bb-lite.js').cost
      const actorGb = Math.max(...Object.values(lp.ACTOR).map((f) => ram.ramOf(f).cost))
      c.examined(2)
      if (coordGb !== lp.LITE_COORD_GB) c.fail(`LITE_COORD_GB ${lp.LITE_COORD_GB} but bb-lite.js prices ${coordGb}GB (BN${save.bitNode})`)
      if (actorGb !== lp.LITE_ACTOR_GB) c.fail(`LITE_ACTOR_GB ${lp.LITE_ACTOR_GB} but the largest actor prices ${actorGb}GB (BN${save.bitNode})`)
    }
    // The pure reservation (live 18:10Z fleet: 32/64GB hosts, home 64).
    const T = Date.parse('2026-10-02T18:10:00Z')
    const info = { lastAugReset: T - 4 * 3600e3 }
    const at = new Date(T - 30e3).toISOString()
    const hosts = [{ host: 'home', max: 64 }, { host: 'zer0', max: 32 }, { host: 'silver-helix', max: 64 }, { host: 'foodnstuff', max: 16 }, { host: 'hacknet-server-0', max: 128, hacknet: true }]
    const none = lp.liteReserveOf({ info, canJoin: true, hosts, now: T })
    const runningOn = lp.liteReserveOf({ lite: { lastAugReset: info.lastAugReset, at, health: 'ok', result: 'acting', reserve: { host: 'zer0', gb: lp.LITE_ACTOR_GB } }, info, canJoin: true, hosts, now: T })
    const full = lp.liteReserveOf({ full: { daemon: 'bladeburner.js', lastAugReset: info.lastAugReset, at, health: 'ok', result: 'acting' }, info, canJoin: true, hosts, now: T })
    const noDiv = lp.liteReserveOf({ info, canJoin: false, hosts, now: T })
    c.examined(4)
    c.note(`not running: ${JSON.stringify(none)}; running on zer0: ${JSON.stringify(runningOn)}; bladeburner.js in its loop: ${full}; no division: ${noDiv}`)
    if (none?.host !== 'silver-helix' || none.gb !== lp.LITE_COORD_GB + lp.LITE_ACTOR_GB) c.fail('with bb-lite not running, the largest non-home, non-hacknet host holds coordinator + actor')
    if (runningOn?.host !== 'zer0' || runningOn.gb !== lp.LITE_ACTOR_GB) c.fail("with bb-lite running, its published reserve (the actor's headroom) is held")
    if (full !== null || noDiv !== null) c.fail('no reservation once bladeburner.js runs, nor where the division cannot exist')
    if (lp.reserveHostOf('foodnstuff', hosts) !== 'silver-helix') c.fail('a coordinator on a 16GB host reserves on the largest host that holds coordinator + actor')
    if (lp.reserveHostOf('zer0', hosts) !== 'zer0') c.fail('a coordinator on a host that holds coordinator + actor reserves there')
    // runActor: the reserved host first; a host whose free RAM vanished or whose exec refuses is skipped.
    const ports = []
    const used = { home: 40, zer0: 10, 'silver-helix': 20 }
    const fake = {
      getHostname: () => 'home',
      scan: (h) => (h === 'home' ? ['zer0', 'silver-helix'] : ['home']),
      hasRootAccess: () => true,
      getServerMaxRam: (h) => ({ home: 64, zer0: 32, 'silver-helix': 64 })[h],
      getServerUsedRam: (h) => used[h],
      getScriptRam: () => 14.6,
      read: () => '',
      scp: (_, h) => {
        // batch.js lands workers on silver-helix between the listing and the exec (the live race).
        if (h === 'silver-helix') used['silver-helix'] = 63
        return true
      },
      clearPort: () => (ports.length = 0),
      exec: (s, h) => (h === 'home' ? 0 : (ports.push(JSON.stringify({ ok: true, host: h })), 7)),
      isRunning: () => false,
      readPort: () => ports.shift() ?? 'NULL PORT DATA',
      sleep: async () => {},
    }
    const r1 = await coord.runActor(fake, 'bb-lite-act.js', {}, { prefer: 'silver-helix' })
    c.examined(1)
    c.note(`runActor: ${JSON.stringify({ ok: r1.ok, host: r1.host, refused: r1.refused, why: r1.why })}`)
    if (!r1.ok || r1.host !== undefined && r1.out?.host !== r1.host) c.fail(`runActor must land the actor somewhere with room: ${r1.why}`)
    if (r1.ok && r1.host !== 'zer0') c.fail(`runActor placed on ${r1.host}, which had no room / refused`)
    if (!(r1.refused ?? []).some((x) => x.startsWith('silver-helix')) || !(r1.refused ?? []).some((x) => x.startsWith('home'))) c.fail('the reserved host (vanished room) and the refusing host must be tried and recorded, in that order of preference')
    // The wiring: batch.js honours it, seed.js retires its workers beside the batcher, boot spawns none.
    const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
    c.examined(3)
    if (!/\(h === liteRes\?\.host \? liteRes\.gb : 0\)/.test(src('batch.js')) || !/liteRes = \(\(\) => \{[\s\S]{0,400}liteReserveOf\(/.test(src('batch.js'))) c.fail("batch.js's reserveFor must hold bbliteplan.liteReserveOf's host and GB")
    if (!/const batching = all\.some\(\(h\) => ns\.hasRootAccess\(h\) && ns\.ps\(h\)\.some\(\(p\) => p\.filename === 'batch\.js'\)\)/.test(src('seed.js')) || !/if \(batching \|\| flags\.kill\)/.test(src('seed.js'))) c.fail('seed.js must retire early.js/hgw.js while batch.js runs')
    if (!/if \(worker && worker\.threads > 0 && !batching\)/.test(src('boot.js'))) c.fail('boot.js must not spawn its home worker beside batch.js')

    // Live 19:20Z: the coordinator off home read the closure from ITS host, copied the actor alone,
    // and the game refused every exec (the target could not price it without its imports).
    // The closure is read from home's copies (scp'd here first), and the target's own price is checked.
    const homeFiles = new Map()
    for (const f of fs.readdirSync(REPO).filter((x) => x.endsWith('.js'))) homeFiles.set(f, fs.readFileSync(path.join(REPO, f), 'utf8'))
    const local = new Map() // the coordinator's host (joesguns)
    const atTarget = new Set()
    const ports2 = []
    const off = {
      getHostname: () => 'joesguns',
      scan: (h) => (h === 'home' ? ['pserv-0'] : ['home']),
      hasRootAccess: () => true,
      getServerMaxRam: (h) => ({ home: 64, 'pserv-0': 32 })[h],
      getServerUsedRam: (h) => ({ home: 63, 'pserv-0': 15.75 })[h],
      getScriptRam: (s, h) => (h === 'pserv-0' ? (['bbliteplan.js', 'bbplan.js', 'bbslot.js', 'coop.js', 'bayes.js'].every((d) => atTarget.has(d)) ? 14.6 : 0) : 14.6),
      read: (f) => local.get(f) ?? '',
      scp: (files, to, from) => {
        for (const f of [files].flat()) {
          if (to === 'joesguns' && from === 'home' && homeFiles.has(f)) local.set(f, homeFiles.get(f))
          if (to === 'pserv-0') atTarget.add(f)
        }
        return true
      },
      clearPort: () => (ports2.length = 0),
      exec: () => (ports2.push(JSON.stringify({ ok: true })), 9),
      isRunning: () => false,
      readPort: () => ports2.shift() ?? 'NULL PORT DATA',
      sleep: async () => {},
    }
    const r2 = await coord.runActor(off, 'bb-lite-act.js', {}, {})
    c.examined(2)
    c.note(`off-home coordinator: ${JSON.stringify({ ok: r2.ok, host: r2.host, why: r2.why })}; copied to the target: ${[...atTarget].sort().join(', ')}`)
    if (!r2.ok || r2.host !== 'pserv-0') c.fail(`an off-home coordinator must ship the actor's whole import closure (read from home) and run it: ${r2.why}`)
    off.getScriptRam = (s, h) => (h === 'pserv-0' ? 0 : 14.6)
    const r3 = await coord.runActor(off, 'bb-lite-read.js', {}, {})
    if (r3.ok || !/cannot be computed there/.test(r3.why ?? '')) c.fail(`a target that cannot price the actor must be named, not exec'd blind: ${r3.why}`)
    // The watchdog leaves progress.js's home block when it relaunches a home daemon (live 19:21Z: ctauto.js took it).
    if (!/if \(target === 'home' && kind === DAEMON && script !== 'progress\.js'\) \{[\s\S]{0,300}const block = 13 \+ 6\.25 \* singularityRamMultiplier/.test(src('watchdog.js'))) c.fail("watchdog.js must not relaunch a home daemon into progress.js's block")
  }
  return checks
}

/** The live BN4 player at 17:27Z (state.json): combat 89/73/73/73, int 134, exp mult 1.3824 (the plan's 13.824 gym exp/s at Powerhouse). */
function livePerson(n) {
  const m = 1.3824
  const mults = { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, hacking_exp: m, strength_exp: m, defense_exp: m, dexterity_exp: m, agility_exp: m, charisma_exp: m, crime_money: 1, crime_success: 1 }
  for (const k of ['strength', 'defense', 'dexterity', 'agility']) mults[k] *= n[`${k[0].toUpperCase()}${k.slice(1)}LevelMultiplier`] ?? 1
  return {
    skills: { hacking: 173, strength: 89, defense: 73, dexterity: 73, agility: 73, charisma: 1, intelligence: 134 },
    exp: { hacking: 25344, strength: 3343, defense: 2201, dexterity: 2201, agility: 2201, charisma: 0 },
    mults,
    city: 'Sector-12',
    money: 250e3,
  }
}
