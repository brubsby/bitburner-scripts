// [GG] THE KARMA GRIND HELD THE PAGE — live BN14.1, 2026-10-04 00:19Z.
//
// healthcheck: "PLAN BLOCKED THE PAGE: a 284ms synchronous block against 50ms
// — longest step 261.7ms in 'gang-grind' (step 65 of 108)". 'gang-grind' is
// progress.js's karmaChannelCtx.grindArms: sleeveplan.fleetKarmaGrindGen run
// twice through the pass pacer (the fleet alone, then the fleet and the work
// slot) for gangWorthNow's gang decision. The generator yielded every 40
// iterations (GRIND_YIELD_EVERY), sized for a typical iteration; the average
// step live was ~5.5ms, and the one at step 65 — near the fleet arm's end
// (66 steps on this fixture), where each sleeve's skills move every step and
// its crime is re-picked — held 261.7ms. And the route was Bladeburner: the
// gang it priced is acted on by nothing there.
//
// Fixture: tools/test/fixture-bn14-gangrind-0019.json (live /tel/sleeve.txt
// persons, the save's player skills/exp/karma with unit multipliers, the
// plan's cpu record and decisions, the gate's gangWorth; golden = the full
// return of fleetKarmaGrind at b13e2c2 for each case).
//
//   GG1 RESULTS IDENTICAL: every case returns exactly the golden record; the fleet arm reproduces the
//       live gangWorth.grind.fleetH (55.47h)
//   GG2 WORK UNITS: one iteration a step (GRIND_YIELD_EVERY 1), against BEFORE (the same source at 40),
//       counted in steps — load-independent, and BEFORE is seen to hold 40 iterations a step
//   GG3 UNDER THE PACER with a crime evaluation costing what it did live: every 'gang-grind' step and
//       block under PLAN.maxBlockMs, where BEFORE's longest step is past it
//   GG4 MOOT ON THE BLADEBURNER ROUTE: gangWorthNow carries this life's priced verdict before any grind
//       on decisions.bladeRoute 'blade' (plan.BLADE_MOOT.gang), and markBladeMoot marks decisions.gang

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const SP = await import('sleeveplan.js')
const BN = await import('bitNodeMultipliers.js')
const CO = await import('coop.js')
const P = await import('plan.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const F = JSON.parse(SRC('tools/test/fixture-bn14-gangrind-0019.json'))
const node = BN.bitNodeMults(14)
const optsOf = (c) => ({ ...c.o, player: c.o.player ? F.player : undefined })
const stepsOf = (gen) => {
  let n = 0
  for (let r = gen.next(); ; r = gen.next()) {
    n++
    if (r.done) return { n, value: r.value }
  }
}

export async function run() {
  const checks = []

  {
    const c = new Check('GG1', 'the karma grind returns exactly what it did before the yields moved (b13e2c2 golden), and the fleet arm is the live 55.47h')
    checks.push(c)
    for (const k of F.cases) {
      c.examined(1)
      const now = stepsOf(SP.fleetKarmaGrindGen(F.persons, node, optsOf(k))).value
      const drained = SP.fleetKarmaGrind(F.persons, node, optsOf(k))
      if (JSON.stringify(now) !== JSON.stringify(k.golden)) c.fail(`GG1 ${k.name}: the grind differs from the golden`, `now ${JSON.stringify(now).slice(0, 200)} / golden ${JSON.stringify(k.golden).slice(0, 200)}`)
      else if (JSON.stringify(drained) !== JSON.stringify(now)) c.fail(`GG1 ${k.name}: fleetKarmaGrind (drained) differs from the generator`)
      else c.note(`${k.name}: identical, ${now.hours.toFixed(3)}h`)
    }
    const fleet = F.cases.find((k) => k.name === 'fleet-6h')
    c.examined(1)
    if (fleet.golden.hours !== F.gangWorth.grind.fleetH) c.fail(`GG1 the fixture's fleet arm (${fleet.golden.hours}h) is not the live verdict's (${F.gangWorth.grind.fleetH}h)`)
  }

  // BEFORE: the same source with the yield batch at its old 40 (written beside the OS temp dir).
  const src = SRC('sleeveplan.js')
  const beforeSrc = src.replace(/^export const GRIND_YIELD_EVERY = \d+$/m, 'export const GRIND_YIELD_EVERY = 40')
  const beforeFile = path.join(os.tmpdir(), `sleeveplan-yield40-${process.pid}.mjs`)
  fs.writeFileSync(beforeFile, beforeSrc)
  const BEFORE = await import(beforeFile)
  fs.rmSync(beforeFile, { force: true })

  {
    const c = new Check('GG2', 'one grind iteration a step: the pacer, not a fixed batch, decides how much runs between yields')
    checks.push(c)
    c.examined(1)
    if (SP.GRIND_YIELD_EVERY !== 1) c.fail(`GG2 GRIND_YIELD_EVERY is ${SP.GRIND_YIELD_EVERY}: each iteration must be its own step`)
    if (beforeSrc === src && SP.GRIND_YIELD_EVERY === 1) c.fail('GG2 the BEFORE rewrite did not apply (GRIND_YIELD_EVERY not found)')
    for (const k of F.cases) {
      c.examined(1)
      const a = stepsOf(SP.fleetKarmaGrindGen(F.persons, node, optsOf(k)))
      const b = stepsOf(BEFORE.fleetKarmaGrindGen(F.persons, node, optsOf(k)))
      // The iterations: after yields once per iteration (n - 1 yields, the last step returns).
      const iters = a.n - 1
      const perStepBefore = iters / Math.max(1, b.n - 1)
      if (JSON.stringify(a.value) !== JSON.stringify(b.value)) c.fail(`GG2 ${k.name}: the yield batch changed the result`)
      if (!(perStepBefore >= 30)) c.fail(`GG2 ${k.name}: BEFORE runs ${perStepBefore.toFixed(1)} iterations a step — the count cannot see the live defect`)
      c.note(`${k.name}: ${iters} iterations; ${b.n} steps before (${perStepBefore.toFixed(1)} a step) -> ${a.n} after (1 a step)`)
    }
  }

  {
    const c = new Check('GG3', "under the pass pacer, no 'gang-grind' step or block exceeds PLAN.maxBlockMs, with a crime evaluation costing what it did live")
    checks.push(c)
    // THE LOAD: live the 40-iteration step averaged ~5.5ms and the worst 261.7ms
    // (~6.5ms an iteration). Here every crime evaluation (crimeChance reads
    // node.CrimeSuccessRate once) costs EVAL_MS, so an iteration that re-picks
    // the fleet's crimes (5 sleeves x the catalogue) costs a few ms, as live.
    const EVAL_MS = 0.03
    const spin = (ms) => {
      const t = performance.now()
      while (performance.now() - t < ms);
    }
    const costly = new Proxy(node, { get: (t, k) => (k === 'CrimeSuccessRate' && spin(EVAL_MS), t[k]) })
    const paced = async (mod) => {
      const pacer = CO.makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: () => new Promise((r) => setImmediate(r)), memory: new Map() })
      const o = optsOf(F.cases.find((k) => k.name === 'fleet-6h'))
      const f = await pacer.slices(mod.fleetKarmaGrindGen(F.persons, costly, o), 'gang-grind')
      const p = await pacer.slices(mod.fleetKarmaGrindGen(F.persons, costly, { ...o, player: F.player }), 'gang-grind')
      return { f, p, sec: pacer.stats.sections['gang-grind'], block: pacer.stats.maxBlockMs }
    }
    const now = await paced(SP)
    const was = await paced(BEFORE)
    c.examined(2)
    const lim = P.PLAN.maxBlockMs
    if (JSON.stringify(now.f) !== JSON.stringify(F.cases.find((k) => k.name === 'fleet-6h').golden)) c.fail('GG3 the paced fleet arm is not the golden one')
    if (!(now.sec.maxStepMs < lim)) c.fail(`GG3 a ${now.sec.maxStepMs.toFixed(1)}ms step in 'gang-grind' (step ${now.sec.maxStepAt} of ${now.sec.steps}) against the ${lim}ms block limit`)
    if (!(now.block < lim)) c.fail(`GG3 a ${now.block.toFixed(1)}ms block against the ${lim}ms limit`)
    if (!(was.sec.maxStepMs >= lim)) c.fail(`GG3 BEFORE's longest step is ${was.sec.maxStepMs.toFixed(1)}ms — the load cannot see the live defect`)
    c.note(`crime evaluation at ${EVAL_MS}ms: longest step ${was.sec.maxStepMs.toFixed(1)}ms (step ${was.sec.maxStepAt} of ${was.sec.steps}) before -> ${now.sec.maxStepMs.toFixed(2)}ms (step ${now.sec.maxStepAt} of ${now.sec.steps}) after; longest block ${was.block.toFixed(1)} -> ${now.block.toFixed(1)}ms (limit ${lim}ms); work ${was.sec.cpuMs.toFixed(0)} -> ${now.sec.cpuMs.toFixed(0)}ms`)
    c.note(`live as captured: ${JSON.stringify(F.cpu)}`)
  }

  {
    const c = new Check('GG4', "on the committed Bladeburner route the gang is not re-priced: the life's priced verdict is carried before any grind (plan.BLADE_MOOT.gang)")
    checks.push(c)
    const prog = SRC('progress.js')
    const at = prog.indexOf('async function gangWorthNow(')
    const end = prog.indexOf('\n}\n', at)
    const fn = prog.slice(at, end)
    c.examined(4)
    const gate = fn.indexOf("if (brM?.key === 'blade')")
    const grind = fn.indexOf('await kctx.grindArms()')
    const decide = fn.indexOf("planDecide(pc, 'gang'")
    if (gate < 0) c.fail("GG4 gangWorthNow must test decisions.bladeRoute 'blade' (live plan, else the last plan.txt of this node)")
    else if (!(gate < grind && gate < decide)) c.fail('GG4 the route test must come before the grind and the gang decision')
    if (!/return \{ \.\.\.was, moot: BLADE_MOOT\.gang/.test(fn)) c.fail('GG4 the carried verdict must be the priced one, unchanged, marked moot with the reason')
    if (!/gate\?\.lastAugReset === info\?\.lastAugReset/.test(fn) || !/typeof was\.worth === 'boolean'/.test(fn)) c.fail("GG4 only this life's PRICED verdict is carried (else price it in full once)")
    if (!/notApplicable: BLADE_MOOT\.gang/.test(fn)) c.fail('GG4 the skipped gang decision must be published not applicable, with the reason')
    if (!P.BLADE_MOOT.gang) c.fail('GG4 plan.BLADE_MOOT must name the gang')
    // Why it is moot, held to the sources it rests on.
    const act = SRC('actplan.js')
    const b0 = act.indexOf("if (bl?.open === true && bl.route !== 'hack')")
    const g1 = act.indexOf('const gw = deadWhy ?')
    c.examined(3)
    if (!(b0 > 0 && g1 > b0)) c.fail("GG4 actplan's Bladeburner branch (0b) must precede every gang branch — the carried verdict rests on it")
    if (!/if \(br\?\.key === 'blade'\) \{\s*const why0 = `not applicable: \$\{BLADE_MOOT\.sleeveObjective\}`/.test(prog)) c.fail("GG4 sleeveObjectiveByExit must keep the fleet off karma on the route — the carried verdict rests on it")
    if (!/byExit\?\.blade !== true && verdict\?\.worth === true/.test(prog)) c.fail('GG4 writeSleevePlan must not put the fleet on karma from the verdict on the route')
    const marked = P.markBladeMoot({ bladeRoute: { key: 'blade' }, install: { route: 'blade' }, gang: { key: 'fleet', options: [] } })
    c.examined(1)
    if (marked.gang.applicable !== false || marked.gang.key !== 'fleet') c.fail('GG4 markBladeMoot must mark decisions.gang on the route, keeping its key')
    c.note(`live: bladeRoute '${F.plan.bladeRoute.key}', decisions.gang '${F.plan.gang.key}', gangWorth worth ${F.gangWorth.worth} arm '${F.gangWorth.arm}' — priced, acted on by nothing on the route`)
  }

  return checks
}
