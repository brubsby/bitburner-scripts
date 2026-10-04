// The plan's projected BN14 exit (members' mean, the live calibrations) under POLICY_V1 and the shipped POLICY, same start.
import '../../test/gameresolve.mjs'
import { loadFx, modelStartOf } from '../bb14.mjs'
const bp = await import('bbplan.js')
const fx = loadFx()
const cal = fx.bladeRoute.calibration
const base = modelStartOf(fx)
const s0 = { ...base, rankScale: cal.rank.applied, successScale: cal.success.applied, rankSdLn: cal.rank.sdLn, successSdLn: cal.success.sdLn, skillSinceS: (Date.parse(fx.at) - Date.parse(fx.tel.skillsAt)) / 1000 }
for (const [label, over] of [['POLICY_V1', bp.POLICY_V1], ['shipped', null]]) {
  const s = over ? { ...s0, policy: over } : s0
  const Q = bp.BLADE_ENSEMBLE.Q
  const hs = []
  for (let m = 0; m < Q; m++) hs.push(bp.bladeExit(bp.bladeMemberOf(s, m, Q)).hours)
  const e = bp.bladeMeanOf(hs)
  console.log(`${label.padEnd(10)} calibrated (rank k ${cal.rank.applied}, success k ${cal.success.applied}): mean ${e.hours.toFixed(2)}h sd ${e.sdH?.toFixed(2)} members ${hs.map((h) => h?.toFixed(1)).join(' ')} | k=1 single ${bp.bladeExit(over ? { ...base, policy: over } : base).hours.toFixed(2)}h`)
}
console.log(`published at capture: ${fx.bladeRoute.bladeH}h (q10 ${fx.bladeRoute.q10} q90 ${fx.bladeRoute.q90})`)
process.exit(0)
