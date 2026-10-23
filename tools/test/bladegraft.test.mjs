// GRAFTS ON THE BLADEBURNER ROUTE (bbplan.bladeGraftsGen / bladeExitGen s0.grafts, bbsim
// o.grafts, progress.js bladeRouteGraftsGen + the blade graft step, bbhealth BLADE GRAFT NOT
// STARTED). The route never installs: a bought augmentation never applies on it, a grafted one
// does at once (GraftingWork.finish -> applyAugmentation). Each graft costs baseCost x 3, holds
// the work slot (log2(sum of mults) + 0.5)/2 h / the intelligence bonus, and adds an entropy stack
// (every multiplier x0.98).
//
//   BGR1  FIDELITY: the graftable Bladeburner specials, the cost and the time are the game's
//         (GraftingHelpers.getGraftingAvailableAugs rule, GraftableAugmentation, the bundle).
//   BGR2  THE COMPARISON: the verdict is withH - withoutH, both re-priced independently from
//         the same start (the Q members' mean); it grafts on the BN7 fixture with money.
//   BGR3  ENTROPY IS PRICED: four zero-gain grafts slow the exit against the same four with no
//         entropy (the Congruity counterfactual) — drop the nerf and this goes red.
//   BGR4  THE SLOT AND THE MONEY: without the Simulacrum a graft stops the actions (a longer
//         delay than with it); a graft waits for its money (wealth + income x t).
//   BGR5  WIRING: progress.js prices the schedule inside the route decision and publishes it,
//         the graft step orders it on the Bladeburner route through travel + act-graft with its
//         cost raised, act.js's Stanek gate still covers 'graft', and progress.txt carries bladeGraft.
//   BGR6  HEALTH: BLADE GRAFT NOT STARTED fires on a graft due and unstarted past the budget,
//         and stays quiet while it runs.
//   BGR7  bbsim (the game's classes): a scheduled graft runs on GraftableAugmentation's time,
//         spends its cost and stacks calculateEntropy.

import './gameresolve.mjs'
import { Check, QUICK } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const GP = await import('graftplan.js')
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn7-sleevecontracts.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x))

const startOf = (over = {}) => BB.bladeStartOf({ tel: FX.tel, person: FX.person, sleeves: { infiltrate: 1, support: 4, fa: 0 }, sleeveBodies: FX.sleeveBodies, gymExpPerSec: FX.start.gymExpPerSec, bnRank: FX.start.bnRank, skillCostMult: FX.start.skillCostMult, simulacrum: true, maxH: 80, now: Date.parse(FX.tel.at), ...over })

export async function run() {
  const checks = []
  const add = (id, title) => {
    const c = new Check(id, title)
    checks.push(c)
    return c
  }
  const g = (await import('../sim/nodechoice/game.mjs')).default
  const int = FX.person.skills.intelligence ?? 0
  const s0 = startOf()

  {
    const c = add('BGR1', "FIDELITY: the Bladeburners' graftable specials, the graft cost and time are the game's")
    const want = new Set(Object.values(g.Augmentations).filter((a) => a.isSpecial && a.factions.includes('Bladeburners')).map((a) => a.name))
    const have = BB.BLADE_GRAFT_SPECIAL
    c.examined(want.size)
    for (const n of want) if (!have.has(n)) c.fail(`BLADE_GRAFT_SPECIAL misses ${n} (isSpecial, in the Bladeburners' list: graftable by a member, GraftingHelpers.ts:12-14)`)
    for (const n of have) if (!want.has(n)) c.fail(`BLADE_GRAFT_SPECIAL has ${n}, which the game does not offer a member`)
    for (const a of Object.values(g.Augmentations)) {
      const member = !a.isSpecial || a.factions.includes('Bladeburners')
      if (BB.bladeGraftableOf(a.name, true) !== member) c.fail(`bladeGraftableOf(${a.name}, member) ${BB.bladeGraftableOf(a.name, true)} vs the game's ${member}`)
      if (BB.bladeGraftableOf(a.name, false) !== !a.isSpecial) c.fail(`bladeGraftableOf(${a.name}, not a member) disagrees with the game`)
      const ga = new g.GraftableAugmentation(a)
      if (!Number.isFinite(ga.cost)) continue // no price (BigD's: Infinity): nothing to graft
      const sp = BB.bladeGraftSpecOf({ name: a.name, mults: a.mults, baseCost: a.baseCost, prereqs: a.prereqs }, int)
      const bonus = 1 + Math.pow(int, 0.8) / 600
      c.examined(1)
      if (!sp || Math.abs(sp.cost / ga.cost - 1) > 1e-9) c.fail(`${a.name}: cost ${sp?.cost} vs the game's ${ga.cost}`)
      else if (Math.abs(sp.slotS / (ga.time / bonus / 1000) - 1) > 1e-9) c.fail(`${a.name}: slot ${sp.slotS}s vs the game's ${ga.time / bonus / 1000}s`)
    }
    c.note(`${want.size} specials; cost and time checked on every augmentation at intelligence ${int}`)
  }

  const cands = Object.values(g.Augmentations).filter((a) => BB.bladeGraftableOf(a.name, true)).map((a) => BB.bladeGraftSpecOf({ name: a.name, mults: a.mults, baseCost: a.baseCost, prereqs: a.prereqs }, int)).filter(Boolean)
  const money = { wealth: 1e10, moneyPerH: 1e9 }
  const v = BB.bladeGrafts({ s0, candidates: cands, ...money, owned: new Set() })
  {
    const c = add('BGR2', 'THE COMPARISON: the graft verdict is withH - withoutH on the same start, both re-priced')
    const { drain } = await import('coop.js')
    const without = drain(BB.bladeExitMeanGen(s0)).hours
    const withS = { ...s0, grafts: { schedule: v.schedule.map((x) => cands.find((y) => y.name === x.name)), wealth: money.wealth, moneyPerH: money.moneyPerH, entropy: 0, congruity: false, fare: 2 * BB.GRAFT_FARE } }
    const withH = drain(BB.bladeExitMeanGen(withS)).hours
    c.examined(3)
    c.note(`schedule [${v.schedule.map((x) => x.name).join(', ')}]: ${f3(v.withH)}h vs ${f3(v.withoutH)}h (gain ${f3(v.gainH)}h, entropy ${f3(v.entropyH)}h; ${v.priced} prices)`)
    if (!v.graft || !(v.gainH > 0)) c.fail(`no graft on the BN7 fixture with $10b and $1b/h: ${v.why}`)
    if (Math.abs(without - v.withoutH) > 1e-3) c.fail(`withoutH ${v.withoutH} is not the start's own exit ${without}`)
    if (Math.abs(withH - v.withH) > 1e-3) c.fail(`withH ${v.withH} is not the exit re-priced with the schedule ${withH}`)
    if (Math.abs(v.gainH - (without - withH)) > 2e-3) c.fail(`gainH ${v.gainH} is not withoutH - withH (${without - withH})`)
    if (!v.sim?.done?.length) c.fail('the verdict carries no simulated schedule (sim.done): when each graft runs is not published')
  }

  {
    const c = add('BGR3', 'ENTROPY IS PRICED: zero-gain grafts slow the exit against the same grafts without the stacks')
    const nil = (i) => ({ name: `nil${i}`, gains: {}, cost: 1, slotS: 60, prereqs: [] })
    const sched = [0, 1, 2, 3, 4, 5].map(nil)
    const base = { schedule: sched, wealth: 1e12, moneyPerH: 0, entropy: 0, fare: 0 }
    const on = BB.bladeExit({ ...s0, grafts: { ...base, congruity: false } })
    const off = BB.bladeExit({ ...s0, grafts: { ...base, congruity: true } })
    c.examined(2)
    c.note(`six zero-gain grafts: ${f3(on.hours)}h with entropy (x${on.grafts?.entropyFactor}) vs ${f3(off.hours)}h without`)
    if (on.grafts?.entropy !== 6 || Math.abs(on.grafts.entropyFactor - Math.pow(0.98, 6)) > 1e-5) c.fail(`six grafts left ${on.grafts?.entropy} stacks (x${on.grafts?.entropyFactor}), not 6 (x${Math.pow(0.98, 6).toFixed(5)})`)
    if (!(on.hours > off.hours + 0.1)) c.fail(`the entropy of six grafts (x${Math.pow(0.98, 6).toFixed(3)} on every multiplier) does not slow the exit: ${f3(on.hours)}h vs ${f3(off.hours)}h — the nerf is not applied`)
    if (!(v.entropyH !== null && Number.isFinite(v.entropyH))) c.fail('the verdict does not publish what the entropy costs (entropyH)')
  }

  {
    const c = add('BGR4', 'THE SLOT AND THE MONEY: a graft without the Simulacrum stops the actions; a graft waits for its money')
    const long = { name: 'long', gains: {}, cost: 1, slotS: 3 * 3600, prereqs: [] }
    const g0 = { schedule: [long], wealth: 1e12, moneyPerH: 0, congruity: true, fare: 0 }
    const noSim = BB.bladeExit({ ...s0, simulacrum: false })
    const noSimG = BB.bladeExit({ ...s0, simulacrum: false, grafts: g0 })
    const sim = BB.bladeExit({ ...s0 })
    const simG = BB.bladeExit({ ...s0, grafts: g0 })
    c.examined(4)
    c.note(`a 3h zero-gain graft: no Simulacrum +${f3(noSimG.hours - noSim.hours)}h, with it +${f3(simG.hours - sim.hours)}h`)
    if (!(noSimG.hours - noSim.hours > 2)) c.fail(`without the Simulacrum a 3h graft costs only ${f3(noSimG.hours - noSim.hours)}h: the actions did not stop for it`)
    if (!(simG.hours - sim.hours < noSimG.hours - noSim.hours - 1)) c.fail('with the Simulacrum the graft costs as much as without: the actions stopped beside it')
    const pricey = { name: 'pricey', gains: { agility: 1.5 }, cost: 5e9, slotS: 600, prereqs: [] }
    const r = BB.bladeExit({ ...s0, grafts: { schedule: [pricey], wealth: 1e9, moneyPerH: 2e9, congruity: true, fare: 0 } })
    const startH = r.grafts?.done?.[0]?.startH
    c.examined(1)
    if (!(Math.abs(startH - 2) < 0.1)) c.fail(`a $5b graft on $1b + $2b/h started at ${startH}h, not when the money arrives (2h)`)
    const never = BB.bladeExit({ ...s0, grafts: { schedule: [pricey], wealth: 0, moneyPerH: 0, congruity: true, fare: 0 } })
    if (never.grafts?.done?.length || !never.grafts?.notStarted?.includes('pricey')) c.fail('an unaffordable graft started')
  }

  {
    const c = add('BGR5', 'WIRING: the route decision prices and publishes the schedule; the graft step orders it; the gates hold')
    const prog = SRC('progress.js')
    const act = SRC('act.js')
    const guards = [
      [/grafts = yield\* bladeRouteGraftsGen\(\{/, 'bladeRouteOf prices the graft schedule (bladeRouteGraftsGen) on the committed blade route'],
      [/const v = yield\* bladeGraftsGen\(\{ s0, candidates: cands, wealth, moneyPerH, entropy,/, 'bladeRouteGraftsGen prices through bbplan.bladeGraftsGen with the money, the entropy held and the route start'],
      [/allow: inFaction \? BLADE_GRAFT_SPECIAL : null/, "the Bladeburners' specials are candidates once a member"],
      [/simulacrum,\s*grafts,\s*hashExchange,/, 'decisions.bladeRoute publishes grafts'],
      [/const v = bladeRoute\?\.grafts\s/, 'the graft step reads the route decision\'s schedule'],
      [/order\('graft', \[bladeGraft\.name, true\], [^)]*\), bladeGraft\.cost\)/, 'the blade graft is ordered through act-graft with its cost raised'],
      [/if \(bladeOn && bladeGraftFirst && canWork && !flags\.dry\) \{\s*workedFaction = null\s*slotOwner = 'graft'/, 'the due graft claims the slot on the Bladeburner route'],
      [/cityAfterOrders !== GRAFT_CITY && !order\('travel', \[GRAFT_CITY\][^\n]*blade graft/, 'the flight to New Tokyo before the blade graft'],
      [/bladeGraft: bladeGraftRec \}/, 'progress.txt publishes bladeGraft (the health check reads it)'],
    ]
    for (const [re, what] of guards) {
      c.examined(1)
      if (!re.test(prog)) c.fail(`progress.js: ${what} — not found`)
    }
    c.examined(1)
    if (!/if \(kind === 'buyaug' \|\| kind === 'graft' \|\| kind === 'install'\) \{\s*const ri = ns\.getResetInfo\(\)\s*const gate = giftOrderGate/.test(act)) c.fail("act.js runActor: the Stanek gift gate no longer covers 'graft'")
    c.examined(1)
    if (!/o\.kind === 'buyaug' \|\| o\.kind === 'graft' \|\| o\.kind === 'install'\) \{\s*const ri = ns\.getResetInfo\(\)\s*const gate = giftOrderGate/.test(act)) c.fail("act.js order loop: the Stanek gift gate no longer covers 'graft'")
  }

  {
    const c = add('BGR6', 'HEALTH: BLADE GRAFT NOT STARTED on a due graft past the budget; quiet while one runs')
    const { bladeGraftHealthOf, BLADE_GRAFT_LATE_MIN } = await import('../bbhealth.mjs')
    const now = Date.parse('2026-10-23T03:00:00Z')
    const pr = (over) => ({ at: '2026-10-23T02:59:00Z', bladeGraft: { node: 11, due: 'Bionic Legs', dueSince: new Date(now - (BLADE_GRAFT_LATE_MIN + 5) * 60e3).toISOString(), running: null, schedule: ['Bionic Legs'], ...over } })
    const st = { bitNode: 11, currentWork: { type: 'ClassWork' } }
    c.examined(4)
    if (!bladeGraftHealthOf({ pr: pr({}), state: st, nowMs: now }).length) c.fail('a graft due 25 min and unstarted does not fail')
    if (bladeGraftHealthOf({ pr: pr({ running: 'Bionic Legs' }), state: st, nowMs: now }).length) c.fail('fails while the graft runs')
    if (bladeGraftHealthOf({ pr: pr({}), state: { ...st, currentWork: { type: 'GraftingWork' } }, nowMs: now }).length) c.fail('fails while the save shows GraftingWork')
    if (bladeGraftHealthOf({ pr: pr({ dueSince: new Date(now - 5 * 60e3).toISOString() }), state: st, nowMs: now }).length) c.fail('fails 5 min after it became due')
    if (!/bladeGraftHealthOf\(\{ pr, state, nowMs \}\)/.test(SRC('tools/bbhealth.mjs'))) c.fail('bladeburnerHealth does not run bladeGraftHealthOf')
  }

  {
    const c = add('BGR7', "bbsim (the game's classes): a scheduled graft runs on the game's time, spends its cost, stacks calculateEntropy")
    if (QUICK) c.skip(1, 'one bbsim run (~5s)')
    else {
      const { runBladeburner } = await import('../sim/nodechoice/bbsim.mjs')
      const { specOfArm } = await import('../sim/bblevers.mjs')
      const spec = specOfArm({ node: 11, l6: 3, l7: 3, l13: 1, sf14: 3, seed: 1, arm: { fleet: { infiltrate: 1, support: 5, fa: 0 } } })
      const names = ['Bionic Legs', 'Bionic Spine']
      const ints = []
      const r = runBladeburner({ ...spec, maxH: 4, grafts: { schedule: names, wealth: 1e12, moneyPerH: 0 }, onStep: ({ t, P }) => ints.push([t, P.skills.intelligence]) })
      const ga = names.map((n) => new g.GraftableAugmentation(g.Augmentations[n]))
      c.examined(3)
      c.note(`bbsim grafts ${JSON.stringify(r.grafts?.done)} spent $${r.grafts?.spent}, ${r.grafts?.entropy} stacks`)
      if ((r.grafts?.done?.length ?? 0) !== 2) c.fail(`bbsim ran ${r.grafts?.done?.length ?? 0} of 2 scheduled grafts in 4h`)
      else {
        const d0 = r.grafts.done[0]
        // at the PLAYER's intelligence level when it starts (graftingIntBonus reads Player.skills.intelligence;
        // bbsim's level is 0 until the first intelligence exp — it sets exp.intelligence without the level)
        const pInt = (ints.find(([t]) => t >= d0.startH * 3600 - 1) ?? [0, 0])[1]
        const want = ga[0].time / (1 + Math.pow(pInt, 0.8) / 600) / 3.6e6
        if (Math.abs(d0.endH - d0.startH - want) > 0.01) c.fail(`the first graft took ${f3(d0.endH - d0.startH)}h, the game's ${f3(want)}h`)
        if (r.grafts.entropy !== 2) c.fail(`${r.grafts.entropy} entropy stacks after two grafts`)
        const spent = ga[0].cost + ga[1].cost + 4 * g.CONSTANTS.TravelCost
        if (Math.abs(r.grafts.spent - spent) > 1) c.fail(`spent $${r.grafts.spent}, the game's prices + fares $${spent}`)
      }
    }
  }
  return checks
}
