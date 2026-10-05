// The black-op decisions of one arm on the game's classes: every attempt (p, the rule's why) and its outcome.
//   node tools/sim/bb14/botrace.mjs [--arm priced] [--seed 1] [--fx path]
import '../../test/gameresolve.mjs'
import { runFrom, loadFx, FX_PATH } from '../bb14.mjs'
import { ARMS } from './armdefs.mjs'
const bp = await import('bbplan.js')
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const fx = loadFx(arg('--fx', FX_PATH))
const name = arg('--arm', 'priced')
const arm = ARMS[name]
const seed = Number(arg('--seed', 1))
let lastWhy = null
let tNow = 0
const rows = []
const r = runFrom(fx, {
  ...arm,
  onStep: ({ t }) => (tNow = t),
  choose: (v, pol, ctx) => {
    const pick = (arm.choose ?? ((vv, pp) => bp.chooseAction(vv, pp)))(v, pol, ctx)
    if (pick.blackOp) {
      const key = `${pick.name}`
      if (lastWhy !== key || rows.length === 0 || tNow - rows[rows.length - 1].t > 0) rows.push({ t: tNow, h: (tNow / 3600).toFixed(2), rank: Math.round(v.rank), name: pick.name, p: pick.p.toFixed(3), why: pick.why })
      lastWhy = key
    }
    return pick
  },
}, { seed, maxH: 30 })
let prev = null
for (const x of rows) {
  if (prev && prev.name === x.name && x.t - prev.t < 1) continue
  console.log(`${x.h}h rank ${x.rank} ${x.name} p ${x.p}  ${x.why.slice(0, 150)}`)
  prev = x
}
console.log(`${name} seed ${seed}: ${r.hours?.toFixed(2)}h, boAt ${r.boAt.join(' ')}`)
process.exit(0)
