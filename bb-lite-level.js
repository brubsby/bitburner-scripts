// bb-lite-level.js — one shot, once per bb-lite.js process in a division:
// every contract/operation back on the game's autolevel at its max level.
// bladeburner.js turns autolevel OFF and sets levels below the max; the lean
// view reads each range at the max level (bbliteplan.leanViewOf), so a
// division the full daemon has touched is put back first.
//
// RAM: base 1.6 + setActionAutolevel 4 + setActionLevel 4 + getActionMaxLevel 4 = 13.6GB.
import { LITE_PORT, LEAN_ACTIONS } from 'bbliteplan.js'

export async function main(ns) {
  const out = { actor: 'level', ok: false }
  try {
    const bb = ns.bladeburner
    out.set = 0
    for (const { type, name } of LEAN_ACTIONS) {
      bb.setActionAutolevel(type, name, true)
      bb.setActionLevel(type, name, bb.getActionMaxLevel(type, name))
      out.set++
    }
    out.ok = true
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 300)
  }
  ns.writePort(LITE_PORT, JSON.stringify(out))
}
