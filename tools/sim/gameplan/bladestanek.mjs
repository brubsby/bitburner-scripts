// THE GIFT ON THE BLADEBURNER ROUTE, for the planner: the table tools/sim/bbstanek.mjs --table
// builds (bbsim both arms on shared seeds: the leg ratio with/without the gift and the join's
// shift), read by routes.mjs's 'bladeStanek' route. Light on purpose (no game bundle): plan.mjs
// reads it in every world.
//
// CALIBRATION: NOT CALIBRATED — no Bladeburner node has run with the gift. The ratio is bbsim's
// (the game's classes; the layout's multipliers ST1-checked against the game's StaneksGift); the
// charger is stanekplan.BLADE_HOST at gbMax mid (MEASURED host sizes, ASSUMED spread, the
// batcher's money on that host NOT PRICED). The ratio is taken on the planner's 5-infiltrator
// fleet at the cell's SF6/SF7 and applied to the route's leg (the live fleet pick and k): the
// gift's effect on the fleet ratio is NOT SIMULATED.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const TABLE_FILE = path.join(HERE, '.cache/bbstanek.json')
const SRC = ['../nodechoice/bbsim.mjs', '../../../stanekplan.js', '../../../bbplan.js', '../bbstanek.mjs', './surrogate.mjs', './go.mjs']
/** The table's code key: every file the two arms run through (a change re-simulates). */
export const TABLE_CODE = (() => {
  const h = crypto.createHash('sha1')
  for (const f of SRC) h.update(fs.readFileSync(path.join(HERE, f)))
  return h.digest('hex').slice(0, 12)
})()
export const tableKey = (node, l13, l6, l7) => `${TABLE_CODE}|${node}|${l13}|${l6}|${l7}`
/** The cells built: SF6 3 (held), SF7 1..3 (the remaining plan's); l13 1..3, and 0 in BN13 (the gift is BN13's own). */
export const TABLE_CELLS = [[3, 1], [3, 2], [3, 3]]
export const l13sOf = (node) => (node === 13 ? [0, 1, 2, 3] : [1, 2, 3])
export const TABLE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

let cache = null
export function readTable(force = false) {
  if (cache && !force) return cache
  try {
    cache = JSON.parse(fs.readFileSync(TABLE_FILE, 'utf8'))
  } catch {
    cache = {}
  }
  return cache
}
export function writeTable(tab) {
  fs.mkdirSync(path.dirname(TABLE_FILE), { recursive: true })
  fs.writeFileSync(TABLE_FILE, JSON.stringify(tab))
  cache = tab
}

/**
 * The gift's entry for a clear: { ratio, joinD, withoutH, withH } at the nearest built cell (SF6
 * clamped to 3, SF7 clamped to 1..3), or null when the table lacks it (the route then prices
 * nothing and plan.mjs says so: build with `node tools/sim/bbstanek.mjs --table`).
 */
export function giftLegOf(node, l13, l6, l7) {
  const c6 = 3
  const c7 = Math.max(1, Math.min(3, l7))
  return readTable()[tableKey(node, l13, c6, c7)] ?? null
}
