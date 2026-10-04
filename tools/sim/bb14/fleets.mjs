// The exit model's fleet ranking on the live start under the shipped policy (what sleeve.js's chooseSleeveConfig sees).
import '../../test/gameresolve.mjs'
import { loadFx, modelStartOf } from '../bb14.mjs'
const bp = await import('bbplan.js')
const fx = loadFx()
for (const f of [{ infiltrate: 1, support: 4, fa: 0 }, { infiltrate: 0, support: 5, fa: 0 }, { infiltrate: 2, support: 0, fa: 3 }, { infiltrate: 5, support: 0, fa: 0 }, { infiltrate: 2, support: 3, fa: 0 }]) {
  console.log(JSON.stringify(f), bp.bladeExit(modelStartOf(fx, { sleeves: f })).hours?.toFixed(2))
}
const pick = bp.chooseSleeveConfig(modelStartOf(fx), 5)
console.log('chooseSleeveConfig ->', JSON.stringify(pick.config), pick.hours?.toFixed?.(2))
process.exit(0)
