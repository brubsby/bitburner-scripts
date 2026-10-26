// BN15's LABYRINTH LEG, DERIVED — the numbers behind tools/sim/gameplan/routes.mjs LAB15.
//
//   node tools/sim/lab15.mjs [--json]
//
// THE LEG (2026-10-26, second derivation): the labyrinth route is the hacking route with the labs riding on its
// lives — the heartbleed farm and the crawler / walker are scripts on free RAM, no work slot — so the leg is what
// the labs add to the hacking route: the install each lab 1-4 forces when it clears before its life's own
// install (chaplan.LAB_INSTALL_H each) and the hours a climb is HELD past the last life before the final window
// (chaplan.labScheduleOf). The charisma multiplier each life runs at is MEASURED (labtraj.js LAB_TRAJ, from
// tools/sim/chatraj.mjs: every hacking-route clear's installed charisma product per life, transferred to BN15's
// hacking length T15) — the first derivation's ASSUMED charisma-augmentation columns (lo 1.6/2.3/3.5, mid
// 1.3/1.6/2.0, hi 1.12/1.25/1.45 by labs 3/4/5, climbs added in series) are gone.
//   lo / mid / hi   the 25% / 50% / 75% quantiles of the leg over the measured trajectories
//   pFail           the share of trajectories on which a remaining lab is out of reach (a climb past
//                   chaplan.CLIMB_CAP_H): the in-game arm prices those as the fallback (the black ops from the
//                   stall); here they are counted, never folded into lo/mid/hi
// CALIBRATION: the farm model reproduces the game's heartbleed farm to -2.7% (dnet.test.mjs DN11); the crawl
// minutes are the game's (chaplan.CRAWL_MIN, dnetlab.mjs); the per-life charisma product is the game's catalogue
// over the installed lists the stack bought. NOT CALIBRATED: the transfer to BN15 (no BN15 life has been played;
// the stack's buyer did not value charisma on those clears — on the lab route it does, objective.charismaValue —
// so the measured products are a FLOOR) and the farm's free home RAM (capped at chaplan.FARM_MAX_GB).
import { labScheduleOf, LAB_CHA, CLIMB_CAP_H, FARM_MAX_GB, LAB_INSTALL_H, CRAWL_MIN, CRAWL_RUNS, CRAWL_MEASURED_AT, trajLivesOf } from '../../chaplan.js'
import { LAB_TRAJ } from '../../labtraj.js'

// the save (2026-10-25, BN8.2): SF1.3 (+28%), SF2.3 (+42%), SF3.3 (+14%) charisma (applySourceFile.ts:31,59,69)
// x BN15's CharismaLevelMultiplier 1.1; charisma_exp x1.2928 and intelligence 157 as the BN15 entry reads them
// (dnetlab.mjs run 2026-10-25: chaExpMult 1.2928, int 157)
export const BASE = { mult: 1.28 * 1.42 * 1.14 * 1.1, expMult: 1.2928, int: 157 }
export { CRAWL_RUNS, CRAWL_MIN }
export const MEASURED_AT = CRAWL_MEASURED_AT
export const CAP_H = CLIMB_CAP_H

/** One measured trajectory's lab schedule on BN15's hacking length (chaplan.labScheduleOf). */
export function legOfTraj(t, { T = LAB_TRAJ.transfer?.T15, base = BASE, crawlMin = CRAWL_MIN } = {}) {
  return labScheduleOf({ lives: trajLivesOf(t, T), base, crawlMin })
}

const quant = (xs, p) => {
  const v = [...xs].sort((a, b) => a - b)
  if (!v.length) return null
  const i = (v.length - 1) * p
  const lo = Math.floor(i)
  return v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (i - lo)
}

/** The leg's quantiles over the trajectories that reach The Red Pill, and the share that fail. */
export function legsOf(trajs = LAB_TRAJ.clears, opts = {}) {
  const rows = trajs.map((t) => ({ t, s: legOfTraj(t, opts) }))
  const ok = rows.filter((r) => !r.s.failed).map((r) => r.s.legH)
  return {
    n: rows.length,
    pFail: rows.length ? rows.filter((r) => r.s.failed).length / rows.length : null,
    lo: quant(ok, 0.25),
    mid: quant(ok, 0.5),
    hi: quant(ok, 0.75),
    rows,
  }
}

/** The scenario the gameplan names (lo / mid / hi): the leg's quantile among the trajectories that reach The Red Pill. */
export const SCENARIOS = { lo: { q: 0.25 }, mid: { q: 0.5 }, hi: { q: 0.75 } }
export function legOf(sc) {
  const L = legsOf()
  const ok = L.rows.filter((r) => !r.s.failed).map((r) => r.s.legH)
  return { h: quant(ok, sc.q), n: L.n, pFail: L.pFail }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const L = legsOf()
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...L, rows: L.rows.map((r) => ({ bn: r.t.bn, at: r.t.at, ...r.s })) }, null, 1))
  else {
    console.log(`BN15 labyrinth leg on ${L.n} measured charisma trajectories (labtraj.js ${LAB_TRAJ.measuredAt}, T15 ${LAB_TRAJ.transfer?.T15}h; base mult ${BASE.mult.toFixed(3)}, farm <= ${FARM_MAX_GB}GB, lab install ${LAB_INSTALL_H}h, crawl ${MEASURED_AT})`)
    for (const r of L.rows) console.log(`  BN${r.t.bn} ${r.t.at}: leg ${r.s.legH.toFixed(2)}h${r.s.failed ? ` FAILS (detect at ${r.s.detectH}h)` : ''}; labs at mult ${r.s.labs.map((l) => l.mult.toFixed(2)).join('/')} (${LAB_CHA.join('/')})`)
    console.log(`  lo ${L.lo?.toFixed(2)}h / mid ${L.mid?.toFixed(2)}h / hi ${L.hi?.toFixed(2)}h over the ${L.n - Math.round(L.pFail * L.n)} that reach The Red Pill; P(fail) ${L.pFail?.toFixed(3)}`)
  }
}
