#!/usr/bin/env node
// augplan.js allocation and equivalence bench.
//
//   node tools/sim/augplan-alloc.mjs [reference-augplan.js]
//
// Plans a late-game catalogue (every offer rep-unlocked, money from a few
// billion to past the whole catalogue, prices perturbed so near-ties occur)
// and reports the time and the bytes ALLOCATED per planPurchases call,
// garbage included. With a reference copy of augplan.js (the version before a
// change) it plans every case with both and fails on any difference in the
// result, so an allocation change is shown to be a pure refactor.
//
// Why it exists: in a headless replica of the live BN6 save (2026-10-02,
// sampling heap profiler with collected objects included) augplan.js's DP was
// 613MB/min of a 1.1GB/min page — the churn behind 1.7-2.7GB page heaps
// between major GCs.

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import inspector from 'node:inspector/promises'
import { REPO_ROOT } from '../test/gameresolve.mjs'

const A = await import(path.join(REPO_ROOT, 'augplan.js'))
const refPath = process.argv[2]
const R = refPath ? await import(path.resolve(refPath)) : null

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-catalogue-0541.json'), 'utf8'))
let base = null
const find = (o) => {
  if (base || !o || typeof o !== 'object') return
  for (const [k, v] of Object.entries(o)) {
    if (k === 'offers' && Array.isArray(v)) base = v
    else find(v)
  }
}
find(F)
if (!base) throw new Error('no offers in the catalogue fixture')

// Deterministic PRNG so a failure reproduces.
let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

const unlocked = base.map((o) => ({ ...o, factionRep: Math.max(o.factionRep ?? 0, (o.repReq ?? 0) * 10 + 1) }))
const cases = []
for (const money of [3e9, 2e10, 5.5e10, 2e11, 1e12, 1e13]) {
  cases.push({ offers: unlocked, money })
  cases.push({ offers: unlocked.map((o) => ({ ...o, baseCost: o.baseCost * (0.7 + 0.6 * rnd()) })), money })
}
cases.push({ offers: base, money: 5e10 })
cases.push({ offers: unlocked.map((o, i) => (i % 3 ? o : { ...o, factionRep: 0 })), money: 2e11 })
cases.push({ offers: unlocked, money: 2e11, frontierCap: 3 }) // the cap path and its message

const strip = (p) =>
  JSON.stringify({ buy: p.buy, totalCost: p.totalCost, logM: p.logM, M: p.M, skipped: p.skipped, exact: p.exact, approximation: p.approximation, restricted: p.restricted })

const session = new inspector.Session()
session.connect()
await session.post('HeapProfiler.enable')

// Bytes allocated by one call, garbage included: the sampling heap profiler
// keeps samples of objects collected by minor and major GCs when asked to,
// which is exactly the churn that matters (heapUsed deltas cannot see it).
async function measure(mod, c) {
  await session.post('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const t0 = performance.now()
  const p = mod.planPurchases(c)
  const ms = performance.now() - t0
  const { profile } = await session.post('HeapProfiler.stopSampling')
  let bytes = 0
  const walk = (n) => {
    bytes += n.selfSize ?? 0
    for (const ch of n.children ?? []) walk(ch)
  }
  walk(profile.head)
  return { p, ms, bytes }
}

const MB = (b) => `${(b / 1048576).toFixed(1)}MB`
let diffs = 0
const tot = { newB: 0, refB: 0, newMs: 0, refMs: 0 }
for (const [k, c] of cases.entries()) {
  const a = await measure(A, c)
  tot.newB += a.bytes
  tot.newMs += a.ms
  let line = `case ${String(k).padStart(2)} money ${c.money.toExponential(1)}  new ${a.ms.toFixed(1)}ms ${MB(a.bytes)}  buy ${a.p.buy.length} logM ${a.p.logM.toFixed(4)}`
  if (R) {
    const b = await measure(R, c)
    tot.refB += b.bytes
    tot.refMs += b.ms
    line += `  | ref ${b.ms.toFixed(1)}ms ${MB(b.bytes)}`
    if (strip(a.p) !== strip(b.p)) {
      diffs++
      line += '  DIFFERENT'
    }
  }
  console.log(line)
}
console.log(`total new ${MB(tot.newB)} ${tot.newMs.toFixed(0)}ms` + (R ? ` | ref ${MB(tot.refB)} ${tot.refMs.toFixed(0)}ms | results differing: ${diffs}` : ''))
process.exit(diffs ? 1 : 0)
