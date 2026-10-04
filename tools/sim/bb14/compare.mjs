// The simulated state at the live clock (from the earlier fixture) against the live later fixture: what differs.
//   node tools/sim/bb14/compare.mjs <earlier.json> <later.json> [--seeds 6]
import '../../test/gameresolve.mjs'
import { runFrom, loadFx } from '../bb14.mjs'
const argv = process.argv.slice(2)
const a = loadFx(argv[0])
const b = loadFx(argv[1])
const i = argv.indexOf('--seeds')
const N = i > -1 ? Number(argv[i + 1]) : 6
const atS = (Date.parse(b.at) - Date.parse(a.at)) / 1000
const r1 = (x) => Math.round(x)
const line = (lab, o) => console.log(`${lab.padEnd(8)} rank ${r1(o.rank)} sp ${o.sp} p ${o.p.toFixed(3)} sta ${o.sta.toFixed(0)}/${o.max.toFixed(0)} str ${o.str} agi ${o.agi} raidCount ${r1(o.raid)} raidMaxL ${o.raidL} | ${o.cities} | ${o.skills}`)
for (let seed = 1; seed <= N; seed++) {
  let snap = null
  runFrom(a, {
    setup: ({ P }) => (globalThis.__P = P),
    onStep: ({ t, bb }) => {
      if (snap || t < atS) return
      const P = globalThis.__P
      const next = bb.blackOperationArray[bb.numBlackOpsComplete]
      snap = { rank: bb.rank, sp: bb.skillPoints, p: next.getSuccessChance(bb, P, { est: false }), sta: bb.stamina, max: bb.maxStamina, str: P.skills.strength, agi: P.skills.agility, raid: bb.operations.Raid.count, raidL: bb.operations.Raid.maxLevel, cities: Object.entries(bb.cities).map(([n, c]) => `${n.slice(0, 3)} ${(c.pop / 1e9).toFixed(2)}e9 c${r1(c.comms)} x${c.chaos.toFixed(0)}`).join(' '), skills: Object.entries(bb.skills).filter(([, v]) => v > 0).map(([k, v]) => `${k.slice(0, 5)}${v}`).join(' ') }
    },
  }, { seed, maxH: atS / 3600 + 0.01 })
  line(`sim ${seed}`, snap)
}
const t = b.tel
line('LIVE', { rank: t.rank, sp: t.skillPoints, p: t.blackOps.chance[0], sta: t.stamina, max: t.maxStamina, str: b.person.skills.strength, agi: b.person.skills.agility, raid: t.counts.Raid, raidL: t.maxLevels.Raid, cities: t.cities.map((c) => `${c.name.slice(0, 3)} ${((c.pop ?? c.popEst) / 1e9).toFixed(2)}e9 c${c.comms} x${c.chaos.toFixed(0)}`).join(' '), skills: Object.entries(t.levels).filter(([, v]) => v > 0).map(([k, v]) => `${k.slice(0, 5)}${v}`).join(' ') })
process.exit(0)
