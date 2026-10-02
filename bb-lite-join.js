// bb-lite-join.js — one shot: join the Bladeburner division, and the
// Bladeburners faction when asked (rank >= 25; the game refuses below it and
// says so, Bladeburner.ts joinFaction). Answers bb-lite.js on LITE_PORT.
//
//   args[0]  JSON {faction: bool}
//
// RAM: base 1.6 + joinBladeburnerDivision 4 + joinBladeburnerFaction 4
// (inBladeburner 0) = 9.6GB, at every Source-File level (not SF4-scaled).
import { LITE_PORT } from 'bbliteplan.js'

export async function main(ns) {
  const out = { actor: 'join', ok: false }
  try {
    const want = JSON.parse(String(ns.args[0] ?? '{}'))
    const bb = ns.bladeburner
    out.divisionCall = bb.joinBladeburnerDivision()
    out.joined = bb.inBladeburner()
    if (out.joined && want.faction) out.factionCall = bb.joinBladeburnerFaction()
    out.ok = true
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 300)
  }
  ns.writePort(LITE_PORT, JSON.stringify(out))
}
