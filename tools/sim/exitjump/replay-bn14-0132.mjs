// Replay of the BN14.1 install (2026-10-04 01:32:10Z): the black-op exit of
// the install actor's 'now' (the pre-install person, the 3-NFG batch at t=0)
// against the new life's own price, input group by input group, and the
// install options on the corrected inputs (the BN14 recommendation).
// Usage: node replay-bn14-0132.mjs  (FIX=tools/test/fixture-bn14-install-0132.json)
//
// CALIBRATION: the new life's 01:52Z price is reproduced (live 126.85h,
// sleeves 0/0/0, success k 1, rank k 0.7133 -> 125.7h here). The install
// actor's 81.97h / never 84.1h is NOT reproducible from what survived: its
// division record (and the success calibration it carried) was overwritten
// after the install. On the current division the actor's never (84.1h) is
// matched at success k ~2.0 (never 83.9h) — the calibration the old life
// had measured and the new life lost.
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const FIX = process.env.FIX ?? new URL('../../test/fixture-bn14-install-0132.json', import.meta.url).pathname
const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'))
const nm = bitNodeMults(14)
const lv = (m) => ({ ...m, strength: m.strength * nm.StrengthLevelMultiplier, defense: m.defense * nm.DefenseLevelMultiplier, dexterity: m.dexterity * nm.DexterityLevelMultiplier, agility: m.agility * nm.AgilityLevelMultiplier, charisma: m.charisma * nm.CharismaLevelMultiplier })
const g = fx.nfg3
const pre = Object.fromEntries(Object.entries(fx.mults).map(([k, v]) => [k, v / (g[k] ?? 1)]))
const personPre = { skills: fx.person0129.skills, exp: fx.person0129.exp, mults: lv(pre) }
const personPost = { skills: fx.person0152.skills, exp: fx.person0152.exp, mults: lv(fx.mults) }
const gym = (p) => 10 * p.mults.strength_exp
const S = { i0s0f0: { infiltrate: 0, support: 0, fa: 0 }, i1s4f0: { infiltrate: 1, support: 4, fa: 0 } }
const money = (city, cash) => BP.retrainSecsOfFor({ node: nm, flatPerSec: fx.flatPerSec ?? 0, holdS: 300, start: { cash, city }, install: { cash: 1262, city: 'Sector-12' } })
const run = (label, o) => {
  const s0 = BB.bladeStartOf({ tel: o.tel ?? fx.tel, person: o.person, sleeves: o.sleeves, gymExpPerSec: o.gym ?? gym(o.person), bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: o.install ?? null, rankScale: o.rankScale ?? fx.rankScale, successScale: o.successScale ?? 1, retrainSecsOf: o.retrain ?? null, policy: BB.POLICY_V1 ?? null, now: Date.parse(o.now ?? fx.tel.at) }) // the live run played POLICY_V1
  if (Number.isFinite(o.sks)) s0.skillSinceS = o.sks
  const r = BB.bladeExit(s0)
  console.log(label.padEnd(78), 'hours', r.hours?.toFixed(2), 'joinH', r.joinH?.toFixed?.(2), r.retrainWhy ?? '')
  return r.hours
}
const nowSpec = { firstH: 0, gains: g }
console.log("== the install actor's now (pre-install person, batch at t=0), on the division as it survived")
run('now: sleeves 1/4/0, success k 1', { person: personPre, sleeves: S.i1s4f0, install: nowSpec })
run('never: sleeves 1/4/0, success k 1', { person: personPre, sleeves: S.i1s4f0 })
run('now: sleeves 1/4/0, success k 2.0 (the lost calibration, inverted from never)', { person: personPre, sleeves: S.i1s4f0, install: nowSpec, successScale: 2.0 })
run('never: sleeves 1/4/0, success k 2.0', { person: personPre, sleeves: S.i1s4f0, successScale: 2.0 })
console.log('== the new life (post-install person 01:52Z)')
run('new life: sleeves 0/0/0 (as the plan priced it, fleet "none")', { person: personPost, sleeves: S.i0s0f0 })
run('new life: sleeves 1/4/0 (as the sleeves ran from 01:52Z)', { person: personPost, sleeves: S.i1s4f0 })
run('new life: sleeves 1/4/0, success k 2.0', { person: personPost, sleeves: S.i1s4f0, successScale: 2.0 })
console.log('== the division unread (the 01:32-01:40Z refusal record) and the rank scale')
run('no division record (priced as never joined), sleeves 0/0/0', { tel: { bitNode: 14, joined: false }, person: personPost, sleeves: S.i0s0f0 })
run('no division record, rank k 0.5', { tel: { bitNode: 14, joined: false }, person: personPost, sleeves: S.i0s0f0, rankScale: 0.5 })
console.log('== the retrain priced on money and travel (retrainSecsOf), the actor\'s now')
run('now, success 2.0, money-aware retrain ($1262 in Sector-12)', { person: personPre, sleeves: S.i1s4f0, install: nowSpec, successScale: 2.0, retrain: money('Ishima', fx.person0129.money) })
console.log('== THE MODEL\'S SCATTER: never at the daemon\'s skill clock positions (no input changes)')
for (const sks of [0, 900, 1800, 2700, 3500]) run(`never, skill clock ${sks}s, sleeves 1/4/0`, { person: personPost, sleeves: S.i1s4f0, sks })
console.log('== BN14 INSTALLS on the corrected inputs (new life 01:52Z, fleet 1/4/0, money-aware retrain)')
const r = money('Sector-12', 1e6)
const never = run('never', { person: personPost, sleeves: S.i1s4f0, retrain: r })
for (const [n, at] of [[3, 0], [6, 12], [10, 24], [14, 48]]) {
  const gn = Object.fromEntries(Object.keys(g).map((k) => [k, Math.pow(1.010101, n)]))
  const h = run(`install ${n} NFG at ${at}h`, { person: personPost, sleeves: S.i1s4f0, install: { firstH: at, gains: gn }, retrain: r })
  console.log(`   -> ${(never - h).toFixed(2)}h saved (positive: the install wins)`)
}
console.log('== a Bladeburner-aug batch (EsperTech, EMS-4, ORION-MKIV, BLADE-51b: ~$2.3b at 1.9^k, 6250 Bladeburners rep) installed later')
const bbAugs = { strength: 1.092, defense: 1.092, dexterity: 1.1466, agility: 1.04, bladeburner_success_chance: 1.1366, bladeburner_stamina_gain: 1.0404 }
for (const at of [12, 24, 36]) for (const sk of [0, 1800]) {
  const h = run(`install the 4 Bladeburner augs at ${at}h, skill clock ${sk}s`, { person: personPost, sleeves: S.i1s4f0, install: { firstH: at, gains: bbAugs }, retrain: r, sks: sk })
  const nv = run(`  never, skill clock ${sk}s`, { person: personPost, sleeves: S.i1s4f0, retrain: r, sks: sk })
  console.log(`   -> ${(nv - h).toFixed(2)}h saved`)
}
