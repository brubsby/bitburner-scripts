// [BI] THE BN14.1 INSTALL ON THE BLADEBURNER ROUTE — live 2026-10-04 01:32:10Z.
//
// The install actor priced the next life at 81.97h (never 84.1h); the new
// life priced itself at 176.95h (01:37Z), 148.8h (01:42Z), 126.85h (01:52Z):
// EXIT JUMP AT INSTALL +95h. Not two models — two input sets. After the
// install, boot placed bladeburner.js and sleeve.js on the 256GB home and
// both were refused their RAM: ramgrow's refusal record (no bitNode, no
// division) replaced /tel/bladeburner.txt and /tel/sleeve.txt. The plan then
// priced a division never joined (01:37Z), the watchdog relaunched
// bladeburner.js at 01:40Z on that record — the measured success calibration
// and the division's age were gone — and sleeve.js at 01:52Z: until then the
// fleet priced as none. Meanwhile the body step stood the player in Ishima
// (the batch's city-faction joins) on a Powerhouse order the actor never
// travelled for.
//
// Fixture: tools/test/fixture-bn14-install-0132.json (tools/sim/exitjump/
// mkfix-bn14-0132.py; replay: tools/sim/exitjump/replay-bn14-0132.mjs).
//
//   BI1 THE CAUSE, REPLAYED: the new life's 01:52Z price reproduced; the fleet the plan could not
//       read and the success calibration the restart lost are each worth >10h of the jump
//   BI2 THE CARRY: a refused raise republishes the record beneath it (ramgrow carry), every
//       bladeburner.js record carries the division (bbplan.divisionCarryOf), the plan reads the
//       division through the refusal, and a fleet record from before the install stays stale
//   BI3 THE GYM'S CITY: combatBarPlanOf charges the flight (crime for the fare when short), the
//       actor's re-issue flies to the gym first, and re-issues this life's body order when the
//       batch ordered none
//   BI4 THE EXIT CHARGES THE RETRAIN'S MONEY: the install arm's retrain on $1262 is no shorter
//       than the legs alone, and longer with no income
//   BI5 THE GUARD: the realised jump distribution (BN14's +95h) and the model's scatter are the
//       margin; the 01:32Z and 02:07Z installs hold; a clear saving still installs
//   BI6 WIRING

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const IG = await import('installgate.js')
const AP = await import('actplan.js')
const { raiseRam } = await import('ramgrow.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn14-install-0132.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const NM = bitNodeMults(14)
const lv = (m) => ({ ...m, strength: m.strength * NM.StrengthLevelMultiplier, defense: m.defense * NM.DefenseLevelMultiplier, dexterity: m.dexterity * NM.DexterityLevelMultiplier, agility: m.agility * NM.AgilityLevelMultiplier, charisma: m.charisma * NM.CharismaLevelMultiplier })
const PRE = Object.fromEntries(Object.entries(F.mults).map(([k, v]) => [k, v / (F.nfg3[k] ?? 1)]))
const personPre = { skills: F.person0129.skills, exp: F.person0129.exp, mults: lv(PRE) }
const personPost = { skills: F.person0152.skills, exp: F.person0152.exp, mults: lv(F.mults) }
const FLEET = { infiltrate: 1, support: 4, fa: 0 }
const NONE = { infiltrate: 0, support: 0, fa: 0 }
const exitOf = ({ tel = F.tel, person, sleeves, install = null, successScale = 1, retrainSecsOf = null, sks = null }) => {
  const s0 = BB.bladeStartOf({ tel, person, sleeves, gymExpPerSec: 10 * person.mults.strength_exp, bnRank: NM.BladeburnerRank, skillCostMult: NM.BladeburnerSkillCost, install, rankScale: F.rankScale, successScale, retrainSecsOf, now: Date.parse(F.tel.at) })
  if (Number.isFinite(sks)) s0.skillSinceS = sks
  return BB.bladeExit(s0)
}
/** A fake ns with a file system, for the publishers. */
const fakeNs = (files = {}) => ({
  files,
  read: (f) => files[f] ?? '',
  write: (f, d) => {
    files[f] = d
  },
  ramOverride: () => 3.25,
  sleep: async () => {},
  tprint: () => {},
  getScriptName: () => 'bladeburner.js',
})

export async function run() {
  const checks = []

  // ---- BI1 --------------------------------------------------------------------
  const c1 = new Check('BI1', "THE CAUSE, REPLAYED: the new life's 01:52Z price reproduced; the unread fleet and the lost calibration each >10h of the jump")
  checks.push(c1)
  const live0152 = F.live['0152'].bladeH
  const rep0152 = exitOf({ person: personPost, sleeves: NONE }).hours
  const withFleet = exitOf({ person: personPost, sleeves: FLEET }).hours
  const withCal = exitOf({ person: personPost, sleeves: FLEET, successScale: 2.0 }).hours
  const actorNever = exitOf({ person: personPre, sleeves: FLEET, successScale: 2.0 }).hours
  c1.examined(4)
  c1.note(`new life 01:52Z: live ${live0152}h, replayed ${rep0152?.toFixed(2)}h (sleeves 0/0/0 as the plan read them, success k 1 after the restart, rank k ${F.rankScale})`)
  c1.note(`+ the fleet as it ran (1/4/0): ${withFleet?.toFixed(2)}h; + the success calibration the old life had (k 2.0, inverted from its never): ${withCal?.toFixed(2)}h`)
  c1.note(`the actor's never (live 84.1h) on the surviving division at k 2.0: ${actorNever?.toFixed(2)}h`)
  if (!(Math.abs(rep0152 - live0152) < 3)) c1.fail(`the 01:52Z price is not reproduced: ${rep0152} vs live ${live0152}`)
  if (!(rep0152 - withFleet > 10)) c1.fail(`the unread fleet should carry >10h of the jump: ${rep0152} -> ${withFleet}`)
  if (!(withFleet - withCal > 10)) c1.fail(`the lost success calibration should carry >10h: ${withFleet} -> ${withCal}`)
  if (!(Math.abs(actorNever - 84.1) < 3)) c1.fail(`the actor's never is not matched at the inverted calibration: ${actorNever}`)

  // ---- BI2 --------------------------------------------------------------------
  const c2 = new Check('BI2', 'THE CARRY: a refused raise keeps the division and the fleet beneath it; every bladeburner.js record carries the division')
  checks.push(c2)
  const fullRec = { ...F.tel, at: '2026-10-04T01:31:50.000Z', bitNode: 14, daemon: 'bladeburner.js', calibration: { success: { k: 2.0, n: 140, groups: [{ name: 'Tracking', level: 5, p: 0.4, n: 140, s: 112 }] } } }
  const carried = BB.divisionCarryOf(fullRec, 14)
  c2.examined(9)
  if (carried.rank !== F.tel.rank || carried.joined !== true || !carried.calibration?.success?.groups?.length || carried.joinedAt !== F.tel.joinedAt) c2.fail('divisionCarryOf must keep rank, joined, joinedAt and the calibration', JSON.stringify(carried).slice(0, 200))
  if (carried.citiesAt !== fullRec.at) c2.fail('the carried cities must be dated by the read', carried.citiesAt)
  if (Object.keys(BB.divisionCarryOf({ ...fullRec, bitNode: 4 }, 14)).length) c2.fail("another node's division must not carry")
  if (Object.keys(BB.divisionCarryOf({ ...fullRec, joined: false }, 14)).length) c2.fail('a division not joined carries nothing')
  // The 01:32Z refusal, replayed through ramgrow: with the carry the plan still reads the division.
  const ns1 = fakeNs({ '/tel/bladeburner.txt': JSON.stringify(fullRec) })
  const ok1 = await raiseRam({ ...ns1, ramOverride: () => 3.25 }, 92.75, '/tel/bladeburner.txt', 'test', 1, 0, { carry: true })
  const rec1 = JSON.parse(ns1.files['/tel/bladeburner.txt'])
  const ns0 = fakeNs({ '/tel/bladeburner.txt': JSON.stringify(fullRec) })
  await raiseRam(ns0, 92.75, '/tel/bladeburner.txt', 'test', 1, 0)
  const rec0 = JSON.parse(ns0.files['/tel/bladeburner.txt'])
  const s1 = BB.bladeStartOf({ tel: rec1.bitNode === 14 ? rec1 : null, person: personPost, sleeves: FLEET, gymExpPerSec: 14, bnRank: 0.6, skillCostMult: 2 })
  c2.note(`refusal without carry: bitNode ${rec0.bitNode}, joined ${rec0.joined} (the 01:32Z record); with carry: bitNode ${rec1.bitNode}, joined ${rec1.joined}, rank ${rec1.rank}, staleSince ${rec1.staleSince}, result ${rec1.result}`)
  if (ok1 !== false || rec1.result !== 'ram-raise-denied' || rec1.health !== 'error') c2.fail('the refusal must still be loud', JSON.stringify(rec1).slice(0, 160))
  if (rec1.bitNode !== 14 || rec1.joined !== true || rec1.staleSince !== fullRec.at || !rec1.calibration?.success?.groups?.length) c2.fail('the carried refusal must keep the division and date it', JSON.stringify(rec1).slice(0, 200))
  if (rec0.bitNode !== undefined) c2.fail('without carry the refusal is the old bare record (other callers unchanged)')
  if (!(s1.joined === true && s1.rank === F.tel.rank && s1.levels && Object.keys(s1.levels).length)) c2.fail('the plan must read the division through the refusal', JSON.stringify({ joined: s1.joined, rank: s1.rank }))
  // The fleet: a carried sleeve record from before the install is stale (the install stopped every sleeve).
  const lifeStart = F.lifeStartMs
  const sleeveRec = { at: '2026-10-04T01:31:00.000Z', bitNode: 14, blade: { config: FLEET } }
  const ns2 = fakeNs({ '/tel/sleeve.txt': JSON.stringify(sleeveRec) })
  await raiseRam(ns2, 37, '/tel/sleeve.txt', 'test', 1, 0, { carry: true })
  const sl = JSON.parse(ns2.files['/tel/sleeve.txt'])
  sl.at = new Date(lifeStart + 60e3).toISOString()
  const fl = BB.bladeFleetOf(sl, { lifeStart })
  c2.note(`the carried sleeve record after the install: bitNode ${sl.bitNode}, fleet ${fl.source} — ${fl.why.slice(0, 120)}`)
  if (sl.bitNode !== 14) c2.fail('the carried sleeve record must keep its bitNode (the plan read "BitNode undefined")')
  if (fl.source !== 'stale') c2.fail('a fleet from before the install must price no sleeve, whatever the refusal stamped on it', fl.why)

  // ---- BI3 --------------------------------------------------------------------
  const c3 = new Check('BI3', "THE GYM'S CITY: the flight is charged, the crime earns it when short, the actor flies before the gym")
  checks.push(c3)
  const reset = { skills: { ...personPost.skills, strength: 1, defense: 1, dexterity: 1, agility: 1 }, exp: { strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0, hacking: 0 }, mults: personPost.mults }
  const T = { strength: 100, defense: 100, dexterity: 100, agility: 100 }
  const poor = BP.combatBarPlanOf(T, { ...reset, city: 'Ishima' }, NM, { cash: 50e3, incomePerSec: 0, holdS: 300 })
  const rich = BP.combatBarPlanOf(T, { ...reset, city: 'Ishima' }, NM, { cash: 50e6, incomePerSec: 0, holdS: 300 })
  const home = BP.combatBarPlanOf(T, { ...reset, city: 'Sector-12' }, NM, { cash: 50e6, incomePerSec: 0, holdS: 300 })
  c3.examined(7)
  c3.note(`Ishima $50k: ${poor.why}`)
  c3.note(`Ishima $50m: ${rich.why}; first ${JSON.stringify(rich.now)}`)
  c3.note(`Sector-12 $50m: ${home.why}`)
  if (poor.now?.kind !== 'crime') c3.fail('in Ishima under the fare the first step must be the money crime', JSON.stringify(poor.now))
  if (!(rich.now?.kind === 'gym' && rich.now.city === 'Sector-12' && rich.now.flight === true)) c3.fail('in Ishima with the fare the first step is the flight to Powerhouse', JSON.stringify(rich.now))
  if (!(home.now?.kind === 'gym' && !home.now.flight)) c3.fail('in Sector-12 no flight', JSON.stringify(home.now))
  if (!(rich.hours.mixed >= home.hours.mixed)) c3.fail('the flight must not make the bar sooner', `${rich.hours.mixed} vs ${home.hours.mixed}`)
  // The actor's re-issue (act.js 1e): the 01:52Z state.
  const base = { now: Date.parse('2026-10-04T01:53:30Z'), progress: { at: '2026-10-04T01:52:14.618Z', health: 'ok', slot: { owner: 'body' } }, lastWork: { kind: 'gym', args: ['Powerhouse Gym', 'str'], at: '2026-10-04T01:42:36Z', batchAt: '2026-10-04T01:42:14.295Z' }, batchAt: '2026-10-04T01:52:14.618Z', batchWork: false, work: null, workAt: '2026-10-04T01:53:20Z', city: 'Ishima', gymCostMult: (n) => BP.GYMS.find((g) => g.name === n)?.costMult ?? null, gymCityOf: (n) => BP.GYMS.find((g) => g.name === n)?.city ?? null, reissued: { n: 0, at: 0 }, fundCrime: 'Mug' }
  const flyRi = AP.reissueWorkOf({ ...base, cash: 7.4e6 })
  const crimeRi = AP.reissueWorkOf({ ...base, cash: 40e3 })
  const heldRi = AP.reissueWorkOf({ ...base, cash: 7.4e6, batchWork: true })
  const hereRi = AP.reissueWorkOf({ ...base, cash: 7.4e6, city: 'Sector-12' })
  c3.note(`01:52Z, Ishima, $7.4m: ${JSON.stringify(flyRi).slice(0, 160)}`)
  c3.note(`01:52Z, Ishima, $40k: ${JSON.stringify(crimeRi).slice(0, 120)}`)
  if (!(flyRi?.kind === 'travel' && flyRi.args?.[0] === 'Sector-12')) c3.fail('the claimed body slot with no work in Ishima must fly to the gym first', JSON.stringify(flyRi))
  if (crimeRi?.kind !== 'crime') c3.fail('under the fare the money crime earns it', JSON.stringify(crimeRi))
  if (heldRi !== null) c3.fail("an older batch's order is not re-issued over a batch that ordered work", JSON.stringify(heldRi))
  if (!(hereRi?.kind === 'gym')) c3.fail('in the gym city the gym re-issues', JSON.stringify(hereRi))

  // ---- BI4 --------------------------------------------------------------------
  const c4 = new Check('BI4', "THE EXIT CHARGES THE RETRAIN'S MONEY: $1262 after an install, the flight from a city without a gym")
  checks.push(c4)
  const nfg = { firstH: 0, gains: F.nfg3 }
  const legs = exitOf({ person: personPre, sleeves: FLEET, install: nfg, successScale: 2.0 })
  const noIncome = exitOf({ person: personPre, sleeves: FLEET, install: nfg, successScale: 2.0, retrainSecsOf: BP.retrainSecsOfFor({ node: NM, flatPerSec: 0, holdS: 300, start: { cash: 1e6, city: 'Ishima' }, install: { cash: F.installCash ?? 1262, city: 'Sector-12' } }) })
  const flat = exitOf({ person: personPre, sleeves: FLEET, install: nfg, successScale: 2.0, retrainSecsOf: BP.retrainSecsOfFor({ node: NM, flatPerSec: F.flatPerSec, holdS: 300, start: { cash: 1e6, city: 'Ishima' }, install: { cash: F.installCash ?? 1262, city: 'Sector-12' } }) })
  const rs = BP.retrainSecsOfFor({ node: NM, flatPerSec: 0, holdS: 300, start: { cash: 50e3, city: 'Ishima' }, install: { cash: 1262, city: 'Sector-12' } })
  const startIshima = rs(reset, 100, 'start')
  const startS12 = BP.retrainSecsOfFor({ node: NM, flatPerSec: 0, holdS: 300, start: { cash: 50e3, city: 'Sector-12' } })(reset, 100, 'start')
  const installS = rs(reset, 100, 'install')
  c4.examined(4)
  c4.note(`install now (k 2.0): the legs alone ${legs.hours?.toFixed(2)}h; on $1262 and no income ${noIncome.hours?.toFixed(2)}h; on $1262 and the flat income $${Math.round(F.flatPerSec)}/s ${flat.hours?.toFixed(2)}h`)
  c4.note(`the retrain to 100 from reset stats: $1262 in Sector-12 ${(installS / 3600).toFixed(2)}h; $50k in Ishima ${(startIshima / 3600).toFixed(2)}h; $50k in Sector-12 ${(startS12 / 3600).toFixed(2)}h`)
  if (!(noIncome.hours > legs.hours)) c4.fail('the retrain on $1262 with no income must cost time over the legs alone', `${noIncome.hours} vs ${legs.hours}`)
  if (!(flat.hours >= legs.hours - 1e-9)) c4.fail('the money-aware retrain is never shorter than the legs', `${flat.hours} vs ${legs.hours}`)
  if (!(startIshima >= startS12)) c4.fail('a retrain from a city without a gym is no faster', `${startIshima} vs ${startS12}`)
  if (!(installS > 0 && isFinite(installS))) c4.fail('the post-install retrain must be priced', installS)

  // ---- BI5 --------------------------------------------------------------------
  const c5 = new Check('BI5', "THE GUARD: BN14's realised +95h and the model's scatter are the margin; 01:32Z and 02:07Z hold; a clear saving installs")
  checks.push(c5)
  const b14 = IG.bladeInstallBiasOf(F.bladeInstallJumps, { node: 14 })
  const sc = BB.bladeExit && (() => {
    const s0 = BB.bladeStartOf({ tel: F.tel, person: personPost, sleeves: FLEET, gymExpPerSec: 10 * personPost.mults.strength_exp, bnRank: NM.BladeburnerRank, skillCostMult: NM.BladeburnerSkillCost, rankScale: F.rankScale, now: Date.parse(F.tel.at) })
    s0.skillSinceS = 0
    const it = BB.bladeScatterGen(s0)
    let r = it.next()
    while (!r.done) r = it.next()
    return r.value
  })()
  const g0132 = IG.bladeLoopGuardOf({ nowH: F.installLast.batchCheck.pricedH, neverH: 84.1, biasH: null, scatterH: sc.spreadH, lifeH: 6.74 })
  const g0132old = IG.bladeLoopGuardOf({ nowH: F.installLast.batchCheck.pricedH, neverH: 84.1, biasH: null, lifeH: 6.74 })
  const g0207 = IG.bladeLoopGuardOf({ nowH: F.gate0207.nowH, neverH: F.gate0207.neverH, biasH: b14.biasH, spreadH: b14.spreadH, biasWhy: b14.why, scatterH: sc.spreadH, lifeH: F.gate0207.ageMs / 3.6e6 })
  const gClear = IG.bladeLoopGuardOf({ nowH: 60, neverH: 110, biasH: 0.9, spreadH: 0.1, scatterH: sc.spreadH, lifeH: 8 })
  const gBn14Clear = IG.bladeLoopGuardOf({ nowH: 10, neverH: 200, biasH: b14.biasH, spreadH: b14.spreadH, lifeH: 8 })
  c5.examined(6)
  c5.note(`BN14 ledger: ${b14.why} -> bias ${b14.biasH}h, spread ${b14.spreadH}h`)
  c5.note(`the model's scatter at 01:52Z (never over the skill clock): ${JSON.stringify(sc.hours)} -> ${sc.spreadH}h`)
  c5.note(`01:32Z (now ${F.installLast.batchCheck.pricedH} vs never 84.1, life 6.74h): ${g0132.ok} — ${g0132.why}`)
  c5.note(`02:07Z: ${g0207.ok} — ${g0207.why}`)
  if (!(Math.abs(b14.biasH - 95.068) < 1e-3 && b14.spreadH > 40)) c5.fail("BN14's +95h must stand in the ledger with its spread", JSON.stringify(b14))
  if (!(sc.spreadH > 2.1)) c5.fail(`the model's scatter (${sc.spreadH}h) should exceed the 2.1h the 01:32Z install was bought on`)
  if (g0132old.ok !== true) c5.fail('the old guard passed the 01:32Z install (the regression this fixes)', g0132old.why)
  if (g0132.ok !== false) c5.fail('with the scatter as the margin the 01:32Z install holds', g0132.why)
  if (g0207.ok !== false) c5.fail('the 02:07Z install (3 NFG, 0.6h into the life) holds', g0207.why)
  if (gClear.ok !== true) c5.fail('a saving past every margin still installs', gClear.why)
  if (gBn14Clear.ok !== true) c5.fail("in BN14 a saving past the +95h bias and its spread still installs", gBn14Clear.why)

  // ---- BI6 --------------------------------------------------------------------
  const c6 = new Check('BI6', 'WIRING: the daemons carry, the plan prices the retrain money and the scatter, the actor travels')
  checks.push(c6)
  const bbj = SRC('bladeburner.js')
  const slj = SRC('sleeve.js')
  const pj = SRC('progress.js')
  const aj = SRC('act.js')
  c6.examined(8)
  if (!/raiseRam\([^\n]*\{ carry: true \}\)/.test(bbj)) c6.fail('bladeburner.js must carry its record through a refused raise')
  if (!/reporter\(ns, STATUS, \(\) => \(\{ \.\.\.carry\.rec/.test(bbj) || !/carry\.rec = divisionCarryOf\(full, info\.currentNode\)/.test(bbj)) c6.fail('every bladeburner.js record must carry the last division read')
  if (!/raiseRam\([^\n]*\{ carry: true \}\)/.test(slj)) c6.fail('sleeve.js must carry its record through a refused raise')
  if (!/retrainSecsOf(, goCombat)? \}\)/.test(pj) || !/retrainSecsOfFor\(\{ node: mults/.test(pj)) c6.fail("progress.js must price the retrain's money in every Bladeburner start")
  if (!/neverScatterH: neverScatter\?\.spreadH/.test(pj) || !/scatterH: ex\.neverScatterH/.test(SRC('installgate.js'))) c6.fail("the model's scatter must reach the guard")
  if (!/bladeInstallSpreadH: b\.spreadH/.test(pj)) c6.fail("the realised jumps' spread must reach the guard")
  if (!/`\$\{bodyStep\.gym\} is in \$\{bodyStep\.city\}`, TRAVEL_FARE\)/.test(pj)) c6.fail("the body step's flight must carry its fare")
  if (!/batchWork,/.test(aj) || !/gymCityOf:/.test(aj) || !/city: player\.city/.test(aj)) c6.fail('act.js must give the re-issue the batch, the city and the gym city')
  return checks
}
