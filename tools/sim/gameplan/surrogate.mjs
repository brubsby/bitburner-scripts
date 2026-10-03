// THE SURROGATE: the slow simulations, precomputed over the state grid the
// plan can reach, cached on disk, and interpolated.
//
// CALIBRATION: this file adds no model of its own — it is a lookup table of two
// existing ones, and its only error is interpolation error, which
// tools/test/gameplan.test.mjs [GP2] measures against direct simulation at
// off-grid points and prints. The calibration state of what it tabulates:
//   hacking exit   nodechoice/hackexit.mjs (exitplan.bestExitPolicy from a
//                  fresh entry) — its one latent g is backed out of measured
//                  runs (economy.mjs): calibrated on played nodes, NOT
//                  CALIBRATED on unplayed ones;
//   Bladeburner    nodechoice/bbsim.mjs (the game's Bladeburner classes,
//                  bbplan's policy) — CALIBRATED on the live BN6 run, k = 1.223
//                  (live leg / this leg, params.BB_PARAMS); one node, so the per-node shape is not.
//
// THE GRID
//   hack: one curve per (node, node level, the hacking sim's SF key) over
//         ln g — LN_G (961 points, 0.002..1.2 /h; the max off-grid
//         error was 10% at 81 points, 2.3% at 241, 0.3% at 961 — GP2). The SF key is effects.hackSfOf:
//         only the Source-Files whose applySourceFile multipliers the exit
//         simulation reads (SF1, SF5) and SF8>0 (the trader). Hours are
//         interpolated linearly in (ln g, ln hours).
//   bb:   one entry per (node, SF6 1..3, SF7 0..3) and seed: the leg after the
//         join (hours), median over seeds. No interpolation: the levels are the
//         grid. Every other Source-File is held at BB_BASE and intelligence at
//         BB_INT (nextnode.mjs's spec, byte for byte, so its cache is reusable).
//   fleet: the sleeve-count axis (BB_FLEET_N = 5, 6, 7; sleeves.mjs): per (node, n) the
//         live chooser's pick (the fastest of bbplan.sleeveConfigs(n) on BB_SEL_SEEDS at
//         SF6.1/SF7.0), then that pick on every (SF6, SF7) cell x the evaluation seeds;
//         bbLeg(n, l6, l7, k) = the 5-infiltrator leg x median(pick k) / median(pick 5),
//         floored at the k-1 ratio. 13 nodes x (39 configs x 5 + 3 x 12 cells x 15) = 9555
//         sims, ~0.15s each (~25 min once, on one process); bb.json ~2.4MB.
//
// THE CACHE: tools/sim/gameplan/.cache/{hack,bb}.json, one entry per sim call,
// keyed by sha1(code hash + the call's full spec). The hack code hash covers
// exitplan.js, hackexit.mjs and SURROGATE_VERSION; the bb hash is nextnode's
// (bbsim.mjs + bbjobs.mjs + the bundle's size). An edit to a model invalidates
// exactly its own entries; a build computes only what is missing (incremental),
// and the bb runner saves as it goes, so a killed build resumes.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hackExitHours, nodeMults } from '../nodechoice/hackexit.mjs'
import { lattice, lvl, NODES } from './state.mjs'
import { EFFECTS, LIVE_SFS, sfKeyStr } from './effects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NC = path.join(HERE, '../nodechoice')
const REPO = path.resolve(HERE, '../../..')
export const CACHE_DIR = path.join(HERE, '.cache')
export const SURROGATE_VERSION = 'gameplan-surrogate-2' // 2: hackexit reads HackingSpeedMultiplier (BN14 0.3)

export const LN_G_N = 961
export const LN_G = Array.from({ length: LN_G_N }, (_, i) => Math.log(0.002) + (i * (Math.log(1.2) - Math.log(0.002))) / (LN_G_N - 1))
/** The Bladeburner grid's fixed inputs (nextnode.mjs bbSpec, 919b8ca). */
export const BB_BASE = [[1, 3], [2, 1], [4, 2], [5, 1], [8, 1], [9, 1], [10, 1]]
export const BB_INT = 133
export const BB_SLEEVES = 5
export const L6 = [1, 2, 3]
export const L7 = [0, 1, 2, 3]
// THE FLEET-SIZE AXIS (sleeves.mjs: the count is min(3, SF10 + (BN10 ? 1 : 0)) + 4 Covenant, so
// 5..7 here). Each size runs under the live fleet rule — sleeve.js commits
// bbplan.chooseSleeveConfigGen's pick, "every configuration of sleeveConfigs(n), the fastest
// kept" — with the fastest chosen ON THE GAME'S CLASSES per (node, n) at the cell
// BB_SEL_CELL over the selection seeds BB_SEL_SEEDS (disjoint from the evaluation seeds
// 1..bbSeeds, so the pick's winner's curse does not enter the leg). The plan's leg at n
// sleeves is the 5-infiltrator leg (the old grid, the one k is defined on) x
// leg(pick n) / leg(pick 5), paired seed for seed, and never longer than at n-1: an extra
// sleeve may idle (Sleeve idle work does nothing to the division).
export const BB_FLEET_N = [5, 6, 7]
export const BB_SEL_SEEDS = [101, 102, 103, 104, 105]
export const BB_SEL_CELL = [1, 0]
/** sleeveConfigs(n) without the all-idle fleet: the mixes the live chooser compares. */
export const fleetConfigs = (bp, n) => bp.sleeveConfigs(n).filter((c) => c.infiltrate + c.support + c.fa > 0)
const cfgKey = (c) => `i${c.infiltrate}s${c.support}f${c.fa}`

const sha = (...parts) => {
  const h = crypto.createHash('sha1')
  for (const p of parts) h.update(p)
  return h.digest('hex')
}
const HACK_CODE = sha(fs.readFileSync(path.join(REPO, 'exitplan.js')), fs.readFileSync(path.join(NC, 'hackexit.mjs')), SURROGATE_VERSION)
const BB_CODE = sha(fs.readFileSync(path.join(NC, 'bbsim.mjs')), fs.readFileSync(path.join(NC, 'bbjobs.mjs')), String(fs.statSync(path.join(NC, 'game.bundle.mjs')).size))

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {})
const writeJson = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f + '.tmp', JSON.stringify(o))
  fs.renameSync(f + '.tmp', f)
}

const sfKeyPairs = (s) => (s ? s.split(',').map((t) => t.split('.').map(Number)) : [])

/**
 * The post-Red-Pill climb of one hacking exit, for the w0r1d_d43m0n window
 * (go.mjs goWindow): [hours of the 'climb to exit level' leg, u0 = exitLevel /
 * the final multiplier]. A rooting excess past the climb is not window: the
 * level is already reached. null when the exit does not price.
 */
export function climbOf(r) {
  if (!(r?.hours > 0) || !Array.isArray(r.legs)) return null
  const leg = (name) => r.legs.find((l) => l.leg === name)?.hours ?? 0
  const L = leg('climb to exit level')
  const u0 = r.inputs?.exitLevel / r.finalMult
  return isFinite(L) && isFinite(u0) ? [+L.toPrecision(6), +u0.toPrecision(6)] : null
}

// ---------------------------------------------------------------------------
// The grid the plan can reach from `start`
// ---------------------------------------------------------------------------
/** Every (node, nodeLevel, hack SF key) a clear from a state reachable from `start` can ask for. */
export function hackCurvesFor(start) {
  const L = lattice(start)
  const range = (n) => {
    const d = L.dims.find((x) => x.n === n)
    return d ? Array.from({ length: d.size }, (_, i) => d.lo + i) : [lvl(start, n)]
  }
  // the keyed SF levels: product over every SF with a hackKey
  let combos = [[]]
  for (const n of LIVE_SFS.filter((m) => EFFECTS[m].hackKey)) {
    const keyed = [...new Set(range(n).map((l) => EFFECTS[n].hackKey(l)))]
    combos = combos.flatMap((c) => keyed.map((k) => (k > 0 ? [...c, [n, k]] : c)))
  }
  const out = []
  for (const d of L.dims) {
    const n = d.n
    const levels = EFFECTS[n]?.nodeLevel ? [...new Set(range(n).filter((l) => l < d.hi).map((l) => EFFECTS[n].nodeLevel(l)))] : [1]
    for (const nl of levels) for (const c of combos) out.push({ node: n, level: nl, sf: sfKeyStr(c) })
  }
  return out
}

export const hackKeyOf = (curve, g, profile) => sha(HACK_CODE, JSON.stringify({ node: curve.node, level: curve.level, sf: curve.sf, profile, g }))
/** fleet: null = the planner's 5 infiltrators (the old grid's key, byte for byte); else {infiltrate, support, fa}. */
export const bbSpec = (n, l6, l7, seed, bbPolicy, fleet = null) => ({
  node: n, sf: [...BB_BASE, ...(l6 ? [[6, l6]] : []), ...(l7 ? [[7, l7]] : [])], g: 0, installEveryH: null, intelligence: BB_INT, hacking: 200, seed, maxH: 400,
  policy: { shared: true, sharedPolicy: bbPolicy, sleeves: fleet ? { infiltrate: fleet.infiltrate, support: fleet.support, fa: fleet.fa } : { infiltrate: BB_SLEEVES }, gymTo: 100, useEst: false },
})
const legOf = (r) => (r?.hours ? r.hours - (r.joinH ?? 0) : null)
/**
 * The live chooser's pick for n sleeves in node `node`, from the selection runs in `bb`:
 * the configuration with the shortest median leg over BB_SEL_SEEDS (ties: sleeveConfigs
 * order). null while any selection run is missing. Returns {config, median, byConfig}.
 */
export function pickFleet(bb, bp, node, n) {
  const rows = []
  for (const c of fleetConfigs(bp, n)) {
    const ls = []
    for (const s of BB_SEL_SEEDS) {
      const r = bb[bbKeyOf(bbSpec(node, ...BB_SEL_CELL, s, bp.POLICY, c))]
      if (r === undefined) return null
      ls.push(legOf(r) ?? Infinity)
    }
    rows.push({ config: c, median: median(ls) })
  }
  const best = rows.reduce((a, b) => (b.median < a.median ? b : a))
  return { config: best.config, median: best.median, byConfig: rows.map((x) => ({ k: cfgKey(x.config), median: x.median })) }
}
export const bbKeyOf = (spec) => sha(BB_CODE, JSON.stringify(spec)) // == nextnode.mjs keyOf
export const bbNodes = () => NODES.filter((n) => nodeMults(n).BladeburnerRank > 0)

/**
 * Build (incrementally) everything the plan from `start` needs. Returns stats:
 * { hack: {needed, computed, ms}, bb: {needed, computed, ms, seededFromNextnode} }.
 */
export async function buildSurrogate({ start, profile, bbSeeds = 5, jobs = 1, log = () => {} }) {
  const stats = { hack: { needed: 0, computed: 0, ms: 0 }, bb: { needed: 0, computed: 0, ms: 0, seeded: 0 } }
  // --- hacking curves
  const hf = path.join(CACHE_DIR, 'hack.json')
  const cf = path.join(CACHE_DIR, 'climb.json')
  const hack = readJson(hf)
  const climb = readJson(cf)
  const curves = hackCurvesFor(start)
  const t0 = performance.now()
  for (const c of curves)
    for (const lg of LN_G) {
      stats.hack.needed++
      const key = hackKeyOf(c, Math.exp(lg), profile)
      if (key in hack && key in climb) continue
      const r = hackExitHours({ node: c.node, level: c.level, sf: sfKeyPairs(c.sf), profile, g: Math.exp(lg) })
      hack[key] = r.hours ?? null
      climb[key] = climbOf(r)
      stats.hack.computed++
    }
  stats.hack.ms = performance.now() - t0
  if (stats.hack.computed) {
    writeJson(hf, hack)
    writeJson(cf, climb)
  }
  log(`[surrogate] hack: ${curves.length} curves x ${LN_G.length} = ${stats.hack.needed} points, ${stats.hack.computed} computed in ${(stats.hack.ms / 1000).toFixed(1)}s`)

  // --- Bladeburner legs
  const bf = path.join(CACHE_DIR, 'bb.json')
  const bb = readJson(bf)
  const bp = await import('bbplan.js')
  const specs = []
  for (const n of bbNodes()) for (const l6 of L6) for (const l7 of L7) for (let s = 1; s <= bbSeeds; s++) specs.push(bbSpec(n, l6, l7, s, bp.POLICY))
  stats.bb.needed = specs.length
  let todo = specs.map((spec) => ({ key: bbKeyOf(spec), spec })).filter((j) => !(j.key in bb))
  // seed from nextnode's cache (same key scheme): no sim is ever run twice
  const ncCache = path.join(NC, '.cache-next.json')
  if (todo.length && fs.existsSync(ncCache)) {
    const nc = readJson(ncCache)
    for (const j of todo)
      if (j.key in nc) {
        bb[j.key] = nc[j.key]
        stats.bb.seeded++
      }
    todo = todo.filter((j) => !(j.key in bb))
    if (stats.bb.seeded) writeJson(bf, bb)
  }
  if (todo.length) {
    log(`[surrogate] bb: ${todo.length} Bladeburner sims on ${jobs} process(es) (nice 15, 2GB heap each)...`)
    const t1 = performance.now()
    await runBbJobs(todo, jobs, (r) => {
      bb[r.key] = r
      stats.bb.computed++
      if (stats.bb.computed % 20 === 0) {
        writeJson(bf, bb)
        log(`[surrogate] bb ${stats.bb.computed}/${todo.length} (${((performance.now() - t1) / 1000 / stats.bb.computed).toFixed(2)}s/sim)`)
      }
    })
    stats.bb.ms = performance.now() - t1
    writeJson(bf, bb)
  }
  log(`[surrogate] bb: ${stats.bb.needed} sims needed, ${stats.bb.seeded} taken from nextnode's cache, ${stats.bb.computed} computed in ${(stats.bb.ms / 1000).toFixed(1)}s`)

  // --- the fleet-size axis: (1) the live chooser's pick per (node, n) on the selection seeds,
  // (2) the pick on every (SF6, SF7) cell x the evaluation seeds
  stats.fleet = { needed: 0, computed: 0, ms: 0 }
  const runTodo = async (list, what) => {
    const todo = list.filter((j) => !(j.key in bb))
    if (!todo.length) return
    log(`[surrogate] fleet ${what}: ${todo.length} Bladeburner sims on ${jobs} process(es)...`)
    const t1 = performance.now()
    let done = 0
    await runBbJobs(todo, jobs, (r) => {
      bb[r.key] = r
      stats.fleet.computed++
      if (++done % 200 === 0) {
        writeJson(bf, bb)
        log(`[surrogate] fleet ${what} ${done}/${todo.length} (${((performance.now() - t1) / 1000 / done).toFixed(2)}s/sim)`)
      }
    })
    stats.fleet.ms += performance.now() - t1
    writeJson(bf, bb)
  }
  const sel = []
  for (const n of bbNodes()) for (const k of BB_FLEET_N) for (const c of fleetConfigs(bp, k)) for (const s of BB_SEL_SEEDS) sel.push(bbSpec(n, ...BB_SEL_CELL, s, bp.POLICY, c))
  stats.fleet.needed += sel.length
  await runTodo(sel.map((spec) => ({ key: bbKeyOf(spec), spec })), 'selection')
  const ev = []
  for (const n of bbNodes())
    for (const k of BB_FLEET_N) {
      const pick = pickFleet(bb, bp, n, k)
      if (!pick) throw new Error(`surrogate: the fleet selection for BN${n} x ${k} sleeves is incomplete after its build`)
      for (const l6 of L6) for (const l7 of L7) for (let s = 1; s <= bbSeeds; s++) ev.push(bbSpec(n, l6, l7, s, bp.POLICY, pick.config))
    }
  stats.fleet.needed += ev.length
  await runTodo(ev.map((spec) => ({ key: bbKeyOf(spec), spec })), 'evaluation')
  log(`[surrogate] fleet: ${stats.fleet.needed} sims needed (${sel.length} selection, ${ev.length} evaluation), ${stats.fleet.computed} computed in ${(stats.fleet.ms / 1000).toFixed(1)}s`)
  return stats
}

function runBbJobs(todo, jobs, onResult) {
  jobs = Math.max(1, Math.min(2, jobs)) // the machine is shared with the live game: never more than 2
  const chunks = Array.from({ length: jobs }, () => [])
  todo.forEach((j, i) => chunks[i % jobs].push(j))
  return Promise.all(chunks.filter((c) => c.length).map((chunk, i) => new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `gameplan-bb-${process.pid}-${i}.json`)
    fs.writeFileSync(file, JSON.stringify(chunk))
    const p = spawn('nice', ['-n', '15', process.execPath, '--max-old-space-size=2048', path.join(NC, 'bbjobs.mjs'), file], { stdio: ['ignore', 'pipe', 'inherit'] })
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      let k
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k)
        buf = buf.slice(k + 1)
        if (line.trim()) onResult(JSON.parse(line))
      }
    })
    p.on('exit', (code) => {
      fs.rmSync(file, { force: true })
      code === 0 ? resolve() : reject(new Error(`bbjobs exited ${code}`))
    })
  })))
}

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Load the surrogate for the plan from `start` (buildSurrogate first). Pure
 * lookups afterwards: { hackHours(node, level, sfKey, g), bbLeg(node, l6, l7), bbRank(node), direct }.
 * `direct: true` answers hackHours by calling the simulation (memoised) instead
 * of interpolating — the reference the interpolation is tested against.
 */
export async function loadSurrogate({ start, profile, bbSeeds = 5, direct = false }) {
  const hack = readJson(path.join(CACHE_DIR, 'hack.json'))
  const bb = readJson(path.join(CACHE_DIR, 'bb.json'))
  const bp = await import('bbplan.js')
  const curves = new Map()
  const missing = []
  for (const c of hackCurvesFor(start)) {
    const ys = LN_G.map((lg) => {
      const h = hack[hackKeyOf(c, Math.exp(lg), profile)]
      if (h === undefined) missing.push(c)
      return h === null || h === undefined ? Infinity : Math.log(h)
    })
    curves.set(`${c.node}|${c.level}|${c.sf}`, Float64Array.from(ys))
  }
  if (missing.length) throw new Error(`surrogate: ${missing.length} hack grid points not built (run plan.mjs --build) e.g. ${JSON.stringify(missing[0])}`)
  // THE POST-RED-PILL CLIMB (the w0r1d_d43m0n window, go.mjs goWindow), PHASE-AVERAGED.
  // The leg is a sawtooth in g: the policy installs a whole number of times, so the
  // climb left after the last install jumps between ~0 and ~a cycle's worth as g
  // moves (BN1 g 0.05: 0.51h; BN11 g 0.03: 2.35h; BN14 g 0.03: 0.79h). Where in a
  // tooth a real run lands is not knowable at the precision g is known to, so each
  // point is the mean over one tooth: the install count moves by one when H moves
  // by one cycle, and H ~ 1/g, so one tooth spans cycleHours / H in ln g.
  const climbRaw = readJson(path.join(CACHE_DIR, 'climb.json'))
  const climbs = new Map()
  let climbMissing = 0
  const step0 = LN_G[1] - LN_G[0]
  const cyc = profile?.cycleHours ?? 2
  for (const c of hackCurvesFor(start)) {
    const id = `${c.node}|${c.level}|${c.sf}`
    const ys = curves.get(id)
    const raw = LN_G.map((lg) => {
      const k = hackKeyOf(c, Math.exp(lg), profile)
      if (!(k in climbRaw)) climbMissing++
      return climbRaw[k] ?? null
    })
    const L = new Float64Array(LN_G.length)
    const U = new Float64Array(LN_G.length)
    for (let i = 0; i < LN_G.length; i++) {
      const H = Math.exp(ys[i])
      const half = isFinite(H) && H > 0 ? Math.max(1, Math.min(120, Math.round(cyc / (2 * H) / step0))) : 1
      let sl = 0
      let su = 0
      let m = 0
      for (let j = Math.max(0, i - half); j <= Math.min(LN_G.length - 1, i + half); j++) {
        const r = raw[j]
        if (!r) continue
        sl += r[0]
        su += r[1]
        m++
      }
      L[i] = m ? sl / m : NaN
      U[i] = m ? su / m : NaN
    }
    climbs.set(id, { L, U })
  }
  if (climbMissing) throw new Error(`surrogate: ${climbMissing} climb grid points not built (run plan.mjs --build-only: tools/sim/gameplan/.cache/climb.json)`)
  const legs = new Map()
  const joins = new Map()
  const rank = new Map()
  let bbMissing = 0
  for (const n of NODES) rank.set(n, nodeMults(n).BladeburnerRank)
  for (const n of bbNodes())
    for (const l6 of L6)
      for (const l7 of L7) {
        const rs = Array.from({ length: bbSeeds }, (_, i) => bb[bbKeyOf(bbSpec(n, l6, l7, i + 1, bp.POLICY))])
        bbMissing += rs.filter((r) => !r).length
        const ls = rs.map((r) => (r?.hours ? r.hours - (r.joinH ?? 0) : null)).filter((x) => x !== null).sort((a, b) => a - b)
        legs.set(`${n}|${l6}|${l7}`, ls.length > bbSeeds / 2 ? { median: median(ls), q1: ls[Math.floor(ls.length / 4)], q3: ls[Math.floor((3 * ls.length) / 4)], legs: ls } : null)
        // the gym to combat 100 before the join (bbsim joinH: the game's skill formula at the node's combat multipliers)
        const js = rs.map((r) => r?.joinH).filter((x) => typeof x === 'number' && isFinite(x))
        joins.set(`${n}|${l6}|${l7}`, js.length ? median(js) : null)
      }
  if (bbMissing) throw new Error(`surrogate: ${bbMissing} Bladeburner sims not built (run plan.mjs --build)`)
  // THE FLEET-SIZE AXIS: per (node, SF6, SF7), the ratio of the live pick's median leg at n
  // sleeves to its median at 5 (paired seeds), held <= the ratio at n-1 (an extra sleeve may
  // idle); the plan's leg at n = the 5-infiltrator leg x that ratio. n = 5 is the old grid.
  const fleets = new Map() // `${n}|${k}` -> pickFleet
  const ratios = new Map() // `${n}|${l6}|${l7}|${k}` -> {ratio, raw}
  let fleetMissing = 0
  for (const n of bbNodes()) {
    for (const k of BB_FLEET_N) {
      const p = pickFleet(bb, bp, n, k)
      if (!p) fleetMissing++
      fleets.set(`${n}|${k}`, p)
    }
    for (const l6 of L6)
      for (const l7 of L7) {
        const med = (k) => {
          const p = fleets.get(`${n}|${k}`)
          if (!p) return null
          const rs = Array.from({ length: bbSeeds }, (_, i) => bb[bbKeyOf(bbSpec(n, l6, l7, i + 1, bp.POLICY, p.config))])
          fleetMissing += rs.filter((r) => !r).length
          const ls = rs.map(legOf).filter((x) => x !== null)
          return ls.length > bbSeeds / 2 ? median(ls) : null
        }
        const m5 = med(BB_FLEET_N[0])
        let prev = 1
        for (const k of BB_FLEET_N) {
          const mk = k === BB_FLEET_N[0] ? m5 : med(k)
          const raw = m5 && mk ? mk / m5 : null
          // no finishing run at n sleeves (or at 5): the extra sleeve is priced as idle
          const ratio = raw === null ? prev : Math.min(prev, raw)
          ratios.set(`${n}|${l6}|${l7}|${k}`, { ratio, raw })
          prev = ratio
        }
      }
  }
  if (fleetMissing) throw new Error(`surrogate: ${fleetMissing} fleet-axis Bladeburner sims not built (run plan.mjs --build-only)`)
  const legAt = (n, l6, l7, k) => {
    const base = legs.get(`${n}|${l6}|${l7}`) ?? null
    if (!base || k === BB_SLEEVES) return base
    const kk = Math.min(BB_FLEET_N[BB_FLEET_N.length - 1], Math.max(BB_FLEET_N[0], k))
    const r = ratios.get(`${n}|${l6}|${l7}|${kk}`)
    if (!r) throw new Error(`surrogate: no fleet ratio for BN${n} SF6.${l6} SF7.${l7} at ${k} sleeves`)
    return { ...base, median: base.median * r.ratio, q1: base.q1 * r.ratio, q3: base.q3 * r.ratio, legs: base.legs.map((x) => x * r.ratio), sleeves: kk, ratio: r.ratio, raw: r.raw }
  }
  const dmemo = new Map()
  const multsMemo = new Map()
  // opts.speed1: HackingSpeedMultiplier priced at 1 (phase 1's model; GP3's regression mode — direct only)
  const hackDirect = (node, level, sf, g, opts) => {
    const k = `${node}|${level}|${sf}|${g}|${opts?.speed1 ? 1 : 0}`
    if (!dmemo.has(k)) dmemo.set(k, hackExitHours({ node, level, sf: sfKeyPairs(sf), profile, g, ...(opts?.speed1 ? { speedMult: 1 } : {}) }).hours ?? Infinity)
    return dmemo.get(k)
  }
  const lo = LN_G[0]
  const step = LN_G[1] - LN_G[0]
  const hackInterp = (node, level, sf, g, opts) => {
    // the grid is the current model; phase 1's BN14 (speed 1) exists only as direct sims
    if (opts?.speed1 && nodeMults(node).HackingSpeedMultiplier !== 1) return hackDirect(node, level, sf, g, opts)
    const ys = curves.get(`${node}|${level}|${sf}`)
    if (!ys) throw new Error(`surrogate: no hack curve for BN${node} level ${level} sf ${sf}`)
    const x = (Math.log(g) - lo) / step
    if (x <= 0) return Math.exp(ys[0])
    if (x >= ys.length - 1) return Math.exp(ys[ys.length - 1])
    const i = Math.floor(x)
    const f = x - i
    const a = ys[i]
    const b = ys[i + 1]
    if (!isFinite(a) || !isFinite(b)) return f < 0.5 ? Math.exp(a) : Math.exp(b)
    return Math.exp(a + f * (b - a))
  }
  /** The phase-averaged post-Red-Pill climb at g: { L0 hours, u0 = exitLevel / M } (linear in ln g), or null. */
  const hackClimb = (node, level, sf, g) => {
    const cl = climbs.get(`${node}|${level}|${sf}`)
    if (!cl) throw new Error(`surrogate: no climb curve for BN${node} level ${level} sf ${sf}`)
    const x = Math.max(0, Math.min(LN_G.length - 1, (Math.log(g) - lo) / step))
    const i = Math.min(LN_G.length - 2, Math.floor(x))
    const f = x - i
    const at = (A) => (isFinite(A[i]) && isFinite(A[i + 1]) ? A[i] + f * (A[i + 1] - A[i]) : isFinite(A[i]) ? A[i] : A[i + 1])
    const L0 = at(cl.L)
    const u0 = at(cl.U)
    return isFinite(L0) && isFinite(u0) ? { L0, u0 } : null
  }
  return {
    hackClimb,
    hackHours: direct ? hackDirect : hackInterp,
    hackDirect,
    // sleeves: the fleet size (sleeves.mjs sleeveCount); 5 (the default) is the old grid exactly
    bbLeg: (n, l6, l7, sleeves = BB_SLEEVES) => legAt(n, l6, l7, sleeves),
    /** The live chooser's pick for k sleeves in node n ({config, median, byConfig}) and the fleet ratio of a cell. */
    bbFleet: (n, k) => fleets.get(`${n}|${k}`) ?? null,
    bbFleetRatio: (n, l6, l7, k) => ratios.get(`${n}|${l6}|${l7}|${k}`) ?? null,
    bbRank: (n) => rank.get(n),
    bbJoin: (n, l6, l7) => joins.get(`${n}|${l6}|${l7}`) ?? null,
    mults: (n) => {
      if (!multsMemo.has(n)) multsMemo.set(n, nodeMults(n))
      return multsMemo.get(n)
    },
    meta: { curves: curves.size, gridPoints: curves.size * LN_G.length, bbCells: legs.size, bbSeeds, bbInt: BB_INT, direct },
  }
}
