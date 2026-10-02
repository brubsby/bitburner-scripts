// THE HOURS bb-lite.js SAVES — a model replay of the BN6 and BN4 openings.
//
//   TELEMETRY=~/Repos/bitburner-scripts/.telemetry node tools/sim/bblite-savings.mjs [--seeds 3] [--hours 4]
//
// The black-op exit is (the join) + (the leg after it). The leg does not
// depend on when the join happens, so the early join saves
//
//   saved = joinFull - joinLite - deficit
//
//   joinLite   the first time every combat stat is at 100 (bb-lite.js is
//              placeable from tier 32: a 5.6GB coordinator, <=14.6GB actors)
//   joinFull   the first time combat is at 100 AND a host holds bladeburner.js
//              (92.75GB free in one block)
//   deficit    the lean policy's shortfall over [joinLite, joinFull]: the
//              hours the FULL daemon needs to reach the rank the LEAN one
//              reached in the same game time, from the same start (part A,
//              the game's own classes and ns.bladeburner, the bbworld harness).
//
// The openings are MEASURED from history.jsonl (the save digest every 30s-5min):
// combat levels, home RAM, the factions. The placement of bladeburner.js is
// not in the save: BN6's is bounded by the record (home 1024GB, then combat
// 100 again after the install), BN4's is projected and printed as a range.
// NOT a calibration of the leg — bbcal6.mjs is that.

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { makeWorld } from '../test/bbworld.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > -1 ? Number(process.argv[i + 1]) : d
}
const SEEDS = arg('--seeds', 3)
const HOURS = arg('--hours', 4)
const TEL = process.env.TELEMETRY ?? path.resolve(process.env.HOME, 'Repos/bitburner-scripts/.telemetry')

const m = await import('./nodechoice/game.mjs')
const g = m.default
const bp = await import('bbplan.js')
const lp = await import('bbliteplan.js')
const coord = await import('bb-lite.js')
const bbjs = await import('bladeburner.js')
const actors = {}
for (const f of Object.values(lp.ACTOR)) actors[f] = await import(f)

// ---- A. the lean policy against the full one, same start ------------------
console.log(`A. LEAN vs FULL from a fresh join at combat 100 (BN4 multipliers, ${HOURS} game hours, ${SEEDS} seeds; the game's classes)`)
const effs = []
for (let seed = 1; seed <= SEEDS; seed++) {
  const run = async (which) => {
    const w = makeWorld({ g, setBitNode: m.setBitNode, actors, coord }, { combat: 105, seed, node: 4 })
    const path = []
    const ns = which === 'lite' ? w.ns : { ...w.baseNs('bladeburner.js') }
    // Sample the rank every game minute through the clock.
    const t0 = Date.now()
    await w.runFor(HOURS, which === 'lite' ? coord.main : bbjs.main, ns)
    return { rank: w.P.bladeburner?.rank ?? 0, w, cpu: Date.now() - t0 }
  }
  const lite = await run('lite')
  const full = await run('full')
  // The hours the full daemon needs for the lean final rank: its own rank path is roughly
  // linear early (no black ops below rank 2500), so scale by the ratio.
  const eff = full.rank > 0 ? lite.rank / full.rank : null
  effs.push(eff)
  console.log(`  seed ${seed}: lean rank ${lite.rank.toFixed(1)}, full rank ${full.rank.toFixed(1)} -> lean/full ${eff?.toFixed(3)} (cpu ${lite.cpu}+${full.cpu}ms)`)
}
effs.sort((a, b) => a - b)
const eff = effs[Math.floor(effs.length / 2)]
console.log(`  median lean/full rank ratio over the first ${HOURS}h after the join: ${eff.toFixed(3)} — the lean phase is worth ${(eff * 100).toFixed(0)}% of the full daemon's hours`)

// ---- B/C. the openings, measured -----------------------------------------
async function opening(node) {
  const rows = []
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(TEL, 'history.jsonl')) })
  // The node's LAST stretch: BN4 was also played on 2026-09-13; a record of
  // any other node ends a stretch, and the next record of this one starts a
  // new one. The bitNode is read cheaply off the line.
  let between = false
  let rows2 = rows
  for await (const line of rl) {
    const mm = line.match(/"bitNode":\s*(\d+)/)
    if (!mm) continue
    if (Number(mm[1]) !== node) {
      between = true
      continue
    }
    if (between) rows2 = []
    between = false
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    rows2.push({ at: Date.parse(d.at), ram: d.home?.ram, sk: d.skills, exp: d.exp, factions: d.factions ?? [], money: d.money, lifeMs: d.playtimeSinceLastAug })
  }
  return rows2
}
const low = (sk) => Math.min(sk?.strength ?? 0, sk?.defense ?? 0, sk?.dexterity ?? 0, sk?.agility ?? 0)
const h = (ms) => ms / 3600e3

console.log('\nB. BN6 (2026-10-01), measured')
{
  const rows = await opening(6)
  // The entry: the first record of the node's FIRST stretch (BN6 ran to 10-02; take the first day).
  const entry = rows[0].at
  const firstC100 = rows.find((r) => low(r.sk) >= 100)?.at
  const ram1024 = rows.find((r) => r.ram >= 1024)?.at
  const c100After1024 = rows.find((r) => r.at >= ram1024 && low(r.sk) >= 100)?.at
  const faction = rows.find((r) => r.factions.includes('Bladeburners'))?.at
  console.log(`  entry ${new Date(entry).toISOString()}; combat 100 first at +${h(firstC100 - entry).toFixed(2)}h; home 1024GB (the first host with 92.75GB free) at +${h(ram1024 - entry).toFixed(2)}h; combat 100 again after it at +${h(c100After1024 - entry).toFixed(2)}h; the Bladeburners faction (rank 25, so the division before it) at +${h(faction - entry).toFixed(2)}h`)
  const joinLite = h(firstC100 - entry)
  const joinFull = h(c100After1024 - entry)
  const gap = joinFull - joinLite
  const deficit = gap * (1 - eff)
  console.log(`  joinLite +${joinLite.toFixed(2)}h (bb-lite at tier 32, from entry); joinFull >= +${joinFull.toFixed(2)}h (the full daemon placeable AND combat at 100); the record puts the division before +${h(faction - entry).toFixed(2)}h`)
  const upper = h(faction - entry)
  console.log(`  saved = ${gap.toFixed(2)}h - lean deficit ${deficit.toFixed(2)}h = ${(gap - deficit).toFixed(2)}h with the join at its earliest possible (+${joinFull.toFixed(2)}h); ${((upper - joinLite) * eff).toFixed(2)}h with it at the faction record's bound (+${upper.toFixed(2)}h). (bbcal6.mjs dates the join ~+7.7h; the faction record says the division existed by +${upper.toFixed(2)}h.)`)
}

console.log('\nC. BN4 (2026-10-02), measured so far and projected')
{
  const bodyplan = await import('bodyplan.js')
  const { bitNodeMults } = await import('bitNodeMultipliers.js')
  const n4 = bitNodeMults(4)
  const rows = await opening(4)
  const entry = rows[0].at
  const last = rows[rows.length - 1]
  const r64 = rows.find((r) => r.ram >= 64)?.at
  console.log(`  entry ${new Date(entry).toISOString()}; home 64GB at +${h(r64 - entry).toFixed(2)}h (BN6: +1.18h); last record +${h(last.at - entry).toFixed(2)}h: combat ${last.sk.strength}/${last.sk.defense}/${last.sk.dexterity}/${last.sk.agility}, $${Math.round(last.money)}`)
  // The person: the exp multiplier the plan measured (decisions.bladeRoute.start.gymExpPerSec 13.824 at Powerhouse x10).
  const mx = 1.3824
  const mults = { hacking: 1, strength: n4.StrengthLevelMultiplier, defense: n4.DefenseLevelMultiplier, dexterity: n4.DexterityLevelMultiplier, agility: n4.AgilityLevelMultiplier, charisma: 1, hacking_exp: mx, strength_exp: mx, defense_exp: mx, dexterity_exp: mx, agility_exp: mx, charisma_exp: mx, crime_money: 1, crime_success: 1 }
  const T = { strength: 100, defense: 100, dexterity: 100, agility: 100 }
  const person = { skills: { ...last.sk, charisma: last.sk.charisma ?? 1, intelligence: last.sk.intelligence ?? 134 }, exp: { ...last.exp, charisma: last.exp?.charisma ?? 0 }, mults, city: 'Sector-12', money: last.money }
  const now = bodyplan.combatBarPlanOf(T, person, n4, { cash: last.money, incomePerSec: 650 })
  const c100 = h(last.at - entry) + now.hours[now.best]
  console.log(`  combat 100 from the last record (the fee priced, bodyplan.combatBarPlanOf): ${now.why}`)
  // From the entry, had actplan 0b run from the first minute (stats 1, $1,262).
  const p0 = { skills: { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 134 }, exp: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 }, mults, city: 'Sector-12', money: 1262 }
  const fromEntry = bodyplan.combatBarPlanOf(T, p0, n4, { cash: 1262, incomePerSec: 50 })
  console.log(`  combat 100 from the ENTRY with actplan 0b (no gang grind first): ${fromEntry.why}`)
  // The full daemon's first host: BN6 reached the 1024GB home at +4.0h with home 64GB at +1.18h; BN4 reached 64GB at
  // the measured time — scale BN6's opening by the BN4/BN6 ratio at 64GB, with +-50% around it.
  const scale = h(r64 - entry) / 1.18
  const fullAt = 4.0 * scale
  for (const [label, joinLite] of [['this run (fee-priced leg from the 17:27Z state)', c100], ['a future node (0b from the entry)', fromEntry.hours[fromEntry.best]]]) {
    const rows2 = [0.5, 1, 1.5].map((k) => {
      const jf = Math.max(joinLite, fullAt * k)
      const gap = jf - joinLite
      return `${k === 1 ? 'central' : k < 1 ? 'early host' : 'late host'} ${gap.toFixed(1)} - ${(gap * (1 - eff)).toFixed(1)} = ${(gap * eff).toFixed(1)}h`
    })
    console.log(`  ${label}: joinLite +${joinLite.toFixed(2)}h; the full daemon's first 92.75GB host ~+${fullAt.toFixed(1)}h (BN6's +4.0h x ${scale.toFixed(2)}, the BN4/BN6 pace to a 64GB home); saved: ${rows2.join('; ')}`)
  }
}
process.exit(0)
