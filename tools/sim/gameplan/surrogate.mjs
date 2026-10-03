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
//                  bbplan's policy) — CALIBRATED on the live BN6 run, k = 0.916
//                  (nodechoice/bbcal6.mjs); one node, so the per-node shape is not.
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
export const bbSpec = (n, l6, l7, seed, bbPolicy) => ({
  node: n, sf: [...BB_BASE, ...(l6 ? [[6, l6]] : []), ...(l7 ? [[7, l7]] : [])], g: 0, installEveryH: null, intelligence: BB_INT, hacking: 200, seed, maxH: 400,
  policy: { shared: true, sharedPolicy: bbPolicy, sleeves: { infiltrate: BB_SLEEVES }, gymTo: 100, useEst: false },
})
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
  const hack = readJson(hf)
  const curves = hackCurvesFor(start)
  const t0 = performance.now()
  for (const c of curves)
    for (const lg of LN_G) {
      stats.hack.needed++
      const key = hackKeyOf(c, Math.exp(lg), profile)
      if (key in hack) continue
      const r = hackExitHours({ node: c.node, level: c.level, sf: sfKeyPairs(c.sf), profile, g: Math.exp(lg) })
      hack[key] = r.hours ?? null
      stats.hack.computed++
    }
  stats.hack.ms = performance.now() - t0
  if (stats.hack.computed) writeJson(hf, hack)
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
  return {
    hackHours: direct ? hackDirect : hackInterp,
    hackDirect,
    bbLeg: (n, l6, l7) => legs.get(`${n}|${l6}|${l7}`) ?? null,
    bbRank: (n) => rank.get(n),
    bbJoin: (n, l6, l7) => joins.get(`${n}|${l6}|${l7}`) ?? null,
    mults: (n) => {
      if (!multsMemo.has(n)) multsMemo.set(n, nodeMults(n))
      return multsMemo.get(n)
    },
    meta: { curves: curves.size, gridPoints: curves.size * LN_G.length, bbCells: legs.size, bbSeeds, bbInt: BB_INT, direct },
  }
}
