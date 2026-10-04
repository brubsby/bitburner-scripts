// One frozen live state (a bb14 fixture): the model's rank path (rankScale 1) against the game's
// classes (bbsim, seeds) over the next hours — is a window's lead the model's or the inputs'?
//   node tools/sim/bb14/kwin.mjs <fixture> [--h 1] [--seeds 12] [--goRate n] [--sleeves i,s,f]
import '../../test/gameresolve.mjs'
import { loadFx, modelStartOf, runFrom } from '../bb14.mjs'
const BB = await import('bbplan.js')
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
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
const H = Number(arg('--h', 1))
const N = Number(arg('--seeds', 12))
if (arg('--goRate')) fx.bladeRoute.start.goCombat.perHour = Number(arg('--goRate'))
const sl = arg('--sleeves') ? Object.fromEntries(arg('--sleeves').split(',').map(Number).map((v, i) => [['infiltrate', 'support', 'fa'][i], v])) : null
const s0 = modelStartOf(fx, { sleeves: sl })
const sc = fx.bladeRoute?.calibration?.success?.k ?? 1
const hs = [0.25, 0.5, 0.75, 1, 1.5, 2, 3].filter((h) => h <= H + 1e-9)
const m1 = BB.bladeExit({ ...s0, maxH: H + 0.1, pathEveryS: 300 })
const mS = BB.bladeExit({ ...s0, successScale: sc, maxH: H + 0.1, pathEveryS: 300 })
const r0 = fx.tel.rank
console.log(`${fx.at} rank ${r0}, fleet ${JSON.stringify(sl ?? fx.bladeRoute.sleeves)}, go perHour ${fx.bladeRoute.start.goCombat.perHour}`)
console.log(`model (success 1):      ${hs.map((h) => `+${h}h ${(BB.rankOnPath(m1.path, h) - r0).toFixed(0)}`).join('  ')}`)
console.log(`model (success ${sc}): ${hs.map((h) => `+${h}h ${(BB.rankOnPath(mS.path, h) - r0).toFixed(0)}`).join('  ')}`)
const rows = {}
for (let seed = 1; seed <= N; seed++) {
  runFrom(fx, { onStep: ({ t, bb }) => { if (t % 900 < 3) (rows[Math.round(t / 900) / 4] ??= []).push(bb.rank - r0) } }, { seed, maxH: H + 0.05 })
}
const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length
const sd = (x) => Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2)))
console.log(`game (${N} seeds):        ${hs.map((h) => `+${h}h ${mean(rows[h] ?? [NaN]).toFixed(0)} (sd ${sd(rows[h] ?? [NaN]).toFixed(0)})`).join('  ')}`)
process.exit(0)
