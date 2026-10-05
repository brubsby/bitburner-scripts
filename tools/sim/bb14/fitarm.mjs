// The exit model (bladeExit, 6 members) against the game's classes for named arms' shared policies.
//   node tools/sim/bb14/fitarm.mjs [--arms prev,base] [--seeds 40] [--fx path]
import '../../test/gameresolve.mjs'
import { runFrom, loadFx, FX_PATH, modelStartOf } from '../bb14.mjs'
import { ARMS } from './armdefs.mjs'
const bp = await import('bbplan.js')
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const N = Number(arg('--seeds', 40))
const fx = loadFx(arg('--fx', FX_PATH))
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
for (const name of arg('--arms', 'prev,base').split(',')) {
  const arm = ARMS[name]
  const pol = { ...bp.POLICY, ...(arm.sharedPolicy ?? {}) }
  const hs = []
  for (let s = 1; s <= N; s++) hs.push(runFrom(fx, arm, { seed: s, maxH: 60 }).hours ?? 90)
  const s0 = modelStartOf(fx)
  const Q = bp.BLADE_ENSEMBLE.Q
  const mem = []
  let ms = 0
  for (let m = 0; m < Q; m++) {
    const t0 = Date.now()
    mem.push(bp.bladeExit(bp.bladeMemberOf(s0, m, Q), pol).hours)
    ms = Math.max(ms, Date.now() - t0)
  }
  const mm = bp.bladeMeanOf(mem.map((h) => (Number.isFinite(h) ? h : null))).hours
  const g = mean(hs)
  console.log(`${name.padEnd(14)} game ${g.toFixed(2)}h (${N} seeds) | model ${mm?.toFixed(2)}h (${((mm / g - 1) * 100).toFixed(1)}%), members ${mem.map((h) => h?.toFixed(2)).join(' ')}, max ${ms}ms/member`)
}
process.exit(0)
