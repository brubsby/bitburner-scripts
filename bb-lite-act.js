// bb-lite-act.js — one shot: read the state that moves every second
// (stamina, rank, the running action), decide with bbplan.chooseAction on the
// lean view (bbliteplan.leanPick: LITE_POLICY, every action at its autolevel
// max), and start the pick — only on a claim read HERE, immediately before
// startAction (bbslot.slotClaim on this host's copy of the slot files, which
// bb-lite.js copied from home a moment before exec). startAction ends the
// player's work first (Bladeburner.ts:179-181), so a stale claim must not
// start anything.
//
//   args[0]  JSON {person, reads, levels, bnRank, resting, lastAugReset}
//
// RAM: base 1.6 + getStamina 4 + getRank 4 + startAction 4 + getCurrentAction 1
// = 14.6GB (bbslot.js and bbliteplan.js are 0GB).
import { LITE_PORT, leanViewOf, leanPick, restingOf } from 'bbliteplan.js'
import { slotClaim } from 'bbslot.js'

export async function main(ns) {
  const out = { actor: 'act', ok: false }
  try {
    const want = JSON.parse(String(ns.args[0] ?? '{}'))
    const bb = ns.bladeburner
    const [stamina, maxStamina] = bb.getStamina()
    const rank = bb.getRank()
    let current = bb.getCurrentAction()
    const resting = restingOf(want.resting, stamina, maxStamina)
    const view = leanViewOf({ person: want.person, reads: want.reads, levels: want.levels ?? {}, stamina, maxStamina, rank, bnRank: want.bnRank ?? 1, resting })
    const pick = leanPick(view)
    Object.assign(out, { stamina, maxStamina, rank, resting, pick, started: null })
    const same = !!current && current.type === pick.type && current.name === pick.name
    const claim = slotClaim(ns, 'home', { lastAugReset: want.lastAugReset })
    out.slot = { owner: claim.owner, ours: claim.ours, at: claim.at ?? null, by: claim.by ?? null, why: claim.why }
    if (claim.ours && !same) {
      out.started = bb.startAction(pick.type, pick.name)
      current = bb.getCurrentAction()
    }
    out.current = current ? { type: current.type, name: current.name } : null
    out.ok = true
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 300)
  }
  ns.writePort(LITE_PORT, JSON.stringify(out))
}
