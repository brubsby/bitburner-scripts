// Buys the TOR router and the port-opening programs as soon as they are
// affordable, with no human and at any Source-File level.
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
//   1. autobuy-sing.js, a separate one-shot holding ns.singularity.purchaseTor
//      and ns.singularity.purchaseProgram, exec'd only when sfgate.js says the
//      Source-File is actually there.
//   2. The terminal's own `buy` command, queued through cmd.js — which works
//      at any Source-File level, because the terminal is not gated.
//
// ---------------------------------------------------------------------------
// WHY THE SINGULARITY CALLS ARE NOT IN THIS FILE.
//
// They used to be, behind `const sing = ns.singularity` and a try/catch. That
// is not a gate: Netscript prices every ns function in a script's import graph
// whether or not the call is reachable (Script/RamCalculations.ts:407), and the
// Singularity ladder charges x16 outside BitNode 4 at Source-File 4 level 1
// (RamCostGenerator.ts:82-96). The billed cost of this file was therefore
// 5.85GB inside BN4 and **65.85GB** at SF4.1 anywhere else — and it is in
// boot.js's STACK and watchdog.js's WATCHED list, so it launches every life at
// a home size that starts at 8, 32 or 128GB (Prestige.ts:242-248). A 65.85GB
// resident does not fit; the watchdog would have reported "no host with NGB
// free" every 30 seconds, forever, in silence.
//
// The try/catch made it worse rather than better, because it made the file look
// safe: the exception it caught never fires, since the RAM is charged before a
// line of it runs.
//
// So the split is the go.js / go-cheat.js pattern from CLAUDE.md: a 1GB
// ns.getResetInfo() probe here, the expensive surface in its own script, paid
// for only while it runs and only on a save that can call it. `exec` returning
// 0 (no RAM for the helper) falls through to the terminal route, which is
// always available — so this file cannot be worse off than before the split.

import { canUseSingularity } from 'sfgate.js'
// Pure: where money is capital (BitNode 8), a program is bought only on
// progress.js's priced verdict (nodeecon.programSpendAllowed); the node table.
import { programSpendAllowed } from 'nodeecon.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

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
// The Source-File-gated half. Named once so the exec and the "which script owns
// this capability" question have a single answer.
const SING_HELPER = 'autobuy-sing.js'
const TOR_ITEM = 'tor'
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

  // One 1GB probe for the whole life. Source-File level cannot change without a
  // BitNode reset, and a reset kills every running script, so re-reading this
  // per tick would buy nothing.
  const resetInfo = ns.getResetInfo()
  const useSingularity = canUseSingularity(resetInfo)
  const nodeMults = bitNodeMults(resetInfo.currentNode)
  ns.tprint(
    `autobuy.js: watching for affordable port programs (${useSingularity ? `singularity via ${SING_HELPER}` : 'terminal bridge'})`,
  )

  const bought = []
  let warnedTor = false
  // file -> ms when we last asked for it. A purchase is not instant: the bridge
  // must take the global lock, open the Terminal and type, and only then does
  // ns.fileExists see the program. Without this the 5s hunting tick re-queued
  // the same `buy` on every pass until the file finally appeared — `buy
  // Formulas.exe` went out a dozen times for one purchase. The timeout means a
  // genuinely lost command is still retried rather than blocking forever.
  //
  // The singularity route needs it just as much: exec is asynchronous, so the
  // helper has not run yet when this loop comes round again 5s later.
  const inFlight = new Map()
  const RETRY_MS = 45000

  const errors = []
  // `recent` rides on every write, so the error and exit paths still say what
  // this had managed before it stopped. Existing field names are unchanged;
  // `health` and `errors` are additive.
  const note = reporter(ns, STATUS, () => ({ recent: bought.slice(-10), errors: errors.slice(-5) }))

  // The path no try/catch can reach: killed by the watchdog, caught in a
  // killall, or destroyed by an augmentation install — and an install is
  // exactly when this matters, because it clears serversOnNetwork, TOR goes
  // with it and every port program has to be re-bought from scratch. ns.atExit
  // costs 0GB and runs before the worker is torn down
  // (killWorkerScript.ts:64-84), so the write still lands. Explicit id so it
  // can never replace the 'ui-lock' callback lock.js registers.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'autobuy.js is no longer buying port programs — the fleet stops growing' })
  }, 'status')

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
      const now = Date.now()
      // The priced verdict, read fresh each pass (0GB). Outside a capital
      // node `allowed` is always true and nothing below changes.
      const gateRec = (() => {
        try {
          return JSON.parse(ns.read('/tel/installgate.txt') || 'null')
        } catch {
          return null
        }
      })()
      const held = []
      const mayBuy = (item) => {
        const v = programSpendAllowed(nodeMults, gateRec, item, resetInfo.lastAugReset, now)
        if (!v.allowed) held.push(`${item}: ${v.why}`)
        return v.allowed
      }
      // Two shopping lists, and exactly one of them is ever non-empty: `sing`
      // holds arguments for the helper, `wanted` holds terminal `buy` lines.
      const sing = []
      const wanted = []
      let wantTor = false

      // Keep a little headroom so this never spends the last dollar out from
      // under something else mid-purchase.
      if (!tor && money > TOR_COST * 1.5 && mayBuy(TOR_ITEM)) {
        const asked = inFlight.get(TOR_ITEM)
        if (asked === undefined || now - asked >= RETRY_MS) {
          if (useSingularity) {
            inFlight.set(TOR_ITEM, now)
            sing.push(TOR_ITEM)
            wantTor = true
          } else if (!warnedTor) {
            // Without Source-File 4 there is no way to buy TOR from a script at
            // all: the terminal's `buy` command requires the darkweb, which
            // requires TOR. Retrying just floods the terminal with the same
            // error every tick — it did exactly that for half an hour. Say it
            // once and leave it to a human (or to torbuy.js, which drives the
            // Alpha Enterprises button directly).
            warnedTor = true
            ns.tprint('autobuy: TOR router is needed and cannot be bought by a script without Source-File 4 — buy it at Alpha Enterprises (Sector-12) for $200k. Every port program after that is automatic.')
          }
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
        for (const { file, price } of PROGRAMS) {
          if (ns.fileExists(file, 'home')) {
            inFlight.delete(file)
            continue
          }
          // Already asked for recently and still not here: let it land.
          const asked = inFlight.get(file)
          if (asked !== undefined && now - asked < RETRY_MS) continue
          if (budget < price * 1.5) continue
          if (!mayBuy(file)) continue
          budget -= price
          inFlight.set(file, now)
          if (useSingularity) sing.push(file)
          else wanted.push(`buy ${file}`)
        }
      }

      if (sing.length) {
        // One exec per pass. A pid of 0 means there was no RAM for the helper
        // — usually because the batcher has the fleet at ~98% — so fall back to
        // the terminal, which costs nothing and works at any Source-File level.
        // TOR has no terminal equivalent, so it just waits for the next pass.
        const pid = ns.exec(SING_HELPER, 'home', 1, ...sing)
        if (pid) {
          bought.push(`${SING_HELPER}: ${sing.join(', ')}`)
        } else {
          for (const item of sing) {
            inFlight.delete(item)
            if (item !== TOR_ITEM) wanted.push(`buy ${item}`)
          }
          ns.print(`autobuy: no RAM for ${SING_HELPER}, falling back to the terminal`)
        }
      }

      if (wanted.length) {
        // The terminal route. cmd.js opens the Terminal tab itself if needed
        // and restores faction-work focus afterwards, so this costs nothing
        // beyond a moment of screen time.
        queue(ns, wanted)
        bought.push(`queued: ${wanted.join(', ')}`)
      }

      const owned = PROGRAMS.filter((p) => ns.fileExists(p.file, 'home')).map((p) => p.file)
      note('ok', {
        tor,
        route: useSingularity ? 'singularity' : 'terminal',
        torRequested: wantTor,
        owned,
        missing: PROGRAMS.length - owned.length,
        // Items a capital node held for want of a priced verdict, and why.
        held,
      })
    } catch (err) {
      // ALWAYS surface the failure. The status write was the last statement of
      // this try, so a throw anywhere above it skipped the only record of what
      // went wrong: the process stayed alive on its 5s sleep and the file
      // simply froze on the last good tick, which reads as "nothing affordable
      // yet" rather than "not looking". Nothing in here reads the game, so the
      // report cannot become the failure.
      try {
        const detail = record(errors, err)
        ns.print(`autobuy error: ${detail}`)
        note('error', { detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
    }

    const missing = PROGRAMS.filter((p) => !ns.fileExists(p.file, 'home')).length
    await ns.sleep(missing > 0 ? INTERVAL_HUNTING : INTERVAL_IDLE)
  }
}
