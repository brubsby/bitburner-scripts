// THE WORK SLOT, as a Bladeburner actor reads it — one module for the two
// actors that may start a Bladeburner action: bladeburner.js (the full daemon)
// and bb-lite.js (its lean stand-in before a 92.75GB host exists).
//
// [bitburner-work-slot]: one slot, two claimants, defer on slot.owner. A
// Bladeburner action and Player.currentWork are exclusive both ways:
// startAction calls Player.finishWork first (Bladeburner.ts:179-181) and
// Bladeburner.process resets the action whenever currentWork is set
// (Bladeburner.ts:1353-1366). So an actor starts an action ONLY on a claim.
//
// RAM: ns.read only (0GB). The files live on home: a caller placed off home
// copies SLOT_FILES here first (ns.scp, 0.6GB, in the caller — not in this
// module, so a one-shot actor that only reads its own host's copy pays
// nothing for it; [bitburner-offhome-reads]).

export const PROGRESS = '/tel/progress.txt'
export const ORDERS = '/tel/orders.txt'
export const ACT = '/tel/act.txt'
/** What slotClaim reads: an off-home caller scp's these from home first. */
export const SLOT_FILES = ['/tel/progress.txt', '/tel/orders.txt', '/tel/act.txt']
/** Orders that put the player's work slot on something else (act.js actors that start work). */
export const WORK_ORDERS = new Set(['gym', 'crime', 'work', 'graft', 'company', 'course', 'focus'])
/** progress.js is a job that publishes every pass; a claim older than this is no claim (actplan.js PROGRESS_FRESH_MS). */
export const SLOT_FRESH_MS = 15 * 60e3

const parse = (ns, f) => {
  try {
    return JSON.parse(ns.read(f) || 'null')
  } catch {
    return null
  }
}

/**
 * The claim on the work slot, read from this host's copies of SLOT_FILES (`host` is
 * informational: the caller has already copied them here from home).
 *
 * progress.js's claim (/tel/progress.txt slot.owner) when the planner has a
 * fresh pass in this life. Without one — the opening of a node, when home
 * cannot yet hold the planner (BN4 2026-10-02: 32GB home, no pass for 2h40m)
 * — act.js's BOOTSTRAP claim (/tel/act.txt slot, actplan.decide 0b: the
 * Bladeburner route presumed where the division exists). The planner's claim
 * wins whenever it is fresh, as act.js itself defers to it (actplan block 0).
 *
 * A HANDOFF IS NOT A CLAIM. startAction calls Player.finishWork BEFORE it
 * checks anything (Bladeburner.ts:179-186), so starting on a claim the
 * planner has already moved on from kills the work it moved to. An order
 * batch written after the claim that starts work (gym, crime, faction work,
 * a graft...) means the slot is being handed to it — progress.js passes that
 * flush orders without rewriting /tel/progress.txt (the Covenant batch path)
 * leave the older claim standing beside them — so the claim does not hold
 * until a newer progress.txt says it does.
 */
export function slotClaim(ns, host, info, now = Date.now()) {
  const pr = parse(ns, PROGRESS)
  const at = Date.parse(pr?.at ?? '')
  const prWhy = !Number.isFinite(at)
    ? '/tel/progress.txt is absent or unreadable'
    : at < info.lastAugReset
      ? `/tel/progress.txt (${pr.at}) predates this life`
      : now - at > SLOT_FRESH_MS
        ? `/tel/progress.txt is ${((now - at) / 60e3).toFixed(0)} min old`
        : null
  if (prWhy) {
    // No planner this life: act.js's bootstrap claim, if it made one.
    const act = parse(ns, ACT)
    const s = act?.slot ?? null
    const aAt = Date.parse(s?.at ?? '')
    if (s && s.owner && Number.isFinite(aAt) && s.lastAugReset === info.lastAugReset && now - aAt <= SLOT_FRESH_MS) {
      return { owner: s.owner, ours: s.owner === 'bladeburner', at: s.at, by: 'act.js', why: `${prWhy}; act.js's bootstrap holds the slot for ${s.owner}${s.why ? ` (${String(s.why).slice(0, 120)})` : ''}` }
    }
    return { owner: null, ours: false, why: `${prWhy} — no claim (and no act.js bootstrap claim this life)` }
  }
  const owner = pr?.slot?.owner ?? null
  if (owner === 'bladeburner') {
    const ob = parse(ns, ORDERS)
    const oAt = Date.parse(ob?.at ?? '')
    const work = Number.isFinite(oAt) && oAt > at && ob?.lastAugReset === info.lastAugReset && Array.isArray(ob.orders) ? ob.orders.find((o) => WORK_ORDERS.has(o?.kind)) : null
    if (work) return { owner: `handoff:${work.kind}`, ours: false, at: pr.at, by: 'progress.js', why: `an order batch (${ob.at}) newer than the claim (${pr.at}) starts ${work.kind} — the slot is being handed off; not starting an action until progress.js claims it again` }
  }
  return { owner, ours: owner === 'bladeburner', at: pr.at, by: 'progress.js', why: owner === 'bladeburner' ? 'progress.js holds the slot for bladeburner' : `progress.js holds the slot for ${owner ?? 'nobody'}` }
}
