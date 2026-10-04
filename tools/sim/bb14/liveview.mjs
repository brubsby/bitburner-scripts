// The live daemon's view rebuilt from /tel/bladeburner.txt (bladeburner.js readEnv): every action's best level in two cities.
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
const bp = await import('bbplan.js')
const T = process.env.HOME + '/Repos/bitburner-scripts/.telemetry/'
const tel = JSON.parse(fs.readFileSync(T + 'bladeburner.txt', 'utf8'))
const st = JSON.parse(fs.readFileSync(T + 'state.json', 'utf8'))
const person = { skills: st.skills, mults: { bladeburner_success_chance: 1 } }
const sm = bp.skillMultsOf(tel.levels)
const ref = tel.cities.find((c) => c.name === tel.city)
const v = {
  person, sm, levels: tel.levels, bnRank: 0.6, rank: tel.rank, stamina: tel.stamina, maxStamina: tel.maxStamina, staminaGain: bp.staminaGainOf(person, sm, tel.maxStamina), resting: false,
  ref: { pop: ref.popEst, chaos: ref.chaos }, cities: tel.cities.map((c) => ({ name: c.name, pop: c.pop ?? c.popEst, chaos: c.chaos, comms: c.comms })), city: tel.city,
  actions: bp.LEVELED.map((d) => ({ d, count: tel.counts[d.name], maxLevel: tel.maxLevels[d.name], K: d.kind === 'contract' ? tel.env.contracts : tel.env.operations, width: 0 })), blackOp: null,
}
console.log(tel.at, tel.city, 'env', tel.env, 'team', tel.team)
for (const a of v.actions) {
  for (const c of v.cities) {
    if (c.name !== 'Aevum' && c.name !== 'Chongqing') continue
    const f = bp.cityFactor(c, v.ref)
    const b = bp.bestLevel(a, v, bp.POLICY, f)
    const b2 = bp.bestLevel(a, v, { ...bp.POLICY, minP: 0.01 }, f)
    console.log(a.d.name.padEnd(30), c.name.padEnd(10), 'f', f.toFixed(3), b ? `L${b.L} p${b.p.toFixed(3)} ev${b.ev.toFixed(4)} t${b.t}` : '-', b2 ? `| any: L${b2.L} p${b2.p.toFixed(3)} ev${b2.ev.toFixed(4)}` : '')
  }
}
console.log(bp.chooseAction(v))
