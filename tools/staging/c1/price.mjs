// Price root scripts vs their tools/staging/c1 copies, using the game's own
// RamCalculations (tools/test/ram.mjs), which walks the whole import graph.
import fs from 'node:fs'
import * as R from '/home/tbusby/Repos/bitburner-scripts/tools/test/ram.mjs'

const STAGE = '/home/tbusby/Repos/bitburner-scripts/tools/staging/c1'
const FILES = ['autobuy.js','backdoor.js','batch.js','ctauto.js','go.js','homeup.js','nfg.js','settings.js','share.js','watchdog.js']
await R.load()

for (const [label, save] of [['BN4 (live save)', { bitNode: 4, sf: {} }], ['BN1 no SF', { bitNode: 1, sf: {} }], ['BN1 SF4.1', { bitNode: 1, sf: { 4: 1 } }]]) {
  R.asSave(save)
  console.log(`\n=== ${label} ===`)
  let bad = 0
  for (const f of FILES) {
    const before = R.ramOf(f)
    const after = R.priceCode(fs.readFileSync(`${STAGE}/${f}`, 'utf8'), f)
    const b = before.cost ?? `ERR ${before.error}`
    const a = after.cost ?? `ERR ${after.error}`
    const d = typeof b === 'number' && typeof a === 'number' ? (a - b).toFixed(2) : '?'
    if (d !== '0.00') bad++
    console.log(`${f.padEnd(14)} before ${String(b).padStart(8)}  after ${String(a).padStart(8)}  delta ${String(d).padStart(6)}`)
  }
  console.log(bad ? `  ${bad} file(s) NOT zero-delta` : '  all deltas 0.00')
}
