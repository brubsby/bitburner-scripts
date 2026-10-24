// THE BLADEBURNER BOOTSTRAP — node start to the first black op, calibrated and its levers priced.
//
//   node tools/sim/bbboot.mjs --calib [--seeds 8 --jobs 6]            bbsim's early phase vs the clean nodes
//   node tools/sim/bbboot.mjs --levers [--node 13 --seeds 24 --jobs 6] every early lever, paired seeds
//
// THE MEASUREMENT (history.jsonl, the save digest every ~5 min; node hours on the game's totalPlaytime
// clock): combat 100 (the division's gate), the Bladeburners faction joined (rank 25,
// Bladeburner.ts:1253 RankNeededForFaction), the faction's reputation / 2 at 1/2/3/4h and when it
// passes 5000 (rank ~2.5k: the first black op's reqdRank). Reputation is the gross positive rank x
// faction_rep (Bladeburner.ts:1276-1281 changeRank: losses do not take it back; Formulas.ts:46-49), so
// the comparison is rep against rep — bbsim keeps the game's faction, which earns it the same way.
//
// THE MODEL (bbsim: the game's Bladeburner, Player, Sleeve and StaneksGift classes, bbplan's shared
// POLICY deciding) from the node's start with what each clean node HAD: its Source-Files and
// intelligence (the save), SF7.3's Simulacrum at the join, the gift (Genesis + the Bladeburner layout,
// stanekplan.BLADE_HOST's measured charger), the Go farm, and the fleet the node ran.
//
// THE LEVERS (CLAUDE.md "Decisions compare simulated trajectories"): every arm is bbsim to the 21st
// black op on the same seeds, differing only in the lever; the decision is withH - withoutH, paired.
// NOT CALIBRATED: the levers' ratios (no live node ran them); the base is calibrated by --calib, printed.
//
// CALIBRATION 2026-10-24 (--calib, 8 seeds, start state fixed to each node's measured opening and the
// live charger CHARGER): combat 100 and the faction join within 10% except BN3.4's join (live 0.50h,
// model 0.83h); combat at 1-4h -13..+15%; rep/2 at 4h BN3.3 -23%, BN11.3 -8%, BN3.4 -71%, BN13.2 -68%,
// BN13.3 -56%; BN13.3's live rank at 4.87h 2899 vs 2129 (-27%, its hash exchanges replayed). The model
// is SLOW in BN13 (and BN3.4) after ~2.5h — the levers are priced relative to it (paired), and their
// hours are a lower bound where the model's bootstrap is too long. Two inputs were wrong and are fixed:
// the charger (H 128 -> 400 live: combat -10%) and the opening (gym alone vs the live crime share).
//
// THE LEVERS 2026-10-24 (DEFAULT_ARMS, fresh seeds 501-540, d exit hours; BN5.2 / BN2.2 / BN13.3 with
// the gift; [BN5.2 / BN13.3 without it]):
//   the bootstrap policy, POLICY.boot* (0.15, Raid 0.25, 120s)  -0.37 / -0.73 / +0.06  [-0.72 / -1.17]  shipped
//     (1st black op -0.51 / -0.86 / -0.61); Raid at 0.15 too -0.59 / -0.86 / -0.19 [-1.10 / +2.59 +- 0.89];
//     Raid at minP -0.09 / -0.37 / +0.15; the bars without the cadence -0.18 / -0.59 / -0.18
//   hash exchanges, BN13.3's 6 rank + 4 SP over 1.5-4.8h          -0.05 / -0.16 / -0.41  [-0.50 / -2.68]  live already (hashspend.js)
//   the body slot lent 29% of the time after the join (BN13.3)   +0.19 / -0.03 / +0.63  [+0.19 / -0.33]  progress.js's slot: not this file's
//   the gift (off)                                                +2.02 / +1.15 / +12.5                    live already
// Earlier rounds (seeds 1-48, 401-432) picked the bars and the cadence and found the boot must end at the
// first black op's RANK, not the op (the priced rule holds a rank-gated op: BN13 without the gift booted ~20h).
// seeds 1-48: sleeve fleets (i8, s8, f8, i1s7, i2s2f4, i4f4, i2s2g4) all >= i4s4 (+0.2..+40h); training
// (agility / agi+dex beside the actions, all to 200 before acting) +0.03..+1.3h; rest bands 0.5-0.7 /
// 0.5-0.85 / 0.6-1.0 -0.09..+1.2h — none wins. Not searched here: sleeve gym transfer early (shock 100
// -> Work.ts shockBonus 0: no transfer), sleeve contracts (stats ~1, shocked), grafts (money-bound in
// the first hours: tools/sim/bbgraft.mjs prices them), Stanek's phase layout (stanekphase.mjs: <= 0.07h).

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g0 from './nodechoice/game.mjs'
import { bladeGoOf } from './gameplan/go.mjs'
import { nodeMults } from './nodechoice/hackexit.mjs'
import { gridOf, bladeLayoutFor } from './bbstanek.mjs'

const bp = await import('bbplan.js')
const sp = await import('../../stanekplan.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEL = process.env.TELEMETRY ?? [path.join(HERE, '../../.telemetry'), path.join(os.homedir(), 'Repos/bitburner-scripts/.telemetry')].find((d) => fs.existsSync(path.join(d, 'history.jsonl')))

/**
 * THE CLEAN BLADEBURNER NODES (history.jsonl, 2026-10-22/23): the SF set held on entry (the save),
 * intelligence, the Go farm's Tetrads rate as BLADE_GO, the fleet the node ran. MEASURED: combat 100,
 * faction join, rep/2 at 1..4h and rep 5000 — read from history.jsonl by `measuredOf`, never typed in.
 */
export const CLEAN = [
  { name: 'BN3.3', node: 3, sfKey: '[3,2]', int: 154, hack: 180, sleeves: 8 },
  { name: 'BN3.4', node: 3, sfKey: '[3,3]', int: 155, hack: 180, sleeves: 8 },
  { name: 'BN11.3', node: 11, sfKey: '[11,2]', int: 155, hack: 170, sleeves: 8 },
  { name: 'BN13.2', node: 13, sfKey: '[13,1]', int: 155, hack: 65, sleeves: 8 },
  // in progress (2026-10-24): its live RANK at its age is checked too (bladeburner.txt)
  { name: 'BN13.3', node: 13, sfKey: '[13,2]', int: 156, hack: 70, sleeves: 8, partial: true },
]
const AT_H = [1, 2, 3, 4]

/** Every node segment of history.jsonl: {name, node, sf, rows: [{h, skills, rep, factions}]}. */
export function segmentsOf(file = path.join(TEL, 'history.jsonl')) {
  const segs = []
  let prev = null
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue
    let r
    try {
      r = JSON.parse(l)
    } catch {
      continue
    }
    const sf = (r.sourceFiles?.data ?? []).slice().sort((a, b) => a[0] - b[0])
    const key = `${r.bitNode}|${JSON.stringify(sf)}`
    if (!prev || prev.key !== key) {
      const held = sf.find((x) => x[0] === r.bitNode)?.[1] ?? 0
      prev = { key, node: r.bitNode, name: `BN${r.bitNode}.${held + 1}`, sfKey: `[${r.bitNode},${held}]`, sf, t0: r.totalPlaytime, rows: [] }
      segs.push(prev)
    }
    prev.rows.push({ h: (r.totalPlaytime - prev.t0) / 3.6e6, skills: r.skills, rep: r.factionRep?.Bladeburners?.rep ?? 0, faction: (r.factions ?? []).includes('Bladeburners'), work: r.currentWork?.type ?? null, at: r.at })
  }
  return segs
}

/** The bootstrap milestones of one node's rows (or one bbsim run's samples): hours, null when not reached. */
export function milestonesOf(rows) {
  const first = (f) => rows.find(f)?.h ?? null
  const at = (H) => {
    let b = null
    for (const r of rows) if (r.h <= H + 1e-9) b = r
    return b ? b.rep / 2 : null
  }
  return {
    combat100: first((r) => ['strength', 'defense', 'dexterity', 'agility'].every((k) => r.skills[k] >= 100)),
    faction: first((r) => r.faction),
    rep5k: first((r) => r.rep >= 5000),
    repAt: AT_H.map(at),
    // the lowest combat level at each hour: the stat path (gym + actions) the rank rides on
    combatAt: AT_H.map((H) => {
      let b = null
      for (const r of rows) if (r.h <= H + 1e-9) b = r
      return b ? Math.min(b.skills.strength, b.skills.defense, b.skills.dexterity, b.skills.agility) : null
    }),
  }
}

export function measuredOf(c, segs) {
  const s = segs.find((x) => x.node === c.node && x.sfKey === c.sfKey)
  if (!s) throw new Error(`bbboot: no history segment for ${c.name} (${c.sfKey})`)
  const m = milestonesOf(s.rows)
  // THE BODY SLOT AFTER THE JOIN (the start state bbsim's pol.gymDuty takes): the share of the save
  // samples from combat 100 to 4h whose work is the gym class (the rest: faction work, crime)
  const after = s.rows.filter((r) => m.combat100 !== null && r.h >= m.combat100 && r.h <= 4)
  const classShare = after.length ? after.filter((r) => r.work === 'ClassWork').length / after.length : null
  return { sf: s.sf, ageH: s.rows.at(-1).h, lastAt: s.rows.at(-1).at, ...m, classShare }
}

/**
 * The fleet arms: `{infiltrate, support, fa, gym, contracts}` — bbsim's mixes. THE INCUMBENT is the
 * live chooser's mid-phase pick for 8 sleeves (sleeve.txt BN13.3: i4 s4).
 */
export const INCUMBENT_FLEET = { infiltrate: 4, support: 4, fa: 0 }

/** One clean node's bbsim spec (the live inputs) + an arm's fields. */
export function specOf({ node, level = 1, sf, int, hack, seed, arm = {}, maxH = 80 }) {
  const fleet = arm.fleet ?? INCUMBENT_FLEET
  const go = bladeGoOf(nodeMults(node).GoPower, 3)
  const policy = {
    shared: true,
    sharedPolicy: { ...bp.POLICY, ...(arm.sharedPolicy ?? {}) },
    sleeves: { infiltrate: fleet.infiltrate ?? 0, support: fleet.support ?? 0, fa: fleet.fa ?? 0, gym: fleet.gym ?? 0, ...(fleet.gymStats ? { gymStats: fleet.gymStats } : {}) },
    gymTo: 100,
    useEst: false,
    ...(arm.train ? { train: arm.train } : {}),
    ...(arm.policy ?? {}),
  }
  return { node, level, sf, g: 0, installEveryH: null, intelligence: int, hacking: hack, seed, maxH, policy, go, ...(arm.spec ?? {}) }
}

/**
 * THE CHARGER the gift runs on: live BN13.3 stanek.txt 2026-10-24T02:46Z — charge.js 256 threads
 * (512GB) on the 10-core 'blade' host, H 400 (the 9-core helios of BLADE_HOST.measured gave H 192 and
 * the grid's ramp at 1 core H 128: the model's combat ran ~10% low against the live node, --calib).
 * The host's ramp to it is stanekplan.BLADE_HOST's (128GB -> top over 4h).
 */
export const CHARGER = { gb: 512, cores: 10, at: 'BN13.3 stanek.txt 2026-10-24T02:46Z (blade: 256 threads, 10 cores, H 400)' }

/** One run: the spec, the gift, the samples every 0.05h -> milestones, the first black op, the exit. */
export function runOne(job) {
  const spec = specOf(job)
  const l13 = new Map(job.sf).get(13) ?? 0
  if (job.arm?.gift !== false && l13 >= 0) {
    const gr = gridOf(job.node, Math.max(1, l13))
    const lay = bladeLayoutFor(gr, 1e5)
    const ch = job.charger ?? CHARGER
    spec.stanek = { placed: lay.placed, chargeAt: sp.bladeChargeAt({ gbMax: ch.gb, cores: ch.cores, k: sp.chargeRootsOf(lay.placed).length }) }
  }
  const rows = []
  let nextS = 0
  let bo1 = null
  const onStep = ({ t, P, bb }) => {
    if (bo1 === null && bb.numBlackOpsComplete >= 1) bo1 = t / 3600
    if (t < nextS) return
    nextS = t + 180
    rows.push({ h: t / 3600, skills: { ...P.skills }, rep: g0.Factions.Bladeburners.playerReputation, faction: g0.Factions.Bladeburners.isMember, rank: bb.rank })
  }
  // (the pre-join gym, bbsim's join loop, has no onStep: the samples start at the join)
  const r = runBladeburner({ ...spec, onStep })
  const m = milestonesOf([{ h: 0, skills: { strength: 1, defense: 1, dexterity: 1, agility: 1 }, rep: 0, faction: false }, ...rows])
  // rank every 5 min of node time (index = round(h x 12)): the in-progress node's live rank is checked on it
  const rankAt5 = []
  for (let k = 0, j = 0; k <= 12 * 12; k++) {
    while (j + 1 < rows.length && rows[j + 1].h <= k / 12) j++
    rankAt5.push(rows.length && rows[j].h <= k / 12 ? rows[j].rank : 0)
  }
  return { hours: r.hours ?? null, joinH: r.joinH, bo1, ...m, rankAt: AT_H.map((H) => rows.filter((x) => x.h <= H).at(-1)?.rank ?? null), rankAt5 }
}

/** Run jobs across `jobs` worker processes (bbsim holds game module state: one run per process at a time). */
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
const med = (xs) => {
  const a = xs.filter((x) => x !== null && Number.isFinite(x)).sort((p, q) => p - q)
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null
}
const f2 = (x) => (x === null || x === undefined ? '   -  ' : x.toFixed(2).padStart(6))
const err = (m, l) => (m === null || l === null || !(l > 0) ? '   -  ' : `${(((m - l) / l) * 100).toFixed(0)}%`.padStart(6))

async function calib({ seeds, jobs, arm = {}, fixStart = true }) {
  const segs = segmentsOf()
  const cases = CLEAN.map((c) => ({ ...c, live: measuredOf(c, segs) }))
  const base = (c, seed, extra = {}) => ({ node: c.node, level: +c.name.split('.')[1], sf: c.live.sf, int: c.int, hack: c.hack, seed, arm, maxH: 30, ...extra })
  // THE START STATE (fixStart): the model's opening is the gym alone, money unbound; the live
  // openings split the slot with crime for the fees. The pre-join gym share is the pure-gym join
  // time over the measured combat-100 time (one deterministic pass: no roll before the join), and
  // the post-join class share is measured (classShare).
  // (the gift's charge and the Go farm grow with time, so the join is not linear in the duty: three
  // fixed-point steps duty <- duty x model join / live combat 100)
  cases.forEach((c) => (c.start = { preJoinDuty: 1, gymDuty: fixStart ? (c.live.classShare ?? 1) : 1 }))
  for (let it = 0; fixStart && it < 3; it++) {
    const pure = await runAll(cases.map((c) => base(c, 1, { maxH: 0.01, arm: { ...arm, spec: { preJoinDuty: c.start.preJoinDuty } } })), jobs)
    cases.forEach((c, i) => (c.start.preJoinDuty = Math.min(1, c.start.preJoinDuty * (pure[i].joinH / c.live.combat100))))
  }
  // the node in progress: its hacknet's exchanges (hashspend.txt exchangeLevels, this node and life)
  for (const c of cases.filter((x) => x.partial)) {
    try {
      const hs = JSON.parse(fs.readFileSync(path.join(TEL, 'hashspend.txt'), 'utf8'))
      if (hs.bitNode === c.node && hs.exchangeLevels) {
        const toH = c.live.ageH + (Date.parse(hs.at) - Date.parse(c.live.lastAt)) / 3.6e6
        c.start.hashBuys = hashScheduleOf({ ...hs.exchangeLevels, fromH: c.live.combat100, toH })
        c.start.hashWhy = `hashspend.txt rank ${hs.exchangeLevels.rank} sp ${hs.exchangeLevels.sp} by ${toH.toFixed(2)}h`
      }
    } catch {}
  }
  const list = cases.flatMap((c) => seeds.map((seed) => ({ ...base(c, seed), arm: { ...arm, spec: { ...(arm.spec ?? {}), ...(c.start.preJoinDuty < 1 ? { preJoinDuty: c.start.preJoinDuty } : {}), ...(fixStart && c.start.hashBuys ? { hashBuys: c.start.hashBuys } : {}) }, policy: { ...(arm.policy ?? {}), ...(c.start.gymDuty < 1 ? { gymDuty: c.start.gymDuty } : {}) } } })))
  const rs = await runAll(list, jobs)
  console.log(`CALIBRATION (bbsim early phase vs history.jsonl; median of ${seeds.length} seeds; err = (model - live) / live; rep/2 is the faction's reputation / 2 on both sides)`)
  console.log(`start state: ${fixStart ? 'FIXED to the measured opening (preJoinDuty = pure-gym join / live combat 100; gymDuty = live class share after the join)' : "the model's own (gym alone from t 0, the class beside every action)"}`)
  for (const c of cases) console.log(`  ${c.name}: ${fixStart ? `preJoinDuty ${c.start.preJoinDuty.toFixed(2)} gymDuty ${c.start.gymDuty.toFixed(2)}${c.start.hashBuys ? `; hash exchanges ${c.start.hashWhy}` : '; hash exchanges: not recorded (none modelled)'}` : `live class share after the join ${c.live.classShare?.toFixed(2)}`}`)
  console.log('node      quantity        live   model    err')
  const out = []
  cases.forEach((c, i) => {
    const R = rs.slice(i * seeds.length, (i + 1) * seeds.length)
    const q = (k) => med(R.map((r) => r[k]))
    const rows = [
      ['combat 100 h', c.live.combat100, q('combat100')],
      ['faction h', c.live.faction, q('faction')],
      ['rep 5000 h', c.live.rep5k, q('rep5k')],
      ...AT_H.map((H, j) => [`rep/2 @${H}h`, c.live.repAt[j], med(R.map((r) => r.repAt[j]))]),
      ...AT_H.map((H, j) => [`combat @${H}h`, c.live.combatAt[j], med(R.map((r) => r.combatAt[j]))]),
      ['1st black op h', null, q('bo1')],
      ['exit h', null, q('hours')],
    ]
    if (c.partial) {
      // the node in progress: its live rank now (bladeburner.txt, this node and life) vs the model's at that age
      try {
        const bt = JSON.parse(fs.readFileSync(path.join(TEL, 'bladeburner.txt'), 'utf8'))
        if (bt.bitNode === c.node && Number.isFinite(bt.rank)) {
          // the age on the game's clock at the last save sample, plus the wall time to the daemon's record
          const ageH = c.live.ageH + (Date.parse(bt.at) - Date.parse(c.live.lastAt)) / 3.6e6
          rows.push([`rank @${ageH.toFixed(2)}h`, bt.rank, med(R.map((r) => r.rankAt5[Math.min(r.rankAt5.length - 1, Math.round(ageH * 12))]))])
        }
      } catch (e) {
        rows.push([`rank (live unreadable: ${String(e.message).slice(0, 40)})`, null, null])
      }
    }
    for (const [k, l, m] of rows) console.log(`${c.name.padEnd(9)} ${k.padEnd(14)} ${f2(l)} ${f2(m)} ${err(m, l)}`)
    out.push({ name: c.name, rows })
  })
  return out
}

/**
 * THE CELLS the levers are priced on: the remaining Bladeburner nodes as they will be entered —
 * the SF set BN13.3 holds now plus what BN13.3 gives (SF13.3), the live intelligence, 8 sleeves.
 */
const SF_NOW = [[1, 3], [2, 1], [3, 3], [4, 3], [5, 1], [6, 3], [7, 3], [8, 1], [9, 3], [10, 3], [11, 3], [12, 1], [13, 3], [14, 3]]
export const CELLS = {
  'BN5.2': { node: 5, level: 2, sf: SF_NOW, int: 156, hack: 150 },
  'BN2.2': { node: 2, level: 2, sf: SF_NOW, int: 156, hack: 150 },
  'BN13.3': { node: 13, level: 3, sf: SF_NOW.map(([n, l]) => [n, n === 13 ? 2 : l]), int: 156, hack: 70 },
  // THE STRESS CELL: BN13 without the gift — the slowest bootstrap (~20h to rank 2.5k), where a boot
  // phase's side effects (the Raids' population and chaos) have the longest to act
  'BN5.2-nogift': { node: 5, level: 2, sf: SF_NOW, int: 156, hack: 150, gift: false, maxH: 80 },
  'BN13.3-nogift': { node: 13, level: 3, sf: SF_NOW.map(([n, l]) => [n, n === 13 ? 2 : l]), int: 156, hack: 70, gift: false, maxH: 160 },
}

/**
 * THE HACKNET'S EXCHANGES as a schedule (bbsim o.hashBuys) from the live levels at an age: the levels
 * bought cheapest-next (250 x level each, HashUpgradesMetadata.tsx:90-107), placed where a production
 * ramping linearly from `fromH` (the join) has paid their cumulative cost, the last at `toH`. ASSUMED
 * shape (the hash rate's history is not recorded); the levels and their end time are measured.
 */
export function hashScheduleOf({ rank = 0, sp = 0, fromH, toH }) {
  const buys = []
  let r = 0
  let s = 0
  while (r < rank || s < sp) {
    const kind = r < rank && (s >= sp || r <= s) ? 'rank' : 'sp'
    if (kind === 'rank') r++
    else s++
    buys.push({ kind, cost: 250 * (kind === 'rank' ? r : s) })
  }
  const total = buys.reduce((a, b) => a + b.cost, 0)
  let cum = 0
  return buys.map((b) => {
    cum += b.cost
    return { kind: b.kind, tH: fromH + (toH - fromH) * Math.sqrt(cum / total) }
  })
}

/** The bootstrap policy off (POLICY carries it): the incumbent every arm is paired against. */
const BOOT_OFF = { bootMinP: null, bootRaidMinP: null, bootSkillEveryS: null }
/** BN13.3's exchanges (6 rank + 4 SP by 4.8h) spread over 1.5-4.8h: the hash lever's arm. */
const HASH_BN13_3 = hashScheduleOf({ rank: 6, sp: 4, fromH: 1.5, toH: 4.8 })
/** The levers of the 2026-10-24 table (header), each paired against the first. */
export const DEFAULT_ARMS = [
  { name: 'incumbent (no bootstrap policy)', arm: { sharedPolicy: BOOT_OFF } },
  { name: 'POLICY (0.15, Raid 0.25, 120s)', arm: {} },
  { name: 'Raid 0.15 too', arm: { sharedPolicy: { bootRaidMinP: null } } },
  { name: 'Raid 0.4 (minP)', arm: { sharedPolicy: { bootRaidMinP: 0.4 } } },
  { name: 'bars only (no 120s)', arm: { sharedPolicy: { bootSkillEveryS: null } } },
  { name: 'skills 120s only', arm: { sharedPolicy: { ...BOOT_OFF, bootSkillEveryS: 120 } } },
  { name: 'hash exchanges as BN13.3', arm: { sharedPolicy: BOOT_OFF, spec: { hashBuys: HASH_BN13_3 } } },
  { name: 'body slot lent 29% (BN13.3)', arm: { sharedPolicy: BOOT_OFF, policy: { gymDuty: 0.71 } } },
  { name: 'no gift', arm: { sharedPolicy: BOOT_OFF, gift: false } },
]

/** Each arm against the first (the incumbent) on the same seeds: d = arm - incumbent, per seed, mean +- se. */
async function levers({ cells, seeds, jobs, arms }) {
  for (const name of cells) {
    const c = CELLS[name]
    const list = arms.flatMap((a) => seeds.map((seed) => ({ ...c, seed, arm: c.gift === false ? { ...a.arm, gift: false } : a.arm, maxH: c.maxH ?? 80 })))
    const rs = await runAll(list, jobs)
    const R = arms.map((_, i) => rs.slice(i * seeds.length, (i + 1) * seeds.length))
    console.log(`\n${name}: ${seeds.length} paired seeds; d = arm - incumbent (h); NOT CALIBRATED ratios`)
    console.log('arm                              exit h   d exit         1st BO h  d 1st BO        rank25 h  rep5k h')
    for (let i = 0; i < arms.length; i++) {
      const dd = (k) => {
        const d = R[i].map((r, j) => (r?.[k] ?? Infinity) - (R[0][j]?.[k] ?? Infinity)).filter(Number.isFinite)
        return d.length ? `${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(2)} +- ${seOf(d).toFixed(2)}` : '-'
      }
      const mh = (k) => {
        const x = R[i].map((r) => r?.[k]).filter((v) => v !== null && v !== undefined && Number.isFinite(v))
        return x.length ? mean(x).toFixed(2) : '-'
      }
      const bad = R[i].filter((r) => !(r?.hours > 0)).length
      console.log(`${arms[i].name.padEnd(32)} ${mh('hours').padStart(6)}  ${dd('hours').padEnd(14)} ${mh('bo1').padStart(6)}  ${dd('bo1').padEnd(14)}  ${mh('faction').padStart(6)}  ${mh('rep5k').padStart(6)}${bad ? `  (${bad} unfinished)` : ''}`)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  // --seed0: the first seed (a fresh range evaluates a pick made on another one: no winner's curse)
  const seeds = Array.from({ length: +opt('seeds', 8) }, (_, i) => i + +opt('seed0', 1))
  const jobs = +opt('jobs', Math.max(1, os.cpus().length - 2))
  console.log('CALIBRATION STATUS: the base (no lever) is checked here against history.jsonl and printed; the levers\' ratios are NOT CALIBRATED (no live node ran them).')
  // the clean nodes played without the bootstrap policy (it shipped after them): calibrate the model they ran
  if (args.includes('--calib')) await calib({ seeds, jobs, arm: JSON.parse(opt('arm', JSON.stringify({ sharedPolicy: BOOT_OFF }))), fixStart: !args.includes('--raw') })
  if (args.includes('--levers')) {
    const arms = opt('arms', null) ? JSON.parse(fs.readFileSync(opt('arms'), 'utf8')) : DEFAULT_ARMS
    await levers({ cells: opt('cells', 'BN5.2').split(','), seeds, jobs, arms })
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
