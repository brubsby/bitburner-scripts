// Publishing a script's last state, on every path out of it.
//
//   import { reporter, describe, record } from 'status.js'
//
//   const errors = []
//   const note = reporter(ns, '/tel/thing.txt', () => ({ errors: errors.slice(-5) }))
//   ns.atExit(() => note.exit('stopped', { detail: 'thing.js exited' }))
//   try {
//     ...
//     note('ok', { result: 'ok', detail: 'did the thing' })
//   } catch (err) {
//     ns.print(record(errors, err))
//     note('error', { result: 'error', detail: describe(err) })
//   }
//
// ---------------------------------------------------------------------------
// Why this exists.
//
// Several scripts wrote their telemetry as the LAST statement of a `try`. Any
// throw earlier in the block skips that write, so the one record of what went
// wrong is precisely the thing that never gets produced: the process stays
// alive, the status file stays frozen at the last good tick, and the script
// looks idle rather than broken. A ReferenceError from a bad edit hid inside
// batch.js for 23 minutes exactly that way, and the fix there — write the
// status from the `catch` as well — is the pattern this module generalises.
//
// The rule it enforces: **the diagnostic must not share a failure path with
// the thing it diagnoses.** Three paths, all of which must publish:
//
//   1. success            — note('ok', ...) at the end of the try
//   2. handled error      — note('error', ...) from the catch
//   3. everything else    — note.exit(...) from ns.atExit: a kill, a killall,
//                           an install, or a throw that escapes every handler
//
// (3) is the one no try/finally can reach, and it is the one that matters most
// for a telemetry source: a status file that stops being updated is
// indistinguishable from a game that stopped changing, so every reader
// downstream consumes history believing it is the present.
//
// ---------------------------------------------------------------------------
// Why importing this is free, and how to keep it that way.
//
// Netscript charges a script for every ns function referenced anywhere in its
// import graph, whether or not the call is reachable, and it charges per
// *identifier*: RamCalculations.ts walks MemberExpression properties, so the
// bare name `scp` costs 0.6GB wherever it appears, on any object. A shared
// module is therefore only safe to import widely if it touches nothing
// expensive — one careless call here raises the floor of every importer at
// once, multiplied by their thread counts.
//
// This module references exactly two ns functions: `ns.write`, which costs
// **0GB** (Netscript/RamCostGenerator.ts:632, next to `read: 0` and
// `atExit: 0`), and `ns.print` (0GB, :582), used only when both writes of a
// publish fail. Importing it costs 0GB in every importer, forever.
//
// What is deliberately NOT in here:
//
//   - `ns.scp` (0.6GB) + `ns.getHostname` (0.05GB). The daemon only mirrors
//     /tel/* off *home* (tools/rfa-daemon.mjs:262-268), so a script running on
//     a rooted server has to copy its status file over or it is invisible
//     outside the game. But putting that here would bill 0.65GB to every
//     importer including the ones that only ever run on home. tel.js,
//     buyserv.js and batch.js already reference both and do the copy inline;
//     it stays there, where it is already paid for.
//   - `ns.rm` (0.6GB), `ns.fileExists` (0.1GB), `ns.getServerMoneyAvailable`,
//     or anything else that reads the game. A reporter must not need the world
//     to be readable in order to report that the world is unreadable.
//
// Same reason there is no `eval('document')` here: that is 25GB the moment the
// RAM checker sees the identifier, and this module is imported by scripts that
// must stay small.
// ---------------------------------------------------------------------------

/**
 * Turn a throw into something you can actually debug from.
 *
 * `String(err)` yields "ReferenceError: foo is not defined" with no location,
 * which is the exact information missing when a bad edit kills a loop — the
 * batch.js incident was a ReferenceError whose *name* was never in doubt and
 * whose *site* took 23 minutes to find. The first few stack frames name the
 * function and the line, and they are cheap: this is pure string work.
 *
 * Bounded, because a status file with a 40-frame stack in it is a status file
 * nobody reads.
 */
export function describe(err) {
  const stack = err && typeof err === 'object' && typeof err.stack === 'string' ? err.stack : ''
  const text = stack
    ? stack
        .split('\n')
        .slice(0, 4)
        .map((line) => line.trim())
        .join(' <- ')
    : String(err)
  return text.slice(0, 400)
}

/**
 * Write a status file. Never throws.
 *
 * A reporting failure must not become the failure — if this threw out of a
 * catch block it would re-create the bug it exists to fix, one level up. The
 * boolean is there for callers that want to know, not for callers that must.
 */
export function publish(ns, file, body) {
  try {
    ns.write(file, JSON.stringify(body, null, 2), 'w')
    return true
  } catch (err) {
    // A payload that refuses to serialise — a cycle, a getter that throws, a
    // game object with a surprise in it — must not leave the file untouched and
    // silently stale. That is this module's own bug, one level up. Fall back to
    // the smallest thing that is certainly writable, so the file still says
    // something went wrong here.
    try {
      ns.write(
        file,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            // 'error', not whatever the caller intended: the payload it wanted
            // to publish is not in this file, so nobody should read it as ok.
            health: 'error',
            intendedHealth: (body && body.health) || null,
            error: `status payload could not be written: ${describe(err)}`,
          },
          null,
          2,
        ),
        'w',
      )
    } catch (err2) {
      // BOTH writes failed, so the file is stale and nothing in it says so.
      // Returning false was the whole of the old handling, and no caller
      // checked it — the one path where silence is certain. Say it where it
      // can still be seen: the script's own log (ns.print, 0GB) and the
      // browser console. Each guarded, because this must still never throw.
      const text = `STATUS WRITE FAILED TWICE for ${file}: ${describe(err)} / fallback: ${describe(err2)}`
      try {
        ns.print(`!!!!! ${text}`)
      } catch {
        /* the log is gone too */
      }
      try {
        console.error(text)
      } catch {
        /* nothing left to try */
      }
    }
    return false
  }
}

/**
 * Keep a bounded tail of failures, so one good tick does not erase the last
 * bad one.
 *
 * Without this, a loop that throws once an hour and recovers publishes an
 * error for five seconds and then overwrites it with 'ok' forever; the only
 * way to see it is to be looking at the right five seconds. batch.js keeps
 * `errors.slice(-5)` in its *healthy* status for exactly this reason, and the
 * scripts here now do the same. Returns the rendered text so the caller can
 * print it without describing the error twice.
 */
export function record(errors, err, keep = 20) {
  const text = `${new Date().toISOString()} ${describe(err)}`
  errors.push(text)
  while (errors.length > keep) errors.shift()
  return text
}

/**
 * Build the single publish function a script keeps for its whole life.
 *
 * `base` is an object, or a thunk returning one when the script has counters
 * that move (refocused, exportClaims, an error tail) — a thunk means every
 * write carries current values without each call site restating them.
 *
 * Field order is `at`, then `health`, then base, then the call's own fields,
 * so a caller can override anything. That is what lets existing status files
 * keep their own `result` / `work` / `note` names — things read those — and
 * merely gain `health` alongside, rather than being reshaped.
 *
 * `health` is the one-glance field: 'ok' | 'waiting' | 'locked' | 'error' |
 * 'stopped'. batch.js already publishes one and it is the first thing anybody
 * looks at, so everything that reports now speaks the same word.
 */
export function reporter(ns, file, base) {
  let last = null

  const note = (health, fields) => {
    last = {
      at: new Date().toISOString(),
      health,
      ...(typeof base === 'function' ? base() : base || {}),
      ...(fields || {}),
    }
    publish(ns, file, last)
    return last
  }

  /**
   * The last word, written from `ns.atExit`.
   *
   * atExit callbacks run inside stopAndCleanUpWorkerScript *before* stopFlag is
   * set and before the worker is removed (Netscript/killWorkerScript.ts:56-84),
   * so synchronous ns calls — write, rm, scp — still work there. It costs 0GB
   * (RamCostGenerator.ts:605). It is the only hook that fires on `kill`, on a
   * killall, on an augmentation install, and on a throw that got past every
   * handler in the script.
   *
   * Republishes the last body rather than replacing it, so the shape readers
   * expect survives the exit; `exited: true` and `staleSince` say that
   * everything underneath is now history. A reader that only checks `health`
   * sees 'stopped'; a reader that wants the old payload still has it.
   */
  note.exit = (health, fields) => {
    const body = last || { ...(typeof base === 'function' ? base() : base || {}) }
    publish(ns, file, {
      ...body,
      at: new Date().toISOString(),
      health,
      exited: true,
      staleSince: last ? last.at : null,
      ...(fields || {}),
    })
  }

  return note
}
