// Roots and backdoors every story server it can reach, with no human and no
// Source-File 4.
//
//   run backdoor.js            watch continuously, backdoor whatever unlocks
//   run backdoor.js --once     one pass, then exit
//
// Backdooring the five story servers is the whole of faction access, and an
// augmentation install wipes it — so this is the single most repetitive manual
// step in a run, and it has to be redone from scratch every life. It is also
// the step most likely to be skipped, and skipping it means reputation earns
// exactly zero until someone notices.
//
// ns.singularity.connect and ns.singularity.installBackdoor need SF4, but the
// *terminal* `connect` and `backdoor` commands are not gated at all — so this
// works at any Source-File level by routing through the cmd.js bridge, exactly
// as a human would type it. If SF4 ever arrives, the singularity path can be
// added here without changing anything else.
//
// Rooting is port-gated only, never level-gated (ns.nuke checks open ports
// alone), so a server can often be rooted long before it can be backdoored.
// Backdooring additionally needs hacking level >= the server's requirement,
// which is why this keeps watching rather than running once: the list unlocks
// gradually as the level climbs.
//
// The completion signal is the game's own state — ns.getServer(host)
// .backdoorInstalled — not the terminal's output. Terminal text is a rendering
// detail and `backdoor` prints an in-place progress bar that made every
// text-based completion check fire early; the flag is unambiguous.

// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

const TARGETS = [
  // server, and the faction it unlocks, for the log
  ['CSEC', 'CyberSec'],
  ['avmnite-02h', 'NiteSec'],
  ['I.I.I.I', 'The Black Hand'],
  ['run4theh111z', 'BitRunners'],
  ['fulcrumassets', 'Fulcrum Secret Technologies'],
]

const CMD_IN = '/cmd/in.txt'
const BUSY = '/cmd/busy.txt'
const STATUS = '/tel/backdoor.txt'
const INTERVAL = 30000

/** Breadth-first route from home, as the terminal would have to walk it. */
function routeTo(ns, target) {
  const seen = new Set(['home'])
  const queue = [['home']]
  while (queue.length) {
    const path = queue.shift()
    const host = path[path.length - 1]
    if (host === target) return path
    for (const next of ns.scan(host)) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push([...path, next])
    }
  }
  return null
}

/** Open every port we have a program for, then nuke. Port-gated, not level-gated. */
function tryRoot(ns, host) {
  if (ns.hasRootAccess(host)) return true
  const openers = [
    ['BruteSSH.exe', ns.brutessh],
    ['FTPCrack.exe', ns.ftpcrack],
    ['relaySMTP.exe', ns.relaysmtp],
    ['HTTPWorm.exe', ns.httpworm],
    ['SQLInject.exe', ns.sqlinject],
  ]
  let opened = 0
  for (const [file, fn] of openers) {
    if (!ns.fileExists(file, 'home')) continue
    try {
      fn(host)
      opened++
    } catch {
      /* already open */
    }
  }
  if (opened >= ns.getServerNumPortsRequired(host)) {
    try {
      ns.nuke(host)
    } catch {
      /* not enough ports after all */
    }
  }
  return ns.hasRootAccess(host)
}

export async function main(ns) {
  const flags = ns.flags([['once', false]])
  ns.disableLog('ALL')
  ns.tprint('backdoor.js: watching for story servers to root and backdoor')

  const done = []
  const errors = []
  // Last known hacking level, hoisted so the error and exit paths can report
  // the number the decisions were being made on rather than omitting it.
  let hackingLevel = null
  // True once a terminal verdict has been published — every story server
  // backdoored, or --once finished. Without it the atExit below would overwrite
  // a successful completion with 'stopped' on the way out.
  let settled = false

  // `done` and `remaining` ride on EVERY write, including the error and exit
  // ones. That is not cosmetic: watchdog.js's invariant for this entry is
  // `JSON.parse(ns.read('/tel/backdoor.txt')).remaining.length > 0`
  // (watchdog.js:188-195), so a status body that drops the field is a status
  // body that changes the watchdog's mind. Missing/unparseable means "run it
  // and find out", which is safe but throws away what we knew.
  const note = reporter(ns, STATUS, () => ({
    done,
    remaining: TARGETS.filter(([h]) => !done.includes(h)).map(([h]) => h),
    errors: errors.slice(-5),
  }))

  // The path no try/catch can reach: killed by the watchdog when its invariant
  // goes false, caught in a killall, or destroyed by an augmentation install —
  // which wipes every backdoor, making this the script a fresh life needs most.
  // ns.atExit costs 0GB and runs before the worker is torn down
  // (killWorkerScript.ts:64-84). Explicit id so it can never replace the
  // 'ui-lock' callback lock.js registers.
  ns.atExit(() => {
    if (settled) return
    note.exit('stopped', {
      hackingLevel,
      detail: 'backdoor.js exited with story servers still un-backdoored — faction access is blocked',
    })
  }, 'status')

  while (true) {
    const report = []
    let queuedThisPass = false

    try {
      const level = ns.getHackingLevel()
      hackingLevel = level

      for (const [host, faction] of TARGETS) {
        if (done.includes(host)) continue
        if (!ns.serverExists(host)) {
          report.push(`${host}: not on the network`)
          continue
        }

        const server = ns.getServer(host)
        if (server.backdoorInstalled) {
          done.push(host)
          report.push(`${host}: done -> ${faction}`)
          continue
        }

        const need = ns.getServerRequiredHackingLevel(host)
        if (level < need) {
          report.push(`${host}: hacking ${level}/${need}`)
          continue
        }
        if (!tryRoot(ns, host)) {
          report.push(`${host}: needs ${ns.getServerNumPortsRequired(host)} ports`)
          continue
        }

        // One target per pass. The bridge runs a batch serially and `backdoor`
        // takes real time, so queueing several at once just makes the status
        // file stale for longer; the next pass picks up the next one.
        if (queuedThisPass || ns.fileExists(BUSY, 'home') || ns.fileExists(CMD_IN, 'home')) continue

        const route = routeTo(ns, host)
        if (!route) {
          report.push(`${host}: no route`)
          continue
        }
        const lines = [...route.slice(1).map((h) => `connect ${h}`), 'backdoor', 'home']
        ns.write(CMD_IN, lines.join('\n'), 'w')
        queuedThisPass = true
        report.push(`${host}: queued (${route.length - 1} hops)`)
      }

      const finished = done.length === TARGETS.length
      // Both returns below are terminal, so mark the verdict settled BEFORE
      // publishing it — the atExit must not then overwrite "every story server
      // backdoored" with "stopped" as the script returns normally.
      if (flags.once || finished) settled = true
      note(finished ? 'ok' : 'waiting', { hackingLevel: level, report })

      if (flags.once) return
      if (finished) {
        ns.tprint('backdoor: every story server backdoored — accept the invites')
        return
      }
    } catch (err) {
      // ALWAYS surface the failure. The status write was the last statement of
      // this try, so a throw anywhere above it — ns.getServer on a host that
      // vanished, a route walk that found nothing, a bad edit — skipped the one
      // record of it and left /tel/backdoor.txt frozen. The watchdog then keeps
      // reading a stale `remaining` and concluding everything is in hand.
      try {
        const detail = record(errors, err)
        ns.print(`backdoor error: ${detail}`)
        note('error', { hackingLevel, report, detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
    }

    await ns.sleep(INTERVAL)
  }
}
