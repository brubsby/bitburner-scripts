// hackarmcal.mjs — CALIBRATION of the live hacking exit (exitplan.bestExitPolicy, the route decision's
// 'hack' arm, plan.decideBladeRouteGen) against finished hacking clears, and the BitNode 12 route rule's
// LIFT CHECK (routepin.NODE_ROUTE_RULES[12]).
//
//   node tools/sim/hackarmcal.mjs            the table: model vs measured remaining hours, error printed
//   node tools/sim/hackarmcal.mjs --json     also the record as JSON (last line)
//     --remeasure   re-measure each row's remaining hours from history.jsonl (printed beside the table's)
//     --dryrun F    the BN12 entry dry-run record (default .telemetry/entry-dryrun.json)
//
// WHY (2026-11-13): BN12.7 priced its hacking exit at 2-4h for five hours (07:08-12:00Z), switched route
// from the black ops and installed nine times; the one hacking clear of BN12 took 21.2h (BN12.1) and five
// Bladeburner clears 6.1-7.3h (BN12.2-12.6). The cause was the purchase sequence's shape
// (exitplan.cadenceShapeOf): the cadence posterior (0.104/h, 90% this node's own lives) over the model's
// 96-life mean (0.002 ln a life) made a scale of 25-31, and the catalogue's front (33x the mean) priced the
// next half-hour lives at x5.6 and x3.5: mult 1.83 -> 45.7 in three lives. The scale is now bounded by the
// range this table covers (exitplan.SHAPE_SCALE_MAX; `unbounded` prints the arm without it).
//
// WHAT IS MEASURED: each row is an exit-inputs record the live stack published inside a node that was later
// CLEARED BY HACKING (tools/test/fixture-*.json), priced by THIS checkout's bestExitPolicy, against the
// hours the node actually ran from that record to its clear — on the game's own clock (history.jsonl
// totalPlaytime; the clear's end as below). `scale` is the record's shape scale (ln g over the model's mean,
// unbounded): the bound must cover every one of them (tools/test/hackarmcal.test.mjs HC2).
//
// WHAT IS NOT: the records are mid-node and the arm is priced from each one's state, so the table checks
// the remaining-hours forecast, not an entry price; inputs added to the builder after a record was written
// are absent from it (priced as the record has them). The clears' ends are the last history sample of the
// node (BN12.1: tools/bn12board.mjs's endedAt), so an idle tail after the clear counts as play (< 0.7h).
//
// TOLERANCE (the decision it protects: the BitNode 12 route, blade's measured 6.1-7.3h against a hacking
// arm that priced 3.7h): per row |ln(model / measured)| <= ln 2 (x/÷ 2, the gap between the routes' points
// at the BN12 entries is x2-3); the BitNode 12 rows' mean ln error within ROUTE_CAL's hacking band.
//
// THE LIFT CHECK (NODE_ROUTE_RULES[12] may be lifted only when BOTH hold):
//   1. the arm reproduces BN12.1: every BN12 row within the tolerance AND the rows' mean |ln| within the band
//   2. the arm's price at a BitNode 12 ENTRY (the entry dry-run's published hackH, .telemetry/entry-dryrun.json,
//      tools/sim/entry/dryrun.mjs — the decision the rule protects) is above every measured Bladeburner clear
//      of BN12 (bn12-board.json): what the clears measured (blade faster), the arm must not contradict.
// The live mid-node price (.telemetry/exitinputs.txt) is printed beside it, not in the criterion (a node
// played on the black ops is no hacking trajectory).
// Exit code: 0 when the lift criterion holds, 1 when it does not (the rule stays), 2 when it could not check.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import '../test/gameresolve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const TEL = process.env.TELEMETRY ?? path.join(REPO, '.telemetry')
const xp = await import(path.join(REPO, 'exitplan.js'))
const { ROUTE_CAL, routeSdOf } = await import(path.join(REPO, 'routecal.js'))
const { nodeRuleOf } = await import(path.join(REPO, 'routepin.js'))

export const TOL_LN = Math.log(2)

/** The finished hacking clears (history.jsonl segments, maxHacking >= 1000) and their end. */
export const CLEARS = {
  'BN8.1': { node: 8, end: '2026-09-27T20:48:58.377Z' },
  'BN1.3': { node: 1, end: '2026-09-28T18:36:30.886Z' },
  'BN9.1': { node: 9, end: '2026-10-01T02:48:25.544Z' },
  // tools/bn12board.mjs endedAt (the history segment runs on idle to 23:08Z)
  'BN12.1': { node: 12, end: '2026-10-09T22:27:38.809Z' },
  'BN13.1': { node: 13, end: '2026-10-13T01:00:16.400Z' },
  'BN10.3': { node: 10, end: '2026-10-20T18:35:58.336Z' },
}

/** Exit-inputs records published inside those clears (tools/test fixtures), with the measured remaining game hours (history totalPlaytime, 2026-11-13). */
export const ROWS = [
  { clear: 'BN8.1', file: 'fixture-bn8-1128.json', measuredH: 32.92 },
  { clear: 'BN8.1', file: 'fixture-bn8-2252.json', measuredH: 21.98 },
  { clear: 'BN8.1', file: 'fixture-bn8-2314.json', measuredH: 21.6 },
  { clear: 'BN8.1', file: 'fixture-bn8-0042.json', measuredH: 20.05 },
  { clear: 'BN1.3', file: 'fixture-bn1-freshlife-0018.json', measuredH: 18.27 },
  { clear: 'BN1.3', file: 'fixture-bn1-cadence-0058.json', measuredH: 17.52 },
  { clear: 'BN1.3', file: 'fixture-bn1-lifeplan-0610.json', measuredH: 12.44 },
  { clear: 'BN9.1', file: 'fixture-bn9-2149.json', measuredH: 52.94 },
  { clear: 'BN9.1', file: 'fixture-bn9-perlife-2022.json', measuredH: 30.41 },
  { clear: 'BN9.1', file: 'fixture-bn9-gangrespect-1556.json', measuredH: 10.89 },
  { clear: 'BN12.1', file: 'fixture-bn12-farmsplit-1450.json', measuredH: 7.66 },
  { clear: 'BN12.1', file: 'fixture-bn12-splitctl-1600.json', measuredH: 6.23 },
  { clear: 'BN12.1', file: 'fixture-bn12-split-income-1643.json', measuredH: 5.73 },
  { clear: 'BN12.1', file: 'fixture-bn12-splitdwell-1753.json', measuredH: 4.56 },
  { clear: 'BN13.1', file: 'fixture-bn13-samebuilder-1927.json', measuredH: 29.51 },
  { clear: 'BN13.1', file: 'fixture-bn13-lifelength-2103.json', measuredH: 27.92 },
  { clear: 'BN10.3', file: 'fixture-bn10-covenant.json', measuredH: 49.65 },
]

const num = (x) => typeof x === 'number' && Number.isFinite(x)

/** A record's exit inputs (the fixtures carry them under several keys). */
export function inputsOfRecord(x) {
  for (const e of [x?.exitinputs, x?.exitInputs, x]) if (e?.inputs?.exitLevel) return { at: e.at ?? x.at ?? x.capturedAt ?? null, node: e.bitNode ?? null, inputs: e.inputs }
  return null
}

/** The record's inputs priced now, or as before the scale's bound (`old`: exitplan shapeScaleMax Infinity). */
export function asBuiltNow(inputs, { old = false } = {}) {
  return old ? { ...inputs, shapeScaleMax: Infinity } : inputs
}

/** The shape's scale on a record (ln g over the model's mean): what the bound acts on. */
export function shapeScaleOf(inputs) {
  const s = inputs?.cadenceShape
  if (!s || !num(inputs.multGainPerCycle) || inputs.multGainPerCycle <= 1) return null
  const r = xp.cadenceShapeOf(s, { cycleHours: inputs.cycleHours, multGainPerCycle: inputs.multGainPerCycle, scaleMax: Infinity })
  return r ? r.scale : null
}

export const hoursOf = (inputs) => {
  try {
    const r = xp.bestExitPolicy(inputs)
    return num(r?.best?.hours) ? r.best.hours : null
  } catch {
    return null
  }
}

/** One row priced both ways. */
export function priceRow(row, dir = path.join(REPO, 'tools/test')) {
  const rec = inputsOfRecord(JSON.parse(fs.readFileSync(path.join(dir, row.file), 'utf8')))
  if (!rec) return { ...row, why: 'no exit inputs in the record' }
  const I = rec.inputs
  const modelH = hoursOf(asBuiltNow(I))
  const oldH = hoursOf(asBuiltNow(I, { old: true }))
  const ln = (h) => (num(h) && h > 0 ? Math.log(h / row.measuredH) : null)
  return { ...row, at: rec.at, hacking: I.hacking, cycleHours: I.cycleHours, shaped: !!I.cadenceShape, scale: shapeScaleOf(I), modelH, oldH, lnErr: ln(modelH), lnOld: ln(oldH) }
}

const stats = (xs) => {
  const v = xs.filter(num)
  if (!v.length) return null
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const rms = Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length)
  return { n: v.length, mean, rms, maxAbs: Math.max(...v.map(Math.abs)) }
}

/** The measured Bladeburner clears of BN12 (bn12-board.json). */
export function bladeClearsOf(board) {
  return (board?.clears ?? []).filter((c) => c.done && c.route === 'blade' && num(c.activeH ?? c.wallH)).map((c) => ({ label: c.label, hours: c.activeH ?? c.wallH }))
}

/**
 * THE LIFT CHECK (header). rows: the priced rows (the BN12 ones read); entry: {label, hackH} the arm's
 * price at a BN12 entry; blade: the measured Bladeburner clears. Returns {lift, reproduces, agrees, why, parts}.
 */
export function liftCheckOf({ rows, entry, blade, band = routeSdOf('hack', 12, ROUTE_CAL), tol = TOL_LN }) {
  const r12 = rows.filter((r) => CLEARS[r.clear]?.node === 12)
  const st = stats(r12.map((r) => r.lnErr))
  const within = r12.length > 0 && r12.every((r) => num(r.lnErr) && Math.abs(r.lnErr) <= tol)
  const meanOk = !!st && Math.abs(st.mean) <= band
  const reproduces = within && meanOk
  const bladeMax = blade.length ? Math.max(...blade.map((b) => b.hours)) : null
  const agrees = num(bladeMax) && num(entry?.hackH) ? entry.hackH > bladeMax : null
  const lift = reproduces && agrees === true
  const why = [
    `BN12.1 replay: ${r12.length} row(s), ${within ? 'every row' : 'NOT every row'} within x/÷${Math.exp(tol).toFixed(1)}, mean ln ${st ? st.mean.toFixed(3) : '?'} ${meanOk ? '<=' : '>'} the band ${band.toFixed(2)}`,
    agrees === null ? "the arm's BN12 entry price could not be read (no entry dry-run of BitNode 12, or no measured Bladeburner clear)" : `the arm at the ${entry.label ?? 'BN12'} entry ${entry.hackH.toFixed(2)}h ${agrees ? '>' : '<='} the slowest measured Bladeburner clear ${bladeMax.toFixed(2)}h`,
  ]
  return { lift, reproduces, agrees, why: `${lift ? 'LIFT' : 'KEEP the rule'}: ${why.join('; ')}`, parts: { within, meanOk, mean: st?.mean ?? null, band, bladeMax, entryH: entry?.hackH ?? null } }
}

/** The arm's price at a BN12 entry, from an entry dry-run record (dryrun.mjs --summary): the entry pass's route.hackH. */
export function entryOfDryrun(d) {
  const node = (d?.nodes ?? []).find((n) => /^BN12\./.test(n?.label ?? ''))
  const e = (node?.decisions ?? []).find((x) => x?.phase === 'entry')
  return e && num(e.route?.hackH) ? { label: node.label, at: d.at ?? null, hackH: e.route.hackH, bladeH: num(e.route?.bladeH) ? e.route.bladeH : null } : null
}

/** A BN12 exit-inputs record ({exitinputs, lastNodeReset}) priced now and unbounded. */
export function liveOfRecord(rec) {
  const x = rec?.exitinputs
  if (x?.bitNode !== 12 || !x.inputs) return null
  const nodeAgeH = num(rec.lastNodeReset) ? (Date.parse(x.at) - rec.lastNodeReset) / 3.6e6 : null
  return { at: x.at, hacking: x.inputs.hacking, nodeAgeH, hackH: hoursOf(asBuiltNow(x.inputs)), oldH: hoursOf(asBuiltNow(x.inputs, { old: true })), scale: shapeScaleOf(x.inputs) }
}

/** The latest BN12 exit inputs the stack published (.telemetry), priced now and unbounded. */
export function liveBn12Of(tel = TEL) {
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(tel, f), 'utf8'))
    } catch {
      return null
    }
  }
  return liveOfRecord({ exitinputs: read('exitinputs.txt'), lastNodeReset: read('state.json')?.lastNodeReset ?? null })
}

/** Re-measure a row's remaining game hours from history.jsonl (the table's measuredH). */
async function remeasure() {
  const pts = []
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(TEL, 'history.jsonl')) })
  for await (const l of rl) {
    let d
    try {
      d = JSON.parse(l)
    } catch {
      continue
    }
    if (num(d.totalPlaytime)) pts.push([Date.parse(d.at), d.totalPlaytime])
  }
  const near = (t) => pts.reduce((b, p) => (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b), null)
  return (row, at) => {
    const a = near(Date.parse(at))
    const e = near(Date.parse(CLEARS[row.clear].end))
    return a && e ? (e[1] - a[1]) / 3.6e6 : null
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
  }
  console.log('THE LIVE HACKING EXIT (exitplan.bestExitPolicy) vs finished hacking clears — remaining hours from each published record')
  const rows = ROWS.map((r) => priceRow(r))
  let re = null
  if (argv.includes('--remeasure')) re = await remeasure()
  const f = (x, d = 2) => (num(x) ? x.toFixed(d) : '   -')
  console.log(`  ${'clear'.padEnd(7)} ${'record'.padEnd(36)} ${'hack'.padStart(5)}  L    scale  measured   model  ln err   unbounded     ln old`)
  for (const r of rows) {
    const bad = !num(r.lnErr) || Math.abs(r.lnErr) > TOL_LN
    const m = re ? re(r, r.at) : null
    console.log(`${bad ? 'FAIL' : 'ok  '} ${r.clear.padEnd(7)} ${r.file.replace(/^fixture-|\.json$/g, '').padEnd(36)} ${String(r.hacking).padStart(5)} ${f(r.cycleHours, 1).padStart(4)} ${f(r.scale, 2).padStart(6)}  ${f(r.measuredH).padStart(7)}h ${f(r.modelH).padStart(7)}h  ${f(r.lnErr, 3).padStart(6)}   ${f(r.oldH).padStart(9)}h   ${f(r.lnOld, 3).padStart(6)}${m !== null && re ? `   (re-measured ${f(m)}h)` : ''}${r.why ? `  ${r.why}` : ''}`)
  }
  const byClear = {}
  for (const r of rows) (byClear[r.clear] ??= []).push(r)
  console.log('per clear (ln model/measured): mean, rms — now | unbounded scale')
  for (const [k, rs] of Object.entries(byClear)) {
    const a = stats(rs.map((r) => r.lnErr))
    const b = stats(rs.map((r) => r.lnOld))
    console.log(`  ${k.padEnd(7)} n ${rs.length}  now mean ${f(a?.mean, 3)} rms ${f(a?.rms, 3)}  |  before mean ${f(b?.mean, 3)} rms ${f(b?.rms, 3)}`)
  }
  const all = stats(rows.map((r) => r.lnErr))
  const allOld = stats(rows.map((r) => r.lnOld))
  console.log(`  pooled  n ${all?.n}  now mean ${f(all?.mean, 3)} rms ${f(all?.rms, 3)}  |  before mean ${f(allOld?.mean, 3)} rms ${f(allOld?.rms, 3)}   (ROUTE_CAL hacking pooled ${ROUTE_CAL.hacking.pooled})`)
  const live = liveBn12Of()
  if (live) console.log(`BN12 LIVE, mid-node (.telemetry/exitinputs.txt ${live.at}, hacking ${live.hacking}, node age ${f(live.nodeAgeH)}h, shape scale ${f(live.scale, 2)}, bound ${xp.SHAPE_SCALE_MAX}): the arm ${f(live.hackH)}h from here (unbounded ${f(live.oldH)}h) — printed, not in the criterion`)
  else console.log('BN12 LIVE: no BitNode 12 exit inputs in .telemetry')
  let board = null
  let dry = null
  try {
    board = JSON.parse(fs.readFileSync(path.join(TEL, 'bn12-board.json'), 'utf8'))
  } catch {}
  try {
    dry = JSON.parse(fs.readFileSync(opt('dryrun') ?? path.join(TEL, 'entry-dryrun.json'), 'utf8'))
  } catch {}
  const blade = bladeClearsOf(board)
  const entry = entryOfDryrun(dry)
  console.log(`BN12 measured Bladeburner clears: ${blade.map((b) => `${b.label} ${b.hours.toFixed(2)}h`).join(', ') || 'none read'}`)
  console.log(entry ? `BN12 ENTRY (entry dry-run ${entry.at}, ${entry.label}): hack ${f(entry.hackH)}h, blade ${f(entry.bladeH)}h (the blade arm's own entry price; the measured clears are the reference)` : 'BN12 ENTRY: no BitNode 12 entry dry-run read (tools/sim/entry/dryrun.mjs --chain 12.N --summary FILE; --dryrun FILE)')
  const lc = liftCheckOf({ rows, entry, blade })
  const rule = nodeRuleOf(12, null)
  console.log(`LIFT CHECK (routepin.NODE_ROUTE_RULES[12] ${rule ? `on: '${rule.route}'` : 'LIFTED'}): ${lc.why}`)
  if (!lc.lift && !rule) console.log('  !!!! the rule is lifted while the criterion does not hold')
  if (lc.lift && rule) console.log('  the criterion holds: the rule may be lifted (routepin.js NODE_ROUTE_RULES[12])')
  if (argv.includes('--json')) console.log(JSON.stringify({ rows, live, entry, blade, lift: lc }))
  process.exit(lc.agrees === null && !lc.reproduces ? 2 : lc.lift ? 0 : 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
