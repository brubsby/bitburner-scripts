// gameplan-obs.js — the in-run observation channel of the whole-game planner
// (tools/sim/gameplan: observe.mjs ingests it into posterior.json).
//
// One reading per line, JSON, appended to /tel/gameplan-obs.txt ON HOME; the
// rfa-daemon mirrors home's /tel/* to .telemetry/ (tools/rfa-daemon.mjs), so it
// lands as .telemetry/gameplan-obs.txt. A write on any other host would never
// be mirrored, so recordObs throws there instead of losing the reading quietly.
//
// SCHEMA (tools/sim/gameplan/README.md "Observations"):
//   { param, value, sd, at, source, node?, space?, key? }
//   param   a planner parameter id: w0, goP, rep14, lvl14, eps14, k, open, phi11,
//           d10, d8, e43, z9, or g<n> (node n's growth /h)
//   value   the measured value, in the parameter's units (w0: node power per hour)
//   sd      its standard error: of ln(value) when space is 'log' (the default,
//           a relative error: 0.2 = ~20%), in the parameter's units when 'lin'
//   space   'log' | 'lin' — 'lin' for a reading that can be 0 (w0 measured at 0)
//   at      ISO time of the measurement
//   source  who measured it and how (e.g. 'go.js w0r1d_d43m0n 12 games 7x7')
//   node    the BitNode it was measured in
//   key     optional; default `${param}|${source}|${at}` — the dedup key, so a
//           re-read file never counts a reading twice
//
// Pure apart from ns.write / ns.getHostname (0GB + 0.05GB).

export const OBS_FILE = '/tel/gameplan-obs.txt'
const PARAMS = new Set(['w0', 'goP', 'rep14', 'lvl14', 'eps14', 'k', 'open', 'phi11', 'd10', 'd8', 'e43', 'z9'])

/** The record recordObs writes (exported for tests). Throws on a malformed reading. */
export function obsRecord({ param, value, sd, source, node, space, key }, at = new Date().toISOString()) {
  if (!PARAMS.has(param) && !/^g([1-9]|1[0-4])$/.test(param)) throw new Error(`gameplan-obs: unknown param '${param}'`)
  if (!Number.isFinite(value)) throw new Error(`gameplan-obs: ${param} value ${value} is not a number`)
  if (!(sd > 0)) throw new Error(`gameplan-obs: ${param} sd ${sd} must be > 0`)
  if (space !== 'lin' && !(value > 0)) throw new Error(`gameplan-obs: ${param} value ${value} <= 0 needs space 'lin'`)
  if (!source) throw new Error(`gameplan-obs: ${param} needs a source`)
  const rec = { param, value, sd, at, source }
  if (node !== undefined) rec.node = node
  if (space) rec.space = space
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
