// STANEK'S GIFT: THE LAYOUT PER LIFE vs ONE FIXED LAYOUT — priced by simulating both runs.
//
//   node tools/sim/stanekperlife.mjs [--node 13 --l13 1] [--H0 25 --g 0.1 --cycle 2.6] [--grid] [--json]
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"): the hacking route
// with the gift accepted at the node's start, every life on the grid's tabled layout (the gameplan's
// stanek route, stanek.mjs stanekFactors), vs every life on ITS OWN layout (stanekplan.lifePolicyOf:
// each life's weights the marginal exit-hours per unit ln(multiplier) in that life, measured on the
// trajectory by finite difference; the layout re-optimised at that life's charge; kept only where the
// trajectory's J rises). One builder (stanek.mjs giftBaseOf), the same H0 / g / world, the same
// linearised fixed point on the run's length (giftRunOf); the charge f re-chosen per arm.
// The decision is perLife - fixed (hours; negative = the per-life policy exits sooner).
//
// The no-gift run's H0 and g are inputs here (the gameplan's surrogate supplies them per node and
// world); the defaults are a BN13-like node (25h, Hg 2.5: stanek.mjs LAYOUT_HG) and lives of 2.6h
// (the gameplan profile's cycleHours). --grid sweeps H0 x Hg x cycle.
//
// CALIBRATION: NOT CALIBRATED. No node has run per-life layouts, so no live quantity reproduces the
// difference; the node model's elasticities, faction_rep at the end, duty are ASSUMED (effects.SF_PARAMS
// st*, mid world here), home RAM MEASURED (history.jsonl). The game-source half (catalogue, effect,
// charge, placement legality) is tools/sim/gameplan/stanektest.mjs. Printed on every run.

import '../test/gameresolve.mjs'
import { nodeMults } from './nodechoice/hackexit.mjs'
import { SF_PARAMS } from './gameplan/effects.mjs'
import { perLifeRunOf, giftBaseOf, layoutText } from './gameplan/stanek.mjs'

const sp = await import('../../stanekplan.js')

export const midWorld = (cycleHours = 2.6) => ({ sf: Object.fromEntries(Object.entries(SF_PARAMS).map(([k, v]) => [k, v.mid])), cycleHours, profile: null })

/** One case: { node, l13, H0, g, cycle, fixedH, perLifeH, dH, lives } . */
export function priceCase({ node, l13, H0, g, cycle, budget }) {
  const m = nodeMults(node)
  const r = perLifeRunOf(node, l13, midWorld(cycle), m, { H0, g }, budget ? { budget } : {})
  return { node, l13, H0, g, cycle, grid: `${r.layout.width}x${r.layout.height}|${m.StaneksGiftPowerMultiplier}`, fixedH: r.fixed.hours, perLifeH: r.perLife.hours, dH: r.dH, fFixed: r.fixed.f, fPer: r.perLife.f, lives: r.perLife.lives, fixedLayout: layoutText(r.layout.placed) }
}

/**
 * THE LIVE EXIT MODEL'S DECISION (exitplan.bestExitPolicy on progress.js's published exit inputs
 * and the committed install basis), exactly as progress.js runs it at an install (stanekplan
 * liveWeightInputsOf -> liveLayoutOptionsOf -> liveLayoutChoiceOf), on a gift charged on the live
 * fleet: the incumbent = the grid's tabled layout at f; the weights the exit's marginal hours per
 * unit ln of each type; the options the incumbent, the tabled, the live-weights layout and the node
 * model's candidates (`nodeCands`), each held for the lives the model repeats.
 */
export async function priceLive({ inputsFile, planFile, stanekFile, width, height, nodePower, f = 0.2, nodeCands = [] }) {
  const fs = await import('node:fs')
  const X = await import('../../exitplan.js')
  const P = await import('../../plan.js')
  const ei = JSON.parse(fs.readFileSync(inputsFile, 'utf8'))
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  const st = JSON.parse(fs.readFileSync(stanekFile, 'utf8'))
  const basis = P.basisOf(plan.decisions?.install ?? null, Date.now())
  const w = Math.max(0, basis?.waitH ?? 0)
  const gains = basis?.gains ?? null
  const raw = { ...ei.inputs }
  delete raw.giftLife
  const hoursOf = (inp) => X.bestExitPolicy({ ...inp, firstInstallH: w, ...(gains ? { installGains: gains, nextInstallGain: gains.hacking ?? null } : {}) }, 400, 1).best?.hours ?? null
  const replayH = hoursOf(raw)
  const tabled = sp.layoutForGrid(width, height, nodePower, 'hack').placed
  // the measured state the decision sees: the tabled layout charged at f (ctx.layout, fNow)
  const ctx0 = { layout: [], nodePower, fleetGB: st.fleet.gb, hosts: st.fleet.hosts, fNow: 0, cycleH: raw.cycleHours }
  const base = sp.layoutInputsOf(raw, ctx0, f, tabled)
  const ctx = { ...ctx0, layout: tabled, fNow: f }
  const H0 = hoursOf(base)
  const weights = sp.liveWeightsOf(H0, sp.liveWeightInputsOf(base).map((x) => ({ type: x.type, hours: hoursOf(x.inputs) })))
  const rows = []
  const { options, c } = sp.liveLayoutOptionsOf({ base, ctx, f, width, height, nodePower, incumbent: tabled }, weights)
  for (const [src, placed] of nodeCands) if (!options.some((o) => o.key === sp.layoutKeyOf(placed))) options.push({ src, placed, key: sp.layoutKeyOf(placed), inputs: sp.layoutInputsOf(base, ctx, f, placed) })
  for (const o of options) rows.push({ ...o, hours: hoursOf(o.inputs) })
  const choice = sp.liveLayoutChoiceOf(rows, { lifeKey: 'tool', weights, c, f, H0 })
  return { choice, rows, at: ei.at, node: ei.bitNode, fleetGB: st.fleet.gb, cycleH: raw.cycleHours, grid: `${width}x${height}|${nodePower}`, planPointH: plan.decisions?.install?.pointH ?? null, replayH }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const arg = (k, d) => (argv.includes(k) ? Number(argv[argv.indexOf(k) + 1]) : d)
  if (argv.includes('--live')) {
    const path = await import('node:path')
    const tel = argv.includes('--tel') ? argv[argv.indexOf('--tel') + 1] : path.join(path.dirname(new URL(import.meta.url).pathname), '../../.telemetry')
    const m = nodeMults(13)
    const gs = sp.giftSize(m.StaneksGiftExtraSize, 1)
    // the node model's per-life layouts (a BN13.2-like run) as further candidates
    const pol = perLifeRunOf(13, 1, midWorld(2.6), m, { H0: 25, g: 0.1 }, { budget: 2e4 })
    const o = { ...giftBaseOf(13, 1, midWorld(2.6), m, { H0: 25, g: 0.1 }).base, hours: pol.perLife.hours, f: pol.perLife.f }
    const lp = sp.lifePolicyOf(o, { width: gs.width, height: gs.height, budget: 2e4, g: 0.1 })
    const seen = new Map()
    lp.layouts.forEach((pl, i) => seen.has(sp.layoutKeyOf(pl)) || seen.set(sp.layoutKeyOf(pl), [`node model ${lp.lives[i].stage}`, pl]))
    const r = await priceLive({ inputsFile: path.join(tel, 'exitinputs.txt'), planFile: path.join(tel, 'plan.txt'), stanekFile: path.join(tel, 'stanek.txt'), width: gs.width, height: gs.height, nodePower: m.StaneksGiftPowerMultiplier, f: arg('--f', 0.2), nodeCands: [...seen.values()] })
    console.log(`LIVE EXIT MODEL on BN${r.node}'s published inputs (${r.at}), life ${r.cycleH}h, fleet ${r.fleetGB.toFixed(0)}GB, a BN13.2 grid ${r.grid} charged on it at f ${r.choice.f}:`)
    console.log(`CHECK the plan's committed point ${r.planPointH}h vs this replay ${r.replayH?.toFixed(3)}h (the plan's route may not be the hacking exit)`)
    console.log(`  weights (exit h per ln, this life): ${JSON.stringify(r.choice.weights)}  c ${r.choice.c}`)
    const inc = r.rows.find((x) => x.src === 'incumbent')?.hours
    for (const x of r.rows) console.log(`  ${x.src.padEnd(20)} ${String(x.key).padEnd(40)} ${x.hours?.toFixed(3)}h  (${(x.hours - inc >= 0 ? '+' : '') + (x.hours - inc).toFixed(3)}h vs the tabled incumbent)`)
    console.log(`  CHOICE: ${r.choice.why}`)
    console.log('CALIBRATION: NOT CALIBRATED — the inputs are live, the gift on them hypothetical (no hacking gift charged this node).')
    process.exit(0)
  }
  const cases = []
  const nodes = argv.includes('--node') ? [[arg('--node'), arg('--l13', 1)]] : [[13, 1], [8, 1]]
  for (const [node, l13] of nodes) {
    if (argv.includes('--grid')) {
      for (const H0 of [12, 25, 50]) for (const Hg of [1.5, 2.5, 4]) for (const cycle of [2.6, 5]) cases.push({ node, l13, H0, g: Hg / H0, cycle })
    } else cases.push({ node, l13, H0: arg('--H0', 25), g: arg('--g', 0.1), cycle: arg('--cycle', 2.6) })
  }
  const out = []
  for (const c of cases) c.budget = arg('--budget', 2e4)
  for (const c of cases) {
    const t0 = performance.now()
    const r = priceCase(c)
    r.ms = Math.round(performance.now() - t0)
    out.push(r)
    if (argv.includes('--json')) continue
    console.log(`BN${r.node} SF13.${r.l13} ${r.grid}  H0 ${r.H0}h g ${r.g.toFixed(3)} (Hg ${(r.H0 * r.g).toFixed(2)}) life ${r.cycle}h: fixed ${r.fixedH.toFixed(3)}h (f ${r.fFixed}) per-life ${r.perLifeH.toFixed(3)}h (f ${r.fPer})  dH ${r.dH.toFixed(3)}h  [${r.ms}ms]`)
    if (!argv.includes('--grid')) {
      console.log(`  fixed layout: ${r.fixedLayout}`)
      for (const l of r.lives) console.log(`  life ${l.life + 1} ${l.stage.padEnd(5)} c ${l.c.toFixed(4)} ${l.changed ? 'RE-LAID' : 'fixed  '} ${l.key}  w(h/ln) ${sp.LIFE_TYPES.map((t) => `${sp.TYPE_NAME[t].replace('Hacking', 'H')} ${l.weights[t].toFixed(3)}`).join(' ')}`)
    }
  }
  if (argv.includes('--json')) console.log(JSON.stringify(out))
  console.log('CALIBRATION: NOT CALIBRATED — no node has run per-life layouts; elasticities / faction_rep / duty ASSUMED (SF_PARAMS st* mid), home RAM MEASURED.')
}
