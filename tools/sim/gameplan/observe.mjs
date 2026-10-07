// OBSERVE: read what finished (and in-progress) nodes measured out of
// telemetry, append it to the posterior store's log (posterior.json, keyed, so
// re-observing is a no-op), recompute the posterior and print how it moved.
//
//   node tools/sim/gameplan/observe.mjs [--telemetry DIR] [--dry-run]
//   node tools/sim/gameplan/plan.mjs --observe ...      the same, then plans on the result
//
// WHAT IT READS (each reading is { param, value, sd, ... } — posterior.mjs)
//   history.jsonl, per node segment (nodechoice/measure.mjs), from OBS_SINCE on:
//     a finished HACKING-route clear  -> g<n>: the g that makes hackexit
//        reproduce its hours (economy.mjs's back-out, the same calibration),
//        log-normal sd OBS_SD.g; key g|BNn.l|completion time
//     a finished BLADEBURNER clear    -> k = (hours - voided - opening + early) /
//        the bbsim leg the planner prices it with (surrogate, the node's SF6/SF7,
//        the fleet, and THAT CLEAR's Go farm — CLEAR_LEGS): exactly the k that makes
//        routes.mjs's blade formula reproduce the clear; key k|BNn.l|completion
//        time (+ |rev n when CLEAR_LEGS revises the clear's conditions: that reading
//        REPLACES the one logged under the old conditions — a correction, not a
//        second reading). WITHHELD, printed with the reason, never logged: a leg
//        longer than the whole node (the model is missing a
//        condition the clear ran under — BN14.2's first reading, leg 86.78h for a
//        30.14h node with no Go farm priced), a clear entered after the farm's
//        combat channel existed (GO_COMBAT_SINCE) whose CLEAR_LEGS does not state
//        its farm, and a CLEAR_LEGS void the history does not show.
//        Voided: CLEAR_LEGS voidInstalls (a bad install's retrain) and voidStalls
//        (nodechoice/measure.mjs stalls: idle / offroute stretches the model does
//        not carry). A k reading is NOT re-derived once logged: it is live / the leg of
//        the policy that clear PLAYED (bbsim plays bbplan's code of the day), so a
//        new policy prices the future and leaves the past readings alone; observe
//        prints what today's leg would read beside the logged value (the policy's
//        own move, not an error).
//     a Bladeburner-route node's opening (finished or in progress, once every
//        combat stat reached 100 in the first life) -> open = hours to combat
//        100 minus the gym hours the node's combat multipliers add over BN6
//        (the planner's own scaling, inverted); key open|BNn.l|start time
//   the in-run channel (posterior.OBS_FILES in the telemetry dir): JSON lines
//     written by game scripts (gameplan-obs.js -> /tel/gameplan-obs.txt, mirrored
//     by tools/rfa-daemon.mjs) or by tools outside the game (gameplan-obs.jsonl).
//
// A node's route is read from the node itself: hacking level >= HACK_LEVEL at
// any point = it exited by hacking (no Bladeburner exit gets near it: BN6 ended
// at 294); else Bladeburner if it joined the Bladeburner faction; else nothing.
// Segments shorter than MIN_CLEAR_H are transits, not clears.
//
// BASE_IN marks the evidence the hand prior was built from — logged, flagged
// inBase, never applied: economy.MEASURED_RUNS (g), BN6.1 and BN4.3 (k 1.223 and
// 0.900: params.BB_PARAMS.k IS their posterior since 2026-10-05) and BN6.1's open.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OBS_SD, OBS_FILES, POSTERIOR_FILE, loadStore, saveStore, mergeObs, posteriorOf, summarise, hierFit } from './posterior.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The first measured run's start: older segments ran scripts the profile does not describe (economy.mjs). */
export const OBS_SINCE = '2026-09-19T16:32'
export const MIN_CLEAR_H = 2
export const HACK_LEVEL = 1000
export const BN6_START = '2026-10-01T02:48'

/** Evidence already inside the hand prior. */
/**
 * THE CONDITIONS A LOGGED BLADEBURNER CLEAR RAN UNDER, by clear label: its Go farm on the
 * combat channel (bbsim o.go; null = none priced, so whatever it had stays inside its k) and
 * the installs VOIDED from its hours (a bad install's retrain, measured from history:
 * measure.mjs retrainH — the hours back to combat 100 after it).
 *   BN6.1  no farm priced: go.js priced no combat channel before de23605 (2026-10-03 02:14Z).
 *   BN4.3  ASSUMED 4000/h effective from the start: the Tetrads channel was priced from
 *          de23605, ~11.5h into the node, at the then rate (~7k/h): ~1.2e5 node power by the
 *          clear, spread over its 28h. GoPower 1, no SF14.
 *   BN14.1 ASSUMED 8000/h effective: live Tetrads regrowth read 4.9-6.2k/h early in the node
 *          (bbplan.bladeGoCombatOf, ~54k after 8.8h) and ~18.7-22k/h once release 3 shipped
 *          (go-games.txt, 2026-10-04 evening); the last life (15.6h -> 37.7h) banked ~3e5,
 *          i.e. 8000/h over the clear. GoPower 4, no SF14. Both installs (6.78h, 15.62h) were
 *          the model's error that 1c484da fixed (the farm's combat effect not regrown after an
 *          install read as a +46.8h exit): VOIDED — their retrain hours (0.95h, 0.68h) come off;
 *          the Go regrowth they also cost is not (it stays in k).
 *   BN14.2 (2026-10-05 08:32Z -> 2026-10-06 14:41Z, 30.14h, no install). STALLS VOIDED (measure.mjs
 *          stalls, matched by start hour) — neither is the Bladeburner route being slow, both are
 *          infrastructure the model does not carry:
 *          idle 5.04h -> 13.95h (8.90h): every combat stat sat at exactly 100 with zero combat exp
 *            (history.jsonl 13:35Z -> 22:29Z, currentWork null, no Bladeburners faction): bb-lite's
 *            actors found no host with 13.6GB (home 32GB held go.js; 73a4644 "Bladeburner idle ~9h, no
 *            rooted host has 13.6GB free"). The farm was not on Tetrads either: a Tetrads effect moves
 *            every combat level, and it first moved at 22:29Z (100 -> 130 with no exp).
 *          offroute 14.71h -> 15.38h (0.68h): the work slot on crime / faction work (history.jsonl
 *            23:15Z -> 23:50Z; act-history 23:36Z Homicide "crime: exit 207.24h vs 228.46h") because the
 *            planner priced the blade route at pFeasible 0 (4c6e6e7, fixed ~23:51Z); Bladeburners
 *            joined 23:55Z.
 *          GO FARM: Tetrads node power 345473 at the clear (go-dash-history.json 14:42Z; effectAt at
 *            GoPower 4 x the SF14.1 doubling gives x7.552 = the dash's +655.2% exactly), banked from
 *            ~13.9h at 22.3k/h (08:55Z -> 14:42Z). perHour = that total over the counted hours
 *            (30.14 - 9.58 = 20.56h) = 16800/h from the leg's t 0 — ASSUMED (bbsim cannot delay a
 *            farm). The opening had no farm (openGo null: its gym scale is read against none).
 *          rev 1: the first reading (k 0.282, logged 2026-10-06 14:44Z) priced no farm and voided
 *            nothing — leg 86.78h for a 30.14h node; this one replaces it.
 *   BN14.3 (2026-10-06 14:43Z -> 2026-10-07 13:12Z, 22.48h, no install, all 21 black ops).
 *          GO FARM: Tetrads node power 657442 at the clear (go-dash-history.json 13:12:34Z; effectAt at
 *            GoPower 4 x the SF14 doubling gives +834.75% = the dash's +834.746%), farmed from the
 *            entry (Tetrads 1350 at 14:48Z), ~33.9k/h over the last 6h (454230 at 07:12Z), with the
 *            cheats from ~22:06Z (kill-switch bug to 23:30Z, 0.5s cap 00:22Z, pass-forcing oracle
 *            00:28Z, joint cheats 03:42-05:36Z and 06:46-07:50Z): all of it inside the total.
 *            perHour = 657442 / 22.48h = 29200/h from t 0 — ASSUMED (the same total-over-the-clear
 *            convention as BN14.1/BN14.2); the opening ran under it (openGo = go).
 *          NOTHING VOIDED, on the evidence: measure.mjs finds no idle or offroute stall >= 0.25h after
 *            combat 100 (0.51h, 15:14Z), and no run of rows with zero combat exp reaches 0.3h. The
 *            entry stall (cash $1262 to ~14:48Z, -$13k at 15:18Z, 0e88c57) is before combat 100: it is
 *            the opening's, which k subtracts as measured. bb-lite's starvation ended when bb-host was
 *            bought between 15:20:16Z and 15:25:36Z (history.jsonl purchasedServers), <= 0.19h after
 *            combat 100, with combat exp moving through it (the hand-run Homicide): not voidable as a
 *            stall, < 1% of k. The SlumSnakes@9 detour (23:34-23:39Z) was Go only, not the work slot.
 */
export const CLEAR_LEGS = {
  'BN14.1': { go: { perHour: 8000, power: 0.7, goPower: 4, sf14: 0 }, voidInstalls: [6.78, 15.62], why: 'Tetrads 4.9-6.2k/h early, ~20k/h from release 3: 8000/h effective, ASSUMED; both installs voided (1c484da)' },
  'BN14.2': { rev: 1, go: { perHour: 16800, power: 0.7, goPower: 4, sf14: 1 }, openGo: null, voidStalls: [5.04, 14.71], why: 'Tetrads 345k at the clear over its 20.56h counted, ASSUMED from t 0; stalls voided: bb-lite starved 8.90h (73a4644), blade priced infeasible 0.68h (4c6e6e7)' },
  'BN14.3': { go: { perHour: 29200, power: 0.7, goPower: 4, sf14: 1 }, why: 'Tetrads 657k at the clear over its 22.48h, ASSUMED from t 0 (cheats inside the total); nothing voided: no stall after combat 100 (bb-host by 15:25Z)' },
}
/** The Go farm's combat channel was first priced at de23605 (2026-10-03 02:14Z): a clear entered after it states its farm in CLEAR_LEGS. */
export const GO_COMBAT_SINCE = '2026-10-03T02:14'
/** The farm a clear's opening (its gym to combat 100) ran under: CLEAR_LEGS openGo when stated, else its go. */
export const openGoOf = (cl) => (cl && 'openGo' in cl ? cl.openGo : cl?.go ?? null)
/** The legs every logged Bladeburner clear needs built (surrogate buildSurrogate extraBb): [{ node, l6, l7, go }]. */
export function clearLegSpecs(segs) {
  const out = []
  for (const s of segs) {
    if (!s.startedAt || s.startedAt < OBS_SINCE || !(s.bbJoinH >= 0) || s.maxLevel >= HACK_LEVEL) continue
    const sf = new Map(s.sfOnEntry ?? [])
    const lv = (n) => sf.get(n) ?? 0
    const clear = `BN${s.bitNode}.${lv(s.bitNode) + 1}`
    const l6 = Math.max(1, Math.min(3, lv(6)))
    const l7 = Math.min(3, lv(7))
    const go = CLEAR_LEGS[clear]?.go ?? null
    out.push({ node: s.bitNode, l6, l7, go })
    // the opening's gym scale (gymDiff) under the farm the opening ran with, when that differs
    const og = openGoOf(CLEAR_LEGS[clear])
    if (JSON.stringify(og) !== JSON.stringify(go)) out.push({ node: s.bitNode, l6, l7, go: og })
  }
  return out
}
/**
 * Hours a clear's voided installs (their retrain to combat 100) and voided stalls (measure.mjs stalls,
 * matched by start hour) cost, and the note. missing: a listed void the history does not show (the
 * reading is withheld: a void that matches nothing would silently void nothing).
 */
export function voidedOf(seg, clear, clearLegs = CLEAR_LEGS) {
  const cl = clearLegs[clear] ?? {}
  let h = 0
  const used = []
  const stalls = []
  const missing = []
  for (const at of cl.voidInstalls ?? []) {
    const r = (seg.retrainH ?? []).find((x) => Math.abs(x.at - at) < 0.05)
    if (r && r.h > 0) {
      h += r.h
      used.push(`${at.toFixed(2)}h: ${r.h.toFixed(2)}h`)
    } else missing.push(`install at ${at}h`)
  }
  for (const at of cl.voidStalls ?? []) {
    const r = (seg.stalls ?? []).find((x) => Math.abs(x.at - at) < 0.1)
    if (r && r.h > 0) {
      h += r.h
      stalls.push(`${r.kind} ${r.at.toFixed(2)}h: ${r.h.toFixed(2)}h`)
    } else missing.push(`stall at ${at}h`)
  }
  const note = [used.length ? `voided install(s) ${used.join(', ')}` : '', stalls.length ? `voided stall(s) ${stalls.join(', ')}` : ''].filter(Boolean).join('; ')
  return { h, note, missing }
}

/** BN4.3's start: its k (0.900) is inside params.BB_PARAMS.k since the 2026-10-05 refresh. */
export const BN4_3_START = '2026-10-02T14:41'
export function baseIn(measuredRuns) {
  return [...measuredRuns.map((r) => ({ param: 'g', bn: r.bn, start: r.start })), { param: 'k', bn: 6, start: BN6_START }, { param: 'k', bn: 4, start: BN4_3_START }, { param: 'open', bn: 6, start: BN6_START }]
}

/**
 * Readings from history segments. Pure: the models come in as functions.
 *   gOf(bn, sfOnEntry, hours)  -> backed-out g
 *   bbLeg(bn, lv, clear)       -> bbsim leg median (hours) or null, under that clear's CLEAR_LEGS
 *   gymDiff(bn, lv, clear)     -> gym hours to combat 100 in bn (its own Go farm) minus in BN6 (none)
 *   earlyOf(lv, bn)            -> the SFs' first-life saving (mid world)
 * lv(n) is the SF level on entry.
 */
export function readingsFromSegments(segs, { gOf, bbLeg, gymDiff, earlyOf, base = [], clearLegs = CLEAR_LEGS }) {
  const out = []
  // k readings refused: the reason, printed by runObserve; nothing logged
  out.withheld = []
  segs.forEach((s, i) => {
    if (!s.startedAt || s.startedAt < OBS_SINCE) return
    const completed = i < segs.length - 1
    if (completed && s.hours < MIN_CLEAR_H) return
    const sf = new Map(s.sfOnEntry ?? [])
    const lv = (n) => sf.get(n) ?? 0
    const clear = `BN${s.bitNode}.${lv(s.bitNode) + 1}`
    const inBase = (param) => base.some((b) => b.param === param && b.bn === s.bitNode && s.startedAt.startsWith(b.start))
    const route = s.maxLevel >= HACK_LEVEL ? 'hack' : s.bbJoinH !== null && s.bbJoinH !== undefined ? 'blade' : null
    const common = { node: s.bitNode, clear }
    let openAdj = null
    if (route === 'blade' && s.combat100H !== null && s.combat100H !== undefined) {
      const early = earlyOf(lv, s.bitNode)
      openAdj = s.combat100H + (s.combat100H > 0.5 ? early : 0)
      const gd = gymDiff(s.bitNode, lv, clear)
      const val = openAdj - gd
      // A reading that is mostly the gym model is not a measurement of the
      // opening: BN14.1 (combat level x0.5) read 3.09h less a simulated 2.70h
      // = 0.39h and pulled the shared opening 3.13h -> 1.28h (2026-10-04).
      // Skip when the subtracted model share exceeds half the measured time.
      if (val > 0 && !(gd > 0.5 * openAdj))
        out.push({ ...common, param: 'open', value: val, sd: OBS_SD.open, at: s.startedAt, source: 'history.jsonl: entry -> combat 100, first life, less the gym scale', key: `open|${clear}|start ${s.startedAt}`, inBase: inBase('open'), note: `combat 100 at ${s.combat100H.toFixed(2)}h${completed ? '' : ' (node in progress)'}` })
    }
    if (!completed) return
    if (route === 'hack') {
      const g = gOf(s.bitNode, s.sfOnEntry, s.hours)
      if (g > 0) out.push({ ...common, param: `g${s.bitNode}`, value: g, sd: OBS_SD.g, at: s.endedAt, source: 'history.jsonl: hacking-route clear, g backed out of its hours', key: `g|${clear}|${s.endedAt}`, inBase: inBase('g'), note: `${s.hours.toFixed(2)}h` })
    } else if (route === 'blade') {
      const cl = clearLegs[clear]
      if (!cl && s.startedAt >= GO_COMBAT_SINCE && !inBase('k')) {
        out.withheld.push(`${clear} k: entered ${s.startedAt.slice(0, 16)}Z, after the Go farm's combat channel (${GO_COMBAT_SINCE}Z), and CLEAR_LEGS does not state its farm — a leg priced with none reads the farm as k`)
        return
      }
      const leg = bbLeg(s.bitNode, lv, clear)
      if (leg > 0 && openAdj !== null) {
        const vo = voidedOf(s, clear, clearLegs)
        const counted = s.hours - vo.h
        const why = vo.missing.length
          ? `CLEAR_LEGS voids ${vo.missing.join(', ')}, which the history does not show`
          : // the whole node, not the counted hours: a model leg may run past (hours - voided) by up to the
            // opening's share (BN14.1: leg 36.89h, 36.02h counted, k 0.874); past the whole node it is no k
            leg > s.hours
            ? `the leg ${leg.toFixed(2)}h is longer than the whole ${s.hours.toFixed(2)}h node: the model misses a condition the clear ran under (a Go farm, a stall) — state it in CLEAR_LEGS`
            : null
        if (why) {
          out.withheld.push(`${clear} k: ${why}`)
          return
        }
        const k = (counted - openAdj) / leg
        out.push({ ...common, param: 'k', value: k, sd: OBS_SD.k, at: s.endedAt, source: 'history.jsonl: Bladeburner clear, (hours - voided - opening) / bbsim leg (its own Go farm)', key: `k|${clear}|${s.endedAt}${cl?.rev ? `|rev ${cl.rev}` : ''}`, inBase: inBase('k'), rederive: true, note: `${s.hours.toFixed(2)}h${vo.h ? ` - ${vo.h.toFixed(2)}h (${vo.note})` : ''}, opening ${openAdj.toFixed(2)}h, leg ${leg.toFixed(2)}h${cl?.go ? ` (Go farm ${cl.go.perHour}/h x${cl.go.goPower * (cl.go.sf14 ? 2 : 1)})` : ' (no Go farm priced)'}` })
      }
    }
  })
  return out
}

/**
 * THE NODE IN PROGRESS'S g, as far as it has gone: the growth of ln(hacking multiplier) per hour
 * over its finished lives (the quantity g is: hackexit's multGainPerCycle = exp(g x cycleHours)),
 * from the first install to the last, on the hacking route only (a Bladeburner-route life buys
 * combat, not ln M — bayes.cadencePosterior's regime rule). Needs IN_PROGRESS_G_LIVES finished
 * lives after the first (the first life's length is the node's opening, not its cadence). The sd
 * is ASSUMED: OBS_SD.g plus 0.5/sqrt(lives) (a partial node: the cadence's spread over few lives).
 * seg: nodechoice/measure.mjs nodeSegments' last segment (with multFirst/multLast/installs) — its
 * rows' mults are read from history.jsonl's level and exp (skill.ts:13 inverted).
 * Returns { reading } or { why }.
 */
export const IN_PROGRESS_G_LIVES = 2
export function inProgressG(seg) {
  if (!seg) return { why: 'no node in progress' }
  const name = `g${seg.bitNode}`
  if (seg.bbJoinH !== null && seg.bbJoinH !== undefined && !(seg.maxLevel >= HACK_LEVEL)) return { why: `${name}: BN${seg.bitNode} joined the Bladeburners at ${seg.bbJoinH.toFixed(2)}h (the Bladeburner route): its lives do not read the hacking route's g` }
  if (!(seg.installs >= IN_PROGRESS_G_LIVES + 1) || !Array.isArray(seg.installsH) || !(seg.multAtInstalls?.length >= 2)) return { why: `${name}: ${seg.installs ?? 0} install(s) in ${seg.hours.toFixed(1)}h — needs ${IN_PROGRESS_G_LIVES} finished lives after the first to read g` }
  const a = seg.multAtInstalls[0]
  const b = seg.multAtInstalls[seg.multAtInstalls.length - 1]
  const dh = b.h - a.h
  const g = Math.log(b.mult / a.mult) / dh
  if (!(g > 0) || !(dh > 0)) return { why: `${name}: ln M did not grow between the first and last install (${a.mult.toFixed(3)} -> ${b.mult.toFixed(3)})` }
  const lives = seg.multAtInstalls.length - 1
  return { reading: { param: name, value: g, sd: +(OBS_SD.g + 0.5 / Math.sqrt(lives)).toFixed(4), space: 'log', node: seg.bitNode, at: seg.endedAt, stream: `${name}|in progress|${seg.startedAt}`, key: `${name}|in progress|${seg.startedAt}|${seg.endedAt}`, source: `history.jsonl: BN${seg.bitNode} in progress, ln M ${a.mult.toFixed(3)} -> ${b.mult.toFixed(3)} over ${dh.toFixed(2)}h (${lives} lives)` } }
}

/** The in-run channel: every JSON line of OBS_FILES in dir. */
export function readingsFromFiles(dir, files = OBS_FILES) {
  const out = []
  let bad = 0
  for (const f of files) {
    const p = path.join(dir, f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        out.push({ ...JSON.parse(line), from: f })
      } catch {
        bad++
      }
    }
  }
  return { readings: out, bad }
}

const fmt = (x) => (x === null || x === undefined ? '-' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3))
const tri = (a) => (a ? a.map(fmt).join(' / ') : '-')

/** The before/after table (the posterior summaries of summarise()). */
export function printMove(before, after, log = console.log) {
  log('  param        hand prior p10 / p50 / p90        before                           after                            readings')
  const ids = [...new Set([...Object.keys(after), ...Object.keys(before)])]
  for (const id of ids) {
    const a = after[id]
    const b = before[id]
    if (!a) continue
    const moved = JSON.stringify(a.post) !== JSON.stringify(b?.post)
    log(`  ${id.padEnd(12)} ${tri(a.prior).padEnd(33)} ${tri(b?.post).padEnd(32)} ${tri(a.post).padEnd(32)} ${a.n ?? '-'}${moved ? '  MOVED' : ''}`)
  }
}

/**
 * Observe: telemetry -> log -> posterior. econ = measureEconomy() with ownG a Map;
 * S = a loaded surrogate (bbLeg, bbJoin). Writes the store unless dryRun.
 */
export async function runObserve({ econ, S, telemetry, file = POSTERIOR_FILE, dryRun = false, log = console.log, gModel = 'auto' }) {
  const gOpt = { gModel, multsOf: S.mults }
  const { nodeSegments } = await import('../nodechoice/measure.mjs')
  const { backOutG } = await import('../nodechoice/hackexit.mjs')
  const { earlyOf, sfParamsMid, sleevesOf } = await import('./effects.mjs')
  const { MEASURED_RUNS } = await import('./economy.mjs')
  const segs = await nodeSegments(path.join(telemetry, 'history.jsonl'))
  const sfMid = sfParamsMid()
  const l67 = (lv) => [Math.max(1, Math.min(3, lv(6))), Math.min(3, lv(7))]
  const fromHistory = readingsFromSegments(segs, {
    gOf: (bn, sf, T) => backOutG({ node: bn, sf, profile: econ.profile }, T).g,
    // the fleet the clear ran with (sleeves.mjs; every Bladeburner clear so far: 5)
    bbLeg: (bn, lv, clear) => S.bbLegAt(bn, ...l67(lv), sleevesOf(lv, bn), CLEAR_LEGS[clear]?.go ?? null)?.median ?? null,
    // the clear's own gym scale: its node under its own Go farm against BN6 with none (the opening's
    // reference, BN6.1, had none) — not the grid's, whose farm at the SF14 doubling makes every gym short
    gymDiff: (bn, lv, clear) => (S.bbJoinAt(bn, ...l67(lv), openGoOf(CLEAR_LEGS[clear])) ?? 0) - (S.bbJoinAt(6, ...l67(lv), null) ?? 0),
    earlyOf: (lv, bn) => earlyOf(lv, bn, sfMid),
    base: baseIn(MEASURED_RUNS),
  })
  const files = readingsFromFiles(telemetry)
  // THE NODE IN PROGRESS (in-run readings from history.jsonl, rates.mjs / inProgressG): its exp and
  // income levels at the pooled slope of the finished runs (xr<n>, ir<n>: they price its own clear
  // and its later levels), and its g once it has two finished hacking-route lives
  const inRun = []
  const inRunWhy = []
  if (econ.rates?.liveRun) {
    const { inRunReadings } = await import('./rates.mjs')
    const { nodeMults } = await import('../nodechoice/hackexit.mjs')
    const { sfMultsOf } = await import('./economy.mjs')
    const lr = econ.rates.liveRun
    const rr = inRunReadings(lr, econ.rates, nodeMults, sfMultsOf)
    inRun.push(...rr)
    for (const ch of ['xr', 'ir']) if (!rr.some((o) => o.param.startsWith(ch))) inRunWhy.push(`${ch}${lr.bn}: fewer than 3 ${ch === 'xr' ? 'exp' : 'income (balance only rising)'} windows past level 50 in BN${lr.bn} so far — no reading`)
  } else inRunWhy.push('rates: the economy was measured with --rates const (no fitted rates model): no xr/ir reading')
  const lastSeg = segs[segs.length - 1]
  const gIn = inProgressG(lastSeg)
  if (gIn.reading) inRun.push(gIn.reading)
  else inRunWhy.push(gIn.why)
  const st = loadStore(file)
  // a stream's superseded readings are derived data (history.jsonl re-derives them): keep the latest only
  const streams = new Set(inRun.map((o) => o.stream).filter(Boolean))
  st.observations = st.observations.filter((o) => !(o.stream && streams.has(o.stream) && /^(xr|ir|g)\d+$/.test(o.param) && !inRun.some((x) => x.key === o.key)))
  const before = summarise(posteriorOf(st, econ, gOpt), econ)
  // the base can grow (a run moved into economy.MEASURED_RUNS): re-flag logged readings from history
  const fresh = new Map(fromHistory.map((o) => [o.key, o.inBase]))
  for (const o of st.observations) {
    if (!fresh.has(o.key)) continue
    if (fresh.get(o.key)) o.inBase = true
    else delete o.inBase
  }
  // a logged k stays as logged (the leg of the policy that clear played); today's leg's reading is printed beside it
  const policyMoves = []
  for (const o of fromHistory) {
    if (!o.rederive) continue
    const old = st.observations.find((x) => x.key === o.key)
    if (old && Math.abs(old.value / o.value - 1) > 1e-6) policyMoves.push(`${o.clear} k logged ${fmt(old.value)} (${old.note ?? ''}); today's policy's leg would read ${fmt(o.value)} (${o.note})`)
  }
  // a k read under REVISED conditions (CLEAR_LEGS rev) replaces the clear's reading logged under the old ones
  const replaced = []
  for (const o of fromHistory) {
    if (o.param !== 'k' || !CLEAR_LEGS[o.clear]?.rev) continue
    const stem = `k|${o.clear}|${o.at}`
    st.observations = st.observations.filter((x) => {
      const old = x.param === 'k' && (x.key === stem || x.key.startsWith(`${stem}|rev `)) && x.key !== o.key
      if (old) replaced.push(`${o.clear} k ${fmt(x.value)} (${x.note ?? ''}) -> ${fmt(o.value)} (${o.key})`)
      return !old
    })
  }
  const m = mergeObs(st, [...fromHistory.map(({ rederive, ...o }) => o), ...inRun, ...files.readings])
  const post = posteriorOf(st, econ, gOpt)
  const after = summarise(post, econ)
  st.posterior = after
  st.updatedAt = new Date().toISOString()
  if (!dryRun) saveStore(st, file)

  log(`OBSERVE — ${fromHistory.length} readings from history.jsonl (${segs.length} node segments, from ${OBS_SINCE}), ${files.readings.length} from the in-run channel (${OBS_FILES.join(', ')}${files.bad ? `; ${files.bad} unparseable lines` : ''})`)
  log(`  ${m.added} new, ${m.dup} already in the log${m.rejected.length ? `, ${m.rejected.length} rejected: ${m.rejected.join('; ')}` : ''}; ${post.nObs} applied (the rest are inside the hand prior)${dryRun ? ' — DRY RUN, not written' : ` — written to ${path.relative(path.resolve(HERE, '../../..'), file)}`}`)
  for (const o0 of fromHistory) {
    // the value the posterior uses: the logged one (a k is never re-derived)
    const o = st.observations.find((x) => x.key === o0.key) ?? o0
    log(`  ${o.inBase ? 'in base ' : 'applied '} ${o0.clear.padEnd(7)} ${o.param.padEnd(5)} ${fmt(o.value).padStart(7)}  sd ${o.sd} (log)  ${o.note ?? ''}`)
  }
  for (const r of policyMoves) log(`  KEPT     ${r}`)
  for (const r of replaced) log(`  REPLACED ${r}`)
  for (const r of fromHistory.withheld) log(`  WITHHELD ${r}`)
  for (const o of inRun) log(`  in run   ${String(o.param).padEnd(5)} ${fmt(Number(o.value)).padStart(7)}  sd ${o.sd} (log)  ${o.source}`)
  for (const w of inRunWhy) log(`  in run   ${w}`)
  for (const o of files.readings) log(`  channel  ${String(o.param).padEnd(5)} ${fmt(Number(o.value)).padStart(7)}  sd ${o.sd}  ${o.source ?? ''} ${o.at ?? ''} (${o.from})`)
  log('HOW THE POSTERIOR MOVED (before = the store as it was; g of an unplayed node AMC-normalised):')
  printMove(before, after, log)
  // cross-check: the hand latent against a full hierarchical fit of the base runs
  const ys = econ.runs.map((r) => Math.log(r.g) + econ.gamma * Math.log(econ.amc[r.bn]))
  const hf = hierFit(ys, OBS_SD.g)
  log(`  CROSS-CHECK the hand latent (lo/mid/hi = min / gm / max of ${ys.length} runs as p10/p50/p90): ${tri([econ.gScen.lo, econ.gScen.mid, econ.gScen.hi])}; a hierarchical fit of the same runs (flat mu, tau on a grid, sd ${OBS_SD.g}): ${tri([hf.p10, hf.p50, hf.p90].map(Math.exp))}, tau ${hf.tauMean.toFixed(2)} ${post.G ? `(hand: total ${post.G.s.toFixed(2)}, tau ${Math.sqrt(post.G.tau2).toFixed(2)})` : `(the draws use the ${post.gReg.chosen} covariate model, tau ${post.gReg.joint.beta.tauMean.toFixed(2)}: plan.mjs prints its leave-one-out)`}`)
  return { ...m, before, after, post, readings: fromHistory, withheld: fromHistory.withheld, replaced, channel: files.readings, inRun, inRunWhy, policyMoves }
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const ai = argv.indexOf('--telemetry')
  if (ai > -1) process.env.TELEMETRY = path.resolve(argv[ai + 1])
  const { measureEconomy } = await import('./economy.mjs')
  const { loadSurrogate } = await import('./surrogate.mjs')
  const { makeState } = await import('./state.mjs')
  const { TELEMETRY } = await import('../nodechoice/measure.mjs')
  const e = await measureEconomy()
  const econ = { ...e, ownG: new Map(e.ownG) }
  const { buildSurrogate } = await import('./surrogate.mjs')
  const { nodeSegments } = await import('../nodechoice/measure.mjs')
  const start = makeState(econ.live.sfOnEntry, econ.live.intelligence)
  await buildSurrogate({ start, profile: econ.profile, bbSeeds: 15, extraBb: clearLegSpecs(await nodeSegments(path.join(TELEMETRY, 'history.jsonl'))), log: (x) => process.stderr.write(x + '\n') })
  const S = await loadSurrogate({ start, profile: econ.profile, bbSeeds: 15 })
  await runObserve({ econ, S, telemetry: TELEMETRY, dryRun: argv.includes('--dry-run') })
  process.exit(0)
}
