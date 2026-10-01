// BN6 BLADEBURNER CALIBRATION REPLAY — the exit model's rank path from the
// captured 13:22Z state against the rank the game actually paid until 22:15Z.
//
//   node tools/sim/bbcal.mjs [--model /path/to/bbplan.js]   (default: the repo's bbplan.js)
//
// Fixture: tools/test/fixture-bn6-bladecal-1322.json (bladeburner.txt, the
// save's TRUE city populations and the player at 13:22Z; the realised rank
// every 5 min to 22:15Z, one life, the slot on Bladeburner throughout).
// Prints, for each variant of the start, the model's rank at each hour
// beside the realised one and the calibration ratio (realised gain / model
// gain), and the attribution of the exit to the inputs that were wrong
// on 2026-10-01 (the cities' estimates, the sleeves nobody ran).
// CALIBRATED: this IS the calibration (one life, one state, ~9h of rank);
// the plan carries the same ratio as a posterior (bbplan.rankRatePosterior).
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../test/gameresolve.mjs'

const i = process.argv.indexOf('--model')
const BB = i > -1 ? await import(pathToFileURL(path.resolve(process.argv[i + 1])).href) : await import('bbplan.js')
const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn6-bladecal-1322.json'), 'utf8'))
const T0 = Date.parse(F.bladeburner.at)
const real = F.realised.map((r) => ({ h: (Date.parse(r.at) - T0) / 3.6e6, rank: r.rank }))
const realAt = (h) => {
  let a = real[0]
  for (const b of real) {
    if (b.h >= h) return a.rank + ((b.rank - a.rank) * (h - a.h)) / (b.h - a.h || 1)
    a = b
  }
  return null
}
const truePops = F.bladeburner.cities.map((c) => ({ ...c, pop: F.save.cities[c.name].pop }))
const noBB = { infiltrate: 0, support: 0, fa: 0 }
const VARIANTS = [
  ['as published (popEst, 5 infiltrate)', { infiltrate: 5, support: 0, fa: 0 }, F.bladeburner.cities.map(({ pop: _p, ...c }) => c)],
  ['true populations, 5 infiltrate', { infiltrate: 5, support: 0, fa: 0 }, truePops],
  ['popEst, the sleeves as run (none)', noBB, F.bladeburner.cities.map(({ pop: _p, ...c }) => c)],
  ['as it ran: true populations, no sleeves', noBB, truePops],
]
const H = [1, 2, 3, 4, 5, 6, 7, 8, 8.8]
console.log(`realised rank from ${F.bladeburner.at} (${F.bladeburner.rank}): ${H.map((h) => `${h}h ${Math.round(realAt(h))}`).join(', ')}`)
for (const [label, sleeves, cities] of VARIANTS) {
  const s0 = { ...BB.bladeStartOf({ tel: { ...F.bladeburner, cities }, person: F.player, sleeves, gymExpPerSec: 30, bnRank: 1 }), pathEveryS: 900, traceEveryS: 900 }
  const r = BB.bladeExit(s0)
  const pts = r.path ?? [{ h: 0, rank: F.bladeburner.rank }, ...r.trace.map((x) => ({ h: x.h, rank: x.rank }))]
  const at = (h) => {
    let a = pts[0]
    for (const b of pts) {
      if (b.h >= h) return a.rank + ((b.rank - a.rank) * (h - a.h)) / (b.h - a.h || 1)
      a = b
    }
    return a.rank
  }
  const ratio = (realAt(8.8) - F.bladeburner.rank) / (at(8.8) - F.bladeburner.rank)
  console.log(`${label.padEnd(42)} exit ${r.hours?.toFixed(2)}h | ${H.map((h) => Math.round(at(h))).join(' ')} | realised/model gain over 8.8h ${ratio.toFixed(3)}`)
}
