// tools/sim/gameplan — the whole-game BitNode order planner.
//
//   GP1 THE SEARCH IS EXACT: on small synthetic lattices, the DP's optimum equals
//       brute force over every order; its path sums to V(start); the best first
//       move's T equals V(start); nextnode's local search is never below it.
//   GP2 THE SURROGATE INTERPOLATES: hacking hours interpolated in ln g against the
//       simulation called directly at off-grid points; max and median error printed.
//   GP3 NEXTNODE REPRODUCED where the models coincide: in nextnode's cal/mid/mid
//       and off/mid/mid cells, the first-move totals of nextnode's own local search
//       (ported onto this planner's clear-time table, direct sims) match
//       /tmp/nextnode-bn6.out (919b8ca) to 0.15h, and the exact DP is <= each.
//       Run in PHASE-1 MODE (no IPvGO model, no gym scale on the opening,
//       HackingSpeedMultiplier at 1): phase 2 moves those numbers on purpose.
//   GP5 THE POSTERIOR LEARNS (posterior.mjs, observe.mjs; pure, no game): the
//       z-grid update equals the conjugate normal answer and recovers a known
//       value from synthetic readings; the hierarchical g update equals the
//       closed-form normal-normal posterior of mu, recovers a known mu, and an
//       observed unplayed node pulls every unplayed node (by exactly
//       vMu/(vMu+tau^2+sd^2) of the surprise) while base-measured nodes stay put;
//       re-observing is a no-op (keys); an empty log is the hand prior bit for bit.
//   GP4 THE IPvGO MODEL IS THE GAME'S: go.mjs's transcriptions against the game
//       source functions (CalculateEffect at GoPower 4 and the SF14 doubling,
//       getMaxRep per SF14 level, the favor award played through endGoGame and
//       its cap, favor <-> rep, BN14's multipliers), the favor life's ordering
//       in SF14, the w0r1d_d43m0n exit shift against exitplan at exitLevel/W,
//       BN14's HackingSpeedMultiplier in the simulation, the gym scale.
//
// CALIBRATION: GP1 is a property of the optimiser (no game quantity). GP2 is a
// numerical check of the surrogate against the simulation it tabulates. GP3 is a
// regression against an earlier model's printed output, NOT a calibration: the
// models' own calibration state is stated in tools/sim/gameplan/*.mjs headers
// (NOT CALIBRATED on unplayed nodes and every ASSUMED SF effect).
//
// GP2/GP3 need the nodechoice game bundle, the live telemetry and the
// Bladeburner sim cache (all gitignored, local only). When one is missing they
// WARN with the reason — "could not check" is never reported as PASS. They run
// in a child process (2GB heap cap) so the suite's process does not hold the
// game bundle.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import { makeState, lattice } from '../sim/gameplan/state.mjs'
import { buildTable, solveDP, bestPath, firstMoves, bruteForce, localSearch, evalOrder } from '../sim/gameplan/search.mjs'
import { rng, normal, worldOf } from '../sim/gameplan/params.mjs'
import { scalarPosterior, valueAt, gBase, gUpdate, gSummary, posteriorOf, emptyStore, mergeObs, summarise, scalarSpecs, normaliseObs, loadStore, POSTERIOR_FILE } from '../sim/gameplan/posterior.mjs'
import { obsRecord } from '../../gameplan-obs.js'
import { readingsFromSegments } from '../sim/gameplan/observe.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GP = path.join(HERE, '../sim/gameplan')

function gp1() {
  const c = new Check('GP1', 'the order search is exact: DP == brute force on synthetic lattices; local search never beats it')
  let worst = 0
  let lsGap = 0
  for (let inst = 0; inst < 12; inst++) {
    const r = rng(1000 + inst)
    // a start with a handful of clears owed across 4-5 nodes (levels near target)
    // (6-9 clears owed: brute force over every distinct order stays < 1s)
    const pairs = [[1, 3], [2, 1 + Math.floor(r() * 2)], [5, 1 + Math.floor(r() * 2)], [6, 2], [9, 2], [11, 1 + Math.floor(r() * 2)], [12, 0]]
    for (const n of [3, 4, 7, 8, 10, 13, 14]) pairs.push([n, 3])
    const start = makeState(pairs)
    const L = lattice(start)
    // a random clear time that depends on every live level, interacting
    const base = new Map(L.dims.map((d) => [d.n, 10 + 50 * r()]))
    const eff = new Map(L.dims.map((d) => [d.n, new Map(L.dims.map((e) => [e.n, 0.25 * r()]))]))
    const inert = new Set(inst % 2 ? [2] : [])
    const clearFn = (n, lv) => {
      let h = base.get(n)
      for (const d of L.dims) if (!inert.has(d.n)) h *= 1 - eff.get(n).get(d.n) * (lv(d.n) - d.lo) / 3
      return h + (inst % 3 === 0 ? 3 * Math.sin(n * lv(n) + lv(5)) : 0)
    }
    const T = buildTable(L, clearFn, (n) => !inert.has(n))
    const V = solveDP(L, T)
    const bf = bruteForce(L, T)
    const path0 = bestPath(L, T, V)
    const sumPath = path0.reduce((a, s) => a + s.h, 0)
    const fm = firstMoves(L, T, V)
    const bestFirst = Math.min(...fm.map((x) => x.T))
    const evPath = evalOrder(L, T, path0.map((s) => s.n)).T
    c.examined(1)
    const err = Math.max(Math.abs(V[0] - bf.T), Math.abs(sumPath - V[0]), Math.abs(bestFirst - V[0]), Math.abs(evPath - V[0]))
    worst = Math.max(worst, err)
    for (const x of fm) {
      const ls = localSearch(L, T, x.n)
      if (ls.T < x.T - 1e-9) c.fail(`instance ${inst}: local search first=BN${x.n} T ${ls.T} below the DP's ${x.T}`)
      lsGap = Math.max(lsGap, ls.T - x.T)
    }
    if (err > 1e-9) c.fail(`instance ${inst}: DP ${V[0].toFixed(4)} vs brute force ${bf.T.toFixed(4)} (path ${sumPath.toFixed(4)}, best first ${bestFirst.toFixed(4)})`, `${L.size} states, ${path0.length} clears`)
    else if (inst < 3) c.note(`instance ${inst}: ${L.size} states, ${path0.length} clears owed, DP = brute force = ${V[0].toFixed(3)}h`)
  }
  c.note(`max |DP - brute force| over 12 instances: ${worst.toExponential(1)}; local search's worst excess over the exact optimum ${lsGap.toFixed(3)}h`)
  return c
}

function child() {
  const c2 = new Check('GP2', 'the surrogate: hacking hours interpolated in ln g vs the simulation called directly (off-grid points)')
  const c3 = new Check('GP3', "nextnode.mjs reproduced where the models coincide (cal/mid/mid, off/mid/mid, phase-1 mode), and the DP <= its local search")
  const c4 = new Check('GP4', "the IPvGO model (go.mjs) against the game's own Go, favor and multiplier functions, and its exit shift against the simulation")
  // the game-source half: the tools/sim bundle, in its own child (not the nodechoice bundle's process)
  {
    const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'gotest.mjs')], { encoding: 'utf8', timeout: 600e3 })
    let res
    try {
      res = JSON.parse(r.stdout.trim().split('\n').pop())
    } catch {
      res = { skip: 'gotest.mjs produced no result: ' + ((r.stderr || '').slice(-600) || `exit ${r.status}`) }
    }
    if (res.skip) c4.warn('could not check (game source): ' + res.skip)
    else {
      c4.examined(res.examined)
      for (const n of res.notes) c4.note(n)
      for (const f of res.fails) c4.fail(f)
    }
  }
  const need = [path.join(GP, '../nodechoice/game.bundle.mjs'), path.join(GP, '.cache/bb.json')]
  const missing = need.filter((f) => !fs.existsSync(f))
  if (missing.length) {
    for (const c of [c2, c3, c4]) c.warn('could not check: missing ' + missing.map((f) => path.relative(path.join(HERE, '../..'), f)).join(', '), 'build with: node tools/sim/gameplan/plan.mjs --build-only')
    return [c2, c3, c4]
  }
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'selftest.mjs')], { encoding: 'utf8', timeout: 600e3 })
  let out
  try {
    out = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    for (const c of [c2, c3, c4]) c.warn('could not check: selftest.mjs produced no result', (r.stderr || '').slice(-800) || `exit ${r.status}`)
    return [c2, c3, c4]
  }
  for (const [c, res] of [[c2, out.gp2], [c3, out.gp3], [c4, out.gp4]]) {
    if (res.skip) {
      c.warn('could not check: ' + res.skip)
      continue
    }
    c.examined(res.examined)
    for (const n of res.notes) c.note(n)
    for (const f of res.fails) c.fail(f)
  }
  return [c2, c3, c4]
}

function gp5() {
  const c = new Check('GP5', 'the posterior: conjugate-exact scalar and hierarchical updates, recovery of known parameters, the hierarchical pull, idempotent observation, hand prior reproduced on an empty log')
  const close = (a, b, tol, what) => {
    c.examined(1)
    if (!(Math.abs(a - b) <= tol)) c.fail(`${what}: ${a} vs ${b} (tol ${tol})`)
  }
  // (1) scalar, conjugate: prior N(0,1) (lo/mid/hi = -1.2816/0/1.2816 is the identity), readings y_i ~ N(theta, s^2) in lin space
  {
    const spec = { lo: -1.2816, mid: 0, hi: 1.2816 }
    const obs = [0.9, 1.4, 0.6].map((value) => ({ value, sd: 0.5, space: 'lin' }))
    const post = scalarPosterior(spec, obs)
    const prec = 1 + obs.length / 0.25
    const mean = obs.reduce((a, o) => a + o.value / 0.25, 0) / prec
    const sd = Math.sqrt(1 / prec)
    for (const z of [-1.2816, 0, 1.2816]) close(valueAt(spec, post.map(z)), mean + z * sd, 2e-3, `conjugate normal: posterior quantile at z ${z}`)
    c.note(`scalar conjugate check: posterior N(${mean.toFixed(4)}, ${sd.toFixed(4)}^2) reproduced at p10/p50/p90 to 2e-3`)
  }
  // (2) scalar recovery: a k-like split-normal prior, 60 log-normal readings of a true 1.05 (sd 0.1)
  {
    const spec = { lo: 0.8, mid: 0.916, hi: 1.15, min: 0.3 }
    const r = rng(77)
    const truth = 1.05
    const obs = Array.from({ length: 60 }, () => ({ value: truth * Math.exp(0.1 * normal(r)), sd: 0.1, space: 'log' }))
    const post = scalarPosterior(spec, obs)
    const [p10, p50, p90] = [-1.2816, 0, 1.2816].map((z) => valueAt(spec, post.map(z)))
    c.examined(1)
    if (!(p10 < truth && truth < p90) || Math.abs(p50 / truth - 1) > 0.03) c.fail(`scalar recovery: truth ${truth} vs posterior ${p10.toFixed(3)}/${p50.toFixed(3)}/${p90.toFixed(3)}`)
    if (!(p90 - p10 < 0.06)) c.fail(`scalar recovery: 60 readings at sd 0.1 left the p10-p90 width at ${(p90 - p10).toFixed(3)}`)
    c.note(`scalar recovery: truth ${truth}, 60 readings -> p10/p50/p90 ${p10.toFixed(3)}/${p50.toFixed(3)}/${p90.toFixed(3)} (prior 0.800/0.916/1.150)`)
    // a clipped prior (w0-like: mass at 0) read at 0 in lin space: finite, and the median goes to the clip
    const w = { lo: 0, mid: 200, hi: 1000, min: 0 }
    const pw = scalarPosterior(w, [{ value: 0, sd: 20, space: 'lin' }])
    close(valueAt(w, pw.map(0)), 0, 1e-9, 'w0 read at 0 (lin): posterior median at the clip')
  }
  // a synthetic economy: 14 nodes, AMC 2 on four of them, BN1 and BN9 measured in the base
  const econ = (own) => ({
    gScen: { lo: 0.04, mid: 0.065, hi: 0.13 },
    gamma: 0.6,
    amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, [3, 5, 11, 13].includes(i + 1) ? 2 : 1])),
    ownG: new Map(own),
    profile: { cycleHours: 2 },
    runs: [],
  })
  // (3) hierarchical: closed form, the pull, recovery
  {
    const e = econ([[1, 0.05], [9, 0.05]])
    const G = gBase(e)
    const vMu = G.P[0][0]
    const tau2 = G.tau2
    const m0 = G.m[0]
    const sd = 0.15
    // closed form for mu after k unplayed nodes each read once: precision 1/vMu + k/(tau2 + sd^2)
    const reads = [[3, Math.log(0.09)], [6, Math.log(0.11)], [12, Math.log(0.08)]]
    const G2 = gBase(e)
    for (const [n, y] of reads) gUpdate(G2, n, y + e.gamma * Math.log(e.amc[n]), sd * sd)
    const w = 1 / (tau2 + sd * sd)
    const precMu = 1 / vMu + reads.length * w
    const muCF = (m0 / vMu + reads.reduce((a, [n, y]) => a + w * (y + e.gamma * Math.log(e.amc[n])), 0)) / precMu
    close(G2.m[0], muCF, 1e-9, 'hierarchical: mu posterior mean vs the closed form')
    close(G2.P[0][0], 1 / precMu, 1e-12, 'hierarchical: mu posterior variance vs the closed form')
    // the pull: one unplayed node read 0.5 high moves every other unplayed node by vMu/(vMu+tau2+sd^2) x 0.5
    const G3 = gBase(e)
    gUpdate(G3, 6, m0 + 0.5, sd * sd)
    const shift = (vMu / (vMu + tau2 + sd * sd)) * 0.5
    for (const n of [2, 7, 14]) close(G3.m[n] - m0, shift, 1e-9, `hierarchical pull on unplayed BN${n}`)
    close(G3.m[1], G.m[1], 0, 'a base-measured node is not moved by another node')
    close(G3.m[9], G.m[9], 0, 'a base-measured node is not moved by another node')
    const sum3 = gSummary(G3)
    c.examined(1)
    if (!(sum3.rho < 0.5 && sum3.gScale < 1)) c.fail(`one reading must shrink the common share and the spread: rho ${sum3.rho}, scale ${sum3.gScale}`)
    c.note(`hierarchical pull: BN6 read +0.50 in ln g -> mu and every other unplayed node +${shift.toFixed(3)}, BN6 itself +${(G3.m[6] - m0).toFixed(3)}; common share 0.5 -> ${sum3.rho.toFixed(3)}, spread x${sum3.gScale.toFixed(3)}`)
    // recovery of a known population: 12 unplayed nodes drawn around mu* = ln 0.1 (prior centre ln 0.065)
    const r = rng(5)
    const muT = Math.log(0.1)
    const G4 = gBase(econ([]))
    for (let n = 1; n <= 12; n++) {
      const x = muT + Math.sqrt(G4.tau2) * normal(r)
      for (let k = 0; k < 3; k++) gUpdate(G4, n, x + sd * normal(r), sd * sd)
    }
    const z = (G4.m[0] - muT) / Math.sqrt(G4.P[0][0])
    c.examined(1)
    if (Math.abs(z) > 2.5) c.fail(`hierarchical recovery: mu ${G4.m[0].toFixed(3)} vs truth ${muT.toFixed(3)} (${z.toFixed(1)} sd)`)
    c.note(`hierarchical recovery: 12 nodes x 3 readings -> population g ${Math.exp(G4.m[0]).toFixed(4)} (truth 0.1000, ${z.toFixed(2)} posterior sd off; prior centre 0.0650)`)
  }
  // (4) the store: an empty log is the hand prior bit for bit; observation is idempotent
  {
    const e = econ([[1, 0.05], [9, 0.05]])
    const p0 = posteriorOf(emptyStore(), e)
    const zs = { g3: 0.7, g6: -1.1, k: 0.4, open: -0.3, w0: 1.5, eps14: -2, z9: 0.9 }
    const a = worldOf(e, zs)
    const b = worldOf(p0.applied, zs)
    for (const n of [1, 3, 6, 9, 14]) close(b.g(n), a.g(n), 0, `empty log: g(${n}) equals the hand prior`)
    close(b.k, a.k, 0, 'empty log: k')
    close(b.open, a.open, 0, 'empty log: open')
    for (const k of ['w0', 'eps14', 'z9']) close(b.sf[k], a.sf[k], 0, `empty log: ${k}`)
    // readings from synthetic segments: a base hacking clear, a new one, a Bladeburner clear, a Bladeburner node in progress
    const segs = [
      { bitNode: 1, startedAt: '2026-09-27T20:50:00Z', endedAt: '2026-09-28T18:38:00Z', hours: 21.8, sfOnEntry: [[1, 2]], maxLevel: 7000, bbJoinH: null, combat100H: 0.4 },
      { bitNode: 11, startedAt: '2026-10-05T00:00:00Z', endedAt: '2026-10-07T00:00:00Z', hours: 40, sfOnEntry: [[1, 3]], maxLevel: 6000, bbJoinH: null, combat100H: 1 },
      { bitNode: 7, startedAt: '2026-10-07T00:00:10Z', endedAt: '2026-10-08T12:00:00Z', hours: 30, sfOnEntry: [[6, 1]], maxLevel: 300, bbJoinH: 4, combat100H: 3 },
      { bitNode: 3, startedAt: '2026-10-08T12:00:30Z', endedAt: '2026-10-08T15:00:00Z', hours: 3, sfOnEntry: [[6, 1]], maxLevel: 200, bbJoinH: 2.5, combat100H: 2.2 },
    ]
    const fns = { gOf: (bn, sf, T) => 2 / T, bbLeg: () => 25, gymDiff: (bn) => (bn === 7 ? 0.5 : 0), earlyOf: () => 0, base: [{ param: 'g', bn: 1, start: '2026-09-27T20:50' }] }
    const R = readingsFromSegments(segs, fns)
    const ids = R.map((o) => `${o.param}:${o.clear}${o.inBase ? '(base)' : ''}`).join(' ')
    const want = 'g1:BN1.3(base) g11:BN11.1 open:BN7.1 k:BN7.1 open:BN3.1'
    c.examined(1)
    if (ids !== want) c.fail(`readings from segments: ${ids}`, `expected ${want}`)
    close(R.find((o) => o.param === 'k')?.value, (30 - 3) / 25, 1e-12, 'k reading = (hours - opening) / leg')
    close(R.find((o) => o.param === 'open' && o.node === 7)?.value, 2.5, 1e-12, 'open reading = combat 100 - gym scale')
    const st = emptyStore()
    const m1 = mergeObs(st, R)
    const s1 = JSON.stringify(summarise(posteriorOf(st, e), e))
    const m2 = mergeObs(st, readingsFromSegments(segs, fns))
    const s2 = JSON.stringify(summarise(posteriorOf(st, e), e))
    c.examined(1)
    if (m1.added !== R.length || m2.added !== 0 || m2.dup !== R.length || s1 !== s2) c.fail(`idempotency: first merge +${m1.added}, second +${m2.added} (dup ${m2.dup}); posterior ${s1 === s2 ? 'unchanged' : 'CHANGED'}`)
    const p1 = posteriorOf(st, e)
    c.examined(1)
    if (p1.nObs !== R.length - 1) c.fail(`the in-base reading must not be applied: ${p1.nObs} applied of ${R.length}`)
    if (!(p1.applied.ownG.has(11) && p1.applied.ownG.get(1) === 0.05)) c.fail('BN11 must become an own-g node, BN1 (in base) must keep its measured g')
    c.note(`idempotency: ${R.length} readings from 4 synthetic segments (${ids}); re-observing added ${m2.added}, the posterior unchanged; the in-base BN1 reading logged, not applied`)
  }
  // (5) the channel: gameplan-obs.js (the game's writer) and normaliseObs (the reader) agree on the schema;
  //     the committed posterior.json loads, its keys are unique and every logged reading still validates
  {
    const specs = scalarSpecs()
    for (const param of [...Object.keys(specs), 'g11']) {
      const rec = obsRecord({ param, value: 1.5, sd: 0.2, source: 'test', node: 4 }, '2026-10-03T00:00:00Z')
      const [o, why] = normaliseObs(JSON.parse(JSON.stringify(rec)), specs)
      c.examined(1)
      if (!o) c.fail(`gameplan-obs.js writes a ${param} reading observe rejects: ${why}`)
    }
    let threw = 0
    for (const bad of [{ param: 'nope', value: 1, sd: 1, source: 's' }, { param: 'w0', value: 0, sd: 5, source: 's' }, { param: 'k', value: 1, sd: 0, source: 's' }]) {
      try {
        obsRecord(bad)
      } catch {
        threw++
      }
    }
    c.examined(1)
    if (threw !== 3) c.fail(`gameplan-obs.js accepted ${3 - threw} malformed readings`)
    const ok = obsRecord({ param: 'w0', value: 0, sd: 5, space: 'lin', source: 's' })
    c.examined(1)
    if (!normaliseObs(ok, specs)[0]) c.fail('a w0 reading of 0 in lin space must be accepted')
    if (!fs.existsSync(POSTERIOR_FILE)) c.fail(`no committed ${path.basename(POSTERIOR_FILE)}`)
    else {
      const st = loadStore()
      const keys = st.observations.map((o) => o.key)
      c.examined(keys.length)
      if (new Set(keys).size !== keys.length) c.fail('posterior.json: duplicate observation keys')
      for (const o of st.observations) if (!normaliseObs(o, specs)[0]) c.fail(`posterior.json: logged reading ${o.key} no longer validates: ${normaliseObs(o, specs)[1]}`)
      c.note(`posterior.json: version ${st.version}, ${keys.length} logged readings (${st.observations.filter((o) => !o.inBase).length} applied), updated ${st.updatedAt}`)
    }
  }
  return c
}

export async function run() {
  return [gp1(), gp5(), ...child()]
}
