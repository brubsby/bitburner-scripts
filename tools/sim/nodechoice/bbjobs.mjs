// Worker: run a batch of Bladeburner jobs (bbsim.runBladeburner specs) and
// print one JSON line per result. run.mjs fans these out across processes —
// each run is single-threaded game code, and the game module state (Player,
// currentNodeMults, Math.random) is per process.
//
//   node tools/sim/nodechoice/bbjobs.mjs <jobs.json>

import fs from 'node:fs'
import { runBladeburner } from './bbsim.mjs'

const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
for (const j of jobs) {
  let out
  try {
    const r = runBladeburner(j.spec)
    out = { key: j.key, hours: r.hours, rank: r.rank, blackOps: r.blackOps, installs: r.installs, why: r.why }
  } catch (e) {
    out = { key: j.key, hours: null, why: `threw: ${String(e?.stack ?? e).slice(0, 300)}` }
  }
  process.stdout.write(JSON.stringify(out) + '\n')
}
process.exit(0)
