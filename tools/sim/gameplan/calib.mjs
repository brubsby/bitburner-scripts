// ROUTE-LEVEL g: the g that makes the route a clear PLAYED (routes.mjs, the whole formula)
// reproduce its measured hours — the same definition k has on the Bladeburner route.
//
// WHY (2026-10-14, docs/postponed-after-reset.md item 1): every g reading was backed out of the
// bare hacking simulation (hackexit backOutG: Hsim(g) = hours), but the plan prices a clear with
// the whole route on top of Hsim:
//     hack    max(.5 Hx, Hx - early),  Hx = exitShift(Hsim, g, W_go) + favor - favorRef
//     stanek  the same at g x gMul, W x W_gift, favor x favorMul (the gift accepted at the start)
// so a played node came back far faster than it was measured:
//   - early (SF4.3, SF9.2/9.3's first-life savings) is subtracted again, though the measured clear
//     already held those SFs (BN13: 8.0h of a 49.3h clear);
//   - the w0r1d_d43m0n exit shift ln W/g is credited although the live exit does not anticipate it
//     (README "NOT PRICED, flagged"), so no measured clear realised it (BN13: 4.6h, BN8: 8.7h);
//   - BN13.1 ACCEPTED Stanek's Gift, so its Hsim g already holds the gift, and the stanek route
//     multiplied the gift in a second time (W 2.25 -> another 9.6h).
// BN13.1 measured 49.3h; the plan priced BN13.2 at 22.0h on the same Source-Files that matter.
//
// The route-level g of a clear is a calibration (it reproduces that clear exactly, in-sample);
// what the g model's leave-one-out predicts for it is the transfer CHECK, printed per clear by
// plan.mjs (calibrationTable) — predicted vs measured hours, the error on screen pass or fail.
//
// The historic entry states' Source-Files are not on the plan's surrogate grid (it covers states
// reachable from today's entry), so the clears are priced on direct simulations (directSurrogate:
// hackexit per call, the post-Red-Pill climb from the same run, NOT phase-averaged as the grid's).

import fs from 'node:fs'
import path from 'node:path'
import { hackExitHours } from '../nodechoice/hackexit.mjs'
import { climbOf } from './surrogate.mjs'
import { hackParts, stanekParts } from './routes.mjs'
import { makeState, lvl } from './state.mjs'
import { giftAvailable } from './stanek.mjs'

const sfKeyPairs = (s) => (s ? s.split(',').map((t) => t.split('.').map(Number)) : [])

/** S with hackHours / hackClimb answered by direct simulation (memoised): any Source-File key. */
export function directSurrogate(S, profile) {
  const memo = new Map()
  const run = (node, level, sf, g) => {
    const k = `${node}|${level}|${sf}|${g}`
    let v = memo.get(k)
    if (!v) {
      const r = hackExitHours({ node, level, sf: sfKeyPairs(sf), profile, g })
      const c = climbOf(r)
      v = { hours: r.hours ?? Infinity, climb: c ? { L0: c[0], u0: c[1] } : null }
      memo.set(k, v)
    }
    return v
  }
  return { ...S, hackHours: (n, l, sf, g) => run(n, l, sf, g).hours, hackClimb: (n, l, sf, g) => run(n, l, sf, g).climb, direct: true }
}

/** The route's hours for node at the state lv with the node's latent g fixed (no discrepancy term). */
export function routeHours({ node, lv, route, g, world, S }) {
  const w = { ...world, g: () => g, disc: () => 1, _ct: undefined, _stanek: undefined }
  const p = route === 'stanek' ? stanekParts({ node, lv, world: w, S }) : hackParts({ node, lv, world: w, S })
  return p && isFinite(p.h) ? p.h : Infinity
}

/** Bisection in ln g on routeHours = hours (hours fall as g rises). { g, why }. */
export function routeG({ node, lv, route, hours, world, S }) {
  let lo = Math.log(1e-3)
  let hi = Math.log(2)
  const at = (lg) => routeHours({ node, lv, route, g: Math.exp(lg), world, S })
  const hLo = at(lo)
  const hHi = at(hi)
  if (!(hours <= hLo) || !(hours >= hHi)) return { g: null, why: `measured ${hours.toFixed(1)}h outside the route's [${hHi.toFixed(1)}, ${hLo.toFixed(1)}]h` }
  for (let i = 0; i < 36; i++) {
    const m = (lo + hi) / 2
    if (at(m) > hours) lo = m
    else hi = m
  }
  return { g: Math.exp((lo + hi) / 2), why: null }
}

/** Times (ms) of history rows holding Stanek's Gift, per BitNode: a clear accepted it if any row inside it does. */
export function giftRows(telemetry) {
  const p = path.join(telemetry, 'history.jsonl')
  const out = []
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.includes("Stanek's Gift")) continue
    try {
      const r = JSON.parse(line)
      if ((r.augmentations ?? []).some((a) => /^Stanek's Gift/.test(a))) out.push({ bn: r.bitNode, t: Date.parse(r.at) })
    } catch {}
  }
  return out
}

/**
 * Every finished hacking-route clear the g model reads (economy MEASURED_RUNS + the posterior's
 * g readings), each with its entry state, measured hours, the route it played and its g both ways.
 *   econ: measureEconomy() (runs with sfOnEntry, T, g = the Hsim back-out)
 *   readings: the posterior's applied g<n> readings (observe.mjs: key g|BNn.l|endedAt)
 *   segs: nodechoice/measure.mjs nodeSegments(); world: a mid world (worldOf); S: the loaded surrogate
 * Returns [{ name, bn, clear, T, lv, route, gSim, gRoute, hSim (the route at gSim: the old error), why }].
 */
export function routeCalibrate({ econ, readings, segs, world, S, gifts }) {
  const Sd = directSurrogate(S, econ.profile)
  const items = []
  const giftIn = (bn, a, b) => gifts.some((x) => x.bn === bn && x.t >= Date.parse(a) && x.t <= Date.parse(b))
  for (const r of econ.runs) {
    // within 90 min, not by prefix: history.jsonl's older lines are thinned (c1366cf; see economy.mjs)
    const want = Date.parse(r.start.length <= 16 ? r.start + ':00Z' : r.start)
    const s = segs
      .filter((x) => x.bitNode === r.bn && Number.isFinite(Date.parse(x.startedAt ?? '')) && Math.abs(Date.parse(x.startedAt) - want) <= 90 * 60e3)
      .sort((a, b) => Math.abs(Date.parse(a.startedAt) - want) - Math.abs(Date.parse(b.startedAt) - want))[0]
    items.push({ name: r.name, bn: r.bn, T: r.T, sfOnEntry: r.sfOnEntry, gSim: r.g, from: 'run', seg: s })
  }
  for (const o of readings) {
    const bn = Number(o.param.slice(1))
    const s = segs.find((x) => x.bitNode === bn && x.endedAt === o.at)
    if (!s) {
      items.push({ name: o.clear ?? o.key, bn, T: null, gSim: o.value, from: 'reading', key: o.key, why: 'its segment is not in history.jsonl' })
      continue
    }
    items.push({ name: o.clear, bn, T: s.hours, sfOnEntry: s.sfOnEntry, gSim: o.value, from: 'reading', key: o.key, seg: s })
  }
  for (const it of items) {
    if (it.T === null) continue
    const st = makeState(it.sfOnEntry ?? [], world.intelligence ?? null)
    it.lv = (n) => lvl(st, n)
    it.clear ??= `BN${it.bn}.${it.lv(it.bn) + 1}`
    it.gift = !!it.seg && giftIn(it.bn, it.seg.startedAt, it.seg.endedAt)
    it.route = it.gift && giftAvailable(it.bn, it.lv) ? 'stanek' : 'hack'
    it.hSim = routeHours({ node: it.bn, lv: it.lv, route: it.route, g: it.gSim, world, S: Sd })
    const b = routeG({ node: it.bn, lv: it.lv, route: it.route, hours: it.T, world, S: Sd })
    it.gRoute = b.g
    it.why = b.why
  }
  return { items, Sd }
}
