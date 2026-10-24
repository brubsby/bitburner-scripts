// THE WORK SLOT LENT AFTER THE BLADEBURNER JOIN (backlog 0e; bbplan.bladeLendGen, bladeExitGen
// s0.slotLend, progress.js bladeRouteLendGen + bladeGymStep). bbsim (tools/sim/bbboot.mjs) measured
// the 29% post-join lend of BN13.3 at +0.19h BN5.2, +0.63h BN13.3 (-0.03h BN2.2): it is not free.
// With The Blade's Simulacrum the action runs beside the slot, so a lend displaces the CLASS beside
// the actions (a due graft goes first in both arms); its money reaches the exit only through the
// graft schedule.
//
//   BL1  THE COMPARISON: the verdict is withH - withoutH, each arm re-priced independently from the
//        same start (the Q members' mean); paired members carry the noise (lent only past 2 se).
//   BL2  WHAT IT DISPLACES: a lend with no exp of its own slows the exit against the class; share 0
//        is the class exactly; the crime's exp trains every combat stat.
//   BL3  THE MONEY: a graft the money gates is reached sooner with the crime's money — the lend
//        wins there, and not without the money (the class's fee comes out of the same money).
//   BL4  NOT FREE ANYWHERE: no Simulacrum, no start, no crime, an unpriced arm: never lent.
//   BL5  WIRING: progress.js prices the lend inside the route decision (one start, the graft
//        schedule's money), publishes decisions.bladeRoute.lend, and past the bar the Simulacrum's
//        class keeps the slot unless that verdict lends — the combat-bar plan's crime no longer does.

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const NM = await import('bitNodeMultipliers.js')
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn7-sleevecontracts.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x))

// The BN7.3 fixture (live 2026-10-10, 13.9h into the life) with its posterior spread, so the Q
// members differ. Its person carries no hacking/crime multipliers: 1 (stated), for the crime's rates.
const startOf = (over = {}) => BB.bladeStartOf({ tel: FX.tel, person: FX.person, sleeves: { infiltrate: 1, support: 4, fa: 0 }, sleeveBodies: FX.sleeveBodies, gymExpPerSec: FX.start.gymExpPerSec, bnRank: FX.start.bnRank, skillCostMult: FX.start.skillCostMult, simulacrum: true, maxH: 80, rankScale: FX.start.rankScale, rankSdLn: FX.start.rankSdLn, successSdLn: FX.start.successSdLn, now: Date.parse(FX.tel.at), ...over })
const person = { ...FX.person, exp: { hacking: 0, ...FX.person.exp }, mults: { hacking: 1, hacking_exp: 1, crime_money: 1, crime_success: 1, ...FX.person.mults } }

export async function run() {
  const checks = []
  const add = (id, title) => {
    const c = new Check(id, title)
    checks.push(c)
    return c
  }
  const s0 = startOf()
  const money = BP.bestCrimeFor('money', person, NM.bitNodeMults(7), { focus: 1 })
  const crime = money ? { name: money.crime, moneyPerSec: money.rates.money, expPerSec: money.rates.exp } : null
  const FEE = 2400

  {
    const c = add('BL1', 'THE COMPARISON: withH - withoutH, both arms re-priced from one start; the paired members decide')
    c.examined(4)
    if (!crime) c.fail('no money crime prices on the fixture person')
    else {
      const v = BB.bladeLend({ s0, crime, gymFeePerSec: FEE })
      const drain = (g) => {
        let r = g.next()
        while (!r.done) r = g.next()
        return r.value
      }
      const a = drain(BB.bladeExitMeanGen(s0, { Q: BB.BLADE_ENSEMBLE.Q }))
      const b = drain(BB.bladeExitMeanGen({ ...s0, slotLend: { crime: crime.name, expPerSec: crime.expPerSec, frac: 1 } }, { Q: BB.BLADE_ENSEMBLE.Q }))
      c.note(`BN7.3 fixture, ${crime.name} ($${Math.round(crime.moneyPerSec)}/s) for the whole slot: ${v.why}`)
      if (Math.abs(v.withoutH - a.hours) > 1e-3 || Math.abs(v.withH - b.hours) > 1e-3) c.fail(`the verdict's arms (${v.withH} / ${v.withoutH}) are not the exits re-priced (${f3(b.hours)} / ${f3(a.hours)})`)
      if (Math.abs(v.deltaH - (v.withH - v.withoutH)) > 2e-3) c.fail(`deltaH ${v.deltaH} is not withH - withoutH`)
      if (!(v.seH > 0)) c.fail(`no paired spread published (seH ${v.seH}): the members are the noise the decision must clear`)
      if (v.lend !== (v.deltaH <= -BB.BLADE_LEND.minGainH && v.deltaH + 2 * v.seH < 0)) c.fail(`lend ${v.lend} is not the rule on its own numbers (d ${v.deltaH}, se ${v.seH})`)
      if (v.lend) c.fail(`the whole slot lent to ${crime.name} must not win on the BN7.3 fixture (no graft schedule: the money has no use): ${v.why}`)
      const v29 = BB.bladeLend({ s0, crime, gymFeePerSec: FEE, frac: 0.29 })
      c.note(`the 29% lend (bbsim's measured share): ${v29.why}`)
    }
    // The rule itself, on member differences (lent - class, h).
    const R = BB.bladeLendRuleOf
    const rules = [
      [-0.1, [-0.1, -0.12, -0.08, -0.1, -0.11, -0.09], true, 'a clear paired gain lends'],
      [0.03, [0.03, 0.02, 0.04, 0.03, 0.03, 0.03], false, 'a paired loss never lends'],
      [-0.01, [-0.01, -0.01, -0.01, -0.01, -0.01, -0.01], false, 'a gain under minGainH (0.02h) does not lend'],
      [-0.04, [-0.3, 0.2, -0.25, 0.15, -0.2, 0.16], false, 'a mean gain inside two paired standard errors does not lend'],
      [-0.05, [-0.05], true, 'one member: the gain alone'],
      [-0.05, [], false, 'no paired member: not lent'],
    ]
    c.examined(rules.length)
    for (const [d, ds, want, what] of rules) if (R(d, ds).lend !== want) c.fail(`bladeLendRuleOf: ${what} (d ${d}, ${JSON.stringify(ds)} -> ${R(d, ds).lend})`)
  }

  {
    const c = add('BL2', 'WHAT IT DISPLACES: the class beside the actions — a lend with no exp of its own is slower, share 0 is the class, the crime trains every combat stat')
    c.examined(3)
    const cls = BB.bladeExit(s0)
    const idle = BB.bladeExit({ ...s0, slotLend: { crime: 'nothing', expPerSec: {}, frac: 1 } })
    const zero = BB.bladeExit({ ...s0, slotLend: { crime: 'x', expPerSec: crime?.expPerSec ?? {}, frac: 0 } })
    c.note(`the class ${f3(cls.hours)}h, the slot lent to nothing ${f3(idle.hours)}h, share 0 ${f3(zero.hours)}h`)
    if (!(idle.hours > cls.hours + 0.05)) c.fail(`the slot lent to work with no exp (${f3(idle.hours)}h) is not slower than the class (${f3(cls.hours)}h): the lend does not displace the class`)
    if (Math.abs(zero.hours - cls.hours) > 1e-9) c.fail(`share 0 (${f3(zero.hours)}h) is not the class (${f3(cls.hours)}h)`)
    // x1000 the crime's rates so one hour moves every level (610 is ~183k exp each)
    const big = Object.fromEntries(Object.entries(crime?.expPerSec ?? {}).map(([k, x]) => [k, x * 1000]))
    const lent = BB.bladeExit({ ...s0, slotLend: { crime: crime?.name, expPerSec: big, frac: 1 }, maxH: 1 })
    const base = BB.bladeExit({ ...s0, slotLend: { crime: 'nothing', expPerSec: {}, frac: 1 }, maxH: 1 })
    if (!['strength', 'defense', 'dexterity', 'agility'].every((k) => lent.stats[k] >= base.stats[k]) || !['strength', 'defense', 'dexterity', 'agility'].some((k) => lent.stats[k] > base.stats[k])) c.fail(`the crime's exp did not train the combat stats: ${JSON.stringify(lent.stats)} vs ${JSON.stringify(base.stats)}`)
  }

  {
    const c = add('BL3', "THE MONEY: a money-gated graft comes sooner on the crime's money — the lend wins there and not without it")
    c.examined(2)
    // A strong graft the schedule's money cannot reach for ~6h on its own; the crime's money brings it in ~1h.
    const strong = { name: 'strong', gains: { agility: 1.6, dexterity: 1.6, bladeburner_success_chance: 1.5 }, cost: 6e9, slotS: 600, prereqs: [] }
    const g = { schedule: [strong], wealth: 0, moneyPerH: 1e9, congruity: true, fare: 0 }
    const rich = { name: 'Heist', moneyPerSec: 5e9 / 3600, expPerSec: crime?.expPerSec ?? {} }
    const v = BB.bladeLend({ s0: { ...s0, grafts: g }, crime: rich, gymFeePerSec: FEE })
    const poor = BB.bladeLend({ s0: { ...s0, grafts: g }, crime: { ...rich, moneyPerSec: 0 }, gymFeePerSec: FEE })
    c.note(`a $6b graft on $1b/h: lent to a $5b/h crime ${v.why}; the same crime earning nothing: ${poor.why}`)
    if (!v.lend) c.fail(`the crime's money reaches a strong graft ~5h sooner and the lend did not win: ${v.why}`)
    if (poor.lend) c.fail(`with no money the lend won anyway: ${poor.why}`)
  }

  {
    const c = add('BL4', 'NOT FREE ANYWHERE: no Simulacrum, no start, no crime, an unpriced arm — never lent, and said why')
    c.examined(4)
    const noSim = BB.bladeLend({ s0: { ...s0, simulacrum: false }, crime, gymFeePerSec: FEE })
    if (noSim.lend || !/Simulacrum/.test(noSim.why)) c.fail(`without the Simulacrum the lend stops the action: ${JSON.stringify(noSim)}`)
    const none = BB.bladeLend({ s0: null, crime })
    if (none.lend || !none.why) c.fail('no start: must not lend')
    const noCrime = BB.bladeLend({ s0, crime: null })
    if (noCrime.lend || !noCrime.why) c.fail('no crime: must not lend')
    const unpriced = BB.bladeLend({ s0: { ...s0, maxH: 0.01 }, crime, gymFeePerSec: FEE })
    if (unpriced.lend || unpriced.deltaH !== null || !/unpriced/.test(unpriced.why)) c.fail(`an unpriced exit must not lend: ${JSON.stringify(unpriced)}`)
  }

  {
    const c = add('BL5', "WIRING: the route decision prices the lend on its start and the graft schedule's money; past the bar the class keeps the slot unless the verdict lends")
    const P = SRC('progress.js')
    const want = [
      [/lend = yield\* bladeRouteLendGen\(\{ info, pc, person, s0: startFor\(bladeBasis\), grafts, gym, wealth, moneyPerH: \(moneyPerSec \?\? 0\) \* 3600/, 'bladeRouteOf prices the lend on the route start (startFor(bladeBasis)) with the graft schedule and its money'],
      [/hashExchange,\n\s*lend,/, 'decisions.bladeRoute publishes lend'],
      [/const v = yield\* bladeLendGen\(\{ s0: s, crime, gymFeePerSec: fee \}\)/, 'bladeRouteLendGen prices bladeLendGen on the start + the schedule still to graft, the class fee charged'],
      [/if \(postBar\) \{\s*const lv = bladeRoute\?\.lend \?\? null\s*if \(lv\?\.lend === true && lv\.crime && lv\.lastAugReset === info\?\.lastAugReset\) return \{ kind: 'crime'/, 'past the bar the crime is ordered only on a lending verdict of this life'],
      [/lendPriced: true \}\s*\}/, "past the bar otherwise the class (lendPriced: the combat-bar plan does not re-decide it)"],
      [/st\.priced \|\| st\.lendPriced\) return st/, 'the body step leaves a lend-priced class to the lend verdict'],
    ]
    c.examined(want.length)
    for (const [re, what] of want) if (!re.test(P)) c.fail(`progress.js: ${what}`)
    // The combat-bar plan (the crime as free) must come AFTER the post-bar return.
    const i = P.indexOf('if (postBar) {')
    const j = P.indexOf("if (plan?.now?.kind === 'crime') return { kind: 'crime', type: plan.now.crime, hours: plan.hours[plan.best], forFaction: 'Bladeburners'")
    if (!(i > 0 && j > i)) c.fail("bladeGymStep: the combat-bar plan's crime is reachable past the bar again (the lend priced as free)")
  }
  return checks
}
