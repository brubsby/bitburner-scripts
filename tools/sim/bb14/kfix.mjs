// The exit on a frozen live state (bb14 fixture) under rank calibrations: single exit and the plan's members' mean.
//   node tools/sim/bb14/kfix.mjs <fixture> [--model path/to/bbplan.js] [--k 1,1.1964] [--sdLn 0.154]
import '../../test/gameresolve.mjs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadFx, modelStartOf, runFrom } from '../bb14.mjs'
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const bp = await import(arg('--model') ? pathToFileURL(path.resolve(arg('--model'))).href : 'bbplan.js')
const fx = loadFx(argv[0])
// --anchor Aevum:2.025e9:104 — a city whose estimate collapsed (06cf3dc), priced from its last true read
// (bbplan.unreadPopOf: 1% per community consumed since), as the daemon now prices it; the game's classes take it too.
for (const a of (arg('--anchor', '') || '').split(',').filter(Boolean)) {
  const [name, pop, comms] = a.split(':')
  const c = fx.tel.cities.find((x) => x.name === name)
  const u = (await import('bbplan.js')).unreadPopOf(c, { pop: Number(pop), comms: Number(comms) })
  c.pop = u.pop
  console.log(`${name}: estimate ${c.popEst} -> priced ${(u.pop / 1e9).toFixed(3)}e9 (${u.from})`)
}
const sc = fx.bladeRoute?.calibration?.success ?? {}
const ks = arg('--k', `1,${fx.bladeRoute?.calibration?.rank?.k ?? 1}`).split(',').map(Number)
const sdLn = Number(arg('--sdLn', fx.bladeRoute?.calibration?.rank?.sdLn ?? 0))
for (const k of ks) {
  const s0 = { ...modelStartOf(fx), successScale: sc.k ?? 1, successSdLn: sc.sdLn ?? 0, rankScale: k, rankSdLn: sdLn }
  const one = bp.bladeExit({ ...s0, rankSdLn: 0, successSdLn: 0 }).hours
  const Q = bp.BLADE_ENSEMBLE?.Q ?? 6
  const hs = []
  for (let m = 0; m < Q; m++) hs.push(bp.bladeExit(bp.bladeMemberOf(s0, m, Q)).hours)
  const mean = bp.bladeMeanOf(hs.map((h) => (Number.isFinite(h) ? h : null)))
  console.log(`k ${k}: one exit ${one?.toFixed(2)}h; ${Q} members mean ${mean.hours?.toFixed(2)}h (sd ${mean.sdH?.toFixed(2)}) [${hs.map((h) => h?.toFixed(2)).join(' ')}]`)
}
// The game's own classes from the same start (bbsim, the shipped policy, the Go channel at its rate): the exit's truth.
const N = Number(arg('--seeds', 0))
if (N > 0) {
  const hs = []
  for (let seed = 1; seed <= N; seed++) hs.push(runFrom(fx, {}, { seed, maxH: 40 }).hours)
  const ok = hs.filter(Number.isFinite)
  const m = ok.reduce((a, b) => a + b, 0) / ok.length
  const sd = Math.sqrt(ok.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ok.length - 1))
  console.log(`game (${ok.length}/${N} seeds): mean ${m.toFixed(2)}h sd ${sd.toFixed(2)} se ${(sd / Math.sqrt(ok.length)).toFixed(2)}`)
}
process.exit(0)
