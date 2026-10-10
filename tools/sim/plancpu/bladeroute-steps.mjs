// PLAN BLOCKED THE PAGE in 'plan-bladeRoute' — where the long step is.
//
//   node --trace-gc tools/sim/plancpu/bladeroute-steps.mjs [runs]
//   BALLAST_MB=1500 node --trace-gc ... (a page-sized live heap; see below)
//
// Live BN7.1 2026-10-09: 'plan-bladeRoute' 68,122 steps, 954ms of work (mean
// step ~14us), one step of 40.1ms at step 13,111 (78.7ms block); another pass
// 59.7ms at step 68,554; earlier 269/276ms blocks. The 23:56Z pass this
// fixture is from: 55,307 steps, longest 1.6ms. A step that is slow because
// of CODE is slow at the same index on every run of the same inputs; a GC
// pause lands wherever allocation crosses a heap limit.
//
// Replays the section's generators as progress.js runs them
// (fixture-bn7-bladeroute-2356.json: the 23:56Z pass's exit inputs,
// posteriors and bladeburner.txt; the person from the save digest):
// decideBladeRouteGen (both arms on the plan's draws), then
// simulacrumVerdictGen on the blade start — stepped one next() at a time,
// each step timed. Prints every step over THRESH ms (default 5) with its
// index; under --trace-gc node prints each GC between them, so a slow step
// sitting on a Mark-Compact line is a GC pause, not the step's code.
// NOT CALIBRATED as a timing: node's heap is not the page's (the game's
// state and every script's module graph are live there), so absolute ms
// differ; BALLAST_MB retains that many MB of small objects to give a full
// collection a page-sized live set to trace. The POSITIONS of slow steps
// across runs, and their coincidence with GC, are what this measures.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const P = await import('plan.js')
const BB = await import('bbplan.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const F = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-bn7-bladeroute-2356.json'), 'utf8'))
const RUNS = +(process.argv[2] ?? 4) || 4
const THRESH = +(process.env.THRESH ?? 5)
const BALLAST = []
for (let i = 0; i < (+(process.env.BALLAST_MB ?? 0) * 1024 * 1024) / 64; i++) BALLAST.push({ a: i, b: [i], c: `k${i & 1023}` })

// The plan's draws from its published posteriors (as bladeroute.test.mjs postOf).
const ps = F.posteriors
const c = ps.cadence
const DRAWS = P.makeDraws(
  {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: ps.gymSdLn ?? 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  },
  P.PLAN.N,
  P.seedOf(F.lastAugReset, F.node),
)
const lv = 1.3
const mults = { strength: lv, defense: lv, dexterity: lv, agility: lv, charisma: lv, strength_exp: 1.4, defense_exp: 1.4, dexterity_exp: 1.4, agility_exp: 1.4, charisma_exp: 1.4, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
const person = { skills: F.skills, exp: F.exp, mults }
const start = BB.bladeStartOf({ tel: F.bladeburner, person, sleeves: { infiltrate: 0, support: 0, fa: 0 }, gymExpPerSec: F.start.gymExpPerSec, bnRank: 1, install: null, now: Date.parse(F.captured) })

export function* section() {
  const d = yield* P.decideBladeRouteGen({ base: F.inputs, traj: P.trajectoryOf(null, {}), trajGen: P.trajectoryGenOf(null, {}), basis: null, bladeStart: start, prev: null, draws: DRAWS, redecide: true, budgetMs: 1e9 })
  const sim = yield* BB.simulacrumVerdictGen({ s0: start, withoutH: d.bladeH, cost: 450e9, repReq: 1250, wealth: 3e6, moneyPerH: 9e5, rep: 0, repPerRank: 2, rankPerH: 32.9, owned: false, queued: false })
  return { d, sim }
}

export function stepped(label, log = true) {
  const gen = section()
  const slow = []
  let steps = 0
  let total = 0
  let worst = 0
  let r
  for (;;) {
    const t0 = performance.now()
    r = gen.next()
    const dt = performance.now() - t0
    total += dt
    steps++
    if (dt > worst) worst = dt
    if (dt > THRESH) {
      slow.push([steps, +dt.toFixed(1)])
      if (log) console.log(`  [${label}] step ${steps}: ${dt.toFixed(1)}ms`)
    }
    if (r.done) break
  }
  return { steps, total, worst, slow, d: r.value.d }
}

export const FIXTURE = F
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(`live: ${JSON.stringify(F.cpu)}; ${JSON.stringify(F.live)}`)
  for (let i = 0; i < RUNS; i++) {
    const s = stepped(`run ${i}`)
    console.log(`run ${i}: ${s.steps} steps, ${s.total.toFixed(0)}ms, worst ${s.worst.toFixed(1)}ms, ${s.slow.length} over ${THRESH}ms at [${s.slow.map((x) => x[0]).join(', ')}]; hack ${s.d.hackH}h blade ${s.d.bladeH}h -> ${s.d.key}`)
  }
}
