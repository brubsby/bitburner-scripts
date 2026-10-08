// Build tools/test/fixture-bn9-goweights-0420.json: the live BN9.2 Bladeburner
// start of the 04:20Z 2026-10-08 pass ("PLAN BLOCKED THE PAGE: a 75.9ms
// synchronous block against 50ms — longest step 42.3ms in 'goweights-blade'
// (step 1231 of 3945)"), from the on-disk telemetry mirror only (read-only:
// nothing is asked of the game).
//
//   node tools/sim/exitjump/mkfix-bn9-goweights-0420.mjs [telemetryDir]
//
//   plan.txt         04:21:07Z: decisions.bladeRoute (start, sleeves, lean, calibration), lastAugReset
//   bladeburner.txt  04:23:25Z: the division (rank 10354, 266 points, full daemon)
//   state.json       04:20:42Z: skills, exp, city, money
//   exitinputs.txt   04:21:07Z: money, flatIncomePerSec
// NOT on disk: the player's multipliers. The life is the same as
// fixture-bn9-goarm-2150's (no install between: state.json augmentations []),
// so its multipliers are taken from there with the combat ones moved from
// that capture's Go effect (x2.43489) to this pass's (plan.txt goCombat
// x2.76068) — the one thing that changed them (bladeGoCombatOf).
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const dir = process.argv[2] ?? path.join(here, '../../../.telemetry')
const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const plan = J('plan.txt')
const bb = J('bladeburner.txt')
const st = J('state.json')
const ei = J('exitinputs.txt')
const old = JSON.parse(fs.readFileSync(path.join(here, '../../test/fixture-bn9-goarm-2150.json'), 'utf8'))
const br = plan.decisions.bladeRoute
const goOld = old.bladeRoute.start.goCombat.effect
const goNow = br.start.goCombat.effect
const mults = { ...old.person.player.mults }
for (const k of ['strength', 'defense', 'dexterity', 'agility']) mults[k] = (mults[k] / goOld) * goNow
const out = {
  source: `live BN9.2, 2026-10-08: plan pass ${plan.at}; bladeburner.txt ${bb.at}; state.json ${st.at}; multipliers from fixture-bn9-goarm-2150 at the Go effect x${goNow}`,
  at: plan.at,
  lastAugReset: plan.lastAugReset,
  exitH: br.bladeH,
  goWeights: J('installgate.txt')?.objective?.goWeights ?? null,
  bladeRoute: {
    sleeves: br.sleeves,
    lean: br.lean,
    start: br.start,
    calibration: { rank: { applied: br.calibration.rank.applied, sdLn: br.calibration.rank.sdLn }, success: { applied: br.calibration.success.applied, sdLn: br.calibration.success.sdLn } },
  },
  tel: bb,
  person: { at: st.at, player: { skills: st.skills, exp: st.exp, mults, city: st.city, money: st.money } },
  inputs: { money: ei.inputs?.money ?? null, flatIncomePerSec: ei.inputs?.flatIncomePerSec ?? 0 },
}
const dest = path.join(here, '../../test/fixture-bn9-goweights-0420.json')
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`wrote ${dest} (${fs.statSync(dest).size} bytes)`)
