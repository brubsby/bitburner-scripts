// [GB] 'goweights-blade' STEP SIZE ON THE LIVE SHAPE — live BN9.2 2026-10-08
// 04:20Z: "PLAN BLOCKED THE PAGE: a 75.9ms synchronous block against 50ms —
// longest step 42.3ms in 'goweights-blade' (step 1231 of 3945)".
//
// The section is bladeGoWeightsGen with no install committed: five black-op
// exits (bbplan.bladeExitGen: the base, then combat x e^D over BLADE_D_GRID),
// each yielding every two simulated 300s steps and after every skill candidate
// planSkillsGen prices. On the live start rebuilt here
// (tools/test/fixture-bn9-goweights-0420.json, tools/sim/exitjump/
// mkfix-bn9-goweights-0420.mjs) no step costs more than a few ms; step 1231 is
// a skill candidate inside the second exit (~0.02ms), and the very next live
// pass (04:21:07Z, the same inputs, 3986 steps) published maxStepMs 1.6. So
// the 42.3ms was not a step's work but a pause landing in it (GC — the
// healthcheck's own note), which no yield placement can split.
//
// What these checks hold, so a REAL heavy step cannot come back unseen:
//   GB1 CALIBRATION: the fixture reproduces the live pass's shape (step count,
//       exit, combat curve) — printed whatever it reads
//   GB2 every step under STEP_MS on the live shape. A step's cost is its
//       MINIMUM over RUNS runs (a pause lands in one run, a heavy step is heavy
//       in all), then the max over the steps; the same measure must see a
//       startFor made STEP_MS + 5 ms slow (the check is seen to fail)
//   GB3 under the real pacer (PLAN.sliceMs) the section's longest block is
//       under PLAN.maxBlockMs - the pause margin, and the paced weights are
//       the drained ones

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const GW = await import('goweights.js')
const CO = await import('coop.js')
const P = await import('plan.js')
const S = await import('../sim/goweights-blade-steps.mjs')
const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-goweights-0420.json'), 'utf8'))

/** The per-step budget (ms): a third of the block limit, so a slice plus one step never crosses it. */
export const STEP_MS = 15
const RUNS = 3
const LIVE_STEPS = [3945, 3986] // the 04:20Z (flagged) and 04:21Z passes

const spin = (ms) => {
  const t = performance.now()
  while (performance.now() - t < ms);
}
/** Per step index, the least it cost over `runs` runs of mk(): {worst, at, steps, value}. */
function stepFloor(mk, runs = RUNS) {
  let floor = null
  let value = null
  for (let r = 0; r < runs; r++) {
    const { times, value: v } = S.stepTimes(mk())
    value = v
    floor = floor ? floor.map((x, i) => Math.min(x, times[i] ?? Infinity)) : times
  }
  let at = 0
  for (let i = 1; i < floor.length; i++) if (floor[i] > floor[at]) at = i
  return { worst: floor[at], at: at + 1, steps: floor.length, value }
}

export async function run() {
  const checks = []
  // Warm-up (JIT): the first run's first steps compile the model.
  CO.drain(GW.bladeGoWeightsGen(S.liveCase()))

  // ---- GB1 ------------------------------------------------------------------
  const c1 = new Check('GB1', "CALIBRATION: the 04:20Z live shape — the fixture's goweights-blade run has the live pass's step count, exit and combat curve")
  checks.push(c1)
  const ref = CO.drain(GW.bladeGoWeightsGen(S.liveCase()))
  const { steps } = stepFloor(() => GW.bladeGoWeightsGen(S.liveCase()), 1)
  const live = fx.goWeights?.detail
  c1.examined(1)
  c1.note(`steps ${steps} vs live ${LIVE_STEPS.join('/')}; exit ${ref.detail?.exitH}h vs live ${live?.exitH}h; combat curve ${JSON.stringify(ref.detail?.combatCurve)} vs live ${JSON.stringify(live?.combatCurve)}; combat ${ref.weights?.combat?.toFixed(3)} vs live ${fx.goWeights?.weights?.combat} h/ln`)
  // Tolerances: the shape, not the number — the multipliers are carried from
  // the 21:50Z capture (mkfix header), the division read 3 min after the pass.
  if (!(steps >= LIVE_STEPS[0] * 0.9 && steps <= LIVE_STEPS[1] * 1.1)) c1.fail(`the fixture's run is not the live shape: ${steps} steps against ${LIVE_STEPS.join('/')}`)
  if (!(Math.abs(ref.detail?.exitH - live?.exitH) < 0.5)) c1.fail(`the fixture's exit ${ref.detail?.exitH}h is not the live ${live?.exitH}h (within 0.5h)`)
  if (ref.detail?.installAtH !== null || !ref.weights) c1.fail('the fixture is not the live no-install shape', JSON.stringify(ref).slice(0, 200))

  // ---- GB2 ------------------------------------------------------------------
  const c2 = new Check('GB2', `no 'goweights-blade' step over ${STEP_MS}ms on the live shape (each step's least cost over ${RUNS} runs), and the measure sees a slow one`)
  checks.push(c2)
  const now = stepFloor(() => GW.bladeGoWeightsGen(S.liveCase()))
  c2.examined(now.steps)
  if (JSON.stringify(now.value) !== JSON.stringify(ref)) c2.fail('the stepped run is not the drained one')
  if (!(now.worst < STEP_MS)) c2.fail(`step ${now.at} of ${now.steps} costs ${now.worst.toFixed(2)}ms in every run (budget ${STEP_MS}ms): a piece of work that does not yield`)
  // THE CONTROL: a startFor STEP_MS + 5 ms slow is one heavy step per exit.
  const slow = stepFloor(() => GW.bladeGoWeightsGen({ ...S.liveCase(), startFor: (sp) => (spin(STEP_MS + 5), S.startFor(sp)) }))
  c2.examined(1)
  if (!(slow.worst >= STEP_MS)) c2.fail(`the measure does not see a ${STEP_MS + 5}ms startFor (longest ${slow.worst.toFixed(2)}ms) — it cannot see the defect`)
  c2.note(`longest step ${now.worst.toFixed(3)}ms (step ${now.at} of ${now.steps}); control with a ${STEP_MS + 5}ms startFor: ${slow.worst.toFixed(1)}ms at step ${slow.at}`)

  // ---- GB3 ------------------------------------------------------------------
  const c3 = new Check('GB3', `under the real pacer the section's longest block stays under ${P.PLAN.maxBlockMs}ms with room for a pause, and the paced weights are the drained ones`)
  checks.push(c3)
  let best = null
  for (let r = 0; r < RUNS; r++) {
    const pacer = CO.makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: () => new Promise((res) => setImmediate(res)), memory: new Map() })
    const v = await pacer.slices(GW.bladeGoWeightsGen(S.liveCase()), 'goweights-blade')
    const sec = pacer.stats.sections['goweights-blade']
    if (JSON.stringify(v) !== JSON.stringify(ref)) c3.fail('the paced weights differ from the drained ones')
    if (!best || sec.maxBlockMs < best.maxBlockMs) best = { ...sec }
  }
  c3.examined(RUNS)
  // The slice (40ms) plus one step: the block can only cross the limit by a step's own cost, which GB2 bounds.
  if (!(best.maxBlockMs < P.PLAN.sliceMs + STEP_MS && best.maxBlockMs < P.PLAN.maxBlockMs)) c3.fail(`the section blocks ${best.maxBlockMs.toFixed(1)}ms in every run (slice ${P.PLAN.sliceMs}ms, limit ${P.PLAN.maxBlockMs}ms)`)
  c3.note(`paced: ${best.cpuMs.toFixed(1)}ms of work in ${best.steps} steps, longest block ${best.maxBlockMs.toFixed(1)}ms, longest step ${best.maxStepMs.toFixed(2)}ms (slice ${P.PLAN.sliceMs}ms, limit ${P.PLAN.maxBlockMs}ms)`)
  return checks
}
