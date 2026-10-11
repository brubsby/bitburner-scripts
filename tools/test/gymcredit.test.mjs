// [GC] THE GYM LEG'S DEBT IS PRICED, NOT GATED — and a stop never idles the slot.
//
// Live BN12 2026-10-09 01:45Z (cash $245k -> -$62k) and BN13 2026-10-11
// 02:56Z (cash -$26,178 two minutes after act.js ran the gym order at
// 02:54:21Z): right after an install progress.js ordered the schedule's gym
// leg on a 120s fee floor alone (no income, no duration), the class billed
// past zero, act.js's negative-cash escape stopped it on the SIGN alone, and
// the claimed 'body' slot sat idle (healthcheck ORDER NOT HELD).
//
// The game (pinned below from its source): a class bills every second with no
// balance check, a negative balance blocks only purchases and travel
// (Player.canAfford) and charges no interest. So the debt is a price, not a
// wall: bodyplan.combatBarPlanOf scores the gym on cash, the gym on credit
// and the money crime on hours to the bar plus the hours the flat income
// needs to repay the debt; progress.js acts on that for EVERY gym leg and
// publishes the priced floor (slot.credit); nodeecon.softlockStep stops a
// class only past that floor, when nothing earns, or on an unpriced debt that
// grows; and a stop re-assigns the slot in the same act.js loop.
//
//   GC1 the plan on the live shape (fresh life, cash $0-$500k, the Powerhouse
//       fee from the game source): income $10k/s trains now; a debt is taken
//       only where the income repays it, never with no income.
//   GC2 the escape: a priced debt runs on, past its floor it stops, an
//       unpriced debt stops only when it grows, no reset under a priced class.
//   GC3 the re-issue after a stop: the gym on credit above the floor, the
//       money crime past it.
//   GC4 wiring: progress.js prices every gym leg and publishes the credit;
//       act.js passes it to the escape and re-assigns the slot after a stop.

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'
import { GAME } from './build-ram.mjs'

const BP = await import('bodyplan.js')
const NE = await import('nodeecon.js')
const AP = await import('actplan.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

/** The BN13 02:34Z install's fresh life: hacking 13, combat 1, multipliers 1. */
function freshLife(cash) {
  const skills = { hacking: 13, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 0 }
  const exp = { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 }
  const mults = { crime_success: 1, crime_money: 1 }
  for (const s of Object.keys(exp)) {
    mults[s] = 1
    mults[`${s}_exp`] = 1
  }
  return { skills, exp, mults, city: 'Sector-12', money: cash }
}
const NODE = { CrimeSuccessRate: 1, CrimeMoney: 1, CrimeExpGain: 1 }

export async function run() {
  const checks = []

  // ---- GC1 ------------------------------------------------------------------
  const c1 = new Check('GC1', 'the gym leg on the live fresh-life shape is priced on cash, credit and income — not gated on a 120s fee floor')
  checks.push(c1)
  {
    // The fee from the game source: ClassWork.tsx gym -120/s x Powerhouse costMult 20.
    const cw = fs.readFileSync(path.join(GAME, 'src/Work/ClassWork.tsx'), 'utf8')
    const lm = fs.readFileSync(path.join(GAME, 'src/Locations/data/LocationsMetadata.ts'), 'utf8')
    const base = Number(/\[GymType\.strength\][\s\S]*?money: -(\d+)/.exec(cw)?.[1])
    const ph = Number(/costMult: (\d+),\s*expMult: \d+,\s*name: LocationName\.Sector12PowerhouseGym/.exec(lm)?.[1])
    const fee = base * ph
    c1.examined(2)
    if (!(base === BP.GYM_BASE_COST && BP.GYMS.find((g) => g.name === 'Powerhouse Gym')?.costMult === ph)) c1.fail('the gym fee must match the game source', `${base} x ${ph}`)
    // canAfford: the only thing a negative balance refuses.
    const pm = fs.readFileSync(path.join(GAME, 'src/PersonObjects/Player/PlayerObjectGeneralMethods.ts'), 'utf8')
    if (!/canAfford[\s\S]{0,200}return this\.money >= cost/.test(pm)) c1.fail('Player.canAfford must still be the money >= cost check the pricing assumes')
    const plan = (cash, inc) => BP.combatBarPlanOf({ strength: 100 }, freshLife(cash), NODE, { cash, incomePerSec: inc, holdS: 300 })
    for (const cash of [0, 100e3, 245e3, 500e3]) {
      const p = plan(cash, 10e3)
      c1.examined(1)
      c1.note(`$${cash}, $10k/s: ${p.best} first ${JSON.stringify(p.now)} — ${p.why.slice(0, 200)}`)
      // $10k/s pays the $2,400/s fee: the gym now, whatever the balance (the
      // old 120s floor ordered the crime under $288k).
      if (p.now?.kind !== 'gym') c1.fail(`$${cash} cash, $10k/s income: the Powerhouse leg ($${fee}/s) trains now`, JSON.stringify(p.now))
      if (p.credit) c1.fail(`$${cash}, $10k/s: the income outruns the fee — no debt`, JSON.stringify(p.credit))
    }
    // Income under the fee: a debt only where the income repays it in time.
    const thin = plan(245e3, 2000)
    const none = plan(245e3, 0)
    const neg = plan(-26178, 500)
    c1.examined(3)
    c1.note(`$245k, $2k/s: ${thin.best} ${JSON.stringify(thin.now)} credit ${JSON.stringify(thin.credit)}`)
    c1.note(`$245k, $0/s: ${none.best} ${JSON.stringify(none.now)} — ${none.why.slice(0, 220)}`)
    c1.note(`-$26k, $500/s: ${neg.best} ${JSON.stringify(neg.now)} — ${neg.why.slice(0, 220)}`)
    if (!(thin.hours.credit < thin.hours.mixed)) c1.fail('the credit trajectory must be priced (and faster to the bar than the cash-gated mix)', JSON.stringify(thin.hours))
    if (none.hours.credit !== Infinity && !(none.credit === null)) c1.fail('with no income a debt is never repaid: no credit', JSON.stringify(none.credit))
    if (none.best === 'credit') c1.fail('with no income the plan never runs the balance negative', none.why)
    if (neg.now?.kind !== 'crime') c1.fail('already in debt with $500/s against $2,400/s: the money crime, not more debt', JSON.stringify(neg.now))
    for (const p of [thin, none, neg]) if (p.credit && !(p.credit.floor < 0 && p.credit.feePerSec === fee)) c1.fail('a published credit carries its floor and the fee', JSON.stringify(p.credit))
  }

  // ---- GC2 ------------------------------------------------------------------
  const c2 = new Check('GC2', "the escape stops a class past its priced floor, on nothing earning, or on a growing unpriced debt — never on the sign alone")
  checks.push(c2)
  {
    const NOW = Date.parse('2026-10-11T02:56:00Z')
    const iso = (ms) => new Date(ms).toISOString()
    const noBook = NE.stockRecordOf({ at: iso(NOW), lastAugReset: 7, equity: 0 }, 7, NOW)
    const gym = { type: 'CLASS', classType: 'str', location: 'Powerhouse Gym' }
    const credit = { floor: -300e3, feePerSec: 2400, debtH: 0.2 }
    const base = { cash: -26178, stock: noBook, work: gym, workAt: NOW - 10e3, startedAt: NOW - 95e3, hackPays: 0.2, queued: 0, now: NOW }
    const kinds = (s) => s.actions.map((a) => a.kind).join(',')
    const live = NE.softlockStep({ ...base, credit })
    const first = NE.softlockStep({ ...base })
    const growing = NE.softlockStep({ ...base, trend: [{ at: iso(NOW - 150e3), cash: -1000 }], startedAt: NOW - 200e3 })
    const repaying = NE.softlockStep({ ...base, trend: [{ at: iso(NOW - 150e3), cash: -60e3 }], startedAt: NOW - 200e3 })
    const past = NE.softlockStep({ ...base, cash: -700e3, credit })
    // The fee's whole $2,400/s shows in the balance: nothing else earns.
    const dead = NE.softlockStep({ ...base, cash: -400e3, credit, trend: [{ at: iso(NOW - 150e3), cash: -400e3 + 2400 * 150 }], startedAt: NOW - 200e3 })
    const capital = NE.softlockStep({ ...base, hackPays: 0, credit, samples: [{ at: iso(NOW - 150e3), cash: -20e3, wealth: -20e3 }] })
    c2.examined(7)
    c2.note(`02:56Z, priced floor -$300k: ${kinds(live) || 'none'} — ${live.why.slice(0, 200)}`)
    c2.note(`02:56Z, no credit, first sample: ${kinds(first) || 'none'} — ${first.why.slice(0, 160)}`)
    if (live.actions.some((a) => a.kind === 'stop')) c2.fail('the live 02:56Z state: a debt above the priced floor runs on', JSON.stringify(live))
    if (first.actions.some((a) => a.kind === 'stop')) c2.fail('a negative balance alone (no trend yet) stops nothing', JSON.stringify(first))
    if (!(first.trend?.length === 1 && first.trend[0].cash === -26178)) c2.fail('the first negative sample is carried', JSON.stringify(first.trend))
    if (kinds(growing) !== 'stop') c2.fail('an unpriced debt that grows over the gap is stopped', JSON.stringify(growing))
    if (repaying.actions.length) c2.fail('an unpriced debt the income repays runs on', JSON.stringify(repaying))
    if (kinds(past) !== 'stop') c2.fail('past the priced floor (less 120s of the fee) it stops', JSON.stringify(past))
    if (kinds(dead) !== 'stop') c2.fail('nothing earning (slope + fee <= 0) stops even a priced debt', JSON.stringify(dead))
    if (capital.actions.some((a) => a.kind === 'install' || a.kind === 'softreset')) c2.fail('a priced class debt in a capital node is no softlock: no reset while it runs', JSON.stringify(capital))
  }

  // ---- GC3 ------------------------------------------------------------------
  const c3 = new Check('GC3', 'after a stop the claimed slot is re-assigned: the gym on credit above its floor, the money crime past it')
  checks.push(c3)
  {
    const NOW = Date.parse('2026-10-11T02:57:00Z')
    const iso = (ms) => new Date(ms).toISOString()
    const credit = { floor: -300e3, feePerSec: 2400, gym: 'Powerhouse Gym', stat: 'strength', lastAugReset: 7, at: iso(NOW - 180e3) }
    const progress = { at: iso(NOW - 180e3), health: 'ok', slot: { owner: 'body', credit } }
    const s = { now: NOW, lastAugReset: 7, progress, lastWork: { kind: 'gym', args: ['Powerhouse Gym', 'str'], at: '2026-10-11T02:54:21Z', batchAt: '2026-10-11T02:54:10Z' }, batchAt: '2026-10-11T02:54:10Z', batchWork: true, work: null, workAt: iso(NOW), city: 'Sector-12', gymCostMult: (n) => BP.GYMS.find((g) => g.name === n)?.costMult ?? null, gymCityOf: (n) => BP.GYMS.find((g) => g.name === n)?.city ?? null, reissued: { n: 0, at: 0 }, fundCrime: 'Rob Store' }
    const above = AP.reissueWorkOf({ ...s, cash: -26178 })
    const past = AP.reissueWorkOf({ ...s, cash: -700e3 })
    const unpriced = AP.reissueWorkOf({ ...s, cash: -26178, progress: { ...progress, slot: { owner: 'body' } } })
    const otherLife = AP.reissueWorkOf({ ...s, cash: -26178, lastAugReset: 8 })
    c3.examined(4)
    c3.note(`-$26k on a -$300k floor: ${JSON.stringify(above).slice(0, 140)}`)
    c3.note(`-$700k: ${JSON.stringify(past).slice(0, 140)}`)
    if (above?.kind !== 'gym') c3.fail('above the priced floor the gym re-issues', JSON.stringify(above))
    if (past?.kind !== 'crime') c3.fail('past the floor the money crime takes the slot (not idle)', JSON.stringify(past))
    if (unpriced?.kind !== 'crime') c3.fail('no priced credit: the money crime takes the slot (not idle)', JSON.stringify(unpriced))
    if (otherLife?.kind !== 'crime') c3.fail("another life's credit prices nothing", JSON.stringify(otherLife))
    if (typeof AP.bodyCreditOf !== 'function' || AP.bodyCreditOf(progress, 7, NOW + 60 * 60e3) !== null) c3.fail('a stale credit prices nothing')
  }

  // ---- GC4 ------------------------------------------------------------------
  const c4 = new Check('GC4', 'WIRING: every gym leg priced, its credit published, the escape reads it, a stop re-assigns in the same loop')
  checks.push(c4)
  {
    const pj = SRC('progress.js')
    const aj = SRC('act.js')
    c4.examined(5)
    if (!/const bodyStep = \(\(\) => \{\s*const st = bodyStepRaw\s*if \(!st \|\| st\.kind !== 'gym' \|\| st\.priced\) return st[\s\S]{0,400}combatBarPlanOf\(/.test(pj)) c4.fail('progress.js must price every unpriced gym leg with combatBarPlanOf')
    if (!/if \(!bodyStep\.priced && !already && !feeFundable\(/.test(pj)) c4.fail('the 120s fee floor must gate only an unpriced gym leg')
    if (!/credit: slotOwner === 'body' \? bodyCredit : null/.test(pj)) c4.fail('progress.txt slot.credit must carry the priced debt')
    if (!/credit: bodyCreditOf\(readJson\(ns, '\/tel\/progress\.txt'\), info\.lastAugReset, now\)/.test(aj) || !/trend: raiseState\.softTrend/.test(aj)) c4.fail('act.js must give the escape the credit and the trend')
    if (!/work: softlock\.stopped \? null/.test(aj)) c4.fail('a stop must re-assign the slot in the same loop')
  }
  return checks
}
