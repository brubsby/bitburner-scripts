// Build tools/test/fixture-bn9-gofarm-2240.json from a read-only copy of the
// live BN9.2 telemetry at 2026-10-07 22:40Z (the plan pass that priced
// decisions.bladeRoute at 22:40:45.580Z, its exit inputs at 22:40:47.045Z).
//
//   node tools/sim/exitjump/mkfix-bn9-gofarm-2240.mjs <capDir>
//
// capDir holds the /tel files exitinputs.txt, plan.txt, go.txt and batch.txt
// as the daemon mirrored them (.telemetry/). The exit inputs are the hacking
// arm's (decisions.bladeRoute 'hack', the default policy on the Bladeburner
// route): built by the code BEFORE the explicit Go channel, so they carry
// goCadenceMult 1.00497 (the retired eps14 power) inside multGainPerCycle.
// CALIBRATION: none here (it copies); tools/test/gofarm.test.mjs [GF1]
// reproduces the published hack point from these inputs before anything else.
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const ei = J('exitinputs.txt')
const plan = J('plan.txt')
const go = J('go.txt')
const batch = J('batch.txt')
const br = plan.decisions.bladeRoute
const out = {
  source: 'live BN9.2, 2026-10-07: decisions.bladeRoute priced 22:40:45.580Z; /tel/exitinputs.txt 22:40:47.045Z; go.txt 22:43:35Z; batch.txt ram',
  exitInputs: ei,
  bladeRoute: { key: br.key, pricedAt: br.pricedAt, hackH: br.hackH, bladeH: br.bladeH, meanH: br.meanH, margins: br.margins, why: br.why },
  go: { at: go.at, bitNode: go.bitNode, lastAugReset: go.lastAugReset, goPower: go.goPower, sf14: go.sf14, w0: go.w0, bonuses: go.bonuses },
  batchRam: batch.ram,
}
const dest = path.join(path.dirname(new URL(import.meta.url).pathname), '../../test/fixture-bn9-gofarm-2240.json')
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`wrote ${dest} (${fs.statSync(dest).size} bytes)`)
