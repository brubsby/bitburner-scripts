// BN14.1 BLADEBURNER EXIT, PASS TO PASS — which inputs move the exit with no event.
//
//   node tools/sim/bbcal14.mjs [capDir] [--model path/to/bbplan.js] [--Q members]
//
// Live BN14.1 2026-10-04 the exit forecast was far noisier than its
// intervals (exitcal X 16.7, e-process 1e17, EXIT UNSTABLE 38.2 -> 47.2h in
// 5 min). Input: the recorder's captures (capDir: save.<stamp>.json every 5
// min; /tel/bladeburner.txt, plan.txt, sleeve.txt, exitinputs.txt every
// minute — tools/sim/bbcal14/recorder.mjs, run from /tmp/bbk14) or, by default, the fixture built from
// them (tools/test/fixture-bn14-bladecal-passes.json, bbcal14/mkfix.py).
// For each plan pass the exit is rebuilt from that pass's inputs with
// bbplan.bladeStartOf (the builder progress.js bladeRouteOf uses), then:
//   1. PRICED AS THE PLAN PRICES IT, old (one exit, the point under the
//      draws' structural noise) and new (Q members, draw i on member i mod
//      Q), with the fleet as published and held; the revisions scored by
//      exitcal.js itself (mean z^2 against the martingale predictive, with
//      and without the points' own error);
//   2. ATTRIBUTED: each consecutive pair, one input group at a time from the
//      later pass into the earlier one (the clock, rank, counts, cities,
//      stamina, person, success k, rank k, fleet) — single exit and members.
// tools/test/bladecal14.test.mjs [B14-1..8] holds it.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../test/gameresolve.mjs'

const argv = /tools\/sim\//.test(process.argv[1] ?? '') ? process.argv.slice(2) : []
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null)
export const BB = await import(pathToFileURL(arg('--model') ? path.resolve(arg('--model')) : path.join(REPO_ROOT, 'bbplan.js')).href)
const BP = await import('bodyplan.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const NM = bitNodeMults(14)
export const levelled = (m) => ({ ...m, strength: m.strength * NM.StrengthLevelMultiplier, defense: m.defense * NM.DefenseLevelMultiplier, dexterity: m.dexterity * NM.DexterityLevelMultiplier, agility: m.agility * NM.AgilityLevelMultiplier, charisma: m.charisma * NM.CharismaLevelMultiplier })

/** Every plan pass in capDir with the nearest-earlier records of the other files. */
export function passesOf(dir) {
  const files = fs.readdirSync(dir)
  const stamps = (pre) => files.filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).replace(/\.json$/, '')).sort()
  const J = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch {
      return null
    }
  }
  const saves = stamps('save.')
  const out = []
  let lastAt = null
  for (const st of stamps('plan.txt.')) {
    const plan = J(`plan.txt.${st}`)
    if (!plan || plan.at === lastAt) continue
    lastAt = plan.at
    const sv = saves.filter((s) => s <= st).at(-1) ?? saves[0]
    out.push({ stamp: st, plan, tel: J(`bladeburner.txt.${st}`), sleeve: J(`sleeve.txt.${st}`), ei: J(`exitinputs.txt.${st}`), save: sv ? J(`save.${sv}.json`) : null })
  }
  return out
}

/** The fixture's passes (tools/sim/bbcal14/mkfix.py) in passesOf's shape. */
export function passesOfFixture(fx) {
  return fx.passes.map((e) => ({ stamp: e.at, plan: { at: e.at, decisions: { bladeRoute: e.bladeRoute }, exit: e.exit, events: e.events }, tel: e.tel, save: { at: e.person.saveAt, player: e.person }, ei: { inputs: { money: e.wealth, flatIncomePerSec: e.flatPerSec } } }))
}
export const FIXTURE = path.join(REPO_ROOT, 'tools/test/fixture-bn14-bladecal-passes.json')

/** The pass's inputs, as bladeRouteOf assembles them (person from the nearest save; the tel as the plan read it ~ the capture). */
export function inputsOf(p) {
  const br = p.plan.decisions.bladeRoute
  const cal = br.calibration ?? {}
  const P = p.save.player
  const person = { skills: P.skills, exp: P.exp, mults: levelled(P.mults), city: P.city, money: P.money }
  const ei = p.ei?.inputs ?? {}
  return {
    at: p.plan.at,
    tel: p.tel,
    person,
    sleeves: br.sleeves,
    gymExpPerSec: br.start?.gymExpPerSec,
    rankScale: cal.rank?.applied ?? 1,
    successScale: cal.success?.applied ?? 1,
    rankSdLn: cal.rank?.sdLn ?? 0,
    successSdLn: cal.success?.sdLn ?? 0,
    basis: br.installBasis,
    wealth: ei.money ?? P.money,
    flatPerSec: ei.flatIncomePerSec ?? 0,
    city: P.city,
  }
}
export function startOf(I, { spec = 'never', now = Date.parse(I.at), extra = {} } = {}) {
  const retrainSecsOf = BP.retrainSecsOfFor({ node: NM, trainingMult: 1, flatPerSec: I.flatPerSec, holdS: BB.POLICY.retrainLegS, start: { cash: I.wealth, city: I.city }, install: { cash: 1262, city: 'Sector-12' } })
  const install = spec === 'never' ? null : spec
  return { ...BB.bladeStartOf({ tel: I.tel, person: I.person, sleeves: I.sleeves, gymExpPerSec: I.gymExpPerSec, bnRank: NM.BladeburnerRank, skillCostMult: NM.BladeburnerSkillCost, install, rankScale: I.rankScale, successScale: I.successScale, rankSdLn: I.rankSdLn, successSdLn: I.successSdLn, retrainSecsOf, policy: BB.POLICY_V1 ?? null, now }), ...extra } // the captures ran POLICY_V1
}
export const hoursOf = (s0) => BB.bladeExit(s0).hours
export const meanOf = (s0, Q = BB.BLADE_ENSEMBLE?.Q ?? 6) => {
  const hs = []
  for (let m = 0; m < Q; m++) hs.push(BB.bladeExit(BB.bladeMemberOf(s0, m, Q)).hours)
  return BB.bladeMeanOf(hs.map((h) => (Number.isFinite(h) ? h : null)))
}

/** The draws' structural noise as the plan published it: ln(sample / point) of the route's 24 draws (seeded per life, so the same z's every pass). */
export const zOf = (p) => {
  const br = p.plan.decisions.bladeRoute
  const pt = br.bladeH
  return (br.samples ?? []).filter((x) => Number.isFinite(x) && x > 0).map((x) => Math.log(x / pt))
}
const q = (xs, f) => {
  const a = [...xs].sort((x, y) => x - y)
  const i = (a.length - 1) * f
  const lo = Math.floor(i)
  return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo)
}
/** One pass priced as the plan prices the blade arm: old (one exit, the point's draws) or new (members, draw i on member i mod Q). */
export function priceOf(I, z, { spec = 'never', Q = 1, fleet = null } = {}) {
  const s0 = startOf(fleet ? { ...I, sleeves: fleet } : I, { spec })
  const members = []
  for (let m = 0; m < Q; m++) members.push(hoursOf(Q > 1 ? BB.bladeMemberOf(s0, m, Q) : s0))
  const e = BB.bladeMeanOf(members.map((h) => (Number.isFinite(h) ? h : null)))
  const samples = z.map((zi, i) => (members[i % Q] ?? e.hours) * Math.exp(zi))
  const q10 = q(samples, 0.1)
  const q90 = q(samples, 0.9)
  return { point: e.hours, q50: q(samples, 0.5), q10, q90, sdLevel: (q90 - q10) / (2 * 1.2816), seH: Q > 1 && Number.isFinite(e.sdH) ? e.sdH / Math.sqrt(Q) : 0, members }
}
/** Revisions of a priced series (the exitcal definitions): u = b - (a - dh), the martingale sd sdA sqrt(dh/E_a), and with the endpoints' standard errors. */
export function revisionStats(rows, key = 'q50') {
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    const dh = (Date.parse(b.at) - Date.parse(a.at)) / 3.6e6
    const u = b[key] - (a[key] - dh)
    const mart = a.sdLevel * Math.sqrt(Math.min(1, dh / a[key]))
    out.push({ at: b.at, u, mart, z2: (u / mart) ** 2, z2se: u ** 2 / (mart ** 2 + a.seH ** 2 + b.seH ** 2) })
  }
  const mean = (k) => out.reduce((s, x) => s + x[k], 0) / Math.max(1, out.length)
  return { revs: out, n: out.length, rmsU: Math.sqrt(mean('u') ** 2 + out.reduce((s, x) => s + (x.u - mean('u')) ** 2, 0) / Math.max(1, out.length)), X: mean('z2'), Xse: mean('z2se') }
}

const EC = await import('exitcal.js')
/**
 * The replayed passes scored by exitcal.js itself: each pass a sample (its
 * q50, its level interval, and with members its point's seH), every pair
 * 5 minutes apart a revision (minGapH lowered from the live 0.2h: these are
 * the passes, not the 15-minute samples). Returns {n, meanZ2 (1 calibrated),
 * cover80 (0.8), X (exitcal's run statistic), verdict}.
 */
export function exitcalOf(rows, { withSe = true } = {}) {
  const S = rows.map((r) => ({ at: r.at, exitH: r.q50, q10: r.q10, q90: r.q90, ...(withSe && r.seH > 0 ? { seH: r.seH } : {}), life: 1, ver: 'replay', boot: 'replay' }))
  const revs = EC.revisionsOf(S, { minGapH: 0.05 })
  const pred = EC.martingalePredictiveOf(revs, 1)
  const t = EC.martingaleTestOf(revs)
  return { n: pred.length, meanZ2: pred.reduce((a, p) => a + p.z * p.z, 0) / Math.max(1, pred.length), cover80: pred.filter((p) => p.hit).length / Math.max(1, pred.length), X: t.X, rho1: t.rho1, verdict: t.verdict }
}

/** The input groups a pass reads (the attribution swaps one at a time from the later pass into the earlier one). */
export const GROUPS = {
  clock: (I, J) => ({ ...I, tel: { ...I.tel, skillsAt: J.tel.skillsAt }, at: J.at }),
  rank: (I, J) => ({ ...I, tel: { ...I.tel, rank: J.tel.rank, skillPoints: J.tel.skillPoints, levels: J.tel.levels } }),
  counts: (I, J) => ({ ...I, tel: { ...I.tel, counts: J.tel.counts, maxLevels: J.tel.maxLevels, successes: J.tel.successes } }),
  cities: (I, J) => ({ ...I, tel: { ...I.tel, cities: J.tel.cities, citiesAt: J.tel.citiesAt } }),
  stamina: (I, J) => ({ ...I, tel: { ...I.tel, stamina: J.tel.stamina, maxStamina: J.tel.maxStamina } }),
  person: (I, J) => ({ ...I, person: J.person, wealth: J.wealth, city: J.city }),
  successK: (I, J) => ({ ...I, successScale: J.successScale, successSdLn: J.successSdLn }),
  rankK: (I, J) => ({ ...I, rankScale: J.rankScale, rankSdLn: J.rankSdLn }),
  fleet: (I, J) => ({ ...I, sleeves: J.sleeves }),
}
/** One pair, one group at a time: the exit (Q members' mean; Q 1 the single exit) of the earlier pass with that group from the later one, at the earlier pass's clock unless the group is the clock. */
export function attribute(I, J, { Q = 1 } = {}) {
  const h = (X) => priceOf(X, [0], { Q }).point
  const base = h(I)
  const out = { base, all: h({ ...J, at: J.at }) }
  for (const [g, f] of Object.entries(GROUPS)) out[g] = h(f(I, J)) - base
  return out
}

if (/tools\/sim\/bbcal14\.mjs$/.test(process.argv[1] ?? '')) {
  const dir = argv.find((a) => !a.startsWith('--') && a !== arg('--model') && a !== arg('--Q')) ?? null
  const Q = arg('--Q') ? +arg('--Q') : BB.BLADE_ENSEMBLE?.Q ?? 6
  const src = dir ? passesOf(dir) : passesOfFixture(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')))
  const ps = src.filter((p) => p.tel && p.save && p.plan?.decisions?.bladeRoute?.samples?.length)
  console.log(`${ps.length} passes (${dir ?? FIXTURE}); members Q ${Q}`)
  for (const spec of ['never']) {
    for (const fleetMode of ['as published', 'held i4s1f0']) {
      const fleet = fleetMode === 'as published' ? null : { infiltrate: 4, support: 1, fa: 0 }
      const old = []
      const neu = []
      for (const p of ps) {
        const I = inputsOf(p)
        const z = zOf(p)
        old.push({ at: I.at, ...priceOf(I, z, { spec, Q: 1, fleet }) })
        neu.push({ at: I.at, ...priceOf(I, z, { spec, Q, fleet }) })
      }
      console.log(`== '${spec}', fleet ${fleetMode}`)
      for (let i = 0; i < ps.length; i++) console.log(`   ${old[i].at.slice(11, 16)}Z  one exit ${old[i].point.toFixed(2)}h q50 ${old[i].q50.toFixed(2)} [${old[i].q10.toFixed(1)}-${old[i].q90.toFixed(1)}]  |  ${Q} members mean ${neu[i].point.toFixed(2)}h (se ${neu[i].seH.toFixed(2)}) q50 ${neu[i].q50.toFixed(2)} [${neu[i].q10.toFixed(1)}-${neu[i].q90.toFixed(1)}]  members ${neu[i].members.map((h) => h?.toFixed(1)).join(' ')}`)
      const ro = revisionStats(old)
      const rn = revisionStats(neu)
      const eo = exitcalOf(old)
      const en = exitcalOf(neu)
      const en0 = exitcalOf(neu, { withSe: false })
      console.log(`   revisions of q50 (${ro.n}): rms ${ro.rmsU.toFixed(2)}h -> ${rn.rmsU.toFixed(2)}h`)
      console.log(`   exitcal on the replayed passes: one exit  mean z^2 ${eo.meanZ2.toFixed(1)}, 80% cover ${(100 * eo.cover80).toFixed(0)}%, X ${eo.X ?? '-'} | members, no se: mean z^2 ${en0.meanZ2.toFixed(1)}, cover ${(100 * en0.cover80).toFixed(0)}% | members with their se: mean z^2 ${en.meanZ2.toFixed(2)}, cover ${(100 * en.cover80).toFixed(0)}%, X ${en.X ?? '-'}, rho1 ${en.rho1 ?? '-'}`)
    }
  }
  console.log("== ATTRIBUTION: the earlier pass's exit with ONE input group from the later pass (hours moved; single exit, then the members' mean)")
  const keys = Object.keys(GROUPS)
  console.log(`   ${'pair'.padEnd(13)} ${'all'.padStart(7)} ${keys.map((k) => k.padStart(8)).join('')}`)
  for (let i = 1; i < ps.length; i++) {
    const I = inputsOf(ps[i - 1])
    const J = inputsOf(ps[i])
    for (const q of [1, Q]) {
      const a = attribute(I, J, { Q: q })
      console.log(`   ${(I.at.slice(11, 16) + '-' + J.at.slice(11, 16)).padEnd(11)}${q > 1 ? 'm' : ' '} ${(a.all - a.base).toFixed(2).padStart(7)} ${keys.map((k) => a[k].toFixed(2).padStart(8)).join('')}`)
    }
  }
}
