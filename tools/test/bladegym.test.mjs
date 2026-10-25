// SLEEVES AT THE GYM FOR THE PLAYER on the Bladeburner route (bbplan.sleeveConfigs gym
// fleets, bladeExitGen sl.gym; sleeve.js 'bladeGym'; the gameplan's fleet axis).
//
// Agility enters every action's time with dexterity (Action.ts:110-119) and alone the
// max stamina (Bladeburner.ts:1329). A sleeve at the gym pays the player its exp x sync
// (Work.ts applySleeveGains). Priced in bbsim (tools/sim/bblevers.mjs, the game's
// classes, 60 paired seeds): BN7.2 i2 g4 -0.74 +/- 0.20h vs i5 f1, BN13.2 i1 s1 g4
// -0.92 +/- 0.29h vs i2 f4. Before 2026-10-15 no chooser could pick it.
//
//   BG1  THE POLICY SPACE: sleeveConfigs(n) carries gym fleets (all-infiltrate and
//        one-infiltrate-rest-support remainders), sleeveConfigKey tells them apart,
//        sleeveTasksOf gives each gym sleeve a 'bladeGym' task on agility/dexterity.
//   BG2  THE MODEL PRICES IT: on the live BN7.1 fixture, gym sleeves at shock 0 shorten
//        the exit against the same sleeves idle (withH < withoutH), and from shock 100
//        (shockBonus 0, recovering passively) they gain less — the exp share is what moves it.
//   BG3  THE CHOOSER COMPARES IT: chooseSleeveConfig prices every gym fleet beside the
//        incumbent mixes on the same start (byConfig), and picks the fastest.
//   BG4  WIRING: sleeve.js acts on 'bladeGym' (travel + setToGymWorkout at Powerhouse);
//        the committed fleet carries gym (bladeFleetOf); the gameplan passes the gym
//        fleet into bbsim (surrogate.bbSpec) and bbsim trains the named stats.
//   BG6  the actor matches: with the Simulacrum installed progress.js's bladeGymStep trains the
//        lowest combat stat beside the actions (what bladeExitGen gymParallel and bbsim credit).
//   BG5  bbsim's install clears Stanek's charge (StaneksGift.ts:228-230) and the
//        Simulacrum lets the class run beside the action (Bladeburner.ts:179, :1355).

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn7-sleevecontracts.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))

const startOf = (over = {}) => BB.bladeStartOf({ tel: FX.tel, person: FX.person, sleeves: { infiltrate: 0, support: 5, fa: 0 }, sleeveBodies: FX.sleeveBodies, gymExpPerSec: FX.start.gymExpPerSec, bnRank: FX.start.bnRank, skillCostMult: FX.start.skillCostMult, rankScale: FX.start.rankScale, successScale: FX.start.successScale, goCombat: FX.start.goCombat, maxH: 60, now: Date.parse(FX.tel.at), ...over })

export async function run() {
  const checks = []
  const add = (id, title) => {
    const c = new Check(id, title)
    checks.push(c)
    return c
  }
  const s0 = startOf()

  {
    const c = add('BG1', 'THE POLICY SPACE: sleeveConfigs carries gym fleets; tasks and keys name them')
    const cfgs = BB.sleeveConfigs(5)
    const gyms = cfgs.filter((x) => x.gym > 0)
    c.examined(cfgs.length)
    c.note(`${cfgs.length} configurations, ${gyms.length} with gym sleeves: ${gyms.map(BB.sleeveConfigKey).join(' ')}`)
    if (!gyms.length) c.fail('sleeveConfigs(5) has no gym fleet: the chooser cannot pick sleeves training the player')
    for (const want of ['i1s0f0g4', 'i2s0f0g3', 'i1s2f0g2']) if (!gyms.some((x) => BB.sleeveConfigKey(x) === want)) c.fail(`gym fleet ${want} missing`)
    if (gyms.some((x) => x.infiltrate + x.support + x.fa + x.gym !== 5)) c.fail('a gym fleet does not use exactly the five sleeves')
    const tasks = BB.sleeveTasksOf({ infiltrate: 1, support: 0, fa: 0, gym: 4 }, 5)
    const gt = tasks.filter((t) => t?.kind === 'bladeGym')
    if (gt.length !== 4) c.fail('sleeveTasksOf does not give four bladeGym tasks', JSON.stringify(tasks))
    if (gt.map((t) => t.stat).join() !== 'agility,dexterity,agility,dexterity') c.fail('the gym sleeves do not train agility/dexterity round-robin', JSON.stringify(gt))
    if (BB.sleeveConfigKey({ infiltrate: 1, support: 0, fa: 0, gym: 4 }) === BB.sleeveConfigKey({ infiltrate: 1, support: 0, fa: 0 })) c.fail('sleeveConfigKey does not tell a gym fleet from the same fleet idle')
  }

  {
    const c = add('BG2', 'THE MODEL PRICES IT: gym sleeves move the exit through the exp share (withH vs withoutH, same start)')
    const bodies0 = FX.sleeveBodies.map((b) => ({ ...b, shock: 0 }))
    const bodies100 = FX.sleeveBodies.map((b) => ({ ...b, shock: 100 }))
    const idle0 = BB.bladeExit({ ...s0, sleeveBodies: bodies0, sleeves: { infiltrate: 1, support: 0, fa: 0 } })
    const gym0 = BB.bladeExit({ ...s0, sleeveBodies: bodies0, sleeves: { infiltrate: 1, support: 0, fa: 0, gym: 4 } })
    const idle100 = BB.bladeExit({ ...s0, sleeveBodies: bodies100, sleeves: { infiltrate: 1, support: 0, fa: 0 } })
    const gym100 = BB.bladeExit({ ...s0, sleeveBodies: bodies100, sleeves: { infiltrate: 1, support: 0, fa: 0, gym: 4 } })
    c.examined(4)
    c.note(`shock 0: i1 + 4 idle ${f2(idle0.hours)}h, i1 + 4 gym ${f2(gym0.hours)}h (d ${f2(gym0.hours - idle0.hours)}h); shock 100: ${f2(idle100.hours)}h vs ${f2(gym100.hours)}h`)
    if (!(gym0.hours < idle0.hours)) c.fail('four unshocked gym sleeves do not shorten the exit against the same four idle')
    // shock 100 starts at shockBonus 0 and recovers passively (Sleeve.ts:270): less than the unshocked gain, not none
    if (!(idle100.hours - gym100.hours < idle0.hours - gym0.hours)) c.fail('shock-100 gym sleeves gain as much as unshocked ones: the share is not shocked')
  }

  {
    const c = add('BG3', 'THE CHOOSER COMPARES IT: every gym fleet priced beside the incumbent mixes, the fastest picked')
    const r = BB.chooseSleeveConfig(s0, 5, undefined, { Q: 1, contracts: false })
    const rows = r.byConfig.filter((x) => x.config.gym > 0)
    c.examined(r.byConfig.length)
    const best = [...r.byConfig].filter((x) => x.hours !== null).sort((a, b) => a.hours - b.hours)[0]
    c.note(`picked ${BB.sleeveConfigKey(r.config)} ${f2(r.hours)}h; best gym fleet ${rows.length ? BB.sleeveConfigKey([...rows].sort((a, b) => a.hours - b.hours)[0].config) + ' ' + f2(Math.min(...rows.map((x) => x.hours))) + 'h' : 'none'}`)
    if (!rows.length) c.fail('the chooser priced no gym fleet')
    if (rows.some((x) => !Number.isFinite(x.hours))) c.fail('a gym fleet is unpriced', JSON.stringify(rows.filter((x) => !Number.isFinite(x.hours))))
    if (best && Math.abs(best.hours - r.hours) > 1e-9) c.fail('the chooser did not pick the fastest configuration')
  }

  {
    const c = add('BG4', 'WIRING: sleeve.js acts on bladeGym; the committed fleet carries gym; the gameplan and bbsim train it')
    const sl = SRC('sleeve.js')
    const sur = SRC('tools/sim/gameplan/surrogate.mjs')
    const sim = SRC('tools/sim/nodechoice/bbsim.mjs')
    c.examined(3)
    if (!/sleeveTask\.kind === 'bladeGym'[\s\S]{0,700}setToGymWorkout\(sleeve\.index, POWERHOUSE, stat\)/.test(sl)) c.fail("sleeve.js does not run 'bladeGym' at Powerhouse")
    const f = BB.bladeFleetOf({ at: new Date().toISOString(), blade: { config: { infiltrate: 1, support: 0, fa: 0, gym: 4 } } })
    if (f.sleeves.gym !== 4) c.fail('bladeFleetOf drops the committed gym sleeves', JSON.stringify(f.sleeves))
    if (!/fleet\.gym > 0 \? \{ gym: fleet\.gym, gymStats:/.test(sur)) c.fail('surrogate.bbSpec does not pass the gym fleet into bbsim')
    if (!/gymStatsOf\(pol\.sleeves\?\.gymStats\)/.test(sim)) c.fail('bbsim gym sleeves do not train the named stats')
  }

  {
    const c = add('BG5', "bbsim: the install clears Stanek's charge; the Simulacrum runs the class beside the action")
    const sim = SRC('tools/sim/nodechoice/bbsim.mjs')
    c.examined(1)
    if (!/stC\.chargeAt\(t - stT0\)/.test(sim) || !/stT0 = t/.test(sim)) c.fail("bbsim's charge clock does not restart at an install")
    if (!/gymming = !simOn/.test(sim)) c.fail("bbsim's retrain blocks the actions with the Simulacrum installed")
    if (!/restGym = !!train\?\.rest && !simOn/.test(sim)) c.fail('bbsim has no rest-at-the-gym training arm')
  }
  {
    const c = add('BG6', "THE ACTOR TRAINS WHERE THE MODELS CREDIT IT: with The Blade's Simulacrum installed, progress.js's blade gym step runs the class beside the actions")
    const pr = SRC('progress.js')
    const bp = SRC('bbplan.js')
    c.examined(2)
    // both exit models credit the class beside the action (bladeExitGen gymParallel when simOn; bbsim simOn)
    if (!/if \(simOn && !gRun\) slotParallel\(dt\)/.test(bp)) c.note('bladeExitGen no longer gyms beside the action: this check guards an actor for a credit that is gone')
    const step = pr.slice(pr.indexOf('const bladeGymStep = (() => {'), pr.indexOf('const covenantStep = (() => {'))
    if (!step.length) c.fail('progress.js has no bladeGymStep')
    else if (!/const postBar = !Object\.keys\(short\)\.length && installedCount\?\.has\?\.\(SIMULACRUM\)\s*if \(postBar\) \{[\s\S]{0,300}short = \{ \[low\]:[\s\S]{0,1600}if \(postBar\) \{[\s\S]{0,400}return \{ kind: 'gym', gym: legs\.gym/.test(step)) c.fail("bladeGymStep idles the slot with the Simulacrum installed while both exit models credit the class beside the action")
  }
  {
    // BG7 THE SIMULACRUM FREES THE ACTOR FROM THE SLOT (bbslot.slotClaim): Bladeburner actions run beside
    // any work with it installed (Bladeburner.ts:179, :1355), so a 'body' claim must not stop the actor.
    // Live 2026-10-18 BN11.2: 21h at rank 200 while the slot read 'body' for the parallel gym.
    const c = add('BG7', "the Simulacrum installed: the Bladeburner actor acts beside a 'body' slot claim")
    const slot = await import(path.join(REPO_ROOT, 'bbslot.js'))
    const now = Date.now()
    const files = { [slot.PROGRESS]: JSON.stringify({ at: new Date(now).toISOString(), slot: { owner: 'body', why: 'gym' } }) }
    const ns = { read: (f) => files[f] ?? '', fileExists: (f) => f in files }
    const base = { lastAugReset: now - 3600e3 }
    const withSim = slot.slotClaim(ns, 'home', { ...base, ownedAugs: new Map([["The Blade's Simulacrum", 1]]) }, now)
    const without = slot.slotClaim(ns, 'home', { ...base, ownedAugs: new Map([['NeuroFlux Governor', 1]]) }, now)
    c.examined(2)
    if (!withSim.ours) c.fail(`with the Simulacrum the actor must act beside the 'body' claim: ${JSON.stringify(withSim).slice(0, 200)}`)
    if (without.ours) c.fail(`without the Simulacrum a 'body' claim must hold the actor: ${JSON.stringify(without).slice(0, 200)}`)
    // the actor must read the reset info FRESH: SF7.3 pushes the Simulacrum into the installed augs only at the
    // join, so a startup copy never shows it (BN3.1 2026-10-21: 17h at rank 300).
    const bj = fs.readFileSync(path.join(REPO_ROOT, 'bladeburner.js'), 'utf8')
    c.examined(1)
    // bb-lite's actor too (BN5.2 2026-10-24: 'slot-not-ours' on a 'body' claim with the Simulacrum installed —
    // the actor's claim had only lastAugReset): bb-lite reads the installed augs fresh and hands them over.
    const bl = fs.readFileSync(path.join(REPO_ROOT, 'bb-lite.js'), 'utf8')
    const ba = fs.readFileSync(path.join(REPO_ROOT, 'bb-lite-act.js'), 'utf8')
    c.examined(2)
    if (!/ownedAugs = \[\.\.\.\(ns\.getResetInfo\(\)\.ownedAugs[\s\S]{0,400}lastAugReset: info\.lastAugReset, ownedAugs(, node: info\.currentNode)? \}/.test(bl)) c.fail('bb-lite.js must read the installed augs fresh and pass them to its actor')
    if (!/slotClaim\(ns, 'home', \{ lastAugReset: want\.lastAugReset, ownedAugs:/.test(ba)) c.fail("bb-lite-act.js's slot claim must see the installed augs (the Simulacrum)")
    if (!/export function slotClaim\(ns, host, info\) \{[\s\S]{0,700}fresh = ns\.getResetInfo\(\)[\s\S]{0,200}return slotClaimHere\(ns, host, fresh\)/.test(bj)) c.fail('bladeburner.js slotClaim must read getResetInfo() fresh (the Simulacrum arrives at the join)')
  }

  return checks
}
