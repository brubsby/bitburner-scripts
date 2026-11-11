// THE BN12 LOOP — "BN12 forever, and see how low we can get the exit time" (the user, 2026-11-11).
//
// Every capped Source-File is at 3; SF12 has no cap (BitNode.tsx:439), so from BN12.2 on the stack plays
// BitNode 12 again and again, each level ~2% harsher (BitNode.tsx:918-985: inc = 1.02^level, every level /
// growth / money / rep / exp multiplier x 1/inc, ServerMaxMoney x 1/inc^2, BladeburnerRank x 1/inc,
// BladeburnerSkillCost / AugmentationMoney/RepCost / WorldDaemonDifficulty / FavorToDonate x inc,
// DaedalusAugsRequirement floor(min(30 + inc, 40)) = 31 until inc >= 2 (level 36), Stanek's power and
// grid x inc, DarknetLabyrinthRewardsTheRedPill 0 (labyrinth.ts:404: no Red Pill from the labyrinth outside
// BN15, so the labyrinth route does not exist here), gangs sell no Red Pill outside BN2
// (FactionHelpers.tsx:180), the level played = SF12 + 1 (NetscriptFunctions.ts:882)).
//
// This module is the loop's bookkeeping, pure where it can be:
//   bn12NextOf    the next node once nothing else is owed: BN12 at the next level (plan.mjs writes it to
//                 next-node.txt; watchdog.nextNodeArgsOf hands it to endgame.js, whose replay guard never
//                 refuses 12)
//   THE BOARD     every BN12 clear measured from the run record (history.jsonl: entry, end, route,
//                 milestones; run.jsonl: the live plan's exit estimate AT ENTRY and 1h in, decided in
//                 THIS clear — a plan decided before the entry is the previous clear's and is never
//                 read as this one's prediction; events.jsonl: sleep gaps), the Go farm each clear ran
//                 (go-dash-history.json, captured every pass: it keeps only the node in progress), the
//                 leaderboard by level and the prediction's calibration (ln measured / predicted).
//                 Written to .telemetry/bn12-board.json by `node tools/bn12board.mjs` (tools/plan-on-node.sh,
//                 every 15 min) and read back by observe.mjs (autoClearLegsOf: each finished BN12
//                 Bladeburner clear states its own Go farm, so its k enters the posterior automatically)
//                 and by the per-level pricing (bladeAnchorOf).
//   PRICING       bladeAnchorOf: the measured clears / the simulated level ratio (bbsim at the clear's
//                 level vs the level priced) -> the anchor A; hours(L) = A x r(L). The simulation's
//                 absolute scale is off on this stack (BN5.2 priced 13.0h at entry, played 5.7h), so only
//                 its RATIO across levels is used, and the scale is the measured clears' (CALIBRATED once
//                 a BN12 clear finishes; before that, on the full-Source-File Bladeburner clears of nodes
//                 whose Bladeburner multipliers are 1 — BN5.2/5.3, BN2.2/2.3 — at level 0, where every
//                 BN12 multiplier is 1: ASSUMED transfer, labelled).
//
// CALIBRATION: the board is a reader of records, no model. bladeAnchorOf prints a leave-one-out check of
// every anchor clear (tools/bn12board.mjs).

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

export const BN12 = 12
/** The loop's first clear (BN12.2 entered 2026-11-11 21:49:50Z, after BN15.3). */
export const LOOP_SINCE = '2026-11-11T21:49'
/** Black operations to the Bladeburner exit (Operation Daedalus is the 21st: bbplan.BLACK_OPS). */
export const BLACK_OPS_TOTAL = 21
/** A segment with a hacking level at or past this cleared by hacking (no Bladeburner exit gets near: observe.HACK_LEVEL). */
export const HACK_ROUTE_LEVEL = 1000
/** The live plan read "1h in" for the second prediction: after the join, the rank ledger has data. */
export const PRED_LATE_H = 1
/** A finished segment shorter than this that reached no exit is a transit (observe.MIN_CLEAR_H). */
export const MIN_CLEAR_H = 2

/** BitNode 12's multipliers at level L (BitNode.tsx:918-985), the ones the routes read — a transcription the test checks against the game. */
export function bn12MultsOf(L) {
  const inc = Math.pow(1.02, L)
  const dec = 1 / inc
  return {
    inc,
    DaedalusAugsRequirement: Math.floor(Math.min(30 + inc, 40)),
    HackingLevelMultiplier: dec,
    StrengthLevelMultiplier: dec,
    ServerGrowthRate: dec,
    ServerMaxMoney: dec * dec,
    ScriptHackMoney: dec,
    ClassGymExpGain: dec,
    CrimeExpGain: dec,
    FactionWorkRepGain: dec,
    BladeburnerRank: dec,
    BladeburnerSkillCost: inc,
    AugmentationMoneyCost: inc,
    AugmentationRepCost: inc,
    WorldDaemonDifficulty: inc,
    StaneksGiftPowerMultiplier: inc,
    DarknetLabyrinthRewardsTheRedPill: 0,
  }
}

/**
 * THE NEXT NODE ONCE NOTHING ELSE IS OWED: BitNode 12 at the next level. node: the BitNode in progress;
 * sfPairs: the Source-Files held now ([[n, lvl]]: SF12 is the level BEFORE the clear in progress, which
 * itself raises it by one). from / fromSF are what watchdog.nextNodeArgsOf matches (the node in progress
 * and its own Source-File level), so a record written in one clear is never applied in the next.
 */
export function bn12NextOf({ node, sfPairs }) {
  const sf = new Map(sfPairs)
  const s12 = sf.get(BN12) ?? 0
  const level = s12 + 1 + (node === BN12 ? 1 : 0)
  return { next: BN12, level, label: `BN12.${level}`, from: node, fromSF: sf.get(node) ?? 0 }
}

const sfMap = (sourceFiles) => {
  const data = Array.isArray(sourceFiles) ? sourceFiles : sourceFiles?.data ?? null
  if (Array.isArray(data)) return new Map(data)
  return new Map(Object.entries(sourceFiles ?? {}).map(([k, v]) => [Number(k), v]))
}

/**
 * ONE PASS OVER history.jsonl: per node segment (a new segment when the node changes, its lastNodeReset
 * changes, or its own Source-File rises — a same-node replay, measure.mjs isNewClear) the facts the board
 * needs. rows: an iterable of parsed digests in file order.
 */
export function segmentsOfRows(rows) {
  const segs = []
  let cur = null
  for (const r of rows) {
    if (typeof r?.bitNode !== 'number') continue
    const sf = sfMap(r.sourceFiles)
    const own = sf.get(r.bitNode) ?? 0
    const nodeReset = Number.isFinite(r.lastNodeReset) ? r.lastNodeReset : null
    if (!cur || cur.bitNode !== r.bitNode || (nodeReset !== null && cur.lastNodeReset !== null && nodeReset !== cur.lastNodeReset) || own > cur.ownSF) {
      cur = { bitNode: r.bitNode, ownSF: own, sfOnEntry: [...sf.entries()].sort((a, b) => a[0] - b[0]), lastNodeReset: nodeReset, firstAt: r.at, lastAt: r.at, lastAugReset: r.lastAugReset ?? null, installs: 0, maxHacking: 0, joinAt: null, combat100At: null, blackOps: 0, boAt: {}, maxRank: 0 }
      segs.push(cur)
    }
    if (cur.lastNodeReset === null && nodeReset !== null) cur.lastNodeReset = nodeReset
    cur.lastAt = r.at
    if (r.lastAugReset != null && cur.lastAugReset != null && r.lastAugReset !== cur.lastAugReset) cur.installs++
    if (r.lastAugReset != null) cur.lastAugReset = r.lastAugReset
    const sk = r.skills ?? {}
    cur.maxHacking = Math.max(cur.maxHacking, sk.hacking ?? 0)
    if (cur.combat100At === null && Math.min(sk.strength ?? 0, sk.defense ?? 0, sk.dexterity ?? 0, sk.agility ?? 0) >= 100) cur.combat100At = r.at
    const bb = r.bladeburner
    if (bb && cur.joinAt === null) cur.joinAt = r.at
    if (bb && Number.isFinite(bb.blackOpsDone) && bb.blackOpsDone > cur.blackOps) {
      for (let k = cur.blackOps + 1; k <= bb.blackOpsDone; k++) cur.boAt[k] = r.at
      cur.blackOps = bb.blackOpsDone
    }
    if (bb && Number.isFinite(bb.rank)) cur.maxRank = Math.max(cur.maxRank, bb.rank)
  }
  return segs
}

const ms = (iso) => Date.parse(iso ?? '')
const hoursBetween = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 3.6e6 : null)
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null)

/**
 * The live plan's exit estimate for a clear, from run.jsonl rows (time order): the first row whose plan is
 * THIS clear's — plan.node === the node and decided at or after the entry (run.jsonl's `thisNode` only
 * compares the node, and a same-node replay inherits the previous clear's plan.txt until the planner's
 * first pass: BN5.3's "0.035h" node-plan, 2026-10-24) — and the first at least `lateH` in.
 * Each: { at, afterH, meanH, q50, q10, q90, source, totalH = afterH + meanH }.
 */
export function predictionsOf(runRows, { node, enteredMs, endMs = Infinity, lateH = PRED_LATE_H }) {
  let entry = null
  let late = null
  for (const r of runRows) {
    const t = ms(r?.at)
    if (!(t >= enteredMs) || !(t < endMs)) continue
    const p = r.plan
    if (!p || p.node !== node || !(ms(p.decidedAt) >= enteredMs) || !Number.isFinite(p.exit?.meanH)) continue
    const afterH = (t - enteredMs) / 3.6e6
    const rec = { at: r.at, afterH: r3(afterH), meanH: r3(p.exit.meanH), q50: r3(p.exit.q50), q10: r3(p.exit.q10), q90: r3(p.exit.q90), source: p.exit.source ?? null, totalH: r3(afterH + p.exit.meanH), route: r.route?.route ?? null }
    if (!entry) entry = rec
    if (!late && afterH >= lateH) late = rec
    if (entry && late) break
  }
  return { entry, late }
}

/** Sleep gaps (events.jsonl kind 'sleep-gap': the machine suspended, the game not running) inside [a, b), hours. */
export function gapHoursOf(events, a, b) {
  let h = 0
  for (const e of events) {
    if (e?.kind !== 'sleep-gap') continue
    const t1 = ms(e.at)
    const t0 = t1 - (e.sec ?? 0) * 1000
    const lo = Math.max(a, t0)
    const hi = Math.min(b, t1)
    if (hi > lo) h += (hi - lo) / 3.6e6
  }
  return h
}

/** The Go farm a clear ran, from go-dash-history.json (the node in progress only): the newest sample's node power per opponent. */
export function goCaptureOf(goHist, enteredMs) {
  const s = (goHist?.samples ?? []).filter((x) => Number.isFinite(x?.t) && x.t >= enteredMs).at(-1)
  if (!s?.np) return null
  return { t: s.t, at: new Date(s.t).toISOString(), hoursIn: r3((s.t - enteredMs) / 3.6e6), np: { ...s.np } }
}

/**
 * THE BOARD: every BN12 clear (finished or in progress) from the segments, the run rows, the events and
 * the previous board (its Go captures survive: go-dash-history.json forgets a node when the next starts).
 */
export function boardOf({ segs, runRows = [], events = [], prev = null, goHist = null, now = Date.now(), since = null }) {
  const prevBy = new Map((prev?.clears ?? []).map((c) => [c.key, c]))
  const clears = []
  segs.forEach((s, i) => {
    if (s.bitNode !== BN12) return
    const enteredMs = Number.isFinite(s.lastNodeReset) ? s.lastNodeReset : ms(s.firstAt)
    if (since && enteredMs < ms(since)) return
    const next = segs[i + 1] ?? null
    const done = !!next
    const endMs = done ? (Number.isFinite(next.lastNodeReset) ? next.lastNodeReset : ms(next.firstAt)) : null
    const key = `12@${Number.isFinite(s.lastNodeReset) ? s.lastNodeReset : s.firstAt}`
    const level = (s.ownSF ?? 0) + 1
    const wallH = hoursBetween(enteredMs, done ? endMs : now)
    // A TRANSIT, not a clear: the BitVerse after a destroy, before the next node is chosen, reads as the
    // destroyed node with its Source-File already raised (BN12 on 2026-10-09 22:27Z -> BN7.1 at 23:13Z,
    // 0.76h). Finished, shorter than MIN_CLEAR_H, and no exit reached: not a clear.
    if (done && wallH < MIN_CLEAR_H && s.blackOps < BLACK_OPS_TOTAL) return
    const gapH = gapHoursOf(events, enteredMs, done ? endMs : now)
    const route = s.blackOps >= BLACK_OPS_TOTAL ? 'blade' : s.maxHacking >= HACK_ROUTE_LEVEL ? 'hack' : s.joinAt ? 'blade' : null
    const { entry, late } = predictionsOf(runRows, { node: BN12, enteredMs, endMs: done ? endMs : Infinity })
    const old = prevBy.get(key)
    const capNow = done ? null : goCaptureOf(goHist, enteredMs)
    const go = capNow && (!old?.go || capNow.t >= old.go.t) ? capNow : old?.go ?? null
    const at = (iso) => r3(hoursBetween(enteredMs, ms(iso)))
    const activeH = wallH === null ? null : wallH - gapH
    clears.push({
      key,
      label: `BN12.${level}`,
      level,
      enteredAt: new Date(enteredMs).toISOString(),
      endedAt: done ? new Date(endMs).toISOString() : null,
      done,
      wallH: r3(wallH),
      gapH: r3(gapH),
      activeH: r3(activeH),
      route,
      installs: s.installs,
      maxHacking: s.maxHacking,
      blackOps: s.blackOps,
      milestones: { joinH: at(s.joinAt), combat100H: at(s.combat100At), bo1H: at(s.boAt[1]), bo10H: at(s.boAt[10]), bo20H: at(s.boAt[20]), bo21H: at(s.boAt[21]) },
      sfOnEntry: s.sfOnEntry,
      predicted: { entry, late },
      // ln(measured / predicted): the live plan's mean at entry (and 1h in) against the active hours
      resid: done && entry?.totalH > 0 && activeH > 0 ? { entry: r3(Math.log(activeH / entry.totalH)), late: late?.totalH > 0 ? r3(Math.log(activeH / late.totalH)) : null } : null,
      go,
    })
  })
  const finished = clears.filter((c) => c.done)
  const byLevel = {}
  for (const c of finished) if (!byLevel[c.level] || c.activeH < byLevel[c.level].activeH) byLevel[c.level] = { label: c.label, activeH: c.activeH, route: c.route }
  const rs = finished.map((c) => c.resid?.entry).filter(Number.isFinite)
  const mean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null
  const rms = rs.length ? Math.sqrt(rs.reduce((a, b) => a + b * b, 0) / rs.length) : null
  return {
    at: new Date(now).toISOString(),
    by: 'tools/sim/gameplan/bn12.mjs (tools/bn12board.mjs)',
    clears,
    best: byLevel,
    inProgress: clears.find((c) => !c.done) ?? null,
    calibration: {
      n: rs.length,
      biasLn: r3(mean),
      rmsLn: r3(rms),
      why: rs.length ? `the live plan's exit at entry vs the measured active hours over ${rs.length} finished clear(s): mean ln(measured / predicted) ${mean.toFixed(3)}, RMS ${rms.toFixed(3)}` : 'no finished BN12 clear with an entry prediction yet: the live exit at entry is NOT CALIBRATED on BN12',
    },
  }
}

/**
 * THE AUTOMATIC CLEAR_LEGS (observe.mjs): each finished BN12 Bladeburner clear with a captured Go farm
 * states that farm — Tetrads' node power at the last capture over the hours to it, from t 0 (the
 * convention BN14.1-14.3's hand entries use) — so its k is read instead of WITHHELD. The capture is up
 * to 15 min before the clear's end (the timer), so the farm's rate is the clear's, a little early.
 * goPower: BN12's GoPower is 1 (BitNode.tsx:918-985 sets none); sf14: the doubling held at entry.
 */
export function autoClearLegsOf(board, power) {
  const out = {}
  for (const c of board?.clears ?? []) {
    if (!c.done || c.route !== 'blade') continue
    const sf14 = new Map(c.sfOnEntry ?? []).get(14) ?? 0
    const tet = c.go?.np?.Tetrads
    const h = c.go?.hoursIn
    const go = Number.isFinite(tet) && h > 0.25 ? { perHour: Math.round(tet / h), power, goPower: 1, sf14: sf14 >= 1 ? 1 : 0 } : null
    out[c.label] = { go, auto: true, why: go ? `auto (bn12-board): Tetrads ${tet} node power at ${h}h of the clear's ${c.activeH}h, from t 0` : 'auto (bn12-board): no Go capture for this clear — priced with no farm (go-dash-history.json had none)' }
  }
  return out
}

/**
 * THE BLADE ANCHOR: A = measured hours / r(level), r the simulated hours (bbsim median, the stack's state,
 * the clear's level) — one per anchor clear; the price at level L is exp(mean ln A) x r(L). anchors:
 * [{ label, level, hours }] (level 0 = a node whose Bladeburner multipliers are all 1); rOf(level) ->
 * simulated hours. Returns { A, sdLn, n, loo: [{label, measured, predicted, residLn}], priceOf(L) }.
 * The leave-one-out is each anchor priced from the others (n >= 2).
 */
export function bladeAnchorOf(anchors, rOf) {
  const xs = anchors.map((a) => ({ ...a, lnA: Math.log(a.hours / rOf(a.level)) })).filter((a) => Number.isFinite(a.lnA))
  if (!xs.length) return null
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
  const mu = mean(xs.map((a) => a.lnA))
  const sdLn = xs.length > 1 ? Math.sqrt(xs.reduce((s, a) => s + (a.lnA - mu) ** 2, 0) / (xs.length - 1)) : null
  const loo = xs.length > 1 ? xs.map((a, i) => {
    const m = mean(xs.filter((_, j) => j !== i).map((b) => b.lnA))
    const p = Math.exp(m) * rOf(a.level)
    return { label: a.label, measured: r3(a.hours), predicted: r3(p), residLn: r3(Math.log(a.hours / p)) }
  }) : []
  return { A: Math.exp(mu), sdLn, n: xs.length, loo, priceOf: (L) => Math.exp(mu) * rOf(L) }
}

/* ------------------------------------------------------------------ I/O (the CLI's) */

export async function readHistoryRows(file) {
  const rows = []
  if (!fs.existsSync(file)) return rows
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    // the board needs only the digest's head: skip the parse of rows from other nodes cheaply? every row
    // carries the fields segmentsOfRows reads, so parse them all (56MB: ~3s)
    try {
      const r = JSON.parse(line)
      rows.push({ at: r.at, bitNode: r.bitNode, sourceFiles: r.sourceFiles, lastNodeReset: r.lastNodeReset, lastAugReset: r.lastAugReset, skills: r.skills, bladeburner: r.bladeburner ? { rank: r.bladeburner.rank, blackOpsDone: r.bladeburner.blackOpsDone } : null })
    } catch {
      /* a torn line */
    }
  }
  return rows
}

export function readJsonlFile(file, filter = null) {
  try {
    const out = []
    for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!l || (filter && !filter(l))) continue
      try {
        out.push(JSON.parse(l))
      } catch {
        /* torn */
      }
    }
    return out
  } catch {
    return []
  }
}

export const readJsonOr = (file, d = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return d
  }
}

/** Build the board from a telemetry directory (and the previous board file there). */
export async function boardFromTelemetry(dir, { now = Date.now(), since = null } = {}) {
  const rows = await readHistoryRows(path.join(dir, 'history.jsonl'))
  const segs = segmentsOfRows(rows)
  // run.jsonl rows of BN12 plans only (the file is ~20MB; the predictions read plan.node 12)
  const runRows = readJsonlFile(path.join(dir, 'run.jsonl'), (l) => l.includes('"node":12'))
  const events = readJsonlFile(path.join(dir, 'events.jsonl'))
  const prev = readJsonOr(path.join(dir, 'bn12-board.json'))
  const goHist = readJsonOr(path.join(dir, 'go-dash-history.json'))
  return boardOf({ segs, runRows, events, prev, goHist, now, since })
}
