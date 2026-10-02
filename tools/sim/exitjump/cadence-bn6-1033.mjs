// IS AN INSTALL EVERY ~1.4h GENUINELY BETTER ON THE BLADEBURNER ROUTE? — the
// 10:33Z state (fixture-bn6-exitjump-1010), every install option the plan
// priced that morning (its batches' blade gains), each priced on the exit
// model from the same start, with the retrain as the policy runs it (one
// pass per gym leg, POLICY.retrainLegS 300s) and as the model had it
// (exp to the bar at the gym rate, retrainLegS 0); with the fleet that ran
// (none on Bladeburner) and the fleet sleeve.js now commits.
//
//   node tools/sim/exitjump/cadence-bn6-1033.mjs
//
// NOT CALIBRATED as a cadence: one state, the batches as the plan named them
// then (later batches differ); the exit model's error against the game's
// classes is -2..+15% (tools/sim/bb6.mjs) — the differences below are
// structural (same start, same draws-free model), not that error.
import '../../test/gameresolve.mjs'
const A = await import('./attribute-bn6-1010.mjs')
const { F, BB } = A
const ms = Date.parse
const i = 6
const at = ms(F.passes[i].at)
const specOf = (p) => p.install.spec
const batches = {
  'w0.36 batch (4 augs)': specOf(F.passes[3]).blade,
  'w1.46 batch (9 augs)': specOf(F.passes[5]).blade,
  'w4 batch (10 augs)': specOf(F.passes[2]).blade,
}
const rows = []
for (const legS of [0, 300]) {
  const pol = { ...BB.POLICY, retrainLegS: legS }
  for (const [fl, sleeves] of [['fleet as run (none)', { infiltrate: 0, support: 0, fa: 0 }], ['fleet i5 (sleeve.js now)', { infiltrate: 5, support: 0, fa: 0 }]]) {
    const x = { ...A.inputsAt(i, { basis: null }), sleeves }
    const h = (install) => BB.bladeExit(A.startOf({ ...x, install }), pol).hours
    const never = h(null)
    const out = [`never ${never.toFixed(2)}`]
    for (const [name, blade] of Object.entries(batches)) {
      for (const w of [0.25, 1.38, 4]) {
        const H = h({ kind: 'wait', waitH: w, installAt: at + w * 3.6e6, blade })
        out.push(`${name} @${w}h ${H.toFixed(2)} (${(H - never >= 0 ? '+' : '') + (H - never).toFixed(2)})`)
      }
    }
    rows.push(`retrainLegS ${legS} | ${fl}\n    ${out.join('\n    ')}`)
  }
}
console.log(rows.join('\n'))
