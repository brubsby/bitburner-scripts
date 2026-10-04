// BN14.1 Bladeburner policy audit: every arm against the shipped policy on the
// SAME seeds (CRN-paired: Math.random is seeded per run, so the game's rolls
// line up until the decisions diverge), from the live state (tools/sim/bb14.mjs).
//
//   node tools/sim/bb14/arms.mjs [--seeds 30] [--arms a,b,c] [--fx path] [--maxH 90]
//
// Prints per arm: mean hours to the 21st black op, the paired difference
// (arm - base) with its standard error, and the share of seeds the arm wins.
import '../../test/gameresolve.mjs'
import { runFrom, loadFx, FX_PATH } from '../bb14.mjs'
import { ARMS } from './armdefs.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const N = Number(arg('--seeds', 30))
const S0 = Number(arg('--seed0', 1))
const maxH = Number(arg('--maxH', 90))
const fx = loadFx(arg('--fx', FX_PATH))
const names = arg('--arms', Object.keys(ARMS).join(',')).split(',')
const seeds = Array.from({ length: N }, (_, i) => S0 + i)

const hoursOf = (arm) => seeds.map((seed) => {
  const r = runFrom(fx, arm, { seed, maxH })
  return r.hours ?? maxH * 1.5 // unfinished: censored, charged 1.5x the horizon (named in the row)
})
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1))
}
const med = (xs) => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
}
console.log(`from ${fx.at} rank ${fx.tel.rank}; ${N} seeds (${S0}..${S0 + N - 1}), maxH ${maxH}`)
const t0 = Date.now()
const BASE = arg('--base', 'base')
const base = hoursOf(ARMS[BASE])
console.log(`${BASE.padEnd(26)} mean ${mean(base).toFixed(2)}h  median ${med(base).toFixed(2)}h  sd ${sd(base).toFixed(2)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
for (const name of names) {
  if (name === 'base') continue
  const arm = ARMS[name]
  if (!arm) {
    console.log(`${name}: no such arm`)
    continue
  }
  const t1 = Date.now()
  const hs = hoursOf(arm)
  const d = hs.map((h, i) => h - base[i])
  const se = sd(d) / Math.sqrt(d.length)
  const wins = d.filter((x) => x < 0).length
  const unf = hs.filter((h) => h >= maxH * 1.5).length
  console.log(`${name.padEnd(26)} mean ${mean(hs).toFixed(2)}h  median ${med(hs).toFixed(2)}h  diff ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(2)}h ± ${se.toFixed(2)} (se)  wins ${wins}/${N}${unf ? `  UNFINISHED ${unf}` : ''}  (${((Date.now() - t1) / 1000).toFixed(0)}s)`)
}
process.exit(0)
