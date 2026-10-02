// bb-lite-read.js — one shot: the reads the lean view is built from.
// Every contract/operation (Raid aside): the success range the game shows at
// its current level (autolevel: the max level once it has been attempted),
// the count left and the max level; the next black operation (the first whose
// count is 1 — getActionCountRemaining answers 0 for done, 1 otherwise,
// NetscriptFunctions/Bladeburner.ts:182-183) and its range.
//
//   args[0]  JSON {from: black ops known done (a lower bound; 0 if unknown)}
//
// RAM: base 1.6 + getActionEstimatedSuccessChance 4 + getActionCountRemaining 4
// + getActionMaxLevel 4 = 13.6GB.
import { LITE_PORT, LEAN_ACTIONS, BLACK_OP_NAMES } from 'bbliteplan.js'
import { TYPE } from 'bbplan.js'

export async function main(ns) {
  const out = { actor: 'read', ok: false }
  try {
    const want = JSON.parse(String(ns.args[0] ?? '{}'))
    const bb = ns.bladeburner
    out.actions = LEAN_ACTIONS.map(({ type, name }) => {
      const [lo, hi] = bb.getActionEstimatedSuccessChance(type, name)
      return { name, lo, hi, count: bb.getActionCountRemaining(type, name), maxLevel: bb.getActionMaxLevel(type, name) }
    })
    let done = Math.max(0, Math.min(BLACK_OP_NAMES.length, Math.floor(Number(want.from) || 0)))
    while (done < BLACK_OP_NAMES.length && bb.getActionCountRemaining(TYPE.blackOp, BLACK_OP_NAMES[done]) < 1) done++
    out.done = done
    if (done < BLACK_OP_NAMES.length) {
      const [lo, hi] = bb.getActionEstimatedSuccessChance(TYPE.blackOp, BLACK_OP_NAMES[done])
      out.blackOp = { name: BLACK_OP_NAMES[done], lo, hi }
    } else out.blackOp = null
    out.ok = true
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 300)
  }
  ns.writePort(LITE_PORT, JSON.stringify(out))
}
