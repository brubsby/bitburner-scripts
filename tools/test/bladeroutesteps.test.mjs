// [BS] PLAN BLOCKED THE PAGE in 'plan-bladeRoute' (BN7.1 2026-10-09): one
// 40.1ms step at step 13,111 of 68,122 (78.7ms block), another pass 59.7ms
// at step 68,554, the 23:56Z pass 55,307 steps with the longest 1.6ms.
// The section's steps average ~14us; the slow step moves from pass to pass.
//
// THE VERDICT: a GC pause, not a step that is too coarse. Profiled offline
// on the 23:56Z pass's inputs (tools/sim/plancpu/bladeroute-steps.mjs,
// fixture-bn7-bladeroute-2356.json; the hack arm reproduces the live 371.3h):
// warm runs on the same inputs have NO step over 5ms (worst 0.4-3.9ms over
// five runs); with a page-sized live heap (BALLAST_MB=1500, --trace-gc) the
// only slow steps after warm-up were step 9 (57.0ms) and step 4434 (31.5ms),
// each on a Scavenge of 55.94ms and 31.39ms printed between them — the
// collector, at whichever step the allocation crossed the young generation.
// The section is where a pause lands most often because it is half the
// pass's work (954 of 1954ms) and nearly all its steps.
//
//   BS1 THE STEPS ARE FINE: on the live inputs, warm, the best of two runs
//       has every step under sliceMs/4 — a code change that makes one piece
//       coarse fails here at a fixed step, which is what a GC pause never does

import './gameresolve.mjs'
import { Check } from './harness.mjs'

const P = await import('plan.js')
const S = await import('../sim/plancpu/bladeroute-steps.mjs')

export async function run() {
  const c = new Check('BS1', `the 'plan-bladeRoute' section on the BN7.1 23:56Z inputs, warm: every step under sliceMs/4 (${P.PLAN.sliceMs / 4}ms), the hack arm at the live 371.3h`)
  S.stepped('warm', false)
  const a = S.stepped('a', false)
  const b = S.stepped('b', false)
  const best = a.worst <= b.worst ? a : b
  c.examined(a.steps + b.steps)
  c.note(`${best.steps} steps, ${best.total.toFixed(0)}ms; worst step ${a.worst.toFixed(1)}ms / ${b.worst.toFixed(1)}ms (live ${S.FIXTURE.cpu.steps} steps, longest ${S.FIXTURE.cpu.maxStepMs}ms); hack ${best.d.hackH}h (live ${S.FIXTURE.live.hackH}h)`)
  if (!(best.worst < P.PLAN.sliceMs / 4)) c.fail(`a step of ${best.worst.toFixed(1)}ms on two warm runs: a piece of 'plan-bladeRoute' does not yield (step ${best.slow[0]?.[0] ?? '?'})`)
  if (!(Math.abs(best.d.hackH / S.FIXTURE.live.hackH - 1) < 0.01)) c.fail(`the replay no longer prices the live hack arm: ${best.d.hackH}h vs ${S.FIXTURE.live.hackH}h`)
  return [c]
}
