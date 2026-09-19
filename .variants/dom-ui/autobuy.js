// Buys the TOR router and the port-opening programs as soon as they are
// affordable, with no human and no Source-File 4.
//
//   run autobuy.js
//
// Port openers are the best conversion of money into progress in the game:
// rooting is gated on open ports alone, never on hacking level, so each one
// unlocks a whole tier of servers whose RAM the batcher can use immediately.
// relaySMTP once unlocked 688GB for $5m — about $7.3k/GB against the cloud's
// flat $55k/GB.
//
// Buying them is normally a UI job (`ns.singularity.purchaseProgram` needs
// Source-File 4), which meant a human had to notice and click, and so they sat
// unbought for hours at a time. Two routes out, tried in order:
//
//   1. ns.singularity.purchaseProgram, if the Source-File is present.
//   2. The terminal's own `buy` command, queued through cmd.js — which works
//      at any Source-File level, because the terminal is not gated.
//
// So this file behaves correctly whether or not SF4 is owned, and needs
// nothing rewritten when it is eventually obtained.

const TOR_COST = 200e3
const PROGRAMS = [
  { file: 'BruteSSH.exe', price: 500e3 },
  { file: 'FTPCrack.exe', price: 1.5e6 },
  { file: 'relaySMTP.exe', price: 5e6 },
  { file: 'HTTPWorm.exe', price: 30e6 },
  { file: 'SQLInject.exe', price: 250e6 },
  // Not a port opener — it unlocks ns.formulas, the game's own formula API.
  // Worth every dollar: batch.js plans with inlined ports of the game's math
  // that can silently drift from upstream, and with Formulas.exe present it
  // switches to asking the game directly (0 GB per call, RamCostGenerator
  // 695-706). This is the only in-game way to get exact numbers with no
  // Source-File and no reading of game source.
  { file: 'Formulas.exe', price: 5e9 },
]

// Whether TOR is owned. Use the game's own predicate: ns.hasTorRouter(), which
// costs 0.05GB and needs no Source-File (RamCostGenerator.ts:591). It is
// literally `home.serversOnNetwork.includes('darkweb')`
// (PlayerObjectServerMethods.ts:14-16).
//
// NOT ns.serverExists('darkweb'): the darkweb server is always present in the
// server list, and buying TOR merely *connects* it to home (`getTorRouter()`
// -> connectServers(home, darkweb), ServerHelpers.ts:354-356). serverExists is
// therefore true from the first second of a BitNode, which made autobuy believe
// TOR was owned, never buy it, and queue `buy FTPCrack.exe` every 60s into a
// terminal that answered "You need to be able to connect to the Dark Web".
const hasTor = (ns) => ns.hasTorRouter()

const CMD_IN = '/cmd/in.txt'
const BUSY = '/cmd/busy.txt'
const STATUS = '/tel/autobuy.txt'
// Two cadences. While anything is still missing this is the critical path —
// every port program unlocks a tier of servers to root, and the fleet cannot
// grow without them — so poll fast. Once everything is owned there is nothing
// to do but notice a new BitNode, so back off.
const INTERVAL_HUNTING = 5000
const INTERVAL_IDLE = 60000

/** Queue terminal commands for cmd.js. Appends if something is already pending. */
function queue(ns, lines) {
  const existing = ns.fileExists(CMD_IN, 'home') ? ns.read(CMD_IN) : ''
  ns.write(CMD_IN, (existing ? existing.trimEnd() + '\n' : '') + lines.join('\n'), 'w')
}

/**
 * Is the bridge still working through something?
 *
 * /cmd/in.txt exists while commands are queued but not yet consumed;
 * /cmd/busy.txt exists while a batch is executing. Either means a previous
 * request is still in flight, and queueing more is how the same purchase gets
 * requested a dozen times.
 */
const bridgeBusy = (ns) => ns.fileExists(CMD_IN, 'home') || ns.fileExists(BUSY, 'home')

export async function main(ns) {
  ns.disableLog('ALL')
  ns.tprint('autobuy.js: watching for affordable port programs')

  const bought = []
  let warnedTor = false
  // file -> ms when we last asked for it. A purchase is not instant: the bridge
  // must take the global lock, open the Terminal and type, and only then does
  // ns.fileExists see the program. Without this the 5s hunting tick re-queued
  // the same `buy` on every pass until the file finally appeared — `buy
  // Formulas.exe` went out a dozen times for one purchase. The timeout means a
  // genuinely lost command is still retried rather than blocking forever.
  const inFlight = new Map()
  const RETRY_MS = 45000

  while (true) {
    try {
      // Backpressure: never stack a second request on top of one the bridge
      // has not finished. This signal already existed and autobuy ignored it.
      if (bridgeBusy(ns)) {
        await ns.sleep(2000)
        continue
      }

      const money = ns.getServerMoneyAvailable('home')
      const tor = hasTor(ns)
      const sing = ns.singularity
      const wanted = []

      // Keep a little headroom so this never spends the last dollar out from
      // under something else mid-purchase.
      if (!tor && money > TOR_COST * 1.5) {
        let done = false
        if (sing) {
          try {
            done = sing.purchaseTor()
          } catch {
            /* no Source-File 4 */
          }
        }
        if (done) bought.push('TOR (singularity)')
        // Without Source-File 4 there is no way to buy TOR from a script at
        // all: the terminal's `buy` command requires the darkweb, which
        // requires TOR. Retrying just floods the terminal with the same error
        // every tick — it did exactly that for half an hour. Say it once and
        // leave it to a human.
        else if (!warnedTor) {
          warnedTor = true
          ns.tprint('autobuy: TOR router is needed and cannot be bought by a script without Source-File 4 — buy it at Alpha Enterprises (Sector-12) for $200k. Every port program after that is automatic.')
        }
      }

      if (tor) {
        // Queue EVERY program we can afford in one batch, cheapest first.
        //
        // This used to buy one per tick with a comment about re-reading the
        // balance between purchases. That made sense when a single program was
        // a meaningful fraction of net worth; at trillions per second it just
        // meant six programs took six minutes, and the fleet sat un-rooted the
        // whole time. Affordability is checked against the *cumulative* cost
        // instead, which is the thing the old code was really protecting
        // against, and it stays correct when money is tight.
        let budget = money
        const now = Date.now()
        for (const { file, price } of PROGRAMS) {
          if (ns.fileExists(file, 'home')) {
            inFlight.delete(file)
            continue
          }
          // Already asked for recently and still not here: let it land.
          const asked = inFlight.get(file)
          if (asked !== undefined && now - asked < RETRY_MS) continue
          if (budget < price * 1.5) continue
          budget -= price
          inFlight.set(file, now)

          let done = false
          if (sing) {
            try {
              done = sing.purchaseProgram(file)
            } catch {
              /* no Source-File 4 */
            }
          }
          if (done) bought.push(`${file} (singularity)`)
          else wanted.push(`buy ${file}`)
        }
      }

      if (wanted.length) {
        // The terminal route. cmd.js opens the Terminal tab itself if needed
        // and restores faction-work focus afterwards, so this costs nothing
        // beyond a moment of screen time.
        queue(ns, tor ? wanted : ['connect darkweb', ...wanted, 'home'])
        bought.push(`queued: ${wanted.join(', ')}`)
      }

      const owned = PROGRAMS.filter((p) => ns.fileExists(p.file, 'home')).map((p) => p.file)
      ns.write(
        STATUS,
        JSON.stringify(
          { at: new Date().toISOString(), tor, owned, missing: PROGRAMS.length - owned.length, recent: bought.slice(-10) },
          null,
          2,
        ),
        'w',
      )
    } catch (err) {
      ns.print(`autobuy error: ${err}`)
    }

    const missing = PROGRAMS.filter((p) => !ns.fileExists(p.file, 'home')).length
    await ns.sleep(missing > 0 ? INTERVAL_HUNTING : INTERVAL_IDLE)
  }
}
