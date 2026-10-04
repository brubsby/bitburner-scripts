// The simulated path from the live start: rank, black ops done, the next black op's chance, combat levels, per half hour.
//   node tools/sim/bb14/path.mjs [--seeds 10] [--arm base] [--fx path]
import '../../test/gameresolve.mjs'
import { runFrom, loadFx, FX_PATH } from '../bb14.mjs'
import { ARMS } from './armdefs.mjs'
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const fx = loadFx(arg('--fx', FX_PATH))
const N = Number(arg('--seeds', 10))
const arm = ARMS[arg('--arm', 'base')]
const rows = {}
const hs = []
for (let seed = 1; seed <= N; seed++) {
  const r = runFrom(fx, {
    ...arm,
    onStep: ({ t, bb }) => {
      if (t % 1800 >= 3) return
      const h = t / 3600
      const next = bb.blackOperationArray[bb.numBlackOpsComplete]
      const P = bb.__P
      ;(rows[h] ??= []).push({ rank: bb.rank, bo: bb.numBlackOpsComplete, p: next ? next.getSuccessChance(bb, globalThis.__P, { est: false }) : 1, str: globalThis.__P.skills.strength, agi: globalThis.__P.skills.agility, lv: { ...bb.skills } })
      void P
    },
    setup: (o) => {
      globalThis.__P = o.P
      arm.setup?.(o)
    },
  }, { seed, maxH: 40 })
  hs.push(r.hours)
}
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
console.log(`arm ${arg('--arm', 'base')}, ${N} seeds from ${fx.at}; exit median ${med(hs.filter(Number.isFinite)).toFixed(2)}h`)
for (const h of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
  if (h > 24) break
  const x = rows[h]
  const lv = x[0].lv
  console.log(`${h.toFixed(1).padStart(5)}h  rank ${Math.round(med(x.map((y) => y.rank))).toString().padStart(7)}  bo ${med(x.map((y) => y.bo))}  next p ${med(x.map((y) => y.p)).toFixed(3)}  str ${med(x.map((y) => y.str))} agi ${med(x.map((y) => y.agi))}  seed1 skills ${Object.entries(lv).filter(([, v]) => v > 0).map(([k, v]) => `${k.slice(0, 6)}${v}`).join(' ')}`)
}
process.exit(0)
