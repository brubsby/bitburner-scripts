// caps/go-cheat.js — the arm compiled in when this save CAN call ns.go.cheat.*
//
// Note what this file does NOT do: it does not call ns.go.cheat.* itself. It
// execs go-cheat.js, exactly as the handwritten go.js does today, because the
// cheat surface is 32GB and go.js is a permanent resident while go-cheat.js
// lives for about a second.
//
// That distinction is the thing a compiler cannot replace. Module substitution
// decides WHICH CODE EXISTS; a separate script decides WHEN ITS RAM IS PAID.
// Inlining the cheat calls here would make a save that owns SF14.2 pay 32GB for
// the whole life to save a 1.3GB ns.exec. The compiler removes the duplicated
// policy, not the split.

const HELPER = 'go-cheat.js'

/**
 * Is the cheat API usable in this life?
 *
 * The Source-File half of that question was answered at build time — this file
 * only exists in a dist whose profile said yes. What is still a runtime
 * question is whether the helper was actually deployed, which is not a
 * capability but a fact about the file system, and it can be false: a partial
 * push, a script deleted on a rooted server, a dist copied without its helper.
 * ns.fileExists is 0.1GB and the answer cannot be inferred from anything else.
 */
export const cheatAvailable = (ns) => ns.fileExists(HELPER, 'home')

/**
 * Perform one cheat and wait for it. Returns whether a turn was consumed.
 *
 * No return value is needed from the helper: every cheat acts on the board,
 * which the caller re-reads on its next iteration. A failed cheat simply
 * skipped our turn. `pid === 0` means there was no RAM for the helper, which is
 * reported as "did not play" so the caller falls through to a normal move
 * rather than silently passing.
 */
export async function requestCheat(ns, kind, x1, y1, x2, y2) {
  const pid = ns.exec(HELPER, 'home', 1, kind, x1, y1, x2, y2)
  if (!pid) return false
  while (ns.isRunning(pid)) await ns.sleep(40)
  return true
}
