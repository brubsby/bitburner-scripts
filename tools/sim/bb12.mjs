// BN12'S RANK CLIMB — join to the first black op (Operation Typhoon, rank 2.5k), calibrated on the
// clears as played and its levers priced on bbsim at the next levels' multipliers.
//
//   node tools/sim/bb12.mjs --calib  [--seeds 8 --jobs 2]          bbsim vs BN12.2-12.6 as played
//   node tools/sim/bb12.mjs --levers [--set levers|raid|confirm|fleet --cells 8,10 --base BN12.6
//                                     --seeds 16 --seed0 101 --jobs 2]  each arm vs the set's first, paired
// (~0.3s a run; run niced, at most 2 jobs: the laptop runs hot)
//
// THE MEASUREMENT (history.jsonl on the game's totalPlaytime clock; the board for the clear's exit): the
// Bladeburner join (the first sample with a division), rank at 1/2/3h (interpolated between the ~4-min save
// samples), rank 2500 (Typhoon's reqdRank: BlackOperations.ts:11 — fixed; BladeburnerRank x1.02^-L scales
// the GAIN, Formulas.ts:13-25), the first black op, the clear (bn12-board activeH).
// THE START STATE each clear HAD, all measured: its Source-Files (12.L-1), intelligence, hacking, the
// sleeve fleet it ran (the modal mix 0.6-4h), the grafts as they landed (bbsim o.grafts.doneAtH: each
// starts no earlier than its live completion minus its game duration), the work slot's class share
// outside the grafts (gymDuty), the opening's gym share (preJoinDuty, fixed-point on the join), the Go
// farm's Tetrads node power per hour (the board's capture), the gift (Genesis + the Bladeburner layout
// on BN12's own grid, StaneksGiftExtraSize/PowerMultiplier 1.02^L; BitNode.tsx:984-985) on the
// biggest purchased host the clear owned (BLADE_HOST's ramp to it, 1 core).
// The levels at the join (bbsim o.joinStats: the opening's crime put charisma at ~250 and combat past 150),
// SF12's NeuroFlux levels (bbsim now grants them, Prestige.ts:255-261), and the hacknet's rank exchanges
// seen before the Raids (+100-rank jumps, a FLOOR: the Raid phase hides them; not recorded per clear).
// NOT MODELLED, named: the Raid phase's exchanges, team members (none live: teamSize 0), money beyond
// the grafts (the grafts land when they did; the order arms use an ASSUMED money model, BB12_MONEY).
//
// CALIBRATION 2026-11-13 (--calib, 6 seeds; err = model vs live): join -4..+2%; rank @1h -24..+10% except
// BN12.4 -34% (its early Raids); rank @2h -55..+29%; combat @1-3h -18..+29%; rank 2500 +5..+39%, mean
// ln(model/live) +0.15 (RMS 0.18); first black op -3..+26%, mean +0.07 (RMS 0.11); the clear -10..-1%, mean
// -0.06 (RMS 0.07). SLOW to rank 2500 (the Raid phase's unseen exchanges), right at the first black op,
// a little FAST to the clear. Before the start-state fixes: rank @1h -75..-96%, rank 2500 +0.43 ln.
//
// THE LEVERS 2026-11-13 (bbsim paired, d = arm - incumbent, h; round 1 pooled over BN12.8/12.10 from
// BN12.6's start and BN12.7/12.9 from BN12.4's, 16 seeds each, 101-116 / 301-316):
//   clear / first black op
//   the action mix: boot off +0.23 +- 0.02 / +0.39; boot Raid bar 0.15 -0.07 +- 0.02 / -0.23 (SHIPPED,
//     bbnodepolicy BN12; confirmed on fresh seeds 501-524, 8 cells: -0.05 +- 0.01 / -0.12 +- 0.02); Raid
//     bar 0.4 +0.18 / +0.35; bootMinP 0.25 / 0.05 0.00; black ops at a fixed 0.5 +0.18 / -1.39 (the
//     priced hold of Typhoon costs the first black op ~1.4h and SAVES the clear 0.18h: bo1 is not the
//     target), at 0.8 +0.01 / -0.08; rest band 0.3-0.8 0.00; the boot to 2/4/8 black ops (Raid 0.15)
//     within +-0.04 of Raid 0.15 alone on the clear
//   skills: every 30s +0.01 +- 0.02, every 600s +0.06 +- 0.02, objective 'sum' +0.02 +- 0.02 (incumbent 120s, 'max')
//   city and chaos: Raid chaos guard 40 +0.01, 60 +0.23 +- 0.06 (incumbent 50)
//   the 8 sleeves (round 4, against i5 s3 with Raid 0.15, BN12.8/12.10 from both starts, seeds 601-616):
//     i6 s2 / i7 s1 / i8 / i6 f2 / i7 f1 -0.08..+0.09; i5 f3 / i5 g3 +0.04..+0.14; i4 s4 +0.06..+0.10;
//     i4 f4 +0.10..+0.17; i3 s5 +0.14..+0.29; i3 f5 +0.26..+0.41; i2 s6 +0.58..+0.88; i1 s7 ~+2.1 -> the
//     FLOOR OF FIVE INFILTRATORS SHIPPED (bbnodepolicy.fleetAllowOf: the live chooser held i3 s5 / i2 f6
//     in 3 of 5 clears; its exit model ranks every fleet within ~0.5h, i2 s6 beside i5 s3)
//   the gift: off +0.80 +- 0.02; charger 2048GB -0.07, 8192GB -0.16 +- 0.02 (the host's RAM is money: not priced here)
//   grafts: none +2.30 +- 0.03; orders on BB12_MONEY within 0.1h of each other (heart first -0.09,
//     legs first -0.07, SPTN first -0.01 vs the as-played landings): no order lever beyond the live chooser
//   the Simulacrum's gym beside the actions: every free slot -0.03 +- 0.02, none +0.16 +- 0.02
//   the hacknet's early rank exchanges: none +0.14 +- 0.02 (live already: hashspend.js)
//   training before acting: to 200 +0.12, agility to 300 +0.24 (worse: the actions train too)
// NOT CALIBRATED as ratios: no live clear played the arms; the base is --calib's.

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g0 from './nodechoice/game.mjs'
import { bladeLayoutFor } from './bbstanek.mjs'

const bp = await import('bbplan.js')
const sp = await import('../../stanekplan.js')
const gp = await import('goplan.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEL = process.env.TELEMETRY ?? [path.join(HERE, '../../.telemetry'), path.join(os.homedir(), 'Repos/bitburner-scripts/.telemetry')].find((d) => fs.existsSync(path.join(d, 'history.jsonl')))
const AT_H = [1, 2, 3]
const TYPHOON = 2500

/** BN12 segments of history.jsonl, keyed by the clear's label (BN12.<SF12 held + 1>). */
export function bn12SegmentsOf(file = path.join(TEL, 'history.jsonl')) {
  const segs = []
  let cur = null
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.includes('"bitNode":12')) {
      if (l) cur = null
      continue
    }
    let r
    try {
      r = JSON.parse(l)
    } catch {
      continue
    }
    if (r.bitNode !== 12) continue
    const sf = (r.sourceFiles?.data ?? []).slice().sort((a, b) => a[0] - b[0])
    const key = JSON.stringify(sf)
    if (!cur || cur.key !== key) {
      const held = sf.find((x) => x[0] === 12)?.[1] ?? 0
      cur = { key, label: `BN12.${held + 1}`, level: held + 1, sf, t0: r.totalPlaytime, rows: [] }
      segs.push(cur)
    }
    cur.rows.push({ h: (r.totalPlaytime - cur.t0) / 3.6e6, r })
  }
  return segs
}

const interp = (pts, H) => {
  // pts [{h, v}] ascending: v at H, linear between samples; null past the last
  let a = null
  for (const p of pts) {
    if (p.h >= H) return a ? a.v + ((p.v - a.v) * (H - a.h)) / Math.max(1e-9, p.h - a.h) : p.v
    a = p
  }
  return null
}
const crossing = (pts, X) => {
  let a = null
  for (const p of pts) {
    if (p.v >= X) return a ? a.h + ((X - a.v) * (p.h - a.h)) / Math.max(1e-9, p.v - a.v) : p.h
    a = p
  }
  return null
}
const minCombat = (s) => Math.min(s.strength, s.defense, s.dexterity, s.agility)

/** One clear's milestones and start state from its history segment (and its board row). */
export function clearOf(seg, board) {
  const rows = seg.rows
  const bbRows = rows.filter((x) => x.r.bladeburner && Number.isFinite(x.r.bladeburner.rank))
  const rank = bbRows.map((x) => ({ h: x.h, v: x.r.bladeburner.rank }))
  const join = bbRows[0]?.h ?? null
  const bo1 = bbRows.find((x) => (x.r.bladeburner.blackOpsDone ?? 0) >= 1)?.h ?? null
  const b = board?.clears?.find((c) => c.label === seg.label && c.done) ?? null
  // the fleet: the modal sleeve task mix from 0.6h to 4h
  const mixes = new Map()
  for (const x of rows.filter((x) => x.h >= 0.6 && x.h <= 4)) {
    const f = { infiltrate: 0, support: 0, fa: 0, gym: 0, other: 0 }
    for (const s of x.r.sleeves ?? []) {
      const t = s.task ?? ''
      if (t === 'INFILTRATE') f.infiltrate++
      else if (t === 'SUPPORT') f.support++
      else if (t.startsWith('BLADEBURNER:Field Analysis')) f.fa++
      else if (t.startsWith('CLASS')) f.gym++
      else f.other++
    }
    const k = JSON.stringify(f)
    mixes.set(k, (mixes.get(k) ?? 0) + 1)
  }
  const fleet = JSON.parse([...mixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '{"infiltrate":4,"support":4}')
  // the grafts as they landed: augmentations gained after the join that are not the Simulacrum / gift
  const grafts = []
  let have = new Set(rows[0].r.augmentations)
  for (const x of rows) {
    const now = new Set(x.r.augmentations)
    for (const a of now) if (!have.has(a) && !/Simulacrum|Stanek|NeuroFlux/.test(a)) grafts.push({ name: a, doneH: x.h })
    have = now
  }
  // the slot outside the grafts after the join: the class's share (the rest: crime, nothing)
  const after = rows.filter((x) => join !== null && x.h >= join && x.h <= (bo1 ?? 4))
  const notGraft = after.filter((x) => x.r.currentWork?.type !== 'GraftingWork')
  const gymDuty = notGraft.length ? notGraft.filter((x) => x.r.currentWork?.type === 'ClassWork').length / notGraft.length : 1
  // the biggest purchased (non-hacknet) host by 1h: the charger's host (stanek.js: the biggest host)
  const host = Math.max(64, ...rows.filter((x) => x.h <= 1.5).flatMap((x) => (x.r.purchasedServers ?? []).filter((p) => !p.hostname.startsWith('hacknet')).map((p) => p.ram)), ...rows.filter((x) => x.h <= 1.5).map((x) => x.r.home?.ram ?? 0))
  // THE HACKNET'S RANK EXCHANGES (+100 rank each, no node multiplier: HacknetHelpers.tsx:539-555) are not
  // recorded per clear; they show as ~100-rank jumps between two save samples (<= 6 min) while the
  // division runs a low-yield action (not Raid nor a black op, whose successes reach 100+ per sample) before
  // the first black op.
  // Counted there only, so a Raid-phase exchange is missed: a FLOOR on the exchanges the clear made.
  const hashBuys = []
  for (let i = 1; i < bbRows.length; i++) {
    const a = bbRows[i - 1]
    const b = bbRows[i]
    const dR = b.r.bladeburner.rank - a.r.bladeburner.rank
    if ((b.h - a.h) * 60 > 6.5 || /Raid|Black Op/.test(a.r.bladeburner.action ?? '') || (b.r.bladeburner.blackOpsDone ?? 0) > 0) continue
    for (let k = 0; k < Math.floor((dR + 20) / 100); k++) hashBuys.push({ tH: +b.h.toFixed(3), kind: 'rank' })
  }
  const hk = rows.filter((x) => x.h >= 1 && x.h <= 3).map((x) => x.r.skills.hacking).sort((a, b) => a - b)
  const go = b?.go?.np?.Tetrads && b.go.hoursIn > 0 ? b.go.np.Tetrads / b.go.hoursIn : null
  const combat = AT_H.map((H) => interp(rows.map((x) => ({ h: x.h, v: minCombat(x.r.skills) })), H))
  const agility = AT_H.map((H) => interp(rows.map((x) => ({ h: x.h, v: x.r.skills.agility })), H))
  return {
    label: seg.label, level: seg.level, sf: seg.sf, int: rows.at(-1).r.skills.intelligence, hack: hk[hk.length >> 1] ?? 300,
    live: { join, rankAt: AT_H.map((H) => interp(rank, H)), r2500: crossing(rank, TYPHOON), bo1, exit: b?.activeH ?? null, combat, agility },
    // the levels at the join (the first sample with a division): the opening's crime and gym past the bar
    start: { fleet, grafts, hashBuys, gymDuty, hostGb: host, goPerH: go, joinStats: bbRows[0] ? Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma'].map((k) => [k, bbRows[0].r.skills[k]])) : null },
  }
}

/** The clears as played: BN12.2-12.6 (BN12.1 took the hacking route; BN12.7 a route bug, 67cd0ee). */
export function clearsOf() {
  const board = JSON.parse(fs.readFileSync(path.join(TEL, 'bn12-board.json'), 'utf8'))
  return bn12SegmentsOf().filter((s) => s.rows.length > 30 && /^BN12\.[2-6]$/.test(s.label)).map((s) => clearOf(s, board))
}

/** BN12's gift grid at level L and SF13.l13 (the game's own multipliers at that level). */
export function bn12GridOf(level, l13) {
  const m = g0.getBitNodeMultipliers(12, level)
  const { width, height } = sp.giftSize(m.StaneksGiftExtraSize ?? 0, l13)
  return { width, height, nodePower: m.StaneksGiftPowerMultiplier ?? 1 }
}

/** The bbsim spec of a job: {level, sf, int, hack, seed, start, arm, maxH}. */
export function specOf(j) {
  const st = j.start
  const arm = j.arm ?? {}
  const fleet = arm.fleet ?? st.fleet
  const policy = {
    shared: true,
    sharedPolicy: { ...bp.POLICY, ...(arm.sharedPolicy ?? {}) },
    sleeves: { infiltrate: fleet.infiltrate ?? 0, support: fleet.support ?? 0, fa: fleet.fa ?? 0, gym: fleet.gym ?? 0, ...(fleet.gymStats ? { gymStats: fleet.gymStats } : {}) },
    gymTo: 100,
    useEst: false,
    ...(st.gymDuty < 1 ? { gymDuty: st.gymDuty } : {}),
    ...(arm.policy ?? {}),
  }
  const spec = { node: 12, level: j.level, sf: j.sf, g: 0, installEveryH: null, intelligence: j.int, hacking: j.hack, seed: j.seed, maxH: j.maxH ?? 30, policy }
  if (st.goPerH > 0 && arm.go !== false) spec.go = { perHour: Math.round(st.goPerH), power: gp.OPPONENTS.Tetrads.power, goPower: g0.getBitNodeMultipliers(12, j.level).GoPower ?? 1, sf14: 1 }
  if (st.preJoinDuty < 1) spec.preJoinDuty = st.preJoinDuty
  if (st.joinStats && arm.joinStats !== false) spec.joinStats = st.joinStats
  if (st.hashBuys?.length && arm.hashBuys !== false) spec.hashBuys = st.hashBuys
  // grafts: the measured landings (st.grafts, doneAtH) or an arm's ORDER (names) on a money model
  // (arm.money {wealth, perH, fromH}: what the clear could spend from fromH on — ASSUMED, the same for
  // every order of one comparison; BN12.6 as played fits ~$1e9 at 0.5h + $1.1e10/h, see BB12_MONEY)
  const grafts = arm.grafts ?? st.grafts
  if (grafts?.length && typeof grafts[0] === 'string') spec.grafts = { schedule: grafts, wealth: arm.money?.wealth ?? 1e30, moneyPerH: arm.money?.perH ?? 0, fromS: (arm.money?.fromH ?? 0) * 3600 }
  else if (grafts?.length) spec.grafts = { schedule: grafts.map((x) => x.name), wealth: 1e30, moneyPerH: 0, ...(grafts.every((x) => Number.isFinite(x.doneH)) ? { doneAtH: grafts.map((x) => x.doneH) } : {}) }
  if (arm.gift !== false) {
    const l13 = new Map(j.sf).get(13) ?? 0
    const lay = bladeLayoutFor(bn12GridOf(j.level, l13), 1e5)
    spec.stanek = { placed: lay.placed, chargeAt: sp.bladeChargeAt({ gbMax: arm.hostGb ?? st.hostGb, cores: 1, k: sp.chargeRootsOf(lay.placed).length }) }
  }
  return { ...spec, ...(arm.spec ?? {}) }
}

/** One run: the milestones the measurement reads. */
export function runOne(j) {
  const spec = specOf(j)
  const pts = []
  const cpts = []
  let bo1 = null
  let next = 0
  const onStep = ({ t, P, bb }) => {
    if (bo1 === null && bb.numBlackOpsComplete >= 1) bo1 = t / 3600
    if (t < next) return
    next = t + 120
    pts.push({ h: t / 3600, v: bb.rank })
    cpts.push({ h: t / 3600, v: minCombat(P.skills), a: P.skills.agility })
  }
  const r = runBladeburner({ ...spec, onStep })
  return {
    hours: r.hours ?? null, join: r.joinH, bo1,
    rankAt: AT_H.map((H) => interp(pts, H)), r2500: crossing(pts, TYPHOON),
    combat: AT_H.map((H) => interp(cpts, H)), agility: AT_H.map((H) => interp(cpts.map((x) => ({ h: x.h, v: x.a })), H)),
    why: r.why ?? null, grafts: r.grafts?.done?.map((x) => `${x.name.slice(0, 12)}@${x.endH}`) ?? null, skills: r.skills,
  }
}

export async function runAll(list, jobs) {
  const out = new Array(list.length)
  const chunks = Array.from({ length: jobs }, () => [])
  list.forEach((j, i) => chunks[i % jobs].push([i, j]))
  await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((res, rej) => {
    const w = fork(fileURLToPath(import.meta.url), ['--worker'], { execArgv: ['--max-old-space-size=2048'] })
    w.on('message', (m) => {
      if (m.done) return w.kill(), res()
      out[m.i] = m.r
    })
    w.on('exit', (code) => (code ? rej(new Error(`worker exited ${code}`)) : res()))
    w.send(c)
  })))
  return out
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const seOf = (xs) => (xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN)
export const med = (xs) => {
  const a = xs.filter((x) => x !== null && Number.isFinite(x)).sort((p, q) => p - q)
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null
}
const f2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '     -  ' : x.toFixed(x >= 100 ? 0 : 2).padStart(8))
const err = (m, l) => (m === null || l === null || !(l > 0) ? '     -' : `${(((m - l) / l) * 100).toFixed(0)}%`.padStart(6))

/** Fix the opening: preJoinDuty <- duty x model join / live join (three fixed-point steps; gym-only opening). */
async function fixJoin(cases, jobs) {
  cases.forEach((c) => (c.start.preJoinDuty = 1))
  for (let it = 0; it < 3; it++) {
    const rs = await runAll(cases.map((c) => ({ ...c, seed: 1, maxH: 0.01 })), jobs)
    cases.forEach((c, i) => (c.start.preJoinDuty = Math.min(1, c.start.preJoinDuty * (rs[i].join / c.live.join))))
  }
}

export async function calib({ seeds, jobs, arm = {}, quiet = false }) {
  const cases = clearsOf()
  await fixJoin(cases, jobs)
  const rs = await runAll(cases.flatMap((c) => seeds.map((seed) => ({ ...c, seed, arm }))), jobs)
  const out = []
  if (!quiet) {
    console.log(`CALIBRATION (bbsim vs BN12.2-12.6 as played; median of ${seeds.length} seeds; err = (model - live) / live)`)
    for (const c of cases) console.log(`  ${c.label}: fleet ${JSON.stringify(c.start.fleet)} gymDuty ${c.start.gymDuty.toFixed(2)} preJoinDuty ${c.start.preJoinDuty.toFixed(2)} host ${c.start.hostGb}GB go ${Math.round(c.start.goPerH ?? 0)}/h hack ${c.hack} int ${c.int} rank exchanges ${c.start.hashBuys.map((x) => x.tH.toFixed(2)).join(' ')} grafts ${c.start.grafts.map((x) => `${x.name.slice(0, 12)}@${x.doneH.toFixed(2)}`).join(', ')}`)
    console.log('clear    quantity          live    model    err')
  }
  cases.forEach((c, i) => {
    const R = rs.slice(i * seeds.length, (i + 1) * seeds.length)
    const q = (f) => med(R.map(f))
    const rows = [
      ['join h', c.live.join, q((r) => r.join)],
      ...AT_H.map((H, k) => [`rank @${H}h`, c.live.rankAt[k], q((r) => r.rankAt[k])]),
      ['rank 2500 h', c.live.r2500, q((r) => r.r2500)],
      ['1st black op h', c.live.bo1, q((r) => r.bo1)],
      ['clear h', c.live.exit, q((r) => r.hours)],
      ...AT_H.map((H, k) => [`combat @${H}h`, c.live.combat[k], q((r) => r.combat[k])]),
      ...AT_H.map((H, k) => [`agility @${H}h`, c.live.agility[k], q((r) => r.agility[k])]),
    ]
    if (!quiet) for (const [k, l, m] of rows) console.log(`${c.label.padEnd(8)} ${k.padEnd(15)} ${f2(l)} ${f2(m)} ${err(m, l)}`)
    out.push({ label: c.label, rows, R })
  })
  if (!quiet) {
    // the summary the decision rides on: ln(model / live) over the clears, per milestone
    for (const k of ['rank 2500 h', '1st black op h', 'clear h']) {
      const e = out.map((o) => o.rows.find((r) => r[0] === k)).filter((r) => r[1] > 0 && r[2] > 0).map((r) => Math.log(r[2] / r[1]))
      console.log(`SUMMARY ${k.padEnd(15)} mean ln(model/live) ${mean(e).toFixed(3)}  RMS ${Math.sqrt(mean(e.map((x) => x * x))).toFixed(3)}  (n ${e.length})`)
    }
  }
  return { cases, out }
}

// ---------------------------------------------------------------------------------------------------
// THE CELLS: the next clears as they will be entered — BN12.L with SF12.(L-1), the rest of the SF set
// as held (every other at 3), intelligence and hacking as BN12.6 had them, its start state (fleet,
// grafts, duty, host, Go) as the incumbent; the levers move one thing each.
const SF_REST = [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [13, 3], [14, 3], [15, 3]]
export const cellOf = (level, base) => ({ ...base, label: `BN12.${level}`, level, sf: [...SF_REST, [12, level - 1]].sort((a, b) => a[0] - b[0]) })

export async function levers({ cells, seeds, jobs, arms, base }) {
  const res = {}
  for (const L of cells) {
    const c = cellOf(L, base)
    const list = arms.flatMap((a) => seeds.map((seed) => ({ ...c, seed, arm: a.arm, maxH: 30 })))
    const rs = await runAll(list, jobs)
    const R = arms.map((_, i) => rs.slice(i * seeds.length, (i + 1) * seeds.length))
    console.log(`\n${c.label}: ${seeds.length} paired seeds; d = arm - incumbent (h)`)
    console.log('arm                                         clear h  d clear          1st BO h  d 1st BO        r2500 h  d r2500')
    res[L] = []
    for (let i = 0; i < arms.length; i++) {
      const dd = (k) => {
        const d = R[i].map((r, j) => (r?.[k] ?? Infinity) - (R[0][j]?.[k] ?? Infinity)).filter(Number.isFinite)
        return d.length ? { m: mean(d), se: seOf(d), n: d.length } : null
      }
      const fm = (x) => (x ? `${x.m >= 0 ? '+' : ''}${x.m.toFixed(2)} +- ${x.se.toFixed(2)}` : '-')
      const mh = (k) => {
        const x = R[i].map((r) => r?.[k]).filter((v) => v !== null && v !== undefined && Number.isFinite(v))
        return x.length ? mean(x).toFixed(2) : '-'
      }
      const bad = R[i].filter((r) => !(r?.hours > 0)).length
      const row = { name: arms[i].name, clear: dd('hours'), bo1: dd('bo1'), r2500: dd('r2500'), meanClear: +mh('hours'), bad }
      res[L].push(row)
      console.log(`${arms[i].name.padEnd(43)} ${mh('hours').padStart(6)}  ${fm(row.clear).padEnd(15)} ${mh('bo1').padStart(6)}  ${fm(row.bo1).padEnd(15)} ${mh('r2500').padStart(6)}  ${fm(row.r2500)}${bad ? `  (${bad} unfinished)` : ''}`)
    }
  }
  return res
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const seeds = Array.from({ length: +opt('seeds', 8) }, (_, i) => i + +opt('seed0', 1))
  const jobs = +opt('jobs', 2)
  if (args.includes('--calib')) await calib({ seeds, jobs, arm: JSON.parse(opt('arm', '{}')) })
  if (args.includes('--levers')) {
    const { cases } = await calib({ seeds: [1], jobs, quiet: true })
    const base = cases.find((c) => c.label === opt('base', 'BN12.6'))
    const { SETS } = await import('./bb12arms.mjs')
    const set = SETS[opt('set', 'levers')]
    if (!set) throw new Error(`bb12: no arm set '${opt('set')}' (${Object.keys(SETS).join(', ')})`)
    await levers({ cells: opt('cells', '8').split(',').map(Number), seeds, jobs, arms: set(base), base })
  }
}

if (process.argv.includes('--worker')) {
  process.on('message', (chunk) => {
    for (const [i, j] of chunk) {
      let r
      try {
        r = runOne(j)
      } catch (e) {
        r = { hours: null, why: String(e?.stack ?? e).slice(0, 400) }
      }
      process.send({ i, r })
    }
    process.send({ done: true })
  })
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
  process.exit(0)
}
