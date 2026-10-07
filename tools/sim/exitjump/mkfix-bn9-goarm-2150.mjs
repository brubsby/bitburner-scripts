// Build tools/test/fixture-bn9-goarm-2150.json from a read-only capture of the
// live BN9.2 game at 2026-10-07 21:50:44Z (the plan pass) / 21:51:49Z (the
// save, /tel/bladeburner.txt and /tel/go.txt read just after it).
//
//   node tools/sim/exitjump/mkfix-bn9-goarm-2150.mjs <capDir>
//
// capDir holds save.json ({at, player: {skills, exp, mults, city, money}}
// from getSaveFile) and the /tel files plan.txt, bladeburner.txt, go.txt,
// exitinputs.txt (getFile). The previous pass (21:45:43Z) is not in the
// capture — its published numbers are copied from the live plan record read
// at 21:47Z (decisions.install / bladeRoute.start.goCombat), stated below.
// CALIBRATION: none here (it copies); tools/test/bn9goarm.test.mjs [GA1]
// reproduces the 21:50Z point from these inputs before anything else.
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const plan = J('plan.txt')
const go = J('go.txt')
const ei = J('exitinputs.txt')
const ins = plan.decisions.install
const br = plan.decisions.bladeRoute
const out = {
  source: 'live BN9.2, 2026-10-07: plan pass 21:50:44Z; save, /tel/bladeburner.txt and /tel/go.txt read at 21:51:49Z',
  at: plan.at,
  lastAugReset: plan.lastAugReset,
  exit: plan.exit,
  exitStability: plan.exitStability,
  install: { key: ins.key, installAt: ins.installAt, meanH: ins.meanH, pointH: ins.pointH, pointSeH: ins.pointSeH, spec: ins.spec },
  bladeRoute: {
    sleeves: br.sleeves,
    lean: br.lean,
    start: br.start,
    calibration: { rank: { applied: br.calibration.rank.applied, sdLn: br.calibration.rank.sdLn }, success: { applied: br.calibration.success.applied, sdLn: br.calibration.success.sdLn } },
  },
  // The previous pass, as the live plan record published it (read 21:47Z): go.js was on Tetrads@5 from 21:42:00Z to 21:45:36Z.
  prev: {
    at: '2026-10-07T21:45:43.441Z',
    key: 'w1.667',
    installAt: ins.installAt,
    meanH: 15.122,
    pointH: 15.257,
    pointSeH: 0.346,
    goCombat: { effect: 2.43489, nodes: 243777, perHour: 28517, rateSource: "measured: n 243777 over this life's 8.55h", goPower: 1, sf14: 3 },
    opponent: 'Tetrads',
  },
  // The pass before (21:40:44Z), from the 21:45Z record's exitStability: go.js had switched to Daedalus@7 at 21:40:05Z.
  prev2: { at: '2026-10-07T21:40:44.259Z', key: 'w1.75', meanH: 29.275, opponent: 'Daedalus' },
  tel: J('bladeburner.txt'),
  go: { at: go.at, bitNode: go.bitNode, lastAugReset: go.lastAugReset, opponent: go.opponent, goPower: go.goPower, sf14: go.sf14, bonuses: go.bonuses, armHistory: go.armHistory },
  person: J('save.json'),
  inputs: { money: ei.inputs?.money ?? null, flatIncomePerSec: ei.inputs?.flatIncomePerSec ?? 0 },
}
const dest = path.join(path.dirname(new URL(import.meta.url).pathname), '../../test/fixture-bn9-goarm-2150.json')
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`wrote ${dest} (${fs.statSync(dest).size} bytes)`)
