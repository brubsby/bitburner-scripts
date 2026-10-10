// SLEEVES ON CONTRACTS, priced on the black-op exit (bbplan.sleeveContractConfigs,
// bladeExitGen sleeveStep; sleeve.js acts on the committed fleet).
//
// A sleeve's contract success pays the SHARED division (SleeveBladeburnerWork
// -> Bladeburner.completeAction(sleeve, id, false) -> changeRank), so a fleet
// that trains sleeves and puts them on contracts is a policy the Bladeburner
// route must price beside Infiltrate / Support / Field Analysis. Before
// 2026-10-10 the model had no such option (plan.txt 'i/s/f').
//
//   SC1  THE DECISION IS withH - withoutH ON SHARED INPUTS: the fleet search
//        prices the contract fleets, and what it publishes (contracts.vsH) is
//        the best contract fleet's exit minus the chosen fleet's, each
//        recomputed here by bladeExit on the same start.
//   SC2  a contract sleeve's rank enters the exit: on the live BN7.1 state the
//        same fleet with and without its contract sleeves differ, the sleeves'
//        rank > 0; trained bodies earn more than untrained ones.
//   SC3  the phase rule (sleevePhaseOf): recover above recoverTo, train below
//        trainTo, contracts else — and a shock-100 sleeve never "trains" (it gains 0).
//   SC4  the level is the action's (bladeburner.js keeps contracts at max level):
//        sleeveContractOf rolls at maxLevel; only contracts, never operations.
//   SC5  the live verdict (13:09Z): no contract fleet beats five support by more
//        than the fleet's keep tolerance; a fresh division picks none either.
//   SC6  wiring: sleeve.js passes the bodies and runs the phase rule with the
//        three ns.sleeve calls; progress.js prices the plan's route with the bodies.
//   SC7  A FRESH PROCESS'S INCUMBENT IS THE RUNNING FLEET (sleeveplan.bladeIncumbentOf
//        on ns.sleeve.getTask): live ~14:00Z a restart had no incumbent and switched
//        five Support to i1s2f0c2t100 inside the keep tolerance. Five SUPPORT tasks
//        keep i0s5f0 on the fixture; the committed schedule is used only where the
//        tasks agree; sleeve.js falls back to it when it has no last answer.
//   SC8  CPU GUARD (thread CPU, retried once): sleeve.js's fleet pass on the live
//        inputs (cappedFleetGen over bladeFleetGen, Q members, maxH 200, the three
//        contract fleets) — every synchronous step < 10ms, the pass < 4s of work.
//        Measured 2026-10-10: ~118k steps, longest ~1ms warm (5ms cold), ~1.3s per pass.

import './gameresolve.mjs'
import { Check, threadCpuMs, retryOnce } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const SP = await import('sleeveplan.js')
const { drain } = await import('coop.js')
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn7-sleevecontracts.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))
const Q = BB.BLADE_ENSEMBLE.Q

const startOf = (over = {}) => BB.bladeStartOf({ tel: FX.tel, person: FX.person, sleeves: { infiltrate: 0, support: 5, fa: 0 }, sleeveBodies: FX.sleeveBodies, gymExpPerSec: FX.start.gymExpPerSec, bnRank: FX.start.bnRank, skillCostMult: FX.start.skillCostMult, rankScale: FX.start.rankScale, successScale: FX.start.successScale, rankSdLn: FX.start.rankSdLn, successSdLn: FX.start.successSdLn, goCombat: FX.start.goCombat, maxH: 60, now: Date.parse(FX.tel.at), ...over })
const meanExit = (s0, cfg) => {
  let a = 0
  for (let m = 0; m < Q; m++) a += BB.bladeExit(BB.bladeMemberOf({ ...s0, sleeves: cfg }, m, Q)).hours
  return a / Q
}

export async function run() {
  const checks = []
  const add = (id, title) => {
    const c = new Check(id, title)
    checks.push(c)
    return c
  }
  const s0 = startOf()

  // ---- SC1 -----------------------------------------------------------------
  {
    const c = add('SC1', 'THE DECISION IS withH - withoutH ON SHARED INPUTS: the fleet search prices the contract fleets and publishes the difference')
    const cfgs = typeof BB.sleeveContractConfigs === 'function' ? BB.sleeveContractConfigs(5) : []
    c.examined(1)
    if (!cfgs.length) c.fail('bbplan has no contract fleets (sleeveContractConfigs): the policy is not priced')
    else {
      const r = drain(SP.bladeFleetGen(s0, 5, { infiltrate: 0, support: 5, fa: 0 }, { Q }))
      c.examined(1)
      const pickH = meanExit(s0, r.config)
      const best = cfgs.map((x) => ({ x, h: meanExit(s0, x) })).sort((a, b) => a.h - b.h)[0]
      c.note(`fleet run ${BB.sleeveConfigKey(r.config)} ${f2(pickH)}h; best contract fleet ${BB.sleeveConfigKey(best.x)} ${f2(best.h)}h; published ${JSON.stringify(r.contracts)}`)
      if (!r.contracts || !Number.isFinite(r.contracts.vsH)) c.fail('sleeve.txt would carry no price of the contract fleets', JSON.stringify(r.contracts))
      else {
        if (r.contracts.best !== BB.sleeveConfigKey(best.x)) c.fail('the published best contract fleet is not the fastest one', `${r.contracts.best} vs ${BB.sleeveConfigKey(best.x)}`)
        if (Math.abs(r.contracts.vsH - (best.h - pickH)) > 0.011) c.fail('the published difference is not withH - withoutH on the same start', `${r.contracts.vsH} vs ${f2(best.h - pickH)}`)
      }
    }
  }

  // ---- SC2 -----------------------------------------------------------------
  {
    const c = add('SC2', "A CONTRACT SLEEVE'S RANK ENTERS THE EXIT (changeRank on the shared division)")
    const without = BB.bladeExit({ ...s0, sleeves: { infiltrate: 1, support: 2, fa: 0 } })
    const withC = BB.bladeExit({ ...s0, sleeves: { infiltrate: 1, support: 2, fa: 0, contracts: 2 } })
    const trained = BB.bladeExit({ ...s0, sleeveBodies: FX.sleeveBodies.map((b) => ({ ...b, shock: 0, exp: { ...b.exp, strength: 2e5, defense: 2e5, dexterity: 2e5, agility: 2e5 } })), sleeves: { infiltrate: 1, support: 2, fa: 0, contracts: 2 } })
    c.examined(3)
    c.note(`i1s2 ${f2(without.hours)}h; + 2 untrained contract sleeves ${f2(withC.hours)}h (their rank ${withC.sleeveContracts?.rank}); + 2 trained (shock 0, ~190 combat) ${f2(trained.hours)}h (rank ${trained.sleeveContracts?.rank})`)
    if (!(withC.sleeveContracts?.rank > 0)) c.fail('contract sleeves earn no rank in the model')
    if (withC.hours === without.hours) c.fail('the contract sleeves do not move the exit')
    if (!(trained.sleeveContracts?.rank > withC.sleeveContracts?.rank)) c.fail('trained sleeves earn no more than untrained ones')
    if (!(trained.hours < without.hours)) c.fail('two trained, unshocked contract sleeves do not beat leaving them idle')
  }

  // ---- SC3 -----------------------------------------------------------------
  {
    const c = add('SC3', 'THE PHASE RULE (sleevePhaseOf): recover / train / contract by state, never a clock')
    const b = BB.sleeveBodyOf({ shock: 73, skills: { intelligence: 85 } })
    const cases = [
      [b, { recoverTo: 50, trainTo: 100 }, 'recover'],
      [{ ...b, shock: 40 }, { recoverTo: 50, trainTo: 100 }, 'train'],
      [{ ...b, shock: 100 }, { trainTo: 100 }, 'contract'], // shockBonus 0: the gym pays nothing
      [BB.sleeveBodyOf({ shock: 40, skills: { strength: 150, defense: 150, dexterity: 150, agility: 150 } }), { trainTo: 100 }, 'contract'],
      [b, {}, 'contract'],
    ]
    for (const [body, cfg, want] of cases) {
      c.examined(1)
      const got = BB.sleevePhaseOf(body, cfg)
      if (got !== want) c.fail(`phase ${got}, want ${want}`, JSON.stringify({ shock: body.shock, cfg }))
    }
    const stat = BB.sleeveGymStatOf(b)
    c.examined(1)
    if (!(stat === 'dexterity' || stat === 'agility')) c.fail(`an untrained sleeve trains ${stat} first, not the contracts' heaviest stat (dex/agi)`)
  }

  // ---- SC4 -----------------------------------------------------------------
  {
    const c = add('SC4', "THE LEVEL IS THE ACTION'S: a sleeve rolls at the max level the daemon leaves; contracts only")
    const sm = BB.skillMultsOf(FX.tel.levels)
    const body = BB.sleeveBodyOf({ shock: 0, skills: { strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 80, intelligence: 85 } })
    const args = { int: 85, counts: FX.tel.counts, maxL: FX.tel.maxLevels, bnRank: 0.6 }
    const pick = BB.sleeveContractOf(body, sm, args)
    const free = BB.sleeveContractOf(body, sm, { ...args, atMax: false })
    c.examined(2)
    c.note(`at the action's level: ${pick?.d?.name} L${pick?.L} p ${f2(pick?.p)}; at a free level: ${free?.d?.name} L${free?.L} p ${f2(free?.p)}`)
    if (!pick || pick.d.kind !== 'contract' || free?.d?.kind !== 'contract') c.fail('a sleeve was offered an operation (SleeveBladeburnerWork: General | Contract only)')
    else if (pick.L !== FX.tel.maxLevels[pick.d.name]) c.fail(`rolled at L${pick.L}, the action stands at L${FX.tel.maxLevels[pick.d.name]}`)
    const p = BB.pFrom(BB.envOf(pick.d, { int: 85, stamina: 1, maxStamina: 1, augMult: 1 }), pick.d, pick.L, body, sm)
    c.examined(1)
    if (Math.abs(p - pick.p) > 1e-12) c.fail('the chance is not the game formula with the sleeve as the person', `${p} vs ${pick.p}`)
  }

  // ---- SC5 -----------------------------------------------------------------
  {
    const c = add('SC5', 'THE LIVE VERDICT (BN7.1 13:09Z): no contract fleet beats five support past the keep tolerance; none in a fresh division')
    const base = meanExit(s0, { infiltrate: 0, support: 5, fa: 0 })
    const rows = BB.sleeveContractConfigs(5).map((x) => ({ k: BB.sleeveConfigKey(x), h: meanExit(s0, x) }))
    const best = rows.sort((a, b) => a.h - b.h)[0]
    const tol = SP.FLEET_KEEP.rel * base
    c.examined(rows.length + 1)
    c.note(`five support ${f2(base)}h (the plan ${FX.plan.meanH}h); ${rows.map((r) => `${r.k} ${f2(r.h)}h`).join(', ')}; keep tolerance >= ${f2(tol)}h`)
    if (base - best.h > tol) c.fail(`a contract fleet beats the incumbent by ${f2(base - best.h)}h > ${f2(tol)}h: the live fleet should change (re-price)`)
    // A fresh division: rank 0, sleeves at shock 100 (Sleeve.prestige), the same player.
    const fresh = { ...s0, joined: false, rank: 0, maxRank: 0, skillPoints: 0, levels: {}, blackOpsDone: 0, counts: undefined, maxLevels: undefined, cities: undefined, successes: undefined, divisionAgeH: 0, stamina: undefined, maxStamina: undefined, staminaBonus: 0, skillSinceS: undefined, sleeveBodies: FX.sleeveBodies.map(() => BB.sleeveBodyOf({ skills: { intelligence: 85 } })), maxH: 200 }
    const pick = BB.chooseSleeveConfig(fresh, 5, BB.POLICY, { Q: 1 })
    c.examined(1)
    c.note(`fresh division: ${BB.sleeveConfigKey(pick.config)} ${f2(pick.hours)}h; best contract fleet ${pick.byConfig.filter((x) => x.config.contracts > 0 && x.hours != null).sort((a, b) => a.hours - b.hours).map((x) => `${BB.sleeveConfigKey(x.config)} ${f2(x.hours)}h`)[0]}`)
    if (pick.config?.contracts > 0) c.warn('a fresh division now picks a contract fleet (the model changed: re-read the verdict)')
  }

  // ---- SC6 -----------------------------------------------------------------
  {
    const c = add('SC6', 'WIRING: sleeve.js runs the priced rule; progress.js prices the route with the bodies')
    const sl = SRC('sleeve.js')
    const pr = SRC('progress.js')
    const need = [
      [sl, /sleeveBodies: sleeves\.map\(bodyOfSleeve\)/, 'sleeve.js: the fleet priced on the sleeves\' bodies'],
      [sl, /sleeveTask\.kind === 'bladeContract'/, 'sleeve.js: the contract task'],
      [sl, /sleevePhaseOf\(body, sleeveTask\)/, 'sleeve.js: the phase rule the model priced'],
      [sl, /ns\.sleeve\.setToShockRecovery\(sleeve\.index\)/, 'sleeve.js: recover'],
      [sl, /ns\.sleeve\.setToGymWorkout\(sleeve\.index, POWERHOUSE, stat\)/, 'sleeve.js: train'],
      [sl, /ns\.sleeve\.setToBladeburnerAction\(sleeve\.index, SLEEVE_ACTION\.contracts, pick\.d\.name\)/, 'sleeve.js: the contract'],
      [pr, /bladeStartOf\(\{ tel, person, sleeves, sleeveBodies: fl\.bodies,/, 'progress.js: the route priced on the bodies'],
    ]
    for (const [src, re, what] of need) {
      c.examined(1)
      if (!re.test(src)) c.fail(`missing: ${what}`)
    }
  }
  // ---- SC7 -----------------------------------------------------------------
  {
    const c = add('SC7', "A FRESH PROCESS'S INCUMBENT IS THE RUNNING FLEET: a restart does not switch fleets inside the keep tolerance")
    const sup = { type: 'SUPPORT' }
    const inc = SP.bladeIncumbentOf([sup, sup, sup, sup, sup])
    c.examined(1)
    if (BB.sleeveConfigKey(inc.config) !== 'i0s5f0') c.fail(`five SUPPORT tasks read as ${BB.sleeveConfigKey(inc.config)}, not i0s5f0`)
    const fresh = drain(SP.bladeFleetGen(s0, 5, null, { Q }))
    const kept = drain(SP.bladeFleetGen(s0, 5, inc.config, { Q }))
    c.examined(2)
    c.note(`no incumbent -> ${BB.sleeveConfigKey(fresh.config)} ${f2(fresh.hours)}h; incumbent from the tasks (${inc.why}) -> ${BB.sleeveConfigKey(kept.config)} ${f2(kept.hours)}h`)
    if (BB.sleeveConfigKey(kept.config) !== 'i0s5f0') c.fail(`a restart with five sleeves on Support switched to ${BB.sleeveConfigKey(kept.config)} (inside the keep tolerance on this fixture, SC5)`)
    // The committed contract schedule, where the tasks agree (a contract sleeve training reads CLASS).
    const cc = { infiltrate: 1, support: 2, fa: 0, contracts: 2, trainTo: 100 }
    const t = [{ type: 'INFILTRATE' }, sup, sup, { type: 'CLASS' }, { type: 'BLADEBURNER', actionType: 'Contracts', actionName: 'Tracking' }]
    const a = SP.bladeIncumbentOf(t, cc)
    const b = SP.bladeIncumbentOf([sup, sup, sup, sup, sup], cc)
    const d = SP.bladeIncumbentOf([{ type: 'CRIME' }, null, { type: 'FACTION' }])
    const e = SP.bladeIncumbentOf([{ type: 'BLADEBURNER', actionType: 'General', actionName: 'Field Analysis' }, { type: 'INFILTRATE' }])
    c.examined(4)
    if (BB.sleeveConfigKey(a.config) !== 'i1s2f0c2t100') c.fail(`the committed contract fleet the tasks agree with read as ${BB.sleeveConfigKey(a.config)}`)
    if (BB.sleeveConfigKey(b.config) !== 'i0s5f0' || b.source !== 'tasks') c.fail(`a committed config the tasks contradict was used: ${BB.sleeveConfigKey(b.config)} (${b.source})`)
    if (d.config !== null) c.fail('sleeves off the division read as a Bladeburner fleet')
    if (BB.sleeveConfigKey(e.config) !== 'i1s0f1') c.fail(`Field Analysis / Infiltrate read as ${BB.sleeveConfigKey(e.config)}`)
    const sl = SRC('sleeve.js')
    c.examined(2)
    if (!/bladeMemo\?\.result\?\.config \? \{[^}]*\} : bladeIncumbentOf\(sleeves\.map\(\(x\) => x\.task\), prevCommitted\)/.test(sl)) c.fail('sleeve.js: a process with no last answer must take the running fleet as the incumbent')
    if (!/bladeFleetGen\(s0, n, incumbent\.config,/.test(sl)) c.fail('sleeve.js: the fleet search must be given that incumbent')
    if (!/prevBlade = JSON\.parse\(ns\.read\(RAMOVERRIDE_STATUS\)[^\n]*\n\s*const rerrors = \[\]\n\s*const note = reporter\(/.test(sl)) c.fail("sleeve.js: the last committed fleet must be read before this process's first write replaces it")
  }

  // ---- SC8 -----------------------------------------------------------------
  checks.push(await retryOnce(async () => {
    const c = new Check('SC8', "CPU GUARD: sleeve.js's fleet pass on the live inputs (three contract fleets, Q members, maxH 200): every synchronous step < 10ms, the pass < 4s of work")
    const SJ = await import('sleeve.js')
    const live = startOf({ maxH: 200 })
    const one = () => {
      let worst = 0, total = 0, steps = 0, r
      const gen = SJ.cappedFleetGen(SP.bladeFleetGen(live, 5, { infiltrate: 0, support: 5, fa: 0 }, { Q }), { steps: 1e7, ms: 1e9 })
      for (;;) {
        const t0 = threadCpuMs()
        r = gen.next()
        const dt = threadCpuMs() - t0
        if (dt > worst) worst = dt
        total += dt
        steps++
        if (r.done) break
      }
      return { worst, total, steps, value: r.value }
    }
    one() // warm (the page's JIT is warm after its first pass)
    const r = one()
    c.examined(r.steps)
    c.note(`${r.steps} steps, longest ${r.worst.toFixed(2)}ms, ${r.total.toFixed(0)}ms of work -> ${BB.sleeveConfigKey(r.value.config)} ${r.value.hours}h`)
    if (!(r.worst < 10)) c.fail(`a ${r.worst.toFixed(1)}ms synchronous step (limit 10ms)`)
    if (!(r.total < 4000)) c.fail(`${r.total.toFixed(0)}ms of work per pass (limit 4000ms)`)
    return c
  }))
  return checks
}
