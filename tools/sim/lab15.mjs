// BN15's LABYRINTH LEG, DERIVED — the numbers behind tools/sim/gameplan/routes.mjs LAB15 (they replace the
// ASSUMED 10/30/120h of 2026-10-25's first slice).
//
//   node tools/sim/lab15.mjs [--json]
//
// THE LEG, per lab k = 1..5 (each one life, each ending in its install — dnetplan.labInstallOf):
//   climb_k   the charisma farm from exp 0 (an install resets exp) to lab k's charisma x LAB_CHA_MARGIN,
//             chaplan.climbOf at the multiplier that life has: the save's Source-File floor x BN15's 1.1
//             x the lab augmentations installed by then (Wings 1.05, Boots 1.06, Hammer 1.07, Law 1.09)
//             x the OTHER charisma augmentations bought by then (the ASSUMED part: the scenario's column)
//   crawl_k   MEASURED in the game's own darknet (tools/sim/entry/dnetlab.mjs, the stack's dnet-seed / dnet /
//             dnet-lab / dnet-ride at the lab's charisma): the crawl to the lab's row, the air gaps ridden,
//             the maze walked, the reward cache opened -> the reward QUEUED (game minutes)
//   install   per lab install the stack would not otherwise make: the life's reset (money, rep, the batcher)
//             — ASSUMED lo 0.1 / mid 0.25 / hi 0.5h, the order of a fresh life's first-hour ramp
// The leg = sum(climb_k + crawl_k) + 4 x install (the 5th lab's install is The Red Pill's, which the
// hacking route pays anyway). It is ADDED to the hacking route's hours (routes.mjs 'lab': hackexit at
// BN15's multipliers, the climb to hacking 6000 with its own installs).
//
// CALIBRATION: the farm model reproduces the game's heartbleed farm to -2.7% (dnet.test.mjs DN11, from
// dnetlab.mjs --farm-min); the crawl minutes are the game's. NOT CALIBRATED: the charisma augmentation
// trajectory (no BN15 life has been played: which charisma augs the economy affords by each lab — corporate
// factions, AugmentationMoneyCost 3 — is the scenario's column, not a simulation of augplan on BN15's
// economy) and the farm's RAM (home's free RAM in a lab life). Both are stated per scenario.
import { climbOf, LAB_CHA, LAB_CHA_MARGIN } from '../../chaplan.js'

// the save (2026-10-25, BN8.2): SF1.3 (+28%), SF2.3 (+42%), SF3.3 (+14%) charisma (applySourceFile.ts:31,59,69)
// x BN15's CharismaLevelMultiplier 1.1; charisma_exp x1.2928 and intelligence 157 as the BN15 entry reads them
// (dnetlab.mjs run 2026-10-25: chaExpMult 1.2928, int 157)
export const BASE = { mult: 1.28 * 1.42 * 1.14 * 1.1, expMult: 1.2928, int: 157 }
// the lab augmentations' charisma, installed before lab k (Augmentations.ts:1851-1945)
const LAB_AUG = [1, 1.05, 1.05 * 1.06, 1.05 * 1.06 * 1.07, 1.05 * 1.06 * 1.07]
// MEASURED: game minutes from the life's start (charisma at the lab's) to the reward queued, dnetlab.mjs on
// the save above (the BN15.1 entry), warp 8, two full runs of all five labs (2026-10-25):
//   run3 (the walker before the stasis link and the block-freeing loop)  1.21 / 7.29 /  7.34 / 50.32 / 20.43
//   run4 (this commit's code)                                             0.88 / 9.57 / 24.52 / 24.12 / 26.57
// The mean per lab prices it (the spread is the network's randomness: where the rows fill, which hosts move).
// A lab not measured would carry its row count x the measured minutes per row.
export const CRAWL_RUNS = { run3: [1.21, 7.29, 7.34, 50.32, 20.43], run4: [0.88, 9.57, 24.52, 24.12, 26.57] }
export const CRAWL_MIN = Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, +((CRAWL_RUNS.run3[k - 1] + CRAWL_RUNS.run4[k - 1]) / 2).toFixed(2)]))
export const MEASURED_AT = 'tools/sim/entry/dnetlab.mjs 2026-10-25 (two runs, warp 8)'
// the OTHER charisma augmentations' product installed before lab k (k = 1..5), ASSUMED per scenario:
//   lo   the cheap non-corporate set by lab 3 (Speech Processor 1.1, Hemo 1.08, Speech Enh / Power Recirc /
//        Magnetism / Nanofiber 1.05, Nuoptimal / Lumin / Wit / DermaForce 1.03: ~1.6), + TITN-41 / Golden
//        Tongue / Eloquence / PC Matrix by lab 4 (~2.3), + SmartJaw (Bachman) by lab 5 (~3.5)
//   mid  half of that in ln: 1.3 / 1.6 / 2.0
//   hi   a quarter: 1.12 / 1.25 / 1.45
export const SCENARIOS = {
  lo: { aug: [1, 1, 1.6, 2.3, 3.5], ramGB: 4096, installH: 0.1 },
  mid: { aug: [1, 1, 1.3, 1.6, 2.0], ramGB: 1024, installH: 0.25 },
  hi: { aug: [1, 1, 1.12, 1.25, 1.45], ramGB: 256, installH: 0.5 },
}
export const CAP_H = 500 // a climb past this is the route failing: priced at the cap and flagged

/** The leg for one scenario. */
export function legOf(sc, crawlMin = CRAWL_MIN) {
  const known = Object.entries(crawlMin).filter(([, v]) => typeof v === 'number')
  // per-row minutes from the measured labs (rows = lab depth), for a lab not yet measured
  const DEPTH = [7, 12, 19, 23, 29]
  const perRow = known.reduce((s, [k, v]) => s + v, 0) / known.reduce((s, [k]) => s + DEPTH[k - 1], 0)
  const labs = LAB_CHA.map((cha, i) => {
    const mult = BASE.mult * LAB_AUG[i] * sc.aug[i]
    const c = climbOf({ target: Math.ceil(cha * LAB_CHA_MARGIN), mult, expMult: BASE.expMult, ramGB: sc.ramGB, int: BASE.int })
    const crawlH = (typeof crawlMin[i + 1] === 'number' ? crawlMin[i + 1] : perRow * DEPTH[i]) / 60
    return { lab: i + 1, cha, mult: +mult.toFixed(3), climbH: Math.min(c.h, CAP_H), capped: c.h > CAP_H, crawlH: +crawlH.toFixed(3), crawlMeasured: typeof crawlMin[i + 1] === 'number' }
  })
  const h = labs.reduce((s, l) => s + l.climbH + l.crawlH, 0) + 4 * sc.installH
  return { h, labs, capped: labs.some((l) => l.capped) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = Object.fromEntries(Object.entries(SCENARIOS).map(([k, sc]) => [k, legOf(sc)]))
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1))
  else {
    console.log(`BN15 labyrinth leg (base charisma mult ${BASE.mult.toFixed(3)}, exp x${BASE.expMult}, crawl ${MEASURED_AT})`)
    for (const [k, r] of Object.entries(out)) {
      console.log(`  ${k.padEnd(4)} ${r.h.toFixed(2)}h${r.capped ? '  (a climb CAPPED: the route fails there)' : ''}`)
      for (const l of r.labs) console.log(`       lab ${l.lab} cha ${l.cha} at mult ${l.mult}: climb ${l.climbH.toFixed(2)}h${l.capped ? ' CAPPED' : ''} + crawl ${l.crawlH.toFixed(2)}h${l.crawlMeasured ? '' : ' (per-row estimate)'}`)
    }
  }
}
