// BN6 WHOLE-RUN CALIBRATION of the nodechoice Bladeburner exit (bbsim.mjs: the
// game's classes running bladeburner.js's own policy, bbplan pol.shared) against
// the live BitNode 6 run, 2026-10-01 02:49Z -> 2026-10-02 (~14:30Z expected).
//
//   node tools/sim/nodechoice/bbcal6.mjs [--seeds 5]
//
// MEASURED (history.jsonl, bladeburner.txt): join ~10:30Z (7.7h after entry;
// combat 100 reached by crime at ~2.5h, then four hacking-route installs); the
// sleeves did not infiltrate until 11:20Z on 10-02 (24.8h after the join); the
// exit ~3h after 11:28Z -> Bladeburner leg ~27.9h, node ~35.6h.
// Prints the model's leg for (a) clean (five infiltrators from the join) and
// (b) the run as it went (fleet from +24.8h). THE PLANNERS' k is on (a), with
// the node hours less the opening as the live quantity (35.79 - 2.38h): the
// leg the route formula multiplies is the clean one (nextnode BB_K, gameplan
// params.BB_PARAMS: 1.223). live/model on (b) (0.916) is the bbsim check —
// the game's classes against the run with its own fleet timing — and was the
// planners' k until 2026-10-03: another denominator than the one it multiplied.
import '../../test/gameresolve.mjs'
import { runBladeburner } from './bbsim.mjs'
const bp = await import('bbplan.js')
const i = process.argv.indexOf('--seeds')
const SEEDS = i > -1 ? Number(process.argv[i + 1]) : 5
const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [8, 1], [9, 1], [10, 1]] // held on BN6 entry
const LIVE_LEG = 27.9
const LIVE_NODE_LESS_OPEN = 35.79 - 2.38 // the planners' numerator (gameplan observe.mjs)
const run = (sleevesFromH, seed) => runBladeburner({
  node: 6, sf: SF, g: 0, installEveryH: null, intelligence: 133, hacking: 200, seed, maxH: 300,
  policy: { shared: true, sharedPolicy: bp.POLICY, sleeves: { infiltrate: 5 }, sleevesFromH, gymTo: 100, useEst: false },
})
for (const [label, from] of [['clean: 5 infiltrate from the join', 0], ['as run: fleet from join + 24.8h', 24.8], ['no fleet at all', 999]]) {
  const rs = []
  for (let s = 1; s <= SEEDS; s++) {
    const t0 = Date.now()
    const r = run(from, s)
    rs.push(r)
    process.stderr.write(`${label} seed ${s}: ${r.hours?.toFixed(2)}h (join ${r.joinH.toFixed(2)}h) ${((Date.now() - t0) / 1000).toFixed(0)}s cpu ${r.why ?? ''}\n`)
  }
  const legs = rs.map((r) => (r.hours ?? NaN) - r.joinH).sort((a, b) => a - b)
  const med = legs[Math.floor(legs.length / 2)]
  console.log(`${label.padEnd(40)} leg after join: median ${med.toFixed(2)}h [${legs.map((x) => x.toFixed(1)).join(', ')}]  join ${rs[0].joinH.toFixed(2)}h  live leg/model ${(LIVE_LEG / med).toFixed(3)}${from === 0 ? `  PLANNERS' k (node hours - opening)/clean leg ${(LIVE_NODE_LESS_OPEN / med).toFixed(3)}` : ''}`)
}
process.exit(0)
