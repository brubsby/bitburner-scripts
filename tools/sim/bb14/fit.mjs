// Does the exit model (bbplan.bladeExit) price the policy the daemon plays?
// The model on the live BN14.1 start (bladeStartOf, k = 1: the formula, as the
// game's classes roll it) against the game's classes running the SAME policy
// (bbsim, tools/sim/bb14.mjs), old and shipped policies.
//
//   node tools/sim/bb14/fit.mjs [--seeds 60] [--fx path]
import '../../test/gameresolve.mjs'
import { runFrom, loadFx, FX_PATH, modelStartOf } from '../bb14.mjs'
import { OLD } from './armdefs.mjs'
const bp = await import('bbplan.js')

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const N = Number(arg('--seeds', 60))
const fx = loadFx(arg('--fx', FX_PATH))
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))]
for (const [label, over] of [['old (BN6-tuned)', OLD], ['shipped', {}]]) {
  const pol = { ...bp.POLICY, ...over }
  const hs = []
  for (let s = 1; s <= N; s++) hs.push(runFrom(fx, { sharedPolicy: over, skillEveryS: pol.skillEveryS }, { seed: s, maxH: 90 }).hours ?? 135)
  const s0 = modelStartOf(fx)
  const t0 = Date.now()
  const one = bp.bladeExit(s0, pol).hours
  const ms = Date.now() - t0
  const Q = bp.BLADE_ENSEMBLE.Q
  const mem = []
  for (let m = 0; m < Q; m++) mem.push(bp.bladeExit(bp.bladeMemberOf(s0, m, Q), pol).hours)
  const mm = bp.bladeMeanOf(mem.map((h) => (Number.isFinite(h) ? h : null))).hours
  const g = mean(hs)
  console.log(`${label.padEnd(18)} game mean ${g.toFixed(2)}h [q10 ${q(hs, 0.1).toFixed(1)} q90 ${q(hs, 0.9).toFixed(1)}] (${N} seeds) | model one ${one?.toFixed(2)}h (${((one / g - 1) * 100).toFixed(0)}%, ${ms}ms), ${Q}-member mean ${mm?.toFixed(2)}h (${((mm / g - 1) * 100).toFixed(0)}%)  members ${mem.map((h) => h?.toFixed(1)).join(' ')}`)
}
process.exit(0)
