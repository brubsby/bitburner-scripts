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
