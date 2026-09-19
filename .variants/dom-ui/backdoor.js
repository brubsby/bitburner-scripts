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

  while (true) {
    const report = []
    let queuedThisPass = false

    try {
      const level = ns.getHackingLevel()

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

      ns.write(
        STATUS,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            hackingLevel: level,
            done,
            remaining: TARGETS.filter(([h]) => !done.includes(h)).map(([h]) => h),
            report,
          },
          null,
          2,
        ),
        'w',
      )

      if (flags.once) return
      if (done.length === TARGETS.length) {
        ns.tprint('backdoor: every story server backdoored — accept the invites')
        return
      }
    } catch (err) {
      ns.print(`backdoor error: ${err}`)
    }

    await ns.sleep(INTERVAL)
  }
}
