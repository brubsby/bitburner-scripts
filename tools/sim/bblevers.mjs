// THE BLADEBURNER ROUTE'S STAT LEVERS — each priced by simulating both exits.
//
//   node tools/sim/bblevers.mjs [--node 13 --l6 3 --l7 1 --l13 1 --sf14 3 --n 6 --gift 1 --seeds 9 --jobs 7] [--json]
//
// THE TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"): bbsim (the game's own
// Bladeburner, Sleeve, Player and StaneksGift classes; bbplan's shared POLICY deciding) from the
// node's start to the 21st black op, every arm on the planner's spec (surrogate.bbSpec: BB_BASE,
// BB_INT, the node's Go farm) and the same seeds, differing only in the lever:
//   (a) the player's training (bbsim pol.train): agility / agility+dexterity / all four, to a
//       level before the first action ('start'), or at the gym instead of the chamber while
//       stamina refills ('rest') — the work slot IS the action slot without The Blade's Simulacrum
//       (Bladeburner.ts:179, :1355);
//   (b) sleeves at the gym on agility / dexterity (exp to the player at sync x shock, Work.ts
//       applySleeveGains) in every mix with infiltrate / support / Field Analysis;
//   (c) installs on the route (bbsim installEveryH): the economy's combat multiplier growth g
//       (hackexit's latent, ASSUMED spent on combat), every Bladeburners augmentation the faction's
//       reputation covers, The Blade's Simulacrum, the exp reset and retrain, the Go farm's reset
//       and Stanek's charge reset (StaneksGift.ts:228-230) — against never installing.
// Each lever's policy space is chosen on the SELECTION seeds (surrogate.BB_SEL_SEEDS) and the
// chosen arm evaluated against the incumbent on the evaluation seeds: the decision is
// withH - withoutH, paired seed for seed (median and mean of the per-seed differences).
//
// MEASURED 2026-10-15 (gift on, 6 sleeves, SF6.3 SF7.1, Go farm SF14.3; d = arm - incumbent, mean
// over 60 paired evaluation seeds +/- s.e.; selection on BB_SEL_SEEDS):
//   BN13.2 (SF13.1, incumbent i2 f4 22.6h)   BN7.2 (SF13.2, incumbent i5 f1 19.2h)
//   (b) gym fleet i1 s1 g4 agi/dex -0.92 +/- 0.29   gym fleet i2 g4 agi -0.74 +/- 0.20     -> WINS, shipped
//   (a) train all four to 500 first -0.60 +/- 0.33 train agility while resting -0.69 +/- 0.22
//       agility at rest -0.58 +/- 0.41             agility to 200 first -0.30 +/- 0.22
//       -> marginal (2-3 s.e. at best, the winning arm differs by node) and OPTIMISTIC (gym fees
//          not binding here; the live retrain prices them): not shipped
//   (c) installs at g 0 (Bladeburners augmentations + Simulacrum only) never beat never installing;
//       BN13 --sweep-g every 12h with the Simulacrum: g 0.01 -0.33, 0.02 -0.75, 0.045 -2.0 +/- 0.2h;
//       every 6h loses below g ~0.045. g on this route is NOT the hacking route's: the non-Bladeburner
//       augmentations need faction reputation, and the work slot that earns it cancels the action
//       without the Simulacrum — so the planner keeps 'never' (NOT PRICED), and the live install
//       decision prices the batch it can actually buy (progress.js bladeInstallCompareOf).
//
// CALIBRATION: the leg WITHOUT these levers is k-calibrated (params.BB_PARAMS, the live/bbsim leg
// ratio); the levers' RATIOS are NOT CALIBRATED — no live Bladeburner life has trained agility,
// gymmed its sleeves or installed under these arms. Printed on every run. Money is not binding in
// bbsim (OPTIMISTIC for (c): the $ for the augmentations and the Simulacrum's $150b is not priced,
// and g is the hacking route's growth spent on combat — ASSUMED).

import '../test/gameresolve.mjs'
import os from 'node:os'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import { bbSpec, BB_SEL_SEEDS, fleetConfigs } from './gameplan/surrogate.mjs'
import { bladeGoOf } from './gameplan/go.mjs'
import { nodeMults } from './nodechoice/hackexit.mjs'
import { gridOf, bladeLayoutFor, giftOf } from './bbstanek.mjs'

const bp = await import('bbplan.js')
const sp = await import('../../stanekplan.js')

/** The spec of one arm: the planner's bbSpec + the lever's fields (JSON-able; the gift rebuilt in the worker). */
export function specOfArm({ node, l6, l7, l13, sf14, seed, arm }) {
  const go = bladeGoOf(nodeMults(node).GoPower, sf14)
  const s = bbSpec(node, l6, l7, seed, bp.POLICY, null, go)
  const f = arm.fleet ?? {}
  const policy = { ...s.policy, sleeves: { infiltrate: f.infiltrate ?? 0, support: f.support ?? 0, fa: f.fa ?? 0, gym: f.gym ?? 0, ...(f.gymStats ? { gymStats: f.gymStats } : {}) }, ...(arm.train ? { train: arm.train } : {}) }
  const out = { ...s, sf: [...s.sf, [13, l13]], policy }
  if (arm.install) Object.assign(out, { installEveryH: arm.install.everyH, g: arm.install.g, buySimulacrum: !!arm.install.simulacrum })
  return out
}
function runArm(job) {
  const spec = specOfArm(job)
  if (job.arm.gift) {
    const lay = bladeLayoutFor(gridOf(job.node, job.l13), 1e5)
    spec.stanek = giftOf(lay.placed, sp.BLADE_HOST.gbMax.mid)
  }
  const r = runBladeburner(spec)
  return { hours: r.hours ?? null, joinH: r.joinH, installs: r.installs, sim: r.simulacrum, agi: r.stats?.agility, dex: r.stats?.dexterity }
}

/** Run jobs across `jobs` worker processes (each bbsim run is single-threaded game module state). */
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

const med = (xs) => {
  const a = xs.map((x) => (Number.isFinite(x) ? x : Infinity)).sort((p, q) => p - q)
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
}
const mean = (xs) => (xs.every(Number.isFinite) ? xs.reduce((s, x) => s + x, 0) / xs.length : Infinity)

/** The levers' policy spaces for n sleeves (the incumbent's space first). */
export function leverSpaces(n, gs = [0.05, 0.1, 0.2]) {
  const fleets = fleetConfigs(bp, n).map((c) => ({ fleet: c }))
  const gymFleets = []
  for (const stats of [['agility'], ['agility', 'dexterity']])
    for (let k = 1; k <= n; k++)
      for (let i = 0; i <= n - k; i++) gymFleets.push({ fleet: { infiltrate: i, support: n - k - i, fa: 0, gym: k, gymStats: stats } })
  const trains = []
  for (const stats of [['agility'], ['agility', 'dexterity'], ['strength', 'defense', 'dexterity', 'agility']]) {
    for (const to of [150, 200, 300, 500]) trains.push({ stats, to, start: true })
    trains.push({ stats, rest: true })
    trains.push({ stats, to: 200, start: true, rest: true })
  }
  const installs = []
  for (const g of gs) for (const everyH of [6, 12, 24]) for (const simulacrum of [false, true]) installs.push({ g, everyH, simulacrum })
  return { fleets, gymFleets, trains, installs }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => {
    const i = args.indexOf(`--${k}`)
    return i >= 0 ? args[i + 1] : d
  }
  const cell = { node: +opt('node', 13), l6: +opt('l6', 3), l7: +opt('l7', 1), l13: +opt('l13', 1), sf14: +opt('sf14', 3) }
  const n = +opt('n', 6)
  const gift = opt('gift', '1') === '1'
  const evalSeeds = Array.from({ length: +opt('seeds', 9) }, (_, i) => i + 1)
  const jobs = +opt('jobs', Math.max(1, os.cpus().length - 1))
  const gs = (opt('g', '0.05,0.1,0.2')).split(',').map(Number)
  console.log('CALIBRATION: the leg without the levers is k-calibrated (params.BB_PARAMS); the levers\' ratios are NOT CALIBRATED (no live life ran them). Money not binding (OPTIMISTIC for installs); install g ASSUMED (the hacking route\'s latent spent on combat).')
  if (opt('arms', null)) {
    // named arms, paired against the first, on the evaluation seeds
    const arms = JSON.parse(opt('arms'))
    const rs = await runAll(arms.flatMap((arm) => evalSeeds.map((seed) => ({ ...cell, seed, arm: { ...arm, gift } }))), jobs)
    const H = arms.map((a, i) => rs.slice(i * evalSeeds.length, (i + 1) * evalSeeds.length).map((r) => r?.hours ?? Infinity))
    for (let i = 0; i < arms.length; i++) {
      const d = H[i].map((h, j) => h - H[0][j])
      const m = mean(d)
      const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, d.length - 1) / d.length)
      console.log(`  ${JSON.stringify(arms[i])}  ${med(H[i]).toFixed(2)}h (mean ${mean(H[i]).toFixed(2)})  d mean ${m.toFixed(2)} +/- ${se.toFixed(2)}h`)
    }
    return
  }
  if (args.includes('--sweep-g')) {
    // (c)'s break-even: the incumbent fleet, installing every everyH with the Simulacrum, at each g (paired)
    const fleet = JSON.parse(opt('fleet', '{"infiltrate":2,"support":0,"fa":4}'))
    const arms = [{ fleet }, ...gs.flatMap((g) => [6, 12].flatMap((everyH) => [false, true].map((simulacrum) => ({ fleet, install: { g, everyH, simulacrum } }))))]
    const rs = await runAll(arms.flatMap((arm) => evalSeeds.map((seed) => ({ ...cell, seed, arm: { ...arm, gift } }))), jobs)
    const H = arms.map((a, i) => rs.slice(i * evalSeeds.length, (i + 1) * evalSeeds.length).map((r) => r?.hours ?? Infinity))
    for (let i = 0; i < arms.length; i++) {
      const d = H[i].map((h, j) => h - H[0][j])
      const m = mean(d)
      const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, d.length - 1) / d.length)
      console.log(`  ${JSON.stringify(arms[i].install ?? 'never')}  ${med(H[i]).toFixed(2)}h  d mean ${m.toFixed(2)} +/- ${se.toFixed(2)}h`)
    }
    return
  }
  console.log(`cell BN${cell.node} SF6.${cell.l6} SF7.${cell.l7} SF13.${cell.l13} SF14.${cell.sf14}, ${n} sleeves, gift ${gift}, selection seeds ${BB_SEL_SEEDS.join(',')}, evaluation seeds 1..${evalSeeds.length}`)
  const sp0 = leverSpaces(n, gs)
  const withGift = (a) => ({ ...a, gift })
  // 1. SELECTION: every arm of every space on the selection seeds
  const sel = async (arms) => {
    const list = arms.flatMap((a) => BB_SEL_SEEDS.map((seed) => ({ ...cell, seed, arm: withGift(a) })))
    const rs = await runAll(list, jobs)
    return arms.map((a, i) => ({ arm: a, median: med(rs.slice(i * BB_SEL_SEEDS.length, (i + 1) * BB_SEL_SEEDS.length).map((r) => r?.hours)) }))
  }
  const best = (rows) => rows.reduce((x, y) => (y.median < x.median ? y : x))
  const fleetRows = await sel(sp0.fleets)
  const inc = best(fleetRows) // the incumbent: the live chooser's fleet (sleeveConfigs), no training, never installing
  const gymRows = await sel(sp0.gymFleets)
  const bGym = best([...fleetRows, ...gymRows])
  const trainRows = await sel(sp0.trains.map((t) => ({ ...inc.arm, train: t })))
  const bTrain = best([inc, ...trainRows])
  const instRows = await sel(sp0.installs.map((x) => ({ ...inc.arm, install: x })))
  const bInst = best([inc, ...instRows])
  // the levers together: the best fleet with the best training and the best install
  const joint = { ...bGym.arm, ...(bTrain.arm.train ? { train: bTrain.arm.train } : {}), ...(bInst.arm.install ? { install: bInst.arm.install } : {}) }
  const show = (rows, k = 4) => [...rows].sort((a, b) => a.median - b.median).slice(0, k).map((r) => `${JSON.stringify(r.arm)} ${r.median.toFixed(2)}h`).join('\n      ')
  console.log(`selection — fleets (incumbent ${JSON.stringify(inc.arm.fleet)} ${inc.median.toFixed(2)}h):\n      ${show(fleetRows, 3)}`)
  console.log(`  (b) sleeve gym:\n      ${show(gymRows)}`)
  console.log(`  (a) player training:\n      ${show(trainRows)}`)
  console.log(`  (c) installs:\n      ${show(instRows, 6)}`)
  // 2. EVALUATION: each lever's pick vs the incumbent, paired on the evaluation seeds
  const evalArms = { incumbent: inc.arm, sleeveGym: bGym.arm, training: bTrain.arm, install: bInst.arm, joint }
  const names = Object.keys(evalArms)
  const list = names.flatMap((k) => evalSeeds.map((seed) => ({ ...cell, seed, arm: withGift(evalArms[k]) })))
  const rs = await runAll(list, jobs)
  const H = Object.fromEntries(names.map((k, i) => [k, rs.slice(i * evalSeeds.length, (i + 1) * evalSeeds.length)]))
  const res = {}
  for (const k of names) {
    const d = H[k].map((r, j) => (r?.hours ?? Infinity) - (H.incumbent[j]?.hours ?? Infinity))
    const fin = d.filter(Number.isFinite)
    const sd = fin.length > 1 ? Math.sqrt(fin.reduce((s, x) => s + (x - mean(fin)) ** 2, 0) / (fin.length - 1)) : null
    res[k] = { arm: evalArms[k], medianH: med(H[k].map((r) => r?.hours)), dMedian: med(d), dMean: mean(d), seMean: sd === null ? null : sd / Math.sqrt(fin.length), perSeed: H[k].map((r) => (r?.hours == null ? null : +r.hours.toFixed(3))) }
    console.log(`  ${k.padEnd(10)} ${res[k].medianH.toFixed(2)}h  d ${res[k].dMedian.toFixed(2)}h (mean ${res[k].dMean.toFixed(2)} +/- ${res[k].seMean?.toFixed(2)})  ${JSON.stringify(evalArms[k])}`)
  }
  if (args.includes('--json')) console.log(JSON.stringify({ cell, n, gift, res }))
}

if (process.argv.includes('--worker')) {
  process.on('message', (chunk) => {
    for (const [i, j] of chunk) {
      let r
      try {
        r = runArm(j)
      } catch (e) {
        r = { hours: null, why: String(e?.stack ?? e).slice(0, 300) }
      }
      process.send({ i, r })
    }
    process.send({ done: true })
  })
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
  process.exit(0)
}
