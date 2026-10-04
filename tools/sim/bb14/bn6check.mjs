// Does the BN14-tuned skill policy hold in BN6 (from entry, the bb6.mjs stack, 5 infiltrators) and BN4-like ranks?
// The game's classes (bbsim) on CRN-paired seeds, POLICY_V1 vs the shipped POLICY, plus the model on each.
//   node tools/sim/bb14/bn6check.mjs [--seeds 6]
import '../../test/gameresolve.mjs'
import { runBladeburner } from '../nodechoice/bbsim.mjs'
const bp = await import('bbplan.js')
const i = process.argv.indexOf('--seeds')
const SEEDS = i > -1 ? Number(process.argv[i + 1]) : 6
const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [8, 1], [9, 1], [10, 1]]
for (const node of [6, 7]) {
  const rows = {}
  for (const [label, over] of [['V1', bp.POLICY_V1], ['shipped', {}]]) {
    const pol = { ...bp.POLICY, ...over }
    rows[label] = []
    for (let s = 1; s <= SEEDS; s++) {
      const r = runBladeburner({ node, sf: node === 7 ? [...SF, [6, 1]] : SF, g: 0, installEveryH: null, intelligence: 133, hacking: 300, seed: s, maxH: 300, policy: { shared: true, sharedPolicy: pol, sleeves: { infiltrate: 5 }, gymTo: 100, useEst: false, skillEveryS: pol.skillEveryS } })
      rows[label].push(r.hours ?? 450)
    }
  }
  const m = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const d = rows.shipped.map((h, k) => h - rows.V1[k])
  console.log(`BN${node}: V1 ${m(rows.V1).toFixed(2)}h [${rows.V1.map((x) => x.toFixed(1)).join(' ')}]  shipped ${m(rows.shipped).toFixed(2)}h [${rows.shipped.map((x) => x.toFixed(1)).join(' ')}]  paired diff ${m(d).toFixed(2)}h, shipped faster ${d.filter((x) => x < 0).length}/${SEEDS}`)
}
process.exit(0)
