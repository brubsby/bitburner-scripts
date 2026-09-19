// Telemetry reporter. Walks the network, snapshots what is running and how
// every rooted server is doing, and drops the result at /tel/status.txt on
// home where the external daemon mirrors it out to disk.
//
// Runs anywhere with ~4GB free — put it on a rooted server so it doesn't eat
// home RAM that could be hacking.
//
//   run tel.js            (5s interval, default)
//   run tel.js 15         (15s interval)
//
// ---------------------------------------------------------------------------
// This is the telemetry SOURCE, so its own failures are the expensive ones.
//
// The loop body used to have no error handling at all: a single throw — a
// server disappearing mid-scan, an arity change in the v3 API, a bad edit —
// exited main() and killed the process. /tel/status.txt then simply stopped
// changing, and a status file that stops changing is indistinguishable from a
// game that stopped changing. Every downstream reader (the daemon's mirror,
// `.telemetry/status.txt`, an agent checking what is running) goes on
// consuming the last good snapshot as though it were the present, with nothing
// anywhere saying otherwise.
//
// So three things changed, all observability:
//
//   1. A bad tick no longer kills the loop. A dead reporter is worse than a
//      reporter publishing errors — same reasoning as batch.js's "Never die".
//   2. The error write PRESERVES the last good payload and stamps it
//      `health: 'error'` + `staleSince`. Replacing it with a stub would break
//      every reader that expects `processes` and `servers`; leaving it alone is
//      the silent-staleness bug. Keeping both is the only honest option.
//   3. `ns.atExit` publishes `health: 'stopped'` when the process goes away for
//      any reason — killed, killall'd, or thrown past. That is the one path no
//      try/finally can reach, and for this script it is the most likely one.
// ---------------------------------------------------------------------------

import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/status.txt'

function scanAll(ns) {
  const seen = new Set(['home'])
  const queue = ['home']

  while (queue.length) {
    for (const host of ns.scan(queue.shift())) {
      if (!seen.has(host)) {
        seen.add(host)
        queue.push(host)
      }
    }
  }

  return [...seen]
}

export async function main(ns) {
  const interval = (ns.args[0] || 5) * 1000

  ns.disableLog('ALL')

  // Hoisted out of the loop: the hostname cannot change, and the error and
  // exit paths must be able to mirror without calling anything that could
  // itself throw. ns.scp (0.6GB) and ns.getHostname (0.05GB) were already
  // referenced here, so this costs nothing new.
  const self = ns.getHostname()
  const mirror = () => {
    if (self === 'home') return
    try {
      ns.scp(STATUS, 'home', self)
    } catch {
      // home unreachable is not a reason to lose the local copy.
    }
  }

  const errors = []
  const note = reporter(ns, STATUS, () => ({ errors: errors.slice(-5) }))

  // The last payload that was actually true, and when. Republished under an
  // 'error' or 'stopped' health so readers keep their shape and learn its age.
  let lastGood = null
  let lastGoodAt = null
  let consecutiveErrors = 0

  ns.atExit(() => {
    note.exit('stopped', {
      staleSince: lastGoodAt,
      error: 'tel.js is no longer running — everything below is history, not the present',
    })
    mirror()
  })

  while (true) {
    try {
      const hosts = scanAll(ns)
      const servers = []
      const processes = []

      for (const host of hosts) {
        const rooted = ns.hasRootAccess(host)
        const maxRam = ns.getServerMaxRam(host)

        for (const p of ns.ps(host)) {
          processes.push({ host, script: p.filename, threads: p.threads, args: p.args, pid: p.pid })
        }

        if (!rooted && !host.startsWith('pserv-')) continue

        const maxMoney = ns.getServerMaxMoney(host)
        servers.push({
          host,
          maxRam,
          usedRam: Math.round(ns.getServerUsedRam(host) * 100) / 100,
          money: Math.round(ns.getServerMoneyAvailable(host)),
          maxMoney,
          moneyPct: maxMoney ? Math.round((ns.getServerMoneyAvailable(host) / maxMoney) * 1000) / 10 : 0,
          security: Math.round(ns.getServerSecurityLevel(host) * 100) / 100,
          minSecurity: ns.getServerMinSecurityLevel(host),
          hackLevel: ns.getServerRequiredHackingLevel(host),
        })
      }

      const player = ns.getPlayer()
      // `at` and `health` are supplied by the reporter, which puts them first.
      const report = {
        source: self,
        hackingLevel: player.skills.hacking,
        money: Math.round(player.money),
        // [1] is money earned per second since the last augmentation install.
        // [0] sums the rate over *live* scripts, which reads exactly zero under a
        // batcher however much it earns: its h/g/w workers are one-shot and
        // credit themselves only in the instant before they exit. Confirmed live
        // at hacking 246 with 41,763 threads dispatched and [0] reporting 0.
        // This is the first number anyone looks at, so it being structurally
        // dead was worse than it being absent.
        incomePerSec: Math.round(ns.getTotalScriptIncome()[1] * 100) / 100,
        expPerSec: Math.round(ns.getTotalScriptExpGain() * 100) / 100,
        reachable: hosts.length,
        rooted: servers.length,
        processes,
        servers: servers.sort((a, b) => b.maxMoney - a.maxMoney),
      }

      lastGood = report
      lastGoodAt = note('ok', report).at
      consecutiveErrors = 0

      mirror()
    } catch (err) {
      // Never die, and never go quiet. Republish the last true snapshot with
      // the failure attached, so a reader sees both what the world looked like
      // and that this picture is no longer being refreshed.
      consecutiveErrors++
      try {
        const detail = record(errors, err)
        ns.print(`tel error: ${detail}`)
        note('error', {
          ...(lastGood || {}),
          error: describe(err),
          staleSince: lastGoodAt,
          consecutiveErrors,
        })
        mirror()
      } catch {
        /* nothing left to try */
      }
    }

    await ns.sleep(interval)
  }
}
