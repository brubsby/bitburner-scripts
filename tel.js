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

/**
 * THE FRESH-LIFE EARNINGS LEDGER — the measurement countplan.js needs.
 *
 * countplan decides how many count tickets to bank per install, and the input
 * that decides it is how slowly a FRESH life earns. That was never recorded:
 * the planner's own ledgers track multipliers and life lengths, not money, and
 * the money BALANCE is useless for it because every augmentation purchase
 * spends it. The first attempt at the pricing guessed the ramp instead, at
 * 100x the truth, and concluded "install after every single ticket".
 *
 * `ns.getMoneySources().sinceInstall` is the right instrument. The game zeroes
 * it on every install (PlayerObjectGeneralMethods.ts:128), and it is kept PER
 * SOURCE, so income can be summed while spending is ignored — augmentation
 * purchases land under `augmentations` as a negative (FactionHelpers.tsx:120)
 * and never enter the sum below.
 *
 * AGE IS WALL-CLOCK SINCE THE INSTALL — `Date.now() - lastAugReset` — and the
 * first draft got this wrong in a way that would have looked like data. It
 * read `player.playtimeSinceLastAug`, which ns.getPlayer() does NOT expose
 * (it returns `totalPlaytime` only; NetscriptFunctions.ts getPlayer), so every
 * sample would have been written at age 0: a populated ledger describing
 * nothing. The wall clock is also the right one here. A machine suspend
 * advances it, but the game credits offline progress on wake, so the earnings
 * below advance over the SAME interval and the pairing stays true — and the
 * question countplan asks, "how long until this is affordable", is a
 * wall-clock question anyway.
 *
 * GANG INCOME IS IN IT, AND ARRIVES IN A LUMP. The first sample of the first
 * recorded life read $7.14m earned at age 0.0003h — one second — which looks
 * like a broken clock or a missed reset. It is neither: moneySourceA showed
 * `gang: 7137013`, credited in a burst right after the install. Player.gang
 * survives an install, so its income is not part of the fresh-life RAMP at all
 * — it flows on both sides of countplan's install-versus-wait comparison and
 * largely cancels there. It is real money available for tickets, it is small
 * against ticket prices of $40m-$1.2b, and the median across lives absorbs a
 * lump that is not representative. Left in deliberately.
 */
const EARN = '/tel/earnings.txt'
const EARN_EVERY_MS = 5 * 60 * 1000
/** Lives kept. countplan needs three completed ones; eight survives a node's worth. */
const EARN_LIVES = 8
/** Income sources only — every expense source is left out on purpose. */
const INCOME_SOURCES = ['hacking', 'hacknet', 'gang', 'codingcontract', 'crime', 'work', 'stock', 'infiltration', 'sleeves', 'corporation', 'bladeburner', 'darknet']

function recordEarnings(ns, self) {
  const info = ns.getResetInfo()
  const src = ns.getMoneySources()?.sinceInstall ?? {}
  const earned = INCOME_SOURCES.reduce((sum, k) => sum + Math.max(0, typeof src[k] === 'number' && isFinite(src[k]) ? src[k] : 0), 0)
  const since = info?.lastAugReset
  if (!(typeof since === 'number' && isFinite(since) && since > 0)) return
  const ageH = (Date.now() - since) / 3600000
  if (!(ageH >= 0) || !isFinite(earned)) return
  // PULL before reading: this script runs off home, where ns.read of a file
  // it does not hold returns '' — and a ledger rebuilt from nothing every
  // pass would never accumulate a single completed life. Invariant C10.
  if (self !== 'home') {
    try {
      ns.scp(EARN, self, 'home')
    } catch {
      /* first run, or home unreachable: start from empty */
    }
  }
  let led = null
  try {
    led = JSON.parse(ns.read(EARN) || 'null')
  } catch {
    led = null
  }
  if (!led || typeof led !== 'object' || typeof led.lives !== 'object' || led.lives === null) led = { lives: {} }
  const key = String(info?.lastAugReset ?? 'unknown')
  // A NEW life has begun whenever a different lastAugReset appears, so every
  // other open life is now finished. That is the only way a life is ever
  // marked complete, and countplan uses completed lives alone.
  for (const [k, L] of Object.entries(led.lives)) if (k !== key && L && !L.complete) L.complete = true
  const L = (led.lives[key] ??= { node: info?.currentNode ?? null, complete: false, samples: [] })
  L.samples.push([Math.round(ageH * 1e4) / 1e4, Math.round(earned)])
  const keys = Object.keys(led.lives).sort((a, b) => Number(a) - Number(b))
  while (keys.length > EARN_LIVES) delete led.lives[keys.shift()]
  ns.write(EARN, JSON.stringify(led), 'w')
  // And PUSH after writing, or the ledger lives on this host and nothing on
  // home ever reads it. Invariant C12.
  if (self !== 'home') ns.scp(EARN, 'home', self)
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
  let lastEarnAt = 0

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
        // THE PAGE'S JS HEAP, so a slow leak is visible before it kills the
        // renderer (the tab died 2026-09-25 after hours of play). performance
        // through eval, so the RAM checker never prices it; null where the
        // browser does not expose it.
        heapMB: (() => {
          try {
            const m = eval('performance').memory
            return m ? Math.round(m.usedJSHeapSize / 1e6) : null
          } catch {
            return null
          }
        })(),
        reachable: hosts.length,
        rooted: servers.length,
        processes,
        servers: servers.sort((a, b) => b.maxMoney - a.maxMoney),
      }

      lastGood = report
      lastGoodAt = note('ok', report).at
      consecutiveErrors = 0

      mirror()

      // Its own try: the earnings ledger is a measurement for countplan.js,
      // and a failure recording it must never cost the status this script
      // exists to publish.
      if (Date.now() - lastEarnAt >= EARN_EVERY_MS) {
        try {
          recordEarnings(ns, self)
          lastEarnAt = Date.now()
        } catch (err) {
          ns.print(`tel: earnings ledger not written: ${describe(err)}`)
        }
      }
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
