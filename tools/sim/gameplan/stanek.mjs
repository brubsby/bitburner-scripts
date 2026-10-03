// STANEK'S GIFT IN THE WHOLE-GAME PLAN: what accepting the gift at a node's start
// is worth to its clear, as a function of the node (its StaneksGiftPowerMultiplier
// and StaneksGiftExtraSize), the SF13 level, and the world.
//
// The model is stanekplan.js (repo root, pure; its header cites every formula's
// source and labels what is policy, measured or assumed). This file is the glue:
// the layout per grid (optimised once, cached on disk), and the gift's factors on
// the hacking route's three channels, which routes.mjs feeds into the SAME exit
// simulation the no-gift clear runs (hackParts with `st`):
//
//   W         the exit-level divisor at the exit (the final life's hacking skill x the
//             exp term, net of the penalty then in force) — exitShift, as the
//             w0r1d_d43m0n bonus is (go.mjs)
//   gMul      g x exp(d ln g): the node-averaged income and faction-rep factors
//             (penalty, fragments, the charging RAM's share) through the ASSUMED
//             elasticities stEpsM / stEpsR
//   favorMul  the Daedalus favor life's hours x 1/(hacking skill x faction rep) at
//             its point in the node (go.mjs's favor life; rep ~ level x faction_rep,
//             Faction/formulas reputation.ts)
//
// The two trajectories compared are "this clear with the gift accepted at the node's
// start" and "this clear never accepting" — the planner's min over routes is the
// accept / never decision, per node and per world. The gift run's length feeds back
// into its own home-RAM curve (home RAM is MEASURED as a function of hours into a
// no-gift node, so a shorter gift run exits on a smaller home): a fixed point on the
// run's length, on the linearised exit (ln W / g + H (1 - 1/gMul)), then the factors
// at that length go through the simulation.
//
// NOT CALIBRATED: no node of this playthrough has run the gift (no SF13, never in
// BN13). The formulas are the game's (tools/test/stanek.test.mjs runs them against
// the bundle); the elasticities, the faction_rep the augs reach, the charger's duty
// are ASSUMED (effects.SF_PARAMS st*, drawn); home RAM's exit level and shape are
// MEASURED (history.jsonl). The Bladeburner route never takes the gift (bbsim has
// no Stanek multipliers): NOT PRICED, so a Bladeburner clear is priced as before.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { giftSize, optimiseLayout, hackWeights, bestNodeModel, chargeFactor, threadsOf, homeAt, fragmentById, TYPE, TYPE_NAME } from '../../../stanekplan.js'
import { SF_PARAMS } from './effects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LAYOUT_FILE = path.join(HERE, '.cache', 'stanek-layouts.json')
const CODE = crypto.createHash('sha1').update(fs.readFileSync(path.join(HERE, '../../../stanekplan.js'))).digest('hex').slice(0, 12)

/** The Hg (hours x g, the exit's log distance) the layout is chosen at: the mid world's typical node (2.5). FIXED, stated. */
export const LAYOUT_HG = 2.5
/** The charging fraction the layout is chosen at (the mid world's optimum is 0.2-0.3). FIXED, stated. */
export const LAYOUT_F = 0.2
/** numCharge per fragment the layout is chosen at (~1000: a 2.6h life, ~7 fragments round robin). FIXED, stated. */
export const LAYOUT_N = 1000
/** Expanded nodes per layout search (exact on grids up to 5x5; best found past that, printed). */
export const LAYOUT_BUDGET = 4e5
/** The node fraction the Daedalus favor life sits at (it is ground late, at the Red Pill's level). FIXED, stated. */
export const FAVOR_U = 0.8

/** The gift is available: in BN13, or holding SF13 (BitNodeUtils.ts:17 canAccessBitNodeFeature(13)). */
export const giftAvailable = (node, lv) => node === 13 || lv(13) >= 1
/** The SF13 level that sizes the grid (Player.activeSourceFileLvl(13): the level held on entry). */
export const gridOf = (m, l13) => giftSize(m.StaneksGiftExtraSize, l13)

const mid = (k) => SF_PARAMS[k].mid
let diskLayouts = null
const memLayouts = new Map()

/** The layout for a node's grid and power (optimised at the mid world's weights; cached in memory and on disk). */
export function layoutFor(m, l13) {
  const { width, height } = gridOf(m, l13)
  const np = m.StaneksGiftPowerMultiplier
  const key = `${CODE}|${width}x${height}|${np.toFixed(3)}`
  let r = memLayouts.get(key)
  if (r) return r
  if (!diskLayouts) diskLayouts = fs.existsSync(LAYOUT_FILE) ? JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')) : {}
  r = diskLayouts[key]
  if (!r) {
    const home = homeAt(1, mid('stRam'))
    const c = chargeFactor(threadsOf(home.ram * LAYOUT_F, home.cores), LAYOUT_N)
    const weights = hackWeights({ Hg: LAYOUT_HG, epsM: mid('stEpsM'), epsR: mid('stEpsR') })
    const t0 = performance.now()
    const o = optimiseLayout({ width, height, weights, c, nodePower: np, budget: LAYOUT_BUDGET })
    r = { width, height, nodePower: np, placed: o.placed, value: o.value, exact: o.exact, nodes: o.nodes, ms: Math.round(performance.now() - t0), c }
    diskLayouts[key] = r
    fs.mkdirSync(path.dirname(LAYOUT_FILE), { recursive: true })
    fs.writeFileSync(LAYOUT_FILE + '.tmp', JSON.stringify(diskLayouts))
    fs.renameSync(LAYOUT_FILE + '.tmp', LAYOUT_FILE)
  }
  memLayouts.set(key, r)
  return r
}

/** The layout as text: "Hacking0 Hacking1 Speed5 Rep25 + 2 boosters". */
export function layoutText(placed) {
  const charged = placed.filter((p) => fragmentById(p.id).type !== TYPE.Booster)
  const nb = placed.length - charged.length
  return `${charged.map((p) => `${TYPE_NAME[fragmentById(p.id).type].replace('Hacking', 'H')}`).join(' ') || '(none)'}${nb ? ` + ${nb} booster${nb > 1 ? 's' : ''}` : ''}`
}

/** The exit's exp-term scale L0 = 32 ln(exp + 534.6) - 200 at a final life's exp (skill.ts:13), from the profile. */
export function expTermOf(m, profile, cycleH) {
  const exp = (profile?.expRich ?? 1.3e9) * m.HackExpGain * m.HackingSpeedMultiplier * cycleH * 3600
  return Math.max(100, 32 * Math.log(exp + 534.6) - 200)
}

/**
 * The gift's factors for node `node` at SF13 level `l13` in `world`, given the
 * no-gift clear's hours H0 and growth g (memoised on the world, H0 and g binned at 4%).
 * Returns { W, gMul, favorMul, f, hours (the gift run, linearised), giftAt, layout, model } .
 */
export function stanekFactors(node, l13, world, m, { H0, g }) {
  const memo = (world._stanek ??= new Map())
  const key = ((node * 4 + l13) * 8192 + 4096 + Math.round(Math.log(Math.max(H0, 0.1)) * 25)) * 8192 + 4096 + Math.round(Math.log(g) * 25)
  let r = memo.get(key)
  if (r) return r
  const lay = layoutFor(m, l13)
  const cycleH = world.cycleHours ?? 2
  const p = world.sf
  const base = { layout: lay.placed, nodePower: m.StaneksGiftPowerMultiplier, repCost: m.AugmentationRepCost, cycleH, p, Hg: H0 * g, L0: expTermOf(m, world.profile, cycleH), ramHours: H0, favorU: FAVOR_U }
  // the gift run's length: a fixed point (damped) on the linearised exit
  let H1 = H0
  let model = null
  for (let i = 0; i < 8; i++) {
    model = bestNodeModel({ ...base, hours: H1 })
    const next = Math.max(0.5, H0 - Math.log(model.W) / g - H0 * (1 - Math.exp(-model.dlng)))
    if (Math.abs(next - H1) < 0.01 * H0) {
      H1 = next
      break
    }
    H1 = (H1 + next) / 2
  }
  model = bestNodeModel({ ...base, hours: H1 })
  r = { W: model.W, gMul: Math.exp(model.dlng), favorMul: model.favorMul, f: model.f, hours: H1, giftAt: model.giftAt, layout: lay, model }
  memo.set(key, r)
  return r
}
