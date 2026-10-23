// GRAFTS ON THE BLADEBURNER ROUTE — the exit model's schedule, checked in the game's classes.
//
//   node tools/sim/bbgraft.mjs --node 11 --l7 3 [--l6 3 --sf14 3 --n 6 --seeds 8 --jobs 4 --at 0.5]
//        [--money poor|mid|rich|<wealth>:<perHour>] [--json]
//   node tools/sim/bbgraft.mjs --live --player <save player json> [--tel <dir>]   (the live decision, offline)
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"), per seed:
//   1. bbsim (the game's Bladeburner, Sleeve, Player, GraftableAugmentation, calculateEntropy) from
//      the node's start, WITHOUT grafts; at `--at` hours after the Bladeburners faction join (the
//      special augmentations graftable from then, GraftingHelpers.ts:12-14) its state is
//      snapshotted into the exit model's start (stanekepoch.snapshotStartOf — what bladeStartOf
//      builds from the live telemetry).
//   2. The exit model chooses the schedule on that start (bbplan.bladeGraftsGen: greedy on the
//      exit, Q members, entropy and money and the slot included) — the decision progress.js makes.
//   3. bbsim again on the SAME seed WITH that schedule from that moment (o.grafts.fromS), the money
//      the --money level gives. The decision's value in the game's classes is withH - withoutH,
//      paired seed for seed; the model's own withH - withoutH is printed beside it, with the error.
//
// MONEY LEVELS (bbsim does not model the node's economy): poor = BN11.3 live 2026-10-23 02:47Z
// (cash + the trader's book $1.38e9, income $7,016/s = $2.5e7/h); mid = $1e11 + $1e10/h; rich =
// BN3.1 as held ($1.35e13) + $1e12/h. A node's real level is its own (BN5.2/BN2.2: not measured).
//
// CALIBRATION: the schedule's delta is checked against the game's classes here (model vs bbsim,
// printed on every run). NOT CALIBRATED against a live game: no Bladeburner life has grafted yet —
// the first one is BN11.3's (progress.js decisions.bladeRoute.grafts, published with its forecast).
// NOT MODELLED here, named: the gift (o.stanek off), the trader's growth of the book.

import '../test/gameresolve.mjs'
import os from 'node:os'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g from './nodechoice/game.mjs'
import { specOfArm } from './bblevers.mjs'
import { snapshotStartOf } from './stanekepoch.mjs'

const bp = await import('bbplan.js')
const gp = await import('goplan.js')

export const MONEY = { poor: { wealth: 1.38e9, perH: 7016 * 3600 }, mid: { wealth: 1e11, perH: 1e10 }, rich: { wealth: 1.35e13, perH: 1e12 } }

/** The graftable candidates for a Bladeburners member at intelligence `int` (the game's Augmentations). */
export function candidatesOf(int, owned = new Set()) {
  return Object.values(g.Augmentations)
    .filter((a) => bp.bladeGraftableOf(a.name, true) && !owned.has(a.name))
    .map((a) => bp.bladeGraftSpecOf({ name: a.name, mults: a.mults, baseCost: a.baseCost, prereqs: a.prereqs }, int))
    .filter(Boolean)
}

/** One seed: baseline, the model's decision from its snapshot, the with-run. */
export function runSeed({ cell, seed, atH, money, n }) {
  const spec = specOfArm({ ...cell, seed, arm: { fleet: { infiltrate: 1, support: Math.max(0, n - 1), fa: 0 } } })
  const nodeMults = g.getBitNodeMultipliers(cell.node, 1)
  let snap = null
  let joinT = null
  const onStep = ({ t, P, bb }) => {
    if (snap) return
    if (joinT === null && g.Factions['Bladeburners'].isMember) joinT = t
    if (joinT === null || t < joinT + atH * 3600) return
    const goEff = spec.go?.perHour > 0 ? gp.effectAt((spec.go.perHour * t) / 3600, spec.go.power ?? gp.OPPONENTS.Tetrads.power, spec.go.goPower ?? 1, spec.go.sf14 ?? 0) : null
    const s0 = snapshotStartOf({ P, bb, nodeMults, fleet: spec.policy.sleeves, go: spec.go, goEff, goNodes: spec.go?.perHour > 0 ? (spec.go.perHour * t) / 3600 : 0 })
    snap = { t, s0: { ...s0, simulacrum: cell.l7 >= 3, maxH: 300 }, int: P.skills.intelligence }
  }
  const base = runBladeburner({ ...spec, maxH: 300, onStep })
  if (!snap || !Number.isFinite(base.hours)) return { seed, why: `no decision point (join ${joinT}) or the baseline did not finish (${base.why})` }
  const owned = new Set(cell.l7 >= 3 ? [bp.SIMULACRUM] : [])
  const t0 = Date.now()
  const d = bp.bladeGrafts({ s0: snap.s0, candidates: candidatesOf(snap.int, owned), wealth: money.wealth, moneyPerH: money.perH, owned })
  const ms = Date.now() - t0
  const out = { seed, atH: +(snap.t / 3600).toFixed(3), baseH: base.hours, model: { withoutH: d.withoutH, withH: d.withH, gainH: d.gainH, entropyH: d.entropyH, schedule: d.schedule.map((x) => x.name), sim: d.sim, priced: d.priced, ms } }
  if (!d.graft) return { ...out, simGainH: 0, why: d.why }
  const w = runBladeburner({ ...spec, maxH: 300, grafts: { schedule: d.schedule.map((x) => x.name), wealth: money.wealth, moneyPerH: money.perH, fromS: snap.t } })
  return { ...out, withH: w.hours, simGainH: Number.isFinite(w.hours) ? base.hours - w.hours : null, simGrafts: w.grafts }
}

async function runAll(list, jobs) {
  const out = new Array(list.length)
  const chunks = Array.from({ length: jobs }, () => [])
  list.forEach((j, i) => chunks[i % jobs].push([i, j]))
  await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((res, rej) => {
    const w = fork(fileURLToPath(import.meta.url), ['--bbgraft-worker'], { execArgv: ['--max-old-space-size=2048'] })
    w.on('message', (m) => {
      if (m.done) return w.kill(), res()
      out[m.i] = m.r
    })
    w.on('exit', (code) => (code ? rej(new Error(`worker exited ${code}`)) : res()))
    w.send(c)
  })))
  return out
}

/**
 * THE LIVE DECISION, offline (--live --player <json>): the route's start rebuilt from /tel as
 * progress.js bladeRouteOf builds it (plan.txt bladeRoute: the fleet it priced, the calibration,
 * the gym rate and the Go channel; bladeburner.txt; the player's skills, exp and multipliers — the
 * save's, via --player), the candidates from the snapshots as bladeRouteGraftsGen reads them
 * (graftplan.graftCandidatesOf with the Bladeburners' specials), cash + the book and the life's
 * income from progress.txt. CHECK: the model's exit without grafts against the published bladeH.
 * NOT MODELLED offline, named: the gift's charge path (the multipliers as they are now).
 */
async function liveCase(tel, playerFile) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const read = (n) => JSON.parse(fs.readFileSync(path.join(tel, n), 'utf8'))
  const GP = await import('graftplan.js')
  const { bitNodeMults } = await import('bitNodeMultipliers.js')
  const plan = read('plan.txt')
  const prog = read('progress.txt')
  const state = read('state.json')
  const bbt = read('bladeburner.txt')
  const pl = JSON.parse(fs.readFileSync(playerFile, 'utf8'))
  const br = plan.decisions.bladeRoute
  const node = state.bitNode
  const lvl = (new Map(state.sourceFiles.data).get(node) ?? 0) + 1
  const nm = bitNodeMults(node, Math.min(3, lvl))
  const lv = (k, key) => (pl.mults[k] ?? 1) * (nm[key] ?? 1)
  const mults = { ...pl.mults, strength: lv('strength', 'StrengthLevelMultiplier'), defense: lv('defense', 'DefenseLevelMultiplier'), dexterity: lv('dexterity', 'DexterityLevelMultiplier'), agility: lv('agility', 'AgilityLevelMultiplier'), charisma: lv('charisma', 'CharismaLevelMultiplier') }
  const person = { skills: pl.skills, exp: pl.exp, mults }
  const cal = br.calibration
  const s0 = bp.bladeStartOf({ tel: bbt, person, sleeves: br.armSleeves ?? br.sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, simulacrum: state.augmentations.includes(bp.SIMULACRUM), rankScale: cal.rank.applied, successScale: cal.success.applied, rankSdLn: cal.rank.sdLn ?? 0, successSdLn: cal.success.sdLn ?? 0, goCombat: br.start.goCombat?.effect ? { ...br.start.goCombat } : null, now: Date.parse(plan.at) })
  const stats = read('snap-augstats.txt').data.stats
  const price = read('snap-augprice.txt').data.price
  const prereq = read('snap-prereq.txt').data.prereq
  const names = Object.keys(price)
  const owned = new Set([...state.augmentations, ...(state.queuedAugmentations ?? [])])
  const inFaction = state.factions.includes('Bladeburners')
  const raw = GP.graftCandidatesOf({ names, stats, prereqs: prereq, price, owned, augMoneyCost: nm.AugmentationMoneyCost, queuedNonSoA: (state.queuedAugmentations ?? []).length, sf11: new Map(state.sourceFiles.data).get(11) ?? 0, allow: inFaction ? bp.BLADE_GRAFT_SPECIAL : null })
  const int = pl.skills.intelligence ?? 0
  const cands = raw.map((a) => bp.bladeGraftSpecOf(a, int, { focus: true, neuroreceptor: owned.has('Neuroreceptor Management Implant') })).filter(Boolean)
  const wealth = (pl.money ?? 0) + (prog.income?.equity ?? 0)
  const moneyPerH = (prog.income?.lifePerSec ?? prog.income?.incomePerSec ?? 0) * 3600
  const t0 = Date.now()
  const v = bp.bladeGrafts({ s0, candidates: cands, wealth, moneyPerH, entropy: pl.entropy ?? 0, owned: new Set(state.augmentations) })
  console.log(`LIVE BN${node}.${lvl} (${plan.at}): cash + book $${wealth.toExponential(3)}, income $${moneyPerH.toExponential(3)}/h, int ${int}, entropy ${pl.entropy ?? 0}, ${cands.length} candidates (in the Bladeburners: ${inFaction})`)
  console.log(`  CHECK: the model's exit without grafts ${v.withoutH}h vs the published bladeH ${br.bladeH}h (${((v.withoutH / br.bladeH - 1) * 100).toFixed(1)}%; the published one carries the gift's charge path)`)
  console.log(`  verdict: ${v.why} (${v.priced} prices, ${Date.now() - t0}ms)`)
  console.log(`  best alone: ${(v.singles ?? []).slice(0, 5).map((x) => `${x.name} ${x.gainH}h ($${(x.cost / 1e9).toFixed(2)}b, ${x.slotH}h)`).join('; ')}`)
  if (v.sim) console.log(`  when: ${JSON.stringify(v.sim.done)}${v.sim.notStarted?.length ? ` not started ${v.sim.notStarted.join(', ')}` : ''}`)
  return v
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  if (args.includes('--live')) {
    await liveCase(opt('tel', `${process.env.HOME}/Repos/bitburner-scripts/.telemetry`), opt('player'))
    return
  }
  const cell = { node: +opt('node', 11), l6: +opt('l6', 3), l7: +opt('l7', 3), l13: +opt('l13', 1), sf14: +opt('sf14', 3) }
  const mk = opt('money', 'poor')
  const money = MONEY[mk] ?? (() => {
    const [w, r] = mk.split(':').map(Number)
    return { wealth: w, perH: r }
  })()
  const n = +opt('n', 6)
  const seeds = Array.from({ length: +opt('seeds', 8) }, (_, i) => i + 1)
  const jobs = +opt('jobs', Math.max(1, Math.min(seeds.length, os.cpus().length - 1)))
  const atH = +opt('at', 0.5)
  console.log('CALIBRATION: model vs the game\'s classes printed below (per seed and mean); NOT CALIBRATED live (no Bladeburner life has grafted). Gift off; money fixed at the level given.')
  console.log(`cell BN${cell.node} SF6.${cell.l6} SF7.${cell.l7} SF14.${cell.sf14}, ${n} sleeves (i1 s${n - 1}), money ${mk} ($${money.wealth.toExponential(2)} + $${money.perH.toExponential(2)}/h), decision ${atH}h after the faction join, ${seeds.length} seeds`)
  const rows = (await runAll(seeds.map((seed) => ({ cell, seed, atH, money, n })), jobs)).filter(Boolean)
  const ok = rows.filter((r) => Number.isFinite(r.simGainH) && Number.isFinite(r.model?.gainH))
  for (const r of rows) console.log(`  seed ${r.seed}: decided at ${r.atH ?? '?'}h, bbsim without ${Number.isFinite(r.baseH) ? r.baseH.toFixed(2) : '-'}h; schedule [${r.model?.schedule?.join(', ') ?? ''}]; model gain ${r.model?.gainH ?? '-'}h (entropy ${r.model?.entropyH ?? '-'}h; ${r.model?.priced ?? '?'} means, ${r.model?.ms ?? '?'}ms), bbsim gain ${Number.isFinite(r.simGainH) ? r.simGainH.toFixed(3) : '-'}h${r.why ? ` — ${String(r.why).slice(0, 140)}` : ''}`)
  const m = (xs) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length)
  const sd = (xs) => Math.sqrt(m(xs.map((x) => (x - m(xs)) ** 2)) / Math.max(1, xs.length - 1))
  const sg = ok.map((r) => r.simGainH)
  const mg = ok.map((r) => r.model.gainH)
  const remBase = ok.map((r) => r.baseH - r.atH)
  const remModel = ok.map((r) => r.model.withoutH)
  console.log(`MEAN over ${ok.length} paired seeds: bbsim gain ${m(sg).toFixed(3)} +/- ${sd(sg).toFixed(3)}h; model gain ${m(mg).toFixed(3)}h (error ${(m(mg) - m(sg)).toFixed(3)}h); model's exit without ${m(remModel).toFixed(2)}h vs bbsim's ${m(remBase).toFixed(2)}h from the decision (${((m(remModel) / m(remBase) - 1) * 100).toFixed(1)}%)`)
  if (args.includes('--json')) console.log(JSON.stringify(rows))
}

if (process.argv.includes('--bbgraft-worker')) {
  process.on('message', (chunk) => {
    for (const [i, j] of chunk) process.send({ i, r: runSeed(j) })
    process.send({ done: true })
  })
} else if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
  process.exit(0)
}
