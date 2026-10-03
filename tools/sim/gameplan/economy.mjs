// THE ECONOMY INPUTS, MEASURED: the latent growth g of every node this code has
// played, backed out of its measured hours through the hacking-exit simulation
// (nodechoice/hackexit.mjs backOutG), and the profile those sims run on.
//
// CALIBRATION: each played node's g IS a calibration — the one number that
// makes hackexit reproduce that node's measured hours exactly — so the hours of
// a played node are reproduced by construction, and nothing here predicts one.
// What is NOT calibrated is the transfer to an UNPLAYED node: the latent
// g x AMC^gamma (AugmentationMoneyCost normalisation) with its lo/mid/hi spread
// over the measured runs. That is a NOT CALIBRATED assumption; params.mjs
// draws it, and plan.mjs's value-of-information table says which node's draw
// moves the decision.
//
// Ported from nodechoice/nextnode.mjs §1 (919b8ca) with one change: the runs
// are PINNED by start time (MEASURED_RUNS) instead of "the last BN4 segment",
// which since 2026-10-02 14:41Z is the BN4.3 run in progress.

import { nodeSegments } from '../nodechoice/measure.mjs'
import { backOutG, defaultProfile, nodeMults } from '../nodechoice/hackexit.mjs'

/** The runs whose hours calibrate g (start time prefix -> label). Phase 2: add a run here when its node is finished on the hacking route. */
export const MEASURED_RUNS = [
  { name: 'BN2', bn: 2, start: '2026-09-19T16:32' },
  { name: 'BN4 (2nd)', bn: 4, start: '2026-09-20T15:23' },
  { name: 'BN10', bn: 10, start: '2026-09-22T02:06' },
  { name: 'BN8', bn: 8, start: '2026-09-25T12:52' },
  { name: 'BN1 (3rd)', bn: 1, start: '2026-09-27T20:50' },
  { name: 'BN9', bn: 9, start: '2026-09-28T18:38' },
]

const gm = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length)
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
export const AMC = (n) => nodeMults(n).AugmentationMoneyCost

/**
 * Reads telemetry; returns the measured economy and the live state.
 * { runs, profile, gamma, gScen{lo,mid,hi}, ownG Map, live{bitNode, hours, sfOnEntry, intelligence} }
 */
export async function measureEconomy() {
  const segs = await nodeSegments()
  const runs = MEASURED_RUNS.map((r) => {
    const s = segs.find((x) => x.bitNode === r.bn && x.startedAt?.startsWith(r.start))
    if (!s) throw new Error(`measured run ${r.name} (${r.start}) not in telemetry`)
    return { ...r, s }
  })
  const profile = defaultProfile({
    cycleHours: median(runs.map((c) => c.s.meanLifeH)),
    expRich: runs.find((r) => r.bn === 10).s.expRateEnd,
    expPoor: runs.find((r) => r.bn === 8).s.expRateEnd,
  })
  for (const c of runs) {
    c.T = c.s.hours
    c.g = backOutG({ node: c.bn, sf: c.s.sfOnEntry, profile }, c.T).g
  }
  const amc1 = runs.filter((c) => AMC(c.bn) === 1)
  const other = runs.filter((c) => AMC(c.bn) !== 1)
  const gamma = other.map((c) => Math.log(gm(amc1.map((x) => x.g)) / c.g) / Math.log(AMC(c.bn))).reduce((a, b) => a + b, 0) / other.length
  const norms = runs.map((c) => c.g * Math.pow(AMC(c.bn), gamma))
  const gScen = { lo: Math.min(...norms), mid: gm(norms), hi: Math.max(...norms) }
  // A played node keeps its own measured g; BN12 at level 1 is BN1 to within 2%
  // on every multiplier, so it borrows BN1's (nextnode.mjs).
  const ownG = new Map(runs.map((c) => [c.bn, c.g]))
  ownG.set(12, ownG.get(1) * Math.pow(1.02, -gamma))
  const last = segs[segs.length - 1]
  const live = { bitNode: last.bitNode, hours: last.hours, sfOnEntry: last.sfOnEntry, intelligence: last.intelligence, startedAt: last.startedAt, maxLevel: last.maxLevel, bbJoinH: last.bbJoinH, combat100H: last.combat100H }
  return { runs: runs.map(({ s, ...r }) => ({ ...r, sfOnEntry: s.sfOnEntry, meanLifeH: s.meanLifeH })), profile, gamma, gScen, ownG: [...ownG.entries()], amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, AMC(i + 1)])), live }
}
