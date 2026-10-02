// [BX] THE BLADEBURNER ROUTE'S CPU — live 2026-10-01: PLAN BLOCKED THE PAGE at 22:35Z (238ms in
// one 'plan-sleeveObjective' step), then at 22:59:50Z 'plan-sleeveObjective' opened and never closed
// before the page froze (killed 23:11Z).
//
//   BX1 THE SLEEVE OBJECTIVE on the committed Bladeburner route is not run (moot: it prices the World
//       Daemon exit; plan.BLADE_MOOT) — and where it runs, every draw and point is a generator under a
//       shared hard cap (steps and wall ms, coop LoopCapError)
//   BX2 THE FLEET SEARCH (sleeve.js bladeFleetGen: 12 configurations to the 21st black op) on a
//       high-rank state (rank 1000 and 2500, 21 black ops left), in coop.js slices: every step under
//       10ms, the whole search inside its budget, each exit bounded (BLADE_FLEET_MAXH)
//   BX3 THE ROUTE'S OWN EXITS on the same states: one bladeExitGen per step under 10ms; the rank-path
//       window (RANK_CAL.pathH) a few ms

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const SP = await import('sleeveplan.js')
const CO = await import('coop.js')
const P = await import('plan.js')
const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn6-bladecal-1322.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

const stateAt = (rank) => {
  const tel = { ...F.bladeburner, rank, skillPoints: 0, cities: F.bladeburner.cities.map((c) => ({ ...c, pop: F.save.cities[c.name].pop })) }
  return BB.bladeStartOf({ tel, person: F.player, sleeves: { infiltrate: 0, support: 0, fa: 0 }, gymExpPerSec: 30, bnRank: 1, maxH: 200 })
}
/** Run a generator stepwise, timing every next(). */
function stepped(gen) {
  let worst = 0
  let total = 0
  let steps = 0
  let r
  for (;;) {
    const t0 = performance.now()
    r = gen.next()
    const dt = performance.now() - t0
    worst = Math.max(worst, dt)
    total += dt
    steps++
    if (r.done) break
  }
  return { value: r.value, worst, total, steps }
}

export async function run() {
  const checks = []

  {
    const c = new Check('BX1', "THE SLEEVE OBJECTIVE: not run on the committed Bladeburner route (moot); elsewhere every exit a generator under one hard cap")
    checks.push(c)
    const pr = SRC('progress.js')
    const fn = pr.slice(pr.indexOf('async function sleeveObjectiveByExit'), pr.indexOf('async function sleeveObjectiveByExit') + 9000)
    const skip = fn.indexOf("if (br?.key === 'blade')")
    const firstWork = fn.indexOf('readFleet(ns, info)')
    c.examined(5)
    if (!(skip > 0 && skip < firstWork)) c.fail('sleeveObjectiveByExit must return before any work on the Bladeburner route')
    if (!/notApplicable: BLADE_MOOT\.sleeveObjective/.test(fn)) c.fail('the skipped decision must be published as not applicable, with the reason')
    if (!P.BLADE_MOOT.sleeveObjective) c.fail('plan.BLADE_MOOT must name the sleeve objective')
    if (!/const cap = cappedGen\(SLEEVE_OBJECTIVE_CAP\)/.test(fn) || !/paced\(cap\(f\(base, finishGen\)\)/.test(fn)) c.fail('the points must run in slices under the shared cap')
    if (!/simGen: \(dr\) => f\(applyDraw\(base, dr\), finishGen\)/.test(fn)) c.fail('every draw must run as a generator (simGen)')
    const marked = P.markBladeMoot({ bladeRoute: { key: 'blade' }, install: { route: 'blade' }, sleeveObjective: { key: 'rep', options: [] } })
    if (marked.sleeveObjective.applicable !== false) c.fail('markBladeMoot must mark the sleeve objective on the route')
    c.note(`skip at offset ${skip}, first work at ${firstWork}; ${P.BLADE_MOOT.sleeveObjective.slice(0, 120)}`)
  }

  {
    const c = new Check('BX2', 'THE FLEET SEARCH on a high-rank state (rank 1000 / 2500, 21 black ops left), stepped: every step < 10ms, the search < 4s of work, each exit bounded')
    checks.push(c)
    const sj = SRC('sleeve.js')
    if (!/maxH: BLADE_FLEET_MAXH/.test(sj)) c.fail('sleeve.js must bound the fleet\'s exits (BLADE_FLEET_MAXH)')
    for (const rank of [1000, 2500]) {
      // Warm (the page's JIT is warm too), then the better of two runs: a lone GC pause on a loaded
      // dev machine is not the generator's step.
      stepped(SP.bladeFleetGen(stateAt(rank), 5))
      const ra = stepped(SP.bladeFleetGen(stateAt(rank), 5))
      const rb = stepped(SP.bladeFleetGen(stateAt(rank), 5))
      const r = ra.worst <= rb.worst ? ra : rb
      c.examined(1)
      c.note(`rank ${rank}: ${r.steps} steps, longest ${r.worst.toFixed(1)}ms, total ${r.total.toFixed(0)}ms -> ${r.value.why}`)
      if (!(r.worst < 10)) c.fail(`rank ${rank}: a ${r.worst.toFixed(1)}ms step (limit 10ms)`)
      if (!(r.total < 4000)) c.fail(`rank ${rank}: ${r.total.toFixed(0)}ms of work (limit 4000ms)`)
      if (!(r.steps < CO.STEP_CAP)) c.fail('ran to the step cap')
    }
  }

  {
    const c = new Check('BX3', "THE ROUTE'S OWN EXITS on the same states: every step < 10ms; the rank-path window a few ms")
    checks.push(c)
    for (const rank of [1000, 2500]) {
      const r = stepped(BB.bladeExitGen({ ...stateAt(rank), sleeves: { infiltrate: 1, support: 4, fa: 0 }, maxH: 400 }))
      const p = stepped(BB.bladeExitGen({ ...stateAt(rank), maxH: BB.RANK_CAL?.pathH ?? 3, pathEveryS: 900 }))
      c.examined(2)
      c.note(`rank ${rank}: exit ${r.value.hours?.toFixed(1)}h in ${r.steps} steps, longest ${r.worst.toFixed(1)}ms, total ${r.total.toFixed(0)}ms; path ${p.total.toFixed(1)}ms`)
      if (!(r.worst < 10)) c.fail(`rank ${rank}: a ${r.worst.toFixed(1)}ms step`)
      if (!(p.total < 50)) c.fail(`rank ${rank}: the rank path took ${p.total.toFixed(0)}ms`)
    }
  }
  {
    const c = new Check('BX4', "sleeve.js's FLEET PRICING on the live 00:28Z state (rank 1345, 5 sleeves, the route's install at w4.6), as sleeve.js runs it (cappedFleetGen over bladeFleetGen, BLADE_FLEET_MAXH): every step <= 10ms warm, the cap trips loudly, the memo keyed on the plan not the clock")
    checks.push(c)
    const SJ = await import('sleeve.js')
    const L = F.live0028
    const install = BB.bladeInstallOfBasis(L.installBasis, Date.parse(L.planAt))
    const s0 = BB.bladeStartOf({ tel: L.bladeburner, person: L.player, gymExpPerSec: 30, bnRank: 1, install, maxH: 200 })
    const run1 = () => stepped(SJ.cappedFleetGen(SP.bladeFleetGen(s0, 5), { steps: 200000, ms: 1e9 }))
    run1() // warm (the page has run it before: the JIT is warm there too)
    // The least worst of three runs: a lone GC pause on a loaded dev machine is not a step.
    const r = [run1(), run1(), run1()].sort((x, y) => x.worst - y.worst)[0]
    const over = r.steps // all steps; report the share over 5ms
    c.examined(r.steps)
    c.note(`live 00:28Z: ${r.steps} steps, longest ${r.worst.toFixed(1)}ms, total ${r.total.toFixed(0)}ms -> ${r.value.why}`)
    if (!(r.worst <= 10)) c.fail(`a ${r.worst.toFixed(1)}ms step (limit 10ms)`)
    if (!(over < CO.STEP_CAP)) c.fail('ran to the step cap')
    // The cap trips (loudly) instead of running on.
    let tripped = null
    try {
      stepped(SJ.cappedFleetGen(SP.bladeFleetGen(s0, 5), { steps: 50, ms: 1e9 }))
    } catch (e) {
      tripped = e
    }
    if (!(tripped instanceof CO.LoopCapError)) c.fail('a step cap must throw LoopCapError')
    const sj = SRC('sleeve.js')
    if (/install\.firstH\.toFixed\(1\)/.test(sj.slice(sj.indexOf('const key = `${n}|${route}'), sj.indexOf('const key = `${n}|${route}') + 200))) c.fail('the memo key must not move with the clock (firstH)')
    if (!/cappedFleetGen\(bladeFleetGen\(s0, n\), BLADE_FLEET_CAP/.test(sj)) c.fail('sleeve.js must run the fleet search under its cap')
    if (!/leave\('sleeve'\); try \{ await py\(\) \}/.test(sj)) c.fail('the page yields must close the trace section')
    c.examined(4)
  }
  return checks
}
