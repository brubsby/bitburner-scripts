// BN4.3 BLADEBURNER EXIT CALIBRATION — the forecast's revisions, replayed.
//
//   node tools/sim/bbcal4.mjs [--model path/to/bbplan.js] [--old path/to/old-bbplan.js]
//
// Live BN4.3 2026-10-02/03 the black-op exit fell 2.54h per wall hour against
// the 1 a calibrated forecast falls (exitcal.js revision test, t = -2.6;
// e-process 3.5e11, then 7.8e12). This replays it on the model, from the
// states the run left:
//   1. THE PUBLISHED REVISIONS per life (installgate exitCalibration.samples).
//   2. THE BB-LITE -> FULL PAIR (fixture-bn4-homeblade-0100: 01:24Z, bb-lite,
//      no city read; fixture-bn4-gymless-0237: 02:41Z, bladeburner.js, every
//      city read): the same fleet at both ends, the old model on the inputs
//      the plan had (the start's default cities, the rank k then applied)
//      against this one (the cities at the division's age, k by the v2
//      definition).
//   3. LIFE 5 FROM THE RECORDER (fixture-bn4-bladecal-life5, every 5 min from
//      09:59Z): each capture's exit on (a) the plan's published inputs, old
//      model, (b) this model on the inputs as they ran (the sleeves' actual
//      work, k v2); the revision per wall hour; the model's rank path from
//      each capture against the rank the game paid.
// --old defaults to the model before this calibration (git 637cf7c), written
// to the OS temp dir.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../test/gameresolve.mjs'

const argv = /tools\/sim\//.test(process.argv[1] ?? '') ? process.argv.slice(2) : []
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null)
export const BB = await import(pathToFileURL(arg('--model') ? path.resolve(arg('--model')) : path.join(REPO_ROOT, 'bbplan.js')).href)
export async function oldModel(rev = '637cf7c') {
  const f = path.join(os.tmpdir(), `bbplan-${rev}.js`)
  if (!fs.existsSync(f)) fs.writeFileSync(f, execSync(`git -C ${REPO_ROOT} show ${rev}:bbplan.js`, { encoding: 'utf8' }))
  return import(pathToFileURL(f).href)
}
const BP = await import('bodyplan.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const n4 = bitNodeMults(4)
const J = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test', f), 'utf8'))
export const H0124 = J('fixture-bn4-homeblade-0100.json')
export const G0241 = J('fixture-bn4-gymless-0237.json')
export const L5 = J('fixture-bn4-bladecal-life5.json')
export const levelled = (m) => ({ ...m, strength: m.strength * n4.StrengthLevelMultiplier, defense: m.defense * n4.DefenseLevelMultiplier, dexterity: m.dexterity * n4.DexterityLevelMultiplier, agility: m.agility * n4.AgilityLevelMultiplier, charisma: m.charisma * n4.CharismaLevelMultiplier })
const ms = (s) => Date.parse(s)
export const slope = (pts) => {
  const n = pts.length
  if (n < 2) return null
  const mx = pts.reduce((a, p) => a + p.x, 0) / n
  const my = pts.reduce((a, p) => a + p.y, 0) / n
  let sxy = 0
  let sxx = 0
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my)
    sxx += (p.x - mx) ** 2
  }
  return sxx > 0 ? sxy / sxx : null
}

// --- 1. the published revisions -------------------------------------------
export function publishedRevisions() {
  const byLife = new Map()
  for (const s of L5.exitSamples) {
    if (!Number.isFinite(s.exitH)) continue
    if (!byLife.has(s.life)) byLife.set(s.life, [])
    byLife.get(s.life).push({ x: (ms(s.at) - ms(L5.exitSamples[0].at)) / 3.6e6, y: s.exitH, at: s.at })
  }
  return [...byLife.entries()].map(([life, pts]) => ({ life, from: pts[0].at, to: pts.at(-1).at, n: pts.length, hours: pts.at(-1).x - pts[0].x, perH: slope(pts) }))
}

// --- 2. the bb-lite -> full pair -------------------------------------------
export const JOINED_AT = L5.joinedAt
/** Life 5 as it ran: bb-lite from the 03:08Z install until bladeburner.js took over (~04:30Z: the 03:47Z rank window opened on a record with no success calibration — bb-lite's; the 04:47Z one on 1.215 — the full daemon's), the sleeves idle until sleeve.js was placed by hand at 09:20Z. */
export const LIFE5_LEAN_H = (Date.parse('2026-10-03T04:30:00Z') - Date.parse(L5.installAt)) / 3.6e6
export const SLEEVES_BACK_AT = '2026-10-03T09:20:00Z'
/** The retrain gym's rate for a person (progress.js bladeRouteOf: bodyplan.retrainGymOf). */
export const gymRateOf = (person) => {
  const gym = BP.retrainGymOf(person).gym
  return gym ? BP.gymRate(gym, 'strength', person, 1) : null
}
export function pair(M, { definition, leanUntilH = null }) {
  const mults = levelled(H0124.player.mults)
  const dH = (ms(G0241.bladeburner.at) - ms(H0124.bladeburner.at)) / 3.6e6
  const out = []
  for (const sleeves of [{ infiltrate: 0, support: 0, fa: 0 }, { infiltrate: 2, support: 3, fa: 0 }]) {
    // old: the plan's inputs then (no joinedAt; the rank k it applied, 1.187 then 1.243); new: the age on the record, k v2 (no window qualified: 1)
    const old = definition === 'old'
    const a = M.bladeExit(M.bladeStartOf({ tel: old ? H0124.bladeburner : { ...H0124.bladeburner, joinedAt: JOINED_AT }, person: { ...H0124.player, mults }, sleeves, gymExpPerSec: 14.1, install: null, rankScale: old ? 1.1869 : 1, successScale: 1, leanUntilH, now: ms(H0124.bladeburner.at) })).hours
    const b = M.bladeExit(M.bladeStartOf({ tel: old ? G0241.bladeburner : { ...G0241.bladeburner, joinedAt: JOINED_AT }, person: { ...G0241.player, mults }, sleeves, gymExpPerSec: 14.1, install: null, rankScale: old ? 1.243 : 1, successScale: 0.9879, now: ms(G0241.bladeburner.at) })).hours
    out.push({ sleeves, a, b, dH, perH: (b - a) / dH })
  }
  return out
}

// --- 3. life 5 from the recorder -------------------------------------------
export const fleetOfSleeves = (ctors) => ({ infiltrate: ctors.filter((c) => c === 'SleeveInfiltrateWork').length, support: ctors.filter((c) => c === 'SleeveSupportWork').length, fa: ctors.filter((c) => c === 'SleeveBladeburnerWork').length })
export function startAt(M, cap, { definition, extra = {} }) {
  const person = { skills: cap.player.skills, exp: cap.player.exp, mults: levelled(cap.player.mults), city: cap.player.city, money: 1e9 }
  const gym = BP.retrainGymOf(person).gym
  const old = definition === 'old'
  const sleeves = old ? cap.plan.sleeves : fleetOfSleeves(cap.sleeves)
  const tel = old ? cap.tel : { ...cap.tel, joinedAt: L5.joinedAt }
  return M.bladeStartOf({ tel, person, sleeves, gymExpPerSec: BP.gymRate(gym, 'strength', person, 1), bnRank: 1, skillCostMult: 1, install: null, rankScale: old ? cap.plan.calibration.rank.applied ?? 1 : 1, successScale: cap.plan.calibration.success.applied ?? 1, now: ms(cap.tel.at), ...extra })
}
export function life5(M, { definition }) {
  const caps = L5.captures
  const t0 = ms(caps[0].tel.at)
  const rows = caps.map((cap) => {
    const r = M.bladeExit({ ...startAt(M, cap, { definition }), pathEveryS: 900 })
    return { at: cap.tel.at, x: (ms(cap.tel.at) - t0) / 3.6e6, y: r.hours, rank: cap.tel.rank, path: r.path, pub: cap.plan.bladeH }
  })
  // the model's rank path from each capture against the realised rank (the captures after it)
  const ratios = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const e = rows[j].x - rows[i].x
      if (e < 0.45) continue
      const pred = BB.rankOnPath(rows[i].path, e) - rows[i].rank
      const real = rows[j].rank - rows[i].rank
      if (pred > 0 && real > 0) ratios.push({ from: rows[i].at, h: e, ratio: real / pred })
      break
    }
  }
  return { rows, perH: slope(rows.map((r) => ({ x: r.x, y: r.y }))), pubPerH: slope(rows.filter((r) => Number.isFinite(r.pub)).map((r) => ({ x: r.x, y: r.pub }))), ratios }
}

// --- 4. life 5 as it ran, from life 4's last full state ----------------------
/**
 * From 02:41Z (life 4, bladeburner.js, every city read) through the 03:08Z
 * install (the batch's gains: the life-5 save's multipliers over life 4's),
 * the sleeves as they ran (i2s3 to the install, none until 09:20Z, i3s2
 * after) and bb-lite to its handover — against the model from the first
 * recorder capture (09:59Z, scales 1 at both ends, no install after it). A
 * calibrated forecast's FINISH does not move: returns {finish0, finish1,
 * moveH, dH, naiveFinish} (naive: the sleeves idle throughout, the full
 * daemon from the install — what a pipeline blind to both priced).
 */
export function asRun(M) {
  const m4 = levelled(H0124.player.mults)
  const cap = L5.captures[0]
  const m5 = levelled(cap.player.mults)
  const gains = {}
  for (const k of M.BLADE_GAIN_KEYS) if (m5[k] / m4[k] !== 1) gains[k] = m5[k] / m4[k]
  const T0 = ms(G0241.bladeburner.at)
  const instH = (ms(L5.installAt) - T0) / 3.6e6
  const person = { skills: G0241.player.skills, exp: G0241.player.exp, mults: m4, city: 'Sector-12', money: 1e9 }
  const SL = (i, sup) => ({ infiltrate: i, support: sup, fa: 0 })
  const s = M.bladeStartOf({ tel: { ...G0241.bladeburner, joinedAt: JOINED_AT }, person, sleeves: SL(2, 3), gymExpPerSec: gymRateOf(person), install: { firstH: instH, gains }, rankScale: 1, successScale: 1, now: T0 })
  const r0 = M.bladeExit({ ...s, lean: { untilH: instH + LIFE5_LEAN_H, city: null }, steps: [{ atH: instH, sleeves: SL(0, 0) }, { atH: (ms(SLEEVES_BACK_AT) - T0) / 3.6e6, sleeves: SL(3, 2) }] })
  const finish0 = T0 + r0.hours * 3.6e6
  const r1 = M.bladeExit(startAt(M, cap, { definition: 'new', extra: { successScale: 1 } }))
  const finish1 = ms(cap.tel.at) + r1.hours * 3.6e6
  const naive = M.bladeExit({ ...s, sleeves: SL(0, 0) })
  return { finish0, finish1, moveH: (finish1 - finish0) / 3.6e6, dH: (ms(cap.tel.at) - T0) / 3.6e6, naiveFinish: T0 + naive.hours * 3.6e6 }
}

if (/tools\/sim\/bbcal4\.mjs$/.test(process.argv[1] ?? '')) {
  const OLD = arg('--old') ? await import(pathToFileURL(path.resolve(arg('--old'))).href) : await oldModel()
  console.log('1. THE PUBLISHED EXIT, per life (installgate exitCalibration.samples): revision per wall hour (a calibrated forecast: -1)')
  for (const l of publishedRevisions()) console.log(`   life ${l.life}  ${l.from.slice(11, 16)}-${l.to.slice(11, 16)}Z  ${l.n} samples over ${l.hours.toFixed(2)}h: ${l.perH?.toFixed(2)} h/h`)
  console.log('2. BB-LITE (01:24Z, no city read) -> FULL DAEMON (02:41Z, every city read), the same fleet both ends:')
  const po = pair(OLD, { definition: 'old' })
  const pn = pair(BB, { definition: 'new' })
  const HANDOVER_H = (ms('2026-10-03T02:14:36Z') - ms(H0124.bladeburner.at)) / 3.6e6 // bladeburner.js's first record of that life (home 128GB at 02:12Z)
  const pl = pair(BB, { definition: 'new', leanUntilH: HANDOVER_H })
  po.forEach((o, i) => {
    const n = pn[i]
    const l = pl[i]
    console.log(`   fleet ${JSON.stringify(o.sleeves)}: before ${o.a.toFixed(2)} -> ${o.b.toFixed(2)}h (${o.perH.toFixed(2)} h/h) | now ${n.a.toFixed(2)} -> ${n.b.toFixed(2)}h (${n.perH.toFixed(2)} h/h) | now, bb-lite's policy to the handover (${HANDOVER_H.toFixed(2)}h) ${l.a.toFixed(2)} -> ${l.b.toFixed(2)}h (${l.perH.toFixed(2)} h/h) over ${o.dH.toFixed(2)}h`)
  })
  console.log(`3. LIFE 5 from the recorder (${L5.captures.length} captures, ${L5.captures[0].tel.at.slice(11, 16)}-${L5.captures.at(-1).tel.at.slice(11, 16)}Z), the full daemon acting:`)
  const lo = life5(OLD, { definition: 'old' })
  const ln = life5(BB, { definition: 'new' })
  for (let i = 0; i < lo.rows.length; i++) console.log(`   ${lo.rows[i].at.slice(11, 19)}Z rank ${lo.rows[i].rank.toFixed(0).padStart(6)}  published ${lo.rows[i].pub?.toFixed(2) ?? '-'}  old-model ${lo.rows[i].y?.toFixed(2)}  this model ${ln.rows[i].y?.toFixed(2)}`)
  console.log(`   revision per wall hour: published ${lo.pubPerH?.toFixed(2)}, old model ${lo.perH?.toFixed(2)}, this model ${ln.perH?.toFixed(2)} (calibrated: -1)`)
  const rs = ln.ratios
  if (rs.length) console.log(`   realised / model rank gain over the next ${rs[0].h.toFixed(2)}h: ${rs.map((r) => r.ratio.toFixed(2)).join(' ')} (mean ${(rs.reduce((a, r) => a + r.ratio, 0) / rs.length).toFixed(3)})`)
  const a = asRun(BB)
  const iso = (x) => new Date(x).toISOString().slice(5, 16) + 'Z'
  console.log(`4. LIFE 5 AS RUN from 02:41Z (the install, the sleeves idle 03:08-09:20Z, bb-lite to ~04:30Z): finish ${iso(a.finish0)}; from the 09:59Z capture ${iso(a.finish1)} — moved ${a.moveH.toFixed(2)}h over ${a.dH.toFixed(2)}h (${(-1 + a.moveH / a.dH).toFixed(2)} h/h); blind to the sleeves and the lean daemon: ${iso(a.naiveFinish)}`)
}
