// A single global lock for "I am driving the game".
//
//   import { acquire, release } from 'lock.js'
//   if (!(await acquire(ns, 'homeup'))) return
//   try { ...drive the UI or the terminal... } finally { release(ns) }
//
// or, leak-proof by construction:
//
//   const r = await withLock(ns, 'homeup', async () => { ...drive... })
//   if (r === SKIPPED) return   // could not take it; do nothing
//
// ---------------------------------------------------------------------------
// Why one lock covers both the UI and the terminal.
//
// There is exactly one screen and one terminal, and both are stateful. Two
// scripts navigating at once is not a race that merely slows things down, it
// produces wrong results:
//
//   - A second script's navigation moves the page out from under the first,
//     which then clicks whatever happens to be at that position now.
//   - Typing ANY terminal command while `backdoor` is running prints
//     "Cancelled backdoor" and throws away minutes of progress. backdoor.js
//     holds the terminal for a long time, so everything else must wait.
//
// ---------------------------------------------------------------------------
// v2: liveness, not a timer.
//
// v1 decided "the holder is gone" with a 300s TTL. That is wrong in both
// directions, and both directions actually hurt:
//
//   - A holder that is ALIVE but slow (augbuy walking a long aug list, cmd.js
//     waiting out a `backdoor`, a browser tab the OS descheduled) had its lock
//     STOLEN at 5 minutes and got a second driver on the screen — precisely the
//     corruption the lock exists to prevent.
//   - A holder that DIED silently blocked everyone for the full 5 minutes. A
//     crashed augbuy once kept upkeep.js standing down for ~3 hours, during
//     which faction work ran unfocused at 80%.
//
// Netscript can answer "is that process alive?" exactly, so ask:
//
//   ns.isRunning(pid)  ->  findRunningScriptByPid(pid)
//                      ->  workerScripts.get(pid)
//     (NetscriptFunctions.ts:1028-1030, NetscriptHelpers.tsx:829-832,
//      Script/ScriptHelpers.ts:105-109)
//
// `workerScripts` is a single global Map keyed by pid (Netscript/Pid.ts:17
// refuses to reissue a pid that is in it), so:
//
//   * a pid identifies a process across the WHOLE game, not per host — the
//     lock record does not need a host to make the liveness check work, and
//   * ns.isRunning(pid) is a Map lookup, 0.1GB, no host argument.
//
// The host is recorded anyway, because it is free (ns.self() is 0GB) and
// because it is the first thing you want when a lock misbehaves.
//
// ---------------------------------------------------------------------------
// What liveness CANNOT cover, and therefore what the TTL is still for.
//
//   1. PID REUSE ACROSS A GAME INSTANCE ("ABA"). The pid counter is a module
//      global reset to 1 by Netscript/Pid.ts:39 `resetPidCounter()`, called
//      from Prestige.ts:194 (prestigeAugmentation) and Prestige.ts:360
//      (prestigeSourceFile) — i.e. on every augmentation install — and reset
//      implicitly on any page reload, because it is just `let pidCounter = 1`
//      at module scope. Text files on home SURVIVE all of those. So a lock
//      file naming pid 742 can outlive its writer and then be "confirmed
//      alive" by an unrelated post-install script that was handed pid 742.
//      Liveness would then never free it.
//
//      Fixed exactly, and for free, with an INSTANCE NONCE carried in a
//      Netscript port. `NetscriptPorts` is a plain in-memory Map
//      (NetscriptWorker.ts:38); it is not in the save, and
//      `prestigeWorkerScripts()` clears it outright (NetscriptWorker.ts:40-46,
//      called from Prestige.ts:57/:204 and AugmentationHelpers.ts:76). So an
//      empty port means "different game instance than whoever wrote that file".
//      A record whose nonce is foreign is from a previous life; its pid being
//      "alive" is an impostor, and we steal.
//
//   2. A HOLDER THAT IS ALIVE BUT WEDGED. A DOM poll with no bound, an
//      `await` that never settles. isRunning() says "alive" and it is, but it
//      is never going to release. Nothing observable distinguishes this from a
//      slow-but-working holder, so it needs a timer — but a generous one,
//      since every *fast* failure mode above is now caught in one poll.
//      That is STALE_HUNG_MS, 30 minutes, and stealing on it prints loudly.
//
//   3. A LOCK FILE THAT IS NOT OURS: hand-written, or written by a pre-mutex
//      script that used the path as a bare flag. No pid, so no liveness. v1
//      handled this by synthesising `at: Date.now()` on every read, which made
//      `Date.now() - at > TTL` permanently false — an unparseable lock file was
//      IMMORTAL and deadlocked every caller until someone deleted it by hand.
//      Now such a record is honoured for STALE_LEGACY_MS measured from the
//      first time THIS script saw it (module state below), then stolen.
//
// ---------------------------------------------------------------------------
// Leaks: ns.atExit does the work the callers kept forgetting.
//
// `finally` does not run when a script is KILLED, which is the commonest way
// this lock leaked (watchdog restarts, `killall`, a tail-window kill). But
// ns.atExit costs 0GB and its callbacks run from stopAndCleanUpWorkerScript()
// BEFORE `ws.stopFlag = true` (killWorkerScript.ts:64-84), on every exit path:
// normal return and uncaught throw both funnel through killWorkerScript()
// (NetscriptWorker.ts:144-159), as does an external kill. Synchronous ns calls
// inside the callback still work because stopFlag is not set yet and
// `ws.runningFn` was already cleared.
//
// So acquire() registers its own release. A caller that returns early, throws,
// or is killed now releases anyway. The `finally` in callers is still correct
// style — it releases *sooner* — but it is no longer load-bearing.
//
// Not covered by atExit: closing or reloading the browser tab. That is case 1
// above, and the instance nonce clears it on the next acquire.
//
// ---------------------------------------------------------------------------
// The lock file lives on the server the script runs on. Use home.
//
// ns.write(filename, data, mode) and ns.read(filename) take NO host and always
// act on `ctx.workerScript.getServer()` (NetscriptFunctions.ts:1041 and :1078),
// while ns.fileExists/ns.rm DO take a host. v1 mixed the two — fileExists on
// 'home', read on the local server — so off home it could never take the lock
// and never reported why: read() returned '' against a home file that existed,
// the record parsed as legacy, and acquire() spun to its deadline. There is no
// way to write a file to another server from Netscript, so a cross-host global
// lock through a file is not expressible. acquire() therefore refuses, loudly,
// anywhere but home. (upkeep.js's own `ns.fileExists(LOCK)` stand-down check
// has the same constraint and is likewise only correct on home.)
// ---------------------------------------------------------------------------

export const LOCK = '/tel/ui-lock.txt'

// Reserved for the instance nonce. Nothing else in this repo uses ports;
// if that changes, do not take this one. Ports are free (getPortHandle,
// peek, write and clear are all 0GB in RamCostGenerator.ts).
export const LOCK_PORT = 12525

// Backstop for a holder that is alive but wedged — see case 2 above. This is
// NOT the normal path to freeing a dead lock; that is instant.
const STALE_HUNG_MS = 1800000

// How long a record we cannot check liveness for is honoured — see case 3.
const STALE_LEGACY_MS = 300000

const POLL_MS = 500

// Returned by withLock when the lock could not be taken.
export const SKIPPED = Symbol('lock-skipped')

// ---------------------------------------------------------------------------
// MODULE STATE IS SHARED BY EVERY SCRIPT THAT IMPORTS THIS FILE.
//
// NetscriptJSEvaluator.ts compiles each script to a blob URL and caches the
// LoadedModule by its generated code (`moduleCache`, NetscriptJSEvaluator.ts:41
// and :175-212); importing the same blob URL returns the same module
// namespace. So there is exactly ONE instance of lock.js's module scope for
// the whole game, shared live between cmd.js, augbuy.js, nfg.js and the rest,
// and it outlives any individual script.
//
// Consequence: never cache anything script-specific up here. In particular do
// NOT memoise ns.self()/ns.pid — the first caller's identity would be handed
// to every later caller, and release() would then delete another script's
// lock. The only module state below is about the lock FILE, which is genuinely
// global, and is invalidated whenever the file's contents change.
// ---------------------------------------------------------------------------

// When the game first saw the current un-checkable record — see case 3 above.
let legacySeenAt = 0
let legacySeenRaw = ''

/**
 * A token identifying this run of the game process. Survives nothing: not an
 * install, not a page reload. That is the entire point.
 */
function instanceId(ns) {
  const h = ns.getPortHandle(LOCK_PORT)
  const v = h.peek()
  if (typeof v === 'string' && v.startsWith('lock2:')) return v
  // Either empty ("NULL PORT DATA", NetscriptPort.ts:7) or something foreign.
  // No await between the peek and the write, so no other script can run in
  // between and this cannot double-create. See the race note below.
  const id = 'lock2:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8)
  h.clear()
  h.write(id)
  return id
}

/** Parse the lock file. null = free. */
function current(ns) {
  const raw = ns.read(LOCK)
  if (!raw) {
    legacySeenAt = 0
    legacySeenRaw = ''
    return null
  }
  let v = null
  try {
    v = JSON.parse(raw)
  } catch {
    v = null
  }
  if (v && typeof v === 'object' && typeof v.pid === 'number' && v.pid >= 0) {
    legacySeenAt = 0
    legacySeenRaw = ''
    return v
  }
  // A record with no usable pid: hand-written, pre-mutex, or corrupt. Honour
  // it for a while, but from when WE first saw it, not from a timestamp it
  // may not carry.
  if (legacySeenRaw !== raw) {
    legacySeenRaw = raw
    legacySeenAt = Date.now()
  }
  const owner = (v && typeof v === 'object' && v.owner) || 'unknown'
  return { owner: String(owner), pid: -1, at: legacySeenAt, legacy: true }
}

/**
 * Why the lock may be taken from `held`, or '' if it may not.
 * Ordered cheapest-and-most-certain first.
 */
function stealReason(ns, held) {
  const age = Date.now() - (held.at ?? 0)

  if (held.legacy) {
    return age > STALE_LEGACY_MS
      ? `unidentifiable holder "${held.owner}" (no pid) seen ${Math.round(age / 1000)}s ago`
      : ''
  }

  // Definitive: no process with that pid exists anywhere in the game.
  if (!ns.isRunning(held.pid)) {
    return `${held.owner} (pid ${held.pid}${held.host ? ' on ' + held.host : ''}) is no longer running`
  }

  // The pid is alive but belongs to a different game instance, so it is a
  // reused number, not our holder. Records written by lock v1 carry no nonce;
  // they fall through to the timer instead, which is the v1 behaviour and is
  // what we want while old code is still resident.
  if (held.inst && held.inst !== instanceId(ns)) {
    return `${held.owner} (pid ${held.pid}) is from a previous game instance; pid has been reused`
  }

  if (age > STALE_HUNG_MS) {
    return `${held.owner} (pid ${held.pid}) is alive but has not touched the lock for ${Math.round(age / 60000)}min`
  }

  return ''
}

function writeRecord(ns, owner, who) {
  ns.write(
    LOCK,
    JSON.stringify({
      v: 2,
      owner,
      pid: who.pid,
      host: who.server,
      file: who.filename,
      inst: instanceId(ns),
      at: Date.now(),
    }),
    'w',
  )
}

/**
 * Wait for the lock and take it. Returns false if it could not be taken within
 * `waitMs`, in which case the caller must do nothing and try later — never
 * proceed unlocked.
 *
 * On success a release is registered with ns.atExit, so the lock is given back
 * even if the caller throws, returns early, or is killed.
 */
export async function acquire(ns, owner, waitMs = 180000) {
  // One call: ns.self() is 0GB but rebuilds a public RunningScript (it copies
  // the log array, NetscriptHelpers.tsx:864-896). ns.pid is free and allocates
  // nothing, so everywhere that only needs the pid uses that instead.
  const who = ns.self()

  if (who.server !== 'home') {
    // ns.write/ns.read are server-local and there is no way to write home from
    // here, so this process cannot participate in the lock at all. Say so
    // rather than silently spinning until the deadline, which is what v1 did.
    ns.tprint(
      `lock: ${owner} is running on ${who.server}, not home — the UI lock is a home file ` +
        `(ns.write has no host argument). Refusing to drive the UI. Run it on home.`,
    )
    return false
  }

  const deadline = Date.now() + waitMs
  let announced = ''

  for (;;) {
    const held = current(ns)

    // Already ours: re-entrant acquire, and a convenient way to refresh. The
    // nonce check matters here too — if we are the impostor (our pid is a
    // reused number from before an install) the record is not ours and must
    // fall through to the steal path, which says so out loud.
    if (held && held.pid === ns.pid && (!held.inst || held.inst === instanceId(ns))) {
      writeRecord(ns, owner, who)
      ns.atExit(() => release(ns), 'ui-lock')
      return true
    }

    const why = held ? stealReason(ns, held) : ''

    if (!held || why) {
      if (why) ns.tprint(`lock: ${owner} taking the lock — ${why}`)

      // No await between the read above and this write, so nothing else can
      // have run in between: the check and the claim are one atomic step.
      writeRecord(ns, owner, who)

      // Not a race check (see above) — an assertion that the write landed.
      // ns.write can no-op or throw on a bad path, and silently believing we
      // hold a lock we do not is the one outcome worse than not having it.
      const check = current(ns)
      if (check && check.pid === ns.pid) {
        ns.atExit(() => release(ns), 'ui-lock')
        return true
      }
      ns.tprint(`lock: ${owner} wrote ${LOCK} but could not read it back — not proceeding`)
      return false
    }

    if (held.owner !== announced) {
      announced = held.owner
      ns.print(`lock: waiting on ${held.owner} (pid ${held.pid})`)
    }

    if (Date.now() > deadline) return false
    await ns.sleep(POLL_MS)
  }
}

/** Release, but only if we still hold it — never stomp a later owner. */
export function release(ns) {
  const held = current(ns)
  if (held && held.pid === ns.pid) {
    try {
      ns.rm(LOCK, 'home')
    } catch {
      /* already gone */
    }
  }
}

/**
 * Refresh the timestamp during a long hold. Only needed to stay ahead of the
 * wedged-holder backstop (30min); a crash no longer needs a timer to detect.
 */
export function touch(ns) {
  const held = current(ns)
  if (held && held.pid === ns.pid) {
    ns.write(LOCK, JSON.stringify({ ...held, at: Date.now() }), 'w')
  }
}

/** Who holds it, for diagnostics. Adds `alive` and `steal`, which are the two things you want. */
export function holder(ns) {
  const held = current(ns)
  if (!held) return null
  return {
    ...held,
    alive: held.pid >= 0 ? ns.isRunning(held.pid) : null,
    steal: stealReason(ns, held) || null,
  }
}

/**
 * Run `fn` under the lock. Returns SKIPPED if the lock could not be taken, so
 * `if (r === SKIPPED) return` is the whole error path. Releases on every exit.
 */
export async function withLock(ns, owner, fn, waitMs = 180000) {
  if (!(await acquire(ns, owner, waitMs))) return SKIPPED
  try {
    return await fn()
  } finally {
    release(ns)
  }
}
