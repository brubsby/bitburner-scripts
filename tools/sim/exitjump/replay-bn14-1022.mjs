// Replay of the second BN14.1 install (2026-10-04 10:22:41Z): the install
// actor's 'now' (33.46h) against the new life's own price (80.18h at
// 10:27:44Z, EXIT JUMP AT INSTALL +46.8h), input group by input group, and
// both on the fixed model (bbplan s0.goCombat: the Go farm's combat effect
// zeroed at an install and regrown at the farm's rate).
// Usage: node replay-bn14-1022.mjs  (FIX=tools/test/fixture-bn14-install-1022.json)
//
// CALIBRATION (printed below, every run): the actor's 'now' and 'never' and
// the new life's point reproduced on the old model (no goCombat) against the
// live 33.458h / 40.1h / 80.181h. The members are the plan's (BLADE_ENSEMBLE).
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const GP = await import('goplan.js')
const { drain } = await import('coop.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const FIX = process.env.FIX ?? new URL('../../test/fixture-bn14-install-1022.json', import.meta.url).pathname
export const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'))
const nm = bitNodeMults(14)
const COMBAT = ['strength', 'defense', 'dexterity', 'agility']
const lv = (m) => ({ ...m, strength: m.strength * nm.StrengthLevelMultiplier, defense: m.defense * nm.DefenseLevelMultiplier, dexterity: m.dexterity * nm.DexterityLevelMultiplier, agility: m.agility * nm.AgilityLevelMultiplier, charisma: m.charisma * nm.CharismaLevelMultiplier })
export const gains = BB.bladeContentOf(fx.batch, (n) => fx.augStats[n]).gains
// THE GO COMBAT EFFECT (Tetrads, effect.ts CalculateEffect) inside each multiplier set.
const T = GP.OPPONENTS.Tetrads
const eff = (n) => GP.effectAt(n, T.power, 4, 0)
const go1035 = eff(fx.goStats1035.Tetrads.nodePower)
const base = fx.multsPost1035.strength / go1035 / gains.strength // the combat level mult with no Go bonus and no batch
const goPre0955 = fx.multsPre0955.strength / base
const goPost1031 = fx.multsPost1031.strength / base / gains.strength
// The pre-install person at 10:19:55Z: the Go effect its four levels bracket (skill.ts floors the level).
const p0 = fx.personPre
export const goPre = (() => {
  let lo = 0
  let hi = Infinity
  for (const k of COMBAT) {
    const x = 32 * Math.log(p0.exp[k] + 534.6) - 200
    const m0 = (fx.multsPre0955[k] / goPre0955) * nm.StrengthLevelMultiplier
    lo = Math.max(lo, p0.skills[k] / x / m0)
    hi = Math.min(hi, (p0.skills[k] + 1) / x / m0)
  }
  return (lo + hi) / 2
})()
const withGo = (m, from, to) => ({ ...m, ...Object.fromEntries(COMBAT.map((k) => [k, (m[k] / from) * to])) })
export const personPre = { skills: p0.skills, exp: p0.exp, mults: lv(withGo(fx.multsPre0955, goPre0955, goPre)) }
export const personPost = (i, go) => ({ skills: fx.personPost[i].skills, exp: fx.personPost[i].exp, mults: lv(withGo(fx.multsPost1031, goPost1031, go)) })
export const nPre = GP.nodePowerFromBonus((goPre - 1) * 100, T.power, 4, 0)
export const preNow = fx.installLast.exits.commitment.at
export const preLifeH = (Date.parse(preNow) - fx.lifeStartPreMs) / 3.6e6
export const ratePre = nPre / preLifeH // the farm's measured rate in the life that installed
export const money = (city, cash) => BP.retrainSecsOfFor({ node: nm, flatPerSec: fx.flatPerSec, holdS: 300, start: { cash, city }, install: { cash: fx.installCash, city: 'Sector-12' } })
export const goOf = (effect, perHour) => ({ effect, nodes: effect > 1 ? GP.nodePowerFromBonus((effect - 1) * 100, T.power, 4, 0) : 0, perHour, power: T.power, goPower: 4, sf14: 0 })
export const startOf = (o) => BB.bladeStartOf({ tel: o.tel ?? fx.tel, person: o.person, sleeves: o.sleeves ?? fx.sleevesPost, gymExpPerSec: o.gym, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: o.install ?? null, rankScale: fx.cal.rank.k, successScale: fx.cal.success.k, rankSdLn: fx.cal.rank.sdLn, successSdLn: fx.cal.success.sdLn, retrainSecsOf: o.retrain ?? null, goCombat: o.goCombat ?? null, policy: BB.POLICY_V1 ?? null, now: Date.parse(o.now) }) // the live run played POLICY_V1
export const meanOf = (o) => drain(BB.bladeExitMeanGen(startOf(o)))
export const nowSpec = { firstH: 0, gains, simulacrum: false }
// The actor's inputs (10:22:25Z): the pre-install person, the division as carried (its skill clock the old daemon's), its gym and money.
export const A = { tel: { ...fx.tel, skillsAt: fx.tel0958.skillsAt }, person: personPre, gym: fx.start0957.gymExpPerSec, retrain: money(p0.city, p0.money), now: preNow }
// The new life's inputs (10:27:44Z): the post-install person (10:25:23Z), its own gym and money, Go x1.0 (the replay's match).
export const N = (go = 1) => ({ tel: fx.tel, person: personPost(0, go), gym: fx.start1027.gymExpPerSec, retrain: money('Sector-12', fx.personPost[0].money), now: fx.live1027.at })

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = (label, o) => {
    const r = meanOf(o)
    console.log(label.padEnd(86), r.hours?.toFixed(2).padStart(7), ' members', r.members.map((h) => h?.toFixed(1)).join(' '))
    return r.hours
  }
  console.log(`batch gains ${JSON.stringify(gains)}`)
  console.log(`Go Tetrads effect: pre-install ${goPre.toFixed(4)} at 10:19:55Z (09:55Z ${goPre0955.toFixed(4)}; n ${Math.round(nPre)} over ${preLifeH.toFixed(2)}h -> ${Math.round(ratePre)}/h), post 10:31Z ${goPost1031.toFixed(4)}, 10:35Z ${go1035.toFixed(4)} (n ${fx.goStats1035.Tetrads.nodePower})`)
  console.log(`\n== CALIBRATION: the old model (no goCombat) against the live prices`)
  const aNow = run(`actor now        (live ${fx.installLast.batchCheck.pricedH}h)`, { ...A, install: nowSpec })
  const aNever = run('actor never      (live 40.1h)', A)
  const nl = run(`new life, Go x1  (live ${fx.live1027.pointH}h, members ${fx.live1027.members.hours.join(' ')})`, N(1))
  console.log(`   jump replayed: ${(nl - aNow).toFixed(2)}h (live +46.81h)`)
  console.log('\n== ATTRIBUTION on the old model: actor -> new life, one group at a time (cumulative)')
  const goReset = { ...gains, ...Object.fromEntries(COMBAT.map((k) => [k, gains[k] / goPre])) }
  let prev = aNow
  const step = (label, o) => {
    const h = run(label, o)
    console.log(`   -> ${(h - prev >= 0 ? '+' : '')}${(h - prev).toFixed(2)}h`)
    prev = h
    return h
  }
  step('G1 the Go combat effect zeroed at the install (combat level / ' + goPre.toFixed(3) + ')', { ...A, install: { ...nowSpec, gains: goReset } })
  // From here the new life's own start, morphed back toward the actor's group by group.
  step("G2 the new life's start, but its person's exp zeroed and $1262 (the actor's install state)", { ...N(1), person: { ...personPost(0, 1), exp: { ...fx.personPost[0].exp, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 } }, retrain: money('Sector-12', fx.installCash) })
  step("G3 + the person's exp at 10:25Z (crime since the install)", { ...N(1), retrain: money('Sector-12', fx.installCash) })
  step("G4 + the money at 10:25Z ($199k) for the retrain", N(1))
  console.log('   (G1->G2: the skill clock, the stamina credit and the gym rate; G2-G4 the new life\'s own head start)')
  console.log('\n== THE RETRAIN in each arm (member 0): hours to the combat bar, stats and max stamina after it')
  const retr = (label, o) => {
    const s0 = startOf(o)
    const r = BB.bladeExit({ ...s0, maxH: 400, traceEveryS: 3600 })
    const tr = r.trace.slice(0, 4).map((x) => `${x.h}h rank ${x.rank} str ${x.str} agi ${x.agi}`).join('; ')
    console.log(`${label.padEnd(60)} exit ${r.hours?.toFixed(2)}h, retrain ${(o.install ? 'after the install' : `${r.joinH.toFixed(2)}h`)}; ${tr}`)
  }
  retr('actor now (Go carried)', { ...A, install: nowSpec })
  retr('actor now (Go zeroed, no regrowth)', { ...A, install: { ...nowSpec, gains: goReset } })
  retr('new life (Go x1, no regrowth)', N(1))
  retr(`new life (Go x1, regrowth ${Math.round(ratePre)}/h)`, { ...N(1), goCombat: goOf(1, ratePre) })
  {
    const s = startOf(N(1))
    const lvl = (k, m) => Math.round(BB.expForLevel(100, m))
    console.log(`   exp to combat 100: Go x1 ${lvl('strength', s.person.mults.strength)} (level mult ${s.person.mults.strength.toFixed(3)}), Go x${goPre.toFixed(2)} ${lvl('strength', s.person.mults.strength * goPre)}; gym ${fx.start1027.gymExpPerSec.toFixed(2)} exp/s x the stat's exp mult`)
  }
  console.log(`\n== THE AUGS: priced ${fx.installLast.batchCheck.pricedN}, bought ${fx.installLast.batchCheck.boughtN} (${fx.installLast.batchCheck.why}); the save's multipliers moved by exactly the priced gains once the Go effect is divided out (str ${(fx.multsPost1035.strength / go1035 / (fx.multsPre0955.strength / goPre0955)).toFixed(4)} vs ${gains.strength}, dex ${(fx.multsPost1035.dexterity / go1035 / (fx.multsPre0955.dexterity / goPre0955)).toFixed(4)} vs ${gains.dexterity}, exp ${(fx.multsPost1035.strength_exp / fx.multsPre0955.strength_exp).toFixed(4)} vs ${gains.strength_exp})`)
  console.log(`== THE MEMBERS: live new-life sd ${fx.live1027.members.sdH}h -> se ${(fx.live1027.members.sdH / Math.sqrt(6)).toFixed(2)}h; the actor's commitment se ${fx.installLast.exits.commitment.pointSeH}h`)
  console.log('\n== THE FIX (s0.goCombat): the effect zeroed at the install and regrown at the farm\'s rate')
  for (const rate of [ratePre, 4906]) {
    const fNow = run(`actor now   (Go x${goPre.toFixed(3)}, ${Math.round(rate)}/h)`, { ...A, install: nowSpec, goCombat: goOf(goPre, rate) })
    const fNever = run(`actor never (Go x${goPre.toFixed(3)}, ${Math.round(rate)}/h)`, { ...A, goCombat: goOf(goPre, rate) })
    const fNl = run(`new life    (Go x1.000 at 10:27Z, ${Math.round(rate)}/h)`, { ...N(1), goCombat: goOf(1, rate) })
    console.log(`   rate ${Math.round(rate)}/h: jump ${(fNl - fNow).toFixed(2)}h (tolerance ${fx.exitJump.first.checks[0].tolH}h); the install's saving ${(fNever - fNow).toFixed(2)}h`)
  }
  // THE REST OF BN14 on the fixed model, from the new life's 10:27Z state:
  // never, against an install at h hours carrying a batch (the Go effect
  // zeroed there and regrown). Positive saving: the install wins.
  console.log(`\n== BN14 INSTALLS on the fixed model (new life 10:27Z, fleet ${JSON.stringify(fx.sleevesPost)}, farm ${Math.round(ratePre)}/h)`)
  const G = { ...N(1), goCombat: goOf(1, ratePre) }
  const never = run('never', G)
  const batches = {
    'this batch again (13 augs: str x1.10 dex x1.27 exp x1.32)': gains,
    '4 Bladeburner augs (EsperTech, EMS-4, ORION-MKIV, BLADE-51b)': { strength: 1.092, defense: 1.092, dexterity: 1.1466, agility: 1.04, bladeburner_success_chance: 1.1366, bladeburner_stamina_gain: 1.0404 },
    '10 NFG': Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma', 'strength_exp', 'defense_exp', 'dexterity_exp', 'agility_exp', 'charisma_exp'].map((k) => [k, Math.pow(1.010101, 10)])),
  }
  for (const [name, g] of Object.entries(batches)) {
    for (const at of [1, 6, 12, 20]) {
      const h = run(`  ${name} at ${at}h`, { ...G, install: { firstH: at, gains: g, simulacrum: false } })
      console.log(`     -> ${(never - h).toFixed(2)}h saved`)
    }
  }
  for (const at of [6, 12, 20]) {
    const h = run(`  The Blade's Simulacrum (alone) at ${at}h`, { ...G, install: { firstH: at, gains: {}, simulacrum: true } })
    console.log(`     -> ${(never - h).toFixed(2)}h saved`)
  }
}
