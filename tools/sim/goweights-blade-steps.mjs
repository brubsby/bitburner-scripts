// PROFILE 'goweights-blade' STEP BY STEP on a live-shaped BN9.2 Bladeburner
// start (tools/test/fixture-bn9-goweights-0420.json, through the builder
// progress.js bladeRouteOf uses), as progress.js bladeGoWeightsOf calls it
// with no install committed (the live shape at 04:20Z 2026-10-08: spec null,
// the Tetrads goCombat of that pass's plan.txt).
//
//   node tools/sim/goweights-blade-steps.mjs [reps]
//
// Prints each run's step count and its slowest steps. Read-only.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../test/gameresolve.mjs'

const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const GW = await import('goweights.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-goweights-0420.json'), 'utf8'))
const nm = bitNodeMults(9)
const P = fx.person.player
const lv = (m) => ({ ...m, strength: m.strength * nm.StrengthLevelMultiplier, defense: m.defense * nm.DefenseLevelMultiplier, dexterity: m.dexterity * nm.DexterityLevelMultiplier, agility: m.agility * nm.AgilityLevelMultiplier, charisma: m.charisma * nm.CharismaLevelMultiplier })
const person = { skills: P.skills, exp: P.exp, mults: lv(P.mults), city: P.city, money: P.money }
const br = fx.bladeRoute
const now = Date.parse(fx.at)
const retrainSecsOf = BP.retrainSecsOfFor({ node: nm, trainingMult: br.start.trainingMult ?? 1, flatPerSec: fx.inputs.flatIncomePerSec, holdS: BB.POLICY.retrainLegS, start: { cash: fx.inputs.money ?? P.money, city: P.city }, install: { cash: 1000, city: 'Sector-12' } })
const goCombat = br.start.goCombat
export const startFor = (spec) =>
  BB.bladeStartOf({ tel: fx.tel, person, sleeves: br.sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: br.calibration.rank.applied, successScale: br.calibration.success.applied, rankSdLn: br.calibration.rank.sdLn, successSdLn: br.calibration.success.sdLn, leanUntilH: br.lean?.untilH ?? null, retrainSecsOf, goCombat, now })
export const liveCase = () => ({ startFor, spec: null, maxH: Math.max(fx.exitH * 2, 50), batchMoneyPerSec: 1e6, hacknetPerSec: 0 })

/** Per-step wall times of one run of gen: {times, value}. */
export function stepTimes(g) {
  const times = []
  for (;;) {
    const t = performance.now()
    const x = g.next()
    times.push(performance.now() - t)
    if (x.done) return { times, value: x.value }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reps = +(process.argv[2] ?? 3)
  for (let r = 0; r < reps; r++) {
    const { times, value } = stepTimes(GW.bladeGoWeightsGen(liveCase()))
    const idx = times.map((ms, i) => [i + 1, ms]).sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`run ${r}: ${times.length} steps, total ${times.reduce((a, b) => a + b, 0).toFixed(1)}ms, slowest ${idx.map(([i, ms]) => `#${i} ${ms.toFixed(2)}ms`).join(', ')}`)
    if (r === 0) console.log(JSON.stringify(value.weights), JSON.stringify(value.detail?.combatCurve), value.detail?.exitH, value.why)
  }
}
