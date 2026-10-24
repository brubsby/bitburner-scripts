// TWO CHECKS THAT RACE THE LIFE'S OWN PIPELINE — pure (no I/O), for
// tools/healthcheck.mjs, like tools/bbhealth.mjs and tools/raisehealth.mjs.
//
//   ORDER NOT HELD   progress.js's work-slot owner vs the work the save shows.
//                    progress.js writes slot.owner and /tel/orders.txt in ONE
//                    pass; act.js executes the batch on its next loop (after a
//                    snapshot refresh). Between the two the save still shows
//                    the previous work. Live BN12 2026-10-09: 18:39:25Z fired
//                    "claims 'crime', the game is running FactionWork" on a
//                    batch stamped 18:39:18.997Z that act.js ran at 18:39:30Z
//                    (save at 18:39:55Z: CrimeWork); 18:08:58Z fired 'faction'
//                    vs ClassWork and the save read FactionWork (NiteSec) at
//                    18:09:09Z. Both were the check sampling inside that gap.
//                    A batch carrying a work order that act.js has NOT yet run
//                    (act.txt orders.at != orders.txt at) and is younger than
//                    ORDER_PENDING_MIN is pending — noted, not failed. Once
//                    act.js has run the batch, or past the bound, a mismatch
//                    FAILS, naming the work order's own result when it failed.
//
//   EXIT UNPRICED    installgate.txt carries no exit this life. After an
//                    install the previous life's gate is (rightly) discarded
//                    and progress.js's first pass of the new life comes some
//                    minutes later — 5.1 min after the 18:24:11Z BN12 install
//                    (exitjump.txt first.elapsedH 0.085). With ~15-min lives
//                    that gap fired on most runs. Inside EXIT_UNPRICED_GRACE_MIN
//                    of the life (the save's playtimeSinceLastAug, not a file
//                    the planner writes) it is noted; past it, it FAILS.

export const ORDER_PENDING_MIN = 3
export const EXIT_UNPRICED_GRACE_MIN = 10

const WORK_ORDERS = new Set(['work', 'crime', 'gym', 'course', 'company', 'graft', 'focus'])
const num = (x) => typeof x === 'number' && Number.isFinite(x)

/**
 * `owner`: progress.txt slot.owner; `want`: the work types that hold it;
 * `actual`: the save's currentWork type (or null); `orders`: /tel/orders.txt;
 * `act`: /tel/act.txt; `nowMs`. Returns {fail: {what, detail}} or {note}.
 * `cause`: an optional caller-named cause (the graft's funding).
 */
export function orderHeldVerdict({ owner, want, actual, orders, act, nowMs, cause = null }) {
  if (want.includes(actual)) return { note: `work slot: '${owner}' claimed and the game is running ${actual}` }
  const batchAt = orders?.at ?? null
  const workOrder = Array.isArray(orders?.orders) ? orders.orders.find((o) => WORK_ORDERS.has(o?.kind)) : null
  const executed = !!batchAt && act?.orders?.at === batchAt
  const ageMin = batchAt && Number.isFinite(Date.parse(batchAt)) ? (nowMs - Date.parse(batchAt)) / 60000 : null
  if (workOrder && !executed && ageMin !== null && ageMin >= 0 && ageMin < ORDER_PENDING_MIN) {
    return { note: `work slot: '${owner}' ordered ${(ageMin * 60).toFixed(0)}s ago (${workOrder.kind} ${(workOrder.args ?? []).join(' ')}, batch ${batchAt}); act.js has not run the batch yet, the game still shows ${actual ?? 'nothing'} — pending, not failed, for ${ORDER_PENDING_MIN} min` }
  }
  let named = cause
  if (!named && workOrder && executed) {
    const r = (act.orders.results ?? []).find((x) => x?.kind === workOrder.kind && (x.id ?? null) === (workOrder.id ?? null))
    if (r && r.ok !== true) named = `act.js ran the ${workOrder.kind} order and it failed: ${String(r.result?.error ?? r.skipped ?? r.why ?? 'not ok').slice(0, 160)}`
    else if (r) named = `act.js ran the ${workOrder.kind} order (ok at ${r.result?.at ?? '?'}) and something else took the slot since`
  }
  if (!named && workOrder && !executed) named = `act.js has not run the batch of ${batchAt} after ${ageMin === null ? '?' : ageMin.toFixed(1)} min (bound ${ORDER_PENDING_MIN})`
  return { fail: { what: `ORDER NOT HELD: progress.js claims the work slot for '${owner}' work, but the game is running ${actual ?? 'nothing'}`, detail: named ?? 'something else took the slot (act.js? a stale order?) — the plan is not happening' } }
}

/** `lifeMs`: the save's playtimeSinceLastAug. Returns {fail: {what, detail}} or {note}. */
export function exitUnpricedVerdict({ lifeMs }) {
  const lifeMin = num(lifeMs) ? lifeMs / 60000 : null
  if (lifeMin !== null && lifeMin >= 0 && lifeMin < EXIT_UNPRICED_GRACE_MIN) return { note: `exit not priced yet: the life is ${lifeMin.toFixed(1)} min old (progress.js's first pass of a life; grace ${EXIT_UNPRICED_GRACE_MIN} min)` }
  return { fail: { what: 'EXIT UNPRICED: installgate.txt carries no exitH', detail: `${lifeMin === null ? 'the life age is unreadable; ' : `the life is ${lifeMin.toFixed(1)} min old; `}the run cannot say how far it is from the end — every decision that prices a trajectory is flying blind` } }
}

/**
 * THE NEXT HOME UPGRADE for HOME UNPRICED / HOME APPROVED NOT BOUGHT: the
 * watchdog's own priced record (jobs['homeup.js'].next, every cycle) first;
 * else /tel/homeup.txt only when the home it describes is the live one
 * (`home`: the save's {ram, cores}). That file is only as fresh as homeup.js's
 * last run — live BN12 2026-10-09 it was BitNode 9's (2026-10-07: 128GB,
 * 1 core, next RAM $503m) against a 65536GB/4-core home, and HOME UNPRICED
 * named an upgrade that did not exist. Returns {next, why}.
 */
export function homeNextOf({ homeup = null, watchdog = null, home = null } = {}) {
  const w = watchdog?.jobs?.['homeup.js']?.next ?? null
  if (w && num(w.cost)) return { next: w, why: "the watchdog's priced record" }
  if (!homeup?.next) return { next: null, why: 'no priced next home upgrade (no watchdog record, no homeup.txt)' }
  const live = num(home?.ram) && num(home?.cores)
  if (live && homeup.homeRam === home.ram && homeup.cores === home.cores) return { next: homeup.next, why: `homeup.txt (${homeup.at})` }
  return { next: null, why: `homeup.txt (${homeup.at}) describes a ${homeup.homeRam}GB/${homeup.cores}-core home${live ? `, not the live ${home.ram}GB/${home.cores}-core one` : ' and the live home is unreadable'} — another node's or life's record, rejected` }
}

// ---------------------------------------------------------------------------
// WINDOWED MOVEMENT CHECKS. healthcheck.mjs compares against the sample it
// stored last (written when >= 5 min old), so a check that needs N minutes
// between its two ends could never fire at a cadence shorter than N: PLANNER
// IDLE wanted 30 min while tools/watch-run.sh 900 and bitburner-notify.timer
// both run every ~15. Each such check keeps a short history in the state file
// (per runner: HEALTHCHECK_STATE) and compares against the NEWEST stored
// sample at least N minutes old.
export const HIST_KEEP_MIN = 180
export const HIST_MAX = 48

/** The newest entry of `hist` at least `minMin` minutes before `nowMs` (null when none). */
export function windowBaseOf(hist, nowMs, minMin) {
  let base = null
  for (const h of Array.isArray(hist) ? hist : []) {
    const t = Date.parse(h?.at ?? '')
    if (Number.isFinite(t) && (nowMs - t) / 60000 >= minMin && (!base || t > Date.parse(base.at))) base = h
  }
  return base
}
/** `hist` + `entry`, oldest first, trimmed to `keepMin` minutes and `max` entries. */
export function pushHist(hist, entry, nowMs, keepMin = HIST_KEEP_MIN, max = HIST_MAX) {
  const kept = (Array.isArray(hist) ? hist : []).filter((h) => {
    const t = Date.parse(h?.at ?? '')
    return Number.isFinite(t) && t < nowMs && (nowMs - t) / 60000 <= keepMin
  })
  return [...kept, entry].slice(-max)
}

/**
 * PLANNER IDLE: progress.js did nothing (progress.txt `did` empty) and kept waiting on the same
 * todo[0] for >= PLANNER_IDLE_MIN — the newest sample at least that old, every sample since, and
 * now. Same node (number AND lastNodeReset). `hist`: [{at, node, nodeReset, didCount, todo0}].
 * Returns {fail} or {note} or {}.
 */
export const PLANNER_IDLE_MIN = 30
export function plannerIdleVerdict({ hist, now, nowMs }) {
  if (!now || now.didCount !== 0 || now.todo0 === null || now.todo0 === undefined) return {}
  const same = (Array.isArray(hist) ? hist : []).filter((h) => h.node === now.node && (now.nodeReset == null || h.nodeReset === now.nodeReset))
  const base = windowBaseOf(same, nowMs, PLANNER_IDLE_MIN)
  if (!base) return { note: `planner idle check: no sample ${PLANNER_IDLE_MIN}+ min old in this node yet` }
  const since = same.filter((h) => Date.parse(h.at) >= Date.parse(base.at))
  if (since.every((h) => h.didCount === 0 && h.todo0 === now.todo0)) {
    const mins = (nowMs - Date.parse(base.at)) / 60000
    return { fail: { what: `PLANNER IDLE: progress.js did nothing across ${mins.toFixed(0)} min, still waiting on: ${String(now.todo0).slice(0, 160)}` } }
  }
  return {}
}

/**
 * THE EXIT HISTORY EXIT NOT APPROACHING compares (F1). An entry is
 * {at, exitH, node, nodeReset, life, ver, basis}. Kept only when it is
 *   - this node: the number AND lastNodeReset — BN3.1's last exit (4.3h)
 *     against BN3.2's first (10.3h) 0.5h after the entry fired it (live
 *     2026-10-21 17:11Z): both are BitNode 3;
 *   - priced on the same exit model (plan.txt `ver`; 2026-09-29 the stock
 *     double-count fix moved it 53.9h -> 69.7h and this fired);
 *   - this life's, or an earlier life's priced on the same basis (the route
 *     the exit is the end of: 'blade' black ops vs 'hack' World Daemon) — an
 *     install that changed the basis changed what is being projected.
 * Returns {hist (with `now` appended when it has an exit), dropped: [why]}.
 */
export const EXIT_HIST_MAX = 48
export function exitHistOf({ prevHist, now }) {
  const dropped = []
  let hist = (Array.isArray(prevHist) ? prevHist : []).filter((h) => typeof h?.exitH === 'number' && Number.isFinite(h.exitH))
  const drop = (pred, why) => {
    const gone = hist.filter(pred)
    if (gone.length) dropped.push(`${gone.length} sample(s) ${why(gone[0])}`)
    hist = hist.filter((h) => !pred(h))
  }
  drop((h) => h.node !== now.node, (h) => `from BitNode ${h.node} (now ${now.node})`)
  if (now.nodeReset != null) drop((h) => h.nodeReset !== now.nodeReset, (h) => `from another entry of BitNode ${now.node} (lastNodeReset ${h.nodeReset ?? 'untagged'}, now ${now.nodeReset})`)
  drop((h) => (h.ver ?? null) !== (now.ver ?? null), () => `priced on another exit model (now ${now.ver ?? 'untagged'})`)
  if (now.life != null) drop((h) => h.life !== now.life && (h.basis ?? null) !== (now.basis ?? null), (h) => `from before an install that changed the exit's basis (${h.basis ?? 'untagged'} -> ${now.basis ?? 'untagged'})`)
  const entry = typeof now.exitH === 'number' && Number.isFinite(now.exitH) ? [{ at: now.at, exitH: now.exitH, node: now.node, nodeReset: now.nodeReset ?? null, life: now.life ?? null, ver: now.ver ?? null, basis: now.basis ?? null }] : []
  return { hist: [...hist, ...entry].slice(-EXIT_HIST_MAX), dropped }
}
/**
 * F1, EXIT NOT APPROACHING: over at least EXIT_APPROACH_MIN_H of the kept history (its oldest
 * such sample), the projected exit must fall by at least half the wall time. Returns {fail} or {}.
 */
export const EXIT_APPROACH_MIN_H = 1
export function exitApproachVerdict({ hist, now }) {
  if (!(typeof now?.exitH === 'number' && Number.isFinite(now.exitH))) return {}
  const nowMs = Date.parse(now.at)
  const oldest = (hist ?? []).find((h) => (nowMs - Date.parse(h.at)) / 3.6e6 >= EXIT_APPROACH_MIN_H)
  if (!oldest) return {}
  const elapsedH = (nowMs - Date.parse(oldest.at)) / 3.6e6
  const gainedH = oldest.exitH - now.exitH
  if (gainedH < 0.5 * elapsedH) return { fail: { what: `EXIT NOT APPROACHING: projected exit ${oldest.exitH.toFixed(1)}h -> ${now.exitH.toFixed(1)}h over ${elapsedH.toFixed(1)}h of wall time`, detail: 'the run is spending time without getting closer to the end — find which leg is stuck (progress.txt todo, installgate plan)' } }
  return {}
}

/**
 * NO INSTALL (F2): a life older than 3x the plan's install window with nothing queued. NOT when no
 * install is planned — the final window, read from the plan and the gate, never the window:
 *   - The Red Pill is installed: the life the node ends in (BN10.3 2026-10-19 fired 0.7h into it,
 *     "3x the 0.2h window", while cash grew $7e13 -> $7e14 in 20 min toward the $1e17 Covenant sleeve);
 *   - the committed install decision is 'never' this life (plan.txt decisions.install, lastAugReset);
 *   - the gate holds for the exit (installgate holdForever) or its Covenant campaign is saving for the
 *     sleeve (covenantExit.active), this life;
 *   - any other priced hold (`pricedHold`: the count simulation, the plan's install:false, the
 *     Bladeburner route).
 * EXIT NOT APPROACHING still watches a final window that does not move. Returns {fail} or {note} or {}.
 */
export function noInstallVerdict({ lifeH, windowH, queued, augs = [], plan = null, gate = null, lastAugReset = null, pricedHold = false, holdWhy = '' }) {
  if (!(num(lifeH) && num(windowH) && lifeH > 3 * windowH && queued === 0)) return {}
  const sameLife = (r) => !!r && lastAugReset != null && r.lastAugReset === lastAugReset
  const finalWhy = (augs ?? []).includes('The Red Pill')
    ? 'The Red Pill is installed: this is the life the node ends in'
    : sameLife(plan) && plan.decisions?.install?.key === 'never'
      ? "the committed install decision is 'never' (the final window)"
      : sameLife(gate) && gate.holdForever === true
        ? 'the install gate holds for the exit (holdForever)'
        : sameLife(gate) && gate.covenantExit?.active === true
          ? 'the Covenant campaign is saving for the sleeve'
          : null
  if (finalWhy) return { note: `no install planned (life ${lifeH.toFixed(1)}h, window ${windowH.toFixed(1)}h): ${finalWhy} — EXIT NOT APPROACHING watches it` }
  if (pricedHold) return { note: `install held by the simulated exit (life ${lifeH.toFixed(1)}h): ${String(holdWhy ?? '').slice(0, 120)}` }
  return { fail: { what: `NO INSTALL: this life is ${lifeH.toFixed(1)}h old, 3x the ${windowH.toFixed(1)}h window the plan assumes, and nothing is queued`, detail: `installgate planned=${gate?.planned}, plan=${gate?.plan === null ? 'null' : 'set'} — capital that is never converted into augmentations is not progress` } }
}
