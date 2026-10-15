// STANEK'S GIFT ON THE BLADEBURNER ROUTE — priced by simulating both exits.
//
//   node tools/sim/bbstanek.mjs --elastic [--node 11 --l6 3 --l7 1 --seeds 7]   the layout's weights
//   node tools/sim/bbstanek.mjs --layout                                          the shipped layouts
//   node tools/sim/bbstanek.mjs --compare [--node 11 ...] [--json]                withH vs withoutH
//   node tools/sim/bbstanek.mjs --table                                           every Bladeburner node x SF13 1..3 (the gameplan's cache)
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"): the
// Bladeburner exit from the node's start WITHOUT the gift, and WITH it accepted at t 0
// (Genesis x0.9 on combat/charisma/hacking from t 0, the combat layout charged by
// stanekplan.bladeChargeAt). Both are bbsim (the game's own Bladeburner, Sleeve, Player and
// StaneksGift classes, bbplan's POLICY), one spec (surrogate.bbSpec: the planner's fleet of 5
// infiltrators, the node's Go farm), the same seeds; the only difference is o.stanek.
// The decision is withH - withoutH (hours, the full exit: gym to combat 100 + the leg).
//
// CALIBRATION: NOT CALIBRATED for the gift — no Bladeburner node has run with it, so no
// live quantity with the gift exists to reproduce. bbsim's leg without it is calibrated by k
// (params.BB_PARAMS, posterior: live leg / bbsim leg); the gift's RATIO is not. Printed on
// every run. The charging inputs are labelled in stanekplan.BLADE_HOST (MEASURED / SOURCE /
// ASSUMED); the batcher's money on the charger's host is NOT PRICED (bbsim money is not
// binding on this route).

import '../test/gameresolve.mjs'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import { bbSpec } from './gameplan/surrogate.mjs'
import { bladeGoOf } from './gameplan/go.mjs'
import { nodeMults } from './nodechoice/hackexit.mjs'
import { TABLE_FILE, TABLE_CELLS, TABLE_SEEDS, tableKey, readTable, writeTable, l13sOf } from './gameplan/bladestanek.mjs'

const sp = await import('../../stanekplan.js')
const bp = await import('bbplan.js')
const { TYPE } = sp

/** The calculateMults keys each fragment type sets (StaneksGift.ts:134-205). */
export const TYPE_KEYS = {
  [TYPE.Strength]: ['strength', 'strength_exp'],
  [TYPE.Defense]: ['defense', 'defense_exp'],
  [TYPE.Dexterity]: ['dexterity', 'dexterity_exp'],
  [TYPE.Agility]: ['agility', 'agility_exp'],
  [TYPE.Charisma]: ['charisma', 'charisma_exp'],
  [TYPE.Bladeburner]: ['bladeburner_max_stamina', 'bladeburner_stamina_gain', 'bladeburner_analysis', 'bladeburner_success_chance'],
  [TYPE.Hacking]: ['hacking', 'hacking_exp'],
}

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q)
  if (a.length < xs.length) return Infinity
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
}

/** The shared spec of both arms: the planner's bbSpec + SF13 at l13 (the grid; SF13 has no other effect in bbsim). */
export function specOf({ node, l6, l7, l13, seed, sf14 = 1 }) {
  const go = bladeGoOf(nodeMults(node).GoPower, sf14)
  const s = bbSpec(node, l6, l7, seed, bp.POLICY, null, go)
  return { ...s, sf: [...s.sf, [13, l13]] }
}

/** The grid and node power the game gives node at SF13 l13 (StaneksGift.ts:20-32). */
export function gridOf(node, l13) {
  const m = nodeMults(node)
  const { width, height } = sp.giftSize(m.StaneksGiftExtraSize ?? 0, l13)
  return { width, height, nodePower: m.StaneksGiftPowerMultiplier ?? 1 }
}

/** The gift arm's o.stanek for a layout and a charger host size. */
export function giftOf(placed, gbMax) {
  const k = sp.chargeRootsOf(placed).length
  return { placed, chargeAt: sp.bladeChargeAt({ gbMax, k }) }
}

/** Both arms on shared seeds: { withoutH, withH, d, joinWithout, joinWith, legWithout, legWith, n, done }. */
export function compareArms({ node, l6, l7, l13, seeds, placed, gbMax }) {
  const wo = []
  const wi = []
  for (const seed of seeds) {
    const base = specOf({ node, l6, l7, l13, seed })
    wo.push(runBladeburner(base))
    wi.push(runBladeburner({ ...base, stanek: giftOf(placed, gbMax) }))
  }
  const h = (rs) => median(rs.map((r) => r.hours ?? Infinity))
  const j = (rs) => median(rs.map((r) => r.joinH ?? Infinity))
  const withoutH = h(wo)
  const withH = h(wi)
  return {
    withoutH, withH, d: withH - withoutH,
    joinWithout: j(wo), joinWith: j(wi), legWithout: withoutH - j(wo), legWith: withH - j(wi),
    ratio: (withH - j(wi)) / (withoutH - j(wo)),
    perSeed: seeds.map((s, i) => [s, +(wo[i].hours ?? NaN).toFixed(3), +(wi[i].hours ?? NaN).toFixed(3)]),
    mults: wi[0]?.stanek ?? null,
  }
}

const meanLn = (xs) => (xs.every((x) => Number.isFinite(x) && x > 0) ? xs.reduce((s, x) => s + Math.log(x), 0) / xs.length : Infinity)
/**
 * -d ln(hours) / d ln(mult) per fragment type: central differences at x step on the mean
 * ln hours over common seeds. step 1.5 — the gift's own range (effects 1.1-1.6) — because
 * a black op's success roll makes a seed's hours jumpy: at x1.1 the signal sat under that
 * noise (Strength read 0 on medians while x1.5 moved seed 1 by -15%).
 */
export function elasticities({ node, l6, l7, l13, seeds, step = 1.5 }) {
  const out = {}
  const base = (seed) => specOf({ node, l6, l7, l13, seed })
  for (const [type, keys] of Object.entries(TYPE_KEYS)) {
    const up = []
    const dn = []
    for (const seed of seeds) {
      up.push(runBladeburner({ ...base(seed), mults: Object.fromEntries(keys.map((k) => [k, step])) }).hours ?? Infinity)
      dn.push(runBladeburner({ ...base(seed), mults: Object.fromEntries(keys.map((k) => [k, 1 / step])) }).hours ?? Infinity)
    }
    out[type] = Math.max(0, -(meanLn(up) - meanLn(dn)) / (2 * Math.log(step)))
  }
  return out
}

/** The design charge factor: chargeFactor at the mid charger, `atH` hours in, k charged fragments. */
export function designC({ k = 5, atH = 10, gbMax = sp.BLADE_HOST.gbMax.mid } = {}) {
  const ch = sp.bladeChargeAt({ gbMax, k })(atH * 3600)
  return sp.chargeFactor(ch.highestCharge, ch.numCharge)
}

/** The Bladeburner nodes (BladeburnerRank > 0) the gift can be accepted in (extra size > -99). */
export const bladeNodes = () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].filter((n) => (nodeMults(n).BladeburnerRank ?? 0) > 0 && (nodeMults(n).StaneksGiftExtraSize ?? 0) > -50)

/** The layout for a grid on this route: BLADE_LAYOUTS if tabled, else optimised now (same weights and c). */
export function bladeLayoutFor({ width, height, nodePower }, budget = 4e5) {
  const key = `${width}x${height}|${nodePower}`
  if (sp.BLADE_LAYOUTS[key]) return { key, placed: sp.BLADE_LAYOUTS[key], source: 'tabled' }
  const o = sp.optimiseLayout({ width, height, weights: sp.BLADE_WEIGHTS, c: sp.BLADE_DESIGN_C, nodePower, budget })
  return { key, placed: o.placed, source: `optimised (${o.exact ? 'exact' : 'best found'}, ${o.nodes} nodes)`, value: o.value }
}

// ---- the gameplan's table (gameplan/bladestanek.mjs: key, cells, seeds, the file)

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => {
    const i = args.indexOf(`--${k}`)
    return i >= 0 ? args[i + 1] : d
  }
  const node = +opt('node', 11)
  const l6 = +opt('l6', 3)
  const l7 = +opt('l7', 1)
  const l13 = +opt('l13', 1)
  const seeds = Array.from({ length: +opt('seeds', 5) }, (_, i) => i + 1)
  console.log('CALIBRATION: NOT CALIBRATED for the gift (no Bladeburner node has run with it); the leg without it is k-calibrated (posterior). Charger: stanekplan.BLADE_HOST (MEASURED host sizes, ASSUMED gbMax spread), money on that host NOT PRICED.')
  if (args.includes('--elastic')) {
    const e = elasticities({ node, l6, l7, l13, seeds })
    console.log(`elasticities (-dln h/dln mult, BN${node} SF6.${l6} SF7.${l7}, ${seeds.length} seeds):`, JSON.stringify(Object.fromEntries(Object.entries(e).map(([t, v]) => [sp.TYPE_NAME[t], +v.toFixed(4)]))))
    console.log('BLADE_WEIGHTS literal:', `{ ${Object.entries(e).map(([t, v]) => `[TYPE.${sp.TYPE_NAME[t]}]: ${+v.toFixed(4)}`).join(', ')} }`)
    console.log('design c (mid charger, 10h, k 5):', designC())
  }
  if (args.includes('--layout')) {
    const grids = new Map()
    for (const n of bladeNodes()) for (const l of [1, 2, 3]) {
      const gr = gridOf(n, l)
      grids.set(`${gr.width}x${gr.height}|${gr.nodePower}`, gr)
    }
    for (const [key, gr] of grids) {
      const t0 = Date.now()
      const o = sp.optimiseLayout({ ...gr, weights: sp.BLADE_WEIGHTS, c: sp.BLADE_DESIGN_C, budget: +opt('budget', 4e5) })
      console.log(`  '${key}': ${JSON.stringify(o.placed).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+:)/g, ', ').replace(/:\s+/g, ': ')}, // ${o.exact ? 'exact' : 'best found'} ${o.nodes} nodes ${Date.now() - t0}ms value ${o.value.toFixed(4)}`)
    }
  }
  if (args.includes('--compare')) {
    const gr = gridOf(node, l13)
    const lay = bladeLayoutFor(gr)
    console.log(`BN${node} SF13.${l13} grid ${lay.key} (${lay.source}): ${JSON.stringify(lay.placed)}`)
    const rows = {}
    for (const [arm, gbMax] of Object.entries(sp.BLADE_HOST.gbMax)) {
      const r = compareArms({ node, l6, l7, l13, seeds, placed: lay.placed, gbMax })
      rows[arm] = r
      console.log(`  charger ${arm} (${gbMax}GB): withoutH ${r.withoutH.toFixed(3)}  withH ${r.withH.toFixed(3)}  d ${r.d.toFixed(3)}h  (join ${r.joinWithout.toFixed(2)} -> ${r.joinWith.toFixed(2)}, leg ratio ${r.ratio.toFixed(4)}, gift at the exit ${JSON.stringify(r.mults)})  seeds ${JSON.stringify(r.perSeed)}`)
    }
    if (args.includes('--json')) console.log(JSON.stringify(rows))
  }
  if (args.includes('--table')) {
    const tab = readTable()
    let n = 0
    for (const node of bladeNodes())
      for (const l of l13sOf(node))
        for (const [c6, c7] of TABLE_CELLS) {
          const k = tableKey(node, l, c6, c7)
          if (tab[k]) continue
          const lay = bladeLayoutFor(gridOf(node, l), 1e5)
          const r = compareArms({ node, l6: c6, l7: c7, l13: l, seeds: TABLE_SEEDS, placed: lay.placed, gbMax: sp.BLADE_HOST.gbMax.mid })
          tab[k] = { ratio: +r.ratio.toFixed(5), joinD: +(r.joinWith - r.joinWithout).toFixed(4), withoutH: +r.withoutH.toFixed(4), withH: +r.withH.toFixed(4), layout: lay.key, source: lay.source }
          n++
          writeTable(tab)
          console.log(`BN${node} SF13.${l} SF6.${c6} SF7.${c7} ${lay.key}: ${r.withoutH.toFixed(2)}h -> ${r.withH.toFixed(2)}h (leg x${r.ratio.toFixed(3)}, join ${(r.joinWith - r.joinWithout).toFixed(2)}h)`)
        }
    console.log(`table: ${n} computed, ${Object.keys(tab).length} entries in ${TABLE_FILE}`)
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
  process.exit(0) // the bundle leaves handles open (a run otherwise sits until killed)
}
