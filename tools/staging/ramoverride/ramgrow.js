// Raising a script's own RAM allocation at run time — and saying so when the
// game refuses.
//
//   import { raiseRam } from 'ramgrow.js'
//   if (!raiseRam(ns, want, note)) return
//
// ---------------------------------------------------------------------------
// Why this module exists rather than one line at each call site.
//
// `ns.ramOverride(n)` declared as the first statement of `main` is honoured
// STATICALLY (Script/RamCalculations.ts:352-360, :484-487), which is what lets a
// script carry `ns.singularity.*` in a BitNode that cannot call it and still
// cost 2.6GB. The price of that is that the script's allocation is now smaller
// than the code it contains, so before it touches the expensive API it has to
// grow — `dynamicRamUsage` only ever rises, and crossing the allocation KILLS
// the script (Netscript/NetscriptHelpers.tsx:498-520).
//
// NOTE THE FUNCTION NAME. It is `raiseRam`, not `grow`, because the RAM checker
// prices every bare Identifier by name on any object (RamCalculations.ts:407):
// a local called `grow` costs 0.15GB via ns.grow, and `travel` costs 4GB via
// ns.sleeve.travel. Invariant B1. The first draft of this module WAS called
// `grow`, and tools/test/ramoverride.test.mjs [R5] is what caught it — the
// file's full price came out 0.15GB above the computed ceiling.
//
// The raise itself works. Verified against the game's own runtime, not reasoned
// about — tools/staging/ramoverride/rt-probe.mjs builds a real Server /
// RunningScript / WorkerScript and calls the real NetscriptFunctions:
//
//   [1] declared 1.6GB, call getCurrentWork with NO raise   -> KILLED
//   [2] declared 1.6GB, ramOverride(2.1) -> 2.1, then call  -> SURVIVED
//
// THE PART THAT NEEDS THIS MODULE IS [3].
//
//   NetscriptFunctions.ts:1210-1214
//     const newServerRamUsed = roundToTwo(server.ramUsed + (newRam - rs.ramUsage) * rs.threads)
//     if (newServerRamUsed > server.maxRam) {
//       // Can't allocate more RAM.
//       return rs.ramUsage            // <- the OLD value. No throw. No log.
//     }
//
// A raise the host cannot afford is **silently denied**. It returns the previous
// allocation, the script carries on believing it grew, and the next gated call
// kills it — two statements away from the cause, with a message about
// circumventing the static RAM calculation that points at nothing. Measured:
//
//   [3] full 8GB home, ramOverride(2.1) returned 1.6 (asked 2.1)
//       -> raise SILENTLY DENIED, then the call KILLED the script
//
// That is exactly the shape CLAUDE.md's "failure must be loud" section is
// about, so every raise in this collection goes through here: check the return
// value, publish, print a `!!!!!` line, and let the caller return cleanly
// instead of dying later somewhere unrelated.
//
// Cost: 0GB. `ramOverride` is 0 (RamCostGenerator.ts:657), `getScriptName` is 0
// (:647), `tprint` is 0 (:584), and status.js is 0 (it touches only ns.write).
// Importing this is free in every importer, and it must stay that way.

import { publish } from 'status.js'

/**
 * Ask the game for `want` GB per thread, and report loudly if it says no.
 *
 * Returns true only when the allocation is at least `want`. `1e-9` of slack
 * because the game rounds to two places (roundToTwo, NetscriptFunctions.ts:1203)
 * and an exact === on floats is how a correct raise gets reported as denied.
 *
 * `file` is the status file to publish the refusal into, so the failure is
 * visible to the daemon's telemetry mirror and not only to whoever was watching
 * the terminal. Passing null skips that and only prints.
 */
export function raiseRam(ns, want, file, context) {
  const got = ns.ramOverride(want)
  if (got + 1e-9 >= want) return true

  const detail =
    `ns.ramOverride(${want}) returned ${got}: the host could not spare ` +
    `${(want - got).toFixed(2)}GB/thread. NetscriptFunctions.ts:1210-1214 denies this ` +
    `silently, so this line is the only record. Free some RAM on this host, or run ` +
    `this script somewhere with room.`

  // Two channels, because the point of the module is that a raise failure is
  // never inferred from a later symptom. The terminal is the one a human sees.
  ns.tprint(`!!!!! ${ns.getScriptName()}: RAM raise DENIED — ${detail}`)
  if (file) {
    publish(ns, file, {
      at: new Date().toISOString(),
      health: 'error',
      result: 'ram-raise-denied',
      wanted: want,
      granted: got,
      context: context ?? null,
      detail,
    })
  }
  return false
}
