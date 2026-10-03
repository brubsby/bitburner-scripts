// THE UNREAD CITIES' PRIOR — what the six Bladeburner cities look like after
// the division has existed `age` hours, from the game's own mechanics:
// City.ts (population U{1e9..1.5e9}, communities U{5..150}, chaos 0) and one
// random event per U{240..600}s (bbplan.drawCityEvent, the game's
// randomEvent/triggerMigration), no actions. Per rank by population (the
// policy stands in the best city): the population whose success factor is
// the mean one, ((E[(pop/1e9)^0.7])^(1/0.7) x 1e9, Action.ts
// getPopulationSuccessFactor), the mean communities and chaos.
//
//   node tools/sim/bbcityprior.mjs [--seeds 4000]      prints bbplan.CITY_PRIOR
//
// CALIBRATION: none to fit — every step is the game's own (City.ts,
// Bladeburner.ts randomEvent); tools/test/bladecal4.test.mjs [B4-2]
// regenerates the table at 600 seeds and holds it to 6%.
//
// Why: bb-lite.js cannot read the cities (16GB of ns.bladeburner it gives
// up), and the exit model priced them at the INITIAL distribution's
// quantiles (1.07-1.43e9) — live BN4 2026-10-03 the six true populations were
// 1.19-2.69e9 at 6.8h, and the bb-lite-era exit fell 7.05h in 1.28h when the
// full daemon published them (tools/sim/bbcal4.mjs).
import '../test/gameresolve.mjs'
const BB = await import('bbplan.js')
const i = process.argv.indexOf('--seeds')
const SEEDS = i > -1 ? Number(process.argv[i + 1]) : 4000
export function rngOf(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function priorRow(ageH, seeds, seed0 = 1) {
  const n = BB.CITY_NAMES.length
  const f = new Array(n).fill(0)
  const comms = new Array(n).fill(0)
  const chaos = new Array(n).fill(0)
  for (let s = 0; s < seeds; s++) {
    const rng = rngOf(seed0 + s * 7919)
    const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
    const cs = BB.CITY_NAMES.map(() => ({ pop: ri(1e9, 1.5e9), comms: ri(5, 150), chaos: 0 }))
    let t = ri(240, 600)
    let last = 0
    while (t <= ageH * 3600) {
      for (const c of cs) c.chaos = Math.max(0, c.chaos - 0.0001 * (t - last))
      last = t
      BB.drawCityEvent(cs, rng)
      t += ri(240, 600)
    }
    for (const c of cs) c.chaos = Math.max(0, c.chaos - 0.0001 * (ageH * 3600 - last))
    cs.sort((a, b) => b.pop - a.pop)
    cs.forEach((c, k) => {
      f[k] += Math.pow(c.pop / 1e9, 0.7)
      comms[k] += c.comms
      chaos[k] += c.chaos
    })
  }
  return { ageH, pop: f.map((x) => +(Math.pow(x / seeds, 1 / 0.7)).toFixed(3)), comms: comms.map((x) => +(x / seeds).toFixed(1)), chaos: chaos.map((x) => +(x / seeds).toFixed(2)) }
}
if (/bbcityprior\.mjs$/.test(process.argv[1] ?? '')) {
  const rows = BB.CITY_PRIOR_AGES.map((a) => priorRow(a, SEEDS))
  console.log('export const CITY_PRIOR = [')
  for (const r of rows) console.log(`  { ageH: ${r.ageH}, pop: [${r.pop.join(', ')}], comms: [${r.comms.join(', ')}], chaos: [${r.chaos.join(', ')}] },`)
  console.log(']')
}
