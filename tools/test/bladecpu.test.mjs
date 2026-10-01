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
      const r = stepped(SP.bladeFleetGen(stateAt(rank), 5))
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
  return checks
}
