// Terminal bridge: runs terminal commands written to a file, and writes back
// what the terminal printed.
//
//   run cmd.js
//
// This exists so an external agent can drive the game through the Remote File
// API alone — push a command file, read the output file — instead of clicking
// and typing in a browser. Everything the terminal can do, this can do:
// connect, backdoor, buy, run, kill, scp, analyze. Most of that is otherwise
// gated behind ns.singularity.*, which needs Source-File 4 and is unavailable
// for this whole BitNode.
//
// Protocol, all paths on home:
//   /cmd/in.txt   one command per line. Deleted once consumed.
//   /cmd/out.txt  JSON: what ran, what the terminal printed, when.
//   /cmd/busy.txt present while a batch is running.
//
// So from outside the game:
//   pushFile /cmd/in.txt  "connect n00dles\nbackdoor"
//   ...poll...
//   getFile  /cmd/out.txt
//
// Why the DOM. Terminal.executeCommands is not reachable from Netscript, and
// the input is a React controlled component: setting `.value` directly updates
// the element but not React's state, and Enter reads React's state
// (TerminalInput.tsx:244). So we go through the native value setter, fire the
// `input` event React actually listens to, then send Enter. `eval` is used to
// reach document/window because a direct reference would be seen by the RAM
// checker; this is the same trick infilhelper.js already uses.
//
// ---------------------------------------------------------------------------
// Three things this script got wrong until now, all of them silent.
//
// 1. **It leaked the global UI lock on any throw or kill.** `acquire()` was
//    taken for the whole batch and `release()` was the second-to-last statement
//    of the loop body, with ~150 lines of DOM work, terminal driving and
//    unbounded waiting in between and **no try/finally at all**. Any throw in
//    there — a MUI/DOM shape change, `getElementById('terminal')` gone because
//    the tab unmounted, a bad edit — left /tel/ui-lock.txt on the floor.
//    upkeep.js stands down while that file exists, so the cost is continuous:
//    a lock leaked by a UI script once bought ~3 hours of unfocused (80%)
//    faction work. This is the longest-held lock in the repo (a `backdoor`
//    batch holds it for minutes) and it was the least protected.
//
// 2. **It leaked /cmd/busy.txt the same way.** Written as the batch starts,
//    removed only on the happy path. augbuy.js waits for that file to vanish
//    before touching the screen (augbuy.js:56), so a leaked busy file stalls
//    the augmentation purchase path for its full 30s wait — during an install,
//    which is exactly when both scripts are on the critical path.
//
// 3. **A half-finished batch left stale output.** /cmd/out.txt was written once,
//    after the last command. A batch that threw (or was killed) in the middle
//    never wrote it, so a caller that polled for the absence of /cmd/busy.txt
//    and then read /cmd/out.txt got the **previous** batch's results, with a
//    plausible timestamp and no indication anything had gone wrong. Silently
//    answering the wrong question is worse than answering none.
//
// All three are closed by ns.atExit. It costs 0GB (RamCostGenerator.ts:605) and
// its callbacks run from stopAndCleanUpWorkerScript() *before* `ws.stopFlag`
// is set (killWorkerScript.ts:56-84), so synchronous ns calls — write, rm —
// still work inside it. Every way out funnels through there: a normal return, a
// throw that escapes every handler, `kill cmd.js`, a killall, and an
// augmentation install (which kills every running script). It is keyed by id
// (NetscriptFunctions.ts atExit(f, id)); lock.js's own registration uses
// 'ui-lock', so this one uses 'cmd-bridge' to avoid replacing it.
//
// Failures are also reported now, to /tel/cmd.txt via status.js. A crashed
// bridge used to be indistinguishable from an idle one: no status file, no
// terminal line, just commands that stopped being answered.
// ---------------------------------------------------------------------------

import { acquire, release, touch } from 'lock.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record, publish } from 'status.js'

const IN = '/cmd/in.txt'
const OUT = '/cmd/out.txt'
const BUSY = '/cmd/busy.txt'
const STATUS = '/tel/cmd.txt'
const POLL = 1000

// How often to say "alive and idle" in the status file while nothing is queued.
// A bridge that has crashed and one that has had nothing to do look identical
// from outside otherwise.
const BEAT_MS = 60000

// Pause after a batch that threw, so a failure that leaves /cmd/in.txt in place
// cannot spin the loop — and the lock — at 1Hz.
const FAIL_BACKOFF = 5000

// Commands that must never be run from here. This is not a security boundary —
// anything with file access could do it anyway — it is a guard against an
// agent losing hours of progress to a typo in a queued batch.
const FORBIDDEN = [/^\s*softreset\b/i, /^\s*b1tflum3\b/i, /^\s*wd\b/i]

const doc = eval('document')
const win = eval('window')

/**
 * The terminal's rendered lines, as an array.
 *
 * Diffing the container's innerText by string length does not work: the
 * terminal keeps only a bounded number of entries, so once it is full the old
 * lines fall off the front and the text shifts rather than growing. Counting
 * <li> children and taking the ones past the old count is stable under that.
 */
function terminalLines() {
  const el = doc.getElementById('terminal')
  return el ? Array.from(el.children).map((li) => li.innerText) : []
}

/**
 * Bring the Terminal tab up if it is not the one rendered.
 *
 * The terminal input only exists in the DOM while the Terminal tab is mounted,
 * so every DOM-path command failed whenever the game happened to be showing
 * the faction-work screen, the City, or Create Program — which is most of the
 * time, and exactly when an agent wants to run something without disturbing
 * what is on screen. Clicking the nav item is what a person would do.
 */
function showTerminal() {
  if (doc.getElementById('terminal-input')) return true
  // Focused work hides the entire sidebar — the only buttons on screen are
  // "Stop Faction work" and "Do something else simultaneously" — so the nav
  // search below finds nothing and every DOM command fails with "terminal
  // input not found". Drop focus first; restoreFocus() reclaims the 25% after
  // the batch, and upkeep.js catches any case where it does not.
  for (const el of doc.querySelectorAll('button')) {
    if (el.textContent && el.textContent.trim() === 'Do something else simultaneously' && el.offsetParent !== null) {
      el.click()
      break
    }
  }
  for (const el of doc.querySelectorAll('div,span,p,button')) {
    if (el.textContent && el.textContent.trim() === 'Terminal' && el.offsetParent !== null) {
      el.click()
      if (doc.getElementById('terminal-input')) return true
    }
  }
  return !!doc.getElementById('terminal-input')
}

/**
 * Re-focus faction work if it is running unfocused.
 *
 * Navigating to the Terminal drops focus, and unfocused work earns 20% less
 * (CONSTANTS.BaseFocusBonus). Leaving it that way would make the bridge quietly
 * expensive every time it was used.
 */
function restoreFocus() {
  for (const el of doc.querySelectorAll('button')) {
    if (el.textContent && el.textContent.trim() === 'Focus' && el.offsetParent !== null) {
      el.click()
      return true
    }
  }
  return false
}

/** Type a command into the terminal the way a person would, and press Enter. */
function submit(command) {
  showTerminal()
  const input = doc.getElementById('terminal-input')
  if (!input) throw new Error('terminal input not found and the Terminal tab could not be opened')

  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
  setter.call(input, command)
  input.dispatchEvent(new win.Event('input', { bubbles: true }))
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
}

/**
 * Commands handled directly through the NS API, with no DOM involved.
 *
 * The terminal path only works while the Terminal tab is actually rendered, so
 * it fails whenever the game is showing the faction-work screen, the City, or
 * Create Program — which is exactly when an agent most wants to run something
 * without disturbing what is on screen. Focused faction work is worth 25% more
 * reputation than unfocused, so "go look at the Terminal first" is not free.
 *
 * Everything here has an NS equivalent and therefore needs no terminal at all.
 * Anything else — connect, backdoor, buy — genuinely has no NS equivalent
 * without Source-File 4 and still goes through the DOM.
 *
 * Returns a string result, or null if this is not a native command.
 */
async function runNative(ns, line) {
  const [verb, ...args] = line.split(/\s+/)

  switch (verb) {
    case 'exec': {
      // exec <script> <host> [threads] [args...]
      const [script, host, threadsRaw, ...rest] = args
      const threads = Number(threadsRaw) || 1
      if (host !== 'home' && !ns.scp(script, host, 'home')) return `exec: could not copy ${script} to ${host}`
      const pid = ns.exec(script, host, threads, ...rest)
      return pid ? `started ${script} on ${host} (pid ${pid}, ${threads} threads)` : `exec failed — not enough RAM on ${host}?`
    }
    case 'scp':
      return ns.scp(args[0], args[1], args[2] ?? 'home') ? `copied ${args[0]} to ${args[1]}` : `scp failed`
    case 'killall':
      // killall <host> — the terminal's version only hits the connected server.
      return `killed ${ns.killall(args[0] ?? ns.getHostname())} process(es) on ${args[0] ?? ns.getHostname()}`
    case 'killscript':
      // killscript <script> <host>
      return ns.scriptKill(args[0], args[1]) ? `killed ${args[0]} on ${args[1]}` : `nothing killed`
    case 'ps':
      return ns
        .ps(args[0] ?? ns.getHostname())
        .map((p) => `${p.pid} ${p.filename} ${p.threads}t ${p.args.join(' ')}`)
        .join('\n')
    case 'free': {
      const host = args[0] ?? ns.getHostname()
      const max = ns.getServerMaxRam(host)
      return `${host}: ${ns.getServerUsedRam(host).toFixed(2)} / ${max} GB used`
    }
    default:
      return null
  }
}

export async function main(ns) {
  ns.disableLog('ALL')
  ns.tprint('cmd.js: terminal bridge up — write commands to /cmd/in.txt')

  // --- state that the exit path needs to see --------------------------------
  //
  // All three of these are held outside the loop precisely so ns.atExit can
  // reach them. `live` is non-null exactly while a batch is in flight, and it
  // is what makes a killed batch reportable instead of invisible.
  let live = null
  let busyHeld = false
  const errors = []
  const tally = { batches: 0, ran: 0, failed: 0 }

  // Drop a busy file we did not write.
  //
  // dropBusy() below is ownership-checked (`busyHeld`), which is right while a
  // bridge is running — but it means a busy file left by a PREVIOUS bridge is
  // never cleaned up by anyone. Text files survive an augmentation install
  // (prestigeHomeComputer resets programs, serversOnNetwork and ramUsed, not
  // files), so a bridge killed mid-batch by an install leaves /cmd/busy.txt
  // behind forever, and augbuy.js waits on its absence before touching the
  // screen (augbuy.js:102) — which silently breaks augmentation buying in the
  // next life, at exactly the moment it is needed.
  //
  // Safe unconditionally: only one bridge may run at a time, and we have not
  // started a batch yet, so any busy file present now is by definition stale.
  // Free, too — ns.rm is already in this script's RAM bill.
  if (ns.fileExists(BUSY, 'home')) {
    ns.rm(BUSY, 'home')
    ns.tprint('cmd.js: cleared a stale /cmd/busy.txt from a previous bridge')
  }

  const note = reporter(ns, STATUS, () => ({
    batches: tally.batches,
    commandsRun: tally.ran,
    batchesFailed: tally.failed,
    errors: errors.slice(-5),
  }))

  /**
   * Write /cmd/out.txt for the batch in flight.
   *
   * Called after EVERY command, not only at the end. The old code wrote this
   * file once, after the loop — so a batch that threw or was killed halfway
   * left the *previous* batch's JSON in place, and a caller that polled for the
   * absence of /cmd/busy.txt then read it got stale results that looked
   * perfectly valid. Now the file always describes the newest batch, and
   * `status` says whether it finished:
   *
   *   running  — still executing; results so far
   *   ok       — every queued command was attempted
   *   error    — threw partway; `error` says how far it got and why
   *   aborted  — the process died mid-batch (kill / killall / install)
   *
   * `at` and `results` keep their old names and meaning, so a reader that only
   * looks at those is unaffected; everything else is additive.
   */
  const publishOut = (state, why) => {
    if (!live) return
    publish(ns, OUT, {
      at: new Date().toISOString(),
      status: state,
      startedAt: live.startedAt,
      queued: live.queued,
      completed: live.results.length,
      error: why ?? null,
      results: live.results,
    })
  }

  /** Record one command's result and immediately republish the batch. */
  const emit = (row) => {
    live.results.push(row)
    tally.ran++
    publishOut('running')
  }

  /** Drop /cmd/busy.txt, but only if this process is the one that wrote it. */
  const dropBusy = () => {
    if (!busyHeld) return
    busyHeld = false
    try {
      ns.rm(BUSY, 'home')
    } catch {
      /* already gone */
    }
  }

  // The path no try/finally can reach: `kill cmd.js`, a killall, an
  // augmentation install, or a throw that escaped every handler below. Order
  // matters — the shared resources are given back first, because a failure
  // while *reporting* must not cost the lock. publish() never throws, but
  // release() reads the game, so both are guarded.
  ns.atExit(() => {
    try {
      release(ns)
    } catch {
      /* lock already gone */
    }
    try {
      dropBusy()
    } catch {
      /* busy file already gone */
    }
    try {
      publishOut('aborted', 'cmd.js exited mid-batch — killed, or threw past every handler')
    } catch {
      /* nothing left to try */
    }
    note.exit('stopped', {
      detail: live
        ? `cmd.js exited mid-batch after ${live.results.length}/${live.queued} command(s)`
        : 'cmd.js exited while idle',
    })
  }, 'cmd-bridge')

  // Clear any stale lock from a previous run that was killed mid-batch.
  if (ns.fileExists(BUSY, 'home')) ns.rm(BUSY, 'home')

  note('waiting', { detail: 'bridge up, watching /cmd/in.txt' })
  let beatAt = Date.now()

  while (true) {
    try {
      if (!ns.fileExists(IN, 'home')) {
        if (Date.now() - beatAt > BEAT_MS) {
          beatAt = Date.now()
          note('waiting', { detail: 'idle' })
        }
        await ns.sleep(POLL)
        continue
      }

      // Take the global lock for the whole batch. The terminal is a single
      // stateful resource and `backdoor` in particular runs for minutes: any
      // other command typed meanwhile prints "Cancelled backdoor" and throws the
      // progress away. /cmd/busy.txt alone never prevented that, because the UI
      // scripts did not consult it.
      if (!(await acquire(ns, 'cmd.js'))) {
        ns.print('cmd: could not take the lock; leaving the batch queued')
        note('locked', { detail: 'could not take the UI lock; batch left queued in /cmd/in.txt' })
        await ns.sleep(POLL)
        continue
      }

      // From here the lock is held and, in a moment, so is /cmd/busy.txt. Every
      // path out of this block gives both back: the finally below on a return or
      // a throw, the atExit above on a kill.
      let failed = false
      try {
        const script = ns.read(IN)
        ns.rm(IN, 'home')
        ns.write(BUSY, new Date().toISOString(), 'w')
        busyHeld = true

        const results = []
        const queued = script.split('\n').map((l) => l.trim()).filter(Boolean)

        // No await between removing /cmd/in.txt, creating /cmd/busy.txt and
        // stamping /cmd/out.txt as running, so an outside reader can never
        // observe the gap: the game runs this whole sequence in one synchronous
        // turn of the main thread. That is what makes "in.txt gone and busy.txt
        // present" a state the poller can trust, and what stops out.txt being
        // readable as the previous batch's answer once the new one has started.
        live = { startedAt: new Date().toISOString(), queued: queued.length, results }
        tally.batches++
        publishOut('running')

        // Which server the terminal is currently attached to. Tracked rather than
        // queried because there is no NS call for "the server the *terminal* is
        // connected to" — ns.getHostname() reports where this script runs, which is
        // always home. `backdoor` needs it to know what goal state to watch.
        let connected = 'home'

        for (const line of queued) {
          const hop = line.match(/^\s*connect\s+(\S+)\s*$/i)
          if (hop) connected = hop[1]
          else if (/^\s*home\s*$/i.test(line)) connected = 'home'
          if (FORBIDDEN.some((re) => re.test(line))) {
            emit({ command: line, output: null, error: 'refused: destructive command' })
            continue
          }

          // Prefer the NS path — it works whatever the game is displaying.
          try {
            const native = await runNative(ns, line)
            if (native !== null) {
              emit({ command: line, output: native, error: null, via: 'ns' })
              continue
            }
          } catch (err) {
            emit({ command: line, output: null, error: String(err), via: 'ns' })
            continue
          }

          // Opening the Terminal tab is a React state change, so the input is not
          // in the DOM until the next render — clicking and checking in the same
          // tick always failed. Give it a moment.
          if (!doc.getElementById('terminal-input')) {
            try {
              showTerminal()
            } catch {
              /* nav not found */
            }
            await ns.sleep(600)
          }

          const before = terminalLines().length
          try {
            submit(line)
          } catch (err) {
            emit({ command: line, output: null, error: String(err) })
            continue
          }

          // Let the command run. Most are instant, but backdoor and analyze take
          // real time and print only when they finish, so wait until the terminal
          // stops producing lines rather than guessing a fixed delay.
          //
          // "Stops producing lines" is not sufficient on its own. A blocking action
          // prints *nothing at all* while it runs, so the terminal is silent from
          // the moment the command is submitted and the 800ms stability check fires
          // immediately — the bridge declares success and sends the next command
          // into a still-running action. The game answers every one of them with
          // "Cannot execute command while an action is in progress", so a queued
          // batch of `connect ... backdoor` silently lands only its first backdoor
          // and the rest of the batch is thrown away. That cost three of four
          // faction unlocks in one batch and looked like success in /cmd/out.txt.
          //
          // Requiring "at least one new line" did not fix it either, because
          // `backdoor` renders an in-place progress bar: one <li> whose *text*
          // advances from [------] to [||||||]. The line count stops changing
          // 200ms in, so the check fired while the bar was a third full and the
          // next command still landed in a running action.
          //
          // Counting lines is simply the wrong instrument. Two replacements, in
          // order of preference:
          //
          //   1. Close the loop on game state. `backdoor` has an observable goal —
          //      ns.getServer(host).backdoorInstalled — so poll that instead of
          //      inferring completion from what the screen looks like. No timing
          //      assumption, and immune to any rendering change.
          //   2. Where no such signal exists, compare the terminal's *content*
          //      rather than its line count, so in-place updates count as activity.
          let lines = []
          const target = /^\s*backdoor\b/i.test(line) ? connected : null

          if (target) {
            let done = false
            for (let waited = 0; waited < 300000; waited += 250) {
              await ns.sleep(250)
              if (waited % 30000 === 0) touch(ns)
              try {
                if (ns.getServer(target).backdoorInstalled) {
                  done = true
                  break
                }
              } catch {
                /* unknown host; fall back to whatever the terminal printed */
              }
            }
            const now = terminalLines()
            lines = now.length > before ? now.slice(before) : now.slice(-8)
            if (!done) lines.push(`(bridge: ${target} still reports no backdoor after 300s)`)
          } else {
            let sig = terminalLines().join('\n')
            let stableFor = 0
            for (let waited = 0; waited < 120000; waited += 200) {
              await ns.sleep(200)
              const now = terminalLines()
              const nextSig = now.join('\n')
              if (nextSig !== sig) {
                sig = nextSig
                stableFor = 0
              } else {
                stableFor += 200
                if (stableFor >= 800) {
                  // The terminal is bounded, so once it is full the line count stops
                  // rising and the new output is simply the tail.
                  lines = now.length > before ? now.slice(before) : now.slice(-8)
                  break
                }
              }
            }
          }

          // Drop the echoed prompt line the terminal prints for the command itself.
          const output = lines
            .filter((l) => !l.trimEnd().endsWith('> ' + line))
            .join('\n')
            .trim()

          emit({ command: line, output: output.slice(0, 4000), error: null })
        }

        // The DOM path steals focus from faction work; give it back.
        try {
          if (results.some((r) => r.via !== 'ns')) restoreFocus()
        } catch {
          /* nothing focusable */
        }

        publishOut('ok')
        note('ok', { detail: `ran ${results.length} command(s)` })
        ns.print(`ran ${results.length} command(s)`)
      } catch (err) {
        // A throw somewhere in the batch. Previously this killed the bridge and
        // left the lock, the busy file and a stale /cmd/out.txt behind, with no
        // record anywhere of what happened. Now the caller gets the partial
        // results plus the reason, and the bridge keeps serving.
        failed = true
        tally.failed++
        const detail = record(errors, err)
        ns.print(`cmd error: ${detail}`)
        publishOut('error', describe(err))
        note('error', {
          detail: describe(err),
          completed: live ? `${live.results.length}/${live.queued}` : null,
        })
      } finally {
        // Ordered like the atExit: shared state first. Releasing sooner than the
        // atExit would is the whole point of keeping this finally — the atExit is
        // the backstop, not the normal path.
        release(ns)
        dropBusy()
        live = null
        beatAt = Date.now()
      }

      // Back off after a failed batch. Almost every throw happens after
      // /cmd/in.txt has been consumed, so the loop simply goes idle — but a
      // throw in the read/rm pair itself would leave the input in place and spin
      // this loop (and the lock) at 1Hz against a command it cannot process.
      // The input is deliberately NOT deleted on failure: it is the caller's
      // queue, and throwing their batch away to protect our loop is the wrong
      // trade. Sleeping is enough.
      if (failed) await ns.sleep(FAIL_BACKOFF)
    } catch (err) {
      // Outside the batch entirely: ns.fileExists, acquire, or the reporter
      // itself. Nothing to release here (the inner finally already ran, or we
      // never acquired), but the loop must not spin on a repeating failure.
      const detail = record(errors, err)
      ns.print(`cmd error (outer): ${detail}`)
      note('error', { detail: describe(err) })
      await ns.sleep(POLL)
    }
  }
}
