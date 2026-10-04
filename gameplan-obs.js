// gameplan-obs.js — the in-run observation channel of the whole-game planner
// (tools/sim/gameplan: observe.mjs ingests it into posterior.json).
//
// One reading per line, JSON, appended to /tel/gameplan-obs.txt ON HOME; the
// rfa-daemon mirrors home's /tel/* to .telemetry/ (tools/rfa-daemon.mjs), so it
// lands as .telemetry/gameplan-obs.txt. A write on any other host would never
// be mirrored, so recordObs throws there instead of losing the reading quietly.
// (go.js publishes its w0 readings itself, goplan.w0Obs, in the same schema.)
//
// SCHEMA (tools/sim/gameplan/README.md "Observations"):
//   { param, value, sd, at, source, node?, space?, stream?, key? }
//   param   a planner parameter id: w0, goP, rep14, lvl14, eps14, k, open, phi11,
//           d10, d8, e43, z9, stRam, stEpsM, stEpsR, stFr, stDuty (Stanek's Gift),
//           g<n> (node n's growth /h), or xr<n> / ir<n> (node n's exp / income level
//           exp(a_n) of the rates model, tools/sim/gameplan/rates.mjs; observe.mjs reads
//           the node in progress's own from history.jsonl)
//   value   the measured value, in the parameter's units (w0: raw node power per
//           hour against w0r1d_d43m0n, before GoPower / the SF14 doubling)
//   sd      its standard error: in the parameter's units when space is 'lin',
//           of ln(value) when 'log' (a relative error: 0.2 = ~20%)
//   space   'lin' | 'log'; default 'lin' for w0 (a 0 is a real reading), 'log' otherwise
//   at      ISO time of the measurement
//   source  who measured it and how; '<who>: <n> games vs <opponent>' marks a
//           cumulative estimate (see stream)
//   stream  optional: readings of one stream are cumulative re-estimates, only
//           the latest is applied (default: inferred from such a source)
//   node    the BitNode it was measured in
//   key     optional; default `${param}|${source}|${at}` — the dedup key, so a
//           re-read file never counts a reading twice
//
// Pure apart from ns.write / ns.getHostname (0GB + 0.05GB).

export const OBS_FILE = '/tel/gameplan-obs.txt'
const PARAMS = new Set(['w0', 'goP', 'rep14', 'lvl14', 'eps14', 'k', 'open', 'phi11', 'd10', 'd8', 'e43', 'z9', 'stRam', 'stEpsM', 'stEpsR', 'stFr', 'stDuty'])
const DEFAULT_SPACE = { w0: 'lin' }

/** The record recordObs writes (exported for tests). Throws on a malformed reading. */
export function obsRecord({ param, value, sd, source, node, space, stream, key }, at = new Date().toISOString()) {
  if (!PARAMS.has(param) && !/^(g|xr|ir)([1-9]|1[0-4])$/.test(param)) throw new Error(`gameplan-obs: unknown param '${param}'`)
  if (!Number.isFinite(value)) throw new Error(`gameplan-obs: ${param} value ${value} is not a number`)
  const sp = space ?? DEFAULT_SPACE[param] ?? 'log'
  if (sp === 'lin' ? !(sd >= 0) : !(sd > 0)) throw new Error(`gameplan-obs: ${param} sd ${sd} must be ${sp === 'lin' ? '>= 0' : '> 0'}`)
  if (sp === 'log' && !(value > 0)) throw new Error(`gameplan-obs: ${param} value ${value} <= 0 needs space 'lin'`)
  if (!source) throw new Error(`gameplan-obs: ${param} needs a source`)
  const rec = { param, value, sd, at, source }
  if (node !== undefined) rec.node = node
  if (space) rec.space = space
  if (stream) rec.stream = stream
  if (key) rec.key = key
  return rec
}

/** @param {NS} ns  Append one reading; returns the record. */
export function recordObs(ns, reading) {
  if (ns.getHostname() !== 'home') throw new Error(`gameplan-obs: write on home only (the daemon mirrors home's /tel), not ${ns.getHostname()}`)
  const rec = obsRecord(reading)
  ns.write(OBS_FILE, JSON.stringify(rec) + '\n', 'a')
  return rec
}
