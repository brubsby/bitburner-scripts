// BITNODE 15's BLADEBURNER EXIT: the in-game exit model (bbplan.bladeExit) against the game's own classes
// (bbsim), with and without the bootstrap policy — the check the node policy (bbnodepolicy.js) rests on.
//
//   node tools/sim/bb15check.mjs [--seeds 8 --seed0 601 --jobs 5 --at 0.25 --gift]
//
// Per seed and arm: bbsim from the node's start (BN15: BladeburnerRank 0.2, SkillCost 3, combat x0.7 —
// the game's own getBitNodeMultipliers; SF6.3 SF7.3 SF13.3 SF14.3, 8 sleeves i1s7, the Go farm) with the
// arm's shared policy; at `--at` hours after the faction join its state is snapshotted into the exit
// model's start (stanekepoch.snapshotStartOf, what bladeStartOf builds from the live telemetry) with the
// same policy (bladeStartOf `policy`), and bladeExit's members (BLADE_ENSEMBLE) price the rest. Printed:
// the model's remaining hours vs bbsim's, per arm, and each one's boot effect (off - on), paired.
//
// CALIBRATION: this IS the model-vs-game check (printed every run, error shown pass or fail). NOT
// CALIBRATED live: no node has played Bladeburner at rank x0.2. --gift: the gift arm (the BN15 layout on
// BLADE_HOST mid) in bbsim only — the snapshot carries its multipliers at that moment, not its charge path.
import '../test/gameresolve.mjs'
import os from 'node:os'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g from './nodechoice/game.mjs'
import { specOfArm } from './bblevers.mjs'
import { snapshotStartOf } from './stanekepoch.mjs'
import { gridOf, bladeLayoutFor } from './bbstanek.mjs'

const bp = await import('bbplan.js')
const gp = await import('goplan.js')
const sp = await import('stanekplan.js')
const NP = await import('bbnodepolicy.js')

export const ARMS = {
  boot: { shared: bp.POLICY, override: null },
  noboot: { shared: NP.nodePolicyOf(15, bp.POLICY), override: NP.BOOT_OFF },
}

export function runSeed({ seed, arm, atH, gift }) {
  const cell = { node: 15, l6: 3, l7: 3, l13: 3, sf14: 3 }
  const spec = specOfArm({ ...cell, seed, arm: { fleet: { infiltrate: 1, support: 7, fa: 0 } } })
  spec.policy = { ...spec.policy, sharedPolicy: ARMS[arm].shared }
  if (gift) {
    const lay = bladeLayoutFor(gridOf(15, 3), 1e5)
    spec.stanek = { placed: lay.placed, chargeAt: sp.bladeChargeAt({ gbMax: sp.BLADE_HOST.gbMax.mid, cores: 1, k: sp.chargeRootsOf(lay.placed).length }) }
  }
  const nodeMults = g.getBitNodeMultipliers(15, 1)
  let snap = null
  let joinT = null
  const onStep = ({ t, P, bb }) => {
    if (snap) return
    if (joinT === null && g.Factions['Bladeburners'].isMember) joinT = t
    if (joinT === null || t < joinT + atH * 3600) return
    const goEff = spec.go?.perHour > 0 ? gp.effectAt((spec.go.perHour * t) / 3600, spec.go.power ?? gp.OPPONENTS.Tetrads.power, spec.go.goPower ?? 1, spec.go.sf14 ?? 0) : null
    const s0 = snapshotStartOf({ P, bb, nodeMults, fleet: spec.policy.sleeves, go: spec.go, goEff, goNodes: spec.go?.perHour > 0 ? (spec.go.perHour * t) / 3600 : 0 })
    snap = { t, s0: { ...s0, simulacrum: true, maxH: 400, ...(ARMS[arm].override ? { policy: ARMS[arm].override } : {}) }, rank: bb.rank }
  }
  const base = runBladeburner({ ...spec, maxH: 400, onStep })
  if (!snap || !Number.isFinite(base.hours)) return { seed, arm, why: `no snapshot (join ${joinT}) or bbsim did not finish (${base.why ?? base.hours})` }
  const Q = bp.BLADE_ENSEMBLE.Q
  const members = Array.from({ length: Q }, (_, m) => bp.bladeExit(bp.bladeMemberOf(snap.s0, m, Q)).hours)
  const f = members.filter((x) => Number.isFinite(x))
  return { seed, arm, atH: snap.t / 3600, rank: snap.rank, simRestH: base.hours - snap.t / 3600, simH: base.hours, modelRestH: f.length ? f.reduce((a, x) => a + x, 0) / f.length : null, members, unfinished: Q - f.length }
}

async function runAll(list, jobs) {
  const out = new Array(list.length)
  const chunks = Array.from({ length: jobs }, () => [])
  list.forEach((j, i) => chunks[i % jobs].push([i, j]))
  await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((res, rej) => {
    const w = fork(fileURLToPath(import.meta.url), ['--bb15-worker'], { execArgv: ['--max-old-space-size=2048'] })
    w.on('message', (m) => {
      if (m.done) return w.kill(), res()
      out[m.i] = m.r
    })
    w.on('exit', (code) => (code ? rej(new Error(`worker exited ${code}`)) : res()))
    w.send(c)
  })))
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const seeds = Array.from({ length: +opt('seeds', 8) }, (_, i) => i + +opt('seed0', 601))
  const jobs = +opt('jobs', Math.max(1, os.cpus().length - 2))
  const atH = +opt('at', 0.25)
  const gift = args.includes('--gift')
  console.log(`CALIBRATION: bladeExit (members' mean) vs bbsim (the game's classes) from ${atH}h after the join, BN15.1, ${seeds.length} seeds, gift ${gift ? 'on (bbsim; the snapshot holds its multipliers then)' : 'off'}; NOT CALIBRATED live`)
  const list = seeds.flatMap((seed) => Object.keys(ARMS).map((arm) => ({ seed, arm, atH, gift })))
  const rs = await runAll(list, jobs)
  const m = (xs) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length)
  const se = (xs) => Math.sqrt(xs.reduce((a, x) => a + (x - m(xs)) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length))
  const by = {}
  for (const r of rs) {
    if (!r) continue
    console.log(`  seed ${r.seed} ${r.arm.padEnd(6)}: ${r.why ?? `at ${r.atH.toFixed(2)}h rank ${Math.round(r.rank)}; bbsim rest ${r.simRestH.toFixed(1)}h (exit ${r.simH.toFixed(1)}h), model rest ${r.modelRestH?.toFixed(1) ?? '-'}h (${((r.modelRestH / r.simRestH - 1) * 100).toFixed(0)}%)${r.unfinished ? ` ${r.unfinished} member(s) unfinished` : ''}`}`)
    ;(by[r.seed] ??= {})[r.arm] = r
  }
  for (const arm of Object.keys(ARMS)) {
    const ok = Object.values(by).map((x) => x[arm]).filter((r) => r && Number.isFinite(r.modelRestH))
    const err = ok.map((r) => r.modelRestH / r.simRestH - 1)
    console.log(`${arm}: bbsim rest ${m(ok.map((r) => r.simRestH)).toFixed(1)}h, model ${m(ok.map((r) => r.modelRestH)).toFixed(1)}h — model error ${(100 * m(err)).toFixed(1)} +- ${(100 * se(err)).toFixed(1)}% over ${ok.length} seeds`)
  }
  const pairs = Object.values(by).filter((x) => x.boot && x.noboot && Number.isFinite(x.boot.simRestH) && Number.isFinite(x.noboot.simRestH))
  const dSim = pairs.map((x) => x.noboot.simH - x.boot.simH)
  const pm = pairs.filter((x) => Number.isFinite(x.boot.modelRestH) && Number.isFinite(x.noboot.modelRestH))
  const dModel = pm.map((x) => x.noboot.modelRestH + x.noboot.atH - (x.boot.modelRestH + x.boot.atH))
  console.log(`THE BOOT EFFECT (off - on, exit hours, paired): bbsim ${m(dSim).toFixed(2)} +- ${se(dSim).toFixed(2)}h over ${pairs.length}; the exit model ${m(dModel).toFixed(2)} +- ${se(dModel).toFixed(2)}h over ${pm.length}`)
}

if (process.argv.includes('--bb15-worker')) {
  process.on('message', (chunk) => {
    for (const [i, j] of chunk) {
      let r
      try {
        r = runSeed(j)
      } catch (e) {
        r = { seed: j.seed, arm: j.arm, why: String(e?.stack ?? e).slice(0, 400) }
      }
      process.send({ i, r })
    }
    process.send({ done: true })
  })
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
  process.exit(0)
}
