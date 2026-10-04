// [IS] THE INSTALL DECISION'S STEPS ON THE BLADEBURNER ROUTE — live BN14.1 2026-10-04.
//
// The healthcheck read PLAN BLOCKED THE PAGE: "a 154.5ms synchronous block
// against 50ms — longest step 154.5ms in 'plan-install' (step 1 of 58)"; 77.1ms
// at 02:56Z, before 4815d69 made every blade exit a mean over Q members
// (bbplan.BLADE_ENSEMBLE). Step 1 of plan.decideInstallGen priced the
// COMMITTED option's point (its remaining wait, re-planned each pass, so never
// memoised) through the synchronous `f` of the route's trajectory — Q black-op
// simulations in one piece before the generator's first yield.
//
//   IS1 WORK UNIT: on a BN14 pass (fixture-bn14-bladecal-passes.json, the start
//       bladeRouteOf builds, the members as progress.js bladeInstallCompareOf
//       prices them) with a committed wait, no step of 'plan-install' exceeds
//       PLAN.maxBlockMs (50ms) — against one member's simulation in one piece
//   IS2 IDENTICAL: the decision paced is the decision drained, and the
//       committed option's point is the members' mean the synchronous pricing
//       gives (the same number the old step computed)
//   IS3 WIRING: the committed point is priced by the generator (`fg`), not `f`
//   IS4 THE OTHER SECTIONS 4815d69 put members in: the route's blade arm
//       (plan.decideBladeRouteGen), the Simulacrum verdict (bbplan.
//       simulacrumVerdictGen) and sleeve.js's fleet search (sleeveplan.
//       bladeFleetGen at Q) — every step under the budget on the same pass
//   IS5 A VOIDED INSTALL IS A NOTE: installgate.BLADE_JUMP_VOID drops BN14's
//       01:32:10Z install from the ledger (8eae161), but the healthcheck failed
//       EXIT JUMP AT INSTALL (+95h) and TWO EXITS AT INSTALL on it every run;
//       planCheck and installRecordCheck now note it, naming the void and its
//       reason — and the same records at any other install still fail

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const T = await import('../sim/bbcal14.mjs')
const BB = T.BB
const P = await import('plan.js')
const SP = await import('sleeveplan.js')
const IG = await import('installgate.js')
const { drain, makePacer } = await import('coop.js')
const FX = JSON.parse(fs.readFileSync(T.FIXTURE, 'utf8'))
const PASS = T.passesOfFixture(FX).find((p) => p.plan?.decisions?.bladeRoute?.samples?.length)
const I = T.inputsOf(PASS)
const NOW = Date.parse(I.at)
const Q = BB.BLADE_ENSEMBLE.Q
const DRAWS = P.makeDraws({ drift: { s: 0.1, nu: 4, a: 2, b: 0.02 }, gymSdLn: 0.1 }, P.PLAN.N, P.seedOf(NOW, 14))
// A batch on the route: combat exp and the stamina the BN14 install bought.
const BATCH = { gains: { strength_exp: 1.1, defense_exp: 1.1, dexterity_exp: 1.1, agility_exp: 1.1, bladeburner_max_stamina: 1.05 }, simulacrum: false }

// progress.js bladeInstallCompareOf on the fixture: members memoised per spec, the point their mean, draw i on member i mod Q.
function bladeCompare() {
  const startFor = (spec) => T.startOf(I, { spec: BB.bladeInstallOfSpec(spec) ?? 'never', now: NOW })
  const memo = new Map()
  const means = new Map()
  const keyOf = (spec) => (spec?.kind === 'wait' ? `w${(+(spec.waitH ?? 0)).toFixed(4)}|${JSON.stringify(spec.blade?.gains ?? null)}|${spec.blade?.simulacrum === true}` : 'never')
  function* memberH(spec, m) {
    const k = `${keyOf(spec)}|${m}`
    if (!memo.has(k)) {
      const r = yield* BB.bladeExitGen(BB.bladeMemberOf(startFor(spec), m, Q))
      memo.set(k, Number.isFinite(r?.hours) ? r.hours : null)
    }
    return memo.get(k)
  }
  function* hoursOf(spec, m = null) {
    if (m !== null) return yield* memberH(spec, m)
    const k = keyOf(spec)
    if (!means.has(k)) means.set(k, yield* BB.bladeExitMeanGen(null, { Q, hoursOfMember: (j) => memberH(spec, j) }))
    return means.get(k).hours
  }
  const seOf = (spec) => {
    const e = means.get(keyOf(spec))
    return e && Number.isFinite(e.sdH) ? +(e.sdH / Math.sqrt(Q)).toFixed(3) : null
  }
  const trajOf = (spec) => ({ f: (inp, d) => drain(hoursOf(spec, BB.bladeMemberOfDraw(d, Q))), fg: function* (inp, d) { return yield* hoursOf(spec, BB.bladeMemberOfDraw(d, Q)) }, noiseKey: P.bladeNoiseKeyOf(spec), se: () => seOf(spec) })
  return { trajOf, hoursOf: (spec) => drain(hoursOf(spec)), sims: () => memo.size }
}

// One pass's decision: 'now', a wait, 'never' priced as points (as progress.js does before the decision), the
// committed wait (1.37h to go) re-priced inside the decision.
async function decideOnce({ paced }) {
  const B = bladeCompare()
  const nowB = BATCH
  const point = { now: { hours: B.hoursOf({ kind: 'wait', waitH: 0, blade: nowB }), blade: nowB }, waits: [{ waitH: 3, hours: B.hoursOf({ kind: 'wait', waitH: 3, blade: nowB }), blade: nowB }], never: { hours: B.hoursOf({ kind: 'never' }) } }
  const prev = { key: 'w2', route: 'blade', installAt: NOW + 1.37 * 3.6e6, spec: { kind: 'wait', waitH: 2, blade: nowB }, meanH: point.never.hours, decidedAt: new Date(NOW - 3.6e6).toISOString() }
  const args = { inputs: {}, count: null, point, prev, draws: DRAWS, redecide: true, budgetMs: 1e9, now: NOW, sameLife: true, route: 'blade', trajOf: B.trajOf }
  if (!paced) return { d: drain(P.decideInstallGen(args)), B }
  const pacer = makePacer({ sliceMs: 40, yieldFn: () => new Promise((r) => setImmediate(r)), memory: new Map() })
  const d = await pacer.slices(P.decideInstallGen({ ...args, clock: pacer.cpuNow }), 'plan-install')
  return { d, B, sec: pacer.stats.sections['plan-install'], block: pacer.stats.maxBlockMs }
}

export async function run() {
  const checks = []
  // Warm the simulation (JIT) so the step times are the model's, not the compiler's.
  BB.bladeExit(BB.bladeMemberOf(T.startOf(I, { now: NOW }), 1, Q))
  const t1 = performance.now()
  BB.bladeExit(BB.bladeMemberOf(T.startOf(I, { spec: { firstH: 1.37, gains: BATCH.gains, simulacrum: false }, now: NOW }), 2, Q))
  const oneSimMs = performance.now() - t1

  const c1 = new Check('IS1', `WORK UNIT: no 'plan-install' step on the BN14 blade route exceeds ${P.PLAN.maxBlockMs}ms (the committed option's Q ${Q} members priced in slices)`)
  checks.push(c1)
  const A = await decideOnce({ paced: true })
  c1.examined(A.sec?.steps ?? 0)
  c1.note(`pass ${I.at.slice(11, 16)}Z: ${A.sec.steps} steps, longest ${A.sec.maxStepMs.toFixed(1)}ms (step ${A.sec.maxStepAt}), longest block ${A.block.toFixed(1)}ms, ${A.sec.cpuMs.toFixed(0)}ms work; one member's simulation in one piece ${oneSimMs.toFixed(1)}ms, ${Q} of them ${(Q * oneSimMs).toFixed(0)}ms (the old step 1)`)
  c1.note(`decision ${A.d.key} mean ${A.d.meanH}h point ${A.d.pointH}h se ${A.d.pointSeH}h; options ${(A.d.options ?? []).map((o) => `${o.key} ${o.pointH}h`).join(', ')}`)
  if (!A.d.options?.some((o) => o.key === 'committed')) c1.fail("the fixture must exercise the committed option (the step that blocked)")
  if (!(A.sec.maxStepMs <= P.PLAN.maxBlockMs)) c1.fail(`a 'plan-install' step took ${A.sec.maxStepMs.toFixed(1)}ms (step ${A.sec.maxStepAt}) against ${P.PLAN.maxBlockMs}ms`)

  const c2 = new Check('IS2', 'IDENTICAL: paced = drained, and the committed point is the members\' mean the synchronous pricing gives')
  checks.push(c2)
  const D = await decideOnce({ paced: false })
  c2.examined(2)
  const strip = (d) => JSON.stringify({ ...d, ms: null, alloc: null })
  if (strip(A.d) !== strip(D.d)) c2.fail('the paced decision differs from the drained one', `${strip(A.d).slice(0, 300)} vs ${strip(D.d).slice(0, 300)}`)
  const committedSpec = { kind: 'wait', installAt: NOW + 1.37 * 3.6e6, waitH: 1.37, n: null, lifeH: null, gains: null, blade: BATCH }
  const sync = bladeCompare().hoursOf(committedSpec)
  const row = (A.d.options ?? []).find((o) => o.key === 'committed')
  c2.note(`committed point: in the decision ${row?.pointH}h, synchronous members' mean ${sync.toFixed(3)}h`)
  if (!(row && Math.abs(row.pointH - +sync.toFixed(3)) < 1e-9)) c2.fail(`the committed point (${row?.pointH}) is not the synchronous members' mean (${sync})`)

  const c3 = new Check('IS3', "WIRING: decideInstallGen prices the committed point through the trajectory's generator")
  checks.push(c3)
  const src = fs.readFileSync(path.join(REPO_ROOT, 'plan.js'), 'utf8')
  const body = src.slice(src.indexOf('export function* decideInstallGen('), src.indexOf('export function installScreenOf('))
  c3.examined(1)
  if (!/pointH = yield\* tOf\(specNow\)\.fg\(inputs\)/.test(body)) c3.fail("plan.decideInstallGen: the committed point must be `yield* tOf(specNow).fg(inputs)` (a synchronous `f` is Q simulations in one step)")
  if (/tOf\(specNow\)\.f\(inputs\)/.test(body)) c3.fail('plan.decideInstallGen still prices the committed point synchronously')

  const c4 = new Check('IS4', `THE OTHER MEMBER SECTIONS: the route's blade arm, the Simulacrum verdict and the fleet search (Q ${Q}) step under ${P.PLAN.maxBlockMs}ms`)
  checks.push(c4)
  const s0 = T.startOf(I, { now: NOW })
  const runs = {
    'plan-bladeRoute': () => P.decideBladeRouteGen({ base: {}, traj: () => 60, bladeStart: s0, draws: DRAWS.slice(0, 6), redecide: true, budgetMs: 1e9, now: NOW }),
    'plan-simulacrum': () => BB.simulacrumVerdictGen({ s0, withoutH: 40, cost: 1e9, repReq: 1e5, wealth: 2e9, rep: 2e5 }),
    bladeFleet: () => SP.bladeFleetGen(s0, 1, null, { Q }),
  }
  for (const [label, gen] of Object.entries(runs)) {
    const pacer = makePacer({ sliceMs: 40, yieldFn: () => new Promise((r) => setImmediate(r)), memory: new Map() })
    const r = await pacer.slices(gen(), label)
    const sec = pacer.stats.sections[label]
    c4.examined(sec.steps)
    c4.note(`${label}: ${sec.steps} steps, longest ${sec.maxStepMs.toFixed(1)}ms (step ${sec.maxStepAt}), ${sec.cpuMs.toFixed(0)}ms work — ${String(r?.why ?? r?.key ?? '').slice(0, 90)}`)
    if (!(sec.maxStepMs <= P.PLAN.maxBlockMs)) c4.fail(`'${label}': a step took ${sec.maxStepMs.toFixed(1)}ms (step ${sec.maxStepAt}) against ${P.PLAN.maxBlockMs}ms`)
  }

  const c5 = new Check('IS5', "A VOIDED INSTALL IS A NOTE: EXIT JUMP / TWO EXITS AT INSTALL on BN14's 01:32:10Z install name the void; any other install still fails")
  checks.push(c5)
  const F14 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn14-install-0132.json'), 'utf8'))
  const rec = F14.installLast
  const jump = F14.exitJump
  const at = rec.at
  const isJT = (f) => /^(EXIT JUMP|TWO EXITS) AT INSTALL/.test(f.what)
  const hasVoid = (ns) => ns.some((n) => n.includes(`VOIDED INSTALL ${at}`) && n.includes('lost inputs'))
  c5.examined(4)
  if (!(IG.BLADE_JUMP_VOID.has(at) && IG.installVoidOf(at)?.why)) c5.fail(`fixture: ${at} must be voided with a reason (installgate.BLADE_JUMP_VOIDS)`)
  if (!(rec.exits?.ok === false && jump.ok === false && jump.install?.at === at)) c5.fail('fixture: the 01:32Z install must carry the failed TWO EXITS and EXIT JUMP records')
  const now5 = Date.parse(at) + 3.6e6
  // installRecordCheck once plan.txt moved on (both checks), planCheck while plan.txt carries the jump.
  const ri = P.installRecordCheck(rec, { now: now5, jump, plan: { exitJump: null } })
  const pc = P.planCheck({ at: new Date(now5).toISOString(), exitJump: jump }, { now: now5 })
  c5.note(`installRecordCheck: ${ri.fails.length} fail(s), notes: ${ri.notes.filter((n) => n.startsWith('VOIDED')).map((n) => n.slice(0, 160)).join(' | ')}`)
  c5.note(`planCheck: ${pc.notes.filter((n) => n.startsWith('VOIDED')).map((n) => n.slice(0, 160)).join(' | ')}`)
  if (ri.fails.some(isJT)) c5.fail('installRecordCheck still fails the voided install', ri.fails.filter(isJT).map((f) => f.what.slice(0, 120)).join('; '))
  if (!(hasVoid(ri.notes) && ri.notes.filter((n) => n.startsWith('VOIDED')).length === 2)) c5.fail('installRecordCheck must note both comparisons on the voided install, naming the void and its reason', JSON.stringify(ri.notes))
  if (pc.fails.some(isJT)) c5.fail('planCheck still fails the voided install', pc.fails.filter(isJT).map((f) => f.what.slice(0, 120)).join('; '))
  if (!hasVoid(pc.notes)) c5.fail("planCheck must note the voided install's jump, naming the void and its reason", JSON.stringify(pc.notes))
  // The control: the same records at an install that is not voided still fail, in both checks.
  const at2 = new Date(Date.parse(at) + 1).toISOString()
  const rec2 = { ...rec, at: at2 }
  const jump2 = { ...jump, install: { ...jump.install, at: at2 }, why: String(jump.why).replace(at, at2) }
  const ri2 = P.installRecordCheck(rec2, { now: now5, jump: jump2, plan: { exitJump: null } })
  const pc2 = P.planCheck({ at: new Date(now5).toISOString(), exitJump: jump2 }, { now: now5 })
  c5.note(`control at ${at2}: installRecordCheck ${ri2.fails.filter(isJT).length} exit fail(s), planCheck ${pc2.fails.filter(isJT).length}`)
  if (ri2.fails.filter(isJT).length !== 2) c5.fail('installRecordCheck must still fail EXIT JUMP and TWO EXITS on an install that is not voided', JSON.stringify(ri2.fails.map((f) => f.what.slice(0, 80))))
  if (pc2.fails.filter(isJT).length !== 1) c5.fail('planCheck must still fail EXIT JUMP on an install that is not voided', JSON.stringify(pc2.fails.map((f) => f.what.slice(0, 80))))
  return checks
}
