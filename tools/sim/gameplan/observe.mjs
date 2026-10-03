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
//     a finished BLADEBURNER clear    -> k = (hours - opening + early) / the
//        bbsim leg the planner prices it with (surrogate, the node's SF6/SF7):
//        exactly the k that makes routes.mjs's blade formula reproduce the
//        clear; key k|BNn.l|completion time
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
// inBase, never applied: economy.MEASURED_RUNS (g) and BN6.1 (k = 1.223, the
// reading below — params.BB_PARAMS.k's mid IS it; open = 2.5h).

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
export function baseIn(measuredRuns) {
  return [...measuredRuns.map((r) => ({ param: 'g', bn: r.bn, start: r.start })), { param: 'k', bn: 6, start: BN6_START }, { param: 'open', bn: 6, start: BN6_START }]
}

/**
 * Readings from history segments. Pure: the models come in as functions.
 *   gOf(bn, sfOnEntry, hours)  -> backed-out g
 *   bbLeg(bn, lv)              -> bbsim leg median (hours) or null
 *   gymDiff(bn, lv)            -> gym hours to combat 100 in bn minus in BN6
 *   earlyOf(lv, bn)            -> the SFs' first-life saving (mid world)
 * lv(n) is the SF level on entry.
 */
export function readingsFromSegments(segs, { gOf, bbLeg, gymDiff, earlyOf, base = [] }) {
  const out = []
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
      const val = openAdj - gymDiff(s.bitNode, lv)
      if (val > 0)
        out.push({ ...common, param: 'open', value: val, sd: OBS_SD.open, at: s.startedAt, source: 'history.jsonl: entry -> combat 100, first life, less the gym scale', key: `open|${clear}|start ${s.startedAt}`, inBase: inBase('open'), note: `combat 100 at ${s.combat100H.toFixed(2)}h${completed ? '' : ' (node in progress)'}` })
    }
    if (!completed) return
    if (route === 'hack') {
      const g = gOf(s.bitNode, s.sfOnEntry, s.hours)
      if (g > 0) out.push({ ...common, param: `g${s.bitNode}`, value: g, sd: OBS_SD.g, at: s.endedAt, source: 'history.jsonl: hacking-route clear, g backed out of its hours', key: `g|${clear}|${s.endedAt}`, inBase: inBase('g'), note: `${s.hours.toFixed(2)}h` })
    } else if (route === 'blade') {
      const leg = bbLeg(s.bitNode, lv)
      if (leg > 0 && openAdj !== null) {
        const k = (s.hours - openAdj) / leg
        out.push({ ...common, param: 'k', value: k, sd: OBS_SD.k, at: s.endedAt, source: 'history.jsonl: Bladeburner clear, (hours - opening) / bbsim leg', key: `k|${clear}|${s.endedAt}`, inBase: inBase('k'), note: `${s.hours.toFixed(2)}h, opening ${openAdj.toFixed(2)}h, leg ${leg.toFixed(2)}h` })
      }
    }
  })
  return out
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
  const { earlyOf, sfParamsMid } = await import('./effects.mjs')
  const { MEASURED_RUNS } = await import('./economy.mjs')
  const segs = await nodeSegments(path.join(telemetry, 'history.jsonl'))
  const sfMid = sfParamsMid()
  const l67 = (lv) => [Math.max(1, Math.min(3, lv(6))), Math.min(3, lv(7))]
  const fromHistory = readingsFromSegments(segs, {
    gOf: (bn, sf, T) => backOutG({ node: bn, sf, profile: econ.profile }, T).g,
    bbLeg: (bn, lv) => S.bbLeg(bn, ...l67(lv))?.median ?? null,
    gymDiff: (bn, lv) => (S.bbJoin(bn, ...l67(lv)) ?? 0) - (S.bbJoin(6, ...l67(lv)) ?? 0),
    earlyOf: (lv, bn) => earlyOf(lv, bn, sfMid),
    base: baseIn(MEASURED_RUNS),
  })
  const files = readingsFromFiles(telemetry)
  const st = loadStore(file)
  const before = summarise(posteriorOf(st, econ, gOpt), econ)
  // the base can grow (a run moved into economy.MEASURED_RUNS): re-flag logged readings from history
  const fresh = new Map(fromHistory.map((o) => [o.key, o.inBase]))
  for (const o of st.observations) {
    if (!fresh.has(o.key)) continue
    if (fresh.get(o.key)) o.inBase = true
    else delete o.inBase
  }
  const m = mergeObs(st, [...fromHistory, ...files.readings])
  const post = posteriorOf(st, econ, gOpt)
  const after = summarise(post, econ)
  st.posterior = after
  st.updatedAt = new Date().toISOString()
  if (!dryRun) saveStore(st, file)

  log(`OBSERVE — ${fromHistory.length} readings from history.jsonl (${segs.length} node segments, from ${OBS_SINCE}), ${files.readings.length} from the in-run channel (${OBS_FILES.join(', ')}${files.bad ? `; ${files.bad} unparseable lines` : ''})`)
  log(`  ${m.added} new, ${m.dup} already in the log${m.rejected.length ? `, ${m.rejected.length} rejected: ${m.rejected.join('; ')}` : ''}; ${post.nObs} applied (the rest are inside the hand prior)${dryRun ? ' — DRY RUN, not written' : ` — written to ${path.relative(path.resolve(HERE, '../../..'), file)}`}`)
  for (const o of fromHistory) log(`  ${o.inBase ? 'in base ' : 'applied '} ${o.clear.padEnd(7)} ${o.param.padEnd(5)} ${fmt(o.value).padStart(7)}  sd ${o.sd} (log)  ${o.note ?? ''}`)
  for (const o of files.readings) log(`  channel  ${String(o.param).padEnd(5)} ${fmt(Number(o.value)).padStart(7)}  sd ${o.sd}  ${o.source ?? ''} ${o.at ?? ''} (${o.from})`)
  log('HOW THE POSTERIOR MOVED (before = the store as it was; g of an unplayed node AMC-normalised):')
  printMove(before, after, log)
  // cross-check: the hand latent against a full hierarchical fit of the base runs
  const ys = econ.runs.map((r) => Math.log(r.g) + econ.gamma * Math.log(econ.amc[r.bn]))
  const hf = hierFit(ys, OBS_SD.g)
  log(`  CROSS-CHECK the hand latent (lo/mid/hi = min / gm / max of ${ys.length} runs as p10/p50/p90): ${tri([econ.gScen.lo, econ.gScen.mid, econ.gScen.hi])}; a hierarchical fit of the same runs (flat mu, tau on a grid, sd ${OBS_SD.g}): ${tri([hf.p10, hf.p50, hf.p90].map(Math.exp))}, tau ${hf.tauMean.toFixed(2)} ${post.G ? `(hand: total ${post.G.s.toFixed(2)}, tau ${Math.sqrt(post.G.tau2).toFixed(2)})` : `(the draws use the ${post.gReg.chosen} covariate model, tau ${post.gReg.joint.beta.tauMean.toFixed(2)}: plan.mjs prints its leave-one-out)`}`)
  return { ...m, before, after, post, readings: fromHistory, channel: files.readings }
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
  const S = await loadSurrogate({ start: makeState(econ.live.sfOnEntry, econ.live.intelligence), profile: econ.profile, bbSeeds: 15 })
  await runObserve({ econ, S, telemetry: TELEMETRY, dryRun: argv.includes('--dry-run') })
  process.exit(0)
}
